import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, putRecord, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { runBrainCheck, isBrainEdit } from "../apps/api/src/brain-check.ts";
import { publishedTrainerBrain } from "../apps/api/src/trainer-brain.ts";
import { nutritionMaterial } from "../apps/api/src/nutrition.ts";
import { retrievePlanMaterial } from "../packages/providers/src/brain-plans.ts";
import { planLibrary, planSegment } from "../packages/domain/src/brain-plans.ts";
import { communicationFromStyle, trainerBrainContext, trainerWordingIssues } from "../packages/domain/src/trainer-brain.ts";
import { oneOnOneAnswersSchema, oneOnOneFingerprint, narrationUserContent, SAMPLE_FACTS, SAMPLE_PLAN } from "../packages/domain/src/voice-narration.ts";
import { defaultVoiceStyle } from "../packages/domain/src/voice-session.ts";
import { buildSessionScript, scriptIssues, scriptLines } from "../packages/domain/src/voice-session.ts";
import { modelDecision, ModelOutputInvalid } from "@trainer/providers";
import { modelAccounting } from "../apps/api/src/model-accounting.ts";

let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const config = {
  MODEL_BASE_URL: "https://shared-brain.invalid/v1", MODEL_API_KEY: "shared-brain-fixture-key",
  MODEL_NAME: "shared-brain-fixture", MODEL_PRICE_VERSION: "fixture-v1",
  MODEL_INPUT_USD_PER_MILLION: "1", MODEL_OUTPUT_USD_PER_MILLION: "2", MODEL_MAX_DAILY_CALLS: "1000",
};
const saved = Object.fromEntries(Object.keys(config).map(k => [k, process.env[k]]));
const fetchBefore = globalThis.fetch;
const requests: any[] = [];
let failCheck = false;
let replyText = "Own the next step and keep the planned routine.";
const words = (open: string) => oneOnOneAnswersSchema.parse({
  open, form: "Give one simple cue, then ask what the client noticed.",
  motivate: "Warm, direct and practical. Praise the action, without hype.",
  always: ["Own the next step."], never: ["beast mode", "وحش"],
});
const approvedStyle = (open: string) => ({
  ...defaultVoiceStyle(), tone: "calm" as const, intro: [open],
  oneOnOne: {
    answers: words(open), draft: null,
    confirmed: { answers: words(open), summary: "Warm, direct, practical coaching.",
      promptVersion: "fixture", confirmedAt: "2026-10-08T10:00:00Z", confirmedBy: "fixture" },
  },
});
const request = (actor: any, url: string, method: any = "GET", payload?: any) => app.inject({
  url: "/api/v1" + url, method, payload,
  headers: { origin: "http://localhost:3000", ...(actor ? { cookie: actor.cookie } : {}) },
});
async function register(slug: string) {
  const r = await request(null, "/auth/register", "POST", {
    name: "Trainer " + slug, email: slug + "@example.test", password: "SharedBrainOnly2026!", slug, accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return { ...(await request({ cookie }, "/bootstrap")).json().user, cookie };
}
before(async () => {
  Object.assign(process.env, config);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const input = JSON.parse(body.messages[1].content);
    requests.push(input);
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      type: "message", message: replyText,
      reason: "The trainer's routine coaching rule applies.",
      evidenceIds: failCheck ? [] : input.evidence.map((e: any) => e.id), requiresHumanReview: true,
    }) } }], usage: { prompt_tokens: 30, completion_tokens: 20 } });
  };
  db = await createDatabase({ memory: true }); app = await buildApp({ db, testing: true }); await app.ready();
});
after(async () => {
  globalThis.fetch = fetchBefore;
  await app?.close(); await db?.close();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("only confirmed wording becomes shared context; phrase exclusion handles boundaries and Arabic", () => {
  const original = approvedStyle("Welcome back. Own the next step.");
  const working = { ...original, oneOnOne: { ...original.oneOnOne, answers: words("UNAPPROVED WORDS") } };
  const communication = communicationFromStyle(working);
  assert.equal(communication.oneOnOne!.answers.open, original.oneOnOne.confirmed.answers.open);
  assert.doesNotMatch(JSON.stringify(communication), /UNAPPROVED/);
  const context = trainerBrainContext({ id: "published", data: { communication, rules: [] } });
  assert.equal(trainerWordingIssues("Beast mode!", context).length, 1);
  assert.equal(trainerWordingIssues("BEAST-mode!", context).length, 1);
  assert.equal(trainerWordingIssues("يا وحش!", context).length, 1);
  assert.equal(trainerWordingIssues("A beast model is a different phrase.", context).length, 0);
  assert.equal(trainerWordingIssues("Own the next step.", context).length, 0);
  assert.ok(isBrainEdit("POST", "/api/v1/voice-sessions/one-on-one/confirm"));
  assert.ok(isBrainEdit("PUT", "/api/v1/voice-sessions/style"));
  assert.equal(isBrainEdit("PUT", "/api/v1/voice-sessions/one-on-one"), false, "working answers do not recheck live coaching");
});

test("authored and default spoken phrases respect the same exclusions without changing the workout", () => {
  const baseline = buildSessionScript({ title: "Training", exercises: SAMPLE_PLAN }).script;
  const style = approvedStyle("Welcome back.");
  style.encouragement = ["Beast mode!"];
  style.oneOnOne.confirmed.answers.never = ["beast mode", ...baseline.exercises[0].encouragement.map(l => l.text), baseline.finish.text];
  const result = buildSessionScript({ title: "Training", exercises: SAMPLE_PLAN, style });
  assert.ok(result.rejected.some(r => r.issues.includes("trainer_wording")));
  const context = trainerBrainContext({ data: { communication: communicationFromStyle(style) } });
  assert.ok(scriptLines(result.script).every(l => !trainerWordingIssues(l.text, context).length));
  assert.deepEqual(scriptIssues(result.script, SAMPLE_PLAN), []);
  assert.deepEqual(result.script.exercises.map(e => e.setLines), baseline.exercises.map(e => e.setLines));
});

test("draft chat output using a trainer's forbidden phrase is withheld at the provider boundary", async () => {
  const trainer = await register("shared-brain-wording");
  const evidence = await db.tenant(trainer, tx => putRecord(tx, trainer, "rule", {
    title: "Encouragement", directive: "Use practical encouragement", allowedUses: ["model_prompt", "render"],
  }, { status: "confirmed" }));
  const context = trainerBrainContext({ id: "published", data: { rules: [evidence], communication: communicationFromStyle(approvedStyle("Welcome back.")) } });
  replyText = "Time for BEAST-mode!";
  try {
    await assert.rejects(() => modelDecision("coaching", "Encourage me", [{ id: evidence.id, data: evidence.data }], modelAccounting(db, trainer, "coaching"), { trainerBrain: context }), ModelOutputInvalid);
  } finally { replyText = "Own the next step and keep the planned routine."; }
});

test("a style edit stays private until checked, failure preserves the live Brain, and publication reaches every channel", async () => {
  const trainer = await register("shared-brain-coach");
  const foreign = await register("shared-brain-foreign");
  const oldStyle = approvedStyle("Welcome back. Own the next step.");
  const first = await db.tenant(trainer, async tx => {
    const rule = await putRecord(tx, trainer, "rule", {
      title: "Practical encouragement", category: "communication", condition: "Routine adherence questions",
      directive: "Encourage completion of the prescribed routine, one practical next step at a time.",
      reason: "Keep the coaching useful and direct.", sourceIds: [], allowedUses: ["model_prompt", "render"],
    }, { status: "confirmed" });
    await tx.query("INSERT INTO voice_session_styles(tenant_id,version,style,updated_by) VALUES($1,1,$2,$3)",
      [trainer.tenantId, JSON.stringify(oldStyle), trainer.userId]);
    const release = await putRecord(tx, trainer, "brain_release", {
      rules: [{ id: rule.id, data: rule.data, version: rule.version }],
      communication: communicationFromStyle(oldStyle), mode: "supervised", qualification: "full",
    }, { status: "published" });
    for (let i = 0; i < 20; i++) await putRecord(tx, trainer, "scenario", {
      prompt: `How would you encourage routine completion in situation ${i}?`, expectedEvidenceId: rule.id, expectEscalation: false,
    }, { status: "held_out" });
    return release;
  });
  const newAnswers = words("Good to see you. What went well this week?");
  const changed = {
    ...oldStyle,
    oneOnOne: { ...oldStyle.oneOnOne, answers: newAnswers, draft: {
      summary: "Start with a practical reflection on the week.", sample: { open: newAnswers.open, exercises: [] },
      answers: oneOnOneFingerprint(newAnswers), promptVersion: "fixture", draftedAt: "2026-10-08T11:00:00Z",
    } },
  };
  await db.tenant(trainer, tx => tx.query("UPDATE voice_session_styles SET version=2,style=$1", [JSON.stringify(changed)]));
  const before = await db.tenant(trainer, publishedTrainerBrain);
  assert.equal(before.communication.oneOnOne!.answers.open, oldStyle.oneOnOne.confirmed.answers.open);
  const confirmed = await request(trainer, "/voice-sessions/one-on-one/confirm", "POST", { revision: 2, confirmed: true });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().publication.pending, true);
  assert.deepEqual(await db.tenant(trainer, publishedTrainerBrain), before, "confirming a candidate does not change the published profile");

  failCheck = true;
  await runBrainCheck(db, trainer.tenantId, "manual", trainer.userId);
  assert.equal((await db.tenant(trainer, publishedTrainerBrain)).releaseId, first.id);
  assert.ok(requests.some(r => r.trainerBrain?.communication?.oneOnOne?.answers.open === newAnswers.open), "checks actually exercise the proposed style");
  failCheck = false;
  const check = await request(trainer, "/brain/evaluate", "POST");
  assert.equal(check.statusCode, 200, check.body);
  assert.equal(check.json().status, "passed");
  await runBrainCheck(db, trainer.tenantId, "manual", trainer.userId);
  const published = await db.tenant(trainer, publishedTrainerBrain);
  assert.notEqual(published.releaseId, first.id);
  assert.equal(published.communication.oneOnOne!.answers.open, newAnswers.open);
  assert.equal((await request(trainer, "/voice-sessions/one-on-one")).json().publication.pending, false);
  assert.equal((await db.tenant(foreign, publishedTrainerBrain)).releaseId, null, "another trainer cannot inherit this identity");

  const nutrition = await db.tenant(trainer, nutritionMaterial);
  assert.deepEqual(nutrition.snapshot.trainerBrain, published);
  const profile = { goal: "strength", experience: "beginner" as const, equipment: "Dumbbells", daysPerWeek: 3, limitations: "None reported" };
  const plan = retrievePlanMaterial({ tenantId: trainer.tenantId, trainerBrain: published,
    segment: planSegment(profile), goal: profile.goal, rules: first.data.rules, cases: [], learning: [], templates: [], library: planLibrary([], []) });
  assert.deepEqual(plan.material.trainerBrain, published);
  const spoken = JSON.parse(narrationUserContent({ trainerBrain: published, style: published.communication.oneOnOne!,
    facts: SAMPLE_FACTS, plan: SAMPLE_PLAN, title: "Training", language: "en" }));
  assert.deepEqual(spoken.trainerBrain, published);
  const archived = await db.tenant(trainer, tx => tx.query("SELECT data,status FROM records WHERE id=$1", [first.id]));
  assert.equal(archived[0].status, "archived");
  assert.equal(archived[0].data.communication.oneOnOne.answers.open, oldStyle.oneOnOne.confirmed.answers.open, "history preserves the actual old style");
});
