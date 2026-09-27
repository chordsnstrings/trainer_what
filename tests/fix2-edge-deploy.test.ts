import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import * as auth from "../apps/api/src/auth.ts";
import { HOST_HEADERS } from "../apps/api/src/host-routing.ts";
import { verifiedProxyHeaders } from "../apps/web/host-proxy.ts";
import { proxy } from "../apps/web/proxy.ts";

// The live server's platform address is not loopback. The host controller
// (infra/digitalocean/host.py) still probes web on its loopback port, so web
// signs the host 127.0.0.1:3000, which no tenant maps.
const canonical = "gymmembership.192.0.2.10.sslip.io",
  publicOrigin = "https://" + canonical,
  loopbackHost = "127.0.0.1:3000";
const secret = "synthetic-deploy-probe-proof-key-with-32-bytes";
// Docker's bridge gateway: the socket address web sees for a published-port
// request, which Next records as X-Forwarded-For when none was sent.
const dockerGateway = "172.18.0.1";
const webContainer = "10.1.0.2";
const password = "FixturePassword2026!";
const envKeys = ["NODE_ENV", "PUBLIC_APP_URL", "INTERNAL_PROXY_SECRET"];
const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
const guarded = `deploy-guarded-${randomUUID()}@example.test`,
  distributed = `deploy-distributed-${randomUUID()}@example.test`;

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values))
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else Object.assign(process.env, { [key]: value });
}
async function production<T>(fn: () => Promise<T>) {
  const prior = process.env.NODE_ENV;
  setEnv({ NODE_ENV: "production" });
  try {
    return await fn();
  } finally {
    setEnv({ NODE_ENV: prior });
  }
}

before(async () => {
  setEnv({ PUBLIC_APP_URL: publicOrigin, INTERNAL_PROXY_SECRET: secret });
  db = await createDatabase({ memory: true });
  const tenantId = randomUUID(),
    hash = await auth.passwordHash(password);
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Deploy fixture')",
      [tenantId, `deploy-${tenantId}`],
    );
    for (const email of [guarded, distributed]) {
      const userId = randomUUID();
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,'Deploy fixture',$3,true)",
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
  setEnv(saved);
});

