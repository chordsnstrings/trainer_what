// Narration in the coach's style through the API: "Your one-on-one sessions",
// the Brain's style draft and the coach's one confirmation, Brain lines in
// every new session (one model call, kept with the session), the checks that
// drop a failing line, and the sample in the coach's cloned voice.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { createMockTls, trustMockCa, type MockTls } from "./e2e/mocks/tls.ts";
import { VoiceMock } from "./e2e/mocks/voice.ts";
import { seedScope } from "./scope-fixtures.ts";

let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  tls: MockTls,
  mock: VoiceMock,
  coach: any,
  other: any,
  sara: any,
  noam: any;
const originalFetch = globalThis.fetch;
const env: Record<string, string> = {
  VOICE_CONTRACT_VERIFIED: "true",
  VOICE_PROVIDER: "elevenlabs",
  VOICE_API_KEY: "xi_fixture_key",
  VOICE_BASE_URL: "https://voice.test/v1",
  VOICE_MODEL: "eleven_multilingual_v2",
  VOICE_PRICE_VERSION: "fixture-2026-09",
  VOICE_USD_PER_1000_CHARACTERS: "0.3",
  VOICE_DAILY_USD_LIMIT: "5",
  MODEL_BASE_URL: "https://model.test/v1",
  MODEL_API_KEY: "fixture-key",
  MODEL_NAME: "fixture-model",
};
const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
/** What the model answers, by prompt; null makes the call fail. */
let narrationReply: unknown = null;
let draftReply: unknown = null;
const prompts: Array<{ system: string; user: string }> = [];

async function request(url: string, method: any = "GET", body?: any, actor?: any) {
  return app.inject({
    url: "/api/v1" + url,
    method,
    headers: { origin: "http://localhost:3000", ...(actor ? { cookie: actor.cookie } : {}) },
    payload: body,
  });
}
async function ok(url: string, method: any, body: any, actor: any) {
  const r = await request(url, method, body, actor);
  assert.ok(r.statusCode < 400, `${method} ${url}: ${r.statusCode} ${r.body}`);
  return r.json();
}
async function register(email: string, slug: string) {
  const r = await request("/auth/register", "POST", { name: "Coach " + slug, email, password: "TrainingOnly2026!", slug, accepted: true });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return { ...(await request("/bootstrap", "GET", undefined, { cookie })).json().user, cookie };
}
async function member(email: string, name: string, modelUse: boolean) {
  const invite = await request("/invitations", "POST", { email, role: "subscriber" }, coach);
  assert.equal(invite.statusCode, 200, invite.body);
  const joined = await request("/invitations/accept", "POST", {
    token: invite.json().url.split("/").pop(),
    name,
    email,
    password: "TrainingClient2026!",
    accepted: true,
  });
  assert.equal(joined.statusCode, 200, joined.body);
  const cookie = String(joined.headers["set-cookie"]).split(";")[0];
  const user = { ...(await request("/bootstrap", "GET", undefined, { cookie })).json().user, cookie };
  await db.tenant(seedScope(coach), async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor,data) VALUES($1,$2,$3,'active',now()+interval '30 days',10000,$4)",
      [randomUUID(), coach.tenantId, user.userId, JSON.stringify({ modules: ["training", "voice"] })],
    );
    // The member's coaching consent: model use allowed or not (as for chat).
    await tx.query(
      "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,'intake',$3,'submitted',$4)",
      [randomUUID(), coach.tenantId, user.userId, JSON.stringify({ allowedUses: modelUse ? ["render", "model_prompt"] : ["render"] })],
    );
  });
  return user;
}
async function startWorkout(user: any) {
  const program = await ok(
    "/programs",
    "POST",
    {
      subscriberId: user.userId,
      program: {
        title: "Lower body strength",
        goal: "Controlled strength practice",
        daysPerWeek: 3,
        exercises: [
          { name: "Back squat", sets: 3, reps: 8, restSeconds: 60, loadKg: 60, cue: "Brace, then sit between your heels." },
          { name: "Push-up", sets: 1, reps: 10, restSeconds: 0, loadKg: 0 },
        ],
      },
    },
    coach,
  );
  return (await ok("/workouts/start", "POST", { programId: program.id }, user)).id as string;
}
const answers = {
  open: "I ask how they slept, then name the one thing we focus on today.",
  form: "One cue at a time: brace, chest tall, control the way down.",
  rests: "Breathing and what the next set should feel like.",
  motivate: "Calm and steady, short praise like nice and smooth.",
  struggle: "Breathe, reset, own the weight.",
  always: ["nice and smooth", "own it"],
  never: ["beast mode"],
};
const scalar = async (sql: string, values: any[] = []) =>
  (await db.tenant(seedScope(coach), (tx) => tx.query(sql, values)))[0];

