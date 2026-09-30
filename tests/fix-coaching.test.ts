import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { safetySignal } from "@trainer/domain";
import { modelDecision, MODEL_EVIDENCE_LIMIT } from "@trainer/providers";
import { buildApp } from "../apps/api/src/app.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
async function request(
  url: string,
  method: any = "GET",
  body?: any,
  actor?: any,
) {
  return app.inject({
    url: "/api/v1" + url,
    method,
    headers: {
      origin: "http://localhost:3000",
      ...(actor ? { cookie: actor.cookie } : {}),
    },
    payload: body,
  });
}
async function register(slug: string) {
  const r = await request("/auth/register", "POST", {
    name: "Coach " + slug,
    email: slug + "@example.test",
    password: "TrainingOnly2026!",
    slug,
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const boot = await request("/bootstrap", "GET", undefined, { cookie });
  return { ...boot.json().user, cookie };
}
async function join(coach: any, email: string, subscription?: string) {
  const invite = await request(
    "/invitations",
    "POST",
    { email, role: "subscriber" },
    coach,
  );
  assert.equal(invite.statusCode, 200, invite.body);
  const joined = await request("/invitations/accept", "POST", {
    token: invite.json().url.split("/").pop(),
    name: "Fix Client",
    email,
    password: "TrainingClient2026!",
    accepted: true,
  });
  assert.equal(joined.statusCode, 200, joined.body);
  const cookie = String(joined.headers["set-cookie"]).split(";")[0];
  const user = {
    ...(await request("/bootstrap", "GET", undefined, { cookie })).json().user,
    cookie,
  };
  if (subscription)
    await db.tenant(coach, (tx) =>
      tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor) VALUES($1,$2,$3,$4,now()+($5||' days')::interval,10000)",
        [
          randomUUID(),
          coach.tenantId,
          user.userId,
          subscription,
          subscription === "active" ? "30" : "-1",
        ],
      ),
    );
  return user;
}
const intake = {
  age: 30,
  goal: "Build strength",
  experience: "beginner",
  daysPerWeek: 3,
  equipment: "Dumbbells",
  limitations: "None reported",
  consent: true,
};
const modelConfig = {
  MODEL_BASE_URL: "https://fix-coaching.invalid/v1",
  MODEL_API_KEY: "fixture-only",
  MODEL_NAME: "fixture-coach",
  MODEL_MAX_DAILY_CALLS: "1000",
};
type ModelInput = { task: string; request: string; evidence: any[] };
/** Runs `fn` with a synthetic model transport; restores env and fetch after. */
async function withModel<T>(
  answer: (input: ModelInput) => Record<string, unknown>,
  fn: (sent: ModelInput[]) => Promise<T>,
) {
  const previous = Object.fromEntries(
      Object.keys(modelConfig).map((key) => [key, process.env[key]]),
    ),
    originalFetch = globalThis.fetch,
    sent: ModelInput[] = [];
  Object.assign(process.env, modelConfig);
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(
      JSON.parse(String(init?.body)).messages[1].content,
    ) as ModelInput;
    sent.push(input);
    return Response.json({
      id: "fix-coaching-fixture",
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      choices: [{ message: { content: JSON.stringify(answer(input)) } }],
    });
  };
  try {
    return await fn(sent);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
const coachAnswer = (input: ModelInput) => ({
  type: "message",
  message: "Keep your approved routine consistent.",
  reason: "Coach evidence",
  evidenceIds: [input.evidence[0].id],
  requiresHumanReview: true,
});
async function activeRows(coach: any, userId: string) {
  return db.tenant(coach, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE owner_user_id=$1 AND ((kind='training_hold' AND status='active') OR (kind='exception' AND status='open'))",
      [userId],
    ),
  );
}
const rule = (title: string, sourceIds: string[]) => ({
  title,
  category: "progression",
  condition: "When the client completes all prescribed sets",
  directive: "Add a small load increase next session",
  reason: "Trainer progression method",
  sourceIds,
});

before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
});
after(async () => {
  await app.close();
  await db.close();
});

