import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import {
  createDatabase,
  putRecord,
  type Actor,
  type Database,
} from "@trainer/db";
import {
  registerIntegrationCompletion,
  syncWearableConnection,
  processIntegrationJobs,
  exportIntegrationData,
  disableUserIntegrations,
  sealIntegrationSecret,
  openIntegrationSecret,
  normalizeDomain,
} from "../apps/api/src/integrations-completion.ts";
import {
  withRuntimeConfig,
  testIntegration,
} from "../packages/providers/src/configuration.ts";
import {
  withIntegrationFixtureTransport,
  wearableAuthorization,
} from "../packages/providers/src/integrations.ts";
import {
  verifiedProxyHeaders,
  customHostPath,
} from "../apps/web/host-proxy.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
import {
  resolveRequestHost,
  signHostRequest,
  enforceHostTenant,
  allowedRequestOrigin,
} from "../apps/api/src/host-routing.ts";

let db: Database,
  app: ReturnType<typeof Fastify>,
  tenantId: string,
  foreignTenant: string;
let owner: Actor, user: Actor, other: Actor, operator: Actor;
const actors = new Map<string, Actor>();
const oldKey = process.env.SECURITY_ENCRYPTION_KEY,
  originalFetch = globalThis.fetch;
const config = {
  WHOOP_CLIENT_ID: "fixture-client",
  WHOOP_CLIENT_SECRET: "fixture-secret",
  WHOOP_REDIRECT_URI:
    "https://coaching.example.com/api/v1/integrations/whoop/callback",
  WHOOP_CONTRACT_VERIFIED: "true",
  WHOOP_SCOPES: "offline read:recovery read:sleep read:workout",
  PUBLIC_APP_URL: "https://coaching.example.com",
  VOICE_CONTRACT_VERIFIED: "true",
  VOICE_PROVIDER: "elevenlabs",
  VOICE_API_KEY: "fixture-only",
  VOICE_BASE_URL: "https://voice.example.com/v1",
  VOICE_MODEL: "fixture-model",
  VOICE_PRICE_VERSION: "fixture-price-v1",
  VOICE_USD_PER_1000_CHARACTERS: "1",
  VOICE_DAILY_USD_LIMIT: "2",
  DOMAIN_OPERATIONS_ENABLED: "true",
  DOMAIN_CNAME_TARGET: "ingress.example.com",
};
let tokenCalls = 0,
  audioCalls = 0,
  revokeCalls = 0,
  rejectAudio = false,
  txtToken = "";
