import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { elevated, event, type Actor, type Database, type Tx } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import { monthCutoff } from "./finance-operations.ts";
import {
  dubaiMonthRange,
  financeSettings,
  periodSchemaText,
  periodUsage,
} from "./cost-accounting.ts";

// Platform finance controls for the Super admin and platform finance roles
// (docs/features/platform-finance.md, phase A): one reviewed USD to AED rate
// per month, reviewed token prices per provider and model, and pricing a
// provider's unresolved or estimated calls for a month from its usage or
// invoice total. Fresh authenticator code and an audit row for every call.

type Identity = Actor & { platformRole: string; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const period = z.string().regex(periodSchemaText);
const usd = z.string().regex(/^\d{1,9}(\.\d{1,8})?$/);

/** USD amounts as exact integer hundred-millionths (numeric(18,8)). */
export function usdUnits(value: string | number | null | undefined): bigint {
  const text = String(value ?? "0").trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    const n = Number(text);
    if (!Number.isFinite(n)) return 0n;
    return BigInt(Math.round(n * 1e8));
  }
  const fraction = (match[3] ?? "").padEnd(9, "0");
  let units = BigInt(match[2]) * 100000000n + BigInt(fraction.slice(0, 8));
  if (Number(fraction[8]) >= 5) units += 1n;
  return match[1] ? -units : units;
}
export function usdText(units: bigint) {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 100000000n,
    fraction = (abs % 100000000n).toString().padStart(8, "0");
  return (negative ? "-" : "") + whole.toString() + "." + fraction;
}

// A row a provider total can price: unresolved or estimated with a stored
// estimate (not in flight), or already priced by this same invoice reference.
// Parameters: $1 provider, $2 month start, $3 invoice reference, $4 month end.
// Never NULL (a row reconciled one by one has no invoice reference), so
// NOT (ADJUSTABLE) counts such a row as already priced.
const ADJUSTABLE =
  "coalesce(((cost_usd IS NULL OR status='estimated') AND estimated_cost_usd IS NOT NULL AND NOT (status='reserved' AND created_at>=now()-interval '15 minutes')) OR (status='reconciled' AND reconciliation->>'invoiceReference'=$3),false)";
// A Dubai month as a created_at range, so (tenant_id, provider, created_at)
// covers it (a to_char() filter would read the provider's whole history).
const IN_MONTH =
  "provider=$1 AND created_at>=$2::timestamptz AND created_at<$4::timestamptz";
const IN_FLIGHT = "status='reserved' AND created_at>=now()-interval '15 minutes'";
const BY_REFERENCE =
  "status='reconciled' AND reconciliation->>'invoiceReference'=$3";

type WorkspaceUsage = {
  tenantId: string;
  name: string;
  rows: number;
  estimateUsd: string;
  pricedByReference: number;
  referenceTotals: string[];
  referenceScopes: string[];
  fixedRows: number;
  fixedUsd: string;
  inFlight: number;
  withoutEstimate: number;
  usageStatementPosted: boolean;
};

async function workspaces(db: Database) {
  return db.system((tx) =>
    tx.query<{ id: string; name: string }>(
      "SELECT id,name FROM tenants ORDER BY id",
    ),
  );
}
const operatorScope = (a: Actor, tenantId: string) =>
  elevated("platform-operator", { tenantId, userId: a.userId, role: "finance" });
const monthParams = (period: string) => {
  const range = dubaiMonthRange(period);
  return { from: range.from.toISOString(), to: range.to.toISOString() };
};
/** The scope a pricing run records, so a resumed run can prove it is the same. */
const scopeKey = (rows: number, estimateUsd: string, fixedUsd: string) =>
  `${rows}|${estimateUsd}|${fixedUsd}`;

/**
 * One provider's cost rows for a Dubai month across every workspace, split
 * into what a provider total can price and what is already final. Each
 * workspace is read with an index range scan over the month.
 */
