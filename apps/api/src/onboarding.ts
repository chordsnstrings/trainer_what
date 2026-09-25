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
    "Your methodology stays under your control. Digital responses are supervised and disclosed.",
    true,
  ],
  [
    "interview",
    "Coaching interview",
    "Describe your decisions in your own words. Answers become reviewable teaching material.",
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
    "An evaluated, approved release is required for supervised digital coaching.",
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
    "Synthetic voice is disabled until identity, consent and provider setup are implemented.",
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
    "Review your current storefront, offer and digital-coaching disclosure before launch.",
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
export async function onboardingState(tx: Tx, a: Owner, tenant: any) {
  const records = await tx.query(
    "SELECT * FROM records WHERE kind IN ('onboarding_step','interview','source','rule','conflict','scenario','brain_release','evaluation','product','beneficiary') ORDER BY updated_at DESC",
  );
  const of = (kind: string) => records.filter((r) => r.kind === kind),
    saved = Object.fromEntries(
      of("onboarding_step").map((r) => [r.data.step, r]),
    );
  const providers = integrationStatus(),
    commerce = providers.find((p) => p.id === "stripe")!,
    bank = providers.find((p) => p.id === "lean")!;
  const products = of("product"),
    release = of("brain_release").find((r) => r.status === "published");
  const nutrition = await nutritionReadiness(tx);
  const combinedPublished = products.some(
    (p) => p.status === "published" && p.data.tier === "workout_nutrition",
  );
  const nutritionSteps = [
    [
      "nutrition-cases",
      "Teach nutrition",
      "Answer realistic client cases so the system learns your recommendations and limits.",
      combinedPublished,
    ],
    [
      "nutrition-recipes",
      "Recipes and ingredients",
      "Add ingredient facts, portions and practical cooking options.",
      combinedPublished,
    ],
    [
      "nutrition-policy",
      "Confirm nutrition rules",
      "Resolve gaps and confirm the diet and automatic-action policy.",
      combinedPublished,
    ],
    [
      "nutrition-scenarios",
      "Nutrition case checks",
      "Check unfamiliar cases independently from your teaching examples.",
      combinedPublished,
    ],
    [
      "nutrition-preview",
      "Nutrition week preview",
      "Inspect a sample week with connected meals, portions and groceries.",
      combinedPublished,
    ],
    [
      "nutrition-readiness",
      "Nutrition activation",
      "Qualify routine automatic delivery, with coach input for exceptions.",
      combinedPublished,
    ],
  ] as const;
  const registry: ReadonlyArray<readonly [string, string, string, boolean]> =
    nutrition.enabled
      ? [
          ...baseRegistry.slice(0, 9),
          ...nutritionSteps,
          ...baseRegistry.slice(9),
        ]
      : baseRegistry;
  const previewDigest = createHash("sha256")
    .update(
      JSON.stringify({
        name: tenant.name,
        theme: tenant.theme,
        products: products.map((p) => ({
          id: p.id,
          version: p.version,
          status: p.status,
          data: p.data,
        })),
        release: release?.id,
        nutrition: combinedPublished
          ? {
              releaseId: nutrition.release?.id,
              digest: nutrition.material.digest,
            }
          : null,
        legal: process.env.LEGAL_VERSION ?? "draft-2026-09",
      }),
    )
    .digest("hex");
  const beneficiary = of("beneficiary")[0],
    bankReady =
      beneficiary?.status === "verified" &&
      !!beneficiary.data.providerId &&
      !!beneficiary.data.holdUntil &&
      new Date(beneficiary.data.holdUntil).getTime() <= Date.now();
  const complete: Record<string, boolean> = {
    account: a.emailVerified,
    identity: identityFields.safeParse(saved.identity?.data.values).success,
    brand: !!(
      tenant.theme?.headline &&
      tenant.theme?.bio &&
      tenant.theme?.category
    ),
    "brain-intro": saved["brain-intro"]?.data.values?.understood === true,
    interview: of("interview").length > 0,
    uploads: of("source").some((r) => r.status === "ready"),
    knowledge:
      of("rule").some((r) => r.status === "confirmed") &&
      !of("conflict").some((r) => r.status !== "resolved"),
    scenarios:
      of("scenario").filter((r) => r.status === "held_out").length >= 20,
    readiness: !!release,
    offer:
      products.some((r) => r.status === "published" && r.data.stripePriceId) &&
      commerce.configured &&
      commerce.approved,
    payout: bankReady && bank.configured && bank.approved,
    wearables: !!saved.wearables,
    voice: false,
    domain: !!tenant.slug,
    preview: saved.preview?.data.values?.digest === previewDigest,
    publish: tenant.published,
    "nutrition-cases": nutrition.coverage.every((c) => c.covered),
    "nutrition-recipes":
      nutrition.material.recipes.length > 0 &&
      nutrition.material.foods.length > 0,
    "nutrition-policy": !!nutrition.material.policy,
    "nutrition-scenarios": !!nutrition.release,
    "nutrition-preview": !!nutrition.release,
    "nutrition-readiness": nutrition.ready,
  };
  const blockers: Record<string, string> = {};
  if (!nutrition.ready)
    blockers["nutrition-readiness"] =
      nutrition.gaps[0] ??
      "Finish nutrition setup before activating the combined tier.";
  if (!commerce.configured || !commerce.approved)
    blockers.offer =
      "Stripe configuration and commerce approval are pending. You can save a draft offer.";
  if (!bank.configured || !bank.approved)
    blockers.payout =
      "Lean account verification and payout activation are pending. Your coaching setup can continue.";
  else if (!bankReady)
    blockers.payout =
      "A verified payout destination and completed bank-change hold are required.";
  blockers.voice =
    "Voice provider, verified identity and separate consent are not enabled.";
  if (!release)
    blockers.readiness =
      "Evaluate and publish a supervised Brain release first.";
  const gates: Array<{ key: string; label: string; reason: string }> = registry
    .filter(
      ([key, , , required]) => required && key !== "publish" && !complete[key],
    )
    .map(([key, label]) => ({
      key,
      label,
      reason: blockers[key] ?? `Complete ${label.toLowerCase()}.`,
    }));
  if (process.env.LEGAL_APPROVED !== "true")
    gates.push({
      key: "legal",
      label: "Reviewed legal documents",
      reason:
        "The operator must publish reviewed legal documents and confirm their version.",
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
    preview: {
      name: tenant.name,
      theme: tenant.theme,
      products: products.map((p) => ({
        id: p.id,
        status: p.status,
        ...p.data,
      })),
      digitalDisclosure:
        "Digital coaching follows trainer-reviewed guidance. It does not replace medical care.",
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
      await context(tx, a);
      return onboardingState(tx, a, tenant);
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
          "Voice setup is not enabled. You can defer this optional step.",
        );
      values = {};
    } else values = {};
    if (b.defer && !["wearables", "voice"].includes(step))
      throw fail(400, "REQUIRED_STEP", "This step cannot be deferred");
    return db.system(async (tx) => {
      const [tenant] = await tx.query(
        "SELECT * FROM tenants WHERE id=$1 FOR UPDATE",
        [a.tenantId],
      );
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
      if (step === "preview")
        values = {
          digest: (await onboardingState(tx, a, tenant)).previewDigest,
          reviewedAt: new Date().toISOString(),
        };
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
  return db.system(async (tx) => {
    const [tenant] = await tx.query(
      "SELECT * FROM tenants WHERE id=$1 FOR UPDATE",
      [a.tenantId],
    );
    await context(tx, a);
    const state = await onboardingState(tx, a, tenant);
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
}
