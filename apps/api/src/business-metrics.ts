import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  elevated,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import { platformWorkspaceSql } from "./workspace-state.ts";
import {
  VOICE_TASK_SQL,
  financeSettings,
  monthRates,
} from "./cost-accounting.ts";

// Executive business metrics for Super admin and platform finance operators.
// Read-only: every figure is computed from the ledger (journals and lines),
// subscriptions, subscription events, provider cost events and payouts, one
// scoped transaction per workspace. No health, meal or coaching content is read.
type Identity = Actor & { platformRole: string; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

/**
 * The UAE dirham is pegged to the US dollar at this rate: the default for a
 * month without a reviewed rate (Settings -> Platform finance).
 */
export const AED_PER_USD = 3.6725;
const DUBAI_OFFSET_MS = 4 * 3600000;

export type MonthMetrics = {
  month: string;
  grossMinor: number;
  /** Memberships, upfront programmes and voice add-ons together. */
  subscriptionGrossMinor: number;
  bookingGrossMinor: number;
  refundsMinor: number;
  refundRate: number | null;
  commissionMinor: number;
  costRecoveryMinor: number;
  platformRevenueMinor: number;
  takeRate: number | null;
  /** Distinct paying memberships; not additive, so the window total is null. */
  payingMembers: number | null;
  newPayingMembers: number;
  /** Paid memberships canceled in the month (the churn numerator). */
  cancellations: number;
  /** Trials or unpaid memberships canceled before any charge. */
  unpaidCancellations: number;
  churnRate: number | null;
  trialsStarted: number;
  trialsConverted: number;
  trialConversionRate: number | null;
  aiCostUsd: number;
  voiceCostUsd: number;
  providerCostAedMinor: number;
  unpricedRequests: number;
  costToRevenue: number | null;
  payoutsPaidMinor: number;
  payoutsReturnedMinor: number;
  // Added for the platform finance view (docs/features/platform-finance.md).
  membershipGrossMinor: number;
  programmeGrossMinor: number;
  voiceAddOnGrossMinor: number;
  /** Card dispute amounts held when opened, and those lost. */
  disputesOpenedMinor: number;
  disputeLossesMinor: number;
  /** Cost recovery split: monthly AI/voice usage charges and allocated costs. */
  usageRecoveryMinor: number;
  allocatedRecoveryMinor: number;
  /** Cost allocations the platform absorbed (not charged to the trainer), by period. */
  absorbedCostsMinor: number;
  /**
   * Trainer domain payments, refunds and net domain sales (read-only), kept
   * in the currency they were journaled in and never added into AED: AED
   * fils for journals in dirhams, US cents for journals in dollars (domains
   * are priced in USD since migration 071, core/domain-pricing).
   */
  domainPaymentsAedMinor: number;
  domainRefundsAedMinor: number;
  domainNetSalesAedMinor: number;
  domainPaymentsUsdCents: number;
  domainRefundsUsdCents: number;
  domainNetSalesUsdCents: number;
  /** Of the AI cost and of the voice cost: rows priced at their estimate. */
  estimatedAiCostUsd: number;
  estimatedVoiceCostUsd: number;
  /** Stored estimates of the unpriced rows (not in the cost figures). */
  unpricedEstimateUsd: number;
  /** Cost of members whose access was complimentary. */
  complimentaryCostUsd: number;
  /** The month's USD to AED rate and whether it was reviewed. */
  aedPerUsd: number | null;
  fxSource: string;
  /**
   * Workspaces whose posted usage charge for the month used another rate
   * than the month's current one (their charge keeps its own rate).
   */
  usageChargedAtOtherRate: number;
};
const rate = (numerator: number, denominator: number) =>
  denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : null;

/** Asia/Dubai calendar months, oldest first, ending with the current month. */
export function metricMonths(count: number, now = new Date()) {
  const dubai = new Date(now.getTime() + DUBAI_OFFSET_MS);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(
      Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth() - i, 1),
    );
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}
const monthStart = (month: string) =>
  new Date(Date.parse(month + "-01T00:00:00Z") - DUBAI_OFFSET_MS);
const previousMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
const DUBAI_MONTH = "to_char(%s AT TIME ZONE 'Asia/Dubai','YYYY-MM')";
const month = (column: string) => DUBAI_MONTH.replace("%s", column);
const POSITIVE_INVOICE =
  "(j.source_key LIKE 'stripe-invoice:%' OR j.source_key LIKE 'stripe-programme:%') AND coalesce((j.data->>'grossMinor')::bigint,0)>0";

async function workspaceFigures(tx: Tx, since: Date, before: Date) {
  const ledger = await tx.query(
    `SELECT ${month("j.created_at")} AS month,CASE WHEN j.source_key LIKE 'stripe-invoice:%' AND j.data->>'purpose'='voice_addon' THEN 'voice_addon' WHEN j.source_key LIKE 'stripe-invoice:%' THEN 'membership' WHEN j.source_key LIKE 'stripe-programme:%' THEN 'programme' WHEN j.source_key LIKE 'booking-charge:%' THEN 'booking' WHEN j.source_key LIKE 'stripe-refund:%' OR j.source_key LIKE 'booking-refund:%' THEN 'refund' WHEN j.source_key LIKE 'payout:%' THEN 'payout' WHEN j.source_key LIKE 'payout-return:%' THEN 'payout_return' WHEN j.source_key LIKE 'dispute-reserve:%' THEN 'dispute_opened' WHEN j.source_key LIKE 'dispute-resolution:%' THEN 'dispute_resolution' WHEN j.source_key LIKE 'usage:%' THEN 'usage' WHEN j.source_key LIKE 'allocated-cost:%' THEN 'allocated' WHEN j.source_key LIKE 'web-address-invoice:%' THEN 'domain_payment' WHEN j.source_key LIKE 'web-address-refund-reversal:%' THEN 'domain_refund_reversal' WHEN j.source_key LIKE 'web-address-refund:%' THEN 'domain_refund' ELSE 'other' END AS source,l.account,j.currency,sum(l.amount_minor)::text AS amount FROM journals j JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_id=j.id WHERE j.created_at>=$1 GROUP BY 1,2,3,4`,
    [since],
  );
  // Costs a platform operator allocated to the workspace but did not charge
  // the trainer (kept as records, never journaled), by their period.
  const absorbed = await tx.query(
    "SELECT data->>'period' AS month,coalesce(sum((data->>'amountMinor')::bigint),0)::text AS amount FROM records WHERE kind='cost_allocation' AND data->>'chargeTrainer'='false' AND data->>'period'>=$1 GROUP BY 1",
    [since.toISOString().slice(0, 7)],
  );
  // A paying member is one charged in the month, or one whose paid upfront
  // programme covers part of the month (paid once, a member for its length).
  const payers = await tx.query(
    `SELECT x.month,count(DISTINCT x.member)::int AS n FROM (SELECT ${month("j.created_at")} AS month,j.data->>'userId' AS member FROM journals j WHERE ${POSITIVE_INVOICE} AND j.created_at>=$1 UNION ALL SELECT to_char(g,'YYYY-MM'),j.data->>'userId' FROM journals j CROSS JOIN LATERAL generate_series(date_trunc('month',(j.data->>'accessStartsAt')::timestamptz AT TIME ZONE 'Asia/Dubai'),((j.data->>'accessEndsAt')::timestamptz-interval '1 second') AT TIME ZONE 'Asia/Dubai',interval '1 month') g WHERE j.source_key LIKE 'stripe-programme:%' AND coalesce((j.data->>'grossMinor')::bigint,0)>0 AND j.data ? 'accessStartsAt' AND j.data ? 'accessEndsAt' AND (j.data->>'accessEndsAt')::timestamptz>=$1) x GROUP BY 1`,
    [before],
  );
  const firstPaid = await tx.query(
    `SELECT ${month("x.first")} AS month,count(*)::int AS n FROM (SELECT j.data->>'userId' AS member,min(j.created_at) AS first FROM journals j WHERE ${POSITIVE_INVOICE} GROUP BY 1) x WHERE x.first>=$1 GROUP BY 1`,
    [since],
  );
  // A cancellation counts toward churn only when the member (the event actor)
  // had paid before it; a trial canceled before any charge is reported apart.
  const cancellations = await tx.query(
    `SELECT ${month("x.created_at")} AS month,count(DISTINCT x.subject_id) FILTER(WHERE x.paid)::int AS n,count(DISTINCT x.subject_id) FILTER(WHERE NOT x.paid)::int AS unpaid FROM (SELECT e.subject_id,e.created_at,EXISTS(SELECT 1 FROM journals j WHERE ${POSITIVE_INVOICE} AND j.data->>'userId'=coalesce(e.data->>'memberId',e.actor_id::text) AND j.created_at<e.created_at) AS paid FROM events e WHERE ((e.name='subscription.updated' AND e.data->>'status'='canceled') OR e.name='programme.ended') AND e.created_at>=$1) x GROUP BY 1`,
    [since],
  );
  // A trial starts at the first trialing update of a provider subscription
  // (the event actor is the member) and converts on a later positive charge.
  const trials = await tx.query(
    `WITH trial AS (SELECT e.subject_id,e.actor_id,min(e.created_at) AS started FROM events e WHERE e.name='subscription.updated' AND e.data->>'status'='trialing' GROUP BY 1,2) SELECT ${month("trial.started")} AS month,count(*)::int AS started,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM journals j WHERE ${POSITIVE_INVOICE} AND j.data->>'userId'=trial.actor_id::text AND j.created_at>=trial.started))::int AS converted FROM trial WHERE trial.started>=$1 GROUP BY 1`,
    [since],
  );
  // Voice is the speech, transcription, preview and clone provider calls
  // (task voice.*); every other row is an AI model call, including the model
  // call that suggests voice-session wording.
  const costs = await tx.query(
    `SELECT ${month("created_at")} AS month,(${VOICE_TASK_SQL}) AS voice,coalesce(sum(cost_usd),0)::text AS usd,coalesce(sum(cost_usd) FILTER(WHERE status='estimated'),0)::text AS estimated,count(*) FILTER(WHERE cost_usd IS NULL)::int AS unpriced,coalesce(sum(estimated_cost_usd) FILTER(WHERE cost_usd IS NULL),0)::text AS unpriced_estimate,coalesce(sum(cost_usd) FILTER(WHERE complimentary),0)::text AS complimentary FROM cost_events WHERE created_at>=$1 GROUP BY 1,2`,
    [since],
  );
  // An upfront programme's price is one payment for the whole programme, so
  // it is not recurring revenue: it is reported apart, with its 30-day
  // equivalent over the trainer-set length.
  const subscriptions = await tx.query(
    "SELECT status,coalesce(data->>'tier','workout') AS tier,coalesce(data->>'billing','monthly')='upfront' AS upfront,count(*)::int AS n,coalesce(sum(price_minor),0)::text AS price,coalesce(sum(round(price_minor*30.0/greatest(coalesce((data->>'programmeDays')::int,30),1))),0)::text AS monthly_equivalent,count(*) FILTER(WHERE cancel_at_period_end)::int AS ending FROM subscriptions WHERE coalesce(data->>'billing','monthly')<>'upfront' OR period_end>now() GROUP BY 1,2,3",
  );
  // Premium voice add-ons are monthly subscriptions of their own.
  const voiceAddOns = await tx.query(
    "SELECT count(*)::int AS n,coalesce(sum(coalesce((s.data->'voiceAddOn'->>'amountMinor')::bigint,(p.data->>'voiceAddOnMinor')::bigint,0)),0)::text AS price FROM subscriptions s LEFT JOIN records p ON p.kind='product' AND p.id::text=s.data->'voiceAddOn'->>'productId' WHERE s.data->'voiceAddOn'->>'status' IN ('active','past_due') AND s.data->'voiceAddOn'->>'verified'='true' AND NOT s.data->'voiceAddOn' ? 'endRequested'",
  );
  const payouts = await tx.query(
    "SELECT status,count(*)::int AS n,coalesce(sum(amount_minor),0)::text AS amount FROM payouts GROUP BY 1",
  );
  // The rate each posted usage charge used, to flag months charged at a rate
  // other than the month's current one.
  const usageStatements = await tx.query(
    "SELECT period AS month,fx_aed_per_usd::text AS fx FROM usage_statements WHERE period>=$1",
    [since.toISOString().slice(0, 7)],
  );
  return {
    ledger,
    absorbed,
    payers,
    firstPaid,
    cancellations,
    trials,
    costs,
    subscriptions,
    voiceAddOns,
    payouts,
    usageStatements,
  };
}

