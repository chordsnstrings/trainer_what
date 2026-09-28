// Automatic domains with DigitalOcean DNS (docs/features/web-addresses.md,
// "DNS hosting" and "Forwarding") end to end on PGlite: after the purchase
// the zone and its A records are created and read back through the DNS
// host's API before the registrar delegates the name to it; delegation is
// awaited in public DNS; every call is recorded under an intent and a failed
// one is settled by the next read-back; a zone another account holds and a
// DNSSEC domain are never delegated; a lapsed domain keeps its zone until
// nothing delegates to it any more; the owner's forwarding choice drives
// host routing and a 301 in the web proxy; operators can move a domain back
// to the registrar's DNS. Namecheap, DigitalOcean, Stripe, public DNS and
// HTTPS are local doubles.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createDatabase, elevated, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import {
  processWebAddressOrder,
  processWebAddressOrders,
  ZONE_RELEASE_DAYS,
  type WebAddressDeps,
} from "../apps/api/src/web-address-orders.ts";
import {
  clearWebAddressPriceCache,
  resetRegistrarBudget,
} from "../apps/api/src/web-addresses.ts";
import {
  HOST_HEADERS,
  mappingRedirect,
  resolveRequestHost,
  signHostRequest,
} from "../apps/api/src/host-routing.ts";
import { withIntegrationFixtureTransport } from "../packages/providers/src/integrations.ts";
import { NamecheapRegistrar } from "../packages/providers/src/registrar.ts";
import {
  DIGITALOCEAN_NAMESERVERS,
  DigitalOceanDns,
  RegistrarHostedDns,
} from "../packages/providers/src/dns-hosting.ts";
import { forwardLocation } from "../apps/web/host-proxy.ts";
import { proxy } from "../apps/web/proxy.ts";
import { NamecheapMock, NAMECHEAP_DNS } from "./e2e/mocks/namecheap.ts";
import { DigitalOceanMock } from "./e2e/mocks/digitalocean.ts";

const ROOT = "trainsyou.example";
const SERVER_IP = "203.0.113.7";
const TOKEN = "dop_v1_orders_fixture_token";
const DO = [...DIGITALOCEAN_NAMESERVERS];
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
  DNS_PROVIDER: "digitalocean",
  DIGITALOCEAN_DNS_TOKEN: TOKEN,
  DNS_RECORD_TTL: "600",
};
const saved = Object.fromEntries(
  Object.keys(settings).map((key) => [key, process.env[key]]),
);

