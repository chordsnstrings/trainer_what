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

async function processingConsent(
  type: "coaching" | "nutrition",
  granted: boolean,
) {
  await db.tenant(client, (tx) =>
    tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted,created_at) VALUES($1,$2,$3,$4,'fixture',$5,clock_timestamp())",
      [randomUUID(), client.tenantId, client.userId, type, granted],
    ),
  );
}
async function settings() {
  return db.tenant(
    client,
    async (tx) =>
      (
        await tx.query(
          "SELECT data,version FROM notification_preferences WHERE user_id=$1",
          [client.userId],
        )
      )[0],
  );
}
async function customerSettings(data: Record<string, unknown>) {
  await db.tenant(client, (tx) =>
    tx.query(
      "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET data=notification_preferences.data||excluded.data,version=notification_preferences.version+1 RETURNING *",
      [client.tenantId, client.userId, JSON.stringify(data)],
    ),
  );
}
function correctionBody(
  g: any,
  version: number,
  extra: Record<string, unknown> = {},
) {
  return {
    revision: g.revision,
    version,
    requestKey: randomUUID(),
    action: "notification_preferences",
    reason: "Customer requested a reminder correction in this case",
    changes: { timezone: "Europe/London" },
    ...extra,
  };
}
async function prepare(g: any, extra: Record<string, unknown> = {}) {
  const version = (await settings())?.version ?? 0;
  const result = await req(
    "/" + g.id + "/elevations",
    "POST",
    correctionBody(g, version, extra),
  );
  assert.equal(result.statusCode, 200, result.body);
  return result.json().elevation;
}
const apply = (g: any, e: any, headers: Record<string, string> = {}) =>
  req(
    "/" + g.id + "/elevations/" + e.id + "/apply",
    "POST",
    { revision: e.revision },
    headers,
  );

test("health screen scopes are explicit, bounded, consent checked per read and exclude raw history", async () => {
  const today = new Date().toISOString().slice(0, 10);
  await db.tenant(coach, async (tx) => {
    await putRecord(
      tx,
      coach,
      "planned_session",
      {
        date: today,
        label: "Morning strength",
        timezone: "Asia/Dubai",
        rescheduleNote: sentinels[1],
        program: {
          exercises: [{ name: "Squat", healthHistory: sentinels[1] }],
        },
      },
      { ownerId: client.userId, status: "planned" },
    );
    await putRecord(
      tx,
      coach,
      "planned_session",
      { date: today, label: sentinels[4] },
      { ownerId: coach.userId, status: "planned" },
    );
    await putRecord(
      tx,
      coach,
      "planned_session",
      { date: "2020-01-01", label: "OLD-SESSION" },
      { ownerId: client.userId, status: "planned" },
    );
    await putRecord(
      tx,
      coach,
      "nutrition_plan",
      {
        weekStart: today,
        explanation: sentinels[1],
        view: {
          days: [
            {
              date: today,
              totals: { kcal: 99999 },
              meals: [
                {
                  slot: "lunch",
                  name: "Lentil salad",
                  servings: 1.5,
                  description: sentinels[1],
                  nutrients: { kcal: 99999 },
                  ingredients: [{ secret: sentinels[1] }],
                },
              ],
            },
          ],
        },
      },
      { ownerId: client.userId, status: "delivered" },
    );
    await putRecord(
      tx,
      coach,
      "nutrition_plan",
      {
        weekStart: today,
        view: {
          days: [
            { date: today, meals: [{ slot: "lunch", name: sentinels[4] }] },
          ],
        },
      },
      { ownerId: coach.userId, status: "delivered" },
    );
  });
  const g = await start({
    scopes: [
      "training_schedule",
      "nutrition_schedule",
      "notification_settings",
    ],
  });
  let response = await req("/" + g.id),
    data = response.json();
  assert.equal(data.projection.trainingSchedule.state, "permission_required");
  assert.equal(data.projection.nutritionSchedule.state, "permission_required");
  assert.deepEqual(data.projection.trainingSchedule.sessions, []);
  assert.deepEqual(data.projection.nutritionSchedule.meals, []);
  assert.equal(data.projection.notificationSettings.version, 0);
  await processingConsent("coaching", true);
  await processingConsent("nutrition", true);
  response = await req("/" + g.id);
  data = response.json();
  assert.equal(data.projection.trainingSchedule.sessions.length, 1);
  assert.equal(
    data.projection.trainingSchedule.sessions[0].label,
    "Morning strength",
  );
  assert.equal(data.projection.trainingSchedule.sessions[0].exercise_count, 1);
  assert.equal(data.projection.nutritionSchedule.meals.length, 1);
  assert.equal(data.projection.nutritionSchedule.meals[0].name, "Lentil salad");
  assert.equal(data.projection.nutritionSchedule.meals[0].servings, 1.5);
  for (const value of [
    ...sentinels,
    "OLD-SESSION",
    "99999",
    "Squat",
    "ingredients",
    "marketing",
  ])
    assert.equal(response.body.includes(value), false, value);
  await processingConsent("nutrition", false);
  data = (await req("/" + g.id)).json();
  assert.equal(data.projection.nutritionSchedule.state, "permission_required");
  assert.deepEqual(data.projection.nutritionSchedule.meals, []);
  assert.equal(data.projection.trainingSchedule.sessions.length, 1);
});

