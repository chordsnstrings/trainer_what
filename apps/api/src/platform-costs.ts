import { randomUUID } from "node:crypto";
import { z } from "zod";
import { elevated, type Actor, type Database } from "@trainer/db";
import { platformWorkspaceSql } from "./workspace-state.ts";
import { registrarFromConfig } from "../../../packages/providers/src/registrar.ts";
import { periodSchemaText } from "./cost-accounting.ts";

// The platform's own costs (docs/features/platform-finance.md, phase C):
// what belongs to no trainer (servers, the email plan, provider plans and
// invoice charges not attributed to calls, registrar top-ups, payout bank
// fees), entered by hand with a receipt reference, monthly from a recurring
// entry, from a provider invoice or (phase D) from DigitalOcean's billing.
// platform_costs is append-only (migration 076): a mistake is corrected by a
// reversal entry. Registrar top-ups are prepayments: they fund the
// registrar's balance and are not costs in the profit and loss (the
// registrar's charge for each domain is).

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

export const COST_CATEGORIES = [
  "server",
  "email",
  "provider_plan",
  "provider_invoice",
  "registrar_topup",
  "payout_fee",
  "app_store",
  "domain",
  "other",
] as const;
export const RECURRING_CATEGORIES = [
  "server",
  "email",
  "provider_plan",
  "app_store",
  "domain",
  "other",
] as const;
export type PlatformCostRow = {
  id: string;
  month: string;
  category: string;
  description: string;
  vendor: string | null;
  amountMinor: number;
  currency: string;
  estimated: boolean;
  source: string;
  receiptReference: string;
  payoutId: string | null;
  tenantId: string | null;
  reversesId: string | null;
  reversed: boolean;
  createdAt: string;
};
export type ProviderInvoice = {
  id: string;
  provider: string;
  month: string;
  reference: string;
  totalUsd: number;
  usageUsd: number;
  planUsd: number;
  lineCount: number;
  result: Record<string, unknown>;
  createdAt: string;
};

const costRow = (r: any): PlatformCostRow => ({
  id: r.id,
  month: r.month,
  category: r.category,
  description: r.description,
  vendor: r.vendor,
  amountMinor: Number(r.amount_minor),
  currency: r.currency,
  estimated: r.estimated,
  source: r.source,
  receiptReference: r.receipt_reference,
  payoutId: r.payout_id,
  tenantId: r.tenant_id,
  reversesId: r.reverses_id,
  reversed: !!r.reversed,
  createdAt: new Date(r.created_at).toISOString(),
});

/** Platform cost entries (reversals included, as negative amounts) of the given months. */
export async function platformCostsForMonths(
  db: Database,
  months: string[],
): Promise<PlatformCostRow[]> {
  if (!months.length) return [];
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT c.*,EXISTS(SELECT 1 FROM platform_costs r WHERE r.reverses_id=c.id) AS reversed FROM platform_costs c WHERE c.month=ANY($1::text[]) ORDER BY c.month,c.created_at,c.id",
      [months],
    ),
  );
  return [...rows.map(costRow), ...(await Promise.all(extraCosts.map((x) => x(db, months)))).flat()];
}
/**
 * Costs another module supplies for months (phase D: DigitalOcean's
 * estimate for a month whose invoice has not arrived), registered at load.
 */
const extraCosts: Array<(db: Database, months: string[]) => Promise<PlatformCostRow[]>> = [];
export function registerPlatformCostSource(
  source: (db: Database, months: string[]) => Promise<PlatformCostRow[]>,
) {
  extraCosts.push(source);
}

/** Provider invoices imported for the given months. */
export async function providerInvoicesForMonths(
  db: Database,
  months: string[],
): Promise<ProviderInvoice[]> {
  if (!months.length) return [];
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT id,provider,month,reference,total_usd::text AS total,usage_usd::text AS usage,plan_usd::text AS plan,line_count,result,created_at FROM provider_invoices WHERE month=ANY($1::text[]) ORDER BY month,provider,created_at",
      [months],
    ),
  );
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    month: r.month,
    reference: r.reference,
    totalUsd: Number(r.total),
    usageUsd: Number(r.usage),
    planUsd: Number(r.plan),
    lineCount: r.line_count,
    result: r.result ?? {},
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** Stripe's actual fees per month, workspace and currency (phase C). */
export async function stripeFeesForMonths(db: Database, months: string[]) {
  if (!months.length) return [];
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT month,tenant_id,currency,product,source_type,count(*)::int AS n,coalesce(sum(fee_minor),0)::text AS fee FROM stripe_fees WHERE month=ANY($1::text[]) GROUP BY 1,2,3,4,5",
      [months],
    ),
  );
  return rows.map((r) => ({
    month: r.month as string,
    tenantId: (r.tenant_id as string | null) ?? null,
    currency: r.currency as string,
    product: r.product as string,
    sourceType: r.source_type as string,
    count: r.n as number,
    feeMinor: Number(r.fee),
  }));
}

