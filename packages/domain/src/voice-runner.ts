// The hands-free session runner as a pure state machine, and the spoken-reply
// parser. The web component only plays what `step` asks for, runs the clock and
// performs the effects (log a set through the device queue, report pain, finish).
// Browser-safe: no Node APIs.
import { safetySignal, screeningText } from "./index.ts";
import {
  formatLoad,
  numberClipKeys,
  reducedLoad,
  spokenWork,
  timedExercise,
  type ScriptLine,
  type SessionScript,
  type VoiceAdjustmentRules,
} from "./voice-session.ts";
import { formatDistance, formatDuration, workMeasure } from "./prescription.ts";

// ---------------------------------------------------------------------------
// Spoken replies (English, Modern Standard Arabic and Gulf Arabic).
// ---------------------------------------------------------------------------
export type VoiceCommand =
  | { type: "done" }
  /**
   * A rep count; `heavy` when the same reply also said it was too heavy.
   * `typed` when the member entered it on the screen: a heard count that is
   * implausible for the set is asked again (`plausibleReps`), a typed one is not.
   */
  | { type: "reps"; reps: number; heavy?: boolean; typed?: boolean }
  | { type: "too_heavy" }
  | { type: "too_easy" }
  | { type: "pause" }
  | { type: "resume" }
  /** A plain acknowledgement ("okay", "yes"): never completes, skips or resumes anything. */
  | { type: "ack" }
  | { type: "skip" }
  | { type: "repeat" }
  /**
   * The member says a set was not done ("I didn't do the last one", "لم أكمل
   * المجموعة الأخيرة", "ما سويتها"). Nothing is logged and nothing moves on:
   * it is noted for the trainer. `previous` when the reply points back to an
   * earlier set; `heavy` when it also said the weight was too heavy.
   */
  | { type: "not_done"; previous?: boolean; heavy?: boolean }
  | { type: "pain"; transcript: string }
  | { type: "unknown" };

const B = "(?:^|[^\\p{L}\\p{N}])",
  E = "(?![\\p{L}\\p{N}])";
const has = (alternatives: string) => new RegExp(B + "(?:" + alternatives + ")" + E, "iu");
/** A test (`has`) and a replace-all pattern for the same words. */
const hasAndEvery = (alternatives: string) =>
  [has(alternatives), new RegExp(B + "(?:" + alternatives + ")" + E, "giu")] as const;
// Replies are matched after `screeningText` folding: Arabic hamza, madda, ta
// marbuta (ة -> ه), alef maqsura (ى -> ي) and diacritics are written one way.
//
// Reported discomfort beyond the code floor's red flags. Pain, hurt, injury,
// dizziness and fainting (with routine negations such as "no pain") are read
// by `safetySignal`, in English and Arabic. This list only ever adds stops:
// when a reply might mean the member is unwell, the session stops and the
// trainer is told.
const PAIN = has(
  "ouch|ow|twinge|tweaked|cramp\\p{L}*|feel(?:ing)?\\s+sick|nause\\p{L}*|something\\s+(?:is\\s+)?wrong|" +
    "throw(?:ing)?\\s+up|vomit\\p{L}*|puk(?:e|ing)|chest\\s+(?:feels?\\s+|is\\s+)?tight|feel(?:ing)?\\s+unwell|" +
    "(?:i'?m|i\\s+am|i\\s+feel|feeling)\\s+not\\s+(?:okay|ok|alright|all\\s+right|well|good|right)|" +
    "(?:don'?t|do\\s+not)\\s+feel\\s+(?:okay|ok|well|good|right)|not\\s+feeling\\s+(?:okay|ok|well|good|right)|" +
    // Arabic: dizziness (MSA), nausea, vomiting, cramp or spasm, "something is
    // wrong", and "I am not well" in the first person.
    "[وب]?(?:ال)?ب?دوار|[وب]?(?:ال)?غثيان|(?:ب|راح\\s*)?[ا]?ستفرغ\\p{L}*|[ا]?تقيا\\p{L}*|ترجيع|شد\\s*عضلي|[وب]?(?:ال)?تشنج\\p{L}*|" +
    "(?:في|فيه)?\\s*شي(?:ء)?\\s*(?:غلط|خطا)|" +
    "(?:انا\\s*(?:مو|مب|مش)|لست|ماني|مانيب)\\s*(?:بخير|زين|زينه|كويس|كويسه|تمام)|(?:مو|مب|مش)\\s*بخير|" +
    "(?:احس|حاس|حاسس|حاسه|اشعر)\\s*(?:اني|انني|بنفسي)?\\s*(?:مو|مب|مش|لست|غير|ماني)\\s*(?:بخير|زين|زينه|كويس|كويسه|تمام)",
);
// Gulf pain words as OpenAI's transcribers write them in Latin letters: in
// the retest (29 September 2026) "My back يعورني" came back from every OpenAI
// model as "My back yawrni" / "yaourni" / "yaurni" / "iauurni" and never
// stopped the session. Gulf "تعبان" ("worn out", also "unwell") stops only in
// an unwell phrase: with an intensifier ("تعبان مرة / وايد / حيل", "مرة
// تعبان"), after "I feel" ("حاس اني تعبان", "أحس إني تعبان") or after a
// joint, the back, chest or head ("ركبتي تعبانة", "ظهري تعبان"). Bare
// "تعبان" is "tired" in the gym ("خلصت بس تعبان", "تعبان شوي", "والله
// تعبان"), like English "tired", which is not a stop either: the member
// hears the help line, which names pain (trainer decision pending, see
// docs/features/voice-session.md). "مريض" after "I (feel)" and "مرضان"
// ("sick") stop. Latin "alam" (ألم) stops only as the whole reply or with a
// pain context ("3indi alam", "alam fi rukbati", "my back alam"); it is also
// a surname ("Thanks Alam"). None after a negation, also with an intensifier
// between ("مو تعبان", "مو وايد تعبان", "ma yawrni", "ما احس اني تعبان").
const UNWELL_INTENSE_AR = "مره|مرره|وايد|واجد|حيل|كثير|جدا|بقوه",
  UNWELL_INTENSE_LATIN = "marr?ah?|wa+y(?:e|i)d|wa+jid|7eil|heil|jidd?an|jedd?an|kthee?r|ktee?r|kathee?r";
const TA3BAN = "ta(?:3|')?a?ba+n(?:a|ah|eh|ha)?";
const UNWELL = new RegExp(
  "(?<!(?:مو|مب|مش|ما|ماني|مانيب|لست|غير|ليس|not|no|never|ma|mu|mo|mob|mub|mb|mish|mesh|mani)\\s+(?:(?:" +
    UNWELL_INTENSE_AR + "|" + UNWELL_INTENSE_LATIN + "|so|very|that|really|too)\\s+)?)" +
    "(?<![\\p{L}\\p{N}'])(?:" +
    // تعبان in an unwell phrase.
    "تعبان(?:ه)?\\s+(?:" + UNWELL_INTENSE_AR + "|مو\\s+طبيعي)|(?:" + UNWELL_INTENSE_AR + ")\\s+تعبان(?:ه)?|" +
    "(?:احس|حاس|حاسه|حاسس|اشعر|شاعر|شاعره)\\s+(?:(?:اني|انني|بنفسي|نفسي|اني\\s+شوي|شوي)\\s+)?(?:تعبان|مريض|مرضان)(?:ه)?|" +
    "[وب]?(?:ال)?(?:ركب|ظهر|ضهر|كتف|رقب|صدر|راس|كاحل|ورك|معصم|كوع|مفصل|قلب)\\p{L}*\\s+(?:شوي\\s+)?تعبان(?:ه)?|" +
    "(?:انا|اني|صرت|صاير|صايره)\\s+(?:شوي\\s+)?(?:مريض|مريضه)|مرضان|مرضانه|" +
    TA3BAN + "\\s+(?:" + UNWELL_INTENSE_LATIN + ")|(?:" + UNWELL_INTENSE_LATIN + ")\\s+" + TA3BAN + "|" +
    "(?:a7(?:e|i)?s|ah(?:e|i)s|7as+|has+|7as+es|has+es)\\s+(?:(?:inn?(?:i|y)|enn?i)\\s+)?" + TA3BAN + "|" +
    // يعورني / عورني / يوجعني
    "y(?:a|e)?(?:3|')?(?:a|o|u|w)+(?:e|i)?r{1,2}(?:e|i)?n(?:i|e|y|ee)|i(?:a|e)(?:a|o|u|w)+r{1,2}n(?:i|e|y)|ya(?:o|u|w)+(?:ri|ni)|" +
    "3?aw+a?r+n(?:i|y)|(?:y|i|t)?(?:o|u|w)+ja3?n(?:i|y|ee)|" +
    // alam (ألم) with a pain context.
    "(?:(?:3|')?(?:i|e|a)ndi|f(?:i|ee)ni|a7(?:e|i)?s|ah(?:e|i)s|7as+|has+|back|knee|shoulder|chest|neck|hip|ankle|wrist|elbow|leg|arm|head|foot|" +
    "(?:dh|th|z)ahri|ruk(?:b|u)ati|ki?tfi|chitfi|sadri|ra'?si)[\\s,.]+b?alam|" +
    "alam\\s+(?:fi|fe|fee|in|b|bi|bil|shad(?:ee|i)d|qawi|gawi|kbee?r|ka?bee?r|ra?hee?b|ya?zeed)" +
    ")(?![\\p{L}\\p{N}])|" +
    "^\\s*(?:(?:ah+|oh+|ya|aa+h)\\s+)?alam(?:\\s+alam)?[\\s.!?,]*$",
  "iu",
);
const EFFORT_HEAVY = "heavy|hard|much|ثقيل|ثقيله|تقيل|تقيله|صعب|صعبه",
  EFFORT_EASY = "easy|light|سهل|سهله|خفيف|خفيفه";
const TOO_HEAVY = has(
  "too\\s+heavy|heavy|too\\s+hard|too\\s+much|can'?t\\s+(?:lift|do\\s+it|finish|manage)|cannot\\s+(?:lift|finish)|struggling|" +
    "ثقيل|ثقيله|تقيل|تقيله|صعب|صعبه|(?:ما|لا|مب|مو)\\s*(?:اقدر|استطيع|اقدرش)\\s*(?:ارفع|اشيل|احمل|اكمل)\\p{L}*",
);
const TOO_EASY = has("too\\s+(?:easy|light)|easy|light|سهل|سهله|خفيف|خفيفه");
// "Not heavy", "it's not too heavy", "wasn't that hard", "مو ثقيل وايد": negated
// effort words are removed before the too-heavy and too-easy checks.
const NEGATED_EFFORT = new RegExp(
  B +
    "(?:not|isn'?t|wasn'?t|never|مو|مش|ما|ليس|مب|غير)\\s+(?:(?:that|so|too|very|really|it'?s|it|is|was|feel|feels|felt|at\\s+all|هو|هي|وايد|واجد|جدا|كثير|مره|مرره|ذاك|هذا)\\s+){0,3}(?:" +
    EFFORT_HEAVY +
    "|" +
    EFFORT_EASY +
    ")" +
    E,
  "giu",
);
// "Next exercise" and "التمرين التالي" skip; a plain "next" or "التالي" is a
// request to carry on, in both languages.
const SKIP = has(
  "skip|next\\s+exercise|pass|move\\s+on|[نا]?تخطي\\p{L}*|[نا]?تجاوز\\p{L}*|طوف(?:ها|ه)?|التمرين\\s+التالي",
);
const PAUSE = has(
  "pause|wait|hold\\s+on|stop|break|one\\s+moment|hang\\s+on|توقف|وقف|انتظر|انتظري|لحظه|استني|استنا|اصبر|اصبري|مهلا",
);
// Asking to carry on. Never a set completion.
const RESUME = has(
  "resume|continue|carry\\s+on|go\\s+on|ready|start|let'?s\\s+go|go|next|" +
    "كمل|كملي|نكمل|استمر|جاهز|جاهزه|مستعد|مستعده|يلا|يالله|هيا|ابدا|نبدا|التالي",
);
const REPEAT = has(
  "repeat|again|say\\s+again|what|pardon|sorry|come\\s+again|(?:didn'?t|did\\s+not)\\s+(?:hear|catch|get)\\s+(?:you|that|it)|" +
    "اعد|اعيد|كرر|عيد|مره\\s+ثانيه|مره\\s+اخري|شنو|ايش|وش|وشو|شو|ماذا|ما\\s+التالي|(?:ما|لم)\\s*(?:سمعت|اسمع|فهمت|افهم)\\p{L}*",
);
// Gulf verbs as OpenAI's transcribers write them in Latin letters: "خلصت"
// (khalast), "كملت" (kammalt), "سويت" (sawwait, "I did", which ties a count
// to the set: "sawwait 12").
const KHALAST = "(?:kh|5|x)a?l+a?s+t",
  KAMMALT = "kam+alt",
  SAWWAIT = "saw+(?:ai|ei|ay|ey|ee|e|i)t";