test("notification corrections require an explicit scope and an exact safe action and never edit on preparation", async () => {
  let g = await start({ scopes: ["account"] });
  assert.equal(
    (await req("/" + g.id + "/elevations", "POST", correctionBody(g, 0)))
      .statusCode,
    403,
  );
  g = await start({ scopes: ["notification_settings"] });
  for (const changes of [
    { email: false },
    { marketing: true },
    { push: true },
    { payment: "refund" },
    { consents: {} },
    { health: {} },
    {},
    { quietStart: 1440 },
    { timezone: "Not/AZone" },
  ])
    assert.equal(
      (
        await req(
          "/" + g.id + "/elevations",
          "POST",
          correctionBody(g, 0, { changes }),
        )
      ).statusCode,
      400,
    );
  for (const extra of [
    { action: "training_schedule" },
    { reason: "short" },
    { targetUserId: foreign.userId },
    { minutes: 60 },
  ])
    assert.equal(
      (
        await req(
          "/" + g.id + "/elevations",
          "POST",
          correctionBody(g, 0, extra),
        )
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await req(
        "/" + g.id + "/elevations",
        "POST",
        correctionBody(g, 0, { revision: 999 }),
      )
    ).statusCode,
    409,
  );
  const e = await prepare(g);
  assert.ok(Date.parse(e.expiresAt) - Date.parse(e.createdAt) <= 5 * 60000);
  assert.ok(Date.parse(e.expiresAt) <= Date.parse(g.expiresAt));
  assert.equal(await settings(), undefined);
  assert.equal((await req("/" + g.id)).json().elevation.id, e.id);
  await assert.rejects(
    db.system((tx) =>
      tx.query(
        "UPDATE support_preview_elevations SET changes='{}' WHERE id=$1",
        [e.id],
      ),
    ),
    /immutable/,
  );
  await assert.rejects(
    db.system((tx) =>
      tx.query(
        "UPDATE support_preview_elevations SET expires_at=expires_at+interval '1 minute' WHERE id=$1",
        [e.id],
      ),
    ),
    /immutable/,
  );
  await assert.rejects(
    db.tenant(client, (tx) =>
      tx.query("SELECT * FROM support_preview_elevations"),
    ),
    /permission denied/,
  );
  assert.equal((await apply(g, e)).statusCode, 200);
  assert.deepEqual(await settings(), {
    version: 1,
    data: { timezone: "Europe/London" },
  });
});

