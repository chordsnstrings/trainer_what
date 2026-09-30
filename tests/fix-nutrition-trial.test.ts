/**
 * Nutrition fixes from the September 2026 model trial (track F4), tested
 * against the trial's own catalog, teaching, member profiles and model
 * replies (tests/nutrition-trial-fixtures.ts). Pure functions and the
 * provider call with a fake transport; the API flows are in
 * tests/fix-nutrition-model.test.ts.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  trialCases,
  trialFoods,
  trialPolicy,
  trialProfile,
  trialProfileRaw,
  trialMembers,
  trialRecipes,
  trialReplies,
  trialSlowestReplyMs,
  trialUid,
  TRIAL_NUTRITION_EVAL,
  type TrialTrainer,
} from "./nutrition-trial-fixtures.ts";
import {
  dailyKcalRange,
  nutritionExplanation,
  recipeCompatibility,
  nutritionTarget,
  nutritionWeekSchema,
  validateNutritionWeek,
  NutritionBlocked,
  type NutritionWeek,
} from "../packages/domain/src/nutrition.ts";
import {
  declinedWeekDetail,
  declinedWeekSchema,
  nutritionWeekFeasibility,
  nutritionWeekInstruction,
  nutritionWeekLimits,
  recipesWithServingFacts,
  servingNutrients,
} from "../packages/domain/src/nutrition-planning.ts";
import {
  macroRange,
  validateClientTargets,
} from "../packages/domain/src/nutrition-completion.ts";
import {
  nutritionPolicyDraft,
  nutritionPolicyReplySchema,
  statedInTeaching,
  teachingSentences,
  teachingTexts,
} from "../packages/domain/src/nutrition-policy-draft.ts";
import {
  checkNutritionSample,
  rationaleMatches,
  principleForCategory,
} from "../packages/domain/src/nutrition-learning.ts";
import {
  nutritionBudget,
  nutritionModel,
  NUTRITION_PROMPT_VERSION,
  NUTRITION_WEEK_LEASE_SECONDS,
} from "../packages/providers/src/nutrition.ts";
import { ModelOutputInvalid } from "../packages/providers/src/index.ts";
import nextConfig from "../apps/web/next.config.ts";
import { z } from "zod";

const START = "2026-10-05";
const reply = (key: string) => JSON.parse(trialReplies[key]);
const material = (t: TrialTrainer) => ({
  foods: trialFoods(t),
  recipes: trialRecipes(t),
  cases: trialCases(t),
  policy: trialPolicy(t),
});
const UUID_TEXT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Members whose week the code gates allow (the others are routed before any call). */
const planned = (key: string) => {
  try {
    const t = key.slice(0, 2) as TrialTrainer;
    return nutritionTarget(trialPolicy(t), trialProfile(key));
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// 1. Time and token budgets

test("every nutrition task gets a budget and timeout above the trial's slowest reply, and leases cover it", () => {
  // The trial app aborted 9 Seed weeks and 2 evaluations at the 30 s default.
  const week = nutritionBudget("nutrition_week");
  assert.deepEqual(week, { maxTokens: 12000, timeoutMs: 150000 });
  assert.ok(week.timeoutMs >= 3 * trialSlowestReplyMs.nutrition_week);
  for (const task of ["nutrition_policy", "nutrition_recipe"] as const) {
    const b = nutritionBudget(task);
    assert.equal(b.maxTokens, 12000);
    assert.ok(b.timeoutMs >= 3 * trialSlowestReplyMs[task]);
  }
  // Evaluation grows with its scenarios (the trial sent 6; the app needs 24+).
  const small = nutritionBudget("nutrition_evaluation", { scenarios: 6 }),
    usual = nutritionBudget("nutrition_evaluation", { scenarios: 24 }),
    largest = nutritionBudget("nutrition_evaluation", { scenarios: 44 });
  assert.ok(small.timeoutMs >= 3 * trialSlowestReplyMs.nutrition_eval);
  assert.ok(usual.maxTokens > small.maxTokens);
  assert.ok(largest.maxTokens >= usual.maxTokens);
  assert.deepEqual(largest, { maxTokens: 27000, timeoutMs: 300000 });
  for (const b of [week, small, usual, largest])
    assert.ok(b.timeoutMs <= 300000, "modelCompletion caps a call at 300 s");
  // The job lease and the running window outlast the week's model timeout.
  assert.ok(NUTRITION_WEEK_LEASE_SECONDS * 1000 >= week.timeoutMs + 60000);
  // The web forwards API calls long enough for the longest interactive call.
  const web = (nextConfig as any).default ?? nextConfig;
  const proxy = web.experimental?.proxyTimeout;
  assert.ok(proxy >= largest.timeoutMs + 10000, String(proxy));
  assert.equal(NUTRITION_PROMPT_VERSION, "nutrition-cases-v4");
});

// ---------------------------------------------------------------------------
// 2. Meal weeks: stated numbers, per-serving facts and unchanged validators

test("the week prompt states the daily range, portions, slots and repeats the validator applies", () => {
  const m = material("T1"),
    limits = nutritionWeekLimits({ policy: m.policy, targetKcal: 2800 }),
    text = nutritionWeekInstruction(limits);
  assert.deepEqual(limits.kcal, {
    target: 2800,
    min: 2520,
    max: 3080,
    tolerancePercent: 10,
  });
  for (const expected of [
    "between 2520 and 3080 kcal",
    "from 0.5 to 2.5, in steps of 0.25",
    "breakfast, lunch, dinner",
    "at most 5 times in the week",
    "only in a slot listed in its slots",
    "perServing",
    "Before answering, add up each day's kcal",
    // v4: the self-check also covers repeats and slots.
    "Then count each recipe's uses across the week (at most 5)",
    "every meal's slot is one of that recipe's listed slots",
    '{"days":[],"caseIds":[...],"explanation":"the reason, for the coach"}',
  ])
    assert.ok(text.includes(expected), expected);
  // An individual target adds its macro ranges, the same ones the check applies.
  const withMacros = nutritionWeekInstruction(
    nutritionWeekLimits({
      policy: m.policy,
      targetKcal: 2800,
      individualTarget: {
        kcal: 2800,
        protein: 180,
        carbohydrate: null,
        fat: 80,
        macroTolerancePercent: 10,
        hydrationMl: null,
        habits: [],
        reviewOn: "2026-12-01",
        reason: "Coach target",
        allowAutomaticAdjustment: false,
      },
    }),
  );
  assert.ok(
    withMacros.includes("each day's total must be between 162 and 198 g"),
  );
  assert.ok(withMacros.includes("between 72 and 88 g"));
  assert.ok(!withMacros.includes("carbohydrate: target"));
});

test("a day inside the stated whole-kcal range is never rejected for rounding, and one outside always is", () => {
  for (const [target, tol] of [
    [2800, 10],
    [1850, 7],
    [1500, 5],
    [1999, 3.3],
  ] as const) {
    const { min, max } = dailyKcalRange(target, tol);
    assert.ok(min >= target - (target * tol) / 100 - 1e-9);
    assert.ok(max <= target + (target * tol) / 100 + 1e-9);
    // One meal whose kcal is exactly the day's total.
    const check = (kcal: number) => {
      const food = {
        id: trialUid("rounding:food"),
        name: "Test mix",
        preparation: "cooked" as const,
        nutrientsPer100g: { kcal: 100, protein: 1, carbohydrate: 1, fat: 1 },
        allergens: [],
        ingredientTags: [],
        allergenReviewComplete: true,
        estimated: false,
        source: "Test",
      };
      const recipe = {
        id: trialUid("rounding:recipe"),
        name: "Test bowl",
        description: "",
        dietTags: ["halal"],
        slots: ["breakfast"],
        budget: "low" as const,
        yieldServings: 1,
        source: "Test",
        variants: [
          {
            key: "hob",
            name: "Hob",
            equipment: [],
            minutes: 5,
            steps: ["Serve."],
            storageNote: "",
            ingredients: [{ foodId: food.id, grams: kcal }],
          },
        ],
      };
      const policy = {
        ...trialPolicy("T1"),
        minKcal: 1000,
        maxKcal: 4000,
        tolerancePercent: tol,
        slots: ["breakfast"],
        maxRecipeRepeats: 7,
        minServings: 1,
        maxServings: 1,
        targets: [{ goal: "muscle gain", kcal: target, reason: "Test" }],
      };
      try {
        validateNutritionWeek({
          week: {
            days: Array.from({ length: 7 }, (_, offset) => ({
              offset,
              meals: [
                {
                  slot: "breakfast",
                  recipeId: recipe.id,
                  variantKey: "hob",
                  servings: 1,
                  batchKey: null,
                },
              ],
            })),
            caseIds: [trialUid("rounding:case")],
            explanation: "A simple test week.",
          },
          policy,
          profile: trialProfile("T1S07"),
          foods: [food],
          recipes: [recipe],
          caseIds: [trialUid("rounding:case")],
          weekStart: START,
          targetKcal: target,
        });
        return "ok";
      } catch (e) {
        return (e as NutritionBlocked).code;
      }
    };
    assert.equal(check(min), "ok");
    assert.equal(check(max), "ok");
    assert.equal(check(min - 0.49), "ok", "rounds to the stated minimum");
    assert.equal(check(min - 0.51), "CALORIE_POLICY");
    assert.equal(check(max + 0.51), "CALORIE_POLICY");
  }
});

test("macro ranges are stated and checked the same way", () => {
  assert.deepEqual(macroRange(150, 10), { min: 135, max: 165 });
  assert.deepEqual(macroRange(33.3, 7), { min: 31, max: 35.6 });
  assert.deepEqual(macroRange(5, 5), { min: 4, max: 6 });
  const target = {
    kcal: 2000,
    protein: 33.3,
    carbohydrate: null,
    fat: null,
    macroTolerancePercent: 7,
    hydrationMl: null,
    habits: [],
    reviewOn: "2026-12-01",
    reason: "Test",
    allowAutomaticAdjustment: false,
  };
  const day = (protein: number) => ({
    days: [{ totals: { kcal: 2000, protein, carbohydrate: 200, fat: 60 } }],
  });
  assert.doesNotThrow(() => validateClientTargets(day(31), target));
  assert.doesNotThrow(() => validateClientTargets(day(30.96), target));
  assert.doesNotThrow(() => validateClientTargets(day(35.6), target));
  assert.throws(() => validateClientTargets(day(30.94), target), {
    code: "MACRO_POLICY",
  });
  assert.throws(() => validateClientTargets(day(35.66), target), {
    code: "MACRO_POLICY",
  });
});

test("trial weeks that missed the calorie range are still rejected: the validator did not get weaker", () => {
  // Seed scaled no servings: its days were 20 to 35 percent under target.
  for (const [key, member, t] of [
    ["seed:T1S07/meal_week", "T1S07", "T1"],
    ["seed:T2S03/meal_week", "T2S03", "T2"],
    ["seed:T3S06/meal_week", "T3S06", "T3"],
  ] as const) {
    const m = material(t),
      week = nutritionWeekSchema.parse(reply(key));
    assert.throws(
      () =>
        validateNutritionWeek({
          week,
          policy: m.policy,
          profile: trialProfile(member),
          foods: m.foods,
          recipes: m.recipes,
          caseIds: m.cases.map((c) => c.id),
          weekStart: START,
          targetKcal: planned(member)!,
        }),
      (e: any) => e.code === "CALORIE_POLICY" || e.code === "PORTION_POLICY",
      key,
    );
  }
});

/**
 * Plans a week from what the prompt shows the model: the stated limits and
 * each option's perServing kcal. Used to show those numbers are enough to
 * pass the app's own validator.
 */
function planFromPrompt(member: string) {
  const t = member.slice(0, 2) as TrialTrainer,
    m = material(t),
    profile = trialProfile(member),
    target = planned(member)!,
    limits = nutritionWeekLimits({ policy: m.policy, targetKcal: target });
  const facts = new Map(m.foods.map((f) => [f.id, f]));
  const shown = recipesWithServingFacts(m.recipes, m.foods).flatMap((r) =>
    r.variants
      // As promptCatalog: only options the validator could accept.
      .filter((v) => !recipeCompatibility(r, v, facts, profile, m.policy))
      .map((v) => ({
        id: r.id,
        slots: r.slots,
        key: v.key,
        kcal: v.perServing!.kcal!,
      })),
  );
  // Recipes: the slot with the fewest options chooses first, each time the
  // option with the most uses left under the repeat limit.
  const used = new Map<string, number>();
  const bySlot = [...limits.slots].sort(
    (a, b) =>
      shown.filter((o) => o.slots.includes(a)).length -
      shown.filter((o) => o.slots.includes(b)).length,
  );
  const chosen = new Map<string, (typeof shown)[number]>();
  for (const slot of bySlot)
    for (let offset = 0; offset < 7; offset++) {
      const o = shown
        .filter((x) => x.slots.includes(slot))
        .filter((x) => (used.get(x.id) ?? 0) < limits.maxRecipeRepeats)
        .sort((a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0))[0];
      assert.ok(o, `${member}: no ${slot} option left on day ${offset}`);
      used.set(o.id, (used.get(o.id) ?? 0) + 1);
      chosen.set(`${offset}:${slot}`, o);
    }
  const days = Array.from({ length: 7 }, (_, offset) => {
    const picks = limits.slots.map((slot) => ({
      slot,
      ...chosen.get(`${offset}:${slot}`)!,
      servings: 1,
    }));
    // Servings: quarter steps until the day's perServing total is in range.
    const total = () =>
      Math.round(picks.reduce((s, p) => s + p.kcal * p.servings, 0));
    for (let guard = 0; guard < 100; guard++) {
      const k = total();
      if (k >= limits.kcal.min && k <= limits.kcal.max) break;
      const up = k < limits.kcal.min,
        gap = up ? limits.kcal.min - k : k - limits.kcal.max;
      const movable = picks
        .filter((x) =>
          up
            ? x.servings < limits.servings.max
            : x.servings > limits.servings.min,
        )
        .sort((a, b) => b.kcal - a.kcal);
      const p = movable.find((x) => x.kcal / 4 <= gap + 1) ?? movable.at(-1);
      if (!p) break;
      p.servings += up ? 0.25 : -0.25;
    }
    return {
      offset,
      meals: picks.map((p) => ({
        slot: p.slot,
        recipeId: p.id,
        variantKey: p.key,
        servings: p.servings,
        batchKey: null,
      })),
    };
  });
  return {
    week: {
      days,
      caseIds: [m.cases[0].id],
      explanation: "A week built from your coach's recipes.",
    } as NutritionWeek,
    m,
    profile,
    target,
  };
}

/**
 * Trial members the code gates allow a week for (T2S05 and T3S02 fall under
 * their coach's boundaries and are screened out before any call).
 */
const PLANNABLE = [
  "T1S02",
  "T1S03",
  "T1S06",
  "T1S07",
  "T2S03",
  "T2S08",
  "T3S06",
  "T3S07",
];

test("the numbers in the prompt are enough to build a week the validator accepts for every plannable trial member", () => {
  const members = PLANNABLE;
  for (const member of members) {
    assert.ok(planned(member), member + " is plannable");
    const { week, m, profile, target } = planFromPrompt(member);
    const view = validateNutritionWeek({
      week,
      policy: m.policy,
      profile,
      foods: m.foods,
      recipes: m.recipes,
      caseIds: m.cases.map((c) => c.id),
      weekStart: START,
      targetKcal: target,
    });
    const { min, max } = dailyKcalRange(target, m.policy.tolerancePercent);
    for (const d of view.days) {
      assert.ok(Math.round(d.totals.kcal!) >= min, member);
      assert.ok(Math.round(d.totals.kcal!) <= max, member);
    }
  }
});

test("per-serving facts match the app's own nutrient arithmetic", () => {
  const m = material("T1"),
    facts = new Map(m.foods.map((f) => [f.id, f])),
    machboos = m.recipes.find((r) => r.name.startsWith("Chicken machboos"))!;
  // The trial's worked dinner: one serving is 587.3 kcal (Seed and the app agree).
  assert.deepEqual(servingNutrients(machboos, machboos.variants[0], facts), {
    kcal: 587.3,
    protein: 52.58,
    carbohydrate: 58.93,
    fat: 13.65,
  });
  const shown = recipesWithServingFacts(m.recipes, m.foods);
  assert.ok(shown.every((r) => r.variants.every((v) => v.perServing?.kcal)));
});

// ---------------------------------------------------------------------------
// 3. Catalog gaps are routed to the coach before any model call

test("the trial weeks no model could fill are found before the call; plannable members pass", () => {
  const gaps: Record<string, RegExp> = {
    T1S01: /for dinner/,
    T1S04: /for dinner/,
    T1S08: /for dinner/,
    T3S05: /for dinner/,
    T3S01: /dinner needs 7 meals .*at most 5/,
    T3S04: /breakfast needs 7 meals .*at most 5/,
    T2S04: /lunch and dinner need 14 meals .*at most 12/,
  };
  for (const member of Object.keys(gaps)) {
    const t = member.slice(0, 2) as TrialTrainer,
      m = material(t);
    const gap = nutritionWeekFeasibility({
      policy: m.policy,
      profile: trialProfile(member),
      foods: m.foods,
      recipes: m.recipes,
      targetKcal: planned(member)!,
    });
    assert.ok(gap instanceof NutritionBlocked, member);
    assert.equal(gap!.code, "CATALOG_GAP");
    assert.match(gap!.detail!, gaps[member], member);
    assert.ok(
      !gap!.message.includes("dinner"),
      "the client message is generic",
    );
  }
  // The plannable list is exactly the members every code gate lets through.
  assert.deepEqual(
    trialMembers.filter((member) => {
      const m = material(member.slice(0, 2) as TrialTrainer);
      return (
        planned(member) !== null &&
        nutritionWeekFeasibility({
          policy: m.policy,
          profile: trialProfile(member),
          foods: m.foods,
          recipes: m.recipes,
          targetKcal: planned(member)!,
        }) === null
      );
    }),
    PLANNABLE,
  );
  for (const member of PLANNABLE) {
    const t = member.slice(0, 2) as TrialTrainer,
      m = material(t);
    assert.equal(
      nutritionWeekFeasibility({
        policy: m.policy,
        profile: trialProfile(member),
        foods: m.foods,
        recipes: m.recipes,
        targetKcal: planned(member)!,
      }),
      null,
      member,
    );
  }
  // A daily range no allowed portion can reach is a gap too.
  const m = material("T1");
  const gap = nutritionWeekFeasibility({
    policy: { ...m.policy, maxServings: 0.5 },
    profile: trialProfile("T1S07"),
    foods: m.foods,
    recipes: m.recipes,
    targetKcal: 2800,
  });
  assert.match(
    gap!.detail!,
    /largest allowed portions .* below the 2520 to 3080 kcal range/,
  );
});

test("every trial week that broke a rule for a member with no possible week is now caught before the call", () => {
  // Seed put breakfast or lunch recipes at dinner (PORTION_POLICY) or kept
  // portions too small (CALORIE_POLICY); Opus and Sonnet repeated a recipe
  // too often (RECIPE_REPEATS) or declined. None of these members had a valid
  // week, so the request now goes to the coach before any model call, and the
  // unchanged validator still refuses every one of these replies.
  for (const [key, member, code] of [
    ["seed:T1S01/meal_week", "T1S01", "PORTION_POLICY"],
    ["seed:T1S04/meal_week", "T1S04", "PORTION_POLICY"],
    ["seed:T1S08/meal_week", "T1S08", "PORTION_POLICY"],
    ["seed:T3S05/meal_week", "T3S05", "PORTION_POLICY"],
    ["seed:T3S04/meal_week", "T3S04", "CALORIE_POLICY"],
    ["seed:T2S04/meal_week", "T2S04", "CALORIE_POLICY"],
    ["opus:T2S04/meal_week", "T2S04", "RECIPE_REPEATS"],
    ["sonnet:T2S04/meal_week", "T2S04", "RECIPE_REPEATS"],
  ] as const) {
    const m = material(member.slice(0, 2) as TrialTrainer),
      week = nutritionWeekSchema.parse(reply(key));
    assert.throws(
      () =>
        validateNutritionWeek({
          week,
          policy: m.policy,
          profile: trialProfile(member),
          foods: m.foods,
          recipes: m.recipes,
          caseIds: m.cases.map((c) => c.id),
          weekStart: START,
          targetKcal: planned(member)!,
        }),
      { code },
      key,
    );
    assert.equal(
      nutritionWeekFeasibility({
        policy: m.policy,
        profile: trialProfile(member),
        foods: m.foods,
        recipes: m.recipes,
        targetKcal: planned(member)!,
      })?.code,
      "CATALOG_GAP",
      key,
    );
  }
});

test("a model that declines an impossible week is understood, not treated as broken output", () => {
  for (const key of [
    "opus:T1S01/meal_week",
    "opus:T1S04/meal_week",
    "opus:T1S08/meal_week",
    "opus:T3S01/meal_week",
    "opus:T3S04/meal_week",
    "opus:T3S05/meal_week",
  ]) {
    const raw = reply(key);
    assert.equal(nutritionWeekSchema.safeParse(raw).success, false, key);
    const declined = declinedWeekSchema.parse(raw);
    assert.equal(declined.days.length, 0);
  }
  // A short week is neither a plan nor a decline.
  const six = reply("opus:T1S07/meal_week");
  six.days = six.days.slice(0, 6);
  assert.equal(nutritionWeekSchema.safeParse(six).success, false);
  assert.equal(declinedWeekSchema.safeParse(six).success, false);
});

// ---------------------------------------------------------------------------
// 4. Identifiers go out as references (prompt-refs) and never as full UUIDs

const saved = { fetch: globalThis.fetch, timeout: AbortSignal.timeout };
const env = ["MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_NAME"] as const;
const savedEnv = Object.fromEntries(env.map((k) => [k, process.env[k]]));
after(() => {
  globalThis.fetch = saved.fetch;
  AbortSignal.timeout = saved.timeout;
  for (const k of env)
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
});
/** Runs nutritionModel against a fake provider that answers with `answer(request)`. */
async function callModel<T>(
  task: Parameters<typeof nutritionModel>[0],
  input: unknown,
  schema: z.ZodType<T>,
  answer: (request: { system: string; payload: any; body: any }) => unknown,
  options?: Parameters<typeof nutritionModel>[5],
) {
  Object.assign(process.env, {
    MODEL_BASE_URL: "https://trial-nutrition.invalid/v1",
    MODEL_API_KEY: "synthetic-key",
    MODEL_NAME: "trial-fixture",
  });
  const seen: { body?: any; timeouts: number[] } = { timeouts: [] };
  AbortSignal.timeout = (ms: number) => {
    seen.timeouts.push(ms);
    return saved.timeout.call(AbortSignal, ms);
  };
  globalThis.fetch = async (_url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    seen.body = body;
    const content = answer({
      system: body.messages[0].content,
      payload: JSON.parse(body.messages[1].content),
      body,
    });
    return new Response(
      JSON.stringify({
        id: "trial-fixture",
        choices: [
          {
            message: {
              content:
                typeof content === "string" ? content : JSON.stringify(content),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
      { status: 200 },
    );
  };
  const accounting = { reserve: async () => {}, record: async () => {} };
  try {
    const result = await nutritionModel(
      task,
      "Test instruction.",
      input,
      schema,
      accounting,
      options,
    );
    return { result, seen };
  } finally {
    globalThis.fetch = saved.fetch;
    AbortSignal.timeout = saved.timeout;
  }
}
const weekInput = (member: string) => {
  const t = member.slice(0, 2) as TrialTrainer,
    m = material(t);
  return {
    cases: m.cases,
    policy: m.policy,
    foods: m.foods,
    recipes: recipesWithServingFacts(m.recipes, m.foods),
    profile: trialProfileRaw(member),
    targetKcal: planned(member),
  };
};
/** Replace every full ID in a reply by the reference the request issued for it. */
function asReferences(value: unknown, payload: any, input: any) {
  const refOf = new Map<string, string>();
  for (const key of ["recipes", "foods", "cases"] as const)
    input[key].forEach((x: any, i: number) =>
      refOf.set(x.id, payload.input[key][i].id),
    );
  return JSON.parse(
    JSON.stringify(value).replace(
      new RegExp(UUID_TEXT, "gi"),
      (id) => refOf.get(id) ?? id,
    ),
  );
}

test("a meal-week request carries no full IDs and a reply in references decodes to the real IDs", async () => {
  const input = weekInput("T1S07"),
    trialWeek = reply("opus:T1S07/meal_week");
  const { result, seen } = await callModel(
    "nutrition_week",
    input,
    nutritionWeekSchema,
    ({ payload }) => asReferences(trialWeek, payload, input),
  );
  const sent = JSON.stringify(seen.body.messages[1].content);
  assert.ok(!UUID_TEXT.test(sent), "no UUID reaches the model");
  const payload = JSON.parse(seen.body.messages[1].content);
  assert.equal(payload.promptVersion, "nutrition-cases-v4");
  assert.ok(payload.input.recipes.every((r: any) => /^M\d+$/.test(r.id)));
  assert.ok(payload.input.foods.every((f: any) => /^G\d+$/.test(f.id)));
  assert.ok(payload.input.cases.every((c: any) => /^X\d+$/.test(c.id)));
  assert.ok(
    payload.input.recipes[0].variants[0].ingredients.every((i: any) =>
      /^G\d+$/.test(i.foodId),
    ),
  );
  assert.match(seen.body.messages[0].content, /short references such as R1/);
  assert.equal(seen.body.max_tokens, 12000);
  assert.deepEqual(seen.timeouts, [150000]);
  // The reference reply decodes back to Opus's original IDs exactly.
  assert.deepEqual(result, nutritionWeekSchema.parse(trialWeek));
});

test("the trial's miscopied case ID is still refused, never matched to the nearest real ID", async () => {
  // Seed copied T1's boundaries case 14124d78-…-bcf3a6dcb9f5 without its last
  // character in caseIds.7 of every T1 week (T1S03 here).
  const raw = reply("seed:T1S03/meal_week"),
    real = trialUid("T1:ncase:boundaries");
  assert.equal(raw.caseIds[7], real.slice(0, -1));
  const input = weekInput("T1S03");
  await assert.rejects(
    callModel("nutrition_week", input, nutritionWeekSchema, () => raw),
    (e: any) => e instanceof ModelOutputInvalid,
  );
  // With references the same answer is exact: X8 is the boundaries case.
  const fixed = structuredClone(raw);
  fixed.caseIds[7] = real;
  const { result } = await callModel(
    "nutrition_week",
    input,
    nutritionWeekSchema,
    ({ payload }) => asReferences(fixed, payload, input),
  );
  assert.equal(result.caseIds[7], real);
  // An unknown reference is invalid output too.
  await assert.rejects(
    callModel("nutrition_week", input, nutritionWeekSchema, ({ payload }) => {
      const r = asReferences(fixed, payload, input);
      r.days[0].meals[0].recipeId = "M99";
      return r;
    }),
    (e: any) => e instanceof ModelOutputInvalid,
  );
});

test("a recipe draft cites ingredient references; an unknown one uses the caller's error", async () => {
  const m = material("T1"),
    trial = reply("seed:T1/nutrition_recipe");
  const input = { request: "Draft a quick high-protein halal lunch.", ...m };
  const { result } = await callModel(
    "nutrition_recipe",
    input,
    z.object({ recipe: z.any() }).strict(),
    ({ payload }) => asReferences(trial, payload, input),
  );
  assert.deepEqual(result, trial, "decodes back to the trial's real food IDs");
  await assert.rejects(
    callModel(
      "nutrition_recipe",
      input,
      z.object({ recipe: z.any() }).strict(),
      () => {
        const r = structuredClone(trial);
        r.recipe.variants[0].ingredients[0].foodId = "G99";
        return r;
      },
      {
        unknownIdError: () =>
          Object.assign(new Error("unknown food"), { code: "UNKNOWN_FOOD" }),
      },
    ),
    { code: "UNKNOWN_FOOD" },
  );
});

// ---------------------------------------------------------------------------
// 4b. Coach boundaries: the code screen first, the model's decline second

test("members under their coach's boundaries are screened out before any model call", () => {
  // T2S05 (osteopenia, takes vitamin D; T2 sends osteoporosis and medication
  // to the coach) and T3S02 (eats only at suhoor and iftar; T3 sends Ramadan
  // meal timing to the coach) passed every code gate in the trial: only the
  // model's decline stopped their weeks, and Haiku returned full weeks.
  for (const member of ["T2S05", "T3S02"]) {
    const t = member.slice(0, 2) as TrialTrainer;
    assert.throws(
      () => nutritionTarget(trialPolicy(t), trialProfile(member)),
      (e: any) => e instanceof NutritionBlocked && e.code === "SCOPE_REVIEW",
      member,
    );
  }
  const policy = trialPolicy("T3"),
    profile = trialProfile("T3S06");
  for (const notes of [
    "Osteoporosis diagnosed last year",
    "Low bone density",
    "Takes vitamin D and calcium",
    "Iron tablets for anaemia",
    "B12 injections every month",
    "I do intermittent fasting",
    "Fasting in Ramadan this month",
    "I eat only at suhoor and iftar",
    "عندي هشاشة العظام",
    "ترقق العظام",
    "آخذ فيتامين د",
    "حبوب الحديد يوميا",
    "صائمة في رمضان",
    "أتسحر وأفطر فقط",
    "أصوم الاثنين والخميس",
  ])
    assert.throws(
      () => nutritionTarget(policy, { ...profile, notes }),
      (e: any) => e instanceof NutritionBlocked && e.code === "SCOPE_REVIEW",
      notes,
    );
  // Ordinary words stay plannable.
  for (const notes of [
    "Breakfast before work, quick meals",
    "No fast food please",
    "Bone broth on cold days",
    "A calorie deficit that feels easy",
    "فطور خفيف قبل الدوام",
    "إفطار الصباح بسيط",
    "نقص الوزن ببطء",
  ])
    assert.equal(nutritionTarget(policy, { ...profile, notes }), 1800, notes);
});

test("the week prompt puts the coach's boundaries first and asks for a decline when unsure", () => {
  const text = nutritionWeekInstruction(
    nutritionWeekLimits({ policy: trialPolicy("T3"), targetKcal: 1800 }),
  );
  for (const expected of [
    "Coach boundaries come first",
    "notes) against the policy's boundaries and the coach's boundaries teaching case",
    "eating times these slots cannot follow, such as fasting",
    "or you are not sure whether it does, do not plan",
    "when a coach boundary applies or you are unsure",
    "that filtering does not check the coach's boundaries",
  ])
    assert.ok(text.includes(expected), expected);
  // v3 before this review told the model the options "already fit this client".
  assert.ok(!text.includes("already fit"));
  assert.ok(
    text.indexOf("Coach boundaries come first") < text.indexOf("Days:"),
    "the boundary check comes before the planning rules",
  );
});

test("the trial's boundary declines are read as declines, cite the boundaries case and keep the reason for the coach", async () => {
  // Seed, Opus and Sonnet declined T2S05 and T3S02 under v2; the same replies
  // in references must decode to a decline (days: []), never an error.
  const weekReply = z.union([nutritionWeekSchema, declinedWeekSchema]);
  for (const member of ["T2S05", "T3S02"]) {
    const t = member.slice(0, 2) as TrialTrainer,
      boundaries = trialUid(`${t}:ncase:boundaries`),
      input = { ...weekInput(member), targetKcal: t === "T2" ? 1900 : 1800 };
    for (const model of ["seed", "opus", "sonnet"]) {
      const raw = reply(`${model}:${member}/meal_week`);
      assert.equal(nutritionWeekSchema.safeParse(raw).success, false);
      const { result, seen } = await callModel(
        "nutrition_week",
        input,
        weekReply,
        ({ payload }) => asReferences(raw, payload, input),
      );
      assert.equal(result.days.length, 0, model + " " + member);
      assert.ok(result.caseIds.includes(boundaries), model + " " + member);
      // The notes the models declined on reach the model.
      const payload = JSON.parse(seen.body.messages[1].content);
      assert.equal(payload.input.profile.notes, trialProfileRaw(member).notes);
      assert.match(
        declinedWeekDetail(result.explanation),
        member === "T2S05" ? /osteopenia/i : /Ramadan/,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Policy compilation: blanks become questions for the coach

const draftFor = (key: string) => {
  const t = key.split(":")[1].slice(0, 2) as TrialTrainer,
    cases = trialCases(t);
  return nutritionPolicyDraft(nutritionPolicyReplySchema.parse(reply(key)), {
    sourceIds: cases.map((c) => c.id),
    teaching: teachingTexts(cases.map((c) => c.data)),
  });
};

test("Seed's policies with a blank tolerance are saved as drafts with questions, not rejected", () => {
  // The trial app rejected all three as invalid output (tolerancePercent null).
  for (const [key, blanks] of [
    ["seed:T1/nutrition_policy", ["tolerancePercent"]],
    ["seed:T2/nutrition_policy", ["tolerancePercent", "minAge", "maxAge"]],
    ["seed:T3/nutrition_policy", ["tolerancePercent", "maxAge"]],
  ] as const) {
    const d = draftFor(key);
    assert.equal(d.policy, null, key);
    assert.ok(d.partialPolicy, key);
    for (const field of blanks) {
      assert.equal(
        d.partialPolicy![field],
        null,
        `${key} ${field} stays blank`,
      );
      assert.ok(
        d.gaps.some((g) =>
          field === "tolerancePercent" ? /toleran/i.test(g) : /age/i.test(g),
        ),
        `${key} asks about ${field}`,
      );
    }
    // Nothing is invented while filling the form's other fields.
    assert.equal(typeof d.partialPolicy!.boundaries, "string");
  }
  // T1: every stated number survives, and the only questions are about blanks.
  const t1 = draftFor("seed:T1/nutrition_policy");
  assert.deepEqual(
    (t1.partialPolicy!.targets as any[]).map((t) => t.kcal),
    [2800, 2000, 2400],
  );
  assert.ok(!t1.gaps.some((g) => g.startsWith("Your teaching does not state")));
  // T2 turned adjustment off with no numbers: inert values, no calorie change.
  const t2 = draftFor("seed:T2/nutrition_policy");
  assert.deepEqual(t2.partialPolicy!.adjustment, {
    enabled: false,
    trigger: "hunger_high",
    requiredCheckins: 30,
    minimumDays: 90,
    deltaKcal: 0,
    reason:
      "Automatic adjustment is off; the coach changes targets personally.",
  });
});

test("Opus and Sonnet policy replies with conflict objects are saved with their questions", () => {
  for (const key of [
    "opus:T1/nutrition_policy",
    "opus:T2/nutrition_policy",
    "opus:T3/nutrition_policy",
    "sonnet:T1/nutrition_policy",
    "sonnet:T2/nutrition_policy",
    "sonnet:T3/nutrition_policy",
  ]) {
    const d = draftFor(key);
    assert.equal(d.policy, null, key);
    assert.ok(
      d.gaps.some((g) => /toleran/i.test(g)),
      key,
    );
    assert.ok(d.conflicts.every((c) => typeof c === "string" && c.length > 10));
  }
  assert.match(
    draftFor("opus:T1/nutrition_policy").conflicts[0],
    /Only I change targets/,
  );
});

test("an invented tolerance and age limit are flagged; broken replies stay invalid", () => {
  // Haiku's T3 policy filled the two values the coach never taught.
  const d = draftFor("haiku:T3/nutrition_policy");
  assert.ok(d.policy, "otherwise complete");
  assert.ok(d.gaps.some((g) => /daily calorie tolerance of 10%/.test(g)));
  assert.ok(d.gaps.some((g) => /maximum client age of 70/.test(g)));
  assert.equal(d.gaps.length, 2, JSON.stringify(d.gaps));
  for (const key of ["haiku:T1/nutrition_policy", "haiku:T2/nutrition_policy"])
    assert.equal(
      nutritionPolicyReplySchema.safeParse(reply(key)).success,
      false,
      key,
    );
});

test("an invented number is flagged unless the teaching states it for that same field", () => {
  // The first v3 check accepted any number written anywhere in the teaching,
  // so an invented 5% tolerance passed on T1's "at most 5 times a week" and
  // T3's repeat limit. No trainer taught a tolerance (expected.json).
  for (const t of ["T1", "T3"] as const) {
    const seed = reply(`seed:${t}/nutrition_policy`),
      cases = trialCases(t);
    const d = nutritionPolicyDraft(
      nutritionPolicyReplySchema.parse({
        ...seed,
        gaps: [],
        policy: {
          ...seed.policy,
          tolerancePercent: 5,
          minAge: 18,
          maxAge: seed.policy.maxAge ?? 65,
        },
      }),
      {
        sourceIds: cases.map((c) => c.id),
        teaching: teachingTexts(cases.map((c) => c.data)),
      },
    );
    assert.ok(
      d.gaps.includes(
        "Your teaching does not state the daily calorie tolerance of 5% in this draft. Confirm it or enter the right value before this policy is used.",
      ),
      t + " " + JSON.stringify(d.gaps),
    );
  }
  // Every value the trial models took from the teaching is still found:
  // no Seed, Opus or Sonnet policy gets a "does not state" question.
  for (const t of ["T1", "T2", "T3"] as const)
    for (const model of ["seed", "opus", "sonnet"])
      assert.ok(
        !draftFor(`${model}:${t}/nutrition_policy`).gaps.some((g) =>
          g.startsWith("Your teaching does not state"),
        ),
        model + " " + t,
      );
  const stated = (
    kind: Parameters<typeof statedInTeaching>[0],
    value: number,
    text: string,
  ) => statedInTeaching(kind, value, teachingSentences([text]));
  for (const [kind, value, text] of [
    ["tolerancePercent", 5, "Days may be 5% above or below the target."],
    ["tolerancePercent", 10, "Stay within ten percent of the daily target."],
    ["tolerancePercent", 7.5, "A day is fine at ±7,5 % of the target."],
    ["tolerancePercent", 10, "نطاق ١٠٪ من الهدف اليومي"],
    ["age", 18, "Clients under 18 or over 65 come to me."],
    ["age", 65, "Clients under 18 or over 65 come to me."],
    ["age", 70, "Adults aged 18 to 70 only."],
    ["age", 18, "18+ only."],
    ["age", 18, "أقل من 18 سنة يأتون إلي"],
    ["kcal", 1800, "I never go below 1800 or above 3200."],
    ["kcal", 3200, "within my 1,800-3,200 limits"],
    ["kcal", 2800, "Muscle gain 2800 kcal."],
    ["servings", 0.5, "Clients eat between 0.5 and 2.5 servings."],
    ["servings", 0.5, "From half a serving to two servings."],
    ["maxRecipeRepeats", 5, "Repeat recipes at most 5 times a week each."],
    ["requiredCheckins", 3, "After 3 check-ins with high hunger."],
    ["days", 7, "over at least 7 days"],
    ["days", 14, "over two weeks"],
  ] as const)
    assert.ok(stated(kind, value, text), `${kind} ${value}: ${text}`);
  for (const [kind, value, text] of [
    // The same number, written for something else.
    ["tolerancePercent", 5, "Repeat recipes at most 5 times a week."],
    ["tolerancePercent", 30, "Protein is 30% of calories."],
    ["tolerancePercent", 10, "Adjust by 10 kcal."],
    ["age", 20, "Only 20 minutes and an air fryer."],
    ["age", 65, "Recipes serve 2; 65 g of rice each."],
    ["kcal", 1800, "Walk 1800 steps after dinner."],
    ["servings", 0.5, "Use 0.5 kg of rice for the batch."],
    ["maxRecipeRepeats", 5, "Cook in 5 minutes."],
    ["requiredCheckins", 3, "Eat 3 meals a day."],
    ["days", 7, "Repeat at most 7 times."],
  ] as const)
    assert.ok(!stated(kind, value, text), `${kind} ${value}: ${text}`);
  // A client's age in a case's scenario is the situation, not the coach's limit.
  const teaching = teachingTexts([
    {
      category: "boundaries",
      scenario: "A 70-year-old client asks for a fat-loss plan.",
      recommendation: "Clients under 18 come to me.",
    },
  ]);
  assert.ok(!teaching.some((x) => x.includes("70-year-old")));
  assert.equal(statedInTeaching("age", 70, teachingSentences(teaching)), false);
});

test("a draft field that cannot be used always comes with a question, so a blocked draft is never silent", () => {
  const seed = reply("seed:T1/nutrition_policy"),
    cases = trialCases("T1");
  const d = nutritionPolicyDraft(
    nutritionPolicyReplySchema.parse({
      ...seed,
      gaps: [],
      policy: { ...seed.policy, tolerancePercent: 10, title: "x".repeat(200) },
    }),
    {
      sourceIds: cases.map((c) => c.id),
      teaching: [
        ...teachingTexts(cases.map((c) => c.data)),
        "Days may be 10% above or below the target.",
      ],
    },
  );
  assert.equal(d.policy, null);
  assert.deepEqual(d.gaps, [
    "Check the drafted title: it is missing or cannot be used as written.",
  ]);
});

// ---------------------------------------------------------------------------
// 6. Evaluation: stated precision and the teaching a safety check may cite

const evalDecisions = (key: string) => reply(key).decisions as any[];
const scenarioName = (t: TrialTrainer, id: string) => {
  for (const s of TRIAL_NUTRITION_EVAL[t])
    if (trialUid(`${t}:nevalscen:${s.key}`) === id) return s.key;
  for (const code of [
    "unknown-allergy",
    "specialist-scope",
    "unsupported-diet",
    "unsupported-goal",
  ])
    if (trialUid(`${t}:nevalsys:${code}`) === id) return "sys-" + code;
  return id;
};

test("worked meals that differed from the app's arithmetic only by rounding now pass", () => {
  let checked = 0;
  for (const key of [
    "seed:T1/nutrition_eval",
    "opus:T1/nutrition_eval",
    "opus:T2/nutrition_eval",
    "opus:T3/nutrition_eval",
    "sonnet:T1/nutrition_eval",
    "sonnet:T2/nutrition_eval",
    "sonnet:T3/nutrition_eval",
  ]) {
    const t = key.split(":")[1].slice(0, 2) as TrialTrainer,
      m = material(t);
    for (const d of evalDecisions(key).filter((d) => d.sampleMeal)) {
      const s = TRIAL_NUTRITION_EVAL[t].find(
        (x) => x.key === scenarioName(t, d.scenarioId),
      )!;
      const input = {
        sample: d.sampleMeal,
        expected: undefined,
        profile: s.profile,
        policy: m.policy,
        foods: m.foods,
        recipes: m.recipes,
      };
      assert.equal(checkNutritionSample(input).passed, true, key);
      // A claim a whole kcal away is still refused.
      const off = structuredClone(d.sampleMeal);
      off.nutrients.kcal += 1;
      assert.equal(
        checkNutritionSample({ ...input, sample: off }).reason,
        "Nutrient claims disagree with stored ingredient facts",
      );
      checked++;
    }
  }
  assert.equal(checked, 7);
});

test("a safety check citing the teaching that sets the violated limit passes; unrelated teaching does not", () => {
  const accepted: Record<string, string[]> = {
    "sys-unknown-allergy": ["boundaries", "substitutions"],
    "sys-specialist-scope": ["boundaries"],
    "sys-unsupported-diet": ["boundaries", "diet"],
    "sys-unsupported-goal": ["boundaries", "calories"],
  };
  // Still refused, and why: a quote taken from the case's scenario (the
  // question, not the coach's answer; the v3 prompt names the fields to quote)
  // and principles other than scope_referral (the v3 prompt says system
  // safety checks use scope_referral).
  const stillFailing: Record<string, string> = {
    "opus:T1/nutrition_eval sys-unsupported-diet": "scenario quote",
    "sonnet:T2/nutrition_eval sys-specialist-scope": "scenario quote",
    "sonnet:T2/nutrition_eval sys-unsupported-diet": "scenario quote",
    "seed:T3/nutrition_eval sys-unsupported-diet": "principle",
    "seed:T3/nutrition_eval sys-unsupported-goal": "principle",
  };
  let before = 0,
    after = 0;
  for (const key of [
    "seed:T1/nutrition_eval",
    "seed:T2/nutrition_eval",
    "seed:T3/nutrition_eval",
    "opus:T1/nutrition_eval",
    "opus:T2/nutrition_eval",
    "opus:T3/nutrition_eval",
    "sonnet:T1/nutrition_eval",
    "sonnet:T2/nutrition_eval",
    "sonnet:T3/nutrition_eval",
  ]) {
    const t = key.split(":")[1].slice(0, 2) as TrialTrainer,
      cases = trialCases(t);
    for (const d of evalDecisions(key)) {
      const name = scenarioName(t, d.scenarioId);
      if (!accepted[name]) continue;
      const scenario = {
        category: "boundaries",
        expectedCaseId: trialUid(`${t}:ncase:boundaries`),
        acceptedCaseIds: accepted[name].map((c) => trialUid(`${t}:ncase:${c}`)),
        expectedPrinciple: "scope_referral",
      };
      // Without acceptedCaseIds only the boundaries case counts (the old rule).
      if (
        rationaleMatches(d, { ...scenario, acceptedCaseIds: undefined }, cases)
      )
        before++;
      const now = rationaleMatches(d, scenario, cases);
      if (now) after++;
      assert.equal(now, !stillFailing[`${key} ${name}`], `${key} ${name}`);
      if (stillFailing[`${key} ${name}`] === "principle")
        assert.notEqual(d.principle, "scope_referral");
    }
  }
  assert.equal(after + Object.keys(stillFailing).length, 36);
  assert.ok(after >= before + 12, `${before} -> ${after}`);
  // Unrelated teaching (budget) and a non-referral principle still fail.
  const cases = trialCases("T1"),
    budget = cases.find((c) => c.data.category === "budget")!,
    diet = cases.find((c) => c.data.category === "diet")!;
  const scenario = {
    category: "boundaries",
    expectedCaseId: trialUid("T1:ncase:boundaries"),
    acceptedCaseIds: ["boundaries", "diet"].map((c) =>
      trialUid(`T1:ncase:${c}`),
    ),
    expectedPrinciple: "scope_referral",
  };
  assert.equal(
    rationaleMatches(
      {
        caseIds: [budget.id],
        principle: "scope_referral",
        rationaleEvidence: {
          caseId: budget.id,
          quote: budget.data.recommendation,
        },
      },
      scenario,
      cases,
    ),
    false,
  );
  assert.equal(
    rationaleMatches(
      {
        caseIds: [diet.id],
        principle: principleForCategory.diet,
        rationaleEvidence: { caseId: diet.id, quote: diet.data.referWhen },
      },
      scenario,
      cases,
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// 7. Client-facing text never shows identifiers

test("a coach who teaches in Arabic can be quoted: Arabic rationale evidence is compared letter for letter", () => {
  // The old comparison kept only a-z and 0-9, so every Arabic quote became an
  // empty string and no Arabic-teaching coach could ever pass qualification.
  const caseId = trialUid("T2:ncase:boundaries-ar");
  const cases = [
    {
      id: caseId,
      data: {
        category: "boundaries",
        scenario: "عميلة حامل تطلب خطة وجبات أسبوعية",
        recommendation:
          "لا تقدّم خطة تلقائية للحامل، وأرسلها إلى المدربة مباشرة.",
        reason: "سلامة الأم والجنين أولاً.",
        changeWhen: "",
        referWhen: "الحمل والرضاعة والسكري",
        avoid: "التخمين",
      },
    },
  ];
  const scenario = {
    category: "boundaries",
    expectedCaseId: caseId,
    expectedPrinciple: "scope_referral",
  };
  const decide = (quote: string, principle = "scope_referral") =>
    rationaleMatches(
      {
        caseIds: [caseId],
        principle,
        rationaleEvidence: { caseId, quote },
      },
      scenario,
      cases,
    );
  // An exact quote, and the same words with other hamza, diacritic and
  // punctuation spellings (folded as the nutrition screens fold them).
  assert.equal(decide("لا تقدّم خطة تلقائية للحامل"), true);
  assert.equal(decide("لا تقدم خطه تلقائيه للحامل"), true);
  assert.equal(decide("وأرسلها إلى المدربة مباشرة"), true);
  assert.equal(decide("الحمل والرضاعة والسكري"), true);
  // Still refused: words from the scenario, words the case never says, a
  // quote too short to be evidence, and the wrong principle.
  assert.equal(decide("عميلة حامل تطلب خطة"), false);
  assert.equal(decide("قدّم خطة تلقائية للحامل دائماً"), false);
  assert.equal(decide("التخمين"), false);
  assert.equal(decide("لا تقدّم خطة تلقائية للحامل", "diet_match"), false);
  // English quotes behave as before.
  const en = [
    {
      id: caseId,
      data: {
        ...cases[0].data,
        recommendation:
          "Do not give an automatic plan to pregnant clients; send them to me.",
      },
    },
  ];
  assert.equal(
    rationaleMatches(
      {
        caseIds: [caseId],
        principle: "scope_referral",
        rationaleEvidence: { caseId, quote: "automatic plan to Pregnant" },
      },
      scenario,
      en,
    ),
    true,
  );
});

test("an explanation naming a record ID is replaced by the neutral explanation", () => {
  const days = [
    {
      totals: { kcal: 2800 },
      meals: [
        { recipeId: trialUid("T1:recipe:oats"), nutrients: { kcal: 700 } },
      ],
    },
  ];
  const named = nutritionExplanation({
    text: `Built around case ${trialUid("T1:ncase:diet")} for you.`,
    targetKcal: 2800,
    days,
    slots: 3,
    batches: 0,
    recipes: [],
  });
  assert.equal(named.explanationCheck.accepted, false);
  assert.deepEqual(named.explanationCheck.issues, ["identifier"]);
  assert.ok(!UUID_TEXT.test(named.explanation));
  assert.equal(
    nutritionExplanation({
      text: "High-protein halal meals at about 2800 kcal a day.",
      targetKcal: 2800,
      days,
      slots: 3,
      batches: 0,
      recipes: [],
    }).explanationCheck.accepted,
    true,
  );
});
