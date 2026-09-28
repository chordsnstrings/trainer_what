import { elevated, type Database } from "@trainer/db";
import { platformWorkspaceSql } from "./workspace-state.ts";

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
};
const idOf = (value: any): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);
const month = (unixSeconds: number) =>
  new Date(unixSeconds * 1000 + 4 * 3600000).toISOString().slice(0, 7);

/** Payments, refunds and disputes in a workspace's ledger (last `days`). */
async function workspaceSources(db: Database, tenantId: string, days: number) {
  const rows = await db.tenant(
    elevated("worker", { tenantId, role: "finance" }),
    (tx) =>
      tx.query(
        `SELECT j.source_key,j.data->>'chargeId' AS charge_id,j.data->>'paymentIntentId' AS payment_intent,CASE
          WHEN j.source_key LIKE 'stripe-invoice:%' AND j.data->>'purpose'='voice_addon' THEN 'voice_addon'
          WHEN j.source_key LIKE 'stripe-invoice:%' THEN 'membership'
          WHEN j.source_key LIKE 'stripe-programme:%' THEN 'programme'
          WHEN j.source_key LIKE 'booking-%' THEN 'booking'
          WHEN j.source_key LIKE 'web-address-%' THEN 'domain'
          ELSE coalesce((SELECT CASE WHEN o.source_key LIKE 'stripe-programme:%' THEN 'programme' WHEN o.data->>'purpose'='voice_addon' THEN 'voice_addon' ELSE 'membership' END FROM journals o WHERE (o.source_key LIKE 'stripe-invoice:%' OR o.source_key LIKE 'stripe-programme:%') AND (o.id::text=j.data->>'originalJournalId' OR (j.data ? 'chargeId' AND o.data->>'chargeId'=j.data->>'chargeId')) ORDER BY o.created_at LIMIT 1),'other') END AS product
         FROM journals j WHERE j.created_at>now()-make_interval(days=>$1) AND (
          j.source_key LIKE 'stripe-invoice:%' OR j.source_key LIKE 'stripe-programme:%' OR j.source_key LIKE 'booking-charge:%'
          OR j.source_key LIKE 'web-address-invoice:%' OR j.source_key LIKE 'stripe-refund:%' OR j.source_key LIKE 'booking-refund:%'
          OR j.source_key LIKE 'web-address-refund:%' OR j.source_key LIKE 'dispute-reserve:%' OR j.source_key LIKE 'web-address-dispute:%')
         ORDER BY j.created_at DESC LIMIT 2000`,
        [days],
      ),
  );
  const sources: Source[] = [];
  for (const r of rows) {
    const key = String(r.source_key);
    const suffix = key.slice(key.indexOf(":") + 1);
    if (/^(stripe-refund|booking-refund|web-address-refund):/.test(key)) {
      if (/^re_/.test(suffix))
        sources.push({ sourceType: "refund", sourceId: suffix, product: r.product });
    } else if (/^(dispute-reserve|web-address-dispute):/.test(key)) {
      if (/^dp_/.test(suffix))
        sources.push({ sourceType: "dispute", sourceId: suffix, product: r.product });
    } else if (r.charge_id || r.payment_intent) {
      sources.push({
        sourceType: "charge",
        sourceId: r.charge_id ?? r.payment_intent,
        product: r.product,
      });
    }
  }
  return [...new Map(sources.map((s) => [s.sourceId, s])).values()];
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
  for (const t of tenants) {
    const sources = await workspaceSources(db, t.id, days);
    if (!sources.length) continue;
    const known = new Set(
      (
        await db.system((tx) =>
          tx.query("SELECT DISTINCT source_id FROM stripe_fees WHERE source_id=ANY($1::text[])", [
            sources.map((s) => s.sourceId),
          ]),
        )
      ).map((r: any) => r.source_id),
    );
    const missing = sources.filter((s) => !known.has(s.sourceId));
    const now = missing.slice(0, Math.max(0, budget));
    pending += missing.length - now.length;
    budget -= now.length;
    const r = await capture(db, stripe, t.id, now);
    recorded += r.recorded;
    failed += r.failed;
  }
  return { recorded, failed, pending };
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
  return sweepStripeFees(db, stripe, { tenantId, days: 30, limit: 5 });
}

/** A trainer's own Stripe fees for a month (they pay them), per currency. */
export async function tenantStripeFees(db: Database, tenantId: string, period: string) {
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT currency,count(*)::int AS n,coalesce(sum(fee_minor),0)::text AS fee FROM stripe_fees WHERE tenant_id=$1 AND month=$2 AND product<>'domain' GROUP BY currency ORDER BY currency",
      [tenantId, period],
    ),
  );
  return rows.map((r) => ({ currency: r.currency as string, count: r.n as number, feeMinor: Number(r.fee) }));
}
