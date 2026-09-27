import { randomUUID } from "node:crypto";
import { type Actor, type Tx, event } from "@trainer/db";
import { assertPayoutTransition } from "@trainer/domain";
import { effectiveFinancePolicy, feeInMinor } from "./finance-policy.ts";
export async function journal(
  tx: Tx,
  actor: Actor,
  source: string,
  description: string,
  lines: Array<{ account: string; amount: number }>,
  data: unknown = {},
) {
  if (
    lines.length < 2 ||
    lines.some((x) => !Number.isSafeInteger(x.amount)) ||
    lines.reduce((n, x) => n + x.amount, 0) !== 0
  )
    throw new Error("Unbalanced journal");
  const [entry] = await tx.query(
    "INSERT INTO journals(id,tenant_id,source_key,description,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,source_key) DO NOTHING RETURNING *",
    [randomUUID(), actor.tenantId, source, description, JSON.stringify(data)],
  );
  if (!entry) return null;
  for (const line of lines.filter((l) => l.amount !== 0))
    await tx.query(
      "INSERT INTO journal_lines(id,tenant_id,journal_id,account,amount_minor) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), actor.tenantId, entry.id, line.account, line.amount],
    );
  await event(tx, actor, "ledger.posted", entry.id, { source });
  return entry;
}
export async function recordCharge(
  tx: Tx,
  actor: Actor,
  source: string,
  amount: number,
  rank: number,
  data: any = {},
) {
  if (!Number.isSafeInteger(rank) || rank < 1)
    throw new Error("Invalid subscriber commission rank");
  const policy = await effectiveFinancePolicy(
    tx,
    data.chargedAt ? new Date(data.chargedAt) : new Date(),
  );
  const band = rank <= 100 ? 0 : rank <= 300 ? 1 : rank <= 1000 ? 2 : 3;
  const fee = feeInMinor(amount, policy.data.commissionBps[band]);
  return journal(
    tx,
    actor,
    source,
    "Subscription payment",
    [
      { account: "stripe_receivable", amount },
      { account: "trainer_payable", amount: -(amount - fee) },
      { account: "platform_commission", amount: -fee },
    ],
    {
      ...data,
      grossMinor: amount,
      commissionMinor: fee,
      rank,
      policy: policy.id,
      commissionBps: policy.data.commissionBps[band],
    },
  );
}
export async function financeSummary(tx: Tx) {
  const accounts = await tx.query(
    "SELECT account,sum(amount_minor)::text AS amount FROM journal_lines GROUP BY account",
  );
  const balance = Object.fromEntries(
    accounts.map((x) => [x.account, Number(x.amount)]),
  );
  const pending = await tx.query(
    "SELECT coalesce(sum(amount_minor),0)::text AS total FROM payouts WHERE status IN ('ready','held','submitted','processing','unknown')",
  );
  return {
    accounts: balance,
    earnedMinor: 0 - (balance.trainer_payable ?? 0),
    reservedMinor: Number(pending[0].total),
    availableMinor: Math.max(
      0,
      -(balance.trainer_payable ?? 0) - Number(pending[0].total),
    ),
    commissionMinor: 0 - (balance.platform_commission ?? 0),
  };
}
export async function createPayout(
  tx: Tx,
  actor: Actor,
  period: string,
  beneficiaryId: string,
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    actor.tenantId,
  ]);
  const [existing] = await tx.query(
    "SELECT * FROM payouts WHERE tenant_id=$1 AND period=$2 ORDER BY revision DESC LIMIT 1",
    [actor.tenantId, period],
  );
  if (existing && !["failed", "returned", "canceled"].includes(existing.status))
    return existing;
  const [closed] = await tx.query(
    "SELECT * FROM records WHERE kind='close' AND status='closed' AND data->>'period'=$1",
    [period],
  );
  if (!closed)
    throw new Error(
      "A reconciled monthly close is required before payout preparation",
    );
  const totals = await financeSummary(tx);
  const [laterPayments] = await tx.query(
    "SELECT coalesce(sum(l.amount_minor),0)::text AS total FROM journal_lines l JOIN journals j ON j.id=l.journal_id AND j.tenant_id=l.tenant_id WHERE l.account='trainer_payable' AND (j.source_key LIKE 'payout:%' OR j.source_key LIKE 'payout-return:%') AND j.created_at >= $1",
    [closed.data.cutoff],
  );
  const eligible = Math.max(
    0,
    Number(closed.data.eligibleMinor) -
      Number(laterPayments.total) -
      totals.reservedMinor,
  );
  const funded = Math.max(
    0,
    (totals.accounts.bank_cash ?? 0) - totals.reservedMinor,
  );
  const amount = Math.min(eligible, totals.availableMinor, funded);
  if (amount <= 0)
    throw new Error(
      "No reconciled, funded earnings are available for this period",
    );
  const [payout] = await tx.query(
    "INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,revision) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [
      randomUUID(),
      actor.tenantId,
      period,
      amount,
      beneficiaryId,
      (existing?.revision ?? 0) + 1,
    ],
  );
  await event(tx, actor, "payout.prepared", payout.id, {
    period,
    amount,
  });
  return payout;
}
export async function transitionPayout(
  tx: Tx,
  actor: Actor,
  id: string,
  status: string,
  reference?: string,
) {
  const [p] = await tx.query("SELECT * FROM payouts WHERE id=$1 FOR UPDATE", [
    id,
  ]);
  if (!p) throw new Error("Payout not found");
  if (p.status === status) return p;
  assertPayoutTransition(p.status, status);
  if (["paid", "returned"].includes(status) && !reference)
    throw new Error("Confirmed bank evidence is required");
  if (status === "paid")
    await journal(
      tx,
      actor,
      `payout:${id}`,
      "Confirmed trainer bank payment",
      [
        { account: "trainer_payable", amount: Number(p.amount_minor) },
        { account: "bank_cash", amount: -Number(p.amount_minor) },
      ],
      { bankReference: reference },
    );
  if (status === "returned")
    await journal(
      tx,
      actor,
      `payout-return:${id}`,
      "Returned trainer payment",
      [
        { account: "bank_cash", amount: Number(p.amount_minor) },
        { account: "trainer_payable", amount: -Number(p.amount_minor) },
      ],
      { bankReference: reference },
    );
  const [result] = await tx.query(
    "UPDATE payouts SET status=$2,bank_reference=coalesce($3,bank_reference),updated_at=now() WHERE id=$1 RETURNING *",
    [id, status, reference ?? null],
  );
  await event(tx, actor, `payout.${status}`, id, { reference });
  return result;
}
