import { elevated, type Actor, type Database, type Tx } from "@trainer/db";
import { platformWorkspaceSql } from "./workspace-state.ts";
import { dubaiMonthRange } from "./cost-accounting.ts";

// Stripe's actual fee of each charge, refund and dispute (docs/features/
// platform-finance.md, phase C), read from its balance transaction: after a
// Stripe webhook for the workspace (best effort) and by a sweep of the last
// 90 days. Read-only calls to Stripe; stripe_fees is append-only and keyed by
// the balance transaction, so a repeated capture records nothing twice.
// Trainers pay Stripe's fees (owner decision, 28 September 2026): they see
// their month's total on the statement; operators see every fee.

/** The part of the Stripe SDK the capture uses (tests pass a double). */
export type StripeFeeClient = {
  charges: { retrieve: (id: string, params?: any) => Promise<any> };
  refunds: { retrieve: (id: string, params?: any) => Promise<any> };
  disputes: { retrieve: (id: string, params?: any) => Promise<any> };
  paymentIntents: { retrieve: (id: string, params?: any) => Promise<any> };
  balanceTransactions?: { retrieve: (id: string, params?: any) => Promise<any> };
};
type Source = {
  sourceType: "charge" | "refund" | "dispute";
  /** The id the fee is recorded under: ch_, pi_ (a session paid by intent), re_ or dp_. */
  sourceId: string;
  product: string;
  /**
   * A dispute's outcome from the ledger: null while open, "won" (and the
   * other releases) or "lost" once closed. A won dispute has a second
   * balance transaction (the funds reinstated), so it is read again.
   */
  resolution?: string | null;
};
/**
 * A payment, refund or dispute in the ledger, with the Dubai month of its
 * journal and what was paid. `sourceId` is null for a payment journal that
 * names no charge or payment intent: its fee cannot be read from Stripe, so
 * the profit and loss estimates it.
 */
export type LedgerStripeSource = Omit<Source, "sourceId"> & {
  sourceId: string | null;
  month: string;
  currency: string;
  grossMinor: number;
};
const idOf = (value: any): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);
const month = (unixSeconds: number) =>
  new Date(unixSeconds * 1000 + 4 * 3600000).toISOString().slice(0, 7);

/**
 * Payments, refunds and disputes journaled from `from` (to `to`), newest
 * first, in the caller's scoped read: what Stripe charges a fee on.
 */
export async function ledgerStripeSources(
  tx: Tx,
  range: { from: string; to?: string | null; limit?: number },
): Promise<LedgerStripeSource[]> {
  const rows = await tx.query(
    `SELECT j.source_key,to_char(j.created_at AT TIME ZONE 'Asia/Dubai','YYYY-MM') AS month,j.currency,coalesce((j.data->>'grossMinor')::bigint,0)::text AS gross,j.data->>'chargeId' AS charge_id,j.data->>'paymentIntentId' AS payment_intent,CASE
      WHEN j.source_key LIKE 'stripe-invoice:%' AND j.data->>'purpose'='voice_addon' THEN 'voice_addon'
      WHEN j.source_key LIKE 'stripe-invoice:%' THEN 'membership'
      WHEN j.source_key LIKE 'stripe-programme:%' THEN 'programme'
      WHEN j.source_key LIKE 'booking-%' THEN 'booking'
      WHEN j.source_key LIKE 'web-address-%' THEN 'domain'
      ELSE coalesce((SELECT CASE WHEN o.source_key LIKE 'stripe-programme:%' THEN 'programme' WHEN o.data->>'purpose'='voice_addon' THEN 'voice_addon' ELSE 'membership' END FROM journals o WHERE (o.source_key LIKE 'stripe-invoice:%' OR o.source_key LIKE 'stripe-programme:%') AND (o.id::text=j.data->>'originalJournalId' OR (j.data ? 'chargeId' AND o.data->>'chargeId'=j.data->>'chargeId')) ORDER BY o.created_at LIMIT 1),'other') END AS product,
      CASE WHEN j.source_key LIKE 'web-address-dispute:%' THEN 'lost' WHEN j.source_key LIKE 'dispute-reserve:%' THEN (SELECT coalesce(r.data->>'status','lost') FROM journals r WHERE r.source_key='dispute-resolution:'||substr(j.source_key,17) LIMIT 1) END AS resolution
     FROM journals j WHERE j.created_at>=$1 AND ($2::timestamptz IS NULL OR j.created_at<$2) AND (
      j.source_key LIKE 'stripe-invoice:%' OR j.source_key LIKE 'stripe-programme:%' OR j.source_key LIKE 'booking-charge:%'
      OR j.source_key LIKE 'web-address-invoice:%' OR j.source_key LIKE 'stripe-refund:%' OR j.source_key LIKE 'booking-refund:%'
      OR j.source_key LIKE 'web-address-refund:%' OR j.source_key LIKE 'dispute-reserve:%' OR j.source_key LIKE 'web-address-dispute:%')
     ORDER BY j.created_at DESC LIMIT $3`,
    [range.from, range.to ?? null, range.limit ?? 100000],
  );
  const sources: LedgerStripeSource[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = String(r.source_key);
    const suffix = key.slice(key.indexOf(":") + 1);
    const base = {
      product: r.product as string,
      month: r.month as string,
      currency: r.currency as string,
      grossMinor: Number(r.gross),
    };
    let source: LedgerStripeSource | null = null;
    if (/^(stripe-refund|booking-refund|web-address-refund):/.test(key)) {
      if (/^re_/.test(suffix)) source = { ...base, sourceType: "refund", sourceId: suffix };
    } else if (/^(dispute-reserve|web-address-dispute):/.test(key)) {
      if (/^dp_/.test(suffix))
        source = { ...base, sourceType: "dispute", sourceId: suffix, resolution: r.resolution ?? null };
    } else if (base.grossMinor > 0)
      // A payment: Stripe's fee is on its charge (a session paid by intent
      // is found through the intent).
      source = { ...base, sourceType: "charge", sourceId: r.charge_id ?? r.payment_intent ?? null };
    if (!source) continue;
    if (source.sourceId) {
      if (seen.has(source.sourceId)) continue;
      seen.add(source.sourceId);
    }
    sources.push(source);
  }
  return sources;
}

