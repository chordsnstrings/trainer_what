import { structureShape, structureIssues, type StructuredExercise } from "./session-structure.ts";
// Voice-led workout sessions: the structured session script, the trainer's
// voice-session style and the code-owned rules that keep every spoken line
// within the plan. Pure and browser-safe (no Node APIs): the API builds and
// validates scripts, the worker re-validates them before paying for audio and
// the web runner reads them.
import { z } from "zod";
import { cueIssues, MARKUP, phraseIssues, type PhraseIssue } from "./text-screen.ts";
import { EFFORTS, spokenDistance, spokenDuration, workMeasure } from "./prescription.ts";
import { speechLanguage, type SpeechLanguage } from "./speech-language.ts";
import {
  applyNarration,
  brainLines,
  brainScriptIssues,
  oneOnOneSchema,
  type BrainScript,
  type DroppedBrainLine,
  type NarrationFacts,
  type NarrationLines,
} from "./voice-narration.ts";
// The free-wording checks live in text-screen.ts (shared with Brain plans).
export { cueIssues, phraseIssues, type PhraseIssue } from "./text-screen.ts";

export const VOICE_SCRIPT_VERSION = "voice-session-script-v1";
// v2 (29 September 2026): the prompt states the exact keys and how many lines
// each may hold, and the answer is read leniently (readVoiceSuggestions).
export const VOICE_SUGGESTION_PROMPT_VERSION = "voice-session-suggestions-v2";
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
 * phrases, their plan cue, or a Brain suggestion the trainer approved and saved);
 * brain: an extra line the Brain wrote for this session in the style the coach
 * confirmed (voice-narration.ts). Brain lines never carry a prescribed number,
 * count or the safety line; each is re-checked before it is voiced.
 */