before(async () => {
  Object.assign(process.env, env);
  tls = createMockTls();
  trustMockCa(tls.ca);
  mock = new VoiceMock({ key: tls.key, cert: tls.cert }, env.VOICE_API_KEY);
  mock.voices.add("mock-trainer-voice");
  await mock.start();
  globalThis.fetch = async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://voice.test/")) return originalFetch(url.replace("https://voice.test", mock.url), init);
    if (url.startsWith("https://model.test/")) {
      const body = JSON.parse(String(init?.body));
      const system = String(body.messages?.[0]?.content ?? ""),
        user = String(body.messages?.[1]?.content ?? "");
      prompts.push({ system, user });
      const reply = system.includes("voice-one-on-one-v1") ? draftReply : narrationReply;
      if (reply === null) return new Response("unavailable", { status: 503 });
      return Response.json({
        id: "chatcmpl-fixture",
        choices: [{ message: { content: JSON.stringify(reply) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      });
    }
    return originalFetch(input, init);
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  coach = await register("narration-coach@example.test", "narration-coach");
  other = await register("other-coach@example.test", "other-narration");
  sara = await member("sara@example.test", "Sara Haddad", true);
  noam = await member("noam@example.test", "Noam Reed", false);
  await db.tenant(seedScope(coach), async (tx) => {
    await tx.query(
      "INSERT INTO trainer_voices(id,tenant_id,user_id,status,provider_voice_id,evidence,consent_version,verified_at) VALUES($1,$2,$3,'verified','mock-trainer-voice','{}','trainer-voice-v1',now())",
      [randomUUID(), coach.tenantId, coach.userId],
    );
    await tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'voice','fixture',true)",
      [randomUUID(), coach.tenantId, coach.userId],
    );
  });
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(saved))
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  await app.close();
  await db.close();
  await mock.stop();
  tls.cleanup();
});

