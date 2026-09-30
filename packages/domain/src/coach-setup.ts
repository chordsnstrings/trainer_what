// Pure checks behind the coach setup wizard's automatic go-live checks
// (apps/api/src/coach-setup.ts): a real name, a public page free of contact
// details and medical claims, and subdomain suggestions. Browser-safe.
import { screeningText } from "./index.ts";
import { LINK, givesMedicalAdvice, hasContactNumber } from "./text-screen.ts";
import { slugProblem } from "./web-address.ts";

const B = "(?:^|[^\\p{L}\\p{N}])",
  E = "(?![\\p{L}\\p{N}])";
const word = (alternatives: string) =>
  new RegExp(B + "(?:" + alternatives + ")" + E, "iu");

/** The platform's own name ("trainsyou", "trains you"), in any spacing. */
const PLATFORM_NAME = /(?<![\p{L}])trains\s*-?\s*you(?![\p{L}])/iu;
export type NameProblem = "missing" | "too_short" | "not_a_name" | "placeholder";
const PLACEHOLDERS = new Set([
  "test",
  "tester",
  "testing",
  "test test",
  "test user",
  "coach",
  "trainer",
  "admin",
  "user",
  "name",
  "my name",
  "your name",
  "full name",
  "first last",
  "first name last name",
  "demo",
  "demo user",
  "fake",
  "fake name",
  "asdf",
  "asdf asdf",
  "qwerty",
  "john doe",
  "jane doe",
  "anonymous",
  "unknown",
  "none",
  "null",
  "example",
  "sample",
  "trainsyou",
]);
/**
 * A real person's name: at least two words of letters (apostrophes, hyphens
 * and dots allowed), no digits, links or email addresses, and not a
 * placeholder such as "Test User". Arabic names pass.
 */
