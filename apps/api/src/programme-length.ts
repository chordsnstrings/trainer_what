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
  const [offer] = await tx.query(
    "SELECT p.data->>'programmeDays' AS days FROM subscriptions s JOIN records p ON p.kind='product' AND p.id::text=s.data->>'productId' WHERE s.user_id=$1 LIMIT 1",
    [userId],
  );
  const offered = validDays(offer?.days);
  if (offered) return offered;
  const [settings] = await tx.query(
    "SELECT data->>'defaultBlockDays' AS days FROM records WHERE kind='plan_brain_settings' ORDER BY created_at DESC LIMIT 1",
  );
  return validDays(settings?.days) ?? BRAIN_DEFAULT_PROGRAMME_DAYS;
}