/** Payments, refunds and disputes in a workspace's ledger (last `days`) Stripe can be asked about. */
async function workspaceSources(db: Database, tenantId: string, days: number) {
  const rows = await db.tenant(
    elevated("worker", { tenantId, role: "finance" }),
    (tx) =>
      ledgerStripeSources(tx, {
        from: new Date(Date.now() - days * 86400000).toISOString(),
        limit: 2000,
      }),
  );
  return rows
    .filter((s): s is LedgerStripeSource & { sourceId: string } => !!s.sourceId)
    .map((s) => ({
      sourceType: s.sourceType,
      sourceId: s.sourceId,
      product: s.product,
      resolution: s.resolution ?? null,
      month: s.month,
    }));
}
/** The product of the payment a charge or intent belongs to, in a scoped read. */
async function productOfCharge(
  db: Database,
  tenantId: string,
  chargeId: string | null,
  paymentIntentId: string | null,
) {
  if (!chargeId && !paymentIntentId) return "other";
  const [row] = await db.tenant(elevated("worker", { tenantId, role: "finance" }), (tx) =>
    tx.query(
      "SELECT CASE WHEN source_key LIKE 'web-address-%' THEN 'domain' WHEN source_key LIKE 'stripe-programme:%' THEN 'programme' WHEN source_key LIKE 'booking-%' THEN 'booking' WHEN data->>'purpose'='voice_addon' THEN 'voice_addon' ELSE 'membership' END AS product FROM journals WHERE (source_key LIKE 'stripe-invoice:%' OR source_key LIKE 'stripe-programme:%' OR source_key LIKE 'booking-charge:%' OR source_key LIKE 'web-address-invoice:%') AND ((data->>'chargeId')=$1 OR (data->>'paymentIntentId')=$2) ORDER BY created_at LIMIT 1",
      [chargeId ?? "", paymentIntentId ?? ""],
    ),
  );
  return (row?.product as string | undefined) ?? "other";
}