export type LineOwner = "code" | "trainer" | "brain";
/** Language is explicit for code templates; trainer wording retains its own language. */
export function lineLanguage(line: { owner: LineOwner; text: string; language?: SpeechLanguage }): SpeechLanguage {
  return line.language ?? (line.owner === "code" ? "en" : speechLanguage(line.text));
}
export type ScriptLine = {
  language?: SpeechLanguage;
  id: string;
  kind: LineKind;
  owner: LineOwner;
  text: string;
};
export type PlanExercise = StructuredExercise & {
  name: string;
  /** Sets of rep work; rounds of timed or distance work. */
  sets: number;
  /** Reps per set; 0 for timed or distance work. */
  reps: number;
  /** Work per round of timed work (the runner keeps the clock). */
  durationSeconds?: number;
  /** Distance per round of distance work (the member says done). */
  distanceMeters?: number;
  paceSecondsPerKm?: number;
  effort?: string;
  loadKg: number;
  restSeconds: number;
  rir: number;
  cue: string;
  demonstrationUrl?: string;
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
  /** Brain lines: after the setup, in the first rest, before the last set. */
  brain?: { lead?: ScriptLine; rest?: ScriptLine; lastSet?: ScriptLine };
};
export type SessionScript = {
  language?: SpeechLanguage;
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
  /** Present when the Brain wrote lines for this session: the facts they may use. */
  brain?: BrainScript;
};

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
    /**
     * "Your one-on-one sessions": the coach's answers and the style they
     * confirmed. Saved only through its own endpoints; the style form keeps it.
     */
    oneOnOne: oneOnOneSchema.optional(),
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
  const result = list.map((ex: any) => {
    const structure = z.object(structureShape).safeParse(ex);
    if (!structure.success) throw new PlanError("Invalid session structure");
    const name = String(ex?.name ?? "").trim();
    // Timed work (a hold, an interval, a continuous run) and distance work
    // have no reps: the runner times a round or waits for "done".
    const measure = workMeasure(ex ?? {});
    const sets = count(ex?.sets, 1, 10),
      reps = measure === "reps" ? count(ex?.reps, 1, 100) : 0,
      durationSeconds = measure === "time" ? count(ex?.durationSeconds, 5, 7200) : null,
      distanceMeters = measure === "distance" ? count(ex?.distanceMeters, 10, 50000) : null,
      pace = ex?.paceSecondsPerKm == null ? null : count(ex.paceSecondsPerKm, 120, 1200),
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
      (measure === "time" && (durationSeconds === null || !Number.isInteger(durationSeconds))) ||
      (measure === "distance" && (distanceMeters === null || !Number.isInteger(distanceMeters))) ||
      loadKg === null ||
      restSeconds === null ||
      !Number.isInteger(restSeconds) ||
      rir === null
    )
      throw new PlanError(
        "An exercise in this workout is missing its sets, reps, time or distance, or its rest, so it cannot be voiced.",
      );
    return {
      name,
      sets,
      reps,
      ...(ex.instanceId ? { instanceId: ex.instanceId } : {}),
      ...(ex.block ? { block: ex.block } : {}),
      ...(ex.side ? { side: ex.side } : {}),
      ...(ex.group ? { group: ex.group } : {}),
      ...(measure === "time" ? { durationSeconds: durationSeconds! } : {}),
      ...(measure === "distance" ? { distanceMeters: distanceMeters! } : {}),
      ...(measure !== "reps" && pace !== null && Number.isInteger(pace) ? { paceSecondsPerKm: pace } : {}),
      ...(measure !== "reps" && typeof ex?.effort === "string" && (EFFORTS as readonly string[]).includes(ex.effort)
        ? { effort: ex.effort as string }
        : {}),
      loadKg: Math.round(loadKg * 100) / 100,
      restSeconds,
      rir,
      cue: typeof ex?.cue === "string" ? ex.cue.trim() : "",
      ...(typeof ex?.demonstrationUrl === "string" && /^https:\/\/[^\s]+$/i.test(ex.demonstrationUrl) ? { demonstrationUrl: ex.demonstrationUrl } : {}),
    };
  });
  if (structureIssues(result).length) throw new PlanError(structureIssues(result).join(". "));
  return result;
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
/** One round of timed or distance work, spoken: "1 minute", "500 metres at 16 kilograms". */
export function spokenWork(ex: PlanExercise, loadKg = ex.loadKg) {
  const work =
    workMeasure(ex) === "time"
      ? spokenDuration(ex.durationSeconds!)
      : spokenDistance(ex.distanceMeters!);
  return `${work}${loadKg > 0 ? ` at ${formatLoad(loadKg)} kilograms` : ""}`;
}
/** Effort and pace of timed or distance work: ", easy effort, pace 6 minutes 30 seconds per kilometre". */
const effortAndPace = (ex: PlanExercise) =>
  (ex.effort ? `, ${ex.effort} effort` : "") +
  (ex.paceSecondsPerKm ? `, pace ${spokenDuration(ex.paceSecondsPerKm)} per kilometre` : "");
/** Whether the runner keeps the clock for this exercise's rounds. */
export const timedExercise = (ex: PlanExercise) => workMeasure(ex) === "time";
/** The exact code-owned wording; validation compares against it. */
const englishCodeLines = {
  setup: (ex: PlanExercise, index: number, total: number) =>
    `${index === total - 1 && total > 1 ? "Last exercise" : `Exercise ${index + 1} of ${total}`}: ${ex.name}${ex.side && ex.side !== "both" ? `, ${ex.side} side` : ""}${ex.block && ex.block !== "main" ? `, ${ex.block}` : ""}${ex.group ? `, ${ex.group.kind} ${ex.group.id}` : ""}. ${
      workMeasure(ex) === "reps"
        ? `${ex.sets} ${ex.sets === 1 ? "set" : "sets"} of ${target(ex.reps, ex.loadKg)}`
        : `${ex.sets === 1 ? "" : `${ex.sets} rounds of `}${spokenWork(ex)}${effortAndPace(ex)}`
    }.`,
  set: (ex: PlanExercise, set: number) =>
    workMeasure(ex) === "reps"
      ? `Set ${set} of ${ex.sets}. ${target(ex.reps, ex.loadKg)}. Say done when you finish, or tell me how many reps you did.`
      : `${ex.sets === 1 ? "" : `Round ${set} of ${ex.sets}. `}${spokenWork(ex)}. ${
          timedExercise(ex)
            ? "The clock starts now. Say done if you stop early."
            : "Say done to confirm the full distance, or enter the actual distance on screen."
        }`,
  rest: (ex: PlanExercise) =>
    ex.restSeconds > 0
      ? `Rest ${restPhrase(ex.restSeconds)}.`
      : "No rest here. Move straight on when you are ready.",
  restEnd: () => "Rest is over. Get ready.",
};