test("correction intents and writes are idempotent, preserve unrelated preferences and audit the real operator once", async () => {
  await customerSettings({
    email: false,
    marketing: true,
    bookings: true,
    workouts: true,
    timezone: "Asia/Dubai",
  });
  const initial = await settings(),
    g = await start({ scopes: ["notification_settings"] });
  const b = correctionBody(g, initial.version, {
    changes: { workouts: false, quietStart: 1260, quietEnd: 420 },
  });
  const prepared = await Promise.all([
    req("/" + g.id + "/elevations", "POST", b),
    req("/" + g.id + "/elevations", "POST", b),
  ]);
  for (const r of prepared) assert.equal(r.statusCode, 200, r.body);
  const e = prepared[0].json().elevation;
  assert.equal(prepared[1].json().elevation.id, e.id);
  assert.equal(
    (
      await req("/" + g.id + "/elevations", "POST", {
        ...b,
        changes: { bookings: false },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await req("/" + g.id + "/elevations/" + e.id + "/apply", "POST", {
        revision: e.revision,
        changes: { bookings: false },
      })
    ).statusCode,
    400,
  );
  assert.equal((await apply(g, { ...e, revision: 999 })).statusCode, 409);
  for (const r of await Promise.all([apply(g, e), apply(g, e)]))
    assert.equal(r.statusCode, 200, r.body);
  const saved = await settings();
  assert.equal(saved.version, initial.version + 1);
  assert.deepEqual(saved.data, { ...initial.data, ...b.changes });
  await customerSettings({ workouts: true });
  assert.equal((await apply(g, e)).statusCode, 200);
  assert.equal((await settings()).data.workouts, true);
  assert.equal((await settings()).version, saved.version + 1);
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT actor_id,subject_id,data,action FROM admin_operations_audit WHERE data->>'elevationId'=$1",
      [e.id],
    ),
  );
  assert.equal(
    rows.filter((r) => r.action === "support.preview.correction_prepared")
      .length,
    1,
  );
  assert.equal(
    rows.filter((r) => r.action === "support.preview.correction_applied")
      .length,
    1,
  );
  for (const r of rows) {
    assert.equal(r.actor_id, operator.userId);
    assert.equal(r.subject_id, client.userId);
    assert.equal(r.data.grantId, g.id);
  }
  assert.equal(
    JSON.stringify(rows).includes("Customer requested"),
    false,
    "Audit references the immutable reason without copying its prose",
  );
});

test("a customer save cancels stale correction approval instead of overwriting their settings", async () => {
  const g = await start({ scopes: ["notification_settings"] }),
    e = await prepare(g, { changes: { timezone: "Europe/Paris" } });
  await customerSettings({ timezone: "America/New_York" });
  const before = await settings(),
    r = await apply(g, e);
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "PREFERENCES_CHANGED");
  assert.deepEqual(await settings(), before);
  assert.equal((await apply(g, e)).statusCode, 410);
  assert.equal((await req("/" + g.id)).json().elevation, null);
});

