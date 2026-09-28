// Free-text screens shared by every place a model's or a person's words reach
// a member: spoken voice lines and plan cues (voice-session.ts), and the
// Brain's plan text, evaluation answers and compiled rules. Pure and
// browser-safe (the web app screens trainer phrases with phraseIssues).
import { safetySignal, screeningText } from "./index.ts";

// ---------------------------------------------------------------------------
// Free-wording checks. Numbers belong to code: a trainer phrase or a Brain
// suggestion may not contain digits or number words, medical or treatment
// language, red-flag terms, unsafe technique, links, or instructions to change
// the prescription.
// ---------------------------------------------------------------------------
const B = "(?:^|[^\\p{L}\\p{N}])",
  E = "(?![\\p{L}\\p{N}])";
const word = (alternatives: string, flags = "iu") =>
  new RegExp(B + "(?:" + alternatives + ")" + E, flags);
const NUMBER_ALTS =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dozen|half|double|triple|twice|" +
  "صفر|واحده?|اثنين|اثنان|ثنتين|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه|ست|سته|سبع|سبعه|ثمان|ثماني|ثمانيه|تسع|تسعه|عشر|عشره|عشرين|ثلاثين|اربعين|خمسين|ستين|مئه|ميه|نصف|ضعف";
const NUMBER_WORDS = word(NUMBER_ALTS);
const MEDICAL_ALTS =
  "diagnos\\p{L}*|anti-?inflammator\\p{L}*|salbutamol|inhalers?|tendin\\p{L}*|arthrit\\p{L}*|degenerat\\p{L}*|surger(?:y|ies)|surgical|milligrams?|\\d+\\s*mg|medicines?|medications?|medical|doses?|dosage|ibuprofen|paracetamol|acetaminophen|aspirin|painkillers?|pills?|supplements?|rehab\\p{L}*|therap\\p{L}*|treat(?:s|ed|ing|ment|ments)?|cures?|heal(?:s|ed|ing)?|doctors?|physio\\p{L}*|symptoms?|diseases?|injections?|ice\\s+it|push\\s+through|work\\s+through\\s+(?:it|the\\s+\\p{L}+)|(?:rebuild|repair)\\s+(?:the|your)\\s+(?:\\p{L}+\\s+)?(?:knees?|shoulders?|back|hips?|ankles?|joints?|tendons?)|no\\s+pain\\s*,?\\s*no\\s+gain|" +
    // Telling someone to ignore or train through a symptom.
    "ignore\\s+(?:it|that|this|(?:the|your|any)\\s+\\p{L}+|\\p{L}*(?:pain|ache|dizz\\p{L}*|hurt\\p{L}*))|through\\s+the\\s+(?:burn|pain|discomfort|ache)|shake\\s+it\\s+off|tough\\s+it\\s+out|keep\\s+going\\s+(?:if|even|when|though|through|anyway|regardless)|(?:if|even\\s+if|when)\\s[^.!?;]{0,60}(?:just\\s+)?(?:keep|carry)\\s+(?:going|on)|clicks?|clicking|pops|popping|popped|numb\\p{L}*|tingl\\p{L}*|twinges?|swell\\p{L}*|swollen|" +
    "دواء|ادويه|علاج|طبيب|دكتور|تشخيص|مسكن|مسكنات|حبوب|مكملات";
/** Medical or treatment language in a spoken line (a prescription is the plan's word only). */
export const MEDICAL = word("prescri(?:be|bed|bes|ption|ptions)|" + MEDICAL_ALTS);
/**
 * The same screen for written plan text, where "prescribed sets" is ordinary
 * training language.
 */
