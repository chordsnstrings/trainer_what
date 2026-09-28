// Trainer Brain plan generation, review, learning, adaptation and
// qualification (docs/features/brain-plans.md), with a scripted fake model:
// the e2e rule responder by default, overridden per test.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, elevated, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  adaptMemberPlan,
  executeBrainPlanJob,
  scheduleBrainPlans,
} from "../apps/api/src/brain-plans.ts";
import { claimJob, runClaimedJob } from "../apps/worker/src/dispatch.ts";
import {
  caseCoverage,
  planConfidence,
  planDiff,
  planLibrary,
  planSafetyReasons,
  planSegment,
  ruleCoverage,
  validateAdaptedWeek,
  validatePlan,
  defaultPlanSettings,
  type PlanDraft,
} from "../packages/domain/src/brain-plans.ts";
import { retrievePlanMaterial } from "../packages/providers/src/brain-plans.ts";
import { classifyPrompt, ruleBasedAnswer } from "./e2e/mocks/model-rules.ts";
import { MESSAGE_KINDS } from "../apps/api/src/message-templates.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>, coach: any, foreign: any;
const config = {
  MODEL_BASE_URL: "https://plan-fixture.invalid/v1",
  MODEL_API_KEY: "synthetic-plan-key",
  MODEL_NAME: "plan-fixture",
  MODEL_PRICE_VERSION: "fixture-v1",
  MODEL_INPUT_USD_PER_MILLION: "1",
  MODEL_OUTPUT_USD_PER_MILLION: "2",
  MODEL_MAX_DAILY_CALLS: "1000",
};
const original = Object.fromEntries(Object.keys(config).map((k) => [k, process.env[k]])),
  originalFetch = globalThis.fetch;
const calls: string[] = [];
const prompts: any[] = [];
let override: ((body: any) => unknown) | undefined;

