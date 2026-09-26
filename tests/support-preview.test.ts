import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { tokenHash } from "../apps/api/src/auth.ts";
import { registerSupportPreview } from "../apps/api/src/support-preview.ts";

let db: Database;
const app = Fastify();
const operator = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  role: "owner",
  platformRole: "support",
};
const second = { ...operator, userId: randomUUID() };
const coach = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
const client = { ...coach, userId: randomUUID(), role: "subscriber" };
const foreign = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  role: "subscriber",
};
const session = randomUUID(),
  alternateSession = randomUUID(),
  secondSession = randomUUID();
const caseId = randomUUID();
const sentinels = [
  "PRIVATE-CASE-MESSAGE",
  "PRIVATE-HEALTH",
  "PRIVATE-PROVIDER-TOKEN",
  "PRIVATE-PAYMENT",
  "PRIVATE-OTHER-CLIENT",
];
before(async () => {
  db = await createDatabase({ memory: true });
  await app.register(cookie);
  await db.system(async (tx) => {
    for (const actor of [operator, second, coach, client, foreign])
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash,email_verified,platform_role) VALUES($1,$2,$3,'synthetic',true,$4)",
        [
          actor.userId,
          actor.userId + "@preview.example.test",
          actor === client ? "Case author" : "Fixture operator",
          actor === operator || actor === second ? "support" : "none",
        ],
      );
    for (const actor of [operator, coach, foreign])
      await tx.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Preview fixture')",
        [actor.tenantId, actor.tenantId],
      );
    for (const actor of [operator, second, coach, client, foreign])
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [actor.tenantId, actor.userId, actor.role],
      );
    for (const [token, actor] of [
      [session, operator],
      [alternateSession, operator],
      [secondSession, second],
    ] as const)
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,mfa_at) VALUES($1,$2,$3,now()+interval '1 day',now())",
        [tokenHash(token), actor.userId, actor.tenantId],
      );
  });
  await db.tenant(coach, async (tx) => {
    await putRecord(
      tx,
      coach,
      "support",
      {
        subject: sentinels[0],
        category: "technical",
        messages: [{ text: sentinels[0] }],
      },
      { id: caseId, ownerId: client.userId, status: "open" },
    );
    await putRecord(
      tx,
      coach,
      "nutrition_profile",
      { diagnosis: sentinels[1] },
      { ownerId: client.userId },
    );
    await putRecord(
      tx,
      coach,
      "wearable",
      {
        provider: "whoop",
        accessToken: sentinels[2],
        samples: [{ value: sentinels[1] }],
      },
      { ownerId: client.userId, status: "connected" },
    );
    await putRecord(
      tx,
      coach,
      "wearable",
      { provider: sentinels[4] },
      { ownerId: coach.userId, status: "connected" },
    );
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,price_minor,data) VALUES($1,$2,$3,$4,'active',now()+interval '1 month',987654,$5)",
      [
        randomUUID(),
        coach.tenantId,
        client.userId,
        sentinels[3],
        JSON.stringify({ payment: sentinels[3] }),
      ],
    );
  });
  app.addHook("onRequest", async (req) => {
    if (req.headers["x-custom"])
      req.hostContext = {
        host: "coach.example.test",
        origin: "https://coach.example.test",
        tenantId: coach.tenantId,
        tenantSlug: "coach",
        custom: true,
        verifiedProxy: true,
      };
  });
  app.setErrorHandler((e: any, _req, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ code: e.code, message: e.message }),
  );
  registerSupportPreview(app, db, (req) => ({
    ...(req.headers["x-second"] ? second : operator),
    mfaAt: new Date().toISOString(),
  }));
});
after(async () => {
  await app.close();
  await db.close();
});
const req = (
  path = "",
  method: any = "GET",
  payload?: any,
  headers: Record<string, string> = {},
) =>
  app.inject({
    url: "/api/v1/admin/support-previews" + path,
    method,
    payload,
    headers: { cookie: "session=" + session, ...headers },
  });
