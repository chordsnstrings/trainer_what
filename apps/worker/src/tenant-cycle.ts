import type { Database } from "@trainer/db";
import { scheduleFinance } from "../../api/src/finance-automation.ts";
import { scheduleNotifications } from "../../api/src/notifications.ts";
import { scheduleLifecycleMessages } from "../../api/src/lifecycle-messages.ts";
import { scheduleRetentionAlerts } from "../../api/src/retention.ts";
import { processCoachingFollowups } from "../../api/src/coaching-followups.ts";
import { expireChatAttachments } from "../../api/src/chat-attachments.ts";
import { scheduleNutrition } from "../../api/src/nutrition-schedule.ts";
import { sweepComplimentaryAccess } from "../../api/src/complimentary-access.ts";
import { sweepProgrammes } from "../../api/src/programme-today.ts";
import { scheduleSafetyEscalations } from "../../api/src/safety-policy.ts";
import {
  claimJob,
  runClaimedJob,
  defaultHandlers,
  type JobHandlers,
} from "./dispatch.ts";

type Step = (db: Database, tenantId: string) => Promise<unknown>;
/** The automated per-workspace work of one worker cycle, in order. */
export type TenantSchedulers = {
  nutrition: Step;
  finance: Step;
  notifications: Step;
  complimentaryAccess: Step;
  programmes: Step;
  lifecycleMessages: Step;
  retentionAlerts: Step;
  coachingFollowups: Step;
  safetyEscalations: Step;
};
export const defaultSchedulers: TenantSchedulers = {
  nutrition: (db, id) => scheduleNutrition(db, id),
  finance: (db, id) => scheduleFinance(db, id),
  notifications: (db, id) => scheduleNotifications(db, id),
  complimentaryAccess: (db, id) => sweepComplimentaryAccess(db, id),
  programmes: (db, id) => sweepProgrammes(db, id),
  lifecycleMessages: (db, id) => scheduleLifecycleMessages(db, id),
  retentionAlerts: (db, id) => scheduleRetentionAlerts(db, id),
  coachingFollowups: (db, id) => processCoachingFollowups(db, id),
  safetyEscalations: (db, id) => scheduleSafetyEscalations(db, id),
};
const stillRunsWhileSuspended: ReadonlySet<keyof TenantSchedulers> = new Set([
  "safetyEscalations",
]);
const failures: Record<keyof TenantSchedulers, string> = {
  nutrition: "Nutrition scheduling failed",
  finance: "Finance scheduling failed",
  notifications: "Notification scheduling failed",
  complimentaryAccess: "Complimentary access expiry failed",
  programmes: "Programme end-of-programme sweep failed",
  lifecycleMessages: "Lifecycle message scheduling failed",
  retentionAlerts: "Retention alert scheduling failed",
  coachingFollowups: "Scheduled coaching follow-up delivery failed",
  safetyEscalations: "Safety review escalation failed",
};

/** Workspaces the worker visits: active ones, and suspended ones for critical and transactional email only. */
export function workerTenants(db: Database) {
  return db.system((tx) =>
    tx.query<{ id: string; lifecycle_state: string }>(
      "SELECT id,lifecycle_state FROM tenants WHERE lifecycle_state IN ('active','suspended') ORDER BY id",
    ),
  );
}

/**
 * One worker visit to a workspace. A suspended workspace runs no automated
 * coaching, nutrition delivery, reminders, lifecycle or retention messages,
 * follow-ups, finance automation or push; only critical account and safety
 * emails (such as the suspension notice) and transactional payment or refund
 * confirmations are dispatched. Returns what ran.
 */
export async function runTenantCycle(
  db: Database,
  tenant: { id: string; lifecycle_state: string },
  options: { purgeMedia?: boolean } = {},
  schedulers: TenantSchedulers = defaultSchedulers,
  handlers: JobHandlers = defaultHandlers,
) {
  const ran: string[] = [];
  if (options.purgeMedia) {
    try {
      await expireChatAttachments(db, tenant.id);
      ran.push("chatAttachmentExpiry");
    } catch {
      console.error("Chat attachment expiry failed");
    }
  }
  const suspended = tenant.lifecycle_state === "suspended";
  for (const name of Object.keys(schedulers) as Array<keyof TenantSchedulers>) {
    // Overdue safety reviews still escalate to the platform while suspended.
    if (suspended && !stillRunsWhileSuspended.has(name)) continue;
    try {
      await schedulers[name](db, tenant.id);
      ran.push(name);
    } catch {
      console.error(failures[name]);
    }
  }
  const job = await claimJob(db, tenant.id, { criticalEmailOnly: suspended });
  if (job) {
    await runClaimedJob(db, tenant.id, job, handlers);
    ran.push("job:" + job.kind);
  }
  return ran;
}
