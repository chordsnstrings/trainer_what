import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Database, Tx } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import { platformWorkspaceSql } from "./workspace-state.ts";

// Executive business metrics for Super admin and platform finance operators.
// Read-only: every figure is computed from the ledger (journals and lines),
// subscriptions, subscription events, provider cost events and payouts, one
// scoped transaction per workspace. No health, meal or coaching content is read.
type Identity = Actor & { platformRole: string; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

/** The UAE dirham is pegged to the US dollar at this rate. */
export const AED_PER_USD = 3.6725;
const DUBAI_OFFSET_MS = 4 * 3600000;

export type MonthMetrics = {
  month: string;
  grossMinor: number;
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
  "j.source_key LIKE 'stripe-invoice:%' AND coalesce((j.data->>'grossMinor')::bigint,0)>0";

async function workspaceFigures(tx: Tx, since: Date, before: Date) {
  const ledger = await tx.query(
    `SELECT ${month("j.created_at")} AS month,CASE WHEN j.source_key LIKE 'stripe-invoice:%' THEN 'subscription' WHEN j.source_key LIKE 'booking-charge:%' THEN 'booking' WHEN j.source_key LIKE 'stripe-refund:%' OR j.source_key LIKE 'booking-refund:%' THEN 'refund' WHEN j.source_key LIKE 'payout:%' THEN 'payout' WHEN j.source_key LIKE 'payout-return:%' THEN 'payout_return' ELSE 'other' END AS source,l.account,sum(l.amount_minor)::text AS amount FROM journals j JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_id=j.id WHERE j.created_at>=$1 GROUP BY 1,2,3`,
    [since],
  );
  const payers = await tx.query(
    `SELECT ${month("j.created_at")} AS month,count(DISTINCT j.data->>'userId')::int AS n FROM journals j WHERE ${POSITIVE_INVOICE} AND j.created_at>=$1 GROUP BY 1`,
    [before],
  );
  const firstPaid = await tx.query(
    `SELECT ${month("x.first")} AS month,count(*)::int AS n FROM (SELECT j.data->>'userId' AS member,min(j.created_at) AS first FROM journals j WHERE ${POSITIVE_INVOICE} GROUP BY 1) x WHERE x.first>=$1 GROUP BY 1`,
    [since],
  );
  // A cancellation counts toward churn only when the member (the event actor)
  // had paid before it; a trial canceled before any charge is reported apart.
  const cancellations = await tx.query(
    `SELECT ${month("x.created_at")} AS month,count(DISTINCT x.subject_id) FILTER(WHERE x.paid)::int AS n,count(DISTINCT x.subject_id) FILTER(WHERE NOT x.paid)::int AS unpaid FROM (SELECT e.subject_id,e.created_at,EXISTS(SELECT 1 FROM journals j WHERE ${POSITIVE_INVOICE} AND j.data->>'userId'=e.actor_id::text AND j.created_at<e.created_at) AS paid FROM events e WHERE e.name='subscription.updated' AND e.data->>'status'='canceled' AND e.created_at>=$1) x GROUP BY 1`,
    [since],
  );
  // A trial starts at the first trialing update of a provider subscription
  // (the event actor is the member) and converts on a later positive charge.
  const trials = await tx.query(
    `WITH trial AS (SELECT e.subject_id,e.actor_id,min(e.created_at) AS started FROM events e WHERE e.name='subscription.updated' AND e.data->>'status'='trialing' GROUP BY 1,2) SELECT ${month("trial.started")} AS month,count(*)::int AS started,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM journals j WHERE ${POSITIVE_INVOICE} AND j.data->>'userId'=trial.actor_id::text AND j.created_at>=trial.started))::int AS converted FROM trial WHERE trial.started>=$1 GROUP BY 1`,
    [since],
  );
  const costs = await tx.query(
    `SELECT ${month("created_at")} AS month,(task LIKE 'voice%' OR provider='elevenlabs') AS voice,coalesce(sum(cost_usd),0)::text AS usd,count(*) FILTER(WHERE cost_usd IS NULL)::int AS unpriced FROM cost_events WHERE created_at>=$1 GROUP BY 1,2`,
    [since],
  );
  const subscriptions = await tx.query(
    "SELECT status,coalesce(data->>'tier','workout') AS tier,count(*)::int AS n,coalesce(sum(price_minor),0)::text AS price,count(*) FILTER(WHERE cancel_at_period_end)::int AS ending FROM subscriptions GROUP BY 1,2",
  );
  const payouts = await tx.query(
    "SELECT status,count(*)::int AS n,coalesce(sum(amount_minor),0)::text AS amount FROM payouts GROUP BY 1",
  );
  return {
    ledger,
    payers,
    firstPaid,
    cancellations,
    trials,
    costs,
    subscriptions,
    payouts,
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
      "SELECT count(DISTINCT m.user_id)::int AS n FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.role='subscriber' AND t.lifecycle_state<>'closed' AND NOT " +
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
  });
  const series = new Map(months.map((m) => [m, empty(m)]));
  const priorPayers = new Map<string, number>();
  const tiers: Record<string, { active: number; trialing: number; pastDue: number; mrrMinor: number }> = {
    workout: { active: 0, trialing: 0, pastDue: 0, mrrMinor: 0 },
    workout_nutrition: { active: 0, trialing: 0, pastDue: 0, mrrMinor: 0 },
  };
  let pendingCancellations = 0;
  const payoutStatus: Record<string, { count: number; amountMinor: number }> = {};
  for (const w of workspaces) {
    const f = await db.tenant({ ...a, tenantId: w.id, role: "finance" }, (tx) =>
      workspaceFigures(tx, since, before),
    );
    for (const row of f.ledger) {
      const m = series.get(row.month);
      if (!m) continue;
      const amount = Number(row.amount);
      if (row.account === "stripe_receivable") {
        if (row.source === "subscription") m.subscriptionGrossMinor += amount;
        if (row.source === "booking") m.bookingGrossMinor += amount;
        if (row.source === "refund") m.refundsMinor -= amount;
      }
      if (row.account === "platform_commission") m.commissionMinor -= amount;
      if (row.account === "platform_cost_recovery") m.costRecoveryMinor -= amount;
      if (row.account === "trainer_payable") {
        if (row.source === "payout") m.payoutsPaidMinor += amount;
        if (row.source === "payout_return") m.payoutsReturnedMinor -= amount;
      }
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
      if (row.voice) m.voiceCostUsd += Number(row.usd);
      else m.aiCostUsd += Number(row.usd);
      m.unpricedRequests += row.unpriced;
    }
    for (const row of f.subscriptions) {
      const tier = tiers[row.tier] ? row.tier : "workout";
      if (row.status === "active") tiers[tier].active += row.n;
      if (row.status === "trialing") tiers[tier].trialing += row.n;
      if (row.status === "past_due") tiers[tier].pastDue += row.n;
      if (["active", "past_due"].includes(row.status)) {
        tiers[tier].mrrMinor += Number(row.price);
        pendingCancellations += row.ending;
      }
    }
    for (const row of f.payouts) {
      const entry = (payoutStatus[row.status] ??= { count: 0, amountMinor: 0 });
      entry.count += row.n;
      entry.amountMinor += Number(row.amount);
    }
  }
  const finish = (m: MonthMetrics, prior: number) => {
    m.grossMinor = m.subscriptionGrossMinor + m.bookingGrossMinor;
    m.platformRevenueMinor = m.commissionMinor + m.costRecoveryMinor;
    m.refundRate = rate(m.refundsMinor, m.grossMinor);
    m.takeRate = rate(m.commissionMinor, m.grossMinor);
    m.churnRate = rate(m.cancellations, prior);
    m.trialConversionRate = rate(m.trialsConverted, m.trialsStarted);
    m.aiCostUsd = Math.round(m.aiCostUsd * 10000) / 10000;
    m.voiceCostUsd = Math.round(m.voiceCostUsd * 10000) / 10000;
    m.providerCostAedMinor = Math.round(
      (m.aiCostUsd + m.voiceCostUsd) * AED_PER_USD * 100,
    );
    m.costToRevenue = rate(m.providerCostAedMinor, m.platformRevenueMinor);
    return m;
  };
  const rows = months.map((m) =>
    finish(series.get(m)!, priorPayers.get(previousMonth(m)) ?? 0),
  );
  const totals = empty("total");
  for (const m of rows)
    for (const key of Object.keys(totals) as Array<keyof MonthMetrics>)
      if (typeof m[key] === "number" && !/Rate$|^costToRevenue$|^payingMembers$/.test(key))
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
    fx: { aedPerUsd: AED_PER_USD, basis: "UAE dirham peg to the US dollar" },
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
      mrrMinor: tiers.workout.mrrMinor + tiers.workout_nutrition.mrrMinor,
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
        "Current monthly price of active and past-due memberships (last invoiced amount); trials are excluded.",
      churnRate:
        "Paid memberships canceled in the month (the member had a positive subscription charge before canceling) divided by distinct paying memberships in the previous month.",
      unpaidCancellations:
        "Trials and other memberships canceled before any positive charge; reported separately and excluded from churn.",
      trialConversionRate:
        "Trials started in the month that later received a positive subscription charge.",
      costToRevenue:
        "AI and voice provider cost, converted at the AED peg, divided by platform revenue. Unpriced requests are counted separately and not estimated.",
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
