import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Database, type Tx, event } from "@trainer/db";
import {
  pushAvailable,
  pushEndpoint,
} from "../../../packages/providers/src/push.ts";
import { tokenHash } from "./auth.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";
import { sealIntegrationSecret } from "./integrations-completion.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const maxDevices = 8;
const subscriptionInput = z
  .object({
    endpoint: z.string().min(1).max(4096),
    expirationTime: z
      .number()
      .int()
      .positive()
      .max(8640000000000000)
      .nullable(),
    publicKey: z.string().max(100),
    label: z.string().trim().min(1).max(60),
  })
  .strict();

async function subscriptionTransaction<T>(
  db: Database,
  req: FastifyRequest,
  a: Actor,
  fn: (tx: Tx, session: any) => Promise<T>,
) {
  return db.system(async (tx) => {
    await workspaceLock(tx, a.tenantId);
    const [session] = await tx.query(
      "SELECT s.session_id,s.expires_at FROM sessions s JOIN memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id JOIN tenants t ON t.id=s.tenant_id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.tenant_id=$3 AND s.expires_at>clock_timestamp() AND t.lifecycle_state='active' AND m.role=$4 FOR SHARE OF s",
      [tokenHash(req.cookies.session ?? ""), a.userId, a.tenantId, a.role],
    );
    if (!session) throw fail(401, "AUTH_REQUIRED", "Please sign in again.");
    await tx.query("SET LOCAL ROLE trainer_app");
    await tx.query(
      "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role',$3,true)",
      [a.tenantId, a.userId, a.role],
    );
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${a.tenantId}:push:${a.userId}`,
    ]);
    return fn(tx, session);
  });
}
export function registerPushNotifications(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Actor,
) {
  app.get("/api/v1/notifications/push/open", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    let a: Actor;
    try {
      a = identity(req);
    } catch {
      return reply.redirect("/login");
    }
    return reply.redirect(
      a.role === "subscriber" ? "/app/notifications" : "/trainer/notifications",
    );
  });
  app.get("/api/v1/notifications/push", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const a = identity(req),
      config = pushAvailable();
    const devices = await subscriptionTransaction(
      db,
      req,
      a,
      async (tx, session) => {
        await tx.query(
          "DELETE FROM push_subscriptions WHERE user_id=$1 AND expires_at<=clock_timestamp()",
          [a.userId],
        );
        return tx.query(
          'SELECT id,label,expires_at AS "expiresAt",session_id=$2 AS current FROM push_subscriptions WHERE user_id=$1 ORDER BY created_at DESC',
          [a.userId, session.session_id],
        );
      },
    );
    const configured =
      !!config &&
      Buffer.from(process.env.SECURITY_ENCRYPTION_KEY ?? "", "base64")
        .length === 32;
    return {
      configured,
      publicKey: configured ? config!.publicKey : null,
      devices,
      maxDevices,
    };
  });
  app.post("/api/v1/notifications/push", async (req) => {
    const a = identity(req),
      b = subscriptionInput.parse(req.body),
      config = pushAvailable();
    if (!config)
      throw fail(
        503,
        "PUSH_UNAVAILABLE",
        "Device notifications are not configured.",
      );
    if (b.publicKey !== config.publicKey)
      throw fail(
        409,
        "PUSH_KEY_CHANGED",
        "Notification settings changed. Reload and enable this device again.",
      );
    try {
      pushEndpoint(b.endpoint);
    } catch {
      throw fail(
        400,
        "PUSH_ENDPOINT",
        "This browser's push service is not supported.",
      );
    }
    if (b.expirationTime !== null && b.expirationTime <= Date.now())
      throw fail(
        400,
        "PUSH_EXPIRED",
        "This browser subscription expired. Enable notifications again.",
      );
    return subscriptionTransaction(db, req, a, async (tx, session) => {
      await tx.query(
        "DELETE FROM push_subscriptions WHERE user_id=$1 AND expires_at<=clock_timestamp()",
        [a.userId],
      );
      const [existing] = await tx.query(
        "SELECT id,endpoint_hash,vapid_key_id FROM push_subscriptions WHERE user_id=$1 AND session_id=$2",
        [a.userId, session.session_id],
      );
      const endpointHash = createHash("sha256")
          .update(b.endpoint)
          .digest("hex"),
        expiresAt = new Date(
          Math.min(
            new Date(session.expires_at).getTime(),
            b.expirationTime ?? Infinity,
          ),
        ).toISOString();
      if (
        existing?.endpoint_hash === endpointHash &&
        existing.vapid_key_id === config.keyId
      ) {
        await tx.query(
          "UPDATE push_subscriptions SET label=$2,expires_at=$3 WHERE id=$1",
          [existing.id, b.label, expiresAt],
        );
        return { id: existing.id, expiresAt };
      }
      if (existing)
        await tx.query("DELETE FROM push_subscriptions WHERE id=$1", [
          existing.id,
        ]);
      const [{ count }] = await tx.query(
        "SELECT count(*)::int AS count FROM push_subscriptions WHERE user_id=$1",
        [a.userId],
      );
      if (count >= maxDevices)
        throw fail(
          409,
          "PUSH_LIMIT",
          "Remove an older device before enabling another.",
        );
      const id = randomUUID(),
        encrypted = sealIntegrationSecret(
          `push:${a.tenantId}:${a.userId}:${id}`,
          b.endpoint,
        );
      const [saved] = await tx.query(
        "INSERT INTO push_subscriptions(id,tenant_id,user_id,session_id,endpoint_hash,encrypted_endpoint,vapid_key_id,label,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id",
        [
          id,
          a.tenantId,
          a.userId,
          session.session_id,
          endpointHash,
          encrypted,
          config.keyId,
          b.label,
          expiresAt,
        ],
      );
      if (!saved)
        throw fail(
          409,
          "PUSH_ALREADY_BOUND",
          "Remove this browser subscription and enable it again for this account.",
        );
      await event(tx, a, "notifications.push_enabled", id, {});
      return { id, expiresAt };
    });
  });
  app.delete("/api/v1/notifications/push/:id", async (req) => {
    const a = identity(req),
      id = z
        .string()
        .uuid()
        .parse((req.params as any).id);
    return subscriptionTransaction(db, req, a, async (tx) => {
      const [removed] = await tx.query(
        "DELETE FROM push_subscriptions WHERE id=$1 AND user_id=$2 RETURNING id",
        [id, a.userId],
      );
      if (removed) await event(tx, a, "notifications.push_disabled", id, {});
      return { ok: true };
    });
  });
}
