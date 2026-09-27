import { scheduleFinance } from "../../api/src/finance-automation.ts";
import { createDatabase } from "@trainer/db";
import { claimJob, runClaimedJob } from "./dispatch.ts";
import { scheduleNotifications } from "../../api/src/notifications.ts";
import { scheduleLifecycleMessages } from "../../api/src/lifecycle-messages.ts";
import { scheduleRetentionAlerts } from "../../api/src/retention.ts";
import { processCoachingFollowups } from "../../api/src/coaching-followups.ts";
import { createInfrastructureObserver } from "../../api/src/infrastructure-observer.ts";
import { workerDispatchControl } from "../../api/src/infrastructure-actions.ts";
import { withRuntimeConfig } from "../../../packages/providers/src/configuration.ts";
import { loadRuntimeSettings } from "../../api/src/platform-settings.ts";
import { purgeExpiredMealCaptures } from "../../api/src/meal-capture.ts";
import { expireChatAttachments } from "../../api/src/chat-attachments.ts";
import { processIntegrationJobs } from "../../api/src/integrations-completion.ts";
import { purgeExpiredAcquisition } from "../../api/src/acquisition.ts";
import { scheduleNutrition } from "../../api/src/nutrition-schedule.ts";
import { assertProviderSandboxBinding } from "../../../packages/providers/src/sandbox.ts";
// The mock-provider sandbox is refused anywhere but a loopback-only process.
if (assertProviderSandboxBinding())
  console.warn(
    "MOCK PROVIDERS: TRAINER_PROVIDER_SANDBOX=mock is active on this loopback worker. No real provider is contacted.",
  );
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
        await scheduleLifecycleMessages(db, tenant.id);
      } catch {
        console.error("Lifecycle message scheduling failed");
      }
      try {
        await scheduleRetentionAlerts(db, tenant.id);
      } catch {
        console.error("Retention alert scheduling failed");
      }
      try {
        await processCoachingFollowups(db, tenant.id);
      } catch {
        console.error("Scheduled coaching follow-up delivery failed");
      }
      const job = await claimJob(db, tenant.id);
      if (!job) continue;
      await runClaimedJob(db, tenant.id, job);
    }
  }
  async function loop() {
    while (running) {
      const started = performance.now();
      let successful = false;
      let intervalMs = 5000;
      try {
        const control = await workerDispatchControl(db);
        intervalMs = control.intervalMs;
        if (!control.paused)
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
      await new Promise((r) => setTimeout(r, intervalMs));
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
