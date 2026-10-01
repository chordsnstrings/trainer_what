/**
 * "Suggested from your edits": once a week the coach's own edits of Brain
 * plans, weekly adjustments and meal weeks are grouped into at most three
 * suggested rules (plans) or nutrition cases (meal weeks), each linked to the
 * edits it comes from. The model proposes them (packages/providers/src/brain-edits.ts);
 * these code checks decide whether the coach ever sees one, and nothing is
 * used until the coach confirms it (docs/features/brain-learning.md).
 */
import { z } from "zod";
import { nutritionCategories } from "./nutrition.ts";
import { normalizeTerm } from "./brain-plans.ts";
import {
  RULE_CATEGORIES,
  suggestionIssues,
  type SuggestionIssue,
} from "./brain-learning.ts";

/** At most this many edits go into one weekly request. */
export const EDIT_BATCH_LIMIT = 30;
/** At most this many suggestions come out of one weekly request. */
export const EDIT_SUGGESTION_LIMIT = 3;

/** One edit the coach made, as the model sees it (`ref` is E1, E2, ...). */
export type EditItem = {
  ref: string;
  kind: "plan" | "adaptation" | "meal_week";
  /** plans: edited or rejected; meal weeks: amend, assign or archive. */
  action: string;
  /** Who the plan was for (goal category, experience, days, equipment), never who. */
  segment: { goal: string; experience: string; daysPerWeek: number; equipment: string[] } | null;
  /** What the coach changed (plans: field paths with before and after). */
  changes: Array<{ path: string; from: unknown; to: unknown }>;
  /** The coach's own note or reason (the client's name replaced by [client]). */
  note: string;
};

export const editSuggestionSchema = z.object({
  target: z.enum(["rule", "nutrition"]),
  title: z.string().trim().min(3).max(150),
  category: z.string().trim().min(3).max(40),
  condition: z.string().trim().min(3).max(1000),
  directive: z.string().trim().min(3).max(2000),
  // A comma-separated string ("E1, E3") is read as the list it names (the
  // live test saw it); every reference is still checked against the batch.
  evidence: z.preprocess(
    (v) => (typeof v === "string" ? v.split(/[\s,;]+/).filter(Boolean) : v),
    z.array(z.string().trim().min(2).max(8)).min(1).max(EDIT_BATCH_LIMIT),
  ),
  why: z.string().trim().max(600).default(""),
});
export const editGroupingSchema = z.object({
  suggestions: z.array(editSuggestionSchema).max(10).default([]),
});
export type EditSuggestion = z.infer<typeof editSuggestionSchema>;

export type EditSuggestionIssue =
  | SuggestionIssue
  | "unknown_evidence"
  | "thin_evidence"
  | "wrong_target"
  | "wrong_category"
  | "health_topic";

/**
 * Health words: a suggestion about them, or one citing an edit whose note
 * mentions them, is withheld. Health, medicines and supplements go to the
 * coach, never into learned rules (the live test saw "knee ache" edits and,
 * once in 44 calls, "take 5 g creatine daily" turned into a rule).
 */
const HEALTH =
  /\b(?:pain\w*|ache[sd]?|aching|discomfort|sore(?:ness)?|hurts?|hurting|injur\w*|strain(?:ed|s)?|sprain\w*|surgery|operation|physio\w*|therap\w*|medical|medicine\w*|medication\w*|condition|diagnos\w*|symptom\w*|pregnan\w*|tweaked|niggle\w*|dizz\w*|faint\w*|asthma|diabet\w*|blood pressure|supplement\w*|creatine|pre-?workout|fat[- ]burners?|steroids?|sarms?|testosterone|hormone\w*|vitamins?|pills?|tablets?|capsules?|dose|dosage|doses|mg|ibuprofen|paracetamol|painkillers?|caffeine)\b|ألم|وجع|إصاب|حامل|دوخ|مكمل|دواء|أدوية|حبوب/i;

