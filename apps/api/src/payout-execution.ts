import { type Actor, type Database, event } from "@trainer/db";
import {
  LeanGateway,
  integrationStatus,
  ProviderUnavailable,
} from "@trainer/providers";
import { financeSummary, transitionPayout } from "./finance.ts";
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { statusCode: 409, code });
/** Authority and recent MFA are checked by both route entry points. */
export async function executePayout(db: Database, a: Actor, payoutId: string) {
  const lean = integrationStatus().find((x) => x.id === "lean");
  if (!lean?.configured || !lean.approved)
    throw new ProviderUnavailable(
      "lean",
      "Payout execution requires configured and verified provider access",
    );
  const payout = await db.tenant(a, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
    const [p] = await tx.query("SELECT * FROM payouts WHERE id=$1 FOR UPDATE", [
      payoutId,
    ]);
    if (!p || p.status !== "ready")
      throw fail(
        "PAYOUT_STATE",
        "Only a prepared, unsubmitted instruction may execute",
      );
    const [beneficiary] = await tx.query(
      "SELECT id FROM records WHERE kind='beneficiary' AND status='verified' AND data->>'providerId'=$1 AND (data->>'holdUntil')::timestamptz<now()",
      [p.beneficiary_id],
    );
    if (!beneficiary)
      throw fail(
        "BENEFICIARY_REQUIRED",
        "Recheck destination approval and the bank-change hold",
      );
    const summary = await financeSummary(tx);
    if (
      summary.earnedMinor < summary.reservedMinor ||
      (summary.accounts.bank_cash ?? 0) < summary.reservedMinor
    )
      throw fail(
        "FUNDING_CHANGED",
        "Earnings or recorded funding changed after preparation; reconcile before sending",
      );
    return transitionPayout(tx, a, p.id, "submitted");
  });
  try {
    const result = await new LeanGateway().sendPayout({
      id: payout.id,
      beneficiaryId: payout.beneficiary_id,
      amountMinor: Number(payout.amount_minor),
    });
    const providerId = result.id ?? result.payment_id;
    if (!providerId) throw new Error("Missing provider payment reference");
    await db.tenant(a, async (tx) => {
      const [current] = await tx.query(
        "SELECT status FROM payouts WHERE id=$1 FOR UPDATE",
        [payout.id],
      );
      await tx.query("UPDATE payouts SET provider_id=$2 WHERE id=$1", [
        payout.id,
        providerId,
      ]);
      if (current.status === "submitted")
        await transitionPayout(tx, a, payout.id, "processing");
      await event(tx, a, "payout.provider_acknowledged", payout.id, {
        providerId,
      });
    });
    return { status: "processing", id: payout.id };
  } catch (error) {
    await db.tenant(a, async (tx) => {
      const [current] = await tx.query(
        "SELECT status FROM payouts WHERE id=$1 FOR UPDATE",
        [payout.id],
      );
      if (current.status === "submitted")
        await transitionPayout(tx, a, payout.id, "unknown");
    });
    throw error;
  }
}
