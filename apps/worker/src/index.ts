import { createDatabase } from "@trainer/db";
import { runTenantCycle, workerTenants } from "./tenant-cycle.ts";
import { createInfrastructureObserver } from "../../api/src/infrastructure-observer.ts";
import { workerDispatchControl } from "../../api/src/infrastructure-actions.ts";
import { withRuntimeConfig } from "../../../packages/providers/src/configuration.ts";
import { loadRuntimeSettings } from "../../api/src/platform-settings.ts";
import { purgeExpiredMealCaptures } from "../../api/src/meal-capture.ts";
import { processIntegrationJobs } from "../../api/src/integrations-completion.ts";
import { processVoiceSessions } from "../../api/src/voice-session.ts";
import { processVoiceClones } from "../../api/src/voice-clones.ts";
import { purgeExpiredAcquisition } from "../../api/src/acquisition.ts";
import { maintainHealthKitSync } from "../../api/src/healthkit-sync.ts";
import { evaluatePlatformAlerts } from "../../api/src/platform-alerts.ts";
import { processWebAddressOrders } from "../../api/src/web-address-orders.ts";
import { refreshSuggestedPrices } from "../../api/src/web-address-prices.ts";
import { runPlatformFinanceJobs } from "../../api/src/platform-pnl.ts";
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
  let lastHealthKitMaintenance = 0;
  let lastIntegrationTick = 0;
  let lastAlertEvaluation = 0;
  let integrationTask: Promise<void> | undefined;
  let voiceTask: Promise<void> | undefined;
  let lastWebAddressTick = 0;
  let webAddressTask: Promise<void> | undefined;
  let lastVoiceCloneTick = 0;
  let voiceCloneTask: Promise<void> | undefined;
  let lastPlatformFinanceTick = 0;
  let platformFinanceTask: Promise<void> | undefined;
  async function tick() {
    if (!voiceTask)
      // Trainer-voice audio for prepared sessions, off the delivery path like
      // wearable reads; it keeps this cycle's reviewed provider configuration.
      voiceTask = processVoiceSessions(db)
        .catch(() => console.error("Voice session audio needs review"))
        .finally(() => {
          voiceTask = undefined;
        });
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
    if (!webAddressTask && Date.now() - lastWebAddressTick >= 30000) {
      lastWebAddressTick = Date.now();
      // Registrar calls can take tens of seconds; keep them off the main loop.
      // Orders first, then the suggested endings' prices for trainer searches.
      webAddressTask = processWebAddressOrders(db)
        .then(() => refreshSuggestedPrices(db))
        .then(() => undefined)
        .catch(() => console.error("Web address processing needs review"))
        .finally(() => {
          webAddressTask = undefined;
        });
    }
    if (!voiceCloneTask && Date.now() - lastVoiceCloneTick >= 30000) {
      lastVoiceCloneTick = Date.now();
      // Pro clone uploads, training polls, unconfirmed clones and provider
      // deletions (docs/features/trainer-voice.md); uploads can be slow.
      voiceCloneTask = processVoiceClones(db)
        .catch(() => console.error("Trainer voice clone work needs review"))
        .finally(() => {
          voiceCloneTask = undefined;
        });
    }
    if (!platformFinanceTask && Date.now() - lastPlatformFinanceTick >= 300000) {
      lastPlatformFinanceTick = Date.now();
      // Platform finance summary, fees, platform costs and billing imports
      // (docs/features/platform-finance.md); each job records its own runs
      // and decides from them whether it is due.
      platformFinanceTask = runPlatformFinanceJobs(db)
        .then(() => undefined)
        .catch(() => console.error("Platform finance jobs need review"))
        .finally(() => {
          platformFinanceTask = undefined;
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
    if (Date.now() - lastHealthKitMaintenance >= 60 * 60 * 1000) {
      lastHealthKitMaintenance = Date.now();
      // Revoke devices of former members or withdrawn consent; expire receipts.
      await maintainHealthKitSync(db).catch(() =>
        console.error("HealthKit device maintenance needs review"),
      );
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
      if (webAddressTask)
        await Promise.race([
          webAddressTask,
          new Promise<void>((resolve) => setTimeout(resolve, 30000)),
        ]);
      if (integrationTask || voiceTask || voiceCloneTask || platformFinanceTask)
        await Promise.race([
          Promise.all([integrationTask, voiceTask, voiceCloneTask, platformFinanceTask]),
          new Promise<void>((resolve) => setTimeout(resolve, 30000)),
        ]);
      await infrastructure.settled().catch(() => {});
      await db.close();
      process.exit(0);
    });
  await loop();
}