let tokenGate: ((init: RequestInit) => Promise<Response>) | undefined;
const revokedTokens: string[] = [];
async function actor(tid: string, role: string) {
  const a = { tenantId: tid, userId: randomUUID(), role };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Integration fixture','fixture-unused')",
      [a.userId, a.userId + "@example.invalid"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tid, a.userId, role],
    );
  });
  actors.set(a.userId, a);
  return a;
}
async function request(
  path: string,
  method: any = "GET",
  payload?: any,
  as: Actor | null = user,
  site = config.PUBLIC_APP_URL,
) {
  return withIntegrationFixtureTransport(
    (url, init) => globalThis.fetch(url, init),
    () =>
      withRuntimeConfig(
        config,
        async () =>
          await app.inject({
            method,
            url: "/api/v1" + path,
            headers: {
              ...(as
                ? {
                    "x-fixture-user": as.userId,
                    cookie: "session=" + as.userId,
                  }
                : {}),
              "x-fixture-origin": site,
            },
            payload,
          }),
      ),
  );
}
async function ok(path: string, method: any = "GET", payload?: any, as = user) {
  const r = await request(path, method, payload, as);
  assert.ok(r.statusCode < 400, r.body);
  return r;
}
before(async () => {
  process.env.SECURITY_ENCRYPTION_KEY = Buffer.alloc(32, 49).toString("base64");
  db = await createDatabase({ memory: true });
  tenantId = randomUUID();
  foreignTenant = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,'Integration fixture',true),($3,$4,'Foreign fixture',true)",
      [
        tenantId,
        "integration-" + tenantId,
        foreignTenant,
        "foreign-" + foreignTenant,
      ],
    ),
  );
  owner = await actor(tenantId, "owner");
  user = await actor(tenantId, "subscriber");
  other = await actor(foreignTenant, "owner");
  operator = await actor(foreignTenant, "owner");
  app = Fastify();
  await app.register(cookie);
  app.addHook("preHandler", async (req: FastifyRequest) => {
    (req as any).hostContext = {
      origin: String(req.headers["x-fixture-origin"] ?? config.PUBLIC_APP_URL),
    };
    const a = actors.get(String(req.headers["x-fixture-user"]));
    if (a)
      req.identity = {
        ...a,
        name: "Fixture",
        email: "fixture@example.invalid",
        emailVerified: true,
        platformRole: a.userId === operator.userId ? "admin" : "none",
        mfaAt: new Date().toISOString(),
      };
  });
  app.setErrorHandler((e: any, _req: FastifyRequest, reply: FastifyReply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ code: e.code, message: e.message }),
  );
  registerIntegrationCompletion(app, db, {
    txt: async () => [["trainer-verification=" + txtToken]],
    cname: async () => ["ingress.example.com"],
  });
  globalThis.fetch = async (input, init) => {
    const u = String(input);
    if (u.includes("oauth2/token")) {
      tokenCalls++;
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.has("code_verifier"), false);
      if (tokenGate) return tokenGate(init ?? {});
      return Response.json({
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        expires_in: 3600,
        scope: config.WHOOP_SCOPES,
      });
    }
    if (u.includes("/user/access")) {
      revokeCalls++;
      revokedTokens.push(new Headers(init?.headers).get("Authorization") ?? "");
      assert.equal(init?.method, "DELETE");
      return new Response(null, { status: 204 });
    }
    if (u.includes("/recovery"))
      return Response.json({
        records: [
          {
            cycle_id: 123,
            created_at: "2026-09-01T08:00:00Z",
            score_state: "SCORED",
            score: { recovery_score: 75 },
          },
        ],
      });
    if (u.includes("/activity/")) return Response.json({ records: [] });
    if (u.includes("/text-to-speech/")) {
      audioCalls++;
      if (rejectAudio) throw new Error("ambiguous provider timeout");
      return new Response(Buffer.from("ID3fixture-audio"), {
        headers: {
          "Content-Type": "audio/mpeg",
          "request-id": "fixture-audio-id",
        },
      });
    }
    if (init?.method === "HEAD") return new Response(null, { status: 421 });
    throw new Error("Unexpected external request: " + u);
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (oldKey === undefined) delete process.env.SECURITY_ENCRYPTION_KEY;
  else process.env.SECURITY_ENCRYPTION_KEY = oldKey;
  await app.close();
  await db.close();
});

