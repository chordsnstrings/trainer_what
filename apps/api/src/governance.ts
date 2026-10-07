import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  elevated,
  event,
  type Actor,
  type Database,
  type SystemTx,
  type Tx,
} from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";
import { transitionPayout } from "./finance.ts";
import { notifyUser } from "./notifications.ts";
import { accountLocked } from "./account-governance.ts";
import { addAccountNotice } from "./account-self-service.ts";
import {
  platformWorkspaceSql,
  workspaceSuspendedMessage,
} from "./workspace-state.ts";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";

// Super admin governance: workspace suspension/reinstatement and account
// lock/unlock. Every action needs a Super admin with a fresh authenticator
// code and a written reason, is serialized, and is audited.
export type GovernanceIdentity = Actor & {
  platformRole: string;
  mfaAt?: string | null;
  workspaceState?: string;
};
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const conflict = () =>
  fail(
    409,
    "REVISION_CONFLICT",
    "This item changed. Reload before continuing.",
  );
const uuid = z.string().uuid();
const reason = z.string().trim().min(10).max(1000);
const platformLock = (tx: Tx) =>
  // Shared with operator role changes and first-admin bootstrap.
  tx.query("SELECT pg_advisory_xact_lock(hashtext('platform-first-admin'))");

async function audit(
  tx: Tx,
  actorId: string,
  action: string,
  tenantId: string | null,
  subjectId: string | null,
  data: Record<string, unknown> = {},
) {
  await tx.query(
    "INSERT INTO admin_operations_audit(id,actor_id,action,tenant_id,subject_id,data) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), actorId, action, tenantId, subjectId, JSON.stringify(data)],
  );
}
/** Runs scoped writes inside a system transaction, then returns to the service role. */
async function asTenant<T>(
  tx: SystemTx,
  a: Actor,
  fn: (scoped: Tx) => Promise<T>,
) {
  return tx.tenant(a, fn);
}
/** The acting Super admin must still hold the role and must not be locked. */
async function currentSuperAdmin(tx: Tx, userId: string) {
  const [u] = await tx.query(
    "SELECT platform_role FROM users WHERE id=$1 FOR SHARE",
    [userId],
  );
  if (u?.platform_role !== "admin" || (await accountLocked(tx, userId)))
    throw fail(
      403,
      "SUPERADMIN_REQUIRED",
      "Current Super admin access is required.",
    );
}
async function workspaceOwner(tx: Tx, tenantId: string) {
  const [owner] = await tx.query(
    "SELECT user_id FROM memberships WHERE tenant_id=$1 AND role='owner' ORDER BY user_id LIMIT 1",
    [tenantId],
  );
  return (owner?.user_id as string | undefined) ?? null;
}
const money = (minor: number) =>
  "AED " + (minor / 100).toLocaleString("en-AE", { minimumFractionDigits: 2 });

