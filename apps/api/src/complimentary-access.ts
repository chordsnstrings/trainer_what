import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  elevated,
  event,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import { notifyCoachingTeam, notifyUser } from "./notifications.ts";
import {
  complimentaryNutritionApproved,
  grantIsActive,
  memberAccess,
  tierModules,
  type ComplimentaryTier,
} from "./entitlements.ts";
import { joiningLimits, messageDate } from "./joining.ts";

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
/** Days before a fixed end date when the follower is reminded. */
export const COMPLIMENTARY_REMINDER_DAYS = 3;
/** The member's saved time zone (notification preferences), if any. */
async function memberTimezone(tx: Tx, userId: string) {
  const [pref] = await tx.query(
    "SELECT data->>'timezone' AS timezone FROM notification_preferences WHERE user_id=$1",
    [userId],
  );
  return pref?.timezone ?? null;
}

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
    // Dates read in the member's own time zone (UAE by default).
    const timezone = grant.ends_at ? await memberTimezone(tx, b.userId) : null;
    await notifyUser(tx, a, {
      userId: b.userId,
      category: "coaching",
      dedupeKey: `complimentary-granted:${id}`,
      title: "Your coach gave you complimentary access",
      body: `${tierLabel(b.tier)} coaching is included ${grant.ends_at ? `until ${messageDate(grant.ends_at, timezone)}` : "until your coach ends it"}. No payment is needed for this access.`,
      href: "/app/membership",
      templateKey: "complimentary-granted",
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
    // A grant whose period already ran out is closed as expired: it is not a
    // revocation, and the follower is not told a second time that it ended.
    const [lapsed] = await tx.query(
      "UPDATE complimentary_access SET closed_at=now(),close_reason='expired',version=version+1 WHERE id=$1 AND closed_at IS NULL AND version=$2 AND ends_at IS NOT NULL AND ends_at<=now() RETURNING *",
      [grantId, b.version],
    );
    if (lapsed) {
      await event(tx, a, "complimentary.expired", lapsed.id, {
        userId: lapsed.user_id,
        tier: lapsed.tier,
        closedWhile: by === "platform" ? "platform_revoke" : "revoke",
      });
      return view(lapsed);
    }
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
      templateKey: "complimentary-ended",
      source: { type: "complimentary", id: grant.id },
    });
    if (by === "platform")
      await notifyCoachingTeam(tx, a, {
        category: "coaching",
        dedupeKey: `complimentary-platform-ended:${grant.id}`,
        title: "Platform operations ended a complimentary grant",
        body: "A complimentary access grant in your workspace was ended by platform operations. Open your subscribers to review current access.",
        href: "/trainer/subscribers",
        templateKey: "complimentary-platform-ended",
      });
    return view(grant);
  });
}

/**
 * Worker pass beside scheduleNotifications: closes grants whose period ran
 * out as `expired` and tells the follower and the coaching team once, and
 * reminds the follower a few days before a fixed end date. Bounded per pass.
 */
