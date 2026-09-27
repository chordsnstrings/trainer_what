import { z } from "zod";
export const BANDS = [
  { count: 100, bps: 2500 },
  { count: 200, bps: 2000 },
  { count: 700, bps: 1500 },
  { count: Infinity, bps: 1000 },
];
export function commission(amountMinor: number, rank: number) {
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    !Number.isSafeInteger(rank) ||
    rank < 1
  )
    throw new Error("Invalid commission inputs");
  const bps =
    rank <= 100 ? 2500 : rank <= 300 ? 2000 : rank <= 1000 ? 1500 : 1000;
  return Number((BigInt(amountMinor) * BigInt(bps) + 5000n) / 10000n);
}
export function projectedCommission(count: number, priceMinor: number) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 1000000)
    throw new Error("Invalid subscriber count");
  let left = count,
    total = 0,
    rank = 1;
  for (const band of BANDS) {
    const n = Math.min(left, band.count);
    total += n * commission(priceMinor, rank);
    left -= n;
    rank += n;
    if (!left) break;
  }
  return total;
}
export function validUaeIban(raw: string) {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^AE\d{21}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  let n = 0;
  for (const c of digits) n = (n * 10 + Number(c)) % 97;
  return n === 1;
}
export const exerciseSchema = z
  .object({
    name: z.string().min(2).max(100),
    sets: z.number().int().min(1).max(10),
    reps: z.number().int().min(1).max(100),
    restSeconds: z.number().int().min(0).max(600),
    loadKg: z.number().min(0).max(500).default(0),
    cue: z.string().max(500).default(""),
  })
  .strict();
export const programSchema = z
  .object({
    title: z.string().min(2).max(120),
    goal: z.string().max(1000),
    daysPerWeek: z.number().int().min(1).max(7),
    exercises: z.array(exerciseSchema).min(1).max(20),
  })
  .strict();
export const ruleSchema = z
  .object({
    title: z.string().min(3).max(150),
    category: z.enum([
      "progression",
      "substitution",
      "schedule",
      "recovery",
      "communication",
      "safety",
    ]),
    condition: z.string().min(3).max(1000),
    directive: z.string().min(3).max(2000),
    reason: z.string().max(2000),
    sourceIds: z.array(z.string().uuid()).max(30).default([]),
  })
  .strict();
export const decisionSchema = z
  .object({
    type: z.enum([
      "message",
      "program_build",
      "progression",
      "substitution",
      "schedule",
      "escalation",
    ]),
    message: z.string().min(1).max(4000),
    reason: z.string().max(2000),
    evidenceIds: z.array(z.string().uuid()).max(30),
    requiresHumanReview: z.boolean(),
    program: programSchema.optional(),
  })
  .strict();