// Only explicit completion words finish a set. "خلص" and "خلاص" alone are not
// one (trainer decision, 29 September 2026): "خلاص" is also "stop" or
// "enough", and a hurried "خلص" may be the start of anything; the member
// hears the help line and says "خلصت", "done" or a count.
const COMPLETE_WORDS =
  "done|finished|finish|complete|completed|that'?s\\s+it|that\\s+is\\s+it|did\\s+it|made\\s+it|nailed\\s+it|" +
  "تم|تمت|خلصنا|انتهيت|انتهينا|(?:خلصت|كملت|اكملت|انهيت|انجزت)(?:ها|ه)?|سويتها|سويته|" +
  "(?:" + KHALAST + "|" + KAMMALT + ")(?:ha|ah)?|(?:kh|5|x)a?l+a?s+na|" + SAWWAIT + "(?:ha|ah)";
const COMPLETE = has(COMPLETE_WORDS);
// Said with a hedge, a completion or a count is uncertain, and uncertain
// replies never log a set: "almost done", "about 8", "I think I'm done",
// "just about done", "basically done", "done-ish", "hopefully done",
// "تقريباً خلصت", "يعني خلصت", "شبه خلصت", "كدت أنتهي", "يمكن خلصت", "حوالي
// عشر", "باقي ثنتين". Modern Standard and Gulf, with or without diacritics
// (the text is folded first), and with the conjunction "و" or "ف" joined to
// the hedge as it is in running speech ("وتقريباً خلصت", "خلصت وباقي
// ثنتين", "فيمكن خلصت"). The reply is an acknowledgement instead: during a
// set the member is asked again ("say done when you finish, or tell me how
// many reps").
const HEDGE_NUMBER =
  "\\p{N}+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty";
const HEDGE_DONE = "(?:done|finished|there|through|complete|completed)";
// Not followed by sets: "باقي مجموعتين", "ضل لي ثلاث مجموعات" (sets left).
const NOT_SETS_AHEAD_AR =
  "(?!\\s+(?:(?:لي|لنا)\\s+)?(?:[\\p{L}\\p{N}]+\\s+)?(?:ال)?(?:مجموع|جول|تمرين|تمارين|سيت|ستات|سيتات)\\p{L}*)";
const HEDGE = has(
  "almost|nearly|approximately|roughly|more\\s+or\\s+less|sort\\s+of|sorta|kind\\s+of|kinda|maybe|perhaps|probably|possibly|" +
    "i\\s+think|i\\s+guess|i\\s+believe|i\\s+suppose|not\\s+sure|unsure|pretty\\s+much|mostly|partly|partially|half|halfway|" +
    // Synonyms of "almost done" and of a hope: "just about done", "close to
    // done", "all but done", "practically done", "done-ish" (read "done ish"),
    // "done I hope", "hopefully done", "should be done". A hope or "should be"
    // about the load is feedback, not a hedge ("the next set should be
    // lighter", "hopefully the next one is lighter").
    "practically|virtually|basically|essentially|technically|i\\s+reckon|ish|" +
    "(?:hopefully|i\\s+hope|should\\s+be|must\\s+be)\\s+(?:(?:i'?m|i\\s+am|that'?s|it'?s|we'?re|all|it\\s+is)\\s+)?(?:" + HEDGE_DONE + "|it|over|" + HEDGE_NUMBER + ")|" +
    "(?:hopefully|i\\s+hope(?:\\s+so)?)[\\s.!?,]*$|" +
    "as\\s+good\\s+as|all\\s+but|(?:just\\s+)?about\\s+" + HEDGE_DONE + "|close\\s+to\\s+" + HEDGE_DONE + "|" +
    "(?:about|around|like|close\\s+to|up\\s+to|over|under|at\\s+least)\\s+(?:" + HEDGE_NUMBER + ")|(?:" + HEDGE_NUMBER + ")\\s+or\\s+(?:so|more|less)|" +
    "ta(?:q|2|'|k)?r(?:i|ee)ban|ya(?:3|')?a?ni|" +
    "[وف]?(?:(?:بال)?تقريب\\p{L}*|يعني|شبه|[يتان]?كاد(?:ت|وا)?|كدت|كدنا|[او]?وشك\\p{L}*|شارف\\p{L}*|قربت|قربنا|" +
    "يمكن|ممكن|ربما|احتمال|اظن|اعتقد|اتوقع|حوالي|بحدود|نص|نصف|نصها|نصه|باقي" + NOT_SETS_AHEAD_AR + "|" +
    "(?:مو|مش|مب|لست|ماني|غير)\\s*متاكد\\p{L}*|ما\\s*ادري|مادري|مدري)",
);
// A negation said before a command word in the same clause (no punctuation
// between, a few words at most): "I never made it", "it wasn't done", "I
// didn't get it done", "not quite made it", "ما تم", "مو خلاص"; "I'm not
// ready", "I can't continue", "don't skip", "مو مستعد", "لست مستعدة", "ما ابي
// نكمل". Arabic "لا" and "لن" negate a verb ("لا تبدا", "لن أكمل"), never a
// past completion or a word like "جاهز" ("لا، خلصت" is "no, I finished").
const NEGATION_EN =
  "not|never|almost|nearly|no\\s+longer|nowhere\\s+near|far\\s+from|unable\\s+to|" +
  "isn'?t|aren'?t|wasn'?t|weren'?t|ain'?t|haven'?t|hasn'?t|hadn'?t|don'?t|doesn'?t|didn'?t|can'?t|couldn'?t|won'?t|" +
  "wouldn'?t|shouldn'?t|(?:do|does|did|can|will)\\s+not|cannot";
const NEGATION_FILLER_EN =
  "i|i'?m|am|we|we'?re|are|it|it'?s|is|was|that|this|the|set|one|really|quite|yet|fully|totally|completely|even|all|" +
  "actually|been|able|to|want|wanna|feel|feeling|think|gonna|going|be|like|just|sure|get|got|gotten|keep|any|more|anymore|so|for|close|with|through|them";
const NEGATION_AR = "ما|مو|مب|مش|لست|لسنا|ماني|مانيب|ليس|غير";
const NEGATION_FILLER_AR =
  "انا|اني|ني|نيب|بعد|للحين|لسا|لسه|الحين|ابي|ابغي|ابغا|ابا|اريد|نبي|نبغي|نريد|ودي|قادر|قادره|قادرين|اقدر|نقدر|" +
  "استطيع|نستطيع|راح|رح|هو|هي|كله|كلها|ابد|ابدا|يعني";
const negatedArabic = (negators: string, words: string) =>
  "(?:" + negators + ")\\s+(?:(?:" + NEGATION_FILLER_AR + ")\\s+){0,2}(?:" + words + ")";
const negation = (words: string) =>
  "(?:" + NEGATION_EN + ")\\s+(?:(?:" + NEGATION_FILLER_EN + ")\\s+){0,3}(?:" + words + ")|" +
  negatedArabic(NEGATION_AR, words);
// Transliterated Gulf negation before a transliterated verb: "ma khalast".
const LATIN_NEGATION = "ma|mu|mo|mob|mub|mb|mish|mesh|lam";
// "مو خلاص" (not finished) is a negated completion although "خلاص" alone is
// not a completion.
const [NEGATED_COMPLETE, NEGATED_COMPLETE_ALL] = hasAndEvery(negation(COMPLETE_WORDS + "|خلاص|خلص"));
// Carrying on or skipping, negated: the member is not ready, so the session
// pauses (it never moves on). Also "ready? no" and "هيا لا", said last.
const FLOW_VERBS_AR =
  "كمل|كملي|نكمل|اكمل|تكمل|استمر|نستمر|ابدا|نبدا|تبدا|تبدي|[نات]?تخطي\\p{L}*|[نات]?تجاوز\\p{L}*|ت?طوف\\p{L}*";
const FLOW_WORDS =
  "resume|continue|carry\\s+on|go\\s+on|keep\\s+going|ready|start|begin|proceed|let'?s\\s+go|go|next|skip|pass|move\\s+on|" +
  FLOW_VERBS_AR +
  "|جاهز|جاهزه|جاهزين|مستعد|مستعده|مستعدين|يلا|يالله|هيا";
