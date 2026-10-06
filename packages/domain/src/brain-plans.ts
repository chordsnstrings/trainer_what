import { structureShape, structureIssues, type StructuredExercise } from "./session-structure.ts";
import { z } from "zod";
import { addTrainingDays, canonicalCoaching } from "./coaching-completion.ts";
import { safetySignal, screeningText } from "./red-flags.ts";
import {
  continuousWork,
  EFFORTS,
  formatDistance,
  formatDuration,
  formatPace,
  measureCount,
  totalMeters,
  totalSeconds,
  workMeasure,
  workSeconds,
  type Effort,
  type PrescribedWork,
} from "./prescription.ts";
import {
  givesMedicalAdvice,
  MEDICAL_ADVICE,
  MEMBER_MEDICAL,
  modelCueIssues,
  numbersNotGrounded,
  proseIssues,
} from "./text-screen.ts";

/**
 * Trainer Brain plan generation: the model's structured output, the code
 * validator (schema plus hard bounds), deterministic confidence and the
 * review diff. Nothing here trusts a model number: every bound is checked in
 * code against the trainer's settings and library.
 */
// v2: the prompt carries the week-1 starting-load references the validator
// enforces (logged or library loads, and the start cap without one).
// v3: timed and distance work (durationSeconds, distanceMeters, pace, effort;
// sets are rounds), member-facing wording rules for the summary, explicit
// pregnancy, exclusion and progression safety rules, and short evidence
// references (R1, X1, P1, T1) instead of UUIDs (prompt-refs.ts).
// v4 (trial tuning, 30 September 2026): alternatives need the member's
// equipment and an exercise appears once per session; cues hold
// no numbers or warnings and reps are per side for single-limb work; the
// weekly cap is explained after rounding; the session-length estimate and
// bounds.maxSessionMinutes are stated; uncertainties fit the schema.
// v5 (round 5, 1 October 2026): an optional memberMemory block (code-built
// from the member's own logs, member-memory.ts) is data, never instructions,
// and never overrides the trainer's rules, bounds, starting loads or safety.
// v6: member weekdays/time limits and instance-aware blocks, sides and groups.
export const planPromptVersion = "brain-plan-v6";
// v2: timed and distance changes, no increases after missed sessions or a
// harder-than-planned week (the code-computed progressionHold is sent), and
// short evidence references.
// v3 (trial tuning, 30 September 2026): every session stays within
// bounds.maxSessionMinutes by the stated estimate (a longer next week is
// shortened, never made harder), and uncertainties fit the schema.
// v4 (round 5, 1 October 2026): the optional memberMemory block, as for plans.
export const planAdaptationPromptVersion = "brain-plan-adapt-v4";
// v3: time and distance prescriptions, rest 0 only for one continuous bout,
// weekly and per-exercise timed-work and distance progression caps.
// v4 (N1, 30 September 2026): within a draft the weekly limit is checked on
// the unrounded volume factor; the rounded rise may exceed it by at most one
// rounding unit per exercise (one set, 5 s or 10 m per round).
// v5 (owner decision, 30 September 2026): the rounded rise may exceed the
// limit by at most one rounding unit for the whole week (one set, 5 s or
// 10 m), and each exercise by at most one unit too; a draft over that goes to
// the trainer for review.
export const planValidatorVersion = "brain-plan-validator-v6";
export const planConfidenceVersion = "brain-plan-confidence-v1";
export const planRouteVersion = "brain-plan-route-v2";

const name = z.string().trim().min(2).max(100);
/** Bounds of one set of timed or distance work. */
export const WORK_LIMITS = Object.freeze({
  minDurationSeconds: 5,
  maxDurationSeconds: 7200,
  minDistanceMeters: 10,
  maxDistanceMeters: 50000,
  minPaceSecondsPerKm: 120,
  maxPaceSecondsPerKm: 1200,
  /** Rest below this is refused, except no rest at all after one continuous bout. */
  minRestSeconds: 15,
});
/**
 * Shape problems of one prescription: exactly one of reps, a duration or a
 * distance; a pace only for timed or distance work; and rest of at least 15
 * seconds, except 0 for a single continuous bout of timed or distance work.
 */
export function prescriptionIssues(e: PrescribedWork & { restSeconds: number }) {
  const issues: Array<{ path: string; message: string }> = [];
  if (measureCount(e) !== 1)
    issues.push({ path: "reps", message: "Give exactly one of reps, durationSeconds or distanceMeters" });
  if (e.paceSecondsPerKm != null && workMeasure(e) === "reps")
    issues.push({ path: "paceSecondsPerKm", message: "A pace needs durationSeconds or distanceMeters" });
  if (e.restSeconds < WORK_LIMITS.minRestSeconds && !(continuousWork(e) && e.restSeconds === 0))
    issues.push({
      path: "restSeconds",
      message: `Rest must be at least ${WORK_LIMITS.minRestSeconds} seconds; only one continuous bout of timed or distance work (sets 1) may have 0`,
    });
  return issues;
}
const exerciseShape = {
  ...structureShape,
  name,
  /** Sets of rep work; rounds of timed or distance work. */
  sets: z.number().int().min(1).max(10),
  reps: z.number().int().min(1).max(30).optional(),
  /** Work per set (a hold, an interval or a continuous bout). */
  durationSeconds: z.number().int().min(WORK_LIMITS.minDurationSeconds).max(WORK_LIMITS.maxDurationSeconds).optional(),
  /** Distance per set. */
  distanceMeters: z.number().int().min(WORK_LIMITS.minDistanceMeters).max(WORK_LIMITS.maxDistanceMeters).optional(),
  paceSecondsPerKm: z.number().int().min(WORK_LIMITS.minPaceSecondsPerKm).max(WORK_LIMITS.maxPaceSecondsPerKm).optional(),
  effort: z.enum(EFFORTS).optional(),
  loadKg: z.number().min(0).max(500),
  rir: z.number().int().min(0).max(5),
  restSeconds: z.number().int().min(0).max(600),
  // Library cues may be up to 1000 characters (trainingExerciseSchema).
  cue: z.string().max(1000).default(""),
  alternatives: z.array(name).max(4).default([]),
};
export const planExerciseSchema = z
  .object(exerciseShape)
  .strict()
  .superRefine((e, ctx) => {
    for (const issue of prescriptionIssues(e))
      ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
  });
export const planSessionSchema = z
  .object({
    key: z.string().regex(/^[A-G]$/),
    label: z.string().trim().min(2).max(120),
    weekday: z.number().int().min(0).max(6),
    exercises: z.array(planExerciseSchema).min(1).max(12),
  })
  .strict();
export const planWeekSchema = z
  .object({
    week: z.number().int().min(1).max(53),
    focus: z.string().trim().min(2).max(120),
    volumeFactor: z.number().min(0.4).max(1.6),
    loadFactor: z.number().min(0.5).max(1.3),
    rirDelta: z.number().int().min(-3).max(3),
    deload: z.boolean(),
  })
  .strict();
export const planDraftSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    summary: z.string().trim().max(1500),
    sessions: z.array(planSessionSchema).min(1).max(7),
    weeks: z.array(planWeekSchema).min(1).max(53),
    selfConfidence: z.number().min(0).max(1),
    uncertainties: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
    evidenceIds: z.array(z.string().uuid()).max(30).default([]),
  })
  .strict();
export type PlanExercise = z.infer<typeof planExerciseSchema>;
/** The model's notes for the trainer on a plan draft or an adaptation: at most 10, each at most 300 characters. */
export const UNCERTAINTY_LIMITS = Object.freeze({ notes: 10, characters: 300 });
const TRIMMED_NOTE = " … [trimmed]";
/** Safety words in a trainer note beyond the red-flag floor and medical terms. */
const SAFETY_NOTE = new RegExp(
  "(?:^|[^\\p{L}\\p{N}])(?:injur\\p{L}*|limitation\\p{L}*|clearance|cleared|contraindicat\\p{L}*|pregnan\\p{L}*|postpartum|post-?natal|conditions?|red[\\s-]+flags?|safety|unsafe|risk\\p{L}*|pain\\p{L}*|hurt\\p{L}*|sore\\p{L}*|chest|heart|blood\\s+pressure|dizz\\p{L}*|faint\\p{L}*|breath\\p{L}*|stop\\s+(?:the\\s+)?(?:session|exercise|training))(?![\\p{L}\\p{N}])",
  "iu",
);
/** Whether a note (or the part of one that would be cut) carries a safety point for the trainer. */
export function carriesSafetyPoint(text: string) {
  return safetySignal(text) || MEMBER_MEDICAL.test(screeningText(text)) || SAFETY_NOTE.test(screeningText(text));
}
/**
 * Fits a model reply's `uncertainties` to UNCERTAINTY_LIMITS instead of
 * rejecting the whole draft over a long note: a note over 300 characters is
 * cut and ends with "… [trimmed]", and notes beyond the tenth are dropped,
 * the last kept note saying how many were left out. Notes with a safety point
 * (carriesSafetyPoint) are kept before other notes, and nothing with a safety
 * point is ever cut away: when a cut or a dropped note would hide one, the
 * reply is left as it is (`withheld`) and the schema rejects it, as before
 * the limits were fitted. The note text records the change for the trainer;
 * `trimmed` and `dropped` count it. Anything that is not a list of strings is
 * left for the schema to reject.
 */
export function fitUncertainties<T>(reply: T): { value: T; trimmed: number; dropped: number; withheld: boolean } {
  const unchanged = (withheld: boolean) => ({ value: reply, trimmed: 0, dropped: 0, withheld });
  const notes = (reply as any)?.uncertainties;
  if (!Array.isArray(notes) || !notes.every((n) => typeof n === "string")) return unchanged(false);
  const { notes: most, characters } = UNCERTAINTY_LIMITS;
  let trimmed = 0,
    hidden = false;
  const cut = (note: string, limit: number) => {
    if (note.length <= limit) return note;
    trimmed++;
    const head = note.slice(0, limit - TRIMMED_NOTE.length).trimEnd();
    // The cut part, with the last two words kept so a phrase split by the
    // cut ("chest | pain") is still read whole.
    const from = head.lastIndexOf(" ", head.lastIndexOf(" ") - 1) + 1;
    if (carriesSafetyPoint(note.slice(from))) hidden = true;
    return head + TRIMMED_NOTE;
  };
  const all: string[] = notes.map((n: string) => n.trim());
  let chosen = all;
  if (all.length > most) {
    const safety = all.map((n) => carriesSafetyPoint(n));
    const count = safety.filter(Boolean).length;
    if (count > most) return unchanged(true);
    let others = most - count;
    chosen = all.filter((_, i) => safety[i] || others-- > 0);
  }
  const dropped = all.length - chosen.length;
  const more = dropped ? ` [${dropped} more note${dropped === 1 ? "" : "s"} left out]` : "";
  const kept = chosen.map((n, i) => (i === chosen.length - 1 && more ? cut(n, characters - more.length) + more : cut(n, characters)));
  if (hidden) return unchanged(true);
  if (!trimmed && !dropped) return unchanged(false);
  return { value: { ...(reply as any), uncertainties: kept }, trimmed, dropped, withheld: false };
}
export type PlanSession = z.infer<typeof planSessionSchema>;
export type PlanDraft = z.infer<typeof planDraftSchema>;

/** A trainer's edit is a full draft; the model's own confidence is kept. */
export const planEditSchema = planDraftSchema.omit({
  selfConfidence: true,
  uncertainties: true,
  evidenceIds: true,
});

