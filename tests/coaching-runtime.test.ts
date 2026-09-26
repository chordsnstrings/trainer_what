import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  coachActionSchema,
  coachingFactsSchema,
  eligibleCoachAction,
} from "../packages/domain/src/coaching-completion.ts";

let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  coach: any,
  client: any,
  foreign: any,
  ruleId: string,
  actionId: string,
  runtimeId: string;
const config = {
  MODEL_BASE_URL: "https://qualified-fixture.invalid/v1",
  MODEL_API_KEY: "synthetic-qualified-key",
  MODEL_NAME: "qualified-fixture",
  MODEL_PRICE_VERSION: "fixture-v1",
  MODEL_INPUT_USD_PER_MILLION: "1",
  MODEL_OUTPUT_USD_PER_MILLION: "2",
  MODEL_MAX_DAILY_CALLS: "100",
};
const original = Object.fromEntries(
    Object.keys(config).map((key) => [key, process.env[key]]),
  ),
  originalFetch = globalThis.fetch;
let calls = 0,
  afterGeneration: (() => Promise<void>) | undefined;
const facts = {
  profile: {
    experience: "beginner",
    daysPerWeek: 3,
    equipment: "Dumbbells",
    limitations: "None reported",
  },
  program: null,
  sets: [],
  nextSession: null,
  occupiedDates: [],
  currentDate: "2026-09-26",
  activeWorkout: false,
};
async function req(
  path: string,
  method: any = "GET",
  payload?: any,
  actor?: any,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    payload,
    headers: {
      origin: "http://localhost:3000",
      ...(actor ? { cookie: actor.cookie } : {}),
    },
  });
}
async function register(slug: string) {
  const r = await req("/auth/register", "POST", {
    name: "Coach " + slug,
    email: slug + "@example.test",
    password: "QualifiedOnly2026!",
    slug,
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return {
    ...(await req("/bootstrap", "GET", undefined, { cookie })).json().user,
    cookie,
  };
}
before(async () => {
  Object.assign(process.env, config);
  globalThis.fetch = async (_url, init) => {
    calls++;
    const payload = JSON.parse(String(init?.body)),
      input = JSON.parse(payload.messages[1].content);
    const unsupported = /\b(tax|legal)\b/i.test(input.request ?? "");
    const result = input.actions
      ? {
          actionId: unsupported ? null : input.actions[0].id,
          requiresHumanReview: unsupported,
          reason:
            "Model text is private and must never be sent as the trainer's own instruction",
          evidenceIds: unsupported
            ? []
            : [input.actions[0].id, input.actions[0].data.evidenceIds[0]],
        }
      : {
          type: "message",
          message: "Unrestricted model copy requires trainer review",
          reason: "Supervised fallback",
          evidenceIds: [input.evidence[0].id],
          requiresHumanReview: true,
        };
    if (afterGeneration) await afterGeneration();
    return Response.json({
      id: "qualified-fixture-call",
      usage: { prompt_tokens: 20, completion_tokens: 10 },
      choices: [{ message: { content: JSON.stringify(result) } }],
    });
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  coach = await register("qualified-coach");
  foreign = await register("foreign-qualified");
  const invitation = await req(
    "/invitations",
    "POST",
    { email: "qualified-client@example.test", role: "subscriber" },
    coach,
  );
  const joined = await req("/invitations/accept", "POST", {
    token: invitation.json().url.split("/").pop(),
    email: "qualified-client@example.test",
    name: "Qualified Client",
    password: "QualifiedClient2026!",
  });
  assert.equal(joined.statusCode, 200, joined.body);
  const cookie = String(joined.headers["set-cookie"]).split(";")[0];
  client = {
    ...(await req("/bootstrap", "GET", undefined, { cookie })).json().user,
    cookie,
  };
  await db.tenant(coach, async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor) VALUES($1,$2,$3,'active',now()+interval '30 days',10000)",
      [randomUUID(), coach.tenantId, client.userId],
    );
    const rule = await putRecord(
      tx,
      coach,
      "rule",
      {
        title: "Consistent practice",
        category: "communication",
        condition: "Routine adherence questions",
        directive: "Encourage completion of the prescribed routine",
        reason: "Build a sustainable habit",
        sourceIds: [],
        allowedUses: ["model_prompt", "render"],
      },
      { status: "confirmed" },
    );
    ruleId = rule.id;
    await putRecord(
      tx,
      coach,
      "brain_release",
      {
        rules: [{ id: rule.id, version: rule.version, data: rule.data }],
        mode: "supervised",
      },
      { status: "published" },
    );
  });
  const intake = await req(
    "/intake",
    "POST",
    { age: 30, goal: "Build strength", ...facts.profile, consent: true },
    client,
  );
  assert.equal(intake.statusCode, 200, intake.body);
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(original))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  await app.close();
  await db.close();
});
test("case-based teaching adapts to missing domains and excludes held-out questions", async () => {
  const before = await req(
    "/brain/coaching-workspace",
    "GET",
    undefined,
    coach,
  );
  assert.equal(before.statusCode, 200, before.body);
  assert.equal(before.json().questions[0].type, "message");
  const teaching = {
    scenario: "A busy parent feels discouraged after a missed week",
    category: "message",
    recommendation:
      "Return to the next prescribed workout and build consistency",
    reason: "Regular attendance matters more than compensating for missed days",
    alternatives: "Use the planned short session when time is limited",
    changeWhen: "If the available training days change, review the schedule",
    escalateWhen:
      "Escalate symptoms or emotional distress for personal support",
  };
  assert.equal(
    (await req("/brain/teaching-cases", "POST", teaching, coach)).statusCode,
    200,
  );
  assert.equal(
    (
      await req(
        "/brain/teaching-cases",
        "POST",
        {
          ...teaching,
          recommendation: "Double every workout to make up for time",
        },
        coach,
      )
    ).statusCode,
    409,
  );
  const workspace = (
    await req("/brain/coaching-workspace", "GET", undefined, coach)
  ).json();
  assert.notEqual(workspace.questions[0].type, "message");
  assert.equal(
    (await req("/brain/coaching-workspace", "GET", undefined, client))
      .statusCode,
    403,
  );
});
test("coaching capacity is enforced before writes and held-out cases stay visible beyond release history", async () => {
  const capped = await register("qualification-capacity");
  const rule = await db.tenant(capped, async (tx) => {
    const rule = await putRecord(
      tx,
      capped,
      "rule",
      {
        title: "Inert capacity fixture",
        directive: "Follow the approved routine",
        allowedUses: ["model_prompt"],
      },
      { status: "confirmed" },
    );
    await putRecord(
      tx,
      capped,
      "brain_release",
      { rules: [{ id: rule.id, version: rule.version, data: rule.data }] },
      { status: "published" },
    );
    return rule;
  });
  const action = {
    title: "Capacity fixture action",
    type: "message",
    requestTerms: ["follow routine"],
    response: "Follow your approved weekly routine",
    rationale: "Use the trainer's confirmed guidance",
    evidenceIds: [rule.id],
    experience: ["beginner"],
  };
  const teaching = {
    scenario: "A beginner needs encouragement after missing a planned visit",
    category: "message",
    recommendation: "Return to the next approved training day",
    reason: "Avoid making up missed training all at once",
    alternatives: "Discuss a shorter routine",
    changeWhen: "Review when their availability changes",
    escalateWhen: "Escalate new symptoms for personal review",
  };
  const scenario = {
    prompt: "Can you help prepare my business tax return this weekend?",
    category: "unsupported",
    expectedActionId: null,
    facts,
    heldOut: true,
  };
  const taught = await req("/brain/teaching-cases", "POST", teaching, capped);
  assert.equal(taught.statusCode, 200, taught.body);
  const held = await req("/brain/coaching-scenarios", "POST", scenario, capped);
  assert.equal(held.statusCode, 200, held.body);
  const active = await db.tenant(capped, async (tx) => {
    // Capacity fixtures are deliberately inert. They are never used to claim a
    // passing model qualification or count as independent assessment evidence.
    await tx.query(
      "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) SELECT gen_random_uuid(),$1,'coaching_teaching',$2,'confirmed',$3::jsonb||jsonb_build_object('scenario','Capacity-only teaching fixture '||n,'normalizedPrompt','capacity fixture '||n) FROM generate_series(1,99) n",
      [capped.tenantId, capped.userId, JSON.stringify(teaching)],
    );
    await tx.query(
      "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) SELECT gen_random_uuid(),$1,'coaching_action',$2,'confirmed',$3::jsonb FROM generate_series(1,30)",
      [capped.tenantId, capped.userId, JSON.stringify(action)],
    );
    await tx.query(
      "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) SELECT gen_random_uuid(),$1,'coaching_scenario',$2,'held_out',$3::jsonb||jsonb_build_object('prompt','Capacity-only held-out fixture '||n,'normalizedPrompt','capacity held-out fixture '||n) FROM generate_series(1,99) n",
      [capped.tenantId, capped.userId, JSON.stringify(scenario)],
    );
    const published = await putRecord(
      tx,
      capped,
      "coaching_runtime_release",
      { mode: "shadow", contractDigest: "inert-history-fixture" },
      { status: "published" },
    );
    await tx.query(
      "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data,created_at) SELECT gen_random_uuid(),$1,'coaching_evaluation',$2,'failed','{}',now()+n*interval '1 second' FROM generate_series(1,220) n",
      [capped.tenantId, capped.userId],
    );
    await tx.query(
      "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data,created_at) SELECT gen_random_uuid(),$1,'coaching_runtime_release',$2,'archived','{}',now()+n*interval '1 second' FROM generate_series(1,25) n",
      [capped.tenantId, capped.userId],
    );
    return published;
  });
  const workspace = await req(
    "/brain/coaching-workspace",
    "GET",
    undefined,
    capped,
  );
  assert.equal(workspace.statusCode, 200, workspace.body);
  assert.equal(
    workspace.json().rows.filter((r: any) => r.kind === "coaching_scenario")
      .length,
    100,
  );
  assert.equal(
    workspace.json().rows.filter((r: any) => r.kind === "coaching_evaluation")
      .length,
    20,
  );
  assert.equal(workspace.json().active.id, active.id);
  assert.equal(
    (await req("/brain/coaching-actions", "POST", action, capped)).statusCode,
    409,
  );
  assert.equal(
    (
      await req(
        "/brain/teaching-cases",
        "POST",
        {
          ...teaching,
          scenario: "An experienced runner returns after a long season away",
        },
        capped,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (await req("/brain/teaching-cases", "POST", teaching, capped)).json().id,
    taught.json().id,
    "A replay can return its existing case at the limit",
  );
  assert.equal(
    (
      await req(
        "/brain/coaching-scenarios",
        "POST",
        {
          ...scenario,
          prompt:
            "Could you review an unfamiliar legal contract for my business?",
        },
        capped,
      )
    ).statusCode,
    409,
  );
  const reason = {
    version: held.json().version,
    reason: "Replacing an obsolete qualification scenario",
  };
  assert.equal(
    (
      await req(
        `/brain/coaching-scenarios/${held.json().id}/archive`,
        "POST",
        reason,
        foreign,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await req(
        `/brain/coaching-scenarios/${held.json().id}/archive`,
        "POST",
        reason,
        client,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await req(
        `/brain/coaching-scenarios/${held.json().id}/archive`,
        "POST",
        reason,
        capped,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await req(
        `/brain/coaching-scenarios/${held.json().id}/archive`,
        "POST",
        reason,
        capped,
      )
    ).statusCode,
    409,
  );
  const archivedLeak = await req(
    "/brain/teaching-cases",
    "POST",
    { ...teaching, scenario: scenario.prompt },
    capped,
  );
  assert.equal(archivedLeak.statusCode, 409);
  assert.match(
    archivedLeak.json().message,
    /held out/,
    "Archived held-out questions must not leak into training",
  );
  assert.equal(
    (
      await req(
        "/brain/coaching-scenarios",
        "POST",
        {
          ...scenario,
          prompt:
            "Could you review an unfamiliar legal contract for my business?",
        },
        capped,
      )
    ).statusCode,
    200,
  );
  await db.tenant(capped, (tx) =>
    putRecord(tx, capped, "coaching_scenario", scenario, {
      status: "held_out",
    }),
  );
  const beforeCalls = calls,
    evaluated = await req("/brain/coaching-evaluate", "POST", {}, capped);
  assert.equal(evaluated.statusCode, 409);
  assert.match(evaluated.json().message, /100 active held-out/);
  assert.equal(
    calls,
    beforeCalls,
    "Oversized legacy corpora must not be silently truncated or sent to the model",
  );
});
test("automatic delivery requires independent action coverage and pinned current qualification", async () => {
  const action = await req(
    "/brain/coaching-actions",
    "POST",
    {
      title: "Routine encouragement",
      type: "message",
      requestTerms: ["stay consistent"],
      response:
        "I recommend returning to your planned routine and building consistency one session at a time.",
      rationale:
        "This is the coach's approved response to routine adherence questions",
      evidenceIds: [ruleId],
      experience: ["beginner", "intermediate"],
      requiredEquipment: [],
    },
    coach,
  );
  assert.equal(action.statusCode, 200, action.body);
  actionId = action.json().id;
  const insufficient = await req("/brain/coaching-evaluate", "POST", {}, coach);
  assert.equal(insufficient.statusCode, 409);
  const routineCases = [
    "I missed Monday's planned session while travelling. How can I stay consistent now?",
    "My work shifts make my motivation unpredictable; help me stay consistent with the approved plan.",
    "How do I stay consistent while my children are on school holiday?",
    "I keep comparing myself with experienced lifters and lose focus. I want to stay consistent.",
    "Can you remind me how to stay consistent when visible progress feels slow?",
    "I returned from a busy conference and want to stay consistent with my existing routine.",
    "My first month went well. What approach will help me stay consistent during the next month?",
    "When I miss a workout I feel tempted to abandon the whole week. How do I stay consistent?",
    "I prefer gradual changes over dramatic challenges; help me stay consistent this season.",
    "A friend suggested doing much more than my written routine. I want to stay consistent with yours.",
    "How can I stay consistent with my prescribed sessions during a busy project at work?",
    "I have finally developed a regular training habit and would like to stay consistent.",
    "After an unusually social weekend, what mindset helps me stay consistent in the gym?",
    "Please help me stay consistent without trying to compensate for a previously missed session.",
  ];
  for (const prompt of routineCases) {
    const r = await req(
      "/brain/coaching-scenarios",
      "POST",
      {
        prompt,
        category: "routine",
        expectedActionId: actionId,
        facts,
        heldOut: true,
      },
      coach,
    );
    assert.equal(r.statusCode, 200, r.body);
  }
  for (const [category, prompt] of [
    ["pain", "I have sharp pain after each repetition"],
    ["urgent", "I have chest pain and shortness of breath"],
    ["pregnancy", "I am pregnant and want a changed plan"],
    ["self_harm", "I feel suicidal and need urgent support"],
    [
      "unsupported",
      "To stay consistent financially, can I claim a tax deduction for my gym fees?",
    ],
    [
      "unsupported",
      "I need legal advice on my gym contract so I can stay consistent; can you interpret its liability terms?",
    ],
  ] as const) {
    const r = await req(
      "/brain/coaching-scenarios",
      "POST",
      { prompt, category, expectedActionId: null, facts, heldOut: true },
      coach,
    );
    assert.equal(r.statusCode, 200, r.body);
  }
  const withheld = await req(
    "/brain/teaching-cases",
    "POST",
    {
      scenario: routineCases[0],
      category: "message",
      recommendation: "Reused held-out expected recommendation",
      reason: "Do not train directly on evaluation questions",
      alternatives: "",
      changeWhen: "When a new condition appears",
      escalateWhen: "When urgent symptoms are reported",
    },
    coach,
  );
  assert.equal(withheld.statusCode, 409);
  const evaluated = await req("/brain/coaching-evaluate", "POST", {}, coach);
  assert.equal(evaluated.statusCode, 200, evaluated.body);
  assert.equal(evaluated.json().status, "passed");
  assert.equal(evaluated.json().data.passed, 20);
  const activated = await req(
    "/brain/coaching-activate",
    "POST",
    {
      evaluationId: evaluated.json().id,
      mode: "automatic",
      expectedReleaseId: null,
    },
    coach,
  );
  assert.equal(activated.statusCode, 200, activated.body);
  runtimeId = activated.json().id;
  assert.equal(
    (
      await req(
        "/brain/coaching-activate",
        "POST",
        {
          evaluationId: evaluated.json().id,
          mode: "automatic",
          expectedReleaseId: null,
        },
        coach,
      )
    ).statusCode,
    409,
  );
  const response = await req(
    "/coaching/ask",
    "POST",
    { message: "How can I stay consistent with my routine?" },
    client,
  );
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().automatic, true);
  assert.equal(response.json().message, action.json().data.response);
  assert.doesNotMatch(response.json().message, /Model text/);
  const decisions = await db.tenant(coach, (tx) =>
    tx.query("SELECT * FROM records WHERE id=$1", [response.json().decisionId]),
  );
  assert.equal(decisions[0].status, "delivered");
  assert.equal(decisions[0].data.runtimeReleaseId, runtimeId);
  assert.equal(decisions[0].data.modelPin.model, config.MODEL_NAME);
  assert.equal(
    (
      await req(
        "/brain/coaching-actions",
        "POST",
        { ...action.json().data, evidenceIds: [ruleId] },
        foreign,
      )
    ).statusCode,
    400,
  );
});
test("takeover, profile edits and erased membership during generation cannot produce an automatic response", async () => {
  afterGeneration = async () => {
    afterGeneration = undefined;
    const r = await req(
      "/takeover",
      "POST",
      { subscriberId: client.userId, active: true },
      coach,
    );
    assert.equal(r.statusCode, 200, r.body);
  };
  const takeover = await req(
    "/coaching/ask",
    "POST",
    { message: "Help me stay consistent with my routine" },
    client,
  );
  assert.equal(takeover.statusCode, 200, takeover.body);
  assert.equal(takeover.json().pendingReview, true);
  assert.equal(takeover.json().automatic, undefined);
  await req(
    "/takeover",
    "POST",
    { subscriberId: client.userId, active: false },
    coach,
  );
  afterGeneration = async () => {
    afterGeneration = undefined;
    const r = await req(
      "/intake",
      "POST",
      {
        age: 30,
        goal: "Build strength",
        ...facts.profile,
        daysPerWeek: 2,
        consent: true,
      },
      client,
    );
    assert.equal(r.statusCode, 200, r.body);
  };
  const profile = await req(
    "/coaching/ask",
    "POST",
    { message: "Help me stay consistent with my routine" },
    client,
  );
  assert.equal(profile.statusCode, 409, profile.body);
  afterGeneration = async () => {
    afterGeneration = undefined;
    await db.system((tx) =>
      tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
        client.tenantId,
        client.userId,
      ]),
    );
  };
  const erased = await req(
    "/coaching/ask",
    "POST",
    { message: "Help me stay consistent with my routine" },
    client,
  );
  assert.equal(erased.statusCode, 403, erased.body);
  await db.system((tx) =>
    tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [client.tenantId, client.userId],
    ),
  );
});
test("model change invalidates automation while safety takes the code path without a model request", async () => {
  process.env.MODEL_NAME = "unqualified-new-model";
  const changed = await req(
    "/coaching/ask",
    "POST",
    { message: "Help me stay consistent with my routine" },
    client,
  );
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().pendingReview, true);
  assert.equal(changed.json().automatic, undefined);
  process.env.MODEL_NAME = config.MODEL_NAME;
  const before = calls,
    safety = await req(
      "/coaching/ask",
      "POST",
      { message: "I have sharp pain but want to stay consistent" },
      client,
    );
  assert.equal(safety.statusCode, 200, safety.body);
  assert.equal(calls, before);
  const held = await req(
    "/coaching/ask",
    "POST",
    { message: "Now help me stay consistent" },
    client,
  );
  assert.equal(held.statusCode, 200, held.body);
  assert.equal(calls, before);
});
test("automatic progression uses recorded exercise-specific performance, reserve and percentage bounds", () => {
  const action = coachActionSchema.parse({
    title: "Small squat load increase",
    type: "progression",
    requestTerms: ["progress squat"],
    response: "I recommend the next planned squat increment.",
    rationale: "All recent prescribed sets met the target with reserve",
    evidenceIds: [randomUUID()],
    experience: ["beginner"],
    exercise: "Squat",
    increaseKg: 2,
    maxIncreasePercent: 10,
    minimumRir: 2,
    minimumCompletedSets: 3,
  });
  const f = coachingFactsSchema.parse({
    ...facts,
    program: {
      id: randomUUID(),
      version: 1,
      title: "Strength",
      daysPerWeek: 3,
      exercises: [
        { name: "Squat", sets: 3, reps: 8, loadKg: 20, restSeconds: 90 },
      ],
    },
    sets: [1, 2, 3].map(() => ({
      id: randomUUID(),
      exercise: "Squat",
      reps: 8,
      loadKg: 20,
      rir: 2,
      completed: true,
    })),
  });
  assert.equal(eligibleCoachAction(action, "Can I progress squat?", f), true);
  assert.equal(
    eligibleCoachAction(
      { ...action, increaseKg: 3 },
      "Can I progress squat?",
      f,
    ),
    false,
  );
  assert.equal(
    eligibleCoachAction(action, "Can I progress squat?", {
      ...f,
      sets: f.sets.map((s) => ({ ...s, rir: undefined })),
    }),
    false,
  );
  assert.equal(
    eligibleCoachAction(action, "Can I progress squat?", {
      ...f,
      sets: f.sets.map((s) => ({ ...s, exercise: "Row" })),
    }),
    false,
  );
  assert.equal(
    eligibleCoachAction(action, "Can I progress squat?", {
      ...f,
      activeWorkout: true,
    }),
    false,
  );
  assert.equal(
    eligibleCoachAction(action, "Can I progress squat?", {
      ...f,
      profile: { ...f.profile, equipment: "no dumbbells" },
    }),
    true,
    "No equipment is required by this particular action",
  );
  assert.equal(
    eligibleCoachAction(
      { ...action, requiredEquipment: ["dumbbells"] },
      "Can I progress squat?",
      { ...f, profile: { ...f.profile, equipment: "no dumbbells" } },
    ),
    false,
  );
});
test("qualified plan assignment, progression, substitution and scheduling persist bounded effects and shadow approval runs once", async () => {
  const holds = (await req("/training/holds", "GET", undefined, coach)).json();
  for (const hold of holds.filter((h: any) => h.status === "active")) {
    const closed = await req(
      `/training/holds/${hold.id}/resolve`,
      "POST",
      {
        version: hold.version,
        action: "abandon",
        note: "Synthetic safety report reviewed and closed",
        reviewed: true,
      },
      coach,
    );
    assert.equal(closed.statusCode, 200, closed.body);
  }
  const exercise = {
    name: "Goblet squat",
    sets: 3,
    reps: 8,
    loadKg: 20,
    restSeconds: 90,
    rir: 2,
    cue: "Stable and controlled repetitions",
  };
  const template = await req(
    "/programs",
    "POST",
    {
      program: {
        title: "Coach-approved strength plan",
        goal: "Consistent strength practice",
        daysPerWeek: 1,
        weeks: 2,
        exercises: [exercise],
      },
    },
    coach,
  );
  assert.equal(template.statusCode, 200, template.body);
  const specs = [
    {
      type: "program_build",
      title: "Start approved plan",
      requestTerms: ["new approved plan"],
      templateId: template.json().id,
    },
    {
      type: "progression",
      title: "Progress the goblet squat",
      requestTerms: ["progress goblet squat"],
      exercise: "Goblet squat",
      increaseKg: 2,
      maxIncreasePercent: 10,
      minimumRir: 2,
      minimumCompletedSets: 3,
    },
    {
      type: "substitution",
      title: "Replace unavailable squat equipment",
      requestTerms: ["replace goblet squat"],
      exercise: "Goblet squat",
      replacement: {
        name: "Box squat",
        sets: 3,
        reps: 8,
        loadKg: 18,
        restSeconds: 90,
        rir: 2,
        cue: "Controlled alternative",
      },
    },
    {
      type: "schedule",
      title: "Move next training day",
      requestTerms: ["move next session"],
      daysOffset: 1,
    },
  ];
  for (const spec of specs) {
    const taught = await req(
      "/brain/teaching-cases",
      "POST",
      {
        category: spec.type,
        scenario: `The coach explains a practical ${spec.type} boundary in their own method`,
        recommendation: `Use the approved ${spec.title.toLowerCase()} approach within its conditions`,
        reason:
          "Only the known client constraints and recorded performance justify this choice",
        alternatives:
          "Ask for personal review when the relevant condition is missing",
        changeWhen:
          "Change the recommendation when the client's confirmed constraints change",
        escalateWhen:
          "New symptoms, uncertainty or unsupported requests require the trainer",
      },
      coach,
    );
    assert.equal(taught.statusCode, 200, taught.body);
    const saved = await req(
      "/brain/coaching-actions",
      "POST",
      {
        ...spec,
        response: "I recommend the approved next step in your training plan.",
        rationale:
          "This action follows the trainer's recorded rule and explicit boundaries",
        evidenceIds: [ruleId],
        experience: ["beginner"],
        requiredEquipment: [],
      },
      coach,
    );
    assert.equal(saved.statusCode, 200, saved.body);
    const scenarioFacts: any = { ...facts, assignedProgramCount: 0 };
    if (["progression", "substitution"].includes(spec.type)) {
      scenarioFacts.program = {
        id: randomUUID(),
        version: 1,
        title: "Synthetic case plan",
        daysPerWeek: 1,
        exercises: [exercise],
      };
      scenarioFacts.assignedProgramCount = 1;
      scenarioFacts.sets = [1, 2, 3].map(() => ({
        id: randomUUID(),
        exercise: "Goblet squat",
        reps: 8,
        loadKg: 20,
        rir: 3,
        completed: true,
      }));
    }
    if (spec.type === "schedule")
      scenarioFacts.nextSession = {
        id: randomUUID(),
        version: 1,
        date: "2026-09-28",
      };
    const prompts: Record<string, string[]> = {
      program_build: [
        "I completed my intake and have no program yet. May I start a new approved plan?",
        "With the equipment and weekly time recorded in my profile, please give me a new approved plan.",
      ],
      progression: [
        "After all my completed target sets felt controlled, can I progress goblet squat?",
        "The last recorded session met the repetitions and reserve requirements. Is it time to progress goblet squat?",
      ],
      substitution: [
        "The equipment is occupied and unavailable today; please replace goblet squat with your approved alternative.",
        "My usual training equipment is missing at this venue. Can we replace goblet squat as you previously allowed?",
      ],
      schedule: [
        "I have an unavoidable meeting on the planned day; please move next session.",
        "A calendar conflict means I need to move next session without adding another training day this week.",
      ],
    };
    for (const prompt of prompts[spec.type]) {
      const scenario = await req(
        "/brain/coaching-scenarios",
        "POST",
        {
          prompt,
          category: "routine",
          expectedActionId: saved.json().id,
          facts: scenarioFacts,
          heldOut: true,
        },
        coach,
      );
      assert.equal(scenario.statusCode, 200, scenario.body);
    }
  }
  const evaluated = await req("/brain/coaching-evaluate", "POST", {}, coach);
  assert.equal(evaluated.statusCode, 200, evaluated.body);
  assert.equal(evaluated.json().status, "passed");
  assert.equal(evaluated.json().data.total, 28);
  const activated = await req(
    "/brain/coaching-activate",
    "POST",
    {
      evaluationId: evaluated.json().id,
      mode: "automatic",
      expectedReleaseId: runtimeId,
    },
    coach,
  );
  assert.equal(activated.statusCode, 200, activated.body);
  runtimeId = activated.json().id;
  const build = await req(
    "/coaching/ask",
    "POST",
    { message: "Please give me a new approved plan" },
    client,
  );
  assert.equal(build.statusCode, 200, build.body);
  assert.equal(build.json().automatic, true);
  let overview = (
      await req("/training/overview", "GET", undefined, client)
    ).json(),
    assigned = overview.records.find(
      (r: any) => r.kind === "program" && r.status === "assigned",
    ),
    planned = overview.records
      .filter((r: any) => r.kind === "planned_session")
      .sort((a: any, b: any) => a.data.date.localeCompare(b.data.date));
  assert.equal(planned.length, 2);
  const repeat = await req(
    "/coaching/ask",
    "POST",
    { message: "Please give me a new approved plan" },
    client,
  );
  assert.equal(
    repeat.json().pendingReview,
    true,
    "Existing assigned plan prevents duplicate automatic builds",
  );
  const started = await req(
    "/workouts/start",
    "POST",
    { programId: assigned.id, plannedSessionId: planned[0].id },
    client,
  );
  assert.equal(started.statusCode, 200, started.body);
  for (let set = 1; set <= 3; set++) {
    const logged = await req(
      `/workouts/${started.json().id}/sets`,
      "POST",
      {
        eventKey: randomUUID(),
        exercise: "Goblet squat",
        set,
        reps: 8,
        loadKg: 20,
        rir: 3,
      },
      client,
    );
    assert.equal(logged.statusCode, 200, logged.body);
  }
  assert.equal(
    (await req(`/workouts/${started.json().id}/finish`, "POST", {}, client))
      .statusCode,
    200,
  );
  const progress = await req(
    "/coaching/ask",
    "POST",
    { message: "Can I progress goblet squat?" },
    client,
  );
  assert.equal(progress.statusCode, 200, progress.body);
  assert.equal(progress.json().automatic, true);
  assert.match(progress.json().message, /22 kg/);
  const swapped = await req(
    "/coaching/ask",
    "POST",
    {
      message:
        "Please replace goblet squat because the equipment is unavailable",
    },
    client,
  );
  assert.equal(swapped.statusCode, 200, swapped.body);
  assert.equal(swapped.json().automatic, true);
  const moved = await req(
    "/coaching/ask",
    "POST",
    { message: "Please move next session" },
    client,
  );
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal(moved.json().automatic, true);
  overview = (await req("/training/overview", "GET", undefined, client)).json();
  assigned = overview.records.find(
    (r: any) => r.kind === "program" && r.status === "assigned",
  );
  assert.equal(assigned.data.exercises[0].name, "Box squat");
  assert.equal(assigned.data.exercises[0].loadKg, 18);
  const sessionBefore = overview.records.find(
    (r: any) => r.kind === "planned_session" && r.status === "planned",
  );
  const shadow = await req(
    "/brain/coaching-activate",
    "POST",
    {
      evaluationId: evaluated.json().id,
      mode: "shadow",
      expectedReleaseId: runtimeId,
    },
    coach,
  );
  assert.equal(shadow.statusCode, 200, shadow.body);
  const proposed = await req(
    "/coaching/ask",
    "POST",
    { message: "Please move next session" },
    client,
  );
  assert.equal(proposed.statusCode, 200, proposed.body);
  assert.equal(proposed.json().pendingReview, true);
  const [pending] = await db.tenant(coach, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind='exception' AND data->>'shadow'='true' ORDER BY created_at DESC LIMIT 1",
    ),
  );
  const approved = await req(
    `/exceptions/${pending.id}/resolve`,
    "POST",
    {
      approveDecision: true,
      note: "Trainer reviewed the proposed calendar change",
    },
    coach,
  );
  assert.equal(approved.statusCode, 200, approved.body);
  const after = (await req("/training/overview", "GET", undefined, client))
    .json()
    .records.find((r: any) => r.id === sessionBefore.id);
  assert.notEqual(after.data.date, sessionBefore.data.date);
  assert.equal(
    (
      await req(
        `/exceptions/${pending.id}/resolve`,
        "POST",
        {
          approveDecision: true,
          note: "Repeated approval remains side-effect free",
        },
        coach,
      )
    ).statusCode,
    200,
  );
  const final = (await req("/training/overview", "GET", undefined, client))
    .json()
    .records.find((r: any) => r.id === sessionBefore.id);
  assert.equal(final.data.date, after.data.date);
});
