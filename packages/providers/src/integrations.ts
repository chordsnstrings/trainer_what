import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  ConfigurationError,
  providerRequest,
  runtimeConfig,
} from "./configuration.ts";
import { sandboxOverride } from "./sandbox.ts";
import { speechLanguage } from "../../domain/src/speech-language.ts";
import {
  CARTESIA_API_VERSION,
  CARTESIA_BASE_URL,
  CARTESIA_STT_MODEL,
  CartesiaClient,
  CartesiaError,
} from "./cartesia.ts";

type FixtureTransport = (value: string, init: RequestInit) => Promise<Response>;
const fixtureTransport = new AsyncLocalStorage<FixtureTransport>();
// Explicit unit-test injection; unavailable in production or ordinary processes.
export function withIntegrationFixtureTransport<T>(
  transport: FixtureTransport,
  callback: () => T,
): T {
  if (!process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === "production")
    throw new ConfigurationError(
      "Fixture transport is unavailable outside the isolated Node test runner.",
    );
  return fixtureTransport.run(transport, callback);
}
export async function integrationRequest(
  value: string,
  init: RequestInit = {},
  beforeSend?: () => Promise<void>,
) {
  const fixture = fixtureTransport.getStore();
  if (!fixture) return providerRequest(value, init, beforeSend);
  if (!process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === "production")
    throw new ConfigurationError(
      "Fixture transport cannot be used in production.",
    );
  await beforeSend?.();
  const response = await fixture(value, { ...init, redirect: "error" });
  if (response.redirected || (response.status >= 300 && response.status < 400))
    throw new ConfigurationError("Provider redirects are not accepted");
  return response;
}

export type WearableProvider = "whoop" | "zepp";
const tokenSchema = z.object({
  access_token: z.string().min(1).max(16000),
  refresh_token: z.string().max(16000).optional(),
  expires_in: z.number().positive().max(31536000),
  scope: z.string().default(""),
});
export type OAuthTokens = z.infer<typeof tokenSchema> & { obtainedAt: number };
export const observationSchema = z.object({
  id: z.string().min(1).max(300),
  type: z.enum([
    "recovery_score",
    "sleep_seconds",
    "strain",
    "average_heart_rate",
    "max_heart_rate",
    "steps",
    "energy_kj",
  ]),
  value: z.number().finite().min(0).max(1e10),
  unit: z.string().min(1).max(30),
  measuredAt: z.iso.datetime(),
  sourceVersion: z.string().max(100).default("v2"),
});
export type Observation = z.infer<typeof observationSchema>;

export function wearableContract(provider: WearableProvider) {
  const c = runtimeConfig(),
    prefix = provider.toUpperCase();
  if (c[`${prefix}_CONTRACT_VERIFIED`] !== "true")
    throw new ConfigurationError(
      "This provider requires account contract and data-use approval before connection.",
    );
  const id = c[`${prefix}_CLIENT_ID`],
    secret = c[`${prefix}_CLIENT_SECRET`],
    redirect = c[`${prefix}_REDIRECT_URI`];
  if (!id || !secret || !redirect)
    throw new ConfigurationError("Complete the provider OAuth settings first.");
  const scopes = (
    c[`${prefix}_SCOPES`] ||
    (provider === "whoop"
      ? "offline read:recovery read:sleep read:workout"
      : "")
  )
    .split(/\s+/)
    .filter(Boolean);
  if (!scopes.length)
    throw new ConfigurationError("Approved provider scopes are required.");
  if (
    provider === "whoop" &&
    (!scopes.includes("offline") || !scopes.some((s) => s.startsWith("read:")))
  )
    throw new ConfigurationError(
      "Durable WHOOP sync requires offline and at least one approved read scope.",
    );
  if (
    provider === "whoop" &&
    scopes.some(
      (s) =>
        ![
          "offline",
          "read:recovery",
          "read:sleep",
          "read:workout",
          "read:cycles",
        ].includes(s),
    )
  )
    throw new ConfigurationError(
      "The requested WHOOP scope is outside this adapter's data-use contract.",
    );
  if (
    provider === "zepp" &&
    c.ZEPP_ADAPTER_CONTRACT !== "canonical-observations-v1"
  )
    throw new ConfigurationError(
      "An approved Zepp partner must implement the documented canonical-observations-v1 adapter contract.",
    );
  // Only the local mock-provider sandbox (sandbox.ts) can replace the WHOOP host.
  const whoop = (
    sandboxOverride("WHOOP_API_BASE_URL")?.origin ?? "https://api.prod.whoop.com"
  ).replace(/\/$/, "");
  const base = provider === "whoop" ? whoop : c.ZEPP_API_BASE_URL;
  const authorize =
    provider === "whoop" ? whoop + "/oauth/oauth2/auth" : c.ZEPP_AUTHORIZE_URL;
  const token =
    provider === "whoop" ? whoop + "/oauth/oauth2/token" : c.ZEPP_TOKEN_URL;
  if (!base || !authorize || !token)
    throw new ConfigurationError(
      "The approved partner endpoint configuration is incomplete.",
    );
  return {
    id,
    secret,
    redirect,
    scopes,
    base: base.replace(/\/$/, ""),
    authorize,
    token,
  };
}