export function realNameProblem(value: string | null | undefined): NameProblem | null {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name) return "missing";
  if (/[\p{N}@]|https?:|www\./iu.test(name)) return "not_a_name";
  if (/[^\p{L}\p{M}\s.'’-]/u.test(name)) return "not_a_name";
  const words = name.split(" ").filter((w) => /\p{L}/u.test(w));
  if (words.length < 2 || (name.match(/\p{L}/gu) ?? []).length < 4)
    return "too_short";
  const folded = name.toLowerCase().replace(/[.'’-]/g, "").replace(/\s+/g, " ");
  if (PLACEHOLDERS.has(folded) || words.every((w) => PLACEHOLDERS.has(w.toLowerCase())))
    return "placeholder";
  if (/(\p{L})\1{3,}/iu.test(name)) return "placeholder";
  // Open sign-up: a coach's name may not pass them off as the platform.
  if (PLATFORM_NAME.test(folded)) return "placeholder";
  return null;
}
export const NAME_PROBLEM_MESSAGES: Record<NameProblem, string> = {
  missing: "Add your name.",
  too_short: "Use your first and last name.",
  not_a_name: "Use your name only, without numbers, links or symbols.",
  placeholder: "Use your real first and last name.",
};

/**
 * Medical claims a public coaching page must not make: cures, treating or
 * reversing a condition, diagnosing, prescribing medicine, guaranteed or
 * clinically "proven" results and rapid weight-loss promises.
 */
const MEDICAL_CLAIM = word(
  [
    "cure[sd]?|curing",
    "heal(?:s|ed|ing)?\\s+(?:your\\s+|the\\s+)?(?:\\p{L}+\\s+)?(?:injur\\p{L}*|pain|diabetes|diseases?|conditions?|illness\\p{L}*)",
    "revers(?:e|es|ed|ing)\\s+(?:your\\s+|the\\s+)?(?:type\\s+(?:1|2|one|two)\\s+)?(?:diabetes|diseases?|pcos|pcod|insulin\\s+resistance|arthrit\\p{L}*|hypertension|conditions?)",
    "treat(?:s|ed|ing|ment|ments)?\\s+(?:of\\s+|for\\s+)?(?:your\\s+|the\\s+)?(?:type\\s+(?:1|2|one|two)\\s+)?(?:diabetes|diseases?|depression|anxiety|injur\\p{L}*|pcos|pcod|arthrit\\p{L}*|hypertension|high\\s+blood\\s+pressure|back\\s+pain|conditions?|illness\\p{L}*|obesity)",
    "diagnos\\p{L}*",
    "prescri(?:be|bes|bed|bing|ption)\\s+(?:\\p{L}+\\s+)?(?:medications?|medicines?|drugs?|pills?)",
    "guarantee[ds]?|guaranteeing|100\\s*%\\s+(?:results?|guaranteed|success)",
    "(?:medically|clinically|scientifically)\\s+(?:proven|approved)",
    "(?:doctor|fda|dha|moh)[\\s-]+approved",
    "lose\\s+\\d+\\s*(?:kg|kgs|kilos?|kilograms?|lbs?|pounds)\\s+in\\s+(?:\\d+|one|two|three|a)\\s*(?:days?|weeks?)",
    // Arabic, in screeningText's folded spelling (أ→ا, ئ→ي, ة→ه): "I/we/he
    // treat(s)", treating diabetes or disease, healing, guaranteed results.
    "[اينت]عالج\\p{L}*|علاج\\s+(?:السكري|الامراض|المرض|مرض)|شفاء|[اينت]?شفي\\p{L}*|مضمون\\p{L}*|نتايج\\s+مضمون\\p{L}*",
  ].join("|"),
);

export type PageIssue = {
  field: string;
  issue: "contact" | "link" | "medical_claim" | "platform_name";
};
/**
 * Structured fields the website offers on purpose (its contact mailbox,
 * WhatsApp number and social links) and non-text keys; only the free text
 * around them is screened.
 */
const ADDRESS_KEYS = new Set([
  "contactEmail",
  "whatsapp",
  "instagram",
  "youtube",
  "email",
  "url",
  "href",
  "src",
  "mediaId",
  "id",
  "slug",
  "language",
  "color",
  "accent",
  "logo",
]);
/**
 * Screens every visible string on the coach's public page (name, brand text,
 * website draft or published text, plan names and descriptions). Phone
 * numbers, email addresses and links take members off the platform; medical
 * claims and medical advice are not allowed on a coaching page.
 */
export function pageIssues(fields: Record<string, unknown>): PageIssue[] {
  const issues: PageIssue[] = [];
  const seen = new Set<string>();
  const add = (field: string, issue: PageIssue["issue"]) => {
    const key = field + ":" + issue;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push({ field, issue });
    }
  };
  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > 6 || value == null) return;
    if (typeof value === "string") {
      if (!value.trim()) return;
      if (LINK.test(value)) add(path, "link");
      if (hasContactNumber(value)) add(path, "contact");
      const folded = screeningText(value);
      if (MEDICAL_CLAIM.test(folded) || givesMedicalAdvice(value))
        add(path, "medical_claim");
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 200).forEach((v, i) => visit(v, `${path}[${i}]`, depth + 1));
      return;
    }
    if (typeof value === "object")
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (ADDRESS_KEYS.has(k)) continue;
        visit(v, path ? `${path}.${k}` : k, depth + 1);
      }
  };
  visit(fields, "", 0);
  // The page's own name may not pass the coach off as the platform or its
  // staff ("trainsyou Support"); mentioning the platform in the bio is fine.
  if (typeof fields.name === "string" && PLATFORM_NAME.test(fields.name))
    add("name", "platform_name");
  return issues;
}

/** A subdomain-shaped slug from a name: ASCII letters, digits and hyphens. */
export function slugFromName(name: string) {
  let slug = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!/^[a-z]/.test(slug)) slug = ("coach-" + slug).replace(/-+$/, "");
  if (slug.length < 3) slug = (slug + "-coach").replace(/^-/, "");
  return slug.slice(0, 40).replace(/-+$/, "");
}
/** Valid, non-reserved candidates to offer, best first (availability is the caller's). */
export function subdomainCandidates(name: string, extra = "") {
  const base = slugFromName(name);
  const first = base.split("-")[0];
  const list = [
    base,
    `${base}-coach`,
    `coach-${base}`,
    `${base}-fit`,
    `${base}-training`,
    first.length >= 3 ? `${first}-coach` : "",
    extra ? `${base}-${extra}` : "",
  ];
  return [...new Set(list.map((s) => s.slice(0, 40).replace(/-+$/, "")))].filter(
    (s) => s && !slugProblem(s),
  );
}
