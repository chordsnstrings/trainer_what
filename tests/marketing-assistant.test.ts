// The home page voice assistant (docs/features/kamran-assistant.md): reply
// checks and the site's calculators, then the public turn route end to end
// with fixture providers: Super admin switch, daily cap, visitor limits,
// sign-up hand-off, and nothing a visitor says stored.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { marketingAssistantFacts } from "@trainer/contracts";
import {
  computeAssistantCalc,
  screenAssistantReply,
  visitorNumbers,
  writtenNumbers,
} from "../packages/domain/src/marketing-assistant.ts";
import { estimateEarnings, DEFAULT_EARNINGS_INPUTS } from "../packages/domain/src/marketing-calculators.ts";
import { governanceFixture } from "./governance-fixtures.ts";
import {
  nextUaeMidnight,
  replyClips,
  resetAssistantVoiceCache,
  TURN_RESERVE_AED,
  turnReserve,
  uaeDay,
  visitorKey,
} from "../apps/api/src/marketing-assistant.ts";

const facts = marketingAssistantFacts({ origin: "https://trainsyou.example", appName: "trainsyou" });
const screen = (reply: any, visitorText = "", frontier = false) =>
  screenAssistantReply({ reply: { lang: "en", calc: null, handoff: false, ...reply }, facts, visitorText, frontier });

test("assistant facts cover the current builder and supervised setup", () => {
  assert.match(facts, /270 layouts across 38 module families/);
  assert.match(facts, /website editor is desktop-only/);
  assert.match(facts, /paired photos and captions/);
  assert.match(facts, /8 quiz answers.*3 client cases/);
  assert.match(facts, /Automatic sending requires 20 cases/);
  assert.match(facts, /My own music|Own-music mode/);
  assert.match(facts, /right-to-left layouts/);
  assert.equal(screen({ reply: "The desktop editor offers 270 layouts across 38 module families." }).replaced, false);
});

test("calculations come from the site's calculators and fill the placeholders", () => {
  const calc = computeAssistantCalc({ kind: "earnings", subscribers: 50, priceAed: 300 });
  const e = estimateEarnings({
    ...DEFAULT_EARNINGS_INPUTS,
    subscribers: 50,
    workoutPriceAed: 300,
    nutritionSharePct: 0,
    voiceSharePct: 0,
    sessionsPerMonth: 0,
    yourSessionRateAed: 0,
  });
  assert.equal(calc.values.takeHome, e.beforeOtherCostsMinor / 100);
  assert.equal(calc.values.takeHome, 11250);
  const s = screen(
    {
      reply: "As an estimate, about AED {takeHome} a month remains before other costs, after {commissionRate}% commission.",
      calc: { kind: "earnings", subscribers: 50, priceAed: 300 },
    },
    "If I have 50 clients paying 300 dirhams a month, what would I make?",
  );
  assert.equal(s.replaced, false, s.issues.join());
  assert.match(s.text, /AED 11,250 a month/);
  assert.match(s.text, /25% commission/);
  // Defaults are the calculator's own when the visitor gave no numbers.
  const followers = computeAssistantCalc({ kind: "followers", followers: 10000 });
  assert.equal(followers.inputs.priceAed, 199);
  assert.ok(followers.values.strong! >= followers.values.typical!);
});

