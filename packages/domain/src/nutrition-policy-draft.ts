import { z } from "zod";
import { foldNutritionText, nutritionPolicySchema } from "./nutrition.ts";

/**
 * Turning a model's policy compilation into a draft the coach can finish.
 *
 * The model is told not to invent numbers the coach never taught. In the
 * September 2026 trial the models did exactly that: Seed left
 * `tolerancePercent` (and some ages) blank inside the policy, Opus and Sonnet
 * returned `policy: null` with questions and described conflicts as objects.
 * The strict policy schema rejected all of these as invalid model output, so
 * the coach got an error instead of the questions. Now a blank or unusable
 * field becomes a precise question for the coach, the partial draft is kept
 * for the policy form, and a number the teaching never states is flagged for
 * confirmation. A draft with any gap or conflict still cannot be confirmed.
 */

const shortText = z.string().trim().min(1).max(2000);
const pickText = (item: Record<string, unknown>) => {
  for (const key of ["question", "gap", "description", "text", "message"]) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 2000);
  }
  return null;
};
/** A gap: a question string, or an object carrying one. */
const gapItem = z
  .union([shortText, z.record(z.string(), z.unknown())])
  .transform((v, ctx) => {
    const text = typeof v === "string" ? v : pickText(v);
    if (!text) {
      ctx.addIssue({ code: "custom", message: "A gap needs its question" });
      return z.NEVER;
    }
    return text;
  });
/**
 * The compilation reply. `policy` stays loosely typed here: its fields are
 * checked one by one by nutritionPolicyDraft so that a blank field becomes a
 * question instead of rejecting the whole reply.
 */
export const nutritionPolicyReplySchema = z
  .object({
    policy: z.record(z.string(), z.unknown()).nullable(),
    gaps: z.array(gapItem).max(30).default([]),
    conflicts: z.array(gapItem).max(30).default([]),
  })
  .strict();
export type NutritionPolicyReply = z.infer<typeof nutritionPolicyReplySchema>;

type Field = { label: string; question: string; mentioned: RegExp };
/** One question per policy field, asked when the draft leaves it blank or unusable. */
export const nutritionPolicyFieldQuestions: Record<string, Field> = {
  approach: {
    label: "approach",
    question:
      "Describe your nutrition approach in a few sentences: the meal pattern and the kind of client it is for.",
    mentioned: /\bapproach\b/i,
  },
  supportedDiets: {
    label: "supported diets",
    question: "Which diets do your automatic meal plans support?",
    mentioned: /supportedDiets|supported diets|which diets/i,
  },
  minAge: {
    label: "minimum client age",
    question:
      "What is the youngest client age your automatic meal plans cover?",
    mentioned: /minAge|min(?:imum)? (?:client )?age|youngest/i,
  },
  maxAge: {
    label: "maximum client age",
    question: "What is the oldest client age your automatic meal plans cover?",
    mentioned: /maxAge|max(?:imum)? (?:client )?age|oldest|upper age/i,
  },
  targets: {
    label: "calorie targets",
    question:
      "Which daily calorie target applies to each client goal you coach, and why?",
    mentioned: /\btargets?\b.*\bgoal|goal.*\btargets?\b/i,
  },
  minKcal: {
    label: "lowest daily calories",
    question: "What is the lowest daily calorie target you allow for a client?",
    mentioned: /minKcal|lowest daily|minimum daily cal/i,
  },
  maxKcal: {
    label: "highest daily calories",
    question:
      "What is the highest daily calorie target you allow for a client?",
    mentioned: /maxKcal|highest daily|maximum daily cal/i,
  },
  tolerancePercent: {
    label: "daily calorie tolerance",
    question:
      "How far may a planned day's calories be from the client's target? Give a percentage above or below it (for example 5 or 10).",
    mentioned: /toleran/i,
  },
  slots: {
    label: "meal slots",
    question:
      "Which meals should every planned day include (for example breakfast, lunch and dinner)?",
    mentioned: /\bslots?\b/i,
  },
  minServings: {
    label: "smallest portion",
    question:
      "What is the smallest portion of a recipe a client may be given, in quarter servings?",
    mentioned: /minServings|smallest (?:portion|serving)/i,
  },
  maxServings: {
    label: "largest portion",
    question:
      "What is the largest portion of a recipe a client may be given, in quarter servings?",
    mentioned: /maxServings|largest (?:portion|serving)/i,
  },
  maxRecipeRepeats: {
    label: "recipe repeat limit",
    question: "How many times may one recipe appear in a client's week?",
    mentioned: /maxRecipeRepeats|repeat/i,
  },
  allowSwaps: {
    label: "meal swaps",
    question:
      "May clients swap a planned meal for another of your recipes that passes all of your rules?",
    mentioned: /allowSwaps|\bswaps?\b/i,
  },
  forbiddenIngredients: {
    label: "forbidden ingredients",
    question:
      "Which ingredients must never appear in your plans? Answer none if there are none.",
    mentioned: /forbidden/i,
  },
  adjustment: {
    label: "automatic adjustment",
    question:
      "Should calories ever change automatically after check-ins? If yes: after how many check-ins reporting high hunger or low difficulty, over how many days, and by how many kcal?",
    mentioned: /adjust/i,
  },
  boundaries: {
    label: "referral boundaries",
    question:
      "When must a client be referred to you instead of receiving an automatic plan?",
    mentioned: /boundar|refer/i,
  },
};

const WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};
/** Every number the teaching states, as digits (thousands separators, Arabic digits and English number words included). */
export function teachingNumbers(texts: string[]) {
  const found = new Set<number>();
  for (const raw of texts) {
    const text = foldNutritionText(raw).replace(
      /(?<![\d.])\d{1,3}(?:,\d{3})+(?![\d])/g,
      (m) => m.replace(/,/g, ""),
    );
    for (const m of text.matchAll(/\d+(?:[.,]\d+)?|\.\d+/g))
      found.add(Number(m[0].replace(",", ".")));
    for (const m of text.matchAll(/\p{L}+/gu))
      if (m[0] in WORDS) found.add(WORDS[m[0]]);
  }
  return found;
}
/** Every string value inside teaching records (cases and confirmed sources). */
export function teachingTexts(values: unknown[]) {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  values.forEach(walk);
  return out;
}

const list = (v: unknown) =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v : null;
const blank = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && !v.trim()) ||
  (Array.isArray(v) && v.length === 0);

export type NutritionPolicyDraft = {
  /** A complete policy, when every field is usable; confirmable once gaps and conflicts are resolved. */
  policy: z.infer<typeof nutritionPolicySchema> | null;
  /** The usable part of an incomplete draft, to prefill the coach's policy form. */
  partialPolicy: Record<string, unknown> | null;
  gaps: string[];
  conflicts: string[];
};

/**
 * Builds the stored draft from a parsed compilation reply.
 *
 * - Blank or unusable fields become one precise question each (unless the
 *   model already asked about that field) and the draft is kept as
 *   `partialPolicy` with `policy: null`.
 * - Formatting-only differences are accepted: boundaries given as a list are
 *   joined, a single diet or slot given as text becomes a list.
 * - A switched-off automatic adjustment with its numbers left blank is filled
 *   with inert values (no calorie change); nothing is invented for a
 *   switched-on adjustment.
 * - A missing title gets a neutral name. Source references are limited to the
 *   supplied teaching cases and sources (`context.sourceIds`); without any,
 *   the draft cites all of them, which is what it was compiled from.
 * - A number that no teaching text states (for example a calorie tolerance
 *   the coach never gave) is flagged for the coach to confirm.
 */
