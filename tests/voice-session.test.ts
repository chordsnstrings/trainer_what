// Voice-led sessions end to end through the API, the worker step and the
// extended ElevenLabs double (text-to-speech and speech-to-text).
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { processVoiceSessionAudio } from "../apps/api/src/voice-session.ts";
import { disableUserIntegrations } from "../apps/api/src/integrations-completion.ts";
import { testIntegration } from "../packages/providers/src/configuration.ts";
import { initialRunnerState, stepRunner } from "../packages/domain/src/voice-runner.ts";
import { createMockTls, trustMockCa, type MockTls } from "./e2e/mocks/tls.ts";
import { VoiceMock } from "./e2e/mocks/voice.ts";
import { seedScope } from "./scope-fixtures.ts";

let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  tls: MockTls,
  mock: VoiceMock,
  coach: any,
  alex: any,
  bea: any,
  cai: any,
  alexWorkout: string,
  alexSession: any;
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
  STT_CONTRACT_VERIFIED: "true",
  STT_PROVIDER: "elevenlabs",
  STT_API_KEY: "xi_fixture_key",
  STT_BASE_URL: "https://voice.test/v1",
  STT_MODEL: "scribe_v1",
  STT_PRICE_VERSION: "fixture-2026-09",
  STT_USD_PER_HOUR: "0.4",
  STT_ZERO_RETENTION: "true",
};
const saved = Object.fromEntries(
  [...Object.keys(env), "MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_NAME"].map((k) => [k, process.env[k]]),
);
let modelReply: unknown = null;
const modelPrompts: any[] = [];

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
async function member(email: string, name: string) {
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
  return { ...(await request("/bootstrap", "GET", undefined, { cookie })).json().user, cookie };
}
async function subscribe(user: any, modules: string[]) {
  await db.tenant(seedScope(coach), async (tx) => {
    const [updated] = await tx.query(
      "UPDATE subscriptions SET data=$2 WHERE user_id=$1 RETURNING id",
      [user.userId, JSON.stringify({ modules })],
    );
    if (!updated)
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor,data) VALUES($1,$2,$3,'active',now()+interval '30 days',10000,$4)",
        [randomUUID(), coach.tenantId, user.userId, JSON.stringify({ modules })],
      );
  });
}
async function startWorkout(user: any, title = "Lower body strength") {
  const program = await ok(
    "/programs",
    "POST",
    {
      subscriberId: user.userId,
      program: {
        title,
        goal: "Controlled strength practice",
        daysPerWeek: 3,
        exercises: [
          { name: "Back squat", sets: 3, reps: 8, restSeconds: 30, loadKg: 60, cue: "Brace, then sit between your heels." },
          { name: "Push-up", sets: 1, reps: 10, restSeconds: 0, loadKg: 0 },
        ],
      },
    },
    coach,
  );
  return (await ok("/workouts/start", "POST", { programId: program.id }, user)).id as string;
}
const scalar = async (sql: string, values: any[] = []) =>
  (await db.tenant(seedScope(coach), (tx) => tx.query(sql, values)))[0];
