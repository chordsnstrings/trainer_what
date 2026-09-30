import { z } from "zod";
import {
  NutritionBlocked,
  dailyKcalRange,
  recipeCompatibility,
  scaledNutrients,
  type Food,
  type NutritionPolicy,
  type NutritionProfile,
  type Recipe,
} from "./nutrition.ts";
import { macroRange, type NutritionTarget } from "./nutrition-completion.ts";

/**
 * Meal-week planning support shared by the prompt and the checks: the exact
 * numbers a week must meet, per-serving facts for each recipe option, the
 * deterministic "can this catalog fill a week at all" check, and the reply
 * shape for a week the model declines.
 */

type Nutrients = Record<
  "kcal" | "protein" | "carbohydrate" | "fat",
  number | null
>;
const round2 = (n: number | null) =>
  n === null ? null : Math.round(n * 100) / 100;

/** Nutrients of one serving of a recipe option, from the stored ingredient facts. */
export function servingNutrients(
  recipe: Recipe,
  variant: Recipe["variants"][number],
  foods: Map<string, Food>,
): Nutrients {
  const whole = scaledNutrients(
    variant.ingredients.map((i) => ({
      food: foods.get(i.foodId)!,
      grams: i.grams,
    })),
    1,
  );
  return {
    kcal: round2(
      whole.kcal === null ? null : whole.kcal / recipe.yieldServings,
    ),
    protein: round2(
      whole.protein === null ? null : whole.protein / recipe.yieldServings,
    ),
    carbohydrate: round2(
      whole.carbohydrate === null
        ? null
        : whole.carbohydrate / recipe.yieldServings,
    ),
    fat: round2(whole.fat === null ? null : whole.fat / recipe.yieldServings),
  };
}

/**
 * Recipes as the model sees them: every option carries `perServing`, the
 * nutrients of one serving computed from the coach's ingredient facts, so the
 * model scales servings instead of re-deriving nutrients from grams (the
 * trial's Seed weeks undershot the daily target by 20 to 35 percent).
 */
export function recipesWithServingFacts(recipes: Recipe[], foods: Food[]) {
  const facts = new Map(foods.map((f) => [f.id, f]));
  return recipes.map((r) => ({
    ...r,
    variants: r.variants.map((v) => ({
      ...v,
      perServing: v.ingredients.every((i) => facts.has(i.foodId))
        ? servingNutrients(r, v, facts)
        : null,
    })),
  }));
}

export type NutritionWeekLimits = {
  slots: string[];
  kcal: { target: number; min: number; max: number; tolerancePercent: number };
  macros: Array<{
    key: "protein" | "carbohydrate" | "fat";
    target: number;
    min: number;
    max: number;
  }>;
  servings: { min: number; max: number; step: 0.25 };
  maxRecipeRepeats: number;
};

/** The numbers one week must meet; the prompt states them and the validators apply them. */
export function nutritionWeekLimits(input: {
  policy: NutritionPolicy;
  targetKcal: number;
  individualTarget?: NutritionTarget | null;
}): NutritionWeekLimits {
  const { policy, targetKcal, individualTarget } = input;
  const kcal = dailyKcalRange(targetKcal, policy.tolerancePercent);
  return {
    slots: [...policy.slots],
    kcal: {
      target: targetKcal,
      ...kcal,
      tolerancePercent: policy.tolerancePercent,
    },
    macros: individualTarget
      ? (["protein", "carbohydrate", "fat"] as const).flatMap((key) =>
          individualTarget[key] === null
            ? []
            : [
                {
                  key,
                  target: individualTarget[key]!,
                  ...macroRange(
                    individualTarget[key]!,
                    individualTarget.macroTolerancePercent,
                  ),
                },
              ],
        )
      : [],
    servings: { min: policy.minServings, max: policy.maxServings, step: 0.25 },
    maxRecipeRepeats: policy.maxRecipeRepeats,
  };
}

/**
 * The meal-week instructions with the week's numbers written out: the daily
 * kcal range (exactly the range validateNutritionWeek applies), macro ranges
 * from an individual target, serving limits, slots and the repeat limit, and
 * the self-check the model must do before answering. A week that cannot meet
 * them is declined, never bent. The coach's boundaries come before any of it:
 * a profile they cover, or one the model is unsure about, is declined too
 * (the code screen in nutritionTarget runs first and does not rely on this).
 */
