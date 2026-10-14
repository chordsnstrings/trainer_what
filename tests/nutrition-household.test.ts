import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { putRecord } from "@trainer/db";
import { accountsContext } from "./accounts-fixtures.ts";
import {
  fixtureCatalog,
  fixtureCases,
  fixturePolicy,
  fixtureProfile,
  fixtureWeek,
} from "./nutrition-fixtures.ts";
import {
  nutritionProfileSchema,
  nutritionPolicySchema,
  nutritionTarget,
  validateNutritionWeek,
  recipeCompatibility,
  localDate,
  type NutritionProfile,
} from "../packages/domain/src/nutrition.ts";
import {
  estimateNutritionEnergy,
  personalEnergyTarget,
} from "../packages/domain/src/nutrition-energy.ts";
import {
  nutritionGuidance,
  nutritionKitchenPack,
} from "../packages/domain/src/nutrition-household.ts";
import { nutritionPolicyDraft } from "../packages/domain/src/nutrition-policy-draft.ts";

const profile: NutritionProfile = {
  ...fixtureProfile,
  weightKg: 80,
  energy: { heightCm: 180, equationSex: "male", activity: "low" },
  preferences: {
    cuisines: ["emirati"],
    likedFoods: ["rice"],
    halal: false,
    batchCooking: true,
  },
  kitchen: {
    cook: "chef",
    portions: 3,
    language: "ar",
    region: "AE",
    instructions: "Pack lunch separately",
  },
};
const cases = fixtureCases(),
  policy = fixturePolicy(cases.map((c) => c.id));
const personalPolicy = {
  ...policy,
  maxKcal: 3500,
  energyAdjustments: [
    { goal: "Consistency", intent: "lose" as const, adjustmentKcal: -300 },
  ],
};
function view(p = profile) {
  const catalog = fixtureCatalog();
  return validateNutritionWeek({
    ...catalog,
    week: fixtureWeek(
      catalog.recipes,
      cases.map((c) => c.id),
    ),
    policy,
    profile: p,
    caseIds: cases.map((c) => c.id),
    weekStart: "2026-10-14",
  });
}

test("personal energy uses explicit equation inputs and coach-confirmed deficit, maintenance and surplus", () => {
  assert.equal(estimateNutritionEnergy(profile)?.restingKcal, 1755);
  assert.equal(estimateNutritionEnergy(profile)?.maintenanceKcal, 2106);
  assert.equal(
    estimateNutritionEnergy({
      ...profile,
      energy: { ...profile.energy!, equationSex: "female" },
    })?.restingKcal,
    1589,
  );
  assert.equal(nutritionTarget(personalPolicy, profile), 1806);
  assert.equal(
    nutritionTarget(
      {
        ...personalPolicy,
        energyAdjustments: [
          { goal: "Consistency", intent: "maintain", adjustmentKcal: 0 },
        ],
      },
      profile,
    ),
    2106,
  );
  assert.equal(
    nutritionTarget(
      {
        ...personalPolicy,
        energyAdjustments: [
          { goal: "Consistency", intent: "gain", adjustmentKcal: 300 },
        ],
      },
      profile,
    ),
    2406,
  );
  assert.equal(
    nutritionTarget(policy, profile),
    1500,
    "legacy fixed rule stays fixed",
  );
});

test("personal method fails closed on missing measurements, clinical scope, low weight, age and calorie bounds", () => {
  for (const p of [
    { ...profile, energy: undefined },
    { ...profile, weightKg: undefined },
    { ...profile, weightKg: 45 },
    { ...profile, age: 18 },
    { ...profile, age: 79 },
    { ...profile, notes: "I am pregnant" },
    { ...profile, scopeStatus: "unknown" as const },
    {
      ...profile,
      kitchen: {
        ...profile.kitchen!,
        instructions: "I need a fasting plan for Ramadan",
      },
    },
  ])
    assert.throws(() => nutritionTarget(personalPolicy, p));
  assert.equal(
    personalEnergyTarget(
      {
        ...profile,
        weightKg: 55,
        age: 55,
        energy: { ...profile.energy!, heightCm: 160 },
      },
      -400,
    ).error,
    "TARGET_LIMIT",
  );
  assert.throws(() =>
    nutritionTarget({ ...personalPolicy, minKcal: 2000 }, profile),
  );
  assert.equal(
    estimateNutritionEnergy({ ...profile, energy: undefined }),
    null,
  );
});

