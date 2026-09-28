import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { elevated, type Actor, type Database, type Tx } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { registrarFromConfig } from "../../../packages/providers/src/registrar.ts";
import { platformWorkspaceSql } from "./workspace-state.ts";
import {
  VOICE_TASK_SQL,
  dubaiMonthRange,
  monthRates,
  periodSchemaText,
  type MonthRate,
} from "./cost-accounting.ts";
import {
  finishRun,
  lastRun,
  platformFinanceJobs,
  ranWithin,
  startRun,
} from "./platform-finance-runs.ts";
import {
  createRecurringCost,
  endRecurringCost,
  platformCostsForMonths,
  postRecurringCosts,
  providerInvoicesForMonths,
  readRegistrarBalance,
  recordPayoutFee,
  recordPlatformCost,
  recurringCosts,
  registrarBook,
  reversePlatformCost,
  stripeFeesForMonths,
  type PlatformCostRow,
} from "./platform-costs.ts";
import { importProviderInvoice, postUsageCorrections } from "./provider-invoices.ts";
import { sweepStripeFees, type StripeFeeClient } from "./stripe-fees.ts";
import { monthCutoff } from "./finance-operations.ts";
import { ProviderUnavailable, stripeClient } from "../../../packages/providers/src/index.ts";
import {
  digitalOceanBillingFromConfig,
  digitalOceanBillingSettings,
} from "../../../packages/providers/src/digitalocean-billing.ts";
import { importDigitalOceanBilling } from "./digitalocean-costs.ts";
// Phase D alert rules register with the platform alert engine at load.
import "./platform-finance-alerts.ts";

// Platform finance phase B (docs/features/platform-finance.md): the Super
// admin's profit and loss across every trainer workspace. Each workspace's
// figures for an Asia/Dubai month are computed from the immutable ledger and
// the provider cost rows into platform_finance_months (migration 075) by the
// worker and on request; the screen and its CSV exports read that summary,
// the platform's own costs (phase C) and the month's reviewed USD to AED
// rate. Income is counted when it is received (owner decision of 28
// September 2026, cash basis): a payment in the month it was journaled,
// never spread over a programme's or domain's term. Costs are counted in the
// month they were incurred. Platform-only: operators with fresh MFA, every
// read and export audited; nothing here is reachable by a trainer.

