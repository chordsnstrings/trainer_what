// The code safety floor: deterministic red-flag screening, enforced in code
// before any model or paid gate, for every member-written text (chat, support,
// set notes, check-ins, plan inputs, meal-plan notes, voice transcripts). It is
// deliberately conservative: any match pauses training for trainer review.
// Pure and browser-safe (the voice runner and the web app use it too), so
// boundaries avoid lookbehind.
//
// Only plain routine negations ("no pain", "pain-free") are removed, and only
// when nothing qualifies them: a contrast, exception, time, condition or
// painkiller cue later in the same sentence (or a contrast opening the next
// one), a physical symptom anywhere in the message, or a negation of the
// phrase itself ("not pain-free") keeps the report screened. Arabic text is
// folded first so hamza, madda, ta marbuta, alef maqsura, diacritics and
// tatweel variants are screened alike; "الأم" (the mother) is set apart before
// folding so it is not read as "الام" (pains).
//
// Beyond words, the floor reads the clinical numbers members report (blood
// pressure, blood sugar in mg/dL or mmol/L, Latin or Arabic-Indic digits) and
// phrase patterns that are only red flags in combination (a pop with
// swelling, skipped meals with compensatory training), in English, Modern
// Standard Arabic and Gulf Arabic.
export function screeningText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/(^|[^\p{L}\p{N}])([وفبك]?)الأم(?![\p{L}\p{N}])/gu, "$1$2ام")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[ىی]/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/ة/g, "ه")
    .replace(/[’‘`]/g, "'")
    .toLowerCase();
}
/**
 * What the floor holds for. The first four are the original word screen;
 * the rest read clinical readings and combined signals. A trainer sees the
 * category on the hold (screening.floorCategories).
 */
export const RED_FLAG_CATEGORIES = Object.freeze([
  "pain",
  "urgent",
  "pregnancy",
  "self_harm",
  "blood_pressure",
  "blood_sugar",
  "pregnancy_warning",
  "joint_injury",
  "eating_disorder",
] as const);
export type RedFlagCategory = (typeof RED_FLAG_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Routine negations
// ---------------------------------------------------------------------------
// Cues that contradict a routine negation. Contrast and exception cues also count
// when they open the next sentence ("No pain. Only when I squat.").
const contrastCue =
  "except|unless|until|till|apart|other\\s+than|besides|but|however|only|though|although|yet|still|" +
  "[وف]?(?:لكن(?:ي|ه|ها|نا)?|بس|الا|غير|ماعدا|ما\\s*عدا|عدا|سوي|فقط|رغم|مع\\s*ان|مازال|ما\\s*زال|لازال|لا\\s*زال|لسه|لسا|للحين|باقي)";
const conditionCue =
  "when|whenever|while|if|then|now|after|afterwards?|before|sometimes|occasionally|mostly|relief|killers?|meds?|medications?|pills?|" +
  "[وف]?(?:عندما|حين|حينما|لما|وقت|اذا|لو|بعد|بعدين|ثم|قبل|الحين|الان|حاليا|امس|البارحه?|احيانا|مسكن(?:ات)?|دواء|ادويه|حبوب)";
const symptomCue =
  "ach(?:e|es|ed|ing|y)|swell(?:s|ing)?|swollen|bruis(?:e|ed|es|ing)|sharp|stabbing|shooting|burning|throbb(?:ing|ed|s)?|twinges?|tweak(?:ed|ing)?|pop(?:s|ped|ping)?|click(?:s|ed|ing)?|gave\\s+(?:out|way)|giv(?:es|ing)\\s+(?:out|way)|tingl(?:e|es|ed|ing)|cramp(?:s|ed|ing)?|tender(?:ness)?|" +
  "[وفب]?(?:ال)?(?:ورم|متورمه?|تورم|انتفاخ|منتفخه?|كدمه|كدمات|طقه|طقطقه|وخز|وخزه|حرقان|تشنج)";
// A sentence ends at ! ? ؟, a line break, or a full stop that is not a decimal point.
const sentenceChar = "(?:[^.!?؟\\n]|\\.(?=\\p{N}))",
  sentenceEnd = "(?:[!?؟\\n]|\\.(?!\\p{N}))";
const routineNegation = new RegExp(
  "(^|[^\\p{L}\\p{N}])(?:(?:no|zero)\\s+(?:pains?|injur(?:y|ies))|(?:pain|injury)[\\s-]?free|(?:ما\\s*فيه?|مافيه?|لا\\s*يوجد|ما\\s*عندي|ماعندي|ليس\\s*لدي|(?:ما|لا)\\s*(?:احس|اشعر)\\s*ب)\\s*(?:اي\\s*)?(?:ال)?(?:الم|الام|وجع|اوجاع))(?![\\p{L}\\p{N}])" +
    "(?!" +
    sentenceChar +
    "*?(?:[^\\p{L}\\p{N}.!?؟\\n](?:" +
    contrastCue +
    "|" +
    conditionCue +
    ")|" +
    sentenceEnd +
    "[^\\p{L}\\p{N}]*?(?:" +
    contrastCue +
    "))(?![\\p{L}\\p{N}]))",
  "giu",
);
const symptomMentioned = new RegExp(
  "(?:^|[^\\p{L}\\p{N}])(?:" + symptomCue + ")(?![\\p{L}\\p{N}])",
  "u",
);
const negatedBefore =
  /(?:^|[^\p{L}])(?:not|never|no\s+longer|\p{L}+n't)\s+(?:\p{L}+\s+)?$/u;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Folds the Arabic letters of a pattern exactly as screeningText folds text,
 * so patterns can be written in ordinary spelling. Patterns use lower-case
 * escapes only, so nothing else needs folding.
 */
const ar = (pattern: string) =>
  pattern
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[ىی]/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/ة/g, "ه");
const B = "(^|[^\\p{L}\\p{N}])",
  E = "(?![\\p{L}\\p{N}])";
/** Arabic clitics (and, so, with, for, like) and the article before a word. */
const AC = "[وفبلك]{0,2}(?:ال)?";
/**
 * A word-bounded alternation of English and (folded) Arabic alternatives;
 * every Arabic alternative may take clitics and the article. Group 1 is the
 * boundary before the match.
 */
const words = (english: string, arabic = "") =>
  new RegExp(
    B +
      "(?:" +
      [english, arabic && AC + "(?:" + ar(arabic) + ")"]
        .filter(Boolean)
        .join("|") +
      ")" +
      E,
    "gu",
  );
const has = (re: RegExp, text: string) => {
  re.lastIndex = 0;
  const found = re.test(text);
  re.lastIndex = 0;
  return found;
};
// A negation just before a finding ("no swelling", "no pain or swelling",
// "isn't swollen", "ما فيه ورم") reads it as absent. Only symptom words and
// determiners may sit between the negation and the finding, so "not sure but
// my knee is swollen" is still screened.
const NEGATED_PREFIX = new RegExp(
  "(?:^|[^\\p{L}\\p{N}'])(?:no|not|without|zero|never|nor|hardly\\s+any|\\p{L}+n't|[وف]?" +
    ar(
      "(?:ما|لا|مو|مش|مب|ليس|ليست|بدون|بلا|ماكو|مافي|مافيه|ما\\s*في|ما\\s*فيه|لا\\s*يوجد|لا\\s*توجد|ما\\s*عندي|ماعندي|ولا|لم|لن|ما\\s*صار|ما\\s*حسيت\\s*ب|ما\\s*احس\\s*ب|ما\\s*لاحظت|ما\\s*شفت)",
    ) +
    ")\\s*(?:(?:any|much|real|visible|obvious|more|signs?\\s+of|further|the|a|my|pain|bruising|redness|heat|locking|clicking|" +
    ar("اي|أي|فيه|في|عندي|ال?الم|وجع|كدمات|احمرار") +
    ")\\s*(?:,|or|and|nor|" +
    ar("و|او|ولا") +
    ")?\\s*){0,3}$",
  "u",
);
/** A match of `re` (global, group 1 = boundary) that no negation precedes. */
function unnegated(re: RegExp, text: string) {
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index + (m[1]?.length ?? 0);
    if (!NEGATED_PREFIX.test(text.slice(Math.max(0, start - 60), start)))
      return true;
  }
  return false;
}
/** Arabic-Indic and extended Arabic-Indic digits read as Latin digits. */
export function latinDigits(text: string) {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/(\d)\u066B(?=\d)/g, "$1.")
    .replace(/(\d)\u066C(?=\d)/g, "$1");
}

// ---------------------------------------------------------------------------
// The word screen (categories pain, urgent, pregnancy, self_harm)
// ---------------------------------------------------------------------------
// The original English and Arabic red-flag words, by category, plus later
// variants (chest tightness phrasings, breathlessness at rest, stroke signs,
// self-harm wording, Gulf chest tightness and dizziness idioms).
const englishWords: Record<
  "pain" | "urgent" | "pregnancy" | "self_harm",
  string
> = {
  pain: "pain(?:s|ful|killers?)?|hurt(?:s|ing)?|injur(?:e|ed|y|ies)|sprain(?:s|ed)?|pulled\\s+(?:a\\s+|my\\s+)?muscle|numb(?:ness)?",
  urgent:
    "chest\\s+(?:pains?|tightness|pressure)|faint(?:s|ed|ing)?|pass(?:ed|es|ing)?\\s+out|black(?:ed|ing)?\\s+out|blackouts?|lost\\s+consciousness|unconscious|collaps(?:e|ed|es|ing)|dizz(?:y|iness)|light[\\s-]?headed(?:ness)?|vertigo|short(?:ness)?\\s+of\\s+breath|(?:can'?t|cannot|can\\s+not|couldn'?t|could\\s+not)\\s+breathe|hard\\s+to\\s+breathe|(?:trouble|difficulty|struggling)\\s+(?:to\\s+)?breath(?:e|ing)|palpitations?|irregular\\s+heart\\s*beats?|heart\\s+flutter(?:s|ing)?|heart\\s+attack|bleed(?:s|ing)?|bled|severe\\s+headache|seizures?|" +
    // Chest tightness and pressure in other word orders.
    "(?:tight(?:ness)?|pressure|squeez(?:e|ing)|heaviness|discomfort|crushing)\\s+(?:in|on|across|around)\\s+(?:my|the)\\s+chest|(?:a|my)\\s+tight\\s+chest|chest\\s+(?:feels?|felt|is|was|gets?|got|went|has\\s+been|keeps?\\s+getting)\\s+(?:(?:really|very|so|a\\s+bit|a\\s+little|kind\\s+of|kinda|all)\\s+)?(?:tight|heavy|squeezed|crushed)|" +
    // Breathlessness at rest or on minimal effort (not after a sprint).
    "(?:out\\s+of\\s+breath|breathless(?:ness)?|can'?t\\s+catch\\s+my\\s+breath|gasping(?:\\s+for\\s+(?:air|breath))?|wheez(?:e|es|ing))\\s+(?:\\p{L}+\\s+){0,3}?(?:at\\s+rest|while\\s+(?:resting|sitting|lying)|resting|sitting|lying|in\\s+bed|at\\s+night|doing\\s+nothing|watching\\s+tv|on\\s+the\\s+(?:sofa|couch)|walking\\s+(?:slowly|up\\s+(?:the\\s+)?stairs)|climbing\\s+(?:the\\s+)?stairs|talking)|(?:at\\s+rest|while\\s+(?:resting|sitting|lying)|sitting\\s+(?:down|still)|lying\\s+down|in\\s+bed|on\\s+the\\s+(?:sofa|couch)|doing\\s+nothing)\\s+(?:\\p{L}+\\s+){0,3}?(?:out\\s+of\\s+breath|breathless|gasping|wheezing)|" +
    // Heartbeat that is irregular (not merely fast after effort).
    "skipp(?:ed|ing)\\s+beats?|heart\\s+(?:(?:is|was|keeps|kept)\\s+)?(?:skipping|beating\\s+irregularly|out\\s+of\\s+rhythm)|heart\\s+(?:(?:is|was|keeps)\\s+)?(?:racing|pounding)\\s+(?:at\\s+rest|while\\s+(?:resting|sitting|lying)|sitting\\s+(?:down|still)|lying\\s+down|for\\s+no\\s+reason)|" +
    // Near-fainting and stroke signs.
    "keeled\\s+over|vision\\s+(?:went|goes|going|turned)\\s+(?:black|dark|grey|gray|white)|(?:room|everything|world)\\s+(?:was\\s+|is\\s+|started\\s+|kept\\s+)?spinning|slurr(?:ed|ing)\\s+(?:speech|words)|(?:face|mouth)\\s+(?:is\\s+|was\\s+|started\\s+)?droop\\p{L}*|(?:weakness|numbness)\\s+(?:in|on|down)\\s+one\\s+side|sudden(?:ly)?\\s+(?:lost|losing|loss\\s+of)\\s+(?:my\\s+)?(?:vision|sight)|" +
    // Blood where it should not be (not blood tests, pressure or sugar).
    "(?:some|a\\s+little|a\\s+bit\\s+of|a\\s+spot\\s+of|traces?\\s+of|drops?\\s+of|brown|pink|fresh|bright\\s+red)\\s+blood(?!\\s+(?:work|tests?|pressure|sugar|glucose|results?|panel|donation|type|flow|orange|count))|blood\\s+(?:in\\s+my\\s+(?:underwear|pants|urine|pee|stool|poo|spit|vomit)|when\\s+i\\s+(?:wipe|wiped|pee|peed|cough|coughed))|(?:cough(?:ing|ed)?|vomit(?:ing|ed)?|throw(?:ing)?|threw|spitting|spat)\\s+up\\s+blood|(?:peeing|pooing|passing|passed)\\s+blood",
  pregnancy: "pregnan(?:t|cy)?|miscarr(?:y|iage|ied)",
  self_harm:
    "suicid(?:e|al)|self[\\s-]?harm(?:ing)?|kill\\s+myself|end\\s+my\\s+life|want\\s+to\\s+die|" +
    "(?:hurt(?:ing)?|harm(?:ing)?|cut(?:ting)?|burn(?:ing)?)\\s+myself(?!\\s+(?:some\\s+)?(?:slack|a\\s+break|off|short|out|down|in|deadlifting|lifting|training))|(?:don'?t|do\\s+not|no\\s+longer)\\s+want\\s+to\\s+(?:live(?!\\s+(?:on|off|in|at|with|near|there|here|abroad|without))|be\\s+alive|be\\s+here\\s+anymore|exist|wake\\s+up(?!\\s+(?:early|at|so|before|for|to|in))|go\\s+on\\s+(?:living|anymore|like\\s+this))|no\\s+(?:reason|point)\\s+(?:to|in)\\s+(?:live|living|going\\s+on|being\\s+alive)|better\\s+off\\s+(?:dead|without\\s+me)|end\\s+it\\s+all|take\\s+my\\s+(?:own\\s+)?life|wish\\s+i\\s+(?:was|were)\\s+dead|wanna\\s+die",
};
// Arabic is already folded (see screeningText); clitics and the article may lead.
const arabicWords: Record<
  "pain" | "urgent" | "pregnancy" | "self_harm",
  string
> = {
  pain: "الم|الام|[يت]ولم(?:ني|ه|ها|ك|نا)?|[اين]?تالم|[يت]?وجع(?:ني|ي|ه|ها|ك|نا)?|اوجاع|موجوعه?|[يت]عور(?:ني|ه|ها|ك|نا)?|عورني|اصابه|اصابات|مصابه?|التواء|ملتويه?|تمزق|تنميل|خدر",
  urgent:
    "ضيق\\s*(?:في\\s*|ب)?(?:ال)?(?:صدر|تنفس|نفس)ي?|صعوبه\\s*(?:في\\s*|ب)?(?:ال)?تنفس|(?:لا|ما|مو|مش|لم)\\s*(?:اقدرت?|قدرت|استطيع|استطعت|استطع|قادره?)\\s*(?:علي\\s*)?(?:ال|ا)?تنفس|[ايتن]?دوخ(?:ه|ان|ني|تني|ت)?|دايخه?|اغماء?|اغمي\\s*علي(?:ه|ها|ا)?|فقد(?:ت|ان)?\\s*(?:ال)?وعي|غيبوبه|نزيف|[يت]?نزف(?:ت|ني)?|خفقان|(?:تسارع|سرعه)\\s*(?:في\\s*)?(?:ال)?(?:ضربات|دقات|نبضات)\\s*(?:ال)?قلبي?|نوبه\\s*قلبيه|جلطه|صداع\\s*شديد|" +
    // Chest tightness (Gulf "كتمة"), a heavy or squeezed chest.
    "كتمه\\s*(?:في\\s*|ب|علي\\s*)?(?:ال)?صدر(?:ي)?|(?:احس|حاس|حاسه|عندي|جاتني|جتني)\\s*(?:ب)?كتمه|صدري\\s*(?:ضايق|مكتوم|ثقيل|يضغط(?:ني)?|مشدود|يعصر(?:ني)?)|ثقل\\s*(?:في\\s*|ب|علي\\s*)?(?:ال)?صدر(?:ي)?|(?:ضغط|عصره|عصر)\\s*(?:في|علي)\\s*صدري|" +
    // Breathless at rest ("وأنا جالس"), an abnormal heartbeat.
    "(?:انهج|الهث|نفسي\\s*(?:مقطوع|ينقطع|قاطع)|انقطع\\s*نفسي|(?:ما|لا)\\s*(?:اقدر|قادر|قادره)\\s*(?:اخذ|اخد)\\s*نفسي)\\s*(?:\\S+\\s+){0,3}?(?:وانا|و\\s*انا)\\s*(?:جالس|جالسه|قاعد|قاعده|مرتاح|مرتاحه|نايم|نايمه|ساكت|ساكته)|(?:قلبي|نبضي|ضربات\\s*قلبي|دقات\\s*قلبي)\\s*(?:[يت]دق|[يت]خفق|يضرب|سريع(?:ه)?|[يت]تسارع)\\s*(?:بسرعه\\s*)?(?:غريبه|غريب|غير\\s*طبيعيه|مو\\s*طبيعيه|غير\\s*منتظمه|مو\\s*منتظمه|وانا\\s*(?:جالس|جالسه|قاعد|قاعده|مرتاح|مرتاحه|نايم|نايمه))|(?:قلبي|نبضي|ضربات\\s*قلبي)\\s*(?:غير|مو|مش)\\s*منتظم(?:ه)?|" +
    // Near-fainting ("the world spun / went black"), losing consciousness, stroke signs.
    "غبت\\s*عن\\s*(?:ال)?وعي|غاب\\s*(?:عني\\s*)?(?:ال)?وعي|سقطت\\s*مغشيا|(?:ال)?دنيا\\s*(?:[تد]لف|لفت|دارت|تدور|سودت|اظلمت)|اسودت\\s*(?:ال)?دنيا|كنت\\s*(?:بطيح|راح\\s*اطيح|بسقط|راح\\s*اسقط)|شوي\\s*و\\s*(?:طحت|اطيح|اغمي|يغمي)|كدت\\s*(?:ان\\s*)?(?:اسقط|افقد\\s*(?:ال)?وعي|يغمي)|انهرت|ثقل\\s*(?:في\\s*)?(?:ال)?(?:لسان|كلام)|(?:فقدت|فقدان)\\s*(?:ال)?(?:نظر|رؤيه|بصر)|" +
    // Blood when coughing or vomiting.
    "(?:[اتي]?كح|كحيت|سعال|[اتي]?تقيا|تقيات|استفرغت)\\s*(?:\\S+\\s+){0,1}?دم",
  pregnancy: "حامل|حوامل|اجهاض",
  self_harm:
    "انتحار|[اي]نتحر|اقتل\\s*نفسي|انهي\\s*حياتي|اوذي\\s*نفسي|ايذاء\\s*(?:ال)?نفس|" +
    "(?:ابي|ابغي|ابغا|اريد|ودي|بدي)\\s*(?:ان\\s*)?اموت(?!\\s*(?:من\\s*)?(?:ال)?(?:ضحك|جوع|تعب|حر|برد|وناسه|فرح|عطش|شوق|ملل|طفش))|اتمني\\s*(?:ال)?موت|اتمني\\s*(?:اني|لو)\\s*(?:اموت|ميت|مت)|(?:ما|لا|مو)\\s*(?:ابي|ابغي|اريد|ودي|بدي)\\s*(?:ان\\s*)?(?:(?:اعيش|احيا)(?!\\s*(?:علي|ع|ب|في|مع|بدون|هناك|هنا))|اكمل\\s*حياتي)|(?:اجرح|اضر|احرق)\\s*نفسي|جرحت\\s*نفسي|(?:ما\\s*(?:في|فيه|له)|لا\\s*يوجد)\\s*(?:فايده|داعي|معني)\\s*(?:من|ل)\\s*(?:ال)?(?:حياه|حياتي|عيش)|(?:تعبت|زهقت|مليت)\\s*من\\s*(?:ال)?حياه",
};
const wordScreens = (["pain", "urgent", "pregnancy", "self_harm"] as const).map(
  (category) =>
    [
      category,
      new RegExp(
        "(?:^|[^\\p{L}\\p{N}])(?:" +
          englishWords[category] +
          ")(?![\\p{L}\\p{N}])",
        "iu",
      ),
      new RegExp(
        "(?:^|[^\\p{L}\\p{N}])" +
          AC +
          "(?:" +
          ar(arabicWords[category]) +
          ")(?![\\p{L}\\p{N}])",
        "u",
      ),
    ] as const,
);

// ---------------------------------------------------------------------------
// Blood pressure
// ---------------------------------------------------------------------------
const BP_CONTEXT = words(
  "blood\\s*pressure|b\\.?\\s?p|systolic|diastolic|pressure|hypertensi\\p{L}*",
  "ضغط(?:ي|ه|ها|نا|ك)?|انقباضي|انبساطي",
);
// "175/105", "175 over 105", "١٧٥ على ١٠٥": plausible readings only, so dates
// and scores do not count.
const BP_READING =
  /(?:^|[^\d.,/])(\d{2,3})\s*(?:\/|\\|over|علي|فوق|-)\s*(\d{2,3})(?![\d/])/gu;
const BP_VERY_HIGH = words(
  "(?:blood\\s*pressure|bp|pressure)\\s+(?:(?:is|was|has\\s+been|went|got|shot|spiked|reads?|reading|came\\s+back|this\\s+morning|today|still|now)\\s+){0,3}(?:really|very|super|dangerously|extremely|crazy|way|so|too)\\s+(?:high|elevated|up)|(?:blood\\s*pressure|bp)\\s+(?:(?:is|was|went|has|just)\\s+)?(?:through\\s+the\\s+roof|sky[\\s-]?high|spiked|spiking|skyrocket\\p{L}*)|(?:really|very|dangerously|extremely|super)\\s+high\\s+(?:blood\\s*pressure|bp)|hypertensive\\s+(?:crisis|emergency|urgency)",
  "ضغط(?:ي|ه|ها)?\\s*(?:\\S+\\s+){0,2}?(?:مرتفع|عالي|طالع|رافع|مرتفعه|عاليه)\\s*(?:جدا|وايد|مره|كثير|حيل|بزياده|بشكل\\s*(?:كبير|خطير))|ارتفاع\\s*(?:شديد|حاد|كبير|مفاجئ|مفاجي)\\s*(?:في\\s*)?(?:ال)?ضغط",
);
// Warning symptoms that make any blood-pressure report urgent (chest pain and
// nosebleeds are red flags on their own).
const BP_SYMPTOM = words(
  "head\\s*aches?|headaches?|migraines?|(?:pounding|throbbing|splitting)\\s+head|head\\s+(?:is\\s+|was\\s+)?(?:pounding|throbbing|killing\\s+me)|(?:blurr(?:y|ed)|double|fuzzy)\\s+(?:vision|eyes?|sight)|vision\\s+(?:is\\s+|was\\s+|went\\s+|goes\\s+|gets\\s+|got\\s+)?(?:\\p{L}+\\s+)?(?:blurr\\p{L}*|fuzzy|dark|funny|weird|strange|spotty)|seeing\\s+(?:spots|stars|double|flashes|flashing)|nose\\s*bleeds?|nosebleeds?",
  "صداع|زغلل\\p{L}*|(?:ال)?رؤيه\\s*(?:مشوشه|ضبابيه|مزدوجه|مغبشه)|نظري\\s*(?:مشوش|ضبابي|يزغلل|مغبش)|تشوش\\s*(?:في\\s*)?(?:ال)?(?:رؤيه|نظر)|اشوف\\s*(?:نجوم|نقاط|مزدوج|ضباب)|رعاف|راسي\\s*(?:ي|ت)?(?:عور|وجع|الم|ينبض|يدق|بينفجر|ينفجر|يعورني)|(?:وجع|الم)\\s*(?:في\\s*)?(?:ال)?راس(?:ي)?",
);
// A raised or known high pressure: with a warning symptom it is a red flag.
const BP_RAISED = words(
  "high\\s+blood\\s*pressure|hypertensi\\p{L}*|(?:blood\\s*pressure|bp|pressure)\\s+(?:(?:is|was|has\\s+been|went|got|feels?)\\s+){0,2}(?:high|up|elevated|raised)",
  "ضغط(?:ي|ه|ها)?\\s*(?:\\S+\\s+){0,1}?(?:مرتفع|عالي|طالع|رافع)(?:ه)?|ارتفاع\\s*(?:في\\s*)?(?:ال)?ضغط",
);
function bloodPressureFlag(t: string) {
  if (!has(BP_CONTEXT, t)) return false;
  if (has(BP_VERY_HIGH, t)) return true;
  let reading = false;
  BP_READING.lastIndex = 0;
  for (const m of t.matchAll(BP_READING)) {
    const systolic = Number(m[1]),
      diastolic = Number(m[2]);
    if (
      systolic < 70 ||
      systolic > 300 ||
      diastolic < 30 ||
      diastolic > 200 ||
      systolic <= diastolic
    )
      continue;
    if (systolic >= 160 || diastolic >= 100) return true;
    reading = true;
  }
  // Any reading, or a raised or known high pressure, with a warning symptom.
  return (reading || has(BP_RAISED, t)) && unnegated(BP_SYMPTOM, t);
}

// ---------------------------------------------------------------------------
// Blood sugar
// ---------------------------------------------------------------------------
// A glucose word followed (within a few linking words) by a number. Bare
// "sugar" needs a possessive ("my sugar"), so food sugar ("20 g of sugar",
// "added sugar under 25") is not read as a reading.
const GLUCOSE_WORD =
  "(?:blood\\s+(?:sugar|glucose)|glucose|bgl?|bsl|cgm|libre|dexcom|finger\\s*prick|(?:my|her|his|your)\\s+sugar(?:s)?|sugar\\s+(?:levels?|readings?)|" +
  ar(
    "(?:ال)?سكر(?:ي)?|(?:نسبه|مستوي|قراءه|قياس|تحليل)\\s*(?:ال)?سكر(?:ي)?|(?:ال)?(?:جلوكوز|غلوكوز)",
  ) +
  ")";
const GLUCOSE_LINK =
  "(?:levels?|readings?|was|is|were|has|had|been|at|of|around|about|only|just|like|dropped|dipped|fell|crashed|went|gone|down|up|spiked|hit|reached|to|this|morning|today|tonight|before|after|during|training|workout|session|exercise|the|my|a|it|when|i|checked|tested|measured|fasting|came|back|as|so|really|under|below|over|above|reads?|showed|showing|says|said|on|" +
  ar(
    "كان|كانت|صار|صارت|نزل|نزلت|طاح|هبط|ارتفع|وصل|وصلت|الي|علي|ع|عند|قبل|بعد|التمرين|اليوم|الصبح|الصباح|الحين|امس|البارحه|قراءه|قياس|مستوي|نسبه|في|الدم|عندي|فقط|بس|تقريبا|حوالي|يقرا|يقول|طلع|طلعت|تحت|هو|صايم|صايمه|وانا",
  ) +
  ")";
const GLUCOSE_UNIT =
  "(mg\\s*/?\\s*dl|mg|mmol(?:\\s*/\\s*l)?|" +
  ar("ملغ|مغ|مجم|ملجم|ملي\\s*مول|مليمول|ملم") +
  ")?";
const GLUCOSE_NOT_UNIT =
  "(?!\\s*(?:g|gr|grams?|kcal|cal|calories|%|percent|tsp|tbsp|teaspoons?|tablespoons?|spoons?|cubes?|days?|weeks?|months?|hours?|hrs?|minutes?|mins?|seconds?|times|x|kg|kgs|kilos?|lbs?|pounds?|sets?|reps?|km|miles?|steps|years?|yrs?|am|pm|" +
  ar(
    "غرام|جرام|جم|غ|ملعقه|ملاعق|سعره|سعرات|يوم|ايام|اسبوع|ساعه|ساعات|دقيقه|دقايق|دقائق|مره|مرات|كيلو|كجم|سنه|سنوات|صباحا|مساء",
  ) +
  ")(?![\\p{L}]))";
const GLUCOSE_READING = new RegExp(
  B +
    GLUCOSE_WORD +
    "(?:\\s*[:=-]?\\s*" +
    GLUCOSE_LINK +
    "){0,5}\\s*[:=-]?\\s*(\\d{1,3}(?:[.,]\\d{1,2})?)(?![\\d.,]*\\d)\\s*" +
    GLUCOSE_UNIT +
    E +
    GLUCOSE_NOT_UNIT,
  "gu",
);
// Hypo- and hyperglycaemia said in words.
const GLUCOSE_WORDS = words(
  "hypo(?:glyc(?:a)?emi(?:a|c))?|hypos|low\\s+(?:blood\\s+)?(?:sugar|glucose)\\s+(?:levels?|readings?|episode|attack)|low\\s+blood\\s+(?:sugar|glucose)|(?:blood\\s+|my\\s+)(?:sugar|glucose)\\s+(?:(?:is|was|has|had|have|been|went|goes|keeps|kept|got|getting|going|running|suddenly|just|really|very|so|too|a\\s+bit|quite|always)\\s+){0,3}(?:low|down|dropp(?:ed|ing)|dipp(?:ed|ing)|crash(?:ed|ing)|tank(?:ed|ing)|plummet(?:ed|ing)|fell|falling)|hyperglyc(?:a)?emi(?:a|c)|(?:very|really|dangerously|super|extremely)\\s+high\\s+(?:blood\\s+)?(?:sugar|glucose)|(?:blood\\s+|my\\s+)(?:sugar|glucose)\\s+(?:(?:is|was|went|has\\s+been|shot|spiked)\\s+){1,2}(?:really|very|so|super|dangerously|extremely|way)\\s+(?:high|up)|(?:diabetic\\s+)?ketoacidosis|dka",
  "(?:هبوط|انخفاض|نزول)\\s*(?:في\\s*)?(?:ال)?سكر(?:ي)?|(?:ال)?سكر(?:ي)?\\s*(?:عندي\\s*)?(?:نازل|طايح|منخفض|واطي|هابط|نزل|طاح|هبط|انخفض)|(?:نزل|طاح|هبط|انخفض)\\s*(?:عندي\\s*|علي\\s*)?(?:ال)?سكر(?:ي)?|(?:ارتفاع|ارتفع)\\s*(?:شديد|حاد|كبير|مفاجئ)?\\s*(?:في\\s*)?(?:ال)?سكر(?:ي)?\\s*(?:جدا|وايد|مره|كثير|حيل)|(?:ال)?سكر(?:ي)?\\s*(?:مرتفع|عالي|طالع|رافع)(?:ه)?\\s*(?:جدا|وايد|مره|كثير|حيل)",
);
// Shaky, sweaty or confused with diabetes (or a glucose word) in the message.
// "Confused about my insulin timing" is a question, not a symptom.
const HYPO_SYMPTOM = words(
  "shak(?:y|ing|es|iness)|trembl(?:e|es|ing|y)|jittery|sweat(?:y|ing)|clammy|cold\\s+sweats?|confused(?!\\s+(?:about|by|with|as\\s+to|on|why|what|how|whether|if|which|when|over))|confusion(?!\\s+(?:about|over|on))|disoriented",
  "(?:رجفه|رعشه|ارتجاف|ارتعاش|رجفان|ارجف|اترجف|ترجف|يرجف|ارتجف|ارتجفت|مرتجف|مرتجفه|ارتعش|ارتعشت|مرتعش|مرتعشه|اتعرق|تعرق|تعرقت|عرقان|عرقانه|عرق\\s*بارد)",
);
const DIABETES_CONTEXT = words(
  "diabet\\p{L}*|insulin|metformin|gliclazide|glipizide|sulfonylureas?|glucose|blood\\s+sugar|my\\s+sugar|hypo\\p{L}*|t[12]d|type\\s*[12]|cgm|libre|dexcom",
  "سكري|سكر|انسولين|ميتفورمين|جلوكوفاج|جلوكوز|هبوط",
);
function glucoseFlag(
  value: number,
  unit: string | undefined,
  decimal: boolean,
) {
  const mmol = unit ? /mmol|مول|ملم/u.test(unit) : decimal || value <= 30;
  return mmol ? value < 3.9 || value >= 13.9 : value < 70 || value >= 250;
}
function bloodSugarFlag(t: string) {
  if (has(GLUCOSE_WORDS, t)) return true;
  GLUCOSE_READING.lastIndex = 0;
  for (const m of t.matchAll(GLUCOSE_READING)) {
    const raw = m[2];
    const value = Number(raw.replace(",", "."));
    if (Number.isFinite(value) && glucoseFlag(value, m[3], /[.,]/.test(raw)))
      return true;
  }
  return has(DIABETES_CONTEXT, t) && unnegated(HYPO_SYMPTOM, t);
}

// ---------------------------------------------------------------------------
// Pregnancy warning signs (with or without the word "pregnant")
// ---------------------------------------------------------------------------
// "Spotting" is a red flag unless it is the gym sense (spotting a lift).
const SPOTTING = /(^|[^\p{L}\p{N}])spotting(?![\p{L}\p{N}])/gu;
const SPOTTER_AFTER =
  /^\s+(?:me|you|him|her|them|us|each\s+other|someone|somebody|people|others|a\s+(?:friend|partner|lifter|client|mate|buddy)|my\s+(?:friend|partner|mate|buddy|wife|husband|client|brother|sister)|the\s+(?:bar|lift|lifter|bench|squat|press)|(?:for|on|during|while)\s+(?:(?:the|my|a|his|her|your|their|heavy)\s+)?(?:bench\p{L}*|squat\p{L}*|lift\p{L}*|press\p{L}*|sets?|bar\p{L}*|deadlift\p{L}*|clients?|friends?|partners?|mates?|buddy|someone|him|her|them|me|you|people|others)|properly|correctly|safely|technique|tips|cues|position|necessary|required|needed|etiquette|arms?|hands|drills?|duty)(?![\p{L}\p{N}])/u;
function spottingFlag(t: string) {
  SPOTTING.lastIndex = 0;
  for (const m of t.matchAll(SPOTTING)) {
    const start = m.index + m[1].length;
    if (SPOTTER_AFTER.test(t.slice(start + "spotting".length))) continue;
    if (NEGATED_PREFIX.test(t.slice(Math.max(0, start - 60), start))) continue;
    return true;
  }
  return false;
}
// Contractions, unless they are muscle contractions.
const CONTRACTIONS = /(^|[^\p{L}\p{N}])contractions?(?![\p{L}\p{N}])/gu;
const MUSCLE_BEFORE =
  /(?:muscle|muscular|eccentric|concentric|isometric|isotonic|peak|maximal|max|voluntary|explosive|forceful|controlled|slow|fast|quad|quads|glute|glutes|core|ab|abs|abdominal|hamstring|calf|bicep|biceps|tricep|triceps|pelvic\s+floor|kegel|fibre|fiber|good|strong\s+(?:muscle|glute|quad))\s*$/u;
const MUSCLE_AFTER =
  /^\s+(?:of|in|through|from)\s+(?:the\s+|your\s+|my\s+)?(?:muscles?|glutes?|quads?|core|abs|hamstrings?|calves|calf|lats?|pecs?|biceps?|triceps?|pelvic\s+floor)/u;
function contractionsFlag(t: string) {
  CONTRACTIONS.lastIndex = 0;
  for (const m of t.matchAll(CONTRACTIONS)) {
    const start = m.index + m[1].length,
      end = start + m[0].length - m[1].length;
    const before = t.slice(Math.max(0, start - 30), start);
    if (MUSCLE_BEFORE.test(before) || MUSCLE_AFTER.test(t.slice(end))) continue;
    if (NEGATED_PREFIX.test(t.slice(Math.max(0, start - 60), start))) continue;
    return true;
  }
  return false;
}
const PREGNANCY_WARNING = words(
  "(?:my\\s+)?waters?\\s+(?:(?:has|have|just|may\\s+have|might\\s+have|think)\\s+)*(?:broke|broken|breaking)|(?:leak(?:ing|ed|s)?|gush(?:ing|ed)?|trickl(?:e|ing|ed))\\s+(?:of\\s+)?(?:(?:clear|some|a\\s+little|watery)\\s+)?(?:fluid|water|liquid)|(?:fluid|liquid)\\s+(?:is\\s+|was\\s+|keeps\\s+)?(?:leak(?:ing|ed)?|gush(?:ing|ed)?|trickl(?:ing|ed)|coming\\s+out)|amniotic|" +
    "(?:baby|bump|fetus|foetus)(?:'s)?\\s+(?:(?:is|has|was|been|really|much|a\\s+lot|suddenly|definitely)\\s+){0,2}(?:moving|kicking|moved|kicked)\\s+(?:(?:much|a\\s+lot|so\\s+much|way|far)\\s+)?less|(?:baby|bump|fetus|foetus)\\s+(?:hasn'?t|has\\s+not|isn'?t|is\\s+not|wasn'?t|was\\s+not|didn'?t|did\\s+not|doesn'?t|does\\s+not|not|stopped|has\\s+stopped|is\\s+barely|barely|hardly)\\s+(?:been\\s+|really\\s+)?(?:moving|kicking|moved|kicked|move|kick)|(?:less|fewer|reduced|decreased|no|not\\s+many|hardly\\s+any|barely\\s+any)\\s+(?:fetal|foetal|baby(?:'s)?)\\s+(?:movements?|kicks|kicking|moving)|(?:haven'?t|have\\s+not|didn'?t|did\\s+not|can'?t|cannot|couldn'?t|not)\\s+(?:felt|feel|feeling)\\s+(?:the\\s+|my\\s+)?baby\\s+(?:move|moving|kick|kicking)|" +
    "braxton[\\s-]?hicks|(?:going\\s+into|in)\\s+(?:early\\s+|pre-?term\\s+)?labou?r|pre-?term\\s+labou?r|early\\s+labou?r|pre-?eclampsia|(?:pelvic|vaginal)\\s+(?:pressure|bleeding|discharge)",
  // Arabic: spotting, blood, fluid leak, reduced fetal movement, contractions, pre-eclampsia.
  "تنقيط|نقط(?:ه|ات)?\\s*دم|قطر(?:ه|ات)\\s*دم|(?:دم|دماء)\\s*(?:خفيف(?:ه)?|بسيط(?:ه)?|بني|وردي)|نزول\\s*(?:ال)?دم|نزل\\s*(?:علي|مني|معي)?\\s*(?:\\S+\\s+)?دم|(?:شفت|لاحظت|رايت)\\s*(?:شوي(?:ه)?\\s*|بعض\\s*(?:ال)?)?دم|" +
    "نزول\\s*(?:ال)?(?:ماء|مويه|موي|سائل|سوائل|مياه)|(?:تسرب|تسريب|خروج)\\s*(?:ال)?(?:ماء|مويه|سائل|سوائل|مياه)|نزل\\s*(?:مني|علي)?\\s*(?:ماء|مويه|سائل|مياه)|(?:انفجر|انفجار|انكسر)\\s*(?:كيس\\s*)?(?:ال)?(?:ماء|مويه|مياه)|كيس\\s*(?:ال)?(?:ماء|مويه|مياه)\\s*(?:انفجر|نزل|انفتح)|(?:ال)?سائل\\s*(?:ال)?امنيوسي|" +
    "حرك(?:ه|ات)\\s*(?:ال)?(?:جنين|بيبي|طفل|ياهل)\\s*(?:\\S+\\s+){0,1}?(?:قلت|قليله|خفت|خفيفه|اقل|ضعيفه|وقفت|انعدمت|ما\\s*احسها)|(?:قله|قلت|نقص|ضعف|انعدام|توقف|تراجع)\\s*(?:في\\s*)?حرك(?:ه|ات)\\s*(?:ال)?(?:جنين|بيبي|طفل)|(?:ال)?(?:جنين|بيبي|طفل)\\s*(?:ما|لا|مو|مب)\\s*(?:عاد\\s*|قاعد\\s*)?(?:يتحرك|يرفس|تحرك|رفس|يدف)|(?:ما|لا|مو)\\s*(?:احس|حسيت|اشعر|شعرت|قاعده\\s*احس)\\s*(?:ب)?(?:حرك(?:ه|ات)\\s*)?(?:ال)?(?:جنين|بيبي|طفل)|" +
    "انقباضات(?!\\s*(?:ال)?(?:عضليه|عضلات|عضله|مركزيه|لامركزيه|ثابته|ايزومتريه))|(?:ال)?طلق\\s*(?:ال)?(?:مبكر|متكرر|منتظم|قوي|مستمر)|(?:بدا|بدء|جاني|اجاني|عندي|يجيني)\\s*(?:ال)?طلق|تقلصات\\s*(?:في\\s*)?(?:ال)?رحم|تقلصات\\s*(?:منتظمه|متكرره|قويه|كل)|ولاده\\s*مبكره|تسمم\\s*(?:ال)?حمل",
);
function pregnancyWarningFlag(t: string) {
  return (
    spottingFlag(t) || contractionsFlag(t) || unnegated(PREGNANCY_WARNING, t)
  );
}

// ---------------------------------------------------------------------------
// Joint injury: locking, giving way, a pop with swelling, sudden swelling
// ---------------------------------------------------------------------------
const JOINT =
  "knees?|kneecaps?|patellas?|hips?|ankles?|shoulders?|elbows?|wrists?|joints?|back|lower\\s+back|neck|spine|jaw|fingers?|thumbs?|toes?|leg|acl|mcl|meniscus";
// Where swelling is a red flag: joints and single limbs (calf or leg swelling
// is a clot sign). Arms after a pump, or a puffy face in the morning, are not;
// sudden swelling anywhere (face and hands in pregnancy) is.
const SWELL_PART = JOINT + "|calf|calves|foot|feet|hand|legs|arm|shin";
const JOINT_AR = ar(
  AC +
    "(?:ركبه|ركبتي|ركبتين|ركبتيني|ركبتك|ركبته|ركبتها|كاحل(?:ي|ك|ه|ها)?|كوع(?:ي|ك|ه)?|مرفق(?:ي|ك|ه)?|ورك(?:ي|ك|ه)?|حوض(?:ي)?|كتف(?:ي|ك|ه|ها)?|رسغ(?:ي)?|معصم(?:ي)?|مفصل(?:ي|ك|ه)?|مفاصل(?:ي)?|ظهري|رقبتي|رجلي|رجولي|ساقي)",
);
const JOINT_MENTION = new RegExp(
  "(?:^|[^\\p{L}\\p{N}])(?:" + JOINT + "|" + JOINT_AR + ")(?![\\p{L}\\p{N}])",
  "u",
);
const LEAD =
  "(?:(?:my|the|his|her|your|a|right|left|bad|injured|good|operated|other)\\s+)";
const JOINT_INJURY = words(
  // Locking or catching ("my knee locked", not "lock out your knees").
  LEAD +
    "{1,2}(?:" +
    JOINT +
    ")\\s+(?:(?:has|had|have|keeps?|kept|just|suddenly|then|got|gets|is|was|went|seems?\\s+to|started|starts|sometimes|still|also|kinda|kind\\s+of|completely|totally|fully|again|occasionally|randomly)\\s+){0,3}(?:lock(?:ed|s|ing)(?:\\s+up)?|lock\\s+up|seiz(?:ed|es|ing)\\s+up|jammed|(?:gets?|got|getting)\\s+stuck|catch(?:es|ing)|caught)(?!\\s+out)(?!\\s+(?:up\\s+)?(?:on|in)\\s+(?:the|my|a)\\s+(?:bar|rack|door|machine))|" +
    // Giving way ("my knee gave way", "my ankle gives out"; tired legs are not).
    LEAD +
    "{0,2}(?:knees?|kneecaps?|ankles?|hips?|joints?|shoulders?|leg)\\s+(?:(?:has|had|keeps?|kept|just|suddenly|then|sometimes|still|also|kind\\s+of|kinda|completely|totally|again|occasionally|randomly|would|will|seems?\\s+to|started\\s+to|starts\\s+to|is|was|has\\s+been|keeps?\\s+on)\\s+){0,3}(?:gave|gives|giving|give|gone|went)\\s+(?:way|out)|" +
    "(?:knees?|kneecaps?|ankles?|hips?|joints?|shoulders?)\\s+(?:(?:is|feels?|felt|seems?|was|has\\s+been|keeps?\\s+feeling|still|went|goes)\\s+){1,2}(?:(?:really|very|so|a\\s+bit|a\\s+little|kind\\s+of|kinda|totally)\\s+)?(?:unstable|loose|like\\s+it(?:'s|\\s+is|\\s+was)?\\s+(?:going\\s+to|gonna)\\s+(?:give|collapse|buckle|pop\\s+out))|" +
    "(?:knees?|ankles?|hips?|joints?)\\s+(?:(?:just|suddenly|keeps?|kept|sometimes)\\s+)?(?:buckl(?:ed|es|ing)|buckle|collapsed)(?!\\s+(?:in|inwards?|together))|unstable\\s+(?:knee|ankle|hip|shoulder|joint)|(?:knee|ankle|hip|shoulder|joint)\\s+instability|" +
    // Dislocation, ligament and tendon tears.
    "dislocat\\p{L}*|subluxat\\p{L}*|(?:" +
    JOINT +
    ")\\s+(?:(?:just|has|had|kind\\s+of|kinda|nearly|almost)\\s+)?(?:popped|slipped|pops|slips|came)\\s+out|(?:popped|slipped|came)\\s+out\\s+of\\s+(?:its\\s+|the\\s+)?(?:socket|place|joint)|" +
    "(?:tore|torn|ruptured?|rupturing|snapped)\\s+(?:(?:my|the|a|an|his|her)\\s+)?(?:(?:right|left|partial|partially|full|complete)\\s+)?(?:acl|mcl|pcl|lcl|meniscus|ligaments?|tendons?|achilles|rotator\\s+cuff|labrum|cartilage|hamstring|calf|pec|biceps?|quad)|(?:acl|mcl|pcl|lcl|meniscus|ligament|tendon|achilles|rotator\\s+cuff|labrum)\\s+(?:tear|rupture)|tore\\s+something|(?:a|the)\\s+(?:(?:small|partial|little|slight)\\s+)?tear\\s+in\\s+(?:my|the)\\s+(?:(?:right|left)\\s+)?(?:" +
    JOINT +
    "|calf|hamstring|achilles|quad|pec|bicep|groin|muscle|rotator\\s+cuff|ligament|tendon)|" +
    // One pop or snap in a joint or muscle ("heard a pop in my knee"), not "a pop of energy".
    "(?:heard|felt|there\\s+was|got|had)\\s+(?:a\\s+|this\\s+)?(?:(?:loud|big|sudden|sharp|little|small|massive|huge|weird|strange)\\s+)?(?:pop|snap|crack|clunk|tearing\\s+(?:feeling|sensation)|rip)\\s+(?:(?:in|from|at|on|inside)\\s+(?:my|the)\\s+(?:(?:right|left)\\s+)?(?:" +
    JOINT +
    "|calf|hamstring|achilles|quad|pec|bicep|groin|muscle|arm|foot)|when|as|while)|(?:" +
    JOINT +
    ")\\s+(?:(?:just|suddenly)\\s+)?(?:went|made\\s+a)\\s+(?:pop|snap|crack|clunk)",
  // Arabic: locking, giving way, dislocation, ligament and tendon tears, a heard pop.
  JOINT_AR +
    "\\s*(?:\\S+\\s+){0,2}?(?:[تي]?(?:ن)?قفل|انقفلت|تقفلت|قفلت|علقت|[تي]علق|[تي]تعلق|انحشرت|[تي]نحشر|انغلقت|[تي]نغلق|تصلبت|[تي]تصلب|تيبست|[تي]تيبس|تسكرت|[تي]تسكر|انسكرت)|(?:انقفلت|قفلت|علقت|انغلقت|تصلبت|تيبست)\\s*(?:\\S+\\s+){0,1}?" +
    JOINT_AR +
    "|" +
    JOINT_AR +
    "\\s*(?:\\S+\\s+){0,2}?(?:[تي]خون(?:ني|ي)?|خانتني|خانني|[تي]فلت|فلتت|[تي]نثني\\s*(?:فجاه|لحال(?:ها|ه))|انثنت\\s*(?:فجاه|لحال(?:ها|ه))|[تي]رتخي|ارتخت|[تي]طيح\\s*(?:فيني|بي)|(?:مو|مش|غير|ما\\s*هي|ليست)\\s*ثابت(?:ه)?|طلع(?:ت)?\\s*من\\s*مكان(?:ه|ها))|(?:خانتني|خانني)\\s*" +
    JOINT_AR +
    "|عدم\\s*(?:ال)?ثبات\\s*(?:في\\s*)?" +
    JOINT_AR +
    "|" +
    "[اين]?نخلع(?:ت)?|خلع\\s*(?:في\\s*)?(?:ال)?(?:كتف|مفصل|ركبه|كوع|مرفق|ورك)|(?:ال)?رباط\\s*(?:ال)?صليبي|(?:قطع|انقطاع)\\s*(?:في\\s*)?(?:ال)?(?:رباط|اربطه|وتر|غضروف|هلاله|اخيل)|(?:سمعت|حسيت)\\s*(?:ب)?(?:صوت\\s*)?(?:طقه|فرقعه|طق)\\s*(?:في|من)\\s*" +
    JOINT_AR,
);
// Giving way said without naming the joint ("now it's swollen and it gives
// way"), when a joint is named elsewhere in the message.
const GIVE_WAY = words(
  "(?:gave|gives|giving|give)\\s+way",
  "[تي]خون(?:ني)|خانتني|خانني|[وف]?(?:ما|لا|مو)\\s*(?:[تي])?(?:شيلني|حملني|تحملني|تتحملني)|(?:مو|مش|غير)\\s*ثابت(?:ه)?",
);
const POP = words(
  "pop(?:s|ped|ping)?|snap(?:s|ped)?|crack(?:ed|s)?|clunk",
  "طقه|طقطقه|فرقعه|طقت|انطقت",
);
const SWELLING = words(
  "swell(?:ing|ed|s)?|swollen|puff(?:y|ed\\s+up)|ballooned",
  "(?:ورم|تورم|متورم(?:ه)?|[تي]ورم(?:ت)?|ورمت|[تي]تورم|تورمت|انتفاخ|منتفخ(?:ه)?|انتفخت|[تي]نتفخ)",
);
const SUDDEN_SWELLING = words(
  "swell(?:ed|s|ing)?\\s+up|ballooned|(?:sudden(?:ly)?|severe(?:ly)?|massive(?:ly)?|huge|big|lots?\\s+of|a\\s+lot\\s+of|really|very|badly|extremely|so|super|quite|pretty|visibly|noticeably|rapidly)\\s+(?:swell(?:ing|ed)|swollen|puffy|puffed\\s+up)(?!\\s+(?:from|after|with)\\s+(?:the\\s+|a\\s+|that\\s+)?pump)|" +
    "(?:" +
    SWELL_PART +
    ")\\s+(?:(?:is|was|are|were|got|has|had|have|went|looks?|feels?|became|been|gotten|all|really|very|so|pretty|quite|a\\s+bit|still|now|kind\\s+of|kinda|badly|suddenly|super|massively)\\s+){0,4}(?:swollen|swelled|swelling|puffy|puffed\\s+up)|swelling\\s+(?:in|on|around|of|at|above|below|behind)\\s+(?:my|the|his|her)\\s+(?:(?:right|left|whole)\\s+)?(?:" +
    SWELL_PART +
    ")|swollen\\s+(?:" +
    SWELL_PART +
    ")",
  "(?:تورم|انتفاخ|ورم)\\s*(?:مفاجئ|مفاجي|شديد|كبير|قوي|وايد)|(?:انتفخت|تورمت|ورمت)\\s*(?:فجاه|بسرعه|وايد|مره)|" +
    JOINT_AR +
    "\\s*(?:\\S+\\s+){0,2}?(?:[وف]?(?:ورم|تورم|متورم(?:ه)?|[تي]ورم|ورمت|[تي]تورم|تورمت|انتفاخ|منتفخ(?:ه)?|انتفخت|[تي]نتفخ))|(?:ورم|تورم|انتفاخ)\\s*(?:في|ب)\\s*" +
    JOINT_AR,
);
function jointInjuryFlag(t: string) {
  if (unnegated(JOINT_INJURY, t) || unnegated(SUDDEN_SWELLING, t)) return true;
  if (unnegated(GIVE_WAY, t) && JOINT_MENTION.test(t)) return true;
  return has(POP, t) && unnegated(SWELLING, t);
}

// ---------------------------------------------------------------------------
// Eating-disorder behaviours and relapse
// ---------------------------------------------------------------------------
const ED_BEHAVIOUR = words(
  // Purging as a behaviour ("I've been purging", "binge and purge"), not a data or cache purge.
  "(?:i|i've|i\\s+have|i'm|i\\s+am|been|keep|kept|started|start|still|want\\s+to|urge\\s+to|and|then|to)\\s+purg(?:e|ed|es|ing)(?!\\s+(?:the|my|old|stale|expired|all|of|data|records?|backups?|logs?|cache|files?|emails?|inbox|fridge|cupboards?|pantry|closet|wardrobe))|purg(?:e|ed|es|ing)\\s+(?:after|again|when|food|meals?|everything|what\\s+i)|laxatives?|diuretics?\\s+(?:to|for)\\s+(?:lose|drop|cut|make|weight)|water\\s+pills?\\s+(?:to|for)|" +
    "(?:make|made|making)\\s+myself\\s+(?:sick|throw\\s+up|vomit|puke)|(?:throw(?:ing|s)?|threw)\\s+up\\s+(?:after|my)\\s+(?:eating|meals?|food|dinner|lunch|breakfast|everything|what\\s+i\\s+(?:eat|ate))|(?:vomit(?:ing|ed|s)?|puk(?:e|ing|ed))\\s+(?:after|my)\\s+(?:eating|meals?|food|dinner|lunch|breakfast)|self[\\s-]?induced\\s+vomiting|" +
    "(?:binge(?:d|s|ing)?|bingeing|binging)(?![\\s-]*(?:watch\\p{L}*|on\\s+(?:netflix|tv|youtube|shows?|series|episodes?)|(?:netflix|tv|youtube|shows?|series|episodes?|drink\\p{L}*)))|" +
    // Not eating at all, but not "nothing before my morning run".
    "starv(?:e|ing|ed)\\s+myself|(?:(?:(?:barely|hardly|not|never)\\s+eat(?:ing)?\\s+(?:anything|at\\s+all|any\\s+food))|eat(?:ing)?\\s+(?:almost\\s+|next\\s+to\\s+)?nothing)(?!\\s+(?:before|after|until|till|during|while|past|late|at\\s+night|in\\s+the\\s+(?:morning|evening)))|(?:barely|hardly)\\s+eat(?:ing)?(?!\\s+(?:breakfast|lunch|dinner|carbs?|sugar|meat|fish|veg\\p{L}*|fruit|dairy|junk|fast\\s+food|out|before|after|late|at|in))|" +
    "(?:been|keep|kept|started|start|i'm|i\\s+am|am)\\s+restricting(?:\\s+again)?(?!\\s+(?:carbs?|sugar|salt|sodium|alcohol|caffeine|dairy|gluten|fodmaps?|calories|kcal|my\\s+(?:carbs?|sugar|salt|caffeine|alcohol|calories)))|restricting\\s+(?:again|my\\s+(?:food|eating|meals|intake)|food|meals)|" +
    "relaps(?:e|ed|es|ing)",
  // Arabic: vomiting after food, laxatives, binges, starving oneself, relapse.
  "(?:[اتين]?تقيا|[اتين]?تقيء|تقيات|استفرغ(?:ت)?|[اتين]?ستفرغ|[اتين]?طرش|طرشت)\\s*(?:\\S+\\s+){0,2}?(?:ال)?(?:اكل|وجبه|وجبات|وجباتي|اكلته|اكلت)|(?:اجبر|اجبرت|اخلي|خليت)\\s*نفسي\\s*(?:علي\\s*)?(?:ال)?(?:تقيو|استفراغ|استفرغ|اتقيا|اطرش|ترجيع)|(?:ال)?(?:تقيو|استفراغ)\\s*(?:المتعمد|متعمد)|" +
    "(?:حبوب\\s*)?(?:ملين(?:ات)?|مسهل(?:ات)?)|حبوب\\s*(?:ال)?(?:تسهيل|اسهال)|" +
    "نوب(?:ه|ات)\\s*(?:من\\s*)?(?:ال)?(?:اكل|شراهه|نهم)|(?:اكل|اكلت|اكلنا)\\s*(?:بشراهه|بنهم|بشكل\\s*هستيري|بجنون)|(?:ال)?شراهه\\s*(?:في\\s*)?(?:ال)?اكل|" +
    "[اتين]?جوع\\s*نفسي|جوعت\\s*نفسي|احرم\\s*نفسي\\s*(?:من\\s*)?(?:ال)?اكل|(?:امتنع|امتنعت|ممتنع(?:ه)?)\\s*عن\\s*(?:ال)?اكل|(?:ما|لا|مو)\\s*(?:اكل|اكلت|قاعد\\s*اكل|قاعده\\s*اكل|صرت\\s*اكل)\\s*(?:شي|شيء|ولا\\s*شي|اي\\s*شي|ابد|نهائيا)(?!\\s*(?:بعد|قبل|الساعه|في\\s*الليل|بالليل|وقت))|" +
    "انتكاس(?:ه)?|انتكست|[اين]?نتكس|(?:رجعت|ارجع|راجع(?:ه)?|رجعنا)\\s*(?:لل|ل|الي\\s*(?:ال)?)\\s*(?:نفس\\s*(?:ال)?)?(?:عادات(?:ي)?|حاله|مرض|اضطراب|وضع|سلوك|سلوكيات)(?:\\s*(?:ال)?(?:قديمه|سابقه|قديم))?",
);
// Only in combination: skipped meals with compensatory training or relapse
// wording, or relapse wording about food or weight.
const SKIPPED_MEALS = words(
  "skip(?:ping|ped|s)?\\s+(?:(?:all|most|my|some|a\\s+lot\\s+of|many|several|two|three|2|3|of|the\\s+odd)\\s+)*meals|skip(?:ping|ped)?\\s+(?:breakfast\\s+and\\s+(?:lunch|dinner)|lunch\\s+and\\s+dinner)|not\\s+eating\\s+(?:much|enough|properly|meals)|(?:cutting|cut)\\s+(?:out\\s+)?(?:meals|whole\\s+meals)",
  "(?:[اتين]?ترك|تركت|[اتين]?فوت|فوتت|[اتين]?سحب\\s*علي|سحبت\\s*علي|[اتين]?طنش|طنشت|[اتين]?تخطي|تخطيت)\\s*(?:\\S+\\s+){0,1}?(?:ال)?(?:وجبات|وجباتي|وجبتين|اكلي)",
);
const COMPENSATING = words(
  "twice\\s+a\\s+day|two\\s+(?:runs|sessions|workouts|times)\\s+a\\s+day|(?:double|extra)\\s+(?:sessions|runs|workouts|cardio)|burn\\s+(?:it|them|that|everything|off|the\\s+calories)|work\\s+(?:it|them)\\s+off|compensat\\p{L}*|make\\s+up\\s+for\\s+(?:eating|what\\s+i\\s+ate|it)|to\\s+(?:lose|drop|cut)\\s+weight|(?:lose|drop)\\s+weight\\s+fast|race\\s+lighter|to\\s+be\\s+lighter|weigh\\s+less",
  "مرتين\\s*(?:في|ب|بال)?\\s*(?:ال)?يوم|مرتين\\s*باليوم|تمرينين\\s*(?:في|ب|بال)?\\s*(?:ال)?يوم|[اتين]?حرق\\s*(?:ال)?(?:اكل|سعرات|اللي\\s*اكلته)|عشان\\s*(?:اخس|انزل\\s*وزن|انحف)",
);
const SLIPPING_BACK = words(
  "slipping\\s+(?:back|again)|sliding\\s+back|falling\\s+back\\s+(?:into|to)|back\\s+(?:into|to)\\s+(?:my\\s+)?old\\s+(?:habits|ways|patterns|behaviou?rs|self)|old\\s+(?:habits|behaviou?rs|patterns|thoughts)\\s+(?:are\\s+|keep\\s+)?(?:coming|creeping)\\s+back",
  "(?:احس|حاس|حاسه)\\s*(?:اني|انني|ان\\s*انا)?\\s*(?:ارجع|راجع(?:ه)?|بدات\\s*ارجع|قاعد(?:ه)?\\s*ارجع|رجعت)",
);
const EATING_CONTEXT = words(
  "meals?|eat(?:ing|en)?|ate|food|calori\\p{L}*|weigh(?:t|ing)?|scale|body|bulimi\\p{L}*|anorexi\\p{L}*|eating\\s+disorder|thin|skinny",
  "اكل|وجبات|وجبه|اكلي|وزن|وزني|سعرات|اكلت|ميزان|جسمي",
);
function eatingDisorderFlag(t: string) {
  if (unnegated(ED_BEHAVIOUR, t)) return true;
  const slipping = unnegated(SLIPPING_BACK, t);
  if (unnegated(SKIPPED_MEALS, t) && (has(COMPENSATING, t) || slipping))
    return true;
  return slipping && has(EATING_CONTEXT, t);
}

// ---------------------------------------------------------------------------
// The floor
// ---------------------------------------------------------------------------
/** Screened text with plain routine negations ("no pain today") removed. */
function floorText(text: string) {
  return screeningText(text).replace(
    routineNegation,
    (match: string, lead: string, offset: number, whole: string) =>
      symptomMentioned.test(whole) ||
      negatedBefore.test(
        whole.slice(Math.max(0, offset - 40), offset + lead.length),
      )
        ? match
        : lead + " ",
  );
}
/** Every red-flag category the code floor finds in a member's text. */
export function redFlagCategories(text: string): RedFlagCategory[] {
  const screened = floorText(String(text ?? ""));
  const found: RedFlagCategory[] = [];
  for (const [category, english, arabic] of wordScreens)
    if (english.test(screened) || arabic.test(screened)) found.push(category);
  const t = latinDigits(screened);
  if (bloodPressureFlag(t)) found.push("blood_pressure");
  if (bloodSugarFlag(t)) found.push("blood_sugar");
  if (pregnancyWarningFlag(t)) found.push("pregnancy_warning");
  if (jointInjuryFlag(t)) found.push("joint_injury");
  if (eatingDisorderFlag(t)) found.push("eating_disorder");
  return found;
}
/** The code floor: true when any red flag is found (see redFlagCategories). */
export function safetySignal(text: string) {
  return redFlagCategories(text).length > 0;
}
