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
export const NUMBER_WORDS = word(NUMBER_ALTS);
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
/** Anything with a `test(text)` method: a RegExp or a screen built from several. */
export type TextTest = { test(text: string): boolean };
/** Clinician-only terms: medicines, doses, diagnoses, treatment, training through symptoms. */
const MEDICAL_ADVICE_TERMS = word(
  "diagnos\\p{L}*|medicines?|medications?|doses?|dosage|ibuprofen|paracetamol|acetaminophen|aspirin|painkillers?|pills?|supplements?|anti-?inflammator\\p{L}*|salbutamol|inhalers?|puffs?|milligrams?|\\d+\\s*mg|injections?|cures?|through\\s+the\\s+(?:pain|discomfort)|ignore\\s+(?:the\\s+|your\\s+|any\\s+)?(?:pain|ache|symptoms?|dizz\\p{L}*|chest)|no\\s+pain\\s*,?\\s*no\\s+gain|tough\\s+it\\s+out|shake\\s+it\\s+off|(?:is|are|s|re)\\s+(?:(?:most\\s+)?(?:usually|probably|likely|just)\\s+){1,2}(?:exercise-?induced\\s+)?(?:asthma|tendin\\p{L}*|arthrit\\p{L}*|a\\s+strain|nothing|normal)",
);
// "is" may be written "'s" or "'re" ("it's just a strain") and may carry two
// hedges ("it is probably just a strain"): with a declined diagnosis removed
// ("I won't diagnose you, but it's just a strain") the claim is the advice.
/**
 * "Push through" is a technique cue ("push through the whole foot", "push
 * through your heels") unless its sentence is about pain or a symptom ("push
 * through the pain", "if it hurts, push through it").
 */
const PUSH_THROUGH = word("push(?:es|ing)?\\s+through");
/**
 * A technique target: "push through the whole foot", "push through your
 * heels", "push through the floor". Any other push-through ("push through
 * it", "push through") reads the pain named in another sentence or in the
 * request it answers ("Knee pain? Push through it.").
 */
const TECHNIQUE_PUSH = word(
  "push(?:es|ing)?\\s+through\\s+(?:the\\s+|your\\s+|both\\s+|each\\s+)?(?:(?:whole|entire|full|flat|front|back|middle|balls?|heels?)(?:\\s+of)?\\s+(?:the\\s+|your\\s+)?)?(?:foot|feet|heels?|toes?|mid-?\\s*foot|fore-?\\s*foot|floor|ground|platform|pedals?|legs?|hips?|glutes?|palms?|hands?|arms?|elbows?|bar|handles?)",
  "giu",
);
const PAIN_CONTEXT = word(
  "pain\\p{L}*|discomfort|hurts?|hurting|aches?|aching|sore\\p{L}*|injur\\p{L}*|twinges?|niggles?|sharp|symptoms?|dizz\\p{L}*|numb\\p{L}*|tingl\\p{L}*|swell\\p{L}*|swollen",
);
/**
 * Wording that names a clinician-only topic only to decline it or to say it
 * is absent: "I made no diagnosis", "I can't advise on supplements or
 * medication", "supplements are outside what I can advise on", "no diagnosis
 * was given", "never give supplement advice", "don't push through the pain",
 * "never ignore chest pain". Only
 * the generic topic words are covered, so a named medicine ("I can't advise
 * on ibuprofen") and everything else in the sentence are still screened.
 */
