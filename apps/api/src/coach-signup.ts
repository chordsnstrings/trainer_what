/**
 * Open self-serve coach sign-up (owner decisions, 30 September 2026;
 * docs/features/coach-setup.md): "Start coaching" → email + six-digit code
 * sent through Resend → the setup wizard. Codes stay off until a Resend key
 * is saved in Super admin; the email/password path (/auth/register) keeps
 * working. Everything stays behind the existing registration gate: a strict
 * deployment refuses sign-up until the owner approves the published legal
 * documents, and the early-access form is the fallback until then.
 */
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { event, putRecord, type Database } from "@trainer/db";
import { emailCodesEnabled, sendEmail } from "@trainer/providers";
import {
  platformName,
  signupCodeRequestSchema,
  signupCodeVerifySchema,
} from "@trainer/contracts";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { subdomainCandidates } from "../../../packages/domain/src/coach-setup.ts";
import { passwordHash } from "./auth.ts";
import { legalAcceptanceVersion } from "./legal.ts";
import { publicPlatform } from "./marketing.ts";
import { recordSignupAcquisition } from "./acquisition.ts";
import { unusablePassword } from "./account-self-service.ts";
import type { SignInMethod } from "./sign-in.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
export const SIGNUP_CODE_MINUTES = 15;
export const SIGNUP_CODE_ATTEMPTS = 5;
/** Codes one address may be sent per hour. */
export const SIGNUP_CODES_PER_HOUR = 5;
/** Hours a code row (an email address) is kept; erased with the account too. */
export const SIGNUP_CODE_RETENTION_HOURS = 24;
const codeHash = (id: string, code: string) =>
  createHash("sha256").update(`coach-signup:${id}:${code}`).digest("hex");

type Session = (
  reply: FastifyReply,
  userId: string,
  tenantId: string,
  mfa?: boolean,
  method?: SignInMethod,
) => Promise<void>;
export type SignupDeps = {
  /** Test seam; production sends through the configured email transport. */
  sendEmail?: (to: string, subject: string, text: string) => Promise<void>;
};

function platformHostOnly(req: FastifyRequest) {
  if (req.hostContext?.custom || req.hostContext?.tenantId)
    throw fail(
      403,
      "PLATFORM_HOST_REQUIRED",
      "Coach sign-up uses the platform address.",
    );
}
function registrationGate() {
  if (!publicPlatform().registrationOpen)
    throw fail(
      503,
      "LEGAL_PENDING",
      "Coach sign-up opens soon. Leave your details on the early-access form and we'll email you.",
    );
}

/** What the "Start coaching" screen offers right now. */
export function signupOptions() {
  const open = publicPlatform().registrationOpen;
  return {
    registrationOpen: open,
    methods: {
      emailCode: open && emailCodesEnabled(),
      password: open,
      // Google and Apple come later (owner decision, 30 September 2026).
      google: false,
      apple: false,
    },
    // The early-access form is only a fallback while sign-up is closed.
    earlyAccess: !open,
  };
}

/** A free, valid starting subdomain; the coach picks their own in the wizard. */
export async function freeStartingSlug(db: Database, name: string) {
  const suffix = randomInt(1000, 9999).toString();
  const candidates = [
    ...subdomainCandidates(name, suffix),
    `coach-${randomUUID().slice(0, 8)}`,
  ];
  for (const slug of candidates) {
    const [held] = await db.system((tx) =>
      tx.query(
        "SELECT 1 FROM tenants WHERE slug=$1 UNION ALL SELECT 1 FROM tenant_slug_redirects WHERE slug=$1 AND redirect_until>now()",
        [slug],
      ),
    );
    if (!held) return slug;
  }
  return `coach-${randomUUID().slice(0, 12)}`;
}