/** A balance transaction, read when Stripe returned only its id. */
async function expanded(stripe: StripeFeeClient, bt: any) {
  if (bt && typeof bt === "object") return bt;
  if (typeof bt === "string" && stripe.balanceTransactions)
    return stripe.balanceTransactions.retrieve(bt);
  return null;
}
/** The balance transactions of one source, from Stripe (read-only). */
async function balanceTransactions(stripe: StripeFeeClient, s: Source) {
  if (s.sourceType === "charge") {
    let charge: any;
    if (s.sourceId.startsWith("pi_")) {
      const intent = await stripe.paymentIntents.retrieve(s.sourceId, {
        expand: ["latest_charge.balance_transaction"],
      });
      charge =
        intent?.latest_charge && typeof intent.latest_charge === "object"
          ? intent.latest_charge
          : intent?.latest_charge
            ? await stripe.charges.retrieve(intent.latest_charge, {
                expand: ["balance_transaction"],
              })
            : null;
    } else
      charge = await stripe.charges.retrieve(s.sourceId, {
        expand: ["balance_transaction"],
      });
    const bt = await expanded(stripe, charge?.balance_transaction);
    return bt ? [{ bt, chargeId: idOf(charge) }] : [];
  }
  if (s.sourceType === "refund") {
    const refund = await stripe.refunds.retrieve(s.sourceId, {
      expand: ["balance_transaction"],
    });
    const bt = await expanded(stripe, refund?.balance_transaction);
    return bt ? [{ bt, chargeId: idOf(refund.charge) }] : [];
  }
  const dispute = await stripe.disputes.retrieve(s.sourceId);
  return ((dispute?.balance_transactions ?? []) as any[])
    .filter((bt) => bt && typeof bt === "object")
    .map((bt) => ({ bt, chargeId: idOf(dispute.charge) }));
}

/** Records the fees of these sources; returns how many balance transactions were new. */
async function capture(
  db: Database,
  stripe: StripeFeeClient,
  tenantId: string,
  sources: Source[],
) {
  let recorded = 0,
    failed = 0;
  for (const s of sources) {
    let found: Array<{ bt: any; chargeId: string | null }>;
    try {
      found = await balanceTransactions(stripe, s);
    } catch {
      failed++;
      continue;
    }
    for (const { bt, chargeId } of found) {
      if (!/^txn_/.test(String(bt.id ?? ""))) continue;
      const [row] = await db.system((tx) =>
        tx.query(
          "INSERT INTO stripe_fees(balance_transaction_id,tenant_id,source_type,source_id,charge_id,product,currency,amount_minor,fee_minor,net_minor,fee_details,exchange_rate,occurred_at,month) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,to_timestamp($13),$14) ON CONFLICT DO NOTHING RETURNING balance_transaction_id",
          [
            bt.id,
            tenantId,
            s.sourceType,
            s.sourceId,
            chargeId,
            ["membership", "programme", "voice_addon", "booking", "domain"].includes(s.product) ? s.product : "other",
            String(bt.currency ?? "").toUpperCase(),
            Math.trunc(Number(bt.amount ?? 0)),
            Math.trunc(Number(bt.fee ?? 0)),
            Math.trunc(Number(bt.net ?? 0)),
            JSON.stringify(
              ((bt.fee_details ?? []) as any[]).map((d) => ({
                amount: Number(d.amount ?? 0),
                currency: String(d.currency ?? "").toUpperCase(),
                type: String(d.type ?? "").slice(0, 60),
                description: String(d.description ?? "").slice(0, 200),
              })),
            ),
            bt.exchange_rate ?? null,
            Number(bt.created ?? Math.floor(Date.now() / 1000)),
            month(Number(bt.created ?? Math.floor(Date.now() / 1000))),
          ],
        ),
      );
      if (row) recorded++;
    }
  }
  return { recorded, failed };
}

/**
 * Captures Stripe's fee for every payment, refund and dispute of the last
 * `days` that has none recorded yet, at most `limit` Stripe reads per run.
 * One workspace (after its webhook) or every trainer workspace (the sweep).
 */
export async function sweepStripeFees(
  db: Database,
  stripe: StripeFeeClient,
  options: { tenantId?: string; days?: number; limit?: number } = {},
) {
  const days = options.days ?? 90;
  let budget = options.limit ?? 50;
  const tenants = options.tenantId
    ? [{ id: options.tenantId }]
    : await db.system((tx) =>
        tx.query<{ id: string }>(
          "SELECT t.id FROM tenants t WHERE NOT " + platformWorkspaceSql("t.id") + " ORDER BY t.id",
        ),
      );
  let recorded = 0,
    failed = 0,
    pending = 0;
  // The workspaces and journal months whose fees were recorded, so their
  // monthly summary is rebuilt (docs/features/platform-finance.md).
  const touched = new Map<string, Set<string>>();
  for (const t of tenants) {
    const sources = await workspaceSources(db, t.id, days);
    if (!sources.length) continue;
    const known = new Map<string, number>(
      (
        await db.system((tx) =>
          tx.query("SELECT source_id,count(*)::int AS n FROM stripe_fees WHERE source_id=ANY($1::text[]) GROUP BY source_id", [
            sources.map((s) => s.sourceId),
          ]),
        )
      ).map((r: any) => [r.source_id, r.n]),
    );
    // A source is read once; a dispute closed as won again until both of
    // its balance transactions (the funds withdrawn and reinstated) are in.
    const missing = sources.filter((s) => {
      const n = known.get(s.sourceId) ?? 0;
      return n === 0 || (s.sourceType === "dispute" && s.resolution === "won" && n < 2);
    });
    const now = missing.slice(0, Math.max(0, budget));
    pending += missing.length - now.length;
    budget -= now.length;
    const r = await capture(db, stripe, t.id, now);
    recorded += r.recorded;
    failed += r.failed;
    if (r.recorded) {
      const months = touched.get(t.id) ?? new Set<string>();
      for (const s of now) months.add(s.month);
      touched.set(t.id, months);
    }
  }
  return {
    recorded,
    failed,
    pending,
    touched: [...touched].map(([tenantId, months]) => ({ tenantId, months: [...months].sort() })),
  };
}