type Identity = Actor & { platformRole: string; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const DUBAI_OFFSET_MS = 4 * 3600000;
const MONTH = (column: string) =>
  `to_char(${column} AT TIME ZONE 'Asia/Dubai','YYYY-MM')`;
/** USD amounts summed at eight decimals (numeric(18,8)) without float drift. */
const usd8 = (n: number) => Math.round(n * 1e8) / 1e8;
/** Settings → Platform finance: what one delivered email costs (USD). */
export function emailPrice(config = runtimeConfig()) {
  const text = String(config.FINANCE_EMAIL_USD_PER_MESSAGE ?? "").trim();
  const n = text === "" ? 0 : Number(text);
  return n >= 0 && n <= 1 ? n : 0;
}

// ---- Per-workspace monthly figures -----------------------------------------

export type DomainFigures = {
  paymentsMinor: number;
  refundsMinor: number;
  netSalesMinor: number;
  registrarCostMinor: number;
  disputeLossMinor: number;
};
export type WorkspaceMonth = {
  /** Member payments by product (AED minor units, gross). */
  gross: { membership: number; programme: number; voiceAddOn: number; booking: number };
  /**
   * The platform's commission movements by source: earned on each product,
   * from affiliate settlements, and returned on refunds and lost disputes
   * (negative).
   */
  commission: {
    membership: number;
    programme: number;
    voiceAddOn: number;
    booking: number;
    affiliate: number;
    refunds: number;
    disputes: number;
    other: number;
  };
  refundsMinor: number;
  disputesLostMinor: number;
  /** The usage charge (with its markup) and its adjustments, as posted. */
  aiCoachServiceFeeMinor: number;
  /** Allocated costs charged to the trainer. */
  otherChargesMinor: number;
  /** Stripe fees deducted from the trainer at settlement (they pay them). */
  stripeFeesRecoveredMinor: number;
  payoutsPaidMinor: number;
  payoutsReturnedMinor: number;
  /** The trainer's own domain payments to the platform, per currency. */
  domains: Record<string, DomainFigures>;
  domainOrders: Array<{
    orderId: string;
    hostname: string;
    currency: string;
    paidMinor: number;
    refundedMinor: number;
    registrarCostMinor: number;
  }>;
  cost: {
    calls: number;
    aiUsd: number;
    voiceUsd: number;
    estimatedUsd: number;
    reconciledUsd: number;
    unpricedCalls: number;
    unpricedEstimateUsd: number;
    complimentaryUsd: number;
  };
  byFeature: Array<{
    task: string;
    product: string;
    calls: number;
    usd: number;
    estimatedUsd: number;
    unpriced: number;
  }>;
  byProvider: Array<{
    provider: string;
    calls: number;
    usd: number;
    estimatedUsd: number;
    reconciledUsd: number;
    unpriced: number;
    unpricedEstimateUsd: number;
  }>;
  payingMembers: number;
  payouts: Array<{ id: string; status: string; amountMinor: number; revision: number }>;
  /** This month's usage statement (posted after the month ends), if any. */
  usageStatement: { chargeMinor: number } | null;
  /** Emails delivered to the provider for this workspace (phase C email cost). */
  emailsSent: number;
};
const emptyDomain = (): DomainFigures => ({
  paymentsMinor: 0,
  refundsMinor: 0,
  netSalesMinor: 0,
  registrarCostMinor: 0,
  disputeLossMinor: 0,
});
export function emptyWorkspaceMonth(): WorkspaceMonth {
  return {
    gross: { membership: 0, programme: 0, voiceAddOn: 0, booking: 0 },
    commission: {
      membership: 0,
      programme: 0,
      voiceAddOn: 0,
      booking: 0,
      affiliate: 0,
      refunds: 0,
      disputes: 0,
      other: 0,
    },
    refundsMinor: 0,
    disputesLostMinor: 0,
    aiCoachServiceFeeMinor: 0,
    otherChargesMinor: 0,
    stripeFeesRecoveredMinor: 0,
    payoutsPaidMinor: 0,
    payoutsReturnedMinor: 0,
    domains: {},
    domainOrders: [],
    cost: {
      calls: 0,
      aiUsd: 0,
      voiceUsd: 0,
      estimatedUsd: 0,
      reconciledUsd: 0,
      unpricedCalls: 0,
      unpricedEstimateUsd: 0,
      complimentaryUsd: 0,
    },
    byFeature: [],
    byProvider: [],
    payingMembers: 0,
    payouts: [],
    usageStatement: null,
    emailsSent: 0,
  };
}

const SOURCE = `CASE
 WHEN j.source_key LIKE 'stripe-invoice:%' AND j.data->>'purpose'='voice_addon' THEN 'voice_addon'
 WHEN j.source_key LIKE 'stripe-invoice:%' THEN 'membership'
 WHEN j.source_key LIKE 'stripe-programme:%' THEN 'programme'
 WHEN j.source_key LIKE 'booking-charge:%' THEN 'booking'
 WHEN j.source_key LIKE 'stripe-refund:%' OR j.source_key LIKE 'booking-refund:%' THEN 'refund'
 WHEN j.source_key LIKE 'dispute-reserve:%' THEN 'dispute_reserve'
 WHEN j.source_key LIKE 'dispute-resolution:%' THEN 'dispute_resolution'
 WHEN j.source_key LIKE 'affiliate:%' THEN 'affiliate'
 WHEN j.source_key LIKE 'usage:%' OR j.source_key LIKE 'usage-adjustment:%' THEN 'usage'
 WHEN j.source_key LIKE 'allocated-cost:%' THEN 'allocated'
 WHEN j.source_key LIKE 'stripe-settlement:%' THEN 'settlement'
 WHEN j.source_key LIKE 'payout-return:%' THEN 'payout_return'
 WHEN j.source_key LIKE 'payout:%' THEN 'payout'
 WHEN j.source_key LIKE 'web-address-invoice:%' THEN 'domain_payment'
 WHEN j.source_key LIKE 'web-address-refund-reversal:%' THEN 'domain_refund_reversal'
 WHEN j.source_key LIKE 'web-address-refund:%' THEN 'domain_refund'
 WHEN j.source_key LIKE 'web-address-%' THEN 'domain_other'
 ELSE 'other' END`;
const POSITIVE_CHARGE =
  "(j.source_key LIKE 'stripe-invoice:%' OR j.source_key LIKE 'stripe-programme:%') AND coalesce((j.data->>'grossMinor')::bigint,0)>0";

/**
 * One workspace's figures for each of `months` (Dubai months), read in the
 * caller's scoped transaction. Only months with any activity are returned.
 */
export async function workspaceMonths(
  tx: Tx,
  months: string[],
): Promise<Map<string, WorkspaceMonth>> {
  const out = new Map<string, WorkspaceMonth>();
  if (!months.length) return out;
  const sorted = [...months].sort();
  const from = dubaiMonthRange(sorted[0]).from.toISOString();
  const to = dubaiMonthRange(sorted.at(-1)!).to.toISOString();
  const wanted = new Set(months);
  const at = (month: string) => {
    if (!wanted.has(month)) return null;
    let m = out.get(month);
    if (!m) out.set(month, (m = emptyWorkspaceMonth()));
    return m;
  };
  const ledger = await tx.query(
    `SELECT ${MONTH("j.created_at")} AS month,${SOURCE} AS source,l.account,j.currency,sum(l.amount_minor)::text AS amount FROM journals j JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_id=j.id WHERE j.created_at>=$1 AND j.created_at<$2 GROUP BY 1,2,3,4`,
    [from, to],
  );
  for (const row of ledger) {
    const m = at(row.month);
    if (!m) continue;
    const amount = Number(row.amount);
    const source = row.source as string;
    if (source.startsWith("domain_")) {
      const d = (m.domains[row.currency] ??= emptyDomain());
      if (row.account === "web_address_receivable") {
        if (source === "domain_payment") d.paymentsMinor += amount;
        if (source === "domain_refund" || source === "domain_refund_reversal")
          d.refundsMinor -= amount;
      }
      if (row.account === "web_address_revenue") d.netSalesMinor -= amount;
      if (row.account === "registrar_cost") d.registrarCostMinor += amount;
      if (row.account === "web_address_dispute_loss")
        d.disputeLossMinor += amount;
      continue;
    }
    if (row.currency !== "AED") continue;
    if (row.account === "stripe_receivable") {
      if (source === "membership") m.gross.membership += amount;
      if (source === "programme") m.gross.programme += amount;
      if (source === "voice_addon") m.gross.voiceAddOn += amount;
      if (source === "booking") m.gross.booking += amount;
      if (source === "refund") m.refundsMinor -= amount;
      if (source === "dispute_resolution") m.disputesLostMinor -= amount;
    }
    if (row.account === "platform_commission") {
      const c = m.commission;
      const earned = -amount;
      if (source === "membership") c.membership += earned;
      else if (source === "programme") c.programme += earned;
      else if (source === "voice_addon") c.voiceAddOn += earned;
      else if (source === "booking") c.booking += earned;
      else if (source === "affiliate") c.affiliate += earned;
      else if (source === "refund") c.refunds += earned;
      else if (source === "dispute_resolution") c.disputes += earned;
      else c.other += earned;
    }
    if (row.account === "platform_cost_recovery") {
      if (source === "usage") m.aiCoachServiceFeeMinor -= amount;
      else m.otherChargesMinor -= amount;
    }
    if (row.account === "trainer_payable") {
      if (source === "settlement") m.stripeFeesRecoveredMinor += amount;
      if (source === "payout") m.payoutsPaidMinor += amount;
      if (source === "payout_return") m.payoutsReturnedMinor -= amount;
    }
  }
  // Domain profit per order: what the trainer paid, what was refunded and
  // what the registrar charged, in the order's currency.
  const orders = await tx.query(
    `SELECT ${MONTH("j.created_at")} AS month,j.data->>'orderId' AS order_id,max(j.data->>'hostname') AS hostname,j.currency,coalesce(sum(l.amount_minor) FILTER(WHERE l.account='web_address_receivable' AND j.source_key LIKE 'web-address-invoice:%'),0)::text AS paid,coalesce(-sum(l.amount_minor) FILTER(WHERE l.account='web_address_receivable' AND j.source_key LIKE 'web-address-refund%'),0)::text AS refunded,coalesce(sum(l.amount_minor) FILTER(WHERE l.account='registrar_cost'),0)::text AS registrar FROM journals j JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_id=j.id WHERE j.source_key LIKE 'web-address-%' AND j.data ? 'orderId' AND j.created_at>=$1 AND j.created_at<$2 GROUP BY 1,2,4`,
    [from, to],
  );
  for (const o of orders) {
    const m = at(o.month);
    if (!m) continue;
    m.domainOrders.push({
      orderId: o.order_id,
      hostname: String(o.hostname ?? ""),
      currency: o.currency,
      paidMinor: Number(o.paid),
      refundedMinor: Number(o.refunded),
      registrarCostMinor: Number(o.registrar),
    });
  }
  const costs = await tx.query(
    `SELECT ${MONTH("created_at")} AS month,task,coalesce(product,'') AS product,provider,(${VOICE_TASK_SQL}) AS voice,count(*)::int AS calls,coalesce(sum(cost_usd),0)::text AS usd,coalesce(sum(cost_usd) FILTER(WHERE status='estimated'),0)::text AS estimated,coalesce(sum(cost_usd) FILTER(WHERE status='reconciled'),0)::text AS reconciled,count(*) FILTER(WHERE cost_usd IS NULL)::int AS unpriced,coalesce(sum(estimated_cost_usd) FILTER(WHERE cost_usd IS NULL),0)::text AS unpriced_estimate,coalesce(sum(cost_usd) FILTER(WHERE complimentary),0)::text AS complimentary FROM cost_events WHERE created_at>=$1 AND created_at<$2 GROUP BY 1,2,3,4,5`,
    [from, to],
  );
  for (const r of costs) {
    const m = at(r.month);
    if (!m) continue;
    const usd = Number(r.usd);
    m.cost.calls += r.calls;
    if (r.voice) m.cost.voiceUsd += usd;
    else m.cost.aiUsd += usd;
    m.cost.estimatedUsd += Number(r.estimated);
    m.cost.reconciledUsd += Number(r.reconciled);
    m.cost.unpricedCalls += r.unpriced;
    m.cost.unpricedEstimateUsd += Number(r.unpriced_estimate);
    m.cost.complimentaryUsd += Number(r.complimentary);
    const feature = m.byFeature.find(
      (f) => f.task === r.task && f.product === r.product,
    );
    if (feature) {
      feature.calls += r.calls;
      feature.usd += usd;
      feature.estimatedUsd += Number(r.estimated);
      feature.unpriced += r.unpriced;
    } else
      m.byFeature.push({
        task: r.task,
        product: r.product,
        calls: r.calls,
        usd,
        estimatedUsd: Number(r.estimated),
        unpriced: r.unpriced,
      });
    const provider = m.byProvider.find((p) => p.provider === r.provider);
    if (provider) {
      provider.calls += r.calls;
      provider.usd += usd;
      provider.estimatedUsd += Number(r.estimated);
      provider.reconciledUsd += Number(r.reconciled);
      provider.unpriced += r.unpriced;
      provider.unpricedEstimateUsd += Number(r.unpriced_estimate);
    } else
      m.byProvider.push({
        provider: r.provider,
        calls: r.calls,
        usd,
        estimatedUsd: Number(r.estimated),
        reconciledUsd: Number(r.reconciled),
        unpriced: r.unpriced,
        unpricedEstimateUsd: Number(r.unpriced_estimate),
      });
  }
  // Paying members: charged in the month, or holding a paid upfront
  // programme that covers part of it (as in business metrics).
  const payers = await tx.query(
    `SELECT x.month,count(DISTINCT x.member)::int AS n FROM (SELECT ${MONTH("j.created_at")} AS month,j.data->>'userId' AS member FROM journals j WHERE ${POSITIVE_CHARGE} AND j.created_at>=$1 AND j.created_at<$2 UNION ALL SELECT to_char(g,'YYYY-MM'),j.data->>'userId' FROM journals j CROSS JOIN LATERAL generate_series(date_trunc('month',(j.data->>'accessStartsAt')::timestamptz AT TIME ZONE 'Asia/Dubai'),((j.data->>'accessEndsAt')::timestamptz-interval '1 second') AT TIME ZONE 'Asia/Dubai',interval '1 month') g WHERE j.source_key LIKE 'stripe-programme:%' AND coalesce((j.data->>'grossMinor')::bigint,0)>0 AND j.data ? 'accessStartsAt' AND j.data ? 'accessEndsAt' AND (j.data->>'accessEndsAt')::timestamptz>=$1) x GROUP BY 1`,
    [from, to],
  );
  for (const p of payers) {
    const m = wanted.has(p.month) ? at(p.month) : null;
    if (m) m.payingMembers = p.n;
  }
  const payouts = await tx.query(
    "SELECT id,period,status,amount_minor::text AS amount,revision FROM payouts WHERE period=ANY($1::text[]) ORDER BY period,revision",
    [months],
  );
  for (const p of payouts) {
    const m = at(p.period);
    if (m)
      m.payouts.push({
        id: p.id,
        status: p.status,
        amountMinor: Number(p.amount),
        revision: p.revision,
      });
  }
  const statements = await tx.query(
    "SELECT period,charge_minor::text AS charge FROM usage_statements WHERE period=ANY($1::text[])",
    [months],
  );
  for (const s of statements) {
    const m = at(s.period);
    if (m) m.usageStatement = { chargeMinor: Number(s.charge) };
  }
  const emails = await tx.query(
    `SELECT ${MONTH("created_at")} AS month,count(*)::int AS n FROM jobs WHERE kind='email' AND status='completed' AND created_at>=$1 AND created_at<$2 GROUP BY 1`,
    [from, to],
  );
  for (const e of emails) {
    const m = out.get(e.month) ?? (e.n ? at(e.month) : null);
    if (m) m.emailsSent = e.n;
  }
  for (const m of out.values()) {
    for (const key of Object.keys(m.cost) as Array<keyof WorkspaceMonth["cost"]>)
      if (key !== "calls" && key !== "unpricedCalls") m.cost[key] = usd8(m.cost[key]);
    for (const f of m.byFeature) {
      f.usd = usd8(f.usd);
      f.estimatedUsd = usd8(f.estimatedUsd);
    }
    for (const p of m.byProvider) {
      p.usd = usd8(p.usd);
      p.estimatedUsd = usd8(p.estimatedUsd);
      p.reconciledUsd = usd8(p.reconciledUsd);
      p.unpricedEstimateUsd = usd8(p.unpricedEstimateUsd);
    }
  }
  return out;
}
/** An operator's read of a workspace, or the worker's when no one asked. */
const operatorScope = (userId: string | null, tenantId: string) =>
  userId
    ? elevated("platform-operator", { tenantId, userId, role: "finance" })
    : elevated("worker", { tenantId, role: "finance" });
/** Trainer workspaces (platform administration workspaces are not trainers). */
async function trainerWorkspaces(db: Database) {
  return db.system((tx) =>
    tx.query<{ id: string; name: string; lifecycle_state: string }>(
      "SELECT t.id,t.name,t.lifecycle_state FROM tenants t WHERE NOT " +
        platformWorkspaceSql("t.id") +
        " ORDER BY t.id",
    ),
  );
}

/** Dubai months from `from` to `to` inclusive, oldest first (at most 36). */
export function monthsBetween(from: string, to: string) {
  if (!periodSchemaText.test(from) || !periodSchemaText.test(to))
    throw fail(400, "PERIOD_INVALID", "Use months as YYYY-MM");
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const count = (ty - fy) * 12 + (tm - fm) + 1;
  if (count < 1) throw fail(400, "PERIOD_INVALID", "The start is after the end");
  if (count > 36)
    throw fail(400, "PERIOD_TOO_LONG", "Choose at most 36 months at a time");
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(fy, fm - 1 + i, 1)).toISOString().slice(0, 7),
  );
}
export function currentDubaiMonth(now = new Date()) {
  return new Date(now.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 7);
}
export function previousMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/**
 * Rebuilds the monthly summary for `months` from every trainer workspace's
 * ledger and cost rows (one scoped read per workspace). Replaces the rows'
 * figures; the ledger is never changed.
 */