/** The Stripe calls the flow makes; idempotency keys replay. */
class FakeStripe {
  calls: Array<{ method: string; params: any }> = [];
  private n = 0;
  sessions = new Map<string, any>();
  checkout = {
    sessions: {
      create: async (params: any) => {
        const id = "cs_test_dns_" + ++this.n;
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
    retrieve: async (id: string) => ({ id, status: "canceled", livemode: false }),
    update: async (id: string, params: any) => {
      this.calls.push({ method: "subscriptions.update", params });
      return { id, ...params };
    },
    cancel: async (id: string) => {
      this.calls.push({ method: "subscriptions.cancel", params: { id } });
      return { id, status: "canceled" };
    },
  };
  invoices = { retrieve: async () => null };
  refunds = {
    list: async () => ({ data: [] }),
    create: async () => ({ id: "re_x", amount: 0, status: "succeeded" }),
  };
  paymentIntents = {
    retrieve: async (id: string) => ({ id, latest_charge: "ch_" + id }),
  };
  invoicePayments = { list: async () => ({ data: [] }) };
}

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const namecheap = new NamecheapMock({ key: "unused", cert: "unused" }, account);
const digitalocean = new DigitalOceanMock({ key: "unused", cert: "unused" }, TOKEN);
const stripe = new FakeStripe();
/** Every external call in order: "do <METHOD> <path>" or "nc <command>". */
const log: string[] = [];
/** What public DNS shows as a name's nameservers (set when visible). */
const delegated = new Map<string, string[]>();
/** Names whose delegation the registry has applied but public DNS does not show yet. */
const hidden = new Set<string>();
const dsRecords = new Map<string, string[]>();
const httpsChecks: string[] = [];
namecheap.onNameservers = (domain, nameservers) => {
  if (!hidden.has(domain)) delegated.set(domain, nameservers);
};
const registrar = new NamecheapRegistrar(
  { ...account, sandbox: true },
  {
    transport: async (url, init) => {
      const command = new URLSearchParams(String(init.body ?? ""))
        .get("Command")
        ?.replace(/^namecheap\./, "");
      log.push("nc " + command);
      return namecheap.fetch(url, init);
    },
  },
);
const doTransport = async (url: string, init: RequestInit) => {
  const target = new URL(url);
  log.push(`do ${init.method ?? "GET"} ${target.pathname}`);
  return digitalocean.fetch(url, init);
};
/** A resolver: DigitalOcean's answers for a name delegated there, Namecheap's otherwise. */
function resolveA(name: string): string[] {
  const zone = name.replace(/^www\./, "");
  const ns = delegated.get(zone) ?? [];
  const label = name === zone ? "@" : "www";
  if (ns.some((n) => n.endsWith("digitalocean.com")))
    return (digitalocean.zones.get(zone) ?? [])
      .filter((r) => r.type === "A" && r.name === label)
      .map((r) => r.data);
  return (namecheap.registrations.get(zone)?.hosts ?? [])
    .filter((h) => h.type === "A" && h.name === label)
    .map((h) => h.address);
}
const deps: WebAddressDeps = {
  registrar,
  stripe: stripe as any,
  settleMs: 0,
  dns: (guard, provider) =>
    provider === "digitalocean"
      ? new DigitalOceanDns(TOKEN, guard, { transport: doTransport })
      : new RegistrarHostedDns(registrar, guard),
  publicDns: async (name, type) => {
    if (type === "DS") return { status: "ok", answers: dsRecords.get(name) ?? [] };
    if (type === "NS") {
      if (!namecheap.registrations.has(name) && !delegated.has(name))
        return { status: "nxdomain", answers: [] };
      return {
        status: "ok",
        answers: delegated.get(name) ?? NAMECHEAP_DNS,
      };
    }
    return { status: "ok", answers: [] };
  },
  resolve4: async (name) => {
    const answer = resolveA(name);
    if (!answer.length)
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return answer;
  },
  httpsCheck: async (name) => {
    httpsChecks.push(name);
  },
  targetIpv4: async () => SERVER_IP,
};

function request(
  path: string,
  options: { method?: string; payload?: any; cookie?: string; host?: string } = {},
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
      origin: options.host ? "https://" + options.host : "http://localhost:3000",
      ...(options.host
        ? {
            [HOST_HEADERS.host]: options.host,
            [HOST_HEADERS.time]: time,
            [HOST_HEADERS.signature]: signHostRequest(options.host, method, url, time, secret),
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
      email: slug + "@dns-orders-fixture.test",
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
const worker = (tenantId: string) => elevated("worker", { tenantId, role: "owner" });
async function order(tenantId: string, id: string) {
  const [row] = await db.tenant(worker(tenantId), (tx) =>
    tx.query("SELECT * FROM domain_orders WHERE id=$1", [id]),
  );
  return row;
}
async function operations(tenantId: string, id: string) {
  return db.tenant(worker(tenantId), (tx) =>
    tx.query(
      "SELECT kind,intent_key,registrar,status,request,outcome FROM registrar_operations WHERE order_id=$1 ORDER BY created_at,id",
      [id],
    ),
  );
}
async function step(tenantId: string, id: string) {
  await db.tenant(worker(tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET next_attempt_at=now(),lease_until=NULL WHERE id=$1",
      [id],
    ),
  );
  await withIntegrationFixtureTransport(namecheap.fetch, () =>
    processWebAddressOrder(db, tenantId, id, deps),
  );
  return order(tenantId, id);
}
let eventNumber = 0;
const stripeEvent = (type: string, object: any) =>
  processStripeEvent(
    db,
    {
      id: "evt_dns_" + ++eventNumber,
      type,
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: { object },
    },
    { stripe: stripe as any },
  );
/** Checkout, payment and purchase: returns the order once registered (owned). */
async function buyAndRegister(owner: any, domain: string, serveMode?: "site" | "forward") {
  resetRegistrarBudget();
  const created = await withIntegrationFixtureTransport(namecheap.fetch, () =>
    request("/web-address/orders", {
      method: "POST",
      cookie: owner.cookie,
      payload: {
        domain,
        firstYearPriceMinor: 8400,
        renewalPriceMinor: 8400,
        accepted: true,
        ...(serveMode ? { serveMode } : {}),
      },
    }),
  );
  assert.equal(created.statusCode, 200, created.body);
  const id = created.json().orderId as string;
  const o = await order(owner.tenantId, id);
  const meta = { purpose: "web_address", tenant_id: o.tenant_id, web_address_order_id: o.id };
  const sub = "sub_dns_" + o.id.slice(0, 8);
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
    id: "in_dns_" + o.id.slice(0, 8),
    object: "invoice",
    status: "paid",
    currency: "aed",
    amount_paid: 8400,
    customer: "cus_" + o.id.slice(0, 8),
    payment_intent: "pi_dns_" + o.id.slice(0, 8),
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: sub, metadata: meta },
    },
  });
  const owned = await step(owner.tenantId, id);
  assert.equal(owned.status, "owned", JSON.stringify(owned.progress));
  return id;
}
async function mappings(names: string[]) {
  return db.system((tx) =>
    tx.query(
      "SELECT hostname,active,redirect FROM domain_mappings WHERE hostname=ANY($1::text[]) ORDER BY hostname",
      [names],
    ),
  );
}

let layla: any, sara: any, omar: any, nadia: any, admin: any;
let laylaOrder = "";
before(async () => {
  Object.assign(process.env, settings);
  clearWebAddressPriceCache();
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true, providers: { webAddresses: deps } });
  layla = await register("layla");
  sara = await register("sara");
  omar = await register("omar");
  nadia = await register("nadia");
  admin = await register("dns-ops-admin");
  await db.system(async (tx) => {
    await tx.query("UPDATE users SET platform_role='admin' WHERE id=$1", [admin.userId]);
    await tx.query("UPDATE sessions SET mfa_at=now() WHERE user_id=$1", [admin.userId]);
  });
});
after(async () => {
  await app?.close();
  await db?.close();
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

test("zone and records first, then delegation, then live: never a wildcard for a bought domain", async () => {
  laylaOrder = await buyAndRegister(layla, "layla.com");
  log.length = 0;
  hidden.add("layla.com");
  // 1. The zone and its A records at the DNS host, read back through its API.
  const zoned = await step(layla.tenantId, laylaOrder);
  assert.equal(zoned.status, "zone");
  assert.equal(zoned.dns_provider, "digitalocean");
  assert.deepEqual(digitalocean.view("layla.com"), [
    `@ A ${SERVER_IP}`,
    `www A ${SERVER_IP}`,
  ]);
  assert.ok(
    digitalocean.zones.get("layla.com")!.filter((r) => r.type === "A").every((r) => r.ttl === 600),
    "the configured TTL",
  );
  assert.ok(!log.some((l) => l.startsWith("nc domains.dns.setCustom")), "no delegation yet");
  // 2. Delegation: the registrar points the name at DigitalOcean.
  const delegating = await step(layla.tenantId, laylaOrder);
  assert.equal(delegating.status, "delegating");
  assert.deepEqual(namecheap.registrations.get("layla.com")!.nameservers, DO);
  const zoneCreated = log.indexOf("do POST /v2/domains");
  const nameserversSet = log.indexOf("nc domains.dns.setCustom");
  assert.ok(zoneCreated >= 0 && nameserversSet > zoneCreated, log.join(" | "));
  // Registrar host records were never written on this path.
  assert.equal(namecheap.commands("domains.dns.setHosts").length, 0);
  // 3. Public DNS does not show it yet: wait (bounded retries).
  const waiting = await step(layla.tenantId, laylaOrder);
  assert.equal(waiting.status, "delegating");
  assert.equal(waiting.attention, null);
  assert.equal(waiting.evidence.lastNote, "Delegation not visible yet");
  hidden.delete("layla.com");
  delegated.set("layla.com", DO);
  const visible = await step(layla.tenantId, laylaOrder);
  assert.equal(visible.status, "dns");
  // 4. DNS resolves through DigitalOcean; HTTPS is proven; the domain is live.
  const live = await step(layla.tenantId, laylaOrder);
  assert.equal(live.status, "active", JSON.stringify(live.evidence));
  assert.deepEqual(httpsChecks.slice(-2), ["layla.com", "www.layla.com"]);
  assert.deepEqual(await mappings(["layla.com", "www.layla.com"]), [
    { hostname: "layla.com", active: true, redirect: null },
    { hostname: "www.layla.com", active: true, redirect: "apex" },
  ]);
  assert.deepEqual(
    live.progress.map((p: any) => p.step),
    ["checkout", "paid", "purchasing", "registered", "zone", "connecting", "dns", "certificate", "live"],
  );
  // Every external step has its intent, in order.
  assert.deepEqual(
    (await operations(layla.tenantId, laylaOrder)).map((o: any) => [o.kind, o.registrar, o.status, o.intent_key.split(":")[0]]),
    [
      ["register", "namecheap", "succeeded", "register"],
      ["create_zone", "digitalocean", "succeeded", "zone"],
      ["set_records", "digitalocean", "succeeded", "records"],
      ["set_nameservers", "namecheap", "succeeded", "nameservers"],
    ],
  );
  // The trainer sees the steps and the price, never the DNS host or the registrar.
  for (const path of ["/web-address", `/web-address/orders/${laylaOrder}`]) {
    const r = await request(path, { cookie: layla.cookie });
    assert.equal(r.statusCode, 200);
    assert.doesNotMatch(r.body, /digitalocean|nameserver|namecheap|registrar|dns_provider/i, path);
  }
});

test("a DNS host failure is retried; the next read-back settles the earlier attempt", async () => {
  const id = await buyAndRegister(sara, "sara.com");
  // The records request reaches DigitalOcean but its answer is lost.
  digitalocean.failNext("POST", /\/records$/, 503, 1, true);
  const first = await step(sara.tenantId, id);
  assert.equal(first.status, "owned");
  assert.equal(first.evidence.lastNote, "DNS records not confirmed");
  let ops = await operations(sara.tenantId, id);
  assert.deepEqual(
    ops.map((o: any) => [o.kind, o.status]).slice(1),
    [
      ["create_zone", "succeeded"],
      ["set_records", "unknown"],
    ],
  );
  const second = await step(sara.tenantId, id);
  assert.equal(second.status, "zone");
  ops = await operations(sara.tenantId, id);
  assert.deepEqual(
    ops.map((o: any) => [o.kind, o.status, o.intent_key.split(":").pop()]).slice(1),
    [
      ["create_zone", "succeeded", "1"],
      ["set_records", "confirmed", "1"],
      ["create_zone", "succeeded", "2"],
      ["set_records", "succeeded", "2"],
    ],
  );
  assert.equal(ops[2].outcome.via, "read-back");
  // Converged, not duplicated.
  assert.deepEqual(digitalocean.view("sara.com"), [`@ A ${SERVER_IP}`, `www A ${SERVER_IP}`]);
  // A rate limit is also retried, after the provider's wait.
  digitalocean.failNext("GET", /^\/v2\/domains\/sara\.com$/, 429);
  const limited = await step(sara.tenantId, id);
  assert.equal(limited.status, "zone");
  assert.ok(Date.parse(limited.next_attempt_at) - Date.now() < 10000, "Retry-After of 2 s");
  const delegating = await step(sara.tenantId, id);
  assert.equal(delegating.status, "delegating");
});

test("a zone another DigitalOcean account holds is never delegated: the registrar's DNS serves the domain", async () => {
  digitalocean.foreign.add("omar.com");
  const id = await buyAndRegister(omar, "omar.com");
  const fallback = await step(omar.tenantId, id);
  assert.equal(fallback.status, "owned");
  assert.equal(fallback.dns_provider, "registrar");
  assert.ok(fallback.evidence.zoneHeldElsewhere);
  const hosted = await step(omar.tenantId, id);
  assert.equal(hosted.status, "dns");
  assert.deepEqual(
    namecheap.registrations.get("omar.com")!.hosts.map((h) => `${h.name} ${h.type} ${h.address}`),
    [`@ A ${SERVER_IP}`, `www A ${SERVER_IP}`],
  );
  assert.deepEqual(namecheap.registrations.get("omar.com")!.nameservers, [], "never delegated");
  assert.equal(digitalocean.zones.has("omar.com"), false);
  const live = await step(omar.tenantId, id);
  assert.equal(live.status, "active");
});

test("a domain with a DS (DNSSEC) record at the registry is not delegated to an unsigned zone", async () => {
  const id = await buyAndRegister(nadia, "nadia.com");
  dsRecords.set("nadia.com", ["2371 13 2 ABCDEF"]);
  assert.equal((await step(nadia.tenantId, id)).status, "zone");
  const stopped = await step(nadia.tenantId, id);
  assert.equal(stopped.status, "zone");
  assert.equal(stopped.next_attempt_at, null);
  assert.match(stopped.attention, /DS \(DNSSEC\)/);
  assert.deepEqual(namecheap.registrations.get("nadia.com")!.nameservers, []);
  // An operator moves it to the registrar's DNS instead.
  const moved = await request(`/admin/web-addresses/${id}/dns`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { provider: "registrar", reason: "DNSSEC is on at the registrar" },
  });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal(moved.json().status, "owned");
  assert.equal(moved.json().dns_provider, "registrar");
  assert.equal((await step(nadia.tenantId, id)).status, "dns");
});

test("forwarding: the owner's choice drives host routing and a permanent redirect in the web proxy", async () => {
  // Forwarding needs the workspace subdomain; any owner of another workspace sees nothing.
  const other = await request(`/web-address/orders/${laylaOrder}/serve-mode`, {
    method: "POST",
    cookie: sara.cookie,
    payload: { mode: "forward" },
  });
  assert.equal(other.statusCode, 404);
  const on = await request(`/web-address/orders/${laylaOrder}/serve-mode`, {
    method: "POST",
    cookie: layla.cookie,
    payload: { mode: "forward" },
  });
  assert.equal(on.statusCode, 200, on.body);
  assert.equal(on.json().serveMode, "forward");
  assert.deepEqual(await mappings(["layla.com", "www.layla.com"]), [
    { hostname: "layla.com", active: true, redirect: "subdomain" },
    { hostname: "www.layla.com", active: true, redirect: "apex" },
  ]);
  const hostContext = (host: string) => {
    const time = String(Date.now());
    return resolveRequestHost(
      db,
      {
        method: "GET",
        url: "/api/v1/public/host",
        headers: {
          host: "localhost:4000",
          [HOST_HEADERS.host]: host,
          [HOST_HEADERS.time]: time,
          [HOST_HEADERS.signature]: signHostRequest(host, "GET", "/api/v1/public/host", time, secret),
        },
      },
      { secret },
    );
  };
  assert.equal((await hostContext("layla.com")).redirect, "https://layla." + ROOT);
  assert.equal((await hostContext("www.layla.com")).redirect, "https://layla.com");
  // The real Next proxy, asking the real API for the host.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const r = await app.inject({ url: url.pathname, method: "GET", headers: { ...headers, host: "localhost:4000" } });
    return new Response(r.body, { status: r.statusCode, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const visit = (url: string) =>
      proxy(new NextRequest(url, { headers: { host: new URL(url).host } }));
    const page = await visit("https://layla.com/pricing?plan=gold");
    assert.equal(page.status, 301);
    assert.equal(page.headers.get("location"), `https://layla.${ROOT}/pricing?plan=gold`);
    assert.equal(page.headers.get("cache-control"), "public, max-age=3600");
    const www = await visit("https://www.layla.com/about");
    assert.equal(www.status, 301);
    assert.equal(www.headers.get("location"), "https://layla.com/about");
    // API requests are never redirected.
    const api = await visit("https://layla.com/api/v1/public/host");
    assert.ok(api.headers.get("x-middleware-rewrite"));
    // Back to showing the site: the page is served on the domain again.
    const offResponse = await request(`/web-address/orders/${laylaOrder}/serve-mode`, {
      method: "POST",
      cookie: layla.cookie,
      payload: { mode: "site" },
    });
    assert.equal(offResponse.json().serveMode, "site");
    const site = await visit("https://layla.com/");
    assert.equal(site.status, 200);
    assert.equal(new URL(site.headers.get("x-middleware-rewrite")!).pathname, "/coach/layla");
    assert.equal((await visit("https://www.layla.com/")).status, 301, "www still goes to the domain");
  } finally {
    globalThis.fetch = realFetch;
  }
  // Without the platform root there is nothing to forward to.
  process.env.PLATFORM_ROOT_DOMAIN = "";
  try {
    const refused = await request(`/web-address/orders/${laylaOrder}/serve-mode`, {
      method: "POST",
      cookie: layla.cookie,
      payload: { mode: "forward" },
    });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().code, "FORWARD_UNAVAILABLE");
  } finally {
    process.env.PLATFORM_ROOT_DOMAIN = ROOT;
  }
  // A tenant actor cannot set the redirect itself (column privilege).
  let denied: any = null;
  try {
    await db.tenant(
      { tenantId: layla.tenantId, userId: layla.userId, role: "owner" } as any,
      (tx) => tx.query("UPDATE domain_mappings SET redirect='subdomain' WHERE hostname='layla.com'"),
    );
  } catch (error) {
    denied = error;
  }
  assert.match(String(denied?.message), /permission denied/i);
  assert.deepEqual(await mappings(["layla.com"]), [
    { hostname: "layla.com", active: true, redirect: null },
  ]);
});

test("forward targets: only the workspace subdomain or the www apex are followed", () => {
  assert.equal(mappingRedirect("subdomain", "layla.com", "layla-fit", ROOT), "https://layla-fit." + ROOT);
  assert.equal(mappingRedirect("subdomain", "layla.com", "layla", null), undefined, "no root: show the site");
  assert.equal(mappingRedirect("subdomain", "layla.com", "www", ROOT), undefined, "reserved name");
  assert.equal(mappingRedirect("apex", "www.layla.com", "layla", ROOT), "https://layla.com");
  assert.equal(mappingRedirect("apex", "layla.com", "layla", ROOT), undefined);
  assert.equal(mappingRedirect(null, "layla.com", "layla", ROOT), undefined);
  assert.equal(forwardLocation("https://layla." + ROOT, "layla.com", ROOT), "https://layla." + ROOT);
  assert.equal(forwardLocation("https://layla.com", "www.layla.com", ROOT), "https://layla.com");
  for (const bad of [
    "https://evil.example",
    "http://layla." + ROOT,
    "https://a.b." + ROOT,
    "https://layla." + ROOT + ":8443",
    "https://layla." + ROOT + "/path",
    "https://user@layla." + ROOT,
    "javascript:alert(1)",
    "https://other.com",
  ])
    assert.equal(forwardLocation(bad, "www.layla.com", ROOT), null, bad);
  assert.equal(forwardLocation("https://layla." + ROOT, "layla.com", undefined), null);
  assert.equal(forwardLocation(42, "layla.com", ROOT), null);
});

test("operators can move a live domain back to the registrar's DNS; nameservers return first", async () => {
  const saraOrder = (await db.tenant(worker(sara.tenantId), (tx) =>
    tx.query("SELECT id FROM domain_orders WHERE hostname='sara.com'"),
  ))[0].id as string;
  delegated.set("sara.com", DO);
  assert.equal((await step(sara.tenantId, saraOrder)).status, "dns");
  assert.equal((await step(sara.tenantId, saraOrder)).status, "active");
  const moved = await request(`/admin/web-addresses/${saraOrder}/dns`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { provider: "registrar", reason: "Operator test of the fallback" },
  });
  assert.equal(moved.statusCode, 200, moved.body);
  const hosted = await step(sara.tenantId, saraOrder);
  assert.equal(hosted.status, "dns");
  assert.deepEqual(namecheap.registrations.get("sara.com")!.nameservers, [], "back on Namecheap DNS");
  const ops = await operations(sara.tenantId, saraOrder);
  const last = ops.slice(-2);
  assert.deepEqual(last.map((o: any) => [o.kind, o.status]), [
    ["set_nameservers", "succeeded"],
    ["set_hosts", "succeeded"],
  ]);
  assert.equal(last[0].request.nameservers, null);
  // The zone at DigitalOcean is kept (nothing is deleted here).
  assert.ok(digitalocean.zones.has("sara.com"));
  // Only the known DNS hosts can be chosen.
  const refused = await request(`/admin/web-addresses/${saraOrder}/dns`, {
    method: "POST",
    cookie: admin.cookie,
    payload: { provider: "unknown", reason: "An invalid provider name" },
  });
  assert.equal(refused.statusCode, 400);
});