export async function sweepComplimentaryAccess(db: Database, tenantId: string) {
  const a: Actor = elevated("worker", { tenantId, role: "owner" });
  return db.tenant(a, async (tx) => {
    await lockGrants(tx, tenantId);
    const lapsed = await tx.query(
      "UPDATE complimentary_access SET closed_at=now(),close_reason='expired',version=version+1 WHERE id IN (SELECT id FROM complimentary_access WHERE closed_at IS NULL AND ends_at IS NOT NULL AND ends_at<=now() ORDER BY ends_at,id LIMIT 100) RETURNING id,user_id,tier,ends_at",
    );
    for (const g of lapsed) {
      await event(tx, a, "complimentary.expired", g.id, {
        userId: g.user_id,
        tier: g.tier,
      });
      const timezone = await memberTimezone(tx, g.user_id);
      await notifyUser(tx, a, {
        userId: g.user_id,
        category: "coaching",
        dedupeKey: `complimentary-ended:${g.id}`,
        title: "Your complimentary access has ended",
        body: `The complimentary coaching access from your coach ended on ${messageDate(g.ends_at, timezone)}. Your membership page shows your current options.`,
        href: "/app/membership",
        templateKey: "complimentary-ended",
        source: { type: "complimentary", id: g.id },
      });
      const [person] = await tx.query("SELECT name FROM users WHERE id=$1", [
        g.user_id,
      ]);
      await notifyCoachingTeam(tx, a, {
        category: "coaching",
        dedupeKey: `complimentary-expired-team:${g.id}`,
        title: "Complimentary access ended",
        body: `${person?.name ?? "A follower"}'s complimentary access reached its end date. Grant it again or invite them to a paid plan from Subscribers.`,
        href: "/trainer/subscribers",
        templateKey: "complimentary-team-ended",
      });
    }
    const ending = await tx.query(
      "SELECT c.id,c.user_id,c.ends_at FROM complimentary_access c WHERE c.closed_at IS NULL AND c.ends_at>now() AND c.ends_at<=now()+make_interval(days=>$1) AND c.ends_at-c.starts_at>make_interval(days=>$1) AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.user_id=c.user_id AND n.dedupe_key='complimentary-ending:'||c.id::text) ORDER BY c.ends_at,c.id LIMIT 100",
      [COMPLIMENTARY_REMINDER_DAYS],
    );
    for (const g of ending) {
      const timezone = await memberTimezone(tx, g.user_id);
      await notifyUser(tx, a, {
        userId: g.user_id,
        category: "coaching",
        dedupeKey: `complimentary-ending:${g.id}`,
        title: "Your complimentary access ends soon",
        body: `The complimentary coaching access from your coach ends on ${messageDate(g.ends_at, timezone)}. Your membership page shows your options to continue.`,
        href: "/app/membership",
        templateKey: "complimentary-ending",
        source: { type: "complimentary", id: g.id },
      });
    }
    return { expired: lapsed.length, reminded: ending.length };
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
  // Opaque keyset cursor: the exact created_at text and grant id of the last
  // row, so rows created in the same millisecond are never skipped.
  const cursorSchema = z
    .string()
    .max(200)
    .transform((value, ctx) => {
      try {
        const [createdAt, id] = JSON.parse(
          Buffer.from(value, "base64url").toString("utf8"),
        );
        if (
          typeof createdAt === "string" &&
          /^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9:.]+([+-][0-9:]+|Z)?$/.test(
            createdAt,
          ) &&
          uuid.safeParse(id).success
        )
          return { createdAt, id: id as string };
      } catch {}
      ctx.addIssue({ code: "custom", message: "Invalid page cursor" });
      return z.NEVER;
    });
  const cursorOf = (row: any) =>
    Buffer.from(JSON.stringify([row.created_text, row.grant_id])).toString(
      "base64url",
    );
  app.get("/api/v1/admin/complimentary-access", async (req) => {
    const a = operator(req);
    const q = z
      .object({
        tenantId: uuid.optional(),
        workspace: z.string().trim().toLowerCase().max(80).optional(),
        follower: z.string().trim().toLowerCase().max(320).optional(),
        status: z.enum(["active", "ended", "all"]).default("active"),
        cursor: cursorSchema.optional(),
      })
      .strict()
      .parse(req.query);
    // Pages by grant across every workspace, newest first, from the
    // keys-and-dates directory; details come from each workspace's own
    // tenant-scoped rows.
    const keys = await db.system((tx) =>
      tx.query(
        `SELECT d.grant_id,d.tenant_id,d.created_at::text AS created_text,t.name AS workspace,t.slug
           FROM complimentary_access_directory d JOIN tenants t ON t.id=d.tenant_id
          WHERE ($1::uuid IS NULL OR d.tenant_id=$1)
            AND ($2::text IS NULL OR t.slug=$2)
            AND ($3::text IS NULL OR d.user_id IN (SELECT id FROM users WHERE lower(email)=$3))
            AND CASE $4::text
                  WHEN 'active' THEN d.closed_at IS NULL AND (d.ends_at IS NULL OR d.ends_at>now())
                  WHEN 'ended' THEN d.closed_at IS NOT NULL OR d.ends_at<=now()
                  ELSE true END
            AND ($5::timestamptz IS NULL OR (d.created_at,d.grant_id)<($5::timestamptz,$6::uuid))
          ORDER BY d.created_at DESC,d.grant_id DESC LIMIT 26`,
        [
          q.tenantId ?? null,
          q.workspace || null,
          q.follower || null,
          q.status,
          q.cursor?.createdAt ?? null,
          q.cursor?.id ?? null,
        ],
      ),
    );
    // The audit records which filters were used, not the follower's address.
    await db.system((tx) =>
      adminAudit(tx, a, "complimentary.read", q.tenantId ?? null, null, {
        status: q.status,
        workspace: q.workspace || null,
        followerFilter: !!q.follower,
        paged: !!q.cursor,
      }),
    );
    const page = keys.slice(0, 25);
    const byTenant = new Map<string, any[]>();
    for (const k of page)
      byTenant.set(k.tenant_id, [...(byTenant.get(k.tenant_id) ?? []), k]);
    const details = new Map<string, any>();
    for (const [tenantId, rows] of byTenant) {
      const grants = await db.tenant(
        elevated("platform-operator", {
          tenantId,
          userId: a.userId,
          role: "owner",
        }),
        (tx) =>
          tx.query(listSql + " WHERE c.id=ANY($1::uuid[])", [
            rows.map((r) => r.grant_id),
          ]),
      );
      for (const g of grants) details.set(g.id, g);
    }
    return {
      grants: page
        .filter((k) => details.has(k.grant_id))
        .map((k) => ({
          ...view(details.get(k.grant_id)),
          tenantId: k.tenant_id,
          workspace: k.workspace,
          slug: k.slug,
        })),
      canRevoke: a.platformRole === "admin",
      nextCursor: keys.length > 25 ? cursorOf(page[page.length - 1]) : null,
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
        {
          ...a,
          ...elevated("platform-operator", {
            tenantId: p.tenantId,
            userId: a.userId,
            role: "owner",
          }),
        },
        p.id,
        req.body,
        "platform",
      );
      await db.system((tx) =>
        adminAudit(
          tx,
          a,
          result.closeReason === "expired"
            ? "complimentary.closed_expired"
            : "complimentary.revoked",
          p.tenantId,
          p.id,
          { tier: result.tier },
        ),
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
/**
 * Free text is scrubbed only inside a privacy erasure scope: the db package
 * sets app.privacy_erasure when the scope is entered (a tenant scope cannot
 * set it), and the guard trigger accepts the fixed marker only then.
 */
async function scrubbing(tx: Tx, run: () => Promise<unknown>) {
  const [flag] = await tx.query(
    "SELECT current_setting('app.privacy_erasure',true)='true' AS on",
  );
  if (!flag?.on)
    throw fail(
      500,
      "PRIVACY_SCOPE_REQUIRED",
      "Complimentary access text is scrubbed only during privacy erasure.",
    );
  await run();
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
