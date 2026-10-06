import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp, processStripeEvent } from "../apps/api/src/app.ts";
import {
  fixtureCases,
  fixturePolicy,
  fixtureCatalog,
  fixtureProfile,
  fixtureWeek,
} from "./nutrition-fixtures.ts";
import {
  NutritionBlocked,
  nutritionCategories,
  nutritionQuestions,
  nutritionTarget,
  recipeCompatibility,
  validateNutritionWeek,
  localDate,
  dateOffset,
  type Food,
} from "../packages/domain/src/nutrition.ts";
import {
  heldOutSimilarity,
  heldOutOverlaps,
  principleForCategory,
  staleHeldOut,
} from "../packages/domain/src/nutrition-learning.ts";

let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  owner: any,
  subscriber: any,
  foods: any[] = [],
  recipes: any[] = [],
  cases: any[] = [],
  scenarios: any[] = [],
  evaluation: any,
  plan: any;
const today = localDate("Asia/Dubai"),
  origin = "http://localhost:3000",
  originalFetch = globalThis.fetch;
const envKeys = [
  "MODEL_BASE_URL",
  "MODEL_API_KEY",
  "MODEL_NAME",
  "MODEL_PRICE_VERSION",
  "MODEL_INPUT_USD_PER_MILLION",
  "MODEL_OUTPUT_USD_PER_MILLION",
  "MODEL_MAX_DAILY_CALLS",
];
const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
let modelCalls = 0,
  weekExplanation: string | null = null,
  weekUnusable = false;
