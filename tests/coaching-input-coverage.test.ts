import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, type Database, type Actor } from "@trainer/db";
import { compileTrainerRules, withRuntimeConfig } from "@trainer/providers";
import { currentClientTwin } from "../apps/api/src/client-twin.ts";
import { assertTrainingOpen } from "../apps/api/src/coaching-completion.ts";
import { compilationMaterial } from "../apps/api/src/ingestion.ts";

let db: Database;
const owner: Actor = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  role: "owner",
};
const foreign: Actor = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  role: "owner",
};
const DAY = 86400000;
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const actor of [owner, foreign]) {
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Coverage fixture','unused')",
        [actor.userId, actor.userId + "@example.test"],
      );
      await tx.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Coverage fixture')",
        [actor.tenantId, actor.tenantId],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
        [actor.tenantId, actor.userId],
      );
    }
  });
});
after(async () => db.close());
async function subscriber() {
  const actor = { ...owner, userId: randomUUID(), role: "subscriber" };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Coverage client','unused')",
      [actor.userId, actor.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [actor.tenantId, actor.userId],
    );
  });
  return actor;
}
async function record(
  actor: Actor,
  userId: string,
  kind: string,
  status: string,
  data: unknown,
  daysAgo = 0,
) {
  const id = randomUUID(),
    at = new Date(Date.now() - daysAgo * DAY);
  await db.tenant(actor, (tx) =>
    tx.query(
      "INSERT INTO records(id,tenant_id,owner_user_id,kind,status,data,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)",
      [id, actor.tenantId, userId, kind, status, JSON.stringify(data), at],
    ),
  );
  return id;
}

