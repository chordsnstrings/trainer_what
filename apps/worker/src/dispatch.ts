import { runClaimedFinanceJob } from "../../api/src/finance-automation.ts";
import { elevated, type Actor, type Database } from "@trainer/db";
import { ProviderUnavailable } from "@trainer/providers";
import { executeEmailDelivery } from "./email-delivery.ts";
import { executePushDelivery } from "./push-delivery.ts";
import { executeNutritionJob } from "../../api/src/nutrition-schedule.ts";
import { nutritionWeekLeaseSeconds } from "../../../packages/providers/src/nutrition.ts";
import { executeBrainPlanJob } from "../../api/src/brain-plans.ts";
import { brainPlanLeaseSeconds } from "../../../packages/providers/src/brain-plans.ts";

type Handler = (db: Database, tenantId: string, job: any) => Promise<any>;
export type JobHandlers = {
  finance: Handler;
  nutrition: Handler;
  push: Handler;
  email: Handler;
  /** Trainer Brain plan generation and weekly adaptation; optional for older callers. */
  brainPlan?: Handler;
};
export const defaultHandlers: JobHandlers = {
  finance: (db, tenantId, job) => runClaimedFinanceJob(db, tenantId, job),
  nutrition: (db, tenantId, job) => executeNutritionJob(db, tenantId, job),
  push: (db, tenantId, job) => executePushDelivery(db, tenantId, job),
  email: (db, tenantId, job) => executeEmailDelivery(db, tenantId, job),
  brainPlan: (db, tenantId, job) => executeBrainPlanJob(db, tenantId, job),
};
const workerActor = (tenantId: string): Actor =>
  elevated("worker", { tenantId, role: "staff" });
// Model spending caps reset at the start of the next Asia/Dubai day. The request
// was refused before dispatch, so the wait does not consume a delivery attempt.
const MODEL_LIMIT_CODES = new Set(["MODEL_DAILY_LIMIT", "MODEL_USER_LIMIT"]);
// Blocked or failed weekly plans become eligible for the scheduler's automatic
// not-sent recovery after an exponential backoff (15 minutes doubling to 6 hours).
const NUTRITION_BACKOFF =
  "now()+least(interval '15 minutes'*power(2,least(greatest(attempts,1),10)-1),interval '6 hours')";

/**
 * Claims one due job with a two-minute lease (a weekly meal plan or a Brain
 * plan job: its longest model call at the configured model's time limit,
 * plus a margin); the returned row carries the CAS token. A suspended
 * workspace claims only critical account and safety emails and
 * transactional money confirmations (payment and refund notices), since
 * billing continues; its other jobs stay pending until reinstatement.
 */
export async function claimJob(
  db: Database,
  tenantId: string,
  options: { criticalEmailOnly?: boolean } = {},
) {
  return db.tenant(workerActor(tenantId), async (tx) => {
    const [j] = await tx.query(
      "SELECT * FROM jobs WHERE status='pending' AND available_at<=now() AND (leased_until IS NULL OR leased_until<now()) AND ($1::boolean=false OR (kind='email' AND (data->>'category' IN ('account','safety') OR data->>'transactional'='true'))) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1",
      [options.criticalEmailOnly === true],
    );
    if (!j) return null;
    // A weekly meal plan's or a Brain plan's model call may take longer than
    // two minutes (up to 300 s for a reasoning model); its lease covers the
    // call's time limit so no second worker claims it meanwhile.
    const [claimed] = await tx.query(
      `UPDATE jobs SET leased_until=now()+CASE WHEN kind='nutrition_week' THEN interval '${nutritionWeekLeaseSeconds()} seconds' WHEN kind='brain_plan' THEN interval '${brainPlanLeaseSeconds()} seconds' ELSE interval '2 minutes' END,attempts=attempts+1 WHERE id=$1 RETURNING *`,
      [j.id],
    );
    return claimed;
  });
}

/** Runs a claimed job. Every state change is conditional on the claim's attempts and lease. */
export async function runClaimedJob(
  db: Database,
  tenantId: string,
  job: any,
  handlers: JobHandlers = defaultHandlers,
) {
  const a = workerActor(tenantId);
  try {
    if (job.kind.startsWith("finance_")) {
      try {
        await handlers.finance(db, tenantId, job);
      } catch {
        console.error("Finance job result could not be persisted");
      }
      return;
    }
    if (job.kind === "nutrition_week") {
      const result: any = await handlers.nutrition(db, tenantId, job);
      const blocked = result.status === "exception";
      await db.tenant(a, (tx) =>
        tx.query(
          `UPDATE jobs SET status=$2,leased_until=NULL,last_error=$3,available_at=CASE WHEN $2::text='blocked' THEN ${NUTRITION_BACKOFF} ELSE available_at END WHERE id=$1 AND status='pending' AND attempts=$4 AND leased_until=$5`,
          [
            job.id,
            blocked ? "blocked" : "completed",
            blocked ? result.code : null,
            job.attempts,
            job.leased_until,
          ],
        ),
      );
      return;
    }
    if (job.kind === "brain_plan") {
      // The generation record keeps its own outcome (delivered, review,
      // failed); the job completes once the handler has returned.
      await (handlers.brainPlan ?? executeBrainPlanJob)(db, tenantId, job);
      await db.tenant(a, (tx) =>
        tx.query(
          "UPDATE jobs SET status='completed',leased_until=NULL,last_error=NULL WHERE id=$1 AND status='pending' AND attempts=$2 AND leased_until=$3",
          [job.id, job.attempts, job.leased_until],
        ),
      );
      return;
    }
    if (job.kind === "push") {
      await handlers.push(db, tenantId, job);
      return;
    }
    if (job.kind !== "email")
      throw new ProviderUnavailable(job.kind, "No verified handler configured");
    await handlers.email(db, tenantId, job);
  } catch (e) {
    if (MODEL_LIMIT_CODES.has((e as any)?.code)) {
      await db.tenant(a, (tx) =>
        tx.query(
          "UPDATE jobs SET attempts=attempts-1,last_error=$2,leased_until=NULL,available_at=(date_trunc('day',now() AT TIME ZONE 'Asia/Dubai')+interval '1 day') AT TIME ZONE 'Asia/Dubai' WHERE id=$1 AND status='pending' AND attempts=$3 AND leased_until=$4",
          [job.id, (e as any).code, job.attempts, job.leased_until],
        ),
      );
      return;
    }
    const status =
      e instanceof ProviderUnavailable || job.kind.startsWith("finance_")
        ? "blocked"
        : job.attempts >= 4
          ? "failed"
          : "pending";
    await db.tenant(a, (tx) =>
      tx.query(
        // A terminal account-link email does not keep its bearer link.
        `UPDATE jobs SET status=$2,last_error=$3,leased_until=NULL,available_at=CASE WHEN $2::text<>'pending' AND kind='nutrition_week' THEN ${NUTRITION_BACKOFF} ELSE now()+interval '5 minutes' END,data=CASE WHEN $2::text<>'pending' AND data->>'sensitive'='true' THEN data-'text' ELSE data END WHERE id=$1 AND status='pending' AND attempts=$4 AND leased_until=$5`,
        [
          job.id,
          status,
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