export const AR_SAFETY_LINE = "إذا شعرت بألم أو دوخة أو توعك، قل ألم أو اضغط إيقاف. سأوقف الجلسة وأبلغ مدربك.";
const AR_DEFAULTS = {
  intro: "أهلاً بك. سأرشدك خلال تمرين اليوم.",
  warmup: ["ابدأ بحركة خفيفة للإحماء. قل انتهيت عندما تكون مستعداً."],
  encouragement: ["أحسنت.", "أداء جيد."],
  form: ["حافظ على حركة هادئة ومتحكم بها."],
  cooldown: ["انتهى التمرين. امش بهدوء ودع تنفسك يستقر."],
  finish: "اكتملت الجلسة. أحسنت اليوم.",
};
const arabicTarget = (ex: PlanExercise) => `${ex.durationSeconds ? `${ex.durationSeconds} ثانية` : ex.distanceMeters ? `${ex.distanceMeters} متر` : `${ex.reps} تكرار`}${ex.loadKg > 0 ? ` بوزن ${ex.loadKg} كيلوغرام` : ""}`;
export const codeLines = {
  setup: (ex: PlanExercise, index: number, total: number, language: SpeechLanguage = "en") => language === "ar"
    ? `التمرين ${index + 1} من ${total}: ${ex.name}${ex.side && ex.side !== "both" ? ex.side === "left" ? "، الجانب الأيسر" : "، الجانب الأيمن" : ""}${ex.block === "warmup" ? "، إحماء" : ex.block === "cooldown" ? "، تهدئة" : ""}${ex.group ? ex.group.kind === "superset" ? "، مجموعة مزدوجة" : "، دائرة" : ""}. ${ex.sets} جولات، ${arabicTarget(ex)}${ex.effort ? `، شدة ${ex.effort === "easy" ? "خفيفة" : ex.effort === "moderate" ? "متوسطة" : "عالية"}` : ""}${ex.paceSecondsPerKm ? `، وتيرة ${ex.paceSecondsPerKm} ثانية لكل كيلومتر` : ""}.`
    : englishCodeLines.setup(ex,index,total),
  set: (ex: PlanExercise, set: number, language: SpeechLanguage = "en") => language === "ar"
    ? `الجولة ${set} من ${ex.sets}. ${arabicTarget(ex)}. ${ex.durationSeconds ? "يبدأ المؤقت الآن. قل انتهيت إذا توقفت مبكراً." : ex.distanceMeters ? "قل انتهيت عند إكمال المسافة أو أدخل المسافة الفعلية على الشاشة." : "قل انتهيت عند الإكمال أو أخبرني بعدد التكرارات."}`
    : englishCodeLines.set(ex,set),
  rest: (ex: PlanExercise, language: SpeechLanguage = "en") => language === "ar" ? ex.restSeconds ? `استرح ${ex.restSeconds} ثانية.` : "لا توجد راحة هنا. تابع عندما تكون مستعداً." : englishCodeLines.rest(ex),
  restEnd: (language: SpeechLanguage = "en") => language === "ar" ? "انتهت الراحة. استعد." : englishCodeLines.restEnd(),
};

/**
 * Brain wording suggestions (from the published communication rules and the
 * trainer's phrases). They are stored for the trainer's review and are never
 * spoken: only lines the trainer adds to the style are. No per-exercise
 * technique: form and cues stay the trainer's own words.
 */
