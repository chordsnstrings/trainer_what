import { randomUUID } from "node:crypto";
import { type Database, type Actor } from "@trainer/db";
import { prepareNutritionWeek } from "./nutrition.ts";
import {
  localDate,
  dateOffset,
} from "../../../packages/domain/src/nutrition.ts";

// The scheduler prepares the first week after intake and the next week one day
// before the current week ends. Daily views come from the delivered weekly version.
// Durable per-profile/date jobs and leases bound retries across worker processes.
export async function scheduleNutrition(db: Database, tenantId: string) {
  const a: Actor = {
    tenantId,
    userId: "00000000-0000-0000-0000-000000000000",
    role: "owner",
  };
  return db.tenant(a, async (tx) => {
    const profiles = await tx.query(
      "SELECT DISTINCT ON(owner_user_id) * FROM records WHERE kind='nutrition_profile' ORDER BY owner_user_id,created_at DESC,id DESC",
    );
    const [enabled] = await tx.query(
      "SELECT id FROM records WHERE kind='nutrition_setup' AND data->>'enabled'='true'",
    );
    if (!enabled) return 0;
    let count = 0;
    for (const profile of profiles) {
      const [paid] = await tx.query(
        "SELECT id FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing') AND period_end>now() AND data->'modules' ? 'nutrition'",
        [profile.owner_user_id],
      );
      if (!paid) continue;
      const permissions = await tx.query(
        "SELECT DISTINCT ON(document_type) document_type,granted FROM consent_records WHERE user_id=$1 AND document_type IN ('nutrition','nutrition_model') ORDER BY document_type,created_at DESC,id DESC",
        [profile.owner_user_id],
      );
      if (permissions.length !== 2 || permissions.some((p) => !p.granted))
        continue;
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
  const [profile] = await db.tenant({ ...a, role: "owner" }, (tx) =>
    tx.query(
      "SELECT id FROM records WHERE kind='nutrition_profile' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
      [a.userId],
    ),
  );
  if (profile?.id !== job.data.profileId) return { status: "obsolete" };
  return prepareNutritionWeek(db, a, {
    requestKey: job.id,
    weekStart: job.data.weekStart,
  });
}
