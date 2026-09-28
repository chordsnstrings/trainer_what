// The autonomous domain flow (docs/features/web-addresses.md) end to end on
// PGlite: search and price, Stripe yearly checkout, the payment events, the
// worker's purchase with a stable intent, reconciliation of an unknown
// purchase, the complete DNS host set, DNS and HTTPS checks, activation,
// billing alignment, renewal (also after a lost answer), grace notices,
// lapse back to the subdomain, refund of a definitive failure, the ledger,
// the operator view and workspace isolation. The Namecheap double answers
// through the fixture transport; Stripe, DNS and HTTPS are local doubles.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, elevated, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import {
  costOverPrice,
  processWebAddressOrder,
  processWebAddressOrders,
  platformHosts,
  sameHostSet,
  type WebAddressDeps,
} from "../apps/api/src/web-address-orders.ts";
import {
  resetRegistrarBudget,
  searchDomains,
} from "../apps/api/src/web-addresses.ts";
import { financialStatement } from "../apps/api/src/finance-statements.ts";
import { tlsIssuancePermitted } from "../apps/api/src/host-operations.ts";
import { HOST_HEADERS, signHostRequest } from "../apps/api/src/host-routing.ts";
import { withIntegrationFixtureTransport } from "../packages/providers/src/integrations.ts";
import { NamecheapRegistrar } from "../packages/providers/src/registrar.ts";
import { NamecheapMock } from "./e2e/mocks/namecheap.ts";

const ROOT = "trainsyou.example";
const SERVER_IP = "203.0.113.7";
const secret = "synthetic-host-proof-key-with-32-bytes-minimum";
const account = {
  apiUser: "trainsyou",
  apiKey: "nc-fixture-key-0123456789",
  username: "trainsyou",
  clientIp: "1.2.3.4",
};
const settings: Record<string, string> = {
  PUBLIC_APP_URL: "http://localhost:3000",
  INTERNAL_PROXY_SECRET: secret,
  PLATFORM_ROOT_DOMAIN: ROOT,
  COMMERCE_APPROVED: "true",
  WEB_ADDRESS_PURCHASES_ENABLED: "true",
  WEB_ADDRESS_REGISTRAR: "namecheap",
  NAMECHEAP_API_USER: account.apiUser,
  NAMECHEAP_API_KEY: account.apiKey,
  NAMECHEAP_USERNAME: account.username,
  NAMECHEAP_CLIENT_IP: account.clientIp,
  NAMECHEAP_SANDBOX: "true",
  WEB_ADDRESS_REGISTRANT_FIRST_NAME: "Platform",
  WEB_ADDRESS_REGISTRANT_LAST_NAME: "Owner",
  WEB_ADDRESS_REGISTRANT_ORGANIZATION: "TrainsYou FZ-LLC",
  WEB_ADDRESS_REGISTRANT_ADDRESS: "1 Fixture Street",
  WEB_ADDRESS_REGISTRANT_CITY: "Dubai",
  WEB_ADDRESS_REGISTRANT_STATE: "Dubai",
  WEB_ADDRESS_REGISTRANT_POSTAL_CODE: "00000",
  WEB_ADDRESS_REGISTRANT_COUNTRY: "AE",
  WEB_ADDRESS_REGISTRANT_PHONE: "+971.501234567",
  WEB_ADDRESS_REGISTRANT_EMAIL: "domains@trainsyou.example",
  WEB_ADDRESS_TLDS: "com,net",
};
/**
 * The double's .com at the owner's rule (28 September 2026): registration
 * USD 10.46 (10.28 + 0.18 ICANN) → USD 19.99, renewal 16.06 → USD 24.99.
 */
const FIRST = 1999,
  RENEWAL = 2499,
  REGISTRAR_COST = 1046;
const saved = Object.fromEntries(
  Object.keys(settings).map((key) => [key, process.env[key]]),
);

/** Stripe double: records every call; idempotency keys replay. */
class FakeStripe {
  calls: Array<{ method: string; params: any; key?: string }> = [];
  sessions = new Map<string, any>();
  refundsMade: any[] = [];
  couponObjects = new Map<string, any>();
  /** Subscriptions and invoices as Stripe would return them (retrieve). */
  subs = new Map<string, any>();
  invoiceObjects = new Map<string, any>();
  sessionLivemode = false;
  failUpdates = 0;
  failCancels = 0;
  private replay = new Map<string, any>();
  private n = 0;
  private once<T>(key: string | undefined, make: () => T): T {
    if (key && this.replay.has(key)) return this.replay.get(key);
    const value = make();
    if (key) this.replay.set(key, value);
    return value;
  }
  checkout = {
    sessions: {
      create: async (params: any, options?: any) => {
        this.calls.push({
          method: "checkout.create",
          params,
          key: options?.idempotencyKey,
        });
        return this.once(options?.idempotencyKey, () => {
          const session = {
            id: "cs_test_" + ++this.n,
            object: "checkout.session",
            mode: params.mode,
            status: "open",
            url: "https://checkout.stripe.test/c/" + this.n,
            client_reference_id: params.client_reference_id,
            metadata: params.metadata,
            livemode: this.sessionLivemode,
            currency: params.line_items[0].price_data.currency,
            // The recurring price, one-time first-year lines, less a coupon.
            amount_total:
              params.line_items.reduce(
                (n: number, item: any) => n + item.price_data.unit_amount,
                0,
              ) -
              (this.couponObjects.get(params.discounts?.[0]?.coupon)
                ?.amount_off ?? 0),
          };
          this.sessions.set(session.id, session);
          return session;
        });
      },
      retrieve: async (id: string) => this.sessions.get(id),
      expire: async (id: string) => {
        this.calls.push({ method: "checkout.expire", params: { id } });
        const s = this.sessions.get(id);
        if (s) s.status = "expired";
        return s;
      },
    },
  };
  coupons = {
    create: async (params: any, options?: any) => {
      this.calls.push({
        method: "coupons.create",
        params,
        key: options?.idempotencyKey,
      });
      return this.once(options?.idempotencyKey, () => {
        const coupon = {
          id: "coupon_" + ++this.n,
          object: "coupon",
          ...params,
        };
        this.couponObjects.set(coupon.id, coupon);
        return coupon;
      });
    },
  };
  subscriptions = {
    retrieve: async (id: string) =>
      this.subs.get(id) ?? { id, status: "active", livemode: false },
    update: async (id: string, params: any, options?: any) => {
      this.calls.push({
        method: "subscriptions.update",
        params: { id, ...params },
        key: options?.idempotencyKey,
      });
      if (this.failUpdates > 0) {
        this.failUpdates--;
        throw new Error("Stripe is unavailable");
      }
      return { id, ...params };
    },
    cancel: async (id: string, params?: any, options?: any) => {
      this.calls.push({
        method: "subscriptions.cancel",
        params: { id },
        key: options?.idempotencyKey,
      });
      if (this.failCancels > 0) {
        this.failCancels--;
        throw new Error("Stripe is unavailable");
      }
      return { id, status: "canceled" };
    },
  };
  invoices = {
    retrieve: async (id: string) => this.invoiceObjects.get(id),
  };
  refunds = {
    list: async (params: any) => ({
      data: this.refundsMade.filter(
        (r) => r.payment_intent === params.payment_intent,
      ),
    }),
    create: async (params: any, options?: any) => {
      this.calls.push({
        method: "refunds.create",
        params,
        key: options?.idempotencyKey,
      });
      return this.once(options?.idempotencyKey, () => {
        const refund = {
          id: "re_" + ++this.n,
          object: "refund",
          amount: FIRST,
          currency: "usd",
          status: "succeeded",
          payment_intent: params.payment_intent,
          metadata: params.metadata,
        };
        this.refundsMade.push(refund);
        return refund;
      });
    },
  };
  paymentIntents = {
    retrieve: async (id: string) => ({ id, latest_charge: "ch_" + id }),
  };
  invoicePayments = { list: async () => ({ data: [] }) };
  count(method: string) {
    return this.calls.filter((c) => c.method === method).length;
  }
}

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const mock = new NamecheapMock({ key: "unused", cert: "unused" }, account);
const stripe = new FakeStripe();
const dns = new Map<string, string[]>();
const httpsChecks: string[] = [];
let httpsFails = false;
/** Holds the next request for one registrar command until released (a request in flight). */
let gate: {
  command: string;
  entered: () => void;
  wait: Promise<void>;
} | null = null;
function holdNext(command: string) {
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((r) => (entered = r));
  gate = { command, entered, wait: new Promise<void>((r) => (release = r)) };
  return { reached, release };
}
const registrarTransport = async (url: string, init: RequestInit) => {
  const command = new URLSearchParams(String(init.body ?? ""))
    .get("Command")
    ?.replace(/^namecheap\./, "");
  if (gate && command === gate.command) {
    const held = gate;
    gate = null;
    held.entered();
    await held.wait;
  }
  return mock.fetch(url, init);
};
const deps: WebAddressDeps = {
  // An explicit test transport: nothing can leave the process.
  registrar: new NamecheapRegistrar(
    { ...account, sandbox: true },
    { transport: registrarTransport },
  ),
  // Lost answers are reconciled at once here; the settle window has its own test.
  settleMs: 0,
  stripe: stripe as any,
  resolve4: async (name) => {
    const answer = dns.get(name);
    if (!answer)
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return answer;
  },
  httpsCheck: async (name) => {
    httpsChecks.push(name);
    if (httpsFails) throw new Error("TLS handshake failed");
  },
  targetIpv4: async () => SERVER_IP,
};
// Namecheap's name servers publish what setHosts writes.
mock.onHosts = (domain, hosts) => {
  for (const host of hosts)
    if (host.type === "A")
      dns.set(host.name === "@" ? domain : host.name + "." + domain, [
        host.address,
      ]);
};
const inRegistrar = <T>(fn: () => Promise<T>) =>
  withIntegrationFixtureTransport(mock.fetch, fn);

