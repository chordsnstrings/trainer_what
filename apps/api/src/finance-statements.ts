import { type Actor, type Tx, event, putRecord } from "@trainer/db";
import { z } from "zod";
import { journal, financeSummary } from "./finance.ts";
import { monthCutoff } from "./finance-operations.ts";
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { statusCode: 409, code });
export const allocationSchema = z
  .object({
    intent: z.string().uuid(),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    category: z.enum(["infrastructure", "voice", "provider", "other"]),
    amountMinor: z.number().int().positive().max(1000000000),
    chargeTrainer: z.boolean(),
    evidenceReference: z.string().trim().min(10).max(500),
    description: z.string().trim().min(5).max(500),
  })
  .strict();
export async function allocateCost(tx: Tx, a: Actor, raw: unknown) {
  const input = allocationSchema.parse(raw);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
  const [existing] = await tx.query(
    "SELECT * FROM records WHERE kind='cost_allocation' AND data->>'intent'=$1",
    [input.intent],
  );
  if (existing) {
    if (
      Object.entries(input).some(([key, value]) => existing.data[key] !== value)
    )
      throw fail(
        "INTENT_CONFLICT",
        "This allocation intent already has different evidence",
      );
    return existing;
  }
  const [close] = await tx.query(
    "SELECT id FROM records WHERE kind='close' AND data->>'period'=$1",
    [input.period],
  );
  if (close)
    throw fail(
      "PERIOD_CLOSED",
      "Record adjustments in an open period; the original closed statement is immutable",
    );
  if (input.chargeTrainer)
    await journal(
      tx,
      a,
      "allocated-cost:" + input.intent,
      input.description,
      [
        { account: "trainer_payable", amount: input.amountMinor },
        { account: "platform_cost_recovery", amount: -input.amountMinor },
      ],
      { ...input, costCategory: input.category },
    );
  const r = await putRecord(tx, a, "cost_allocation", input, {
    status: "posted",
  });
  await event(tx, a, "finance.cost_allocated", r.id, {
    category: input.category,
    chargeTrainer: input.chargeTrainer,
  });
  return r;
}
export async function financialStatement(tx: Tx, period: string) {
  const end = monthCutoff(period),
    [year, month] = period.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1) - 4 * 3600000);
  const entries = await tx.query(
    "SELECT j.*,coalesce(jsonb_agg(jsonb_build_object('account',l.account,'amountMinor',l.amount_minor)) FILTER(WHERE l.id IS NOT NULL),'[]') AS lines FROM journals j LEFT JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_id=j.id WHERE j.created_at>=$1 AND j.created_at<$2 GROUP BY j.id ORDER BY j.created_at,j.id",
    [start.toISOString(), end.toISOString()],
  );
  const [opening] = await tx.query(
    "SELECT coalesce(-sum(l.amount_minor),0)::text AS amount FROM journal_lines l JOIN journals j ON j.id=l.journal_id AND j.tenant_id=l.tenant_id WHERE l.account='trainer_payable' AND j.created_at<$1",
    [start.toISOString()],
  );
  const allocations = await tx.query(
    "SELECT * FROM records WHERE kind='cost_allocation' AND data->>'period'=$1 ORDER BY created_at",
    [period],
  );
  const usage = await tx.query(
    "SELECT provider,model,status,count(*)::int AS calls,sum(input_tokens)::text AS input_tokens,sum(output_tokens)::text AS output_tokens,sum(cost_usd)::text AS cost_usd,count(*) FILTER(WHERE cost_usd IS NULL)::int AS unresolved FROM cost_events WHERE created_at>=$1 AND created_at<$2 GROUP BY provider,model,status ORDER BY provider,model,status",
    [start.toISOString(), end.toISOString()],
  );
  const [close] = await tx.query(
    "SELECT * FROM records WHERE kind='close' AND data->>'period'=$1",
    [period],
  );
  const totals = {
    openingPayableMinor: Number(opening.amount),
    grossMinor: 0,
    refundsMinor: 0,
    commissionMinor: 0,
    processingFeesMinor: 0,
    usageMinor: 0,
    allocatedCostsMinor: 0,
    payoutsMinor: 0,
    payoutReturnsMinor: 0,
    otherPayableMovementMinor: 0,
    closingPayableMinor: Number(opening.amount),
  };
  for (const entry of entries) {
    const payable = (entry.lines as any[])
      .filter((l) => l.account === "trainer_payable")
      .reduce((n, l) => n + Number(l.amountMinor), 0);
    totals.closingPayableMinor -= payable;
    if (
      entry.source_key.startsWith("stripe-invoice:") ||
      entry.source_key.startsWith("booking-charge:")
    ) {
      totals.grossMinor += Number(entry.data.grossMinor ?? 0);
      totals.commissionMinor += Number(entry.data.commissionMinor ?? 0);
    } else if (
      entry.source_key.startsWith("stripe-refund:") ||
      entry.source_key.startsWith("booking-refund:")
    ) {
      totals.refundsMinor += Number(entry.data.refundAmountMinor ?? 0);
      totals.commissionMinor -= Number(entry.data.commissionReversalMinor ?? 0);
    } else if (entry.source_key.startsWith("stripe-settlement:"))
      totals.processingFeesMinor += Number(entry.data.feeMinor ?? 0);
    else if (entry.source_key.startsWith("usage:"))
      totals.usageMinor += payable;
    else if (entry.source_key.startsWith("allocated-cost:"))
      totals.allocatedCostsMinor += payable;
    else if (entry.source_key.startsWith("payout:"))
      totals.payoutsMinor += payable;
    else if (entry.source_key.startsWith("payout-return:"))
      totals.payoutReturnsMinor -= payable;
    else totals.otherPayableMovementMinor -= payable;
  }
  const bridge =
    totals.openingPayableMinor +
    totals.grossMinor -
    totals.refundsMinor -
    totals.commissionMinor -
    totals.processingFeesMinor -
    totals.usageMinor -
    totals.allocatedCostsMinor -
    totals.payoutsMinor +
    totals.payoutReturnsMinor +
    totals.otherPayableMovementMinor;
  if (bridge !== totals.closingPayableMinor)
    throw new Error(
      "Financial statement does not reconcile to the immutable ledger",
    );
  return {
    period,
    currency: "AED",
    start: start.toISOString(),
    end: end.toISOString(),
    totals,
    entries,
    allocations,
    usage,
    close: close ?? null,
    current: await financeSummary(tx),
  };
}
