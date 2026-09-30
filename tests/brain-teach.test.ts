import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import {
  brainTrainingMeter,
  BRAIN_LEVELS,
  PLATFORM_SAFETY_CASES,
  platformSafetyCasesFor,
  quizCaseIssues,
} from "../packages/domain/src/brain-teach.ts";
import {
  effectiveSafetyPolicy,
  screenSafety,
} from "../packages/domain/src/safety-policy.ts";
import { buildApp } from "../apps/api/src/app.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const request = (url: string, method: any = "GET", body?: any, actor?: any) =>
  app.inject({
    url: "/api/v1" + url,
    method,
    headers: {
      origin: "http://localhost:3000",
      ...(actor ? { cookie: actor.cookie } : {}),
    },
    payload: body,
  });
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
const modelConfig = {
  MODEL_BASE_URL: "https://brain-teach.invalid/v1",
  MODEL_API_KEY: "fixture-only",
  MODEL_NAME: "fixture-coach",
  MODEL_MAX_DAILY_CALLS: "1000",
};
type Sent = { system: string; user: any };
/** A synthetic model: practice questions, or draft rules from teaching. */
async function withModel<T>(
  quizCases: (user: any) => unknown[],
  fn: (sent: Sent[]) => Promise<T>,
) {
  const previous = Object.fromEntries(
      Object.keys(modelConfig).map((key) => [key, process.env[key]]),
    ),
    originalFetch = globalThis.fetch,
    sent: Sent[] = [];
  Object.assign(process.env, modelConfig);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const system = String(body.messages[0].content),
      user = JSON.parse(body.messages[1].content);
    sent.push({ system, user });
    const content = system.startsWith("You write practice questions")
      ? { cases: quizCases(user) }
      : {
          rules: [
            {
              title: "Deload after a hard week",
              category: "recovery",
              condition: "A client reports a very hard training week",
              directive: "Keep the next session light and focus on technique",
              reason: "Taught by the coach",
              sourceIds: [user[0].id],
            },
          ],
          conflicts: [],
        };
    return Response.json({
      id: "brain-teach-fixture",
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      choices: [{ message: { content: JSON.stringify(content) } }],
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
const goodCases = (user: any) => [
  {
    ruleId: user.rules[0].id,
    message: "I finished all my sets today with good form. What next?",
    route: "reply",
    reply: "Great work. Add a little weight next session and keep the rest the same.",
  },
  {
    ruleId: user.rules[0].id,
    message: "Every set of my bench felt easy this week, should I change anything?",
    route: "reply",
    reply: "Nice job. Add a little weight to your bench next session.",
  },
  {
    ruleId: user.rules[0].id,
    message: "Can I switch my whole programme to a new split next month?",
    route: "escalate",
    reply: "Thanks for asking. Your coach will reply to you personally.",
  },
  {
    ruleId: user.rules[user.rules.length - 1].id,
    message: "My training partner says I should add weight every session. Is that right for me?",
    route: "reply",
    reply: "Only add a little weight when every set is clean, and keep the rest the same.",
  },
  // Unsafe: a symptom answered instead of handed over; dropped by the checks.
  {
    ruleId: user.rules[0].id,
    message: "I had chest pain on my last set, can I add weight anyway?",
    route: "reply",
    reply: "Yes, add a little weight next session.",
  },
  // Unknown reference; dropped.
  {
    ruleId: "R99",
    message: "What should I do about my squats this week?",
    route: "reply",
    reply: "Keep your squats the same this week.",
  },
];

before(async () => {
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
});
after(async () => {
  await app?.close();
  await db?.close();
});

const floor = effectiveSafetyPolicy(null);
const needsCoach = (t: string) => {
  const s = screenSafety(t, floor);
  return s.hold || s.review;
};

test("meter formula and levels", () => {
  const empty = brainTrainingMeter({
    confirmedRules: 0,
    draftRules: 0,
    flaggedDraftRules: 0,
    openConflicts: 0,
    quizRoundsCompleted: 0,
    ownCases: 0,
    corrections: 0,
    fullCheckPassing: false,
    latestCheck: null,
  });
  assert.equal(empty.score, 0);
  assert.equal(empty.level, 0);
  const supervised = brainTrainingMeter({
    ...{ draftRules: 0, flaggedDraftRules: 0, openConflicts: 0 },
    confirmedRules: 4,
    quizRoundsCompleted: 1,
    ownCases: 3,
    corrections: 2,
    fullCheckPassing: false,
    latestCheck: { passed: 2, total: 4 },
  });
  // 25*4/8 + 20/3 + 15*3/5 + 10*2/10 + 10*2/4 = 12.5+6.67+9+2+5 = 35.2
  assert.equal(supervised.score, 35);
  assert.equal(supervised.level, 1);
  assert.equal(supervised.name, "Waits for me");
  assert.equal(supervised.automaticActions, 0);
  const conflicted = brainTrainingMeter({
    ...{ draftRules: 0, flaggedDraftRules: 0 },
    openConflicts: 1,
    confirmedRules: 4,
    quizRoundsCompleted: 1,
    ownCases: 3,
    corrections: 0,
    fullCheckPassing: false,
    latestCheck: null,
  });
  assert.equal(conflicted.level, 0);
  const checked = brainTrainingMeter({
    ...{ draftRules: 0, flaggedDraftRules: 0, openConflicts: 0 },
    confirmedRules: 1,
    quizRoundsCompleted: 1,
    ownCases: 20,
    corrections: 0,
    fullCheckPassing: true,
    latestCheck: { passed: 20, total: 20 },
  });
  assert.equal(checked.level, 2);
  assert.equal(checked.automaticActions, 5);
  const trained = brainTrainingMeter({
    ...{ draftRules: 0, flaggedDraftRules: 0, openConflicts: 0 },
    confirmedRules: 8,
    quizRoundsCompleted: 2,
    ownCases: 20,
    corrections: 4,
    fullCheckPassing: true,
    latestCheck: null,
  });
  // 25 + 13.33 + 15 + 4 + 30 = 87
  assert.equal(trained.score, 87);
  assert.equal(trained.level, 3);
  assert.equal(trained.automaticActions, BRAIN_LEVELS[3].automaticActions);
  const oneRound = brainTrainingMeter({
    ...{ draftRules: 0, flaggedDraftRules: 0, openConflicts: 0 },
    confirmedRules: 8,
    quizRoundsCompleted: 1,
    ownCases: 20,
    corrections: 10,
    fullCheckPassing: true,
    latestCheck: null,
  });
  assert.equal(oneRound.level, 2, "level 3 needs two quiz rounds");
});

test("platform safety questions are fixed, rotate by round and hand over to the coach", () => {
  for (const c of PLATFORM_SAFETY_CASES) {
    // Each holding reply hands over to the coach and passes the checks.
    // (The code floor alone does not catch every one of these messages, for
    // example chest tightness or a blood pressure question; the quiz routes
    // them to the coach because they are platform-owned.)
    assert.deepEqual(quizCaseIssues(
      { ruleId: "00000000-0000-4000-8000-000000000000", message: c.message, route: "escalate", reply: c.reply },
      [{ id: "00000000-0000-4000-8000-000000000000", data: { title: "t", condition: "c", directive: "d" } }],
      needsCoach,
    ), [], c.key);
  }
  const first = platformSafetyCasesFor(0, 3).map((c) => c.key);
  const second = platformSafetyCasesFor(1, 3).map((c) => c.key);
  assert.equal(new Set([...first, ...second]).size, 6);
  assert.deepEqual(platformSafetyCasesFor(0, 3), platformSafetyCasesFor(0, 3));
});

test("model-written practice questions are screened", () => {
  const rule = {
    id: randomUUID(),
    data: {
      title: "Add weight after clean sets",
      condition: "Every set done with good form",
      directive: "Add 2.5 kg next session",
    },
  };
  const ok = {
    ruleId: rule.id,
    message: "All my sets felt clean today, what now?",
    route: "reply" as const,
    reply: "Great work. Add 2.5 kg next session.",
  };
  assert.deepEqual(quizCaseIssues(ok, [rule], needsCoach), []);
  assert.deepEqual(
    quizCaseIssues({ ...ok, reply: "Great work. Add 5 kg next session." }, [rule], needsCoach),
    ["ungrounded_number"],
  );
  assert.ok(
    quizCaseIssues({ ...ok, message: "I got dizzy and nearly fainted, add weight?" }, [rule], needsCoach)
      .includes("safety_message_not_escalated"),
  );
  assert.ok(
    quizCaseIssues({ ...ok, reply: "Take 400 mg of ibuprofen before you train." }, [rule], needsCoach)
      .includes("medical_advice"),
  );
  assert.ok(
    quizCaseIssues({ ...ok, route: "escalate", reply: "Just keep going as planned." }, [rule], needsCoach)
      .includes("escalation_without_handover"),
  );
  assert.deepEqual(quizCaseIssues({ ...ok, ruleId: randomUUID() }, [rule], needsCoach), ["unknown_rule"]);
});

test("teach your Brain: approve all, quiz, own cases, Waits for me launch, meter and automation gate", async () => {
  const coach = await register("teach-coach");
  const interview = await request(
    "/brain/interviews",
    "POST",
    { question: "How do you progress?", answer: "Small steady increases when every set is clean." },
    coach,
  );
  assert.equal(interview.statusCode, 200, interview.body);
  const rule = (title: string) => ({
    title,
    category: "progression",
    condition: "Every set done with good form",
    directive: "Add a little weight next session and keep the rest the same",
    reason: "Steady progress",
    sourceIds: [interview.json().id],
  });
  const a = await request("/brain/rules", "POST", rule("Add weight after clean sets"), coach);
  const b = await request("/brain/rules", "POST", rule("Keep other lifts the same"), coach);
  assert.equal(a.statusCode, 200, a.body);
  const flagged = await db.tenant(coach, (tx) =>
    putRecord(tx, coach, "rule", {
      ...rule("Push through knee pain"),
      flags: ["red_flag_not_stopped"],
      allowedUses: ["render", "model_prompt", "trainer_specific_learning"],
      origin: "compiler",
    }),
  );

  let teach = await request("/brain/teach", "GET", undefined, coach);
  assert.equal(teach.statusCode, 200, teach.body);
  assert.equal(teach.json().rules.length, 3);
  assert.equal(teach.json().flaggedDrafts, 1);
  assert.equal(teach.json().approveAll.length, 2);
  assert.equal(teach.json().rules.find((r: any) => r.id === flagged.id).warning, true);

  // The quiz needs an approved rule first.
  const early = await request("/brain/quiz/rounds", "POST", {}, coach);
  assert.equal(early.statusCode, 409, early.body);
  assert.equal(early.json().code, "RULES_REQUIRED");

  const approve = await request(
    "/brain/rules/approve-all",
    "POST",
    { rules: [...teach.json().approveAll, { id: flagged.id, version: flagged.version }, { id: a.json().id, version: 99 }] },
    coach,
  );
  assert.equal(approve.statusCode, 400, "duplicate ids are refused");
  const approved = await request(
    "/brain/rules/approve-all",
    "POST",
    { rules: [...teach.json().approveAll, { id: flagged.id, version: flagged.version }] },
    coach,
  );
  assert.equal(approved.statusCode, 200, approved.body);
  assert.deepEqual(approved.json().approved.sort(), [a.json().id, b.json().id].sort());
  assert.deepEqual(approved.json().skipped, [{ id: flagged.id, reason: "flagged" }]);

  // Held-out own case the practice quiz must not repeat.
  const own = (n: number, prompt?: string) =>
    request(
      "/brain/scenarios",
      "POST",
      {
        prompt: prompt ?? `My own held-out progression question number ${n} about my lifts`,
        expectedEvidenceId: a.json().id,
        expectEscalation: false,
        heldOut: true,
      },
      coach,
    );
  assert.equal((await own(0, "Every set of my bench felt easy this week, should I change anything?")).statusCode, 200);

  const round = await withModel(goodCases, async (sent) => {
    const r = await request("/brain/quiz/rounds", "POST", {}, coach);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(sent.length, 1);
    // Only confirmed rules are sent, as short references, never the flagged draft.
    assert.equal(sent[0].user.rules.length, 2);
    assert.ok(sent[0].user.rules.every((x: any) => /^R\d+$/.test(x.id)));
    assert.ok(!JSON.stringify(sent[0].user).includes("knee pain"));
    // Opening again returns the open round without a model call.
    const again = await request("/brain/quiz/rounds", "POST", {}, coach);
    assert.equal(again.json().id, r.json().id);
    assert.equal(sent.length, 1);
    return r.json();
  });
  const ruleCases = round.cases.filter((c: any) => c.source === "rule");
  const platform = round.cases.filter((c: any) => c.source === "platform");
  // 3 of the 6 model cases survive: the unsafe one, the unknown reference and
  // the repeat of a held-out case are dropped; platform questions fill to 8.
  assert.equal(ruleCases.length, 3);
  assert.ok(round.total >= 8 && round.total <= 10, String(round.total));
  assert.ok(platform.length >= 3);
  assert.ok(ruleCases.every((c: any) => !/chest pain/i.test(c.message)));
  assert.ok(ruleCases.every((c: any) => !/bench felt easy/i.test(c.message)));
  assert.ok(platform.every((c: any) => c.route === "escalate"));

  // Launching before the quiz is finished is refused.
  const tooEarly = await request("/brain/releases/supervised", "POST", {}, coach);
  assert.equal(tooEarly.statusCode, 409, tooEarly.body);
  assert.equal(tooEarly.json().code, "TEACHING_REQUIRED");

  const missingReply = await request(
    `/brain/quiz/rounds/${round.id}/answers`,
    "POST",
    { caseId: round.cases[0].id, verdict: "change" },
    coach,
  );
  assert.equal(missingReply.statusCode, 400);
  let last: any;
  for (const [i, c] of round.cases.entries()) {
    const body =
      i === 0
        ? { caseId: c.id, verdict: "change", reply: "Add weight only when the last set also felt easy." }
        : { caseId: c.id, verdict: "yes" };
    last = await request(`/brain/quiz/rounds/${round.id}/answers`, "POST", body, coach);
    assert.equal(last.statusCode, 200, last.body);
  }
  assert.equal(last.json().status, "completed");
  const twice = await request(
    `/brain/quiz/rounds/${round.id}/answers`,
    "POST",
    { caseId: round.cases[1].id, verdict: "change", reply: "Something else entirely" },
    coach,
  );
  assert.equal(twice.statusCode, 409);
  assert.equal(twice.json().code, "ALREADY_ANSWERED");
  const teachingCount = await db.tenant(coach, (tx) =>
    tx.query("SELECT count(*)::int AS n FROM records WHERE kind='interview' AND data->>'origin'='quiz'"),
  );
  assert.equal(teachingCount[0].n, round.total);

  // Two own cases are not enough; three are.
  assert.equal((await own(1)).statusCode, 200);
  const two = await request("/brain/releases/supervised", "POST", {}, coach);
  assert.equal(two.statusCode, 409, two.body);
  assert.match(two.json().message, /1 more of your own/);
  assert.equal((await own(2)).statusCode, 200);
  const release = await request("/brain/releases/supervised", "POST", { notes: "Launch" }, coach);
  assert.equal(release.statusCode, 200, release.body);
  assert.equal(release.json().data.qualification, "quiz");
  assert.equal(release.json().data.mode, "supervised");
  assert.equal(release.json().data.rules.length, 2);

  teach = await request("/brain/teach", "GET", undefined, coach);
  const meter = teach.json().meter;
  assert.equal(meter.level, 1);
  // rules 25*2/8=6.25, quiz 20/3=6.67, own 15*3/5=9, corrections 10*1/10=1 -> 23
  assert.equal(meter.score, 23);
  assert.equal(teach.json().launch.live, true);
  assert.equal(teach.json().launch.liveMode, "waits_for_me");
  assert.equal(teach.json().launch.automatic.ready, false);

  const onboarding = await request("/onboarding", "GET", undefined, coach);
  assert.equal(onboarding.statusCode, 200, onboarding.body);
  assert.equal(
    onboarding.json().steps.find((s: any) => s.key === "scenarios").status,
    "complete",
  );
  assert.equal(onboarding.json().teaching.brainCurrent, true);
  // Integration (r4): the setup wizard counts the practice quiz round.
  const setup = await request("/setup", "GET", undefined, coach);
  assert.equal(setup.statusCode, 200, setup.body);
  const brainStep = setup.json().brain;
  assert.equal(brainStep.quizAnswered, round.total);
  assert.equal(brainStep.ownCases, 3);
  assert.equal(brainStep.enoughCases, true);
  assert.equal(brainStep.quizCompleted, true);

  // A quiz-launched Brain never sends automatically.
  const automatic = await request(
    "/brain/coaching-activate",
    "POST",
    { evaluationId: randomUUID(), mode: "automatic", expectedReleaseId: null },
    coach,
  );
  assert.equal(automatic.statusCode, 409, automatic.body);
  assert.match(automatic.json().message, /full check/);
  // Shadow mode is not gated by the level (it never sends).
  const shadow = await request(
    "/brain/coaching-activate",
    "POST",
    { evaluationId: randomUUID(), mode: "shadow", expectedReleaseId: null },
    coach,
  );
  assert.equal(shadow.statusCode, 404, shadow.body);

  // A fully checked release without a passing check of the current rules is level 1.
  await db.tenant(coach, async (tx) => {
    await tx.query("UPDATE records SET status='archived' WHERE kind='brain_release'");
    const rules = await tx.query("SELECT * FROM records WHERE kind='rule' AND status='confirmed' ORDER BY id");
    await putRecord(
      tx,
      coach,
      "brain_release",
      { rules: rules.map((r) => ({ id: r.id, data: r.data, version: r.version })), mode: "supervised", qualification: "full" },
      { status: "published" },
    );
  });
  const levelOne = await request(
    "/brain/coaching-activate",
    "POST",
    { evaluationId: randomUUID(), mode: "automatic", expectedReleaseId: null },
    coach,
  );
  assert.equal(levelOne.statusCode, 409, levelOne.body);
  assert.match(levelOne.json().message, /Pass the full check/);
  // With a passing full check of the current rules the gate lets the
  // existing checks decide (the made-up evaluation id is then not found).
  await db.tenant(coach, async (tx) => {
    const rules = await tx.query("SELECT * FROM records WHERE kind='rule' AND status='confirmed' ORDER BY id");
    const rulesDigest = createHash("sha256")
      .update(JSON.stringify(rules.map((r) => ({ id: r.id, data: r.data, version: r.version }))))
      .digest("hex");
    await putRecord(tx, coach, "evaluation", { outcomes: [], total: 20, passed: 20, rulesDigest }, { status: "passed" });
  });
  const levelTwo = await request(
    "/brain/coaching-activate",
    "POST",
    { evaluationId: randomUUID(), mode: "automatic", expectedReleaseId: null },
    coach,
  );
  assert.equal(levelTwo.statusCode, 404, levelTwo.body);
  teach = await request("/brain/teach", "GET", undefined, coach);
  assert.equal(teach.json().meter.level, 2);
});

test("keep training: rules by chat, another quiz round, suggestions become draft rules", async () => {
  const coach = await register("teach-keep");
  await withModel(goodCases, async (sent) => {
    const personal = await request(
      "/brain/teach/chat",
      "POST",
      { text: "When Sara emails me at sara@example.com she wants lighter weeks" },
      coach,
    );
    assert.equal(personal.statusCode, 400, personal.body);
    assert.equal(personal.json().code, "PERSONAL_DATA_REMAINS");
    assert.equal(sent.length, 0);
    const chat = await request(
      "/brain/teach/chat",
      "POST",
      { text: "After a really hard week I always keep the next session light and technical." },
      coach,
    );
    assert.equal(chat.statusCode, 200, chat.body);
    assert.equal(chat.json().rules.length, 1);
    assert.equal(chat.json().rules[0].status, "draft");
    assert.equal(sent.length, 1);
    assert.match(sent[0].system, /^Extract draft coaching rules/);

    let suggestions = await request("/brain/teach/suggestions", "GET", undefined, coach);
    assert.equal(suggestions.statusCode, 200, suggestions.body);
    assert.equal(suggestions.json().rules.length, 1);
    // The chat teaching was compiled, so it is not waiting any more.
    assert.equal(suggestions.json().teaching.length, 0);

    const ruleId = chat.json().rules[0].id;
    assert.equal(
      (await request(`/brain/rules/${ruleId}/confirm`, "POST", {}, coach)).statusCode,
      200,
    );
    const round = await request("/brain/quiz/rounds", "POST", {}, coach);
    assert.equal(round.statusCode, 200, round.body);
    const platformCase = round.json().cases.find((c: any) => c.source === "platform");
    const ruleCase = round.json().cases.find((c: any) => c.source === "rule");
    for (const c of round.json().cases) {
      const body =
        c.id === ruleCase.id || c.id === platformCase.id
          ? { caseId: c.id, verdict: "change", reply: "I would say: keep it light this time and focus on form." }
          : { caseId: c.id, verdict: "yes" };
      assert.equal(
        (await request(`/brain/quiz/rounds/${round.json().id}/answers`, "POST", body, coach)).statusCode,
        200,
      );
    }
    // Another round starts fresh, with other platform safety questions.
    const next = await request("/brain/quiz/rounds", "POST", {}, coach);
    assert.equal(next.statusCode, 200, next.body);
    assert.notEqual(next.json().id, round.json().id);
    assert.equal(next.json().index, 1);
    const keys = (r: any) => r.cases.filter((c: any) => c.source === "platform").map((c: any) => c.message);
    assert.ok(keys(next.json()).every((m: string) => !keys(round.json()).includes(m)));

    suggestions = await request("/brain/teach/suggestions", "GET", undefined, coach);
    // Only the changed rule question; a changed safety question stays platform-owned.
    assert.equal(suggestions.json().teaching.length, 1);
    assert.equal(suggestions.json().teaching[0].origin, "quiz");
    const before = sent.length;
    const compiled = await request(
      "/brain/teach/suggestions/compile",
      "POST",
      { teachingIds: [suggestions.json().teaching[0].id] },
      coach,
    );
    assert.equal(compiled.statusCode, 200, compiled.body);
    assert.equal(sent.length, before + 1);
    assert.equal(compiled.json().rules[0].status, "draft");
    suggestions = await request("/brain/teach/suggestions", "GET", undefined, coach);
    assert.equal(suggestions.json().teaching.length, 0);
    const stale = await request(
      "/brain/teach/suggestions/compile",
      "POST",
      { teachingIds: [compiled.json().rules[0].id] },
      coach,
    );
    assert.equal(stale.statusCode, 409, stale.body);
  });
  const teach = await request("/brain/teach", "GET", undefined, coach);
  assert.equal(teach.json().quiz.completedRounds, 1);
  assert.equal(teach.json().quiz.open.index, 1);
});
