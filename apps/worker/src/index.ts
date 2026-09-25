import { createDatabase, type Actor } from "@trainer/db";
import { sendEmail, ProviderUnavailable } from "@trainer/providers";
import { withRuntimeConfig } from "../../../packages/providers/src/configuration.ts";
import { loadRuntimeSettings } from "../../api/src/platform-settings.ts";
import { purgeExpiredMealCaptures } from "../../api/src/meal-capture.ts";
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
  let running = true;
  let lastMediaPurge = 0;
  async function tick() {
    if (Date.now() - lastMediaPurge >= 60 * 60 * 1000) {
      await purgeExpiredMealCaptures(db);
      lastMediaPurge = Date.now();
    }
    const tenants = await db.system((tx) => tx.query("SELECT id FROM tenants"));
    for (const tenant of tenants) {
      await scheduleNutrition(db, tenant.id);
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
        await tx.query(
          "UPDATE jobs SET leased_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1",
          [j.id],
        );
        return j;
      });
      if (!job) continue;
      try {
        if (job.kind === "nutrition_week") {
          const result: any = await executeNutritionJob(db, tenant.id, job);
          await db.tenant(a, (tx) =>
            tx.query(
              "UPDATE jobs SET status=$2,leased_until=NULL,last_error=$3 WHERE id=$1",
              [
                job.id,
                result.status === "exception" ? "blocked" : "completed",
                result.status === "exception" ? result.code : null,
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
        await sendEmail(job.data.to, job.data.subject, job.data.text);
        await db.tenant(a, (tx) =>
          tx.query(
            "UPDATE jobs SET status='completed',leased_until=NULL WHERE id=$1",
            [job.id],
          ),
        );
      } catch (e) {
        await db.tenant(a, (tx) =>
          tx.query(
            "UPDATE jobs SET status=$2,last_error=$3,leased_until=NULL,available_at=now()+interval '5 minutes' WHERE id=$1",
            [
              job.id,
              e instanceof ProviderUnavailable
                ? "blocked"
                : job.attempts >= 4
                  ? "failed"
                  : "pending",
              e instanceof ProviderUnavailable
                ? e.message
                : "Provider delivery failed",
            ],
          ),
        );
      }
    }
  }
  async function loop() {
    while (running) {
      try {
        await withRuntimeConfig(await loadRuntimeSettings(db), tick);
      } catch (e) {
        console.error("Worker iteration failed");
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, async () => {
      running = false;
      await db.close();
      process.exit(0);
    });
  await loop();
}
