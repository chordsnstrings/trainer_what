import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import { ProviderUnavailable } from "@trainer/providers";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { newToken, passwordMatches, tokenHash } from "./auth.ts";
import { consumeMfa, requireRecentMfa } from "./security.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";
import type { HostContext } from "./host-routing.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
type AccountIdentity = Actor & { email: string; mfaAt?: string | null };
export function accountHost(req: FastifyRequest): HostContext {
  const context = (req as FastifyRequest & { hostContext?: HostContext })
    .hostContext;
  if (context) return context;
  const url = new URL(
    runtimeConfig().PUBLIC_APP_URL ?? "http://localhost:3000",
  );
  return {
    host: url.host,
    origin: url.origin,
    tenantId: null,
    tenantSlug: null,
    custom: false,
    verifiedProxy: false,
  };
}
export function requireEmailConfiguration() {
  if (
    process.env.NODE_ENV === "production" &&
    (!runtimeConfig().EMAIL_API_KEY || !runtimeConfig().EMAIL_API_URL)
  )
    throw new ProviderUnavailable(
      "email",
      "Email delivery must be configured before sending access links",
    );
}
export async function accountMembership(
  tx: Tx,
  userId: string,
  host: HostContext,
  tenantId?: string,
) {
  const [m] = await tx.query(
    "SELECT m.tenant_id,m.role,u.platform_role FROM memberships m JOIN tenants t ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND t.lifecycle_state='active' AND ($2::uuid IS NULL OR m.tenant_id=$2) AND ($3::uuid IS NULL OR m.tenant_id=$3) AND ($4::boolean=false OR (m.role='subscriber' AND u.platform_role='none')) ORDER BY m.tenant_id LIMIT 1",
    [userId, host.tenantId, tenantId ?? null, host.custom],
  );
  if (!m)
    throw fail(
      403,
      "NO_MEMBERSHIP",
      "No active workspace is available at this address",
    );
  return m;
}
export async function accountAudit(
  tx: Tx,
  a: Actor,
  name: string,
  subject?: string,
  data: unknown = {},
) {
  await tx.query("SET LOCAL ROLE trainer_app");
  await tx.query(
    "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role',$3,true)",
    [a.tenantId, a.userId, a.role],
  );
  await event(tx, a, name, subject, data);
  await tx.query("RESET ROLE");
}
export async function insertAccountSession(
  tx: Tx,
  userId: string,
  tenantId: string,
  mfa = false,
) {
  const token = newToken();
  await tx.query(
    "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,mfa_at) VALUES($1,$2,$3,now()+interval '7 days',CASE WHEN $4 THEN now() ELSE NULL END)",
    [tokenHash(token), userId, tenantId, mfa],
  );
  return token;
}
export function setAccountCookie(reply: FastifyReply, token: string) {
  reply.setCookie("session", token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 604800,
  });
}
async function queueAccountEmail(
  tx: Tx,
  a: Actor,
  to: string,
  subject: string,
  text: string,
  intentKey: string,
) {
  await tx.query("SET LOCAL ROLE trainer_app");
  await tx.query(
    "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','owner',true)",
    [a.tenantId, a.userId],
  );
  await tx.query(
    "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,'email',$3,$4) ON CONFLICT DO NOTHING",
    [
      randomUUID(),
      a.tenantId,
      intentKey,
      JSON.stringify({
        to,
        subject,
        text,
        userId: a.userId,
        category: "account",
        critical: true,
      }),
    ],
  );
  await tx.query("RESET ROLE");
}
export async function touchAccountSession(db: Database, hash: string) {
  await db.system((tx) =>
    tx.query(
      "UPDATE sessions SET last_seen_at=now() WHERE token_hash=$1 AND expires_at>now() AND last_seen_at<now()-interval '5 minutes'",
      [hash],
    ),
  );
}
const recoveryHash = (userId: string, code: string) =>
  tokenHash(
    userId + ":" + code.replaceAll("-", "").replaceAll(" ", "").toLowerCase(),
  );
