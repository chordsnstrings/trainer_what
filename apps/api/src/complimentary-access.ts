import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import { notifyCoachingTeam, notifyUser } from "./notifications.ts";
import {
  complimentaryNutritionApproved,
  grantIsActive,
  memberAccess,
  tierModules,
  type ComplimentaryTier,
} from "./entitlements.ts";
import { joiningLimits } from "./joining.ts";

/**
 * Trainer-granted complimentary access. The workspace owner (with a fresh
 * authenticator check) grants a follower a tier for a fixed period or until
 * revoked. A grant creates no Stripe object, subscription, journal, revenue or
 * commission entry; AI and voice usage stays attributed to the workspace in
 * cost_events exactly as for paid members. Superadmins see every grant and may
 * revoke one.
 */
type Identity = Actor & {
  platformRole?: string;
  mfaAt?: string | null;
};
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const uuid = z.string().uuid();
const ERASED = "[removed at erasure]";
const tierLabel = (tier: string) =>
  tier === "workout_nutrition" ? "Workout + nutrition" : "Workout";

export function grantStatus(grant: any, now = Date.now()) {
  if (grant.closed_at)
    return grant.close_reason === "expired" ? "expired" : "revoked";
  if (grant.ends_at && new Date(grant.ends_at).getTime() <= now)
    return "expired";
  return "active";
}
function view(grant: any, now = Date.now()) {
  return {
    id: grant.id,
    userId: grant.user_id,
    name: grant.name ?? null,
    email: grant.email ?? null,
    tier: grant.tier,
    reason: grant.reason,
    startsAt: grant.starts_at,
    endsAt: grant.ends_at,
    grantedBy: grant.granted_by,
    grantedByName: grant.granted_by_name ?? null,
    createdAt: grant.created_at,
    status: grantStatus(grant, now),
    closedAt: grant.closed_at,
    closedBy: grant.closed_by,
    closeReason: grant.close_reason,
    closeNote: grant.close_note,
    version: grant.version,
  };
}
async function lockGrants(tx: Tx, tenantId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":complimentary",
  ]);
}
const listSql =
  "SELECT c.*,u.name,u.email,g.name AS granted_by_name FROM complimentary_access c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN users g ON g.id=c.granted_by";

const grantInput = z
  .object({
    userId: uuid,
    tier: z.enum(["workout", "workout_nutrition"]),
    // Whole days from now; null means until revoked.
    days: z.number().int().min(1).max(3650).nullable(),
    reason: z.string().trim().min(5).max(1000),
    replaceId: uuid.optional(),
  })
  .strict();
