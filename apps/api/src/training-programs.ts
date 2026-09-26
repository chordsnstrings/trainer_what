import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { event, putRecord, type Actor, type Database, type Tx } from "@trainer/db";
import { trainingExerciseSchema, trainingProgramSchema, trainingDateSchema, trainingSchedule, effectiveWorkoutSets } from "../../../packages/domain/src/coaching-completion.ts";
import { lockTraining, assertTrainingOpen } from "./coaching-completion.ts";
import { currentPaidSubscription } from "./finance-billing.ts";

const id = z.string().uuid();
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
function actor(req: FastifyRequest, coach = false) {
  if (!req.identity) throw fail(401, "Please sign in");
  if (!(coach ? ["owner", "staff"] : ["owner", "staff", "subscriber"]).includes(req.identity.role)) throw fail(403, "Coaching access required");
  return req.identity;
}
async function record(tx: Tx, key: string, kind: string) {
  const [r] = await tx.query("SELECT * FROM records WHERE id=$1 AND kind=$2", [id.parse(key), kind]);
  if (!r) throw fail(404, "This item is unavailable"); return r;
}
async function member(tx: Tx, a: Actor, userId: string) {
  const [r] = await tx.query("SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'", [a.tenantId, userId]);
  if (!r) throw fail(404, "Subscriber unavailable");
}
const today = (timezone = "Asia/Dubai") => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const zone = z.string().max(80).refine((s) => { try { new Intl.DateTimeFormat("en", { timeZone: s }); return true; } catch { return false; } }, "Choose a valid timezone").default("Asia/Dubai");
export async function scheduleProgram(tx: Tx, a: Actor, program: any, startDate: string, timezone: string) {
  const parsed = trainingProgramSchema.parse(Object.fromEntries(Object.entries(program.data).filter(([key]) => ["title", "goal", "daysPerWeek", "exercises", "weeks", "sessions"].includes(key))));
  const slots = trainingSchedule(parsed, startDate, timezone);
  for (const slot of slots) await putRecord(tx, a, "planned_session", { ...slot, programId: program.id, programVersion: program.version }, { ownerId: program.owner_user_id, status: "planned" });
  await event(tx, a, "program.scheduled", program.id, { subscriberId: program.owner_user_id, startDate, timezone, sessions: slots.length });
  return slots.length;
}
export async function reviseExercise(tx: Tx, a: Actor, program: any, exercise: string, replacement: any, note: string, decisionId?: string) {
  if (!program.data.exercises.some((e: any) => e.name === exercise) && !(program.data.sessions ?? []).some((s: any) => s.exercises.some((e: any) => e.name === exercise))) throw fail(400, "This exercise is not in the assigned program");
  const replace = (items: any[]) => items.map((e) => e.name === exercise ? { ...e, ...replacement } : e);
  const next = await putRecord(tx, a, "program", { ...program.data, exercises: replace(program.data.exercises), ...(program.data.sessions ? { sessions: program.data.sessions.map((s: any) => ({ ...s, exercises: replace(s.exercises) })) } : {}), previousProgramId: program.id, revisionNote: note, sourceDecisionId: decisionId ?? null }, { ownerId: program.owner_user_id, status: "assigned" });
  await tx.query("UPDATE records SET status='archived',version=version+1,updated_at=now() WHERE id=$1", [program.id]);
  const future = await tx.query("SELECT * FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND status='planned' AND data->>'programId'=$2", [program.owner_user_id, program.id]);
  for (const plan of future) await tx.query("UPDATE records SET version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1", [plan.id, JSON.stringify({ programId: next.id, programVersion: next.version, program: { ...plan.data.program, exercises: replace(plan.data.program.exercises) }, revisionNote: note })]);
  await event(tx, a, "program.exercise_revised", next.id, { previousProgramId: program.id, exercise, note });
  return next;
}
export function registerTrainingPrograms(app: FastifyInstance, db: Database) {
  app.post("/api/v1/programs", async (req) => {
    const a = actor(req, true), b = z.object({ program: trainingProgramSchema, subscriberId: id.optional(), startDate: trainingDateSchema.optional(), timezone: zone }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      if (b.subscriberId) { await lockTraining(tx, a, b.subscriberId); await member(tx, a, b.subscriberId); }
      const p = await putRecord(tx, a, "program", { ...b.program, authorId: a.userId, allowedUses: ["render", "model_prompt"] }, { ownerId: b.subscriberId ?? a.userId, status: b.subscriberId ? "assigned" : "template" });
      if (b.subscriberId) await scheduleProgram(tx, a, p, b.startDate ?? today(b.timezone), b.timezone);
      await event(tx, a, "program.created", p.id); return p;
    });
  });
  app.post("/api/v1/programs/:id/assign", async (req) => {
    const a = actor(req, true), b = z.object({ subscriberId: id, version: z.number().int().positive(), startDate: trainingDateSchema, timezone: zone }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      await lockTraining(tx, a, b.subscriberId); await member(tx, a, b.subscriberId);
      const p = await record(tx, (req.params as any).id, "program");
      if (p.status !== "template" || p.version !== b.version) throw fail(409, "This template changed; refresh before assigning it");
      const assigned = await putRecord(tx, a, "program", { ...p.data, templateId: p.id, templateVersion: p.version, authorId: a.userId }, { ownerId: b.subscriberId, status: "assigned" });
      await scheduleProgram(tx, a, assigned, b.startDate, b.timezone); return assigned;
    });
  });
  app.post("/api/v1/programs/:id/progression", async (req) => {
    const a = actor(req, true), b = z.object({ version: z.number().int().positive(), exercise: z.string().min(2).max(100), loadKg: z.number().min(0).max(500), reps: z.number().int().min(1).max(100), rir: z.number().min(0).max(10), note: z.string().trim().min(10).max(2000) }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      const initial = await record(tx, (req.params as any).id, "program"); await lockTraining(tx, a, initial.owner_user_id);
      const p = await record(tx, initial.id, "program");
      if (p.version !== b.version || p.status !== "assigned") throw fail(409, "The program changed; refresh before revising it");
      return reviseExercise(tx, a, p, b.exercise, { loadKg: b.loadKg, reps: b.reps, rir: b.rir }, b.note);
    });
  });
  app.get("/api/v1/training/overview", async (req) => {
    const a = actor(req), q = z.object({ subscriberId: id.optional() }).parse(req.query), userId = a.role === "subscriber" ? a.userId : q.subscriberId;
    return db.tenant(a, async (tx) => {
      if (userId) await member(tx, a, userId);
      const rows = await tx.query("SELECT * FROM records WHERE kind IN ('program','planned_session','workout','workout_correction','workout_substitution','training_hold') AND ($1::uuid IS NULL OR owner_user_id=$1 OR (kind='program' AND status='template')) ORDER BY created_at DESC LIMIT 1500", [userId ?? null]);
      const sets = userId ? await tx.query("SELECT * FROM workout_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5000", [userId]) : [];
      const corrections = rows.filter((r) => r.kind === "workout_correction"), effectiveSets = effectiveWorkoutSets(sets, corrections);
      return { records: rows, sets: effectiveSets, partial: rows.length === 1500 || sets.length === 5000, ...(a.role !== "subscriber" ? { members: await tx.query("SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND m.role='subscriber' ORDER BY u.name", [a.tenantId]) } : {}) };
    });
  });
  app.post("/api/v1/training/sessions/:id/reschedule", async (req) => {
    const a = actor(req), b = z.object({ version: z.number().int().positive(), date: trainingDateSchema, note: z.string().trim().min(3).max(1000) }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      const initial = await record(tx, (req.params as any).id, "planned_session"); await lockTraining(tx, a, initial.owner_user_id);
      const p = await record(tx, initial.id, "planned_session");
      if ((a.role === "subscriber" && p.owner_user_id !== a.userId) || p.status !== "planned" || p.version !== b.version) throw fail(409, "This session changed; refresh before moving it");
      if (b.date < today(p.data.timezone)) throw fail(400, "Choose today or a future date");
      const [conflict] = await tx.query("SELECT id FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND status IN ('planned','started') AND data->>'date'=$2 AND id<>$3", [p.owner_user_id, b.date, p.id]);
      if (conflict) throw fail(409, "Another training session is already scheduled on that day");
      await tx.query("UPDATE records SET version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1", [p.id, JSON.stringify({ date: b.date, rescheduleNote: b.note, rescheduledBy: a.userId, previousDate: p.data.date })]);
      await event(tx, a, "workout.rescheduled", p.id, { from: p.data.date, to: b.date, note: b.note }); return { ok: true };
    });
  });
  app.post("/api/v1/training/sessions/:id/cancel", async (req) => {
    const a = actor(req), b = z.object({ version: z.number().int().positive(), note: z.string().trim().min(3).max(1000) }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      const initial = await record(tx, (req.params as any).id, "planned_session"); await lockTraining(tx, a, initial.owner_user_id);
      const p = await record(tx, initial.id, "planned_session");
      if (p.status !== "planned" || p.version !== b.version) throw fail(409, "This session has already changed");
      await tx.query("UPDATE records SET status='canceled',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1", [p.id, JSON.stringify({ canceledBy: a.userId, cancelNote: b.note })]);
      await event(tx, a, "workout.plan_canceled", p.id); return { ok: true };
    });
  });
  app.get("/api/v1/training/exercises", async (req) => {
    const a = actor(req, true); return db.tenant(a, (tx) => tx.query("SELECT * FROM records WHERE kind='exercise' AND status='active' ORDER BY data->>'name' LIMIT 1000"));
  });
  app.post("/api/v1/training/exercises", async (req) => {
    const a = actor(req, true), b = trainingExerciseSchema.parse(req.body);
    return db.tenant(a, async (tx) => { const r = await putRecord(tx, a, "exercise", { ...b, allowedUses: ["render", "model_prompt"] }, { status: "active" }); await event(tx, a, "exercise.created", r.id); return r; });
  });
  app.post("/api/v1/workouts/:id/substitute", async (req) => {
    const a = actor(req), b = z.object({ version: z.number().int().positive(), exercise: z.string().min(2).max(100), replacement: z.string().min(2).max(100), reason: z.enum(["equipment_unavailable", "coach_preference"]) }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      await lockTraining(tx, a); await assertTrainingOpen(tx, a.userId);
      if (a.role === "subscriber" && !(await currentPaidSubscription(tx, a.userId))) throw fail(402, "An active membership is required");
      const w = await record(tx, (req.params as any).id, "workout");
      if (w.owner_user_id !== a.userId || w.status !== "active" || w.version !== b.version) throw fail(409, "This session changed; refresh before substituting");
      const ex = w.data.program.exercises.find((e: any) => e.name === b.exercise), replacement = ex?.alternatives?.find((e: any) => e.name === b.replacement);
      if (!replacement) throw fail(400, "Choose an alternative approved in your workout");
      if (w.data.program.exercises.some((e: any) => e.name === b.replacement)) throw fail(409, "That exercise is already in this session");
      const [logged] = await tx.query("SELECT id FROM workout_events WHERE workout_id=$1 AND data->>'exercise'=$2 LIMIT 1", [w.id, b.exercise]);
      if (logged) throw fail(409, "This exercise already has logged sets; ask your trainer before changing it");
      const program = { ...w.data.program, exercises: w.data.program.exercises.map((e: any) => e.name === b.exercise ? { ...ex, ...replacement, alternatives: [] } : e) };
      await tx.query("UPDATE records SET version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1", [w.id, JSON.stringify({ program })]);
      const r = await putRecord(tx, a, "workout_substitution", { workoutId: w.id, from: b.exercise, to: b.replacement, reason: b.reason, prescribedAlternative: replacement }, { status: "recorded" });
      await event(tx, a, "workout.exercise_substituted", r.id); return { ok: true };
    });
  });
  app.post("/api/v1/workouts/:id/sets/:eventId/correct", async (req) => {
    const a = actor(req), b = z.object({ revision: z.number().int().min(0), reps: z.number().int().min(0).max(200), loadKg: z.number().min(0).max(500), rir: z.number().min(0).max(10).optional(), note: z.string().trim().min(3).max(1000) }).strict().parse(req.body);
    return db.tenant(a, async (tx) => {
      const w = await record(tx, (req.params as any).id, "workout"); await lockTraining(tx, a, w.owner_user_id);
      if (a.role === "subscriber" && w.owner_user_id !== a.userId) throw fail(403, "Workout ownership required");
      const [set] = await tx.query("SELECT * FROM workout_events WHERE id=$1 AND workout_id=$2", [id.parse((req.params as any).eventId), w.id]);
      if (!set) throw fail(404, "Set log unavailable");
      const [prior] = await tx.query("SELECT * FROM records WHERE kind='workout_correction' AND data->>'eventId'=$1 ORDER BY (data->>'revision')::int DESC LIMIT 1", [set.id]);
      const revision = prior?.data.revision ?? 0;
      if (revision !== b.revision) throw fail(409, "This log has changed; refresh before correcting it");
      const values = { reps: b.reps, loadKg: b.loadKg, ...(b.rir === undefined ? {} : { rir: b.rir }) };
      const correction = await putRecord(tx, a, "workout_correction", { workoutId: w.id, eventId: set.id, revision: revision + 1, previousCorrectionId: prior?.id ?? null, original: set.data, values, note: b.note, correctedBy: a.userId }, { ownerId: w.owner_user_id, status: "recorded" });
      await event(tx, a, "workout.log_corrected", correction.id); return correction;
    });
  });
  app.get("/api/v1/messages/thread", async (req) => {
    const a = actor(req), q = z.object({ subscriberId: id.optional(), before: id.optional() }).parse(req.query), target = a.role === "subscriber" ? a.userId : q.subscriberId;
    if (!target) throw fail(400, "Select a subscriber");
    return db.tenant(a, async (tx) => {
      await member(tx, a, target);
      const cursor = q.before ? await record(tx, q.before, "message") : undefined;
      if (cursor && cursor.owner_user_id !== target) throw fail(404, "Message unavailable");
      const rows = await tx.query("SELECT * FROM records WHERE kind='message' AND owner_user_id=$1 AND status='sent' AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT 100", [target, cursor?.created_at ?? null, cursor?.id ?? null]);
      const takeover = await tx.query("SELECT id FROM records WHERE kind='takeover' AND owner_user_id=$1 AND status='active'", [target]);
      return { messages: rows.reverse(), hasMore: rows.length === 100, personalReview: takeover.length > 0 };
    });
  });
}
