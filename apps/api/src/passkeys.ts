import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { type Actor, type Database, type Tx } from "@trainer/db";
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { newToken, passwordMatches, tokenHash } from "./auth.ts";
import { consumeMfa, requireRecentMfa } from "./security.ts";
import {
  accountHost,
  accountMembership,
  accountAudit,
  insertAccountSession,
  setAccountCookie,
} from "./account-completion.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
type Identity = Actor & {
  name?: string;
  email: string;
  emailVerified?: boolean;
  mfaAt?: string | null;
};
const uuid = z.string().uuid();
const nonceCookie = "passkey_nonce";
async function challenge(
  db: Database,
  req: FastifyRequest,
  reply: FastifyReply,
  input: {
    purpose: "register" | "authenticate";
    challenge: string;
    userId?: string;
    tenantId?: string;
    label?: string;
  },
) {
  const host = accountHost(req),
    nonce = newToken(),
    id = randomUUID(),
    rpId = new URL(host.origin).hostname;
  await db.system(async (tx) => {
    await tx.query(
      "DELETE FROM auth_passkey_challenges WHERE expires_at<now()",
    );
    await tx.query(
      "INSERT INTO auth_passkey_challenges(id,user_id,tenant_id,purpose,rp_id,origin,challenge,nonce_hash,session_hash,label) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        input.userId ?? null,
        input.tenantId ?? host.tenantId,
        input.purpose,
        rpId,
        host.origin,
        input.challenge,
        tokenHash(nonce),
        input.purpose === "register"
          ? tokenHash(req.cookies.session ?? "")
          : null,
        input.label ?? null,
      ],
    );
  });
  reply.setCookie(nonceCookie, nonce, {
    path: "/api/v1/auth/passkeys",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 300,
  });
  return id;
}
async function consumeChallenge(
  db: Database,
  req: FastifyRequest,
  id: string,
  purpose: "register" | "authenticate",
  userId?: string,
) {
  const host = accountHost(req),
    nonce = req.cookies[nonceCookie];
  if (!nonce)
    throw fail(
      400,
      "PASSKEY_CHALLENGE",
      "Begin the passkey request again in this browser",
    );
  // Commit consumption before cryptographic verification. A rejected assertion
  // cannot be replayed or retried against the same challenge.
  return db.system(async (tx) => {
    const [c] = await tx.query(
      "SELECT * FROM auth_passkey_challenges WHERE id=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
      [id, purpose],
    );
    if (
      !c ||
      c.nonce_hash !== tokenHash(nonce) ||
      c.origin !== host.origin ||
      c.rp_id !== new URL(host.origin).hostname ||
      (host.custom && c.tenant_id !== host.tenantId) ||
      (purpose === "register" &&
        (c.user_id !== userId ||
          c.session_hash !== tokenHash(req.cookies.session ?? "")))
    )
      throw fail(
        400,
        "PASSKEY_CHALLENGE",
        "The passkey request expired or belongs to another session or address",
      );
    await tx.query(
      "UPDATE auth_passkey_challenges SET consumed_at=now() WHERE id=$1",
      [id],
    );
    return c;
  });
}
async function currentRegistration(tx: Tx, a: Actor, sessionHash: string) {
  const [s] = await tx.query(
    "SELECT token_hash FROM sessions WHERE token_hash=$1 AND user_id=$2 AND tenant_id=$3 AND expires_at>now()",
    [sessionHash, a.userId, a.tenantId],
  );
  if (!s)
    throw fail(
      401,
      "SESSION_EXPIRED",
      "Sign in again before registering a passkey",
    );
}
export function registerPasskeys(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => Identity,
) {
  const rate = {
    bodyLimit: 64 * 1024,
    config: { rateLimit: { max: 12, timeWindow: "10 minutes" } },
  };
  app.get("/api/v1/auth/passkeys", async (req) => {
    const a = identity(req),
      host = accountHost(req);
    return db.system((tx) =>
      tx.query(
        "SELECT id,label,rp_id,host_tenant_id,device_type,backed_up,created_at,last_used_at FROM auth_passkeys WHERE user_id=$1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR host_tenant_id=$2) ORDER BY created_at DESC",
        [a.userId, host.tenantId],
      ),
    );
  });
  app.post(
    "/api/v1/auth/passkeys/register/options",
    rate,
    async (req, reply) => {
      const a = identity(req),
        host = accountHost(req),
        b = z
          .object({
            label: z.string().trim().min(2).max(80),
            password: z.string().max(128),
            code: z.string().max(10).optional(),
          })
          .strict()
          .parse(req.body);
      const existing = await db.system(async (tx) => {
        await workspaceLock(tx, a.tenantId);
        const [u] = await tx.query(
          "SELECT password_hash,email_verified FROM users WHERE id=$1 FOR UPDATE",
          [a.userId],
        );
        if (!u?.email_verified)
          throw fail(
            403,
            "EMAIL_VERIFICATION",
            "Verify your email before adding a passkey",
          );
        if (!(await passwordMatches(b.password, u.password_hash)))
          throw fail(401, "INVALID_PASSWORD", "Password is incorrect");
        await currentRegistration(tx, a, tokenHash(req.cookies.session ?? ""));
        await accountMembership(tx, a.userId, host, a.tenantId);
        await consumeMfa(tx, a.userId, b.code);
        return tx.query(
          "SELECT credential_id,transports FROM auth_passkeys WHERE user_id=$1 AND rp_id=$2 AND revoked_at IS NULL",
          [a.userId, new URL(host.origin).hostname],
        );
      });
      const options = await generateRegistrationOptions({
        rpName: "Trainer Brain",
        rpID: new URL(host.origin).hostname,
        userName: a.email,
        userDisplayName: a.name ?? a.email,
        userID: Buffer.from(a.userId),
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        excludeCredentials: existing.map((x) => ({
          id: x.credential_id,
          transports: x.transports,
        })),
        timeout: 60000,
      });
      return {
        options,
        challengeId: await challenge(db, req, reply, {
          purpose: "register",
          challenge: options.challenge,
          userId: a.userId,
          tenantId: a.tenantId,
          label: b.label,
        }),
      };
    },
  );
  app.post(
    "/api/v1/auth/passkeys/register/verify",
    rate,
    async (req, reply) => {
      const a = identity(req),
        host = accountHost(req),
        b = z
          .object({
            challengeId: uuid,
            response: z.record(z.string(), z.unknown()),
          })
          .strict()
          .parse(req.body),
        c = await consumeChallenge(
          db,
          req,
          b.challengeId,
          "register",
          a.userId,
        );
      let result: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
      try {
        result = await verifyRegistrationResponse({
          response: b.response as unknown as RegistrationResponseJSON,
          expectedChallenge: c.challenge,
          expectedOrigin: c.origin,
          expectedRPID: c.rp_id,
          requireUserVerification: true,
          requireUserPresence: true,
        });
      } catch {
        throw fail(
          400,
          "PASSKEY_INVALID",
          "This passkey could not be verified; begin again",
        );
      }
      if (!result.verified || !result.registrationInfo.userVerified)
        throw fail(400, "PASSKEY_INVALID", "A verified passkey is required");
      const info = result.registrationInfo;
      const saved = await db.system(async (tx) => {
        await workspaceLock(tx, a.tenantId);
        await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          a.userId,
        ]);
        await currentRegistration(tx, a, c.session_hash);
        await accountMembership(tx, a.userId, host, a.tenantId);
        const [row] = await tx.query(
          "INSERT INTO auth_passkeys(id,user_id,rp_id,host_tenant_id,credential_id,public_key,counter,transports,device_type,backed_up,label) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,label",
          [
            randomUUID(),
            a.userId,
            c.rp_id,
            host.tenantId,
            info.credential.id,
            Buffer.from(info.credential.publicKey),
            info.credential.counter,
            info.credential.transports ?? [],
            info.credentialDeviceType,
            info.credentialBackedUp,
            c.label,
          ],
        );
        await tx.query("UPDATE sessions SET mfa_at=now() WHERE token_hash=$1", [
          c.session_hash,
        ]);
        await accountAudit(tx, a, "security.passkey_registered", row.id);
        return row;
      });
      reply.clearCookie(nonceCookie, { path: "/api/v1/auth/passkeys" });
      return saved;
    },
  );
  app.post(
    "/api/v1/auth/passkeys/authenticate/options",
    rate,
    async (req, reply) => {
      const host = accountHost(req),
        options = await generateAuthenticationOptions({
          rpID: new URL(host.origin).hostname,
          userVerification: "required",
          timeout: 60000,
        });
      return {
        options,
        challengeId: await challenge(db, req, reply, {
          purpose: "authenticate",
          challenge: options.challenge,
        }),
      };
    },
  );
  app.post(
    "/api/v1/auth/passkeys/authenticate/verify",
    rate,
    async (req, reply) => {
      const host = accountHost(req),
        b = z
          .object({
            challengeId: uuid,
            response: z.record(z.string(), z.unknown()),
          })
          .strict()
          .parse(req.body),
        c = await consumeChallenge(db, req, b.challengeId, "authenticate");
      const response = b.response as unknown as AuthenticationResponseJSON;
      const [credential] = await db.system((tx) =>
        tx.query(
          "SELECT * FROM auth_passkeys WHERE rp_id=$1 AND credential_id=$2 AND host_tenant_id IS NOT DISTINCT FROM $3::uuid AND revoked_at IS NULL",
          [
            c.rp_id,
            z.string().min(1).max(2048).parse(response.id),
            host.tenantId,
          ],
        ),
      );
      if (!credential)
        throw fail(
          401,
          "PASSKEY_INVALID",
          "This passkey cannot sign in at this address",
        );
      if (
        response.response?.userHandle &&
        response.response.userHandle !==
          Buffer.from(credential.user_id).toString("base64url")
      )
        throw fail(
          401,
          "PASSKEY_INVALID",
          "This passkey does not match the account",
        );
      let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
      try {
        verified = await verifyAuthenticationResponse({
          response,
          expectedChallenge: c.challenge,
          expectedOrigin: c.origin,
          expectedRPID: c.rp_id,
          requireUserVerification: true,
          credential: {
            id: credential.credential_id,
            publicKey: new Uint8Array(credential.public_key),
            counter: Number(credential.counter),
            transports: credential.transports,
          },
        });
      } catch {
        throw fail(
          401,
          "PASSKEY_INVALID",
          "This passkey assertion could not be verified; begin again",
        );
      }
      if (!verified.verified || !verified.authenticationInfo.userVerified)
        throw fail(
          401,
          "PASSKEY_INVALID",
          "Verify yourself with the passkey to sign in",
        );
      const result = await db.system(async (tx) => {
        const selected = await accountMembership(tx, credential.user_id, host);
        await workspaceLock(tx, selected.tenant_id);
        await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          credential.user_id,
        ]);
        const m = await accountMembership(
            tx,
            credential.user_id,
            host,
            selected.tenant_id,
          ),
          [live] = await tx.query(
            "SELECT * FROM auth_passkeys WHERE id=$1 AND revoked_at IS NULL FOR UPDATE",
            [credential.id],
          );
        if (!live || Number(live.counter) !== Number(credential.counter))
          throw fail(
            409,
            "PASSKEY_CHANGED",
            "This passkey changed; begin again",
          );
        await tx.query(
          "UPDATE auth_passkeys SET counter=$2,backed_up=$3,last_used_at=now() WHERE id=$1",
          [
            live.id,
            verified.authenticationInfo.newCounter,
            verified.authenticationInfo.credentialBackedUp,
          ],
        );
        await accountAudit(
          tx,
          { tenantId: m.tenant_id, userId: credential.user_id, role: m.role },
          "security.passkey_signed_in",
          live.id,
        );
        return {
          token: await insertAccountSession(
            tx,
            credential.user_id,
            m.tenant_id,
            true,
          ),
          role: m.role,
          platformRole: m.platform_role,
        };
      });
      setAccountCookie(reply, result.token);
      reply.clearCookie(nonceCookie, { path: "/api/v1/auth/passkeys" });
      return { ok: true, role: result.role, platformRole: result.platformRole };
    },
  );
  app.post("/api/v1/auth/passkeys/:id/revoke", rate, async (req) => {
    const a = identity(req);
    requireRecentMfa(a, true);
    const id = uuid.parse((req.params as any).id),
      b = z
        .object({ password: z.string().max(128) })
        .strict()
        .parse(req.body);
    return db.system(async (tx) => {
      await workspaceLock(tx, a.tenantId);
      await accountMembership(tx, a.userId, accountHost(req), a.tenantId);
      const [u] = await tx.query(
        "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
        [a.userId],
      );
      if (!u || !(await passwordMatches(b.password, u.password_hash)))
        throw fail(401, "INVALID_PASSWORD", "Password is incorrect");
      const [r] = await tx.query(
        "UPDATE auth_passkeys SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id",
        [id, a.userId],
      );
      if (!r) throw fail(404, "NOT_FOUND", "Passkey unavailable");
      await tx.query(
        "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2",
        [a.userId, tokenHash(req.cookies.session ?? "")],
      );
      await accountAudit(tx, a, "security.passkey_revoked", id);
      return { ok: true };
    });
  });
}