test("integration credentials are authenticated to their tenant and user scope", () => {
  const secret = sealIntegrationSecret("tenant:user:whoop", {
    access_token: "never-public",
  });
  assert.equal(secret.includes("never-public"), false);
  assert.deepEqual(openIntegrationSecret("tenant:user:whoop", secret), {
    access_token: "never-public",
  });
  assert.throws(
    () => openIntegrationSecret("other:user:whoop", secret),
    /could not be read/,
  );
});
test("unapproved partner and voice contracts remain unavailable despite credentials", async () => {
  for (const provider of ["whoop", "zepp", "voice", "domains"])
    assert.equal((await testIntegration(provider, {})).status, "unavailable");
  assert.equal((await testIntegration("whoop", config)).status, "validated");
  assert.equal(
    (
      await testIntegration("zepp", {
        ZEPP_CONTRACT_VERIFIED: "true",
        ZEPP_CLIENT_ID: "fixture",
        ZEPP_CLIENT_SECRET: "fixture",
        ZEPP_REDIRECT_URI: "https://partner.example.com/callback",
        ZEPP_API_BASE_URL: "https://partner.example.com",
        ZEPP_AUTHORIZE_URL: "https://partner.example.com/authorize",
        ZEPP_TOKEN_URL: "https://partner.example.com/token",
        ZEPP_SCOPES: "observations",
        ZEPP_ADAPTER_CONTRACT: "unreviewed",
      })
    ).status,
    "failed",
  );
});
test("WHOOP confidential OAuth uses session/tenant-bound one-time state and encrypted storage", async () => {
  const response = (
    await ok("/integrations/whoop/connect", "POST", { consent: true })
  ).json();
  const url = new URL(response.url),
    state = url.searchParams.get("state")!;
  assert.equal(url.searchParams.has("code_challenge_method"), false);
  assert.equal(url.searchParams.has("code_challenge"), false);
  const bad = await request(
    "/integrations/whoop/callback?code=fixture&state=" + state,
    "GET",
    undefined,
    other,
  );
  assert.equal(bad.statusCode, 400);
  assert.equal(tokenCalls, 0);
  const success = await ok(
    "/integrations/whoop/callback?code=fixture&state=" + state,
  );
  assert.equal(success.statusCode, 302);
  assert.equal(tokenCalls, 1);
  assert.equal(
    (await request("/integrations/whoop/callback?code=fixture&state=" + state))
      .statusCode,
    400,
  );
  assert.equal(tokenCalls, 1);
  const publicBody = (await ok("/integrations/connections")).body;
  assert.equal(publicBody.includes("fixture-access"), false);
  assert.equal(publicBody.includes("credentials"), false);
  const [row] = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT credentials FROM integration_connections WHERE user_id=$1",
      [user.userId],
    ),
  );
  assert.equal(row.credentials.includes("fixture-access"), false);
  assert.equal(
    (await ok("/integrations/connections", "GET", undefined, other)).json()
      .connections.length,
    0,
  );
});
test("wearable synchronization deduplicates facts and keeps provider observations out of model inputs", async () => {
  await withIntegrationFixtureTransport(
    (url, init) => globalThis.fetch(url, init),
    () =>
      withRuntimeConfig(config, () =>
        syncWearableConnection(db, user, "whoop"),
      ),
  );
  await withIntegrationFixtureTransport(
    (url, init) => globalThis.fetch(url, init),
    () =>
      withRuntimeConfig(config, () =>
        syncWearableConnection(db, user, "whoop"),
      ),
  );
  const rows = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind='wearable' AND owner_user_id=$1",
      [user.userId],
    ),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].data.allowedUses, [
    "render",
    "deterministic_feature",
  ]);
  assert.equal(rows[0].data.observations[0].value, 75);
  const exported = await db.tenant(owner, (tx) =>
    exportIntegrationData(tx, user.userId),
  );
  assert.equal(JSON.stringify(exported).includes("fixture-access"), false);
});
test("revocation stops local use immediately and confirms provider removal without retaining credentials", async () => {
  await ok("/integrations/whoop/revoke", "POST", {});
  assert.equal(
    (await request("/integrations/whoop/sync", "POST", {})).statusCode,
    409,
  );
  await withIntegrationFixtureTransport(
    (url, init) => globalThis.fetch(url, init),
    () => withRuntimeConfig(config, () => processIntegrationJobs(db)),
  );
  assert.equal(revokeCalls, 1);
  const [connection] = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT status,credentials FROM integration_connections WHERE user_id=$1",
      [user.userId],
    ),
  );
  assert.equal(connection.status, "revoked");
  assert.equal(connection.credentials, null);
  const [observation] = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT status,data FROM records WHERE kind='wearable' AND owner_user_id=$1",
      [user.userId],
    ),
  );
  assert.equal(observation.status, "permission_revoked");
  assert.deepEqual(observation.data.allowedUses, ["render"]);
});

