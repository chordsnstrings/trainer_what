import { z } from "zod";
import { safetySignal, screeningText } from "./index.ts";

/**
 * The published coaching safety policy may only tighten coaching safety
 * handling. The floor below and the deterministic red-flag screen in
 * safetySignal() are enforced in code; no document can remove a red flag,
 * exempt a category or lengthen a review deadline.
 */
export const SAFETY_POLICY_KEY = "coaching-safety-policy";
export const SAFETY_FLOOR = Object.freeze({
  /** Longest a training hold may wait for the trainer before escalation. */
  holdReviewHours: 24,
  /** Longest a policy personal-review question may wait before escalation. */
  personalReviewHours: 72,
  minimumHours: 1,
  /** Always pause training; checked by safetySignal() before any policy. */
  holdCategories: Object.freeze(["pain", "urgent", "pregnancy", "self_harm"]),
});

/** Opt-in categories a policy can route to the trainer's personal review. */
export const REVIEW_CATEGORIES = Object.freeze({
  medication: {
    label: "Medication",
    terms: [
      "medication",
      "medications",
      "medicines",
      "my medicine",
      "take medicine",
      "taking medicine",
      "prescription",
      "prescribed",
      "insulin",
      "steroid",
      "steroids",
      "antibiotic",
      "antibiotics",
      "antidepressant",
      "antidepressants",
      "blood thinner",
      "blood thinners",
      "دواء",
      "دوائي",
      "أدوية",
      "أدويتي",
      "حبوب الدواء",
      "وصفة طبية",
      "إنسولين",
      "ستيرويد",
      "مضاد حيوي",
    ],
  },
  supplements: {
    label: "Supplements",
    terms: [
      "supplement",
      "supplements",
      "creatine",
      "pre-workout",
      "fat burner",
      "fat burners",
      "مكمل",
      "مكملات",
      "كرياتين",
      "حارق دهون",
    ],
  },
  eating_disorder: {
    label: "Disordered eating",
    terms: [
      "binge eating",
      "binge eat",
      "binged on food",
      "purge",
      "purging",
      "laxative",
      "laxatives",
      "starving myself",
      "anorexia",
      "anorexic",
      "bulimia",
      "bulimic",
      "eating disorder",
      "throw up after eating",
      "اضطراب الأكل",
      "فقدان الشهية",
      "الشره",
      "تقيؤ",
      "مسهل",
      "مسهلات",
      "أجوع نفسي",
    ],
  },
  chronic_condition: {
    label: "Chronic conditions",
    terms: [
      "diabetes",
      "diabetic",
      "asthma",
      "hypertension",
      "high blood pressure",
      "heart condition",
      "heart disease",
      "epilepsy",
      "kidney disease",
      "arthritis",
      "thyroid",
      "السكري",
      "سكري",
      "الربو",
      "ربو",
      "ضغط الدم",
      "مرض القلب",
      "الصرع",
      "الغدة الدرقية",
      "التهاب المفاصل",
    ],
  },
  surgery_recovery: {
    label: "Surgery and injury recovery",
    terms: [
      "surgery",
      "post-op",
      "post op",
      "stitches",
      "physiotherapy",
      "physio",
      "fracture",
      "fractured",
      "broken bone",
      "جراحة",
      "عملية جراحية",
      "غرز",
      "علاج طبيعي",
      "كسر في العظم",
      "عظم مكسور",
    ],
  },
  possible_minor: {
    label: "Possible minor",
    terms: [
      "under 18",
      "i am 13 years old",
      "i'm 13 years old",
      "i am 14 years old",
      "i'm 14 years old",
      "i am 15 years old",
      "i'm 15 years old",
      "i am 16 years old",
      "i'm 16 years old",
      "i am 17 years old",
      "i'm 17 years old",
      "عمري 13",
      "عمري 14",
      "عمري 15",
      "عمري 16",
      "عمري 17",
      "تحت 18",
    ],
  },
} as const);
export type ReviewCategory = keyof typeof REVIEW_CATEGORIES;
const reviewCategoryKeys = Object.keys(REVIEW_CATEGORIES) as [
  ReviewCategory,
  ...ReviewCategory[],
];

const termPattern = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}' -]*$/u;
/** Letters and numbers left once a term is folded like screened text. */
const foldedCore = (value: string) =>
  screeningText(value).replace(/[^\p{L}\p{N}]/gu, "");
const term = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(termPattern, "Use words, numbers, spaces, hyphens or apostrophes")
  // Tatweel and diacritics are removed before matching; a term made only of
  // them would match any punctuation and hold or route every message.
  .refine(
    (value) => foldedCore(value).length >= 2,
    "Use at least two letters or numbers besides diacritics and tatweel",
  );