export const adaptationChangeSchema = z
  .object({
    sessionKey: z.string().regex(/^[A-G]$/),
    exercise: name,
    instanceId: structureShape.instanceId,
    sets: exerciseShape.sets.optional(),
    reps: exerciseShape.reps,
    durationSeconds: exerciseShape.durationSeconds,
    distanceMeters: exerciseShape.distanceMeters,
    paceSecondsPerKm: exerciseShape.paceSecondsPerKm,
    effort: exerciseShape.effort,
    loadKg: exerciseShape.loadKg.optional(),
    rir: exerciseShape.rir.optional(),
    // 0 only fits one continuous bout; the validator checks the changed week.
    restSeconds: exerciseShape.restSeconds.optional(),
    replaceWith: name.optional(),
  })
  .strict();
export const adaptationProposalSchema = z
  .object({
    changes: z.array(adaptationChangeSchema).max(40),
    reason: z.string().trim().min(1).max(1500),
    selfConfidence: z.number().min(0).max(1),
    uncertainties: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
    evidenceIds: z.array(z.string().uuid()).max(30).default([]),
  })
  .strict();
export type AdaptationProposal = z.infer<typeof adaptationProposalSchema>;
/** A week of dated sessions: what adaptation proposes and a trainer edits. */
export const adaptationWeekSchema = z
  .object({
    sessions: z
      .array(
        z
          .object({
            plannedSessionId: z.string().uuid(),
            sessionKey: z.string().regex(/^[A-G]$/),
            exercises: z.array(planExerciseSchema).min(1).max(12),
          })
          .strict(),
      )
      .min(1)
      .max(7),
  })
  .strict();
export type AdaptationWeek = z.infer<typeof adaptationWeekSchema>;

export const planBoundsSchema = z
  .object({
    maxWeeklyVolumeIncreasePct: z.number().min(0).max(50).default(10),
    maxLoadJumpPct: z.number().min(0).max(30).default(10),
    maxSessionMinutes: z.number().int().min(20).max(180).default(75),
    minRestSeconds: z.number().int().min(15).max(300).default(30),
    maxRestSeconds: z.number().int().min(30).max(600).default(240),
    /**
     * Week-1 load limit (kg) for an exercise with no logged history and no
     * library load: the model's starting numbers are never trusted.
     */
    startLoadCapKg: z
      .object({
        beginner: z.number().min(0).max(500).default(20),
        intermediate: z.number().min(0).max(500).default(40),
        advanced: z.number().min(0).max(500).default(60),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .refine((b) => b.minRestSeconds < b.maxRestSeconds, {
    message: "The shortest rest must be below the longest rest",
    path: ["minRestSeconds"],
  });
export type PlanBounds = z.infer<typeof planBoundsSchema>;
export const planSettingsSchema = z
  .object({
    mode: z.enum(["automatic", "supervised"]).default("automatic"),
    threshold: z.number().min(0.5).max(0.99).default(0.8),
    spotCheckRate: z.number().min(0).max(1).default(0.25),
    youngBrainReviews: z.number().int().min(0).max(500).default(20),
    defaultBlockDays: z.number().int().min(7).max(365).default(28),
    bounds: planBoundsSchema.prefault({}),
  })
  .strict();
export type PlanSettings = z.infer<typeof planSettingsSchema>;
export const defaultPlanSettings = (): PlanSettings =>
  planSettingsSchema.parse({});

export const planProfileSchema = z
  .object({
    age: z.number().int().min(18).max(100).optional(),
    goal: z.string().min(3).max(1000),
    experience: z.enum(["beginner", "intermediate", "advanced"]),
    daysPerWeek: z.number().int().min(1).max(7),
    availableWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v => new Set(v).size === v.length, "Choose each weekday once").optional(),
    maxSessionMinutes: z.number().int().min(15).max(180).optional(),
    timezone: z.string().max(100).refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Choose a valid timezone").optional(),

    equipment: z.string().max(1000),
    limitations: z.string().max(2000),
  })
  .strict();
export type PlanProfile = z.infer<typeof planProfileSchema>;
/** A held-out programme scenario: the Brain writes a plan for this profile. */
export const planProgrammeScenarioSchema = z
  .object({
    type: z.literal("programme").optional(),
    title: z.string().trim().min(3).max(150),
    profile: planProfileSchema,
    programmeDays: z.number().int().min(7).max(365),
    expected: z.enum(["deliverable", "review"]),
  })
  .strict();
/**
 * A held-out adaptation scenario: one prescribed week and how it went; the
 * Brain proposes next week's changes, which are routed like a live week.
 */
export const planAdaptationScenarioSchema = z
  .object({
    type: z.literal("adaptation"),
    title: z.string().trim().min(3).max(150),
    profile: planProfileSchema,
    week: z
      .array(
        z
          .object({
            sessionKey: z.string().regex(/^[A-G]$/),
            exercises: z.array(planExerciseSchema).min(1).max(12),
          })
          .strict(),
      )
      .min(1)
      .max(7),
    outcomes: z
      .object({
        adherence: z.number().min(0).max(1),
        /** Logged RIR relative to the prescription (negative: harder than planned). */
        rirDelta: z.number().int().min(-3).max(3).default(0),
        painReported: z.boolean().default(false),
      })
      .strict(),
    expected: z.enum(["deliverable", "review"]),
  })
  .strict();
export const planScenarioSchema = z.union([
  planAdaptationScenarioSchema,
  planProgrammeScenarioSchema,
]);
export type PlanScenario = z.infer<typeof planScenarioSchema>;

// ---------------------------------------------------------------------------
// Library and equipment

export const normalizeTerm = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/(?<=\p{L}{3})s\b/gu, "");
const ALWAYS_AVAILABLE = new Set(["bodyweight", "body weight", "none", "floor"]);
const FULL_GYM = /\b(full gym|commercial gym|gym access|whole gym)\b/;
export function memberEquipment(text: string) {
  const items = text
    .split(/[,;\n]|\band\b/)
    .map(normalizeTerm)
    .filter(Boolean);
  return { items, fullGym: FULL_GYM.test(normalizeTerm(text)) };
}
export type LibraryExercise = {
  name: string;
  equipment: string[] | null;
  /** The trainer's default load for the exercise (kg), when above zero. */
  loadKg?: number;
  alternatives: string[];
  cue: string;
  demonstrationUrl?: string;
  sourceId: string;
};
export type PlanLibrary = Map<string, LibraryExercise>;
/**
 * The week-1 starting-load references (kg) the validator enforces, keyed by
 * the library's exercise name, for the model prompt: the model is told the
 * numbers it must stay within instead of guessing them. Only exercises in the
 * library are named (the model may use no other).
 */
export function startingLoadsFor(
  reference: Map<string, number>,
  library: PlanLibrary,
  limit = 300,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, load] of reference) {
    const exercise = library.get(key);
    if (!exercise || !(load > 0)) continue;
    out[exercise.name] = load;
    if (Object.keys(out).length >= limit) break;
  }
  return out;
}
/** The trainer's allowed exercises: library records and template exercises, with their approved alternatives. */
export function planLibrary(
  exercises: Array<{ id: string; data: any }>,
  templates: Array<{ id: string; data: any }>,
): PlanLibrary {
  const library: PlanLibrary = new Map();
  const add = (e: any, sourceId: string) => {
    if (typeof e?.name !== "string" || e.name.trim().length < 2) return;
    const key = normalizeTerm(e.name),
      prior = library.get(key);
    const equipment = Array.isArray(e.equipment)
      ? e.equipment.filter((v: unknown) => typeof v === "string")
      : null;
    const alternatives = (Array.isArray(e.alternatives) ? e.alternatives : [])
      .map((a: any) => (typeof a === "string" ? a : a?.name))
      .filter((a: unknown): a is string => typeof a === "string");
    library.set(key, {
      name: prior?.name ?? e.name.trim(),
      equipment: prior?.equipment ?? equipment,
      alternatives: [...new Set([...(prior?.alternatives ?? []), ...alternatives])],
      cue: prior?.cue || (typeof e.cue === "string" ? e.cue : ""),
      ...(prior?.loadKg !== undefined ||
      (typeof e.loadKg === "number" && e.loadKg > 0)
        ? { loadKg: prior?.loadKg ?? e.loadKg }
        : {}),
      ...(prior?.demonstrationUrl || e.demonstrationUrl
        ? { demonstrationUrl: prior?.demonstrationUrl ?? e.demonstrationUrl }
        : {}),
      sourceId: prior?.sourceId ?? sourceId,
    });
    // An approved alternative is allowed wherever its exercise is.
    for (const alt of Array.isArray(e.alternatives) ? e.alternatives : []) {
      const altName = typeof alt === "string" ? alt : alt?.name;
      if (typeof altName === "string" && !library.has(normalizeTerm(altName)))
        library.set(normalizeTerm(altName), {
          name: altName.trim(),
          equipment: null,
          alternatives: [],
          cue: typeof alt?.cue === "string" ? alt.cue : "",
          sourceId,
        });
    }
  };
  for (const row of exercises) add(row.data, row.id);
  for (const t of templates)
    for (const e of [
      ...(t.data?.exercises ?? []),
      ...(t.data?.sessions ?? []).flatMap((s: any) => s.exercises ?? []),
    ])
      add(e, t.id);
  return library;
}
function equipmentGaps(
  entry: LibraryExercise,
  available: ReturnType<typeof memberEquipment>,
) {
  if (!entry.equipment || available.fullGym) return [];
  return entry.equipment.filter((tag) => {
    const t = normalizeTerm(tag);
    return !ALWAYS_AVAILABLE.has(t) && !available.items.includes(t);
  });
}

// ---------------------------------------------------------------------------
// Expansion, dates and validation

export type ExpandedExercise = StructuredExercise & {
  name: string;
  /** Sets of rep work; rounds of timed or distance work. */
  sets: number;
  /** Exactly one of reps, durationSeconds and distanceMeters is set. */
  reps?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  paceSecondsPerKm?: number;
  effort?: Effort;
  loadKg: number;
  rir: number;
  restSeconds: number;
  cue: string;
  alternatives: string[];
};
/** The optional prescription fields that are set, for copying one exercise's work onto another record. */
export function workFields(e: {
  reps?: number | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
  paceSecondsPerKm?: number | null;
  effort?: string | null;
}) {
  return {
    ...(typeof e.reps === "number" ? { reps: e.reps } : {}),
    ...(typeof e.durationSeconds === "number" ? { durationSeconds: e.durationSeconds } : {}),
    ...(typeof e.distanceMeters === "number" ? { distanceMeters: e.distanceMeters } : {}),
    ...(typeof e.paceSecondsPerKm === "number" ? { paceSecondsPerKm: e.paceSecondsPerKm } : {}),
    ...(e.effort && (EFFORTS as readonly string[]).includes(e.effort) ? { effort: e.effort as Effort } : {}),
  };
}
/** Rounding steps of a scaled week: whole sets, 5 s of timed work and 10 m of distance per round. */
export const ROUNDING_UNIT = Object.freeze({ sets: 1, seconds: 5, meters: 10 });
/**
 * A week's volume factor on timed work (to 5 s) and distance (to 10 m); an
 * unscaled week keeps the exact value. `exact` skips the rounding (the
 * progression limit is checked on the unrounded factor).
 */
const scaledSeconds = (v: number, f: number, exact = false) =>
  f === 1 ? v : Math.min(WORK_LIMITS.maxDurationSeconds, Math.max(5, exact ? v * f : Math.round((v * f) / 5) * 5));