export function nutritionWeekInstruction(limits: NutritionWeekLimits) {
  const { kcal, servings } = limits;
  const macroLines = limits.macros.map(
    (m) =>
      `Daily ${m.key}: target ${m.target} g; each day's total must be between ${m.min} and ${m.max} g.`,
  );
  return [
    "Plan one week of meals for this client using only the coach's supplied recipes. Every number below is a hard limit set by the coach.",
    "Coach boundaries come first: before planning, read the client's profile (goal, diet, allergies, exclusions and notes) against the policy's boundaries and the coach's boundaries teaching case. If anything in the profile falls under a boundary (for example a medical condition, a medication or supplement, pregnancy or breastfeeding, an eating disorder, or eating times these slots cannot follow, such as fasting), or you are not sure whether it does, do not plan: decline the week as described at the end and cite the boundaries case.",
    "Days: exactly 7, offsets 0 to 6.",
    `Meals: every day has exactly one meal for each of these slots, no more and no fewer: ${limits.slots.join(", ")}.`,
    `Portions: each meal's servings is from ${servings.min} to ${servings.max}, in steps of 0.25.`,
    `Daily energy: the target is ${kcal.target} kcal, fixed by the coach (do not calculate another). Each day's total must be between ${kcal.min} and ${kcal.max} kcal (the target plus or minus ${kcal.tolerancePercent}%, whole kcal). Aim close to ${kcal.target}.`,
    ...macroLines,
    `Repeats: one recipe may be used at most ${limits.maxRecipeRepeats} times in the week, counting every slot.`,
    "Recipes: use a recipe only in a slot listed in its slots, and only one of its listed options (its key is the variantKey); never use anything else. The supplied options were filtered for the client's diet, allergies, exclusions, equipment, time and budget only; that filtering does not check the coach's boundaries.",
    `A meal's nutrients are its servings times the option's perServing values. Before answering, add up each day's kcal${limits.macros.length ? " and " + limits.macros.map((m) => m.key).join(", ") : ""} from those numbers and change servings until every day is inside its range.`,
    "batchKey is null, or a short key shared by meals cooked in one batch; one batch uses one recipe and option.",
    "caseIds: the references of the coach teaching cases that support this week.",
    "explanation: one to three plain sentences for the client, with no IDs or references and no medical, supplement or dosage advice; any calorie number must be the target or a day's total.",
    'Return only JSON {"days":[{"offset":0,"meals":[{"slot":"...","recipeId":"...","variantKey":"...","servings":1,"batchKey":null}]}],"caseIds":["..."],"explanation":"..."}.',
    'To decline, when a coach boundary applies or you are unsure, or when no week can meet every limit above with these recipes, do not invent a recipe or bend a limit: return {"days":[],"caseIds":[...],"explanation":"the reason, for the coach"} and the coach will review it.',
  ].join(" ");
}

/** A reply that declines the week: no days, the coach reviews the reason. */
export const declinedWeekSchema = z
  .object({
    days: z.array(z.never()).length(0),
    caseIds: z.array(z.string().uuid()).max(40),
    explanation: z.string().trim().min(1).max(3000),
  })
  .strict();
export const PLAN_NOT_POSSIBLE_MESSAGE =
  "A complete meal week that follows all of your coach's rules could not be prepared automatically. Your coach will review it; your current valid plan is preserved.";
/** The coach-only note stored with a declined week (model text, bounded). */
export function declinedWeekDetail(explanation: string) {
  return (
    "The meal assistant declined this week: " +
    explanation.replace(/\s+/g, " ").trim().slice(0, 1000)
  );
}

export const CATALOG_GAP_MESSAGE =
  "Your coach's recipes cannot yet make a complete meal week that fits your food preferences, equipment and time. Your coach has been asked to review it; your current valid plan is preserved.";

/**
 * Whether the coach's catalog can fill a week for this client at all, decided
 * before any model call. A slot with no suitable recipe, too few suitable
 * recipes for seven days under the repeat limit, or a daily kcal range that
 * even the smallest or largest allowed portions cannot reach, makes every
 * possible week invalid, so the request goes to the coach (CATALOG_GAP) and
 * no model is paid for. The checks are exact for slots and repeats (a
 * max-flow condition) and necessary for energy, so a week that could pass
 * the validator is never blocked here.
 */