const hours = (max: number) =>
  z.number().int().min(SAFETY_FLOOR.minimumHours).max(max);
export const safetyPolicySchema = z
  .object({
    schema: z.literal(1),
    summary: z.string().trim().max(4000).default(""),
    redFlagTerms: z.array(term).max(200).default([]),
    personalReviewCategories: z
      .array(z.enum(reviewCategoryKeys))
      .max(20)
      .default([]),
    personalReviewTerms: z.array(term).max(200).default([]),
    holdReviewHours: hours(SAFETY_FLOOR.holdReviewHours).optional(),
    personalReviewHours: hours(SAFETY_FLOOR.personalReviewHours).optional(),
  })
  .strict();
export type SafetyPolicyDocument = z.infer<typeof safetyPolicySchema>;
const allowedFields = new Set(Object.keys(safetyPolicySchema.shape));

export type SafetyPolicyPin = {
  key: string;
  version: number | null;
  effectiveAt: string | null;
  source: "published" | "floor";
  ignored: string[];
};
export type EffectiveSafetyPolicy = {
  holdReviewHours: number;
  personalReviewHours: number;
  redFlagTerms: string[];
  personalReviewCategories: ReviewCategory[];
  personalReviewTerms: string[];
  summary: string;
  pin: SafetyPolicyPin;
};