const scaledMeters = (v: number, f: number, exact = false) =>
  f === 1 ? v : Math.min(WORK_LIMITS.maxDistanceMeters, Math.max(10, exact ? v * f : Math.round((v * f) / 10) * 10));
export type ExpandedSession = {
  key: string;
  label: string;
  weekday: number;
  exercises: ExpandedExercise[];
};
export type ExpandedWeek = {
  week: number;
  focus: string;
  deload: boolean;
  sessions: ExpandedSession[];
};
const halfKg = (v: number) => Math.round(v * 2) / 2;
/**
 * A week of the draft. The week's volume factor scales the sets of rep work
 * and the work of each round of timed or distance work (its duration or
 * distance; the number of rounds stays); the load factor scales loads.
 * `unrounded` keeps fractional sets, seconds and metres: what the factor
 * asks for before rounding, used only to check the weekly progression limit.
 */
export function expandPlan(draft: PlanDraft, options: { unrounded?: boolean } = {}): ExpandedWeek[] {
  const exact = options.unrounded === true;
  return draft.weeks.map((w) => ({
    week: w.week,
    focus: w.focus,
    deload: w.deload,
    sessions: draft.sessions.map((s) => ({
      key: s.key,
      label: s.label,
      weekday: s.weekday,
      exercises: s.exercises.map((e) => {
        const measure = workMeasure(e);
        return {
          name: e.name,
          sets:
            measure === "reps"
              ? exact
                ? e.sets * w.volumeFactor
                : Math.max(1, Math.round(e.sets * w.volumeFactor))
              : e.sets,
          ...workFields(e),
          ...(measure === "time" ? { durationSeconds: scaledSeconds(e.durationSeconds!, w.volumeFactor, exact) } : {}),
          ...(measure === "distance" ? { distanceMeters: scaledMeters(e.distanceMeters!, w.volumeFactor, exact) } : {}),
          loadKg: halfKg(e.loadKg * w.loadFactor),
          rir: Math.min(5, Math.max(0, e.rir + w.rirDelta)),
          restSeconds: e.restSeconds,
          cue: e.cue,
          alternatives: e.alternatives,
        };
      }),
    })),
  }));
}
export const planWeeksFor = (programmeDays: number) =>
  Math.ceil(programmeDays / 7);
/** Dated sessions for [startDate, startDate + programmeDays): the plan's weekday per 7-day week. */
export function datedPlanSessions(
  draft: PlanDraft,
  startDate: string,
  programmeDays: number,
) {
  const weeks = expandPlan(draft),
    out = [];
  for (let day = 0; day < programmeDays; day++) {
    const date = addTrainingDays(startDate, day),
      weekday = new Date(date + "T12:00:00Z").getUTCDay(),
      week = Math.floor(day / 7) + 1,
      session = weeks[week - 1]?.sessions.find((s) => s.weekday === weekday);
    if (session) out.push({ date, week, ...session });
  }
  return out;
}
/**
 * Estimated session length: 8 minutes of warm-up and changeovers, a minute
 * per exercise, and each set's work (4 s a rep, the duration, or the distance
 * at its pace, 10 min/km without one) plus its rest.
 */
export const sessionMinutes = (exercises: ExpandedExercise[]) =>
  Math.round(
    8 +
      exercises.reduce(
        (sum, e) => sum + 1 + (e.sets * (workSeconds(e) + e.restSeconds)) / 60,
        0,
      ),
  );
/** Weekly sets of rep work (timed and distance work are measured by time and distance). */
const volume = (sessions: Array<{ exercises: ExpandedExercise[] }>) =>
  sessions.reduce(
    (sum, s) => sum + s.exercises.reduce((n, e) => n + (workMeasure(e) === "reps" ? e.sets : 0), 0),
    0,
  );
const timedWork = (sessions: Array<{ exercises: ExpandedExercise[] }>) =>
  sessions.reduce((sum, s) => sum + s.exercises.reduce((n, e) => n + totalSeconds(e), 0), 0);
const distanceWork = (sessions: Array<{ exercises: ExpandedExercise[] }>) =>
  sessions.reduce((sum, s) => sum + s.exercises.reduce((n, e) => n + totalMeters(e), 0), 0);
/**
 * The smallest weekly rise the progression limit always allows, like the one
 * set that rep work may always add: 30 seconds of timed work, 100 metres, a
 * pace 5 seconds per kilometre faster.
 */
export const MIN_WORK_STEP = Object.freeze({ seconds: 30, meters: 100, paceSecondsPerKm: 5 });
export type PlanCheckContext = {
  /** Limitations and goal, when given, add position cautions (pregnancy) as warnings. */
  profile: Pick<PlanProfile, "experience" | "daysPerWeek" | "equipment"> &
    Partial<Pick<PlanProfile, "limitations" | "goal" | "availableWeekdays" | "maxSessionMinutes">>;
  library: PlanLibrary;
  bounds: PlanBounds;
  evidenceIds?: Set<string>;
  /**
   * Starting-load references (normalized exercise name to kg): the member's
   * logged loads, else the library's default load. When given, an exercise
   * with no previous week to compare against may start at most one load jump
   * above its reference, or at the trainer's start cap when it has none.
   * Omitted for a trainer's own edits (the trainer decides).
   */
  loadReference?: Map<string, number>;
  /**
   * Wording the trainer wrote in an edit. The member-text screen reports it
   * as a warning (the trainer decides); every other title, summary, focus,
   * label or non-library cue is the model's and an issue is an error.
   */
  trainerText?: Set<string>;
};
export type PlanValidation = {
  errors: string[];
  warnings: string[];
  metrics: {
    /** Weekly sets of rep work. */
    weeklyVolume: number[];
    /** Weekly minutes of timed work (all rounds). */
    weeklyWorkMinutes: number[];
    /** Weekly metres of distance work (all rounds). */
    weeklyDistanceMeters: number[];
    longestSessionMinutes: number;
    untaggedExercises: string[];
    taggedExercises: number;
    exerciseCount: number;
    /** Exercises that started at or below the start cap with no load reference. */
    unreferencedLoads: string[];
  };
};
function checkSessions(
  sessions: ExpandedSession[] | Array<{ key: string; label?: string; exercises: ExpandedExercise[] }>,
  ctx: PlanCheckContext,
  where: string,
  result: PlanValidation,
) {
  const available = memberEquipment(ctx.profile.equipment);
  for (const s of sessions) {
    const label = `${where} session ${s.key}`;
    if (ctx.profile.availableWeekdays && "weekday" in s && !ctx.profile.availableWeekdays.includes(Number(s.weekday)))
      result.errors.push(`${label} is outside the member's available weekdays`);
    for (const issue of structureIssues(s.exercises)) result.errors.push(`${label}: ${issue}`);
    for (const e of s.exercises) {
      const entry = ctx.library.get(normalizeTerm(e.name));
      if (!entry) {
        result.errors.push(`${e.name} is not in the trainer's exercise library`);
        continue;
      }
      const gaps = equipmentGaps(entry, available);
      if (gaps.length)
        result.errors.push(
          `${e.name} needs ${gaps.join(", ")}, which the subscriber does not have`,
        );
      if (!entry.equipment) {
        if (!result.metrics.untaggedExercises.includes(entry.name))
          result.metrics.untaggedExercises.push(entry.name);
      }
      for (const alt of e.alternatives) {
        const a = ctx.library.get(normalizeTerm(alt));
        if (!a)
          result.errors.push(`${alt} (alternative to ${e.name}) is not in the trainer's library`);
        else if (equipmentGaps(a, available).length)
          result.errors.push(`${alt} (alternative to ${e.name}) needs unavailable equipment`);
        // The member may pick an alternative, so it needs checked equipment too.
        else if (!a.equipment && !result.metrics.untaggedExercises.includes(a.name))
          result.metrics.untaggedExercises.push(a.name);
      }
      if (e.sets > 10) result.errors.push(`${label}: ${e.name} exceeds 10 sets`);
      // Adjusted weeks and trainer edits are not reparsed: the shape is checked here too.
      if (measureCount(e) !== 1)
        result.errors.push(`${label}: ${e.name} needs exactly one of reps, a duration or a distance`);
      // Rest between sets or rounds follows the trainer's bounds; one
      // continuous bout of timed or distance work may have none.
      if (
        !(continuousWork(e) && e.restSeconds === 0) &&
        (e.restSeconds < ctx.bounds.minRestSeconds ||
          e.restSeconds > ctx.bounds.maxRestSeconds)
      )
        result.errors.push(
          `${label}: ${e.name} rest ${e.restSeconds}s is outside ${ctx.bounds.minRestSeconds}-${ctx.bounds.maxRestSeconds}s`,
        );
      if (ctx.profile.experience === "beginner" && e.rir < 1)
        result.errors.push(`${label}: ${e.name} takes a beginner to failure (RIR ${e.rir})`);
      else if (ctx.profile.experience === "beginner" && e.rir < 2)
        result.warnings.push(`${label}: ${e.name} is close to failure for a beginner`);
    }
    const minutes = sessionMinutes(s.exercises);
    result.metrics.longestSessionMinutes = Math.max(
      result.metrics.longestSessionMinutes,
      minutes,
    );
    const minuteLimit = Math.min(ctx.bounds.maxSessionMinutes, ctx.profile.maxSessionMinutes ?? Infinity);
    if (minutes > minuteLimit)
      result.errors.push(
        `${label} takes about ${minutes} minutes (limit ${minuteLimit})`,
      );
  }
}
type TransitionSessions = Array<{ key: string; exercises: ExpandedExercise[] }>;
/**
 * The weekly progression limit between two weeks. Within a draft the weeks
 * come from volume factors that the plan rounds (whole sets, 5 s and 10 m per
 * round), so `unrounded` carries both weeks before rounding (parallel to
 * `previous` and `next`): the limit is checked on those, and the rounded rise
 * may exceed the limit by at most one rounding unit (one set, 5 s or 10 m)
 * for the whole week, and each exercise by at most one unit as well (owner
 * decision, 30 September 2026; it was one unit per exercise and per round).
 * A draft over that fails validation and goes to the trainer. Without
 * `unrounded` (an adapted week the model wrote out) the rounded values are
 * checked as they are.
 */
