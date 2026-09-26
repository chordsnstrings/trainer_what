import { registerFinanceBilling, currentPaidSubscription } from "./finance-billing.ts";
import { registerCoachingCompletion, lockTraining } from "./coaching-completion.ts";
import {
  runtimeConfig,
  withRuntimeConfig,
} from "../../../packages/providers/src/configuration.ts";
import {
  loadRuntimeSettings,
  platformSettingsRoutes,
} from "./platform-settings.ts";
import {
  mealCaptureRoutes,
  exportMealCaptures,
  eraseMealCaptures,
} from "./meal-capture.ts";
import { clientTwinRoutes, currentClientTwin } from "./client-twin.ts";
import { nutritionRoutes, requireNutritionReady } from "./nutrition.ts";
import { NutritionBlocked } from "../../../packages/domain/src/nutrition.ts";
import { onboardingRoutes, publishStorefront } from "./onboarding.ts";
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
import rateLimit, { normalizeIP } from "@fastify/rate-limit";
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
  const s = await currentPaidSubscription(tx, a.userId);
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
    // Session verification runs in onRequest. A reverse proxy's loopback address
    // must not give every signed-in member one shared request budget.
    hook: "preHandler",
    keyGenerator: (request) =>
      request.identity
        ? `user:${request.identity.userId}`
        : `ip:${normalizeIP(request.ip)}`,
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
  // Resolve one immutable configuration snapshot for the whole request. Values
  // never enter process.env or another application's concurrent request.
  app.addHook("onRequest", (req, reply, done) => {
    loadRuntimeSettings(db).then(
      (settings) => withRuntimeConfig(settings, done),
      (error) => done(error as Error),
    );
  });
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
    if (error instanceof NutritionBlocked)
      return reply
        .code(409)
        .send({ code: error.code, message: error.message, requestId: req.id });
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
  registerCoachingCompletion(app, db);
  registerFinanceBilling(app, db);
  securityRoutes(app, db, identity);
  platformSettingsRoutes(app, db, identity);
  financeOperations(app, db, identity);
  privacyOperations(app, db, identity);
  clientTwinRoutes(app, db, identity);
  nutritionRoutes(app, db, identity, !!options.testing);
  mealCaptureRoutes(app, db, identity);
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
        runtimeConfig().LEGAL_APPROVED !== "true"
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
        runtimeConfig().LEGAL_APPROVED !== "true"
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
            runtimeConfig().LEGAL_VERSION ?? "draft-2026-09",
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
      platform: {
        name: runtimeConfig().APP_NAME || "Trainer Brain",
        supportEmail: runtimeConfig().SUPPORT_EMAIL || null,
      },
      tenant,
      records: await tx.query(
        "SELECT * FROM records WHERE kind<>'twin_snapshot' AND kind NOT LIKE 'nutrition_%' ORDER BY updated_at DESC LIMIT 1000",
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
    const theme = await db.system(async (tx) => {
      const [current] = await tx.query(
        "SELECT theme FROM tenants WHERE id=$1 FOR UPDATE",
        [a.tenantId],
      );
      const version = Number(current.theme?.brandVersion ?? 0);
      if (b.expectedVersion !== undefined && b.expectedVersion !== version)
        throw fail(
          409,
          "BRAND_VERSION_CONFLICT",
          "Your design changed in another session. Reload before saving.",
        );
      const { expectedVersion, ...submitted } = b;
      const next = {
        ...current.theme,
        ...submitted,
        brandVersion: version + 1,
      };
      await tx.query("UPDATE tenants SET name=$2,theme=$3 WHERE id=$1", [
        a.tenantId,
        b.name,
        JSON.stringify(next),
      ]);
      return next;
    });
    await db.tenant(a, (tx) =>
      event(tx, a, "tenant.brand_updated", a.tenantId),
    );
    return { ok: true, theme, brandVersion: theme.brandVersion };
  });
  onboardingRoutes(app, db, owner);
  app.post("/api/v1/tenant/publish", (req) =>
    publishStorefront(db, owner(req)),
  );
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
      await lockTraining(tx, a);
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
  app.post("/api/v1/products", async (req) => {
    const a = owner(req),
      b = productSchema.parse(req.body);
    return db.tenant(a, async (tx) => {
      if (b.tier === "workout_nutrition") {
        if (!b.baseProductId)
          throw fail(
            400,
            "BASE_OFFER_REQUIRED",
            "Choose the comparable workout-only offer.",
          );
        const base = await findRecord(tx, b.baseProductId, "product");
        if (
          (base.data.tier ?? "workout") !== "workout" ||
          b.priceMinor <= base.data.priceMinor
        )
          throw fail(
            400,
            "NUTRITION_PRICE",
            "Workout + nutrition must cost more than its workout-only offer.",
          );
      }
      const r = await putRecord(
        tx,
        a,
        "product",
        {
          ...b,
          modules:
            b.tier === "workout_nutrition"
              ? ["training", "nutrition"]
              : ["training"],
        },
        { status: "draft" },
      );
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
    if (product.data.tier === "workout_nutrition")
      await db.tenant(a, requireNutritionReady);
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
    if (product.data.tier === "workout_nutrition")
      await db.tenant({ ...a, role: "owner" }, requireNutritionReady);
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
          metadata: {
            tenant_id: a.tenantId,
            user_id: a.userId,
            product_id: product.id,
          },
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
  app.post("/api/v1/membership/change-plan", async (req) => {
    const a = identity(req),
      b = z.object({ productId: id }).strict().parse(req.body);
    if (a.role !== "subscriber")
      throw fail(403, "SUBSCRIBER_REQUIRED", "Subscriber access required");
    if (runtimeConfig().BUNDLE_CHANGES_APPROVED !== "true")
      throw fail(
        503,
        "PLAN_CHANGES_PENDING",
        "Plan changes await activation of the reviewed billing policy.",
      );
    const stripe = stripeClient();
    const context = await db.tenant({ ...a, role: "owner" }, async (tx) => {
      const [subscription] = await tx.query(
        "SELECT * FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing') AND period_end>now()",
        [a.userId],
      );
      if (!subscription?.provider_id)
        throw fail(
          409,
          "SUBSCRIPTION_REQUIRED",
          "No current provider subscription is available.",
        );
      const product = await findRecord(tx, b.productId, "product");
      if (product.status !== "published" || !product.data.stripePriceId)
        throw fail(409, "PRODUCT_UNAVAILABLE", "This offer is not active.");
      if (product.data.tier === "workout_nutrition")
        await requireNutritionReady(tx);
      if (subscription.data.productId === product.id)
        throw fail(409, "SAME_PLAN", "You already have this offer.");
      const current = subscription.data.productId
        ? await findRecord(tx, subscription.data.productId, "product")
        : null;
      if (
        !current ||
        !(
          product.data.baseProductId === current.id ||
          current.data.baseProductId === product.id
        )
      )
        throw fail(
          409,
          "PLAN_PAIR",
          "Choose the paired workout-only or workout + nutrition offer.",
        );
      return { subscription, product, current };
    });
    const remote = await stripe.subscriptions.retrieve(
      context.subscription.provider_id,
    );
    if (remote.items.data.length !== 1)
      throw fail(
        409,
        "BILLING_REVIEW",
        "This subscription needs a billing review before changing plans.",
      );
    const customer =
      typeof remote.customer === "string"
        ? remote.customer
        : remote.customer.id;
    const products = [context.current, context.product].map((p) => ({
      product: p.data.stripeProductId,
      prices: [p.data.stripePriceId],
    }));
    const config = await stripe.billingPortal.configurations.create(
      {
        business_profile: {
          headline: "Review your coaching membership change",
        },
        features: {
          subscription_update: {
            enabled: true,
            default_allowed_updates: ["price"],
            products,
            proration_behavior: "always_invoice",
            schedule_at_period_end: {
              conditions: [{ type: "decreasing_item_amount" }],
            },
          },
        },
      },
      {
        idempotencyKey:
          "membership-portal:" +
          createHash("sha256")
            .update(JSON.stringify({ tenant: a.tenantId, products }))
            .digest("hex"),
      },
    );
    const portal = await stripe.billingPortal.sessions.create({
      customer,
      configuration: config.id,
      return_url: publicUrl() + "/app/membership",
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: remote.id,
          items: [
            {
              id: remote.items.data[0].id,
              price: context.product.data.stripePriceId,
              quantity: 1,
            },
          ],
        },
        after_completion: {
          type: "redirect",
          redirect: { return_url: publicUrl() + "/app/membership" },
        },
      },
    });
    await db.tenant({ ...a, role: "owner" }, (tx) =>
      event(
        tx,
        a,
        "subscription.change_confirmation_opened",
        context.subscription.id,
        { productId: context.product.id },
      ),
    );
    return { url: portal.url };
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
        type: z.enum([
          "coaching",
          "wearable",
          "voice",
          "marketing",
          "nutrition",
          "nutrition_model",
          "nutrition_photo",
        ]),
        granted: z.boolean(),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      if (b.type === "coaching") await lockTraining(tx, a);
      if (b.type.startsWith("nutrition"))
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenantId + ":nutrition:" + a.userId,
        ]);
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
      if (!b.granted && b.type === "coaching")
        await tx.query(
          "UPDATE records SET data=jsonb_set(data,'{allowedUses}','[\"render\"]'::jsonb),updated_at=now() WHERE owner_user_id=$1 AND kind IN ('intake','wearable','twin_snapshot')",
          [a.userId],
        );
      if (!b.granted && b.type.startsWith("nutrition")) {
        await eraseMealCaptures(tx, a.userId);
        if (b.type !== "nutrition_photo")
          await tx.query(
            "UPDATE records SET data=jsonb_set(data,'{allowedUses}','[\"render\"]'::jsonb),status=CASE WHEN kind='nutrition_plan' AND status='delivered' THEN 'permission_revoked' ELSE status END,updated_at=now() WHERE owner_user_id=$1 AND kind IN ('nutrition_profile','nutrition_plan','nutrition_log','nutrition_checkin','nutrition_twin')",
            [a.userId],
          );
      }
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
      mealCaptures: await exportMealCaptures(tx, a.userId),
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
    if (runtimeConfig().APPLE_IMPORTS_ENABLED === "false")
      throw new ProviderUnavailable(
        "apple",
        "Health imports are disabled by the platform administrator",
      );
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
    const webhookSecret = runtimeConfig().STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new ProviderUnavailable("stripe");
    let stripeEvent: any;
    try {
      stripeEvent = stripeClient().webhooks.constructEvent(
        req.rawBody ?? "",
        String(req.headers["stripe-signature"] ?? ""),
        webhookSecret,
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