async function req(
  path: string,
  method: any = "GET",
  body?: any,
  as: any = owner,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    headers: { origin, ...(as?.cookie ? { cookie: as.cookie } : {}) },
    payload: body,
  });
}
async function ok(path: string, method: any = "GET", body?: any, as?: any) {
  const r = await req(path, method, body, as);
  assert.ok(r.statusCode < 300, r.body);
  return r.json();
}
async function register(slug: string) {
  const r = await req(
    "/auth/register",
    "POST",
    {
      name: slug,
      email: slug + "@example.test",
      password: "NutritionSafety2026!",
      slug,
      accepted: true,
    },
    {},
  );
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return {
    ...(await ok("/bootstrap", "GET", undefined, { cookie })).user,
    cookie,
  };
}
function evaluationAnswer(input: any) {
  return {
    decisions: input.scenarios.map((s: any) => {
      let target = null;
      try {
        target = nutritionTarget(input.policy, s.profile);
      } catch {}
      const category =
          nutritionCategories.find((c) => s.prompt.includes("[" + c + "]")) ??
          "diet",
        teaching = input.cases.find((c: any) => c.data.category === category),
        recipe = input.recipes.find((r: any) =>
          r.slots.includes(s.requestedMealSlot),
        ),
        variant = recipe.variants.find((v: any) => v.key === "hob");
      const nutrients = Object.fromEntries(
        ["kcal", "protein", "carbohydrate", "fat"].map((key) => [
          key,
          variant.ingredients.reduce(
            (sum: number, i: any) =>
              sum +
              (input.foods.find((f: any) => f.id === i.foodId).nutrientsPer100g[
                key
              ] *
                i.grams) /
                100,
            0,
          ),
        ]),
      );
      return {
        scenarioId: s.id,
        action: target === null ? "exception" : "plan",
        targetKcal: target,
        caseIds: [teaching.id],
        reason: "Applies the confirmed synthetic fixture policy.",
        principle: principleForCategory[category],
        rationaleEvidence: { caseId: teaching.id, quote: teaching.data.reason },
        sampleMeal:
          target === null
            ? null
            : {
                slot: s.requestedMealSlot,
                recipeId: recipe.id,
                variantKey: variant.key,
                servings: 1,
                ingredients: variant.ingredients,
                nutrients,
              },
      };
    }),
  };
}
before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  owner = await register("nutrition-safety-coach");
  const invite = await ok("/invitations", "POST", {
    email: "nutrition-safety-client@example.test",
    role: "subscriber",
  });
  const r = await req(
    "/invitations/accept",
    "POST",
    {
      token: invite.url.split("/").pop(),
      name: "Nutrition Safety Client",
      email: "nutrition-safety-client@example.test",
      password: "NutritionSafety2026!",
      accepted: true,
    },
    {},
  );
  assert.equal(r.statusCode, 200, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  subscriber = {
    ...(await ok("/bootstrap", "GET", undefined, { cookie })).user,
    cookie,
  };
  Object.assign(process.env, {
    MODEL_BASE_URL: "https://nutrition-safety.invalid/v1",
    MODEL_API_KEY: "synthetic-fixture-key",
    MODEL_NAME: "nutrition-safety-fixture",
    MODEL_PRICE_VERSION: "fixture-v1",
    MODEL_INPUT_USD_PER_MILLION: "1",
    MODEL_OUTPUT_USD_PER_MILLION: "2",
    MODEL_MAX_DAILY_CALLS: "100",
  });
  globalThis.fetch = async (_url, options) => {
    modelCalls++;
    const body = JSON.parse(String(options?.body)),
      { task, input } = JSON.parse(body.messages[1].content);
    let output: any;
    if (task === "nutrition_evaluation") output = evaluationAnswer(input);
    else if (task === "nutrition_week") {
      output = weekUnusable
        ? { days: [] }
        : fixtureWeek(
            input.recipes,
            input.cases.map((c: any) => c.id),
          );
      if (weekExplanation) output.explanation = weekExplanation;
    } else throw new Error("Unexpected model task " + task);
    return new Response(
      JSON.stringify({
        id: "fixture-request-" + modelCalls,
        choices: [{ message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 200, completion_tokens: 100 },
      }),
      { status: 200 },
    );
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const k of envKeys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await app.close();
  await db.close();
});

test("scope screening routes English and Arabic clinical free text to review without false positives", () => {
  const policy = fixturePolicy([randomUUID()]);
  for (const change of [
    { notes: "I have type 2 diabetes" },
    { notes: "Taking metformin twice a day" },
    { notes: "I use insulin in the evening" },
    { notes: "Diagnosed with kidney disease last year" },
    { notes: "History of an eating disorder" },
    { notes: "I am pregnant" },
    { notes: "Currently breastfeeding" },
    { notes: "أنا حامل" },
    { notes: "عندي السكري" },
    { notes: "أم مرضع" },
    { notes: "مشاكل في الكلى" },
    { goal: "manage diabetes" },
    { exclusions: ["low potassium for dialysis"] },
  ])
    assert.throws(
      () => nutritionTarget(policy, { ...fixtureProfile, ...change }),
      (e: any) => e instanceof NutritionBlocked && e.code === "SCOPE_REVIEW",
      JSON.stringify(change),
    );
  for (const notes of [
    "Sugar-free drinks, kidney beans, chicken breast and chicken liver",
    "بدون سكر ومشروبات سكرية قليلة",
    "أحب حمل الأثقال وأكل سرطان البحر",
    "Medicine ball circuits and cardio, heart rate zone 2",
  ])
    assert.equal(nutritionTarget(policy, { ...fixtureProfile, notes }), 1500);
});

test("allergen matching uses food names, ingredient tags and derived terms", () => {
  const c = fixtureCatalog(),
    policy = fixturePolicy([randomUUID()]),
    recipe = c.recipes[0],
    base = c.foods[0];
  const check = (food: Partial<Food>, allergens: string[]) =>
    recipeCompatibility(
      recipe,
      recipe.variants[0],
      new Map([[base.id, { ...base, ingredientTags: [], ...food }]]),
      { ...fixtureProfile, allergyStatus: "reported", allergens },
      policy,
    );
  const conflict = "Reported allergen conflict";
  assert.equal(check({ name: "Peanut butter" }, ["peanut"]), conflict);
  assert.equal(
    check({ name: "Recovery shake", allergens: ["whey"] }, ["milk"]),
    conflict,
  );
  assert.equal(check({ name: "Tahini sauce" }, ["sesame"]), conflict);
  assert.equal(
    check({ name: "Grain bowl", ingredientTags: ["semolina"] }, ["gluten"]),
    conflict,
  );
  assert.equal(check({ name: "Clarified ghee" }, ["dairy"]), conflict);
  assert.equal(check({ name: "Mixed nut butter" }, ["peanut"]), conflict);
  assert.equal(check({ name: "صلصة الطحينة" }, ["سمسم"]), conflict);
  assert.equal(check({ name: "Roasted eggplant" }, ["egg"]), null);
  assert.equal(check({ name: "Butternut squash" }, ["nuts"]), null);
  assert.equal(check({ name: "Oat mixture" }, ["milk"]), null);
});

test("model explanations are shown only after deterministic content checks", () => {
  const c = fixtureCatalog(),
    policy = fixturePolicy([randomUUID()]),
    extra = { ...c.recipes[2], id: randomUUID(), name: "Lamb tagine" },
    view = (explanation: string) =>
      validateNutritionWeek({
        week: { ...fixtureWeek(c.recipes, policy.sourceIds), explanation },
        policy,
        profile: fixtureProfile,
        foods: c.foods,
        recipes: [...c.recipes, extra],
        caseIds: policy.sourceIds,
        weekStart: today,
      });
  const safe = view(
    "About 1500 kcal a day; the Warm breakfast bowl starts each morning.",
  );
  assert.equal(
    safe.explanation,
    "About 1500 kcal a day; the Warm breakfast bowl starts each morning.",
  );
  assert.deepEqual(safe.explanationCheck, { accepted: true, issues: [] });
  for (const [text, issue] of [
    [
      "Take 500 mg metformin before breakfast, see http://x.test",
      "clinical_or_supplement_advice",
    ],
    ["Add a daily vitamin D supplement.", "clinical_or_supplement_advice"],
    ["Message me on +971 50 123 4567 with questions.", "link_or_contact"],
    ["This week gives you about 2200 kcal a day.", "calorie_mismatch"],
    ["Swap dinner for the Lamb tagine when you like.", "recipe_outside_plan"],
  ]) {
    const v = view(text);
    assert.notEqual(v.explanation, text);
    assert.match(v.explanation, /about 1500 kcal a day/);
    assert.equal(v.explanationCheck.accepted, false);
    assert.ok(v.explanationCheck.issues.includes(issue), text);
  }
});

test("held-out independence, staleness and similarity helpers are deterministic", () => {
  assert.equal(
    heldOutSimilarity(
      "Client wants three vegetarian meals in 30 minutes",
      "client wants three vegetarian meals in 30 minutes!",
    ),
    1,
  );
  assert.ok(
    heldOutSimilarity(
      "Client wants three vegetarian meals in 30 minutes",
      "Client wants four vegetarian meals in 30 minutes",
    ) >= 0.6,
  );
  assert.ok(
    heldOutSimilarity(
      "Client wants three vegetarian meals in 30 minutes",
      "A shift worker asks how to split dinner across two late breaks",
    ) < 0.6,
  );
  const taught = {
    id: randomUUID(),
    data: {
      scenario: "Client wants three vegetarian meals in 30 minutes",
      recommendation: "Use batch cooked lentils.",
    },
  };
  assert.deepEqual(
    heldOutOverlaps("CLIENT wants three vegetarian meals, in 30 minutes.", [
      taught,
    ]),
    [taught.id],
  );
  const c = fixtureCatalog(),
    caseId = randomUUID(),
    policy = fixturePolicy([caseId]),
    plan = (data: any) => ({
      id: randomUUID(),
      data: {
        category: "portions",
        prompt: "[portions] check",
        profile: fixtureProfile,
        expect: "plan",
        expectedTargetKcal: 1500,
        expectedCaseId: caseId,
        expectedMeal: {
          recipeIds: [c.recipes[0].id],
          slot: "Breakfast",
          minServings: 1,
          maxServings: 1,
        },
        ...data,
      },
    });
  const valid = plan({}),
    retiredCase = plan({ expectedCaseId: randomUUID() }),
    wrongTarget = plan({ expectedTargetKcal: 1800 }),
    retiredRecipe = plan({
      expectedMeal: {
        recipeIds: [randomUUID()],
        slot: "Breakfast",
        minServings: 1,
        maxServings: 1,
      },
    }),
    nowScope = plan({ profile: { ...fixtureProfile, notes: "pregnant" } });
  const stale = staleHeldOut(
    [valid, retiredCase, wrongTarget, retiredRecipe, nowScope],
    [{ id: caseId }],
    policy,
    c,
  );
  assert.deepEqual(
    stale.map((s) => s.scenarioId),
    [retiredCase.id, wrongTarget.id, retiredRecipe.id, nowScope.id],
  );
  assert.ok(stale.every((s) => s.reasons.length > 0));
});

test("setup rejects unrecognised food allergen tags", async () => {
  const product = await ok("/products", "POST", {
    name: "Workout only",
    description: "Training",
    priceMinor: 15000,
  });
  const combined = await ok("/products", "POST", {
    name: "Workout plus nutrition",
    description: "Training and meals",
    priceMinor: 22000,
    tier: "workout_nutrition",
    baseProductId: product.id,
  });
  await db.tenant(owner, (tx) =>
    tx.query(
      "UPDATE records SET status='published',data=data||$2::jsonb WHERE id=$1",
      [combined.id, JSON.stringify({ stripePriceId: "price_safety_fixture" })],
    ),
  );
  await processStripeEvent(db, {
    id: "evt_nutrition_safety_access",
    type: "customer.subscription.created",
    created: 100,
    data: {
      object: {
        id: "sub_nutrition_safety",
        object: "subscription",
        status: "active",
        current_period_end: Math.floor(Date.now() / 1000) + 2592000,
        items: { data: [{ price: { id: "price_safety_fixture" } }] },
        metadata: { tenant_id: owner.tenantId, user_id: subscriber.userId },
      },
    },
  });
  await ok("/nutrition/setup", "PUT", { enabled: true, version: 0 });
  for (const { id: _, ...c } of fixtureCases())
    cases.push(await ok("/nutrition/cases", "POST", c));
  const catalog = fixtureCatalog(),
    mapping = new Map<string, string>();
  const bad = await req("/nutrition/foods", "POST", {
    food: { ...catalog.foods[0], id: undefined, allergens: ["whey-ish"] },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().code, "ALLERGEN_TAG");
  for (const f of catalog.foods) {
    const { id: fid, ...value } = f;
    const row = await ok("/nutrition/foods", "POST", { food: value });
    mapping.set(fid, row.id);
    foods.push(row);
  }
  for (const recipe of catalog.recipes) {
    const { id: _, ...value } = recipe;
    value.variants.forEach((v) =>
      v.ingredients.forEach((i) => (i.foodId = mapping.get(i.foodId)!)),
    );
    recipes.push(await ok("/nutrition/recipes", "POST", { recipe: value }));
  }
  await confirmPolicy();
});
async function confirmPolicy() {
  const current = (await ok("/nutrition/coach")).cases.map((c: any) => c.id);
  const r = await ok("/nutrition/policy", "POST", {
    policy: fixturePolicy(current),
    reason: "Confirmed synthetic example policy",
  });
  await ok("/nutrition/policy/" + r.id + "/confirm", "POST", {});
}
function scenario(i: number, c = cases[i % cases.length]) {
  const exception = i % 10 === 9;
  return {
    category: c.data.category,
    prompt: `[${c.data.category}] Independent synthetic client check ${i}; apply the available evidence.`,
    profile: {
      ...fixtureProfile,
      ...(exception ? { allergyStatus: "unknown" } : {}),
    },
    expect: exception ? "exception" : "plan",
    expectedTargetKcal: exception ? null : 1500,
    expectedCaseId: c.id,
    heldOut: true,
    expectedPrinciple: principleForCategory[c.data.category],
    ...(exception
      ? {}
      : {
          expectedMeal: {
            recipeIds: [recipes[0].id],
            slot: "Breakfast",
            minServings: 1,
            maxServings: 1,
          },
        }),
  };
}

test("held-out prompts must differ from every confirmed case and from existing checks", async () => {
  const [diet, calories] = cases;
  assert.equal(diet.data.scenario, nutritionQuestions.diet);
  for (const prompt of [
    diet.data.scenario.toUpperCase() + "!!",
    diet.data.scenario.replace("practical", "simple"),
    diet.data.recommendation,
  ]) {
    // Copies are rejected even when a different case is the expected answer.
    const r = await req("/nutrition/scenarios", "POST", {
      ...scenario(0, calories),
      prompt,
    });
    assert.equal(r.statusCode, 400, prompt);
    assert.equal(r.json().code, "HELD_OUT_REQUIRED");
  }
  scenarios.push(await ok("/nutrition/scenarios", "POST", scenario(0)));
  const duplicate = await req("/nutrition/scenarios", "POST", {
    ...scenario(0),
    prompt: scenario(0).prompt.toLowerCase(),
  });
  assert.equal(duplicate.statusCode, 400);
  assert.equal(duplicate.json().code, "HELD_OUT_DUPLICATE");
});

test("held-out checks are capped so every active check is evaluated", async () => {
  for (let i = 1; i < 40; i++)
    scenarios.push(await ok("/nutrition/scenarios", "POST", scenario(i)));
  const over = await req("/nutrition/scenarios", "POST", scenario(40));
  assert.equal(over.statusCode, 409);
  assert.equal(over.json().code, "HELD_OUT_LIMIT");
  const retired = scenarios.pop();
  await ok(`/nutrition/scenarios/${retired.id}/archive`, "POST", {
    version: retired.version,
    reason: "Replaced by a clearer independent check",
  });
  scenarios.push(await ok("/nutrition/scenarios", "POST", scenario(40)));
  assert.equal((await ok("/nutrition/learning")).scenarios.length, 40);
});

test("checks stranded by a case edit are flagged before a paid evaluation", async () => {
  const edited = cases[2];
  const replacement = await ok("/nutrition/cases/" + edited.id, "PATCH", {
    version: edited.version,
    answer: {
      ...fixtureCases()[2],
      id: undefined,
      recommendation:
        "A corrected synthetic portion recommendation with a different teaching explanation.",
    },
  });
  cases[2] = replacement;
  await confirmPolicy();
  const linked = scenarios
    .filter((s) => s.data.expectedCaseId === edited.id)
    .map((s) => s.id)
    .sort();
  assert.ok(linked.length > 0);
  const coach = await ok("/nutrition/coach");
  assert.deepEqual(
    coach.staleScenarios.map((s: any) => s.scenarioId).sort(),
    linked,
  );
  const costs = async () =>
    (
      await db.tenant(owner, (tx) =>
        tx.query(
          "SELECT count(*)::int AS n FROM cost_events WHERE task='nutrition_evaluation'",
        ),
      )
    )[0].n;
  const before = { calls: modelCalls, costs: await costs() };
  const r = await req("/nutrition/evaluate", "POST", {});
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "HELD_OUT_STALE");
  for (const scenarioId of linked)
    assert.match(r.json().message, new RegExp(scenarioId));
  assert.equal(modelCalls, before.calls);
  assert.equal(await costs(), before.costs);
  for (const s of scenarios.filter((x) => linked.includes(x.id)))
    await ok(`/nutrition/scenarios/${s.id}/archive`, "POST", {
      version: s.version,
      reason: "Teaching case was corrected; replacing this check",
    });
  let n = 100;
  for (const _ of linked)
    scenarios.push(
      await ok("/nutrition/scenarios", "POST", scenario(n++, replacement)),
    );
  evaluation = await ok("/nutrition/evaluate", "POST", {});
  assert.equal(evaluation.status, "passed");
  assert.equal(evaluation.data.total, 44);
});

test("clinical notes skip automatic delivery and unsafe model explanations never reach the client", async () => {
  const preview = await ok("/nutrition/preview", "POST", {
    profile: fixtureProfile,
    weekStart: today,
  });
  await ok("/nutrition/releases", "POST", {
    evaluationId: evaluation.id,
    previewId: preview.id,
    confirmed: true,
  });
  await ok(
    "/nutrition/profile",
    "POST",
    {
      profile: { ...fixtureProfile, notes: "أنا حامل في الشهر الرابع" },
      processingConsent: true,
      modelConsent: true,
      version: 0,
    },
    subscriber,
  );
  const calls = modelCalls;
  const blocked = await ok(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: today },
    subscriber,
  );
  assert.equal(blocked.status, "exception");
  assert.equal(blocked.code, "SCOPE_REVIEW");
  assert.equal(modelCalls, calls);
  await ok(
    "/nutrition/profile",
    "POST",
    {
      profile: fixtureProfile,
      processingConsent: true,
      modelConsent: true,
      version: 1,
    },
    subscriber,
  );
  weekExplanation = "Take 500 mg metformin before breakfast, see http://x.test";
  const result = await ok(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: today },
    subscriber,
  );
  weekExplanation = null;
  plan = result.plan;
  assert.equal(plan.status, "delivered");
  for (const text of [
    plan.data.view.explanation,
    plan.data.choices.explanation,
  ]) {
    assert.doesNotMatch(text, /metformin|http|500 mg/i);
    assert.match(text, /about 1500 kcal a day/);
  }
  assert.equal(plan.data.view.explanationCheck.accepted, false);
});

