import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  elevated,
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import {
  adaptationWeekSchema,
  applyAdaptation,
  caseCoverage,
  datedPlanSessions,
  defaultPlanSettings,
  normalizeTerm,
  planConfidence,
  planDiff,
  planEditSchema,
  planLibrary,
  planSafetyReasons,
  planScenarioSchema,
  planSegment,
  planSettingsSchema,
  planWeeksFor,
  ruleCoverage,
  spotCheckSample,
  validateAdaptedWeek,
  validatePlan,
  type AdaptationWeek,
  type ExpandedExercise,
  type PlanDraft,
  type PlanLibrary,
  type PlanProfile,
  type PlanSettings,
} from "../../../packages/domain/src/brain-plans.ts";
import {
  addTrainingDays,
  canonicalCoaching,
  effectiveWorkoutSets,
} from "../../../packages/domain/src/coaching-completion.ts";
import { screenSafety } from "../../../packages/domain/src/safety-policy.ts";
import {
  generateTrainingPlan,
  planModelConfigured,
  planModelPin,
  proposePlanAdaptation,
  retrievePlanMaterial,
} from "../../../packages/providers/src/brain-plans.ts";
import { modelAccounting } from "./model-accounting.ts";
import { memberAccess } from "./entitlements.ts";
import { currentClientTwin } from "./client-twin.ts";
import { lockTraining } from "./coaching-completion.ts";
import { activeSafetyPolicy } from "./safety-policy.ts";
import { notifyCoachingTeam, notifyUser } from "./notifications.ts";
import { programmeLengthDays } from "./programme-length.ts";

const id = z.string().uuid();
const hash = (value: unknown) =>
  createHash("sha256").update(canonicalCoaching(value)).digest("hex");
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
function trainer(req: FastifyRequest) {
  if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (!["owner", "staff"].includes(req.identity.role))
    throw fail(403, "COACHING_TEAM_REQUIRED", "Coaching team access required");
  return req.identity;
}
function owner(req: FastifyRequest) {
  const a = trainer(req);
  if (a.role !== "owner")
    throw fail(403, "OWNER_REQUIRED", "Only the trainer owner can change this");
  return a;
}
const MAX_SCENARIOS = 50,
  MIN_SCENARIOS = 6,
  NEXT_BLOCK_LEAD_DAYS = 3,
  LEARNING_LIMIT = 500;
const localDate = (timezone: string, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) /
      86400000,
  );
const validZone = (zone: unknown) => {
  if (typeof zone !== "string" || !zone) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
};
/** The member's own timezone: notification preference, nutrition profile, then UTC. */
export async function memberPlanTimezone(tx: Tx, userId: string) {
  const [pref] = await tx.query(
    "SELECT data->>'timezone' AS zone FROM notification_preferences WHERE user_id=$1",
    [userId],
  );
  if (validZone(pref?.zone)) return pref.zone as string;
  const [profile] = await tx.query(
    "SELECT data->'profile'->>'timezone' AS zone FROM records WHERE kind='nutrition_profile' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  return validZone(profile?.zone) ?? "UTC";
}
/** Worker scopes are not members; they take the same per-member training lock directly. */
async function planLock(tx: Tx, a: Actor, userId: string) {
  if (!a.elevation) return lockTraining(tx, a, userId);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":training:" + userId,
  ]);
}
export async function loadPlanSettings(tx: Tx) {
  const [row] = await tx.query(
    "SELECT * FROM records WHERE kind='plan_brain_settings' ORDER BY created_at DESC LIMIT 1",
  );
  const parsed = planSettingsSchema.safeParse(row?.data?.settings ?? {});
  return {
    row: row ?? null,
    settings: parsed.success ? parsed.data : defaultPlanSettings(),
  };
}
async function trainerMaterial(tx: Tx) {
  const [release] = await tx.query(
    "SELECT * FROM records WHERE kind='brain_release' AND status='published' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  const cases = await tx.query(
    "SELECT * FROM records WHERE kind='coaching_teaching' AND status='confirmed' ORDER BY id LIMIT 101",
  );
  const learning = await tx.query(
    "SELECT * FROM records WHERE kind='plan_learning' AND status='confirmed' ORDER BY created_at DESC,id DESC LIMIT $1",
    [LEARNING_LIMIT],
  );
  const templates = await tx.query(
    "SELECT * FROM records WHERE kind='program' AND status='template' ORDER BY created_at DESC,id LIMIT 100",
  );
  const exercises = await tx.query(
    "SELECT * FROM records WHERE kind='exercise' AND status='active' ORDER BY data->>'name',id LIMIT 1000",
  );
  const rules = (release?.data?.rules ?? []) as Array<{
    id: string;
    version?: number;
    data: any;
  }>;
  return {
    release: release ?? null,
    rules,
    cases,
    learning,
    templates,
    exercises,
    library: planLibrary(exercises as any[], templates as any[]),
  };
}
type Material = Awaited<ReturnType<typeof trainerMaterial>>;
const ruleTexts = (m: Material) => [
  ...m.rules.map((r) =>
    [r.data?.title, r.data?.category, r.data?.condition, r.data?.directive].join(" "),
  ),
  ...m.cases
    .filter((c) => ["program_build", "progression", "substitution", "schedule"].includes(c.data.category))
    .map((c) => [c.data.scenario, c.data.recommendation, c.data.reason].join(" ")),
];
const learningRows = (m: Material) =>
  m.learning.map((l) => ({
    decision: l.data.decision,
    segment: l.data.segment,
    type: l.data.type,
  }));
/** The plan contract a qualification pins: Brain release, rules, prompt/validator/retrieval versions, model and bounds. */
function planContract(release: any, settings: PlanSettings) {
  const pin = planModelPin();
  return hash({
    brainReleaseId: release?.id ?? null,
    rules: (release?.data?.rules ?? []).map((r: any) => ({
      id: r.id,
      version: r.version ?? null,
    })),
    pin: {
      endpoint: pin.endpoint,
      model: pin.model,
      promptVersion: pin.promptVersion,
      adaptationPromptVersion: pin.adaptationPromptVersion,
      validatorVersion: pin.validatorVersion,
      confidenceVersion: pin.confidenceVersion,
      retrieval: pin.retrieval.version,
    },
    bounds: settings.bounds,
  });
}
async function heldOutPlanScenarios(tx: Tx) {
  return tx.query(
    "SELECT * FROM records WHERE kind='plan_scenario' AND status='held_out' ORDER BY id LIMIT $1",
    [MAX_SCENARIOS + 1],
  );
}
const scenariosDigest = (rows: any[]) =>
  hash(rows.map((r) => ({ id: r.id, data: r.data })));
export async function planQualificationState(tx: Tx, settings: PlanSettings) {
  const m = await trainerMaterial(tx);
  const contractDigest = planContract(m.release, settings);
  const scenarios = await heldOutPlanScenarios(tx);
  const digest = scenariosDigest(scenarios);
  const [latest] = await tx.query(
    "SELECT * FROM records WHERE kind='plan_qualification' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  const [passing] = await tx.query(
    "SELECT * FROM records WHERE kind='plan_qualification' AND status='passed' AND data->>'contractDigest'=$1 AND data->>'scenariosDigest'=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
    [contractDigest, digest],
  );
  return {
    qualified: !!passing && !!m.release,
    contractDigest,
    scenariosDigest: digest,
    scenarios,
    latest: latest ?? null,
    passingId: passing?.id ?? null,
  };
}
function profileOf(intake: any): PlanProfile {
  return {
    ...(Number.isInteger(intake.data.age) ? { age: intake.data.age } : {}),
    goal: String(intake.data.goal ?? "").slice(0, 1000),
    experience: intake.data.experience,
    daysPerWeek: intake.data.daysPerWeek,
    equipment: String(intake.data.equipment ?? ""),
    limitations: String(intake.data.limitations ?? ""),
  };
}
function twinProjection(twin: any) {
  const coaching = twin?.data?.coaching ?? {};
  const projection = {
    snapshotId: twin?.id ?? null,
    training: coaching.training ?? null,
    adherence: coaching.adherence
      ? {
          rate: coaching.adherence.rate ?? null,
          completed: coaching.adherence.completed ?? null,
          planned: coaching.adherence.planned ?? null,
        }
      : null,
  };
  // The prompt carries a bounded summary; a very long history keeps only adherence.
  return JSON.stringify(projection).length > 8000
    ? { snapshotId: projection.snapshotId, adherence: projection.adherence }
    : projection;
}
/** Red-flag terms (code floor and published policy) and personal-review topics in member text. */
async function screenTexts(tx: Tx, texts: string[]) {
  const policy = await activeSafetyPolicy(tx);
  const reasons: string[] = [];
  for (const text of texts.filter((t) => t && t.trim())) {
    const s = screenSafety(text, policy);
    if (s.hold) reasons.push("A red-flag safety term was reported");
    else if (s.review)
      reasons.push(
        `A personal-review topic was reported (${s.reviewCategories.join(", ")})`,
      );
  }
  return [...new Set(reasons)];
}
/** Pain and safety reports in the window: holds, flagged set notes and check-in notes. */
async function recentSafety(tx: Tx, userId: string, days: number) {
  const [holds] = await tx.query(
    "SELECT count(*)::int AS n FROM records WHERE owner_user_id=$1 AND (kind='training_hold' OR (kind='workout' AND status='safety_hold')) AND created_at>=now()-make_interval(days=>$2)",
    [userId, days],
  );
  const notes = await tx.query(
    "SELECT data->>'notes' AS text FROM workout_events WHERE user_id=$1 AND created_at>=now()-make_interval(days=>$2) AND coalesce(data->>'notes','')<>'' ORDER BY created_at DESC LIMIT 200",
    [userId, days],
  );
  const checkins = await tx.query(
    "SELECT data FROM records WHERE kind='nutrition_checkin' AND owner_user_id=$1 AND created_at>=now()-make_interval(days=>$2) ORDER BY created_at DESC LIMIT 50",
    [userId, days],
  );
  const texts = [
    ...notes.map((n) => n.text as string),
    ...checkins.flatMap((c) =>
      Object.entries(c.data ?? {})
        .filter(([k, v]) => typeof v === "string" && !["fingerprint", "date", "eventKey"].includes(k))
        .map(([, v]) => v as string),
    ),
  ];
  const flagged = await screenTexts(tx, texts);
  return {
    painReports: holds.n + (flagged.length ? 1 : 0),
    reasons: flagged.map((r) => r + " in recent training notes or check-ins"),
  };
}
async function updateGeneration(
  tx: Tx,
  generationId: string,
  status: string,
  patch: Record<string, unknown>,
) {
  await tx.query(
    "UPDATE records SET status=$2,version=version+1,data=data||$3::jsonb,updated_at=now() WHERE id=$1 AND kind='plan_generation'",
    [generationId, status, JSON.stringify(patch)],
  );
}
async function lockedGeneration(tx: Tx, generationId: string) {
  const [row] = await tx.query(
    "SELECT * FROM records WHERE id=$1 AND kind='plan_generation' FOR UPDATE",
    [generationId],
  );
  return row;
}
async function reviewedCount(tx: Tx) {
  const [row] = await tx.query(
    "SELECT count(*)::int AS n FROM records WHERE kind='plan_learning' AND status='confirmed'",
  );
  return row.n as number;
}
function toProgramExercise(e: ExpandedExercise, library: PlanLibrary) {
  const entry = library.get(normalizeTerm(e.name));
  return {
    name: entry?.name ?? e.name,
    sets: Math.min(10, e.sets),
    reps: e.reps,
    restSeconds: e.restSeconds,
    loadKg: e.loadKg,
    rir: e.rir,
    cue: (e.cue || entry?.cue || "").slice(0, 1000),
    ...(entry?.demonstrationUrl ? { demonstrationUrl: entry.demonstrationUrl } : {}),
    alternatives: e.alternatives.slice(0, 10).map((n) => {
      const alt = library.get(normalizeTerm(n));
      return { name: alt?.name ?? n, cue: (alt?.cue ?? "").slice(0, 1000), loadKg: e.loadKg };
    }),
  };
}
const fromProgramExercise = (e: any): ExpandedExercise => ({
  name: e.name,
  sets: e.sets,
  reps: e.reps,
  loadKg: e.loadKg ?? 0,
  rir: e.rir ?? 2,
  restSeconds: e.restSeconds ?? 90,
  cue: e.cue ?? "",
  alternatives: (e.alternatives ?? []).map((a: any) => (typeof a === "string" ? a : a.name)),
});

