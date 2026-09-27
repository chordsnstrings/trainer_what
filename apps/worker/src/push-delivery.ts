import type { Database } from "@trainer/db";
import { ProviderUnavailable } from "@trainer/providers";
import {
  sendWebPush,
  pushAvailable,
} from "../../../packages/providers/src/push.ts";
import { notificationDeliveryDecision } from "../../api/src/notifications.ts";
import { openIntegrationSecret } from "../../api/src/integrations-completion.ts";

class PushNotCurrent extends Error {}
/** Jobs contain IDs only. Ambiguous delivery is never automatically repeated. */
export async function executePushDelivery(
  db: Database,
  tenantId: string,
  job: any,
  send: (
    endpoint: string,
    beforeSend: () => Promise<void>,
  ) => Promise<{ status: number; retryAfter?: string | null }> = sendWebPush,
) {
  const a = { tenantId, userId: job.data.userId, role: "owner" };
  const finish = async (status: string, error: string | null) =>
    db.tenant(a, (tx) =>
      tx.query(
        "UPDATE jobs SET status=$2,last_error=$3,leased_until=NULL WHERE id=$1 AND status='pending' AND attempts=$4 AND leased_until=$5",
        [job.id, status, error, job.attempts, job.leased_until],
      ),
    );
  if (
    !job.data.notificationId ||
    !job.data.subscriptionId ||
    !job.data.userId
  ) {
    await finish("blocked", "Push notification references are missing");
    return;
  }
  const decision = await notificationDeliveryDecision(db, tenantId, {
    ...job,
    kind: "push",
  });
  if (!decision.allowed) {
    await finish(
      "completed",
      "Suppressed by current preferences or event state",
    );
    return;
  }
  if (decision.due && decision.due.getTime() > Date.now() + 1000) {
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE jobs SET available_at=$2,leased_until=NULL WHERE id=$1 AND status='pending' AND attempts=$3 AND leased_until=$4",
        [job.id, decision.due!.toISOString(), job.attempts, job.leased_until],
      ),
    );
    return;
  }
  const config = pushAvailable();
  if (!config)
    throw new ProviderUnavailable(
      "push",
      "Device notification settings need attention",
    );
  const currentSubscription = async () =>
    db.tenant(a, async (tx) => {
      const [m] = await tx.query(
        "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",
        [tenantId, a.userId],
      );
      if (!m) return null;
      const [active] = await tx.query(
        "SELECT training_actor_is_current($1,$2,$3) AS current",
        [tenantId, a.userId, m.role],
      );
      if (!active?.current) return null;
      return (
        (
          await tx.query(
            "SELECT id,encrypted_endpoint FROM push_subscriptions WHERE id=$1 AND user_id=$2 AND expires_at>clock_timestamp() AND vapid_key_id=$3",
            [job.data.subscriptionId, a.userId, config.keyId],
          )
        )[0] ?? null
      );
    });
  const subscription = await currentSubscription();
  if (!subscription) {
    await finish(
      "completed",
      "Device subscription ended or needs reconnecting",
    );
    return;
  }
  const endpoint = openIntegrationSecret<string>(
    `push:${tenantId}:${a.userId}:${subscription.id}`,
    subscription.encrypted_endpoint,
  );
  let dispatched = false;
  try {
    const result = await send(endpoint, async () => {
      const latest = await notificationDeliveryDecision(db, tenantId, {
        ...job,
        kind: "push",
      });
      if (
        !latest.allowed ||
        (latest.due && latest.due.getTime() > Date.now() + 1000) ||
        !(await currentSubscription())
      ) {
        await finish(
          "completed",
          "Device, preferences or source changed before sending",
        );
        throw new PushNotCurrent();
      }
      const changed = await db.tenant(a, (tx) =>
        tx.query(
          "UPDATE jobs SET status='blocked',last_error='Push outcome unknown; automatic retry disabled',data=data||'{\"deliveryState\":\"unknown\"}'::jsonb WHERE id=$1 AND status='pending' AND attempts=$2 AND leased_until=$3 AND leased_until>clock_timestamp() AND EXISTS(SELECT 1 FROM push_subscriptions WHERE id=$4 AND user_id=$5 AND expires_at>clock_timestamp() AND vapid_key_id=$6) RETURNING id",
          [
            job.id,
            job.attempts,
            job.leased_until,
            subscription.id,
            a.userId,
            config.keyId,
          ],
        ),
      );
      if (!changed.length) throw new PushNotCurrent();
      dispatched = true;
    });
    if (!dispatched)
      throw new Error("Push transport did not acquire the dispatch lease");
    await db.tenant(a, async (tx) => {
      const accepted = result.status === 201,
        expired = [404, 410].includes(result.status);
      const retryHint = result.retryAfter?.trim() ?? "";
      const delay = /^\d+$/.test(retryHint)
        ? Number(retryHint) * 1000
        : Date.parse(retryHint) - Date.now();
      // A long Retry-After blocks this attempt instead of sending earlier than requested.
      const retry =
        result.status === 429 && job.attempts < 4 && !(delay > 86400000);
      const retryAt = new Date(
        Date.now() +
          Math.max(
            300000,
            Number.isFinite(delay) ? Math.min(delay, 86400000) : 0,
          ) +
          Math.floor(Math.random() * 30000),
      ).toISOString();
      const [saved] = await tx.query(
        "UPDATE jobs SET status=$2,last_error=$3,leased_until=NULL,available_at=$7,data=data||$4::jsonb WHERE id=$1 AND status='blocked' AND attempts=$5 AND leased_until=$6 RETURNING id",
        [
          job.id,
          accepted || expired ? "completed" : retry ? "pending" : "blocked",
          accepted
            ? null
            : expired
              ? "Device subscription expired"
              : "Push service did not accept this request",
          JSON.stringify({
            deliveryState: accepted
              ? "accepted"
              : expired
                ? "expired"
                : result.status >= 500
                  ? "unknown"
                  : "rejected",
            httpStatus: result.status,
          }),
          job.attempts,
          job.leased_until,
          retryAt,
        ],
      );
      if (saved && expired)
        await tx.query(
          "DELETE FROM push_subscriptions WHERE id=$1 AND user_id=$2",
          [subscription.id, a.userId],
        );
    });
  } catch (error) {
    if (error instanceof PushNotCurrent) return;
    if (!dispatched)
      throw new ProviderUnavailable(
        "push",
        "Device notification configuration or endpoint could not be verified",
      );
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE jobs SET leased_until=NULL WHERE id=$1 AND status='blocked' AND attempts=$2 AND leased_until=$3",
        [job.id, job.attempts, job.leased_until],
      ),
    );
  }
}