const NEGATED_FLOW = has(negation(FLOW_WORDS) + "|" + negatedArabic("لا|لن", FLOW_VERBS_AR));
const FLOW_THEN_NO = new RegExp(
  B + "(?:" + FLOW_WORDS + ")" + E + "[\\s,.!?،؟]*(?:no|nope|nah|not\\s+yet|لا)[\\s.!?؟]*$",
  "iu",
);
// "Thank you" is polite, not a request, and it is also what the speech model
// returns for noise or a reply it could not read ("Thank you." for Arabic
// "ثمان تكرارات" read as English, live check): it never earns the help line.
const ACK = has(
  "yes|yeah|yep|yup|ok|okay|sure|alright|all\\s+right|got\\s+it|fine|right|thank\\s+you|thanks|" +
    "نعم|اوكي|اوك|تمام|طيب|زين|حاضر|ماشي|اكيد|ايوه|ايوا|ان\\s*شاء\\s*الله|انشالله|شكرا|مشكور|مشكوره|يعطيك\\s+العافيه",
);
// "Not okay", "not fine", "مو زين", "مب تمام": a negated acknowledgement is
// not one. It is removed before the acknowledgement check, so on its own it
// earns the help line, which names pain ("I'm not okay" and "انا مو تمام"
// already stop the session through PAIN).
const NEGATED_ACK = new RegExp(
  B +
    "(?:not|isn'?t|wasn'?t|ain'?t|مو|مب|مش|ما|ليس|لست|غير)\\s+(?:(?:so|very|really|that|too|all|feeling|هو|هي|وايد|واجد|جدا|مره|كثير)\\s+){0,2}" +
    "(?:okay|ok|fine|alright|all\\s+right|good|great|right|sure|زين|زينه|تمام|ماشي|كويس|كويسه|طيب|اوكي|اوك|بخير)" +
    E,
  "giu",
);
// A set that was not done, said in the past tense: "I didn't do the last one",
// "couldn't finish it", "I never made it", "I almost made it", "it wasn't
// done", "I missed that set", "I missed 3 reps", "لم أكمل", "لم أستطع
// إكمالها", "لم يتم", "ما قدرت", "ما سويتها", "ما خلصتها".
const NOT_DONE_WORDS =
  "(?:didn'?t|did\\s+not|couldn'?t|could\\s+not|wasn'?t\\s+able\\s+to|was\\s+not\\s+able\\s+to|failed\\s+to|never)\\s+(?:(?:really|even|actually|quite|fully|get\\s+to|manage\\s+to)\\s+)?(?:do|did|finish|complete|manage|make|made|nail|get\\s+through|get\\s+(?:it|them|that|this|all)\\s+(?:done|finished))\\p{L}*|" +
  "(?:almost|nearly|not\\s+quite)\\s+(?:made|did|nailed|managed)|" +
  "(?:wasn'?t|was\\s+not|weren'?t|were\\s+not)\\s+(?:(?:quite|really|fully|even|properly)\\s+)?(?:done|finished|complete|completed)|" +
  "(?:missed|skipped)\\s+(?:(?:the|that|this|my)\\s+)?(?:last|previous|final|one|set|it|round|rep|reps)|" +
  "(?:missed|skipped)\\s+(?:\\p{N}+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a\\s+couple|a\\s+few)(?:\\s+(?:of\\s+)?(?:them|reps?|repetitions?))?|" +
  "[وف]?لم\\s*(?:ا|ن)?(?:كمل|نه|نهي|قم|فعل|عمل|سو|سوي|خلص|نجز)\\p{L}*|[وف]?لم\\s*(?:يتم|تتم)|" +
  // Modern Standard "I could not (complete)": لم أستطع، لم أتمكن من، لم أقدر
  // على، ما استطعت. Gulf present "ما اقدر" stays a load complaint (TOO_HEAVY).
  "(?:[وف]?لم\\s*(?:استطع|اتمكن|اقدر|نستطع|نتمكن|نقدر)|[وف]?ما\\s*(?:استطعت|استطعنا|تمكنت|تمكنا))\\p{L}*(?:\\s*(?:من|علي))?(?:\\s*(?:اكمال|انهاء|اتمام|اداء|فعل|عمل)\\p{L}*)?|" +
  "[وف]?(?:ما|مب|مو)\\s*(?:قدرت|اقدرت|قدرنا)(?:\\s*(?:ا|ن)?(?:كمل|خلص|سوي|سو|نهي|رفع|شيل)\\p{L}*)?|" +
  "[وف]?(?:ما|مب)\\s*(?:سويت|سوينا)\\p{L}*|" +
  "[وف]?(?:ما|مب)\\s*(?:خلصت|كملت|انهيت|اكملت|انجزت)(?:ها|ه)|" +
  // "I almost finished it" (MSA "كدت"), like "I almost made it".
  "(?:كدت|كدنا)\\s*(?:ان\\s*)?(?:ا|ن)?(?:كمل|خلص|نهي|نته|نجز|تم|سوي)\\p{L}*|" +
  // Transliterated: "ma sawwaitha", "ma khalastha".
  "(?:ma|mob|mub|mb)\\s+(?:" + SAWWAIT + "\\p{L}*|(?:" + KHALAST + "|" + KAMMALT + ")(?:ha|ah))";
const [NOT_DONE, NOT_DONE_ALL] = hasAndEvery(NOT_DONE_WORDS);
// Still going, not a report: "not done yet", "I'm not finished", "almost
// there", "ما خلصت", "لسا ما خلصت", "لم أنته بعد". The completion word in it
// never logs a set.
const NOT_YET_WORDS =
  "(?:not|isn'?t|i'?m\\s+not|am\\s+not)\\s+(?:(?:quite|yet|really|fully)\\s+)?(?:done|finished|complete|completed|there)|" +
  "(?:haven'?t|have\\s+not|hasn'?t)\\s+(?:(?:quite|yet)\\s+)?(?:done|finished|completed)|not\\s+yet|still\\s+going|(?:almost|nearly)\\s+(?:done|there|finished)|" +
  "[وف]?(?:ما|لم|مب|مو|مش)\\s*(?:خلصت|خلصنا|كملت|اكملت|انتهيت|انهيت|انته|انتهي|اكمل)|" +
  "(?:" + LATIN_NEGATION + ")\\s+(?:" + KHALAST + "|" + KAMMALT + ")";
const [NOT_YET, NOT_YET_ALL] = hasAndEvery(NOT_YET_WORDS);
// A completion that is still to come, or asked about: "I need to finish",
// "I have to complete 8", "let me finish", "I'll be done soon", "done in a
// sec", "am I done?". Not a completion (and its number is not a count); the
// member is asked again during a set. Arabic future forms ("لازم اخلص", "راح
// اخلص", "بخلص") are not completion words already.
const INTENT_WORDS =
  "(?:(?:have|has|need|needs|got|want|wants|going|trying|try|ready|about|supposed|planning|hoping)\\s+to|gotta|gonna|wanna|will|shall|(?:i|we|it|you)'?ll|let\\s+me|let'?s|can\\s+i|should\\s+i|may\\s+i)\\s+" +
  "(?:(?:just|be|get|go|really|quickly|now|then|to)\\s+){0,2}(?:finish|finished|complete|completed|done)|" +
  "(?:done|finished|finish)\\s+(?:soon|shortly|later|in\\s+a\\s+(?:sec|second|minute|moment|bit|few))|" +
  "(?:am|are|is)\\s+(?:i|we|it|that|this)\\s+(?:(?:all|really)\\s+)?(?:done|finished|complete|completed)";
const [INTENT, INTENT_ALL] = hasAndEvery(INTENT_WORDS);
// "I can't do 10", "ما اقدر اكمل ثلاث": the present-tense complaint (a
// too-heavy report, TOO_HEAVY) with the count it could not reach.
const CANNOT_WORDS =
  "(?:can'?t|cannot|can\\s+not|unable\\s+to)\\s+(?:do|finish|complete|manage|make|get\\s+through|lift)\\p{L}*|" +
  "(?:ما|لا|مب|مو)\\s*(?:اقدر|استطيع|اقدرش)\\s*(?:ارفع|اشيل|احمل|اكمل|اسوي|اخلص)\\p{L}*";
// A negated clause with what it governs, up to punctuation or a word that
// starts what was done instead ("but", "only", "did 6", "بس", "سويت"). A
// number in it is what the member did NOT do ("I didn't do the last 2 reps",
// "ما سويت آخر ثنتين", "I can't do 10"), so it is never a rep count; a count
// after it still is ("I didn't finish, did 6", "I didn't do 8, only 6").
const CLAUSE_BREAK =
  "[,.;:!?،؛؟]|(?<![\\p{L}\\p{N}'])(?:but|only|just|so|and|then|instead|did|[وف]?(?:بس|لكن|بل|فقط|سويت|قمت|عملت))(?![\\p{L}\\p{N}])";
const NEGATED_CLAUSE = new RegExp(
  B + "(?:" + NOT_DONE_WORDS + "|" + NOT_YET_WORDS + "|" + INTENT_WORDS + "|" + CANNOT_WORDS + ")(?:(?!" + CLAUSE_BREAK + ")[\\s\\S])*",
  "giu",
);
// A reply that says the set is still under way ("yet", "still", "لسا").
const STILL = has("yet|still|لسا|لسه|للحين|باقي|بعدني|مازلت|ما\\s*زلت|لازلت|لا\\s*زلت|بعد");
// A reply that points back to an earlier set: "the last one", "آخر وحدة",
// "المجموعة الأخيرة".
const REFERS_BACK = has(
  "last|previous|earlier|before|اخر|الاخير|الاخيره|السابق|السابقه|فات|فاتت|قبل",
);
// The instruction form of a command ("say done when you finish") is the
// trainer's prompt, not a reply. Pain is read before this is removed.
const INSTRUCTION = new RegExp(B + "say\\s+(?!again" + E + ")(?:[\\p{L}']+)", "giu");
const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
  واحد: 1, واحده: 1, اثنين: 2, اثنان: 2, ثنتين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4,
  خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثماني: 8, ثمانيه: 8,
  تسع: 9, تسعه: 9, عشر: 10, عشره: 10,
  // Gulf teens, said as one word.
  احدعش: 11, اثنعش: 12, ثنعش: 12, ثلطعش: 13, ثلاثطعش: 13, ثلثطعش: 13, ثلتعش: 13,
  اربعطعش: 14, اربعتعش: 14, خمسطعش: 15, خمستعش: 15, سطعش: 16, ستطعش: 16, ستعش: 16,
  سبعطعش: 17, سبعتعش: 17, ثمنطعش: 18, ثمانطعش: 18, ثمنتعش: 18, تسعطعش: 19, تسعتعش: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  عشرين: 20, عشرون: 20, ثلاثين: 30, ثلاثون: 30, اربعين: 40, اربعون: 40, خمسين: 50, خمسون: 50,
  ستين: 60, ستون: 60, سبعين: 70, سبعون: 70, ثمانين: 80, ثمانون: 80, تسعين: 90, تسعون: 90,
};
// MSA teens are two words, the unit first: "اثنا عشر" (12), "ثلاثة عشر" (13).
const TEEN_UNITS: Record<string, number> = { احد: 1, احدي: 1, اثنا: 2, اثني: 2, اثنتا: 2, اثنتي: 2 };
const TEN_WORDS = new Set(["عشر", "عشره"]);
// "One" is also a pronoun ("the last one", "this one", "next one", "one
// more", "آخر واحدة", "هذي واحدة", "واحدة ثانية"): after these words, or
// before these, it is not a rep count.
const ONE_WORDS = new Set(["one", "واحد", "واحده"]);
const ONE_AFTER = new Set([
  "the", "this", "that", "last", "next", "first", "second", "third", "previous", "final", "other",
  "another", "each", "every", "any", "which", "same", "no", "a", "big", "hard", "easy", "heavy",
  "tough", "good", "new", "little", "wrong", "right",
  "اخر", "اول", "هذي", "هذه", "ذي", "هاذي", "هاي", "هذا", "ذا", "هاذا", "ذاك", "ذيك", "هذيك", "كل", "اي", "نفس",
]);
const ONE_BEFORE = new Set([
  "more", "of", "moment", "sec", "time", "thing", "again", "left",
  "ثانيه", "ثاني", "زياده", "كمان", "اخري",
]);
// "The last two (reps)", "the last few", "the final reps", "آخر ثنتين",
// "آخر تكرارين", "التكرارات الأخيرة" are reps of a set, not an earlier set:
// they never make a reply point back. "The last one" ("آخر وحدة") is the
// previous set, and "the last 2 sets" ("آخر مجموعتين") points back too.
const numberWords = (script: RegExp) =>
  [...Object.keys(UNITS), ...Object.keys(TENS)]
    .filter((w) => script.test(w) && (UNITS[w] ?? TENS[w]) > 1)
    .join("|");
const LAST_REPS = new RegExp(
  B +
    "(?:(?:last|final)\\s+(?:[2-9٢-٩]|\\p{N}{2,}|" +
    numberWords(/^[a-z]+$/) +
    "|few|couple|reps?|repetitions?)" +
    E +
    "(?!\\s+(?:sets?|rounds?|exercises?)" +
    E +
    ")|اخر\\s+(?:[2-9٢-٩]|\\p{N}{2,}|" +
    numberWords(/^\p{Script=Arabic}+$/u) +
    "|تكرار\\p{L}*|عدات|عدتين)" +
    E +
    "(?!\\s+(?:مجموع|جول|تمرين)\\p{L}*)|(?:ال)?(?:تكرار\\p{L}*|عدات)\\s+(?:ال)?اخير\\p{L}*)",
  "giu",
);
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const westernDigits = (text: string) =>
  text.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));
