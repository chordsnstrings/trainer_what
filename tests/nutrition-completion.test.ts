import {
  nutritionLearning,
  checkNutritionSample,
  rationaleMatches,
} from "../packages/domain/src/nutrition-learning.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  fixtureCatalog,
  fixtureProfile,
  fixtureCases,
  fixturePolicy,
  fixtureWeek,
} from "./nutrition-fixtures.ts";
import { clientNutritionTarget } from "../apps/api/src/nutrition-completion.ts";
import {
  calculateCoachTarget,
  validateClientTargets,
  scaleCapturedPortion,
  groceryPurchases,
  consumedNutrition,
} from "../packages/domain/src/nutrition-completion.ts";
import { localDate, dateOffset } from "../packages/domain/src/nutrition.ts";
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  owner: any,
  other: any;
const origin = "http://localhost:3000";
async function req(
  path: string,
  method: any = "GET",
  payload?: any,
  as = owner,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    payload,
    headers: { origin, ...(as?.cookie ? { cookie: as.cookie } : {}) },
  });
}
async function ok(path: string, method: any = "GET", body?: any, as = owner) {
  const r = await req(path, method, body, as);
  assert.ok(r.statusCode < 300, r.body);
  return r.json();
}
async function register(slug: string) {
  const r = await req(
    "/auth/register",
    "POST",
    {
      slug,
      name: slug,
      email: slug + "@example.test",
      password: "CompletionFixture2026!",
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
  owner = await register("nutrition-completion");
  other = await register("nutrition-other");
});
after(async () => {
  await app.close();
  await db.close();
});
test("catalog candidates exclude superseded and archived facts while history is retained", async () => {
  const fixture = fixtureCatalog(),
    { id: _, ...food } = fixture.foods[0];
  const f = await ok("/nutrition/foods", "POST", { food });
  const { id: __, ...recipe } = fixture.recipes[0];
  recipe.variants = recipe.variants.map((v) => ({
    ...v,
    ingredients: [{ foodId: f.id, grams: 400 }],
  }));
  const r = await ok("/nutrition/recipes", "POST", { recipe });
  const f2 = await ok("/nutrition/foods", "POST", {
    food: { ...food, name: "Updated food facts" },
    supersedesId: f.id,
  });
  let c = await ok("/nutrition/catalog-history");
  assert.equal(c.foods.length, 2);
  assert.deepEqual(
    c.active.foods.map((x: any) => x.id),
    [f2.id],
  );
  assert.equal(c.active.recipes.length, 0);
  assert.equal(c.recipes[0].id, r.id);
  assert.equal(
    (await req("/nutrition/foods", "POST", { food, supersedesId: f.id }))
      .statusCode,
    409,
  );
  assert.equal(
    (await req("/nutrition/recipes", "POST", { recipe })).statusCode,
    409,
  );
  await ok(`/nutrition/catalog/food/${f2.id}/archive`, "POST", {
    archived: true,
    reason: "Retired after ingredient review",
  });
  c = await ok("/nutrition/catalog-history");
  assert.equal(c.active.foods.length, 0);
  assert.equal(
    (
      await req(
        `/nutrition/catalog/food/${f2.id}/archive`,
        "POST",
        { archived: false, reason: "Other tenant cannot change it" },
        other,
      )
    ).statusCode,
    404,
  );
  await ok(`/nutrition/catalog/food/${f2.id}/archive`, "POST", {
    archived: false,
    reason: "Reviewed and available again",
  });
  assert.equal((await ok("/nutrition/catalog-history")).active.foods.length, 1);
});
async function blockedJob(state: string | undefined) {
  const jobId = randomUUID();
  await db.tenant(owner, async (tx) => {
    const profile = await putRecord(
      tx,
      owner,
      "nutrition_profile",
      { profile: fixtureProfile },
      { ownerId: owner.userId, status: "active" },
    );
    await tx.query(
      "INSERT INTO jobs(id,tenant_id,kind,intent_key,data,status,attempts) VALUES($1::uuid,$2,'nutrition_week',$1::text,$3,'blocked',1)",
      [
        jobId,
        owner.tenantId,
        JSON.stringify({
          userId: owner.userId,
          profileId: profile.id,
          weekStart: localDate(fixtureProfile.timezone),
        }),
      ],
    );
    if (state)
      await putRecord(
        tx,
        owner,
        "nutrition_request",
        { requestKey: jobId, providerState: state },
        { ownerId: owner.userId, status: "failed" },
      );
  });
  return jobId;
}
test("weekly recovery retries only unsent intent and persists an auditable provider reconciliation", async () => {
  const unsent = await blockedJob("not_sent");
  assert.equal(
    (
      await ok(`/nutrition/recovery/${unsent}`, "POST", {
        attempts: 1,
        action: "retry_unsent",
        reason: "Provider configuration repaired",
      })
    ).status,
    "pending",
  );
  assert.equal(
    (
      await req(`/nutrition/recovery/${unsent}`, "POST", {
        attempts: 1,
        action: "retry_unsent",
        reason: "Duplicate recovery must conflict",
      })
    ).statusCode,
    409,
  );
  const unknown = await blockedJob("uncertain");
  assert.equal(
    (
      await req(`/nutrition/recovery/${unknown}`, "POST", {
        attempts: 1,
        action: "retry_responded",
        reason: "An unknown response cannot bypass reconciliation",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await req(`/nutrition/recovery/${unknown}`, "POST", {
        attempts: 1,
        action: "retry_unsent",
        reason: "Attempted provider call timed out",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await req(`/nutrition/recovery/${unknown}`, "POST", {
        attempts: 1,
        action: "provider_confirmed_not_processed",
        reason: "No evidence must not allow replay",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req(
        `/nutrition/recovery/${unknown}`,
        "POST",
        {
          attempts: 1,
          action: "close",
          reason: "Another owner cannot recover this",
        },
        other,
      )
    ).statusCode,
    404,
  );
  await ok(`/nutrition/recovery/${unknown}`, "POST", {
    attempts: 1,
    action: "provider_confirmed_not_processed",
    reason: "Provider support confirms request never accepted",
    providerReference: "synthetic-case-0001",
  });
  const [audit] = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind='nutrition_recovery' AND data->>'jobId'=$1",
      [unknown],
    ),
  );
  assert.equal(audit.data.providerState, "uncertain");
  assert.equal(audit.data.providerReference, "synthetic-case-0001");
  const responded = await blockedJob("responded");
  assert.equal(
    (
      await ok(`/nutrition/recovery/${responded}`, "POST", {
        attempts: 1,
        action: "retry_responded",
        reason: "Coach deliberately accepts another billable model attempt",
      })
    ).status,
    "pending",
  );
});

let client: any,
  profile: any,
  policy: any,
  taught: any[],
  recipeVersions: any[];
async function prepareClient() {
  const invite = await ok("/invitations", "POST", {
    email: "nutrition-personal@example.test",
    role: "subscriber",
  });
  const accept = await req(
    "/invitations/accept",
    "POST",
    {
      token: invite.url.split("/").pop(),
      name: "Synthetic client",
      email: "nutrition-personal@example.test",
      password: "CompletionFixture2026!",
    },
    {},
  );
  assert.equal(accept.statusCode, 200, accept.body);
  const cookie = String(accept.headers["set-cookie"]).split(";")[0];
  client = {
    ...(await ok("/bootstrap", "GET", undefined, { cookie })).user,
    cookie,
  };
  await db.tenant(owner, async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,data) VALUES($1,$2,$3,'active',now()+interval '30 days',$4)",
      [
        randomUUID(),
        owner.tenantId,
        client.userId,
        JSON.stringify({ modules: ["training", "nutrition"] }),
      ],
    );
  });
  profile = await ok(
    "/nutrition/profile",
    "POST",
    {
      profile: fixtureProfile,
      processingConsent: true,
      modelConsent: false,
      version: 0,
    },
    client,
  );
  taught = [];
  for (const { id, ...c } of fixtureCases())
    taught.push(await ok("/nutrition/cases", "POST", c));
  policy = fixturePolicy(taught.map((c) => c.id));
  await db.tenant(owner, (tx) =>
    putRecord(
      tx,
      owner,
      "nutrition_policy",
      { policy },
      { status: "confirmed" },
    ),
  );
  const catalog = fixtureCatalog();
  recipeVersions = [];
  for (let i = 0; i < catalog.foods.length; i++) {
    const { id, ...food } = catalog.foods[i],
      f = await ok("/nutrition/foods", "POST", { food }),
      { id: _, ...recipe } = catalog.recipes[i];
    recipe.variants = recipe.variants.map((v) => ({
      ...v,
      ingredients: [{ foodId: f.id, grams: i === 0 ? 400 : 550 }],
    }));
    recipeVersions.push(await ok("/nutrition/recipes", "POST", { recipe }));
  }
}
test("coach-authored methods and individual targets enforce limits, profile binding and revision", async () => {
  await prepareClient();
  const method = {
    name: "Synthetic fixed method",
    kind: "fixed" as const,
    fixedKcal: 1500,
    kcalPerKg: null,
    activityFactor: 1,
    adjustmentKcal: 0,
    reason: "Synthetic arithmetic only",
    sourceIds: taught.map((c) => c.id),
  };
  assert.equal(calculateCoachTarget(method, {}, policy, fixtureProfile), 1500);
  assert.throws(() =>
    calculateCoachTarget(
      { ...method, kind: "weight_activity", kcalPerKg: 20 },
      {},
      policy,
      fixtureProfile,
    ),
  );
  const m = await ok("/nutrition/methods", "POST", method),
    target = {
      kcal: 1500,
      protein: 75,
      carbohydrate: 180,
      fat: 45,
      macroTolerancePercent: 20,
      hydrationMl: 2000,
      habits: ["Synthetic habit"],
      reviewOn: localDate(fixtureProfile.timezone),
      reason: "Individual synthetic arithmetic fixture",
      allowAutomaticAdjustment: false,
    };
  const body = {
    previousId: null,
    profileId: profile.id,
    target,
    methodId: m.id,
  };
  assert.equal(
    (
      await req(`/nutrition/clients/${client.userId}/target`, "POST", {
        ...body,
        target: { ...target, kcal: 1501 },
      })
    ).statusCode,
    400,
  );
  const saved = await ok(
    `/nutrition/clients/${client.userId}/target`,
    "POST",
    body,
  );
  assert.equal(saved.data.target.kcal, 1500);
  assert.equal(
    (await req(`/nutrition/clients/${client.userId}/target`, "POST", body))
      .statusCode,
    409,
  );
  assert.equal(
    (
      await req(
        `/nutrition/clients/${client.userId}/control`,
        "GET",
        undefined,
        other,
      )
    ).statusCode,
    404,
  );
  const resolved = await db.tenant(owner, (tx) =>
    clientNutritionTarget(tx, client.userId, profile, policy),
  );
  assert.equal(resolved.id, saved.id);
  assert.equal(resolved.kcal, 1500);
  assert.equal(
    (await ok("/nutrition", "GET", undefined, client)).targets[0].id,
    saved.id,
  );
  await assert.rejects(
    () =>
      db.tenant(owner, (tx) =>
        tx.query(
          "UPDATE records SET data=data||'{\"target\":{}}'::jsonb WHERE id=$1",
          [saved.id],
        ),
      ),
    /versioned/,
  );
  assert.throws(() =>
    validateClientTargets(
      { days: [{ totals: { protein: null, carbohydrate: 180, fat: 45 } }] },
      target,
    ),
  );
});
test("coach assignment and amendment validate full week and preserve immutable historical snapshots", async () => {
  const choices = fixtureWeek(
      recipeVersions,
      taught.map((c) => c.id),
    ),
    body = {
      weekStart: localDate(fixtureProfile.timezone),
      profileId: profile.id,
      previousId: null,
      previousVersion: null,
      week: choices,
      reason: "Assigning the complete synthetic weekly plan",
    };
  const plan = await ok(
    `/nutrition/clients/${client.userId}/plan`,
    "POST",
    body,
  );
  assert.equal(plan.data.view.days.length, 7);
  assert.equal(plan.data.target.kcal, 1500);
  assert.equal(
    (await req(`/nutrition/clients/${client.userId}/plan`, "POST", body))
      .statusCode,
    409,
  );
  const bad = structuredClone(choices);
  bad.days[0].meals[0].servings = 10;
  const rejected = await req(
    `/nutrition/clients/${client.userId}/plan`,
    "POST",
    { ...body, previousId: plan.id, previousVersion: plan.version, week: bad },
  );
  assert.ok(rejected.statusCode >= 400, rejected.body);
  const amended = await ok(`/nutrition/clients/${client.userId}/plan`, "POST", {
    ...body,
    previousId: plan.id,
    previousVersion: plan.version,
    reason: "Amended cooking guidance for the synthetic week",
  });
  assert.equal(amended.data.previousId, plan.id);
  const saved = await ok(`/nutrition/clients/${client.userId}/control`);
  assert.equal(
    saved.plans.find((p: any) => p.id === plan.id).status,
    "archived",
  );
  assert.deepEqual(
    saved.plans.find((p: any) => p.id === plan.id).data.view,
    plan.data.view,
  );
  await ok(`/nutrition/plans/${amended.id}/archive`, "POST", {
    version: amended.version,
    reason: "Archiving after documented client discussion",
  });
  assert.equal(
    (
      await req(`/nutrition/plans/${amended.id}/archive`, "POST", {
        version: amended.version,
        reason: "Repeated archive must conflict",
      })
    ).statusCode,
    409,
  );
  const current = await ok(`/nutrition/clients/${client.userId}/control`);
  assert.equal(
    current.plans.some((p: any) => p.status === "delivered"),
    false,
  );
});

test("diary totals respect corrections and unknown macros; favorites and copy retain portion evidence once", async () => {
  const today = localDate(fixtureProfile.timezone),
    base = {
      eventKey: randomUUID(),
      date: today,
      timezone: fixtureProfile.timezone,
      name: "Recorded synthetic meal",
      notes: "Arithmetic fixture",
      kcal: 300,
      nutrients: { kcal: 300, protein: 10, carbohydrate: 40, fat: 5 },
    };
  const log = await ok("/nutrition/logs", "POST", base, client);
  await ok(
    "/nutrition/logs",
    "POST",
    {
      ...base,
      eventKey: randomUUID(),
      name: "Partly known meal",
      kcal: null,
      nutrients: { kcal: null, protein: null, carbohydrate: null, fat: null },
    },
    client,
  );
  let tracker = await ok("/nutrition/tracker", "GET", undefined, client),
    day = tracker.days.at(-1);
  assert.equal(day.totals.kcal, null);
  assert.equal(day.knownTotals.kcal, 300);
  assert.equal(day.unknown.kcal, 1);
  assert.equal(tracker.days[0].totals.kcal, null);
  const correction = await ok(
    "/nutrition/logs",
    "POST",
    {
      ...base,
      eventKey: randomUUID(),
      correctsId: log.id,
      kcal: 350,
      nutrients: { ...base.nutrients, kcal: 350 },
    },
    client,
  );
  tracker = await ok("/nutrition/tracker", "GET", undefined, client);
  assert.equal(tracker.days.at(-1).meals, 2);
  assert.equal(tracker.days.at(-1).knownTotals.kcal, 350);
  const favorite = await ok(
    "/nutrition/favorites",
    "POST",
    { logId: correction.id },
    client,
  );
  assert.equal(
    (await ok("/nutrition/favorites", "POST", { logId: correction.id }, client))
      .id,
    favorite.id,
  );
  const copy = { eventKey: randomUUID(), date: today },
    recorded = await ok(
      `/nutrition/favorites/${favorite.id}/log`,
      "POST",
      copy,
      client,
    );
  assert.equal(
    (await ok(`/nutrition/favorites/${favorite.id}/log`, "POST", copy, client))
      .id,
    recorded.id,
  );
  assert.equal(recorded.data.nutrients.protein, 10);
  assert.equal(
    (
      await req(
        `/nutrition/logs/${log.id}/copy`,
        "POST",
        { eventKey: randomUUID(), date: today },
        client,
      )
    ).statusCode,
    409,
  );
  await ok(`/nutrition/favorites/${favorite.id}`, "DELETE", undefined, client);
  assert.equal(
    (await ok("/nutrition/favorites", "GET", undefined, client)).length,
    0,
  );
  tracker = await ok("/nutrition/tracker", "GET", undefined, client);
  assert.equal(tracker.days.at(-1).knownTotals.kcal, 700);
});
test("purchase conversions round packs after deducting correctly prepared inventory", async () => {
  const plan = await ok(`/nutrition/clients/${client.userId}/plan`, "POST", {
    weekStart: localDate(fixtureProfile.timezone),
    profileId: profile.id,
    previousId: null,
    previousVersion: null,
    week: fixtureWeek(
      recipeVersions,
      taught.map((c) => c.id),
    ),
    reason: "Shopping arithmetic fixture for current plan",
  });
  const foodId = recipeVersions[0].variants[0].ingredients[0].foodId;
  await ok("/nutrition/purchase-specs", "POST", {
    foodId,
    purchaseGramsPerEdibleGram: 0.5,
    packGrams: 600,
    label: "Synthetic 600g pack",
    source: "Synthetic conversion fixture only",
  });
  const inventory = {
      eventKey: randomUUID(),
      foodId,
      grams: 500,
      useBy: dateOffset(localDate(fixtureProfile.timezone), 1),
      notes: "Synthetic stored portion",
      confirmedStorage: true,
    },
    saved = await ok("/nutrition/leftovers", "POST", inventory, client);
  assert.equal(
    (await ok("/nutrition/leftovers", "POST", inventory, client)).id,
    saved.id,
  );
  let shopping = await ok(
      `/nutrition/shopping/${plan.id}`,
      "GET",
      undefined,
      client,
    ),
    item = shopping.items.find((x: any) => x.food.id === foodId);
  assert.equal(item.grams, 2800);
  assert.equal(item.availableGrams, 500);
  assert.equal(item.purchaseGrams, 1150);
  assert.equal(item.packs, 2);
  assert.equal(item.purchasedGrams, 1200);
  await ok(`/nutrition/leftovers/${saved.id}/remove`, "POST", {}, client);
  shopping = await ok(
    `/nutrition/shopping/${plan.id}`,
    "GET",
    undefined,
    client,
  );
  assert.equal(shopping.items.find((x: any) => x.food.id === foodId).packs, 3);
  const expired = groceryPurchases(
    [{ food: { id: foodId }, grams: 10 }],
    [],
    [{ status: "available", data: { foodId, grams: 20, useBy: "2000-01-01" } }],
    localDate(fixtureProfile.timezone),
  );
  assert.equal(expired[0].availableGrams, 0);
  assert.equal(expired[0].purchaseGrams, null);
});
test("photo quantity scaling preserves unknowns and verified ingredient grounding keeps provenance", async () => {
  const item = {
    name: "Synthetic bowl",
    portion: "150g",
    amount: 150,
    unit: "g" as const,
    kcal: 195,
    protein: null,
    carbohydrate: 40,
    fat: 2,
    preparation: "cooked" as const,
    uncertainty: "Uncertain photo estimate",
  };
  const scaled = scaleCapturedPortion(item, 300);
  assert.equal(scaled.kcal, 390);
  assert.equal(scaled.protein, null);
  assert.equal(scaleCapturedPortion(item, 150, "ml").kcal, null);
  const captureId = randomUUID();
  await db.tenant(owner, async (tx) => {
    for (const type of ["nutrition_model", "nutrition_photo"])
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,$4,'synthetic-test',true)",
        [randomUUID(), owner.tenantId, client.userId, type],
      );
    await tx.query(
      "INSERT INTO meal_captures(id,tenant_id,user_id,request_key,fingerprint,kind,status,data) VALUES($1,$2,$3,$4,'synthetic','photo','draft',$5)",
      [
        captureId,
        owner.tenantId,
        client.userId,
        randomUUID(),
        JSON.stringify({
          estimate: { items: [item], questions: [], notes: "Synthetic draft" },
        }),
      ],
    );
  });
  const foodId = recipeVersions[0].variants[0].ingredients[0].foodId,
    grounded = await ok(
      `/nutrition/captures/${captureId}/ground`,
      "POST",
      { index: 0, foodId, grams: 350 },
      client,
    );
  assert.equal(grounded.data.estimate.items[0].kcal, 350);
  assert.equal(grounded.data.originalEstimate.items[0].kcal, 195);
  assert.equal(grounded.data.groundedFacts[0].food.id, foodId);
  const log = await ok(
    `/nutrition/captures/${captureId}/confirm`,
    "POST",
    {
      eventKey: randomUUID(),
      date: localDate(fixtureProfile.timezone),
      timezone: fixtureProfile.timezone,
      name: "Confirmed grounded synthetic meal",
      notes: "",
      items: grounded.data.estimate.items,
      confirmed: true,
    },
    client,
  );
  assert.equal(log.data.provenance.groundedFacts[0].food.id, foodId);
  assert.equal(log.data.kcal, 350);
  await ok(
    "/privacy/consent",
    "POST",
    { type: "nutrition_photo", granted: false },
    client,
  );
  const state = await ok("/nutrition/captures", "GET", undefined, client);
  assert.equal(state.photoConsent, false);
  assert.equal(state.processingConsent, true);
});

