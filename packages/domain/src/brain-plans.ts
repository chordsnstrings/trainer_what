import { z } from "zod";
import { addTrainingDays, canonicalCoaching } from "./coaching-completion.ts";

/**
 * Trainer Brain plan generation: the model's structured output, the code
 * validator (schema plus hard bounds), deterministic confidence and the
 * review diff. Nothing here trusts a model number: every bound is checked in
 * code against the trainer's settings and library.
 */
// v2: the prompt carries the week-1 starting-load references the validator
// enforces (logged or library loads, and the start cap without one).
export const planPromptVersion = "brain-plan-v2";
export const planAdaptationPromptVersion = "brain-plan-adapt-v1";
export const planValidatorVersion = "brain-plan-validator-v2";
export const planConfidenceVersion = "brain-plan-confidence-v1";
export const planRouteVersion = "brain-plan-route-v2";

const name = z.string().trim().min(2).max(100);
export const planExerciseSchema = z
  .object({
    name,
    sets: z.number().int().min(1).max(10),
    reps: z.number().int().min(1).max(30),
    loadKg: z.number().min(0).max(500),
    rir: z.number().int().min(0).max(5),
    restSeconds: z.number().int().min(15).max(600),
    // Library cues may be up to 1000 characters (trainingExerciseSchema).
    cue: z.string().max(1000).default(""),
    alternatives: z.array(name).max(4).default([]),
  })
  .strict();
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
    sets: z.number().int().min(1).max(10).optional(),
    reps: z.number().int().min(1).max(30).optional(),
    loadKg: z.number().min(0).max(500).optional(),
    rir: z.number().int().min(0).max(5).optional(),
    restSeconds: z.number().int().min(15).max(600).optional(),
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

export type ExpandedExercise = {
  name: string;
  sets: number;
  reps: number;
  loadKg: number;
  rir: number;
  restSeconds: number;
  cue: string;
  alternatives: string[];
};
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
export function expandPlan(draft: PlanDraft): ExpandedWeek[] {
  return draft.weeks.map((w) => ({
    week: w.week,
    focus: w.focus,
    deload: w.deload,
    sessions: draft.sessions.map((s) => ({
      key: s.key,
      label: s.label,
      weekday: s.weekday,
      exercises: s.exercises.map((e) => ({
        name: e.name,
        sets: Math.max(1, Math.round(e.sets * w.volumeFactor)),
        reps: e.reps,
        loadKg: halfKg(e.loadKg * w.loadFactor),
        rir: Math.min(5, Math.max(0, e.rir + w.rirDelta)),
        restSeconds: e.restSeconds,
        cue: e.cue,
        alternatives: e.alternatives,
      })),
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
export const sessionMinutes = (exercises: ExpandedExercise[]) =>
  Math.round(
    8 +
      exercises.reduce(
        (sum, e) => sum + 1 + (e.sets * (e.reps * 4 + e.restSeconds)) / 60,
        0,
      ),
  );
const volume = (sessions: Array<{ exercises: ExpandedExercise[] }>) =>
  sessions.reduce(
    (sum, s) => sum + s.exercises.reduce((n, e) => n + e.sets, 0),
    0,
  );
export type PlanCheckContext = {
  profile: Pick<PlanProfile, "experience" | "daysPerWeek" | "equipment">;
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
};
export type PlanValidation = {
  errors: string[];
  warnings: string[];
  metrics: {
    weeklyVolume: number[];
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
    const names = s.exercises.map((e) => normalizeTerm(e.name));
    if (new Set(names).size !== names.length)
      result.errors.push(`${label} repeats an exercise`);
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
      if (
        e.restSeconds < ctx.bounds.minRestSeconds ||
        e.restSeconds > ctx.bounds.maxRestSeconds
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
    if (minutes > ctx.bounds.maxSessionMinutes)
      result.errors.push(
        `${label} takes about ${minutes} minutes (limit ${ctx.bounds.maxSessionMinutes})`,
      );
  }
}
function checkTransition(
  previous: Array<{ key: string; exercises: ExpandedExercise[] }>,
  next: Array<{ key: string; exercises: ExpandedExercise[] }>,
  ctx: PlanCheckContext,
  where: string,
  result: PlanValidation,
) {
  const before = volume(previous),
    after = volume(next);
  const allowed = Math.max(
    1,
    Math.floor((before * ctx.bounds.maxWeeklyVolumeIncreasePct) / 100),
  );
  if (before > 0 && after - before > allowed)
    result.errors.push(
      `${where}: weekly volume rises from ${before} to ${after} sets (limit +${ctx.bounds.maxWeeklyVolumeIncreasePct}%)`,
    );
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
  const expanded = expandPlan(draft);
  let reference = ctx.previousWeek?.length ? ctx.previousWeek : null;
  for (const week of expanded) {
    const where = `Week ${week.week}`;
    checkSessions(week.sessions, ctx, where, result);
    result.metrics.weeklyVolume.push(volume(week.sessions));
    // Week 1 has no earlier week in this draft: new exercises are bounded by
    // the member's history, the library load or the start cap.
    if (week.week === 1)
      checkStartLoads(week.sessions, names(reference ?? []), ctx, where, result);
    if (reference) checkTransition(reference, week.sessions, ctx, where, result);
    if (!week.deload) reference = week.sessions;
  }
  return finish(
    result,
    draft.sessions.flatMap((s) => s.exercises.map((e) => e.name)),
    ctx,
  );
}
/** Validates one adapted week against the week it follows. */
export function validateAdaptedWeek(
  current: Array<{ key: string; exercises: ExpandedExercise[] }>,
  next: Array<{ key: string; exercises: ExpandedExercise[] }>,
  ctx: PlanCheckContext,
): PlanValidation {
  const result = emptyValidation();
  checkSessions(next, ctx, "Next week", result);
  result.metrics.weeklyVolume.push(volume(next));
  // A swapped-in alternative has no load this week to compare against.
  checkStartLoads(next, names(current), ctx, "Next week", result);
  if (current.length) checkTransition(current, next, ctx, "Next week", result);
  return finish(
    result,
    next.flatMap((s) => s.exercises.map((e) => e.name)),
    ctx,
  );
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
    const exercise = session?.exercises.find(
      (e) => normalizeTerm(e.name) === normalizeTerm(change.exercise),
    );
    if (!session || !exercise) {
      errors.push(`${change.exercise} is not in next week's session ${change.sessionKey}`);
      continue;
    }
    for (const key of ["sets", "reps", "loadKg", "rir", "restSeconds"] as const)
      if (change[key] !== undefined) (exercise as any)[key] = change[key];
    if (change.replaceWith) {
      if (!exercise.alternatives.some((a) => normalizeTerm(a) === normalizeTerm(change.replaceWith!)))
        errors.push(`${change.replaceWith} is not an approved alternative to ${exercise.name}`);
      else {
        exercise.alternatives = exercise.alternatives.filter(
          (a) => normalizeTerm(a) !== normalizeTerm(change.replaceWith!),
        );
        exercise.name = change.replaceWith;
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
  const b = new Map(before.map((e) => [normalizeTerm(e.name), e])),
    a = new Map(after.map((e) => [normalizeTerm(e.name), e]));
  for (const [key, e] of b)
    if (!a.has(key)) out.push({ path: `${path}.${e.name}`, from: "present", to: "removed" });
  for (const [key, e] of a) {
    const prior = b.get(key);
    if (!prior) {
      out.push({ path: `${path}.${e.name}`, from: "absent", to: "added" });
      continue;
    }
    for (const field of ["sets", "reps", "loadKg", "rir", "restSeconds", "cue", "alternatives"])
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