let workoutId: string;
test("voice enrollment requires reviewed identity/rights, premium membership and a server-owned workout script", async () => {
  const enrolled = (
    await ok(
      "/voice/profile",
      "POST",
      {
        revision: 0,
        consent: true,
        rights: true,
        providerVoiceId: "fixture-owned-voice",
        statement:
          "This is my voice and I authorize assigned workout guidance.",
      },
      owner,
    )
  ).json();
  assert.equal(enrolled.status, "pending");
  assert.equal(
    (
      await request(
        `/admin/integrations/voices/${enrolled.id}/verify`,
        "POST",
        {
          revision: enrolled.version,
          ownerIdentityVerified: true,
          providerRightsVerified: true,
          evidence: "Identity and provider voice rights checked in fixture.",
        },
        owner,
      )
    ).statusCode,
    403,
  );
  await ok(
    `/admin/integrations/voices/${enrolled.id}/verify`,
    "POST",
    {
      revision: enrolled.version,
      ownerIdentityVerified: true,
      providerRightsVerified: true,
      evidence: "Identity and provider voice rights checked in fixture.",
    },
    operator,
  );
  await db.tenant(owner, async (tx) => {
    const w = await putRecord(
      tx,
      user,
      "workout",
      {
        program: {
          name: "Fixture workout",
          exercises: [
            {
              name: "Squat",
              sets: 2,
              reps: "8",
              notes: "Keep the movement controlled",
              restSeconds: 60,
            },
            { name: "Lunge", sets: 2, reps: "6", restSeconds: 45 },
          ],
        },
      },
      { ownerId: user.userId, status: "active" },
    );
    workoutId = w.id;
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,data) VALUES($1,$2,$3,'active',now()+interval '1 month','{\"modules\":[\"training\"]}')",
      [randomUUID(), tenantId, user.userId],
    );
  });
  assert.equal(
    (
      await request(`/guided/${workoutId}/audio`, "POST", {
        segment: 0,
        consent: true,
      })
    ).statusCode,
    402,
  );
  assert.equal(audioCalls, 0);
  await db.tenant(owner, (tx) =>
    tx.query(
      'UPDATE subscriptions SET data=\'{"modules":["training","voice"]}\' WHERE user_id=$1',
      [user.userId],
    ),
  );
  const generated = (
    await ok(`/guided/${workoutId}/audio`, "POST", {
      segment: 0,
      consent: true,
    })
  ).json();
  assert.equal(generated.status, "ready");
  assert.equal(audioCalls, 1);
  const duplicate = (
    await ok(`/guided/${workoutId}/audio`, "POST", {
      segment: 0,
      consent: true,
    })
  ).json();
  assert.equal(duplicate.id, generated.id);
  assert.equal(audioCalls, 1);
  const usage = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT status,cost_usd,pricing FROM cost_events WHERE task='voice.guidance'",
    ),
  );
  assert.equal(usage[0].status, "unknown");
  assert.equal(usage[0].cost_usd, null);
  assert.ok(Number(usage[0].pricing.reservedCostUsd) > 0);
  assert.equal(
    (await ok(generated.audioUrl.replace("/api/v1", ""))).headers[
      "content-type"
    ],
    "audio/mpeg",
  );
});
test("ambiguous voice results are never re-sent and safety holds block existing audio playback", async () => {
  rejectAudio = true;
  const first = (
      await ok(`/guided/${workoutId}/audio`, "POST", {
        segment: 1,
        consent: true,
      })
    ).json(),
    calls = audioCalls;
  assert.equal(first.status, "unknown");
  const retry = (
    await ok(`/guided/${workoutId}/audio`, "POST", {
      segment: 1,
      consent: true,
    })
  ).json();
  assert.equal(retry.id, first.id);
  assert.equal(audioCalls, calls);
  await db.tenant(owner, (tx) =>
    tx.query("UPDATE records SET status='safety_hold' WHERE id=$1", [
      workoutId,
    ]),
  );
  assert.equal((await request(`/guided/${workoutId}`)).statusCode, 409);
  await db.tenant(owner, async (tx) => {
    await disableUserIntegrations(tx, owner.userId, "voice");
    const audio = await tx.query("SELECT status,audio FROM guided_audio");
    assert.ok(audio.every((x) => x.status === "revoked" && x.audio === null));
  });
});
test("domain quote approval uses exact price, CAS, DNS proof and administrator TLS activation", async () => {
  assert.throws(() => normalizeDomain("https://invalid.example.com/path"));
  assert.throws(() => normalizeDomain("127.0.0.1"));
  const order = (
    await ok(
      "/domains",
      "POST",
      { hostname: "trainer.example.com", alreadyOwned: false },
      owner,
    )
  ).json();
  txtToken = order.token;
  const quote = (
    await ok(
      `/admin/integrations/domains/${order.id}/quote`,
      "POST",
      {
        revision: order.version,
        amountMinor: 4000,
        currency: "AED",
        renewalMinor: 5000,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        termMonths: 12,
        providerReference: "fixture-quote",
      },
      operator,
    )
  ).json();
  assert.equal(
    (
      await request(
        `/domains/${order.id}/approve`,
        "POST",
        {
          revision: quote.version,
          amountMinor: 3999,
          currency: "AED",
          accepted: true,
        },
        owner,
      )
    ).statusCode,
    409,
  );
  const approved = (
    await ok(
      `/domains/${order.id}/approve`,
      "POST",
      {
        revision: quote.version,
        amountMinor: 4000,
        currency: "AED",
        accepted: true,
      },
      owner,
    )
  ).json();
  const owned = (
    await ok(
      `/admin/integrations/domains/${order.id}/ownership`,
      "POST",
      {
        revision: approved.version,
        registrarReference: "fixture-registration",
        paymentEvidence: "Fixture registrar paid receipt verified",
        expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      },
      operator,
    )
  ).json();
  const verified = (
    await ok(
      `/domains/${order.id}/verify`,
      "POST",
      { revision: owned.version },
      owner,
    )
  ).json();
  const active = (
    await ok(
      `/admin/integrations/domains/${order.id}/activate`,
      "POST",
      {
        revision: verified.version,
        dnsTarget: "ingress.example.com",
        registrarReference: "fixture-registration",
        expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      },
      operator,
    )
  ).json();
  assert.equal(active.status, "active");
  assert.equal(
    (await ok("/domains", "GET", undefined, other)).json().length,
    0,
  );
});
test("signed custom host binds method and exact target, rejects forgery and enforces tenant/origin", async () => {
  const secret = "separate-fixture-key-at-least-32-bytes",
    time = String(Date.now()),
    host = "trainer.example.com",
    target = "/api/v1/bootstrap?view=client";
  const headers = {
    host: "127.0.0.1:4000",
    "x-trainer-host": host,
    "x-trainer-host-time": time,
    "x-trainer-host-signature": signHostRequest(
      host,
      "GET",
      target,
      time,
      secret,
    ),
  };
  const context = await resolveRequestHost(
    db,
    { method: "GET", url: target, headers },
    { secret, publicUrl: config.PUBLIC_APP_URL, production: true },
  );
  assert.equal(context.tenantId, tenantId);
  assert.equal(context.origin, "https://trainer.example.com");
  assert.throws(
    () => enforceHostTenant(context, other),
    /connected to this address/,
  );
  assert.doesNotThrow(() => enforceHostTenant(context, user));
  assert.equal(
    allowedRequestOrigin(context, "https://trainer.example.com"),
    true,
  );
  assert.equal(allowedRequestOrigin(context, config.PUBLIC_APP_URL), false);
  await assert.rejects(
    resolveRequestHost(
      db,
      { method: "POST", url: target, headers },
      { secret, publicUrl: config.PUBLIC_APP_URL },
    ),
    /does not match/,
  );
  await assert.rejects(
    resolveRequestHost(
      db,
      { method: "GET", url: target + "x", headers },
      { secret, publicUrl: config.PUBLIC_APP_URL },
    ),
    /does not match/,
  );
  await assert.rejects(
    resolveRequestHost(
      db,
      { method: "GET", url: target, headers },
      { secret, publicUrl: config.PUBLIC_APP_URL, now: Date.now() + 60000 },
    ),
    /expired/,
  );
  await assert.rejects(
    resolveRequestHost(
      db,
      {
        method: "GET",
        url: target,
        headers: { host, "x-forwarded-host": config.PUBLIC_APP_URL },
      },
      { secret, publicUrl: config.PUBLIC_APP_URL, production: true },
    ),
    /not connected/,
  );
});