const body = (extra: Record<string, unknown> = {}) => ({
  tenantId: coach.tenantId,
  caseId,
  caseRevision: 1,
  requestKey: randomUUID(),
  reason: "Investigating the reported connection screen",
  minutes: 15,
  scopes: ["account", "access", "connections"],
  ...extra,
});
async function start(
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const response = await req("", "POST", body(extra), headers);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["set-cookie"], undefined);
  return response.json().grant;
}
async function caseState(status: string) {
  await db.tenant(coach, (tx) =>
    tx.query("UPDATE records SET status=$2 WHERE id=$1", [caseId, status]),
  );
}

test("preview grants require the live operator session, recent MFA, explicit scope and an open case", async () => {
  assert.equal((await req("", "POST", body(), { cookie: "" })).statusCode, 401);
  assert.equal(
    (await req("", "POST", body(), { "x-custom": "true" })).statusCode,
    403,
  );
  for (const change of [
    { minutes: 16 },
    { scopes: ["health"] },
    { scopes: [] },
    { scopes: ["account", "account"] },
    { reason: "short" },
    { targetUserId: foreign.userId },
  ])
    assert.equal((await req("", "POST", body(change))).statusCode, 400);
  await db.system((tx) =>
    tx.query(
      "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE token_hash=$1",
      [tokenHash(session)],
    ),
  );
  assert.equal((await req("", "POST", body())).statusCode, 403);
  await db.system((tx) =>
    tx.query("UPDATE sessions SET mfa_at=now() WHERE token_hash=$1", [
      tokenHash(session),
    ]),
  );
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role='finance' WHERE id=$1", [
      operator.userId,
    ]),
  );
  assert.equal(
    (await req("", "POST", body())).statusCode,
    403,
    "Current database role overrides stale identity metadata",
  );
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role='support' WHERE id=$1", [
      operator.userId,
    ]),
  );
  assert.equal(
    (await req("", "POST", body({ tenantId: foreign.tenantId }))).statusCode,
    404,
  );
  assert.equal(
    (await req("", "POST", body({ caseRevision: 999 }))).statusCode,
    409,
  );
  await caseState("resolved");
  assert.equal((await req("", "POST", body())).statusCode, 404);
  await caseState("open");
});

test("preview returns only approved fields and preserves the real operator identity", async () => {
  const g = await start(),
    response = await req("/" + g.id);
  assert.equal(response.statusCode, 200, response.body);
  const data = response.json();
  assert.equal(data.operator.id, operator.userId);
  assert.equal(data.target.id, client.userId);
  assert.deepEqual(Object.keys(data.projection).sort(), [
    "access",
    "account",
    "connections",
  ]);
  assert.equal(data.projection.access.subscriptionStatus, "active");
  assert.equal(data.projection.connections.length, 1);
  for (const secret of sentinels)
    assert.equal(response.body.includes(secret), false);
  for (const key of [
    "price_minor",
    "provider_id",
    "accessToken",
    "password_hash",
    "token_hash",
    "session_id",
    "fingerprint",
  ])
    assert.equal(response.body.includes(key), false);
  assert.equal(
    (
      await db.system((tx) =>
        tx.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1", [
          client.userId,
        ]),
      )
    )[0].n,
    0,
  );
  const [scope] = await db.system((tx) =>
    tx.query(
      "SELECT current_user AS role,current_setting('app.tenant_id',true) AS tenant",
    ),
  );
  assert.notEqual(scope.role, "trainer_app");
  assert.notEqual(scope.tenant, coach.tenantId);
  const narrow = await start({ scopes: ["account"] });
  assert.deepEqual(
    Object.keys((await req("/" + narrow.id)).json().projection),
    ["account"],
  );
  assert.equal(
    (await req("/" + g.id)).statusCode,
    410,
    "Opening a new preview replaces the prior one for this session",
  );
});

