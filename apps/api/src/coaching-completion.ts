import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { setSchema } from "@trainer/contracts";
import { safetySignal } from "@trainer/domain";
import { modelDecision } from "@trainer/providers";
import { currentClientTwin } from "./client-twin.ts";
import { modelAccounting } from "./model-accounting.ts";
import { currentPaidSubscription } from "./finance-billing.ts";
import { notifyCoachingTeam, notifyUser } from "./notifications.ts";
import {
  registerCoachingRuntime,
  tryQualifiedCoaching,
  approveQualifiedDecision,
} from "./coaching-runtime.ts";

const id = z.string().uuid();
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
function identity(req: FastifyRequest) {
  if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in");
  if (!["owner", "staff", "subscriber"].includes(req.identity.role))
    throw fail(403, "COACHING_ACCESS", "Coaching access required");
  return req.identity;
}
function trainer(req: FastifyRequest) {
  const a = identity(req);
  if (!["owner", "staff"].includes(a.role))
    throw fail(403, "TRAINER_REQUIRED", "Trainer access required");
  return a;
}
async function record(tx: Tx, recordId: string, kind: string) {
  const [row] = await tx.query(
    "SELECT * FROM records WHERE id=$1 AND kind=$2",
    [id.parse(recordId), kind],
  );
  if (!row) throw fail(404, "NOT_FOUND", "This item is unavailable");
  return row;
}
async function subscriber(tx: Tx, a: Actor, userId: string) {
  const [m] = await tx.query(
    "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
    [a.tenantId, userId],
  );
  if (!m) throw fail(404, "NOT_FOUND", "Subscriber unavailable");
}
export async function lockTraining(tx: Tx, a: Actor, userId = a.userId) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":training:" + userId,
  ]);
  const [membership] = await tx.query(
    "SELECT training_actor_is_current($1,$2,$3) AS current",
    [a.tenantId, a.userId, a.role],
  );
  if (!membership?.current)
    throw fail(
      403,
      "WORKSPACE_CHANGED",
      "Your workspace membership changed; sign in again before continuing",
    );
}
export async function assertTrainingOpen(tx: Tx, userId: string) {
  const [held] = await tx.query(
    "SELECT id FROM records WHERE owner_user_id=$1 AND ((kind='training_hold' AND status='active') OR (kind='workout' AND status='safety_hold')) LIMIT 1",
    [userId],
  );
  if (held)
    throw fail(
      409,
      "TRAINING_HELD",
      "Your training is paused. Your trainer must review and explicitly resume or abandon the held session before you continue.",
    );
}
async function activeMembership(tx: Tx, a: Actor) {
  if (a.role !== "subscriber") return;
  const s = await currentPaidSubscription(tx, a.userId);
  if (!s)
    throw fail(402, "MEMBERSHIP_REQUIRED", "An active membership is required");
}
export async function openTrainingHold(
  tx: Tx,
  a: Actor,
  userId: string,
  reason: string,
  workoutId?: string,
) {
  await lockTraining(tx, a, userId);
  const [prior] = await tx.query(
    "SELECT * FROM records WHERE kind='training_hold' AND owner_user_id=$1 AND status='active'",
    [userId],
  );
  if (prior) return prior;
  const workouts = await tx.query(
    "UPDATE records SET status='safety_hold',version=version+1,updated_at=now() WHERE kind='workout' AND owner_user_id=$1 AND status='active' RETURNING id",
    [userId],
  );
  const hold = await putRecord(
    tx,
    a,
    "training_hold",
    {
      reason,
      workoutIds: workouts.map((w) => w.id),
      reportedWorkoutId: workoutId ?? null,
      openedAt: new Date().toISOString(),
    },
    { ownerId: userId, status: "active" },
  );
  // Exceptions stay private to coaching staff. Do not INSERT RETURNING under
  // subscriber RLS, which correctly disallows reading that private record.
  const exceptionId = randomUUID();
  await tx.query(
    "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,'exception',$3,'open',$4)",
    [
      exceptionId,
      a.tenantId,
      userId,
      JSON.stringify({
        category: "safety",
        description: reason,
        subscriberId: userId,
        holdId: hold.id,
        workoutId: workoutId ?? null,
      }),
    ],
  );
  await event(tx, a, "safety.escalated", exceptionId, {
    holdId: hold.id,
    subscriberId: userId,
  });
  await notifyCoachingTeam(tx, a, {
    category: "safety",
    dedupeKey: `training-hold:${hold.id}`,
    title: "A client needs a safety review",
    body: "Training has been paused after a safety report. Open your exceptions to review the report and explicitly resume or end the session.",
    href: "/trainer/exceptions",
    templateKey: "training-safety-alert",
  });
  await notifyUser(tx, a, {
    userId,
    category: "safety",
    dedupeKey: `training-hold:${hold.id}`,
    title: "Your training is paused",
    body: "Stop this training session. Your trainer needs to review the safety report before training can resume. Contact local emergency services if you need urgent help.",
    href: "/app/chat",
  });
  return hold;
}

