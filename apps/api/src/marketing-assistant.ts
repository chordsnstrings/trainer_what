// The home page voice assistant (docs/features/kamran-assistant.md): one
// spoken turn is speech-to-text, one model call through the active profile,
// the reply checks of packages/domain/src/marketing-assistant.ts, and speech
// in the chosen voice. Nothing a visitor says or hears is stored: only daily
// counts and cost, and day-keyed hashed counters for the visitor limits.
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Database, Tx } from "@trainer/db";
import { marketingAssistantFacts } from "@trainer/contracts";
import {
  integrationCapability,
  runtimeConfig,
  type RuntimeConfig,
} from "../../../packages/providers/src/configuration.ts";
import {
  cartesiaVoiceClient,
  SPEECH_AUDIO_TYPES,
  speechToTextContract,
  transcribeSpeech,
  voiceContract,
  type SpeechAudioType,
} from "../../../packages/providers/src/integrations.ts";
import type { ModelAccounting, ModelUsage } from "../../../packages/providers/src/model-accounting.ts";
import { marketingAssistantModel } from "../../../packages/providers/src/marketing-assistant.ts";
import {
  MARKETING_ASSISTANT_LIMITS,
  MARKETING_ASSISTANT_PUBLIC_TEXT,
  screenAssistantReply,
  type AssistantLanguage,
} from "../../../packages/domain/src/marketing-assistant.ts";
import { speechLanguage } from "../../../packages/domain/src/speech-language.ts";
import { followerModelFromSettings } from "../../../packages/domain/src/marketing-calculators.ts";
import { clientSource } from "./auth.ts";
import { publicAvailability, publicPlatform } from "./marketing.ts";
import { requireRecentMfa } from "./security.ts";
import { billableSpeechMs, decodeSpeech } from "./voice-session.ts";

const fail = (statusCode: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { statusCode, code, ...extra });

/** The UAE calendar day (Asia/Dubai, UTC+4 all year). */
export function uaeDay(now = new Date()) {
  return new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}
/** The next midnight in the UAE, when the daily cap resets. */
export function nextUaeMidnight(now = new Date()) {
  const day = new Date(uaeDay(now) + "T00:00:00+04:00");
  return new Date(day.getTime() + 24 * 3600_000).toISOString();
}
/** Daily cap in AED (Super admin setting, default 10). */
export function assistantCapAed(config: RuntimeConfig = runtimeConfig()) {
  const value = Number(config.MARKETING_ASSISTANT_DAILY_AED || 10);
  return Number.isFinite(value) && value >= 0.5 ? Math.min(value, 1000) : 10;
}
const usdToAed = (config: RuntimeConfig) => {
  const rate = Number(config.FINANCE_USD_TO_AED || 3.6725);
  return Number.isFinite(rate) && rate >= 1 && rate <= 10 ? rate : 3.6725;
};
/** What one turn may cost at most, reserved against the cap before it starts (AED). */
export const TURN_RESERVE_AED = 0.25;

/**
 * Whether the assistant may run: switched on, and the AI model, Cartesia
 * voice and speech-to-text connected. Reasons are for Super admin only.
 */
export function assistantReadiness(config: RuntimeConfig = runtimeConfig()) {
  const availability = publicAvailability(config);
  const reasons: string[] = [];
  if (config.MARKETING_ASSISTANT_ENABLED !== "true") reasons.push("Switched off in Settings, Home page voice assistant.");
  if (!availability.model) reasons.push("The AI model is not connected.");
  if (!availability.voice || config.VOICE_PROVIDER !== "cartesia")
    reasons.push("Trainer voice must be connected with Cartesia.");
  if (!integrationCapability("speech_to_text", config)?.approved)
    reasons.push("Speech-to-text is not connected.");
  return { ready: reasons.length === 0, reasons };
}

