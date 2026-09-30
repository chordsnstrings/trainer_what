/**
 * The coach setup wizard (owner decisions, 30 September 2026;
 * docs/features/coach-setup.md): six steps, about 15 minutes, save and
 * continue later, skip for later, prefilled answers, the web address with a
 * live availability check, automatic go-live checks, the "Grow" list after
 * launch, and "Report this coach" from public coach pages for the Super admin.
 *
 * The wizard reads the same state as the older checklist (onboarding.ts), so
 * every safety gate stays in one place: the go-live checks there decide
 * publishing, and the automatic-sending qualification is untouched.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { event, type Actor, type Database } from "@trainer/db";
import {
  COACH_REPORT_REASONS,
  OFFERED_DIRECTORY_SPECIALTIES,
  SETUP_BRAIN_MINIMUM,
  SETUP_STEPS,
  coachReportSchema,
  setupAboutSchema,
  setupPageSchema,
  setupSaveSchema,
  type SetupStepKey,
  type SetupStepStatus,
} from "@trainer/contracts";
import { strictSecurity } from "../../../packages/providers/src/configuration.ts";
import {
  RESERVED_SLUGS,
  SLUG_PROBLEM_MESSAGES,
  slugProblem,
  subdomainHost,
} from "../../../packages/domain/src/web-address.ts";
import { subdomainCandidates } from "../../../packages/domain/src/coach-setup.ts";
import { platformRoot } from "./host-routing.ts";
import { requireRecentMfa } from "./security.ts";
import { clientSource } from "./auth.ts";
import { EARLY_ACCESS_EMIRATES } from "./early-access.ts";
import {
  aboutComplete,
  loadOnboarding,
  publishStorefront,
  saveOnboardingStep,
} from "./onboarding.ts";

type Identity = Actor & {
  email?: string;
  emailVerified: boolean;
  mfaAt?: string | null;
  platformRole?: string;
};
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const WIZARD_RECORDS = ["about", "page", "brain", "plan", "subdomain"] as const;
const offered = new Map(
  OFFERED_DIRECTORY_SPECIALTIES.map((s) => [s.id as string, s.label]),
);

type Availability = {
  name: string;
  host: string | null;
  available: boolean;
  current: boolean;
  reason: "format" | "hyphen" | "reserved" | "taken" | null;
  message: string | null;
};
/** Live availability of a subdomain name for this workspace. */
export async function subdomainAvailability(
  db: Database,
  tenantId: string,
  raw: string,
): Promise<Availability> {
  const name = raw.trim().toLowerCase();
  const root = platformRoot();
  const host = root ? subdomainHost(name, root) : null;
  const problem = slugProblem(name);
  if (problem)
    return {
      name,
      host: null,
      available: false,
      current: false,
      reason: problem,
      message: SLUG_PROBLEM_MESSAGES[problem],
    };
  // Unbound service read: another workspace's slug or redirect must be seen.
  const [row] = await db.system((tx) =>
    tx.query(
      "SELECT (SELECT id FROM tenants WHERE slug=$1) AS owner,(SELECT tenant_id FROM tenant_slug_redirects WHERE slug=$1 AND redirect_until>now()) AS held",
      [name],
    ),
  );
  const current = row?.owner === tenantId;
  const taken =
    (row?.owner && row.owner !== tenantId) ||
    (row?.held && row.held !== tenantId);
  return {
    name,
    host,
    available: !taken,
    current,
    reason: taken ? "taken" : null,
    message: taken ? "This address is taken. Please choose another." : null,
  };
}
async function suggestions(
  db: Database,
  tenantId: string,
  basis: string,
  limit = 3,
) {
  const out: string[] = [];
  for (const name of subdomainCandidates(
    basis,
    String(Math.floor(Math.random() * 90) + 10),
  )) {
    if (out.length >= limit) break;
    const r = await subdomainAvailability(db, tenantId, name);
    if (r.available && !r.current) out.push(name);
  }
  return out;
}

