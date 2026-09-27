/**
 * Trainers: three workspaces are created and launched through the public API
 * (setupTrainers), then trainer-side scenarios run over the seeded platform.
 * Feature names match the verified inventory's "Trainers" list.
 */
import assert from "node:assert/strict";
import type { Client } from "../harness/client.ts";
import type { E2EContext, TrainerSeed } from "../harness/context.ts";
import {
  PASSWORD,
  TRAINERS,
  brainScenarioPrompts,
  sampleJpeg,
  uaeIban,
  type TrainerPlan,
} from "../harness/data.ts";
import {
  fixtureCases,
  fixtureCatalog,
  fixturePolicy,
  fixtureProfile,
} from "../../nutrition-fixtures.ts";
import { principleForCategory } from "../../../packages/domain/src/nutrition-learning-schema.ts";
import { trainerFlows } from "./trainer-flows.e2e.ts";

const T = "Trainers" as const;
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

class Abort extends Error {}
/** Records a step; a failed critical step aborts the rest of this trainer's setup. */
async function must(ctx: E2EContext, feature: string, title: string, fn: () => Promise<string | void>) {
  if (!(await ctx.reporter.step(T, feature, title, fn))) throw new Abort(title);
}

export async function setupTrainers(ctx: E2EContext) {
  for (const [index, plan] of TRAINERS.entries()) {
    const client = ctx.newClient(plan.slug, plan.email, PASSWORD);
    const seed: TrainerSeed = {
      client,
      slug: plan.slug,
      name: plan.name,
      tenantId: "",
      products: {},
      published: false,
      nutrition: plan.nutrition,
      notes: [],
    };
    ctx.trainers.push(seed);
    ctx.log(`— trainer ${plan.slug}`);
    try {
      await setupTrainer(ctx, plan, seed, index);
    } catch (error) {
      if (!(error instanceof Abort)) throw error;
      seed.notes.push("setup stopped after: " + error.message);
      ctx.log(`  trainer ${plan.slug} setup stopped after a failed step`);
    }
  }
}