/**
 * The registrar's cost of every trainer domain, all time, per currency (the
 * platform's own figure, never shown to trainers), the top-ups recorded as
 * platform costs, the book balance they leave, and the last balance the
 * registrar reported.
 */
export async function registrarBook(db: Database) {
  const workspaces = await db.system((tx) =>
    tx.query<{ id: string }>(
      "SELECT t.id FROM tenants t WHERE NOT " +
        platformWorkspaceSql("t.id") +
        " ORDER BY t.id",
    ),
  );
  const charged: Record<string, number> = {};
  for (const w of workspaces) {
    const rows = await db.tenant(
      elevated("worker", { tenantId: w.id, role: "finance" }),
      (tx) =>
        tx.query(
          "SELECT j.currency,coalesce(sum(l.amount_minor),0)::text AS amount FROM journals j JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_id=j.id WHERE l.account='registrar_cost' GROUP BY j.currency",
        ),
    );
    for (const r of rows)
      charged[r.currency] = (charged[r.currency] ?? 0) + Number(r.amount);
  }
  const topUps: Record<string, number> = {};
  for (const r of await db.system((tx) =>
    tx.query(
      "SELECT currency,coalesce(sum(amount_minor),0)::text AS amount FROM platform_costs WHERE category='registrar_topup' GROUP BY currency",
    ),
  ))
    topUps[r.currency] = Number(r.amount);
  const book: Record<string, number> = {};
  for (const c of new Set([...Object.keys(charged), ...Object.keys(topUps)]))
    book[c] = (topUps[c] ?? 0) - (charged[c] ?? 0);
  const [reading] = await db.system((tx) =>
    tx.query(
      "SELECT result,finished_at,status,error FROM platform_finance_runs WHERE kind='registrar_balance' AND status<>'running' ORDER BY started_at DESC LIMIT 1",
    ),
  );
  return {
    chargedMinor: charged,
    topUpsMinor: topUps,
    /** Top-ups less registrar charges: what the prepaid balance should hold. */
    bookBalanceMinor: Object.keys(topUps).length ? book : null,
    lastReading: reading
      ? {
          at: reading.finished_at,
          status: reading.status,
          currency: reading.result?.currency ?? null,
          available: reading.result?.available ?? null,
          error: reading.error ?? null,
        }
      : null,
  };
}

/** Reads the registrar's available balance (a read-only call). */
export async function readRegistrarBalance() {
  const registrar = registrarFromConfig();
  const balance = await registrar.balance();
  return {
    registrar: registrar.id,
    currency: balance.currency,
    available: balance.available,
  };
}

// ---- Manual, recurring and payout fee entries ------------------------------------

/** A decimal amount in major units ("12.50") as minor units, exactly. */
export function minorOf(value: string) {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw fail(400, "AMOUNT_INVALID", "Use an amount such as 12.50");
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
const month = z.string().regex(periodSchemaText);
const amount = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/);
const currency = z.enum(["AED", "USD"]);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const platformCostInput = z
  .object({
    intent: z.string().uuid(),
    month,
    category: z.enum(COST_CATEGORIES).exclude(["payout_fee"]),
    description: text(3, 500),
    vendor: text(1, 100).optional(),
    amount,
    currency,
    receiptReference: text(3, 300),
    estimated: z.boolean().optional(),
  })
  .strict();
