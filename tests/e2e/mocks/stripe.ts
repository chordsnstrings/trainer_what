/**
 * Stateful Stripe double covering exactly the API surface the application
 * calls (see `grep -rn "stripe\." apps packages`), plus a correctly signed
 * webhook sender for the events the webhook route processes. Test-only.
 */
import { createHmac } from "node:crypto";
import {
  MockServer,
  bearer,
  randomId,
  unauthorized,
  type MockRequest,
  type MockResponse,
} from "./http.ts";

type Obj = Record<string, any>;
export type WebhookDelivery = {
  eventId: string;
  type: string;
  objectId: string;
  status: number;
  body: string;
  at: string;
};

const now = () => Math.floor(Date.now() / 1000);
/** One billing period of a price: a year for yearly prices, otherwise the mock's 30 days. */
const periodSeconds = (price: { recurring?: { interval?: string } | null }) =>
  price?.recurring?.interval === "year" ? 365 * 86400 : 30 * 86400;
const list = (data: Obj[], url: string, hasMore = false) => ({
  object: "list",
  data,
  has_more: hasMore,
  url,
});
const stripeError = (status: number, message: string, code?: string) => ({
  status,
  body: {
    error: {
      type: status === 404 ? "invalid_request_error" : "api_error",
      message,
      ...(code ? { code } : {}),
    },
  },
});
const num = (value: unknown) =>
  value === undefined || value === null || value === ""
    ? undefined
    : Number(value);

/** Stripe-Signature header for a raw payload (t=…,v1=HMAC-SHA256(secret, `${t}.${payload}`)). */
export function stripeSignature(payload: string, secret: string, time = now()) {
  const signature = createHmac("sha256", secret)
    .update(`${time}.${payload}`)
    .digest("hex");
  return `t=${time},v1=${signature}`;
}

export class StripeMock {
  readonly server: MockServer;
  readonly deliveries: WebhookDelivery[] = [];
  account = {
    id: "acct_mocksandbox0001",
    object: "account",
    charges_enabled: true,
    payouts_enabled: true,
    country: "AE",
    default_currency: "aed",
  };
  products = new Map<string, Obj>();
  prices = new Map<string, Obj>();
  coupons = new Map<string, Obj>();
  sessions = new Map<string, Obj>();
  customers = new Map<string, Obj>();
  subscriptions = new Map<string, Obj>();
  invoices = new Map<string, Obj>();
  paymentIntents = new Map<string, Obj>();
  charges = new Map<string, Obj>();
  refunds = new Map<string, Obj>();
  disputes = new Map<string, Obj>();
  portalConfigurations = new Map<string, Obj>();
  portalSessions = new Map<string, Obj>();
  private idempotent = new Map<string, MockResponse>();
  private invoiceNumber = 0;
  /** Where signed webhooks go (the platform URL of /api/v1/webhooks/stripe). */
  webhookUrl = "";
  /** When false, the harness sends events explicitly instead of automatically (lost webhooks). */
  autoWebhooks = true;
  /**
   * API version stamped on events. From 2022-11-15 Stripe no longer embeds a
   * charge's refunds in charge.* events; an older endpoint version gets them.
   */
  webhookApiVersion = "2025-09-30.clover";
  /** Requests that are applied but answered with an error: the response is lost on the way back. */
  private lostResponses: Array<{ method: string; path: RegExp; remaining: number }> = [];
  /**
   * The next `times` matching requests are applied (and cached for their
   * idempotency key) as usual, but the caller receives HTTP 500 with
   * Stripe-Should-Retry: false, so the SDK does not retry and the app has to
   * reconcile against the provider state.
   */
  loseNextResponse(method: string, path: RegExp, times = 1) {
    this.lostResponses.push({ method: method.toUpperCase(), path, remaining: times });
  }

  constructor(
    tlsMaterial: { key: string; cert: string },
    public secretKey: string,
    public webhookSecret: string,
  ) {
    this.server = new MockServer("stripe", tlsMaterial);
    this.routes();
  }
  get url() {
    return this.server.url;
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }

