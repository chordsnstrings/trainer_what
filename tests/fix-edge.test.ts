import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import * as auth from "../apps/api/src/auth.ts";
import { HOST_HEADERS, signHostRequest } from "../apps/api/src/host-routing.ts";
import * as hostProxy from "../apps/web/host-proxy.ts";
import { proxy } from "../apps/web/proxy.ts";

// Production path: Caddy (sets X-Forwarded-For) -> Next proxy.ts (signs the
// host proof) -> API. The API only sees the web container's socket address.
const secret = "synthetic-edge-proof-key-with-32-bytes-minimum";
const publicOrigin = "http://localhost:3000";
const webContainer = "10.1.0.2";
const password = "FixturePassword2026!";
const env = {
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
  INTERNAL_PROXY_SECRET: process.env.INTERNAL_PROXY_SECRET,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
};
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
const member = `edge-member-${randomUUID()}@example.test`,
  guarded = `edge-guarded-${randomUUID()}@example.test`;

before(async () => {
  process.env.PUBLIC_APP_URL = publicOrigin;
  process.env.INTERNAL_PROXY_SECRET = secret;
  db = await createDatabase({ memory: true });
  const tenantId = randomUUID(),
    hash = await auth.passwordHash(password);
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Edge fixture')",
      [tenantId, `edge-${tenantId}`],
    );
    for (const email of [member, guarded]) {
      const userId = randomUUID();
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Edge fixture',$3,true)",
        [userId, email, hash],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
        [tenantId, userId],
      );
    }
  });
  // The normal budgets, not testing:true's elevated global limit.
  app = await buildApp({ db });
  app.log.level = "silent";
});
after(async () => {
  await app?.close();
  await db?.close();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// Run the real Next proxy for an edge request, then replay the rewritten
// request headers against the API from the web container's address.
async function viaWeb(
  path: string,
  forwardedFor: string | undefined,
  options: {
    method?: "GET" | "POST";
    payload?: object;
    extra?: Record<string, string>;
  } = {},
) {
  const method = options.method ?? "GET";
  const edge = await proxy(
    new NextRequest(publicOrigin + path, {
      method,
      headers: {
        host: "localhost:3000",
        origin: publicOrigin,
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
        ...options.extra,
      },
    }),
  );
  const rewrite = new URL(edge.headers.get("x-middleware-rewrite")!);
  assert.equal(rewrite.pathname + rewrite.search, path);
  const headers: Record<string, string> = {};
  for (const name of edge.headers
    .get("x-middleware-override-headers")!
    .split(","))
    headers[name] = edge.headers.get("x-middleware-request-" + name)!;
  const response = await app.inject({
    url: path,
    method,
    remoteAddress: webContainer,
    headers,
    ...(options.payload ? { payload: options.payload } : {}),
  });
  return { headers, response };
}

test("the web proxy signs only the edge-set client address and removes client copies", async () => {
  assert.equal(typeof hostProxy.edgeClientIp, "function");
  assert.equal(hostProxy.edgeClientIp("198.51.100.4"), "198.51.100.4");
  // A proxy that appends: the entry nearest to the web server wins.
  assert.equal(
    hostProxy.edgeClientIp("192.0.2.1, 198.51.100.4"),
    "198.51.100.4",
  );
  assert.equal(hostProxy.edgeClientIp("2001:db8::7"), "2001:db8::7");
  for (const bad of [null, "", "unknown", "198.51.100.4:443", "fe80::1%eth0"])
    assert.equal(hostProxy.edgeClientIp(bad), undefined, String(bad));

  const { headers } = await viaWeb("/api/v1/health", "198.51.100.5", {
    extra: { "x-trainer-client-ip": "192.0.2.99", forwarded: "for=192.0.2.9" },
  });
  assert.equal(headers[HOST_HEADERS.clientIp], "198.51.100.5");
  assert.equal(headers["x-forwarded-for"], undefined);
  assert.equal(headers.forwarded, undefined);
  assert.equal(
    headers[HOST_HEADERS.signature],
    signHostRequest(
      "localhost:3000",
      "GET",
      "/api/v1/health",
      headers[HOST_HEADERS.time],
      secret,
      "198.51.100.5",
    ),
  );
  // Without a usable edge address, no client address is forwarded at all.
  const invalid = await viaWeb("/api/v1/health", "not-an-address", {
    extra: { "x-trainer-client-ip": "192.0.2.99" },
  });
  assert.equal(invalid.headers[HOST_HEADERS.clientIp], undefined);
});

test("signed client addresses get independent anonymous budgets behind one proxy address", async () => {
  const path = "/api/v1/public/trainers/missing-edge-fixture";
  for (let index = 0; index < 120; index++) {
    const { response } = await viaWeb(path, "198.51.100.10");
    assert.equal(response.statusCode, 404, `Request ${index + 1}`);
  }
  const limited = await viaWeb(path, "198.51.100.10");
  assert.equal(limited.response.statusCode, 429);
  assert.equal(
    (await viaWeb(path, "198.51.100.11")).response.statusCode,
    404,
    "Another client behind the same web container keeps its own budget",
  );
  assert.equal(
    (
      await app.inject({
        url: path,
        remoteAddress: webContainer,
        headers: { host: "localhost:3000" },
      })
    ).statusCode,
    404,
    "Unsigned local traffic falls back to the socket address budget",
  );
  // Probes relayed through the web proxy use the same per-client budget.
  assert.equal(
    (await viaWeb("/api/v1/health", "198.51.100.10")).response.statusCode,
    429,
  );
  assert.equal(
    (await viaWeb("/api/v1/health", "198.51.100.11")).response.statusCode,
    200,
  );
  const lookup = await viaWeb("/api/v1/public/host", "198.51.100.11");
  assert.equal(lookup.response.statusCode, 200, lookup.response.body);
  assert.equal(lookup.response.json().verifiedProxy, true);
  assert.equal(lookup.response.json().clientIp, undefined);
});

test("one client's failed sign-ins no longer lock every user out of login", async () => {
  // Live reproduction: about 16 attempts from one tester returned 429 to all.
  for (let index = 0; index < 15; index++) {
    const { response } = await viaWeb("/api/v1/auth/login", "198.51.100.12", {
      method: "POST",
      payload: {
        email: `edge-unknown-${randomUUID()}@example.test`,
        password: "wrong-password",
      },
    });
    assert.equal(response.statusCode, 401, response.body);
  }
  const limited = await viaWeb("/api/v1/auth/login", "198.51.100.12", {
    method: "POST",
    payload: { email: member, password },
  });
  assert.equal(limited.response.statusCode, 429);
  const other = await viaWeb("/api/v1/auth/login", "198.51.100.13", {
    method: "POST",
    payload: { email: member, password },
  });
  assert.equal(other.response.statusCode, 200, other.response.body);
  assert.match(String(other.response.headers["set-cookie"]), /^session=/);
});

test("tampered, unsigned, downgraded or malformed client addresses are rejected", async () => {
  const path = "/api/v1/public/trainers/missing-edge-fixture";
  const signed = hostProxy.verifiedProxyHeaders(
    new Headers(),
    "localhost:3000",
    "GET",
    path,
    secret,
    Date.now(),
    "198.51.100.20",
  );
  const base = Object.fromEntries(signed.entries());
  const send = (headers: Record<string, string>) =>
    app.inject({ url: path, remoteAddress: webContainer, headers });
  assert.equal((await send(base)).statusCode, 404);
  for (const headers of [
    { ...base, [HOST_HEADERS.clientIp]: "198.51.100.21" },
    Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== HOST_HEADERS.clientIp),
    ),
    { host: "localhost:3000", [HOST_HEADERS.clientIp]: "198.51.100.22" },
  ]) {
    const response = await send(headers);
    assert.equal(response.statusCode, 400, JSON.stringify(headers));
    assert.equal(response.json().code, "HOST_SIGNATURE");
  }
  const time = String(Date.now());
  const malformed = await send({
    host: "localhost:3000",
    [HOST_HEADERS.host]: "localhost:3000",
    [HOST_HEADERS.time]: time,
    [HOST_HEADERS.clientIp]: "not-an-address",
    [HOST_HEADERS.signature]: signHostRequest(
      "localhost:3000",
      "GET",
      path,
      time,
      secret,
      "not-an-address",
    ),
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().code, "HOST_SIGNATURE");
});

test("per-account attempt budgets span client addresses and do not reveal accounts", async () => {
  let address = 0;
  const next = () => `203.0.113.${++address}`;
  const login = (email: string, secretValue: string) =>
    viaWeb("/api/v1/auth/login", next(), {
      method: "POST",
      payload: { email, password: secretValue },
    });
  const unknown = `edge-missing-${randomUUID()}@example.test`;
  const bodies: any[] = [];
  for (const email of [guarded, unknown]) {
    for (let index = 0; index < 10; index++) {
      const { response } = await login(email, "wrong-password");
      assert.equal(response.statusCode, 401, `${email} ${index + 1}`);
    }
    const limited = await login(email, password);
    assert.equal(limited.response.statusCode, 429, limited.response.body);
    assert.ok(Number(limited.response.headers["retry-after"]) > 0);
    bodies.push(limited.response.json());
  }
  const [existing, missing] = bodies;
  assert.equal(existing.code, "TOO_MANY_ATTEMPTS");
  assert.deepEqual(
    { code: missing.code, message: missing.message },
    { code: existing.code, message: existing.message },
    "The throttle response is identical for existing and unknown addresses",
  );
  assert.equal(
    (await login(member, password)).response.statusCode,
    200,
    "Other accounts are unaffected",
  );
  for (const [path, expected, payload] of [
    ["/api/v1/auth/forgot-password", 200, {}],
    ["/api/v1/auth/magic-link", 200, {}],
    [
      "/api/v1/auth/mfa/recover",
      401,
      { password: "wrong-password", recoveryCode: "x".repeat(24) },
    ],
  ] as const) {
    const email = `edge-recovery-${randomUUID()}@example.test`;
    for (let index = 0; index < 10; index++) {
      const { response } = await viaWeb(path, next(), {
        method: "POST",
        payload: { email, ...payload },
      });
      assert.equal(response.statusCode, expected, `${path} ${response.body}`);
    }
    const { response } = await viaWeb(path, next(), {
      method: "POST",
      payload: { email, ...payload },
    });
    assert.equal(response.statusCode, 429, path);
    assert.equal(response.json().code, "TOO_MANY_ATTEMPTS");
  }
});

test("the per-account budget resets after its window and stays memory bounded", () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  try {
    const headers: Record<string, string> = {};
    const reply = {
      header(name: string, value: string) {
        headers[name] = value;
        return reply;
      },
    } as any;
    const attempt = auth.accountAttempts(2, 60_000, 2);
    attempt(reply, "Edge@Example.test");
    attempt(reply, " edge@example.test ");
    assert.throws(
      () => attempt(reply, "edge@example.test"),
      (error: any) =>
        error.statusCode === 429 && error.code === "TOO_MANY_ATTEMPTS",
    );
    assert.equal(headers["retry-after"], "60");
    mock.timers.tick(60_001);
    assert.doesNotThrow(() => attempt(reply, "edge@example.test"));
    // A full map evicts the oldest window rather than growing without bound.
    attempt(reply, "other-1@example.test");
    attempt(reply, "other-2@example.test");
    attempt(reply, "edge@example.test");
    assert.doesNotThrow(() => attempt(reply, "edge@example.test"));
  } finally {
    mock.timers.reset();
  }
});

