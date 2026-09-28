/**
 * Autonomous trainer domains (docs/features/web-addresses.md): Stripe events,
 * the worker state machine (purchase, reconciliation, DNS hosts, DNS and TLS
 * checks, activation, renewal, grace notices, lapse, refund) and the ledger.
 *
 * Rules kept here: Stripe collects; every registrar purchase, renewal and DNS
 * write is recorded under a stable intent before it is sent; an outcome that
 * is not a confirmed success is reconciled with the registrar (getList /
 * getInfo) before another attempt (the database refuses a second attempt
 * while one is open), and an attempt that may still be in flight is left to
 * settle first; journals are immutable and use their own accounts, never the
 * trainer's payable balance or commission. Only the run holding an order's
 * lease (identified by its token) works on it or releases it.
 */
import { randomUUID } from "node:crypto";
import { resolve4 as systemResolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import { elevated, event, type Database, type Tx } from "@trainer/db";
import { stripeClient } from "@trainer/providers";
import {
  isPublicAddress,
  runtimeConfig,
} from "../../../packages/providers/src/configuration.ts";
import { sandboxResolver } from "../../../packages/providers/src/sandbox.ts";
import { integrationRequest } from "../../../packages/providers/src/integrations.ts";
import {
  RegistrarError,
  paymentModeProblem,
  registrantFromConfig,
  registrarFromConfig,
  type HostRecord,
  type Registrar,
} from "../../../packages/providers/src/registrar.ts";
import {
  subdomainEligible,
  subdomainHost,
  usdToAedMinor,
} from "../../../packages/domain/src/web-address.ts";
import { journal } from "./finance.ts";
import { notifyUser } from "./notifications.ts";
import { permitCertificateIssuance } from "./host-operations.ts";
import { platformRoot } from "./host-routing.ts";

/** The Stripe calls this module makes (the SDK client satisfies it). */
export type WebAddressStripe = {
  checkout: {
    sessions: {
      create: (params: any, options?: any) => Promise<any>;
      retrieve: (id: string, params?: any) => Promise<any>;
      expire: (id: string, params?: any, options?: any) => Promise<any>;
    };
  };
  subscriptions: {
    retrieve: (id: string, params?: any) => Promise<any>;
    update: (id: string, params: any, options?: any) => Promise<any>;
    cancel: (id: string, params?: any, options?: any) => Promise<any>;
  };
  refunds: {
    create: (params: any, options?: any) => Promise<any>;
    list: (params: any) => Promise<any>;
  };
  invoices?: { retrieve: (id: string, params?: any) => Promise<any> };
  paymentIntents?: { retrieve: (id: string) => Promise<any> };
  invoicePayments?: { list: (params: any) => Promise<any> };
};
export type WebAddressDeps = {
  registrar?: Registrar;
  stripe?: WebAddressStripe;
  resolve4?: (hostname: string) => Promise<string[]>;
  /** HTTPS request to the domain, which also makes the edge issue its certificate. */
  httpsCheck?: (hostname: string) => Promise<void>;
  targetIpv4?: () => Promise<string>;
  /**
   * How long a registrar request without a final answer is left alone before
   * it is reconciled (default SETTLE_MS). Tests of lost answers set 0.
   */
  settleMs?: number;
};

export const WEB_ADDRESS_ACCOUNTS = {
  receivable: "web_address_receivable",
  revenue: "web_address_revenue",
  /** Money received for no open order: owed back to the trainer. */
  refundLiability: "web_address_refund_liability",
  disputeLoss: "web_address_dispute_loss",
  registrarCost: "registrar_cost",
  registrarPrepaid: "registrar_prepaid",
} as const;
/** Renewal invoices are moved to this many days before the domain expires. */
export const RENEWAL_LEAD_DAYS = 30;
/** Grace notices before expiry when a renewal is not paid. */
export const GRACE_NOTICE_DAYS = [14, 7, 3, 1] as const;
/**
 * After expiry the subscription is kept this long while Stripe still retries
 * an open renewal invoice (inside the registrar's grace period for the
 * offered endings), so a late payment renews the domain.
 */
export const LAPSE_HOLD_DAYS = 20;
/**
 * A registrar request is answered or abandoned within 45 seconds; one without
 * a final answer is reconciled only after this long, so a request that may
 * still be running is never mistaken for one that did nothing.
 */
export const SETTLE_MS = 3 * 60000;
const DAY = 86400000;
const MAX_PURCHASE_ATTEMPTS = 3;
const MAX_RENEWAL_ATTEMPTS = 5;
const CHECKOUT_ATTENTION_VISITS = 6;
const ALIGN_ATTENTION_FAILURES = 3;
const ALIGN_ATTENTION =
  "The yearly charge could not be moved to 30 days before expiry; check the Stripe subscription.";
const LEASE_MINUTES = 10;

const workerActor = (tenantId: string) =>
  elevated("worker", { tenantId, role: "owner" });
const callbackActor = (tenantId: string) =>
  elevated("provider-callback", { tenantId, role: "owner" });
const idOf = (value: any): string | undefined =>
  typeof value === "string" ? value : (value?.id ?? undefined);
const iso = (value: unknown) =>
  value ? new Date(value as string).toISOString() : null;
function stripeOf(deps: WebAddressDeps): WebAddressStripe {
  return deps.stripe ?? (stripeClient() as unknown as WebAddressStripe);
}
function registrarOf(deps: WebAddressDeps) {
  return deps.registrar ?? registrarFromConfig();
}
export function purchasesEnabled() {
  return runtimeConfig().WEB_ADDRESS_PURCHASES_ENABLED === "true";
}
const backoffSeconds = (attempt: number) =>
  Math.min(1800, 60 * 2 ** Math.min(Math.max(attempt, 0), 5));
const settleMs = (deps: WebAddressDeps) => deps.settleMs ?? SETTLE_MS;
/** An attempt without a final answer that may still be running at the registrar. */
function settling(op: Order, deps: WebAddressDeps) {
  return (
    ["sent", "unknown"].includes(op.status) &&
    Date.now() - Date.parse(op.created_at) < settleMs(deps)
  );
}
/** True when the registrar's expiry is more than a day past the base one. */
function movedPast(expiresAt: string | undefined, base: unknown) {
  const before = Date.parse(String(base ?? ""));
  return (
    !!expiresAt &&
    Number.isFinite(before) &&
    Date.parse(expiresAt) > before + DAY
  );
}
const livemodeOf = (e: any, object: any): boolean | null =>
  typeof e?.livemode === "boolean"
    ? e.livemode
    : typeof object?.livemode === "boolean"
      ? object.livemode
      : null;

type Order = Record<string, any>;
async function progress(tx: Tx, orderId: string, step: string, note?: string) {
  await tx.query(
    "UPDATE domain_orders SET progress=CASE WHEN jsonb_array_length(progress)>=60 THEN progress ELSE progress||jsonb_build_array(jsonb_build_object('step',$2::text,'at',now(),'note',$3::text)) END,updated_at=now() WHERE id=$1",
    [orderId, step, note ?? null],
  );
}
async function setOrder(
  tx: Tx,
  orderId: string,
  fields: Record<string, unknown>,
) {
  const keys = Object.keys(fields);
  const sets = keys.map((key, i) => `${key}=$${i + 2}`);
  const [row] = await tx.query(
    `UPDATE domain_orders SET ${sets.join(",")},version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
    [
      orderId,
      ...keys.map((key) => {
        const value = fields[key];
        return value !== null &&
          typeof value === "object" &&
          !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
      }),
    ],
  );
  return row as Order;
}
// The lease columns are not here: only claim() and the end of the claiming
// run change them.
const ORDER_COLUMNS = new Set([
  "status",
  "attention",
  "attempts",
  "next_attempt_at",
  "expires_at",
  "renewal_status",
  "renewal_invoice_id",
  "renewal_enabled",
  "billing_status",
  "billing_aligned_at",
  "stripe_subscription_id",
  "stripe_customer_id",
  "checkout_session_id",
  "first_invoice_id",
  "live_at",
  "notices",
]);
function assertColumns(fields: Record<string, unknown>) {
  for (const key of Object.keys(fields))
    if (!ORDER_COLUMNS.has(key)) throw new Error("Unknown order column");
}
async function update(
  tx: Tx,
  orderId: string,
  fields: Record<string, unknown>,
) {
  assertColumns(fields);
  return setOrder(tx, orderId, fields);
}
async function mergeEvidence(tx: Tx, orderId: string, evidence: object) {
  await tx.query(
    "UPDATE domain_orders SET evidence=evidence||$2::jsonb,updated_at=now() WHERE id=$1",
    [orderId, JSON.stringify(evidence)],
  );
}
async function readOrder(db: Database, tenantId: string, orderId: string) {
  const [row] = await db.tenant(workerActor(tenantId), (tx) =>
    tx.query("SELECT * FROM domain_orders WHERE id=$1", [orderId]),
  );
  return row as Order | undefined;
}
function ownerOf(order: Order): string | null {
  return typeof order.evidence?.orderedBy === "string"
    ? order.evidence.orderedBy
    : null;
}
/**
 * The workspace's platform subdomain as it is now (never the slug captured
 * when the order was placed: after a rename, that name may belong to another
 * workspace), or null when subdomains are off or the workspace is not served.
 */
export async function fallbackAddress(db: Database, tenantId: string) {
  const root = platformRoot();
  if (!root) return null;
  const [tenant] = await db.system((tx) =>
    tx.query<{ slug: string }>(
      "SELECT slug FROM tenants WHERE id=$1 AND published=true AND lifecycle_state IN ('active','suspended')",
      [tenantId],
    ),
  );
  return tenant && subdomainEligible(tenant.slug)
    ? "https://" + subdomainHost(tenant.slug, root)
    : null;
}
async function notifyOwner(
  tx: Tx,
  tenantId: string,
  order: Order,
  input: {
    templateKey: string;
    dedupe: string;
    title: string;
    body: string;
  },
) {
  // The order may outlive the ordering owner (ownership transfer): address
  // the workspace's current owner, preferring the one who ordered.
  const [current] = await tx.query<{ user_id: string }>(
    "SELECT user_id FROM memberships WHERE role='owner' ORDER BY (user_id=$1) DESC,user_id LIMIT 1",
    [ownerOf(order) ?? "00000000-0000-0000-0000-000000000000"],
  );
  if (!current) return;
  await notifyUser(tx, workerActor(tenantId), {
    userId: current.user_id,
    category: "account",
    dedupeKey: "web-address:" + order.id + ":" + input.dedupe,
    title: input.title,
    body: input.body,
    href: "/trainer/domains",
    templateKey: input.templateKey,
    source: { kind: "web_address", orderId: order.id },
  });
}

// ---- Ledger -------------------------------------------------------------------

/** Journals a payment once; null when this invoice was already journaled. */
async function postPayment(
  tx: Tx,
  tenantId: string,
  order: Order,
  invoice: {
    id: string;
    amountMinor: number;
    paymentIntentId?: string;
    chargeId?: string;
  },
  kind: "registration" | "renewal" | "unmatched",
) {
  return journal(
    tx,
    callbackActor(tenantId),
    "web-address-invoice:" + invoice.id,
    "Trainer web address payment (" + order.hostname + ")",
    [
      { account: WEB_ADDRESS_ACCOUNTS.receivable, amount: invoice.amountMinor },
      {
        // Money for no open order is owed back, not earned.
        account:
          kind === "unmatched"
            ? WEB_ADDRESS_ACCOUNTS.refundLiability
            : WEB_ADDRESS_ACCOUNTS.revenue,
        amount: -invoice.amountMinor,
      },
    ],
    {
      orderId: order.id,
      hostname: order.hostname,
      kind,
      grossMinor: invoice.amountMinor,
      invoiceId: invoice.id,
      paymentIntentId: invoice.paymentIntentId ?? null,
      chargeId: invoice.chargeId ?? null,
    },
  );
}
/** The kind of the journaled payment a refund or dispute belongs to. */
async function paymentKind(
  tx: Tx,
  paymentIntentId?: string,
  chargeId?: string,
) {
  const [row] = await tx.query(
    "SELECT data->>'kind' AS kind FROM journals WHERE source_key LIKE 'web-address-invoice:%' AND ((data->>'paymentIntentId')=$1 OR (data->>'chargeId')=$2) ORDER BY created_at LIMIT 1",
    [paymentIntentId ?? "", chargeId ?? ""],
  );
  return (row?.kind as string | undefined) ?? null;
}
async function postRefund(
  tx: Tx,
  tenantId: string,
  order: Order,
  refund: {
    id: string;
    amountMinor: number;
    paymentIntentId?: string;
    chargeId?: string;
  },
) {
  const unmatched =
    (await paymentKind(tx, refund.paymentIntentId, refund.chargeId)) ===
    "unmatched";
  return journal(
    tx,
    callbackActor(tenantId),
    "web-address-refund:" + refund.id,
    "Trainer web address refund (" + order.hostname + ")",
    [
      {
        account: unmatched
          ? WEB_ADDRESS_ACCOUNTS.refundLiability
          : WEB_ADDRESS_ACCOUNTS.revenue,
        amount: refund.amountMinor,
      },
      { account: WEB_ADDRESS_ACCOUNTS.receivable, amount: -refund.amountMinor },
    ],
    {
      orderId: order.id,
      hostname: order.hostname,
      refundId: refund.id,
      refundAmountMinor: refund.amountMinor,
      paymentIntentId: refund.paymentIntentId ?? null,
      ofUnmatchedPayment: unmatched,
    },
  );
}
async function postRegistrarCost(
  tx: Tx,
  tenantId: string,
  order: Order,
  operation: { id: string; kind: string },
  usd: string,
  estimated: boolean,
) {
  const rate = String(
    order.quote?.usdToAed ?? runtimeConfig().WEB_ADDRESS_USD_TO_AED ?? "3.6725",
  );
  const amount = usdToAedMinor(usd, rate);
  if (amount <= 0) return null;
  return journal(
    tx,
    workerActor(tenantId),
    "web-address-registrar:" + operation.id,
    "Registrar " + operation.kind + " cost (" + order.hostname + ")",
    [
      { account: WEB_ADDRESS_ACCOUNTS.registrarCost, amount },
      { account: WEB_ADDRESS_ACCOUNTS.registrarPrepaid, amount: -amount },
    ],
    {
      orderId: order.id,
      hostname: order.hostname,
      kind: operation.kind,
      operationId: operation.id,
      usd,
      usdToAed: rate,
      estimated,
    },
  );
}

// ---- Stripe events ------------------------------------------------------------

async function registerStripeObjects(
  db: Database,
  tenantId: string,
  objects: Array<[string | undefined, string]>,
) {
  await db.system(async (tx) => {
    for (const [externalId, kind] of objects) {
      if (!externalId) continue;
      const [old] = await tx.query(
        "SELECT tenant_id FROM provider_objects WHERE provider='stripe' AND external_id=$1",
        [externalId],
      );
      if (old && old.tenant_id !== tenantId)
        throw new Error("Conflicting provider object ownership");
      await tx.query(
        "INSERT INTO provider_objects(provider,external_id,tenant_id,user_id,kind) VALUES('stripe',$1,$2,NULL,$3) ON CONFLICT DO NOTHING",
        [externalId, tenantId, kind],
      );
    }
  });
}
async function invoicePaymentIds(invoice: any, stripe?: WebAddressStripe) {
  let paymentIntentId = idOf(invoice.payment_intent),
    chargeId = idOf(invoice.charge);
  const paid = (invoice.payments?.data ?? []).filter(
    (p: any) => p?.status === "paid",
  );
  if (!paymentIntentId && paid.length === 1)
    paymentIntentId = idOf(paid[0].payment?.payment_intent);
  if (!paymentIntentId && !paid.length && stripe?.invoicePayments) {
    try {
      const page = await stripe.invoicePayments.list({
        invoice: invoice.id,
        status: "paid",
        limit: 10,
      });
      if (page?.data?.length === 1)
        paymentIntentId = idOf(page.data[0].payment?.payment_intent);
    } catch {
      /* The payment identity is recorded later by reconciliation. */
    }
  }
  if (!chargeId && paymentIntentId && stripe?.paymentIntents) {
    try {
      chargeId = idOf(
        (await stripe.paymentIntents.retrieve(paymentIntentId)).latest_charge,
      );
    } catch {
      /* The charge is optional; refunds use the payment intent. */
    }
  }
  return { paymentIntentId, chargeId };
}
function webAddressMetadata(object: any) {
  const candidates = [
    object?.metadata,
    object?.parent?.subscription_details?.metadata,
    object?.subscription_details?.metadata,
  ];
  return candidates.find((m) => m?.purpose === "web_address");
}
async function orderByReference(
  db: Database,
  object: any,
): Promise<{
  tenantId: string;
  orderId?: string;
  subscriptionId?: string;
} | null> {
  const meta = webAddressMetadata(object);
  const subscriptionId =
    typeof object.subscription === "string"
      ? object.subscription
      : (object.parent?.subscription_details?.subscription ??
        (object.object === "subscription" ? object.id : undefined));
  if (meta) {
    if (
      typeof meta.tenant_id !== "string" ||
      typeof meta.web_address_order_id !== "string"
    )
      throw new Error("Web address payment has incomplete identity");
    return {
      tenantId: meta.tenant_id,
      orderId: meta.web_address_order_id,
      subscriptionId,
    };
  }
  const refs = [
    object.id,
    subscriptionId,
    idOf(object.charge),
    idOf(object.payment_intent),
  ].filter(Boolean);
  if (!refs.length) return null;
  const [row] = await db.system((tx) =>
    tx.query(
      "SELECT tenant_id FROM provider_objects WHERE provider='stripe' AND external_id=ANY($1::text[]) AND kind LIKE 'web_address%' LIMIT 1",
      [refs],
    ),
  );
  return row ? { tenantId: row.tenant_id, subscriptionId } : null;
}
/**
 * Handles every Stripe event about a trainer's web address subscription and
 * returns true; returns false for any other event. Runs before the member
 * subscription path, which must never see these payments.
 */
export async function processWebAddressStripeEvent(
  db: Database,
  e: any,
  deps: WebAddressDeps = {},
): Promise<boolean> {
  const object = e?.data?.object;
  if (!object || typeof e.type !== "string") return false;
  const reference = await orderByReference(db, object);
  if (!reference) return false;
  const { tenantId } = reference;
  const a = callbackActor(tenantId);
  const livemode = livemodeOf(e, object);
  const findOrder = async (tx: Tx) => {
    if (reference.orderId) {
      const [row] = await tx.query(
        "SELECT * FROM domain_orders WHERE id=$1 AND mode='automatic' FOR UPDATE",
        [reference.orderId],
      );
      return row as Order | undefined;
    }
    if (reference.subscriptionId) {
      const [row] = await tx.query(
        "SELECT * FROM domain_orders WHERE stripe_subscription_id=$1 AND mode='automatic' FOR UPDATE",
        [reference.subscriptionId],
      );
      if (row) return row as Order;
    }
    const pi = idOf(object.payment_intent),
      charge =
        idOf(object.charge) ??
        (object.object === "charge" ? object.id : undefined);
    const [paid] = await tx.query(
      "SELECT data->>'orderId' AS order_id FROM journals WHERE source_key LIKE 'web-address-invoice:%' AND ((data->>'paymentIntentId') IN ($1,$2) OR (data->>'chargeId') IN ($1,$2)) LIMIT 1",
      [pi ?? "", charge ?? ""],
    );
    if (!paid?.order_id) return undefined;
    const [row] = await tx.query(
      "SELECT * FROM domain_orders WHERE id=$1 FOR UPDATE",
      [paid.order_id],
    );
    return row as Order | undefined;
  };

  if (e.type.startsWith("checkout.session.")) {
    if (object.mode !== "subscription") return true;
    const subscriptionId = idOf(object.subscription),
      customerId = idOf(object.customer);
    await db.tenant(a, async (tx) => {
      const order = await findOrder(tx);
      if (!order || object.client_reference_id !== order.id)
        throw new Error("Web address checkout does not match its order");
      if (order.checkout_session_id && order.checkout_session_id !== object.id)
        throw new Error("Web address checkout does not match its order");
      if (e.type === "checkout.session.expired") {
        if (order.status === "checkout") {
          await update(tx, order.id, {
            status: "cancelled",
            next_attempt_at: null,
            checkout_session_id: order.checkout_session_id ?? object.id,
          });
          await progress(tx, order.id, "cancelled", "Checkout expired");
          await event(tx, a, "web_address.checkout_expired", order.id);
        }
        return;
      }
      await update(tx, order.id, {
        checkout_session_id: order.checkout_session_id ?? object.id,
        ...(subscriptionId && !order.stripe_subscription_id
          ? { stripe_subscription_id: subscriptionId }
          : {}),
        ...(customerId && !order.stripe_customer_id
          ? { stripe_customer_id: customerId }
          : {}),
      });
    });
    await registerStripeObjects(db, tenantId, [
      [object.id, "web_address_checkout"],
      [subscriptionId, "web_address_subscription"],
    ]);
    return true;
  }

  if (e.type === "invoice.paid") {
    const stripe = deps.stripe ?? optionalStripe();
    const ids = await invoicePaymentIds(object, stripe);
    const amount = Number(object.amount_paid ?? 0);
    const subscriptionId = reference.subscriptionId;
    await db.tenant(a, async (tx) => {
      const order = await findOrder(tx);
      if (!order) throw new Error("Web address payment refers to no order");
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "web-address:" + order.id,
      ]);
      if (
        subscriptionId &&
        order.stripe_subscription_id &&
        order.stripe_subscription_id !== subscriptionId
      )
        throw new Error("Web address payment subscription mismatch");
      const invoice = { id: object.id as string, amountMinor: amount, ...ids };
      if (amount <= 0) return;
      if (
        order.first_invoice_id === object.id ||
        order.renewal_invoice_id === object.id
      )
        return; // Already applied.
      const links = {
        ...(subscriptionId && !order.stripe_subscription_id
          ? { stripe_subscription_id: subscriptionId }
          : {}),
        ...(idOf(object.customer) && !order.stripe_customer_id
          ? { stripe_customer_id: idOf(object.customer) }
          : {}),
      };
      if (order.status === "checkout" && !order.first_invoice_id) {
        if (
          String(object.currency).toLowerCase() !== "aed" ||
          amount !== Number(order.quote?.priceMinor)
        ) {
          if (await postPayment(tx, tenantId, order, invoice, "unmatched"))
            await update(tx, order.id, {
              ...links,
              attention:
                "The first payment does not match the quoted price; review and refund in Stripe.",
            });
          return;
        }
        // An invoice journaled before (a replay of an older delivery)
        // changes nothing.
        if (!(await postPayment(tx, tenantId, order, invoice, "registration")))
          return;
        await update(tx, order.id, {
          ...links,
          status: "paid",
          first_invoice_id: object.id,
          billing_status: "active",
          attempts: 0,
          // A checkout-sweep flag ("payment not confirmed") no longer applies.
          attention: null,
          next_attempt_at: new Date(),
        });
        await mergeEvidence(tx, order.id, {
          firstPaymentIntentId: ids.paymentIntentId ?? null,
          firstChargeId: ids.chargeId ?? null,
          firstPaymentLivemode: livemode,
        });
        await progress(tx, order.id, "paid");
        await event(tx, a, "web_address.paid", order.id, {
          amountMinor: amount,
        });
        return;
      }
      if (
        ["owned", "dns", "active", "expired", "purchasing", "paid"].includes(
          order.status,
        )
      ) {
        // A replayed or late older invoice was journaled when it first
        // arrived: it must not reopen a renewal (or move the expiry back).
        if (!(await postPayment(tx, tenantId, order, invoice, "renewal")))
          return;
        if (
          order.renewal_status === "paid" ||
          order.renewal_status === "renewing"
        ) {
          await update(tx, order.id, {
            ...links,
            attention:
              "A second renewal payment arrived while another renewal is pending; review it.",
          });
          return;
        }
        await update(tx, order.id, {
          ...links,
          renewal_status: "paid",
          renewal_invoice_id: object.id,
          billing_status: "active",
          attempts: 0,
          next_attempt_at: new Date(),
        });
        // The expiry this payment extends: a registrar expiry beyond it
        // later proves the renewal happened (also when done by hand).
        await mergeEvidence(tx, order.id, {
          renewalBaseExpiry: iso(order.expires_at),
          renewalLivemode: livemode,
          renewalAttempts: 0,
        });
        await progress(tx, order.id, "renewal_paid");
        await event(tx, a, "web_address.renewal_paid", order.id, {
          amountMinor: amount,
        });
        return;
      }
      // Money for an order that was cancelled or failed: record it as owed
      // back and ask an operator to refund.
      if (await postPayment(tx, tenantId, order, invoice, "unmatched"))
        await update(tx, order.id, {
          ...links,
          attention:
            "A payment arrived for a closed order; refund it in Stripe and reconcile.",
        });
    });
    await registerStripeObjects(db, tenantId, [
      [subscriptionId, "web_address_subscription"],
      [ids.paymentIntentId, "web_address_payment_intent"],
      [ids.chargeId, "web_address_charge"],
      [object.id, "web_address_invoice"],
    ]);
    return true;
  }

  if (e.type === "invoice.payment_failed") {
    const fallback = await fallbackAddress(db, tenantId);
    await db.tenant(a, async (tx) => {
      const order = await findOrder(tx);
      if (!order || order.status === "checkout" || !order.first_invoice_id)
        return;
      await update(tx, order.id, { billing_status: "past_due" });
      await progress(tx, order.id, "renewal_payment_failed");
      const expires = order.expires_at
        ? new Date(order.expires_at).toISOString().slice(0, 10)
        : "its expiry date";
      await notifyOwner(tx, tenantId, order, {
        templateKey: "web-address-renewal-failed",
        dedupe: "payment-failed:" + object.id,
        title: "Your domain renewal payment failed",
        body: `We could not charge the yearly renewal for ${order.hostname}. Update your card in Stripe before ${expires}; Stripe retries the payment automatically. If it is not paid, ${order.hostname} stops working${fallback ? ` and your website stays available at ${fallback}` : ""}.`,
      });
    });
    return true;
  }

  if (e.type.startsWith("customer.subscription.")) {
    await db.tenant(a, async (tx) => {
      const order = await findOrder(tx);
      if (!order) return;
      const created = Number(e.created) || 0;
      const lastEvent = Number(order.evidence?.subscriptionEventAt ?? 0);
      // Stripe does not deliver in order: an older state never overwrites a newer one.
      if (created && created < lastEvent) return;
      const ended =
        e.type === "customer.subscription.deleted" ||
        ["canceled", "incomplete_expired"].includes(object.status);
      const lastSwitch = Number(order.evidence?.renewalSwitchedAt ?? 0);
      const cancelling =
        object.cancel_at_period_end === true || !!object.cancel_at;
      const renewal = ended
        ? { renewal_enabled: false }
        : // The trainer's own switch is newer than this event: keep it.
          (!created || created > lastSwitch) &&
            ["owned", "dns", "active"].includes(order.status) &&
            order.billing_status !== "canceled"
          ? { renewal_enabled: !cancelling }
          : {};
      await update(tx, order.id, {
        billing_status: String(object.status ?? "").slice(0, 40) || null,
        ...renewal,
        ...(!order.stripe_subscription_id && object.id
          ? { stripe_subscription_id: object.id }
          : {}),
      });
      if (created)
        await mergeEvidence(tx, order.id, { subscriptionEventAt: created });
    });
    return true;
  }

  if (
    e.type === "refund.created" ||
    e.type === "refund.updated" ||
    e.type === "charge.refunded"
  ) {
    const refunds =
      e.type === "charge.refunded" ? (object.refunds?.data ?? []) : [object];
    await db.tenant(a, async (tx) => {
      const order = await findOrder(tx);
      if (!order) return;
      for (const refund of refunds)
        if (
          ["succeeded", "pending"].includes(refund?.status) &&
          refund.amount > 0
        )
          await postRefund(tx, tenantId, order, {
            id: refund.id,
            amountMinor: Number(refund.amount),
            paymentIntentId: idOf(refund.payment_intent),
            chargeId:
              idOf(refund.charge) ??
              (object.object === "charge" ? object.id : undefined),
          });
    });
    return true;
  }

  if (e.type.startsWith("charge.dispute.")) {
    await db.tenant(a, async (tx) => {
      const order = await findOrder(tx);
      if (!order) return;
      const amount = Number(object.amount);
      // A lost dispute takes the payment back: the loss is the platform's.
      if (
        e.type === "charge.dispute.closed" &&
        object.status === "lost" &&
        Number.isSafeInteger(amount) &&
        amount > 0
      )
        await journal(
          tx,
          a,
          "web-address-dispute:" + object.id,
          "Trainer web address dispute lost (" + order.hostname + ")",
          [
            { account: WEB_ADDRESS_ACCOUNTS.disputeLoss, amount },
            { account: WEB_ADDRESS_ACCOUNTS.receivable, amount: -amount },
          ],
          {
            orderId: order.id,
            hostname: order.hostname,
            disputeId: object.id,
            chargeId: idOf(object.charge) ?? null,
            amountMinor: amount,
          },
        );
      await update(tx, order.id, {
        attention:
          e.type === "charge.dispute.closed"
            ? `A card dispute closed (${String(object.status ?? "").slice(0, 30)}); review the domain and the subscription.`
            : "The trainer's bank opened a card dispute for this domain payment.",
      });
    });
    return true;
  }
  // Other events about these objects need nothing from the ledger.
  return true;
}
function optionalStripe(): WebAddressStripe | undefined {
  try {
    return stripeClient() as unknown as WebAddressStripe;
  } catch {
    return undefined;
  }
}

/**
 * Applies the subscription's latest paid invoice when its event never
 * arrived (a lost webhook). Uses Stripe's own objects only; the invoice
 * handler ignores an invoice that was already applied. True when the order
 * changed.
 */
async function reconcileLatestInvoice(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  const subscriptionId = order.stripe_subscription_id;
  if (!subscriptionId) return false;
  const stripe = stripeOf(deps);
  let invoice: any;
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    invoice = subscription?.latest_invoice;
    if (typeof invoice === "string")
      invoice = stripe.invoices
        ? await stripe.invoices.retrieve(invoice)
        : null;
  } catch {
    return false;
  }
  if (
    !invoice?.id ||
    invoice.status !== "paid" ||
    invoice.id === order.first_invoice_id ||
    invoice.id === order.renewal_invoice_id
  )
    return false;
  const before = await readOrder(db, tenantId, order.id);
  await processWebAddressStripeEvent(
    db,
    {
      id: "reconcile:" + invoice.id,
      type: "invoice.paid",
      livemode: invoice.livemode,
      created: invoice.created,
      data: { object: invoice },
    },
    deps,
  );
  const after = await readOrder(db, tenantId, order.id);
  return (
    before?.status !== after?.status ||
    before?.renewal_invoice_id !== after?.renewal_invoice_id ||
    before?.first_invoice_id !== after?.first_invoice_id
  );
}

// ---- Worker ---------------------------------------------------------------------

type Claimed = { order: Order; token: string };
/**
 * Leases a due order (or, with `force`, any order not leased by another run).
 * The token identifies this run: only it releases the lease.
 */
async function claim(
  db: Database,
  tenantId: string,
  orderId: string,
  force = false,
): Promise<Claimed | undefined> {
  const token = randomUUID();
  const [order] = await db.tenant(workerActor(tenantId), (tx) =>
    tx.query(
      `UPDATE domain_orders SET lease_until=now()+interval '${LEASE_MINUTES} minutes',lease_token=$2 WHERE id=$1 AND mode='automatic' AND ($3::boolean OR next_attempt_at<=now()) AND (lease_until IS NULL OR lease_until<now()) RETURNING *`,
      [orderId, token, force],
    ),
  );
  return order ? { order: order as Order, token } : undefined;
}
async function releaseLease(
  db: Database,
  tenantId: string,
  orderId: string,
  token: string,
) {
  await db.tenant(workerActor(tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2",
      [orderId, token],
    ),
  );
}
/** Updates the order at the end of a step (the lease is released by the claiming run). */
async function release(
  db: Database,
  tenantId: string,
  orderId: string,
  fields: Record<string, unknown> = {},
) {
  if (!Object.keys(fields).length) return;
  await db.tenant(workerActor(tenantId), (tx) => update(tx, orderId, fields));
}
async function retryLater(
  db: Database,
  tenantId: string,
  order: Order,
  note: string,
  options: { attention?: string | null; attempts?: number; at?: number } = {},
) {
  const attempts = options.attempts ?? Number(order.attempts ?? 0) + 1;
  await db.tenant(workerActor(tenantId), async (tx) => {
    await update(tx, order.id, {
      attempts,
      next_attempt_at: new Date(
        options.at ?? Date.now() + backoffSeconds(attempts) * 1000,
      ),
      ...(options.attention !== undefined
        ? { attention: options.attention }
        : {}),
    });
    await mergeEvidence(tx, order.id, { lastNote: note.slice(0, 300) });
  });
}
/** Looks again once an attempt that may still be running has settled. */
function afterSettling(
  db: Database,
  tenantId: string,
  order: Order,
  op: Order,
  deps: WebAddressDeps,
) {
  return release(db, tenantId, order.id, {
    next_attempt_at: new Date(
      Date.parse(op.created_at) + settleMs(deps) + 5000,
    ),
  });
}
const latestOperation = (tx: Tx, orderId: string, kind: string) =>
  tx
    .query(
      "SELECT * FROM registrar_operations WHERE order_id=$1 AND kind=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
      [orderId, kind],
    )
    .then((rows) => rows[0] as Order | undefined);
async function finishOperation(
  tx: Tx,
  operationId: string,
  status: string,
  outcome: object,
  costUsd?: string | null,
) {
  const [row] = await tx.query(
    "UPDATE registrar_operations SET status=$2,outcome=outcome||$3::jsonb,cost_usd=coalesce($4::numeric,cost_usd),finished_at=CASE WHEN $2 IN ('succeeded','confirmed','absent') THEN now() ELSE finished_at END WHERE id=$1 RETURNING *",
    [operationId, status, JSON.stringify(outcome), costUsd ?? null],
  );
  return row as Order;
}
/**
 * Records an operation found done at the registrar without (another) request
 * from this run: the open attempt is confirmed, or a confirmed record is
 * added (as evidence of a registration or renewal made another way).
 */
async function confirmOperation(
  db: Database,
  tenantId: string,
  order: Order,
  input: {
    kind: "register" | "renew";
    open?: Order;
    intentKey: string;
    request: object;
    outcome: object;
  },
) {
  const wa = workerActor(tenantId);
  if (input.open)
    return db.tenant(wa, (tx) =>
      finishOperation(tx, input.open!.id, "confirmed", input.outcome),
    );
  const id = randomUUID();
  return db.tenant(wa, async (tx) => {
    await tx.query(
      "INSERT INTO registrar_operations(id,tenant_id,order_id,kind,intent_key,registrar,hostname,request,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        id,
        tenantId,
        order.id,
        input.kind,
        input.intentKey,
        order.registrar,
        order.hostname,
        JSON.stringify({ ...input.request, sent: false }),
        wa.userId,
      ],
    );
    return finishOperation(tx, id, "confirmed", input.outcome);
  });
}
const failureOutcome = (error: unknown) =>
  error instanceof RegistrarError
    ? {
        status: error.outcome === "definitive" ? "failed" : "unknown",
        outcome: {
          error: error.message.slice(0, 300),
          code: error.code ?? null,
        },
      }
    : { status: "unknown", outcome: { error: "Unexpected failure" } };
/** Stops (without buying or renewing) when the payment and registrar environments differ. */
async function modeStop(
  db: Database,
  tenantId: string,
  order: Order,
  livemode: unknown,
  registrar: Registrar,
  what: string,
) {
  const problem =
    paymentModeProblem(livemode as boolean | null, registrar.sandbox) ??
    (registrar.sandbox !== (order.quote?.registrarSandbox === true)
      ? "The registrar environment changed after this order was quoted."
      : null);
  if (!problem) return false;
  await release(db, tenantId, order.id, {
    next_attempt_at: null,
    attention: `${problem} Nothing was ${what}; fix the settings and retry, or refund.`,
  });
  return true;
}

async function purchase(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
): Promise<unknown> {
  if (!purchasesEnabled())
    return retryLater(db, tenantId, order, "Purchases are switched off", {
      attention:
        "Automatic purchases are switched off in Super admin settings; the trainer has paid.",
      attempts: Number(order.attempts ?? 0),
    });
  const registrar = registrarOf(deps);
  if (
    await modeStop(
      db,
      tenantId,
      order,
      order.evidence?.firstPaymentLivemode,
      registrar,
      "bought",
    )
  )
    return;
  const registrant = registrantFromConfig(runtimeConfig());
  const wa = workerActor(tenantId);
  // The retry budget (reset by an operator's retry) and the intent number
  // (never reused, so an intent key identifies exactly one request) differ.
  const attempt = Number(order.evidence?.purchaseAttempts ?? 0) + 1;
  const [sent] = await db.tenant(wa, (tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM registrar_operations WHERE order_id=$1 AND kind='register'",
      [order.id],
    ),
  );
  const operationId = randomUUID();
  // The intent is recorded (and the order marked purchasing) before sending.
  // The trigger refuses it while an earlier attempt awaits reconciliation.
  try {
    await db.tenant(wa, async (tx) => {
      await tx.query(
        "INSERT INTO registrar_operations(id,tenant_id,order_id,kind,intent_key,registrar,hostname,request,created_by) VALUES($1,$2,$3,'register',$4,$5,$6,$7,$8)",
        [
          operationId,
          tenantId,
          order.id,
          `register:${order.id}:${Number(sent.n) + 1}`,
          registrar.id,
          order.hostname,
          JSON.stringify({
            years: 1,
            whoisPrivacy: true,
            registrant: registrant.organization ?? "configured contact",
            sandbox: registrar.sandbox,
          }),
          wa.userId,
        ],
      );
      if (order.status === "paid")
        await update(tx, order.id, { status: "purchasing" });
      await mergeEvidence(tx, order.id, { purchaseAttempts: attempt });
      await progress(tx, order.id, "purchasing");
    });
  } catch (error) {
    if ((error as any)?.code === "23P01")
      return reconcilePurchase(
        db,
        tenantId,
        { ...order, status: "purchasing" },
        deps,
      );
    throw error;
  }
  let result;
  try {
    result = await registrar.register({
      domain: order.hostname,
      years: 1,
      registrant,
    });
  } catch (error) {
    const failed = failureOutcome(error);
    await db.tenant(wa, (tx) =>
      finishOperation(tx, operationId, failed.status, failed.outcome),
    );
    // Reconcile with the registrar before anything else happens.
    return release(db, tenantId, order.id, {
      next_attempt_at: new Date(
        Date.now() + (failed.status === "unknown" ? settleMs(deps) : 30000),
      ),
    });
  }
  if (!result.registered) {
    await db.tenant(wa, (tx) =>
      finishOperation(tx, operationId, "failed", {
        error: "The registrar did not register the name",
      }),
    );
    return release(db, tenantId, order.id, {
      next_attempt_at: new Date(Date.now() + 30000),
    });
  }
  const operation = await db.tenant(wa, (tx) =>
    finishOperation(
      tx,
      operationId,
      "succeeded",
      {
        domainId: result.domainId ?? null,
        orderId: result.orderId ?? null,
        transactionId: result.transactionId ?? null,
      },
      result.chargedUsd ?? null,
    ),
  );
  return completeRegistration(db, tenantId, order, operation, deps, {
    usd: result.chargedUsd ?? order.quote?.registerUsd,
    estimated: !result.chargedUsd,
  });
}
async function completeRegistration(
  db: Database,
  tenantId: string,
  order: Order,
  operation: Order,
  deps: WebAddressDeps,
  cost: { usd?: string; estimated: boolean },
  known?: { expiresAt?: string },
) {
  const registrar = registrarOf(deps);
  let expiresAt = known?.expiresAt;
  if (!expiresAt)
    try {
      expiresAt = (await registrar.info(order.hostname)).expiresAt;
    } catch {
      /* A one-year registration: the expiry is confirmed at renewal time. */
    }
  const wa = workerActor(tenantId);
  await db.tenant(wa, async (tx) => {
    const [current] = await tx.query(
      "SELECT status FROM domain_orders WHERE id=$1 FOR UPDATE",
      [order.id],
    );
    if (current?.status !== "purchasing") return;
    await update(tx, order.id, {
      status: "owned",
      expires_at: expiresAt ?? new Date(Date.now() + 365 * DAY).toISOString(),
      attention: null,
      attempts: 0,
      next_attempt_at: new Date(),
    });
    await mergeEvidence(tx, order.id, {
      registeredAt: new Date().toISOString(),
      registrarOperationId: operation.id,
      registrarReference: operation.outcome?.domainId ?? null,
      unavailableSeen: 0,
    });
    await progress(tx, order.id, "registered");
    if (cost.usd)
      await postRegistrarCost(
        tx,
        tenantId,
        order,
        { id: operation.id, kind: "registration" },
        String(cost.usd),
        cost.estimated,
      );
    await event(tx, wa, "web_address.registered", order.id, {
      registrar: registrar.id,
    });
  });
}
/** Whether the name is in the platform's registrar account (getList, then getInfo); undefined when the registrar cannot be asked. */
async function inOurAccount(registrar: Registrar, hostname: string) {
  const listed = await registrar.list(hostname);
  if (listed.length)
    return { via: "getList", expiresAt: listed[0].expiresAt ?? null };
  try {
    // getInfo answers only for a domain in this account; the list may lag.
    const info = await registrar.info(hostname);
    return { via: "getInfo", expiresAt: info.expiresAt ?? null };
  } catch (error) {
    if (error instanceof RegistrarError && error.outcome === "definitive")
      return null;
    throw error;
  }
}
async function reconcilePurchase(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
): Promise<unknown> {
  const wa = workerActor(tenantId);
  const operation = await db.tenant(wa, (tx) =>
    latestOperation(tx, order.id, "register"),
  );
  if (!operation || operation.status === "absent")
    return purchase(db, tenantId, order, deps);
  if (["succeeded", "confirmed"].includes(operation.status))
    return completeRegistration(db, tenantId, order, operation, deps, {
      usd: operation.cost_usd ?? order.quote?.registerUsd,
      estimated: operation.cost_usd == null,
    });
  // A request that may still be running is left to finish first.
  if (settling(operation, deps))
    return afterSettling(db, tenantId, order, operation, deps);
  // sent, failed or unknown: ask the registrar whether the name is ours.
  const registrar = registrarOf(deps);
  let ours;
  try {
    ours = await inOurAccount(registrar, order.hostname);
  } catch {
    return retryLater(db, tenantId, order, "Reconciliation pending", {
      attention:
        Number(order.attempts ?? 0) >= 6
          ? "The registrar could not be asked whether the purchase completed; reconcile manually."
          : undefined,
    });
  }
  if (ours) {
    const confirmed = await db.tenant(wa, (tx) =>
      finishOperation(tx, operation.id, "confirmed", {
        reconciledAt: new Date().toISOString(),
        via: ours.via,
        expiresAt: ours.expiresAt,
      }),
    );
    return completeRegistration(db, tenantId, order, confirmed, deps, {
      usd: order.quote?.registerUsd,
      estimated: true,
    });
  }
  let availability;
  try {
    [availability] = await registrar.check([order.hostname]);
  } catch {
    return retryLater(db, tenantId, order, "Availability check pending");
  }
  if (
    !availability?.available ||
    availability.premium ||
    availability.earlyAccessFeeUsd
  ) {
    // Not ours and not available: someone else took it, or the registrar
    // has not shown our registration yet. Look once more before refunding.
    const seen = Number(order.evidence?.unavailableSeen ?? 0) + 1;
    if (seen < 2) {
      await db.tenant(wa, (tx) =>
        mergeEvidence(tx, order.id, { unavailableSeen: seen }),
      );
      return release(db, tenantId, order.id, {
        next_attempt_at: new Date(Date.now() + 5 * 60000),
      });
    }
    await db.tenant(wa, (tx) =>
      finishOperation(tx, operation.id, "absent", {
        reconciledAt: new Date().toISOString(),
        via: "getList+getInfo",
      }),
    );
    return failOrder(
      db,
      tenantId,
      order,
      "The name was registered by someone else before the purchase completed.",
      deps,
    );
  }
  await db.tenant(wa, async (tx) => {
    await finishOperation(tx, operation.id, "absent", {
      reconciledAt: new Date().toISOString(),
      via: "getList+getInfo",
    });
    await mergeEvidence(tx, order.id, { unavailableSeen: 0 });
  });
  const attempts = Number(order.evidence?.purchaseAttempts ?? 1);
  if (attempts >= MAX_PURCHASE_ATTEMPTS)
    return release(db, tenantId, order.id, {
      next_attempt_at: null,
      attention: `The purchase did not complete after ${attempts} attempts (${String(operation.outcome?.error ?? "no answer").slice(0, 200)}). Check the registrar balance and settings, then retry or refund.`,
    });
  return release(db, tenantId, order.id, {
    next_attempt_at: new Date(Date.now() + backoffSeconds(attempts) * 1000),
  });
}

async function targetAddress(deps: WebAddressDeps) {
  if (deps.targetIpv4) return deps.targetIpv4();
  const configured = runtimeConfig().WEB_ADDRESS_TARGET_IPV4?.trim();
  if (configured && isIP(configured) === 4) return configured;
  const host = new URL(runtimeConfig().PUBLIC_APP_URL ?? "http://localhost")
    .hostname;
  const addresses = (await lookupA(deps)(host))
    .filter((address) => isIP(address) === 4 && isPublicAddress(address))
    .sort();
  if (!addresses.length)
    throw new Error("The platform address has no public IPv4 address");
  return addresses[0];
}
const lookupA = (deps: WebAddressDeps) =>
  deps.resolve4 ??
  ((host: string) =>
    (sandboxResolver() ?? { resolve4: systemResolve4 }).resolve4(host));
/** The complete host set for a domain: the registrar replaces all records with it. */
export function platformHosts(ipv4: string): HostRecord[] {
  return [
    { name: "@", type: "A", address: ipv4, ttl: 1800 },
    { name: "www", type: "A", address: ipv4, ttl: 1800 },
  ];
}
const hostKey = (host: HostRecord) =>
  [
    host.name.toLowerCase(),
    host.type.toUpperCase(),
    host.address.toLowerCase().replace(/\.$/, ""),
  ].join(" ");
export function sameHostSet(a: HostRecord[], b: HostRecord[]) {
  const left = a.map(hostKey).sort(),
    right = b.map(hostKey).sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}
async function writeHosts(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  let ip: string;
  try {
    ip = await targetAddress(deps);
  } catch {
    return retryLater(db, tenantId, order, "Server address unknown", {
      attention:
        "The server IPv4 address for domain DNS is unknown; set it in Super admin settings.",
    });
  }
  const registrar = registrarOf(deps);
  const hosts = platformHosts(ip);
  const wa = workerActor(tenantId);
  const operationId = randomUUID();
  const attempt = Number(order.evidence?.hostWrites ?? 0) + 1;
  await db.tenant(wa, async (tx) => {
    await tx.query(
      "INSERT INTO registrar_operations(id,tenant_id,order_id,kind,intent_key,registrar,hostname,request,created_by) VALUES($1,$2,$3,'set_hosts',$4,$5,$6,$7,$8)",
      [
        operationId,
        tenantId,
        order.id,
        `hosts:${order.id}:${attempt}`,
        registrar.id,
        order.hostname,
        JSON.stringify({ hosts }),
        wa.userId,
      ],
    );
    await mergeEvidence(tx, order.id, { hostWrites: attempt });
  });
  try {
    // setHosts replaces every record, so it is safe to send again.
    await registrar.setHosts(order.hostname, hosts);
    const written = await registrar.getHosts(order.hostname);
    if (!sameHostSet(written, hosts))
      throw new RegistrarError(
        "The registrar holds a different host set than the one written",
        "definitive",
      );
  } catch (error) {
    const failed = failureOutcome(error);
    await db.tenant(wa, (tx) =>
      finishOperation(tx, operationId, failed.status, failed.outcome),
    );
    return retryLater(db, tenantId, order, "DNS records not confirmed", {
      attention:
        attempt >= 5
          ? "The registrar did not confirm the DNS records after 5 attempts."
          : undefined,
    });
  }
  await db.tenant(wa, async (tx) => {
    await finishOperation(tx, operationId, "succeeded", { verified: true });
    await update(tx, order.id, {
      status: "dns",
      attempts: 0,
      attention: null,
      next_attempt_at: new Date(Date.now() + 30000),
    });
    await mergeEvidence(tx, order.id, {
      dnsTarget: ip,
      hostsWrittenAt: new Date().toISOString(),
    });
    await progress(tx, order.id, "dns");
  });
}
async function httpsCheck(hostname: string) {
  await integrationRequest("https://" + hostname + "/", {
    method: "HEAD",
    signal: AbortSignal.timeout(15000),
  });
}
async function verifyAndActivate(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  const ip = order.evidence?.dnsTarget;
  const since = Date.parse(order.evidence?.hostsWrittenAt ?? "") || Date.now();
  const late = Date.now() - since > 72 * 3600000;
  const resolve = lookupA(deps);
  const names = [order.hostname, "www." + order.hostname];
  let resolved = true;
  for (const name of names) {
    try {
      const answers = await Promise.race([
        resolve(name),
        new Promise<string[]>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5000),
        ),
      ]);
      if (!answers.includes(ip)) resolved = false;
    } catch {
      resolved = false;
    }
  }
  if (!resolved)
    return retryLater(db, tenantId, order, "DNS not visible yet", {
      attention: late
        ? "DNS has not reached the platform 72 hours after the records were written."
        : undefined,
    });
  const owner = ownerOf(order);
  if (!owner) throw new Error("Order has no ordering owner");
  // Let the edge obtain certificates for both names, then prove HTTPS works.
  for (const name of names)
    await permitCertificateIssuance(db, {
      hostname: name,
      tenantId,
      orderId: order.id,
      actorId: owner,
    });
  try {
    for (const name of names) await (deps.httpsCheck ?? httpsCheck)(name);
  } catch {
    return retryLater(db, tenantId, order, "HTTPS not ready yet", {
      attention: late
        ? "The certificate for this domain has not been issued; check the edge."
        : undefined,
    });
  }
  const wa = workerActor(tenantId);
  await db.system(async (tx) => {
    const activated = await tx.tenant(wa, async (tx) => {
      const [current] = await tx.query(
        "SELECT * FROM domain_orders WHERE id=$1 FOR UPDATE",
        [order.id],
      );
      if (current?.status !== "dns") return null;
      const expires = Date.parse(current.expires_at);
      const row = await update(tx, order.id, {
        status: "active",
        live_at: current.live_at ?? new Date(),
        attention: null,
        attempts: 0,
        next_attempt_at: new Date(),
      });
      await mergeEvidence(tx, order.id, {
        tlsCheckedAt: new Date().toISOString(),
      });
      await progress(tx, order.id, "certificate");
      await progress(tx, order.id, "live");
      await event(tx, wa, "web_address.activated", order.id);
      if (!current.live_at)
        await notifyOwner(tx, tenantId, current, {
          templateKey: "web-address-live",
          dedupe: "live",
          title: "Your website is live on your own domain",
          body: `https://${order.hostname} now shows your coaching website and member app sign-in. Your domain renews every year${Number.isFinite(expires) ? `; the next renewal is before ${new Date(expires).toISOString().slice(0, 10)}` : ""}.`,
        });
      return row;
    });
    if (!activated) return;
    for (const name of names)
      await tx.query(
        "INSERT INTO domain_mappings(hostname,tenant_id,verified_at,active) VALUES($1,$2,now(),true) ON CONFLICT(hostname) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,verified_at=now(),active=true",
        [name, tenantId],
      );
  });
}

