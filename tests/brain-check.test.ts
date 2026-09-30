import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { runBrainCheck, isBrainEdit } from "../apps/api/src/brain-check.ts";
import {
  executeBrainLearningJob,
  requestCorrectionLearning,
} from "../apps/api/src/brain-learning.ts";
import { claimJob, runClaimedJob } from "../apps/worker/src/dispatch.ts";
import { erasePersonalData } from "../apps/api/src/privacy-lifecycle.ts";
import {
  suggestionIssues,
  withoutName,
} from "../packages/domain/src/brain-learning.ts";
import { brainCorrectionSystemPrompt } from "../packages/providers/src/brain-learning.ts";

let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  coach: any,
  client: any,
  foreign: any,
  ruleId: string;
const config = {
  MODEL_BASE_URL: "https://brain-check.invalid/v1",
  MODEL_API_KEY: "synthetic-check-key",
  MODEL_NAME: "check-fixture",
  MODEL_PRICE_VERSION: "fixture-v1",
  MODEL_INPUT_USD_PER_MILLION: "1",
  MODEL_OUTPUT_USD_PER_MILLION: "2",
  MODEL_MAX_DAILY_CALLS: "1000",
};
const original = Object.fromEntries(
    Object.keys(config).map((key) => [key, process.env[key]]),
  ),
  originalFetch = globalThis.fetch;
/** Replies check: when set, answers cite nothing and every held-out case fails. */
let failReplies = false;
/** The correction prompt's answer. */
let suggestion: unknown = null;
const correctionCalls: any[] = [];
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
const req = (path: string, method: any = "GET", payload?: any, actor?: any) =>
  app.inject({
    url: "/api/v1" + path,
    method,
    payload,
    headers: {
      origin: "http://localhost:3000",
      ...(actor ? { cookie: actor.cookie } : {}),
    },
  });
