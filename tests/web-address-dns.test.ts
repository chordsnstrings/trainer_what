// DNS hosting and nameserver adapters (docs/features/web-addresses.md, "DNS
// hosting"): the DigitalOcean DNS adapter against its double (request shapes,
// zone guard, idempotent convergence by name and type, error mapping,
// takeover-safe zone deletion), registrar nameservers for Namecheap, the
// generic API and 101domain, the 101domain registrar adapter, public DNS
// over HTTPS, and the Super admin settings and connection checks. No network:
// every request goes through a test transport or the fixture transport.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withIntegrationFixtureTransport } from "../packages/providers/src/integrations.ts";
import {
  DIGITALOCEAN_NAMESERVERS,
  DigitalOceanDns,
  DnsError,
  RegistrarHostedDns,
  dnsHostingFromConfig,
  planRecordChanges,
  publicDnsLookup,
  sameNameservers,
  type DnsRecord,
} from "../packages/providers/src/dns-hosting.ts";
import {
  GenericRegistrar,
  NamecheapRegistrar,
  OneOhOneRegistrar,
  RegistrarError,
  canRegister,
  registrarFromConfig,
  registrarPurchaseProblem,
  registrarSandboxSetting,
} from "../packages/providers/src/registrar.ts";
import {
  integrationCapability,
  testIntegration,
  validateIntegrationValues,
} from "../packages/providers/src/configuration.ts";
import { DigitalOceanMock } from "./e2e/mocks/digitalocean.ts";
import { NamecheapMock, NAMECHEAP_DNS } from "./e2e/mocks/namecheap.ts";
import { RegistrarMock } from "./e2e/mocks/registrar.ts";
import { OneOhOneMock } from "./e2e/mocks/oneohone.ts";
import { createMockTls } from "./e2e/mocks/tls.ts";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer, type AddressInfo, type Server } from "node:net";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { httpsProbe } from "../apps/api/src/web-address-orders.ts";

const tls = { key: "unused", cert: "unused" };
const TOKEN = "dop_v1_fixture_token_0123456789";
const DO = [...DIGITALOCEAN_NAMESERVERS];
const registrant = {
  firstName: "Platform",
  lastName: "Owner",
  organization: "TrainsYou FZ-LLC",
  address1: "1 Fixture Street",
  city: "Dubai",
  stateProvince: "Dubai",
  postalCode: "00000",
  country: "AE",
  phone: "+971.501234567",
  email: "domains@trainsyou.test",
};
const doFor = (mock: DigitalOceanMock, zones: string[], protectedZones: string[] = []) =>
  new DigitalOceanDns(
    TOKEN,
    {
      mayManage: (zone) => zones.includes(zone),
      protectedZone: (zone) => protectedZones.includes(zone),
    },
    { transport: mock.fetch },
  );
const a = (name: string, data: string, ttl = 1800) => ({
  name,
  type: "A" as const,
  data,
  ttl,
});

test("DigitalOcean: zone creation, read-back and a zone another account holds", async () => {
  const mock = new DigitalOceanMock(tls, TOKEN);
  const dns = doFor(mock, ["layla.com", "taken.com"]);
  assert.deepEqual(dns.nameservers(), DO);
  assert.equal(await dns.getZone("layla.com"), null);
  assert.equal(await dns.ensureZone("layla.com"), "created");
  // Created without ip_address: every record is written explicitly.
  const create = mock.calls.find((c) => c.method === "POST" && c.path === "/v2/domains");
  assert.deepEqual(create?.body, { name: "layla.com" });
  assert.equal(await dns.ensureZone("layla.com"), "existing");
  assert.equal(mock.calls.filter((c) => c.method === "POST").length, 1, "never created twice");
  // Another DigitalOcean account added the name first: 422, and it is not ours.
  mock.foreign.add("taken.com");
  assert.equal(await dns.ensureZone("taken.com"), "held_elsewhere");
  assert.equal(mock.zones.has("taken.com"), false);
  // A lost answer to a create that happened is read back as created.
  const lost = doFor(mock, ["lost.com"]);
  mock.failNext("POST", /^\/v2\/domains$/, 504, 1, true);
  assert.equal(await lost.ensureZone("lost.com"), "created");
  assert.ok(mock.zones.has("lost.com"));
});