test("creation is idempotent and capability identity, mode, scope and expiry cannot be rewritten", async () => {
  const b = body(),
    responses = await Promise.all([req("", "POST", b), req("", "POST", b)]);
  for (const response of responses)
    assert.equal(response.statusCode, 200, response.body);
  const g = responses[0].json().grant;
  assert.equal(responses[1].json().grant.id, g.id);
  assert.equal(
    (
      await req("", "POST", {
        ...b,
        reason: "A different investigation reason",
      })
    ).statusCode,
    409,
  );
  const [count] = await db.system((tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM admin_operations_audit WHERE action='support.preview.started' AND data->>'grantId'=$1",
      [g.id],
    ),
  );
  assert.equal(count.n, 1);
  await assert.rejects(
    db.system((tx) =>
      tx.query(
        "UPDATE support_preview_grants SET expires_at=expires_at+interval '1 minute' WHERE id=$1",
        [g.id],
      ),
    ),
    /immutable/,
  );
  await assert.rejects(
    db.system((tx) =>
      tx.query(
        "UPDATE support_preview_grants SET target_user_id=$2 WHERE id=$1",
        [g.id, foreign.userId],
      ),
    ),
    /immutable/,
  );
  await assert.rejects(
    db.tenant(coach, (tx) => tx.query("SELECT * FROM support_preview_grants")),
    /permission denied/,
  );
});

test("each read remains bound to its exact sign-in session and open case", async () => {
  const g = await start();
  assert.equal(
    (
      await req("/" + g.id, "GET", undefined, {
        cookie: "session=" + alternateSession,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await req("/" + g.id, "GET", undefined, {
        cookie: "session=" + secondSession,
        "x-second": "true",
      })
    ).statusCode,
    404,
  );
  await caseState("resolved");
  assert.equal((await req("/" + g.id)).statusCode, 410);
  assert.equal(
    (
      await db.system((tx) =>
        tx.query("SELECT status FROM support_preview_grants WHERE id=$1", [
          g.id,
        ]),
      )
    )[0].status,
    "revoked",
  );
  await caseState("open");
  assert.equal(
    (await req("/" + g.id)).statusCode,
    410,
    "Reopening a case never revives a capability",
  );
});

test("membership changes, workspace closure, operator scope loss and session expiry stop access", async () => {
  let g = await start();
  await db.system((tx) =>
    tx.query(
      "UPDATE memberships SET role='staff' WHERE tenant_id=$1 AND user_id=$2",
      [coach.tenantId, client.userId],
    ),
  );
  assert.equal((await req("/" + g.id)).statusCode, 410);
  await db.system((tx) =>
    tx.query(
      "UPDATE memberships SET role='subscriber' WHERE tenant_id=$1 AND user_id=$2",
      [coach.tenantId, client.userId],
    ),
  );
  g = await start();
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      coach.tenantId,
    ]),
  );
  assert.equal((await req("/" + g.id)).statusCode, 410);
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='active' WHERE id=$1", [
      coach.tenantId,
    ]),
  );
  g = await start();
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role='finance' WHERE id=$1", [
      operator.userId,
    ]),
  );
  assert.equal((await req("/" + g.id)).statusCode, 403);
  assert.equal(
    (await req("/" + g.id + "/end", "POST", { revision: g.revision }))
      .statusCode,
    200,
    "Losing scope must not prevent stopping one's preview",
  );
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role='support' WHERE id=$1", [
      operator.userId,
    ]),
  );
  const headers = { cookie: "session=" + alternateSession };
  g = await start({}, headers);
  await db.system((tx) =>
    tx.query(
      "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [tokenHash(alternateSession)],
    ),
  );
  assert.equal(
    (await req("/" + g.id, "GET", undefined, headers)).statusCode,
    401,
  );
  await db.system((tx) =>
    tx.query(
      "UPDATE sessions SET expires_at=now()+interval '1 day' WHERE token_hash=$1",
      [tokenHash(alternateSession)],
    ),
  );
});