export function registerCoachSignup(
  app: FastifyInstance,
  db: Database,
  session: Session,
  deps: SignupDeps = {},
) {
  const send = deps.sendEmail ?? ((to, subject, text) => sendEmail(to, subject, text));

  app.get("/api/v1/public/signup-options", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return signupOptions();
  });

  app.post(
    "/api/v1/auth/signup/code",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (req) => {
      platformHostOnly(req);
      registrationGate();
      if (!emailCodesEnabled())
        throw fail(
          503,
          "EMAIL_CODES_OFF",
          "Email codes are not available yet. Create your account with a password instead.",
        );
      const { email } = signupCodeRequestSchema.parse(req.body);
      const name = platformName(runtimeConfig().APP_NAME);
      const outcome = await db.system(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "coach-signup:" + email,
        ]);
        const [recent] = await tx.query(
          "SELECT count(*)::int AS n FROM coach_signup_codes WHERE email=$1 AND created_at>now()-interval '1 hour'",
          [email],
        );
        if (recent.n >= SIGNUP_CODES_PER_HOUR) return { kind: "limited" as const };
        // Codes are kept one day (the hourly limit needs the last hour only),
        // so addresses that never became accounts are not kept.
        await tx.query(
          `DELETE FROM coach_signup_codes WHERE created_at<now()-interval '${SIGNUP_CODE_RETENTION_HOURS} hours'`,
        );
        const [existing] = await tx.query(
          "SELECT id FROM users WHERE email=$1",
          [email],
        );
        // The reply never says whether an account exists; the email does.
        // The "you already have an account" email counts toward the same
        // hourly limit (a used-up row), so it cannot flood a real inbox.
        if (existing) {
          const id = randomUUID();
          await tx.query(
            "INSERT INTO coach_signup_codes(id,email,code_hash,expires_at,consumed_at) VALUES($1,$2,$3,now(),now())",
            [id, email, codeHash(id, randomUUID())],
          );
          return { kind: "existing" as const };
        }
        await tx.query(
          "UPDATE coach_signup_codes SET consumed_at=now() WHERE email=$1 AND consumed_at IS NULL",
          [email],
        );
        const id = randomUUID(),
          code = randomInt(0, 1_000_000).toString().padStart(6, "0");
        await tx.query(
          "INSERT INTO coach_signup_codes(id,email,code_hash,expires_at) VALUES($1,$2,$3,now()+make_interval(mins=>$4))",
          [id, email, codeHash(id, code), SIGNUP_CODE_MINUTES],
        );
        return { kind: "code" as const, id, code };
      });
      if (outcome.kind === "limited")
        throw fail(
          429,
          "TOO_MANY_CODES",
          "Too many codes were sent to this address. Wait an hour, then try again.",
        );
      try {
        if (outcome.kind === "existing")
          await send(
            email,
            `You already have a ${name} account`,
            `Someone asked to start coaching on ${name} with this address, which already has an account. Sign in instead, or reset your password from the sign-in page. If this wasn't you, ignore this email.`,
          );
        else
          await send(
            email,
            `Your ${name} code: ${outcome.code}`,
            `Your ${name} sign-up code is ${outcome.code}. It expires in ${SIGNUP_CODE_MINUTES} minutes.\nIf you didn't ask for it, ignore this email.`,
          );
      } catch {
        if (outcome.kind === "code")
          await db.system((tx) =>
            tx.query(
              "UPDATE coach_signup_codes SET consumed_at=now() WHERE id=$1",
              [outcome.id],
            ),
          );
        throw fail(
          503,
          "EMAIL_UNAVAILABLE",
          "We couldn't send the email just now. Try again in a minute.",
        );
      }
      return {
        ok: true,
        expiresInMinutes: SIGNUP_CODE_MINUTES,
        message: "If this address can start coaching, a six-digit code is on its way.",
      };
    },
  );

  app.post(
    "/api/v1/auth/signup/verify",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      platformHostOnly(req);
      const b = signupCodeVerifySchema.parse(req.body);
      const registrationVersion = await legalAcceptanceVersion(
        db,
        "registration",
      );
      registrationGate();
      // Checked and counted in its own transaction, so a wrong guess is
      // recorded even though the request then fails.
      const check = await db.system(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "coach-signup:" + b.email,
        ]);
        const [row] = await tx.query(
          "SELECT * FROM coach_signup_codes WHERE email=$1 AND consumed_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
          [b.email],
        );
        if (!row || row.attempts >= SIGNUP_CODE_ATTEMPTS)
          return { ok: false as const, expired: true };
        const expected = Buffer.from(row.code_hash, "hex"),
          given = Buffer.from(codeHash(row.id, b.code), "hex");
        if (!timingSafeEqual(expected, given)) {
          const [after] = await tx.query(
            "UPDATE coach_signup_codes SET attempts=attempts+1,consumed_at=CASE WHEN attempts+1>=$2 THEN now() ELSE consumed_at END WHERE id=$1 RETURNING attempts",
            [row.id, SIGNUP_CODE_ATTEMPTS],
          );
          return {
            ok: false as const,
            expired: after.attempts >= SIGNUP_CODE_ATTEMPTS,
          };
        }
        await tx.query(
          "UPDATE coach_signup_codes SET consumed_at=now() WHERE id=$1",
          [row.id],
        );
        return { ok: true as const };
      });
      if (!check.ok)
        throw check.expired
          ? fail(
              400,
              "CODE_EXPIRED",
              "This code has expired or was tried too many times. Ask for a new code.",
            )
          : fail(400, "INVALID_CODE", "That code is not right. Check the email and try again.");
      const slug = await freeStartingSlug(db, b.name);
      const hash = b.password
        ? await passwordHash(b.password)
        : unusablePassword();
      const uid = randomUUID(),
        tid = randomUUID();
      await db.system(async (tx) => {
        const [existing] = await tx.query(
          "SELECT id FROM users WHERE email=$1 FOR UPDATE",
          [b.email],
        );
        if (existing)
          throw fail(
            409,
            "ACCOUNT_EXISTS",
            "This email already has an account. Sign in instead.",
          );
        // The code proved the mailbox, so the address starts verified.
        await tx.query(
          "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,$3,$4,true)",
          [uid, b.email, b.name, hash],
        );
        await tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,$3)", [
          tid,
          slug,
          b.name,
        ]);
        await tx.query(
          "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
          [tid, uid],
        );
        const a = { tenantId: tid, userId: uid, role: "owner" };
        await tx.tenant(a, async (tx) => {
          await putRecord(tx, a, "onboarding", {
            steps: { account: true },
            licenceStatus: "NOT_REQUESTED",
          });
          await tx.query(
            "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'registration',$4,true)",
            [randomUUID(), tid, uid, registrationVersion],
          );
          await event(tx, a, "trainer.signup_completed", uid, {
            method: "email_code",
          });
        });
      });
      await session(reply, uid, tid, false, "registration");
      try {
        await recordSignupAcquisition(db, req, {
          tenantId: tid,
          userId: uid,
          role: "owner",
        });
      } catch {
        req.log.warn("Signup acquisition conversion could not be recorded");
      }
      return reply.code(201).send({ ok: true, next: "/trainer/setup" });
    },
  );
}