test("an eating-related red flag in a check-in or meal-log note stops automatic meal weeks until the coach resolves it", async () => {
  // Model trial review: meal weeks screened only the food profile, so a
  // member who wrote "I've been making myself sick after meals" in a check-in
  // still received automatic weeks. The check is made before any model call.
  const weekStart = dateOffset(today, 14);
  const generate = () =>
    ok(
      "/nutrition/generate",
      "POST",
      { requestKey: randomUUID(), weekStart },
      subscriber,
    );
  const openScopeReview = async () =>
    (await ok("/nutrition/coach")).records.find(
      (r: any) =>
        r.kind === "nutrition_exception" &&
        r.status === "open" &&
        r.data.code === "SCOPE_REVIEW" &&
        r.owner_user_id === subscriber.userId,
    );
  const resolve = async () => {
    const e = await openScopeReview();
    assert.ok(e, "an open SCOPE_REVIEW exception for the coach");
    await ok(`/nutrition/exceptions/${e.id}/resolve`, "POST", {
      resolution:
        "Spoke with the client; referred to their GP and agreed next steps.",
    });
  };
  await ok(
    "/nutrition/checkins",
    "POST",
    {
      eventKey: randomUUID(),
      date: today,
      hunger: 4,
      difficulty: 2,
      weightKg: null,
      notes: "I've been making myself sick after meals",
    },
    subscriber,
  );
  let calls = modelCalls;
  let blocked = await generate();
  assert.equal(blocked.status, "exception");
  assert.equal(blocked.code, "SCOPE_REVIEW");
  assert.doesNotMatch(blocked.message, /sick|meals/);
  assert.equal(modelCalls, calls);
  await resolve();
  // A meal-log note, in Gulf Arabic, after the resolution stops the next attempt again.
  await ok(
    "/nutrition/logs",
    "POST",
    {
      eventKey: randomUUID(),
      date: today,
      timezone: "Asia/Dubai",
      name: "Lunch",
      notes: "آكل ٥٠٠ سعرة باليوم بس عشان أنزل وزن",
      kcal: 250,
    },
    subscriber,
  );
  blocked = await generate();
  assert.equal(blocked.code, "SCOPE_REVIEW");
  assert.equal(modelCalls, calls);
  await resolve();
  // Once the coach has resolved it, the reviewed notes no longer stop the
  // week, and neither does a routine note written after the resolution: the
  // request reaches the model (whose unusable answer is not delivered).
  await ok(
    "/nutrition/checkins",
    "POST",
    {
      eventKey: randomUUID(),
      date: today,
      hunger: 3,
      difficulty: 3,
      weightKg: null,
      notes: "Busy week, skipped breakfast once. Felt fine.",
    },
    subscriber,
  );
  weekUnusable = true;
  const next = await generate();
  weekUnusable = false;
  assert.ok(modelCalls > calls, "the reviewed notes no longer block");
  assert.equal(next.status, "exception");
  assert.notEqual(next.code, "SCOPE_REVIEW");
  const resolved = (await ok("/nutrition/coach")).records.filter(
    (r: any) =>
      r.kind === "nutrition_exception" &&
      r.status === "resolved" &&
      r.data.code === "SCOPE_REVIEW",
  );
  assert.ok(resolved.length >= 2);
  for (const r of resolved)
    assert.ok(
      !Number.isNaN(Date.parse(r.data.resolvedAt)),
      "resolvedAt is recorded",
    );
});