/**
 * Moves the yearly charge to 30 days before expiry (a trial until then,
 * without proration). If that date has already passed without it, the
 * renewal is charged now instead (a new billing cycle from today), so it is
 * paid well before expiry. "failed" is retried on a short backoff.
 */
async function alignBilling(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
): Promise<"done" | "failed" | "skip"> {
  if (!order.stripe_subscription_id || order.billing_aligned_at) return "skip";
  if (
    !order.renewal_enabled ||
    ["canceled", "incomplete_expired", "unpaid"].includes(order.billing_status)
  )
    return "skip";
  const expires = Date.parse(order.expires_at);
  if (!Number.isFinite(expires)) return "skip";
  const anchor = Math.floor((expires - RENEWAL_LEAD_DAYS * DAY) / 1000);
  const late = anchor * 1000 <= Date.now() + 3600000;
  const wa = workerActor(tenantId);
  try {
    if (late)
      await stripeOf(deps).subscriptions.update(
        order.stripe_subscription_id,
        { billing_cycle_anchor: "now", proration_behavior: "none" },
        {
          idempotencyKey: `web-address-charge:${order.id}:${new Date(expires).toISOString().slice(0, 10)}`,
        },
      );
    else
      await stripeOf(deps).subscriptions.update(
        order.stripe_subscription_id,
        { trial_end: anchor, proration_behavior: "none" },
        { idempotencyKey: `web-address-align:${order.id}:${anchor}` },
      );
  } catch {
    const failures = Number(order.evidence?.alignFailures ?? 0) + 1;
    await db.tenant(wa, async (tx) => {
      await mergeEvidence(tx, order.id, { alignFailures: failures });
      if (failures >= ALIGN_ATTENTION_FAILURES)
        await update(tx, order.id, { attention: ALIGN_ATTENTION });
    });
    return "failed";
  }
  await db.tenant(wa, async (tx) => {
    await update(tx, order.id, {
      billing_aligned_at: new Date(),
      ...(order.attention === ALIGN_ATTENTION ? { attention: null } : {}),
    });
    await mergeEvidence(tx, order.id, {
      nextRenewalChargeAt: new Date(
        late ? Date.now() : anchor * 1000,
      ).toISOString(),
      alignFailures: 0,
      ...(late ? { renewalChargedEarly: true } : {}),
    });
  });
  return "done";
}
/**
 * Whether the registrar already shows the expiry past the one this renewal
 * extends (renewed by an earlier lost request or by hand): then it is
 * recorded as confirmed and completed without sending a renewal.
 * "renewed", "not_renewed", or "unknown" (the registrar could not be asked).
 */
