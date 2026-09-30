import { z } from "zod";

export const trainingExerciseSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    sets: z.number().int().min(1).max(10),
    reps: z.number().int().min(1).max(100),
    restSeconds: z.number().int().min(0).max(600),
    loadKg: z.number().min(0).max(500).default(0),
    rir: z.number().min(0).max(10).default(2),
    cue: z.string().max(1000).default(""),
    // Equipment the exercise needs; the Brain's plan validator checks it
    // against the subscriber's intake (docs/features/brain-plans.md).
    equipment: z.array(z.string().trim().min(2).max(80)).max(8).optional(),
    demonstrationUrl: z
      .url()
      .refine(
        (v) => new URL(v).protocol === "https:",
        "Use an HTTPS demonstration link",
      )
      .optional(),
    alternatives: z
      .array(
        z
          .object({
            name: z.string().trim().min(2).max(100),
            cue: z.string().max(1000).default(""),
            loadKg: z.number().min(0).max(500).default(0),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict();
export const trainingProgramSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    goal: z.string().max(1000),
    daysPerWeek: z.number().int().min(1).max(7),
    exercises: z.array(trainingExerciseSchema).min(1).max(20),
    weeks: z.number().int().min(1).max(26).default(4),
    sessions: z
      .array(
        z
          .object({
            label: z.string().trim().min(2).max(120),
            weekday: z.number().int().min(0).max(6),
            exercises: z.array(trainingExerciseSchema).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(7)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const exercises of [
      value.exercises,
      ...(value.sessions ?? []).map((s) => s.exercises),
    ]) {
      if (
        new Set(exercises.map((e) => e.name.toLowerCase())).size !==
        exercises.length
      )
        ctx.addIssue({
          code: "custom",
          path: ["exercises"],
          message: "Each exercise name must be unique within a session",
        });
    }
    if (value.sessions && value.sessions.length !== value.daysPerWeek)
      ctx.addIssue({
        code: "custom",
        path: ["sessions"],
        message: "Sessions must match the number of days per week",
      });
    if (
      value.sessions &&
      new Set(value.sessions.map((s) => s.weekday)).size !==
        value.sessions.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["sessions"],
        message: "Choose one training session per weekday",
      });
  });
export const trainingDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(new Date(v + "T12:00:00Z").getTime()) &&
      new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v,
    "Use a valid calendar date",
  );
export function addTrainingDays(value: string, days: number) {
  const d = new Date(value + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function trainingSchedule(
  program: z.infer<typeof trainingProgramSchema>,
  startDate: string,
  timezone: string,
) {
  // Dates are calendar dates in the selected timezone; UTC noon is only used
  // for calendar arithmetic, never interpreted as a workout appointment time.
  new Intl.DateTimeFormat("en", { timeZone: timezone });
  trainingDateSchema.parse(startDate);
  const days =
    program.sessions ??
    Array.from({ length: program.daysPerWeek }, (_, i) => ({
      label: program.title,
      weekday:
        (new Date(startDate + "T12:00:00Z").getUTCDay() +
          Math.floor((i * 7) / program.daysPerWeek)) %
        7,
      exercises: program.exercises,
    }));
  const result = [];
  for (let day = 0; day < program.weeks * 7; day++) {
    const date = addTrainingDays(startDate, day),
      weekday = new Date(date + "T12:00:00Z").getUTCDay();
    const session = days.find((s) => s.weekday === weekday);
    if (session)
      result.push({
        date,
        timezone,
        week: Math.floor(day / 7) + 1,
        label: session.label,
        program: {
          ...program,
          title: session.label,
          exercises: session.exercises,
        },
      });
  }
  return result;
}
export function effectiveWorkoutSets(sets: any[], corrections: any[]) {
  const latest = new Map<string, any>();
  for (const c of [...corrections].sort(
    (a, b) => Number(a.data.revision) - Number(b.data.revision),
  ))
    latest.set(c.data.eventId, c);
  return sets.map((set) =>
    latest.has(set.id)
      ? {
          ...set,
          data: { ...set.data, ...latest.get(set.id).data.values },
          correctionId: latest.get(set.id).id,
        }
      : set,
  );
}

export const coachingActions = [
  "message",
  "program_build",
  "progression",
  "substitution",
  "schedule",
] as const;
/**
 * Text for request-term matching. Case and width are folded; Arabic
 * diacritics and tatweel are removed and letter variants unified (alef forms,
 * waw and yeh hamza, alef maqsura and Persian yeh, keheh, ta marbuta);
 * Arabic-Indic digits become ASCII. Letters and digits of every script are
 * kept and anything else becomes one space, so Arabic text never folds to
 * empty text. Arabic letters that touch Latin letters or digits are split
 * into separate words, so a code-switched English word keeps matching when a
 * member glues an Arabic article or preposition to it ("الـband" and
 * "بالband" read as "ال band" and "بال band"), as it did when Arabic
 * letters were removed.
 * No lookbehind: this module is also bundled for browsers.
 */
export function coachingTermText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0624/g, "\u0648")
    .replace(/[\u0626\u0649\u06CC]/g, "\u064A")
    .replace(/\u06A9/g, "\u0643")
    .replace(/\u0629/g, "\u0647")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/(\p{Script=Arabic})(?=[\p{Script=Latin}0-9])/gu, "$1 ")
    .replace(/([\p{Script=Latin}0-9])(?=\p{Script=Arabic})/gu, "$1 ")
    .trim();
}
const arabicLetter = /\p{Script=Arabic}/u;
/**
 * Whether the member reads Arabic replies: most of the message's letters are
 * Arabic (a tie counts as Arabic). A code-switching message that is mostly
 * English is answered with the trainer's main reply.
 */
