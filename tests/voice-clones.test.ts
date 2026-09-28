// Trainer voice clones with Cartesia (docs/features/trainer-voice.md): the
// provider adapter's request shapes, settings, the clone lifecycle through the
// API and the worker against the Cartesia double, tenant isolation, consent,
// deletion at the provider, and voice sessions speaking with the active clone.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createDatabase, elevated, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { processVoiceSessionAudio } from "../apps/api/src/voice-session.ts";
import Fastify from "fastify";
import {
  advanceVoiceClone,
  processVoiceClones,
  processVoiceProviderDeletions,
  registerVoiceClones,
} from "../apps/api/src/voice-clones.ts";
import { platformSettingsRoutes } from "../apps/api/src/platform-settings.ts";
import { privacyHooks } from "../apps/api/src/privacy-hooks.ts";
import { openSealedBytes, sealContexts } from "../apps/api/src/sealing.ts";
import {
  integrationCapability,
  testIntegration,
  validateIntegrationValues,
} from "../packages/providers/src/configuration.ts";
import {
  cartesiaVoiceClient,
  generateTrainerVoice,
  speechModel,
  speechToTextContract,
  transcribeSpeech,
  voiceBaseUrl,
  voiceContract,
  withIntegrationFixtureTransport,
} from "../packages/providers/src/integrations.ts";
import {
  CARTESIA_CLONE_LANGUAGES,
  CartesiaError,
  proCloneModel,
} from "../packages/providers/src/cartesia.ts";
import {
  CLONE_LANGUAGE_NAMES,
  PREVIEW_LINE,
  canTransition,
  checkSample,
  recordingsReady,
} from "../packages/domain/src/voice-clone.ts";
import { createMockTls, trustMockCa, type MockTls } from "./e2e/mocks/tls.ts";
import { CartesiaMock } from "./e2e/mocks/cartesia.ts";
import { privacyOperator, seedScope } from "./scope-fixtures.ts";

