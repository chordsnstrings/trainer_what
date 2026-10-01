import type { FastifyInstance, FastifyRequest } from "fastify";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { coachFacingPin } from "../../../packages/providers/src/model-profiles.ts";
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
  planRoute,
  planSafetyReasons,
  planScenarioSchema,
  planSegment,
  planSettingsSchema,
  planWeeksFor,
  ruleCoverage,
  spotCheckSample,
  startingLoadsFor,
  validateAdaptedWeek,
  validatePlan,
  planTextIssues,
  adaptationDirectionIssues,
  heldWeek,
  neutralPlanText,
  oneRepTimedWork,
  progressionHolds,
  workFields,
  type AdaptationWeek,
  type ExpandedExercise,
  type PlanDraft,
  type PlanLibrary,
  type PlanProfile,
  type PlanSettings,
  type PlanValidation,
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
import { loadMemberMemory } from "./member-memory.ts";
import { planProfileDuplicate } from "../../../packages/domain/src/brain-edits.ts";

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
  LEARNING_LIMIT = 500,
  /** Pain and safety reports this recent send plans and adjustments to the trainer. */
  SAFETY_WINDOW_DAYS = 28,
  /** Logged loads this recent are a member's starting-load reference. */
  LOAD_HISTORY_DAYS = 90,
  /** Members the scheduler examines per sweep; a persisted cursor pages through the rest. */
  SCHEDULE_BATCH = 200;
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
async function trainerMaterial(tx: Tx, candidateRelease?: any, learningRows?: any[]) {
  // A candidate Brain release is checked before it is published (brain-check.ts).
  const [release] = candidateRelease
    ? [candidateRelease]
    : await tx.query(
        "SELECT * FROM records WHERE kind='brain_release' AND status='published' ORDER BY created_at DESC,id DESC LIMIT 1",
      );
  const cases = await tx.query(
    "SELECT * FROM records WHERE kind='coaching_teaching' AND status='confirmed' ORDER BY id LIMIT 101",
  );
  const learning = learningRows ?? (await confirmedLearning(tx));
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
/**
 * The plan contract a qualification pins: Brain release, rules,
 * prompt/validator/retrieval versions, model, request form and bounds, and
 * the learning snapshot (reviewed examples) it was checked with. `learning`
 * is the published snapshot's id; "all" marks a plan prepared with every
 * reviewed example (no qualification ever pins it, so such a plan always
 * waits for the coach); null (no snapshot yet) keeps the earlier digest.
 */
function planContract(release: any, settings: PlanSettings, learning: string | null = null) {
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
      // Request style, family, reasoning effort and temperature, unless the
      // request is the default classic one (modelRequestPin).
      ...(pin.request ? { request: pin.request } : {}),
    },
    bounds: settings.bounds,
    ...(learning ? { learning } : {}),
  });
}

// ---------------------------------------------------------------------------
// Learning snapshots (docs/features/brain-learning.md)

/**
 * Reviewed examples are used only while their plan exists and its member
 * still allows model use: withdrawing coaching consent stops them at once
 * (the weekly sweep then marks them revoked, brain-edits.ts).
 */
