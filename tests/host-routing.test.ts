import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
import { signHostRequest, HOST_HEADERS } from "../apps/api/src/host-routing.ts";

let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  coach: any,
  foreign: any;
const host = "fitness.host-fixture.test",
  origin = "https://" + host;
const secret = "synthetic-host-proof-key-with-32-bytes-minimum";
const env = {
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
  INTERNAL_PROXY_SECRET: process.env.INTERNAL_PROXY_SECRET,
  WHOOP_CONTRACT_VERIFIED: process.env.WHOOP_CONTRACT_VERIFIED,
};
function request(
  path: string,
  method: any = "GET",
  payload?: any,
  cookie?: string,
  custom = true,
  overrides: Record<string, string> = {},
) {
  const url = "/api/v1" + path,
    time = String(Date.now());
  return app.inject({
    url,
    method,
    payload,
    headers: {
      host: "localhost:4000",
      origin: custom ? origin : "http://localhost:3000",
      ...(custom
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
      ...(cookie ? { cookie } : {}),
      ...overrides,
    },
  });
}
async function register(slug: string) {
  const r = await request(
    "/auth/register",
    "POST",
    {
      name: "Fixture " + slug,
      email: slug + "@host-fixture.test",
      password: "FixturePassword2026!",
      slug,
      accepted: true,
    },
    undefined,
    false,
  );
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const boot = await request("/bootstrap", "GET", undefined, cookie, false);
  assert.equal(boot.statusCode, 200, boot.body);
  return { ...boot.json().user, cookie, slug };
}
before(async () => {
  process.env.PUBLIC_APP_URL = "http://localhost:3000";
  process.env.INTERNAL_PROXY_SECRET = secret;
  process.env.WHOOP_CONTRACT_VERIFIED = "false";
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  coach = await register("host-coach-a");
  foreign = await register("host-coach-b");
  await db.system(async (tx) => {
    await tx.query("UPDATE tenants SET published=true WHERE id IN ($1,$2)", [
      coach.tenantId,
      foreign.tenantId,
    ]);
    await tx.query(
      "INSERT INTO domain_mappings(hostname,tenant_id,active,verified_at) VALUES($1,$2,true,now())",
      [host, coach.tenantId],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [foreign.tenantId, coach.userId],
    );
  });
});
after(async () => {
  await app?.close();
  await db?.close();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("full API host proof binds path, workspace, exact origin and public slug", async () => {
  const mapped = await request("/public/host");
  assert.equal(mapped.statusCode, 200, mapped.body);
  assert.equal(mapped.json().tenantId, coach.tenantId);
  assert.equal(mapped.json().origin, origin);
  assert.equal(
    (
      await request("/public/host", "GET", undefined, undefined, false, {
        host,
      })
    ).statusCode,
    421,
  );
  assert.equal(
    (
      await request("/public/host", "GET", undefined, undefined, true, {
        [HOST_HEADERS.signature]: "0".repeat(64),
      })
    ).statusCode,
    400,
  );
  const forwarded = await request(
    "/public/host",
    "GET",
    undefined,
    undefined,
    false,
    { "x-forwarded-host": host, forwarded: "host=" + host },
  );
  assert.equal(forwarded.json().custom, false);
  assert.equal(
    (await request("/public/trainers/" + foreign.slug)).statusCode,
    403,
  );
  assert.equal(
    (await request("/public/trainers/" + coach.slug)).statusCode,
    200,
  );
  assert.equal(
    (
      await request(
        "/settings",
        "POST",
        { emailNotifications: true, workoutReminders: true, marketing: false },
        coach.cookie,
        true,
        { origin: "https://foreign.host-fixture.test" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await request("/bootstrap", "GET", undefined, foreign.cookie)).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: "/health", headers: { host: "container.local" } }))
      .statusCode,
    200,
  );
});

test("custom-host login selects its membership and denies foreign workspace switching", async () => {
  const login = await request("/auth/login", "POST", {
    email: coach.email,
    password: "FixturePassword2026!",
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  const boot = await request("/bootstrap", "GET", undefined, cookie);
  assert.equal(boot.json().user.tenantId, coach.tenantId);
  const switchHost = await request(
    "/auth/workspace",
    "POST",
    { tenantId: foreign.tenantId },
    cookie,
  );
  assert.equal(switchHost.statusCode, 403, switchHost.body);
  assert.equal(
    (await request("/bootstrap", "GET", undefined, cookie)).statusCode,
    200,
    "denied switch preserves the current session",
  );
  const outsider = await request("/auth/login", "POST", {
    email: foreign.email,
    password: "FixturePassword2026!",
  });
  assert.equal(outsider.statusCode, 403);
});

test("custom enrollment and invitations cannot create a membership in a different workspace", async () => {
  assert.equal((await request("/auth/register", "POST", {})).statusCode, 403);
  const enrollment = {
    name: "Host client",
    email: "new@host-fixture.test",
    password: "FixturePassword2026!",
    coachSlug: foreign.slug,
    accepted: true,
  };
  assert.equal(
    (await request("/auth/enroll", "POST", enrollment)).statusCode,
    403,
  );
  const good = await request("/auth/enroll", "POST", {
    ...enrollment,
    coachSlug: coach.slug,
  });
  assert.equal(good.statusCode, 201, good.body);
  const cookie = String(good.headers["set-cookie"]).split(";")[0];
  assert.equal(
    (await request("/bootstrap", "GET", undefined, cookie)).json().user
      .tenantId,
    coach.tenantId,
  );
  for (const [tenantId, role] of [
    [foreign.tenantId, "subscriber"],
    [coach.tenantId, "staff"],
  ]) {
    const token = randomUUID() + randomUUID();
    await db.system((tx) =>
      tx.query(
        "INSERT INTO one_time_tokens(token_hash,purpose,tenant_id,payload,expires_at) VALUES($1,'invite',$2,$3,now()+interval '1 day')",
        [
          tokenHash(token),
          tenantId,
          JSON.stringify({
            email: "invite@host-fixture.test",
            role,
            invitedBy:
              tenantId === coach.tenantId ? coach.userId : foreign.userId,
          }),
        ],
      ),
    );
    const accepted = await request("/invitations/accept", "POST", {
      token,
      name: "Invited client",
      email: "invite@host-fixture.test",
      password: "FixturePassword2026!",
    });
    assert.equal(accepted.statusCode, 403, accepted.body);
    const [stored] = await db.system((tx) =>
      tx.query("SELECT consumed_at FROM one_time_tokens WHERE token_hash=$1", [
        tokenHash(token),
      ]),
    );
    assert.equal(stored.consumed_at, null);
  }
});

test("platform roles stay on the platform and a stale foreign cookie can sign out", async () => {
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role='admin' WHERE id=$1", [
      coach.userId,
    ]),
  );
  assert.equal(
    (
      await request("/auth/login", "POST", {
        email: coach.email,
        password: "FixturePassword2026!",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await request("/bootstrap", "GET", undefined, coach.cookie)).statusCode,
    403,
  );
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role='none' WHERE id=$1", [
      coach.userId,
    ]),
  );
  assert.equal(
    (await request("/auth/logout", "POST", {}, foreign.cookie)).statusCode,
    200,
  );
  assert.equal(
    (await request("/bootstrap", "GET", undefined, foreign.cookie, false))
      .statusCode,
    401,
  );
});