function checkTransition(
  previous: TransitionSessions,
  next: TransitionSessions,
  ctx: PlanCheckContext,
  where: string,
  result: PlanValidation,
  unrounded?: { previous: TransitionSessions; next: TransitionSessions },
) {
  const pct = ctx.bounds.maxWeeklyVolumeIncreasePct;
  // The allowed rise from `value` (at least `minimum`): whole units on
  // rounded values, exact on unrounded ones.
  const cap = (value: number, minimum: number, exact = false) =>
    Math.max(minimum, exact ? (value * pct) / 100 : Math.floor((value * pct) / 100));
  /** Whether a rise from `was` to `now` breaks the limit; `slack` is one rounding unit. */
  const tooMuch = (
    was: number,
    now: number,
    minimum: number,
    exact: [number, number] | undefined,
    slack: number,
  ) =>
    exact
      ? exact[1] - exact[0] > cap(exact[0], minimum, true) + 1e-9 || now - was > cap(was, minimum) + slack
      : now - was > cap(was, minimum);
  const exercises = (sessions: TransitionSessions) => sessions.flatMap((s) => s.exercises);
  const nextExercises = exercises(next);
  const before = volume(previous),
    after = volume(next);
  if (
    before > 0 &&
    tooMuch(
      before,
      after,
      1,
      unrounded && [volume(unrounded.previous), volume(unrounded.next)],
      ROUNDING_UNIT.sets,
    )
  )
    result.errors.push(`${where}: weekly volume rises from ${before} to ${after} sets (limit +${pct}%)`);
  // Timed and distance work rise under the same weekly limit, by total time
  // or distance for the week and for each exercise (at least 30 s or 100 m).
  for (const [measure, total, minimum, unit, format, noun] of [
    ["time", timedWork, MIN_WORK_STEP.seconds, ROUNDING_UNIT.seconds, formatDuration, "timed work"],
    ["distance", distanceWork, MIN_WORK_STEP.meters, ROUNDING_UNIT.meters, formatDistance, "distance"],
  ] as const) {
    const amount = (e: ExpandedExercise) => (measure === "time" ? totalSeconds(e) : totalMeters(e));
    const was = total(previous),
      now = total(next);
    if (was > 0 && tooMuch(was, now, minimum, unrounded && [total(unrounded.previous), total(unrounded.next)], unit))
      result.errors.push(`${where}: weekly ${noun} rises from ${format(was)} to ${format(now)} (limit +${pct}%)`);
    const most = (sessions: TransitionSessions) => {
      const out = new Map<string, number>();
      for (const e of exercises(sessions))
        if (workMeasure(e) === measure) {
          const key = normalizeTerm(e.name);
          out.set(key, Math.max(out.get(key) ?? 0, amount(e)));
        }
      return out;
    };
    const mostBefore = most(previous),
      mostBeforeExact = unrounded && most(unrounded.previous),
      nextExact = unrounded && exercises(unrounded.next);
    nextExercises.forEach((e, i) => {
      const key = normalizeTerm(e.name);
      const p = workMeasure(e) === measure ? mostBefore.get(key) : undefined;
      if (p === undefined) return;
      const value = amount(e);
      const exact: [number, number] | undefined =
        mostBeforeExact && nextExact ? [mostBeforeExact.get(key) ?? p, amount(nextExact[i]!)] : undefined;
      if (tooMuch(p, value, minimum, exact, unit))
        result.errors.push(`${where}: ${e.name} rises from ${format(p)} to ${format(value)} (limit +${pct}%)`);
    });
  }
  // A faster pace is harder work: each exercise's speed rises by at most the
  // same weekly limit (always at least 5 s/km faster).
  const fastest = new Map<string, number>();
  for (const s of previous)
    for (const e of s.exercises)
      if (workMeasure(e) !== "reps" && typeof e.paceSecondsPerKm === "number") {
        const key = normalizeTerm(e.name);
        fastest.set(key, Math.min(fastest.get(key) ?? Infinity, e.paceSecondsPerKm));
      }
  for (const s of next)
    for (const e of s.exercises) {
      const p = fastest.get(normalizeTerm(e.name));
      if (p === undefined || workMeasure(e) === "reps" || typeof e.paceSecondsPerKm !== "number") continue;
      if (e.paceSecondsPerKm < Math.min(p - MIN_WORK_STEP.paceSecondsPerKm, p / (1 + pct / 100)) - 1e-9)
        result.errors.push(
          `${where}: ${e.name} pace speeds up from ${formatPace(p)} to ${formatPace(e.paceSecondsPerKm)} (limit +${pct}%)`,
        );
    }
  const prior = new Map<string, number>();
  for (const s of previous)
    for (const e of s.exercises) {
      const key = normalizeTerm(e.name);
      prior.set(key, Math.max(prior.get(key) ?? 0, e.loadKg));
    }
  for (const s of next)
    for (const e of s.exercises) {
      const p = prior.get(normalizeTerm(e.name));
      if (p === undefined) continue;
      const limit = Math.max((p * ctx.bounds.maxLoadJumpPct) / 100, 1);
      if (e.loadKg - p > limit + 1e-9)
        result.errors.push(
          `${where}: ${e.name} load jumps from ${p} kg to ${e.loadKg} kg (limit +${ctx.bounds.maxLoadJumpPct}%)`,
        );
    }
}
/**
 * Absolute starting loads: an exercise with nothing to compare against in the
 * previous week starts within one load jump of the member's logged load or
 * the library load, or at most at the trainer's start cap for this experience.
 */
function checkStartLoads(
  sessions: Array<{ key: string; exercises: ExpandedExercise[] }>,
  known: Set<string>,
  ctx: PlanCheckContext,
  where: string,
  result: PlanValidation,
) {
  if (!ctx.loadReference) return;
  const cap =
    ctx.bounds.startLoadCapKg?.[ctx.profile.experience] ??
    planBoundsSchema.parse({}).startLoadCapKg[ctx.profile.experience];
  for (const s of sessions)
    for (const e of s.exercises) {
      const key = normalizeTerm(e.name);
      if (known.has(key) || !(e.loadKg > 0)) continue;
      const reference = ctx.loadReference.get(key);
      if (reference !== undefined && reference > 0) {
        const limit = Math.max((reference * ctx.bounds.maxLoadJumpPct) / 100, 1);
        if (e.loadKg - reference > limit + 1e-9)
          result.errors.push(
            `${where}: ${e.name} starts at ${e.loadKg} kg, above the member's reference ${reference} kg (limit +${ctx.bounds.maxLoadJumpPct}%)`,
          );
      } else if (e.loadKg > cap + 1e-9)
        result.errors.push(
          `${where}: ${e.name} starts at ${e.loadKg} kg with no logged or library load (your start limit for ${ctx.profile.experience} subscribers is ${cap} kg)`,
        );
      else if (!result.metrics.unreferencedLoads.includes(e.name))
        result.metrics.unreferencedLoads.push(e.name);
    }
}
const names = (sessions: Array<{ exercises: ExpandedExercise[] }>) =>
  new Set(sessions.flatMap((s) => s.exercises.map((e) => normalizeTerm(e.name))));
const emptyValidation = (): PlanValidation => ({
  errors: [],
  warnings: [],
  metrics: {
    weeklyVolume: [],
    weeklyWorkMinutes: [],
    weeklyDistanceMeters: [],
    longestSessionMinutes: 0,
    untaggedExercises: [],
    taggedExercises: 0,
    exerciseCount: 0,
    unreferencedLoads: [],
  },
});
function finish(result: PlanValidation, exerciseNames: string[], ctx: PlanCheckContext) {
  result.errors = [...new Set(result.errors)].slice(0, 60);
  result.warnings = [...new Set(result.warnings)].slice(0, 60);
  const unique = [...new Set(exerciseNames.map(normalizeTerm))];
  result.metrics.exerciseCount = unique.length;
  result.metrics.taggedExercises = unique.filter(
    (n) => ctx.library.get(n)?.equipment,
  ).length;
  if (result.metrics.untaggedExercises.length)
    result.warnings.push(
      `Equipment is unchecked for ${result.metrics.untaggedExercises.slice(0, 5).join(", ")} (no equipment tags in the library)`,
    );
  return result;
}
/**
 * The member-text screen: every title, summary, week focus, session label and
 * exercise cue the member reads or hears. A cue that is the library's own
 * (the trainer's wording) is not screened. Returns one message per problem.
 */
export function planTextIssues(
  draft: Pick<PlanDraft, "title" | "summary" | "weeks" | "sessions">,
  library: PlanLibrary,
) {
  const found: Array<{ text: string; message: string }> = [];
  const prose: Array<[string, string]> = [
    ["Title", draft.title],
    ["Summary", draft.summary],
    ...draft.weeks.map((w): [string, string] => [`Week ${w.week} focus`, w.focus]),
    ...draft.sessions.map((s): [string, string] => [`Session ${s.key} label`, s.label]),
  ];
  for (const [where, text] of prose) {
    const issues = proseIssues(text);
    if (issues.length)
      found.push({ text, message: `${where} cannot be shown to the subscriber (${issues.join(", ").replaceAll("_", " ")})` });
  }
  for (const s of draft.sessions)
    for (const e of s.exercises) {
      const cue = String(e.cue ?? "").trim();
      if (!cue || cue === String(library.get(normalizeTerm(e.name))?.cue ?? "").trim()) continue;
      const issues = modelCueIssues(cue);
      if (issues.length)
        found.push({ text: cue, message: `Session ${s.key}: ${e.name} cue cannot be shown to the subscriber (${issues.join(", ").replaceAll("_", " ")})` });
    }
  return found;
}
/**
 * Replaces model wording that the member-text screen withholds only for
 * health language (a diagnosis, condition, medication, doctor or therapy in
 * the title, summary, a week focus or a session label) with neutral wording
 * written by code from the plan itself, in the plan's own language (Arabic
 * when the draft's wording is mostly Arabic, else English), so a valid plan
 * is not discarded for its description. Links, contact details, approval
 * claims and guarantees are not replaced: they stay validation errors. Cues
 * are not touched (automatic deliveries use the trainer's library cues). The
 * caller routes a plan with replacements to the trainer and keeps the
 * original wording on the staff record; nothing about the member's safety
 * routing changes.
 */
export function neutralPlanText<T extends Pick<PlanDraft, "title" | "summary" | "weeks" | "sessions">>(draft: T) {
  const replaced: Array<{ field: string; text: string }> = [];
  const language = planLanguage(draft),
    words = NEUTRAL_WORDING[language];
  const healthOnly = (text: string) => {
    const issues = proseIssues(text);
    return issues.length > 0 && issues.every((i) => i === "medical");
  };
  const sessions = draft.sessions.map((s) => {
    if (!healthOnly(s.label)) return s;
    replaced.push({ field: `sessions.${s.key}.label`, text: s.label });
    return { ...s, label: words.session(s.key) };
  });
  const weeks = draft.weeks.map((w) => {
    if (!healthOnly(w.focus)) return w;
    replaced.push({ field: `weeks.${w.week}.focus`, text: w.focus });
    return { ...w, focus: w.deload ? words.lighter : words.week(w.week) };
  });
  let title = draft.title;
  if (healthOnly(title)) {
    replaced.push({ field: "title", text: title });
    title = words.title(draft.weeks.length);
  }
  let summary = draft.summary;
  if (summary && healthOnly(summary)) {
    replaced.push({ field: "summary", text: summary });
    summary = neutralSummary({ weeks, sessions }, language);
  }
  return { draft: { ...draft, title, summary, weeks, sessions } as T, replaced };
}
/**
 * The language of the draft's own member-facing wording: Arabic when its
 * title, summary, labels and week focus have more Arabic than Latin letters.
 */