test("numbers not in the site facts, the calculation or what the visitor said are never spoken", () => {
  // A number the model invented.
  const invented = screen({ reply: "Most trainers earn AED 18,000 a month." });
  assert.equal(invented.replaced, true);
  assert.ok(invented.issues.includes("number_not_grounded"));
  assert.match(invented.text, /earnings calculator/);
  // A calculation on numbers the visitor never said.
  const made = screen(
    { reply: "That leaves about AED {takeHome}.", calc: { kind: "earnings", subscribers: 437, priceAed: 300 } },
    "What could I make?",
  );
  assert.ok(made.issues.includes("calc_input_not_grounded"));
  // A placeholder without its calculation, and spelled-out large numbers.
  assert.ok(screen({ reply: "You keep AED {takeHome}." }).issues.includes("invalid_placeholder"));
  assert.ok(screen({ reply: "Thousands of trainers use it." }).issues.includes("large_number_word"));
  // Site numbers pass: the commission bands.
  assert.equal(screen({ reply: "Commission runs in bands of 25%, 20%, 15% and 10%." }).replaced, false);
  // Arabic-Indic digits are read as numbers; visitor words count as said.
  assert.deepEqual(writtenNumbers("٢٠ عميل و٤٠٠ درهم"), [20, 400]);
  assert.deepEqual(visitorNumbers("I have 10k followers and fifty clients at two hundred"), [10000, 50, 200]);
  assert.deepEqual(visitorNumbers("five thousand followers"), [5000]);
});

test("vendor names, frontier wording while off, medical advice, links and promises are replaced", () => {
  for (const reply of [
    "I run on ChatGPT.",
    "It is built on Claude by Anthropic.",
    "We use Seed 2.0 Pro from BytePlus.",
    "Take ibuprofen for the knee and keep squatting.",
    "Email me at hello@example.com.",
    "Visit www.example.com for more.",
    "I guarantee you will earn more.",
  ]) assert.equal(screen({ reply }).replaced, true, reply);
  assert.equal(screen({ reply: "It runs on a frontier model." }).replaced, true);
  assert.equal(screen({ reply: "It runs on a frontier model." }, "", true).replaced, false);
  // Declines are fine, a promise is not.
  assert.equal(screen({ reply: "We never guarantee earnings; figures are estimates, not guarantees." }).replaced, false);
  assert.equal(screen({ reply: "I can't guarantee a number, but I can explain pricing." }).replaced, false);
  assert.equal(screen({ reply: "Our results are guaranteed." }).replaced, true);
  assert.equal(screen({ reply: "That is for a doctor or your own coach. I can tell you how the platform works." }).replaced, false);
  // Too long for a spoken turn.
  assert.equal(screen({ reply: "One. Two. Three. Four." }).issues.includes("too_long"), true);
  // A sign-up request still hands off with a code-owned line.
  assert.equal(screen({ reply: "I use GPT. Let's go.", handoff: true }).handoff, true);
});

test("UAE day, midnight reset, keyed visitor hashes and cue-sized clips", () => {
  assert.equal(uaeDay(new Date("2026-10-01T19:59:00Z")), "2026-10-01");
  assert.equal(uaeDay(new Date("2026-10-01T20:00:00Z")), "2026-10-02");
  assert.equal(nextUaeMidnight(new Date("2026-10-01T10:00:00Z")), "2026-10-01T20:00:00.000Z");
  const a = visitorKey("2026-10-01", "address", "10.0.0.1");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, visitorKey("2026-10-02", "address", "10.0.0.1"), "changes every day");
  assert.ok(!a.includes("10.0.0.1"));
  assert.deepEqual(replyClips("One. Two? Three! Four."), ["One.", "Two?", "Three! Four."]);
});

// --- The public route with fixture providers -----------------------------

const env: Record<string, string> = {
  MARKETING_ASSISTANT_ENABLED: "true",
  MARKETING_ASSISTANT_DAILY_AED: "10",
  MODEL_BASE_URL: "https://model.test/v1",
  MODEL_API_KEY: "sk-fixture-model",
  MODEL_NAME: "fixture-model",
  MODEL_INPUT_USD_PER_MILLION: "0.5",
  MODEL_OUTPUT_USD_PER_MILLION: "3",
  MODEL_PRICE_VERSION: "fixture",
  VOICE_CONTRACT_VERIFIED: "true",
  VOICE_PROVIDER: "cartesia",
  VOICE_API_KEY: "sk_car_fixture",
  VOICE_BASE_URL: "https://voice.test",
  VOICE_MODEL: "sonic-2",
  VOICE_PRICE_VERSION: "fixture",
  VOICE_USD_PER_1000_CHARACTERS: "0.05",
  VOICE_DAILY_USD_LIMIT: "5",
  STT_CONTRACT_VERIFIED: "true",
  STT_PROVIDER: "cartesia",
  STT_API_KEY: "sk_car_fixture",
  STT_BASE_URL: "https://voice.test",
  STT_PRICE_VERSION: "fixture",
  STT_USD_PER_HOUR: "0.4",
  STT_ZERO_RETENTION: "false",
};
const saved: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;
const SAID = "This sounds great, how do I sign up for trainsyou";
let heard = SAID;
const calls: string[] = [];
/** When set, each speech-to-text call waits for it (turns held in flight together). */
let sttHold: (() => Promise<void>) | null = null;