// A set that was not fully done, or reps still to do: "done except 2",
// "done, missing 2", "done, 2 short", "2 to go", "2 left", "3 more and done",
// "didn't get the last rep", "failed the last one", "did 10 minus 1",
// "خلصت الا وحدة", "ناقص وحدة", "خلصت بدون ثنتين", "ما عدا وحدة", "غير
// ثنتين", "وبقى ثنتين", "ضل ثنتين", "فاتتني وحدة", "بس ثنتين وأخلص", "ثنتين
// بعد". The numbers in it are what was missed or is left, never a count; a
// completion with it is not one (the member is asked again); a count said
// before it is uncertain ("did 10 but missed 1", "سويت عشر الا وحدة"); a
// count said after it, in its own clause, is what was done ("missing 2, did
// 3"). "2 more sets" and "2 sets left" are sets, not reps.
const EN_QTY =
  "\\p{N}+|" + numberWords(/^[a-z]+$/) + "|one|a\\s+couple(?:\\s+of)?|couple|a\\s+few|few|some|several";
const AR_QTY =
  "\\p{N}+|[وب]?(?:" + numberWords(/^\p{Script=Arabic}+$/u) + "|واحد|واحده|وحده|وحد)|تكرار\\p{L}*|عدات|عده|عدتين";
const DEFICIT_WORDS =
  "except|excluding|minus|missing|" +
  "(?:without|w\\/o)\\s+(?:the\\s+|my\\s+)?(?:last\\s+|final\\s+)?(?:" + EN_QTY + "|reps?|them)|" +
  "(?:didn'?t|did\\s+not|couldn'?t|could\\s+not|wasn'?t\\s+able\\s+to|failed\\s+to)\\s+(?:get|hit|make)\\s+(?:the\\s+|my\\s+)?(?:last|final|all|every|" + EN_QTY + ")|" +
  "(?:missed|skipped|failed|dropped)\\s+(?:(?:the|my|a)\\s+)?(?:last|final|reps?|" + EN_QTY + ")|" +
  // "8 left, 8 right" and "left side" are the sides of unilateral work.
  "(?:" + EN_QTY + ")\\s+(?:more\\s+)?(?:reps?\\s+)?(?:short|to\\s+go|remaining|less|fewer|" +
  "left(?!\\s+(?:side|leg|arm|hand|foot|knee|hip|shoulder))(?![\\s\\S]*(?<![\\p{L}\\p{N}])right(?![\\p{L}\\p{N}])))|" +
  "short\\s+(?:by\\s+)?(?:" + EN_QTY + ")|" +
  "(?:" + EN_QTY + ")\\s+more(?!\\s+(?:sets?|rounds?|exercises?|times?)(?![\\p{L}\\p{N}]))|" +
  "[وف]?(?:الا|عدا|ناقص\\p{L}*|نقص(?:ت|ني|تني|ه|ها)?|ينقص\\p{L}*|فات(?:ني|تني|وني|تنا|نا))|" +
  // "باقي / بقى / ضل ثنتين" (two left), not "باقي مجموعتين" (two sets left).
  // "ف" is never joined to "ضل": "فضل" is "favour" ("من فضلك", please).
  "(?:[وف]?(?:باقي|باقيه|بقي|بقت|بقالي|بقيلي|باقيلي)|و?(?:ضل|ظل|ضلت|ظلت|ضايل\\p{L}*))" +
  NOT_SETS_AHEAD_AR + "|" +
  "[وف]?(?:بدون|غير)\\s+(?:ال)?(?:اخر\\s+)?(?:" + AR_QTY + ")|" +
  // "ثنتين بعد" (two more) said last, "ثنتين وأخلص / وبخلص" (two and I finish).
  "(?:" + AR_QTY + ")\\s+(?:بعد(?=\\s*(?:$|[,.;:!?،؛؟]))|[وف]?(?:ب|ا|ن|با|بن)(?:خلص|كمل|نتهي|نهي)\\p{L}*)";
const DEFICIT = has(DEFICIT_WORDS);
// The deficit with what it governs, up to punctuation or a word that starts
// what was done ("missing 2, did 3").
const DEFICIT_CLAUSE = new RegExp(B + "(?:" + DEFICIT_WORDS + ")(?:(?!" + CLAUSE_BREAK + ")[\\s\\S])*", "giu");
// A number is a rep count unless it names a set or exercise ("set 1 of 3",
// "المجموعة 2", "التمرين 2", "رقم 2"), a position ("2 of 3", "٢ من ٣",
// "1/3"), points at reps rather than counting them ("the last two were hard",
// "آخر ثنتين كانت صعبة") or is a load or time ("60 kilograms", "30 seconds").
// Arabic words are also looked up without a joined article or "و"/"ب"/"ف".
const NOT_REPS_BEFORE = new Set([
  "set", "sets", "of", "exercise", "exercises", "round", "rounds", "number",
  "مجموعه", "مجموعات", "تمرين", "تمارين", "ست", "سيت", "جوله", "جولات", "رقم", "من",
  "last", "final", "first", "اخر", "اول",
]);
const notRepsBefore = (word: string) =>
  NOT_REPS_BEFORE.has(word) || NOT_REPS_BEFORE.has(word.replace(/^(?:[وبف]?ال|[وبف])(?=\p{L}{2,}$)/u, ""));
// "2 of 3", "2 out of 3", "٢ من ٣": a position, not a count.
const POSITION_OF = new Set(["of", "من"]);
// Between two numbers, a range or a correction: "8 or 9", "8 to 10", "between
// 8 and 10", "8, no, 6", "8, actually 6", "12 I mean 10", "ثمان أو تسع",
// "عشر، لا ثمان", "ثمان، قصدي ست". Such a count is uncertain.
const RANGE_OR_CORRECTION = new Set([
  "or", "to", "till", "until", "through", "thru", "and", "no", "not", "nope", "actually", "mean", "meant", "sorry",
  "rather", "wait", "correction", "او", "ولا", "لا", "قصدي", "اقصد", "قصدت", "بل", "عفوا", "الي", "لين", "حتي",
]);
// Words that may stand between a completion word and its count ("did them
// all 8", "خلصت يا كوتش ثمان"). Any other word between them breaks the tie:
// "done except 2", "did heavy 2", "خلصت الا 2" are not counts.
const TIE_FILLER = new Set(["it", "them", "all", "between", "coach", "captain", "يا", "كوتش", "كابتن", "والله", "كلها", "كله", "بين"]);
const NOT_REPS_AFTER =
  /^(?:kg|kgs|kilo|kilos|kilogram|kilograms|lb|lbs|pound|pounds|percent|%|seconds?|secs?|minutes?|mins?|hours?|hrs?|sets?|rounds?|exercises?|left|remaining|more|extra|less|fewer|كيلو|كيلوز|كيلوات|كيلس|كيلوغرام|كيلوجرام|كجم|ثانيه|ثواني|دقيقه|دقائق|دقايق|ساعه|ساعات|مجموعه|مجموعات|جوله|جولات|تمرين|تمارين|ست|سيت|ستات|سيتات|زياده|اكثر|اقل|باقي|باقيه)$/u;
