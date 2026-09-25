import { randomUUID } from "node:crypto";
import {
  nutritionCategories,
  nutritionQuestions,
  type NutritionProfile,
  type NutritionPolicy,
  type Recipe,
  type Food,
  type NutritionWeek,
} from "../packages/domain/src/nutrition.ts";
export const fixtureProfile: NutritionProfile = {
  age: 35,
  goal: "Consistency",
  diet: "balanced",
  allergyStatus: "none_reported",
  allergens: [],
  exclusions: [],
  equipment: ["hob", "microwave"],
  maxMinutes: 30,
  budget: "moderate",
  scopeStatus: "general_wellness",
  timezone: "Asia/Dubai",
  notes: "Synthetic profile used for development verification.",
};
export function fixtureCases() {
  return nutritionCategories.map((category) => ({
    id: randomUUID(),
    category,
    scenario: nutritionQuestions[category],
    recommendation:
      "For this synthetic case use the explicit Consistency policy, three meal slots and the reviewed ingredient library. Do not infer other goals.",
    reason: "Test that decisions stay connected to this coach's own evidence.",
    alternatives:
      "Use either reviewed cooking option when equipment is available.",
    avoid:
      "Never invent an ingredient fact, ignore an exclusion or alter an unsupported target.",
    changeWhen:
      "Change only inside the confirmed portion and target ranges after the stated check-in cadence.",
    referWhen:
      "Missing information, unsupported goals and ingredient conflicts need clarification.",
    rights: true as const,
  }));
}
export function fixturePolicy(ids: string[]): NutritionPolicy {
  return {
    title: "Everyday nutrition — synthetic fixture",
    approach:
      "Three practical meals and measured portions for the explicit Consistency example. This is development data, not a dietary recommendation.",
    supportedDiets: ["balanced"],
    minAge: 18,
    maxAge: 80,
    targets: [
      {
        goal: "Consistency",
        kcal: 1500,
        reason: "Synthetic arithmetic test target",
      },
    ],
    minKcal: 1200,
    maxKcal: 2200,
    tolerancePercent: 5,
    slots: ["Breakfast", "Lunch", "Dinner"],
    minServings: 0.5,
    maxServings: 2,
    maxRecipeRepeats: 7,
    allowSwaps: true,
    forbiddenIngredients: [],
    adjustment: {
      enabled: false,
      trigger: "hunger_high",
      requiredCheckins: 2,
      minimumDays: 7,
      deltaKcal: 0,
      reason: "Automatic target changes are disabled for the baseline fixture",
    },
    boundaries:
      "General wellness fixture only; specialist needs and unknown allergies must be escalated.",
    sourceIds: ids,
  };
}
export function fixtureCatalog() {
  const foods: Food[] = [
    "Oat mixture",
    "Rice & chicken mixture",
    "Rice & chickpea mixture",
  ].map((name) => ({
    id: randomUUID(),
    name,
    preparation: "cooked",
    nutrientsPer100g: { kcal: 100, protein: 5, carbohydrate: 12, fat: 3 },
    allergens: [],
    ingredientTags: [name.toLowerCase()],
    allergenReviewComplete: true,
    estimated: true,
    source: "SYNTHETIC DEVELOPMENT FIXTURE — not real food-composition facts",
  }));
  const recipes: Recipe[] = [
    "Warm breakfast bowl",
    "Lemon chicken & rice",
    "Chickpea supper bowl",
  ].map((name, i) => ({
    id: randomUUID(),
    name,
    description:
      "Illustrative recipe for testing connected portions and grocery arithmetic.",
    dietTags: ["balanced"],
    slots: [["Breakfast", "Lunch", "Dinner"][i]],
    budget: "low",
    yieldServings: 1,
    source: "Synthetic coach recipe fixture",
    variants: [
      {
        key: "hob",
        name: "Hob preparation",
        equipment: ["hob"],
        minutes: 20,
        steps: [
          "Use the measured ingredients from this illustrative recipe.",
          "Follow the food producer's preparation and safe storage instructions.",
        ],
        ingredients: [{ foodId: foods[i].id, grams: i === 0 ? 400 : 550 }],
        storageNote:
          "Follow the actual ingredient label; this fixture is not food-storage guidance.",
      },
      {
        key: "microwave",
        name: "Microwave option",
        equipment: ["microwave"],
        minutes: 10,
        steps: [
          "Measure the same allocated portion.",
          "Follow the product and appliance instructions.",
        ],
        ingredients: [{ foodId: foods[i].id, grams: i === 0 ? 400 : 550 }],
        storageNote: "Use the product's actual storage instructions.",
      },
    ],
  }));
  return { foods, recipes };
}
export function fixtureWeek(
  recipes: Recipe[],
  caseIds: string[],
): NutritionWeek {
  return {
    days: Array.from({ length: 7 }, (_, offset) => ({
      offset,
      meals: ["Breakfast", "Lunch", "Dinner"].map((slot) => ({
        slot,
        recipeId: recipes.find((r) => r.slots.includes(slot))!.id,
        variantKey: "hob",
        servings: 1,
        batchKey: null,
      })),
    })),
    caseIds,
    explanation:
      "Synthetic week demonstrating the coach's three-meal approach. All food values here are fixture data.",
  };
}