test("retiring an unsafe food or recipe flags current and future delivered weeks for coach review", async () => {
  // A previous health hold must not hide a later catalog withdrawal.
  await db.tenant(owner, tx => tx.query("UPDATE records SET status='needs_recheck' WHERE id=$1", [plan.id]));
  const insertPlan = (weekStart: string) =>
    db.tenant(owner, (tx) =>
      putRecord(
        tx,
        owner,
        "nutrition_plan",
        {
          ...plan.data,
          weekStart,
          view: {
            ...plan.data.view,
            weekStart,
            weekEnd: dateOffset(weekStart, 6),
          },
        },
        { ownerId: subscriber.userId, status: "delivered" },
      ),
    );
  const past = await insertPlan(dateOffset(today, -14));
  const { id: _, ...unsafe } = foods[0];
  await ok("/nutrition/foods", "POST", {
    food: { ...unsafe, allergens: ["sesame"] },
    supersedesId: foods[0].id,
  });
  const status = async () => {
    const d = await ok("/nutrition", "GET", undefined, subscriber);
    return {
      plans: new Map(
        d.records
          .filter((r: any) => r.kind === "nutrition_plan")
          .map((r: any) => [r.id, r]),
      ) as Map<string, any>,
      exceptions: d.exceptions.map((e: any) => e.code),
    };
  };
  let s = await status();
  assert.equal(s.plans.get(plan.id).status, "needs_recheck");
  assert.equal(s.plans.get(past.id).status, "delivered");
  assert.deepEqual(
    s.exceptions.filter((c: string) => c === "CATALOG_RETIRED"),
    ["CATALOG_RETIRED"],
  );
  assert.ok(
    (await ok("/nutrition/coach")).records.some(
      (r: any) =>
        r.kind === "nutrition_exception" &&
        r.status === "open" &&
        r.data.code === "CATALOG_RETIRED" &&
        r.owner_user_id === subscriber.userId,
    ),
  );
  const future = await insertPlan(dateOffset(today, 7));
  await ok(`/nutrition/catalog/recipe/${recipes[2].id}/archive`, "POST", {
    archived: true,
    reason: "Recipe withdrawn after an allergen was found",
  });
  s = await status();
  assert.equal(s.plans.get(future.id).status, "needs_recheck");
  assert.equal(s.plans.get(past.id).status, "delivered");
  assert.equal(
    s.exceptions.filter((c: string) => c === "CATALOG_RETIRED").length,
    1,
  );
  const invalidated = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT subject_id,data FROM events WHERE name='nutrition.plan_invalidated' ORDER BY created_at",
    ),
  );
  assert.deepEqual(
    invalidated.map((e) => [e.subject_id, e.data.entityKind, e.data.entityId]).sort(),
    [
      [plan.id, "food", foods[0].id],
      [plan.id, "recipe", recipes[2].id],
      [future.id, "recipe", recipes[2].id],
    ].sort(),
  );
});