export function wearableAuthorization(
  provider: WearableProvider,
  state: string,
  challenge: string,
) {
  const c = wearableContract(provider),
    url = new URL(c.authorize);
  url.search = new URLSearchParams({
    client_id: c.id,
    redirect_uri: c.redirect,
    response_type: "code",
    scope: c.scopes.join(" "),
    state,
    ...(provider === "zepp"
      ? { code_challenge: challenge, code_challenge_method: "S256" }
      : {}),
  }).toString();
  return url.toString();
}

export async function exchangeWearableToken(
  provider: WearableProvider,
  grant: { code: string; verifier: string } | { refreshToken: string },
  beforeSend?: () => Promise<void>,
) {
  const c = wearableContract(provider);
  const response = await integrationRequest(
    c.token,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.id,
        client_secret: c.secret,
        ...("code" in grant
          ? {
              grant_type: "authorization_code",
              code: grant.code,
              redirect_uri: c.redirect,
              ...(provider === "zepp" ? { code_verifier: grant.verifier } : {}),
            }
          : {
              grant_type: "refresh_token",
              refresh_token: grant.refreshToken,
              scope: provider === "whoop" ? "offline" : c.scopes.join(" "),
            }),
      }).toString(),
    },
    beforeSend,
  );
  if (!response.ok)
    throw new ConfigurationError(
      `Provider token exchange failed (HTTP ${response.status}); reconnect if authorization expired.`,
    );
  return {
    ...tokenSchema.parse(await response.json()),
    obtainedAt: Date.now(),
  };
}

export async function revokeWearableToken(
  provider: WearableProvider,
  accessToken: string,
) {
  const c = wearableContract(provider);
  const response = await integrationRequest(
    c.base +
      (provider === "whoop" ? "/developer/v2/user/access" : "/v1/connection"),
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok)
    throw new ConfigurationError(
      "Provider revocation is awaiting confirmation.",
    );
}