export async function rebuildPlatformSummary(
  db: Database,
  months: string[],
  actorId: string | null = null,
) {
  const run = await startRun(db, "summary", actorId, { months });
  try {
    let rows = 0;
    for (const w of await trainerWorkspaces(db)) {
      const figures = await db.tenant(operatorScope(actorId, w.id), (tx) =>
        workspaceMonths(tx, months),
      );
      if (!figures.size) continue;
      await db.system(async (tx) => {
        for (const [month, m] of figures) {
          await tx.query(
            "INSERT INTO platform_finance_months(month,tenant_id,figures,computed_at) VALUES($1,$2,$3,now()) ON CONFLICT(month,tenant_id) DO UPDATE SET figures=EXCLUDED.figures,computed_at=now()",
            [month, w.id, JSON.stringify(m)],
          );
          rows++;
        }
      });
    }
    await finishRun(db, run, { result: { rows } });
    return { months, rows };
  } catch (error) {
    await finishRun(db, run, {
      error: (error as Error).message || "Summary rebuild failed",
    });
    throw error;
  }
}

/** Throws ProviderUnavailable when no registrar is configured (nothing is sent). */
function readRegistrarBalanceCheck() {
  registrarFromConfig();
}
/** Records one registrar balance reading as a run; a failure is recorded too. */
export async function checkRegistrarBalance(db: Database, actorId: string | null) {
  const run = await startRun(db, "registrar_balance", actorId);
  try {
    const balance = await readRegistrarBalance();
    await finishRun(db, run, { result: balance });
    return { ...balance, at: new Date().toISOString() };
  } catch (error) {
    const message =
      (error as Error).message || "The registrar balance could not be read";
    await finishRun(db, run, { error: message });
    throw fail(502, "REGISTRAR_BALANCE_UNAVAILABLE", message.slice(0, 300));
  }
}

// ---- The profit and loss ------------------------------------------------------

export type PnlLine = { key: string; label: string; aedMinor: number };
export type MonthPnl = {
  month: string;
  rate: MonthRate;
  income: PnlLine[];
  costs: PnlLine[];
  incomeMinor: number;
  costsMinor: number;
  profitMinor: number;
  margin: number | null;
  /** Figures not in the totals, and why a figure is incomplete. */
  notes: string[];
  estimatedCostMinor: number;
  unpricedCalls: number;
  unpricedEstimateMinor: number;
  change: { incomeMinor: number | null; costsMinor: number | null; profitMinor: number | null };
};
const toAed = (minor: number, currency: string, rate: number) =>
  currency === "AED" ? minor : currency === "USD" ? Math.round(minor * rate) : 0;
const usdToAedMinor = (usd: number, rate: number) => Math.round(usd * rate * 100);
const rateOf = (n: number, d: number) =>
  d > 0 ? Math.round((n / d) * 10000) / 10000 : null;