function request(
  path: string,
  options: {
    method?: string;
    payload?: any;
    cookie?: string;
    host?: string;
  } = {},
) {
  const url = "/api/v1" + path,
    method = options.method ?? "GET",
    time = String(Date.now());
  return app.inject({
    url,
    method: method as any,
    payload: options.payload,
    headers: {
      host: "localhost:4000",
      origin: options.host
        ? "https://" + options.host
        : "http://localhost:3000",
      ...(options.host
        ? {
            [HOST_HEADERS.host]: options.host,
            [HOST_HEADERS.time]: time,
            [HOST_HEADERS.signature]: signHostRequest(
              options.host,
              method,
              url,
              time,
              secret,
            ),
          }
        : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
  });
}
async function register(slug: string) {
  const r = await request("/auth/register", {
    method: "POST",
    payload: {
      name: "Fixture " + slug,
      email: slug + "@orders-fixture.test",
      password: "FixturePassword2026!",
      slug,
      accepted: true,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const user = (await request("/bootstrap", { cookie })).json().user;
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id=$1", [user.tenantId]),
  );
  return { ...user, cookie, slug };
}
const worker = (tenantId: string) =>
  elevated("worker", { tenantId, role: "owner" });
async function order(tenantId: string, id: string) {
  const [row] = await db.tenant(worker(tenantId), (tx) =>
    tx.query("SELECT * FROM domain_orders WHERE id=$1", [id]),
  );
  return row;
}
async function operations(tenantId: string, id: string) {
  return db.tenant(worker(tenantId), (tx) =>
    tx.query(
      "SELECT kind,intent_key,status,cost_usd FROM registrar_operations WHERE order_id=$1 ORDER BY created_at,id",
      [id],
    ),
  );
}
/** Makes the order due now and runs one worker step for it. */
async function step(tenantId: string, id: string) {
  await db.tenant(worker(tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET next_attempt_at=now(),lease_until=NULL WHERE id=$1",
      [id],
    ),
  );
  await inRegistrar(() => processWebAddressOrder(db, tenantId, id, deps));
  return order(tenantId, id);
}
let eventNumber = 0;
const stripeEvent = (
  type: string,
  object: any,
  options: { livemode?: boolean; created?: number } = {},
) =>
  processStripeEvent(
    db,
    {
      id: "evt_fixture_" + ++eventNumber,
      type,
      livemode: options.livemode ?? false,
      created: options.created ?? Math.floor(Date.now() / 1000),
      data: { object },
    },
    { stripe: stripe as any },
  );
const metadata = (o: any) => ({
  purpose: "web_address",
  tenant_id: o.tenant_id,
  web_address_order_id: o.id,
});
function invoice(
  o: any,
  id: string,
  amount: number,
  sub: string,
  pi: string,
  currency = "usd",
) {
  return {
    id,
    object: "invoice",
    status: "paid",
    currency,
    amount_paid: amount,
    customer: "cus_" + o.tenant_id.slice(0, 8),
    payment_intent: pi,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: sub, metadata: metadata(o) },
    },
  };
}
async function buy(
  owner: any,
  domain: string,
  options: { livemode?: boolean; first?: number; renewal?: number } = {},
) {
  resetRegistrarBudget();
  const price = options.first ?? FIRST;
  const created = await inRegistrar(() =>
    request("/web-address/orders", {
      method: "POST",
      cookie: owner.cookie,
      payload: {
        domain,
        firstYearPriceMinor: price,
        renewalPriceMinor: options.renewal ?? RENEWAL,
        currency: "USD",
        accepted: true,
      },
    }),
  );
  assert.equal(created.statusCode, 200, created.body);
  const o = await order(owner.tenantId, created.json().orderId);
  const sub = "sub_" + o.id.slice(0, 8);
  await stripeEvent("checkout.session.completed", {
    id: o.checkout_session_id,
    object: "checkout.session",
    mode: "subscription",
    status: "complete",
    client_reference_id: o.id,
    metadata: metadata(o),
    subscription: sub,
    customer: "cus_" + o.tenant_id.slice(0, 8),
  });
  await stripeEvent(
    "invoice.paid",
    invoice(
      o,
      "in_first_" + o.id.slice(0, 8),
      price,
      sub,
      "pi_first_" + o.id.slice(0, 8),
    ),
    { livemode: options.livemode },
  );
  return { id: o.id as string, sub };
}
async function notices(tenantId: string) {
  return db.tenant(worker(tenantId), (tx) =>
    tx.query<{ dedupe_key: string; title: string; body: string }>(
      "SELECT dedupe_key,title,body FROM notifications WHERE dedupe_key LIKE 'web-address:%' ORDER BY created_at,dedupe_key",
    ),
  );
}
async function journals(tenantId: string) {
  return db.tenant(
    elevated("provider-callback", { tenantId, role: "finance" }),
    (tx) =>
      tx.query(
        "SELECT j.source_key,j.currency,l.account,l.amount_minor::int AS amount FROM journals j JOIN journal_lines l ON l.journal_id=j.id AND l.tenant_id=j.tenant_id ORDER BY j.created_at,j.source_key,l.account",
      ),
  );
}

let layla: any, omar: any, sara: any, admin: any;
let laylaOrder: { id: string; sub: string };
let saraOrder: { id: string; sub: string };
before(async () => {
  Object.assign(process.env, settings);
  resetRegistrarBudget();
  db = await createDatabase({ memory: true });
  app = await buildApp({
    db,
    testing: true,
    providers: { webAddresses: deps },
  });
  layla = await register("layla");
  omar = await register("omar");
  sara = await register("sara");
  admin = await register("ops-admin");
  await db.system(async (tx) => {
    await tx.query("UPDATE users SET platform_role='admin' WHERE id=$1", [
      admin.userId,
    ]);
    await tx.query("UPDATE sessions SET mfa_at=now() WHERE user_id=$1", [
      admin.userId,
    ]);
  });
});
after(async () => {
  await app?.close();
  await db?.close();
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

test("search shows the USD first-year and renewal price; a changed price is refused", async () => {
  mock.taken.add("layla.net");
  const found = await inRegistrar(() =>
    request("/web-address/search?q=layla", { cookie: layla.cookie }),
  );
  assert.equal(found.statusCode, 200, found.body);
  // .com: registration 10.28 + 0.18 USD → 19.99, renewal 15.88 + 0.18 →
  // 24.99 (cost rounded up to USD 5, plus 4.99). .net is taken.
  assert.deepEqual(found.json(), {
    requested: { domain: "layla.com", status: "available" },
    results: [
      {
        domain: "layla.com",
        available: true,
        premium: false,
        firstYearPriceMinor: FIRST,
        renewalPriceMinor: RENEWAL,
        currency: "USD",
        renewsYearly: true,
      },
    ],
    incomplete: false,
    currency: "USD",
    priceCapMinor: 10000,
  });
  // The typed name shows as taken; the other ending is offered.
  const taken = await inRegistrar(() =>
    request("/web-address/search?q=layla.net", { cookie: layla.cookie }),
  );
  assert.deepEqual(taken.json().requested, {
    domain: "layla.net",
    status: "taken",
  });
  assert.deepEqual(
    taken.json().results.map((r: any) => r.domain),
    ["layla.com"],
  );
  const underRoot = await inRegistrar(() =>
    request("/web-address/search?q=x." + ROOT, { cookie: layla.cookie }),
  );
  assert.equal(underRoot.statusCode, 400);
  const changed = await inRegistrar(() =>
    request("/web-address/orders", {
      method: "POST",
      cookie: layla.cookie,
      payload: {
        domain: "layla.com",
        firstYearPriceMinor: 7000,
        renewalPriceMinor: 7000,
        accepted: true,
      },
    }),
  );
  assert.equal(changed.statusCode, 409);
  assert.deepEqual(
    {
      code: changed.json().code,
      firstYearPriceMinor: changed.json().firstYearPriceMinor,
      renewalPriceMinor: changed.json().renewalPriceMinor,
    },
    {
      code: "PRICE_CHANGED",
      firstYearPriceMinor: FIRST,
      renewalPriceMinor: RENEWAL,
    },
  );
  assert.equal(
    stripe.count("checkout.create"),
    0,
    "no checkout without the shown price",
  );
});

test("pay, buy, set DNS, verify, activate: the trainer's own domain goes live", async () => {
  laylaOrder = await buy(layla, "layla.com");
  const checkout = stripe.calls.find((c) => c.method === "checkout.create")!;
  assert.equal(checkout.key, "web-address-checkout:" + laylaOrder.id);
  // USD 24.99 a year; the first invoice is brought down to USD 19.99 by a
  // once-only coupon, so Checkout shows both prices.
  assert.deepEqual(checkout.params.line_items, [
    {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: RENEWAL,
        recurring: { interval: "year" },
        product_data: { name: "Custom web address — yearly" },
      },
    },
  ]);
  const coupon = stripe.calls.find((c) => c.method === "coupons.create")!;
  assert.equal(coupon.key, "web-address-first-year:" + laylaOrder.id);
  assert.deepEqual(
    {
      amount_off: coupon.params.amount_off,
      currency: coupon.params.currency,
      duration: coupon.params.duration,
      max_redemptions: coupon.params.max_redemptions,
      name: coupon.params.name,
    },
    {
      amount_off: RENEWAL - FIRST,
      currency: "usd",
      duration: "once",
      max_redemptions: 1,
      name: "Custom web address — first-year price",
    },
  );
  assert.equal(
    checkout.params.discounts[0].coupon,
    stripe.couponObjects.values().next().value.id,
  );
  const session = stripe.sessions.values().next().value;
  assert.equal(session.amount_total, FIRST, "USD 19.99 due today");
  // Both prices again above Stripe's pay button, with the renewal note
  // (owner decision, 28 September 2026: trainers know before paying).
  assert.deepEqual(checkout.params.custom_text, {
    submit: {
      message:
        "First year USD 19.99 today, then USD 24.99 every year, renewed automatically until you turn renewal off in Web address. Note: the yearly renewal (USD 24.99) is USD 5.00 more than the first year (USD 19.99).",
    },
  });
  assert.equal(checkout.params.metadata.purpose, "web_address");
  // Neutral Stripe wording: never the registrar (owner decision, 28 Sep 2026).
  assert.equal(
    checkout.params.line_items[0].price_data.product_data.name,
    "Custom web address — yearly",
  );
  assert.equal(
    checkout.params.subscription_data.description,
    "Custom web address — yearly: layla.com",
  );
  // The trainer's answers carry no registrar name or cost.
  for (const path of ["/web-address", `/web-address/orders/${laylaOrder.id}`]) {
    const r = await request(path, { cookie: layla.cookie });
    assert.equal(r.statusCode, 200, r.body);
    assert.doesNotMatch(
      r.body,
      /namecheap|registrar|registerUsd|renewUsd|usdToAed|marginAed|cost/i,
      path,
    );
  }
  let o = await order(layla.tenantId, laylaOrder.id);
  assert.equal(o.status, "paid");
  assert.equal(o.stripe_subscription_id, laylaOrder.sub);
  // The member subscription path never saw these events.
  const [member] = await db.tenant(worker(layla.tenantId), (tx) =>
    tx.query("SELECT count(*)::int AS n FROM subscriptions"),
  );
  assert.equal(member.n, 0);

  o = await step(layla.tenantId, laylaOrder.id);
  assert.equal(o.status, "owned");
  assert.equal(mock.commands("domains.create").length, 1);
  assert.equal(mock.registrations.get("layla.com")?.whoisguard, true);
  assert.deepEqual(
    (await operations(layla.tenantId, laylaOrder.id)).map((op) => [
      op.kind,
      op.intent_key,
      op.status,
    ]),
    [["register", `register:${laylaOrder.id}:1`, "succeeded"]],
  );

  o = await step(layla.tenantId, laylaOrder.id);
  assert.equal(o.status, "dns");
  // One setHosts call with the complete set: the parking records are gone.
  assert.equal(mock.commands("domains.dns.setHosts").length, 1);
  const written = mock.registrations.get("layla.com")!.hosts;
  assert.ok(sameHostSet(written as any, platformHosts(SERVER_IP)));

  // DNS not visible yet: stays in dns and retries later.
  const published = dns.get("www.layla.com");
  dns.delete("www.layla.com");
  o = await step(layla.tenantId, laylaOrder.id);
  assert.equal(o.status, "dns");
  dns.set("www.layla.com", published!);
  httpsFails = true;
  o = await step(layla.tenantId, laylaOrder.id);
  assert.equal(o.status, "dns", "no activation before HTTPS works");
  assert.ok(
    await tlsIssuancePermitted(db, "layla.com", Date.now() + 60000),
    "issuance allowance for the check",
  );
  httpsFails = false;
  o = await step(layla.tenantId, laylaOrder.id);
  assert.equal(o.status, "active");
  assert.ok(
    httpsChecks.includes("layla.com") && httpsChecks.includes("www.layla.com"),
  );
  assert.deepEqual(
    o.progress
      .map((p: any) => p.step)
      .filter((s: string) =>
        ["paid", "registered", "dns", "certificate", "live"].includes(s),
      ),
    ["paid", "registered", "dns", "certificate", "live"],
  );
  const mapped = await request("/public/host", { host: "layla.com" });
  assert.equal(mapped.json().tenantId, layla.tenantId);
  assert.equal(
    (await request("/public/host", { host: "www.layla.com" })).json().tenantId,
    layla.tenantId,
  );
  const live = (await notices(layla.tenantId)).find((n) =>
    n.dedupe_key.endsWith(":live"),
  );
  assert.ok(live);
  // The renewal price, and the note that it is dearer than the first year.
  assert.match(
    live.body,
    /renews every year at USD 24\.99; the next renewal is before \d{4}-\d{2}-\d{2}\./,
  );
  assert.match(
    live.body,
    /Note: the yearly renewal \(USD 24\.99\) is USD 5\.00 more than the first year \(USD 19\.99\)\.$/,
  );

  // The next visit moves the yearly charge to 30 days before expiry.
  o = await step(layla.tenantId, laylaOrder.id);
  const align = stripe.calls.find(
    (c) => c.method === "subscriptions.update" && c.params.trial_end,
  );
  assert.ok(align, "billing aligned");
  assert.equal(align!.params.proration_behavior, "none");
  assert.equal(
    align!.params.trial_end,
    Math.floor((Date.parse(o.expires_at) - 30 * 86400000) / 1000),
  );
  assert.ok(o.billing_aligned_at);

  // Ledger: the payment and the registrar cost, never the trainer's payable.
  const lines = await journals(layla.tenantId);
  assert.deepEqual(
    lines
      .filter((l) => l.source_key.startsWith("web-address-invoice:"))
      .map((l) => [l.account, l.amount]),
    [
      ["web_address_receivable", FIRST],
      ["web_address_revenue", -FIRST],
    ],
  );
  // The registrar's own USD charge, recorded as it is (USD journals).
  assert.deepEqual(
    lines
      .filter((l) => l.source_key.startsWith("web-address-registrar:"))
      .map((l) => [l.account, l.amount]),
    [
      ["registrar_cost", REGISTRAR_COST],
      ["registrar_prepaid", -REGISTRAR_COST],
    ],
  );
  assert.deepEqual(
    [
      ...new Set(
        lines
          .filter((l) => l.source_key.startsWith("web-address-"))
          .map((l) => l.currency),
      ),
    ],
    ["USD"],
    "web address journals are in USD",
  );
  assert.ok(
    !lines.some((l) =>
      ["trainer_payable", "platform_commission", "stripe_receivable"].includes(
        l.account,
      ),
    ),
  );
  const period = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const finance = elevated("provider-callback", {
    tenantId: layla.tenantId,
    role: "finance",
  });
  const statement = await db.tenant(finance, (tx) =>
    financialStatement(tx, period, { platformView: true }),
  );
  assert.deepEqual(statement.webAddresses, {
    currency: "USD",
    paymentsMinor: FIRST,
    refundsMinor: 0,
    registrarCostMinor: REGISTRAR_COST,
  });
  // The trainer's own statement does not show the platform's registrar cost.
  const own = await db.tenant(finance, (tx) => financialStatement(tx, period));
  assert.deepEqual(own.webAddresses, {
    currency: "USD",
    paymentsMinor: FIRST,
    refundsMinor: 0,
  });
  // USD amounts never enter the AED balances (or the trainer's payable).
  const summary = own.current as any;
  assert.equal(summary.accounts.web_address_receivable, undefined);
  assert.equal(summary.otherCurrencies.USD.web_address_receivable, FIRST);
  assert.ok(
    !own.entries.some((e: any) =>
      e.source_key.startsWith("web-address-registrar:"),
    ),
  );
  assert.equal(statement.totals.grossMinor, 0, "not subscriber revenue");
  assert.equal(statement.totals.commissionMinor, 0, "no commission");

  // The trainer's view.
  const view = await request("/web-address/orders/" + laylaOrder.id, {
    cookie: layla.cookie,
  });
  assert.equal(view.json().status, "active");
  assert.equal(view.json().needsReview, false);
});

test("a lost purchase answer is reconciled with getList before anything else; no second purchase", async () => {
  const o = await buy(omar, "omar-coach.com");
  mock.loseNextResponse("domains.create");
  let row = await step(omar.tenantId, o.id);
  assert.equal(row.status, "purchasing");
  assert.deepEqual(
    (await operations(omar.tenantId, o.id)).map((op) => op.status),
    ["unknown"],
  );
  // The database refuses another purchase attempt while one is unreconciled.
  await assert.rejects(
    db.tenant(worker(omar.tenantId), (tx) =>
      tx.query(
        "INSERT INTO registrar_operations(id,tenant_id,order_id,kind,intent_key,registrar,hostname,created_by) VALUES($1,$2,$3,'register',$4,'namecheap','omar-coach.com',$5)",
        [
          randomUUID(),
          omar.tenantId,
          o.id,
          "register:" + o.id + ":2",
          randomUUID(),
        ],
      ),
    ),
    /reconcile the earlier registrar register attempt/,
  );
  row = await step(omar.tenantId, o.id);
  assert.equal(row.status, "owned");
  assert.equal(
    mock
      .commands("domains.create")
      .filter((c) => c.params.DomainName === "omar-coach.com").length,
    1,
  );
  assert.ok(
    mock
      .commands("domains.getList")
      .some((c) => c.params.SearchTerm === "omar-coach.com"),
  );
  assert.deepEqual(
    (await operations(omar.tenantId, o.id)).map((op) => [
      op.intent_key,
      op.status,
    ]),
    [[`register:${o.id}:1`, "confirmed"]],
  );
  // Evidence rows are immutable once finished.
  await assert.rejects(
    db.tenant(worker(omar.tenantId), (tx) =>
      tx.query(
        "UPDATE registrar_operations SET status='absent' WHERE order_id=$1",
        [o.id],
      ),
    ),
  );
});

test("a name taken before purchase ends in a refund and a notice; the subscription is cancelled", async () => {
  const o = await buy(sara, "sara-fit.com");
  saraOrder = o;
  mock.taken.add("sara-fit.com");
  let row = await step(sara.tenantId, o.id);
  assert.equal(row.status, "purchasing");
  assert.deepEqual(
    (await operations(sara.tenantId, o.id)).map((op) => op.status),
    ["failed"],
  );
  // Not ours (getList and getInfo) and not available: looked at once more
  // before concluding that someone else registered it.
  row = await step(sara.tenantId, o.id);
  assert.equal(row.status, "purchasing");
  assert.deepEqual(
    (await operations(sara.tenantId, o.id)).map((op) => op.status),
    ["failed"],
  );
  assert.ok(
    mock
      .commands("domains.getInfo")
      .some((c) => c.params.DomainName === "sara-fit.com"),
    "getInfo asked before refunding",
  );
  stripe.failCancels = 1;
  row = await step(sara.tenantId, o.id);
  assert.equal(row.status, "failed");
  assert.deepEqual(
    (await operations(sara.tenantId, o.id)).map((op) => op.status),
    ["absent"],
  );
  // The subscription cancel failed once: retried, not forgotten.
  assert.equal(row.evidence.cancelPending, true);
  assert.notEqual(row.billing_status, "canceled");
  assert.ok(row.next_attempt_at, "the cancel is retried");
  row = await step(sara.tenantId, o.id);
  assert.equal(row.billing_status, "canceled");
  assert.equal(row.evidence.cancelPending, false);
  const refund = stripe.calls.find(
    (c) =>
      c.method === "refunds.create" && c.key === "web-address-refund:" + o.id,
  );
  assert.ok(refund, "refunded with a stable key");
  assert.equal(refund!.params.payment_intent, "pi_first_" + o.id.slice(0, 8));
  assert.ok(
    stripe.calls.some(
      (c) => c.method === "subscriptions.cancel" && c.params.id === o.sub,
    ),
  );
  const lines = await journals(sara.tenantId);
  assert.deepEqual(
    lines
      .filter((l) => l.source_key.startsWith("web-address-refund:"))
      .map((l) => [l.account, l.amount]),
    [
      ["web_address_receivable", -FIRST],
      ["web_address_revenue", FIRST],
    ],
  );
  // Stripe's own refund event for the same refund posts nothing twice.
  await stripeEvent("refund.created", {
    ...stripe.refundsMade.at(-1),
    payment_intent: "pi_first_" + o.id.slice(0, 8),
  });
  assert.equal(
    (await journals(sara.tenantId)).filter((l) =>
      l.source_key.startsWith("web-address-refund:"),
    ).length,
    2,
  );
  assert.ok(
    (await notices(sara.tenantId)).some((n) =>
      n.dedupe_key.endsWith(":failed"),
    ),
  );
  // The name is free for a new order after the failure.
  mock.taken.delete("sara-fit.com");
  const again = await inRegistrar(() =>
    request("/web-address/orders", {
      method: "POST",
      cookie: sara.cookie,
      payload: {
        domain: "sara-fit.com",
        firstYearPriceMinor: FIRST,
        renewalPriceMinor: RENEWAL,
        accepted: true,
      },
    }),
  );
  assert.equal(again.statusCode, 200, again.body);
});

test("yearly renewal: the paid invoice renews at the registrar, a lost answer is reconciled", async () => {
  const before = await order(layla.tenantId, laylaOrder.id);
  await stripeEvent(
    "invoice.paid",
    invoice(before, "in_renew_1", RENEWAL, laylaOrder.sub, "pi_renew_1"),
  );
  let row = await order(layla.tenantId, laylaOrder.id);
  assert.equal(row.renewal_status, "paid");
  row = await step(layla.tenantId, laylaOrder.id);
  assert.equal(row.renewal_status, "renewed");
  assert.ok(
    Date.parse(row.expires_at) > Date.parse(before.expires_at) + 360 * 86400000,
  );
  assert.equal(mock.commands("domains.renew").length, 1);
  assert.ok(
    (await notices(layla.tenantId)).some((n) =>
      n.dedupe_key.includes(":renewed:"),
    ),
  );

  // Next year: the renewal answer is lost; getInfo proves it happened.
  await stripeEvent(
    "invoice.paid",
    invoice(row, "in_renew_2", RENEWAL, laylaOrder.sub, "pi_renew_2"),
  );
  mock.loseNextResponse("domains.renew");
  row = await step(layla.tenantId, laylaOrder.id);
  assert.notEqual(row.renewal_status, "renewed");
  const second = await step(layla.tenantId, laylaOrder.id);
  assert.equal(second.renewal_status, "renewed");
  assert.equal(
    mock.commands("domains.renew").length,
    2,
    "one registrar renewal per paid invoice",
  );
  const renewals = (await operations(layla.tenantId, laylaOrder.id)).filter(
    (op) => op.kind === "renew",
  );
  assert.deepEqual(
    renewals.map((op) => op.status),
    ["succeeded", "confirmed"],
  );
  const costs = (await journals(layla.tenantId)).filter(
    (l) =>
      l.source_key.startsWith("web-address-registrar:") &&
      l.account === "registrar_cost",
  );
  assert.equal(costs.length, 3, "registration and two renewals");
  // Duplicate delivery of a paid invoice changes nothing.
  await stripeEvent(
    "invoice.paid",
    invoice(row, "in_renew_2", RENEWAL, laylaOrder.sub, "pi_renew_2"),
  );
  assert.equal(
    (await order(layla.tenantId, laylaOrder.id)).renewal_status,
    "renewed",
  );
  // A late replay of last year's invoice neither reopens a renewal nor
  // moves the expiry back.
  const settled = await order(layla.tenantId, laylaOrder.id);
  await stripeEvent(
    "invoice.paid",
    invoice(row, "in_renew_1", RENEWAL, laylaOrder.sub, "pi_renew_1"),
  );
  const replayed = await order(layla.tenantId, laylaOrder.id);
  assert.equal(replayed.renewal_status, "renewed");
  assert.equal(replayed.renewal_invoice_id, "in_renew_2");
  assert.equal(
    new Date(replayed.expires_at).toISOString(),
    new Date(settled.expires_at).toISOString(),
  );
  row = await step(layla.tenantId, laylaOrder.id);
  assert.equal(
    mock.commands("domains.renew").length,
    2,
    "no renewal from a replayed invoice",
  );
});

test("two weeks before the yearly charge the trainer is told its date and price, once a period", async () => {
  // Renewed once already (above), so the first-year note is not repeated.
  const expires = new Date(Date.now() + 40 * 86400000);
  const charge = new Date(Date.now() + 10 * 86400000);
  await db.tenant(worker(layla.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET expires_at=$2,evidence=evidence||$3::jsonb WHERE id=$1",
      [
        laylaOrder.id,
        expires,
        JSON.stringify({ nextRenewalChargeAt: charge.toISOString() }),
      ],
    ),
  );
  await step(layla.tenantId, laylaOrder.id);
  await step(layla.tenantId, laylaOrder.id);
  const upcoming = (await notices(layla.tenantId)).filter((n) =>
    n.dedupe_key.includes(":upcoming:"),
  );
  assert.equal(upcoming.length, 1, "once per registration period");
  assert.equal(upcoming[0].title, "Your domain renews soon");
  assert.equal(
    upcoming[0].body,
    `On ${charge.toISOString().slice(0, 10)} we charge USD 24.99 to your card for another year of layla.com, renewed automatically. You can turn renewal off in Web address before that date.`,
  );
  const row = await order(layla.tenantId, laylaOrder.id);
  assert.ok(row.notices[`${expires.toISOString().slice(0, 10)}:upcoming`]);
  // More than two weeks before the charge nothing is sent yet, and the
  // worker comes back when it is due.
  const later = new Date(Date.now() + 80 * 86400000);
  await db.tenant(worker(layla.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET expires_at=$2,evidence=evidence||$3::jsonb WHERE id=$1",
      [
        laylaOrder.id,
        new Date(later.getTime() + 30 * 86400000),
        JSON.stringify({ nextRenewalChargeAt: later.toISOString() }),
      ],
    ),
  );
  const waiting = await step(layla.tenantId, laylaOrder.id);
  assert.equal(
    (await notices(layla.tenantId)).filter((n) =>
      n.dedupe_key.includes(":upcoming:"),
    ).length,
    1,
  );
  assert.ok(
    Date.parse(waiting.next_attempt_at) <=
      later.getTime() - 14 * 86400000 + 60000,
    "the worker returns when the notice is due",
  );
});

test("failed renewal payment: grace notices, then lapse back to the subdomain; renewal can be turned off", async () => {
  const row = await order(layla.tenantId, laylaOrder.id);
  await stripeEvent("invoice.payment_failed", {
    ...invoice(row, "in_failed_1", RENEWAL, laylaOrder.sub, "pi_failed_1"),
    status: "open",
    amount_paid: 0,
  });
  assert.equal(
    (await order(layla.tenantId, laylaOrder.id)).billing_status,
    "past_due",
  );
  assert.ok(
    (await notices(layla.tenantId)).some((n) =>
      n.dedupe_key.includes(":payment-failed:in_failed_1"),
    ),
  );

  const off = await request(`/web-address/orders/${laylaOrder.id}/renewal`, {
    method: "POST",
    cookie: layla.cookie,
    payload: { enabled: false },
  });
  assert.equal(off.statusCode, 200, off.body);
  assert.equal(off.json().renewalEnabled, false);
  assert.ok(
    stripe.calls.some(
      (c) =>
        c.method === "subscriptions.update" &&
        c.params.cancel_at_period_end === true,
    ),
  );

  // Five days left: the 7-day notice, once.
  await db.tenant(worker(layla.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET expires_at=now()+interval '5 days' WHERE id=$1",
      [laylaOrder.id],
    ),
  );
  await step(layla.tenantId, laylaOrder.id);
  await step(layla.tenantId, laylaOrder.id);
  const grace = (await notices(layla.tenantId)).filter((n) =>
    n.dedupe_key.includes(":grace:"),
  );
  assert.equal(grace.length, 1);
  assert.ok(grace[0].dedupe_key.endsWith(":7"));
  assert.match(grace[0].body, /https:\/\/layla\.trainsyou\.example/);

  // Expired: the domain stops, the subdomain keeps serving.
  await db.tenant(worker(layla.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [laylaOrder.id],
    ),
  );
  const lapsed = await step(layla.tenantId, laylaOrder.id);
  assert.equal(lapsed.status, "expired");
  assert.equal(
    (await request("/public/host", { host: "layla.com" })).statusCode,
    421,
  );
  assert.equal(
    (await request("/public/host", { host: "layla." + ROOT })).json().tenantId,
    layla.tenantId,
  );
  assert.ok(
    (await notices(layla.tenantId)).some((n) =>
      n.dedupe_key.includes(":lapsed:"),
    ),
  );
  assert.ok(
    stripe.calls.some(
      (c) =>
        c.method === "subscriptions.cancel" && c.params.id === laylaOrder.sub,
    ),
  );
});

test("isolation: owners see only their own orders; followers and trainers have no operator view", async () => {
  assert.equal(
    (
      await request("/web-address/orders/" + laylaOrder.id, {
        cookie: omar.cookie,
      })
    ).statusCode,
    404,
  );
  const own = await request("/web-address", { cookie: omar.cookie });
  assert.ok(own.json().orders.every((o: any) => o.hostname !== "layla.com"));
  assert.equal(
    (await request("/admin/web-addresses", { cookie: omar.cookie })).statusCode,
    403,
  );
  const [follower] = await db.system(async (tx) => {
    const id = randomUUID();
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Follower','x',true)",
      [id, "follower@orders-fixture.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [layla.tenantId, id],
    );
    return [id];
  });
  await assert.rejects(
    db
      .tenant(
        { tenantId: layla.tenantId, userId: follower, role: "subscriber" },
        (tx) => tx.query("SELECT * FROM registrar_operations"),
      )
      .then((rows) => {
        if (!rows.length) throw new Error("no rows");
      }),
    "a follower reads no registrar evidence",
  );
  const followerOrders = await db.tenant(
    { tenantId: layla.tenantId, userId: follower, role: "subscriber" },
    (tx) => tx.query("SELECT id FROM domain_orders"),
  );
  assert.equal(followerOrders.length, 0);
});

test("operator view lists every automatic order with reconciliation items and keeps manual fallbacks", async () => {
  const o = await buy(admin, "ops-coach.com");
  mock.loseNextResponse("domains.create");
  await step(admin.tenantId, o.id);
  const list = await request("/admin/web-addresses", { cookie: admin.cookie });
  assert.equal(list.statusCode, 200, list.body);
  const listed = list.json().orders.find((x: any) => x.id === o.id);
  assert.equal(listed.needsReconciliation, true);
  assert.ok(list.json().orders.some((x: any) => x.hostname === "layla.com"));
  assert.ok(list.json().attention >= 1);
  const refused = await request(`/admin/web-addresses/${o.id}/refund`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { reason: "Trainer asked to cancel the purchase" },
  });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().code, "RECONCILE_FIRST");
  const reconciled = await inRegistrar(() =>
    request(`/admin/web-addresses/${o.id}/reconcile`, {
      method: "POST",
      cookie: admin.cookie,
      payload: { reason: "Registrar answer was lost; reconcile now" },
    }),
  );
  assert.equal(reconciled.statusCode, 200, reconciled.body);
  assert.equal(reconciled.json().ran, true);
  assert.equal(reconciled.json().status, "owned");
  assert.equal(reconciled.json().needsReconciliation, false);
  // The whole worker entry point runs every due order of every workspace.
  await db.tenant(worker(admin.tenantId), (tx) =>
    tx.query("UPDATE domain_orders SET next_attempt_at=now() WHERE id=$1", [
      o.id,
    ]),
  );
  const run = await inRegistrar(() => processWebAddressOrders(db, deps));
  assert.ok(run.processed >= 1);
  assert.equal((await order(admin.tenantId, o.id)).status, "dns");
  // Manual routes do not act on automatic orders.
  const manual = await request("/admin/integrations/domains", {
    cookie: admin.cookie,
  });
  assert.ok(manual.json().every((x: any) => x.mode === "manual"));
});

test("an empty registrar balance stops after three reconciled attempts; an operator retry buys once", async () => {
  const owner = await register("nadia");
  const o = await buy(owner, "nadia-fit.com");
  const balance = mock.balance;
  mock.balance = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let row = await step(owner.tenantId, o.id);
    assert.equal(row.status, "purchasing");
    row = await step(owner.tenantId, o.id); // reconcile: absent, still available
    assert.equal(row.status, "purchasing");
  }
  const stuck = await order(owner.tenantId, o.id);
  assert.match(stuck.attention, /did not complete after 3 attempts/);
  assert.equal(
    stuck.next_attempt_at,
    null,
    "no fourth attempt without an operator",
  );
  assert.deepEqual(
    (await operations(owner.tenantId, o.id)).map((op) => [
      op.intent_key,
      op.status,
    ]),
    [1, 2, 3].map((n) => [`register:${o.id}:${n}`, "absent"]),
  );
  mock.balance = balance;
  const retried = await request(`/admin/web-addresses/${o.id}/retry`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { reason: "Registrar balance topped up; buy again" },
  });
  assert.equal(retried.statusCode, 200, retried.body);
  const bought = await step(owner.tenantId, o.id);
  assert.equal(bought.status, "owned");
  assert.equal(bought.attention, null);
  assert.equal(
    (await operations(owner.tenantId, o.id)).at(-1)!.intent_key,
    `register:${o.id}:4`,
    "a new intent key, never a reused one",
  );
  assert.equal(
    mock
      .commands("domains.create")
      .filter((c) => c.params.DomainName === "nadia-fit.com").length,
    4,
  );
});

