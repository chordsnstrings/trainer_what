// Full local API/database and real browser audio; only external providers are synthetic.
import { execFileSync } from "node:child_process";
import { pcmFixture, wavBytes } from "./voice-audio-fixtures.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:https";
import { createMockTls } from "../tests/e2e/mocks/tls.ts";
if (process.env.NODE_ENV === "production")
  throw Error("Synthetic development checks only");
mkdirSync("test-results/marketing-call", { recursive: true });
// Give the locally hosted model a startup window before the first spoken turn.
const wav = wavBytes(pcmFixture(50, [3, 15, 29].map(at => ({ at, text: "Show me the pricing." }))));
const microphone = resolve("test-results/marketing-call/microphone.wav");
writeFileSync(microphone, wav);
const tone = (seconds) =>
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=550:duration=${seconds}`,
    "-f",
    "mp3",
    "pipe:1",
  ]);
const replyAudio = tone(10),
  cueAudio = tone(3.5),
  tls = createMockTls();
const server = createServer(
  { key: tls.key, cert: tls.cert },
  async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.url === "/tts/bytes") {
      res.setHeader("Content-Type", "audio/mpeg");
      res.end(
        /One moment|still with you/.test(JSON.parse(raw).transcript ?? "")
          ? cueAudio
          : replyAudio,
      );
      return;
    }
    if (req.url === "/stt") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          text: "Show me how pricing works",
          duration: 2,
          language: "en",
        }),
      );
      return;
    }
    const payload = JSON.parse(raw),
      context = JSON.parse(payload.messages[1].content);
    if (!context.earlierTurns.length)
      await new Promise((resolve) => setTimeout(resolve, 18000));
    const navigate = context.currentPage === "pricing" ? "faq" : "pricing";
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        usage: { prompt_tokens: 20, completion_tokens: 30 },
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply:
                  navigate === "pricing"
                    ? "Let me show you pricing."
                    : "Let's look at the frequently asked questions.",
                lang: "en",
                navigate,
                handoff: false,
              }),
            },
          },
        ],
      }),
    );
  },
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
Object.assign(process.env, {
  MARKETING_CALL_FIXTURE: "true",
  MARKETING_MICROPHONE_FIXTURE: microphone,
  TRAINER_PROVIDER_SANDBOX: "mock",
  NODE_EXTRA_CA_CERTS: tls.caFile,
  MODEL_BASE_URL: `https://127.0.0.1:${port}/v1`,
  MODEL_API_KEY: "synthetic-local-fixture",
  MODEL_NAME: "seed-2-0-pro-260328",
  MODEL_INPUT_USD_PER_MILLION: "0.5",
  MODEL_OUTPUT_USD_PER_MILLION: "3",
  MODEL_PRICE_VERSION: "fixture",
  MARKETING_ASSISTANT_ENABLED: "true",
  MARKETING_ASSISTANT_DAILY_AED: "10",
  MARKETING_ASSISTANT_VOICE_ID: "kamran-marketing-fixture",
  SECURITY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  VOICE_CONTRACT_VERIFIED: "true",
  VOICE_PROVIDER: "cartesia",
  VOICE_API_KEY: "synthetic-local-fixture",
  VOICE_BASE_URL: `https://127.0.0.1:${port}`,
  VOICE_MODEL: "sonic-3.6",
  VOICE_PRICE_VERSION: "fixture",
  VOICE_API_VERSION: "2026-08-14",
  VOICE_USD_PER_1000_CHARACTERS: "0.05",
  VOICE_DAILY_USD_LIMIT: "50",
  STT_CONTRACT_VERIFIED: "true",
  STT_PROVIDER: "cartesia",
  STT_API_KEY: "synthetic-local-fixture",
  STT_BASE_URL: `https://127.0.0.1:${port}`,
  STT_PRICE_VERSION: "fixture",
  STT_USD_PER_HOUR: "0.1",
  STT_ZERO_RETENTION: "false",
  RTL_CHECK_MODULE: "./marketing-call-check.mjs",
  RTL_WEB_PORT: process.env.RTL_WEB_PORT ?? "3223",
  RTL_API_PORT: process.env.RTL_API_PORT ?? "4223",
  RTL_DATA_DIR: process.env.RTL_DATA_DIR ?? ".data/marketing-call",
});
try {
  await import("./run-rtl-check.mjs");
} finally {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
  tls.cleanup();
}