export const SUGGESTION_FIELDS = ["intro", "warmup", "encouragement", "cooldown", "finish"] as const;
export type SuggestionField = (typeof SUGGESTION_FIELDS)[number];
/** How many suggested lines of each kind are kept (the prompt says so too). */
export const SUGGESTION_LIMITS: Record<SuggestionField, number> = {
  intro: 4,
  warmup: 4,
  encouragement: 8,
  cooldown: 4,
  finish: 4,
};
export const voiceSuggestionsSchema = z
  .object({
    intro: z.array(z.string().max(400)).max(SUGGESTION_LIMITS.intro).optional(),
    warmup: z.array(z.string().max(400)).max(SUGGESTION_LIMITS.warmup).optional(),
    encouragement: z.array(z.string().max(400)).max(SUGGESTION_LIMITS.encouragement).optional(),
    cooldown: z.array(z.string().max(400)).max(SUGGESTION_LIMITS.cooldown).optional(),
    finish: z.array(z.string().max(400)).max(SUGGESTION_LIMITS.finish).optional(),
  })
  .strict();
export type VoiceSuggestions = z.infer<typeof voiceSuggestionsSchema>;
// Other names a model gives the same kinds, compared without case, spaces,
// dashes or underscores ("warmUp", "cool_down", "signOff").
const SUGGESTION_ALIASES = new Map<string, SuggestionField>([
  ["intro", "intro"],
  ["opening", "intro"],
  ["opener", "intro"],
  ["welcome", "intro"],
  ["greeting", "intro"],
  ["warmup", "warmup"],
  ["encouragement", "encouragement"],
  ["encouragements", "encouragement"],
  ["cooldown", "cooldown"],
  ["finish", "finish"],
  ["signoff", "finish"],
  ["closing", "finish"],
  ["farewell", "finish"],
  ["outro", "finish"],
]);
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
/**
 * The model's suggestions, read leniently. In the model trial (29 September
 * 2026) the answers for a bilingual trainer from two providers were refused
 * whole because one kind had five lines where four are kept, a third provider
 * answered one line per kind as a plain string, and once put the kinds under
 * "suggestions" with other names ("opening", "warmUp", "coolDown",
 * "signOff"). Here each kind may be a list or one line, under its own name or
 * a known other name, at the top or under "suggestions"; lines past the
 * kind's limit, non-text items and unknown keys are dropped. Nothing read here
 * is spoken: every line still goes through `checkedSuggestions` and the
 * trainer's review. Null when the answer holds none of the kinds (the caller
 * reports the answer as not usable).
 */
export function readVoiceSuggestions(content: unknown): VoiceSuggestions | null {
  if (!isPlainObject(content)) return null;
  const read = (source: Record<string, unknown>) => {
    const lists: Partial<Record<SuggestionField, string[]>> = {};
    for (const key of Object.keys(source)) {
      const field = SUGGESTION_ALIASES.get(key.toLowerCase().replace(/[\s_-]/g, ""));
      if (!field) continue;
      const value = source[key];
      const list: unknown[] = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
      lists[field] = [
        ...(lists[field] ?? []),
        ...list.filter(
          (line): line is string => typeof line === "string" && line.trim().length > 0 && line.length <= 400,
        ),
      ];
    }
    const result: VoiceSuggestions = {};
    for (const field of SUGGESTION_FIELDS) {
      const lines = (lists[field] ?? []).slice(0, SUGGESTION_LIMITS[field]);
      if (lines.length) result[field] = lines;
    }
    return Object.keys(result).length ? result : null;
  };
  const nested = Object.prototype.hasOwnProperty.call(content, "suggestions") ? content.suggestions : null;
  return read(content) ?? (isPlainObject(nested) ? read(nested) : null);
}
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
 *
 * `language` is the member's language. A bilingual trainer's phrases in that
 * language are used first, and phrases in the other language only when the
 * trainer wrote none of that kind in it, so a member does not hear the
 * trainer's English and Arabic lines mixed. Each line is spoken in its own
 * language (`speechLanguage`, docs/features/trainer-voice.md).
 */