const activate = async (tenantId: string, id: string) => {
  for (const expected of ["owned", "dns", "active"])
    assert.equal((await step(tenantId, id)).status, expected);
  // The next visit aligns the yearly charge.
  return step(tenantId, id);
};
const renewalOps = async (tenantId: string, id: string) =>
  (await operations(tenantId, id))
    .filter((op) => op.kind === "renew")
    .map((op) => op.status);
const sentFor = (command: string, domain: string) =>
  mock
    .commands(command)
    .filter(
      (c) => c.params.DomainName === domain || c.params.SearchTerm === domain,
    ).length;

test("an operator reconcile while a renewal request is in flight never renews twice", async () => {
  const owner = await register("rami");
  const o = await buy(owner, "rami-coach.com");
  await activate(owner.tenantId, o.id);
  const before = await order(owner.tenantId, o.id);
  await stripeEvent(
    "invoice.paid",
    invoice(before, "in_rami_renew", RENEWAL, o.sub, "pi_rami_renew"),
  );
  const registration = mock.registrations.get("rami-coach.com")!;
  const yearBefore = registration.expires.getUTCFullYear();
  const held = holdNext("domains.renew");
  await db.tenant(worker(owner.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET next_attempt_at=now(),lease_until=NULL WHERE id=$1",
      [o.id],
    ),
  );
  const running = processWebAddressOrder(db, owner.tenantId, o.id, deps);
  await held.reached;
  // The operator view lists the open attempt; pressing Reconcile now must
  // not touch the running step.
  const pressed = await request(`/admin/web-addresses/${o.id}/reconcile`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { reason: "Renewal looks stuck; reconcile it now" },
  });
  assert.equal(pressed.statusCode, 200, pressed.body);
  assert.equal(pressed.json().ran, false, "the running step keeps its lease");
  // A request sent moments ago is shown as in flight, not as work to do.
  assert.equal(pressed.json().inFlight, true);
  assert.equal(pressed.json().needsReconciliation, false);
  // Even with the lease gone (a run stuck past it), an attempt that may
  // still be running is left to settle instead of being called absent.
  await db.tenant(worker(owner.tenantId), (tx) =>
    tx.query("UPDATE domain_orders SET lease_until=NULL WHERE id=$1", [o.id]),
  );
  const late = await processWebAddressOrder(
    db,
    owner.tenantId,
    o.id,
    { ...deps, settleMs: undefined },
    { force: true },
  );
  assert.equal(late, true);
  assert.deepEqual(await renewalOps(owner.tenantId, o.id), ["sent"]);
  const waiting = await order(owner.tenantId, o.id);
  assert.ok(
    Date.parse(waiting.next_attempt_at) > Date.now() + 60000,
    "looked at again after the settle window",
  );
  held.release();
  await running;
  const after = await order(owner.tenantId, o.id);
  assert.equal(after.renewal_status, "renewed");
  assert.equal(sentFor("domains.renew", "rami-coach.com"), 1);
  assert.equal(registration.expires.getUTCFullYear(), yearBefore + 1);
  assert.equal(
    new Date(after.expires_at).getUTCFullYear(),
    yearBefore + 1,
    "the recorded expiry matches the registrar",
  );
  assert.deepEqual(await renewalOps(owner.tenantId, o.id), ["succeeded"]);
  assert.equal(after.lease_until, null, "no run left a lease behind");
});

