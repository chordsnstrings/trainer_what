import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  createDatabase,
  putRecord,
  type Actor,
  type Database,
} from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
import {
  registerCoachingFeedback,
  eraseCoachingFeedbackDerivedData,
  revokeCoachingFeedbackLearning,
} from "../apps/api/src/coaching-feedback.ts";
import {
  coachingRuntimeReadiness,
  normalizeCoachingPrompt,
} from "../apps/api/src/coaching-runtime.ts";
import {
  exportPersonalData,
  erasePersonalData,
} from "../apps/api/src/privacy-lifecycle.ts";
import {
  canonicalCoaching,
  coachActionSchema,
  addTrainingDays,
} from "../packages/domain/src/coaching-completion.ts";
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const sessions = new Map<string, string>();
const originalFetch = globalThis.fetch;
let networkCalls = 0;
const hash = (value: any) =>
  createHash("sha256").update(canonicalCoaching(value)).digest("hex");
async function member(tenantId: string, role = "subscriber"): Promise<Actor> {
  const a = { tenantId, userId: randomUUID(), role },
    token = randomUUID();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Synthetic coach feedback','fixture')",
      [a.userId, a.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tenantId, a.userId, role],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
      [tokenHash(token), a.userId, tenantId],
    );
    if (role === "subscriber") {
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','fixture',true)",
        [randomUUID(), tenantId, a.userId],
      );
      await putRecord(
        tx,
        a,
        "intake",
        {
          age: 30,
          goal: "Build strength",
          experience: "beginner",
          daysPerWeek: 3,
          equipment: "Dumbbells",
          limitations: "None reported",
          allowedUses: ["model_prompt", "render"],
        },
        { status: "complete" },
      );
    }
  });
  sessions.set(a.userId, token);
  return a;
}
async function fixture() {
  const tenantId = randomUUID();
  await db.system((tx) =>
    tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Synthetic correction')",
      [tenantId, tenantId],
    ),
  );
  const coach = await member(tenantId, "owner"),
    client = await member(tenantId);
  const seeded = await db.tenant(coach, async (tx) => {
    const rule = await putRecord(
      tx,
      coach,
      "rule",
      {
        title: "Plan around the client",
        category: "communication",
        condition: "Routine scheduling requests",
        directive: "Use suitable available days",
        reason: "Consistency without rushed sessions",
        allowedUses: ["model_prompt", "render"],
      },
      { status: "confirmed" },
    );
    const brain = await putRecord(
      tx,
      coach,
      "brain_release",
      {
        rules: [{ id: rule.id, version: rule.version, data: rule.data }],
        mode: "supervised",
      },
      { status: "published" },
    );
    const date = addTrainingDays(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Dubai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      2,
    );
    const session = await putRecord(
      tx,
      coach,
      "planned_session",
      { date, title: "Strength session" },
      { ownerId: client.userId, status: "planned" },
    );
    const action = await putRecord(
      tx,
      coach,
      "coaching_action",
      {
        ...coachActionSchema.parse({
          title: "Move one day later",
          type: "schedule",
          requestTerms: ["move session"],
          response: "I have moved your session one day later.",
          rationale: "Use the next free training day for a full session.",
          evidenceIds: [rule.id],
          experience: ["beginner"],
          daysOffset: 1,
        }),
        confirmedAt: new Date().toISOString(),
        allowedUses: ["model_prompt", "trainer_specific_learning", "render"],
      },
      { status: "confirmed" },
    );
    const state = await coachingRuntimeReadiness(tx);
    const runtime = await putRecord(
      tx,
      coach,
      "coaching_runtime_release",
      {
        brainId: brain.id,
        contractDigest: state.contractDigest,
        mode: "shadow",
        contract: { examples: [] },
      },
      { status: "published" },
    );
    const original = await putRecord(
      tx,
      coach,
      "decision",
      {
        type: "message",
        request: "Please move session",
        message: "Keep the original training day.",
        reason: "Initial synthetic proposal",
        confidence: 0.61,
        brainVersionId: brain.id,
        requiresHumanReview: true,
      },
      { ownerId: client.userId, status: "pending_review" },
    );
    const exception = await putRecord(
      tx,
      coach,
      "exception",
      {
        category: "decision_review",
        decisionId: original.id,
        subscriberId: client.userId,
        description: "Review scheduling judgment",
      },
      { ownerId: client.userId, status: "open" },
    );
    return { brain, session, action, runtime, original, exception };
  });
  return { coach, client, ...seeded };
}
function req(
  a: Actor | null,
  path: string,
  method: any = "GET",
  payload?: any,
) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    payload,
    headers: {
      origin: "http://localhost:3000",
      ...(a ? { cookie: "session=" + sessions.get(a.userId) } : {}),
    },
  });
}
async function stored(a: Actor, id: string) {
  return (
    await db.tenant(a, (tx) =>
      tx.query("SELECT * FROM records WHERE id=$1", [id]),
    )
  )[0];
}
async function context(f: Awaited<ReturnType<typeof fixture>>) {
  const r = await req(f.coach, `/exceptions/${f.exception.id}/correction`);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function body(
  f: Awaited<ReturnType<typeof fixture>>,
  extra: Record<string, unknown> = {},
) {
  const c = await context(f);
  return {
    requestKey: randomUUID(),
    exceptionVersion: c.exception.version,
    decisionVersion: c.original.version,
    contextToken: c.context.contextToken,
    actionId: null as string | null,
    message: "Choose the day that fits your available time.",
    explanation: "The client needs room for their changed work schedule.",
    reviewed: true,
    ...extra,
  };
}
async function correct(
  f: Awaited<ReturnType<typeof fixture>>,
  extra: Record<string, unknown> = {},
) {
  const b = await body(f, extra),
    r = await req(
      f.coach,
      `/exceptions/${f.exception.id}/corrections`,
      "POST",
      b,
    );
  assert.equal(r.statusCode, 200, r.body);
  return { result: r.json(), body: b };
}
const teaching = {
  category: "message",
  scenario:
    "A recreational lifter has recurring work conflicts with a weekly training slot.",
  recommendation:
    "Agree a reliable free day without reducing the recovery interval.",
  reason:
    "A predictable available slot supports consistent completed training.",
  alternatives: "Keep the session when the conflict is a one-off event.",
  changeWhen:
    "Keep the existing plan when the alternative day is already occupied.",
  escalateWhen:
    "Escalate when pain, unusual symptoms or unsafe recovery are reported.",
};
async function teach(
  f: Awaited<ReturnType<typeof fixture>>,
  result: any,
  value = teaching,
) {
  const saved = await req(
    f.coach,
    `/coaching/feedback/${result.correction.id}/teaching-draft`,
    "POST",
    { version: result.draft.version, teaching: value },
  );
  assert.equal(saved.statusCode, 200, saved.body);
  const confirmed = await req(
    f.coach,
    `/coaching/feedback/${result.correction.id}/confirm-teaching`,
    "POST",
    {
      version: saved.json().version,
      reviewed: true,
      clientDetailsRemoved: true,
    },
  );
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  return confirmed.json();
}
before(async () => {
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Correction fixtures must not call providers");
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  if (!app.hasRoute({ method: "GET", url: "/api/v1/coaching/feedback" }))
    registerCoachingFeedback(app, db);
  await app.ready();
});
after(async () => {
  globalThis.fetch = originalFetch;
  await app?.close();
  await db?.close();
  assert.equal(networkCalls, 0);
});

test("cosmetic correction keeps the original decision immutable, captures both decisions and leaves learning as a private draft", async () => {
  const f = await fixture(),
    before = await stored(f.coach, f.original.id);
  const { result } = await correct(f, {
    message: "KEEP the original training day!",
    explanation: "",
  });
  assert.deepEqual(await stored(f.coach, f.original.id), before);
  const c = result.correction;
  assert.equal(c.data.learningValue, "cosmetic");
  assert.equal(c.data.explanation, null);
  assert.equal(c.data.confidenceBeforeCorrection, 0.61);
  assert.equal(c.data.rejected.message, before.data.message);
  assert.ok(c.data.contextSnapshot.clientSnapshotId);
  assert.ok(c.data.contextSnapshot.factsDigest);
  assert.deepEqual(
    c.data.semanticDiff.map((d: any) => d.field),
    ["message"],
  );
  assert.equal(result.draft.status, "draft");
  const message = await stored(f.coach, c.data.delivery.messageId);
  assert.equal(message.data.text, "KEEP the original training day!");
  assert.equal(message.data.author, "trainer_reviewed");
  assert.equal((await stored(f.coach, f.runtime.id)).status, "published");
  assert.equal(
    (
      await db.tenant(f.coach, (tx) =>
        tx.query("SELECT id FROM records WHERE kind='coaching_teaching'"),
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await db.tenant(f.client, (tx) =>
        tx.query(
          "SELECT id FROM records WHERE kind IN ('coaching_correction','coaching_teaching_draft')",
        ),
      )
    ).length,
    0,
  );
});

test("qualified correction uses guarded action execution once across retries and competing reviewers", async () => {
  const f = await fixture(),
    b = await body(f, {
      actionId: f.action.id,
      message: "Your session is moved to the next free day.",
    });
  const before = await stored(f.coach, f.original.id);
  const responses = await Promise.all([
    req(f.coach, `/exceptions/${f.exception.id}/corrections`, "POST", b),
    req(f.coach, `/exceptions/${f.exception.id}/corrections`, "POST", b),
  ]);
  responses.forEach((r) => assert.equal(r.statusCode, 200, r.body));
  assert.equal(
    responses[0].json().correction.id,
    responses[1].json().correction.id,
  );
  const planned = await stored(f.coach, f.session.id);
  assert.equal(planned.data.date, addTrainingDays(f.session.data.date, 1));
  assert.equal(planned.version, 2);
  assert.deepEqual(await stored(f.coach, f.original.id), before);
  const changed = await req(
    f.coach,
    `/exceptions/${f.exception.id}/corrections`,
    "POST",
    { ...b, message: "A different response now." },
  );
  assert.equal(changed.statusCode, 409);
  const competing = await req(
    f.coach,
    `/exceptions/${f.exception.id}/corrections`,
    "POST",
    { ...b, requestKey: randomUUID() },
  );
  assert.equal(competing.statusCode, 409);
  const legacy = await req(
    f.coach,
    `/exceptions/${f.exception.id}/resolve`,
    "POST",
    { note: "Late original approval", approveDecision: true },
  );
  assert.equal(legacy.statusCode, 200);
  assert.equal((await stored(f.coach, f.session.id)).version, 2);
});

test("meaningful changes require explanation and reject stale context, held training, revoked permission and unqualified actions", async () => {
  for (const change of ["reason", "context", "hold", "consent", "action"]) {
    const f = await fixture(),
      b = await body(f);
    if (change === "reason") b.explanation = "";
    if (change === "context")
      await db.tenant(f.coach, (tx) =>
        tx.query(
          'UPDATE records SET version=version+1,data=data||\'{"date":"2099-01-01"}\'::jsonb WHERE id=$1',
          [f.session.id],
        ),
      );
    if (change === "hold")
      await db.tenant(f.coach, (tx) =>
        putRecord(
          tx,
          f.coach,
          "training_hold",
          { reason: "New safety report" },
          { ownerId: f.client.userId, status: "active" },
        ),
      );
    if (change === "consent")
      await db.tenant(f.coach, (tx) =>
        tx.query(
          "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','fixture',false)",
          [randomUUID(), f.coach.tenantId, f.client.userId],
        ),
      );
    if (change === "action") b.actionId = randomUUID();
    const r = await req(
      f.coach,
      `/exceptions/${f.exception.id}/corrections`,
      "POST",
      b,
    );
    assert.equal(
      r.statusCode,
      change === "reason" ? 400 : 409,
      change + ": " + r.body,
    );
    assert.equal((await stored(f.coach, f.exception.id)).status, "open");
    assert.equal(
      (
        await db.tenant(f.coach, (tx) =>
          tx.query(
            "SELECT id FROM records WHERE kind IN ('coaching_correction','coaching_teaching_draft')",
          ),
        )
      ).length,
      0,
    );
  }
});

test("correction APIs enforce tenant and role isolation; staff can draft but only current owners confirm teaching", async () => {
  const f = await fixture(),
    other = await fixture(),
    staff = await member(f.coach.tenantId, "staff"),
    finance = await member(f.coach.tenantId, "finance");
  const path = `/exceptions/${f.exception.id}/correction`;
  for (const [a, code] of [
    [null, 401],
    [f.client, 403],
    [finance, 403],
    [other.coach, 404],
  ] as const)
    assert.equal((await req(a, path)).statusCode, code);
  const { result } = await correct(f);
  assert.equal(
    (await req(other.coach, `/coaching/feedback/${result.correction.id}`))
      .statusCode,
    404,
  );
  assert.equal((await req(finance, "/coaching/feedback")).statusCode, 403);
  const draft = await req(
    staff,
    `/coaching/feedback/${result.correction.id}/teaching-draft`,
    "POST",
    { version: result.draft.version, teaching },
  );
  assert.equal(draft.statusCode, 200, draft.body);
  const confirmation = await req(
    staff,
    `/coaching/feedback/${result.correction.id}/confirm-teaching`,
    "POST",
    {
      version: draft.json().version,
      reviewed: true,
      clientDetailsRemoved: true,
    },
  );
  assert.equal(confirmation.statusCode, 403);
  const staffView = await req(
    staff,
    `/coaching/feedback/${result.correction.id}`,
  );
  assert.equal(staffView.json().regression, null);
});

test("teaching drafts require explicit current-version review, reuse held-out exclusion and change readiness without activating a release", async () => {
  const f = await fixture(),
    { result } = await correct(f);
  const scenario =
    "A new lifter has an unusually busy shift pattern and needs to move a planned session.";
  await db.tenant(f.coach, (tx) =>
    putRecord(
      tx,
      f.coach,
      "coaching_scenario",
      {
        prompt: scenario,
        normalizedPrompt: normalizeCoachingPrompt(scenario),
        category: "routine",
        expectedActionId: f.action.id,
      },
      { status: "held_out" },
    ),
  );
  let save = await req(
    f.coach,
    `/coaching/feedback/${result.correction.id}/teaching-draft`,
    "POST",
    { version: 1, teaching: { ...teaching, scenario } },
  );
  assert.equal(save.statusCode, 200, save.body);
  const stale = await req(
    f.coach,
    `/coaching/feedback/${result.correction.id}/confirm-teaching`,
    "POST",
    { version: 1, reviewed: true, clientDetailsRemoved: true },
  );
  assert.equal(stale.statusCode, 409);
  const missing = await req(
    f.coach,
    `/coaching/feedback/${result.correction.id}/confirm-teaching`,
    "POST",
    { version: 2, reviewed: true },
  );
  assert.equal(missing.statusCode, 400);
  const contaminated = await req(
    f.coach,
    `/coaching/feedback/${result.correction.id}/confirm-teaching`,
    "POST",
    { version: 2, reviewed: true, clientDetailsRemoved: true },
  );
  assert.equal(contaminated.statusCode, 409);
  assert.match(contaminated.body, /held out/);
  const confirmed = await teach(f, { ...result, draft: save.json() });
  assert.equal(confirmed.draft.status, "confirmed");
  assert.equal(confirmed.regression.state, "independent_check_required");
  const teachingRow = await stored(f.coach, confirmed.draft.data.teachingId);
  assert.equal(teachingRow.owner_user_id, f.client.userId);
  assert.equal(
    (await db.tenant(f.coach, (tx) => coachingRuntimeReadiness(tx))).current,
    false,
  );
  assert.equal((await stored(f.coach, f.runtime.id)).status, "published");
  const duplicate = await req(
    f.coach,
    `/coaching/feedback/${result.correction.id}/confirm-teaching`,
    "POST",
    {
      version: confirmed.draft.version,
      reviewed: true,
      clientDetailsRemoved: true,
    },
  );
  assert.equal(duplicate.statusCode, 409);
});

test("regression links only independent held-out records, hides prompts, and requires current passing evidence", async () => {
  const f = await fixture(),
    { result } = await correct(f),
    confirmed = await teach(f, result);
  const seeded = await db.tenant(f.coach, async (tx) => {
    const independent = await putRecord(
      tx,
      f.coach,
      "coaching_scenario",
      {
        prompt:
          "PRIVATE HELD OUT PROMPT: assess a travel itinerary with multiple short training slots.",
        normalizedPrompt: normalizeCoachingPrompt(
          "Assess a travel itinerary with multiple short training slots",
        ),
        category: "routine",
        expectedActionId: f.action.id,
      },
      { status: "held_out" },
    );
    const overlap = await putRecord(
      tx,
      f.coach,
      "coaching_scenario",
      {
        prompt: teaching.scenario,
        normalizedPrompt: normalizeCoachingPrompt(teaching.scenario),
        category: "routine",
        expectedActionId: f.action.id,
      },
      { status: "held_out" },
    );
    return { independent, overlap };
  });
  const linkPath = `/coaching/feedback/${result.correction.id}/regression`;
  const overlap = await req(f.coach, linkPath, "POST", {
    version: confirmed.draft.version,
    scenarioIds: [seeded.overlap.id],
    independent: true,
  });
  assert.equal(overlap.statusCode, 409);
  const linked = await req(f.coach, linkPath, "POST", {
    version: confirmed.draft.version,
    scenarioIds: [seeded.independent.id],
    independent: true,
  });
  assert.equal(linked.statusCode, 200, linked.body);
  assert.equal(linked.json().regression.ready, false);
  assert.doesNotMatch(
    linked.body,
    /PRIVATE HELD OUT PROMPT|travel itinerary|normalizedPrompt/,
  );
  await db.tenant(f.coach, async (tx) => {
    const state = await coachingRuntimeReadiness(tx),
      scenarios = await tx.query(
        "SELECT * FROM records WHERE kind='coaching_scenario' AND status='held_out' ORDER BY id",
      );
    await putRecord(
      tx,
      f.coach,
      "coaching_evaluation",
      {
        contractDigest: state.contractDigest,
        scenariosDigest: hash(
          scenarios.map((s) => ({ id: s.id, data: s.data })),
        ),
        outcomes: scenarios.map((s) => ({ scenarioId: s.id, passed: true })),
      },
      { status: "passed" },
    );
  });
  const ready = await req(
    f.coach,
    `/coaching/feedback/${result.correction.id}`,
  );
  assert.equal(ready.json().regression.ready, true, ready.body);
  await db.tenant(f.coach, (tx) =>
    tx.query(
      "UPDATE records SET status='archived',version=version+1 WHERE id=$1",
      [f.action.id],
    ),
  );
  const stale = await req(
    f.coach,
    `/coaching/feedback/${result.correction.id}`,
  );
  assert.equal(stale.json().regression.ready, false);
  assert.equal(stale.json().regression.state, "evaluation_required");
  assert.equal((await stored(f.coach, f.runtime.id)).data.mode, "shadow");
});

test("outcome references stay with the corrected client and personal erasure removes copied teaching from release snapshots", async () => {
  const f = await fixture(),
    other = await fixture(),
    { result } = await correct(f),
    confirmed = await teach(f, result);
  const same = await db.tenant(f.coach, (tx) =>
    putRecord(
      tx,
      f.coach,
      "progress_measurement",
      { weightKg: 75 },
      { ownerId: f.client.userId, status: "recorded" },
    ),
  );
  const otherClient = await member(f.coach.tenantId);
  const wrong = await db.tenant(f.coach, (tx) =>
    putRecord(
      tx,
      f.coach,
      "workout",
      { title: "Other client workout" },
      { ownerId: otherClient.userId, status: "completed" },
    ),
  );
  const path = `/coaching/feedback/${result.correction.id}/outcomes`;
  assert.equal(
    (
      await req(f.coach, path, "POST", {
        recordIds: [wrong.id],
        note: "Wrong client",
      })
    ).statusCode,
    400,
  );
  const linked = await req(f.coach, path, "POST", {
    recordIds: [same.id],
    note: "The revised schedule was sustainable.",
  });
  assert.equal(linked.statusCode, 200, linked.body);
  const teachingRow = await stored(f.coach, confirmed.draft.data.teachingId);
  await db.tenant(f.coach, (tx) =>
    tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [
      f.runtime.id,
      JSON.stringify({
        contract: {
          examples: [
            { id: teachingRow.id, data: teachingRow.data },
            { id: randomUUID(), data: { scenario: "Unrelated coach example" } },
          ],
        },
      }),
    ]),
  );
  const exported = await exportPersonalData(db, f.client);
  for (const kind of [
    "coaching_correction",
    "coaching_teaching_draft",
    "coaching_teaching",
    "coaching_feedback_outcome",
  ])
    assert.ok(
      exported.records.some((r) => r.kind === kind),
      kind,
    );
  await db.tenant(f.coach, (tx) =>
    erasePersonalData(
      tx,
      f.coach,
      f.client.userId,
      f.client.userId + "@example.test",
      { eraseAdditional: eraseCoachingFeedbackDerivedData },
    ),
  );
  assert.equal(
    (
      await db.tenant(f.coach, (tx) =>
        tx.query("SELECT id FROM records WHERE owner_user_id=$1", [
          f.client.userId,
        ]),
      )
    ).length,
    0,
  );
  const release = await stored(f.coach, f.runtime.id);
  assert.equal(release.status, "privacy_archived");
  assert.equal(release.data.contract.examples.length, 1);
  assert.equal(
    release.data.contract.examples[0].data.scenario,
    "Unrelated coach example",
  );
  assert.ok(await stored(other.coach, other.original.id));
  assert.ok(await stored(f.coach, wrong.id));
});

test("withdrawing coaching permission removes derived teaching from the active material and does not auto-restore it", async () => {
  const f = await fixture(),
    { result } = await correct(f),
    confirmed = await teach(f, result);
  const before = await db.tenant(f.coach, (tx) => coachingRuntimeReadiness(tx));
  await db.tenant(f.coach, (tx) =>
    revokeCoachingFeedbackLearning(tx, f.client.userId),
  );
  const row = await stored(f.coach, confirmed.draft.data.teachingId);
  assert.equal(row.status, "permission_revoked");
  assert.deepEqual(row.data.allowedUses, []);
  const after = await db.tenant(f.coach, (tx) => coachingRuntimeReadiness(tx));
  assert.notEqual(before.contractDigest, after.contractDigest);
  const details = await req(
    f.coach,
    `/coaching/feedback/${result.correction.id}`,
  );
  assert.equal(details.json().regression.ready, false);
  assert.equal(details.json().regression.state, "teaching_required");
});