async function req(path: string, method: any = "GET", payload?: any, actor?: any) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    payload,
    headers: { origin: "http://localhost:3000", ...(actor ? { cookie: actor.cookie } : {}) },
  });
}
async function register(slug: string) {
  const r = await req("/auth/register", "POST", {
    name: "Coach " + slug,
    email: slug + "@example.test",
    password: "PlanFixture2026!",
    slug,
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return { ...(await req("/bootstrap", "GET", undefined, { cookie })).json().user, cookie };
}
const worker = (tenantId: string) => elevated("worker", { tenantId, role: "owner" });
async function member(
  owner: any,
  name: string,
  profile: { goal?: string; experience?: string; daysPerWeek?: number; equipment?: string; limitations?: string } = {},
  options: { timezone?: string; programmeDays?: number } = {},
) {
  const email = `${name.toLowerCase().replaceAll(" ", "-")}-${randomUUID().slice(0, 8)}@example.test`;
  const invitation = await req("/invitations", "POST", { email, role: "subscriber" }, owner);
  assert.equal(invitation.statusCode, 200, invitation.body);
  const joined = await req("/invitations/accept", "POST", {
    token: invitation.json().url.split("/").pop(),
    email,
    name,
    password: "PlanClient2026!",
    accepted: true,
  });
  assert.equal(joined.statusCode, 200, joined.body);
  const cookie = String(joined.headers["set-cookie"]).split(";")[0];
  const client = { ...(await req("/bootstrap", "GET", undefined, { cookie })).json().user, cookie };
  await db.tenant(worker(owner.tenantId), async (tx) => {
    let productId: string | null = null;
    if (options.programmeDays) {
      const product = await putRecord(
        tx,
        worker(owner.tenantId),
        "product",
        { name: "Programme offer", priceMinor: 10000, tier: "workout", programmeDays: options.programmeDays, billing: "upfront" },
        { status: "published", ownerId: owner.userId },
      );
      productId = product.id;
    }
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor,data) VALUES($1,$2,$3,'active',now()+interval '30 days',10000,$4)",
      [randomUUID(), owner.tenantId, client.userId, JSON.stringify(productId ? { productId } : {})],
    );
  });
  if (options.timezone) {
    const pref = await req("/notifications/preferences", "PUT", { version: 0, data: { timezone: options.timezone } }, client);
    assert.equal(pref.statusCode, 200, pref.body);
  }
  const intake = await req(
    "/intake",
    "POST",
    {
      age: 32,
      goal: profile.goal ?? "Build strength and muscle",
      experience: profile.experience ?? "beginner",
      daysPerWeek: profile.daysPerWeek ?? 3,
      equipment: profile.equipment ?? "Dumbbells, bench",
      limitations: profile.limitations ?? "None reported",
      consent: true,
    },
    client,
  );
  assert.equal(intake.statusCode, 200, intake.body);
  return client;
}
async function seedBrain(owner: any) {
  await db.tenant(worker(owner.tenantId), async (tx) => {
    const a = worker(owner.tenantId);
    const rules = [];
    for (const [title, directive] of [
      ["Beginner strength progression", "Progress load by small steps for beginner strength clients training three days per week with dumbbells; deload every fourth week."],
      ["Session structure", "Keep each session to four exercises with controlled rest; schedule training days with a rest day between."],
    ]) {
      const rule = await putRecord(
        tx,
        a,
        "rule",
        { title, category: "progression", condition: "Programme design", directive, reason: "The trainer's method", sourceIds: [], allowedUses: ["model_prompt", "render"] },
        { status: "confirmed", ownerId: owner.userId },
      );
      rules.push({ id: rule.id, version: rule.version, data: rule.data });
    }
    await putRecord(tx, a, "brain_release", { rules, mode: "supervised" }, { status: "published", ownerId: owner.userId });
  });
  for (const exercise of [
    { name: "Goblet squat", equipment: ["dumbbells"], alternatives: [{ name: "Bodyweight squat", cue: "Sit back" }] },
    { name: "Dumbbell bench press", equipment: ["dumbbells", "bench"], alternatives: [{ name: "Push-up", cue: "Brace" }] },
    { name: "One-arm dumbbell row", equipment: ["dumbbells", "bench"] },
    { name: "Romanian deadlift", equipment: ["dumbbells"] },
    { name: "Plank", equipment: ["bodyweight"] },
    { name: "Barbell back squat", equipment: ["barbell", "squat rack"] },
  ]) {
    const r = await req(
      "/training/exercises",
      "POST",
      { sets: 3, reps: 10, restSeconds: 90, loadKg: 0, rir: 2, cue: "Move with control", ...exercise },
      owner,
    );
    assert.equal(r.statusCode, 200, r.body);
  }
}
const workspace = async (owner: any) => {
  const r = await req("/brain/plans/workspace", "GET", undefined, owner);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const generation = (id: string, tenantId: string) =>
  db.tenant(worker(tenantId), async (tx) => (await tx.query("SELECT * FROM records WHERE id=$1", [id]))[0]);
async function saveSettings(owner: any, patch: any) {
  const ws = await workspace(owner);
  const r = await req("/brain/plans/settings", "PUT", { settings: { ...ws.settings, ...patch }, version: ws.settingsVersion }, owner);
  assert.equal(r.statusCode, 200, r.body);
}
async function qualify(owner: any) {
  const deliverable = { goal: "Build strength", experience: "beginner", daysPerWeek: 3, equipment: "Dumbbells, bench", limitations: "None reported" };
  const scenarios = [
    { title: "Beginner three days", profile: deliverable, programmeDays: 28, expected: "deliverable" },
    { title: "Beginner two days", profile: { ...deliverable, daysPerWeek: 2 }, programmeDays: 14, expected: "deliverable" },
    { title: "Intermediate four days", profile: { ...deliverable, experience: "intermediate", daysPerWeek: 4 }, programmeDays: 28, expected: "deliverable" },
    { title: "Muscle focus", profile: { ...deliverable, goal: "Build muscle" }, programmeDays: 21, expected: "deliverable" },
    { title: "Knee surgery", profile: { ...deliverable, limitations: "Recovering from knee surgery" }, programmeDays: 28, expected: "review" },
    { title: "Chest pain", profile: { ...deliverable, goal: "Train again after chest pain last week" }, programmeDays: 28, expected: "review" },
  ];
  for (const s of scenarios) {
    const r = await req("/brain/plans/scenarios", "POST", s, owner);
    assert.equal(r.statusCode, 200, r.body);
  }
  const q = await req("/brain/plans/qualify", "POST", {}, owner);
  assert.equal(q.statusCode, 200, q.body);
  return q.json();
}

before(async () => {
  Object.assign(process.env, config);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const { kind, input } = classifyPrompt(body);
    calls.push(kind);
    prompts.push({ kind, input });
    const content = override?.(body) ?? ruleBasedAnswer(body).content;
    return Response.json({
      id: "plan-fixture-call",
      usage: { prompt_tokens: 200, completion_tokens: 100 },
      choices: [{ message: { content: JSON.stringify(content) } }],
    });
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  coach = await register("plan-coach");
  foreign = await register("plan-foreign");
  await seedBrain(coach);
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(original))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  await app.close();
  await db.close();
});

// ---------------------------------------------------------------------------
// Code validator, confidence and diff (no database)

const library = planLibrary(
  [
    { id: randomUUID(), data: { name: "Goblet squat", equipment: ["dumbbells"], alternatives: [] } },
    { id: randomUUID(), data: { name: "Dumbbell bench press", equipment: ["dumbbells", "bench"], alternatives: [] } },
    { id: randomUUID(), data: { name: "Barbell back squat", equipment: ["barbell"], alternatives: [] } },
    { id: randomUUID(), data: { name: "Plank", alternatives: [] } },
  ],
  [],
);
const exercise = (name: string, extra: any = {}) => ({ name, sets: 3, reps: 10, loadKg: 20, rir: 2, restSeconds: 90, cue: "", alternatives: [], ...extra });
const draft = (patch: Partial<PlanDraft> = {}): PlanDraft => ({
  title: "Strength plan",
  summary: "Test",
  sessions: [
    { key: "A", label: "Full body A", weekday: 1, exercises: [exercise("Goblet squat"), exercise("Dumbbell bench press")] },
    { key: "B", label: "Full body B", weekday: 3, exercises: [exercise("Goblet squat"), exercise("Plank", { loadKg: 0 })] },
    { key: "C", label: "Full body C", weekday: 5, exercises: [exercise("Dumbbell bench press")] },
  ],
  weeks: [1, 2, 3, 4].map((week) => ({ week, focus: "Build", volumeFactor: week === 4 ? 0.6 : 1, loadFactor: week === 4 ? 0.9 : 1 + 0.025 * (week - 1), rirDelta: 0, deload: week === 4 })),
  selfConfidence: 0.8,
  uncertainties: [],
  evidenceIds: [],
  ...patch,
});
const ctx = {
  profile: { experience: "beginner" as const, daysPerWeek: 3, equipment: "Dumbbells, bench" },
  library,
  bounds: defaultPlanSettings().bounds,
  programmeDays: 28,
};