test("DigitalOcean: the zone guard refuses every other zone before any request", async () => {
  const mock = new DigitalOceanMock(tls, TOKEN);
  mock.seed("fleetkeel.com", [a("@", "192.0.2.10")]);
  const dns = doFor(mock, ["layla.com"]);
  const before = mock.calls.length;
  for (const call of [
    () => dns.getZone("fleetkeel.com"),
    () => dns.ensureZone("uaeasp.ae"),
    () => dns.records("fleetkeel.com"),
    () => dns.upsertRecords("fleetkeel.com", [a("@", "203.0.113.7")]),
    () =>
      dns.deleteZone("fleetkeel.com", {
        registrarNameservers: null,
        publicNameservers: "nxdomain",
      }),
    () => dns.getZone("LAYLA.COM.evil"),
  ])
    await assert.rejects(call, (e: any) => e instanceof DnsError && e.code === "ZONE_NOT_MANAGED");
  assert.equal(mock.calls.length, before, "no request reached DigitalOcean");
  assert.deepEqual(mock.view("fleetkeel.com"), ["@ A 192.0.2.10"]);
});

test("DigitalOcean: records converge by name and type; a second run changes nothing", async () => {
  const mock = new DigitalOceanMock(tls, TOKEN);
  mock.seed("layla.com", [
    a("@", "192.0.2.1"),
    { name: "www", type: "CNAME", data: "parking.example." },
    { name: "@", type: "AAAA", data: "2001:db8::1" },
    { name: "@", type: "MX", data: "mail.layla.com.", priority: 10 },
    { name: "@", type: "TXT", data: "v=spf1 -all" },
    a("shop", "192.0.2.50"),
  ]);
  const dns = doFor(mock, ["layla.com"]);
  const desired = [a("@", "203.0.113.7"), a("www", "203.0.113.7")];
  const first = await dns.upsertRecords("layla.com", desired, {
    replaceTypes: ["AAAA", "CNAME"],
  });
  assert.deepEqual(first, { created: 1, updated: 1, deleted: 2, unchanged: 0 });
  assert.deepEqual(mock.view("layla.com"), [
    "@ A 203.0.113.7",
    "@ MX mail.layla.com.",
    "@ TXT v=spf1 -all",
    "shop A 192.0.2.50",
    "www A 203.0.113.7",
  ]);
  const second = await dns.upsertRecords("layla.com", desired, {
    replaceTypes: ["AAAA", "CNAME"],
  });
  assert.deepEqual(second, { created: 0, updated: 0, deleted: 0, unchanged: 2 });
  // The conflicting CNAME is removed before the A record on the same name.
  const writes = mock.calls.filter((c) => c.method !== "GET").map((c) => c.method);
  assert.deepEqual(writes.slice(0, 4), ["DELETE", "DELETE", "PATCH", "POST"]);
  // Records of more than one page are all read.
  mock.seed(
    "big.com",
    Array.from({ length: 450 }, (_, i) => ({ name: `n${i}`, type: "TXT", data: `t${i}` })),
  );
  assert.equal((await doFor(mock, ["big.com"]).records("big.com")).length, 453);
  await assert.rejects(
    () => dns.upsertRecords("layla.com", [a("@", "not-an-ip")]),
    (e: any) => e.code === "INVALID_RECORD",
  );
});

test("planRecordChanges keeps other names and types and reuses unwanted records", () => {
  const existing: DnsRecord[] = [
    { id: "1", name: "@", type: "A", data: "192.0.2.1", ttl: 1800 },
    { id: "2", name: "@", type: "A", data: "192.0.2.2", ttl: 1800 },
    { id: "3", name: "www", type: "A", data: "203.0.113.7", ttl: 60 },
    { id: "4", name: "*", type: "AAAA", data: "2001:db8::2", ttl: 1800 },
    { id: "5", name: "mail", type: "A", data: "192.0.2.9", ttl: 1800 },
  ];
  const changes = planRecordChanges(
    existing,
    [a("@", "203.0.113.7"), a("www", "203.0.113.7"), a("*", "203.0.113.7")],
    ["AAAA", "CNAME"],
  );
  assert.deepEqual(
    changes.map((c) => [c.action, c.action === "create" ? c.record.name : (c as any).id]),
    [
      // The AAAA on * would shadow the new A record.
      ["delete", "4"],
      // An unwanted @ A record is reused for the wanted address.
      ["update", "1"],
      // www has the address already; only its TTL changes.
      ["update", "3"],
      ["create", "*"],
      ["delete", "2"],
    ],
  );
});