async function setupTrainer(ctx: E2EContext, plan: TrainerPlan, seed: TrainerSeed, index: number) {
  const t = seed.client;
  await must(ctx, "Trainer signup (create a coaching workspace)", `${plan.slug}: register and reserve the workspace address`, async () => {
    // One trainer arrives through a tracked campaign and consents to analytics,
    // so sign-up, launch and first payment become attributed conversion milestones.
    if (index === 2)
      await t.post("/api/v1/public/acquisition/consent", {
        granted: true,
        touch: { source: "partner", medium: "referral", campaign: "e2e_trainer_funnel" },
      });
    const r = await t.request("POST", "/api/v1/auth/register", {
      name: plan.name,
      email: plan.email,
      password: PASSWORD,
      slug: plan.slug,
      accepted: true,
    });
    assert.equal(r.status, 201, r.text);
    const boot = await t.get("/api/v1/bootstrap");
    seed.tenantId = boot.tenant.id;
    t.userId = boot.user.userId;
    t.tenantId = boot.tenant.id;
    assert.equal(boot.tenant.slug, plan.slug);
    assert.equal(boot.user.emailVerified, false, "production accounts start unverified");
  });
  await must(ctx, "Email address verification", `${plan.slug}: verification link arrives by email and verifies`, async () => {
    await ctx.verifyEmail(t);
    const security = await t.get("/api/v1/auth/security");
    assert.equal(security.emailVerified, true);
  });
  await must(ctx, "Authenticator app (TOTP) for trainers", `${plan.slug}: enrol an authenticator after verification`, async () => {
    const codes = await t.enrollMfa();
    assert.ok(codes.length > 0);
  });
  await must(ctx, "Save business identity, Brain intro, wearable policy and defer voice", `${plan.slug}: onboarding steps saved`, async () => {
    await t.put("/api/v1/onboarding/identity", {
      version: 0,
      values: {
        businessName: plan.name + " Coaching",
        publicName: plan.name,
        city: plan.city,
        country: "AE",
        category: plan.category,
        audience: plan.audience,
      },
    });
    await t.put("/api/v1/onboarding/brain-intro", { version: 0, values: { understood: true } });
    // Imports plus the companion app's automatic Apple Health sync.
    await t.put("/api/v1/onboarding/wearables", { version: 0, values: { policy: "permitted_imports_and_sync" } });
    if (!plan.voice) await t.put("/api/v1/onboarding/voice", { version: 0, values: {}, defer: true });
  });
  await must(ctx, "Design Studio and brand (app theme, headline, bio, colours, logo)", `${plan.slug}: brand saved`, async () => {
    const saved = await t.put("/api/v1/tenant/brand", {
      name: plan.name,
      bio: plan.bio,
      category: plan.category,
      accent: plan.accent,
      headline: plan.headline,
    });
    assert.ok(saved.brandVersion >= 1);
  });

  // ------------------------------------------------------------ Brain
  const sourceIds: string[] = [];
  await must(ctx, "Add teaching sources by pasting text", `${plan.slug}: ${plan.sources.length} rights-attested sources`, async () => {
    for (const source of plan.sources) {
      const r = await t.post("/api/v1/brain/sources", { ...source, rights: true });
      sourceIds.push(r.id);
    }
  });
  let rules: any[] = [];
  await must(ctx, "AI rule compilation from sources", `${plan.slug}: model compiles draft rules citing the sources`, async () => {
    const compiled = await t.post("/api/v1/brain/compile", { sourceIds });
    // A deterministic order (the API's follows random IDs) keeps the corrected rule, the held-out
    // scenarios and therefore later model requests identical across runs, so replay files match.
    rules = [...compiled.rules].sort((x: any, y: any) => String(x.data.directive).localeCompare(String(y.data.directive)));
    assert.ok(rules.length >= 4, "rules compiled");
    assert.ok(rules.every((r: any) => r.status === "draft" && r.data.sourceIds.every((id: string) => sourceIds.includes(id))));
    assert.equal(compiled.coverage.completeInput, true);
    return `${rules.length} draft rules, ${compiled.conflicts} conflicts`;
  });
  const boot = await t.get("/api/v1/bootstrap");
  const conflicts = boot.records.filter((r: any) => r.kind === "conflict" && r.status === "open");
  if (conflicts.length)
    await must(ctx, "Resolve teaching conflicts", `${plan.slug}: ${conflicts.length} compiler conflict(s) resolved`, async () => {
      for (const c of conflicts)
        await t.post(`/api/v1/brain/conflicts/${c.id}/resolve`, {
          resolution: "Failure sets apply only after the first four weeks of a program; before then stop two reps short.",
        });
    });
  await must(ctx, "Write, correct and confirm rules manually", `${plan.slug}: correct one rule, then confirm all`, async () => {
    const first = rules[0];
    const corrected = await t.patch(`/api/v1/brain/rules/${first.id}`, {
      rule: {
        title: first.data.title,
        category: first.data.category,
        condition: first.data.condition,
        directive: first.data.directive,
        reason: "Trainer confirmed wording after review.",
        sourceIds: first.data.sourceIds,
      },
      reason: "Clarified the reason after reviewing the compiler draft",
      version: first.version,
    });
    rules[0] = corrected;
    for (const rule of rules) {
      const confirmed = await t.post(`/api/v1/brain/rules/${rule.id}/confirm`, {});
      assert.equal(confirmed.status, "confirmed");
    }
  });
  await must(ctx, "Held-out test scenarios", `${plan.slug}: 20 held-out scenarios`, async () => {
    for (const scenario of brainScenarioPrompts(rules))
      await t.post("/api/v1/brain/scenarios", { ...scenario, heldOut: true });
  });
  let evaluation: any;
  await must(ctx, "Brain evaluation", `${plan.slug}: evaluation passes all held-out scenarios`, async () => {
    evaluation = await t.post("/api/v1/brain/evaluate", {});
    assert.equal(evaluation.data.total, 20);
    assert.equal(evaluation.status, "passed", JSON.stringify(evaluation.data.outcomes.filter((o: any) => !o.passed)));
    return `${evaluation.data.passed}/${evaluation.data.total}`;
  });
  let release: any;
  await must(ctx, "Brain release and rollback", `${plan.slug}: publish the evaluated release`, async () => {
    release = await t.post("/api/v1/brain/releases", { evaluationId: evaluation.id, notes: "First sandbox release" });
    assert.equal(release.status, "published");
  });

  // ------------------------------------------------------------ programs
  await must(ctx, "Programs screen, templates and exercise library", `${plan.slug}: exercise and program template`, async () => {
    await t.post("/api/v1/training/exercises", { name: "Goblet squat", sets: 3, reps: 10, restSeconds: 90, loadKg: 16, rir: 2, cue: "Chest tall" });
    const program = await t.post("/api/v1/programs", {
      program: {
        title: `${plan.category} foundations`,
        goal: "Build a consistent three-day routine",
        daysPerWeek: 3,
        weeks: 4,
        exercises: [
          {
            name: "Barbell back squat",
            sets: 3,
            reps: 5,
            restSeconds: 150,
            loadKg: 60,
            rir: 2,
            cue: "Brace before each rep",
            demonstrationUrl: "https://videos.sandbox.example/squat",
            alternatives: [{ name: "Goblet squat", cue: "Hold the bell at the chest", loadKg: 20 }],
          },
          { name: "Push-up", sets: 3, reps: 12, restSeconds: 60, loadKg: 0, rir: 2, cue: "Straight line" },
          { name: "Dumbbell row", sets: 3, reps: 10, restSeconds: 90, loadKg: 18, rir: 2, cue: "Pull to the hip" },
        ],
      },
    });
    assert.equal(program.status, "template");
    seed.programTemplateId = program.id;
  });

  if (plan.runtime) await setupRuntime(ctx, t, plan, rules);
  if (plan.nutrition) await setupNutrition(ctx, t, plan);

  // ------------------------------------------------------------ offers
  await must(ctx, "Draft offers (workout and workout + nutrition tiers)", `${plan.slug}: draft offer(s)`, async () => {
    seed.products.workout = await t.post("/api/v1/products", {
      name: `${plan.category} membership`,
      description: "Personal programming, chat and digital coaching (sandbox)",
      priceMinor: plan.workoutPriceMinor,
      tier: "workout",
    });
    if (plan.nutrition) {
      await t.fails(400, "POST", "/api/v1/products", {
        name: "Too cheap combined",
        description: "Must cost more than workout-only",
        priceMinor: plan.workoutPriceMinor,
        tier: "workout_nutrition",
        baseProductId: seed.products.workout.id,
      }, "NUTRITION_PRICE");
      seed.products.nutrition = await t.post("/api/v1/products", {
        name: `${plan.category} + nutrition`,
        description: "Everything in the workout tier plus weekly meal plans (sandbox)",
        priceMinor: plan.workoutPriceMinor + 15000,
        tier: "workout_nutrition",
        premiumVoice: plan.voice,
        baseProductId: seed.products.workout.id,
      });
    }
  });
  await must(ctx, "Activate an offer for sale", `${plan.slug}: offers published to the Stripe mock`, async () => {
    for (const product of Object.values(seed.products)) {
      await t.post(`/api/v1/products/${product.id}/activate`, {});
    }
    const records = (await t.get("/api/v1/bootstrap")).records.filter((r: any) => r.kind === "product");
    for (const r of records) {
      assert.equal(r.status, "published");
      assert.ok(ctx.mocks.stripe.prices.has(r.data.stripePriceId), "price exists in the Stripe mock");
      assert.equal(ctx.mocks.stripe.prices.get(r.data.stripePriceId)!.unit_amount, r.data.priceMinor);
    }
    Object.assign(seed.products, Object.fromEntries(records.map((r: any) => [r.data.tier === "workout" ? "workout" : "nutrition", r])));
    return `${records.length} offer(s)`;
  });

  // ------------------------------------------------------------ payout bank
  let beneficiaryId = "";
  await must(ctx, "Payout bank account (UAE IBAN)", `${plan.slug}: IBAN submitted to the Lean mock after a fresh authenticator code`, async () => {
    await t.stepUp();
    const r = await t.post("/api/v1/payout-beneficiaries", {
      name: plan.name,
      iban: uaeIban(index + 1),
      address: "1 Sandbox Street",
      city: plan.city,
    });
    assert.equal(r.status, "validating");
    beneficiaryId = r.id;
    assert.ok([...ctx.mocks.lean.destinations.values()].some((d) => d.name === plan.name));
  });
  await ctx.reporter.step("Super admin", "Trainer bank destination review", `${plan.slug}: independent operator verifies the destination`, async () => {
    await ctx.admin.stepUp();
    await ctx.admin.post(`/api/v1/admin/tenants/${seed.tenantId}/finance/beneficiaries/${beneficiaryId}/review`, {
      verified: true,
      evidenceReference: "Sandbox ownership evidence reviewed by the Superadmin",
    });
    await t.fails(409, "POST", "/api/v1/payout-runs/prepare", { period: "2026-08" }, "BANK_CHANGE_HOLD");
  });
  await ctx.advanceClock(
    `${plan.slug}: end the 72-hour bank-change hold`,
    "UPDATE records SET data=data||jsonb_build_object('holdUntil',to_char((now()-interval '1 minute') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')) WHERE tenant_id=$1 AND kind='beneficiary' AND status='verified'",
    [seed.tenantId],
  );

  // ------------------------------------------------------------ media, website
  if (plan.website) await setupWebsite(ctx, t, plan);
  if (plan.voice) await setupVoice(ctx, t, plan);

  // ------------------------------------------------------------ preview + publish
  await must(ctx, "Subscriber preview review step", `${plan.slug}: preview digest reviewed`, async () => {
    const state = await t.get("/api/v1/onboarding");
    const blocking = state.gates.filter((g: any) => g.key !== "preview");
    assert.deepEqual(blocking, [], "gates before preview: " + JSON.stringify(blocking));
    const step = state.steps.find((s: any) => s.key === "preview");
    await t.put("/api/v1/onboarding/preview", { version: step.version, values: { digest: state.previewDigest } });
  });
  await must(ctx, "Publish storefront (launch)", `${plan.slug}: launch after server-verified readiness`, async () => {
    await t.stepUp();
    const result = await t.post("/api/v1/tenant/publish", {});
    assert.equal(result.path, `/coach/${plan.slug}`);
    seed.published = true;
  });
  if (plan.website)
    await must(ctx, "Publish website", `${plan.slug}: publish the website draft`, async () => {
      const site = await t.get("/api/v1/tenant/site");
      const published = await t.post("/api/v1/tenant/site/publish", { version: site.version });
      assert.ok(published.published);
    });
}

