import type { Tx } from "@trainer/db";

/**
 * Shared contract (docs/features/brain-plans.md): a member's programme length
 * in days. The member's current offer (`product` record) carries a
 * trainer-set `data.programmeDays` (7 to 365); `null` means rolling blocks of
 * the Brain's default length (the trainer's plan setting, else 28 days).
 * The `programme` package owns the offer fields and the final logic of this
 * function; keep this signature.
 *
 * Call inside a tenant transaction with a team scope (row security scopes
 * the subscription, the offer and the plan settings).
 */
export const BRAIN_DEFAULT_PROGRAMME_DAYS = 28;
const validDays = (value: unknown) => {
  const n = Number(value);
  return value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isInteger(n) &&
    n >= 7 &&
    n <= 365
    ? n
    : null;
};
export async function programmeLengthDays(
  tx: Tx,
  userId: string,
): Promise<number> {
  // The length snapshotted on the paid membership, else the offer's.
  const [s] = await tx.query(
    "SELECT data FROM subscriptions WHERE user_id=$1",
    [userId],
  );
  const snapshot =
    s?.data && Object.prototype.hasOwnProperty.call(s.data, "programmeDays")
      ? validDays(s.data.programmeDays)
      : undefined;
  if (snapshot) return snapshot;
  if (snapshot === undefined && s?.data?.productId) {
    const [offer] = await tx.query(
      "SELECT data->>'programmeDays' AS days FROM records WHERE id::text=$1 AND kind='product'",
      [String(s.data.productId)],
    );
    const offered = validDays(offer?.days);
    if (offered) return offered;
  }
  // Rolling: the Brain's default block length (the trainer's plan setting).
  const [settings] = await tx.query(
    "SELECT data->'settings'->>'defaultBlockDays' AS days FROM records WHERE kind='plan_brain_settings' ORDER BY created_at DESC LIMIT 1",
  );
  return validDays(settings?.days) ?? BRAIN_DEFAULT_PROGRAMME_DAYS;
}