async function insertCost(
  db: Database,
  row: {
    month: string;
    category: string;
    description: string;
    vendor?: string | null;
    amountMinor: number;
    currency: string;
    receiptReference: string;
    source: string;
    externalKey: string | null;
    recurringId?: string | null;
    tenantId?: string | null;
    payoutId?: string | null;
    reversesId?: string | null;
    estimated?: boolean;
    createdBy: string | null;
  },
) {
  return db.system(async (tx) => {
    const [inserted] = await tx.query(
      "INSERT INTO platform_costs(id,month,category,description,vendor,amount_minor,currency,receipt_reference,source,external_key,recurring_id,tenant_id,payout_id,reverses_id,estimated,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT DO NOTHING RETURNING *",
      [
        randomUUID(),
        row.month,
        row.category,
        row.description,
        row.vendor ?? null,
        row.amountMinor,
        row.currency,
        row.receiptReference,
        row.source,
        row.externalKey,
        row.recurringId ?? null,
        row.tenantId ?? null,
        row.payoutId ?? null,
        row.reversesId ?? null,
        row.estimated ?? false,
        row.createdBy,
      ],
    );
    if (inserted) return { row: costRow(inserted), created: true };
    const [existing] = await tx.query(
      "SELECT * FROM platform_costs WHERE external_key=$1 OR ($2::uuid IS NOT NULL AND reverses_id=$2)",
      [row.externalKey, row.reversesId ?? null],
    );
    return { row: existing ? costRow(existing) : null, created: false, existing };
  });
}
/** A manual entry with its receipt; a retried request returns the same entry. */
export async function recordPlatformCost(db: Database, a: Actor, raw: unknown) {
  const b = platformCostInput.parse(raw);
  const minor = minorOf(b.amount);
  if (minor <= 0) throw fail(400, "AMOUNT_INVALID", "The amount must be above zero");
  const result = await insertCost(db, {
    month: b.month,
    category: b.category,
    description: b.description,
    vendor: b.vendor,
    amountMinor: minor,
    currency: b.currency,
    receiptReference: b.receiptReference,
    source: "manual",
    externalKey: "manual:" + b.intent,
    estimated: b.estimated,
    createdBy: a.userId,
  });
  if (!result.created) {
    const e = result.existing;
    if (
      !e ||
      e.month !== b.month ||
      Number(e.amount_minor) !== minor ||
      e.currency !== b.currency ||
      e.category !== b.category
    )
      throw fail(409, "INTENT_CONFLICT", "This entry was already recorded with other values");
  }
  return result.row!;
}
/** Corrects an entry by a reversal entry; the original is kept. */
export async function reversePlatformCost(
  db: Database,
  a: Actor,
  id: string,
  reason: string,
) {
  const [original] = await db.system((tx) =>
    tx.query("SELECT * FROM platform_costs WHERE id=$1", [id]),
  );
  if (!original) throw fail(404, "NOT_FOUND", "Cost entry unavailable");
  if (original.reverses_id)
    throw fail(409, "REVERSAL_OF_REVERSAL", "A reversal cannot be reversed; record a new entry");
  const result = await insertCost(db, {
    month: original.month,
    category: original.category,
    description: ("Reversal: " + reason).slice(0, 500),
    vendor: original.vendor,
    amountMinor: -Number(original.amount_minor),
    currency: original.currency,
    receiptReference: original.receipt_reference,
    source: "reversal",
    externalKey: "reversal:" + original.id,
    tenantId: original.tenant_id,
    payoutId: original.payout_id,
    reversesId: original.id,
    estimated: original.estimated,
    createdBy: a.userId,
  });
  return result.row!;
}

export const recurringInput = z
  .object({
    category: z.enum(RECURRING_CATEGORIES),
    description: text(3, 500),
    vendor: text(1, 100).optional(),
    amount,
    currency,
    receiptReference: text(3, 300),
    startsMonth: month,
    endsMonth: month.optional(),
  })
  .strict();
export async function createRecurringCost(db: Database, a: Actor, raw: unknown) {
  const b = recurringInput.parse(raw);
  const minor = minorOf(b.amount);
  if (minor <= 0) throw fail(400, "AMOUNT_INVALID", "The amount must be above zero");
  if (b.endsMonth && b.endsMonth < b.startsMonth)
    throw fail(400, "PERIOD_INVALID", "The last month is before the first");
  const [row] = await db.system((tx) =>
    tx.query(
      "INSERT INTO platform_recurring_costs(id,category,description,vendor,amount_minor,currency,receipt_reference,starts_month,ends_month,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [randomUUID(), b.category, b.description, b.vendor ?? null, minor, b.currency, b.receiptReference, b.startsMonth, b.endsMonth ?? null, a.userId],
    ),
  );
  return row;
}
/** Sets the last month of a recurring cost (entries already posted stay). */
export async function endRecurringCost(
  db: Database,
  id: string,
  input: { revision: number; endsMonth: string },
) {
  const [row] = await db.system((tx) =>
    tx.query(
      "UPDATE platform_recurring_costs SET ends_month=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND starts_month<=$3 RETURNING *",
      [id, input.revision, input.endsMonth],
    ),
  );
  if (!row)
    throw fail(409, "STALE_REVISION", "The recurring cost changed or starts after that month; reload");
  return row;
}
export async function recurringCosts(db: Database) {
  return db.system((tx) =>
    tx.query("SELECT * FROM platform_recurring_costs ORDER BY ends_month IS NOT NULL,starts_month DESC,created_at DESC LIMIT 200"),
  );
}
/**
 * Enters each recurring cost once for every month from its first month to
 * this month (at most the last 12), until its last month. Idempotent by
 * recurring cost and month.
 */