export function buildSessionScript(input: {
  title: string;
  exercises: PlanExercise[];
  style?: VoiceStyle;
  language?: SpeechLanguage;
  /** The Brain's lines for this session and the facts they may use. */
  narration?: { lines: NarrationLines; facts: NarrationFacts; never?: readonly string[] } | null;
}): {
  script: SessionScript;
  rejected: RejectedLine[];
  brain?: { added: number; dropped: DroppedBrainLine[] };
} {
  const style = input.style ?? defaultVoiceStyle();
  const language = input.language ?? "en";
  const defaults = language === "ar" ? AR_DEFAULTS : DEFAULTS[style.tone];
  const rejected: RejectedLine[] = [];
  const prefer = (texts: string[]) => {
    if (!input.language) return texts;
    const own = texts.filter((text) => speechLanguage(text) === input.language);
    return own.length ? own : texts;
  };
  const accept = (texts: string[] | undefined) =>
    prefer(
      (texts ?? []).map((t) => String(t).trim()).filter((text) => {
        const issues = phraseIssues(text);
        if (issues.length) rejected.push({ source: "trainer", text, issues });
        return !issues.length;
      }),
    );
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
        text: codeLines.setup(ex, index, input.exercises.length, language),
      },
      cueLine,
      form: lines(`ex:${index}:form`, "form", form),
      setLines: Array.from({ length: ex.sets }, (_, s) => ({
        id: `ex:${index}:set:${s + 1}`,
        kind: "set" as const,
        owner: "code" as const,
        text: codeLines.set(ex, s + 1, language),
      })),
      rest: { id: `ex:${index}:rest`, kind: "rest", owner: "code", text: codeLines.rest(ex, language) },
      restEnd: { id: `ex:${index}:rest_end`, kind: "rest_end", owner: "code", text: codeLines.restEnd(language) },
      encouragement: lines(`ex:${index}:encourage`, "encourage", enc),
    };
  });
  const finish = pick(style.finish, [defaults.finish])[0];
  const script: SessionScript = {
    version: VOICE_SCRIPT_VERSION,
    ...(language === "ar" ? { language } : {}),
    title: String(input.title || "Workout").trim().slice(0, 120) || "Workout",
    tone: style.tone,
    intro: [
      ...lines("intro", "intro", intro),
      { id: "safety", kind: "safety", owner: "code", text: language === "ar" ? AR_SAFETY_LINE : VOICE_SAFETY_LINE },
    ],
    warmup: lines("warmup", "warmup", pick(style.warmup, input.exercises.some(e => e.block === "warmup") ? [] : defaults.warmup).slice(0, 4)),
    exercises,
    cooldown: lines("cooldown", "cooldown", pick(style.cooldown, input.exercises.some(e => e.block === "cooldown") ? [] : defaults.cooldown).slice(0, 4)),
    finish: { id: "finish", kind: "finish", owner: finish.owner, text: finish.text },
    rules: { ...style.adjustments },
  };
  if (language === "ar") for (const line of scriptLines(script)) if (line.owner === "code") line.language = language;
  if (!input.narration) return { script, rejected };
  const narrated = applyNarration(script, input.exercises, input.narration);
  return {
    script: narrated.script,
    rejected,
    brain: { added: narrated.added, dropped: narrated.dropped },
  };
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
      ...[ex.brain?.lead, ex.brain?.rest, ex.brain?.lastSet].filter((l): l is ScriptLine => !!l),
    ]),
    ...script.cooldown,
    script.finish,
    ...(script.brain?.struggle ? [script.brain.struggle] : []),
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
      .flatMap((ex) => [ex.rest.id, ex.restEnd.id, ...(ex.brain?.rest ? [ex.brain.rest.id] : [])]),
  );
  return scriptLines(script).filter((line) => !silent.has(line.id));
}
/**
 * Re-checks a stored script against the workout's plan. Returns the problems;
 * an empty list means the script may be spoken and paid for.
 */