export async function providerUsage(
  db: Database,
  a: Actor,
  input: { period: string; provider: string; invoiceReference?: string },
) {
  const { from, to } = monthParams(input.period);
  const rows: WorkspaceUsage[] = [];
  for (const w of await workspaces(db)) {
    const r = await db.tenant(operatorScope(a, w.id), async (tx) => {
      const [u] = await tx.query(
        `SELECT count(*) FILTER(WHERE ${ADJUSTABLE})::int AS rows,coalesce(sum(estimated_cost_usd) FILTER(WHERE ${ADJUSTABLE}),0)::numeric(18,8)::text AS estimate,count(*) FILTER(WHERE ${BY_REFERENCE})::int AS by_reference,coalesce(array_agg(DISTINCT reconciliation->>'providerTotalUsd') FILTER(WHERE ${BY_REFERENCE}),'{}') AS reference_totals,coalesce(array_agg(DISTINCT concat_ws('|',coalesce(reconciliation->>'adjustableRows','?'),coalesce(reconciliation->>'estimateTotalUsd','?'),coalesce(reconciliation->>'fixedUsd','?'))) FILTER(WHERE ${BY_REFERENCE}),'{}') AS reference_scopes,count(*) FILTER(WHERE cost_usd IS NOT NULL AND NOT (${ADJUSTABLE}))::int AS fixed_rows,coalesce(sum(cost_usd) FILTER(WHERE cost_usd IS NOT NULL AND NOT (${ADJUSTABLE})),0)::numeric(18,8)::text AS fixed,count(*) FILTER(WHERE ${IN_FLIGHT})::int AS in_flight,count(*) FILTER(WHERE cost_usd IS NULL AND estimated_cost_usd IS NULL AND NOT (${IN_FLIGHT}))::int AS without_estimate FROM cost_events WHERE ${IN_MONTH}`,
        [input.provider, from, input.invoiceReference ?? "", to],
      );
      const [statement] = await tx.query(
        "SELECT 1 FROM usage_statements WHERE period=$1",
        [input.period],
      );
      return { u, posted: !!statement };
    });
    if (
      !r.u.rows &&
      !r.u.fixed_rows &&
      !r.u.in_flight &&
      !r.u.without_estimate
    )
      continue;
    rows.push({
      tenantId: w.id,
      name: w.name,
      rows: r.u.rows,
      estimateUsd: r.u.estimate,
      pricedByReference: r.u.by_reference,
      referenceTotals: (r.u.reference_totals ?? []).filter(Boolean),
      referenceScopes: r.u.reference_scopes ?? [],
      fixedRows: r.u.fixed_rows,
      fixedUsd: r.u.fixed,
      inFlight: r.u.in_flight,
      withoutEstimate: r.u.without_estimate,
      usageStatementPosted: r.posted,
    });
  }
  const sum = (pick: (w: WorkspaceUsage) => string) =>
    usdText(rows.reduce((n, w) => n + usdUnits(pick(w)), 0n));
  const count = (pick: (w: WorkspaceUsage) => number) =>
    rows.reduce((n, w) => n + pick(w), 0);
  return {
    period: input.period,
    provider: input.provider,
    invoiceReference: input.invoiceReference ?? null,
    adjustableRows: count((w) => w.rows),
    adjustableEstimateUsd: sum((w) => w.estimateUsd),
    pricedByReference: count((w) => w.pricedByReference),
    fixedRows: count((w) => w.fixedRows),
    fixedUsd: sum((w) => w.fixedUsd),
    inFlight: count((w) => w.inFlight),
    withoutEstimate: count((w) => w.withoutEstimate),
    usageStatementsPosted: rows.filter((w) => w.usageStatementPosted).length,
    referenceTotals: [...new Set(rows.flatMap((w) => w.referenceTotals))],
    referenceScopes: [...new Set(rows.flatMap((w) => w.referenceScopes))],
    workspaces: rows,
  };
}

