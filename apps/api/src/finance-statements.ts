import { type Actor, type Tx, event, putRecord } from "@trainer/db";
import { z } from "zod";
import { journal, financeSummary } from "./finance.ts";
import { monthCutoff } from "./finance-operations.ts";
import type { MonthRate } from "./cost-accounting.ts";
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
/**
 * `platformView` (operators) includes the platform's registrar cost for the
 * trainer's domains; the trainer's own statement leaves it out, since it
 * would show the platform's margin (docs/features/web-addresses.md).
 */
export async function financialStatement(
  tx: Tx,
  period: string,
  options: {
    platformView?: boolean;
    /** The month's USD to AED rate (reviewed or default) for cost figures. */
    rate?: MonthRate;
  } = {},
) {
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
  // Cost by feature and product, with what is priced, estimated or unpriced
  // (docs/features/platform-finance.md).
  const usageByFeature = await tx.query(
    "SELECT task,product,complimentary,count(*)::int AS calls,coalesce(sum(cost_usd),0)::text AS cost_usd,coalesce(sum(cost_usd) FILTER(WHERE status='estimated'),0)::text AS estimated_usd,count(*) FILTER(WHERE cost_usd IS NULL)::int AS unpriced,coalesce(sum(estimated_cost_usd) FILTER(WHERE cost_usd IS NULL),0)::text AS unpriced_estimate_usd FROM cost_events WHERE created_at>=$1 AND created_at<$2 GROUP BY task,product,complimentary ORDER BY task,product,complimentary",
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
  // Gross by what the member bought (informational; the bridge uses totals).
  const revenue = {
    membershipMinor: 0,
    programmeMinor: 0,
    voiceAddOnMinor: 0,
    sessionsMinor: 0,
  };
  const webAddresses: {
    paymentsMinor: number;
    refundsMinor: number;
    registrarCostMinor?: number;
  } = {
    paymentsMinor: 0,
    refundsMinor: 0,
    registrarCostMinor: 0,
  };
  // Card disputes, informational (the bridge keeps them in other adjustments):
  // amounts held when opened, released when won or closed, and lost.
  const disputes = { openedMinor: 0, releasedMinor: 0, lostMinor: 0 };
  const lineSum = (entry: any, account: string) =>
    (entry.lines as any[])
      .filter((l) => l.account === account)
      .reduce((n, l) => n + Number(l.amountMinor), 0);
  for (const entry of entries) {
    const payable = (entry.lines as any[])
      .filter((l) => l.account === "trainer_payable")
      .reduce((n, l) => n + Number(l.amountMinor), 0);
    totals.closingPayableMinor -= payable;
    if (entry.source_key.startsWith("dispute-reserve:"))
      disputes.openedMinor -= lineSum(entry, "dispute_reserve");
    else if (entry.source_key.startsWith("dispute-resolution:")) {
      const lost = -lineSum(entry, "stripe_receivable");
      if (lost > 0) disputes.lostMinor += lost;
      else disputes.releasedMinor += lineSum(entry, "dispute_reserve");
    }
    if (
      entry.source_key.startsWith("stripe-invoice:") ||
      entry.source_key.startsWith("stripe-programme:") ||
      entry.source_key.startsWith("booking-charge:")
    ) {
      const gross = Number(entry.data.grossMinor ?? 0);
      totals.grossMinor += gross;
      totals.commissionMinor += Number(entry.data.commissionMinor ?? 0);
      if (entry.source_key.startsWith("booking-charge:"))
        revenue.sessionsMinor += gross;
      else if (entry.source_key.startsWith("stripe-programme:"))
        revenue.programmeMinor += gross;
      else if (entry.data.purpose === "voice_addon")
        revenue.voiceAddOnMinor += gross;
      else revenue.membershipMinor += gross;
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
    else if (entry.source_key.startsWith("web-address-")) {
      // The trainer's own domain payments to the platform: outside the
      // payable balance (no commission, never paid out), shown separately.
      if (entry.source_key.startsWith("web-address-invoice:"))
        webAddresses.paymentsMinor += Number(entry.data.grossMinor ?? 0);
      else if (entry.source_key.startsWith("web-address-refund:"))
        webAddresses.refundsMinor += Number(entry.data.refundAmountMinor ?? 0);
      // A refund that failed or was canceled after it was journaled.
      else if (entry.source_key.startsWith("web-address-refund-reversal:"))
        webAddresses.refundsMinor -= Number(entry.data.refundAmountMinor ?? 0);
      else if (entry.source_key.startsWith("web-address-registrar:"))
        webAddresses.registrarCostMinor! += (entry.lines as any[])
          .filter((l) => l.account === "registrar_cost")
          .reduce((n, l) => n + Number(l.amountMinor), 0);
      totals.otherPayableMovementMinor -= payable;
    } else totals.otherPayableMovementMinor -= payable;
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
  const units = (v: string) => Math.round(Number(v) * 1e8);
  const costUsd = usageByFeature.reduce((n, r) => n + units(r.cost_usd), 0) / 1e8;
  const usageCost = {
    costUsd,
    estimatedUsd:
      usageByFeature.reduce((n, r) => n + units(r.estimated_usd), 0) / 1e8,
    unpricedCalls: usageByFeature.reduce((n, r) => n + r.unpriced, 0),
    unpricedEstimateUsd:
      usageByFeature.reduce((n, r) => n + units(r.unpriced_estimate_usd), 0) /
      1e8,
    complimentaryUsd:
      usageByFeature
        .filter((r) => r.complimentary)
        .reduce((n, r) => n + units(r.cost_usd), 0) / 1e8,
    ...(options.rate
      ? {
          aedPerUsd: options.rate.aedPerUsd,
          rateSource: options.rate.source,
          costAedMinor: Math.round(costUsd * options.rate.aedPerUsd * 100),
        }
      : {}),
  };
  return {
    period,
    currency: "AED",
    start: start.toISOString(),
    end: end.toISOString(),
    totals,
    revenue,
    disputes,
    usageCost,
    usageByFeature,
    webAddresses: options.platformView
      ? webAddresses
      : {
          paymentsMinor: webAddresses.paymentsMinor,
          refundsMinor: webAddresses.refundsMinor,
        },
    entries: options.platformView
      ? entries
      : entries.filter(
          (entry: any) =>
            !entry.source_key.startsWith("web-address-registrar:"),
        ),
    allocations,
    usage,
    close: close ?? null,
    current: await financeSummary(tx),
  };
}