function wav(words: string) {
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36, 4);
  header.write("WAVE", 8, "ascii");
  return Buffer.concat([header, Buffer.from(`fmt TRANSCRIPT:${words};`), Buffer.alloc(64)]).toString("base64");
}

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
      modelPrompts.push(JSON.parse(String(init?.body)));
      return Response.json({
        id: "chatcmpl-fixture",
        choices: [{ message: { content: JSON.stringify(modelReply) } }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      });
    }
    return originalFetch(input, init);
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  const r = await request("/auth/register", "POST", {
    name: "Coach Voice",
    email: "voice-coach@example.test",
    password: "TrainingOnly2026!",
    slug: "voice-coach",
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  coach = { ...(await request("/bootstrap", "GET", undefined, { cookie })).json().user, cookie };
  alex = await member("alex@example.test", "Alex Voice");
  bea = await member("bea@example.test", "Bea Budget");
  cai = await member("cai@example.test", "Cai Speech");
  // A verified, consented trainer voice (the reviewed enrollment path is
  // covered in integrations-completion.test.ts).
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

test("without premium voice the same session is text-guided; guided text uses the trainer's cue and title", async () => {
  // Load reduction and skipping are off until the trainer opts in.
  assert.deepEqual((await ok("/voice-sessions/style", "GET", undefined, coach)).style.adjustments, { tooHeavyReducePercent: 0, allowSkip: false });
  const optIn = await ok("/voice-sessions/style", "PUT", { revision: 0, style: { adjustments: { tooHeavyReducePercent: 10, allowSkip: true } } }, coach);
  assert.equal(optIn.version, 1);
  await subscribe(alex, ["training"]);
  alexWorkout = await startWorkout(alex);
  const guided = await ok(`/guided/${alexWorkout}`, "GET", undefined, alex);
  assert.equal(guided.name, "Lower body strength");
  assert.match(guided.segments[0].text, /Brace, then sit between your heels\./);
  const before = await ok(`/voice-sessions/workout/${alexWorkout}`, "GET", undefined, alex);
  assert.equal(before.session, null);
  assert.equal(before.gate.mode, "text");
  assert.ok(before.gate.reasons.some((r: any) => r.code === "VOICE_MEMBERSHIP"));
  const session = await ok("/voice-sessions", "POST", { workoutId: alexWorkout }, alex);
  assert.equal(session.mode, "text");
  assert.equal(session.audioStatus, "none");
  assert.equal(session.audio.total, 0);
  assert.equal(session.script.exercises[0].setLines[0].text, "Set 1 of 3. 8 reps at 60 kilograms. Say done when you finish, or tell me how many reps you did.");
  assert.equal(session.unavailableReason.code, "VOICE_MEMBERSHIP");
  assert.deepEqual(session.script.rules, { tooHeavyReducePercent: 10, allowSkip: true });
  assert.equal(session.runnable, true);
  assert.deepEqual(session.audio.readyKeys, []);
  // Audio is refused for a text session; another member cannot see it.
  assert.equal((await request(`/voice-sessions/${session.id}/audio`, "GET", undefined, alex)).statusCode, 409);
  assert.equal((await request(`/voice-sessions/${session.id}`, "GET", undefined, bea)).statusCode, 404);
  alexSession = session;
});

test("premium voice needs playback consent; the worker makes the audio ahead of time within the budget", async () => {
  await subscribe(alex, ["training", "voice"]);
  const gate = (await ok(`/voice-sessions/workout/${alexWorkout}`, "GET", undefined, alex)).gate;
  assert.deepEqual(gate.reasons.map((r: any) => r.code), ["PLAYBACK_CONSENT"]);
  const same = await ok("/voice-sessions", "POST", { workoutId: alexWorkout }, alex);
  assert.equal(same.id, alexSession.id);
  assert.equal(same.mode, "text");
  const voiced = await ok("/voice-sessions", "POST", { workoutId: alexWorkout, playbackConsent: true }, alex);
  assert.equal(voiced.id, alexSession.id);
  assert.equal(voiced.mode, "voice");
  assert.equal(voiced.audioStatus, "generating");
  assert.equal(voiced.audio.total, 18);
  assert.equal(mock.syntheses.length, 0, "nothing is generated in the request");
  const result = await processVoiceSessionAudio(db, coach.tenantId, { limit: 500 });
  assert.equal(result.capped, false);
  assert.equal(result.generated, 18 + 121);
  assert.equal(mock.syntheses.length, 139);
  assert.ok(mock.syntheses.every((s) => s.voiceId === "mock-trainer-voice" && s.model === "eleven_multilingual_v2"));
  assert.ok(mock.syntheses.some((s) => s.text === "Set 2 of 3. 8 reps at 60 kilograms. Say done when you finish, or tell me how many reps you did."));
  const view = await ok(`/voice-sessions/${alexSession.id}`, "GET", undefined, alex);
  assert.equal(view.audioStatus, "ready");
  assert.deepEqual([view.audio.ready, view.audio.total, view.audio.sharedReady], [18, 18, 121]);
  assert.equal(view.audio.readyKeys.length, 18 + 121);
  assert.ok(view.audio.readyKeys.includes("l:intro:0") && view.audio.readyKeys.includes("s:num:8"));
  const usage = await scalar(
    "SELECT count(*)::int AS n,count(*) FILTER (WHERE status='unknown')::int AS unknown,min((pricing->>'reservedCostUsd')::numeric) AS least FROM cost_events WHERE task='voice.session'",
  );
  assert.equal(usage.n, 139);
  assert.equal(usage.unknown, 139, "delivery is not billed usage: reconciliation stays open");
  assert.ok(Number(usage.least) > 0);
  // Cached per session: preparing again neither re-queues nor re-sends.
  await ok("/voice-sessions", "POST", { workoutId: alexWorkout }, alex);
  await processVoiceSessionAudio(db, coach.tenantId, { limit: 500 });
  assert.equal(mock.syntheses.length, 139);
  // The runner downloads everything in pages and plays from memory.
  const page = await ok(`/voice-sessions/${alexSession.id}/audio`, "GET", undefined, alex);
  assert.equal(page.type, "audio/mpeg");
  assert.equal(page.clips.length, 139);
  assert.equal(page.next, null);
  assert.equal(Buffer.from(page.clips[0].audio, "base64").toString("ascii", 0, 3), "ID3");
  const tail = await ok(`/voice-sessions/${alexSession.id}/audio?after=1num:50`, "GET", undefined, alex);
  assert.ok(tail.clips.length < 139 && tail.clips.every((c: any) => c.shared));
  // Newly ready clips are fetched by key while the rest is still being made.
  const named = await ok(`/voice-sessions/${alexSession.id}/audio?keys=${encodeURIComponent("l:intro:0,s:num:8,l:not:a:line")}`, "GET", undefined, alex);
  assert.deepEqual(named.clips.map((c: any) => (c.shared ? "s:" : "l:") + c.key).sort(), ["l:intro:0", "s:num:8"]);
  assert.equal((await request(`/voice-sessions/${alexSession.id}/audio?keys=${encodeURIComponent("x:bad key")}`, "GET", undefined, alex)).statusCode, 400);
});

test("set logs from the runner use the workout endpoint; adjustments are checked against the trainer's rule", async () => {
  const ctx = { script: alexSession.script, rules: alexSession.script.rules };
  let state = initialRunnerState(ctx.script);
  const effects: any[] = [];
  for (const event of [
    { type: "start" },
    { type: "prompt_done" },
    { type: "command", command: { type: "done" } },
    { type: "prompt_done" },
    { type: "command", command: { type: "too_heavy" } },
    { type: "command", command: { type: "reps", reps: 7 } },
  ] as any[]) {
    const [next, out] = stepRunner(ctx, state, event);
    state = next;
    effects.push(...out);
  }
  const log = effects.find((e) => e.type === "log_set");
  const logged = await ok(
    `/workouts/${alexWorkout}/sets`,
    "POST",
    { eventKey: randomUUID(), exercise: log.exercise, set: log.set, reps: log.reps, loadKg: log.loadKg },
    alex,
  );
  assert.equal(logged.data.loadKg, 54);
  assert.equal(logged.data.reps, 7);
  const outcomes = effects.filter((e) => e.type === "outcome").map((e) => e.outcome);
  const recorded = await ok(`/voice-sessions/${alexSession.id}/events`, "POST", { status: "running", outcomes }, alex);
  assert.equal(recorded.status, "running");
  const bad = await request(
    `/voice-sessions/${alexSession.id}/events`,
    "POST",
    { outcomes: [{ type: "adjusted", exercise: 0, set: 2, fromKg: 60, toKg: 40 }] },
    alex,
  );
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().code, "VOICE_ADJUSTMENT");
  const outside = await request(`/voice-sessions/${alexSession.id}/events`, "POST", { outcomes: [{ type: "skipped_set", exercise: 7, set: 1 }] }, alex);
  assert.equal(outside.statusCode, 400);
  const trainerView = await ok("/voice-sessions/outcomes", "GET", undefined, coach);
  const mine = trainerView.sessions.find((s: any) => s.id === alexSession.id);
  assert.equal(mine.member, "Alex Voice");
  assert.equal(mine.outcomes.totals.adjusted, 1);
  assert.equal(mine.outcomes.byExercise["Back squat"].set_logged, 1);
  assert.equal((await request("/voice-sessions/outcomes", "GET", undefined, alex)).statusCode, 403);
});

test("the daily voice budget caps generation; the session continues as text and resumes later", async () => {
  await subscribe(bea, ["training", "voice"]);
  const workout = await startWorkout(bea, "Budget day");
  await ok("/voice-sessions/consent", "POST", { playback: true }, bea);
  const spent = Number((await scalar("SELECT voice_guidance_spent_today() AS total")).total);
  process.env.VOICE_DAILY_USD_LIMIT = String(spent + 0.005);
  try {
    const session = await ok("/voice-sessions", "POST", { workoutId: workout }, bea);
    assert.equal(session.mode, "voice");
    const calls = mock.syntheses.length;
    const result = await processVoiceSessionAudio(db, coach.tenantId, { limit: 500 });
    assert.equal(result.capped, true);
    assert.equal(mock.syntheses.length, calls, "no request beyond the cap");
    const view = await ok(`/voice-sessions/${session.id}`, "GET", undefined, bea);
    assert.equal(view.audioStatus, "capped");
    assert.equal(view.unavailableReason.code, "VOICE_BUDGET");
    assert.equal(view.audio.ready, 0);
    process.env.VOICE_DAILY_USD_LIMIT = String(spent);
    const gate = (await ok(`/voice-sessions/workout/${workout}`, "GET", undefined, bea)).gate;
    assert.equal(gate.mode, "text");
    assert.ok(gate.reasons.some((r: any) => r.code === "VOICE_BUDGET"));
    assert.equal(gate.budget.reached, true);
    // A new day's (here: a raised) budget lets the same session finish its audio.
    process.env.VOICE_DAILY_USD_LIMIT = "5";
    const resumed = await ok("/voice-sessions", "POST", { workoutId: workout }, bea);
    assert.equal(resumed.id, session.id);
    assert.equal(resumed.audioStatus, "generating");
    await processVoiceSessionAudio(db, coach.tenantId, { limit: 500 });
    const done = await ok(`/voice-sessions/${session.id}`, "GET", undefined, bea);
    assert.equal(done.audioStatus, "ready");
    // The same lines for the same member are copied, not paid for again.
    await ok(`/workouts/${workout}/finish`, "POST", undefined, bea);
    const again = await startWorkout(bea, "Budget day, week two");
    const repeat = await ok("/voice-sessions", "POST", { workoutId: again }, bea);
    assert.notEqual(repeat.id, session.id);
    const before = mock.syntheses.length;
    const reuse = await processVoiceSessionAudio(db, coach.tenantId, { limit: 500 });
    assert.deepEqual([reuse.generated, reuse.reused], [0, 18]);
    assert.equal(mock.syntheses.length, before);
    assert.equal((await ok(`/voice-sessions/${repeat.id}`, "GET", undefined, bea)).audioStatus, "ready");
  } finally {
    process.env.VOICE_DAILY_USD_LIMIT = "5";
  }
  // Row security: Bea reads the workspace's shared clips but not Alex's lines.
  const visible = await db.tenant(bea, (tx) =>
    tx.query("SELECT count(*) FILTER (WHERE user_id IS NULL)::int AS shared,count(*) FILTER (WHERE session_id=$1)::int AS others FROM voice_session_clips", [alexSession.id]),
  );
  assert.equal(visible[0].shared, 121);
  assert.equal(visible[0].others, 0);
  assert.equal((await db.tenant(bea, (tx) => tx.query("SELECT id FROM voice_sessions WHERE id=$1", [alexSession.id]))).length, 0);
});

test("spoken replies: transcription needs consent, stores no audio and a red flag opens the safety hold", async () => {
  await subscribe(cai, ["training", "voice"]);
  const workout = await startWorkout(cai, "Speech day");
  const session = await ok("/voice-sessions", "POST", { workoutId: workout, playbackConsent: true }, cai);
  const reply = { audio: wav("eight reps"), type: "audio/wav", durationMs: 1500 };
  const refused = await request(`/voice-sessions/${session.id}/transcribe`, "POST", reply, cai);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().code, "TRANSCRIPTION_CONSENT");
  assert.equal(mock.transcriptions.length, 0);
  await ok("/voice-sessions/consent", "POST", { transcription: true }, cai);
  const heard = await ok(`/voice-sessions/${session.id}/transcribe`, "POST", reply, cai);
  assert.equal(heard.transcript, "eight reps");
  assert.deepEqual(heard.command, { type: "reps", reps: 8 });
  assert.equal(heard.trainingHeld, false);
  assert.equal(mock.transcriptions.length, 1);
  assert.equal(mock.transcriptions[0].model, "scribe_v1");
  assert.equal(mock.transcriptions[0].zeroRetention, true);
  const cost = await scalar("SELECT status,pricing FROM cost_events WHERE task='voice.transcription'");
  assert.equal(cost.status, "unknown");
  assert.equal(cost.pricing.basis, "audio_seconds");
  // The provider's own timing (end of the last word) is kept for reconciliation.
  const timed = await scalar("SELECT data FROM events WHERE name='voice_session.transcribed' AND subject_id=$1", [session.id]);
  assert.equal(timed.data.providerSeconds, 0.8);
  assert.equal(timed.data.reservedSeconds, 1.5);
  // A long clip cannot be declared short: it is reserved at its byte-derived
  // length (6 kbit/s floor), so the workspace cap sees its real upper bound.
  const long = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(400000)]).toString("base64");
  const spentBefore = Number((await scalar("SELECT voice_guidance_spent_today() AS total")).total);
  process.env.VOICE_DAILY_USD_LIMIT = String(spentBefore + 0.01);
  try {
    const capped = await request(`/voice-sessions/${session.id}/transcribe`, "POST", { audio: long, type: "audio/webm", durationMs: 200 }, cai);
    assert.equal(capped.statusCode, 429, capped.body);
    assert.equal(capped.json().code, "VOICE_BUDGET");
    assert.equal(mock.transcriptions.length, 1, "nothing is sent beyond the cap");
  } finally {
    process.env.VOICE_DAILY_USD_LIMIT = "5";
  }
  await ok(`/voice-sessions/${session.id}/transcribe`, "POST", { audio: long, type: "audio/webm", durationMs: 200 }, cai);
  const reserved = await scalar("SELECT pricing FROM cost_events WHERE task='voice.transcription' ORDER BY created_at DESC LIMIT 1");
  assert.equal(reserved.pricing.declaredSeconds, 0.2);
  assert.ok(reserved.pricing.seconds >= 533, JSON.stringify(reserved.pricing));
  assert.ok(Number(reserved.pricing.reservedCostUsd) >= (533 / 3600) * 0.4);
  const mismatch = await request(`/voice-sessions/${session.id}/transcribe`, "POST", { ...reply, type: "audio/ogg" }, cai);
  assert.equal(mismatch.statusCode, 400);
  // Device transcripts are re-screened on the server with the trainer's policy.
  const done = await ok(`/voice-sessions/${session.id}/utterance`, "POST", { transcript: "done" }, cai);
  assert.deepEqual([done.command.type, done.trainingHeld], ["done", false]);
  const pain = await ok(
    `/voice-sessions/${session.id}/transcribe`,
    "POST",
    { audio: wav("my chest feels tight and I am dizzy"), type: "audio/wav", durationMs: 2000 },
    cai,
  );
  assert.equal(pain.command.type, "pain");
  assert.equal(pain.trainingHeld, true);
  const held = await scalar(
    "SELECT (SELECT status FROM records WHERE id=$1) AS workout,(SELECT count(*)::int FROM records WHERE kind='training_hold' AND owner_user_id=$2 AND status='active') AS holds,(SELECT status||':'||end_reason FROM voice_sessions WHERE id=$3) AS session",
    [workout, cai.userId, session.id],
  );
  assert.deepEqual(held, { workout: "safety_hold", holds: 1, session: "stopped:pain" });
  // Held training blocks new transcription and new sessions.
  assert.equal((await request(`/voice-sessions/${session.id}/transcribe`, "POST", reply, cai)).statusCode, 409);
  assert.equal((await request("/voice-sessions", "POST", { workoutId: workout }, cai)).statusCode, 409);
  // No audio of a reply is kept anywhere: sessions hold only structured data.
  const stored = await scalar("SELECT count(*)::int AS n FROM voice_sessions WHERE events::text LIKE '%chest%' OR script::text LIKE '%TRANSCRIPT%'");
  assert.equal(stored.n, 0);
});

