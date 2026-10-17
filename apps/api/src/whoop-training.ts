import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { wearableContract } from "../../../packages/providers/src/integrations.ts";
import {
  WHOOP_TRAINING_VERSION,
  whoopTrainingPolicySchema,
  whoopRecovery,
  whoopDate,
  reduceWhoopWorkout,
} from "../../../packages/domain/src/whoop-training.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const actor = (req: FastifyRequest, trainer = false) => {
  if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in.");
  if (
    !(trainer ? ["owner", "staff"] : ["owner", "staff", "subscriber"]).includes(
      req.identity.role,
    )
  )
    throw fail(403, "COACHING_ACCESS", "Coaching access required.");
  return req.identity;
};
export function whoopTrainingAvailable() {
  if (runtimeConfig().WHOOP_TRAINING_APPROVED !== "true") return false;
  try {
    const c = wearableContract("whoop");
    return (
      c.scopes.includes("read:recovery") && c.scopes.includes("read:sleep")
    );
  } catch {
    return false;
  }
}
async function policy(tx: Tx) {
  const [row] = await tx.query("SELECT whoop_training_policy() AS value");
  const value = row?.value;
  return {
    id: value?.id ?? null,
    version: Number(value?.version ?? 0),
    values: whoopTrainingPolicySchema.parse(value?.values ?? {}),
  };
}
/** Lock order: training (when starting), policy, then the existing per-member integration lock. */
async function lock(tx: Tx, a: Actor, writePolicy = false) {
  await tx.query(
    `SELECT pg_advisory_xact_lock${writePolicy ? "" : "_shared"}(hashtext($1))`,
    [a.tenantId + ":whoop-training"],
  );
  if (!writePolicy)
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":integrations:" + a.userId,
    ]);
}
export async function whoopTrainingState(
  tx: Tx,
  a: Actor,
  now = new Date(),
  timezone?: string,
) {
  const p = await policy(tx);
  const [preference] = await tx.query(
    "SELECT id,version,data FROM records WHERE kind='preferences' AND owner_user_id=$1 AND data->>'key'='whoop_training' ORDER BY updated_at DESC,id DESC LIMIT 1",
    [a.userId],
  );
  const [connection] = await tx.query(
    "SELECT id,status,last_synced_at FROM integration_connections WHERE user_id=$1 AND provider='whoop'",
    [a.userId],
  );
  const [consent] = await tx.query(
    "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='wearable:whoop' ORDER BY created_at DESC,id DESC LIMIT 1",
    [a.userId],
  );
  const [wearablePolicy] = await tx.query(
    "SELECT coach_wearable_policy() AS value",
  );
  const [tz] = await tx.query(
    "SELECT data->>'timezone' AS value FROM notification_preferences WHERE user_id=$1",
    [a.userId],
  );
  let zone = timezone ?? tz?.value ?? "Asia/Dubai";
  try {
    whoopDate(now, zone);
  } catch {
    zone = "Asia/Dubai";
  }
  const rows =
    connection && consent?.granted
      ? await tx.query(
          "SELECT id,version,status,data FROM records WHERE kind='wearable' AND owner_user_id=$1 AND status='imported' AND data->>'source'='whoop' ORDER BY (data->'observations'->0->>'measuredAt') DESC,id DESC LIMIT 400",
          [a.userId],
        )
      : [];
  const recovery = whoopRecovery(
    rows,
    connection?.last_synced_at
      ? new Date(connection.last_synced_at).toISOString()
      : null,
    zone,
    now,
  );
  const optedIn =
    preference?.data?.enabled === true &&
    preference.data.consentVersion === WHOOP_TRAINING_VERSION;
  const available = whoopTrainingAvailable();
  const connected =
    !!connection &&
    ["active", "syncing"].includes(connection.status) &&
    consent?.granted === true;
  const permitted =
    available &&
    connected &&
    optedIn &&
    p.values.enabled &&
    wearablePolicy?.value !== "none";
  const rule =
    permitted &&
    recovery.status === "ready" &&
    recovery.band &&
    recovery.band !== "high"
      ? p.values[recovery.band]
      : null;
  return {
    connected,
    hasConnection: !!connection,
    available,
    optedIn,
    preferenceVersion: Number(preference?.version ?? 0),
    policy: p,
    recovery,
    rule,
    timezone: zone,
    reason: !connected
      ? "connection"
      : !available
        ? "platform"
        : wearablePolicy?.value === "none" || !p.values.enabled
          ? "trainer"
          : !optedIn
            ? "permission"
            : recovery.status !== "ready"
              ? recovery.status
              : "ready",
  };
}
export async function prepareWhoopWorkout(
  tx: Tx,
  a: Actor,
  program: any,
  planned?: any,
) {
  if (!whoopTrainingAvailable()) return { program };
  await lock(tx, a);
  const now = new Date(),
    state = await whoopTrainingState(tx, a, now, planned?.data?.timezone);
  if (
    !state.rule ||
    (planned?.data?.date &&
      planned.data.date !== whoopDate(now, state.timezone))
  )
    return { program };
  const changed = reduceWhoopWorkout(program, state.rule);
  if (!changed.changes.length) return { program };
  return {
    program: changed.program,
    originalProgram: program,
    recoveryAdjustment: {
      version: WHOOP_TRAINING_VERSION,
      appliedAt: now.toISOString(),
      policyId: state.policy.id,
      policyVersion: state.policy.version,
      consentVersion: WHOOP_TRAINING_VERSION,
      sourceId: state.recovery.sourceId,
      sourceVersion: state.recovery.sourceVersion,
      measuredAt: state.recovery.measuredAt,
      band: state.recovery.band,
      rule: state.rule,
      changes: changed.changes,
    },
  };
}
export function registerWhoopTraining(app: FastifyInstance, db: Database) {
  app.get("/api/v1/brain/whoop-training", async (req) => {
    const a = actor(req, true);
    return db.tenant(a, async (tx) => ({
      ...(await policy(tx)),
      available: whoopTrainingAvailable(),
    }));
  });
  app.put("/api/v1/brain/whoop-training", async (req) => {
    const a = actor(req, true),
      body = z
        .object({
          version: z.number().int().min(0),
          values: whoopTrainingPolicySchema,
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lock(tx, a, true);
      const p = await policy(tx);
      if (p.version !== body.version)
        throw fail(
          409,
          "POLICY_CHANGED",
          "These recovery rules changed. Reload before saving.",
        );
      if (p.id)
        await tx.query(
          "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1",
          [p.id, JSON.stringify(body.values)],
        );
      else
        await putRecord(tx, a, "whoop_training_policy", body.values, {
          status: "published",
        });
      await event(tx, a, "whoop.training_policy_saved", p.id ?? undefined);
      return { ...(await policy(tx)), available: whoopTrainingAvailable() };
    });
  });
  app.get("/api/v1/integrations/whoop/training", async (req) => {
    const a = actor(req);
    return db.tenant(a, (tx) => whoopTrainingState(tx, a));
  });
  app.put("/api/v1/integrations/whoop/training", async (req) => {
    const a = actor(req),
      body = z
        .object({
          enabled: z.boolean(),
          version: z.number().int().min(0),
          consentVersion: z.literal(WHOOP_TRAINING_VERSION),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      await lock(tx, a);
      const state = await whoopTrainingState(tx, a);
      if (state.preferenceVersion !== body.version)
        throw fail(
          409,
          "PERMISSION_CHANGED",
          "Your recovery preference changed. Reload before saving.",
        );
      if (body.enabled && (!state.available || !state.connected))
        throw fail(
          409,
          "WHOOP_NOT_READY",
          "Connect WHOOP after the platform enables recovery adjustments.",
        );
      const data = {
        key: "whoop_training",
        enabled: body.enabled,
        consentVersion: body.consentVersion,
        confirmedAt: new Date().toISOString(),
      };
      const [prior] = await tx.query(
        "SELECT id FROM records WHERE kind='preferences' AND owner_user_id=$1 AND data->>'key'='whoop_training' ORDER BY updated_at DESC,id DESC LIMIT 1",
        [a.userId],
      );
      if (prior)
        await tx.query(
          "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1",
          [prior.id, JSON.stringify(data)],
        );
      else await putRecord(tx, a, "preferences", data, { status: "saved" });
      await event(tx, a, "whoop.training_permission_changed", prior?.id, {
        enabled: body.enabled,
        consentVersion: body.consentVersion,
      });
      return whoopTrainingState(tx, a);
    });
  });
}
