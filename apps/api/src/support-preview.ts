import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Database, Tx } from "@trainer/db";
import { tokenHash } from "./auth.ts";
import { requireRecentMfa } from "./security.ts";
import { notificationPreferencesSchema } from "./notifications.ts";

type Operator = Actor & { platformRole: string; mfaAt?: string | null };
const scopes = [
  "account",
  "access",
  "connections",
  "notification_settings",
  "training_schedule",
  "nutrition_schedule",
] as const;
type Scope = (typeof scopes)[number];
type Grant = {
  id: string;
  operator_id: string;
  session_id: string;
  tenant_id: string;
  target_user_id: string;
  target_role: string;
  membership_version: number;
  case_id: string;
  request_key: string;
  fingerprint: string;
  reason: string;
  scopes: Scope[];
  status: "active" | "revoked" | "expired";
  revision: number;
  created_at: string;
  expires_at: string;
  ended_at: string | null;
  end_reason: string | null;
};
const correctionChanges = z
  .object({
    bookings: z.boolean().optional(),
    workouts: z.boolean().optional(),
    quietStart: z.number().int().min(0).max(1439).optional(),
    quietEnd: z.number().int().min(0).max(1439).optional(),
    timezone: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Use a valid time zone")
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Choose a correction");
type Elevation = {
  id: string;
  grant_id: string;
  request_key: string;
  fingerprint: string;
  action: "notification_preferences";
  reason: string;
  expected_version: number;
  changes: z.infer<typeof correctionChanges>;
  status: "active" | "applied" | "revoked" | "expired";
  revision: number;
  created_at: string;
  expires_at: string;
  result_version: number | null;
};
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const unavailable = () =>
  fail(
    410,
    "SUPPORT_PREVIEW_ENDED",
    "This support preview has ended. Return to the case to request a new preview.",
  );
const id = z.string().uuid();
const input = z
  .object({
    tenantId: id,
    caseId: id,
    caseRevision: z.number().int().min(1),
    requestKey: id,
    reason: z.string().trim().min(10).max(500),
    minutes: z.number().int().min(1).max(15).default(15),
    scopes: z
      .array(z.enum(scopes))
      .min(1)
      .max(6)
      .refine((v) => new Set(v).size === v.length, "Choose each scope once")
      .default(["account", "access", "connections"]),
  })
  .strict();
const publicGrant = (g: Grant) => ({
  id: g.id,
  caseId: g.case_id,
  tenantId: g.tenant_id,
  targetUserId: g.target_user_id,
  reason: g.reason,
  scopes: g.scopes,
  mode: "read_only" as const,
  status: g.status,
  revision: g.revision,
  createdAt: g.created_at,
  expiresAt: g.expires_at,
  endedAt: g.ended_at,
});
const publicElevation = (e: Elevation) => ({
  id: e.id,
  action: e.action,
  reason: e.reason,
  changes: e.changes,
  expectedVersion: e.expected_version,
  status: e.status,
  revision: e.revision,
  createdAt: e.created_at,
  expiresAt: e.expires_at,
  resultVersion: e.result_version,
});
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const elevationEnded = () =>
  fail(
    410,
    "SUPPORT_CORRECTION_ENDED",
    "This correction approval has ended. Review current settings and request a new correction.",
  );
async function audit(
  tx: Tx,
  a: Operator,
  g: Grant,
  action: string,
  data: Record<string, unknown> = {},
) {
  await tx.query(
    "INSERT INTO admin_operations_audit(id,actor_id,action,tenant_id,subject_id,data) VALUES($1,$2,$3,$4,$5,$6)",
    [
      randomUUID(),
      a.userId,
      "support.preview." + action,
      g.tenant_id,
      g.target_user_id,
      JSON.stringify({
        grantId: g.id,
        caseId: g.case_id,
        scopes: g.scopes,
        mode: action.startsWith("correction_") ? "single_action" : "read_only",
        ...data,
      }),
    ],
  );
}
async function scoped<T>(tx: Tx, a: Actor, fn: () => Promise<T>) {
  await tx.query("SET LOCAL ROLE trainer_app");
  await tx.query(
    "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role',$3,true)",
    [a.tenantId, a.userId, a.role],
  );
  const result = await fn();
  await tx.query("RESET ROLE");
  return result;
}
async function operator(
  tx: Tx,
  req: FastifyRequest,
  a: Operator,
  reading = true,
) {
  if (req.hostContext?.custom)
    throw fail(
      403,
      "PLATFORM_HOST_REQUIRED",
      "Support previews use the platform address.",
    );
  const token = req.cookies.session;
  if (!token) throw fail(401, "AUTH_REQUIRED", "Please sign in again.");
  const [session] = await tx.query(
    "SELECT s.session_id,s.expires_at,s.mfa_at,u.platform_role,u.name FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id JOIN tenants t ON t.id=s.tenant_id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.tenant_id=$3 AND s.expires_at>clock_timestamp() AND t.lifecycle_state='active'",
    [tokenHash(token), a.userId, a.tenantId],
  );
  if (!session)
    throw fail(401, "AUTH_REQUIRED", "This sign-in session has ended.");
  if (reading) {
    if (!["admin", "support"].includes(session.platform_role))
      throw fail(
        403,
        "OPERATOR_SCOPE",
        "Only support and platform administrators can start or read a support preview.",
      );
    requireRecentMfa({ mfaAt: session.mfa_at }, true);
  }
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    "support-preview:" + session.session_id,
  ]);
  return session;
}
async function context(tx: Tx, a: Operator, tenantId: string, caseId: string) {
  // Uses the same first lock as workspace closure and team membership changes.
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":workspace",
  ]);
  const [workspace] = await tx.query(
    "SELECT id,name,slug,published,lifecycle_state FROM tenants WHERE id=$1",
    [tenantId],
  );
  if (!workspace || workspace.lifecycle_state !== "active") return null;
  const [support] = await scoped(tx, { ...a, tenantId, role: "owner" }, () =>
    tx.query(
      "SELECT id,owner_user_id,status,version,data->>'category' AS category FROM records WHERE id=$1 AND kind='support' FOR SHARE",
      [caseId],
    ),
  );
  if (!support || support.status !== "open" || !support.owner_user_id)
    return null;
  const [target] = await tx.query(
    "SELECT m.user_id AS id,m.role,m.version,u.name,u.email_verified FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2",
    [tenantId, support.owner_user_id],
  );
  if (!target || !["owner", "staff", "subscriber"].includes(target.role))
    return null;
  return { workspace, support, target };
}
async function end(tx: Tx, a: Operator, g: Grant, reason: string) {
  if (g.status !== "active") return g;
  const [updated] = await tx.query<Grant>(
    "UPDATE support_preview_grants SET status=CASE WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'revoked' END,revision=revision+1,ended_at=clock_timestamp(),end_reason=$2 WHERE id=$1 AND status='active' RETURNING *",
    [g.id, reason],
  );
  if (!updated) return g;
  for (const e of await tx.query<Elevation>(
    "SELECT * FROM support_preview_elevations WHERE grant_id=$1 AND status='active' FOR UPDATE",
    [g.id],
  ))
    await endElevation(tx, a, updated, e, "preview_ended");
  await audit(
    tx,
    a,
    updated,
    updated.status === "expired" ? "expired" : "ended",
    { reason },
  );
  return updated;
}
async function expired(tx: Tx, g: { expires_at: string }) {
  const [r] = await tx.query(
    "SELECT $1::timestamptz<=clock_timestamp() AS expired",
    [g.expires_at],
  );
  return r.expired === true;
}
async function endElevation(
  tx: Tx,
  a: Operator,
  g: Grant,
  e: Elevation,
  reason: string,
) {
  const [updated] = await tx.query<Elevation>(
    "UPDATE support_preview_elevations SET status=CASE WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'revoked' END,revision=revision+1,ended_at=clock_timestamp(),end_reason=$2 WHERE id=$1 AND status='active' RETURNING *",
    [e.id, reason],
  );
  if (updated)
    await audit(tx, a, g, "correction_" + updated.status, {
      elevationId: e.id,
      action: e.action,
      reason,
    });
  return updated ?? e;
}
async function liveGrant(
  tx: Tx,
  req: FastifyRequest,
  a: Operator,
  grantId: string,
) {
  const session = await operator(tx, req, a);
  const [g] = await tx.query<Grant>(
    "SELECT * FROM support_preview_grants WHERE id=$1 AND operator_id=$2 AND session_id=$3 FOR UPDATE",
    [grantId, a.userId, session.session_id],
  );
  if (!g)
    throw fail(
      404,
      "SUPPORT_PREVIEW_UNAVAILABLE",
      "This preview is unavailable in this sign-in session.",
    );
  if (g.status !== "active") return { error: unavailable() };
  if (await expired(tx, g)) {
    await end(tx, a, g, "expired");
    return { error: unavailable() };
  }
  const c = await context(tx, a, g.tenant_id, g.case_id);
  if (
    !c ||
    c.target.id !== g.target_user_id ||
    c.target.role !== g.target_role ||
    c.target.version !== g.membership_version
  ) {
    await end(tx, a, g, "context_changed");
    return { error: unavailable() };
  }
  return { session, g, c };
}
async function preferences(tx: Tx, g: Grant) {
  const [row] = await tx.query(
    "SELECT data,version FROM notification_preferences WHERE user_id=$1",
    [g.target_user_id],
  );
  const p = notificationPreferencesSchema.parse(row?.data ?? {});
  return {
    version: row?.version ?? 0,
    data: {
      email: p.email,
      bookings: p.bookings,
      workouts: p.workouts,
      quietStart: p.quietStart,
      quietEnd: p.quietEnd,
      timezone: p.timezone,
    },
  };
}
async function healthAllowed(tx: Tx, g: Grant, type: string) {
  if (g.target_role !== "subscriber") return false;
  const [c] = await tx.query(
    "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
    [g.target_user_id, type],
  );
  return c?.granted === true;
}
async function project(
  tx: Tx,
  a: Operator,
  g: Grant,
  c: NonNullable<Awaited<ReturnType<typeof context>>>,
  operatorName: string,
) {
  const projection: Record<string, unknown> = {};
  if (g.scopes.includes("account"))
    projection.account = {
      emailVerified: c.target.email_verified,
      role: c.target.role,
    };
  await scoped(
    tx,
    { tenantId: g.tenant_id, userId: g.target_user_id, role: g.target_role },
    async () => {
      if (g.scopes.includes("access")) {
        const [subscription] = await tx.query(
          "SELECT status,period_end,cancel_at_period_end FROM subscriptions WHERE user_id=$1 ORDER BY period_end DESC NULLS LAST LIMIT 1",
          [g.target_user_id],
        );
        const status = subscription?.status ?? "none";
        projection.access = {
          workspaceMembership: "active",
          subscriptionStatus: [
            "active",
            "trialing",
            "past_due",
            "unpaid",
            "canceled",
            "incomplete",
            "incomplete_expired",
            "paused",
            "none",
          ].includes(status)
            ? status
            : "unknown",
          accessUntil: subscription?.period_end ?? null,
          renewalCancelled: subscription?.cancel_at_period_end ?? false,
        };
      }
      if (g.scopes.includes("connections"))
        projection.connections = await tx.query(
          "SELECT CASE WHEN data->>'provider' IN ('whoop','zepp','apple_health','manual_import') THEN data->>'provider' ELSE 'other' END AS provider,CASE WHEN status IN ('active','connected','disconnected','revoked','stale','failed','pending','imported') THEN status ELSE 'unknown' END AS status,updated_at FROM records WHERE owner_user_id=$1 AND kind IN ('wearable','wearable_connection') ORDER BY updated_at DESC LIMIT 20",
          [g.target_user_id],
        );
      if (g.scopes.includes("notification_settings"))
        projection.notificationSettings = await preferences(tx, g);
      if (g.scopes.includes("training_schedule")) {
        const allowed = await healthAllowed(tx, g, "coaching");
        const sessions = allowed
          ? await tx.query(
              "SELECT id,version,CASE WHEN status IN ('planned','started','completed','canceled','missed') THEN status ELSE 'unknown' END AS status,left(data->>'date',10) AS date,left(data->>'label',160) AS label,left(data->>'timezone',80) AS timezone,CASE WHEN jsonb_typeof(data->'program'->'exercises')='array' THEN jsonb_array_length(data->'program'->'exercises') ELSE 0 END AS exercise_count FROM records WHERE owner_user_id=$1 AND kind='planned_session' AND data->>'date' BETWEEN (current_date-7)::text AND (current_date+28)::text ORDER BY data->>'date',id LIMIT 41",
              [g.target_user_id],
            )
          : [];
        projection.trainingSchedule = {
          state: allowed ? "available" : "permission_required",
          sessions: sessions.slice(0, 40),
          partial: sessions.length > 40,
          window: "Previous 7 days and next 28 days",
        };
      }
      if (g.scopes.includes("nutrition_schedule")) {
        const allowed = await healthAllowed(tx, g, "nutrition");
        // Project individual display fields in SQL; raw plan/profile/diary data
        // never enters the support response or audit trail.
        const meals = allowed
          ? await tx.query(
              `WITH plans AS (SELECT id,version,data->'view'->'days' AS days FROM records WHERE owner_user_id=$1 AND kind='nutrition_plan' AND status='delivered' AND data->>'weekStart' BETWEEN (current_date-7)::text AND (current_date+7)::text ORDER BY data->>'weekStart' DESC,created_at DESC,id DESC LIMIT 2)
           SELECT p.id AS plan_id,p.version,left(d.item->>'date',10) AS date,left(m.item->>'slot',80) AS slot,left(m.item->>'name',160) AS name,CASE WHEN jsonb_typeof(m.item->'servings')='number' THEN m.item->'servings' ELSE NULL END AS servings
           FROM plans p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.days)='array' THEN p.days ELSE '[]'::jsonb END) WITH ORDINALITY AS d(item,n)
           CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.item->'meals')='array' THEN d.item->'meals' ELSE '[]'::jsonb END) WITH ORDINALITY AS m(item,n)
           WHERE d.n<=7 AND m.n<=6 AND d.item->>'date' BETWEEN (current_date-7)::text AND (current_date+14)::text ORDER BY date,p.id,m.n LIMIT 84`,
              [g.target_user_id],
            )
          : [];
        projection.nutritionSchedule = {
          state: allowed ? "available" : "permission_required",
          meals,
          window: "Up to two delivered weeks around today",
        };
      }
    },
  );
  let pending: Elevation | undefined;
  for (const e of await tx.query<Elevation>(
    "SELECT * FROM support_preview_elevations WHERE grant_id=$1 AND status='active' FOR UPDATE",
    [g.id],
  )) {
    if (await expired(tx, e)) await endElevation(tx, a, g, e, "expired");
    else pending = e;
  }
  await audit(tx, a, g, "read");
  const [clock] = await tx.query("SELECT clock_timestamp() AS now");
  return {
    grant: publicGrant(g),
    serverTime: clock.now,
    operator: { id: a.userId, name: operatorName },
    workspace: {
      id: c.workspace.id,
      name: c.workspace.name,
      slug: c.workspace.slug,
      published: c.workspace.published,
    },
    target: { id: c.target.id, name: c.target.name, role: c.target.role },
    case: {
      id: c.support.id,
      category: [
        "account",
        "billing",
        "coaching",
        "technical",
        "privacy",
      ].includes(c.support.category)
        ? c.support.category
        : "other",
    },
    projection,
    elevation: pending ? publicElevation(pending) : null,
    limitations:
      "Only selected customer-screen fields are shown. Training and meal schedules require explicit scopes and current processing permission. Conversations, measurements, diagnoses, payment details, private uploads and credentials are excluded. Changes require a separate, single-use approval for booking/workout reminders or quiet hours; other customer actions are unavailable.",
  };
}
export function registerSupportPreview(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Operator,
) {
  const route = "/api/v1/admin/support-previews";
  const rate = { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } };
  app.post(route, rate, async (req, reply) => {
    const a = identity(req),
      b = input.parse(req.body);
    b.scopes.sort();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(b))
      .digest("hex");
    const result = await db.system(async (tx) => {
      const session = await operator(tx, req, a);
      const c = await context(tx, a, b.tenantId, b.caseId);
      if (!c)
        throw fail(
          404,
          "SUPPORT_CASE_UNAVAILABLE",
          "Choose an open support case belonging to an active workspace member.",
        );
      if (c.support.version !== b.caseRevision)
        throw fail(
          409,
          "REVISION_CONFLICT",
          "The support case changed. Reload before opening a preview.",
        );
      const [prior] = await tx.query<Grant>(
        "SELECT * FROM support_preview_grants WHERE operator_id=$1 AND session_id=$2 AND request_key=$3 FOR UPDATE",
        [a.userId, session.session_id, b.requestKey],
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw fail(
            409,
            "INTENT_CONFLICT",
            "This preview request was already used with different details.",
          );
        if (prior.status !== "active") return { error: unavailable() };
        if (await expired(tx, prior)) {
          await end(tx, a, prior, "expired");
          return { error: unavailable() };
        }
        if (
          prior.target_user_id !== c.target.id ||
          prior.target_role !== c.target.role ||
          prior.membership_version !== c.target.version
        ) {
          await end(tx, a, prior, "target_changed");
          return { error: unavailable() };
        }
        return { grant: publicGrant(prior) };
      }
      for (const old of await tx.query<Grant>(
        "SELECT * FROM support_preview_grants WHERE operator_id=$1 AND session_id=$2 AND status='active' FOR UPDATE",
        [a.userId, session.session_id],
      ))
        await end(tx, a, old, "replaced");
      const [g] = await tx.query<Grant>(
        "INSERT INTO support_preview_grants(id,operator_id,session_id,tenant_id,target_user_id,target_role,membership_version,case_id,request_key,fingerprint,reason,scopes,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),least($13::timestamptz,now()+($14::text||' minutes')::interval)) RETURNING *",
        [
          randomUUID(),
          a.userId,
          session.session_id,
          b.tenantId,
          c.target.id,
          c.target.role,
          c.target.version,
          b.caseId,
          b.requestKey,
          fingerprint,
          b.reason,
          b.scopes,
          session.expires_at,
          b.minutes,
        ],
      );
      await audit(tx, a, g, "started", {
        reasonReference: g.id,
        expiresAt: g.expires_at,
      });
      return { grant: publicGrant(g) };
    });
    if (result.error) throw result.error;
    return reply.header("Cache-Control", "private, no-store").send(result);
  });
  app.get(route + "/:id", rate, async (req, reply) => {
    const a = identity(req),
      grantId = id.parse((req.params as any).id);
    z.object({}).strict().parse(req.query);
    const result = await db.system(async (tx) => {
      const live = await liveGrant(tx, req, a, grantId);
      if (live.error) return { error: live.error };
      return { data: await project(tx, a, live.g, live.c, live.session.name) };
    });
    if (result.error) throw result.error;
    return reply.header("Cache-Control", "private, no-store").send(result.data);
  });
  app.post(route + "/:id/elevations", rate, async (req, reply) => {
    const a = identity(req),
      grantId = id.parse((req.params as any).id);
    const b = z
      .object({
        revision: z.number().int().min(1),
        requestKey: id,
        action: z.literal("notification_preferences"),
        reason: z.string().trim().min(10).max(500),
        version: z.number().int().min(0),
        changes: correctionChanges,
      })
      .strict()
      .parse(req.body);
    z.object({}).strict().parse(req.query);
    const fingerprint = digest(b);
    const result = await db.system(async (tx) => {
      const live = await liveGrant(tx, req, a, grantId);
      if (live.error) return { error: live.error };
      const { g, session } = live;
      if (!g.scopes.includes("notification_settings"))
        throw fail(
          403,
          "SUPPORT_SCOPE_REQUIRED",
          "Open a preview with notification settings selected.",
        );
      if (g.revision !== b.revision)
        throw fail(
          409,
          "REVISION_CONFLICT",
          "This preview changed. Reload before requesting a correction.",
        );
      const [prior] = await tx.query<Elevation>(
        "SELECT * FROM support_preview_elevations WHERE grant_id=$1 AND request_key=$2 FOR UPDATE",
        [g.id, b.requestKey],
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw fail(
            409,
            "INTENT_CONFLICT",
            "This correction request was already used with different details.",
          );
        if (prior.status === "applied")
          return { elevation: publicElevation(prior) };
        if (prior.status !== "active") return { error: elevationEnded() };
        if (await expired(tx, prior)) {
          await endElevation(tx, a, g, prior, "expired");
          return { error: elevationEnded() };
        }
        return { elevation: publicElevation(prior) };
      }
      const current = await scoped(
        tx,
        {
          tenantId: g.tenant_id,
          userId: g.target_user_id,
          role: g.target_role,
        },
        async () => {
          await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            g.tenant_id + ":notifications:" + g.target_user_id,
          ]);
          return preferences(tx, g);
        },
      );
      if (current.version !== b.version)
        throw fail(
          409,
          "PREFERENCES_CHANGED",
          "Customer settings changed. Reload before preparing the correction.",
        );
      if (
        Object.entries(b.changes).every(
          ([key, value]) =>
            current.data[key as keyof typeof current.data] === value,
        )
      )
        throw fail(
          400,
          "NO_CORRECTION",
          "Choose at least one changed setting.",
        );
      for (const old of await tx.query<Elevation>(
        "SELECT * FROM support_preview_elevations WHERE grant_id=$1 AND status='active' FOR UPDATE",
        [g.id],
      ))
        await endElevation(tx, a, g, old, "replaced");
      const [e] = await tx.query<Elevation>(
        "INSERT INTO support_preview_elevations(id,grant_id,request_key,fingerprint,action,reason,expected_version,changes,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),least($9::timestamptz,$10::timestamptz,$11::timestamptz+interval '10 minutes',now()+interval '5 minutes')) RETURNING *",
        [
          randomUUID(),
          g.id,
          b.requestKey,
          fingerprint,
          b.action,
          b.reason,
          b.version,
          JSON.stringify(b.changes),
          g.expires_at,
          session.expires_at,
          session.mfa_at,
        ],
      );
      await audit(tx, a, g, "correction_prepared", {
        elevationId: e.id,
        action: e.action,
        fields: Object.keys(e.changes),
        expectedVersion: e.expected_version,
        expiresAt: e.expires_at,
      });
      return { elevation: publicElevation(e) };
    });
    if (result.error) throw result.error;
    return reply.header("Cache-Control", "private, no-store").send(result);
  });
  app.post(
    route + "/:id/elevations/:elevationId/apply",
    rate,
    async (req, reply) => {
      const a = identity(req),
        p = z.object({ id, elevationId: id }).parse(req.params);
      const b = z
        .object({ revision: z.number().int().min(1) })
        .strict()
        .parse(req.body);
      z.object({}).strict().parse(req.query);
      const result = await db.system(async (tx) => {
        const live = await liveGrant(tx, req, a, p.id);
        if (live.error) return { error: live.error };
        const { g } = live;
        if (!g.scopes.includes("notification_settings"))
          throw fail(
            403,
            "SUPPORT_SCOPE_REQUIRED",
            "This preview does not include notification settings.",
          );
        const [e] = await tx.query<Elevation>(
          "SELECT * FROM support_preview_elevations WHERE id=$1 AND grant_id=$2 FOR UPDATE",
          [p.elevationId, g.id],
        );
        if (!e)
          throw fail(
            404,
            "SUPPORT_CORRECTION_UNAVAILABLE",
            "This correction is unavailable in this preview.",
          );
        // The immutable elevation ID is the write intent: a lost response can be
        // retried without replaying the change, even after the customer saves again.
        if (e.status === "applied") {
          if (b.revision !== e.revision - 1)
            throw fail(
              409,
              "REVISION_CONFLICT",
              "This correction changed. Reload the preview.",
            );
          return { elevation: publicElevation(e) };
        }
        if (e.status !== "active") return { error: elevationEnded() };
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          g.tenant_id + ":notifications:" + g.target_user_id,
        ]);
        // A customer save can hold this lock; recheck authority and the deadline
        // after waiting, immediately before the one permitted write.
        await operator(tx, req, a);
        if (await expired(tx, e)) {
          await endElevation(tx, a, g, e, "expired");
          return { error: elevationEnded() };
        }
        if (e.revision !== b.revision)
          throw fail(
            409,
            "REVISION_CONFLICT",
            "This correction changed. Reload the preview.",
          );
        const changes = correctionChanges.parse(e.changes);
        const saved = await scoped(
          tx,
          {
            tenantId: g.tenant_id,
            userId: g.target_user_id,
            role: g.target_role,
          },
          async () => {
            const current = await preferences(tx, g);
            if (current.version !== e.expected_version) return null;
            const [row] = await tx.query(
              "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET data=notification_preferences.data||excluded.data,version=notification_preferences.version+1,updated_at=now() WHERE notification_preferences.version=$4 RETURNING version",
              [
                g.tenant_id,
                g.target_user_id,
                JSON.stringify(changes),
                e.expected_version,
              ],
            );
            return row;
          },
        );
        if (!saved) {
          await endElevation(tx, a, g, e, "preferences_changed");
          await audit(tx, a, g, "correction_conflict", {
            elevationId: e.id,
            action: e.action,
            expectedVersion: e.expected_version,
          });
          return {
            error: fail(
              409,
              "PREFERENCES_CHANGED",
              "Customer settings changed. This approval ended; reload and review a new correction.",
            ),
          };
        }
        const [applied] = await tx.query<Elevation>(
          "UPDATE support_preview_elevations SET status='applied',revision=revision+1,ended_at=clock_timestamp(),end_reason='applied',result_version=$2 WHERE id=$1 AND status='active' AND revision=$3 RETURNING *",
          [e.id, saved.version, e.revision],
        );
        await audit(tx, a, g, "correction_applied", {
          elevationId: e.id,
          action: e.action,
          fields: Object.keys(changes),
          expectedVersion: e.expected_version,
          resultVersion: saved.version,
        });
        return { elevation: publicElevation(applied) };
      });
      if (result.error) throw result.error;
      return reply.header("Cache-Control", "private, no-store").send(result);
    },
  );
  app.post(
    route + "/:id/elevations/:elevationId/end",
    rate,
    async (req, reply) => {
      const a = identity(req),
        p = z.object({ id, elevationId: id }).parse(req.params);
      const b = z
        .object({ revision: z.number().int().min(1) })
        .strict()
        .parse(req.body);
      const result = await db.system(async (tx) => {
        const live = await liveGrant(tx, req, a, p.id);
        if (live.error) return { error: live.error };
        const [e] = await tx.query<Elevation>(
          "SELECT * FROM support_preview_elevations WHERE id=$1 AND grant_id=$2 FOR UPDATE",
          [p.elevationId, live.g.id],
        );
        if (!e)
          throw fail(
            404,
            "SUPPORT_CORRECTION_UNAVAILABLE",
            "This correction is unavailable in this preview.",
          );
        if (e.status === "active" && e.revision !== b.revision)
          throw fail(
            409,
            "REVISION_CONFLICT",
            "This correction changed. Reload the preview.",
          );
        return {
          elevation: publicElevation(
            e.status === "active"
              ? await endElevation(tx, a, live.g, e, "operator_stopped")
              : e,
          ),
        };
      });
      if (result.error) throw result.error;
      return reply.header("Cache-Control", "private, no-store").send(result);
    },
  );
  app.post(route + "/:id/end", rate, async (req) => {
    const a = identity(req),
      grantId = id.parse((req.params as any).id);
    const b = z
      .object({ revision: z.number().int().min(1) })
      .strict()
      .parse(req.body);
    return db.system(async (tx) => {
      const session = await operator(tx, req, a, false);
      const [g] = await tx.query<Grant>(
        "SELECT * FROM support_preview_grants WHERE id=$1 AND operator_id=$2 AND session_id=$3 FOR UPDATE",
        [grantId, a.userId, session.session_id],
      );
      if (!g)
        throw fail(
          404,
          "SUPPORT_PREVIEW_UNAVAILABLE",
          "This preview is unavailable in this sign-in session.",
        );
      if (g.status === "active" && g.revision !== b.revision)
        throw fail(
          409,
          "REVISION_CONFLICT",
          "This preview changed. Reload before stopping it.",
        );
      return { grant: publicGrant(await end(tx, a, g, "operator_stopped")) };
    });
  });
  app.route({
    method: ["POST", "PUT", "PATCH", "DELETE"],
    url: route + "/:id",
    ...rate,
    handler: async (req, reply) => {
      const a = identity(req),
        grantId = id.parse((req.params as any).id);
      const result = await db.system(async (tx) => {
        const live = await liveGrant(tx, req, a, grantId);
        if (live.error) return { error: live.error };
        await audit(tx, a, live.g, "mutation_blocked", { method: req.method });
        return { error: undefined };
      });
      if (result.error) throw result.error;
      return reply.code(405).send({
        code: "SUPPORT_PREVIEW_READ_ONLY",
        message:
          "Support previews are read-only. Use the appropriate audited operator workflow for changes.",
      });
    },
  });
}
