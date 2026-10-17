import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { seedScope } from "./scope-fixtures.ts";
import {
  WHOOP_TRAINING_VERSION,
  whoopDate,
} from "../packages/domain/src/whoop-training.ts";
import {
  scriptIssues,
  planExercises,
} from "../packages/domain/src/voice-session.ts";

const config = {
  WHOOP_CONTRACT_VERIFIED: "true",
  WHOOP_TRAINING_APPROVED: "true",
  WHOOP_CLIENT_ID: "whoop-fixture",
  WHOOP_CLIENT_SECRET: "fixture-only",
  WHOOP_REDIRECT_URI:
    "https://coaching.example.com/api/v1/integrations/whoop/callback",
  WHOOP_SCOPES: "offline read:recovery read:sleep",
};
const original = Object.fromEntries(
  Object.keys(config).map((k) => [k, process.env[k]]),
);
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  coach: any,
  other: any,
  client: any,
  program: any;
const prescription = {
  title: "WHOOP fixture",
  goal: "Controlled strength",
  daysPerWeek: 3,
  exercises: [
    { name: "Squat", sets: 3, reps: 10, loadKg: 40, restSeconds: 90, rir: 2 },
    { name: "Plank", sets: 2, durationSeconds: 60, restSeconds: 30 },
  ],
};
async function request(
  path: string,
  method: any = "GET",
  payload?: any,
  as = client,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    payload,
    headers: {
      origin: "http://localhost:3000",
      ...(as ? { cookie: as.cookie } : {}),
    },
  });
}
async function ok(
  path: string,
  method: any = "GET",
  payload?: any,
  as = client,
) {
  const r = await request(path, method, payload, as);
  assert.ok(r.statusCode < 400, r.body);
  return r.json();
}
async function register(slug: string) {
  const r = await request(
    "/auth/register",
    "POST",
    {
      name: slug,
      email: slug + "@example.test",
      password: "WhoopFixture2026!",
      slug,
      accepted: true,
    },
    null,
  );
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return {
    ...(await ok("/bootstrap", "GET", undefined, { cookie })).user,
    cookie,
  };
}
async function seedReading(score = 25, extra: Record<string, unknown> = {}) {
  return db.tenant(seedScope(coach), async (tx) => {
    await tx.query(
      "DELETE FROM records WHERE kind='wearable' AND owner_user_id=$1",
      [client.userId],
    );
    return putRecord(
      tx,
      { ...coach, userId: client.userId },
      "wearable",
      {
        source: "whoop",
        providerKey: "fixture-recovery",
        allowedUses: ["render", "deterministic_feature"],
        restrictions: ["no_model_prompt"],
        observations: [
          {
            id: "recovery:123:recovery_score",
            type: "recovery_score",
            value: score,
            unit: "percent",
            measuredAt: new Date(Date.now() - 1000).toISOString(),
            sleepId: "fixture-sleep",
            trainingReady: true,
            calibrating: false,
            ...extra,
          },
        ],
      },
      { status: "imported" },
    );
  });
}
async function enableRules(enabled = true, as = coach) {
  const policy = await ok("/brain/whoop-training", "GET", undefined, as);
  return ok(
    "/brain/whoop-training",
    "PUT",
    { version: policy.version, values: { ...policy.values, enabled } },
    as,
  );
}
async function optIn(enabled = true) {
  const state = await ok("/integrations/whoop/training");
  return ok("/integrations/whoop/training", "PUT", {
    enabled,
    version: state.preferenceVersion,
    consentVersion: WHOOP_TRAINING_VERSION,
  });
}
async function start(plannedSessionId?: string) {
  return ok("/workouts/start", "POST", {
    programId: program.id,
    ...(plannedSessionId ? { plannedSessionId } : {}),
  });
}
async function clearWorkout() {
  await db.tenant(seedScope(coach), (tx) =>
    tx.query(
      "UPDATE records SET status='abandoned' WHERE kind='workout' AND owner_user_id=$1",
      [client.userId],
    ),
  );
}

