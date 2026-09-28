// The hands-free session runner as a pure state machine, and the spoken-reply
// parser. The web component only plays what `step` asks for, runs the clock and
// performs the effects (log a set through the device queue, report pain, finish).
// Browser-safe: no Node APIs.
import { safetySignal, screeningText } from "./index.ts";
import {
  formatLoad,
  numberClipKeys,
  reducedLoad,
  type ScriptLine,
  type SessionScript,
  type VoiceAdjustmentRules,
} from "./voice-session.ts";

// ---------------------------------------------------------------------------
// Spoken replies.
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
  | { type: "pain"; transcript: string }
  | { type: "unknown" };

const B = "(?:^|[^\\p{L}\\p{N}])",
  E = "(?![\\p{L}\\p{N}])";
const has = (alternatives: string) => new RegExp(B + "(?:" + alternatives + ")" + E, "iu");
// Reported discomfort beyond the code floor's red flags. Pain, hurt, injury,
// dizziness and fainting (with routine negations such as "no pain") are read
// by `safetySignal`, in English and Arabic.
const PAIN = has(
  "ouch|ow|twinge|tweaked|cramp\\p{L}*|feel(?:ing)?\\s+sick|nause\\p{L}*|something\\s+(?:is\\s+)?wrong",
);
const EFFORT_HEAVY = "heavy|hard|much|ثقيل|ثقيله|صعب|صعبه",
  EFFORT_EASY = "easy|light|سهل|سهله|خفيف";
const TOO_HEAVY = has(
  "too\\s+heavy|heavy|too\\s+hard|too\\s+much|can'?t\\s+(?:lift|do\\s+it|finish|manage)|cannot\\s+(?:lift|finish)|struggling|ثقيل|ثقيله|صعب|صعبه",
);
const TOO_EASY = has("too\\s+(?:easy|light)|easy|light|سهل|سهله|خفيف");
// "Not heavy", "it's not too heavy", "wasn't that hard": negated effort words
// are removed before the too-heavy and too-easy checks.
const NEGATED_EFFORT = new RegExp(
  B +
    "(?:not|isn'?t|wasn'?t|never|مو|مش|ما|ليس|مب)\\s+(?:(?:that|so|too|very|really|it'?s|it|is|was|feel|feels|felt|at\\s+all)\\s+){0,3}(?:" +
    EFFORT_HEAVY +
    "|" +
    EFFORT_EASY +
    ")" +
    E,
  "giu",
);
const SKIP = has("skip|next\\s+exercise|pass|move\\s+on|تخطى|تخطي|تجاوز|التالي");
const PAUSE = has("pause|wait|hold\\s+on|stop|break|one\\s+moment|hang\\s+on|توقف|وقف|انتظر|لحظه");
// Asking to carry on. Never a set completion.
const RESUME = has("resume|continue|carry\\s+on|go\\s+on|ready|start|let'?s\\s+go|go|next|كمل|استمر|جاهز|يلا|ابدا");
const REPEAT = has("repeat|again|say\\s+again|what|pardon|sorry|اعد|كرر|عيد");
// Only explicit completion words finish a set.
const COMPLETE = has(
  "done|finished|finish|complete|completed|that'?s\\s+it|that\\s+is\\s+it|تم|خلصت|انتهيت|خلاص",
);
const ACK = has("yes|yeah|yep|yup|ok|okay|sure|alright|all\\s+right|got\\s+it|fine|right|نعم|اوكي|تمام|طيب");
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
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  عشرين: 20, ثلاثين: 30, اربعين: 40, خمسين: 50,
};
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const westernDigits = (text: string) =>
  text.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));
