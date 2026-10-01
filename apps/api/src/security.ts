import {
  accountAudit,
  accountHost,
  accountMembership,
  recentWorkspaceOrder,
  replaceRecoveryCodes,
  requireEmailConfiguration,
} from "./account-completion.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";
import type { HostContext } from "./host-routing.ts";
import {
  runtimeConfig,
  strictSecurity,
} from "../../../packages/providers/src/configuration.ts";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Database, Tx } from "@trainer/db";
import { event } from "@trainer/db";
import { ProviderUnavailable } from "@trainer/providers";
import { z } from "zod";
import {
  accountAttempts,
  clientSource,
  passwordHash,
  passwordMatches,
  newToken,
  tokenHash,
} from "./auth.ts";
import {
  openSealedValue,
  sealContexts,
  sealValue,
  SealingUnavailable,
} from "./sealing.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(bytes: Buffer) {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decode32(value: string) {
  let bits = 0,
    n = 0;
  const out = [];
  for (const c of value) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error("Invalid authenticator key");
    n = (n << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((n >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function keyUnavailable(error: unknown) {
  return error instanceof SealingUnavailable &&
    error.reason === "key_unavailable"
    ? new ProviderUnavailable(
        "security",
        "A 32-byte security encryption key must be configured",
      )
    : error;
}
function seal(userId: string, value: string) {
  try {
    return sealValue(sealContexts.authenticator(userId), value);
  } catch (error) {
    throw keyUnavailable(error);
  }
}
// Fail closed: an unreadable secret never counts as MFA being disabled. The
// subclass keeps ProviderUnavailable semantics for callers while telling the
// person how to recover.
class MfaKeyUnavailable extends ProviderUnavailable {
  code = "MFA_KEY_UNAVAILABLE";
  statusCode = 503;
  expose = true;
  constructor() {
    super(
      "security",
      "Your authenticator cannot be checked because the server security key is missing or has changed. Sign in with a passkey or use a recovery code, then set up your authenticator again. Without either, ask the platform host operator to reset your authenticator.",
    );
  }
}
/** Opens an authenticator secret with the active or a previous (rotation) key.
 * An unreadable secret is a configuration fault, never "MFA disabled". */
function openAuthenticator(userId: string, value: string) {
  try {
    return openSealedValue(sealContexts.authenticator(userId), value);
  } catch {
    throw new MfaKeyUnavailable();
  }
}
function open(userId: string, value: string) {
  return openAuthenticator(userId, value).value;
}
export function totpAt(secret: string, counter: number) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decode32(secret)).update(b).digest(),
    offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
function matchCounter(secret: string, code: string, last: number) {
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(Date.now() / 30000);
  for (const c of [now, now - 1, now + 1]) {
    if (
      c > last &&
      timingSafeEqual(Buffer.from(totpAt(secret, c)), Buffer.from(code))
    )
      return c;
  }
  return null;
}
/** Owner switch (1 Oct 2026): AUTHENTICATOR_REQUIRED="false" turns off every
 * authenticator demand (step-up, enrolment prerequisites, sign-in codes).
 * Anything else, including an unset variable, keeps it required. Passwords,
 * roles, CSRF and rate limits are unaffected. */
export function authenticatorRequired() {
  return process.env.AUTHENTICATOR_REQUIRED !== "false";
}
/** A six-digit code field: required unless the switch is off, when it may be
 * left out or empty. Checked per request, so the switch applies at once. */
export const switchableCode = (message: string) =>
  z
    .string()
    .regex(/^\d{6}$/, message)
    .or(z.literal(""))
    .optional()
    .transform((v, ctx) => {
      if (!v && authenticatorRequired()) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return v || undefined;
    });
export async function consumeMfa(tx: Tx, userId: string, code?: string) {
  const [s] = await tx.query(
    "SELECT * FROM user_security WHERE user_id=$1 FOR UPDATE",
    [userId],
  );
  if (!s?.enabled) return false;
  // Switched off: no code is demanded; a code that is entered still counts.
  if (!code && !authenticatorRequired()) return false;
  const secret = openAuthenticator(userId, s.totp_secret);
  const counter = matchCounter(
    secret.value,
    code ?? "",
    Number(s.last_counter),
  );
  if (counter === null)
    throw fail(
      401,
      "MFA_REQUIRED",
      "Enter a fresh six-digit authenticator code",
    );
  // Upgrade a secret still sealed with a legacy envelope or a previous key.
  await tx.query(
    "UPDATE user_security SET last_counter=$2,totp_secret=coalesce($3,totp_secret) WHERE user_id=$1",
    [
      userId,
      counter,
      secret.state === "active" ? null : seal(userId, secret.value),
    ],
  );
  return true;
}
export function requireRecentMfa(a: { mfaAt?: string | null }, force = false) {
  if (!authenticatorRequired()) return;
  if (!force && !strictSecurity()) return;
  const at = Date.parse(a.mfaAt ?? "");
  if (
    !Number.isFinite(at) ||
    at > Date.now() + 5000 ||
    Date.now() - at > 10 * 60 * 1000
  )
    throw fail(
      403,
      "MFA_STEP_UP",
      "Verify your authenticator in Account security before this action",
    );
}
export function securityRoutes(
  app: FastifyInstance,
  db: Database,
  identity: (
    r: FastifyRequest,
  ) => Actor & { email: string; emailVerified: boolean; mfaAt?: string | null },
) {
  const rate = { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } };
  const resetAttempts = accountAttempts();
  async function queueLink(
    user: any,
    tenantId: string,
    purpose: "reset" | "verify",
    host: HostContext,
  ) {
    requireEmailConfiguration();
    const token = newToken();
    await db.system(async (tx) => {
      await workspaceLock(tx, tenantId);
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
      const membership = await accountMembership(tx, user.id, host, tenantId);
      await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL",
        [user.id, purpose],
      );
      await tx.query(
        "INSERT INTO one_time_tokens(token_hash,purpose,user_id,tenant_id,payload,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes')",
        [
          tokenHash(token),
          purpose,
          user.id,
          tenantId,
          JSON.stringify({ origin: host.origin }),
        ],
      );
      // The link is a bearer credential: the worker removes the text after a
      // terminal outcome and never sends it after the link expires. Queued in
      // the recipient's own scope (an outbox insert needs no staff role).
      await tx.tenant(
        { tenantId, userId: user.id, role: membership.role },
        (tx) =>
          tx.query(
            "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,'email',$3,$4::jsonb||jsonb_build_object('expiresAt',now()+interval '30 minutes'))",
            [
              randomUUID(),
              tenantId,
              `${purpose}:${tokenHash(token)}`,
              JSON.stringify({
                to: user.email,
                category: "account",
                critical: true,
                sensitive: true,
                userId: user.id,
                subject:
                  purpose === "reset"
                    ? "Reset your password"
                    : "Verify your email",
                text: `${host.origin}/${purpose === "reset" ? "reset-password" : "verify-email"}/${token}\nThis link expires in 30 minutes.`,
              }),
            ],
          ),
      );
    });
  }
  app.get("/api/v1/auth/security", async (req) => {
    const a = identity(req);
    const [s] = await db.system((tx) =>
      tx.query(
        "SELECT (SELECT enabled FROM user_security WHERE user_id=$1) AS enabled,(SELECT password_hash LIKE 'scrypt:%' FROM users WHERE id=$1) AS has_password",
        [a.userId],
      ),
    );
    return {
      emailVerified: a.emailVerified,
      // Accounts created through Apple or Google set a password before an
      // authenticator, because both authenticator routes confirm with it.
      hasPassword: !!s?.has_password,
      mfaEnabled: s?.enabled ?? false,
      mfaConfigured: !!process.env.SECURITY_ENCRYPTION_KEY,
      mfaAt: a.mfaAt ?? null,
      authenticatorRequired: authenticatorRequired(),
    };
  });
  app.post("/api/v1/auth/request-verification", rate, async (req) => {
    const a = identity(req);
    if (!a.emailVerified)
      await queueLink(
        { id: a.userId, email: a.email },
        a.tenantId,
        "verify",
        accountHost(req),
      );
    return { ok: true };
  });
  app.post("/api/v1/auth/forgot-password", rate, async (req, reply) => {
    const b = z
      .object({ email: z.email().transform((s) => s.toLowerCase()) })
      .parse(req.body);
    resetAttempts(reply, b.email, clientSource(req));
    const host = accountHost(req);
    requireEmailConfiguration();
    const [u] = await db.system((tx) =>
      tx.query(
        "SELECT u.id,u.email,m.tenant_id FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE u.email=$1 AND t.lifecycle_state IN ('active','suspended') AND ($2::uuid IS NULL OR m.tenant_id=$2) AND ($3::boolean=false OR (m.role='subscriber' AND u.platform_role='none')) ORDER BY (t.lifecycle_state='active') DESC," +
          recentWorkspaceOrder +
          " LIMIT 1",
        [b.email, host.tenantId, host.custom],
      ),
    );
    if (u) await queueLink(u, u.tenant_id, "reset", host);
    return {
      ok: true,
      message: "If this address has an account, a reset link will be sent.",
    };
  });
  for (const purpose of ["reset", "verify"] as const)
    app.post(
      `/api/v1/auth/${purpose === "reset" ? "reset-password" : "verify-email"}`,
      rate,
      async (req, reply) => {
        const b = z
          .object({
            token: z.string().min(20).max(200),
            password:
              purpose === "reset"
                ? z.string().min(12).max(128)
                : z.string().optional(),
          })
          .parse(req.body);
        const hash =
          purpose === "reset" ? await passwordHash(b.password!) : null;
        const host = accountHost(req);
        await db.system(async (tx) => {
          const [initial] = await tx.query(
            "SELECT user_id,tenant_id FROM one_time_tokens WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now()",
            [tokenHash(b.token), purpose],
          );
          if (!initial)
            throw fail(400, "LINK_EXPIRED", "This link is invalid or expired");
          await workspaceLock(tx, initial.tenant_id);
          const [owner] = await tx.query(
            "SELECT id,email_verified FROM users WHERE id=$1 FOR UPDATE",
            [initial.user_id],
          );
          const [t] = await tx.query(
            "SELECT * FROM one_time_tokens WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
            [tokenHash(b.token), purpose],
          );
          if (
            !t ||
            (t.payload.origin ? t.payload.origin !== host.origin : host.custom)
          )
            throw fail(
              400,
              "LINK_EXPIRED",
              "This link is invalid, expired or belongs to another address",
            );
          const m = await accountMembership(tx, t.user_id, host, t.tenant_id);
          await tx.query(
            "UPDATE one_time_tokens SET consumed_at=now() WHERE token_hash=$1",
            [tokenHash(b.token)],
          );
          await tx.query(
            "UPDATE users SET email_verified=true,password_hash=coalesce($2,password_hash) WHERE id=$1",
            [t.user_id, hash],
          );
          if (purpose === "reset") {
            await tx.query("DELETE FROM sessions WHERE user_id=$1", [
              t.user_id,
            ]);
            await tx.query(
              "UPDATE one_time_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose IN ('magic','reset') AND consumed_at IS NULL",
              [t.user_id],
            );
            // First proof of mailbox ownership: factors added before the address
            // was verified may belong to someone who claimed it, so remove them.
            if (!owner?.email_verified) {
              await tx.query(
                "UPDATE user_security SET enabled=false,totp_secret=NULL,pending_secret=NULL,pending_until=NULL,last_counter=-1 WHERE user_id=$1",
                [t.user_id],
              );
              for (const table of [
                "mfa_recovery_codes",
                "auth_passkeys",
                "auth_passkey_challenges",
              ])
                await tx.query(`DELETE FROM ${table} WHERE user_id=$1`, [
                  t.user_id,
                ]);
              await accountAudit(
                tx,
                { tenantId: t.tenant_id, userId: t.user_id, role: m.role },
                "security.unverified_factors_cleared",
                t.user_id,
              );
            }
          }
        });
        if (purpose === "reset") reply.clearCookie("session", { path: "/" });
        return { ok: true };
      },
    );
  app.post("/api/v1/auth/mfa/enroll", rate, async (req) => {
    const a = identity(req);
    const b = z.object({ password: z.string().max(128) }).parse(req.body);
    const secret = base32(randomBytes(20));
    await db.system(async (tx) => {
      const [u] = await tx.query(
        "SELECT password_hash,email_verified FROM users WHERE id=$1 FOR UPDATE",
        [a.userId],
      );
      // An authenticator must not be bound to an address nobody has proven.
      if (!u?.email_verified)
        throw fail(
          403,
          "EMAIL_VERIFICATION",
          "Verify your email before setting up an authenticator",
        );
      if (!String(u.password_hash).startsWith("scrypt:"))
        throw fail(
          409,
          "PASSWORD_REQUIRED",
          "Set a password in Account settings first. It confirms authenticator setup and sensitive actions.",
        );
      if (!(await passwordMatches(b.password, u.password_hash)))
        throw fail(401, "INVALID_PASSWORD", "Password is incorrect");
      const [s] = await tx.query(
        "SELECT enabled FROM user_security WHERE user_id=$1 FOR UPDATE",
        [a.userId],
      );
      if (s?.enabled)
        throw fail(409, "MFA_ENABLED", "An authenticator is already enabled");
      await tx.query(
        "INSERT INTO user_security(user_id,pending_secret,pending_until) VALUES($1,$2,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET pending_secret=EXCLUDED.pending_secret,pending_until=EXCLUDED.pending_until",
        [a.userId, seal(a.userId, secret)],
      );
    });
    return {
      secret,
      uri: `otpauth://totp/TrainerBrain:${encodeURIComponent(a.email)}?secret=${secret}&issuer=TrainerBrain&algorithm=SHA1&digits=6&period=30`,
    };
  });
  app.post("/api/v1/auth/mfa/confirm", rate, async (req) => {
    const a = identity(req);
    const b = z.object({ code: z.string().length(6) }).parse(req.body);
    const recoveryCodes = await db.system(async (tx) => {
      const [s] = await tx.query(
        "SELECT * FROM user_security WHERE user_id=$1 AND pending_until>now() FOR UPDATE",
        [a.userId],
      );
      const counter = s?.pending_secret
        ? matchCounter(open(a.userId, s.pending_secret), b.code, -1)
        : null;
      if (counter === null)
        throw fail(
          400,
          "INVALID_CODE",
          "Authenticator code is invalid or enrollment expired",
        );
      await tx.query(
        "UPDATE user_security SET enabled=true,totp_secret=pending_secret,pending_secret=NULL,pending_until=NULL,last_counter=$2 WHERE user_id=$1",
        [a.userId, counter],
      );
      await tx.query(
        "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2",
        [a.userId, tokenHash(req.cookies.session!)],
      );
      await tx.query("UPDATE sessions SET mfa_at=now() WHERE token_hash=$1", [
        tokenHash(req.cookies.session!),
      ]);
      // Every enabled authenticator starts with a recovery path.
      return replaceRecoveryCodes(tx, a.userId);
    });
    await db.tenant(a, (tx) => event(tx, a, "security.mfa_enabled", a.userId));
    return {
      ok: true,
      recoveryCodes,
      message:
        "Save these recovery codes privately. They are shown once. One code resets your authenticator if you lose it.",
    };
  });
  app.post("/api/v1/auth/mfa/verify", rate, async (req) => {
    const a = identity(req);
    const b = z
      .object({ password: z.string().max(128), code: z.string().length(6) })
      .parse(req.body);
    await db.system(async (tx) => {
      const [u] = await tx.query(
        "SELECT password_hash FROM users WHERE id=$1",
        [a.userId],
      );
      if (!(await passwordMatches(b.password, u.password_hash)))
        throw fail(401, "INVALID_PASSWORD", "Password is incorrect");
      if (!(await consumeMfa(tx, a.userId, b.code)))
        throw fail(409, "MFA_NOT_ENABLED", "Set up an authenticator first");
      await tx.query("UPDATE sessions SET mfa_at=now() WHERE token_hash=$1", [
        tokenHash(req.cookies.session!),
      ]);
    });
    return { ok: true };
  });
  app.post("/api/v1/auth/password", rate, async (req, reply) => {
    const a = identity(req);
    const b = z
      .object({
        current: z.string().max(128),
        password: z.string().min(12).max(128),
        code: z.string().optional(),
      })
      .parse(req.body);
    const hash = await passwordHash(b.password);
    await db.system(async (tx) => {
      const [u] = await tx.query(
        "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
        [a.userId],
      );
      if (!(await passwordMatches(b.current, u.password_hash)))
        throw fail(401, "INVALID_PASSWORD", "Current password is incorrect");
      await consumeMfa(tx, a.userId, b.code);
      await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
        a.userId,
        hash,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [a.userId]);
      await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose IN ('magic','reset') AND consumed_at IS NULL",
        [a.userId],
      );
    });
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });
  app.post("/api/v1/auth/sessions/revoke", rate, async (req) => {
    const a = identity(req);
    await db.system((tx) =>
      tx.query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", [
        a.userId,
        tokenHash(req.cookies.session!),
      ]),
    );
    return { ok: true };
  });
}
