import type { Tx } from "@trainer/db";
import {
  DEFAULT_PROGRAMME_DAYS,
  effectiveProgrammeDays,
  effectiveProgrammeWindow,
} from "../../../packages/domain/src/programme.ts";
import { subscriptionHasAccess } from "./finance-billing.ts";

/** The Brain's default block length when an offer is rolling (no trainer-set length). */
export const BRAIN_DEFAULT_PROGRAMME_DAYS = DEFAULT_PROGRAMME_DAYS;

/**
 * The length in days of the member's current programme: the trainer-set
 * `programmeDays` of the offer the member holds (snapshotted on the membership
 * when it was bought, else read from the offer), or the Brain default for a
 * rolling offer, complimentary access or no current membership.
 *
 * Call inside a tenant transaction (the member's own scope or a coaching team
 * scope); row-level security limits both reads to rows that scope may see.
 */
export async function programmeLengthDays(
  tx: Tx,
  userId: string,
): Promise<number> {
  const [s] = await tx.query(
    "SELECT status,period_end,data FROM subscriptions WHERE user_id=$1",
    [userId],
  );
  if (!s || !subscriptionHasAccess(s)) return BRAIN_DEFAULT_PROGRAMME_DAYS;
  // A renewed upfront programme queued after the current one applies from
  // its own start (the worker then promotes it onto the row).
  const window = effectiveProgrammeWindow(s.data);
  if (window.programmeStartsAt !== s.data?.programmeStartsAt)
    return effectiveProgrammeDays(window.programmeDays);
  if (s.data && Object.prototype.hasOwnProperty.call(s.data, "programmeDays"))
    return effectiveProgrammeDays(s.data.programmeDays);
  if (!s.data?.productId) return BRAIN_DEFAULT_PROGRAMME_DAYS;
  const [offer] = await tx.query(
    "SELECT data FROM records WHERE id=$1 AND kind='product'",
    [s.data.productId],
  );
  return effectiveProgrammeDays(offer?.data?.programmeDays);
}