test("current Twin keeps older current intake, active holds and corrected sets after more than 1000 newer history rows", async () => {
  const client = await subscriber();
  await record(
    owner,
    client.userId,
    "intake",
    "complete",
    { age: 20, goal: "Old profile" },
    120,
  );
  const intakeId = await record(
    owner,
    client.userId,
    "intake",
    "complete",
    {
      age: 35,
      goal: "Keep a consistent routine",
      limitations: "Reported shoulder restriction",
      daysPerWeek: 3,
    },
    40,
  );
  const holdId = await record(
    owner,
    client.userId,
    "training_hold",
    "active",
    { reason: "Reported symptom awaiting review" },
    35,
  );
  const heldWorkoutId = await record(
    owner,
    client.userId,
    "workout",
    "safety_hold",
    {},
    34,
  );
  const resolvedId = await record(
    owner,
    client.userId,
    "training_hold",
    "resolved",
    {},
    1,
  );
  const wearableId = await record(
    owner,
    client.userId,
    "wearable",
    "imported",
    {
      source: "apple_health",
      allowedUses: ["render", "deterministic_feature"],
      observations: [
        {
          type: "resting_heart_rate",
          value: 62,
          unit: "bpm",
          measuredAt: new Date(Date.now() - DAY).toISOString(),
        },
      ],
    },
    3,
  );
  const eventId = randomUUID();
  await db.tenant(owner, async (tx) => {
    await tx.query(
      "INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data,created_at) VALUES($1::uuid,$2,$3,$4,$1::uuid::text,$5,now()-interval '2 days')",
      [
        eventId,
        owner.tenantId,
        client.userId,
        heldWorkoutId,
        JSON.stringify({ exercise: "Squat", reps: 5, loadKg: 20 }),
      ],
    );
    await tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','fixture',true)",
      [randomUUID(), owner.tenantId, client.userId],
    );
  });
  await record(
    owner,
    client.userId,
    "workout_correction",
    "recorded",
    { eventId, revision: 1, values: { reps: 8, loadKg: 20 } },
    1.8,
  );
  const correctionId = await record(
    owner,
    client.userId,
    "workout_correction",
    "recorded",
    { eventId, revision: 2, values: { reps: 10, loadKg: 25 } },
    1.7,
  );
  await db.tenant(owner, (tx) =>
    tx.query(
      "INSERT INTO records(id,tenant_id,owner_user_id,kind,status,data,created_at) SELECT id,$1,$2,'workout','completed','{}'::jsonb,now()-interval '1 day'+n*interval '1 second' FROM unnest($3::uuid[]) WITH ORDINALITY AS source(id,n)",
      [
        owner.tenantId,
        client.userId,
        Array.from({ length: 1002 }, () => randomUUID()),
      ],
    ),
  );
  const foreignIntakeId = await record(
    foreign,
    client.userId,
    "intake",
    "complete",
    { age: 99, limitations: "FOREIGN_PRIVATE_PROFILE" },
  );
  const foreignHoldId = await record(
    foreign,
    client.userId,
    "training_hold",
    "active",
    { reason: "FOREIGN_PRIVATE_HOLD" },
  );
  const first = await db.tenant(client, (tx) =>
    currentClientTwin(tx, client, client.userId),
  );
  const age = first.data.coaching.profile.find((p: any) => p.key === "age");
  assert.equal(age.value, 35);
  assert.equal(age.state, "provided");
  assert.deepEqual(age.sourceRecordIds, [intakeId]);
  assert.deepEqual(
    new Set(first.data.coaching.safetyHolds),
    new Set([holdId, heldWorkoutId]),
  );
  assert.equal(first.data.coaching.safetyHolds.includes(resolvedId), false);
  assert.deepEqual(
    new Set(
      first.data.coaching.safetyHoldSources.flatMap(
        (s: any) => s.sourceRecordIds,
      ),
    ),
    new Set([holdId, heldWorkoutId]),
  );
  assert.equal(first.data.inputCoverage.activeHolds.complete, true);
  assert.equal(first.data.inputCoverage.workouts.included, 1000);
  assert.equal(first.data.inputCoverage.workouts.partial, true);
  assert.equal(first.data.partialInput, true);
  const performance = first.data.coaching.training.performance[0];
  assert.equal(performance.volumeKg, 250);
  assert.deepEqual(performance.sourceCorrectionIds, [correctionId]);
  assert.deepEqual(
    first.data.wearables.metrics.find(
      (m: any) => m.key === "resting_heart_rate",
    ).sourceRecordIds,
    [wearableId],
  );
  for (const forbidden of [
    foreignIntakeId,
    foreignHoldId,
    "FOREIGN_PRIVATE",
    "apple_health",
  ])
    assert.equal(
      JSON.stringify(first.data.coaching).includes(forbidden),
      false,
    );
  const same = await db.tenant(owner, (tx) =>
    currentClientTwin(tx, owner, client.userId),
  );
  assert.equal(same.id, first.id);
  await assert.rejects(
    db.tenant(owner, (tx) => assertTrainingOpen(tx, client.userId)),
    /training is paused/,
  );
  await db.tenant(owner, (tx) =>
    tx.query(
      "UPDATE records SET status=CASE WHEN kind='training_hold' THEN 'resolved' ELSE 'abandoned' END,updated_at=now() WHERE id=ANY($1::uuid[])",
      [[holdId, heldWorkoutId]],
    ),
  );
  const cleared = await db.tenant(owner, (tx) =>
    currentClientTwin(tx, owner, client.userId),
  );
  assert.notEqual(cleared.id, first.id);
  assert.deepEqual(cleared.data.coaching.safetyHolds, []);
  await db.tenant(owner, (tx) => assertTrainingOpen(tx, client.userId));
});

test("bounded Twin histories disclose overflow and retain the newest 5000 sets", async () => {
  const client = await subscriber(),
    ids = Array.from({ length: 5001 }, () => randomUUID());
  await db.tenant(owner, (tx) =>
    tx.query(
      "INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data,created_at) SELECT id,$1,$2,$3,id::text,jsonb_build_object('exercise','Row','reps',n,'loadKg',1),now()-interval '2 days'+n*interval '1 second' FROM unnest($4::uuid[]) WITH ORDINALITY AS source(id,n)",
      [owner.tenantId, client.userId, randomUUID(), ids],
    ),
  );
  const twin = await db.tenant(owner, (tx) =>
    currentClientTwin(tx, owner, client.userId),
  );
  assert.equal(twin.data.inputCoverage.sets.partial, true);
  assert.equal(twin.data.coaching.training.loggedSets, 5000);
  assert.equal(
    twin.data.coaching.training.performance[0].sourceEventIds.includes(ids[0]),
    false,
  );
  assert.equal(
    twin.data.coaching.training.performance[0].sourceEventIds.includes(
      ids.at(-1),
    ),
    true,
  );
  assert.equal(twin.data.inputCoverage.workouts.partial, false);
});