before(async () => {
  Object.assign(process.env, config);
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  coach = await register("whoop-coach");
  other = await register("whoop-other");
  const invite = await ok(
    "/invitations",
    "POST",
    { email: "whoop-member@example.test", role: "subscriber" },
    coach,
  );
  const joined = await request(
    "/invitations/accept",
    "POST",
    {
      token: invite.url.split("/").pop(),
      name: "WHOOP Member",
      email: "whoop-member@example.test",
      password: "WhoopFixture2026!",
      accepted: true,
    },
    null,
  );
  assert.equal(joined.statusCode, 200, joined.body);
  const cookie = String(joined.headers["set-cookie"]).split(";")[0];
  client = {
    ...(await ok("/bootstrap", "GET", undefined, { cookie })).user,
    cookie,
  };
  await db.tenant(seedScope(coach), async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor) VALUES($1,$2,$3,'active',now()+interval '30 days',10000)",
      [randomUUID(), coach.tenantId, client.userId],
    );
    await tx.query(
      "INSERT INTO integration_connections(id,tenant_id,user_id,provider,status,credentials,last_synced_at,scopes) VALUES($1,$2,$3,'whoop','active','fixture-unused',now(),$4)",
      [
        randomUUID(),
        coach.tenantId,
        client.userId,
        config.WHOOP_SCOPES.split(" "),
      ],
    );
  });
  program = await ok(
    "/programs",
    "POST",
    { subscriberId: client.userId, program: prescription },
    coach,
  );
});
beforeEach(async () => {
  Object.assign(process.env, config);
  await clearWorkout();
  await db.tenant(seedScope(coach), async (tx) => {
    await tx.query(
      "DELETE FROM records WHERE kind='whoop_training_policy' OR (kind='preferences' AND owner_user_id=$1 AND data->>'key'='whoop_training') OR (kind='training_hold' AND owner_user_id=$1)",
      [client.userId],
    );
    await tx.query(
      "UPDATE integration_connections SET status='active',last_synced_at=now() WHERE user_id=$1 AND provider='whoop'",
      [client.userId],
    );
    await tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'wearable:whoop','fixture',true)",
      [randomUUID(), coach.tenantId, client.userId],
    );
  });
  await seedReading();
});
after(async () => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await app?.close();
  await db?.close();
});

