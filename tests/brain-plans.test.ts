// Trainer Brain plan generation, review, learning, adaptation and
// qualification (docs/features/brain-plans.md), with a scripted fake model:
// the e2e rule responder by default, overridden per test. Every end-to-end
// test builds its own workspace (Brain, library, settings, qualification),
// so tests do not depend on each other's order.
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
  planRoute,
  planSafetyReasons,
  planSegment,
  ruleCoverage,
  validateAdaptedWeek,
  validatePlan,
  defaultPlanSettings,
  type PlanDraft,
} from "../packages/domain/src/brain-plans.ts";
import { planGenerationBudget, retrievePlanMaterial } from "../packages/providers/src/brain-plans.ts";
import { classifyPrompt, ruleBasedAnswer } from "./e2e/mocks/model-rules.ts";
import { MESSAGE_KINDS } from "../apps/api/src/message-templates.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
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
const prompts: Array<{ kind: string; input: any; maxTokens: number }> = [];
/** Replaces the rule responder's content for one prompt (undefined keeps it). */
let override: ((body: any) => unknown) | undefined;
/** Runs while the model call is in flight (outside every transaction). */
let during: ((kind: string) => Promise<void>) | undefined;

let address = 0;
async function req(path: string, method: any = "GET", payload?: any, actor?: any) {
  return app.inject({
    url: "/api/v1" + path,
    method,
    payload,
    // Each workspace signs up from its own address (sign-up is rate limited per address).
    ...(path === "/auth/register" ? { remoteAddress: `10.44.${(++address >> 8) & 255}.${address & 255}` } : {}),
    headers: { origin: "http://localhost:3000", ...(actor ? { cookie: actor.cookie } : {}) },
  });
}
async function register(label: string) {
  const slug = `pb-${label}-${randomUUID().slice(0, 6)}`;
  const r = await req("/auth/register", "POST", {
    name: "Coach " + label,
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
const asWorker = (coach: any, fn: (tx: any) => Promise<any>): Promise<any> => db.tenant(worker(coach.tenantId), fn);
type MemberOptions = {
  timezone?: string;
  programmeDays?: number;
  billing?: "monthly" | "upfront";
  periodEndDays?: number;
  cancelAtPeriodEnd?: boolean;
};
async function member(
  owner: any,
  name: string,
  profile: { goal?: string; experience?: string; daysPerWeek?: number; equipment?: string; limitations?: string } = {},
  options: MemberOptions = {},
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
  await asWorker(owner, async (tx) => {
    let productId: string | null = null;
    if (options.programmeDays) {
      const product = await putRecord(
        tx,
        worker(owner.tenantId),
        "product",
        { name: "Programme offer", priceMinor: 10000, tier: "workout", programmeDays: options.programmeDays, billing: options.billing ?? "monthly" },
        { status: "published", ownerId: owner.userId },
      );
      productId = product.id;
    }
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor,cancel_at_period_end,data) VALUES($1,$2,$3,'active',now()+make_interval(days=>$5),10000,$6,$4)",
      [randomUUID(), owner.tenantId, client.userId, JSON.stringify(productId ? { productId } : {}), options.periodEndDays ?? 30, options.cancelAtPeriodEnd ?? false],
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
  await asWorker(owner, async (tx) => {
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
  // Every exercise and alternative is tagged, so plans are fully checked.
  for (const exercise of [
    { name: "Goblet squat", equipment: ["dumbbells"], alternatives: [{ name: "Bodyweight squat", cue: "Sit back" }] },
    { name: "Dumbbell bench press", equipment: ["dumbbells", "bench"], alternatives: [{ name: "Push-up", cue: "Brace" }] },
    { name: "One-arm dumbbell row", equipment: ["dumbbells", "bench"] },
    { name: "Romanian deadlift", equipment: ["dumbbells"] },
    { name: "Plank", equipment: ["bodyweight"] },
    { name: "Bodyweight squat", equipment: ["bodyweight"] },
    { name: "Push-up", equipment: ["bodyweight"] },
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
async function newCoach(label: string) {
  const coach = await register(label);
  await seedBrain(coach);
  return coach;
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
const base = { goal: "Build strength", experience: "beginner", daysPerWeek: 3, equipment: "Dumbbells, bench", limitations: "None reported" };
const planned = (name: string, loadKg: number) => ({ name, sets: 3, reps: 10, loadKg, rir: 3, restSeconds: 90, cue: "", alternatives: [] });
const scenarioWeek = [
  { sessionKey: "A", exercises: [planned("Goblet squat", 20), planned("Dumbbell bench press", 20)] },
  { sessionKey: "B", exercises: [planned("Romanian deadlift", 20), planned("Plank", 0)] },
];
const programmeScenarios = [
  { title: "Beginner three days", profile: base, programmeDays: 28, expected: "deliverable" },
  { title: "Beginner two days", profile: { ...base, daysPerWeek: 2 }, programmeDays: 14, expected: "deliverable" },
  { title: "Intermediate four days", profile: { ...base, experience: "intermediate", daysPerWeek: 4 }, programmeDays: 28, expected: "deliverable" },
  { title: "Muscle focus", profile: { ...base, goal: "Build muscle" }, programmeDays: 21, expected: "deliverable" },
  { title: "Knee surgery", profile: { ...base, limitations: "Recovering from knee surgery" }, programmeDays: 28, expected: "review" },
  { title: "Chest pain", profile: { ...base, goal: "Train again after chest pain last week" }, programmeDays: 28, expected: "review" },
  // No safety term: only low confidence (no rules for runners) sends it to the trainer.
  { title: "Advanced runner", profile: { goal: "Run a marathon", experience: "advanced", daysPerWeek: 6, equipment: "Full gym access", limitations: "None reported" }, programmeDays: 28, expected: "review" },
];
const adaptationScenarios = [
  { type: "adaptation", title: "Full week at plan effort", profile: base, week: scenarioWeek, outcomes: { adherence: 1, rirDelta: 0, painReported: false }, expected: "deliverable" },
  { type: "adaptation", title: "Missed most of the week", profile: base, week: scenarioWeek, outcomes: { adherence: 0.3, rirDelta: 0, painReported: false }, expected: "review" },
  { type: "adaptation", title: "Knee pain this week", profile: base, week: scenarioWeek, outcomes: { adherence: 1, rirDelta: 0, painReported: true }, expected: "review" },
];
async function addScenarios(owner: any, scenarios: any[]) {
  const ids: string[] = [];
  for (const s of scenarios) {
    const r = await req("/brain/plans/scenarios", "POST", s, owner);
    assert.equal(r.statusCode, 200, r.body);
    ids.push(r.json().id);
  }
  return ids;
}
async function qualify(owner: any) {
  const q = await req("/brain/plans/qualify", "POST", {}, owner);
  assert.equal(q.statusCode, 200, q.body);
  return q.json();
}
/** A workspace with its own Brain, threshold 0.55, no spot checks, qualified for plans and adjustments. */
async function qualifiedCoach(label: string, settings: any = {}) {
  const coach = await newCoach(label);
  await saveSettings(coach, { threshold: 0.55, spotCheckRate: 0, ...settings });
  await addScenarios(coach, [...programmeScenarios, ...adaptationScenarios]);
  const q = await qualify(coach);
  assert.equal(q.status, "passed", JSON.stringify(q.data.outcomes));
  return coach;
}
const assigned = async (coach: any, userId: string) =>
  (await asWorker(coach, (tx) => tx.query("SELECT * FROM records WHERE kind='program' AND owner_user_id=$1 AND status='assigned' ORDER BY created_at DESC", [userId]))) as any[];
async function generate(coach: any, client: any) {
  const r = await req("/brain/plans/generate", "POST", { subscriberId: client.userId }, coach);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
/** Completes every session of a programme week with each set at the prescribed load and RIR. */
async function logWeek(coach: any, client: any, programId: string, week: number) {
  await asWorker(coach, async (tx) => {
    const rows = await tx.query("SELECT * FROM records WHERE kind='planned_session' AND data->>'programId'=$1 AND (data->>'week')::int=$2", [programId, week]);
    for (const s of rows) {
      const workout = await putRecord(tx, worker(coach.tenantId), "workout", { programId, plannedSessionId: s.id, program: s.data.program }, { ownerId: client.userId, status: "completed" });
      await tx.query("UPDATE records SET status='completed',version=version+1 WHERE id=$1", [s.id]);
      for (const e of s.data.program.exercises)
        for (let set = 1; set <= e.sets; set++)
          await tx.query("INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data) VALUES($1,$2,$3,$4,$5,$6)", [
            randomUUID(), coach.tenantId, client.userId, workout.id, randomUUID(),
            JSON.stringify({ exercise: e.name, set, reps: e.reps, loadKg: e.loadKg, rir: e.rir }),
          ]);
    }
  });
}
const weekLoads = async (coach: any, programId: string, week: number) =>
  (
    await asWorker(coach, (tx) =>
      tx.query("SELECT * FROM records WHERE kind='planned_session' AND data->>'programId'=$1 AND (data->>'week')::int=$2 ORDER BY data->>'date',id", [programId, week]),
    )
  ).flatMap((s: any) => s.data.program.exercises.map((e: any) => e.loadKg)) as number[];
async function withDailyLimit<T>(limit: string, fn: () => Promise<T>) {
  const prior = process.env.MODEL_MAX_DAILY_CALLS;
  process.env.MODEL_MAX_DAILY_CALLS = limit;
  try {
    return await fn();
  } finally {
    process.env.MODEL_MAX_DAILY_CALLS = prior;
  }
}
async function insertJob(coach: any, data: any) {
  const [job] = await asWorker(coach, (tx) =>
    tx.query("INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,'brain_plan',$3,$4) RETURNING *", [randomUUID(), coach.tenantId, "test:" + randomUUID(), JSON.stringify(data)]),
  );
  return job;
}

before(async () => {
  Object.assign(process.env, config);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const { kind, input } = classifyPrompt(body);
    calls.push(kind);
    prompts.push({ kind, input, maxTokens: body.max_tokens });
    if (during) await during(kind);
    const content = override?.(body) ?? ruleBasedAnswer(body).content;
    return Response.json({
      id: "plan-fixture-call",
      usage: { prompt_tokens: 200, completion_tokens: 100 },
      choices: [{ message: { content: JSON.stringify(content) } }],
    });
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
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
// Code validator, confidence, route and diff (no database)

const library = planLibrary(
  [
    { id: randomUUID(), data: { name: "Goblet squat", equipment: ["dumbbells"], alternatives: [{ name: "Box squat" }] } },
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
const one = (e: any) => draft({ sessions: [{ key: "A", label: "A", weekday: 1, exercises: [e] }] });

test("the code validator accepts a bounded plan and rejects each hard-bound breach", () => {
  const ok = validatePlan(draft(), ctx);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.metrics.weeklyVolume, [15, 15, 15, 10]);
  // Plank has no equipment tags: allowed but unchecked (the route holds it back).
  assert.ok(ok.warnings.some((w) => /Equipment is unchecked for Plank/.test(w)));
  assert.deepEqual(ok.metrics.untaggedExercises, ["Plank"]);
  // An untagged approved alternative is unchecked too.
  assert.deepEqual(validatePlan(one(exercise("Goblet squat", { alternatives: ["Box squat"] })), ctx).metrics.untaggedExercises, ["Box squat"]);
  const errors = (d: PlanDraft, c: any = ctx) => validatePlan(d, c).errors.join("\n");
  assert.match(errors(one(exercise("Cable fly"))), /Cable fly is not in the trainer's exercise library/);
  assert.match(errors(one(exercise("Barbell back squat"))), /needs barbell, which the subscriber does not have/);
  assert.match(errors(one(exercise("Goblet squat", { restSeconds: 20 }))), /rest 20s is outside 30-240s/);
  assert.match(errors(one(exercise("Goblet squat", { rir: 0 }))), /takes a beginner to failure/);
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

test("first-week loads are bounded by logged or library loads, else by the trainer's start cap", () => {
  const withReference = { ...ctx, loadReference: new Map([["goblet squat", 20]]) };
  const errors = (d: PlanDraft, c: any = withReference) => validatePlan(d, c).errors.join("\n");
  // Within one load jump of the reference, and at the beginner cap (20 kg) without one.
  const fine = validatePlan(draft(), withReference);
  assert.deepEqual(fine.errors, []);
  assert.deepEqual(fine.metrics.unreferencedLoads, ["Dumbbell bench press"]);
  assert.match(errors(one(exercise("Dumbbell bench press", { loadKg: 200 }))), /Week 1: Dumbbell bench press starts at 200 kg with no logged or library load \(your start limit for beginner subscribers is 20 kg\)/);
  assert.match(errors(one(exercise("Goblet squat", { loadKg: 30 }))), /Week 1: Goblet squat starts at 30 kg, above the member's reference 20 kg/);
  assert.equal(errors(one(exercise("Goblet squat", { loadKg: 22 }))), "");
  // The trainer's cap is a setting; a trainer's own edit is not capped.
  const raised = { ...withReference, bounds: { ...ctx.bounds, startLoadCapKg: { beginner: 250, intermediate: 250, advanced: 250 } } };
  assert.equal(errors(one(exercise("Dumbbell bench press", { loadKg: 200 })), raised), "");
  assert.equal(errors(one(exercise("Dumbbell bench press", { loadKg: 200 })), ctx), "");
  // A new block: exercises in the previous week use the jump bound, new ones the reference.
  assert.match(errors(one(exercise("Dumbbell bench press", { loadKg: 60 })), { ...withReference, previousWeek: [{ key: "A", exercises: [exercise("Goblet squat")] }] }), /Dumbbell bench press starts at 60 kg with no logged or library load/);
  // An adjustment that swaps in an exercise with no reference is capped too.
  const swapped = validateAdaptedWeek(
    [{ key: "A", exercises: [exercise("Goblet squat")] }],
    [{ key: "A", exercises: [exercise("Dumbbell bench press", { loadKg: 60 })] }],
    { ...ctx, loadReference: new Map() },
  );
  assert.match(swapped.errors.join("\n"), /Next week: Dumbbell bench press starts at 60 kg with no logged or library load/);
});

test("confidence is deterministic, explained and raised by similar reviewed plans; the route gate holds back unchecked equipment", () => {
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
  const other = planSegment({ goal: "Run a marathon", experience: "advanced", daysPerWeek: 5, equipment: "" });
  assert.equal(caseCoverage(segment, [...learned, { decision: "rejected", segment }]).score, 2 / 3);
  assert.equal(caseCoverage(segment, [{ decision: "approved", segment: other }]).score, 0);
  const invalid = planConfidence({ ruleCoverage: ruleCoverage(segment, rules), caseCoverage: caseCoverage(segment, learned), validation: validatePlan(draft(), { ...ctx, programmeDays: 35 }), selfConfidence: 1, uncertainties: [], threshold: 0.5 });
  assert.equal(invalid.confident, false);
  assert.deepEqual(planSafetyReasons({ limitations: "None reported", redFlags: [], painReports: 0 }), []);
  assert.equal(planSafetyReasons({ limitations: "Old shoulder injury", redFlags: [], painReports: 1 }).length, 2);
  // The gate: a confident plan with an untagged exercise goes to the trainer
  // unless the subscriber has a full gym; safety and mode always win.
  const confident = planConfidence({ ruleCoverage: ruleCoverage(segment, rules), caseCoverage: caseCoverage(segment, learned), validation, selfConfidence: 0.9, uncertainties: [], threshold: 0.5 });
  assert.equal(confident.confident, true);
  const route = (patch: any = {}) => planRoute({ type: "programme", mode: "automatic", qualified: true, safety: [], confidence: confident, validation, equipment: "Dumbbells, bench", ...patch });
  assert.equal(route().route, "review");
  assert.match(route().reasons.join("\n"), /Equipment is unchecked for Plank/);
  assert.equal(route({ equipment: "Full gym access" }).route, "automatic");
  assert.deepEqual(route({ equipment: "Full gym access" }).reasons, []);
  assert.equal(route({ equipment: "Full gym access", safety: ["Reported pain"] }).route, "review");
  assert.equal(route({ equipment: "Full gym access", mode: "supervised" }).route, "review");
  assert.equal(route({ equipment: "Full gym access", qualified: false }).route, "review");
  assert.equal(route({ equipment: "Full gym access", holds: ["A hand-written programme"] }).route, "review");
  const edited = draft();
  edited.sessions[0].exercises[0].sets = 4;
  assert.deepEqual(planDiff(draft(), edited), [{ path: "sessions.A.exercises.Goblet squat.sets", from: 3, to: 4 }]);
});

test("the e2e rule responder answers both prompt kinds with schema-valid output, and long programmes get a larger budget", () => {
  const body = (system: string, input: any) => ({ messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(input) }] });
  const retrieval = retrievePlanMaterial({ tenantId: "t", segment: planSegment({ goal: "Build strength", experience: "beginner", daysPerWeek: 3, equipment: "Dumbbells, bench" }), goal: "Build strength", rules: [], cases: [], learning: [], templates: [], library });
  const plan = ruleBasedAnswer(body("Trainer Brain plan generator brain-plan-v2.", { profile: { daysPerWeek: 3, experience: "beginner", equipment: "Dumbbells, bench" }, programme: { weeks: 4 }, bounds: ctx.bounds, material: retrieval.material }));
  assert.equal(plan.kind, "plan_generation");
  assert.deepEqual(validatePlan(plan.content as PlanDraft, ctx).errors, []);
  const adaptation = ruleBasedAnswer(body("Trainer Brain plan adaptation brain-plan-adapt-v1.", { outcomes: { adherence: 1, exercises: [] }, nextWeek: [], material: { rules: [] } }));
  assert.equal(adaptation.kind, "plan_adaptation");
  assert.deepEqual((adaptation.content as any).changes, []);
  const short = planGenerationBudget({ daysPerWeek: 3, weeks: 4 }),
    longest = planGenerationBudget({ daysPerWeek: 7, weeks: 53 });
  assert.ok(short.maxTokens >= 6000 && short.timeoutMs >= 30000);
  assert.ok(longest.maxTokens > short.maxTokens + 5000 && longest.maxTokens <= 16000);
  assert.ok(longest.timeoutMs > short.timeoutMs && longest.timeoutMs <= 240000);
});

test("new notification template keys are registered", () => {
  const keys = new Set(MESSAGE_KINDS.map((k) => k.templateKey));
  for (const key of ["brain-plan-ready", "brain-plan-adjusted", "brain-plan-withdrawn", "brain-plan-review"])
    assert.ok(keys.has(key), key);
});

// ---------------------------------------------------------------------------
// End to end

test("supervised generation goes to review with its audit record, and approval delivers dated sessions in the member's timezone without the model's internals", async () => {
  const coach = await newCoach("supervised");
  const client = await member(coach, "Supervised Client", {}, { timezone: "Pacific/Kiritimati", programmeDays: 14 });
  const before = calls.length;
  const r = await generate(coach, client);
  assert.equal(r.status, "pending_review");
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1), "plan_generation");
  const gen = await generation(r.generationId, coach.tenantId);
  assert.equal(gen.status, "pending_review");
  assert.equal(gen.owner_user_id, client.userId);
  assert.equal(gen.data.promptVersion, "brain-plan-v2");
  assert.match(gen.data.inputsDigest, /^[0-9a-f]{64}$/);
  assert.ok(gen.data.brainReleaseId);
  assert.equal(gen.data.inputs.programmeDays, 14);
  assert.equal(gen.data.inputs.timezone, "Pacific/Kiritimati");
  assert.equal(gen.data.qualified, false);
  assert.deepEqual(gen.data.validation.errors, []);
  assert.ok(gen.data.confidence.signals && typeof gen.data.confidence.score === "number");
  assert.ok(gen.data.routeReasons.some((x: string) => /qualification has not passed/.test(x)));
  assert.ok(gen.data.retrieval.rules.length >= 1);
  const mine = await req("/brain/plans/mine", "GET", undefined, client);
  assert.equal(mine.statusCode, 200, mine.body);
  assert.equal(mine.json().status.state, "in_review");
  assert.equal(mine.json().program, null);
  const member_ = { tenantId: coach.tenantId, userId: client.userId, role: "subscriber" };
  const hidden = await db.tenant(member_, (tx) => tx.query("SELECT id FROM records WHERE kind IN ('plan_generation','plan_learning','plan_brain_settings','plan_schedule_state')"));
  assert.equal(hidden.length, 0);
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
  // The member's programme record carries the projected plan only.
  const [program] = await db.tenant(member_, (tx) => tx.query("SELECT data FROM records WHERE kind='program' AND status='assigned'"));
  assert.equal(program.data.draft, undefined);
  assert.equal(program.data.brainReleaseId, undefined);
  assert.equal(program.data.planWeeks.length, 2);
  assert.doesNotMatch(JSON.stringify(program.data), /selfConfidence|uncertainties|evidenceIds/);
  const learning = await asWorker(coach, (tx) => tx.query("SELECT * FROM records WHERE kind='plan_learning' AND data->>'generationId'=$1", [gen.id]));
  assert.equal(learning[0].data.decision, "approved");
  assert.equal(learning[0].data.segment.goal, "strength");
  const notice = await asWorker(coach, (tx) => tx.query("SELECT * FROM notifications WHERE user_id=$1 AND dedupe_key=$2", [client.userId, "brain-plan:" + gen.id]));
  assert.equal(notice.length, 1);
  assert.equal((await req(`/brain/plans/${gen.id}/review`, "POST", { action: "approve", version: gen.version + 1 }, coach)).statusCode, 409);
});

test("validator rejections route to review, cannot be approved as-is, and a trainer edit (with a long library cue) is validated and learned with its diff", async () => {
  const coach = await newCoach("invalid");
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
    r = await generate(coach, client);
  } finally {
    override = undefined;
  }
  const gen = await generation(r.generationId, coach.tenantId);
  assert.equal(gen.status, "pending_review");
  assert.match(gen.data.validation.errors.join("\n"), /Barbell back squat needs barbell, squat rack/);
  assert.equal(gen.data.confidence.confident, false);
  const refused = await req(`/brain/plans/${gen.id}/review`, "POST", { action: "approve", version: gen.version }, coach);
  assert.equal(refused.statusCode, 400);
  const { selfConfidence: _s, uncertainties: _u, evidenceIds: _e, ...editable } = gen.data.draft;
  editable.sessions[0].exercises[0] = { ...editable.sessions[0].exercises[0], name: "Goblet squat", sets: 2, cue: "c".repeat(900) };
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
  const [learning] = await asWorker(coach, (tx) => tx.query("SELECT * FROM records WHERE kind='plan_learning' AND data->>'generationId'=$1", [gen.id]));
  assert.equal(learning.data.decision, "edited");
  assert.ok(learning.data.diff.length >= 1);
  assert.equal(learning.data.note, "Use goblet squats without a rack");
});

test("learning changes retrieval and confidence; qualification scores the full route; a qualified Brain delivers confident plans with spot checks", async () => {
  const coach = await newCoach("learning");
  // Three reviewed plans in the beginner-strength segment.
  const reviewedScores: number[] = [];
  for (const [i, action] of (["approve", "approve", "edit"] as const).entries()) {
    const client = await member(coach, `Learner ${i}`);
    const r = await generate(coach, client);
    const g = await generation(r.generationId, coach.tenantId);
    reviewedScores.push(g.data.confidence.signals.caseCoverage);
    if (action === "approve") assert.equal((await req(`/brain/plans/${g.id}/review`, "POST", { action, version: g.version }, coach)).statusCode, 200);
    else {
      const { selfConfidence: _s, uncertainties: _u, evidenceIds: _e, ...plan } = g.data.draft;
      plan.title = "Edited strength plan";
      assert.equal((await req(`/brain/plans/${g.id}/review`, "POST", { action: "edit", version: g.version, plan }, coach)).statusCode, 200);
    }
  }
  assert.ok(reviewedScores[2] > reviewedScores[0], "similar reviewed plans raise case coverage");
  const lastPrompt = prompts.filter((p) => p.kind === "plan_generation").at(-1)!;
  assert.ok(lastPrompt.input.material.examples.length >= 2, "reviewed plans are retrieved as private examples");
  // Qualification on the full route: a wrong expectation fails the run.
  await saveSettings(coach, { threshold: 0.55, spotCheckRate: 1, youngBrainReviews: 100 });
  const [wrong] = await addScenarios(coach, [{ ...programmeScenarios[0], title: "Wrongly expected review", expected: "review" }]);
  await addScenarios(coach, [...programmeScenarios, ...adaptationScenarios]);
  const failed = await qualify(coach);
  assert.equal(failed.status, "failed");
  const miss = failed.data.outcomes.find((o: any) => o.scenarioId === wrong);
  assert.equal(miss.route, "automatic");
  assert.equal(miss.passed, false);
  const ws0 = await workspace(coach);
  const scenario = ws0.qualification.scenarios.find((s: any) => s.id === wrong);
  assert.equal((await req(`/brain/plans/scenarios/${wrong}/archive`, "POST", { version: scenario.version }, coach)).statusCode, 200);
  const before = calls.length;
  const passed = await qualify(coach);
  assert.equal(passed.status, "passed", JSON.stringify(passed.data.outcomes));
  // 4 deliverable + the runner call the model; 2 are stopped by the code
  // safety floor; adaptations: 2 model calls, 1 stopped by pain.
  assert.equal(calls.length - before, 7);
  const gates = (type: string, gate: string) => passed.data.outcomes.filter((o: any) => o.type === type && o.gate === gate).length;
  assert.equal(gates("programme", "code_safety"), 2);
  assert.equal(gates("adaptation", "code_safety"), 1);
  const runner = passed.data.outcomes.find((o: any) => o.type === "programme" && o.expected === "review" && o.gate === "route");
  assert.equal(runner.route, "review", "the confidence gate sends a low-coverage profile to the trainer");
  assert.ok(runner.score < 0.55);
  assert.ok(passed.data.outcomes.filter((o: any) => o.expected === "deliverable").every((o: any) => o.route === "automatic"));
  assert.equal(passed.data.threshold, 0.55);
  assert.deepEqual(passed.data.adaptation, { total: 3, deliverable: 1, review: 2, passed: 3 });
  const third = await member(coach, "Automatic Client");
  const r3 = await generate(coach, third);
  assert.equal(r3.status, "delivered", JSON.stringify(r3));
  assert.equal(r3.spotCheck, true);
  const g3 = await generation(r3.generationId, coach.tenantId);
  assert.equal(g3.data.route, "automatic");
  assert.equal(g3.data.qualified, true);
  assert.equal(g3.data.outcome.spotCheck, "pending");
  const ws = await workspace(coach);
  assert.ok(ws.queue.some((q: any) => q.id === g3.id), "the spot check is in the trainer's queue");
  assert.equal(ws.qualification.qualified, true);
  assert.equal(ws.qualification.adaptationQualified, true);
  assert.ok(ws.stats.reviewed >= 3 && ws.stats.young === true);
  assert.equal((await req(`/brain/plans/${g3.id}/review`, "POST", { action: "approve", version: g3.version }, coach)).statusCode, 200);
  const checked = await generation(g3.id, coach.tenantId);
  assert.equal(checked.data.outcome.spotCheck, "approved");
  assert.equal(checked.status, "delivered");
  // A stricter threshold keeps the qualification; a looser one needs a new run.
  await saveSettings(coach, { threshold: 0.6 });
  assert.equal((await workspace(coach)).qualification.qualified, true);
  await saveSettings(coach, { threshold: 0.5 });
  assert.equal((await workspace(coach)).qualification.qualified, false);
  await saveSettings(coach, { threshold: 0.55 });
  // Changing the bounds changes the pinned contract: supervised again until requalified.
  await saveSettings(coach, { bounds: { ...ws.settings.bounds, maxSessionMinutes: 90 } });
  const fourth = await member(coach, "Requalify Client");
  assert.equal((await generate(coach, fourth)).status, "pending_review");
});

test("the safety floor sends limitations, red flags and recent pain to the trainer while an identical profile without them is delivered", async () => {
  const coach = await qualifiedCoach("safety");
  const control = await member(coach, "Control Client");
  const c = await generate(coach, control);
  assert.equal(c.status, "delivered", JSON.stringify(c));
  assert.equal((await generation(c.generationId, coach.tenantId)).data.route, "automatic");
  const limited = await member(coach, "Limited Client", { limitations: "Recovering from a knee injury" });
  const r = await generate(coach, limited);
  assert.equal(r.status, "pending_review");
  const g = await generation(r.generationId, coach.tenantId);
  assert.ok(g.data.safety.some((s: string) => /medical limitation/.test(s)));
  assert.ok(g.data.routeReasons.some((s: string) => s.startsWith("Safety:")));
  assert.equal(g.data.confidence.confident, true, "only the safety floor held it back");
  const pained = await member(coach, "Pain Report Client");
  await asWorker(coach, (tx) =>
    putRecord(tx, worker(coach.tenantId), "training_hold", { reason: "Reported pain", resolvedBy: coach.userId }, { ownerId: pained.userId, status: "resolved" }),
  );
  const p = await generate(coach, pained);
  assert.equal(p.status, "pending_review");
  assert.ok((await generation(p.generationId, coach.tenantId)).data.safety.some((s: string) => /pain or safety report/.test(s)));
  const flagged = await member(coach, "Red Flag Client", { goal: "Get fit again after fainting during exercise" });
  assert.equal((await generate(coach, flagged)).status, "pending_review");
  const held = await member(coach, "Held Client");
  await asWorker(coach, (tx) =>
    putRecord(tx, worker(coach.tenantId), "training_hold", { reason: "Chest pain" }, { ownerId: held.userId, status: "active" }),
  );
  assert.equal((await req("/brain/plans/generate", "POST", { subscriberId: held.userId }, coach)).statusCode, 409);
});

test("an untagged exercise keeps a confident plan from automatic delivery until the trainer tags it", async () => {
  const coach = await qualifiedCoach("equipment");
  const created = await req("/training/exercises", "POST", { name: "Dumbbell swing", sets: 3, reps: 12, restSeconds: 90, loadKg: 0, rir: 2, cue: "Hinge" }, coach);
  assert.equal(created.statusCode, 200, created.body);
  override = (body) => {
    if (classifyPrompt(body).kind !== "plan_generation") return undefined;
    const plan: any = ruleBasedAnswer(body).content;
    const a = plan.sessions[0];
    if (!a.exercises.some((e: any) => e.name === "Dumbbell swing"))
      a.exercises[0] = { ...a.exercises[0], name: "Dumbbell swing", alternatives: [] };
    return plan;
  };
  try {
    const first = await member(coach, "Untagged Client");
    const r = await generate(coach, first);
    assert.equal(r.status, "pending_review", JSON.stringify(r));
    const g = await generation(r.generationId, coach.tenantId);
    assert.deepEqual(g.data.validation.errors, []);
    assert.ok(g.data.routeReasons.some((x: string) => /Equipment is unchecked for Dumbbell swing/.test(x)));
    const ws = await workspace(coach);
    const swing = ws.library.find((e: any) => e.name === "Dumbbell swing");
    const tagged = await req(`/brain/plans/exercises/${swing.id}/equipment`, "POST", { version: swing.version, equipment: ["dumbbells"] }, coach);
    assert.equal(tagged.statusCode, 200, tagged.body);
    const second = await member(coach, "Tagged Client");
    const t = await generate(coach, second);
    assert.equal(t.status, "delivered", JSON.stringify(t));
  } finally {
    override = undefined;
  }
});

test("first-week loads without a reference are capped, and logged history is the reference", async () => {
  const coach = await qualifiedCoach("loads");
  const heavy = (load: number) => (body: any) => {
    if (classifyPrompt(body).kind !== "plan_generation") return undefined;
    const plan: any = ruleBasedAnswer(body).content;
    for (const s of plan.sessions)
      for (const e of s.exercises) if (e.name === "Goblet squat") e.loadKg = load;
    return plan;
  };
  try {
    const fresh = await member(coach, "Fresh Client");
    override = heavy(200);
    const r = await generate(coach, fresh);
    assert.equal(r.status, "pending_review");
    const g = await generation(r.generationId, coach.tenantId);
    assert.match(g.data.validation.errors.join("\n"), /Goblet squat starts at 200 kg with no logged or library load/);
    // A member who logged 30 kg goblet squats may start at 32 kg, not 40 kg.
    const trained = await member(coach, "Trained Client");
    await asWorker(coach, (tx) =>
      tx.query("INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data) VALUES($1,$2,$3,$4,$5,$6)", [
        randomUUID(), coach.tenantId, trained.userId, randomUUID(), randomUUID(), JSON.stringify({ exercise: "Goblet squat", set: 1, reps: 8, loadKg: 30, rir: 2 }),
      ]),
    );
    override = heavy(40);
    const high = await generation((await generate(coach, trained)).generationId, coach.tenantId);
    assert.match(high.data.validation.errors.join("\n"), /Goblet squat starts at 40 kg, above the member's reference 30 kg/);
    assert.equal(high.data.inputs.loadReference["goblet squat"], 30);
    override = heavy(32);
    const ok = await generation((await generate(coach, trained)).generationId, coach.tenantId);
    assert.deepEqual(ok.data.validation.errors, []);
  } finally {
    override = undefined;
  }
});

// Found by the end-to-end harness: the validator enforced week-1 loads against
// the library's default load (and the member's logged loads), but the prompt
// never told the model those references, so a trainer whose library has a
// default load could not get a plan delivered automatically. The prompt now
// carries them as `startingLoads`.
test("the model is told the starting-load references the validator enforces, so a library or logged load is respected", async () => {
  const coach = await qualifiedCoach("start-loads");
  const made = await req("/training/exercises", "POST", { name: "Dumbbell floor press", sets: 3, reps: 10, restSeconds: 90, loadKg: 14, rir: 2, cue: "Elbows at forty-five degrees", equipment: ["dumbbells"] }, coach);
  assert.equal(made.statusCode, 200, made.body);
  const fresh = await member(coach, "Library Load Client");
  const r = await generate(coach, fresh);
  const prompt = prompts.filter((p) => p.kind === "plan_generation").at(-1)!;
  assert.equal(prompt.input.startingLoads["Dumbbell floor press"], 14);
  const g = await generation(r.generationId, coach.tenantId);
  assert.deepEqual(g.data.validation.errors, []);
  const week1 = g.data.draft.sessions.flatMap((s: any) => s.exercises).filter((e: any) => e.name === "Dumbbell floor press");
  assert.ok(week1.length >= 1 && week1.every((e: any) => e.loadKg === 14), JSON.stringify(week1));
  assert.equal(r.status, "delivered", JSON.stringify(g.data.routeReasons));
  // A member's logged load is the reference instead (and reaches the prompt by name).
  const trained = await member(coach, "Logged Load Client");
  await asWorker(coach, (tx) =>
    tx.query("INSERT INTO workout_events(id,tenant_id,user_id,workout_id,event_key,data) VALUES($1,$2,$3,$4,$5,$6)", [
      randomUUID(), coach.tenantId, trained.userId, randomUUID(), randomUUID(), JSON.stringify({ exercise: "Goblet squat", set: 1, reps: 8, loadKg: 30, rir: 2 }),
    ]),
  );
  const second = await generation((await generate(coach, trained)).generationId, coach.tenantId);
  const secondPrompt = prompts.filter((p) => p.kind === "plan_generation").at(-1)!;
  assert.equal(secondPrompt.input.startingLoads["Goblet squat"], 30);
  assert.deepEqual(second.data.validation.errors, []);
  // Qualification sends the library references too.
  const before = prompts.length;
  assert.equal((await qualify(coach)).status, "passed");
  const qualification = prompts.slice(before).filter((p) => p.kind === "plan_generation");
  assert.ok(qualification.length >= 1 && qualification.every((p) => p.input.startingLoads["Dumbbell floor press"] === 14));
});

test("weekly adjustments: automatic when qualified, spot-checked while young, and rechecked for safety after the model call", async () => {
  const coach = await qualifiedCoach("adapt", { spotCheckRate: 1, youngBrainReviews: 100 });
  const client = await member(coach, "Adapting Client", {}, { programmeDays: 28 });
  const delivered = await generate(coach, client);
  assert.equal(delivered.status, "delivered", JSON.stringify(delivered));
  const g = await generation(delivered.generationId, coach.tenantId);
  if (g.data.outcome.spotCheck === "pending")
    assert.equal((await req(`/brain/plans/${g.id}/review`, "POST", { action: "approve", version: g.version }, coach)).statusCode, 200);
  const [program] = await assigned(coach, client.userId);
  await logWeek(coach, client, program.id, 1);
  const baseline = await weekLoads(coach, program.id, 2);
  // Spot check: applied at once, the trainer withdraws it and week 2 returns to the baseline.
  const spot = await adaptMemberPlan(db, worker(coach.tenantId), client.userId, { programId: program.id, week: 2 });
  assert.equal(spot.status, "delivered", JSON.stringify(spot));
  assert.equal((spot as any).spotCheck, true);
  const sg = await generation(spot.generationId!, coach.tenantId);
  assert.equal(sg.data.outcome.spotCheck, "pending");
  assert.ok((await weekLoads(coach, program.id, 2)).some((l, i) => l > baseline[i]), "applied before the check");
  assert.ok((await workspace(coach)).queue.some((q: any) => q.id === sg.id));
  const withdrawn = await req(`/brain/plans/${sg.id}/review`, "POST", { action: "reject", version: sg.version, note: "Hold the loads one more week" }, coach);
  assert.equal(withdrawn.statusCode, 200, withdrawn.body);
  assert.ok(withdrawn.json().reverted >= 1);
  assert.deepEqual(await weekLoads(coach, program.id, 2), baseline);
  // Control: without spot checks the same week is adjusted automatically.
  await saveSettings(coach, { spotCheckRate: 0 });
  const auto = await adaptMemberPlan(db, worker(coach.tenantId), client.userId, { programId: program.id, week: 2 });
  assert.equal(auto.status, "delivered", JSON.stringify(auto));
  const ag = await generation(auto.generationId!, coach.tenantId);
  assert.equal(ag.data.route, "automatic");
  assert.equal(ag.data.outcome.spotCheck, null);
  assert.ok((await weekLoads(coach, program.id, 2)).some((l, i) => l > baseline[i]));
  // A hold opened while the model is answering: nothing is delivered.
  const week3 = await weekLoads(coach, program.id, 3);
  let hold: any;
  during = async (kind) => {
    if (kind === "plan_adaptation")
      hold = await asWorker(coach, (tx) => putRecord(tx, worker(coach.tenantId), "training_hold", { reason: "Sharp knee pain" }, { ownerId: client.userId, status: "active" }));
  };
  let held;
  try {
    held = await adaptMemberPlan(db, worker(coach.tenantId), client.userId, { programId: program.id, week: 3 });
  } finally {
    during = undefined;
  }
  assert.equal(held.status, "superseded", JSON.stringify(held));
  assert.deepEqual(await weekLoads(coach, program.id, 3), week3);
  // Resolved ten days ago: still inside the 28-day window, so the trainer
  // decides and the model is not called.
  await asWorker(coach, (tx) => tx.query("UPDATE records SET status='resolved',created_at=now()-interval '10 days' WHERE id=$1", [hold.id]));
  const callsBefore = calls.length;
  const pain = await adaptMemberPlan(db, worker(coach.tenantId), client.userId, { programId: program.id, week: 3 });
  assert.equal(pain.status, "skipped");
  assert.equal((pain as any).reason, "safety_review");
  assert.equal(calls.length, callsBefore);
  assert.ok((await generation(pain.generationId!, coach.tenantId)).data.safety.some((s: string) => /pain or safety report/.test(s)));
  // A pain report filed during the call routes the proposal to the trainer.
  const second = await member(coach, "Second Adapting Client", {}, { programmeDays: 28 });
  assert.equal((await generate(coach, second)).status, "delivered");
  const [program2] = await assigned(coach, second.userId);
  await logWeek(coach, second, program2.id, 1);
  const before2 = await weekLoads(coach, program2.id, 2);
  during = async (kind) => {
    if (kind === "plan_adaptation")
      await asWorker(coach, (tx) => putRecord(tx, worker(coach.tenantId), "training_hold", { reason: "Knee pain", resolvedBy: coach.userId }, { ownerId: second.userId, status: "resolved" }));
  };
  let routed;
  try {
    routed = await adaptMemberPlan(db, worker(coach.tenantId), second.userId, { programId: program2.id, week: 2 });
  } finally {
    during = undefined;
  }
  assert.equal(routed.status, "pending_review", JSON.stringify(routed));
  const rg = await generation(routed.generationId!, coach.tenantId);
  assert.equal(rg.data.route, "review");
  assert.ok(rg.data.routeReasons.some((s: string) => s.startsWith("Safety:")));
  assert.deepEqual(await weekLoads(coach, program2.id, 2), before2);
});

test("queued jobs never replace a trainer's hand-written programme; a manual plan asks the trainer first", async () => {
  const coach = await qualifiedCoach("handwritten");
  const first = await member(coach, "Handwritten Client");
  const second = await member(coach, "Assigned During Call Client");
  assert.ok((await scheduleBrainPlans(db, coach.tenantId, { force: true })) >= 2);
  const jobs = await asWorker(coach, (tx) => tx.query("SELECT * FROM jobs WHERE kind='brain_plan' AND status='pending'"));
  const jobFor = (userId: string) => jobs.find((j: any) => j.data.userId === userId);
  assert.equal(jobFor(first.userId).data.expectedProgramId, null);
  const handwritten = (client: any) =>
    req("/programs", "POST", { subscriberId: client.userId, timezone: "UTC", program: { title: "My own plan", goal: "Strength", daysPerWeek: 2, exercises: [{ name: "Goblet squat", sets: 3, reps: 8, restSeconds: 90, loadKg: 16 }] } }, coach);
  const written = await handwritten(first);
  assert.equal(written.statusCode, 200, written.body);
  const before = calls.length;
  const skipped = await executeBrainPlanJob(db, coach.tenantId, jobFor(first.userId));
  assert.equal(skipped.status, "skipped");
  assert.equal((skipped as any).reason, "programme_changed");
  assert.equal(calls.length, before);
  assert.deepEqual((await assigned(coach, first.userId)).map((p) => p.id), [written.json().id]);
  // Assigned while the model was answering: the generated plan is superseded.
  let during2: any;
  during = async (kind) => {
    if (kind === "plan_generation") during2 = await handwritten(second);
  };
  let superseded;
  try {
    superseded = await executeBrainPlanJob(db, coach.tenantId, jobFor(second.userId));
  } finally {
    during = undefined;
  }
  assert.equal(during2.statusCode, 200, during2.body);
  assert.equal(superseded.status, "superseded", JSON.stringify(superseded));
  assert.deepEqual((await assigned(coach, second.userId)).map((p) => p.id), [during2.json().id]);
  // A trainer's own request is held for the trainer even when confident, and
  // approving it is the trainer's decision to replace the hand-written plan.
  const manual = await generate(coach, first);
  assert.equal(manual.status, "pending_review");
  const mg = await generation(manual.generationId, coach.tenantId);
  assert.equal(mg.data.confidence.confident, true);
  assert.ok(mg.data.routeReasons.some((x: string) => /follows a programme you wrote/.test(x)));
  assert.equal((await req(`/brain/plans/${mg.id}/review`, "POST", { action: "approve", version: mg.version }, coach)).statusCode, 200);
  const now = await assigned(coach, first.userId);
  assert.equal(now.length, 1);
  assert.equal(now[0].data.generated, true);
});

test("unsent generations recover: a retried job reuses its row, a refused manual request can be regenerated, and the sweep closes stranded ones", async () => {
  const coach = await qualifiedCoach("notsent");
  const client = await member(coach, "Retry Client", {}, { programmeDays: 28 });
  assert.equal((await generate(coach, client)).status, "delivered");
  const [program] = await assigned(coach, client.userId);
  await logWeek(coach, client, program.id, 1);
  const job = await insertJob(coach, { userId: client.userId, type: "adaptation", programId: program.id, week: 2 });
  await assert.rejects(withDailyLimit("1", () => executeBrainPlanJob(db, coach.tenantId, job)), (e: any) => e.code === "MODEL_DAILY_LIMIT");
  const [unsent] = await asWorker(coach, (tx) => tx.query("SELECT * FROM records WHERE kind='plan_generation' AND data->>'jobId'=$1", [job.id]));
  assert.equal(unsent.status, "not_sent");
  assert.ok((await workspace(coach)).queue.some((q: any) => q.id === unsent.id && q.status === "not_sent"));
  const retried = await executeBrainPlanJob(db, coach.tenantId, job);
  assert.equal(retried.generationId, unsent.id, JSON.stringify(retried));
  assert.ok(["delivered", "pending_review"].includes(retried.status));
  // A trainer's request refused by the daily limit goes to the queue as failed.
  const manual = await member(coach, "Refused Client");
  const refused = await withDailyLimit("1", () => req("/brain/plans/generate", "POST", { subscriberId: manual.userId }, coach));
  assert.equal(refused.statusCode, 429, refused.body);
  const ws = await workspace(coach);
  const failed = ws.queue.find((q: any) => q.subscriberId === manual.userId);
  assert.equal(failed.status, "failed");
  const again = await req(`/brain/plans/${failed.id}/regenerate`, "POST", { version: failed.version }, coach);
  assert.equal(again.statusCode, 200, again.body);
  assert.notEqual(again.json().generationId, failed.id);
  const old = await generation(failed.id, coach.tenantId);
  assert.equal(old.status, "superseded");
  assert.equal(old.data.outcome.decision, "regenerated");
  // A queued first plan refused and then abandoned by the worker is closed.
  const stranded = await member(coach, "Stranded Client");
  const firstJob = await insertJob(coach, { userId: stranded.userId, type: "programme", trigger: "intake", expectedProgramId: null });
  await assert.rejects(withDailyLimit("1", () => executeBrainPlanJob(db, coach.tenantId, firstJob)));
  await asWorker(coach, (tx) => tx.query("UPDATE jobs SET status='failed' WHERE id=$1", [firstJob.id]));
  const mine = await req("/brain/plans/mine", "GET", undefined, stranded);
  assert.equal(mine.json().status.state, "preparing");
  await scheduleBrainPlans(db, coach.tenantId, { force: true });
  const [closed] = await asWorker(coach, (tx) => tx.query("SELECT * FROM records WHERE kind='plan_generation' AND data->>'jobId'=$1", [firstJob.id]));
  assert.equal(closed.status, "failed");
  assert.match(closed.data.error, /MODEL_DAILY_LIMIT/);
  assert.equal((await req("/brain/plans/mine", "GET", undefined, stranded)).json().status.state, "with_trainer");
  assert.ok((await workspace(coach)).queue.some((q: any) => q.id === closed.id));
});

test("the next block is prepared only when access continues, and a running block is handed over, not cut short", async () => {
  const coach = await newCoach("blocks");
  const approveAll = async (generationId: string) => {
    const g = await generation(generationId, coach.tenantId);
    if (g.status === "pending_review")
      assert.equal((await req(`/brain/plans/${g.id}/review`, "POST", { action: "approve", version: g.version }, coach)).statusCode, 200);
  };
  const endSoon = async (client: any) =>
    asWorker(coach, async (tx) => {
      const [p] = await tx.query("SELECT * FROM records WHERE kind='program' AND owner_user_id=$1 AND status='assigned'", [client.userId]);
      const endDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      await tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [p.id, JSON.stringify({ endDate })]);
      return { ...p, data: { ...p.data, endDate } } as any;
    });
  const monthly = await member(coach, "Monthly Block Client", {}, { programmeDays: 14, billing: "monthly" });
  const upfront = await member(coach, "Upfront Client", {}, { programmeDays: 14, billing: "upfront", periodEndDays: 2 });
  const ending = await member(coach, "Ending Client", {}, { programmeDays: 14, billing: "monthly", periodEndDays: 2, cancelAtPeriodEnd: true });
  for (const c of [monthly, upfront, ending]) await approveAll((await generate(coach, c)).generationId);
  const current = await endSoon(monthly);
  const upfrontProgram = await endSoon(upfront);
  const endingProgram = await endSoon(ending);
  await scheduleBrainPlans(db, coach.tenantId, { force: true });
  const blockJob = async (client: any, program: any) =>
    (await asWorker(coach, (tx) => tx.query("SELECT * FROM jobs WHERE kind='brain_plan' AND intent_key=$1", [`brain-plan:${coach.tenantId}:${client.userId}:block:${program.id}`])))[0];
  assert.equal(await blockJob(upfront, upfrontProgram), undefined, "an upfront programme ends with its access");
  assert.equal(await blockJob(ending, endingProgram), undefined, "a membership set to end gets no next block");
  const job = await blockJob(monthly, current);
  assert.ok(job, "a monthly membership continues into a next block");
  assert.equal(job.data.trigger, "block_end");
  assert.equal(job.data.expectedProgramId, current.id);
  // A job for a programme whose access ends is refused when it runs, too.
  const late = await executeBrainPlanJob(db, coach.tenantId, await insertJob(coach, { userId: upfront.userId, type: "programme", trigger: "block_end", startDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), expectedProgramId: upfrontProgram.id }));
  assert.equal((late as any).reason, "programme_complete");
  const next = await executeBrainPlanJob(db, coach.tenantId, job);
  const ng = await generation((next as any).generationId, coach.tenantId);
  assert.ok(ng.data.inputs.startDate > current.data.endDate);
  assert.equal(ng.data.trigger, "block_end");
  await approveAll(ng.id);
  const programs = await asWorker(coach, (tx) => tx.query("SELECT id,status FROM records WHERE kind='program' AND owner_user_id=$1 ORDER BY created_at", [monthly.userId]));
  assert.equal(programs.find((p: any) => p.id === current.id)!.status, "assigned", "the running block stays assigned for its last days");
  assert.equal(programs.filter((p: any) => p.status === "assigned").length, 2);
  await asWorker(coach, (tx) =>
    tx.query("UPDATE records SET data=data||$2::jsonb WHERE id=$1", [current.id, JSON.stringify({ endDate: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) })]),
  );
  await scheduleBrainPlans(db, coach.tenantId, { force: true });
  const [archived] = await asWorker(coach, (tx) => tx.query("SELECT status FROM records WHERE id=$1", [current.id]));
  assert.equal(archived.status, "archived");
});

test("a year-long programme gets a larger model budget and is validated week by week", async () => {
  const coach = await newCoach("long");
  const client = await member(coach, "Year Client", {}, { programmeDays: 365 });
  const r = await generate(coach, client);
  const last = prompts.filter((p) => p.kind === "plan_generation").at(-1)!;
  assert.equal(last.input.programme.weeks, 53);
  assert.ok(last.maxTokens > 6000, String(last.maxTokens));
  const g = await generation(r.generationId, coach.tenantId);
  assert.equal(g.data.draft.weeks.length, 53);
  assert.deepEqual(g.data.validation.errors, []);
});

test("the scheduler pages through members with a persisted cursor and skips members already waiting", async () => {
  const coach = await newCoach("cursor");
  const clients = [];
  for (let i = 0; i < 3; i++) clients.push(await member(coach, `Cursor Client ${i}`));
  assert.equal(await scheduleBrainPlans(db, coach.tenantId, { force: true, batch: 2 }), 2);
  const [state] = await asWorker(coach, (tx) => tx.query("SELECT data FROM records WHERE kind='plan_schedule_state'"));
  assert.notEqual(state.data.after, "00000000-0000-0000-0000-000000000000");
  assert.equal(await scheduleBrainPlans(db, coach.tenantId, { force: true, batch: 2 }), 1);
  assert.equal(await scheduleBrainPlans(db, coach.tenantId, { force: true, batch: 2 }), 0);
  const jobs = await asWorker(coach, (tx) => tx.query("SELECT data->>'userId' AS user_id FROM jobs WHERE kind='brain_plan'"));
  assert.deepEqual(new Set(jobs.map((j: any) => j.user_id)), new Set(clients.map((c) => c.userId)));
  // The worker runs a queued first plan once; re-running never pays twice.
  let job;
  for (let i = 0; i < 20; i++) {
    job = await claimJob(db, coach.tenantId);
    if (!job) break;
    await runClaimedJob(db, coach.tenantId, job);
    if (job.kind === "brain_plan") break;
  }
  assert.equal(job?.kind, "brain_plan");
  const [jobRow] = await asWorker(coach, (tx) => tx.query("SELECT status FROM jobs WHERE id=$1", [job!.id]));
  assert.equal(jobRow.status, "completed");
  const before = calls.length;
  assert.equal((await executeBrainPlanJob(db, coach.tenantId, job)).status, "skipped");
  assert.equal(calls.length, before);
});

test("plans, queues and learning stay inside their workspace", async () => {
  const coach = await newCoach("isolation");
  const foreign = await register("foreign");
  const client = await member(coach, "Isolation Client");
  const r = await generate(coach, client);
  const g = await generation(r.generationId, coach.tenantId);
  assert.equal((await req(`/brain/plans/${g.id}/review`, "POST", { action: "approve", version: g.version }, coach)).statusCode, 200);
  const foreignWs = await workspace(foreign);
  assert.equal(foreignWs.queue.length, 0);
  assert.equal(foreignWs.stats.reviewed, 0);
  const second = await generate(coach, client);
  const g2 = await generation(second.generationId, coach.tenantId);
  assert.equal((await req(`/brain/plans/${g2.id}/review`, "POST", { action: "approve", version: g2.version }, foreign)).statusCode, 404);
  assert.equal((await req(`/brain/plans/${g2.id}/regenerate`, "POST", { version: g2.version }, foreign)).statusCode, 404);
  assert.equal((await req("/brain/plans/generate", "POST", { subscriberId: client.userId }, foreign)).statusCode, 409);
  assert.equal((await req("/brain/plans/workspace", "GET", undefined, client)).statusCode, 403);
  assert.equal((await req(`/brain/plans/${g2.id}/review`, "POST", { action: "approve", version: g2.version }, client)).statusCode, 403);
  assert.equal((await req(`/brain/plans/${g2.id}/regenerate`, "POST", { version: g2.version }, client)).statusCode, 403);
  assert.equal((await req("/brain/plans/settings", "PUT", { settings: defaultPlanSettings(), version: null }, client)).statusCode, 403);
  const rows = await asWorker(coach, (tx) => tx.query("SELECT * FROM records WHERE kind='plan_learning' AND status='confirmed'"));
  assert.ok(rows.length > 0);
  const retrieved = retrievePlanMaterial({ tenantId: foreign.tenantId, segment: rows[0].data.segment, goal: "Build strength", rules: [], cases: [], learning: rows, templates: [], library });
  assert.equal(retrieved.material.examples.length, 0);
  const other = await db.tenant({ tenantId: coach.tenantId, userId: client.userId, role: "subscriber" }, (tx) => tx.query("SELECT * FROM member_plan_status()"));
  assert.equal(other[0].state, "in_review");
});
