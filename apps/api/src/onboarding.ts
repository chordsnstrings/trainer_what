import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { integrationStatus } from "@trainer/providers";
import { nutritionReadiness } from "./nutrition.ts";
import { requireRecentMfa } from "./security.ts";
import { nutritionLearning } from "../../../packages/domain/src/nutrition-learning.ts";
import { canonicalCoaching } from "../../../packages/domain/src/coaching-completion.ts";
import { coachingModelPin } from "../../../packages/providers/src/coaching.ts";
import { coachingRuntimeReadiness } from "./coaching-runtime.ts";
import { recordPublishAcquisition } from "./acquisition.ts";

const digest = (value: unknown) =>
  createHash("sha256")
    .update(canonicalCoaching(value ?? null))
    .digest("hex");
const evaluationDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const legalKeys = ["terms", "privacy", "ai-disclosure"] as const;
async function legalSnapshot(tx: Tx) {
  // Read the global publication registry before adopting the tenant's restricted role.
  const rows = await tx.query(
    "SELECT DISTINCT ON (key) id,key,version,title,effective_at FROM admin_documents WHERE kind='legal' AND key=ANY($1::text[]) AND status='published' AND effective_at<=now() ORDER BY key,effective_at DESC,version DESC",
    [[...legalKeys]],
  );
  return {
    approved: runtimeConfig().LEGAL_APPROVED === "true",
    documents: legalKeys.map(
      (key) =>
        rows.find((r) => r.key === key) ?? {
          key,
          version: null,
          title: key.replaceAll("-", " "),
        },
    ),
  };
}
type LegalSnapshot = Awaited<ReturnType<typeof legalSnapshot>>;
const destinations: Record<string, Array<{ label: string; href: string }>> = {
  brand: [
    { label: "App design", href: "/trainer/design" },
    { label: "Photos and galleries", href: "/trainer/galleries" },
    { label: "Website editor", href: "/trainer/website" },
  ],
  interview: [
    {
      label: "Answer adaptive coaching cases",
      href: "/trainer/brain/teaching",
    },
  ],
  knowledge: [
    {
      label: "Confirm routine actions and limits",
      href: "/trainer/brain/actions",
    },
  ],
  scenarios: [
    { label: "Independent action checks", href: "/trainer/brain/checks" },
  ],
  readiness: [
    { label: "Qualify automatic coaching", href: "/trainer/brain/autonomy" },
  ],
  "nutrition-cases": [
    {
      label: "Adaptive nutrition questions",
      href: "/trainer/nutrition/learning",
    },
  ],
  "nutrition-policy": [
    { label: "Calorie methods", href: "/trainer/nutrition/methods" },
    {
      label: "Client targets and plan adjustments",
      href: "/trainer/nutrition/clients",
    },
  ],
  "nutrition-recipes": [
    {
      label: "Shopping quantities and leftovers",
      href: "/trainer/nutrition/purchases",
    },
  ],
  "nutrition-readiness": [
    { label: "Nutrition qualification", href: "/trainer/nutrition/readiness" },
    { label: "Delivery exceptions", href: "/trainer/nutrition/exceptions" },
  ],
  wearables: [
    { label: "Connected integrations", href: "/trainer/integrations" },
  ],
  voice: [{ label: "Set up trainer voice", href: "/trainer/voice" }],
  domain: [{ label: "Manage custom domains", href: "/trainer/domains" }],
};