export function writtenInArabic(text: string) {
  let arabic = 0,
    latin = 0;
  for (const c of text.normalize("NFKC"))
    if (c === "\u0640" || !/\p{L}/u.test(c)) continue;
    else if (arabicLetter.test(c)) arabic++;
    else if (/\p{Script=Latin}/u.test(c)) latin++;
  return arabic > 0 && arabic >= latin;
}
// An optional attached Arabic conjunction, preposition and article
// (و، ف، ب، ك، ل، ال، لل), for example وتأجيل، بالحصة، للحصة.
const arabicClitic = "(?:[وف]?(?:[بك]?ال|لل|[بلك])?)";
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Determiners and possessives an English term may be written with: "move my
 * session" also reads "move tomorrow's session", "move the Tuesday session"
 * and "move session". In the folded text a possessive is a word followed by
 * "s" ("tomorrow s"); at most two such words fill the place.
 */
const TERM_DETERMINERS = new Set(["my", "your", "the", "this", "that", "our", "his", "her", "their", "a", "an"]);
const determinerSlot =
  "(?:(?:my|your|the|this|that|these|those|our|his|her|their|a|an|next|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|evening|\\p{L}+ s) ){0,2}";
/**
 * An English term word and its simple inflections: -s, -es, -ed, -ing, a
 * final e dropped (move: moves, moved, moving), a final consonant doubled
 * (skip: skipped, skipping) and y to ies/ied (carry: carries, carried).
 * Only the term word grows; the request word is never cut down, so "tired"
 * does not read "tires" and "band" does not read "bandana". A possessive "s"
 * may follow ("coach's"). Words under three letters and words with digits
 * match exactly.
 */
function englishWordPattern(word: string) {
  if (word.length < 3 || !/^\p{Script=Latin}+$/u.test(word)) return escapeRegExp(word);
  const forms = new Set([word, word + "s", word + "es", word + "ed", word + "ing"]);
  if (word.endsWith("e")) {
    forms.add(word + "d");
    forms.add(word.slice(0, -1) + "ing");
  }
  if (/[^aeiou]y$/.test(word)) {
    forms.add(word.slice(0, -1) + "ies");
    forms.add(word.slice(0, -1) + "ied");
  }
  if (/(?:^|[^aeiou])[aeiou][b-df-hj-np-tvz]$/.test(word)) {
    forms.add(word + word.at(-1) + "ed");
    forms.add(word + word.at(-1) + "ing");
  }
  return "(?:" + [...forms].map(escapeRegExp).join("|") + ")(?: s)?";
}
/**
 * A request term as a whole-word pattern over coachingTermText(). English
 * words match at word level: simple inflections, a possessive "s", and any
 * determiner or possessive in place of the term's own ("my", "the"; see
 * englishWordPattern and determinerSlot). An Arabic word may carry an
 * attached clitic in the request, and a term word's own article is optional
 * (the term "تأجيل الحصة" matches "تأجيل حصة الغد"). A term that folds to
 * empty text never matches anything.
 */