const LEARNING_ALLOWED = `EXISTS (SELECT 1 FROM records g WHERE g.kind='plan_generation' AND g.id::text=records.data->>'generationId' AND coalesce((SELECT i.data->'allowedUses' ? 'model_prompt' FROM records i WHERE i.kind='intake' AND i.owner_user_id=g.owner_user_id ORDER BY i.created_at DESC,i.id DESC LIMIT 1),false))`;
async function confirmedLearning(tx: Tx) {
  return tx.query(
    `SELECT * FROM records WHERE kind='plan_learning' AND status='confirmed' AND ${LEARNING_ALLOWED} ORDER BY created_at DESC,id DESC LIMIT $1`,
    [LEARNING_LIMIT],
  );
}
/** The checked set of reviewed examples automatically delivered plans use. */
export async function publishedLearningSnapshot(tx: Tx) {
  const [row] = await tx.query(
    "SELECT * FROM records WHERE kind='plan_learning_snapshot' AND status='published' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  return row ?? null;
}
async function learningRowsIn(tx: Tx, snapshot: any) {
  const listed: Array<{ id: string; version: number }> = snapshot?.data?.rows ?? [];
  if (!listed.length) return [];
  const versions = new Map(listed.map((r) => [r.id, r.version]));
  const rows = await tx.query(
    `SELECT * FROM records WHERE kind='plan_learning' AND status='confirmed' AND id=ANY($1::uuid[]) AND ${LEARNING_ALLOWED} ORDER BY created_at DESC,id DESC`,
    [listed.map((r) => r.id)],
  );
  return rows.filter((r) => versions.get(r.id) === r.version);
}
type LearningUse = { mode: "checked" | "legacy" | "all"; key: string | null; snapshotId: string | null; rows: any[] };
/**
 * Which reviewed examples a plan may use. With a passing qualification only
 * the examples it was checked with (its snapshot; before snapshots, the rows
 * that existed when it passed); while every plan waits for the coach, all of
 * them (the coach reviews each draft).
 */
async function learningInUse(
  tx: Tx,
  q: { qualified: boolean; learningSnapshot: any; passing: any },
): Promise<LearningUse> {
  if (!q.qualified) return { mode: "all", key: "all", snapshotId: null, rows: await confirmedLearning(tx) };
  if (q.learningSnapshot)
    return { mode: "checked", key: q.learningSnapshot.id, snapshotId: q.learningSnapshot.id, rows: await learningRowsIn(tx, q.learningSnapshot) };
  const rows = await tx.query(
    `SELECT * FROM records WHERE kind='plan_learning' AND status='confirmed' AND created_at<=$1 AND ${LEARNING_ALLOWED} ORDER BY created_at DESC,id DESC LIMIT $2`,
    [q.passing.created_at, LEARNING_LIMIT],
  );
  return { mode: "legacy", key: null, snapshotId: null, rows };
}
/**
 * Reviewed examples a new snapshot may hold: confirmed rows whose plan still
 * exists (a row whose member was erased never goes live again) and whose
 * member profile does not repeat a held-out plan scenario (the held-out set
 * stays independent of what the Brain learns from).
 */
async function snapshotCandidates(tx: Tx) {
  const rows = await tx.query(
    "SELECT l.*,g.data->'inputs'->'profile' AS source_profile FROM records l JOIN records g ON g.kind='plan_generation' AND g.id::text=l.data->>'generationId' WHERE l.kind='plan_learning' AND l.status='confirmed' AND coalesce((SELECT i.data->'allowedUses' ? 'model_prompt' FROM records i WHERE i.kind='intake' AND i.owner_user_id=g.owner_user_id ORDER BY i.created_at DESC,i.id DESC LIMIT 1),false) ORDER BY l.created_at DESC,l.id DESC LIMIT $1",
    [LEARNING_LIMIT],
  );
  const heldOut = (await heldOutPlanScenarios(tx)).map((s) => s.data.profile);
  const kept = rows.filter((r) => !heldOut.some((p) => planProfileDuplicate(r.source_profile, p)));
  return { rows: kept.map(({ source_profile: _p, ...r }) => r), heldOutDuplicates: rows.length - kept.length };
}
/** Reviewed examples waiting for a check (not in the live snapshot). */
export async function waitingLearning(tx: Tx) {
  const snapshot = await publishedLearningSnapshot(tx);
  const listed = new Set((snapshot?.data?.rows ?? []).map((r: any) => r.id));
  const { rows } = await snapshotCandidates(tx);
  return {
    snapshot,
    waiting: rows.filter((r) => !listed.has(r.id)).length,
    removed: (snapshot?.data?.rows ?? []).length - rows.filter((r) => listed.has(r.id)).length,
  };
}
/**
 * A candidate snapshot of today's reviewed examples for a qualification, or
 * the published one when nothing changed. Runs in the qualification's scope.
 */
async function candidateLearningSnapshot(tx: Tx, a: Actor, trigger: string) {
  const published = await publishedLearningSnapshot(tx);
  const { rows, heldOutDuplicates } = await snapshotCandidates(tx);
  const listed = rows.map((r) => ({ id: r.id as string, version: r.version as number })).sort((x, y) => (x.id < y.id ? -1 : 1));
  const digest = hash(listed);
  if (published && published.data.digest === digest) return published;
  if (!published && !listed.length) return null;
  return putRecord(
    tx,
    a,
    "plan_learning_snapshot",
    { rows: listed, count: listed.length, digest, heldOutDuplicates, replaces: published?.id ?? null, trigger },
    { status: "candidate" },
  );
}
async function heldOutPlanScenarios(tx: Tx) {
  return tx.query(
    "SELECT * FROM records WHERE kind='plan_scenario' AND status='held_out' ORDER BY id LIMIT $1",
    [MAX_SCENARIOS + 1],
  );
}
const scenariosDigest = (rows: any[]) =>
  hash(rows.map((r) => ({ id: r.id, data: r.data })));
export async function planQualificationState(
  tx: Tx,
  settings: PlanSettings,
  candidateRelease?: any,
  candidateLearning?: any,
) {
  const [release] = candidateRelease
    ? [candidateRelease]
    : await tx.query(
        "SELECT * FROM records WHERE kind='brain_release' AND status='published' ORDER BY created_at DESC,id DESC LIMIT 1",
      );
  const learningSnapshot = candidateLearning === undefined ? await publishedLearningSnapshot(tx) : candidateLearning;
  const contractDigest = planContract(release ?? null, settings, learningSnapshot?.id ?? null);
  const scenarios = await heldOutPlanScenarios(tx);
  const digest = scenariosDigest(scenarios);
  const [latest] = await tx.query(
    "SELECT * FROM records WHERE kind='plan_qualification' ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  // A pass counts for the pinned contract and scenarios, and for any
  // threshold at or above the one it was scored against.
  const [passing] = await tx.query(
    "SELECT * FROM records WHERE kind='plan_qualification' AND status='passed' AND data->>'contractDigest'=$1 AND data->>'scenariosDigest'=$2 AND (data->>'threshold')::float<=$3 ORDER BY created_at DESC,id DESC LIMIT 1",
    [contractDigest, digest, settings.threshold],
  );
  const qualified = !!passing && !!release;
  return {
    qualified,
    /** Weekly adjustments are automatic only when adaptation scenarios passed too. */
    adaptationQualified:
      qualified &&
      Number(passing.data.adaptation?.deliverable ?? 0) >= 1 &&
      Number(passing.data.adaptation?.review ?? 0) >= 1,
    contractDigest,
    scenariosDigest: digest,
    scenarios,
    latest: latest ?? null,
    passingId: passing?.id ?? null,
    passing: passing ?? null,
    learningSnapshot,
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
/**
 * The code safety floor for one member, the same for first plans, next
 * blocks and weekly adjustments: a reported limitation, red-flag or
 * personal-review terms in the intake's goal, limitations or equipment, and
 * pain or safety reports in the last 28 days.
 */
async function memberSafety(tx: Tx, userId: string, profile: PlanProfile) {
  const recent = await recentSafety(tx, userId, SAFETY_WINDOW_DAYS);
  return planSafetyReasons({
    limitations: profile.limitations,
    redFlags: [
      ...(await screenTexts(tx, [profile.goal, profile.limitations, profile.equipment])),
      ...recent.reasons,
    ],
    painReports: recent.painReports,
  });
}
/** Library default loads (kg) by normalized exercise name. */
const libraryLoads = (library: PlanLibrary) =>
  new Map(
    [...library]
      .filter(([, e]) => typeof e.loadKg === "number" && e.loadKg > 0)
      .map(([key, e]) => [key, e.loadKg as number]),
  );
/**
 * Starting-load references for the validator: the member's highest logged
 * (corrected) load per exercise in the last 90 days, else the library load.
 */
async function loadReference(tx: Tx, userId: string, library: PlanLibrary) {
  const reference = libraryLoads(library);
  const sets = await tx.query(
    "SELECT id,data FROM workout_events WHERE user_id=$1 AND created_at>=now()-make_interval(days=>$2) ORDER BY created_at DESC LIMIT 2000",
    [userId, LOAD_HISTORY_DAYS],
  );
  const corrections = sets.length
    ? await tx.query(
        "SELECT id,data FROM records WHERE kind='workout_correction' AND owner_user_id=$1 AND data->>'eventId'=ANY($2::text[])",
        [userId, sets.map((x) => x.id)],
      )
    : [];
  const logged = new Map<string, number>();
  for (const set of effectiveWorkoutSets(sets, corrections)) {
    const load = Number(set.data?.loadKg);
    const key = normalizeTerm(String(set.data?.exercise ?? ""));
    if (!key || !Number.isFinite(load) || load <= 0 || load > 500) continue;
    logged.set(key, Math.max(logged.get(key) ?? 0, load));
  }
  for (const [key, load] of logged) reference.set(key, load);
  return reference;
}
const isoDate = (value: unknown) => {
  const t = Date.parse(String(value ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};
/**
 * Whether the member's access runs into a new block starting `nextStart`.
 * Shared contract: an offer with a trainer-set `programmeDays` bought upfront
 * is one programme, so a next block needs access that demonstrably reaches
 * the new start; a monthly membership (fixed-length or rolling) continues in
 * consecutive blocks while it renews, and one set to end stops at its period
 * end. Complimentary access continues until its end date.
 */
export async function nextBlockAllowed(tx: Tx, userId: string, nextStart: string) {
  const access = await memberAccess(tx, userId);
  if (access.grant) {
    const end = isoDate(access.grant.ends_at);
    if (!access.grant.ends_at || (end && end >= nextStart)) return true;
  }
  const s = access.subscription;
  if (!s) return false;
  const [offer] = s.data?.productId
    ? await tx.query("SELECT data FROM records WHERE id::text=$1 AND kind='product'", [
        String(s.data.productId),
      ])
    : [];
  const billing = s.data?.billing ?? offer?.data?.billing ?? "monthly";
  const end = isoDate(s.period_end);
  const reaches = !!end && end >= nextStart;
  if (billing === "upfront" || s.cancel_at_period_end) return reaches;
  return true;
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
/**
 * A programme exercise for the member's record. `cueFrom: "library"` (an
 * automatic delivery) keeps the trainer's library cue and never the model's
 * wording, which is spoken as the trainer's in a voice session; a plan the
 * trainer approved or edited keeps the draft's cue (the trainer saved it).
 */
function toProgramExercise(
  e: ExpandedExercise,
  library: PlanLibrary,
  cueFrom: "library" | "draft" = "draft",
) {
  const entry = library.get(normalizeTerm(e.name));
  const cue = cueFrom === "library" ? (entry?.cue ?? "") : e.cue || entry?.cue || "";
  return {
    name: entry?.name ?? e.name,
    sets: Math.min(10, e.sets),
    // Reps, or a duration or distance per set (with its pace and effort).
    ...workFields(e),
    restSeconds: e.restSeconds,
    loadKg: e.loadKg,
    rir: e.rir,
    cue: cue.slice(0, 1000),
    ...(entry?.demonstrationUrl ? { demonstrationUrl: entry.demonstrationUrl } : {}),
    alternatives: e.alternatives.slice(0, 10).map((n) => {
      const alt = library.get(normalizeTerm(n));
      return { name: alt?.name ?? n, cue: (alt?.cue ?? "").slice(0, 1000), loadKg: e.loadKg };
    }),
  };
}
/** Every member-visible wording in a draft, trimmed. */
const planTexts = (d: Pick<PlanDraft, "title" | "summary" | "weeks" | "sessions">) =>
  [
    d.title,
    d.summary,
    ...d.weeks.map((w) => w.focus),
    ...d.sessions.flatMap((s) => [s.label, ...s.exercises.map((e) => e.cue ?? "")]),
  ].map((t) => String(t ?? "").trim());
const fromProgramExercise = (e: any): ExpandedExercise => ({
  name: e.name,
  sets: e.sets,
  ...workFields(e),
  loadKg: e.loadKg ?? 0,
  rir: e.rir ?? 2,
  restSeconds: e.restSeconds ?? 90,
  // Library cues fit the plan schema (1000); older rows are cut to fit.
  cue: String(e.cue ?? "").slice(0, 1000),
  alternatives: (e.alternatives ?? [])
    .map((a: any) => (typeof a === "string" ? a : a.name))
    .slice(0, 4),
});

/**
 * Writes a plan exactly like scheduleProgram: one assigned `program` and one
 * `planned_session` per training date in the member's timezone, so the
 * calendar, reminders, workouts and the Client Twin use it unchanged. Other
 * assigned programmes are archived and their sessions from the start date on
 * are canceled; a started session keeps its date. An automatic delivery
 * (`replace: "generated"`) only ever replaces the Brain's own programmes; a
 * trainer's hand-written one is replaced only by the trainer's decision.
 *
 * The programme record is visible to the member: it carries the projected
 * plan (title, summary, weeks, sessions), never the model's draft,
 * confidence, uncertainties or evidence (those stay on the staff-only
 * generation record).
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
    fromDate?: string;
    replace?: "generated" | "all";
    /** Delivered without the trainer: the text screen must pass and library cues are used. */
    automatic?: boolean;
  },
) {
  // Second layer behind validatePlan: nothing the model wrote reaches the
  // member on the automatic route unless it passes the member-text screen.
  if (input.automatic) {
    const issues = planTextIssues(input.draft, input.library);
    if (issues.length)
      throw fail(409, "PLAN_TEXT_WITHHELD", "The plan's wording failed the member-text screen and was not delivered: " + issues[0].message);
  }
  const cueFrom = input.automatic ? "library" : "draft";
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
    "UPDATE records SET status='archived',version=version+1,updated_at=now() WHERE kind='program' AND owner_user_id=$1 AND status='assigned' AND NOT (data->>'generated'='true' AND coalesce(data->>'endDate','9999-12-31')<$2) AND ($3::boolean=false OR data->>'generated'='true') RETURNING id",
    [input.userId, startDate, input.replace === "generated"],
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
      (e) => toProgramExercise(e as ExpandedExercise, input.library, cueFrom),
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
      programmeDays: input.programmeDays,
      startDate,
      endDate,
      timezone: input.timezone,
      planWeeks: input.draft.weeks.map((w) => ({
        week: w.week,
        focus: w.focus,
        volumeFactor: w.volumeFactor,
        loadFactor: w.loadFactor,
        rirDelta: w.rirDelta,
        deload: w.deload,
      })),
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
          exercises: slot.exercises.map((e) => toProgramExercise(e, input.library, cueFrom)),
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
  /**
   * The programme the scheduler saw when it queued the job (null: none).
   * A queued job never replaces a programme assigned after it was queued, and
   * never a trainer's hand-written programme.
   */
  expectedProgramId?: string | null;
};
type Prepared = {
  generationId: string;
  userId: string;
  trigger: GenerationOptions["trigger"];
  profile: PlanProfile;
  programmeDays: number;
  startDate: string;
  timezone: string;
  intakeId: string;
  previousProgramId: string | null;
  twin: unknown;
  previousWeek: Array<{ key: string; exercises: ExpandedExercise[] }>;
  loadReference: Map<string, number>;
  /** The same references by library exercise name, for the model prompt. */
  startingLoads: Record<string, number>;
  retrieval: ReturnType<typeof retrievePlanMaterial>;
  settings: PlanSettings;
  /** The reviewed examples this plan used (see learningInUse). */
  learningRows: any[];
  memberMemory: Awaited<ReturnType<typeof loadMemberMemory>>;
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
const latestAssigned = async (tx: Tx, userId: string) =>
  (
    await tx.query(
      "SELECT * FROM records WHERE kind='program' AND owner_user_id=$1 AND status='assigned' ORDER BY created_at DESC,id DESC LIMIT 1",
      [userId],
    )
  )[0] as any;
/**
 * A queued (non-manual) generation may only replace the Brain's own
 * programme it was queued for: a hand-written programme, or one assigned
 * after the job was queued, stops it.
 */
function programmeChanged(
  current: any,
  expected: string | null | undefined,
) {
  if (current && !current.data?.generated) return "The subscriber follows a programme the trainer wrote";
  if (expected !== undefined && (current?.id ?? null) !== expected)
    return "The subscriber's programme changed after this plan was queued";
  return null;
}
/** Holds a manual generation back for the trainer when it would replace their own or a changed programme. */
function manualHolds(current: any, expected: string | null) {
  if (current && !current.data?.generated)
    return ["The subscriber follows a programme you wrote; approving this plan replaces it"];
  if ((current?.id ?? null) !== expected)
    return ["The subscriber's programme changed while the Brain prepared this plan; approving replaces it"];
  return [];
}
async function prepareGeneration(
  tx: Tx,
  a: Actor,
  userId: string,
  options: GenerationOptions,
): Promise<{ skip: string; generation?: any } | { prepared: Prepared }> {
  await planLock(tx, a, userId);
  let reuse: string | null = null;
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
    reuse = existing?.id ?? null;
  }
  // A retried job that no longer applies closes its unsent generation.
  const skip = async (reason: string) => {
    if (reuse)
      await updateGeneration(tx, reuse, "superseded", {
        error: `Not prepared: ${reason.replaceAll("_", " ")}`,
      });
    return { skip: reason };
  };
  const ready = await memberReady(tx, userId);
  if ("skip" in ready) return skip(ready.skip!);
  const intake = ready.intake;
  const previous = await latestAssigned(tx, userId);
  if (options.trigger !== "manual" && programmeChanged(previous, options.expectedProgramId))
    return skip("programme_changed");
  const { settings } = await loadPlanSettings(tx);
  const learning = await learningInUse(tx, await planQualificationState(tx, settings));
  const material = await trainerMaterial(tx, undefined, learning.rows);
  if (!material.release) return skip("no_brain");
  if (!material.library.size) return skip("no_library");
  const programmeDays = await programmeLengthDays(tx, userId);
  const timezone = await memberPlanTimezone(tx, userId);
  const today = localDate(timezone);
  let startDate = options.startDate ?? today;
  if (startDate < today) startDate = today;
  // A fixed programme bought upfront ends; only access that reaches the new
  // start continues into a next block.
  if (options.trigger === "block_end" && !(await nextBlockAllowed(tx, userId, startDate)))
    return skip("programme_complete");
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
  const reference = await loadReference(tx, userId, material.library);
  const profile = profileOf(intake);
  const segment = planSegment(profile);
  const twin = twinProjection(await currentClientTwin(tx, a, userId));
  const memberMemory = await loadMemberMemory(tx, userId, { today });
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
  const contractDigest = planContract(material.release, settings, learning.key);
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
    previousGenerated: !!previous?.data?.generated,
    loadReference: Object.fromEntries([...reference].slice(0, 300)),
    bounds: settings.bounds,
    ...(memberMemory ? { memberMemory } : {}),
  };
  const data = {
    type: "programme",
    subscriberId: userId,
    trigger: options.trigger,
    ...(options.jobId ? { jobId: options.jobId } : {}),
    brainReleaseId: material.release.id,
    contractDigest,
    learning: { mode: learning.mode, snapshotId: learning.snapshotId, count: learning.rows.length },
    promptVersion: planModelPin().promptVersion,
    inputs,
    inputsDigest: hash({ inputs, material: retrieval.trace.materialDigest }),
    retrieval: retrieval.trace,
    requestedBy: a.userId,
  };
  let generationId: string;
  if (reuse) {
    generationId = reuse;
    await updateGeneration(tx, generationId, "generating", { ...data, error: null, providerState: null });
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
      trigger: options.trigger,
      profile,
      programmeDays,
      startDate,
      timezone,
      intakeId: intake.id,
      previousProgramId: previous?.id ?? null,
      twin,
      previousWeek,
      loadReference: reference,
      startingLoads: startingLoadsFor(reference, material.library),
      retrieval,
      settings,
      learningRows: learning.rows,
      memberMemory,
    },
  };
}
const NOT_SENT_CODES = new Set([
  "MODEL_DAILY_LIMIT",
  "MODEL_USER_LIMIT",
  "MODEL_NOT_CONFIGURED",
  "PLAN_CONTEXT_TOO_LARGE",
  // The request could not be given unambiguous short references: nothing was sent.
  "PROMPT_REFS_UNSAFE",
]);
/**
 * Records a model failure. A worker job refused before dispatch stays
 * `not_sent` for the job's own retry (the scheduler closes it once no retry
 * is pending); a trainer's request, or anything that reached the provider,
 * goes to the trainer's queue as `failed` with a Regenerate action.
 */
async function recordModelFailure(
  db: Database,
  a: Actor,
  generationId: string,
  error: any,
  jobId?: string,
) {
  const refused = NOT_SENT_CODES.has(error?.code);
  const retryable = refused && !!jobId;
  await db.tenant(a, (tx) =>
    updateGeneration(tx, generationId, retryable ? "not_sent" : "failed", {
      error: String(error?.message ?? "Model request failed").slice(0, 500),
      providerState: refused ? "not_sent" : "unknown",
      ...(refused ? { errorCode: String(error.code) } : {}),
    }),
  );
  if (refused) throw Object.assign(error, { generationId });
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
        startingLoads: p.startingLoads,
        ...(p.memberMemory ? { memberMemory: p.memberMemory } : {}),
      },
      modelAccounting(db, a, "brain_plan", { memberId: userId }),
    );
  } catch (error) {
    return recordModelFailure(db, a, p.generationId, error, options.jobId);
  }
  return db.tenant(a, async (tx) => {
    await planLock(tx, a, userId);
    const gen = await lockedGeneration(tx, p.generationId);
    if (!gen || gen.status !== "generating") return { status: gen?.status ?? "missing", generationId: p.generationId };
    const usage = { input: result.usage.input, output: result.usage.output, cost: result.usage.cost };
    const supersede = async (error: string) => {
      await updateGeneration(tx, gen.id, "superseded", { modelPin: result.pin, usage, error });
      return { status: "superseded", generationId: gen.id };
    };
    const ready = await memberReady(tx, userId);
    if ("skip" in ready) return supersede(`Not delivered: ${ready.skip}`);
    if (ready.intake.id !== p.intakeId)
      return supersede("The subscriber updated their intake during generation");
    // Recheck the programme: a trainer may have assigned one during the call.
    const current = await latestAssigned(tx, userId);
    if (p.trigger !== "manual") {
      const changed = programmeChanged(current, p.previousProgramId);
      if (changed) return supersede(changed);
    }
    const { settings } = await loadPlanSettings(tx);
    const material = await trainerMaterial(tx, undefined, p.learningRows);
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
    const neutral = neutralPlanText(result.draft);
    return routeProgramme(tx, a, gen, neutral.draft, {
      prepared: p,
      settings,
      material,
      modelPin: result.pin,
      usage,
      holds: [
        ...(p.trigger === "manual" ? manualHolds(current, p.previousProgramId) : []),
        ...neutralTextHolds(neutral.replaced),
        ...oneRepTimedHolds(neutral.draft),
      ],
      replacedText: neutral.replaced,
    });
  });
}
/**
 * A plan whose health wording was replaced goes to the trainer: the plan may
 * be fine, but the model thought about a condition the intake may not show.
 */
