import { groceryPurchases } from "./nutrition-completion.ts";
import {
  estimateNutritionEnergy,
  personalEnergyTarget,
} from "./nutrition-energy.ts";
import {
  nutritionTarget,
  recipeCompatibility,
  type NutritionProfile,
  type NutritionPolicy,
  type Recipe,
  type Food,
} from "./nutrition.ts";

export function nutritionGuidance(
  policy: NutritionPolicy | undefined,
  profile: NutritionProfile | undefined,
  foods: Food[],
  recipes: Recipe[],
) {
  if (!policy || !profile) return null;
  let targetKcal: number;
  try {
    targetKcal = nutritionTarget(policy, profile);
  } catch (error) {
    return {
      state: "review",
      code: (error as { code?: string }).code,
      energy: null,
      diets: [],
    };
  }
  const rule = policy.energyAdjustments?.find(
    (g) => g.goal.toLowerCase() === profile.goal.toLowerCase(),
  );
  const estimate = estimateNutritionEnergy(profile);
  const energy =
    estimate && !personalEnergyTarget(profile, 0).error
      ? {
          restingKcal: estimate.restingKcal,
          maintenanceKcal: estimate.maintenanceKcal,
          activityFactor: estimate.activityFactor,
          calculationVersion: estimate.calculationVersion,
          targetKcal,
          adjustmentKcal: targetKcal - estimate.maintenanceKcal,
          personalized: !!rule,
        }
      : null;
  const facts = new Map(foods.map((f) => [f.id, f]));
  const diets = policy.supportedDiets
    .map((diet) => {
      const compatible = recipes.filter((r) =>
        r.variants.some(
          (v) =>
            !recipeCompatibility(r, v, facts, { ...profile, diet }, policy),
        ),
      );
      return {
        diet,
        recipes: compatible.length,
        cuisineMatches: compatible.filter((r) =>
          r.cuisines?.some((c) => profile.preferences?.cuisines.includes(c)),
        ).length,
        missingSlots: policy.slots.filter(
          (s) => !compatible.some((r) => r.slots.includes(s)),
        ),
      };
    })
    .sort(
      (a, b) => b.cuisineMatches - a.cuisineMatches || b.recipes - a.recipes,
    );
  return { state: "ready", energy, targetKcal, personalized: !!rule, diets };
}

type Meal = {
  slot: string;
  recipeId: string;
  variantKey: string;
  servings: number;
  name: string;
  steps: string[];
  cookingName: string;
  equipment: string[];
  minutes: number;
  storageNote: string;
  recipeYieldServings?: number;
  ingredients: Array<{ food: Food; grams: number }>;
};
type View = {
  weekStart: string;
  weekEnd: string;
  days: Array<{ date: string; meals: Meal[] }>;
  kitchen?: NutritionProfile["kitchen"];
  restrictions?: { allergens: string[]; exclusions: string[]; halal: boolean };
};
const round = (n: number) => Math.round(n * 100) / 100;
/** A purpose-specific handoff. No body metrics, goal, calorie target, health
 * notes, account details or model evidence are copied into a kitchen pack. */
export function nutritionKitchenPack(
  view: View,
  specs: Array<{ data: any }>,
  inventory: Array<{ data: any; status: string }>,
  today: string,
) {
  const kitchen = view.kitchen ?? {
    cook: "self",
    portions: 1,
    language: "en",
    region: "other",
    instructions: "",
  };
  const groceries = new Map<string, { food: Food; grams: number }>();
  const recipes = new Map<
    string,
    {
      number: number;
      name: string;
      cookingName: string;
      equipment: string[];
      minutes: number;
      storageNote: string;
      steps: string[];
      originalYield: number | null;
      memberServings: number;
      cookServings: number;
      ingredients: Array<{
        name: string;
        preparation: string;
        memberGrams: number;
        cookGrams: number;
      }>;
      uses: Array<{ date: string; slot: string }>;
    }
  >();
  const scaledDays = view.days.map((day) => ({
    ...day,
    meals: day.meals.map((m) => ({
      ...m,
      ingredients: m.ingredients.map((i) => ({
        ...i,
        grams: round(i.grams * kitchen.portions),
      })),
    })),
  }));
  const days = view.days.map((day) => ({
    date: day.date,
    meals: day.meals.map((m) => {
      const key = [m.recipeId, m.variantKey, m.servings].join(":");
      let recipe = recipes.get(key);
      if (!recipe) {
        recipe = {
          number: recipes.size + 1,
          name: m.name,
          cookingName: m.cookingName,
          equipment: m.equipment,
          minutes: m.minutes,
          storageNote: m.storageNote,
          steps: m.steps,
          originalYield: m.recipeYieldServings ?? null,
          memberServings: m.servings,
          cookServings: round(m.servings * kitchen.portions),
          ingredients: m.ingredients.map((i) => ({
            name: i.food.name,
            preparation: i.food.preparation,
            memberGrams: i.grams,
            cookGrams: round(i.grams * kitchen.portions),
          })),
          uses: [],
        };
        recipes.set(key, recipe);
      }
      recipe.uses.push({ date: day.date, slot: m.slot });
      for (const i of m.ingredients) {
        const old = groceries.get(i.food.id);
        groceries.set(i.food.id, {
          food: i.food,
          grams: round((old?.grams ?? 0) + round(i.grams * kitchen.portions)),
        });
      }
      return {
        slot: m.slot,
        name: m.name,
        recipe: recipe.number,
        memberServings: m.servings,
        cookServings: round(m.servings * kitchen.portions),
      };
    }),
  }));
  const purchases = groceryPurchases(
    [...groceries.values()],
    specs,
    inventory,
    today,
    scaledDays,
  );
  return {
    weekStart: view.weekStart,
    weekEnd: view.weekEnd,
    kitchen,
    restrictions: view.restrictions ?? {
      allergens: [],
      exclusions: [],
      halal: false,
    },
    days,
    recipes: [...recipes.values()],
    shopping: purchases.map((g) => ({
      name: g.food.name,
      preparation: g.food.preparation,
      grams: g.grams,
      availableGrams: g.availableGrams,
      remainingGrams: g.remainingGrams,
      purchaseGrams: g.purchaseGrams,
      packs: g.packs,
      purchasedGrams: g.purchasedGrams,
      purchaseLabel: g.purchaseLabel,
      conversionSource: g.conversionSource,
    })),
  };
}
export type NutritionKitchenPack = ReturnType<typeof nutritionKitchenPack>;