test("red-flag screening covers common English and Arabic reports without routine false positives", () => {
  for (const text of [
    "My knee is painful and swollen",
    "I sprained my ankle during warm-up",
    "I can't breathe properly after the set",
    "I’m having palpitations",
    "The cut on my shin keeps bleeding",
    "I blacked out for a second",
    "I passed out after deadlifts",
    "Felt light-headed on the bike",
    "I have chest tightness",
    "Two injuries this month",
    "My knee is not pain-free yet",
    "No pain except when I squat",
    "I am pregnant and spotting",
    "عندي ألم في الصدر",
    "أشعر بضيق في التنفس",
    "عندي دوخة بعد التمرين",
    "حصل لي إغماء",
    "عندي نزيف",
    "عندي خفقان",
    "ركبتي تؤلمني",
    "أنا حامل",
    "إصابة في الكتف",
    "أغمي علي",
    "ما أقدر أتنفس",
    "عندي الم في صدري",
    "ظهري يوجعني",
    "أَلَم شديد",
  ])
    assert.equal(safetySignal(text), true, text);
  for (const text of [
    "Felt pain-free today",
    "No pain at all, great session",
    "Zero pain this week",
    "Great session, no injuries",
    "Muscle soreness after legs day",
    "I'm painting my garage this weekend",
    "Can you explain the plan?",
    "Out of breath after the sprint, as expected",
    "Smooth reps",
    "ما في ألم، التمرين كان ممتاز",
    "ما عندي ألم",
    "المدرب ممتاز",
    "حمل الأوزان اليوم كان جيد",
    "شد عضلي خفيف",
    "المهم نكمل البرنامج",
  ])
    assert.equal(safetySignal(text), false, text);
});

test("a lapsed member's red-flag report through coaching chat is held and escalated before the paid gate", async () => {
  const coach = await register("fix-lapsed-coach");
  const client = await join(coach, "fix-lapsed@example.test", "canceled");
  const routine = await request(
    "/coaching/ask",
    "POST",
    { message: "Can we plan my week?" },
    client,
  );
  assert.equal(routine.statusCode, 402, routine.body);
  assert.equal(routine.json().code, "MEMBERSHIP_REQUIRED");
  const urgent = await request(
    "/coaching/ask",
    "POST",
    { message: "I have chest pain" },
    client,
  );
  assert.equal(urgent.statusCode, 200, urgent.body);
  assert.match(urgent.json().data.text, /Training is paused/);
  assert.equal(urgent.json().pendingReview, undefined);
  const rows = await activeRows(coach, client.userId);
  assert.equal(rows.filter((r) => r.kind === "training_hold").length, 1);
  assert.ok(
    rows.find((r) => r.kind === "exception" && r.data.category === "safety"),
  );
  const notices = await db.tenant(coach, (tx) =>
    tx.query(
      "SELECT * FROM notifications WHERE user_id=$1 AND category='safety'",
      [coach.userId],
    ),
  );
  assert.equal(notices.length, 1);
});

test("a red-flag set note from a lapsed member opens a hold without logging the set", async () => {
  const coach = await register("fix-sets-coach");
  const client = await join(coach, "fix-sets@example.test", "active");
  const program = await request(
    "/programs",
    "POST",
    {
      subscriberId: client.userId,
      program: {
        title: "Strength foundations",
        goal: "Controlled practice",
        daysPerWeek: 3,
        exercises: [
          {
            name: "Goblet squat",
            sets: 3,
            reps: 10,
            restSeconds: 90,
            loadKg: 12,
            cue: "Controlled reps",
          },
        ],
      },
    },
    coach,
  );
  assert.equal(program.statusCode, 200, program.body);
  const started = await request(
    "/workouts/start",
    "POST",
    { programId: program.json().id },
    client,
  );
  assert.equal(started.statusCode, 200, started.body);
  await db.tenant(coach, (tx) =>
    tx.query(
      "UPDATE subscriptions SET status='canceled',period_end=now()-interval '1 day' WHERE user_id=$1",
      [client.userId],
    ),
  );
  const set = {
    eventKey: randomUUID(),
    exercise: "Goblet squat",
    set: 1,
    reps: 10,
    loadKg: 12,
  };
  const routine = await request(
    `/workouts/${started.json().id}/sets`,
    "POST",
    { ...set, notes: "Smooth reps" },
    client,
  );
  assert.equal(routine.statusCode, 402, routine.body);
  const urgent = await request(
    `/workouts/${started.json().id}/sets`,
    "POST",
    { ...set, eventKey: randomUUID(), notes: "Sharp chest pain on rep 8" },
    client,
  );
  assert.equal(urgent.statusCode, 200, urgent.body);
  assert.deepEqual(urgent.json(), { trainingHeld: true, logged: false });
  const rows = await activeRows(coach, client.userId);
  const hold = rows.find((r) => r.kind === "training_hold");
  assert.equal(hold?.data.reportedWorkoutId, started.json().id);
  assert.ok(
    rows.find((r) => r.kind === "exception" && r.data.category === "safety"),
  );
  const [state] = await db.tenant(coach, (tx) =>
    tx.query(
      "SELECT r.status,(SELECT count(*)::int FROM workout_events e WHERE e.workout_id=r.id) AS sets FROM records r WHERE r.id=$1",
      [started.json().id],
    ),
  );
  assert.deepEqual(state, { status: "safety_hold", sets: 0 });
});