export async function fetchWearableObservations(
  provider: WearableProvider,
  accessToken: string,
  since: string,
  beforeSend?: () => Promise<void>,
): Promise<Observation[]> {
  const c = wearableContract(provider),
    observations: Observation[] = [];
  const paths =
    provider === "whoop"
      ? [
          ["read:recovery", "recovery"],
          ["read:sleep", "activity/sleep"],
          ["read:workout", "activity/workout"],
          ["read:cycles", "cycle"],
        ]
          .filter(([permission]) => c.scopes.includes(permission))
          .map(([, path]) => path)
      : ["observations"];
  for (const path of paths) {
    let page = "";
    const seen = new Set<string>();
    for (let count = 0; count < 20; count++) {
      const url = new URL(
        c.base + (provider === "whoop" ? "/developer/v2/" : "/v1/") + path,
      );
      url.searchParams.set(provider === "whoop" ? "start" : "since", since);
      url.searchParams.set("limit", "25");
      if (page) url.searchParams.set("nextToken", page);
      const response = await integrationRequest(
        url.toString(),
        { headers: { Authorization: `Bearer ${accessToken}` } },
        beforeSend,
      );
      if (!response.ok)
        throw new ConfigurationError(
          `Wearable synchronization failed (HTTP ${response.status}).`,
        );
      const body = (await response.json()) as any;
      if (!Array.isArray(body.records) || body.records.length > 100)
        throw new ConfigurationError(
          "Provider returned an invalid observation page.",
        );
      for (const row of body.records) {
        if (provider === "zepp") {
          observations.push(observationSchema.parse(row));
          continue;
        }
        if (row.score_state !== "SCORED" || !row.score) continue;
        const measuredAt = new Date(
          row.end ?? row.created_at ?? row.updated_at,
        ).toISOString();
        const metric = (
          type: Observation["type"],
          value: unknown,
          unit: string,
        ) => {
          if (typeof value === "number" && Number.isFinite(value))
            observations.push(
              observationSchema.parse({
                id: `${path}:${row.id ?? row.cycle_id}:${type}`,
                type,
                value,
                unit,
                measuredAt,
                sourceVersion: "whoop-v2",
              }),
            );
        };
        if (path === "recovery")
          metric("recovery_score", row.score.recovery_score, "percent");
        if (path === "activity/sleep") {
          const s = row.score.stage_summary;
          if (s)
            metric(
              "sleep_seconds",
              (Number(s.total_light_sleep_time_milli) +
                Number(s.total_slow_wave_sleep_time_milli) +
                Number(s.total_rem_sleep_time_milli)) /
                1000,
              "seconds",
            );
        }
        if (path === "activity/workout" || path === "cycle") {
          metric("strain", row.score.strain, "score");
          metric("average_heart_rate", row.score.average_heart_rate, "bpm");
          metric("max_heart_rate", row.score.max_heart_rate, "bpm");
          metric("energy_kj", row.score.kilojoule, "kJ");
        }
      }
      page = typeof body.next_token === "string" ? body.next_token : "";
      if (!page) break;
      if (seen.has(page) || count === 19)
        throw new ConfigurationError(
          "Provider pagination exceeded safe bounds; narrow the synchronization range.",
        );
      seen.add(page);
    }
  }
  return observations;
}

/** The implemented voice providers (Superadmin setting VOICE_PROVIDER). */
export const VOICE_PROVIDERS = ["elevenlabs", "cartesia"] as const;
export type VoiceProvider = (typeof VOICE_PROVIDERS)[number];
const PROVIDER_BASE: Record<VoiceProvider, string> = {
  elevenlabs: "https://api.elevenlabs.io/v1",
  cartesia: CARTESIA_BASE_URL,
};
export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return VOICE_PROVIDERS.includes(value as VoiceProvider);
}
/**
 * The API address for a provider: the saved one, or the provider's standard
 * address when none is saved or the saved one is another provider's standard
 * address (an operator switching provider keeps a working default).
 */
export function voiceBaseUrl(provider: VoiceProvider, saved: string | undefined) {
  const value = (saved ?? "").trim().replace(/\/$/, "");
  return !value || Object.values(PROVIDER_BASE).includes(value)
    ? PROVIDER_BASE[provider]
    : value;
}
const API_VERSION = /^\d{4}-\d{2}-\d{2}$/;
/** Cartesia-Version header: the saved value or the reviewed default. */
export function cartesiaVersion(saved: string | undefined) {
  const value = (saved ?? "").trim();
  if (!value) return CARTESIA_API_VERSION;
  if (!API_VERSION.test(value))
    throw new ConfigurationError(
      "The Cartesia API version must look like 2026-08-14.",
    );
  return value;
}
const flag = (value: string | undefined, fallback: boolean) =>
  value === "true" ? true : value === "false" ? false : fallback;