async function setupWebsite(ctx: E2EContext, t: Client, plan: TrainerPlan) {
  const media: any[] = [];
  await must(ctx, "Photo and media upload", `${plan.slug}: two rights-confirmed photos`, async () => {
    for (const [i, color] of ["#446688", "#886644"].entries()) {
      const image = await sampleJpeg(color, i);
      media.push(await t.post("/api/v1/tenant/media", { filename: `studio-${i}.jpg`, data: image.toString("base64"), rightsConfirmed: true }));
    }
    assert.equal(media.length, 2);
  });
  await must(ctx, "Photo galleries for the website and the subscriber app", `${plan.slug}: gallery with photos`, async () => {
    const gallery = await t.post("/api/v1/tenant/galleries", { title: "Studio", description: "Training space" });
    await t.put(`/api/v1/tenant/galleries/${gallery.id}/photos`, {
      version: gallery.version,
      photos: media.map((m, i) => ({ mediaId: m.id, alt: `Studio photo ${i + 1}`, caption: "Sandbox photo" })),
    });
    // Show the gallery on the website and in the subscriber app.
    const current = (await t.get("/api/v1/tenant/galleries")).galleries.find((g: any) => g.id === gallery.id);
    const shown = await t.okMfa("PATCH", `/api/v1/tenant/galleries/${gallery.id}`, { version: current.version, title: "Studio", description: "Training space", audience: "both" });
    assert.equal(shown.audience, "both");
    const galleries = await t.get("/api/v1/tenant/galleries");
    assert.ok(galleries.galleries.some((g: any) => g.id === gallery.id && g.photos.length === media.length));
  });
  await must(ctx, "Website editor and private preview", `${plan.slug}: website draft saved and previewed privately`, async () => {
    const site = await t.get("/api/v1/tenant/site");
    await t.put("/api/v1/tenant/site", {
      version: site.version,
      site: {
        ...site.draft,
        headline: plan.headline,
        introduction: `${plan.name} coaches ${plan.audience.toLowerCase()}.`,
        about: plan.bio,
        contactEmail: plan.email,
        whatsapp: "+971500000000",
        cta: "Start coaching",
        seoTitle: `${plan.name} — ${plan.category}`,
        seoDescription: plan.headline,
        pages: [{ slug: "schedule", title: "Weekly schedule", body: "Strength sessions on Monday, Wednesday and Friday at 7am.", visible: true }],
      },
    });
    const preview = await t.get("/api/v1/tenant/site/preview");
    assert.equal(preview.preview, true);
    assert.equal(preview.site.headline, plan.headline);
    const anon = ctx.newClient("anonymous-preview");
    const hidden = await anon.request("GET", `/api/v1/public/sites/${plan.slug}`);
    assert.notEqual(hidden.status, 200, "unpublished site is not public");
  });
}

