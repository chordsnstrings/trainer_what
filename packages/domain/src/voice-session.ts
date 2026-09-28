// Voice-led workout sessions: the structured session script, the trainer's
// voice-session style and the code-owned rules that keep every spoken line
// within the plan. Pure and browser-safe (no Node APIs): the API builds and
// validates scripts, the worker re-validates them before paying for audio and
// the web runner reads them.
import { z } from "zod";
import { safetySignal, screeningText } from "./index.ts";

export const VOICE_SCRIPT_VERSION = "voice-session-script-v1";
export const VOICE_SUGGESTION_PROMPT_VERSION = "voice-session-suggestions-v1";
/** The spoken safety line is code-owned and always part of the intro. */
export const VOICE_SAFETY_LINE =
  "If anything hurts, or you feel dizzy or unwell, say pain or tap Stop and I will stop the session and tell your trainer.";

export type LineKind =
  | "intro"
  | "safety"
  | "warmup"
  | "setup"
  | "cue"
  | "form"
  | "set"
  | "rest"
  | "rest_end"
  | "encourage"
  | "cooldown"
  | "finish";
/**
 * code: written by code from the plan; trainer: the trainer's own words (their
 * phrases, their plan cue, or a Brain suggestion the trainer approved and saved).
 * Model wording is never spoken without the trainer's approval.
 */
export type LineOwner = "code" | "trainer";
export type ScriptLine = {
  id: string;
  kind: LineKind;
  owner: LineOwner;
  text: string;
};
export type PlanExercise = {
  name: string;
  sets: number;
  reps: number;
  loadKg: number;
  restSeconds: number;
  rir: number;
  cue: string;
};
export type ScriptExercise = PlanExercise & {
  index: number;
  setup: ScriptLine;
  cueLine: ScriptLine | null;
  form: ScriptLine[];
  setLines: ScriptLine[];
  rest: ScriptLine;
  restEnd: ScriptLine;
  encouragement: ScriptLine[];
};
export type SessionScript = {
  version: typeof VOICE_SCRIPT_VERSION;
  title: string;
  tone: VoiceTone;
  intro: ScriptLine[];
  warmup: ScriptLine[];
  exercises: ScriptExercise[];
  cooldown: ScriptLine[];
  finish: ScriptLine;
  /** The trainer's adjustment rules in force when the script was built. */
  rules: VoiceAdjustmentRules;
};

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
const MEDICAL = word(
  "diagnos\\p{L}*|medicines?|medications?|medical|prescri(?:be|bed|bes|ption|ptions)|doses?|dosage|ibuprofen|paracetamol|acetaminophen|aspirin|painkillers?|pills?|supplements?|rehab\\p{L}*|therap\\p{L}*|treat(?:s|ed|ing|ment|ments)?|cures?|heal(?:s|ed|ing)?|doctors?|physio\\p{L}*|symptoms?|diseases?|injections?|ice\\s+it|push\\s+through|work\\s+through\\s+(?:it|the\\s+\\p{L}+)|no\\s+pain\\s*,?\\s*no\\s+gain|" +
    // Telling someone to ignore or train through a symptom.
    "ignore\\s+(?:it|that|this|(?:the|your|any)\\s+\\p{L}+|\\p{L}*(?:pain|ache|dizz\\p{L}*|hurt\\p{L}*))|through\\s+the\\s+(?:burn|pain|discomfort|ache)|shake\\s+it\\s+off|tough\\s+it\\s+out|keep\\s+going\\s+(?:if|even|when|though|through|anyway|regardless)|(?:if|even\\s+if|when)\\s[^.!?;]{0,60}(?:just\\s+)?(?:keep|carry)\\s+(?:going|on)|clicks?|clicking|pops|popping|popped|numb\\p{L}*|tingl\\p{L}*|twinges?|swell\\p{L}*|swollen|" +
    "دواء|ادويه|علاج|طبيب|دكتور|تشخيص|مسكن|مسكنات|حبوب|مكملات",
);
const PRESCRIPTION_CHANGE = word(
  "(?:extra|additional|another|bonus|more)\\s+(?:sets?|reps?|rounds?|weight|load)|(?:add|increase|decrease|reduce|drop|lower|raise|double|change)\\s+(?:the\\s+|your\\s+)?(?:weight|load|reps?|sets?|kilos?|kilograms?|rest)|heavier|lighter|less\\s+weight|go\\s+up|max(?:imum)?\\s+out|to\\s+failure|skip\\s+(?:the\\s+)?rest|" +
    // Training to failure or beyond the plan, and dropping the warm-up.
    "until\\s+(?:you\\s+)?(?:can'?t|cannot|fail\\p{L}*|drop)|as\\s+many\\s+as\\s+(?:you\\s+)?(?:can|possible)|amrap|(?:a\\s+)?few\\s+(?:more|extra)|squeeze\\s+out|skip\\s+(?:the\\s+|your\\s+)?(?:warm\\s*-?\\s*ups?|cool\\s*-?\\s*downs?|stretch\\p{L}*)|go\\s+straight\\s+in|no\\s+(?:need\\s+(?:for|to)\\s+)?(?:a\\s+)?warm\\s*-?\\s*up|" +
    "زيد|زود|نقص|قلل|اثقل|اخف",
);
// Technique instructions that are unsafe as a spoken default. "Don't round
// your back" is a good cue, so a negated instruction is removed first.
const UNSAFE_ALTS =
  "hold\\s+(?:your|the)\\s+breath|strain\\s+(?:hard|harder|as\\s+hard)|bear\\s+down|round\\s+(?:your|the)\\s+(?:back|spine)|yank\\p{L}*|jerk\\p{L}*|bounce\\p{L}*|swing\\s+(?:it|the\\s+\\p{L}+)\\s+up|cheat\\p{L}*|lock\\s+(?:out\\s+)?your\\s+(?:knees|elbows)|as\\s+heavy\\s+as\\s+(?:you\\s+)?(?:can|possible)|ego\\s+lift\\p{L}*|use\\s+momentum";