test("energy rules reject wrong signs, unsupported or duplicated goals, extreme factors and household sizes", () => {
  for (const adjustment of [
    { goal: "Consistency", intent: "lose", adjustmentKcal: 300 },
    { goal: "Consistency", intent: "gain", adjustmentKcal: -300 },
    { goal: "Consistency", intent: "maintain", adjustmentKcal: 100 },
    { goal: "Consistency", intent: "lose", adjustmentKcal: -501 },
    { goal: "unknown", intent: "lose", adjustmentKcal: -300 },
  ])
    assert.equal(
      nutritionPolicySchema.safeParse({
        ...policy,
        energyAdjustments: [adjustment],
      }).success,
      false,
    );
  assert.equal(
    nutritionPolicySchema.safeParse({
      ...personalPolicy,
      energyAdjustments: [
        ...personalPolicy.energyAdjustments,
        ...personalPolicy.energyAdjustments,
      ],
    }).success,
    false,
  );
  assert.equal(
    nutritionProfileSchema.safeParse({
      ...profile,
      energy: { ...profile.energy, activity: "guess" },
    }).success,
    false,
  );
  for (const portions of [0, 1.5, 13])
    assert.equal(
      nutritionProfileSchema.safeParse({
        ...profile,
        kitchen: { ...profile.kitchen, portions },
      }).success,
      false,
    );
  assert.equal(nutritionProfileSchema.safeParse(profile).success, true);
});

test("compiled policies cannot silently enable automatic energy calculation", () => {
  const result = nutritionPolicyDraft(
    { policy: personalPolicy, gaps: [], conflicts: [] },
    { sourceIds: cases.map((c) => c.id), teaching: [] },
  );
  assert.ok(result.gaps.some((g) => /personal energy rules/.test(g)));
  assert.equal(result.policy?.energyAdjustments, undefined);
  assert.equal(result.partialPolicy?.energyAdjustments, undefined);
});

test("diet options reflect current restrictions and available reviewed recipes", () => {
  const catalog = fixtureCatalog();
  catalog.recipes[0].cuisines = ["emirati"];
  const guidance = nutritionGuidance(
    { ...policy, supportedDiets: ["balanced", "vegetarian"] },
    profile,
    catalog.foods,
    catalog.recipes,
  )!;
  assert.equal(guidance.diets[0].recipes, 3);
  assert.equal(guidance.diets[0].cuisineMatches, 1);
  assert.equal(guidance.diets[1].recipes, 0);
  assert.equal(guidance.diets[1].missingSlots.length, 3);
  assert.equal(
    nutritionGuidance(
      policy,
      { ...profile, notes: "I have kidney disease" },
      catalog.foods,
      catalog.recipes,
    )?.energy,
    null,
  );
  const halal = {
    ...profile,
    preferences: { ...profile.preferences!, halal: true },
  };
  assert.match(
    recipeCompatibility(
      catalog.recipes[0],
      catalog.recipes[0].variants[0],
      new Map(catalog.foods.map((f) => [f.id, f])),
      halal,
      policy,
    )!,
    /halal/,
  );
  catalog.recipes[0].dietTags.push("halal");
  assert.equal(
    recipeCompatibility(
      catalog.recipes[0],
      catalog.recipes[0].variants[0],
      new Map(catalog.foods.map((f) => [f.id, f])),
      halal,
      policy,
    ),
    null,
  );
});

test("kitchen pack scales food once, preserves member portions, repeated days and original recipe steps", () => {
  const v = view(),
    pack = nutritionKitchenPack(v, [], [], "2026-10-14");
  assert.equal(pack.days.length, 7);
  assert.equal(pack.recipes.length, 3);
  assert.equal(pack.recipes[0].uses.length, 7);
  assert.equal(pack.recipes[0].ingredients[0].memberGrams, 400);
  assert.equal(pack.recipes[0].ingredients[0].cookGrams, 1200);
  assert.equal(
    pack.shopping.find((g) => g.name === "Oat mixture")?.grams,
    8400,
  );
  assert.equal(
    pack.shopping[0].purchaseGrams,
    null,
    "no invented cooked-to-raw conversion",
  );
  assert.equal(pack.recipes[0].minutes, 20, "cooking time is not multiplied");
  assert.deepEqual(pack.recipes[0].steps, v.days[0].meals[0].steps);
  assert.equal(
    v.days[0].totals.kcal,
    1500,
    "member calorie totals do not scale",
  );
});

