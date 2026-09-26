import {
  scheduleFinance,
  runClaimedFinanceJob,
} from "../../api/src/finance-automation.ts";
import { createDatabase, type Actor } from "@trainer/db";
import { ProviderUnavailable } from "@trainer/providers";
import { executeEmailDelivery } from "./email-delivery.ts";
import { scheduleNotifications } from "../../api/src/notifications.ts";
import { processCoachingFollowups } from "../../api/src/coaching-followups.ts";
import { createInfrastructureObserver } from "../../api/src/infrastructure-observer.ts";
import { withRuntimeConfig } from "../../../packages/providers/src/configuration.ts";
import { loadRuntimeSettings } from "../../api/src/platform-settings.ts";
import { purgeExpiredMealCaptures } from "../../api/src/meal-capture.ts";
import { expireChatAttachments } from "../../api/src/chat-attachments.ts";
import { processIntegrationJobs } from "../../api/src/integrations-completion.ts";
import { purgeExpiredAcquisition } from "../../api/src/acquisition.ts";
import {
  scheduleNutrition,
  executeNutritionJob,
} from "../../api/src/nutrition-schedule.ts";
if (!process.env.DATABASE_URL) {
  console.log(
    "Jobs are persisted locally. Delivery requires a PostgreSQL worker and configured providers.",
  );
  setInterval(() => {}, 60000);
} else {
  const db = await createDatabase();
  const infrastructure = createInfrastructureObserver(db, "worker");
  let running = true;
  let lastMediaPurge = 0;
  let lastAcquisitionPurge = 0;
  let lastIntegrationTick = 0;
  let integrationTask: Promise<void> | undefined;
  async function tick() {
    if (!integrationTask && Date.now() - lastIntegrationTick >= 60000) {
      lastIntegrationTick = Date.now();
      // Keep slow wearable reads independent of financial and email delivery.
      // AsyncLocalStorage retains this cycle's reviewed provider configuration.
      integrationTask = processIntegrationJobs(db)
        .catch(() =>
          console.error(
            "Integration synchronization or revocation needs review",
          ),
        )
        .finally(() => {
          integrationTask = undefined;
        });
    }
    const purgeMedia = Date.now() - lastMediaPurge >= 60 * 60 * 1000;
    if (purgeMedia) {
      await purgeExpiredMealCaptures(db);
      lastMediaPurge = Date.now();
    }
    if (Date.now() - lastAcquisitionPurge >= 60 * 60 * 1000) {
      try {
        const result = await purgeExpiredAcquisition(db);
        // Drain a backlog one bounded batch per loop, then return to hourly checks.
        if (result.removed < 100) lastAcquisitionPurge = Date.now();
      } catch {
        lastAcquisitionPurge = Date.now();
        console.error("Expired acquisition history could not be removed");
      }
    }
    const tenants = await db.system((tx) =>
      tx.query("SELECT id FROM tenants WHERE lifecycle_state='active'"),
    );
    for (const tenant of tenants) {
      if (purgeMedia) {
        try {
          await expireChatAttachments(db, tenant.id);
        } catch {
          console.error("Chat attachment expiry failed");
        }
      }
      try {
        await scheduleNutrition(db, tenant.id);
      } catch {
        console.error("Nutrition scheduling failed");
      }
      try {
        await scheduleFinance(db, tenant.id);
      } catch {
        console.error("Finance scheduling failed");
      }
      try {
        await scheduleNotifications(db, tenant.id);
      } catch {
        console.error("Notification scheduling failed");
      }
      try {
        await processCoachingFollowups(db, tenant.id);
      } catch {
        console.error("Scheduled coaching follow-up delivery failed");
      }
      const a: Actor = {
        tenantId: tenant.id,
        userId: "00000000-0000-0000-0000-000000000000",
        role: "staff",
      };
      const job = await db.tenant(a, async (tx) => {
        const [j] = await tx.query(
          "SELECT * FROM jobs WHERE status='pending' AND available_at<=now() AND (leased_until IS NULL OR leased_until<now()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1",
        );
        if (!j) return null;
        const [claimed] = await tx.query(
          "UPDATE jobs SET leased_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1 RETURNING *",
          [j.id],
        );
        return claimed;
      });
      if (!job) continue;
      try {
        if (job.kind.startsWith("finance_")) {
          try {
            await runClaimedFinanceJob(db, tenant.id, job);
          } catch {
            console.error("Finance job result could not be persisted");
          }
          continue;
        }
        if (job.kind === "nutrition_week") {
          const result: any = await executeNutritionJob(db, tenant.id, job);
          await db.tenant(a, (tx) =>
            tx.query(
              "UPDATE jobs SET status=$2,leased_until=NULL,last_error=$3 WHERE id=$1 AND status='pending' AND attempts=$4 AND leased_until=$5",
              [
                job.id,
                result.status === "exception" ? "blocked" : "completed",
                result.status === "exception" ? result.code : null,
                job.attempts,
                job.leased_until,
              ],
            ),
          );
          continue;
        }
        if (job.kind !== "email")
          throw new ProviderUnavailable(
            job.kind,
            "No verified handler configured",
          );
        await executeEmailDelivery(db, tenant.id, job);
      } catch (e) {
        await db.tenant(a, (tx) =>
          tx.query(
            "UPDATE jobs SET status=$2,last_error=$3,leased_until=NULL,available_at=now()+interval '5 minutes' WHERE id=$1 AND status='pending' AND attempts=$4 AND leased_until=$5",
            [
              job.id,
              e instanceof ProviderUnavailable ||
              job.kind.startsWith("finance_")
                ? "blocked"
                : job.attempts >= 4
                  ? "failed"
                  : "pending",
              e instanceof ProviderUnavailable
                ? e.message
                : "Provider delivery failed",
              job.attempts,
              job.leased_until,
            ],
          ),
        );
      }
    }
  }
  async function loop() {
    while (running) {
      const started = performance.now();
      let successful = false;
      try {
        await withRuntimeConfig(await loadRuntimeSettings(db), tick);
        successful = true;
      } catch (e) {
        console.error("Worker iteration failed");
      }
      infrastructure.recordCycle(performance.now() - started, successful);
      await infrastructure
        .collectIfDue()
        .catch(() =>
          console.error("Infrastructure observations could not be persisted"),
        );
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, async () => {
      running = false;
      if (integrationTask)
        await Promise.race([
          integrationTask,
          new Promise<void>((resolve) => setTimeout(resolve, 30000)),
        ]);
      await infrastructure.settled().catch(() => {});
      await db.close();
      process.exit(0);
    });
  await loop();
}