async function setupVoice(ctx: E2EContext, t: Client, plan: TrainerPlan) {
  const voiceId = "mockVoice" + plan.slug.replace(/[^a-z]/g, "").slice(0, 8);
  ctx.mocks.voice.voices.add(voiceId);
  await ctx.reporter.step(T, "Trainer voice and guided audio sessions", `${plan.slug}: submit a consented provider voice`, async () => {
    const { silentMp3 } = await import("../mocks/voice.ts");
    const profile = await t.post("/api/v1/voice/profile", {
      revision: 0,
      consent: true,
      rights: true,
      providerVoiceId: voiceId,
      statement: "I own this voice and consent to assigned workout guidance only (sandbox).",
      voiceKind: "instant",
      sample: { base64: silentMp3(4).toString("base64"), type: "audio/mpeg" },
    });
    assert.equal(profile.status, "pending");
  });
  await ctx.reporter.step("Super admin", "Trainer voice verification", `${plan.slug}: operator verifies identity and rights`, async () => {
    await ctx.admin.stepUp();
    const voices = await ctx.admin.get(`/api/v1/admin/integrations/voices?tenantId=${ctx.trainers.find((x) => x.slug === plan.slug)!.tenantId}`);
    const voice = (Array.isArray(voices) ? voices : voices.rows ?? []).find((v: any) => v.provider_voice_id === voiceId || v.providerVoiceId === voiceId) ?? (Array.isArray(voices) ? voices[0] : undefined);
    assert.ok(voice, "voice listed for review: " + JSON.stringify(voices).slice(0, 300));
    const sample = await ctx.admin.request("GET", `/api/v1/admin/integrations/voices/${voice.id}/sample`, undefined, { raw: true });
    assert.equal(sample.status, 200);
    await ctx.admin.post(`/api/v1/admin/integrations/voices/${voice.id}/verify`, {
      revision: Number(voice.version),
      ownerIdentityVerified: true,
      providerRightsVerified: true,
      evidence: "Sandbox identity and provider-sharing evidence reviewed.",
    });
  });
}

