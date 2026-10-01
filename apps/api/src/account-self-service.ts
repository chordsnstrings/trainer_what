import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Database, Tx } from "@trainer/db";
import {
  OIDC_PROVIDER_IDS,
  OIDC_PROVIDERS,
  isOidcProvider,
  oidcClientConfig,
} from "../../../packages/providers/src/oidc.ts";
import { newToken, passwordHash, passwordMatches, tokenHash } from "./auth.ts";
import {
  accountAudit,
  accountHost,
  accountMembership,
  queueAccountEmail,
  requireEmailConfiguration,
} from "./account-completion.ts";
import { authenticatorRequired, consumeMfa } from "./security.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";

type AccountIdentity = Actor & {
  email: string;
  name?: string;
  emailVerified?: boolean;
  mfaAt?: string | null;
  platformRole?: string;
};
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const plainText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "Use plain text");
const code = z
  .string()
  .regex(/^\d{6}$/, "Enter the six-digit authenticator code")
  .optional();
const address = z
  .email()
  .max(320)
  .transform((v) => v.toLowerCase());

/** Only scrypt hashes are usable; OIDC-created and erased accounts hold a marker. */
export const usablePassword = (hash: unknown) =>
  typeof hash === "string" && hash.startsWith("scrypt:");
export const unusablePassword = () => "unusable:" + randomUUID();
export function emailDeliveryConfigured() {
  try {
    requireEmailConfiguration();
    return true;
  } catch {
    return false;
  }
}
export function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, local.length - 2)))}@${domain}`;
}
/** Account-level in-app notice, visible from any workspace. Service connection only. */
export async function addAccountNotice(
  tx: Tx,
  userId: string,
  kind: string,
  title: string,
  body: string,
  tenantId?: string,
) {
  await tx.query(
    "INSERT INTO account_notices(id,user_id,kind,title,body,tenant_id) VALUES($1,$2,$3,$4,$5,$6)",
    [
      randomUUID(),
      userId,
      kind,
      title.slice(0, 160),
      body.slice(0, 2000),
      tenantId ?? null,
    ],
  );
}
/**
 * Why a correctly authenticated person has no workspace to open: the latest
 * membership-exit notice, for the given workspace when one is implied (a
 * trainer's own address or a chosen workspace). Callers use it only after
 * the sign-in proof, including an enrolled authenticator, has succeeded.
 */
export async function membershipEndedError(
  tx: Tx,
  userId: string,
  tenantId: string | null,
) {
  const [notice] = await tx.query(
    "SELECT title,body FROM account_notices WHERE user_id=$1 AND kind IN ('membership_left','membership_removed') AND ($2::uuid IS NULL OR tenant_id=$2) ORDER BY created_at DESC LIMIT 1",
    [userId, tenantId],
  );
  return notice ? fail(403, "MEMBERSHIP_ENDED", notice.body) : null;
}
/** accountMembership(), but explains an ended membership after a sign-in proof. */
export async function signInMembership(
  tx: Tx,
  userId: string,
  host: Parameters<typeof accountMembership>[2],
  tenantId?: string,
) {
  try {
    return await accountMembership(tx, userId, host, tenantId);
  } catch (error: any) {
    if (error?.code !== "NO_MEMBERSHIP") throw error;
    throw (
      (await membershipEndedError(
        tx,
        userId,
        tenantId ?? (host.custom ? host.tenantId : null),
      )) ?? error
    );
  }
}
/** The workspace used for account emails and audit when none is implied. */
export async function latestMembership(tx: Tx, userId: string) {
  const [m] = await tx.query(
    "SELECT m.tenant_id,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND t.lifecycle_state='active' ORDER BY (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id=m.user_id AND s.tenant_id=m.tenant_id) DESC NULLS LAST,m.tenant_id LIMIT 1",
    [userId],
  );
  return m as { tenant_id: string; role: string } | undefined;
}
/**
 * Re-proves account ownership inside the caller's transaction: the current
 * password when one exists, otherwise a real sign-in (sessions.authenticated_at,
 * which a workspace switch does not renew) within the last ten minutes;
 * plus a fresh authenticator code whenever one is enrolled. Locks the user row.
 */
export async function confirmAccountOwner(
  tx: Tx,
  userId: string,
  sessionHash: string,
  proof: { password?: string; code?: string },
) {
  const [u] = await tx.query(
    "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
    [userId],
  );
  if (!u) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (usablePassword(u.password_hash)) {
    if (
      !proof.password ||
      !(await passwordMatches(proof.password, u.password_hash))
    )
      throw fail(401, "INVALID_PASSWORD", "Current password is incorrect");
  } else {
    const [s] = await tx.query(
      "SELECT authenticated_at>now()-interval '10 minutes' AS recent FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now()",
      [sessionHash, userId],
    );
    if (!s?.recent)
      throw fail(
        403,
        "REAUTH_REQUIRED",
        "Sign in again, then repeat this change within ten minutes.",
      );
  }
  const [security] = await tx.query(
    "SELECT enabled FROM user_security WHERE user_id=$1",
    [userId],
  );
  if (security?.enabled) {
    if (!proof.code && authenticatorRequired())
      throw fail(
        401,
        "MFA_REQUIRED",
        "Enter a fresh six-digit authenticator code",
      );
    await consumeMfa(tx, userId, proof.code);
  }
  return { mfa: !!security?.enabled };
}
/** Password, active passkeys and linked identities that could still sign in. */
export async function signInMethodCount(
  tx: Tx,
  userId: string,
  excludeIdentity?: string,
) {
  const [row] = await tx.query(
    "SELECT (SELECT CASE WHEN password_hash LIKE 'scrypt:%' THEN 1 ELSE 0 END FROM users WHERE id=$1)+(SELECT count(*)::int FROM auth_passkeys WHERE user_id=$1 AND revoked_at IS NULL)+(SELECT count(*)::int FROM account_identities WHERE user_id=$1 AND id IS DISTINCT FROM $2::uuid) AS n",
    [userId, excludeIdentity ?? null],
  );
  return Number(row?.n ?? 0);
}

export function registerAccountSelfService(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => AccountIdentity,
) {
  const rate = { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } };
  const sessionHash = (req: FastifyRequest) =>
    tokenHash(req.cookies.session ?? "");

  app.get("/api/v1/account", async (req) => {
    const a = identity(req),
      host = accountHost(req),
      current = sessionHash(req);
    return db.system(async (tx) => {
      const [u] = await tx.query(
        "SELECT name,email,email_verified,password_hash LIKE 'scrypt:%' AS has_password,platform_role FROM users WHERE id=$1",
        [a.userId],
      );
      const [security] = await tx.query(
        "SELECT enabled FROM user_security WHERE user_id=$1",
        [a.userId],
      );
      const [pending] = await tx.query(
        "SELECT new_email,expires_at FROM email_change_requests WHERE user_id=$1 AND completed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()",
        [a.userId],
      );
      const identities = await tx.query(
        "SELECT provider,email,created_at,last_used_at FROM account_identities WHERE user_id=$1 ORDER BY provider",
        [a.userId],
      );
      const notices = await tx.query(
        "SELECT id,kind,title,body,created_at,read_at FROM account_notices WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",
        [a.userId],
      );
      const [passkeys] = await tx.query(
        "SELECT count(*)::int n FROM auth_passkeys WHERE user_id=$1 AND revoked_at IS NULL",
        [a.userId],
      );
      const [session] = await tx.query(
        "SELECT authenticated_at>now()-interval '10 minutes' AS recent FROM sessions WHERE token_hash=$1 AND user_id=$2",
        [current, a.userId],
      );
      return {
        profile: {
          name: u.name,
          email: u.email,
          emailVerified: u.email_verified,
          hasPassword: u.has_password,
          mfaEnabled: !!security?.enabled,
          platformRole: u.platform_role,
        },
        pendingEmailChange: pending
          ? { newEmail: pending.new_email, expiresAt: pending.expires_at }
          : null,
        identities: identities.map((row) => ({
          provider: row.provider,
          email: row.email,
          linkedAt: row.created_at,
          lastUsedAt: row.last_used_at,
        })),
        providers: OIDC_PROVIDER_IDS.map((id) => ({
          id,
          name: OIDC_PROVIDERS[id].name,
          // Provider callbacks are registered for the platform address only.
          enabled: !host.custom && !!oidcClientConfig(id),
          linked: identities.some((row) => row.provider === id),
        })),
        passkeys: Number(passkeys?.n ?? 0),
        notices: notices.map((n) => ({
          id: n.id,
          kind: n.kind,
          title: n.title,
          body: n.body,
          createdAt: n.created_at,
          readAt: n.read_at,
        })),
        emailDelivery: { configured: emailDeliveryConfigured() },
        recentSignIn: !!session?.recent,
        workspace: { tenantId: a.tenantId, role: a.role },
      };
    });
  });

  app.patch("/api/v1/account/profile", rate, async (req) => {
    const a = identity(req);
    const b = z
      .object({ name: plainText(2, 100) })
      .strict()
      .parse(req.body);
    await db.system(async (tx) => {
      const [before] = await tx.query(
        "SELECT name FROM users WHERE id=$1 FOR UPDATE",
        [a.userId],
      );
      if (before?.name === b.name) return;
      await tx.query("UPDATE users SET name=$2 WHERE id=$1", [
        a.userId,
        b.name,
      ]);
      // The audit records that the name changed, not the name itself.
      await accountAudit(tx, a, "account.name_changed", a.userId, {
        fields: ["name"],
      });
    });
    return { ok: true, name: b.name };
  });

  app.post("/api/v1/account/email", rate, async (req) => {
    const a = identity(req);
    const b = z
      .object({
        email: address,
        password: z.string().max(128).optional(),
        code,
      })
      .strict()
      .parse(req.body);
    // Same behaviour as forgot-password: without production email delivery
    // the change cannot be verified, so it is refused before any lookup.
    requireEmailConfiguration();
    const host = accountHost(req),
      token = newToken(),
      current = sessionHash(req);
    await db.system(async (tx) => {
      await workspaceLock(tx, a.tenantId);
      await accountMembership(tx, a.userId, host, a.tenantId);
      await confirmAccountOwner(tx, a.userId, current, b);
      const [u] = await tx.query("SELECT email FROM users WHERE id=$1", [
        a.userId,
      ]);
      if (u.email === b.email)
        throw fail(
          400,
          "EMAIL_UNCHANGED",
          "This is already your sign-in email address",
        );
      await tx.query(
        "UPDATE email_change_requests SET cancelled_at=now() WHERE user_id=$1 AND completed_at IS NULL AND cancelled_at IS NULL",
        [a.userId],
      );
      const id = randomUUID();
      await tx.query(
        "INSERT INTO email_change_requests(id,user_id,tenant_id,old_email,new_email,token_hash,origin,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '30 minutes')",
        [
          id,
          a.userId,
          a.tenantId,
          u.email,
          b.email,
          tokenHash(token),
          host.origin,
        ],
      );
      const [taken] = await tx.query("SELECT id FROM users WHERE email=$1", [
        b.email,
      ]);
      // The response never reveals whether another account uses the address;
      // the new address learns why no link arrived.
      if (taken)
        await queueAccountEmail(
          tx,
          a,
          b.email,
          "Email change not possible",
          "Someone asked to move an account to this address, but the address already belongs to an account, so no change was made. If this was you, sign in with this address instead or choose another one.",
          "email-change-taken:" + id,
        );
      else
        await queueAccountEmail(
          tx,
          a,
          b.email,
          "Confirm your new email address",
          `${host.origin}/verify-email-change/${token}\nOpen this link to confirm your new sign-in email. It expires in 30 minutes. Nothing changes until you confirm.`,
          "email-change:" + tokenHash(token),
          30,
        );
      await queueAccountEmail(
        tx,
        a,
        u.email,
        "Email change requested",
        `A request was made to change your sign-in email to ${maskEmail(b.email)}. It applies only after the new address is confirmed. If this was not you, change your password and contact support.`,
        "email-change-notice:" + id,
      );
      await accountAudit(tx, a, "account.email_change_requested", a.userId);
    });
    return {
      ok: true,
      message:
        "Check the new address for a confirmation link. Your email changes only after you open it within 30 minutes.",
    };
  });

  app.post("/api/v1/account/email/cancel", rate, async (req) => {
    const a = identity(req);
    await db.system(async (tx) => {
      const rows = await tx.query(
        "UPDATE email_change_requests SET cancelled_at=now() WHERE user_id=$1 AND completed_at IS NULL AND cancelled_at IS NULL RETURNING id",
        [a.userId],
      );
      if (rows.length)
        await accountAudit(tx, a, "account.email_change_cancelled", a.userId);
    });
    return { ok: true };
  });

  app.post("/api/v1/account/email/confirm", rate, async (req) => {
    const b = z
      .object({ token: z.string().min(20).max(200) })
      .strict()
      .parse(req.body);
    const host = accountHost(req),
      current = req.cookies.session ? sessionHash(req) : null;
    let outcome: { error?: { status: number; code: string; message: string } };
    try {
      outcome = await db.system(async (tx) => {
        const [initial] = await tx.query(
          "SELECT id,user_id,tenant_id FROM email_change_requests WHERE token_hash=$1 AND completed_at IS NULL AND cancelled_at IS NULL AND expires_at>now()",
          [tokenHash(b.token)],
        );
        if (!initial)
          throw fail(400, "LINK_EXPIRED", "This link is invalid or expired");
        await workspaceLock(tx, initial.tenant_id);
        const [u] = await tx.query(
          "SELECT id,email FROM users WHERE id=$1 FOR UPDATE",
          [initial.user_id],
        );
        const [r] = await tx.query(
          "SELECT * FROM email_change_requests WHERE id=$1 AND completed_at IS NULL AND cancelled_at IS NULL AND expires_at>now() FOR UPDATE",
          [initial.id],
        );
        if (!r || r.origin !== host.origin)
          throw fail(
            400,
            "LINK_EXPIRED",
            "This link is invalid, expired or belongs to another address",
          );
        const cancel = () =>
          tx.query(
            "UPDATE email_change_requests SET cancelled_at=now() WHERE id=$1",
            [r.id],
          );
        if (u.email !== r.old_email) {
          await cancel();
          return {
            error: {
              status: 409,
              code: "EMAIL_CHANGED",
              message:
                "Your sign-in email changed after this link was sent. Request a new change.",
            },
          };
        }
        const [taken] = await tx.query(
          "SELECT id FROM users WHERE email=$1 AND id<>$2 FOR UPDATE",
          [r.new_email, u.id],
        );
        if (taken) {
          await cancel();
          return {
            error: {
              status: 409,
              code: "EMAIL_IN_USE",
              message:
                "Another account now uses this address, so the change was not applied.",
            },
          };
        }
        // The unique email constraint is the final guard against a concurrent
        // sign-up or change taking the same address.
        await tx.query(
          "UPDATE users SET email=$2,email_verified=true WHERE id=$1",
          [u.id, r.new_email],
        );
        await tx.query(
          "UPDATE email_change_requests SET completed_at=now() WHERE id=$1",
          [r.id],
        );
        // Links sent to the previous address stop working; other devices sign in again.
        await tx.query(
          "UPDATE one_time_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose IN ('magic','reset','verify') AND consumed_at IS NULL",
          [u.id],
        );
        await tx.query(
          "DELETE FROM sessions WHERE user_id=$1 AND token_hash IS DISTINCT FROM $2",
          [u.id, current],
        );
        await addAccountNotice(
          tx,
          u.id,
          "email_changed",
          "Email address changed",
          `Your sign-in email is now ${r.new_email}. Other devices were signed out.`,
        );
        const m =
          (
            await tx.query(
              "SELECT m.tenant_id,m.role FROM memberships m WHERE m.user_id=$1 AND m.tenant_id=$2",
              [u.id, r.tenant_id],
            )
          )[0] ?? (await latestMembership(tx, u.id));
        if (m) {
          const actor = { tenantId: m.tenant_id, userId: u.id, role: m.role };
          await accountAudit(tx, actor, "account.email_changed", u.id);
          await queueAccountEmail(
            tx,
            actor,
            r.old_email,
            "Your email address was changed",
            `The sign-in email for your account was changed to ${maskEmail(r.new_email)}. If you did not make this change, contact support immediately.`,
            "email-changed:" + r.id,
          );
        }
        return {};
      });
    } catch (error: any) {
      if (error?.code === "23505")
        throw fail(
          409,
          "EMAIL_IN_USE",
          "Another account now uses this address, so the change was not applied.",
        );
      throw error;
    }
    if (outcome.error)
      throw fail(
        outcome.error.status,
        outcome.error.code,
        outcome.error.message,
      );
    return {
      ok: true,
      message: "Your email address is confirmed and now used for sign-in.",
    };
  });

  app.post("/api/v1/account/password/set", rate, async (req) => {
    const a = identity(req);
    const b = z
      .object({ password: z.string().min(12).max(128), code })
      .strict()
      .parse(req.body);
    const hash = await passwordHash(b.password),
      current = sessionHash(req);
    await db.system(async (tx) => {
      const [u] = await tx.query(
        "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
        [a.userId],
      );
      if (usablePassword(u?.password_hash))
        throw fail(
          409,
          "PASSWORD_EXISTS",
          "This account already has a password. Use Change password instead.",
        );
      await confirmAccountOwner(tx, a.userId, current, { code: b.code });
      await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
        a.userId,
        hash,
      ]);
      await tx.query(
        "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2",
        [a.userId, current],
      );
      await accountAudit(tx, a, "security.password_set", a.userId);
    });
    return {
      ok: true,
      message: "Password saved. Other devices were signed out.",
    };
  });

  app.post("/api/v1/account/identities/:provider/unlink", rate, async (req) => {
    const a = identity(req),
      provider = (req.params as any).provider;
    if (!isOidcProvider(provider))
      throw fail(404, "NOT_FOUND", "Sign-in method unavailable");
    const b = z
      .object({ password: z.string().max(128).optional(), code })
      .strict()
      .parse(req.body ?? {});
    const current = sessionHash(req);
    await db.system(async (tx) => {
      await workspaceLock(tx, a.tenantId);
      await confirmAccountOwner(tx, a.userId, current, b);
      const [linked] = await tx.query(
        "SELECT id FROM account_identities WHERE user_id=$1 AND provider=$2 FOR UPDATE",
        [a.userId, provider],
      );
      if (!linked)
        throw fail(404, "NOT_FOUND", "This sign-in method is not linked");
      if ((await signInMethodCount(tx, a.userId, linked.id)) < 1)
        throw fail(
          409,
          "LAST_SIGN_IN_METHOD",
          "Set a password or add a passkey before removing your only sign-in method.",
        );
      await tx.query("DELETE FROM account_identities WHERE id=$1", [linked.id]);
      await addAccountNotice(
        tx,
        a.userId,
        "identity_unlinked",
        `${OIDC_PROVIDERS[provider].name} sign-in removed`,
        `Your account no longer accepts ${OIDC_PROVIDERS[provider].name} sign-in.`,
      );
      await accountAudit(tx, a, "security.identity_unlinked", a.userId, {
        provider,
      });
    });
    return { ok: true };
  });

  app.post("/api/v1/account/notices/read", rate, async (req) => {
    const a = identity(req);
    const b = z
      .object({ ids: z.array(z.string().uuid()).max(50).optional() })
      .strict()
      .parse(req.body ?? {});
    await db.system((tx) =>
      tx.query(
        "UPDATE account_notices SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[]))",
        [a.userId, b.ids ?? null],
      ),
    );
    return { ok: true };
  });
}