test("the code validator accepts a bounded plan and rejects each hard-bound breach", () => {
  const ok = validatePlan(draft(), ctx);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.metrics.weeklyVolume, [15, 15, 15, 10]);
  // Plank has no equipment tags: allowed but unchecked, which is a warning.
  assert.ok(ok.warnings.some((w) => /Equipment is unchecked for Plank/.test(w)));
  const errors = (d: PlanDraft, c: any = ctx) => validatePlan(d, c).errors.join("\n");
  assert.match(errors(draft({ sessions: [{ key: "A", label: "A", weekday: 1, exercises: [exercise("Cable fly")] }] })), /Cable fly is not in the trainer's exercise library/);
  assert.match(errors(draft({ sessions: [{ key: "A", label: "A", weekday: 1, exercises: [exercise("Barbell back squat")] }] })), /needs barbell, which the subscriber does not have/);
  assert.match(errors(draft({ sessions: [{ key: "A", label: "A", weekday: 1, exercises: [exercise("Goblet squat", { restSeconds: 20 })] }] })), /rest 20s is outside 30-240s/);
  assert.match(errors(draft({ sessions: [{ key: "A", label: "A", weekday: 1, exercises: [exercise("Goblet squat", { rir: 0 })] }] })), /takes a beginner to failure/);
  const jump = draft();
  jump.weeks[1].loadFactor = 1.3;
  assert.match(errors(jump), /Week 2: Goblet squat load jumps from 20 kg to 26 kg/);
  const volume = draft();
  volume.weeks[1].volumeFactor = 1.5;
  assert.match(errors(volume), /Week 2: weekly volume rises from 15 to/);
  const long = draft({ sessions: [{ key: "A", label: "A", weekday: 1, exercises: [exercise("Goblet squat", { sets: 10, restSeconds: 240 }), exercise("Dumbbell bench press", { sets: 10, restSeconds: 240 })] }] });
  assert.match(errors(long), /takes about \d+ minutes \(limit 75\)/);
  assert.match(errors(draft(), { ...ctx, profile: { ...ctx.profile, daysPerWeek: 2 } }), /3 sessions a week but the subscriber trains 2 days/);
  assert.match(errors(draft(), { ...ctx, programmeDays: 35 }), /weeks 1 to 5 in order/);
  assert.match(errors(draft({ evidenceIds: [randomUUID()] }), { ...ctx, evidenceIds: new Set([randomUUID()]) }), /cites material outside/);
  // A new block's first week may not jump from the previous block's last loads.
  assert.match(errors(draft(), { ...ctx, previousWeek: [{ key: "A", exercises: [{ ...exercise("Goblet squat"), loadKg: 10, alternatives: [] }] }] }), /Week 1: Goblet squat load jumps from 10 kg to 20 kg/);
  const adapted = validateAdaptedWeek(
    [{ key: "A", exercises: [exercise("Goblet squat")] }],
    [{ key: "A", exercises: [exercise("Goblet squat", { loadKg: 30 })] }],
    ctx,
  );
  assert.match(adapted.errors.join("\n"), /Goblet squat load jumps from 20 kg to 30 kg/);
});

test("confidence is deterministic, explained and raised by similar reviewed plans", () => {
  const segment = planSegment({ goal: "Build strength", experience: "beginner", daysPerWeek: 3, equipment: "Dumbbells, bench" });
  assert.deepEqual(segment, { goal: "strength", experience: "beginner", daysPerWeek: 3, equipment: ["bench", "dumbbell"] });
  const rules = ["Beginner strength: progress load each week, three days per week with dumbbells, deload every fourth week"];
  const validation = validatePlan(draft(), ctx);
  const low = planConfidence({ ruleCoverage: ruleCoverage(segment, rules), caseCoverage: caseCoverage(segment, []), validation, selfConfidence: 0.8, uncertainties: [], threshold: 0.8 });
  assert.equal(low.confident, false);
  assert.ok(low.reasons.some((r) => /Few reviewed plans for similar clients/.test(r)));
  const learned = [1, 2, 3].map(() => ({ decision: "approved", segment }));
  const high = planConfidence({ ruleCoverage: ruleCoverage(segment, rules), caseCoverage: caseCoverage(segment, learned), validation, selfConfidence: 0.8, uncertainties: [], threshold: 0.8 });
  assert.ok(high.score > low.score);
  assert.equal(high.signals.caseCoverage, 1);
  // A rejection in the same segment lowers coverage; another segment does not count.
  const other = planSegment({ goal: "Run a marathon", experience: "advanced", daysPerWeek: 5, equipment: "" });
  assert.equal(caseCoverage(segment, [...learned, { decision: "rejected", segment }]).score, 2 / 3);
  assert.equal(caseCoverage(segment, [{ decision: "approved", segment: other }]).score, 0);
  // Validator errors always block confidence.
  const invalid = planConfidence({ ruleCoverage: ruleCoverage(segment, rules), caseCoverage: caseCoverage(segment, learned), validation: validatePlan(draft(), { ...ctx, programmeDays: 35 }), selfConfidence: 1, uncertainties: [], threshold: 0.5 });
  assert.equal(invalid.confident, false);
  assert.deepEqual(planSafetyReasons({ limitations: "None reported", redFlags: [], painReports: 0 }), []);
  assert.equal(planSafetyReasons({ limitations: "Old shoulder injury", redFlags: [], painReports: 1 }).length, 2);
  const edited = draft();
  edited.sessions[0].exercises[0].sets = 4;
  assert.deepEqual(planDiff(draft(), edited), [{ path: "sessions.A.exercises.Goblet squat.sets", from: 3, to: 4 }]);
});