/** Shared delivery gate for approving a proposal or a separately recorded correction. */
export async function deliverReviewedCoachingDecision(
  tx: Tx,
  a: Actor,
  d: any,
) {
  await lockTraining(tx, a, d.owner_user_id);
  await subscriber(tx, a, d.owner_user_id);
  await assertTrainingOpen(tx, d.owner_user_id);
  const [release] = await tx.query(
    "SELECT id FROM records WHERE kind='brain_release' AND status='published' ORDER BY created_at DESC LIMIT 1",
  );
  const [consent] = await tx.query(
    "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC,id DESC LIMIT 1",
    [d.owner_user_id],
  );
  if (!consent?.granted || release?.id !== d.data.brainVersionId)
    throw fail(
      409,
      "REVIEW_STALE",
      "Consent or the published Brain changed; prepare a fresh decision",
    );
  if (
    d.data.clientSnapshotId &&
    (await currentClientTwin(tx, a, d.owner_user_id)).id !==
      d.data.clientSnapshotId
  )
    throw fail(
      409,
      "REVIEW_STALE",
      "The client's profile or training record changed; prepare a fresh decision",
    );
  if (d.status !== "pending_review")
    throw fail(
      409,
      "DECISION_STATE",
      "This decision has already been reviewed",
    );
  const reviewedMessage = d.data.actionId
    ? await approveQualifiedDecision(tx, a, d)
    : d.data.message;
  if (d.data.program)
    await putRecord(
      tx,
      a,
      "program",
      {
        ...d.data.program,
        sourceDecisionId: d.id,
        brainVersionId: d.data.brainVersionId,
        authorId: a.userId,
        allowedUses: ["render", "model_prompt"],
      },
      { ownerId: d.owner_user_id, status: "assigned" },
    );
  await tx.query(
    "UPDATE records SET status='approved',version=version+1,updated_at=now() WHERE id=$1",
    [d.id],
  );
  const message = await putRecord(
    tx,
    a,
    "message",
    {
      text: d.data.coachMessage ?? reviewedMessage,
      author: d.data.correctionId ? "trainer_reviewed" : "digital_reviewed",
      reviewedBy: a.userId,
      decisionId: d.id,
      subscriberId: d.owner_user_id,
    },
    { ownerId: d.owner_user_id, status: "sent" },
  );
  return {
    decisionId: d.id,
    messageId: message.id,
    message: message.data.text,
  };
}