test("a session prepared ahead from a planned session gets its audio before the day and binds when the workout starts; a substitution makes it stale", async () => {
  const dee = await member("dee@example.test", "Dee Ahead");
  await subscribe(dee, ["training", "voice"]);
  const program = await ok(
    "/programs",
    "POST",
    {
      subscriberId: dee.userId,
      program: {
        title: "Planned legs",
        goal: "Strength ahead of time",
        daysPerWeek: 3,
        exercises: [
          { name: "Back squat", sets: 2, reps: 5, restSeconds: 30, loadKg: 50, cue: "Brace first.", alternatives: [{ name: "Goblet squat", cue: "Hold the bell close.", loadKg: 20 }] },
          { name: "Push-up", sets: 1, reps: 10, restSeconds: 0 },
        ],
      },
    },
    coach,
  );
  const planned = await scalar(
    "SELECT id FROM records WHERE kind='planned_session' AND owner_user_id=$1 AND data->>'programId'=$2 ORDER BY data->>'date',id LIMIT 1",
    [dee.userId, program.id],
  );
  const before = await ok(`/voice-sessions/planned/${planned.id}`, "GET", undefined, dee);
  assert.equal(before.session, null);
  assert.equal(before.planned.status, "planned");
  // Another member cannot prepare or read Dee's planned session.
  assert.equal((await request(`/voice-sessions/planned/${planned.id}`, "GET", undefined, bea)).statusCode, 404);
  assert.equal((await request("/voice-sessions", "POST", { plannedSessionId: planned.id }, bea)).statusCode, 404);
  assert.equal((await request("/voice-sessions", "POST", { plannedSessionId: planned.id, workoutId: alexWorkout }, dee)).statusCode, 400);
  const ahead = await ok("/voice-sessions", "POST", { plannedSessionId: planned.id, playbackConsent: true }, dee);
  assert.equal(ahead.workoutId, null);
  assert.equal(ahead.plannedSessionId, planned.id);
  assert.deepEqual([ahead.mode, ahead.audioStatus], ["voice", "generating"]);
  // It cannot run before the workout exists.
  assert.equal((await request(`/voice-sessions/${ahead.id}/events`, "POST", { status: "running" }, dee)).statusCode, 409);
  const calls = mock.syntheses.length;
  await processVoiceSessionAudio(db, coach.tenantId, { limit: 500 });
  const made = mock.syntheses.length - calls;
  assert.ok(made > 0, "audio is made before the day");
  const ready = await ok(`/voice-sessions/planned/${planned.id}`, "GET", undefined, dee);
  assert.equal(ready.session.id, ahead.id);
  assert.equal(ready.session.audioStatus, "ready");
  // On the day the workout starts: the same session, bound after re-validation, no new audio.
  const workout = (await ok("/workouts/start", "POST", { programId: program.id, plannedSessionId: planned.id }, dee)).id;
  const opened = await ok(`/voice-sessions/workout/${workout}`, "GET", undefined, dee);
  assert.equal(opened.session.id, ahead.id);
  assert.equal(opened.session.workoutId, workout);
  assert.equal(opened.session.runnable, true);
  assert.equal(opened.session.audioStatus, "ready");
  assert.equal((await ok("/voice-sessions", "POST", { plannedSessionId: planned.id }, dee)).id, ahead.id);
  await processVoiceSessionAudio(db, coach.tenantId, { limit: 500 });
  assert.equal(mock.syntheses.length - calls, made);
  assert.equal((await ok(`/voice-sessions/planned/${planned.id}`, "GET", undefined, dee)).planned.workoutId, workout);
  // A substitution rewrites the workout's plan: the stored script is stale and
  // is never returned as runnable.
  const w = await scalar("SELECT version FROM records WHERE id=$1", [workout]);
  await ok(`/workouts/${workout}/substitute`, "POST", { version: w.version, exercise: "Back squat", replacement: "Goblet squat", reason: "equipment_unavailable" }, dee);
  const after = await ok(`/voice-sessions/workout/${workout}`, "GET", undefined, dee);
  assert.equal(after.session, null);
  assert.equal(after.stale, true);
  const polled = await ok(`/voice-sessions/${ahead.id}`, "GET", undefined, dee);
  assert.deepEqual([polled.stale, polled.runnable], [true, false]);
  // Preparing again revokes the old script and builds from the current plan.
  const fresh = await ok("/voice-sessions", "POST", { workoutId: workout }, dee);
  assert.notEqual(fresh.id, ahead.id);
  assert.equal(fresh.script.exercises[0].setup.text, "Exercise 1 of 2: Goblet squat. 2 sets of 5 reps at 20 kilograms.");
  assert.equal(fresh.script.exercises[0].cueLine.text, "Hold the bell close.");
  assert.deepEqual(
    await scalar("SELECT status,unavailable_reason FROM voice_sessions WHERE id=$1", [ahead.id]),
    { status: "revoked", unavailable_reason: "VOICE_SCRIPT_INVALID" },
  );
  assert.equal((await scalar("SELECT count(*)::int AS n FROM voice_session_clips WHERE session_id=$1 AND audio IS NOT NULL", [ahead.id])).n, 0);

  // A clip left reserved by a crash is swept to unknown (never re-sent), with
  // its cost row, and cannot hold the session in preparation forever.
  const stuck = await scalar("SELECT id FROM voice_session_clips WHERE session_id=$1 AND status='pending' ORDER BY clip_key LIMIT 1", [fresh.id]);
  const usage = randomUUID();
  await db.tenant(seedScope(coach), async (tx) => {
    await tx.query(
      "INSERT INTO cost_events(id,tenant_id,user_id,task,provider,model,status,price_version,pricing,trace_id) VALUES($1,$2,$3,'voice.session','elevenlabs','eleven_multilingual_v2','reserved','fixture',$4,$5)",
      [usage, coach.tenantId, dee.userId, JSON.stringify({ reservedCostUsd: 0.001 }), stuck.id],
    );
    await tx.query("UPDATE voice_session_clips SET status='reserved',usage_id=$2,updated_at=now()-interval '10 minutes' WHERE id=$1", [stuck.id, usage]);
  });
  await processVoiceSessionAudio(db, coach.tenantId, { limit: 500 });
  assert.deepEqual(
    await scalar(
      "SELECT (SELECT status FROM voice_session_clips WHERE id=$1) AS clip,(SELECT status FROM cost_events WHERE id=$2) AS cost,(SELECT audio_status FROM voice_sessions WHERE id=$3) AS session",
      [stuck.id, usage, fresh.id],
    ),
    { clip: "unknown", cost: "unknown", session: "partial" },
  );
});