test("the e2e rule responder answers both new prompt kinds with schema-valid output", () => {
  const body = (system: string, input: any) => ({ messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(input) }] });
  const retrieval = retrievePlanMaterial({ tenantId: "t", segment: planSegment({ goal: "Build strength", experience: "beginner", daysPerWeek: 3, equipment: "Dumbbells, bench" }), goal: "Build strength", rules: [], cases: [], learning: [], templates: [], library });
  const plan = ruleBasedAnswer(body("Trainer Brain plan generator brain-plan-v1.", { profile: { daysPerWeek: 3, experience: "beginner", equipment: "Dumbbells, bench" }, programme: { weeks: 4 }, bounds: ctx.bounds, material: retrieval.material }));
  assert.equal(plan.kind, "plan_generation");
  assert.deepEqual(validatePlan(plan.content as PlanDraft, ctx).errors, []);
  const adaptation = ruleBasedAnswer(body("Trainer Brain plan adaptation brain-plan-adapt-v1.", { outcomes: { adherence: 1, exercises: [] }, nextWeek: [], material: { rules: [] } }));
  assert.equal(adaptation.kind, "plan_adaptation");
  assert.deepEqual((adaptation.content as any).changes, []);
});

test("new notification template keys are registered", () => {
  const keys = new Set(MESSAGE_KINDS.map((k) => k.templateKey));
  for (const key of ["brain-plan-ready", "brain-plan-adjusted", "brain-plan-withdrawn", "brain-plan-review"])
    assert.ok(keys.has(key), key);
});

// ---------------------------------------------------------------------------
// End to end

test("supervised generation goes to review with its audit record, and approval delivers dated sessions in the member's timezone", async () => {
  const client = await member(coach, "Supervised Client", {}, { timezone: "Pacific/Kiritimati", programmeDays: 14 });
  const before = calls.length;
  const r = await req("/brain/plans/generate", "POST", { subscriberId: client.userId }, coach);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "pending_review");
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1), "plan_generation");
  const gen = await generation(r.json().generationId, coach.tenantId);
  assert.equal(gen.status, "pending_review");
  assert.equal(gen.owner_user_id, client.userId);
  assert.equal(gen.data.promptVersion, "brain-plan-v1");
  assert.match(gen.data.inputsDigest, /^[0-9a-f]{64}$/);
  assert.ok(gen.data.brainReleaseId);
  assert.equal(gen.data.inputs.programmeDays, 14);
  assert.equal(gen.data.inputs.timezone, "Pacific/Kiritimati");
  assert.equal(gen.data.qualified, false);
  assert.deepEqual(gen.data.validation.errors, []);
  assert.ok(gen.data.confidence.signals && typeof gen.data.confidence.score === "number");
  assert.ok(gen.data.routeReasons.some((x: string) => /qualification has not passed/.test(x)));
  assert.ok(gen.data.retrieval.rules.length >= 1);
  // The member learns only the state, never the draft.
  const mine = await req("/brain/plans/mine", "GET", undefined, client);
  assert.equal(mine.statusCode, 200, mine.body);
  assert.equal(mine.json().status.state, "in_review");
  assert.equal(mine.json().program, null);
  const hidden = await db.tenant({ tenantId: coach.tenantId, userId: client.userId, role: "subscriber" }, (tx) =>
    tx.query("SELECT id FROM records WHERE kind IN ('plan_generation','plan_learning','plan_brain_settings')"),
  );
  assert.equal(hidden.length, 0);
  // The queue shows the draft and the reasons; approval is one click.
  const ws = await workspace(coach);
  const item = ws.queue.find((q: any) => q.id === gen.id);
  assert.ok(item?.draft && item.routeReasons.length);
  const approved = await req(`/brain/plans/${gen.id}/review`, "POST", { action: "approve", version: gen.version }, coach);
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().decision, "approved");
  const plan = (await req("/brain/plans/mine", "GET", undefined, client)).json();
  assert.equal(plan.status.state, "delivered");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  assert.equal(plan.program.startDate, today);
  assert.equal(plan.program.programmeDays, 14);
  assert.equal(plan.program.weeks.length, 2);
  const overview = (await req("/training/overview", "GET", undefined, client)).json();
  const sessions = overview.records.filter((r: any) => r.kind === "planned_session" && r.status === "planned");
  assert.equal(sessions.length, 6);
  assert.ok(sessions.every((s: any) => s.data.timezone === "Pacific/Kiritimati" && s.data.date >= today && s.data.programId === plan.program.id));
  assert.ok(sessions.every((s: any) => s.data.program.exercises.length >= 1 && s.data.program.exercises.every((e: any) => e.sets >= 1 && e.restSeconds >= 30)));
  const learning = await db.tenant(worker(coach.tenantId), (tx) => tx.query("SELECT * FROM records WHERE kind='plan_learning' AND data->>'generationId'=$1", [gen.id]));
  assert.equal(learning[0].data.decision, "approved");
  assert.equal(learning[0].data.segment.goal, "strength");
  const notice = await db.tenant(worker(coach.tenantId), (tx) => tx.query("SELECT * FROM notifications WHERE user_id=$1 AND dedupe_key=$2", [client.userId, "brain-plan:" + gen.id]));
  assert.equal(notice.length, 1);
  // A decided plan cannot be decided twice.
  assert.equal((await req(`/brain/plans/${gen.id}/review`, "POST", { action: "approve", version: gen.version + 1 }, coach)).statusCode, 409);
});