test("a renewal made by hand at the registrar is recorded, never repeated", async () => {
  const owner = await register("hana");
  const domain = "hana-fit.com";
  const o = await buy(owner, domain);
  await activate(owner.tenantId, o.id);
  const registration = mock.registrations.get(domain)!;
  const renewByHand = () => {
    registration.expires = new Date(registration.expires);
    registration.expires.setUTCFullYear(
      registration.expires.getUTCFullYear() + 1,
    );
  };
  const failFiveTimes = async (invoiceId: string) => {
    const paid = await order(owner.tenantId, o.id);
    await stripeEvent(
      "invoice.paid",
      invoice(paid, invoiceId, RENEWAL, o.sub, "pi_" + invoiceId),
    );
    mock.refuseNext(
      "domains.renew",
      "Order creation failed: insufficient funds",
      "2528166",
      5,
    );
    let row: any;
    for (let i = 0; i < 6; i++) row = await step(owner.tenantId, o.id);
    assert.equal(row.renewal_status, "failed");
    assert.match(row.attention, /Record registrar state/);
    return row;
  };

  // 1. Five refused renewals, then the operator renews at Namecheap by hand
  // and presses Reconcile: the registrar's expiry is read, nothing is sent.
  await failFiveTimes("in_hana_1");
  assert.equal(sentFor("domains.renew", domain), 5);
  renewByHand();
  const reconciled = await inRegistrar(() =>
    request(`/admin/web-addresses/${o.id}/reconcile`, {
      method: "POST",
      cookie: admin.cookie,
      payload: { reason: "Renewed by hand at Namecheap after low balance" },
    }),
  );
  assert.equal(reconciled.statusCode, 200, reconciled.body);
  assert.equal(reconciled.json().renewal_status, "renewed");
  assert.equal(sentFor("domains.renew", domain), 5, "no renewal sent");
  let row = await order(owner.tenantId, o.id);
  assert.equal(
    new Date(row.expires_at).getUTCFullYear(),
    registration.expires.getUTCFullYear(),
  );
  assert.deepEqual(await renewalOps(owner.tenantId, o.id), [
    ...Array(5).fill("absent"),
    "confirmed",
  ]);

  // 2. Next year the same, but the operator presses Retry: the registrar's
  // expiry is read before any request, so it is not renewed a second time.
  await failFiveTimes("in_hana_2");
  renewByHand();
  const retried = await request(`/admin/web-addresses/${o.id}/retry`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { reason: "Renewed by hand at Namecheap; retry the step" },
  });
  assert.equal(retried.statusCode, 200, retried.body);
  row = await step(owner.tenantId, o.id);
  assert.equal(row.renewal_status, "renewed");
  assert.equal(sentFor("domains.renew", domain), 10, "no eleventh renewal");
  assert.equal(
    new Date(row.expires_at).getUTCFullYear(),
    registration.expires.getUTCFullYear(),
  );

  // 3. An out-of-band renewal without any payment is recorded from getInfo;
  // with nothing new at the registrar the action refuses.
  renewByHand();
  const recorded = await inRegistrar(() =>
    request(`/admin/web-addresses/${o.id}/record`, {
      method: "POST",
      cookie: admin.cookie,
      payload: { reason: "Goodwill renewal made at Namecheap by support" },
    }),
  );
  assert.equal(recorded.statusCode, 200, recorded.body);
  assert.equal(
    new Date(recorded.json().expires_at).getUTCFullYear(),
    registration.expires.getUTCFullYear(),
  );
  const again = await inRegistrar(() =>
    request(`/admin/web-addresses/${o.id}/record`, {
      method: "POST",
      cookie: admin.cookie,
      payload: { reason: "Pressed twice by mistake, nothing new" },
    }),
  );
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().code, "NOT_RECORDED");
  assert.equal(sentFor("domains.renew", domain), 10);

  // The operator can also end the subscription by hand.
  const cancelled = await request(
    `/admin/web-addresses/${o.id}/cancel-subscription`,
    {
      method: "POST",
      cookie: admin.cookie,
      payload: { reason: "Trainer asked to stop the yearly renewal" },
    },
  );
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(cancelled.json().billing_status, "canceled");
  assert.equal(cancelled.json().renewal_enabled, false);
});