test("withdrawing playback consent or revoking the trainer voice removes stored audio", async () => {
  await ok("/voice-sessions/consent", "POST", { playback: false }, alex);
  const view = await ok(`/voice-sessions/${alexSession.id}`, "GET", undefined, alex);
  assert.equal(view.mode, "text");
  assert.equal(view.audioStatus, "revoked");
  assert.equal(view.unavailableReason.code, "PLAYBACK_CONSENT");
  assert.equal((await request(`/voice-sessions/${alexSession.id}/audio`, "GET", undefined, alex)).statusCode, 409);
  const clips = await scalar("SELECT count(*) FILTER (WHERE audio IS NOT NULL)::int AS audio FROM voice_session_clips WHERE user_id=$1", [alex.userId]);
  assert.equal(clips.audio, 0);
  await db.tenant(seedScope(coach), (tx) => disableUserIntegrations(tx, coach.userId, "voice"));
  const left = await scalar("SELECT count(*) FILTER (WHERE audio IS NOT NULL)::int AS audio,count(*) FILTER (WHERE status<>'revoked')::int AS live FROM voice_session_clips");
  assert.deepEqual(left, { audio: 0, live: 0 });
  const gate = (await ok(`/voice-sessions/workout/${alexWorkout}`, "GET", undefined, alex)).gate;
  assert.ok(gate.reasons.some((r: any) => r.code === "VOICE_NOT_VERIFIED"));
});