/**
 * Writes a plan exactly like scheduleProgram: one assigned `program` and one
 * `planned_session` per training date in the member's timezone, so the
 * calendar, reminders, workouts and the Client Twin use it unchanged. Other
 * assigned programmes are archived and their sessions from the start date on
 * are canceled; a started session keeps its date.
 */
async function deliverProgramme(
  tx: Tx,
  a: Actor,
  input: {
    userId: string;
    generationId: string;
    draft: PlanDraft;
    profile: PlanProfile;
    programmeDays: number;
    startDate: string;
    timezone: string;
    library: PlanLibrary;
    brainReleaseId: string | null;
    fromDate?: string;
  },
) {
  const today = localDate(input.timezone);
  const startDate = input.fromDate
    ? input.startDate
    : input.startDate < today
      ? today
      : input.startDate;
  const fromDate = input.fromDate ?? startDate;
  const endDate = addTrainingDays(startDate, input.programmeDays - 1);
  // A Brain block that ends before this one starts stays assigned for its
  // last days (the member keeps training it); the worker archives it once it
  // has ended (archiveEndedBlocks). Everything else is replaced now.
  const replaced = await tx.query(
    "UPDATE records SET status='archived',version=version+1,updated_at=now() WHERE kind='program' AND owner_user_id=$1 AND status='assigned' AND NOT (data->>'generated'='true' AND coalesce(data->>'endDate','9999-12-31')<$2) RETURNING id",
    [input.userId, startDate],
  );
  if (replaced.length)
    await tx.query(
      "UPDATE records SET status='canceled',version=version+1,data=data||$3::jsonb,updated_at=now() WHERE kind='planned_session' AND owner_user_id=$1 AND status='planned' AND data->>'programId'=ANY($2::text[]) AND data->>'date'>=$4",
      [
        input.userId,
        replaced.map((r) => r.id),
        JSON.stringify({ cancelNote: "Replaced by a new plan", canceledBy: a.userId }),
        fromDate,
      ],
    );
  const weeks = planWeeksFor(input.programmeDays);
  const firstWeek = datedPlanSessions(input.draft, startDate, 7);
  const weekOne = input.draft.sessions.map((s) => ({
    label: s.label,
    weekday: s.weekday,
    exercises: (firstWeek.find((d) => d.key === s.key)?.exercises ?? s.exercises.map((e) => ({ ...e }))).map(
      (e) => toProgramExercise(e as ExpandedExercise, input.library),
    ),
  }));
  const program = await putRecord(
    tx,
    a,
    "program",
    {
      title: input.draft.title,
      goal: input.profile.goal,
      daysPerWeek: input.draft.sessions.length,
      exercises: weekOne[0].exercises,
      weeks: Math.min(26, weeks),
      sessions: weekOne,
      summary: input.draft.summary,
      generated: true,
      generationId: input.generationId,
      brainReleaseId: input.brainReleaseId,
      programmeDays: input.programmeDays,
      startDate,
      endDate,
      timezone: input.timezone,
      planWeeks: input.draft.weeks,
      draft: input.draft,
      authorId: a.userId,
      allowedUses: ["render", "model_prompt"],
    },
    { ownerId: input.userId, status: "assigned" },
  );
  const started = new Set(
    (
      await tx.query(
        "SELECT data->>'date' AS date FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND status IN ('started','completed','planned') AND data->>'date'>=$2",
        [input.userId, fromDate],
      )
    ).map((r) => r.date),
  );
  let sessions = 0;
  for (const slot of datedPlanSessions(input.draft, startDate, input.programmeDays)) {
    if (slot.date < fromDate || started.has(slot.date)) continue;
    await putRecord(
      tx,
      a,
      "planned_session",
      {
        date: slot.date,
        timezone: input.timezone,
        week: slot.week,
        label: slot.label,
        sessionKey: slot.key,
        program: {
          title: slot.label,
          goal: input.profile.goal,
          daysPerWeek: input.draft.sessions.length,
          weeks: Math.min(26, weeks),
          exercises: slot.exercises.map((e) => toProgramExercise(e, input.library)),
        },
        programId: program.id,
        programVersion: program.version,
        generationId: input.generationId,
      },
      { ownerId: input.userId, status: "planned" },
    );
    sessions++;
  }
  await event(tx, a, "program.scheduled", program.id, {
    subscriberId: input.userId,
    startDate,
    timezone: input.timezone,
    sessions,
  });
  return { program, sessions, startDate, endDate };
}
async function noticeDelivered(tx: Tx, a: Actor, userId: string, generationId: string, adjusted = false) {
  await notifyUser(tx, a, {
    userId,
    category: "coaching",
    dedupeKey: `brain-plan:${generationId}`,
    title: adjusted ? "Next week's training was adjusted" : "Your training plan is ready",
    body: adjusted
      ? "Your trainer's Brain adjusted next week's sessions from how this week went. Open Training to see them."
      : "Your trainer's Brain prepared your plan from your profile. Open Training to see today's session and the weeks ahead.",
    href: "/app/program",
    templateKey: adjusted ? "brain-plan-adjusted" : "brain-plan-ready",
    source: { type: "plan_generation", id: generationId },
  });
}
async function noticeReview(tx: Tx, a: Actor, generationId: string) {
  await notifyCoachingTeam(tx, a, {
    category: "coaching",
    dedupeKey: `brain-plan-review:${generationId}`,
    title: "A plan needs your review",
    body: "Your Brain prepared a plan it is not confident about, or one the safety rules send to you. Review, edit or reject it.",
    href: "/trainer/brain/plans",
    templateKey: "brain-plan-review",
    source: { type: "plan_generation", id: generationId },
  });
}

// ---------------------------------------------------------------------------
// Programme generation

