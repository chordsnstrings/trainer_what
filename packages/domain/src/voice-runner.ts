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
  /** A rep count; `heavy` when the same reply also said it was too heavy. */
  | { type: "reps"; reps: number; heavy?: boolean }
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
    "[وب]?(?:ال)?دوار|[وب]?(?:ال)?غثيان|(?:ب|راح\\s*)?[ا]?ستفرغ\\p{L}*|[ا]?تقيا\\p{L}*|ترجيع|شد\\s*عضلي|[وب]?(?:ال)?تشنج\\p{L}*|" +
    "(?:في|فيه)?\\s*شي(?:ء)?\\s*(?:غلط|خطا)|" +
    "(?:انا\\s*(?:مو|مب|مش)|لست|ماني|مانيب)\\s*(?:بخير|زين|زينه|كويس|كويسه|تمام)|(?:مو|مب|مش)\\s*بخير|" +
    "(?:احس|حاس|حاسس|حاسه|اشعر)\\s*(?:اني|انني|بنفسي)?\\s*(?:مو|مب|مش|لست|غير|ماني)\\s*(?:بخير|زين|زينه|كويس|كويسه|تمام)",
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
    "اعد|اعيد|كرر|عيد|مره\\s+ثانيه|مره\\s+اخري|شنو|ايش|وش|وشو|شو|ماذا|(?:ما|لم)\\s*(?:سمعت|اسمع|فهمت|افهم)\\p{L}*",
);
// Only explicit completion words finish a set.
const COMPLETE = has(
  "done|finished|finish|complete|completed|that'?s\\s+it|that\\s+is\\s+it|did\\s+it|made\\s+it|nailed\\s+it|" +
    "تم|تمت|خلاص|خلصنا|انتهيت|انتهينا|(?:خلصت|كملت|اكملت|انهيت|انجزت)(?:ها|ه)?|سويتها|سويته",
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
// "couldn't finish it", "I missed that set", "I missed 3 reps", "لم أكمل",
// "لم أستطع إكمالها", "ما قدرت", "ما سويتها", "ما خلصتها".
const NOT_DONE_WORDS =
  "(?:didn'?t|did\\s+not|couldn'?t|could\\s+not|wasn'?t\\s+able\\s+to|was\\s+not\\s+able\\s+to|failed\\s+to|never)\\s+(?:(?:really|even|actually|quite|fully|get\\s+to|manage\\s+to)\\s+)?(?:do|finish|complete|manage|make|get\\s+through)\\p{L}*|" +
  "(?:missed|skipped)\\s+(?:(?:the|that|this|my)\\s+)?(?:last|previous|final|one|set|it|round|rep|reps)|" +
  "(?:missed|skipped)\\s+(?:\\p{N}+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a\\s+couple|a\\s+few)(?:\\s+(?:of\\s+)?(?:them|reps?|repetitions?))?|" +
  "[وف]?لم\\s*(?:ا|ن)?(?:كمل|نه|نهي|قم|فعل|عمل|سو|سوي|خلص|نجز)\\p{L}*|" +
  // Modern Standard "I could not (complete)": لم أستطع، لم أتمكن من، لم أقدر
  // على، ما استطعت. Gulf present "ما اقدر" stays a load complaint (TOO_HEAVY).
  "(?:[وف]?لم\\s*(?:استطع|اتمكن|اقدر|نستطع|نتمكن|نقدر)|[وف]?ما\\s*(?:استطعت|استطعنا|تمكنت|تمكنا))\\p{L}*(?:\\s*(?:من|علي))?(?:\\s*(?:اكمال|انهاء|اتمام|اداء|فعل|عمل)\\p{L}*)?|" +
  "[وف]?(?:ما|مب|مو)\\s*(?:قدرت|اقدرت|قدرنا)(?:\\s*(?:ا|ن)?(?:كمل|خلص|سوي|سو|نهي|رفع|شيل)\\p{L}*)?|" +
  "[وف]?(?:ما|مب)\\s*(?:سويت|سوينا)\\p{L}*|" +
  "[وف]?(?:ما|مب)\\s*(?:خلصت|كملت|انهيت|اكملت)(?:ها|ه)";
const [NOT_DONE, NOT_DONE_ALL] = hasAndEvery(NOT_DONE_WORDS);
// Still going, not a report: "not done yet", "I'm not finished", "almost
// there", "ما خلصت", "لسا ما خلصت", "لم أنته بعد". The completion word in it
// never logs a set.
const NOT_YET_WORDS =
  "(?:not|isn'?t|i'?m\\s+not|am\\s+not)\\s+(?:(?:quite|yet|really|fully)\\s+)?(?:done|finished|complete|completed|there)|" +
  "(?:haven'?t|have\\s+not|hasn'?t)\\s+(?:(?:quite|yet)\\s+)?(?:done|finished|completed)|not\\s+yet|still\\s+going|almost\\s+(?:done|there|finished)|" +
  "[وف]?(?:ما|لم|مب|مو|مش)\\s*(?:خلصت|خلصنا|كملت|اكملت|انتهيت|انهيت|انته|انتهي|اكمل)";
const [NOT_YET, NOT_YET_ALL] = hasAndEvery(NOT_YET_WORDS);
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
  B + "(?:" + NOT_DONE_WORDS + "|" + NOT_YET_WORDS + "|" + CANNOT_WORDS + ")(?:(?!" + CLAUSE_BREAK + ")[\\s\\S])*",
  "giu",
);
// A reply that says the set is still under way ("yet", "still", "لسا").
const STILL = has("yet|still|لسا|لسه|للحين|باقي|بعدني|مازلت|ما\\s*زلت|لازلت|لا\\s*زلت|بعد");
// A reply that points back to an earlier set.
const REFERS_BACK = has(
  "last|previous|earlier|before|الاخير|الاخيره|السابق|السابقه|فات|فاتت|قبل",
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
// more"): after these words, or before these, it is not a rep count.
const ONE_AFTER = new Set([
  "the", "this", "that", "last", "next", "first", "second", "third", "previous", "final", "other",
  "another", "each", "every", "any", "which", "same", "no", "a", "big", "hard", "easy", "heavy",
  "tough", "good", "new", "little", "wrong", "right",
]);
const ONE_BEFORE = new Set(["more", "of", "moment", "sec", "time", "thing", "again", "left"]);
// "The last two (reps)", "the last few", "the final reps" are reps of a set,
// not an earlier set: they never make a reply point back. "The last one" is
// the previous set, and "the last 2 sets" points back too.
const LAST_REPS = new RegExp(
  B +
    "(?:last|final)\\s+(?:[2-9٢-٩]|\\p{N}{2,}|" +
    [...Object.keys(UNITS), ...Object.keys(TENS)]
      .filter((w) => /^[a-z]+$/.test(w) && (UNITS[w] ?? TENS[w]) > 1)
      .join("|") +
    "|few|couple|reps?|repetitions?)" +
    E +
    "(?!\\s+(?:sets?|rounds?|exercises?)" +
    E +
    ")",
  "giu",
);
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const westernDigits = (text: string) =>
  text.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));