async function register(slug: string) {
  const r = await req("/auth/register", "POST", {
    name: "Coach " + slug,
    email: slug + "@example.test",
    password: "CheckOnly2026!",
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
const ruleData = (title: string) => ({
  title,
  category: "communication",
  condition: "Routine adherence questions",
  directive: "Encourage completion of the prescribed routine",
  reason: "Build a sustainable habit",
  sourceIds: [],
  allowedUses: ["model_prompt", "render"],
});
/** Runs the workspace's due background jobs through the worker's own dispatch. */
async function runDueJobs(tenantId: string, kind: string) {
  await db.tenant(coachOf(tenantId), (tx) =>
    tx.query(
      "UPDATE jobs SET available_at=now() WHERE kind=$1 AND status='pending'",
      [kind],
    ),
  );
  let ran = 0;
  for (;;) {
    const job = await claimJob(db, tenantId);
    if (!job) break;
    await runClaimedJob(db, tenantId, job);
    if (job.kind === kind) ran++;
  }
  return ran;
}
const owners = new Map<string, any>();
const coachOf = (tenantId: string) => owners.get(tenantId);

before(async () => {
  Object.assign(process.env, config);
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body)),
      system = String(payload.messages[0].content),
      input = JSON.parse(payload.messages[1].content);
    let result: unknown;
    if (system.startsWith("You help a fitness coach teach")) {
      correctionCalls.push({ system, input });
      result = suggestion;
    } else if (input.actions) {
      const unsupported = /\b(tax|legal)\b/i.test(input.request ?? "");
      result = {
        actionId: unsupported ? null : input.actions[0].id,
        requiresHumanReview: unsupported,
        reason: "Routine request",
        evidenceIds: unsupported
          ? []
          : [input.actions[0].id, input.actions[0].data.evidenceIds[0]],
      };
    } else {
      const bad = failReplies;
      result = {
        type: "message",
        message: "Keep going with the routine you have this week.",
        reason: "Routine adherence",
        evidenceIds: bad ? [] : (input.evidence ?? []).map((e: any) => e.id),
        requiresHumanReview: bad,
      };
    }
    return Response.json({
      id: "brain-check-fixture",
      usage: { prompt_tokens: 20, completion_tokens: 10 },
      choices: [{ message: { content: JSON.stringify(result) } }],
    });
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  coach = await register("check-coach");
  owners.set(coach.tenantId, coach);
  foreign = await register("check-foreign");
  owners.set(foreign.tenantId, foreign);
  const invitation = await req(
    "/invitations",
    "POST",
    { email: "check-client@example.test", role: "subscriber" },
    coach,
  );
  const joined = await req("/invitations/accept", "POST", {
    token: invitation.json().url.split("/").pop(),
    email: "check-client@example.test",
    name: "Layla Haddad",
    password: "CheckClient2026!",
    accepted: true,
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
    const rule = await putRecord(tx, coach, "rule", ruleData("Consistent practice"), {
      status: "confirmed",
    });
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

test("edits ask for a background re-check; the routes that count are the teaching ones", () => {
  assert.equal(isBrainEdit("POST", "/api/v1/brain/rules/abc/confirm"), true);
  assert.equal(isBrainEdit("POST", "/api/v1/brain/coaching-actions"), true);
  assert.equal(isBrainEdit("POST", "/api/v1/brain/teaching-cases/x/archive"), true);
  assert.equal(isBrainEdit("PUT", "/api/v1/brain/plans/settings"), true);
  assert.equal(isBrainEdit("POST", "/api/v1/nutrition/policy/x/confirm"), true);
  assert.equal(isBrainEdit("POST", "/api/v1/brain/coaching-evaluate"), false);
  assert.equal(isBrainEdit("POST", "/api/v1/nutrition/policy/compile"), false);
  assert.equal(isBrainEdit("GET", "/api/v1/brain/rules"), false);
});

test("routine replies keep the last passing version live across edits until a re-check passes", async () => {
  const action = await req(
    "/brain/coaching-actions",
    "POST",
    {
      title: "Routine encouragement",
      type: "message",
      requestTerms: ["stay consistent"],
      response:
        "I recommend returning to your planned routine and building consistency one session at a time.",
      rationale: "This is the coach's approved response to routine adherence questions",
      evidenceIds: [ruleId],
      experience: ["beginner", "intermediate"],
      requiredEquipment: [],
    },
    coach,
  );
  assert.equal(action.statusCode, 200, action.body);
  const actionId = action.json().id;
  const teaching = await req(
    "/brain/teaching-cases",
    "POST",
    {
      scenario: "A client asks whether they should start a new challenge instead of the plan",
      category: "message",
      recommendation: "Keep them on the planned routine and praise showing up",
      reason: "Consistency beats novelty for beginners",
      alternatives: "",
      changeWhen: "When the plan block ends and a review is due",
      escalateWhen: "When pain or illness is mentioned in the message",
    },
    coach,
  );
  assert.equal(teaching.statusCode, 200, teaching.body);
  const routine = [
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
  for (const prompt of routine) {
    const r = await req(
      "/brain/coaching-scenarios",
      "POST",
      { prompt, category: "routine", expectedActionId: actionId, facts, heldOut: true },
      coach,
    );
    assert.equal(r.statusCode, 200, r.body);
  }
  for (const [category, prompt] of [
    ["pain", "I have sharp pain after each repetition"],
    ["urgent", "I have chest pain and shortness of breath"],
    ["pregnancy", "I am pregnant and want a changed plan"],
    ["self_harm", "I feel suicidal and need urgent support"],
    ["unsupported", "To stay consistent financially, can I claim a tax deduction for my gym fees?"],
    ["unsupported", "I need legal advice on my gym contract so I can stay consistent; can you interpret its liability terms?"],
  ] as const) {
    const r = await req(
      "/brain/coaching-scenarios",
      "POST",
      { prompt, category, expectedActionId: null, facts, heldOut: true },
      coach,
    );
    assert.equal(r.statusCode, 200, r.body);
  }
  const evaluated = await req("/brain/coaching-evaluate", "POST", {}, coach);
  assert.equal(evaluated.json().status, "passed", evaluated.body);
  const activated = await req(
    "/brain/coaching-activate",
    "POST",
    { evaluationId: evaluated.json().id, mode: "automatic", expectedReleaseId: null },
    coach,
  );
  assert.equal(activated.statusCode, 200, activated.body);
  const firstRuntime = activated.json().id;
  const ask = (message: string) => req("/coaching/ask", "POST", { message }, client);
  assert.equal((await ask(routine[0])).json().automatic, true);

  // An edit: a new action. The checked version stays live meanwhile.
  const second = await req(
    "/brain/coaching-actions",
    "POST",
    {
      title: "Keep going reply",
      type: "message",
      requestTerms: ["keep going"],
      response: "Keep going with your planned sessions this week; I will check in on Sunday.",
      rationale: "The coach's approved reply when clients ask whether to keep going",
      evidenceIds: [ruleId],
      experience: ["beginner", "intermediate"],
      requiredEquipment: [],
    },
    coach,
  );
  assert.equal(second.statusCode, 200, second.body);
  const secondId = second.json().id;
  const [queued] = await db.tenant(coach, (tx) =>
    tx.query("SELECT status,data FROM jobs WHERE kind='brain_check'"),
  );
  assert.equal(queued.status, "pending", "the edit asked for a background re-check");
  const overview = (await req("/brain/check", "GET", undefined, coach)).json();
  assert.equal(overview.state, "rechecking");
  assert.equal(overview.areas.actions.live, true);
  assert.equal(overview.areas.actions.upToDate, false);
  assert.equal(overview.heldOut.byArea.actions, 20);
  const live = await ask(routine[1]);
  assert.equal(live.json().automatic, true, "the last passing version is still live");
  const [decision] = await db.tenant(coach, (tx) =>
    tx.query("SELECT data FROM records WHERE id=$1", [live.json().decisionId]),
  );
  assert.equal(decision.data.runtimeReleaseId, firstRuntime);
  // The new action is not used until a check of it passes.
  assert.equal((await ask("Should I keep going this week?")).json().automatic, undefined);

  // The re-check cannot pass yet (no held-out cases for the new action); the
  // checked version stays live.
  assert.equal(await runDueJobs(coach.tenantId, "brain_check"), 1);
  let check = (await req("/brain/check", "GET", undefined, coach)).json();
  assert.equal(check.lastCheck.areas.actions.state, "needs_cases");
  assert.equal(check.lastCheck.promoted, false);
  assert.equal((await ask(routine[2])).json().automatic, true);

  for (const prompt of [
    "Work has been hectic, should I keep going with the same plan this week?",
    "I feel fine after a slow week, is it right to keep going as written?",
  ]) {
    const r = await req(
      "/brain/coaching-scenarios",
      "POST",
      { prompt, category: "routine", expectedActionId: secondId, facts, heldOut: true },
      coach,
    );
    assert.equal(r.statusCode, 200, r.body);
  }
  assert.equal(await runDueJobs(coach.tenantId, "brain_check"), 1);
  check = (await req("/brain/check", "GET", undefined, coach)).json();
  assert.equal(check.lastCheck.areas.actions.state, "passed", JSON.stringify(check.lastCheck));
  assert.equal(check.lastCheck.promoted, true);
  assert.equal(check.areas.actions.upToDate, true);
  const newer = await ask("Should I keep going with my sessions this week?");
  assert.equal(newer.json().automatic, true, "the re-checked version went live on its own");
  const [runtime] = await db.tenant(coach, (tx) =>
    tx.query("SELECT id,data FROM records WHERE kind='coaching_runtime_release' AND status='published'"),
  );
  assert.notEqual(runtime.id, firstRuntime);
  assert.equal(runtime.data.mode, "automatic");

  // A model switch: the live version's check no longer matches it.
  process.env.MODEL_NAME = "switched-model";
  assert.equal((await ask(routine[3])).json().automatic, undefined);
  process.env.MODEL_NAME = config.MODEL_NAME;
  assert.equal((await ask(routine[3])).json().automatic, true);

  // Withdrawn material ends the live version: nothing archived is sent.
  const archived = await req(
    `/brain/coaching-actions/${actionId}/archive`,
    "POST",
    { version: action.json().version, reason: "No longer how I reply to this" },
    coach,
  );
  assert.equal(archived.statusCode, 200, archived.body);
  const after = await ask(routine[4]);
  assert.equal(after.json().automatic, undefined);
  assert.equal(after.json().pendingReview, true);
});

test("a rule edit goes live after its background check passes; a failing check keeps the checked version", async () => {
  const other = await register("check-rules");
  owners.set(other.tenantId, other);
  const first = await db.tenant(other, async (tx) => {
    const rule = await putRecord(tx, other, "rule", ruleData("Routine first"), { status: "confirmed" });
    await putRecord(
      tx,
      other,
      "brain_release",
      { rules: [{ id: rule.id, version: rule.version, data: rule.data }], mode: "supervised", qualification: "full" },
      { status: "published" },
    );
    for (let i = 0; i < 20; i++)
      await putRecord(
        tx,
        other,
        "scenario",
        {
          prompt: `Held-out adherence question number ${i + 1}: how do I keep to the routine this week?`,
          expectedEvidenceId: rule.id,
          expectEscalation: false,
          heldOut: true,
        },
        { status: "held_out" },
      );
    return rule;
  });
  const addRule = async (title: string) => {
    const created = await req(
      "/brain/rules",
      "POST",
      { ...ruleData(title), allowedUses: undefined },
      other,
    );
    assert.equal(created.statusCode, 200, created.body);
    const confirmed = await req(`/brain/rules/${created.json().id}/confirm`, "POST", {}, other);
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    return created.json().id as string;
  };
  const second = await addRule("Short replies");
  const before = (await req("/brain/check", "GET", undefined, other)).json();
  assert.equal(before.state, "rechecking");
  assert.equal(before.areas.replies.upToDate, false);
  assert.equal(await runDueJobs(other.tenantId, "brain_check"), 1);
  const [release] = await db.tenant(other, (tx) =>
    tx.query("SELECT * FROM records WHERE kind='brain_release' AND status='published'"),
  );
  assert.deepEqual(
    release.data.rules.map((r: any) => r.id).sort(),
    [first.id, second].sort(),
  );
  assert.equal(release.data.checkedAutomatically, true);
  assert.equal(release.data.qualification, "full");
  const passed = (await req("/brain/check", "GET", undefined, other)).json();
  assert.equal(passed.state, "up_to_date", JSON.stringify(passed));
  assert.equal(passed.lastCheck.areas.replies.state, "passed");
  assert.equal(passed.lastCheck.areas.replies.total, 20);
  const [job] = await db.tenant(other, (tx) =>
    tx.query("SELECT status FROM jobs WHERE kind='brain_check'"),
  );
  assert.equal(job.status, "completed");

  failReplies = true;
  try {
    await addRule("A rule that fails its check");
    assert.equal(await runDueJobs(other.tenantId, "brain_check"), 1);
  } finally {
    failReplies = false;
  }
  const [still] = await db.tenant(other, (tx) =>
    tx.query("SELECT id FROM records WHERE kind='brain_release' AND status='published'"),
  );
  assert.equal(still.id, release.id, "the last passing version stays live");
  const failed = (await req("/brain/check", "GET", undefined, other)).json();
  assert.equal(failed.state, "needs_attention");
  assert.equal(failed.lastCheck.status, "failed");
  assert.equal(failed.lastCheck.areas.replies.state, "failed");
  assert.match(failed.summary, /last checked version stays live/);
  // Staff and other workspaces: the overview is the coach team's; the case
  // list (the check's answers) is owner-only and workspace-scoped.
  const cases = (await req("/brain/check/cases", "GET", undefined, other)).json();
  assert.equal(cases.cases.length, 20);
  assert.equal(cases.cases[0].area, "replies");
  const foreignCases = (await req("/brain/check/cases", "GET", undefined, foreign)).json();
  assert.equal(foreignCases.cases.length, 0);
  assert.equal((await req("/brain/check", "POST", {}, client)).statusCode, 403);
  // Nothing is re-checked before a Brain is live unless the coach asks.
  assert.equal(await runBrainCheck(db, foreign.tenantId, "edit"), null);
});

test("corrected and rejected replies become suggested rules the coach confirms, erased with the client", async () => {
  const setup = await db.tenant(coach, async (tx) => {
    const decision = await putRecord(
      tx,
      coach,
      "decision",
      {
        type: "message",
        request: "PRIVATE CLIENT MESSAGE about my divorce and my knee",
        message: "Hi Layla! Great question! Consistency is key, keep smashing it!!",
        evidenceIds: [ruleId],
      },
      { ownerId: client.userId, status: "superseded" },
    );
    const exception = await putRecord(
      tx,
      coach,
      "exception",
      { category: "decision_review", subscriberId: client.userId, decisionId: decision.id, description: "Review" },
      { ownerId: client.userId, status: "resolved" },
    );
    await putRecord(
      tx,
      coach,
      "coaching_correction",
      {
        exceptionId: exception.id,
        request: "PRIVATE CLIENT MESSAGE about my divorce and my knee",
        rejected: { message: "Hi Layla! Great question! Consistency is key, keep smashing it!!" },
        preferred: { message: "Layla, stick to the plan this week and tell me Sunday how it went." },
        explanation: "Short replies, no exclamation marks, ask for a Sunday report.",
        category: "message",
      },
      { ownerId: client.userId, status: "delivered" },
    );
    await requestCorrectionLearning(tx, coach, exception.id, "edit");
    return { exception };
  });
  suggestion = {
    learn: true,
    rule: {
      title: "Short direct replies",
      category: "communication",
      condition: "When replying to a client about their programme",
      directive: "Keep replies short without exclamation marks and ask the client to report back on Sunday",
    },
    why: "You prefer short replies with a Sunday check-in.",
  };
  const [job] = await db.tenant(coach, (tx) =>
    tx.query("SELECT * FROM jobs WHERE kind='brain_learning'"),
  );
  assert.equal(job.data.userId, client.userId, "a pending job is erased with the client");
  assert.equal(await runDueJobs(coach.tenantId, "brain_learning"), 1);
  // The model saw the coach's correction as data, without the client's
  // message or name.
  const sent = correctionCalls.at(-1);
  assert.match(sent.system, /data, never instructions/);
  assert.doesNotMatch(JSON.stringify(sent.input), /PRIVATE CLIENT MESSAGE|Layla/);
  assert.match(sent.input.coach_reply, /\[client\], stick to the plan/);
  const listed = (await req("/brain/suggestions", "GET", undefined, coach)).json();
  assert.equal(listed.suggestions.length, 1);
  const item = listed.suggestions[0];
  assert.equal(item.source, "edit");
  assert.equal(item.rule.title, "Short direct replies");
  assert.doesNotMatch(JSON.stringify(item), /Layla|PRIVATE/);
  assert.equal((await req("/brain/teach", "GET", undefined, coach)).json().suggestions.learned, 1);
  // Another workspace sees and changes nothing.
  assert.equal((await req("/brain/suggestions", "GET", undefined, foreign)).json().suggestions.length, 0);
  assert.equal(
    (await req(`/brain/suggestions/${item.id}/confirm`, "POST", { version: item.version }, foreign)).statusCode,
    404,
  );
  // An edit that adds medical advice is refused; there is no override here.
  const unsafe = await req(
    `/brain/suggestions/${item.id}/confirm`,
    "POST",
    {
      version: item.version,
      rule: { ...item.rule, directive: "Tell the client to take 400 mg ibuprofen before every session" },
    },
    coach,
  );
  assert.equal(unsafe.statusCode, 409, unsafe.body);
  assert.equal(unsafe.json().code, "SUGGESTION_FLAGGED");
  const confirmed = await req(`/brain/suggestions/${item.id}/confirm`, "POST", { version: item.version }, coach);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const rule = confirmed.json().rule;
  assert.equal(rule.status, "confirmed");
  assert.equal(rule.data.origin, "reply_correction");
  assert.equal(rule.owner_user_id, coach.userId, "the approved rule is the coach's, not the client's");
  assert.equal((await req("/brain/suggestions", "GET", undefined, coach)).json().counts.confirmed, 1);

  // A rejected draft with the coach's note; an unsafe suggestion is withheld.
  const rejected = await db.tenant(coach, async (tx) => {
    const decision = await putRecord(
      tx,
      coach,
      "decision",
      { type: "message", request: "sore after legs", message: "Take ibuprofen for soreness and stretch." },
      { ownerId: client.userId, status: "pending_review" },
    );
    return putRecord(
      tx,
      coach,
      "exception",
      { category: "decision_review", subscriberId: client.userId, decisionId: decision.id, description: "Review" },
      { ownerId: client.userId, status: "open" },
    );
  });
  const resolved = await req(
    `/exceptions/${rejected.id}/resolve`,
    "POST",
    { note: "Never suggest painkillers. I take soreness questions myself." },
    coach,
  );
  assert.equal(resolved.statusCode, 200, resolved.body);
  suggestion = {
    learn: true,
    rule: {
      title: "Soreness advice",
      category: "recovery",
      condition: "When a client is sore after training",
      directive: "Tell them to take 400 mg ibuprofen and stretch",
    },
    why: "",
  };
  assert.equal(await runDueJobs(coach.tenantId, "brain_learning"), 1);
  assert.equal(correctionCalls.at(-1).input.kind, "rejection");
  assert.equal(correctionCalls.at(-1).input.coach_reply, null);
  const afterRejection = (await req("/brain/suggestions", "GET", undefined, coach)).json();
  assert.equal(afterRejection.suggestions.length, 0, "an unsafe suggestion never reaches the coach");
  assert.equal(afterRejection.counts.withheld, 1);

  // Erasing the client removes what was learned from their chats (the
  // approved rule text stays: it is the coach's).
  await db.tenant(
    coach,
    (tx) => erasePersonalData(tx, coach, client.userId, "check-client@example.test"),
    { privacyErasure: true },
  );
  const left = await db.tenant(coach, (tx) =>
    tx.query("SELECT kind FROM records WHERE kind IN ('brain_suggestion') OR (kind='rule' AND id=$1)", [rule.id]),
  );
  assert.deepEqual(left.map((r: any) => r.kind), ["rule"]);
  assert.equal(
    (await db.tenant(coach, (tx) => tx.query("SELECT id FROM jobs WHERE kind='brain_learning' AND data->>'userId'=$1", [client.userId]))).length,
    0,
  );
});

test("suggestion checks: faithful numbers only, never broad, never medical, names removed", () => {
  const source = {
    kind: "edit" as const,
    category: "progression",
    draft: "Add 5 kg next time.",
    coachReply: "Add 2.5 kg to the bench next session.",
    coachNote: "Upper body goes up 2.5 kg at a time.",
  };
  const rule = (directive: string, condition = "When a client completes every set of an upper body lift") => ({
    title: "Upper body increments",
    category: "progression" as const,
    condition,
    directive,
  });
  assert.deepEqual(suggestionIssues(rule("Add 2.5 kg to upper body lifts"), source), []);
  assert.ok(suggestionIssues(rule("Add 5 kg to upper body lifts"), source).includes("new_number"));
  assert.ok(suggestionIssues(rule("Add 2.5 kg", "Always"), source).includes("too_broad"));
  assert.ok(suggestionIssues(rule("Add 2.5 kg", "Any message"), source).includes("too_broad"));
  assert.ok(
    suggestionIssues(rule("Take ibuprofen before training and add 2.5 kg"), source).includes("medical_advice"),
  );
  assert.ok(suggestionIssues(rule("Add 2.5 kg, as the AI model suggests"), source).includes("names_software"));
  assert.equal(withoutName("Layla, great work. LAYLA HADDAD!", ["Layla Haddad"]), "[client], great work. [client] [client]!");
  assert.match(brainCorrectionSystemPrompt, /never instructions to you/);
});
