import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { canonicalCoaching } from "../../../packages/domain/src/coaching-completion.ts";
import { currentPaidSubscription } from "./finance-billing.ts";
import { notifyUser } from "./notifications.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";

const uuid = z.string().uuid();
const fail = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });
const hash = (data: unknown) =>
  createHash("sha256").update(canonicalCoaching(data)).digest("hex");
const scheduleSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  dueAt: z.iso.datetime({ offset: true }),
  timezone: z
    .string()
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid timezone"),
  reviewed: z.literal(true),
});
const activeStates = ["scheduled", "review_required"];
function coach(req: FastifyRequest) {
  if (!req.identity) throw fail(401, "Please sign in");
  if (!["owner", "staff"].includes(req.identity.role))
    throw fail(403, "Coaching team access required");
  return req.identity;
}
async function lock(tx: Tx, a: Actor, target?: string) {
  await workspaceLock(tx, a.tenantId);
  for (const userId of [
    ...new Set([a.userId, ...(target ? [target] : [])]),
  ].sort())
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":training:" + userId,
    ]);
}
async function currentCoach(tx: Tx, a: Actor) {
  const [r] = await tx.query(
    "SELECT training_actor_is_current($1,$2,$3) current",
    [a.tenantId, a.userId, a.role],
  );
  return !!r?.current && ["owner", "staff"].includes(a.role);
}
async function assertCoach(tx: Tx, a: Actor) {
  if (!(await currentCoach(tx, a)))
    throw fail(
      403,
      "Your coaching permissions or workspace changed; sign in again",
    );
}
async function targetExists(tx: Tx, a: Actor, target: string) {
  return !!(
    await tx.query(
      "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
      [a.tenantId, target],
    )
  )[0];
}
async function record(tx: Tx, key: string) {
  const [r] = await tx.query(
    "SELECT * FROM records WHERE id=$1 AND kind='coaching_followup' FOR UPDATE",
    [key],
  );
  if (!r) throw fail(404, "Follow-up unavailable");
  return r;
}
function normalizeSchedule(b: z.infer<typeof scheduleSchema>, now: Date) {
  const dueAt = new Date(b.dueAt).toISOString(),
    ms = Date.parse(dueAt) - now.getTime();
  if (ms < 60_000 || ms > 90 * 86400_000)
    throw fail(400, "Schedule between one minute and 90 days from now");
  return { text: b.text, dueAt, timezone: b.timezone };
}
/** Pin current coaching instructions, not clocks or routine workout logs. */
async function context(tx: Tx, a: Actor, target: string) {
  if (!(await targetExists(tx, a, target)))
    return { reason: "The client is no longer a member of this workspace" };
  const paid = await currentPaidSubscription(tx, target);
  if (!paid)
    return {
      reason:
        "The client no longer has an active paid membership or grace period",
    };
  const [consent] = await tx.query(
    "SELECT id,granted FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC,id DESC LIMIT 1",
    [target],
  );
  if (!consent?.granted)
    return { reason: "The client has not granted current coaching consent" };
  const [hold] = await tx.query(
    "SELECT id FROM records WHERE owner_user_id=$1 AND ((kind='training_hold' AND status='active') OR (kind='workout' AND status='safety_hold') OR (kind='takeover' AND status='active')) LIMIT 1",
    [target],
  );
  if (hold)
    return {
      reason: "A training safety hold or personal takeover needs your review",
    };
  // Separate current facts from histories. No mixed limit can displace an old intake.
  const facts: any[] = [];
  for (const kind of [
    "intake",
    "nutrition_profile",
    "nutrition_target",
    "training_hold",
    "takeover",
  ])
    facts.push(
      (
        await tx.query(
          "SELECT id,kind,version,status FROM records WHERE owner_user_id=$1 AND kind=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
          [target, kind],
        )
      )[0] ?? { kind, absent: true },
    );
  const programs = await tx.query(
    "SELECT id,version,status FROM records WHERE owner_user_id=$1 AND kind='program' AND status='assigned' ORDER BY id",
    [target],
  );
  const pinned = {
    consentId: consent.id,
    subscriptionId: paid.id,
    facts,
    programs,
  };
  return { pinned, digest: hash(pinned) };
}
async function requireContext(tx: Tx, a: Actor, target: string) {
  const c = await context(tx, a, target);
  if (c.reason)
    throw fail(409, c.reason + ". Resolve this before scheduling a follow-up.");
  return c;
}
async function capacity(tx: Tx, target: string) {
  const [n] = await tx.query(
    "SELECT count(*)::int total,count(*) FILTER(WHERE owner_user_id=$1)::int client FROM records WHERE kind='coaching_followup' AND status=ANY($2::text[])",
    [target, activeStates],
  );
  if (n.total >= 500 || n.client >= 50)
    throw fail(
      409,
      "Cancel or complete existing follow-ups before scheduling more (50 per client, 500 per workspace)",
    );
}