const fixture = <T>(callback: () => T) =>
  withIntegrationFixtureTransport(
    (url, init) => globalThis.fetch(url, init),
    () => withRuntimeConfig(config, callback),
  );
async function seedConnection(
  a: Actor,
  options: { expired?: boolean; status?: string } = {},
) {
  await db.tenant({ ...a, role: "owner" }, async (tx) => {
    await tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'wearable:whoop','fixture',true)",
      [randomUUID(), a.tenantId, a.userId],
    );
    await tx.query(
      "INSERT INTO integration_connections(id,tenant_id,user_id,provider,status,credentials) VALUES($1,$2,$3,'whoop',$4,$5)",
      [
        randomUUID(),
        a.tenantId,
        a.userId,
        options.status ?? "active",
        sealIntegrationSecret(`${a.tenantId}:${a.userId}:whoop`, {
          access_token: "fixture-old-access",
          refresh_token: "fixture-old-refresh",
          expires_in: 3600,
          obtainedAt: Date.now() - (options.expired ? 7200000 : 0),
          scope: config.WHOOP_SCOPES,
        }),
      ],
    );
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("custom-domain OAuth callback relays only stored state to its verified origin before session redemption", async () => {
  const a = await actor(tenantId, "subscriber"),
    custom = "https://trainer.example.com";
  const start = await request(
    "/integrations/whoop/connect",
    "POST",
    { consent: true },
    a,
    custom,
  );
  assert.equal(start.statusCode, 200, start.body);
  const state = new URL(start.json().url).searchParams.get("state")!,
    calls = tokenCalls;
  const relay = await request(
    `/integrations/whoop/callback?state=${state}&code=fixture-custom-code`,
    "GET",
    undefined,
    null,
  );
  assert.equal(relay.statusCode, 302, relay.body);
  assert.equal(relay.headers["referrer-policy"], "no-referrer");
  assert.equal(tokenCalls, calls);
  const location = new URL(relay.headers.location!);
  assert.equal(location.origin, custom);
  const wrongSession = await request(
    location.pathname.replace("/api/v1", "") + location.search,
    "GET",
    undefined,
    user,
    custom,
  );
  assert.equal(wrongSession.statusCode, 400);
  const completed = await request(
    location.pathname.replace("/api/v1", "") + location.search,
    "GET",
    undefined,
    a,
    custom,
  );
  assert.equal(completed.statusCode, 302, completed.body);
  assert.equal(tokenCalls, calls + 1);
  assert.equal(
    completed.headers.location,
    custom + "/app/wearables?connection=connected",
  );
  await ok("/integrations/whoop/revoke", "POST", {}, a);
  await fixture(() => processIntegrationJobs(db));
});

test("revocation during authorization exchange preserves only encrypted credentials for provider cleanup", async () => {
  const a = await actor(tenantId, "subscriber"),
    start = (
      await ok("/integrations/whoop/connect", "POST", { consent: true }, a)
    ).json(),
    state = new URL(start.url).searchParams.get("state")!;
  const entered = deferred(),
    release = deferred();
  tokenGate = async () => {
    entered.resolve();
    await release.promise;
    return Response.json({
      access_token: "fixture-after-revoke",
      refresh_token: "fixture-refresh",
      expires_in: 3600,
      scope: config.WHOOP_SCOPES,
    });
  };
  const callback = request(
    `/integrations/whoop/callback?state=${state}&code=fixture-racing-code`,
    "GET",
    undefined,
    a,
  );
  try {
    await entered.promise;
    await ok("/integrations/whoop/revoke", "POST", {}, a);
    release.resolve();
    const result = await callback;
    assert.match(result.headers.location!, /revocation_pending$/);
  } finally {
    release.resolve();
    tokenGate = undefined;
  }
  const [r] = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT status,credentials,scopes FROM integration_connections WHERE user_id=$1",
      [a.userId],
    ),
  );
  assert.equal(r.status, "revocation_pending");
  assert.deepEqual(r.scopes, []);
  assert.equal(r.credentials.includes("fixture-after-revoke"), false);
  await fixture(() => processIntegrationJobs(db));
  assert.equal(revokedTokens.at(-1), "Bearer fixture-after-revoke");
});