function teaching(text: string) {
  return {
    id: randomUUID(),
    kind: "source",
    status: "ready",
    version: 7,
    data: {
      title: "Reviewed fixture",
      text,
      allowedUses: ["model_prompt", "trainer_specific_learning"],
    },
  };
}
const modelConfig = {
  MODEL_BASE_URL: "https://coverage.fixture.invalid/v1",
  MODEL_API_KEY: "fixture-only",
  MODEL_NAME: "fixture-model",
};
test("compilation transmits trailing instructions and all 120000 reviewed characters with exact coverage", async () => {
  const tails = [
    "Never progress a painful movement; request review.",
    "Schedule a recovery day after the third consecutive training day.",
  ];
  const records = tails.map((tail) =>
    teaching(
      "Reviewed training context. ".repeat(2300).slice(0, 60000 - tail.length) +
        tail,
    ),
  );
  assert.equal(records[0].data.text.length, 60000);
  const material = compilationMaterial(records),
    events: string[] = [];
  const accounting = {
    reserve: async () => {
      events.push("reserve");
    },
    record: async () => {
      events.push("record");
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    events.push("send");
    const sent = JSON.parse(
      JSON.parse(String(options?.body)).messages[1].content,
    );
    assert.equal(sent.length, 2);
    for (const [i, source] of sent.entries()) {
      assert.equal(source.text, records[i].data.text);
      assert.equal(source.text.endsWith(tails[i]), true);
    }
    return Response.json({
      id: "fixture-compile",
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [
        { message: { content: JSON.stringify({ rules: [], conflicts: [] }) } },
      ],
    });
  };
  try {
    const compiled = await withRuntimeConfig(modelConfig, () =>
      compileTrainerRules(material, accounting),
    );
    assert.equal(compiled.coverage.completeInput, true);
    assert.equal(compiled.coverage.sourceCharacters, 120000);
    assert.equal(compiled.coverage.includedCharacters, 120000);
    for (const [i, source] of compiled.coverage.sources.entries()) {
      assert.equal(source.sourceId, records[i].id);
      assert.equal(source.sourceVersion, 7);
      assert.equal(source.includedCharacters, 60000);
      assert.equal(
        source.contentHash,
        createHash("sha256").update(records[i].data.text).digest("hex"),
      );
    }
    assert.deepEqual(events, ["reserve", "send", "record"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("compiler rejects oversize and unpermitted selections before reserving or sending, never truncating", async () => {
  let reserved = 0,
    sent = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    sent++;
    throw new Error("Invalid input must not reach a provider");
  };
  const accounting = {
    reserve: async () => {
      reserved++;
    },
    record: async () => {},
  };
  const prepared = (text: string) => ({
    ...teaching(text),
    data: { ...teaching(text).data, sourceVersion: 1 },
  });
  try {
    await withRuntimeConfig(modelConfig, async () => {
      await assert.rejects(
        compileTrainerRules([prepared("x".repeat(60001))], accounting),
        /60,000/,
      );
      await assert.rejects(
        compileTrainerRules(
          Array.from({ length: 3 }, () => prepared("x".repeat(50000))),
          accounting,
        ),
        /120,000/,
      );
      await assert.rejects(
        compileTrainerRules(
          Array.from({ length: 21 }, () => prepared("Short reviewed material")),
          accounting,
        ),
        /twenty/,
      );
      const denied = prepared("Private instructions");
      denied.data.allowedUses = ["render"];
      await assert.rejects(
        compileTrainerRules([denied], accounting),
        /not permitted for model/,
      );
      denied.data.allowedUses = ["model_prompt"];
      await assert.rejects(
        compileTrainerRules([denied], accounting),
        /trainer-specific learning/,
      );
    });
    assert.equal(reserved, 0);
    assert.equal(sent, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("assembled compilation returns and persists exact coverage while sending complete reviewed source tails", async () => {
  const { buildApp } = await import("../apps/api/src/app.ts");
  const { tokenHash } = await import("../apps/api/src/auth.ts");
  const tails = [
    "Stop progression when movement causes pain and request trainer review.",
    "Schedule a recovery day after three consecutive training days.",
  ];
  const sources: Array<{ id: string; text: string }> = [];
  for (const tail of tails) {
    const text =
      "Reviewed source context. ".repeat(2600).slice(0, 60000 - tail.length) +
      tail;
    sources.push({
      id: await record(
        owner,
        owner.userId,
        "source",
        "ready",
        teaching(text).data,
      ),
      text,
    });
  }
  const token = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [tokenHash(token), owner.userId, owner.tenantId],
    ),
  );
  const app = await buildApp({ db, testing: true }),
    originalFetch = globalThis.fetch,
    previousConfig = Object.fromEntries(
      Object.keys(modelConfig).map((key) => [key, process.env[key]]),
    );
  // The assembled server owns its request configuration context; fixture env
  // values exercise that real loader, and are restored before this test exits.
  Object.assign(process.env, modelConfig);
  let sends = 0;
  globalThis.fetch = async (_url, options) => {
    sends++;
    const sent = JSON.parse(
      JSON.parse(String(options?.body)).messages[1].content,
    );
    assert.equal(sent.length, sources.length);
    for (const source of sources) {
      const actual = sent.find((row: any) => row.id === source.id);
      assert.equal(actual?.text, source.text);
      assert.equal(actual.text.length, 60000);
    }
    return Response.json({
      id: "assembled-coverage-fixture",
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [
        {
          message: {
            content: JSON.stringify({
              rules: sources.map((source, i) => ({
                title: "Reviewed source rule " + (i + 1),
                category: i === 0 ? "safety" : "schedule",
                condition: "Apply the supplied trainer condition",
                directive: tails[i],
                reason:
                  "Proposed from the final instruction in reviewed material",
                sourceIds: [source.id],
              })),
              conflicts: [],
            }),
          },
        },
      ],
    });
  };
  try {
    const response = await withRuntimeConfig(modelConfig, () =>
      app.inject({
        method: "POST",
        url: "/api/v1/brain/compile",
        headers: {
          origin: "http://localhost:3000",
          cookie: "session=" + token,
        },
        payload: { sourceIds: sources.map((source) => source.id) },
      }),
    );
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(sends, 1);
    const result = response.json();
    assert.equal(result.coverage.completeInput, true);
    assert.equal(result.coverage.includedCharacters, 120000);
    assert.equal(result.coverage.sourceCount, 2);
    for (const source of sources) {
      const coverage = result.coverage.sources.find(
        (row: any) => row.sourceId === source.id,
      );
      assert.equal(coverage.sourceVersion, 1);
      assert.equal(
        coverage.contentHash,
        createHash("sha256").update(source.text).digest("hex"),
      );
      assert.equal(coverage.includedCharacters, source.text.length);
    }
    assert.equal(result.rules.length, 2);
    const persisted = await db.tenant(owner, (tx) =>
      tx.query(
        "SELECT * FROM records WHERE kind='rule' AND id=ANY($1::uuid[])",
        [result.rules.map((rule: any) => rule.id)],
      ),
    );
    assert.equal(persisted.length, 2);
    for (const rule of [...result.rules, ...persisted]) {
      assert.equal(rule.status, "draft");
      assert.deepEqual(rule.data.compilationCoverage, result.coverage);
      assert.equal(tails.includes(rule.data.directive), true);
    }
    const [audit] = await db.tenant(owner, (tx) =>
      tx.query(
        "SELECT data FROM events WHERE name='brain.compiled' ORDER BY created_at DESC LIMIT 1",
      ),
    );
    assert.deepEqual(audit.data.coverage, result.coverage);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousConfig)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await app.close();
  }
});
