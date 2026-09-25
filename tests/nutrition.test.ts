import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database, putRecord } from "@trainer/db";
import { buildApp, processStripeEvent } from "../apps/api/src/app.ts";
import {
  scheduleNutrition,
  executeNutritionJob,
} from "../apps/api/src/nutrition-schedule.ts";
import {
  fixtureCases,
  fixturePolicy,
  fixtureCatalog,
  fixtureProfile,
  fixtureWeek,
} from "./nutrition-fixtures.ts";
import {
  scaledNutrients,
  validateNutritionWeek,
  nutritionTarget,
  localDate,
  dateOffset,
  nutritionSummary,
  nutritionCategories,
} from "../packages/domain/src/nutrition.ts";
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  owner: any,
  subscriber: any,
  other: any,
  food: any,
  recipes: any[] = [],
  cases: any[] = [],
  policy: any,
  preview: any,
  evaluation: any,
  release: any,
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
  delay: undefined | (() => Promise<void>),
  invalid = false;
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
      password: "NutritionFixture2026!",
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
before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  owner = await register("nutrition-coach");
  other = await register("other-nutrition-coach");
  const invite = await ok("/invitations", "POST", {
    email: "nutrition-client@example.test",
    role: "subscriber",
  });
  const r = await req(
    "/invitations/accept",
    "POST",
    {
      token: invite.url.split("/").pop(),
      name: "Nutrition Client",
      email: "nutrition-client@example.test",
      password: "NutritionFixture2026!",
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
    MODEL_BASE_URL: "https://nutrition-fixture.invalid/v1",
    MODEL_API_KEY: "synthetic-fixture-key",
    MODEL_NAME: "nutrition-fixture",
    MODEL_PRICE_VERSION: "fixture-v1",
    MODEL_INPUT_USD_PER_MILLION: "1",
    MODEL_OUTPUT_USD_PER_MILLION: "2",
    MODEL_MAX_DAILY_CALLS: "100",
  });
  globalThis.fetch = async (_url, options) => {
    assert.equal(
      String(_url),
      "https://nutrition-fixture.invalid/v1/chat/completions",
    );
    modelCalls++;
    if (delay) await delay();
    const body = JSON.parse(String(options?.body)),
      { task, input } = JSON.parse(body.messages[1].content);
    let output: any;
    if (task === "nutrition_evaluation")
      output = {
        decisions: input.scenarios.map((s: any) => {
          let target = null;
          try {
            target = nutritionTarget(input.policy, s.profile);
          } catch {}
          const category =
            nutritionCategories.find((c) => s.prompt.includes("[" + c + "]")) ??
            "diet";
          return {
            scenarioId: s.id,
            action: target === null ? "exception" : "plan",
            targetKcal: target,
            caseIds: [
              input.cases.find((c: any) => c.data.category === category).id,
            ],
            reason: "Applies the confirmed synthetic fixture policy.",
          };
        }),
      };
    else if (task === "nutrition_week")
      output = fixtureWeek(
        input.recipes,
        input.cases.map((c: any) => c.id),
      );
    else throw new Error("Unexpected model task " + task);
    return new Response(
      JSON.stringify({
        id: "fixture-request-" + modelCalls,
        choices: [
          {
            message: {
              content: invalid ? "invalid JSON" : JSON.stringify(output),
            },
          },
        ],
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

test("nutrition decimal quantities, unknown nutrients and portion/grocery consistency", () => {
  const c = fixtureCatalog(),
    p = fixturePolicy([randomUUID()]),
    week = fixtureWeek(c.recipes, p.sourceIds);
  assert.equal(
    scaledNutrients([{ food: c.foods[0], grams: 250 }], 2).kcal,
    500,
  );
  const unknown = structuredClone(c.foods[0]);
  unknown.nutrientsPer100g.protein = null;
  assert.equal(
    scaledNutrients([{ food: unknown, grams: 100 }], 1).protein,
    null,
  );
  const view = validateNutritionWeek({
    week,
    policy: p,
    profile: fixtureProfile,
    ...c,
    caseIds: p.sourceIds,
    weekStart: today,
  });
  assert.equal(view.days.length, 7);
  assert.equal(view.days[0].totals.kcal, 1500);
  assert.deepEqual(
    view.groceries.map((g) => g.grams).sort(),
    [2800, 3850, 3850],
  );
  const bad = structuredClone(week);
  bad.days[1].offset = 0;
  assert.throws(() =>
    validateNutritionWeek({
      week: bad,
      policy: p,
      profile: fixtureProfile,
      ...c,
      caseIds: p.sourceIds,
      weekStart: today,
    }),
  );
});
test("ingredient, preparation, equipment, calorie and scope conflicts cannot pass a weekly plan", () => {
  const c = fixtureCatalog(),
    p = fixturePolicy([randomUUID()]),
    week = fixtureWeek(c.recipes, p.sourceIds);
  for (const profile of [
    { ...fixtureProfile, allergyStatus: "unknown" },
    { ...fixtureProfile, scopeStatus: "specialist_needed" },
    { ...fixtureProfile, equipment: [] },
    { ...fixtureProfile, exclusions: [c.foods[0].name.toLowerCase()] },
  ])
    assert.throws(() =>
      validateNutritionWeek({
        week,
        policy: p,
        profile: profile as any,
        ...c,
        caseIds: p.sourceIds,
        weekStart: today,
      }),
    );
  const bad = structuredClone(week);
  bad.days[0].meals[0].servings = 2;
  assert.throws(() =>
    validateNutritionWeek({
      week: bad,
      policy: p,
      profile: fixtureProfile,
      ...c,
      caseIds: p.sourceIds,
      weekStart: today,
    }),
  );
});
test("allergen aliases and unfamiliar ingredient restrictions fail safely", () => {
  const c = fixtureCatalog(),
    p = fixturePolicy([randomUUID()]),
    week = fixtureWeek(c.recipes, p.sourceIds);
  c.foods[0].allergens = ["peanuts"];
  for (const allergen of ["peanut", "nuts", "unidentified seed"]) {
    assert.throws(() =>
      validateNutritionWeek({
        week,
        policy: p,
        profile: {
          ...fixtureProfile,
          allergyStatus: "reported",
          allergens: [allergen],
        },
        ...c,
        caseIds: p.sourceIds,
        weekStart: today,
      }),
    );
  }
});
test("two tiers preserve legacy access and enforce a higher combined price", async () => {
  const workout = await ok("/products", "POST", {
    name: "Workout only",
    description: "Training",
    priceMinor: 15000,
  });
  assert.deepEqual(workout.data.modules, ["training"]);
  assert.equal(
    (
      await req("/products", "POST", {
        name: "Combined",
        description: "Both",
        priceMinor: 15000,
        tier: "workout_nutrition",
        baseProductId: workout.id,
      })
    ).statusCode,
    400,
  );
  const combined = await ok("/products", "POST", {
    name: "Workout plus nutrition",
    description: "Training and meals",
    priceMinor: 22000,
    tier: "workout_nutrition",
    baseProductId: workout.id,
  });
  await db.tenant(owner, (tx) =>
    tx.query(
      "UPDATE records SET status='published',data=data||$2::jsonb WHERE id=$1",
      [
        combined.id,
        JSON.stringify({ stripePriceId: "price_nutrition_fixture" }),
      ],
    ),
  );
  await processStripeEvent(db, {
    id: "evt_nutrition_access",
    type: "customer.subscription.created",
    created: 100,
    data: {
      object: {
        id: "sub_nutrition_fixture",
        object: "subscription",
        status: "active",
        current_period_end: Math.floor(Date.now() / 1000) + 2592000,
        items: { data: [{ price: { id: "price_nutrition_fixture" } }] },
        metadata: {
          tenant_id: owner.tenantId,
          user_id: subscriber.userId,
          modules: "untrusted",
        },
      },
    },
  });
  assert.equal(
    (await ok("/nutrition", "GET", undefined, subscriber)).entitled,
    true,
  );
});
test("case-based onboarding persists, branches dynamically, and rejects stale setup", async () => {
  const s = await ok("/nutrition/setup", "PUT", { enabled: true, version: 0 });
  assert.equal(
    (await req("/nutrition/setup", "PUT", { enabled: true, version: 0 }))
      .statusCode,
    409,
  );
  assert.equal((await ok("/onboarding")).steps.length, 22);
  for (const { id: ignored, ...c } of fixtureCases())
    cases.push(await ok("/nutrition/cases", "POST", c));
  const d = await ok("/nutrition/coach");
  assert.ok(d.coverage.every((c: any) => c.covered));
  assert.ok(d.gaps.length > 0);
  assert.equal(
    (await req("/nutrition/cases", "POST", cases[0].data, subscriber))
      .statusCode,
    403,
  );
  assert.equal(
    (await req("/nutrition/coach", "GET", undefined, subscriber)).statusCode,
    403,
  );
  assert.equal(
    (await ok("/nutrition/coach", "GET", undefined, other)).cases.length,
    0,
  );
});
test("food and recipe facts are tenant-scoped and immutable; policy needs own teaching", async () => {
  const catalog = fixtureCatalog(),
    mapping = new Map<string, string>();
  for (const f of catalog.foods) {
    const { id: fid, ...value } = f;
    const row = await ok("/nutrition/foods", "POST", { food: value });
    mapping.set(fid, row.id);
    if (!food) food = row;
  }
  for (const recipe of catalog.recipes) {
    const { id: rid, ...value } = recipe;
    value.variants.forEach((v) =>
      v.ingredients.forEach((i) => (i.foodId = mapping.get(i.foodId)!)),
    );
    recipes.push(await ok("/nutrition/recipes", "POST", { recipe: value }));
  }
  await assert.rejects(
    db.tenant(owner, (tx) =>
      tx.query("UPDATE nutrition_foods SET name='Mutated' WHERE id=$1", [
        food.id,
      ]),
    ),
  );
  assert.equal(
    (await db.tenant(other, (tx) => tx.query("SELECT * FROM nutrition_foods")))
      .length,
    0,
  );
  assert.equal(
    (
      await db.tenant(subscriber, (tx) =>
        tx.query("SELECT * FROM nutrition_foods"),
      )
    ).length,
    0,
  );
  policy = fixturePolicy(cases.map((c) => c.id));
  const r = await ok("/nutrition/policy", "POST", {
    policy,
    reason: "Confirmed synthetic example policy",
  });
  assert.equal(
    (await req("/nutrition/policy/" + r.id + "/confirm", "POST", {}, other))
      .statusCode,
    404,
  );
  await ok("/nutrition/policy/" + r.id + "/confirm", "POST", {});
});
test("held-out evaluation and a sample week qualify automatic nutrition independently", async () => {
  assert.equal((await req("/nutrition/evaluate", "POST", {})).statusCode, 409);
  for (let i = 0; i < 24; i++) {
    const c = cases[i % cases.length],
      exception = i >= 20;
    await ok("/nutrition/scenarios", "POST", {
      category: c.data.category,
      prompt: `[${c.data.category}] Unseen synthetic client situation ${i}; apply the available evidence.`,
      profile: {
        ...fixtureProfile,
        ...(exception ? { allergyStatus: "unknown" } : {}),
      },
      expect: exception ? "exception" : "plan",
      expectedTargetKcal: exception ? null : 1500,
      expectedCaseId: c.id,
      heldOut: true,
    });
  }
  evaluation = await ok("/nutrition/evaluate", "POST", {});
  assert.equal(evaluation.status, "passed");
  assert.equal(evaluation.data.verificationMode, "fixture");
  preview = await ok("/nutrition/preview", "POST", {
    profile: fixtureProfile,
    weekStart: today,
  });
  release = await ok("/nutrition/releases", "POST", {
    evaluationId: evaluation.id,
    previewId: preview.id,
    confirmed: true,
  });
  assert.equal(release.data.mode, "automatic_with_exceptions");
  assert.equal((await ok("/nutrition/coach")).ready, true);
  assert.equal(
    (
      await db.tenant(owner, (tx) =>
        tx.query("SELECT id FROM records WHERE kind='brain_release'"),
      )
    ).length,
    0,
  );
});
test("in-scope plans deliver automatically once; quantities and cooking swaps stay connected", async () => {
  await ok(
    "/nutrition/profile",
    "POST",
    {
      profile: fixtureProfile,
      processingConsent: true,
      modelConsent: true,
      version: 0,
    },
    subscriber,
  );
  const requestKey = randomUUID(),
    before = modelCalls;
  const result = await ok(
    "/nutrition/generate",
    "POST",
    { requestKey, weekStart: today },
    subscriber,
  );
  assert.equal(result.plan.status, "delivered");
  plan = result.plan;
  assert.equal(modelCalls, before + 1);
  const again = await ok(
    "/nutrition/generate",
    "POST",
    { requestKey, weekStart: today },
    subscriber,
  );
  assert.equal(again.plan.id, plan.id);
  assert.equal(modelCalls, before + 1);
  const swap = await ok(
    "/nutrition/plans/" + plan.id + "/swap",
    "POST",
    {
      expectedVersion: plan.version,
      date: today,
      slot: "Breakfast",
      recipeId: recipes[0].id,
      variantKey: "microwave",
      servings: 1,
    },
    subscriber,
  );
  assert.equal(
    swap.plan.data.view.days[0].meals[0].cookingName,
    "Microwave option",
  );
  assert.deepEqual(swap.plan.data.view.groceries, plan.data.view.groceries);
  assert.equal(
    (
      await req(
        "/nutrition/plans/" + plan.id + "/swap",
        "POST",
        {
          expectedVersion: plan.version,
          date: today,
          slot: "Breakfast",
          recipeId: recipes[0].id,
          variantKey: "hob",
          servings: 1,
        },
        subscriber,
      )
    ).statusCode,
    409,
  );
  plan = swap.plan;
  const csv = await req(
    "/nutrition/groceries/" + plan.id,
    "GET",
    undefined,
    subscriber,
  );
  assert.equal(csv.statusCode, 200);
  assert.match(csv.body, /2800/);
});
test("diary replay, corrections and the nutrition Twin never double-count", async () => {
  const body = {
    eventKey: randomUUID(),
    date: today,
    timezone: "Asia/Dubai",
    name: "Breakfast",
    notes: "Confirmed portion",
    kcal: 400,
    planId: plan.id,
    slot: "Breakfast",
    deleted: false,
  };
  const first = await ok("/nutrition/logs", "POST", body, subscriber);
  const again = await ok("/nutrition/logs", "POST", body, subscriber);
  assert.equal(first.id, again.id);
  assert.equal(
    (await req("/nutrition/logs", "POST", { ...body, kcal: 450 }, subscriber))
      .statusCode,
    409,
  );
  await ok(
    "/nutrition/logs",
    "POST",
    { ...body, eventKey: randomUUID(), correctsId: first.id, kcal: 350 },
    subscriber,
  );
  assert.equal(
    (
      await req(
        "/nutrition/logs",
        "POST",
        { ...body, eventKey: randomUUID(), correctsId: first.id, kcal: 300 },
        subscriber,
      )
    ).statusCode,
    409,
  );
  const data = await ok("/nutrition", "GET", undefined, subscriber);
  assert.equal(data.twin.loggedMeals, 1);
  assert.equal(data.twin.partial, true);
  const twin = await ok(
    "/clients/" + subscriber.userId + "/twin",
    "GET",
    undefined,
    subscriber,
  );
  assert.equal(twin.data.nutrition.loggedMeals, 1);
  assert.equal(twin.data.coaching.nutrition, undefined);
});
test("weekly scheduling creates one durable first-week job and skips a week already delivered", async () => {
  assert.equal(await scheduleNutrition(db, owner.tenantId), 0);
  await db.tenant(owner, (tx) =>
    tx.query("UPDATE records SET status='needs_recheck' WHERE id=$1", [
      plan.id,
    ]),
  );
  assert.equal(await scheduleNutrition(db, owner.tenantId), 1);
  assert.equal(await scheduleNutrition(db, owner.tenantId), 0);
  const [job] = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT * FROM jobs WHERE kind='nutrition_week' ORDER BY created_at DESC LIMIT 1",
    ),
  );
  const result: any = await executeNutritionJob(db, owner.tenantId, job);
  assert.equal(result.plan.status, "delivered");
  plan = result.plan;
  assert.equal(await scheduleNutrition(db, owner.tenantId), 0);
});
test("invalid model output retains cost, creates an exception and preserves the current plan", async () => {
  invalid = true;
  const r = await ok(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: dateOffset(today, 7) },
    subscriber,
  );
  invalid = false;
  assert.equal(r.status, "exception");
  const d = await ok("/nutrition", "GET", undefined, subscriber);
  assert.equal(
    d.records.find((r: any) => r.status === "delivered").id,
    plan.id,
  );
  const cost = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT * FROM cost_events WHERE task='nutrition_week' ORDER BY created_at DESC LIMIT 1",
    ),
  );
  assert.equal(cost[0].status, "recorded");
  assert.equal(Number(cost[0].cost_usd), 0.0004);
});
test("consent changed while the model runs prevents delivery and leaves workouts independent", async () => {
  let reached!: () => void, continueRun!: () => void;
  const started = new Promise<void>((r) => (reached = r)),
    proceed = new Promise<void>((r) => (continueRun = r));
  delay = async () => {
    reached();
    await proceed;
  };
  const running = req(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: dateOffset(today, 14) },
    subscriber,
  );
  await started;
  await ok(
    "/privacy/consent",
    "POST",
    { type: "nutrition_model", granted: false },
    subscriber,
  );
  continueRun();
  const response = await running;
  delay = undefined;
  assert.equal(response.statusCode, 403, response.body);
  const d = await ok("/nutrition", "GET", undefined, subscriber);
  assert.equal(d.processingConsent, true);
  assert.equal(d.modelConsent, false);
  assert.ok(
    !d.records.some(
      (x: any) =>
        x.kind === "nutrition_plan" &&
        x.data.weekStart === dateOffset(today, 14),
    ),
  );
  const exportResult = await ok(
    "/privacy/export",
    "GET",
    undefined,
    subscriber,
  );
  assert.ok(exportResult.records.some((r: any) => r.kind === "nutrition_log"));
});
test("new profile restrictions and stale teaching invalidate nutrition readiness without touching training", async () => {
  let d = await ok("/nutrition", "GET", undefined, subscriber);
  await ok(
    "/nutrition/profile",
    "POST",
    {
      profile: { ...fixtureProfile, allergyStatus: "unknown" },
      processingConsent: true,
      modelConsent: true,
      version: d.profile.version,
    },
    subscriber,
  );
  const r = await ok(
    "/nutrition/generate",
    "POST",
    { requestKey: randomUUID(), weekStart: today },
    subscriber,
  );
  assert.equal(r.status, "exception");
  assert.equal(r.code, "ALLERGY_INFORMATION");
  const c = cases[0];
  await ok("/nutrition/cases/" + c.id, "PATCH", {
    version: c.version,
    answer: {
      ...fixtureCases()[0],
      id: undefined,
      recommendation:
        "A corrected synthetic case recommendation with a different teaching explanation.",
    },
  });
  d = await ok("/nutrition/coach");
  assert.equal(d.ready, false);
  assert.equal(
    (
      await req("/nutrition/releases", "POST", {
        evaluationId: evaluation.id,
        previewId: preview.id,
        confirmed: true,
      })
    ).statusCode,
    409,
  );
});
test("unknown signed price removes nutrition access and metadata cannot re-enable it", async () => {
  await processStripeEvent(db, {
    id: "evt_nutrition_price_unknown",
    type: "customer.subscription.updated",
    created: 200,
    data: {
      object: {
        id: "sub_nutrition_fixture",
        object: "subscription",
        status: "active",
        current_period_end: Math.floor(Date.now() / 1000) + 2592000,
        items: { data: [{ price: { id: "unmapped_price" } }] },
        metadata: {
          tenant_id: owner.tenantId,
          user_id: subscriber.userId,
          modules: ["training", "nutrition"],
        },
      },
    },
  });
  assert.equal(
    (await ok("/nutrition", "GET", undefined, subscriber)).entitled,
    false,
  );
  assert.equal(
    (
      await req(
        "/nutrition/generate",
        "POST",
        { requestKey: randomUUID(), weekStart: today },
        subscriber,
      )
    ).statusCode,
    402,
  );
});