test("WHOOP refresh is serialized and rotated authorization survives concurrent local revocation for cleanup", async () => {
  const a = await actor(tenantId, "subscriber");
  await seedConnection(a, { expired: true });
  const entered = deferred(),
    release = deferred(),
    calls = tokenCalls;
  tokenGate = async (init) => {
    const form = new URLSearchParams(String(init.body));
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "fixture-old-refresh");
    assert.equal(form.get("scope"), "offline");
    entered.resolve();
    await release.promise;
    return Response.json({
      access_token: "fixture-rotated-access",
      refresh_token: "fixture-rotated-refresh",
      expires_in: 3600,
      scope: config.WHOOP_SCOPES,
    });
  };
  const syncing = fixture(() => syncWearableConnection(db, a, "whoop"));
  try {
    await entered.promise;
    await assert.rejects(
      fixture(() => syncWearableConnection(db, a, "whoop")),
      /not ready to synchronize/,
    );
    await ok("/integrations/whoop/revoke", "POST", {}, a);
    release.resolve();
    assert.deepEqual(await syncing, { revoked: true });
    assert.equal(tokenCalls, calls + 1);
  } finally {
    release.resolve();
    tokenGate = undefined;
  }
  const [r] = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT status,credentials FROM integration_connections WHERE user_id=$1",
      [a.userId],
    ),
  );
  assert.equal(r.status, "revocation_pending");
  const rotated = openIntegrationSecret<any>(
    `${a.tenantId}:${a.userId}:whoop`,
    r.credentials,
  );
  assert.equal(rotated.access_token, "fixture-rotated-access");
  assert.equal(rotated.refresh_token, "fixture-rotated-refresh");
  await fixture(() => processIntegrationJobs(db));
  assert.equal(revokedTokens.at(-1), "Bearer fixture-rotated-access");
});