export function registerCoachingFollowups(app: FastifyInstance, db: Database) {
  app.get("/api/v1/coaching/followups", async (req) => {
    const a = coach(req),
      q = z
        .object({
          subscriberId: uuid,
          view: z.enum(["upcoming", "history"]).default("upcoming"),
          before: uuid.optional(),
        })
        .strict()
        .parse(req.query);
    return db.tenant(a, async (tx) => {
      await lock(tx, a, q.subscriberId);
      await assertCoach(tx, a);
      if (!(await targetExists(tx, a, q.subscriberId)))
        throw fail(404, "Client unavailable");
      const cursor = q.before ? await record(tx, q.before) : undefined;
      if (
        cursor &&
        (cursor.owner_user_id !== q.subscriberId ||
          activeStates.includes(cursor.status))
      )
        throw fail(404, "History cursor unavailable");
      const rows =
        q.view === "upcoming"
          ? await tx.query(
              "SELECT r.*,u.name author_name FROM records r LEFT JOIN users u ON u.id=(r.data->>'authorUserId')::uuid WHERE r.kind='coaching_followup' AND r.owner_user_id=$1 AND r.status=ANY($2::text[]) ORDER BY (r.status='review_required') DESC,r.data->>'dueAt',r.id LIMIT 50",
              [q.subscriberId, activeStates],
            )
          : await tx.query(
              "SELECT r.*,u.name author_name FROM records r LEFT JOIN users u ON u.id=(r.data->>'authorUserId')::uuid WHERE r.kind='coaching_followup' AND r.owner_user_id=$1 AND NOT(r.status=ANY($2::text[])) AND ($3::timestamptz IS NULL OR (r.updated_at,r.id)<($3::timestamptz,$4::uuid)) ORDER BY r.updated_at DESC,r.id DESC LIMIT 26",
              [
                q.subscriberId,
                activeStates,
                cursor?.updated_at ?? null,
                cursor?.id ?? null,
              ],
            );
      return {
        records: rows.slice(0, q.view === "history" ? 25 : 50),
        nextCursor:
          q.view === "history" && rows.length > 25 ? rows[24].id : null,
      };
    });
  });
  app.post("/api/v1/coaching/followups", async (req) => {
    const a = coach(req),
      b = scheduleSchema
        .extend({ subscriberId: uuid, requestKey: uuid })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lock(tx, a, b.subscriberId);
      await assertCoach(tx, a);
      const fingerprint = hash({
        subscriberId: b.subscriberId,
        text: b.text,
        dueAt: new Date(b.dueAt).toISOString(),
        timezone: b.timezone,
      });
      const [prior] = await tx.query(
        "SELECT * FROM records WHERE kind='coaching_followup' AND data->>'creatorUserId'=$1 AND data->>'requestKey'=$2",
        [a.userId, b.requestKey],
      );
      if (prior) {
        if (prior.data.fingerprint !== fingerprint)
          throw fail(
            409,
            "This scheduling request was already used for different content",
          );
        return prior;
      }
      const schedule = normalizeSchedule(b, new Date()),
        c = await requireContext(tx, a, b.subscriberId);
      await capacity(tx, b.subscriberId);
      const row = await putRecord(
        tx,
        a,
        "coaching_followup",
        {
          ...schedule,
          subscriberId: b.subscriberId,
          creatorUserId: a.userId,
          authorUserId: a.userId,
          authorRole: a.role,
          authorUserIds: [a.userId],
          requestKey: b.requestKey,
          fingerprint,
          context: c.pinned,
          contextDigest: c.digest,
          reviewedAt: new Date().toISOString(),
        },
        { ownerId: b.subscriberId, status: "scheduled" },
      );
      await event(tx, a, "coaching.followup_scheduled", row.id, {
        subscriberId: b.subscriberId,
        dueAt: schedule.dueAt,
        revision: row.version,
      });
      return row;
    });
  });
  app.patch("/api/v1/coaching/followups/:id", async (req) => {
    const a = coach(req),
      key = uuid.parse((req.params as any).id),
      b = scheduleSchema
        .extend({ version: z.number().int().positive() })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      // Workspace first prevents erasure/closure from racing target discovery.
      await workspaceLock(tx, a.tenantId);
      const initial = await record(tx, key);
      await lock(tx, a, initial.owner_user_id);
      await assertCoach(tx, a);
      const r = await record(tx, key);
      if (a.role !== "owner" && r.data.authorUserId !== a.userId)
        throw fail(
          403,
          "Only the author or workspace owner can change this follow-up",
        );
      if (r.version !== b.version || !activeStates.includes(r.status))
        throw fail(409, "This follow-up has changed; refresh before editing");
      const schedule = normalizeSchedule(b, new Date()),
        c = await requireContext(tx, a, r.owner_user_id);
      const [updated] = await tx.query(
        "UPDATE records SET status='scheduled',version=version+1,data=(data-'reviewReason'-'reviewRequiredAt')||$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *",
        [
          key,
          JSON.stringify({
            ...schedule,
            authorUserId: a.userId,
            authorRole: a.role,
            authorUserIds: [
              ...new Set([
                ...(r.data.authorUserIds ?? [r.data.creatorUserId]),
                a.userId,
              ]),
            ],
            context: c.pinned,
            contextDigest: c.digest,
            reviewedAt: new Date().toISOString(),
          }),
        ],
      );
      await event(tx, a, "coaching.followup_rescheduled", key, {
        dueAt: schedule.dueAt,
        revision: updated.version,
      });
      return updated;
    });
  });
  app.post("/api/v1/coaching/followups/:id/cancel", async (req) => {
    const a = coach(req),
      key = uuid.parse((req.params as any).id),
      b = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await workspaceLock(tx, a.tenantId);
      const initial = await record(tx, key);
      await lock(tx, a, initial.owner_user_id);
      await assertCoach(tx, a);
      const r = await record(tx, key);
      if (a.role !== "owner" && r.data.authorUserId !== a.userId)
        throw fail(
          403,
          "Only the author or workspace owner can cancel this follow-up",
        );
      if (r.version !== b.version || !activeStates.includes(r.status))
        throw fail(409, "This follow-up has changed; refresh before canceling");
      const [updated] = await tx.query(
        "UPDATE records SET status='canceled',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *",
        [
          key,
          JSON.stringify({
            canceledAt: new Date().toISOString(),
            canceledBy: a.userId,
          }),
        ],
      );
      await event(tx, a, "coaching.followup_canceled", key, {
        revision: updated.version,
      });
      return updated;
    });
  });
}