async function setupRuntime(ctx: E2EContext, t: Client, plan: TrainerPlan, rules: any[]) {
  const missed = rules.find((r) => /missed-session/i.test(r.data.directive)) ?? rules[0];
  let action: any;
  await ctx.reporter.step(T, "Teaching cases (adaptive coaching questions)", `${plan.slug}: message teaching case confirmed`, async () => {
    const workspace = await t.get("/api/v1/brain/coaching-workspace");
    assert.ok(workspace.questions.length >= 1);
    await t.post("/api/v1/brain/teaching-cases", {
      scenario: "A busy parent missed a week of sessions and feels discouraged about restarting.",
      category: "message",
      recommendation: "Return on the next scheduled day with the normal plan; do not add extra sessions to catch up.",
      reason: "Consistency matters more than compensating for missed days.",
      alternatives: "Offer the shorter version of the next session if time is tight.",
      changeWhen: "If their available training days changed, review the schedule together first.",
      escalateWhen: "Escalate when the client mentions pain, illness or a medical reason for missing sessions.",
    });
  });
  await ctx.reporter.step(T, "Routine coaching actions (bounded automatic actions)", `${plan.slug}: bounded message action citing a confirmed rule`, async () => {
    action = await t.post("/api/v1/brain/coaching-actions", {
      title: "Missed week encouragement",
      type: "message",
      requestTerms: ["missed a week", "missed my sessions", "fell behind"],
      response: "No problem. Pick up the next scheduled session as planned; there is no need to make up the missed ones.",
      rationale: "Coach teaches returning on the next scheduled day rather than catching up.",
      evidenceIds: [missed.id],
      experience: ["beginner", "intermediate", "advanced"],
      requiredEquipment: [],
    });
    assert.equal(action.status, "confirmed");
  });
  if (!action) return;
  const facts = {
    profile: { experience: "beginner", daysPerWeek: 3, equipment: "Dumbbells", limitations: "None reported" },
    program: null,
    sets: [],
    nextSession: null,
    occupiedDates: [],
    currentDate: today(),
    activeWorkout: false,
  };
  const routine = [
    "I missed a week because of work travel. How do I restart?",
    "Honestly I fell behind after my cousin's wedding, where do I pick up?",
    "I missed my sessions during exams; should I double up now?",
    "Missed a week with a cold that has passed. Next step for training?",
    "I fell behind on the plan while moving house. What now?",
    "Kids were off school so I missed my sessions. Restart advice please.",
    "Travel again! I missed a week of workouts in Riyadh.",
    "Busy quarter end at the office and I fell behind. Should I catch up on Saturday?",
    "I missed my sessions for the holiday weekend. Do I repeat last week?",
    "We had guests and I missed a week. Is it fine to continue normally?",
    "Ramadan schedule means I fell behind a little. How to continue?",
    "I missed my sessions because my gym closed for renovation. What should I do?",
  ];
  const special = [
    { prompt: "I missed a week; can I deduct my coaching fees from tax this year?", category: "unsupported" },
    { prompt: "I fell behind and my employer asks about legal liability for gym injuries at work events.", category: "unsupported" },
    { prompt: "Can you recommend a good accountant for my small business?", category: "unsupported" },
    { prompt: "I have sharp pain in my knee after squats and it is getting worse.", category: "pain" },
    { prompt: "I had chest pain and shortness of breath during my last session.", category: "urgent" },
    { prompt: "I just found out I am pregnant, should I keep training the same way?", category: "pregnancy" },
    { prompt: "I have been feeling suicidal and cannot focus on anything.", category: "self_harm" },
    { prompt: "What is the capital city of Australia for my trivia night?", category: "unsupported" },
  ];
  await ctx.reporter.step(T, "Independent action checks (held-out cases)", `${plan.slug}: 20 held-out coaching cases incl. safety and unsupported`, async () => {
    for (const prompt of routine)
      await t.post("/api/v1/brain/coaching-scenarios", { prompt, expectedActionId: action.id, category: "routine", facts, heldOut: true });
    for (const s of special)
      await t.post("/api/v1/brain/coaching-scenarios", { ...s, expectedActionId: null, facts, heldOut: true });
  });
  await ctx.reporter.step(T, "Qualify and activate automatic coaching", `${plan.slug}: evaluation passes and automatic mode activates`, async () => {
    const evaluation = await t.post("/api/v1/brain/coaching-evaluate", {});
    assert.equal(evaluation.status, "passed", JSON.stringify(evaluation.data.outcomes.filter((o: any) => !o.passed)));
    const activated = await t.post("/api/v1/brain/coaching-activate", { evaluationId: evaluation.id, mode: "automatic", expectedReleaseId: null });
    assert.equal(activated.data.mode, "automatic");
    return `${evaluation.data.passed}/${evaluation.data.total}`;
  });
}