const PLAN_KINDS = new Set(["plan", "adaptation"]);
const words = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");

/**
 * What the cited edits ground: the coach's notes, the values the coach set
 * and who the plans were for (segment: days per week, experience, goal,
 * equipment). A number elsewhere in a suggestion is one the coach never wrote.
 */
export function coachWordsOf(items: EditItem[]) {
  return items
    .flatMap((i) => [
      i.note,
      ...i.changes.map((c) => `${c.path.split(".").slice(-2).join(" ")} ${words(c.to)}`),
      i.segment
        ? `${i.segment.daysPerWeek} days per week ${i.segment.experience} ${i.segment.goal} ${(i.segment.equipment ?? []).join(" ")}`
        : "",
    ])
    .join(" ");
}

/**
 * Reasons a suggestion is withheld from the coach: every check a suggested
 * rule from a corrected reply gets (medical or dose advice, a red flag not
 * handed over, links, contact details, approval claims, guarantees, numbers
 * the coach did not write in the cited edits, "always"/"any client"
 * conditions, naming the software, other clients' data, deciding how replies
 * are sent), plus evidence: every cited edit must exist and fit the target
 * (plan edits for rules, meal-week edits for nutrition), and a pattern needs
 * two edits, or one whose note says what to do.
 */
export function editSuggestionIssues(
  suggestion: EditSuggestion,
  batch: EditItem[],
  redFlag?: (text: string) => boolean,
): EditSuggestionIssue[] {
  const issues: EditSuggestionIssue[] = [];
  const byRef = new Map(batch.map((i) => [i.ref, i]));
  const refs = [...new Set(suggestion.evidence)];
  const cited = refs.map((r) => byRef.get(r)).filter((i): i is EditItem => !!i);
  if (cited.length !== refs.length || !cited.length) issues.push("unknown_evidence");
  if (cited.length === 1 && cited[0].note.trim().length < 10) issues.push("thin_evidence");
  const planTarget = suggestion.target === "rule";
  if (cited.some((i) => PLAN_KINDS.has(i.kind) !== planTarget)) issues.push("wrong_target");
  const categories: readonly string[] = planTarget ? RULE_CATEGORIES : nutritionCategories;
  if (!categories.includes(suggestion.category)) issues.push("wrong_category");
  if (
    HEALTH.test(`${suggestion.title}. ${suggestion.condition}. ${suggestion.directive}`) ||
    cited.some((i) => HEALTH.test(i.note))
  )
    issues.push("health_topic");
  const ruleIssues = suggestionIssues(
    {
      title: suggestion.title,
      category: (RULE_CATEGORIES as readonly string[]).includes(suggestion.category)
        ? (suggestion.category as (typeof RULE_CATEGORIES)[number])
        : "communication",
      condition: suggestion.condition,
      directive: suggestion.directive,
    },
    { kind: "edit", category: null, draft: "", coachReply: coachWordsOf(cited), coachNote: null },
    redFlag,
  );
  return [...new Set([...issues, ...ruleIssues])];
}

const tokens = (value: unknown) =>
  new Set(normalizeTerm(String(value ?? "")).split(" ").filter(Boolean));
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size && !b.size) return 1;
  const same = [...a].filter((t) => b.has(t)).length;
  return same / (a.size + b.size - same);
};
/**
 * A member profile that repeats a held-out plan scenario (same experience and
 * days, and goal, equipment and limitations at least 90% the same words).
 * Examples from such a member never join a learning snapshot or a weekly
 * suggestion, so the held-out set stays independent of what the Brain learns.
 */
export function planProfileDuplicate(a: any, b: any) {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (a.experience !== b.experience || Number(a.daysPerWeek) !== Number(b.daysPerWeek)) return false;
  return (["goal", "equipment", "limitations"] as const).every(
    (k) => jaccard(tokens(a[k]), tokens(b[k])) >= 0.9,
  );
}