export function scriptIssues(script: SessionScript, plan: PlanExercise[]): string[] {
  const issues: string[] = [];
  const language = script?.language ?? "en";
  if (!["en","ar"].includes(language)) return ["language"];
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
    if (line?.owner === "code" && lineLanguage(line) !== language) issues.push("line_language:" + line.id);
  }
  const expectCode = (line: ScriptLine | undefined, text: string, id: string) => {
    if (!line || line.owner !== "code" || line.text !== text) issues.push("changed:" + id);
  };
  plan.forEach((ex, index) => {
    const s = script.exercises[index];
    if (
      !s ||
      s.name !== ex.name ||
      s.instanceId !== ex.instanceId || s.block !== ex.block || s.side !== ex.side ||
      JSON.stringify(s.group) !== JSON.stringify(ex.group) ||
      s.sets !== ex.sets ||
      s.reps !== ex.reps ||
      s.durationSeconds !== ex.durationSeconds ||
      s.distanceMeters !== ex.distanceMeters ||
      s.paceSecondsPerKm !== ex.paceSecondsPerKm ||
      s.effort !== ex.effort ||
      s.loadKg !== ex.loadKg ||
      s.restSeconds !== ex.restSeconds
    ) {
      issues.push("prescription:" + index);
      return;
    }
    expectCode(s.setup, codeLines.setup(ex, index, plan.length, language), `ex:${index}:setup`);
    if (!Array.isArray(s.setLines) || s.setLines.length !== ex.sets)
      issues.push("set_count:" + index);
    else s.setLines.forEach((l, k) => expectCode(l, codeLines.set(ex, k + 1, language), `ex:${index}:set:${k + 1}`));
    expectCode(s.rest, codeLines.rest(ex, language), `ex:${index}:rest`);
    expectCode(s.restEnd, codeLines.restEnd(language), `ex:${index}:rest_end`);
    if (s.cueLine && (s.cueLine.text !== ex.cue || cueIssues(s.cueLine.text).length))
      issues.push("cue:" + index);
  });
  issues.push(...structureIssues(plan));
  const safety = script.intro?.find((l) => l.kind === "safety");
  if (!safety || safety.text !== (language === "ar" ? AR_SAFETY_LINE : VOICE_SAFETY_LINE) || safety.owner !== "code")
    issues.push("safety_line");
  // Brain lines: only in their own slots, each re-checked against the plan
  // and the facts stored with the script (numbers, length, wording).
  // A "brain" owner anywhere else is refused below with the other owners.
  const brain = new Set(brainLines(script));
  issues.push(...brainScriptIssues(script, plan));
  const free = all.filter(
    (l) => l && !brain.has(l) && !["setup", "set", "rest", "rest_end", "safety", "cue"].includes(l.kind),
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
  time_up: "Time.",
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
    "Stopping the session now. Your report will be sent to your trainer. If your symptoms are severe, get urgent medical help.",
};
export const AR_SHARED_PHRASES: Record<string,string> = {
  point_five: "فاصلة خمسة", kilograms: "كيلوغرام", reps: "تكرار", rest: "استرح.",
  next_set: "المجموعة التالية.", last_set: "المجموعة الأخيرة.", go: "ابدأ.", time_up: "انتهى الوقت.",
  ten_seconds: "عشر ثوانٍ.", countdown: "ثلاثة. اثنان. واحد.", logged: "تم التسجيل.", skipped: "تم التخطي.",
  paused: "تم الإيقاف مؤقتاً. قل تابع عندما تكون مستعداً.", resuming: "نتابع الآن.", lighter: "وزن أخف للمجموعة التالية.",
  check_screen: "تحقق من الوزن الجديد على الشاشة.", keep_weight: "خطة مدربك تبقي هذا الوزن. قل ألم إذا تألمت.",
  no_skip: "خطة مدربك تبقي هذا الجزء. قل ألم إذا تألمت.", noted: "تم التدوين. سيراجع مدربك ذلك.",
  say_done: "قل انتهيت عند إكمال المجموعة أو أخبرني بعدد التكرارات.", help: "قل انتهيت أو عدد التكرارات أو ثقيل أو توقف مؤقتاً أو تخط أو ألم.",
  stopping: "سأوقف الجلسة الآن وأرسل بلاغك إلى مدربك. إذا كانت الأعراض شديدة، اطلب مساعدة طبية عاجلة.",
};
export const MAX_NUMBER_CLIP = 100;
/** Every shared clip key and its text: numbers 1 to 100 and the phrases above. */
export function sharedClips(language: SpeechLanguage = "en"): Array<{ key: string; text: string }> {
  return [
    ...Array.from({ length: MAX_NUMBER_CLIP }, (_, i) => ({
      key: `num:${i + 1}`,
      text: String(i + 1),
    })),
    ...Object.entries(language === "ar" ? AR_SHARED_PHRASES : SHARED_PHRASES).map(([key, text]) => ({ key, text })),
  ].map(clip => ({ ...clip, key: language === "ar" ? `ar:${clip.key}` : clip.key }));
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