/** One month's profit and loss from its workspace figures and platform costs. */
export function monthPnl(
  month: string,
  rate: MonthRate,
  workspaces: WorkspaceMonth[],
  platform: PlatformCostRow[],
  extras: {
    /** Stripe's fees per payment recorded for the month (AED), or null. */
    stripeFeesMinor?: number | null;
    /** Email messages delivered and the configured price per message. */
    emails?: { sent: number; usdPerMessage: number };
  } = {},
): Omit<MonthPnl, "change"> {
  const r = rate.aedPerUsd;
  const sum = (pick: (w: WorkspaceMonth) => number) =>
    workspaces.reduce((n, w) => n + pick(w), 0);
  const domain = (pick: (d: DomainFigures) => number) =>
    workspaces.reduce(
      (n, w) =>
        n +
        Object.entries(w.domains).reduce(
          (m, [currency, d]) => m + toAed(pick(d), currency, r),
          0,
        ),
      0,
    );
  const notes: string[] = [];
  // Stripe's fee on each payment (domain payments included) when it was
  // read from Stripe; otherwise the fees deducted at settlement.
  const recorded = extras.stripeFeesMinor ?? null;
  const stripeFeesMinor = recorded ?? sum((w) => w.stripeFeesRecoveredMinor);
  if (
    recorded === null &&
    sum((w) => w.gross.membership + w.gross.programme + w.gross.voiceAddOn + w.gross.booking) +
      domain((d) => d.paymentsMinor) >
      0
  )
    notes.push(
      "Stripe fees are the fees recorded at settlement; Stripe's fee per payment is not recorded for this month yet.",
    );
  const emailMinor = extras.emails
    ? usdToAedMinor(extras.emails.sent * extras.emails.usdPerMessage, r)
    : 0;
  if (extras.emails?.sent && !extras.emails.usdPerMessage)
    notes.push(
      `${extras.emails.sent} email(s) delivered; no price per message is set (Settings → Platform finance), so only the email plan (platform costs) is counted.`,
    );
  const platformCost = (categories: string[] | null, exclude: string[] = []) =>
    platform
      .filter(
        (c) =>
          (categories ? categories.includes(c.category) : true) &&
          !exclude.includes(c.category),
      )
      .reduce((n, c) => n + toAed(c.amountMinor, c.currency, r), 0);
  const income: PnlLine[] = [
    { key: "subscriptions", label: "Subscriptions (commission)", aedMinor: sum((w) => w.commission.membership) },
    { key: "programmes", label: "Upfront programmes (commission)", aedMinor: sum((w) => w.commission.programme) },
    { key: "voiceAddOn", label: "Voice add-on (commission)", aedMinor: sum((w) => w.commission.voiceAddOn) },
    { key: "sessions", label: "1:1 sessions (booking fee)", aedMinor: sum((w) => w.commission.booking) },
    { key: "affiliate", label: "Affiliate settlements", aedMinor: sum((w) => w.commission.affiliate + w.commission.other) },
    { key: "domains", label: "Domains (trainer payments)", aedMinor: domain((d) => d.paymentsMinor) },
    { key: "aiCoachServiceFee", label: "AI Coach Service Fee", aedMinor: sum((w) => w.aiCoachServiceFeeMinor) },
    { key: "otherCharges", label: "Other costs charged to trainers", aedMinor: sum((w) => w.otherChargesMinor) },
    { key: "stripeFeesRecovered", label: "Stripe fees paid by trainers", aedMinor: sum((w) => w.stripeFeesRecoveredMinor) },
  ];
  const aiUsd = workspaces.reduce((n, w) => n + w.cost.aiUsd, 0);
  const voiceUsd = workspaces.reduce((n, w) => n + w.cost.voiceUsd, 0);
  const costs: PnlLine[] = [
    { key: "aiProvider", label: "AI provider cost", aedMinor: usdToAedMinor(aiUsd, r) },
    { key: "voiceProvider", label: "Voice provider cost", aedMinor: usdToAedMinor(voiceUsd, r) },
    { key: "stripeFees", label: "Stripe fees", aedMinor: stripeFeesMinor },
    { key: "payoutFees", label: "Payout bank fees", aedMinor: platformCost(["payout_fee"]) },
    { key: "registrar", label: "Domain registrar cost", aedMinor: domain((d) => d.registrarCostMinor) },
    { key: "platform", label: "Platform costs (servers, email plan, provider plans)", aedMinor: platformCost(null, ["payout_fee", "registrar_topup", "provider_invoice"]) },
    { key: "providerInvoices", label: "Provider invoice charges not attributed to calls", aedMinor: platformCost(["provider_invoice"]) },
    { key: "email", label: "Email (per message)", aedMinor: emailMinor },
    {
      key: "refundsDisputes",
      label: "Refunds and disputes (commission returned, domain refunds and losses)",
      aedMinor:
        -sum((w) => w.commission.refunds + w.commission.disputes) +
        domain((d) => d.refundsMinor + d.disputeLossMinor),
    },
  ];
  const incomeMinor = income.reduce((n, l) => n + l.aedMinor, 0);
  const costsMinor = costs.reduce((n, l) => n + l.aedMinor, 0);
  const unpricedCalls = sum((w) => w.cost.unpricedCalls);
  const unpricedUsd = workspaces.reduce((n, w) => n + w.cost.unpricedEstimateUsd, 0);
  if (unpricedCalls)
    notes.push(
      `${unpricedCalls} provider call(s) are not priced yet (about ${usdToAedMinor(unpricedUsd, r) / 100} AED, not included).`,
    );
  if (rate.source === "default")
    notes.push(`No reviewed USD to AED rate for ${month}: the default rate ${r} converts USD figures.`);
  if (platform.some((c) => c.estimated))
    notes.push("Some platform costs are estimates until their invoice arrives.");
  return {
    month,
    rate,
    income,
    costs,
    incomeMinor,
    costsMinor,
    profitMinor: incomeMinor - costsMinor,
    margin: rateOf(incomeMinor - costsMinor, incomeMinor),
    notes,
    estimatedCostMinor: usdToAedMinor(
      workspaces.reduce((n, w) => n + w.cost.estimatedUsd, 0),
      r,
    ),
    unpricedCalls,
    unpricedEstimateMinor: usdToAedMinor(unpricedUsd, r),
  };
}

export type TrainerRow = {
  tenantId: string;
  name: string;
  state: string;
  grossMinor: number;
  commissionMinor: number;
  aiCoachServiceFeeMinor: number;
  otherChargesMinor: number;
  domainPaymentsMinor: number;
  domainProfitMinor: number;
  platformIncomeMinor: number;
  providerCostMinor: number;
  refundsDisputesMinor: number;
  contributionMinor: number;
  margin: number | null;
  payingMemberMonths: number;
  costPerPayingMemberMinor: number | null;
  stripeFeesMinor: number;
  payoutsPaidMinor: number;
  unpricedCalls: number;
  flags: string[];
};
export type Flag = {
  kind:
    | "cost_without_income"
    | "negative_contribution"
    | "usage_not_charged"
    | "unpriced_usage"
    | "domain_below_cost"
    | "platform_cost_without_income";
  severity: "warning" | "info";
  month: string | null;
  tenantId: string | null;
  name: string | null;
  detail: string;
};

/**
 * The Platform finance screen's data for a range of Dubai months, from the
 * monthly summary, the platform's own costs and each month's rate. Months
 * the summary has not covered yet are listed in `missingMonths`.
 */
