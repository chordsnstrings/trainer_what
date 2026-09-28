import type { Tx } from "@trainer/db";
import {
  DEFAULT_PROGRAMME_DAYS,
  PROGRAMME_DAYS_MAX,
  PROGRAMME_DAYS_MIN,
  effectiveProgrammeWindow,
} from "../../../packages/domain/src/programme.ts";
import { subscriptionHasAccess } from "./finance-billing.ts";

/** Fallback block length when neither the offer nor the trainer sets one. */
export const BRAIN_DEFAULT_PROGRAMME_DAYS = DEFAULT_PROGRAMME_DAYS;

const validDays = (value: unknown) => {
  const n = typeof value === "string" && value !== "" ? Number(value) : value;
  return typeof n === "number" &&
    Number.isInteger(n) &&
    n >= PROGRAMME_DAYS_MIN &&
    n <= PROGRAMME_DAYS_MAX
    ? n
    : null;
};

/** Rolling blocks use the trainer's plan setting, else the platform default. */
async function rollingBlockDays(tx: Tx) {
  const [settings] = await tx.query(
    "SELECT data->'settings'->>'defaultBlockDays' AS days FROM records WHERE kind='plan_brain_settings' ORDER BY created_at DESC LIMIT 1",
  );
  return validDays(settings?.days) ?? BRAIN_DEFAULT_PROGRAMME_DAYS;
}

/**
 * The length in days of the member's current programme: the trainer-set
 * `programmeDays` of the offer the member holds (snapshotted on the membership
 * when it was bought, else read from the offer). A rolling offer, complimentary
 * access or no current membership uses rolling blocks of the trainer's default
 * block length (the Brain plan setting), else 28 days.
 *
 * Call inside a tenant transaction (the member's own scope or a coaching team
 * scope); row-level security limits the reads to rows that scope may see.
 */
export async function programmeLengthDays(
  tx: Tx,
  userId: string,
): Promise<number> {
  const [s] = await tx.query(
    "SELECT status,period_end,data FROM subscriptions WHERE user_id=$1",
    [userId],
  );
  if (!s || !subscriptionHasAccess(s)) return rollingBlockDays(tx);
  // A renewed upfront programme queued after the current one applies from
  // its own start (the worker then promotes it onto the row).
  const window = effectiveProgrammeWindow(s.data);
  if (window.programmeStartsAt !== s.data?.programmeStartsAt)
    return validDays(window.programmeDays) ?? rollingBlockDays(tx);
  if (s.data && Object.prototype.hasOwnProperty.call(s.data, "programmeDays"))
    return validDays(s.data.programmeDays) ?? rollingBlockDays(tx);
  if (!s.data?.productId) return rollingBlockDays(tx);
  const [offer] = await tx.query(
    "SELECT data FROM records WHERE id::text=$1 AND kind='product'",
    [String(s.data.productId)],
  );
  return validDays(offer?.data?.programmeDays) ?? rollingBlockDays(tx);
}
