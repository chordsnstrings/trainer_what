/**
 * Autonomous trainer domains (docs/features/web-addresses.md): Stripe events,
 * the worker state machine (purchase, reconciliation, DNS zone and records,
 * delegation, DNS and TLS checks, activation, renewal, grace notices, lapse,
 * zone release, refund) and the ledger.
 *
 * Rules kept here: Stripe collects; every registrar purchase, renewal and DNS
 * write (zone, records, nameservers) is recorded under a stable intent before
 * it is sent; a domain is delegated to the DNS host only after the host holds
 * its zone and records, and a zone is never deleted while the name still
 * delegates to it; an outcome that
 * is not a confirmed success is reconciled with the registrar (getList /
 * getInfo) before another attempt (the database refuses a second attempt
 * while one is open), and an attempt that may still be in flight is left to
 * settle first; journals are immutable and use their own accounts, never the
 * trainer's payable balance or commission. Only the run holding an order's
 * lease (identified by its token) works on it or releases it.
 */
import { randomUUID } from "node:crypto";
import { resolve4 as systemResolve4 } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { elevated, event, type Database, type Tx } from "@trainer/db";
import { ProviderUnavailable, stripeClient } from "@trainer/providers";
import {
  isPublicAddress,
  runtimeConfig,
  validatePublicEndpoint,
} from "../../../packages/providers/src/configuration.ts";
import { sandboxResolver } from "../../../packages/providers/src/sandbox.ts";
import {
  DigitalOceanDns,
  DnsError,
  RegistrarHostedDns,
  delegatesToDigitalOcean,
  dnsHostingSettings,
  dnsName,
  publicDnsLookup,
  sameNameservers,
  type DesiredRecord,
  type DnsProvider,
  type DnsProviderId,
  type PublicDnsAnswer,
  type PublicDnsType,
  type ZoneReleaseEvidence,
} from "../../../packages/providers/src/dns-hosting.ts";
import {
  RegistrarError,
  canRegister,
  canRenew,
  canUseRegistrarDns,
  paymentModeProblem,
  registrantFromConfig,
  registrarFor,
  registrarFromConfig,
  type HostRecord,
  type Registrar,
} from "../../../packages/providers/src/registrar.ts";
import {
  DEFAULT_PRICE_RULE,
  markupPriceCents,
  platformRootDomain,
  subdomainEligible,
  subdomainHost,
  usdCents,
  usdToAedMinor,
} from "../../../packages/domain/src/web-address.ts";
import { journal } from "./finance.ts";
import {
  fetchPrice,
  pricesForSearch,
  type EndingPrice,
} from "./web-address-prices.ts";
import { notifyUser } from "./notifications.ts";
import {
  permitCertificateIssuance,
  reportedServerIpv4,
} from "./host-operations.ts";
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
  /** A once-only coupon brings the first invoice down to a lower first-year price. */
  coupons?: { create: (params: any, options?: any) => Promise<any> };
  invoices?: { retrieve: (id: string, params?: any) => Promise<any> };
  paymentIntents?: { retrieve: (id: string) => Promise<any> };
  invoicePayments?: { list: (params: any) => Promise<any> };
};
export type WebAddressDeps = {
  registrar?: Registrar;
  stripe?: WebAddressStripe;
  /**
   * The DNS host for one zone guard (tests inject adapters with a test
   * transport). Default: DigitalOcean from the DNS hosting settings, or the
   * registrar's own DNS.
   */
  dns?: (
    guard: {
      mayManage: (zone: string) => boolean;
      protectedZone?: (zone: string) => boolean;
    },
    provider: DnsProviderId,
  ) => DnsProvider;
  /** Public DNS answers (DNS over HTTPS): delegation, DNSSEC and release checks. */
  publicDns?: (name: string, type: PublicDnsType) => Promise<PublicDnsAnswer>;
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
/**
 * This many days before expiry (a month before the renewal charge), the
 * ending's current renewal cost is compared with the renewal price the
 * trainer pays, so an operator hears of a rise before the renewal.
 */
export const RENEWAL_COST_CHECK_DAYS = 60;
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
/**
 * A lapsed domain's DNS zone is kept at least this long after expiry (the
 * registrar's grace and redemption periods), then deleted only once neither
 * the registrar nor public DNS delegates the name to the DNS host.
 */
export const ZONE_RELEASE_DAYS = 45;
const ZONE_RECHECK_DAYS = 7;
const DNS_ATTENTION_ATTEMPTS = 5;
/**
 * How long a registrar that accepted a nameserver change may keep showing
 * the old list before the change is sent again (101domain answers 202 and
 * its read-back is not proven to flag the change as pending).
 */
const NAMESERVER_SETTLE_MS = 6 * 3600000;
/** Nameserver changes sent again for one delegation before an operator is asked. */
const MAX_DELEGATION_RESETS = 3;
/** Weekly zone-release checks before an operator is asked to decide. */
const ZONE_RELEASE_ATTENTION_CHECKS = 3;
/**
 * A takeover signal an operator should see: it stays through the fallback
 * to the registrar's DNS and activation until an operator clears it (Retry).
 */
const HELD_ELSEWHERE_ATTENTION =
  "Another DigitalOcean account holds this domain's zone, so it was not delegated there; the registrar's DNS serves it now. Find out who created that zone, then Retry to clear this.";
/** Clears an order's attention after a successful step, except a takeover signal. */
const clearedAttention = (attention: unknown) =>
  attention === HELD_ELSEWHERE_ATTENTION ? HELD_ELSEWHERE_ATTENTION : null;
/** Statuses in which the platform holds the registration. */
const REGISTERED = new Set([
  "owned",
  "zone",
  "delegating",
  "dns",
  "active",
  "expired",
]);

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
/**
 * The registrar an order was bought through is not configured now (or a
 * test injected another one). Nothing is sent to a different registrar.
 */
export class OrderRegistrarUnavailable extends Error {
  constructor(readonly registrarId: string) {
    super(
      `This domain is registered at ${registrarId}, whose settings are incomplete now. Complete them in Super admin settings: an order always stays with the registrar it was bought through, and nothing was sent to another registrar.`,
    );
    this.name = "OrderRegistrarUnavailable";
  }
}
/**
 * The registrar that holds an order's domain (domain_orders.registrar, set
 * at checkout and immutable), never simply the one chosen for new
 * purchases: purchase, reconciliation, renewal, nameservers, host records
 * and zone release all ask the registrar the name was bought through.
 */
function registrarOf(deps: WebAddressDeps, order: Order): Registrar {
  const bought =
    typeof order.registrar === "string" && order.registrar
      ? order.registrar
      : null;
  if (deps.registrar) {
    if (bought && deps.registrar.id !== bought)
      throw new OrderRegistrarUnavailable(bought);
    return deps.registrar;
  }
  if (!bought) return registrarFromConfig();
  try {
    return registrarFor(bought);
  } catch {
    throw new OrderRegistrarUnavailable(bought);
  }
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
  "dns_provider",
  "serve_mode",
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

// ---- Prices and ledger ----------------------------------------------------------

/**
 * An order's two prices in minor units of the currency it was priced in:
 * USD, first year and renewal separately (orders from 28 September 2026), or
 * AED for orders quoted before, which charge one yearly price (priceMinor)
 * every year. Read from the immutable quote, so older orders keep working.
 */
export function orderPrices(order: Order) {
  const quote = order.quote ?? {};
  const usd = String(quote.currency ?? "AED").toUpperCase() === "USD";
  const yearly = Number(quote.priceMinor ?? 0);
  const minor = (value: unknown) => {
    const n = Number(value ?? yearly);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  };
  return {
    currency: (usd ? "USD" : "AED") as "USD" | "AED",
    firstYearMinor: minor(quote.firstYearPriceMinor),
    renewalMinor: minor(quote.renewalPriceMinor),
  };
}
/**
 * A premium name's registration or renewal price as quoted (without the
 * ICANN fee), which the registrar's order and renewal must name; undefined
 * for a regular name.
 */
function premiumPrice(order: Order, which: "registerUsd" | "renewUsd") {
  const value = order.quote?.premium?.[which];
  return typeof value === "string" && value ? value : undefined;
}
type CostKind = "register" | "renew";
/**
 * Whether a registrar cost breaks the order's pricing for that year: its
 * price by the order's own rule (ceil(cost / step) × step + ending) is above
 * what the trainer pays for that year, so the owner's margin is no longer
 * kept (USD orders); for an order quoted in AED, any cost above the quoted
 * one. A rise that stays within the same step keeps the margin and is not
 * flagged.
 */
export function costOverPrice(
  order: Order,
  which: CostKind,
  usd: string | undefined | null,
) {
  if (!usd) return false;
  let cost: number;
  try {
    cost = usdCents(usd);
  } catch {
    return false;
  }
  const prices = orderPrices(order);
  if (prices.currency === "USD") {
    try {
      const price = markupPriceCents(
        cost,
        order.quote?.priceRule ?? DEFAULT_PRICE_RULE,
      );
      return (
        price >
        (which === "register" ? prices.firstYearMinor : prices.renewalMinor)
      );
    } catch {
      return false;
    }
  }
  try {
    return (
      cost >
      usdCents(
        String(order.quote?.[which === "register" ? "registerUsd" : "renewUsd"]),
      )
    );
  } catch {
    return false;
  }
}
/** An operator accepted buying at this cost (Retry on a price hold). */
function costAccepted(order: Order, which: CostKind, usd: string) {
  const accepted = order.evidence?.acceptedCost;
  if (!accepted || accepted.which !== which) return false;
  try {
    return usdCents(usd) <= usdCents(String(accepted.usd));
  } catch {
    return false;
  }
}
const usdText = (value: unknown) => {
  try {
    return (usdCents(String(value)) / 100).toFixed(2);
  } catch {
    return String(value ?? "unknown");
  }
};
/**
 * Records, for operators only, that the registrar charged (or now asks)
 * more than the trainer's price covers. Kept on the order until an operator
 * clears it with Retry; later steps never clear it, and the trainer never
 * sees it.
 */
async function recordCostAlert(
  tx: Tx,
  order: Order,
  which: CostKind | "renew_upcoming",
  usd: string,
) {
  const prices = orderPrices(order);
  const paid =
    which === "register" ? prices.firstYearMinor : prices.renewalMinor;
  const what =
    which === "register"
      ? "charged USD " + usdText(usd) + " for the registration"
      : which === "renew"
        ? "charged USD " + usdText(usd) + " for the renewal"
        : "now asks USD " + usdText(usd) + " for the next renewal";
  const message = `The registrar ${what}, more than the ${prices.currency} ${(paid / 100).toFixed(2)} the trainer pays for that year covers under the price rule (quoted cost USD ${usdText(order.quote?.[which === "register" ? "registerUsd" : "renewUsd"])}). ${which === "renew_upcoming" ? "The renewal still goes through at the platform's cost unless you act: ask the owner, or change the subscription price in Stripe." : "The platform absorbed the difference."} Retry clears this note.`;
  await mergeEvidence(tx, order.id, {
    costAlert: {
      which,
      usd,
      paidMinor: paid,
      currency: prices.currency,
      at: new Date().toISOString(),
      message,
    },
  });
}
/** A Stripe currency ("usd") as a journal currency ("USD"), or null. */
const currencyCode = (value: unknown) =>
  typeof value === "string" && /^[a-z]{3}$/i.test(value)
    ? value.toUpperCase()
    : null;

/**
 * Journals a payment once, in the currency it was paid in; null when this
 * invoice was already journaled. Web address journals use their own
 * accounts: never the trainer's payable balance, commission or the Stripe
 * receivable of member payments.
 */
async function postPayment(
  tx: Tx,
  tenantId: string,
  order: Order,
  invoice: {
    id: string;
    amountMinor: number;
    currency: string;
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
      currency: invoice.currency,
      grossMinor: invoice.amountMinor,
      invoiceId: invoice.id,
      paymentIntentId: invoice.paymentIntentId ?? null,
      chargeId: invoice.chargeId ?? null,
    },
    { currency: invoice.currency },
  );
}
/** The journaled payment a refund or dispute belongs to: its kind and currency. */
async function paymentJournal(
  tx: Tx,
  paymentIntentId?: string,
  chargeId?: string,
) {
  const [row] = await tx.query(
    "SELECT data->>'kind' AS kind,currency FROM journals WHERE source_key LIKE 'web-address-invoice:%' AND ((data->>'paymentIntentId')=$1 OR (data->>'chargeId')=$2) ORDER BY created_at LIMIT 1",
    [paymentIntentId ?? "", chargeId ?? ""],
  );
  return row
    ? {
        kind: (row.kind as string | null) ?? null,
        currency: String(row.currency),
      }
    : null;
}
async function postRefund(
  tx: Tx,
  tenantId: string,
  order: Order,
  refund: {
    id: string;
    amountMinor: number;
    currency?: unknown;
    paymentIntentId?: string;
    chargeId?: string;
  },
) {
  const payment = await paymentJournal(
    tx,
    refund.paymentIntentId,
    refund.chargeId,
  );
  const unmatched = payment?.kind === "unmatched";
  // Stripe refunds in the currency of the payment.
  const currency =
    currencyCode(refund.currency) ??
    payment?.currency ??
    orderPrices(order).currency;
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
      currency,
      refundId: refund.id,
      refundAmountMinor: refund.amountMinor,
      paymentIntentId: refund.paymentIntentId ?? null,
      ofUnmatchedPayment: unmatched,
    },
    { currency },
  );
}
/**
 * The registrar's charge for a registration or renewal. An order priced in
 * USD records the registrar's USD cost as it is (whole cents, rounded up);
 * an order quoted in AED converts it at the rate its quote was priced at.
 */