export function planLanguage(draft: Pick<PlanDraft, "title" | "summary" | "weeks" | "sessions">): "ar" | "en" {
  const text = [draft.title, draft.summary, ...draft.sessions.map((s) => s.label), ...draft.weeks.map((w) => w.focus)].join(" ");
  const arabic = text.match(/\p{Script=Arabic}/gu)?.length ?? 0,
    latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return arabic > latin ? "ar" : "en";
}
// Arabic counts: 1 and 2 have their own forms, 3 to 10 take the plural, 11
// and more the singular.
const arCount = (n: number, one: string, two: string, few: string, many: string) =>
  n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`;
const NEUTRAL_WORDING = {
  en: {
    session: (key: string) => `Session ${key}`,
    week: (n: number) => `Week ${n}`,
    lighter: "Lighter week",
    title: (weeks: number) => `${weeks}-week training plan`,
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    list: (items: string[]) =>
      items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`,
    schedule: (sessions: number, weeks: number) =>
      `${sessions} session${sessions === 1 ? "" : "s"} a week for ${weeks} week${weeks === 1 ? "" : "s"}`,
    lighterWeeks: (list: string, count: number) =>
      `Week${count === 1 ? "" : "s"} ${list} ${count === 1 ? "is a lighter week" : "are lighter weeks"}.`,
  },
  ar: {
    session: (key: string) => `الحصة ${key}`,
    week: (n: number) => `الأسبوع ${n}`,
    lighter: "أسبوع أخف",
    title: (weeks: number) => `خطة تدريب لمدة ${arCount(weeks, "أسبوع واحد", "أسبوعين", "أسابيع", "أسبوعًا")}`,
    days: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
    list: (items: string[]) => items.map((x, i) => (i ? `و${x}` : x)).join(" "),
    schedule: (sessions: number, weeks: number) =>
      `${arCount(sessions, "حصة واحدة", "حصتان", "حصص", "حصة")} في الأسبوع لمدة ${arCount(weeks, "أسبوع واحد", "أسبوعين", "أسابيع", "أسبوعًا")}`,
    lighterWeeks: (list: string, count: number) =>
      count === 1 ? `الأسبوع ${list} أسبوع أخف.` : `الأسابيع ${list} أسابيع أخف.`,
  },
} as const;
/**
 * "3 sessions a week for 4 weeks (Monday, Wednesday and Friday): Full body A,
 * Full body B and Full body C. Week 4 is a lighter week." In Arabic: "3 حصص
 * في الأسبوع لمدة 4 أسابيع (الاثنين والأربعاء والجمعة): ... الأسبوع 4 أسبوع أخف."
 */
export function neutralSummary(draft: Pick<PlanDraft, "weeks" | "sessions">, language: "ar" | "en" = "en") {
  const words = NEUTRAL_WORDING[language];
  const days = [...draft.sessions].sort((a, b) => a.weekday - b.weekday).map((s) => words.days[s.weekday] ?? "");
  const labels = draft.sessions.map((s) => (proseIssues(s.label).length ? words.session(s.key) : s.label));
  const lighter = draft.weeks.filter((x) => x.deload).map((x) => String(x.week));
  return [
    `${words.schedule(draft.sessions.length, draft.weeks.length)} (${words.list(days)}): ${words.list(labels)}.`,
    lighter.length ? words.lighterWeeks(words.list(lighter), lighter.length) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1500);
}
/** Validates a whole programme draft against the trainer's bounds and library. */
export function validatePlan(
  draft: PlanDraft,
  ctx: PlanCheckContext & {
    programmeDays: number;
    /** The last prescribed week of the previous block, for the first week's jump. */
    previousWeek?: Array<{ key: string; exercises: ExpandedExercise[] }>;
  },
): PlanValidation {
  const result = emptyValidation();
  const weeks = planWeeksFor(ctx.programmeDays);
  if (draft.sessions.length > ctx.profile.daysPerWeek)
    result.errors.push(
      `The plan has ${draft.sessions.length} sessions a week but the subscriber trains ${ctx.profile.daysPerWeek} days`,
    );
  else if (draft.sessions.length < ctx.profile.daysPerWeek)
    result.warnings.push(
      `The plan uses ${draft.sessions.length} of the subscriber's ${ctx.profile.daysPerWeek} training days`,
    );
  if (new Set(draft.sessions.map((s) => s.weekday)).size !== draft.sessions.length)
    result.errors.push("Each session needs its own weekday");
  if (new Set(draft.sessions.map((s) => s.key)).size !== draft.sessions.length)
    result.errors.push("Each session needs its own key");
  if (
    draft.weeks.length !== weeks ||
    draft.weeks.some((w, i) => w.week !== i + 1)
  )
    result.errors.push(
      `The plan must describe weeks 1 to ${weeks} in order for a ${ctx.programmeDays}-day programme`,
    );
  if (weeks >= 6 && !draft.weeks.some((w) => w.deload))
    result.warnings.push(`No deload week in a ${weeks}-week programme`);
  if (ctx.evidenceIds) {
    const outside = draft.evidenceIds.filter((id) => !ctx.evidenceIds!.has(id));
    if (outside.length)
      result.errors.push("The plan cites material outside the trainer's Brain");
    if (!draft.evidenceIds.length)
      result.warnings.push("The plan cites no trainer rule, case or example");
  }
  // Model wording is screened before anything reaches the member: an issue
  // is an error, which zeroes the validation signal and sends the plan to
  // the trainer. The trainer's own edited wording is only warned about.
  for (const issue of planTextIssues(draft, ctx.library))
    if (ctx.trainerText?.has(issue.text.trim()))
      result.warnings.push(issue.message.replace("cannot be shown to", "may not suit"));
    else result.errors.push(issue.message);
  const expanded = expandPlan(draft),
    unrounded = expandPlan(draft, { unrounded: true });
  let reference = ctx.previousWeek?.length ? ctx.previousWeek : null;
  // The member's logged previous week is already exact; a draft week is
  // compared on its unrounded factor (checkTransition).
  let referenceUnrounded = reference;
  for (const [i, week] of expanded.entries()) {
    const where = `Week ${week.week}`;
    checkSessions(week.sessions, ctx, where, result);
    recordVolume(result, week.sessions);
    // Week 1 has no earlier week in this draft: new exercises are bounded by
    // the member's history, the library load or the start cap.
    if (week.week === 1)
      checkStartLoads(week.sessions, names(reference ?? []), ctx, where, result);
    if (reference)
      checkTransition(reference, week.sessions, ctx, where, result, {
        previous: referenceUnrounded!,
        next: unrounded[i]!.sessions,
      });
    if (!week.deload) {
      reference = week.sessions;
      referenceUnrounded = unrounded[i]!.sessions;
    }
  }
  result.warnings.push(...positionCautions(ctx.profile, draft.sessions), ...oneRepTimedWarnings(draft.sessions));
  return finish(
    result,
    draft.sessions.flatMap((s) => s.exercises.map((e) => e.name)),
    ctx,
  );
}
function recordVolume(result: PlanValidation, sessions: Array<{ exercises: ExpandedExercise[] }>) {
  result.metrics.weeklyVolume.push(volume(sessions));
  result.metrics.weeklyWorkMinutes.push(Math.round(timedWork(sessions) / 6) / 10);
  result.metrics.weeklyDistanceMeters.push(distanceWork(sessions));
}
/** Validates one adapted week against the week it follows. */
export function validateAdaptedWeek(
  current: Array<{ key: string; exercises: ExpandedExercise[] }>,
  next: Array<{ key: string; exercises: ExpandedExercise[] }>,
  ctx: PlanCheckContext,
): PlanValidation {
  const result = emptyValidation();
  checkSessions(next, ctx, "Next week", result);
  recordVolume(result, next);
  // A swapped-in alternative has no load this week to compare against.
  checkStartLoads(next, names(current), ctx, "Next week", result);
  if (current.length) checkTransition(current, next, ctx, "Next week", result);
  result.warnings.push(...positionCautions(ctx.profile, next), ...oneRepTimedWarnings(next));
  return finish(
    result,
    next.flatMap((s) => s.exercises.map((e) => e.name)),
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Timed work written as one rep

// Timed or distance work by name: walks, runs, rides, rows, swims, intervals,
// holds, hangs and carries. Lifts that share a word (a walking lunge, a hang
// clean, a plank row) are not matched.
const TIMED_NAME =
  /\b(walks?|walking|runs?|running|jog\w*|sprints?|sprinting|planks?|holds?|hangs?|wall sits?|carry|carries|intervals?|cycl\w*|bikes?|biking|ride|riding|swim\w*|skipping|jump rope|elliptical|stairs?|treadmill|rowing|rower|erg|march\w*|crawls?|sled\w*|hik\w*|shuttles?)\b/;
const REP_NAME = /\b(lunges?|cleans?|snatch\w*|jerks?|swings?|rows?)\b/;
/**
 * Exercises whose name is timed or distance work but which are prescribed as
 * one rep: the trainer's templates and library store only sets and reps, so
 * a copied "Brisk Walk, 1 x 1" would be shown as one rep, voiced as "1 set of
 * 1 reps" and counted as seconds toward the session-length limit.
 */
export function oneRepTimedWork(sessions: Array<{ exercises: Array<PrescribedWork & { name: string }> }>) {
  return [
    ...new Set(
      sessions.flatMap((s) =>
        s.exercises
          .filter((e) => {
            const n = plainName(e.name);
            return workMeasure(e) === "reps" && e.reps === 1 && TIMED_NAME.test(n) && !REP_NAME.test(n);
          })
          .map((e) => e.name),
      ),
    ),
  ];
}
const oneRepTimedWarnings = (sessions: Array<{ exercises: Array<PrescribedWork & { name: string }> }>) => {
  const found = oneRepTimedWork(sessions);
  return found.length
    ? [
        `${found.slice(0, 5).join(", ")} ${found.length === 1 ? "is" : "are"} written as 1 rep: timed or distance work needs a duration or distance`,
      ]
    : [];
};

// ---------------------------------------------------------------------------
// Pregnancy positions (a caution for the trainer's review, never a model call)

// Pregnancy terms, matched on stageText(). Arabic uses only unambiguous forms:
// حامل / حبلى, or الحمل with a week, month or trimester count ("الأسبوع 22
// من الحمل"); bare الحمل also means "the load" ("زيادة الحمل").
const AR_COUNT = String.raw`(?:ال)?(?:اسبوع|اسابيع|اسبوعا|شهر|اشهر|شهور|ثلث)`;
const PREGNANT = new RegExp(
  String.raw`\b(?:pregnan\p{L}*|expecting a baby|trimester|gestation\p{L}*)|(?<!\p{L})[وف]?(?:حامل|حامله|حبلي|حوامل)(?!\p{L})|${AR_COUNT}(?:[ \t]+[^\s]+){0,2}[ \t]+(?:من|في)[ \t]+(?:ال)?حمل(?!\p{L})`,
  "u",
);
// Exercises done lying on the back or front. After the first trimester the
// trainer checks them; incline and seated variations are not matched.
const LYING =
  /\b(bridges?|bench press(es)?|floor press(es)?|dead bugs?|crunch(es)?|sit ups?|leg raises?|lying|supine|prone|supermans?|pullovers?|skull crushers?|flutter kicks?)\b/;
const UPRIGHT = /\b(incline|seated|standing|side lying)\b/;
const plainName = (name: string) =>
  name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Lower case, Western digits, and Arabic letters without hamza, taa marbuta or diacritic variants. */
const stageText = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ً-ْـ]/g, "");
const AR_ORDINALS = ["الاول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع"];
const AR_ORDINAL = `(${AR_ORDINALS.join("|")})`;
// A stage stated right next to a pregnancy term: "pregnant, 24 weeks",
// "24 weeks pregnant", "week 30 of pregnancy", "5 months pregnant",
// "حامل في الأسبوع 22", "الشهر الخامس من الحمل". Groups: week, week, month
// count, month number, month count, Arabic ordinal month.
const EN_STAGE = String.raw`(?:(?:week|wk)[ \t]*(\d{1,2})\b|(\d{1,2})[ \t]*(?:weeks?|wks?|w)\b(?![ \t]*ago)|(\d{1,2})[ \t]*(?:months?|mos?)\b(?![ \t]*ago))`;
const AR_STAGE = String.raw`(?:(?:ال)?اسبوع[ \t]*(?:رقم[ \t]*)?(\d{1,2})|(\d{1,2})[ \t]*(?:اسبوع|اسابيع|اسبوعا)(?!\p{L})|(\d{1,2})[ \t]*(?:شهر|اشهر|شهور)(?!\p{L})|(?:ال)?شهر[ \t]*(\d{1,2})|(?:ال)?شهر[ \t]+${AR_ORDINAL})`;
const STAGE_AFTER = [
  new RegExp(String.raw`^(?:[ \t,:(~–—-]|\b(?:about|around|approx(?:imately)?|roughly|at|now|currently|again|in|for|and|is|am)\b)*${EN_STAGE}`, "u"),
  new RegExp(String.raw`^[ \t،,:(-]*(?:(?:الان|حاليا|تقريبا)[ \t]+)?(?:في[ \t]+|ب)?${AR_STAGE}`, "u"),
];
const STAGE_BEFORE = [
  new RegExp(String.raw`${EN_STAGE}[ \t,]*(?:\b(?:into|of|in)[ \t]+)?(?:\b(?:my|the|her|this)[ \t]+)?$`, "u"),
  new RegExp(String.raw`${AR_STAGE}[ \t]+(?:من|في)[ \t]+$`, "u"),
];
const STAGE_TERM = /\b(?:pregnan\p{L}*|gestation\p{L}*|expecting a baby)|(?<!\p{L})[وف]?(?:حامل|حامله|حبلي|حوامل|الحمل)(?!\p{L})/gu;
const TRIMESTER: Array<[RegExp, [number, number]]> = [
  [/\b(?:first|1st)\s+trimester\b|الثلث\s+الاول\s+(?:من\s+)?(?:ال)?حمل/u, [1, 13]],
  [/\b(?:second|2nd)\s+trimester\b|الثلث\s+الثاني\s+(?:من\s+)?(?:ال)?حمل/u, [14, 27]],
  [/\b(?:third|3rd)\s+trimester\b|الثلث\s+الثالث\s+(?:من\s+)?(?:ال)?حمل/u, [28, 42]],
];
// A trimester that is over or ending, matched (and removed) before the plain
// trimesters: "past the first trimester" or "بعد الثلث الأول" is week 14 or
// later, not the first trimester; "end of the first trimester" is weeks 12
// to 14. Either way the lying-position caution is not suppressed.
const TRIMESTER_OVER = String.raw`(?:\b(?:past|after|beyond|finished|completed|out[ \t]+of|done[ \t]+with)[ \t]+(?:(?:the|my|her)[ \t]+)?|(?<!\p{L})(?:بعد|تجاوزت|تجاوزنا|تجاوز|تخطيت|انهيت|انتهيت[ \t]+من|انتهي|انتهت|خرجت[ \t]+من)[ \t]+)`;
const TRIMESTER_END = String.raw`(?:\bend[ \t]+of[ \t]+(?:(?:the|my|her)[ \t]+)?|(?<!\p{L})(?:في[ \t]+)?نهايه[ \t]+)`;
const TRIMESTER_NAMES: Array<[string, number]> = [
  [String.raw`(?:(?:first|1st)[ \t]+trimester\b|الثلث[ \t]+الاول(?!\p{L}))`, 13],
  [String.raw`(?:(?:second|2nd)[ \t]+trimester\b|الثلث[ \t]+الثاني(?!\p{L}))`, 27],
];
const TRIMESTER_PASSED: Array<[RegExp, (end: number) => [number, number], number]> = TRIMESTER_NAMES.flatMap(
  ([name, end]) => [
    [new RegExp(TRIMESTER_OVER + name, "gu"), (e: number) => [e + 1, 42] as [number, number], end],
    [new RegExp(TRIMESTER_END + name, "gu"), (e: number) => [e - 1, e + 1] as [number, number], end],
  ],
);
const stageRange = (m: RegExpExecArray): [number, number] | null => {
  const [, week1, week2, months, monthNumber, ordinal] = m;
  const week = Number(week1 ?? week2);
  if (week1 !== undefined || week2 !== undefined) return week >= 1 && week <= 42 ? [week, week] : null;
  // "5 months pregnant": at least 5 full months, up to a month more.
  if (months !== undefined) return [Math.round(Number(months) * 4.35), Math.round(Number(months) * 4.35) + 4];
  // "the fifth month": the weeks of that month.
  const k = monthNumber !== undefined ? Number(monthNumber) : AR_ORDINALS.indexOf(ordinal ?? "") + 1;
  return k >= 1 && k <= 10 ? [Math.round((k - 1) * 4.35) + 1, Math.round(k * 4.35)] : null;
};
/**
 * The pregnancy stage in the member's own words, as a range of weeks: only a
 * week or month count right next to a pregnancy term counts ("Knee surgery 6
 * weeks ago; pregnant, 24 weeks" is week 24), and a trimester anywhere ("past
 * the first trimester" is week 14 or later).
 * Null when no stage is given or the stated stages disagree (an unknown
 * stage, which is cautioned).
 */