test("integration routes are registered and Apple imports require pinned explicit consent", async () => {
  const connections = await request(
    "/integrations/connections",
    "GET",
    undefined,
    coach.cookie,
  );
  assert.equal(connections.statusCode, 200, connections.body);
  const disabled = await request(
    "/integrations/whoop/connect",
    "POST",
    { consent: true },
    coach.cookie,
  );
  assert.equal(disabled.statusCode, 409, disabled.body);
  assert.equal(disabled.json().code, "INTEGRATION_CONFIGURATION");
  const body = {
    source: "apple_health",
    observations: [
      {
        type: "steps",
        value: 123,
        unit: "count",
        measuredAt: new Date().toISOString(),
      },
    ],
  };
  assert.equal(
    (await request("/wearables/import", "POST", body, coach.cookie)).statusCode,
    400,
  );
  const imported = await request(
    "/wearables/import",
    "POST",
    { ...body, consent: true },
    coach.cookie,
  );
  assert.equal(imported.statusCode, 200, imported.body);
  const [consent] = await db.tenant(coach, (tx) =>
    tx.query(
      "SELECT * FROM consent_records WHERE user_id=$1 AND document_type='wearable:apple_health'",
      [coach.userId],
    ),
  );
  assert.equal(consent.granted, true);
  assert.match(consent.document_version, /integration-consent:v1/);
  assert.deepEqual(imported.json().data.allowedUses, [
    "render",
    "deterministic_feature",
  ]);
  const revoked = await request(
    "/privacy/consent",
    "POST",
    { type: "wearable", granted: false },
    coach.cookie,
  );
  assert.equal(revoked.statusCode, 200, revoked.body);
  const [stored] = await db.tenant(coach, (tx) =>
    tx.query("SELECT status,data FROM records WHERE id=$1", [
      imported.json().id,
    ]),
  );
  assert.equal(stored.status, "permission_revoked");
  assert.deepEqual(stored.data.allowedUses, ["render"]);
});

test("closed workspaces cannot continue resolving a signed custom domain", async () => {
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      coach.tenantId,
    ]),
  );
  assert.equal((await request("/public/host")).statusCode, 421);
});