test("a registration made by hand is recorded from the registrar", async () => {
  const owner = await register("rana");
  const domain = "rana-coach.com";
  const o = await buy(owner, domain);
  const balance = mock.balance;
  mock.balance = 0;
  let row = await step(owner.tenantId, o.id);
  assert.equal(row.status, "purchasing");
  mock.balance = balance;
  // Not in the account yet: nothing to record.
  const early = await inRegistrar(() =>
    request(`/admin/web-addresses/${o.id}/record`, {
      method: "POST",
      cookie: admin.cookie,
      payload: { reason: "Checking before buying it by hand" },
    }),
  );
  assert.equal(early.statusCode, 409);
  // Support buys it in the Namecheap account by hand.
  await deps.registrar!.register({
    domain,
    years: 1,
    registrant: {
      firstName: "Platform",
      lastName: "Owner",
      organization: "TrainsYou FZ-LLC",
      address1: "1 Fixture Street",
      city: "Dubai",
      stateProvince: "Dubai",
      postalCode: "00000",
      country: "AE",
      phone: "+971.501234567",
      email: "domains@trainsyou.example",
    },
  });
  const recorded = await inRegistrar(() =>
    request(`/admin/web-addresses/${o.id}/record`, {
      method: "POST",
      cookie: admin.cookie,
      payload: { reason: "Bought by hand at Namecheap after top-up" },
    }),
  );
  assert.equal(recorded.statusCode, 200, recorded.body);
  assert.equal(recorded.json().status, "owned");
  row = await order(owner.tenantId, o.id);
  assert.ok(row.expires_at);
  assert.deepEqual(
    (await operations(owner.tenantId, o.id)).map((op) => op.status),
    ["confirmed"],
  );
  assert.equal(
    sentFor("domains.create", domain),
    2,
    "one refused, one by hand",
  );
});

test("a registration missing from getList is confirmed with getInfo", async () => {
  const owner = await register("lina");
  const domain = "lina-coach.com";
  const o = await buy(owner, domain);
  mock.unlisted.add(domain);
  mock.loseNextResponse("domains.create");
  let row = await step(owner.tenantId, o.id);
  assert.equal(row.status, "purchasing");
  row = await step(owner.tenantId, o.id);
  mock.unlisted.delete(domain);
  assert.equal(row.status, "owned");
  const [op] = await db.tenant(worker(owner.tenantId), (tx) =>
    tx.query(
      "SELECT status,outcome FROM registrar_operations WHERE order_id=$1",
      [o.id],
    ),
  );
  assert.equal(op.status, "confirmed");
  assert.equal(op.outcome.via, "getInfo");
  assert.equal(sentFor("domains.create", domain), 1);
});

