import type { Database } from "@trainer/db";
import { sendEmail, ProviderUnavailable } from "@trainer/providers";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { notificationDeliveryDecision } from "../../api/src/notifications.ts";
/** A crash or ambiguous provider result must not produce an automatic second email. */
export async function executeEmailDelivery(
  db: Database,
  tenantId: string,
  job: any,
  send = sendEmail,
) {
  const a = {
      tenantId,
      userId: job.data.userId ?? "00000000-0000-0000-0000-000000000000",
      role: "owner",
    },
    decision = await notificationDeliveryDecision(db, tenantId, job);
  const finish = async (
    status: string,
    error: string | null,
    emailStatus?: string,
  ) =>
    db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE jobs SET status=$2,last_error=$3,leased_until=NULL WHERE id=$1 AND status='pending' AND attempts=$4 AND leased_until=$5 RETURNING id",
        [job.id, status, error, job.attempts, job.leased_until],
      );
      if (r && job.data.notificationId && emailStatus)
        await tx.query("UPDATE notifications SET email_status=$2 WHERE id=$1", [
          job.data.notificationId,
          emailStatus,
        ]);
    });
  if (!decision.allowed) {
    await finish(
      "completed",
      "Suppressed by current preferences or event state",
      "suppressed",
    );
    return;
  }
  const due = decision.due;
  if (due && due.getTime() > Date.now() + 1000) {
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE jobs SET available_at=$2,leased_until=NULL WHERE id=$1 AND status='pending' AND attempts=$3 AND leased_until=$4",
        [job.id, due.toISOString(), job.attempts, job.leased_until],
      ),
    );
    return;
  }
  const config = runtimeConfig();
  if (!config.EMAIL_API_KEY || !config.EMAIL_API_URL || !config.EMAIL_FROM)
    throw new ProviderUnavailable("email");
  const dispatched = await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE jobs SET status='blocked',last_error='Delivery outcome unknown; reconcile provider evidence before retry',data=data||'{\"deliveryState\":\"unknown\"}'::jsonb WHERE id=$1 AND status='pending' AND attempts=$2 AND leased_until=$3 RETURNING id",
      [job.id, job.attempts, job.leased_until],
    ),
  );
  if (!dispatched.length) return;
  try {
    await send(job.data.to, job.data.subject, job.data.text);
    await db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE jobs SET status='completed',last_error=NULL,leased_until=NULL,data=data||'{\"deliveryState\":\"delivered\"}'::jsonb WHERE id=$1 AND status='blocked' AND attempts=$2 AND leased_until=$3 RETURNING id",
        [job.id, job.attempts, job.leased_until],
      );
      if (r && job.data.notificationId)
        await tx.query(
          "UPDATE notifications SET email_status='sent' WHERE id=$1",
          [job.data.notificationId],
        );
    });
  } catch {
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE jobs SET leased_until=NULL WHERE id=$1 AND status='blocked' AND attempts=$2 AND leased_until=$3",
        [job.id, job.attempts, job.leased_until],
      ),
    );
  }
}
