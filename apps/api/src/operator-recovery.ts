import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Database, SystemTx, Tx } from "@trainer/db";
import { newToken, passwordHash, tokenHash } from "./auth.ts";
import {
  accountAudit,
  accountHost,
  queueAccountEmail,
} from "./account-completion.ts";
import {
  authenticatorRequired,
  consumeMfa,
  requireRecentMfa,
  switchableCode,
} from "./security.ts";
import {
  addAccountNotice,
  emailDeliveryConfigured,
  latestMembership,
} from "./account-self-service.ts";

/**
 * Operator-assisted account recovery for a member who cannot use email. A
 * Superadmin, or a support operator for non-platform accounts, records a
 * reason and proves a current authenticator code; the one-time link is shown
 * once to the operator and expires after 30 minutes. Using it sets a new
 * password and signs out every session. It never replaces the member's own
 * authenticator: an enrolled authenticator is still required to use the link.
 * The separate host-only authenticator reset (operator-actions.ts) is unchanged.
 * Trainers have no route here.
 */
type OperatorIdentity = Actor & {
  platformRole: string;
  mfaAt?: string | null;
};
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
export const RECOVERY_LINK_MINUTES = 30;
const OPERATOR_DAILY_LIMIT = 20;
const TARGET_DAILY_LIMIT = 3;
const MAX_ATTEMPTS = 5;
const operatorRoles = ["admin", "support"];

async function adminAudit(
  tx: Tx,
  actorId: string,
  action: string,
  subjectId: string,
  data: Record<string, unknown>,
) {
  await tx.query(
    "INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), actorId, action, subjectId, JSON.stringify(data)],
  );
}
async function notifyByEmail(
  tx: SystemTx,
  userId: string,
  email: string,
  subject: string,
  text: string,
  intent: string,
) {
  // Queued only while delivery is configured, so a security notice is never
  // delivered long after the event it describes.
  if (!emailDeliveryConfigured()) return false;
  const m = await latestMembership(tx, userId);
  if (!m) return false;
  await queueAccountEmail(
    tx,
    { tenantId: m.tenant_id, userId, role: m.role },
    email,
    subject,
    text,
    intent,
  );
  return true;
}