test("signed Stripe deliveries keep their own budget when anonymous traffic is exhausted", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture_not_a_credential";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture_not_a_credential";
  try {
    // No signed address: every anonymous request shares the socket address.
    const shared = "192.0.2.50";
    for (let index = 0; index < 120; index++)
      assert.equal(
        (
          await app.inject({
            url: "/api/v1/public/trainers/missing-edge-fixture",
            remoteAddress: shared,
          })
        ).statusCode,
        404,
      );
    assert.equal(
      (
        await app.inject({
          url: "/api/v1/public/trainers/missing-edge-fixture",
          remoteAddress: shared,
        })
      ).statusCode,
      429,
    );
    const raw = JSON.stringify({
        id: `evt_edge_${randomUUID()}`,
        object: "event",
        created: Math.floor(Date.now() / 1000),
        type: "customer.created",
        data: { object: { id: "cus_edge_fixture", object: "customer" } },
      }),
      timestamp = Math.floor(Date.now() / 1000),
      signature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
        .update(timestamp + "." + raw)
        .digest("hex");
    const delivery = await app.inject({
      url: "/api/v1/webhooks/stripe",
      method: "POST",
      remoteAddress: shared,
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${signature}`,
      },
      payload: raw,
    });
    assert.equal(delivery.statusCode, 200, delivery.body);
    assert.deepEqual(delivery.json(), { received: true });
  } finally {
    for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const)
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
  }
});