let nour: any, nourOrderId: string;
test("a completed checkout whose payment event was lost is reconciled from Stripe", async () => {
  nour = await register("nour");
  resetRegistrarBudget();
  const created = await inRegistrar(() =>
    request("/web-address/orders", {
      method: "POST",
      cookie: nour.cookie,
      payload: {
        domain: "nour-coach.com",
        firstYearPriceMinor: FIRST,
        renewalPriceMinor: RENEWAL,
        accepted: true,
      },
    }),
  );
  assert.equal(created.statusCode, 200, created.body);
  nourOrderId = created.json().orderId;
  let o = await order(nour.tenantId, nourOrderId);
  // Paid at Stripe; neither webhook arrives.
  const session = stripe.sessions.get(o.checkout_session_id)!;
  Object.assign(session, {
    status: "complete",
    subscription: "sub_nour",
    customer: "cus_nour",
  });
  const first = {
    ...invoice(o, "in_nour_first", FIRST, "sub_nour", "pi_nour_first"),
    status: "open",
    amount_paid: 0,
    livemode: false,
  };
  stripe.invoiceObjects.set(first.id, first);
  stripe.subs.set("sub_nour", {
    id: "sub_nour",
    object: "subscription",
    status: "incomplete",
    latest_invoice: first.id,
    livemode: false,
  });
  for (let visit = 1; visit <= 6; visit++)
    o = await step(nour.tenantId, nourOrderId);
  assert.equal(o.status, "checkout");
  assert.equal(o.stripe_subscription_id, "sub_nour", "linked from the session");
  assert.match(o.attention, /first payment is not confirmed/);
  // The invoice is paid now; the next sweep applies it.
  Object.assign(first, { status: "paid", amount_paid: FIRST });
  stripe.subs.get("sub_nour").status = "active";
  o = await step(nour.tenantId, nourOrderId);
  assert.equal(o.status, "paid");
  assert.equal(o.first_invoice_id, "in_nour_first");
  assert.equal(o.attention, null);
  const [paid] = (await journals(nour.tenantId)).filter(
    (l) => l.source_key === "web-address-invoice:in_nour_first",
  );
  assert.ok(paid, "journaled once");
});

test("a failed billing alignment is retried within minutes; a passed charge date charges now", async () => {
  let o = await step(nour.tenantId, nourOrderId); // buy
  assert.equal(o.status, "owned");
  o = await step(nour.tenantId, nourOrderId);
  o = await step(nour.tenantId, nourOrderId);
  assert.equal(o.status, "active");
  stripe.failUpdates = 1;
  o = await step(nour.tenantId, nourOrderId);
  assert.equal(o.billing_aligned_at, null);
  assert.equal(o.evidence.alignFailures, 1);
  assert.ok(
    Date.parse(o.next_attempt_at) < Date.now() + 10 * 60000,
    "retried within minutes, not at the first grace notice",
  );
  o = await step(nour.tenantId, nourOrderId);
  assert.ok(o.billing_aligned_at);
  assert.equal(o.evidence.alignFailures, 0);
  // Alignment never happened before the charge date passed: the renewal is
  // charged now (a new billing cycle, no proration), well before expiry.
  await db.tenant(worker(nour.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET billing_aligned_at=NULL,expires_at=now()+interval '20 days' WHERE id=$1",
      [nourOrderId],
    ),
  );
  o = await step(nour.tenantId, nourOrderId);
  const charge = stripe.calls.find(
    (c) =>
      c.method === "subscriptions.update" &&
      c.params.id === "sub_nour" &&
      c.params.billing_cycle_anchor === "now",
  );
  assert.ok(charge, "renewal charged now");
  assert.equal(charge!.params.proration_behavior, "none");
  assert.match(charge!.key!, /^web-address-charge:/);
  assert.ok(o.billing_aligned_at);
  assert.equal(o.evidence.renewalChargedEarly, true);
  assert.equal(o.status, "active");
});

test("renewal switch: an older Stripe event never undoes the trainer's choice; notices use the current address", async () => {
  const o = await order(nour.tenantId, nourOrderId);
  for (const enabled of [false, true]) {
    const r = await request(`/web-address/orders/${nourOrderId}/renewal`, {
      method: "POST",
      cookie: nour.cookie,
      payload: { enabled },
    });
    assert.equal(r.statusCode, 200, r.body);
  }
  const now = Math.floor(Date.now() / 1000);
  const subscription = (cancel: boolean) => ({
    id: "sub_nour",
    object: "subscription",
    status: "active",
    cancel_at_period_end: cancel,
    metadata: metadata(o),
  });
  // The "off" event arrives after the trainer turned renewal back on.
  await stripeEvent("customer.subscription.updated", subscription(true), {
    created: now - 120,
  });
  assert.equal((await order(nour.tenantId, nourOrderId)).renewal_enabled, true);
  // A newer change made at Stripe is applied.
  await stripeEvent("customer.subscription.updated", subscription(true), {
    created: now + 5,
  });
  assert.equal(
    (await order(nour.tenantId, nourOrderId)).renewal_enabled,
    false,
  );
  // An even older event after that changes nothing either.
  await stripeEvent(
    "customer.subscription.updated",
    { ...subscription(false), status: "past_due" },
    { created: now - 60 },
  );
  const kept = await order(nour.tenantId, nourOrderId);
  assert.equal(kept.renewal_enabled, false);
  assert.equal(kept.billing_status, "active");

  // After a rename, notices point at the workspace's current subdomain.
  await db.system((tx) =>
    tx.query("UPDATE tenants SET slug='nour-strength' WHERE id=$1", [
      nour.tenantId,
    ]),
  );
  await stripeEvent("invoice.payment_failed", {
    ...invoice(o, "in_nour_failed", RENEWAL, "sub_nour", "pi_nour_failed"),
    status: "open",
    amount_paid: 0,
  });
  const notice = (await notices(nour.tenantId)).find((n) =>
    n.dedupe_key.endsWith(":payment-failed:in_nour_failed"),
  );
  assert.ok(notice);
  assert.match(notice!.body, /https:\/\/nour-strength\.trainsyou\.example/);
  assert.doesNotMatch(notice!.body, /https:\/\/nour\.trainsyou/);
});

test("Stripe mode and the registrar environment must match before anything is bought", async () => {
  // Registration is rate limited (ten a window): an existing workspace.
  const owner = omar;
  const savedKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_live_fixture_only";
  try {
    const view = await request("/web-address", { cookie: owner.cookie });
    assert.equal(view.json().purchases.enabled, false);
    resetRegistrarBudget();
    const refused = await inRegistrar(() =>
      request("/web-address/orders", {
        method: "POST",
        cookie: owner.cookie,
        payload: {
          domain: "omar-fit.com",
          firstYearPriceMinor: FIRST,
          renewalPriceMinor: RENEWAL,
          accepted: true,
        },
      }),
    );
    assert.equal(refused.statusCode, 409);
    const ops = await request("/admin/web-addresses", { cookie: admin.cookie });
    assert.match(ops.json().modeProblem, /live Stripe payment/);
  } finally {
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
  }
  // A Checkout session Stripe creates in live mode is refused and expired.
  stripe.sessionLivemode = true;
  const expiredBefore = stripe.count("checkout.expire");
  let live;
  try {
    resetRegistrarBudget();
    live = await inRegistrar(() =>
      request("/web-address/orders", {
        method: "POST",
        cookie: owner.cookie,
        payload: {
          domain: "omar-fit.com",
          firstYearPriceMinor: FIRST,
          renewalPriceMinor: RENEWAL,
          accepted: true,
        },
      }),
    );
  } finally {
    stripe.sessionLivemode = false;
  }
  assert.equal(live.statusCode, 409);
  assert.equal(stripe.count("checkout.expire"), expiredBefore + 1);
  // A live payment reaching the worker buys nothing in the test environment.
  const o = await buy(owner, "omar-fit.com", { livemode: true });
  const row = await step(owner.tenantId, o.id);
  assert.equal(row.status, "paid");
  assert.match(row.attention, /live Stripe payment/);
  assert.equal(row.next_attempt_at, null);
  assert.equal(sentFor("domains.create", "omar-fit.com"), 0);
  // Nothing was registered: the operator can refund it.
  const refunded = await request(`/admin/web-addresses/${o.id}/refund`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { reason: "Paid in the wrong Stripe mode; refund it" },
  });
  assert.equal(refunded.statusCode, 200, refunded.body);
  assert.equal(refunded.json().status, "failed");
});

test("ledger: money for a closed order is owed back; a lost dispute is a loss", async () => {
  const failed = await order(sara.tenantId, saraOrder.id);
  await stripeEvent(
    "invoice.paid",
    invoice(failed, "in_sara_late", RENEWAL, saraOrder.sub, "pi_sara_late"),
  );
  assert.match(
    (await order(sara.tenantId, saraOrder.id)).attention,
    /closed order/,
  );
  await stripeEvent("refund.created", {
    id: "re_sara_late",
    object: "refund",
    amount: RENEWAL,
    currency: "usd",
    status: "succeeded",
    payment_intent: "pi_sara_late",
    metadata: metadata(failed),
  });
  const sara_lines = await journals(sara.tenantId);
  const lines = (key: string) =>
    sara_lines
      .filter((l) => l.source_key === key)
      .map((l) => [l.account, l.amount]);
  assert.deepEqual(lines("web-address-invoice:in_sara_late"), [
    ["web_address_receivable", RENEWAL],
    ["web_address_refund_liability", -RENEWAL],
  ]);
  assert.deepEqual(lines("web-address-refund:re_sara_late"), [
    ["web_address_receivable", -RENEWAL],
    ["web_address_refund_liability", RENEWAL],
  ]);

  const short = laylaOrder.id.slice(0, 8);
  await stripeEvent("charge.dispute.closed", {
    id: "dp_layla_first",
    object: "dispute",
    amount: FIRST,
    currency: "usd",
    status: "lost",
    charge: "ch_pi_first_" + short,
    payment_intent: "pi_first_" + short,
  });
  assert.deepEqual(
    (await journals(layla.tenantId))
      .filter((l) => l.source_key === "web-address-dispute:dp_layla_first")
      .map((l) => [l.account, l.amount]),
    [
      ["web_address_dispute_loss", FIRST],
      ["web_address_receivable", -FIRST],
    ],
  );
  assert.match(
    (await order(layla.tenantId, laylaOrder.id)).attention,
    /dispute closed \(lost\)/,
  );
});

test("early-access names are refused; searches stay within the registrar call budget", async () => {
  mock.earlyAccess.set("fresh-coach.com", "120.00");
  resetRegistrarBudget();
  const found = await inRegistrar(() =>
    request("/web-address/search?q=fresh-coach", { cookie: omar.cookie }),
  );
  assert.equal(found.statusCode, 200, found.body);
  assert.deepEqual(found.json().requested, {
    domain: "fresh-coach.com",
    status: "not_offered",
  });
  assert.ok(
    !found.json().results.some((r: any) => r.domain === "fresh-coach.com"),
    "an early-access name is never offered",
  );
  resetRegistrarBudget();
  const refused = await inRegistrar(() =>
    request("/web-address/orders", {
      method: "POST",
      cookie: omar.cookie,
      payload: {
        domain: "fresh-coach.com",
        firstYearPriceMinor: FIRST,
        renewalPriceMinor: RENEWAL,
        accepted: true,
      },
    }),
  );
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().code, "DOMAIN_UNAVAILABLE");
  mock.earlyAccess.delete("fresh-coach.com");

  // An ending the registrar does not sell is refused as not offered before
  // any availability request (live Namecheap fails a whole check naming it).
  resetRegistrarBudget();
  const checksBefore = mock.commands("domains.check").length;
  const unsold = await inRegistrar(() =>
    request("/web-address/orders", {
      method: "POST",
      cookie: omar.cookie,
      payload: {
        domain: "fresh-coach.ae",
        firstYearPriceMinor: FIRST,
        renewalPriceMinor: RENEWAL,
        accepted: true,
      },
    }),
  );
  assert.equal(unsold.statusCode, 409, unsold.body);
  assert.equal(unsold.json().code, "DOMAIN_UNAVAILABLE");
  assert.equal(mock.commands("domains.check").length, checksBefore);

  // Searches from the API may use a share of Namecheap's per-account limit.
  resetRegistrarBudget();
  const registrar = deps.registrar!;
  const calls = () =>
    mock.commands("domains.check").length +
    mock.commands("users.getPricing").length;
  const start = calls();
  let busy = false;
  for (let i = 0; i < 12 && !busy; i++)
    try {
      await searchDomains("budget-" + i, { registrar, db });
    } catch (error: any) {
      if (error.code !== "REGISTRAR_BUSY") throw error;
      busy = true;
    }
  assert.ok(busy, "refused once the share is used");
  assert.ok(calls() - start <= 8, `${calls() - start} registrar calls`);
  // A repeated search is answered from the short cache without a call.
  const used = calls();
  await searchDomains("budget-0", { registrar, db });
  assert.equal(calls(), used);
  resetRegistrarBudget();
});