export const MEMBER_MEDICAL = word(MEDICAL_ALTS);
export const PRESCRIPTION_CHANGE = word(
  "(?:extra|additional|another|bonus|more)\\s+(?:sets?|reps?|rounds?|weight|load)|(?:add|increase|decrease|reduce|drop|lower|raise|double|change)\\s+(?:the\\s+|your\\s+)?(?:weight|load|reps?|sets?|kilos?|kilograms?|rest)|heavier|lighter|less\\s+weight|go\\s+up|max(?:imum)?\\s+out|to\\s+failure|skip\\s+(?:the\\s+)?rest|" +
    // Training to failure or beyond the plan, and dropping the warm-up.
    "until\\s+(?:you\\s+)?(?:can'?t|cannot|fail\\p{L}*|drop)|as\\s+many\\s+as\\s+(?:you\\s+)?(?:can|possible)|amrap|(?:a\\s+)?few\\s+(?:more|extra)|squeeze\\s+out|skip\\s+(?:the\\s+|your\\s+)?(?:warm\\s*-?\\s*ups?|cool\\s*-?\\s*downs?|stretch\\p{L}*)|go\\s+straight\\s+in|no\\s+(?:need\\s+(?:for|to)\\s+)?(?:a\\s+)?warm\\s*-?\\s*up|" +
    "زيد|زود|نقص|قلل|اثقل|اخف",
);
// Technique instructions that are unsafe as a spoken default. "Don't round
// your back" is a good cue, so a negated instruction is removed first.
const UNSAFE_ALTS =
  "hold\\s+(?:your|the)\\s+breath|strain\\s+(?:hard|harder|as\\s+hard)|bear\\s+down|round\\s+(?:your|the)\\s+(?:back|spine)|yank\\p{L}*|jerk\\p{L}*|bounce\\p{L}*|swing\\s+(?:it|the\\s+\\p{L}+)\\s+up|cheat\\p{L}*|lock\\s+(?:out\\s+)?your\\s+(?:knees|elbows)|as\\s+heavy\\s+as\\s+(?:you\\s+)?(?:can|possible)|ego\\s+lift\\p{L}*|use\\s+momentum";
export const UNSAFE_TECHNIQUE = word(UNSAFE_ALTS);
const NEGATED_UNSAFE = new RegExp(
  B + "(?:don'?t|do\\s+not|never|avoid|no|without)\\s+(?:\\p{L}+\\s+){0,2}?(?:" + UNSAFE_ALTS + ")" + E,
  "giu",
);
export const unsafeTechnique = (folded: string) =>
  UNSAFE_TECHNIQUE.test(folded.replace(NEGATED_UNSAFE, " "));
