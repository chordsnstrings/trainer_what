import { z } from "zod";

// The equation estimates resting energy; activity multipliers are explicit
// planning assumptions, not measurements or part of the original equation.
export const nutritionActivityFactors = {
  low: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
} as const;
export const energyInputsSchema = z
  .object({
    heightCm: z.number().min(120).max(230),
    equationSex: z.enum(["female", "male"]),
    activity: z.enum(["low", "light", "moderate", "high"]),
  })
  .strict();
export const energyAdjustmentSchema = z
  .object({
    goal: z.string().trim().min(1).max(100),
    // Intent is explicit; never infer it from the person's language or weight.
    intent: z.enum(["lose", "maintain", "gain"]),
    adjustmentKcal: z.number().int().min(-500).max(500),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      (v.intent === "lose" && v.adjustmentKcal >= 0) ||
      (v.intent === "maintain" && v.adjustmentKcal !== 0) ||
      (v.intent === "gain" && v.adjustmentKcal <= 0)
    )
      c.addIssue({
        code: "custom",
        message:
          "Use a deficit for loss, zero for maintenance, or a surplus for gain",
      });
  });
export const ENERGY_VERSION = "mifflin-coach-v1";
export function estimateNutritionEnergy(profile: {
  age: number;
  weightKg?: number;
  energy?: z.infer<typeof energyInputsSchema>;
}) {
  const e = profile.energy;
  if (!e || !profile.weightKg) return null;
  const rest =
    10 * profile.weightKg +
    6.25 * e.heightCm -
    5 * profile.age +
    (e.equationSex === "male" ? 5 : -161);
  return {
    restingKcal: Math.round(rest),
    maintenanceKcal: Math.round(rest * nutritionActivityFactors[e.activity]),
    activityFactor: nutritionActivityFactors[e.activity],
    bmi: profile.weightKg / (e.heightCm / 100) ** 2,
    calculationVersion: ENERGY_VERSION,
  };
}

/** Conservative product boundary for the optional general-wellness method.
 * This is not a clinical prescription or a prediction of kg lost per week. */
export function personalEnergyTarget(
  profile: Parameters<typeof estimateNutritionEnergy>[0],
  adjustmentKcal: number,
) {
  const estimate = estimateNutritionEnergy(profile);
  if (!estimate) return { error: "TARGET_INPUT" as const };
  if (profile.age < 19 || profile.age > 78 || estimate.bmi < 18.5)
    return { error: "SCOPE_REVIEW" as const };
  const kcal = estimate.maintenanceKcal + adjustmentKcal;
  if (
    !Number.isFinite(kcal) ||
    kcal <= 1200 ||
    Math.abs(adjustmentKcal) > 500 ||
    adjustmentKcal < -estimate.maintenanceKcal * 0.25
  )
    return { error: "TARGET_LIMIT" as const };
  return { ...estimate, kcal, adjustmentKcal };
}