test("a premium name within USD 100 is bought and renewed at its checked premium price; another renewal amount is flagged", async () => {
  // Registration is rate limited (ten a window): an existing workspace.
  const owner = omar;
  mock.premium.set("omar-gold.com", { register: "55.00", renew: "60.00" });
  resetRegistrarBudget();
  const found = await inRegistrar(() =>
    request("/web-address/search?q=omar-gold.com", { cookie: owner.cookie }),
  );
  // 55.00 + 0.18 ICANN → USD 64.99 the first year; 60.18 → 69.99 a renewal.
  assert.deepEqual(found.json().results[0], {
    domain: "omar-gold.com",
    available: true,
    premium: true,
    firstYearPriceMinor: 6499,
    renewalPriceMinor: 6999,
    currency: "USD",
    renewsYearly: true,
  });
  const o = await buy(owner, "omar-gold.com", { first: 6499, renewal: 6999 });
  const quoted = await order(owner.tenantId, o.id);
  // Operators keep the premium prices the registrar calls must name.
  assert.deepEqual(quoted.quote.premium, {
    registerUsd: "55.00",
    renewUsd: "60.00",
  });
  const trainerView = await request(`/web-address/orders/${o.id}`, {
    cookie: owner.cookie,
  });
  assert.doesNotMatch(trainerView.body, /55\.00|60\.00|premium|registerUsd/i);
  await activate(owner.tenantId, o.id);
  assert.deepEqual(
    mock
      .commands("domains.create")
      .filter((c) => c.params.DomainName === "omar-gold.com")
      .map((c) => [c.params.IsPremiumDomain, c.params.PremiumPrice]),
    [["true", "55.00"]],
  );
  // The registrar's USD 55.18 is the cost recorded, in USD.
  assert.ok(
    (await journals(owner.tenantId)).some(
      (l) =>
        l.source_key.startsWith("web-address-registrar:") &&
        l.account === "registrar_cost" &&
        l.amount === 5518 &&
        l.currency === "USD",
    ),
  );
  // A renewal charged at the agreed USD 69.99 renews at the premium price.
  const before = await order(owner.tenantId, o.id);
  await stripeEvent(
    "invoice.paid",
    invoice(before, "in_gold_renew_1", 6999, o.sub, "pi_gold_renew_1"),
  );
  mock.balance += 200; // the platform's registrar balance, topped up
  let row = await step(owner.tenantId, o.id);
  assert.equal(row.renewal_status, "renewed");
  assert.equal(row.attention, null);
  assert.deepEqual(
    mock
      .commands("domains.renew")
      .filter((c) => c.params.DomainName === "omar-gold.com")
      .map((c) => [c.params.IsPremiumDomain, c.params.PremiumPrice]),
    [["true", "60.00"]],
  );
  // Another amount (someone changed the Stripe price) still renews the
  // domain, but an operator is asked to look.
  await stripeEvent(
    "invoice.paid",
    invoice(row, "in_gold_renew_2", 2499, o.sub, "pi_gold_renew_2"),
  );
  row = await order(owner.tenantId, o.id);
  assert.equal(row.renewal_status, "paid");
  assert.match(
    row.attention,
    /differs from the agreed renewal price of 6999 USD/,
  );
});

test("a first year dearer than the renewal is charged as a one-time line on the first invoice", async () => {
  const owner = omar;
  // An ending typed by the trainer: registration 30.18, renewal 17.16.
  mock.prices.io = { register: "30.00", renew: "16.98" };
  // Not a suggested ending: refused (without asking the registrar) until an
  // operator allows it.
  resetRegistrarBudget();
  const calls = mock.commands().length;
  const refused = await inRegistrar(() =>
    request("/web-address/orders", {
      method: "POST",
      cookie: owner.cookie,
      payload: {
        domain: "omar-first.io",
        firstYearPriceMinor: 3999,
        renewalPriceMinor: 2499,
        currency: "USD",
        accepted: true,
      },
    }),
  );
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().code, "DOMAIN_UNAVAILABLE");
  assert.equal(mock.commands().length, calls, "no registrar call");
  process.env.WEB_ADDRESS_EXTRA_TLDS = "io";
  const o = await buy(owner, "omar-first.io", { first: 3999, renewal: 2499 });
  delete process.env.WEB_ADDRESS_EXTRA_TLDS;
  const checkout = stripe.calls
    .filter((c) => c.method === "checkout.create")
    .find((c) => c.params.client_reference_id === o.id)!;
  assert.deepEqual(
    checkout.params.line_items.map((item: any) => [
      item.price_data.unit_amount,
      item.price_data.currency,
      !!item.price_data.recurring,
      item.price_data.product_data.name,
    ]),
    [
      [2499, "usd", true, "Custom web address — yearly"],
      [1500, "usd", false, "Custom web address — first-year price"],
    ],
  );
  assert.equal(checkout.params.discounts, undefined, "no coupon");
  const session = [...stripe.sessions.values()].find(
    (s) => s.client_reference_id === o.id,
  );
  assert.equal(session.amount_total, 3999, "USD 39.99 due today");
  assert.equal(
    (await order(owner.tenantId, o.id)).status,
    "paid",
    "USD 39.99 matched the first year",
  );
  delete mock.prices.io;
});

test("an order quoted in AED before USD pricing keeps its price, checkout, payment check, ledger and view", async () => {
  const owner = sara;
  const id = randomUUID();
  await db.tenant(worker(owner.tenantId), (tx) =>
    tx.query(
      "INSERT INTO domain_orders(id,tenant_id,hostname,status,token,evidence,mode,registrar,quote,progress,next_attempt_at) VALUES($1,$2,$3,'checkout',$4,$5,'automatic','namecheap',$6,'[]'::jsonb,now()+interval '2 hours')",
      [
        id,
        owner.tenantId,
        "sara-legacy.com",
        "legacy-token-" + id.slice(0, 8),
        JSON.stringify({
          orderedBy: owner.userId,
          checkout: {
            origin: "http://localhost:3000",
            expiresAt: Math.floor(Date.now() / 1000) + 35 * 60,
            email: null,
            customer: null,
          },
        }),
        // The quote shape of orders placed before 28 September 2026.
        JSON.stringify({
          priceMinor: 8400,
          firstYearPriceMinor: 8400,
          renewalPriceMinor: 8400,
          currency: "AED",
          registerUsd: "10.46",
          renewUsd: "16.06",
          usdToAed: "3.6725",
          marginAed: "25",
          termYears: 1,
          registrar: "namecheap",
          registrarSandbox: true,
        }),
      ],
    ),
  );
  // Its trainer view keeps AED.
  const view = await request(`/web-address/orders/${id}`, {
    cookie: owner.cookie,
  });
  assert.deepEqual(
    [
      view.json().currency,
      view.json().firstYearPriceMinor,
      view.json().renewalPriceMinor,
    ],
    ["AED", 8400, 8400],
  );
  // Returning to its open checkout sends the same one yearly AED price.
  const resumed = await request(`/web-address/orders/${id}/checkout`, {
    method: "POST",
    cookie: owner.cookie,
    payload: {},
  });
  assert.equal(resumed.statusCode, 200, resumed.body);
  const checkout = stripe.calls
    .filter((c) => c.method === "checkout.create")
    .find((c) => c.params.client_reference_id === id)!;
  assert.deepEqual(checkout.params.line_items, [
    {
      quantity: 1,
      price_data: {
        currency: "aed",
        unit_amount: 8400,
        recurring: { interval: "year" },
        product_data: { name: "Custom web address — yearly" },
      },
    },
  ]);
  assert.equal(checkout.params.discounts, undefined);
  const legacy = await order(owner.tenantId, id);
  await stripeEvent("checkout.session.completed", {
    id: legacy.checkout_session_id,
    object: "checkout.session",
    mode: "subscription",
    status: "complete",
    client_reference_id: id,
    metadata: metadata(legacy),
    subscription: "sub_legacy",
    customer: "cus_legacy",
  });
  await stripeEvent(
    "invoice.paid",
    invoice(legacy, "in_legacy_first", 8400, "sub_legacy", "pi_legacy", "aed"),
  );
  let row = await order(owner.tenantId, id);
  assert.equal(row.status, "paid", "AED 84 matched its AED quote");
  row = await step(owner.tenantId, id);
  assert.equal(row.status, "owned");
  const lines = (await journals(owner.tenantId)).filter(
    (l) =>
      l.source_key === "web-address-invoice:in_legacy_first" ||
      (l.source_key.startsWith("web-address-registrar:") &&
        l.currency === "AED"),
  );
  assert.deepEqual(
    lines.map((l) => [l.account, l.amount, l.currency]),
    [
      ["web_address_receivable", 8400, "AED"],
      ["web_address_revenue", -8400, "AED"],
      // USD 10.46 at the quote's own rate, rounded up.
      ["registrar_cost", 3842, "AED"],
      ["registrar_prepaid", -3842, "AED"],
    ],
  );
  const period = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const statement = await db.tenant(
    elevated("provider-callback", {
      tenantId: owner.tenantId,
      role: "finance",
    }),
    (tx) => financialStatement(tx, period, { platformView: true }),
  );
  assert.deepEqual(statement.webAddresses.otherCurrencies, {
    AED: { paymentsMinor: 8400, refundsMinor: 0, registrarCostMinor: 3842 },
  });
  assert.equal(statement.webAddresses.currency, "USD");
});