function wav(seconds = 1) {
  const rate = 8000, data = rate * 2 * seconds, b = Buffer.alloc(44 + data);
  b.write("RIFF", 0); b.writeUInt32LE(36 + data, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(data, 40);
  return b.toString("base64");
}

before(() => {
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  resetAssistantVoiceCache();
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.hostname}${url.pathname}`);
    if (url.hostname === "model.test") {
      const body = JSON.parse(String(init.body));
      const visitor = JSON.parse(body.messages[1].content).visitor as string;
      const reply = /sign up/i.test(visitor)
        ? { reply: "Great, I'll take you to Start coaching.", lang: "en", calc: null, handoff: true }
        : { reply: "I built trainsyou so trainers get more out of their effort.", lang: "en", calc: null, handoff: false };
      return Response.json({
        id: "fixture",
        choices: [{ message: { role: "assistant", content: JSON.stringify(reply) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 6000, completion_tokens: 120 },
      });
    }
    if (url.hostname === "voice.test" && url.pathname === "/voices")
      return Response.json({ data: [{ id: "voice-kamran", name: "Kamran" }, { id: "voice-other", name: "Other" }], has_more: false });
    if (url.hostname === "voice.test" && url.pathname === "/stt") {
      if (sttHold) await sttHold();
      return Response.json({ text: heard, duration: 1, language: "en" });
    }
    if (url.hostname === "voice.test" && url.pathname === "/tts/bytes") {
      const sent = JSON.parse(String(init.body));
      assert.equal(sent.voice.id, process.env.MARKETING_ASSISTANT_VOICE_ID || "voice-kamran");
      return new Response(Buffer.from("ID3fixture-mp3"), { headers: { "content-type": "audio/mpeg" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = v;
  }
  resetAssistantVoiceCache();
});

test("public turn: speech in, checked reply and voice out, hand-off, cap, limits, nothing stored (PGlite)", async () => {
  const f = await governanceFixture();
  const turn = (visit: string, remoteAddress = "10.77.0.1") =>
    f.app.inject({
      method: "POST",
      url: "/api/v1/public/assistant/turn",
      remoteAddress,
      headers: { host: "localhost:3000", origin: "http://localhost:3000" },
      payload: { visit, audio: wav(), type: "audio/wav", durationMs: 1000, lang: "en", history: [] },
    });
  // Switched off: hidden everywhere and the route refuses.
  process.env.MARKETING_ASSISTANT_ENABLED = "false";
  assert.equal((await f.call("/public/platform")).json().assistant, false);
  assert.equal((await turn(randomUUID())).json().code, "ASSISTANT_OFF");
  process.env.MARKETING_ASSISTANT_ENABLED = "true";
  assert.equal((await f.call("/public/platform")).json().assistant, true);
  assert.equal((await f.call("/public/assistant")).json().available, true);

  // A sign-up request: the reply, its audio in the default "Kamran" voice and the hand-off.
  const ok = await turn(randomUUID());
  assert.equal(ok.statusCode, 200, ok.body);
  const body = ok.json();
  assert.equal(body.caption, "Great, I'll take you to Start coaching.");
  assert.equal(body.heard, SAID);
  assert.deepEqual(body.handoff, { href: "/signup", label: "Start coaching" });
  assert.equal(body.audio.length, 1, "one clip per sentence");
  assert.equal(Buffer.from(body.audio[0], "base64").toString().startsWith("ID3"), true);
  assert.equal(body.turnsLeft, 9);

  // Counts and cost only: no audio, transcript or reply text anywhere.
  const rows = await f.db.system((tx) => tx.query("SELECT * FROM marketing_assistant_days"));
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].turns), 1);
  assert.equal(Number(rows[0].handoffs), 1);
  assert.ok(Number(rows[0].cost_aed) > 0);
  assert.ok(Number(rows[0].model_input_tokens) === 6000);
  const counters = await f.db.system((tx) => tx.query("SELECT * FROM marketing_assistant_counters"));
  const stored = JSON.stringify([rows, counters]);
  for (const text of [SAID, "Start coaching", "10.77.0.1"]) assert.ok(!stored.includes(text), text);

  // Ten turns per visit, then the visit ends.
  const visit = randomUUID();
  heard = "Why did you build it?";
  for (let i = 0; i < 10; i++) assert.equal((await turn(visit, `10.78.0.${i}`)).statusCode, 200);
  const limited = await turn(visit, "10.78.1.1");
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().code, "ASSISTANT_LIMIT");

  // A chosen voice replaces the default.
  process.env.MARKETING_ASSISTANT_VOICE_ID = "voice-other";
  assert.equal((await turn(randomUUID(), "10.79.0.1")).statusCode, 200);
  Reflect.deleteProperty(process.env, "MARKETING_ASSISTANT_VOICE_ID");

  // The daily cap: refused with the time it comes back, and hidden on the page.
  await f.db.system((tx) => tx.query("UPDATE marketing_assistant_days SET cost_aed=9.9 WHERE day=$1", [uaeDay()]));
  const capped = await turn(randomUUID(), "10.80.0.1");
  assert.equal(capped.statusCode, 429);
  assert.equal(capped.json().code, "ASSISTANT_CAP");
  assert.equal(capped.json().hiddenUntil, nextUaeMidnight());
  assert.equal((await f.call("/public/assistant")).json().available, false);
  assert.equal((await f.call("/public/platform")).json().assistant, false);

  // Super admin: today's numbers and the voice list; nobody else.
  const admin = await f.operator("admin");
  const view = await f.call("/admin/marketing-assistant", { cookie: admin.cookie });
  assert.equal(view.statusCode, 200, view.body);
  const v = view.json();
  assert.equal(v.today.capReached, true);
  assert.equal(v.defaultVoice.id, "voice-kamran");
  assert.deepEqual(v.voices.map((x: any) => x.name), ["Kamran", "Other"]);
  assert.equal(v.settings.dailyCapAed, 10);
  const coach = await f.person();
  assert.equal((await f.call("/admin/marketing-assistant", { cookie: coach.cookie })).statusCode, 403);
  // No model or voice call was made for refused turns.
  assert.ok(calls.filter((c) => c.includes("/chat/completions")).length === 12);
});

test("the most a turn can cost is reserved: model prices or USD 5 / 30, the clip's billed length, never below the minimum", () => {
  const base = { promptBytes: 20000, billableMs: 1000, sttUsdPerHour: 0.4, voiceUsdPer1000: 0.05 };
  const priced = { MODEL_INPUT_USD_PER_MILLION: "0.5", MODEL_OUTPUT_USD_PER_MILLION: "3", FINANCE_USD_TO_AED: "3.6725" };
  assert.equal(turnReserve(priced, base).aed, TURN_RESERVE_AED);
  // Without model prices the turn counts at USD 5 / 30 per million.
  const unpriced = turnReserve({ FINANCE_USD_TO_AED: "3.6725" }, base);
  assert.equal(unpriced.modelUsd, (20000 * 5 + 1500 * 30) / 1_000_000);
  assert.ok(unpriced.aed > TURN_RESERVE_AED);
  // A higher cache-write price is the input price; a long compressed clip raises the reserve.
  assert.ok(turnReserve({ ...priced, MODEL_CACHE_WRITE_USD_PER_MILLION: "20" }, base).modelUsd > turnReserve(priced, base).modelUsd);
  assert.ok(turnReserve(priced, { ...base, billableMs: 874_000, sttUsdPerHour: 4 }).aed > TURN_RESERVE_AED);
});

test("public turn: turns at the same time never take the day over the cap; real compressed clips are accepted (PGlite)", async () => {
  const f = await governanceFixture();
  heard = "Why did you build it?";
  // A fresh day: under PostgreSQL the file's fixtures share one database and
  // the runtime role may not delete day rows, so today's totals are reset.
  await f.db.system((tx) =>
    tx.query("UPDATE marketing_assistant_days SET cost_aed=0,stt_seconds=0,stt_usd=0 WHERE day=$1", [uaeDay()]),
  );
  const turn = (remoteAddress: string, audio = wav(), type = "audio/wav", durationMs = 1000) =>
    f.app.inject({
      method: "POST",
      url: "/api/v1/public/assistant/turn",
      remoteAddress,
      headers: { host: "localhost:3000", origin: "http://localhost:3000" },
      payload: { visit: randomUUID(), audio, type, durationMs, lang: "en", history: [] },
    });
  // A 5 s phone recording (WebM/Opus at about 48 kbit/s) is not refused as too long;
  // it is billed at its conservative length (the bytes at 6 kbit/s).
  const webm = Buffer.alloc(30 * 1024, 7);
  webm.writeUInt32BE(0x1a45dfa3, 0);
  const phone = await turn("10.81.0.1", webm.toString("base64"), "audio/webm", 5000);
  assert.equal(phone.statusCode, 200, phone.body);
  const [first] = await f.db.system((tx) => tx.query("SELECT * FROM marketing_assistant_days WHERE day=$1", [uaeDay()]));
  assert.equal(Number(first.stt_seconds), Math.ceil((30 * 1024 * 8 * 1000) / 6000) / 1000);
  // The reservation is replaced by the actual cost once the turn ends.
  assert.ok(Number(first.cost_aed) > 0 && Number(first.cost_aed) < TURN_RESERVE_AED, String(first.cost_aed));
  // A WAV clip whose header says 25 s is too long, whatever the page declared.
  const long = await turn("10.81.0.2", wav(25), "audio/wav", 20000);
  assert.equal(long.statusCode, 400);
  assert.equal(long.json().code, "SPEECH_TOO_LONG");

  // Room for exactly two reservations today. Six turns are held in flight
  // together (speech-to-text waits until each has started or been refused):
  // two run, four are refused at the cap.
  await f.db.system((tx) => tx.query("UPDATE marketing_assistant_days SET cost_aed=$2 WHERE day=$1", [uaeDay(), 10 - 2 * TURN_RESERVE_AED - 0.05]));
  let inFlight = 0, refused = 0, open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const check = () => inFlight + refused >= 6 && open();
  sttHold = async () => {
    inFlight++;
    check();
    await gate;
  };
  const results = await Promise.all(
    [0, 1, 2, 3, 4, 5].map((i) =>
      turn(`10.82.0.${i}`).then((r) => {
        if (r.statusCode !== 200) refused++, check();
        return r;
      }),
    ),
  );
  sttHold = null;
  const codes = results.map((r) => (r.statusCode === 200 ? "ok" : r.json().code)).sort();
  assert.deepEqual(codes, ["ASSISTANT_CAP", "ASSISTANT_CAP", "ASSISTANT_CAP", "ASSISTANT_CAP", "ok", "ok"]);
  const [day] = await f.db.system((tx) => tx.query("SELECT cost_aed FROM marketing_assistant_days WHERE day=$1", [uaeDay()]));
  assert.ok(Number(day.cost_aed) <= 10, String(day.cost_aed));
});
