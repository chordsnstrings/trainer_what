import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type SystemTx,
  type Tx,
} from "@trainer/db";
import { integrationStatus } from "@trainer/providers";
import { builderContentText, siteBuilderSchema } from "@trainer/contracts";
import { nutritionReadiness } from "./nutrition.ts";
import { requireRecentMfa } from "./security.ts";
import { nutritionLearning } from "../../../packages/domain/src/nutrition-learning.ts";
import { canonicalCoaching } from "../../../packages/domain/src/coaching-completion.ts";
import { coachingModelPin } from "../../../packages/providers/src/coaching.ts";
import { coachingRuntimeReadiness } from "./coaching-runtime.ts";
import { recordPublishAcquisition } from "./acquisition.ts";
import {
  brainCaseCoverage,
} from "../../../packages/contracts/src/coach-setup.ts";
import {
  NAME_PROBLEM_MESSAGES,
  pageIssues,
  realNameProblem,
  type PageIssue,
} from "../../../packages/domain/src/coach-setup.ts";
import {
  RESERVED_SLUGS,
  subdomainEligible,
} from "../../../packages/domain/src/web-address.ts";
import { OWN_CASES_FOR_SUPERVISED } from "../../../packages/domain/src/brain-teach.ts";

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
  share: [{ label: "Followers and growth", href: "/trainer/growth" }],
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
/** The setup checklist; SETUP_CHECKLIST in packages/contracts mirrors it. */
export const baseRegistry = [
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
    "Practice quiz",
    "Take the practice quiz and write 3 to 5 of your own client questions. Sending automatically later needs 20 cases and the full check.",
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
    "Bank details",
    "Asked at your first payout, not before launch. Add a UAE IBAN and complete ownership review; holds remain visible.",
    false,
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
    "preview",
    "Subscriber preview",
    "Approve what the public sees: your name, brand, published website, galleries and plans. Private teaching changes never reset this.",
    true,
  ],
  [
    "publish",
    "Publish",
    "Launch after the server verifies product, coaching, legal and financial readiness.",
    true,
  ],
  [
    "share",
    "Share your link",
    "Put your tagged coaching link in your Instagram bio and Stories. Followers who never see your offer can’t subscribe.",
    false,
  ],
] as const;
const offerIndex = baseRegistry.findIndex(([key]) => key === "offer");
/** The account fields the go-live checks read (users is a service table). */
export type SetupAccount = { name?: string | null };
/** One automatic go-live check; "trainsyou" ones wait on the platform. */
export type GoLiveGate = {
  key: string;
  label: string;
  reason: string;
  owner: "coach" | "trainsyou";
};
const ISSUE_TEXT: Record<PageIssue["issue"], string> = {
  contact: "a phone number",
  link: "a link or email address",
  medical_claim: "a medical claim or medical advice",
  platform_name: "the trainsyou name in your page name",
};
function pageIssueReason(issues: PageIssue[]) {
  const kinds = [...new Set(issues.map((i) => ISSUE_TEXT[i.issue]))];
  return `Your page has ${kinds.join(" and ")}. Members contact you through trainsyou, and a coaching page cannot promise medical results. Edit ${issues
    .slice(0, 3)
    .map((i) => i.field || "your page")
    .join(", ")}.`;
}
/** The owner's verified tenant scope inside the service transaction. */
function context<T>(tx: SystemTx, a: Actor, fn: (tx: Tx) => Promise<T>) {
  return tx.tenant({ ...a, role: "owner" }, fn);
}
export async function onboardingState(
  tx: Tx,
  a: Owner,
  tenant: any,
  legal: LegalSnapshot,
  account: SetupAccount = {},
) {
  const records = await tx.query(
    "SELECT * FROM records WHERE kind IN ('onboarding_step','interview','source','rule','conflict','scenario','brain_release','brain_quiz_round','evaluation','product','beneficiary','coaching_teaching','coaching_action','coaching_scenario','coaching_evaluation','coaching_runtime_release','program','nutrition_scenario','nutrition_evaluation','nutrition_preview','nutrition_method') ORDER BY updated_at DESC,id DESC",
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
  // The wizard's minimum (quiz answers plus the coach's own cases) or 20.
  const coverage = brainCaseCoverage(baseScenarios.slice(0, 30));
  const evaluatedIds = (brainEvaluation?.data.outcomes ?? [])
    .map((r: any) => r.scenarioId)
    .sort();
  const fullBrainCurrent =
    !!release &&
    confirmedRules.length > 0 &&
    digest(release.data.rules) === digest(confirmedRules) &&
    brainEvaluation?.status === "passed" &&
    brainEvaluation.data.rulesDigest === evaluationDigest(confirmedRules) &&
    coverage.enough &&
    digest(evaluatedIds) ===
      digest(
        baseScenarios
          .slice(0, 30)
          .map((r) => r.id)
          .sort(),
      ) &&
    !of("conflict").some((r) => r.status !== "resolved");
  // "Waits for me" launch (brain-teach.ts): a completed practice quiz and
  // at least 3 own cases instead of the full check. Automatic sending still
  // needs the full check (coaching-runtime.ts).
  const quizCompleted = of("brain_quiz_round").some(
    (r) => r.status === "completed",
  );
  // Own cases exclude quiz answers stored as platform_quiz scenarios.
  const quizReady = quizCompleted && coverage.own >= OWN_CASES_FOR_SUPERVISED;
  const quizAnswered = of("brain_quiz_round").reduce(
    (n, r) =>
      n + ((r.data?.cases as any[]) ?? []).filter((c) => c?.answer).length,
    0,
  );
  const brainCurrent =
    fullBrainCurrent ||
    (!!release &&
      release.data.qualification === "quiz" &&
      confirmedRules.length > 0 &&
      digest(release.data.rules) === digest(confirmedRules) &&
      quizReady &&
      !of("conflict").some((r) => r.status !== "resolved"));
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
      live: false,
      rechecking: false,
      mode: null,
      automatic: false,
      blocker: (error as Error).message,
    };
  }
  // The last passing version stays live while edits are re-checked.
  const runtimeCurrent =
    !runtime.blocker &&
    (!runtime.releaseId || runtime.current || runtime.live);
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
          ...baseRegistry.slice(0, offerIndex),
          ...nutritionSteps,
          ...baseRegistry.slice(offerIndex),
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
  // What the public sees, and only that: private teaching, automation,
  // provider settings and unpublished drafts never reset the approval.
  const publicProducts = products
    .filter((r) => r.status === "published")
    .map((r) => ({
      id: r.id,
      name: r.data.name,
      description: r.data.description,
      priceMinor: r.data.priceMinor,
      billing: r.data.billing ?? "monthly",
      tier: r.data.tier ?? "workout",
      programmeDays: r.data.programmeDays ?? null,
      voiceAddOnMinor: r.data.voiceAddOnMinor ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const previewDigest = digest({
    name: tenant.name,
    slug: tenant.slug,
    theme: tenant.theme,
    website: website.published,
    galleries,
    photos,
    products: publicProducts,
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
    identity:
      identityFields.safeParse(saved.identity?.data.values).success ||
      aboutComplete(saved.about?.data.values),
    brand: !!(
      tenant.theme?.headline &&
      tenant.theme?.bio &&
      tenant.theme?.category
    ),
    interview:
      of("interview").length > 0 ||
      of("coaching_teaching").some((r) => r.status === "confirmed"),
    uploads: of("source").some((r) => r.status === "ready"),
    knowledge:
      confirmedRules.length > 0 &&
      !of("conflict").some((r) => r.status !== "resolved"),
    scenarios: coverage.enough || quizReady,
    readiness: brainCurrent && runtimeCurrent && modelReady,
    offer:
      products.some((r) => r.status === "published" && r.data.stripePriceId) &&
      commerce.configured &&
      commerce.approved,
    payout: bankReady && bank.configured && bank.approved,
    wearables: saved.wearables?.status === "saved",
    voice: voiceReady,
    preview: saved.preview?.data.values?.digest === previewDigest,
    publish: tenant.published,
    share: tenant.published && saved.share?.status === "saved",
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
  if (!tenant.published)
    blockers.share =
      "Launch first, then share your link so followers can subscribe.";
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
  // Automatic go-live checks (owner decision, 30 September 2026) instead of
  // a staff approval: coach-side checks, then what waits on trainsyou.
  const commerceReady = commerce.configured && commerce.approved;
  const nameProblem = realNameProblem(account.name ?? "");
  const brandReady = complete.brand;
  // Screen the visible builder copy beyond the legacy traversal depth limit,
  // excluding draft-only content and typed style/media/link destinations.
  const { builder: rawBuilder, ...legacyWebsite } = website.published ?? {};
  const publishedBuilder = siteBuilderSchema.safeParse(rawBuilder);
  const issues = pageIssues({
    name: tenant.name,
    headline: tenant.theme?.headline,
    bio: tenant.theme?.bio,
    tagline: tenant.theme?.tagline,
    website: publishedBuilder.success ? {} : legacyWebsite,
    websiteBuilder: publishedBuilder.success
      ? builderContentText(publishedBuilder.data)
      : "",
    galleries: galleries.map((g) => ({
      title: g.title,
      description: g.description,
    })),
    photos: photos.map((p) => ({ caption: p.caption, alt: p.alt })),
    plans: products
      .filter((p) => p.status !== "archived")
      .map((p) => ({ name: p.data.name, description: p.data.description })),
  });
  const subdomainReady =
    subdomainEligible(tenant.slug) &&
    !RESERVED_SLUGS.has(tenant.slug) &&
    (tenant.published === true ||
      saved.subdomain?.data.values?.slug === tenant.slug);
  const pricedPlan = products.some(
    (p) => p.status !== "archived" && Number(p.data.priceMinor) > 0,
  );
  const planLive = products.some(
    (p) => p.status === "published" && p.data.stripePriceId,
  );
  const checks: Array<GoLiveGate & { ok: boolean }> = [
    {
      key: "real_name",
      label: "Your real name",
      owner: "coach",
      ok: !nameProblem,
      reason: nameProblem ? NAME_PROBLEM_MESSAGES[nameProblem] : "",
    },
    {
      key: "email_verified",
      label: "Verified email",
      owner: "coach",
      ok: a.emailVerified,
      reason: "Confirm your email address with the code or link we sent.",
    },
    {
      key: "page_ready",
      label: "Your page",
      owner: "coach",
      ok: brandReady && complete.preview,
      reason: brandReady
        ? "Approve your page as the public will see it."
        : "Add your headline, short bio and specialty.",
    },
    {
      key: "page_clean",
      label: "Page wording",
      owner: "coach",
      ok: issues.length === 0,
      reason: issues.length ? pageIssueReason(issues) : "",
    },
    {
      key: "subdomain",
      label: "Your web address",
      owner: "coach",
      ok: subdomainReady,
      reason: "Choose your web address.",
    },
    {
      key: "priced_plan",
      label: "A plan with a price",
      owner: "coach",
      ok: pricedPlan && (!commerceReady || planLive),
      reason: pricedPlan
        ? "Turn on your plan so members can join."
        : "Add a plan with a price.",
    },
    {
      key: "brain_minimum",
      label: "Brain taught",
      owner: "coach",
      ok: brainCurrent && runtimeCurrent,
      // Either route counts: a finished practice quiz round plus 3 own
      // questions (brain-teach.ts), or the wizard's case minimum.
      reason: !coverage.enough && !quizReady
        ? `${quizCompleted ? "" : `Finish a practice quiz round (${quizAnswered} questions answered so far) and `}${quizCompleted ? "Write" : "write"} ${OWN_CASES_FOR_SUPERVISED} of your own client questions (${Math.min(coverage.own, OWN_CASES_FOR_SUPERVISED)} so far).`
        : (blockers.readiness ??
          "Approve your rules and check your Brain with your answers."),
    },
    ...(combinedPublished && !nutrition.ready
      ? [
          {
            key: "nutrition-readiness",
            label: "Nutrition",
            owner: "coach" as const,
            ok: false,
            reason: blockers["nutrition-readiness"]!,
          },
        ]
      : []),
  ];
  const missingLegal = legal.documents
    .filter((d) => d.version === null)
    .map((d) => d.key);
  checks.push(
    {
      key: "legal",
      label: "Reviewed legal documents",
      owner: "trainsyou",
      ok: legal.approved && !missingLegal.length,
      reason: missingLegal.length
        ? `The operator must publish effective ${missingLegal.join(", ")} documents.`
        : "The operator must confirm approval of the published legal documents.",
    },
    {
      key: "payments",
      label: "Payments",
      owner: "trainsyou",
      ok: commerceReady,
      reason:
        "trainsyou is finishing card payments. We'll email you when members can pay.",
    },
    {
      key: "model",
      label: "Coaching assistant",
      owner: "trainsyou",
      ok: modelReady,
      reason:
        "trainsyou is connecting the coaching assistant. We'll email you when it is ready.",
    },
  );
  const gates: GoLiveGate[] = checks
    .filter((c) => !c.ok)
    .map(({ ok: _ok, ...gate }) => gate);
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
    goLive: {
      checks: checks.map(({ key, label, owner, ok, reason }) => ({
        key,
        label,
        owner,
        ok,
        reason: ok ? null : reason,
      })),
      pageIssues: issues,
      // Quiz answers count from both routes: practice quiz rounds
      // (brain-teach.ts) and any platform_quiz scenarios.
      brainCases: {
        ...coverage,
        quiz: coverage.quiz + quizAnswered,
        enough: coverage.enough || quizReady,
        quizCompleted,
      },
      mode: "waits_for_me" as const,
    },
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
/** Wizard "About you": name, an offered specialty and who you coach. */
export function aboutComplete(values: any) {
  return (
    typeof values?.name === "string" &&
    values.name.trim().length >= 2 &&
    typeof values?.specialty === "string" &&
    values.specialty.length > 0 &&
    typeof values?.audience === "string" &&
    values.audience.trim().length >= 3
  );
}
/** The account's own fields, read in the service transaction. */
export async function setupAccount(
  tx: SystemTx,
  a: Actor,
  known: SetupAccount = {},
): Promise<SetupAccount> {
  if (known.name != null) return known;
  const [user] = await tx.query("SELECT name FROM users WHERE id=$1", [
    a.userId,
  ]);
  return { name: user?.name ?? "" };
}
/** Loads the tenant, legal snapshot and account, then the setup state. */
export function loadOnboarding(db: Database, a: Owner) {
  return db.system(
    async (tx) => {
      const [tenant] = await tx.query("SELECT * FROM tenants WHERE id=$1", [
        a.tenantId,
      ]);
      const legal = await legalSnapshot(tx);
      const account = await setupAccount(tx, a);
      return context(tx, a, (tx) =>
        onboardingState(tx, a, tenant, legal, account),
      );
    },
    { tenantId: a.tenantId },
  );
}
/**
 * Saves one step record (optimistic version check). A "preview" value is the
 * digest of the page as shown; it must still match what the public would see.
 */
export async function saveOnboardingStep(
  db: Database,
  a: Owner,
  step: string,
  input: { version: number; values: unknown; status: "saved" | "deferred" },
) {
  return db.system(
    async (tx) => {
      const [tenant] = await tx.query(
        "SELECT * FROM tenants WHERE id=$1 FOR UPDATE",
        [a.tenantId],
      );
      const legal = await legalSnapshot(tx);
      const account = await setupAccount(tx, a);
      return context(tx, a, async (tx) => {
        const [prior] = await tx.query(
          "SELECT * FROM records WHERE kind='onboarding_step' AND data->>'step'=$1 FOR UPDATE",
          [step],
        );
        if ((prior?.version ?? 0) !== input.version)
          throw fail(
            409,
            "STALE_ONBOARDING",
            "This step changed in another session. Reload it before saving.",
          );
        let values = input.values;
        if (step === "preview" && input.status === "saved") {
          const state = await onboardingState(tx, a, tenant, legal, account);
          if ((values as { digest: string }).digest !== state.previewDigest)
            throw fail(
              409,
              "PREVIEW_CHANGED",
              "Your page changed after this preview loaded. Refresh and review the current version before continuing.",
            );
          values = {
            digest: state.previewDigest,
            reviewedAt: new Date().toISOString(),
          };
        }
        const data = { step, values, licenceStatus: "NOT_REQUESTED" },
          status = input.status;
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
    },
    { tenantId: a.tenantId },
  );
}
export function onboardingRoutes(
  app: FastifyInstance,
  db: Database,
  owner: (r: FastifyRequest) => Owner,
) {
  app.get("/api/v1/onboarding", (req) => loadOnboarding(db, owner(req)));
  app.put("/api/v1/onboarding/:step", async (req) => {
    const a = owner(req),
      step = z
        .enum(["identity", "wearables", "voice", "preview", "share"])
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
    else if (step === "wearables")
      values = z
        .object({
          policy: z.enum([
            "none",
            "permitted_imports",
            "permitted_imports_and_sync",
          ]),
        })
        .strict()
        .parse(b.values);
    else if (step === "share")
      values = z
        .object({
          channels: z
            .array(z.enum(["instagram_bio", "instagram_story", "other"]))
            .min(1)
            .max(3),
        })
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
    return saveOnboardingStep(db, a, step, {
      version: b.version,
      values,
      status: b.defer ? "deferred" : "saved",
    });
  });
}
export async function publishStorefront(
  db: Database,
  a: Owner,
  account: SetupAccount = {},
) {
  // Asked in place: the go-live screen enters the authenticator code (or
  // sets one up) itself and retries; no detour to Account security.
  try {
    requireRecentMfa(a);
  } catch (error) {
    throw Object.assign(error as Error, {
      message:
        "Enter your authenticator code to go live. If you have none yet, set one up on this screen.",
    });
  }
  const result = await db.system(
    async (tx) => {
      const [tenant] = await tx.query(
        "SELECT * FROM tenants WHERE id=$1 FOR UPDATE",
        [a.tenantId],
      );
      const legal = await legalSnapshot(tx);
      const user = await setupAccount(tx, a, account);
      const state = await context(tx, a, async (tx) => {
        const state = await onboardingState(tx, a, tenant, legal, user);
        if (state.gates.length)
          throw fail(
            409,
            "PUBLISH_GATES",
            state.gates.map((g) => g.reason).join(" "),
          );
        await event(tx, a, "storefront.published", a.tenantId, {
          previewDigest: state.previewDigest,
        });
        return state;
      });
      await tx.query("UPDATE tenants SET published=true WHERE id=$1", [
        a.tenantId,
      ]);
      return { ok: true, path: state.storefrontPath };
    },
    { tenantId: a.tenantId },
  );
  try {
    await recordPublishAcquisition(db, a.tenantId);
  } catch {
    console.warn("Storefront acquisition conversion could not be recorded");
  }
  return result;
}
