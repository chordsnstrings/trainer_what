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