test("grants expire within 15 minutes, persist expiry audit and can be stopped without fresh MFA", async () => {
  const headers = { cookie: "session=" + alternateSession };
  await db.system((tx) =>
    tx.query(
      "UPDATE sessions SET expires_at=now()+interval '2 minutes' WHERE token_hash=$1",
      [tokenHash(alternateSession)],
    ),
  );
  const short = await start({}, headers);
  assert.ok(
    Date.parse(short.expiresAt) - Date.parse(short.createdAt) <= 120000,
  );
  const g = await start();
  assert.ok(Date.parse(g.expiresAt) - Date.parse(g.createdAt) <= 15 * 60000);
  assert.equal(
    (await req("/" + g.id + "/end", "POST", { revision: 999 })).statusCode,
    409,
  );
  await db.system((tx) =>
    tx.query(
      "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE token_hash=$1",
      [tokenHash(session)],
    ),
  );
  assert.equal((await req("/" + g.id)).statusCode, 403);
  assert.equal(
    (await req("/" + g.id + "/end", "POST", { revision: g.revision }))
      .statusCode,
    200,
  );
  assert.equal(
    (await req("/" + g.id + "/end", "POST", { revision: g.revision }))
      .statusCode,
    200,
  );
  await db.system((tx) =>
    tx.query("UPDATE sessions SET mfa_at=now() WHERE token_hash=$1", [
      tokenHash(session),
    ]),
  );
  const expiredId = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO support_preview_grants(id,operator_id,session_id,tenant_id,target_user_id,target_role,membership_version,case_id,request_key,fingerprint,reason,scopes,created_at,expires_at) SELECT $2,operator_id,session_id,tenant_id,target_user_id,target_role,membership_version,case_id,$3,fingerprint,reason,scopes,now()-interval '20 minutes',now()-interval '6 minutes' FROM support_preview_grants WHERE id=$1",
      [g.id, expiredId, randomUUID()],
    ),
  );
  assert.equal((await req("/" + expiredId)).statusCode, 410);
  assert.equal((await req("/" + expiredId)).statusCode, 410);
  const [proof] = await db.system((tx) =>
    tx.query(
      "SELECT g.status,(SELECT count(*)::int FROM admin_operations_audit a WHERE a.action='support.preview.expired' AND a.data->>'grantId'=g.id::text) AS audits FROM support_preview_grants g WHERE g.id=$1",
      [expiredId],
    ),
  );
  assert.equal(proof.status, "expired");
  assert.equal(proof.audits, 1);
});

test("preview mutations are rejected and every read or denial is attributed to the real operator", async () => {
  const g = await start();
  assert.equal((await req("/" + g.id)).statusCode, 200);
  assert.equal((await req("/" + g.id + "?fields=health")).statusCode, 400);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"])
    assert.equal(
      (
        await req("/" + g.id, method, {
          target: client.userId,
          text: "must never become a message",
        })
      ).statusCode,
      405,
    );
  const audit = await db.system((tx) =>
    tx.query(
      "SELECT actor_id,tenant_id,subject_id,action,data FROM admin_operations_audit WHERE data->>'grantId'=$1 ORDER BY created_at",
      [g.id],
    ),
  );
  assert.equal(
    audit.filter((row) => row.action === "support.preview.mutation_blocked")
      .length,
    4,
  );
  assert.equal(
    audit.filter((row) => row.action === "support.preview.read").length,
    1,
  );
  for (const row of audit) {
    assert.equal(row.actor_id, operator.userId);
    assert.equal(row.tenant_id, coach.tenantId);
    assert.equal(row.subject_id, client.userId);
  }
  assert.equal(
    JSON.stringify(audit).includes("must never become a message"),
    false,
  );
  const [original] = await db.tenant(coach, (tx) =>
    tx.query("SELECT data FROM records WHERE id=$1", [caseId]),
  );
  assert.equal(original.data.messages.length, 1);
});