/** Best effort after a verified Stripe webhook: that workspace's missing fees. */
export async function captureFeesAfterWebhook(
  db: Database,
  stripe: StripeFeeClient,
  event: any,
) {
  const object = event?.data?.object ?? {};
  const meta =
    object.metadata?.tenant_id
      ? object.metadata
      : (object.parent?.subscription_details?.metadata ??
        object.subscription_details?.metadata);
  let tenantId: string | null = meta?.tenant_id ?? null;
  if (!tenantId) {
    const ids = [object.id, idOf(object.charge), idOf(object.payment_intent), idOf(object.subscription)].filter(Boolean);
    const [owner] = ids.length
      ? await db.system((tx) =>
          tx.query("SELECT tenant_id FROM provider_objects WHERE provider='stripe' AND external_id=ANY($1::text[]) LIMIT 1", [ids]),
        )
      : [];
    tenantId = owner?.tenant_id ?? null;
  }
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) return null;
  // A dispute event reads that dispute again whatever was recorded: its
  // second balance transaction (funds reinstated when won) appears only
  // later, and a domain payment's dispute has no ledger entry unless lost.
  let forced = { recorded: 0, failed: 0 };
  if (String(event?.type ?? "").startsWith("charge.dispute.") && /^dp_/.test(String(object.id ?? "")))
    forced = await capture(db, stripe, tenantId, [
      {
        sourceType: "dispute",
        sourceId: object.id,
        product: await productOfCharge(db, tenantId, idOf(object.charge), idOf(object.payment_intent)),
      },
    ]);
  const swept = await sweepStripeFees(db, stripe, { tenantId, days: 30, limit: 5 });
  return { ...swept, recorded: swept.recorded + forced.recorded, failed: swept.failed + forced.failed };
}

/**
 * A trainer's own Stripe fees for a month (they pay them), per currency:
 * the fees Stripe recorded on the month's member payments, refunds and
 * disputes (domain payments are the platform's), and for how many of them
 * the fee has been read from Stripe yet.
 */
export async function tenantStripeFees(db: Database, a: Actor, period: string) {
  const range = dubaiMonthRange(period);
  const sources = (
    await db.tenant(a, (tx) =>
      ledgerStripeSources(tx, { from: range.from.toISOString(), to: range.to.toISOString() }),
    )
  ).filter((s) => s.product !== "domain");
  const ids = sources.flatMap((s) => (s.sourceId ? [s.sourceId] : []));
  const rows = ids.length
    ? await db.system((tx) =>
        tx.query(
          "SELECT source_id,currency,count(*)::int AS n,coalesce(sum(fee_minor),0)::text AS fee FROM stripe_fees WHERE tenant_id=$1 AND source_id=ANY($2::text[]) GROUP BY source_id,currency",
          [a.tenantId, ids],
        ),
      )
    : [];
  const byCurrency = new Map<string, { currency: string; count: number; feeMinor: number }>();
  for (const r of rows) {
    const c = byCurrency.get(r.currency) ?? { currency: r.currency, count: 0, feeMinor: 0 };
    c.count += r.n;
    c.feeMinor += Number(r.fee);
    byCurrency.set(r.currency, c);
  }
  const read = new Set(rows.map((r: any) => r.source_id));
  return {
    fees: [...byCurrency.values()].sort((x, y) => x.currency.localeCompare(y.currency)),
    /** Payments, refunds and disputes of the month, and how many were read. */
    sources: sources.length,
    read: sources.filter((s) => s.sourceId && read.has(s.sourceId)).length,
  };
}