// A number is a rep count unless it names a set or exercise ("set 1 of 3") or
// a load or time ("60 kilograms", "30 seconds").
const NOT_REPS_BEFORE = new Set(["set", "sets", "of", "exercise", "round", "number", "مجموعه", "من"]);
const NOT_REPS_AFTER =
  /^(?:kg|kgs|kilo|kilos|kilogram|kilograms|lb|lbs|pound|pounds|percent|%|seconds?|secs?|minutes?|mins?|sets?|rounds?|كيلو|كيلوغرام|ثانيه|ثواني|دقيقه|دقائق)$/u;
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
    if (digits) {
      value = Number(digits[1]);
      unit = digits[2] || undefined;
    } else if (t in TENS) {
      const next = tokens[i + 1];
      const units = next && next in UNITS && UNITS[next] < 10 ? UNITS[next] : 0;
      value = TENS[t] + units;
      if (units) width = 2;
    } else if (t in UNITS) value = UNITS[t];
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
 * acknowledgements never complete a set, and a rep count wins over "heavy" in
 * the same reply (the heaviness is kept as a flag).
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
  const reps = spokenNumber(folded);
  if (reps !== null && reps <= 200 && !skip && !pause)
    return heavy ? { type: "reps", reps, heavy: true } : { type: "reps", reps };
  if (heavy) return { type: "too_heavy" };
  if (TOO_EASY.test(effort)) return { type: "too_easy" };
  if (skip) return { type: "skip" };
  if (pause) return { type: "pause" };
  if (REPEAT.test(folded)) return { type: "repeat" };
  if (COMPLETE.test(folded)) return { type: "done" };
  if (RESUME.test(folded)) return { type: "resume" };
  if (ACK.test(folded)) return { type: "ack" };
  return { type: "unknown" };
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
    | "completed";
  exercise?: number;
  set?: number;
  fromKg?: number;
  toKg?: number;
  reps?: number;
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
      reps: number;
      loadKg: number;
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
    { ...s, phase: "set", exercise, set, restRemaining: 0, setElapsed: 0 },
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
function logSet(ctx: RunnerContext, s: RunnerState, reps: number): [RunnerState, RunnerEffect[]] {
  const ex = ctx.script.exercises[s.exercise];
  const t = s.targets[s.exercise][s.set - 1];
  const k = key(s.exercise, s.set);
  if (s.logged.includes(k)) return afterSet(ctx, s, [], true);
  const logged: RunnerState = { ...s, logged: [...s.logged, k], encouragement: s.encouragement + 1 };
  const enc = ex.encouragement.length ? ex.encouragement[s.encouragement % ex.encouragement.length] : null;
  return afterSet(
    ctx,
    logged,
    [
      { type: "log_set", exerciseIndex: s.exercise, exercise: ex.name, set: s.set, reps, loadKg: t.loadKg },
      outcome({ type: "set_logged", exercise: s.exercise, set: s.set, reps, toKg: t.loadKg }),
      say([enc], enc ? [] : ["logged"], enc ? [] : ["Logged."], false),
    ],
    true,
  );
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
  if (s.phase === "paused") {
    if (event.type === "command" && ["resume", "done"].includes(event.command.type)) {
      const back = s.resume ?? "set";
      const resumed: RunnerState = { ...s, phase: back, resume: undefined };
      if (back === "set") {
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
    return [s, s.phase === "set" ? [sayDone()] : []];
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
    case "set":
      if (event.type === "tick") return [{ ...s, setElapsed: s.setElapsed + Math.max(0, event.seconds) }, []];
      if (event.type !== "command") return [s, []];
      switch (event.command.type) {
        // Only an explicit completion or a rep count logs the set.
        case "done":
          return logSet(ctx, s, s.targets[s.exercise][s.set - 1].reps);
        case "resume":
          return [s, [sayDone()]];
        case "reps": {
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
          const skipped = { ...s, skipped: [...s.skipped, key(s.exercise, s.set)] };
          return afterSet(ctx, skipped, [phrase("skipped", "Skipped."), outcome({ type: "skipped_set", exercise: s.exercise, set: s.set })], false);
        }
      }
      return [s, []];
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
    case "set":
      return `${ex.name}, set ${s.set} of ${ex.sets}: ${t.reps} reps${t.loadKg > 0 ? ` at ${formatLoad(t.loadKg)} kg` : ""}.`;
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