/** Providers with cost rows in a Dubai month, across workspaces. */
export async function monthProviders(db: Database, a: Actor, period: string) {
  const { from, to } = monthParams(period);
  const totals = new Map<string, { calls: number; workspaces: number }>();
  for (const w of await workspaces(db)) {
    const rows = await db.tenant(operatorScope(a, w.id), (tx) =>
      tx.query(
        "SELECT provider,count(*)::int AS calls FROM cost_events WHERE created_at>=$1::timestamptz AND created_at<$2::timestamptz GROUP BY provider",
        [from, to],
      ),
    );
    for (const r of rows) {
      const t = totals.get(r.provider) ?? { calls: 0, workspaces: 0 };
      t.calls += r.calls;
      t.workspaces += 1;
      totals.set(r.provider, t);
    }
  }
  return [...totals.entries()]
    .map(([provider, t]) => ({ provider, ...t }))
    .sort((x, y) => x.provider.localeCompare(y.provider));
}

/** How far a total is from the estimates it replaces (1 = as estimated). */
export function pricingFactor(targetUnits: bigint, estimateUnits: bigint) {
  if (estimateUnits === 0n) return null;
  return Number((targetUnits * 1000000n) / estimateUnits) / 1000000;
}
const FACTOR_RANGE = { low: 0.5, high: 2 };

/**
 * Prices a provider's month from its usage or invoice total (plan fees
 * excluded): the total less the rows already final is spread over the
 * adjustable rows in proportion to their stored estimates, each marked
 * 'reconciled' with the reference. The estimate on every row is kept.
 *
 * Refused while any of the month's calls has no estimate (the total covers
 * them too), while calls are in flight, when the total is far from the
 * estimates without an explicit acknowledgement, or when a resumed run under
 * the same reference no longer sees the same set of calls. Shares are
 * rounded cumulatively in one fixed order (workspace, then call), so the rows
 * add up exactly to the amount spread. Re-running with the same reference
 * and total continues an interrupted run. A usage statement already posted
 * for the month keeps its charge; each such workspace's charged and current
 * figures are returned (correction entries come in phase C,
 * docs/features/platform-finance.md).
 */