export async function suspendWorkspace(
  db: Database,
  a: GovernanceIdentity,
  tenantId: string,
  input: { reason: string; notice?: string },
) {
  return db.system(
    async (tx) => {
      // The workspace lock also serializes payout preparation and dispatch.
      await workspaceLock(tx, tenantId);
      await currentSuperAdmin(tx, a.userId);
      const [t] = await tx.query(
        "SELECT id,name,lifecycle_state FROM tenants WHERE id=$1 FOR UPDATE",
        [tenantId],
      );
      if (!t) throw fail(404, "TENANT_NOT_FOUND", "Workspace unavailable.");
      if (t.lifecycle_state !== "active")
        throw fail(
          409,
          "WORKSPACE_STATE",
          t.lifecycle_state === "suspended"
            ? "This workspace is already suspended."
            : "Only an active workspace can be suspended.",
        );
      // Only a platform administration workspace (its owner is an operator) is
      // exempt. Operators who follow or staff this trainer keep their operator
      // access through /api/v1/admin/* and can switch workspace.
      const [platform] = await tx.query(
        `SELECT ${platformWorkspaceSql("$1::uuid")} AS platform`,
        [tenantId],
      );
      if (platform?.platform)
        throw fail(
          409,
          "PLATFORM_WORKSPACE",
          "This is a platform administration workspace: its owner holds a platform role. Remove that platform role before suspending it.",
        );
      await tx.query(
        "UPDATE tenants SET lifecycle_state='suspended' WHERE id=$1",
        [tenantId],
      );
      const suspensionId = randomUUID(),
        followupId = randomUUID(),
        notice = input.notice?.trim() ?? "",
        owner = await workspaceOwner(tx, tenantId);
      // The Super admin acts in the workspace as an allowlisted platform operator.
      const scoped = elevated("platform-operator", {
        tenantId,
        userId: a.userId,
        role: "finance",
      });
      const held = await asTenant(tx, scoped, async (tx) => {
        // Instructions not yet sent to the bank are held; in-flight ones are
        // listed for reconciliation because they cannot be recalled here.
        const ready = await tx.query(
          "SELECT id,amount_minor FROM payouts WHERE status='ready' ORDER BY created_at,id",
        );
        for (const p of ready) await transitionPayout(tx, scoped, p.id, "held");
        const inFlight = await tx.query(
          "SELECT id,status,amount_minor FROM payouts WHERE status IN ('submitted','processing','unknown') ORDER BY created_at,id",
        );
        const heldMinor = ready.reduce((n, p) => n + Number(p.amount_minor), 0);
        await tx.query(
          "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,'reconciliation',$3,'open',$4)",
          [
            followupId,
            tenantId,
            a.userId,
            JSON.stringify({
              description: `Workspace suspended by the platform. Billing continues and was not cancelled: review active memberships, refunds and any cancellation with the owner. ${ready.length} payout instruction(s) held (${money(heldMinor)}); ${inFlight.length} already sent to the bank need reconciliation.`,
              externalReference: "workspace-suspension:" + suspensionId,
              source: "workspace_suspension",
              suspensionId,
              heldPayoutIds: ready.map((p) => p.id),
              inFlightPayouts: inFlight.map((p) => ({
                id: p.id,
                status: p.status,
                amountMinor: Number(p.amount_minor),
              })),
            }),
          ],
        );
        await event(tx, scoped, "workspace.suspended", tenantId, {
          suspensionId,
          heldPayouts: ready.length,
          financeFollowupId: followupId,
        });
        if (owner)
          await notifyUser(tx, scoped, {
            userId: owner,
            category: "account",
            dedupeKey: "workspace-suspension:" + suspensionId,
            title: "Your coaching workspace is suspended",
            body:
              (notice ? notice + "\n\n" : "") +
              "The platform team suspended this workspace. Members cannot use coaching, plans or bookings, the public website and joining are offline, and payouts are held. Billing is not cancelled. " +
              (runtimeConfig().SUPPORT_EMAIL
                ? `Contact ${runtimeConfig().SUPPORT_EMAIL} to resolve this.`
                : "Contact platform support to resolve this."),
            href: "/trainer",
            templateKey: "workspace-suspended",
            source: { kind: "workspace_suspension", suspensionId },
            // Device notifications only reach members of active workspaces, so a
            // push would wait and arrive stale after reinstatement. The in-app
            // notice and the critical email carry it.
            push: false,
          });
        return ready.map((p) => p.id as string);
      });
      const [row] = await tx.query(
        "INSERT INTO workspace_suspensions(id,tenant_id,reason,notice,suspended_by,held_payouts,finance_followup_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          suspensionId,
          tenantId,
          input.reason,
          notice,
          a.userId,
          JSON.stringify(held),
          followupId,
        ],
      );
      await audit(tx, a.userId, "workspace.suspended", tenantId, suspensionId, {
        reason: input.reason,
        heldPayouts: held.length,
        financeFollowupId: followupId,
        ownerNotified: !!owner,
      });
      return {
        suspension: row,
        heldPayouts: held,
        financeFollowupId: followupId,
      };
    },
    { tenantId: tenantId },
  );
}

