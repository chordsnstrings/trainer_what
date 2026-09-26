import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { putRecord, type Actor, type Database, type Tx } from "@trainer/db";
import { clientTwin } from "../../../packages/domain/src/client-twin.ts";
import { nutritionTwin } from "./nutrition.ts";
import { effectiveWorkoutSets } from "../../../packages/domain/src/coaching-completion.ts";
import { addTrainingDays } from "../../../packages/domain/src/coaching-completion.ts";
export async function currentClientTwin(tx: Tx, a: Actor, userId: string) {
  const now = new Date(),
    utcDate = now.toISOString().slice(0, 10);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":twin:" + userId,
  ]);
  // Current facts must survive any amount of newer history. Active holds use the
  // same predicate as the runtime safety gate and are never a recent-history sample.
  const intake = await tx.query(
    "SELECT * FROM records WHERE owner_user_id=$1 AND kind='intake' ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  const holds = await tx.query(
    "SELECT * FROM records WHERE owner_user_id=$1 AND ((kind='training_hold' AND status='active') OR (kind='workout' AND status='safety_hold')) ORDER BY created_at,id",
    [userId],
  );
  const workoutRows = await tx.query(
    "SELECT * FROM records WHERE owner_user_id=$1 AND kind='workout' AND created_at>=now()-interval '28 days' ORDER BY created_at DESC,id DESC LIMIT 1001",
    [userId],
  );
  const wearableRows = await tx.query(
    "SELECT * FROM records WHERE owner_user_id=$1 AND kind='wearable' ORDER BY created_at DESC,id DESC LIMIT 1001",
    [userId],
  );
  const setRows = await tx.query(
    "SELECT * FROM workout_events WHERE user_id=$1 AND created_at>=now()-interval '28 days' ORDER BY created_at DESC,id DESC LIMIT 5001",
    [userId],
  );
  const workouts = workoutRows.slice(0, 1000),
    wearables = wearableRows.slice(0, 1000),
    sets = setRows.slice(0, 5000).reverse();
  const corrections = sets.length
    ? await tx.query(
        "SELECT DISTINCT ON (data->>'eventId') * FROM records WHERE owner_user_id=$1 AND kind='workout_correction' AND data->>'eventId'=ANY($2::text[]) ORDER BY data->>'eventId',coalesce((data->>'revision')::int,0) DESC,created_at DESC,id DESC",
        [userId, sets.map((set) => set.id)],
      )
    : [];
  // One calendar-day margin covers all timezone offsets; the domain applies
  // each session's exact local window, without treating a date as a UTC instant.
  const plannedRows = await tx.query(
    "SELECT * FROM records WHERE owner_user_id=$1 AND kind='planned_session' AND (data->>'date' BETWEEN $2 AND $3 OR data->>'date' IS NULL) ORDER BY data->>'date' DESC,id LIMIT 1001",
    [userId, addTrainingDays(utcDate, -28), addTrainingDays(utcDate, 29)],
  );
  const plannedSessions = plannedRows.slice(0, 1000);
  const [program] = await tx.query(
    "SELECT * FROM records WHERE owner_user_id=$1 AND kind='program' AND status='assigned' ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId],
  );
  const lineage = program
    ? await tx.query(
        "WITH RECURSIVE lineage AS (SELECT r.*,ARRAY[r.id] AS path,1 AS depth FROM records r WHERE r.id=$1 AND r.owner_user_id=$2 AND r.kind='program' UNION ALL SELECT p.*,l.path||p.id,l.depth+1 FROM records p JOIN lineage l ON p.id::text=l.data->>'previousProgramId' WHERE p.owner_user_id=$2 AND p.kind='program' AND l.depth<64 AND NOT p.id=ANY(l.path)) SELECT * FROM lineage ORDER BY depth",
        [program.id, userId],
      )
    : [];
  const blockRows = program
    ? await tx.query(
        "SELECT * FROM records WHERE owner_user_id=$1 AND kind='planned_session' AND data->>'programId'=ANY($2::text[]) ORDER BY data->>'date',id LIMIT 183",
        [userId, lineage.map((row) => row.id)],
      )
    : [];
  const blockSessions = blockRows.slice(0, 182);
  const selectedPlans = [
    ...new Map(
      [...plannedSessions, ...blockSessions].map((row) => [row.id, row]),
    ).values(),
  ];
  const linkedRows = selectedPlans.length
    ? await tx.query(
        "SELECT id,kind,status,created_at,updated_at,jsonb_build_object('programId',data->'programId','plannedSessionId',data->'plannedSessionId','completedAt',data->'completedAt') AS data FROM records WHERE owner_user_id=$1 AND kind='workout' AND (id::text=ANY($2::text[]) OR data->>'plannedSessionId'=ANY($3::text[])) ORDER BY created_at DESC,id LIMIT 2401",
        [
          userId,
          selectedPlans.flatMap((row) =>
            typeof row.data.workoutId === "string" ? [row.data.workoutId] : [],
          ),
          selectedPlans.map((row) => row.id),
        ],
      )
    : [];
  const expectedSessions =
    program &&
    Number.isInteger(program.data.weeks) &&
    program.data.weeks >= 1 &&
    program.data.weeks <= 26 &&
    Number.isInteger(program.data.daysPerWeek) &&
    program.data.daysPerWeek >= 1 &&
    program.data.daysPerWeek <= 7
      ? program.data.weeks * program.data.daysPerWeek
      : null;
  const consents = await tx.query(
    "SELECT DISTINCT ON(document_type) document_type,granted FROM consent_records WHERE user_id=$1 AND document_type IN ('coaching','wearable') ORDER BY document_type,created_at DESC,id DESC",
    [userId],
  );
  const calculated = clientTwin({
    records: [...intake, ...workouts, ...wearables] as any,
    sets: effectiveWorkoutSets(sets, corrections),
    coachingConsent:
      consents.find((c) => c.document_type === "coaching")?.granted ?? null,
    wearableConsent:
      consents.find((c) => c.document_type === "wearable")?.granted ?? null,
    now,
    schedule: {
      plannedSessions: plannedSessions as any,
      linkedWorkouts: linkedRows.slice(0, 2400) as any,
      partial: plannedRows.length > 1000,
      linkedWorkoutsPartial: linkedRows.length > 2400,
      currentBlock: program
        ? {
            program: program as any,
            lineage: lineage as any,
            sessions: blockSessions as any,
            expectedSessions,
            complete:
              !lineage.at(-1)?.data.previousProgramId &&
              blockRows.length <= 182 &&
              expectedSessions !== null &&
              blockRows.length === expectedSessions,
          }
        : null,
    },
  });
  const body = {
    ...calculated,
    calculationVersion: "client-twin-v3",
    coaching: {
      ...calculated.coaching,
      safetyHolds: holds.map((hold) => hold.id),
      safetyHoldSources: holds.map((hold) => ({
        kind: hold.kind,
        status: hold.status,
        observedAt: new Date(hold.updated_at ?? hold.created_at).toISOString(),
        sourceRecordIds: [hold.id],
      })),
    },
    inputCoverage: {
      profileSourceRecordIds: intake.map((r) => r.id),
      activeHolds: { included: holds.length, complete: true },
      workouts: {
        included: workouts.length,
        limit: 1000,
        partial: workoutRows.length > 1000,
      },
      wearables: {
        included: wearables.length,
        limit: 1000,
        partial: wearableRows.length > 1000,
      },
      sets: {
        included: sets.length,
        limit: 5000,
        partial: setRows.length > 5000,
      },
      corrections: {
        included: corrections.length,
        selection: "Latest revision for each included set",
      },
      plannedSessions: {
        included: plannedSessions.length,
        limit: 1000,
        partial: plannedRows.length > 1000,
      },
      blockSessions: {
        included: blockSessions.length,
        limit: 182,
        partial:
          !!calculated.coaching.adherence?.currentBlock &&
          !calculated.coaching.adherence.currentBlock.complete,
      },
      linkedWorkouts: {
        included: Math.min(linkedRows.length, 2400),
        limit: 2400,
        partial: linkedRows.length > 2400,
      },
    },
  };
  const nutrition = await nutritionTwin(tx, a, userId);
  // Derived wearable data is intentionally excluded from the model-facing coaching object.
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        ...body,
        nutrition: { ...nutrition, calculatedAt: undefined },
        calculatedAt: undefined,
        coaching: {
          ...body.coaching,
          training: {
            ...body.coaching.training,
            windowStart: undefined,
            windowEnd: undefined,
          },
        },
      }),
    )
    .digest("hex");
  const [existing] = await tx.query(
    "SELECT * FROM records WHERE kind='twin_snapshot' AND owner_user_id=$1 AND data->>'digest'=$2",
    [userId, digest],
  );
  if (existing) return existing;
  return putRecord(
    tx,
    a,
    "twin_snapshot",
    {
      ...body,
      nutrition,
      digest,
      partialInput:
        workoutRows.length > 1000 ||
        wearableRows.length > 1000 ||
        setRows.length > 5000 ||
        !!calculated.coaching.adherence?.partial ||
        (!!calculated.coaching.adherence?.currentBlock &&
          !calculated.coaching.adherence.currentBlock.complete),
    },
    { ownerId: userId, status: "current" },
  );
}
export function clientTwinRoutes(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => Actor,
) {
  app.get("/api/v1/clients/:userId/twin", async (req) => {
    const a = identity(req),
      userId = z
        .string()
        .uuid()
        .parse((req.params as any).userId);
    if (
      !["owner", "staff", "subscriber"].includes(a.role) ||
      (a.role === "subscriber" && a.userId !== userId)
    )
      throw Object.assign(new Error("Coaching profile access denied"), {
        statusCode: 403,
      });
    return db.tenant(a, async (tx) => {
      const [member] = await tx.query(
        "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
        [a.tenantId, userId],
      );
      if (!member)
        throw Object.assign(new Error("Subscriber unavailable"), {
          statusCode: 404,
        });
      return currentClientTwin(tx, a, userId);
    });
  });
}