const revokeInput = z
  .object({
    version: z.number().int().min(1),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();

export async function grantComplimentaryAccess(
  db: Database,
  a: Identity,
  input: unknown,
) {
  if (a.role !== "owner")
    throw fail(
      403,
      "OWNER_REQUIRED",
      "Only the workspace owner can grant complimentary access.",
    );
  requireRecentMfa(a, true);
  const b = grantInput.parse(input),
    limits = joiningLimits();
  if (limits.complimentaryMaxActive === 0)
    throw fail(
      409,
      "COMPLIMENTARY_DISABLED",
      "Complimentary access is switched off for this platform.",
    );
  if (b.days === null && !limits.complimentaryOpenEnded)
    throw fail(
      400,
      "COMPLIMENTARY_PERIOD_REQUIRED",
      `Choose a period of up to ${limits.complimentaryMaxDays} days.`,
    );
  if (b.days !== null && b.days > limits.complimentaryMaxDays)
    throw fail(
      400,
      "COMPLIMENTARY_PERIOD_LIMIT",
      `Complimentary access can last at most ${limits.complimentaryMaxDays} days.`,
    );
  if (b.tier === "workout_nutrition" && !complimentaryNutritionApproved())
    throw fail(
      409,
      "NUTRITION_APPROVAL_PENDING",
      "The workout + nutrition tier waits for the platform's nutrition approval.",
    );
  return db.tenant({ ...a, role: "owner" }, async (tx) => {
    await lockGrants(tx, a.tenantId);
    const [member] = await tx.query(
      "SELECT m.user_id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role='subscriber'",
      [a.tenantId, b.userId],
    );
    if (!member)
      throw fail(
        404,
        "SUBSCRIBER_UNAVAILABLE",
        "Complimentary access is for followers of this coaching space.",
      );
    if (b.tier === "workout_nutrition") {
      const [setup] = await tx.query(
        "SELECT data FROM records WHERE kind='nutrition_setup' ORDER BY created_at DESC,id DESC LIMIT 1",
      );
      if (setup?.data?.enabled !== true)
        throw fail(
          409,
          "NUTRITION_NOT_ENABLED",
          "Turn on nutrition setup before granting the workout + nutrition tier.",
        );
    }
    const [open] = await tx.query(
      "SELECT * FROM complimentary_access WHERE user_id=$1 AND closed_at IS NULL FOR UPDATE",
      [b.userId],
    );
    let replaced: string | null = null;
    if (open) {
      if (!grantIsActive(open))
        await tx.query(
          "UPDATE complimentary_access SET closed_at=now(),close_reason='expired',version=version+1 WHERE id=$1",
          [open.id],
        );
      else if (b.replaceId === open.id) {
        await tx.query(
          "UPDATE complimentary_access SET closed_at=now(),closed_by=$2,close_reason='superseded',version=version+1 WHERE id=$1",
          [open.id, a.userId],
        );
        replaced = open.id;
      } else
        throw fail(
          409,
          "COMPLIMENTARY_EXISTS",
          "This follower already has complimentary access. Replace it or revoke it first.",
        );
    }
    const [count] = await tx.query(
      "SELECT count(*)::int AS n FROM complimentary_access WHERE closed_at IS NULL AND (ends_at IS NULL OR ends_at>now())",
    );
    if (count.n >= limits.complimentaryMaxActive)
      throw fail(
        409,
        "COMPLIMENTARY_LIMIT",
        `This workspace already has ${limits.complimentaryMaxActive} active complimentary members, the platform limit.`,
      );
    const id = randomUUID();
    const [grant] = await tx.query(
      "INSERT INTO complimentary_access(id,tenant_id,user_id,tier,reason,starts_at,ends_at,granted_by) VALUES($1,$2,$3,$4,$5,now(),CASE WHEN $6::int IS NULL THEN NULL ELSE now()+make_interval(days=>$6::int) END,$7) RETURNING *",
      [id, a.tenantId, b.userId, b.tier, b.reason, b.days, a.userId],
    );
    // Audit keeps structured terms only; the free-text reason stays on the
    // grant, where an erasure request can remove it.
    await event(tx, a, "complimentary.granted", id, {
      userId: b.userId,
      tier: b.tier,
      days: b.days,
      endsAt: grant.ends_at,
      replaced,
    });
    await notifyUser(tx, a, {
      userId: b.userId,
      category: "coaching",
      dedupeKey: `complimentary-granted:${id}`,
      title: "Your coach gave you complimentary access",
      body: `${tierLabel(b.tier)} coaching is included ${grant.ends_at ? `until ${new Date(grant.ends_at).toISOString().slice(0, 10)}` : "until your coach ends it"}. No payment is needed for this access.`,
      href: "/app/membership",
      source: { type: "complimentary", id },
    });
    return view({ ...grant, name: member.name });
  });
}

export async function closeComplimentaryAccess(
  db: Database,
  a: Identity,
  grantId: string,
  input: unknown,
  by: "trainer" | "platform",
) {
  const b = revokeInput.parse(input);
  return db.tenant({ ...a, role: "owner" }, async (tx) => {
    await lockGrants(tx, a.tenantId);
    const [grant] = await tx.query(
      "UPDATE complimentary_access SET closed_at=now(),closed_by=$2,close_reason=$3,close_note=$4,version=version+1 WHERE id=$1 AND closed_at IS NULL AND version=$5 RETURNING *",
      [
        grantId,
        a.userId,
        by === "platform" ? "platform_revoked" : "revoked",
        b.reason,
        b.version,
      ],
    );
    if (!grant)
      throw fail(
        409,
        "COMPLIMENTARY_CHANGED",
        "This complimentary access changed or has already ended. Reload first.",
      );
    await event(
      tx,
      a,
      by === "platform"
        ? "complimentary.platform_revoked"
        : "complimentary.revoked",
      grant.id,
      { userId: grant.user_id, tier: grant.tier },
    );
    await notifyUser(tx, a, {
      userId: grant.user_id,
      category: "coaching",
      dedupeKey: `complimentary-ended:${grant.id}`,
      title: "Your complimentary access has ended",
      body: "Complimentary coaching access has ended. Your membership page shows your current options.",
      href: "/app/membership",
      source: { type: "complimentary", id: grant.id },
    });
    if (by === "platform")
      await notifyCoachingTeam(tx, a, {
        category: "coaching",
        dedupeKey: `complimentary-platform-ended:${grant.id}`,
        title: "Platform operations ended a complimentary grant",
        body: "A complimentary access grant in your workspace was ended by platform operations. Open your subscribers to review current access.",
        href: "/trainer/subscribers",
      });
    return view(grant);
  });
}

/** Member-facing summary; the trainer's free-text reason is not shown. */
export async function memberAccessSummary(tx: Tx, userId: string) {
  const access = await memberAccess(tx, userId);
  const grant = access.grant;
  return {
    active: access.active,
    sources: access.sources,
    modules: access.modules,
    complimentary: grant
      ? {
          id: grant.id,
          tier: grant.tier,
          startsAt: grant.starts_at,
          endsAt: grant.ends_at,
          includesNutrition: tierModules(grant.tier).includes("nutrition"),
          nutritionAvailable: access.modules.includes("nutrition"),
        }
      : null,
    paid: access.subscription
      ? {
          status: access.subscription.status,
          periodEnd: access.subscription.period_end,
        }
      : null,
  };
}

export function registerComplimentaryAccess(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
) {
  const coach = (req: FastifyRequest) => {
    const a = identity(req);
    if (!["owner", "staff"].includes(a.role))
      throw fail(403, "ROLE_REQUIRED", "Trainer access required");
    return a;
  };
  app.get("/api/v1/complimentary-access", async (req) => {
    const a = coach(req);
    const limits = joiningLimits();
    return db.tenant({ ...a, role: a.role }, async (tx) => {
      const grants = await tx.query(
        listSql +
          " ORDER BY c.closed_at IS NOT NULL,c.created_at DESC LIMIT 200",
      );
      const followers = await tx.query(
        "SELECT u.id,u.name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.role='subscriber' ORDER BY u.name,u.id LIMIT 1000",
        [a.tenantId],
      );
      const [setup] = await tx.query(
        "SELECT data FROM records WHERE kind='nutrition_setup' ORDER BY created_at DESC,id DESC LIMIT 1",
      );
      return {
        canManage: a.role === "owner",
        grants: grants.map((g) => view(g)),
        followers,
        limits: {
          maxDays: limits.complimentaryMaxDays,
          maxActive: limits.complimentaryMaxActive,
          openEnded: limits.complimentaryOpenEnded,
          active: grants.filter((g) => grantStatus(g) === "active").length,
        },
        nutritionTier: {
          approved: complimentaryNutritionApproved(),
          setupEnabled: setup?.data?.enabled === true,
        },
      };
    });
  });
  app.post(
    "/api/v1/complimentary-access",
    { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (req) => grantComplimentaryAccess(db, identity(req), req.body),
  );
  app.post(
    "/api/v1/complimentary-access/:id/revoke",
    { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = identity(req);
      if (a.role !== "owner")
        throw fail(
          403,
          "OWNER_REQUIRED",
          "Only the workspace owner can end complimentary access.",
        );
      requireRecentMfa(a, true);
      return closeComplimentaryAccess(
        db,
        a,
        uuid.parse((req.params as any).id),
        req.body,
        "trainer",
      );
    },
  );
  app.get("/api/v1/membership/access", async (req) => {
    const a = identity(req);
    if (a.role !== "subscriber")
      throw fail(403, "SUBSCRIBER_REQUIRED", "Subscriber access required");
    return db.tenant(a, (tx) => memberAccessSummary(tx, a.userId));
  });
  const operator = (req: FastifyRequest, revoke = false) => {
    const a = identity(req);
    const allowed = revoke ? ["admin"] : ["admin", "finance", "support"];
    if (!allowed.includes(a.platformRole ?? "none"))
      throw fail(
        403,
        "OPERATOR_SCOPE",
        revoke
          ? "Only a platform administrator can end complimentary access."
          : "Your operator role does not allow this view.",
      );
    requireRecentMfa(a, true);
    return a;
  };
  async function adminAudit(
    tx: Tx,
    a: Identity,
    action: string,
    tenantId: string | null,
    subjectId: string | null,
    data: unknown = {},
  ) {
    await tx.query(
      "INSERT INTO admin_operations_audit(id,actor_id,action,tenant_id,subject_id,data) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        a.userId,
        action,
        tenantId,
        subjectId,
        JSON.stringify(data),
      ],
    );
  }
  app.get("/api/v1/admin/complimentary-access", async (req) => {
    const a = operator(req);
    const q = z
      .object({
        tenantId: uuid.optional(),
        status: z.enum(["active", "all"]).default("active"),
        page: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const tenants = await db.system((tx) =>
      tx.query(
        "SELECT id,slug,name FROM tenants WHERE ($1::uuid IS NULL OR id=$1) ORDER BY created_at DESC,id LIMIT 26 OFFSET $2",
        [q.tenantId ?? null, q.tenantId ? 0 : q.page * 25],
      ),
    );
    if (q.tenantId && !tenants.length)
      throw fail(404, "TENANT_NOT_FOUND", "Workspace unavailable.");
    await db.system((tx) =>
      adminAudit(tx, a, "complimentary.read", q.tenantId ?? null, null, {
        status: q.status,
        page: q.page,
      }),
    );
    const rows: any[] = [];
    for (const t of tenants.slice(0, 25)) {
      const grants = await db.tenant(
        { ...a, tenantId: t.id, role: "owner" },
        (tx) =>
          tx.query(
            listSql +
              (q.status === "active"
                ? " WHERE c.closed_at IS NULL AND (c.ends_at IS NULL OR c.ends_at>now())"
                : "") +
              " ORDER BY c.created_at DESC LIMIT 200",
          ),
      );
      rows.push(
        ...grants.map((g) => ({
          ...view(g),
          tenantId: t.id,
          workspace: t.name,
          slug: t.slug,
        })),
      );
    }
    return {
      grants: rows,
      canRevoke: a.platformRole === "admin",
      page: q.page,
      hasMore: !q.tenantId && tenants.length > 25,
    };
  });
  app.post(
    "/api/v1/admin/tenants/:tenantId/complimentary-access/:id/revoke",
    { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = operator(req, true),
        p = z.object({ tenantId: uuid, id: uuid }).parse(req.params as any);
      const [tenant] = await db.system((tx) =>
        tx.query("SELECT id FROM tenants WHERE id=$1", [p.tenantId]),
      );
      if (!tenant)
        throw fail(404, "TENANT_NOT_FOUND", "Workspace unavailable.");
      const result = await closeComplimentaryAccess(
        db,
        { ...a, tenantId: p.tenantId, role: "owner" },
        p.id,
        req.body,
        "platform",
      );
      await db.system((tx) =>
        adminAudit(tx, a, "complimentary.revoked", p.tenantId, p.id, {
          tier: result.tier,
        }),
      );
      return result;
    },
  );
}

/** Personal-data export rows for a member. */
export async function exportComplimentaryAccess(tx: Tx, userId: string) {
  return tx.query(
    "SELECT id,tier,reason,starts_at,ends_at,closed_at,close_reason,close_note,created_at FROM complimentary_access WHERE user_id=$1 ORDER BY created_at",
    [userId],
  );
}
async function scrubbing(tx: Tx, run: () => Promise<unknown>) {
  const [prior] = await tx.query(
    "SELECT current_setting('app.privacy_erasure',true) AS value",
  );
  await tx.query("SELECT set_config('app.privacy_erasure','true',true)");
  try {
    await run();
  } finally {
    await tx.query("SELECT set_config('app.privacy_erasure',$1,true)", [
      prior?.value ?? "",
    ]);
  }
}
/** Member erasure: end open grants and remove free text; history rows remain. */
export async function eraseComplimentaryAccess(tx: Tx, userId: string) {
  const [table] = await tx.query(
    "SELECT to_regclass('public.complimentary_access') AS name",
  );
  if (!table.name) return;
  const [tenant] = await tx.query(
    "SELECT nullif(current_setting('app.tenant_id',true),'') AS id",
  );
  if (tenant?.id) await lockGrants(tx, tenant.id);
  await scrubbing(tx, () =>
    tx.query(
      "UPDATE complimentary_access SET closed_at=coalesce(closed_at,now()),close_reason=coalesce(close_reason,'member_removed'),reason=$2,close_note=CASE WHEN close_note IS NULL THEN NULL ELSE $2 END,version=version+1 WHERE user_id=$1",
      [userId, ERASED],
    ),
  );
}
/** Workspace closure: end every open grant and remove free text. */
export async function closeWorkspaceComplimentaryAccess(tx: Tx) {
  const [table] = await tx.query(
    "SELECT to_regclass('public.complimentary_access') AS name",
  );
  if (!table.name) return;
  await scrubbing(tx, () =>
    tx.query(
      "UPDATE complimentary_access SET closed_at=coalesce(closed_at,now()),close_reason=coalesce(close_reason,'workspace_closed'),reason=$1,close_note=CASE WHEN close_note IS NULL THEN NULL ELSE $1 END,version=version+1",
      [ERASED],
    ),
  );
}