test("correction execution rechecks the real session, MFA, operator, member, case and workspace", async () => {
  const mutations: [
    string,
    number,
    () => Promise<unknown>,
    () => Promise<unknown>,
  ][] = [
    [
      "MFA",
      403,
      () =>
        db.system((tx) =>
          tx.query(
            "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE token_hash=$1",
            [tokenHash(session)],
          ),
        ),
      () =>
        db.system((tx) =>
          tx.query("UPDATE sessions SET mfa_at=now() WHERE token_hash=$1", [
            tokenHash(session),
          ]),
        ),
    ],
    [
      "role",
      403,
      () =>
        db.system((tx) =>
          tx.query("UPDATE users SET platform_role='none' WHERE id=$1", [
            operator.userId,
          ]),
        ),
      () =>
        db.system((tx) =>
          tx.query("UPDATE users SET platform_role='support' WHERE id=$1", [
            operator.userId,
          ]),
        ),
    ],
    [
      "session",
      401,
      () =>
        db.system((tx) =>
          tx.query(
            "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
            [tokenHash(session)],
          ),
        ),
      () =>
        db.system((tx) =>
          tx.query(
            "UPDATE sessions SET expires_at=now()+interval '1 day' WHERE token_hash=$1",
            [tokenHash(session)],
          ),
        ),
    ],
    [
      "membership",
      410,
      () =>
        db.system((tx) =>
          tx.query(
            "UPDATE memberships SET version=version+1 WHERE tenant_id=$1 AND user_id=$2",
            [client.tenantId, client.userId],
          ),
        ),
      async () => {},
    ],
    ["case", 410, () => caseState("resolved"), () => caseState("open")],
    [
      "workspace",
      410,
      () =>
        db.system((tx) =>
          tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
            client.tenantId,
          ]),
        ),
      () =>
        db.system((tx) =>
          tx.query("UPDATE tenants SET lifecycle_state='active' WHERE id=$1", [
            client.tenantId,
          ]),
        ),
    ],
  ];
  for (const [name, code, change, restore] of mutations) {
    const g = await start({ scopes: ["notification_settings"] }),
      e = await prepare(g),
      before = await settings();
    assert.equal(
      (await apply(g, e, { cookie: "session=" + alternateSession })).statusCode,
      404,
    );
    assert.equal(
      (
        await apply(g, e, {
          cookie: "session=" + secondSession,
          "x-second": "true",
        })
      ).statusCode,
      404,
    );
    await change();
    try {
      assert.equal((await apply(g, e)).statusCode, code, name);
      assert.deepEqual(await settings(), before);
    } finally {
      await restore();
    }
  }
});

test("correction approval ends on discard, replacement, preview stop or deadline without a write", async () => {
  const before = await settings();
  let g = await start({ scopes: ["notification_settings"] }),
    e = await prepare(g);
  const replacement = await prepare(g, {
    changes: { timezone: "Europe/Paris" },
  });
  assert.equal((await apply(g, e)).statusCode, 410);
  const cancelPath = "/" + g.id + "/elevations/" + replacement.id + "/end";
  assert.equal(
    (await req(cancelPath, "POST", { revision: 999 })).statusCode,
    409,
  );
  assert.equal(
    (await req(cancelPath, "POST", { revision: replacement.revision }))
      .statusCode,
    200,
  );
  assert.equal(
    (await req(cancelPath, "POST", { revision: replacement.revision }))
      .statusCode,
    200,
  );
  assert.equal((await apply(g, replacement)).statusCode, 410);
  e = await prepare(g);
  assert.equal(
    (await req("/" + g.id + "/end", "POST", { revision: g.revision }))
      .statusCode,
    200,
  );
  assert.equal((await apply(g, e)).statusCode, 410);
  g = await start({ scopes: ["notification_settings"], minutes: 1 });
  e = await prepare(g);
  assert.ok(Date.parse(e.expiresAt) <= Date.parse(g.expiresAt));
  await req("/" + g.id + "/elevations/" + e.id + "/end", "POST", {
    revision: e.revision,
  });
  const expiredId = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO support_preview_elevations(id,grant_id,request_key,fingerprint,action,reason,expected_version,changes,created_at,expires_at) SELECT $2,grant_id,$3,fingerprint,action,reason,expected_version,changes,now()-interval '6 minutes',now()-interval '2 minutes' FROM support_preview_elevations WHERE id=$1",
      [e.id, expiredId, randomUUID()],
    ),
  );
  assert.equal((await apply(g, { ...e, id: expiredId })).statusCode, 410);
  assert.equal((await apply(g, { ...e, id: expiredId })).statusCode, 410);
  const [expired] = await db.system((tx) =>
    tx.query(
      "SELECT status,(SELECT count(*)::int FROM admin_operations_audit WHERE action='support.preview.correction_expired' AND data->>'elevationId'=$1) AS audits FROM support_preview_elevations WHERE id=$1::uuid",
      [expiredId],
    ),
  );
  assert.equal(expired.status, "expired");
  assert.equal(expired.audits, 1);
  assert.deepEqual(await settings(), before);
});