/** The wizard's view of the setup state: six steps with per-step status. */
export async function setupWizard(db: Database, a: Identity) {
  const state = await loadOnboarding(db, a as any);
  const extra = await db.system(
    async (tx) => {
      const [tenant] = await tx.query(
        "SELECT slug,name,published,lifecycle_state FROM tenants WHERE id=$1",
        [a.tenantId],
      );
      const [user] = await tx.query(
        "SELECT name,email,email_verified,password_hash LIKE 'scrypt:%' AS has_password FROM users WHERE id=$1",
        [a.userId],
      );
      const [security] = await tx.query(
        "SELECT enabled FROM user_security WHERE user_id=$1",
        [a.userId],
      );
      // Prefill from the person's own early-access request, once the
      // address is proven to be theirs.
      const [early] = user?.email_verified
        ? await tx.query(
            "SELECT name,specialty,emirate,instagram FROM early_access_requests WHERE email_key=lower($1)",
            [user.email],
          )
        : [];
      return { tenant, user, security, early };
    },
    { tenantId: a.tenantId },
  );
  const records = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT data,status,version FROM records WHERE kind='onboarding_step' AND data->>'step'=ANY($1::text[])",
      [[...WIZARD_RECORDS]],
    ),
  );
  const saved = Object.fromEntries(records.map((r) => [r.data.step, r]));
  const check = Object.fromEntries(
    state.goLive.checks.map((c: any) => [c.key, c]),
  );
  const previewStep = state.steps.find((s: any) => s.key === "preview");
  const products = state.preview.products as any[];
  const pricedPlan = products.some(
    (p) => p.status !== "archived" && Number(p.priceMinor) > 0,
  );
  const tenant = extra.tenant,
    root = platformRoot();
  const about = saved.about?.data.values ?? {};
  const earlySpecialty =
    extra.early?.specialty && offered.has(extra.early.specialty)
      ? extra.early.specialty
      : undefined;
  const prefill = {
    name: about.name ?? tenant.name ?? extra.user?.name ?? "",
    specialty: about.specialty ?? earlySpecialty ?? "",
    audience: about.audience ?? "",
    emirate: about.emirate ?? extra.early?.emirate ?? "",
    instagram: about.instagram ?? extra.early?.instagram ?? "",
    programmeUrl: about.programmeUrl ?? "",
    programmeSourceId: about.programmeSourceId ?? null,
  };
  const teaching = state.teaching;
  const cases = state.goLive.brainCases;
  const subdomainConfirmed = check.subdomain?.ok === true;
  const done: Record<SetupStepKey, boolean> = {
    account: a.emailVerified,
    about: aboutComplete(about),
    page: check.page_ready?.ok === true && subdomainConfirmed,
    brain: check.brain_minimum?.ok === true,
    plan: pricedPlan,
    live: tenant.published === true,
  };
  const started: Record<SetupStepKey, boolean> = {
    account: true,
    about: !!saved.about,
    page:
      !!saved.page ||
      !!saved.subdomain ||
      (previewStep?.version ?? 0) > 0 ||
      !!state.preview.theme?.headline,
    brain:
      teaching.confirmedRules > 0 || cases.total > 0 || !!saved.brain,
    plan: products.length > 0 || !!saved.plan,
    live: false,
  };
  const coachChecksPass = state.goLive.checks
    .filter((c: any) => c.owner === "coach")
    .every((c: any) => c.ok);
  const status = (key: SetupStepKey): SetupStepStatus => {
    if (done[key]) return "done";
    if (key === "live")
      return coachChecksPass && state.gates.length ? "waiting" : "not_started";
    if (saved[key]?.status === "deferred") return "skipped";
    return started[key] ? "in_progress" : "not_started";
  };
  const steps = SETUP_STEPS.map((s) => ({
    ...s,
    status: status(s.key),
    version: saved[s.key]?.version ?? 0,
  }));
  const remaining = steps.filter((s) => s.status !== "done");
  const resumeStep =
    steps.find((s) => s.status === "in_progress" || s.status === "not_started")
      ?.key ??
    steps.find((s) => s.status === "skipped")?.key ??
    "live";
  const payout = state.steps.find((s: any) => s.key === "payout");
  const voice = state.steps.find((s: any) => s.key === "voice");
  const mfaAt = Date.parse(a.mfaAt ?? "");
  return {
    steps,
    progress: {
      done: steps.length - remaining.length,
      total: steps.length,
      percent: Math.round(((steps.length - remaining.length) / steps.length) * 100),
      minutesLeft: remaining.reduce((n, s) => n + s.minutes, 0),
    },
    resumeStep,
    published: tenant.published === true,
    about: {
      values: prefill,
      version: saved.about?.version ?? 0,
      specialties: OFFERED_DIRECTORY_SPECIALTIES,
      emirates: EARLY_ACCESS_EMIRATES,
      fromEarlyAccess: !!extra.early,
    },
    page: {
      brandReady: !!(
        state.preview.theme?.headline &&
        state.preview.theme?.bio &&
        state.preview.theme?.category
      ),
      approved: previewStep?.status === "complete",
      approvalVersion: previewStep?.version ?? 0,
      digest: state.previewDigest,
      issues: state.goLive.pageIssues,
      subdomain: {
        name: tenant.slug,
        host: root ? subdomainHost(tenant.slug, root) : null,
        confirmed: subdomainConfirmed,
        version: saved.subdomain?.version ?? 0,
        // The page answers at this address once it goes live.
        live: tenant.published === true && !!root,
      },
    },
    brain: {
      minimum: SETUP_BRAIN_MINIMUM,
      quizAnswered: cases.quiz,
      ownCases: cases.own,
      enoughCases: cases.enough,
      quizCompleted: cases.quizCompleted === true,
      confirmedRules: teaching.confirmedRules,
      checked: teaching.brainCurrent,
      mode: "waits_for_me",
    },
    plan: {
      priced: pricedPlan,
      plans: products.map((p) => ({
        id: p.id,
        status: p.status,
        name: p.name,
        priceMinor: p.priceMinor,
        billing: p.billing ?? "monthly",
      })),
    },
    goLive: {
      checks: state.goLive.checks,
      ready: state.readyToPublish,
      // Everything that depends on trainsyou shows as one line.
      waitingOnTrainsyou: state.goLive.checks
        .filter((c: any) => c.owner === "trainsyou" && !c.ok)
        .map((c: any) => c.label),
      mode: "waits_for_me",
    },
    security: {
      authenticatorRequired: strictSecurity(),
      authenticatorEnrolled: extra.security?.enabled === true,
      hasPassword: extra.user?.has_password === true,
      verifiedRecently:
        Number.isFinite(mfaAt) && Date.now() - mfaAt < 10 * 60 * 1000,
    },
    grow: [
      {
        key: "voice",
        label: "Voice clone",
        done: voice?.status === "complete",
        href: "/trainer/voice",
      },
      {
        key: "nutrition",
        label: "Nutrition",
        done: !!teaching.nutrition?.ready,
        href: "/trainer/nutrition",
      },
      {
        key: "custom_domain",
        label: "Your own domain",
        done: false,
        href: "/trainer/domains",
      },
      {
        key: "bank",
        label: "Bank details",
        done: payout?.status === "complete",
        note: "Asked at your first payout, not before launch.",
        href: "/trainer/finance",
      },
      {
        key: "qualification",
        label: "Qualification badge (for example REPs UAE)",
        done: false,
        optional: true,
        href: "/trainer/profile",
      },
    ],
  };
}

