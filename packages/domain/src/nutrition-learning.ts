import {
  foldNutritionText,
  nutritionCategories,
  nutritionQuestions,
  nutritionTarget,
  recipeCompatibility,
  scaledNutrients,
  type Food,
  type Recipe,
  type NutritionPolicy,
  type NutritionProfile,
} from "./nutrition.ts";
import {
  nutritionSampleMealSchema,
  principleForCategory,
} from "./nutrition-learning-schema.ts";
export {
  nutritionPrinciples,
  principleForCategory,
  nutritionTeachingDecisionSchema,
  nutritionExpectedMealSchema,
  nutritionSampleMealSchema,
} from "./nutrition-learning-schema.ts";
// Letters and digits of any script (folded like the nutrition screens), so
// Arabic teaching compares and can be quoted: an ASCII-only class turned
// every Arabic quote into an empty string that could never match.
const normalized = (s: string) =>
  foldNutritionText(s)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function nutritionLearning(
  cases: Array<{ id: string; data: any; status: string }>,
  scenarios: Array<{ id: string; data: any }>,
  exceptions: Array<{ data: any }> = [],
) {
  const current = cases.filter((c) => c.status === "confirmed"),
    conflicts: Array<{ caseIds: string[]; message: string }> = [];
  for (let i = 0; i < current.length; i++)
    for (let j = i + 1; j < current.length; j++) {
      const a = current[i],
        b = current[j];
      if (a.data.category !== b.data.category) continue;
      const da = a.data.decision,
        db = b.data.decision,
        sameScenario =
          normalized(a.data.scenario) === normalized(b.data.scenario);
      let conflict =
        sameScenario &&
        normalized(a.data.recommendation) !== normalized(b.data.recommendation);
      if (da && db) {
        const matches = Object.keys(da.conditions).every(
          (k) =>
            da.conditions[k] === null ||
            db.conditions[k] === null ||
            normalized(String(da.conditions[k])) ===
              normalized(String(db.conditions[k])),
        );
        if (
          matches &&
          (da.action !== db.action ||
            (da.targetKcal !== null &&
              db.targetKcal !== null &&
              da.targetKcal !== db.targetKcal) ||
            (da.minServings !== null &&
              db.maxServings !== null &&
              da.minServings > db.maxServings) ||
            (db.minServings !== null &&
              da.maxServings !== null &&
              db.minServings > da.maxServings))
        )
          conflict = true;
      }
      if (conflict)
        conflicts.push({
          caseIds: [a.id, b.id],
          message:
            "These cases overlap but prescribe different actions, calorie targets or incompatible portions. Clarify their conditions or correct the superseded decision.",
        });
    }
  const questions: Array<{
    key: string;
    category: string;
    prompt: string;
    reason: string;
  }> = [];
  for (const category of nutritionCategories) {
    const c = current.filter((x) => x.data.category === category);
    if (!c.length)
      questions.push({
        key: category + ":missing",
        category,
        prompt: nutritionQuestions[category],
        reason: "This decision area has no confirmed case.",
      });
    else if (!c.some((x) => x.data.decision))
      questions.push({
        key: category + ":structured",
        category,
        prompt:
          nutritionQuestions[category] +
          " State the exact client conditions and whether the system should plan, ask a question, or refer.",
        reason:
          "Describe the conditions that make this recommendation applicable.",
      });
    else if (c.length < 2)
      questions.push({
        key: category + ":contrast",
        category,
        prompt:
          "Take your " +
          category +
          " example and change one important condition so your recommendation changes. What would you do differently, and why?",
        reason: "A contrasting case distinguishes the decision's limits.",
      });
  }
  const counted = new Map<string, number>();
  for (const e of exceptions) {
    const code = e.data.code ?? "UNKNOWN";
    counted.set(code, (counted.get(code) ?? 0) + 1);
  }
  for (const [code, count] of [...counted]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3))
    questions.unshift({
      key: "exception:" + code,
      category:
        code.includes("CALORIE") || code.includes("TARGET")
          ? "calories"
          : code.includes("RECIPE")
            ? "substitutions"
            : "boundaries",
      prompt: `Clients reached the ${code.replaceAll("_", " ").toLowerCase()} boundary ${count} time(s). Give a de-identified example, your recommendation and the information needed before automatic handling.`,
      reason:
        "This question follows actual exceptions; it does not reveal a client's private details.",
    });
  return {
    conflicts,
    questions,
    coverage: nutritionCategories.map((category) => ({
      category,
      taught: current.filter((c) => c.data.category === category).length,
      structured: current.filter(
        (c) => c.data.category === category && c.data.decision,
      ).length,
      heldOut: scenarios.filter((s) => s.data.category === category).length,
      mealChecks: scenarios.filter(
        (s) => s.data.category === category && s.data.expectedMeal,
      ).length,
    })),
    mealChecks: scenarios.filter((s) => s.data.expectedMeal).length,
    method:
      "Explicit condition overlap and contradictory worked decisions; free-text semantic interpretation still needs coach judgement.",
  };
}
/**
 * How far a worked meal's stated nutrients may be from the stored-fact
 * arithmetic: the rounding the evaluation prompt allows (kcal to a whole
 * number, grams to one decimal place, from the two-decimal ingredient grams)
 * plus the app's own rounding to 0.01.
 */