export async function platformPnl(
  db: Database,
  input: { from: string; to: string; now?: Date },
) {
  const months = monthsBetween(input.from, input.to);
  const now = input.now ?? new Date();
  const current = currentDubaiMonth(now);
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT s.month,s.tenant_id,s.figures,s.computed_at,t.name,t.lifecycle_state FROM platform_finance_months s JOIN tenants t ON t.id=s.tenant_id WHERE s.month=ANY($1::text[]) ORDER BY s.month,t.name,s.tenant_id",
      [months],
    ),
  );
  const [summaryRun] = await db.system((tx) =>
    tx.query(
      "SELECT max(finished_at) AS at,bool_or(result->'months' ?| $1::text[]) AS covered FROM platform_finance_runs WHERE kind='summary' AND status='succeeded'",
      [months],
    ),
  );
  const covered = new Set<string>(
    (
      await db.system((tx) =>
        tx.query(
          "SELECT DISTINCT jsonb_array_elements_text(result->'months') AS month FROM platform_finance_runs WHERE kind='summary' AND status='succeeded' AND result ? 'months'",
        ),
      )
    ).map((r: any) => r.month),
  );
  const missingMonths = months.filter((m) => !covered.has(m));
  const rates = await monthRates(db, [...new Set([...months, previousMonth(months[0])])]);
  const platformCosts = await platformCostsForMonths(db, months);
  const stripeFees = await stripeFeesForMonths(db, months);
  const feeMinor = (month: string, tenantId?: string) => {
    const rows = stripeFees.filter(
      (f) => f.month === month && (tenantId === undefined || f.tenantId === tenantId),
    );
    if (!rows.length) return null;
    const r = rates.get(month)?.aedPerUsd ?? 3.6725;
    return rows.reduce((n, f) => n + toAed(f.feeMinor, f.currency, r), 0);
  };
  const usdPerEmail = emailPrice();
  const byMonth = new Map<string, Array<{ tenantId: string; name: string; state: string; f: WorkspaceMonth }>>();
  for (const r of rows) {
    const list = byMonth.get(r.month) ?? [];
    list.push({ tenantId: r.tenant_id, name: r.name, state: r.lifecycle_state, f: { ...emptyWorkspaceMonth(), ...r.figures } });
    byMonth.set(r.month, list);
  }
  const pnl: MonthPnl[] = [];
  let previous: Omit<MonthPnl, "change"> | null = null;
  for (const month of months) {
    const list = (byMonth.get(month) ?? []).map((x) => x.f);
    const p = monthPnl(
      month,
      rates.get(month)!,
      list,
      platformCosts.filter((c) => c.month === month),
      {
        stripeFeesMinor: feeMinor(month),
        emails: {
          sent: list.reduce((n, f) => n + (f.emailsSent ?? 0), 0),
          usdPerMessage: usdPerEmail,
        },
      },
    );
    pnl.push({
      ...p,
      change: previous
        ? {
            incomeMinor: p.incomeMinor - previous.incomeMinor,
            costsMinor: p.costsMinor - previous.costsMinor,
            profitMinor: p.profitMinor - previous.profitMinor,
          }
        : { incomeMinor: null, costsMinor: null, profitMinor: null },
    });
    previous = p;
  }
  const total = (() => {
    const keys = (side: "income" | "costs") =>
      pnl[0]?.[side].map((l) => ({
        key: l.key,
        label: l.label,
        aedMinor: pnl.reduce(
          (n, m) => n + (m[side].find((x) => x.key === l.key)?.aedMinor ?? 0),
          0,
        ),
      })) ?? [];
    const incomeMinor = pnl.reduce((n, m) => n + m.incomeMinor, 0);
    const costsMinor = pnl.reduce((n, m) => n + m.costsMinor, 0);
    return {
      income: keys("income"),
      costs: keys("costs"),
      incomeMinor,
      costsMinor,
      profitMinor: incomeMinor - costsMinor,
      margin: rateOf(incomeMinor - costsMinor, incomeMinor),
      estimatedCostMinor: pnl.reduce((n, m) => n + m.estimatedCostMinor, 0),
      unpricedCalls: pnl.reduce((n, m) => n + m.unpricedCalls, 0),
    };
  })();

  // Per trainer: income the platform earned from them against what serving
  // them cost, over the range.
  const trainers = new Map<string, TrainerRow>();
  const flags: Flag[] = [];
  for (const [month, list] of byMonth) {
    const r = rates.get(month)!.aedPerUsd;
    for (const x of list) {
      const f = x.f;
      const t =
        trainers.get(x.tenantId) ??
        ({
          tenantId: x.tenantId,
          name: x.name,
          state: x.state,
          grossMinor: 0,
          commissionMinor: 0,
          aiCoachServiceFeeMinor: 0,
          otherChargesMinor: 0,
          domainPaymentsMinor: 0,
          domainProfitMinor: 0,
          platformIncomeMinor: 0,
          providerCostMinor: 0,
          refundsDisputesMinor: 0,
          contributionMinor: 0,
          margin: null,
          payingMemberMonths: 0,
          costPerPayingMemberMinor: null,
          stripeFeesMinor: 0,
          payoutsPaidMinor: 0,
          unpricedCalls: 0,
          flags: [],
        } satisfies TrainerRow);
      const commission =
        f.commission.membership +
        f.commission.programme +
        f.commission.voiceAddOn +
        f.commission.booking +
        f.commission.affiliate +
        f.commission.other;
      const returned = -(f.commission.refunds + f.commission.disputes);
      const domainPaid = Object.entries(f.domains).reduce(
        (n, [c, d]) => n + toAed(d.paymentsMinor, c, r),
        0,
      );
      const domainLoss = Object.entries(f.domains).reduce(
        (n, [c, d]) =>
          n + toAed(d.refundsMinor + d.disputeLossMinor + d.registrarCostMinor, c, r),
        0,
      );
      const provider = usdToAedMinor(f.cost.aiUsd + f.cost.voiceUsd, r);
      const income = commission + f.aiCoachServiceFeeMinor + f.otherChargesMinor + domainPaid;
      t.grossMinor += f.gross.membership + f.gross.programme + f.gross.voiceAddOn + f.gross.booking;
      t.commissionMinor += commission - returned;
      t.aiCoachServiceFeeMinor += f.aiCoachServiceFeeMinor;
      t.otherChargesMinor += f.otherChargesMinor;
      t.domainPaymentsMinor += domainPaid;
      t.domainProfitMinor += domainPaid - domainLoss;
      t.platformIncomeMinor += income;
      t.providerCostMinor += provider;
      t.refundsDisputesMinor += returned;
      t.contributionMinor += income - returned - domainLoss - provider;
      t.payingMemberMonths += f.payingMembers;
      t.stripeFeesMinor += feeMinor(month, x.tenantId) ?? f.stripeFeesRecoveredMinor;
      t.payoutsPaidMinor += f.payoutsPaidMinor - f.payoutsReturnedMinor;
      t.unpricedCalls += f.cost.unpricedCalls;
      trainers.set(x.tenantId, t);
      // Cost against income, month by month (owner decision: no budget
      // limits; costs without matching income are flagged instead).
      if (provider > 0 && income - returned <= 0)
        flags.push({
          kind: "cost_without_income",
          severity: "warning",
          month,
          tenantId: x.tenantId,
          name: x.name,
          detail: `${x.name}: AI and voice cost of AED ${(provider / 100).toFixed(2)} in ${month} with no platform income from this trainer in the month.`,
        });
      if (
        month < current &&
        f.cost.calls > 0 &&
        !f.usageStatement &&
        month !== previousMonth(current)
      )
        flags.push({
          kind: "usage_not_charged",
          severity: "warning",
          month,
          tenantId: x.tenantId,
          name: x.name,
          detail: `${x.name}: ${month} has AI and voice usage but no AI Coach Service Fee posted yet.`,
        });
      if (f.cost.unpricedCalls > 0)
        flags.push({
          kind: "unpriced_usage",
          severity: "info",
          month,
          tenantId: x.tenantId,
          name: x.name,
          detail: `${x.name}: ${f.cost.unpricedCalls} provider call(s) in ${month} are not priced yet.`,
        });
      for (const o of f.domainOrders)
        if (o.paidMinor > 0 && o.registrarCostMinor > o.paidMinor - o.refundedMinor)
          flags.push({
            kind: "domain_below_cost",
            severity: "warning",
            month,
            tenantId: x.tenantId,
            name: x.name,
            detail: `${o.hostname || o.orderId}: the registrar charged ${o.currency} ${(o.registrarCostMinor / 100).toFixed(2)}, more than the ${o.currency} ${((o.paidMinor - o.refundedMinor) / 100).toFixed(2)} kept from the trainer.`,
          });
    }
  }
  for (const t of trainers.values()) {
    t.margin = rateOf(t.contributionMinor, t.platformIncomeMinor);
    t.costPerPayingMemberMinor =
      t.payingMemberMonths > 0
        ? Math.round(t.providerCostMinor / t.payingMemberMonths)
        : null;
    if (t.contributionMinor < 0) {
      t.flags.push("negative_contribution");
      flags.push({
        kind: "negative_contribution",
        severity: "warning",
        month: null,
        tenantId: t.tenantId,
        name: t.name,
        detail: `${t.name}: serving this trainer cost AED ${(-t.contributionMinor / 100).toFixed(2)} more than the platform earned from them over the period.`,
      });
    }
    for (const f of flags)
      if (f.tenantId === t.tenantId && !t.flags.includes(f.kind)) t.flags.push(f.kind);
  }
  for (const m of pnl) {
    const platform = platformCosts.filter((c) => c.month === m.month);
    const platformMinor = platform.reduce(
      (n, c) =>
        n + (c.category === "registrar_topup" ? 0 : toAed(c.amountMinor, c.currency, m.rate.aedPerUsd)),
      0,
    );
    if (platformMinor > 0 && m.incomeMinor <= 0)
      flags.push({
        kind: "platform_cost_without_income",
        severity: "warning",
        month: m.month,
        tenantId: null,
        name: null,
        detail: `${m.month}: platform costs of AED ${(platformMinor / 100).toFixed(2)} with no income in the month.`,
      });
  }

  // Features and providers across trainers.
  const features = new Map<string, any>();
  const providers = new Map<string, any>();
  for (const [month, list] of byMonth) {
    const r = rates.get(month)!.aedPerUsd;
    for (const { f } of list) {
      for (const x of f.byFeature) {
        const key = x.task + "|" + x.product;
        const e = features.get(key) ?? { task: x.task, product: x.product, calls: 0, usd: 0, estimatedUsd: 0, unpriced: 0, aedMinor: 0 };
        e.calls += x.calls;
        e.usd = usd8(e.usd + x.usd);
        e.estimatedUsd = usd8(e.estimatedUsd + x.estimatedUsd);
        e.unpriced += x.unpriced;
        e.aedMinor += usdToAedMinor(x.usd, r);
        features.set(key, e);
      }
      for (const x of f.byProvider) {
        const e = providers.get(x.provider) ?? { provider: x.provider, calls: 0, usd: 0, estimatedUsd: 0, reconciledUsd: 0, unpriced: 0, unpricedEstimateUsd: 0, aedMinor: 0, invoicedUsd: null as number | null, planUsd: null as number | null, invoices: [] as any[] };
        e.calls += x.calls;
        e.usd = usd8(e.usd + x.usd);
        e.estimatedUsd = usd8(e.estimatedUsd + x.estimatedUsd);
        e.reconciledUsd = usd8(e.reconciledUsd + x.reconciledUsd);
        e.unpriced += x.unpriced;
        e.unpricedEstimateUsd = usd8(e.unpricedEstimateUsd + x.unpricedEstimateUsd);
        e.aedMinor += usdToAedMinor(x.usd, r);
        providers.set(x.provider, e);
      }
    }
  }
  for (const invoice of await providerInvoicesForMonths(db, months)) {
    const e = providers.get(invoice.provider) ?? { provider: invoice.provider, calls: 0, usd: 0, estimatedUsd: 0, reconciledUsd: 0, unpriced: 0, unpricedEstimateUsd: 0, aedMinor: 0, invoicedUsd: null, planUsd: null, invoices: [] };
    // Usage lines are compared with the calls' cost; plan fees are apart.
    e.invoicedUsd = usd8((e.invoicedUsd ?? 0) + invoice.usageUsd);
    e.planUsd = usd8((e.planUsd ?? 0) + invoice.planUsd);
    e.invoices.push(invoice);
    providers.set(invoice.provider, e);
  }

  // Domains: every order with activity in the range, and the totals per
  // currency; the registrar's book balance and last reading.
  const domainOrders = new Map<string, any>();
  const domainTotals: Record<string, DomainFigures> = {};
  for (const [, list] of byMonth)
    for (const x of list) {
      for (const [currency, d] of Object.entries(x.f.domains)) {
        const t = (domainTotals[currency] ??= emptyDomain());
        for (const k of Object.keys(t) as Array<keyof DomainFigures>) t[k] += d[k];
      }
      for (const o of x.f.domainOrders) {
        const key = o.orderId + "|" + o.currency;
        const e = domainOrders.get(key) ?? { ...o, paidMinor: 0, refundedMinor: 0, registrarCostMinor: 0, workspace: x.name, tenantId: x.tenantId };
        e.paidMinor += o.paidMinor;
        e.refundedMinor += o.refundedMinor;
        e.registrarCostMinor += o.registrarCostMinor;
        e.hostname ||= o.hostname;
        domainOrders.set(key, e);
      }
    }
  const orders = [...domainOrders.values()].map((o) => ({
    ...o,
    profitMinor: o.paidMinor - o.refundedMinor - o.registrarCostMinor,
    belowCost: o.paidMinor > 0 && o.registrarCostMinor > o.paidMinor - o.refundedMinor,
  }));

  const payouts = rows.flatMap((r: any) =>
    ((r.figures.payouts ?? []) as WorkspaceMonth["payouts"]).map((p) => ({
      ...p,
      period: r.month,
      tenantId: r.tenant_id,
      workspace: r.name,
    })),
  );
  const payoutFees = platformCosts.filter((c) => c.category === "payout_fee");
  for (const p of payouts as any[]) {
    const fee = payoutFees.find((c) => c.payoutId === p.id);
    p.bankFeeMinor = fee ? fee.amountMinor : null;
    p.bankFeeCurrency = fee ? fee.currency : null;
  }

  // Month over month, per line (phase D trends).
  const trends = (["income", "costs"] as const).flatMap((side) =>
    (pnl[0]?.[side] ?? []).map((l) => ({
      side,
      key: l.key,
      label: l.label,
      series: pnl.map((m, i) => {
        const value = m[side].find((x) => x.key === l.key)?.aedMinor ?? 0;
        const before = i > 0 ? (pnl[i - 1][side].find((x) => x.key === l.key)?.aedMinor ?? 0) : null;
        return {
          month: m.month,
          aedMinor: value,
          changeMinor: before === null ? null : value - before,
          changePercent: before ? Math.round(((value - before) / Math.abs(before)) * 1000) / 10 : null,
        };
      }),
    })),
  );
  return {
    range: { from: months[0], to: months.at(-1)!, months },
    trends,
    currency: "AED",
    timezone: "Asia/Dubai",
    basis:
      "Cash basis (owner decision, 28 September 2026): income is counted in the month it was received and never spread over a programme's or domain's term; costs in the month they were incurred. USD figures are converted at each month's reviewed rate, or the default rate where none is reviewed.",
    summary: {
      computedAt: summaryRun?.at ?? null,
      missingMonths,
      rows: rows.length,
    },
    months: pnl,
    total,
    trainers: [...trainers.values()].sort((a, b) => a.contributionMinor - b.contributionMinor),
    features: [...features.values()].sort((a, b) => b.usd - a.usd),
    providers: [...providers.values()].sort((a, b) => b.usd - a.usd),
    domains: {
      totals: domainTotals,
      orders: orders.sort((a, b) => a.profitMinor - b.profitMinor),
      registrar: await registrarBook(db),
    },
    payouts: payouts.sort((a: any, b: any) => (a.period < b.period ? 1 : -1)),
    platformCosts,
    flags,
  };
}