export function registerOperatorRecovery(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => OperatorIdentity,
) {
  const operator = (req: FastifyRequest) => {
    const a = identity(req);
    if (!operatorRoles.includes(a.platformRole))
      throw fail(
        403,
        "OPERATOR_SCOPE",
        "Only a Superadmin or support operator can manage account recovery.",
      );
    return a;
  };
  const publicRate = {
    config: { rateLimit: { max: 8, timeWindow: "10 minutes" } },
  };

  app.post(
    "/api/v1/admin/account-recovery",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (req) => {
      const a = operator(req);
      const b = z
        .object({
          email: z
            .email()
            .max(320)
            .transform((v) => v.toLowerCase()),
          reason: z
            .string()
            .trim()
            .min(10)
            .max(500)
            .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "Use plain text"),
          code: switchableCode("Enter your current code"),
        })
        .strict()
        .parse(req.body);
      const host = accountHost(req);
      if (host.custom)
        throw fail(
          403,
          "PLATFORM_HOST_REQUIRED",
          "Account recovery uses the platform address.",
        );
      const token = newToken();
      const out = await db.system(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "account-recovery:" + a.userId,
        ]);
        const [op] = await tx.query(
          "SELECT u.platform_role,coalesce(s.enabled,false) AS mfa FROM users u LEFT JOIN user_security s ON s.user_id=u.id WHERE u.id=$1 FOR UPDATE OF u",
          [a.userId],
        );
        if (!operatorRoles.includes(op?.platform_role))
          throw fail(
            403,
            "OPERATOR_SCOPE",
            "Your operator role changed. Sign in again.",
          );
        if (!op.mfa && authenticatorRequired())
          throw fail(
            403,
            "OPERATOR_MFA_REQUIRED",
            "Enable your authenticator before issuing recovery links.",
          );
        // The fresh authenticator check: this request's code is consumed.
        await consumeMfa(tx, a.userId, b.code);
        const [target] = await tx.query(
          "SELECT id,email,name,platform_role FROM users WHERE email=$1 FOR UPDATE",
          [b.email],
        );
        if (!target || String(target.email).endsWith("@deleted.invalid"))
          throw fail(404, "ACCOUNT_NOT_FOUND", "No account uses this email.");
        if (target.id === a.userId)
          throw fail(
            400,
            "SELF_RECOVERY",
            "Use your own recovery code or another Superadmin for your account.",
          );
        if (op.platform_role !== "admin" && target.platform_role !== "none")
          throw fail(
            403,
            "OPERATOR_SCOPE",
            "Only a Superadmin can issue recovery links for platform accounts.",
          );
        const [{ n: issued }] = await tx.query(
          "SELECT count(*)::int n FROM account_recovery_grants WHERE issued_by=$1 AND created_at>now()-interval '24 hours'",
          [a.userId],
        );
        if (issued >= OPERATOR_DAILY_LIMIT)
          throw fail(
            429,
            "RECOVERY_LIMIT",
            "You have reached today's recovery link limit.",
          );
        const [{ n: received }] = await tx.query(
          "SELECT count(*)::int n FROM account_recovery_grants WHERE user_id=$1 AND created_at>now()-interval '24 hours'",
          [target.id],
        );
        if (received >= TARGET_DAILY_LIMIT)
          throw fail(
            429,
            "RECOVERY_LIMIT",
            "This account already received three recovery links today.",
          );
        await tx.query(
          "UPDATE account_recovery_grants SET revoked_at=now() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL",
          [target.id],
        );
        const id = randomUUID();
        const [grant] = await tx.query(
          "INSERT INTO account_recovery_grants(id,user_id,issued_by,token_hash,reason,origin,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+make_interval(mins=>$7::int)) RETURNING expires_at",
          [
            id,
            target.id,
            a.userId,
            tokenHash(token),
            b.reason,
            host.origin,
            RECOVERY_LINK_MINUTES,
          ],
        );
        await adminAudit(
          tx,
          a.userId,
          "account.recovery_link_issued",
          target.id,
          {
            grantId: id,
            reason: b.reason,
            expiresAt: grant.expires_at,
          },
        );
        await addAccountNotice(
          tx,
          target.id,
          "recovery_link_issued",
          "Account recovery link issued",
          "A support operator created a one-time password recovery link for your account. If you did not ask for help, contact support.",
        );
        const emailed = await notifyByEmail(
          tx,
          target.id,
          target.email,
          "An account recovery link was created",
          `A support operator created a one-time password recovery link for your account after a support request. It expires in ${RECOVERY_LINK_MINUTES} minutes and is shared only with the verified account holder. If you did not ask for help, contact support immediately.`,
          "recovery-issued:" + id,
        );
        return {
          id,
          expiresAt: grant.expires_at,
          name: target.name as string,
          emailed,
        };
      });
      return {
        ...out,
        url: `${host.origin}/account-recovery/${token}`,
        message: `Share this link only with the verified account holder. It is shown once and expires in ${RECOVERY_LINK_MINUTES} minutes.`,
      };
    },
  );

  app.get("/api/v1/admin/account-recovery", async (req) => {
    const a = operator(req);
    requireRecentMfa(a, true);
    const grants = await db.system((tx) =>
      tx.query(
        "SELECT g.id,g.reason,g.created_at,g.expires_at,g.consumed_at,g.revoked_at,t.email AS target_email,t.name AS target_name,o.name AS issued_by FROM account_recovery_grants g JOIN users t ON t.id=g.user_id JOIN users o ON o.id=g.issued_by WHERE ($1::boolean OR g.issued_by=$2) ORDER BY g.created_at DESC LIMIT 50",
        [a.platformRole === "admin", a.userId],
      ),
    );
    return {
      grants: grants.map((g) => ({
        id: g.id,
        reason: g.reason,
        createdAt: g.created_at,
        expiresAt: g.expires_at,
        targetEmail: g.target_email,
        targetName: g.target_name,
        issuedBy: g.issued_by,
        status: g.consumed_at
          ? "used"
          : g.revoked_at
            ? "revoked"
            : new Date(g.expires_at).getTime() <= Date.now()
              ? "expired"
              : "active",
      })),
    };
  });

  app.post("/api/v1/admin/account-recovery/:id/revoke", async (req) => {
    const a = operator(req);
    requireRecentMfa(a, true);
    const id = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    await db.system(async (tx) => {
      const [g] = await tx.query(
        "UPDATE account_recovery_grants SET revoked_at=now() WHERE id=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND ($2::boolean OR issued_by=$3) RETURNING user_id",
        [id, a.platformRole === "admin", a.userId],
      );
      if (!g)
        throw fail(
          409,
          "RECOVERY_CHANGED",
          "This link was already used, revoked or is unavailable.",
        );
      await adminAudit(
        tx,
        a.userId,
        "account.recovery_link_revoked",
        g.user_id,
        {
          grantId: id,
        },
      );
    });
    return { ok: true };
  });

  const tokenBody = z.object({ token: z.string().min(20).max(200) }).strict();
  /** `counted` is true once this attempt has been added to the grant's count. */
  async function liveGrant(
    tx: Tx,
    token: string,
    origin: string,
    counted = false,
  ) {
    const [g] = await tx.query(
      // The issuing operator must still hold an operator role that covers
      // this account: a demoted (for example compromised) support account's
      // open links stop working at once.
      "SELECT g.*,coalesce(s.enabled,false) AS mfa,u.name FROM account_recovery_grants g JOIN users u ON u.id=g.user_id JOIN users i ON i.id=g.issued_by LEFT JOIN user_security s ON s.user_id=g.user_id WHERE g.token_hash=$1 AND g.consumed_at IS NULL AND g.revoked_at IS NULL AND g.expires_at>now() AND (i.platform_role='admin' OR (i.platform_role='support' AND u.platform_role='none'))",
      [tokenHash(token)],
    );
    if (
      !g ||
      g.origin !== origin ||
      g.attempts > MAX_ATTEMPTS - (counted ? 0 : 1)
    )
      throw fail(
        400,
        "LINK_EXPIRED",
        "This recovery link is invalid, used or expired. Ask support for a new one.",
      );
    return g;
  }
  app.post("/api/v1/auth/account-recovery/inspect", publicRate, async (req) => {
    const b = tokenBody.parse(req.body);
    const g = await db.system((tx) =>
      liveGrant(tx, b.token, accountHost(req).origin),
    );
    return {
      valid: true,
      mfaRequired: g.mfa && authenticatorRequired(),
      expiresAt: g.expires_at,
    };
  });
  app.post("/api/v1/auth/account-recovery", publicRate, async (req, reply) => {
    const b = tokenBody
      .extend({
        password: z.string().min(12).max(128),
        code: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
      })
      .parse(req.body);
    const host = accountHost(req),
      hash = await passwordHash(b.password);
    // Count the attempt first so a wrong authenticator code still uses one.
    await db.system(async (tx) => {
      const g = await liveGrant(tx, b.token, host.origin);
      await tx.query(
        "UPDATE account_recovery_grants SET attempts=attempts+1 WHERE id=$1",
        [g.id],
      );
    });
    const result = await db.system(async (tx) => {
      const initial = await liveGrant(tx, b.token, host.origin, true);
      const [u] = await tx.query(
        "SELECT id,email FROM users WHERE id=$1 FOR UPDATE",
        [initial.user_id],
      );
      const [g] = await tx.query(
        "SELECT * FROM account_recovery_grants WHERE id=$1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",
        [initial.id],
      );
      if (!g)
        throw fail(
          400,
          "LINK_EXPIRED",
          "This recovery link is invalid, used or expired. Ask support for a new one.",
        );
      // The member's own authenticator is never bypassed by this link.
      const mfa = await consumeMfa(tx, u.id, b.code);
      await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
        u.id,
        hash,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose IN ('magic','reset') AND consumed_at IS NULL",
        [u.id],
      );
      await tx.query(
        "UPDATE account_recovery_grants SET consumed_at=now() WHERE id=$1",
        [g.id],
      );
      await adminAudit(tx, u.id, "account.recovery_link_used", u.id, {
        grantId: g.id,
        issuedBy: g.issued_by,
        authenticatorVerified: mfa,
      });
      const m = await latestMembership(tx, u.id);
      if (m)
        await accountAudit(
          tx,
          { tenantId: m.tenant_id, userId: u.id, role: m.role },
          "security.password_recovered",
          u.id,
          { method: "operator_link" },
        );
      await addAccountNotice(
        tx,
        u.id,
        "password_recovered",
        "Password changed with a recovery link",
        "Your password was changed with a support recovery link and every device was signed out.",
      );
      await notifyByEmail(
        tx,
        u.id,
        u.email,
        "Your password was changed",
        "Your password was changed with a one-time support recovery link and every device was signed out. If you did not do this, contact support immediately.",
        "recovery-used:" + g.id,
      );
      return { mfa };
    });
    reply.clearCookie("session", { path: "/" });
    return {
      ok: true,
      message: result.mfa
        ? "Password changed. Sign in with your new password and your authenticator."
        : "Password changed. Sign in with your new password.",
    };
  });
}