const UNSAFE_TECHNIQUE = word(UNSAFE_ALTS);
const NEGATED_UNSAFE = new RegExp(
  B + "(?:don'?t|do\\s+not|never|avoid|no|without)\\s+(?:\\p{L}+\\s+){0,2}?(?:" + UNSAFE_ALTS + ")" + E,
  "giu",
);
const unsafeTechnique = (folded: string) =>
  UNSAFE_TECHNIQUE.test(folded.replace(NEGATED_UNSAFE, " "));
const LINK = /https?:\/\/|www\.|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/iu;
const MARKUP = /[<>{}[\]\\`|#*_~^]|[\u0000-\u001f\u007f]/u;
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
// The trainer's voice-session style (versioned Brain material).
// ---------------------------------------------------------------------------
export type VoiceTone = "calm" | "steady" | "energetic";
const phrase = z.string().trim().min(2).max(200);
/**
 * Adjustments the voice coach may make without the trainer. Both are off until
 * the trainer opts in and saves a style version: the default keeps the plan.
 */
export const voiceAdjustmentRulesSchema = z
  .object({
    /** 0 disables load reduction; otherwise one reduction of at most this percentage of the prescribed load. */
    tooHeavyReducePercent: z.number().int().min(0).max(20).default(0),
    /** Whether "skip" may skip a set or an exercise. Pain always stops the session. */
    allowSkip: z.boolean().default(false),
  })
  .strict();
export type VoiceAdjustmentRules = z.infer<typeof voiceAdjustmentRulesSchema>;
export const voiceStyleSchema = z
  .object({
    tone: z.enum(["calm", "steady", "energetic"]).default("steady"),
    intro: z.array(phrase).max(4).default([]),
    warmup: z.array(phrase).max(6).default([]),
    encouragement: z.array(phrase).max(12).default([]),
    formReminders: z.array(phrase).max(12).default([]),
    cooldown: z.array(phrase).max(6).default([]),
    finish: z.array(phrase).max(4).default([]),
    adjustments: voiceAdjustmentRulesSchema.default({
      tooHeavyReducePercent: 0,
      allowSkip: false,
    }),
  })
  .strict();
export type VoiceStyle = z.infer<typeof voiceStyleSchema>;
export const defaultVoiceStyle = (): VoiceStyle => voiceStyleSchema.parse({});
/** Every phrase of a style that code would refuse to speak, by field. */
export function styleIssues(style: VoiceStyle) {
  const found: Array<{ field: string; index: number; issues: PhraseIssue[] }> = [];
  for (const field of [
    "intro",
    "warmup",
    "encouragement",
    "formReminders",
    "cooldown",
    "finish",
  ] as const)
    style[field].forEach((text, index) => {
      const issues = phraseIssues(text);
      if (issues.length) found.push({ field, index, issues });
    });
  return found;
}

const DEFAULTS: Record<
  VoiceTone,
  {
    intro: string;
    warmup: string[];
    encouragement: string[];
    form: string[];
    cooldown: string[];
    finish: string;
  }
> = {
  calm: {
    intro: "Welcome. I will guide you through today's session at a steady pace.",
    warmup: [
      "Start with some easy movement to warm up. Say done when you are ready.",
    ],
    encouragement: ["Nice and steady.", "Good control.", "Well done."],
    form: ["Keep the movement smooth and controlled.", "Breathe out as you push."],
    cooldown: ["That was the final set. Walk slowly and let your breathing settle."],
    finish: "Session complete. Well done today.",
  },
  steady: {
    intro: "Let's get started. I will guide you through today's session.",
    warmup: [
      "Begin with some easy movement to warm up. Say done when you are ready.",
    ],
    encouragement: ["Good work.", "Strong set.", "Keep that form."],
    form: ["Keep the movement controlled.", "Breathe out as you push."],
    cooldown: ["That was the final set. Take a few minutes to walk and breathe easily."],
    finish: "Session complete. Great work today.",
  },
  energetic: {
    intro: "Let's go! I will be with you for the whole session.",
    warmup: ["Get moving and warm up. Say done when you are ready!"],
    encouragement: ["Great set!", "Brilliant work!", "Love that energy!"],
    form: ["Stay tight and controlled.", "Breathe out as you drive up."],
    cooldown: ["That was the final set! Walk it off and let your breathing settle."],
    finish: "Session complete. Fantastic work today!",
  },
};

// ---------------------------------------------------------------------------
// Plan input and code-owned lines.
// ---------------------------------------------------------------------------
export class PlanError extends Error {
  code = "VOICE_PLAN_UNSUPPORTED";
  statusCode = 409;
}
const count = (value: unknown, min: number, max: number, fallback?: number) => {
  const n = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (n === undefined || !Number.isFinite(n) || n < min || n > max) return null;
  return n;
};
/** The workout's planned exercises in the shape the script uses, or PlanError. */
export function planExercises(program: any): PlanExercise[] {
  const list = Array.isArray(program?.exercises) ? program.exercises : [];
  if (!list.length || list.length > 20)
    throw new PlanError("This workout has no plan a voice session can follow.");
  return list.map((ex: any) => {
    const name = String(ex?.name ?? "").trim();
    const sets = count(ex?.sets, 1, 10),
      reps = count(ex?.reps, 1, 100),
      loadKg = count(ex?.loadKg, 0, 500, 0),
      restSeconds = count(ex?.restSeconds ?? ex?.rest, 0, 600, 60),
      rir = count(ex?.rir, 0, 10, 2);
    if (
      name.length < 2 ||
      name.length > 100 ||
      MARKUP.test(name) ||
      sets === null ||
      !Number.isInteger(sets) ||
      reps === null ||
      !Number.isInteger(reps) ||
      loadKg === null ||
      restSeconds === null ||
      !Number.isInteger(restSeconds) ||
      rir === null
    )
      throw new PlanError(
        "An exercise in this workout is missing its sets, reps or rest, so it cannot be voiced.",
      );
    return {
      name,
      sets,
      reps,
      loadKg: Math.round(loadKg * 100) / 100,
      restSeconds,
      rir,
      cue: typeof ex?.cue === "string" ? ex.cue.trim() : "",
    };
  });
}
export function formatLoad(kg: number) {
  return Number.isInteger(kg) ? String(kg) : String(Math.round(kg * 100) / 100);
}
export function restPhrase(seconds: number) {
  if (seconds < 60) return `${seconds} seconds`;
  const m = Math.floor(seconds / 60),
    s = seconds % 60;
  const minutes = `${m} minute${m === 1 ? "" : "s"}`;
  return s ? `${minutes} ${s} seconds` : minutes;
}
const target = (reps: number, loadKg: number) =>
  `${reps} reps${loadKg > 0 ? ` at ${formatLoad(loadKg)} kilograms` : ""}`;
/** The exact code-owned wording; validation compares against it. */
export const codeLines = {
  setup: (ex: PlanExercise, index: number, total: number) =>
    `${index === total - 1 && total > 1 ? "Last exercise" : `Exercise ${index + 1} of ${total}`}: ${ex.name}. ${ex.sets} ${ex.sets === 1 ? "set" : "sets"} of ${target(ex.reps, ex.loadKg)}.`,
  set: (ex: PlanExercise, set: number) =>
    `Set ${set} of ${ex.sets}. ${target(ex.reps, ex.loadKg)}. Say done when you finish, or tell me how many reps you did.`,
  rest: (ex: PlanExercise) =>
    ex.restSeconds > 0
      ? `Rest ${restPhrase(ex.restSeconds)}.`
      : "No rest here. Move straight on when you are ready.",
  restEnd: () => "Rest is over. Get ready.",
};

/**
 * Brain wording suggestions (from the published communication rules and the
 * trainer's phrases). They are stored for the trainer's review and are never
 * spoken: only lines the trainer adds to the style are. No per-exercise
 * technique: form and cues stay the trainer's own words.
 */
export const SUGGESTION_FIELDS = ["intro", "warmup", "encouragement", "cooldown", "finish"] as const;
export type SuggestionField = (typeof SUGGESTION_FIELDS)[number];
export const voiceSuggestionsSchema = z
  .object({
    intro: z.array(z.string().max(400)).max(4).optional(),
    warmup: z.array(z.string().max(400)).max(4).optional(),
    encouragement: z.array(z.string().max(400)).max(8).optional(),
    cooldown: z.array(z.string().max(400)).max(4).optional(),
    finish: z.array(z.string().max(400)).max(4).optional(),
  })
  .strict();
export type VoiceSuggestions = z.infer<typeof voiceSuggestionsSchema>;
/** The suggestions that pass every wording check and are not already in the style. */
export function checkedSuggestions(raw: VoiceSuggestions, style: VoiceStyle) {
  const accepted: Record<SuggestionField, string[]> = {
    intro: [],
    warmup: [],
    encouragement: [],
    cooldown: [],
    finish: [],
  };
  const rejected: Array<{ field: SuggestionField; text: string; issues: PhraseIssue[] }> = [];
  for (const field of SUGGESTION_FIELDS)
    for (const text of (raw[field] ?? []).map((t) => String(t).trim())) {
      const issues = phraseIssues(text);
      if (issues.length) rejected.push({ field, text, issues });
      else if (!style[field].includes(text) && !accepted[field].includes(text))
        accepted[field].push(text);
    }
  return { accepted, rejected };
}
export type RejectedLine = {
  source: "trainer" | "cue";
  text: string;
  issues: PhraseIssue[];
};

/**
 * Builds the session script. Numbers come only from the plan; free lines come
 * from the trainer's saved phrases when they pass the checks, then a safe
 * default for the tone. Nothing the model wrote is spoken unless the trainer
 * approved it into the style.
 */
export function buildSessionScript(input: {
  title: string;
  exercises: PlanExercise[];
  style?: VoiceStyle;
}): { script: SessionScript; rejected: RejectedLine[] } {
  const style = input.style ?? defaultVoiceStyle();
  const defaults = DEFAULTS[style.tone];
  const rejected: RejectedLine[] = [];
  const accept = (texts: string[] | undefined) =>
    (texts ?? []).map((t) => String(t).trim()).filter((text) => {
      const issues = phraseIssues(text);
      if (issues.length) rejected.push({ source: "trainer", text, issues });
      return !issues.length;
    });
  const pick = (trainer: string[], fallback: string[]) => {
    const fromTrainer = accept(trainer);
    if (fromTrainer.length)
      return fromTrainer.map((text) => ({ text, owner: "trainer" as const }));
    return fallback.map((text) => ({ text, owner: "code" as const }));
  };
  const lines = (
    prefix: string,
    kind: LineKind,
    picked: Array<{ text: string; owner: LineOwner }>,
  ): ScriptLine[] =>
    picked.map((p, i) => ({ id: `${prefix}:${i}`, kind, owner: p.owner, text: p.text }));
  const intro = pick(style.intro, [defaults.intro]).slice(0, 2);
  const encouragement = pick(style.encouragement, defaults.encouragement);
  const genericForm = accept(style.formReminders);
  const exercises: ScriptExercise[] = input.exercises.map((ex, index) => {
    const form = genericForm.length
      ? [0, 1]
          .map((k) => genericForm[(index * 2 + k) % genericForm.length])
          .filter((t, k, all) => all.indexOf(t) === k)
          .map((text) => ({ text, owner: "trainer" as const }))
      : [{ text: defaults.form[index % defaults.form.length], owner: "code" as const }];
    let cueLine: ScriptLine | null = null;
    if (ex.cue) {
      const issues = cueIssues(ex.cue);
      if (issues.length) rejected.push({ source: "cue", text: ex.cue, issues });
      else cueLine = { id: `ex:${index}:cue`, kind: "cue", owner: "trainer", text: ex.cue };
    }
    const enc = encouragement.length
      ? [encouragement[index % encouragement.length]]
      : [];
    return {
      ...ex,
      index,
      setup: {
        id: `ex:${index}:setup`,
        kind: "setup",
        owner: "code",
        text: codeLines.setup(ex, index, input.exercises.length),
      },
      cueLine,
      form: lines(`ex:${index}:form`, "form", form),
      setLines: Array.from({ length: ex.sets }, (_, s) => ({
        id: `ex:${index}:set:${s + 1}`,
        kind: "set" as const,
        owner: "code" as const,
        text: codeLines.set(ex, s + 1),
      })),
      rest: { id: `ex:${index}:rest`, kind: "rest", owner: "code", text: codeLines.rest(ex) },
      restEnd: { id: `ex:${index}:rest_end`, kind: "rest_end", owner: "code", text: codeLines.restEnd() },
      encouragement: lines(`ex:${index}:encourage`, "encourage", enc),
    };
  });
  const finish = pick(style.finish, [defaults.finish])[0];
  const script: SessionScript = {
    version: VOICE_SCRIPT_VERSION,
    title: String(input.title || "Workout").trim().slice(0, 120) || "Workout",
    tone: style.tone,
    intro: [
      ...lines("intro", "intro", intro),
      { id: "safety", kind: "safety", owner: "code", text: VOICE_SAFETY_LINE },
    ],
    warmup: lines("warmup", "warmup", pick(style.warmup, defaults.warmup).slice(0, 4)),
    exercises,
    cooldown: lines("cooldown", "cooldown", pick(style.cooldown, defaults.cooldown).slice(0, 4)),
    finish: { id: "finish", kind: "finish", owner: finish.owner, text: finish.text },
    rules: { ...style.adjustments },
  };
  return { script, rejected };
}

/** Every spoken line in play order. */
export function scriptLines(script: SessionScript): ScriptLine[] {
  return [
    ...script.intro,
    ...script.warmup,
    ...script.exercises.flatMap((ex) => [
      ex.setup,
      ...(ex.cueLine ? [ex.cueLine] : []),
      ...ex.form,
      ...ex.setLines,
      ex.rest,
      ex.restEnd,
      ...ex.encouragement,
    ]),
    ...script.cooldown,
    script.finish,
  ];
}

/**
 * The lines a runner can actually play: the rest prompts of an exercise with
 * no rest, or of a single-set final exercise, are never spoken, so no audio is
 * made for them.
 */
export function spokenLines(script: SessionScript): ScriptLine[] {
  const last = script.exercises.length - 1;
  const silent = new Set(
    script.exercises
      .filter((ex, i) => ex.restSeconds <= 0 || (i === last && ex.sets === 1))
      .flatMap((ex) => [ex.rest.id, ex.restEnd.id]),
  );
  return scriptLines(script).filter((line) => !silent.has(line.id));
}
/**
 * Re-checks a stored script against the workout's plan. Returns the problems;
 * an empty list means the script may be spoken and paid for.
 */
export function scriptIssues(script: SessionScript, plan: PlanExercise[]): string[] {
  const issues: string[] = [];
  if (!script || script.version !== VOICE_SCRIPT_VERSION) return ["version"];
  if (!voiceAdjustmentRulesSchema.safeParse(script.rules).success) return ["rules"];
  if (!Array.isArray(script.exercises) || script.exercises.length !== plan.length)
    return ["exercise_count"];
  const all = scriptLines(script);
  if (all.length > 400) issues.push("too_many_lines");
  if (all.reduce((n, l) => n + String(l?.text ?? "").length, 0) > 30000)
    issues.push("too_long");
  const ids = new Set<string>();
  for (const line of all) {
    if (!line || typeof line.text !== "string" || !/^[a-z0-9_:.-]{1,60}$/.test(line.id))
      issues.push("line_shape");
    else if (ids.has(line.id)) issues.push("duplicate_line:" + line.id);
    else ids.add(line.id);
  }
  const expectCode = (line: ScriptLine | undefined, text: string, id: string) => {
    if (!line || line.owner !== "code" || line.text !== text) issues.push("changed:" + id);
  };
  plan.forEach((ex, index) => {
    const s = script.exercises[index];
    if (
      !s ||
      s.name !== ex.name ||
      s.sets !== ex.sets ||
      s.reps !== ex.reps ||
      s.loadKg !== ex.loadKg ||
      s.restSeconds !== ex.restSeconds
    ) {
      issues.push("prescription:" + index);
      return;
    }
    expectCode(s.setup, codeLines.setup(ex, index, plan.length), `ex:${index}:setup`);
    if (!Array.isArray(s.setLines) || s.setLines.length !== ex.sets)
      issues.push("set_count:" + index);
    else s.setLines.forEach((l, k) => expectCode(l, codeLines.set(ex, k + 1), `ex:${index}:set:${k + 1}`));
    expectCode(s.rest, codeLines.rest(ex), `ex:${index}:rest`);
    expectCode(s.restEnd, codeLines.restEnd(), `ex:${index}:rest_end`);
    if (s.cueLine && (s.cueLine.text !== ex.cue || cueIssues(s.cueLine.text).length))
      issues.push("cue:" + index);
  });
  const safety = script.intro?.find((l) => l.kind === "safety");
  if (!safety || safety.text !== VOICE_SAFETY_LINE || safety.owner !== "code")
    issues.push("safety_line");
  const free = all.filter(
    (l) => l && !["setup", "set", "rest", "rest_end", "safety", "cue"].includes(l.kind),
  );
  for (const line of free) {
    const found = phraseIssues(line.text);
    if (found.length) issues.push(`wording:${line.id}:${found.join(",")}`);
    if (line.owner !== "code" && line.owner !== "trainer") issues.push("owner:" + line.id);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Adjustment bounds and short reusable clips.
// ---------------------------------------------------------------------------
const halfDown = (kg: number) => Math.max(0, Math.floor(kg * 2 + 1e-9) / 2);
/** The lowest load a "too heavy" reply may set for this exercise, or null when not allowed. */
export function reducedLoad(prescribedKg: number, rules: VoiceAdjustmentRules) {
  if (!rules.tooHeavyReducePercent || prescribedKg <= 0) return null;
  const next = halfDown(prescribedKg * (1 - rules.tooHeavyReducePercent / 100));
  return next < prescribedKg ? next : null;
}
/** A client-reported adjustment is valid only within the plan and the trainer's rule. */
export function adjustmentAllowed(
  prescribed: { reps: number; loadKg: number },
  to: { reps: number; loadKg: number },
  rules: VoiceAdjustmentRules,
) {
  const floor = reducedLoad(prescribed.loadKg, rules);
  return (
    floor !== null &&
    to.reps === prescribed.reps &&
    Number.isFinite(to.loadKg) &&
    to.loadKg <= prescribed.loadKg &&
    to.loadKg >= floor &&
    Math.abs(to.loadKg * 2 - Math.round(to.loadKg * 2)) < 1e-9
  );
}
/** Short reusable phrases in the trainer's voice for the dynamic parts of a session. */
export const SHARED_PHRASES: Record<string, string> = {
  point_five: "point five",
  kilograms: "kilograms",
  reps: "reps",
  rest: "Rest.",
  next_set: "Next set.",
  last_set: "Last set.",
  go: "Go.",
  ten_seconds: "Ten seconds.",
  countdown: "Three. Two. One.",
  logged: "Logged.",
  skipped: "Skipped.",
  paused: "Paused. Say resume when you are ready.",
  resuming: "Resuming.",
  lighter: "Lighter weight for the next set.",
  check_screen: "Check the new weight on screen.",
  keep_weight: "Your trainer's plan keeps this weight. Say pain if something hurts.",
  no_skip: "Your trainer's plan keeps this part. Say pain if something hurts.",
  noted: "Noted. Your trainer will review it.",
  say_done: "Say done when you finish the set, or tell me how many reps you did.",
  help: "Say done, a number of reps, too heavy, pause, skip or pain.",
  stopping:
    "Stopping the session now. Your trainer has been told. If your symptoms are severe, get urgent medical help.",
};
export const MAX_NUMBER_CLIP = 100;
/** Every shared clip key and its text: numbers 1 to 100 and the phrases above. */
export function sharedClips(): Array<{ key: string; text: string }> {
  return [
    ...Array.from({ length: MAX_NUMBER_CLIP }, (_, i) => ({
      key: `num:${i + 1}`,
      text: String(i + 1),
    })),
    ...Object.entries(SHARED_PHRASES).map(([key, text]) => ({ key, text })),
  ];
}
/** Shared clip keys that speak a number, or null when no clip covers it. */
export function numberClipKeys(value: number): string[] | null {
  if (!Number.isFinite(value) || value < 1 || value > MAX_NUMBER_CLIP) return null;
  const whole = Math.floor(value),
    fraction = Math.round((value - whole) * 100);
  if (fraction === 0) return [`num:${whole}`];
  if (fraction === 50) return [`num:${whole}`, "point_five"];
  return null;
}
