import { registerFinanceAutomation } from "./finance-automation.ts";
import { clientContextRoutes } from "./client-context.ts";
import { registerAffiliates } from "./affiliates.ts";
import { registerInfrastructureActions } from "./infrastructure-actions.ts";
import {
  marketingConsentVersion,
  notifyCoachingTeam,
  notifyUser,
  recordMarketingChoice,
} from "./notifications.ts";
import { registerLifecycleMessages } from "./lifecycle-messages.ts";
import { registerRetention } from "./retention.ts";
import {
  lockBrainReviewActor,
  notifyCompilationReview,
} from "./source-review-notifications.ts";
import { registerFinanceCompletion } from "./finance-completion.ts";
import { registerSubscriptionCheckout } from "./finance-checkout.ts";
import { registerBookingPayments } from "./finance-bookings.ts";
import { registerTrainingPrograms } from "./training-programs.ts";
import { registerCoachingFollowups } from "./coaching-followups.ts";
import {
  registerCoachingFeedback,
  revokeCoachingFeedbackLearning,
} from "./coaching-feedback.ts";
import {
  registerChatAttachments,
  validateChatAttachments,
  bindChatAttachments,
} from "./chat-attachments.ts";
import {
  registerAccountCompletion,
  recentWorkspaceOrder,
  touchAccountSession,
} from "./account-completion.ts";
import { registerPasskeys } from "./passkeys.ts";
import {
  registerHealthKitSync,
  isCompanionDevicePath,
  readCoachWearablePolicy,
} from "./healthkit-sync.ts";
import { registerCoachSite, saveCoachBrand } from "./coach-site.ts";
import { registerDiscovery } from "./discovery.ts";
import {
  registerIntegrationCompletion,
  disableUserIntegrations,
} from "./integrations-completion.ts";
import {
  resolveProbeHost,
  resolveRequestHost,
  enforceHostTenant,
  allowedRequestOrigin,
  HOST_HEADERS,
  type HostContext,
} from "./host-routing.ts";
import {
  registerPrivacyLifecycle,
  exportPersonalData,
  workspaceLock,
} from "./privacy-lifecycle.ts";
import { privacyHooks } from "./privacy-hooks.ts";
import { legalAcceptanceVersion } from "./legal.ts";
import { registerAdminOperations } from "./admin-operations.ts";
import { screenForSafety } from "./safety-policy.ts";
import { registerMessaging } from "./messaging-admin.ts";
import { registerSupportPreview } from "./support-preview.ts";
import { registerInfrastructureObserver } from "./infrastructure-observer.ts";
import { registerHostOperations, TLS_ASK_PATH } from "./host-operations.ts";
import { registerAcquisition, recordSignupAcquisition } from "./acquisition.ts";
import { registerFinanceBilling } from "./finance-billing.ts";
import { hasMemberAccess } from "./entitlements.ts";
import {
  announceFollowerJoined,
  completeInvitationAcceptance,
  createFollowerInvitation,
  registerJoiningRoutes,
} from "./joining.ts";
import { registerComplimentaryAccess } from "./complimentary-access.ts";
import {
  registerCoachingCompletion,
  lockTraining,
  openTrainingHold,
} from "./coaching-completion.ts";
import {
  runtimeConfig,
  withRuntimeConfig,
  ConfigurationError,
  strictSecurity,
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
import {
  ingestionRoutes,
  compilationMaterial,
  privacyMatches,
  buildSourceEvidence,
} from "./ingestion.ts";
import {
  registerTeamRoutes,
  createTeamInvitation,
  lockActiveInvitation,
} from "./team.ts";
import { operationsRoutes } from "./operations.ts";
import { financeOperations } from "./finance-operations.ts";
import { securityRoutes, consumeMfa, requireRecentMfa } from "./security.ts";
import { openSignInSession, type SignInMethod } from "./sign-in.ts";
import {
  membershipEndedError,
  registerAccountSelfService,
} from "./account-self-service.ts";
import { registerOperatorRecovery } from "./operator-recovery.ts";
import { assertMayRejoin, registerMembershipExit } from "./membership-exit.ts";
import { registerOidcSignIn, isOidcFormCallback } from "./oidc-sign-in.ts";
import { processStripeEvent } from "./stripe-events.ts";
import { registerGovernance } from "./governance.ts";
import { registerBusinessMetrics } from "./business-metrics.ts";
import { registerPlatformAlerts } from "./platform-alerts.ts";
import {
  ACCOUNT_LOCKED_SQLSTATE,
  accountLockedError,
  assertSignInAllowed,
} from "./account-governance.ts";
import {
  enforceWorkspaceGate,
  lockSuspendedMember,
  workspaceSuspendedMessage,
} from "./workspace-state.ts";
import {
  adminRouteRequested,
  enforceOperatorStepUp,
  trackOperatorRoutes,
} from "./operator-step-up.ts";
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
  validUaeIban,
  refundEligible,
} from "@trainer/domain";
import {
  ProviderUnavailable,
  integrationStatus,
  modelDecision,
  MODEL_EVIDENCE_LIMIT,
  compileTrainerRules,
  requireCommerce,
  stripeClient,
  LeanGateway,
} from "@trainer/providers";
import {
  accountAttempts,
  clientSource,
  passwordHash,
  passwordMatches,
  tokenHash,
  newToken,
} from "./auth.ts";
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
  /** "active", or "suspended" while a Super admin suspension is in force. */
  workspaceState?: string;
};
declare module "fastify" {
  interface FastifyRequest {
    identity?: Identity;
    rawBody?: string;
    hostContext?: HostContext;
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
/** Rules may cite trainer teaching material only, never scenarios or client records. */
async function assertTeachingSources(tx: Tx, ids: string[]) {
  for (const ref of ids) {
    const source = await findRecord(tx, ref);
    if (!["source", "interview"].includes(source.kind))
      throw fail(
        400,
        "INVALID_SOURCE",
        "Rules can cite trainer teaching sources only",
      );
  }
}
// A published release must fit in one model request beside the client's
// profile and Client Twin, so no confirmed rule is silently left unseen.
const RELEASE_RULE_LIMIT = MODEL_EVIDENCE_LIMIT - 2;
const HELD_OUT_SCENARIO_LIMIT = 30;
function assertReleaseRuleLimit(count: number) {
  if (count > RELEASE_RULE_LIMIT)
    throw fail(
      409,
      "RULE_LIMIT",
      `A Brain release can include at most ${RELEASE_RULE_LIMIT} confirmed rules; return extra rules to draft before evaluating`,
    );
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
  // Paid or trainer-granted complimentary access (entitlements.ts).
  if (!(await hasMemberAccess(tx, a.userId)))
    throw fail(402, "MEMBERSHIP_REQUIRED", "An active membership is required");
}

export async function buildApp(
  options: {
    db?: Database;
    testing?: boolean;
    /** Nonproduction fixtures only: replaces the Stripe client; commerce approval gates still apply. */
    providers?: { stripe?: () => ReturnType<typeof stripeClient> };
  } = {},
) {
  const stripeProvider = () => options.providers?.stripe?.() ?? stripeClient();
  const commerceProvider = () => {
    const fixture = options.providers?.stripe;
    if (!fixture) return requireCommerce();
    // The approval gate throws its canonical error before any client is built.
    if (runtimeConfig().COMMERCE_APPROVED !== "true") requireCommerce();
    return fixture();
  };
  const db = options.db ?? (await createDatabase());
  const app = Fastify({
    logger: options.testing
      ? false
      : {
          serializers: {
            req: (request: any) => ({
              method: request.method,
              url: String(request.url).split("?")[0],
              hostname: request.hostname,
              remoteAddress: request.ip,
            }),
          },
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers.set-cookie",
          ],
        },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: false,
  });
  // Before any route: records operator routes for the step-up coverage test.
  trackOperatorRoutes(app);
  await app.register(cookie);
  await app.register(rateLimit, {
    max: options.testing ? 10000 : 120,
    timeWindow: "1 minute",
    // Session verification runs in onRequest. A reverse proxy's loopback address
    // must not give every signed-in member one shared request budget.
    hook: "preHandler",
    // Behind the edge, request.ip is the web container. Anonymous budgets use
    // the client address carried inside the verified proxy proof instead, and
    // fall back to the socket address when no signed address is present.
    keyGenerator: (request) =>
      request.identity
        ? `user:${request.identity.userId}`
        : `ip:${clientSource(request)}`,
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
      .header("Cache-Control", "no-store")
      // API responses are never search results; pages are indexed by the web app.
      .header("X-Robots-Tag", "noindex, nofollow");
    const requestPath = req.url.split("?")[0];
    // Readiness is intentionally reachable by the local container probe; it
    // exposes no workspace data and cannot select a tenant.
    // The edge's TLS "ask" check reaches the API directly on the private
    // network, never through a mapped host; it is handled like a probe.
    const probe =
      ["/health", "/api/v1/health", "/api/v1/ready"].includes(requestPath) ||
      requestPath === TLS_ASK_PATH;
    // Probes do not need a verified host, but a supplied session still needs to
    // be verified for the per-user rate budget. Never trust a raw cookie key.
    // Probes relayed by the web proxy carry a proof; verify it so the signed
    // client address, not the web container, keys their budget. Host mapping
    // never decides a probe: the deploy controller probes web at 127.0.0.1:3000.
    if (
      probe &&
      Object.values(HOST_HEADERS).some((name) => req.headers[name] != null)
    )
      req.hostContext = resolveProbeHost(req);
    if (!probe) {
      req.hostContext = await resolveRequestHost(db, req);
      if (req.hostContext.custom) {
        const publicSlug = requestPath.match(
          /^\/api\/v1\/public\/(?:trainers|sites|coach)\/([^/]+)/,
        )?.[1];
        if (
          publicSlug &&
          decodeURIComponent(publicSlug) !== req.hostContext.tenantSlug
        )
          throw fail(
            403,
            "HOST_TENANT_MISMATCH",
            "This page belongs to a different coaching website.",
          );
        if (requestPath.startsWith("/api/v1/webhooks/"))
          throw fail(
            403,
            "PLATFORM_HOST_REQUIRED",
            "Provider callbacks use the platform address.",
          );
      }
      // Companion-app routes authenticate with a device bearer token only and
      // never read the session cookie, so a browser origin does not apply.
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        !req.url.startsWith("/api/v1/webhooks/") &&
        !isOidcFormCallback(requestPath) &&
        !isCompanionDevicePath(req.url)
      ) {
        if (!allowedRequestOrigin(req.hostContext, req.headers.origin))
          throw fail(403, "ORIGIN_REJECTED", "Request origin is not permitted");
      }
    }
    const token = req.cookies.session;
    if (token) {
      const rows = await db.system((tx) =>
        tx.query(
          // A suspended workspace keeps its sessions so members see why it is
          // unavailable; a locked account never resolves a session.
          "SELECT s.user_id,s.tenant_id,u.name,u.email,u.platform_role,u.email_verified,s.mfa_at,m.role,t.lifecycle_state FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id JOIN tenants t ON t.id=s.tenant_id WHERE s.token_hash=$1 AND s.expires_at>now() AND t.lifecycle_state IN ('active','suspended') AND NOT EXISTS(SELECT 1 FROM account_locks l WHERE l.user_id=s.user_id AND l.status='active')",
          [tokenHash(token)],
        ),
      );
      const s = rows[0];
      if (s) {
        req.identity = {
          tenantId: s.tenant_id,
          userId: s.user_id,
          role: s.role,
          name: s.name,
          email: s.email,
          platformRole: s.platform_role,
          emailVerified: s.email_verified,
          mfaAt: s.mfa_at,
          workspaceState: s.lifecycle_state,
        };
        if (!probe)
          try {
            enforceHostTenant(req.hostContext!, req.identity);
          } catch (error) {
            // A stale cookie from a reassigned domain must not prevent sign-out,
            // a new login, or viewing that domain's public website.
            if (
              requestPath.startsWith("/api/v1/auth/") ||
              requestPath.startsWith("/api/v1/public/")
            )
              req.identity = undefined;
            else throw error;
          }
      }
    }
    // A device queue replays only under the member who saved it (web
    // offline-queue.ts). A tab left open after another person signs in must
    // not write into their record; the queue stays on the device instead.
    const queueOwner = req.headers["x-queue-owner"];
    if (queueOwner !== undefined) {
      if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in");
      if (queueOwner !== `${req.identity.tenantId}:${req.identity.userId}`)
        throw fail(
          409,
          "SESSION_OWNER_MISMATCH",
          "These entries were saved by another member. Sign in as that member to sync them.",
        );
    }
    if (!probe) {
      // Routing already ran: decide from the matched route pattern as well as
      // the raw path, so an encoded spelling cannot skip either guard.
      const routePattern = req.routeOptions.url;
      enforceWorkspaceGate(req.identity, req.method, requestPath, {
        routePattern,
        operatorRoute: adminRouteRequested(requestPath, routePattern),
      });
      enforceOperatorStepUp(
        req.identity,
        req.method,
        requestPath,
        routePattern,
      );
    }
    if (token && req.identity && !probe)
      await touchAccountSession(db, tokenHash(token)).catch(() => {});
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ConfigurationError)
      return reply.code(409).send({
        code: "INTEGRATION_CONFIGURATION",
        message: error.message,
        requestId: req.id,
      });
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
        code: (error as { code?: string }).code ?? "PROVIDER_UNAVAILABLE",
        message: error.message,
        provider: error.provider,
        requestId: req.id,
      });
    if ((error as any).code === ACCOUNT_LOCKED_SQLSTATE) {
      const locked = accountLockedError();
      return reply
        .code(423)
        .send({ code: locked.code, message: locked.message, requestId: req.id });
    }
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
          : status < 500 || e.expose === true
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
    method: SignInMethod = "password",
    /** Hash of the session this one replaces; its sign-in time carries over. */
    replaces?: string,
  ) {
    const token = await db.system(async (tx) => {
      await workspaceLock(tx, tenantId);
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      let authenticatedAt: Date | string | null = null;
      if (replaces) {
        const [old] = await tx.query(
          "DELETE FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() RETURNING authenticated_at",
          [replaces, userId],
        );
        if (!old) throw fail(401, "AUTH_REQUIRED", "Please sign in");
        authenticatedAt = old.authenticated_at;
      }
      return openSignInSession(tx, {
        userId,
        tenantId,
        mfa,
        method,
        authenticatedAt,
      });
    });
    reply.setCookie("session", token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: strictSecurity(),
      maxAge: 604800,
    });
  }
  registerCoachingCompletion(app, db);
  registerCoachingFollowups(app, db);
  registerCoachingFeedback(app, db);
  registerLifecycleMessages(app, db);
  registerRetention(app, db);
  registerChatAttachments(app, db);
  registerTrainingPrograms(app, db);
  registerIntegrationCompletion(app, db);
  registerHealthKitSync(app, db);
  registerFinanceBilling(app, db, { stripe: options.providers?.stripe });
  registerFinanceCompletion(app, db);
  registerFinanceAutomation(app, db);
  registerAffiliates(app, db, identity);
  registerInfrastructureActions(app, db, identity);
  registerBookingPayments(app, db);
  registerAdminOperations(app, db, identity);
  registerMessaging(app, db, identity);
  registerSupportPreview(app, db, identity);
  registerInfrastructureObserver(app, db, identity, {
    startCollector: !options.testing,
  });
  registerHostOperations(app, db, identity, {
    startSampler: !options.testing,
  });
  registerAcquisition(app, db);
  securityRoutes(app, db, identity);
  registerAccountCompletion(app, db, identity);
  registerPasskeys(app, db, identity);
  registerAccountSelfService(app, db, identity);
  registerOperatorRecovery(app, db, identity);
  registerOidcSignIn(app, db, identity);
  registerMembershipExit(app, db, identity, {
    stripe: options.providers?.stripe,
  });
  registerCoachSite(app, db);
  registerDiscovery(app, db);
  platformSettingsRoutes(app, db, identity);
  financeOperations(app, db, identity);
  privacyOperations(app, db, identity, privacyHooks);
  registerPrivacyLifecycle(app, db, identity, privacyHooks);
  clientTwinRoutes(app, db, identity);
  clientContextRoutes(app, db, identity);
  nutritionRoutes(app, db, identity, !!options.testing);
  mealCaptureRoutes(app, db, identity);
  operationsRoutes(app, db, identity);
  ingestionRoutes(app, db, trainer);
  registerTeamRoutes(app, db, identity);
  registerJoiningRoutes(app, db, identity, session, {
    publicUrl,
    afterJoin: (req, actor) =>
      recordSignupAcquisition(db, req, actor, "enroll"),
  });
  registerComplimentaryAccess(app, db, identity);
  registerGovernance(app, db, identity);
  registerBusinessMetrics(app, db, identity);
  registerPlatformAlerts(app, db, identity);
  app.get("/health", async () => ({ status: "ok", service: "trainer-api" }));
  app.get("/api/v1/health", async () => ({ status: "ok" }));
  app.get("/api/v1/public/host", async (req) => {
    const { clientIp: _clientIp, ...context } = req.hostContext!;
    return context;
  });
  app.get("/api/v1/ready", async () => {
    await db.system((tx) => tx.query("SELECT 1"));
    return { status: "ready" };
  });
  app.post(
    "/api/v1/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      if (req.hostContext?.custom)
        throw fail(
          403,
          "PLATFORM_HOST_REQUIRED",
          "Trainer registration uses the platform address.",
        );
      const b = signupSchema.parse(req.body);
      const registrationVersion = await legalAcceptanceVersion(
        db,
        "registration",
      );
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
      if (strictSecurity() && runtimeConfig().LEGAL_APPROVED !== "true")
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
          [uid, b.email, b.name, hash, !strictSecurity()],
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
          "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'registration',$4,true)",
          [randomUUID(), tid, uid, registrationVersion],
        );
        await event(tx, a, "trainer.signup_completed", uid);
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
      if (req.hostContext?.custom && b.coachSlug !== req.hostContext.tenantSlug)
        throw fail(
          403,
          "HOST_TENANT_MISMATCH",
          "Join the coach connected to this website.",
        );
      const registrationVersion = await legalAcceptanceVersion(
        db,
        "registration",
      );
      if (strictSecurity() && runtimeConfig().LEGAL_APPROVED !== "true")
        throw fail(
          503,
          "LEGAL_PENDING",
          "Membership signup is waiting for approved terms",
        );
      const hash = await passwordHash(b.password);
      const result = await db.system(async (tx) => {
        const [tenant] = await tx.query(
          "SELECT id FROM tenants WHERE slug=$1 AND published=true AND lifecycle_state='active'",
          [b.coachSlug],
        );
        if (!tenant)
          throw fail(
            404,
            "TRAINER_UNAVAILABLE",
            "This coaching space is not accepting public signups",
          );
        await workspaceLock(tx, tenant.id);
        const [stillOpen] = await tx.query(
          "SELECT id FROM tenants WHERE id=$1 AND published=true AND lifecycle_state='active' FOR UPDATE",
          [tenant.id],
        );
        if (!stillOpen)
          throw fail(
            409,
            "WORKSPACE_CLOSED",
            "This workspace is not accepting signups",
          );
        const [existing] = await tx.query(
          "SELECT * FROM users WHERE email=$1 FOR UPDATE",
          [b.email],
        );
        if (
          req.hostContext?.custom &&
          existing &&
          existing.platform_role !== "none"
        )
          throw fail(
            403,
            "PLATFORM_HOST_REQUIRED",
            "Platform accounts sign in at the platform address.",
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
        // Shared sign-in check once the existing account is fully proven.
        if (existing) await assertSignInAllowed(tx, existing.id);
        if (existing) await assertMayRejoin(tx, tenant.id, existing.id);
        const uid = existing?.id ?? randomUUID();
        if (!existing)
          await tx.query(
            "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
            [uid, b.email, b.name, hash],
          );
        const [membership] = await tx.query(
          "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber') ON CONFLICT DO NOTHING RETURNING user_id",
          [tenant.id, uid],
        );
        await tx.query("SET LOCAL ROLE trainer_app");
        await tx.query(
          "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','subscriber',true)",
          [tenant.id, uid],
        );
        await tx.query(
          "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'registration',$4,true)",
          [randomUUID(), tenant.id, uid, registrationVersion],
        );
        await event(
          tx,
          { tenantId: tenant.id, userId: uid, role: "subscriber" },
          "subscriber.enrolled",
          uid,
        );
        if (membership)
          await announceFollowerJoined(
            tx,
            { tenantId: tenant.id, userId: uid, role: "subscriber" },
            "website",
          );
        return { uid, tid: tenant.id, mfa, joined: !!membership };
      });
      await session(reply, result.uid, result.tid, result.mfa, "public_join");
      if (result.joined) {
        try {
          await recordSignupAcquisition(
            db,
            req,
            { tenantId: result.tid, userId: result.uid, role: "subscriber" },
            "enroll",
          );
        } catch {
          req.log.warn(
            "Enrollment acquisition conversion could not be recorded",
          );
        }
      }
      return reply.code(201).send({ ok: true });
    },
  );
  const loginAttempts = accountAttempts();
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 15, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const b = loginSchema.parse(req.body);
      loginAttempts(reply, b.email, clientSource(req));
      const [u] = await db.system((tx) =>
        tx.query("SELECT * FROM users WHERE email=$1", [b.email]),
      );
      if (!u || !(await passwordMatches(b.password, u.password_hash)))
        throw fail(401, "INVALID_LOGIN", "Email or password is incorrect");
      if (req.hostContext?.custom && u.platform_role !== "none")
        throw fail(
          403,
          "PLATFORM_HOST_REQUIRED",
          "Platform accounts sign in at the platform address.",
        );
      // A chosen workspace must also be the host's workspace on a custom host.
      const [m] = await db.system((tx) =>
        tx.query(
          "SELECT m.tenant_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND t.lifecycle_state IN ('active','suspended') AND ($2::uuid IS NULL OR m.tenant_id=$2) AND ($3::uuid IS NULL OR m.tenant_id=$3) ORDER BY (t.lifecycle_state='active') DESC," +
            recentWorkspaceOrder +
            " LIMIT 1",
          [u.id, req.hostContext?.tenantId ?? null, b.tenantId ?? null],
        ),
      );
      if (!m) {
        // A follower whose membership ended learns why, once the password
        // and any enrolled authenticator have been proven.
        const ended = await db.system(async (tx) => {
          const error = await membershipEndedError(
            tx,
            u.id,
            req.hostContext?.tenantId ?? b.tenantId ?? null,
          );
          if (error) await consumeMfa(tx, u.id, b.code);
          return error;
        });
        throw ended ?? fail(403, "NO_MEMBERSHIP", "No active workspace");
      }
      const mfa = await db.system((tx) => consumeMfa(tx, u.id, b.code));
      await session(reply, u.id, m.tenant_id, mfa, "password");
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
  app.get("/api/v1/auth/workspaces", async (req) => {
    const a = identity(req);
    // A custom host serves only its own workspace; the platform lists them all.
    const workspaces = await db.system((tx) =>
      tx.query(
        "SELECT m.tenant_id,t.name,t.slug,m.role,t.lifecycle_state FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND t.lifecycle_state IN ('active','suspended') AND ($2::uuid IS NULL OR m.tenant_id=$2) ORDER BY t.name,m.tenant_id",
        [a.userId, req.hostContext?.custom ? req.hostContext.tenantId : null],
      ),
    );
    return {
      current: a.tenantId,
      workspaces: workspaces.map((w) => ({
        tenantId: w.tenant_id,
        name: w.name,
        slug: w.slug,
        role: w.role,
        state: w.lifecycle_state,
        current: w.tenant_id === a.tenantId,
      })),
    };
  });
  app.post("/api/v1/auth/workspace", async (req, reply) => {
    const a = identity(req);
    const b = z.object({ tenantId: id }).parse(req.body);
    if (req.hostContext?.custom && b.tenantId !== req.hostContext.tenantId)
      throw fail(
        403,
        "HOST_TENANT_MISMATCH",
        "Switch workspaces from the platform address.",
      );
    const [m] = await db.system((tx) =>
      tx.query(
        "SELECT m.tenant_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.tenant_id=$2 AND t.lifecycle_state IN ('active','suspended')",
        [a.userId, b.tenantId],
      ),
    );
    if (!m) throw fail(403, "NO_MEMBERSHIP", "Workspace access denied");
    // The old session is replaced in the same transaction and its sign-in
    // time carries over: switching is not a fresh sign-in.
    await session(
      reply,
      a.userId,
      b.tenantId,
      false,
      "workspace_switch",
      tokenHash(req.cookies.session ?? ""),
    );
    return { ok: true };
  });
  app.get("/api/v1/bootstrap", async (req) => {
    const a = identity(req);
    const [tenant] = await db.system((tx) =>
      tx.query("SELECT * FROM tenants WHERE id=$1", [a.tenantId]),
    );
    return db.tenant(a, async (tx) => ({
      environment: strictSecurity() ? "production" : "development",
      user: a,
      platform: {
        name: runtimeConfig().APP_NAME || "Trainer Brain",
        supportEmail: runtimeConfig().SUPPORT_EMAIL || null,
      },
      tenant,
      records: await tx.query(
        "SELECT * FROM records WHERE kind NOT IN ('twin_snapshot','retention_policy') AND kind NOT LIKE 'nutrition_%' ORDER BY updated_at DESC LIMIT 1000",
      ),
      sets: await tx.query(
        "SELECT * FROM workout_events ORDER BY created_at DESC LIMIT 1000",
      ),
      subscriptions: await tx.query(
        "SELECT * FROM subscriptions ORDER BY period_end DESC",
      ),
      complimentary: await tx.query(
        "SELECT id,user_id,tier,starts_at,ends_at FROM complimentary_access WHERE closed_at IS NULL AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now()) ORDER BY created_at DESC LIMIT 1000",
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
    const theme = await saveCoachBrand(db, a, b);
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
        "SELECT id,slug,name,theme FROM tenants WHERE slug=$1 AND published=true AND lifecycle_state='active'",
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

  app.post(
    "/api/v1/invitations",
    { config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req);
      const b = z
        .object({
          email: z.email(),
          role: z.enum(["staff", "finance", "subscriber"]),
        })
        .parse(req.body);
      if (b.role !== "subscriber")
        return createTeamInvitation(db, a, b, publicUrl());
      // Follower invitations: optional email delivery, status and cancellation
      // live in joining.ts; the copy-link result is always returned.
      return createFollowerInvitation(
        db,
        a,
        req.body,
        req.hostContext?.origin ?? publicUrl(),
      );
    },
  );
  app.post("/api/v1/invitations/accept", async (req, reply) => {
    const b = z
      .object({
        token: z.string().min(20),
        // An existing account joins with its own password; only a new account needs a name.
        name: z.string().trim().min(2).max(100).optional(),
        email: z.email(),
        password: z.string().min(12).max(128),
        accepted: z.literal(true),
        code: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
      })
      .parse(req.body);
    if (strictSecurity() && runtimeConfig().LEGAL_APPROVED !== "true")
      throw fail(
        503,
        "LEGAL_PENDING",
        "Invitations are waiting for the published legal documents",
      );
    const registrationVersion = await legalAcceptanceVersion(
      db,
      "registration",
    );
    const hash = await passwordHash(b.password);
    const result = await db.system(async (tx) => {
      const invite = await lockActiveInvitation(tx, tokenHash(b.token));
      if (
        !invite ||
        invite.payload.email.toLowerCase() !== b.email.toLowerCase()
      )
        throw fail(400, "INVALID_INVITE", "Invitation is invalid or expired");
      if (
        req.hostContext?.custom &&
        (invite.tenant_id !== req.hostContext.tenantId ||
          invite.payload.role !== "subscriber")
      )
        throw fail(
          403,
          "HOST_TENANT_MISMATCH",
          "This invitation must be accepted at its own coaching or platform address.",
        );
      const [existing] = await tx.query(
        "SELECT * FROM users WHERE email=$1 FOR UPDATE",
        [b.email.toLowerCase()],
      );
      if (
        req.hostContext?.custom &&
        existing &&
        existing.platform_role !== "none"
      )
        throw fail(
          403,
          "PLATFORM_HOST_REQUIRED",
          "Platform accounts sign in at the platform address.",
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
      const mfa = existing ? await consumeMfa(tx, existing.id, b.code) : false;
      if (existing) await assertSignInAllowed(tx, existing.id);
      const uid = existing?.id ?? randomUUID();
      if (!existing && !b.name)
        throw fail(
          400,
          "NAME_REQUIRED",
          "Enter your name to create your account",
        );
      if (!existing)
        await tx.query(
          "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,$3,$4,$5)",
          [uid, b.email.toLowerCase(), b.name, hash, false],
        );
      const joined = await completeInvitationAcceptance(tx, {
        invite,
        userId: uid,
        registrationVersion,
      });
      return {
        uid,
        tid: invite.tenant_id,
        mfa,
        joined: joined && invite.payload.role === "subscriber",
      };
    });
    await session(reply, result.uid, result.tid, result.mfa, "invitation");
    if (result.joined) {
      try {
        await recordSignupAcquisition(
          db,
          req,
          { tenantId: result.tid, userId: result.uid, role: "subscriber" },
          "enroll",
        );
      } catch {
        req.log.warn("Enrollment acquisition conversion could not be recorded");
      }
    }
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
    const text = b.text.replace(/\r\n/g, "\n").trim();
    if (privacyMatches(text).length)
      throw fail(
        400,
        "PERSONAL_DATA_REMAINS",
        "Remove identifying details before adding teaching material, or import a document for redaction and private review.",
      );
    const evidence = buildSourceEvidence(text);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":source:" + evidence.hash,
      ]);
      const [exists] = await tx.query(
        "SELECT * FROM records WHERE kind='source' AND data->>'hash'=$1",
        [evidence.hash],
      );
      if (exists) return exists;
      const r = await putRecord(
        tx,
        a,
        "source",
        {
          title: b.title,
          text,
          ...evidence,
          origin: "trainer_upload",
          allowedUses: ["render", "model_prompt", "trainer_specific_learning"],
          rightsAttestedAt: new Date().toISOString(),
          privacyReviewedAt: new Date().toISOString(),
          reviewedBy: a.userId,
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
    const material = await db.tenant(a, async (tx) => {
      await lockBrainReviewActor(tx, a);
      return tx.query(
        "SELECT * FROM records WHERE id=ANY($1::uuid[]) AND kind IN ('source','interview') ORDER BY id",
        [b.sourceIds],
      );
    });
    if (material.length !== new Set(b.sourceIds).size)
      throw fail(
        400,
        "SOURCE_UNAVAILABLE",
        "All sources must belong to this workspace and be trainer teaching material",
      );
    const prepared = compilationMaterial(material);
    const generated = await compileTrainerRules(
      prepared,
      modelAccounting(db, a, "brain_compilation"),
    );
    return db.tenant(a, async (tx) => {
      await lockBrainReviewActor(tx, a);
      const current = await tx.query(
        "SELECT * FROM records WHERE id=ANY($1::uuid[]) AND kind IN ('source','interview') ORDER BY id FOR UPDATE",
        [b.sourceIds],
      );
      let unchanged = false;
      try {
        unchanged =
          JSON.stringify(compilationMaterial(current)) ===
          JSON.stringify(prepared);
      } catch {
        // Material removed or withdrawn while the provider was working is stale.
      }
      if (!unchanged)
        throw fail(
          409,
          "SOURCE_CHANGED",
          "Your selected material changed during compilation. Review the current sources before trying again.",
        );
      const rules = [],
        conflicts = [],
        batchId = randomUUID();
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
              compilationCoverage: generated.coverage,
            },
            { status: "draft" },
          ),
        );
      for (const conflict of generated.conflicts)
        conflicts.push(
          await putRecord(tx, a, "conflict", conflict, { status: "open" }),
        );
      await event(tx, a, "brain.compiled", batchId, {
        rules: rules.length,
        conflicts: generated.conflicts.length,
        coverage: generated.coverage,
        ruleIds: rules.map((r) => r.id),
        conflictIds: conflicts.map((c) => c.id),
      });
      const reference = (r: any) => ({ id: r.id, version: r.version });
      await notifyCompilationReview(tx, a, {
        id: batchId,
        sources: current.map(reference),
        rules: rules.map(reference),
        conflicts: conflicts.map(reference),
      });
      return {
        rules,
        conflicts: generated.conflicts.length,
        coverage: generated.coverage,
      };
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
      await assertTeachingSources(tx, b.rule.sourceIds);
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
      await assertTeachingSources(tx, b.sourceIds);
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
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":brain",
      ]);
      await findRecord(tx, b.expectedEvidenceId, "rule");
      const [held] = await tx.query(
        "SELECT count(*)::int AS n FROM records WHERE kind='scenario' AND status='held_out'",
      );
      if (held.n >= HELD_OUT_SCENARIO_LIMIT)
        throw fail(
          409,
          "SCENARIO_LIMIT",
          `Evaluation covers at most ${HELD_OUT_SCENARIO_LIMIT} held-out scenarios`,
        );
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
        "SELECT * FROM records WHERE kind='scenario' AND status='held_out' ORDER BY id LIMIT $1",
        [HELD_OUT_SCENARIO_LIMIT + 1],
      ),
    }));
    // Every held-out scenario is evaluated; none is silently dropped.
    if (material.cases.length > HELD_OUT_SCENARIO_LIMIT)
      throw fail(
        409,
        "EVAL_SCOPE",
        `Evaluation covers at most ${HELD_OUT_SCENARIO_LIMIT} held-out scenarios; nothing has been evaluated`,
      );
    assertReleaseRuleLimit(material.rules.length);
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
      assertReleaseRuleLimit(rules.length);
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
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":brain",
      ]);
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
    const coachingVersion = await legalAcceptanceVersion(db, "coaching");
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
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching',$4,true)",
        [randomUUID(), a.tenantId, a.userId, coachingVersion],
      );
      await event(tx, a, "intake.completed", r.id);
      return r;
    });
  });
  app.post("/api/v1/messages", async (req) => {
    const a = identity(req);
    if (a.role !== "subscriber") trainer(req);
    const b = z
      .object({
        text: z.string().trim().max(4000).default(""),
        subscriberId: id.optional(),
        attachmentIds: z.array(id).max(5).default([]),
      })
      .refine(
        (b) => b.text.length > 0 || b.attachmentIds.length > 0,
        "Write a message or attach a file",
      )
      .parse(req.body);
    const target = a.role === "subscriber" ? a.userId : b.subscriberId;
    if (!target) throw fail(400, "SUBSCRIBER_REQUIRED", "Select a subscriber");
    return db.tenant(a, async (tx) => {
      await validateChatAttachments(tx, a, target, b.attachmentIds);
      await lockTraining(tx, a, target);
      const [m] = await tx.query(
        "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
        [a.tenantId, target],
      );
      if (!m) throw fail(404, "NOT_FOUND", "Subscriber unavailable");
      // Code floor plus the published policy's tightening terms.
      const screen =
        a.role === "subscriber" ? await screenForSafety(tx, b.text) : null;
      const safety = !!screen?.hold;
      if (safety)
        await openTrainingHold(tx, a, target, b.text, undefined, screen!);
      const message = await putRecord(
        tx,
        a,
        "message",
        {
          text: b.text,
          author: a.role === "subscriber" ? "subscriber" : "trainer",
          authorUserId: a.userId,
          subscriberId: target,
        },
        { ownerId: target, status: "sent" },
      );
      await bindChatAttachments(tx, a, target, message.id, b.attachmentIds);
      const notice = {
        category: "coaching" as const,
        dedupeKey: `message:${message.id}`,
        title: "You have a new coaching message",
        body: "Open your coaching conversation to read the new message.",
        templateKey: "coaching-message",
      };
      if (a.role === "subscriber") {
        if (!safety)
          await notifyCoachingTeam(tx, a, {
            ...notice,
            href: "/trainer/messages",
          });
      } else
        await notifyUser(tx, a, {
          ...notice,
          userId: target,
          href: "/app/chat",
        });
      return b.attachmentIds.length
        ? (await tx.query("SELECT * FROM records WHERE id=$1", [message.id]))[0]
        : message;
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
      stripe = commerceProvider();
    const product = await db.tenant(a, (tx) =>
      findRecord(tx, (req.params as any).id, "product"),
    );
    // Stripe idempotency keys expire, so a repeated activation must not mint a second product/price.
    if (product.status === "published" && product.data.stripePriceId)
      return { ok: true };
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
  registerSubscriptionCheckout(app, db, requireNutritionReady);
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
    const stripe = stripeProvider();
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
    // Operator authority: a fresh authenticator in every environment.
    requireRecentMfa(a, true);
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
    // While a workspace is suspended a member can only withdraw permission.
    const suspended = a.workspaceState === "suspended";
    if (suspended && b.granted)
      throw fail(423, "WORKSPACE_SUSPENDED", workspaceSuspendedMessage());
    const consentVersion = await legalAcceptanceVersion(db, b.type);
    return db.tenant(a, async (tx) => {
      if (b.type === "voice" || b.type === "wearable") {
        await workspaceLock(tx, a.tenantId);
        if (b.type === "voice")
          await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            a.tenantId + ":training:" + a.userId,
          ]);
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenantId +
            ":" +
            (b.type === "voice" ? "voice" : "integrations") +
            ":" +
            a.userId,
        ]);
      }
      if (b.type === "coaching")
        await (suspended ? lockSuspendedMember(tx, a) : lockTraining(tx, a));
      if (b.type === "coaching")
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenantId + ":training:" + a.userId,
        ]);
      if (!b.granted && (b.type === "voice" || b.type === "wearable"))
        await disableUserIntegrations(tx, a.userId, b.type);
      if (b.type.startsWith("nutrition"))
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenantId + ":nutrition:" + a.userId,
        ]);
      if (b.type === "marketing")
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          a.tenantId + ":notifications:" + a.userId,
        ]);
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), a.tenantId, a.userId, b.type, consentVersion, b.granted],
      );
      // The consent history decides marketing; keep the settings toggle in step.
      if (b.type === "marketing")
        await tx.query(
          "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET data=notification_preferences.data||excluded.data,version=notification_preferences.version+1,updated_at=now()",
          [a.tenantId, a.userId, JSON.stringify({ marketing: b.granted })],
        );
      if (!b.granted && b.type === "coaching") {
        await revokeCoachingFeedbackLearning(tx, a.userId);
        // Remove only model use. Wearable rows are governed by wearable consent
        // and never reach the model-facing coaching object.
        await tx.query(
          "UPDATE records SET data=jsonb_set(data,'{allowedUses}',coalesce(data->'allowedUses','[\"render\"]'::jsonb)-'model_prompt'),updated_at=now() WHERE owner_user_id=$1 AND kind IN ('intake','twin_snapshot')",
          [a.userId],
        );
      }
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
    const data = await exportPersonalData(db, a, privacyHooks);
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
    if (strictSecurity() && runtimeConfig().FILE_IMPORTS_APPROVED !== "true")
      throw fail(
        503,
        "IMPORT_REVIEW_PENDING",
        "Health imports are waiting for the platform import approval.",
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
    // The coach's wearable policy applies to file imports and automatic sync.
    if ((await readCoachWearablePolicy(db, a)) === "none")
      throw fail(
        403,
        "WEARABLE_POLICY",
        "Your coach does not accept health imports.",
      );
    const importConsentVersion =
      (await legalAcceptanceVersion(db, "wearable")) +
      "|integration-consent:v1";
    return db.tenant(a, async (tx) => {
      await workspaceLock(tx, a.tenantId);
      const [current] = await tx.query(
        "SELECT integration_actor_is_current($1,$2) AS active",
        [a.tenantId, a.userId],
      );
      if (!current?.active)
        throw fail(
          403,
          "WORKSPACE_CLOSED",
          "This workspace is no longer active.",
        );
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":integrations:" + a.userId,
      ]);
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,$4,$5,true)",
        [
          randomUUID(),
          a.tenantId,
          a.userId,
          "wearable:" + b.source,
          importConsentVersion,
        ],
      );
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
    const marketingVersion = await marketingConsentVersion(db);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":notifications:" + a.userId,
      ]);
      await recordMarketingChoice(
        tx,
        a,
        b.marketing,
        marketingVersion,
        "legacy_settings",
      );
      // Older clients still use this endpoint. Keep their explicit opt-outs
      // effective without resetting newer quiet-hour or booking preferences.
      const [saved] = await tx.query(
        "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET data=notification_preferences.data||excluded.data,version=notification_preferences.version+1,updated_at=now() RETURNING data,version",
        [
          a.tenantId,
          a.userId,
          JSON.stringify({
            email: b.emailNotifications,
            workouts: b.workoutReminders,
            marketing: b.marketing,
          }),
        ],
      );
      return saved;
    });
  });
  app.get("/api/v1/admin/overview", async (req) => {
    const a = identity(req);
    if (!["admin", "finance", "support", "safety"].includes(a.platformRole))
      throw fail(403, "ADMIN_REQUIRED", "Platform access is required");
    requireRecentMfa(a, true);
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

  // Signed provider deliveries have their own per-source budget, separate from
  // the anonymous public budget, so storefront traffic cannot starve them.
  const webhookRate = {
    config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
  };
  app.post("/api/v1/webhooks/stripe", webhookRate, async (req, reply) => {
    const webhookSecret = runtimeConfig().STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new ProviderUnavailable("stripe");
    let stripeEvent: any, stripe: ReturnType<typeof stripeClient>;
    try {
      stripe = stripeClient();
      stripeEvent = stripe.webhooks.constructEvent(
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
    await processStripeEvent(db, stripeEvent, { stripe });
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
