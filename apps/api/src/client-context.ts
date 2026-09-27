import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import {
  clientContextSchema,
  emptyClientContext,
  type ClientContextView,
} from "../../../packages/domain/src/client-context.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";

const fail = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });
const updateSchema = z
  .object({
    version: z.number().int().nonnegative(),
    data: clientContextSchema,
  })
  .strict();

async function authorize(tx: Tx, actor: Actor, userId: string) {
  // Serialize erasure/membership changes and the same per-client consent gate.
  await workspaceLock(tx, actor.tenantId);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    actor.tenantId + ":training:" + userId,
  ]);
  const [current] = await tx.query(
    "SELECT training_actor_is_current($1,$2,$3) AS current",
    [actor.tenantId, actor.userId, actor.role],
  );
  if (!current?.current)
    throw fail(403, "Your workspace membership changed; sign in again");
  const [member] = await tx.query(
    "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
    [actor.tenantId, userId],
  );
  if (!member) throw fail(404, "Client unavailable");
  if (actor.role !== "subscriber") {
    const [consent] = await tx.query(
      "SELECT granted FROM consent_records WHERE user_id=$1 AND document_type='coaching' ORDER BY created_at DESC,id DESC LIMIT 1",
      [userId],
    );
    if (!consent?.granted)
      throw fail(
        403,
        "Current coaching consent is required to view these preferences",
      );
  }
}

function view(
  record: Record<string, any> | undefined,
  userId: string,
): ClientContextView {
  return {
    id: record?.id ?? null,
    version: record?.version ?? 0,
    data: record
      ? clientContextSchema.parse(record.data)
      : emptyClientContext(),
    provenance: {
      source: "self_reported",
      userId,
      updatedAt: record ? new Date(record.updated_at).toISOString() : null,
    },
    allowedUses: ["render"],
  };
}

export function clientContextRoutes(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Actor,
) {
  const path = "/api/v1/clients/:userId/context";
  const target = (req: FastifyRequest, write = false) => {
    const actor = identity(req),
      userId = z
        .string()
        .uuid()
        .parse((req.params as { userId: string }).userId);
    if (
      !["owner", "staff", "subscriber"].includes(actor.role) ||
      (actor.role === "subscriber" && actor.userId !== userId) ||
      (write && actor.role !== "subscriber")
    ) {
      throw fail(
        403,
        write
          ? "Only the client can edit these preferences"
          : "Client preferences access denied",
      );
    }
    return { actor, userId };
  };
  app.get(path, async (req, reply) => {
    const { actor, userId } = target(req);
    reply.header("Cache-Control", "private, no-store");
    return db.tenant(actor, async (tx) => {
      await authorize(tx, actor, userId);
      const [record] = await tx.query(
        "SELECT * FROM records WHERE owner_user_id=$1 AND kind='client_context'",
        [userId],
      );
      return view(record, userId);
    });
  });
  app.put(path, async (req, reply) => {
    const { actor, userId } = target(req, true),
      body = updateSchema.parse(req.body);
    reply.header("Cache-Control", "private, no-store");
    return db.tenant(actor, async (tx) => {
      await authorize(tx, actor, userId);
      const [current] = await tx.query(
        "SELECT * FROM records WHERE owner_user_id=$1 AND kind='client_context' FOR UPDATE",
        [userId],
      );
      if ((current?.version ?? 0) !== body.version)
        throw fail(
          409,
          "These preferences changed in another session. Reload the saved preferences before editing again.",
        );
      const record = current
        ? (
            await tx.query(
              "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 AND version=$3 RETURNING *",
              [current.id, JSON.stringify(body.data), body.version],
            )
          )[0]
        : await putRecord(tx, actor, "client_context", body.data, {
            ownerId: userId,
            status: "current",
          });
      if (!record)
        throw fail(409, "These preferences changed. Reload and try again.");
      // Only a reference and revision enter the audit trail, never personal notes.
      await event(tx, actor, "client_context.updated", record.id, {
        version: record.version,
      });
      return view(record, userId);
    });
  });
}