export function nutritionPolicyDraft(
  reply: NutritionPolicyReply,
  context: { sourceIds: string[]; teaching: string[] },
): NutritionPolicyDraft {
  const gaps = [...reply.gaps],
    conflicts = [...reply.conflicts];
  const modelGaps = [...reply.gaps];
  const ask = (field: string, question?: string) => {
    const f = nutritionPolicyFieldQuestions[field];
    if (!question && f && modelGaps.some((g) => f.mentioned.test(g))) return;
    const text =
      question ??
      f?.question ??
      `Check the drafted ${field}: it is missing or cannot be used as written.`;
    if (!gaps.includes(text)) gaps.push(text);
  };
  if (!reply.policy)
    return { policy: null, partialPolicy: null, gaps, conflicts };
  const draft: Record<string, unknown> = { ...reply.policy };
  if (Array.isArray(draft.boundaries))
    draft.boundaries = draft.boundaries
      .filter((b) => typeof b === "string" && b.trim())
      .join("\n");
  for (const key of ["supportedDiets", "slots", "forbiddenIngredients"])
    draft[key] = list(draft[key]);
  if (blank(draft.title)) draft.title = "Nutrition policy";
  // Provenance: only supplied teaching cases and sources count; without any,
  // the policy cites all of them, which is what it was compiled from.
  const cited = Array.isArray(draft.sourceIds)
    ? draft.sourceIds.filter(
        (s): s is string =>
          typeof s === "string" && context.sourceIds.includes(s),
      )
    : [];
  draft.sourceIds = cited.length ? cited : [...context.sourceIds];
  const adjustment =
    draft.adjustment && typeof draft.adjustment === "object"
      ? { ...(draft.adjustment as Record<string, unknown>) }
      : null;
  if (adjustment?.enabled === false) {
    // Inert while switched off: the adjustment never runs and changes nothing.
    if (blank(adjustment.trigger)) adjustment.trigger = "hunger_high";
    if (blank(adjustment.requiredCheckins)) adjustment.requiredCheckins = 30;
    if (blank(adjustment.minimumDays)) adjustment.minimumDays = 90;
    if (blank(adjustment.deltaKcal)) adjustment.deltaKcal = 0;
    if (blank(adjustment.reason))
      adjustment.reason =
        "Automatic adjustment is off; the coach changes targets personally.";
  }
  if (adjustment) draft.adjustment = adjustment;
  const required = Object.keys(nutritionPolicySchema.shape);
  const unusable = new Set<string>();
  for (const key of required)
    if (key !== "forbiddenIngredients" && blank(draft[key])) unusable.add(key);
  if (
    draft.forbiddenIngredients === null ||
    draft.forbiddenIngredients === undefined
  )
    unusable.add("forbiddenIngredients");
  // Field by field, so that one blank field does not hide the others.
  const parsed = nutritionPolicySchema.safeParse(draft);
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && required.includes(key)) unusable.add(key);
      else if (!key) gaps.push(`Check the drafted limits: ${issue.message}.`);
    }
  for (const key of unusable) ask(key);
  // Numbers must come from the coach: flag any the teaching never states.
  const known = teachingNumbers(context.teaching);
  const unstated = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && !known.has(Math.abs(v));
  const flag = (field: string, value: number, unit = "") => {
    const f = nutritionPolicyFieldQuestions[field];
    ask(
      field,
      `Your teaching does not state the ${f.label} of ${value}${unit} in this draft. Confirm it or enter the right value before this policy is used.`,
    );
  };
  for (const [field, unit] of [
    ["minAge", ""],
    ["maxAge", ""],
    ["minKcal", " kcal"],
    ["maxKcal", " kcal"],
    ["tolerancePercent", "%"],
    ["minServings", " servings"],
    ["maxServings", " servings"],
    ["maxRecipeRepeats", ""],
  ] as const)
    if (!unusable.has(field) && unstated(draft[field]))
      flag(field, draft[field] as number, unit);
  if (!unusable.has("targets") && Array.isArray(draft.targets))
    for (const t of draft.targets as Array<Record<string, unknown>>)
      if (t && unstated(t.kcal))
        ask(
          "targets",
          `Your teaching does not state the ${t.kcal} kcal target for "${String(t.goal ?? "a goal")}" in this draft. Confirm it or enter the right value before this policy is used.`,
        );
  if (!unusable.has("adjustment") && adjustment?.enabled === true)
    for (const key of ["requiredCheckins", "minimumDays", "deltaKcal"])
      if (unstated(adjustment[key]))
        ask(
          "adjustment",
          `Your teaching does not state the automatic adjustment's ${key === "requiredCheckins" ? "number of check-ins" : key === "minimumDays" ? "number of days" : "calorie change"} (${adjustment[key]}) in this draft. Confirm it or enter the right value before this policy is used.`,
        );
  const complete = parsed.success && unusable.size === 0;
  return {
    policy: complete ? parsed.data : null,
    partialPolicy: complete ? null : draft,
    gaps: gaps.slice(0, 60),
    conflicts,
  };
}