function requestTermPattern(term: string) {
  const words = coachingTermText(term).split(" ").filter(Boolean);
  if (!words.length) return null;
  let source = " ";
  words.forEach((word, i) => {
    const last = i === words.length - 1;
    // A determiner between two words of the term is a place, not a word.
    if (!last && i > 0 && TERM_DETERMINERS.has(word)) {
      source += determinerSlot;
      return;
    }
    if (arabicLetter.test(word)) {
      const stem = word.startsWith("ال") && word.length >= 5 ? word.slice(2) : word;
      source += arabicClitic + escapeRegExp(stem);
    } else source += englishWordPattern(word);
    if (!last) source += " ";
  });
  return new RegExp(source + "(?= )", "u");
}
export function requestMatchesTerm(request: string, term: string) {
  const pattern = requestTermPattern(term);
  return !!pattern && pattern.test(" " + coachingTermText(request) + " ");
}
// Medical and supplement topics stay with the trainer even when a routine
// term matches (in the trial, "I'm exhausted. Which energy drink should I have
// before intervals?" matched a fatigue action). The Arabic list is matched on
// coachingTermText() (so it is written in folded spelling, e.g. دوايي for
// دوائي) with an optional attached clitic. It includes the Gulf spellings
// (دوا، دواي) and pills (حبوب). The bare مكمل also reads "continuing" in the
// Gulf ("مكمل على نفس البرنامج"); it stays excluded because "آخذ مكمل على
// الريق؟" (a supplement on an empty stomach) is written the same way, and an
// unclear request goes to the trainer.
const medicalRequest =
  /\b(diagnos(?:e|is|ing)|medicat(?:ion|ions)|medicines?|pills?|painkillers?|prescrib(?:e|ing)|blood (?:test|results)|medical treatment|eating disorder|diabetes|supplements?|energy drinks?|pre-?workouts?|creatine|fat burners?)\b/i;
const arabicMedicalRequest = new RegExp(
  " " +
    arabicClitic +
    "(?:تشخيص|دواء|دوا|دواي|دوايي|ادويه|ادويتي|حبوب|مسكن|مسكنات|وصفه طبيه|تحليل (?:ال)?دم|فحص (?:ال)?دم|علاج|علاجي|اضطراب (?:ال)?اكل|سكري|مرض (?:ال)?سكر|انسولين|مكمل|مكملات|كرياتين|حارق (?:ال)?دهون|حارقات (?:ال)?دهون|مشروب (?:ال)?طاقه|مشروبات (?:ال)?طاقه)(?= )",
  "u",
);
export const coachActionSchema = z
  .object({
    title: z.string().trim().min(3).max(150),
    type: z.enum(coachingActions),
    requestTerms: z.array(z.string().trim().min(3).max(120)).min(1).max(12),
    response: z.string().trim().min(10).max(4000),
    /**
     * Optional Arabic wording of the approved reply. A member who writes in
     * Arabic receives it; without it (and with an English main reply) the
     * request becomes a reviewed draft in Arabic instead of an automatic reply.
     */
    responseAr: z.string().trim().min(10).max(4000).optional(),
    rationale: z.string().trim().min(10).max(2000),
    evidenceIds: z.array(z.string().uuid()).min(1).max(20),
    experience: z
      .array(z.enum(["beginner", "intermediate", "advanced"]))
      .min(1)
      .max(3),
    requiredEquipment: z
      .array(z.string().trim().min(2).max(80))
      .max(10)
      .default([]),
    exercise: z.string().trim().min(2).max(100).optional(),
    replacement: trainingExerciseSchema.optional(),
    templateId: z.string().uuid().optional(),
    increaseKg: z.number().positive().max(10).optional(),
    maxIncreasePercent: z.number().positive().max(10).optional(),
    minimumRir: z.number().min(1).max(10).default(2),
    minimumCompletedSets: z.number().int().min(2).max(12).default(3),
    daysOffset: z.number().int().min(1).max(3).optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (
      a.type === "progression" &&
      (!a.exercise || !a.increaseKg || !a.maxIncreasePercent)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Progression needs an exercise, load increment and percentage bound",
      });
    if (a.type === "substitution" && (!a.exercise || !a.replacement))
      ctx.addIssue({
        code: "custom",
        message: "Substitution needs an exercise and an approved replacement",
      });
    if (a.type === "program_build" && !a.templateId)
      ctx.addIssue({
        code: "custom",
        message: "Program build needs a trainer-authored template",
      });
    if (a.type === "schedule" && !a.daysOffset)
      ctx.addIssue({
        code: "custom",
        message:
          "Schedule change needs a fixed postponement of one to three days",
      });
    if (a.responseAr !== undefined && !writtenInArabic(a.responseAr))
      ctx.addIssue({
        code: "custom",
        path: ["responseAr"],
        message: "Write the Arabic reply in Arabic",
      });
  });