export function pregnancyStage(text: string): { from: number; to: number } | null {
  const ranges: Array<[number, number]> = [];
  for (let line of stageText(text).split(/\n/)) {
    for (const [re, range, end] of TRIMESTER_PASSED)
      line = line.replace(re, () => {
        ranges.push(range(end));
        return " ";
      });
    for (const [re, range] of TRIMESTER) if (re.test(line)) ranges.push(range);
    for (const term of line.matchAll(STAGE_TERM)) {
      const after = line.slice(term.index + term[0].length),
        before = line.slice(0, term.index);
      for (const m of [...STAGE_AFTER.map((re) => re.exec(after)), ...STAGE_BEFORE.map((re) => re.exec(before))]) {
        const range = m && stageRange(m);
        if (range) ranges.push(range);
      }
    }
  }
  if (!ranges.length) return null;
  const from = Math.max(...ranges.map((r) => r[0])),
    to = Math.min(...ranges.map((r) => r[1]));
  return from <= to ? { from, to } : null;
}
/**
 * Pregnancy weeks in the member's own words ("22 weeks", "week 22", "second
 * trimester"): the earliest week the stated stage allows. Null when the text
 * gives no stage or the stages disagree.
 */
export const pregnancyWeek = (text: string) => pregnancyStage(text)?.from ?? null;
/**
 * Warnings for a pregnant member past the first trimester (or at an unknown
 * stage): exercises usually done lying on the back or front. The code safety
 * floor already sends every pregnancy to the trainer; this tells them where
 * to look. A warning, not an error: the trainer decides.
 */
export function positionCautions(
  profile: Partial<Pick<PlanProfile, "limitations" | "goal" | "availableWeekdays" | "maxSessionMinutes">>,
  sessions: Array<{ exercises: Array<{ name: string }> }>,
) {
  // One line each: a number in the goal is not next to a pregnancy term in the limitations.
  const text = [profile.limitations ?? "", profile.goal ?? ""].join("\n");
  if (!PREGNANT.test(stageText(text))) return [];
  const stage = pregnancyStage(text);
  if (stage && stage.to <= 13) return [];
  const lying = [
    ...new Set(
      sessions.flatMap((s) =>
        s.exercises
          .filter((e) => {
            const n = plainName(e.name);
            return LYING.test(n) && !UPRIGHT.test(n);
          })
          .map((e) => e.name),
      ),
    ),
  ];
  return lying.length
    ? [
        `Pregnancy after the first trimester: ${lying.slice(0, 5).join(", ")} ${lying.length === 1 ? "is" : "are"} usually done lying on the back or front; check the position or swap ${lying.length === 1 ? "it" : "them"}`,
      ]
    : [];
}

// ---------------------------------------------------------------------------
// Weekly adaptation

/** This week's logged outcomes as the adaptation sees them. */
export type WeekOutcomes = {
  adherence: number | null;
  loggedSets: number;
  exercises: Array<{
    exercise: string;
    prescribed: { sets: number; rir?: number | null };
    logged: { sets: number; averageRir: number | null };
  }>;
};
/**
 * Why next week may not go up: sessions were missed, nothing was logged, or
 * the logged effort was harder than prescribed (average reps in reserve below
 * the plan). The model is told these, and any increase it proposes anyway is
 * a validation error, so the adjustment goes to the trainer.
 */
export function progressionHolds(outcomes: WeekOutcomes) {
  const holds: string[] = [];
  if (!outcomes.loggedSets) holds.push("nothing was logged this week");
  else if (outcomes.adherence === null || outcomes.adherence < 1)
    holds.push("sessions were missed this week");
  const harder = outcomes.exercises
    .filter(
      (e) =>
        typeof e.logged.averageRir === "number" &&
        typeof e.prescribed.rir === "number" &&
        e.logged.sets > 0 &&
        e.logged.averageRir < e.prescribed.rir,
    )
    .map((e) => e.exercise);
  if (harder.length)
    holds.push(`the week was harder than planned (${harder.slice(0, 5).join(", ")} logged fewer reps in reserve than prescribed)`);
  return holds;
}
const EFFORT_RANK: Record<string, number> = { easy: 0, moderate: 1, hard: 2 };
const effortRank = (effort?: string | null) =>
  effort && effort in EFFORT_RANK ? EFFORT_RANK[effort] : null;
/**
 * How one exercise is harder than its reference: more load, sets, reps,
 * duration or distance, a faster (or newly set) pace, a higher effort, fewer
 * reps in reserve, shorter rest between sets or rounds, or another exercise.
 */
function harderThan(reference: ExpandedExercise, e: ExpandedExercise) {
  if (normalizeTerm(reference.name) !== normalizeTerm(e.name)) return [`swapped for ${e.name}`];
  const out: string[] = (["loadKg", "sets", "reps", "durationSeconds", "distanceMeters"] as const).filter(
    (k) => typeof e[k] === "number" && typeof reference[k] === "number" && e[k]! > reference[k]! + 1e-9,
  );
  const pace = reference.paceSecondsPerKm;
  if (typeof e.paceSecondsPerKm === "number" && !(typeof pace === "number" && e.paceSecondsPerKm >= pace))
    out.push(typeof pace === "number" ? "faster pace" : "a pace target");
  const effort = effortRank(e.effort);
  if (effort !== null && effort > (effortRank(reference.effort) ?? 0)) out.push("higher effort");
  if (e.rir < reference.rir) out.push("fewer reps in reserve");
  if (e.sets > 1 && e.restSeconds < reference.restSeconds) out.push("shorter rest");
  return out;
}
/** What the proposal makes harder than the reference week, per exercise (matched by session and position). */
export function adaptationIncreases(
  reference: Array<{ sessionKey: string; exercises: ExpandedExercise[] }>,
  adapted: Array<{ sessionKey: string; exercises: ExpandedExercise[] }>,
) {
  const out: string[] = [];
  for (const s of adapted) {
    const before = reference.find((p) => p.sessionKey === s.sessionKey);
    s.exercises.forEach((e, i) => {
      const b = before?.exercises[i];
      if (!b) return;
      const harder = harderThan(b, e);
      if (harder.length) out.push(`${b.name} (session ${s.sessionKey}: ${harder.join(", ")})`);
    });
  }
  return out;
}
/**
 * Next week held at no more than this week's values, for a week that holds
 * progression back: each exercise keeps the lower load, sets and reps,
 * duration or distance, the slower pace, the lower effort, the higher reps in
 * reserve and the longer rest of the planned week and this week (the same
 * session's exercise, else the hardest of that exercise this week). The
 * plan's own progression (a higher load or volume factor next week) does not
 * reach the member after a missed or harder-than-planned week; what was
 * lowered is listed for the trainer.
 */