test("the coach answers, the Brain drafts, the coach confirms once; nothing reaches members before", async () => {
  const empty = await ok("/voice-sessions/one-on-one", "GET", undefined, coach);
  assert.equal(empty.version, 0);
  assert.equal(empty.active, false);
  assert.equal(empty.minimumAnswered, 3);
  assert.equal(empty.topics.length, 7);
  // Members and other workspaces never see it.
  assert.equal((await request("/voice-sessions/one-on-one", "GET", undefined, sara)).statusCode, 403);
  const wording = await request("/voice-sessions/one-on-one", "PUT", { revision: 0, answers: { ...answers, rests: "Text me on +971 50 123 4567" } }, coach);
  assert.equal(wording.statusCode, 400, wording.body);
  assert.equal(wording.json().code, "ONE_ON_ONE_WORDING");
  const savedAnswers = await ok("/voice-sessions/one-on-one", "PUT", { revision: 0, answers }, coach);
  assert.equal(savedAnswers.version, 1);
  assert.equal(savedAnswers.answered, 5);
  assert.equal((await ok("/voice-sessions/one-on-one", "GET", undefined, other)).answered, 0);
  // Before a confirmed style, sessions are prepared without a model call.
  const before = prompts.length;
  const workout = await startWorkout(sara);
  const plain = await ok("/voice-sessions", "POST", { workoutId: workout }, sara);
  assert.equal(plain.script.intro.some((l: any) => l.owner === "brain"), false);
  assert.equal(prompts.length, before);
  await ok(`/workouts/${workout}/abandon`, "POST", { note: "Test session ended" }, sara);
  // Confirming needs a draft of the current answers.
  assert.equal((await request("/voice-sessions/one-on-one/confirm", "POST", { revision: 1, confirmed: true }, coach)).json().code, "ONE_ON_ONE_DRAFT_STALE");
  draftReply = {
    summary: "You open by asking how they slept and naming one focus. You cue one thing at a time and keep praise calm.",
    sample: {
      open: "Hey Sam, how did you sleep?",
      exercises: [
        { index: 0, lead: "Last week 14 kilograms, today 16. Nice and smooth.", rest: "Breathe slow, shoulders down.", lastSet: "Last one, own it." },
        { index: 1, lead: "Today 20 kilograms, beast mode." },
      ],
      struggle: "Breathe, reset, own the weight.",
      close: "Good control today, see you next time.",
    },
  };
  const drafted = await ok("/voice-sessions/one-on-one/draft", "POST", { revision: 1 }, coach);
  const call = prompts.at(-1)!;
  assert.match(call.system, /voice-one-on-one-v1/);
  assert.equal(JSON.parse(call.user).coachAnswers.neverSay[0], "beast mode");
  assert.equal(drafted.version, 2);
  assert.equal(drafted.droppedLines, 1, "the line with a never-say phrase and an invented number is dropped");
  assert.equal(drafted.draft.current, true);
  const brain = drafted.draft.preview.filter((l: any) => l.owner === "brain").map((l: any) => l.text);
  assert.ok(brain.includes("Last week 14 kilograms, today 16. Nice and smooth."));
  assert.ok(!brain.some((t: string) => t.includes("beast mode")));
  assert.ok(drafted.draft.preview.some((l: any) => l.owner === "code" && /If anything hurts/.test(l.text)));
  const confirmed = await ok("/voice-sessions/one-on-one/confirm", "POST", { revision: 2, confirmed: true }, coach);
  assert.equal(confirmed.active, true);
  assert.equal(confirmed.confirmed.current, true);
  // The phrases form keeps the confirmed style.
  const style = await ok("/voice-sessions/style", "GET", undefined, coach);
  const savedStyle = await ok("/voice-sessions/style", "PUT", { revision: style.version, style: { ...style.style, oneOnOne: undefined, tone: "calm" } }, coach);
  assert.equal(savedStyle.style.oneOnOne.confirmed.summary, draftReply && (draftReply as any).summary);
  assert.equal((await ok("/voice-sessions/one-on-one", "GET", undefined, coach)).active, true);
  // Keep training: the grow item is done.
  const setup = await ok("/setup", "GET", undefined, coach);
  assert.deepEqual(
    setup.grow.find((g: any) => g.key === "one_on_one"),
    { key: "one_on_one", label: "Your one-on-one sessions", done: true, note: "How you run a session, so voice sessions sound like you.", href: "/trainer/voice#one-on-one" },
  );
});