export function registerAccountCompletion(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => AccountIdentity,
) {
  const rate = { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } };
  app.get("/api/v1/auth/account", async (req) => {
    const a = identity(req),
      current = tokenHash(req.cookies.session ?? "");
    return db.system(async (tx) => ({
      sessions: await tx.query(
        "SELECT s.session_id AS id,s.tenant_id,t.name AS workspace,s.created_at,s.last_seen_at,s.expires_at,s.token_hash=$2 AS current FROM sessions s JOIN tenants t ON t.id=s.tenant_id WHERE s.user_id=$1 AND s.expires_at>now() ORDER BY s.last_seen_at DESC",
        [a.userId, current],
      ),
      recoveryCodesRemaining: Number(
        (
          await tx.query(
            "SELECT count(*)::int n FROM mfa_recovery_codes WHERE user_id=$1",
            [a.userId],
          )
        )[0].n,
      ),
      mfaEnabled: !!(
        await tx.query("SELECT enabled FROM user_security WHERE user_id=$1", [
          a.userId,
        ])
      )[0]?.enabled,
    }));
  });
  app.post("/api/v1/auth/sessions/:id/revoke", rate, async (req, reply) => {
    const a = identity(req),
      sid = z
        .string()
        .uuid()
        .parse((req.params as any).id),
      current = tokenHash(req.cookies.session ?? "");
    const out = await db.system(async (tx) => {
      const [s] = await tx.query(
        "DELETE FROM sessions WHERE user_id=$1 AND session_id=$2 RETURNING token_hash",
        [a.userId, sid],
      );
      if (!s) throw fail(404, "NOT_FOUND", "Session unavailable");
      await accountAudit(tx, a, "security.session_revoked", sid);
      return { ok: true, current: s.token_hash === current };
    });
    if (out.current) reply.clearCookie("session", { path: "/" });
    return out;
  });
  app.post("/api/v1/auth/mfa/recovery-codes", rate, async (req) => {
    const a = identity(req);
    requireRecentMfa(a, true);
    const b = z
      .object({ password: z.string().max(128) })
      .strict()
      .parse(req.body);
    const codes = Array.from({ length: 10 }, () =>
      randomBytes(16).toString("hex").match(/.{8}/g)!.join("-"),
    );
    await db.system(async (tx) => {
      await workspaceLock(tx, a.tenantId);
      await accountMembership(tx, a.userId, accountHost(req), a.tenantId);
      const [u] = await tx.query(
        "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
        [a.userId],
      );
      if (!u || !(await passwordMatches(b.password, u.password_hash)))
        throw fail(401, "INVALID_PASSWORD", "Password is incorrect");
      const [s] = await tx.query(
        "SELECT enabled FROM user_security WHERE user_id=$1 FOR UPDATE",
        [a.userId],
      );
      if (!s?.enabled)
        throw fail(
          409,
          "MFA_NOT_ENABLED",
          "Enable your authenticator before generating recovery codes",
        );
      await tx.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [
        a.userId,
      ]);
      for (const code of codes)
        await tx.query(
          "INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)",
          [a.userId, recoveryHash(a.userId, code)],
        );
      await accountAudit(tx, a, "security.recovery_codes_replaced", a.userId);
    });
    return {
      codes,
      message:
        "Save these codes privately. They are shown once. Replacing them invalidates all previous codes.",
    };
  });
  app.post("/api/v1/auth/mfa/recover", rate, async (req, reply) => {
    const b = z
        .object({
          email: z.email().transform((v) => v.toLowerCase()),
          password: z.string().max(128),
          recoveryCode: z.string().min(20).max(100),
        })
        .strict()
        .parse(req.body),
      host = accountHost(req);
    const result = await db.system(async (tx) => {
      const [initial] = await tx.query("SELECT id FROM users WHERE email=$1", [
        b.email,
      ]);
      if (!initial)
        throw fail(
          401,
          "RECOVERY_INVALID",
          "The account or recovery details are incorrect",
        );
      const chosen = await accountMembership(tx, initial.id, host);
      await workspaceLock(tx, chosen.tenant_id);
      const [u] = await tx.query(
        "SELECT id,email,password_hash FROM users WHERE id=$1 FOR UPDATE",
        [initial.id],
      );
      if (!(await passwordMatches(b.password, u.password_hash)))
        throw fail(
          401,
          "RECOVERY_INVALID",
          "The account or recovery details are incorrect",
        );
      const m = await accountMembership(tx, u.id, host, chosen.tenant_id);
      const [s] = await tx.query(
        "SELECT enabled FROM user_security WHERE user_id=$1 FOR UPDATE",
        [u.id],
      );
      const [code] = await tx.query(
        "SELECT code_hash FROM mfa_recovery_codes WHERE user_id=$1 AND code_hash=$2 FOR UPDATE",
        [u.id, recoveryHash(u.id, b.recoveryCode)],
      );
      if (!s?.enabled || !code)
        throw fail(
          401,
          "RECOVERY_INVALID",
          "The account or recovery details are incorrect",
        );
      await tx.query("DELETE FROM mfa_recovery_codes WHERE user_id=$1", [u.id]);
      await tx.query(
        "UPDATE user_security SET enabled=false,totp_secret=NULL,pending_secret=NULL,pending_until=NULL,last_counter=-1 WHERE user_id=$1",
        [u.id],
      );
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose IN ('magic','reset') AND consumed_at IS NULL",
        [u.id],
      );
      const a = { tenantId: m.tenant_id, userId: u.id, role: m.role };
      await accountAudit(tx, a, "security.authenticator_recovered", u.id);
      await queueAccountEmail(
        tx,
        a,
        u.email,
        "Your authenticator was recovered",
        "Your authenticator was recovered using your password and a recovery code. All sessions and recovery codes were revoked. Sign in and set up a new authenticator. If you did not make this change, reset your password and contact support.",
        "auth-recovery:" + randomUUID(),
      );
      return {
        token: await insertAccountSession(tx, u.id, m.tenant_id, false),
        role: m.role,
        platformRole: m.platform_role,
      };
    });
    setAccountCookie(reply, result.token);
    return {
      ok: true,
      role: result.role,
      platformRole: result.platformRole,
      requiresAuthenticatorSetup: true,
    };
  });
  app.post("/api/v1/auth/magic-link", rate, async (req) => {
    const b = z
        .object({ email: z.email().transform((v) => v.toLowerCase()) })
        .strict()
        .parse(req.body),
      host = accountHost(req);
    // Apply unavailable-service behavior before lookup so it cannot disclose the
    // existence of an account when production email is not configured.
    requireEmailConfiguration();
    await db.system(async (tx) => {
      const [u] = await tx.query(
        "SELECT u.id,u.email,m.tenant_id,m.role FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id WHERE u.email=$1 AND t.lifecycle_state='active' AND ($2::uuid IS NULL OR m.tenant_id=$2) AND ($3::boolean=false OR (m.role='subscriber' AND u.platform_role='none')) ORDER BY m.tenant_id LIMIT 1",
        [b.email, host.tenantId, host.custom],
      );
      if (!u) return;
      await workspaceLock(tx, u.tenant_id);
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [u.id]);
      await accountMembership(tx, u.id, host, u.tenant_id);
      const token = newToken();
      await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose='magic' AND consumed_at IS NULL",
        [u.id],
      );
      await tx.query(
        "INSERT INTO one_time_tokens(token_hash,purpose,user_id,tenant_id,payload,expires_at) VALUES($1,'magic',$2,$3,$4,now()+interval '15 minutes')",
        [
          tokenHash(token),
          u.id,
          u.tenant_id,
          JSON.stringify({ origin: host.origin }),
        ],
      );
      await queueAccountEmail(
        tx,
        { tenantId: u.tenant_id, userId: u.id, role: u.role },
        u.email,
        "Your secure sign-in link",
        `${host.origin}/magic-link/${token}\nThis link expires in 15 minutes. Your authenticator is still required if enabled.`,
        "magic:" + tokenHash(token),
      );
    });
    return {
      ok: true,
      message:
        "If this address has an account here, a sign-in link will be sent.",
    };
  });
  app.post("/api/v1/auth/magic-link/consume", rate, async (req, reply) => {
    const b = z
        .object({
          token: z.string().min(20).max(200),
          code: z.string().max(10).optional(),
        })
        .strict()
        .parse(req.body),
      host = accountHost(req);
    const result = await db.system(async (tx) => {
      const [initial] = await tx.query(
        "SELECT user_id,tenant_id FROM one_time_tokens WHERE token_hash=$1 AND purpose='magic' AND consumed_at IS NULL AND expires_at>now()",
        [tokenHash(b.token)],
      );
      if (!initial)
        throw fail(
          400,
          "LINK_EXPIRED",
          "This sign-in link is invalid or expired",
        );
      await workspaceLock(tx, initial.tenant_id);
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        initial.user_id,
      ]);
      const [t] = await tx.query(
        "SELECT * FROM one_time_tokens WHERE token_hash=$1 AND purpose='magic' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
        [tokenHash(b.token)],
      );
      if (!t || t.payload.origin !== host.origin)
        throw fail(
          400,
          "LINK_EXPIRED",
          "Use this sign-in link at the address where it was requested",
        );
      const m = await accountMembership(tx, t.user_id, host, t.tenant_id),
        mfa = await consumeMfa(tx, t.user_id, b.code);
      await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE token_hash=$1",
        [tokenHash(b.token)],
      );
      await tx.query("UPDATE users SET email_verified=true WHERE id=$1", [
        t.user_id,
      ]);
      await accountAudit(
        tx,
        { tenantId: t.tenant_id, userId: t.user_id, role: m.role },
        "security.magic_link_used",
        t.user_id,
      );
      return {
        token: await insertAccountSession(tx, t.user_id, t.tenant_id, mfa),
        role: m.role,
        platformRole: m.platform_role,
      };
    });
    setAccountCookie(reply, result.token);
    return { ok: true, role: result.role, platformRole: result.platformRole };
  });
}