const TOPIC = "(?:diagnos\\p{L}*|medicines?|medications?|doses?|dosage|supplements?|painkillers?|pills?|injections?)";
// A list of topics ends with "or" or "and" ("supplements, medication or
// pills"); a bare comma does not continue it, so "I can't advise on
// medication, painkillers will help" declines only "medication".
const TOPIC_ITEM = `(?:any\\s+|a\\s+|other\\s+)?${TOPIC}`;
const TOPICS = `(?:medical\\s+)?${TOPIC}(?:(?:\\s*(?:,|/)\\s*${TOPIC_ITEM})*\\s*(?:,|/)?\\s*(?:\\bor\\b|\\band\\b|/)\\s*${TOPIC_ITEM})?(?:\\s+(?:advice|questions?))?`;
// A declined topic that ends its clause. When the next word is a verb the
// last topic starts a new clause ("I can't recommend supplements and
// painkillers are your best bet"), so the list stops before it.
const CLAUSE_VERB =
  "(?:is|are|was|were|will|would|can|could|should|may|might|must|do|does|did|help\\p{L}*|work\\p{L}*|make|makes|fix\\p{L}*|sort\\p{L}*|eas\\p{L}*|reduc\\p{L}*|reliev\\p{L}*|improv\\p{L}*|keep\\p{L}*|stop\\p{L}*|prevent\\p{L}*|speed\\p{L}*|boost\\p{L}*|aid\\p{L}*|take\\p{L}*|need\\p{L}*|seem\\p{L}*|sound\\p{L}*|tend\\p{L}*|usually|often|always|really|also|definitely|probably|generally|normally)(?![\\p{L}\\p{N}])";
const TOPICS_END = `${TOPICS}(?!\\s+${CLAUSE_VERB})`;
// The subject may be carried over: "I made no diagnosis and can't advise on supplements".
const CANNOT =
  "(?:(?:i|we)(?:\\s+am|'m|\\s+are|'re)?|and)\\s+(?:can't|cannot|can\\s+not|won't|will\\s+not|not\\s+able\\s+to|unable\\s+to|not\\s+allowed\\s+to|not\\s+qualified\\s+to|not\\s+in\\s+a\\s+position\\s+to)";
const DECLINE_VERB = "(?:advise|comment|speak|help|recommend|suggest|prescribe|give|offer|provide|make)";
const NEGATED = "(?:don't|dont|do\\s+not|never|shouldn't|should\\s+not|no\\s+need\\s+to)";
const DISCLAIMER = new RegExp(
  B +
    "(?:" +
    // "I made no diagnosis", "we gave no supplement advice"
    `(?:i|we)(?:\\s+have|'ve)?\\s+(?:made|make|gave|give|given|offered|offer)\\s+no\\s+${TOPICS_END}` +
    // "I can't advise on supplements", "I won't diagnose", "I'm unable to give you medication advice"
    `|${CANNOT}\\s+(?:${TOPICS_END}|${DECLINE_VERB}(?:\\s+(?:on|about|regarding|with|for|you|any|a|an|the|your|specific|medical|advice|guidance))*\\s+${TOPICS_END})` +
    // "Supplements are outside what I can advise on", "medication questions are beyond my role"
    `|${TOPICS}\\s+(?:is|are)\\s+(?:outside|beyond)\\s+(?:what\\s+(?:i|we)\\s+can|my\\s+(?:scope|role|remit)|our\\s+(?:scope|role|remit))` +
    // "No diagnosis or medication advice was given"
    `|no\\s+${TOPICS}(?:\\s+(?:was|were|has\\s+been|have\\s+been|is|are))?\\s+(?:made|given|offered|included|provided)` +
    // "This is not a diagnosis"
    "|(?:this|that|it)(?:\\s+is\\s+not|\\s+isn't|'s\\s+not)\\s+(?:a\\s+)?diagnos\\p{L}*" +
    // A rule against advice: "Never give supplement or medication advice"
    `|${NEGATED}\\s+(?:give|offer|provide|recommend|suggest|prescribe)(?:\\s+(?:any|a|an|the|you|your|specific))*\\s+${TOPICS_END}` +
    // "Don't push through the pain", "never ignore chest pain"
    `|${NEGATED}\\s+(?:(?:just|try\\s+to|ever|simply)\\s+)?(?:push(?:es|ing)?\\s+through(?:\\s+(?:it|this|that|(?:the|your|any)\\s+(?:pain|discomfort|ache)))?|(?:train|work|keep\\s+going|carry\\s+on)\\s+through\\s+the\\s+(?:pain|discomfort)|ignore\\s+(?:the\\s+|your\\s+|any\\s+)?(?:pain|ache|symptoms?|dizz\\p{L}*|chest(?:\\s+pain)?))` +
    ")" +
    E,
  "giu",
);
/**
 * Advice only a clinician gives: medicines, doses, diagnoses and treatment,
 * or training through pain. Narrower than MEDICAL, so a safe referral ("stop
 * and seek medical help", "see a doctor") in an escalation or a safety rule
 * still passes, and so do a technique cue ("push through the whole foot") and
 * a declined topic ("I made no diagnosis", "I can't advise on supplements").
 * Screened sentence by sentence: anything else in a sentence that declines a
 * topic is still screened. `context` is what the text answers (the request,
 * or a rule's title and condition): a push-through with no technique target
 * fails when pain is named there or elsewhere in the text.
 */
