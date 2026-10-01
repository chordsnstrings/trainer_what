import {
  markRuntimeConfig,
  providerRequest,
  runtimeConfig,
  runtimeScopeActive,
  withRuntimeConfig,
  type RuntimeConfig,
} from "./configuration.ts";
import {
  completionUsage,
  defaultMaxTokens,
  jsonModeOn,
  learnModelRequestStyle,
  MODEL_CALL_TIMEOUT_CAP_MS,
  MODEL_PROFILE_KEYS,
  modelAdapter,
  modelFamily,
  modelReasoningEffort,
  modelReasoningEffortSetting,
  otherRequestStyle,
  providerErrorFields,
  refusedStyleParameter,
  resolveModelRequestStyle,
  retryAfterRefusal,
  sendsTemperature,
  styleRequestBody,
  type ModelRequestStyle,
  type RequestAttempt,
} from "./model-request.ts";
import {
  ANTHROPIC_VERSION,
  anthropicChatCompletion,
  anthropicRefusedParameter,
  anthropicReportsUsage,
  anthropicRequestBody,
  type AnthropicOptional,
} from "./anthropic-messages.ts";
export type ModelUsage = {
  model: string;
  input: number | null;
  /** Output tokens billed, reasoning included (see completionUsage). */
  output: number | null;
  cost: number | null;
  requestId: string | null;
  priceVersion: string | null;
  pricing: {
    inputUsdPerMillion: number | null;
    outputUsdPerMillion: number | null;
    /** Only when the profile sets cache prices. */
    cacheReadUsdPerMillion?: number | null;
    cacheWriteUsdPerMillion?: number | null;
  };
  /** Reasoning tokens the provider reported (part of `output`), if any. */
  reasoning?: number | null;
  /**
   * Prompt tokens read from and written to the provider's prompt cache (part
   * of `input`); present only when reported. Priced at the profile's cache
   * prices when set, else at the input price.
   */
  cache?: { read: number; write: number };
  /** The model profile that answered (Super admin label, never shown with the model ID to coaches). */
  profile?: { id: string | null; label: string | null };
  /** True when the fallback profile answered: the answer always goes to the coach. */
  fallback?: boolean;
  /**
   * The request style of the call whose usage this is, where it came from
   * (refusal_retry: the one retry after the provider refused
   * `retriedAfterRefusal`), and the reasoning effort that request sent
   * (docs/features/model-gateway.md).
   */
  request?: {
    style: ModelRequestStyle;
    source: "setting" | "learned" | "model_name" | "refusal_retry";
    retriedAfterRefusal: string | null;
    reasoningEffort?: string | null;
  };
};
/** A reviewed token price in effect for the provider and model of one call. */
export type ModelPrice = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  priceVersion: string;
};
export type ModelAccounting = {
  /**
   * Reserves the call before it is sent. May return the reviewed price in
   * effect for this provider and model (the Super admin's model price table);
   * without one, the AI model settings' price applies.
   */
  reserve: (model: string) => Promise<void | ModelPrice | null>;
  record: (usage: ModelUsage) => Promise<void>;
  /**
   * A fresh accounting for the same task, offered only where a fallback
   * profile may answer (never for evaluations and checks, which must reflect
   * the active model). Without it a failed call is never retried elsewhere.
   */
  fallback?: () => ModelAccounting;
};
const KNOWN_MODEL_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)openai\.com$/, "openai"],
  [/(^|\.)anthropic\.com$/, "anthropic"],
  [/(^|\.)openrouter\.ai$/, "openrouter"],
  [/(^|\.)googleapis\.com$/, "google"],
  [/(^|\.)mistral\.ai$/, "mistral"],
  [/(^|\.)groq\.com$/, "groq"],
  [/(^|\.)deepseek\.com$/, "deepseek"],
  [/(^|\.)together\.(xyz|ai)$/, "together"],
  [/(^|\.)x\.ai$/, "xai"],
  [/(^|\.)fireworks\.ai$/, "fireworks"],
  [/(^|\.)azure\.com$/, "azure"],
];
/**
 * The provider recorded on AI cost rows: the "Provider name" setting, else a
 * name read from the API address (api.openai.com is "openai"), else its host.
 */
export function modelProviderName(config = runtimeConfig()) {
  const named = config.MODEL_PROVIDER?.trim().toLowerCase();
  if (named && /^[a-z0-9][a-z0-9._-]{0,59}$/.test(named)) return named;
  let host = "";
  try {
    host = new URL(config.MODEL_BASE_URL ?? "").hostname.toLowerCase();
  } catch {}
  for (const [pattern, name] of KNOWN_MODEL_HOSTS)
    if (pattern.test(host)) return name;
  return /^[a-z0-9][a-z0-9.-]{0,59}$/.test(host) ? host : "unnamed-provider";
}
const price = (value: string | undefined) =>
  value?.trim() && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value)
    : null;