export async function reinstateWorkspace(
  db: Database,
  a: GovernanceIdentity,
  tenantId: string,
  input: { suspensionId: string; revision: number; reason: string },
) {
  return db.system(
    async (tx) => {
      await workspaceLock(tx, tenantId);
      await currentSuperAdmin(tx, a.userId);
      const [t] = await tx.query(
        "SELECT id,lifecycle_state FROM tenants WHERE id=$1 FOR UPDATE",
        [tenantId],
      );
      if (!t) throw fail(404, "TENANT_NOT_FOUND", "Workspace unavailable.");
      const [s] = await tx.query(
        "SELECT * FROM workspace_suspensions WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
        [input.suspensionId, tenantId],
      );
      if (!s || s.status !== "active" || s.revision !== input.revision)
        throw conflict();
      if (t.lifecycle_state !== "suspended")
        throw fail(409, "WORKSPACE_STATE", "This workspace is not suspended.");
      await tx.query(
        "UPDATE tenants SET lifecycle_state='active' WHERE id=$1",
        [tenantId],
      );
      const scoped = elevated("platform-operator", {
        tenantId,
        userId: a.userId,
        role: "finance",
      });
      const owner = await workspaceOwner(tx, tenantId);
      const released = await asTenant(tx, scoped, async (tx) => {
        const ids = (s.held_payouts as string[]) ?? [];
        const still = ids.length
          ? await tx.query(
              "SELECT id FROM payouts WHERE id=ANY($1::uuid[]) AND status='held' ORDER BY created_at,id",
              [ids],
            )
          : [];
        for (const p of still)
          await transitionPayout(tx, scoped, p.id, "ready");
        await event(tx, scoped, "workspace.reinstated", tenantId, {
          suspensionId: s.id,
          releasedPayouts: still.length,
        });
        if (owner)
          await notifyUser(tx, scoped, {
            userId: owner,
            category: "account",
            dedupeKey: "workspace-reinstated:" + s.id,
            title: "Your coaching workspace is active again",
            body: "The platform team reinstated this workspace. Coaching, bookings, the public website and joining are available again, and held payouts return to finance review.",
            href: "/trainer",
            templateKey: "workspace-reinstated",
            source: { kind: "workspace_reinstatement", suspensionId: s.id },
          });
        return still.map((p) => p.id as string);
      });
      // The suspension notice is now misleading: undelivered email or device
      // jobs for it are closed (the in-app record stays as history). The owner
      // role is needed to see another member's notification.
      const superseded = await asTenant(
        tx,
        elevated("platform-operator", {
          tenantId,
          userId: a.userId,
          role: "owner",
        }),
        (tx) =>
          tx.query(
            "UPDATE jobs SET status='completed',leased_until=NULL,last_error='Superseded by workspace reinstatement' WHERE status='pending' AND kind IN ('email','push') AND data->>'notificationId' IN (SELECT id::text FROM notifications WHERE dedupe_key=$1) RETURNING id",
            ["workspace-suspension:" + s.id],
          ),
      );
      const [row] = await tx.query(
        "UPDATE workspace_suspensions SET status='lifted',lifted_by=$2,lifted_at=now(),lift_reason=$3,released_payouts=$4,revision=revision+1 WHERE id=$1 RETURNING *",
        [s.id, a.userId, input.reason, JSON.stringify(released)],
      );
      await audit(tx, a.userId, "workspace.reinstated", tenantId, s.id, {
        reason: input.reason,
        releasedPayouts: released.length,
        supersededNoticeJobs: superseded.length,
      });
      return { suspension: row, releasedPayouts: released };
    },
    { tenantId: tenantId },
  );
}

