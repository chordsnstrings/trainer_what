import { type Actor, type Database, event } from "@trainer/db";
import {
  LeanGateway,
  integrationStatus,
  ProviderUnavailable,
} from "@trainer/providers";
import {
  financeSummary,
  payeeWorkspaceMember,
  transitionPayout,
  unconfirmedPayoutFailure,
} from "./finance.ts";
import { pendingAffiliateClawbacks } from "./affiliates.ts";
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { statusCode: 409, code });
/** Authority and recent MFA are checked by both route entry points. */
export async function executePayout(
  db: Database,
  a: Actor,
  payoutId: string,
  approval?: {
    configurationId: string;
    revision: number;
    maxPayoutMinor: number;
  },
) {
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
    if (await unconfirmedPayoutFailure(tx, p.tenant_id))
      throw fail(
        "PAYOUT_RECONCILIATION_REQUIRED",
        "An earlier instruction in this workspace is marked failed without independent provider confirmation",
      );
    let approver: string | null = null;
    if (approval) {
      const [configuration] = await tx.query(
        "SELECT version,data FROM records WHERE id=$1 AND kind='finance_automation' FOR UPDATE",
        [approval.configurationId],
      );
      if (
        !configuration ||
        configuration.version !== approval.revision ||
        !configuration.data.enabled ||
        !configuration.data.executePayouts ||
        Number(p.amount_minor) > approval.maxPayoutMinor ||
        Number(p.amount_minor) > configuration.data.maxPayoutMinor
      )
        throw fail(
          "AUTOMATION_APPROVAL_CHANGED",
          "Payment execution approval or cap changed before dispatch",
        );
      approver = configuration.data.approvedBy ?? null;
    }
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
    if (await pendingAffiliateClawbacks(tx))
      throw fail(
        "AFFILIATE_RECONCILIATION_REQUIRED",
        "Reconcile affiliate corrections before paying trainer earnings",
      );
    if (
      summary.earnedMinor < summary.reservedMinor ||
      (summary.accounts.bank_cash ?? 0) < summary.reservedMinor
    )
      throw fail(
        "FUNDING_CHANGED",
        "Earnings or recorded funding changed after preparation; reconcile before sending",
      );
    // Separation of duties: whoever prepared the instruction, or works in the
    // payee workspace, cannot authorize its dispatch. Unattended dispatch acts
    // on the reviewed automation approval, whose approver must be independent.
    const [prepared] = await tx.query(
      "SELECT coalesce($2::uuid,(SELECT actor_id FROM events WHERE name='payout.prepared' AND subject_id=$1 ORDER BY created_at LIMIT 1)) AS preparer",
      [p.id, p.prepared_by ?? null],
    );
    const independent = approval
      ? !!approver && !(await payeeWorkspaceMember(tx, p.tenant_id, approver))
      : !!prepared?.preparer &&
        prepared.preparer !== a.userId &&
        !(await payeeWorkspaceMember(tx, p.tenant_id, a.userId));
    if (!independent)
      throw fail(
        "SEPARATION_OF_DUTIES",
        "A finance operator independent of the payee workspace and of the preparer must authorize this payment",
      );
    // The dispatch is attributed to whoever authorized it: for unattended
    // dispatch, the automation approver, so outcome checks treat the approver
    // as the dispatcher.
    return transitionPayout(
      tx,
      approval && approver ? { ...a, userId: approver } : a,
      p.id,
      "submitted",
    );
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