export const sampleNutrientTolerance = {
  kcal: 0.51,
  protein: 0.051,
  carbohydrate: 0.051,
  fat: 0.051,
} as const;
export function checkNutritionSample(input: {
  sample: any;
  expected: any;
  profile: NutritionProfile;
  policy: NutritionPolicy;
  foods: Food[];
  recipes: Recipe[];
}) {
  const parsed = nutritionSampleMealSchema.safeParse(input.sample);
  if (!parsed.success)
    return { passed: false, reason: "A structured worked meal is required" };
  const sample = parsed.data,
    recipe = input.recipes.find((r) => r.id === sample.recipeId),
    variant = recipe?.variants.find((v) => v.key === sample.variantKey);
  if (!recipe || !variant)
    return { passed: false, reason: "Unknown recipe or cooking option" };
  const expected = input.expected;
  if (
    expected &&
    (!expected.recipeIds.includes(sample.recipeId) ||
      sample.slot !== expected.slot ||
      sample.servings < expected.minServings ||
      sample.servings > expected.maxServings)
  )
    return {
      passed: false,
      reason:
        "Recipe or portion does not match the coach's held-out expectation",
    };
  if (
    !recipe.slots.includes(sample.slot) ||
    sample.servings < input.policy.minServings ||
    sample.servings > input.policy.maxServings
  )
    return {
      passed: false,
      reason: "Meal structure or portion violates policy",
    };
  const facts = new Map(input.foods.map((f) => [f.id, f])),
    incompatible = recipeCompatibility(
      recipe,
      variant,
      facts,
      input.profile,
      input.policy,
    );
  if (incompatible) return { passed: false, reason: incompatible };
  const ingredientTotals = new Map<string, number>();
  for (const i of variant.ingredients)
    ingredientTotals.set(
      i.foodId,
      (ingredientTotals.get(i.foodId) ?? 0) +
        (i.grams * sample.servings) / recipe.yieldServings,
    );
  const expectedIngredients = [...ingredientTotals].map(([foodId, grams]) => ({
    foodId,
    grams: Math.round(grams * 100) / 100,
  }));
  if (
    sample.ingredients.length !== expectedIngredients.length ||
    new Set(sample.ingredients.map((i) => i.foodId)).size !==
      sample.ingredients.length ||
    expectedIngredients.some(
      (i) =>
        !sample.ingredients.some(
          (s) => s.foodId === i.foodId && Math.abs(s.grams - i.grams) <= 0.01,
        ),
    )
  )
    return {
      passed: false,
      reason: "Portion-to-ingredient quantities are inconsistent",
    };
  const nutrients = scaledNutrients(
    expectedIngredients.map((i) => ({
      food: facts.get(i.foodId)!,
      grams: i.grams,
    })),
    1,
  );
  // The evaluation prompt asks for kcal to a whole number and grams to one
  // decimal place (or finer). In the trial every worked meal that failed the
  // old 0.01 check (572 claimed for 571.8 computed, 33.1 g for 33.09 g)
  // differed by rounding alone.
  if (
    (Object.keys(nutrients) as Array<keyof typeof nutrients>).some((k) =>
      nutrients[k] === null
        ? sample.nutrients[k] !== null
        : sample.nutrients[k] === null ||
          Math.abs(sample.nutrients[k]! - nutrients[k]!) >
            sampleNutrientTolerance[k] + 1e-9,
    )
  )
    return {
      passed: false,
      reason: "Nutrient claims disagree with stored ingredient facts",
    };
  return {
    passed: true,
    reason:
      "Recipe, preparation, portion, ingredient and nutrient arithmetic passed",
  };
}
const heldOutText = (s: string) =>
  foldNutritionText(s)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
/**
 * Token Jaccard similarity (0..1) after case, punctuation and Arabic folding;
 * a contained passage of at least four words counts as a copy (1).
 */