export function heldWeek<S extends { sessionKey: string; exercises: ExpandedExercise[] }>(
  planned: S[],
  current: Array<{ sessionKey: string; exercises: ExpandedExercise[] }>,
) {
  const same = new Map<string, ExpandedExercise>(),
    any = new Map<string, ExpandedExercise>();
  for (const s of current)
    for (const e of s.exercises) {
      const key = (e.instanceId ?? normalizeTerm(e.name));
      same.set(`${s.sessionKey}:${key}`, e);
      const prior = any.get(key);
      any.set(key, !prior ? e : hardest(prior, e));
    }
  const changes: Array<{ sessionKey: string; exercise: string; field: string; from: unknown; to: unknown }> = [];
  const sessions = planned.map((s) => ({
    ...s,
    exercises: s.exercises.map((planned) => {
      const key = planned.instanceId ?? normalizeTerm(planned.name);
      const ref = same.get(`${s.sessionKey}:${key}`) ?? any.get(key);
      if (!ref) return planned;
      const e: ExpandedExercise = { ...planned };
      const set = <K extends keyof ExpandedExercise>(field: K, value: ExpandedExercise[K]) => {
        if (value === e[field]) return;
        changes.push({ sessionKey: s.sessionKey, exercise: e.name, field, from: e[field], to: value });
        e[field] = value;
      };
      set("loadKg", Math.min(e.loadKg, ref.loadKg));
      set("rir", Math.max(e.rir, ref.rir));
      // Sets, rest and the work itself compare only within one measure.
      if (workMeasure(e) === workMeasure(ref)) {
        set("sets", Math.min(e.sets, ref.sets));
        for (const k of ["reps", "durationSeconds", "distanceMeters"] as const)
          if (typeof e[k] === "number" && typeof ref[k] === "number") set(k, Math.min(e[k]!, ref[k]!));
        if (typeof e.paceSecondsPerKm === "number" && typeof ref.paceSecondsPerKm === "number")
          set("paceSecondsPerKm", Math.max(e.paceSecondsPerKm, ref.paceSecondsPerKm));
        const effort = effortRank(e.effort),
          was = effortRank(ref.effort);
        if (effort !== null && was !== null && effort > was) set("effort", ref.effort);
        if (e.sets > 1) set("restSeconds", Math.max(e.restSeconds, ref.restSeconds));
      }
      return e;
    }),
  }));
  return { sessions, changes };
}
/** The harder of two prescriptions of one exercise, field by field. */
function hardest(a: ExpandedExercise, b: ExpandedExercise): ExpandedExercise {
  const max = (x?: number, y?: number) => (typeof x === "number" && typeof y === "number" ? Math.max(x, y) : (x ?? y));
  const min = (x?: number, y?: number) => (typeof x === "number" && typeof y === "number" ? Math.min(x, y) : (x ?? y));
  if (workMeasure(a) !== workMeasure(b)) return a;
  return {
    ...a,
    loadKg: Math.max(a.loadKg, b.loadKg),
    sets: Math.max(a.sets, b.sets),
    ...(a.reps !== undefined ? { reps: max(a.reps, b.reps) } : {}),
    ...(a.durationSeconds !== undefined ? { durationSeconds: max(a.durationSeconds, b.durationSeconds) } : {}),
    ...(a.distanceMeters !== undefined ? { distanceMeters: max(a.distanceMeters, b.distanceMeters) } : {}),
    ...(a.paceSecondsPerKm !== undefined || b.paceSecondsPerKm !== undefined
      ? { paceSecondsPerKm: min(a.paceSecondsPerKm, b.paceSecondsPerKm) }
      : {}),
    ...((effortRank(b.effort) ?? -1) > (effortRank(a.effort) ?? -1) ? { effort: b.effort } : {}),
    rir: Math.min(a.rir, b.rir),
    restSeconds: Math.min(a.restSeconds, b.restSeconds),
  };
}
/**
 * Anything made harder after a week that holds progression back, against the
 * held week (heldWeek: next week at no more than this week's values). Pushed
 * onto the adjustment's validation errors (live and in qualification), so it
 * goes to the trainer instead of the member.
 */
export function adaptationDirectionIssues(
  held: Array<{ sessionKey: string; exercises: ExpandedExercise[] }>,
  adapted: Array<{ sessionKey: string; exercises: ExpandedExercise[] }>,
  holds: string[],
) {
  if (!holds.length) return [];
  const raised = adaptationIncreases(held, adapted);
  return raised.length
    ? [`Next week raises ${raised.slice(0, 5).join("; ")} although ${holds.join(" and ")}`]
    : [];
}
/** Applies a model's proposed changes to a copy of next week's sessions. */
export function applyAdaptation(
  sessions: Array<{ plannedSessionId: string; sessionKey: string; exercises: ExpandedExercise[] }>,
  changes: AdaptationProposal["changes"],
) {
  const errors: string[] = [];
  const next = sessions.map((s) => ({
    ...s,
    exercises: s.exercises.map((e) => ({ ...e })),
  }));
  for (const change of changes) {
    const session = next.find((s) => s.sessionKey === change.sessionKey);
    const matches = session?.exercises.filter(e => normalizeTerm(e.name) === normalizeTerm(change.exercise) && (!change.instanceId || e.instanceId === change.instanceId)) ?? [];
    const exercise = matches.length === 1 ? matches[0] : undefined;
    if (!session || !exercise) {
      errors.push(`${change.exercise} is not in next week's session ${change.sessionKey}`);
      continue;
    }
    // An adjustment keeps each exercise's measure: reps stay reps, a timed
    // exercise changes its duration, a distance its distance.
    const measure = workMeasure(exercise);
    const wrong = (
      [
        ["reps", "reps"],
        ["durationSeconds", "time"],
        ["distanceMeters", "distance"],
      ] as const
    ).filter(([key, m]) => change[key] !== undefined && measure !== m);
    if (wrong.length || (change.paceSecondsPerKm !== undefined && measure === "reps")) {
      errors.push(
        `${exercise.name} is prescribed by ${measure === "reps" ? "repetitions" : measure}; the adjustment cannot change ${[...wrong.map(([k]) => k), ...(change.paceSecondsPerKm !== undefined && measure === "reps" ? ["paceSecondsPerKm"] : [])].join(", ")}`,
      );
      continue;
    }
    for (const key of [
      "sets",
      "reps",
      "durationSeconds",
      "distanceMeters",
      "paceSecondsPerKm",
      "effort",
      "loadKg",
      "rir",
      "restSeconds",
    ] as const)
      if (change[key] !== undefined) (exercise as any)[key] = change[key];
    if (change.replaceWith) {
      if (!exercise.alternatives.some((a) => normalizeTerm(a) === normalizeTerm(change.replaceWith!)))
        errors.push(`${change.replaceWith} is not an approved alternative to ${exercise.name}`);
      else {
        exercise.alternatives = exercise.alternatives.filter(
          (a) => normalizeTerm(a) !== normalizeTerm(change.replaceWith!),
        );
        exercise.name = change.replaceWith;
        // The replaced exercise's cue does not describe the alternative; the
        // library cue of the alternative is used when the week is written.
        exercise.cue = "";
      }
    }
  }
  return { sessions: next, errors };
}

// ---------------------------------------------------------------------------
// Segments, coverage, safety and confidence

const goalCategories: Array<[string, RegExp]> = [
  ["strength", /\b(strength|strong|stronger|powerlift\w*|1rm|heavier)\b/],
  ["hypertrophy", /\b(muscle|muscular|hypertroph\w*|size|bulk\w*|mass|tone|toned)\b/],
  ["fat_loss", /\b(fat|weight loss|lose weight|leaner|lean|cut|slim\w*)\b/],
  ["endurance", /\b(endurance|run\w*|marathon|cardio|stamina|conditioning|cycl\w*)\b/],
  ["mobility", /\b(mobility|flexib\w*|posture|stretch\w*)\b/],
];
export const goalCategory = (goal: string) =>
  goalCategories.find(([, re]) => re.test(goal.toLowerCase()))?.[0] ?? "general";
const goalTerms: Record<string, string[]> = {
  strength: ["strength", "strong", "powerlift", "heavy"],
  hypertrophy: ["hypertrophy", "muscle", "size", "volume"],
  fat_loss: ["fat", "weight loss", "conditioning", "calorie"],
  endurance: ["endurance", "cardio", "conditioning", "run"],
  mobility: ["mobility", "flexibility", "posture"],
  general: ["general", "fitness", "health", "program", "programme"],
};
export type PlanSegment = {
  goal: string;
  experience: string;
  daysPerWeek: number;
  equipment: string[];
};
export function planSegment(profile: Pick<PlanProfile, "goal" | "experience" | "daysPerWeek" | "equipment">): PlanSegment {
  const eq = memberEquipment(profile.equipment);
  return {
    goal: goalCategory(profile.goal),
    experience: profile.experience,
    daysPerWeek: profile.daysPerWeek,
    equipment: eq.fullGym ? ["full gym"] : [...new Set(eq.items)].sort().slice(0, 12),
  };
}
export function similarSegment(a: PlanSegment, b: PlanSegment) {
  if (a.goal !== b.goal || a.experience !== b.experience) return false;
  if (Math.abs(a.daysPerWeek - b.daysPerWeek) > 1) return false;
  if (!a.equipment.length && !b.equipment.length) return true;
  const left = new Set(a.equipment),
    right = new Set(b.equipment),
    same = [...left].filter((x) => right.has(x)).length;
  return same / new Set([...left, ...right]).size >= 0.5;
}
const NONE = new Set(
  ["", "none", "none reported", "no limitations", "no known limitations", "no", "n/a", "nothing", "no injuries"].map(normalizeTerm),
);
export const hasMedicalLimitation = (limitations: string) =>
  !NONE.has(normalizeTerm(limitations));