export function voiceContract() {
  const c = runtimeConfig();
  const provider = c.VOICE_PROVIDER;
  if (
    c.VOICE_CONTRACT_VERIFIED !== "true" ||
    !isVoiceProvider(provider) ||
    !c.VOICE_API_KEY ||
    !c.VOICE_MODEL ||
    !c.VOICE_PRICE_VERSION
  )
    throw new ConfigurationError(
      "Trainer voice requires an approved ElevenLabs or Cartesia account, model, price and rights contract.",
    );
  const price = Number(c.VOICE_USD_PER_1000_CHARACTERS),
    cap = Number(c.VOICE_DAILY_USD_LIMIT),
    cloneUsd = Number(c.VOICE_CLONE_USD || 0),
    proPrice = Number(c.VOICE_PRO_CLONE_PRICE_AED || 0),
    proSlots = Number(c.VOICE_PRO_CLONE_SLOTS ?? 2);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(cap) || cap <= 0)
    throw new ConfigurationError(
      "Reviewed voice pricing and a daily USD cap are required.",
    );
  const cartesia = provider === "cartesia";
  return {
    provider,
    base: voiceBaseUrl(provider, c.VOICE_BASE_URL),
    key: c.VOICE_API_KEY,
    model: c.VOICE_MODEL,
    price,
    cap,
    priceVersion: c.VOICE_PRICE_VERSION,
    apiVersion: cartesia ? cartesiaVersion(c.VOICE_API_VERSION) : null,
    /** Clones are made through the app only with Cartesia. */
    cloning: {
      quick: cartesia && flag(c.VOICE_QUICK_CLONE_ENABLED, true),
      pro: cartesia && flag(c.VOICE_PRO_CLONE_ENABLED, false),
      proSlots: Number.isInteger(proSlots) && proSlots > 0 ? proSlots : 0,
      proPriceAed: Number.isFinite(proPrice) && proPrice > 0 ? proPrice : null,
      cloneUsd: Number.isFinite(cloneUsd) && cloneUsd >= 0 ? cloneUsd : 0,
      // On until the owner decides otherwise: an operator checks identity and
      // rights before members hear a clone, as for linked ElevenLabs voices.
      reviewRequired: flag(c.VOICE_CLONE_REVIEW_REQUIRED, false),
      providerTrainingOptOut: flag(c.VOICE_TRAINING_OPT_OUT, false),
    },
  };
}
export type VoiceContract = ReturnType<typeof voiceContract>;
/** The approved Cartesia account for clone work, or ConfigurationError. */
export function cartesiaVoiceClient(contract: VoiceContract = voiceContract()) {
  if (contract.provider !== "cartesia" || !contract.apiVersion)
    throw new ConfigurationError(
      "Voice clones are made through the app only with the Cartesia provider.",
    );
  return new CartesiaClient(
    { base: contract.base, key: contract.key, version: contract.apiVersion },
    integrationRequest,
  );
}
/**
 * A Cartesia client for deleting what trainer voice clones left at the
 * provider, built from the saved voice settings whether or not the voice
 * integration is active: a paused contract, a pending connection check or a
 * disabled switch never stops a deletion the trainer was promised. Null when
 * the saved provider is not Cartesia or no key is saved. Never used to make
 * anything.
 */
export function cartesiaDeletionClient(values: Record<string, string | undefined>) {
  if (values.VOICE_PROVIDER !== "cartesia" || !values.VOICE_API_KEY) return null;
  let version: string;
  try {
    version = cartesiaVersion(values.VOICE_API_VERSION);
  } catch {
    version = CARTESIA_API_VERSION;
  }
  return new CartesiaClient(
    {
      base: voiceBaseUrl("cartesia", values.VOICE_BASE_URL),
      key: values.VOICE_API_KEY,
      version,
    },
    integrationRequest,
  );
}
/**
 * Speaks one line in a trainer voice. `voice.provider` is the provider that
 * holds the voice: a voice of another provider is never sent (its ID means
 * nothing there and the attempt would only add an unknown cost).
 * `voice.language` is the language the voice was recorded in and is not sent:
 * Cartesia reads `language` as the language of the text, which is
 * `textLanguage` when the caller fixes it (the English preview line), else the
 * line's own language (`speechLanguage`): session scripts are English code
 * lines plus the trainer's phrases and plan cues, which may be Arabic, and an
 * Arabic line sent as English is read with English phonetics.
 */
