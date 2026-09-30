// Check and repair platform DNS (docs/features/infra-ops.md, "Platform
// DNS"): the Super admin action that makes the platform root zone hold A
// records for @, www and * pointing at this server. Read-only check, the
// exact plan applied with a reason (plan hash), AAAA/CNAME on those names
// removed, CAA, DNSSEC, delegation and wildcard problems reported, other
// domains of the DigitalOcean team never touched, operator-only with a fresh
// authenticator. The DigitalOcean double answers through a test transport.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { DigitalOceanDns } from "../packages/providers/src/dns-hosting.ts";
import type { PlatformDnsDeps } from "../apps/api/src/platform-dns.ts";
import { DigitalOceanMock } from "./e2e/mocks/digitalocean.ts";

const ROOT = "trainsyou.example";
const SERVER_IP = "203.0.113.7";
const TOKEN = "dop_v1_platform_fixture";
const env: Record<string, string> = {
  PUBLIC_APP_URL: "http://localhost:3000",
  PLATFORM_ROOT_DOMAIN: ROOT,
  DNS_PROVIDER: "digitalocean",
  DIGITALOCEAN_DNS_TOKEN: TOKEN,
  DNS_RECORD_TTL: "1800",
};
const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
const mock = new DigitalOceanMock({ key: "unused", cert: "unused" }, TOKEN);
let serverIpv4: string | null = SERVER_IP;
const ds = new Map<string, string[]>();
const ns = new Map<string, string[]>();
const deps: PlatformDnsDeps = {
  dns: (guard) => new DigitalOceanDns(TOKEN, guard, { transport: mock.fetch }),
  serverIpv4: async () => serverIpv4,
  publicDns: async (name, type) =>
    type === "DS"
      ? { status: "ok", answers: ds.get(name) ?? [] }
      : { status: "ok", answers: ns.get(name) ?? [] },
};
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
let admin: string, trainer: string;
async function register(slug: string) {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    headers: { host: "localhost:4000", origin: "http://localhost:3000" },
    payload: {
      name: "Fixture " + slug,
      email: slug + "@platform-dns-fixture.test",
      password: "FixturePassword2026!",
      slug,
      accepted: true,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const user = (
    await app.inject({ url: "/api/v1/bootstrap", headers: { host: "localhost:4000", cookie } })
  ).json().user;
  return { cookie, userId: user.userId as string };
}
const call = (path: string, cookie: string, payload: object = {}) =>
  app.inject({
    method: "POST",
    url: "/api/v1/admin/infrastructure/platform-dns/" + path,
    headers: { host: "localhost:4000", origin: "http://localhost:3000", cookie },
    payload,
  });

before(async () => {
  Object.assign(process.env, env);
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true, providers: { platformDns: deps } });
  const ops = await register("dns-operator");
  const coach = await register("dns-coach");
  await db.system(async (tx) => {
    await tx.query("UPDATE users SET platform_role='admin' WHERE id=$1", [ops.userId]);
    await tx.query("UPDATE sessions SET mfa_at=now() WHERE user_id=$1", [ops.userId]);
  });
  admin = ops.cookie;
  trainer = coach.cookie;
  // Other domains of the same DigitalOcean team.
  mock.seed("fleetkeel.com", [{ name: "@", type: "A", data: "192.0.2.10" }]);
  mock.seed("uaeasp.ae", [{ name: "*", type: "A", data: "192.0.2.11" }]);
});
after(async () => {
  await app?.close();
  await db?.close();
  for (const [key, value] of Object.entries(saved))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

test("operator-only: trainers are refused and an operator needs a fresh authenticator", async () => {
  assert.equal((await call("check", trainer)).statusCode, 403);
  await db.system((tx) =>
    tx.query("UPDATE sessions SET mfa_at=now()-interval '1 hour' WHERE mfa_at IS NOT NULL"),
  );
  const stale = await call("check", admin);
  assert.equal(stale.statusCode, 403);
  assert.equal(stale.json().code, "MFA_STEP_UP");
  await db.system((tx) =>
    tx.query("UPDATE sessions SET mfa_at=now() WHERE mfa_at IS NOT NULL"),
  );
});

test("only the platform's own zone can be managed; other team domains are never read", async () => {
  const before = mock.calls.length;
  const other = await call("check", admin, { rootDomain: "fleetkeel.com" });
  assert.equal(other.statusCode, 200, other.body);
  assert.equal(other.json().repairable, false);
  assert.match(other.json().problems[0].message, /trainsyou\.example/);
  assert.equal(mock.calls.length, before, "no DigitalOcean request for another zone");
  const repair = await call("repair", admin, {
    rootDomain: "fleetkeel.com",
    planHash: "0".repeat(64),
    reason: "Trying another domain of the team",
  });
  assert.equal(repair.statusCode, 409);
  assert.deepEqual(mock.view("fleetkeel.com"), ["@ A 192.0.2.10"]);
});

test("a missing zone is planned for creation and created by the repair", async () => {
  const check = await call("check", admin);
  assert.equal(check.statusCode, 200, check.body);
  const plan = check.json();
  assert.equal(plan.zone, ROOT);
  assert.equal(plan.zonePresent, false);
  assert.deepEqual(
    plan.changes.map((c: any) => `${c.action} ${c.name} ${c.type} ${c.data}`),
    [
      `create_zone ${ROOT} zone ${ROOT}`,
      `create @ A ${SERVER_IP}`,
      `create www A ${SERVER_IP}`,
      `create * A ${SERVER_IP}`,
    ],
  );
  const repaired = await call("repair", admin, {
    planHash: plan.planHash,
    reason: "Set up platform DNS before the address change",
  });
  assert.equal(repaired.statusCode, 200, repaired.body);
  assert.deepEqual(repaired.json().applied, {
    zoneCreated: true,
    created: 3,
    updated: 0,
    deleted: 0,
  });
  assert.equal(repaired.json().plan.changes.length, 0);
  assert.deepEqual(mock.view(ROOT), [`* A ${SERVER_IP}`, `@ A ${SERVER_IP}`, `www A ${SERVER_IP}`]);
  const audit = await db.system((tx) =>
    tx.query("SELECT action,data FROM admin_operations_audit WHERE action LIKE 'infrastructure.platform_dns.%' ORDER BY created_at"),
  );
  assert.deepEqual(
    audit.map((a: any) => a.action),
    [
      "infrastructure.platform_dns.checked",
      "infrastructure.platform_dns.checked",
      "infrastructure.platform_dns.repaired",
    ],
  );
  assert.equal(audit.at(-1)!.data.reason, "Set up platform DNS before the address change");
});

test("wrong addresses, AAAA and CNAME records are repaired; CAA, DNSSEC and hidden names are reported", async () => {
  mock.zones.delete(ROOT);
  mock.seed(ROOT, [
    { name: "@", type: "A", data: "192.0.2.99" },
    { name: "@", type: "AAAA", data: "2001:db8::1" },
    { name: "www", type: "CNAME", data: "parking.example." },
    { name: "@", type: "MX", data: "mail.example.", priority: 10 },
    { name: "@", type: "CAA", data: "digicert.com", flags: 0, tag: "issue" },
    { name: "layla", type: "TXT", data: "verification" },
    { name: "_dmarc", type: "TXT", data: "v=DMARC1; p=none" },
  ]);
  ds.set(ROOT, ["2371 13 2 ABCDEF"]);
  ns.set(ROOT, ["ns1.digitalocean.com", "ns2.digitalocean.com", "ns3.digitalocean.com"]);
  const plan = (await call("check", admin, { rootDomain: ROOT })).json();
  assert.equal(plan.repairable, true);
  assert.equal(plan.ready, false);
  assert.deepEqual(
    plan.changes.map((c: any) => `${c.action} ${c.name} ${c.type} ${c.data}`),
    [
      "delete @ AAAA 2001:db8::1",
      "delete www CNAME parking.example.",
      `update @ A ${SERVER_IP}`,
      `create www A ${SERVER_IP}`,
      `create * A ${SERVER_IP}`,
    ],
  );
  const keys = Object.fromEntries(plan.problems.map((p: any) => [p.key, p]));
  assert.equal(keys.caa.level, "error");
  assert.equal(keys.ds.level, "error");
  assert.equal(keys.wildcard.level, "warning");
  assert.match(keys.wildcard.message, /layla \(TXT\)/);
  assert.doesNotMatch(keys.wildcard.message, /_dmarc/);
  assert.equal(keys.delegation.level, "info");
  // A plan the operator did not see is never applied.
  const stale = await call("repair", admin, {
    rootDomain: ROOT,
    planHash: "f".repeat(64),
    reason: "Repair with an old plan hash",
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, "PLATFORM_DNS_CHANGED");
  assert.equal(stale.json().plan.planHash, plan.planHash);
  const repaired = await call("repair", admin, {
    rootDomain: ROOT,
    planHash: plan.planHash,
    reason: "Point the platform root at this server",
  });
  assert.equal(repaired.statusCode, 200, repaired.body);
  assert.deepEqual(mock.view(ROOT), [
    `* A ${SERVER_IP}`,
    `@ A ${SERVER_IP}`,
    "@ CAA digicert.com",
    "@ MX mail.example.",
    "_dmarc TXT v=DMARC1; p=none",
    "layla TXT verification",
    `www A ${SERVER_IP}`,
  ]);
  const after = repaired.json().plan;
  assert.equal(after.changes.length, 0);
  assert.equal(after.ready, false, "CAA and DNSSEC still block the move");
  // Fixed at the registrar and the DNS host: ready.
  ds.delete(ROOT);
  const caa = mock.zones.get(ROOT)!.find((r) => r.type === "CAA")!;
  caa.data = "letsencrypt.org";
  const ready = (await call("check", admin)).json();
  assert.equal(ready.ready, true, JSON.stringify(ready.problems));
  // The other domains of the team were never changed.
  assert.deepEqual(mock.view("fleetkeel.com"), ["@ A 192.0.2.10"]);
  assert.deepEqual(mock.view("uaeasp.ae"), ["* A 192.0.2.11"]);
  assert.ok(
    mock.calls.every((c) => !/fleetkeel|uaeasp/.test(c.path)),
    "no request ever named another zone",
  );
});

test("blocked without the server address, the DNS host or with a zone another account holds", async () => {
  serverIpv4 = null;
  const unreported = (await call("check", admin)).json();
  assert.equal(unreported.repairable, false);
  assert.equal(unreported.problems[0].key, "server");
  serverIpv4 = SERVER_IP;
  process.env.DNS_PROVIDER = "registrar";
  try {
    const off = (await call("check", admin)).json();
    assert.equal(off.problems[0].key, "provider");
  } finally {
    process.env.DNS_PROVIDER = "digitalocean";
  }
  // A new root zone saved in DNS hosting settings, held by another account.
  process.env.DNS_PLATFORM_ZONE = "trainsyou.test";
  mock.foreign.add("trainsyou.test");
  try {
    const plan = (await call("check", admin, { rootDomain: "trainsyou.test" })).json();
    assert.equal(plan.zonePresent, false);
    const repair = await call("repair", admin, {
      rootDomain: "trainsyou.test",
      planHash: plan.planHash,
      reason: "Prepare the new root domain",
    });
    assert.equal(repair.statusCode, 409);
    assert.equal(repair.json().code, "ZONE_HELD_ELSEWHERE");
    assert.equal(mock.zones.has("trainsyou.test"), false);
  } finally {
    delete process.env.DNS_PLATFORM_ZONE;
  }
});

test("the platform address check says when DNS can be set up automatically", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/admin/infrastructure/platform-address/check",
    headers: { host: "localhost:4000", origin: "http://localhost:3000", cookie: admin },
    payload: { url: "https://" + ROOT },
  });
  assert.equal(r.statusCode, 200, r.body);
  const info = r.json().checks.find((c: any) => c.key === "dns_automation");
  assert.match(info.message, /Check and repair platform DNS/);
  assert.match(r.json().procedure[0], /Check and repair platform DNS/);
});

