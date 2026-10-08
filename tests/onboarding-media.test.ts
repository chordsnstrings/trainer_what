import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import sharp from "sharp";
import { accountsContext, withEnv } from "./accounts-fixtures.ts";
import { withIntegrationFixtureTransport } from "../packages/providers/src/integrations.ts";
import { ConversationAudio, pcmWav } from "../apps/web/lib/conversation-audio.ts";
import { chatAppearance } from "../apps/web/lib/onboarding-http.ts";
import { SpeechGate } from "../apps/web/lib/speech-gate.ts";
import { extractDocumentDetailed } from "../apps/api/src/ingestion.ts";
import { onboardingReply } from "../packages/providers/src/onboarding-chat.ts";
import { emptyChat } from "../packages/domain/src/onboarding-chat.ts";

let ctx: Awaited<ReturnType<typeof accountsContext>>;
before(async () => { ctx = await accountsContext(); });
after(async () => { await ctx.close(); });
const root = "/onboarding-chat", CONSENT = { ownVoice: true, cloning: true, subscriberUse: true, deletion: true };
const api = (p: any, path: string, body?: any, method?: string) => ctx.call(path, { cookie: p.cookie, body, method });
async function ok(p: any, path: string, body?: any, method?: string) { const r = await api(p, path, body, method); assert.equal(r.statusCode, 200, r.body); return r.json(); }
const grant = (p: any, granted = true, type = "coaching") => ok(p, "/privacy/consent", { type, granted });
const upload = (p: any, name = "notes.txt", text = "Progress one small step at a time.", id = randomUUID()) => ok(p, root + "/attachments", { id, fileName: name, contentBase64: Buffer.from(text).toString("base64"), rights: true });
const env = {
  MODEL_API_KEY: "synthetic", MODEL_BASE_URL: "https://onboarding-media.invalid/v1", MODEL_NAME: "seed-2-0-pro-260328", MODEL_MAX_DAILY_CALLS: "1000",
  VOICE_CONTRACT_VERIFIED: "true", VOICE_PROVIDER: "cartesia", VOICE_API_KEY: "synthetic", VOICE_BASE_URL: "https://onboarding-media.invalid", VOICE_MODEL: "sonic-3.6", VOICE_PRICE_VERSION: "fixture", VOICE_API_VERSION: "2026-08-14", VOICE_USD_PER_1000_CHARACTERS: "0.05", VOICE_DAILY_USD_LIMIT: "5", VOICE_QUICK_CLONE_ENABLED: "true", VOICE_CLONE_USD: "0", VOICE_TRAINING_OPT_OUT: "true",
  STT_CONTRACT_VERIFIED: "true", STT_PROVIDER: "cartesia", STT_API_KEY: "synthetic", STT_BASE_URL: "https://onboarding-media.invalid", STT_PRICE_VERSION: "fixture", STT_USD_PER_HOUR: "0.1", STT_ZERO_RETENTION: "false", MARKETING_ASSISTANT_VOICE_ID: "kamran-approved-fixture",
};
async function providers(run: (calls: { stt: number; tts: any[]; models: any[] }, controls: { transcript: string; stt?: () => Promise<void>; failTts?: boolean }) => Promise<void>) {
  const calls = { stt: 0, tts: [] as any[], models: [] as any[] }, controls = { transcript: "I coach busy beginners with short strength sessions." } as { transcript: string; stt?: () => Promise<void>; failTts?: boolean };
  const original = globalThis.fetch;
  await withEnv(env, async () => {
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith(env.MODEL_BASE_URL)) throw Error("Unexpected fixture request: " + url);
      const sent = JSON.parse(String(init?.body)); calls.models.push(sent);
      return Response.json({ usage: { prompt_tokens: 10, completion_tokens: 10 }, choices: [{ message: { content: JSON.stringify({ reply: "Short sessions can fit a busy week.", patch: {}, evidence: {}, questionField: "teaching", question: "How do you decide when to progress?" }) } }] });
    };
    try { await withIntegrationFixtureTransport(async (url, init) => {
      if (url.endsWith("/stt")) { calls.stt++; await controls.stt?.(); return Response.json({ text: controls.transcript, duration: 1, language: "en", request_id: "stt-fixture" }); }
      if (url.endsWith("/tts/bytes")) { calls.tts.push(JSON.parse(String(init.body))); if (controls.failTts) throw Error("Uncertain synthetic TTS outcome"); return new Response(new Uint8Array([73, 68, 51, 0]), { headers: { "content-type": "audio/mpeg", "x-request-id": "tts-fixture" } }); }
      throw Error("Unexpected integration fixture request: " + url);
    }, () => run(calls, controls)); } finally { globalThis.fetch = original; }
  });
}
async function spokenBody() { const wav = pcmWav([new Float32Array(16000).fill(.2)], 16000); return { id: randomUUID(), audio: Buffer.from(await wav.blob.arrayBuffer()).toString("base64"), durationMs: wav.durationMs }; }
const start = (p: any, extra: any = {}) => ok(p, root + "/calls", { id: randomUUID(), language: "en", mode: "teach", consent: true, ...extra });

