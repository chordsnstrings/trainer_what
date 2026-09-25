import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Database, event } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
export function privacyOperations(
  app: FastifyInstance,
  db: Database,
  identity: (
    r: FastifyRequest,
  ) => Actor & { platformRole: string; mfaAt?: string | null },
) {
  function operator(req: FastifyRequest) {
    const a = identity(req);
    if (a.platformRole !== "admin")
      throw fail(
        403,
        "PRIVACY_AUTHORITY",
        "A platform administrator must process privacy requests",
      );
    requireRecentMfa(a);
    return {
      ...a,
      tenantId: z
        .string()
        .uuid()
        .parse((req.params as any).tenantId),
      role: "owner",
    };
  }
  const prefix = "/api/v1/admin/tenants/:tenantId/privacy";
  app.get(prefix, async (req) => {
    const a = operator(req);
    return db.tenant(a, async (tx) => {
      await event(tx, a, "privacy.queue_inspected", a.tenantId);
      return tx.query(
        "SELECT r.id,r.status,r.data,r.created_at,u.name FROM records r LEFT JOIN users u ON u.id=r.owner_user_id WHERE r.kind='privacy_request' ORDER BY r.created_at",
      );
    });
  });
  app.post(prefix + "/:id/erase", async (req) => {
    const a = operator(req),
      requestId = z
        .string()
        .uuid()
        .parse((req.params as any).id);
    const b = z
      .object({
        providerReviewComplete: z.literal(true),
        thirdPartySourceReviewComplete: z.literal(true),
        evidenceReference: z.string().min(10).max(500),
        retentionPolicyVersion: z.string().min(3).max(100),
        backupPurgeBy: z.iso.datetime(),
      })
      .strict()
      .parse(req.body);
    const deadline = new Date(b.backupPurgeBy);
    if (deadline.getTime() < Date.now())
      throw fail(
        400,
        "BACKUP_DEADLINE",
        "Record the actual scheduled backup-retention deadline",
      );
    return db.system(async (tx) => {
      await tx.query("SET LOCAL ROLE trainer_app");
      await tx.query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role','owner',true)",
        [a.tenantId, a.userId],
      );
      const [request] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='privacy_request' FOR UPDATE",
        [requestId],
      );
      if (!request) throw fail(404, "NOT_FOUND", "Privacy request unavailable");
      if (request.status === "local_erasure_completed")
        return { status: request.status };
      const [member] = await tx.query(
        "SELECT role FROM memberships WHERE user_id=$1 AND tenant_id=$2",
        [request.owner_user_id, a.tenantId],
      );
      if (member?.role !== "subscriber")
        throw fail(
          409,
          "WORKSPACE_CLOSURE_REQUIRED",
          "Trainer and staff deletion requires a reviewed workspace or ownership-transfer process",
        );
      const [active] = await tx.query(
        "SELECT id FROM subscriptions WHERE user_id=$1 AND status NOT IN ('canceled','incomplete_expired','unpaid')",
        [request.owner_user_id],
      );
      if (active)
        throw fail(
          409,
          "SUBSCRIPTION_OPEN",
          "Resolve the provider subscription before account erasure",
        );
      const [user] = await tx.query("SELECT email FROM users WHERE id=$1", [
        request.owner_user_id,
      ]);
      await tx.query(
        "DELETE FROM records WHERE owner_user_id=$1 AND kind IN ('intake','program','workout','message','exception','decision','takeover','preferences','settings','wearable','twin_snapshot','support','checkout')",
        [request.owner_user_id],
      );
      await tx.query(
        "DELETE FROM records WHERE owner_user_id=$1 AND kind IN ('nutrition_profile','nutrition_plan','nutrition_log','nutrition_checkin','nutrition_twin','nutrition_pantry','nutrition_request','nutrition_exception')",
        [request.owner_user_id],
      );
      await tx.query(
        "DELETE FROM jobs WHERE kind='nutrition_week' AND data->>'userId'=$1",
        [request.owner_user_id],
      );
      await tx.query("DELETE FROM workout_events WHERE user_id=$1", [
        request.owner_user_id,
      ]);
      await tx.query(
        "UPDATE bookings SET status='canceled' WHERE user_id=$1 AND status='confirmed'",
        [request.owner_user_id],
      );
      await tx.query("DELETE FROM jobs WHERE kind='email' AND data->>'to'=$1", [
        user.email,
      ]);
      await tx.query(
        "UPDATE records SET data=(data-'reason'-'decisionReason')||'{\"personalTextRemoved\":true}'::jsonb WHERE kind='refund' AND owner_user_id=$1",
        [request.owner_user_id],
      );
      await tx.query(
        "UPDATE records SET status='local_erasure_completed',data=$2,updated_at=now() WHERE id=$1",
        [
          request.id,
          JSON.stringify({
            type: "deletion",
            requestedAt: request.data.requestedAt,
            completedAt: new Date().toISOString(),
            ...b,
            processedBy: a.userId,
            retained:
              "Financial, consent and minimal audit references; backups until the recorded policy deadline.",
          }),
        ],
      );
      await event(tx, a, "privacy.local_erasure_completed", request.id, {
        retentionPolicyVersion: b.retentionPolicyVersion,
        evidenceReference: b.evidenceReference,
      });
      await tx.query("RESET ROLE");
      await tx.query(
        "DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2",
        [a.tenantId, request.owner_user_id],
      );
      await tx.query("DELETE FROM sessions WHERE tenant_id=$1 AND user_id=$2", [
        a.tenantId,
        request.owner_user_id,
      ]);
      const [remaining] = await tx.query(
        "SELECT count(*)::int AS n FROM memberships WHERE user_id=$1",
        [request.owner_user_id],
      );
      if (!remaining.n) {
        await tx.query(
          "UPDATE users SET name='Deleted member',email=$2,password_hash=$3,email_verified=false,platform_role='none' WHERE id=$1",
          [
            request.owner_user_id,
            request.owner_user_id + "@deleted.invalid",
            randomUUID(),
          ],
        );
        await tx.query("DELETE FROM sessions WHERE user_id=$1", [
          request.owner_user_id,
        ]);
        await tx.query("DELETE FROM one_time_tokens WHERE user_id=$1", [
          request.owner_user_id,
        ]);
        await tx.query("DELETE FROM user_security WHERE user_id=$1", [
          request.owner_user_id,
        ]);
      }
      return {
        status: "local_erasure_completed",
        backupPurgeBy: b.backupPurgeBy,
      };
    });
  });
}