test("DigitalOcean: errors map to definitive or unknown like the registrar adapters", async () => {
  const mock = new DigitalOceanMock(tls, TOKEN);
  const wrong = new DigitalOceanDns("dop_v1_wrong", { mayManage: () => true }, { transport: mock.fetch });
  await assert.rejects(
    () => wrong.getZone("layla.com"),
    (e: any) => e instanceof DnsError && e.outcome === "definitive" && e.code === "unauthorized",
  );
  const dns = doFor(mock, ["layla.com"]);
  mock.failNext("GET", /^\/v2\/domains\/layla\.com$/, 429);
  await assert.rejects(
    () => dns.getZone("layla.com"),
    (e: any) => e.outcome === "unknown" && e.retryAfterMs === 2000,
  );
  mock.failNext("GET", /^\/v2\/domains\/layla\.com$/, 502);
  await assert.rejects(() => dns.getZone("layla.com"), (e: any) => e.outcome === "unknown");
  const down = new DigitalOceanDns(TOKEN, { mayManage: () => true }, {
    transport: async () => {
      throw new Error("ECONNRESET");
    },
  });
  await assert.rejects(() => down.getZone("layla.com"), (e: any) => e.outcome === "unknown");
  // Only the isolated test runner may inject a transport.
  const env = process.env as Record<string, string | undefined>;
  const mode = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    assert.throws(() => doFor(mock, ["layla.com"]));
  } finally {
    if (mode === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = mode;
  }
});

test("DigitalOcean: a zone is deleted only when nothing delegates to it; the root never", async () => {
  const mock = new DigitalOceanMock(tls, TOKEN);
  mock.seed("lapsed.com", [a("@", "203.0.113.7")]);
  mock.seed("trainsyou.com", [a("@", "203.0.113.7")]);
  const dns = doFor(mock, ["lapsed.com", "trainsyou.com"], ["trainsyou.com"]);
  for (const evidence of [
    { registrarNameservers: DO, publicNameservers: "nxdomain" as const },
    { registrarNameservers: null, publicNameservers: DO },
    { registrarNameservers: ["NS1.DigitalOcean.com."], publicNameservers: [] },
  ])
    await assert.rejects(
      () => dns.deleteZone("lapsed.com", evidence),
      (e: any) => e.code === "STILL_DELEGATED",
    );
  assert.ok(mock.zones.has("lapsed.com"), "kept while delegated");
  await assert.rejects(
    () => dns.deleteZone("trainsyou.com", { registrarNameservers: null, publicNameservers: "nxdomain" }),
    (e: any) => e.code === "PROTECTED_ZONE",
  );
  await dns.deleteZone("lapsed.com", {
    registrarNameservers: ["dns1.registrar-servers.com", "dns2.registrar-servers.com"],
    publicNameservers: "nxdomain",
  });
  assert.equal(mock.zones.has("lapsed.com"), false);
  // Deleting again is harmless (already gone).
  await dns.deleteZone("lapsed.com", { registrarNameservers: null, publicNameservers: "nxdomain" });
  assert.ok(mock.zones.has("trainsyou.com"));
});

