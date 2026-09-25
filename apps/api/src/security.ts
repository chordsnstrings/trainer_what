import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import {
  createCipheriv,
  createDecipheriv,
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
import { passwordHash, passwordMatches, newToken, tokenHash } from "./auth.ts";

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
function encryptionKey() {
  const key = Buffer.from(process.env.SECURITY_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32)
    throw new ProviderUnavailable(
      "security",
      "A 32-byte security encryption key must be configured",
    );
  return key;
}
function seal(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((x) => x.toString("base64url"))
    .join(".");
}
function open(value: string) {
  const [iv, tag, body] = value
    .split(".")
    .map((x) => Buffer.from(x, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
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
export async function consumeMfa(tx: Tx, userId: string, code?: string) {
  const [s] = await tx.query(
    "SELECT * FROM user_security WHERE user_id=$1 FOR UPDATE",
    [userId],
  );
  if (!s?.enabled) return false;
  const counter = matchCounter(
    open(s.totp_secret),
    code ?? "",
    Number(s.last_counter),
  );
  if (counter === null)
    throw fail(
      401,
      "MFA_REQUIRED",
      "Enter a fresh six-digit authenticator code",
    );
  await tx.query("UPDATE user_security SET last_counter=$2 WHERE user_id=$1", [
    userId,
    counter,
  ]);
  return true;
}
export function requireRecentMfa(a: { mfaAt?: string | null }, force = false) {
  if (!force && process.env.NODE_ENV !== "production") return;
  if (!a.mfaAt || Date.now() - new Date(a.mfaAt).getTime() > 10 * 60 * 1000)
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
  const url = () => process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
  async function queueLink(
    user: any,
    tenantId: string,
    purpose: "reset" | "verify",
  ) {
    if (
      process.env.NODE_ENV === "production" &&
      (!runtimeConfig().EMAIL_API_KEY || !runtimeConfig().EMAIL_API_URL)
    )
      throw new ProviderUnavailable("email");
    const token = newToken();
    await db.system(async (tx) => {
      await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL",
        [user.id, purpose],
      );
      await tx.query(
        "INSERT INTO one_time_tokens(token_hash,purpose,user_id,tenant_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')",
        [tokenHash(token), purpose, user.id, tenantId],
      );
      await tx.query("SET LOCAL ROLE trainer_app");
      await tx.query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.role','owner',true)",
        [tenantId],
      );
      await tx.query(
        "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,'email',$3,$4)",
        [
          randomUUID(),
          tenantId,
          `${purpose}:${tokenHash(token)}`,
          JSON.stringify({
            to: user.email,
            subject:
              purpose === "reset" ? "Reset your password" : "Verify your email",
            text: `${url()}/${purpose === "reset" ? "reset-password" : "verify-email"}/${token}\nThis link expires in 30 minutes.`,
          }),
        ],
      );
    });
  }
  app.get("/api/v1/auth/security", async (req) => {
    const a = identity(req);
    const [s] = await db.system((tx) =>
      tx.query("SELECT enabled FROM user_security WHERE user_id=$1", [
        a.userId,
      ]),
    );
    return {
      emailVerified: a.emailVerified,
      mfaEnabled: s?.enabled ?? false,
      mfaConfigured: !!process.env.SECURITY_ENCRYPTION_KEY,
      mfaAt: a.mfaAt ?? null,
    };
  });
  app.post("/api/v1/auth/request-verification", rate, async (req) => {
    const a = identity(req);
    if (!a.emailVerified)
      await queueLink({ id: a.userId, email: a.email }, a.tenantId, "verify");
    return { ok: true };
  });
  app.post("/api/v1/auth/forgot-password", rate, async (req) => {
    const b = z
      .object({ email: z.email().transform((s) => s.toLowerCase()) })
      .parse(req.body);
    const [u] = await db.system((tx) =>
      tx.query(
        "SELECT u.id,u.email,m.tenant_id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=$1 LIMIT 1",
        [b.email],
      ),
    );
    if (u) await queueLink(u, u.tenant_id, "reset");
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
        await db.system(async (tx) => {
          const [t] = await tx.query(
            "SELECT * FROM one_time_tokens WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
            [tokenHash(b.token), purpose],
          );
          if (!t)
            throw fail(400, "LINK_EXPIRED", "This link is invalid or expired");
          await tx.query(
            "UPDATE one_time_tokens SET consumed_at=now() WHERE token_hash=$1",
            [tokenHash(b.token)],
          );
          await tx.query(
            "UPDATE users SET email_verified=true,password_hash=coalesce($2,password_hash) WHERE id=$1",
            [t.user_id, hash],
          );
          if (purpose === "reset")
            await tx.query("DELETE FROM sessions WHERE user_id=$1", [
              t.user_id,
            ]);
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
        "SELECT password_hash FROM users WHERE id=$1",
        [a.userId],
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
        [a.userId, seal(secret)],
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
    await db.system(async (tx) => {
      const [s] = await tx.query(
        "SELECT * FROM user_security WHERE user_id=$1 AND pending_until>now() FOR UPDATE",
        [a.userId],
      );
      const counter = s?.pending_secret
        ? matchCounter(open(s.pending_secret), b.code, -1)
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
    });
    await db.tenant(a, (tx) => event(tx, a, "security.mfa_enabled", a.userId));
    return { ok: true };
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
