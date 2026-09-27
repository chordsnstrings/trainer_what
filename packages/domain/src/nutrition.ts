import { z } from "zod";
import {
  nutritionTeachingDecisionSchema,
  nutritionExpectedMealSchema,
  nutritionPrinciples,
  nutritionSampleMealSchema,
} from "./nutrition-learning-schema.ts";

export const nutritionCategories = [
  "diet",
  "calories",
  "portions",
  "substitutions",
  "cooking",
  "budget",
  "adjustments",
  "boundaries",
] as const;
export const nutritionQuestions: Record<
  (typeof nutritionCategories)[number],
  string
> = {
  diet: "A new client in your usual audience wants a practical week of meals. What diet and meal pattern would you recommend, why, and for whom would it be unsuitable?",
  calories:
    "How would you choose this client's approximate calorie target? Give a worked example, the information you need, and the limits on applying it to another client.",
  portions:
    "The client cooks for two people but needs a different portion. Explain ingredient weights, raw versus cooked quantities, serving size and a worked day of meals.",
  substitutions:
    "The client cannot eat an ingredient in your plan. What replacements and portion changes do you allow? What would make you withhold a substitution?",
  cooking:
    "The same client now has only twenty minutes and an air fryer or hob. How would your recipes, preparation and batch cooking change?",
  budget:
    "The client needs a lower-cost grocery list and wants to reuse ingredients. What do you repeat, replace or keep unchanged, and why?",
  adjustments:
    "The client reports hunger or difficulty following the plan. What would you ask, when would you adjust it, by how much, and when would you keep it unchanged?",
  boundaries:
    "A client has missing information, an allergy, or asks for a diet outside your expertise. What can the system handle, what must it ask, and when must it contact you?",
};
const text = (max = 2000) => z.string().trim().min(1).max(max);
const tags = z.array(text(80).transform((s) => s.toLowerCase())).max(40);
export const nutritionCaseSchema = z
  .object({
    category: z.enum(nutritionCategories),
    scenario: text(3000),
    recommendation: text(6000),
    reason: text(),
    alternatives: z.string().max(2000),
    avoid: text(),
    changeWhen: text(),
    referWhen: text(),
    rights: z.literal(true),
    decision: nutritionTeachingDecisionSchema.optional(),
  })
  .strict();
export const nutrientSchema = z
  .object({
    kcal: z.number().min(0).max(1000).nullable(),
    protein: z.number().min(0).max(100).nullable(),
    carbohydrate: z.number().min(0).max(100).nullable(),
    fat: z.number().min(0).max(100).nullable(),
  })
  .strict();
export const foodSchema = z
  .object({
    name: text(160),
    preparation: z.enum(["raw", "cooked", "ready_to_eat"]),
    nutrientsPer100g: nutrientSchema,
    allergens: tags,
    allergenReviewComplete: z.boolean(),
    ingredientTags: tags,
    source: text(1000),
    estimated: z.boolean(),
  })
  .strict();
export type Food = z.infer<typeof foodSchema> & { id: string };
export const ingredientSchema = z
  .object({
    foodId: z.string().uuid(),
    grams: z.number().positive().max(100000).multipleOf(0.01),
  })
  .strict();
export const recipeSchema = z
  .object({
    name: text(160),
    description: z.string().max(2000),
    dietTags: tags.min(1),
    slots: z.array(text(50)).min(1).max(6),
    budget: z.enum(["low", "moderate", "flexible"]),
    yieldServings: z.number().positive().max(100).multipleOf(0.25),
    variants: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-z0-9-]{1,40}$/),
            name: text(100),
            equipment: tags,
            minutes: z.number().int().min(1).max(1440),
            steps: z.array(text(1000)).min(1).max(20),
            ingredients: z.array(ingredientSchema).min(1).max(40),
            storageNote: z.string().max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    source: text(1000),
  })
  .strict()
  .refine(
    (r) => new Set(r.variants.map((v) => v.key)).size === r.variants.length,
    "Cooking option keys must be unique",
  );
