// A domain bought through 101domain (docs/features/web-addresses.md,
// "Registrars") on PGlite, end to end through the worker: 101domain registers
// and renews asynchronously, so an order it is still processing is never
// bought or renewed a second time, never refunded, and a renewal counts only
// when the expiry moved. Its own DNS cannot be set up through its API, so its
// domains are served only through DigitalOcean DNS. 101domain, DigitalOcean,
// Stripe, public DNS and HTTPS are local doubles; the 101domain field names
// follow the double, which is provisional until the live read-only check.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, elevated, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import {
  processWebAddressOrder,
  type WebAddressDeps,
} from "../apps/api/src/web-address-orders.ts";
import {
  resetRegistrarBudget,
} from "../apps/api/src/web-addresses.ts";
import {
  OneOhOneRegistrar,
  canUseRegistrarDns,
  type Registrant,
} from "../packages/providers/src/registrar.ts";
import { DigitalOceanDns, DIGITALOCEAN_NAMESERVERS } from "../packages/providers/src/dns-hosting.ts";
import { OneOhOneMock } from "./e2e/mocks/oneohone.ts";
import { DigitalOceanMock } from "./e2e/mocks/digitalocean.ts";

const TOKEN = "dop_v1_registrar_fixture";
const KEY = "k101-orders-fixture";
const SERVER_IP = "203.0.113.9";
const settings: Record<string, string> = {
  PUBLIC_APP_URL: "http://localhost:3000",
  PLATFORM_ROOT_DOMAIN: "trainsyou.example",
  COMMERCE_APPROVED: "true",
  WEB_ADDRESS_PURCHASES_ENABLED: "true",
  WEB_ADDRESS_REGISTRAR: "101domain",
  REGISTRAR_101DOMAIN_API_KEY: KEY,
  REGISTRAR_101DOMAIN_ORDERING: "true",
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
  WEB_ADDRESS_TLDS: "com",
  DNS_PROVIDER: "digitalocean",
  DIGITALOCEAN_DNS_TOKEN: TOKEN,
};
const saved = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));

class FakeStripe {
  private n = 0;
  sessions = new Map<string, any>();
  checkout = {
    sessions: {
      create: async (params: any) => {
        const id = "cs_test_101_" + ++this.n;
        const session = {
          id,
          object: "checkout.session",
          mode: "subscription",
          status: "open",
          url: "https://checkout.stripe.test/" + id,
          client_reference_id: params.client_reference_id,
          metadata: params.metadata,
          livemode: false,
        };
        this.sessions.set(id, session);
        return session;
      },
      retrieve: async (id: string) => this.sessions.get(id),
      expire: async (id: string) => this.sessions.get(id),
    },
  };
  subscriptions = {
    retrieve: async (id: string) => ({ id, status: "active", livemode: false }),
    update: async (id: string, params: any) => ({ id, ...params }),
    cancel: async (id: string) => ({ id, status: "canceled" }),
  };
  // A once-only coupon brings the first invoice to the lower first-year price.
  coupons = {
    create: async (params: any) => ({ id: "coupon_" + ++this.n, ...params }),
  };
  invoices = { retrieve: async () => null };
  refunds = {
    list: async () => ({ data: [] }),
    create: async () => {
      refunds++;
      return { id: "re_x", amount: 0, status: "succeeded" };
    },
  };
  paymentIntents = { retrieve: async (id: string) => ({ id, latest_charge: "ch_" + id }) };
  invoicePayments = { list: async () => ({ data: [] }) };
}
let refunds = 0;