test("validator rejections route to review, cannot be approved as-is, and a trainer edit is validated and learned with its diff", async () => {
  const client = await member(coach, "Invalid Draft Client");
  override = (body) => {
    const { kind } = classifyPrompt(body);
    if (kind !== "plan_generation") return undefined;
    const plan: any = ruleBasedAnswer(body).content;
    plan.sessions[0].exercises[0] = { ...plan.sessions[0].exercises[0], name: "Barbell back squat" };
    return plan;
  };
  let r;
  try {
    r = await req("/brain/plans/generate", "POST", { subscriberId: client.userId }, coach);
  } finally {
    override = undefined;
  }
  assert.equal(r.statusCode, 200, r.body);
  const gen = await generation(r.json().generationId, coach.tenantId);
  assert.equal(gen.status, "pending_review");
  assert.match(gen.data.validation.errors.join("\n"), /Barbell back squat needs barbell, squat rack/);
  assert.equal(gen.data.confidence.confident, false);
  const refused = await req(`/brain/plans/${gen.id}/review`, "POST", { action: "approve", version: gen.version }, coach);
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.json().code ?? "PLAN_INVALID", "PLAN_INVALID");
  const { selfConfidence: _s, uncertainties: _u, evidenceIds: _e, ...editable } = gen.data.draft;
  editable.sessions[0].exercises[0] = { ...editable.sessions[0].exercises[0], name: "Goblet squat", sets: 2 };
  editable.sessions[0].exercises = editable.sessions[0].exercises.filter(
    (e: any, i: number, all: any[]) => all.findIndex((x) => x.name === e.name) === i,
  );
  const badEdit = await req(`/brain/plans/${gen.id}/review`, "POST", { action: "edit", version: gen.version, plan: { ...editable, sessions: editable.sessions.map((s: any) => ({ ...s, exercises: s.exercises.map((e: any) => ({ ...e, restSeconds: 5 * 60 })) })) } }, coach);
  assert.equal(badEdit.statusCode, 400, badEdit.body);
  const edited = await req(`/brain/plans/${gen.id}/review`, "POST", { action: "edit", version: gen.version, plan: editable, note: "Use goblet squats without a rack" }, coach);
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().decision, "edited");
  const after = await generation(gen.id, coach.tenantId);
  assert.ok(after.data.diff.some((d: any) => /Barbell back squat/.test(d.path) || /Goblet squat/.test(d.path)));
  const [learning] = await db.tenant(worker(coach.tenantId), (tx) => tx.query("SELECT * FROM records WHERE kind='plan_learning' AND data->>'generationId'=$1", [gen.id]));
  assert.equal(learning.data.decision, "edited");
  assert.ok(learning.data.diff.length >= 1);
  assert.equal(learning.data.note, "Use goblet squats without a rack");
});