test("Namecheap nameservers: setCustom, getList read-back, setDefault; host records need Namecheap DNS", async () => {
  const account = {
    apiUser: "trainsyou",
    apiKey: "nc-fixture-key-0123456789",
    username: "trainsyou",
    clientIp: "1.2.3.4",
  };
  const mock = new NamecheapMock(tls, account);
  const nc = new NamecheapRegistrar({ ...account, sandbox: true }, { transport: mock.fetch });
  await nc.register({ domain: "layla.com", years: 1, registrant });
  assert.deepEqual(await nc.getNameservers("layla.com"), {
    nameservers: NAMECHEAP_DNS,
    usingRegistrarDns: true,
  });
  const set = await nc.setNameservers("layla.com", ["NS1.DigitalOcean.com.", "ns2.digitalocean.com", "ns3.digitalocean.com"]);
  assert.deepEqual(set, { nameservers: DO, usingRegistrarDns: false });
  const sent = mock.commands("domains.dns.setCustom").at(-1)!;
  assert.deepEqual(
    { SLD: sent.params.SLD, TLD: sent.params.TLD, Nameservers: sent.params.Nameservers },
    { SLD: "layla", TLD: "com", Nameservers: DO.join(",") },
  );
  assert.equal(mock.commands("domains.dns.getList").length, 2, "the change is read back");
  await assert.rejects(
    () => nc.setHosts("layla.com", [{ name: "@", type: "A", address: "203.0.113.7", ttl: 1800 }]),
    (e: any) => e instanceof RegistrarError && e.code === "2030288",
  );
  await assert.rejects(
    () => nc.setNameservers("layla.com", ["only-one.example"]),
    (e: any) => e.code === "INVALID_NAMESERVERS",
  );
  // The registrar's own DNS: returned to Namecheap's nameservers first, then
  // the complete host set is written and read back.
  const hosted = new RegistrarHostedDns(nc, { mayManage: (z) => z === "layla.com" });
  assert.equal(hosted.nameservers(), null);
  assert.equal(await hosted.ensureZone("layla.com"), "existing");
  assert.equal(mock.commands("domains.dns.setDefault").length, 1);
  await hosted.upsertRecords("layla.com", [a("@", "203.0.113.7"), a("www", "203.0.113.7")]);
  assert.deepEqual(
    mock.registrations.get("layla.com")!.hosts.map((h) => `${h.name} ${h.type} ${h.address}`),
    ["@ A 203.0.113.7", "www A 203.0.113.7"],
  );
  await assert.rejects(() => hosted.records("other.com"), (e: any) => e.code === "ZONE_NOT_MANAGED");
});

test("generic registrar nameservers against its double", async () => {
  const mock = new RegistrarMock(tls, "generic-key");
  const generic = new GenericRegistrar("https://registrar.test", "generic-key", {
    transport: async (url, init) => {
      const target = new URL(url);
      const r = await mock.server.inject({
        method: init.method ?? "GET",
        url: target.pathname + target.search,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        body: typeof init.body === "string" ? init.body : undefined,
      });
      return new Response(r.body, { status: r.status, headers: r.headers });
    },
  });
  await generic.register({ domain: "layla.com", years: 1, registrant });
  assert.equal((await generic.getNameservers("layla.com")).usingRegistrarDns, true);
  const set = await generic.setNameservers("layla.com", DO);
  assert.deepEqual(set.nameservers, DO);
  assert.equal(set.usingRegistrarDns, false);
  assert.equal((await generic.setNameservers("layla.com", null)).usingRegistrarDns, true);
});