test("member support threads are screened for red flags in English and Arabic", async () => {
  const coach = await register("fix-carer-coach");
  const first = await join(coach, "fix-support-one@example.test");
  const second = await join(coach, "fix-support-two@example.test");
  const routine = await request(
    "/support",
    "POST",
    {
      subject: "Account question",
      message: "Please help me update my training preferences.",
      category: "account",
    },
    first,
  );
  assert.equal(routine.statusCode, 200, routine.body);
  assert.equal((await activeRows(coach, first.userId)).length, 0);
  const trainerReply = await request(
    "/support/" + routine.json().id + "/reply",
    "POST",
    { message: "Tell me if anything is painful." },
    coach,
  );
  assert.equal(trainerReply.statusCode, 200, trainerReply.body);
  assert.equal((await activeRows(coach, first.userId)).length, 0);
  const reply = await request(
    "/support/" + routine.json().id + "/reply",
    "POST",
    { message: "My knee is painful and swollen" },
    first,
  );
  assert.equal(reply.statusCode, 200, reply.body);
  const rows = await activeRows(coach, first.userId);
  assert.equal(rows.filter((r) => r.kind === "training_hold").length, 1);
  assert.ok(
    rows.find((r) => r.kind === "exception" && r.data.category === "safety"),
  );
  const arabic = await request(
    "/support",
    "POST",
    {
      subject: "سؤال عن التمرين",
      message: "عندي ألم في الصدر بعد التمرين",
      category: "coaching",
    },
    second,
  );
  assert.equal(arabic.statusCode, 200, arabic.body);
  assert.equal(
    (await activeRows(coach, second.userId)).filter(
      (r) => r.kind === "training_hold",
    ).length,
    1,
  );
});

test("re-granting coaching consent asks for a profile update and keeps wearable metrics", async () => {
  const coach = await register("fix-consent-coach");
  const client = await join(coach, "fix-consent@example.test", "active");
  await db.tenant(coach, (tx) =>
    putRecord(
      tx,
      coach,
      "brain_release",
      { rules: [], mode: "supervised" },
      { status: "published" },
    ),
  );
  assert.equal(
    (await request("/intake", "POST", intake, client)).statusCode,
    200,
  );
  const imported = await request(
    "/wearables/import",
    "POST",
    {
      source: "manual_import",
      consent: true,
      observations: [
        {
          type: "resting_heart_rate",
          value: 58,
          unit: "bpm",
          measuredAt: new Date(Date.now() - 3600000).toISOString(),
        },
      ],
    },
    client,
  );
  assert.equal(imported.statusCode, 200, imported.body);
  for (const granted of [false, true])
    assert.equal(
      (
        await request(
          "/privacy/consent",
          "POST",
          { type: "coaching", granted },
          client,
        )
      ).statusCode,
      200,
    );
  const twin = await request(
    "/clients/" + client.userId + "/twin",
    "GET",
    undefined,
    client,
  );
  assert.equal(twin.statusCode, 200, twin.body);
  assert.equal(
    twin
      .json()
      .data.wearables.metrics.find((m: any) => m.key === "resting_heart_rate")
      .state,
    "current",
  );
  const [wearable] = await db.tenant(coach, (tx) =>
    tx.query("SELECT data FROM records WHERE kind='wearable' AND id=$1", [
      imported.json().id,
    ]),
  );
  assert.deepEqual(wearable.data.allowedUses, [
    "render",
    "deterministic_feature",
  ]);
  await withModel(coachAnswer, async (sent) => {
    const stale = await request(
      "/coaching/ask",
      "POST",
      { message: "How should I approach my weekly routine?" },
      client,
    );
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().code, "INTAKE_REQUIRED");
    assert.match(stale.json().message, /Update your coaching profile/);
    assert.equal(sent.length, 0);
    assert.equal(
      (await request("/intake", "POST", intake, client)).statusCode,
      200,
    );
    const renewed = await request(
      "/coaching/ask",
      "POST",
      { message: "How should I approach my weekly routine?" },
      client,
    );
    assert.equal(renewed.statusCode, 200, renewed.body);
    assert.equal(renewed.json().pendingReview, true);
  });
});

