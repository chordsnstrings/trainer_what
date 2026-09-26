import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { putRecord, type Actor, type Database, type Tx } from "@trainer/db";
import { clientTwin } from "../../../packages/domain/src/client-twin.ts";
import { nutritionTwin } from "./nutrition.ts";
import { effectiveWorkoutSets } from "../../../packages/domain/src/coaching-completion.ts";
export async function currentClientTwin(tx: Tx, a: Actor, userId: string) {
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
  });
  const body = {
    ...calculated,
    calculationVersion: "client-twin-v2",
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
        setRows.length > 5000,
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