/** The code safety floor: any reason here routes the plan to the trainer. */
export function planSafetyReasons(input: {
  limitations: string;
  redFlags: string[];
  painReports: number;
}) {
  const reasons: string[] = [];
  if (hasMedicalLimitation(input.limitations))
    reasons.push("The subscriber reported a medical limitation or injury");
  for (const flag of input.redFlags) reasons.push(flag);
  if (input.painReports > 0)
    reasons.push(
      `${input.painReports} pain or safety report${input.painReports === 1 ? "" : "s"} in the last 28 days`,
    );
  return reasons;
}
/** Rule/case text coverage of the member's goal, experience, equipment, schedule and progression. */
export function ruleCoverage(segment: PlanSegment, material: string[]) {
  const text = " " + material.map(normalizeTerm).join(" ") + " ";
  const has = (terms: string[]) =>
    terms.some((t) => text.includes(" " + normalizeTerm(t)));
  const facets = {
    goal: has(goalTerms[segment.goal] ?? goalTerms.general),
    experience: has([segment.experience]),
    equipment:
      has(["equipment"]) ||
      segment.equipment.some((e) => has([e])) ||
      (segment.equipment.length === 0 && has(["bodyweight"])),
    schedule: has(["days per week", "day", "schedule", "frequency", "session"]),
    progression: has(["progress", "progression", "load", "increase", "deload", "volume"]),
  };
  const covered = Object.values(facets).filter(Boolean).length;
  return { score: covered / 5, facets };
}
/** Approved/edited plans in a similar segment raise coverage; rejections lower it. */
export function caseCoverage(
  segment: PlanSegment,
  learning: Array<{ decision: string; segment: PlanSegment; type?: string }>,
  type: "programme" | "adaptation" = "programme",
) {
  const similar = learning.filter(
    (l) => (l.type ?? "programme") === type && similarSegment(segment, l.segment),
  );
  const approved = similar.filter((l) => l.decision === "approved").length,
    edited = similar.filter((l) => l.decision === "edited").length,
    rejected = similar.filter((l) => l.decision === "rejected").length;
  const credit = approved + edited * 0.75 - rejected;
  return {
    score: Math.max(0, Math.min(1, credit / 3)),
    approved,
    edited,
    rejected,
  };
}
export const confidenceWeights = Object.freeze({
  ruleCoverage: 0.25,
  caseCoverage: 0.3,
  validation: 0.2,
  library: 0.1,
  model: 0.15,
});
export function planConfidence(input: {
  ruleCoverage: ReturnType<typeof ruleCoverage>;
  caseCoverage: ReturnType<typeof caseCoverage>;
  validation: PlanValidation;
  selfConfidence: number;
  uncertainties: string[];
  threshold: number;
  /** Adaptation: evidence from logged outcomes (0 to 1). */
  outcomeEvidence?: number;
}) {
  const v = input.validation;
  const signals = {
    ruleCoverage: input.ruleCoverage.score,
    caseCoverage: input.caseCoverage.score,
    validation: v.errors.length ? 0 : Math.max(0, 1 - 0.2 * v.warnings.length),
    library: v.metrics.exerciseCount
      ? v.metrics.taggedExercises / v.metrics.exerciseCount
      : 0,
    model: Math.max(0, Math.min(1, input.selfConfidence)),
  };
  let score = Object.entries(confidenceWeights).reduce(
    (sum, [key, weight]) => sum + weight * signals[key as keyof typeof signals],
    0,
  );
  if (input.outcomeEvidence !== undefined)
    score = score * (0.7 + 0.3 * Math.max(0, Math.min(1, input.outcomeEvidence)));
  score = Math.round(score * 1000) / 1000;
  const reasons: string[] = [];
  const f = input.ruleCoverage.facets;
  const missing = Object.entries(f)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  if (missing.length)
    reasons.push(`Your confirmed rules and cases do not yet cover: ${missing.join(", ")}`);
  const c = input.caseCoverage;
  if (c.score < 1)
    reasons.push(
      `Few reviewed plans for similar clients (${c.approved} approved, ${c.edited} edited, ${c.rejected} rejected)`,
    );
  if (v.errors.length) reasons.push(...v.errors.slice(0, 8).map((e) => "Validator: " + e));
  if (v.warnings.length) reasons.push(...v.warnings.slice(0, 5).map((w) => "Warning: " + w));
  if (signals.library < 1 && v.metrics.exerciseCount)
    reasons.push("Some exercises have no equipment tags in your library");
  if (signals.model < 0.7)
    reasons.push(`The model reported ${signals.model.toFixed(2)} confidence`);
  for (const u of input.uncertainties.slice(0, 5)) reasons.push("Model uncertainty: " + u);
  if (input.outcomeEvidence !== undefined && input.outcomeEvidence < 0.7)
    reasons.push("Little logged training this week to adapt from");
  return {
    version: planConfidenceVersion,
    score,
    threshold: input.threshold,
    confident: v.errors.length === 0 && score >= input.threshold,
    signals,
    weights: confidenceWeights,
    reasons,
  };
}
/**
 * The delivery gate, shared by live plans, weekly adjustments and
 * qualification: a plan goes out automatically only in automatic mode, once
 * qualified, with no safety reason, no other hold-back reason, every exercise
 * and alternative checked against the member's equipment, and a confident,
 * error-free validation. Anything else goes to the trainer with the reasons.
 */
export function planRoute(input: {
  type: "programme" | "adaptation";
  mode: "automatic" | "supervised";
  qualified: boolean;
  qualificationReason?: string;
  safety: string[];
  /** Other reasons the trainer decides (for example a hand-written programme). */
  holds?: string[];
  confidence: ReturnType<typeof planConfidence>;
  validation: PlanValidation;
  equipment: string;
}) {
  const noun = input.type === "programme" ? "plan" : "adjustment";
  const unchecked = memberEquipment(input.equipment).fullGym
    ? []
    : input.validation.metrics.untaggedExercises;
  const holds = input.holds ?? [];
  const automatic =
    input.mode === "automatic" &&
    input.qualified &&
    !input.safety.length &&
    !holds.length &&
    !unchecked.length &&
    input.confidence.confident;
  const reasons = automatic
    ? []
    : [
        ...input.safety.map((s) => "Safety: " + s),
        ...holds,
        ...(input.mode === "supervised"
          ? [`Supervised mode: every ${noun} goes to you`]
          : []),
        ...(!input.qualified
          ? [
              input.qualificationReason ??
                `Plan qualification has not passed for the current Brain, so every ${noun} goes to you`,
            ]
          : []),
        ...(unchecked.length
          ? [
              `Equipment is unchecked for ${unchecked.slice(0, 5).join(", ")}: tag ${unchecked.length === 1 ? "it" : "them"} in your library (alternatives as their own library exercises) so the Brain can check the subscriber's equipment`,
            ]
          : []),
        ...(!input.confidence.confident
          ? [
              `Confidence ${input.confidence.score.toFixed(2)} is below your threshold ${input.confidence.threshold.toFixed(2)}`,
              ...input.confidence.reasons,
            ]
          : []),
      ];
  return {
    version: planRouteVersion,
    route: automatic ? ("automatic" as const) : ("review" as const),
    reasons,
    unchecked,
  };
}
/** Deterministic sampling so a spot check is reproducible for audit. */
export function spotCheckSample(id: string, rate: number) {
  let h = 2166136261;
  for (const ch of id) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 10000) / 10000 < rate;
}

// ---------------------------------------------------------------------------
// Review diff

export type PlanChange = { path: string; from: unknown; to: unknown };
function diffExercises(path: string, before: any[], after: any[], out: PlanChange[]) {
  const b = new Map(before.map((e) => [e.instanceId ?? normalizeTerm(e.name), e])),
    a = new Map(after.map((e) => [e.instanceId ?? normalizeTerm(e.name), e]));
  for (const [key, e] of b)
    if (!a.has(key)) out.push({ path: `${path}.${e.name}`, from: "present", to: "removed" });
  for (const [key, e] of a) {
    const prior = b.get(key);
    if (!prior) {
      out.push({ path: `${path}.${e.name}`, from: "absent", to: "added" });
      continue;
    }
    for (const field of ["sets", "reps", "durationSeconds", "distanceMeters", "paceSecondsPerKm", "effort", "loadKg", "rir", "restSeconds", "cue", "alternatives"])
      if (canonicalCoaching(prior[field] ?? null) !== canonicalCoaching(e[field] ?? null))
        out.push({ path: `${path}.${e.name}.${field}`, from: prior[field] ?? null, to: e[field] ?? null });
  }
}
export function planDiff(before: any, after: any): PlanChange[] {
  const out: PlanChange[] = [];
  for (const field of ["title", "summary"])
    if (before?.[field] !== undefined && before[field] !== after?.[field])
      out.push({ path: field, from: before[field], to: after?.[field] });
  const bs = new Map<string, any>((before?.sessions ?? []).map((s: any) => [s.key ?? s.sessionKey, s])),
    as = new Map<string, any>((after?.sessions ?? []).map((s: any) => [s.key ?? s.sessionKey, s]));
  for (const [key, s] of bs) if (!as.has(key)) out.push({ path: `sessions.${key}`, from: s.label ?? key, to: "removed" });
  for (const [key, s] of as) {
    const prior = bs.get(key);
    if (!prior) {
      out.push({ path: `sessions.${key}`, from: "absent", to: s.label ?? key });
      continue;
    }
    for (const field of ["label", "weekday"])
      if (prior[field] !== undefined && prior[field] !== s[field])
        out.push({ path: `sessions.${key}.${field}`, from: prior[field], to: s[field] });
    diffExercises(`sessions.${key}.exercises`, prior.exercises ?? [], s.exercises ?? [], out);
  }
  const bw = new Map<number, any>((before?.weeks ?? []).map((w: any) => [w.week, w]));
  for (const w of after?.weeks ?? []) {
    const prior = bw.get(w.week);
    if (!prior) {
      out.push({ path: `weeks.${w.week}`, from: "absent", to: "added" });
      continue;
    }
    for (const field of ["focus", "volumeFactor", "loadFactor", "rirDelta", "deload"])
      if (prior[field] !== w[field])
        out.push({ path: `weeks.${w.week}.${field}`, from: prior[field], to: w[field] });
  }
  return out.slice(0, 300);
}

/**
 * Content grade for a held-out Brain evaluation answer (legacy coaching
 * decisions): citing the expected rule is not enough when the wording gives
 * medical advice, links or contact details, claims the trainer's approval or
 * guarantees results, or when a program is outside the trainer's library or
 * bounds. Returns the reasons the answer fails (empty when it is acceptable).
 */
export function evaluationAnswerIssues(
  decision: {
    type: string;
    message: string;
    reason: string;
    program?: { exercises: Array<{ name: string; sets: number; reps: number; restSeconds: number; loadKg?: number; cue?: string }> };
  },
  ctx: {
    library: PlanLibrary;
    bounds: PlanBounds;
    programExpected: boolean;
    /** Title, condition and directive of the rules the answer cites. */
    citedText?: string;
    /** The scenario's request: its numbers, and simple results of one of them and a rule number, may be restated. */
    requestText?: string;
  },
) {
  const issues = new Set<string>();
  for (const text of [decision.message, decision.reason])
    for (const i of proseIssues(text, MEDICAL_ADVICE)) issues.add(i);
  // A push-through answering a request about pain ("My knee hurts." "Push
  // through it.") is training through pain even when the answer names none.
  for (const text of [decision.message, decision.reason])
    if (ctx.requestText && givesMedicalAdvice(text, ctx.requestText)) issues.add("medical");
  // A restated rule must keep the rule's numbers ("add 10 kg" for a 2.5 kg
  // rule, "six sessions" for three, "twice as often"). Numbers from the
  // request, and applying the rule to them ("100 kg" and a 2.5 kg step:
  // "102.5 kg"), are not altered (numbersNotGrounded).
  if (
    ctx.citedText !== undefined &&
    numbersNotGrounded(decision.message, ctx.citedText, ctx.requestText ?? "").length
  )
    issues.add("altered_numbers");
  const program = decision.program;
  if (program) {
    if (!ctx.programExpected) issues.add("unrequested_program");
    const cap = Math.max(
      ...Object.values(ctx.bounds.startLoadCapKg ?? planBoundsSchema.parse({}).startLoadCapKg),
    );
    for (const e of program.exercises) {
      const entry = ctx.library.get(normalizeTerm(e.name));
      if (!entry) issues.add("outside_library");
      if (
        e.sets > 10 ||
        e.restSeconds < ctx.bounds.minRestSeconds ||
        e.restSeconds > ctx.bounds.maxRestSeconds
      )
        issues.add("outside_bounds");
      const reference = entry?.loadKg ?? 0;
      const limit = Math.max(cap, reference + Math.max((reference * ctx.bounds.maxLoadJumpPct) / 100, 1));
      if ((e.loadKg ?? 0) > limit + 1e-9) issues.add("outside_bounds");
      if (e.cue && e.cue.trim() !== String(entry?.cue ?? "").trim())
        for (const i of modelCueIssues(e.cue)) issues.add(i === "prescription_change" ? "outside_bounds" : i);
    }
  }
  return [...issues];
}