const neutralTextHolds = (replaced: Array<{ field: string }>) => {
  const where = [
    ...new Set(
      replaced.map((r) =>
        r.field.endsWith(".label") ? "session labels" : r.field.endsWith(".focus") ? "week focus" : r.field,
      ),
    ),
  ];
  return where.length
    ? [`The Brain's ${where.join(", ")} mentioned health details, so neutral wording replaced it; check the plan suits the subscriber`]
    : [];
};
/**
 * A model plan that writes a walk, run, interval, hold or carry as one rep
 * (the way the trainer's templates store it) goes to the trainer: the member
 * would see "1 x 1" and the session length would be under-counted.
 */
const oneRepTimedHolds = (draft: PlanDraft) => {
  const found = oneRepTimedWork(draft.sessions);
  return found.length
    ? [`The Brain wrote ${found.slice(0, 5).join(", ")} as 1 rep; timed or distance work needs a time or distance, so check ${found.length === 1 ? "it" : "them"} before the plan goes out`]
    : [];
};
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
    holds: string[];
    /** The model's withheld wording (staff-only), when neutral wording replaced it. */
    replacedText?: Array<{ field: string; text: string }>;
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
    loadReference: p.loadReference,
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
  const safety = await memberSafety(tx, p.userId, p.profile);
  const qualification = await planQualificationState(tx, settings);
  // Automatic only when this plan was prepared under exactly the qualified
  // contract (Brain, settings and the checked learning snapshot).
  const sameContract = gen.data.contractDigest === qualification.contractDigest;
  const decision = planRoute({
    type: "programme",
    mode: settings.mode,
    qualified: qualification.qualified && sameContract,
    qualificationReason: qualification.qualified
      ? "This plan was prepared with Brain material (new learning, rules or settings) that has not passed its check yet, so it goes to you"
      : "Plan qualification has not passed for the current Brain, bounds and threshold, so plans go to you (supervised)",
    safety,
    holds: ctx.holds,
    confidence,
    validation,
    equipment: p.profile.equipment,
  });
  const route = decision.route;
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
    routeReasons: decision.reasons,
    routeVersion: decision.version,
    qualified: qualification.qualified,
    qualificationId: qualification.passingId,
    mode: settings.mode,
    ...(ctx.replacedText?.length ? { replacedText: ctx.replacedText } : {}),
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
      replace: "generated",
      automatic: true,
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
  return { status: "pending_review", generationId: gen.id, confidence, routeReasons: decision.reasons };
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
        prescribed: { sets: 0, ...workFields(e), loadKg: e.loadKg, rir: e.rir },
        logged: { sets: 0, reps: 0, maxLoadKg: 0, rirTotal: 0, rirCount: 0, seconds: 0, secondsCount: 0, meters: 0, metersCount: 0 },
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
    // Timed and distance rounds log what was done.
    if (typeof set.data.durationSeconds === "number") {
      row.logged.seconds += set.data.durationSeconds;
      row.logged.secondsCount++;
    }
    if (typeof set.data.distanceMeters === "number") {
      row.logged.meters += set.data.distanceMeters;
      row.logged.metersCount++;
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
        ...(r.logged.secondsCount ? { averageDurationSeconds: Math.round(r.logged.seconds / r.logged.secondsCount) } : {}),
        ...(r.logged.metersCount ? { averageDistanceMeters: Math.round(r.logged.meters / r.logged.metersCount) } : {}),
      },
    })),
  };
}
/** Proposes next week's adjustments from this week's outcomes, through the same validator, safety floor and gate. */
export async function adaptMemberPlan(
  db: Database,
  a: Actor,
  userId: string,
  options: { programId: string; week: number; jobId?: string },
) {
  const first = await db.tenant(a, async (tx) => {
    await planLock(tx, a, userId);
    let reuse: string | null = null;
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
      // A retry after a refused request reuses its unsent generation.
      reuse = existing?.id ?? null;
    }
    const skip = async (reason: string) => {
      if (reuse)
        await updateGeneration(tx, reuse, "superseded", {
          error: `Not prepared: ${reason.replaceAll("_", " ")}`,
        });
      return { skip: reason };
    };
    const ready = await memberReady(tx, userId);
    if ("skip" in ready) return skip(ready.skip!);
    const program = await latestAssigned(tx, userId);
    if (!program?.data?.generated || program.id !== options.programId) return skip("programme_changed");
    const { settings } = await loadPlanSettings(tx);
    const learning = await learningInUse(tx, await planQualificationState(tx, settings));
    const material = await trainerMaterial(tx, undefined, learning.rows);
    if (!material.release) return skip("no_brain");
    const rows = await tx.query(
      "SELECT * FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND data->>'programId'=$2 AND (data->>'week')::int IN ($3,$4) ORDER BY data->>'date',id",
      [userId, program.id, options.week - 1, options.week],
    );
    const current = rows.filter((r) => Number(r.data.week) === options.week - 1);
    const next = rows.filter((r) => Number(r.data.week) === options.week && r.status === "planned");
    if (!next.length) return skip("no_next_week");
    const timezone = program.data.timezone ?? (await memberPlanTimezone(tx, userId));
    const outcomes = await weekOutcomes(tx, userId, current, localDate(timezone));
    const memberMemory = await loadMemberMemory(tx, userId, { today: localDate(timezone) });
    const profile = profileOf(ready.intake);
    const segment = planSegment(profile);
    const safety = await memberSafety(tx, userId, profile);
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
    const reference = await loadReference(tx, userId, material.library);
    const nextSessions = expandedSessions(next),
      currentSessions = expandedSessions(current);
    // After missed sessions, nothing logged or a harder-than-planned week,
    // next week is held at no more than this week's values before the model
    // sees it: the plan's own progression does not go out either.
    const progressionHold = progressionHolds(outcomes);
    const held = progressionHold.length
      ? heldWeek(nextSessions, currentSessions)
      : { sessions: nextSessions, changes: [] };
    const data = {
      type: "adaptation",
      subscriberId: userId,
      trigger: "weekly",
      ...(options.jobId ? { jobId: options.jobId } : {}),
      brainReleaseId: material.release.id,
      contractDigest: planContract(material.release, settings, learning.key),
      learning: { mode: learning.mode, snapshotId: learning.snapshotId, count: learning.rows.length },
      promptVersion: planModelPin().adaptationPromptVersion,
      inputs: { intakeId: ready.intake.id, profile, segment, programId: program.id, week: options.week, timezone, outcomes },
      inputsDigest: hash({ program: program.id, week: options.week, outcomes, next: next.map((n) => [n.id, n.version]) }),
      retrieval: retrieval.trace,
      currentWeek: currentSessions.map(({ sessionKey, exercises }) => ({ sessionKey, exercises })),
      progressionHold,
      ...(held.changes.length ? { held: held.changes } : {}),
      baseline: { sessions: nextSessions.map((s) => ({ plannedSessionId: s.plannedSessionId, version: next.find((n) => n.id === s.plannedSessionId)!.version, sessionKey: s.sessionKey, exercises: s.exercises })) },
      requestedBy: a.userId,
      error: null,
      providerState: null,
    };
    const write = async (status: string, extra: Record<string, unknown>) => {
      if (reuse) {
        await updateGeneration(tx, reuse, status, { ...data, ...extra });
        return reuse;
      }
      return (await putRecord(tx, a, "plan_generation", { ...data, ...extra }, { ownerId: userId, status })).id as string;
    };
    if (safety.length) {
      // A limitation, red flag or recent pain report skips the model: the
      // trainer decides next week personally, starting from the held week
      // when progression is held (approving as-is adds nothing harder).
      const generationId = await write("pending_review", {
        draft: { sessions: held.sessions.map(({ plannedSessionId, sessionKey, exercises }) => ({ plannedSessionId, sessionKey, exercises })) },
        safety,
        route: "review",
        routeReasons: safety.map((s) => "Safety: " + s),
        validation: { errors: [], warnings: [], metrics: null },
      });
      await noticeReview(tx, a, generationId);
      await event(tx, a, "brain.plan_review_required", generationId, { safety: true, type: "adaptation" });
      return { skip: "safety_review", generationId };
    }
    const generationId = await write("generating", {});
    await event(tx, a, "brain.plan_generation_started", generationId, { trigger: "weekly" });
    return {
      prepared: {
        generationId,
        intakeId: ready.intake.id as string,
        profile,
        segment,
        settings,
        retrieval,
        outcomes,
        progressionHold,
        loadReference: reference,
        current: currentSessions,
        next: held.sessions,
        program,
        learningRows: learning.rows,
        memberMemory,
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
        progressionHold: p.progressionHold,
        bounds: p.settings.bounds,
        material: p.retrieval.material,
        ...(p.memberMemory ? { memberMemory: p.memberMemory } : {}),
      },
      modelAccounting(db, a, "brain_plan_adaptation", { memberId: userId }),
    );
  } catch (error) {
    return recordModelFailure(db, a, p.generationId, error, options.jobId);
  }
  return db.tenant(a, async (tx) => {
    await planLock(tx, a, userId);
    const gen = await lockedGeneration(tx, p.generationId);
    if (!gen || gen.status !== "generating") return { status: gen?.status ?? "missing", generationId: p.generationId };
    const usage = { input: result.usage.input, output: result.usage.output, cost: result.usage.cost };
    const supersede = async (error: string) => {
      await updateGeneration(tx, gen.id, "superseded", { modelPin: result.pin, usage, error });
      return { status: "superseded", generationId: gen.id };
    };
    // Everything that could have changed during the model call is checked
    // again: a hold, lost access, a new intake or a replaced programme.
    const ready = await memberReady(tx, userId);
    if ("skip" in ready) return supersede(`Not delivered: ${ready.skip}`);
    if (ready.intake.id !== p.intakeId) return supersede("The subscriber updated their intake during the adjustment");
    const program = await latestAssigned(tx, userId);
    if (!program || program.id !== p.program.id) return supersede("The subscriber's programme changed during the adjustment");
    const { settings } = await loadPlanSettings(tx);
    const material = await trainerMaterial(tx, undefined, p.learningRows);
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
      { profile: p.profile, library: material.library, bounds: settings.bounds, evidenceIds: p.retrieval.evidenceIds, loadReference: p.loadReference },
    );
    validation.errors.unshift(...applied.errors);
    // Nothing harder than the held week after missed sessions, nothing logged
    // or a harder-than-planned week (p.next is already held at this week's values).
    validation.errors.push(...adaptationDirectionIssues(p.next, applied.sessions, p.progressionHold));
    const outside = result.proposal.evidenceIds.filter((e) => !p.retrieval.evidenceIds.has(e));
    if (outside.length) validation.errors.push("The adjustment cites material outside the trainer's Brain");
    const confidence = planConfidence({
      ruleCoverage: ruleCoverage(p.segment, ruleTexts(material)),
      caseCoverage: caseCoverage(p.segment, learningRows(material), "adaptation"),
      validation,
      selfConfidence: result.proposal.selfConfidence,
      uncertainties: result.proposal.uncertainties,
      threshold: settings.threshold,
      outcomeEvidence: outcomeEvidence(p.outcomes),
    });
    const safety = await memberSafety(tx, userId, profileOf(ready.intake));
    const qualification = await planQualificationState(tx, settings);
    const sameContract = gen.data.contractDigest === qualification.contractDigest;
    const decision = planRoute({
      type: "adaptation",
      mode: settings.mode,
      qualified: qualification.adaptationQualified && sameContract,
      qualificationReason: qualification.qualified && !sameContract
        ? "This adjustment was prepared with Brain material (new learning, rules or settings) that has not passed its check yet, so it goes to you"
        : qualification.qualified
        ? "Adjustment qualification has not passed: add held-out adaptation scenarios (one the Brain should apply, one for you) and run qualification"
        : "Plan qualification has not passed for the current Brain, bounds and threshold, so adjustments go to you",
      safety,
      confidence,
      validation,
      equipment: p.profile.equipment,
    });
    const draft: AdaptationWeek = {
      sessions: applied.sessions.map(({ plannedSessionId, sessionKey, exercises }) => ({
        plannedSessionId,
        sessionKey,
        exercises,
      })),
    };
    const young = (await reviewedCount(tx)) < settings.youngBrainReviews;
    const spotCheck = decision.route === "automatic" && young && spotCheckSample(gen.id, settings.spotCheckRate);
    const base = {
      proposal: result.proposal,
      draft,
      modelPin: result.pin,
      usage,
      validation,
      confidence,
      safety,
      route: decision.route,
      routeReasons: decision.reasons,
      routeVersion: decision.version,
      qualified: qualification.adaptationQualified,
      qualificationId: qualification.passingId,
      mode: settings.mode,
    };
    if (decision.route === "automatic") {
      const written = await applyWeek(tx, a, gen, draft, material.library, baselineVersions(gen));
      await updateGeneration(tx, gen.id, "delivered", {
        ...base,
        outcome: {
          applied: written.count,
          appliedVersions: written.versions,
          deliveredAt: new Date().toISOString(),
          decision: "automatic",
          spotCheck: spotCheck ? "pending" : null,
        },
      });
      if (written.count) await noticeDelivered(tx, a, userId, gen.id, true);
      if (spotCheck) await noticeReview(tx, a, gen.id);
      await event(tx, a, "brain.plan_adapted", gen.id, { changes: result.proposal.changes.length, score: confidence.score, spotCheck });
      return { status: "delivered", generationId: gen.id, applied: written.count, confidence, spotCheck };
    }
    await updateGeneration(tx, gen.id, "pending_review", base);
    await noticeReview(tx, a, gen.id);
    await event(tx, a, "brain.plan_review_required", gen.id, { type: "adaptation", score: confidence.score, safety: safety.length > 0 });
    return { status: "pending_review", generationId: gen.id, confidence, routeReasons: decision.reasons };
  });
}
/** Evidence from logged training for an adjustment (0.3 when nothing was logged). */
const outcomeEvidence = (o: { loggedSets: number; adherence: number | null }) =>
  o.loggedSets === 0 ? 0.3 : Math.max(0.3, o.adherence ?? 0.3);
