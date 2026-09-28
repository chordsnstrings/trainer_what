import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { elevated, type Actor, type Database } from "@trainer/db";
import { requireRecentMfa } from "./security.ts";
import { monthCutoff } from "./finance-operations.ts";
import { financeSettings, periodSchemaText } from "./cost-accounting.ts";

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
const ADJUSTABLE =
  "((cost_usd IS NULL OR status='estimated') AND estimated_cost_usd IS NOT NULL AND NOT (status='reserved' AND created_at>=now()-interval '15 minutes')) OR (status='reconciled' AND reconciliation->>'invoiceReference'=$3)";
const IN_MONTH =
  "provider=$1 AND to_char(created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM')=$2";

type WorkspaceUsage = {
  tenantId: string;
  name: string;
  rows: number;
  estimateUsd: string;
  pricedByReference: number;
  referenceTotals: string[];
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

/**
 * One provider's cost rows for a Dubai month across every workspace, split
 * into what a provider total can price and what is already final.
 */
export async function providerUsage(
  db: Database,
  a: Actor,
  input: { period: string; provider: string; invoiceReference?: string },
) {
  const rows: WorkspaceUsage[] = [];
  for (const w of await workspaces(db)) {
    const r = await db.tenant(operatorScope(a, w.id), async (tx) => {
      const [u] = await tx.query(
        `SELECT count(*) FILTER(WHERE ${ADJUSTABLE})::int AS rows,coalesce(sum(estimated_cost_usd) FILTER(WHERE ${ADJUSTABLE}),0)::text AS estimate,count(*) FILTER(WHERE status='reconciled' AND reconciliation->>'invoiceReference'=$3)::int AS by_reference,coalesce(array_agg(DISTINCT reconciliation->>'providerTotalUsd') FILTER(WHERE status='reconciled' AND reconciliation->>'invoiceReference'=$3),'{}') AS reference_totals,count(*) FILTER(WHERE cost_usd IS NOT NULL AND NOT (${ADJUSTABLE}))::int AS fixed_rows,coalesce(sum(cost_usd) FILTER(WHERE cost_usd IS NOT NULL AND NOT (${ADJUSTABLE})),0)::text AS fixed,count(*) FILTER(WHERE status='reserved' AND created_at>=now()-interval '15 minutes')::int AS in_flight,count(*) FILTER(WHERE cost_usd IS NULL AND estimated_cost_usd IS NULL AND NOT (status='reserved' AND created_at>=now()-interval '15 minutes'))::int AS without_estimate FROM cost_events WHERE ${IN_MONTH}`,
        [input.provider, input.period, input.invoiceReference ?? ""],
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
    workspaces: rows,
  };
}

/**
 * Prices a provider's month from its usage or invoice total (plan fees
 * excluded): the total less the rows already final is spread over the
 * adjustable rows in proportion to their stored estimates, each marked
 * 'reconciled' with the reference. The estimate on every row is kept.
 * Re-running with the same reference and total continues an interrupted run;
 * a usage statement already posted for the month is not changed (its
 * difference is corrected in a later phase, docs/features/platform-finance.md).
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
  const total = usdUnits(input.usageTotalUsd);
  if (
    preview.referenceTotals.some((t) => usdUnits(t) !== total)
  )
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
  const reconciliation = {
    method: "provider_total",
    invoiceReference: input.invoiceReference,
    evidenceReference: input.evidenceReference,
    providerTotalUsd: usdText(total),
    allocatedUsd: usdText(target),
    estimateTotalUsd: usdText(estimate),
    reviewedBy: a.userId,
    reviewedAt: now.toISOString(),
  };
  let priced = 0;
  let allocated = 0n;
  for (const w of preview.workspaces) {
    if (!w.rows) continue;
    const result = await db.tenant(operatorScope(a, w.tenantId), async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        w.tenantId,
      ]);
      const updated = await tx.query(
        `UPDATE cost_events SET status='reconciled',cost_usd=CASE WHEN $5::numeric=0 THEN 0 ELSE round(estimated_cost_usd*$4::numeric/$5::numeric,8) END,reconciliation=$6::jsonb||jsonb_build_object('previousStatus',status,'previousCostUsd',cost_usd,'estimateUsd',estimated_cost_usd) WHERE ${IN_MONTH} AND (${ADJUSTABLE}) AND status<>'reconciled' RETURNING cost_usd::text AS cost`,
        [
          input.provider,
          input.period,
          input.invoiceReference,
          usdText(target),
          usdText(estimate),
          JSON.stringify(reconciliation),
        ],
      );
      return updated;
    });
    priced += result.length;
    allocated += result.reduce((n, r) => n + usdUnits(r.cost), 0n);
  }
  await audit(db, a, "finance.provider_usage_priced", {
    period: input.period,
    provider: input.provider,
    invoiceReference: input.invoiceReference,
    providerTotalUsd: usdText(total),
    rows: priced,
  });
  return {
    period: input.period,
    provider: input.provider,
    priced,
    alreadyPriced: preview.pricedByReference,
    providerTotalUsd: usdText(total),
    fixedUsd: preview.fixedUsd,
    allocatedUsd: usdText(target),
    usageStatementsPosted: preview.usageStatementsPosted,
    note: preview.usageStatementsPosted
      ? "Usage statements already posted for this month keep their charge; the difference is reported, not charged."
      : null,
    allocatedThisRunUsd: usdText(allocated),
  };
}

async function audit(
  db: Database,
  a: Actor,
  action: string,
  data: Record<string, unknown>,
) {
  await db.system((tx) =>
    tx.query(
      "INSERT INTO admin_operations_audit(id,actor_id,action,data) VALUES($1,$2,$3,$4)",
      [randomUUID(), a.userId, action, JSON.stringify(data)],
    ),
  );
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

  app.get(prefix + "/exchange-rates", async (req) => {
    const a = access(req);
    const rows = await db.system((tx) =>
      tx.query(
        "SELECT id,month,revision,aed_per_usd::text AS aed_per_usd,source,reviewed_by,created_at,(revision=max(revision) OVER (PARTITION BY month)) AS current FROM exchange_rates ORDER BY month DESC,revision DESC LIMIT 240",
      ),
    );
    await audit(db, a, "finance.exchange_rates_read", {});
    return {
      defaultAedPerUsd: financeSettings().defaultAedPerUsd,
      rates: rows,
    };
  });
  app.post(prefix + "/exchange-rates", async (req) => {
    const a = access(req);
    const b = z
      .object({
        month: period,
        aedPerUsd: z.number().min(1).max(10),
        source: z.string().trim().min(5).max(500),
      })
      .strict()
      .parse(req.body);
    if (!/^\d+(\.\d{1,6})?$/.test(String(b.aedPerUsd)))
      throw fail(400, "RATE_PRECISION", "Use at most six decimal places");
    const row = await db.system(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "exchange-rate:" + b.month,
      ]);
      const [current] = await tx.query(
        "SELECT revision,aed_per_usd::text AS rate FROM exchange_rates WHERE month=$1 ORDER BY revision DESC LIMIT 1",
        [b.month],
      );
      if (current && Number(current.rate) === b.aedPerUsd)
        return { ...current, unchanged: true };
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
      return inserted;
    });
    await audit(db, a, "finance.exchange_rate_set", {
      month: b.month,
      aedPerUsd: b.aedPerUsd,
      revision: row.revision,
    });
    return row;
  });

  app.get(prefix + "/model-prices", async (req) => {
    const a = access(req);
    const rows = await db.system((tx) =>
      tx.query(
        "SELECT id,provider,model,input_usd_per_million::text AS input_usd_per_million,output_usd_per_million::text AS output_usd_per_million,price_version,effective_from,source,created_by,created_at FROM model_prices ORDER BY provider,model,effective_from DESC LIMIT 500",
      ),
    );
    await audit(db, a, "finance.model_prices_read", {});
    return { prices: rows };
  });
  app.post(prefix + "/model-prices", async (req) => {
    const a = access(req);
    const b = z
      .object({
        provider: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9][a-z0-9._-]{0,59}$/),
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
    const [row] = await db.system((tx) =>
      tx.query(
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
      ),
    );
    if (!row)
      throw fail(
        409,
        "PRICE_EXISTS",
        "A price for this provider and model already takes effect at that time",
      );
    await audit(db, a, "finance.model_price_added", {
      provider: b.provider,
      model: b.model,
      priceVersion: b.priceVersion,
      effectiveFrom: effective.toISOString(),
    });
    return row;
  });

  app.get(prefix + "/provider-usage", async (req) => {
    const a = access(req);
    const q = z
      .object({
        period,
        provider: z.string().trim().min(1).max(60),
        invoiceReference: z.string().trim().min(3).max(200).optional(),
      })
      .parse(req.query);
    const result = await providerUsage(db, a, q);
    await audit(db, a, "finance.provider_usage_read", {
      period: q.period,
      provider: q.provider,
    });
    return result;
  });
  app.post(prefix + "/provider-usage/price", async (req) => {
    const a = access(req);
    const b = z
      .object({
        period,
        provider: z.string().trim().min(1).max(60),
        usageTotalUsd: usd,
        invoiceReference: z.string().trim().min(3).max(200),
        evidenceReference: z.string().trim().min(10).max(500),
        expectedRows: z.number().int().min(0),
        expectedEstimateUsd: usd,
      })
      .strict()
      .parse(req.body);
    return priceProviderUsage(db, a, b);
  });
}