type GenerationOptions = {
  trigger: "intake" | "block_end" | "manual";
  jobId?: string;
  startDate?: string;
};
type Prepared = {
  generationId: string;
  userId: string;
  profile: PlanProfile;
  programmeDays: number;
  startDate: string;
  timezone: string;
  intakeId: string;
  twin: unknown;
  previousWeek: Array<{ key: string; exercises: ExpandedExercise[] }>;
  retrieval: ReturnType<typeof retrievePlanMaterial>;
  settings: PlanSettings;
};
async function memberReady(tx: Tx, userId: string) {
  const [member] = await tx.query(
    "SELECT user_id FROM memberships WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=$1 AND role='subscriber'",
    [userId],
  );
  if (!member) return { skip: "not_member" as const };
  const [held] = await tx.query(
    "SELECT id FROM records WHERE owner_user_id=$1 AND ((kind='training_hold' AND status='active') OR (kind='workout' AND status='safety_hold')) LIMIT 1",
    [userId],
  );
  if (held) return { skip: "safety_hold" as const };
  if (!(await memberAccess(tx, userId)).active) return { skip: "no_access" as const };
  const [intake] = await tx.query(
    "SELECT * FROM records WHERE kind='intake' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  if (!intake || !intake.data.allowedUses?.includes("model_prompt"))
    return { skip: "no_intake" as const };
  const [consent] = await tx.query(
    "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  if (!consent?.granted) return { skip: "no_consent" as const };
  return { intake };
}
async function prepareGeneration(
  tx: Tx,
  a: Actor,
  userId: string,
  options: GenerationOptions,
): Promise<{ skip: string; generation?: any } | { prepared: Prepared }> {
  await planLock(tx, a, userId);
  if (options.jobId) {
    const [existing] = await tx.query(
      "SELECT * FROM records WHERE kind='plan_generation' AND data->>'jobId'=$1",
      [options.jobId],
    );
    // A retried job never pays the model twice: an interrupted request's
    // outcome is unknown, so it goes to the trainer instead.
    if (existing && existing.status === "generating") {
      await updateGeneration(tx, existing.id, "failed", {
        error: "The previous attempt was interrupted after the model request; review or regenerate this plan.",
        providerState: "unknown",
      });
      return { skip: "interrupted", generation: existing };
    }
    if (existing && existing.status !== "not_sent")
      return { skip: "already_generated", generation: existing };
  }
  const ready = await memberReady(tx, userId);
  if ("skip" in ready) return { skip: ready.skip! };
  const intake = ready.intake;
  const { settings } = await loadPlanSettings(tx);
  const material = await trainerMaterial(tx);
  if (!material.release) return { skip: "no_brain" };
  if (!material.library.size) return { skip: "no_library" };
  const programmeDays = await programmeLengthDays(tx, userId);
  const timezone = await memberPlanTimezone(tx, userId);
  const today = localDate(timezone);
  const [previous] = await tx.query(
    "SELECT * FROM records WHERE kind='program' AND owner_user_id=$1 AND status='assigned' ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  let startDate = options.startDate ?? today;
  if (startDate < today) startDate = today;
  let previousWeek: Prepared["previousWeek"] = [];
  if (previous?.data?.generated && previous.data.endDate) {
    // The new block's first week is bounded by the last full (non-deload)
    // week the member was prescribed, including weekly adaptations.
    const weeks: any[] = Array.isArray(previous.data.planWeeks) ? previous.data.planWeeks : [];
    const lastFull = [...weeks].reverse().find((w) => !w.deload)?.week ?? weeks.length;
    const last = await tx.query(
      "SELECT data FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND data->>'programId'=$2 AND (data->>'week')::int=$3 AND status<>'canceled' ORDER BY data->>'date'",
      [userId, previous.id, lastFull],
    );
    previousWeek = last.map((s) => ({
      key: s.data.sessionKey ?? s.data.label,
      exercises: (s.data.program?.exercises ?? []).map(fromProgramExercise),
    }));
  }
  const profile = profileOf(intake);
  const segment = planSegment(profile);
  const twin = twinProjection(await currentClientTwin(tx, a, userId));
  const retrieval = retrievePlanMaterial({
    tenantId: a.tenantId,
    segment,
    goal: profile.goal,
    rules: material.rules,
    cases: material.cases,
    learning: material.learning,
    templates: material.templates,
    library: material.library,
  });
  const contractDigest = planContract(material.release, settings);
  const inputs = {
    intakeId: intake.id,
    intakeVersion: intake.version,
    profile,
    segment,
    programmeDays,
    startDate,
    timezone,
    twinSnapshotId: (twin as any).snapshotId ?? null,
    previousProgramId: previous?.id ?? null,
    bounds: settings.bounds,
  };
  const data = {
    type: "programme",
    subscriberId: userId,
    trigger: options.trigger,
    ...(options.jobId ? { jobId: options.jobId } : {}),
    brainReleaseId: material.release.id,
    contractDigest,
    promptVersion: planModelPin().promptVersion,
    inputs,
    inputsDigest: hash({ inputs, material: retrieval.trace.materialDigest }),
    retrieval: retrieval.trace,
    requestedBy: a.userId,
  };
  let generationId: string;
  const [notSent] = options.jobId
    ? await tx.query(
        "SELECT id FROM records WHERE kind='plan_generation' AND data->>'jobId'=$1 AND status='not_sent'",
        [options.jobId],
      )
    : [];
  if (notSent) {
    generationId = notSent.id;
    await updateGeneration(tx, generationId, "generating", data);
  } else {
    generationId = (
      await putRecord(tx, a, "plan_generation", data, {
        ownerId: userId,
        status: "generating",
      })
    ).id;
  }
  await event(tx, a, "brain.plan_generation_started", generationId, {
    trigger: options.trigger,
  });
  return {
    prepared: {
      generationId,
      userId,
      profile,
      programmeDays,
      startDate,
      timezone,
      intakeId: intake.id,
      twin,
      previousWeek,
      retrieval,
      settings,
    },
  };
}
const NOT_SENT_CODES = new Set([
  "MODEL_DAILY_LIMIT",
  "MODEL_USER_LIMIT",
  "MODEL_NOT_CONFIGURED",
  "PLAN_CONTEXT_TOO_LARGE",
]);
/** Records a model failure: refused before dispatch stays retryable; anything else goes to the trainer. */
async function recordModelFailure(db: Database, a: Actor, generationId: string, error: any) {
  const notSent = NOT_SENT_CODES.has(error?.code);
  await db.tenant(a, (tx) =>
    updateGeneration(tx, generationId, notSent ? "not_sent" : "failed", {
      error: String(error?.message ?? "Model request failed").slice(0, 500),
      providerState: notSent ? "not_sent" : "unknown",
    }),
  );
  if (notSent) throw error;
  return { status: "failed", generationId };
}

/**
 * Generates one member's programme: gather in one transaction, call the model
 * outside it, then recheck and route in a second. Returns what happened.
 */
export async function generateMemberPlan(
  db: Database,
  a: Actor,
  userId: string,
  options: GenerationOptions,
) {
  const first = await db.tenant(a, (tx) => prepareGeneration(tx, a, userId, options));
  if ("skip" in first)
    return { status: "skipped", reason: first.skip, generationId: first.generation?.id ?? null };
  const p = first.prepared;
  let result: Awaited<ReturnType<typeof generateTrainingPlan>>;
  try {
    result = await generateTrainingPlan(
      {
        profile: p.profile,
        programme: {
          days: p.programmeDays,
          weeks: planWeeksFor(p.programmeDays),
          startDate: p.startDate,
        },
        bounds: p.settings.bounds,
        twin: p.twin,
        previous: p.previousWeek.length ? { lastWeek: p.previousWeek } : null,
        material: p.retrieval.material,
      },
      modelAccounting(db, a, "brain_plan"),
    );
  } catch (error) {
    return recordModelFailure(db, a, p.generationId, error);
  }
  return db.tenant(a, async (tx) => {
    await planLock(tx, a, userId);
    const gen = await lockedGeneration(tx, p.generationId);
    if (!gen || gen.status !== "generating") return { status: gen?.status ?? "missing", generationId: p.generationId };
    const usage = { input: result.usage.input, output: result.usage.output, cost: result.usage.cost };
    const ready = await memberReady(tx, userId);
    if ("skip" in ready || ready.intake.id !== p.intakeId) {
      await updateGeneration(tx, gen.id, "superseded", {
        modelPin: result.pin,
        usage,
        error: "skip" in ready ? `Not delivered: ${ready.skip}` : "The subscriber updated their intake during generation",
      });
      return { status: "superseded", generationId: gen.id };
    }
    const { settings } = await loadPlanSettings(tx);
    const material = await trainerMaterial(tx);
    if (!result.draft) {
      await updateGeneration(tx, gen.id, "failed", {
        modelPin: result.pin,
        usage,
        validation: { errors: result.errors, warnings: [], metrics: null },
        route: "review",
        routeReasons: ["The model did not return a valid plan structure"],
      });
      await noticeReview(tx, a, gen.id);
      await event(tx, a, "brain.plan_failed", gen.id);
      return { status: "failed", generationId: gen.id };
    }
    return routeProgramme(tx, a, gen, result.draft, {
      prepared: p,
      settings,
      material,
      modelPin: result.pin,
      usage,
    });
  });
}
async function routeProgramme(
  tx: Tx,
  a: Actor,
  gen: any,
  draft: PlanDraft,
  ctx: {
    prepared: Prepared;
    settings: PlanSettings;
    material: Material;
    modelPin: unknown;
    usage: unknown;
  },
) {
  const p = ctx.prepared,
    settings = ctx.settings;
  const validation = validatePlan(draft, {
    profile: p.profile,
    library: ctx.material.library,
    bounds: settings.bounds,
    evidenceIds: p.retrieval.evidenceIds,
    programmeDays: p.programmeDays,
    previousWeek: p.previousWeek,
  });
  const segment = planSegment(p.profile);
  const confidence = planConfidence({
    ruleCoverage: ruleCoverage(segment, ruleTexts(ctx.material)),
    caseCoverage: caseCoverage(segment, learningRows(ctx.material)),
    validation,
    selfConfidence: draft.selfConfidence,
    uncertainties: draft.uncertainties,
    threshold: settings.threshold,
  });
  const recent = await recentSafety(tx, p.userId, 28);
  const safety = planSafetyReasons({
    limitations: p.profile.limitations,
    redFlags: [
      ...(await screenTexts(tx, [p.profile.goal, p.profile.limitations, p.profile.equipment])),
      ...recent.reasons,
    ],
    painReports: recent.painReports,
  });
  const qualification = await planQualificationState(tx, settings);
  const automaticAllowed = settings.mode === "automatic" && qualification.qualified;
  const route =
    automaticAllowed && !safety.length && confidence.confident ? "automatic" : "review";
  const routeReasons = [
    ...safety.map((s) => "Safety: " + s),
    ...(settings.mode === "supervised" ? ["Supervised mode: every plan goes to you"] : []),
    ...(!qualification.qualified
      ? ["Plan qualification has not passed for the current Brain, so plans go to you (supervised)"]
      : []),
    ...(!confidence.confident
      ? [`Confidence ${confidence.score.toFixed(2)} is below your threshold ${settings.threshold.toFixed(2)}`, ...confidence.reasons]
      : []),
  ];
  const young = (await reviewedCount(tx)) < settings.youngBrainReviews;
  const spotCheck = route === "automatic" && young && spotCheckSample(gen.id, settings.spotCheckRate);
  const base = {
    draft,
    modelPin: ctx.modelPin,
    usage: ctx.usage,
    validation,
    confidence,
    safety,
    route,
    routeReasons,
    qualified: qualification.qualified,
    qualificationId: qualification.passingId,
    mode: settings.mode,
  };
  if (route === "automatic") {
    const delivered = await deliverProgramme(tx, a, {
      userId: p.userId,
      generationId: gen.id,
      draft,
      profile: p.profile,
      programmeDays: p.programmeDays,
      startDate: p.startDate,
      timezone: p.timezone,
      library: ctx.material.library,
      brainReleaseId: gen.data.brainReleaseId,
    });
    await updateGeneration(tx, gen.id, "delivered", {
      ...base,
      outcome: {
        programId: delivered.program.id,
        sessions: delivered.sessions,
        startDate: delivered.startDate,
        endDate: delivered.endDate,
        deliveredAt: new Date().toISOString(),
        decision: "automatic",
        spotCheck: spotCheck ? "pending" : null,
      },
    });
    await noticeDelivered(tx, a, p.userId, gen.id);
    if (spotCheck) await noticeReview(tx, a, gen.id);
    await event(tx, a, "brain.plan_delivered", gen.id, {
      route,
      score: confidence.score,
      spotCheck,
    });
    return { status: "delivered", generationId: gen.id, programId: delivered.program.id, spotCheck, confidence };
  }
  await updateGeneration(tx, gen.id, "pending_review", base);
  await noticeReview(tx, a, gen.id);
  await event(tx, a, "brain.plan_review_required", gen.id, {
    score: confidence.score,
    safety: safety.length > 0,
  });
  return { status: "pending_review", generationId: gen.id, confidence, routeReasons };
}

// ---------------------------------------------------------------------------
// Weekly adaptation

const expandedSessions = (rows: any[]) =>
  rows.map((s) => ({
    plannedSessionId: s.id as string,
    key: (s.data.sessionKey ?? "A") as string,
    sessionKey: (s.data.sessionKey ?? "A") as string,
    exercises: (s.data.program?.exercises ?? []).map(fromProgramExercise),
  }));
async function weekOutcomes(tx: Tx, userId: string, current: any[], today: string) {
  // A session is due once its date has passed or it was completed early.
  const due = current.filter((s) => s.data.date <= today || s.status === "completed");
  const workouts = current.length
    ? await tx.query(
        "SELECT id,status,data->>'plannedSessionId' AS planned FROM records WHERE kind='workout' AND owner_user_id=$1 AND data->>'plannedSessionId'=ANY($2::text[])",
        [userId, current.map((s) => s.id)],
      )
    : [];
  const sets = workouts.length
    ? await tx.query(
        "SELECT * FROM workout_events WHERE user_id=$1 AND workout_id=ANY($2::uuid[]) ORDER BY created_at LIMIT 1000",
        [userId, workouts.map((w) => w.id)],
      )
    : [];
  const corrections = sets.length
    ? await tx.query(
        "SELECT * FROM records WHERE kind='workout_correction' AND owner_user_id=$1 AND data->>'eventId'=ANY($2::text[])",
        [userId, sets.map((s) => s.id)],
      )
    : [];
  const effective = effectiveWorkoutSets(sets, corrections);
  const exercises = new Map<string, any>();
  for (const s of current)
    for (const e of s.data.program?.exercises ?? []) {
      const key = normalizeTerm(e.name);
      const row = exercises.get(key) ?? {
        exercise: e.name,
        prescribed: { sets: 0, reps: e.reps, loadKg: e.loadKg, rir: e.rir },
        logged: { sets: 0, reps: 0, maxLoadKg: 0, rirTotal: 0, rirCount: 0 },
      };
      row.prescribed.sets += e.sets;
      row.prescribed.loadKg = Math.max(row.prescribed.loadKg, e.loadKg ?? 0);
      exercises.set(key, row);
    }
  for (const set of effective) {
    const row = exercises.get(normalizeTerm(String(set.data.exercise ?? "")));
    if (!row) continue;
    row.logged.sets++;
    row.logged.reps += Number(set.data.reps) || 0;
    row.logged.maxLoadKg = Math.max(row.logged.maxLoadKg, Number(set.data.loadKg) || 0);
    if (typeof set.data.rir === "number") {
      row.logged.rirTotal += set.data.rir;
      row.logged.rirCount++;
    }
  }
  const completed = current.filter((s) => s.status === "completed").length;
  // Check-ins of the week: numbers only (notes are screened for safety separately).
  const checkins = await tx.query(
    "SELECT data->>'date' AS date,(data->>'hunger')::int AS hunger,(data->>'difficulty')::int AS difficulty,(data->>'weightKg')::float AS weight FROM records WHERE kind='nutrition_checkin' AND owner_user_id=$1 AND created_at>=now()-interval '7 days' ORDER BY data->>'date' DESC LIMIT 14",
    [userId],
  );
  return {
    checkIns: checkins.map((c) => ({
      date: c.date,
      hunger: c.hunger,
      difficulty: c.difficulty,
      weightKg: c.weight,
    })),
    dueSessions: due.length,
    completedSessions: completed,
    skippedSessions: due.filter((s) => s.status === "planned" || s.status === "canceled").length,
    adherence: due.length ? Math.round((completed / due.length) * 100) / 100 : null,
    loggedSets: effective.length,
    exercises: [...exercises.values()].map((r) => ({
      exercise: r.exercise,
      prescribed: r.prescribed,
      logged: {
        sets: r.logged.sets,
        averageReps: r.logged.sets ? Math.round((r.logged.reps / r.logged.sets) * 10) / 10 : null,
        maxLoadKg: r.logged.maxLoadKg,
        averageRir: r.logged.rirCount ? Math.round((r.logged.rirTotal / r.logged.rirCount) * 10) / 10 : null,
      },
    })),
  };
}
/** Proposes next week's adjustments from this week's outcomes, through the same validator and gate. */
export async function adaptMemberPlan(
  db: Database,
  a: Actor,
  userId: string,
  options: { programId: string; week: number; jobId?: string },
) {
  const first = await db.tenant(a, async (tx) => {
    await planLock(tx, a, userId);
    if (options.jobId) {
      const [existing] = await tx.query(
        "SELECT * FROM records WHERE kind='plan_generation' AND data->>'jobId'=$1",
        [options.jobId],
      );
      if (existing?.status === "generating") {
        await updateGeneration(tx, existing.id, "failed", {
          error: "The previous attempt was interrupted after the model request; review this week manually.",
          providerState: "unknown",
        });
        return { skip: "interrupted" };
      }
      if (existing && existing.status !== "not_sent") return { skip: "already_generated" };
    }
    const ready = await memberReady(tx, userId);
    if ("skip" in ready) return { skip: ready.skip! };
    const [program] = await tx.query(
      "SELECT * FROM records WHERE kind='program' AND owner_user_id=$1 AND status='assigned' ORDER BY created_at DESC,id DESC LIMIT 1",
      [userId],
    );
    if (!program?.data?.generated || program.id !== options.programId) return { skip: "programme_changed" };
    const { settings } = await loadPlanSettings(tx);
    const material = await trainerMaterial(tx);
    if (!material.release) return { skip: "no_brain" };
    const rows = await tx.query(
      "SELECT * FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND data->>'programId'=$2 AND (data->>'week')::int IN ($3,$4) ORDER BY data->>'date',id",
      [userId, program.id, options.week - 1, options.week],
    );
    const current = rows.filter((r) => Number(r.data.week) === options.week - 1);
    const next = rows.filter((r) => Number(r.data.week) === options.week && r.status === "planned");
    if (!next.length) return { skip: "no_next_week" };
    const timezone = program.data.timezone ?? (await memberPlanTimezone(tx, userId));
    const outcomes = await weekOutcomes(tx, userId, current, localDate(timezone));
    const profile = profileOf(ready.intake);
    const segment = planSegment(profile);
    const recent = await recentSafety(tx, userId, 7);
    const safety = planSafetyReasons({
      limitations: profile.limitations,
      redFlags: recent.reasons,
      painReports: recent.painReports,
    });
    const retrieval = retrievePlanMaterial({
      tenantId: a.tenantId,
      segment,
      goal: profile.goal,
      rules: material.rules,
      cases: material.cases,
      learning: material.learning.filter((l) => l.data.type === "adaptation"),
      templates: [],
      library: material.library,
    });
    const nextSessions = expandedSessions(next);
    const data = {
      type: "adaptation",
      subscriberId: userId,
      trigger: "weekly",
      ...(options.jobId ? { jobId: options.jobId } : {}),
      brainReleaseId: material.release.id,
      contractDigest: planContract(material.release, settings),
      promptVersion: planModelPin().adaptationPromptVersion,
      inputs: { profile, segment, programId: program.id, week: options.week, timezone, outcomes },
      inputsDigest: hash({ program: program.id, week: options.week, outcomes, next: next.map((n) => [n.id, n.version]) }),
      retrieval: retrieval.trace,
      currentWeek: expandedSessions(current).map(({ sessionKey, exercises }) => ({ sessionKey, exercises })),
      baseline: { sessions: nextSessions.map((s) => ({ plannedSessionId: s.plannedSessionId, version: next.find((n) => n.id === s.plannedSessionId)!.version, sessionKey: s.sessionKey, exercises: s.exercises })) },
      requestedBy: a.userId,
    };
    if (safety.length) {
      // A pain report skips the model: the trainer decides next week personally.
      const gen = await putRecord(tx, a, "plan_generation", {
        ...data,
        draft: { sessions: nextSessions.map(({ plannedSessionId, sessionKey, exercises }) => ({ plannedSessionId, sessionKey, exercises })) },
        safety,
        route: "review",
        routeReasons: safety.map((s) => "Safety: " + s),
        validation: { errors: [], warnings: [], metrics: null },
      }, { ownerId: userId, status: "pending_review" });
      await noticeReview(tx, a, gen.id);
      await event(tx, a, "brain.plan_review_required", gen.id, { safety: true, type: "adaptation" });
      return { skip: "safety_review", generationId: gen.id };
    }
    const gen = await putRecord(tx, a, "plan_generation", data, { ownerId: userId, status: "generating" });
    return {
      prepared: {
        generationId: gen.id,
        profile,
        segment,
        settings,
        retrieval,
        outcomes,
        current: expandedSessions(current),
        next: nextSessions,
        program,
      },
    };
  });
  if ("skip" in first) return { status: "skipped", reason: first.skip, generationId: (first as any).generationId ?? null };
  const p = first.prepared;
  let result: Awaited<ReturnType<typeof proposePlanAdaptation>>;
  try {
    result = await proposePlanAdaptation(
      {
        profile: { experience: p.profile.experience, daysPerWeek: p.profile.daysPerWeek, equipment: p.profile.equipment, goal: p.profile.goal },
        week: options.week,
        currentWeek: p.current.map(({ sessionKey, exercises }) => ({ sessionKey, exercises })),
        nextWeek: p.next.map(({ sessionKey, exercises }) => ({ sessionKey, exercises })),
        outcomes: p.outcomes,
        bounds: p.settings.bounds,
        material: p.retrieval.material,
      },
      modelAccounting(db, a, "brain_plan_adaptation"),
    );
  } catch (error) {
    return recordModelFailure(db, a, p.generationId, error);
  }
  return db.tenant(a, async (tx) => {
    await planLock(tx, a, userId);
    const gen = await lockedGeneration(tx, p.generationId);
    if (!gen || gen.status !== "generating") return { status: gen?.status ?? "missing", generationId: p.generationId };
    const usage = { input: result.usage.input, output: result.usage.output, cost: result.usage.cost };
    const { settings } = await loadPlanSettings(tx);
    const material = await trainerMaterial(tx);
    if (!result.proposal) {
      await updateGeneration(tx, gen.id, "failed", {
        modelPin: result.pin,
        usage,
        validation: { errors: result.errors, warnings: [], metrics: null },
        route: "review",
        routeReasons: ["The model did not return a valid adjustment"],
      });
      await noticeReview(tx, a, gen.id);
      return { status: "failed", generationId: gen.id };
    }
    const applied = applyAdaptation(p.next, result.proposal.changes);
    const validation = validateAdaptedWeek(
      p.current.map(({ key, exercises }) => ({ key, exercises })),
      applied.sessions.map((s) => ({ key: s.sessionKey, exercises: s.exercises })),
      { profile: p.profile, library: material.library, bounds: settings.bounds, evidenceIds: p.retrieval.evidenceIds },
    );
    validation.errors.unshift(...applied.errors);
    const outside = result.proposal.evidenceIds.filter((e) => !p.retrieval.evidenceIds.has(e));
    if (outside.length) validation.errors.push("The adjustment cites material outside the trainer's Brain");
    const outcomeEvidence =
      p.outcomes.loggedSets === 0 ? 0.3 : Math.max(0.3, p.outcomes.adherence ?? 0.3);
    const confidence = planConfidence({
      ruleCoverage: ruleCoverage(p.segment, ruleTexts(material)),
      caseCoverage: caseCoverage(p.segment, learningRows(material), "adaptation"),
      validation,
      selfConfidence: result.proposal.selfConfidence,
      uncertainties: result.proposal.uncertainties,
      threshold: settings.threshold,
      outcomeEvidence,
    });
    const qualification = await planQualificationState(tx, settings);
    const route =
      settings.mode === "automatic" && qualification.qualified && confidence.confident
        ? "automatic"
        : "review";
    const draft: AdaptationWeek = {
      sessions: applied.sessions.map(({ plannedSessionId, sessionKey, exercises }) => ({
        plannedSessionId,
        sessionKey,
        exercises,
      })),
    };
    const base = {
      proposal: result.proposal,
      draft,
      modelPin: result.pin,
      usage,
      validation,
      confidence,
      safety: [],
      route,
      routeReasons: [
        ...(settings.mode === "supervised" ? ["Supervised mode: every adjustment goes to you"] : []),
        ...(!qualification.qualified ? ["Plan qualification has not passed for the current Brain"] : []),
        ...(!confidence.confident ? [`Confidence ${confidence.score.toFixed(2)} is below your threshold`, ...confidence.reasons] : []),
      ],
      qualified: qualification.qualified,
      mode: settings.mode,
    };
    if (route === "automatic") {
      const count = await applyWeek(tx, a, gen, draft, material.library);
      await updateGeneration(tx, gen.id, "delivered", {
        ...base,
        outcome: { applied: count, deliveredAt: new Date().toISOString(), decision: "automatic", spotCheck: null },
      });
      if (count) await noticeDelivered(tx, a, userId, gen.id, true);
      await event(tx, a, "brain.plan_adapted", gen.id, { changes: result.proposal.changes.length, score: confidence.score });
      return { status: "delivered", generationId: gen.id, applied: count, confidence };
    }
    await updateGeneration(tx, gen.id, "pending_review", base);
    await noticeReview(tx, a, gen.id);
    await event(tx, a, "brain.plan_review_required", gen.id, { type: "adaptation", score: confidence.score });
    return { status: "pending_review", generationId: gen.id, confidence };
  });
}
/** Writes an adapted week into its planned sessions; sessions that changed since are left alone. */
async function applyWeek(tx: Tx, a: Actor, gen: any, week: AdaptationWeek, library: PlanLibrary) {
  const baseline = new Map<string, number>(
    (gen.data.baseline?.sessions ?? []).map((s: any) => [s.plannedSessionId, s.version]),
  );
  let changed = 0;
  for (const s of week.sessions) {
    const rows = await tx.query(
      "UPDATE records SET version=version+1,updated_at=now(),data=jsonb_set(data,'{program,exercises}',$3::jsonb)||$4::jsonb WHERE id=$1 AND kind='planned_session' AND status='planned' AND version=$2 RETURNING id",
      [
        s.plannedSessionId,
        baseline.get(s.plannedSessionId) ?? -1,
        JSON.stringify(s.exercises.map((e) => toProgramExercise(e as ExpandedExercise, library))),
        JSON.stringify({ adaptationId: gen.id }),
      ],
    );
    changed += rows.length;
  }
  await event(tx, a, "program.week_adapted", gen.id, { sessions: changed });
  return changed;
}

// ---------------------------------------------------------------------------
// Trainer review and learning

async function recordLearning(
  tx: Tx,
  a: Actor,
  gen: any,
  decision: "approved" | "edited" | "rejected",
  input: { diff?: unknown[]; note?: string; final?: any },
) {
  const profile = gen.data.inputs?.profile;
  const segment = gen.data.inputs?.segment ?? (profile ? planSegment(profile) : null);
  if (!segment) return null;
  const final = input.final ?? gen.data.draft;
  const excerpt =
    gen.data.type === "adaptation"
      ? { sessions: (final?.sessions ?? []).map((s: any) => ({ sessionKey: s.sessionKey, exercises: s.exercises })) }
      : final
        ? { title: final.title, sessions: final.sessions, weeks: (final.weeks ?? []).slice(0, 8) }
        : null;
  const [existing] = await tx.query(
    "SELECT id FROM records WHERE kind='plan_learning' AND data->>'generationId'=$1",
    [gen.id],
  );
  if (existing) return existing;
  const row = await putRecord(
    tx,
    a,
    "plan_learning",
    {
      type: gen.data.type,
      decision,
      generationId: gen.id,
      segment,
      diff: (input.diff ?? []).slice(0, 300),
      note: (input.note ?? "").slice(0, 2000),
      confidenceAtGeneration: gen.data.confidence?.score ?? null,
      planExcerpt: excerpt,
      reviewedBy: a.userId,
      allowedUses: ["model_prompt", "trainer_specific_learning"],
    },
    { status: "confirmed" },
  );
  await event(tx, a, "brain.plan_learning_saved", row.id, { decision, type: gen.data.type });
  return row;
}
const reviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), version: z.number().int().positive(), note: z.string().trim().max(2000).optional() }).strict(),
  z.object({ action: z.literal("edit"), version: z.number().int().positive(), note: z.string().trim().max(2000).optional(), plan: planEditSchema.optional(), week: adaptationWeekSchema.optional() }).strict(),
  z.object({ action: z.literal("reject"), version: z.number().int().positive(), note: z.string().trim().min(5).max(2000) }).strict(),
]);
export async function reviewPlanGeneration(db: Database, a: Actor, generationId: string, body: unknown) {
  const b = reviewSchema.parse(body);
  return db.tenant(a, async (tx) => {
    const [initial] = await tx.query("SELECT owner_user_id FROM records WHERE id=$1 AND kind='plan_generation'", [id.parse(generationId)]);
    if (!initial) throw fail(404, "PLAN_UNAVAILABLE", "This plan is unavailable");
    await planLock(tx, a, initial.owner_user_id);
    const gen = await lockedGeneration(tx, generationId);
    if (gen.version !== b.version) throw fail(409, "PLAN_CHANGED", "This plan changed; refresh before reviewing it");
    const spot = gen.status === "delivered" && gen.data.outcome?.spotCheck === "pending";
    if (!["pending_review", "failed"].includes(gen.status) && !spot)
      throw fail(409, "PLAN_REVIEWED", "This plan has already been decided");
    const userId = gen.owner_user_id;
    const { settings } = await loadPlanSettings(tx);
    const material = await trainerMaterial(tx);
    const profile: PlanProfile = gen.data.inputs.profile;
    if (gen.data.type === "adaptation") return reviewAdaptation(tx, a, gen, b, { settings, material, profile });
    if (b.action === "reject") {
      if (spot) {
        const programId = gen.data.outcome.programId;
        await tx.query(
          "UPDATE records SET status='archived',version=version+1,updated_at=now() WHERE id=$1 AND kind='program' AND status='assigned'",
          [programId],
        );
        await tx.query(
          "UPDATE records SET status='canceled',version=version+1,data=data||$3::jsonb,updated_at=now() WHERE kind='planned_session' AND owner_user_id=$1 AND status='planned' AND data->>'programId'=$2",
          [userId, programId, JSON.stringify({ cancelNote: "Withdrawn by your trainer for revision", canceledBy: a.userId })],
        );
        await notifyUser(tx, a, {
          userId,
          category: "coaching",
          dedupeKey: `brain-plan-withdrawn:${gen.id}`,
          title: "Your trainer is revising your plan",
          body: "Your trainer reviewed your plan and is preparing a revised one. Your completed sessions are kept.",
          href: "/app/program",
          templateKey: "brain-plan-withdrawn",
          source: { type: "plan_generation", id: gen.id },
        });
      }
      await updateGeneration(tx, gen.id, "rejected", {
        outcome: { ...(gen.data.outcome ?? {}), decision: "rejected", reviewedBy: a.userId, reviewedAt: new Date().toISOString(), note: b.note, ...(spot ? { spotCheck: "rejected" } : {}) },
      });
      if (gen.data.draft) await recordLearning(tx, a, gen, "rejected", { note: b.note });
      await event(tx, a, "brain.plan_rejected", gen.id);
      return { status: "rejected", generationId: gen.id };
    }
    const original = gen.data.draft as PlanDraft | undefined;
    if (spot && b.action === "approve") {
      // The spot-checked plan is already with the subscriber; only the
      // trainer's confirmation is recorded and learned from.
      await updateGeneration(tx, gen.id, "delivered", {
        outcome: { ...gen.data.outcome, spotCheck: "approved", reviewedBy: a.userId, reviewedAt: new Date().toISOString() },
      });
      await recordLearning(tx, a, gen, "approved", { note: b.note });
      await event(tx, a, "brain.plan_reviewed", gen.id, { decision: "approved", spotCheck: true, changes: 0 });
      return { status: "delivered", generationId: gen.id, programId: gen.data.outcome.programId, decision: "approved", changes: 0 };
    }
    let draft: PlanDraft;
    if (b.action === "edit") {
      if (!b.plan) throw fail(400, "PLAN_REQUIRED", "Send the edited plan");
      draft = {
        ...b.plan,
        selfConfidence: original?.selfConfidence ?? 0,
        uncertainties: original?.uncertainties ?? [],
        evidenceIds: original?.evidenceIds ?? [],
      };
    } else {
      if (!original) throw fail(409, "PLAN_DRAFT_MISSING", "There is no draft to approve; edit or regenerate the plan");
      draft = original;
    }
    const programmeDays = gen.data.inputs.programmeDays;
    const validation = validatePlan(draft, {
      profile,
      library: material.library,
      bounds: settings.bounds,
      programmeDays,
    });
    if (validation.errors.length)
      throw Object.assign(fail(400, "PLAN_INVALID", "The plan does not pass your bounds: " + validation.errors.slice(0, 3).join("; ")), { errors: validation.errors });
    if (!spot) {
      const ready = await memberReady(tx, userId);
      if ("skip" in ready) throw fail(409, "PLAN_MEMBER_CHANGED", `This plan can no longer be delivered (${String(ready.skip).replaceAll("_", " ")})`);
      if (ready.intake.id !== gen.data.inputs.intakeId)
        throw fail(409, "PLAN_STALE", "The subscriber updated their intake; regenerate the plan");
    }
    const diff = b.action === "edit" ? planDiff(original ?? {}, draft) : [];
    const delivered = await deliverProgramme(tx, a, {
      userId,
      generationId: gen.id,
      draft,
      profile,
      programmeDays,
      startDate: spot ? gen.data.outcome.startDate : gen.data.inputs.startDate,
      timezone: gen.data.inputs.timezone,
      library: material.library,
      brainReleaseId: gen.data.brainReleaseId,
      ...(spot ? { fromDate: localDate(gen.data.inputs.timezone) } : {}),
    });
    const decision = b.action === "edit" ? "edited" : "approved";
    await updateGeneration(tx, gen.id, "delivered", {
      ...(b.action === "edit" ? { edited: draft, diff } : {}),
      outcome: {
        ...(gen.data.outcome ?? {}),
        programId: delivered.program.id,
        sessions: delivered.sessions,
        startDate: delivered.startDate,
        endDate: delivered.endDate,
        deliveredAt: new Date().toISOString(),
        decision: spot ? "automatic" : decision,
        reviewedBy: a.userId,
        reviewedAt: new Date().toISOString(),
        ...(spot ? { spotCheck: decision } : { spotCheck: null }),
      },
    });
    if (original || b.action === "edit")
      await recordLearning(tx, a, gen, decision, { diff, note: b.note, final: draft });
    await noticeDelivered(tx, a, userId, spot ? gen.id + ":revised" : gen.id);
    await event(tx, a, "brain.plan_reviewed", gen.id, { decision, spotCheck: spot, changes: diff.length });
    return { status: "delivered", generationId: gen.id, programId: delivered.program.id, decision, changes: diff.length };
  });
}
async function reviewAdaptation(
  tx: Tx,
  a: Actor,
  gen: any,
  b: z.infer<typeof reviewSchema>,
  ctx: { settings: PlanSettings; material: Material; profile: PlanProfile },
) {
  if (b.action === "reject") {
    await updateGeneration(tx, gen.id, "rejected", {
      outcome: { decision: "rejected", reviewedBy: a.userId, reviewedAt: new Date().toISOString(), note: b.note },
    });
    await recordLearning(tx, a, gen, "rejected", { note: b.note });
    await event(tx, a, "brain.plan_rejected", gen.id, { type: "adaptation" });
    return { status: "rejected", generationId: gen.id };
  }
  let week: AdaptationWeek = gen.data.draft;
  if (b.action === "edit") {
    if (!b.week) throw fail(400, "WEEK_REQUIRED", "Send the edited week");
    const allowed = new Set((gen.data.baseline?.sessions ?? []).map((s: any) => s.plannedSessionId));
    if (b.week.sessions.some((s) => !allowed.has(s.plannedSessionId)))
      throw fail(400, "WEEK_SESSIONS", "Edit only the sessions of the proposed week");
    week = b.week;
  }
  if (!week?.sessions?.length) throw fail(409, "PLAN_DRAFT_MISSING", "There is no adjustment to approve");
  const validation = validateAdaptedWeek(
    (gen.data.currentWeek ?? []).map((s: any) => ({ key: s.sessionKey, exercises: s.exercises })),
    week.sessions.map((s) => ({ key: s.sessionKey, exercises: s.exercises as ExpandedExercise[] })),
    { profile: ctx.profile, library: ctx.material.library, bounds: ctx.settings.bounds },
  );
  if (validation.errors.length)
    throw Object.assign(fail(400, "PLAN_INVALID", "The week does not pass your bounds: " + validation.errors.slice(0, 3).join("; ")), { errors: validation.errors });
  const count = await applyWeek(tx, a, gen, week, ctx.material.library);
  const diff = b.action === "edit" ? planDiff(gen.data.draft ?? {}, week) : [];
  const decision = b.action === "edit" ? "edited" : "approved";
  await updateGeneration(tx, gen.id, "delivered", {
    ...(b.action === "edit" ? { edited: week, diff } : {}),
    outcome: { applied: count, decision, reviewedBy: a.userId, reviewedAt: new Date().toISOString(), deliveredAt: new Date().toISOString(), spotCheck: null },
  });
  await recordLearning(tx, a, gen, decision, { diff, note: b.note, final: week });
  if (count) await noticeDelivered(tx, a, gen.owner_user_id, gen.id, true);
  await event(tx, a, "brain.plan_reviewed", gen.id, { decision, type: "adaptation" });
  return { status: "delivered", generationId: gen.id, applied: count, decision };
}