const baselineVersions = (gen: any) =>
  new Map<string, number>(
    (gen.data.baseline?.sessions ?? []).map((s: any) => [s.plannedSessionId, s.version]),
  );
/**
 * Writes a week into its planned sessions when each is still at the version
 * it was prepared from; sessions that changed since (started, completed,
 * canceled or edited) are left alone. Returns the new versions.
 */
async function applyWeek(
  tx: Tx,
  a: Actor,
  gen: any,
  week: AdaptationWeek,
  library: PlanLibrary,
  versions: Map<string, number>,
) {
  let count = 0;
  const written: Record<string, number> = {};
  for (const s of week.sessions) {
    const rows = await tx.query(
      "UPDATE records SET version=version+1,updated_at=now(),data=jsonb_set(data,'{program,exercises}',$3::jsonb)||$4::jsonb WHERE id=$1 AND kind='planned_session' AND status='planned' AND version=$2 RETURNING id,version",
      [
        s.plannedSessionId,
        versions.get(s.plannedSessionId) ?? -1,
        JSON.stringify(s.exercises.map((e) => toProgramExercise(e as ExpandedExercise, library))),
        JSON.stringify({ adaptationId: gen.id }),
      ],
    );
    for (const r of rows) written[r.id] = r.version;
    count += rows.length;
  }
  await event(tx, a, "program.week_adapted", gen.id, { sessions: count });
  return { count, versions: written };
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
    if (gen.data.type === "adaptation") return reviewAdaptation(tx, a, gen, b, { settings, material, profile, spot });
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
    // Wording the trainer typed is theirs; wording kept from the model's
    // draft is screened like an automatic plan's.
    const modelText = new Set(original ? planTexts(original) : []);
    const validation = validatePlan(draft, {
      profile,
      library: material.library,
      bounds: settings.bounds,
      programmeDays,
      trainerText: new Set(b.action === "edit" ? planTexts(draft).filter((t) => !modelText.has(t)) : []),
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
  ctx: { settings: PlanSettings; material: Material; profile: PlanProfile; spot: boolean },
) {
  // A spot-checked adjustment is already in the member's sessions: the
  // trainer's decision is written over the versions it produced.
  const versions = ctx.spot
    ? new Map<string, number>(Object.entries(gen.data.outcome?.appliedVersions ?? {}).map(([k, v]) => [k, Number(v)]))
    : baselineVersions(gen);
  const now = new Date().toISOString();
  if (b.action === "reject") {
    let reverted = 0;
    if (ctx.spot) {
      const baseline: AdaptationWeek = {
        sessions: (gen.data.baseline?.sessions ?? []).map((s: any) => ({
          plannedSessionId: s.plannedSessionId,
          sessionKey: s.sessionKey,
          exercises: s.exercises,
        })),
      };
      reverted = (await applyWeek(tx, a, gen, baseline, ctx.material.library, versions)).count;
      if (reverted) await noticeDelivered(tx, a, gen.owner_user_id, gen.id + ":revised", true);
    }
    await updateGeneration(tx, gen.id, "rejected", {
      outcome: {
        ...(gen.data.outcome ?? {}),
        decision: "rejected",
        reviewedBy: a.userId,
        reviewedAt: now,
        note: b.note,
        ...(ctx.spot ? { spotCheck: "rejected", reverted } : {}),
      },
    });
    await recordLearning(tx, a, gen, "rejected", { note: b.note });
    await event(tx, a, "brain.plan_rejected", gen.id, { type: "adaptation", spotCheck: ctx.spot });
    return { status: "rejected", generationId: gen.id, ...(ctx.spot ? { reverted } : {}) };
  }
  if (ctx.spot && b.action === "approve") {
    await updateGeneration(tx, gen.id, "delivered", {
      outcome: { ...gen.data.outcome, spotCheck: "approved", reviewedBy: a.userId, reviewedAt: now },
    });
    await recordLearning(tx, a, gen, "approved", { note: b.note });
    await event(tx, a, "brain.plan_reviewed", gen.id, { decision: "approved", type: "adaptation", spotCheck: true });
    return { status: "delivered", generationId: gen.id, applied: 0, decision: "approved" };
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
  const written = await applyWeek(tx, a, gen, week, ctx.material.library, versions);
  const diff = b.action === "edit" ? planDiff(gen.data.draft ?? {}, week) : [];
  const decision = b.action === "edit" ? "edited" : "approved";
  await updateGeneration(tx, gen.id, "delivered", {
    ...(b.action === "edit" ? { edited: week, diff } : {}),
    outcome: ctx.spot
      ? { ...gen.data.outcome, applied: written.count, appliedVersions: { ...(gen.data.outcome?.appliedVersions ?? {}), ...written.versions }, spotCheck: decision, reviewedBy: a.userId, reviewedAt: now }
      : { applied: written.count, appliedVersions: written.versions, decision, reviewedBy: a.userId, reviewedAt: now, deliveredAt: now, spotCheck: null },
  });
  await recordLearning(tx, a, gen, decision, { diff, note: b.note, final: week });
  if (written.count) await noticeDelivered(tx, a, gen.owner_user_id, ctx.spot ? gen.id + ":revised" : gen.id, true);
  await event(tx, a, "brain.plan_reviewed", gen.id, { decision, type: "adaptation", spotCheck: ctx.spot });
  return { status: "delivered", generationId: gen.id, applied: written.count, decision };
}

// ---------------------------------------------------------------------------
// Qualification

/**
 * Scores held-out scenarios on the full live route: code safety floor, model
 * output, validator (with the library's starting loads and the start cap),
 * equipment checks and confidence against the current threshold. A scenario
 * passes when the route (automatic or to the trainer) matches the trainer's
 * expectation. Programme scenarios qualify plans; adaptation scenarios (one
 * to apply, one for the trainer, at least) also qualify weekly adjustments.
 */
export async function qualifyPlanGeneration(
  db: Database,
  a: Actor,
  options: { candidateRelease?: any; trigger?: string } = {},
) {
  // Today's reviewed examples are checked as a candidate learning snapshot;
  // it goes live only with a passing qualification. A candidate Brain
  // release (brain-check.ts) is checked with the live snapshot instead, so
  // the two never change in one step.
  const learning = await db.tenant(a, (tx) =>
    options.candidateRelease
      ? publishedLearningSnapshot(tx)
      : candidateLearningSnapshot(tx, a, options.trigger ?? "qualification"),
  );
  try {
    return await qualifyWithLearning(db, a, options, learning);
  } catch (error) {
    if (learning?.status === "candidate")
      await db.tenant(a, (tx) =>
        tx.query(
          "UPDATE records SET status='check_failed',version=version+1,updated_at=now(),data=data||$2::jsonb WHERE id=$1 AND status='candidate'",
          [learning.id, JSON.stringify({ reason: String((error as any)?.code ?? "not_checked") })],
        ),
      );
    throw error;
  }
}
async function qualifyWithLearning(
  db: Database,
  a: Actor,
  options: { candidateRelease?: any },
  learning: any,
) {
  const snapshot = await db.tenant(a, async (tx) => {
    const { settings } = await loadPlanSettings(tx);
    const rows = learning ? await learningRowsIn(tx, learning) : (await snapshotCandidates(tx)).rows;
    const material = await trainerMaterial(tx, options.candidateRelease, rows);
    const state = await planQualificationState(tx, settings, options.candidateRelease, learning);
    return { settings, material, state, policy: await activeSafetyPolicy(tx) };
  });
  const { settings, material, state, policy } = snapshot;
  if (!material.release) throw fail(409, "BRAIN_REQUIRED", "Publish your Brain before qualifying plan generation");
  if (!material.library.size) throw fail(409, "LIBRARY_REQUIRED", "Add exercises to your library before qualifying plan generation");
  const scenarios = state.scenarios;
  if (scenarios.length > MAX_SCENARIOS) throw fail(409, "SCENARIO_LIMIT", `Keep at most ${MAX_SCENARIOS} held-out plan scenarios`);
  const programmes = scenarios.filter((s) => s.data.type !== "adaptation");
  const adaptations = scenarios.filter((s) => s.data.type === "adaptation");
  const review = programmes.filter((s) => s.data.expected === "review").length;
  if (programmes.length < MIN_SCENARIOS || review < 2 || programmes.length - review < 4)
    throw fail(409, "SCENARIO_COVERAGE", `Add at least ${MIN_SCENARIOS} held-out plan scenarios: four the Brain should deliver and two it must send to you`);
  const adaptReview = adaptations.filter((s) => s.data.expected === "review").length;
  if (adaptations.length && (adaptReview < 1 || adaptations.length - adaptReview < 1))
    throw fail(409, "ADAPTATION_SCENARIO_COVERAGE", "Adaptation scenarios need at least one the Brain should apply and one it must send to you");
  const outcomes: any[] = [];
  const today = localDate("UTC");
  const references = libraryLoads(material.library);
  const flagsOf = (profile: PlanProfile) =>
    [profile.goal, profile.limitations, profile.equipment]
      .map((t) => screenSafety(t, policy))
      .filter((s) => s.hold || s.review)
      .map(() => "A red-flag or personal-review term");
  const retrievalFor = (profile: PlanProfile, type: "programme" | "adaptation") =>
    retrievePlanMaterial({
      tenantId: a.tenantId,
      segment: planSegment(profile),
      goal: profile.goal,
      rules: material.rules,
      cases: material.cases,
      learning: type === "adaptation" ? material.learning.filter((l) => l.data.type === "adaptation") : material.learning,
      templates: type === "adaptation" ? [] : material.templates,
      library: material.library,
    });
  const scored = (
    scenario: any,
    type: "programme" | "adaptation",
    validation: PlanValidation,
    confidence: ReturnType<typeof planConfidence>,
    extra: Record<string, unknown>,
    holds: string[] = [],
  ) => {
    const decision = planRoute({
      type,
      mode: "automatic",
      qualified: true,
      safety: [],
      holds,
      confidence,
      validation,
      equipment: scenario.data.profile.equipment,
    });
    return {
      scenarioId: scenario.id,
      type,
      expected: scenario.data.expected,
      route: decision.route,
      passed: (decision.route === "automatic") === (scenario.data.expected === "deliverable"),
      gate: "route",
      score: confidence.score,
      reasons: decision.reasons.slice(0, 8),
      errors: validation.errors.slice(0, 5),
      warnings: validation.warnings.length,
      ...extra,
    };
  };
  for (const scenario of programmes) {
    const profile: PlanProfile = scenario.data.profile;
    const expectedReview = scenario.data.expected === "review";
    const safety = planSafetyReasons({ limitations: profile.limitations, redFlags: flagsOf(profile), painReports: 0 });
    if (safety.length) {
      // The safety floor sends these to the trainer whatever the model
      // writes, so the outcome cannot depend on the model and no model call
      // is paid for here. The live route still calls the model so the
      // trainer has a draft to edit; that draft's member-text screen and
      // validator errors are shown on the review item.
      outcomes.push({ scenarioId: scenario.id, type: "programme", expected: scenario.data.expected, route: "review", passed: expectedReview, gate: "code_safety", reasons: safety });
      continue;
    }
    const segment = planSegment(profile);
    const retrieval = retrievalFor(profile, "programme");
    const days = scenario.data.programmeDays;
    const result = await generateTrainingPlan(
      {
        profile,
        programme: { days, weeks: planWeeksFor(days), startDate: today },
        bounds: settings.bounds,
        twin: null,
        previous: null,
        material: retrieval.material,
        startingLoads: startingLoadsFor(references, material.library),
      },
      modelAccounting(db, a, "brain_plan_qualification"),
    );
    if (!result.draft) {
      outcomes.push({ scenarioId: scenario.id, type: "programme", expected: scenario.data.expected, route: "review", passed: expectedReview, gate: "model_output", errors: result.errors.slice(0, 5) });
      continue;
    }
    // Scored like a live plan: health wording is replaced and held for the trainer.
    const neutral = neutralPlanText(result.draft);
    const validation = validatePlan(neutral.draft, {
      profile,
      library: material.library,
      bounds: settings.bounds,
      evidenceIds: retrieval.evidenceIds,
      programmeDays: days,
      loadReference: references,
    });
    const confidence = planConfidence({
      ruleCoverage: ruleCoverage(segment, ruleTexts(material)),
      caseCoverage: caseCoverage(segment, learningRows(material)),
      validation,
      selfConfidence: neutral.draft.selfConfidence,
      uncertainties: neutral.draft.uncertainties,
      threshold: settings.threshold,
    });
    outcomes.push(
      scored(scenario, "programme", validation, confidence, { retrieval: retrieval.trace }, [
        ...neutralTextHolds(neutral.replaced),
        ...oneRepTimedHolds(neutral.draft),
      ]),
    );
  }
  for (const scenario of adaptations) {
    const profile: PlanProfile = scenario.data.profile;
    const expectedReview = scenario.data.expected === "review";
    const o = scenario.data.outcomes;
    const safety = planSafetyReasons({
      limitations: profile.limitations,
      redFlags: flagsOf(profile),
      painReports: o.painReported ? 1 : 0,
    });
    if (safety.length) {
      outcomes.push({ scenarioId: scenario.id, type: "adaptation", expected: scenario.data.expected, route: "review", passed: expectedReview, gate: "code_safety", reasons: safety });
      continue;
    }
    const week = (scenario.data.week as any[]).map((s, i) => ({
      plannedSessionId: `scenario-${i}`,
      key: s.sessionKey as string,
      sessionKey: s.sessionKey as string,
      exercises: (s.exercises as any[]).map(fromProgramExercise),
    }));
    // The scenario's week is both what was prescribed and what comes next;
    // its outcomes are logged at the scenario's adherence and effort.
    const logged = week.flatMap((s) => s.exercises);
    const outcomesInput = {
      checkIns: [],
      dueSessions: week.length,
      completedSessions: Math.round(week.length * o.adherence),
      skippedSessions: week.length - Math.round(week.length * o.adherence),
      adherence: o.adherence,
      loggedSets: Math.round(logged.reduce((n, e) => n + e.sets, 0) * o.adherence),
      exercises: logged.map((e) => ({
        exercise: e.name,
        prescribed: { sets: e.sets, ...workFields(e), loadKg: e.loadKg, rir: e.rir },
        logged: {
          sets: Math.round(e.sets * o.adherence),
          averageReps: o.adherence > 0 ? (e.reps ?? 0) : null,
          maxLoadKg: o.adherence > 0 ? e.loadKg : 0,
          averageRir: o.adherence > 0 ? Math.max(0, e.rir + (o.rirDelta ?? 0)) : null,
          ...(o.adherence > 0 && e.durationSeconds ? { averageDurationSeconds: e.durationSeconds } : {}),
          ...(o.adherence > 0 && e.distanceMeters ? { averageDistanceMeters: e.distanceMeters } : {}),
        },
      })),
    };
    const hold = progressionHolds(outcomesInput);
    const next = hold.length ? heldWeek(week, week).sessions : week;
    const segment = planSegment(profile);
    const retrieval = retrievalFor(profile, "adaptation");
    const result = await proposePlanAdaptation(
      {
        profile: { experience: profile.experience, daysPerWeek: profile.daysPerWeek, equipment: profile.equipment, goal: profile.goal },
        week: 2,
        currentWeek: week.map(({ sessionKey, exercises }) => ({ sessionKey, exercises })),
        nextWeek: next.map(({ sessionKey, exercises }) => ({ sessionKey, exercises })),
        outcomes: outcomesInput,
        progressionHold: hold,
        bounds: settings.bounds,
        material: retrieval.material,
      },
      modelAccounting(db, a, "brain_plan_qualification"),
    );
    if (!result.proposal) {
      outcomes.push({ scenarioId: scenario.id, type: "adaptation", expected: scenario.data.expected, route: "review", passed: expectedReview, gate: "model_output", errors: result.errors.slice(0, 5) });
      continue;
    }
    const applied = applyAdaptation(next, result.proposal.changes);
    const reference = new Map(references);
    for (const e of logged) reference.set(normalizeTerm(e.name), e.loadKg);
    const validation = validateAdaptedWeek(
      week.map(({ key, exercises }) => ({ key, exercises })),
      applied.sessions.map((s) => ({ key: s.sessionKey, exercises: s.exercises })),
      { profile, library: material.library, bounds: settings.bounds, evidenceIds: retrieval.evidenceIds, loadReference: reference },
    );
    validation.errors.unshift(...applied.errors);
    validation.errors.push(...adaptationDirectionIssues(next, applied.sessions, hold));
    if (result.proposal.evidenceIds.some((e) => !retrieval.evidenceIds.has(e)))
      validation.errors.push("The adjustment cites material outside the trainer's Brain");
    const confidence = planConfidence({
      ruleCoverage: ruleCoverage(segment, ruleTexts(material)),
      caseCoverage: caseCoverage(segment, learningRows(material), "adaptation"),
      validation,
      selfConfidence: result.proposal.selfConfidence,
      uncertainties: result.proposal.uncertainties,
      threshold: settings.threshold,
      outcomeEvidence: outcomeEvidence(outcomesInput),
    });
    outcomes.push(scored(scenario, "adaptation", validation, confidence, { changes: result.proposal.changes.length }));
  }
  return db.tenant(a, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId + ":brain"]);
    const { settings: current } = await loadPlanSettings(tx);
    const now = await planQualificationState(tx, current, options.candidateRelease, learning);
    // The live snapshot this candidate replaces, and every example in it, must be unchanged.
    const live = await publishedLearningSnapshot(tx);
    const learningChanged =
      !!learning &&
      ((learning.status === "candidate" && (live?.id ?? null) !== (learning.data.replaces ?? null)) ||
        (learning.status === "published" && live?.id !== learning.id) ||
        (await learningRowsIn(tx, learning)).length !== (learning.data.rows ?? []).length);
    if (now.contractDigest !== state.contractDigest || now.scenariosDigest !== state.scenariosDigest || learningChanged)
      throw fail(409, "PLAN_CONTRACT_CHANGED", "Your Brain, bounds, scenarios or reviewed examples changed during qualification; run it again");
    const passed = outcomes.filter((o) => o.passed).length;
    const count = (type: string, expected?: string) =>
      outcomes.filter((o) => o.type === type && (!expected || o.expected === expected)).length;
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
        threshold: settings.threshold,
        programme: { total: count("programme"), passed: outcomes.filter((o) => o.type === "programme" && o.passed).length },
        adaptation: {
          total: count("adaptation"),
          deliverable: count("adaptation", "deliverable"),
          review: count("adaptation", "review"),
          passed: outcomes.filter((o) => o.type === "adaptation" && o.passed).length,
        },
        pin: planModelPin(),
        learningSnapshotId: learning?.id ?? null,
      },
      { status: passed === outcomes.length ? "passed" : "failed" },
    );
    await event(tx, a, "brain.plan_qualification", row.id, { passed, total: outcomes.length });
    if (learning?.status === "candidate") {
      if (row.status === "passed") {
        await tx.query(
          "UPDATE records SET status='archived',version=version+1,updated_at=now() WHERE kind='plan_learning_snapshot' AND status='published'",
        );
        await tx.query(
          "UPDATE records SET status='published',version=version+1,updated_at=now(),data=data||$2::jsonb WHERE id=$1",
          [learning.id, JSON.stringify({ qualificationId: row.id })],
        );
        await event(tx, a, "brain.plan_learning_published", learning.id, { count: learning.data.count, qualificationId: row.id });
      } else
        await tx.query(
          "UPDATE records SET status='check_failed',version=version+1,updated_at=now(),data=data||$2::jsonb WHERE id=$1",
          [learning.id, JSON.stringify({ qualificationId: row.id, reason: "check_failed" })],
        );
    }
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
/**
 * Closes generations nobody will finish: a request interrupted mid-call, and
 * an unsent (`not_sent`) generation whose job has no retry pending, has none,
 * or has waited more than a day. Both go to the trainer's queue as failed
 * with a Regenerate action, so the member is never left waiting.
 */
async function closeStuckGenerations(tx: Tx) {
  await tx.query(
    "UPDATE records SET status='failed',version=version+1,updated_at=now(),data=data||'{\"error\":\"The generation was interrupted; review or regenerate it.\",\"providerState\":\"unknown\"}'::jsonb WHERE kind='plan_generation' AND status='generating' AND updated_at<now()-interval '30 minutes'",
  );
  await tx.query(
    "UPDATE records g SET status='failed',version=version+1,updated_at=now(),data=g.data||jsonb_build_object('error','The model was not called ('||coalesce(g.data->>'errorCode','refused')||') and no retry is pending; regenerate this plan.','providerState','not_sent') WHERE g.kind='plan_generation' AND g.status='not_sent' AND (g.updated_at<now()-interval '26 hours' OR g.data->>'jobId' IS NULL OR NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id::text=g.data->>'jobId' AND j.status='pending'))",
  );
}
const scheduled = new Map<string, number>();
const SCHEDULE_INTERVAL_MS = 10 * 60 * 1000;
const NO_CURSOR = "00000000-0000-0000-0000-000000000000";
/**
 * Enqueues first plans after intake, next blocks near a generated
 * programme's end (only when the member's access continues into it) and
 * weekly adaptations near each programme week's end. At most every ten
 * minutes per workspace unless forced (tests, operators).
 *
 * Members already waiting on a generation or a queued job are filtered in
 * SQL; the rest are examined in batches of 200 from a cursor persisted on a
 * staff-only `plan_schedule_state` record, so every member is reached in
 * turn however large the workspace.
 */
export async function scheduleBrainPlans(
  db: Database,
  tenantId: string,
  options: { force?: boolean; batch?: number } = {},
) {
  if (!planModelConfigured()) return 0;
  if (!options.force && Date.now() - (scheduled.get(tenantId) ?? 0) < SCHEDULE_INTERVAL_MS) return 0;
  scheduled.set(tenantId, Date.now());
  const a = elevated("worker", { tenantId, role: "owner" });
  const batch = Math.max(1, Math.min(1000, options.batch ?? SCHEDULE_BATCH));
  return db.tenant(a, async (tx) => {
    // One sweep per workspace at a time (several workers may run cycles).
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId + ":brain-schedule"]);
    await closeStuckGenerations(tx);
    await archiveEndedBlocks(tx);
    const [release] = await tx.query("SELECT id FROM records WHERE kind='brain_release' AND status='published' LIMIT 1");
    if (!release) return 0;
    const [state] = await tx.query(
      "SELECT id,data FROM records WHERE kind='plan_schedule_state' ORDER BY created_at,id LIMIT 1 FOR UPDATE",
    );
    const after = typeof state?.data?.after === "string" ? state.data.after : NO_CURSOR;
    const members = await tx.query(
      `SELECT i.user_id,i.intake_id FROM (
         SELECT DISTINCT ON (r.owner_user_id) r.owner_user_id AS user_id,r.id AS intake_id
         FROM records r JOIN memberships m ON m.user_id=r.owner_user_id AND m.tenant_id=r.tenant_id AND m.role='subscriber'
         WHERE r.kind='intake' AND r.owner_user_id>$1::uuid
         ORDER BY r.owner_user_id,r.created_at DESC,r.id DESC) i
       WHERE NOT EXISTS(SELECT 1 FROM records g WHERE g.kind='plan_generation' AND g.owner_user_id=i.user_id AND g.status IN ('generating','not_sent','pending_review'))
         AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.kind='brain_plan' AND j.status='pending' AND j.data->>'userId'=i.user_id::text)
       ORDER BY i.user_id LIMIT $2`,
      [after, batch],
    );
    // A short page means the end was reached: start from the beginning next time.
    const cursor = members.length < batch ? NO_CURSOR : members[members.length - 1].user_id;
    if (state)
      await tx.query("UPDATE records SET data=jsonb_build_object('after',$2::text),updated_at=now() WHERE id=$1", [state.id, cursor]);
    // A workspace-level record with no owner (the worker is not a user).
    else
      await tx.query(
        "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,'plan_schedule_state',NULL,'active',$3)",
        [randomUUID(), tenantId, JSON.stringify({ after: cursor })],
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
      const program = await latestAssigned(tx, m.user_id);
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
          expectedProgramId: null,
        });
        continue;
      }
      // A trainer's hand-written programme is never replaced automatically.
      if (!program.data?.generated || !program.data.endDate) continue;
      const today = localDate(program.data.timezone ?? "UTC");
      if (daysBetween(today, program.data.endDate) <= NEXT_BLOCK_LEAD_DAYS) {
        // A fixed programme bought upfront ends with its access; the
        // programme package handles its end. Only continuing access gets a
        // next block.
        const startDate = addTrainingDays(program.data.endDate, 1);
        if (await nextBlockAllowed(tx, m.user_id, startDate))
          await enqueue(`brain-plan:${tenantId}:${m.user_id}:block:${program.id}`, {
            userId: m.user_id,
            type: "programme",
            trigger: "block_end",
            startDate,
            expectedProgramId: program.id,
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
    // Jobs queued before this field existed expect nothing (intake) or the
    // Brain's own block (block_end); both still refuse a hand-written programme.
    ...("expectedProgramId" in job.data ? { expectedProgramId: job.data.expectedProgramId ?? null } : {}),
  });
}