// A count must be tied to the set. It is a rep count only when a rep word
// follows it ("10 reps", "ثمان تكرارات"), a word that reports it comes just
// before it ("did 10", "سويت عشر", "just one", "that was one", "sawwait 12")
// or just after it ("6 only", "ست بس"), or it is the whole reply ("Eight.",
// "٨", "twenty five", "اثنا عشر"). Anything else is not a count: a misheard
// "الوزن ثقيل وايد" as "الوزن ثقيل واحد" logged a set of 1 rep, "ما خلصت" as
// "ما خمسة" logged 5, "هل ست؟ سويت ثمان" logged 6 (retest, 29 September 2026).
// Also "reps" as transcribers write it in Arabic letters ("8 ربز").
const REP_UNIT = /^(?:reps?|repetitions?|times|تكرار\p{L}*|عدات|عده|عدتين|مرات|ربز|ريبز|ربس|ريبس|ريب)$/u;
const COUNT_BEFORE = new RegExp(
  "^(?:did|done|got|finished|completed|managed|made|hit|only|just|total|that'?s|thats|it'?s|" +
    "سويت|ساويت|سوينا|قمت|عملت|لعبت|كملت|اكملت|خلصت|خلصنا|انهيت|انجزت|بس|فقط|" +
    SAWWAIT + "|" + KHALAST + "|" + KAMMALT + ")$",
  "u",
);
const COUNT_AFTER = /^(?:done|finished|only|total|بس|فقط|خلاص|خلص|خلصت)$/u;
// "That was one", "it was eight": "was" reports a count only after these.
const WAS_SUBJECT = new Set(["that", "it", "this"]);
// Said around a bare count, it is still the whole reply.
const COUNT_FILLER = new Set([
  "um", "uh", "er", "erm", "hmm", "mm", "ok", "okay", "so", "coach", "yes", "yeah", "yep", "right", "alright", "well", "please", "ya",
  "يا", "كوتش", "كابتن", "اوكي", "اوك", "تمام", "طيب", "ايه", "ايوه", "ايوا", "نعم", "اي", "زين", "والله",
]);
// An effort word just before a number, a word or digits: "ثقيل واحد", "heavy
// one", "hard two", "heavy 1", "ثقيل 1" (a misheard "وايد") are not counts
// unless a rep word follows ("heavy, 6 reps").
const EFFORT_BEFORE = new Set([
  "heavy", "hard", "tough", "much", "difficult", "ثقيل", "ثقيله", "تقيل", "تقيله", "صعب", "صعبه", "وايد", "واجد", "جدا", "مره", "كثير",
]);
/** A number word, also after a joined Arabic "and"/"with" ("وعشرين", "بثماني"). */
function numberWord(token: string): { value: number; tens: boolean } | null {
  for (const t of [token, /^[وبف]\p{L}{2,}$/u.test(token) ? token.slice(1) : null]) {
    if (!t) continue;
    if (t in TENS) return { value: TENS[t], tens: true };
    if (t in UNITS) return { value: UNITS[t], tens: false };
  }
  return null;
}
// "1/3" is read as "1 of 3" (a position).
const countTokens = (text: string) =>
  westernDigits(text)
    .replace(/(\p{N})\s*\/\s*(?=\p{N})/gu, "$1 of ")
    .split(/[^\p{L}\p{N}'%]+/u)
    .filter(Boolean);
/**
 * The number that starts at token `i`, with the tokens it spans and a unit
 * joined to its digits ("8kg"), or null (not a number, or "one" as a pronoun).
 */
function numberAt(tokens: string[], i: number): { value: number; width: number; unit?: string; digits: boolean } | null {
  const t = tokens[i];
  const digits = /^(\d{1,3})(\p{L}*)$/u.exec(t);
  // Digits joined to letters are a number only with a unit ("8kg", "10reps");
  // otherwise they are a word written with Latin digits ("5alast", "3ashra").
  if (digits && digits[2] && !NOT_REPS_AFTER.test(digits[2]) && !REP_UNIT.test(digits[2])) return null;
  if (digits) return { value: Number(digits[1]), width: 1, unit: digits[2] || undefined, digits: true };
  if (t in TEEN_UNITS && TEN_WORDS.has(tokens[i + 1] ?? "")) return { value: TEEN_UNITS[t] + 10, width: 2, digits: false };
  const word = numberWord(t);
  if (!word) return null;
  const next = tokens[i + 1] ?? "",
    after = tokens[i + 2] ?? "";
  if (word.tens) {
    // "twenty five"
    const units = next && next in UNITS && UNITS[next] < 10 ? UNITS[next] : 0;
    return { value: word.value + units, width: units ? 2 : 1, digits: false };
  }
  // "ثلاثة عشر" (13)
  if (word.value < 10 && TEN_WORDS.has(next)) return { value: word.value + 10, width: 2, digits: false };
  // "خمسة وعشرين" (25): the unit, then "and" with the tens.
  if (word.value < 10 && next.startsWith("و") && numberWord(next)?.tens)
    return { value: word.value + numberWord(next)!.value, width: 2, digits: false };
  if (word.value < 10 && next === "و" && after in TENS) return { value: word.value + TENS[after], width: 3, digits: false };
  if (ONE_WORDS.has(t) && (ONE_AFTER.has(tokens[i - 1] ?? "") || ONE_BEFORE.has(next))) return null;
  return { value: word.value, width: 1, digits: false };
}
type SpokenCount = { value: number | null; ambiguous: boolean; said: boolean };
/**
 * The rep count of a reply: the first number tied to the set (see REP_UNIT),
 * and whether it is uncertain (`ambiguous`): another tied count with a
 * different value ("did 8, did 6"), or another number next to it or joined to
 * it by a range or a correction ("8 or 9", "8 to 10", "8, no, 6", "12 I mean
 * 10", "ثمان أو تسع", "عشر، لا ثمان", "ثمان، قصدي ست"). Loads, times, sets,
 * positions ("2 of 3") and a number just after an effort word are never
 * candidates. `said` when the reply has a candidate number at all, tied or
 * not ("I did around ten"). `clause` is the reply with negated clauses
 * removed; `whole` is the reply.
 */
function spokenCount(clause: string, whole: string): SpokenCount {
  const tokens = countTokens(clause);
  const content = countTokens(whole).filter((t) => !COUNT_FILLER.has(t));
  const candidates: Array<{ value: number; start: number; end: number; tied: boolean }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const n = numberAt(tokens, i);
    if (!n) continue;
    const end = i + n.width;
    const prev = tokens[i - 1] ?? "",
      next = tokens[end] ?? "";
    const unit = n.unit ?? next;
    // "2 of 3", "2 out of 3", "٢ من ٣", "1/3": a position; neither is a count.
    const of = POSITION_OF.has(next) ? end : next === "out" && tokens[end + 1] === "of" ? end + 1 : -1;
    const total = of >= 0 && !n.unit ? numberAt(tokens, of + 1) : null;
    if (total) {
      i = of + total.width;
      continue;
    }
    // A set, an exercise, a load or a time ("set 1 of 3", "المجموعة 2", "60 kilograms").
    if (notRepsBefore(prev) || (unit && NOT_REPS_AFTER.test(unit))) {
      i = end - 1;
      continue;
    }
    const repWord = REP_UNIT.test(unit);
    if (EFFORT_BEFORE.has(prev) && !repWord) {
      i = end - 1;
      continue;
    }
    // Up to two filler words between the reporting word and the count.
    let before = i - 1;
    while (before >= i - 2 && TIE_FILLER.has(tokens[before] ?? "")) before--;
    const reported =
      COUNT_BEFORE.test(prev) ||
      (prev === "was" && WAS_SUBJECT.has(tokens[i - 2] ?? "")) ||
      (before < i - 1 && COUNT_BEFORE.test(tokens[before] ?? ""));
    const alone = content.length === n.width && numberAt(content, 0)?.value === n.value;
    candidates.push({ value: n.value, start: i, end, tied: repWord || reported || (!n.unit && COUNT_AFTER.test(next)) || alone });
    i = end - 1;
  }
  const first = candidates.find((c) => c.tied);
  if (!first) return { value: null, ambiguous: false, said: candidates.length > 0 };
  const joined = (a: { start: number; end: number }, b: { start: number; end: number }) => {
    const between = a.end <= b.start ? tokens.slice(a.end, b.start) : tokens.slice(b.end, a.start);
    return !between.length || between.some((t) => RANGE_OR_CORRECTION.has(t));
  };
  const ambiguous = candidates.some(
    (c) => c !== first && c.value !== first.value && (c.tied || joined(first, c)),
  );
  return { value: first.value, ambiguous, said: true };
}

/**
 * Maps one spoken reply to a command. Pain and red-flag wording (the code floor
 * `safetySignal`, which also reads Arabic) always wins; the server re-screens
 * every transcript with the trainer's published policy as well. Plain
 * acknowledgements never complete a set (a negated one, "not okay" or "مو
 * زين", is not an acknowledgement), a negated or hedged completion ("I didn't
 * finish", "I never made it", "I almost did it", "not done yet", "ما خلصت",
 * "ما تم") never logs one, a negated request to carry on ("I'm not ready",
 * "مو مستعد", "don't skip") pauses and never moves on, a number inside a
 * negated clause ("I didn't do the last 2 reps", "ما سويت آخر ثنتين", "I
 * can't do 10") is never a rep count, and a rep count wins over "heavy" in
 * the same reply (the heaviness is kept as a flag). A set is logged only from
 * an unambiguous completion: a hedged completion or count ("almost done",
 * "about 8", "تقريباً خلصت", "وتقريباً خلصت", "يعني خلصت") is an
 * acknowledgement, so is a completion with reps missed or still to do ("done
 * except 2", "2 to go", "خلصت الا وحدة", "خلصت وباقي ثنتين") and a count that
 * is a range, is corrected or comes before a deficit ("8 or 9", "did 8, no,
 * 6", "did 10 but missed 1"); a number is a count only when it is tied to the
 * set ("did 10", "10 reps", "سويت عشر", or the number alone), never a set or a
 * position ("خلصت المجموعة 2", "done, 2 of 3") or a number just after an
 * effort word ("heavy 1"); and "خلص" / "خلاص" alone are not completions.
 */
export function parseVoiceCommand(transcript: string): VoiceCommand {
  const raw = String(transcript ?? "").slice(0, 500);
  const screened = screeningText(raw).trim().replace(/[-_]/g, " ");
  if (!screened) return { type: "unknown" };
  if (safetySignal(raw) || PAIN.test(screened) || UNWELL.test(screened))
    return { type: "pain", transcript: raw.trim() };
  const folded = screened.replace(INSTRUCTION, " ");
  const effort = folded.replace(NEGATED_EFFORT, " ");
  const heavy = TOO_HEAVY.test(effort);
  // Not ready, or not carrying on ("I'm not ready", "I can't continue", "don't
  // skip", "مو مستعد", "ما نكمل", "هيا لا"): the session pauses. It never
  // resumes, skips or moves on.
  const notReady = NEGATED_FLOW.test(folded) || FLOW_THEN_NO.test(folded);
  const skip = !notReady && SKIP.test(folded),
    pause = notReady || PAUSE.test(folded);
  // A negated completion is never a completion. Said in the past tense it is a
  // report for the trainer; "not yet" or "still" means the set is under way.
  const negatedDone = NOT_DONE.test(folded),
    notYet = NOT_YET.test(folded) || NEGATED_COMPLETE.test(folded);
  const still = (negatedDone || notYet) && STILL.test(folded);
  const notDone = !still && (negatedDone || (notYet && REFERS_BACK.test(folded)));
  const intent = INTENT.test(folded);
  const completion = folded
    .replace(NEGATED_COMPLETE_ALL, " ")
    .replace(NOT_DONE_ALL, " ")
    .replace(NOT_YET_ALL, " ")
    .replace(INTENT_ALL, " ");
  // Uncertain: never a completion or a count.
  const hedged = HEDGE.test(folded);
  // Reps missed or still to do ("done except 2", "2 to go", "خلصت الا وحدة",
  // "بس ثنتين وأخلص"): a completion with it is not one.
  const deficitAt = folded.search(DEFICIT),
    deficit = deficitAt >= 0;
  // A number inside a negated clause or a deficit is what was not done, never
  // a count ("I didn't do the last 2", "done except 2", "خلصت بدون ثنتين").
  const clause = folded.replace(NEGATED_CLAUSE, " ");
  const counted = spokenCount(deficit ? clause.replace(DEFICIT_CLAUSE, " ") : clause, folded);
  const reps = counted.value;
  // A count is uncertain when it is a range or corrected ("8 or 9", "did 8,
  // no, 6", "سويت عشر، لا ثمان") or said before a deficit ("did 10 but missed
  // 1", "سويت عشر الا وحدة"): the member is asked again.
  const uncertain =
    reps !== null &&
    (counted.ambiguous ||
      (deficit && spokenCount(folded.slice(0, deficitAt).replace(NEGATED_CLAUSE, " "), folded).value !== null));
  if (reps !== null && reps <= 200 && !hedged && !uncertain && !skip && !pause)
    return heavy ? { type: "reps", reps, heavy: true } : { type: "reps", reps };
  if (uncertain && !heavy && !skip && !pause) return { type: "ack" };
  if (notDone)
    return {
      type: "not_done",
      ...(REFERS_BACK.test(folded.replace(LAST_REPS, " ")) ? { previous: true } : {}),
      ...(heavy ? { heavy: true } : {}),
    };
  if (heavy) return { type: "too_heavy" };
  if (TOO_EASY.test(effort)) return { type: "too_easy" };
  if (skip) return { type: "skip" };
  if (pause) return { type: "pause" };
  if (REPEAT.test(folded)) return { type: "repeat" };
  if (deficit || (hedged && (counted.said || COMPLETE.test(completion)))) return { type: "ack" };
  if (COMPLETE.test(completion)) return { type: "done" };
  if (RESUME.test(folded)) return { type: "resume" };
  if (ACK.test(folded.replace(NEGATED_ACK, " ")) || notYet || negatedDone || intent) return { type: "ack" };
  return { type: "unknown" };
}

/**
 * The transcript to act on when one reply was transcribed in more than one
 * language: always the first, read in the member's reply language, and never
 * another. Cartesia's batch model is told the language and cannot detect it,
 * so a reply read in the other language comes back as unrelated words (live
 * check: Arabic "ألم" read as English was "I"; retest, 29 September 2026: Gulf
 * "طوفها" (skip it) read as English was "2.", and acting on that reading
 * logged a set of 2 reps). The other reading is screened for pain only
 * (`otherReadingScreenText`); when the reply-language reading is not
 * understood the member is asked again (the help line, or "say done" during
 * a set), and nothing is logged from the other reading.
 */
export function replyTranscript(transcripts: string[]): string {
  return String(transcripts[0] ?? "").trim();
}

/**
 * What each reading of one reply is screened with, in order: the first (the
 * member's reply language, or a device transcript) as heard, any other with
 * `otherReadingScreenText`. Empty readings are left out.
 */
export function readingsToScreen(transcripts: string[]): Array<{ transcript: string; screened: string }> {
  return transcripts
    .map((t, index) => {
      const transcript = String(t ?? "").trim();
      return { transcript, screened: index && transcript ? otherReadingScreenText(transcript) : transcript };
    })
    .filter((r) => r.transcript);
}

// Arabic words that are pain in every position but one. "ألم" is also the
// question particle ("didn't...?"): "I didn't finish that set." read as
// Arabic was "ألم أنه لا ينفع هذا المنزل" and stopped the session for pain
// (retest). "آلام" is also "إلامَ" (to what?), and "إصابة" also a hit ("إصابة
// الهدف").
const QUESTION_PAIN = new Set(["الم", "الام"]);
const TARGET_PAIN = "اصابه";
// After the particle: "أنّ" ("ألم أنه", as the retest read it) or a verb in
// the imperfect ("ألم أقل", "ألم تر", "ألم يكن", "ألم نشرح", "إلام تنظر").
const PARTICLE_CONJUNCTION = new Set(["ان", "انه", "انها", "انك", "انكم", "انهم", "انني", "اننا"]);
// Words that start like an imperfect verb but are not one.
const NOT_A_VERB = new Set([
  "انا", "انت", "انتي", "انتم", "احنا", "نحن", "اي", "ايه", "ايش", "يا", "يعني", "تحت", "يمين", "يسار", "نص",
  "اليوم", "امس", "ايد", "ايدي", "يد", "يدي", "يده", "تو", "توه", "ترا", "ترى", "تري",
]);
const imperfectVerb = (w: string) => /^[اتين]\p{L}{1,6}$/u.test(w) && !w.startsWith("ال") && !NOT_A_VERB.has(w);
// "إصابة الهدف / المرمى / السلة": a hit, not an injury.
const TARGET_SENSE = /^(?:ال)?(?:هدف|اهداف|مرمي|كره|سله|شباك|نقطه|نقاط|رميه)$/u;
// A pain context anywhere in the clause keeps the word: a body part (with a
// joined article or "ب"/"ل"/"و"/"ف"), an intensity, a location or a verb that
// describes pain ("ألم يزيد", "ألم تحت الركبة", "ألم ينزل لرجلي").
const PAIN_CONTEXT =
  /^(?:[وبلف]?(?:ال)?(?:ركب|ظهر|ضهر|كتف|صدر|راس|رقب|بطن|ذراع|ايد|يد|رجل|ريل|ساق|قدم|كاحل|ورك|معصم|فخذ|كوع|مفصل|عضل|اسفل|قلب|ضلع|خصر|حوض|رسغ|اصبع|اصابع)\p{L}*|شديد|شديده|قوي|قويه|حاد|حاده|كبير|كبيره|فظيع|رهيب|مره|وايد|جدا|خفيف|خفيفه|بسيط|مفاجي|مستمر|يزيد|يزداد|زاد|يزيدني|يوجع\p{L}*|يعور\p{L}*|ينبض|يقتل\p{L}*|يذبح\p{L}*|يطعن\p{L}*|ينزل|نازل|يمتد|يطلع|تحت|فوق|يمين|يسار|جنب|هنا|هني|عندي|فيني|احس|اشعر|حاس|حاسه|حاسس|اعاني|شعرت|حسيت|جاني|جاتني|لدي|يوجد)$/u;
const READING_FILLER = new Set(["يا", "اه", "اي", "ايه", "اوه", "اخ", "اح", "اييي", "والله", "كوتش", "كابتن"]);
/**
 * The text an other-language reading is screened with (the trainer's policy,
 * the code floor and the runner's own stop list): folded, with "ألم" / "آلام"
 * removed only where it is the question particle, that is followed in the
 * same clause by "أنّ" or a verb in the imperfect ("ألم أنه", "ألم أقل لك",
 * "ألم تر", "إلام تنظر") with no pain context in the clause, and "إصابة" only
 * where it is a hit ("إصابة الهدف"). Everywhere else they stay and stop the
 * session: "ألم", "ألم رهيب", "ظهري ألم", "ألم، وقف", "ألم stop", "ألم قاعد
 * يزيد", "إصابة خفيفة", "ألم يزيد". Every other red flag is screened as in the
 * reply-language reading ("My back يعورني", "أشعر بدوار"), and the
 * reply-language reading is screened unchanged.
 */
export function otherReadingScreenText(transcript: string): string {
  const folded = screeningText(String(transcript ?? ""));
  const parts = folded.split(/([^\p{L}\p{N}]+)/u);
  // The words of the clause around part k, in order (punctuation ends a clause).
  const clause = (k: number, step: number) => {
    const out: string[] = [];
    for (let j = k + step; j >= 0 && j < parts.length; j += step) {
      if (j % 2 === 1) {
        if (/[.,;:!?،؛؟]/u.test(parts[j])) break;
        continue;
      }
      if (parts[j]) out.push(parts[j]);
    }
    return out;
  };
  return parts
    .map((part, k) => {
      if (k % 2 === 1) return part;
      const after = clause(k, 1).filter((w) => !READING_FILLER.has(w));
      if (part === TARGET_PAIN) return after.length && TARGET_SENSE.test(after[0]) ? " " : part;
      if (!QUESTION_PAIN.has(part) || !after.length) return part;
      const particle = PARTICLE_CONJUNCTION.has(after[0]) || imperfectVerb(after[0]);
      const painContext = [...clause(k, -1), ...after].some((w) => PAIN_CONTEXT.test(w));
      return particle && !painContext ? " " : part;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Hearing the trainer's own voice. A phone speaker's echo reaches the
// microphone, and many prompts contain command words ("say pain", "say done",
// "8 reps"). Replies are ignored while a clip plays and briefly after it, and
// a reply that repeats a recent prompt is treated as its echo.
// ---------------------------------------------------------------------------
/** Replies heard during playback or this soon after it are dropped. */
export const ECHO_GRACE_MS = 700;
/** For this long after playback, a reply that repeats a recent prompt is dropped. */
export const ECHO_WINDOW_MS = 4000;
const echoTokens = (text: string) =>
  westernDigits(screeningText(String(text ?? "")))
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((t) => (t in UNITS ? String(UNITS[t]) : t in TENS ? String(TENS[t]) : t));
function containsRun(haystack: string[], needle: string[]) {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let k = 0; k < needle.length; k++) if (haystack[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}
/** Whether a transcript is (part of) one of the recently spoken prompts. */
export function isPromptEcho(transcript: string, prompts: string[]) {
  const heard = echoTokens(transcript);
  if (!heard.length) return true;
  for (const prompt of prompts) {
    const said = echoTokens(prompt);
    if (!said.length) continue;
    if (heard.join(" ") === said.join(" ")) return true;
    if (heard.length >= 2 && containsRun(said, heard)) return true;
    if (heard.length >= 3) {
      const words = new Set(said);
      if (heard.filter((w) => words.has(w)).length / heard.length >= 0.7) return true;
    }
  }
  return false;
}
/**
 * The command for a recognised reply, or null when it must be ignored as the
 * trainer's own voice: while a clip plays, within `ECHO_GRACE_MS` after it,
 * or a repeat of a recent prompt within `ECHO_WINDOW_MS`. The Pain button is
 * never affected.
 */
export function heardReply(input: {
  transcript: string;
  playing: boolean;
  sincePlaybackMs: number;
  prompts: string[];
}): VoiceCommand | null {
  if (input.playing || input.sincePlaybackMs < ECHO_GRACE_MS) return null;
  if (input.sincePlaybackMs < ECHO_WINDOW_MS && isPromptEcho(input.transcript, input.prompts))
    return null;
  return parseVoiceCommand(input.transcript);
}

// ---------------------------------------------------------------------------
// Runner state machine.
// ---------------------------------------------------------------------------
export type RunnerPhase =
  | "ready"
  | "intro"
  | "warmup"
  | "setup"
  | "set"
  | "rest"
  | "cooldown"
  | "finished"
  | "paused"
  | "stopped";
export type SetTarget = { reps: number; loadKg: number };
export type RunnerOutcome = {
  type:
    | "started"
    | "set_logged"
    | "adjusted"
    | "too_heavy_kept"
    | "too_easy"
    | "skipped_set"
    | "skipped_exercise"
    | "paused"
    | "pain"
    | "completed"
    /** The member said a set was not done; the trainer reviews it. */
    | "not_done";
  exercise?: number;
  set?: number;
  fromKg?: number;
  toKg?: number;
  reps?: number;
  /** For "not_done": whether the runner had logged that set. */
  logged?: boolean;
};
export type RunnerState = {
  phase: RunnerPhase;
  /** The phase to return to after a pause. */
  resume?: Exclude<RunnerPhase, "paused">;
  exercise: number;
  /** 1-based set of the current exercise. */
  set: number;
  restRemaining: number;
  setElapsed: number;
  /**
   * Seconds left in a timed round (a hold, an interval, a continuous bout).
   * Null until the round's prompt has been spoken and the clock started.
   */
  workLeft?: number | null;
  targets: SetTarget[][];
  logged: string[];
  skipped: string[];
  encouragement: number;
  stopReason?: "pain" | "hold" | "member";
  /** Whether the Brain's struggle line was spoken (once per session). */
  struggleSaid?: boolean;
};
/** A spoken prompt: session lines, then shared clips, with the same words as text. */
export type SayItem = { line: string } | { clip: string };
export type RunnerEffect =
  | { type: "say"; items: SayItem[]; text: string; wait: boolean }
  | {
      type: "log_set";
      exerciseIndex: number;
      exercise: string;
      set: number;
      /** 0 for a round of timed or distance work. */
      reps: number;
      loadKg: number;
      /** The time a timed round lasted, or the distance of a distance round. */
      durationSeconds?: number;
      distanceMeters?: number;
    }
  | { type: "report_pain"; description: string }
  | { type: "outcome"; outcome: RunnerOutcome }
  | { type: "finished" };
export type RunnerEvent =
  | { type: "start" }
  /** The current spoken prompt finished (or, in text mode, was read). */
  | { type: "prompt_done" }
  | { type: "tick"; seconds: number }
  | { type: "command"; command: VoiceCommand }
  /** The server reports a training hold (for example, a red flag in a note). */
  | { type: "held" }
  /** The member ends the session without finishing it. */
  | { type: "end" };
export type RunnerContext = {
  script: SessionScript;
  rules: VoiceAdjustmentRules;
};

export function initialRunnerState(script: SessionScript): RunnerState {
  return {
    phase: "ready",
    exercise: 0,
    set: 1,
    restRemaining: 0,
    setElapsed: 0,
    workLeft: null,
    targets: script.exercises.map((ex) =>
      Array.from({ length: ex.sets }, () => ({ reps: ex.reps, loadKg: ex.loadKg })),
    ),
    logged: [],
    skipped: [],
    encouragement: 0,
  };
}
const key = (exercise: number, set: number) => `${exercise}:${set}`;
const say = (lines: Array<ScriptLine | null | undefined>, clips: string[] = [], extra: string[] = [], wait = true): RunnerEffect => {
  const present = lines.filter((l): l is ScriptLine => !!l);
  return {
    type: "say",
    items: [...present.map((l) => ({ line: l.id })), ...clips.map((clip) => ({ clip }))],
    text: [...present.map((l) => l.text), ...extra].join(" "),
    wait,
  };
};
const phrase = (clip: string, text: string, wait = false): RunnerEffect => ({
  type: "say",
  items: [{ clip }],
  text,
  wait,
});
const outcome = (o: RunnerOutcome): RunnerEffect => ({ type: "outcome", outcome: o });
const sayDone = () =>
  phrase("say_done", "Say done when you finish the set, or tell me how many reps you did.");
const noted = () => phrase("noted", "Noted. Your trainer will review it.");
/**
 * Whether a heard rep count is plausible for a set with `target` reps: at
 * least 1, and at most one and a half times the target or five more than it,
 * whichever is larger, and never more than twice it. 5 reps allow 1 to 10, 10
 * allow 1 to 15, 20 allow 1 to 30, 3 allow 1 to 6. A count outside this is
 * more likely a mishearing than a set ("سويت عشر" read as "تسعة عشر", 19,
 * retest 29 September 2026): the member is asked again and nothing is logged.
 * A count typed on the screen is not checked.
 */
export function plausibleReps(reps: number, target: number) {
  if (!Number.isFinite(reps) || reps < 1) return false;
  if (!(target > 0)) return reps <= 200;
  return reps <= Math.min(2 * target, Math.max(target + 5, Math.ceil(target * 1.5)));
}
/** A set prompt; an adjusted target is composed from shared clips. */
function setPrompt(ctx: RunnerContext, s: RunnerState, exercise: number, set: number): RunnerEffect {
  const ex = ctx.script.exercises[exercise];
  const t = s.targets[exercise][set - 1];
  const form = set >= 2 && ex.form.length ? ex.form[(set - 2) % ex.form.length] : null;
  // The Brain's short push comes before the final set's prompt.
  const push = set >= 2 && set === ex.sets ? ex.brain?.lastSet ?? null : null;
  const lead = push ? [{ line: push.id }] : [];
  const leadText = push ? [push.text] : [];
  if (t.reps === ex.reps && t.loadKg === ex.loadKg)
    return say([push, ex.setLines[set - 1], form]);
  if (workMeasure(ex) !== "reps") {
    // A lighter load for a loaded carry or hold: the round and the new load.
    const load = numberClipKeys(t.loadKg);
    return {
      type: "say",
      items: [
        ...lead,
        { clip: set === ex.sets ? "last_set" : "next_set" },
        ...(load ? [...load, "kilograms"] : ["check_screen"]).map((clip) => ({ clip })),
        ...(timedExercise(ex) ? [{ clip: "go" }] : []),
        ...(form ? [{ line: form.id }] : []),
      ],
      text: [...leadText, `Round ${set} of ${ex.sets}. ${spokenWork(ex, t.loadKg)}.${timedExercise(ex) ? " Go." : " Say done when you finish."}`, form?.text]
        .filter(Boolean)
        .join(" "),
      wait: true,
    };
  }
  const reps = numberClipKeys(t.reps),
    load = t.loadKg > 0 ? numberClipKeys(t.loadKg) : [];
  const clips = [
    set === ex.sets ? "last_set" : "next_set",
    ...(reps && load ? [...reps, "reps", ...load, ...(t.loadKg > 0 ? ["kilograms"] : [])] : ["check_screen"]),
  ];
  const text = `Set ${set} of ${ex.sets}. ${t.reps} reps${t.loadKg > 0 ? ` at ${formatLoad(t.loadKg)} kilograms` : ""}. Say done when you finish.`;
  return {
    type: "say",
    items: [...lead, ...clips.map((clip) => ({ clip })), ...(form ? [{ line: form.id }] : [])],
    text: [...leadText, text, form?.text].filter(Boolean).join(" "),
    wait: true,
  };
}
function beginExercise(ctx: RunnerContext, s: RunnerState, exercise: number): [RunnerState, RunnerEffect[]] {
  const ex = ctx.script.exercises[exercise];
  const next: RunnerState = { ...s, phase: "setup", exercise, set: 1, restRemaining: 0, setElapsed: 0 };
  return [next, [say([ex.setup, ex.cueLine, ex.brain?.lead, ex.form[0]])]];
}
function beginSet(ctx: RunnerContext, s: RunnerState, exercise: number, set: number, lead: RunnerEffect[] = []): [RunnerState, RunnerEffect[]] {
  return [
    { ...s, phase: "set", exercise, set, restRemaining: 0, setElapsed: 0, workLeft: null },
    [...lead, setPrompt(ctx, s, exercise, set)],
  ];
}
function beginCooldown(ctx: RunnerContext, s: RunnerState, lead: RunnerEffect[] = []): [RunnerState, RunnerEffect[]] {
  return [
    { ...s, phase: "cooldown", restRemaining: 0 },
    [...lead, say([...ctx.script.cooldown, ctx.script.finish])],
  ];
}
/** After a set is logged or skipped: rest, then the next set, exercise or cool-down. */
function afterSet(ctx: RunnerContext, s: RunnerState, lead: RunnerEffect[], rest: boolean): [RunnerState, RunnerEffect[]] {
  const ex = ctx.script.exercises[s.exercise];
  const lastSet = s.set >= ex.sets,
    lastExercise = s.exercise >= ctx.script.exercises.length - 1;
  if (lastSet && lastExercise) return beginCooldown(ctx, s, lead);
  if (!rest || ex.restSeconds <= 0) return advance(ctx, s, lead);
  // The Brain's rest talk is spoken in an exercise's first rest only.
  return [
    { ...s, phase: "rest", restRemaining: ex.restSeconds, setElapsed: 0 },
    [...lead, say([ex.rest, s.set === 1 ? ex.brain?.rest : null], [], [], false)],
  ];
}
/** Moves past the current set without rest. */
function advance(ctx: RunnerContext, s: RunnerState, lead: RunnerEffect[] = []): [RunnerState, RunnerEffect[]] {
  const ex = ctx.script.exercises[s.exercise];
  if (s.set < ex.sets) return beginSet(ctx, s, s.exercise, s.set + 1, lead);
  if (s.exercise < ctx.script.exercises.length - 1) {
    const [next, effects] = beginExercise(ctx, s, s.exercise + 1);
    return [next, [...lead, ...effects]];
  }
  return beginCooldown(ctx, s, lead);
}
function stopForPain(s: RunnerState, transcript: string): [RunnerState, RunnerEffect[]] {
  const description = ("Voice session: " + (transcript.trim() || "pain reported")).slice(0, 2000);
  return [
    { ...s, phase: "stopped", resume: undefined, stopReason: "pain", restRemaining: 0 },
    [
      phrase("stopping", "Stopping the session now. Your trainer has been told. If your symptoms are severe, get urgent medical help.", true),
      { type: "report_pain", description },
      outcome({ type: "pain", exercise: s.exercise, set: s.set }),
    ],
  ];
}
function logSet(
  ctx: RunnerContext,
  s: RunnerState,
  reps: number,
  work: { durationSeconds?: number; distanceMeters?: number } = {},
  lead: RunnerEffect[] = [],
): [RunnerState, RunnerEffect[]] {
  const ex = ctx.script.exercises[s.exercise];
  const t = s.targets[s.exercise][s.set - 1];
  const k = key(s.exercise, s.set);
  if (s.logged.includes(k)) return afterSet(ctx, { ...s, workLeft: null }, lead, true);
  const logged: RunnerState = { ...s, workLeft: null, logged: [...s.logged, k], encouragement: s.encouragement + 1 };
  const enc = ex.encouragement.length ? ex.encouragement[s.encouragement % ex.encouragement.length] : null;
  return afterSet(
    ctx,
    logged,
    [
      ...lead,
      { type: "log_set", exerciseIndex: s.exercise, exercise: ex.name, set: s.set, reps, loadKg: t.loadKg, ...work },
      outcome({ type: "set_logged", exercise: s.exercise, set: s.set, reps, toKg: t.loadKg }),
      say([enc], enc ? [] : ["logged"], enc ? [] : ["Logged."], false),
    ],
    true,
  );
}
/**
 * A round of timed or distance work is done: a timed round logs the seconds it
 * lasted (all of them when the clock ran out or never started), a distance
 * round its prescribed distance. Reps are 0.
 */
function finishRound(ctx: RunnerContext, s: RunnerState, lead: RunnerEffect[] = []): [RunnerState, RunnerEffect[]] {
  const ex = ctx.script.exercises[s.exercise];
  if (timedExercise(ex)) {
    const full = ex.durationSeconds!;
    const lasted = typeof s.workLeft === "number" ? Math.max(0, full - s.workLeft) : full;
    return logSet(ctx, s, 0, { durationSeconds: lasted }, lead);
  }
  return logSet(ctx, s, 0, { distanceMeters: ex.distanceMeters! }, lead);
}
/** "Too heavy": one reduction of the next set's load within the trainer's rule. */
function tooHeavy(ctx: RunnerContext, s: RunnerState, exercise: number, set: number): [RunnerState, RunnerEffect[]] {
  const ex = ctx.script.exercises[exercise];
  if (!ex || set > ex.sets) return [s, [phrase("keep_weight", "Your trainer's plan keeps this weight.")]];
  const current = s.targets[exercise][set - 1];
  const floor = reducedLoad(ex.loadKg, ctx.rules);
  // The Brain's supportive line, once per session, after the code's answer.
  const struggle = !s.struggleSaid && ctx.script.brain?.struggle ? ctx.script.brain.struggle : null;
  const supported = struggle ? { ...s, struggleSaid: true } : s;
  const support = struggle ? [say([struggle], [], [], false)] : [];
  if (floor === null || current.loadKg <= floor)
    return [
      supported,
      [
        phrase("keep_weight", "Your trainer's plan keeps this weight. Say pain if something hurts."),
        ...support,
        outcome({ type: "too_heavy_kept", exercise, set }),
      ],
    ];
  const targets = s.targets.map((row, i) =>
    i === exercise ? row.map((t, k) => (k >= set - 1 ? { ...t, loadKg: Math.min(t.loadKg, floor) } : t)) : row,
  );
  const clips = numberClipKeys(floor);
  return [
    { ...supported, targets },
    [
      {
        type: "say",
        items: [{ clip: "lighter" }, ...(clips ? [...clips, "kilograms"] : ["check_screen"]).map((clip) => ({ clip }))],
        text: `Lighter weight for the next set: ${formatLoad(floor)} kilograms.`,
        wait: false,
      },
      ...support,
      outcome({ type: "adjusted", exercise, set, fromKg: current.loadKg, toKg: floor }),
    ],
  ];
}

/**
 * The set a "not done" reply is about: the one just finished during a rest (or
 * the cool-down), the one before the current set when the reply points back
 * ("the last one"), otherwise the current set. Null before any set.
 */
function referencedSet(ctx: RunnerContext, s: RunnerState, previous: boolean) {
  const exercises = ctx.script.exercises;
  const before = (exercise: number, set: number) =>
    set > 1
      ? { exercise, set: set - 1 }
      : exercise > 0
        ? { exercise: exercise - 1, set: exercises[exercise - 1].sets }
        : null;
  const current = { exercise: s.exercise, set: s.set };
  switch (s.phase === "paused" ? s.resume : s.phase) {
    case "rest":
      return current;
    case "set":
      return previous ? (before(s.exercise, s.set) ?? current) : current;
    case "setup":
      return previous ? before(s.exercise, 1) : null;
    case "cooldown": {
      const last = exercises.length - 1;
      return last >= 0 ? { exercise: last, set: exercises[last].sets } : null;
    }
    default:
      return null;
  }
}
/**
 * "I didn't do the last one": nothing is logged, nothing is skipped and the
 * session does not move on. The trainer is told which set the member means
 * (`not_done`, with `logged` when the runner had logged it: the member
 * corrects that log on the workout page). "Too heavy" in the same reply is
 * handled as its own command.
 */
function notDone(
  ctx: RunnerContext,
  s: RunnerState,
  command: Extract<VoiceCommand, { type: "not_done" }>,
): [RunnerState, RunnerEffect[]] {
  const ref = referencedSet(ctx, s, command.previous === true);
  const record = outcome({
    type: "not_done",
    ...(ref ? { exercise: ref.exercise, set: ref.set, logged: s.logged.includes(key(ref.exercise, ref.set)) } : {}),
  });
  if (command.heavy && ["set", "rest", "setup"].includes(s.phase)) {
    const [next, heavy] = stepRunner(ctx, s, { type: "command", command: { type: "too_heavy" } });
    return [next, [...(heavy.some((e) => e.type === "say") ? [] : [noted()]), ...heavy, record]];
  }
  return [s, [noted(), record]];
}

/**
 * One transition. Returns the next state and the effects to perform in order.
 * Unknown or out-of-phase events leave the state unchanged.
 */
export function stepRunner(ctx: RunnerContext, s: RunnerState, event: RunnerEvent): [RunnerState, RunnerEffect[]] {
  if (s.phase === "stopped") return [s, []];
  if (event.type === "held")
    return [
      { ...s, phase: "stopped", resume: undefined, stopReason: "hold", restRemaining: 0 },
      [phrase("stopping", "Training is paused for your trainer's review.", true)],
    ];
  if (event.type === "command" && event.command.type === "pain")
    return stopForPain(s, event.command.transcript);
  if (s.phase === "finished") return [s, []];
  if (event.type === "end")
    return [
      { ...s, phase: "stopped", resume: undefined, stopReason: "member", restRemaining: 0 },
      [],
    ];
  if (event.type === "start") {
    if (s.phase !== "ready") return [s, []];
    return [{ ...s, phase: "intro" }, [say(ctx.script.intro), outcome({ type: "started" })]];
  }
  if (event.type === "command" && event.command.type === "not_done")
    return s.phase === "ready" ? [s, []] : notDone(ctx, s, event.command);
  if (s.phase === "paused") {
    if (event.type === "command" && ["resume", "done"].includes(event.command.type)) {
      const back = s.resume ?? "set";
      const resumed: RunnerState = { ...s, phase: back, resume: undefined };
      if (back === "set") {
        // A timed round whose clock had started carries on from where it stopped.
        if (timedExercise(ctx.script.exercises[s.exercise]) && typeof s.workLeft === "number")
          return [resumed, [phrase("resuming", "Resuming."), phrase("go", "Go.")]];
        const [, effects] = beginSet(ctx, resumed, s.exercise, s.set);
        return [resumed, [phrase("resuming", "Resuming."), ...effects]];
      }
      if (back === "setup") return beginExercise(ctx, resumed, s.exercise);
      if (back === "warmup") return [resumed, [say(ctx.script.warmup)]];
      if (back === "intro") return [resumed, [say(ctx.script.intro)]];
      if (back === "cooldown") return [resumed, [say([...ctx.script.cooldown, ctx.script.finish])]];
      return [resumed, [phrase("resuming", "Resuming.")]];
    }
    if (event.type === "command" && !["unknown", "ack"].includes(event.command.type))
      return [s, [phrase("paused", "Paused. Say resume when you are ready.")]];
    return [s, []];
  }
  if (event.type === "command" && event.command.type === "pause")
    return [
      { ...s, phase: "paused", resume: s.phase as Exclude<RunnerPhase, "paused"> },
      [phrase("paused", "Paused. Say resume when you are ready."), outcome({ type: "paused", exercise: s.exercise, set: s.set })],
    ];
  if (event.type === "command" && event.command.type === "unknown")
    return [s, [phrase("help", "Say done, a number of reps, too heavy, pause, skip or pain.")]];
  // An acknowledgement never moves the session on; during a set it earns a hint.
  if (event.type === "command" && event.command.type === "ack")
    return [
      s,
      s.phase === "set" && workMeasure(ctx.script.exercises[s.exercise]) === "reps" ? [sayDone()] : [],
    ];
  const ex = ctx.script.exercises[s.exercise];
  switch (s.phase) {
    case "ready":
      return [s, []];
    case "intro":
      if (event.type === "prompt_done" || (event.type === "command" && ["done", "resume", "skip"].includes(event.command.type))) {
        if (ctx.script.warmup.length) return [{ ...s, phase: "warmup" }, [say(ctx.script.warmup)]];
        return beginExercise(ctx, s, 0);
      }
      if (event.type === "command" && event.command.type === "repeat") return [s, [say(ctx.script.intro)]];
      return [s, []];
    case "warmup":
      if (event.type === "command") {
        if (["done", "resume", "skip", "reps"].includes(event.command.type)) return beginExercise(ctx, s, 0);
        if (event.command.type === "repeat") return [s, [say(ctx.script.warmup)]];
      }
      return [s, []];
    case "setup":
      if (event.type === "prompt_done" || (event.type === "command" && ["done", "resume"].includes(event.command.type)))
        return beginSet(ctx, s, s.exercise, 1);
      if (event.type === "command") {
        if (event.command.type === "repeat") return beginExercise(ctx, s, s.exercise);
        if (event.command.type === "too_heavy") return tooHeavy(ctx, s, s.exercise, 1);
        if (event.command.type === "skip") {
          if (!ctx.rules.allowSkip) return [s, [phrase("no_skip", "Your trainer's plan keeps this part. Say pain if something hurts.")]];
          const skipped = { ...s, set: ex.sets, skipped: [...s.skipped, ...Array.from({ length: ex.sets }, (_, k) => key(s.exercise, k + 1))] };
          return afterSet(ctx, skipped, [phrase("skipped", "Skipped."), outcome({ type: "skipped_exercise", exercise: s.exercise })], false);
        }
      }
      return [s, []];
    case "set": {
      const measure = workMeasure(ex);
      if (event.type === "tick") {
        const elapsed = { ...s, setElapsed: s.setElapsed + Math.max(0, event.seconds) };
        // The clock of a timed round: ten seconds, three-two-one, then time.
        if (measure !== "time" || typeof s.workLeft !== "number") return [elapsed, []];
        const before = s.workLeft,
          after = Math.max(0, before - Math.max(0, event.seconds));
        const next = { ...elapsed, workLeft: after };
        if (after === 0) return finishRound(ctx, next, [phrase("time_up", "Time.")]);
        const cues: RunnerEffect[] = [];
        if (ex.durationSeconds! >= 20 && before > 10 && after <= 10) cues.push(phrase("ten_seconds", "Ten seconds."));
        if (before > 3 && after <= 3) cues.push(phrase("countdown", "Three. Two. One."));
        return [next, cues];
      }
      // The round's prompt has been spoken: the clock starts.
      if (event.type === "prompt_done") {
        if (measure === "time" && typeof s.workLeft !== "number")
          return [{ ...s, workLeft: ex.durationSeconds!, setElapsed: 0 }, []];
        return [s, []];
      }
      if (event.type !== "command") return [s, []];
      switch (event.command.type) {
        // Only an explicit completion or a rep count logs the set.
        case "done":
          if (measure !== "reps") return finishRound(ctx, s);
          return logSet(ctx, s, s.targets[s.exercise][s.set - 1].reps);
        case "resume":
          return [s, measure === "reps" ? [sayDone()] : []];
        case "reps": {
          // A number means reps only for rep work; a round is simply done.
          if (measure !== "reps") return finishRound(ctx, s);
          const reps = Math.max(0, Math.min(200, Math.round(event.command.reps)));
          // A heard count that is implausible for the set is asked again.
          if (!event.command.typed && !plausibleReps(reps, s.targets[s.exercise][s.set - 1].reps)) return [s, [sayDone()]];
          if (!event.command.heavy) return logSet(ctx, s, reps);
          // "6 reps but it was heavy": the reps are logged as said, and the
          // heaviness is its own outcome (a lighter next set within the rule).
          if (s.set < ex.sets) {
            const [adjusted, adjust] = tooHeavy(ctx, s, s.exercise, s.set + 1);
            const [next, logged] = logSet(ctx, adjusted, reps);
            return [next, [...logged, ...adjust]];
          }
          const [next, logged] = logSet(ctx, s, reps);
          return [next, [...logged, outcome({ type: "too_heavy_kept", exercise: s.exercise, set: s.set })]];
        }
        case "too_heavy":
          return tooHeavy(ctx, s, s.exercise, s.set);
        case "too_easy":
          return [s, [noted(), outcome({ type: "too_easy", exercise: s.exercise, set: s.set })]];
        case "repeat":
          return [s, [setPrompt(ctx, s, s.exercise, s.set)]];
        case "skip": {
          if (!ctx.rules.allowSkip) return [s, [phrase("no_skip", "Your trainer's plan keeps this part. Say pain if something hurts.")]];
          const skipped = { ...s, workLeft: null, skipped: [...s.skipped, key(s.exercise, s.set)] };
          return afterSet(ctx, skipped, [phrase("skipped", "Skipped."), outcome({ type: "skipped_set", exercise: s.exercise, set: s.set })], false);
        }
      }
      return [s, []];
    }
    case "rest":
      if (event.type === "tick") {
        const before = s.restRemaining,
          after = Math.max(0, before - Math.max(0, event.seconds));
        const next = { ...s, restRemaining: after };
        if (after === 0) {
          const lead = [say([ex.restEnd], [], [], false)];
          return advance(ctx, next, lead);
        }
        const cues: RunnerEffect[] = [];
        if (ex.restSeconds >= 20 && before > 10 && after <= 10) cues.push(phrase("ten_seconds", "Ten seconds."));
        if (before > 3 && after <= 3) cues.push(phrase("countdown", "Three. Two. One."));
        return [next, cues];
      }
      if (event.type !== "command") return [s, []];
      switch (event.command.type) {
        case "done":
        case "resume":
        case "skip":
          return advance(ctx, { ...s, restRemaining: 0 });
        case "too_heavy":
          // After an exercise's final set there is no next set of it to lighten:
          // the feedback is kept for the trainer and the next exercise stays as planned.
          if (s.set >= ex.sets)
            return [s, [noted(), outcome({ type: "too_heavy_kept", exercise: s.exercise, set: s.set })]];
          return tooHeavy(ctx, s, s.exercise, s.set + 1);
        case "too_easy":
          return [s, [noted(), outcome({ type: "too_easy", exercise: s.exercise, set: s.set })]];
        case "repeat":
          return [s, [say([ex.rest], [], [], false)]];
      }
      return [s, []];
    case "cooldown":
      if (event.type === "prompt_done" || (event.type === "command" && ["done", "resume", "skip"].includes(event.command.type)))
        return [{ ...s, phase: "finished" }, [outcome({ type: "completed" }), { type: "finished" }]];
      return [s, []];
  }
  return [s, []];
}
/** A short description of where the runner is, for screen readers and the page. */
export function runnerStatus(ctx: RunnerContext, s: RunnerState) {
  const ex = ctx.script.exercises[s.exercise];
  const t = s.targets[s.exercise]?.[s.set - 1];
  switch (s.phase) {
    case "ready":
      return "Ready to start.";
    case "intro":
    case "warmup":
      return "Warming up.";
    case "setup":
      return `${ex.name}: getting ready.`;
    case "set": {
      const load = t.loadKg > 0 ? ` at ${formatLoad(t.loadKg)} kg` : "";
      const measure = workMeasure(ex);
      if (measure === "reps") return `${ex.name}, set ${s.set} of ${ex.sets}: ${t.reps} reps${load}.`;
      const round = ex.sets > 1 ? `, round ${s.set} of ${ex.sets}` : "";
      if (measure === "distance") return `${ex.name}${round}: ${formatDistance(ex.distanceMeters!)}${load}.`;
      return typeof s.workLeft === "number"
        ? `${ex.name}${round}: ${formatDuration(s.workLeft)} left.`
        : `${ex.name}${round}: ${formatDuration(ex.durationSeconds!)}${load}.`;
    }
    case "rest":
      return `Resting: ${s.restRemaining} seconds left.`;
    case "cooldown":
      return "Cooling down.";
    case "finished":
      return "Session complete.";
    case "paused":
      return "Paused.";
    case "stopped":
      return s.stopReason === "pain"
        ? "Stopped. Your trainer has been told."
        : s.stopReason === "member"
          ? "Session ended."
          : "Stopped for your trainer's review.";
  }
}