// ---------------------------------------------------------------------------
// Qualification

export async function qualifyPlanGeneration(db: Database, a: Actor) {
  const snapshot = await db.tenant(a, async (tx) => {
    const { settings } = await loadPlanSettings(tx);
    const material = await trainerMaterial(tx);
    const state = await planQualificationState(tx, settings);
    return { settings, material, state, policy: await activeSafetyPolicy(tx) };
  });
  const { settings, material, state, policy } = snapshot;
  if (!material.release) throw fail(409, "BRAIN_REQUIRED", "Publish your Brain before qualifying plan generation");
  if (!material.library.size) throw fail(409, "LIBRARY_REQUIRED", "Add exercises to your library before qualifying plan generation");
  const scenarios = state.scenarios;
  if (scenarios.length > MAX_SCENARIOS) throw fail(409, "SCENARIO_LIMIT", `Keep at most ${MAX_SCENARIOS} held-out plan scenarios`);
  const review = scenarios.filter((s) => s.data.expected === "review").length;
  if (scenarios.length < MIN_SCENARIOS || review < 2 || scenarios.length - review < 4)
    throw fail(409, "SCENARIO_COVERAGE", `Add at least ${MIN_SCENARIOS} held-out plan scenarios: four the Brain should deliver and two it must send to you`);
  const outcomes: any[] = [];
  const today = localDate("UTC");
  for (const scenario of scenarios) {
    const profile: PlanProfile = scenario.data.profile;
    const flags = [profile.goal, profile.limitations, profile.equipment]
      .map((t) => screenSafety(t, policy))
      .filter((s) => s.hold || s.review)
      .map(() => "A red-flag or personal-review term");
    const safety = planSafetyReasons({ limitations: profile.limitations, redFlags: flags, painReports: 0 });
    if (safety.length) {
      outcomes.push({ scenarioId: scenario.id, passed: scenario.data.expected === "review", gate: "code_safety", reasons: safety });
      continue;
    }
    const segment = planSegment(profile);
    const retrieval = retrievePlanMaterial({
      tenantId: a.tenantId,
      segment,
      goal: profile.goal,
      rules: material.rules,
      cases: material.cases,
      learning: material.learning,
      templates: material.templates,
      library: material.library,
    });
    const days = scenario.data.programmeDays;
    const result = await generateTrainingPlan(
      {
        profile,
        programme: { days, weeks: planWeeksFor(days), startDate: today },
        bounds: settings.bounds,
        twin: null,
        previous: null,
        material: retrieval.material,
      },
      modelAccounting(db, a, "brain_plan_qualification"),
    );
    if (!result.draft) {
      outcomes.push({ scenarioId: scenario.id, passed: scenario.data.expected === "review", gate: "model_output", errors: result.errors.slice(0, 5) });
      continue;
    }
    const validation = validatePlan(result.draft, {
      profile,
      library: material.library,
      bounds: settings.bounds,
      evidenceIds: retrieval.evidenceIds,
      programmeDays: days,
    });
    const deliverable = validation.errors.length === 0;
    outcomes.push({
      scenarioId: scenario.id,
      passed: scenario.data.expected === "deliverable" ? deliverable : !deliverable,
      gate: "validator",
      errors: validation.errors.slice(0, 5),
      warnings: validation.warnings.length,
      retrieval: retrieval.trace,
    });
  }
  return db.tenant(a, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":brain"]);
    const { settings: current } = await loadPlanSettings(tx);
    const now = await planQualificationState(tx, current);
    if (now.contractDigest !== state.contractDigest || now.scenariosDigest !== state.scenariosDigest)
      throw fail(409, "PLAN_CONTRACT_CHANGED", "Your Brain, bounds or scenarios changed during qualification; run it again");
    const passed = outcomes.filter((o) => o.passed).length;
    const row = await putRecord(
      tx,
      a,
      "plan_qualification",
      {
        outcomes,
        total: outcomes.length,
        passed,
        contractDigest: state.contractDigest,
        scenariosDigest: state.scenariosDigest,
        brainReleaseId: material.release!.id,
        pin: planModelPin(),
      },
      { status: passed === outcomes.length ? "passed" : "failed" },
    );
    await event(tx, a, "brain.plan_qualification", row.id, { passed, total: outcomes.length });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Worker