export async function priceProviderUsage(
  db: Database,
  a: Actor,
  input: {
    period: string;
    provider: string;
    usageTotalUsd: string;
    invoiceReference: string;
    evidenceReference: string;
    expectedRows: number;
    expectedEstimateUsd: string;
    acknowledgeFactor?: boolean;
  },
  now = new Date(),
) {
  if (monthCutoff(input.period).getTime() > now.getTime())
    throw fail(409, "PERIOD_OPEN", "Price a provider's month after it ends");
  const preview = await providerUsage(db, a, input);
  if (preview.inFlight)
    throw fail(
      409,
      "USAGE_IN_FLIGHT",
      "Some calls of this month are still running; try again in a few minutes",
    );
  if (preview.withoutEstimate)
    throw fail(
      409,
      "ROWS_WITHOUT_ESTIMATE",
      `${preview.withoutEstimate} call(s) of this provider and month have no estimate. The total also covers them, so reconcile them one by one from the invoice (or estimate them) first; then price the rest.`,
    );
  const total = usdUnits(input.usageTotalUsd);
  if (preview.referenceTotals.some((t) => usdUnits(t) !== total))
    throw fail(
      409,
      "INVOICE_CONFLICT",
      "Rows were already priced with this reference and a different total",
    );
  if (
    preview.adjustableRows !== input.expectedRows ||
    usdUnits(preview.adjustableEstimateUsd) !== usdUnits(input.expectedEstimateUsd)
  )
    throw fail(
      409,
      "PREVIEW_CHANGED",
      "The provider's calls for this month changed; review the preview again",
    );
  const estimate = usdUnits(preview.adjustableEstimateUsd);
  const target = total - usdUnits(preview.fixedUsd);
  if (!preview.adjustableRows)
    throw fail(409, "NOTHING_TO_PRICE", "No unresolved or estimated calls to price");
  if (target < 0n)
    throw fail(
      409,
      "TOTAL_BELOW_PRICED",
      `The total is below the ${preview.fixedUsd} USD already priced for this provider and month`,
    );
  if (estimate === 0n && target > 0n)
    throw fail(
      409,
      "NO_ESTIMATE_BASIS",
      "The calls carry no estimate to spread the total over; reconcile them one by one",
    );
  // A resumed run must see exactly the calls the first run under this
  // reference saw; otherwise the shares already written would be wrong.
  const scope = scopeKey(
    preview.adjustableRows,
    usdText(estimate),
    preview.fixedUsd,
  );
  if (preview.pricedByReference && preview.referenceScopes.some((s) => s !== scope))
    throw fail(
      409,
      "REFERENCE_SCOPE_CHANGED",
      "Calls of this month were added, priced or reconciled since this reference was first used. Its priced calls are final; reconcile the rest one by one with the invoice lines.",
    );
  const factor = pricingFactor(target, estimate);
  if (
    factor !== null &&
    (factor < FACTOR_RANGE.low || factor > FACTOR_RANGE.high) &&
    !input.acknowledgeFactor
  )
    throw fail(
      409,
      "FACTOR_REVIEW_REQUIRED",
      `The total less what is already priced (${usdText(target)} USD) is ${factor} times the estimates (${usdText(estimate)} USD). Check the total, then confirm this factor to price the calls.`,
    );
  const reconciliation = {
    method: "provider_total",
    invoiceReference: input.invoiceReference,
    evidenceReference: input.evidenceReference,
    providerTotalUsd: usdText(total),
    allocatedUsd: usdText(target),
    estimateTotalUsd: usdText(estimate),
    fixedUsd: preview.fixedUsd,
    adjustableRows: preview.adjustableRows,
    factor,
    reviewedBy: a.userId,
    reviewedAt: now.toISOString(),
  };
  const started = {
    period: input.period,
    provider: input.provider,
    invoiceReference: input.invoiceReference,
    evidenceReference: input.evidenceReference,
    providerTotalUsd: usdText(total),
    fixedUsd: preview.fixedUsd,
    allocatedUsd: usdText(target),
    estimateTotalUsd: usdText(estimate),
    rows: preview.adjustableRows,
    alreadyPriced: preview.pricedByReference,
    factor,
    factorAcknowledged: !!input.acknowledgeFactor,
  };
  await db.system((tx) =>
    audit(tx, a, "finance.provider_usage_pricing_started", started),
  );
  const { from, to } = monthParams(input.period);
  let priced = 0;
  let allocated = 0n;
  let allocatedTotal = 0n;
  let offset = 0n;
  const changed: Array<{ tenantId: string; rows: number; allocatedUsd: string }> = [];
  const charged: Array<{
    tenantId: string;
    name: string;
    chargedUsd: string;
    aedPerUsd: number;
    chargeMinor: number;
    currentChargeableUsd: string;
    currentChargeMinor: number;
    differenceMinor: number;
  }> = [];
  for (const w of preview.workspaces) {
    const workspaceOffset = offset;
    offset += usdUnits(w.estimateUsd);
    if (!w.rows) continue;
    const scoped = operatorScope(a, w.tenantId);
    const result = await db.tenant(scoped, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        w.tenantId,
      ]);
      // Cumulative rounding: each row gets round(C_i x f) - round(C_(i-1) x f)
      // where C is the running estimate over every workspace in id order.
      const updated = await tx.query(
        `WITH a AS (SELECT id,status,estimated_cost_usd AS est,sum(estimated_cost_usd) OVER (ORDER BY id) AS cum FROM cost_events WHERE ${IN_MONTH} AND (${ADJUSTABLE})) UPDATE cost_events c SET status='reconciled',cost_usd=CASE WHEN $6::numeric=0 THEN 0 ELSE round(($7::numeric+a.cum)*$5::numeric/$6::numeric,8)-round(($7::numeric+a.cum-a.est)*$5::numeric/$6::numeric,8) END,reconciliation=$8::jsonb||jsonb_build_object('previousStatus',c.status,'previousCostUsd',c.cost_usd,'estimateUsd',c.estimated_cost_usd) FROM a WHERE c.id=a.id AND a.status<>'reconciled' RETURNING c.cost_usd::text AS cost`,
        [
          input.provider,
          from,
          input.invoiceReference,
          to,
          usdText(target),
          usdText(estimate),
          usdText(workspaceOffset),
          JSON.stringify(reconciliation),
        ],
      );
      const [byReference] = await tx.query(
        `SELECT coalesce(sum(cost_usd),0)::numeric(18,8)::text AS usd FROM cost_events WHERE ${IN_MONTH} AND ${BY_REFERENCE}`,
        [input.provider, from, input.invoiceReference, to],
      );
      const thisRun = updated.reduce((n, r) => n + usdUnits(r.cost), 0n);
      if (updated.length)
        await event(tx, scoped, "finance.provider_usage_priced", randomUUID(), {
          period: input.period,
          provider: input.provider,
          invoiceReference: input.invoiceReference,
          evidenceReference: input.evidenceReference,
          rows: updated.length,
          allocatedUsd: usdText(thisRun),
        });
      // A month already charged keeps its charge; its charged and current
      // figures are returned so the difference is visible.
      const [statement] = await tx.query(
        "SELECT total_cost_usd::text AS usd,fx_aed_per_usd::text AS fx,charge_minor FROM usage_statements WHERE period=$1",
        [input.period],
      );
      const current = statement
        ? await periodUsage(tx, input.period, Number(statement.fx))
        : null;
      return { updated, thisRun, byReference: byReference.usd, statement, current };
    });
    priced += result.updated.length;
    allocated += result.thisRun;
    allocatedTotal += usdUnits(result.byReference);
    if (result.updated.length)
      changed.push({
        tenantId: w.tenantId,
        rows: result.updated.length,
        allocatedUsd: usdText(result.thisRun),
      });
    if (result.statement && result.current)
      charged.push({
        tenantId: w.tenantId,
        name: w.name,
        chargedUsd: result.statement.usd,
        aedPerUsd: Number(result.statement.fx),
        chargeMinor: Number(result.statement.charge_minor),
        currentChargeableUsd: result.current.chargeableUsd,
        currentChargeMinor: result.current.chargeMinor,
        differenceMinor:
          result.current.chargeMinor - Number(result.statement.charge_minor),
      });
  }
  await db.system((tx) =>
    audit(tx, a, "finance.provider_usage_priced", {
      ...started,
      priced,
      allocatedThisRunUsd: usdText(allocated),
      allocatedTotalUsd: usdText(allocatedTotal),
      workspaces: changed,
      chargedWorkspaces: charged.map((c) => ({
        tenantId: c.tenantId,
        differenceMinor: c.differenceMinor,
      })),
    }),
  );
  return {
    period: input.period,
    provider: input.provider,
    priced,
    alreadyPriced: preview.pricedByReference,
    providerTotalUsd: usdText(total),
    fixedUsd: preview.fixedUsd,
    allocatedUsd: usdText(target),
    estimateTotalUsd: usdText(estimate),
    factor,
    usageStatementsPosted: preview.usageStatementsPosted,
    chargedWorkspaces: charged,
    note: preview.usageStatementsPosted
      ? "Usage statements already posted for this month keep their charge. The workspaces listed were charged at the estimates; the difference is shown here and on each workspace's usage statements, and is not charged (correction entries come in a later phase)."
      : null,
    allocatedThisRunUsd: usdText(allocated),
    /** Every call priced under this reference, all runs: equals allocatedUsd. */
    allocatedTotalUsd: usdText(allocatedTotal),
  };
}