// Run the real Next proxy for a request that reached web with this Host, then
// replay the rewritten request headers against the API from web's address.
async function viaWeb(
  path: string,
  options: {
    host?: string;
    forwardedFor?: string;
    method?: "GET" | "POST";
    payload?: object;
  } = {},
) {
  const host = options.host ?? canonical,
    method = options.method ?? "GET";
  const edge = await proxy(
    new NextRequest(
      (host === canonical ? "https://" : "http://") + host + path,
      {
        method,
        headers: {
          host,
          ...(method === "POST" ? { origin: publicOrigin } : {}),
          ...(options.forwardedFor
            ? { "x-forwarded-for": options.forwardedFor }
            : {}),
        },
      },
    ),
  );
  const rewrite = edge.headers.get("x-middleware-rewrite");
  assert.ok(rewrite, `web forwarded ${path} to the API`);
  assert.equal(new URL(rewrite).pathname, path);
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

test("the host controller's loopback readiness probe passes under production host checks", async () => {
  await production(async () => {
    for (const forwardedFor of [dockerGateway, undefined]) {
      const ready = await viaWeb("/api/v1/ready", {
        host: loopbackHost,
        forwardedFor,
      });
      assert.equal(ready.headers[HOST_HEADERS.host], loopbackHost);
      assert.equal(ready.headers[HOST_HEADERS.clientIp], forwardedFor);
      assert.equal(ready.response.statusCode, 200, ready.response.body);
      assert.deepEqual(ready.response.json(), { status: "ready" });
      const health = await viaWeb("/api/v1/health", {
        host: loopbackHost,
        forwardedFor,
      });
      assert.equal(health.response.statusCode, 200, health.response.body);
    }
    // Web serves /health itself, so sign the loopback host exactly as the web
    // proxy does and send it to the API's root health route.
    const signed = verifiedProxyHeaders(
      new Headers({ host: loopbackHost }),
      loopbackHost,
      "GET",
      "/health",
      secret,
      Date.now(),
      dockerGateway,
    );
    const root = await app.inject({
      url: "/health",
      remoteAddress: webContainer,
      headers: Object.fromEntries(signed.entries()),
    });
    assert.equal(root.statusCode, 200, root.body);
    assert.equal(root.json().status, "ok");
    // A probe never selects a tenant, but its proof is still verified.
    const tampered = await app.inject({
      url: "/health",
      remoteAddress: webContainer,
      headers: {
        ...Object.fromEntries(signed.entries()),
        [HOST_HEADERS.clientIp]: "198.51.100.99",
      },
    });
    assert.equal(tampered.statusCode, 400);
    assert.equal(tampered.json().code, "HOST_SIGNATURE");
    // Non-probe routes on an unmapped loopback host are still refused.
    const unmapped = await viaWeb("/api/v1/public/host", {
      host: loopbackHost,
      forwardedFor: dockerGateway,
    });
    assert.equal(unmapped.response.statusCode, 421);
    assert.equal(unmapped.response.json().code, "UNKNOWN_HOST");
  });
});

test("a verified probe proof on an unmapped host still keys the client's budget", async () => {
  await production(async () => {
    const probe = (client: string) =>
      viaWeb("/api/v1/ready", { host: loopbackHost, forwardedFor: client });
    for (let index = 0; index < 120; index++) {
      const { response } = await probe("198.51.100.30");
      assert.equal(response.statusCode, 200, `Probe ${index + 1}`);
    }
    assert.equal((await probe("198.51.100.30")).response.statusCode, 429);
    assert.equal(
      (await probe("198.51.100.31")).response.statusCode,
      200,
      "Another signed client behind the same web container keeps its own budget",
    );
  });
});

let sequence = 0;
const nextSource = () =>
  `198.18.${Math.floor(sequence / 250)}.${(sequence++ % 250) + 1}`;
const login = (email: string, secretValue: string, source: string) =>
  viaWeb("/api/v1/auth/login", {
    method: "POST",
    forwardedFor: source,
    payload: { email, password: secretValue },
  });

test("one source cannot lock another source out of an account", async () => {
  const unknown = `deploy-missing-${randomUUID()}@example.test`;
  const bodies: any[] = [];
  for (const email of [guarded, unknown]) {
    // Under the per-client login route budget (15 per 10 minutes).
    const attacker = nextSource();
    for (let index = 0; index < 10; index++) {
      const { response } = await login(email, "wrong-password", attacker);
      assert.equal(response.statusCode, 401, `${email} ${index + 1}`);
    }
    const limited = await login(email, password, attacker);
    assert.equal(limited.response.statusCode, 429, limited.response.body);
    bodies.push(limited.response.json());
  }
  assert.equal(bodies[0].code, "TOO_MANY_ATTEMPTS");
  assert.deepEqual(
    { code: bodies[1].code, message: bodies[1].message },
    { code: bodies[0].code, message: bodies[0].message },
  );
  const owner = await login(guarded, password, nextSource());
  assert.equal(owner.response.statusCode, 200, owner.response.body);
  assert.match(String(owner.response.headers["set-cookie"]), /^session=/);
});

test("IPv6 sources share one per-account budget per /64", async () => {
  const email = `deploy-v6-${randomUUID()}@example.test`;
  for (let index = 1; index <= 10; index++) {
    const { response } = await login(
      email,
      "wrong-password",
      `2001:db8:5:6::${index.toString(16)}`,
    );
    assert.equal(response.statusCode, 401, `Attempt ${index}`);
  }
  const sameNetwork = await login(
    email,
    "wrong-password",
    "2001:db8:5:6::ffff",
  );
  assert.equal(sameNetwork.response.statusCode, 429);
  assert.equal(sameNetwork.response.json().code, "TOO_MANY_ATTEMPTS");
  const otherNetwork = await login(email, "wrong-password", "2001:db8:5:7::1");
  assert.equal(otherNetwork.response.statusCode, 401);
});

test("an account-wide ceiling bounds distributed guessing without revealing accounts", async () => {
  const unknown = `deploy-unknown-${randomUUID()}@example.test`;
  const bodies: any[] = [];
  for (const [email, wrong] of [
    [unknown, "wrong-password"],
    [distributed, "wrong-password"],
  ]) {
    // 100 per 15 minutes, spread across sources that each stay under 10.
    for (let index = 0; index < 100; index++) {
      const { response } = await login(email, wrong, nextSource());
      assert.equal(response.statusCode, 401, `${email} ${index + 1}`);
    }
    const limited = await login(email, password, nextSource());
    assert.equal(limited.response.statusCode, 429, limited.response.body);
    bodies.push(limited.response.json());
  }
  assert.equal(bodies[0].code, "TOO_MANY_ATTEMPTS");
  assert.deepEqual(
    { code: bodies[1].code, message: bodies[1].message },
    { code: bodies[0].code, message: bodies[0].message },
  );
});

test("attempt budgets: per source, account ceiling, and rejected attempts do not count", () => {
  mock.timers.enable({ apis: ["Date"], now: 2_000_000 });
  try {
    const headers: Record<string, string> = {};
    const reply = {
      header(name: string, value: string) {
        headers[name] = value;
        return reply;
      },
    } as any;
    const limited = (error: any) =>
      error.statusCode === 429 && error.code === "TOO_MANY_ATTEMPTS";
    const attempt = auth.accountAttempts(2, 60_000, 100, 5);
    attempt(reply, "Owner@Example.test", "198.51.100.1");
    attempt(reply, " owner@example.test ", "198.51.100.1");
    // One source that keeps going is refused and adds nothing to the ceiling.
    for (let index = 0; index < 20; index++)
      assert.throws(
        () => attempt(reply, "owner@example.test", "198.51.100.1"),
        limited,
      );
    assert.equal(headers["retry-after"], "60");
    attempt(reply, "owner@example.test", "198.51.100.2");
    attempt(reply, "owner@example.test", "198.51.100.2");
    mock.timers.tick(30_000);
    attempt(reply, "owner@example.test", "198.51.100.3");
    // Five attempts reached the ceiling: every source now waits for the window.
    assert.throws(
      () => attempt(reply, "owner@example.test", "198.51.100.4"),
      limited,
    );
    assert.equal(headers["retry-after"], "30");
    assert.doesNotThrow(() =>
      attempt(reply, "other@example.test", "198.51.100.4"),
    );
    mock.timers.tick(30_001);
    assert.doesNotThrow(() =>
      attempt(reply, "owner@example.test", "198.51.100.4"),
    );
  } finally {
    mock.timers.reset();
  }
  assert.equal(
    auth.clientSource({ ip: "::ffff:192.0.2.7" }),
    "192.0.2.7",
    "IPv4-mapped addresses are one IPv4 source",
  );
  assert.equal(
    auth.clientSource({
      ip: webContainer,
      hostContext: { verifiedProxy: true, clientIp: "2001:db8:1:2:3:4:5:6" },
    }),
    "2001:db8:1:2::",
  );
  assert.equal(
    auth.clientSource({
      ip: webContainer,
      hostContext: { verifiedProxy: false, clientIp: "198.51.100.8" },
    }),
    webContainer,
    "Only an address inside a verified proof replaces the socket address",
  );
});