type Owner = Actor & { emailVerified: boolean; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const identityFields = z
  .object({
    businessName: z.string().min(2).max(100),
    publicName: z.string().min(2).max(100),
    city: z.string().min(2).max(100),
    country: z.literal("AE"),
    category: z.string().min(2).max(100),
    audience: z.string().min(3).max(500),
  })
  .strict();
const identityDraft = identityFields.partial().extend({
  businessName: z.string().max(100).optional(),
  publicName: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  audience: z.string().max(500).optional(),
});
const baseRegistry = [
  [
    "account",
    "Account",
    "Verify your email. Your workspace address is reserved.",
    true,
  ],
  [
    "identity",
    "Business identity",
    "Describe your coaching business. Licence collection is deferred and does not block setup.",
    true,
  ],
  [
    "brand",
    "Brand studio",
    "Save your public name, headline, biography and brand color.",
    true,
  ],
  [
    "brain-intro",
    "Meet your Brain",
    "Teach your decisions and their limits. Qualified routine actions can run automatically; exceptions need your input.",
    true,
  ],
  [
    "interview",
    "Coaching interview",
    "Explain recommendations, reasons, alternatives and the conditions that would change your answer.",
    false,
  ],
  [
    "uploads",
    "Source material",
    "Import supported documents you have permission to use. Review extracted text.",
    false,
  ],
  [
    "knowledge",
    "Knowledge review",
    "Confirm your rules and resolve source conflicts.",
    true,
  ],
  [
    "scenarios",
    "Scenario lab",
    "Add at least 20 held-out scenarios and check how your Brain responds.",
    true,
  ],
  [
    "readiness",
    "Brain readiness",
    "Publish current evaluated guidance, then qualify the routine actions you want to automate.",
    true,
  ],
  [
    "offer",
    "Your offer",
    "Create and activate a subscription offer using the configured Stripe account.",
    true,
  ],
  [
    "payout",
    "Your payout account",
    "Add a UAE IBAN and complete ownership review. Holds remain visible.",
    true,
  ],
  [
    "wearables",
    "Wearable policy",
    "Choose whether to use permitted imports. Partner connections need separate approval.",
    false,
  ],
  [
    "voice",
    "Optional voice",
    "Set up optional trainer voice with identity verification, separate consent and an approved provider.",
    false,
  ],
  [
    "domain",
    "Your address",
    "Your workspace slug is reserved. A custom domain is optional and requires a configured provider.",
    true,
  ],
  [
    "preview",
    "Subscriber preview",
    "Review your saved app design, website, galleries, offer and coaching disclosure before launch.",
    true,
  ],
  [
    "publish",
    "Publish",
    "Launch after the server verifies product, coaching, legal and financial readiness.",
    true,
  ],
] as const;
async function context(tx: Tx, a: Actor) {
  await tx.query("SET LOCAL ROLE trainer_app");
  await tx.query(
    "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','owner',true)",
    [a.tenantId, a.userId],
  );
}
export async function onboardingState(
  tx: Tx,
  a: Owner,
  tenant: any,
  legal: LegalSnapshot,
) {
  const records = await tx.query(
    "SELECT * FROM records WHERE kind IN ('onboarding_step','interview','source','rule','conflict','scenario','brain_release','evaluation','product','beneficiary','coaching_teaching','coaching_action','coaching_scenario','coaching_evaluation','coaching_runtime_release','program','nutrition_scenario','nutrition_evaluation','nutrition_preview','nutrition_method') ORDER BY updated_at DESC,id DESC",
  );
  const of = (kind: string) => records.filter((r) => r.kind === kind);
  const saved = Object.fromEntries(
    of("onboarding_step").map((r) => [r.data.step, r]),
  );
  const providers = integrationStatus(),
    commerce = providers.find((p) => p.id === "stripe")!,
    bank = providers.find((p) => p.id === "lean")!,
    voiceProvider = providers.find((p) => p.id === "voice")!,
    modelProvider = providers.find((p) => p.id === "model")!;
  const modelReady = modelProvider.configured && modelProvider.approved;
  const products = of("product"),
    release = of("brain_release").find((r) => r.status === "published");
  const confirmedRules = of("rule")
    .filter((r) => r.status === "confirmed")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, data: r.data, version: r.version }));
  const brainEvaluation = of("evaluation").find(
    (r) => r.id === release?.data.evaluationId,
  );
  const baseScenarios = of("scenario")
    .filter((r) => r.status === "held_out")
    .sort((a, b) => a.id.localeCompare(b.id));
  const evaluatedIds = (brainEvaluation?.data.outcomes ?? [])
    .map((r: any) => r.scenarioId)
    .sort();
  const brainCurrent =
    !!release &&
    confirmedRules.length > 0 &&
    digest(release.data.rules) === digest(confirmedRules) &&
    brainEvaluation?.status === "passed" &&
    brainEvaluation.data.rulesDigest === evaluationDigest(confirmedRules) &&
    baseScenarios.length >= 20 &&
    digest(evaluatedIds) ===
      digest(
        baseScenarios
          .slice(0, 30)
          .map((r) => r.id)
          .sort(),
      ) &&
    !of("conflict").some((r) => r.status !== "resolved");
  let runtime: Awaited<ReturnType<typeof coachingRuntimeReadiness>> & {
    blocker?: string;
  };
  try {
    runtime = await coachingRuntimeReadiness(tx);
  } catch (error) {
    if ((error as any).statusCode !== 409) throw error;
    runtime = {
      contractDigest: "",
      brainId: release?.id ?? null,
      releaseId:
        of("coaching_runtime_release").find((r) => r.status === "published")
          ?.id ?? null,
      current: false,
      mode: null,
      automatic: false,
      blocker: (error as Error).message,
    };
  }
  const runtimeCurrent =
    !runtime.blocker && (!runtime.releaseId || runtime.current);
  const nutrition = await nutritionReadiness(tx);
  const combinedPublished = products.some(
    (p) => p.status === "published" && p.data.tier === "workout_nutrition",
  );
  const nutritionVisible = nutrition.enabled || combinedPublished;
  const nutritionScenarios = of("nutrition_scenario")
    .filter((r) => r.status === "held_out")
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 40);
  const learning = nutritionLearning(
    nutrition.material.cases as any,
    nutritionScenarios as any,
  );
  const scenarioDigest = evaluationDigest(
    nutritionScenarios.map((r) => ({
      id: r.id,
      data: r.data,
      version: r.version,
    })),
  );
  const nutritionEvaluation = of("nutrition_evaluation").find(
    (r) =>
      r.status === "passed" &&
      r.data.qualificationVersion === 2 &&
      r.data.digest === nutrition.material.digest &&
      r.data.scenarioDigest === scenarioDigest,
  );
  const nutritionPreview = of("nutrition_preview").find(
    (r) => r.status === "ready" && r.data.digest === nutrition.material.digest,
  );
  const nutritionSteps = [
    [
      "nutrition-cases",
      "Teach nutrition",
      "Give recommendations, reasons, alternatives, client conditions and referral limits; follow up on unanswered or contradictory cases.",
      combinedPublished,
    ],
    [
      "nutrition-recipes",
      "Recipes and ingredients",
      "Add current ingredient facts, recipe portions, cooking options and shopping conversions.",
      combinedPublished,
    ],
    [
      "nutrition-policy",
      "Confirm nutrition rules",
      "Confirm diets, approximate calories and permitted automatic changes. Add your calorie methods; assign individual targets when clients join.",
      combinedPublished,
    ],
    [
      "nutrition-scenarios",
      "Nutrition case checks",
      "Evaluate at least 20 independent cases, including eight worked meals, reasoning and safety boundaries.",
      combinedPublished,
    ],
    [
      "nutrition-preview",
      "Nutrition week preview",
      "Generate and inspect a current sample week with meals, portions, cooking options and groceries.",
      combinedPublished,
    ],
    [
      "nutrition-readiness",
      "Nutrition activation",
      "Activate current qualified routine delivery; coach attention goes to exceptions.",
      combinedPublished,
    ],
  ] as const;
  const registry: ReadonlyArray<readonly [string, string, string, boolean]> =
    nutritionVisible
      ? [
          ...baseRegistry.slice(0, 9),
          ...nutritionSteps,
          ...baseRegistry.slice(9),
        ]
      : baseRegistry;
  const [site] = await tx.query(
    "SELECT draft,published,version,published_at FROM coach_sites WHERE tenant_id=$1",
    [a.tenantId],
  );
  const [brandDraft] = await tx.query(
    "SELECT data,version FROM coach_design_drafts WHERE tenant_id=$1",
    [a.tenantId],
  );
  const galleries = await tx.query(
    "SELECT id,title,description,audience,version FROM coach_galleries ORDER BY id",
  );
  const photos = await tx.query(
    "SELECT gallery_id,media_id,caption,alt,position FROM coach_gallery_photos ORDER BY gallery_id,position,media_id",
  );
  const [voice] = await tx.query(
    "SELECT id,status,version,user_id FROM trainer_voices",
  );
  const [voiceConsent] = voice
    ? await tx.query(
        "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='voice' ORDER BY created_at DESC,id DESC LIMIT 1",
        [voice.user_id],
      )
    : [];
  const website = {
    draft: site?.draft ?? null,
    published: site?.published ?? null,
    version: site?.version ?? 0,
    publishedAt: site?.published_at ?? null,
    hasUnpublishedChanges:
      !!site && digest(site.draft) !== digest(site.published),
    launchRequired: !tenant.published,
  };
  const materialKinds = new Set([
    "interview",
    "source",
    "rule",
    "conflict",
    "scenario",
    "coaching_teaching",
    "coaching_action",
    "coaching_scenario",
    "coaching_runtime_release",
  ]);
  const previewDigest = digest({
    name: tenant.name,
    theme: tenant.theme,
    brandDraft,
    website: {
      draft: website.draft,
      published: website.published,
      version: website.version,
    },
    galleries,
    photos,
    products: products
      .map((r) => ({
        id: r.id,
        version: r.version,
        status: r.status,
        data: r.data,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    release: release
      ? { id: release.id, version: release.version, data: release.data }
      : null,
    teaching: records
      .filter(
        (r) =>
          materialKinds.has(r.kind) ||
          (r.kind === "program" && r.status === "template"),
      )
      .map((r) => ({
        id: r.id,
        version: r.version,
        status: r.status,
        data: r.data,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    coachingModel: coachingModelPin(),
    coachingRuntime: runtime,
    capabilities: providers
      .filter((p) => ["stripe", "lean", "voice", "model"].includes(p.id))
      .map((p) => ({
        id: p.id,
        configured: p.configured,
        approved: p.approved,
      })),
    nutrition: nutritionVisible
      ? {
          enabled: nutrition.enabled,
          required: combinedPublished,
          releaseId: nutrition.release?.id,
          digest: nutrition.material.digest,
          scenarioDigest,
          methods: of("nutrition_method")
            .map((r) => ({
              id: r.id,
              version: r.version,
              status: r.status,
              data: r.data,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        }
      : null,
    wearablePolicy: saved.wearables?.data.values ?? null,
    voice: voice
      ? {
          id: voice.id,
          version: voice.version,
          status: voice.status,
          consent: voiceConsent?.granted ?? false,
        }
      : null,
    legal,
  });
  const beneficiary = of("beneficiary")[0];
  const bankReady =
    beneficiary?.status === "verified" &&
    !!beneficiary.data.providerId &&
    !!beneficiary.data.holdUntil &&
    new Date(beneficiary.data.holdUntil).getTime() <= Date.now();
  const voiceReady =
    voice?.status === "verified" &&
    voiceConsent?.granted === true &&
    voiceProvider.configured &&
    voiceProvider.approved;
  const complete: Record<string, boolean> = {
    account: a.emailVerified,
    identity: identityFields.safeParse(saved.identity?.data.values).success,
    brand: !!(
      tenant.theme?.headline &&
      tenant.theme?.bio &&
      tenant.theme?.category
    ),
    "brain-intro": saved["brain-intro"]?.data.values?.understood === true,
    interview:
      of("interview").length > 0 ||
      of("coaching_teaching").some((r) => r.status === "confirmed"),
    uploads: of("source").some((r) => r.status === "ready"),
    knowledge:
      confirmedRules.length > 0 &&
      !of("conflict").some((r) => r.status !== "resolved"),
    scenarios: baseScenarios.length >= 20,
    readiness: brainCurrent && runtimeCurrent && modelReady,
    offer:
      products.some((r) => r.status === "published" && r.data.stripePriceId) &&
      commerce.configured &&
      commerce.approved,
    payout: bankReady && bank.configured && bank.approved,
    wearables: saved.wearables?.status === "saved",
    voice: voiceReady,
    domain: !!tenant.slug,
    preview: saved.preview?.data.values?.digest === previewDigest,
    publish: tenant.published,
    "nutrition-cases":
      nutrition.coverage.every((c) => c.covered) && !learning.conflicts.length,
    "nutrition-recipes":
      nutrition.material.recipes.length > 0 &&
      nutrition.material.foods.length > 0,
    "nutrition-policy":
      !!nutrition.material.policy &&
      !nutrition.gaps.some((g) => g.startsWith("A policy source changed")),
    "nutrition-scenarios": !!nutritionEvaluation,
    "nutrition-preview": !!nutritionPreview,
    "nutrition-readiness": nutrition.ready,
  };
  const blockers: Record<string, string> = {};
  if (!nutrition.ready)
    blockers["nutrition-readiness"] = !nutrition.enabled
      ? "Enable nutrition and qualify current delivery before publishing a workout + nutrition offer."
      : (nutrition.gaps[0] ?? "Finish nutrition qualification.");
  if (learning.conflicts.length)
    blockers["nutrition-cases"] =
      "Resolve contradictory nutrition cases or clarify the different client conditions.";
  if (!nutritionEvaluation)
    blockers["nutrition-scenarios"] =
      "Run a passing evaluation of the current teaching, recipes, policy and independent worked meal checks.";
  if (!nutritionPreview)
    blockers["nutrition-preview"] =
      "Generate a sample week using your current nutrition teaching and recipes.";
  if (!commerce.configured || !commerce.approved)
    blockers.offer =
      "Stripe configuration and commerce approval are pending. You can save a draft offer.";
  if (!bank.configured || !bank.approved)
    blockers.payout =
      "Lean account verification and payout activation are pending. Your coaching setup can continue.";
  else if (!bankReady)
    blockers.payout =
      "A verified payout destination and completed bank-change hold are required.";
  if (!voiceReady)
    blockers.voice =
      !voiceProvider.configured || !voiceProvider.approved
        ? "Configure and approve the voice provider, then complete trainer identity verification and separate consent. This step is optional."
        : voice?.status === "pending"
          ? "Your submitted voice is awaiting identity review."
          : "Complete trainer voice verification and grant current voice permission, or defer this optional step.";
  if (!brainCurrent)
    blockers.readiness = release
      ? "Your published Brain does not match current confirmed rules and independent checks. Resolve conflicts, evaluate and publish the current guidance."
      : "Evaluate and publish a Brain release before launch.";
  else if (!runtimeCurrent)
    blockers.readiness =
      runtime.blocker ??
      "Your automatic coaching qualification changed. Evaluate and activate current teaching, actions and model settings, or disable automation to use trainer review.";
  if (brainCurrent && runtimeCurrent && !modelReady)
    blockers.readiness =
      "The operator must configure a coaching model connection before digital coaching is available.";
  const gates: Array<{ key: string; label: string; reason: string }> = registry
    .filter(
      ([key, , , required]) => required && key !== "publish" && !complete[key],
    )
    .map(([key, label]) => ({
      key,
      label,
      reason: blockers[key] ?? `Complete ${label.toLowerCase()}.`,
    }));
  const missingLegal = legal.documents
    .filter((d) => d.version === null)
    .map((d) => d.key);
  if (!legal.approved || missingLegal.length)
    gates.push({
      key: "legal",
      label: "Reviewed legal documents",
      reason: missingLegal.length
        ? `The operator must publish effective ${missingLegal.join(", ")} documents.`
        : "The operator must confirm approval of the published legal documents.",
    });
  const steps = registry.map(([key, label, description, required]) => ({
    key,
    label,
    description,
    required,
    version: saved[key]?.version ?? 0,
    values: saved[key]?.data.values ?? {},
    status: complete[key]
      ? "complete"
      : saved[key]?.status === "deferred" && !required
        ? "deferred"
        : blockers[key]
          ? "blocked"
          : saved[key]
            ? "draft"
            : "not_started",
    blocker: blockers[key] ?? null,
    links: destinations[key] ?? [],
  }));
  return {
    steps,
    gates,
    readyToPublish: gates.length === 0,
    resumeStep:
      steps.find((s) => s.required && s.status !== "complete")?.key ??
      "publish",
    licenceStatus: "NOT_REQUESTED",
    reservedSlug: tenant.slug,
    storefrontPath: `/coach/${tenant.slug}`,
    teaching: {
      brainCurrent,
      modelReady,
      runtime,
      confirmedRules: confirmedRules.length,
      coachingCases: of("coaching_teaching").filter(
        (r) => r.status === "confirmed",
      ).length,
      actions: of("coaching_action").filter((r) => r.status === "confirmed")
        .length,
      nutrition: nutritionVisible
        ? {
            coverage: learning.coverage,
            questions: learning.questions.slice(0, 3),
            conflicts: learning.conflicts.length,
            calorieMethods: of("nutrition_method").filter(
              (r) => r.status === "confirmed",
            ).length,
            evaluationCurrent: !!nutritionEvaluation,
            previewCurrent: !!nutritionPreview,
            ready: nutrition.ready,
            gaps: nutrition.gaps,
          }
        : null,
    },
    preview: {
      name: tenant.name,
      theme: tenant.theme,
      brandDraft: brandDraft ?? null,
      website,
      galleries: galleries.map((g) => ({
        ...g,
        photos: photos.filter((p) => p.gallery_id === g.id),
      })),
      legal,
      products: products.map((p) => ({
        id: p.id,
        status: p.status,
        ...p.data,
      })),
      digitalDisclosure:
        "Digital coaching follows trainer-reviewed guidance. Qualified routine actions can run automatically; exceptions go to your coach. It does not replace medical care.",
    },
    previewDigest,
  };
}
export function onboardingRoutes(
  app: FastifyInstance,
  db: Database,
  owner: (r: FastifyRequest) => Owner,
) {
  const load = (a: Owner) =>
    db.system(async (tx) => {
      const [tenant] = await tx.query("SELECT * FROM tenants WHERE id=$1", [
        a.tenantId,
      ]);
      const legal = await legalSnapshot(tx);
      await context(tx, a);
      return onboardingState(tx, a, tenant, legal);
    });
  app.get("/api/v1/onboarding", (req) => load(owner(req)));
  app.put("/api/v1/onboarding/:step", async (req) => {
    const a = owner(req),
      step = z
        .enum(["identity", "brain-intro", "wearables", "voice", "preview"])
        .parse((req.params as any).step);
    const b = z
      .object({
        version: z.number().int().min(0),
        values: z.record(z.string(), z.unknown()),
        defer: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    let values: unknown;
    if (step === "identity") values = identityDraft.parse(b.values);
    else if (step === "brain-intro")
      values = z
        .object({ understood: z.literal(true) })
        .strict()
        .parse(b.values);
    else if (step === "wearables")
      values = z
        .object({ policy: z.enum(["none", "permitted_imports"]) })
        .strict()
        .parse(b.values);
    else if (step === "voice") {
      if (!b.defer)
        throw fail(
          409,
          "VOICE_UNAVAILABLE",
          "Complete identity verification and consent in Trainer voice. Readiness updates automatically; this endpoint can defer the optional step.",
        );
      values = {};
    } else
      values = z
        .object({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .parse(b.values);
    if (b.defer && !["wearables", "voice"].includes(step))
      throw fail(400, "REQUIRED_STEP", "This step cannot be deferred");
    return db.system(async (tx) => {
      const [tenant] = await tx.query(
        "SELECT * FROM tenants WHERE id=$1 FOR UPDATE",
        [a.tenantId],
      );
      const legal = await legalSnapshot(tx);
      await context(tx, a);
      const [prior] = await tx.query(
        "SELECT * FROM records WHERE kind='onboarding_step' AND data->>'step'=$1 FOR UPDATE",
        [step],
      );
      if ((prior?.version ?? 0) !== b.version)
        throw fail(
          409,
          "STALE_ONBOARDING",
          "This step changed in another session. Reload it before saving.",
        );
      if (step === "preview") {
        const state = await onboardingState(tx, a, tenant, legal);
        if ((values as { digest: string }).digest !== state.previewDigest)
          throw fail(
            409,
            "PREVIEW_CHANGED",
            "Your setup changed after this preview loaded. Refresh and review the current version before continuing.",
          );
        values = {
          digest: state.previewDigest,
          reviewedAt: new Date().toISOString(),
        };
      }
      const data = { step, values, licenceStatus: "NOT_REQUESTED" },
        status = b.defer ? "deferred" : "saved";
      const row = prior
        ? (
            await tx.query(
              "UPDATE records SET data=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
              [prior.id, JSON.stringify(data), status],
            )
          )[0]
        : await putRecord(tx, a, "onboarding_step", data, { status });
      await event(tx, a, "onboarding.step_saved", row.id, {
        step,
        version: row.version,
        status,
      });
      return { version: row.version, values: row.data.values };
    });
  });
}
export async function publishStorefront(db: Database, a: Owner) {
  requireRecentMfa(a);
  const result = await db.system(async (tx) => {
    const [tenant] = await tx.query(
      "SELECT * FROM tenants WHERE id=$1 FOR UPDATE",
      [a.tenantId],
    );
    const legal = await legalSnapshot(tx);
    await context(tx, a);
    const state = await onboardingState(tx, a, tenant, legal);
    if (state.gates.length)
      throw fail(
        409,
        "PUBLISH_GATES",
        state.gates.map((g) => g.reason).join(" "),
      );
    await event(tx, a, "storefront.published", a.tenantId, {
      previewDigest: state.previewDigest,
    });
    await tx.query("RESET ROLE");
    await tx.query("UPDATE tenants SET published=true WHERE id=$1", [
      a.tenantId,
    ]);
    return { ok: true, path: state.storefrontPath };
  });
  try {
    await recordPublishAcquisition(db, a.tenantId);
  } catch {
    console.warn("Storefront acquisition conversion could not be recorded");
  }
  return result;
}