export async function postRecurringCosts(db: Database, current: string) {
  let posted = 0;
  const earliest = (() => {
    const [y, m] = current.split("-").map(Number);
    return new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 7);
  })();
  for (const r of await db.system((tx) =>
    tx.query("SELECT * FROM platform_recurring_costs WHERE starts_month<=$1 AND (ends_month IS NULL OR ends_month>=$2)", [current, earliest]),
  )) {
    let m = r.starts_month < earliest ? earliest : r.starts_month;
    while (m <= current && (!r.ends_month || m <= r.ends_month)) {
      const result = await insertCost(db, {
        month: m,
        category: r.category,
        description: r.description,
        vendor: r.vendor,
        amountMinor: Number(r.amount_minor),
        currency: r.currency,
        receiptReference: r.receipt_reference,
        source: "recurring",
        externalKey: `recurring:${r.id}:${m}`,
        recurringId: r.id,
        createdBy: null,
      });
      if (result.created) posted++;
      const [y, mo] = m.split("-").map(Number);
      m = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
    }
  }
  return { posted };
}

export const payoutFeeInput = z
  .object({
    tenantId: z.string().uuid(),
    payoutId: z.string().uuid(),
    amount,
    currency,
    receiptReference: text(3, 300),
  })
  .strict();
/**
 * The company bank's fee for one trainer payout (a platform cost, not
 * charged to the trainer). One fee per payout; the payout must have been
 * sent to the bank.
 */
export async function recordPayoutFee(db: Database, a: Actor, raw: unknown) {
  const b = payoutFeeInput.parse(raw);
  const minor = minorOf(b.amount);
  if (minor <= 0) throw fail(400, "AMOUNT_INVALID", "The amount must be above zero");
  const [payout] = await db.tenant(
    elevated("platform-operator", { tenantId: b.tenantId, userId: a.userId, role: "finance" }),
    (tx) => tx.query("SELECT id,period,status,updated_at FROM payouts WHERE id=$1", [b.payoutId]),
  );
  if (!payout) throw fail(404, "NOT_FOUND", "Payout unavailable");
  if (!["submitted", "processing", "paid", "returned", "failed", "unknown"].includes(payout.status))
    throw fail(409, "PAYOUT_NOT_SENT", "A bank fee is recorded for a payout sent to the bank");
  const result = await insertCost(db, {
    month: new Date(new Date(payout.updated_at).getTime() + 4 * 3600000).toISOString().slice(0, 7),
    category: "payout_fee",
    description: `Bank fee for the ${payout.period} payout`,
    vendor: "Company bank",
    amountMinor: minor,
    currency: b.currency,
    receiptReference: b.receiptReference,
    source: "payout_fee",
    externalKey: "payout-fee:" + b.payoutId,
    tenantId: b.tenantId,
    payoutId: b.payoutId,
    createdBy: a.userId,
  });
  if (!result.created && (Number(result.existing?.amount_minor) !== minor || result.existing?.currency !== b.currency))
    throw fail(409, "INTENT_CONFLICT", "This payout already has a different bank fee; reverse it first");
  return result.row!;
}
/**
 * Enters a charge that is not attributed to calls (a provider's plan fee,
 * an invoice's unmatched remainder) from an invoice import.
 */
export async function recordInvoiceCost(
  db: Database,
  input: {
    provider: string;
    month: string;
    reference: string;
    description: string;
    usd: number;
    createdBy: string;
    kind: "plan" | "remainder";
  },
) {
  const cents = Math.round(input.usd * 100);
  if (cents <= 0) return null;
  return (
    await insertCost(db, {
      month: input.month,
      category: input.kind === "plan" ? "provider_plan" : "provider_invoice",
      description: input.description.slice(0, 500),
      vendor: input.provider,
      amountMinor: cents,
      currency: "USD",
      receiptReference: input.reference,
      source: "invoice_import",
      externalKey: `invoice:${input.provider}:${input.reference}:${input.kind}`,
      createdBy: input.createdBy,
    })
  ).row;
}