export async function lockAccount(
  db: Database,
  a: GovernanceIdentity,
  userId: string,
  input: { reason: string },
) {
  if (userId === a.userId)
    throw fail(409, "SELF_LOCK", "You cannot lock your own account.");
  return db.system(async (tx) => {
    await platformLock(tx);
    await currentSuperAdmin(tx, a.userId);
    const [target] = await tx.query(
      "SELECT id,platform_role FROM users WHERE id=$1 FOR UPDATE",
      [userId],
    );
    if (!target) throw fail(404, "ACCOUNT_NOT_FOUND", "Account unavailable.");
    if (await accountLocked(tx, userId))
      throw fail(
        409,
        "ACCOUNT_ALREADY_LOCKED",
        "This account is already locked.",
      );
    if (target.platform_role === "admin") {
      const [{ n }] = await tx.query(
        "SELECT count(*)::int AS n FROM users u WHERE u.platform_role='admin' AND u.id<>$1 AND NOT EXISTS(SELECT 1 FROM account_locks l WHERE l.user_id=u.id AND l.status='active')",
        [userId],
      );
      if (n < 1)
        throw fail(
          409,
          "LAST_SUPERADMIN",
          "The last active Super admin cannot be locked.",
        );
    }
    const revoked = await tx.query(
      "DELETE FROM sessions WHERE user_id=$1 RETURNING session_id",
      [userId],
    );
    await tx.query(
      "UPDATE one_time_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose IN ('magic','reset','verify') AND consumed_at IS NULL",
      [userId],
    );
    await tx.query("DELETE FROM auth_passkey_challenges WHERE user_id=$1", [
      userId,
    ]);
    const [row] = await tx.query(
      "INSERT INTO account_locks(id,user_id,reason,locked_by,sessions_revoked) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [randomUUID(), userId, input.reason, a.userId, revoked.length],
    );
    await audit(tx, a.userId, "account.locked", null, userId, {
      lockId: row.id,
      reason: input.reason,
      sessionsRevoked: revoked.length,
      platformRole: target.platform_role,
    });
    return { lock: row, sessionsRevoked: revoked.length };
  });
}

/**
 * Owner request (7 October 2026): a Super admin can confirm an account's
 * email address without the emailed code, for test accounts while email
 * delivery is off. Audited with the reason; the person gets an account notice.
 */
export async function verifyAccountEmail(
  db: Database,
  a: GovernanceIdentity,
  userId: string,
  input: { reason: string },
) {
  return db.system(async (tx) => {
    await currentSuperAdmin(tx, a.userId);
    const [target] = await tx.query(
      "SELECT id,email,email_verified FROM users WHERE id=$1 FOR UPDATE",
      [userId],
    );
    if (!target || String(target.email).endsWith("@deleted.invalid"))
      throw fail(404, "ACCOUNT_NOT_FOUND", "Account unavailable.");
    if (target.email_verified)
      throw fail(
        409,
        "EMAIL_ALREADY_VERIFIED",
        "This email address is already confirmed.",
      );
    await tx.query("UPDATE users SET email_verified=true WHERE id=$1", [
      userId,
    ]);
    await audit(tx, a.userId, "account.email_verified_by_operator", null, userId, {
      reason: input.reason,
    });
    await addAccountNotice(
      tx,
      userId,
      "email_verified_by_support",
      "Email address confirmed by support",
      "A trainsyou Super admin confirmed your email address for this account.",
    );
    return { emailVerified: true };
  });
}

export async function unlockAccount(
  db: Database,
  a: GovernanceIdentity,
  userId: string,
  input: { lockId: string; revision: number; reason: string },
) {
  return db.system(async (tx) => {
    await platformLock(tx);
    await currentSuperAdmin(tx, a.userId);
    await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const [lock] = await tx.query(
      "SELECT * FROM account_locks WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [input.lockId, userId],
    );
    if (!lock || lock.status !== "active" || lock.revision !== input.revision)
      throw conflict();
    const [row] = await tx.query(
      "UPDATE account_locks SET status='lifted',lifted_by=$2,lifted_at=now(),lift_reason=$3,revision=revision+1 WHERE id=$1 RETURNING *",
      [lock.id, a.userId, input.reason],
    );
    await audit(tx, a.userId, "account.unlocked", null, userId, {
      lockId: lock.id,
      reason: input.reason,
    });
    return { lock: row };
  });
}