/** One audit row, written in the caller's service transaction. */
async function audit(
  tx: Tx,
  a: Actor,
  action: string,
  data: Record<string, unknown>,
) {
  await tx.query(
    "INSERT INTO admin_operations_audit(id,actor_id,action,data) VALUES($1,$2,$3,$4)",
    [randomUUID(), a.userId, action, JSON.stringify(data)],
  );
}

/** Every workspace's posted usage statement for a month. */
async function postedUsageStatements(db: Database, a: Actor, period: string) {
  const out: Array<{ tenantId: string; name: string; aedPerUsd: number; chargeMinor: number }> = [];
  for (const w of await workspaces(db)) {
    const [s] = await db.tenant(operatorScope(a, w.id), (tx) =>
      tx.query(
        "SELECT fx_aed_per_usd::text AS fx,charge_minor FROM usage_statements WHERE period=$1",
        [period],
      ),
    );
    if (s)
      out.push({
        tenantId: w.id,
        name: w.name,
        aedPerUsd: Number(s.fx),
        chargeMinor: Number(s.charge_minor),
      });
  }
  return out;
}

export function registerPlatformFinance(
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
    return a;
  };
  const prefix = "/api/v1/admin/finance";
  const provider = z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{0,59}$/);

  app.get(prefix + "/exchange-rates", async (req) => {
    const a = access(req);
    return db.system(async (tx) => {
      const rows = await tx.query(
        "SELECT id,month,revision,aed_per_usd::text AS aed_per_usd,source,reviewed_by,created_at,(revision=max(revision) OVER (PARTITION BY month)) AS current FROM exchange_rates ORDER BY month DESC,revision DESC LIMIT 240",
      );
      await audit(tx, a, "finance.exchange_rates_read", {});
      return {
        defaultAedPerUsd: financeSettings().defaultAedPerUsd,
        rates: rows,
      };
    });
  });
  app.post(prefix + "/exchange-rates", async (req) => {
    const a = access(req);
    const b = z
      .object({
        month: period,
        aedPerUsd: z.number().min(1).max(10),
        source: z.string().trim().min(5).max(500),
        // Required when usage for the month was already charged at another
        // rate: those charges keep their rate and will differ from metrics.
        acknowledgePostedStatements: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    if (!/^\d+(\.\d{1,6})?$/.test(String(b.aedPerUsd)))
      throw fail(400, "RATE_PRECISION", "Use at most six decimal places");
    const posted = await postedUsageStatements(db, a, b.month);
    const otherRate = posted.filter((s) => s.aedPerUsd !== b.aedPerUsd);
    const result = await db.system(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "exchange-rate:" + b.month,
      ]);
      const [current] = await tx.query(
        "SELECT revision,aed_per_usd::text AS rate,source FROM exchange_rates WHERE month=$1 ORDER BY revision DESC LIMIT 1",
        [b.month],
      );
      if (current && Number(current.rate) === b.aedPerUsd) {
        await audit(tx, a, "finance.exchange_rate_unchanged", {
          month: b.month,
          aedPerUsd: b.aedPerUsd,
          revision: current.revision,
        });
        return { ...current, unchanged: true };
      }
      if (otherRate.length && !b.acknowledgePostedStatements)
        return { refused: true };
      const [inserted] = await tx.query(
        "INSERT INTO exchange_rates(id,month,revision,aed_per_usd,source,reviewed_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,month,revision,aed_per_usd::text AS aed_per_usd,source,created_at",
        [
          randomUUID(),
          b.month,
          (current?.revision ?? 0) + 1,
          b.aedPerUsd,
          b.source,
          a.userId,
        ],
      );
      await audit(tx, a, "finance.exchange_rate_set", {
        month: b.month,
        aedPerUsd: b.aedPerUsd,
        revision: inserted.revision,
        source: b.source,
        previousAedPerUsd: current ? Number(current.rate) : null,
        previousRevision: current?.revision ?? null,
        previousSource: current?.source ?? null,
        usageStatementsAtOtherRate: otherRate.length,
      });
      return inserted;
    });
    if ("refused" in result)
      throw fail(
        409,
        "POSTED_STATEMENTS_DIFFER",
        `${otherRate.length} workspace(s) were already charged for ${b.month}'s usage at another rate (${[...new Set(otherRate.map((s) => s.aedPerUsd))].join(", ")} AED per USD). Those charges keep their rate and will differ from business metrics for the month. Confirm to record the rate anyway.`,
      );
    return { ...result, usageStatementsAtOtherRate: otherRate.length };
  });

  app.get(prefix + "/model-prices", async (req) => {
    const a = access(req);
    return db.system(async (tx) => {
      const rows = await tx.query(
        "SELECT id,provider,model,input_usd_per_million::text AS input_usd_per_million,output_usd_per_million::text AS output_usd_per_million,price_version,effective_from,source,created_by,created_at FROM model_prices ORDER BY provider,model,effective_from DESC LIMIT 500",
      );
      await audit(tx, a, "finance.model_prices_read", {});
      return { prices: rows };
    });
  });
  app.post(prefix + "/model-prices", async (req) => {
    const a = access(req);
    const b = z
      .object({
        provider,
        model: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/),
        inputUsdPerMillion: z.number().min(0).max(100000),
        outputUsdPerMillion: z.number().min(0).max(100000),
        priceVersion: z.string().trim().min(1).max(100),
        effectiveFrom: z.string().datetime({ offset: true }).optional(),
        source: z.string().trim().min(5).max(500),
      })
      .strict()
      .parse(req.body);
    const effective = b.effectiveFrom ? new Date(b.effectiveFrom) : new Date();
    if (effective.getTime() > Date.now() + 366 * 86400000)
      throw fail(400, "PRICE_DATE", "A price can take effect at most a year ahead");
    const row = await db.system(async (tx) => {
      const [inserted] = await tx.query(
        "INSERT INTO model_prices(id,provider,model,input_usd_per_million,output_usd_per_million,price_version,effective_from,source,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (provider,model,effective_from) DO NOTHING RETURNING id,provider,model,input_usd_per_million::text AS input_usd_per_million,output_usd_per_million::text AS output_usd_per_million,price_version,effective_from",
        [
          randomUUID(),
          b.provider,
          b.model,
          b.inputUsdPerMillion,
          b.outputUsdPerMillion,
          b.priceVersion,
          effective.toISOString(),
          b.source,
          a.userId,
        ],
      );
      if (inserted)
        await audit(tx, a, "finance.model_price_added", {
          provider: b.provider,
          model: b.model,
          inputUsdPerMillion: b.inputUsdPerMillion,
          outputUsdPerMillion: b.outputUsdPerMillion,
          priceVersion: b.priceVersion,
          effectiveFrom: effective.toISOString(),
          source: b.source,
        });
      return inserted;
    });
    if (!row)
      throw fail(
        409,
        "PRICE_EXISTS",
        "A price for this provider and model already takes effect at that time",
      );
    return row;
  });

  app.get(prefix + "/provider-usage/providers", async (req) => {
    const a = access(req);
    const q = z.object({ period }).parse(req.query);
    const providers = await monthProviders(db, a, q.period);
    await db.system((tx) =>
      audit(tx, a, "finance.provider_usage_read", { period: q.period }),
    );
    return { period: q.period, providers };
  });
  app.get(prefix + "/provider-usage", async (req) => {
    const a = access(req);
    const q = z
      .object({
        period,
        provider,
        invoiceReference: z.string().trim().min(3).max(200).optional(),
      })
      .parse(req.query);
    const result = await providerUsage(db, a, q);
    await db.system((tx) =>
      audit(tx, a, "finance.provider_usage_read", {
        period: q.period,
        provider: q.provider,
        invoiceReference: q.invoiceReference ?? null,
      }),
    );
    return result;
  });
  app.post(prefix + "/provider-usage/price", async (req) => {
    const a = access(req);
    const b = z
      .object({
        period,
        provider,
        usageTotalUsd: usd,
        invoiceReference: z.string().trim().min(3).max(200),
        evidenceReference: z.string().trim().min(10).max(500),
        expectedRows: z.number().int().min(0),
        expectedEstimateUsd: usd,
        acknowledgeFactor: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    return priceProviderUsage(db, a, b);
  });
}
