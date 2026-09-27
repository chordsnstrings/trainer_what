import { z } from "zod";
import {
  NutritionBlocked,
  nutritionTarget,
  type NutritionPolicy,
  type NutritionProfile,
} from "./nutrition.ts";
const text = (max = 2000) => z.string().trim().min(1).max(max);
export const nutritionMethodSchema = z
  .object({
    name: text(160),
    kind: z.enum(["fixed", "weight_activity"]),
    fixedKcal: z.number().int().min(1).max(10000).nullable(),
    kcalPerKg: z.number().positive().max(100).nullable(),
    activityFactor: z.number().min(1).max(3),
    adjustmentKcal: z.number().int().min(-1000).max(1000),
    reason: text(),
    sourceIds: z.array(z.string().uuid()).min(1).max(40),
  })
  .strict()
  .superRefine((m, c) => {
    if (
      (m.kind === "fixed" && m.fixedKcal === null) ||
      (m.kind === "weight_activity" && m.kcalPerKg === null)
    )
      c.addIssue({
        code: "custom",
        message: "Complete the selected calorie method",
      });
  });
export type NutritionMethod = z.infer<typeof nutritionMethodSchema>;
export const nutritionTargetSchema = z
  .object({
    kcal: z.number().int().min(1).max(10000),
    protein: z.number().min(0).max(1000).nullable(),
    carbohydrate: z.number().min(0).max(1500).nullable(),
    fat: z.number().min(0).max(1000).nullable(),
    macroTolerancePercent: z.number().min(5).max(40),
    hydrationMl: z.number().int().min(0).max(10000).nullable(),
    habits: z.array(text(200)).max(10),
    reviewOn: z.iso.date(),
    reason: text(),
    allowAutomaticAdjustment: z.boolean(),
  })
  .strict();
export type NutritionTarget = z.infer<typeof nutritionTargetSchema>;
export function calculateCoachTarget(
  method: NutritionMethod,
  input: { weightKg?: number },
  policy: NutritionPolicy,
  profile: NutritionProfile,
) {
  nutritionTarget(policy, profile);
  if (
    method.kind === "weight_activity" &&
    (!input.weightKg || input.weightKg < 20 || input.weightKg > 500)
  )
    throw new NutritionBlocked(
      "TARGET_INPUT",
      "The coach's method requires a confirmed current body weight.",
    );
  const kcal = Math.round(
    (method.kind === "fixed"
      ? method.fixedKcal!
      : input.weightKg! * method.kcalPerKg! * method.activityFactor) +
      method.adjustmentKcal,
  );
  if (kcal < policy.minKcal || kcal > policy.maxKcal)
    throw new NutritionBlocked(
      "TARGET_LIMIT",
      "The calculated target is outside the coach's approved calorie limits.",
    );
  return kcal;
}
export function validateClientTargets(
  view: { days: Array<{ totals: Record<string, number | null> }> },
  target: NutritionTarget | null,
) {
  if (!target) return;
  for (const day of view.days)
    for (const key of ["protein", "carbohydrate", "fat"] as const) {
      const goal = target[key];
      if (
        goal !== null &&
        (day.totals[key] === null ||
          Math.abs(day.totals[key]! - goal) >
            Math.max(1, (goal * target.macroTolerancePercent) / 100))
      )
        throw new NutritionBlocked(
          "MACRO_POLICY",
          `A day's ${key} estimate is outside the coach's agreed range.`,
        );
    }
}

export const mealNutrientsSchema = z
  .object({
    kcal: z.number().min(0).max(10000).nullable(),
    protein: z.number().min(0).max(10000).nullable(),
    carbohydrate: z.number().min(0).max(10000).nullable(),
    fat: z.number().min(0).max(10000).nullable(),
  })
  .strict();
