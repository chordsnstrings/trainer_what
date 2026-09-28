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
  processWebAddressOrder,
  processWebAddressOrders,
  platformHosts,
  sameHostSet,
  type WebAddressDeps,
} from "../apps/api/src/web-address-orders.ts";
import { clearWebAddressPriceCache } from "../apps/api/src/web-addresses.ts";
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
  WEB_ADDRESS_MARGIN_AED: "25",
  WEB_ADDRESS_USD_TO_AED: "3.6725",
};
const saved = Object.fromEntries(
  Object.keys(settings).map((key) => [key, process.env[key]]),
);

/** Stripe double: records every call; idempotency keys replay. */
class FakeStripe {
  calls: Array<{ method: string; params: any; key?: string }> = [];
  sessions = new Map<string, any>();
  refundsMade: any[] = [];
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
            amount_total: params.line_items[0].price_data.unit_amount,
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
  subscriptions = {
    retrieve: async (id: string) => ({ id, status: "active" }),
    update: async (id: string, params: any, options?: any) => {
      this.calls.push({
        method: "subscriptions.update",
        params: { id, ...params },
        key: options?.idempotencyKey,
      });
      return { id, ...params };
    },
    cancel: async (id: string, params?: any, options?: any) => {
      this.calls.push({
        method: "subscriptions.cancel",
        params: { id },
        key: options?.idempotencyKey,
      });
      return { id, status: "canceled" };
    },
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
          amount: 8400,
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
const deps: WebAddressDeps = {
  // An explicit test transport: nothing can leave the process.
  registrar: new NamecheapRegistrar(
    { ...account, sandbox: true },
    { transport: mock.fetch },
  ),
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
const stripeEvent = (type: string, object: any) =>
  processStripeEvent(
    db,
    {
      id: "evt_fixture_" + ++eventNumber,
      type,
      created: Math.floor(Date.now() / 1000),
      data: { object },
    },
    { stripe: stripe as any },
  );
const metadata = (o: any) => ({
  purpose: "web_address",
  tenant_id: o.tenant_id,
  web_address_order_id: o.id,
});
function invoice(o: any, id: string, amount: number, sub: string, pi: string) {
  return {
    id,
    object: "invoice",
    status: "paid",
    currency: "aed",
    amount_paid: amount,
    customer: "cus_" + o.tenant_id.slice(0, 8),
    payment_intent: pi,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: sub, metadata: metadata(o) },
    },
  };
}
async function buy(owner: any, domain: string, price: number) {
  const created = await inRegistrar(() =>
    request("/web-address/orders", {
      method: "POST",
      cookie: owner.cookie,
      payload: { domain, priceMinor: price, accepted: true },
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
        "SELECT j.source_key,l.account,l.amount_minor::int AS amount FROM journals j JOIN journal_lines l ON l.journal_id=j.id AND l.tenant_id=j.tenant_id ORDER BY j.created_at,j.source_key,l.account",
      ),
  );
}

let layla: any, omar: any, sara: any, admin: any;
let laylaOrder: { id: string; sub: string };
before(async () => {
  Object.assign(process.env, settings);
  clearWebAddressPriceCache();
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

test("search shows availability and the yearly AED price; a changed price is refused", async () => {
  mock.taken.add("layla.net");
  const found = await inRegistrar(() =>
    request("/web-address/search?q=layla", { cookie: layla.cookie }),
  );
  assert.equal(found.statusCode, 200, found.body);
  // .com: renewal 15.88 + 0.18 USD is the higher price → 58.98 AED → 59 + 25 margin.
  // .net is taken.
  assert.deepEqual(
    found.json().results.map((r: any) => [r.domain, r.available, r.priceMinor]),
    [
      ["layla.com", true, 8400],
      ["layla.net", false, null],
    ],
  );
  const underRoot = await inRegistrar(() =>
    request("/web-address/search?q=x." + ROOT, { cookie: layla.cookie }),
  );
  assert.equal(underRoot.statusCode, 400);
  const changed = await inRegistrar(() =>
    request("/web-address/orders", {
      method: "POST",
      cookie: layla.cookie,
      payload: { domain: "layla.com", priceMinor: 7000, accepted: true },
    }),
  );
  assert.equal(changed.statusCode, 409);
  assert.deepEqual(
    { code: changed.json().code, priceMinor: changed.json().priceMinor },
    { code: "PRICE_CHANGED", priceMinor: 8400 },
  );
  assert.equal(
    stripe.count("checkout.create"),
    0,
    "no checkout without the shown price",
  );
});

test("pay, buy, set DNS, verify, activate: the trainer's own domain goes live", async () => {
  laylaOrder = await buy(layla, "layla.com", 8400);
  const checkout = stripe.calls.find((c) => c.method === "checkout.create")!;
  assert.equal(checkout.key, "web-address-checkout:" + laylaOrder.id);
  assert.deepEqual(checkout.params.line_items[0].price_data.recurring, {
    interval: "year",
  });
  assert.equal(checkout.params.line_items[0].price_data.currency, "aed");
  assert.equal(checkout.params.metadata.purpose, "web_address");
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
  assert.ok(
    (await notices(layla.tenantId)).some((n) => n.dedupe_key.endsWith(":live")),
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
      ["web_address_receivable", 8400],
      ["web_address_revenue", -8400],
    ],
  );
  assert.deepEqual(
    lines
      .filter((l) => l.source_key.startsWith("web-address-registrar:"))
      .map((l) => [l.account, l.amount]),
    [
      ["registrar_cost", 3842],
      ["registrar_prepaid", -3842],
    ],
  );
  assert.ok(
    !lines.some((l) =>
      ["trainer_payable", "platform_commission", "stripe_receivable"].includes(
        l.account,
      ),
    ),
  );
  const period = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const statement = await db.tenant(
    elevated("provider-callback", {
      tenantId: layla.tenantId,
      role: "finance",
    }),
    (tx) => financialStatement(tx, period),
  );
  assert.deepEqual(statement.webAddresses, {
    paymentsMinor: 8400,
    refundsMinor: 0,
    registrarCostMinor: 3842,
  });
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
  const o = await buy(omar, "omar-coach.com", 8400);
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
  const o = await buy(sara, "sara-fit.com", 8400);
  mock.taken.add("sara-fit.com");
  let row = await step(sara.tenantId, o.id);
  assert.equal(row.status, "purchasing");
  assert.deepEqual(
    (await operations(sara.tenantId, o.id)).map((op) => op.status),
    ["failed"],
  );
  row = await step(sara.tenantId, o.id);
  assert.equal(row.status, "failed");
  assert.deepEqual(
    (await operations(sara.tenantId, o.id)).map((op) => op.status),
    ["absent"],
  );
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
      ["web_address_receivable", -8400],
      ["web_address_revenue", 8400],
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
      payload: { domain: "sara-fit.com", priceMinor: 8400, accepted: true },
    }),
  );
  assert.equal(again.statusCode, 200, again.body);
});

test("yearly renewal: the paid invoice renews at the registrar, a lost answer is reconciled", async () => {
  const before = await order(layla.tenantId, laylaOrder.id);
  await stripeEvent(
    "invoice.paid",
    invoice(before, "in_renew_1", 8400, laylaOrder.sub, "pi_renew_1"),
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
    invoice(row, "in_renew_2", 8400, laylaOrder.sub, "pi_renew_2"),
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
    invoice(row, "in_renew_2", 8400, laylaOrder.sub, "pi_renew_2"),
  );
  assert.equal(
    (await order(layla.tenantId, laylaOrder.id)).renewal_status,
    "renewed",
  );
});

test("failed renewal payment: grace notices, then lapse back to the subdomain; renewal can be turned off", async () => {
  const row = await order(layla.tenantId, laylaOrder.id);
  await stripeEvent("invoice.payment_failed", {
    ...invoice(row, "in_failed_1", 8400, laylaOrder.sub, "pi_failed_1"),
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
  const o = await buy(admin, "ops-coach.com", 8400);
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
  const o = await buy(owner, "nadia-fit.com", 8400);
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