export const LINK = /https?:\/\/|www\.|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/iu;
export const MARKUP = /[<>{}[\]\\`|#*_~^]|[\u0000-\u001f\u007f]/u;
export type PhraseIssue =
  | "empty"
  | "too_long"
  | "number"
  | "medical"
  | "red_flag"
  | "prescription_change"
  | "unsafe_technique"
  | "link"
  | "unsupported_characters";

/** Checks one free-worded spoken line (a trainer phrase or a Brain suggestion). */
export function phraseIssues(text: string, maxLength = 200): PhraseIssue[] {
  const value = String(text ?? "").trim();
  if (!value) return ["empty"];
  const folded = screeningText(value);
  const issues: PhraseIssue[] = [];
  if (value.length > maxLength) issues.push("too_long");
  if (/\p{Nd}/u.test(value) || NUMBER_WORDS.test(folded)) issues.push("number");
  if (MEDICAL.test(folded)) issues.push("medical");
  if (safetySignal(value)) issues.push("red_flag");
  if (PRESCRIPTION_CHANGE.test(folded)) issues.push("prescription_change");
  if (unsafeTechnique(folded)) issues.push("unsafe_technique");
  if (LINK.test(value)) issues.push("link");
  if (MARKUP.test(value)) issues.push("unsupported_characters");
  return issues;
}
const SMALL = "\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten";
// A number that sets load, reps, sets or rounds ("5 extra sets", "two more").
const PRESCRIBED_NUMBER = word(
  "(?:\\d+(?:[.,]\\d+)?|" +
    NUMBER_ALTS +
    ")\\s*(?:x\\s*)?(?:(?:more|extra|additional)\\s+)?(?:kg|kgs|kilos?|kilograms?|lbs?|pounds?|reps?|repetitions?|sets?|rounds?|times|laps?|more|extra)|(?:sets?|reps?|rounds?)\\s+of\\s+(?:\\d|" +
    NUMBER_ALTS +
    ")",
);
// Tempo and timing are part of the trainer's cue ("three seconds down", "3-1-1").
const TEMPO_OR_TIME = word(
  "(?:" + SMALL + ")(?:\\s*(?:-|to)\\s*(?:" + SMALL + "))?\\s*(?:seconds?|secs?|counts?|beats?)|(?:a\\s+)?count\\s+(?:of\\s+)?(?:" + SMALL + ")|\\d(?:\\s*-\\s*\\d){2,3}",
  "giu",
);
/**
 * The trainer's exercise cue from the plan. It is spoken verbatim, so it gets
 * the same red-flag, medical, prescription and technique checks as any spoken
 * line; numbers are allowed only as tempo or timing ("three seconds down",
 * "3-1-1"), never next to load, reps, sets or rounds.
 */
export function cueIssues(text: string): PhraseIssue[] {
  const value = String(text ?? "").trim();
  if (!value) return ["empty"];
  const folded = screeningText(value);
  const issues: PhraseIssue[] = [];
  if (value.length > 400) issues.push("too_long");
  if (PRESCRIBED_NUMBER.test(folded) || PRESCRIPTION_CHANGE.test(folded))
    issues.push("prescription_change");
  else if (/\p{Nd}/u.test(folded.replace(TEMPO_OR_TIME, " "))) issues.push("number");
  if (MEDICAL.test(folded)) issues.push("medical");
  if (safetySignal(value)) issues.push("red_flag");
  if (unsafeTechnique(folded)) issues.push("unsafe_technique");
  if (LINK.test(value)) issues.push("link");
  if (MARKUP.test(value)) issues.push("unsupported_characters");
  return issues;
}

// ---------------------------------------------------------------------------
// Member-visible model text (Brain plans, evaluation answers, compiled rules).
// ---------------------------------------------------------------------------
/** A claim that the trainer approved the text, or an instruction to skip review. */
export const APPROVAL = word(
  "pre-?approved|(?:trainer|coach)[\\s-]+(?:approved|verified|signed[\\s-]+off)|(?:approved|reviewed|checked|signed\\s+off|verified)\\s+by\\s+(?:the\\s+|your\\s+)?(?:trainer|coach)|auto[\\s-]?publish\\p{L}*|publish(?:ed)?\\s+without\\s+(?:a\\s+|any\\s+)?review|(?:skip|skips|skipped|bypass\\p{L}*|without)\\s+(?:the\\s+|your\\s+)?(?:trainer|coach)(?:'s)?\\s+review|(?:switched|turned|switch|turn)\\s+off\\s+(?:the\\s+|your\\s+)?(?:trainer|coach)(?:'s)?\\s+review|ignore\\s+(?:all\\s+|any\\s+|the\\s+)?(?:previous|prior|above|earlier)|(?:system|developer)\\s+(?:prompt|message|instructions?)|must\\s+be\\s+sent\\s+immediately",
);
/** A guaranteed result, or telling the member not to involve their coach. */
export const GUARANTEE = word(
  "100\\s*%|guarantee\\p{L}*|no\\s+need\\s+to\\s+(?:check|ask|tell|consult|involve)|(?:do\\s+not|don't|dont|never)\\s+(?:need\\s+to\\s+)?(?:check|ask|tell|consult|involve)\\s+(?:with\\s+)?(?:your\\s+|the\\s+)?(?:coach|trainer)|(?:i\\s+am|i'm)\\s+(?:completely\\s+|absolutely\\s+)?(?:certain|sure)|definitely\\s+will|cannot\\s+fail|can't\\s+fail",
);
/**
 * Advice only a clinician gives: medicines, doses, diagnoses and treatment.
 * Narrower than MEDICAL, so a safe referral ("stop and seek medical help",
 * "see a doctor") in an escalation or a safety rule still passes.
 */
export const MEDICAL_ADVICE = word(
  "diagnos\\p{L}*|medicines?|medications?|doses?|dosage|ibuprofen|paracetamol|acetaminophen|aspirin|painkillers?|pills?|supplements?|anti-?inflammator\\p{L}*|salbutamol|inhalers?|puffs?|milligrams?|\\d+\\s*mg|injections?|cures?|push\\s+through|through\\s+the\\s+(?:pain|discomfort)|ignore\\s+(?:the\\s+|your\\s+|any\\s+)?(?:pain|ache|symptoms?|dizz\\p{L}*|chest)|no\\s+pain\\s*,?\\s*no\\s+gain|tough\\s+it\\s+out|shake\\s+it\\s+off|(?:is|are)\\s+(?:usually|probably|likely|just)\\s+(?:exercise-?induced\\s+)?(?:asthma|tendin\\p{L}*|arthrit\\p{L}*|a\\s+strain|nothing|normal)",
);
const ISO_DATE = /\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g;
/** A phone number: nine or more digits in one run of digits, spaces, dots, dashes and brackets. */
export function hasContactNumber(text: string) {
  const value = String(text ?? "").replace(ISO_DATE, " ");
  for (const m of value.matchAll(/\+?\(?\d[\d\s().-]{7,}\d/g))
    if ((m[0].match(/\d/g) ?? []).length >= 9) return true;
  return false;
}
export type ProseIssue = "link" | "medical" | "approval_claim" | "contact" | "guarantee";
/**
 * Screens model prose a member would read (a plan's title, summary, week
 * focus or session label). Red-flag terms are not screened here: "stop and
 * message your coach for sharp joint pain" is a safe instruction.
 */
export function proseIssues(text: string, medical: RegExp = MEMBER_MEDICAL): ProseIssue[] {
  const value = String(text ?? "");
  const folded = screeningText(value);
  const issues: ProseIssue[] = [];
  if (LINK.test(value)) issues.push("link");
  if (medical.test(folded)) issues.push("medical");
  if (APPROVAL.test(folded)) issues.push("approval_claim");
  if (hasContactNumber(value)) issues.push("contact");
  if (GUARANTEE.test(folded)) issues.push("guarantee");
  return issues;
}
/**
 * Screens a model-written exercise cue a member would read or hear: the
 * spoken-cue checks (numbers only as tempo or timing are not flagged here,
 * the voice session drops those itself) plus approval claims, contact details
 * and guarantees.
 */
export function modelCueIssues(text: string): Array<PhraseIssue | ProseIssue> {
  const value = String(text ?? "").trim();
  if (!value) return [];
  const issues: Array<PhraseIssue | ProseIssue> = cueIssues(value).filter((i) => i !== "number");
  for (const i of proseIssues(value)) if (!issues.includes(i)) issues.push(i);
  return issues;
}
const STOPS = word("stop\\p{L}*|end|ends|pause\\p{L}*|halt\\p{L}*|rest\\s+and\\s+(?:message|contact|tell|call)");
const CONTACTS = word("coach\\p{L}*|trainer\\p{L}*|medical|doctor|emergency|help|ambulance|999|911|112|998");
export type RuleFlag = "medical_advice" | "red_flag_not_stopped" | "link" | "contact" | "approval_claim" | "guarantee";
/**
 * Warnings for a model-compiled draft rule, shown to the trainer before they
 * confirm it: medicine, dose or diagnosis advice, a red-flag condition (chest
 * pain, dizziness...) whose directive does not stop the session and send the
 * member to their coach or to help, and links, contact details, approval
 * claims or guarantees. `redFlag` adds the workspace's own safety terms.
 */
export function compiledRuleFlags(
  rule: { title: string; condition: string; directive: string },
  redFlag: (text: string) => boolean = safetySignal,
): RuleFlag[] {
  const flags: RuleFlag[] = [];
  const directive = screeningText(rule.directive);
  if (MEDICAL_ADVICE.test(directive)) flags.push("medical_advice");
  const trigger = `${rule.title}. ${rule.condition}. ${rule.directive}`;
  if (
    (safetySignal(trigger) || redFlag(trigger)) &&
    !(STOPS.test(directive) && CONTACTS.test(directive))
  )
    flags.push("red_flag_not_stopped");
  for (const i of proseIssues(`${rule.title}. ${rule.condition}. ${rule.directive}`, MEDICAL_ADVICE))
    if (i !== "medical" && !flags.includes(i)) flags.push(i);
  return flags;
}

const NUMBER_VALUES: Record<string, string> = {
  zero: "0", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", forty: "40",
  fifty: "50", sixty: "60", ninety: "90", hundred: "100", half: "0.5", twice: "x2", double: "x2",
  triple: "x3", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8",
  ninth: "9", tenth: "10", eleventh: "11", twelfth: "12",
};
/**
 * The numbers a text states: digits, and number words other than "one"
 * (too often not a quantity), normalised so "three" and "3" match.
 */
export function statedNumbers(text: string) {
  const folded = screeningText(String(text ?? ""));
  const out = new Set<string>();
  for (const m of folded.matchAll(/\d+(?:[.,]\d+)?/g)) out.add(String(Number(m[0].replace(",", "."))));
  for (const m of folded.matchAll(/\p{L}+/gu)) if (NUMBER_VALUES[m[0]]) out.add(NUMBER_VALUES[m[0]]);
  return out;
}
/** Numbers in `text` that its source (a cited rule) never states. */
export const numbersNotIn = (text: string, source: string) => {
  const allowed = statedNumbers(source);
  return [...statedNumbers(text)].filter((n) => !allowed.has(n));
};