/**
 * What a trainer may save as a new action: the stored contract plus request
 * phrases and equipment that contain letters or digits (a phrase such as
 * "!!!" folds to empty text and could never be matched). Stored actions are
 * read with coachActionSchema, so older rows still load.
 */
export const coachActionInputSchema = coachActionSchema.superRefine(
  (a, ctx) => {
    a.requestTerms.forEach((term, i) => {
      if (!coachingTermText(term))
        ctx.addIssue({
          code: "custom",
          path: ["requestTerms", i],
          message: "Each request phrase needs letters or digits",
        });
    });
    a.requiredEquipment.forEach((item, i) => {
      if (!coachingTermText(item))
        ctx.addIssue({
          code: "custom",
          path: ["requiredEquipment", i],
          message: "Each equipment item needs letters or digits",
        });
    });
  },
);
/**
 * The approved reply for this request, in the member's language: the main
 * reply for a member who does not write in Arabic, or when the main reply is
 * itself Arabic; otherwise the Arabic reply. Null when a member writes in
 * Arabic and the action has no Arabic wording: the English reply is never
 * sent to them automatically, and the request becomes a reviewed draft.
 */
export function coachActionReply(
  action: { response: string; responseAr?: string },
  request: string,
): { text: string; arabic: boolean } | null {
  const arabicReply = writtenInArabic(action.response);
  if (!writtenInArabic(request) || arabicReply)
    return { text: action.response, arabic: arabicReply };
  return action.responseAr ? { text: action.responseAr, arabic: true } : null;
}
/**
 * A selected action is delivered automatically only when the model chose it
 * without asking for review and cited at least one rule the action itself
 * cites. The chosen actionId is the model's citation of the action (it need
 * not repeat it in evidenceIds, coach-action-selector-v3); every cited ID was
 * already checked against the coach's release by selectCoachAction.
 */
export function groundedCoachSelection(
  selection: {
    actionId: string | null;
    requiresHumanReview: boolean;
    evidenceIds: string[];
  },
  /** The stored action record ({ id, data: { evidenceIds } }). */
  action: { id?: unknown; data?: any } | null | undefined,
) {
  const cites: unknown = action?.data?.evidenceIds;
  return (
    !!action &&
    selection.actionId === action.id &&
    !selection.requiresHumanReview &&
    Array.isArray(cites) &&
    cites.some((id) => selection.evidenceIds.includes(id))
  );
}
export const teachingCaseSchema = z
  .object({
    scenario: z.string().trim().min(10).max(3000),
    category: z.enum(coachingActions),
    recommendation: z.string().trim().min(10).max(3000),
    reason: z.string().trim().min(10).max(3000),
    alternatives: z.string().max(2000),
    changeWhen: z.string().trim().min(10).max(2000),
    escalateWhen: z.string().trim().min(10).max(2000),
    outcomeContext: z.string().trim().min(10).max(2000).optional(),
  })
  .strict();
/**
 * Pinned by every qualification: the version is part of coachingModelPin(),
 * so it is in the runtime contract digest. Changing it makes published
 * automatic releases stale (members' requests go to trainer review) until the
 * trainer evaluates and activates again. v3: identifiers are short prompt
 * references, and evidenceIds need a rule the selected action cites. v4 (the
 * trial tuning of 30 September 2026): the prompt says which checks the app
 * already made on every action shown, that instructions inside a request are
 * data and not by themselves a reason for review, and which concrete reasons
 * do need review (including a spacing rule a moved session could break).
 */