async function renewedAtRegistrar(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
  open?: Order,
) {
  const registrar = registrarOf(deps);
  let info;
  try {
    info = await registrar.info(order.hostname);
  } catch {
    return { state: "unknown" as const };
  }
  const base = order.evidence?.renewalBaseExpiry ?? iso(order.expires_at);
  if (!movedPast(info.expiresAt, base))
    return { state: "not_renewed" as const, info };
  const count = await db.tenant(workerActor(tenantId), (tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM registrar_operations WHERE order_id=$1 AND kind='renew'",
      [order.id],
    ),
  );
  const confirmed = await confirmOperation(db, tenantId, order, {
    kind: "renew",
    open,
    intentKey: `renew:${order.id}:${order.renewal_invoice_id ?? "manual"}:found:${Number(count[0].n) + 1}`,
    request: {
      years: 1,
      previousExpiry: base,
      invoiceId: order.renewal_invoice_id ?? null,
    },
    outcome: {
      reconciledAt: new Date().toISOString(),
      via: "getInfo",
      expiresAt: info.expiresAt,
    },
  });
  await completeRenewal(db, tenantId, order, confirmed, info.expiresAt, {
    usd: order.quote?.renewUsd,
    estimated: true,
  });
  return { state: "renewed" as const, info };
}
async function renew(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  const wa = workerActor(tenantId);
  const registrar = registrarOf(deps);
  if (
    await modeStop(
      db,
      tenantId,
      order,
      order.evidence?.renewalLivemode,
      registrar,
      "renewed",
    )
  )
    return;
  const intent = `renew:${order.id}:${order.renewal_invoice_id}`;
  // Every registrar renewal attempt for this paid invoice, newest first.
  const previous = (await db.tenant(wa, (tx) =>
    tx.query(
      "SELECT * FROM registrar_operations WHERE order_id=$1 AND kind='renew' AND request->>'invoiceId'=$2 ORDER BY created_at DESC,id DESC",
      [order.id, order.renewal_invoice_id],
    ),
  )) as Order[];
  const done = previous.find((op) =>
    ["succeeded", "confirmed"].includes(op.status),
  );
  if (done)
    return completeRenewal(db, tenantId, order, done, done.outcome?.expiresAt, {
      usd: done.cost_usd ?? order.quote?.renewUsd,
      estimated: done.cost_usd == null,
    });
  const open = ["sent", "failed", "unknown"].includes(previous[0]?.status)
    ? previous[0]
    : undefined;
  // A request that may still be running (another run, or one whose answer
  // is late) is never reconciled or repeated yet.
  if (open && settling(open, deps))
    return afterSettling(db, tenantId, order, open, deps);
  // Before every renewal request, and to reconcile an open one: the renewal
  // happened if the registrar's expiry moved past the one this invoice extends.
  const found = await renewedAtRegistrar(db, tenantId, order, deps, open);
  if (found.state === "renewed") return;
  if (found.state === "unknown")
    return retryLater(db, tenantId, order, "Renewal check pending");
  const base = order.evidence?.renewalBaseExpiry ?? iso(order.expires_at);
  if (open)
    await db.tenant(wa, (tx) =>
      finishOperation(tx, open.id, "absent", {
        reconciledAt: new Date().toISOString(),
        via: "getInfo",
      }),
    );
  const attempts = Number(order.evidence?.renewalAttempts ?? 0) + 1;
  if (attempts > MAX_RENEWAL_ATTEMPTS)
    return release(db, tenantId, order.id, {
      next_attempt_at: new Date(Date.now() + 6 * 3600000),
      renewal_status: "failed",
      attention:
        "The paid renewal did not complete at the registrar after 5 attempts. Renew at the registrar, then use Record registrar state (or Retry).",
    });
  const operationId = randomUUID();
  const key = previous.length ? `${intent}:${previous.length + 1}` : intent;
  await db.tenant(wa, async (tx) => {
    await tx.query(
      "INSERT INTO registrar_operations(id,tenant_id,order_id,kind,intent_key,registrar,hostname,request,created_by) VALUES($1,$2,$3,'renew',$4,$5,$6,$7,$8)",
      [
        operationId,
        tenantId,
        order.id,
        key,
        registrar.id,
        order.hostname,
        JSON.stringify({
          years: 1,
          previousExpiry: base,
          invoiceId: order.renewal_invoice_id,
        }),
        wa.userId,
      ],
    );
    await update(tx, order.id, { renewal_status: "renewing" });
    await mergeEvidence(tx, order.id, { renewalAttempts: attempts });
  });
  let result;
  try {
    result = await registrar.renew(order.hostname, 1);
    if (!result.renewed)
      throw new RegistrarError(
        "The registrar did not renew the name",
        "definitive",
      );
  } catch (error) {
    const failed = failureOutcome(error);
    await db.tenant(wa, (tx) =>
      finishOperation(tx, operationId, failed.status, failed.outcome),
    );
    return retryLater(db, tenantId, order, "Renewal pending reconciliation", {
      attempts,
      ...(failed.status === "unknown"
        ? { at: Date.now() + settleMs(deps) + 5000 }
        : {}),
    });
  }
  let expiresAt = result.expiresAt;
  if (!expiresAt)
    try {
      expiresAt = (await registrar.info(order.hostname)).expiresAt;
    } catch {
      /* Falls back to one year after the previous expiry. */
    }
  const succeeded = await db.tenant(wa, (tx) =>
    finishOperation(
      tx,
      operationId,
      "succeeded",
      {
        expiresAt: expiresAt ?? null,
        orderId: result.orderId ?? null,
        transactionId: result.transactionId ?? null,
      },
      result.chargedUsd ?? null,
    ),
  );
  return completeRenewal(db, tenantId, order, succeeded, expiresAt, {
    usd: result.chargedUsd ?? order.quote?.renewUsd,
    estimated: !result.chargedUsd,
  });
}
async function completeRenewal(
  db: Database,
  tenantId: string,
  order: Order,
  operation: Order,
  expiresAt: string | undefined,
  cost: { usd?: string; estimated: boolean },
) {
  const wa = workerActor(tenantId);
  const fallback = (Date.parse(order.expires_at) || Date.now()) + 365 * DAY;
  const reported = expiresAt ?? new Date(fallback).toISOString();
  await db.tenant(wa, async (tx) => {
    const [current] = await tx.query(
      "SELECT * FROM domain_orders WHERE id=$1 FOR UPDATE",
      [order.id],
    );
    if (
      !current ||
      (current.renewal_status === "renewed" &&
        current.renewal_invoice_id === order.renewal_invoice_id &&
        Date.parse(current.expires_at) >= Date.parse(reported))
    )
      return;
    // The recorded expiry never moves backwards.
    const expiry = new Date(
      Math.max(Date.parse(reported), Date.parse(current.expires_at) || 0),
    ).toISOString();
    await update(tx, order.id, {
      expires_at: expiry,
      renewal_status: "renewed",
      attention: null,
      attempts: 0,
      notices: {},
      // A domain that lapsed before the late renewal is provisioned again
      // from its DNS records (the registrar may have parked it).
      ...(current.status === "expired" ? { status: "owned" } : {}),
      next_attempt_at: new Date(),
    });
    await mergeEvidence(tx, order.id, { renewalAttempts: 0 });
    await progress(tx, order.id, "renewed", expiry.slice(0, 10));
    if (cost.usd)
      await postRegistrarCost(
        tx,
        tenantId,
        order,
        { id: operation.id, kind: "renewal" },
        String(cost.usd),
        cost.estimated,
      );
    await event(tx, wa, "web_address.renewed", order.id, { expiresAt: expiry });
    await notifyOwner(tx, tenantId, current, {
      templateKey: "web-address-renewed",
      dedupe: "renewed:" + expiry.slice(0, 10),
      title: "Your domain was renewed",
      body: `${order.hostname} is renewed until ${expiry.slice(0, 10)}. Nothing else is needed.`,
    });
  });
}
/**
 * Cancels the yearly subscription once (stable idempotency key). A failure
 * is retried by the worker and flagged for an operator after three tries.
 */