/** Strict check for a draft: weakening or unknown instructions are refused. */
export function validateSafetyPolicy(
  content: string,
):
  | { ok: true; policy: SafetyPolicyDocument; effective: EffectiveSafetyPolicy }
  | { ok: false; weakening: boolean; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return {
      ok: false,
      weakening: false,
      errors: ["The coaching safety policy must be a JSON object."],
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return {
      ok: false,
      weakening: false,
      errors: ["The coaching safety policy must be a JSON object."],
    };
  const errors: string[] = [];
  let weakening = false;
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value))
    if (!allowedFields.has(key)) {
      weakening = true;
      errors.push(
        `"${key}" is not allowed: a policy can only add red-flag terms, add personal-review categories or terms, and shorten review deadlines.`,
      );
    }
  for (const [key, max] of [
    ["holdReviewHours", SAFETY_FLOOR.holdReviewHours],
    ["personalReviewHours", SAFETY_FLOOR.personalReviewHours],
  ] as const)
    if (typeof value[key] === "number" && (value[key] as number) > max) {
      weakening = true;
      errors.push(
        `${key} cannot exceed the ${max}-hour safety floor; a policy may only shorten it.`,
      );
    }
  if (errors.length) return { ok: false, weakening, errors };
  const parsed = safetyPolicySchema.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      weakening: false,
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "policy"}: ${i.message}`,
      ),
    };
  return {
    ok: true,
    policy: parsed.data,
    effective: effectiveSafetyPolicy({
      key: SAFETY_POLICY_KEY,
      version: null,
      content,
      effectiveAt: null,
    }),
  };
}

/** Draft/publish gate for the structured policy document key. */
export function assertSafetyPolicyDocument(key: string, content: string) {
  if (key !== SAFETY_POLICY_KEY) return;
  const result = validateSafetyPolicy(content);
  if (!result.ok)
    throw Object.assign(new Error(result.errors.join(" ")), {
      statusCode: 400,
      code: result.weakening
        ? "SAFETY_POLICY_WEAKENS"
        : "SAFETY_POLICY_INVALID",
    });
}

const unique = <T>(values: T[]) => [...new Set(values)];
/**
 * Runtime reading of the published document. Anything that bypassed the
 * draft check is ignored field by field: tightening instructions still apply,
 * weakening ones never do, and the floor always holds.
 */
export function effectiveSafetyPolicy(
  document: {
    key: string;
    version: number | null;
    content: string;
    effectiveAt: string | null;
  } | null,
): EffectiveSafetyPolicy {
  const floor: EffectiveSafetyPolicy = {
    holdReviewHours: SAFETY_FLOOR.holdReviewHours,
    personalReviewHours: SAFETY_FLOOR.personalReviewHours,
    redFlagTerms: [],
    personalReviewCategories: [],
    personalReviewTerms: [],
    summary: "",
    pin: {
      key: SAFETY_POLICY_KEY,
      version: null,
      effectiveAt: null,
      source: "floor",
      ignored: [],
    },
  };
  if (!document) return floor;
  const pin: SafetyPolicyPin = {
    key: document.key,
    version: document.version,
    effectiveAt: document.effectiveAt,
    source: "published",
    ignored: [],
  };
  let raw: any;
  try {
    raw = JSON.parse(document.content);
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    pin.ignored.push("document is not a JSON policy");
    return { ...floor, pin };
  }
  for (const key of Object.keys(raw))
    if (!allowedFields.has(key)) pin.ignored.push(`unknown field ${key}`);
  const terms = (field: string) => {
    const list = Array.isArray(raw[field]) ? raw[field].slice(0, 200) : [];
    const valid = list.filter((t: unknown) => term.safeParse(t).success);
    if (valid.length !== list.length)
      pin.ignored.push(
        `invalid ${field} (${list.length - valid.length} ignored)`,
      );
    return unique(valid.map((t: string) => t.trim()));
  };
  const deadline = (field: "holdReviewHours" | "personalReviewHours") => {
    const max = SAFETY_FLOOR[field],
      value = raw[field];
    if (value === undefined) return max;
    if (!Number.isFinite(value)) {
      pin.ignored.push(`invalid ${field}`);
      return max;
    }
    if (value > max) pin.ignored.push(`${field} above the ${max}-hour floor`);
    return Math.max(
      SAFETY_FLOOR.minimumHours,
      Math.min(max, Math.floor(value)),
    );
  };
  const categories = Array.isArray(raw.personalReviewCategories)
    ? raw.personalReviewCategories
    : [];
  const knownCategories = categories.filter((c: unknown) =>
    reviewCategoryKeys.includes(c as ReviewCategory),
  );
  if (knownCategories.length !== categories.length)
    pin.ignored.push("unknown personalReviewCategories");
  return {
    holdReviewHours: deadline("holdReviewHours"),
    personalReviewHours: deadline("personalReviewHours"),
    redFlagTerms: terms("redFlagTerms"),
    personalReviewCategories: unique(knownCategories) as ReviewCategory[],
    personalReviewTerms: terms("personalReviewTerms"),
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 4000) : "",
    pin,
  };
}

/** Pinned deadlines are written by the server as ISO timestamps; anything else is ignored. */
export const PINNED_DUE_SQL =
  "CASE WHEN data->>'reviewDueAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?Z$' THEN (data->>'reviewDueAt')::timestamptz END";
/**
 * The deadline that governs an open review: the earlier of the deadline
 * pinned when it opened and its age limit under the current policy. $1 is
 * the current hold deadline in hours, $2 the personal-review deadline.
 */
export const EFFECTIVE_DUE_SQL = `LEAST(coalesce(${PINNED_DUE_SQL},'infinity'::timestamptz),created_at+make_interval(hours=>CASE WHEN data->>'category'='safety' THEN $1::int ELSE $2::int END))`;
const compiled = new Map<string, RegExp>();
/** Terms are folded like the red-flag screen; Arabic clitic prefixes are allowed. */
function matcher(value: string) {
  let pattern = compiled.get(value);
  if (!pattern) {
    const folded = screeningText(value).trim().replace(/\s+/g, " ");
    // Defence in depth: a term with no letters or numbers never matches.
    if (foldedCore(folded).length < 2) {
      pattern = /(?!)/u;
      compiled.set(value, pattern);
      return pattern;
    }
    const escaped = folded
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/ /g, "\\s+");
    pattern = new RegExp(
      "(?:^|[^\\p{L}\\p{N}])(?:[وفبلك]{0,2}(?:ال)?)?" +
        escaped +
        "(?![\\p{L}\\p{N}])",
      "u",
    );
    if (compiled.size > 5000) compiled.clear();
    compiled.set(value, pattern);
  }
  return pattern;
}
export type SafetyScreen = {
  /** Pause training and escalate: the code floor or a policy red-flag term. */
  hold: boolean;
  floor: boolean;
  policyTerms: string[];
  /** Route to the trainer instead of an automatic response (never weaker than hold). */
  review: boolean;
  reviewCategories: string[];
};
export function screenSafety(
  text: string,
  policy: Pick<
    EffectiveSafetyPolicy,
    "redFlagTerms" | "personalReviewCategories" | "personalReviewTerms"
  >,
): SafetyScreen {
  const screened = screeningText(text);
  const floor = safetySignal(text);
  const policyTerms = policy.redFlagTerms.filter((t) =>
    matcher(t).test(screened),
  );
  const hold = floor || policyTerms.length > 0;
  const reviewCategories: string[] = policy.personalReviewCategories.filter(
    (c) => REVIEW_CATEGORIES[c].terms.some((t) => matcher(t).test(screened)),
  );
  if (policy.personalReviewTerms.some((t) => matcher(t).test(screened)))
    reviewCategories.push("custom");
  return {
    hold,
    floor,
    policyTerms,
    review: !hold && reviewCategories.length > 0,
    reviewCategories,
  };
}