test("adaptive teaching identifies conflicting conditions, asks contrast cases and follows exception coverage", async () => {
  const base = {
    id: randomUUID(),
    status: "confirmed",
    data: {
      category: "calories",
      scenario: "A client with a confirmed goal",
      recommendation: "Use this worked target",
      reason: "Keep the decision inside the confirmed coach limits",
      decision: {
        conditions: {
          goal: "Consistency",
          diet: "balanced",
          budget: null,
          scope: "general_wellness",
          allergy: "known",
        },
        action: "plan",
        targetKcal: 1500,
        minServings: null,
        maxServings: null,
        principle: "goal_target",
      },
    },
  };
  const conflicting = {
    ...structuredClone(base),
    id: randomUUID(),
    data: {
      ...structuredClone(base.data),
      scenario: "A second example with the same conditions",
      decision: { ...base.data.decision, targetKcal: 1800 },
    },
  };
  const diagnosed = nutritionLearning(
    [base, conflicting],
    [],
    [{ data: { code: "TARGET_LIMIT" } }, { data: { code: "TARGET_LIMIT" } }],
  );
  assert.equal(diagnosed.conflicts.length, 1);
  assert.equal(diagnosed.questions[0].category, "calories");
  assert.match(diagnosed.questions[0].prompt, /2 time/);
  const distinct = {
    ...conflicting,
    data: {
      ...conflicting.data,
      decision: {
        ...conflicting.data.decision,
        conditions: {
          ...conflicting.data.decision.conditions,
          goal: "Different goal",
        },
      },
    },
  };
  assert.equal(nutritionLearning([base, distinct], []).conflicts.length, 0);
  assert.ok(
    nutritionLearning([base], []).questions.some(
      (q) => q.key === "calories:contrast",
    ),
  );
  const report = await ok("/nutrition/learning");
  assert.equal(report.coverage.length, 8);
  assert.ok(report.questions.some((q: any) => q.reason.includes("conditions")));
});
test("held-out sample arithmetic and rationale require actual evidence and allowed recipe portions", () => {
  const catalog = fixtureCatalog(),
    policy = fixturePolicy([randomUUID()]),
    recipe = catalog.recipes[0],
    sample = {
      slot: "Breakfast",
      recipeId: recipe.id,
      variantKey: "hob",
      servings: 1,
      ingredients: recipe.variants[0].ingredients,
      nutrients: { kcal: 400, protein: 20, carbohydrate: 48, fat: 12 },
    },
    expected = {
      recipeIds: [recipe.id],
      slot: "Breakfast",
      minServings: 1,
      maxServings: 1,
    };
  const input = {
    sample,
    expected,
    profile: fixtureProfile,
    policy,
    ...catalog,
  };
  assert.equal(checkNutritionSample(input).passed, true);
  assert.equal(
    checkNutritionSample({ ...input, sample: { ...sample, servings: 2 } })
      .passed,
    false,
  );
  assert.equal(
    checkNutritionSample({
      ...input,
      sample: { ...sample, nutrients: { ...sample.nutrients, kcal: 399 } },
    }).passed,
    false,
  );
  const c = {
      id: randomUUID(),
      data: { reason: "Use the coach's confirmed practical portion limits." },
    },
    scenario = { category: "portions", expectedCaseId: c.id },
    decision = {
      caseIds: [c.id],
      principle: "portion_arithmetic",
      rationaleEvidence: { caseId: c.id, quote: c.data.reason },
    };
  assert.equal(rationaleMatches(decision, scenario, [c]), true);
  assert.equal(
    rationaleMatches(
      {
        ...decision,
        rationaleEvidence: { caseId: c.id, quote: "!!!!!!!!!!!!!!!!!!!!!!" },
      },
      scenario,
      [c],
    ),
    false,
  );
  assert.equal(
    rationaleMatches({ ...decision, principle: "goal_target" }, scenario, [c]),
    false,
  );
});