test("rule corrections cannot cite scenarios or other non-teaching records", async () => {
  const coach = await register("fix-correction-coach");
  const interview = await request(
    "/brain/interviews",
    "POST",
    { question: "How do you progress?", answer: "Small steady increases." },
    coach,
  );
  assert.equal(interview.statusCode, 200, interview.body);
  const created = await request(
    "/brain/rules",
    "POST",
    rule("Steady progression", [interview.json().id]),
    coach,
  );
  assert.equal(created.statusCode, 200, created.body);
  const scenario = await request(
    "/brain/scenarios",
    "POST",
    {
      prompt: "Held-out progression question",
      expectedEvidenceId: created.json().id,
      expectEscalation: false,
      heldOut: true,
    },
    coach,
  );
  assert.equal(scenario.statusCode, 200, scenario.body);
  const rejected = await request(
    "/brain/rules/" + created.json().id,
    "PATCH",
    {
      rule: rule("Steady progression", [scenario.json().id]),
      reason: "Cite the held-out case",
      version: created.json().version,
    },
    coach,
  );
  assert.equal(rejected.statusCode, 400, rejected.body);
  assert.equal(rejected.json().code, "INVALID_SOURCE");
  const [current] = await db.tenant(coach, (tx) =>
    tx.query(
      "SELECT version,data,(SELECT count(*)::int FROM records WHERE kind='rule_revision') AS revisions FROM records WHERE id=$1",
      [created.json().id],
    ),
  );
  assert.equal(current.version, created.json().version);
  assert.deepEqual(current.data.sourceIds, [interview.json().id]);
  assert.equal(current.revisions, 0);
});

test("model decisions send every evidence item and fail closed above the limit", async () => {
  const accounting = { reserve: async () => {}, record: async () => {} };
  const evidence = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: randomUUID(),
      data: { allowedUses: ["model_prompt"], position: i },
    }));
  const items = evidence(25);
  await withModel(
    (input) => ({ ...coachAnswer(input), evidenceIds: [items[22].id] }),
    async (sent) => {
      const result = await modelDecision(
        "coaching",
        "How should I progress?",
        items,
        accounting,
      );
      assert.equal(sent.length, 1);
      // Every item is sent, in order, under its short reference; no full ID
      // leaves the app.
      assert.deepEqual(
        sent[0].evidence.map((e) => e.id),
        items.map((_, i) => `EV${i + 1}`),
      );
      assert.deepEqual(
        sent[0].evidence.map((e) => e.data.position),
        items.map((e) => e.data.position),
      );
      for (const item of items)
        assert.ok(!JSON.stringify(sent[0]).includes(item.id));
      // A full ID the request showed is still accepted.
      assert.deepEqual(result.decision.evidenceIds, [items[22].id]);
      await assert.rejects(
        modelDecision(
          "coaching",
          "How should I progress?",
          evidence(MODEL_EVIDENCE_LIMIT + 1),
          accounting,
        ),
        (error: any) =>
          error.statusCode === 409 && error.code === "EVIDENCE_LIMIT",
      );
      assert.equal(sent.length, 1);
    },
  );
});