export async function computeBusinessMetrics(
  db: Database,
  a: Actor,
  options: { months?: number; now?: Date } = {},
) {
  const now = options.now ?? new Date(),
    months = metricMonths(options.months ?? 12, now),
    since = monthStart(months[0]),
    before = monthStart(previousMonth(months[0]));
  const workspaces = await db.system((tx) =>
    tx.query<{ id: string; lifecycle_state: string; published: boolean }>(
      // Platform administration workspaces (owned by an operator) are not trainers.
      "SELECT t.id,t.lifecycle_state,t.published FROM tenants t WHERE NOT " +
        platformWorkspaceSql("t.id") +
        " ORDER BY t.id",
    ),
  );
  const [followers] = await db.system((tx) =>
    tx.query(
      "SELECT count(DISTINCT m.user_id)::int AS n FROM memberships m JOIN tenants t ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id WHERE m.role='subscriber' AND NOT u.is_trainer_preview AND t.lifecycle_state<>'closed' AND NOT " +
        platformWorkspaceSql("t.id"),
    ),
  );
  const empty = (m: string): MonthMetrics => ({
    month: m,
    grossMinor: 0,
    subscriptionGrossMinor: 0,
    bookingGrossMinor: 0,
    refundsMinor: 0,
    refundRate: null,
    commissionMinor: 0,
    costRecoveryMinor: 0,
    platformRevenueMinor: 0,
    takeRate: null,
    payingMembers: 0,
    newPayingMembers: 0,
    cancellations: 0,
    unpaidCancellations: 0,
    churnRate: null,
    trialsStarted: 0,
    trialsConverted: 0,
    trialConversionRate: null,
    aiCostUsd: 0,
    voiceCostUsd: 0,
    providerCostAedMinor: 0,
    unpricedRequests: 0,
    costToRevenue: null,
    payoutsPaidMinor: 0,
    payoutsReturnedMinor: 0,
    membershipGrossMinor: 0,
    programmeGrossMinor: 0,
    voiceAddOnGrossMinor: 0,
    disputesOpenedMinor: 0,
    disputeLossesMinor: 0,
    usageRecoveryMinor: 0,
    allocatedRecoveryMinor: 0,
    absorbedCostsMinor: 0,
    domainPaymentsAedMinor: 0,
    domainRefundsAedMinor: 0,
    domainNetSalesAedMinor: 0,
    domainPaymentsUsdCents: 0,
    domainRefundsUsdCents: 0,
    domainNetSalesUsdCents: 0,
    estimatedAiCostUsd: 0,
    estimatedVoiceCostUsd: 0,
    unpricedEstimateUsd: 0,
    complimentaryCostUsd: 0,
    aedPerUsd: null,
    fxSource: "",
    usageChargedAtOtherRate: 0,
  });
  // One rate per month: its reviewed rate, else the default setting.
  const settings = financeSettings();
  const rates = await monthRates(db, months, settings);
  const series = new Map(months.map((m) => [m, empty(m)]));
  const priorPayers = new Map<string, number>();
  const tiers: Record<string, { active: number; trialing: number; pastDue: number; mrrMinor: number }> = {
    workout: { active: 0, trialing: 0, pastDue: 0, mrrMinor: 0 },
    workout_nutrition: { active: 0, trialing: 0, pastDue: 0, mrrMinor: 0 },
  };
  let pendingCancellations = 0;
  const upfront = { active: 0, pastDue: 0, collectedMinor: 0, monthlyEquivalentMinor: 0 };
  const voice = { active: 0, mrrMinor: 0 };
  const payoutStatus: Record<string, { count: number; amountMinor: number }> = {};
  const chargedRates: Array<{ month: string; fx: number }> = [];
  for (const w of workspaces) {
    const f = await db.tenant(
      elevated("platform-operator", {
        tenantId: w.id,
        userId: a.userId,
        role: "finance",
      }),
      (tx) =>
      workspaceFigures(tx, since, before),
    );
    for (const row of f.ledger) {
      const m = series.get(row.month);
      if (!m) continue;
      const amount = Number(row.amount);
      // Trainer domains, in the journal's own currency (read-only here;
      // domain profit is phase B). Never added into the AED figures.
      if (row.source.startsWith("domain_")) {
        const usd = row.currency === "USD";
        if (!usd && row.currency !== "AED") continue;
        const add = (field: "Payments" | "Refunds" | "NetSales", n: number) => {
          const key = `domain${field}${usd ? "UsdCents" : "AedMinor"}` as const;
          m[key] += n;
        };
        if (row.account === "web_address_receivable") {
          if (row.source === "domain_payment") add("Payments", amount);
          if (row.source === "domain_refund") add("Refunds", -amount);
          if (row.source === "domain_refund_reversal") add("Refunds", -amount);
        }
        if (row.account === "web_address_revenue") add("NetSales", -amount);
        continue;
      }
      // Every other figure is the AED ledger.
      if (row.currency !== "AED") continue;
      if (row.account === "stripe_receivable") {
        if (row.source === "membership") m.membershipGrossMinor += amount;
        if (row.source === "programme") m.programmeGrossMinor += amount;
        if (row.source === "voice_addon") m.voiceAddOnGrossMinor += amount;
        if (row.source === "booking") m.bookingGrossMinor += amount;
        if (row.source === "refund") m.refundsMinor -= amount;
        if (row.source === "dispute_resolution") m.disputeLossesMinor -= amount;
      }
      if (row.account === "dispute_reserve" && row.source === "dispute_opened")
        m.disputesOpenedMinor -= amount;
      if (row.account === "platform_commission") m.commissionMinor -= amount;
      if (row.account === "platform_cost_recovery") {
        m.costRecoveryMinor -= amount;
        if (row.source === "usage") m.usageRecoveryMinor -= amount;
        if (row.source === "allocated") m.allocatedRecoveryMinor -= amount;
      }
      if (row.account === "trainer_payable") {
        if (row.source === "payout") m.payoutsPaidMinor += amount;
        if (row.source === "payout_return") m.payoutsReturnedMinor -= amount;
      }
    }
    for (const row of f.absorbed) {
      const m = series.get(row.month);
      if (m) m.absorbedCostsMinor += Number(row.amount);
    }
    for (const row of f.payers) {
      const m = series.get(row.month);
      if (m) m.payingMembers = (m.payingMembers ?? 0) + row.n;
      priorPayers.set(row.month, (priorPayers.get(row.month) ?? 0) + row.n);
    }
    for (const row of f.firstPaid) {
      const m = series.get(row.month);
      if (m) m.newPayingMembers += row.n;
    }
    for (const row of f.cancellations) {
      const m = series.get(row.month);
      if (!m) continue;
      m.cancellations += row.n;
      m.unpaidCancellations += row.unpaid;
    }
    for (const row of f.trials) {
      const m = series.get(row.month);
      if (!m) continue;
      m.trialsStarted += row.started;
      m.trialsConverted += row.converted;
    }
    for (const row of f.costs) {
      const m = series.get(row.month);
      if (!m) continue;
      if (row.voice) {
        m.voiceCostUsd += Number(row.usd);
        m.estimatedVoiceCostUsd += Number(row.estimated);
      } else {
        m.aiCostUsd += Number(row.usd);
        m.estimatedAiCostUsd += Number(row.estimated);
      }
      m.unpricedRequests += row.unpriced;
      m.unpricedEstimateUsd += Number(row.unpriced_estimate);
      m.complimentaryCostUsd += Number(row.complimentary);
    }
    for (const row of f.subscriptions) {
      const tier = tiers[row.tier] ? row.tier : "workout";
      if (row.status === "active") tiers[tier].active += row.n;
      if (row.status === "trialing") tiers[tier].trialing += row.n;
      if (row.status === "past_due") tiers[tier].pastDue += row.n;
      if (["active", "past_due"].includes(row.status)) {
        if (row.upfront) {
          if (row.status === "active") upfront.active += row.n;
          else upfront.pastDue += row.n;
          upfront.collectedMinor += Number(row.price);
          upfront.monthlyEquivalentMinor += Number(row.monthly_equivalent);
        } else {
          tiers[tier].mrrMinor += Number(row.price);
          pendingCancellations += row.ending;
        }
      }
    }
    for (const row of f.voiceAddOns) {
      voice.active += row.n;
      voice.mrrMinor += Number(row.price);
    }
    for (const row of f.payouts) {
      const entry = (payoutStatus[row.status] ??= { count: 0, amountMinor: 0 });
      entry.count += row.n;
      entry.amountMinor += Number(row.amount);
    }
    for (const row of f.usageStatements)
      chargedRates.push({ month: row.month, fx: Number(row.fx) });
  }
  const usd4 = (n: number) => Math.round(n * 10000) / 10000;
  const finish = (m: MonthMetrics, prior: number) => {
    m.subscriptionGrossMinor =
      m.membershipGrossMinor + m.programmeGrossMinor + m.voiceAddOnGrossMinor;
    m.grossMinor = m.subscriptionGrossMinor + m.bookingGrossMinor;
    m.platformRevenueMinor = m.commissionMinor + m.costRecoveryMinor;
    m.refundRate = rate(m.refundsMinor, m.grossMinor);
    m.takeRate = rate(m.commissionMinor, m.grossMinor);
    m.churnRate = rate(m.cancellations, prior);
    m.trialConversionRate = rate(m.trialsConverted, m.trialsStarted);
    m.aiCostUsd = usd4(m.aiCostUsd);
    m.voiceCostUsd = usd4(m.voiceCostUsd);
    m.estimatedAiCostUsd = usd4(m.estimatedAiCostUsd);
    m.estimatedVoiceCostUsd = usd4(m.estimatedVoiceCostUsd);
    m.unpricedEstimateUsd = usd4(m.unpricedEstimateUsd);
    m.complimentaryCostUsd = usd4(m.complimentaryCostUsd);
    const fx = rates.get(m.month);
    if (fx) {
      m.aedPerUsd = fx.aedPerUsd;
      m.fxSource = fx.source;
      m.providerCostAedMinor = Math.round(
        (m.aiCostUsd + m.voiceCostUsd) * fx.aedPerUsd * 100,
      );
      m.usageChargedAtOtherRate = chargedRates.filter(
        (c) => c.month === m.month && c.fx !== Number(fx.aedPerUsd),
      ).length;
    }
    m.costToRevenue = rate(m.providerCostAedMinor, m.platformRevenueMinor);
    return m;
  };
  const rows = months.map((m) =>
    finish(series.get(m)!, priorPayers.get(previousMonth(m)) ?? 0),
  );
  const totals = empty("total");
  for (const m of rows)
    for (const key of Object.keys(totals) as Array<keyof MonthMetrics>)
      if (typeof m[key] === "number" && !/Rate$|^costToRevenue$|^payingMembers$|^aedPerUsd$/.test(key))
        (totals as any)[key] += m[key] as number;
  totals.payingMembers = null;
  // Window churn: all cancellations over the sum of each month's prior payers.
  finish(totals, rows.reduce((n, m) => n + (priorPayers.get(previousMonth(m.month)) ?? 0), 0));
  totals.providerCostAedMinor = rows.reduce((n, m) => n + m.providerCostAedMinor, 0);
  totals.costToRevenue = rate(totals.providerCostAedMinor, totals.platformRevenueMinor);
  const count = (state: string) =>
    workspaces.filter((w) => w.lifecycle_state === state).length;
  const membership = (key: "active" | "trialing" | "pastDue") =>
    tiers.workout[key] + tiers.workout_nutrition[key];
  return {
    asOf: now.toISOString(),
    currency: "AED",
    timezone: "Asia/Dubai",
    fx: {
      aedPerUsd: settings.defaultAedPerUsd,
      basis: `Each month's reviewed USD to AED rate (Platform finance); a month without one uses the default rate setting (${settings.defaultAedPerUsd} AED per USD; the dirham's peg to the US dollar is 3.6725)`,
      months: months.map((m) => rates.get(m)),
    },
    snapshot: {
      trainers: {
        total: workspaces.length,
        active: count("active"),
        published: workspaces.filter(
          (w) => w.lifecycle_state === "active" && w.published,
        ).length,
        suspended: count("suspended"),
        closed: count("closed"),
      },
      followers: Number(followers?.n ?? 0),
      memberships: {
        active: membership("active"),
        trialing: membership("trialing"),
        pastDue: membership("pastDue"),
        pendingCancellations,
        byTier: tiers,
      },
      mrrMinor:
        tiers.workout.mrrMinor + tiers.workout_nutrition.mrrMinor + voice.mrrMinor,
      voiceAddOns: voice,
      upfrontProgrammes: upfront,
      payouts: payoutStatus,
    },
    series: rows,
    totals,
    definitions: {
      grossMinor:
        "Customer money collected: positive subscription invoices and paid coaching sessions posted to the ledger in the month.",
      refundsMinor: "Subscription and session refunds posted in the month.",
      commissionMinor:
        "Net platform commission (commission minus refund, dispute and affiliate reversals).",
      platformRevenueMinor:
        "Net commission plus reviewed usage cost recovery charged to trainers.",
      takeRate: "Net commission divided by gross takings.",
      mrrMinor:
        "Current monthly price of active and past-due monthly memberships (last invoiced amount) plus active premium voice add-ons; trials and upfront programmes are excluded.",
      upfrontProgrammes:
        "Upfront programmes whose paid access is current: the one-off amounts collected and their 30-day equivalent (price × 30 ÷ programme days). Not part of MRR.",
      payingMembers:
        "Distinct members charged in the month, plus members whose paid upfront programme covers part of the month.",
      churnRate:
        "Paid memberships canceled in the month, and upfront programmes that ended without a renewal (the member had a positive charge before), divided by distinct paying members in the previous month.",
      unpaidCancellations:
        "Trials and other memberships canceled before any positive charge; reported separately and excluded from churn.",
      trialConversionRate:
        "Trials started in the month that later received a positive subscription charge.",
      costToRevenue:
        "AI and voice provider cost, converted at the month's USD to AED rate, divided by platform revenue. Unpriced requests are counted separately; their stored estimate is shown apart and not added.",
      aiCostUsd:
        "AI model calls priced when made (price sheet), reconciled from an invoice or estimated, in US dollars.",
      voiceCostUsd:
        "Voice provider calls (speech, transcription, previews, clones): priced at their estimate when made and corrected by the provider invoice.",
      estimatedAiCostUsd:
        "The part of AI cost priced at an estimate that no invoice has confirmed yet (a lost answer estimated by an operator or month close).",
      estimatedVoiceCostUsd:
        "The part of voice cost priced at an estimate that no invoice has confirmed yet.",
      usageChargedAtOtherRate:
        "Workspaces whose posted usage charge for the month used a different rate than the month's current rate; their charge keeps its rate, so it differs from the cost shown here.",
      subscriptionGrossMinor:
        "Memberships, upfront programmes and voice add-ons together; each is also shown on its own.",
      disputesOpenedMinor:
        "Card dispute amounts held when the bank opened a dispute; disputeLossesMinor is what lost disputes took back.",
      costRecoveryMinor:
        "AI and voice usage charged to trainers at cost (usageRecoveryMinor) plus allocated costs charged to them (allocatedRecoveryMinor), in the month they were posted: usage is charged the month after it happened.",
      absorbedCostsMinor:
        "Cost allocations recorded for a workspace but not charged to the trainer, in the month they are for (unlike charged allocations, which are in the month posted).",
      domainNetSalesAedMinor:
        "Trainer domain payments less refunds (read-only from the web-address ledger), in the currency each was charged in: AED fils here, US cents in domainNetSalesUsdCents. Never converted or added into AED figures; registrar cost and domain profit come in a later phase. Not included in platform revenue.",
      complimentaryCostUsd:
        "AI and voice cost of members whose access was complimentary when the call was made (charged to the trainer today).",
      payoutsPaidMinor:
        "Trainer payouts confirmed paid with bank evidence in the month.",
      trainers:
        "Coaching workspaces, excluding platform administration workspaces owned by an operator.",
    },
  };
}

