import { modelAccounting } from "./model-accounting.ts";
import { privacyOperations } from "./privacy-operations.ts";
import { executePayout } from "./payout-execution.ts";
import { ingestionRoutes } from "./ingestion.ts";
import { operationsRoutes } from "./operations.ts";
import { financeOperations } from "./finance-operations.ts";
import { securityRoutes, consumeMfa, requireRecentMfa } from "./security.ts";
import { processStripeEvent } from "./stripe-events.ts";
export { processStripeEvent } from "./stripe-events.ts";
import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { randomUUID, createHash } from "node:crypto";
import { z, ZodError } from "zod";
import {
  createDatabase,
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import {
  signupSchema,
  loginSchema,
  brandSchema,
  intakeSchema,
  setSchema,
  productSchema,
} from "@trainer/contracts";
import {
  programSchema,
  ruleSchema,
  safetySignal,
  validUaeIban,
  refundEligible,
} from "@trainer/domain";
import {
  ProviderUnavailable,
  integrationStatus,
  modelDecision,
  compileTrainerRules,
  requireCommerce,
  stripeClient,
  LeanGateway,
} from "@trainer/providers";
import { passwordHash, passwordMatches, tokenHash, newToken } from "./auth.ts";
import {
  financeSummary,
  recordCharge,
  journal,
  createPayout,
  transitionPayout,
} from "./finance.ts";

type Identity = Actor & {
  name: string;
  email: string;
  platformRole: string;
  emailVerified: boolean;
  mfaAt?: string | null;
};
declare module "fastify" {
  interface FastifyRequest {
    identity?: Identity;
    rawBody?: string;
  }
}
const id = z.string().uuid();
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const publicUrl = () => process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
function identity(req: FastifyRequest): Identity {
  if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  return req.identity;
}
function trainer(req: FastifyRequest) {
  const a = identity(req);
  if (!["owner", "staff"].includes(a.role))
    throw fail(403, "ROLE_REQUIRED", "Trainer access required");
  return a;
}
function owner(req: FastifyRequest) {
  const a = identity(req);
  if (a.role !== "owner")
    throw fail(403, "OWNER_REQUIRED", "Only the trainer owner can do this");
  return a;
}
async function findRecord(tx: Tx, recordId: string, kind?: string) {
  const [r] = await tx.query(
    "SELECT * FROM records WHERE id=$1" + (kind ? " AND kind=$2" : ""),
    kind ? [id.parse(recordId), kind] : [id.parse(recordId)],
  );
  if (!r) throw fail(404, "NOT_FOUND", "This item is unavailable");
  return r;
}
async function putException(
  tx: Tx,
  a: Actor,
  data: unknown,
  options: { ownerId?: string; status?: string } = {},
) {
  const id = randomUUID();
  await tx.query(
    "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,'exception',$3,$4,$5)",
    [
      id,
      a.tenantId,
      options.ownerId ?? a.userId,
      options.status ?? "open",
      JSON.stringify(data),
    ],
  );
  return { id };
}
async function activeMembership(tx: Tx, a: Actor) {
  if (a.role !== "subscriber") return;
  const [s] = await tx.query(
    "SELECT id FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing') AND (period_end IS NULL OR period_end>now())",
    [a.userId],
  );
  if (!s)
    throw fail(402, "MEMBERSHIP_REQUIRED", "An active membership is required");
}

export async function buildApp(
  options: { db?: Database; testing?: boolean } = {},
) {
  const db = options.db ?? (await createDatabase());
  const app = Fastify({
    logger: options.testing
      ? false
      : {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers.set-cookie",
          ],
        },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: options.testing ? 10000 : 120,
    timeWindow: "1 minute",
  });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      try {
        req.rawBody = String(body);
        done(null, JSON.parse(String(body)));
      } catch (e) {
        done(e as Error);
      }
    },
  );
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "strict-origin-when-cross-origin")
      .header("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.url.startsWith("/api/v1/webhooks/")
    ) {
      if (req.headers.origin !== publicUrl())
        throw fail(403, "ORIGIN_REJECTED", "Request origin is not permitted");
    }
    const token = req.cookies.session;
    if (token) {
      const rows = await db.system((tx) =>
        tx.query(
          "SELECT s.user_id,s.tenant_id,u.name,u.email,u.platform_role,u.email_verified,s.mfa_at,m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id WHERE s.token_hash=$1 AND s.expires_at>now()",
          [tokenHash(token)],
        ),
      );
      const s = rows[0];
      if (s)
        req.identity = {
          tenantId: s.tenant_id,
          userId: s.user_id,
          role: s.role,
          name: s.name,
          email: s.email,
          platformRole: s.platform_role,
          emailVerified: s.email_verified,
          mfaAt: s.mfa_at,
        };
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        code: "VALIDATION",
        message: error.issues
          .map((x) => `${x.path.join(".") || "Input"}: ${x.message}`)
          .join("; "),
        requestId: req.id,
      });
    if (error instanceof ProviderUnavailable)
      return reply.code(503).send({
        code: "PROVIDER_UNAVAILABLE",
        message: error.message,
        provider: error.provider,
        requestId: req.id,
      });
    const e = error as any;
    const status = e.code === "23505" ? 409 : (e.statusCode ?? 500);
    if (status >= 500)
      req.log.error(
        { name: e.name, code: e.code, message: e.message },
        "Request failed",
      );
    return reply.code(status).send({
      code: e.code ?? "REQUEST_FAILED",
      message:
        e.code === "23505"
          ? "This record already exists"
          : status < 500
            ? e.message
            : "The request could not be completed. Your changes have not been confirmed.",
      requestId: req.id,
    });
  });
  async function session(
    reply: any,
    userId: string,
    tenantId: string,
    mfa = false,
  ) {
    const token = newToken();
    await db.system((tx) =>
      tx.query(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,mfa_at) VALUES($1,$2,$3,now()+interval '7 days',CASE WHEN $4 THEN now() ELSE NULL END)",
        [tokenHash(token), userId, tenantId, mfa],
      ),
    );
    reply.setCookie("session", token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 604800,
    });
  }
  securityRoutes(app, db, identity);
  financeOperations(app, db, identity);
  privacyOperations(app, db, identity);
  operationsRoutes(app, db, identity);
  ingestionRoutes(app, db, trainer);
  app.get("/health", async () => ({ status: "ok", service: "trainer-api" }));
  app.get("/api/v1/health", async () => ({ status: "ok" }));
  app.get("/api/v1/ready", async () => {
    await db.system((tx) => tx.query("SELECT 1"));
    return { status: "ready" };
  });
  app.post(
    "/api/v1/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const b = signupSchema.parse(req.body);
      if (
        [
          "admin",
          "api",
          "app",
          "www",
          "support",
          "billing",
          "trainer",
        ].includes(b.slug)
      )
        throw fail(400, "RESERVED_SLUG", "Please choose another address");
      if (
        process.env.NODE_ENV === "production" &&
        process.env.LEGAL_APPROVED !== "true"
      )
        throw fail(
          503,
          "LEGAL_PENDING",
          "Registration is waiting for the published legal documents",
        );
      const uid = randomUUID(),
        tid = randomUUID(),
        hash = await passwordHash(b.password);
      await db.system(async (tx) => {
        await tx.query(
          "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,$3,$4,$5)",
          [uid, b.email, b.name, hash, process.env.NODE_ENV !== "production"],
        );
        await tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,$3)", [
          tid,
          b.slug,
          b.name,
        ]);
        await tx.query(
          "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
          [tid, uid],
        );
        const a = { tenantId: tid, userId: uid, role: "owner" };
        await tx.query("SET LOCAL ROLE trainer_app");
        await tx.query(
          "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','owner',true)",
          [tid, uid],
        );
        await putRecord(tx, a, "onboarding", {
          steps: { account: true },
          licenceStatus: "NOT_REQUESTED",
        });
        await tx.query(
          "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'registration','draft-2026-09',true)",
          [randomUUID(), tid, uid],
        );
        await event(tx, a, "trainer.signup_completed", uid);
      });
      await session(reply, uid, tid);
      return reply.code(201).send({ ok: true });
    },
  );
  app.post(
    "/api/v1/auth/enroll",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const b = z
        .object({
          name: z.string().min(2).max(100),
          email: z.email().transform((x) => x.toLowerCase()),
          password: z.string().min(12).max(128),
          coachSlug: z.string().max(40),
          accepted: z.literal(true),
          code: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
        })
        .strict()
        .parse(req.body);
      if (
        process.env.NODE_ENV === "production" &&
        process.env.LEGAL_APPROVED !== "true"
      )
        throw fail(
          503,
          "LEGAL_PENDING",
          "Membership signup is waiting for approved terms",
        );
      const hash = await passwordHash(b.password);
      const result = await db.system(async (tx) => {
        const [tenant] = await tx.query(
          "SELECT id FROM tenants WHERE slug=$1 AND published=true",
          [b.coachSlug],
        );
        if (!tenant)
          throw fail(
            404,
            "TRAINER_UNAVAILABLE",
            "This coaching space is not accepting public signups",
          );
        const [existing] = await tx.query(
          "SELECT * FROM users WHERE email=$1",
          [b.email],
        );
        if (
          existing &&
          !(await passwordMatches(b.password, existing.password_hash))
        )
          throw fail(
            401,
            "INVALID_LOGIN",
            "Use the password for your existing account",
          );
        const mfa = existing
          ? await consumeMfa(tx, existing.id, b.code)
          : false;
        const uid = existing?.id ?? randomUUID();
        if (!existing)
          await tx.query(
            "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
            [uid, b.email, b.name, hash],
          );
        await tx.query(
          "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber') ON CONFLICT DO NOTHING",
          [tenant.id, uid],
        );
        await tx.query("SET LOCAL ROLE trainer_app");
        await tx.query(
          "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','subscriber',true)",
          [tenant.id, uid],
        );
        await tx.query(
          "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'registration',$4,true)",
          [
            randomUUID(),
            tenant.id,
            uid,
            process.env.LEGAL_VERSION ?? "draft-2026-09",
          ],
        );
        await event(
          tx,
          { tenantId: tenant.id, userId: uid, role: "subscriber" },
          "subscriber.enrolled",
          uid,
        );
        return { uid, tid: tenant.id, mfa };
      });
      await session(reply, result.uid, result.tid, result.mfa);
      return reply.code(201).send({ ok: true });
    },
  );
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 15, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const b = loginSchema.parse(req.body);
      const [u] = await db.system((tx) =>
        tx.query("SELECT * FROM users WHERE email=$1", [b.email]),
      );
      if (!u || !(await passwordMatches(b.password, u.password_hash)))
        throw fail(401, "INVALID_LOGIN", "Email or password is incorrect");
      const [m] = await db.system((tx) =>
        tx.query(
          "SELECT tenant_id FROM memberships WHERE user_id=$1 ORDER BY tenant_id LIMIT 1",
          [u.id],
        ),
      );
      if (!m) throw fail(403, "NO_MEMBERSHIP", "No active workspace");
      const mfa = await db.system((tx) => consumeMfa(tx, u.id, b.code));
      await session(reply, u.id, m.tenant_id, mfa);
      return { ok: true };
    },
  );
  app.post("/api/v1/auth/logout", async (req, reply) => {
    if (req.cookies.session)
      await db.system((tx) =>
        tx.query("DELETE FROM sessions WHERE token_hash=$1", [
          tokenHash(req.cookies.session!),
        ]),
      );
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });
  app.post("/api/v1/auth/workspace", async (req, reply) => {
    const a = identity(req);
    const b = z.object({ tenantId: id }).parse(req.body);
    const [m] = await db.system((tx) =>
      tx.query(
        "SELECT tenant_id FROM memberships WHERE user_id=$1 AND tenant_id=$2",
        [a.userId, b.tenantId],
      ),
    );
    if (!m) throw fail(403, "NO_MEMBERSHIP", "Workspace access denied");
    await db.system((tx) =>
      tx.query("DELETE FROM sessions WHERE token_hash=$1", [
        tokenHash(req.cookies.session!),
      ]),
    );
    await session(reply, a.userId, b.tenantId);
    return { ok: true };
  });
  app.get("/api/v1/bootstrap", async (req) => {
    const a = identity(req);
    const [tenant] = await db.system((tx) =>
      tx.query("SELECT * FROM tenants WHERE id=$1", [a.tenantId]),
    );
    return db.tenant(a, async (tx) => ({
      environment:
        process.env.NODE_ENV === "production" ? "production" : "development",
      user: a,
      tenant,
      records: await tx.query(
        "SELECT * FROM records ORDER BY updated_at DESC LIMIT 1000",
      ),
      sets: await tx.query(
        "SELECT * FROM workout_events ORDER BY created_at DESC LIMIT 1000",
      ),
      subscriptions: await tx.query(
        "SELECT * FROM subscriptions ORDER BY period_end DESC",
      ),
      consents: await tx.query(
        "SELECT * FROM consent_records WHERE user_id=$1 ORDER BY created_at DESC",
        [a.userId],
      ),
      integrations: integrationStatus(),
      ...(a.role === "subscriber"
        ? {}
        : {
            members: await tx.query(
              "SELECT u.id,u.name,u.email,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 ORDER BY u.name",
              [a.tenantId],
            ),
            events: await tx.query(
              "SELECT * FROM events ORDER BY created_at DESC LIMIT 100",
            ),
            ...(["owner", "finance"].includes(a.role)
              ? {
                  costs: await tx.query(
                    "SELECT * FROM cost_events ORDER BY created_at DESC LIMIT 100",
                  ),
                  payouts: await tx.query(
                    "SELECT * FROM payouts ORDER BY created_at DESC",
                  ),
                  journals: await tx.query(
                    "SELECT * FROM journals ORDER BY created_at DESC LIMIT 200",
                  ),
                  usageStatements: await tx.query(
                    "SELECT period,total_cost_usd,fx_aed_per_usd,charge_minor,fee_schedule_version FROM usage_statements ORDER BY period DESC",
                  ),
                  finance: await financeSummary(tx),
                }
              : {}),
          }),
    }));
  });
  app.put("/api/v1/tenant/brand", async (req) => {
    const a = owner(req),
      b = brandSchema.parse(req.body);
    await db.system((tx) =>
      tx.query("UPDATE tenants SET name=$2,theme=$3 WHERE id=$1", [
        a.tenantId,
        b.name,
        JSON.stringify(b),
      ]),
    );
    await db.tenant(a, (tx) =>
      event(tx, a, "tenant.brand_updated", a.tenantId),
    );
    return { ok: true };
  });
  app.post("/api/v1/tenant/publish", async (req) => {
    const a = owner(req);
    requireRecentMfa(a);
    if (!a.emailVerified)
      throw fail(
        409,
        "EMAIL_UNVERIFIED",
        "Verify your email before publishing",
      );
    if (
      process.env.LEGAL_APPROVED !== "true" ||
      process.env.COMMERCE_APPROVED !== "true"
    )
      throw fail(
        409,
        "PUBLISH_GATES",
        "Legal and payment readiness must be confirmed before public launch",
      );
    const readiness = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT kind,count(*) FROM records WHERE (kind='brain_release' AND status='published') OR (kind='product' AND status='published') GROUP BY kind",
      ),
    );
    if (readiness.length < 2)
      throw fail(
        409,
        "PUBLISH_GATES",
        "Publish an evaluated Brain and an available offer first",
      );
    await db.system((tx) =>
      tx.query("UPDATE tenants SET published=true WHERE id=$1", [a.tenantId]),
    );
    await db.tenant(a, (tx) =>
      event(tx, a, "storefront.published", a.tenantId),
    );
    return { ok: true };
  });
  app.get("/api/v1/public/trainers/:slug", async (req) => {
    const slug = (req.params as any).slug;
    const [t] = await db.system((tx) =>
      tx.query(
        "SELECT id,slug,name,theme FROM tenants WHERE slug=$1 AND published=true",
        [slug],
      ),
    );
    if (!t) throw fail(404, "NOT_FOUND", "This coaching page is not published");
    const products = await db.tenant(
      {
        tenantId: t.id,
        userId: "00000000-0000-0000-0000-000000000000",
        role: "subscriber",
      },
      (tx) =>
        tx.query(
          "SELECT id,data FROM records WHERE kind='product' AND status='published'",
        ),
    );
    return { trainer: t, products };
  });

  app.post("/api/v1/invitations", async (req) => {
    const a = owner(req);
    const b = z
      .object({
        email: z.email(),
        role: z.enum(["staff", "finance", "subscriber"]),
      })
      .parse(req.body);
    const token = newToken();
    await db.system((tx) =>
      tx.query(
        "INSERT INTO one_time_tokens(token_hash,purpose,tenant_id,payload,expires_at) VALUES($1,'invite',$2,$3,now()+interval '7 days')",
        [tokenHash(token), a.tenantId, JSON.stringify(b)],
      ),
    );
    await db.tenant(a, (tx) =>
      event(tx, a, "team.invited", undefined, { role: b.role }),
    );
    return { url: `${publicUrl()}/join/${token}`, expiresInDays: 7 };
  });
  app.post("/api/v1/invitations/accept", async (req, reply) => {
    const b = z
      .object({
        token: z.string().min(20),
        name: z.string().min(2).max(100),
        email: z.email(),
        password: z.string().min(12).max(128),
        code: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
      })
      .parse(req.body);
    const hash = await passwordHash(b.password);
    const result = await db.system(async (tx) => {
      const [invite] = await tx.query(
        "SELECT * FROM one_time_tokens WHERE token_hash=$1 AND purpose='invite' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
        [tokenHash(b.token)],
      );
      if (
        !invite ||
        invite.payload.email.toLowerCase() !== b.email.toLowerCase()
      )
        throw fail(400, "INVALID_INVITE", "Invitation is invalid or expired");
      const [existing] = await tx.query("SELECT * FROM users WHERE email=$1", [
        b.email.toLowerCase(),
      ]);
      if (
        existing &&
        !(await passwordMatches(b.password, existing.password_hash))
      )
        throw fail(
          401,
          "INVALID_LOGIN",
          "Use the password for your existing account",
        );
      const mfa = existing ? await consumeMfa(tx, existing.id, b.code) : false;
      const uid = existing?.id ?? randomUUID();
      if (!existing)
        await tx.query(
          "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,$3,$4,$5)",
          [uid, b.email.toLowerCase(), b.name, hash, false],
        );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [invite.tenant_id, uid, invite.payload.role],
      );
      await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE token_hash=$1",
        [tokenHash(b.token)],
      );
      return { uid, tid: invite.tenant_id, mfa };
    });
    await session(reply, result.uid, result.tid, result.mfa);
    return { ok: true };
  });
  app.delete("/api/v1/team/:userId", async (req) => {
    const a = owner(req),
      uid = id.parse((req.params as any).userId);
    if (uid === a.userId)
      throw fail(
        400,
        "SELF_REVOKE",
        "The owner cannot revoke their own membership",
      );
    await db.system(async (tx) => {
      await tx.query(
        "DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role IN ('staff','finance')",
        [a.tenantId, uid],
      );
      await tx.query("DELETE FROM sessions WHERE tenant_id=$1 AND user_id=$2", [
        a.tenantId,
        uid,
      ]);
    });
    await db.tenant(a, (tx) => event(tx, a, "team.revoked", uid));
    return { ok: true };
  });

  app.post("/api/v1/brain/sources", async (req) => {
    const a = trainer(req);
    const b = z
      .object({
        title: z.string().min(2).max(120),
        text: z.string().min(10).max(60000),
        rights: z.literal(true),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const hash = createHash("sha256").update(b.text).digest("hex");
      const [exists] = await tx.query(
        "SELECT * FROM records WHERE kind='source' AND data->>'hash'=$1",
        [hash],
      );
      if (exists) return exists;
      const r = await putRecord(
        tx,
        a,
        "source",
        {
          title: b.title,
          text: b.text,
          hash,
          origin: "trainer_upload",
          allowedUses: ["render", "model_prompt", "trainer_specific_learning"],
          rightsAttestedAt: new Date().toISOString(),
        },
        { status: "ready" },
      );
      await event(tx, a, "brain.source_ingested", r.id);
      return r;
    });
  });
  app.post("/api/v1/brain/interviews", async (req) => {
    const a = trainer(req);
    const b = z
      .object({
        question: z.string().min(3).max(1000),
        answer: z.string().min(3).max(12000),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const r = await putRecord(
        tx,
        a,
        "interview",
        { ...b, allowedUses: ["model_prompt", "trainer_specific_learning"] },
        { status: "answered" },
      );
      await event(tx, a, "brain.interview_answered", r.id);
      return r;
    });
  });
  app.post("/api/v1/brain/compile", async (req) => {
    const a = owner(req),
      b = z.object({ sourceIds: z.array(id).min(1).max(20) }).parse(req.body);
    const material = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT * FROM records WHERE id=ANY($1::uuid[]) AND kind IN ('source','interview')",
        [b.sourceIds],
      ),
    );
    if (material.length !== new Set(b.sourceIds).size)
      throw fail(
        400,
        "SOURCE_UNAVAILABLE",
        "All sources must belong to this workspace and be trainer teaching material",
      );
    const generated = await compileTrainerRules(
      material.map((r) => ({ id: r.id, data: r.data })),
      modelAccounting(db, a, "brain_compilation"),
    );
    return db.tenant(a, async (tx) => {
      const rules = [];
      for (const rule of generated.rules)
        rules.push(
          await putRecord(
            tx,
            a,
            "rule",
            {
              ...rule,
              allowedUses: [
                "render",
                "model_prompt",
                "trainer_specific_learning",
              ],
              origin: "compiler",
            },
            { status: "draft" },
          ),
        );
      for (const conflict of generated.conflicts)
        await putRecord(tx, a, "conflict", conflict, { status: "open" });
      await event(tx, a, "brain.compiled", undefined, {
        rules: rules.length,
        conflicts: generated.conflicts.length,
      });
      return { rules, conflicts: generated.conflicts.length };
    });
  });
  app.patch("/api/v1/brain/rules/:id", async (req) => {
    const a = owner(req),
      b = z
        .object({
          rule: ruleSchema,
          reason: z.string().min(5).max(2000),
          version: z.number().int().positive(),
        })
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='rule' FOR UPDATE",
        [id.parse((req.params as any).id)],
      );
      if (!r) throw fail(404, "NOT_FOUND", "Rule unavailable");
      if (r.version !== b.version)
        throw fail(
          409,
          "VERSION_CONFLICT",
          "This rule changed; reload it before editing",
        );
      for (const ref of b.rule.sourceIds) await findRecord(tx, ref);
      await putRecord(
        tx,
        a,
        "rule_revision",
        {
          ruleId: r.id,
          previous: r.data,
          previousVersion: r.version,
          reason: b.reason,
        },
        { status: "recorded" },
      );
      const [updated] = await tx.query(
        "UPDATE records SET data=$2,status='draft',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [
          r.id,
          JSON.stringify({
            ...b.rule,
            allowedUses: [
              "render",
              "model_prompt",
              "trainer_specific_learning",
            ],
          }),
        ],
      );
      await event(tx, a, "brain.rule_corrected", r.id, {
        previousVersion: r.version,
      });
      return updated;
    });
  });
  app.post("/api/v1/brain/conflicts/:id/resolve", async (req) => {
    const a = owner(req),
      b = z
        .object({ resolution: z.string().min(10).max(3000) })
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const r = await findRecord(tx, (req.params as any).id, "conflict");
      await tx.query(
        "UPDATE records SET status='resolved',data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [r.id, JSON.stringify({ ...b, resolvedBy: a.userId })],
      );
      await event(tx, a, "brain.conflict_resolved", r.id);
      return { ok: true };
    });
  });
  app.post("/api/v1/brain/rules", async (req) => {
    const a = trainer(req),
      b = ruleSchema.parse(req.body);
    return db.tenant(a, async (tx) => {
      for (const ref of b.sourceIds) {
        const source = await findRecord(tx, ref);
        if (!["source", "interview"].includes(source.kind))
          throw fail(
            400,
            "INVALID_SOURCE",
            "Rules can cite trainer teaching sources only",
          );
      }
      const r = await putRecord(tx, a, "rule", {
        ...b,
        allowedUses: ["render", "model_prompt", "trainer_specific_learning"],
      });
      await event(tx, a, "brain.rule_proposed", r.id);
      return r;
    });
  });
  app.post("/api/v1/brain/rules/:id/confirm", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => {
      const r = await findRecord(tx, (req.params as any).id, "rule");
      if (r.status === "confirmed") return r;
      const [out] = await tx.query(
        "UPDATE records SET status='confirmed',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *",
        [
          r.id,
          JSON.stringify({
            confirmedBy: a.userId,
            confirmedAt: new Date().toISOString(),
          }),
        ],
      );
      await event(tx, a, "brain.rule_confirmed", r.id);
      return out;
    });
  });
  app.post("/api/v1/brain/scenarios", async (req) => {
    const a = trainer(req);
    const b = z
      .object({
        prompt: z.string().min(10).max(3000),
        expectedEvidenceId: id,
        expectEscalation: z.boolean(),
        heldOut: z.literal(true),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      await findRecord(tx, b.expectedEvidenceId, "rule");
      return putRecord(tx, a, "scenario", b, { status: "held_out" });
    });
  });
  app.post("/api/v1/brain/evaluate", async (req) => {
    const a = owner(req);
    const material = await db.tenant(a, async (tx) => ({
      rules: await tx.query(
        "SELECT * FROM records WHERE kind='rule' AND status='confirmed' ORDER BY id",
      ),
      cases: await tx.query(
        "SELECT * FROM records WHERE kind='scenario' AND status='held_out' ORDER BY id LIMIT 30",
      ),
    }));
    if (material.cases.length < 20)
      throw fail(
        409,
        "EVAL_COVERAGE",
        "Add at least 20 held-out scenarios before evaluating a release",
      );
    const outcomes: Array<{ scenarioId: string; passed: boolean }> = [];
    for (const c of material.cases) {
      const generated = await modelDecision(
        "held_out_evaluation",
        c.data.prompt,
        material.rules.map((r) => ({ id: r.id, data: r.data })),
        modelAccounting(db, a, "evaluation"),
      );
      const passed = c.data.expectEscalation
        ? generated.decision.type === "escalation"
        : generated.decision.evidenceIds.includes(c.data.expectedEvidenceId);
      outcomes.push({ scenarioId: c.id, passed });
    }
    const digest = createHash("sha256")
      .update(
        JSON.stringify(
          material.rules.map((r) => ({
            id: r.id,
            data: r.data,
            version: r.version,
          })),
        ),
      )
      .digest("hex");
    return db.tenant(a, async (tx) => {
      const r = await putRecord(
        tx,
        a,
        "evaluation",
        {
          outcomes,
          total: outcomes.length,
          passed: outcomes.filter((x) => x.passed).length,
          rulesDigest: digest,
        },
        { status: outcomes.every((x) => x.passed) ? "passed" : "failed" },
      );
      await event(tx, a, "brain.evaluation_completed", r.id, {
        total: outcomes.length,
      });
      return r;
    });
  });
  app.post("/api/v1/brain/releases", async (req) => {
    const a = owner(req);
    const b = z
      .object({ evaluationId: id, notes: z.string().max(2000) })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":brain",
      ]);
      const unresolved = await tx.query(
        "SELECT id FROM records WHERE kind='conflict' AND status='open'",
      );
      if (unresolved.length)
        throw fail(
          409,
          "CONFLICTS_OPEN",
          "Resolve teaching conflicts before publishing",
        );
      const evaluation = await findRecord(tx, b.evaluationId, "evaluation");
      const rules = await tx.query(
        "SELECT * FROM records WHERE kind='rule' AND status='confirmed' ORDER BY id",
      );
      const digest = createHash("sha256")
        .update(
          JSON.stringify(
            rules.map((r) => ({ id: r.id, data: r.data, version: r.version })),
          ),
        )
        .digest("hex");
      if (
        evaluation.status !== "passed" ||
        evaluation.data.rulesDigest !== digest
      )
        throw fail(
          409,
          "EVAL_REQUIRED",
          "A passing evaluation of the current rules is required",
        );
      await tx.query(
        "UPDATE records SET status='archived' WHERE kind='brain_release' AND status='published'",
      );
      const release = await putRecord(
        tx,
        a,
        "brain_release",
        {
          rules: rules.map((r) => ({
            id: r.id,
            data: r.data,
            version: r.version,
          })),
          evaluationId: evaluation.id,
          notes: b.notes,
          mode: "supervised",
        },
        { status: "published" },
      );
      await event(tx, a, "brain.release_published", release.id);
      return release;
    });
  });
  app.post("/api/v1/brain/releases/:id/rollback", async (req) => {
    const a = owner(req);
    return db.tenant(a, async (tx) => {
      const target = await findRecord(
        tx,
        (req.params as any).id,
        "brain_release",
      );
      await tx.query(
        "UPDATE records SET status='archived' WHERE kind='brain_release' AND status='published'",
      );
      await tx.query(
        "UPDATE records SET status='published',updated_at=now() WHERE id=$1",
        [target.id],
      );
      await event(tx, a, "brain.rollback", target.id);
      return { ok: true };
    });
  });

  app.post("/api/v1/intake", async (req) => {
    const a = identity(req),
      b = intakeSchema.parse(req.body);
    return db.tenant(a, async (tx) => {
      const r = await putRecord(
        tx,
        a,
        "intake",
        {
          ...b,
          allowedUses: ["render", "model_prompt"],
          origin: "platform",
          capturedAt: new Date().toISOString(),
        },
        { status: "complete" },
      );
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','draft-2026-09',true)",
        [randomUUID(), a.tenantId, a.userId],
      );
      await event(tx, a, "intake.completed", r.id);
      return r;
    });
  });
  app.post("/api/v1/programs", async (req) => {
    const a = trainer(req);
    const b = z
      .object({ program: programSchema, subscriberId: id.optional() })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      if (b.subscriberId) {
        const [m] = await tx.query(
          "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
          [a.tenantId, b.subscriberId],
        );
        if (!m) throw fail(404, "NOT_FOUND", "Subscriber unavailable");
      }
      const r = await putRecord(
        tx,
        a,
        "program",
        {
          ...b.program,
          authorId: a.userId,
          allowedUses: ["render", "model_prompt"],
        },
        {
          ownerId: b.subscriberId ?? a.userId,
          status: b.subscriberId ? "assigned" : "template",
        },
      );
      await event(tx, a, "program.created", r.id);
      return r;
    });
  });
  app.post("/api/v1/workouts/start", async (req) => {
    const a = identity(req);
    const b = z.object({ programId: id }).parse(req.body);
    return db.tenant(a, async (tx) => {
      await activeMembership(tx, a);
      const program = await findRecord(tx, b.programId, "program");
      const r = await putRecord(
        tx,
        a,
        "workout",
        {
          programId: program.id,
          programVersion: program.version,
          program: program.data,
          startedAt: new Date().toISOString(),
        },
        { status: "active" },
      );
      await event(tx, a, "workout.started", r.id);
      return r;
    });
  });
  app.post("/api/v1/workouts/:id/sets", async (req) => {
    const a = identity(req);
    const b = setSchema.parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":set:" + a.userId + ":" + b.eventKey,
      ]);
      const [prior] = await tx.query(
        "SELECT id,workout_id,data=$3::jsonb AS matches FROM workout_events WHERE user_id=$1 AND event_key=$2",
        [a.userId, b.eventKey, JSON.stringify(b)],
      );
      if (prior) {
        if (prior.workout_id !== (req.params as any).id || !prior.matches)
          throw fail(
            409,
            "INTENT_CONFLICT",
            "This event key was already used with different set details",
          );
        return { id: prior.id, duplicate: true };
      }
      await activeMembership(tx, a);
      const w = await findRecord(tx, (req.params as any).id, "workout");
      if (w.owner_user_id !== a.userId || w.status !== "active")
        throw fail(
          409,
          "WORKOUT_STATE",
          "This workout is not open for logging",
        );
      await tx.query("SELECT id FROM records WHERE id=$1 FOR UPDATE", [w.id]);
      const current = await findRecord(tx, w.id, "workout");
      if (current.status !== "active")
        throw fail(
          409,
          "WORKOUT_STATE",
          "This workout has been paused or completed",
        );
      const exercise = current.data.program.exercises.find(
        (ex: any) => ex.name === b.exercise,
      );
      if (!exercise || b.set > exercise.sets)
        throw fail(
          400,
          "SET_NOT_IN_PROGRAM",
          "This set is outside the assigned workout",
        );
      const [r] = await tx.query(
        "INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,user_id,event_key) DO NOTHING RETURNING *",
        [
          randomUUID(),
          a.tenantId,
          a.userId,
          w.id,
          b.eventKey,
          JSON.stringify(b),
        ],
      );
      return r ?? { duplicate: true };
    });
  });
  app.post("/api/v1/workouts/:id/finish", async (req) => {
    const a = identity(req);
    return db.tenant(a, async (tx) => {
      const w = await findRecord(tx, (req.params as any).id, "workout");
      if (w.owner_user_id !== a.userId)
        throw fail(403, "OWNER_REQUIRED", "Workout ownership required");
      if (w.status === "completed") return w;
      if (w.status !== "active")
        throw fail(
          409,
          "WORKOUT_STATE",
          "Resolve the safety hold before continuing",
        );
      await tx.query(
        "UPDATE records SET status='completed',data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [w.id, JSON.stringify({ completedAt: new Date().toISOString() })],
      );
      await event(tx, a, "workout.completed", w.id);
      return { ok: true };
    });
  });
  app.post("/api/v1/workouts/:id/pain", async (req) => {
    const a = identity(req);
    const b = z
      .object({ description: z.string().min(3).max(2000) })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const w = await findRecord(tx, (req.params as any).id, "workout");
      if (w.owner_user_id !== a.userId)
        throw fail(403, "OWNER_REQUIRED", "Workout ownership required");
      await tx.query(
        "UPDATE records SET status='safety_hold',updated_at=now() WHERE id=$1",
        [w.id],
      );
      const r = await putException(
        tx,
        a,
        {
          category: "safety",
          description: b.description,
          workoutId: w.id,
          subscriberId: a.userId,
        },
        { status: "open" },
      );
      await event(tx, a, "safety.escalated", r.id);
      return {
        message:
          "Pause this workout. Your trainer has been notified for review. Seek urgent local medical help if your symptoms are severe or urgent.",
      };
    });
  });

  app.post("/api/v1/coaching/ask", async (req) => {
    const a = identity(req);
    const b = z
      .object({ message: z.string().min(1).max(4000) })
      .parse(req.body);
    const material = await db.tenant({ ...a, role: "staff" }, async (tx) => {
      await activeMembership(tx, a);
      await putRecord(
        tx,
        a,
        "message",
        { text: b.message, author: "subscriber", subscriberId: a.userId },
        { status: "sent" },
      );
      const takeover = await tx.query(
        "SELECT id FROM records WHERE kind='takeover' AND owner_user_id=$1 AND status='active'",
        [a.userId],
      );
      const intake = await tx.query(
        "SELECT * FROM records WHERE kind='intake' AND owner_user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [a.userId],
      );
      const [consent] = await tx.query(
        "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC LIMIT 1",
        [a.userId],
      );
      return {
        takeover: takeover.length > 0,
        intake,
        consent: !!consent?.granted,
      };
    });
    if (safetySignal(b.message) || material.takeover) {
      return db.tenant(a, async (tx) => {
        await putException(
          tx,
          a,
          {
            category: safetySignal(b.message) ? "safety" : "human_review",
            description: b.message,
            subscriberId: a.userId,
          },
          { status: "open" },
        );
        const r = await putRecord(
          tx,
          a,
          "message",
          {
            text: "I have sent this to your trainer for review. Pause exercise if you have new pain or concerning symptoms; seek urgent local help when needed.",
            author: "system",
            subscriberId: a.userId,
          },
          { status: "sent" },
        );
        return r;
      });
    }
    if (!material.consent)
      throw fail(
        409,
        "COACHING_CONSENT_REQUIRED",
        "Digital coaching permission is not active. You can send a personal message to your trainer.",
      );
    const released = await db.tenant({ ...a, role: "staff" }, (tx) =>
      tx.query(
        "SELECT * FROM records WHERE kind='brain_release' AND status='published' ORDER BY created_at DESC LIMIT 1",
      ),
    );
    if (!released[0])
      throw fail(
        409,
        "BRAIN_NOT_READY",
        "Your trainer is preparing the digital coaching release. Send them a message for personal review.",
      );
    if (!material.intake.length)
      throw fail(
        409,
        "INTAKE_REQUIRED",
        "Complete your coaching profile before using digital coaching",
      );
    const rules = released[0].data.rules;
    const evidence = [
      ...rules,
      ...material.intake.map((r) => ({ id: r.id, data: r.data })),
    ];
    const generated = await modelDecision(
      "coaching",
      b.message,
      evidence,
      modelAccounting(db, a, "coaching"),
    );
    return db.tenant({ ...a, role: "staff" }, async (tx) => {
      const d = await putRecord(
        tx,
        a,
        "decision",
        {
          ...generated.decision,
          brainVersionId: released[0].id,
          clientSnapshotId: material.intake[0]?.id ?? null,
        },
        { ownerId: a.userId, status: "pending_review" },
      );
      await putException(
        tx,
        a,
        {
          category: "decision_review",
          decisionId: d.id,
          subscriberId: a.userId,
          description: generated.decision.reason,
        },
        { ownerId: a.userId, status: "open" },
      );
      await event(tx, a, "coaching.review_required", d.id);
      return {
        pendingReview: true,
        message:
          "Your digital coach has prepared a response for your trainer to review.",
      };
    });
  });
  app.post("/api/v1/messages", async (req) => {
    const a = identity(req);
    if (a.role !== "subscriber") trainer(req);
    const b = z
      .object({
        text: z.string().min(1).max(4000),
        subscriberId: id.optional(),
      })
      .parse(req.body);
    const target = a.role === "subscriber" ? a.userId : b.subscriberId;
    if (!target) throw fail(400, "SUBSCRIBER_REQUIRED", "Select a subscriber");
    return db.tenant(a, async (tx) => {
      const [m] = await tx.query(
        "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
        [a.tenantId, target],
      );
      if (!m) throw fail(404, "NOT_FOUND", "Subscriber unavailable");
      return putRecord(
        tx,
        a,
        "message",
        {
          text: b.text,
          author: a.role === "subscriber" ? "subscriber" : "trainer",
          subscriberId: target,
        },
        { ownerId: target, status: "sent" },
      );
    });
  });
  app.post("/api/v1/takeover", async (req) => {
    const a = trainer(req);
    const b = z
      .object({ subscriberId: id, active: z.boolean() })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query(
        "UPDATE records SET status='ended' WHERE kind='takeover' AND owner_user_id=$1",
        [b.subscriberId],
      );
      if (b.active)
        await putRecord(
          tx,
          a,
          "takeover",
          { trainerId: a.userId },
          { ownerId: b.subscriberId, status: "active" },
        );
      await event(tx, a, "coaching.takeover_changed", b.subscriberId, {
        active: b.active,
      });
      return { ok: true };
    });
  });
  app.post("/api/v1/exceptions/:id/resolve", async (req) => {
    const a = trainer(req);
    const b = z
      .object({
        note: z.string().min(3).max(4000),
        approveDecision: z.boolean().default(false),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const e = await findRecord(tx, (req.params as any).id, "exception");
      if (e.status === "resolved") return e;
      if (b.approveDecision && e.data.decisionId) {
        const d = await findRecord(tx, e.data.decisionId, "decision");
        const [release] = await tx.query(
          "SELECT id FROM records WHERE kind='brain_release' AND status='published'",
        );
        const [consent] = await tx.query(
          "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC LIMIT 1",
          [e.data.subscriberId],
        );
        if (!consent?.granted || release?.id !== d.data.brainVersionId)
          throw fail(
            409,
            "REVIEW_STALE",
            "Consent or the published Brain changed; prepare a fresh decision",
          );
        if (d.status !== "pending_review")
          throw fail(
            409,
            "DECISION_STATE",
            "This decision has already been reviewed",
          );
        if (d.data.program)
          await putRecord(
            tx,
            a,
            "program",
            {
              ...d.data.program,
              sourceDecisionId: d.id,
              brainVersionId: d.data.brainVersionId,
              authorId: a.userId,
              allowedUses: ["render", "model_prompt"],
            },
            { ownerId: e.data.subscriberId, status: "assigned" },
          );
        await tx.query("UPDATE records SET status='approved' WHERE id=$1", [
          d.id,
        ]);
        await putRecord(
          tx,
          a,
          "message",
          {
            text: d.data.message,
            author: "digital_reviewed",
            reviewedBy: a.userId,
            decisionId: d.id,
            subscriberId: e.data.subscriberId,
          },
          { ownerId: e.data.subscriberId, status: "sent" },
        );
      }
      await tx.query(
        "UPDATE records SET status='resolved',data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [e.id, JSON.stringify({ resolution: b.note, resolvedBy: a.userId })],
      );
      await event(tx, a, "exception.resolved", e.id);
      return { ok: true };
    });
  });

  app.post("/api/v1/products", async (req) => {
    const a = owner(req),
      b = productSchema.parse(req.body);
    return db.tenant(a, async (tx) => {
      const r = await putRecord(tx, a, "product", b, { status: "draft" });
      await event(tx, a, "product.created", r.id);
      return r;
    });
  });
  app.post("/api/v1/products/:id/activate", async (req) => {
    const a = owner(req),
      stripe = requireCommerce();
    const product = await db.tenant(a, (tx) =>
      findRecord(tx, (req.params as any).id, "product"),
    );
    const remote = await stripe.products.create(
      {
        name: product.data.name,
        description: product.data.description,
        metadata: { tenant_id: a.tenantId, product_id: product.id },
      },
      { idempotencyKey: `product:${product.id}` },
    );
    const price = await stripe.prices.create(
      {
        product: remote.id,
        currency: "aed",
        unit_amount: product.data.priceMinor,
        recurring: { interval: "month" },
      },
      { idempotencyKey: `price:${product.id}:v${product.version}` },
    );
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE records SET status='published',data=data||$2::jsonb WHERE id=$1",
        [
          product.id,
          JSON.stringify({
            stripeProductId: remote.id,
            stripePriceId: price.id,
          }),
        ],
      ),
    );
    return { ok: true };
  });
  app.post("/api/v1/payments/checkout", async (req) => {
    const a = identity(req),
      stripe = requireCommerce();
    const b = z.object({ productId: id }).parse(req.body);
    const product = await db.tenant(a, (tx) =>
      findRecord(tx, b.productId, "product"),
    );
    if (product.status !== "published" || !product.data.stripePriceId)
      throw fail(409, "PRODUCT_UNAVAILABLE", "This offer is not available");
    const existing = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT id FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing')",
        [a.userId],
      ),
    );
    if (existing.length)
      throw fail(409, "ALREADY_SUBSCRIBED", "Manage your existing membership");
    if (a.role !== "subscriber")
      throw fail(
        403,
        "SUBSCRIBER_REQUIRED",
        "Sign in as a subscriber to purchase a membership",
      );
    const intent = await db.tenant({ ...a, role: "owner" }, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":checkout:" + a.userId,
      ]);
      const [existing] = await tx.query(
        "SELECT * FROM records WHERE kind='checkout' AND owner_user_id=$1 AND (data->>'expiresAt')::timestamptz>now() ORDER BY created_at DESC LIMIT 1",
        [a.userId],
      );
      if (existing) {
        if (existing.data.productId !== product.id)
          throw fail(
            409,
            "CHECKOUT_OPEN",
            "Finish or wait for your current checkout to expire before choosing another offer",
          );
        return existing;
      }
      return putRecord(
        tx,
        a,
        "checkout",
        {
          productId: product.id,
          priceId: product.data.stripePriceId,
          email: a.email,
          expiresAt: new Date(Date.now() + 35 * 60000).toISOString(),
        },
        { status: "creating" },
      );
    });
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer_email: intent.data.email,
        client_reference_id: intent.id,
        line_items: [{ price: intent.data.priceId, quantity: 1 }],
        expires_at: Math.floor(
          new Date(intent.data.expiresAt).getTime() / 1000,
        ),
        metadata: {
          tenant_id: a.tenantId,
          user_id: a.userId,
          intent_id: intent.id,
        },
        subscription_data: {
          metadata: { tenant_id: a.tenantId, user_id: a.userId },
        },
        success_url: `${publicUrl()}/app/membership?checkout=complete`,
        cancel_url: `${publicUrl()}/app/membership`,
      },
      { idempotencyKey: "checkout:" + intent.id },
    );
    await db.tenant({ ...a, role: "owner" }, (tx) =>
      tx.query(
        "UPDATE records SET status='open',data=data||$2::jsonb WHERE id=$1",
        [intent.id, JSON.stringify({ providerId: checkout.id })],
      ),
    );
    return { url: checkout.url };
  });
  app.post("/api/v1/membership/cancel", async (req) => {
    const a = identity(req),
      stripe = requireCommerce();
    const [s] = await db.tenant(a, (tx) =>
      tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [a.userId]),
    );
    if (!s?.provider_id)
      throw fail(404, "NO_SUBSCRIPTION", "No provider subscription found");
    await stripe.subscriptions.update(
      s.provider_id,
      { cancel_at_period_end: true },
      { idempotencyKey: `cancel:${s.id}:${s.period_end}` },
    );
    await db.tenant(a, async (tx) => {
      await tx.query(
        "UPDATE subscriptions SET cancel_at_period_end=true WHERE id=$1",
        [s.id],
      );
      await event(tx, a, "subscription.cancel_scheduled", s.id);
    });
    return { ok: true, accessUntil: s.period_end };
  });
  app.post("/api/v1/membership/reactivate", async (req) => {
    const a = identity(req),
      stripe = requireCommerce();
    const [s] = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT * FROM subscriptions WHERE user_id=$1 AND period_end>now()",
        [a.userId],
      ),
    );
    if (!s?.provider_id)
      throw fail(404, "NO_SUBSCRIPTION", "No renewable membership");
    await stripe.subscriptions.update(
      s.provider_id,
      { cancel_at_period_end: false },
      { idempotencyKey: `reactivate:${s.id}:${s.period_end}` },
    );
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE subscriptions SET cancel_at_period_end=false WHERE id=$1",
        [s.id],
      ),
    );
    return { ok: true };
  });
  app.post("/api/v1/refund-requests", async (req) => {
    const a = identity(req);
    const b = z
      .object({
        chargeId: z.string().min(3).max(200),
        reason: z.string().min(5).max(2000),
      })
      .parse(req.body);
    return db.tenant({ ...a, role: "staff" }, async (tx) => {
      const [charge] = await tx.query(
        "SELECT * FROM journals WHERE data->>'userId'=$1 AND data->>'chargeId'=$2",
        [a.userId, b.chargeId],
      );
      if (
        !charge ||
        !refundEligible(charge.data.chargedAt ?? charge.created_at)
      )
        throw fail(
          400,
          "REFUND_WINDOW",
          "This charge is outside the seven-day request window",
        );
      const [existing] = await tx.query(
        "SELECT id FROM records WHERE kind='refund' AND data->>'chargeId'=$1",
        [b.chargeId],
      );
      if (existing)
        throw fail(409, "ALREADY_REQUESTED", "A refund request already exists");
      return putRecord(
        tx,
        a,
        "refund",
        {
          ...b,
          journalId: charge.id,
          amountMinor: charge.data.grossMinor,
          requestedAt: new Date().toISOString(),
        },
        { ownerId: a.userId, status: "requested" },
      );
    });
  });
  app.post("/api/v1/refund-requests/:id/decision", async (req) => {
    const a = owner(req);
    const b = z
      .object({ approve: z.boolean(), reason: z.string().min(3).max(2000) })
      .parse(req.body);
    requireRecentMfa(a);
    const stripe = b.approve ? requireCommerce() : null;
    const r = await db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='refund' FOR UPDATE",
        [id.parse((req.params as any).id)],
      );
      if (!r) throw fail(404, "NOT_FOUND", "Refund request unavailable");
      if (r.status !== "requested")
        throw fail(
          409,
          "REFUND_STATE",
          "This request is already being reviewed or submitted; reconcile its existing instruction",
        );
      await tx.query(
        "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE id=$1",
        [
          r.id,
          b.approve ? "submitting" : "declined",
          JSON.stringify({
            decisionReason: b.reason,
            reviewedBy: a.userId,
            submittedAt: new Date().toISOString(),
          }),
        ],
      );
      await event(
        tx,
        a,
        b.approve ? "refund.approved" : "refund.declined",
        r.id,
      );
      return r;
    });
    if (stripe) {
      try {
        const refund = await stripe.refunds.create(
          {
            charge: r.data.chargeId,
            metadata: { refund_request_id: r.id, tenant_id: a.tenantId },
          },
          { idempotencyKey: `refund:${r.id}` },
        );
        await db.tenant(a, (tx) =>
          tx.query(
            "UPDATE records SET status='submitted',data=data||$2::jsonb WHERE id=$1 AND status IN ('submitting','unknown')",
            [r.id, JSON.stringify({ providerRefundId: refund.id })],
          ),
        );
      } catch (error) {
        await db.tenant(a, (tx) =>
          tx.query(
            "UPDATE records SET status='unknown' WHERE id=$1 AND status='submitting'",
            [r.id],
          ),
        );
        throw error;
      }
    }
    return { ok: true };
  });

  app.post("/api/v1/refund-requests/:id/reconcile", async (req) => {
    const a = owner(req);
    requireRecentMfa(a);
    const stripe = requireCommerce();
    const r = await db.tenant(a, (tx) =>
      findRecord(tx, (req.params as any).id, "refund"),
    );
    if (!["submitting", "submitted", "unknown"].includes(r.status))
      return { status: r.status };
    const page = await stripe.refunds.list({
      charge: r.data.chargeId,
      limit: 100,
    });
    const remote = page.data.find(
      (item) =>
        item.id === r.data.providerRefundId ||
        item.metadata?.refund_request_id === r.id,
    );
    if (!remote)
      throw fail(
        409,
        "REFUND_UNRESOLVED",
        page.has_more
          ? "The provider history needs a full finance reconciliation"
          : "No matching provider refund is confirmed; the existing instruction remains held",
      );
    await processStripeEvent(db, {
      id: "reconcile-refund:" + remote.id + ":" + remote.status,
      created: Math.floor(Date.now() / 1000),
      type: "refund.updated",
      data: { object: remote },
    });
    await db.tenant(a, (tx) =>
      event(tx, a, "refund.provider_reconciled", r.id, {
        providerRefundId: remote.id,
        status: remote.status,
      }),
    );
    return { status: remote.status };
  });

  app.post("/api/v1/payout-beneficiaries", async (req) => {
    const a = owner(req);
    requireRecentMfa(a);
    const b = z
      .object({
        name: z.string().min(3).max(100),
        iban: z.string(),
        address: z.string().min(3).max(200),
        city: z.string().min(2).max(100),
      })
      .parse(req.body);
    if (!validUaeIban(b.iban))
      throw fail(400, "INVALID_IBAN", "Enter a valid UAE IBAN");
    if (!integrationStatus().find((x) => x.id === "lean")?.approved)
      throw new ProviderUnavailable(
        "lean",
        "Verified Lean configuration is required",
      );
    const normalized = b.iban.replace(/\s/g, "").toUpperCase();
    const fingerprint = createHash("sha256").update(normalized).digest("hex");
    const r = await db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":bank",
      ]);
      const [existing] = await tx.query(
        "SELECT id FROM records WHERE kind='beneficiary' AND data->>'fingerprint'=$1 AND status<>'rejected'",
        [fingerprint],
      );
      if (existing)
        throw fail(
          409,
          "DESTINATION_EXISTS",
          "This destination already has a pending or verified instruction",
        );
      return putRecord(
        tx,
        a,
        "beneficiary",
        {
          name: b.name,
          maskedIban: `AE•••• ${normalized.slice(-4)}`,
          fingerprint,
        },
        { status: "submitting" },
      );
    });
    try {
      const result = await new LeanGateway().createBeneficiary(
        { ...b, iban: normalized },
        r.id,
      );
      const providerId = result.id ?? result.destination_id;
      if (!providerId) throw new Error("Missing destination reference");
      await db.tenant(a, async (tx) => {
        await tx.query(
          "UPDATE records SET status='validating',data=data||$2::jsonb WHERE id=$1",
          [r.id, JSON.stringify({ providerId })],
        );
        await event(tx, a, "payout.beneficiary_submitted", r.id);
      });
      return { id: r.id, status: "validating" };
    } catch (error) {
      await db.tenant(a, (tx) =>
        tx.query("UPDATE records SET status='unknown' WHERE id=$1", [r.id]),
      );
      throw error;
    }
  });

  app.post("/api/v1/payout-runs/prepare", async (req) => {
    const a = owner(req);
    const b = z
      .object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [beneficiary] = await tx.query(
        "SELECT * FROM records WHERE kind='beneficiary' AND status='verified' ORDER BY created_at DESC LIMIT 1",
      );
      if (!beneficiary)
        throw fail(
          409,
          "BENEFICIARY_REQUIRED",
          "A verified payout destination is required",
        );
      if (
        !beneficiary.data.holdUntil ||
        new Date(beneficiary.data.holdUntil).getTime() > Date.now()
      )
        throw fail(
          409,
          "BANK_CHANGE_HOLD",
          "Destination ownership review and the 72-hour bank-change hold must finish first",
        );
      return createPayout(tx, a, b.period, beneficiary.data.providerId);
    });
  });
  app.post("/api/v1/payout-runs/:id/execute", async (req) => {
    const a = owner(req);
    requireRecentMfa(a);
    if (a.platformRole !== "finance" && a.platformRole !== "admin")
      throw fail(
        403,
        "FINANCE_REQUIRED",
        "Platform finance authority is required to execute a payout",
      );
    return executePayout(db, a, id.parse((req.params as any).id));
  });

  app.get("/api/v1/finance/export", async (req, reply) => {
    const a = identity(req);
    if (!["owner", "finance"].includes(a.role))
      throw fail(
        403,
        "FINANCE_REQUIRED",
        "Workspace finance access is required",
      );
    const rows = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT j.id,j.source_key,j.created_at,l.account,l.amount_minor FROM journals j JOIN journal_lines l ON l.journal_id=j.id AND l.tenant_id=j.tenant_id ORDER BY j.created_at,l.account",
      ),
    );
    reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", 'attachment; filename="ledger.csv"');
    const cell = (v: any) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    return [
      "journal_id,source_key,created_at,account,amount_minor",
      ...rows.map((r) =>
        [r.id, r.source_key, r.created_at, r.account, r.amount_minor]
          .map(cell)
          .join(","),
      ),
    ].join("\n");
  });

  app.post("/api/v1/privacy/consent", async (req) => {
    const a = identity(req);
    const b = z
      .object({
        type: z.enum(["coaching", "wearable", "voice", "marketing"]),
        granted: z.boolean(),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          a.tenantId,
          a.userId,
          b.type,
          "draft-2026-09",
          b.granted,
        ],
      );
      if (!b.granted)
        await tx.query(
          "UPDATE records SET data=jsonb_set(data,'{allowedUses}','[\"render\"]'::jsonb),updated_at=now() WHERE owner_user_id=$1 AND kind IN ('intake','wearable')",
          [a.userId],
        );
      await event(tx, a, "consent.changed", undefined, b);
      return { ok: true };
    });
  });
  app.get("/api/v1/privacy/export", async (req, reply) => {
    const a = identity(req);
    const data = await db.tenant(a, async (tx) => ({
      profile: { name: a.name, email: a.email },
      records: await tx.query(
        "SELECT kind,status,data,created_at FROM records WHERE owner_user_id=$1",
        [a.userId],
      ),
      workouts: await tx.query(
        "SELECT * FROM workout_events WHERE user_id=$1",
        [a.userId],
      ),
      consents: await tx.query(
        "SELECT document_type,document_version,granted,created_at FROM consent_records WHERE user_id=$1",
        [a.userId],
      ),
      subscriptions: await tx.query(
        "SELECT status,period_end,cancel_at_period_end,price_minor FROM subscriptions WHERE user_id=$1",
        [a.userId],
      ),
    }));
    reply.header(
      "Content-Disposition",
      'attachment; filename="coaching-data.json"',
    );
    return data;
  });
  app.post("/api/v1/privacy/delete-request", async (req) => {
    const a = identity(req);
    return db.tenant(a, (tx) =>
      putRecord(
        tx,
        a,
        "privacy_request",
        { type: "deletion", requestedAt: new Date().toISOString() },
        { status: "pending_review" },
      ),
    );
  });
  app.post("/api/v1/wearables/import", async (req) => {
    const a = identity(req);
    const b = z
      .object({
        source: z.enum(["apple_health", "manual_import"]),
        observations: z
          .array(
            z.object({
              type: z.string().max(100),
              value: z.number().finite(),
              unit: z.string().max(30),
              measuredAt: z.iso.datetime(),
            }),
          )
          .min(1)
          .max(2000),
        consent: z.literal(true),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const hash = createHash("sha256")
        .update(JSON.stringify(b.observations))
        .digest("hex");
      const [prior] = await tx.query(
        "SELECT id FROM records WHERE kind='wearable' AND owner_user_id=$1 AND data->>'hash'=$2",
        [a.userId, hash],
      );
      if (prior) return { duplicate: true };
      const r = await putRecord(
        tx,
        a,
        "wearable",
        {
          source: b.source,
          origin: b.source,
          observations: b.observations,
          hash,
          allowedUses: ["render", "deterministic_feature"],
          count: b.observations.length,
        },
        { status: "imported" },
      );
      await event(tx, a, "wearable.imported", r.id, {
        source: b.source,
        count: b.observations.length,
      });
      return r;
    });
  });
  app.post("/api/v1/settings", async (req) => {
    const a = identity(req);
    const b = z
      .object({
        emailNotifications: z.boolean(),
        workoutReminders: z.boolean(),
        marketing: z.boolean(),
      })
      .parse(req.body);
    return db.tenant(a, (tx) =>
      putRecord(tx, a, "preferences", b, { status: "active" }),
    );
  });
  app.get("/api/v1/admin/overview", async (req) => {
    const a = identity(req);
    if (!["admin", "finance", "support", "safety"].includes(a.platformRole))
      throw fail(403, "ADMIN_REQUIRED", "Platform access is required");
    requireRecentMfa(a);
    const tenants = await db.system((tx) =>
      tx.query(
        "SELECT id,slug,name,published,created_at FROM tenants ORDER BY created_at DESC",
      ),
    );
    const results = [];
    for (const t of tenants) {
      const summary = await db.tenant(
        { ...a, tenantId: t.id, role: "owner" },
        async (tx) => {
          await event(
            tx,
            { ...a, tenantId: t.id },
            "admin.workspace_inspected",
            t.id,
          );
          return {
            ...(["admin", "finance"].includes(a.platformRole)
              ? {
                  finance: await financeSummary(tx),
                  costs: await tx.query(
                    "SELECT task,count(*)::int AS requests,sum(cost_usd) AS cost_usd FROM cost_events GROUP BY task",
                  ),
                }
              : {}),
            exceptions: await tx.query(
              "SELECT id,status,created_at,data->>'category' AS category FROM records WHERE kind='exception' AND status='open'",
            ),
          };
        },
      );
      results.push({ ...t, ...summary });
    }
    return { tenants: results, integrations: integrationStatus() };
  });

  app.post("/api/v1/webhooks/stripe", async (req, reply) => {
    if (!process.env.STRIPE_WEBHOOK_SECRET)
      throw new ProviderUnavailable("stripe");
    let stripeEvent: any;
    try {
      stripeEvent = stripeClient().webhooks.constructEvent(
        req.rawBody ?? "",
        String(req.headers["stripe-signature"] ?? ""),
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      throw fail(
        400,
        "INVALID_SIGNATURE",
        "Webhook signature verification failed",
      );
    }
    const [receipt] = await db.system((tx) =>
      tx.query(
        "INSERT INTO provider_events(provider,external_id,payload) VALUES('stripe',$1,$2) ON CONFLICT DO NOTHING RETURNING external_id",
        [stripeEvent.id, JSON.stringify(stripeEvent)],
      ),
    );
    if (!receipt) {
      const [existing] = await db.system((tx) =>
        tx.query(
          "SELECT status FROM provider_events WHERE provider='stripe' AND external_id=$1",
          [stripeEvent.id],
        ),
      );
      if (existing.status === "processed")
        return { received: true, duplicate: true };
    }
    await processStripeEvent(db, stripeEvent);
    await db.system((tx) =>
      tx.query(
        "UPDATE provider_events SET status='processed' WHERE provider='stripe' AND external_id=$1",
        [stripeEvent.id],
      ),
    );
    return reply.send({ received: true });
  });
  app.addHook("onClose", async () => {
    if (!options.db) await db.close();
  });
  return app;
}