async function postRegistrarCost(
  tx: Tx,
  tenantId: string,
  order: Order,
  operation: { id: string; kind: string },
  usd: string,
  estimated: boolean,
) {
  const currency = orderPrices(order).currency;
  const rate =
    currency === "AED" ? String(order.quote?.usdToAed ?? "3.6725") : null;
  const amount = rate ? usdToAedMinor(usd, rate) : usdCents(usd);
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
      currency,
      usd,
      ...(rate ? { usdToAed: rate } : {}),
      estimated,
    },
    { currency },
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
      // The prices the trainer agreed to, in the currency the order was
      // priced in (USD; AED for orders quoted before 28 September 2026).
      const expected = orderPrices(order);
      const paidCurrency = currencyCode(object.currency);
      const invoice = {
        id: object.id as string,
        amountMinor: amount,
        currency: paidCurrency ?? expected.currency,
        ...ids,
      };
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
          paidCurrency !== expected.currency ||
          amount !== expected.firstYearMinor
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
        [
          "owned",
          "zone",
          "delegating",
          "dns",
          "active",
          "expired",
          "purchasing",
          "paid",
        ].includes(order.status)
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
        // The domain is renewed for a paid renewal whatever Stripe charged
        // (the subscription is the platform's), but a charge other than the
        // agreed renewal price is shown to an operator.
        const unexpected =
          paidCurrency !== expected.currency ||
          amount !== expected.renewalMinor;
        await update(tx, order.id, {
          ...links,
          renewal_status: "paid",
          renewal_invoice_id: object.id,
          billing_status: "active",
          attempts: 0,
          next_attempt_at: new Date(),
          ...(unexpected
            ? {
                attention: `A renewal payment of ${amount} ${paidCurrency ?? "?"} (minor units) differs from the agreed renewal price of ${expected.renewalMinor} ${expected.currency}; check the Stripe subscription's price.`,
              }
            : {}),
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
            ["owned", "zone", "delegating", "dns", "active"].includes(
              order.status,
            ) &&
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
          refund.amount > 0 &&
          // Once Stripe reported the refund failed or canceled, any later
          // pending or succeeded snapshot (refund.updated or charge.refunded
          // delivered out of order) is stale: the refund is never journaled.
          !(await refundFailed(tx, refund.id))
        )
          await postRefund(tx, tenantId, order, {
            id: refund.id,
            amountMinor: Number(refund.amount),
            currency: refund.currency,
            paymentIntentId: idOf(refund.payment_intent),
            chargeId:
              idOf(refund.charge) ??
              (object.object === "charge" ? object.id : undefined),
          });
        else if (["failed", "canceled"].includes(refund?.status))
          await reverseFailedRefund(tx, tenantId, order, refund);
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
      ) {
        const currency =
          currencyCode(object.currency) ??
          (await paymentJournal(tx, idOf(object.payment_intent), idOf(object.charge)))
            ?.currency ??
          orderPrices(order).currency;
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
            currency,
            disputeId: object.id,
            chargeId: idOf(object.charge) ?? null,
            amountMinor: amount,
          },
          { currency },
        );
      }
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
/** Stripe reported this domain refund failed or canceled (terminal states). */
async function refundFailed(tx: Tx, refundId: string) {
  const [row] = await tx.query(
    "SELECT 1 FROM events WHERE name='web_address.refund_failed' AND data->>'refundId'=$1 LIMIT 1",
    [refundId],
  );
  return !!row;
}
/**
 * A domain refund is journaled when Stripe reports it pending, so a pending
 * refund that later fails or is canceled never paid the money back. Its
 * journal is reversed once by a compensating entry with the exact opposite
 * lines (whatever accounts and amounts the refund posted), and the order asks
 * an operator to refund again (docs/features/platform-finance.md).
 */