export function currentMealLogs(logs: Array<{ id: string; data: any }>) {
  const corrected = new Set(logs.map((x) => x.data.correctsId).filter(Boolean));
  return logs.filter((x) => !x.data.deleted && !corrected.has(x.id));
}
export function consumedNutrition(
  logs: Array<{ id: string; data: any }>,
  plans: Array<{ id: string; data: any; status: string }>,
  checkins: Array<{ id: string; data: any }>,
  today: string,
) {
  const cutoff = new Date(Date.parse(today + "T12:00:00Z") - 27 * 86400000)
      .toISOString()
      .slice(0, 10),
    current = currentMealLogs(logs).filter(
      (x) => x.data.date >= cutoff && x.data.date <= today,
    );
  const days = Array.from({ length: 28 }, (_, i) => {
    const date = new Date(Date.parse(cutoff + "T12:00:00Z") + i * 86400000)
        .toISOString()
        .slice(0, 10),
      entries = current.filter((x) => x.data.date === date),
      totals: any = {},
      knownTotals: any = {},
      unknown: any = {};
    for (const k of ["kcal", "protein", "carbohydrate", "fat"] as const) {
      const values = entries.map((x) => {
        const nutrients = x.data.nutrients ?? x.data.mealSnapshot?.nutrients;
        return k === "kcal"
          ? (x.data.kcal ?? nutrients?.kcal ?? null)
          : (nutrients?.[k] ?? null);
      });
      unknown[k] = values.filter((v) => v === null).length;
      knownTotals[k] =
        Math.round(values.reduce((sum, v) => sum + (v ?? 0), 0) * 100) / 100;
      totals[k] = entries.length && unknown[k] === 0 ? knownTotals[k] : null;
    }
    const planned =
      plans
        .find(
          (p) =>
            p.status === "delivered" &&
            p.data.view.days.some((d: any) => d.date === date),
        )
        ?.data.view.days.find((d: any) => d.date === date)?.totals ?? null;
    return {
      date,
      meals: entries.length,
      totals,
      knownTotals,
      unknown,
      planned,
      sourceIds: entries.map((x) => x.id),
    };
  });
  const weights = checkins
    .filter(
      (x) =>
        x.data.date >= cutoff &&
        x.data.date <= today &&
        typeof x.data.weightKg === "number",
    )
    .sort((a, b) => a.data.date.localeCompare(b.data.date));
  const weightDays = new Map<
    string,
    { date: string; kg: number; sourceId: string }
  >();
  for (const x of weights)
    if (!weightDays.has(x.data.date))
      weightDays.set(x.data.date, {
        date: x.data.date,
        kg: x.data.weightKg,
        sourceId: x.id,
      });
  const uniqueWeights = [...weightDays.values()];
  return {
    days,
    loggedDays: days.filter((d) => d.meals).length,
    loggedMeals: current.length,
    weights: uniqueWeights,
    weightChangeKg:
      uniqueWeights.length > 1
        ? Math.round((uniqueWeights.at(-1)!.kg - uniqueWeights[0].kg) * 100) /
          100
        : null,
    coverage:
      "Recorded meals only. Blank days and unknown nutrients are not zero intake.",
  };
}
export function scaleCapturedPortion<
  T extends {
    amount: number | null;
    unit: string | null;
    kcal: number | null;
    protein: number | null;
    carbohydrate: number | null;
    fat: number | null;
    portion: string;
  },
>(item: T, amount: number | null, unit = item.unit): T {
  const scaled = {
    ...item,
    amount,
    unit,
    portion: amount && unit ? `${amount} ${unit}` : item.portion,
  };
  if (
    item.amount !== null &&
    amount !== null &&
    item.unit === unit &&
    item.amount > 0
  )
    for (const key of ["kcal", "protein", "carbohydrate", "fat"] as const)
      scaled[key] =
        item[key] === null
          ? null
          : Math.round(((item[key]! * amount) / item.amount) * 100) / 100;
  else if (unit !== item.unit || (item.amount === null && amount !== null))
    for (const key of ["kcal", "protein", "carbohydrate", "fat"] as const)
      scaled[key] = null;
  return scaled;
}
export const purchaseSpecSchema = z
  .object({
    foodId: z.string().uuid(),
    purchaseGramsPerEdibleGram: z.number().positive().max(30),
    packGrams: z.number().positive().max(100000).nullable(),
    label: z.string().trim().min(1).max(120),
    source: z.string().trim().min(5).max(1000),
  })
  .strict();
export function groceryPurchases(
  groceries: Array<{ food: any; grams: number }>,
  specs: Array<{ data: any }>,
  inventory: Array<{ data: any; status: string }>,
  today: string,
  mealDays?: Array<{
    date: string;
    meals: Array<{
      ingredients: Array<{ food: { id: string }; grams: number }>;
    }>;
  }>,
) {
  return groceries.map((g) => {
    const spec = specs.find((s) => s.data.foodId === g.food.id)?.data,
      available = inventory
        .filter(
          (i) =>
            i.status === "available" &&
            i.data.foodId === g.food.id &&
            i.data.useBy >= today,
        )
        .sort((a, b) => a.data.useBy.localeCompare(b.data.useBy)),
      neededByDate = mealDays
        ?.filter((d) => d.date >= today)
        .map((d) => ({
          date: d.date,
          grams: d.meals.reduce(
            (sum, m) =>
              sum +
              m.ingredients
                .filter((i) => i.food.id === g.food.id)
                .reduce((n, i) => n + i.grams, 0),
            0,
          ),
        }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      availableGrams = available.reduce((sum, i) => {
        let grams = i.data.grams,
          used = 0;
        if (!neededByDate) return sum + grams;
        for (const d of neededByDate) {
          if (d.date > i.data.useBy) break;
          const take = Math.min(grams, d.grams);
          d.grams -= take;
          grams -= take;
          used += take;
        }
        return sum + used;
      }, 0),
      remainingGrams = Math.max(
        0,
        Math.round((g.grams - availableGrams) * 100) / 100,
      ),
      purchaseGrams = spec
        ? Math.round(remainingGrams * spec.purchaseGramsPerEdibleGram * 100) /
          100
        : null,
      packs =
        spec?.packGrams && purchaseGrams !== null
          ? Math.ceil(purchaseGrams / spec.packGrams)
          : null;
    return {
      ...g,
      availableGrams,
      remainingGrams,
      purchaseGrams,
      packs,
      purchasedGrams: packs !== null ? packs * spec.packGrams : purchaseGrams,
      purchaseLabel: spec?.label ?? null,
      conversionSource: spec?.source ?? null,
    };
  });
}
