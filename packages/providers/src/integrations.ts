import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  ConfigurationError,
  providerRequest,
  runtimeConfig,
} from "./configuration.ts";

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
  const base =
    provider === "whoop" ? "https://api.prod.whoop.com" : c.ZEPP_API_BASE_URL;
  const authorize =
    provider === "whoop"
      ? "https://api.prod.whoop.com/oauth/oauth2/auth"
      : c.ZEPP_AUTHORIZE_URL;
  const token =
    provider === "whoop"
      ? "https://api.prod.whoop.com/oauth/oauth2/token"
      : c.ZEPP_TOKEN_URL;
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

export function voiceContract() {
  const c = runtimeConfig();
  if (
    c.VOICE_CONTRACT_VERIFIED !== "true" ||
    c.VOICE_PROVIDER !== "elevenlabs" ||
    !c.VOICE_API_KEY ||
    !c.VOICE_MODEL ||
    !c.VOICE_PRICE_VERSION ||
    !c.VOICE_BASE_URL
  )
    throw new ConfigurationError(
      "Trainer voice requires an approved ElevenLabs account, model, price and rights contract.",
    );
  const price = Number(c.VOICE_USD_PER_1000_CHARACTERS),
    cap = Number(c.VOICE_DAILY_USD_LIMIT);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(cap) || cap <= 0)
    throw new ConfigurationError(
      "Reviewed voice pricing and a daily USD cap are required.",
    );
  return {
    base: c.VOICE_BASE_URL.replace(/\/$/, ""),
    key: c.VOICE_API_KEY,
    model: c.VOICE_MODEL,
    price,
    cap,
    priceVersion: c.VOICE_PRICE_VERSION,
  };
}
export async function generateTrainerVoice(
  voiceId: string,
  text: string,
  beforeSend: () => Promise<void>,
) {
  const c = voiceContract();
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
      body: JSON.stringify({ text, model_id: c.model }),
    },
    beforeSend,
  );
  if (!response.ok)
    throw new ConfigurationError(
      "Voice generation could not be confirmed. Use written guidance while the request is reconciled.",
    );
  const audio = Buffer.from(await response.arrayBuffer());
  if (
    !audio.length ||
    audio.length > 2097152 ||
    !/^audio\/(mpeg|mp3)(;|$)/.test(response.headers.get("content-type") ?? "")
  )
    throw new ConfigurationError("Provider returned unsupported audio.");
  return {
    audio,
    requestId:
      response.headers.get("request-id") ??
      response.headers.get("x-request-id"),
    estimatedCost: (text.length * c.price) / 1000,
    priceVersion: c.priceVersion,
  };
}