export async function generateTrainerVoice(
  voiceId: string,
  text: string,
  beforeSend: () => Promise<void>,
  voice: {
    provider?: string | null;
    model?: string | null;
    language?: string | null;
    textLanguage?: string;
  } = {},
) {
  const c = voiceContract();
  if ((voice.provider ?? "elevenlabs") !== c.provider)
    throw new ConfigurationError(
      "This trainer voice belongs to another voice provider.",
    );
  const model = voice.model || c.model;
  let audio: Buffer, contentType: string, requestId: string | null;
  if (c.provider === "cartesia") {
    try {
      ({ audio, contentType, requestId } = await cartesiaVoiceClient(c).speech(
        { voiceId, text, model, language: voice.textLanguage ?? speechLanguage(text) },
        beforeSend,
      ));
    } catch (error) {
      if (!(error instanceof CartesiaError)) throw error;
      throw new ConfigurationError(
        "Voice generation could not be confirmed. Use written guidance while the request is reconciled.",
      );
    }
  } else {
    const response = await integrationRequest(
      c.base +
        "/text-to-speech/" +
        encodeURIComponent(voiceId) +
        "?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: {
          "xi-api-key": c.key,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: model }),
      },
      beforeSend,
    );
    if (!response.ok)
      throw new ConfigurationError(
        "Voice generation could not be confirmed. Use written guidance while the request is reconciled.",
      );
    audio = Buffer.from(await response.arrayBuffer());
    contentType = response.headers.get("content-type") ?? "";
    requestId =
      response.headers.get("request-id") ?? response.headers.get("x-request-id");
  }
  if (
    !audio.length ||
    audio.length > 2097152 ||
    !/^audio\/(mpeg|mp3)(;|$)/.test(contentType)
  )
    throw new ConfigurationError("Provider returned unsupported audio.");
  return {
    audio,
    requestId,
    provider: c.provider,
    model,
    estimatedCost: (text.length * c.price) / 1000,
    priceVersion: c.priceVersion,
  };
}

/**
 * The app cannot ask Cartesia for zero retention (it is an Enterprise account
 * setting), so a zero-retention request is never silently dropped: the
 * speech-to-text contract stays unapproved until the operator turns it off.
 */
export const CARTESIA_ZERO_RETENTION =
  "Cartesia zero retention is an Enterprise account setting the app cannot request. Turn off Request zero retention to use Cartesia speech-to-text; members are told the provider's own retention applies.";
/** Approved speech-to-text account (ElevenLabs or Cartesia), or ConfigurationError. */
export function speechToTextContract() {
  const c = runtimeConfig();
  const provider = c.STT_PROVIDER;
  if (
    c.STT_CONTRACT_VERIFIED !== "true" ||
    !isVoiceProvider(provider) ||
    !c.STT_API_KEY ||
    !c.STT_PRICE_VERSION
  )
    throw new ConfigurationError(
      "Spoken replies need an approved speech-to-text account, model, price and audio processing contract.",
    );
  const pricePerHour = Number(c.STT_USD_PER_HOUR);
  if (!Number.isFinite(pricePerHour) || pricePerHour < 0)
    throw new ConfigurationError("A reviewed speech-to-text price is required.");
  if (provider === "cartesia" && c.STT_ZERO_RETENTION === "true")
    throw new ConfigurationError(CARTESIA_ZERO_RETENTION);
  return {
    provider,
    base: voiceBaseUrl(provider, c.STT_BASE_URL),
    key: c.STT_API_KEY,
    model: speechModel(provider, c.STT_MODEL),
    pricePerHour,
    priceVersion: c.STT_PRICE_VERSION,
    zeroRetention: c.STT_ZERO_RETENTION === "true",
    apiVersion:
      provider === "cartesia" ? cartesiaVersion(c.STT_API_VERSION) : null,
  };
}
/** The saved transcription model, or the provider's batch model. */
export function speechModel(provider: VoiceProvider, saved: string | undefined) {
  const value = (saved ?? "").trim();
  const defaults: Record<VoiceProvider, string> = {
    elevenlabs: "scribe_v1",
    cartesia: CARTESIA_STT_MODEL,
  };
  return !value || Object.values(defaults).includes(value)
    ? defaults[provider]
    : value;
}
export const SPEECH_AUDIO_TYPES = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
} as const;
export type SpeechAudioType = keyof typeof SPEECH_AUDIO_TYPES;
/**
 * Sends one short audio chunk for transcription. The audio is held in memory
 * for this request only; nothing is written to storage or logs.
 */