test("no web address notice sent to a trainer names the registrar or its cost", async () => {
  let seen = 0,
    priced = 0;
  for (const who of [layla, omar, sara]) {
    // The only amounts a notice may carry are the trainer's own prices
    // (the renewal price and, in the renewal note, the first year's).
    const quotes = await db.tenant(worker(who.tenantId), (tx) =>
      tx.query<{ quote: any }>(
        "SELECT quote FROM domain_orders WHERE mode='automatic'",
      ),
    );
    const own = new Set(
      quotes.flatMap(({ quote }) =>
        [
          quote?.firstYearPriceMinor,
          quote?.renewalPriceMinor,
          quote?.priceMinor,
        ]
          .filter((n) => Number.isInteger(n))
          .map((n: number) => (n / 100).toFixed(2)),
      ),
    );
    for (const notice of await notices(who.tenantId)) {
      seen++;
      const text = notice.title + " " + notice.body;
      assert.doesNotMatch(text, /namecheap|registrar|cost/i, notice.dedupe_key);
      for (const [, amount] of text.matchAll(/USD (\d+\.\d{2})/g)) {
        priced++;
        // Differences in the renewal note are the trainer's prices too.
        const difference = [...own].some((a) =>
          [...own].some(
            (b) =>
              (Math.round(Number(a) * 100) - Math.round(Number(b) * 100)) /
                100 ===
              Number(amount),
          ),
        );
        assert.ok(
          own.has(amount) || difference,
          `${notice.dedupe_key}: USD ${amount} is not one of the trainer's prices`,
        );
      }
    }
  }
  assert.ok(seen >= 3, "the scenario sent notices");
  assert.ok(priced >= 1, "notices name the renewal price");
});

test("trainer-facing finance never carries the registrar's cost; operators still see it", async () => {
  // Layla's domain was bought and renewed above: registrar cost journals exist.
  const period = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const own = await request("/finance/statements/" + period, {
    cookie: layla.cookie,
  });
  assert.equal(own.statusCode, 200, own.body);
  assert.doesNotMatch(
    own.body,
    /registrar_cost|registrar_prepaid|web-address-registrar|registrarCost/,
  );
  assert.equal(
    own.json().current.otherCurrencies.USD.web_address_receivable > 0,
    true,
    "the trainer's own payments are still shown",
  );
  const boot = (await request("/bootstrap", { cookie: layla.cookie })).json();
  assert.ok(boot.finance, "the owner's bootstrap has the finance summary");
  assert.doesNotMatch(
    JSON.stringify({ finance: boot.finance, journals: boot.journals }),
    /registrar_cost|registrar_prepaid|web-address-registrar|namecheap/i,
  );
  // Workspace events never name the registrar or carry its cost.
  const events = JSON.stringify(boot.events);
  assert.doesNotMatch(events, /namecheap/i);
  assert.doesNotMatch(events, /"usd":|cost_usd|registerUsd|renewUsd/);
  const page = await request("/workspace/pages/journals", {
    cookie: layla.cookie,
  });
  assert.equal(page.statusCode, 200, page.body);
  assert.doesNotMatch(page.body, /web-address-registrar/);
  // The operator's view of the same workspace keeps the platform's cost.
  const finance = elevated("provider-callback", {
    tenantId: layla.tenantId,
    role: "finance",
  });
  const { financeSummary } = await import("../apps/api/src/finance.ts");
  const platform = await db.tenant(finance, (tx) =>
    financeSummary(tx, { platformView: true }),
  );
  assert.ok(platform.otherCurrencies.USD.registrar_cost > 0);
  const trainer = await db.tenant(finance, (tx) => financeSummary(tx));
  assert.equal(trainer.otherCurrencies.USD.registrar_cost, undefined);
  assert.equal(trainer.accounts.registrar_cost, undefined);
});

test("a registration cost that rose after payment is held for an operator; Retry buys at that cost", async () => {
  const nadia = omar;
  const saved = { ...mock.prices.com };
  const o = await buy(nadia, "nadia-strength.com");
  // The first-year promotion ends while the order waits: 20.18 is USD 29.99
  // under the rule, above the USD 19.99 the trainer paid.
  mock.prices.com = { register: "20.00", renew: saved.renew };
  const creates = () =>
    mock
      .commands("domains.create")
      .filter((c) => c.params.DomainName === "nadia-strength.com").length;
  let row = await step(nadia.tenantId, o.id);
  assert.equal(row.status, "paid");
  assert.equal(row.next_attempt_at, null, "waits for an operator");
  assert.equal(creates(), 0, "nothing bought");
  assert.match(row.attention, /USD 20\.18 \(quoted USD 10\.46\)/);
  assert.match(row.attention, /Retry buys it at up to USD 20\.18/);
  assert.equal(row.evidence.priceHold.usd, "20.1800");
  // The trainer sees only that the platform team is on it.
  const view = await request("/web-address/orders/" + o.id, {
    cookie: nadia.cookie,
  });
  assert.equal(view.json().needsReview, true);
  assert.doesNotMatch(view.body, /20\.18|10\.46|registrar|namecheap/i);
  // The operator accepts the cost with Retry; the name is bought once.
  const retry = await request(`/admin/web-addresses/${o.id}/retry`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { reason: "Accept the registrar's new cost for this order" },
  });
  assert.equal(retry.statusCode, 200, retry.body);
  row = await order(nadia.tenantId, o.id);
  assert.equal(row.evidence.priceHold, undefined);
  assert.equal(row.evidence.acceptedCost.usd, "20.1800");
  // The workspace's own event list never carries the registrar's cost.
  const boot = (await request("/bootstrap", { cookie: nadia.cookie })).json();
  assert.doesNotMatch(
    JSON.stringify(boot.events),
    /20\.18|10\.46|acceptedCost|priceHold/,
  );
  row = await step(nadia.tenantId, o.id);
  assert.equal(row.status, "owned");
  assert.equal(creates(), 1);
  assert.equal(
    row.evidence.costAlert,
    undefined,
    "the accepted cost is no surprise",
  );
  mock.prices.com = saved;
});

test("a registrar charge above what the trainer's price covers is flagged for operators, never shown to the trainer", async () => {
  const rana = sara;
  const saved = { ...mock.prices.com };
  const o = await buy(rana, "rana-fit.com");
  // The price moves between the check before buying and the purchase itself.
  const held = holdNext("domains.create");
  const running = step(rana.tenantId, o.id);
  await held.reached;
  mock.prices.com = { register: "20.00", renew: saved.renew };
  held.release();
  let row = await running;
  assert.equal(row.status, "owned", "bought: the trainer paid");
  assert.equal(row.evidence.costAlert.which, "register");
  assert.match(
    row.evidence.costAlert.message,
    /charged USD 20\.18 for the registration, more than the USD 19\.99/,
  );
  mock.prices.com = saved;
  // Later steps do not clear it; the operator view lists it as attention.
  row = await step(rana.tenantId, o.id);
  assert.ok(row.evidence.costAlert);
  const ops = (
    await request("/admin/web-addresses", { cookie: admin.cookie })
  ).json();
  const listed = ops.orders.find((x: any) => x.id === o.id);
  assert.match(listed.costAlert, /charged USD 20\.18/);
  assert.ok(ops.attention >= 1);
  const view = await request("/web-address/orders/" + o.id, {
    cookie: rana.cookie,
  });
  assert.doesNotMatch(view.body, /20\.18|cost/i);
  // Retry acknowledges it.
  await request(`/admin/web-addresses/${o.id}/retry`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { reason: "Seen: the registrar's price rose" },
  });
  assert.equal(
    (await order(rana.tenantId, o.id)).evidence.costAlert,
    undefined,
  );
});

test("a renewal cost rise is flagged two months ahead and when charged; the domain still renews", async () => {
  // (Each owner may start 10 checkouts in 10 minutes.)
  const hala = layla;
  const saved = { ...mock.prices.com };
  const o = await buy(hala, "hala-coach.com");
  let row = await step(hala.tenantId, o.id);
  for (let i = 0; i < 8 && row.status !== "active"; i++)
    row = await step(hala.tenantId, o.id);
  assert.equal(row.status, "active");
  // Fifty days before expiry the renewal cost is now 30.18: USD 34.99
  // under the rule, above the USD 24.99 renewal price.
  const expiry = new Date(Date.now() + 50 * 86400000);
  expiry.setUTCHours(0, 0, 0, 0);
  // The registrar's own record says the same (renewals are proven by it).
  mock.registrations.get("hala-coach.com")!.expires = new Date(expiry);
  await db.tenant(worker(hala.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET expires_at=$2,billing_aligned_at=now() WHERE id=$1",
      [o.id, expiry.toISOString()],
    ),
  );
  mock.prices.com = { register: saved.register, renew: "30.00" };
  await db.system((tx) =>
    tx.query(
      "UPDATE registrar_prices SET fetched_at=now()-interval '2 days' WHERE tld='com'",
    ),
  );
  row = await step(hala.tenantId, o.id);
  assert.equal(row.evidence.costAlert?.which, "renew_upcoming");
  assert.match(
    row.evidence.costAlert.message,
    /now asks USD 30\.18 for the next renewal, more than the USD 24\.99/,
  );
  // Checked once per period.
  await request(`/admin/web-addresses/${o.id}/retry`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { reason: "Owner asked about the renewal price" },
  });
  row = await step(hala.tenantId, o.id);
  assert.equal(row.evidence.costAlert, undefined);
  // The paid renewal goes through at the higher cost, and says so.
  const sub = "sub_" + o.id.slice(0, 8);
  await stripeEvent(
    "invoice.paid",
    invoice(row, "in_hala_renew", RENEWAL, sub, "pi_hala_renew"),
  );
  row = await step(hala.tenantId, o.id);
  assert.equal(row.renewal_status, "renewed");
  assert.equal(row.evidence.costAlert?.which, "renew");
  assert.match(
    row.evidence.costAlert.message,
    /charged USD 30\.18 for the renewal/,
  );
  mock.prices.com = saved;
});

test("the cost guard keeps the minimum margin; orders quoted before it keep their plain rule", () => {
  const quoted = (priceRule: object) => ({
    quote: {
      currency: "USD",
      firstYearPriceMinor: 1999,
      renewalPriceMinor: 2499,
      registerUsd: "11.4800",
      renewUsd: "18.6800",
      priceRule,
    },
  });
  const full = quoted({
    stepCents: 500,
    endingCents: 499,
    capCents: 10000,
    minMarginCents: 400,
    cardFeeBp: 290,
    internationalFeeBp: 100,
    fixedFeeCents: 28,
    conversionFeeBp: 100,
    usdBalance: false,
  });
  // Up to 14.73 the USD 19.99 paid still leaves USD 4 after Stripe's fees.
  assert.equal(costOverPrice(full as any, "register", "14.73"), false);
  assert.equal(costOverPrice(full as any, "register", "14.74"), true);
  // An order quoted before the minimum margin stored only the rounding: its
  // guard holds only past the USD 5 step, as before.
  const plain = quoted({ stepCents: 500, endingCents: 499, capCents: 10000 });
  assert.equal(costOverPrice(plain as any, "register", "14.74"), false);
  assert.equal(costOverPrice(plain as any, "register", "15.00"), false);
  assert.equal(costOverPrice(plain as any, "register", "15.01"), true);
  // Renewal 18.68 → 24.99 keeps USD 4.80; up to 19.48 keeps USD 4.00.
  assert.equal(costOverPrice(full as any, "renew", "19.48"), false);
  assert.equal(costOverPrice(full as any, "renew", "19.49"), true);
});