  private routes() {
    const s = this.server;
    const guard =
      (handler: (r: MockRequest) => MockResponse | Promise<MockResponse>) =>
      async (r: MockRequest) => {
        if (bearer(r) !== this.secretKey) return unauthorized();
        const key = r.headers["idempotency-key"];
        const cacheKey =
          r.method === "POST" && typeof key === "string"
            ? `${r.path}|${key}`
            : undefined;
        const response =
          cacheKey && this.idempotent.has(cacheKey)
            ? this.idempotent.get(cacheKey)!
            : await handler(r);
        if (cacheKey && (response.status ?? 200) < 500)
          this.idempotent.set(cacheKey, response);
        const lost = this.lostResponses.find(
          (f) => f.remaining > 0 && f.method === r.method && f.path.test(r.path),
        );
        if (lost) {
          lost.remaining--;
          return {
            status: 500,
            headers: { "request-id": randomId("req"), "stripe-should-retry": "false" },
            body: { error: { type: "api_error", message: "Mock: the request was applied but its response was lost" } },
          };
        }
        return response;
      };
    const ok = (body: unknown): MockResponse => ({
      status: 200,
      headers: { "request-id": randomId("req") },
      body,
    });
    const found = (map: Map<string, Obj>, id: string, what: string) => {
      const value = map.get(id);
      return value ? ok(value) : stripeError(404, `No such ${what}: '${id}'`, "resource_missing");
    };
    s.route("GET", "/v1/account", guard(() => ok(this.account)));
    s.route(
      "POST",
      "/v1/products",
      guard((r) => {
        const f = r.form ?? {};
        const product = {
          id: randomId("prod"),
          object: "product",
          name: f.name,
          description: f.description ?? null,
          metadata: f.metadata ?? {},
          active: true,
          created: now(),
        };
        this.products.set(product.id, product);
        return ok(product);
      }),
    );
    s.route(
      "POST",
      "/v1/prices",
      guard((r) => {
        const f = r.form ?? {};
        if (!this.products.has(f.product))
          return stripeError(400, "No such product", "resource_missing");
        const price = {
          id: randomId("price"),
          object: "price",
          product: f.product,
          currency: f.currency,
          unit_amount: num(f.unit_amount),
          recurring: f.recurring
            ? { interval: f.recurring.interval, interval_count: 1 }
            : null,
          type: f.recurring ? "recurring" : "one_time",
          active: true,
          created: now(),
        };
        this.prices.set(price.id, price);
        return ok(price);
      }),
    );
    s.route(
      "POST",
      "/v1/coupons",
      guard((r) => {
        const f = r.form ?? {};
        const id = f.id ?? randomId("coupon");
        if (this.coupons.has(id))
          return stripeError(400, "Coupon already exists", "resource_already_exists");
        const coupon = {
          id,
          object: "coupon",
          name: f.name ?? null,
          percent_off: num(f.percent_off) ?? null,
          duration: f.duration,
          applies_to: f.applies_to
            ? { products: [...(f.applies_to.products ?? [])] }
            : undefined,
          max_redemptions: num(f.max_redemptions) ?? null,
          redeem_by: num(f.redeem_by) ?? null,
          metadata: f.metadata ?? {},
          valid: true,
          times_redeemed: 0,
          created: now(),
        };
        this.coupons.set(id, coupon);
        return ok(coupon);
      }),
    );
    s.route("GET", "/v1/coupons/:id", guard((r) => found(this.coupons, r.params.id, "coupon")));
    s.route(
      "POST",
      "/v1/checkout/sessions",
      guard((r) => this.createSession(r.form ?? {})),
    );
    s.route(
      "GET",
      "/v1/checkout/sessions",
      guard((r) => {
        const f = r.form ?? {};
        const gte = num(f.created?.gte) ?? 0;
        let rows = [...this.sessions.values()]
          .filter((x) => x.created >= gte)
          .sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
        if (f.starting_after) {
          const at = rows.findIndex((x) => x.id === f.starting_after);
          rows = at >= 0 ? rows.slice(at + 1) : [];
        }
        const limit = num(f.limit) ?? 10;
        return ok(
          list(rows.slice(0, limit).map((x) => this.publicSession(x)), "/v1/checkout/sessions", rows.length > limit),
        );
      }),
    );
    s.route("GET", "/v1/checkout/sessions/:id", guard((r) => {
      const x = this.sessions.get(r.params.id);
      return x ? ok(this.publicSession(x)) : stripeError(404, "No such checkout.session", "resource_missing");
    }));
    s.route(
      "POST",
      "/v1/checkout/sessions/:id/expire",
      guard(async (r) => {
        const x = this.sessions.get(r.params.id);
        if (!x) return stripeError(404, "No such checkout.session", "resource_missing");
        if (x.status !== "open")
          return stripeError(400, "Only open sessions can be expired");
        x.status = "expired";
        this.later(() => this.sendEvent("checkout.session.expired", this.publicSession(x)));
        return ok(this.publicSession(x));
      }),
    );
    s.route("GET", "/v1/subscriptions/:id", guard((r) => found(this.subscriptions, r.params.id, "subscription")));
    s.route(
      "POST",
      "/v1/subscriptions/:id",
      guard((r) => {
        const sub = this.subscriptions.get(r.params.id);
        if (!sub) return stripeError(404, "No such subscription", "resource_missing");
        const f = r.form ?? {};
        if (f.cancel_at_period_end !== undefined)
          sub.cancel_at_period_end = f.cancel_at_period_end === "true";
        // A trial until a date moves the billing date (proration_behavior=none):
        // the current period ends then and the next invoice is issued then.
        const trialEnd = num(f.trial_end);
        if (trialEnd !== undefined) {
          if (trialEnd <= now())
            return stripeError(400, "trial_end must be in the future");
          sub.trial_end = trialEnd;
          sub.status = "trialing";
          sub.items.data[0].current_period_end = trialEnd;
        }
        this.later(() => this.sendEvent("customer.subscription.updated", sub));
        return ok(sub);
      }),
    );
    // subscriptions.cancel(): ends a subscription now (the voice add-on when
    // its membership ended). Canceling an already canceled one is a 400, as
    // Stripe does; the idempotency cache replays the first answer.
    s.route(
      "DELETE",
      "/v1/subscriptions/:id",
      guard((r) => {
        const sub = this.subscriptions.get(r.params.id);
        if (!sub) return stripeError(404, "No such subscription", "resource_missing");
        if (sub.status === "canceled")
          return stripeError(400, "This subscription is already canceled");
        sub.status = "canceled";
        sub.canceled_at = now();
        sub.cancel_at_period_end = false;
        this.later(() => this.sendEvent("customer.subscription.deleted", sub));
        return ok(sub);
      }),
    );
    s.route(
      "DELETE",
      "/v1/subscriptions/:id",
      guard((r) => {
        const sub = this.subscriptions.get(r.params.id);
        if (!sub) return stripeError(404, "No such subscription", "resource_missing");
        if (sub.status !== "canceled") {
          sub.status = "canceled";
          sub.canceled_at = now();
          this.later(() => this.sendEvent("customer.subscription.deleted", sub));
        }
        return ok(sub);
      }),
    );
    s.route(
      "GET",
      "/v1/invoices",
      guard((r) => {
        const f = r.form ?? {};
        let rows = [...this.invoices.values()]
          .filter((x) => !f.subscription || x.parent?.subscription_details?.subscription === f.subscription)
          .sort((a, b) => b.created - a.created);
        if (f.starting_after) {
          const at = rows.findIndex((x) => x.id === f.starting_after);
          rows = at >= 0 ? rows.slice(at + 1) : [];
        }
        const limit = num(f.limit) ?? 10;
        return ok(list(rows.slice(0, limit), "/v1/invoices", rows.length > limit));
      }),
    );
    s.route(
      "GET",
      "/v1/invoice_payments",
      guard((r) => {
        const f = r.form ?? {};
        const invoice = this.invoices.get(f.invoice);
        const expand = ([] as string[]).concat(f.expand ?? []);
        const rows = (invoice?.payments?.data ?? [])
          .filter((p: Obj) => !f.status || p.status === f.status)
          .map((p: Obj) =>
            expand.includes("data.payment.payment_intent") &&
            typeof p.payment?.payment_intent === "string"
              ? {
                  ...p,
                  payment: {
                    ...p.payment,
                    payment_intent: this.paymentIntents.get(p.payment.payment_intent),
                  },
                }
              : p,
          );
        return ok(list(rows, "/v1/invoice_payments"));
      }),
    );
    s.route("GET", "/v1/payment_intents/:id", guard((r) => found(this.paymentIntents, r.params.id, "payment_intent")));
    s.route(
      "GET",
      "/v1/refunds",
      guard((r) => {
        const f = r.form ?? {};
        const rows = [...this.refunds.values()].filter(
          (x) =>
            (!f.charge || x.charge === f.charge) &&
            (!f.payment_intent || x.payment_intent === f.payment_intent),
        );
        return ok(list(rows, "/v1/refunds"));
      }),
    );
    s.route("GET", "/v1/refunds/:id", guard((r) => found(this.refunds, r.params.id, "refund")));
    s.route(
      "POST",
      "/v1/refunds",
      guard((r) => {
        const f = r.form ?? {};
        const charge = f.charge
          ? this.charges.get(f.charge)
          : [...this.charges.values()].find((c) => c.payment_intent === f.payment_intent);
        if (!charge) return stripeError(404, "No such charge", "resource_missing");
        const amount = num(f.amount) ?? charge.amount - charge.amount_refunded;
        if (amount <= 0 || amount + charge.amount_refunded > charge.amount)
          return stripeError(400, "Refund amount exceeds the remaining charge", "amount_too_large");
        const refund = {
          id: randomId("re"),
          object: "refund",
          amount,
          currency: charge.currency,
          charge: charge.id,
          payment_intent: charge.payment_intent,
          status: "succeeded",
          metadata: f.metadata ?? {},
          created: now(),
        };
        this.refunds.set(refund.id, refund);
        charge.amount_refunded += amount;
        charge.refunded = charge.amount_refunded === charge.amount;
        charge.refunds.data.unshift(refund);
        this.later(async () => {
          await this.sendEvent("refund.created", refund);
          await this.sendEvent("charge.refunded", this.chargeEventObject(charge));
        });
        return ok(refund);
      }),
    );
    s.route(
      "POST",
      "/v1/billing_portal/configurations",
      guard((r) => {
        const config = {
          id: randomId("bpc"),
          object: "billing_portal.configuration",
          features: r.form?.features ?? {},
          business_profile: r.form?.business_profile ?? {},
          created: now(),
        };
        this.portalConfigurations.set(config.id, config);
        return ok(config);
      }),
    );
    s.route(
      "POST",
      "/v1/billing_portal/sessions",
      guard((r) => {
        const f = r.form ?? {};
        if (!this.customers.has(f.customer))
          return stripeError(404, "No such customer", "resource_missing");
        const session = {
          id: randomId("bps"),
          object: "billing_portal.session",
          customer: f.customer,
          configuration: f.configuration,
          flow: f.flow_data ?? null,
          return_url: f.return_url,
          url: "",
          created: now(),
        };
        session.url = `${this.url}/p/session/${session.id}`;
        this.portalSessions.set(session.id, session);
        return ok(session);
      }),
    );
    // Hosted pages a person could open by hand while the harness keeps the stack running.
    s.route("GET", "/c/pay/:id", (r) => {
      const x = this.sessions.get(r.params.id);
      return {
        status: x ? 200 : 404,
        headers: { "content-type": "text/html; charset=utf-8" },
        body: x
          ? `<!doctype html><title>Mock Stripe Checkout</title><h1>MOCK CHECKOUT (no real payment)</h1><p>${x.mode} · ${x.amount_total} ${x.currency}</p><form method="post" action="/c/pay/${x.id}/complete"><button>Pay with mock card</button></form>`
          : "Unknown mock checkout",
      };
    });
    s.route("POST", "/c/pay/:id/complete", async (r) => {
      await this.completeCheckout(r.params.id);
      const x = this.sessions.get(r.params.id)!;
      return { status: 303, headers: { location: x.success_url } };
    });
  }