export function givesMedicalAdvice(text: string, context = "") {
  const folded = screeningText(String(text ?? ""));
  // Pain named anywhere in the text or in what it answers (the member's
  // request, a rule's condition) is what a push-through without a technique
  // target refers to: "Knee pain? Push through it."
  const painNamed = PAIN_CONTEXT.test(folded) || PAIN_CONTEXT.test(screeningText(String(context ?? "")));
  for (const sentence of folded.split(/[.!?;:\n]+/)) {
    const rest = sentence.replace(DISCLAIMER, " ");
    if (MEDICAL_ADVICE_TERMS.test(rest)) return true;
    if (!PUSH_THROUGH.test(rest)) continue;
    if (PAIN_CONTEXT.test(sentence)) return true;
    if (painNamed && PUSH_THROUGH.test(rest.replace(TECHNIQUE_PUSH, " "))) return true;
  }
  return false;
}
export const MEDICAL_ADVICE: TextTest = { test: givesMedicalAdvice };
const ISO_DATE = /\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g;
/**
 * A record identifier (UUID) in model text, typically a rule id decoded from a
 * short reference. Its digit runs are not a phone number. At least one hex
 * letter is required, so a digits-only string in UUID shape is still screened.
 */
const UUID = /(?<![\p{L}\p{N}-])(?=[0-9a-f-]*[a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\p{L}\p{N}-])/giu;
/** A phone number: nine or more digits in one run of digits, spaces, dots, dashes and brackets. */
export function hasContactNumber(text: string) {
  const value = String(text ?? "").replace(ISO_DATE, " ").replace(UUID, " ");
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
export function proseIssues(text: string, medical: TextTest = MEMBER_MEDICAL): ProseIssue[] {
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
 * The medical screen for a model-written cue: the sentence-level
 * givesMedicalAdvice (medicines, doses, diagnoses, training through pain),
 * plus the spoken-line term list for everything else a cue must not say
 * (symptoms, treatment, clinicians, "ice it", "keep going if it clicks"),
 * read with technique push-throughs removed. So "Push through the whole
 * foot" passes, while "push through the pain" and "if it hurts, push through
 * it" still fail.
 */
const CUE_MEDICAL: TextTest = {
  test: (text: string) =>
    givesMedicalAdvice(text) ||
    MEDICAL.test(screeningText(String(text ?? "")).replace(TECHNIQUE_PUSH, " ")),
};
/**
 * Screens a model-written exercise cue a member would read or hear: the
 * spoken-cue checks (numbers only as tempo or timing are not flagged here,
 * the voice session drops those itself) with the medical screen above, plus
 * approval claims, contact details and guarantees.
 */
export function modelCueIssues(text: string): Array<PhraseIssue | ProseIssue> {
  const value = String(text ?? "").trim();
  if (!value) return [];
  const issues: Array<PhraseIssue | ProseIssue> = cueIssues(value).filter(
    (i) => i !== "number" && i !== "medical",
  );
  // In the place cueIssues lists it: after the length and prescription issues.
  if (CUE_MEDICAL.test(value))
    issues.splice(issues.filter((i) => i === "too_long" || i === "prescription_change").length, 0, "medical");
  for (const i of proseIssues(value, CUE_MEDICAL)) if (!issues.includes(i)) issues.push(i);
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
  // The condition says when the directive applies: "Knee pain during squats"
  // and "Push through it" is training through pain.
  if (givesMedicalAdvice(directive, `${rule.title}. ${rule.condition}`)) flags.push("medical_advice");
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
/** Units a number may carry, by the word written after it (or before it: "RIR 2", "week 3"). */
const UNIT_WORDS: Record<string, string> = Object.fromEntries(
  (
    [
      ["kg", "kg kgs kilo kilos kilogram kilograms kilogramme kilogrammes"],
      ["lb", "lb lbs pound pounds"],
      ["%", "% percent pct cent"],
      ["week", "week weeks wk wks"],
      ["day", "day days"],
      ["session", "session sessions workout workouts"],
      ["rep", "rep reps repetition repetitions"],
      ["set", "set sets"],
      ["round", "round rounds"],
      ["min", "min mins minute minutes"],
      ["s", "s sec secs second seconds"],
      ["h", "h hr hrs hour hours"],
      ["km", "km kilometre kilometres kilometer kilometers"],
      ["m", "m metre metres meter meters"],
      ["kcal", "kcal cal calorie calories"],
      ["g", "g gram grams"],
      ["rir", "rir"],
      ["rpe", "rpe"],
    ] as const
  ).flatMap(([unit, words]) => words.split(" ").map((w) => [w, unit])),
);
const UNIT_BEFORE = new Set(["rir", "rpe", "week", "day", "session", "set", "round"]);
/** Words that may stand between a number and its unit: "7 more weeks", "5 per cent". */
const UNIT_FILLER = new Set(["more", "extra", "additional", "further", "fewer", "less", "other", "full", "whole", "total", "per", "working"]);
/**
 * The numbers a text states (as statedNumbers reads them) with the unit each
 * carries: the unit word after it, past at most two filler words, else a
 * unit written before it ("RIR 2"); "" when none is written.
 */
function statedQuantities(text: string) {
  const tokens = [...screeningText(String(text ?? "")).matchAll(/\d+(?:[.,]\d+)?|%|\p{L}+/gu)].map((m) => m[0]);
  const out: Array<{ value: string; unit: string }> = [];
  tokens.forEach((token, i) => {
    const value = /^\d/.test(token) ? String(Number(token.replace(",", "."))) : NUMBER_VALUES[token];
    if (value === undefined) return;
    let unit = "";
    for (let j = i + 1; j < tokens.length && j <= i + 3; j++) {
      const w = tokens[j]!;
      if (UNIT_WORDS[w] && !(w === "cent" && tokens[j - 1] !== "per")) {
        unit = UNIT_WORDS[w]!;
        break;
      }
      if (!UNIT_FILLER.has(w)) break;
    }
    if (!unit && i > 0 && UNIT_BEFORE.has(UNIT_WORDS[tokens[i - 1]!] ?? "")) unit = UNIT_WORDS[tokens[i - 1]!]!;
    out.push({ value, unit });
  });
  return out;
}
/**
 * Numbers in `text` that are not grounded in its source (the cited rules) or
 * the request it answers: stated in either, or a simple result of one request
 * number and one rule number in the same unit (their sum or difference), or
 * the request number stepped up or down by a rule percentage of at most 50%.
 * "100 kg" and a 2.5 kg rule allow 102.5 kg and 97.5 kg; "80 kg" and a 5% rule
 * allow 84 kg and 76 kg; "five weeks" and a 12-week rule allow 7 weeks. A
 * result must carry the unit it was worked out in, so "100 kg" and "RIR 2"
 * never allow "102 kg", and "four sets" and "RIR 2" never allow "six sets".
 * A number doubled ("six sessions" for three) is not a simple result, and any
 * other new number is returned.
 */
export function numbersNotGrounded(text: string, source: string, request: string) {
  const key = (n: number) => String(Math.round(n * 1000) / 1000);
  const allowed = new Set([...statedNumbers(source), ...statedNumbers(request)]);
  const results = new Set<string>();
  for (const r of statedQuantities(request))
    for (const q of statedQuantities(source)) {
      const a = Number(r.value),
        b = Number(q.value);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const found: number[] = [];
      if (r.unit && r.unit === q.unit) {
        found.push(a - b, b - a);
        if (a !== b) found.push(a + b);
      }
      if (q.unit === "%" && r.unit !== "%" && b > 0 && b <= 50) found.push(a * (1 + b / 100), a * (1 - b / 100));
      for (const v of found) if (v > 0) results.add(key(v) + "|" + r.unit);
    }
  const missing = new Set<string>();
  for (const t of statedQuantities(text))
    if (!allowed.has(t.value) && !allowed.has(key(Number(t.value))) && !results.has(key(Number(t.value)) + "|" + t.unit))
      missing.add(t.value);
  return [...missing];
}