// ---- CSV exports -----------------------------------------------------------------

/** One CSV cell: quoted when needed; a leading formula character is neutralized. */
export function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const safe =
    /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? "'" + text : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
export function toCsv(header: string[], rows: unknown[][]) {
  return [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}
const aed = (minor: number) => (minor / 100).toFixed(2);

export function pnlCsv(data: Awaited<ReturnType<typeof platformPnl>>, tab: string) {
  if (tab === "pnl" || tab === "summary") {
    const keys = [
      ...(data.months[0]?.income ?? []).map((l) => ["income", l.key, l.label] as const),
      ...(data.months[0]?.costs ?? []).map((l) => ["costs", l.key, l.label] as const),
    ];
    return toCsv(
      ["month", "aed_per_usd", "rate_source", ...keys.map(([side, key]) => `${side}_${key}_aed`), "income_aed", "costs_aed", "profit_aed", "margin", "income_change_aed", "costs_change_aed", "profit_change_aed", "estimated_cost_aed", "unpriced_calls", "notes"],
      data.months.map((m) => [
        m.month,
        m.rate.aedPerUsd,
        m.rate.source,
        ...keys.map(([side, key]) => aed(m[side].find((l) => l.key === key)?.aedMinor ?? 0)),
        aed(m.incomeMinor),
        aed(m.costsMinor),
        aed(m.profitMinor),
        m.margin,
        m.change.incomeMinor === null ? "" : aed(m.change.incomeMinor),
        m.change.costsMinor === null ? "" : aed(m.change.costsMinor),
        m.change.profitMinor === null ? "" : aed(m.change.profitMinor),
        aed(m.estimatedCostMinor),
        m.unpricedCalls,
        m.notes.join(" "),
      ]),
    );
  }
  if (tab === "trainers")
    return toCsv(
      ["tenant_id", "trainer", "state", "gross_aed", "net_commission_aed", "ai_coach_service_fee_aed", "other_charges_aed", "domain_payments_aed", "domain_profit_aed", "platform_income_aed", "ai_voice_cost_aed", "refunds_disputes_aed", "contribution_aed", "margin", "paying_member_months", "cost_per_paying_member_aed", "stripe_fees_aed", "payouts_paid_aed", "unpriced_calls", "flags"],
      data.trainers.map((t) => [t.tenantId, t.name, t.state, aed(t.grossMinor), aed(t.commissionMinor), aed(t.aiCoachServiceFeeMinor), aed(t.otherChargesMinor), aed(t.domainPaymentsMinor), aed(t.domainProfitMinor), aed(t.platformIncomeMinor), aed(t.providerCostMinor), aed(t.refundsDisputesMinor), aed(t.contributionMinor), t.margin, t.payingMemberMonths, t.costPerPayingMemberMinor === null ? "" : aed(t.costPerPayingMemberMinor), aed(t.stripeFeesMinor), aed(t.payoutsPaidMinor), t.unpricedCalls, t.flags.join(" ")]),
    );
  if (tab === "features")
    return toCsv(
      ["feature", "product", "calls", "cost_usd", "estimated_usd", "unpriced_calls", "cost_aed"],
      data.features.map((f) => [f.task, f.product, f.calls, f.usd, f.estimatedUsd, f.unpriced, aed(f.aedMinor)]),
    );
  if (tab === "providers")
    return toCsv(
      ["provider", "calls", "cost_usd", "estimated_usd", "reconciled_usd", "unpriced_calls", "unpriced_estimate_usd", "invoiced_usage_usd", "invoiced_plan_usd", "cost_aed"],
      data.providers.map((p) => [p.provider, p.calls, p.usd, p.estimatedUsd, p.reconciledUsd, p.unpriced, p.unpricedEstimateUsd, p.invoicedUsd ?? "", p.planUsd ?? "", aed(p.aedMinor)]),
    );
  if (tab === "domains")
    return toCsv(
      ["order_id", "hostname", "workspace", "currency", "paid", "refunded", "registrar_cost", "profit", "below_cost"],
      data.domains.orders.map((o: any) => [o.orderId, o.hostname, o.workspace, o.currency, aed(o.paidMinor), aed(o.refundedMinor), aed(o.registrarCostMinor), aed(o.profitMinor), o.belowCost]),
    );
  if (tab === "payouts")
    return toCsv(
      ["payout_id", "workspace", "period", "status", "revision", "amount_aed", "bank_fee", "bank_fee_currency"],
      data.payouts.map((p: any) => [p.id, p.workspace, p.period, p.status, p.revision, aed(p.amountMinor), p.bankFeeMinor === null ? "" : aed(p.bankFeeMinor), p.bankFeeCurrency ?? ""]),
    );
  if (tab === "flags")
    return toCsv(
      ["kind", "severity", "month", "workspace", "detail"],
      data.flags.map((f) => [f.kind, f.severity, f.month ?? "", f.name ?? "", f.detail]),
    );
  throw fail(404, "EXPORT_UNKNOWN", "Unknown export");
}

/** Every journal line of every trainer workspace in the range. */
export async function ledgerCsv(db: Database, a: Actor, months: string[]) {
  const from = dubaiMonthRange(months[0]).from.toISOString();
  const to = dubaiMonthRange(months.at(-1)!).to.toISOString();
  const out: unknown[][] = [];
  for (const w of await trainerWorkspaces(db)) {
    const rows = await db.tenant(operatorScope(a.userId, w.id), (tx) =>
      tx.query(
        `SELECT j.id,j.source_key,j.description,j.currency,j.created_at,${MONTH("j.created_at")} AS month,l.account,l.amount_minor::text AS amount FROM journals j JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_id=j.id WHERE j.created_at>=$1 AND j.created_at<$2 ORDER BY j.created_at,j.id,l.account`,
        [from, to],
      ),
    );
    for (const r of rows)
      out.push([w.id, w.name, r.month, r.created_at, r.id, r.source_key, r.description, r.account, r.amount, r.currency]);
  }
  return toCsv(
    ["tenant_id", "workspace", "month", "created_at", "journal_id", "source_key", "description", "account", "amount_minor", "currency"],
    out,
  );
}
/** Every provider cost row of every trainer workspace, then the platform's costs. */
export async function costsCsv(db: Database, a: Actor, months: string[]) {
  const from = dubaiMonthRange(months[0]).from.toISOString();
  const to = dubaiMonthRange(months.at(-1)!).to.toISOString();
  const out: unknown[][] = [];
  for (const w of await trainerWorkspaces(db)) {
    const rows = await db.tenant(operatorScope(a.userId, w.id), (tx) =>
      tx.query(
        `SELECT id,created_at,${MONTH("created_at")} AS month,task,product,provider,model,status,complimentary,cost_usd::text AS cost,estimated_cost_usd::text AS estimate,input_tokens,output_tokens FROM cost_events WHERE created_at>=$1 AND created_at<$2 ORDER BY created_at,id`,
        [from, to],
      ),
    );
    for (const r of rows)
      out.push(["provider_call", w.id, w.name, r.month, r.created_at, r.id, r.task, r.product ?? "", r.provider, r.model ?? "", r.status, r.complimentary, r.cost ?? "", r.estimate ?? "", "USD", r.input_tokens ?? "", r.output_tokens ?? "", ""]);
  }
  for (const c of await platformCostsForMonths(db, months))
    out.push(["platform_cost", "", "", c.month, c.createdAt, c.id, c.category, "", c.vendor ?? "", "", c.estimated ? "estimated" : "recorded", "", (c.amountMinor / 100).toFixed(2), "", c.currency, "", "", c.description]);
  return toCsv(
    ["kind", "tenant_id", "workspace", "month", "created_at", "id", "feature_or_category", "product", "provider_or_vendor", "model", "status", "complimentary", "cost", "estimate", "currency", "input_tokens", "output_tokens", "description"],
    out,
  );
}

// ---- Routes ---------------------------------------------------------------------

export function registerPlatformPnl(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
  /** The Stripe client for fee reads (a test double in fixtures). */
  stripeFees?: () => StripeFeeClient,
) {
  const access = (req: FastifyRequest) => {
    const a = identity(req);
    if (!["admin", "finance"].includes(a.platformRole))
      throw fail(
        403,
        "FINANCE_REQUIRED",
        "Super admin or platform finance access is required.",
      );
    requireRecentMfa(a, true);
    return a;
  };
  const range = (req: FastifyRequest) => {
    const q = z
      .object({
        from: z.string().regex(periodSchemaText).optional(),
        to: z.string().regex(periodSchemaText).optional(),
      })
      .strict()
      .parse(req.query ?? {});
    const to = q.to ?? currentDubaiMonth();
    const from = q.from ?? to;
    return { from, to, months: monthsBetween(from, to) };
  };
  const audit = (a: Actor, action: string, data: Record<string, unknown>) =>
    db.system((tx) =>
      tx.query(
        "INSERT INTO admin_operations_audit(id,actor_id,action,data) VALUES($1,$2,$3,$4)",
        [randomUUID(), a.userId, action, JSON.stringify(data)],
      ),
    );
  const prefix = "/api/v1/admin/platform-finance";
  app.get(prefix, async (req) => {
    const a = access(req);
    const r = range(req);
    const data = await platformPnl(db, r);
    await audit(a, "platform_finance.read", { from: r.from, to: r.to });
    return data;
  });
  app.post(prefix + "/rebuild", async (req) => {
    const a = access(req);
    const b = z
      .object({
        from: z.string().regex(periodSchemaText),
        to: z.string().regex(periodSchemaText),
      })
      .strict()
      .parse(req.body);
    const months = monthsBetween(b.from, b.to);
    await audit(a, "platform_finance.rebuild_requested", { from: b.from, to: b.to });
    return rebuildPlatformSummary(db, months, a.userId);
  });
  // Reads the registrar's available balance now (read-only) and records it.
  app.post(prefix + "/registrar-balance", async (req) => {
    const a = access(req);
    z.object({}).strict().parse(req.body ?? {});
    await audit(a, "platform_finance.registrar_balance_checked", {});
    return checkRegistrarBalance(db, a.userId);
  });
  // ---- Phase C: the platform's own costs, invoices, adjustments, fees ----
  app.get(prefix + "/costs", async (req) => {
    const a = access(req);
    const r = range(req);
    const [entries, invoices, recurring, fees] = await Promise.all([
      platformCostsForMonths(db, r.months),
      providerInvoicesForMonths(db, r.months),
      recurringCosts(db),
      stripeFeesForMonths(db, r.months),
    ]);
    const runs: Record<string, unknown> = {};
    for (const kind of ["stripe_fees", "recurring_costs", "digitalocean", "registrar_balance"])
      runs[kind] = await lastRun(db, kind);
    const byCurrency: Record<string, number> = {};
    for (const f of fees as Array<{ currency: string; feeMinor: number }>) byCurrency[f.currency] = (byCurrency[f.currency] ?? 0) + f.feeMinor;
    await audit(a, "platform_finance.costs_read", { from: r.from, to: r.to });
    return {
      range: { from: r.from, to: r.to },
      entries,
      invoices,
      recurring,
      stripeFees: { count: fees.reduce((n: number, f: { count: number }) => n + f.count, 0), byCurrency, rows: fees },
      runs,
    };
  });
  app.post(prefix + "/costs", async (req) => {
    const a = access(req);
    const row = await recordPlatformCost(db, a, req.body);
    await audit(a, "platform_finance.cost_recorded", { id: row.id, month: row.month, category: row.category, amountMinor: row.amountMinor, currency: row.currency });
    return row;
  });
  app.post(prefix + "/costs/:id/reverse", async (req) => {
    const a = access(req);
    const id = z.string().uuid().parse((req.params as any).id);
    const b = z.object({ reason: z.string().trim().min(10).max(400) }).strict().parse(req.body);
    const row = await reversePlatformCost(db, a, id, b.reason);
    await audit(a, "platform_finance.cost_reversed", { id, reversal: row.id, reason: b.reason });
    return row;
  });
  app.post(prefix + "/recurring", async (req) => {
    const a = access(req);
    const row = await createRecurringCost(db, a, req.body);
    await audit(a, "platform_finance.recurring_added", { id: row.id });
    return row;
  });
  app.post(prefix + "/recurring/:id/end", async (req) => {
    const a = access(req);
    const id = z.string().uuid().parse((req.params as any).id);
    const b = z
      .object({ revision: z.number().int().positive(), endsMonth: z.string().regex(periodSchemaText) })
      .strict()
      .parse(req.body);
    const row = await endRecurringCost(db, id, b);
    await audit(a, "platform_finance.recurring_ended", { id, endsMonth: b.endsMonth });
    return row;
  });
  app.post(prefix + "/payout-fees", async (req) => {
    const a = access(req);
    const row = await recordPayoutFee(db, a, req.body);
    await audit(a, "platform_finance.payout_fee_recorded", { id: row.id, payoutId: row.payoutId, amountMinor: row.amountMinor, currency: row.currency });
    return row;
  });
  app.post(prefix + "/invoices", async (req) => {
    const a = access(req);
    return importProviderInvoice(db, a, req.body);
  });
  app.post(prefix + "/usage-corrections", async (req) => {
    const a = access(req);
    const b = z
      .object({
        period: z.string().regex(periodSchemaText),
        reference: z.string().trim().min(3).max(200),
      })
      .strict()
      .parse(req.body);
    if (monthCutoff(b.period).getTime() > Date.now())
      throw fail(409, "PERIOD_OPEN", "Adjust a month after it ends");
    const result = await postUsageCorrections(db, a, b.period, b.reference);
    await audit(a, "platform_finance.usage_corrections", { ...b, posted: result.posted.length, skipped: result.skipped.length });
    return result;
  });
  app.post(prefix + "/stripe-fees/sweep", async (req) => {
    const a = access(req);
    z.object({}).strict().parse(req.body ?? {});
    await audit(a, "platform_finance.stripe_fees_swept", {});
    return runStripeFeeSweep(db, stripeFees?.() ?? null, a.userId);
  });
  // ---- Phase D: DigitalOcean billing, read-only ----
  app.post(prefix + "/digitalocean/import", async (req) => {
    const a = access(req);
    z.object({}).strict().parse(req.body ?? {});
    const { client, settings } = digitalOceanBillingFromConfig();
    await audit(a, "platform_finance.digitalocean_import", { project: settings.project });
    return importDigitalOceanBilling(db, { client, project: settings.project, actorId: a.userId }).catch(
      (error: Error) => {
        throw fail(502, "DIGITALOCEAN_BILLING_FAILED", String(error.message).slice(0, 300));
      },
    );
  });
  app.get(prefix + "/digitalocean", async (req) => {
    const a = access(req);
    const settings = digitalOceanBillingSettings();
    const [invoices, estimates] = await db.system(async (tx) => [
      await tx.query("SELECT invoice_uuid,month,team_amount_usd::text AS team_usd,project_name,project_items,project_amount_usd::text AS project_usd,imported_at FROM digitalocean_invoices ORDER BY month DESC LIMIT 24"),
      await tx.query("SELECT month,project_name,amount_usd::text AS amount_usd,to_date_usd::text AS to_date_usd,resources,computed_at FROM digitalocean_estimates ORDER BY month DESC LIMIT 6"),
    ]);
    await audit(a, "platform_finance.digitalocean_read", {});
    return {
      configured: !!settings.token,
      enabled: settings.enabled,
      project: settings.project,
      lastRun: await lastRun(db, "digitalocean"),
      invoices,
      estimates,
    };
  });
  const send = (reply: FastifyReply, name: string, body: string) =>
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${name}"`)
      .header("Cache-Control", "no-store")
      .send(body);
  app.get(prefix + "/export/:tab", async (req, reply) => {
    const a = access(req);
    const tab = z
      .enum(["pnl", "summary", "trainers", "features", "providers", "domains", "payouts", "flags", "ledger", "costs"])
      .parse(String((req.params as any).tab ?? "").replace(/\.csv$/, ""));
    const r = range(req);
    await audit(a, "platform_finance.exported", { tab, from: r.from, to: r.to });
    const name = `platform-finance-${tab}-${r.from}-${r.to}.csv`;
    if (tab === "ledger") return send(reply, name, await ledgerCsv(db, a, r.months));
    if (tab === "costs") return send(reply, name, await costsCsv(db, a, r.months));
    return send(reply, name, pnlCsv(await platformPnl(db, r), tab));
  });
}

// ---- Worker ---------------------------------------------------------------------

const HOUR = 3600000;
export { registerPlatformFinanceJob } from "./platform-finance-runs.ts";
import { registerPlatformFinanceJob } from "./platform-finance-runs.ts";
/**
 * Platform finance jobs the worker runs (idempotent; each records a run):
 * the monthly summary for this and last month every hour (the last 24
 * months on the first run), then the jobs later phases register.
 */
export async function runPlatformFinanceJobs(db: Database, now = new Date()) {
  const results: Record<string, unknown> = {};
  if (!(await ranWithin(db, "summary", HOUR, now))) {
    const current = currentDubaiMonth(now);
    const first = !(await lastRun(db, "summary", "succeeded"));
    const months = first
      ? monthsBetween(
          new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5)) - 24, 1))
            .toISOString()
            .slice(0, 7),
          current,
        )
      : [previousMonth(current), current];
    results.summary = await rebuildPlatformSummary(db, months).catch(
      (e: Error) => ({ error: e.message }),
    );
  }
  for (const job of platformFinanceJobs()) {
    try {
      results[job.id] = await job.run(db, now);
    } catch (e) {
      results[job.id] = { error: (e as Error).message };
    }
  }
  return results;
}

