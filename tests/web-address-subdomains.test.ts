// Automatic workspace subdomains (docs/features/web-addresses.md): signed
// host routing at <slug>.<PLATFORM_ROOT_DOMAIN> with the custom-domain session
// rules, reserved names at signup and slug change, the redirect a slug change
// keeps, and the TLS ask decisions for subdomains.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  HOST_HEADERS,
  coachHostTenant,
  signHostRequest,
} from "../apps/api/src/host-routing.ts";
import { tlsIssuancePermitted } from "../apps/api/src/host-operations.ts";
import { normalizeDomain } from "../apps/api/src/integrations-completion.ts";
import { customHostPath, movedHostLocation } from "../apps/web/host-proxy.ts";
import {
  platformRootDomain,
  slugProblem,
  subdomainLabel,
} from "../packages/domain/src/web-address.ts";

const ROOT = "trainsyou.example";
const secret = "synthetic-host-proof-key-with-32-bytes-minimum";
const env = {
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
  INTERNAL_PROXY_SECRET: process.env.INTERNAL_PROXY_SECRET,
  PLATFORM_ROOT_DOMAIN: process.env.PLATFORM_ROOT_DOMAIN,
};
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
let layla: any, omar: any, draft: any;

function request(
  path: string,
  options: {
    method?: string;
    payload?: any;
    cookie?: string;
    host?: string | null;
  } = {},
) {
  const url = "/api/v1" + path,
    method = options.method ?? "GET",
    time = String(Date.now());
  const host = options.host ?? null;
  return app.inject({
    url,
    method: method as any,
    payload: options.payload,
    headers: {
      host: "localhost:4000",
      origin: host ? "https://" + host : "http://localhost:3000",
      ...(host
        ? {
            [HOST_HEADERS.host]: host,
            [HOST_HEADERS.time]: time,
            [HOST_HEADERS.signature]: signHostRequest(
              host,
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
      email: slug + "@subdomain-fixture.test",
      password: "FixturePassword2026!",
      slug,
      accepted: true,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const boot = await request("/bootstrap", { cookie });
  return { ...boot.json().user, cookie, slug };
}
// Each ask looks a minute later, so the permitted-name set is re-read.
let clock = Date.now();
const ask = (host: string) =>
  tlsIssuancePermitted(db, host, (clock = Math.max(clock, Date.now()) + 60000));

before(async () => {
  process.env.PUBLIC_APP_URL = "http://localhost:3000";
  process.env.INTERNAL_PROXY_SECRET = secret;
  process.env.PLATFORM_ROOT_DOMAIN = ROOT;
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  layla = await register("layla");
  omar = await register("omar");
  draft = await register("draft-coach");
  await db.system((tx) =>
    tx.query("UPDATE tenants SET published=true WHERE id IN ($1,$2)", [
      layla.tenantId,
      omar.tenantId,
    ]),
  );
});
after(async () => {
  await app?.close();
  await db?.close();
  for (const [key, value] of Object.entries(env))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

test("root domain, labels and reserved names", () => {
  assert.equal(platformRootDomain(" TrainsYou.com. "), "trainsyou.com");
  assert.equal(
    platformRootDomain("gymmembership.203.0.113.7.sslip.io"),
    "gymmembership.203.0.113.7.sslip.io",
    "an sslip.io platform name works as a root",
  );
  for (const bad of ["", "localhost", "203.0.113.7", "a..b", "-x.com", "x.123"])
    assert.equal(platformRootDomain(bad), null, bad);
  assert.equal(subdomainLabel("layla.trainsyou.com", "trainsyou.com"), "layla");
  assert.equal(subdomainLabel("a.b.trainsyou.com", "trainsyou.com"), null);
  assert.equal(subdomainLabel("trainsyou.com", "trainsyou.com"), null);
  assert.equal(subdomainLabel("layla.trainsyou.com", null), null);
  for (const reserved of [
    "www",
    "app",
    "api",
    "admin",
    "mail",
    "trainsyou",
    "stripe",
    // Names clients probe on their own under a wildcard A record.
    "autodiscover",
    "autoconfig",
    "wpad",
    "isatap",
    "mta-sts",
    "lyncdiscover",
    "enterpriseenrollment",
    "cpanel",
    "webmaster",
  ])
    assert.equal(slugProblem(reserved), "reserved", reserved);
  assert.equal(slugProblem("coach-"), "hyphen");
  assert.equal(slugProblem("xn--coach"), "hyphen");
  assert.equal(slugProblem("layla-strength"), null);
});

test("a published workspace is served at its subdomain with the custom-domain session rules", async () => {
  const host = "layla." + ROOT;
  const context = await request("/public/host", { host });
  assert.equal(context.statusCode, 200, context.body);
  assert.deepEqual(
    {
      tenantId: context.json().tenantId,
      tenantSlug: context.json().tenantSlug,
      custom: context.json().custom,
      subdomain: context.json().subdomain,
      origin: context.json().origin,
    },
    {
      tenantId: layla.tenantId,
      tenantSlug: "layla",
      custom: true,
      subdomain: true,
      origin: "https://" + host,
    },
  );
  // Unpublished, reserved, nested and unknown names select nothing.
  for (const name of [
    "draft-coach." + ROOT,
    "www." + ROOT,
    "a.layla." + ROOT,
    "nobody." + ROOT,
  ]) {
    const refused = await request("/public/host", { host: name });
    assert.equal(refused.statusCode, 421, name);
  }
  // Another workspace's public pages and sessions are refused on this host.
  assert.equal(
    (await request("/public/trainers/omar", { host })).statusCode,
    403,
  );
  assert.equal(
    (await request("/public/trainers/layla", { host })).statusCode,
    200,
  );
  assert.equal(
    (await request("/bootstrap", { host, cookie: omar.cookie })).statusCode,
    403,
    "a session of another workspace is refused",
  );
  // Trainer signup and provider callbacks stay on the platform address.
  assert.equal(
    (await request("/auth/register", { host, method: "POST", payload: {} }))
      .statusCode,
    403,
  );
  const login = await request("/auth/login", {
    host,
    method: "POST",
    payload: { email: layla.email, password: "FixturePassword2026!" },
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  assert.doesNotMatch(
    String(login.headers["set-cookie"]),
    /Domain=/i,
    "host-only cookie",
  );
  assert.equal(
    (await request("/bootstrap", { host, cookie })).json().user.tenantId,
    layla.tenantId,
  );
  // The wearable OAuth relay accepts the subdomain as a coach origin.
  assert.equal(await coachHostTenant(db, host), layla.tenantId);
  assert.equal(await coachHostTenant(db, "draft-coach." + ROOT), null);
  // Coach domains cannot claim names under the platform root.
  assert.throws(() => normalizeDomain("evil." + ROOT), /platform address/);
  assert.throws(() => normalizeDomain(ROOT), /platform address/);
});

test("the web proxy maps a subdomain like a coach domain and follows only a valid moved answer", () => {
  assert.equal(customHostPath("/", "layla"), "/coach/layla");
  assert.equal(customHostPath("/app", "layla"), "/app");
  assert.equal(customHostPath("/admin", "layla"), null);
  const moved = { code: "HOST_MOVED", location: "https://layla-fit." + ROOT };
  assert.equal(movedHostLocation(moved, ROOT), "https://layla-fit." + ROOT);
  assert.equal(movedHostLocation(moved, undefined), null);
  assert.equal(
    movedHostLocation({ ...moved, location: "https://evil.example" }, ROOT),
    null,
  );
  assert.equal(
    movedHostLocation({ ...moved, location: "http://layla-fit." + ROOT }, ROOT),
    null,
  );
  assert.equal(
    movedHostLocation({ ...moved, location: "https://a.b." + ROOT }, ROOT),
    null,
  );
  assert.equal(movedHostLocation({ code: "UNKNOWN_HOST" }, ROOT), null);
});

test("signup refuses reserved and malformed slugs", async () => {
  for (const [slug, code] of [
    ["www", "RESERVED_SLUG"],
    ["mail", "RESERVED_SLUG"],
    ["trainsyou", "RESERVED_SLUG"],
    ["coach-", "INVALID_SLUG"],
    ["co--ach", "INVALID_SLUG"],
  ]) {
    const r = await request("/auth/register", {
      method: "POST",
      payload: {
        name: "Fixture",
        email: slug.replaceAll("-", "") + "x@subdomain-fixture.test",
        password: "FixturePassword2026!",
        slug,
        accepted: true,
      },
    });
    assert.equal(r.statusCode, 400, slug);
    assert.equal(r.json().code, code, slug);
  }
});

test("a slug change keeps a redirect, holds the old name, and is limited", async () => {
  const state = await request("/web-address", { cookie: omar.cookie });
  assert.equal(state.statusCode, 200, state.body);
  assert.equal(state.json().subdomain.url, "https://omar." + ROOT);
  assert.equal(state.json().subdomain.live, true);
  const change = (slug: string, currentSlug: string, cookie = omar.cookie) =>
    request("/web-address/slug", {
      method: "POST",
      cookie,
      payload: { slug, currentSlug },
    });
  assert.equal((await change("www", "omar")).json().code, "RESERVED_SLUG");
  assert.equal(
    (await change("layla", "omar")).statusCode,
    409,
    "taken by another workspace",
  );
  assert.equal(
    (await change("omar-fit", "someone-else")).statusCode,
    409,
    "stale current slug",
  );
  const renamed = await change("omar-fit", "omar");
  assert.equal(renamed.statusCode, 200, renamed.body);
  // The new name serves the workspace; the old one redirects to it.
  assert.equal(
    (await request("/public/host", { host: "omar-fit." + ROOT })).json()
      .tenantId,
    omar.tenantId,
  );
  const old = await request("/public/host", { host: "omar." + ROOT });
  assert.equal(old.statusCode, 421);
  assert.deepEqual(
    { code: old.json().code, location: old.json().location },
    { code: "HOST_MOVED", location: "https://omar-fit." + ROOT },
  );
  const path = await request("/public/slug-redirect/omar");
  assert.deepEqual(path.json(), { slug: "omar-fit" });
  assert.equal((await request("/public/slug-redirect/layla")).statusCode, 404);
  // Nobody else may take the old name while it redirects.
  const squat = await request("/auth/register", {
    method: "POST",
    payload: {
      name: "Squatter",
      email: "squatter@subdomain-fixture.test",
      password: "FixturePassword2026!",
      slug: "omar",
      accepted: true,
    },
  });
  assert.equal(squat.statusCode, 409, squat.body);
  assert.equal(squat.json().code, "SLUG_TAKEN");
  assert.equal(
    (await change("omar", "omar-fit", layla.cookie)).statusCode,
    409,
  );
  // The workspace may take its own old name back, which ends that redirect.
  assert.equal((await change("omar", "omar-fit")).statusCode, 200);
  assert.equal((await request("/public/slug-redirect/omar")).statusCode, 404);
  assert.equal((await change("omar-coach", "omar")).statusCode, 200);
  const limited = await change("omar-four", "omar-coach");
  assert.equal(limited.statusCode, 429, limited.body);
  assert.equal(limited.json().code, "SLUG_CHANGE_LIMIT");
  // Only the owner changes the address.
  const follower = await request("/web-address/slug", {
    method: "POST",
    payload: { slug: "x-y-z", currentSlug: "omar-coach" },
  });
  assert.equal(follower.statusCode, 401);
});

test("the TLS ask allows subdomains of published active workspaces only", async () => {
  assert.equal(await ask("layla." + ROOT), true);
  assert.equal(await ask("draft-coach." + ROOT), false, "unpublished");
  assert.equal(
    await ask("www." + ROOT),
    false,
    "reserved; the platform is not at the root",
  );
  assert.equal(await ask("nobody." + ROOT), false);
  assert.equal(await ask("omar-coach." + ROOT), true);
  assert.equal(
    await ask("omar-fit." + ROOT),
    true,
    "a previous name redirects over HTTPS",
  );
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='suspended' WHERE id=$1", [
      layla.tenantId,
    ]),
  );
  assert.equal(
    await ask("layla." + ROOT),
    false,
    "suspended workspaces get no new certificate",
  );
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='active' WHERE id=$1", [
      layla.tenantId,
    ]),
  );
  process.env.PLATFORM_ROOT_DOMAIN = "";
  try {
    assert.equal(await ask("layla." + ROOT), false, "no root, no subdomains");
    assert.equal(
      (await request("/public/host", { host: "layla." + ROOT })).statusCode,
      421,
    );
  } finally {
    process.env.PLATFORM_ROOT_DOMAIN = ROOT;
  }
  // With the platform served at the root, www.<root> is allowed for the edge redirect.
  process.env.PUBLIC_APP_URL = "https://" + ROOT;
  try {
    assert.equal(await ask("www." + ROOT), true);
    assert.equal(
      await ask(ROOT),
      false,
      "the platform keeps its own certificate",
    );
  } finally {
    process.env.PUBLIC_APP_URL = "http://localhost:3000";
  }
});