const KEY = "sk_car_fixture_" + randomBytes(8).toString("hex");
const env: Record<string, string> = {
  VOICE_CONTRACT_VERIFIED: "true",
  VOICE_PROVIDER: "cartesia",
  VOICE_API_KEY: KEY,
  VOICE_BASE_URL: "https://cartesia.test",
  VOICE_MODEL: "sonic-3.6",
  VOICE_API_VERSION: "2026-08-14",
  VOICE_PRICE_VERSION: "fixture-cartesia-2026-09",
  VOICE_USD_PER_1000_CHARACTERS: "0.05",
  VOICE_DAILY_USD_LIMIT: "5",
  VOICE_QUICK_CLONE_ENABLED: "true",
  VOICE_PRO_CLONE_ENABLED: "false",
  VOICE_PRO_CLONE_SLOTS: "2",
  VOICE_CLONE_USD: "0",
  // The default is on (an operator reviews each clone); these flows test the
  // trainer's own activation. The default is checked separately below.
  VOICE_CLONE_REVIEW_REQUIRED: "false",
  STT_CONTRACT_VERIFIED: "true",
  STT_PROVIDER: "cartesia",
  STT_API_KEY: KEY,
  STT_BASE_URL: "https://cartesia.test",
  STT_PRICE_VERSION: "fixture-cartesia-2026-09",
  STT_USD_PER_HOUR: "0.1",
  SECURITY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
const saved = Object.fromEntries(
  [...Object.keys(env), "VOICE_PRO_CLONE_PRICE_AED", "STT_MODEL", "STT_ZERO_RETENTION"].map((k) => [k, process.env[k]]),
);
const originalFetch = globalThis.fetch;
let db: Database,
  app: Awaited<ReturnType<typeof buildApp>>,
  tls: MockTls,
  mock: CartesiaMock,
  coach: any,
  other: any,
  alex: any,
  bo: any,
  quick: any,
  quick2: any,
  pro: any,
  third: any,
  alexWorkout: string,
  alexSession: string;

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
async function refused(url: string, method: any, body: any, actor: any, status: number, code?: string) {
  const r = await request(url, method, body, actor);
  assert.equal(r.statusCode, status, `${method} ${url}: ${r.body}`);
  if (code) assert.equal(r.json().code, code, r.body);
  return r.json();
}
async function register(email: string, slug: string) {
  const r = await request("/auth/register", "POST", {
    name: "Coach " + slug,
    email,
    password: "TrainingOnly2026!",
    slug,
    accepted: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  return { ...(await request("/bootstrap", "GET", undefined, { cookie })).json().user, cookie };
}
async function member(trainer: any, email: string, name: string) {
  const invite = await request("/invitations", "POST", { email, role: "subscriber" }, trainer);
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
async function subscribeVoice(trainer: any, user: any) {
  await db.tenant(seedScope(trainer), (tx) =>
    tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,period_end,price_minor,data) VALUES($1,$2,$3,'active',now()+interval '30 days',10000,$4)",
      [randomUUID(), trainer.tenantId, user.userId, JSON.stringify({ modules: ["training", "voice"] })],
    ),
  );
}
const rows = (trainer: any, sql: string, values: any[] = []) =>
  db.tenant(seedScope(trainer), (tx) => tx.query(sql, values));
/** A PCM WAV of the given length (8 kHz, mono, 8-bit): its header gives the exact seconds. */
function wavOf(seconds: number, words = "") {
  const data = Buffer.concat([Buffer.from(words ? `TRANSCRIPT:${words};` : ""), randomBytes(Math.round(seconds * 8000))]);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(8000, 28);
  h.writeUInt16LE(1, 32);
  h.writeUInt16LE(8, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
/** An Ogg-like file whose size is plausible for `seconds` of speech. */
const oggOf = (bytes = 150000) => Buffer.concat([Buffer.from("OggS"), randomBytes(bytes - 4)]);
const CONSENT = { ownVoice: true, cloning: true, subscriberUse: true, deletion: true };
async function quickClone(trainer: any) {
  const draft = await ok("/voice/clones", "POST", { kind: "instant", language: "en", consent: CONSENT }, trainer);
  const withSample = await ok(
    `/voice/clones/${draft.id}/samples`,
    "POST",
    { audio: wavOf(12).toString("base64"), type: "audio/wav", durationSeconds: 12 },
    trainer,
  );
  return ok(`/voice/clones/${draft.id}/submit`, "POST", { revision: withSample.version }, trainer);
}
/** Runs worker passes, skipping provider waits, until `done` or 12 passes. */
async function workerUntil(trainer: any, done: () => Promise<boolean>) {
  for (let pass = 0; pass < 12; pass++) {
    if (await done()) return pass;
    await rows(trainer, "UPDATE trainer_voice_clones SET next_attempt_at=now() WHERE status='processing'");
    await processVoiceClones(db);
  }
  assert.ok(await done(), "the worker finished within 12 passes");
  return 12;
}

before(async () => {
  Object.assign(process.env, env);
  delete process.env.STT_MODEL;
  tls = createMockTls();
  trustMockCa(tls.ca);
  mock = new CartesiaMock({ key: tls.key, cert: tls.cert }, KEY);
  await mock.start();
  globalThis.fetch = async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://cartesia.test/"))
      return originalFetch(url.replace("https://cartesia.test", mock.url), init);
    return originalFetch(input, init);
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  coach = await register("clone-coach@example.test", "clone-coach");
  other = await register("other-coach@example.test", "other-coach");
  alex = await member(coach, "alex-clone@example.test", "Alex Clone");
  bo = await member(other, "bo-clone@example.test", "Bo Other");
  third = await register("third-coach@example.test", "third-coach");
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

test("Cartesia settings: provider choice, standard addresses, validation and a read-only connection check", async () => {
  assert.equal(validateIntegrationValues("voice", { VOICE_PROVIDER: "cartesia" }).VOICE_PROVIDER, "cartesia");
  assert.throws(() => validateIntegrationValues("voice", { VOICE_PROVIDER: "acme" }), /unsupported selection/);
  assert.throws(() => validateIntegrationValues("voice", { VOICE_API_VERSION: "2026/08/14" }), /date such as/);
  assert.throws(() => validateIntegrationValues("voice", { VOICE_PRO_CLONE_SLOTS: "2.5" }), /whole number/);
  assert.throws(() => validateIntegrationValues("speech_to_text", { STT_PROVIDER: "acme" }), /unsupported selection/);
  const config = { ...env, VOICE_BASE_URL: "" };
  assert.deepEqual(integrationCapability("voice", config), { configured: true, approved: true });
  assert.deepEqual(integrationCapability("speech_to_text", config), { configured: true, approved: true });
  assert.equal(integrationCapability("voice", { ...config, VOICE_PROVIDER: "acme" })!.approved, false);
  // Blank, or another provider's standard address, means the provider's own.
  assert.equal(voiceBaseUrl("cartesia", ""), "https://api.cartesia.ai");
  assert.equal(voiceBaseUrl("cartesia", "https://api.elevenlabs.io/v1"), "https://api.cartesia.ai");
  assert.equal(voiceBaseUrl("elevenlabs", "https://api.cartesia.ai"), "https://api.elevenlabs.io/v1");
  assert.equal(speechModel("cartesia", "scribe_v1"), "ink-whisper");
  assert.equal(speechModel("elevenlabs", ""), "scribe_v1");
  assert.equal(proCloneModel("sonic-3.6", ["sonic-3.5-2026-05-04", "sonic-3.6-2026-08-27"]), "sonic-3.6-2026-08-27");
  assert.equal(proCloneModel("sonic-3.5-2026-05-04", ["sonic-3.5-2026-05-04", "sonic-3.6-2026-08-27"]), "sonic-3.5-2026-05-04");
  // The clone languages the UI offers are exactly the provider's.
  assert.deepEqual(Object.keys(CLONE_LANGUAGE_NAMES).sort(), [...CARTESIA_CLONE_LANGUAGES].sort());
  const before = mock.server.log.length;
  const checked = await testIntegration("voice", { ...env });
  assert.equal(checked.status, "verified", checked.message);
  assert.deepEqual(checked.details, { provider: "cartesia", apiVersion: "2026-08-14" });
  const read = mock.server.log.slice(before);
  assert.deepEqual(read.map((r) => `${r.method} ${r.path}${r.query}`), ["GET /voices?limit=1"]);
  assert.equal(read[0].headers["cartesia-version"], "2026-08-14");
  assert.equal(read[0].headers.authorization, undefined, "the mock log never keeps the key");
  const stt = await testIntegration("speech_to_text", { ...env });
  assert.equal(stt.status, "verified", stt.message);
  const wrong = await testIntegration("voice", { ...env, VOICE_API_KEY: "sk_car_wrong_key_value" });
  assert.equal(wrong.status, "failed");
  assert.doesNotMatch(JSON.stringify(wrong), /sk_car_/);
  const unapproved = await testIntegration("voice", { ...env, VOICE_CONTRACT_VERIFIED: "false" });
  assert.equal(unapproved.status, "unavailable");
  // Zero retention cannot be requested from Cartesia: never silently dropped.
  const zero = { ...env, STT_ZERO_RETENTION: "true" };
  assert.equal(integrationCapability("speech_to_text", zero)!.approved, false);
  assert.equal(integrationCapability("speech_to_text", { ...zero, STT_PROVIDER: "elevenlabs" })!.approved, true);
  const zeroCheck = await testIntegration("speech_to_text", zero);
  assert.equal(zeroCheck.status, "unavailable");
  assert.match(zeroCheck.message, /Enterprise account setting/);
  process.env.STT_ZERO_RETENTION = "true";
  try {
    assert.throws(() => speechToTextContract(), /Enterprise account setting/);
  } finally {
    delete process.env.STT_ZERO_RETENTION;
  }
  // The trainer's own preview-and-accept is the review; operator review is
  // off unless switched on (owner decision, 28 September 2026).
  delete process.env.VOICE_CLONE_REVIEW_REQUIRED;
  try {
    assert.equal(voiceContract().cloning.reviewRequired, false);
    process.env.VOICE_CLONE_REVIEW_REQUIRED = "true";
    assert.equal(voiceContract().cloning.reviewRequired, true);
  } finally {
    process.env.VOICE_CLONE_REVIEW_REQUIRED = "false";
  }
});

test("adapter request shapes: bearer key, pinned version, JSON speech and multipart clone, dataset and transcription", async () => {
  const sent: Array<{ url: string; init: RequestInit }> = [];
  const answers: Response[] = [];
  const transport = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return answers.shift() ?? new Response("{}", { status: 500 });
  };
  const text = (i: number) => {
    const body = sent[i].init.body as any;
    return typeof body === "string" ? body : Buffer.from(body).toString("latin1");
  };
  const header = (i: number, name: string) => new Headers(sent[i].init.headers).get(name);
  await withIntegrationFixtureTransport(transport, async () => {
    answers.push(new Response(Buffer.from("ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000audio"), { headers: { "content-type": "audio/mpeg", "x-request-id": "req-1" } }));
    const audio = await generateTrainerVoice("voice-1", "Eight reps.", async () => {}, { provider: "cartesia", model: "sonic-3.6", language: "en" });
    assert.equal(audio.provider, "cartesia");
    assert.equal(audio.requestId, "req-1");
    assert.equal(sent[0].url, "https://cartesia.test/tts/bytes");
    assert.equal(sent[0].init.method, "POST");
    assert.equal(header(0, "authorization"), `Bearer ${KEY}`);
    assert.equal(header(0, "cartesia-version"), "2026-08-14");
    assert.deepEqual(JSON.parse(text(0)), {
      model_id: "sonic-3.6",
      transcript: "Eight reps.",
      voice: { mode: "id", id: "voice-1" },
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      language: "en",
    });
    // Never a voice of another provider.
    await assert.rejects(generateTrainerVoice("xi-voice", "Hello", async () => {}, { provider: "elevenlabs" }), /another voice provider/);
    assert.equal(sent.length, 1);
    const client = cartesiaVoiceClient();
    answers.push(Response.json({ id: "cloned-voice", name: "trainsyou-x", language: "en" }));
    await client.cloneVoice({ clip: wavOf(11), type: "audio/wav", name: "trainsyou-00000000-0000-0000-0000-000000000000", language: "ar", description: "Trainer voice" });
    assert.equal(sent[1].url, "https://cartesia.test/voices/clone");
    assert.match(String(header(1, "content-type")), /^multipart\/form-data; boundary=trainsyou[a-f0-9]+$/);
    assert.match(text(1), /name="clip"; filename="sample\.wav"\r\nContent-Type: audio\/wav/);
    assert.match(text(1), /name="language"\r\n\r\nar\r\n/);
    assert.match(text(1), /name="name"\r\n\r\ntrainsyou-0{8}-/);
    assert.doesNotMatch(text(1), /name="(mode|enhance)"/, "deprecated fields are not sent");
    answers.push(Response.json({ id: "ds_1", name: "n", created_at: "2026-09-28" }));
    await client.createDataset({ name: "trainsyou-x", description: "d" });
    assert.equal(sent[2].url, "https://cartesia.test/datasets/");
    assert.deepEqual(JSON.parse(text(2)), { name: "trainsyou-x", description: "d" });
    answers.push(new Response(null, { status: 204 }));
    await client.uploadDatasetFile("ds_1", { data: oggOf(2000), type: "audio/ogg", filename: "s1.ogg" });
    assert.equal(sent[3].url, "https://cartesia.test/datasets/ds_1/files");
    assert.match(text(3), /name="purpose"\r\n\r\nfine_tune\r\n/);
    assert.match(text(3), /name="file"; filename="s1\.ogg"\r\nContent-Type: audio\/ogg/);
    answers.push(Response.json({ id: "ft_1", name: "n", language: "en", dataset: "ds_1", status: "created", supported_model_ids: ["sonic-3.6-2026-08-27"] }));
    const ft = await client.createFineTune({ name: "trainsyou-x", description: "d", language: "en", dataset: "ds_1" });
    assert.deepEqual([ft.status, ft.supportedModelIds], ["created", ["sonic-3.6-2026-08-27"]]);
    assert.deepEqual(JSON.parse(text(4)), { name: "trainsyou-x", description: "d", language: "en", dataset: "ds_1" });
    answers.push(Response.json({ type: "transcript", text: "eight reps", language: "en", duration: 1.4, words: [] }));
    const heard = await transcribeSpeech(wavOf(1), "audio/wav", async () => {});
    assert.deepEqual([heard.text, heard.durationSeconds, heard.provider], ["eight reps", 1.4, "cartesia"]);
    assert.equal(sent[5].url, "https://cartesia.test/stt");
    assert.match(text(5), /name="model"\r\n\r\nink-whisper\r\n/);
    assert.match(text(5), /name="timestamp_granularities\[\]"\r\n\r\nword\r\n/);
    assert.match(text(5), /name="file"; filename="reply\.wav"/);
    // Outcomes: refused, retry later, or reconcile before sending again.
    for (const [status, outcome] of [[400, "rejected"], [429, "retry"], [503, "ambiguous"]] as const) {
      answers.push(Response.json({ error_code: "quota_exceeded", title: "t", message: `problem with key ${KEY}` }, { status }));
      const error = await client.createDataset({ name: "n", description: "d" }).catch((e) => e);
      assert.ok(error instanceof CartesiaError);
      assert.equal(error.outcome, outcome);
      assert.doesNotMatch(error.message, /sk_car_fixture/, "a provider message never carries the key");
    }
  });
});

test("recording rules and the clone state machine", () => {
  assert.equal(canTransition("draft", "processing"), true);
  assert.equal(canTransition("ready", "active"), true);
  assert.equal(canTransition("active", "ready"), true);
  assert.equal(canTransition("draft", "active"), false);
  assert.equal(canTransition("deleted", "ready"), false);
  assert.equal(canTransition("failed", "processing"), true);
  assert.equal(checkSample("instant", wavOf(12), "audio/wav", 1), 12, "a WAV header is read exactly");
  assert.throws(() => checkSample("instant", wavOf(5), "audio/wav", 5), /10 to 60 seconds/);
  assert.throws(() => checkSample("instant", wavOf(61), "audio/wav", 61), /10 to 60 seconds/);
  assert.throws(() => checkSample("instant", wavOf(12), "audio/mpeg", 12), /do not match/);
  assert.throws(() => checkSample("pro", oggOf(20000), "audio/ogg", 600), /does not match the file/, "600 s cannot fit 20 KB");
  assert.equal(checkSample("pro", oggOf(), "audio/ogg", 200), 200);
  assert.equal(recordingsReady("pro", [{ seconds: 1700, bytes: 1 }]).ready, false);
  assert.equal(recordingsReady("pro", [{ seconds: 1800, bytes: 1 }]).ready, true);
});

test("the trainer consents, records, makes a Quick clone, previews it and activates it", async () => {
  const overview = await ok("/voice/clones", "GET", undefined, coach);
  assert.equal(overview.provider, "cartesia");
  assert.deepEqual(overview.available, { quick: true, pro: false, proSlotsLeft: 0 });
  assert.equal(overview.previewLine, PREVIEW_LINE);
  assert.deepEqual(Object.keys(overview.consent.statements), ["ownVoice", "cloning", "subscriberUse", "deletion"]);
  // Consent is explicit and every statement is required; members never reach clones.
  await refused("/voice/clones", "POST", { kind: "instant", language: "en" }, coach, 400);
  await refused("/voice/clones", "POST", { kind: "instant", language: "en", consent: { ...CONSENT, deletion: false } }, coach, 400);
  await refused("/voice/clones", "POST", { kind: "instant", language: "en", consent: CONSENT }, alex, 403, "OWNER_REQUIRED");
  await refused("/voice/clones", "POST", { kind: "pro", language: "en", consent: CONSENT, proAcknowledged: true }, coach, 409, "VOICE_CLONE_KIND_OFF");
  // Linking a pasted provider ID is refused with Cartesia (it could name another workspace's clone).
  await refused("/voice/profile", "POST", { revision: 0, consent: true, rights: true, providerVoiceId: "someone-else", statement: "This is my own voice for workouts." }, coach, 409, "VOICE_CLONE_REQUIRED");
  const draft = await ok("/voice/clones", "POST", { kind: "instant", language: "en", consent: CONSENT }, coach);
  assert.equal(draft.status, "draft");
  assert.deepEqual(draft.readiness, { ready: false, message: "Add one recording of 10 to 60 seconds." });
  const [consentRow] = await rows(coach, "SELECT granted,document_version FROM consent_records WHERE user_id=$1 AND document_type='voice' ORDER BY created_at DESC LIMIT 1", [coach.userId]);
  assert.equal(consentRow.granted, true);
  assert.match(consentRow.document_version, /\|trainer-voice-clone:v1$/);
  await refused("/voice/clones", "POST", { kind: "instant", language: "en", consent: CONSENT }, coach, 409, "VOICE_CLONE_IN_PROGRESS");
  await refused(`/voice/clones/${draft.id}/submit`, "POST", { revision: draft.version }, coach, 409, "VOICE_RECORDINGS");
  await refused(`/voice/clones/${draft.id}/samples`, "POST", { audio: wavOf(5).toString("base64"), type: "audio/wav", durationSeconds: 5 }, coach, 400, "VOICE_SAMPLE");
  await refused(`/voice/clones/${draft.id}/samples`, "POST", { audio: wavOf(12).toString("base64"), type: "audio/mpeg", durationSeconds: 12 }, coach, 400, "VOICE_SAMPLE");
  const recording = wavOf(12);
  const withSample = await ok(`/voice/clones/${draft.id}/samples`, "POST", { audio: recording.toString("base64"), type: "audio/wav", durationSeconds: 30 }, coach);
  assert.deepEqual(withSample.recordings.map((r: any) => [r.seconds, r.status]), [[12, "stored"]], "the WAV header's length counts, not the declared one");
  assert.equal(withSample.readiness.ready, true);
  // Stored sealed: not the audio, and bound to this workspace and sample.
  const [stored] = await rows(coach, "SELECT id,sealed FROM trainer_voice_samples WHERE clone_id=$1", [draft.id]);
  const sealed = Buffer.from(stored.sealed);
  assert.equal(sealed.includes(recording.subarray(44, 108)), false);
  assert.ok(openSealedBytes(sealContexts.voiceSample(coach.tenantId, stored.id), sealed).equals(recording));
  assert.throws(() => openSealedBytes(sealContexts.voiceSample(other.tenantId, stored.id), sealed));
  await refused(`/voice/clones/${draft.id}/activate`, "POST", { revision: withSample.version }, coach, 409, "VOICE_CLONE_STATE");
  await refused(`/voice/clones/${draft.id}/submit`, "POST", { revision: draft.version }, coach, 409, "VOICE_CLONE_CHANGED");
  quick = await ok(`/voice/clones/${draft.id}/submit`, "POST", { revision: withSample.version }, coach);
  assert.equal(quick.status, "ready", JSON.stringify(quick));
  assert.equal(mock.clones.length, 1);
  assert.equal(mock.clones[0].name, "trainsyou-" + draft.id);
  assert.equal(mock.clones[0].type, "audio/wav");
  assert.deepEqual(quick.recordings.map((r: any) => r.status), ["sent"]);
  const [after] = await rows(coach, "SELECT sealed,status FROM trainer_voice_samples WHERE clone_id=$1", [draft.id]);
  assert.equal(after.sealed, null, "the recording is deleted once the provider has the voice");
  assert.equal(JSON.stringify(quick).includes(mock.clones[0].id), false, "the provider voice ID is not shown");
  await refused(`/voice/clones/${quick.id}/activate`, "POST", { revision: quick.version }, coach, 409, "VOICE_PREVIEW_REQUIRED");
  const previewed = await ok(`/voice/clones/${quick.id}/preview`, "POST", {}, coach);
  assert.equal(previewed.previewUrl, `/api/v1/voice/clones/${quick.id}/preview`);
  const listen = await request(`/voice/clones/${quick.id}/preview`, "GET", undefined, coach);
  assert.equal(listen.statusCode, 200);
  assert.match(String(listen.headers["content-type"]), /audio\/mpeg/);
  assert.equal(listen.rawPayload.toString("ascii", 0, 3), "ID3");
  assert.equal((await request(`/voice/clones/${quick.id}/preview`, "GET", undefined, alex)).statusCode, 403);
  const synth = mock.syntheses.at(-1)!;
  assert.deepEqual([synth.voiceId, synth.text, synth.model, synth.version], [mock.clones[0].id, PREVIEW_LINE, "sonic-3.6", "2026-08-14"]);
  // Previewing again replays the stored preview without another charge.
  await ok(`/voice/clones/${quick.id}/preview`, "POST", {}, coach);
  assert.equal(mock.syntheses.length, 1);
  const [cost] = await rows(coach, "SELECT provider,model,status,user_id FROM cost_events WHERE task='voice.preview'");
  // A preview that answered is priced at its reserved estimate when made
  // ('estimated'); the provider invoice can still correct it.
  assert.deepEqual([cost.provider, cost.model, cost.status, cost.user_id], ["cartesia", "sonic-3.6", "estimated", coach.userId]);
  const current = await ok("/voice/clones", "GET", undefined, coach);
  const activated = await ok(`/voice/clones/${quick.id}/activate`, "POST", { revision: current.clones[0].version }, coach);
  assert.equal(activated.status, "active");
  assert.match(activated.message, /now hear this voice/);
  const [voice] = await rows(coach, "SELECT status,provider,provider_voice_id,clone_id,model,language FROM trainer_voices");
  // A Quick clone keeps no model of its own: it follows VOICE_MODEL.
  assert.deepEqual(voice, { status: "verified", provider: "cartesia", provider_voice_id: mock.clones[0].id, clone_id: quick.id, model: null, language: "en" });
  quick = activated;
});

test("voice sessions speak with the trainer's active clone; spoken replies go to Cartesia speech-to-text", async () => {
  await subscribeVoice(coach, alex);
  const program = await ok("/programs", "POST", {
    subscriberId: alex.userId,
    program: { title: "Clone strength", goal: "Strength", daysPerWeek: 3, exercises: [{ name: "Goblet squat", sets: 2, reps: 8, restSeconds: 30, loadKg: 16 }] },
  }, coach);
  const workout = (alexWorkout = (await ok("/workouts/start", "POST", { programId: program.id }, alex)).id);
  const session = await ok("/voice-sessions", "POST", { workoutId: workout, playbackConsent: true }, alex);
  assert.equal(session.mode, "voice", JSON.stringify(session.unavailableReason));
  alexSession = session.id;
  const before = mock.syntheses.length;
  const made = await processVoiceSessionAudio(db, coach.tenantId, { limit: 500 });
  assert.ok(made.generated > 0 && !made.capped, JSON.stringify(made));
  const spoken = mock.syntheses.slice(before);
  assert.ok(spoken.length === made.generated && spoken.every((s) => s.voiceId === mock.clones[0].id && s.model === "sonic-3.6"));
  const usage = await rows(coach, "SELECT DISTINCT provider,model FROM cost_events WHERE task='voice.session'");
  assert.deepEqual(usage, [{ provider: "cartesia", model: "sonic-3.6" }]);
  await ok("/voice-sessions/consent", "POST", { transcription: true }, alex);
  await ok(`/voice-sessions/${session.id}/events`, "POST", { status: "running", outcomes: [] }, alex);
  const heard = await ok(`/voice-sessions/${session.id}/transcribe`, "POST", { audio: wavOf(1, "eight reps").toString("base64"), type: "audio/wav", durationMs: 1500 }, alex);
  assert.equal(heard.transcript, "eight reps");
  assert.deepEqual(heard.command, { type: "reps", reps: 8 });
  assert.deepEqual(mock.transcriptions.at(-1)!.model, "ink-whisper");
  assert.equal(mock.transcriptions.at(-1)!.language, "en", "an English-speaking member's replies are read as English");
  const gate = (await ok(`/voice-sessions/workout/${workout}`, "GET", undefined, alex)).gate;
  assert.deepEqual(gate.speechProvider, { name: "Cartesia", zeroRetention: false }, "the member is told who transcribes and on whose terms");
  const [stt] = await rows(coach, "SELECT provider,model FROM cost_events WHERE task='voice.transcription' LIMIT 1");
  assert.deepEqual(stt, { provider: "cartesia", model: "ink-whisper" });
});

test("another workspace can neither see nor use the clone", async () => {
  assert.deepEqual((await ok("/voice/clones", "GET", undefined, other)).clones, []);
  for (const [url, method, body] of [
    [`/voice/clones/${quick.id}/preview`, "POST", {}],
    [`/voice/clones/${quick.id}/preview`, "GET", undefined],
    [`/voice/clones/${quick.id}/activate`, "POST", { revision: quick.version }],
    [`/voice/clones/${quick.id}/deactivate`, "POST", { revision: quick.version }],
    [`/voice/clones/${quick.id}`, "DELETE", undefined],
  ] as const)
    assert.equal((await request(url, method, body, other)).statusCode, 404, `${method} ${url}`);
  const otherScope = { tenantId: other.tenantId, userId: other.userId, role: "owner" };
  const seen = await db.tenant(otherScope, (tx) =>
    tx.query("SELECT (SELECT count(*)::int FROM trainer_voice_clones) AS clones,(SELECT count(*)::int FROM trainer_voice_samples) AS samples,(SELECT count(*)::int FROM trainer_voices) AS voices"),
  );
  assert.deepEqual(seen, [{ clones: 0, samples: 0, voices: 0 }]);
  // Bo, a member of the other workspace, gets no voice from guided_voice().
  const boVoice = await db.tenant({ tenantId: other.tenantId, userId: bo.userId, role: "subscriber" }, (tx) => tx.query("SELECT * FROM guided_voice()"));
  assert.deepEqual(boVoice, []);
  // Inside the workspace, members and team see no clone or recording rows.
  const alexView = await db.tenant({ tenantId: coach.tenantId, userId: alex.userId, role: "subscriber" }, (tx) =>
    tx.query("SELECT (SELECT count(*)::int FROM trainer_voice_clones) AS clones,(SELECT count(*)::int FROM voice_provider_deletions) AS deletions"),
  );
  assert.deepEqual(alexView, [{ clones: 0, deletions: 0 }]);
  const staffView = await db.tenant(seedScope(coach, "staff"), (tx) => tx.query("SELECT count(*)::int AS n FROM trainer_voice_clones"));
  assert.equal(staffView[0].n, 0);
  // A provider voice belongs to one clone: another workspace cannot attach it.
  const [mine] = await rows(coach, "SELECT provider_voice_id FROM trainer_voice_clones WHERE id=$1", [quick.id]);
  await assert.rejects(
    rows(other, "INSERT INTO trainer_voice_clones(id,tenant_id,user_id,provider,kind,status,language,provider_name,provider_voice_id,consent_version) VALUES($1,$2,$3,'cartesia','instant','ready',$4,$5,$6,'fixture')", [
      randomUUID(), other.tenantId, other.userId, "en", "trainsyou-" + randomUUID(), mine.provider_voice_id,
    ]),
    /trainer_voice_clone_provider_voice|duplicate key/,
  );
});

test("previews and clones share the workspace voice budget and stay out of model-call counts", async () => {
  quick2 = await quickClone(coach);
  assert.equal(quick2.status, "ready");
  process.env.VOICE_DAILY_USD_LIMIT = "0.0001";
  try {
    await refused(`/voice/clones/${quick2.id}/preview`, "POST", {}, coach, 429, "VOICE_BUDGET");
    // A clone whose estimated cost would pass today's limit is not sent.
    process.env.VOICE_DAILY_USD_LIMIT = "5";
    process.env.VOICE_CLONE_USD = "10";
    const draft = await ok("/voice/clones", "POST", { kind: "instant", language: "en", consent: CONSENT }, coach);
    const withSample = await ok(`/voice/clones/${draft.id}/samples`, "POST", { audio: wavOf(15).toString("base64"), type: "audio/wav", durationSeconds: 15 }, coach);
    const sent = mock.clones.length;
    await refused(`/voice/clones/${draft.id}/submit`, "POST", { revision: withSample.version }, coach, 429, "VOICE_BUDGET");
    assert.equal(mock.clones.length, sent);
    await ok(`/voice/clones/${draft.id}`, "DELETE", undefined, coach);
    assert.equal((await rows(coach, "SELECT count(*)::int AS n FROM voice_provider_deletions"))[0].n, 0, "a draft never sent leaves nothing at the provider");
  } finally {
    process.env.VOICE_DAILY_USD_LIMIT = "5";
    process.env.VOICE_CLONE_USD = "0";
  }
  const [counts] = await rows(coach, "SELECT (SELECT n FROM model_usage_today(ARRAY[]::text[],NULL)) AS model_calls,(SELECT count(*)::int FROM cost_events WHERE task NOT LIKE 'voice.%') AS model_rows,voice_guidance_spent_today() AS voice_spent,(SELECT sum(round((pricing->>'reservedCostUsd')::numeric,8)) FROM cost_events WHERE task LIKE 'voice.%') AS voice_rows");
  assert.equal(counts.model_calls, counts.model_rows);
  assert.equal(Number(counts.voice_spent), Number(counts.voice_rows));
  const clones = await rows(coach, "SELECT task,provider,status FROM cost_events WHERE task='voice.clone' ORDER BY created_at");
  assert.equal(clones.length, 2, "one reserved cost per clone sent");
  // Clones made are priced at their estimate (VOICE_CLONE_USD) when made.
  assert.ok(clones.every((c) => c.provider === "cartesia" && c.status === "estimated"));
});

test("activating a newer Quick clone replaces the older one, which is deleted at the provider", async () => {
  await ok(`/voice/clones/${quick2.id}/preview`, "POST", {}, coach);
  const view = await ok("/voice/clones", "GET", undefined, coach);
  const target = view.clones.find((c: any) => c.id === quick2.id);
  const firstVoice = mock.clones[0].id;
  await ok(`/voice/clones/${quick2.id}/activate`, "POST", { revision: target.version }, coach);
  const after = await ok("/voice/clones", "GET", undefined, coach);
  assert.deepEqual(after.clones.map((c: any) => [c.id, c.status]), [[quick2.id, "active"]]);
  const [first] = await rows(coach, "SELECT status,provider_voice_id,preview_audio FROM trainer_voice_clones WHERE id=$1", [quick.id]);
  assert.deepEqual(first, { status: "deleted", provider_voice_id: null, preview_audio: null });
  const queued = await rows(coach, "SELECT kind,reason,status FROM voice_provider_deletions ORDER BY kind");
  // Made without a lost answer: the voice id alone is deleted, no name sweep.
  assert.deepEqual(queued.map((d) => [d.kind, d.reason]), [["voice", "superseded"]]);
  await processVoiceClones(db);
  assert.equal(mock.voices.has(firstVoice), false, "the older voice is deleted at the provider");
  assert.ok((await rows(coach, "SELECT status FROM voice_provider_deletions")).every((d) => d.status === "done"));
  const [voice] = await rows(coach, "SELECT provider_voice_id,clone_id FROM trainer_voices");
  assert.equal(voice.clone_id, quick2.id);
});

test("a Pro clone uploads its recordings, trains under the worker's polling and then switches with the Quick clone", async () => {
  process.env.VOICE_PRO_CLONE_ENABLED = "true";
  process.env.VOICE_PRO_CLONE_PRICE_AED = "199";
  const overview = await ok("/voice/clones", "GET", undefined, coach);
  assert.deepEqual(overview.available, { quick: true, pro: true, proSlotsLeft: 2 });
  assert.equal(overview.proPriceAed, 199);
  await refused("/voice/clones", "POST", { kind: "pro", language: "en", consent: CONSENT }, coach, 400, "VOICE_PRO_ACKNOWLEDGEMENT");
  let draft = await ok("/voice/clones", "POST", { kind: "pro", language: "en", consent: CONSENT, proAcknowledged: true }, coach);
  const [evidence] = await rows(coach, "SELECT evidence FROM trainer_voice_clones WHERE id=$1", [draft.id]);
  assert.equal(evidence.evidence.proPriceAedShown, 199);
  for (let i = 0; i < 8; i++)
    draft = await ok(`/voice/clones/${draft.id}/samples`, "POST", { audio: oggOf().toString("base64"), type: "audio/ogg", durationSeconds: 200 }, coach);
  assert.equal(draft.readiness.ready, false);
  assert.match(draft.readiness.message, /at least 30 minutes/);
  await refused(`/voice/clones/${draft.id}/submit`, "POST", { revision: draft.version }, coach, 409, "VOICE_RECORDINGS");
  draft = await ok(`/voice/clones/${draft.id}/samples`, "POST", { audio: oggOf().toString("base64"), type: "audio/ogg", durationSeconds: 200 }, coach);
  assert.deepEqual([draft.readiness.ready, draft.totalSeconds], [true, 1800]);
  // The dataset is created while the trainer waits; the rest is the worker's.
  mock.loseNextAnswer.add("dataset");
  pro = await ok(`/voice/clones/${draft.id}/submit`, "POST", { revision: draft.version }, coach);
  assert.equal(pro.status, "processing");
  const passes = await workerUntil(coach, async () => (await ok("/voice/clones", "GET", undefined, coach)).clones.find((c: any) => c.id === pro.id).status === "ready");
  assert.ok(passes >= 2, "training was polled across worker passes");
  assert.equal(mock.server.log.filter((r) => r.method === "POST" && /^\/datasets\/?$/.test(r.path)).length, 1, "the lost dataset answer was reconciled by name, not created twice");
  assert.equal(mock.uploads.length, 9);
  assert.ok(mock.uploads.every((u) => /^[0-9a-f-]{36}\.ogg$/.test(u.filename)));
  const [row] = await rows(coach, "SELECT status,model,provider_job FROM trainer_voice_clones WHERE id=$1", [pro.id]);
  assert.equal(row.model, "sonic-3.6-2026-08-27", "a Pro clone speaks with a dated model");
  assert.equal(mock.fineTunes.get(row.provider_job.fineTuneId)!.name, "trainsyou-" + pro.id + "-1", "each training attempt has its own name");
  // The raw recordings do not stay at the provider once the Pro voice exists.
  assert.equal(mock.datasets.has(row.provider_job.datasetId), false);
  assert.deepEqual(
    (await rows(coach, "SELECT kind,reason,status FROM voice_provider_deletions WHERE reference=$1", [row.provider_job.datasetId])),
    [{ kind: "dataset", reason: "trained", status: "done" }],
  );
  const leftovers = await rows(coach, "SELECT count(*)::int AS n FROM trainer_voice_samples WHERE clone_id=$1 AND sealed IS NOT NULL", [pro.id]);
  assert.equal(leftovers[0].n, 0, "no recording is kept once the provider has it");
  await ok(`/voice/clones/${pro.id}/preview`, "POST", {}, coach);
  const proVoice = [...mock.voices.values()].find((v) => v.isPro)!;
  assert.deepEqual([mock.syntheses.at(-1)!.voiceId, mock.syntheses.at(-1)!.model], [proVoice.id, "sonic-3.6-2026-08-27"]);
  let clones = (await ok("/voice/clones", "GET", undefined, coach)).clones;
  await ok(`/voice/clones/${pro.id}/activate`, "POST", { revision: clones.find((c: any) => c.id === pro.id).version }, coach);
  clones = (await ok("/voice/clones", "GET", undefined, coach)).clones;
  assert.deepEqual(Object.fromEntries(clones.map((c: any) => [c.kind, c.status])), { pro: "active", instant: "ready" }, "the Quick clone stays ready to switch back");
  const [voice] = await rows(coach, "SELECT provider_voice_id,model FROM trainer_voices");
  assert.deepEqual(voice, { provider_voice_id: proVoice.id, model: "sonic-3.6-2026-08-27" });
  await ok(`/voice/clones/${quick2.id}/activate`, "POST", { revision: clones.find((c: any) => c.id === quick2.id).version }, coach);
  clones = (await ok("/voice/clones", "GET", undefined, coach)).clones;
  assert.deepEqual(Object.fromEntries(clones.map((c: any) => [c.kind, c.status])), { pro: "ready", instant: "active" });
  pro = clones.find((c: any) => c.id === pro.id);
});

test("a Quick clone whose answer was lost is reconciled by name, never sent twice", async () => {
  mock.loseNextAnswer.add("clone");
  const sentBefore = mock.clones.length;
  const lost = await quickClone(other);
  assert.equal(lost.status, "processing", JSON.stringify(lost));
  assert.match(lost.progress, /Confirming/);
  await workerUntil(other, async () => (await ok("/voice/clones", "GET", undefined, other)).clones[0].status === "ready");
  assert.equal(mock.clones.length, sentBefore + 1, "the clone request was sent once");
  const [row] = await rows(other, "SELECT provider_voice_id FROM trainer_voice_clones WHERE id=$1", [lost.id]);
  assert.equal(row.provider_voice_id, mock.clones.at(-1)!.id);
});

test("operators list clones and provider deletions across workspaces with recent MFA, never recordings", async () => {
  const operatorId = randomUUID();
  await db.system((tx) =>
    tx.query("INSERT INTO users(id,email,name,password_hash,platform_role) VALUES($1,$2,'Voice operator','fixture','admin')", [operatorId, operatorId + "@example.test"]),
  );
  const admin = Fastify();
  let mfaAt: string | null = new Date().toISOString();
  admin.addHook("preHandler", async (req) => {
    req.identity = { tenantId: coach.tenantId, userId: operatorId, role: "owner", platformRole: "admin", mfaAt } as any;
  });
  admin.setErrorHandler((e: any, _req, reply) => reply.code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500)).send({ code: e.code, message: e.message }));
  registerVoiceClones(admin, db);
  try {
    const listed = await admin.inject({ method: "GET", url: "/api/v1/admin/integrations/voice-clones" });
    assert.equal(listed.statusCode, 200, listed.body);
    const body = listed.json();
    const names = new Set(body.clones.map((c: any) => c.tenant_id));
    assert.ok(names.has(coach.tenantId) && names.has(other.tenantId), "both workspaces are listed for the operator");
    assert.doesNotMatch(listed.body, /sealed|preview_audio"|provider_voice_id/, "no recording, audio or provider voice ID in the listing");
    const withPreview = body.clones.find((c: any) => c.tenant_id === coach.tenantId && c.has_preview);
    const heard = await admin.inject({ method: "GET", url: `/api/v1/admin/integrations/voice-clones/${withPreview.id}/preview?tenantId=${coach.tenantId}` });
    assert.equal(heard.statusCode, 200);
    assert.equal(heard.rawPayload.toString("ascii", 0, 3), "ID3");
    // The preview of one workspace's clone is not reachable through another workspace id.
    const crossed = await admin.inject({ method: "GET", url: `/api/v1/admin/integrations/voice-clones/${withPreview.id}/preview?tenantId=${other.tenantId}` });
    assert.equal(crossed.statusCode, 404);
    mfaAt = null;
    assert.equal((await admin.inject({ method: "GET", url: "/api/v1/admin/integrations/voice-clones" })).statusCode, 403);
  } finally {
    await admin.close();
  }
  assert.equal((await request("/admin/integrations/voice-clones", "GET", undefined, coach)).statusCode, 403);
});

test("deleting a clone removes its recordings here and everything at the provider; members fall back to text", async () => {
  const proVoice = [...mock.voices.values()].find((v) => v.isPro)!;
  const [job] = await rows(coach, "SELECT provider_job FROM trainer_voice_clones WHERE id=$1", [pro.id]);
  const deleted = await ok(`/voice/clones/${pro.id}`, "DELETE", undefined, coach);
  assert.equal(deleted.ok, true);
  assert.equal(mock.voices.has(proVoice.id), false);
  assert.equal(mock.fineTunes.has(job.provider_job.fineTuneId), false);
  assert.equal(mock.datasets.has(job.provider_job.datasetId), false);
  assert.equal((await rows(coach, "SELECT count(*)::int AS n FROM trainer_voice_samples WHERE clone_id=$1", [pro.id]))[0].n, 0);
  const left = await rows(coach, "SELECT kind,status,attempts,reference FROM voice_provider_deletions WHERE status<>'done'");
  // The dataset answer was lost once: its name is looked up again (lists lag)
  // before the deletion counts as confirmed; everything with an id is gone.
  assert.deepEqual(left.map((d) => [d.kind, d.status, d.attempts, d.reference]), [["named", "pending", 1, "trainsyou-" + pro.id]]);
  for (let i = 0; i < 2; i++) {
    await rows(coach, "UPDATE voice_provider_deletions SET next_attempt_at=now() WHERE status='pending'");
    await processVoiceProviderDeletions(db, elevated("worker", { tenantId: coach.tenantId, role: "owner" }));
  }
  assert.ok((await rows(coach, "SELECT status FROM voice_provider_deletions")).every((d) => d.status === "done"), "confirmed after three empty look-ups");
  // Deleting the active clone stops the workspace voice: sessions are text-guided.
  const active = (await ok("/voice/clones", "GET", undefined, coach)).clones[0];
  await ok(`/voice/clones/${active.id}`, "DELETE", undefined, coach);
  const [voice] = await rows(coach, "SELECT status,provider_voice_id,clone_id FROM trainer_voices");
  assert.deepEqual(voice, { status: "revoked", provider_voice_id: null, clone_id: null });
  const gate = (await ok(`/voice-sessions/workout/${alexWorkout}`, "GET", undefined, alex)).gate;
  assert.equal(gate.mode, "text");
  assert.ok(gate.reasons.some((r: any) => r.code === "VOICE_NOT_VERIFIED"));
  assert.deepEqual((await ok("/voice/clones", "GET", undefined, coach)).clones, []);
});

test("withdrawing voice consent deletes every clone at the provider", async () => {
  const made = await quickClone(coach);
  const voiceId = mock.clones.at(-1)!.id;
  assert.equal(made.status, "ready");
  await ok("/privacy/consent", "POST", { type: "voice", granted: false }, coach);
  assert.deepEqual((await ok("/voice/clones", "GET", undefined, coach)).clones, []);
  const queued = await rows(coach, "SELECT kind,reason FROM voice_provider_deletions WHERE status='pending'");
  assert.deepEqual(queued, [{ kind: "voice", reason: "consent_withdrawn" }]);
  await processVoiceProviderDeletions(db, elevated("worker", { tenantId: coach.tenantId, role: "owner" }));
  assert.equal(mock.voices.has(voiceId), false);
  // A new clone needs consent again (the POST records it).
  await refused(`/voice/clones/${made.id}/preview`, "POST", {}, coach, 404);
});

test("an ownership transfer and a workspace closure stop the voice and delete clones at the provider", async () => {
  // The other workspace's clone is active and its member hears it.
  const clone = (await ok("/voice/clones", "GET", undefined, other)).clones[0];
  await ok(`/voice/clones/${clone.id}/preview`, "POST", {}, other);
  const fresh = (await ok("/voice/clones", "GET", undefined, other)).clones[0];
  await ok(`/voice/clones/${clone.id}/activate`, "POST", { revision: fresh.version }, other);
  const boScope = { tenantId: other.tenantId, userId: bo.userId, role: "subscriber" };
  assert.equal((await db.tenant(boScope, (tx) => tx.query("SELECT provider FROM guided_voice()"))).length, 1);
  // guided_voice() needs the recording trainer to still own the workspace.
  await db.system((tx) => tx.query("UPDATE memberships SET role='staff' WHERE tenant_id=$1 AND user_id=$2", [other.tenantId, other.userId]));
  assert.equal((await db.tenant(boScope, (tx) => tx.query("SELECT provider FROM guided_voice()"))).length, 0);
  await db.system((tx) => tx.query("UPDATE memberships SET role='owner' WHERE tenant_id=$1 AND user_id=$2", [other.tenantId, other.userId]));
  // The transfer hook retires the previous owner's voice and clones.
  await db.tenant(seedScope(other), (tx) => privacyHooks.transferAdditional!(tx, other.userId));
  assert.equal((await db.tenant(boScope, (tx) => tx.query("SELECT provider FROM guided_voice()"))).length, 0);
  assert.deepEqual((await rows(other, "SELECT status FROM trainer_voice_clones")).map((c) => c.status), ["deleted"]);
  // Closure: a clone made again is queued for provider deletion; the queue survives.
  const again = await quickClone(other);
  const voiceId = mock.clones.at(-1)!.id;
  assert.equal(again.status, "ready");
  const operator = await privacyOperator(db, other.tenantId);
  assert.deepEqual(
    await db.tenant(operator, (tx) => privacyHooks.providerInventory!(tx)).then((names) => names.filter((n) => /Cartesia/.test(n))),
    ["Cartesia (voice clones)"],
  );
  await db.tenant(operator, (tx) => privacyHooks.closeAdditional!(tx), { privacyErasure: true });
  const [left] = await rows(other, "SELECT (SELECT count(*)::int FROM trainer_voice_clones) AS clones,(SELECT count(*)::int FROM trainer_voice_samples) AS samples,(SELECT count(*)::int FROM voice_provider_deletions WHERE status='pending') AS pending");
  assert.deepEqual([left.clones, left.samples], [0, 0]);
  assert.ok(left.pending >= 1);
  await processVoiceClones(db);
  assert.equal(mock.voices.has(voiceId), false, "deleted at the provider after closure");
  // The app role may never delete the deletion queue.
  await assert.rejects(rows(other, "DELETE FROM voice_provider_deletions"), /permission denied/);
});

// ---------------------------------------------------------------- review round 1

const worker = (trainer: any) => elevated("worker", { tenantId: trainer.tenantId, role: "owner" });
/** A draft of the given kind and language with its recordings added. */
async function draftWith(trainer: any, kind: "instant" | "pro", language = "en") {
  let draft = await ok("/voice/clones", "POST", { kind, language, consent: CONSENT, ...(kind === "pro" ? { proAcknowledged: true } : {}) }, trainer);
  if (kind === "instant")
    return ok(`/voice/clones/${draft.id}/samples`, "POST", { audio: wavOf(12).toString("base64"), type: "audio/wav", durationSeconds: 12 }, trainer);
  for (let i = 0; i < 9; i++)
    draft = await ok(`/voice/clones/${draft.id}/samples`, "POST", { audio: oggOf().toString("base64"), type: "audio/ogg", durationSeconds: 200 }, trainer);
  return draft;
}
const cloneRow = async (trainer: any, id: string) =>
  (await rows(trainer, "SELECT status,step,error,provider_job,model,provider_voice_id,next_attempt_at FROM trainer_voice_clones WHERE id=$1", [id]))[0];
const view = async (trainer: any, id: string) =>
  (await ok("/voice/clones", "GET", undefined, trainer)).clones.find((c: any) => c.id === id);
const due = (trainer: any) =>
  rows(trainer, "UPDATE trainer_voice_clones SET next_attempt_at=now() WHERE status='processing'");
/** An operator app (platform administrator, recent MFA) with the clone and settings routes. */
async function operatorApp() {
  const operatorId = randomUUID();
  await db.system((tx) =>
    tx.query("INSERT INTO users(id,email,name,password_hash,platform_role) VALUES($1,$2,'Voice operator','fixture','admin')", [operatorId, operatorId + "@example.test"]),
  );
  const admin = Fastify();
  admin.addHook("preHandler", async (req) => {
    req.identity = { tenantId: coach.tenantId, userId: operatorId, role: "owner", platformRole: "admin", mfaAt: new Date().toISOString() } as any;
  });
  admin.setErrorHandler((e: any, _req, reply) => reply.code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500)).send({ code: e.code, message: e.message }));
  registerVoiceClones(admin, db);
  platformSettingsRoutes(admin, db, (req) => req.identity as any);
  return admin;
}

test("name look-ups read every page of the provider's lists", async () => {
  const client = cartesiaVoiceClient();
  const target = "trainsyou-" + randomUUID();
  const fillers = Array.from({ length: 5 }, (_, i) => "ds_filler" + i);
  mock.listPageSize = 2;
  try {
    for (const id of fillers) mock.datasets.set(id, { id, name: "someone-else", files: [] });
    mock.datasets.set("ds_target", { id: "ds_target", name: target, files: [] });
    for (const [id, name] of [["ft_other", "someone-else"], ["ft_a", target + "-1"], ["ft_b", "x"], ["ft_c", target + "-2"]])
      mock.fineTunes.set(id, { id, name, language: "en", dataset: "ds_target", polls: 0, status: "failed" });
    const before = mock.server.log.length;
    assert.deepEqual(await client.datasetsNamed(target), [{ id: "ds_target" }]);
    const pages = mock.server.log.slice(before).filter((r) => r.path.startsWith("/datasets"));
    assert.ok(pages.length >= 3 && pages.slice(1).every((r) => /starting_after=/.test(r.query)), "later pages follow next_page");
    assert.deepEqual((await client.fineTunesNamed(target)).map((f) => f.id), [], "exact name only");
    assert.deepEqual((await client.fineTunesNamed(target, true)).map((f) => [f.id, f.dataset]), [["ft_a", "ds_target"], ["ft_c", "ds_target"]]);
    assert.deepEqual((await client.fineTunesNamed(target + "-2")).map((f) => f.id), ["ft_c"]);
  } finally {
    mock.listPageSize = 100;
    for (const id of [...fillers, "ds_target"]) mock.datasets.delete(id);
    for (const id of ["ft_other", "ft_a", "ft_b", "ft_c"]) mock.fineTunes.delete(id);
  }
});

test("speech is sent in the text's language, not the recording's; a Quick clone follows the configured model", async () => {
  const draft = await draftWith(third, "instant", "ar");
  const made = await ok(`/voice/clones/${draft.id}/submit`, "POST", { revision: draft.version }, third);
  assert.equal(made.status, "ready");
  assert.equal(mock.clones.at(-1)!.language, "ar", "the clone is made in the language recorded");
  process.env.VOICE_MODEL = "sonic-3.7";
  try {
    await ok(`/voice/clones/${made.id}/preview`, "POST", {}, third);
  } finally {
    process.env.VOICE_MODEL = "sonic-3.6";
  }
  const synth = mock.syntheses.at(-1)!;
  assert.deepEqual([synth.text, synth.language, synth.model], [PREVIEW_LINE, "en", "sonic-3.7"]);
  assert.equal((await cloneRow(third, made.id)).model, null);
  await ok(`/voice/clones/${made.id}`, "DELETE", undefined, third);
});

test("a refused or unsent clone request releases its cost; automatic retries back off and stop", async () => {
  process.env.VOICE_CLONE_USD = "1";
  const spent = async () => Number((await rows(third, "SELECT voice_guidance_spent_today() AS s"))[0].s);
  try {
    const before = await spent();
    const draft = await draftWith(third, "instant");
    mock.failNext.clone = 429;
    const sent = await ok(`/voice/clones/${draft.id}/submit`, "POST", { revision: draft.version }, third);
    assert.equal(sent.status, "processing");
    for (let i = 0; i < 5; i++) {
      mock.failNext.clone = 429;
      await due(third);
      await processVoiceClones(db);
    }
    const row = await cloneRow(third, draft.id);
    assert.equal(row.status, "processing");
    assert.notEqual(row.error?.code, "VOICE_BUDGET", "provider refusals never fill the daily voice limit");
    assert.equal(row.provider_job.retries, 6);
    assert.ok(new Date(row.next_attempt_at).getTime() - Date.now() > 50 * 60 * 1000, "the wait grows to an hour");
    const costs = await rows(third, "SELECT status,cost_usd,pricing FROM cost_events WHERE task='voice.clone' AND trace_id=$1", [draft.id]);
    assert.equal(costs.length, 6);
    assert.ok(costs.every((c) => c.status === "recorded" && Number(c.cost_usd) === 0 && c.pricing.released === "provider_refused" && c.pricing.httpStatus === 429));
    assert.equal(await spent(), before);
    // The eleventh refusal in a row fails the clone; the recording stays for a new try.
    await rows(third, "UPDATE trainer_voice_clones SET provider_job=provider_job||'{\"retries\":10}'::jsonb,next_attempt_at=now() WHERE id=$1", [draft.id]);
    mock.failNext.clone = 429;
    await processVoiceClones(db);
    const failed = await view(third, draft.id);
    assert.deepEqual([failed.status, failed.error.code, failed.retryable], ["failed", "PROVIDER_UNAVAILABLE", true]);
    const again = await ok(`/voice/clones/${draft.id}/retry`, "POST", { revision: failed.version }, third);
    assert.equal(again.status, "ready");
    const last = await rows(third, "SELECT status FROM cost_events WHERE task='voice.clone' AND trace_id=$1 AND status<>'recorded'", [draft.id]);
    assert.deepEqual(last, [{ status: "estimated" }], "a clone made is priced at its estimate until the invoice reconciles it");
    await ok(`/voice/clones/${draft.id}`, "DELETE", undefined, third);
  } finally {
    process.env.VOICE_CLONE_USD = "0";
    delete mock.failNext.clone;
  }
});

test("a Cartesia plan without cloning (HTTP 402, as the free tier answered live) keeps the recording, alerts operators and hides the provider's upgrade text", async () => {
  const draft = await draftWith(third, "instant");
  mock.failNext.clone = 402;
  let failed: any;
  try {
    failed = await ok(`/voice/clones/${draft.id}/submit`, "POST", { revision: draft.version }, third);
  } finally {
    delete mock.failNext.clone;
  }
  assert.deepEqual([failed.status, failed.error.code, failed.retryable], ["failed", "PROVIDER_PLAN", true]);
  assert.doesNotMatch(failed.error.message, /upgrade|subscription|play\.cartesia|HTTP 402/i, "the trainer is not told to upgrade the provider plan");
  assert.equal(failed.recordings[0].status, "stored", "the recording is kept for another try");
  const [alert] = await db.system((tx) => tx.query("SELECT status,severity,scope,tenant_id,data FROM platform_alerts WHERE dedupe_key='voice.provider_plan'"));
  assert.deepEqual([alert.status, alert.severity, alert.scope, alert.tenant_id], ["open", "warning", ["admin"], null]);
  assert.deepEqual(alert.data, { kind: "instant", status: 402, code: "plan_upgrade_required" });
  const costs = await rows(third, "SELECT status,cost_usd FROM cost_events WHERE task='voice.clone' AND trace_id=$1", [draft.id]);
  assert.ok(costs.every((c) => c.status === "recorded" && Number(c.cost_usd) === 0), "a plan refusal costs nothing");
  // Once the plan allows cloning, the same recording makes the clone and the alert clears.
  const again = await ok(`/voice/clones/${draft.id}/retry`, "POST", { revision: failed.version }, third);
  assert.equal(again.status, "ready");
  const [cleared] = await db.system((tx) => tx.query("SELECT status,resolution FROM platform_alerts WHERE dedupe_key='voice.provider_plan'"));
  assert.deepEqual(cleared, { status: "resolved", resolution: "condition_cleared" });
  await ok(`/voice/clones/${draft.id}`, "DELETE", undefined, third);
});

test("after a lost answer the deletion keeps looking up the name while the provider's list lags", async () => {
  mock.loseNextAnswer.add("clone");
  const lost = await quickClone(third);
  assert.equal(lost.status, "processing");
  const created = mock.clones.at(-1)!;
  mock.hiddenFromLists.add(created.id);
  try {
    const deleted = await ok(`/voice/clones/${lost.id}`, "DELETE", undefined, third);
    assert.match(deleted.message, /being deleted/);
    const [named] = await rows(third, "SELECT status,attempts FROM voice_provider_deletions WHERE kind='named' AND reference=$1", ["trainsyou-" + lost.id]);
    assert.deepEqual(named, { status: "pending", attempts: 1 }, "an empty first look-up is not the end");
  } finally {
    mock.hiddenFromLists.delete(created.id);
  }
  for (let i = 0; i < 3; i++) {
    await rows(third, "UPDATE voice_provider_deletions SET next_attempt_at=now() WHERE status='pending'");
    await processVoiceProviderDeletions(db, worker(third));
  }
  assert.equal(mock.voices.has(created.id), false, "the voice made by the lost request is deleted once the list shows it");
  const [named] = await rows(third, "SELECT status FROM voice_provider_deletions WHERE kind='named' AND reference=$1", ["trainsyou-" + lost.id]);
  assert.equal(named.status, "done");
});

test("trying a Quick clone again after an unconfirmed answer looks the name up before sending", async () => {
  const draft = await draftWith(third, "instant");
  await rows(third, "UPDATE trainer_voice_clones SET status='failed',step=NULL,submitted_at=now(),provider_job='{\"sent\":true,\"ambiguous\":true,\"resends\":2}',error='{\"code\":\"PROVIDER_UNCONFIRMED\",\"message\":\"The voice provider did not confirm the clone. Try again.\"}',version=version+1 WHERE id=$1", [draft.id]);
  // An earlier request made the voice after all.
  const earlier = randomUUID();
  mock.voices.set(earlier, { id: earlier, name: "trainsyou-" + draft.id, language: "en", isPro: false });
  const sent = mock.clones.length;
  const failed = await view(third, draft.id);
  assert.equal(failed.retryable, true);
  const again = await ok(`/voice/clones/${draft.id}/retry`, "POST", { revision: failed.version }, third);
  assert.equal(again.status, "ready");
  assert.equal(mock.clones.length, sent, "no second clone request");
  assert.equal((await cloneRow(third, draft.id)).provider_voice_id, earlier);
  await ok(`/voice/clones/${draft.id}`, "DELETE", undefined, third);
  assert.equal(mock.voices.has(earlier), false);
});

test("Pro training: a retry after a day, a lost training answer, Cartesia-named Pro voices and failures that need a new clone", async () => {
  process.env.VOICE_PRO_CLONE_ENABLED = "true";
  process.env.VOICE_PRO_CLONE_SLOTS = "10";
  mock.trainingPolls = 1000;
  try {
    const draft = await draftWith(third, "pro");
    const sent = await ok(`/voice/clones/${draft.id}/submit`, "POST", { revision: draft.version }, third);
    assert.equal(sent.status, "processing");
    await workerUntil(third, async () => (await cloneRow(third, draft.id)).step === "training");
    let row = await cloneRow(third, draft.id);
    const first = row.provider_job.fineTuneId;
    assert.equal(mock.fineTunes.get(first)!.name, `trainsyou-${draft.id}-1`);
    // A day passes without an answer: the clone fails and the training is deleted.
    const dayAgo = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    await rows(third, "UPDATE trainer_voice_clones SET submitted_at=$2::text::timestamptz,provider_job=provider_job||jsonb_build_object('trainingStartedAt',$2::text),next_attempt_at=now() WHERE id=$1", [draft.id, dayAgo]);
    await processVoiceClones(db);
    let seen = await view(third, draft.id);
    assert.deepEqual([seen.status, seen.error.code, seen.retryable], ["failed", "TRAINING_TIMEOUT", true]);
    assert.equal(mock.fineTunes.has(first), false, "the abandoned training does not keep a Pro slot");
    // Tried again the next day, and the training answer is lost on the way back.
    mock.loseNextAnswer.add("fineTune");
    seen = await ok(`/voice/clones/${draft.id}/retry`, "POST", { revision: seen.version }, third);
    assert.equal(seen.status, "processing");
    await due(third);
    await processVoiceClones(db);
    row = await cloneRow(third, draft.id);
    const mine = [...mock.fineTunes.values()].filter((f) => f.name.startsWith("trainsyou-" + draft.id));
    assert.deepEqual(mine.map((f) => f.name), [`trainsyou-${draft.id}-2`], "one training at the provider, found by its own attempt name");
    assert.deepEqual([row.status, row.step, row.provider_job.fineTuneId], ["processing", "training", mine[0].id]);
    await due(third);
    await processVoiceClones(db);
    assert.equal((await cloneRow(third, draft.id)).step, "training", "the retry's deadline counts from its own start");
    // Training completes but the provider lists no voice for six hours.
    mock.trainingPolls = 0;
    mock.withholdProVoices = true;
    await due(third);
    await advanceVoiceClone(db, worker(third), draft.id);
    row = await cloneRow(third, draft.id);
    assert.equal(row.step, "voices");
    const proVoice = [...mock.voices.values()].find((v) => v.fineTuneId === row.provider_job.fineTuneId)!;
    assert.ok(proVoice && !proVoice.name.includes(draft.id), "Cartesia names the Pro voice itself");
    await rows(third, "UPDATE trainer_voice_clones SET provider_job=provider_job||jsonb_build_object('trainingCompletedAt',$2::text),next_attempt_at=now() WHERE id=$1", [draft.id, new Date(Date.now() - 7 * 3600 * 1000).toISOString()]);
    await advanceVoiceClone(db, worker(third), draft.id);
    seen = await view(third, draft.id);
    assert.deepEqual([seen.status, seen.error.code], ["failed", "PROVIDER_VOICE_MISSING"]);
    // Deleting the training deletes its voices first, whatever their names.
    mock.withholdProVoices = false;
    await processVoiceProviderDeletions(db, worker(third));
    assert.equal(mock.voices.has(proVoice.id), false);
    assert.equal(mock.fineTunes.has(row.provider_job.fineTuneId), false);
    // Training that fails on the recordings needs a new clone; the dataset goes.
    mock.failTraining = "Too much background noise";
    seen = await ok(`/voice/clones/${draft.id}/retry`, "POST", { revision: seen.version }, third);
    await workerUntil(third, async () => (await cloneRow(third, draft.id)).status === "failed");
    seen = await view(third, draft.id);
    assert.deepEqual([seen.error.code, seen.retryable], ["TRAINING_FAILED", false]);
    assert.match(seen.error.message, /Too much background noise.*start a new one/);
    await refused(`/voice/clones/${draft.id}/retry`, "POST", { revision: seen.version }, third, 409, "VOICE_CLONE_START_AGAIN");
    row = await cloneRow(third, draft.id);
    assert.equal(mock.datasets.has(row.provider_job.datasetId), false, "the recordings leave the provider once no attempt can use them");
    await ok(`/voice/clones/${draft.id}`, "DELETE", undefined, third);
  } finally {
    mock.trainingPolls = 2;
    mock.withholdProVoices = false;
    mock.failTraining = null;
    process.env.VOICE_PRO_CLONE_ENABLED = "false";
    process.env.VOICE_PRO_CLONE_SLOTS = "2";
  }
});

test("Arabic replies are transcribed in Arabic by Cartesia, and a spoken pain report holds training", async () => {
  await db.tenant({ tenantId: coach.tenantId, userId: alex.userId, role: "subscriber" }, (tx) =>
    tx.query(
      "INSERT INTO notification_preferences(tenant_id,user_id,data) VALUES($1,$2,'{\"language\":\"ar\"}') ON CONFLICT(tenant_id,user_id) DO UPDATE SET data=notification_preferences.data||excluded.data",
      [coach.tenantId, alex.userId],
    ),
  );
  mock.nextTranscripts.push({ text: "عندي ألم في الركبة", language: "ar" });
  const heard = await ok(`/voice-sessions/${alexSession}/transcribe`, "POST", { audio: wavOf(1).toString("base64"), type: "audio/wav", durationMs: 1500 }, alex);
  assert.equal(mock.transcriptions.at(-1)!.language, "ar");
  assert.equal(heard.transcript, "عندي ألم في الركبة");
  assert.equal(heard.trainingHeld, true, "the safety hold starts from an Arabic pain report");
});

test("a deletion that keeps failing needs attention: operators are alerted and see it from any workspace", async () => {
  const made = await quickClone(third);
  const voiceId = mock.clones.at(-1)!.id;
  mock.failNext.delete = 500;
  await ok(`/voice/clones/${made.id}`, "DELETE", undefined, third);
  const [pending] = await rows(third, "SELECT id,status,attempts,last_error FROM voice_provider_deletions WHERE kind='voice' AND reference=$1", [voiceId]);
  assert.equal(pending.status, "pending");
  assert.match(pending.last_error, /HTTP 500/);
  await rows(third, "UPDATE voice_provider_deletions SET attempts=10,next_attempt_at=now() WHERE id=$1", [pending.id]);
  mock.failNext.delete = 500;
  await processVoiceProviderDeletions(db, worker(third));
  const alertKey = "voice.provider_deletion:" + pending.id;
  const [alert] = await db.system((tx) => tx.query("SELECT status,severity,tenant_id FROM platform_alerts WHERE dedupe_key=$1", [alertKey]));
  assert.deepEqual(alert, { status: "open", severity: "warning", tenant_id: third.tenantId });
  // Only platform administrators read the cross-workspace list.
  await assert.rejects(rows(third, "SELECT * FROM voice_provider_deletions_outstanding(10)"), /platform administrators only/);
  await assert.rejects(rows(third, "SELECT * FROM voice_provider_work_outstanding()"), /platform administrators only/);
  const admin = await operatorApp();
  try {
    const listed = (await admin.inject({ method: "GET", url: "/api/v1/admin/integrations/voice-clones" })).json();
    const entry = listed.deletions.find((d: any) => d.id === pending.id);
    assert.deepEqual([entry.status, entry.tenant_id, entry.kind], ["attention", third.tenantId, "voice"]);
    assert.equal(listed.deletions[0].status, "attention", "attention first");
    assert.doesNotMatch(JSON.stringify(listed.deletions), new RegExp(voiceId), "no provider reference in the listing");
    const retried = await admin.inject({ method: "POST", url: `/api/v1/admin/integrations/voice-deletions/${pending.id}/retry`, payload: { tenantId: third.tenantId } });
    assert.equal(retried.statusCode, 200, retried.body);
  } finally {
    await admin.close();
  }
  await processVoiceProviderDeletions(db, worker(third));
  assert.equal(mock.voices.has(voiceId), false);
  const [cleared] = await db.system((tx) => tx.query("SELECT status FROM platform_alerts WHERE dedupe_key=$1", [alertKey]));
  assert.equal(cleared.status, "resolved");
});

test("with voice paused or another provider chosen, clones stay listed and deletable and the stale purge still runs", async () => {
  const kept = await quickClone(third);
  const keptVoice = mock.clones.at(-1)!.id;
  const stale = await draftWith(third, "instant");
  // Paused: the contract approval is off, the Cartesia account is still saved.
  process.env.VOICE_CONTRACT_VERIFIED = "false";
  try {
    const paused = await ok("/voice/clones", "GET", undefined, third);
    assert.equal(paused.provider, null);
    assert.deepEqual(paused.clones.map((c: any) => c.id).sort(), [kept.id, stale.id].sort(), "the trainer still sees what exists");
    const deleted = await ok(`/voice/clones/${kept.id}`, "DELETE", undefined, third);
    assert.match(deleted.message, /is being deleted/);
    assert.equal(mock.voices.has(keptVoice), false, "deleted at the provider with the saved account");
    await rows(third, "UPDATE trainer_voice_clones SET updated_at=now()-interval '30 days' WHERE id=$1", [stale.id]);
    await processVoiceClones(db, { purgeNow: true });
    assert.equal((await rows(third, "SELECT count(*)::int AS n FROM trainer_voice_samples WHERE clone_id=$1", [stale.id]))[0].n, 0, "the 7-day purge does not wait for the provider");
    assert.equal((await cloneRow(third, stale.id)).status, "deleted");
  } finally {
    process.env.VOICE_CONTRACT_VERIFIED = "true";
  }
  // No Cartesia account saved at all (environment switched to ElevenLabs).
  const orphan = await quickClone(third);
  const orphanVoice = mock.clones.at(-1)!.id;
  process.env.VOICE_PROVIDER = "elevenlabs";
  process.env.VOICE_BASE_URL = "https://api.elevenlabs.io/v1";
  try {
    const deleted = await ok(`/voice/clones/${orphan.id}`, "DELETE", undefined, third);
    assert.match(deleted.message, /as soon as the platform's voice provider connection is back/);
    assert.equal(mock.voices.has(orphanVoice), true);
    const [alert] = await db.system((tx) => tx.query("SELECT status FROM platform_alerts WHERE dedupe_key='voice.provider_account_missing'"));
    assert.equal(alert.status, "open");
  } finally {
    process.env.VOICE_PROVIDER = "cartesia";
    process.env.VOICE_BASE_URL = "https://cartesia.test";
  }
  await processVoiceClones(db);
  assert.equal(mock.voices.has(orphanVoice), false, "the queued deletion runs once the account is back");
});

test("the voice provider cannot leave Cartesia while clones depend on it; pausing stays possible", async () => {
  const made = await quickClone(third);
  const voiceId = mock.clones.at(-1)!.id;
  const admin = await operatorApp();
  try {
    const put = (revision: number, values: Record<string, string>) =>
      admin.inject({ method: "PUT", url: "/api/v1/admin/settings/voice", payload: { revision, enabled: true, values } });
    const leave = await put(0, { VOICE_PROVIDER: "elevenlabs" });
    assert.equal(leave.statusCode, 409, leave.body);
    assert.equal(leave.json().code, "VOICE_CLONES_AT_PROVIDER");
    assert.match(leave.json().message, /1 clone at Cartesia/);
    const disconnect = await admin.inject({ method: "POST", url: "/api/v1/admin/settings/voice/disconnect", payload: { revision: 0 } });
    assert.equal(disconnect.statusCode, 409, disconnect.body);
    const pause = await put(0, { VOICE_CONTRACT_VERIFIED: "false" });
    assert.equal(pause.statusCode, 200, pause.body);
    // The saved row, not the environment, now holds the Cartesia account.
    process.env.VOICE_PROVIDER = "elevenlabs";
    process.env.VOICE_BASE_URL = "https://api.elevenlabs.io/v1";
    try {
      const deleted = await ok(`/voice/clones/${made.id}`, "DELETE", undefined, third);
      assert.match(deleted.message, /is being deleted/);
      assert.equal(mock.voices.has(voiceId), false);
    } finally {
      process.env.VOICE_PROVIDER = "cartesia";
      process.env.VOICE_BASE_URL = "https://cartesia.test";
    }
    // Nothing depends on the account any more (other workspaces included).
    for (const t of [coach, other, third]) for (let i = 0; i < 3; i++) {
      await rows(t, "UPDATE voice_provider_deletions SET next_attempt_at=now() WHERE status='pending'");
      await processVoiceProviderDeletions(db, worker(t), 100);
    }
    const open = (await admin.inject({ method: "GET", url: "/api/v1/admin/integrations/voice-clones" })).json();
    assert.deepEqual(open.deletions, [], JSON.stringify(open.deletions));
    const clonesLeft = open.clones.filter((c: any) => c.status !== "draft");
    assert.deepEqual(clonesLeft, [], JSON.stringify(clonesLeft));
    const left = await put(1, { VOICE_PROVIDER: "elevenlabs" });
    assert.equal(left.statusCode, 200, left.body);
  } finally {
    await admin.close();
  }
});
