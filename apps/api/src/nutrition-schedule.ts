import { randomUUID } from "node:crypto";
import {
  elevated,
  event,
  putRecord,
  type Database,
  type Actor,
  type Tx,
} from "@trainer/db";
import { hasNutritionAccess } from "./entitlements.ts";
import { prepareNutritionWeek } from "./nutrition.ts";
import { NUTRITION_WEEK_LEASE_SECONDS } from "../../../packages/providers/src/nutrition.ts";
import {
  localDate,
  dateOffset,
} from "../../../packages/domain/src/nutrition.ts";

// Scheduled weeks refused before any provider dispatch (no request yet, or a request
// whose provider state is known to be not_sent) are requeued under the same intent key
// once the worker's backoff has elapsed. Unknown or responded outcomes are never
// requeued here; they stay with the coach's recovery and reconciliation console.
const AUTOMATIC_RECOVERY_ATTEMPTS = 12;
async function recoverUnsentWeeks(tx: Tx, a: Actor) {
  // Eligibility is decided in SQL so ineligible history cannot crowd out due weeks:
  // the week's intent is not superseded, its profile is current, its request is absent
  // or known not_sent (a running one only after its lease, the same window as
  // the worker's claim of a nutrition_week job), and no request of the
  // subscriber awaits provider reconciliation. weekStart is prefiltered against the
  // earliest local date anywhere and checked exactly in the profile's timezone below.
  const jobs = await tx.query(
    `SELECT j.*,r.id AS request_id FROM jobs j LEFT JOIN records r ON r.kind='nutrition_request' AND r.owner_user_id=(j.data->>'userId')::uuid AND r.data->>'requestKey'=coalesce(j.data->>'requestKey',j.id::text) WHERE j.kind='nutrition_week' AND j.status IN ('blocked','failed') AND coalesce(j.data->>'origin','scheduled')<>'manual' AND j.available_at<=now() AND j.attempts<$1 AND (j.leased_until IS NULL OR j.leased_until<now()) AND j.data->>'weekStart'>=to_char(now()-interval '1 day','YYYY-MM-DD') AND (r.id IS NULL OR (r.data->>'providerState'='not_sent' AND (r.status IN ('retryable','failed') OR (r.status='running' AND r.updated_at<now()-interval '${NUTRITION_WEEK_LEASE_SECONDS} seconds')))) AND j.data->>'profileId'=(SELECT p.id::text FROM records p WHERE p.kind='nutrition_profile' AND p.owner_user_id=(j.data->>'userId')::uuid ORDER BY p.created_at DESC,p.id DESC LIMIT 1) AND NOT EXISTS(SELECT 1 FROM records u WHERE u.kind='nutrition_request' AND u.owner_user_id=(j.data->>'userId')::uuid AND u.status IN ('running','failed','closed') AND coalesce(u.data->>'providerState','uncertain')='uncertain') AND NOT EXISTS(SELECT 1 FROM jobs n WHERE n.kind='nutrition_week' AND n.data->>'userId'=j.data->>'userId' AND n.data->>'weekStart'=j.data->>'weekStart' AND n.created_at>j.created_at) ORDER BY j.available_at LIMIT 25 FOR UPDATE OF j SKIP LOCKED`,
    [AUTOMATIC_RECOVERY_ATTEMPTS],
  );
  let recovered = 0;
  for (const job of jobs) {
    const userId = job.data.userId;
    const [profile] = await tx.query(
      "SELECT * FROM records WHERE kind='nutrition_profile' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
      [userId],
    );
    if (job.data.weekStart < localDate(profile.data.profile.timezone)) continue;
    if (job.request_id)
      await tx.query(
        "UPDATE records SET status='retryable',version=version+1,updated_at=now() WHERE id=$1",
        [job.request_id],
      );
    const changed = await tx.query(
      "UPDATE jobs SET status='pending',available_at=now(),leased_until=NULL,last_error=NULL WHERE id=$1 AND status=$2 AND attempts=$3 RETURNING id",
      [job.id, job.status, job.attempts],
    );
    if (!changed.length) continue;
    const recovery = await putRecord(
      tx,
      a,
      "nutrition_recovery",
      {
        jobId: job.id,
        requestId: job.request_id ?? null,
        providerState: "not_sent",
        attempts: job.attempts,
        action: "automatic_retry_unsent",
        reason: job.last_error ?? "Refused before provider dispatch",
      },
      { ownerId: userId, status: "recorded" },
    );
    await event(tx, a, "nutrition.week_recovered", job.id, {
      recoveryId: recovery.id,
      action: "automatic_retry_unsent",
    });
    recovered++;
  }
  return recovered;
}