test("learning from reviews changes later retrieval and confidence; qualification gates automatic delivery with spot checks", async () => {
  // Two reviewed plans exist for the beginner-strength segment (approved, edited).
  const first = await member(coach, "Learner One");
  const r1 = (await req("/brain/plans/generate", "POST", { subscriberId: first.userId }, coach)).json();
  const g1 = await generation(r1.generationId, coach.tenantId);
  const lastPrompt = prompts.filter((p) => p.kind === "plan_generation").at(-1);
  assert.ok(lastPrompt.input.material.examples.length >= 2, "reviewed plans are retrieved as private examples");
  assert.ok(g1.data.retrieval.examples.length >= 2);
  // Approve it: now three similar reviews.
  assert.equal((await req(`/brain/plans/${g1.id}/review`, "POST", { action: "approve", version: g1.version }, coach)).statusCode, 200);
  const second = await member(coach, "Learner Two");
  const r2 = (await req("/brain/plans/generate", "POST", { subscriberId: second.userId }, coach)).json();
  const g2 = await generation(r2.generationId, coach.tenantId);
  assert.ok(g2.data.confidence.signals.caseCoverage > g1.data.confidence.signals.caseCoverage);
  assert.ok(g2.data.confidence.score > g1.data.confidence.score);
  // Still supervised: qualification has not passed.
  assert.equal(g2.status, "pending_review");
  assert.equal((await req(`/brain/plans/${g2.id}/review`, "POST", { action: "reject", version: g2.version, note: "I want to write this one myself" }, coach)).statusCode, 200);
  // Qualify: four deliverable scenarios need model plans; two are stopped by the code safety floor.
  const before = calls.length;
  const qualification = await qualify(coach);
  assert.equal(qualification.status, "passed", JSON.stringify(qualification.data.outcomes));
  assert.equal(calls.length - before, 4);
  assert.deepEqual(
    qualification.data.outcomes.filter((o: any) => o.gate === "code_safety").length,
    2,
  );
  await saveSettings(coach, { threshold: 0.7, spotCheckRate: 1, youngBrainReviews: 100 });
  const third = await member(coach, "Automatic Client");
  const r3 = await req("/brain/plans/generate", "POST", { subscriberId: third.userId }, coach);
  assert.equal(r3.statusCode, 200, r3.body);
  assert.equal(r3.json().status, "delivered", JSON.stringify(r3.json()));
  assert.equal(r3.json().spotCheck, true);
  const g3 = await generation(r3.json().generationId, coach.tenantId);
  assert.equal(g3.data.route, "automatic");
  assert.equal(g3.data.qualified, true);
  assert.equal(g3.data.outcome.spotCheck, "pending");
  const ws = await workspace(coach);
  assert.ok(ws.queue.some((q: any) => q.id === g3.id), "the spot check is in the trainer's queue");
  assert.equal(ws.qualification.qualified, true);
  assert.ok(ws.stats.reviewed >= 4 && ws.stats.young === true);
  assert.equal((await req(`/brain/plans/${g3.id}/review`, "POST", { action: "approve", version: g3.version }, coach)).statusCode, 200);
  const checked = await generation(g3.id, coach.tenantId);
  assert.equal(checked.data.outcome.spotCheck, "approved");
  assert.equal(checked.status, "delivered");
  // Changing the bounds changes the pinned contract: supervised again until requalified.
  await saveSettings(coach, { bounds: { ...ws.settings.bounds, maxSessionMinutes: 90 } });
  const fourth = await member(coach, "Requalify Client");
  const r4 = (await req("/brain/plans/generate", "POST", { subscriberId: fourth.userId }, coach)).json();
  assert.equal(r4.status, "pending_review");
  await saveSettings(coach, { bounds: { ...ws.settings.bounds, maxSessionMinutes: 75 } });
});

test("the safety floor sends medical limitations, red flags and recent pain to the trainer regardless of confidence", async () => {
  // The workspace is qualified (previous test) with threshold 0.7.
  const limited = await member(coach, "Limited Client", { limitations: "Recovering from a knee injury" });
  const r = (await req("/brain/plans/generate", "POST", { subscriberId: limited.userId }, coach)).json();
  assert.equal(r.status, "pending_review");
  const g = await generation(r.generationId, coach.tenantId);
  assert.ok(g.data.safety.some((s: string) => /medical limitation/.test(s)));
  assert.ok(g.data.routeReasons.some((s: string) => s.startsWith("Safety:")));
  const pained = await member(coach, "Pain Report Client");
  await db.tenant(worker(coach.tenantId), (tx) =>
    putRecord(tx, worker(coach.tenantId), "training_hold", { reason: "Reported pain", resolvedBy: coach.userId }, { ownerId: pained.userId, status: "resolved" }),
  );
  const p = (await req("/brain/plans/generate", "POST", { subscriberId: pained.userId }, coach)).json();
  assert.equal(p.status, "pending_review");
  const gp = await generation(p.generationId, coach.tenantId);
  assert.ok(gp.data.safety.some((s: string) => /pain or safety report/.test(s)));
  const flagged = await member(coach, "Red Flag Client", { goal: "Get fit again after fainting during exercise" });
  const f = (await req("/brain/plans/generate", "POST", { subscriberId: flagged.userId }, coach)).json();
  assert.equal(f.status, "pending_review");
  // An active hold blocks generation entirely.
  const held = await member(coach, "Held Client");
  await db.tenant(worker(coach.tenantId), (tx) =>
    putRecord(tx, worker(coach.tenantId), "training_hold", { reason: "Chest pain" }, { ownerId: held.userId, status: "active" }),
  );
  const h = await req("/brain/plans/generate", "POST", { subscriberId: held.userId }, coach);
  assert.equal(h.statusCode, 409);
});