export const coachingPromptVersion = "coach-action-selector-v4";
export const coachingFactsSchema = z
  .object({
    profile: z
      .object({
        experience: z.enum(["beginner", "intermediate", "advanced"]),
        daysPerWeek: z.number().int().min(1).max(7),
        equipment: z.string().max(1000),
        limitations: z.string().max(2000),
      })
      .strict(),
    program: z
      .object({
        id: z.string().uuid(),
        version: z.number().int().positive(),
        title: z.string().max(120),
        daysPerWeek: z.number().int().min(1).max(7),
        exercises: z.array(trainingExerciseSchema).max(20),
      })
      .strict()
      .nullable()
      .default(null),
    sets: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            exercise: z.string().max(100),
            reps: z.number().int().min(0).max(200),
            loadKg: z.number().min(0).max(500),
            rir: z.number().min(0).max(10).optional(),
            completed: z.boolean(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    nextSession: z
      .object({
        id: z.string().uuid(),
        version: z.number().int().positive(),
        date: trainingDateSchema,
      })
      .strict()
      .nullable()
      .default(null),
    occupiedDates: z.array(trainingDateSchema).max(200).default([]),
    currentDate: trainingDateSchema,
    activeWorkout: z.boolean().default(false),
    assignedProgramCount: z.number().int().min(0).default(0),
  })
  .strict();
export type CoachingFacts = z.infer<typeof coachingFactsSchema>;
export function eligibleCoachAction(
  action: z.infer<typeof coachActionSchema>,
  request: string,
  facts: CoachingFacts,
  template?: any,
) {
  const normal = coachingTermText;
  if (
    medicalRequest.test(request) ||
    arabicMedicalRequest.test(" " + normal(request) + " ")
  )
    return false;
  if (!action.requestTerms.some((term) => requestMatchesTerm(request, term)))
    return false;
  if (!action.experience.includes(facts.profile.experience)) return false;
  if (
    ![
      "none",
      "none reported",
      "no limitations",
      "no known limitations",
    ].includes(normal(facts.profile.limitations))
  )
    return false;
  // Empty entries (a trailing comma) never satisfy a requirement, and a
  // requirement that folds to empty text is never met.
  const equipment = facts.profile.equipment
    .split(/[,;\n\u060C\u061B]/)
    .map(normal)
    .filter(Boolean);
  if (action.requiredEquipment.some((e) => !equipment.includes(normal(e))))
    return false;
  if (action.type === "message") return true;
  if (facts.activeWorkout) return false;
  if (action.type === "program_build")
    return (
      facts.assignedProgramCount === 0 &&
      !!template &&
      template.status === "template" &&
      template.data.daysPerWeek <= facts.profile.daysPerWeek
    );
  if (action.type === "schedule") {
    if (!facts.nextSession || facts.nextSession.date < facts.currentDate)
      return false;
    const date = addTrainingDays(facts.nextSession.date, action.daysOffset!);
    if (facts.occupiedDates.includes(date)) return false;
    const weekday = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7,
      weekStart = addTrainingDays(date, -weekday),
      weekEnd = addTrainingDays(weekStart, 6);
    return (
      facts.occupiedDates.filter(
        (d) => d !== facts.nextSession!.date && d >= weekStart && d <= weekEnd,
      ).length +
        1 <=
      facts.profile.daysPerWeek
    );
  }
  const exercise = facts.program?.exercises.find(
    (e) => e.name === action.exercise,
  );
  if (!exercise) return false;
  if (action.type === "substitution")
    return !facts.program!.exercises.some(
      (e) => e.name === action.replacement!.name,
    );
  const recent = facts.sets
    .filter((s) => s.exercise === exercise.name && s.completed)
    .slice(0, action.minimumCompletedSets);
  return (
    action.type === "progression" &&
    exercise.loadKg > 0 &&
    (action.increaseKg! / exercise.loadKg) * 100 <=
      action.maxIncreasePercent! &&
    exercise.loadKg + action.increaseKg! <= 500 &&
    recent.length >= action.minimumCompletedSets &&
    recent.every(
      (s) =>
        s.reps >= exercise.reps &&
        s.loadKg >= exercise.loadKg &&
        (s.rir ?? -1) >= action.minimumRir,
    )
  );
}
export function canonicalCoaching(value: any): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalCoaching).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonicalCoaching(value[key]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