  /** A checkout session as the API and events show it (without the mock's own bookkeeping). */
  publicSession(x: Obj) {
    const { subscription_data: _data, line_items: _items, ...rest } = x;
    return rest;
  }
  private createSession(f: Obj): MockResponse {
    const item = f.line_items?.[0] ?? {};
    let amount = 0;
    let priceId: string | undefined;
    if (typeof item.price === "string") {
      const price = this.prices.get(item.price);
      if (!price) return stripeError(400, "No such price", "resource_missing");
      priceId = price.id;
      amount = price.unit_amount;
    } else if (item.price_data) {
      amount = num(item.price_data.unit_amount) ?? 0;
      // Inline prices (price_data with product_data) become a price object,
      // as Stripe creates one for the subscription item.
      if (f.mode === "subscription" && item.price_data.recurring) {
        const product = {
          id: randomId("prod"),
          object: "product",
          name: item.price_data.product_data?.name ?? "Inline product",
          metadata: {},
          active: true,
          created: now(),
        };
        this.products.set(product.id, product);
        const price = {
          id: randomId("price"),
          object: "price",
          product: product.id,
          currency: item.price_data.currency,
          unit_amount: amount,
          recurring: { interval: item.price_data.recurring.interval, interval_count: 1 },
          type: "recurring",
          active: true,
          created: now(),
        };
        this.prices.set(price.id, price);
        priceId = price.id;
      }
    }
    // Stripe's amount_subtotal is before discounts; amount_total after them.
    const subtotal = amount;
    const couponId = f.discounts?.[0]?.coupon;
    if (couponId) {
      const coupon = this.coupons.get(couponId);
      if (!coupon) return stripeError(400, "No such coupon", "resource_missing");
      // As Stripe does: a coupon limited to products applies only to a price of one of them.
      const product = priceId ? this.prices.get(priceId)?.product : undefined;
      if (coupon.applies_to?.products && (!product || !coupon.applies_to.products.includes(product)))
        return stripeError(400, `The coupon ${couponId} cannot be applied to any of the items in this checkout`, "coupon_not_applicable");
      if (!coupon.valid || (coupon.redeem_by && coupon.redeem_by <= now()) || (coupon.max_redemptions && coupon.times_redeemed >= coupon.max_redemptions))
        return stripeError(400, `The coupon ${couponId} has expired or reached its redemption limit`, "coupon_expired");
      amount = Math.round(amount * (1 - (coupon.percent_off ?? 0) / 100));
    }
    const trialDays = num(f.subscription_data?.trial_period_days);
    const id = "cs_test_" + randomId("x").slice(2);
    const session = {
      id,
      object: "checkout.session",
      livemode: false,
      mode: f.mode,
      status: "open",
      payment_status: "unpaid",
      url: `${this.url}/c/pay/${id}`,
      client_reference_id: f.client_reference_id ?? null,
      customer_email: f.customer_email ?? null,
      customer: (f.customer ?? null) as string | null,
      metadata: f.metadata ?? {},
      currency: f.line_items?.[0]?.price_data?.currency ?? "aed",
      amount_total: trialDays ? 0 : amount,
      amount_subtotal: subtotal,
      expires_at: num(f.expires_at) ?? now() + 3600,
      created: now(),
      subscription: null as string | null,
      payment_intent: null as string | null,
      success_url: f.success_url,
      cancel_url: f.cancel_url,
      discounts: couponId ? [{ coupon: couponId }] : [],
      subscription_data: {
        metadata: f.subscription_data?.metadata ?? {},
        trialDays,
        priceId,
        amount,
      },
      line_items: f.line_items,
      payment_intent_data: f.payment_intent_data ?? null,
    };
    this.sessions.set(id, session);
    return { status: 200, body: this.publicSession(session) };
  }