const csvFields: Array<keyof MonthMetrics> = [
  "month",
  "grossMinor",
  "subscriptionGrossMinor",
  "bookingGrossMinor",
  "refundsMinor",
  "refundRate",
  "commissionMinor",
  "costRecoveryMinor",
  "platformRevenueMinor",
  "takeRate",
  "payingMembers",
  "newPayingMembers",
  "cancellations",
  "unpaidCancellations",
  "churnRate",
  "trialsStarted",
  "trialsConverted",
  "trialConversionRate",
  "aiCostUsd",
  "voiceCostUsd",
  "providerCostAedMinor",
  "unpricedRequests",
  "costToRevenue",
  "payoutsPaidMinor",
  "payoutsReturnedMinor",
  "membershipGrossMinor",
  "programmeGrossMinor",
  "voiceAddOnGrossMinor",
  "disputesOpenedMinor",
  "disputeLossesMinor",
  "usageRecoveryMinor",
  "allocatedRecoveryMinor",
  "absorbedCostsMinor",
  "domainPaymentsAedMinor",
  "domainRefundsAedMinor",
  "domainNetSalesAedMinor",
  "domainPaymentsUsdCents",
  "domainRefundsUsdCents",
  "domainNetSalesUsdCents",
  "estimatedAiCostUsd",
  "estimatedVoiceCostUsd",
  "unpricedEstimateUsd",
  "complimentaryCostUsd",
  "aedPerUsd",
  "fxSource",
  "usageChargedAtOtherRate",
];
function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // Values are numbers and month keys; still neutralize spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)
    ? "'" + text
    : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