test("WHOOP requires trainer rules plus separate current member consent", async () => {
  assert.equal((await ok("/integrations/whoop/training")).available, true);
  await enableRules();
  let w = await start();
  assert.equal(w.data.recoveryAdjustment, undefined);
  assert.deepEqual(w.data.program, program.data);
  await clearWorkout();
  const state = await optIn();
  assert.equal(state.reason, "ready");
  w = await start();
  assert.equal(w.data.program.exercises[0].loadKg, 36);
  assert.equal(w.data.program.exercises[0].reps, 8);
  assert.equal(w.data.program.exercises[1].durationSeconds, 45);
  assert.deepEqual(w.data.originalProgram, program.data);
  assert.equal(w.data.recoveryAdjustment.policyVersion, state.policy.version);
  assert.equal(
    w.data.recoveryAdjustment.consentVersion,
    WHOOP_TRAINING_VERSION,
  );
  assert.equal(
    JSON.stringify(w.data.recoveryAdjustment).includes('"score"'),
    false,
  );
  const saved = await db.tenant(client, (tx) =>
    tx.query("SELECT data FROM records WHERE id=$1", [program.id]),
  );
  assert.deepEqual(saved[0].data, program.data);
  const events = await db.tenant(seedScope(coach), (tx) =>
    tx.query(
      "SELECT id FROM events WHERE name='workout.recovery_adjusted' AND subject_id=$1",
      [w.id],
    ),
  );
  assert.equal(events.length, 1);
});
test("duplicate starts freeze the chosen prescription despite new recovery or permission changes", async () => {
  await enableRules();
  await optIn();
  const first = await start();
  await seedReading(90);
  await optIn(false);
  const retry = await start();
  assert.equal(retry.id, first.id);
  assert.deepEqual(retry.data.program, first.data.program);
  await clearWorkout();
  assert.equal((await start()).data.recoveryAdjustment, undefined);
});
test("moderate recovery has the configured volume reduction; high recovery never adds work", async () => {
  await enableRules();
  await optIn();
  await seedReading(50);
  let w = await start();
  assert.equal(w.data.program.exercises[0].loadKg, 40);
  assert.equal(w.data.program.exercises[0].reps, 9);
  await clearWorkout();
  await seedReading(90);
  w = await start();
  assert.equal(w.data.recoveryAdjustment, undefined);
  assert.deepEqual(w.data.program, program.data);
});
test("stale, future, calibrating and unlinked readings leave workouts unchanged", async () => {
  await enableRules();
  await optIn();
  for (const extra of [
    { measuredAt: new Date(Date.now() - 30 * 3600000).toISOString() },
    { measuredAt: new Date(Date.now() + 3600000).toISOString() },
    { calibrating: true },
    { trainingReady: false },
  ]) {
    await seedReading(25, extra);
    const w = await start();
    assert.equal(w.data.recoveryAdjustment, undefined);
    await clearWorkout();
  }
  await seedReading();
  await db.tenant(seedScope(coach), (tx) =>
    tx.query(
      "UPDATE integration_connections SET last_synced_at=now()-interval '3 hours' WHERE user_id=$1",
      [client.userId],
    ),
  );
  assert.equal((await ok("/integrations/whoop/training")).reason, "stale");
  assert.equal((await start()).data.recoveryAdjustment, undefined);
});
test("policy and consent writes reject stale revisions, extra fields and other roles", async () => {
  const p = await enableRules();
  assert.equal((await request("/brain/whoop-training", "GET")).statusCode, 403);
  assert.equal(
    (
      await request(
        "/brain/whoop-training",
        "PUT",
        { version: 0, values: p.values },
        coach,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request(
        "/brain/whoop-training",
        "PUT",
        {
          version: p.version,
          values: { ...p.values, low: { loadPercent: 50, volumePercent: 20 } },
        },
        coach,
      )
    ).statusCode,
    400,
  );
  await optIn();
  assert.equal(
    (
      await request("/integrations/whoop/training", "PUT", {
        enabled: false,
        version: 0,
        consentVersion: WHOOP_TRAINING_VERSION,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await request("/integrations/whoop/training", "PUT", {
        enabled: true,
        version: 1,
        consentVersion: "unreviewed",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await request("/integrations/whoop/training", "PUT", {
        enabled: true,
        version: 1,
        consentVersion: WHOOP_TRAINING_VERSION,
        userId: coach.userId,
      })
    ).statusCode,
    400,
  );
});
test("trainer policies and recovery are isolated between workspaces and members", async () => {
  await enableRules();
  await optIn();
  const foreign = await ok("/brain/whoop-training", "GET", undefined, other);
  assert.equal(foreign.version, 0);
  assert.equal(foreign.values.enabled, false);
  const trainerState = await ok(
    "/integrations/whoop/training",
    "GET",
    undefined,
    coach,
  );
  assert.equal(trainerState.hasConnection, false);
  assert.equal(trainerState.recovery.score, null);
  const foreignState = await ok(
    "/integrations/whoop/training",
    "GET",
    undefined,
    other,
  );
  assert.equal(foreignState.recovery.score, null);
  assert.equal(
    (await request("/workouts/start", "POST", { programId: program.id }, other))
      .statusCode,
    404,
  );
});
test("platform and trainer switches, disconnected devices and safety holds override recovery", async () => {
  await enableRules();
  await optIn();
  process.env.WHOOP_TRAINING_APPROVED = "false";
  assert.equal((await start()).data.recoveryAdjustment, undefined);
  await clearWorkout();
  process.env.WHOOP_TRAINING_APPROVED = "true";
  await enableRules(false);
  assert.equal((await start()).data.recoveryAdjustment, undefined);
  await clearWorkout();
  await enableRules();
  await db.tenant(seedScope(coach), (tx) =>
    tx.query(
      "UPDATE integration_connections SET status='revoked' WHERE user_id=$1",
      [client.userId],
    ),
  );
  assert.equal((await start()).data.recoveryAdjustment, undefined);
  await clearWorkout();
  await db.tenant(seedScope(coach), (tx) =>
    putRecord(
      tx,
      { ...coach, userId: client.userId },
      "training_hold",
      { reason: "Trainer review" },
      { status: "active" },
    ),
  );
  assert.equal(
    (await request("/workouts/start", "POST", { programId: program.id }))
      .statusCode,
    409,
  );
});
test("revoked WHOOP consent blocks training use even when the connection still looks active", async () => {
  await enableRules();
  await optIn();
  await db.tenant(seedScope(coach), (tx) =>
    tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'wearable:whoop','fixture',false)",
      [randomUUID(), coach.tenantId, client.userId],
    ),
  );
  assert.equal((await ok("/integrations/whoop/training")).connected, false);
  assert.equal((await start()).data.recoveryAdjustment, undefined);
});
test("a prepared guided session is rebuilt from the frozen adjusted workout", async () => {
  await enableRules();
  await optIn();
  const planned = await db.tenant(seedScope(coach), (tx) =>
    putRecord(
      tx,
      { ...coach, userId: client.userId },
      "planned_session",
      {
        programId: program.id,
        program: program.data,
        date: whoopDate(new Date(), "UTC"),
        timezone: "UTC",
        label: "Today",
      },
      { status: "planned" },
    ),
  );
  const old = await ok("/voice-sessions", "POST", {
    plannedSessionId: planned.id,
  });
  assert.equal(old.script.exercises[0].reps, 10);
  const workout = await start(planned.id);
  assert.equal(
    (await ok(`/voice-sessions/workout/${workout.id}`)).recoveryAdjustment
      .version,
    WHOOP_TRAINING_VERSION,
  );
  const stale = await ok(`/voice-sessions/${old.id}`);
  assert.equal(stale.runnable, false);
  const current = await ok("/voice-sessions", "POST", {
    workoutId: workout.id,
  });
  assert.equal(
    scriptIssues(current.script, planExercises(workout.data.program)).length,
    0,
  );
  assert.equal(current.recoveryAdjustment.version, WHOOP_TRAINING_VERSION);
  assert.equal(current.script.exercises[0].reps, 8);
  assert.equal(current.script.exercises[0].loadKg, 36);
  assert.equal(
    JSON.stringify(current.script).includes("recovery_score"),
    false,
  );
});

test("planned dates and the trainer's no-wearables policy remain authoritative", async () => {
  await enableRules();
  await optIn();
  const planned = await db.tenant(seedScope(coach), (tx) =>
    putRecord(
      tx,
      { ...coach, userId: client.userId },
      "planned_session",
      {
        programId: program.id,
        program: program.data,
        date: "2099-01-01",
        timezone: "UTC",
      },
      { status: "planned" },
    ),
  );
  assert.equal((await start(planned.id)).data.recoveryAdjustment, undefined);
  await clearWorkout();
  const restriction = await db.tenant(coach, (tx) =>
    putRecord(
      tx,
      coach,
      "onboarding_step",
      { step: "wearables", values: { policy: "none" } },
      { status: "saved" },
    ),
  );
  try {
    assert.equal((await ok("/integrations/whoop/training")).reason, "trainer");
    assert.equal((await start()).data.recoveryAdjustment, undefined);
  } finally {
    await db.tenant(coach, (tx) =>
      tx.query("DELETE FROM records WHERE id=$1", [restriction.id]),
    );
  }
});

test("weekly outcomes assess the actual reduced prescription without including WHOOP readings", async () => {
  const { weekOutcomes } = await import("../apps/api/src/brain-plans.ts");
  await enableRules();
  await optIn();
  const today = whoopDate(new Date(), "UTC");
  const planned = await db.tenant(seedScope(coach), (tx) =>
    putRecord(
      tx,
      { ...coach, userId: client.userId },
      "planned_session",
      {
        programId: program.id,
        program: program.data,
        date: today,
        timezone: "UTC",
      },
      { status: "planned" },
    ),
  );
  await start(planned.id);
  const outcomes = await db.tenant(client, async (tx) => {
    const current = await tx.query("SELECT * FROM records WHERE id=$1", [
      planned.id,
    ]);
    return weekOutcomes(tx, client.userId, current, today);
  });
  assert.equal(outcomes.exercises[0].prescribed.loadKg, 36);
  assert.equal(outcomes.exercises[0].prescribed.reps, 8);
  assert.equal(outcomes.exercises[1].prescribed.durationSeconds, 45);
  assert.doesNotMatch(
    JSON.stringify(outcomes),
    /whoop|recovery_score|sourceId|sleepId/i,
  );
});

test("privacy withdrawal clears the separate adaptation permission before any reconnect", async () => {
  await enableRules();
  await optIn();
  const { disableUserIntegrations } =
    await import("../apps/api/src/integrations-completion.ts");
  await db.tenant(client, (tx) =>
    disableUserIntegrations(tx, client.userId, "wearable"),
  );
  const state = await ok("/integrations/whoop/training");
  assert.equal(state.optedIn, false);
  assert.equal(state.connected, false);
});
