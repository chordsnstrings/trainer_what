import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { currentPaidSubscription } from "./finance-billing.ts";
import { trainingAdherence } from "../../../packages/domain/src/client-twin.ts";
import { addTrainingDays } from "../../../packages/domain/src/coaching-completion.ts";
import {
  notifyUser,
  notificationPreferencesSchema,
  nextNotificationTime,
  type NotificationInput,
} from "./notifications.ts";
import { onboardingState } from "./onboarding.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";

const HOUR = 3_600_000;
const WINDOW = 7 * 24 * HOUR;
const LIMIT = 100;
const VERSION = 1;
const workoutPolicySchema = z
  .object({
    enabled: z.boolean(),
    missedAfterDays: z.number().int().min(1).max(7),
  })
  .strict();
const fail = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });
type Source = Record<string, any> & {
  type: "lifecycle";
  version: number;
  trigger: string;
  identity: string;
  expiresAt: string;
};
type Context = {
  tx: Tx;
  tenant: any;
  actor: Actor;
  members: any[];
  onboarding: () => Promise<Awaited<ReturnType<typeof onboardingState>>>;
};
const time = (value: unknown) =>
  value instanceof Date ? value.getTime() : Date.parse(String(value));
const key = (trigger: string, identity: string) =>
  `lifecycle:v${VERSION}:${trigger}:${identity}`;

// Existing notification/job privacy hooks own every persisted message. This
// scheduler stores no health, bank, provider credential or campaign profile data.
async function scoped<T>(
  db: Database,
  tenantId: string,
  fn: (c: Context) => Promise<T>,
): Promise<T | undefined> {
  return db.system(async (tx) => {
    await workspaceLock(tx, tenantId);
    const [tenant] = await tx.query("SELECT * FROM tenants WHERE id=$1", [
      tenantId,
    ]);
    if (!tenant || tenant.lifecycle_state !== "active") return;
    const members = await tx.query(
      "SELECT m.user_id,m.role,u.email_verified FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1",
      [tenantId],
    );
    const owner = members.find((m) => m.role === "owner");
    if (!owner) return;
    const keys = ["terms", "privacy", "ai-disclosure"];
    const documents = await tx.query(
      "SELECT DISTINCT ON (key) id,key,version,title,effective_at FROM admin_documents WHERE kind='legal' AND key=ANY($1::text[]) AND status='published' AND effective_at<=now() ORDER BY key,effective_at DESC,version DESC",
      [keys],
    );
    const actor = { tenantId, userId: owner.user_id, role: "owner" };
    await tx.query("SET LOCAL ROLE trainer_app");
    await tx.query(
      "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','owner',true)",
      [tenantId, owner.user_id],
    );
    let state: ReturnType<typeof onboardingState> | undefined;
    return fn({
      tx,
      tenant,
      actor,
      members,
      onboarding: () =>
        (state ??= onboardingState(
          tx,
          { ...actor, emailVerified: owner.email_verified },
          tenant,
          {
            approved: runtimeConfig().LEGAL_APPROVED === "true",
            documents: keys.map(
              (k) =>
                documents.find((d) => d.key === k) ?? {
                  key: k,
                  version: null,
                  title: k,
                },
            ),
          },
        )),
    });
  });
}