/** One Stripe fee sweep, recorded as a run (a missing Stripe key skips it). */
export async function runStripeFeeSweep(
  db: Database,
  client: StripeFeeClient | null,
  actorId: string | null = null,
) {
  let stripe = client;
  if (!stripe) {
    if (!runtimeConfig().STRIPE_SECRET_KEY) return { skipped: "not_configured" };
    // The isolated test runner never reaches Stripe; it passes a double.
    if (process.env.NODE_TEST_CONTEXT) return { skipped: "test_runner" };
    stripe = stripeClient() as unknown as StripeFeeClient;
  }
  const run = await startRun(db, "stripe_fees", actorId);
  try {
    const result = await sweepStripeFees(db, stripe);
    await finishRun(db, run, { result });
    return result;
  } catch (error) {
    await finishRun(db, run, { error: (error as Error).message || "Stripe fee sweep failed" });
    throw error;
  }
}
registerPlatformFinanceJob({
  id: "recurring_costs",
  async run(db, now) {
    if (await ranWithin(db, "recurring_costs", HOUR, now)) return { skipped: "ran_recently" };
    const run = await startRun(db, "recurring_costs", null);
    try {
      const result = await postRecurringCosts(db, currentDubaiMonth(now));
      await finishRun(db, run, { result });
      return result;
    } catch (error) {
      await finishRun(db, run, { error: (error as Error).message });
      throw error;
    }
  },
});
registerPlatformFinanceJob({
  id: "stripe_fees",
  async run(db, now) {
    if (await ranWithin(db, "stripe_fees", HOUR, now, true)) return { skipped: "ran_recently" };
    return runStripeFeeSweep(db, null);
  },
});

/** The registrar's balance, read once a day when a registrar is configured. */
registerPlatformFinanceJob({
  id: "registrar_balance",
  async run(db, now) {
    if (await ranWithin(db, "registrar_balance", 20 * HOUR, now)) return { skipped: "ran_recently" };
    if (await ranWithin(db, "registrar_balance", HOUR, now, true)) return { skipped: "ran_recently" };
    try {
      readRegistrarBalanceCheck();
    } catch (error) {
      if (error instanceof ProviderUnavailable) return { skipped: "not_configured" };
      throw error;
    }
    if (process.env.NODE_TEST_CONTEXT) return { skipped: "test_runner" };
    return checkRegistrarBalance(db, null).catch((e: Error) => ({ error: e.message }));
  },
});
