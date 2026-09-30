/**
 * Learning from the coach's corrections of real Brain replies (Keep training).
 * A correction (the coach edited a drafted reply before sending it, or
 * rejected it) may become ONE suggested rule the coach confirms. The model
 * proposes it (packages/providers/src/brain-learning.ts); these code checks
 * decide whether the coach ever sees it. The safety floor is unchanged: a
 * suggestion is never a rule until the coach confirms it, and a confirmed
 * rule goes through the same checks and "Check my Brain" as any other rule.
 */
import { z } from "zod";
import {
  compiledRuleFlags,
  numbersNotIn,
  type RuleFlag,
} from "./text-screen.ts";

export const RULE_CATEGORIES = [
  "progression",
  "substitution",
  "schedule",
  "recovery",
  "communication",
  "safety",
] as const;

/** What the model returns for one correction. */
export const correctionSuggestionSchema = z.object({
  learn: z.boolean(),
  rule: z
    .object({
      title: z.string().trim().min(3).max(150),
      category: z.enum(RULE_CATEGORIES),
      condition: z.string().trim().min(3).max(1000),
      directive: z.string().trim().min(3).max(2000),
    })
    .nullable()
    .default(null),
  why: z.string().trim().max(600).default(""),
});
export type CorrectionSuggestion = z.infer<typeof correctionSuggestionSchema>;
export type SuggestedRule = NonNullable<CorrectionSuggestion["rule"]>;

/** The material one suggestion is learned from (never the client's message). */
export type CorrectionMaterial = {
  kind: "edit" | "rejection";
  /** Reply category the Brain drafted (message, schedule, ...). */
  category: string | null;
  /** What the Brain drafted. */
  draft: string;
  /** What the coach sent instead (edits only). */
  coachReply: string | null;
  /** The coach's explanation or rejection note. */
  coachNote: string | null;
};

export type SuggestionIssue =
  | RuleFlag
  | "new_number"
  | "too_broad"
  | "names_software"
  | "empty";

// "Always", "any message", "every client": a rule that would apply to every
// request is broader than any one correction can show.
const BROAD =
  /^\s*(?:always|at all times|in (?:all|every|any) (?:cases?|situations?)|(?:for )?(?:any|every|all) (?:time|message|messages|reply|replies|request|requests|question|questions|client|clients|member|members|conversation|situation)s?\b\s*\.?\s*$)/i;
const SOFTWARE =
  /\b(?:seed|bytedance|byteplus|modelark|openai|chatgpt|gpt-?\d*|claude|anthropic|gemini|llm|language model|large language|artificial intelligence|a\.?i\.? (?:model|assistant))\b/i;

/**
 * Reasons a suggested rule is withheld from the coach:
 * - any warning a compiled draft rule would carry (medical, medicine, dose or
 *   diagnosis advice; a red flag not stopped and handed to the coach; links,
 *   contact details, approval claims, guarantees);
 * - a number the coach did not write (in their reply or note);
 * - a condition that applies to everything ("always", "any message");
 * - naming the software or its vendor.
 */
export function suggestionIssues(
  rule: SuggestedRule,
  source: CorrectionMaterial,
  redFlag?: (text: string) => boolean,
): SuggestionIssue[] {
  const issues: SuggestionIssue[] = [];
  if (!rule.condition.trim() || !rule.directive.trim()) issues.push("empty");
  issues.push(...compiledRuleFlags(rule, redFlag));
  const coachWords = [source.coachReply ?? "", source.coachNote ?? ""].join(
    " ",
  );
  if (
    numbersNotIn(`${rule.title}. ${rule.condition}. ${rule.directive}`, coachWords)
      .length
  )
    issues.push("new_number");
  if (BROAD.test(rule.condition) || rule.condition.trim().split(/\s+/).length < 3)
    issues.push("too_broad");
  if (SOFTWARE.test(`${rule.title} ${rule.condition} ${rule.directive}`))
    issues.push("names_software");
  return [...new Set(issues)];
}

/**
 * Removes the client's name from text sent to the model or shown as an
 * example. Whole words only, case-insensitive; names shorter than two
 * letters are left alone.
 */
export function withoutName(text: string, names: string[]) {
  let out = String(text ?? "");
  for (const name of names
    .flatMap((n) => String(n ?? "").split(/\s+/))
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`(^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, "giu"),
      "$1[client]",
    );
  }
  return out;
}