async function record(tx: Tx, id: string, kind: string, userId?: string) {
  const [r] = await tx.query(
    "SELECT * FROM records WHERE id=$1 AND kind=$2 AND ($3::uuid IS NULL OR owner_user_id=$3)",
    [id, kind, userId ?? null],
  );
  return r;
}
async function needsIntake(tx: Tx, userId: string) {
  return !(
    await tx.query(
      "SELECT id FROM records WHERE kind='intake' AND owner_user_id=$1 AND status='complete' LIMIT 1",
      [userId],
    )
  ).length;
}
async function noTrainingHold(tx: Tx, userId: string) {
  return !(
    await tx.query(
      "SELECT id FROM records WHERE owner_user_id=$1 AND ((kind='training_hold' AND status='active') OR (kind='workout' AND status='safety_hold')) LIMIT 1",
      [userId],
    )
  ).length;
}
async function paidMembers(tx: Tx) {
  const rows = await tx.query(
    "SELECT s.user_id FROM subscriptions s JOIN memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id WHERE m.role='subscriber' AND ((s.status IN ('active','trialing') AND (s.period_end IS NULL OR s.period_end>now())) OR (s.status='past_due' AND s.data->>'graceUntil' IS NOT NULL AND (s.data->>'graceUntil')::timestamptz>now())) AND EXISTS(SELECT 1 FROM journals j WHERE j.data->>'userId'=s.user_id::text AND j.source_key LIKE 'stripe-invoice:%' AND (j.data->>'grossMinor')::numeric>0) ORDER BY s.user_id LIMIT 25",
  );
  let count = 0;
  // Stop at the largest supported milestone. No estimated lifetime value or
  // wellbeing/coaching data enters this commercial trigger.
  for (const r of rows)
    if (await currentPaidSubscription(tx, r.user_id)) count++;
  return count;
}
async function pendingReviews(tx: Tx) {
  // Count the decision, not both it and its matching exception. Safety has its
  // own immediate alert and is never downgraded to a lifecycle reminder.
  const [r] = await tx.query(
    "SELECT count(*)::int count FROM records WHERE kind='decision' AND status='pending_review' AND coalesce(data->>'action','')<>'escalate' AND coalesce(data->>'category','')<>'safety'",
  );
  return r.count as number;
}
async function payoutNeedsInput(tx: Tx) {
  const [r] = await tx.query(
    "SELECT status FROM records WHERE kind='beneficiary' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  return !r || ["draft", "rejected", "failed"].includes(r.status);
}
async function blockSchedule(
  tx: Tx,
  userId: string,
  programId: string,
  now: Date,
) {
  const [program] = await tx.query(
    "SELECT * FROM records WHERE kind='program' AND status='assigned' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  if (!program || program.id !== programId) return null;
  const lineage = await tx.query(
    "WITH RECURSIVE lineage AS (SELECT r.*,ARRAY[r.id] path,1 depth FROM records r WHERE r.id=$1 AND r.owner_user_id=$2 AND r.kind='program' UNION ALL SELECT p.*,l.path||p.id,l.depth+1 FROM records p JOIN lineage l ON p.id::text=l.data->>'previousProgramId' WHERE p.owner_user_id=$2 AND p.kind='program' AND l.depth<64 AND NOT p.id=ANY(l.path)) SELECT * FROM lineage ORDER BY depth",
    [programId, userId],
  );
  const original = lineage.at(-1);
  if (!original || original.data.previousProgramId) return null;
  const [schedule] = await tx.query(
    "SELECT * FROM events WHERE name='program.scheduled' AND subject_id=$1 AND data->>'subscriberId'=$2 ORDER BY created_at LIMIT 1",
    [original.id, userId],
  );
  const expected = schedule?.data.sessions;
  if (!Number.isInteger(expected) || expected < 1 || expected > 182)
    return null;
  const plans = await tx.query(
    "SELECT * FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND data->>'programId'=ANY($2::text[]) ORDER BY id LIMIT 183",
    [userId, lineage.map((r) => r.id)],
  );
  if (plans.length !== expected) return null;
  const workouts = await tx.query(
    "SELECT * FROM records WHERE kind='workout' AND owner_user_id=$1 AND (id::text=ANY($2::text[]) OR data->>'plannedSessionId'=ANY($3::text[])) ORDER BY id LIMIT 2401",
    [
      userId,
      plans.map((r) => r.data.workoutId).filter(Boolean),
      plans.map((r) => r.id),
    ],
  );
  if (workouts.length > 2400) return null;
  const summary = trainingAdherence({
    plannedSessions: [],
    linkedWorkouts: workouts as any,
    currentBlock: {
      program: program as any,
      lineage: lineage as any,
      sessions: plans as any,
      expectedSessions: expected,
      complete: true,
    },
    now,
  }).currentBlock;
  if (!summary?.complete) return null;
  return { rootId: original.id, summary, plans };
}
async function blockEvidence(
  tx: Tx,
  userId: string,
  programId: string,
  now: Date,
) {
  const block = await blockSchedule(tx, userId, programId, now);
  if (
    !block ||
    block.summary.counts.completed !== block.summary.expectedSessions ||
    !block.summary.sessions.every(
      (r) =>
        r.completion?.completedAt &&
        Number.isFinite(time(r.completion.completedAt)),
    )
  )
    return null;
  const { summary } = block;
  const completedAt = Math.max(
    ...summary.sessions.map((r) => time(r.completion!.completedAt)),
  );
  return {
    rootId: block.rootId,
    count: summary.expectedSessions!,
    completedAt,
  };
}

async function workoutPolicy(tx: Tx) {
  const [r] = await tx.query(
    "SELECT * FROM records WHERE kind='workout_notification_policy' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  return {
    version: r?.version ?? 0,
    data: workoutPolicySchema.parse(
      r?.data ?? { enabled: false, missedAfterDays: 1 },
    ),
    id: r?.id,
  };
}
export function registerLifecycleMessages(app: FastifyInstance, db: Database) {
  const owner = (req: FastifyRequest) => {
    if (!req.identity) throw fail(401, "Please sign in");
    if (req.identity.role !== "owner")
      throw fail(
        403,
        "The current workspace owner must manage workout messages",
      );
    return req.identity;
  };
  const withOwner = async <T>(
    req: FastifyRequest,
    fn: (c: Context, a: Actor) => Promise<T>,
  ) => {
    const a = owner(req);
    const result = await scoped(db, a.tenantId, async (c) => {
      if (!c.members.some((m) => m.user_id === a.userId && m.role === "owner"))
        throw fail(403, "Current owner access required");
      return fn(c, a);
    });
    if (result === undefined) throw fail(409, "This workspace is unavailable");
    return result;
  };
  app.get("/api/v1/lifecycle/workout-policy", (req) =>
    withOwner(req, async ({ tx }) => {
      const { version, data } = await workoutPolicy(tx);
      return { version, data };
    }),
  );
  app.put("/api/v1/lifecycle/workout-policy", (req) =>
    withOwner(req, async ({ tx }, a) => {
      const b = z
        .object({ version: z.number().int().min(0), data: workoutPolicySchema })
        .strict()
        .parse(req.body);
      const prior = await workoutPolicy(tx);
      if (b.version !== prior.version)
        throw fail(
          409,
          "The workout message policy changed; reload before saving",
        );
      const [saved] = prior.id
        ? await tx.query(
            "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 AND version=$3 RETURNING id,version,data",
            [prior.id, JSON.stringify(b.data), b.version],
          )
        : [
            await putRecord(tx, a, "workout_notification_policy", b.data, {
              status: "active",
            }),
          ];
      if (!saved)
        throw fail(
          409,
          "The workout message policy changed; reload before saving",
        );
      await event(tx, a, "lifecycle.workout_policy_changed", saved.id, {
        version: saved.version,
      });
      return { version: saved.version, data: saved.data };
    }),
  );
}

async function current(
  c: Context,
  userId: string,
  s: Source,
  now: Date,
): Promise<boolean> {
  const { tx } = c;
  const member = c.members.find((m) => m.user_id === userId);
  if (
    !member ||
    s.type !== "lifecycle" ||
    s.version !== VERSION ||
    !Number.isFinite(time(s.expiresAt)) ||
    time(s.expiresAt) <= now.getTime()
  )
    return false;
  const trainerTrigger = [
    "onboarding",
    "interview",
    "payout-setup",
    "publish-ready",
    "paid-milestone",
    "review-queue",
    "payout-paid",
  ].includes(s.trigger);
  if (trainerTrigger ? member.role !== "owner" : member.role !== "subscriber")
    return false;
  if (
    ["onboarding", "interview", "payout-setup", "publish-ready"].includes(
      s.trigger,
    )
  ) {
    if (c.tenant.published) return false;
    const state = await c.onboarding();
    if (s.trigger === "publish-ready")
      return state.readyToPublish && state.previewDigest === s.digest;
    if (state.readyToPublish) return false;
    if (s.trigger === "onboarding") return state.resumeStep === s.step;
    if (s.trigger === "interview")
      return !["complete", "deferred"].includes(
        state.steps.find((step) => step.key === "interview")!.status,
      );
    return payoutNeedsInput(tx);
  }
  if (s.trigger === "paid-milestone")
    return (await paidMembers(tx)) >= s.milestone;
  if (s.trigger === "review-queue") return (await pendingReviews(tx)) >= 8;
  if (s.trigger === "intake") {
    const paid = await currentPaidSubscription(tx, userId);
    const [charge] = await tx.query(
      "SELECT id FROM journals WHERE id=$1 AND source_key LIKE 'stripe-invoice:%' AND data->>'userId'=$2 AND (data->>'grossMinor')::numeric>0",
      [s.chargeId, userId],
    );
    return (
      paid?.id === s.subscriptionId &&
      !!charge &&
      (await needsIntake(tx, userId))
    );
  }
  if (s.trigger === "program-ready") {
    const r = await record(tx, s.id, "program", userId);
    const [schedule] = await tx.query(
      "SELECT id FROM events WHERE id=$1 AND name='program.scheduled' AND subject_id=$2 AND data->>'subscriberId'=$3",
      [s.eventId, s.id, userId],
    );
    return (
      !!r &&
      r.status === "assigned" &&
      r.version === s.recordVersion &&
      !!schedule &&
      !!(await currentPaidSubscription(tx, userId)) &&
      (await noTrainingHold(tx, userId))
    );
  }
  if (s.trigger === "workout-complete") {
    const r = await record(tx, s.id, "workout", userId);
    const [e] = await tx.query(
      "SELECT id FROM events WHERE id=$1 AND name='workout.completed' AND subject_id=$2",
      [s.eventId, s.id],
    );
    return (
      !!e && r?.status === "completed" && r.data.completedAt === s.completedAt
    );
  }
  if (s.trigger === "block-complete") {
    const evidence = await blockEvidence(tx, userId, s.id, now);
    return (
      !!evidence &&
      evidence.rootId === s.identity &&
      evidence.count === s.count &&
      evidence.completedAt === s.completedAt &&
      (await noTrainingHold(tx, userId))
    );
  }
  if (s.trigger === "workout-missed") {
    const policy = await workoutPolicy(tx);
    if (
      !policy.data.enabled ||
      policy.version !== s.policyVersion ||
      !(await currentPaidSubscription(tx, userId)) ||
      !(await noTrainingHold(tx, userId))
    )
      return false;
    const [consent] = await tx.query(
      "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC,id DESC LIMIT 1",
      [userId],
    );
    if (consent?.granted !== true) return false;
    const [pref] = await tx.query(
      "SELECT data FROM notification_preferences WHERE user_id=$1",
      [userId],
    );
    const preferences = notificationPreferencesSchema.parse(pref?.data ?? {});
    if (
      !preferences.workouts ||
      nextNotificationTime(preferences, now).getTime() > now.getTime()
    )
      return false;
    const block = await blockSchedule(tx, userId, s.programId, now);
    const plan = block?.plans.find((p) => p.id === s.id);
    const session = block?.summary.sessions.find((p) => p.id === s.id);
    return (
      !!session &&
      plan?.version === s.recordVersion &&
      session.state === "missed" &&
      !!session.date &&
      session.date === s.date &&
      session.timezone === s.timezone &&
      !!session.today &&
      session.today >=
        addTrainingDays(session.date, policy.data.missedAfterDays)
    );
  }
  if (s.trigger === "wearable-attention") {
    const [r] = await tx.query(
      "SELECT status,version,updated_at FROM integration_connections WHERE id=$1 AND user_id=$2",
      [s.id, userId],
    );
    return (
      r?.status === "attention" &&
      r.version === s.recordVersion &&
      time(r.updated_at) <= now.getTime() - 24 * HOUR
    );
  }
  if (s.trigger === "payment-failed" || s.trigger === "cancel-scheduled") {
    const [sub] = await tx.query(
      "SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2",
      [s.id, userId],
    );
    const [e] = await tx.query(
      "SELECT * FROM events WHERE id=$1 AND actor_id=$2",
      [s.eventId, userId],
    );
    if (!sub || !e || sub.provider_id !== s.providerId) return false;
    if (s.trigger === "payment-failed") {
      const [invoice] = await tx.query(
        "SELECT id FROM records WHERE kind='billing_invoice' AND owner_user_id=$1 AND status='open' AND data->>'invoiceId'=$2 AND data->>'subscriptionId'=$3 AND data->>'providerEventId'=$4",
        [userId, e.subject_id, sub.provider_id, e.data.providerEventId ?? null],
      );
      return (
        !!invoice &&
        e.name === "payment.failed" &&
        !!e.data.providerEventId &&
        sub.status === "past_due" &&
        sub.data.pastDueSince === s.pastDueSince
      );
    }
    if (!sub.cancel_at_period_end || time(sub.period_end) !== time(s.periodEnd))
      return false;
    if (e.name === "subscription.updated")
      return e.subject_id === sub.provider_id && !!e.data.providerEventId;
    const transition =
      e.name === "subscription.cancel_scheduled"
        ? await record(tx, e.subject_id, "subscription_transition", userId)
        : null;
    return (
      transition?.status === "succeeded" &&
      transition.data.subscriptionId === sub.id &&
      transition.data.providerId === sub.provider_id &&
      transition.data.cancel === true
    );
  }
  if (s.trigger === "refund") {
    const r = await record(tx, s.id, "refund", userId);
    if (!r || r.status !== s.status) return false;
    const [charge] = await tx.query(
      "SELECT id FROM journals WHERE id=$1 AND source_key LIKE 'stripe-invoice:%' AND data->>'userId'=$2",
      [r.data.journalId, userId],
    );
    if (!charge) return false;
    if (["succeeded", "failed"].includes(s.status))
      return !!r.data.providerRefundId && r.data.providerStatus === s.status;
    return ["requested", "declined", "submitted", "unknown"].includes(s.status);
  }
  if (s.trigger === "payout-paid") {
    const [p] = await tx.query(
      "SELECT p.id FROM payouts p JOIN journals j ON j.source_key='payout:'||p.id::text WHERE p.id=$1 AND p.status='paid' AND p.bank_reference IS NOT NULL",
      [s.id],
    );
    return !!p;
  }
  return false;
}

/** Recheck outside the notification preference transaction (PGlite serializes
 * transactions). A tenant closure, erasure, recovery or changed source cancels
 * an obsolete email rather than generating an updated provider request. */
export async function lifecycleMessageCurrent(
  db: Database,
  tenantId: string,
  userId: string,
  source: unknown,
  now = new Date(),
): Promise<boolean> {
  if (!source || typeof source !== "object") return false;
  return (
    (await scoped(db, tenantId, (c) =>
      current(c, userId, source as Source, now),
    )) ?? false
  );
}

/** One bounded pass; unique notification intents also serialize concurrent
 * worker retries. Old events are not replayed as a campaign when this starts. */
export async function scheduleLifecycleMessages(
  db: Database,
  tenantId: string,
  now = new Date(),
): Promise<number> {
  return (
    (await scoped(db, tenantId, async (c) => {
      const { tx, actor, tenant } = c;
      let created = 0;
      const emit = async (
        trigger: string,
        identity: string,
        userId: string,
        input: Pick<
          NotificationInput,
          "title" | "body" | "href" | "category" | "email"
        >,
        evidence: Record<string, unknown> = {},
        expiresAt = new Date(now.getTime() + 48 * HOUR),
      ) => {
        const source: Source = {
          ...evidence,
          type: "lifecycle",
          version: VERSION,
          trigger,
          identity,
          expiresAt: expiresAt.toISOString(),
        };
        if (!(await current(c, userId, source, now))) return;
        if (
          await notifyUser(tx, actor, {
            ...input,
            userId,
            dedupeKey: key(trigger, identity),
            templateKey: `lifecycle-${trigger}-v${VERSION}`,
            source,
          })
        )
          created++;
      };
      const since = new Date(now.getTime() - WINDOW).toISOString();
      if (!tenant.published) {
        const state = await c.onboarding();
        const age = now.getTime() - time(tenant.created_at);
        if (state.readyToPublish) {
          await emit(
            "publish-ready",
            state.previewDigest,
            actor.userId,
            {
              category: "coaching",
              title: "Your coaching space is ready to publish",
              body: "Your current setup passes the launch checks. Review your preview and publish when you are ready.",
              href: "/trainer/onboarding/publish",
            },
            { digest: state.previewDigest },
          );
        } else {
          if (age >= HOUR / 4)
            await emit(
              "onboarding",
              age >= 24 * HOUR ? "24h" : "15m",
              actor.userId,
              {
                category: "coaching",
                title: "Continue setting up your coaching space",
                body: "Your saved setup is ready to continue. Open the next required step.",
                href: `/trainer/onboarding/${state.resumeStep}`,
              },
              { step: state.resumeStep },
            );
          if (age >= 24 * HOUR)
            await emit("interview", "24h", actor.userId, {
              category: "coaching",
              title: "Continue your coaching interview",
              body: "Your saved answers are available. Add the recommendations, reasons and limits you use in your coaching.",
              href: "/trainer/brain/teaching",
            });
          await emit(
            "payout-setup",
            age >= 48 * HOUR ? "48h" : "initial",
            actor.userId,
            {
              category: "coaching",
              title: "Complete your payout setup",
              body: "Review your UAE payout account setup and its current status. You can continue setting up your coaching space while this is pending.",
              href: "/trainer/onboarding/payout",
            },
          );
        }
      }
      const count = await paidMembers(tx);
      const milestone = [25, 10, 5, 1].find((n) => count >= n);
      const [priorMilestone] = await tx.query(
        "SELECT coalesce(max((data->'source'->>'milestone')::int),0) milestone FROM notifications WHERE user_id=$1 AND data->'source'->>'type'='lifecycle' AND data->'source'->>'trigger'='paid-milestone'",
        [actor.userId],
      );
      if (milestone && milestone > priorMilestone.milestone)
        await emit(
          "paid-milestone",
          String(milestone),
          actor.userId,
          {
            category: "coaching",
            title:
              milestone === 1
                ? "Your first paid member is here"
                : `You have reached ${milestone} paid members`,
            body: "Confirmed subscription payments and current membership access support this milestone. Your ledger shows the payment and payout details.",
            href: "/trainer/finance",
          },
          { milestone },
        );
      if ((await pendingReviews(tx)) >= 8)
        await emit(
          "review-queue",
          now.toISOString().slice(0, 10),
          actor.userId,
          {
            category: "coaching",
            title: "Your coaching review queue needs attention",
            body: "Several coaching decisions are awaiting your review. Open the queue to review their current priority and status.",
            href: "/trainer/exceptions",
          },
        );

      const paid = await tx.query(
        "SELECT s.id,s.user_id,j.id charge_id,j.created_at FROM subscriptions s JOIN LATERAL (SELECT id,created_at FROM journals WHERE source_key LIKE 'stripe-invoice:%' AND data->>'userId'=s.user_id::text AND (data->>'grossMinor')::numeric>0 ORDER BY created_at,id LIMIT 1) j ON true WHERE j.created_at>=$1 AND NOT EXISTS(SELECT 1 FROM records r WHERE r.kind='intake' AND r.owner_user_id=s.user_id AND r.status='complete') ORDER BY j.created_at LIMIT $2",
        [since, LIMIT],
      );
      for (const p of paid) {
        const phase =
          now.getTime() - time(p.created_at) >= 24 * HOUR ? "24h" : "initial";
        await emit(
          "intake",
          `${p.id}:${phase}`,
          p.user_id,
          {
            category: "coaching",
            title: "Complete your coaching intake",
            body: "Your payment is recorded. Complete your intake so your coach has the information needed to prepare your program.",
            href: "/app/intake",
          },
          { subscriptionId: p.id, chargeId: p.charge_id },
        );
      }
      const programs = await tx.query(
        "SELECT p.id,p.owner_user_id,p.version,e.id event_id FROM records p JOIN events e ON e.name='program.scheduled' AND e.subject_id=p.id::text WHERE p.kind='program' AND p.status='assigned' AND e.created_at>=$1 AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.user_id=p.owner_user_id AND n.dedupe_key=$2||p.id::text) ORDER BY e.created_at LIMIT $3",
        [since, key("program-ready", ""), LIMIT],
      );
      for (const p of programs)
        await emit(
          "program-ready",
          p.id,
          p.owner_user_id,
          {
            category: "workout",
            title: "Your program is ready",
            body: "Your assigned program and training schedule are available. Open your program to review the plan and start a session when you are ready.",
            href: "/app/program",
          },
          { id: p.id, recordVersion: p.version, eventId: p.event_id },
        );
      const workouts = await tx.query(
        "SELECT w.id,w.owner_user_id,w.data,e.id event_id FROM records w JOIN events e ON e.name='workout.completed' AND e.subject_id=w.id::text WHERE w.kind='workout' AND w.status='completed' AND e.created_at>=$1 AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.user_id=w.owner_user_id AND n.dedupe_key=$2||w.id::text) ORDER BY e.created_at LIMIT $3",
        [since, key("workout-complete", ""), LIMIT],
      );
      for (const w of workouts)
        if (w.data.completedAt)
          await emit(
            "workout-complete",
            w.id,
            w.owner_user_id,
            {
              category: "workout",
              email: false,
              title: "Your completed workout is saved",
              body: "Your session is recorded. Review it and your next planned training in the app.",
              href: "/app/program",
            },
            { id: w.id, eventId: w.event_id, completedAt: w.data.completedAt },
          );
      const blocks = await tx.query(
        "SELECT DISTINCT ON (p.owner_user_id) p.id,p.owner_user_id FROM records p WHERE p.kind='program' AND p.status='assigned' AND EXISTS(SELECT 1 FROM records w WHERE w.kind='workout' AND w.owner_user_id=p.owner_user_id AND w.status='completed' AND w.updated_at>=$1) ORDER BY p.owner_user_id,p.created_at DESC,p.id DESC LIMIT $2",
        [since, LIMIT],
      );
      for (const p of blocks) {
        const evidence = await blockEvidence(tx, p.owner_user_id, p.id, now);
        if (evidence && evidence.completedAt >= now.getTime() - WINDOW)
          await emit(
            "block-complete",
            evidence.rootId,
            p.owner_user_id,
            {
              category: "workout",
              title: "Your training block is complete",
              body: `All ${evidence.count} planned sessions have recorded completions. Open your coaching context to review the schedule evidence and discuss your next block.`,
              href: "/app/twin",
            },
            {
              id: p.id,
              count: evidence.count,
              completedAt: evidence.completedAt,
            },
          );
      }
      const policy = await workoutPolicy(tx);
      if (policy.data.enabled) {
        // Calendar dates are evaluated by trainingAdherence in each session's
        // timezone. The SQL window only bounds the candidate scan.
        const plans = await tx.query(
          "SELECT p.id,p.owner_user_id,p.version,p.data,(SELECT r.id FROM records r WHERE r.kind='program' AND r.status='assigned' AND r.owner_user_id=p.owner_user_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) current_program_id FROM records p WHERE p.kind='planned_session' AND p.status='planned' AND p.data->>'date' BETWEEN $1 AND $2 AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.user_id=p.owner_user_id AND n.dedupe_key=$3||p.id::text||':'||(p.data->>'date')) ORDER BY p.data->>'date',p.id LIMIT $4",
          [
            new Date(now.getTime() - 30 * 24 * HOUR).toISOString().slice(0, 10),
            now.toISOString().slice(0, 10),
            key("workout-missed", ""),
            LIMIT,
          ],
        );
        for (const p of plans)
          if (p.current_program_id)
            await emit(
              "workout-missed",
              `${p.id}:${p.data.date}`,
              p.owner_user_id,
              {
                category: "workout",
                email: false,
                title: "Review a past planned session",
                body: "A planned training date has passed without a recorded completion. Open your program to review the session and reschedule if needed.",
                href: "/app/program",
              },
              {
                id: p.id,
                programId: p.current_program_id,
                recordVersion: p.version,
                date: p.data.date,
                timezone: p.data.timezone,
                policyVersion: policy.version,
              },
            );
      }
      const connections = await tx.query(
        "SELECT id,user_id,version FROM integration_connections WHERE status='attention' AND updated_at<=$1 AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.user_id=integration_connections.user_id AND n.dedupe_key=$2||integration_connections.id::text||':'||integration_connections.version::text) ORDER BY updated_at LIMIT $3",
        [
          new Date(now.getTime() - 24 * HOUR).toISOString(),
          key("wearable-attention", ""),
          LIMIT,
        ],
      );
      for (const p of connections)
        await emit(
          "wearable-attention",
          `${p.id}:${p.version}`,
          p.user_id,
          {
            category: "coaching",
            title: "Your wearable connection needs attention",
            body: "Your wearable connection has an unresolved synchronization issue. Open integrations to review its status and reconnect.",
            href: "/app/wearables",
          },
          { id: p.id, recordVersion: p.version },
        );

      const billing = await tx.query(
        "SELECT e.*,s.id subscription_id,s.provider_id,s.period_end,s.data subscription_data,s.cancel_at_period_end,s.status subscription_status FROM events e JOIN subscriptions s ON s.user_id=e.actor_id WHERE e.name IN ('payment.failed','subscription.cancel_scheduled','subscription.updated') AND e.created_at>=$1 ORDER BY e.created_at DESC LIMIT $2",
        [since, LIMIT],
      );
      for (const e of billing) {
        if (e.name === "payment.failed") {
          await emit(
            "payment-failed",
            `${e.subscription_id}:${e.subscription_data.pastDueSince}`,
            e.actor_id,
            {
              category: "account",
              title: "Your subscription payment needs attention",
              body: "A subscription payment failed. Open your membership to review payment recovery, current access and any applicable grace period.",
              href: "/app/membership",
            },
            {
              id: e.subscription_id,
              eventId: e.id,
              providerId: e.provider_id,
              pastDueSince: e.subscription_data.pastDueSince,
            },
          );
        } else if (e.cancel_at_period_end && e.period_end) {
          // A subscription update must reference this current provider membership;
          // a direct cancellation event must reference its confirmed transition.
          const transition =
            e.name === "subscription.cancel_scheduled"
              ? await record(
                  tx,
                  e.subject_id,
                  "subscription_transition",
                  e.actor_id,
                )
              : null;
          if (
            e.name === "subscription.updated"
              ? e.subject_id !== e.provider_id
              : transition?.status !== "succeeded" ||
                transition.data.subscriptionId !== e.subscription_id
          )
            continue;
          await emit(
            "cancel-scheduled",
            `${e.subscription_id}:${new Date(e.period_end).toISOString()}`,
            e.actor_id,
            {
              category: "account",
              email: false,
              title: "Your subscription cancellation is confirmed",
              body: "Renewal is scheduled to stop at the end of your current billing period. Your membership shows the confirmed final access date.",
              href: "/app/membership",
            },
            {
              id: e.subscription_id,
              eventId: e.id,
              providerId: e.provider_id,
              periodEnd: new Date(e.period_end).toISOString(),
            },
          );
        }
      }
      const refunds = await tx.query(
        "SELECT id,owner_user_id,status FROM records WHERE kind='refund' AND status IN ('requested','declined','submitted','unknown','succeeded','failed') AND updated_at>=$1 AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.user_id=records.owner_user_id AND n.dedupe_key=$2||records.id::text||':'||records.status) ORDER BY updated_at LIMIT $3",
        [since, key("refund", ""), LIMIT],
      );
      const refundCopy: Record<string, string> = {
        requested: "Your refund request is awaiting review.",
        declined:
          "Your refund request was declined. The recorded decision is available in your membership.",
        submitted:
          "Your approved refund request has been submitted. Payment-provider confirmation is still pending.",
        unknown:
          "Your refund request is awaiting payment-provider reconciliation. Its outcome is not yet confirmed.",
        succeeded: "The payment provider has confirmed your refund.",
        failed:
          "The payment provider reported that your refund failed. Your membership shows its current status.",
      };
      for (const r of refunds)
        await emit(
          "refund",
          `${r.id}:${r.status}`,
          r.owner_user_id,
          {
            category: "account",
            title: "Your refund request has an update",
            body:
              refundCopy[r.status] +
              " Open your membership for the request and charge details.",
            href: "/app/membership",
          },
          { id: r.id, status: r.status },
        );
      const payouts = await tx.query(
        "SELECT p.id FROM payouts p JOIN journals j ON j.source_key='payout:'||p.id::text WHERE p.status='paid' AND p.bank_reference IS NOT NULL AND p.updated_at>=$1 AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.user_id=$2 AND n.dedupe_key=$3||p.id::text) ORDER BY p.updated_at LIMIT $4",
        [since, actor.userId, key("payout-paid", ""), LIMIT],
      );
      for (const p of payouts)
        await emit(
          "payout-paid",
          p.id,
          actor.userId,
          {
            category: "account",
            title: "Your payout is confirmed",
            body: "Your payout has a confirmed bank reference. Open finance to review its ledger details and statement.",
            href: "/trainer/finance",
          },
          { id: p.id },
        );
      return created;
    })) ?? 0
  );
}