test("101domain: availability, prices, details, balance and nameservers against its double", async () => {
  const mock = new OneOhOneMock(tls, "k101-fixture");
  const calls: Array<{ method: string; path: string; auth: string | null }> = [];
  const transport = async (url: string, init: RequestInit) => {
    calls.push({
      method: init.method ?? "GET",
      path: new URL(url).pathname + new URL(url).search,
      auth: new Headers(init.headers).get("authorization"),
    });
    return mock.fetch(url, init);
  };
  const r101 = new OneOhOneRegistrar("k101-fixture", { transport });
  assert.equal(r101.id, "101domain");
  assert.equal(r101.sandbox, false, "no test environment: live outside the mock sandbox");
  mock.taken.add("layla.net");
  mock.premium.add("gold.com");
  const one = await r101.check(["layla.com"]);
  assert.deepEqual(one, [{ domain: "layla.com", available: true, premium: false, premiumRegisterUsd: undefined }]);
  assert.equal(calls.at(-1)!.path, "/v1/domains/search?domain_name=layla.com");
  assert.equal(calls.at(-1)!.auth, "Bearer k101-fixture");
  const bulk = await r101.check(["layla.com", "gold.com", "bad_name.com", "layla.fit"]);
  assert.deepEqual(
    bulk.map((x) => [x.domain, x.available, x.premium]),
    [
      ["layla.com", true, false],
      ["gold.com", true, true],
      ["bad_name.com", false, false],
      ["layla.fit", true, false],
    ],
  );
  assert.equal(calls.at(-1)!.path, "/v1/domains/bulk-search");
  assert.deepEqual(await r101.pricing("com"), { tld: "com", registerUsd: "14.99", renewUsd: "19.99" });
  assert.deepEqual(await r101.pricing("ae"), { tld: "ae", registerUsd: "62.99", renewUsd: "71.99" });
  // Live, 101domain flags an ending that needs documents only with
  // has_requirements (true for .co.ae): it is refused, never priced.
  await assert.rejects(() => r101.pricing("co.ae"), (e: any) => e.code === "REQUIREMENTS");
  await assert.rejects(() => r101.pricing("zz"), (e: any) => e.outcome === "definitive");
  assert.deepEqual(await r101.balance(), { currency: "USD", available: "250.00" });
  mock.balance = "0.00";
  assert.deepEqual(await r101.balance(), { currency: "USD", available: "0.00" }, "an empty balance is still read");
  mock.balance = "250.00";
  // Registration is not published by 101domain yet: nothing is sent.
  const before = calls.length;
  assert.equal(canRegister(r101), false);
  await assert.rejects(
    () => r101.register({ domain: "layla.com", years: 1, registrant }),
    (e: any) => e.outcome === "definitive" && e.code === "UNSUPPORTED",
  );
  await assert.rejects(() => r101.renew("layla.com", 1), (e: any) => e.code === "UNSUPPORTED");
  assert.equal(calls.length, before, "no ordering request was sent");
  // With ordering verified: the platform company is every contact, privacy
  // where the ending offers it, and no registrar-side auto-renewal.
  const ordering = new OneOhOneRegistrar("k101-fixture", { ordering: true, transport: mock.fetch });
  const bought = await ordering.register({ domain: "layla.com", years: 1, registrant });
  assert.equal(bought.registered, true);
  const stored = mock.registrations.get("layla.com")!;
  assert.equal(stored.contacts.registrant.organization, "TrainsYou FZ-LLC");
  assert.equal(stored.privacy, true);
  assert.equal(stored.autoRenew, false);
  await ordering.register({ domain: "layla.ae", years: 1, registrant });
  assert.equal(mock.registrations.get("layla.ae")!.privacy, false, ".ae has no private registration");
  // An order still processing is an unknown outcome, reconciled later.
  mock.processing.add("slow.com");
  await assert.rejects(
    () => ordering.register({ domain: "slow.com", years: 1, registrant }),
    (e: any) => e.outcome === "unknown" && e.code === "PENDING",
  );
  assert.equal(await ordering.pendingOrder("slow.com"), true);
  // The live order list has no domain filter and its rows name no domain:
  // an open order of another domain is opened and not mistaken for this one.
  mock.addOrder("other.com", "Registration", "processing");
  assert.equal(await ordering.pendingOrder("layla.com"), false);
  mock.finishProcessing("slow.com");
  assert.equal(await ordering.pendingOrder("slow.com"), false);
  // A status the adapter does not know counts as still open.
  mock.addOrder("slow.com", "Renewal", "awaiting_registry");
  assert.equal(await ordering.pendingOrder("slow.com"), true);
  mock.finishOrders("slow.com");
  assert.equal(await ordering.pendingOrder("slow.com"), false);
  assert.deepEqual((await ordering.list("slow.com")).map((d) => d.domain), ["slow.com"]);
  const info = await ordering.info("layla.com");
  // 101domain's domain details carry no privacy flag (an add-on product id).
  assert.equal(info.whoisPrivacy, false);
  assert.equal(info.usingRegistrarDns, true);
  assert.ok(Date.parse(info.expiresAt!) > Date.now() + 360 * 86400000);
  await assert.rejects(() => ordering.info("nobody.com"), (e: any) => e.outcome === "definitive" && e.code === "NOT_FOUND");
  const renewed = await ordering.renew("layla.com", 1);
  assert.ok(Date.parse(renewed.expiresAt!) > Date.parse(info.expiresAt!) + 360 * 86400000);
  // Nameservers: 202 while the registry applies the change. The read-back
  // is the list in force (no pending flag): the old one until it is applied.
  mock.registryDelayReads = 1;
  const pending = await ordering.setNameservers("layla.com", DO);
  assert.equal(pending.pending, true);
  const lagging = await ordering.getNameservers("layla.com");
  assert.equal(lagging.pending, false);
  assert.equal(sameNameservers(lagging.nameservers, DO), false);
  assert.equal(lagging.usingRegistrarDns, true);
  const applied = await ordering.getNameservers("layla.com");
  assert.equal(applied.pending, false);
  assert.ok(sameNameservers(applied.nameservers, DO));
  assert.equal(applied.usingRegistrarDns, false);
  // Sending the same list again is a 200 without a change.
  mock.registryDelayReads = 0;
  assert.equal((await ordering.setNameservers("layla.com", DO)).pending, false);
  await assert.rejects(() => ordering.setNameservers("layla.com", null), (e: any) => e.code === "UNSUPPORTED");
  // DNS records answer only while 101domain's own nameservers are used.
  await assert.rejects(() => ordering.getHosts("layla.com"), (e: any) => e.code === "NAMESERVERS_NOT_LOCAL");
  await ordering.setHosts("layla.ae", [
    { name: "@", type: "A", address: "203.0.113.7", ttl: 1800 },
    { name: "www", type: "A", address: "203.0.113.7", ttl: 60 },
  ]);
  await ordering.setHosts("layla.ae", [{ name: "@", type: "A", address: "203.0.113.8", ttl: 1800 }]);
  assert.deepEqual(
    mock.registrations.get("layla.ae")!.records.map((r) => `${r.name} ${r.type} ${r.value} ${r.ttl}`),
    ["@ A 203.0.113.8 1800"],
  );
});