const tokens = (value: unknown): number | null =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 2147483647
    ? value
    : null;

/** Whether a provider body reports any token usage (a billed call). */
const reportsUsage = (payload: any) =>
  tokens(payload?.usage?.prompt_tokens) !== null ||
  tokens(payload?.usage?.completion_tokens) !== null ||
  anthropicReportsUsage(payload);

// Accounting is mandatory and starts immediately before sending, after local validation.
// Response accounting finishes before any model-authored content is parsed or persisted.
//
// The request goes out through the active model profile (its adapter, request
// style and request settings; model-request.ts, anthropic-messages.ts). A
// provider refusal of a parameter the request controls (HTTP 400 naming
// max_tokens, temperature, max_completion_tokens or an automatic reasoning
// effort, with no usage reported) is retried once within the same time
// limit: in the other style when the style is automatic, or without the
// automatic parameter the provider refused. The retry belongs to the same
// reservation: one call, one usage row, which records the retried call's
// usage and the request that answered.
//
// When the provider is unavailable (no answer, HTTP 408, 429 or 5xx) and a
// fallback profile is set, the call is sent once to the fallback profile
// within what is left of the same time limit, with its own reservation and
// usage row, but only where the caller offers a fallback accounting (never
// for evaluations and checks). A fallback answer marks the request's scope:
// every qualification pin read afterwards in it differs (modelRequestPin), so
// nothing it produced is delivered automatically; it goes to the coach.
export async function modelCompletion(
  base: string,
  key: string,
  model: string,
  body: Record<string, unknown>,
  accounting: ModelAccounting,
  options: { timeoutMs?: number } = {},
) {
  const config = runtimeConfig();
  const timeoutMs = Math.min(
    MODEL_CALL_TIMEOUT_CAP_MS,
    Math.max(1000, options.timeoutMs ?? 30000),
  );
  const started = Date.now();
  try {
    return await completeOnce(config, base, key, model, body, accounting, timeoutMs);
  } catch (error) {
    const fallback = fallbackProfile(config);
    const remaining = timeoutMs - (Date.now() - started);
    if (
      !fallback ||
      !accounting.fallback ||
      !fallbackEligible(error) ||
      remaining < FALLBACK_MIN_MS ||
      !runtimeScopeActive()
    )
      throw error;
    let result: Awaited<ReturnType<typeof completeOnce>>;
    try {
      result = await withRuntimeConfig(fallback, () =>
        completeOnce(
          runtimeConfig(),
          fallback.MODEL_BASE_URL!,
          fallback.MODEL_API_KEY!,
          fallback.MODEL_NAME!,
          body,
          accounting.fallback!(),
          remaining,
        ),
      );
    } catch {
      // The caller sees the active profile's failure.
      throw error;
    }
    markRuntimeConfig({ [MODEL_PROFILE_KEYS.fallbackAnswered]: "true" });
    return { payload: result.payload, usage: { ...result.usage, fallback: true } };
  }
}

/** The fallback must leave time for an answer within the call's own limit. */
const FALLBACK_MIN_MS = 5000;
const FALLBACK_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
function fallbackEligible(error: unknown) {
  const e = error as { providerStatus?: unknown; providerUnreachable?: unknown; code?: unknown };
  if (e?.providerUnreachable === true) return true;
  return typeof e?.providerStatus === "number" && FALLBACK_STATUSES.has(e.providerStatus);
}
/** The fallback profile's runtime keys, when one is set and complete. */
export function fallbackProfile(config: RuntimeConfig): RuntimeConfig | null {
  const text = config[MODEL_PROFILE_KEYS.fallback]?.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    const values: RuntimeConfig = {};
    for (const [k, v] of Object.entries(parsed))
      if (/^MODEL_[A-Z0-9_]+$/.test(k) && typeof v === "string") values[k] = v;
    if (!values.MODEL_BASE_URL || !values.MODEL_API_KEY || !values.MODEL_NAME) return null;
    if (
      values.MODEL_BASE_URL === config.MODEL_BASE_URL &&
      values.MODEL_NAME === config.MODEL_NAME
    )
      return null;
    // The fallback never has a fallback of its own.
    return { ...values, [MODEL_PROFILE_KEYS.fallback]: "" };
  } catch {
    return null;
  }
}

/**
 * The app's request with the profile's request settings applied, before the
 * request style: the call's temperature only when the profile sends
 * temperatures, JSON mode only when it is on, and the profile's default
 * answer limit for a call that sets none. With no profile keys (the default)
 * the request is unchanged.
 */