test("the trainer's style is checked, versioned and read by members only through the definer", async () => {
  const bad = await request(
    "/voice-sessions/style",
    "PUT",
    { revision: 1, style: { encouragement: ["Do 3 extra sets!"], formReminders: ["Ice it after", "Hold your breath and strain hard."] } },
    coach,
  );
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().code, "VOICE_STYLE_WORDING");
  assert.match(bad.json().message, /encouragement line 1: number, prescription_change/);
  assert.match(bad.json().message, /formReminders line 2: unsafe_technique/);
  const saved = await ok(
    "/voice-sessions/style",
    "PUT",
    { revision: 1, style: { tone: "energetic", encouragement: ["That's how we do it!"], adjustments: { tooHeavyReducePercent: 5, allowSkip: false } } },
    coach,
  );
  assert.equal(saved.version, 2);
  assert.equal((await request("/voice-sessions/style", "PUT", { revision: 1, style: {} }, coach)).statusCode, 409);
  const preview = await ok("/voice-sessions/style/preview", "POST", {}, coach);
  assert.ok(preview.lines.some((l: any) => l.owner === "trainer" && l.text === "That's how we do it!"));
  assert.ok(preview.lines.some((l: any) => l.owner === "code" && /3 sets of 10 reps at 16 kilograms/.test(l.text)));
  assert.equal((await request("/voice-sessions/style", "GET", undefined, alex)).statusCode, 403);
  const direct = await db.tenant(alex, (tx) => tx.query("SELECT * FROM voice_session_styles"));
  assert.equal(direct.length, 0);
  const viaHelper = await db.tenant(alex, (tx) => tx.query("SELECT version FROM voice_session_style()"));
  assert.equal(viaHelper[0].version, 2);
});