// The scheduler prepares the first week after intake and the next week one day
// before the current week ends. Daily views come from the delivered weekly version.
// Durable per-profile/date jobs and leases bound retries across worker processes.
export async function scheduleNutrition(db: Database, tenantId: string) {
  const a: Actor = elevated("worker", { tenantId, role: "owner" });
  return db.tenant(a, async (tx) => {
    await tx.query(
      "UPDATE jobs SET status='blocked',leased_until=NULL,last_error='Generation interrupted; inspect provider state before retry' WHERE kind='nutrition_week' AND status='running' AND data->>'origin'='manual' AND leased_until<now()",
    );
    const profiles = await tx.query(
      "SELECT DISTINCT ON(owner_user_id) * FROM records WHERE kind='nutrition_profile' ORDER BY owner_user_id,created_at DESC,id DESC",
    );
    const [enabled] = await tx.query(
      "SELECT id FROM records WHERE kind='nutrition_setup' AND data->>'enabled'='true'",
    );
    if (!enabled) return 0;
    const [published] = await tx.query(
      "SELECT id FROM records WHERE kind='nutrition_release' AND status='published'",
    );
    if (published) await recoverUnsentWeeks(tx, a);
    let count = 0;
    for (const profile of profiles) {
      if (!(await hasNutritionAccess(tx, profile.owner_user_id))) continue;
      const permissions = await tx.query(
        "SELECT DISTINCT ON(document_type) document_type,granted FROM consent_records WHERE user_id=$1 AND document_type IN ('nutrition','nutrition_model') ORDER BY document_type,created_at DESC,id DESC",
        [profile.owner_user_id],
      );
      if (permissions.length !== 2 || permissions.some((p) => !p.granted))
        continue;
      const [uncertain] = await tx.query(
        "SELECT id FROM records WHERE kind='nutrition_request' AND owner_user_id=$1 AND status IN ('running','failed','closed') AND coalesce(data->>'providerState','uncertain')='uncertain' LIMIT 1",
        [profile.owner_user_id],
      );
      if (uncertain) continue;
      const today = localDate(profile.data.profile.timezone);
      const [release] = await tx.query(
        "SELECT id FROM records WHERE kind='nutrition_release' AND status='published'",
      );
      if (!release) continue;
      const [plan] = await tx.query(
        "SELECT * FROM records WHERE kind='nutrition_plan' AND owner_user_id=$1 AND status='delivered' AND data->>'profileId'=$2 ORDER BY data->>'weekStart' DESC LIMIT 1",
        [profile.owner_user_id, profile.id],
      );
      if (plan && dateOffset(plan.data.weekStart, 5) > today) continue;
      const next = plan ? dateOffset(plan.data.weekStart, 7) : today,
        weekStart = next < today ? today : next;
      const key = `nutrition:${tenantId}:${profile.owner_user_id}:${profile.id}:${release.id}:${weekStart}`;
      // A generation the provider answered but validation rejected is deterministic for
      // the same profile, release and individual target. Do not pay for it again each day;
      // the open exception routes it to the coach. A new profile, release or target, a
      // coach resolution after the failure, or a deliberate recovery retry resumes it.
      const [target] = await tx.query(
        "SELECT id FROM records WHERE kind='nutrition_target' AND owner_user_id=$1 AND status='active' ORDER BY created_at DESC,id DESC LIMIT 1",
        [profile.owner_user_id],
      );
      const [rejected] = await tx.query(
        "SELECT r.id FROM records r WHERE r.kind='nutrition_request' AND r.owner_user_id=$1 AND r.status='failed' AND r.data->>'providerState'='responded' AND r.data->>'profileId'=$2 AND r.data->>'releaseId'=$3 AND (r.data->>'targetId') IS NOT DISTINCT FROM $4::text AND NOT EXISTS(SELECT 1 FROM records e WHERE e.kind='nutrition_exception' AND e.owner_user_id=$1 AND e.status='resolved' AND e.updated_at>r.updated_at) LIMIT 1",
        [profile.owner_user_id, profile.id, release.id, target?.id ?? null],
      );
      if (rejected) continue;
      const rows = await tx.query(
        "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,'nutrition_week',$3,$4) ON CONFLICT(intent_key) DO NOTHING RETURNING id",
        [
          randomUUID(),
          tenantId,
          key,
          JSON.stringify({
            userId: profile.owner_user_id,
            profileId: profile.id,
            weekStart,
          }),
        ],
      );
      count += rows.length;
    }
    return count;
  });
}
export async function executeNutritionJob(
  db: Database,
  tenantId: string,
  job: any,
) {
  const a = { tenantId, userId: job.data.userId, role: "subscriber" };
  // The job runs as the follower itself (its own profile and plans).
  const [profile] = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT id FROM records WHERE kind='nutrition_profile' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
      [a.userId],
    ),
  );
  if (profile?.id !== job.data.profileId) return { status: "obsolete" };
  return prepareNutritionWeek(db, a, {
    requestKey: job.data.requestKey ?? job.id,
    weekStart: job.data.weekStart,
  });
}