export function nutritionWeekFeasibility(input: {
  policy: NutritionPolicy;
  profile: NutritionProfile;
  foods: Food[];
  recipes: Recipe[];
  targetKcal: number;
}): NutritionBlocked | null {
  const { policy, profile } = input;
  const facts = new Map(input.foods.map((f) => [f.id, f]));
  const usable = input.recipes.flatMap((r) => {
    const options = r.variants.filter(
      (v) => !recipeCompatibility(r, v, facts, profile, policy),
    );
    const slots = r.slots.filter((s) => policy.slots.includes(s));
    if (!options.length || !slots.length) return [];
    const kcal = options.map((v) => servingNutrients(r, v, facts).kcal ?? 0);
    return [
      {
        name: r.name,
        slots,
        minKcal: Math.min(...kcal),
        maxKcal: Math.max(...kcal),
      },
    ];
  });
  const who = `diet ${profile.diet}; equipment ${profile.equipment.join(", ") || "none"}; up to ${profile.maxMinutes} minutes; ${profile.budget} budget${profile.allergens.length ? "; allergies " + profile.allergens.join(", ") : ""}${profile.exclusions.length ? "; excludes " + profile.exclusions.join(", ") : ""}`;
  const gap = (detail: string) =>
    new NutritionBlocked("CATALOG_GAP", CATALOG_GAP_MESSAGE, detail);
  const empty = policy.slots.filter(
    (s) => !usable.some((u) => u.slots.includes(s)),
  );
  if (empty.length)
    return gap(
      `No recipe option fits this client for ${empty.join(", ")} (${who}). Add a suitable recipe or option, or plan this week personally.`,
    );
  // Every group of slots needs seven meals each from the recipes usable in
  // it; a recipe gives at most maxRecipeRepeats meals in total and at most
  // seven per slot. This condition over all groups is exact (max-flow min-cut).
  const n = policy.slots.length,
    cap = policy.maxRecipeRepeats;
  for (let mask = 1; mask < 1 << n; mask++) {
    const group = policy.slots.filter((_, i) => mask & (1 << i));
    let meals = 0;
    const names: string[] = [];
    for (const u of usable) {
      const shared = u.slots.filter((s) => group.includes(s)).length;
      if (!shared) continue;
      meals += Math.min(cap, 7 * shared);
      names.push(u.name);
    }
    if (meals < 7 * group.length)
      return gap(
        `${group.join(" and ")} need${group.length === 1 ? "s" : ""} ${7 * group.length} meals a week, but the recipes that fit this client there (${names.join(", ")}) allow at most ${meals} at ${cap} uses per recipe (${who}). Add recipes or options, or change the repeat limit.`,
      );
  }
  const range = dailyKcalRange(input.targetKcal, policy.tolerancePercent);
  const most = policy.slots.reduce(
      (sum, s) =>
        sum +
        Math.max(
          ...usable.filter((u) => u.slots.includes(s)).map((u) => u.maxKcal),
        ) *
          policy.maxServings,
      0,
    ),
    least = policy.slots.reduce(
      (sum, s) =>
        sum +
        Math.min(
          ...usable.filter((u) => u.slots.includes(s)).map((u) => u.minKcal),
        ) *
          policy.minServings,
      0,
    );
  // A one-kcal margin covers the rounding of per-serving figures, so a day
  // the validator could accept is never called impossible here.
  if (most < range.min - 1)
    return gap(
      `Even the largest allowed portions (${policy.maxServings} servings) of the recipes that fit this client reach about ${Math.round(most)} kcal a day, below the ${range.min} to ${range.max} kcal range for the ${input.targetKcal} kcal target (${who}).`,
    );
  if (least > range.max + 1)
    return gap(
      `Even the smallest allowed portions (${policy.minServings} servings) of the recipes that fit this client come to about ${Math.round(least)} kcal a day, above the ${range.min} to ${range.max} kcal range for the ${input.targetKcal} kcal target (${who}).`,
    );
  return null;
}