/** One due row, one transaction: no network or model calls occur here. */
export async function deliverCoachingFollowup(
  db: Database,
  tenantId: string,
  key: string,
  now = new Date(),
) {
  return db.tenant(
    { tenantId, userId: "00000000-0000-0000-0000-000000000000", role: "owner" },
    async (tx) => {
      await workspaceLock(tx, tenantId);
      const [initial] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='coaching_followup'",
        [key],
      );
      if (
        !initial ||
        initial.status !== "scheduled" ||
        Date.parse(initial.data.dueAt) > now.getTime()
      )
        return "skipped";
      const a: Actor = {
        tenantId,
        userId: initial.data.authorUserId,
        role: initial.data.authorRole,
      };
      await lock(tx, a, initial.owner_user_id);
      await tx.query("SELECT set_config('app.user_id',$1,true)", [a.userId]);
      const r = await record(tx, key);
      const senderCurrent = await currentCoach(tx, a);
      const c = senderCurrent
        ? await context(tx, a, r.owner_user_id)
        : { reason: "The author's coaching permissions or workspace changed" };
      const reason =
        c.reason ??
        (c.digest !== r.data.contextDigest
          ? "The client's profile, instructions or reviewed safety context changed"
          : now.getTime() - Date.parse(r.data.dueAt) > 86400_000
            ? "The scheduled time was missed by more than a day"
            : undefined);
      if (reason) {
        await tx.query(
          "UPDATE records SET status='review_required',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1",
          [
            key,
            JSON.stringify({
              reviewReason: reason,
              reviewRequiredAt: now.toISOString(),
            }),
          ],
        );
        // A revoked author's job must not create new notifications in a closed workspace.
        if (senderCurrent)
          await notifyUser(tx, a, {
            userId: a.userId,
            category: "coaching",
            dedupeKey: `coaching-followup-review:${key}:${r.version}`,
            title: "A scheduled follow-up needs your review",
            body:
              reason +
              ". Review and reschedule it from the client's conversation.",
            href: "/trainer/messages",
            source: { type: "coaching_followup", id: key, phase: "review" },
          });
        await event(tx, a, "coaching.followup_review_required", key, {
          reason,
          revision: r.version + 1,
        });
        return "review_required";
      }
      const message = await putRecord(
        tx,
        a,
        "message",
        {
          text: r.data.text,
          author: "trainer",
          authorUserId: a.userId,
          subscriberId: r.owner_user_id,
          followupId: key,
          followupRevision: r.version,
          scheduled: true,
          scheduledFor: r.data.dueAt,
          timezone: r.data.timezone,
        },
        { ownerId: r.owner_user_id, status: "sent" },
      );
      await tx.query(
        "UPDATE records SET status='delivered',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [
          key,
          JSON.stringify({
            deliveredAt: now.toISOString(),
            messageId: message.id,
          }),
        ],
      );
      await notifyUser(tx, a, {
        userId: r.owner_user_id,
        category: "coaching",
        dedupeKey: `coaching-followup:${key}`,
        title: "Your coach sent a follow-up",
        body: "Open your coaching conversation to read the scheduled message from your trainer.",
        href: "/app/chat",
        source: { type: "coaching_followup", id: key, phase: "delivered" },
      });
      await event(tx, a, "coaching.followup_delivered", key, {
        messageId: message.id,
        revision: r.version,
      });
      return "delivered";
    },
  );
}
export async function processCoachingFollowups(
  db: Database,
  tenantId: string,
  now = new Date(),
) {
  const due = await db.tenant(
    { tenantId, userId: "00000000-0000-0000-0000-000000000000", role: "owner" },
    (tx) =>
      tx.query(
        "SELECT id FROM records WHERE kind='coaching_followup' AND status='scheduled' AND data->>'dueAt'<=$1 ORDER BY data->>'dueAt',id LIMIT 25",
        [now.toISOString()],
      ),
  );
  const counts = { delivered: 0, review_required: 0, skipped: 0 };
  for (const row of due)
    counts[await deliverCoachingFollowup(db, tenantId, row.id, now)]++;
  return counts;
}
export async function exportCoachingFollowups(tx: Tx, userId: string) {
  return tx.query(
    "SELECT * FROM records WHERE kind='coaching_followup' AND (owner_user_id=$1 OR data->>'creatorUserId'=$1::text OR data->>'authorUserId'=$1::text OR data->'authorUserIds' ? $1::text) ORDER BY created_at,id",
    [userId],
  );
}
export async function eraseCoachingFollowups(tx: Tx, userId?: string) {
  const rows = await tx.query(
    "SELECT id FROM records WHERE kind='coaching_followup' AND ($1::uuid IS NULL OR owner_user_id=$1 OR data->>'creatorUserId'=$1::text OR data->>'authorUserId'=$1::text OR data->'authorUserIds' ? $1::text)",
    [userId ?? null],
  );
  const ids = rows.map((r) => r.id);
  await tx.query(
    "DELETE FROM jobs WHERE data->>'notificationId' IN (SELECT id::text FROM notifications WHERE data->'source'->>'type'='coaching_followup' AND data->'source'->>'id'=ANY($1::text[]))",
    [ids],
  );
  await tx.query(
    "DELETE FROM notifications WHERE data->'source'->>'type'='coaching_followup' AND data->'source'->>'id'=ANY($1::text[])",
    [ids],
  );
  await tx.query(
    "DELETE FROM records WHERE (kind='coaching_followup' AND id=ANY($1::uuid[])) OR (kind='message' AND data->>'followupId'=ANY($1::text[]))",
    [ids],
  );
}