test("the worker schedules first plans and weekly adaptations; adaptation applies validated changes or routes pain to review", async () => {
  const client = await member(coach, "Worker Client", {}, { programmeDays: 28 });
  const queued = await scheduleBrainPlans(db, coach.tenantId, { force: true });
  assert.ok(queued >= 1);
  let job;
  for (let i = 0; i < 50; i++) {
    job = await claimJob(db, coach.tenantId);
    if (!job) break;
    await runClaimedJob(db, coach.tenantId, job);
    if (job.kind === "brain_plan" && job.data.userId === client.userId) break;
  }
  assert.equal(job?.kind, "brain_plan");
  const [gen] = await db.tenant(worker(coach.tenantId), (tx) =>
    tx.query("SELECT * FROM records WHERE kind='plan_generation' AND owner_user_id=$1 AND data->>'jobId'=$2", [client.userId, job!.id]),
  );
  assert.ok(gen, "the job produced a generation");
  assert.equal(gen.data.trigger, "intake");
  const [jobRow] = await db.tenant(worker(coach.tenantId), (tx) => tx.query("SELECT status FROM jobs WHERE id=$1", [job!.id]));
  assert.equal(jobRow.status, "completed");
  // Re-running the same job never pays the model twice.
  const before = calls.length;
  const again = await executeBrainPlanJob(db, coach.tenantId, job);
  assert.equal(again.status, "skipped");
  assert.equal(calls.length, before);
  // Deliver (spot check or review) so there is a programme to adapt.
  let program: any;
  if (gen.status === "pending_review")
    assert.equal((await req(`/brain/plans/${gen.id}/review`, "POST", { action: "approve", version: gen.version }, coach)).statusCode, 200);
  [program] = await db.tenant(worker(coach.tenantId), (tx) =>
    tx.query("SELECT * FROM records WHERE kind='program' AND owner_user_id=$1 AND status='assigned'", [client.userId]),
  );
  assert.ok(program.data.generated);
  // Week 1 was completed with every set logged at the prescribed RIR.
  await db.tenant(worker(coach.tenantId), async (tx) => {
    const week1 = await tx.query("SELECT * FROM records WHERE kind='planned_session' AND data->>'programId'=$1 AND (data->>'week')::int=1", [program.id]);
    for (const s of week1) {
      const workout = await putRecord(tx, worker(coach.tenantId), "workout", { programId: program.id, plannedSessionId: s.id, program: s.data.program }, { ownerId: client.userId, status: "completed" });
      await tx.query("UPDATE records SET status='completed',version=version+1 WHERE id=$1", [s.id]);
      for (const e of s.data.program.exercises)
        for (let set = 1; set <= e.sets; set++)
          await tx.query("INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data) VALUES($1,$2,$3,$4,$5,$6)", [
            randomUUID(), coach.tenantId, client.userId, workout.id, randomUUID(),
            JSON.stringify({ exercise: e.name, set, reps: e.reps, loadKg: e.loadKg, rir: e.rir }),
          ]);
    }
  });
  const nextBefore = await db.tenant(worker(coach.tenantId), (tx) =>
    tx.query("SELECT * FROM records WHERE kind='planned_session' AND data->>'programId'=$1 AND (data->>'week')::int=2 ORDER BY data->>'date'", [program.id]),
  );
  const loadsBefore = nextBefore.flatMap((s) => s.data.program.exercises.map((e: any) => e.loadKg));
  const adapted = await adaptMemberPlan(db, worker(coach.tenantId), client.userId, { programId: program.id, week: 2 });
  assert.ok(["delivered", "pending_review"].includes(adapted.status), JSON.stringify(adapted));
  const ag = await generation(adapted.generationId!, coach.tenantId);
  assert.equal(ag.data.type, "adaptation");
  assert.equal(ag.data.inputs.outcomes.adherence, 1);
  assert.ok(ag.data.proposal.changes.length >= 1);
  assert.deepEqual(ag.data.validation.errors, []);
  if (ag.status === "pending_review")
    assert.equal((await req(`/brain/plans/${ag.id}/review`, "POST", { action: "approve", version: ag.version }, coach)).statusCode, 200);
  const nextAfter = await db.tenant(worker(coach.tenantId), (tx) =>
    tx.query("SELECT * FROM records WHERE kind='planned_session' AND data->>'programId'=$1 AND (data->>'week')::int=2 ORDER BY data->>'date'", [program.id]),
  );
  const loadsAfter = nextAfter.flatMap((s) => s.data.program.exercises.map((e: any) => e.loadKg));
  assert.ok(loadsAfter.some((l, i) => l > loadsBefore[i]), "next week's loads were raised");
  assert.ok(nextAfter.every((s) => s.data.adaptationId === ag.id));
  // A pain report skips the model and queues the unchanged week for the trainer.
  await db.tenant(worker(coach.tenantId), (tx) =>
    putRecord(tx, worker(coach.tenantId), "training_hold", { reason: "Knee pain" }, { ownerId: client.userId, status: "resolved" }),
  );
  const callsBefore = calls.length;
  const pain = await adaptMemberPlan(db, worker(coach.tenantId), client.userId, { programId: program.id, week: 3 });
  assert.equal(pain.status, "skipped");
  assert.equal((pain as any).reason, "safety_review");
  assert.equal(calls.length, callsBefore);
  const pg = await generation(pain.generationId!, coach.tenantId);
  assert.equal(pg.status, "pending_review");
  assert.ok(pg.data.safety.length >= 1);
});