const mock = new OneOhOneMock({ key: "unused", cert: "unused" }, KEY);
const digitalocean = new DigitalOceanMock({ key: "unused", cert: "unused" }, TOKEN);
/** Requests the 101domain adapter sent: "<METHOD> <path>". */
const sent: string[] = [];
/** While set, 101domain answers renewals as still processing (and keeps the order open). */
let renewalProcessing: string | null = null;
/** When set, 101domain answers a renewal with this expiry without renewing. */
let renewalAnswersExpiry: string | null = null;
const r101 = new OneOhOneRegistrar(KEY, {
  ordering: true,
  sandbox: true,
  transport: async (url, init) => {
    const target = new URL(url);
    sent.push(`${init.method ?? "GET"} ${target.pathname}`);
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify({ status: "success", code: "OK", message: "OK", data, errors: null }), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (init.method === "POST" && target.pathname.endsWith("/renew")) {
      if (renewalProcessing) {
        const number = mock.addOrder(renewalProcessing, "Renewal", "processing");
        return json(202, { order_number: number, status: "processing" });
      }
      if (renewalAnswersExpiry)
        return json(200, { order_number: "ord_r2", expiration_date: renewalAnswersExpiry });
    }
    return mock.fetch(url, init);
  },
});
const deps: WebAddressDeps = {
  registrar: r101,
  stripe: new FakeStripe() as any,
  settleMs: 0,
  dns: (guard) => new DigitalOceanDns(TOKEN, guard, { transport: digitalocean.fetch }),
  publicDns: async (name, type) =>
    type === "NS" ? { status: "ok", answers: [...DIGITALOCEAN_NAMESERVERS] } : { status: "ok", answers: [] },
  resolve4: async () => [SERVER_IP],
  httpsCheck: async () => {},
  targetIpv4: async () => SERVER_IP,
};

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
let owner: any, admin: any;
const worker = (tenantId: string) => elevated("worker", { tenantId, role: "owner" });
const count = (line: string) => sent.filter((l) => l === line).length;
function request(path: string, options: { method?: string; payload?: any; cookie?: string } = {}) {
  return app.inject({
    url: "/api/v1" + path,
    method: (options.method ?? "GET") as any,
    payload: options.payload,
    headers: {
      host: "localhost:4000",
      origin: "http://localhost:3000",
      ...(options.cookie ? { cookie: options.cookie } : {}),
    },
  });
}
async function register(slug: string) {
  const r = await request("/auth/register", {
    method: "POST",
    payload: {
      name: "Fixture " + slug,
      email: slug + "@registrar-orders-fixture.test",
      password: "FixturePassword2026!",
      slug,
      accepted: true,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const user = (await request("/bootstrap", { cookie })).json().user;
  return { ...user, cookie };
}
async function order(id: string) {
  const [row] = await db.tenant(worker(owner.tenantId), (tx) =>
    tx.query("SELECT * FROM domain_orders WHERE id=$1", [id]),
  );
  return row;
}
async function operations(id: string) {
  return db.tenant(worker(owner.tenantId), (tx) =>
    tx.query("SELECT kind,status,outcome FROM registrar_operations WHERE order_id=$1 ORDER BY created_at,id", [id]),
  );
}
async function step(id: string) {
  await db.tenant(worker(owner.tenantId), (tx) =>
    tx.query("UPDATE domain_orders SET next_attempt_at=now(),lease_until=NULL WHERE id=$1", [id]),
  );
  await processWebAddressOrder(db, owner.tenantId, id, deps);
  return order(id);
}
let eventNumber = 0;
const stripeEvent = (type: string, object: any) =>
  processStripeEvent(
    db,
    {
      id: "evt_101_" + ++eventNumber,
      type,
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: { object },
    },
    { stripe: deps.stripe as any },
  );
/** Search, checkout and payment; returns the paid order's id. */
async function buy(domain: string) {
  resetRegistrarBudget();
  const search = await request("/web-address/search?q=" + encodeURIComponent(domain), { cookie: owner.cookie });
  assert.equal(search.statusCode, 200, search.body);
  const offer = search.json().results.find((r: any) => r.domain === domain);
  assert.ok(offer?.available, search.body);
  assert.equal(offer.currency, "USD");
  const created = await request("/web-address/orders", {
    method: "POST",
    cookie: owner.cookie,
    payload: {
      domain,
      firstYearPriceMinor: offer.firstYearPriceMinor,
      renewalPriceMinor: offer.renewalPriceMinor,
      currency: "USD",
      accepted: true,
    },
  });
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().orderId as string;
  const o = await order(id);
  assert.equal(o.registrar, "101domain");
  const meta = { purpose: "web_address", tenant_id: o.tenant_id, web_address_order_id: o.id };
  const sub = "sub_101_" + o.id.slice(0, 8);
  await stripeEvent("checkout.session.completed", {
    id: o.checkout_session_id,
    object: "checkout.session",
    mode: "subscription",
    status: "complete",
    client_reference_id: o.id,
    metadata: meta,
    subscription: sub,
    customer: "cus_" + o.id.slice(0, 8),
  });
  await stripeEvent("invoice.paid", {
    id: "in_101_" + o.id.slice(0, 8),
    object: "invoice",
    status: "paid",
    currency: "usd",
    amount_paid: offer.firstYearPriceMinor,
    customer: "cus_" + o.id.slice(0, 8),
    payment_intent: "pi_101_" + o.id.slice(0, 8),
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: sub, metadata: meta },
    },
  });
  assert.equal((await order(id)).status, "paid");
  return id;
}

before(async () => {
  Object.assign(process.env, settings);
  resetRegistrarBudget();
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true, providers: { webAddresses: deps } });
  owner = await register("noor");
  admin = await register("registrar-ops-admin");
  await db.system(async (tx) => {
    await tx.query("UPDATE tenants SET published=true WHERE id=$1", [owner.tenantId]);
    await tx.query("UPDATE users SET platform_role='admin' WHERE id=$1", [admin.userId]);
    await tx.query("UPDATE sessions SET mfa_at=now() WHERE user_id IN ($1,$2)", [admin.userId, owner.userId]);
  });
});
after(async () => {
  await app?.close();
  await db?.close();
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

let slowOrder = "";
test("a 101domain registration still processing is never bought again, nor refunded", async () => {
  mock.processing.add("slow.com");
  slowOrder = await buy("slow.com");
  const purchasing = await step(slowOrder);
  assert.equal(purchasing.status, "purchasing");
  assert.deepEqual((await operations(slowOrder)).map((o: any) => o.status), ["unknown"]);
  // The name still shows as available at 101domain while it processes the order.
  for (let i = 0; i < 4; i++) {
    const waiting = await step(slowOrder);
    assert.equal(waiting.status, "purchasing");
    assert.equal(waiting.evidence.lastNote, "Registration still processing");
  }
  assert.equal(count("POST /v1/domains/registration"), 1, "bought once");
  assert.equal(refunds, 0);
  mock.finishProcessing("slow.com");
  const owned = await step(slowOrder);
  assert.equal(owned.status, "owned");
  assert.deepEqual((await operations(slowOrder)).map((o: any) => [o.kind, o.status]), [["register", "confirmed"]]);
  assert.equal(count("POST /v1/domains/registration"), 1);
  // Its DNS is set up only at DigitalOcean: 101domain's own DNS is never offered.
  assert.equal(canUseRegistrarDns(r101), false);
  const refused = await request(`/admin/web-addresses/${slowOrder}/dns`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { provider: "registrar", reason: "Try the registrar's own DNS" },
  });
  assert.equal(refused.statusCode, 409, refused.body);
  assert.equal(refused.json().code, "REGISTRAR_DNS_UNSUPPORTED");
  assert.equal((await step(slowOrder)).status, "zone");
});

test("a 101domain renewal still processing is not sent again; it counts once the expiry moves", async () => {
  const before = await order(slowOrder);
  const base = new Date(before.expires_at).toISOString();
  await db.tenant(worker(owner.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET renewal_status='paid',renewal_invoice_id='in_renew_101',evidence=evidence||$2::jsonb WHERE id=$1",
      [slowOrder, JSON.stringify({ renewalLivemode: false, renewalBaseExpiry: base })],
    ),
  );
  renewalProcessing = "slow.com";
  const first = await step(slowOrder);
  assert.equal(first.renewal_status, "renewing");
  for (let i = 0; i < 3; i++) {
    const waiting = await step(slowOrder);
    assert.equal(waiting.renewal_status, "renewing");
    assert.equal(waiting.evidence.lastNote, "Renewal still processing");
  }
  assert.equal(count("POST /v1/domains/slow.com/renew"), 1, "renewed once");
  // The registry applies it: recognised from the moved expiry, not sent again.
  renewalProcessing = null;
  mock.finishOrders("slow.com");
  const stored = mock.registrations.get("slow.com")!;
  stored.expires = new Date(stored.expires.getTime() + 365 * 86400000);
  const renewed = await step(slowOrder);
  assert.equal(renewed.renewal_status, "renewed");
  assert.ok(Date.parse(renewed.expires_at) > Date.parse(base) + 300 * 86400000);
  assert.equal(count("POST /v1/domains/slow.com/renew"), 1);
  assert.deepEqual(
    (await operations(slowOrder)).filter((o: any) => o.kind === "renew").map((o: any) => o.status),
    ["confirmed"],
  );
});

test("a renewal answer whose expiry did not move is never counted as a renewal", async () => {
  const current = await order(slowOrder);
  const base = new Date(current.expires_at).toISOString();
  await db.tenant(worker(owner.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET renewal_status='paid',renewal_invoice_id='in_renew_101b',evidence=evidence||$2::jsonb WHERE id=$1",
      [slowOrder, JSON.stringify({ renewalLivemode: false, renewalBaseExpiry: base })],
    ),
  );
  renewalAnswersExpiry = base;
  try {
    const answered = await step(slowOrder);
    assert.equal(answered.renewal_status, "renewing");
    assert.equal(new Date(answered.expires_at).toISOString(), base);
    const last = (await operations(slowOrder)).at(-1)!;
    assert.equal(last.kind, "renew");
    assert.equal(last.status, "unknown");
    assert.match(last.outcome.error, /did not move/);
  } finally {
    renewalAnswersExpiry = null;
  }
});

test("101domain answers without a final status are reconciled, never read as refusals", async () => {
  const answer = (data: unknown, status = 200) =>
    new OneOhOneRegistrar(KEY, {
      ordering: true,
      transport: async () =>
        new Response(JSON.stringify({ status: "success", code: "OK", message: "OK", data }), {
          status,
          headers: { "content-type": "application/json" },
        }),
    });
  const registrant: Registrant = {
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
  };
  const input = { domain: "odd.com", years: 1, registrant };
  await assert.rejects(
    () => answer({ order_number: "o1", status: "awaiting_registry" }, 201).register(input),
    (e: any) => e.outcome === "unknown" && e.code === "PENDING",
  );
  await assert.rejects(
    () => answer({ order_number: "o1" }, 202).register(input),
    (e: any) => e.outcome === "unknown",
  );
  assert.equal((await answer({ status: "failed" }).register(input)).registered, false);
  assert.equal((await answer({ status: "completed" }).register(input)).registered, true);
  await assert.rejects(
    () => answer({ order_number: "o2" }, 202).renew("odd.com", 1),
    (e: any) => e.outcome === "unknown" && e.code === "PENDING",
  );
  await assert.rejects(
    () => answer({ order_number: "o2", status: "processing", expiration_date: "2027-10-01T00:00:00Z" }).renew("odd.com", 1),
    (e: any) => e.outcome === "unknown",
  );
  assert.equal((await answer({ status: "rejected" }).renew("odd.com", 1)).renewed, false);
});