test("Brain wording suggestions are checked and kept for the trainer's review; nothing unapproved is spoken", async () => {
  Object.assign(process.env, { MODEL_BASE_URL: "https://model.test/v1", MODEL_API_KEY: "fixture", MODEL_NAME: "fixture-model" });
  modelReply = {
    intro: ["Let's own this session together."],
    encouragement: ["Add 5 kilograms now!", "Take a painkiller if needed", "Stay strong through every rep."],
    cooldown: ["Walk it out and breathe easy."],
    finish: ["That is a wrap, great effort."],
  };
  try {
    // Voice audio rows do not use up the workspace's daily model-call limit.
    const voiceRows = await scalar("SELECT count(*)::int AS n FROM cost_events WHERE task LIKE 'voice.%'");
    assert.ok(voiceRows.n > 100);
    const usage = await scalar("SELECT n FROM model_usage_today(ARRAY[]::text[],$1)", [coach.userId]);
    assert.equal(usage.n, 0);
    assert.equal((await request("/voice-sessions/style/suggestions", "POST", undefined, alex)).statusCode, 403);
    const made = await ok("/voice-sessions/style/suggestions", "POST", undefined, coach);
    assert.deepEqual(made.suggestions.intro, ["Let's own this session together."]);
    assert.deepEqual(made.suggestions.encouragement, ["Stay strong through every rep."]);
    assert.equal(made.rejected.length, 2);
    const prompt = JSON.parse(modelPrompts.at(-1).messages[1].content);
    assert.equal(prompt.exercises, undefined, "no exercises: technique is never the model's");
    assert.equal(JSON.stringify(prompt).includes("Alex"), false, "no member data in the prompt");
    assert.equal((await scalar("SELECT count(*)::int AS n FROM cost_events WHERE task='voice_session_suggestions'")).n, 1);
    // Members never see suggestions, and sessions do not speak them.
    const helper = await db.tenant(alex, (tx) => tx.query("SELECT * FROM voice_session_style()"));
    assert.equal(JSON.stringify(helper).includes("own this session"), false);
    await ok(`/workouts/${alexWorkout}/finish`, "POST", undefined, alex);
    const workout = await startWorkout(alex, "Brain day");
    const session = await ok("/voice-sessions", "POST", { workoutId: workout }, alex);
    assert.equal(session.generator, "rules");
    assert.equal(JSON.stringify(session.script).includes("own this session"), false);
    assert.ok([...session.script.intro, session.script.finish].every((l: any) => ["code", "trainer"].includes(l.owner)));
    // The trainer approves one line by saving it into the style.
    const style = await ok("/voice-sessions/style", "GET", undefined, coach);
    assert.deepEqual(style.suggestions.intro, ["Let's own this session together."]);
    const saved = await ok(
      "/voice-sessions/style",
      "PUT",
      { revision: style.version, style: { ...style.style, intro: ["Let's own this session together."] } },
      coach,
    );
    assert.deepEqual(saved.suggestions.intro, []);
    assert.deepEqual(saved.suggestions.encouragement, ["Stay strong through every rep."]);
    await ok(`/workouts/${workout}/finish`, "POST", undefined, alex);
    const next = await startWorkout(alex, "Brain day two");
    const approved = await ok("/voice-sessions", "POST", { workoutId: next }, alex);
    assert.equal(approved.script.intro[0].text, "Let's own this session together.");
    assert.equal(approved.script.intro[0].owner, "trainer");
    assert.equal(approved.styleVersion, saved.version);
    assert.deepEqual(approved.script.rules, { tooHeavyReducePercent: 5, allowSkip: false });
    // Dismissing clears what is left.
    await ok("/voice-sessions/style/suggestions", "DELETE", undefined, coach);
    assert.equal((await ok("/voice-sessions/style", "GET", undefined, coach)).suggestions.encouragement.length, 0);
  } finally {
    for (const k of ["MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_NAME"])
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  }
});