test("unknown refresh outcomes require reconnect and are never automatically replayed", async () => {
  const a = await actor(tenantId, "subscriber");
  await seedConnection(a, { expired: true });
  const calls = tokenCalls;
  tokenGate = async () => {
    throw new Error("Uncertain token rotation");
  };
  try {
    await assert.rejects(
      fixture(() => syncWearableConnection(db, a, "whoop")),
      /could not complete/,
    );
  } finally {
    tokenGate = undefined;
  }
  const [r] = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT status,summary FROM integration_connections WHERE user_id=$1",
      [a.userId],
    ),
  );
  assert.equal(r.status, "attention");
  assert.equal(r.summary.refreshOutcomeUnknown, true);
  await fixture(() => processIntegrationJobs(db));
  assert.equal(tokenCalls, calls + 1);
});

test("closed workspaces and removed members cannot synchronize but queued revocation still runs", async () => {
  const tid = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name,lifecycle_state) VALUES($1,$2,'Closed integration fixture','active')",
      [tid, "closed-" + tid],
    ),
  );
  const a = await actor(tid, "subscriber");
  await seedConnection(a);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [tid]),
  );
  const calls = tokenCalls;
  await assert.rejects(
    fixture(() => syncWearableConnection(db, a, "whoop")),
    /no longer active/,
  );
  await fixture(() => processIntegrationJobs(db));
  assert.equal(tokenCalls, calls);
  await db.tenant({ ...a, role: "owner" }, (tx) =>
    disableUserIntegrations(tx, a.userId, "wearable"),
  );
  await db.system((tx) =>
    tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
      tid,
      a.userId,
    ]),
  );
  const before = revokeCalls;
  await fixture(() => processIntegrationJobs(db));
  assert.equal(revokeCalls, before + 1);
  const [r] = await db.tenant({ ...a, role: "owner" }, (tx) =>
    tx.query(
      "SELECT status,credentials FROM integration_connections WHERE user_id=$1",
      [a.userId],
    ),
  );
  assert.equal(r.status, "revoked");
  assert.equal(r.credentials, null);
});

