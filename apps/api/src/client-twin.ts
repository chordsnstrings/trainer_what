import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { putRecord, type Actor, type Database, type Tx } from "@trainer/db";
import { clientTwin } from "../../../packages/domain/src/client-twin.ts";
import { nutritionTwin } from "./nutrition.ts";
export async function currentClientTwin(tx: Tx, a: Actor, userId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":twin:" + userId,
  ]);
  const records = await tx.query(
    "SELECT * FROM records WHERE owner_user_id=$1 AND kind IN ('intake','workout','wearable') ORDER BY created_at DESC LIMIT 1000",
    [userId],
  );
  const sets = await tx.query(
    "SELECT * FROM workout_events WHERE user_id=$1 AND created_at>=now()-interval '28 days' ORDER BY created_at LIMIT 5000",
    [userId],
  );
  const consents = await tx.query(
    "SELECT DISTINCT ON(document_type) document_type,granted FROM consent_records WHERE user_id=$1 AND document_type IN ('coaching','wearable') ORDER BY document_type,created_at DESC,id DESC",
    [userId],
  );
  const body = clientTwin({
    records: records as any,
    sets,
    coachingConsent:
      consents.find((c) => c.document_type === "coaching")?.granted ?? null,
    wearableConsent:
      consents.find((c) => c.document_type === "wearable")?.granted ?? null,
  });
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
      partialInput: records.length === 1000 || sets.length === 5000,
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
