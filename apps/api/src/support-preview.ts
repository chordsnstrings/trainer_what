import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Database, Tx } from "@trainer/db";
import { tokenHash } from "./auth.ts";
import { requireRecentMfa } from "./security.ts";

type Operator = Actor & { platformRole: string; mfaAt?: string | null };
type Scope = "account" | "access" | "connections";
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
      .array(z.enum(["account", "access", "connections"]))
      .min(1)
      .max(3)
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
        mode: "read_only",
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
      "SELECT id,owner_user_id,status,version,data->>'category' AS category FROM records WHERE id=$1 AND kind='support'",
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
  await audit(
    tx,
    a,
    updated,
    updated.status === "expired" ? "expired" : "ended",
    { reason },
  );
  return updated;
}
async function expired(tx: Tx, g: Grant) {
  const [r] = await tx.query(
    "SELECT $1::timestamptz<=clock_timestamp() AS expired",
    [g.expires_at],
  );
  return r.expired === true;
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
    },
  );
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
    limitations:
      "This preview contains account, access and connection status only. Health details, conversations, payment details, private uploads and credentials are excluded. Changes cannot be made from this preview.",
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
      return { data: await project(tx, a, g, c, session.name) };
    });
    if (result.error) throw result.error;
    return reply.header("Cache-Control", "private, no-store").send(result.data);
  });
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
      await db.system(async (tx) => {
        const session = await operator(tx, req, a);
        const [g] = await tx.query<Grant>(
          "SELECT * FROM support_preview_grants WHERE id=$1 AND operator_id=$2 AND session_id=$3",
          [grantId, a.userId, session.session_id],
        );
        if (!g)
          throw fail(
            404,
            "SUPPORT_PREVIEW_UNAVAILABLE",
            "This preview is unavailable in this sign-in session.",
          );
        await audit(tx, a, g, "mutation_blocked", { method: req.method });
      });
      return reply
        .code(405)
        .send({
          code: "SUPPORT_PREVIEW_READ_ONLY",
          message:
            "Support previews are read-only. Use the appropriate audited operator workflow for changes.",
        });
    },
  });
}