export async function transcribeSpeech(
  audio: Buffer,
  type: SpeechAudioType,
  beforeSend: () => Promise<void>,
  options: { language?: "en" | "ar" } = {},
) {
  const c = speechToTextContract();
  if (c.provider === "cartesia") {
    try {
      const result = await new CartesiaClient(
        { base: c.base, key: c.key, version: c.apiVersion! },
        integrationRequest,
      ).transcribe(
        {
          audio,
          type,
          extension: SPEECH_AUDIO_TYPES[type],
          model: c.model,
          // Batch ink-whisper does not detect the language (it defaults to
          // English), and replies are parsed in English and Arabic
          // (packages/domain/src/voice-runner.ts, safetySignal): the member's
          // language decides. ElevenLabs detects it itself.
          language: options.language ?? "en",
        },
        beforeSend,
      );
      return {
        text: result.text.slice(0, 500),
        durationSeconds: result.durationSeconds,
        languageCode: result.language,
        requestId: result.requestId,
        provider: c.provider,
        priceVersion: c.priceVersion,
      };
    } catch (error) {
      if (!(error instanceof CartesiaError)) throw error;
      throw new ConfigurationError(
        "Transcription could not be confirmed. Use the buttons or say it again.",
      );
    }
  }
  const boundary = "trainer" + Math.random().toString(36).slice(2, 14);
  const part = (name: string, value: string) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const body = Buffer.concat([
    Buffer.from(
      part("model_id", c.model) +
        part("tag_audio_events", "false") +
        part("diarize", "false") +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="reply.${SPEECH_AUDIO_TYPES[type]}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    audio,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await integrationRequest(
    c.base +
      "/speech-to-text" +
      (c.zeroRetention ? "?enable_logging=false" : ""),
    {
      method: "POST",
      headers: {
        "xi-api-key": c.key,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(body.length),
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(20000),
    },
    beforeSend,
  );
  if (!response.ok)
    throw new ConfigurationError(
      "Transcription could not be confirmed. Use the buttons or say it again.",
    );
  const payload = (await response.json().catch(() => null)) as any;
  if (!payload || typeof payload.text !== "string")
    throw new ConfigurationError(
      "The speech provider returned an unexpected result.",
    );
  // The end of the last recognised word: a lower bound of the audio the
  // provider billed, kept for reconciliation.
  const ends = (Array.isArray(payload.words) ? payload.words : [])
    .map((w: any) => Number(w?.end))
    .filter((n: number) => Number.isFinite(n) && n >= 0 && n < 86400);
  return {
    text: payload.text.slice(0, 500),
    durationSeconds: ends.length ? Math.max(...ends) : null,
    languageCode:
      typeof payload.language_code === "string"
        ? payload.language_code.slice(0, 12)
        : null,
    requestId:
      response.headers.get("request-id") ??
      response.headers.get("x-request-id"),
    provider: c.provider,
    priceVersion: c.priceVersion,
  };
}