export async function cancelSubscription(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  if (!order.stripe_subscription_id || order.billing_status === "canceled")
    return true;
  const wa = workerActor(tenantId);
  const stripe = stripeOf(deps);
  let cancelled = false;
  try {
    await stripe.subscriptions.cancel(
      order.stripe_subscription_id,
      {},
      { idempotencyKey: "web-address-cancel:" + order.id },
    );
    cancelled = true;
  } catch {
    try {
      const current = await stripe.subscriptions.retrieve(
        order.stripe_subscription_id,
      );
      cancelled = ["canceled", "incomplete_expired"].includes(current?.status);
    } catch {
      cancelled = false;
    }
  }
  if (cancelled) {
    await db.tenant(wa, async (tx) => {
      await update(tx, order.id, {
        billing_status: "canceled",
        renewal_enabled: false,
      });
      await mergeEvidence(tx, order.id, {
        cancelPending: false,
        cancelAttempts: 0,
      });
    });
    return true;
  }
  const tries = Number(order.evidence?.cancelAttempts ?? 0) + 1;
  await db.tenant(wa, async (tx) => {
    await update(tx, order.id, {
      next_attempt_at: new Date(Date.now() + backoffSeconds(tries) * 1000),
      ...(tries >= 3
        ? {
            attention:
              "The yearly Stripe subscription could not be cancelled; cancel it in Stripe so the trainer is not charged again.",
          }
        : {}),
    });
    await mergeEvidence(tx, order.id, {
      cancelPending: true,
      cancelAttempts: tries,
    });
  });
  return false;
}
/**
 * When the subscription must stay after expiry: Stripe still retries the
 * renewal invoice (past_due), or the next charge falls just after expiry.
 * Returns when to look again, or null to cancel now.
 */
