import { z } from "zod";
export const nutritionPrinciples = [
  "diet_match",
  "goal_target",
  "portion_arithmetic",
  "allergen_limit",
  "equipment_time",
  "budget_limit",
  "adjustment_limit",
  "scope_referral",
] as const;
export const principleForCategory: Record<
  string,
  (typeof nutritionPrinciples)[number]
> = {
  diet: "diet_match",
  calories: "goal_target",
  portions: "portion_arithmetic",
  substitutions: "allergen_limit",
  cooking: "equipment_time",
  budget: "budget_limit",
  adjustments: "adjustment_limit",
  boundaries: "scope_referral",
};
export const nutritionTeachingDecisionSchema = z
  .object({
    conditions: z
      .object({
        goal: z.string().trim().max(100).nullable(),
        diet: z.string().trim().max(80).nullable(),
        budget: z.enum(["low", "moderate", "flexible"]).nullable(),
        scope: z.enum(["general_wellness", "specialist_needed", "unknown"]),
        allergy: z.enum(["known", "unknown"]),
      })
      .strict(),
    action: z.enum(["plan", "clarify", "refer"]),
    targetKcal: z.number().int().min(1).max(10000).nullable(),
    minServings: z.number().positive().max(10).nullable(),
    maxServings: z.number().positive().max(10).nullable(),
    principle: z.enum(nutritionPrinciples),
  })
  .strict()
  .superRefine((x, c) => {
    if (
      x.minServings !== null &&
      x.maxServings !== null &&
      x.minServings > x.maxServings
    )
      c.addIssue({ code: "custom", message: "Portion bounds are reversed" });
    if (
      x.action !== "plan" &&
      (x.targetKcal !== null ||
        x.minServings !== null ||
        x.maxServings !== null)
    )
      c.addIssue({
        code: "custom",
        message:
          "Clarification and referral cases must withhold calorie and portion prescriptions",
      });
  });
export const nutritionExpectedMealSchema = z
  .object({
    recipeIds: z.array(z.string().uuid()).min(1).max(20),
    slot: z.string().min(1).max(50),
    minServings: z.number().positive().max(10).multipleOf(0.25),
    maxServings: z.number().positive().max(10).multipleOf(0.25),
  })
  .strict()
  .refine(
    (x) => x.minServings <= x.maxServings,
    "Expected portions are reversed",
  );
export const nutritionSampleMealSchema = z
  .object({
    slot: z.string().min(1).max(50),
    recipeId: z.string().uuid(),
    variantKey: z.string().min(1).max(40),
    servings: z.number().positive().max(10).multipleOf(0.25),
    ingredients: z
      .array(
        z
          .object({
            foodId: z.string().uuid(),
            grams: z.number().positive().max(100000),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    nutrients: z
      .object({
        kcal: z.number().min(0).max(10000).nullable(),
        protein: z.number().min(0).max(10000).nullable(),
        carbohydrate: z.number().min(0).max(10000).nullable(),
        fat: z.number().min(0).max(10000).nullable(),
      })
      .strict(),
  })
  .strict();