export function registerCoachingCompletion(app: FastifyInstance, db: Database) {
  registerCoachingRuntime(app, db);
  app.get("/api/v1/training/holds", async (req) => {
    const a = trainer(req);
    return db.tenant(a, (tx) =>
      tx.query(
        "SELECT r.*,u.name AS client_name FROM records r LEFT JOIN users u ON u.id=r.owner_user_id WHERE r.kind='training_hold' ORDER BY r.updated_at DESC LIMIT 200",
      ),
    );
  });
  app.post("/api/v1/training/holds/:id/resolve", async (req) => {
    const a = trainer(req),
      b = z
        .object({
          version: z.number().int().positive(),
          action: z.enum(["resume", "abandon"]),
          note: z.string().trim().min(10).max(4000),
          reviewed: z.literal(true),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const h = await record(tx, (req.params as any).id, "training_hold");
      await lockTraining(tx, a, h.owner_user_id);
      await subscriber(tx, a, h.owner_user_id);
      const current = await record(tx, h.id, "training_hold");
      if (current.version !== b.version || current.status !== "active")
        throw fail(
          409,
          "HOLD_CHANGED",
          "This hold has already changed; refresh before reviewing it",
        );
      const resolution = {
        action: b.action,
        note: b.note,
        reviewedBy: a.userId,
        reviewedAt: new Date().toISOString(),
      };
      await tx.query(
        "UPDATE records SET status=$2,version=version+1,data=data||$3::jsonb,updated_at=now() WHERE id=$1",
        [
          h.id,
          b.action === "resume" ? "resumed" : "abandoned",
          JSON.stringify({ resolution }),
        ],
      );
      await tx.query(
        "UPDATE records SET status=$2,version=version+1,data=data||$3::jsonb,updated_at=now() WHERE kind='workout' AND owner_user_id=$1 AND status='safety_hold'",
        [
          h.owner_user_id,
          b.action === "resume" ? "active" : "abandoned",
          JSON.stringify({ safetyResolution: resolution }),
        ],
      );
      if (b.action === "abandon")
        await tx.query(
          "UPDATE records SET status='abandoned',version=version+1,updated_at=now() WHERE kind='planned_session' AND owner_user_id=$1 AND status='started' AND data->>'workoutId'=ANY($2::text[])",
          [h.owner_user_id, current.data.workoutIds ?? []],
        );
      await tx.query(
        "UPDATE records SET status='resolved',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE kind='exception' AND owner_user_id=$1 AND status='open' AND (data->>'holdId'=$3 OR (data->>'category'='safety' AND data->>'workoutId'=ANY($4::text[])))",
        [
          h.owner_user_id,
          JSON.stringify({
            resolution: b.note,
            resolvedBy: a.userId,
            holdAction: b.action,
          }),
          h.id,
          current.data.workoutIds ?? [],
        ],
      );
      await putRecord(
        tx,
        a,
        "message",
        {
          text:
            b.action === "resume"
              ? `Your trainer reviewed the training hold and resumed your session. ${b.note}`
              : `Your trainer reviewed the hold and ended the paused session. ${b.note}`,
          author: "trainer",
          subscriberId: h.owner_user_id,
          holdId: h.id,
        },
        { ownerId: h.owner_user_id, status: "sent" },
      );
      await event(tx, a, "safety.hold_resolved", h.id, resolution);
      await notifyUser(tx, a, {
        userId: h.owner_user_id,
        category: "safety",
        dedupeKey: `training-hold-resolution:${h.id}`,
        title: "Your trainer reviewed the training hold",
        body:
          b.action === "resume"
            ? "Your trainer has resumed your session. Read their instructions in your coaching conversation before continuing."
            : "Your trainer has ended the paused session. Read their instructions in your coaching conversation before your next workout.",
        href: "/app/chat",
      });
      return { ok: true, action: b.action };
    });
  });
  app.post("/api/v1/workouts/start", async (req) => {
    const a = identity(req),
      b = z
        .object({ programId: id, plannedSessionId: id.optional() })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lockTraining(tx, a);
      await activeMembership(tx, a);
      await assertTrainingOpen(tx, a.userId);
      const p = await record(tx, b.programId, "program");
      if (
        p.owner_user_id !== a.userId ||
        !["assigned", "template"].includes(p.status)
      )
        throw fail(
          403,
          "PROGRAM_UNAVAILABLE",
          "Choose a program assigned to you",
        );
      const [existing] = await tx.query(
        "SELECT * FROM records WHERE kind='workout' AND owner_user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1",
        [a.userId],
      );
      if (existing) {
        if (
          existing.data.programId === p.id &&
          (!b.plannedSessionId ||
            existing.data.plannedSessionId === b.plannedSessionId)
        )
          return existing;
        throw fail(
          409,
          "WORKOUT_ACTIVE",
          "Finish or abandon your current workout before starting another",
        );
      }
      let planned: any;
      if (b.plannedSessionId) {
        planned = await record(tx, b.plannedSessionId, "planned_session");
        if (
          planned.owner_user_id !== a.userId ||
          planned.status !== "planned" ||
          planned.data.programId !== p.id
        )
          throw fail(
            409,
            "SESSION_CHANGED",
            "This planned session is unavailable",
          );
      }
      const r = await putRecord(
        tx,
        a,
        "workout",
        {
          programId: p.id,
          programVersion: p.version,
          program: planned?.data.program ?? p.data,
          plannedSessionId: planned?.id ?? null,
          startedAt: new Date().toISOString(),
        },
        { status: "active" },
      );
      if (planned)
        await tx.query(
          "UPDATE records SET status='started',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1",
          [planned.id, JSON.stringify({ workoutId: r.id })],
        );
      await event(tx, a, "workout.started", r.id);
      return r;
    });
  });
  app.post("/api/v1/workouts/:id/sets", async (req) => {
    const a = identity(req),
      b = setSchema
        .extend({ notes: z.string().max(1000).optional() })
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lockTraining(tx, a);
      const [prior] = await tx.query(
        "SELECT id,workout_id,data=$3::jsonb AS matches FROM workout_events WHERE user_id=$1 AND event_key=$2",
        [a.userId, b.eventKey, JSON.stringify(b)],
      );
      if (prior) {
        if (prior.workout_id !== (req.params as any).id || !prior.matches)
          throw fail(
            409,
            "INTENT_CONFLICT",
            "This event key was already used with different set details",
          );
        return { id: prior.id, duplicate: true };
      }
      await activeMembership(tx, a);
      await assertTrainingOpen(tx, a.userId);
      const w = await record(tx, (req.params as any).id, "workout");
      if (w.owner_user_id !== a.userId || w.status !== "active")
        throw fail(
          409,
          "WORKOUT_STATE",
          "This workout is not open for logging",
        );
      const exercise = w.data.program.exercises.find(
        (ex: any) => ex.name === b.exercise,
      );
      if (!exercise || b.set > exercise.sets)
        throw fail(
          400,
          "SET_NOT_IN_PROGRAM",
          "This set is outside the assigned workout",
        );
      const [logged] = await tx.query(
        "SELECT id FROM workout_events WHERE workout_id=$1 AND user_id=$2 AND data->>'exercise'=$3 AND (data->>'set')::int=$4",
        [w.id, a.userId, b.exercise, b.set],
      );
      if (logged)
        throw fail(
          409,
          "SET_ALREADY_LOGGED",
          "This set is already logged; use a correction to change it",
        );
      const [r] = await tx.query(
        "INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          randomUUID(),
          a.tenantId,
          a.userId,
          w.id,
          b.eventKey,
          JSON.stringify(b),
        ],
      );
      await event(tx, a, "workout.set_logged", r.id, { workoutId: w.id });
      if (b.notes && safetySignal(b.notes)) {
        await openTrainingHold(tx, a, a.userId, b.notes, w.id);
        return { ...r, trainingHeld: true };
      }
      return r;
    });
  });
  app.post("/api/v1/workouts/:id/finish", async (req) => {
    const a = identity(req);
    return db.tenant(a, async (tx) => {
      await lockTraining(tx, a);
      const w = await record(tx, (req.params as any).id, "workout");
      if (w.owner_user_id !== a.userId)
        throw fail(403, "OWNER_REQUIRED", "Workout ownership required");
      if (w.status === "completed") return w;
      await activeMembership(tx, a);
      await assertTrainingOpen(tx, a.userId);
      if (w.status !== "active")
        throw fail(409, "WORKOUT_STATE", "This workout is not active");
      await tx.query(
        "UPDATE records SET status='completed',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [w.id, JSON.stringify({ completedAt: new Date().toISOString() })],
      );
      if (w.data.plannedSessionId)
        await tx.query(
          "UPDATE records SET status='completed',version=version+1,updated_at=now() WHERE id=$1 AND kind='planned_session'",
          [w.data.plannedSessionId],
        );
      await event(tx, a, "workout.completed", w.id);
      return { ok: true };
    });
  });
  app.post("/api/v1/workouts/:id/abandon", async (req) => {
    const a = identity(req),
      b = z
        .object({ note: z.string().trim().min(3).max(2000) })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lockTraining(tx, a);
      const w = await record(tx, (req.params as any).id, "workout");
      if (w.owner_user_id !== a.userId)
        throw fail(403, "OWNER_REQUIRED", "Workout ownership required");
      await assertTrainingOpen(tx, a.userId);
      if (w.status !== "active")
        throw fail(
          409,
          "WORKOUT_STATE",
          "Only an active session can be abandoned here",
        );
      await tx.query(
        "UPDATE records SET status='abandoned',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [
          w.id,
          JSON.stringify({
            abandonedAt: new Date().toISOString(),
            abandonNote: b.note,
          }),
        ],
      );
      if (w.data.plannedSessionId)
        await tx.query(
          "UPDATE records SET status='abandoned',version=version+1,updated_at=now() WHERE id=$1 AND kind='planned_session'",
          [w.data.plannedSessionId],
        );
      await event(tx, a, "workout.abandoned", w.id);
      return { ok: true };
    });
  });
  app.post("/api/v1/workouts/:id/pain", async (req) => {
    const a = identity(req),
      b = z
        .object({ description: z.string().trim().min(3).max(2000) })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lockTraining(tx, a);
      const w = await record(tx, (req.params as any).id, "workout");
      if (w.owner_user_id !== a.userId)
        throw fail(403, "OWNER_REQUIRED", "Workout ownership required");
      if (!["active", "safety_hold"].includes(w.status))
        throw fail(
          409,
          "WORKOUT_STATE",
          "This session has already ended; send your trainer a message about new symptoms",
        );
      const hold = await openTrainingHold(tx, a, a.userId, b.description, w.id);
      return {
        holdId: hold.id,
        message:
          "Pause training. This report is in your trainer's attention list. Seek urgent local medical help if your symptoms are severe or urgent.",
      };
    });
  });
  app.post("/api/v1/takeover", async (req) => {
    const a = trainer(req),
      b = z
        .object({ subscriberId: id, active: z.boolean() })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lockTraining(tx, a, b.subscriberId);
      await subscriber(tx, a, b.subscriberId);
      await tx.query(
        "UPDATE records SET status='ended',updated_at=now(),version=version+1 WHERE kind='takeover' AND owner_user_id=$1 AND status='active'",
        [b.subscriberId],
      );
      if (b.active)
        await putRecord(
          tx,
          a,
          "takeover",
          { trainerId: a.userId },
          { ownerId: b.subscriberId, status: "active" },
        );
      await event(tx, a, "coaching.takeover_changed", b.subscriberId, {
        active: b.active,
      });
      return { ok: true };
    });
  });
  app.post("/api/v1/exceptions/:id/resolve", async (req) => {
    const a = trainer(req),
      b = z
        .object({
          note: z.string().trim().min(3).max(4000),
          approveDecision: z.boolean().default(false),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const e = await record(tx, (req.params as any).id, "exception");
      await lockTraining(tx, a, e.owner_user_id);
      const current = await record(tx, e.id, "exception");
      if (current.status === "resolved") return current;
      if (e.data.category === "safety") {
        const [hold] = await tx.query(
          "SELECT id FROM records WHERE kind='training_hold' AND owner_user_id=$1 AND status='active'",
          [e.owner_user_id],
        );
        if (hold)
          throw fail(
            409,
            "EXPLICIT_HOLD_REVIEW",
            "Use the training hold controls to explicitly resume or abandon this session",
          );
      }
      if (b.approveDecision && e.data.decisionId) {
        const d = await record(tx, e.data.decisionId, "decision");
        if (d.owner_user_id !== e.owner_user_id)
          throw fail(
            409,
            "REVIEW_STALE",
            "This decision belongs to a different client",
          );
        await deliverReviewedCoachingDecision(tx, a, d);
      }
      await tx.query(
        "UPDATE records SET status='resolved',version=version+1,data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [e.id, JSON.stringify({ resolution: b.note, resolvedBy: a.userId })],
      );
      await event(tx, a, "exception.resolved", e.id);
      return { ok: true };
    });
  });
  app.post("/api/v1/coaching/ask", async (req) => {
    const a = identity(req),
      b = z
        .object({ message: z.string().trim().min(1).max(4000) })
        .strict()
        .parse(req.body);
    if (a.role !== "subscriber")
      throw fail(
        403,
        "SUBSCRIBER_REQUIRED",
        "Use the coach evaluation workspace to test your Brain",
      );
    const material = await db.tenant({ ...a, role: "staff" }, async (tx) => {
      await lockTraining(tx, a);
      await activeMembership(tx, a);
      await putRecord(
        tx,
        a,
        "message",
        { text: b.message, author: "subscriber", subscriberId: a.userId },
        { status: "sent" },
      );
      const [takeover] = await tx.query(
        "SELECT id FROM records WHERE kind='takeover' AND owner_user_id=$1 AND status='active'",
        [a.userId],
      );
      const [hold] = await tx.query(
        "SELECT id FROM records WHERE kind='training_hold' AND owner_user_id=$1 AND status='active'",
        [a.userId],
      );
      if (safetySignal(b.message))
        await openTrainingHold(tx, a, a.userId, b.message);
      if (safetySignal(b.message) || hold || takeover) {
        if (!safetySignal(b.message) && !hold)
          await putRecord(
            tx,
            a,
            "exception",
            {
              category: "human_review",
              description: b.message,
              subscriberId: a.userId,
            },
            { status: "open" },
          );
        const response = await putRecord(
          tx,
          a,
          "message",
          {
            text:
              safetySignal(b.message) || hold
                ? "Training is paused for your trainer's review. Seek urgent local medical help for severe or urgent symptoms."
                : "Your trainer is handling this conversation personally. Your message is ready for their review.",
            author: "system",
            subscriberId: a.userId,
          },
          { status: "sent" },
        );
        return { response };
      }
      const [consent] = await tx.query(
        "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC,id DESC LIMIT 1",
        [a.userId],
      );
      if (!consent?.granted)
        throw fail(
          409,
          "COACHING_CONSENT_REQUIRED",
          "Digital coaching permission is not active. You can message your trainer personally.",
        );
      const [release] = await tx.query(
        "SELECT * FROM records WHERE kind='brain_release' AND status='published' ORDER BY created_at DESC LIMIT 1",
      );
      if (!release)
        throw fail(
          409,
          "BRAIN_NOT_READY",
          "Your trainer is preparing the digital coaching release",
        );
      const [intake] = await tx.query(
        "SELECT * FROM records WHERE kind='intake' AND owner_user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [a.userId],
      );
      if (!intake)
        throw fail(
          409,
          "INTAKE_REQUIRED",
          "Complete your coaching profile before using digital coaching",
        );
      const twin = await currentClientTwin(tx, a, a.userId);
      return { release, intake, twin };
    });
    if (material.response) return material.response;
    const qualified = await tryQualifiedCoaching(db, a, b.message, {
      release: material.release!,
      twin: material.twin!,
    });
    if (qualified) return qualified;
    const evidence = [
      { id: material.twin!.id, data: material.twin!.data.coaching },
      { id: material.intake!.id, data: material.intake!.data },
      ...material.release!.data.rules,
    ];
    const generated = await modelDecision(
      "coaching",
      b.message,
      evidence,
      modelAccounting(db, a, "coaching"),
    );
    return db.tenant({ ...a, role: "staff" }, async (tx) => {
      await lockTraining(tx, a);
      await activeMembership(tx, a);
      await assertTrainingOpen(tx, a.userId);
      const [consent] = await tx.query(
        "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC,id DESC LIMIT 1",
        [a.userId],
      );
      const [release] = await tx.query(
        "SELECT id FROM records WHERE kind='brain_release' AND status='published' ORDER BY created_at DESC LIMIT 1",
      );
      if (!consent?.granted || release?.id !== material.release!.id)
        throw fail(
          409,
          "COACHING_CHANGED",
          "Your coaching permissions or release changed during generation; the response was withheld",
        );
      if ((await currentClientTwin(tx, a, a.userId)).id !== material.twin!.id)
        throw fail(
          409,
          "COACHING_CHANGED",
          "Your profile or training record changed during generation; the response was withheld",
        );
      const [takeover] = await tx.query(
        "SELECT id FROM records WHERE kind='takeover' AND owner_user_id=$1 AND status='active'",
        [a.userId],
      );
      const d = await putRecord(
        tx,
        a,
        "decision",
        {
          ...generated.decision,
          request: b.message,
          brainVersionId: material.release!.id,
          clientSnapshotId: material.twin!.id,
        },
        { status: "pending_review" },
      );
      await putRecord(
        tx,
        a,
        "exception",
        {
          category: takeover ? "human_review" : "decision_review",
          decisionId: d.id,
          subscriberId: a.userId,
          description: generated.decision.reason,
        },
        { status: "open" },
      );
      await event(tx, a, "coaching.review_required", d.id);
      return {
        pendingReview: true,
        message:
          "Your digital coach has prepared a response for your trainer to review.",
      };
    });
  });
}