// ---------------------------------------------------------------------------
// Routes

const settingsBody = z
  .object({ settings: planSettingsSchema, version: z.number().int().positive().nullable() })
  .strict();
const notReadyMessages: Record<string, string> = {
  not_member: "This subscriber is not a member of your workspace",
  safety_hold: "This subscriber's training is paused for a safety review",
  no_access: "This subscriber has no active membership",
  no_intake: "This subscriber has not completed a consented intake",
  no_consent: "This subscriber has not granted coaching consent",
  no_brain: "Publish your Brain before generating plans",
  no_library: "Add exercises to your library before generating plans",
  programme_changed: "This subscriber's programme changed; refresh and try again",
  no_next_week: "That programme week has no planned sessions left to adjust",
};
const notReady = (reason: string) =>
  fail(409, "PLAN_NOT_READY", notReadyMessages[reason] ?? "This plan cannot be generated now");
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
  // The model's own wording that neutral wording replaced (staff only).
  replacedText: row.data.replacedText ?? null,
  proposal: row.data.proposal ?? null,
  currentWeek: row.data.currentWeek ?? null,
  // Why next week may not go up, and what was held at this week's values.
  progressionHold: row.data.progressionHold ?? [],
  held: row.data.held ?? [],
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
        "SELECT * FROM records WHERE kind='plan_generation' AND (status IN ('pending_review','failed','not_sent') OR (status='delivered' AND data->'outcome'->>'spotCheck'='pending')) ORDER BY created_at,id LIMIT 50",
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
        modelPin: coachFacingPin(planModelPin(), runtimeConfig()),
        qualification: {
          qualified: state.qualified,
          adaptationQualified: state.adaptationQualified,
          contractDigest: state.contractDigest,
          latest: state.latest
            ? { id: state.latest.id, status: state.latest.status, createdAt: state.latest.created_at, passed: state.latest.data.passed, total: state.latest.data.total, outcomes: state.latest.data.outcomes, threshold: state.latest.data.threshold ?? null, adaptation: state.latest.data.adaptation ?? null, current: state.latest.data.contractDigest === state.contractDigest && state.latest.data.scenariosDigest === state.scenariosDigest && Number(state.latest.data.threshold ?? 2) <= settings.threshold }
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
    if (result.status === "skipped") throw notReady((result as any).reason);
    return result;
  });
  // A fresh attempt for an item in the queue: failed (no usable draft),
  // never sent (the model refused before dispatch) or a draft the trainer
  // would rather have rewritten. The old item is superseded once the new
  // generation exists.
  app.post("/api/v1/brain/plans/:id/regenerate", async (req) => {
    const a = trainer(req),
      b = z.object({ version: z.number().int().positive() }).strict().parse(req.body);
    const generationId = id.parse((req.params as any).id);
    if (!planModelConfigured())
      throw fail(503, "MODEL_NOT_CONFIGURED", "Configure a coaching model before the Brain prepares plans");
    const old = await db.tenant(a, async (tx) => {
      const [row] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind='plan_generation'", [generationId]);
      if (!row) throw fail(404, "PLAN_UNAVAILABLE", "This plan is unavailable");
      if (row.version !== b.version) throw fail(409, "PLAN_CHANGED", "This plan changed; refresh first");
      if (!["failed", "not_sent", "pending_review"].includes(row.status))
        throw fail(409, "PLAN_REVIEWED", "This plan has already been decided");
      return row;
    });
    let result: any, error: any;
    try {
      result =
        old.data.type === "adaptation"
          ? await adaptMemberPlan(db, a, old.owner_user_id, { programId: old.data.inputs?.programId, week: Number(old.data.inputs?.week) })
          : await generateMemberPlan(db, a, old.owner_user_id, { trigger: "manual" });
    } catch (e) {
      error = e;
    }
    if (result?.status === "skipped" && !result.generationId) throw notReady(result.reason);
    const replacement = result?.generationId ?? error?.generationId ?? null;
    if (replacement && replacement !== old.id)
      await db.tenant(a, async (tx) => {
        await planLock(tx, a, old.owner_user_id);
        const rows = await tx.query(
          "UPDATE records SET status='superseded',version=version+1,updated_at=now(),data=data||$2::jsonb WHERE id=$1 AND kind='plan_generation' AND version=$3 AND status IN ('failed','not_sent','pending_review') RETURNING id",
          [old.id, JSON.stringify({ outcome: { ...(old.data.outcome ?? {}), decision: "regenerated", replacedBy: replacement, reviewedBy: a.userId, reviewedAt: new Date().toISOString() } }), old.version],
        );
        if (rows.length) await event(tx, a, "brain.plan_regenerated", old.id, { replacement });
      });
    if (error) throw error;
    return { ...result, replaced: old.id };
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