export function metricsCsv(result: Awaited<ReturnType<typeof computeBusinessMetrics>>) {
  const lines = [csvFields.join(",")];
  for (const row of [...result.series, result.totals])
    lines.push(csvFields.map((field) => csvCell(row[field])).join(","));
  return lines.join("\n") + "\n";
}

export function registerBusinessMetrics(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
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
    return {
      a,
      months: z
        .object({ months: z.coerce.number().int().min(1).max(36).default(12) })
        .parse(req.query).months,
    };
  };
  const audit = (a: Identity, action: string, months: number) =>
    db.system((tx) =>
      tx.query(
        "INSERT INTO admin_operations_audit(id,actor_id,action,data) VALUES($1,$2,$3,$4)",
        [randomUUID(), a.userId, action, JSON.stringify({ months })],
      ),
    );
  app.get("/api/v1/admin/metrics", async (req) => {
    const { a, months } = access(req);
    const result = await computeBusinessMetrics(db, a, { months });
    await audit(a, "metrics.read", months);
    return result;
  });
  app.get("/api/v1/admin/metrics.csv", async (req, reply) => {
    const { a, months } = access(req);
    const result = await computeBusinessMetrics(db, a, { months });
    await audit(a, "metrics.exported", months);
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="platform-metrics-${result.series.at(-1)?.month ?? "export"}.csv"`,
      )
      .send(metricsCsv(result));
  });
}