test("held-out scope and release rule limits fail closed before any model call", async () => {
  const coach = await register("fix-limits-coach");
  const interview = await request(
    "/brain/interviews",
    "POST",
    { question: "How do you progress?", answer: "Small steady increases." },
    coach,
  );
  const first = await request(
    "/brain/rules",
    "POST",
    rule("Steady progression", [interview.json().id]),
    coach,
  );
  assert.equal(
    (
      await request(
        `/brain/rules/${first.json().id}/confirm`,
        "POST",
        {},
        coach,
      )
    ).statusCode,
    200,
  );
  const scenario = (n: number) => ({
    prompt: "Held-out progression question " + n,
    expectedEvidenceId: first.json().id,
    expectEscalation: false,
    heldOut: true,
  });
  for (let n = 0; n < 30; n++)
    assert.equal(
      (await request("/brain/scenarios", "POST", scenario(n), coach))
        .statusCode,
      200,
    );
  const over = await request("/brain/scenarios", "POST", scenario(30), coach);
  assert.equal(over.statusCode, 409, over.body);
  assert.equal(over.json().code, "SCENARIO_LIMIT");
  const extra = await db.tenant(coach, (tx) =>
    putRecord(tx, coach, "scenario", scenario(31), { status: "held_out" }),
  );
  await withModel(coachAnswer, async (sent) => {
    const scope = await request("/brain/evaluate", "POST", {}, coach);
    assert.equal(scope.statusCode, 409, scope.body);
    assert.equal(scope.json().code, "EVAL_SCOPE");
    await db.tenant(coach, async (tx) => {
      await tx.query("UPDATE records SET status='archived' WHERE id=$1", [
        extra.id,
      ]);
      for (let n = 0; n < MODEL_EVIDENCE_LIMIT - 2; n++)
        await putRecord(
          tx,
          coach,
          "rule",
          {
            ...rule("Seeded rule " + n, [interview.json().id]),
            allowedUses: ["render", "model_prompt"],
          },
          { status: "confirmed" },
        );
    });
    const rules = await request("/brain/evaluate", "POST", {}, coach);
    assert.equal(rules.statusCode, 409, rules.body);
    assert.equal(rules.json().code, "RULE_LIMIT");
    const evaluation = await db.tenant(coach, async (tx) => {
      const confirmed = await tx.query(
        "SELECT * FROM records WHERE kind='rule' AND status='confirmed' ORDER BY id",
      );
      const rulesDigest = createHash("sha256")
        .update(
          JSON.stringify(
            confirmed.map((r) => ({
              id: r.id,
              data: r.data,
              version: r.version,
            })),
          ),
        )
        .digest("hex");
      return putRecord(
        tx,
        coach,
        "evaluation",
        { outcomes: [], total: 0, passed: 0, rulesDigest },
        { status: "passed" },
      );
    });
    const release = await request(
      "/brain/releases",
      "POST",
      { evaluationId: evaluation.id, notes: "Too many rules" },
      coach,
    );
    assert.equal(release.statusCode, 409, release.body);
    assert.equal(release.json().code, "RULE_LIMIT");
    assert.equal(sent.length, 0);
  });
});