test("kitchen shopping subtracts only usable dated quantities, then converts and rounds packs", () => {
  const v = view(),
    food = v.days[0].meals[0].ingredients[0].food;
  const pack = nutritionKitchenPack(
    v,
    [
      {
        data: {
          foodId: food.id,
          purchaseGramsPerEdibleGram: 0.5,
          packGrams: 500,
          label: "Raw pack",
          source: "Reviewed test conversion",
        },
      },
    ],
    [
      {
        status: "available",
        data: { foodId: food.id, grams: 2000, useBy: "2026-10-14" },
      },
      {
        status: "available",
        data: { foodId: food.id, grams: 900, useBy: "2026-10-13" },
      },
    ],
    "2026-10-14",
  );
  const g = pack.shopping.find((g) => g.name === food.name)!;
  assert.equal(
    g.availableGrams,
    1200,
    "only first day's cooking fits before use-by",
  );
  assert.equal(g.remainingGrams, 7200);
  assert.equal(g.purchaseGrams, 3600);
  assert.equal(g.packs, 8);
  assert.equal(g.purchasedGrams, 4000);
});

test("cook handoff excludes private metrics, health notes and target information", () => {
  const pack = nutritionKitchenPack(
    {
      ...view(),
      profile,
      targetKcal: 1500,
      explanation: "Private coaching message",
    } as any,
    [],
    [],
    "2026-10-14",
  );
  const text = JSON.stringify(pack);
  for (const key of [
    "weightKg",
    "heightCm",
    "equationSex",
    "targetKcal",
    "calculationVersion",
    "Private coaching message",
    "Synthetic profile",
  ])
    assert.ok(!text.includes(key), key);
  assert.match(text, /Pack lunch separately/);
  const legacy = nutritionKitchenPack(
    { ...view(), kitchen: undefined },
    [],
    [],
    "2026-10-14",
  );
  assert.equal(legacy.kitchen.portions, 1);
});

test("current kitchen packs and grocery exports enforce permission, profile freshness and tenant/member isolation", async () => {
  const ctx = await accountsContext();
  try {
    const owner = {
        ...(await ctx.person({ role: "owner" })),
        role: "owner" as const,
      },
      member = await ctx.person({
        role: "subscriber",
        tenantId: owner.tenantId,
      }),
      sibling = await ctx.person({
        role: "subscriber",
        tenantId: owner.tenantId,
      }),
      outsider = await ctx.person({ role: "subscriber" });
    await ctx.db.tenant(owner, (tx) =>
      tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,data) VALUES($1,$2,$3,'active',now()+interval '30 days',$4)",
        [
          randomUUID(),
          owner.tenantId,
          member.userId,
          JSON.stringify({ modules: ["training", "nutrition"] }),
        ],
      ),
    );
    const saved = await ctx.call("/nutrition/profile", {
      cookie: member.cookie,
      body: {
        profile,
        version: 0,
        processingConsent: true,
        modelConsent: false,
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const plan = await ctx.db.tenant(owner, (tx) =>
      putRecord(
        tx,
        owner,
        "nutrition_plan",
        { profileId: saved.json().id, view: view() },
        { ownerId: member.userId, status: "delivered" },
      ),
    );
    const path = "/nutrition/kitchen/" + plan.id;
    const ready = await ctx.call(path, { cookie: member.cookie });
    assert.equal(ready.statusCode, 200, ready.body);
    assert.equal(ready.headers["cache-control"], "private, no-store");
    assert.equal(ready.json().kitchen.portions, 3);
    assert.equal(ready.json().days.length, 7);
    for (const cookie of [sibling.cookie, outsider.cookie])
      assert.equal((await ctx.call(path, { cookie })).statusCode, 404);
    assert.equal((await ctx.call(path)).statusCode, 401);
    const changed = await ctx.call("/nutrition/profile", {
      cookie: member.cookie,
      body: {
        profile: { ...profile, kitchen: { ...profile.kitchen!, portions: 2 } },
        version: saved.json().version,
        processingConsent: true,
        modelConsent: false,
      },
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(
      (await ctx.call(path, { cookie: member.cookie })).statusCode,
      409,
    );
    assert.equal(
      (
        await ctx.call("/nutrition/groceries/" + plan.id, {
          cookie: member.cookie,
        })
      ).statusCode,
      409,
    );
    await ctx.db.tenant(owner, (tx) =>
      tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'nutrition','test',false)",
        [randomUUID(), owner.tenantId, member.userId],
      ),
    );
    assert.equal(
      (await ctx.call(path, { cookie: member.cookie })).statusCode,
      403,
    );
    assert.equal(
      (
        await ctx.call("/nutrition/groceries/" + plan.id, {
          cookie: member.cookie,
        })
      ).statusCode,
      403,
    );
  } finally {
    await ctx.close();
  }
});