// The browser stays hands-free: silence does not spend money; each natural pause
// produces one bounded utterance, and muted/playback phases discard the buffer.
test("speech segmentation waits through brief pauses, ignores clicks and resets cleanly", () => {
  const capture = new ConversationAudio(16000), frame = new Float32Array(1600).fill(.1);
  for (let i = 0; i < 30; i++) assert.equal(capture.push(frame, false), null);
  assert.equal(capture.active, false);
  capture.push(frame, true); for (let i = 0; i < 10; i++) assert.equal(capture.push(frame, false), null);
  for (let i = 0; i < 10; i++) assert.equal(capture.push(frame, true), null);
  for (let i = 0; i < 9; i++) assert.equal(capture.push(frame, false), null);
  assert.ok(capture.push(frame, false)?.length); assert.equal(capture.active, false);
  capture.push(frame, true); capture.reset(); assert.equal(capture.active, false);
  const gate = new SpeechGate(); for (let time = 0; time < 1000; time += 100) assert.equal(gate.sample(.2, .1, 2, time), false);
  for (let i = 0; i < 439; i++) capture.push(frame, true);
  assert.ok(capture.push(frame, true));
});
test("PCM encoding has exact bounded duration across browser sample rates and platform palettes match the device", async () => {
  for (const rate of [16000, 44100, 48000]) {
    const wav = pcmWav([new Float32Array(rate * 2).fill(.5)], rate, 1);
    const b = Buffer.from(await wav.blob.arrayBuffer()); assert.equal(wav.durationMs, 1000); assert.equal(b.length, 32044); assert.equal(b.readUInt32LE(24), 16000); assert.equal(b.readInt16LE(44), 16383);
  }
  assert.equal(chatAppearance("Mozilla iPhone Safari"), "ios"); assert.equal(chatAppearance("Macintosh", "MacIntel", 5), "ios");
  assert.equal(chatAppearance("Mozilla Android Chrome"), "android"); assert.equal(chatAppearance("Macintosh", "MacIntel", 0), "web");
});
test("attachments require rights and remain private to the uploader, including bootstrap and direct database scope", async () => {
  const owner = await ctx.person({ role: "owner" }), member = await ctx.person({ role: "subscriber", tenantId: owner.tenantId }), staff = await ctx.person({ role: "staff", tenantId: owner.tenantId }), outsider = await ctx.person({ role: "owner" });
  const body = { id: randomUUID(), fileName: "private.txt", contentBase64: Buffer.from("Private synthetic note, only for my onboarding.").toString("base64"), rights: true };
  assert.equal((await api(member, root + "/attachments", body)).statusCode, 403); await grant(member);
  assert.equal((await api(member, root + "/attachments", { ...body, rights: false })).statusCode, 400);
  const file = await ok(member, root + "/attachments", body); assert.equal((await ok(member, root + "/attachments", body)).id, file.id);
  assert.equal((await api(member, root + "/attachments", { ...body, fileName: "changed.txt" })).statusCode, 409);
  for (const p of [owner, staff, outsider]) {
    assert.ok([403, 404].includes((await api(p, root + "/attachments/" + file.id)).statusCode));
    const rows = await ctx.db.tenant({ ...p, role: p === staff ? "staff" : "owner" }, tx => tx.query("SELECT id FROM records WHERE id=$1", [file.id])); assert.equal(rows.length, 0);
    assert.ok(!JSON.stringify(await ok(p, "/bootstrap")).includes("Private synthetic note"));
  }
  assert.match((await ok(member, root + "/attachments/" + file.id)).text, /Private synthetic/);
  await grant(member, false); assert.equal((await api(member, root + "/attachments/" + file.id)).statusCode, 403);
  await grant(member); assert.equal((await api(member, root + "/attachments/" + file.id)).statusCode, 404);
});
test("a sent teaching file is grounded reference, stored once for review, and cannot be rebound", async () => {
  const p = await ctx.person({ role: "owner" }), file = await upload(p), chat = await ok(p, root);
  await providers(async calls => {
    const body = { id: randomUUID(), version: chat.version, mode: "teach", text: "Here is my progression approach.", attachmentIds: [file.id], attachmentRights: true };
    const response = await ok(p, root + "/messages", body); assert.equal(response.error, undefined); assert.equal(response.teachingIds.length, 2);
    assert.equal(response.messages.find((m: any) => m.id === body.id).attachments[0].id, file.id);
    assert.match(calls.models[0].messages[1].content, /Progress one small step/);
    const again = await ok(p, root + "/messages", body); assert.equal(again.teachingIds.length, 2); assert.equal(calls.models.length, 1);
    const other = await ok(p, root + "/messages", { ...body, id: randomUUID(), version: again.version }); assert.match(other.error, /no longer available/); assert.equal(calls.models.length, 1);
  });
});
test("an attached health disclosure beyond the model excerpt opens a hold with its full evidence", async () => {
  const p = await ctx.person({ role: "subscriber" }); await grant(p);
  const file = await upload(p, "health.txt", "Ordinary training notes. ".repeat(420) + "I have chest pain during exercise."); const chat = await ok(p, root);
  const saved = await ok(p, root + "/messages", { id: randomUUID(), version: chat.version, text: "Please read my notes.", attachmentIds: [file.id], attachmentRights: true });
  assert.match(saved.facts.limitations, /chest pain/);
  const holds = await ctx.db.tenant({ ...p, role: "subscriber" }, tx => tx.query("SELECT data FROM records WHERE kind='training_hold'")); assert.match(holds[0].data.reason, /chest pain/);
});
test("images are sanitized and textless images stay usable without claiming OCR succeeded", async () => {
  const p = await ctx.person({ role: "owner" }), image = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#4488aa" } }).jpeg().withMetadata().toBuffer();
  const file = await ok(p, root + "/attachments", { id: randomUUID(), fileName: "photo.jpg", contentBase64: image.toString("base64"), rights: true });
  assert.equal(file.image, true); assert.equal(file.characters, 0);
  const r = await api(p, root + "/attachments/" + file.id + "?image=1"); assert.equal(r.statusCode, 200); assert.match(String(r.headers["cache-control"]), /no-store/); assert.equal((await sharp(r.rawPayload).metadata()).exif, undefined);
  assert.equal((await api(p, root + "/attachments", { id: randomUUID(), fileName: "fake.jpg", contentBase64: Buffer.from("not an image").toString("base64"), rights: true })).statusCode, 400);
});
test("bounded rich text and presentation readers preserve text and reject embedded content", async () => {
  const rtf = await extractDocumentDetailed("note.rtf", Buffer.from(String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 I use \b steady\b0  progress.\par Caf\u233? and \u-10179?\u-8704?.}`));
  assert.equal(rtf.text, "I use steady progress.\nCafé and 😀.");
  await assert.rejects(extractDocumentDetailed("bad.rtf", Buffer.from(String.raw`{\rtf1{\object malicious}}`)));
  const { stdout } = await promisify(execFile)("python3", ["-c", 'import io,zipfile,base64; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("ppt/slides/slide1.xml",\'<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Keep the reps controlled.</a:t></a:r></a:p>\'); z.close(); print(base64.b64encode(b.getvalue()).decode())']);
  assert.match((await extractDocumentDetailed("teaching.pptx", Buffer.from(stdout.trim(), "base64"))).text, /Keep the reps controlled/);
  await assert.rejects(extractDocumentDetailed("fake.doc", Buffer.from("not a Word file")));
  await assert.rejects(extractDocumentDetailed("fake.xls", Buffer.from("not Excel")));
});
test("model file context stays bounded and opt-in vision follows the active model adapter", async () => {
  await providers(async calls => {
    const chat = emptyChat("coach"); chat.messages.push({ id: randomUUID(), from: "person", text: "Use these notes.", at: new Date().toISOString() });
    const files = [1,2,3].map(i => ({ name: `notes${i}.txt`, text: "large file ".repeat(6000), image: "aW1hZ2U=" }));
    await withEnv({ MODEL_VISION_ENABLED: "true" }, () => onboardingReply(chat, { field: "audience", text: "Who do you coach?" }, [], [], false, { reserve: async () => undefined, record: async () => {} }, files));
    const content = calls.models[0].messages[1].content; assert.equal(content.length, 4); assert.ok(content[0].text.length <= 36000); assert.ok(JSON.parse(content[0].text).attachments.every((f: any) => f.truncated));
  });
});
test("hands-free call turns pin Kamran, charge once per stable request and use the active model", async () => {
  const p = await ctx.person({ role: "owner" });
  await providers(async calls => {
    assert.equal((await ok(p, root + "/calls/options")).available, true);
    assert.equal((await api(p, root + "/calls", { id: randomUUID(), language: "en", consent: false })).statusCode, 400);
    const session = await start(p), path = root + "/calls/" + session.id + "/turns";
    const greeting = { id: randomUUID(), greeting: true }; await ok(p, path, greeting); await ok(p, path, greeting);
    assert.equal(calls.tts.length, 1); assert.equal(calls.stt, 0); assert.equal(calls.models.length, 0);
    const body = await spokenBody(); const turn = await ok(p, path, body); assert.equal(turn.error, null); assert.ok(turn.audio); assert.equal(turn.conversation.messages.filter((m: any) => m.source === "voice").length, 1);
    await ok(p, path, body); assert.equal(calls.stt, 1); assert.equal(calls.models.length, 1); assert.equal(calls.tts.length, 2);
    await withEnv({ MODEL_NAME: "other-current-model" }, async () => { await ok(p, path, await spokenBody()); });
    assert.equal(calls.models[1].model, "other-current-model"); assert.ok(calls.tts.every(t => t.voice.id === env.MARKETING_ASSISTANT_VOICE_ID));
    const costs = await ctx.db.tenant({ ...p, role: "owner" }, tx => tx.query("SELECT task,product,status FROM cost_events WHERE task LIKE 'voice.onboarding_setup.%'"));
    assert.equal(costs.length, 5); assert.ok(costs.every(c => c.product === "trainer_setup" && c.status === "estimated"));
    await ok(p, root + "/calls/" + session.id + "/end", {}); assert.equal((await api(p, path, await spokenBody())).statusCode, 409);
    const cached = await ctx.db.tenant({ ...p, role: "owner" }, tx => tx.query("SELECT id FROM records WHERE kind='onboarding_voice_request' AND data ? 'audio'")); assert.equal(cached.length, 0);
  });
});
test("an uncertain speech outcome stays saved and cannot buy a second attempt via transport retry", async () => {
  const p = await ctx.person({ role: "owner" });
  await providers(async (calls, control) => {
    control.failTts = true; const session = await start(p), path = root + "/calls/" + session.id + "/turns", body = { id: randomUUID(), greeting: true };
    assert.ok((await ok(p, path, body)).error); await ok(p, path, body); assert.equal(calls.tts.length, 1);
    const costs = await ctx.db.tenant({ ...p, role: "owner" }, tx => tx.query("SELECT status FROM cost_events WHERE task='voice.onboarding_setup.speech'")); assert.equal(costs[0].status, "unknown");
  });
});
test("voice cap prevents a provider request and hangup can overtake call creation", async () => {
  const p = await ctx.person({ role: "owner" });
  await providers(async calls => {
    const id = randomUUID(); await ok(p, root + "/calls/" + id + "/end", {}); assert.equal((await api(p, root + "/calls", { id, consent: true, language: "en" })).statusCode, 409);
    const session = await start(p); await withEnv({ VOICE_DAILY_USD_LIMIT: "0.000001" }, async () => { const r = await ok(p, root + "/calls/" + session.id + "/turns", { id: randomUUID(), greeting: true }); assert.match(r.error, /allowance/); }); assert.equal(calls.tts.length, 0);
  });
});
test("subscriber voice consent withdrawal rejects a late transcript and deletes call receipts", async () => {
  const p = await ctx.person({ role: "subscriber" }); await grant(p);
  await providers(async (calls, control) => {
    let entered!: () => void, release!: () => void; const wait = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { entered = r; });
    control.stt = async () => { entered(); await wait; };
    const session = await start(p); const work = api(p, root + "/calls/" + session.id + "/turns", await spokenBody()); await ready;
    try { await grant(p, false, "voice"); } finally { release(); }
    assert.equal((await work).statusCode, 409); assert.equal(calls.models.length, 0); assert.equal(calls.tts.length, 0);
    const rows = await ctx.db.tenant({ ...p, role: "subscriber" }, tx => tx.query("SELECT id FROM records WHERE kind='onboarding_voice_request'")); assert.equal(rows.length, 0);
  });
});
test("trainer microphone cloning is opt-in and resumes only an empty call draft", async () => {
  const p = await ctx.person({ role: "owner" }), member = await ctx.person({ role: "subscriber", tenantId: p.tenantId }); await grant(member);
  await providers(async calls => {
    const off = await start(p); assert.equal((await api(p, root + "/calls/" + off.id + "/clone", {})).statusCode, 403);
    assert.equal((await api(member, root + "/calls", { id: randomUUID(), consent: true, language: "en", cloneConsent: CONSENT })).statusCode, 403);
    const first = await start(p, { cloneConsent: CONSENT }), draft = await ok(p, root + "/calls/" + first.id + "/clone", {});
    assert.equal(draft.status, "draft"); assert.equal((await ok(p, root + "/calls/" + first.id + "/clone", {})).id, draft.id);
    await ok(p, root + "/calls/" + first.id + "/end", {});
    const second = await start(p, { cloneConsent: CONSENT }); assert.equal((await ok(p, root + "/calls/" + second.id + "/clone", {})).id, draft.id);
    assert.equal(calls.tts.length, 0); assert.equal(calls.stt, 0);
  });
});

test("withdrawal and regrant during file reading cannot recreate the discarded upload", async () => {
  const p = await ctx.person({ role: "subscriber" }); await grant(p);
  const original = ctx.db.tenant.bind(ctx.db);
  let entered!: () => void, release!: () => void, pause = true;
  const ready = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
  ctx.db.tenant = (async (a: any, fn: any) => {
    let uploadCheck = false;
    const result = await original(a, tx => fn({ ...tx, query: async (sql: string, args?: any[]) => {
      if (pause && sql.includes("count(*)::int AS total") && sql.includes("onboarding_attachment")) uploadCheck = true;
      return tx.query(sql, args);
    } }));
    if (uploadCheck && pause) { pause = false; entered(); await held; }
    return result;
  }) as typeof ctx.db.tenant;
  const id = randomUUID();
  try {
    const work = api(p, root + "/attachments", { id, fileName: "notes.txt", contentBase64: Buffer.from("This must not return after withdrawal.").toString("base64"), rights: true });
    await ready;
    try { await grant(p, false); await grant(p); } finally { release(); }
    const r = await work; assert.equal(r.statusCode, 409, r.body);
    assert.equal((await api(p, root + "/attachments/" + id)).statusCode, 404);
  } finally { release(); ctx.db.tenant = original; }
});

test("concurrent delivery of one spoken turn transcribes only once and preserves the finished receipt", async () => {
  const p = await ctx.person({ role: "owner" });
  await providers(async (calls, control) => {
    let entered!: () => void, release!: () => void; const ready = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
    control.stt = async () => { entered(); await held; };
    const s = await start(p), path = root + "/calls/" + s.id + "/turns", body = await spokenBody();
    const running = ok(p, path, body); await ready;
    try { assert.equal((await ok(p, path, body)).pending, true); assert.equal(calls.stt, 1); } finally { release(); }
    const done = await running; assert.equal(done.error, null); assert.equal((await ok(p, path + "/" + body.id)).audio, done.audio); assert.equal(calls.models.length, 1); assert.equal(calls.tts.length, 1);
  });
});