function profileRequest(body: Record<string, unknown>, config: RuntimeConfig) {
  const out = { ...body };
  if (!sendsTemperature(config)) delete out.temperature;
  if (
    !jsonModeOn(config) &&
    (out.response_format as { type?: string } | undefined)?.type === "json_object"
  )
    delete out.response_format;
  const limit = defaultMaxTokens(config);
  if (limit !== null && !("max_tokens" in out) && !("max_completion_tokens" in out))
    out.max_tokens = limit;
  return out;
}

async function completeOnce(
  config: RuntimeConfig,
  base: string,
  key: string,
  model: string,
  body: Record<string, unknown>,
  accounting: ModelAccounting,
  timeoutMs: number,
) {
  const adapter = modelAdapter(config);
  let pricing: ModelUsage["pricing"] = {
    inputUsdPerMillion: price(config.MODEL_INPUT_USD_PER_MILLION),
    outputUsdPerMillion: price(config.MODEL_OUTPUT_USD_PER_MILLION),
  };
  let priceVersion = config.MODEL_PRICE_VERSION?.trim() || null;
  const cacheReadPrice = price(config[MODEL_PROFILE_KEYS.cacheRead]),
    cacheWritePrice = price(config[MODEL_PROFILE_KEYS.cacheWrite]);
  const plan =
    adapter === "anthropic"
      ? ({ style: modelFamily(config), source: "setting", retry: false, withheld: [] } as const)
      : resolveModelRequestStyle(base, model, config);
  let attempt: RequestAttempt = { style: plan.style, withheld: [...plan.withheld] };
  let withheldOptional: AnthropicOptional[] = [];
  let retriedAfterRefusal: string | null = null;
  let sent: Record<string, unknown> = {};
  const prepared = profileRequest({ ...body, model }, config);
  const request = (): NonNullable<ModelUsage["request"]> => ({
    style: attempt.style,
    source: retriedAfterRefusal ? "refusal_retry" : plan.source,
    retriedAfterRefusal,
    reasoningEffort:
      typeof sent.reasoning_effort === "string"
        ? sent.reasoning_effort
        : typeof (sent.output_config as any)?.effort === "string"
          ? (sent.output_config as any).effort
          : null,
  });
  const profileId = config[MODEL_PROFILE_KEYS.id]?.trim() || null;
  const unknown = (): ModelUsage => ({
    model,
    input: null,
    output: null,
    cost: null,
    requestId: null,
    priceVersion,
    pricing,
    reasoning: null,
    request: request(),
    ...(profileId
      ? { profile: { id: profileId, label: config[MODEL_PROFILE_KEYS.label]?.trim() || null } }
      : {}),
  });
  // A retry uses what is left of the one time limit, so a job lease sized
  // for the call still covers both requests.
  const deadline = Date.now() + timeoutMs;
  let attempted = false;
  const send = (reserve: boolean) => {
    sent =
      adapter === "anthropic"
        ? anthropicRequestBody(prepared, {
            effort: modelReasoningEffort(config, model),
            sendTemperature: sendsTemperature(config),
            withheld: withheldOptional,
            defaultMaxTokens: defaultMaxTokens(config),
          })
        : styleRequestBody(prepared, attempt.style, config, attempt.withheld);
    return providerRequest(
      base.replace(/\/$/, "") +
        (adapter === "anthropic" ? "/messages" : "/chat/completions"),
      {
        method: "POST",
        headers:
          adapter === "anthropic"
            ? {
                "x-api-key": key,
                "anthropic-version": ANTHROPIC_VERSION,
                "Content-Type": "application/json",
              }
            : {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
              },
        signal: AbortSignal.timeout(
          reserve ? timeoutMs : Math.max(1000, deadline - Date.now()),
        ),
        body: JSON.stringify(sent),
      },
      reserve
        ? async () => {
            const reviewed = await accounting.reserve(model);
            // A reviewed price for this provider and model replaces the settings' price.
            if (reviewed) {
              pricing = {
                inputUsdPerMillion: reviewed.inputUsdPerMillion,
                outputUsdPerMillion: reviewed.outputUsdPerMillion,
              };
              priceVersion = reviewed.priceVersion;
            }
            attempted = true;
          }
        : undefined,
    );
  };
  let response: Response, payload: any;
  try {
    response = await send(true);
    payload = await response.json();
    if (adapter === "anthropic") {
      const refused = anthropicRefusedParameter(response.status, payload, sent);
      if (refused && !reportsUsage(payload)) {
        retriedAfterRefusal = refused === "format" ? "output_config.format" : refused;
        withheldOptional = [...withheldOptional, refused];
        response = await send(false);
        payload = await response.json();
      }
    } else {
      const refused = refusedStyleParameter(
        response.status,
        payload,
        attempt.style,
        sent,
      );
      const next =
        refused && !reportsUsage(payload)
          ? retryAfterRefusal(refused, attempt, {
              switchStyle: plan.retry,
              automaticEffort: modelReasoningEffortSetting(config) === "auto",
            })
          : null;
      if (refused && next) {
        retriedAfterRefusal = refused;
        attempt = next;
        response = await send(false);
        payload = await response.json();
        if (response.ok)
          learnModelRequestStyle(base, model, attempt.style, attempt.withheld);
      }
    }
  } catch (error) {
    if (!attempted) throw error;
    await accounting.record(unknown());
    throw Object.assign(
      new Error("Model response unavailable; usage requires provider reconciliation"),
      { providerUnreachable: true },
    );
  }
  if (adapter === "anthropic" && response.ok) payload = anthropicChatCompletion(payload);
  else if (adapter === "anthropic" && anthropicReportsUsage(payload))
    payload = { ...payload, usage: anthropicChatCompletion(payload).usage };
  const input = tokens(payload?.usage?.prompt_tokens);
  const { output, reasoning } = completionUsage(payload?.usage);
  const cacheRead =
    tokens(payload?.usage?.cache_read_input_tokens ?? payload?.usage?.prompt_tokens_details?.cached_tokens) ?? 0;
  const cacheWrite = tokens(payload?.usage?.cache_creation_input_tokens) ?? 0;
  const cachePriced = cacheReadPrice !== null || cacheWritePrice !== null;
  if (cachePriced)
    pricing = {
      ...pricing,
      cacheReadUsdPerMillion: cacheReadPrice,
      cacheWriteUsdPerMillion: cacheWritePrice,
    };
  // Without cache prices every prompt token is priced at the input price,
  // exactly as before profiles existed.
  const inputCost = (inPrice: number) =>
    cachePriced && input !== null
      ? Math.max(0, input - cacheRead - cacheWrite) * inPrice +
        cacheRead * (cacheReadPrice ?? inPrice) +
        cacheWrite * (cacheWritePrice ?? inPrice)
      : input! * inPrice;
  const calculated =
    input !== null &&
    output !== null &&
    pricing.inputUsdPerMillion !== null &&
    pricing.outputUsdPerMillion !== null &&
    priceVersion
      ? (inputCost(pricing.inputUsdPerMillion) +
          output * pricing.outputUsdPerMillion) /
        1000000
      : null;
  const cost =
    calculated !== null &&
    Number.isFinite(calculated) &&
    calculated < 10000000000
      ? Math.round(calculated * 100000000) / 100000000
      : null;
  const usage: ModelUsage = {
    ...unknown(),
    input,
    output,
    cost,
    requestId:
      typeof payload?.id === "string" ? payload.id.slice(0, 200) : null,
    reasoning,
    ...(cacheRead || cacheWrite ? { cache: { read: cacheRead, write: cacheWrite } } : {}),
  };
  await accounting.record(usage);
  if (!response.ok)
    throw modelRequestFailure(response.status, payload, attempt.style, sent, {
      retriedAfter: retriedAfterRefusal,
      automatic: plan.source !== "setting",
      native: adapter === "anthropic",
    });
  return { payload, usage };
}

