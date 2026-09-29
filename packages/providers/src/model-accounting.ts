import { runtimeConfig, providerRequest } from "./configuration.ts";
import {
  completionUsage,
  learnModelRequestStyle,
  MODEL_CALL_TIMEOUT_CAP_MS,
  modelReasoningEffortSetting,
  otherRequestStyle,
  providerErrorFields,
  refusedStyleParameter,
  resolveModelRequestStyle,
  retryAfterRefusal,
  styleRequestBody,
  type ModelRequestStyle,
  type RequestAttempt,
} from "./model-request.ts";
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
  };
  /** Reasoning tokens the provider reported (part of `output`), if any. */
  reasoning?: number | null;
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
  tokens(payload?.usage?.completion_tokens) !== null;

// Accounting is mandatory and starts immediately before sending, after local validation.
// Response accounting finishes before any model-authored content is parsed or persisted.
//
// The request goes out in the configured request style (model-request.ts). A
// provider refusal of a parameter the request controls (HTTP 400, unsupported
// max_tokens, temperature, max_completion_tokens or an automatic reasoning
// effort, with no usage reported) is retried once within the same time
// limit: in the other style when the style is automatic, or without the
// automatic parameter the provider refused. The retry belongs to the same
// reservation: one call, one usage row, which records the retried call's
// usage and the request that answered.
export async function modelCompletion(
  base: string,
  key: string,
  model: string,
  body: Record<string, unknown>,
  accounting: ModelAccounting,
  options: { timeoutMs?: number } = {},
) {
  const config = runtimeConfig();
  let pricing: ModelUsage["pricing"] = {
    inputUsdPerMillion: price(config.MODEL_INPUT_USD_PER_MILLION),
    outputUsdPerMillion: price(config.MODEL_OUTPUT_USD_PER_MILLION),
  };
  let priceVersion = config.MODEL_PRICE_VERSION?.trim() || null;
  const plan = resolveModelRequestStyle(base, model, config);
  let attempt: RequestAttempt = { style: plan.style, withheld: plan.withheld };
  let retriedAfterRefusal: string | null = null;
  let sent: Record<string, unknown> = {};
  const request = (): NonNullable<ModelUsage["request"]> => ({
    style: attempt.style,
    source: retriedAfterRefusal ? "refusal_retry" : plan.source,
    retriedAfterRefusal,
    reasoningEffort:
      typeof sent.reasoning_effort === "string" ? sent.reasoning_effort : null,
  });
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
  });
  const timeoutMs = Math.min(
    MODEL_CALL_TIMEOUT_CAP_MS,
    Math.max(1000, options.timeoutMs ?? 30000),
  );
  // A retry uses what is left of the one time limit, so a job lease sized
  // for the call still covers both requests.
  const deadline = Date.now() + timeoutMs;
  let attempted = false;
  const send = (reserve: boolean) => {
    sent = styleRequestBody(
      { ...body, model },
      attempt.style,
      config,
      attempt.withheld,
    );
    return providerRequest(
      base.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        headers: {
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
  } catch (error) {
    if (!attempted) throw error;
    await accounting.record(unknown());
    throw new Error(
      "Model response unavailable; usage requires provider reconciliation",
    );
  }
  const input = tokens(payload?.usage?.prompt_tokens);
  const { output, reasoning } = completionUsage(payload?.usage);
  const calculated =
    input !== null &&
    output !== null &&
    pricing.inputUsdPerMillion !== null &&
    pricing.outputUsdPerMillion !== null &&
    priceVersion
      ? (input * pricing.inputUsdPerMillion +
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
  };
  await accounting.record(usage);
  if (!response.ok)
    throw modelRequestFailure(response.status, payload, attempt.style, sent, {
      retriedAfter: retriedAfterRefusal,
      automatic: plan.source !== "setting",
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
  { retriedAfter, automatic }: { retriedAfter: string | null; automatic: boolean },
) {
  const fields = providerErrorFields(payload);
  const refused = refusedStyleParameter(status, payload, style, sent);
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
