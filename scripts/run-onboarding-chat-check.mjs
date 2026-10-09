// An isolated loopback model fixture. No real provider calls or customer data.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:https";
import { createMockTls } from "../tests/e2e/mocks/tls.ts";
if (process.env.NODE_ENV === "production") throw Error("Synthetic development checks only");
const replies = {
  coach: { publicName: "Alex", city: "Dubai", audience: "busy beginners", approach: "simple strength sessions" },
  member: { age: 28, goal: "Build sustainable strength", experience: "beginner", daysPerWeek: 3, availableWeekdays: [1, 3, 5], maxSessionMinutes: 45, equipment: "Dumbbells", limitations: "No injuries or limitations" },
};
// A looping, speech-band synthetic microphone and short decodable reply audio.
// Real browser capture/worklet/VAD/playback, with no real voice or paid requests.
mkdirSync("test-results/onboarding-chat", { recursive: true });
const rate = 48000, n = rate * 6, wav = Buffer.alloc(44 + n * 2);
wav.write("RIFF"); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < rate * 4; i++) { const v = [380,620,890,1270,1780,2430].reduce((s, hz) => s + Math.sin(2 * Math.PI * hz * i / rate) * .035, 0); wav.writeInt16LE(Math.round(v * 32767), 44 + i * 2); }
const microphone = resolve("test-results/onboarding-chat/microphone.wav"); writeFileSync(microphone, wav);
const replyAudio = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-f", "mp3", "pipe:1"]);
const tls = createMockTls();
let stt = 0;
const server = createServer({ key: tls.key, cert: tls.cert }, async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  if (req.url === "/tts/bytes") { res.setHeader("Content-Type", "audio/mpeg"); res.end(replyAudio); return; }
  if (req.url === "/stt") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ text: "I coach beginners with short strength sessions. Spoken answer " + (++stt), duration: 4, language: "en" })); return; }
  if (req.url === "/voices/clone") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ id: "synthetic-call-voice", name: "Synthetic trainer clone", is_public: false })); return; }
  if (req.url?.startsWith("/voices/synthetic-call-voice")) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ id: "synthetic-call-voice", name: "Synthetic trainer clone", is_public: false })); return; }
  const payload = JSON.parse(raw), context = JSON.parse(payload.messages[1].content);
  if (context.task === "coaching") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ usage: { prompt_tokens: 20, completion_tokens: 30 }, choices: [{ message: { content: JSON.stringify({
      type: "message", message: "Let's work around that change. What time do you have available?", reason: "Ask about availability before suggesting a change.",
      evidenceIds: [context.evidence[0].id], requiresHumanReview: true,
    }) } }] })); return;
  }
  const text = context.conversation.at(-1).text, patch = replies[context.audience];
  const evidence = Object.fromEntries(Object.keys(patch).map(key => [key, key === "limitations" ? "No injuries or limitations" : text]));
  const coaching = context.audience === "coach" && text.includes("simple strength sessions")
    ? { methods: { selected: ["strength"], evidence: "simple strength sessions" } } : undefined;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ usage: { prompt_tokens: 20, completion_tokens: 20 }, choices: [{ message: { content: JSON.stringify({ reply: "That sounds doable. We'll keep it practical.", patch, evidence, coaching, question: null, questionField: null }) } }] }));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
Object.assign(process.env, {
  TRAINER_PROVIDER_SANDBOX: "mock", NODE_EXTRA_CA_CERTS: tls.caFile,
  ONBOARDING_FIDELITY_FIXTURE: "true",
  MODEL_BASE_URL: "https://127.0.0.1:" + port + "/v1", MODEL_API_KEY: "synthetic-local-fixture", MODEL_NAME: "seed-2-0-pro-260328",
  RTL_CHECK_MODULE: "./onboarding-chat-check.mjs", ONBOARDING_MICROPHONE_FIXTURE: microphone,
  FILE_IMPORTS_APPROVED: "true", SECURITY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  VOICE_CONTRACT_VERIFIED: "true", VOICE_PROVIDER: "cartesia", VOICE_API_KEY: "synthetic-local-fixture", VOICE_BASE_URL: "https://127.0.0.1:" + port, VOICE_MODEL: "sonic-3.6", VOICE_PRICE_VERSION: "fixture", VOICE_API_VERSION: "2026-08-14", VOICE_USD_PER_1000_CHARACTERS: "0.05", VOICE_DAILY_USD_LIMIT: "50", VOICE_QUICK_CLONE_ENABLED: "true", VOICE_CLONE_USD: "0", VOICE_TRAINING_OPT_OUT: "true", VOICE_CLONE_REVIEW_REQUIRED: "false",
  STT_CONTRACT_VERIFIED: "true", STT_PROVIDER: "cartesia", STT_API_KEY: "synthetic-local-fixture", STT_BASE_URL: "https://127.0.0.1:" + port, STT_PRICE_VERSION: "fixture", STT_USD_PER_HOUR: "0.1", STT_ZERO_RETENTION: "false", MARKETING_ASSISTANT_VOICE_ID: "kamran-approved-fixture",
});
try { await import("./run-rtl-check.mjs"); } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); tls.cleanup(); }