// The voice named "Kamran" in the account, looked up at most every ten minutes.
let namedVoice: { at: number; key: string; id: string | null } | null = null;
const VOICE_LOOKUP_MS = 10 * 60_000;
/** The chosen voice ID, else the account's voice named Kamran, else null. */
export async function assistantVoiceId(config: RuntimeConfig = runtimeConfig()) {
  const chosen = config.MARKETING_ASSISTANT_VOICE_ID?.trim();
  if (chosen) return chosen;
  const key = `${config.VOICE_BASE_URL ?? ""}|${config.VOICE_API_KEY?.slice(-6) ?? ""}`;
  if (namedVoice && namedVoice.key === key && Date.now() - namedVoice.at < VOICE_LOOKUP_MS)
    return namedVoice.id;
  let id: string | null = null;
  try {
    const voices = await cartesiaVoiceClient(voiceContract()).voicesNamed("Kamran");
    id = voices.find((v) => v.name.trim().toLowerCase() === "kamran")?.id ?? voices[0]?.id ?? null;
  } catch {
    id = null;
  }
  namedVoice = { at: Date.now(), key, id };
  return id;
}
/** Test hook: forget the cached voice lookup. */
export function resetAssistantVoiceCache() {
  namedVoice = null;
}

type DayRow = {
  turns: number;
  model_input_tokens: string | number;
  model_output_tokens: string | number;
  model_usd: string | number;
  stt_seconds: string | number;
  stt_usd: string | number;
  tts_characters: number;
  tts_usd: string | number;
  cost_aed: string | number;
  screened: number;
  handoffs: number;
  refused: number;
};
async function today(tx: Tx, day: string): Promise<DayRow | undefined> {
  const [row] = await tx.query<DayRow>("SELECT * FROM marketing_assistant_days WHERE day=$1", [day]);
  return row;
}
/** Today's spend in AED. */
export async function assistantSpentAed(db: Database, day = uaeDay()) {
  return db.system(async (tx) => Number((await today(tx, day))?.cost_aed ?? 0));
}
/** Shown on the home page: ready and under today's cap. */
export async function assistantAvailable(db: Database, config: RuntimeConfig = runtimeConfig()) {
  if (!assistantReadiness(config).ready) return false;
  try {
    if ((await assistantSpentAed(db)) + TURN_RESERVE_AED > assistantCapAed(config)) return false;
    return !!(await assistantVoiceId(config));
  } catch {
    return false;
  }
}

type Spend = {
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  modelUsd?: number;
  sttSeconds?: number;
  sttUsd?: number;
  ttsCharacters?: number;
  ttsUsd?: number;
  screened?: number;
  handoffs?: number;
  refused?: number;
};
async function addSpend(db: Database, day: string, s: Spend, config: RuntimeConfig) {
  const usd = (s.modelUsd ?? 0) + (s.sttUsd ?? 0) + (s.ttsUsd ?? 0);
  const values = [
    day,
    s.turns ?? 0,
    Math.round(s.inputTokens ?? 0),
    Math.round(s.outputTokens ?? 0),
    s.modelUsd ?? 0,
    Math.round((s.sttSeconds ?? 0) * 1000) / 1000,
    s.sttUsd ?? 0,
    Math.round(s.ttsCharacters ?? 0),
    s.ttsUsd ?? 0,
    Math.round(usd * usdToAed(config) * 10000) / 10000,
    s.screened ?? 0,
    s.handoffs ?? 0,
    s.refused ?? 0,
  ];
  await db.system((tx) =>
    tx.query(
      `INSERT INTO marketing_assistant_days(day,turns,model_input_tokens,model_output_tokens,model_usd,stt_seconds,stt_usd,tts_characters,tts_usd,cost_aed,screened,handoffs,refused)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(day) DO UPDATE SET
         turns=marketing_assistant_days.turns+EXCLUDED.turns,
         model_input_tokens=marketing_assistant_days.model_input_tokens+EXCLUDED.model_input_tokens,
         model_output_tokens=marketing_assistant_days.model_output_tokens+EXCLUDED.model_output_tokens,
         model_usd=marketing_assistant_days.model_usd+EXCLUDED.model_usd,
         stt_seconds=marketing_assistant_days.stt_seconds+EXCLUDED.stt_seconds,
         stt_usd=marketing_assistant_days.stt_usd+EXCLUDED.stt_usd,
         tts_characters=marketing_assistant_days.tts_characters+EXCLUDED.tts_characters,
         tts_usd=marketing_assistant_days.tts_usd+EXCLUDED.tts_usd,
         cost_aed=marketing_assistant_days.cost_aed+EXCLUDED.cost_aed,
         screened=marketing_assistant_days.screened+EXCLUDED.screened,
         handoffs=marketing_assistant_days.handoffs+EXCLUDED.handoffs,
         refused=marketing_assistant_days.refused+EXCLUDED.refused,
         updated_at=now()`,
      values,
    ),
  );
}