test("101domain: refusals are definitive; rate limits and server errors are unknown", async () => {
  const mock = new OneOhOneMock(tls, "k101-fixture");
  const wrong = new OneOhOneRegistrar("wrong", { transport: mock.fetch });
  await assert.rejects(() => wrong.balance(), (e: any) => e.outcome === "definitive" && e.code === "UNAUTHORIZED");
  for (const status of [429, 500, 503]) {
    const busy = new OneOhOneRegistrar("k101-fixture", {
      transport: async () =>
        new Response(JSON.stringify({ status: "error", code: "TOO_MANY_REQUESTS", message: "slow down" }), {
          status,
          headers: { "content-type": "application/json" },
        }),
    });
    await assert.rejects(() => busy.balance(), (e: any) => e.outcome === "unknown", String(status));
  }
});

test("registrar and DNS host choice from settings; purchases wait for 101domain ordering", () => {
  const base = { WEB_ADDRESS_REGISTRAR: "101domain", REGISTRAR_101DOMAIN_API_KEY: "k" };
  assert.equal(registrarFromConfig(base).id, "101domain");
  assert.equal(registrarFromConfig(base).capabilities?.register, false);
  assert.equal(
    registrarFromConfig({ ...base, REGISTRAR_101DOMAIN_ORDERING: "true" }).capabilities?.register,
    true,
  );
  assert.throws(() => registrarFromConfig({ WEB_ADDRESS_REGISTRAR: "101domain" }), /API key/);
  assert.equal(registrarSandboxSetting(base), false);
  assert.match(registrarPurchaseProblem(base) ?? "", /not published/);
  // 101domain's own DNS cannot be set up through its API: its domains need
  // DigitalOcean DNS before anything is bought.
  assert.match(
    registrarPurchaseProblem({ ...base, REGISTRAR_101DOMAIN_ORDERING: "true" }) ?? "",
    /DigitalOcean DNS/,
  );
  assert.equal(
    registrarPurchaseProblem({ ...base, REGISTRAR_101DOMAIN_ORDERING: "true", DNS_PROVIDER: "digitalocean" }),
    null,
  );
  assert.equal(registrarPurchaseProblem({ WEB_ADDRESS_REGISTRAR: "namecheap" }), null);
  const guard = { mayManage: () => true };
  const registrar = () => registrarFromConfig({ WEB_ADDRESS_REGISTRAR: "generic", DOMAIN_API_URL: "https://registrar.test", DOMAIN_API_KEY: "k" });
  assert.equal(dnsHostingFromConfig(guard, registrar, {}).id, "registrar");
  assert.equal(
    dnsHostingFromConfig(guard, registrar, { DNS_PROVIDER: "digitalocean", DIGITALOCEAN_DNS_TOKEN: TOKEN }).id,
    "digitalocean",
  );
  assert.throws(() => dnsHostingFromConfig(guard, registrar, { DNS_PROVIDER: "digitalocean" }), /token is missing/);
});

