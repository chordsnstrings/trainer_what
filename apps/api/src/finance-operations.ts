import { executePayout } from "./payout-execution.ts";
import { strictSecurity } from "../../../packages/providers/src/configuration.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  elevated,
  type Actor,
  type Database,
  type Tx,
  event,
  putRecord,
} from "@trainer/db";
import {
  journal,
  financeSummary,
  payeeWorkspaceMember,
  transitionPayout,
} from "./finance.ts";
import { requireRecentMfa } from "./security.ts";
import { notifyUser } from "./notifications.ts";
import { refreshSummary } from "./platform-finance-runs.ts";
import {
  AI_COACH_SERVICE_FEE,
  estimateUnresolvedUsage,
  financeSettings,
  monthRate,
  periodUsage,
  type FinanceSettings,
  type MonthRate,
} from "./cost-accounting.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export async function reconcileModelUsage(
  tx: Tx,
  a: Actor,
  id: string,
  input: {
    costUsd: string;
    providerRequestId: string;
    evidenceReference: string;
  },
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
  const [usage] = await tx.query(
    "SELECT *,now()-created_at<interval '5 minutes' AS recent FROM cost_events WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!usage) throw fail(404, "NOT_FOUND", "Usage record unavailable");
  if (usage.status === "reconciled") {
    if (
      Number(usage.cost_usd) !== Number(input.costUsd) ||
      usage.trace_id !== input.providerRequestId ||
      usage.reconciliation?.evidenceReference !== input.evidenceReference
    )
      throw fail(
        409,
        "USAGE_INTENT_CONFLICT",
        "This usage record already has different reconciliation evidence",
      );
    return usage;
  }
  if (
    usage.status === "recorded" ||
    (usage.status === "reserved" && usage.recent)
  )
    throw fail(
      409,
      "USAGE_NOT_RECONCILABLE",
      "Usage is already finalized or the request may still be running",
    );
  if (usage.trace_id && usage.trace_id !== input.providerRequestId)
    throw fail(
      409,
      "USAGE_REFERENCE_MISMATCH",
      "Reconcile the original provider request reference",
    );
  // Unknown, stale reserved and estimated rows (an invoice correcting the
  // estimate a call was priced at) can be reconciled; the estimate is kept.
  const [updated] = await tx.query(
    "UPDATE cost_events SET cost_usd=$2,trace_id=$3,status='reconciled',reconciliation=$4 WHERE id=$1 RETURNING *",
    [
      id,
      input.costUsd,
      input.providerRequestId,
      JSON.stringify({
        ...input,
        previousStatus: usage.status,
        ...(usage.status === "estimated"
          ? { previousCostUsd: usage.cost_usd }
          : {}),
        reviewedBy: a.userId,
        reviewedAt: new Date().toISOString(),
      }),
    ],
  );
  await event(tx, a, "finance.usage_reconciled", id, {
    costUsd: input.costUsd,
    providerRequestId: input.providerRequestId,
    evidenceReference: input.evidenceReference,
  });
  // An invoice correction to a month whose usage was already charged does
  // not change that charge (correction entries are phase C): the difference
  // is recorded here and shown next to the statement on /admin/finance.
  const [charged] = await tx.query(
    "SELECT s.period,s.charge_minor,s.fx_aed_per_usd::text AS fx FROM usage_statements s WHERE s.period=to_char($1::timestamptz AT TIME ZONE 'Asia/Dubai','YYYY-MM')",
    [usage.created_at],
  );
  if (!charged) return updated;
  const correction = {
    period: charged.period,
    previousStatus: usage.status,
    previousCostUsd: usage.cost_usd === null ? null : String(usage.cost_usd),
    costUsd: input.costUsd,
    statementChargeMinor: Number(charged.charge_minor),
    statementAedPerUsd: Number(charged.fx),
  };
  await event(tx, a, "finance.usage_corrected_after_charge", id, correction);
  return { ...updated, correctionAfterCharge: correction };
}
/** The Asia/Dubai month (YYYY-MM) of a time. */
export function dubaiMonthOf(at: Date | string) {
  return new Date(new Date(at).getTime() + 4 * 3600000).toISOString().slice(0, 7);
}
export function monthCutoff(period: string) {
  periodSchema.parse(period);
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 1) - 4 * 3600000);
}
export async function postUsageStatement(
  tx: Tx,
  a: Actor,
  input: {
    period: string;
    fxAedPerUsd: number;
    chargeMinor: number;
    feeScheduleVersion: string;
    evidenceReference: string;
  },
  options: {
    /** The month's rate (read by the caller); a reviewed one must be used. */
    rate?: MonthRate | null;
    settings?: FinanceSettings;
  } = {},
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
  const [existing] = await tx.query(
    "SELECT * FROM usage_statements WHERE period=$1",
    [input.period],
  );
  if (existing) {
    if (
      Number(existing.charge_minor) !== input.chargeMinor ||
      Number(existing.fx_aed_per_usd) !== input.fxAedPerUsd
    )
      throw fail(
        409,
        "USAGE_INTENT_CONFLICT",
        "This period already has a different reviewed usage statement",
      );
    return existing;
  }
  const cutoff = monthCutoff(input.period);
  if (cutoff.getTime() > Date.now())
    throw fail(409, "PERIOD_OPEN", "Wait until the usage month ends");
  // One reviewed rate per month (docs/features/platform-finance.md): once
  // recorded, every statement of the month converts at it, so the statement,
  // business metrics and cost conversions agree.
  if (
    options.rate?.source === "reviewed" &&
    Number(options.rate.aedPerUsd) !== Number(input.fxAedPerUsd)
  )
    throw fail(
      409,
      "FX_RATE_MISMATCH",
      `Use the reviewed rate for ${input.period}: ${options.rate.aedPerUsd} AED per USD`,
    );
  const settings = options.settings ?? financeSettings();
  const usage = await periodUsage(
    tx,
    input.period,
    input.fxAedPerUsd,
    settings,
  );
  if (!usage.events)
    throw fail(
      409,
      "USAGE_UNRECONCILED",
      "There is no provider usage to charge for this month",
    );
  if (usage.unpriced)
    throw fail(
      409,
      "USAGE_UNRECONCILED",
      `${usage.unpriced} provider call(s) this month are not priced yet: reconcile them from the provider invoice, or estimate them (Estimate unpriced usage)`,
    );
  if (usage.chargeMinor !== input.chargeMinor)
    throw fail(
      400,
      "USAGE_AMOUNT_MISMATCH",
      "The charge must match priced USD cost (recorded, reconciled or estimated) converted at the reviewed exchange rate with the usage markup, rounded once to AED minor units",
    );
  const entry = input.chargeMinor
    ? await journal(
        tx,
        a,
        "usage:" + input.period,
        // Trainers see the charge only under this name (owner decision).
        AI_COACH_SERVICE_FEE,
        [
          { account: "trainer_payable", amount: input.chargeMinor },
          { account: "platform_cost_recovery", amount: -input.chargeMinor },
        ],
        {
          ...input,
          chargeableUsd: usage.chargeableUsd,
          estimatedEvents: usage.estimated,
          markupPercent: usage.markupPercent,
          complimentaryUsageBearer: usage.complimentaryBearer,
          platformBorneUsd: usage.platformBorneUsd,
          rateSource: options.rate?.source ?? "operator",
        },
      )
    : null;
  const [statement] = await tx.query(
    "INSERT INTO usage_statements(id,tenant_id,period,total_cost_usd,fx_aed_per_usd,charge_minor,cost_event_count,fee_schedule_version,evidence_reference,journal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
    [
      randomUUID(),
      a.tenantId,
      input.period,
      usage.chargeableUsd,
      input.fxAedPerUsd,
      input.chargeMinor,
      usage.events,
      input.feeScheduleVersion,
      input.evidenceReference,
      entry?.id ?? null,
    ],
  );
  await event(tx, a, "finance.usage_posted", statement.id, {
    period: input.period,
    chargeMinor: input.chargeMinor,
  });
  if (input.chargeMinor > 0) await notifyServiceFee(tx, a, input);
  return statement;
}
/**
 * Tells the workspace owners the month's AI Coach Service Fee: one line with
 * the amount (markup included), never the provider cost or a breakdown
 * (owner decision, 28 September 2026).
 */