async function reverseFailedRefund(
  tx: Tx,
  tenantId: string,
  order: Order,
  refund: any,
) {
  if (typeof refund?.id !== "string" || !refund.id) return;
  const actor = callbackActor(tenantId);
  if (!(await refundFailed(tx, refund.id)))
    await event(tx, actor, "web_address.refund_failed", order.id, {
      refundId: refund.id,
      providerStatus: String(refund.status).slice(0, 20),
    });
  const [original] = await tx.query(
    "SELECT j.id,j.data,j.currency,coalesce(jsonb_agg(jsonb_build_object('account',l.account,'amount',l.amount_minor)) FILTER(WHERE l.id IS NOT NULL),'[]') AS lines FROM journals j LEFT JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_id=j.id WHERE j.source_key=$1 GROUP BY j.id",
    ["web-address-refund:" + refund.id],
  );
  if (!original) return;
  // The reversal is in the refund journal's own currency (USD for orders
  // priced in dollars, AED for orders quoted before; migration 071), so it
  // cancels exactly the lines it reverses.
  const currency = String(original.currency ?? "AED");
  const reversed = await journal(
    tx,
    actor,
    "web-address-refund-reversal:" + refund.id,
    "Trainer web address refund did not complete (" + order.hostname + ")",
    (original.lines as Array<{ account: string; amount: number | string }>).map(
      (l) => ({ account: l.account, amount: -Number(l.amount) }),
    ),
    {
      orderId: order.id,
      hostname: order.hostname,
      refundId: refund.id,
      reversesJournalId: original.id,
      refundAmountMinor: Number(original.data?.refundAmountMinor ?? 0),
      providerStatus: String(refund.status).slice(0, 20),
      failureReason: refund.failure_reason
        ? String(refund.failure_reason).slice(0, 80)
        : null,
      currency,
    },
    { currency },
  );
  if (reversed)
    await update(tx, order.id, {
      attention: `A refund (${refund.id}) ${refund.status === "canceled" ? "was canceled" : "failed"} at Stripe${refund.failure_reason ? ` (${String(refund.failure_reason).slice(0, 80)})` : ""}; its ledger entry was reversed. Refund again and reconcile.`,
    });
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
  error instanceof RegistrarError || error instanceof DnsError
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
  const registrar = registrarOf(deps, order);
  // Nothing is sent to a registrar whose API cannot register yet.
  if (!canRegister(registrar))
    return release(db, tenantId, order.id, {
      next_attempt_at: null,
      attention:
        "The configured registrar cannot register domains through its API yet. Choose another registrar in Settings and retry, register by hand and use Record registrar state, or refund.",
    });
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
  // A regular name is bought at the registrar's price of the moment, which
  // may have risen since the trainer paid (a first-year promotion ended
  // while the order waited): asked again first. A premium name is bought
  // only at its checked premium price, which the registrar enforces.
  if (
    !premiumPrice(order, "registerUsd") &&
    (await purchasePriceHeld(db, tenantId, order, registrar))
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
            premiumPriceUsd: premiumPrice(order, "registerUsd") ?? null,
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
      // A premium name is bought only at the premium price it was quoted
      // and paid for; the registrar refuses the order if it changed.
      premiumPriceUsd: premiumPrice(order, "registerUsd"),
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
/**
 * Before a regular name is bought: the ending's registration cost now. When
 * its price by the order's rule is above the first-year price the trainer
 * paid, nothing is bought and an operator decides (Retry buys at up to that
 * cost, the platform absorbing the difference; or refund). True when the
 * purchase must not go ahead now.
 */
async function purchasePriceHeld(
  db: Database,
  tenantId: string,
  order: Order,
  registrar: Registrar,
) {
  const tld = order.hostname.slice(order.hostname.indexOf(".") + 1);
  let price: EndingPrice;
  try {
    price = await fetchPrice(db, registrar, tld);
  } catch {
    await retryLater(db, tenantId, order, "Price check pending", {
      attention:
        Number(order.attempts ?? 0) >= 6
          ? "The registrar's current price could not be read before buying, so nothing was bought. Check the registrar settings, then retry or refund."
          : undefined,
    });
    return true;
  }
  if (price.kind !== "price") {
    await release(db, tenantId, order.id, {
      next_attempt_at: null,
      attention: `The registrar no longer sells .${tld} through its API (${price.reason.slice(0, 120)}), so nothing was bought. Refund and close, or register it by hand and use Record registrar state.`,
    });
    return true;
  }
  if (
    !costOverPrice(order, "register", price.registerUsd) ||
    costAccepted(order, "register", price.registerUsd)
  )
    return false;
  const prices = orderPrices(order);
  await db.tenant(workerActor(tenantId), async (tx) => {
    await update(tx, order.id, {
      next_attempt_at: null,
      attention: `The registrar's registration cost for this name is now USD ${usdText(price.registerUsd)} (quoted USD ${usdText(order.quote?.registerUsd)}); under the price rule that is more than the ${prices.currency} ${(prices.firstYearMinor / 100).toFixed(2)} first-year price the trainer paid, so nothing was bought. Retry buys it at up to USD ${usdText(price.registerUsd)} (the platform absorbs the difference), or Refund and close.`,
    });
    await mergeEvidence(tx, order.id, {
      priceHold: {
        which: "register",
        usd: price.registerUsd,
        quotedUsd: order.quote?.registerUsd ?? null,
        at: new Date().toISOString(),
      },
    });
  });
  return true;
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
  const registrar = registrarOf(deps, order);
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
    // The registrar's own charge, above what the trainer's price covers
    // (and above any cost an operator accepted): operators are told.
    if (
      cost.usd &&
      !cost.estimated &&
      costOverPrice(order, "register", String(cost.usd)) &&
      !costAccepted(order, "register", String(cost.usd))
    )
      await recordCostAlert(tx, order, "register", String(cost.usd));
    // Workspace events are listed to the trainer: never the registrar's
    // name (operators read it on the order).
    await event(tx, wa, "web_address.registered", order.id);
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
  const registrar = registrarOf(deps, order);
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
  // A registrar that registers asynchronously may still be processing our
  // order while the name still shows as available: never mark the attempt
  // absent, buy again or refund while it says so (or cannot say).
  if (registrar.pendingOrder) {
    let pending = true;
    try {
      pending = await registrar.pendingOrder(order.hostname);
    } catch {
      pending = true;
    }
    if (pending)
      return retryLater(db, tenantId, order, "Registration still processing", {
        attention:
          Number(order.attempts ?? 0) >= 12
            ? "The registrar still shows the registration order as processing (or could not be asked); check it at the registrar."
            : undefined,
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
    // A premium name was bought only when it was quoted as one.
    (availability.premium && !premiumPrice(order, "registerUsd")) ||
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

/**
 * The server's public IPv4 for domain records: the test seam, the
 * configured address, the verified host controller report, or what the
 * platform's own name resolves to.
 */
async function targetAddress(db: Database, deps: WebAddressDeps) {
  if (deps.targetIpv4) return deps.targetIpv4();
  const configured = runtimeConfig().WEB_ADDRESS_TARGET_IPV4?.trim();
  if (configured && isIP(configured) === 4) return configured;
  const reported = await reportedServerIpv4(db).catch(() => null);
  if (reported && isIP(reported) === 4 && isPublicAddress(reported))
    return reported;
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
export function platformHosts(ipv4: string, ttl = 1800): HostRecord[] {
  return [
    { name: "@", type: "A", address: ipv4, ttl },
    { name: "www", type: "A", address: ipv4, ttl },
  ];
}
/**
 * The records a bought domain needs at its DNS host: A for the domain and
 * for www. Never a wildcard: only these two names are served.
 */
export function domainRecords(ipv4: string, ttl = 1800): DesiredRecord[] {
  return platformHosts(ipv4, ttl).map((host) => ({
    name: host.name,
    type: "A" as const,
    data: host.address,
    ttl: host.ttl,
  }));
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
// ---- DNS: the DNS host, its zone, delegation and release ------------------------

/** The platform's own zones: never managed or released through an order. */
function platformZone(zone: string) {
  const config = runtimeConfig();
  return (
    zone === platformRootDomain(config.PLATFORM_ROOT_DOMAIN) ||
    zone === dnsName(config.DNS_PLATFORM_ZONE)
  );
}
/**
 * The DNS host for one order. Its zone guard admits only this order's own
 * domain, and only once the platform holds the registration; the platform's
 * own zones are never touched from here.
 */
function dnsHost(
  order: Order,
  deps: WebAddressDeps,
  provider: DnsProviderId,
): DnsProvider {
  const hostname = dnsName(order.hostname);
  const guard = {
    mayManage: (zone: string) =>
      !!hostname &&
      zone === hostname &&
      REGISTERED.has(order.status) &&
      !platformZone(zone),
    protectedZone: platformZone,
  };
  if (deps.dns) return deps.dns(guard, provider);
  if (provider === "registrar")
    return new RegistrarHostedDns(registrarOf(deps, order), guard);
  const settings = dnsHostingSettings();
  if (!settings.token)
    throw new ProviderUnavailable(
      "dns_hosting",
      "DigitalOcean DNS is chosen but its API token is missing.",
    );
  return new DigitalOceanDns(settings.token, guard);
}
/** Which DNS host a newly registered domain uses (kept on the order). */
function chosenDnsProvider(order: Order): DnsProviderId {
  if (order.dns_provider === "registrar" || order.dns_provider === "digitalocean")
    return order.dns_provider;
  return dnsHostingSettings().provider;
}
const publicDnsOf = (deps: WebAddressDeps) => deps.publicDns ?? publicDnsLookup;
/**
 * What a DNS call converges to (compared between attempts of one kind): the
 * nameservers, zone, records or host set it asked for.
 */
function dnsTarget(kind: string, request: any) {
  const value =
    kind === "set_nameservers"
      ? request?.nameservers
      : kind === "set_records"
        ? request?.records
        : kind === "set_hosts"
          ? request?.hosts
          : request?.zone;
  // Stored requests are jsonb (keys reordered): compare with sorted keys.
  const canonical = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, canonical((item as any)[key])]),
          )
        : item;
  return JSON.stringify(canonical(value ?? null));
}
/**
 * Runs one DNS call recorded under a stable intent: the row is written as
 * sent before the call and finished with its outcome. These calls converge
 * to a stated result (they read the current state first), so once one
 * succeeds, earlier attempts of the same kind that never got an answer are
 * settled: confirmed by that read-back when they asked for the same result,
 * absent (superseded) when they asked for another one. A definitive failure
 * stays failed.
 */
async function recordedCall<T>(
  db: Database,
  tenantId: string,
  order: Order,
  input: {
    kind: "set_hosts" | "create_zone" | "set_records" | "set_nameservers" | "delete_zone";
    provider: string;
    prefix: string;
    request: object;
  },
  run: () => Promise<{ outcome: object; value: T }>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const wa = workerActor(tenantId);
  const id = randomUUID();
  await db.tenant(wa, async (tx) => {
    const [count] = await tx.query(
      "SELECT count(*)::int AS n FROM registrar_operations WHERE order_id=$1 AND kind=$2",
      [order.id, input.kind],
    );
    await tx.query(
      "INSERT INTO registrar_operations(id,tenant_id,order_id,kind,intent_key,registrar,hostname,request,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        id,
        tenantId,
        order.id,
        input.kind,
        `${input.prefix}:${order.id}:${Number(count.n) + 1}`,
        input.provider,
        order.hostname,
        JSON.stringify(input.request),
        wa.userId,
      ],
    );
  });
  try {
    const { outcome, value } = await run();
    await db.tenant(wa, async (tx) => {
      await finishOperation(tx, id, "succeeded", outcome);
      const open = await tx.query(
        "SELECT id,request FROM registrar_operations WHERE order_id=$1 AND kind=$2 AND id<>$3 AND status IN ('sent','unknown')",
        [order.id, input.kind, id],
      );
      const target = dnsTarget(input.kind, input.request);
      for (const row of open) {
        const same = dnsTarget(input.kind, row.request) === target;
        await finishOperation(tx, row.id, same ? "confirmed" : "absent", {
          reconciledAt: new Date().toISOString(),
          via: same ? "read-back" : "superseded",
          settledBy: id,
        });
      }
    });
    return { ok: true, value };
  } catch (error) {
    const failed = failureOutcome(error);
    await db.tenant(wa, (tx) =>
      finishOperation(tx, id, failed.status, failed.outcome),
    );
    return { ok: false, error };
  }
}
/** Waits and retries a DNS step; asks an operator after repeated failures. */
function dnsRetry(
  db: Database,
  tenantId: string,
  order: Order,
  note: string,
  attention: string,
  error?: unknown,
) {
  const attempts = Number(order.attempts ?? 0) + 1;
  const wait = error instanceof DnsError ? error.retryAfterMs : undefined;
  return retryLater(db, tenantId, order, note, {
    attempts,
    ...(wait ? { at: Date.now() + wait } : {}),
    attention: attempts >= DNS_ATTENTION_ATTEMPTS ? attention : undefined,
  });
}

/** owned: sets up DNS at the order's DNS host. */
async function provisionDns(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  if (chosenDnsProvider(order) === "digitalocean")
    return provisionZone(db, tenantId, order, deps);
  // A registrar whose own DNS cannot be set up through its API is never
  // retried on it: an operator chooses the DNS host instead.
  if (!canUseRegistrarDns(registrarOf(deps, order)))
    return release(db, tenantId, order.id, {
      next_attempt_at: pausedUntil(order),
      attention:
        "This domain's registrar cannot serve it from its own DNS through its API. Choose DigitalOcean in DNS hosting, then Re-run DNS setup with DigitalOcean.",
    });
  return writeHosts(db, tenantId, order, deps);
}
/**
 * The registrar's own DNS: the domain is returned to the registrar's
 * nameservers if it was delegated elsewhere (recorded), then its complete
 * host set is written and read back.
 */
async function writeHosts(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  let ip: string;
  try {
    ip = await targetAddress(db, deps);
  } catch {
    return retryLater(db, tenantId, order, "Server address unknown", {
      attention:
        "The server IPv4 address for domain DNS is unknown; set it in Super admin settings.",
    });
  }
  const registrar = registrarOf(deps, order);
  const host = dnsHost(order, deps, "registrar");
  const hosts = platformHosts(ip);
  const wa = workerActor(tenantId);
  const attempt = Number(order.evidence?.hostWrites ?? 0) + 1;
  await db.tenant(wa, (tx) =>
    mergeEvidence(tx, order.id, { hostWrites: attempt }),
  );
  let state;
  try {
    state = await registrar.getNameservers(order.hostname);
  } catch (error) {
    return dnsRetry(
      db,
      tenantId,
      order,
      "Nameservers not read",
      "The registrar did not report the domain's nameservers after 5 attempts.",
      error,
    );
  }
  if (!state.usingRegistrarDns) {
    const back = await recordedCall(
      db,
      tenantId,
      order,
      {
        kind: "set_nameservers",
        provider: registrar.id,
        prefix: "nameservers",
        request: { nameservers: null, from: state.nameservers },
      },
      async () => {
        const after = await registrar.setNameservers(order.hostname, null);
        if (!after.usingRegistrarDns)
          throw new RegistrarError(
            "The domain did not return to the registrar's DNS",
            "unknown",
          );
        return { outcome: { nameservers: after.nameservers }, value: after };
      },
    );
    if (!back.ok)
      return dnsRetry(
        db,
        tenantId,
        order,
        "Registrar DNS not restored",
        "The domain could not be returned to the registrar's DNS after 5 attempts.",
        back.error,
      );
  }
  const written = await recordedCall(
    db,
    tenantId,
    order,
    {
      kind: "set_hosts",
      provider: registrar.id,
      prefix: "hosts",
      request: { hosts },
    },
    async () => {
      // setHosts replaces every record, so it is safe to send again; the
      // read-back must show exactly this set.
      await host.upsertRecords(order.hostname, domainRecords(ip));
      return { outcome: { verified: true }, value: true };
    },
  );
  if (!written.ok)
    return retryLater(db, tenantId, order, "DNS records not confirmed", {
      attention:
        attempt >= 5
          ? "The registrar did not confirm the DNS records after 5 attempts."
          : undefined,
    });
  await db.tenant(wa, async (tx) => {
    await update(tx, order.id, {
      status: "dns",
      dns_provider: "registrar",
      attempts: 0,
      attention: clearedAttention(order.attention),
      next_attempt_at: new Date(Date.now() + 30000),
    });
    await mergeEvidence(tx, order.id, {
      dnsTarget: ip,
      hostsWrittenAt: new Date().toISOString(),
    });
    await progress(tx, order.id, "dns");
  });
}
/**
 * owned, DigitalOcean: the zone is created in the platform's account (or
 * found there), then its A records for the domain and www are converged and
 * read back through the API. A zone another account holds is never used:
 * the domain falls back to the registrar's DNS.
 */
async function provisionZone(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  const wa = workerActor(tenantId);
  let ip: string;
  try {
    ip = await targetAddress(db, deps);
  } catch {
    return retryLater(db, tenantId, order, "Server address unknown", {
      attention:
        "The server IPv4 address for domain DNS is unknown; set it in Super admin settings.",
    });
  }
  let host: DnsProvider;
  try {
    host = dnsHost(order, deps, "digitalocean");
  } catch {
    return retryLater(db, tenantId, order, "DNS host not configured", {
      attention:
        "DigitalOcean DNS is chosen but not configured; complete DNS hosting in Super admin settings, or switch this order to the registrar's DNS.",
    });
  }
  const zone = await recordedCall(
    db,
    tenantId,
    order,
    {
      kind: "create_zone",
      provider: host.id,
      prefix: "zone",
      request: { zone: order.hostname },
    },
    async () => {
      const state = await host.ensureZone(order.hostname);
      return { outcome: { state }, value: state };
    },
  );
  if (!zone.ok)
    return dnsRetry(
      db,
      tenantId,
      order,
      "DNS zone not confirmed",
      "The DNS host did not confirm the domain's zone after 5 attempts.",
      zone.error,
    );
  if (zone.value === "held_elsewhere") {
    // Delegating to a zone another account holds would hand it the domain.
    // It is also a takeover signal an operator should look at.
    const registrar = registrarOf(deps, order);
    const fallback = canUseRegistrarDns(registrar);
    await db.tenant(wa, async (tx) => {
      await update(tx, order.id, {
        ...(fallback
          ? { dns_provider: "registrar", attempts: 0, next_attempt_at: new Date() }
          : { next_attempt_at: pausedUntil(order) }),
        attention: fallback
          ? HELD_ELSEWHERE_ATTENTION
          : "Another DigitalOcean account holds this domain's zone, so it was not delegated there, and this registrar's own DNS cannot be set up through its API. Have that zone removed (DigitalOcean support), then Re-run DNS setup.",
      });
      await mergeEvidence(tx, order.id, {
        zoneHeldElsewhere: new Date().toISOString(),
      });
      await progress(tx, order.id, "dns_fallback", "Zone held by another account");
    });
    return;
  }
  const records = domainRecords(ip, dnsHostingSettings().ttl);
  const written = await recordedCall(
    db,
    tenantId,
    order,
    {
      kind: "set_records",
      provider: host.id,
      prefix: "records",
      request: { records },
    },
    async () => {
      const counts = await host.upsertRecords(order.hostname, records, {
        replaceTypes: ["AAAA", "CNAME"],
      });
      // Verified through the DNS host's API before any delegation.
      const now = await host.records(order.hostname);
      const missing = records.filter(
        (want) =>
          !now.some(
            (r) =>
              r.name === want.name &&
              r.type === want.type &&
              r.data === want.data,
          ),
      );
      const shadowing = now.filter(
        (r) =>
          ["@", "www"].includes(r.name) &&
          (["AAAA", "CNAME"].includes(r.type) ||
            (r.type === "A" && r.data !== ip)),
      );
      if (missing.length || shadowing.length)
        throw new DnsError(
          "The DNS host holds different records than the ones written",
          "definitive",
          "RECORDS_DIFFER",
        );
      return { outcome: { ...counts, verified: true }, value: counts };
    },
  );
  if (!written.ok)
    return dnsRetry(
      db,
      tenantId,
      order,
      "DNS records not confirmed",
      "The DNS host did not confirm the domain's records after 5 attempts.",
      written.error,
    );
  await db.tenant(wa, async (tx) => {
    await update(tx, order.id, {
      status: "zone",
      dns_provider: "digitalocean",
      attempts: 0,
      attention: null,
      next_attempt_at: new Date(),
    });
    await mergeEvidence(tx, order.id, {
      dnsTarget: ip,
      zoneState: zone.value,
      zoneWrittenAt: new Date().toISOString(),
      zoneReleasedAt: null,
      zoneHandedOverAt: null,
      zoneRecordsClearedAt: null,
      zoneReleaseChecks: 0,
      zoneReleaseErrors: 0,
    });
    await progress(tx, order.id, "zone");
  });
}
/**
 * zone: delegates the domain to the DNS host's nameservers at the registrar,
 * only while the zone is still in the platform's account, and never when the
 * registry holds a DS (DNSSEC) record the unsigned zone would fail.
 */
async function delegate(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  const wa = workerActor(tenantId);
  const host = dnsHost(order, deps, "digitalocean");
  const nameservers = host.nameservers()!;
  let zone;
  try {
    zone = await host.getZone(order.hostname);
  } catch (error) {
    return dnsRetry(
      db,
      tenantId,
      order,
      "DNS zone not read",
      "The DNS host could not be asked for the domain's zone after 5 attempts.",
      error,
    );
  }
  if (!zone) {
    // The zone disappeared before delegation: set it up again first.
    await db.tenant(wa, async (tx) => {
      await update(tx, order.id, { status: "owned", next_attempt_at: new Date() });
      await progress(tx, order.id, "zone_missing");
    });
    return;
  }
  // Never delegated without knowing: a DS record at the registry would make
  // the unsigned zone fail for every validating resolver.
  let ds: PublicDnsAnswer;
  try {
    ds = await publicDnsOf(deps)(order.hostname, "DS");
  } catch (error) {
    return dnsRetry(
      db,
      tenantId,
      order,
      "DNSSEC not checked",
      "Public DNS could not be asked whether the domain has a DS (DNSSEC) record after 5 attempts; nothing was delegated.",
      error,
    );
  }
  const registrar = registrarOf(deps, order);
  if (ds.status === "ok" && ds.answers.length)
    return release(db, tenantId, order.id, {
      // Looked at again at expiry, so the domain still lapses on time.
      next_attempt_at: pausedUntil(order),
      attention: canUseRegistrarDns(registrar)
        ? "The registry holds a DS (DNSSEC) record for this domain, and the DNS host does not sign zones. Remove DNSSEC at the registrar and Retry, or switch the order to the registrar's DNS."
        : "The registry holds a DS (DNSSEC) record for this domain, and the DNS host does not sign zones. Remove DNSSEC at the registrar, then Retry.",
    });
  const set = await recordedCall(
    db,
    tenantId,
    order,
    {
      kind: "set_nameservers",
      provider: registrar.id,
      prefix: "nameservers",
      request: { nameservers },
    },
    async () => {
      const state = await registrar.setNameservers(order.hostname, nameservers);
      if (!state.pending && !sameNameservers(state.nameservers, nameservers))
        throw new RegistrarError(
          "The registrar shows different nameservers than the ones set",
          "definitive",
          "NAMESERVERS_DIFFER",
        );
      return {
        outcome: { nameservers: state.nameservers, pending: !!state.pending },
        value: state,
      };
    },
  );
  if (!set.ok)
    return dnsRetry(
      db,
      tenantId,
      order,
      "Nameservers not confirmed",
      "The registrar did not confirm the DNS host's nameservers after 5 attempts.",
      set.error,
    );
  const now = new Date().toISOString();
  await db.tenant(wa, async (tx) => {
    await update(tx, order.id, {
      status: "delegating",
      attempts: 0,
      attention: null,
      next_attempt_at: new Date(Date.now() + 60000),
    });
    await mergeEvidence(tx, order.id, {
      // The last change (its read-back may lag) and the first of this
      // delegation (the 72-hour clock, never restarted by a change sent again).
      nameserversSetAt: now,
      delegationStartedAt: order.evidence?.delegationStartedAt ?? now,
      dnssec: "absent",
    });
    await progress(tx, order.id, "connecting");
  });
}
/**
 * delegating: waits until the registrar shows the DNS host's nameservers as
 * applied and public DNS answers with them. Nameservers reset by someone
 * else are set again.
 */
async function verifyDelegation(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  const wa = workerActor(tenantId);
  const host = dnsHost(order, deps, "digitalocean");
  const nameservers = host.nameservers()!;
  const since =
    Date.parse(
      order.evidence?.delegationStartedAt ?? order.evidence?.nameserversSetAt ?? "",
    ) || Date.now();
  const late = Date.now() - since > 72 * 3600000;
  // The zone must still be in the platform's account: a name delegated to
  // DigitalOcean without it could be claimed by any account.
  let zone;
  try {
    zone = await host.getZone(order.hostname);
  } catch (error) {
    return dnsRetry(
      db,
      tenantId,
      order,
      "DNS zone not read",
      "The DNS host could not be asked for the domain's zone after 5 attempts.",
      error,
    );
  }
  if (!zone) {
    await db.tenant(wa, async (tx) => {
      await update(tx, order.id, { status: "owned", next_attempt_at: new Date() });
      await progress(tx, order.id, "zone_missing");
    });
    return;
  }
  const registrar = registrarOf(deps, order);
  let state;
  try {
    state = await registrar.getNameservers(order.hostname);
  } catch {
    return retryLater(db, tenantId, order, "Nameservers not read", {
      attention: late
        ? "The registrar could not be asked for the domain's nameservers 72 hours after they were set."
        : undefined,
    });
  }
  if (!state.pending && !sameNameservers(state.nameservers, nameservers)) {
    // An accepted change the registrar does not show yet: wait before
    // sending it again (its read-back may lag without saying so).
    const setAt = Date.parse(order.evidence?.nameserversSetAt ?? "");
    if (Number.isFinite(setAt) && Date.now() - setAt < NAMESERVER_SETTLE_MS)
      return retryLater(db, tenantId, order, "Nameserver change not shown yet", {
        attention: late
          ? "The registrar does not show the DNS host's nameservers 72 hours after they were set; check the domain at the registrar."
          : undefined,
      });
    // Reset by someone else, or never applied: sent again a bounded number
    // of times, then an operator decides.
    const resets = Number(order.evidence?.delegationResets ?? 0) + 1;
    if (resets > MAX_DELEGATION_RESETS)
      return retryLater(db, tenantId, order, "Nameservers keep differing", {
        at: Date.now() + NAMESERVER_SETTLE_MS,
        attention: `The registrar still shows other nameservers than the DNS host's after ${MAX_DELEGATION_RESETS} changes; check the domain at the registrar (a lock, or someone changing it), then use Re-run DNS setup.`,
      });
    await db.tenant(wa, async (tx) => {
      await update(tx, order.id, { status: "zone", next_attempt_at: new Date() });
      await mergeEvidence(tx, order.id, { delegationResets: resets });
      await progress(tx, order.id, "connecting_again");
    });
    return;
  }
  let visible: PublicDnsAnswer | null = null;
  try {
    visible = await publicDnsOf(deps)(order.hostname, "NS");
  } catch {
    visible = null;
  }
  if (
    state.pending ||
    visible?.status !== "ok" ||
    !sameNameservers(visible.answers, nameservers)
  )
    return retryLater(db, tenantId, order, "Delegation not visible yet", {
      attention: late
        ? "Public DNS does not show the DNS host's nameservers 72 hours after they were set; check the domain at the registrar."
        : undefined,
    });
  await db.tenant(wa, async (tx) => {
    await update(tx, order.id, {
      status: "dns",
      attempts: 0,
      attention: null,
      next_attempt_at: new Date(Date.now() + 30000),
    });
    await mergeEvidence(tx, order.id, {
      delegatedAt: new Date().toISOString(),
      hostsWrittenAt: new Date().toISOString(),
      delegationStartedAt: null,
      delegationResets: 0,
    });
    await progress(tx, order.id, "dns");
  });
}
type ZoneRelease =
  | { state: "release"; evidence: ZoneReleaseEvidence }
  | { state: "delegated"; evidence: ZoneReleaseEvidence }
  | { state: "adopted" }
  | { state: "other_order" }
  | { state: "error" };
/**
 * Whether the zone this order wrote at the DNS host may be deleted now:
 * never while another open order for the same name may use it (a re-bought
 * name adopts the existing zone), and never while the registrar (for a name
 * still in the platform's account) or public DNS delegates the name to the
 * DNS host, since any account could then claim the zone and serve the name.
 */
async function zoneReleaseCheck(
  db: Database,
  order: Order,
  deps: WebAddressDeps,
): Promise<ZoneRelease> {
  const other = await otherOrderForName(db, order);
  if (other) return { state: other };
  const registrar = registrarOf(deps, order);
  let registrarNameservers: string[] | null;
  let publicNameservers: string[] | "nxdomain";
  try {
    const ours = await inOurAccount(registrar, order.hostname);
    registrarNameservers = ours
      ? (await registrar.getNameservers(order.hostname)).nameservers
      : null;
    const answer = await publicDnsOf(deps)(order.hostname, "NS");
    publicNameservers = answer.status === "nxdomain" ? "nxdomain" : answer.answers;
  } catch {
    return { state: "error" };
  }
  const evidence = { registrarNameservers, publicNameservers };
  return delegatesToDigitalOcean(registrarNameservers) ||
    (publicNameservers !== "nxdomain" && delegatesToDigitalOcean(publicNameservers))
    ? { state: "delegated", evidence }
    : { state: "release", evidence };
}
/**
 * Another open order for the same name (in any workspace): "adopted" once
 * it wrote its records into the zone after this order did, "other_order"
 * before that; null when there is none.
 */
async function otherOrderForName(db: Database, order: Order) {
  // Orders are workspace-scoped: a narrow definer helper (migration 070)
  // answers for the worker's own order only.
  const [other] = await db.tenant(workerActor(order.tenant_id), (tx) =>
    tx.query<{ zone_written_at: string }>(
      "SELECT zone_written_at FROM domain_name_other_order($1)",
      [order.id],
    ),
  );
  if (!other) return null;
  return other.zone_written_at &&
    Date.parse(other.zone_written_at) >
      (Date.parse(order.evidence?.zoneWrittenAt ?? "") || 0)
    ? ("adopted" as const)
    : ("other_order" as const);
}
/** Deletes the order's zone (recorded, with the evidence); true when it is gone. */
async function deleteHeldZone(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
  evidence: ZoneReleaseEvidence,
) {
  let host: DnsProvider;
  try {
    host = dnsHost(order, deps, "digitalocean");
  } catch {
    return false;
  }
  const done = await recordedCall(
    db,
    tenantId,
    order,
    {
      kind: "delete_zone",
      provider: host.id,
      prefix: "release",
      request: { zone: order.hostname, ...evidence },
    },
    async () => {
      await host.deleteZone(order.hostname, evidence);
      return { outcome: { deleted: true }, value: true };
    },
  );
  if (!done.ok) return false;
  await db.tenant(workerActor(tenantId), async (tx) => {
    await mergeEvidence(tx, order.id, {
      zoneReleasedAt: new Date().toISOString(),
      zoneReleaseErrors: 0,
    });
    await progress(tx, order.id, "zone_released");
  });
  return true;
}
/**
 * Removes the A records of a zone kept after lapse (the zone itself, its
 * SOA and NS stay, so no other account can claim the name): a kept zone
 * never points a lapsed domain at an address the platform may give up. A
 * late renewal writes them again. True when they are gone.
 */
async function clearRetainedRecords(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  let host: DnsProvider;
  try {
    host = dnsHost(order, deps, "digitalocean");
  } catch {
    return false;
  }
  const done = await recordedCall(
    db,
    tenantId,
    order,
    {
      kind: "set_records",
      provider: host.id,
      prefix: "records",
      request: { records: [], removed: ["@ A", "www A", "@ AAAA", "www AAAA"] },
    },
    async () => {
      const removed = await host.removeRecords(order.hostname, ["@", "www"], [
        "A",
        "AAAA",
      ]);
      return { outcome: { removed, verified: true }, value: removed };
    },
  );
  if (!done.ok) return false;
  await db.tenant(workerActor(tenantId), (tx) =>
    mergeEvidence(tx, order.id, {
      zoneRecordsClearedAt: new Date().toISOString(),
    }),
  );
  return true;
}
/**
 * expired: deletes the zone of a lapsed domain once nothing delegates the
 * name there any more (neither the registrar, for a name still in the
 * platform's account, nor public DNS), at least ZONE_RELEASE_DAYS after
 * expiry. Until then the zone stays (without its A records), so no other
 * account can create it and serve the name. Looks again every week, and
 * asks an operator when the zone may be blocking a new holder of the name.
 */
async function releaseZone(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  const wa = workerActor(tenantId);
  const later = (days: number) =>
    release(db, tenantId, order.id, {
      next_attempt_at: new Date(Date.now() + days * DAY),
    });
  // A newer order for the name may already use this zone: its records are
  // never touched from here.
  const other = await otherOrderForName(db, order);
  if (!other && !order.evidence?.zoneRecordsClearedAt)
    await clearRetainedRecords(db, tenantId, order, deps);
  const expires = Date.parse(order.expires_at);
  const due = (Number.isFinite(expires) ? expires : Date.now()) + ZONE_RELEASE_DAYS * DAY;
  if (Date.now() < due && other !== "adopted")
    return release(db, tenantId, order.id, { next_attempt_at: new Date(due) });
  const check: ZoneRelease = other
    ? { state: other }
    : await zoneReleaseCheck(db, order, deps);
  if (check.state === "adopted") {
    // The name was bought again and its new order uses this zone.
    await db.tenant(wa, async (tx) => {
      await update(tx, order.id, { next_attempt_at: null });
      await mergeEvidence(tx, order.id, {
        zoneHandedOverAt: new Date().toISOString(),
      });
      await progress(tx, order.id, "zone_handed_over");
    });
    return;
  }
  if (check.state === "other_order") return later(ZONE_RECHECK_DAYS);
  if (check.state === "error") {
    const errors = Number(order.evidence?.zoneReleaseErrors ?? 0) + 1;
    await db.tenant(wa, async (tx) => {
      await mergeEvidence(tx, order.id, { zoneReleaseErrors: errors });
      if (errors >= DNS_ATTENTION_ATTEMPTS)
        await update(tx, order.id, {
          attention:
            "The lapsed domain's DNS zone could not be checked for release after 5 daily attempts (registrar or public DNS unreachable); it is kept until a check succeeds.",
        });
    });
    return later(1);
  }
  if (check.state === "delegated") {
    const checks = Number(order.evidence?.zoneReleaseChecks ?? 0) + 1;
    // Out of the platform's account yet delegated to the DNS host: someone
    // else may hold the name now, and the kept zone blocks them.
    const foreign = check.evidence.registrarNameservers === null;
    await db.tenant(wa, async (tx) => {
      await mergeEvidence(tx, order.id, {
        zoneReleaseCheckedAt: new Date().toISOString(),
        zoneReleaseChecks: checks,
        zoneReleaseErrors: 0,
      });
      if (foreign || checks >= ZONE_RELEASE_ATTENTION_CHECKS)
        await update(tx, order.id, {
          attention: foreign
            ? "The lapsed domain is no longer in the platform's registrar account, but public DNS still delegates it to DigitalOcean, so its kept zone answers for it. If the name has a new holder, delete the zone in DigitalOcean so they can use it; otherwise it is released once the delegation ends."
            : `The lapsed domain still delegates to DigitalOcean after ${checks} weekly checks, so its zone is kept. Check the nameservers at the registrar.`,
        });
    });
    return later(ZONE_RECHECK_DAYS);
  }
  if (!(await deleteHeldZone(db, tenantId, order, deps, check.evidence)))
    return later(1);
  await release(db, tenantId, order.id, { next_attempt_at: null });
}
/**
 * An active domain moved to the registrar's DNS still has the zone it had
 * at the DNS host: released once nothing delegates the name there (checked
 * at each visit; no waiting period, the name is still the platform's).
 * True while the zone is still held.
 */
async function releaseLeftZone(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  if (order.dns_provider !== "registrar" || !zoneHeld(order)) return false;
  const check = await zoneReleaseCheck(db, order, deps);
  if (check.state !== "release") return check.state !== "adopted";
  return !(await deleteHeldZone(db, tenantId, order, deps, check.evidence));
}
/**
 * An order that wrote a zone at the DNS host which is still there: not
 * released, not handed over to a newer order for the name. Whatever DNS
 * host the order uses now (an operator may have moved it to the registrar's).
 */
const zoneHeld = (order: Order) =>
  !!order.evidence?.zoneWrittenAt &&
  !order.evidence?.zoneReleasedAt &&
  !order.evidence?.zoneHandedOverAt;

/**
 * Proves HTTPS works for the domain (and lets the edge obtain its
 * certificate). Any HTTP answer counts, a redirect included: a forwarded
 * domain answers 301. The certificate is verified; the address is pinned
 * to the public address that was checked.
 */
async function httpsCheck(hostname: string) {
  const { addresses } = await validatePublicEndpoint("https://" + hostname + "/");
  await httpsProbe(hostname, addresses[0]);
}
/**
 * One HEAD request to https://<hostname>/ at a pinned address: resolves on
 * any HTTP answer (a 301 included), rejects on a certificate that is not
 * valid for the name, a connection error or the timeout. `port` and `ca`
 * exist for the local test server only.
 */
export async function httpsProbe(
  hostname: string,
  address: { address: string; family: number },
  options: { port?: number; ca?: string; timeoutMs?: number } = {},
) {
  await new Promise<void>((resolve, reject) => {
    const request = httpsRequest(
      "https://" + hostname + "/",
      {
        method: "HEAD",
        ...(options.port ? { port: options.port } : {}),
        ...(options.ca ? { ca: options.ca } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
        lookup: (_name, lookupOptions, callback) => {
          if (typeof lookupOptions === "object" && lookupOptions?.all)
            callback(null, [address] as any);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        response.resume();
        if ((response.statusCode ?? 0) >= 100) resolve();
        else reject(new Error("No HTTP answer"));
      },
    );
    request.on("error", reject);
    request.end();
  });
}
/**
 * How each mapped name of an active order is served: www always redirects to
 * the domain; the domain shows the site, or forwards to the workspace's
 * subdomain when the owner chose that.
 */
export function mappingRedirects(hostname: string, serveMode: unknown) {
  return [
    {
      hostname,
      redirect: serveMode === "forward" ? ("subdomain" as const) : null,
    },
    { hostname: "www." + hostname, redirect: "apex" as const },
  ];
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
  // A forwarded domain's live notice names where visitors go.
  const forwardTarget =
    order.serve_mode === "forward"
      ? await fallbackAddress(db, tenantId).catch(() => null)
      : null;
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
        attention: clearedAttention(current.attention),
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
          body: `${forwardTarget ? `https://${order.hostname} now forwards visitors to ${forwardTarget}` : `https://${order.hostname} now shows your coaching website and member app sign-in`}. Your domain renews every year${Number.isFinite(expires) ? `; the next renewal is before ${new Date(expires).toISOString().slice(0, 10)}` : ""}.`,
        });
      return row;
    });
    if (!activated) return;
    for (const mapping of mappingRedirects(
      order.hostname,
      activated.serve_mode,
    ))
      await tx.query(
        "INSERT INTO domain_mappings(hostname,tenant_id,verified_at,active,redirect) VALUES($1,$2,now(),true,$3) ON CONFLICT(hostname) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,verified_at=now(),active=true,redirect=EXCLUDED.redirect",
        [mapping.hostname, tenantId, mapping.redirect],
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
  const registrar = registrarOf(deps, order);
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
  const registrar = registrarOf(deps, order);
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
  if (!canRenew(registrar)) {
    // This registrar's API cannot renew; it renews by itself (auto-renewal,
    // about 60 days before expiry). Nothing is sent: the renewal is
    // recognised above once the registrar's expiry moves.
    const expires = Date.parse(order.expires_at);
    return retryLater(db, tenantId, order, "Waiting for the automatic renewal", {
      at: Date.now() + 6 * 3600000,
      attention:
        Number.isFinite(expires) && expires - Date.now() < 20 * DAY
          ? "The renewal is paid but the registrar has not renewed the domain by itself; renew it in the registrar's panel, then use Record registrar state."
          : undefined,
    });
  }
  const base = order.evidence?.renewalBaseExpiry ?? iso(order.expires_at);
  // A registrar that renews asynchronously may still be processing an
  // earlier renewal order: never send another while it says so.
  if (previous.length && registrar.pendingOrder) {
    let pending = true;
    try {
      pending = await registrar.pendingOrder(order.hostname);
    } catch {
      pending = true;
    }
    if (pending)
      return retryLater(db, tenantId, order, "Renewal still processing", {
        attention:
          Number(order.attempts ?? 0) >= 12
            ? "The registrar still shows the renewal order as processing (or could not be asked); check it at the registrar."
            : undefined,
      });
  }
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
    result = await registrar.renew(order.hostname, 1, {
      premiumPriceUsd: premiumPrice(order, "renewUsd"),
    });
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
  // A renewal counts only when the registrar's expiry moved past the one
  // this invoice extends; otherwise it is reconciled (never counted, never
  // sent again while it may still complete).
  if (expiresAt && !movedPast(expiresAt, base)) {
    await db.tenant(wa, (tx) =>
      finishOperation(tx, operationId, "unknown", {
        error: "The registrar reported an expiry that did not move",
        expiresAt,
      }),
    );
    return retryLater(db, tenantId, order, "Renewal pending reconciliation", {
      attempts,
      at: Date.now() + settleMs(deps) + 5000,
    });
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
    // The domain is renewed either way (the trainer paid); a charge above
    // what the renewal price covers is for an operator to see.
    if (
      cost.usd &&
      !cost.estimated &&
      costOverPrice(order, "renew", String(cost.usd))
    )
      await recordCostAlert(tx, order, "renew", String(cost.usd));
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
  let autoRenews = false;
  try {
    autoRenews = !canRenew(registrarOf(deps, order));
  } catch {
    autoRenews = false;
  }
  const lapsedNow = await db.system(async (tx) => {
    const lapsed = await tx.tenant(wa, async (tx) => {
      const [current] = await tx.query(
        "SELECT * FROM domain_orders WHERE id=$1 FOR UPDATE",
        [order.id],
      );
      if (
        !current ||
        !["active", "dns", "delegating", "zone", "owned"].includes(
          current.status,
        )
      )
        return false;
      // A zone at the DNS host is kept: it is deleted only by the release
      // step, once nothing delegates the name there any more.
      await update(tx, order.id, {
        status: "expired",
        next_attempt_at: hold
          ? new Date(hold)
          : zoneHeld(current)
            ? new Date()
            : null,
        renewal_status: null,
        ...(autoRenews
          ? {
              attention:
                "The domain lapsed. The registrar renews its domains by itself and its API cannot switch that off: turn auto-renewal off for this domain in the registrar's panel.",
            }
          : {}),
      });
      await mergeEvidence(tx, order.id, {
        delegationStartedAt: null,
        delegationResets: 0,
        ...(zoneHeld(current) ? { zoneRetained: new Date().toISOString() } : {}),
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
        "UPDATE domain_mappings SET active=false,redirect=NULL WHERE tenant_id=$1 AND hostname=ANY($2::text[])",
        [tenantId, [order.hostname, "www." + order.hostname]],
      );
    return lapsed;
  });
  // A kept zone no longer points the lapsed name at the server.
  if (lapsedNow && zoneHeld(order))
    await clearRetainedRecords(
      db,
      tenantId,
      { ...order, status: "expired" },
      deps,
    ).catch(() => false);
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
  if (!(await cancelSubscription(db, tenantId, order, deps))) return;
  // The subscription is over; a zone at the DNS host is released later.
  if (zoneHeld(order)) return releaseZone(db, tenantId, order, deps);
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
  // A zone left at the DNS host after a move to the registrar's DNS.
  const zoneLeft = await releaseLeftZone(db, tenantId, order, deps).catch(
    () => true,
  );
  await sendGraceNotice(db, tenantId, order);
  const costCheckAt = expires - RENEWAL_COST_CHECK_DAYS * DAY;
  if (costCheckAt <= Date.now())
    await checkRenewalCost(db, tenantId, order, deps).catch(() => {});
  const daysLeft = Math.ceil((expires - Date.now()) / DAY);
  // Next visit: alignment retry, the day after the renewal charge (to catch
  // a lost payment event), the next grace notice, expiry, or the weekly
  // look at a zone left behind.
  const checkAfterCharge = expires - (RENEWAL_LEAD_DAYS - 1) * DAY;
  const nextNotice = GRACE_NOTICE_DAYS.filter((days) => days < daysLeft)
    .map((days) => expires - days * DAY)
    .filter((at) => at > Date.now());
  const next = Math.min(
    expires,
    alignRetryAt,
    ...nextNotice,
    ...(costCheckAt > Date.now() ? [costCheckAt] : []),
    ...(checkAfterCharge > Date.now() ? [checkAfterCharge] : []),
    ...(zoneLeft ? [Date.now() + ZONE_RECHECK_DAYS * DAY] : []),
  );
  await release(db, tenantId, order.id, {
    next_attempt_at: new Date(Math.max(next, Date.now() + 60000)),
  });
}
/**
 * Once per registration period, within RENEWAL_COST_CHECK_DAYS of expiry:
 * the ending's current renewal cost (cached for a day, asked again when
 * older) against the renewal price the trainer pays. A cost whose price by
 * the order's rule is higher is recorded for operators before the charge;
 * the renewal itself still goes ahead. Premium names renew at their checked
 * premium price, which the registrar enforces, and are not compared here.
 */
async function checkRenewalCost(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  const period = iso(order.expires_at)?.slice(0, 10);
  if (
    !period ||
    !order.renewal_enabled ||
    premiumPrice(order, "renewUsd") ||
    order.evidence?.renewalCostCheckedFor === period
  )
    return;
  const registrar = registrarOf(deps, order);
  const tld = order.hostname.slice(order.hostname.indexOf(".") + 1);
  const price = (await pricesForSearch(db, registrar, [tld], () => true)).get(
    tld,
  );
  if (!price || price.kind !== "price") return;
  await db.tenant(workerActor(tenantId), async (tx) => {
    await mergeEvidence(tx, order.id, { renewalCostCheckedFor: period });
    if (costOverPrice(order, "renew", price.renewUsd))
      await recordCostAlert(tx, order, "renew_upcoming", price.renewUsd);
  });
}
/** Sends the grace notice due now before expiry (once per period and step). */
async function sendGraceNotice(db: Database, tenantId: string, order: Order) {
  const expires = Date.parse(order.expires_at);
  if (!Number.isFinite(expires) || expires <= Date.now()) return;
  const wa = workerActor(tenantId);
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
}
/**
 * A registered domain whose DNS is being set up (after purchase, a late
 * renewal, or an operator's re-run on a live domain) still expires on time:
 * at expiry it lapses as an active one would (mappings off, subscription
 * ended, zone kept for the release step), and a domain that was live keeps
 * getting its grace notices. True when the order was handled here.
 */
async function expiryBeforeDns(
  db: Database,
  tenantId: string,
  order: Order,
  deps: WebAddressDeps,
) {
  const expires = Date.parse(order.expires_at);
  if (!Number.isFinite(expires)) return false;
  if (expires > Date.now()) {
    if (order.live_at) await sendGraceNotice(db, tenantId, order);
    return false;
  }
  // A paid renewal invoice whose event was lost renews instead.
  if (
    order.renewal_status !== "failed" &&
    (await reconcileLatestInvoice(db, tenantId, order, deps))
  ) {
    await release(db, tenantId, order.id, { next_attempt_at: new Date() });
    return true;
  }
  if (order.renewal_status === "failed") {
    await retryLater(db, tenantId, order, "Paid renewal still failing", {
      attention:
        "The domain expired while a paid renewal is failing at the registrar; renew at the registrar and use Record registrar state.",
    });
    return true;
  }
  await lapse(db, tenantId, order, deps);
  return true;
}
/**
 * When a DNS step that waits for an operator is looked at again: at expiry
 * (so the domain still lapses on time), or never for a domain without one.
 */
function pausedUntil(order: Order) {
  const expires = Date.parse(order.expires_at);
  return Number.isFinite(expires) ? new Date(Math.max(expires, Date.now() + 60000)) : null;
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
      if (
        refund?.id &&
        Number(refund.amount) > 0 &&
        !["failed", "canceled"].includes(refund.status) &&
        !(await refundFailed(tx, refund.id))
      )
        await postRefund(tx, tenantId, current, {
          id: refund.id,
          amountMinor: Number(refund.amount),
          currency: refund.currency,
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
      case "zone":
      case "delegating":
      case "dns":
        if (renewalDue) await renew(db, tenantId, order, deps);
        else if (await expiryBeforeDns(db, tenantId, order, deps)) break;
        else if (order.status === "owned")
          await provisionDns(db, tenantId, order, deps);
        else if (order.status === "zone")
          await delegate(db, tenantId, order, deps);
        else if (order.status === "delegating")
          await verifyDelegation(db, tenantId, order, deps);
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
    if (error instanceof OrderRegistrarUnavailable)
      await retryLater(db, tenantId, order, "Registrar not configured", {
        attention: error.message,
        attempts: Number(order.attempts ?? 0),
        at: Date.now() + 3600000,
      }).catch(() => {});
    else await retryLater(db, tenantId, order, "Step failed", {
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
    let registrar: Registrar;
    try {
      registrar = registrarOf(deps, order);
    } catch (error) {
      if (error instanceof OrderRegistrarUnavailable)
        return { recorded: false, reason: error.message };
      throw error;
    }
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
    if (
      ["owned", "zone", "delegating", "dns", "active", "expired"].includes(
        order.status,
      )
    ) {
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
    const due = await db.tenant(workerActor(tenant.id), async (tx) => {
      // A release without the DNS host steps pauses orders in those
      // statuses (next_attempt_at NULL, no attention); pick them up again.
      await tx.query(
        "UPDATE domain_orders SET next_attempt_at=now() WHERE mode='automatic' AND status IN ('zone','delegating') AND next_attempt_at IS NULL AND attention IS NULL",
      );
      return tx.query<{ id: string }>(
        "SELECT id FROM domain_orders WHERE mode='automatic' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at LIMIT 5",
      );
    });
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