// Deterministic red-flag screening, enforced in code before any model or paid
// gate. It is deliberately conservative: any match pauses training for trainer
// review. Only plain routine negations ("no pain", "pain-free") are removed, and
// only when nothing qualifies them: a contrast, exception, time, condition or
// painkiller cue later in the same sentence (or a contrast opening the next
// one), a physical symptom anywhere in the message, or a negation of the phrase
// itself ("not pain-free") keeps the report screened. Arabic text is folded
// first so hamza, madda, ta marbuta, alef maqsura, diacritics and tatweel
// variants are screened alike; "الأم" (the mother) is set apart before folding
// so it is not read as "الام" (pains).
// Boundaries avoid lookbehind because this module is also bundled for browsers.
function screeningText(text: string) {
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
const englishRedFlags =
  /(?:^|[^\p{L}\p{N}])(?:chest\s+(?:pains?|tightness|pressure)|pain(?:s|ful|killers?)?|hurt(?:s|ing)?|injur(?:e|ed|y|ies)|sprain(?:s|ed)?|pulled\s+(?:a\s+|my\s+)?muscle|numb(?:ness)?|faint(?:s|ed|ing)?|pass(?:ed|es|ing)?\s+out|black(?:ed|ing)?\s+out|blackouts?|lost\s+consciousness|unconscious|collaps(?:e|ed|es|ing)|dizz(?:y|iness)|light[\s-]?headed(?:ness)?|vertigo|short(?:ness)?\s+of\s+breath|(?:can'?t|cannot|can\s+not|couldn'?t|could\s+not)\s+breathe|hard\s+to\s+breathe|(?:trouble|difficulty|struggling)\s+(?:to\s+)?breath(?:e|ing)|palpitations?|irregular\s+heart\s*beats?|heart\s+flutter(?:s|ing)?|heart\s+attack|bleed(?:s|ing)?|bled|pregnan(?:t|cy)?|miscarr(?:y|iage|ied)|suicid(?:e|al)|self[\s-]?harm(?:ing)?|kill\s+myself|end\s+my\s+life|want\s+to\s+die|severe\s+headache|seizures?)(?![\p{L}\p{N}])/iu;
const arabicRedFlags =
  /(?:^|[^\p{L}\p{N}])[وفبلك]{0,2}(?:ال)?(?:الم|الام|[يت]ولم(?:ني|ه|ها|ك|نا)?|[اين]?تالم|[يت]?وجع(?:ني|ي|ه|ها|ك|نا)?|اوجاع|موجوعه?|[يت]عور(?:ني|ه|ها|ك|نا)?|عورني|ضيق\s*(?:في\s*|ب)?(?:ال)?(?:صدر|تنفس|نفس)ي?|صعوبه\s*(?:في\s*|ب)?(?:ال)?تنفس|(?:لا|ما|مو|مش|لم)\s*(?:اقدرت?|قدرت|استطيع|استطعت|استطع|قادره?)\s*(?:علي\s*)?(?:ال|ا)?تنفس|[ايتن]?دوخ(?:ه|ان|ني|تني|ت)?|دايخه?|اغماء?|اغمي\s*علي(?:ه|ها|ا)?|فقد(?:ت|ان)?\s*(?:ال)?وعي|غيبوبه|نزيف|[يت]?نزف(?:ت|ني)?|خفقان|(?:تسارع|سرعه)\s*(?:في\s*)?(?:ال)?(?:ضربات|دقات|نبضات)\s*(?:ال)?قلبي?|نوبه\s*قلبيه|جلطه|اصابه|اصابات|مصابه?|التواء|ملتويه?|تمزق|تنميل|خدر|حامل|حوامل|اجهاض|انتحار|[اي]نتحر|اقتل\s*نفسي|انهي\s*حياتي|اوذي\s*نفسي|ايذاء\s*(?:ال)?نفس|صداع\s*شديد)(?![\p{L}\p{N}])/u;
export function safetySignal(text: string) {
  const screened = screeningText(text).replace(
    routineNegation,
    (match: string, lead: string, offset: number, whole: string) =>
      symptomMentioned.test(whole) ||
      negatedBefore.test(
        whole.slice(Math.max(0, offset - 40), offset + lead.length),
      )
        ? match
        : lead + " ",
  );
  return englishRedFlags.test(screened) || arabicRedFlags.test(screened);
}
export function allowedModelEvidence(
  records: Array<{ id: string; data: any }>,
) {
  for (const r of records)
    if (!r.data.allowedUses?.includes("model_prompt"))
      throw Object.assign(
        new Error("Evidence is not permitted for model input"),
        { statusCode: 409, code: "EVIDENCE_NOT_PERMITTED" },
      );
  return records;
}
export const payoutTransitions: Record<string, string[]> = {
  ready: ["held", "submitted", "canceled"],
  held: ["ready", "canceled"],
  submitted: ["processing", "unknown", "failed"],
  processing: ["paid", "unknown", "failed"],
  unknown: ["processing", "paid", "failed"],
  paid: ["returned"],
  failed: [],
  returned: [],
  canceled: [],
};
export function assertPayoutTransition(from: string, to: string) {
  if (!payoutTransitions[from]?.includes(to))
    throw new Error(`Invalid payout transition ${from} to ${to}`);
}
export function refundEligible(chargedAt: string, now = new Date()) {
  const age = now.getTime() - new Date(chargedAt).getTime();
  return age >= 0 && age <= 7 * 24 * 60 * 60 * 1000;
}
export function money(minor: number | string) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(Number(minor) / 100);
}