async function notifyServiceFee(
  tx: Tx,
  a: Actor,
  input: { period: string; chargeMinor: number },
) {
  const owners = await tx.query(
    "SELECT user_id FROM memberships WHERE tenant_id=$1 AND role='owner' ORDER BY user_id",
    [a.tenantId],
  );
  const name = (period: string) =>
    new Date(period + "-15T00:00:00Z").toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const month = name(input.period);
  // A month's fee is posted after it ends, so it is on the statement of the
  // month it is posted in; the notice names that statement.
  const statementMonth = name(dubaiMonthOf(new Date()));
  const amount = (input.chargeMinor / 100).toFixed(2);
  for (const o of owners)
    await notifyUser(tx, a, {
      userId: o.user_id,
      category: "account",
      dedupeKey: `ai-coach-service-fee:${input.period}`,
      title: `${AI_COACH_SERVICE_FEE} for ${month}`,
      body: `${AI_COACH_SERVICE_FEE}: AED ${amount}. It is deducted from your earnings and shown on your ${statementMonth} statement.`,
      href: "/trainer/finance",
      templateKey: "ai-coach-service-fee",
      email: false,
      source: { kind: "ai_coach_service_fee", period: input.period },
    });
}
export async function closeMonth(
  tx: Tx,
  a: Actor,
  period: string,
  evidenceReference: string,
  now = new Date(),
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
  const [existing] = await tx.query(
    "SELECT * FROM records WHERE kind='close' AND data->>'period'=$1",
    [period],
  );
  if (existing) return existing;
  const cutoff = monthCutoff(period);
  if (now.getTime() < cutoff.getTime() + 7 * 86400000)
    throw fail(
      409,
      "PERIOD_OPEN",
      "A month can close after its seven-day refund review buffer",
    );
  const [unpriced] = await tx.query(
    "SELECT count(*)::int AS n FROM cost_events WHERE created_at<$1 AND cost_usd IS NULL",
    [cutoff.toISOString()],
  );
  const [unresolved] = await tx.query(
    "SELECT count(*)::int AS n FROM records WHERE (kind='refund' AND status IN ('requested','submitting','submitted','unknown')) OR (kind='reconciliation' AND status<>'resolved') OR (kind='booking_payment' AND status IN ('creating','open','unknown','refund_submitting','refund_pending','refund_unknown')) OR (kind='checkout' AND status='unknown' AND data->>'billing'='upfront') OR (kind='billing_invoice' AND status='open' AND coalesce((data->>'amountDue')::bigint,0)>coalesce((data->>'amountPaid')::bigint,0))",
  );
  const [unknown] = await tx.query(
    "SELECT count(*)::int AS n FROM payouts WHERE status IN ('submitted','processing','unknown')",
  );
  if (unpriced.n || unresolved.n || unknown.n)
    throw fail(
      409,
      "RECONCILIATION_REQUIRED",
      unpriced.n
        ? `Price or estimate the ${unpriced.n} unpriced provider call(s) (Estimate unpriced usage), and resolve refunds, reconciliation exceptions and uncertain payments before closing`
        : "Resolve unpriced usage, refunds, reconciliation exceptions and uncertain payments before closing",
    );
  const missingUsage = await tx.query(
    "SELECT to_char(c.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM') AS period FROM cost_events c LEFT JOIN usage_statements s ON s.tenant_id=c.tenant_id AND s.period=to_char(c.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM') WHERE c.created_at<$1 GROUP BY to_char(c.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM'),s.cost_event_count HAVING s.cost_event_count IS NULL OR count(c.id)<>s.cost_event_count",
    [cutoff.toISOString()],
  );
  if (missingUsage.length)
    throw fail(
      409,
      "USAGE_STATEMENT_REQUIRED",
      "Post reviewed usage statements before closing trainer earnings",
    );
  const lines = await tx.query(
    "SELECT l.account,sum(l.amount_minor)::text AS amount FROM journal_lines l JOIN journals j ON j.id=l.journal_id AND j.tenant_id=l.tenant_id WHERE j.created_at<$1 AND j.currency='AED' GROUP BY l.account",
    [cutoff.toISOString()],
  );
  const accounts = Object.fromEntries(
    lines.map((r) => [r.account, Number(r.amount)]),
  );
  const earnings = Math.max(0, -(accounts.trainer_payable ?? 0));
  // Only charges before the cutoff must be settled: later charges are still in transit, and
  // settlements, refunds and losses (credits) count whenever they post. A negative balance means
  // funds were returned after settlement; it cannot block close and is reconciled by a Stripe debit.
  const [receivable] = await tx.query(
    "SELECT coalesce(sum(l.amount_minor) FILTER (WHERE j.created_at<$1 OR l.amount_minor<0),0)::text AS unsettled FROM journal_lines l JOIN journals j ON j.id=l.journal_id AND j.tenant_id=l.tenant_id WHERE l.account='stripe_receivable'",
    [cutoff.toISOString()],
  );
  if (Number(receivable.unsettled) > 0)
    throw fail(
      409,
      "SETTLEMENT_REQUIRED",
      "Reconcile outstanding Stripe receivables before closing",
    );
  const r = await putRecord(
    tx,
    a,
    "close",
    {
      period,
      cutoff: cutoff.toISOString(),
      accounts,
      eligibleMinor: earnings,
      unsettledReceivableMinor: Number(receivable.unsettled),
      evidenceReference,
      reviewedBy: a.userId,
      policy: "month-end-uae-seven-day-review-v1",
    },
    { status: "closed" },
  );
  await event(tx, a, "finance.month_closed", r.id, { period });
  return r;
}
/** Stripe recovered a negative balance from the company bank: cash out, receivable restored. */
export async function recordStripeDebit(
  tx: Tx,
  a: Actor,
  input: {
    stripeDebitId: string;
    bankReference: string;
    amountMinor: number;
    evidenceReference: string;
  },
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
  const source = "stripe-debit:" + input.stripeDebitId;
  const [prior] = await tx.query("SELECT * FROM journals WHERE source_key=$1", [
    source,
  ]);
  if (prior) {
    if (Object.entries(input).some(([key, value]) => prior.data[key] !== value))
      throw fail(
        409,
        "INTENT_CONFLICT",
        "Stripe debit reference already has different evidence",
      );
    return prior;
  }
  const totals = await financeSummary(tx);
  if (input.amountMinor > -(totals.accounts.stripe_receivable ?? 0))
    throw fail(
      409,
      "EXCESS_DEBIT",
      "A Stripe debit can only restore this workspace’s negative Stripe balance",
    );
  return journal(
    tx,
    a,
    source,
    "Verified Stripe balance debit from the bank",
    [
      { account: "bank_cash", amount: -input.amountMinor },
      { account: "stripe_receivable", amount: input.amountMinor },
    ],
    input,
  );
}
export function financeOperations(
  app: FastifyInstance,
  db: Database,
  identity: (
    r: FastifyRequest,
  ) => Actor & { platformRole: string; mfaAt?: string | null },
) {
  function finance(req: FastifyRequest) {
    const a = identity(req);
    if (!["admin", "finance"].includes(a.platformRole))
      throw fail(
        403,
        "FINANCE_REQUIRED",
        "Platform finance access is required",
      );
    requireRecentMfa(a, true);
    const tenantId = z
      .string()
      .uuid()
      .parse((req.params as any).tenantId);
    return {
      ...a,
      ...elevated("platform-operator", {
        tenantId,
        userId: a.userId,
        role: "finance",
      }),
    };
  }
  const prefix = "/api/v1/admin/tenants/:tenantId/finance";
  app.get(prefix, async (req) => {
    const a = finance(req);
    return db.tenant(a, async (tx) => {
      await event(tx, a, "finance.workspace_inspected", a.tenantId);
      return {
        summary: await financeSummary(tx, { platformView: true }),
        unresolvedUsage: await tx.query(
          "SELECT * FROM cost_events WHERE status IN ('reserved','unknown') ORDER BY created_at LIMIT 200",
        ),
        // Every row by pricing status: estimated rows are priced at their
        // estimate until an invoice reconciles them.
        usageByStatus: await tx.query(
          "SELECT status,count(*)::int AS calls,coalesce(sum(cost_usd),0)::text AS cost_usd,coalesce(sum(estimated_cost_usd) FILTER(WHERE cost_usd IS NULL),0)::text AS unpriced_estimate_usd FROM cost_events GROUP BY status ORDER BY status",
        ),
        // Each statement beside what its month's priced usage would charge
        // now at the statement's own rate: invoice corrections after the
        // charge show here as a difference (not charged; phase C).
        usageStatements: await (async () => {
          const out = [];
          for (const s of await tx.query(
            "SELECT * FROM usage_statements ORDER BY period DESC",
          )) {
            const current = await periodUsage(
              tx,
              s.period,
              Number(s.fx_aed_per_usd),
            );
            out.push({
              ...s,
              current_chargeable_usd: current.chargeableUsd,
              current_charge_minor: current.chargeMinor,
              difference_minor: current.chargeMinor - Number(s.charge_minor),
            });
          }
          return out;
        })(),
        records: await tx.query(
          "SELECT * FROM records WHERE kind IN ('close','beneficiary','reconciliation','refund') ORDER BY created_at DESC",
        ),
        payouts: await tx.query(
          "SELECT * FROM payouts ORDER BY created_at DESC",
        ),
      };
    });
  });
  app.post(prefix + "/settlements", async (req) => {
    const a = finance(req);
    const b = z
      .object({
        stripePayoutId: z.string().min(4).max(120),
        bankReference: z.string().min(5).max(200),
        grossMinor: z.number().int().positive().max(1000000000),
        feeMinor: z.number().int().min(0),
        netMinor: z.number().int().positive(),
        evidenceReference: z.string().min(10).max(500),
      })
      .strict()
      .parse(req.body);
    if (b.grossMinor !== b.netMinor + b.feeMinor)
      throw fail(
        400,
        "SETTLEMENT_MISMATCH",
        "Gross must equal net received plus actual processing fees",
      );
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId,
      ]);
      const [prior] = await tx.query(
        "SELECT * FROM journals WHERE source_key=$1",
        ["stripe-settlement:" + b.stripePayoutId],
      );
      if (prior) {
        if (Object.entries(b).some(([key, value]) => prior.data[key] !== value))
          throw fail(
            409,
            "INTENT_CONFLICT",
            "Settlement reference already has different evidence",
          );
        return prior;
      }
      const totals = await financeSummary(tx);
      if (b.grossMinor > (totals.accounts.stripe_receivable ?? 0))
        throw fail(
          409,
          "EXCESS_SETTLEMENT",
          "Settlement exceeds this workspace’s unreconciled receivable",
        );
      return journal(
        tx,
        a,
        "stripe-settlement:" + b.stripePayoutId,
        "Verified Stripe bank settlement",
        [
          { account: "bank_cash", amount: b.netMinor },
          { account: "trainer_payable", amount: b.feeMinor },
          { account: "stripe_receivable", amount: -b.grossMinor },
        ],
        b,
      );
    });
  });
  app.post(prefix + "/settlements/debits", async (req) => {
    const a = finance(req);
    const b = z
      .object({
        stripeDebitId: z.string().min(4).max(120),
        bankReference: z.string().min(5).max(200),
        amountMinor: z.number().int().positive().max(1000000000),
        evidenceReference: z.string().min(10).max(500),
      })
      .strict()
      .parse(req.body);
    return db.tenant(a, (tx) => recordStripeDebit(tx, a, b));
  });
  app.post(prefix + "/usage/:id/reconcile", async (req) => {
    const a = finance(req);
    const id = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const input = z
      .object({
        costUsd: z.string().regex(/^\d{1,7}(\.\d{1,8})?$/),
        providerRequestId: z.string().min(3).max(200),
        evidenceReference: z.string().min(10).max(500),
      })
      .strict()
      .parse(req.body);
    const row = await db.tenant(a, (tx) => reconcileModelUsage(tx, a, id, input));
    // The row's month on Platform finance changes (its cost and pricing).
    await refreshSummary(db, [dubaiMonthOf(row.created_at)], [a.tenantId]);
    return row;
  });
  app.post(prefix + "/usage-statements", async (req) => {
    const a = finance(req),
      b = z
        .object({
          period: periodSchema,
          fxAedPerUsd: z.number().positive().max(100),
          chargeMinor: z.number().int().min(0).max(1000000000),
          feeScheduleVersion: z.string().min(3).max(100),
          evidenceReference: z.string().min(10).max(500),
        })
        .strict()
        .parse(req.body);
    const rate = await monthRate(db, b.period);
    const statement = await db.tenant(a, (tx) => postUsageStatement(tx, a, b, { rate }));
    await refreshSummary(db, [b.period, dubaiMonthOf(new Date())], [a.tenantId]);
    return statement;
  });
  // What a month's usage statement would charge: the month's rate (reviewed
  // or default), priced, estimated and unpriced rows and the settings applied.
  app.get(prefix + "/usage-preview", async (req) => {
    const a = finance(req);
    const { period } = z
      .object({ period: periodSchema })
      .parse(req.query);
    const rate = await monthRate(db, period);
    return db.tenant(a, async (tx) => {
      // Without a reviewed rate, automatic month close converts at its own
      // approved rate: the preview shows the rate the charge would use.
      const [automation] = await tx.query(
        "SELECT data FROM records WHERE kind='finance_automation'",
      );
      const approved =
        rate.source !== "reviewed" &&
        automation?.data?.enabled &&
        automation.data.closeMonthly &&
        Number(automation.data.fxAedPerUsd) > 0
          ? Number(automation.data.fxAedPerUsd)
          : null;
      const chargeRate = {
        aedPerUsd: rate.source === "reviewed" ? rate.aedPerUsd : (approved ?? rate.aedPerUsd),
        source:
          rate.source === "reviewed"
            ? "reviewed"
            : approved !== null
              ? "automation"
              : "default",
      };
      const [statement] = await tx.query(
        "SELECT * FROM usage_statements WHERE period=$1",
        [period],
      );
      const usage = await periodUsage(tx, period, chargeRate.aedPerUsd);
      // A posted statement: what it charged, and what the month's priced
      // usage comes to now at the statement's rate.
      const posted = statement
        ? await periodUsage(tx, period, Number(statement.fx_aed_per_usd))
        : null;
      return {
        period,
        rate,
        chargeRate,
        usage,
        statement: statement ?? null,
        postedComparison: statement
          ? {
              chargedUsd: statement.total_cost_usd,
              aedPerUsd: Number(statement.fx_aed_per_usd),
              chargeMinor: Number(statement.charge_minor),
              currentChargeableUsd: posted!.chargeableUsd,
              currentChargeMinor: posted!.chargeMinor,
              differenceMinor: posted!.chargeMinor - Number(statement.charge_minor),
            }
          : null,
      };
    });
  });
  // Prices this workspace's unresolved provider calls at their estimate
  // (docs/features/platform-finance.md); the invoice can still correct them.
  app.post(prefix + "/usage/estimate", async (req) => {
    const a = finance(req);
    const b = z
      .object({
        before: periodSchema.optional(),
        evidenceReference: z.string().trim().min(10).max(500),
      })
      .strict()
      .parse(req.body);
    const result = await db.tenant(a, (tx) =>
      estimateUnresolvedUsage(tx, a, {
        before: b.before ? monthCutoff(b.before) : undefined,
        evidenceReference: b.evidenceReference,
        method: "operator",
      }),
    );
    await refreshSummary(db, result.months, [a.tenantId]);
    return result;
  });
  app.post(prefix + "/close", async (req) => {
    const a = finance(req);
    const b = z
      .object({
        period: periodSchema,
        evidenceReference: z.string().min(10).max(500),
      })
      .parse(req.body);
    return db.tenant(a, (tx) =>
      closeMonth(tx, a, b.period, b.evidenceReference),
    );
  });
  app.post(prefix + "/beneficiaries/:id/review", async (req) => {
    const a = finance(req);
    const recordId = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const b = z
      .object({
        verified: z.boolean(),
        // Optional confirmation only. The destination is always the id the
        // provider returned for the owner's submission; a reviewer cannot set it.
        providerId: z.string().min(3).max(200).optional(),
        evidenceReference: z.string().min(10).max(500),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='beneficiary' FOR UPDATE",
        [recordId],
      );
      if (!r) throw fail(404, "NOT_FOUND", "Destination unavailable");
      if (
        r.owner_user_id === a.userId ||
        (await payeeWorkspaceMember(tx, a.tenantId, a.userId))
      )
        throw fail(
          403,
          "SECOND_REVIEWER_REQUIRED",
          "A finance operator independent of this workspace must review destination ownership",
        );
      // Verification only follows the provider accepting the owner's submission.
      // Revocation is always possible for an accepted or unresolved destination.
      if (
        !(b.verified
          ? r.status === "validating"
          : ["validating", "verified", "unknown"].includes(r.status))
      )
        throw fail(
          409,
          "BENEFICIARY_STATE",
          b.verified
            ? "Only a provider-accepted destination awaiting review can be verified"
            : "This destination cannot be rejected in its current state",
        );
      if (b.verified && !r.data.providerId)
        throw fail(
          409,
          "DESTINATION_UNCONFIRMED",
          "The provider has not returned a destination reference for this submission",
        );
      if (b.providerId !== undefined && b.providerId !== r.data.providerId)
        throw fail(
          409,
          "DESTINATION_MISMATCH",
          "The confirmed destination differs from the provider-returned destination; nothing was changed",
        );
      const [updated] = await tx.query(
        "UPDATE records SET status=$2,data=data||$3::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND kind='beneficiary' AND status=$4 RETURNING id",
        [
          r.id,
          b.verified ? "verified" : "rejected",
          JSON.stringify({
            verified: b.verified,
            evidenceReference: b.evidenceReference,
            reviewedBy: a.userId,
            reviewedAt: new Date().toISOString(),
            ...(b.verified
              ? {
                  holdUntil: new Date(Date.now() + 72 * 3600000).toISOString(),
                }
              : {}),
          }),
          r.status,
        ],
      );
      if (!updated)
        throw fail(
          409,
          "BENEFICIARY_STATE",
          "The destination changed during review; reload before reviewing",
        );
      await event(tx, a, "beneficiary.reviewed", r.id, {
        verified: b.verified,
        previousStatus: r.status,
      });
      return { ok: true };
    });
  });
  app.post(prefix + "/payouts/:id/execute", async (req) => {
    const a = finance(req);
    return executePayout(
      db,
      a,
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    );
  });
  app.post(prefix + "/payouts/:id/cancel", async (req) => {
    const a = finance(req);
    const payoutId = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const b = z
      .object({ reason: z.string().trim().min(10).max(500) })
      .strict()
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId,
      ]);
      const [p] = await tx.query(
        "SELECT * FROM payouts WHERE id=$1 FOR UPDATE",
        [payoutId],
      );
      if (!p) throw fail(404, "NOT_FOUND", "Payout unavailable");
      if (p.status === "canceled") return p;
      // A canceled instruction keeps its row and history; the reservation is
      // released and the owner may prepare a new revision for the period.
      if (!["ready", "held"].includes(p.status))
        throw fail(
          409,
          "PAYOUT_STATE",
          "Only an instruction that was never sent to the bank can be canceled; reconcile dispatched instructions instead",
        );
      const canceled = await transitionPayout(tx, a, p.id, "canceled");
      await event(tx, a, "payout.cancel_recorded", p.id, {
        reason: b.reason,
        previousStatus: p.status,
        amountMinor: Number(p.amount_minor),
        beneficiaryId: p.beneficiary_id,
      });
      return canceled;
    });
  });
  app.post(prefix + "/payouts/:id/reconcile", async (req) => {
    const a = finance(req);
    const payoutId = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const b = z
      .object({
        status: z.enum(["processing", "paid", "failed", "returned"]),
        bankReference: z.string().min(5).max(200),
        evidenceReference: z.string().min(10).max(500),
        // The provider-reported outcome showing a dispatched instruction did not settle.
        providerStatus: z.enum(["failed", "rejected", "not_found"]).optional(),
      })
      .parse(req.body);
    if (b.status === "failed" && !b.providerStatus)
      throw fail(
        400,
        "PROVIDER_CONFIRMATION_REQUIRED",
        "Record the provider-reported outcome that shows this instruction did not settle",
      );
    return db.tenant(a, async (tx) => {
      const [current] = await tx.query(
        "SELECT id,tenant_id FROM payouts WHERE id=$1 FOR UPDATE",
        [payoutId],
      );
      if (!current) throw fail(404, "NOT_FOUND", "Payout unavailable");
      // Bank outcomes decide whether another payment may follow, so the payee
      // workspace cannot record them, and the dispatcher (the operator, or the
      // automation approver, recorded on payout.submitted) cannot record a
      // failure or a return, either of which permits another instruction.
      const permitsAnother = b.status === "failed" || b.status === "returned";
      const [dispatch] = permitsAnother
        ? await tx.query(
            "SELECT actor_id FROM events WHERE name='payout.submitted' AND subject_id=$1 ORDER BY created_at LIMIT 1",
            [payoutId],
          )
        : [];
      if (
        dispatch?.actor_id === a.userId ||
        (await payeeWorkspaceMember(tx, current.tenant_id, a.userId))
      )
        throw fail(
          409,
          "SEPARATION_OF_DUTIES",
          "A finance operator independent of the payee workspace, and of the dispatch for a failure or return, must record this outcome",
        );
      const p = await transitionPayout(
        tx,
        a,
        payoutId,
        b.status,
        b.bankReference,
      );
      await event(tx, a, "payout.evidence_recorded", p.id, {
        evidenceReference: b.evidenceReference,
        status: b.status,
        ...(b.providerStatus ? { providerStatus: b.providerStatus } : {}),
      });
      if (b.status === "failed")
        await event(tx, a, "payout.failure_confirmed", p.id, {
          providerStatus: b.providerStatus,
          bankReference: b.bankReference,
          evidenceReference: b.evidenceReference,
        });
      return p;
    });
  });
  app.post(prefix + "/exceptions", async (req) => {
    const a = finance(req);
    const b = z
      .object({
        description: z.string().min(10).max(2000),
        externalReference: z.string().max(200),
      })
      .parse(req.body);
    return db.tenant(a, (tx) =>
      putRecord(tx, a, "reconciliation", b, { status: "open" }),
    );
  });
  app.post(prefix + "/exceptions/:id/resolve", async (req) => {
    const a = finance(req);
    const exceptionId = z
      .string()
      .uuid()
      .parse((req.params as any).id);
    const b = z
      .object({ evidenceReference: z.string().min(10).max(500) })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE records SET status='resolved',data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND kind='reconciliation' AND status<>'resolved' RETURNING id",
        [exceptionId, JSON.stringify({ ...b, resolvedBy: a.userId })],
      );
      if (!r) {
        const [resolved] = await tx.query(
          "SELECT id FROM records WHERE id=$1 AND kind='reconciliation'",
          [exceptionId],
        );
        throw resolved
          ? fail(
              409,
              "EXCEPTION_RESOLVED",
              "This exception is already resolved; its evidence is retained",
            )
          : fail(404, "NOT_FOUND", "Exception unavailable");
      }
      await event(tx, a, "reconciliation.resolved", r.id, b);
      return r;
    });
  });
}
