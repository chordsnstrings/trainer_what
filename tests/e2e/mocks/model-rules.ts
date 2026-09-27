/**
 * Rule-based stand-in for the coaching/nutrition model. For every prompt kind
 * the application sends it returns schema-valid JSON derived only from the
 * supplied evidence, so the full pipeline (accounting, validation, guardrails,
 * persistence) runs without a real model. It is deliberately simple and makes
 * no claim about coaching quality; use capture/replay for reviewed answers.
 */
import {
  nutritionTarget,
  recipeCompatibility,
  scaledNutrients,
  type Food,
  type NutritionPolicy,
  type NutritionProfile,
  type Recipe,
} from "../../../packages/domain/src/nutrition.ts";
import { principleForCategory } from "../../../packages/domain/src/nutrition-learning-schema.ts";

export type PromptKind =
  | "coach_decision"
  | "rule_compilation"
  | "coach_action_selection"
  | "nutrition"
  | "meal_photo"
  | "unknown";

export function classifyPrompt(body: any): { kind: PromptKind; task: string | null; input: any } {
  const system = String(body?.messages?.[0]?.content ?? "");
  const userContent = body?.messages?.[1]?.content;
  let input: any = null;
  const text = Array.isArray(userContent)
    ? userContent.find((p: any) => p?.type === "text")?.text
    : userContent;
  try {
    input = JSON.parse(String(text ?? "null"));
  } catch {}
  if (system.startsWith("You are a governed digital coaching assistant"))
    return { kind: "coach_decision", task: input?.task ?? null, input };
  if (system.startsWith("Extract draft coaching rules"))
    return { kind: "rule_compilation", task: "rule_compilation", input };
  if (system.startsWith("Coach action selector"))
    return { kind: "coach_action_selection", task: "coach_action_selection", input };
  if (system.startsWith("You are the nutrition assistant"))
    return { kind: "nutrition", task: input?.task ?? null, input: input?.input ?? null };
  if (system.startsWith("Estimate visible food"))
    return { kind: "meal_photo", task: "meal_photo_estimate", input };
  return { kind: "unknown", task: null, input };
}

const SAFETY =
  /\b(pain|painful|injur\w*|hurt\w*|dizz\w*|faint\w*|chest|breath\w*|pregnan\w*|suicid\w*|medication|doctor|numb\w*|swollen|swelling)\b/i;