test("lapse keeps the zone; it is released only once nothing delegates the name to DigitalOcean", async () => {
  await db.tenant(worker(layla.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET expires_at=now()-interval '1 minute',renewal_enabled=false,billing_status='canceled' WHERE id=$1",
      [laylaOrder],
    ),
  );
  const lapsed = await step(layla.tenantId, laylaOrder);
  assert.equal(lapsed.status, "expired");
  assert.ok(lapsed.evidence.zoneRetained);
  assert.ok(digitalocean.zones.has("layla.com"), "the zone stays at lapse");
  assert.deepEqual(await mappings(["layla.com", "www.layla.com"]), [
    { hostname: "layla.com", active: false, redirect: null },
    { hostname: "www.layla.com", active: false, redirect: "apex" },
  ]);
  // Before the release period: nothing is asked or deleted.
  const early = await step(layla.tenantId, laylaOrder);
  assert.equal(early.status, "expired");
  const due = Date.parse(early.next_attempt_at);
  const expected = Date.parse(early.expires_at) + ZONE_RELEASE_DAYS * 86400000;
  assert.ok(Math.abs(due - expected) < 5000);
  // After it, but the name still delegates to DigitalOcean: kept, checked weekly.
  await db.tenant(worker(layla.tenantId), (tx) =>
    tx.query("UPDATE domain_orders SET expires_at=now()-interval '50 days' WHERE id=$1", [laylaOrder]),
  );
  const kept = await step(layla.tenantId, laylaOrder);
  assert.ok(digitalocean.zones.has("layla.com"), "still delegated: never deleted");
  assert.equal(kept.evidence.zoneReleaseChecks, 1);
  assert.ok(Date.parse(kept.next_attempt_at) > Date.now() + 6 * 86400000);
  assert.ok(!(await operations(layla.tenantId, laylaOrder)).some((o: any) => o.kind === "delete_zone"));
  // The registrar parks the name on its own DNS: now the zone can go.
  namecheap.registrations.get("layla.com")!.nameservers = [];
  delegated.set("layla.com", NAMECHEAP_DNS);
  const released = await step(layla.tenantId, laylaOrder);
  assert.equal(digitalocean.zones.has("layla.com"), false);
  assert.ok(released.evidence.zoneReleasedAt);
  assert.equal(released.next_attempt_at, null);
  const deletion = (await operations(layla.tenantId, laylaOrder)).find((o: any) => o.kind === "delete_zone")!;
  assert.equal(deletion.status, "succeeded");
  assert.deepEqual(deletion.request.registrarNameservers, NAMECHEAP_DNS);
  // A late renewal provisions again: a new zone, then the nameservers again.
  await db.tenant(worker(layla.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET status='owned',expires_at=now()+interval '300 days' WHERE id=$1",
      [laylaOrder],
    ),
  );
  assert.equal((await step(layla.tenantId, laylaOrder)).status, "zone");
  assert.equal((await step(layla.tenantId, laylaOrder)).status, "delegating");
  assert.deepEqual(namecheap.registrations.get("layla.com")!.nameservers, DO);
  assert.deepEqual(digitalocean.view("layla.com"), [`@ A ${SERVER_IP}`, `www A ${SERVER_IP}`]);
});

test("the worker picks up orders a previous release paused in the new statuses", async () => {
  const saraOrder = (await db.tenant(worker(sara.tenantId), (tx) =>
    tx.query("SELECT id FROM domain_orders WHERE hostname='sara.com'"),
  ))[0].id as string;
  await db.tenant(worker(sara.tenantId), (tx) =>
    tx.query(
      "UPDATE domain_orders SET status='owned',dns_provider='digitalocean' WHERE id=$1",
      [saraOrder],
    ),
  );
  await step(sara.tenantId, saraOrder); // owned → zone
  await db.tenant(worker(sara.tenantId), (tx) =>
    tx.query("UPDATE domain_orders SET next_attempt_at=NULL,attention=NULL WHERE id=$1", [saraOrder]),
  );
  await withIntegrationFixtureTransport(namecheap.fetch, () => processWebAddressOrders(db, deps));
  const resumed = await order(sara.tenantId, saraOrder);
  assert.equal(resumed.status, "delegating");
});
