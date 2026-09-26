import {
  nutritionCategories,
  nutritionQuestions,
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
const normalized = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
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
  if (
    (Object.keys(nutrients) as Array<keyof typeof nutrients>).some((k) =>
      nutrients[k] === null
        ? sample.nutrients[k] !== null
        : sample.nutrients[k] === null ||
          Math.abs(sample.nutrients[k]! - nutrients[k]!) > 0.01,
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
export function rationaleMatches(
  decision: any,
  scenario: any,
  cases: Array<{ id: string; data: any }>,
) {
  const cite = decision?.rationaleEvidence,
    source = cases.find((c) => c.id === cite?.caseId);
  if (
    !source ||
    cite.caseId !== scenario.expectedCaseId ||
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