test("the next block is prepared before a Brain block ends and the running block is handed over, not cut short", async () => {
  const client = await member(coach, "Block Client", {}, { programmeDays: 14 });
  const r = (await req("/brain/plans/generate", "POST", { subscriberId: client.userId }, coach)).json();
  let g = await generation(r.generationId, coach.tenantId);
  if (g.status === "pending_review")
    assert.equal((await req(`/brain/plans/${g.id}/review`, "POST", { action: "approve", version: g.version }, coach)).statusCode, 200);
  g = await generation(r.generationId, coach.tenantId);
  if (g.data.outcome?.spotCheck === "pending")
    assert.equal((await req(`/brain/plans/${g.id}/review`, "POST", { action: "approve", version: g.version }, coach)).statusCode, 200);
  const current = await db.tenant(worker(coach.tenantId), async (tx) => {
    const [p] = await tx.query("SELECT * FROM records WHERE kind='program' AND owner_user_id=$1 AND status='assigned'", [client.userId]);
    // The block ends in two days.
    const endDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    await tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [p.id, JSON.stringify({ endDate })]);
    return { ...p, data: { ...p.data, endDate } } as any;
  });
  await scheduleBrainPlans(db, coach.tenantId, { force: true });
  const [job] = await db.tenant(worker(coach.tenantId), (tx) =>
    tx.query("SELECT * FROM jobs WHERE kind='brain_plan' AND intent_key=$1", [`brain-plan:${coach.tenantId}:${client.userId}:block:${current.id}`]),
  );
  assert.ok(job, "a next-block job was queued");
  assert.equal(job.data.trigger, "block_end");
  const next = await executeBrainPlanJob(db, coach.tenantId, job);
  const ng = await generation((next as any).generationId, coach.tenantId);
  assert.ok(ng.data.inputs.startDate > current.data.endDate);
  assert.equal(ng.data.trigger, "block_end");
  if (ng.status === "pending_review")
    assert.equal((await req(`/brain/plans/${ng.id}/review`, "POST", { action: "approve", version: ng.version }, coach)).statusCode, 200);
  const programs = await db.tenant(worker(coach.tenantId), (tx) =>
    tx.query("SELECT id,status FROM records WHERE kind='program' AND owner_user_id=$1 ORDER BY created_at", [client.userId]),
  );
  assert.equal(programs.find((p) => p.id === current.id)!.status, "assigned", "the running block stays assigned for its last days");
  assert.equal(programs.filter((p) => p.status === "assigned").length, 2);
  // Once the old block's last date has passed everywhere, the worker archives it.
  await db.tenant(worker(coach.tenantId), (tx) =>
    tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [current.id, JSON.stringify({ endDate: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) })]),
  );
  await scheduleBrainPlans(db, coach.tenantId, { force: true });
  const [archived] = await db.tenant(worker(coach.tenantId), (tx) => tx.query("SELECT status FROM records WHERE id=$1", [current.id]));
  assert.equal(archived.status, "archived");
});

test("plans, queues and learning stay inside their workspace", async () => {
  const client = await member(coach, "Isolation Client");
  const r = (await req("/brain/plans/generate", "POST", { subscriberId: client.userId }, coach)).json();
  const g = await generation(r.generationId, coach.tenantId);
  // Another trainer cannot see or decide it, or generate for this member.
  const foreignWs = await workspace(foreign);
  assert.equal(foreignWs.queue.length, 0);
  assert.equal(foreignWs.stats.reviewed, 0);
  assert.equal((await req(`/brain/plans/${g.id}/review`, "POST", { action: "approve", version: g.version }, foreign)).statusCode, 404);
  assert.equal((await req("/brain/plans/generate", "POST", { subscriberId: client.userId }, foreign)).statusCode, 409);
  // Members cannot reach trainer routes.
  assert.equal((await req("/brain/plans/workspace", "GET", undefined, client)).statusCode, 403);
  assert.equal((await req(`/brain/plans/${g.id}/review`, "POST", { action: "approve", version: g.version }, client)).statusCode, 403);
  assert.equal((await req("/brain/plans/settings", "PUT", { settings: defaultPlanSettings(), version: null }, client)).statusCode, 403);
  // Retrieval never admits another workspace's learning rows.
  const rows = await db.tenant(worker(coach.tenantId), (tx) => tx.query("SELECT * FROM records WHERE kind='plan_learning' AND status='confirmed'"));
  assert.ok(rows.length > 0);
  const retrieved = retrievePlanMaterial({ tenantId: foreign.tenantId, segment: rows[0].data.segment, goal: "Build strength", rules: [], cases: [], learning: rows, templates: [], library });
  assert.equal(retrieved.material.examples.length, 0);
  // The follower's own status helper answers only about itself.
  const other = await db.tenant({ tenantId: coach.tenantId, userId: client.userId, role: "subscriber" }, (tx) => tx.query("SELECT * FROM member_plan_status()"));
  assert.equal(other[0].state, g.status === "delivered" ? "delivered" : "in_review");
});