/**
 * A failed call names what the provider refused (type, code and parameter;
 * never its full message), so the AI model settings can be corrected: a
 * refused style parameter points at the request style setting, a refused
 * chosen reasoning effort at the reasoning effort setting.
 */
function modelRequestFailure(
  status: number,
  payload: unknown,
  style: ModelRequestStyle,
  sent: Record<string, unknown>,
  {
    retriedAfter,
    automatic,
    native = false,
  }: { retriedAfter: string | null; automatic: boolean; native?: boolean },
) {
  const fields = providerErrorFields(payload);
  // The request style is an OpenAI-compatible setting; a native adapter's
  // failure names the parameter and code only.
  const refused = native ? null : refusedStyleParameter(status, payload, style, sent);
  const detail = [
    fields.param && `parameter ${fields.param}`,
    fields.code ?? fields.type,
  ]
    .filter(Boolean)
    .join(", ");
  const advice = () => {
    if (retriedAfter)
      return `the retry after the refused ${retriedAfter} was refused too`;
    if (refused === "reasoning_effort")
      return "choose another AI model reasoning effort, or automatic";
    return `set the AI model request style to ${otherRequestStyle(style)}${automatic ? "" : " or automatic"}`;
  };
  // Only the app's own values are named, never the provider's text.
  const what =
    refused === "reasoning_effort" && typeof sent.reasoning_effort === "string"
      ? `reasoning_effort ${sent.reasoning_effort}`
      : refused;
  const message = refused
    ? `Model request failed (${status}): the provider does not accept ${what} for this model (${style} request style); ${advice()}; usage has been retained`
    : `Model request failed (${status}${detail ? `, ${detail}` : ""}); usage has been retained`;
  return Object.assign(new Error(message), {
    providerStatus: status,
    providerError: fields,
  });
}