test("the speech-to-text connection check reads the model list and stays off until approved", async () => {
  const fields = {
    STT_PROVIDER: "elevenlabs",
    STT_BASE_URL: "https://voice.test/v1",
    STT_API_KEY: env.STT_API_KEY,
    STT_MODEL: "scribe_v1",
    STT_PRICE_VERSION: "fixture",
    STT_USD_PER_HOUR: "0.4",
  };
  const unapproved = await testIntegration("speech_to_text", fields);
  assert.equal(unapproved.status, "unavailable");
  const verified = await testIntegration("speech_to_text", { ...fields, STT_CONTRACT_VERIFIED: "true" });
  assert.equal(verified.status, "verified", verified.message);
  assert.equal(verified.details?.models, 2);
  const wrong = await testIntegration("speech_to_text", { ...fields, STT_API_KEY: "wrong", STT_CONTRACT_VERIFIED: "true" });
  assert.equal(wrong.status, "failed");
  // Unconfigured speech-to-text falls back to the buttons.
  delete process.env.STT_CONTRACT_VERIFIED;
  try {
    const r = await request(`/voice-sessions/${alexSession.id}/transcribe`, "POST", { audio: wav("done"), type: "audio/wav", durationMs: 800 }, alex);
    assert.equal(r.statusCode, 503);
    assert.equal(r.json().code, "SPEECH_UNAVAILABLE");
  } finally {
    process.env.STT_CONTRACT_VERIFIED = "true";
  }
});