export function registerGovernance(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => GovernanceIdentity,
) {
  const operator = (req: FastifyRequest, roles: string[]) => {
    const a = identity(req);
    if (!roles.includes(a.platformRole))
      throw fail(
        403,
        "OPERATOR_SCOPE",
        "Your operator role does not allow workspace and account governance.",
      );
    requireRecentMfa(a, true);
    return a;
  };
  const superAdmin = (req: FastifyRequest) => operator(req, ["admin"]);
  const tenantParam = (req: FastifyRequest) =>
    uuid.parse((req.params as any).tenantId);
  const userParam = (req: FastifyRequest) =>
    uuid.parse((req.params as any).userId);

  // Member-facing: the workspace state and the notice for the team.
  app.get("/api/v1/workspace/status", async (req) => {
    const a = identity(req);
    const [row] = await db.system((tx) =>
      tx.query(
        "SELECT t.name,t.lifecycle_state,s.suspended_at,s.notice FROM tenants t LEFT JOIN workspace_suspensions s ON s.tenant_id=t.id AND s.status='active' WHERE t.id=$1",
        [a.tenantId],
      ),
    );
    const team = ["owner", "staff", "finance"].includes(a.role);
    return {
      state: row?.lifecycle_state ?? "closed",
      workspace: { name: row?.name ?? "" },
      role: a.role,
      ...(row?.lifecycle_state === "suspended"
        ? {
            suspendedAt: row.suspended_at,
            message: workspaceSuspendedMessage(),
            notice: team && row.notice ? row.notice : null,
          }
        : {}),
      supportEmail: runtimeConfig().SUPPORT_EMAIL || null,
    };
  });

  app.get("/api/v1/admin/governance/workspaces", async (req) => {
    const a = operator(req, ["admin", "support"]);
    const q = z
      .object({
        q: z.string().trim().max(100).default(""),
        state: z.enum(["", "active", "suspended", "closed"]).default(""),
        page: z.coerce.number().int().min(0).max(1000).default(0),
      })
      .parse(req.query);
    return db.system(async (tx) => {
      const rows = await tx.query(
        "SELECT t.id,t.slug,t.name,t.published,t.lifecycle_state,t.created_at,(SELECT jsonb_build_object('id',u.id,'name',u.name,'email',u.email) FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=t.id AND m.role='owner' ORDER BY m.user_id LIMIT 1) AS owner,(SELECT count(*)::int FROM memberships m WHERE m.tenant_id=t.id AND m.role='subscriber') AS followers," +
          platformWorkspaceSql("t.id") +
          " AS platform_workspace,(SELECT jsonb_build_object('id',s.id,'revision',s.revision,'reason',s.reason,'notice',s.notice,'suspendedAt',s.suspended_at,'suspendedBy',s.suspended_by,'heldPayouts',jsonb_array_length(s.held_payouts),'financeFollowupId',s.finance_followup_id) FROM workspace_suspensions s WHERE s.tenant_id=t.id AND s.status='active') AS suspension FROM tenants t WHERE ($1='' OR position(lower($1) in lower(t.name))>0 OR position(lower($1) in lower(t.slug))>0) AND ($2='' OR t.lifecycle_state=$2) ORDER BY t.created_at DESC,t.id LIMIT 51 OFFSET $3",
        [q.q, q.state, q.page * 50],
      );
      const [counts] = await tx.query(
        "SELECT count(*) FILTER(WHERE lifecycle_state='active')::int AS active,count(*) FILTER(WHERE lifecycle_state='suspended')::int AS suspended,count(*) FILTER(WHERE lifecycle_state='closed')::int AS closed FROM tenants",
      );
      await audit(tx, a.userId, "governance.workspaces.read", null, null, {
        state: q.state,
        page: q.page,
      });
      return {
        workspaces: rows.slice(0, 50),
        hasMore: rows.length > 50,
        page: q.page,
        counts,
        canAct: a.platformRole === "admin",
      };
    });
  });
  app.get(
    "/api/v1/admin/governance/workspaces/:tenantId/history",
    async (req) => {
      const a = operator(req, ["admin", "support"]),
        tenantId = tenantParam(req);
      return db.system(async (tx) => {
        const rows = await tx.query(
          "SELECT s.id,s.status,s.reason,s.notice,s.suspended_at,su.name AS suspended_by,s.lifted_at,lu.name AS lifted_by,s.lift_reason,jsonb_array_length(s.held_payouts) AS held_payouts,jsonb_array_length(s.released_payouts) AS released_payouts,s.revision FROM workspace_suspensions s JOIN users su ON su.id=s.suspended_by LEFT JOIN users lu ON lu.id=s.lifted_by WHERE s.tenant_id=$1 ORDER BY s.suspended_at DESC LIMIT 50",
          [tenantId],
        );
        await audit(
          tx,
          a.userId,
          "governance.workspace_history.read",
          tenantId,
          null,
        );
        return { history: rows };
      });
    },
  );
  app.post(
    "/api/v1/admin/governance/workspaces/:tenantId/suspend",
    async (req) => {
      const a = superAdmin(req),
        tenantId = tenantParam(req),
        b = z
          .object({
            reason,
            notice: z.string().trim().max(500).optional(),
          })
          .strict()
          .parse(req.body);
      return suspendWorkspace(db, a, tenantId, b);
    },
  );
  app.post(
    "/api/v1/admin/governance/workspaces/:tenantId/reinstate",
    async (req) => {
      const a = superAdmin(req),
        tenantId = tenantParam(req),
        b = z
          .object({
            suspensionId: uuid,
            revision: z.number().int().positive(),
            reason,
          })
          .strict()
          .parse(req.body);
      return reinstateWorkspace(db, a, tenantId, b);
    },
  );

  app.get("/api/v1/admin/governance/accounts", async (req) => {
    const a = superAdmin(req);
    const q = z
      .object({
        email: z
          .email()
          .transform((v) => v.toLowerCase())
          .optional(),
      })
      .parse(req.query);
    return db.system(async (tx) => {
      const locked = await tx.query(
        "SELECT l.id,l.user_id,l.reason,l.locked_at,l.revision,l.sessions_revoked,u.name,u.email,u.platform_role,lb.name AS locked_by FROM account_locks l JOIN users u ON u.id=l.user_id JOIN users lb ON lb.id=l.locked_by WHERE l.status='active' ORDER BY l.locked_at DESC LIMIT 100",
      );
      let account: any = null;
      if (q.email) {
        const [u] = await tx.query(
          "SELECT u.id,u.name,u.email,u.platform_role,u.email_verified,coalesce(s.enabled,false) AS mfa_enabled,u.created_at FROM users u LEFT JOIN user_security s ON s.user_id=u.id WHERE u.email=$1",
          [q.email],
        );
        if (u)
          account = {
            ...u,
            memberships: await tx.query(
              "SELECT m.tenant_id,t.name,t.lifecycle_state,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 ORDER BY t.name LIMIT 100",
              [u.id],
            ),
            activeSessions: (
              await tx.query(
                "SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND expires_at>now()",
                [u.id],
              )
            )[0].n,
            locks: await tx.query(
              "SELECT l.id,l.status,l.reason,l.locked_at,lb.name AS locked_by,l.lifted_at,fb.name AS lifted_by,l.lift_reason,l.sessions_revoked,l.revision FROM account_locks l JOIN users lb ON lb.id=l.locked_by LEFT JOIN users fb ON fb.id=l.lifted_by WHERE l.user_id=$1 ORDER BY l.locked_at DESC LIMIT 20",
              [u.id],
            ),
            self: u.id === a.userId,
          };
        await audit(
          tx,
          a.userId,
          "governance.account.read",
          null,
          u?.id ?? null,
          {
            found: !!u,
          },
        );
      }
      return { locked, account };
    });
  });
  app.post(
    "/api/v1/admin/governance/accounts/:userId/verify-email",
    async (req) => {
      const a = superAdmin(req),
        userId = userParam(req),
        b = z.object({ reason }).strict().parse(req.body);
      return verifyAccountEmail(db, a, userId, b);
    },
  );
  app.post("/api/v1/admin/governance/accounts/:userId/lock", async (req) => {
    const a = superAdmin(req),
      userId = userParam(req),
      b = z.object({ reason }).strict().parse(req.body);
    return lockAccount(db, a, userId, b);
  });
  app.post("/api/v1/admin/governance/accounts/:userId/unlock", async (req) => {
    const a = superAdmin(req),
      userId = userParam(req),
      b = z
        .object({
          lockId: uuid,
          revision: z.number().int().positive(),
          reason,
        })
        .strict()
        .parse(req.body);
    return unlockAccount(db, a, userId, b);
  });
}