test("each new session gets Brain lines from one call, kept with the session; failing lines are dropped", async () => {
  // Last time's numbers come from Sara's set log of an earlier workout.
  const earlier = await startWorkout(sara);
  for (const set of [1, 2])
    await ok(`/workouts/${earlier}/sets`, "POST", { eventKey: randomUUID(), exercise: "Back squat", set, reps: 8, loadKg: 55 }, sara);
  await ok(`/workouts/${earlier}/finish`, "POST", undefined, sara);
  narrationReply = {
    open: "Morning Sara, good to see you.",
    exercises: [
      { index: 0, lead: "Last time 55 kilograms for 8, today 60.", rest: "Breathe slow, nice and smooth.", lastSet: "Last one, own it." },
      { index: 1, lead: "Take 400 mg ibuprofen first." },
    ],
    struggle: "Breathe, reset, own the weight.",
    close: "Great work today, Sara.",
  };
  const workout = await startWorkout(sara);
  const calls = prompts.length;
  const session = await ok("/voice-sessions", "POST", { workoutId: workout }, sara);
  assert.equal(prompts.length, calls + 1, "one model call for the new session");
  const sent = JSON.parse(prompts.at(-1)!.user);
  assert.equal(sent.member.firstName, "Sara");
  assert.deepEqual(sent.today.exercises[0].lastTime, { sets: 2, reps: 8, loadKg: 55, daysAgo: 0 });
  assert.match(prompts.at(-1)!.system, /voice-narration-v2/);
  const s = session.script;
  assert.deepEqual(s.intro.map((l: any) => l.id), ["intro:0", "brain:open", "safety"]);
  assert.equal(s.exercises[0].brain.lead.text, "Last time 55 kilograms for 8, today 60.");
  assert.equal(s.exercises[1].brain, undefined, "the medical line is dropped");
  assert.equal(s.brain.struggle.owner, "brain");
  assert.equal(s.cooldown.at(-1).id, "brain:close");
  assert.equal(session.runnable, true);
  const prepared = await scalar("SELECT data FROM events WHERE name='voice_session.prepared' AND subject_id=$1", [session.id]);
  assert.equal(prepared.data.brain.added, 6);
  assert.deepEqual(prepared.data.brain.dropped.map((d: any) => d.slot), ["brain:ex:1:lead"]);
  // Preparing again keeps the same session and its lines: no second call.
  const again = await ok("/voice-sessions", "POST", { workoutId: workout, playbackConsent: true }, sara);
  assert.equal(again.id, session.id);
  assert.equal(prompts.length, calls + 1);
  // The worker voices the Brain lines like any other script line.
  const clips = await scalar("SELECT count(*)::int AS n FROM voice_session_clips WHERE session_id=$1 AND clip_key LIKE 'brain:%'", [session.id]);
  assert.equal(clips.n, 6);
  await ok(`/workouts/${workout}/abandon`, "POST", { note: "Test session ended" }, sara);
});

test("no model use without the member's consent; a failed call leaves the session on code and trainer lines", async () => {
  const calls = prompts.length;
  const noamWorkout = await startWorkout(noam);
  const noamSession = await ok("/voice-sessions", "POST", { workoutId: noamWorkout }, noam);
  assert.equal(prompts.length, calls);
  assert.equal(noamSession.script.brain, undefined);
  narrationReply = null;
  const workout = await startWorkout(sara);
  const session = await ok("/voice-sessions", "POST", { workoutId: workout }, sara);
  assert.equal(prompts.length, calls + 1);
  assert.equal(session.script.intro.some((l: any) => l.owner === "brain"), false);
  assert.equal(session.runnable, true);
  const prepared = await scalar("SELECT data FROM events WHERE name='voice_session.prepared' AND subject_id=$1", [session.id]);
  assert.equal(prepared.data.brain, "failed");
  // Turning the style off stops new Brain lines.
  const view = await ok("/voice-sessions/one-on-one", "GET", undefined, coach);
  const off = await ok("/voice-sessions/one-on-one/confirm", "POST", { revision: view.version, confirmed: false }, coach);
  assert.equal(off.active, false);
});

test("the sample is voiced in the coach's cloned voice within the daily voice limit", async () => {
  const before = mock.syntheses.length;
  const sample = await ok("/voice-sessions/one-on-one/sample-audio", "POST", {}, coach);
  assert.equal(sample.type, "audio/mpeg");
  assert.ok(sample.audio.length > 0);
  assert.equal(mock.syntheses.length, before + 1);
  assert.equal(mock.syntheses.at(-1)!.voiceId, "mock-trainer-voice");
  assert.match(mock.syntheses.at(-1)!.text, /Hey Sam, how did you sleep\?/);
  const cost = await scalar("SELECT count(*)::int AS n FROM cost_events WHERE task='voice.preview' AND trace_id='one-on-one-sample'");
  assert.equal(cost.n, 1);
  // Another workspace has no draft to voice.
  assert.equal((await request("/voice-sessions/one-on-one/sample-audio", "POST", {}, other)).json().code, "ONE_ON_ONE_NO_DRAFT");
});