// A number is a rep count unless it names a set or exercise ("set 1 of 3") or
// a load or time ("60 kilograms", "30 seconds").
const NOT_REPS_BEFORE = new Set(["set", "sets", "of", "exercise", "round", "number", "مجموعه", "من"]);
const NOT_REPS_AFTER =
  /^(?:kg|kgs|kilo|kilos|kilogram|kilograms|lb|lbs|pound|pounds|percent|%|seconds?|secs?|minutes?|mins?|sets?|rounds?|كيلو|كيلوغرام|كيلوجرام|ثانيه|ثواني|دقيقه|دقائق|دقايق|مجموعه|مجموعات|جوله|جولات)$/u;
/** A number word, also after a joined Arabic "and"/"with" ("وعشرين", "بثماني"). */
function numberWord(token: string): { value: number; tens: boolean } | null {
  for (const t of [token, /^[وبف]\p{L}{2,}$/u.test(token) ? token.slice(1) : null]) {
    if (!t) continue;
    if (t in TENS) return { value: TENS[t], tens: true };
    if (t in UNITS) return { value: UNITS[t], tens: false };
  }
  return null;
}
function spokenNumber(folded: string): number | null {
  const tokens = westernDigits(folded)
    .split(/[^\p{L}\p{N}'%]+/u)
    .filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let value: number | null = null,
      width = 1,
      unit: string | undefined;
    const digits = /^(\d{1,3})(\p{L}*)$/u.exec(t);
    const word = digits ? null : numberWord(t);
    if (digits) {
      value = Number(digits[1]);
      unit = digits[2] || undefined;
    } else if (t in TEEN_UNITS && TEN_WORDS.has(tokens[i + 1] ?? "")) {
      value = TEEN_UNITS[t] + 10;
      width = 2;
    } else if (word?.tens) {
      // "twenty five"
      const next = tokens[i + 1];
      const units = next && next in UNITS && UNITS[next] < 10 ? UNITS[next] : 0;
      value = word.value + units;
      if (units) width = 2;
    } else if (word) {
      value = word.value;
      const next = tokens[i + 1] ?? "",
        after = tokens[i + 2] ?? "";
      if (value < 10 && TEN_WORDS.has(next)) {
        // "ثلاثة عشر" (13)
        value += 10;
        width = 2;
      } else if (value < 10 && next.startsWith("و") && numberWord(next)?.tens) {
        // "خمسة وعشرين" (25): the unit, then "and" with the tens.
        value += numberWord(next)!.value;
        width = 2;
      } else if (value < 10 && next === "و" && after in TENS) {
        value += TENS[after];
        width = 3;
      } else if (t === "one" && (ONE_AFTER.has(tokens[i - 1] ?? "") || ONE_BEFORE.has(next))) {
        continue;
      }
    }
    if (value === null) continue;
    unit ??= tokens[i + width];
    if (NOT_REPS_BEFORE.has(tokens[i - 1] ?? "") || (unit && NOT_REPS_AFTER.test(unit))) {
      i += width - 1;
      continue;
    }
    return value;
  }
  return null;
}

/**
 * Maps one spoken reply to a command. Pain and red-flag wording (the code floor
 * `safetySignal`, which also reads Arabic) always wins; the server re-screens
 * every transcript with the trainer's published policy as well. Plain
 * acknowledgements never complete a set (a negated one, "not okay" or "مو
 * زين", is not an acknowledgement), a negated completion ("I didn't finish",
 * "not done yet", "ما خلصت") never logs one, a number inside a negated clause
 * ("I didn't do the last 2 reps", "ما سويت آخر ثنتين", "I can't do 10") is
 * never a rep count, and a rep count wins over "heavy" in the same reply (the
 * heaviness is kept as a flag).
 */
export function parseVoiceCommand(transcript: string): VoiceCommand {
  const raw = String(transcript ?? "").slice(0, 500);
  const screened = screeningText(raw).trim().replace(/[-_]/g, " ");
  if (!screened) return { type: "unknown" };
  if (safetySignal(raw) || PAIN.test(screened))
    return { type: "pain", transcript: raw.trim() };
  const folded = screened.replace(INSTRUCTION, " ");
  const effort = folded.replace(NEGATED_EFFORT, " ");
  const heavy = TOO_HEAVY.test(effort);
  const skip = SKIP.test(folded),
    pause = PAUSE.test(folded);
  // A negated completion is never a completion. Said in the past tense it is a
  // report for the trainer; "not yet" or "still" means the set is under way.
  const negatedDone = NOT_DONE.test(folded),
    notYet = NOT_YET.test(folded);
  const still = (negatedDone || notYet) && STILL.test(folded);
  const notDone = !still && (negatedDone || (notYet && REFERS_BACK.test(folded)));
  const completion = folded.replace(NOT_DONE_ALL, " ").replace(NOT_YET_ALL, " ");
  // A number inside a negated clause is what was not done, never a count.
  const reps = spokenNumber(folded.replace(NEGATED_CLAUSE, " "));
  if (reps !== null && reps <= 200 && !skip && !pause)
    return heavy ? { type: "reps", reps, heavy: true } : { type: "reps", reps };
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
  if (COMPLETE.test(completion)) return { type: "done" };
  if (RESUME.test(folded)) return { type: "resume" };
  if (ACK.test(folded.replace(NEGATED_ACK, " ")) || notYet || negatedDone) return { type: "ack" };
  return { type: "unknown" };
}

/**
 * The transcript to act on when one reply was transcribed in both languages.
 * Cartesia's batch model is told the language and cannot detect it, and a
 * reply in the other language comes back as unrelated words (live check, 29
 * September 2026: Arabic "ألم" read as English was "I"; English "Pain." read
 * as Arabic was "أمي"). The first transcript is in the member's reply
 * language; another is used only when the first was not understood (unknown,
 * or a bare acknowledgement, which never acts) and that one was. Pain and red
 * flags are screened in every transcript before this, so a pain report in
 * either language always stops the session.
 */
export function replyTranscript(transcripts: string[]): string {
  const heard = transcripts.map((t) => String(t ?? "").trim());
  const quiet = (t: string) => !t || ["unknown", "ack"].includes(parseVoiceCommand(t).type);
  const first = heard[0] ?? "";
  if (quiet(first)) {
    const understood = heard.slice(1).find((t) => !quiet(t));
    if (understood) return understood;
  }
  return first || heard.find(Boolean) || "";
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
/** A set prompt; an adjusted target is composed from shared clips. */
function setPrompt(ctx: RunnerContext, s: RunnerState, exercise: number, set: number): RunnerEffect {
  const ex = ctx.script.exercises[exercise];
  const t = s.targets[exercise][set - 1];
  const form = set >= 2 && ex.form.length ? ex.form[(set - 2) % ex.form.length] : null;
  if (t.reps === ex.reps && t.loadKg === ex.loadKg)
    return say([ex.setLines[set - 1], form]);
  if (workMeasure(ex) !== "reps") {
    // A lighter load for a loaded carry or hold: the round and the new load.
    const load = numberClipKeys(t.loadKg);
    return {
      type: "say",
      items: [
        { clip: set === ex.sets ? "last_set" : "next_set" },
        ...(load ? [...load, "kilograms"] : ["check_screen"]).map((clip) => ({ clip })),
        ...(timedExercise(ex) ? [{ clip: "go" }] : []),
        ...(form ? [{ line: form.id }] : []),
      ],
      text: [`Round ${set} of ${ex.sets}. ${spokenWork(ex, t.loadKg)}.${timedExercise(ex) ? " Go." : " Say done when you finish."}`, form?.text]
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
    items: [...clips.map((clip) => ({ clip })), ...(form ? [{ line: form.id }] : [])],
    text: [text, form?.text].filter(Boolean).join(" "),
    wait: true,
  };
}
function beginExercise(ctx: RunnerContext, s: RunnerState, exercise: number): [RunnerState, RunnerEffect[]] {
  const ex = ctx.script.exercises[exercise];
  const next: RunnerState = { ...s, phase: "setup", exercise, set: 1, restRemaining: 0, setElapsed: 0 };
  return [next, [say([ex.setup, ex.cueLine, ex.form[0]])]];
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
  return [
    { ...s, phase: "rest", restRemaining: ex.restSeconds, setElapsed: 0 },
    [...lead, say([ex.rest], [], [], false)],
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
  if (floor === null || current.loadKg <= floor)
    return [
      s,
      [
        phrase("keep_weight", "Your trainer's plan keeps this weight. Say pain if something hurts."),
        outcome({ type: "too_heavy_kept", exercise, set }),
      ],
    ];
  const targets = s.targets.map((row, i) =>
    i === exercise ? row.map((t, k) => (k >= set - 1 ? { ...t, loadKg: Math.min(t.loadKg, floor) } : t)) : row,
  );
  const clips = numberClipKeys(floor);
  return [
    { ...s, targets },
    [
      {
        type: "say",
        items: [{ clip: "lighter" }, ...(clips ? [...clips, "kilograms"] : ["check_screen"]).map((clip) => ({ clip }))],
        text: `Lighter weight for the next set: ${formatLoad(floor)} kilograms.`,
        wait: false,
      },
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