/** A handed-over Brain block is archived once its last date has passed everywhere (UTC yesterday). */
async function archiveEndedBlocks(tx: Tx) {
  await tx.query(
    "UPDATE records p SET status='archived',version=version+1,updated_at=now() WHERE p.kind='program' AND p.status='assigned' AND p.data->>'generated'='true' AND p.data->>'endDate'<to_char(now()-interval '1 day','YYYY-MM-DD') AND EXISTS(SELECT 1 FROM records n WHERE n.kind='program' AND n.status='assigned' AND n.owner_user_id=p.owner_user_id AND n.id<>p.id AND n.created_at>p.created_at)",
  );
}
const scheduled = new Map<string, number>();
const SCHEDULE_INTERVAL_MS = 10 * 60 * 1000;
/**
 * Enqueues first plans after intake, next blocks near a generated
 * programme's end and weekly adaptations near each programme week's end. At
 * most every ten minutes per workspace unless forced (tests, operators).
 */
export async function scheduleBrainPlans(
  db: Database,
  tenantId: string,
  options: { force?: boolean } = {},
) {
  if (!planModelConfigured()) return 0;
  if (!options.force && Date.now() - (scheduled.get(tenantId) ?? 0) < SCHEDULE_INTERVAL_MS) return 0;
  scheduled.set(tenantId, Date.now());
  const a = elevated("worker", { tenantId, role: "owner" });
  return db.tenant(a, async (tx) => {
    // Surface generations whose worker stopped mid-request to the trainer.
    await tx.query(
      "UPDATE records SET status='failed',version=version+1,updated_at=now(),data=data||'{\"error\":\"The generation was interrupted; review or regenerate it.\",\"providerState\":\"unknown\"}'::jsonb WHERE kind='plan_generation' AND status='generating' AND updated_at<now()-interval '30 minutes'",
    );
    await archiveEndedBlocks(tx);
    const [release] = await tx.query("SELECT id FROM records WHERE kind='brain_release' AND status='published' LIMIT 1");
    if (!release) return 0;
    const members = await tx.query(
      "SELECT DISTINCT ON (r.owner_user_id) r.owner_user_id AS user_id,r.id AS intake_id FROM records r JOIN memberships m ON m.user_id=r.owner_user_id AND m.tenant_id=r.tenant_id AND m.role='subscriber' WHERE r.kind='intake' ORDER BY r.owner_user_id,r.created_at DESC,r.id DESC LIMIT 1000",
    );
    let count = 0;
    const enqueue = async (key: string, data: Record<string, unknown>) => {
      const rows = await tx.query(
        "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,'brain_plan',$3,$4) ON CONFLICT(intent_key) DO NOTHING RETURNING id",
        [randomUUID(), tenantId, key, JSON.stringify(data)],
      );
      count += rows.length;
    };
    for (const m of members) {
      const ready = await memberReady(tx, m.user_id);
      if ("skip" in ready || ready.intake.id !== m.intake_id) continue;
      const [open] = await tx.query(
        "SELECT id FROM records WHERE kind='plan_generation' AND owner_user_id=$1 AND status IN ('generating','not_sent','pending_review') LIMIT 1",
        [m.user_id],
      );
      if (open) continue;
      const [program] = await tx.query(
        "SELECT * FROM records WHERE kind='program' AND owner_user_id=$1 AND status='assigned' ORDER BY created_at DESC,id DESC LIMIT 1",
        [m.user_id],
      );
      if (!program) {
        // First plan for this intake; a trainer's rejection or a failed
        // generation of the same intake is left to the trainer.
        const [decided] = await tx.query(
          "SELECT id FROM records WHERE kind='plan_generation' AND owner_user_id=$1 AND data->'inputs'->>'intakeId'=$2 AND data->>'type'='programme' LIMIT 1",
          [m.user_id, m.intake_id],
        );
        if (decided) continue;
        await enqueue(`brain-plan:${tenantId}:${m.user_id}:intake:${m.intake_id}`, {
          userId: m.user_id,
          type: "programme",
          trigger: "intake",
        });
        continue;
      }
      // A trainer's hand-written programme is never replaced automatically.
      if (!program.data?.generated || !program.data.endDate) continue;
      const today = localDate(program.data.timezone ?? "UTC");
      if (daysBetween(today, program.data.endDate) <= NEXT_BLOCK_LEAD_DAYS) {
        await enqueue(`brain-plan:${tenantId}:${m.user_id}:block:${program.id}`, {
          userId: m.user_id,
          type: "programme",
          trigger: "block_end",
          startDate: addTrainingDays(program.data.endDate, 1),
        });
        continue;
      }
      const day = daysBetween(program.data.startDate, today);
      const week = Math.floor(day / 7) + 1;
      if (day >= 0 && day % 7 >= 5 && week + 1 <= planWeeksFor(program.data.programmeDays))
        await enqueue(`brain-adapt:${tenantId}:${program.id}:${week + 1}`, {
          userId: m.user_id,
          type: "adaptation",
          programId: program.id,
          week: week + 1,
        });
    }
    return count;
  });
}
export async function executeBrainPlanJob(db: Database, tenantId: string, job: any) {
  const a = elevated("worker", { tenantId, role: "owner" });
  if (job.data.type === "adaptation")
    return adaptMemberPlan(db, a, job.data.userId, {
      programId: job.data.programId,
      week: job.data.week,
      jobId: job.id,
    });
  return generateMemberPlan(db, a, job.data.userId, {
    trigger: job.data.trigger === "block_end" ? "block_end" : "intake",
    jobId: job.id,
    ...(job.data.startDate ? { startDate: job.data.startDate } : {}),
  });
}