  private later(task: () => Promise<unknown> | unknown) {
    if (!this.autoWebhooks) return;
    setTimeout(() => {
      Promise.resolve()
        .then(task)
        .catch(() => {});
    }, 25);
  }

  /**
   * A charge as a charge.* event carries it for the event's API version: the
   * refunds list only before 2022-11-15.
   */
  chargeEventObject(charge: Obj, apiVersion = this.webhookApiVersion) {
    if (apiVersion < "2022-11-15") return charge;
    const { refunds: _refunds, ...rest } = charge;
    return rest;
  }
  /** Posts a signed event to the application webhook and records the outcome. */
  async sendEvent(type: string, object: Obj, options: { created?: number; apiVersion?: string } = {}) {
    const event = {
      id: randomId("evt"),
      object: "event",
      api_version: options.apiVersion ?? this.webhookApiVersion,
      created: options.created ?? now(),
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type,
      data: { object: JSON.parse(JSON.stringify(object)) },
    };
    const payload = JSON.stringify(event);
    let status = 0,
      body = "";
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": stripeSignature(payload, this.webhookSecret),
          "user-agent": "Stripe/1.0 (+https://stripe.com/docs/webhooks) mock",
        },
        body: payload,
        signal: AbortSignal.timeout(30000),
      });
      status = response.status;
      body = (await response.text()).slice(0, 2000);
    } catch (error) {
      body = (error as Error).message;
    }
    const delivery = {
      eventId: event.id,
      type,
      objectId: object.id,
      status,
      body,
      at: new Date().toISOString(),
    };
    this.deliveries.push(delivery);
    this.payloads.set(event.id, payload);
    return delivery;
  }
  /** Raw payloads of delivered events, for redelivery and signature checks. */
  readonly payloads = new Map<string, string>();
  /** Posts a stored event again, optionally signed with another secret (not recorded as a delivery). */
  async redeliver(eventId: string, secret = this.webhookSecret) {
    const payload = this.payloads.get(eventId);
    if (!payload) throw new Error("Unknown delivered event " + eventId);
    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": stripeSignature(payload, secret) },
      body: payload,
      signal: AbortSignal.timeout(30000),
    });
    return { status: response.status, body: (await response.text()).slice(0, 2000) };
  }

  private chargeFor(amount: number, customer: string | null, metadata: Obj = {}) {
    const pi = {
      id: randomId("pi"),
      object: "payment_intent",
      amount,
      currency: "aed",
      status: "succeeded",
      customer,
      latest_charge: "",
      metadata,
      created: now(),
    };
    const charge = {
      id: randomId("ch"),
      object: "charge",
      amount,
      amount_refunded: 0,
      refunded: false,
      currency: "aed",
      paid: true,
      status: "succeeded",
      customer,
      payment_intent: pi.id,
      metadata,
      refunds: { object: "list", data: [] as Obj[], has_more: false },
      created: now(),
    };
    pi.latest_charge = charge.id;
    this.paymentIntents.set(pi.id, pi);
    this.charges.set(charge.id, charge);
    return { pi, charge };
  }

  private issueInvoice(sub: Obj, amount: number, paid: boolean) {
    const periodEnd = sub.items.data[0].current_period_end;
    const payment =
      paid && amount > 0 ? this.chargeFor(amount, sub.customer) : undefined;
    const created = now();
    const invoice = {
      id: randomId("in"),
      object: "invoice",
      livemode: false,
      status: paid ? "paid" : "open",
      amount_paid: paid ? amount : 0,
      amount_due: amount,
      currency: "aed",
      number: `MOCK-${String(++this.invoiceNumber).padStart(4, "0")}`,
      customer: sub.customer,
      created,
      hosted_invoice_url: `https://invoice.stripe.com/i/mock_${created}`,
      invoice_pdf: `https://pay.stripe.com/invoice/mock_${created}/pdf`,
      metadata: {},
      status_transitions: { paid_at: paid ? created : null },
      lines: {
        object: "list",
        has_more: false,
        data: [
          {
            id: randomId("il"),
            object: "line_item",
            amount,
            currency: "aed",
            period: { start: sub.items.data[0].current_period_start, end: periodEnd },
            pricing: {
              type: "price_details",
              price_details: {
                price: sub.items.data[0].price.id,
                product: sub.items.data[0].price.product,
              },
            },
          },
        ],
      },
      parent: {
        type: "subscription_details",
        subscription_details: {
          subscription: sub.id,
          metadata: { ...sub.metadata },
        },
      },
      payments: {
        object: "list",
        has_more: false,
        data: payment
          ? [
              {
                id: randomId("inpay"),
                object: "invoice_payment",
                status: "paid",
                amount_paid: amount,
                payment: { type: "payment_intent", payment_intent: payment.pi.id },
              },
            ]
          : [],
      },
    };
    this.invoices.set(invoice.id, invoice);
    sub.latest_invoice = invoice.id;
    return { invoice, charge: payment?.charge };
  }

  /** Completes a hosted checkout as if the customer paid, then sends the webhooks Stripe would send. */
  async completeCheckout(sessionId: string) {
    const x = this.sessions.get(sessionId);
    if (!x) throw new Error("Unknown mock checkout " + sessionId);
    if (x.status !== "open") throw new Error("Checkout is not open: " + x.status);
    const customer = (x.customer && this.customers.get(x.customer)) || {
      id: x.customer ?? randomId("cus"),
      object: "customer",
      email: x.customer_email,
      created: now(),
    };
    this.customers.set(customer.id, customer);
    x.customer = customer.id;
    x.status = "complete";
    x.payment_status = "paid";
    for (const discount of x.discounts ?? []) {
      const coupon = this.coupons.get(discount.coupon);
      if (coupon) coupon.times_redeemed++;
    }
    const result: Obj = { session: x };
    if (x.mode === "subscription") {
      const price = this.prices.get(x.subscription_data.priceId)!;
      const start = now(),
        trialDays = x.subscription_data.trialDays;
      const end = start + (trialDays ? trialDays * 86400 : periodSeconds(price));
      const sub = {
        id: randomId("sub"),
        object: "subscription",
        livemode: false,
        status: trialDays ? "trialing" : "active",
        customer: customer.id,
        cancel_at_period_end: false,
        created: start,
        metadata: { ...x.subscription_data.metadata },
        trial_end: trialDays ? end : null,
        latest_invoice: null as string | null,
        items: {
          object: "list",
          has_more: false,
          data: [
            {
              id: randomId("si"),
              object: "subscription_item",
              quantity: 1,
              price: { id: price.id, object: "price", product: price.product, unit_amount: price.unit_amount, currency: "aed" },
              current_period_start: start,
              current_period_end: end,
            },
          ],
        },
      };
      this.subscriptions.set(sub.id, sub);
      x.subscription = sub.id;
      const { invoice, charge } = this.issueInvoice(sub, x.amount_total, true);
      result.subscription = sub;
      result.invoice = invoice;
      result.charge = charge;
      if (this.autoWebhooks) {
        result.deliveries = [
          await this.sendEvent("checkout.session.completed", this.publicSession(x)),
          await this.sendEvent("customer.subscription.created", sub),
          await this.sendEvent("invoice.paid", invoice),
        ];
      }
    } else {
      const { pi, charge } = this.chargeFor(
        x.amount_total,
        customer.id,
        x.payment_intent_data?.metadata ?? {},
      );
      x.payment_intent = pi.id;
      result.charge = charge;
      if (this.autoWebhooks)
        result.deliveries = [
          await this.sendEvent("checkout.session.completed", this.publicSession(x)),
        ];
    }
    return result;
  }

  /** Next billing period: a paid renewal invoice (or a failed one). */
  async renew(subscriptionId: string, options: { fail?: boolean } = {}) {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) throw new Error("Unknown subscription");
    const item = sub.items.data[0];
    item.current_period_start = item.current_period_end;
    item.current_period_end =
      item.current_period_end + periodSeconds(this.prices.get(item.price.id) ?? {});
    sub.trial_end = null;
    const { invoice, charge } = this.issueInvoice(sub, item.price.unit_amount, !options.fail);
    const deliveries = [];
    if (options.fail) {
      sub.status = "past_due";
      deliveries.push(await this.sendEvent("invoice.payment_failed", invoice));
      deliveries.push(await this.sendEvent("customer.subscription.updated", sub));
    } else {
      sub.status = "active";
      deliveries.push(await this.sendEvent("invoice.paid", invoice));
    }
    return { invoice, charge, deliveries };
  }

  /** Customer confirmed the portal flow: switch the single item to the requested price. */
  async confirmPortalUpdate(portalSessionId: string) {
    const session = this.portalSessions.get(portalSessionId);
    const flow = session?.flow?.subscription_update_confirm;
    if (!flow) throw new Error("Portal session has no update flow");
    const sub = this.subscriptions.get(flow.subscription)!;
    const price = this.prices.get(flow.items[0].price)!;
    const previous = sub.items.data[0].price.unit_amount;
    sub.items.data[0].price = { id: price.id, object: "price", product: price.product, unit_amount: price.unit_amount, currency: "aed" };
    const deliveries = [await this.sendEvent("customer.subscription.updated", sub)];
    let invoice;
    if (price.unit_amount > previous) {
      invoice = this.issueInvoice(sub, price.unit_amount - previous, true).invoice;
      deliveries.push(await this.sendEvent("invoice.paid", invoice));
    }
    return { subscription: sub, invoice, deliveries };
  }

  async cancelNow(subscriptionId: string) {
    const sub = this.subscriptions.get(subscriptionId)!;
    sub.status = "canceled";
    sub.canceled_at = now();
    return this.sendEvent("customer.subscription.deleted", sub);
  }

  async openDispute(chargeId: string) {
    const charge = this.charges.get(chargeId);
    if (!charge) throw new Error("Unknown charge");
    const dispute = {
      id: randomId("dp"),
      object: "dispute",
      amount: charge.amount,
      currency: "aed",
      charge: charge.id,
      payment_intent: charge.payment_intent,
      status: "needs_response",
      reason: "general",
      metadata: {},
      created: now(),
    };
    this.disputes.set(dispute.id, dispute);
    return { dispute, delivery: await this.sendEvent("charge.dispute.created", dispute) };
  }
  async closeDispute(disputeId: string, status: "won" | "lost") {
    const dispute = this.disputes.get(disputeId)!;
    dispute.status = status;
    return this.sendEvent("charge.dispute.closed", dispute);
  }
}