export type Recipe = z.infer<typeof recipeSchema> & { id: string };
export const nutritionProfileSchema = z
  .object({
    age: z.number().int().min(18).max(100),
    goal: text(100),
    diet: text(80).transform((s) => s.toLowerCase()),
    allergyStatus: z.enum(["none_reported", "reported", "unknown", "declined"]),
    allergens: tags,
    exclusions: tags,
    equipment: tags,
    maxMinutes: z.number().int().min(1).max(1440),
    budget: z.enum(["low", "moderate", "flexible"]),
    scopeStatus: z.enum(["general_wellness", "specialist_needed", "unknown"]),
    timezone: z
      .string()
      .max(100)
      .refine((s) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: s });
          return true;
        } catch {
          return false;
        }
      }, "Unknown timezone"),
    notes: z.string().max(2000),
  })
  .strict()
  .refine(
    (p) => p.allergyStatus !== "none_reported" || p.allergens.length === 0,
    "Choose reported allergies when allergens are entered",
  )
  .refine(
    (p) => p.allergyStatus !== "reported" || p.allergens.length > 0,
    "List the reported allergens",
  );
export type NutritionProfile = z.infer<typeof nutritionProfileSchema>;
export const nutritionPolicySchema = z
  .object({
    title: text(160),
    approach: text(4000),
    supportedDiets: tags.min(1),
    minAge: z.number().int().min(18).max(100),
    maxAge: z.number().int().min(18).max(100),
    targets: z
      .array(
        z
          .object({
            goal: text(100),
            kcal: z.number().int().positive().max(10000),
            reason: text(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    minKcal: z.number().int().positive().max(10000),
    maxKcal: z.number().int().positive().max(10000),
    tolerancePercent: z.number().min(0).max(20),
    slots: z.array(text(50)).min(1).max(6),
    minServings: z.number().positive().max(10).multipleOf(0.25),
    maxServings: z.number().positive().max(10).multipleOf(0.25),
    maxRecipeRepeats: z.number().int().min(1).max(42),
    allowSwaps: z.boolean(),
    forbiddenIngredients: tags,
    adjustment: z
      .object({
        enabled: z.boolean(),
        trigger: z.enum(["hunger_high", "difficulty_low"]),
        requiredCheckins: z.number().int().min(2).max(30),
        minimumDays: z.number().int().min(1).max(90),
        deltaKcal: z.number().int().min(-1000).max(1000),
        reason: text(),
      })
      .strict(),
    boundaries: text(4000),
    sourceIds: z.array(z.string().uuid()).min(1).max(80),
  })
  .strict()
  .superRefine((p, c) => {
    if (
      p.minAge > p.maxAge ||
      p.minKcal > p.maxKcal ||
      p.minServings > p.maxServings
    )
      c.addIssue({ code: "custom", message: "Policy ranges are reversed" });
    if (p.targets.some((t) => t.kcal < p.minKcal || t.kcal > p.maxKcal))
      c.addIssue({
        code: "custom",
        message: "Every target must be inside the coach's calorie limits",
      });
    if (
      new Set(p.slots).size !== p.slots.length ||
      new Set(p.targets.map((t) => t.goal.toLowerCase())).size !==
        p.targets.length
    )
      c.addIssue({
        code: "custom",
        message: "Meal slots and goals must be unique",
      });
  });
export type NutritionPolicy = z.infer<typeof nutritionPolicySchema>;
export const mealChoiceSchema = z
  .object({
    slot: text(50),
    recipeId: z.string().uuid(),
    variantKey: text(40),
    servings: z.number().positive().max(10).multipleOf(0.25),
    batchKey: z
      .string()
      .regex(/^[a-zA-Z0-9-]{1,50}$/)
      .nullable(),
  })
  .strict();
export const nutritionWeekSchema = z
  .object({
    days: z
      .array(
        z
          .object({
            offset: z.number().int().min(0).max(6),
            meals: z.array(mealChoiceSchema).min(1).max(6),
          })
          .strict(),
      )
      .length(7),
    caseIds: z.array(z.string().uuid()).min(1).max(40),
    explanation: text(3000),
  })
  .strict();
export type NutritionWeek = z.infer<typeof nutritionWeekSchema>;
export const nutritionScenarioSchema = z
  .object({
    category: z.enum(nutritionCategories),
    prompt: text(3000),
    profile: nutritionProfileSchema,
    expect: z.enum(["plan", "exception"]),
    expectedTargetKcal: z.number().int().positive().nullable(),
    expectedCaseId: z.string().uuid(),
    heldOut: z.literal(true),
    expectedMeal: nutritionExpectedMealSchema.optional(),
    expectedPrinciple: z.enum(nutritionPrinciples).optional(),
  })
  .strict();
export const nutritionEvaluationSchema = z
  .object({
    decisions: z
      .array(
        z
          .object({
            scenarioId: z.string().uuid(),
            action: z.enum(["plan", "exception"]),
            targetKcal: z.number().int().positive().nullable(),
            caseIds: z.array(z.string().uuid()).max(40),
            reason: text(),
            principle: z.enum(nutritionPrinciples),
            rationaleEvidence: z
              .object({
                caseId: z.string().uuid(),
                quote: z.string().min(12).max(500),
              })
              .strict(),
            sampleMeal: nutritionSampleMealSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export class NutritionBlocked extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "NutritionBlocked";
  }
}
const block = (code: string, message: string): never => {
  throw new NutritionBlocked(code, message);
};
// Case, width, Arabic diacritic/tatweel and hamza-carrier folding for deterministic matching.
export function foldNutritionText(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\u066C/g, ",");
}
const lettersBefore = "(?<![\\p{L}\\p{N}])",
  lettersAfter = "(?![\\p{L}\\p{N}])",
  // Optional attached Arabic conjunction/preposition and article (و، ف، ب، ك، ل، ال).
  arabicClitic = "(?:[وف]?(?:[بك]?ال|لل|[بلك]))?";
const termPattern = (terms: string[]) =>
  new RegExp(
    lettersBefore + arabicClitic + "(?:" + terms.join("|") + ")" + lettersAfter,
    "iu",
  );
// Clinical, medication and life-stage signals that take a request outside automatic
// general-wellness guidance. Terms are word-bounded so ordinary words such as
// "sugar", "kidney beans", "سكر" or "حمل الأثقال" do not match.
const clinicalTerms = [
  "(?:pre-?)?diabet(?:es|ic|ics)?",
  "t[12]dm?",
  "insulin",
  "metformin",
  "glp-?1s?",
  "semaglutide|ozempic|wegovy|mounjaro|tirzepatide|zepbound|liraglutide|saxenda|victoza",
  "hypertension|hypertensive|antihypertensives?",
  "high blood pressure",
  "blood pressure (?:medications?|medicines?|pills?|tablets?)",
  "kidney (?:disease|failure|stones?|problems?|transplant|conditions?)",
  "renal|ckd|dialysis|nephropathy",
  "liver (?:disease|failure|conditions?)|fatty liver|cirrhosis|hepatitis",
  "cancer|chemo(?:therapy)?|oncology|radiotherapy",
  "pregnan(?:t|cy|cies)",
  "breast[- ]?(?:feeding|feeds?|fed)|lactating|lactation|postpartum|trimester",
  "anorexi(?:a|c)|bulimi(?:a|c)|binge[- ]eating|purging|starvation|eating disorders?|arfid",
  "coeliac|celiac",
  "crohn'?s?|colitis|ibs|ibd|gastroparesis|fodmap",
  "gout",
  "pcos|polycystic ovar(?:y|ies|ian)",
  "bariatric|gastric (?:bypass|sleeve|band)",
  "heart (?:disease|failure|conditions?|attack)|cardiac",
  "thyroid|hypothyroid(?:ism)?|hyperthyroid(?:ism)?|levothyroxine",
  "warfarin|statins?|blood thinners?|anticoagulants?",
  "epilep(?:sy|tic)",
  "phenylketonuria|pku",
  "medications?|prescription",
  // Arabic (folded): diabetes, insulin, GLP-1 brands, blood pressure, kidney, liver,
  // cancer/chemotherapy, pregnancy/breastfeeding, eating disorders, gut, gout, PCOS,
  // bariatric surgery, heart, thyroid, epilepsy and medicines.
  "سكري|مرض ال?سكر|انسولين|ميتفورمين|[جغ]لوكوفاج",
  "اوزمبيك|اوزيمبك|مونجارو|ساكسندا|ويغوفي|سيماجلوتايد",
  "ضغط ال?دم|ارتفاع ال?ضغط",
  "كلى|كلوي|كلوية|غسيل كلوي",
  "(?:امراض|مرض|تليف|تشمع) ال?كبد|كبد ال?دهني",
  "سرطان(?!\\s*ال?بحر)|كيماوي|علاج ال?كيميائي",
  "حامل|حبلى|مرضع|مرضعة|رضاعة|ترضع|ارضع",
  "فقدان ال?شهية|شره ال?مرضي|اضطرابا?ت? ال?اكل",
  "سيلياك|داء ال?بطني|داء ال?زلاقي|كرون|قولون ال?(?:تقرحي|عصبي)",
  "نقرس|تكيس ال?مبايض|(?:تكميم|ربط|قص) ال?معدة|تحويل ال?مسار",
  "(?:امراض|مرض|قصور) ال?قلب|جلطة|غدة ال?درقية|صرع|دواء|ادوية",
];
const clinicalPattern = termPattern(clinicalTerms);
/** Clinical, medication or life-stage terms found in free text (English and Arabic). */
export function nutritionScopeSignals(texts: string[]) {
  const found: string[] = [];
  for (const t of texts) {
    const m = foldNutritionText(t).match(new RegExp(clinicalPattern, "giu"));
    if (m) found.push(...m.map((x) => x.trim()));
  }
  return [...new Set(found)];
}
export function nutritionTarget(
  policy: NutritionPolicy,
  profile: NutritionProfile,
) {
  if (
    nutritionScopeSignals([
      profile.notes,
      profile.goal,
      profile.diet,
      ...profile.exclusions,
      ...profile.allergens,
    ]).length
  )
    block(
      "SCOPE_REVIEW",
      "This request needs a coach or specialist review before automatic dietary guidance.",
    );
  if (profile.scopeStatus !== "general_wellness")
    block(
      "SCOPE_REVIEW",
      "Your coach needs to check whether this request fits their nutrition scope.",
    );
  if (["unknown", "declined"].includes(profile.allergyStatus))
    block(
      "ALLERGY_INFORMATION",
      "Confirm your ingredient restrictions before a meal plan can be prepared.",
    );
  if (profile.allergens.some((a) => !allergenKey(a)))
    block(
      "ALLERGEN_CLARIFICATION",
      "An ingredient restriction needs clarification before automatic recipe selection.",
    );
  if (
    profile.age < policy.minAge ||
    profile.age > policy.maxAge ||
    !policy.supportedDiets.includes(profile.diet)
  )
    block(
      "OUTSIDE_SCOPE",
      "This profile is outside the coach's taught nutrition scope.",
    );
  const target = policy.targets.find(
    (t) => t.goal.toLowerCase() === profile.goal.toLowerCase(),
  );
  if (!target)
    block(
      "TARGET_MISSING",
      "The coach has not defined a calorie approach for this goal.",
    );
  return target!.kcal;
}
// Decimal inputs are converted to integer hundredths. Rounding happens only at presentation.
export function scaledNutrients(
  ingredients: Array<{ food: Food; grams: number }>,
  multiplier: number,
) {
  const result = {} as Record<
    "kcal" | "protein" | "carbohydrate" | "fat",
    number | null
  >;
  for (const key of ["kcal", "protein", "carbohydrate", "fat"] as const) {
    let total = 0n,
      unknown = false;
    for (const i of ingredients) {
      const n = i.food.nutrientsPer100g[key];
      if (n === null) {
        unknown = true;
        continue;
      }
      total +=
        BigInt(Math.round(n * 100)) *
        BigInt(Math.round(i.grams * 100)) *
        BigInt(Math.round(multiplier * 10000));
    }
    result[key] = unknown
      ? null
      : Number((total + 50000000n) / 100000000n) / 100;
  }
  return result;
}
const norm = (s: string) => foldNutritionText(s).trim();
// Conservative matching aliases and derived ingredient terms (English and folded
// Arabic); unfamiliar restrictions require clarification. This is not
// certification of packaged food or cross-contact safety.
const allergenGroups: Record<string, string[]> = {
  milk: [
    "milk",
    "dairy",
    "lactose",
    "whey",
    "casein",
    "caseinate",
    "butter",
    "buttermilk",
    "ghee",
    "cheese",
    "yogurt",
    "yoghurt",
    "labneh",
    "labnah",
    "laban",
    "cream",
    "paneer",
    "kefir",
    "curd",
    "halloumi",
    "feta",
    "mozzarella",
    "ricotta",
    "parmesan",
    "cheddar",
    "حليب",
    "لبن",
    "لبنة",
    "جبن",
    "جبنة",
    "زبدة",
    "زبد",
    "سمن",
    "قشطة",
    "قشدة",
    "زبادي",
    "روب",
  ],
  egg: [
    "egg",
    "eggs",
    "albumin",
    "albumen",
    "mayonnaise",
    "mayo",
    "meringue",
    "بيض",
    "بيضة",
    "مايونيز",
  ],
  peanut: [
    "peanut",
    "peanuts",
    "groundnut",
    "groundnuts",
    "arachis",
    "فول سوداني",
    "فول سودانى",
    "فستق عبيد",
  ],
  tree_nut: [
    "tree nut",
    "tree nuts",
    "almond",
    "almonds",
    "cashew",
    "cashews",
    "walnut",
    "walnuts",
    "hazelnut",
    "hazelnuts",
    "pistachio",
    "pistachios",
    "pecan",
    "pecans",
    "brazil nut",
    "macadamia",
    "praline",
    "marzipan",
    "لوز",
    "كاجو",
    "جوز",
    "بندق",
    "فستق",
    "فستق حلبي",
    "بيكان",
    "مكاديميا",
  ],
  soy: [
    "soy",
    "soya",
    "soybean",
    "soybeans",
    "tofu",
    "tempeh",
    "edamame",
    "miso",
    "natto",
    "tamari",
    "shoyu",
    "صويا",
    "توفو",
  ],
  wheat: [
    "wheat",
    "semolina",
    "couscous",
    "bulgur",
    "bulghur",
    "burghul",
    "durum",
    "spelt",
    "farro",
    "freekeh",
    "seitan",
    "kamut",
    "einkorn",
    "emmer",
    "triticale",
    "flour",
    "bread",
    "breadcrumbs",
    "pasta",
    "قمح",
    "سميد",
    "برغل",
    "فريكة",
    "كسكس",
    "كسكسي",
    "طحين",
    "خبز",
    "معكرونة",
  ],
  gluten: ["gluten", "barley", "rye", "malt", "جلوتين", "غلوتين", "شعير"],
  fish: [
    "fish",
    "anchovy",
    "anchovies",
    "tuna",
    "salmon",
    "sardine",
    "sardines",
    "cod",
    "mackerel",
    "tilapia",
    "سمك",
    "اسماك",
    "تونة",
    "سلمون",
    "سردين",
    "هامور",
  ],
  shellfish: [
    "shellfish",
    "crustacean",
    "crustaceans",
    "shrimp",
    "prawn",
    "prawns",
    "crab",
    "lobster",
    "mollusc",
    "molluscs",
    "mollusk",
    "mollusks",
    "mussel",
    "mussels",
    "oyster",
    "oysters",
    "clam",
    "clams",
    "scallop",
    "scallops",
    "squid",
    "calamari",
    "octopus",
    "روبيان",
    "ربيان",
    "جمبري",
    "سلطعون",
    "كابوريا",
    "سرطان البحر",
    "محار",
    "كركند",
  ],
  sesame: [
    "sesame",
    "sesame seed",
    "sesame seeds",
    "tahini",
    "tahina",
    "tahineh",
    "halva",
    "halwa",
    "halawa",
    "benne",
    "zaatar",
    "za'atar",
    "سمسم",
    "طحينة",
    "طحينه",
    "حلاوة",
    "حلاوه",
    "زعتر",
  ],
  mustard: ["mustard", "خردل"],
  celery: ["celery", "celeriac", "كرفس"],
  lupin: ["lupin", "lupine", "ترمس"],
  sulphite: ["sulphite", "sulphites", "sulfite", "sulfites"],
  nuts: ["nuts", "nut", "مكسرات"],
};
export function allergenKey(s: string) {
  const n = norm(s),
    bare = n.replace(/^(?:[وف]?(?:[بك]?ال|لل))(?=\p{L}{2})/u, "");
  return (
    Object.entries(allergenGroups).find(
      ([, v]) => v.includes(n) || v.includes(bare),
    )?.[0] ?? null
  );
}
function allergenConflict(a: string, b: string) {
  const x = allergenKey(a),
    y = allergenKey(b);
  return (
    norm(a) === norm(b) ||
    (x !== null && x === y) ||
    ([x, y].includes("nuts") &&
      [x, y].some((k) => k === "tree_nut" || k === "peanut")) ||
    ([x, y].includes("gluten") && [x, y].includes("wheat"))
  );
}
const relatedAllergens: Record<string, string[]> = {
  nuts: ["nuts", "tree_nut", "peanut"],
  tree_nut: ["tree_nut", "nuts"],
  peanut: ["peanut", "nuts"],
  gluten: ["gluten", "wheat"],
  wheat: ["wheat", "gluten"],
};
const escapeTerm = (t: string) =>
  norm(t)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
const namedAllergenPatterns = new Map<string, RegExp>();
// Word-bounded search of a reported allergen, its alias group and derived terms
// (for example peanut butter, tahini, whey or semolina) in food names and tags.
function allergenNamed(reported: string, words: string[]) {
  const key = allergenKey(reported);
  let pattern = key ? namedAllergenPatterns.get(key) : undefined;
  if (!pattern) {
    const terms = [
      norm(reported),
      ...(key ? (relatedAllergens[key] ?? [key]) : []).flatMap(
        (k) => allergenGroups[k],
      ),
    ];
    pattern = new RegExp(
      lettersBefore +
        arabicClitic +
        "(?:" +
        [...new Set(terms.map(escapeTerm))].join("|") +
        ")(?:e?s)?" +
        lettersAfter,
      "iu",
    );
    // Known groups are cached; the group already covers the reported alias.
    if (key) namedAllergenPatterns.set(key, pattern);
  }
  return words.some((w) => pattern!.test(norm(w)));
}
export function recipeCompatibility(
  recipe: Recipe,
  variant: Recipe["variants"][number],
  foods: Map<string, Food>,
  profile: NutritionProfile,
  policy: NutritionPolicy,
) {
  if (!recipe.dietTags.includes(profile.diet))
    return "Diet preference does not match";
  if (
    variant.minutes > profile.maxMinutes ||
    variant.equipment.some((e) => !profile.equipment.includes(e))
  )
    return "Cooking equipment or time does not match";
  if (
    ["low", "moderate", "flexible"].indexOf(recipe.budget) >
    ["low", "moderate", "flexible"].indexOf(profile.budget)
  )
    return "Budget does not match";
  for (const i of variant.ingredients) {
    const f = foods.get(i.foodId);
    if (!f) return "Ingredient facts are unavailable";
    if (!f.allergenReviewComplete)
      return "Ingredient/allergen review is incomplete";
    if (f.nutrientsPer100g.kcal === null)
      return "Ingredient calorie estimate is missing";
    if (
      f.allergens.some((a) =>
        profile.allergens.some((b) => allergenConflict(a, b)),
      ) ||
      profile.allergens.some((b) =>
        allergenNamed(b, [f.name, ...f.ingredientTags, ...f.allergens]),
      )
    )
      return "Reported allergen conflict";
    const words = [
      norm(f.name),
      ...f.ingredientTags.map(norm),
      ...f.allergens.map(norm),
    ];
    if (
      [...profile.exclusions, ...policy.forbiddenIngredients].some((x) =>
        words.some((w) => w === norm(x) || w.includes(norm(x))),
      )
    )
      return "Excluded ingredient conflict";
  }
  return null;
}
export function dateOffset(start: string, offset: number) {
  return new Date(Date.parse(start + "T12:00:00Z") + offset * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function localDate(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function validateNutritionWeek(input: {
  week: NutritionWeek;
  policy: NutritionPolicy;
  profile: NutritionProfile;
  foods: Food[];
  recipes: Recipe[];
  caseIds: string[];
  weekStart: string;
  targetKcal?: number;
}) {
  const { week, policy, profile, weekStart } = input;
  const base = nutritionTarget(policy, profile),
    target = input.targetKcal ?? base;
  if (target < policy.minKcal || target > policy.maxKcal)
    block("TARGET_LIMIT", "The calorie target is outside the coach's limits.");
  if (new Set(week.days.map((d) => d.offset)).size !== 7)
    block("INCOMPLETE_WEEK", "The plan must contain seven different days.");
  if (week.caseIds.some((id) => !input.caseIds.includes(id)))
    block(
      "UNKNOWN_EVIDENCE",
      "The plan referenced unconfirmed coach evidence.",
    );
  const foods = new Map(input.foods.map((f) => [f.id, f])),
    recipes = new Map(input.recipes.map((r) => [r.id, r]));
  const counts = new Map<string, number>(),
    batches = new Map<string, string>(),
    groceries = new Map<string, { food: Food; grams: number }>();
  const days = [...week.days]
    .sort((a, b) => a.offset - b.offset)
    .map((day) => {
      if (
        day.meals.length !== policy.slots.length ||
        new Set(day.meals.map((m) => m.slot)).size !== policy.slots.length ||
        day.meals.some((m) => !policy.slots.includes(m.slot))
      )
        block("MEAL_STRUCTURE", "Meal slots do not match the coach's plan.");
      const meals = day.meals.map((choice) => {
        const recipe = recipes.get(choice.recipeId),
          variant = recipe?.variants.find((v) => v.key === choice.variantKey);
        if (!recipe || !variant)
          block(
            "UNKNOWN_RECIPE",
            "A selected recipe or cooking option is unavailable.",
          );
        const r = recipe!,
          v = variant!;
        const problem = recipeCompatibility(r, v, foods, profile, policy);
        if (problem) block("RECIPE_CONFLICT", problem);
        if (
          !r.slots.includes(choice.slot) ||
          choice.servings < policy.minServings ||
          choice.servings > policy.maxServings
        )
          block(
            "PORTION_POLICY",
            "A meal or portion falls outside the coach's rules.",
          );
        counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
        if (counts.get(r.id)! > policy.maxRecipeRepeats)
          block(
            "RECIPE_REPEATS",
            "The plan repeats a recipe more often than the coach allows.",
          );
        if (choice.batchKey) {
          const key = r.id + ":" + v.key,
            old = batches.get(choice.batchKey);
          if (old && old !== key)
            block(
              "BATCH_CONFLICT",
              "A preparation batch cannot mix different recipes or cooking options.",
            );
          batches.set(choice.batchKey, key);
        }
        const ingredients = v.ingredients.map((i) => ({
          food: foods.get(i.foodId)!,
          grams: i.grams,
        }));
        const multiplier = choice.servings / r.yieldServings;
        const portions = ingredients.map((i) => {
          const grams = Math.round(i.grams * multiplier * 100) / 100;
          const old = groceries.get(i.food.id);
          groceries.set(i.food.id, {
            food: i.food,
            grams: Math.round(((old?.grams ?? 0) + grams) * 100) / 100,
          });
          return { ...i, grams };
        });
        return {
          ...choice,
          name: r.name,
          description: r.description,
          steps: v.steps,
          cookingName: v.name,
          equipment: v.equipment,
          minutes: v.minutes,
          storageNote: v.storageNote,
          ingredients: portions,
          nutrients: scaledNutrients(portions, 1),
          estimated: true,
          source: r.source,
        };
      });
      const total = {} as Record<string, number | null>;
      for (const k of ["kcal", "protein", "carbohydrate", "fat"] as const)
        total[k] = meals.some((m) => m.nutrients[k] === null)
          ? null
          : Math.round(meals.reduce((s, m) => s + m.nutrients[k]!, 0) * 100) /
            100;
      if (
        total.kcal === null ||
        Math.abs(total.kcal - target) >
          (target * policy.tolerancePercent) / 100 + 0.01
      )
        block(
          "CALORIE_POLICY",
          "A day's estimated calories fall outside the coach's agreed range.",
        );
      return {
        date: dateOffset(weekStart, day.offset),
        offset: day.offset,
        meals,
        totals: total,
      };
    });
  return {
    weekStart,
    weekEnd: dateOffset(weekStart, 6),
    targetKcal: target,
    days,
    groceries: [...groceries.values()].sort((a, b) =>
      a.food.name.localeCompare(b.food.name),
    ),
    caseIds: week.caseIds,
    ...nutritionExplanation({
      text: week.explanation,
      targetKcal: target,
      days,
      slots: policy.slots.length,
      batches: batches.size,
      recipes: input.recipes,
    }),
    calculationVersion: "nutrition-decimal-v1",
    estimated: true,
  };
}
const explanationPattern = termPattern([
  "supplements?|supplementation|(?:multi)?vitamins?|capsules?|tablets?|pills?",
  "doses?|dosage|dosing|medicines?|drugs?|injections?|laxatives?|diuretics?",
  "diagnos(?:is|es|e|ed)|treatment|therapy|therapeutic|clinical(?:ly)?|medical(?:ly)?",
  "detox\\w*|creatine|fat burners?|probiotics?|doctor|physician",
  "مكملا?ت?|مكمل|فيتامينا?ت?|كبسولة|كبسولا?ت?|جرعة|جرعا?ت?|علاج|تشخيص|حقنة|حقن|طبيب",
]);
const dosePattern =
  /\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|μg|iu|units?|ملغ|ملجم|مجم|ميكروغرام|وحدة|وحدات)(?![\p{L}\p{N}])/iu;
const contactPattern =
  /(?:https?:\/\/|www\.)|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+\.\p{L}{2,}|(?<![\p{L}\p{N}])[a-z0-9-]+\.(?:com|net|org|io|ae|co|info|app|health|me|ly|link)(?![\p{L}\p{N}])|\+\d[\d\s().-]{6,}\d|(?<!\d)0\d(?:[\s.-]?\d){7,}/iu;
const calorieUnit =
  "k?cal(?:orie)?s?|kilocalories?|سعرة|سعرات|سعر حراري|كالوري|كيلو ?كالوري";
const caloriePatterns = [
  new RegExp(
    "(\\d[\\d,]*(?:\\.\\d+)?)\\s*-?\\s*(?:" +
      calorieUnit +
      ")(?![\\p{L}\\p{N}])",
    "giu",
  ),
  new RegExp(
    "(?<![\\p{L}\\p{N}])(?:" +
      calorieUnit +
      ")\\s*(?:of|:|=|around|about|approximately|approx\\.?|~)?\\s*(\\d[\\d,]*(?:\\.\\d+)?)",
    "giu",
  ),
];
const phrase = (s: string) =>
  " " +
  foldNutritionText(s)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim() +
  " ";
/**
 * Free text reaches the subscriber only after deterministic checks: no clinical,
 * medication or supplement terms, dosages, links or contact details, calorie
 * numbers that disagree with the validated week, or catalog recipes outside the
 * week. Otherwise a neutral explanation is generated from the validated data.
 */
export function nutritionExplanation(input: {
  text: string;
  targetKcal: number;
  days: Array<{
    totals: Record<string, number | null>;
    meals: Array<{ recipeId: string; nutrients: { kcal: number | null } }>;
  }>;
  slots: number;
  batches: number;
  recipes: Array<{ id: string; name: string }>;
}) {
  const text = foldNutritionText(input.text),
    issues: string[] = [];
  if (clinicalPattern.test(text) || explanationPattern.test(text))
    issues.push("clinical_or_supplement_advice");
  if (dosePattern.test(text)) issues.push("dosage");
  if (contactPattern.test(text)) issues.push("link_or_contact");
  const allowed = [
    input.targetKcal,
    ...input.days.flatMap((d) => [
      d.totals.kcal,
      ...d.meals.map((m) => m.nutrients.kcal),
    ]),
  ].filter((n): n is number => typeof n === "number");
  for (const pattern of caloriePatterns)
    for (const m of text.matchAll(pattern))
      if (
        !allowed.some((k) => Math.abs(k - Number(m[1].replace(/,/g, ""))) <= 1)
      )
        issues.push("calorie_mismatch");
  const used = new Set(
      input.days.flatMap((d) => d.meals.map((m) => m.recipeId)),
    ),
    planned = [
      ...new Set(
        input.recipes.filter((r) => used.has(r.id)).map((r) => phrase(r.name)),
      ),
    ].sort((a, b) => b.length - a.length);
  let remaining = phrase(input.text);
  for (const name of planned)
    if (name.trim()) remaining = remaining.split(name).join("  ");
  if (
    input.recipes.some(
      (r) =>
        !used.has(r.id) &&
        phrase(r.name).trim() !== "" &&
        remaining.includes(phrase(r.name)),
    )
  )
    issues.push("recipe_outside_plan");
  if (!issues.length)
    return {
      explanation: input.text,
      explanationCheck: { accepted: true, issues },
    };
  const recipes = used.size,
    batch = input.batches
      ? ` and ${input.batches} shared preparation batch${input.batches === 1 ? "" : "es"}`
      : "";
  return {
    explanation: `This week follows your coach's approved meal rules: about ${input.targetKcal} kcal a day across ${input.slots} daily meal${input.slots === 1 ? "" : "s"}, using ${recipes} coach-reviewed recipe${recipes === 1 ? "" : "s"}${batch}. Quantities and nutrients are estimates from the recorded ingredients; check product labels for allergens.`,
    explanationCheck: { accepted: false, issues: [...new Set(issues)] },
  };
}
export function nutritionCoverage(
  cases: Array<{ id: string; data: any; status: string }>,
) {
  return nutritionCategories.map((category) => ({
    category,
    question: nutritionQuestions[category],
    covered: cases.some(
      (c) => c.status === "confirmed" && c.data.category === category,
    ),
  }));
}
export function nutritionSummary(
  logs: Array<{ id: string; data: any; created_at: any }>,
  checkins: Array<{ id: string; data: any; created_at: any }>,
  profile: any,
  consent: boolean,
  now = new Date(),
) {
  if (!consent)
    return { state: "permission_denied", calculatedAt: now.toISOString() };
  const cutoff = now.getTime() - 28 * 86400000,
    replaced = new Set(logs.map((l) => l.data.correctsId).filter(Boolean));
  const current = logs.filter(
    (l) =>
      !replaced.has(l.id) &&
      !l.data.deleted &&
      Date.parse(l.created_at) >= cutoff,
  );
  return {
    state: "available",
    calculatedAt: now.toISOString(),
    profileId: profile?.id ?? null,
    windowDays: 28,
    loggedMeals: current.length,
    loggedDays: new Set(current.map((l) => l.data.date)).size,
    partial: true,
    coverage: "Recorded meals only; missing logs are not missed meals.",
    checkins: checkins.slice(0, 10).map((c) => ({
      id: c.id,
      date: c.data.date,
      hunger: c.data.hunger,
      difficulty: c.data.difficulty,
    })),
    sourceIds: current.map((l) => l.id),
  };
}
