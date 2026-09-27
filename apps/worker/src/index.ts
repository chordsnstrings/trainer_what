import { createDatabase } from "@trainer/db";
import { runTenantCycle, workerTenants } from "./tenant-cycle.ts";
import { createInfrastructureObserver } from "../../api/src/infrastructure-observer.ts";
import { workerDispatchControl } from "../../api/src/infrastructure-actions.ts";
import { withRuntimeConfig } from "../../../packages/providers/src/configuration.ts";
import { loadRuntimeSettings } from "../../api/src/platform-settings.ts";
import { purgeExpiredMealCaptures } from "../../api/src/meal-capture.ts";
import { processIntegrationJobs } from "../../api/src/integrations-completion.ts";
import { purgeExpiredAcquisition } from "../../api/src/acquisition.ts";
import { evaluatePlatformAlerts } from "../../api/src/platform-alerts.ts";
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
  let lastAlertEvaluation = 0;
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
    if (Date.now() - lastAlertEvaluation >= 60000) {
      lastAlertEvaluation = Date.now();
      try {
        await evaluatePlatformAlerts(db);
      } catch {
        console.error("Platform alert evaluation failed");
      }
    }
    for (const tenant of await workerTenants(db))
      await runTenantCycle(db, tenant, { purgeMedia });
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