// ---------------------------------------------------------------------------
// Routes

const settingsBody = z
  .object({ settings: planSettingsSchema, version: z.number().int().positive().nullable() })
  .strict();
const generationView = (row: any, names: Map<string, string>) => ({
  id: row.id,
  version: row.version,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  subscriberId: row.owner_user_id,
  subscriberName: names.get(row.owner_user_id) ?? "Subscriber",
  type: row.data.type,
  trigger: row.data.trigger,
  route: row.data.route ?? null,
  routeReasons: row.data.routeReasons ?? [],
  safety: row.data.safety ?? [],
  confidence: row.data.confidence ?? null,
  validation: row.data.validation ?? null,
  draft: row.data.draft ?? null,
  edited: row.data.edited ?? null,
  diff: row.data.diff ?? null,
  proposal: row.data.proposal ?? null,
  currentWeek: row.data.currentWeek ?? null,
  inputs: row.data.inputs
    ? {
        profile: row.data.inputs.profile,
        programmeDays: row.data.inputs.programmeDays,
        startDate: row.data.inputs.startDate,
        timezone: row.data.inputs.timezone,
        week: row.data.inputs.week ?? null,
        outcomes: row.data.inputs.outcomes ?? null,
      }
    : null,
  outcome: row.data.outcome ?? null,
  error: row.data.error ?? null,
  brainReleaseId: row.data.brainReleaseId ?? null,
  promptVersion: row.data.promptVersion ?? null,
  inputsDigest: row.data.inputsDigest ?? null,
});
export function registerBrainPlans(app: FastifyInstance, db: Database) {
  app.get("/api/v1/brain/plans/workspace", async (req) => {
    const a = trainer(req);
    return db.tenant(a, async (tx) => {
      const { row, settings } = await loadPlanSettings(tx);
      const state = await planQualificationState(tx, settings);
      const queue = await tx.query(
        "SELECT * FROM records WHERE kind='plan_generation' AND (status IN ('pending_review','failed') OR (status='delivered' AND data->'outcome'->>'spotCheck'='pending')) ORDER BY created_at,id LIMIT 50",
      );
      const recent = await tx.query(
        "SELECT * FROM records WHERE kind='plan_generation' ORDER BY created_at DESC,id DESC LIMIT 30",
      );
      const members = await tx.query(
        "SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND m.role='subscriber' ORDER BY u.name,u.id LIMIT 200",
        [a.tenantId],
      );
      const names = new Map<string, string>(members.map((m) => [m.id, m.name]));
      const [totals] = await tx.query(
        "SELECT count(*)::int AS generated,count(*) FILTER (WHERE data->'outcome'->>'decision'='automatic')::int AS automatic,count(*) FILTER (WHERE status='pending_review')::int AS pending,count(*) FILTER (WHERE status='delivered' AND data->'outcome'->>'spotCheck'='pending')::int AS spot_checks,round(avg((data->'confidence'->>'score')::numeric),3)::float AS average_confidence FROM records WHERE kind='plan_generation' AND created_at>=now()-interval '90 days'",
      );
      const decisions = await tx.query(
        "SELECT data->>'type' AS type,data->>'decision' AS decision,count(*)::int AS n FROM records WHERE kind='plan_learning' AND status='confirmed' GROUP BY 1,2 ORDER BY 1,2",
      );
      const segments = await tx.query(
        "SELECT data->'segment'->>'goal' AS goal,data->'segment'->>'experience' AS experience,count(*) FILTER (WHERE data->>'decision'='approved')::int AS approved,count(*) FILTER (WHERE data->>'decision'='edited')::int AS edited,count(*) FILTER (WHERE data->>'decision'='rejected')::int AS rejected FROM records WHERE kind='plan_learning' AND status='confirmed' GROUP BY 1,2 ORDER BY count(*) DESC,1,2 LIMIT 12",
      );
      const reviewed = await reviewedCount(tx);
      const library = await tx.query(
        "SELECT id,version,data->>'name' AS name,data->'equipment' AS equipment FROM records WHERE kind='exercise' AND status='active' ORDER BY data->>'name',id LIMIT 300",
      );
      return {
        settings,
        settingsVersion: row?.version ?? null,
        modelConfigured: planModelConfigured(),
        modelPin: planModelPin(),
        qualification: {
          qualified: state.qualified,
          contractDigest: state.contractDigest,
          latest: state.latest
            ? { id: state.latest.id, status: state.latest.status, createdAt: state.latest.created_at, passed: state.latest.data.passed, total: state.latest.data.total, outcomes: state.latest.data.outcomes, current: state.latest.data.contractDigest === state.contractDigest && state.latest.data.scenariosDigest === state.scenariosDigest }
            : null,
          scenarios: a.role === "owner" ? state.scenarios.map((s) => ({ id: s.id, version: s.version, createdAt: s.created_at, ...s.data })) : [],
        },
        queue: queue.map((r) => generationView(r, names)),
        recent: recent.map((r) => {
          const v = generationView(r, names);
          return { id: v.id, status: v.status, type: v.type, trigger: v.trigger, route: v.route, createdAt: v.createdAt, subscriberName: v.subscriberName, score: v.confidence?.score ?? null, decision: v.outcome?.decision ?? null };
        }),
        stats: {
          generated: totals.generated,
          automatic: totals.automatic,
          pending: totals.pending,
          spotChecks: totals.spot_checks,
          averageConfidence: totals.average_confidence,
          reviewed,
          young: reviewed < settings.youngBrainReviews,
          decisions,
          segments,
        },
        library,
        members,
      };
    });
  });
  app.put("/api/v1/brain/plans/settings", async (req) => {
    const a = owner(req),
      b = settingsBody.parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":brain"]);
      const { row } = await loadPlanSettings(tx);
      if ((row?.version ?? null) !== b.version)
        throw fail(409, "SETTINGS_CHANGED", "Your plan settings changed; refresh before saving");
      if (row) {
        const [updated] = await tx.query(
          "UPDATE records SET version=version+1,data=$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *",
          [row.id, JSON.stringify({ settings: b.settings })],
        );
        await event(tx, a, "brain.plan_settings_saved", row.id, b.settings);
        return { settings: updated.data.settings, settingsVersion: updated.version };
      }
      const created = await putRecord(tx, a, "plan_brain_settings", { settings: b.settings }, { status: "active" });
      await event(tx, a, "brain.plan_settings_saved", created.id, b.settings);
      return { settings: created.data.settings, settingsVersion: created.version };
    });
  });
  app.post("/api/v1/brain/plans/generate", async (req) => {
    const a = trainer(req),
      b = z.object({ subscriberId: id }).strict().parse(req.body);
    if (!planModelConfigured())
      throw fail(503, "MODEL_NOT_CONFIGURED", "Configure a coaching model before the Brain prepares plans");
    const result = await generateMemberPlan(db, a, b.subscriberId, { trigger: "manual" });
    if (result.status === "skipped") {
      const messages: Record<string, string> = {
        not_member: "This subscriber is not a member of your workspace",
        safety_hold: "This subscriber's training is paused for a safety review",
        no_access: "This subscriber has no active membership",
        no_intake: "This subscriber has not completed a consented intake",
        no_consent: "This subscriber has not granted coaching consent",
        no_brain: "Publish your Brain before generating plans",
        no_library: "Add exercises to your library before generating plans",
      };
      throw fail(409, "PLAN_NOT_READY", messages[(result as any).reason] ?? "This plan cannot be generated now");
    }
    return result;
  });
  app.post("/api/v1/brain/plans/:id/review", async (req) => {
    const a = trainer(req);
    return reviewPlanGeneration(db, a, (req.params as any).id, req.body);
  });
  app.post("/api/v1/brain/plans/scenarios", async (req) => {
    const a = owner(req),
      b = planScenarioSchema.parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":brain"]);
      const [n] = await tx.query("SELECT count(*)::int AS n FROM records WHERE kind='plan_scenario' AND status='held_out'");
      if (n.n >= MAX_SCENARIOS) throw fail(409, "SCENARIO_LIMIT", `Keep at most ${MAX_SCENARIOS} held-out plan scenarios`);
      const row = await putRecord(tx, a, "plan_scenario", b, { status: "held_out" });
      await event(tx, a, "brain.plan_scenario_saved", row.id);
      return row;
    });
  });
  app.post("/api/v1/brain/plans/scenarios/:id/archive", async (req) => {
    const a = owner(req),
      b = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":brain"]);
      const rows = await tx.query(
        "UPDATE records SET status='archived',version=version+1,updated_at=now() WHERE id=$1 AND kind='plan_scenario' AND status='held_out' AND version=$2 RETURNING id",
        [id.parse((req.params as any).id), b.version],
      );
      if (!rows.length) throw fail(409, "SCENARIO_CHANGED", "This scenario changed; refresh first");
      await event(tx, a, "brain.plan_scenario_archived", rows[0].id);
      return { ok: true };
    });
  });
  app.post("/api/v1/brain/plans/qualify", async (req) => {
    const a = owner(req);
    return qualifyPlanGeneration(db, a);
  });
  app.post("/api/v1/brain/plans/exercises/:id/equipment", async (req) => {
    const a = trainer(req),
      b = z
        .object({
          version: z.number().int().positive(),
          equipment: z.array(z.string().trim().min(2).max(80)).max(8),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const rows = await tx.query(
        "UPDATE records SET version=version+1,data=data||$3::jsonb,updated_at=now() WHERE id=$1 AND kind='exercise' AND status='active' AND version=$2 RETURNING id,version,data->>'name' AS name,data->'equipment' AS equipment",
        [id.parse((req.params as any).id), b.version, JSON.stringify({ equipment: [...new Set(b.equipment)] })],
      );
      if (!rows.length) throw fail(409, "EXERCISE_CHANGED", "This exercise changed; refresh first");
      await event(tx, a, "exercise.equipment_tagged", rows[0].id, { equipment: b.equipment });
      return rows[0];
    });
  });
  app.get("/api/v1/brain/plans/mine", async (req) => {
    if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in");
    const a = req.identity;
    if (a.role !== "subscriber") throw fail(403, "SUBSCRIBER_REQUIRED", "This view is for subscribers");
    return db.tenant(a, async (tx) => {
      const [status] = await tx.query("SELECT * FROM member_plan_status()");
      const [program] = await tx.query(
        "SELECT * FROM records WHERE kind='program' AND owner_user_id=$1 AND status='assigned' AND data->>'generated'='true' ORDER BY created_at DESC,id DESC LIMIT 1",
        [a.userId],
      );
      const upcoming = program
        ? await tx.query(
            "SELECT id,version,status,data->>'date' AS date,data->>'label' AS label,(data->>'week')::int AS week,data->'program'->'exercises' AS exercises FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND status IN ('planned','started') AND data->>'generationId' IS NOT NULL AND data->>'date'>=$2 ORDER BY data->>'date',id LIMIT 14",
            [a.userId, localDate(program.data.timezone ?? "UTC")],
          )
        : [];
      return {
        status: status
          ? { state: status.state, type: status.plan_type, createdAt: status.created_at, updatedAt: status.updated_at, programId: status.program_id }
          : null,
        program: program
          ? {
              id: program.id,
              title: program.data.title,
              summary: program.data.summary ?? "",
              startDate: program.data.startDate,
              endDate: program.data.endDate,
              programmeDays: program.data.programmeDays,
              timezone: program.data.timezone,
              weeks: (program.data.planWeeks ?? []).map((w: any) => ({ week: w.week, focus: w.focus, deload: w.deload })),
            }
          : null,
        upcoming,
      };
    });
  });
}