async function setupNutrition(ctx: E2EContext, t: Client, plan: TrainerPlan) {
  const cases: any[] = [];
  const recipes: any[] = [];
  let evaluationId = "";
  let previewId = "";
  await must(ctx, "Nutrition setup, teaching cases and text sources", `${plan.slug}: enable nutrition and answer every teaching category`, async () => {
    await t.put("/api/v1/nutrition/setup", { enabled: true, version: 0 });
    for (const { id: _ignored, ...c } of fixtureCases()) cases.push(await t.post("/api/v1/nutrition/cases", c));
    const coach = await t.get("/api/v1/nutrition/coach");
    assert.ok(coach.coverage.every((c: any) => c.covered));
  });
  await must(ctx, "Ingredients, recipes, shopping conversions and calorie methods", `${plan.slug}: foods and recipes`, async () => {
    const catalog = fixtureCatalog();
    const mapping = new Map<string, string>();
    for (const f of catalog.foods) {
      const { id: fid, ...value } = f;
      mapping.set(fid, (await t.post("/api/v1/nutrition/foods", { food: value })).id);
    }
    for (const recipe of catalog.recipes) {
      const { id: _rid, ...value } = recipe;
      value.variants.forEach((v) => v.ingredients.forEach((i) => (i.foodId = mapping.get(i.foodId)!)));
      recipes.push(await t.post("/api/v1/nutrition/recipes", { recipe: value }));
    }
  });
  await ctx.reporter.step(T, "AI recipe drafts and AI policy compilation", `${plan.slug}: model drafts a recipe and asks for missing policy numbers`, async () => {
    const draft = await t.post("/api/v1/nutrition/recipes/draft", { request: "A quick high-protein lunch bowl using my ingredients" });
    assert.ok(draft.recipe.variants[0].ingredients.length >= 1);
    const compiled = await t.post("/api/v1/nutrition/policy/compile", {});
    assert.equal(compiled.data.policy, null, "numeric targets are not invented");
    assert.ok(compiled.data.gaps.length >= 1);
  });
  await must(ctx, "Manual nutrition policy and held-out nutrition checks", `${plan.slug}: confirmed policy and 24 held-out checks`, async () => {
    const policy = await t.post("/api/v1/nutrition/policy", {
      policy: fixturePolicy(cases.map((c) => c.id)),
      reason: "Confirmed synthetic example policy for the sandbox",
    });
    await t.post(`/api/v1/nutrition/policy/${policy.id}/confirm`, {});
    for (let i = 0; i < 24; i++) {
      const c = cases[i % cases.length],
        exception = i >= 20;
      await t.post("/api/v1/nutrition/scenarios", {
        category: c.data.category,
        prompt: `[${c.data.category}] Unseen synthetic client situation ${i}; apply the available evidence.`,
        profile: { ...fixtureProfile, ...(exception ? { allergyStatus: "unknown" } : {}) },
        expect: exception ? "exception" : "plan",
        expectedTargetKcal: exception ? null : 1500,
        expectedCaseId: c.id,
        heldOut: true,
        expectedPrinciple: (principleForCategory as any)[c.data.category],
        ...(!exception
          ? { expectedMeal: { recipeIds: [recipes[0].id], slot: "Breakfast", minServings: 1, maxServings: 1 } }
          : {}),
      });
    }
  });
  await must(ctx, "Nutrition evaluation and sample-week preview", `${plan.slug}: evaluation passes and a sample week validates`, async () => {
    const evaluation = await t.post("/api/v1/nutrition/evaluate", {});
    assert.equal(evaluation.status, "passed", JSON.stringify(evaluation.data.outcomes.filter((o: any) => !o.passed)).slice(0, 1500));
    assert.equal(evaluation.data.verificationMode, "provider");
    evaluationId = evaluation.id;
    const preview = await t.post("/api/v1/nutrition/preview", { profile: fixtureProfile, weekStart: today() });
    assert.equal(preview.data.view.days.length, 7);
    previewId = preview.id;
    return `${evaluation.data.passed}/${evaluation.data.total} checks`;
  });
  await must(ctx, "Activate automatic nutrition delivery", `${plan.slug}: release with a fresh authenticator code`, async () => {
    await t.stepUp();
    const release = await t.post("/api/v1/nutrition/releases", { evaluationId, previewId, confirmed: true });
    assert.equal(release.data.mode, "automatic_with_exceptions");
    assert.equal((await t.get("/api/v1/nutrition/coach")).ready, true);
  });
}

export async function trainerScenarios(ctx: E2EContext) {
  await trainerFlows(ctx);
}