const STOP = new Set(
  "the a an and or to of for in on at is are my i me it with when after before this that be can should what how do does your you our we about from have has".split(
    " ",
  ),
);
const words = (value: unknown) =>
  new Set(
    String(value ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
function overlap(a: Set<string>, b: Set<string>) {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}
const ruleText = (data: any) =>
  [data?.title, data?.condition, data?.directive, data?.category].join(" ");

function coachDecision(input: any) {
  const request = String(input?.request ?? "");
  const evidence: Array<{ id: string; data: any }> = input?.evidence ?? [];
  const rules = evidence.filter((e) => e.data?.directive && e.data?.title);
  if (SAFETY.test(request)) {
    const safety = rules.find((r) => r.data.category === "safety");
    return {
      type: "escalation",
      message:
        "I can't advise on this safely. I've passed your message to your coach, who will review it personally. If symptoms are severe or urgent, seek local medical help.",
      reason: "The request mentions a possible health or safety concern, which needs the coach's personal review.",
      evidenceIds: safety ? [safety.id] : [],
      requiresHumanReview: true,
    };
  }
  const asked = words(request);
  const ranked = rules
    .map((r) => ({ r, score: overlap(asked, words(ruleText(r.data))) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score === 0)
    return {
      type: "escalation",
      message: "Your coach will answer this personally; it isn't covered by their confirmed guidance yet.",
      reason: "No confirmed rule matches the request.",
      evidenceIds: [],
      requiresHumanReview: true,
    };
  const category = best.r.data.category;
  const type = ["progression", "substitution", "schedule"].includes(category)
    ? category
    : category === "safety"
      ? "escalation"
      : "message";
  return {
    type,
    message: `Following your coach's guidance: ${best.r.data.directive}`,
    reason: `Matches the confirmed rule "${best.r.data.title}" (${best.r.data.condition}).`,
    evidenceIds: [best.r.id],
    requiresHumanReview: true,
  };
}

function categorize(sentence: string) {
  const s = sentence.toLowerCase();
  if (/pain|injur|stop|dizz|medical/.test(s)) return "safety";
  if (/swap|substitut|alternative|instead|replace/.test(s)) return "substitution";
  if (/increase|add .*kg|progress|load|heavier/.test(s)) return "progression";
  if (/schedule|days? per week|rest day|reschedul|missed|monday|week/.test(s)) return "schedule";
  if (/sleep|recover|deload|fatigue/.test(s)) return "recovery";
  return "communication";
}
function ruleCompilation(input: any) {
  const sources: Array<{ id: string; title: string; text: string }> = Array.isArray(input) ? input : [];
  const rules: any[] = [];
  const statements: Array<{ id: string; polarity: "always" | "never"; terms: Set<string>; text: string }> = [];
  for (const source of sources) {
    const sentences = String(source.text)
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 12);
    for (const sentence of sentences) {
      const polarity = /^always\b/i.test(sentence) ? "always" : /^never\b/i.test(sentence) ? "never" : null;
      if (polarity) statements.push({ id: source.id, polarity, terms: words(sentence), text: sentence });
      if (rules.length >= 12) continue;
      const condition =
        /^(if|when|after|before)\b/i.test(sentence) && sentence.includes(",")
          ? sentence.slice(0, sentence.indexOf(",")).trim()
          : `Applies to ${String(source.title).toLowerCase()}`;
      rules.push({
        title: `${source.title}: ${sentence.split(/\s+/).slice(0, 6).join(" ")}`.slice(0, 150),
        category: categorize(sentence),
        condition: condition.slice(0, 1000),
        directive: sentence.slice(0, 2000),
        reason: `Stated in the trainer's source "${source.title}".`.slice(0, 2000),
        sourceIds: [source.id],
      });
    }
  }
  const conflicts: any[] = [];
  for (let i = 0; i < statements.length && conflicts.length < 12; i++)
    for (let j = i + 1; j < statements.length && conflicts.length < 12; j++) {
      const a = statements[i],
        b = statements[j];
      if (a.polarity !== b.polarity && overlap(a.terms, b.terms) >= 2)
        conflicts.push({
          description: `"${a.text}" contradicts "${b.text}". Which applies, and when?`.slice(0, 2000),
          sourceIds: [...new Set([a.id, b.id])],
        });
    }
  return { rules, conflicts };
}

function actionSelection(input: any) {
  const request = String(input?.request ?? "").toLowerCase();
  const actions: Array<{ id: string; data: any }> = input?.actions ?? [];
  if (SAFETY.test(request) || /\b(tax|legal|lawyer|diagnos\w*)\b/.test(request))
    return {
      actionId: null,
      requiresHumanReview: true,
      reason: "Outside the coach's approved routine actions; needs personal review.",
      evidenceIds: [],
    };
  const match = actions
    .map((a) => ({
      a,
      hits: (a.data?.requestTerms ?? []).filter((t: string) => request.includes(String(t).toLowerCase())).length,
    }))
    .filter((x) => x.hits > 0)
    .sort((x, y) => y.hits - x.hits)[0];
  if (!match)
    return {
      actionId: null,
      requiresHumanReview: true,
      reason: "No approved routine action matches this request.",
      evidenceIds: [],
    };
  return {
    actionId: match.a.id,
    requiresHumanReview: false,
    reason: `The request matches the approved action "${match.a.data.title}".`,
    evidenceIds: [match.a.id, ...(match.a.data.evidenceIds ?? []).slice(0, 1)],
  };
}

type Material = {
  foods: Food[];
  recipes: Recipe[];
  policy: NutritionPolicy;
  cases: Array<{ id: string; data: any }>;
};
function compatibleVariant(m: Material, recipe: Recipe, profile: NutritionProfile) {
  const facts = new Map(m.foods.map((f) => [f.id, f]));
  return recipe.variants.find((v) => !recipeCompatibility(recipe, v, facts, profile, m.policy));
}
function sampleMeal(m: Material, profile: NutritionProfile, slot: string) {
  for (const recipe of m.recipes.filter((r) => r.slots.includes(slot))) {
    const variant = compatibleVariant(m, recipe, profile);
    if (!variant) continue;
    const servings = Math.min(Math.max(1, m.policy.minServings), m.policy.maxServings);
    const multiplier = servings / recipe.yieldServings;
    const ingredients = variant.ingredients.map((i) => ({
      foodId: i.foodId,
      grams: Math.round(i.grams * multiplier * 100) / 100,
    }));
    const facts = new Map(m.foods.map((f) => [f.id, f]));
    const nutrients = scaledNutrients(
      ingredients.map((i) => ({ food: facts.get(i.foodId)!, grams: i.grams })),
      1,
    );
    return { slot, recipeId: recipe.id, variantKey: variant.key, servings, ingredients, nutrients };
  }
  return null;
}
function nutritionEvaluation(input: any) {
  const m = input as Material & { categoryPrinciples?: Record<string, string> };
  const principles = m.categoryPrinciples ?? (principleForCategory as Record<string, string>);
  return {
    decisions: (input.scenarios ?? []).map((s: any) => {
      let target: number | null = null;
      try {
        target = nutritionTarget(m.policy, s.profile);
      } catch {}
      const category =
        /^\[([a-z_-]+)\]/.exec(String(s.prompt))?.[1] ??
        (target === null ? "boundaries" : "diet");
      const teaching =
        m.cases.find((c) => c.data?.category === category) ??
        m.cases.find((c) => c.data?.category === "boundaries") ??
        m.cases[0];
      const meal = target === null ? null : sampleMeal(m, s.profile, s.requestedMealSlot);
      return {
        scenarioId: s.id,
        action: target === null || !meal ? "exception" : "plan",
        targetKcal: meal ? target : null,
        caseIds: [teaching.id],
        reason:
          target === null
            ? "The profile is outside the coach's qualified scope, so the meal is withheld for coach review."
            : "Applies the coach's confirmed policy target and a compatible recipe for the requested meal.",
        // The expected principle follows the case category, including exceptions.
        principle: principles[category] ?? "scope_referral",
        rationaleEvidence: {
          caseId: teaching.id,
          quote: String(teaching.data?.reason ?? teaching.data?.recommendation ?? "").slice(0, 500),
        },
        sampleMeal: meal,
      };
    }),
  };
}
function nutritionWeek(input: any) {
  const m = input as Material;
  const profile: NutritionProfile = input.profile;
  const target: number = input.targetKcal ?? nutritionTarget(m.policy, profile);
  const facts = new Map(m.foods.map((f) => [f.id, f]));
  const kcalPerServing = (recipe: Recipe, variant: Recipe["variants"][number]) =>
    (scaledNutrients(
      variant.ingredients.map((i) => ({ food: facts.get(i.foodId)!, grams: i.grams / recipe.yieldServings })),
      1,
    ).kcal ?? 0) as number;
  const options = m.policy.slots.map((slot) => {
    const all = m.recipes
      .filter((r) => r.slots.includes(slot))
      .flatMap((r) => {
        const v = compatibleVariant(m, r, profile);
        return v ? [{ slot, recipe: r, variant: v, kcal: kcalPerServing(r, v) }] : [];
      });
    if (!all.length) throw new Error("No compatible recipe for " + slot);
    return all;
  });
  const quarter = (n: number) =>
    Math.min(m.policy.maxServings, Math.max(m.policy.minServings, Math.round(n * 4) / 4));
  const days = Array.from({ length: 7 }, (_, offset) => {
    const picks = options.map((list) => {
      // Rotate within the repeat limit.
      return list[offset % list.length];
    });
    const base = picks.reduce((sum, p) => sum + p.kcal, 0) || 1;
    const servings = picks.map(() => quarter(target / base));
    const total = () => picks.reduce((sum, p, i) => sum + p.kcal * servings[i], 0);
    for (let guard = 0; guard < 40; guard++) {
      const diff = target - total();
      if (Math.abs(diff) <= (target * m.policy.tolerancePercent) / 100) break;
      const i = guard % picks.length;
      servings[i] = quarter(servings[i] + (diff > 0 ? 0.25 : -0.25));
    }
    return {
      offset,
      meals: picks.map((p, i) => ({
        slot: p.slot,
        recipeId: p.recipe.id,
        variantKey: p.variant.key,
        servings: servings[i],
        batchKey: null,
      })),
    };
  });
  return {
    days,
    caseIds: m.cases.slice(0, 40).map((c) => c.id),
    explanation:
      "A seven-day plan built only from the coach's confirmed recipes and policy slots, with portions scaled to the agreed daily target. Estimates are approximate.",
  };
}
function nutritionRecipe(input: any) {
  const m = input as Material & { request: string };
  const foods = m.foods.slice(0, 2);
  const slot = m.policy?.slots?.[0] ?? "Lunch";
  return {
    recipe: {
      name: `Coach draft: ${String(m.request).split(/\s+/).slice(0, 5).join(" ")}`.slice(0, 160),
      description: "Draft recipe proposed from the coach's own ingredient library for the coach to review.",
      dietTags: m.policy?.supportedDiets?.slice(0, 1) ?? ["balanced"],
      slots: [slot],
      budget: "moderate",
      yieldServings: 1,
      variants: [
        {
          key: "hob",
          name: "Hob preparation",
          equipment: ["hob"],
          minutes: 20,
          steps: [
            "Weigh the listed ingredients.",
            "Cook following the product instructions and serve.",
          ],
          ingredients: foods.map((f, i) => ({ foodId: f.id, grams: i === 0 ? 250 : 100 })),
          storageNote: "Refrigerate leftovers promptly and follow label guidance.",
        },
      ],
      source: "Draft from the coach's ingredient library (mock model)",
    },
  };
}
function nutritionPolicy() {
  // The instructions forbid inventing numeric targets; ask instead.
  return {
    policy: null,
    gaps: [
      "State the approximate daily calorie target for each goal you support, with its reason.",
      "State the minimum and maximum daily calories you allow and the tolerance for a day.",
      "State the meal slots, portion limits and how often a recipe may repeat each week.",
    ],
    conflicts: [],
  };
}
function mealPhoto() {
  return {
    items: [
      {
        name: "Grilled chicken breast",
        portion: "about one palm-sized piece",
        amount: 150,
        unit: "g",
        kcal: 248,
        protein: 46,
        carbohydrate: 0,
        fat: 5,
        preparation: "cooked",
        uncertainty: "Visual estimate; cooking oil and seasoning are unknown.",
      },
      {
        name: "Steamed white rice",
        portion: "about one cup",
        amount: 180,
        unit: "g",
        kcal: 234,
        protein: 4.3,
        carbohydrate: 51,
        fat: 0.5,
        preparation: "cooked",
        uncertainty: "Portion size estimated from the plate; could be 20% higher or lower.",
      },
    ],
    questions: ["Was any oil, butter or sauce added while cooking?"],
    notes: "All values are uncertain visual estimates for you to edit and confirm.",
  };
}

export function ruleBasedAnswer(body: any): { kind: PromptKind; task: string | null; content: unknown } {
  const { kind, task, input } = classifyPrompt(body);
  switch (kind) {
    case "coach_decision":
      return { kind, task, content: coachDecision(input) };
    case "rule_compilation":
      return { kind, task, content: ruleCompilation(input) };
    case "coach_action_selection":
      return { kind, task, content: actionSelection(input) };
    case "meal_photo":
      return { kind, task, content: mealPhoto() };
    case "nutrition": {
      if (task === "nutrition_evaluation") return { kind, task, content: nutritionEvaluation(input) };
      if (task === "nutrition_week") return { kind, task, content: nutritionWeek(input) };
      if (task === "nutrition_recipe") return { kind, task, content: nutritionRecipe(input) };
      if (task === "nutrition_policy") return { kind, task, content: nutritionPolicy() };
      throw new Error("No rule-based answer for nutrition task " + task);
    }
    default:
      throw new Error("Unrecognized prompt kind");
  }
}