async function lapseHold(order: Order, deps: WebAddressDeps) {
  if (
    !order.renewal_enabled ||
    !order.stripe_subscription_id ||
    order.billing_status === "canceled"
  )
    return null;
  const expires = Date.parse(order.expires_at);
  const until = expires + LAPSE_HOLD_DAYS * DAY;
  if (!Number.isFinite(expires) || Date.now() >= until) return null;
  let subscription;
  try {
    subscription = await stripeOf(deps).subscriptions.retrieve(
      order.stripe_subscription_id,
    );
  } catch {
    return Date.now() + 3600000;
  }
  const periodEnd =
    Number(
      subscription?.current_period_end ??
        subscription?.items?.data?.[0]?.current_period_end,
    ) * 1000;
  if (subscription?.status === "past_due")
    return Math.min(until, Date.now() + 12 * 3600000);
  if (
    ["active", "trialing"].includes(subscription?.status) &&
    Number.isFinite(periodEnd) &&
    periodEnd <= expires + 3 * DAY &&
    periodEnd > Date.now() - DAY
  )
    return Math.min(until, Math.max(periodEnd + 3600000, Date.now() + 3600000));
  return null;
}
async function lapse(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  const wa = workerActor(tenantId);
  const fallback = await fallbackAddress(db, tenantId);
  const hold = await lapseHold(order, deps);
  await db.system(async (tx) => {
    const lapsed = await tx.tenant(wa, async (tx) => {
      const [current] = await tx.query(
        "SELECT * FROM domain_orders WHERE id=$1 FOR UPDATE",
        [order.id],
      );
      if (!current || !["active", "dns", "owned"].includes(current.status))
        return false;
      await update(tx, order.id, {
        status: "expired",
        next_attempt_at: hold ? new Date(hold) : null,
        renewal_status: null,
      });
      await progress(tx, order.id, "lapsed");
      await event(tx, wa, "web_address.lapsed", order.id);
      await notifyOwner(tx, tenantId, current, {
        templateKey: "web-address-lapsed",
        dedupe: "lapsed:" + String(current.expires_at).slice(0, 10),
        title: "Your domain has expired",
        body: `${order.hostname} was not renewed and no longer shows your website.${fallback ? ` Your website and member sign-in stay available at ${fallback}.` : ""}${hold ? " If the renewal payment Stripe is still retrying goes through in the next days, the domain is renewed and comes back automatically." : " You can buy a domain again from Web address."}`,
      });
      return true;
    });
    if (lapsed)
      await tx.query(
        "UPDATE domain_mappings SET active=false WHERE tenant_id=$1 AND hostname=ANY($2::text[])",
        [tenantId, [order.hostname, "www." + order.hostname]],
      );
  });
  if (!hold) await cancelSubscription(db, tenantId, order, deps);
}
/** An expired order: a late payment renews it; otherwise the subscription ends after its hold. */
async function settleLapsed(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  if (await reconcileLatestInvoice(db, tenantId, order, deps))
    return release(db, tenantId, order.id, { next_attempt_at: new Date() });
  const hold = await lapseHold(order, deps);
  if (hold)
    return release(db, tenantId, order.id, {
      next_attempt_at: new Date(hold),
    });
  if (await cancelSubscription(db, tenantId, order, deps))
    await release(db, tenantId, order.id, { next_attempt_at: null });
}
async function maintainActive(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  if (order.renewal_status === "paid" || order.renewal_status === "renewing")
    return renew(db, tenantId, order, deps);
  if (order.renewal_status === "failed") {
    // Renewed by hand at the registrar: record it instead of failing on.
    const found = await renewedAtRegistrar(db, tenantId, order, deps);
    if (found.state === "renewed") return;
  }
  let alignRetryAt = Infinity;
  if (!order.billing_aligned_at && order.stripe_subscription_id) {
    const aligned = await alignBilling(db, tenantId, order, deps);
    if (aligned === "failed")
      alignRetryAt =
        Date.now() +
        backoffSeconds(Number(order.evidence?.alignFailures ?? 0) + 1) * 1000;
    if (aligned !== "skip")
      order = (await readOrder(db, tenantId, order.id)) ?? order;
  }
  const expires = Date.parse(order.expires_at);
  const wa = workerActor(tenantId);
  if (!Number.isFinite(expires))
    return release(db, tenantId, order.id, { next_attempt_at: null });
  // Within the renewal window: a paid renewal invoice whose event was lost.
  if (
    expires - Date.now() <= RENEWAL_LEAD_DAYS * DAY &&
    order.renewal_status !== "failed" &&
    (await reconcileLatestInvoice(db, tenantId, order, deps))
  )
    return release(db, tenantId, order.id, { next_attempt_at: new Date() });
  if (expires <= Date.now()) {
    if (order.renewal_status === "failed")
      return retryLater(db, tenantId, order, "Paid renewal still failing", {
        attention:
          "The domain expired while a paid renewal is failing at the registrar; renew at the registrar and use Record registrar state.",
      });
    return lapse(db, tenantId, order, deps);
  }
  const daysLeft = Math.ceil((expires - Date.now()) / DAY);
  const due = GRACE_NOTICE_DAYS.filter((days) => daysLeft <= days);
  const period = new Date(expires).toISOString().slice(0, 10);
  const sent = order.notices ?? {};
  const pending = due.length ? due.at(-1)! : null;
  if (pending !== null && !sent[`${period}:${pending}`]) {
    const fallback = await fallbackAddress(db, tenantId);
    const switchUntil = Date.parse(order.evidence?.nextRenewalChargeAt ?? "");
    // Renewal can be turned back on only while the subscription still runs
    // (until the date of the yearly charge).
    const canTurnBackOn =
      !["canceled", "incomplete_expired"].includes(order.billing_status) &&
      Number.isFinite(switchUntil) &&
      switchUntil > Date.now();
    const pastDue = ["past_due", "unpaid"].includes(order.billing_status);
    const body = !order.renewal_enabled
      ? `Renewal is turned off for ${order.hostname}, so it stops working on ${period}${fallback ? `; your website stays available at ${fallback}` : ""}.${canTurnBackOn ? ` You can turn renewal back on in Web address until ${new Date(switchUntil).toISOString().slice(0, 10)}.` : " To keep this domain, contact platform support."}`
      : pastDue
        ? `The yearly renewal payment for ${order.hostname} failed. Update your card in Stripe before ${period}${fallback ? `, or your website moves back to ${fallback}` : ""}.`
        : `The yearly renewal for ${order.hostname} has not been charged yet. We charge your card before ${period}; make sure it is up to date.`;
    await db.tenant(wa, async (tx) => {
      await notifyOwner(tx, tenantId, order, {
        templateKey: "web-address-renewal-reminder",
        dedupe: `grace:${period}:${pending}`,
        title: `Your domain expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        body,
      });
      await update(tx, order.id, {
        notices: {
          ...sent,
          [`${period}:${pending}`]: new Date().toISOString(),
        },
        // Enabled, not failing, and still not charged two weeks before
        // expiry: the billing date is wrong somewhere.
        ...(order.renewal_enabled && !pastDue && !order.attention
          ? {
              attention:
                "The yearly renewal has not been charged although the domain expires within 14 days; check the Stripe subscription.",
            }
          : {}),
      });
    });
  }
  // Next visit: alignment retry, the day after the renewal charge (to catch
  // a lost payment event), the next grace notice, or expiry.
  const checkAfterCharge = expires - (RENEWAL_LEAD_DAYS - 1) * DAY;
  const nextNotice = GRACE_NOTICE_DAYS.filter((days) => days < daysLeft)
    .map((days) => expires - days * DAY)
    .filter((at) => at > Date.now());
  const next = Math.min(
    expires,
    alignRetryAt,
    ...nextNotice,
    ...(checkAfterCharge > Date.now() ? [checkAfterCharge] : []),
  );
  await release(db, tenantId, order.id, {
    next_attempt_at: new Date(Math.max(next, Date.now() + 60000)),
  });
}

/**
 * Ends an order whose purchase definitively failed: refunds the trainer
 * (after looking for an earlier refund), cancels the subscription and says so.
 */
export async function failOrder(
  db: Database,
  tenantId: string,
  order: Order,
  reason: string,
  deps: WebAddressDeps,
) {
  const wa = workerActor(tenantId);
  const stripe = stripeOf(deps);
  const paymentIntent = order.evidence?.firstPaymentIntentId;
  let refund: any = null;
  if (paymentIntent) {
    try {
      const existing = await stripe.refunds.list({
        payment_intent: paymentIntent,
        limit: 10,
      });
      refund =
        (existing?.data ?? []).find(
          (r: any) =>
            r?.metadata?.web_address_order_id === order.id &&
            ["succeeded", "pending"].includes(r.status),
        ) ??
        (await stripe.refunds.create(
          {
            payment_intent: paymentIntent,
            reason: "requested_by_customer",
            metadata: {
              purpose: "web_address",
              tenant_id: tenantId,
              web_address_order_id: order.id,
            },
          },
          { idempotencyKey: "web-address-refund:" + order.id },
        ));
    } catch {
      return release(db, tenantId, order.id, {
        next_attempt_at: null,
        attention: `${reason} The automatic refund could not be confirmed; refund and reconcile.`,
      });
    }
  }
  await db.system(async (tx) => {
    await tx.tenant(wa, async (tx) => {
      const [current] = await tx.query(
        "SELECT * FROM domain_orders WHERE id=$1 FOR UPDATE",
        [order.id],
      );
      if (
        !current ||
        !["paid", "purchasing", "checkout"].includes(current.status)
      )
        return;
      await update(tx, order.id, {
        status: "failed",
        next_attempt_at: null,
        attention:
          paymentIntent || current.status === "checkout"
            ? null
            : "Refund the first payment manually.",
        renewal_enabled: false,
      });
      await mergeEvidence(tx, order.id, {
        failure: reason,
        refundId: refund?.id ?? null,
      });
      await progress(tx, order.id, "failed", reason);
      if (refund?.id && Number(refund.amount) > 0)
        await postRefund(tx, tenantId, current, {
          id: refund.id,
          amountMinor: Number(refund.amount),
          paymentIntentId: paymentIntent,
        });
      await event(tx, wa, "web_address.failed", order.id, { reason });
      await notifyOwner(tx, tenantId, current, {
        templateKey: "web-address-refunded",
        dedupe: "failed",
        title: "We could not register your domain",
        body: `${order.hostname} could not be registered: ${reason} ${refund ? "Your payment has been refunded to your card." : "Platform support will refund your payment."} Your website stays available at its current address.`,
      });
    });
  });
  // A subscription left running would charge the trainer again next year.
  const current = await readOrder(db, tenantId, order.id);
  if (current) await cancelSubscription(db, tenantId, current, deps);
}

/**
 * One step for one order; the order is leased while it runs and only this
 * run releases the lease. `force` runs an order that is not due yet (an
 * operator's reconcile), never one another run holds.
 */
export async function processWebAddressOrder(
  db: Database,
  tenantId: string,
  orderId: string,
  deps: WebAddressDeps = {},
  options: { force?: boolean } = {},
) {
  const claimed = await claim(db, tenantId, orderId, options.force === true);
  if (!claimed) return false;
  const { order, token } = claimed;
  const renewalDue =
    order.renewal_status === "paid" || order.renewal_status === "renewing";
  try {
    switch (order.status) {
      case "paid":
        await purchase(db, tenantId, order, deps);
        break;
      case "purchasing":
        await reconcilePurchase(db, tenantId, order, deps);
        break;
      case "owned":
        if (renewalDue) await renew(db, tenantId, order, deps);
        else await writeHosts(db, tenantId, order, deps);
        break;
      case "dns":
        if (renewalDue) await renew(db, tenantId, order, deps);
        else await verifyAndActivate(db, tenantId, order, deps);
        break;
      case "active":
        await maintainActive(db, tenantId, order, deps);
        break;
      case "expired":
        if (renewalDue) await renew(db, tenantId, order, deps);
        else await settleLapsed(db, tenantId, order, deps);
        break;
      case "checkout":
        await sweepCheckout(db, tenantId, order, deps);
        break;
      default:
        if (order.evidence?.cancelPending === true) {
          if (await cancelSubscription(db, tenantId, order, deps))
            await release(db, tenantId, order.id, { next_attempt_at: null });
        } else await release(db, tenantId, order.id, { next_attempt_at: null });
    }
  } catch (error) {
    await retryLater(db, tenantId, order, "Step failed", {
      attention:
        Number(order.attempts ?? 0) >= 5
          ? "This order keeps failing: " +
            String((error as Error)?.message ?? "unexpected error").slice(
              0,
              200,
            )
          : undefined,
    }).catch(() => {});
  } finally {
    await releaseLease(db, tenantId, orderId, token).catch(() => {});
  }
  return true;
}
/**
 * A checkout still open after its window: expire it at Stripe (after
 * checking it) and cancel the order. A completed checkout whose payment
 * event never arrived is reconciled from Stripe's own objects, and flagged
 * if it stays unresolved.
 */
async function sweepCheckout(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  const wa = workerActor(tenantId);
  const stripe = stripeOf(deps);
  if (order.checkout_session_id) {
    const session = await stripe.checkout.sessions.retrieve(
      order.checkout_session_id,
    );
    if (session?.status === "complete") {
      await processWebAddressStripeEvent(
        db,
        {
          id: "reconcile:" + session.id,
          type: "checkout.session.completed",
          livemode: session.livemode,
          data: { object: session },
        },
        deps,
      );
      const linked = (await readOrder(db, tenantId, order.id)) ?? order;
      await reconcileLatestInvoice(db, tenantId, linked, deps);
      const current = await readOrder(db, tenantId, order.id);
      if (current?.status !== "checkout") return;
      const visits = Number(order.evidence?.checkoutChecks ?? 0) + 1;
      await db.tenant(wa, async (tx) => {
        await update(tx, order.id, {
          next_attempt_at: new Date(Date.now() + 10 * 60000),
          ...(visits >= CHECKOUT_ATTENTION_VISITS && !current.attention
            ? {
                attention:
                  "Checkout completed at Stripe but the first payment is not confirmed; check the subscription's first invoice.",
              }
            : {}),
        });
        await mergeEvidence(tx, order.id, { checkoutChecks: visits });
      });
      return;
    }
    if (session?.status === "open")
      await stripe.checkout.sessions.expire(order.checkout_session_id);
  }
  await db.tenant(wa, async (tx) => {
    const [current] = await tx.query(
      "SELECT status FROM domain_orders WHERE id=$1 FOR UPDATE",
      [order.id],
    );
    if (current?.status !== "checkout") return;
    await update(tx, order.id, {
      status: "cancelled",
      next_attempt_at: null,
    });
    await progress(tx, order.id, "cancelled", "Checkout not completed");
  });
}

/**
 * Operator fallback: records a registration or renewal that was made at the
 * registrar by other means. The registrar is the evidence: the domain must
 * be in the platform's account (getInfo), and a renewal must show an expiry
 * past the recorded one. Nothing is bought or renewed here.
 */
export async function recordRegistrarState(
  db: Database,
  tenantId: string,
  orderId: string,
  deps: WebAddressDeps,
): Promise<
  | { recorded: "registration" | "renewal"; expiresAt: string | null }
  | { recorded: false; reason: string }
> {
  const claimed = await claim(db, tenantId, orderId, true);
  if (!claimed)
    return {
      recorded: false,
      reason: "The worker is on this order right now; try again in a minute.",
    };
  const { order, token } = claimed;
  try {
    const registrar = registrarOf(deps);
    let info;
    try {
      info = await registrar.info(order.hostname);
    } catch (error) {
      return {
        recorded: false,
        reason:
          error instanceof RegistrarError && error.outcome === "definitive"
            ? "The registrar does not show this domain in the platform's account."
            : "The registrar could not be asked; try again.",
      };
    }
    const wa = workerActor(tenantId);
    if (["paid", "purchasing"].includes(order.status)) {
      const latest = await db.tenant(wa, (tx) =>
        latestOperation(tx, order.id, "register"),
      );
      const [count] = await db.tenant(wa, (tx) =>
        tx.query(
          "SELECT count(*)::int AS n FROM registrar_operations WHERE order_id=$1 AND kind='register'",
          [order.id],
        ),
      );
      const operation = ["succeeded", "confirmed"].includes(latest?.status)
        ? latest!
        : await confirmOperation(db, tenantId, order, {
            kind: "register",
            open: ["sent", "failed", "unknown"].includes(latest?.status)
              ? latest
              : undefined,
            intentKey: `register:${order.id}:${Number(count.n) + 1}`,
            request: { years: 1, recordedByOperator: true },
            outcome: {
              reconciledAt: new Date().toISOString(),
              via: "operator+getInfo",
              expiresAt: info.expiresAt ?? null,
            },
          });
      if (order.status === "paid")
        await db.tenant(wa, (tx) =>
          update(tx, order.id, { status: "purchasing" }),
        );
      await completeRegistration(
        db,
        tenantId,
        { ...order, status: "purchasing" },
        operation,
        deps,
        { usd: order.quote?.registerUsd, estimated: true },
        { expiresAt: info.expiresAt },
      );
      return { recorded: "registration", expiresAt: info.expiresAt ?? null };
    }
    if (["owned", "dns", "active", "expired"].includes(order.status)) {
      const pending = ["paid", "renewing", "failed"].includes(
        order.renewal_status,
      );
      const current = pending
        ? order
        : // No paid invoice: extends the recorded expiry.
          {
            ...order,
            renewal_invoice_id: null,
            evidence: {
              ...order.evidence,
              renewalBaseExpiry: iso(order.expires_at),
            },
          };
      const open = pending
        ? await db.tenant(wa, (tx) => latestOperation(tx, order.id, "renew"))
        : undefined;
      const found = await renewedAtRegistrar(
        db,
        tenantId,
        current,
        deps,
        open && ["sent", "failed", "unknown"].includes(open.status)
          ? open
          : undefined,
      );
      if (found.state === "renewed")
        return { recorded: "renewal", expiresAt: found.info.expiresAt ?? null };
      return {
        recorded: false,
        reason:
          found.state === "unknown"
            ? "The registrar could not be asked; try again."
            : "The registrar shows no expiry later than the one recorded.",
      };
    }
    return { recorded: false, reason: "This order is closed." };
  } finally {
    await releaseLease(db, tenantId, orderId, token).catch(() => {});
  }
}

/** Worker entry: due orders of every active or suspended workspace. */
export async function processWebAddressOrders(
  db: Database,
  deps: WebAddressDeps = {},
) {
  const tenants = await db.system((tx) =>
    tx.query<{ id: string }>(
      "SELECT id FROM tenants WHERE lifecycle_state IN ('active','suspended') ORDER BY id",
    ),
  );
  let processed = 0;
  for (const tenant of tenants) {
    const due = await db.tenant(workerActor(tenant.id), (tx) =>
      tx.query<{ id: string }>(
        "SELECT id FROM domain_orders WHERE mode='automatic' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at LIMIT 5",
      ),
    );
    for (const row of due)
      try {
        if (await processWebAddressOrder(db, tenant.id, row.id, deps))
          processed++;
      } catch {
        console.error("A web address order step failed");
      }
  }
  return { processed };
}
export { iso as webAddressIso };