export function heldOutSimilarity(a: string, b: string) {
  const x = heldOutText(a),
    y = heldOutText(b);
  if (!x || !y) return 0;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (
    short.split(" ").length >= 4 &&
    (" " + long + " ").includes(" " + short + " ")
  )
    return 1;
  const tx = new Set(x.split(" ")),
    ty = new Set(y.split(" "));
  let shared = 0;
  for (const t of tx) if (ty.has(t)) shared++;
  return shared / (tx.size + ty.size - shared);
}
export const heldOutSimilarityLimit = 0.6;
/** Confirmed teaching cases whose scenario or recommendation a held-out prompt copies. */
export function heldOutOverlaps(
  prompt: string,
  cases: Array<{ id: string; data: any }>,
) {
  return cases
    .filter((c) =>
      [c.data.scenario, c.data.recommendation].some(
        (t) =>
          typeof t === "string" &&
          heldOutSimilarity(prompt, t) >= heldOutSimilarityLimit,
      ),
    )
    .map((c) => c.id);
}
const canonical = (v: any): string =>
  Array.isArray(v)
    ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
/** Whether an equivalent prompt and client profile is already held out. */
export function heldOutDuplicate(
  scenario: { prompt: string; profile: unknown },
  existing: Array<{ data: any }>,
) {
  const prompt = heldOutText(scenario.prompt),
    profile = canonical(scenario.profile);
  return existing.some(
    (s) =>
      heldOutText(String(s.data.prompt ?? "")) === prompt &&
      canonical(s.data.profile) === profile,
  );
}
/**
 * Held-out checks that can no longer pass against current teaching, policy and
 * catalog, so the coach can archive or replace them before a paid evaluation.
 */
export function staleHeldOut(
  scenarios: Array<{ id: string; data: any }>,
  cases: Array<{ id: string }>,
  policy: NutritionPolicy,
  catalog: { foods: Food[]; recipes: Recipe[] },
) {
  const foods = new Map(catalog.foods.map((f) => [f.id, f])),
    stale: Array<{ scenarioId: string; reasons: string[] }> = [];
  for (const s of scenarios) {
    const d = s.data,
      reasons: string[] = [];
    if (!cases.some((c) => c.id === d.expectedCaseId))
      reasons.push("Its teaching case was changed or retired.");
    let target: number | null = null;
    try {
      target = nutritionTarget(policy, d.profile);
    } catch {}
    if ((target === null ? "exception" : "plan") !== d.expect)
      reasons.push(
        target === null
          ? "The current policy now routes this profile to an exception."
          : "The current policy now plans for this profile.",
      );
    else if ((d.expectedTargetKcal ?? null) !== target)
      reasons.push(
        `The expected calorie target differs from the current policy (${target ?? "no target"}).`,
      );
    const meal = d.expectedMeal;
    if (d.expect === "plan" && meal && target !== null) {
      if (
        Math.max(meal.minServings, policy.minServings) >
        Math.min(meal.maxServings, policy.maxServings)
      )
        reasons.push(
          "The expected portions are outside the current serving limits.",
        );
      if (
        !catalog.recipes.some(
          (r) =>
            meal.recipeIds.includes(r.id) &&
            r.slots.includes(meal.slot) &&
            policy.slots.includes(meal.slot) &&
            r.variants.some(
              (v) => !recipeCompatibility(r, v, foods, d.profile, policy),
            ),
        )
      )
        reasons.push(
          "No expected recipe is still available and compatible with this profile.",
        );
    }
    if (reasons.length) stale.push({ scenarioId: s.id, reasons });
  }
  return stale;
}
export function rationaleMatches(
  decision: any,
  scenario: any,
  cases: Array<{ id: string; data: any }>,
) {
  const cite = decision?.rationaleEvidence,
    source = cases.find((c) => c.id === cite?.caseId),
    // System safety checks accept several teaching cases (see /evaluate).
    accepted: string[] = scenario.acceptedCaseIds ?? [scenario.expectedCaseId];
  if (
    !source ||
    !accepted.includes(cite.caseId) ||
    !decision.caseIds.includes(source.id) ||
    typeof cite.quote !== "string" ||
    normalized(cite.quote).length < 12 ||
    normalized(cite.quote).split(" ").length < 3
  )
    return false;
  const material = [
    source.data.recommendation,
    source.data.reason,
    source.data.changeWhen,
    source.data.referWhen,
    source.data.avoid,
  ].join(" ");
  return (
    normalized(material).includes(normalized(cite.quote)) &&
    decision.principle ===
      (scenario.expectedPrinciple ?? principleForCategory[scenario.category])
  );
}