/** A keyed hash of the day and a visitor value; never the value itself. */
export function visitorKey(day: string, kind: "address" | "visit", value: string) {
  const secret = process.env.SECURITY_ENCRYPTION_KEY || "marketing-assistant-local";
  return createHmac("sha256", secret).update(`marketing-assistant|${day}|${kind}|${value}`).digest("hex");
}
/** Counts one turn; false when the limit is already reached. Old days are deleted. */
async function countTurn(db: Database, day: string, kind: "address" | "visit", value: string, limit: number) {
  return db.system(async (tx) => {
    await tx.query("DELETE FROM marketing_assistant_counters WHERE day < $1::date - 1", [day]);
    const rows = await tx.query(
      `INSERT INTO marketing_assistant_counters(day,kind,key_hash,turns) VALUES($1,$2,$3,1)
       ON CONFLICT(day,kind,key_hash) DO UPDATE SET turns=marketing_assistant_counters.turns+1
       WHERE marketing_assistant_counters.turns < $4
       RETURNING turns`,
      [day, kind, visitorKey(day, kind, value), limit],
    );
    return rows.length > 0 ? Number((rows[0] as { turns: number }).turns) : null;
  });
}

/** Where a visitor who wants to start goes: sign-up, or early access while registration is closed. */
export function assistantHandoff() {
  return publicPlatform().registrationOpen
    ? { href: "/signup", label: "Start coaching" }
    : { href: "/get-started#early-access", label: "Join early access" };
}
/** Cue-sized clips: the reply's sentences (at most three), spoken separately and joined. */
export function replyClips(text: string) {
  const parts = text.split(/(?<=[.!?؟])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 3 ? [...parts.slice(0, 2), parts.slice(2).join(" ")] : parts;
}

const turnBody = z
  .object({
    visit: z.string().uuid(),
    audio: z.string().min(16).max(900_000),
    type: z.enum(Object.keys(SPEECH_AUDIO_TYPES) as [SpeechAudioType, ...SpeechAudioType[]]),
    durationMs: z.number().int().min(200).max(MARKETING_ASSISTANT_LIMITS.audioSeconds * 1000 + 500),
    lang: z.enum(["en", "ar"]).default("en"),
    history: z
      .array(
        z.object({
          from: z.enum(["visitor", "assistant"]),
          text: z.string().max(MARKETING_ASSISTANT_LIMITS.replyCharacters),
        }),
      )
      .max(MARKETING_ASSISTANT_LIMITS.historyTurns)
      .default([]),
  })
  .strict();

type AdminIdentity = Actor & { platformRole: string; mfaAt?: string | null };

export function registerMarketingAssistant(
  app: FastifyInstance,
  db: Database,
  identity: (request: FastifyRequest) => AdminIdentity,
) {
  // Whether the home page shows the button (the page also reads it from
  // /public/platform); the panel checks again when it opens.
  app.get("/api/v1/public/assistant", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    const available = await assistantAvailable(db);
    return {
      available,
      ...(available ? {} : { hiddenUntil: nextUaeMidnight() }),
      limits: {
        turnsPerVisit: MARKETING_ASSISTANT_LIMITS.turnsPerVisit,
        audioSeconds: MARKETING_ASSISTANT_LIMITS.audioSeconds,
      },
    };
  });

  app.post(
    "/api/v1/public/assistant/turn",
    { bodyLimit: 1024 * 1024, config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const config = runtimeConfig();
      const day = uaeDay();
      if (!assistantReadiness(config).ready)
        throw fail(404, "ASSISTANT_OFF", MARKETING_ASSISTANT_PUBLIC_TEXT.en.unavailable);
      const voiceId = await assistantVoiceId(config);
      if (!voiceId) throw fail(404, "ASSISTANT_OFF", MARKETING_ASSISTANT_PUBLIC_TEXT.en.unavailable);
      const parsed = turnBody.safeParse(req.body);
      if (!parsed.success) throw fail(400, "ASSISTANT_INVALID", MARKETING_ASSISTANT_PUBLIC_TEXT.en.error);
      const b = parsed.data;
      const cap = assistantCapAed(config);
      if ((await assistantSpentAed(db, day)) + TURN_RESERVE_AED > cap) {
        await addSpend(db, day, { refused: 1 }, config);
        throw fail(429, "ASSISTANT_CAP", MARKETING_ASSISTANT_PUBLIC_TEXT.en.unavailable, {
          hiddenUntil: nextUaeMidnight(),
        });
      }
      const address = await countTurn(db, day, "address", clientSource(req), MARKETING_ASSISTANT_LIMITS.turnsPerAddressPerDay);
      const visit = address === null ? null : await countTurn(db, day, "visit", b.visit, MARKETING_ASSISTANT_LIMITS.turnsPerVisit);
      if (address === null || visit === null) {
        await addSpend(db, day, { refused: 1 }, config);
        throw fail(429, "ASSISTANT_LIMIT", MARKETING_ASSISTANT_PUBLIC_TEXT.en.limit);
      }
      // Speech in: held in memory for this request only.
      const audio = decodeSpeech(b.audio, b.type, 640 * 1024);
      const billableMs = billableSpeechMs(audio, b.type, b.durationMs);
      if (billableMs > MARKETING_ASSISTANT_LIMITS.audioSeconds * 1000 + 500) {
        audio.fill(0);
        throw fail(400, "SPEECH_TOO_LONG", MARKETING_ASSISTANT_PUBLIC_TEXT.en.tooLong);
      }
      const stt = speechToTextContract();
      let heard = "";
      try {
        const result = await transcribeSpeech(audio, b.type, async () => {}, {
          language: b.lang,
          maxCharacters: MARKETING_ASSISTANT_LIMITS.transcriptCharacters,
        });
        heard = result.text.replace(/\s+/g, " ").trim();
      } catch {
        audio.fill(0);
        // The provider may have billed the attempt: it counts toward the cap.
        await addSpend(
          db,
          day,
          { turns: 1, sttSeconds: billableMs / 1000, sttUsd: (billableMs / 3_600_000) * stt.pricePerHour },
          config,
        );
        throw fail(502, "TRANSCRIPTION_FAILED", MARKETING_ASSISTANT_PUBLIC_TEXT.en.notHeard);
      } finally {
        audio.fill(0);
      }
      const spend: Spend = {
        turns: 1,
        sttSeconds: billableMs / 1000,
        sttUsd: (billableMs / 3_600_000) * stt.pricePerHour,
      };
      // The model: grounded in the site's own text for this availability.
      let text: string;
      let lang: AssistantLanguage = b.lang;
      let handoff = false;
      if (!heard) {
        text = MARKETING_ASSISTANT_PUBLIC_TEXT[b.lang].notHeard;
      } else {
        const platform = publicPlatform();
        const facts = marketingAssistantFacts({
          origin: config.PUBLIC_APP_URL || "http://localhost:3000",
          appName: platform.name,
          followerModel: platform.followerModel,
          availability: platform.availability,
        });
        const accounting: ModelAccounting = {
          reserve: async () => null,
          record: async (usage: ModelUsage) => {
            spend.inputTokens = (spend.inputTokens ?? 0) + (usage.input ?? 0);
            spend.outputTokens = (spend.outputTokens ?? 0) + (usage.output ?? 0);
            // At the profile's price; a profile without one counts at a
            // high price (USD 5 / 30 per million) so the cap still holds.
            spend.modelUsd =
              (spend.modelUsd ?? 0) +
              (usage.cost ?? ((usage.input ?? 0) * 5 + (usage.output ?? 0) * 30) / 1_000_000);
          },
        };
        try {
          const modelReply = await marketingAssistantModel(
            { appName: platform.name, facts, history: b.history, visitor: heard },
            accounting,
          );
          const screened = screenAssistantReply({
            reply: modelReply,
            facts,
            visitorText: [...b.history.filter((t) => t.from === "visitor").map((t) => t.text), heard].join("\n"),
            frontier: platform.availability.frontier === true,
            followerModel: followerModelFromSettings(config),
          });
          text = screened.text;
          lang = screened.lang;
          handoff = screened.handoff;
          if (screened.replaced) spend.screened = 1;
          if (handoff) spend.handoffs = 1;
        } catch {
          text = MARKETING_ASSISTANT_PUBLIC_TEXT[b.lang].fallback;
          spend.screened = 1;
        }
      }
      // Speech out: cue-sized clips in the chosen voice, joined.
      // The page plays the clips one after another.
      let speech: string[] | null = null;
      try {
        const c = voiceContract();
        const client = cartesiaVoiceClient(c);
        const clips = replyClips(text);
        const parts = await Promise.all(
          clips.map((clip) =>
            client.speech({ voiceId, text: clip, model: c.model, language: speechLanguage(clip) }),
          ),
        );
        speech = parts.map((p) => p.audio.toString("base64"));
        spend.ttsCharacters = clips.reduce((n, clip) => n + clip.length, 0);
        spend.ttsUsd = (spend.ttsCharacters / 1000) * c.price;
      } catch {
        speech = null;
      }
      await addSpend(db, day, spend, config);
      return {
        heard,
        caption: text,
        lang,
        audio: speech,
        audioType: "audio/mpeg",
        handoff: handoff ? assistantHandoff() : null,
        turnsLeft: Math.max(0, MARKETING_ASSISTANT_LIMITS.turnsPerVisit - visit),
      };
    },
  );

  // Super admin: readiness, today's counts and cost, and the voice list.
  app.get("/api/v1/admin/marketing-assistant", async (request) => {
    const actor = identity(request);
    if (actor.platformRole !== "admin") throw fail(403, "ROLE_REQUIRED", "Superadmin access is required.");
    requireRecentMfa(actor, false);
    const config = runtimeConfig();
    const day = uaeDay();
    const { row, revision } = await db.system(async (tx) => {
      const [settings] = await tx.query<{ revision: number }>(
        "SELECT revision FROM platform_settings WHERE integration_id='marketing_assistant'",
      );
      return { row: await today(tx, day), revision: settings?.revision ?? 0 };
    });
    let voices: Array<{ id: string; name: string }> | null = null;
    let voicesError: string | null = null;
    try {
      voices = (await cartesiaVoiceClient(voiceContract()).ownVoices()).map((v) => ({ id: v.id, name: v.name }));
    } catch {
      voicesError = "The voice list could not be read. Connect Trainer voice with Cartesia in Settings.";
    }
    const chosen = config.MARKETING_ASSISTANT_VOICE_ID?.trim() || null;
    const named = voices?.find((v) => v.name.trim().toLowerCase() === "kamran") ?? null;
    const n = (v: unknown) => Number(v ?? 0);
    const cap = assistantCapAed(config);
    return {
      settings: {
        enabled: config.MARKETING_ASSISTANT_ENABLED === "true",
        dailyCapAed: cap,
        voiceId: chosen,
      },
      revision,
      readiness: assistantReadiness(config),
      voices,
      voicesError,
      defaultVoice: named,
      voiceInUse: chosen ?? named?.id ?? null,
      today: {
        day,
        turns: n(row?.turns),
        costAed: n(row?.cost_aed),
        capAed: cap,
        capReached: n(row?.cost_aed) + TURN_RESERVE_AED > cap,
        hiddenUntil: n(row?.cost_aed) + TURN_RESERVE_AED > cap ? nextUaeMidnight() : null,
        modelInputTokens: n(row?.model_input_tokens),
        modelOutputTokens: n(row?.model_output_tokens),
        modelUsd: n(row?.model_usd),
        sttSeconds: n(row?.stt_seconds),
        sttUsd: n(row?.stt_usd),
        ttsCharacters: n(row?.tts_characters),
        ttsUsd: n(row?.tts_usd),
        screened: n(row?.screened),
        handoffs: n(row?.handoffs),
        refused: n(row?.refused),
      },
    };
  });
}