test("DNS hosting settings: validation, capability and a read-only connection check", async () => {
  assert.deepEqual(
    validateIntegrationValues("dns_hosting", {
      DNS_PROVIDER: "digitalocean",
      DNS_RECORD_TTL: "300",
      DNS_PLATFORM_ZONE: "trainsyou.com",
      DIGITALOCEAN_DNS_TOKEN_EXPIRES: "2027-09-28",
    }),
    {
      DNS_PROVIDER: "digitalocean",
      DNS_RECORD_TTL: "300",
      DNS_PLATFORM_ZONE: "trainsyou.com",
      DIGITALOCEAN_DNS_TOKEN_EXPIRES: "2027-09-28",
    },
  );
  for (const [key, value] of [
    ["DNS_PROVIDER", "cloudflare"],
    ["DNS_RECORD_TTL", "10"],
    ["DNS_RECORD_TTL", "90000"],
    ["DNS_PLATFORM_ZONE", "https://trainsyou.com/"],
    ["DNS_PLATFORM_ZONE", "203.0.113.7"],
    ["DIGITALOCEAN_DNS_TOKEN_EXPIRES", "2027-02-30"],
  ])
    assert.throws(() => validateIntegrationValues("dns_hosting", { [key]: value }), key + "=" + value);
  assert.throws(() =>
    validateIntegrationValues("web_addresses", { REGISTRAR_101DOMAIN_KEY_EXPIRES: "next year" }),
  );
  assert.deepEqual(integrationCapability("dns_hosting", {}), { configured: true, approved: true });
  assert.deepEqual(integrationCapability("dns_hosting", { DNS_PROVIDER: "digitalocean" }), {
    configured: false,
    approved: false,
  });
  assert.equal((await testIntegration("dns_hosting", { DNS_PROVIDER: "registrar" })).status, "validated");
  const mock = new DigitalOceanMock(tls, TOKEN);
  mock.seed("fleetkeel.com", []);
  mock.seed("uaeasp.ae", []);
  mock.seed("trainsyou.com", []);
  const result = await withIntegrationFixtureTransport(mock.fetch, () =>
    testIntegration("dns_hosting", {
      DNS_PROVIDER: "digitalocean",
      DIGITALOCEAN_DNS_TOKEN: TOKEN,
      DIGITALOCEAN_DNS_TOKEN_EXPIRES: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
    }),
  );
  assert.equal(result.status, "verified", result.message);
  assert.equal(result.details?.zonesVisible, 3);
  assert.match(result.message, /reaches 3 zones.*dedicated team.*expires in (9|10) days/s);
  // Lists at most one domain and names none of the account's domains.
  assert.deepEqual(mock.calls.map((c) => `${c.method} ${c.path}`), ["GET /v2/domains?per_page=1"]);
  assert.doesNotMatch(JSON.stringify(result), /fleetkeel|uaeasp|trainsyou/);
  const refused = await withIntegrationFixtureTransport(mock.fetch, () =>
    testIntegration("dns_hosting", { DNS_PROVIDER: "digitalocean", DIGITALOCEAN_DNS_TOKEN: "dop_v1_bad" }),
  );
  assert.equal(refused.status, "failed");
  const expired = await testIntegration("dns_hosting", {
    DNS_PROVIDER: "digitalocean",
    DIGITALOCEAN_DNS_TOKEN: TOKEN,
    DIGITALOCEAN_DNS_TOKEN_EXPIRES: "2020-01-01",
  });
  assert.equal(expired.status, "failed");
});

test("101domain connection check reads the balance only and says ordering is off", async () => {
  const mock = new OneOhOneMock(tls, "k101-fixture");
  const seen: string[] = [];
  const contact = {
    WEB_ADDRESS_REGISTRANT_FIRST_NAME: "Platform",
    WEB_ADDRESS_REGISTRANT_LAST_NAME: "Owner",
    WEB_ADDRESS_REGISTRANT_ORGANIZATION: "TrainsYou FZ-LLC",
    WEB_ADDRESS_REGISTRANT_ADDRESS: "1 Fixture Street",
    WEB_ADDRESS_REGISTRANT_CITY: "Dubai",
    WEB_ADDRESS_REGISTRANT_STATE: "Dubai",
    WEB_ADDRESS_REGISTRANT_POSTAL_CODE: "00000",
    WEB_ADDRESS_REGISTRANT_COUNTRY: "AE",
    WEB_ADDRESS_REGISTRANT_PHONE: "+971.501234567",
    WEB_ADDRESS_REGISTRANT_EMAIL: "domains@trainsyou.test",
  };
  const result = await withIntegrationFixtureTransport(
    async (url, init) => {
      seen.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
      return mock.fetch(url, init);
    },
    () =>
      testIntegration("web_addresses", {
        ...contact,
        WEB_ADDRESS_REGISTRAR: "101domain",
        REGISTRAR_101DOMAIN_API_KEY: "k101-fixture",
      }),
  );
  assert.equal(result.status, "verified", result.message);
  assert.deepEqual(seen, ["GET /v1/finance/balance"]);
  assert.match(result.message, /No domain was bought.*not published/s);
  assert.equal(result.details?.ordering, false);
  assert.deepEqual(
    integrationCapability("web_addresses", { ...contact, WEB_ADDRESS_REGISTRAR: "101domain" }),
    { configured: false, approved: false },
  );
});