export function registerCoachSetup(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
) {
  const owner = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.role !== "owner")
      throw fail(403, "OWNER_REQUIRED", "Only the coach who owns this page can do this");
    return a;
  };
  const admin = (req: FastifyRequest) => {
    const a = identity(req);
    if (a.platformRole !== "admin")
      throw fail(403, "ROLE_REQUIRED", "Superadmin access is required.");
    requireRecentMfa(a, true);
    return a;
  };

  app.get("/api/v1/setup", (req) => setupWizard(db, owner(req)));

  app.put("/api/v1/setup/:step", async (req) => {
    const a = owner(req);
    const step = z
      .enum(["about", "page", "brain", "plan"])
      .parse((req.params as any).step);
    const b = setupSaveSchema.parse(req.body);
    if (step === "about") {
      const values = setupAboutSchema.parse(b.values);
      if (values.specialty && !offered.has(values.specialty))
        throw fail(400, "SPECIALTY_UNAVAILABLE", "Choose one of the offered specialties.");
      if (
        values.emirate &&
        !(EARLY_ACCESS_EMIRATES as readonly string[]).includes(values.emirate)
      )
        throw fail(400, "EMIRATE_UNKNOWN", "Choose an emirate from the list.");
      const result = await saveOnboardingStep(db, a as any, "about", {
        version: b.version,
        values,
        status: b.skip ? "deferred" : "saved",
      });
      // The page shows this name; once live it changes in My page instead.
      if (values.name && values.name.trim().length >= 2)
        await db.system(
          (tx) =>
            tx.query(
              "UPDATE tenants SET name=$2 WHERE id=$1 AND published=false",
              [a.tenantId, values.name!.trim()],
            ),
          { tenantId: a.tenantId },
        );
      return result;
    }
    if (step === "page" && !b.skip) {
      // Approving the page as the public will see it (the preview digest).
      const values = setupPageSchema.parse(b.values);
      return saveOnboardingStep(db, a as any, "preview", {
        version: b.version,
        values,
        status: "saved",
      });
    }
    // Teaching and plans are saved through My Brain and the plan screens;
    // here the coach only skips a step for later or takes it back up.
    return saveOnboardingStep(db, a as any, step, {
      version: b.version,
      values: {},
      status: b.skip ? "deferred" : "saved",
    });
  });

  app.get(
    "/api/v1/setup/subdomain/check",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req) => {
      const a = owner(req);
      const q = z
        .object({ name: z.string().max(80) })
        .parse(req.query);
      const result = await subdomainAvailability(db, a.tenantId, q.name);
      return {
        ...result,
        suggestions:
          result.available ? [] : await suggestions(db, a.tenantId, q.name || "coach"),
      };
    },
  );

  // Reserves the chosen address now. Before launch this needs no
  // authenticator and leaves no redirect (nothing was public yet); once live,
  // renames go through the web-address screen, which keeps the old address
  // redirecting.
  app.put(
    "/api/v1/setup/subdomain",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req);
      const b = z
        .object({
          name: z.string().trim().toLowerCase().pipe(z.string().max(40)),
          currentSlug: z.string().max(80),
          version: z.number().int().min(0),
        })
        .strict()
        .parse(req.body);
      const check = await subdomainAvailability(db, a.tenantId, b.name);
      if (!check.available)
        throw fail(
          check.reason === "taken" ? 409 : 400,
          check.reason === "taken"
            ? "SLUG_TAKEN"
            : check.reason === "reserved"
              ? "RESERVED_SLUG"
              : "INVALID_SLUG",
          check.message ?? "Choose another address.",
        );
      const changed = await db.system(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "slug:" + b.name,
        ]);
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "slug-tenant:" + a.tenantId,
        ]);
        const [tenant] = await tx.query(
          "SELECT slug,published FROM tenants WHERE id=$1 FOR UPDATE",
          [a.tenantId],
        );
        if (!tenant || tenant.slug !== b.currentSlug)
          throw fail(
            409,
            "SLUG_CHANGED",
            "Your address changed. Reload before continuing.",
          );
        if (tenant.slug === b.name) return null;
        if (tenant.published)
          throw fail(
            409,
            "USE_WEB_ADDRESS",
            "Your page is live. Change its address in My page, Web address; the old address keeps redirecting there.",
          );
        const [held] = await tx.query(
          "SELECT 1 FROM tenants WHERE slug=$1 UNION ALL SELECT 1 FROM tenant_slug_redirects WHERE slug=$1 AND redirect_until>now() AND tenant_id<>$2",
          [b.name, a.tenantId],
        );
        if (held)
          throw fail(409, "SLUG_TAKEN", "This address is taken. Please choose another.");
        await tx.query("UPDATE tenants SET slug=$1 WHERE id=$2", [
          b.name,
          a.tenantId,
        ]);
        // Taking back an own earlier name ends its redirect.
        await tx.query(
          "UPDATE tenant_slug_redirects SET redirect_until=now() WHERE slug=$1 AND tenant_id=$2 AND redirect_until>now()",
          [b.name, a.tenantId],
        );
        await tx.tenant({ ...a, role: "owner" }, (tx) =>
          event(tx, a, "setup.subdomain_reserved", a.tenantId, {
            from: tenant.slug,
            to: b.name,
          }),
        );
        return { from: tenant.slug, to: b.name };
      });
      const saved = await saveOnboardingStep(db, a as any, "subdomain", {
        version: b.version,
        values: { slug: b.name },
        status: "saved",
      });
      return {
        ok: true,
        name: b.name,
        host: check.host,
        changed,
        version: saved.version,
      };
    },
  );

  // Go live: the automatic checks decide (onboarding.ts); the authenticator
  // is asked on this screen when required.
  app.post("/api/v1/setup/go-live", async (req) => {
    const a = owner(req);
    const result = await publishStorefront(db, a as any);
    const root = platformRoot();
    const [tenant] = await db.system(
      (tx) => tx.query("SELECT slug FROM tenants WHERE id=$1", [a.tenantId]),
      { tenantId: a.tenantId },
    );
    return {
      ...result,
      mode: "waits_for_me",
      url: root ? "https://" + subdomainHost(tenant.slug, root) : null,
    };
  });

  // "Report this coach" on a public coach page, stored for the Super admin.
  app.post(
    "/api/v1/public/coaches/:slug/report",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const slug = z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
        .parse((req.params as any).slug);
      const b = coachReportSchema.parse(req.body);
      const source = createHash("sha256")
        .update(
          `coach-report:${new Date().toISOString().slice(0, 10)}:${clientSource(req as any)}`,
        )
        .digest("hex");
      const stored = await db.system(async (tx) => {
        const [tenant] = await tx.query(
          "SELECT id FROM tenants WHERE slug=$1 AND published=true AND lifecycle_state IN ('active','suspended')",
          [slug],
        );
        if (!tenant) return null;
        if (req.hostContext?.tenantId && req.hostContext.tenantId !== tenant.id)
          return null;
        // One source files at most three reports about a coach a day.
        const [repeat] = await tx.query(
          "SELECT count(*)::int AS n FROM coach_reports WHERE tenant_id=$1 AND source_hash=$2 AND created_at>now()-interval '1 day'",
          [tenant.id, source],
        );
        if (repeat.n >= 3) return "limited";
        await tx.query(
          "INSERT INTO coach_reports(id,tenant_id,reason,details,reporter_email,reporter_user_id,source_hash) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            tenant.id,
            b.reason,
            b.details,
            b.email,
            (req as any).identity?.userId ?? null,
            source,
          ],
        );
        return "stored";
      });
      if (!stored) throw fail(404, "NOT_FOUND", "This coach page is not available.");
      reply.header("Cache-Control", "no-store");
      return {
        received: true,
        message: "Thank you. trainsyou will review this report.",
      };
    },
  );

  app.get("/api/v1/admin/coach-reports", async (req) => {
    admin(req);
    const q = z
      .object({
        status: z.enum(["open", "dismissed", "actioned", "all"]).default("open"),
      })
      .parse(req.query);
    const rows = await db.system((tx) =>
      tx.query(
        "SELECT r.id,r.tenant_id,t.slug,t.name AS coach_name,t.lifecycle_state,r.reason,r.details,r.reporter_email,r.status,r.review_note,r.reviewed_at,r.created_at FROM coach_reports r JOIN tenants t ON t.id=r.tenant_id WHERE ($1='all' OR r.status=$1) ORDER BY r.created_at DESC,r.id DESC LIMIT 200",
        [q.status],
      ),
    );
    return {
      reasons: COACH_REPORT_REASONS,
      reports: rows.map((r) => ({
        ...r,
        // Suspension stays with the existing governance action.
        suspendPath: `/api/v1/admin/governance/workspaces/${r.tenant_id}/suspend`,
      })),
    };
  });

  app.post("/api/v1/admin/coach-reports/:id/review", async (req) => {
    const a = admin(req);
    const id = z.string().uuid().parse((req.params as any).id);
    const b = z
      .object({
        status: z.enum(["dismissed", "actioned"]),
        note: z.string().trim().max(2000).default(""),
      })
      .strict()
      .parse(req.body);
    const row = await db.system(async (tx) => {
      const [row] = await tx.query(
        "UPDATE coach_reports SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1 RETURNING id,tenant_id,status",
        [id, b.status, b.note, a.userId],
      );
      if (!row) throw fail(404, "NOT_FOUND", "That report no longer exists.");
      await tx.query(
        "INSERT INTO admin_operations_audit(id,actor_id,action,tenant_id,subject_id,data) VALUES($1,$2,'coach_report.reviewed',$3,$4,$5)",
        [randomUUID(), a.userId, row.tenant_id, id, JSON.stringify({ status: b.status })],
      );
      return row;
    });
    return row;
  });
}