test("non-owner runtime can run tenant-scoped worker and administrator lists without integration RLS bypass", async () => {
  const role = process.env.DATABASE_URL
    ? "trainer_service"
    : "integration_fixture_service";
  if (!process.env.DATABASE_URL)
    await db.system(async (tx) => {
      await tx.query(
        "CREATE ROLE integration_fixture_service NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT",
      );
      await tx.query("GRANT trainer_app TO integration_fixture_service");
      await tx.query(
        "GRANT SELECT ON tenants,memberships,domain_mappings TO integration_fixture_service",
      );
      await tx.query(
        "GRANT UPDATE ON domain_mappings TO integration_fixture_service",
      );
    });
  const restricted: Database = {
    ...db,
    system: (fn) =>
      db.system(async (tx) => {
        await tx.query(`SET LOCAL ROLE ${role}`);
        const [permissions] = await tx.query(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        );
        assert.equal(permissions.rolsuper, false);
        assert.equal(permissions.rolbypassrls, false);
        return fn(tx);
      }),
  };
  await fixture(() => processIntegrationJobs(restricted));
  const scopedApp = Fastify();
  scopedApp.addHook("preHandler", async (req) => {
    req.identity = {
      ...operator,
      name: "Fixture",
      email: "fixture@example.invalid",
      emailVerified: true,
      platformRole: "admin",
      mfaAt: new Date().toISOString(),
    };
  });
  registerIntegrationCompletion(scopedApp, restricted);
  try {
    const response = await scopedApp.inject({
      method: "GET",
      url: "/api/v1/admin/integrations/voices",
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(response.json().some((v: any) => v.tenant_id === tenantId));
  } finally {
    await scopedApp.close();
  }
});

test("proxy removes forged provenance, signs the exact target, and scopes public paths", () => {
  const key = "fixture-proxy-secret-at-least-32-bytes",
    incoming = new Headers({
      "x-trainer-host": "foreign.example.com",
      "x-trainer-site-slug": "foreign",
      "x-forwarded-host": "foreign.example.com",
      forwarded: "host=foreign.example.com",
      cookie: "session=fixture",
    }),
    time = 1777777777777;
  const headers = verifiedProxyHeaders(
    incoming,
    "trainer.example.com",
    "POST",
    "/api/v1/test?a=%2F",
    key,
    time,
  );
  assert.equal(headers.get("x-trainer-site-slug"), null);
  assert.equal(headers.get("x-forwarded-host"), null);
  assert.equal(headers.get("forwarded"), null);
  assert.equal(headers.get("cookie"), "session=fixture");
  assert.equal(
    headers.get("x-trainer-host-signature"),
    signHostRequest(
      "trainer.example.com",
      "POST",
      "/api/v1/test?a=%2F",
      String(time),
      key,
    ),
  );
  assert.equal(customHostPath("/about", "coach-one"), "/coach/coach-one/about");
  assert.equal(customHostPath("/app/nutrition", "coach-one"), "/app/nutrition");
  assert.equal(customHostPath("/trainer", "coach-one"), null);
  assert.equal(customHostPath("/coach/another", "coach-one"), null);
  assert.equal(customHostPath("/join-coach/another", "coach-one"), null);
  const partner = withRuntimeConfig(
    {
      ZEPP_CONTRACT_VERIFIED: "true",
      ZEPP_ADAPTER_CONTRACT: "canonical-observations-v1",
      ZEPP_CLIENT_ID: "fixture",
      ZEPP_CLIENT_SECRET: "fixture",
      ZEPP_REDIRECT_URI: "https://partner.invalid/callback",
      ZEPP_API_BASE_URL: "https://partner.invalid",
      ZEPP_AUTHORIZE_URL: "https://partner.invalid/authorize",
      ZEPP_TOKEN_URL: "https://partner.invalid/token",
      ZEPP_SCOPES: "observations",
    },
    () =>
      new URL(wearableAuthorization("zepp", "fixture-state", "fixture-pkce")),
  );
  assert.equal(partner.searchParams.get("code_challenge_method"), "S256");
});