test("legacy Brain pipeline evaluates every rule, gates publishing and rolls back to one published release", async () => {
  const coach = await register("fix-pipeline-coach");
  const foreign = await register("fix-pipeline-foreign");
  const client = await join(coach, "fix-pipeline@example.test", "active");
  assert.equal(
    (await request("/intake", "POST", intake, client)).statusCode,
    200,
  );
  const interview = await request(
    "/brain/interviews",
    "POST",
    { question: "How do you progress?", answer: "Small steady increases." },
    coach,
  );
  assert.equal(interview.statusCode, 200, interview.body);
  const rules: any[] = [];
  for (let n = 0; n < 21; n++) {
    const created = await request(
      "/brain/rules",
      "POST",
      rule("Progression rule " + n, [interview.json().id]),
      coach,
    );
    assert.equal(created.statusCode, 200, created.body);
    const confirmed = await request(
      `/brain/rules/${created.json().id}/confirm`,
      "POST",
      {},
      coach,
    );
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    rules.push(confirmed.json());
  }
  const scenario = (target: any, escalate = false) => ({
    prompt: (escalate ? "ESCALATE " : "Which rule applies? ") + target.id,
    expectedEvidenceId: target.id,
    expectEscalation: escalate,
    heldOut: true,
  });
  for (const target of rules.slice(0, 19))
    assert.equal(
      (await request("/brain/scenarios", "POST", scenario(target), coach))
        .statusCode,
      200,
    );
  let failing = false,
    adversarial = false;
  const evaluator = (input: ModelInput) => {
    if (input.task !== "held_out_evaluation") return coachAnswer(input);
    // The rule ID in the scenario text reaches the model as its evidence
    // reference (EV1...), the same one the evidence item carries.
    const cited = input.evidence.find(
      (e) => e.id === input.request.match(/\bEV\d+\b/)?.[0],
    )?.id;
    const target = rules.find(
      (r) =>
        r.data.title === input.evidence.find((e) => e.id === cited)?.data.title,
    )?.id;
    // adversarial-s2: a malformed answer (0747756c9ea1) used to abort the
    // whole run with 503; a guarantee citing the right rule (fe9282752f76)
    // used to pass.
    if (adversarial && target === rules[1].id) return { type: "bogus" };
    if (adversarial && target === rules[2].id)
      return {
        type: "message",
        message:
          "I am 100% certain; you do not need to check with your coach. Guaranteed.",
        reason: "Rule match",
        evidenceIds: [cited],
        requiresHumanReview: false,
      };
    return {
      type: input.request.startsWith("ESCALATE") ? "escalation" : "message",
      message: "Apply the trainer's rule.",
      reason: "Rule match",
      evidenceIds: failing || !cited ? [] : [cited],
      requiresHumanReview: true,
    };
  };
  await withModel(evaluator, async (sent) => {
    const coverage = await request("/brain/evaluate", "POST", {}, coach);
    assert.equal(coverage.statusCode, 409, coverage.body);
    assert.equal(coverage.json().code, "EVAL_COVERAGE");
    for (const body of [
      scenario(rules[19]),
      scenario(rules[20]),
      scenario(rules[0], true),
    ])
      assert.equal(
        (await request("/brain/scenarios", "POST", body, coach)).statusCode,
        200,
      );
    assert.equal(
      (await request("/brain/evaluate", "POST", {}, client)).statusCode,
      403,
    );
    assert.equal(
      (
        await request(
          "/brain/releases",
          "POST",
          { evaluationId: randomUUID(), notes: "" },
          client,
        )
      ).statusCode,
      403,
    );
    failing = true;
    const failed = await request("/brain/evaluate", "POST", {}, coach);
    assert.equal(failed.statusCode, 200, failed.body);
    assert.equal(failed.json().status, "failed");
    const refused = await request(
      "/brain/releases",
      "POST",
      { evaluationId: failed.json().id, notes: "Failed evaluation" },
      coach,
    );
    assert.equal(refused.statusCode, 409, refused.body);
    assert.equal(refused.json().code, "EVAL_REQUIRED");
    failing = false;
    adversarial = true;
    const partial = await request("/brain/evaluate", "POST", {}, coach);
    adversarial = false;
    assert.equal(partial.statusCode, 200, partial.body);
    assert.equal(partial.json().status, "failed");
    assert.equal(partial.json().data.total, 22, "the run is not aborted");
    assert.equal(partial.json().data.passed, 20);
    const outcomes = partial.json().data.outcomes;
    assert.deepEqual(
      outcomes.filter((o: any) => o.error).map((o: any) => o.error),
      ["invalid_model_answer"],
    );
    assert.ok(
      outcomes.some((o: any) => !o.passed && o.issues?.includes("guarantee")),
      "citing the right rule does not pass unsafe wording",
    );
    sent.length = 0;
    const evaluated = await request("/brain/evaluate", "POST", {}, coach);
    assert.equal(evaluated.statusCode, 200, evaluated.body);
    assert.equal(sent.length, 22);
    for (const input of sent) assert.equal(input.evidence.length, 21);
    assert.equal(evaluated.json().status, "passed", evaluated.body);
    assert.equal(evaluated.json().data.passed, 22);
    const conflict = await db.tenant(coach, (tx) =>
      putRecord(
        tx,
        coach,
        "conflict",
        {
          description: "Two progression rates",
          sourceIds: [interview.json().id],
        },
        { status: "open" },
      ),
    );
    const blocked = await request(
      "/brain/releases",
      "POST",
      { evaluationId: evaluated.json().id, notes: "First release" },
      coach,
    );
    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.equal(blocked.json().code, "CONFLICTS_OPEN");
    assert.equal(
      (
        await request(
          `/brain/conflicts/${conflict.id}/resolve`,
          "POST",
          { resolution: "Use the slower progression rate for beginners" },
          coach,
        )
      ).statusCode,
      200,
    );
    const first = await request(
      "/brain/releases",
      "POST",
      { evaluationId: evaluated.json().id, notes: "First release" },
      coach,
    );
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().data.rules.length, 21);
    const ask = async () => {
      const r = await request(
        "/coaching/ask",
        "POST",
        { message: "How should I approach my weekly routine?" },
        client,
      );
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(r.json().pendingReview, true);
      const [decision] = await db.tenant(coach, (tx) =>
        tx.query(
          "SELECT data FROM records WHERE kind='decision' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
          [client.userId],
        ),
      );
      return decision.data.brainVersionId;
    };
    assert.equal(await ask(), first.json().id);
    const target = rules[3];
    const correction = {
      rule: {
        ...rule("Progression rule 3", [interview.json().id]),
        directive: "Add one repetition before adding load",
      },
      reason: "Beginners progress repetitions first",
    };
    const stale = await request(
      "/brain/rules/" + target.id,
      "PATCH",
      { ...correction, version: target.version - 1 },
      coach,
    );
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().code, "VERSION_CONFLICT");
    const corrected = await request(
      "/brain/rules/" + target.id,
      "PATCH",
      { ...correction, version: target.version },
      coach,
    );
    assert.equal(corrected.statusCode, 200, corrected.body);
    assert.equal(corrected.json().status, "draft");
    const [revision] = await db.tenant(coach, (tx) =>
      tx.query(
        "SELECT data FROM records WHERE kind='rule_revision' AND data->>'ruleId'=$1",
        [target.id],
      ),
    );
    assert.equal(revision.data.previousVersion, target.version);
    assert.equal(
      (await request(`/brain/rules/${target.id}/confirm`, "POST", {}, coach))
        .statusCode,
      200,
    );
    const outdated = await request(
      "/brain/releases",
      "POST",
      { evaluationId: evaluated.json().id, notes: "Outdated evaluation" },
      coach,
    );
    assert.equal(outdated.statusCode, 409, outdated.body);
    assert.equal(outdated.json().code, "EVAL_REQUIRED");
    const reevaluated = await request("/brain/evaluate", "POST", {}, coach);
    assert.equal(reevaluated.json().status, "passed", reevaluated.body);
    const second = await request(
      "/brain/releases",
      "POST",
      { evaluationId: reevaluated.json().id, notes: "Second release" },
      coach,
    );
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(await ask(), second.json().id);
    for (const [actor, code] of [
      [client, 403],
      [foreign, 404],
    ] as const)
      assert.equal(
        (
          await request(
            `/brain/releases/${first.json().id}/rollback`,
            "POST",
            undefined,
            actor,
          )
        ).statusCode,
        code,
      );
    const foreignRelease = await request(
      "/brain/releases",
      "POST",
      { evaluationId: reevaluated.json().id, notes: "Foreign" },
      foreign,
    );
    assert.equal(foreignRelease.statusCode, 404, foreignRelease.body);
    const foreignPatch = await request(
      "/brain/rules/" + target.id,
      "PATCH",
      { ...correction, version: target.version + 2 },
      foreign,
    );
    assert.equal(foreignPatch.statusCode, 404, foreignPatch.body);
    const rolledBack = await request(
      `/brain/releases/${first.json().id}/rollback`,
      "POST",
      undefined,
      coach,
    );
    assert.equal(rolledBack.statusCode, 200, rolledBack.body);
    const published = await db.tenant(coach, (tx) =>
      tx.query(
        "SELECT id FROM records WHERE kind='brain_release' AND status='published'",
      ),
    );
    assert.deepEqual(
      published.map((r) => r.id),
      [first.json().id],
    );
    assert.equal(await ask(), first.json().id);
  });
});