test("a saved root zone whose names point elsewhere (another site of the team) is never repaired", async () => {
  // Settings → DNS hosting names another domain of the same team by mistake.
  process.env.DNS_PLATFORM_ZONE = "fleetkeel.com";
  try {
    const plan = (await call("check", admin, { rootDomain: "fleetkeel.com" })).json();
    assert.equal(plan.repairable, false);
    assert.equal(plan.planHash, null);
    assert.equal(plan.problems[0].key, "zone_in_use");
    assert.match(plan.problems[0].message, /@ A 192\.0\.2\.10/);
    const repair = await call("repair", admin, {
      rootDomain: "fleetkeel.com",
      planHash: "0".repeat(64),
      reason: "A mistyped platform root zone",
    });
    assert.equal(repair.statusCode, 409);
    assert.equal(repair.json().code, "PLATFORM_DNS_BLOCKED");
    assert.deepEqual(mock.view("fleetkeel.com"), ["@ A 192.0.2.10"]);
    assert.ok(!mock.calls.some((c) => c.method !== "GET" && /fleetkeel/.test(c.path)));
  } finally {
    delete process.env.DNS_PLATFORM_ZONE;
  }
});

test("readiness: only CAA issue records decide, names that miss the server are listed, delegation is required", async () => {
  mock.zones.delete(ROOT);
  mock.seed(ROOT, [
    { name: "@", type: "A", data: SERVER_IP },
    { name: "www", type: "A", data: SERVER_IP },
    { name: "*", type: "A", data: SERVER_IP },
    { name: "@", type: "CAA", data: "digicert.com", flags: 0, tag: "issue" },
    { name: "@", type: "CAA", data: "letsencrypt.org", flags: 0, tag: "issuewild" },
    { name: "shop", type: "CNAME", data: "stores.example." },
    { name: "blog", type: "A", data: "192.0.2.50" },
    { name: "email.mg", type: "CNAME", data: "mailgun.org." },
    { name: "_dmarc", type: "TXT", data: "v=DMARC1; p=none" },
  ]);
  ns.set(ROOT, ["ns1.digitalocean.com", "ns2.digitalocean.com", "ns3.digitalocean.com"]);
  // The edge gets one certificate per name: "issue" decides, "issuewild" does not help.
  let plan = (await call("check", admin)).json();
  let keys = Object.fromEntries(plan.problems.map((p: any) => [p.key, p]));
  assert.equal(keys.caa?.level, "error");
  assert.equal(plan.ready, false);
  assert.match(keys.wildcard.message, /shop \(CNAME stores\.example\.?\)/);
  assert.match(keys.wildcard.message, /blog \(A 192\.0\.2\.50\)/);
  assert.match(keys.wildcard.message, /mg \(only email\.mg under it\)/);
  assert.doesNotMatch(keys.wildcard.message, /_dmarc/);
  const records = mock.zones.get(ROOT)!.filter((r) => r.type === "CAA");
  records.find((r: any) => r.tag === "issue")!.data = "letsencrypt.org";
  records.find((r: any) => r.tag === "issuewild")!.data = "digicert.com";
  plan = (await call("check", admin)).json();
  keys = Object.fromEntries(plan.problems.map((p: any) => [p.key, p]));
  assert.equal(keys.caa, undefined, JSON.stringify(plan.problems));
  assert.equal(plan.ready, true, JSON.stringify(plan.problems));
  // Right records at a DNS host the name is not delegated to have no effect.
  ns.set(ROOT, ["dns1.registrar-servers.com", "dns2.registrar-servers.com"]);
  plan = (await call("check", admin)).json();
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.ready, false);
  assert.equal(plan.problems.find((p: any) => p.key === "delegation").level, "warning");
  ns.set(ROOT, ["ns1.digitalocean.com", "ns2.digitalocean.com", "ns3.digitalocean.com"]);
});