test("public DNS over HTTPS: NS answers, no such domain, fallback to the second resolver", async () => {
  const asked: string[] = [];
  const answer = (host: string, body: unknown, status = 200) => ({ host, body, status });
  const plan = [
    answer("cloudflare-dns.com", {
      Status: 0,
      Answer: [
        { name: "layla.com.", type: 2, TTL: 300, data: "ns1.digitalocean.com." },
        { name: "layla.com.", type: 2, TTL: 300, data: "NS2.digitalocean.com." },
        { name: "layla.com.", type: 46, TTL: 300, data: "ignored signature" },
      ],
    }),
    answer("cloudflare-dns.com", { Status: 3 }),
    answer("cloudflare-dns.com", "unavailable", 503),
    answer("dns.google", { Status: 0, Answer: [{ type: 43, data: "2371 13 2 ABCDEF" }] }),
  ];
  await withIntegrationFixtureTransport(
    async (url, init) => {
      const target = new URL(url);
      asked.push(`${target.hostname} ${target.searchParams.get("name")} ${target.searchParams.get("type")}`);
      assert.equal(new Headers(init.headers).get("accept"), "application/dns-json");
      const next = plan.shift()!;
      assert.equal(target.hostname, next.host);
      return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
        status: next.status,
      });
    },
    async () => {
      assert.deepEqual(await publicDnsLookup("layla.com", "NS"), {
        status: "ok",
        answers: ["ns1.digitalocean.com", "ns2.digitalocean.com"],
      });
      assert.deepEqual(await publicDnsLookup("gone.com", "NS"), { status: "nxdomain", answers: [] });
      assert.deepEqual(await publicDnsLookup("signed.com", "DS"), {
        status: "ok",
        answers: ["2371 13 2 ABCDEF"],
      });
    },
  );
  assert.deepEqual(asked, [
    "cloudflare-dns.com layla.com NS",
    "cloudflare-dns.com gone.com NS",
    "cloudflare-dns.com signed.com DS",
    "dns.google signed.com DS",
  ]);
  await assert.rejects(
    () =>
      withIntegrationFixtureTransport(
        async () => new Response("down", { status: 502 }),
        () => publicDnsLookup("layla.com", "NS"),
      ),
    (e: any) => e instanceof DnsError && e.outcome === "unknown",
  );
});

test("the HTTPS check: any answer (a 301 included) with a valid certificate passes; a wrong certificate or silence fails", async (t) => {
  if (spawnSync("openssl", ["version"]).status !== 0) return t.skip("openssl is unavailable");
  const material = createMockTls(tmpdir(), ["shop.test"]);
  const servers: Server[] = [];
  const listen = (server: Server) =>
    new Promise<number>((resolve) => {
      servers.push(server);
      server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    });
  try {
    const loopback = { address: "127.0.0.1", family: 4 };
    const forwarding = await listen(
      createHttpsServer({ key: material.domains!.key, cert: material.domains!.cert }, (req, res) => {
        res.writeHead(301, { location: "https://shop.trainsyou.example/" });
        res.end();
      }),
    );
    await httpsProbe("shop.test", loopback, { port: forwarding, ca: material.ca, timeoutMs: 5000 });
    // A certificate for another name (or an untrusted one) never passes.
    const wrongName = await listen(
      createHttpsServer({ key: material.key, cert: material.cert }, (req, res) => res.end("ok")),
    );
    await assert.rejects(() =>
      httpsProbe("shop.test", loopback, { port: wrongName, ca: material.ca, timeoutMs: 5000 }),
    );
    await assert.rejects(() => httpsProbe("shop.test", loopback, { port: forwarding, timeoutMs: 5000 }));
    // A server that never answers: the timeout ends the check.
    const silent = await listen(createTcpServer(() => {}));
    await assert.rejects(() =>
      httpsProbe("shop.test", loopback, { port: silent, ca: material.ca, timeoutMs: 300 }),
    );
  } finally {
    for (const server of servers) {
      (server as any).closeAllConnections?.();
      server.close();
    }
    material.cleanup();
  }
});
