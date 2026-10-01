/**
 * How one chat-completions request is shaped for the configured model, and
 * how its reply and usage are read. docs/features/model-gateway.md.
 *
 * The app's call sites write one request (max_tokens, a low temperature,
 * JSON mode). Current OpenAI models refuse parts of it: every GPT-5 and
 * GPT-6 model, the o-series and chat-latest refuse `max_tokens` (they take
 * `max_completion_tokens`), and most of them refuse any temperature other
 * than the default. The request style decides the wire form:
 *
 *  - classic:   the request as written (max_tokens, temperature).
 *  - reasoning: max_tokens is sent as max_completion_tokens with the same
 *               value; the call's temperature is kept only for the models
 *               that accept one (gpt-5.1, gpt-5.2, gpt-5.4 and its mini and
 *               nano, while no reasoning effort other than none is sent) and
 *               is otherwise left out (provider default); the reasoning
 *               effort is added (the setting, or automatically low for the
 *               models whose own default spent the whole output budget).
 *
 * The Super admin setting MODEL_REQUEST_STYLE is auto (default), classic or
 * reasoning. Auto decides from the model ID and, as a safety net, retries once
 * with the other style when the provider answers HTTP 400 with the specific
 * unsupported-parameter error for a parameter the style controls. An addition
 * the app made on its own (a kept temperature, the automatic reasoning effort)
 * that the provider refuses is dropped the same way, in any style. What
 * worked is remembered for that address and model in this process.
 *
 * Nothing here imports the runtime configuration: callers pass it, so the
 * module has no import cycle with configuration.ts.
 */
import type { RuntimeConfig } from "./configuration.ts";

export type ModelRequestStyle = "classic" | "reasoning";
export const MODEL_REQUEST_STYLE_SETTINGS = [
  "auto",
  "classic",
  "reasoning",
] as const;
export type ModelRequestStyleSetting =
  (typeof MODEL_REQUEST_STYLE_SETTINGS)[number];
export const MODEL_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
] as const;
export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number];
/**
 * The saved reasoning effort: auto (default; blank or unknown values read as
 * auto), omit (never sent: the provider's default) or one level.
 */
export const MODEL_REASONING_EFFORT_SETTINGS = [
  "auto",
  "omit",
  ...MODEL_REASONING_EFFORTS,
] as const;
export type ModelReasoningEffortSetting =
  (typeof MODEL_REASONING_EFFORT_SETTINGS)[number];

/** The saved request style; blank or unknown values read as auto. */
export function modelRequestStyleSetting(
  config: RuntimeConfig,
): ModelRequestStyleSetting {
  const value = config.MODEL_REQUEST_STYLE?.trim().toLowerCase() ?? "";
  return (MODEL_REQUEST_STYLE_SETTINGS as readonly string[]).includes(value)
    ? (value as ModelRequestStyleSetting)
    : "auto";
}

/**
 * The model ID as the rules below read it: lower case, without a routing
 * prefix (openai/gpt-5) or a fine-tune's wrapper (ft:gpt-5-mini:org:tag).
 */
function modelIdOf(model: string) {
  const id = (model.trim().toLowerCase().split("/").pop() ?? "").replace(
    /^ft:/,
    "",
  );
  return id.split(":")[0];
}

/**
 * The style a model ID implies. Reasoning: OpenAI GPT-5 and later (gpt-5,
 * gpt-5-mini, gpt-5.1 ... gpt-6-*), the o-series (o1, o3, o3-mini, o4-mini)
 * and chat-latest, also behind a routing prefix (openai/gpt-5) or as a
 * fine-tune (ft:gpt-5-mini:...). Everything else is classic, including
 * gpt-4.1, gpt-4o, gpt-oss and the ModelArk Seed, DeepSeek and GLM models,
 * which accept the app's request unchanged.
 */
export function requestStyleForModel(model: string): ModelRequestStyle {
  const id = modelIdOf(model);
  const gpt = /^gpt-(\d+)(?:[.-]|$)/.exec(id);
  if (gpt && Number(gpt[1]) >= 5) return "reasoning";
  if (/^o\d+(?:-|$)/.test(id)) return "reasoning";
  if (id === "chat-latest") return "reasoning";
  return "classic";
}

/**
 * Reasoning-style models that accept a set temperature. In the 29 September
 * 2026 retest gpt-5.1, gpt-5.2, gpt-5.4, gpt-5.4-mini and gpt-5.4-nano
 * answered the app's temperature 0.1 (sent with no reasoning effort) with
 * HTTP 200, while refusing max_tokens; OpenAI accepts a temperature on these
 * models only with reasoning effort none, their default. Dated snapshots of
 * them are included; every other variant (-pro, -codex, -chat-latest) and
 * every other reasoning model keeps the provider's default temperature.
 */
const TEMPERATURE_MODELS =
  /^gpt-5\.(?:1|2|4)(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$/;
export function reasoningModelAcceptsTemperature(model: string) {
  return TEMPERATURE_MODELS.test(modelIdOf(model));
}

/**
 * Models whose own default reasoning effort (medium) spent the app's whole
 * output budget on reasoning in the retest (finish_reason length, no answer:
 * gpt-5-nano 31 of 52 calls, gpt-5 13 of 31, gpt-5-mini 7 of 52, o1 2 of 10,
 * o3-mini and o3 on weekly adjustments). The automatic reasoning effort sends
 * them low, which every one of them accepts. gpt-5.1 and later reason little
 * or not at all by default (no call ran out) and are sent none, so they keep
 * their default and, for gpt-5.1, 5.2 and 5.4, the call's temperature.
 */
const LOW_EFFORT_MODELS =
  /^(?:gpt-5(?:-mini|-nano)?|o1|o3|o3-mini|o4-mini)(?:-\d{4}-\d{2}-\d{2})?$/;
export function automaticReasoningEffort(
  model: string,
): ModelReasoningEffort | null {
  return LOW_EFFORT_MODELS.test(modelIdOf(model)) ? "low" : null;
}

/** The saved reasoning effort setting; blank or unknown values read as auto. */
export function modelReasoningEffortSetting(
  config: RuntimeConfig,
): ModelReasoningEffortSetting {
  const value = config.MODEL_REASONING_EFFORT?.trim().toLowerCase() ?? "";
  return (MODEL_REASONING_EFFORT_SETTINGS as readonly string[]).includes(value)
    ? (value as ModelReasoningEffortSetting)
    : "auto";
}

/**
 * The reasoning effort the reasoning style sends to this model, or null (not
 * sent: the provider's default). Auto follows automaticReasoningEffort.
 */
export function modelReasoningEffort(
  config: RuntimeConfig,
  model: string = config.MODEL_NAME ?? "",
): ModelReasoningEffort | null {
  const setting = modelReasoningEffortSetting(config);
  if (setting === "auto") return automaticReasoningEffort(model);
  if (setting === "omit") return null;
  return setting;
}

/**
 * Whether the reasoning style keeps the call's own temperature for this
 * model: only a model that accepts one, and only with no reasoning effort
 * other than none.
 */
export function reasoningKeepsTemperature(
  config: RuntimeConfig,
  model: string = config.MODEL_NAME ?? "",
) {
  const effort = modelReasoningEffort(config, model);
  return (
    reasoningModelAcceptsTemperature(model) &&
    (effort === null || effort === "none")
  );
}

export const otherRequestStyle = (style: ModelRequestStyle): ModelRequestStyle =>
  style === "classic" ? "reasoning" : "classic";

/**
 * Parameters the reasoning style adds on the app's own decision (never an
 * admin's choice): a kept temperature and the automatic reasoning effort. A
 * provider that refuses one gets the request once more without it.
 */
export type AutomaticParameter = "temperature" | "reasoning_effort";

// ---------------------------------------------------------------------------
// Model profiles (docs/features/model-profiles.md). The active profile is
// applied to each request's runtime configuration as the AI model keys plus
// the keys below; without them (no profile, tests, the CLI) every reader here
// returns the behaviour from before profiles existed.
// ---------------------------------------------------------------------------
export const MODEL_PROFILE_KEYS = {
  id: "MODEL_PROFILE_ID",
  label: "MODEL_PROFILE_LABEL",
  tier: "MODEL_PROFILE_TIER",
  adapter: "MODEL_ADAPTER",
  sendTemperature: "MODEL_SEND_TEMPERATURE",
  jsonMode: "MODEL_JSON_MODE",
  budgets: "MODEL_CALL_BUDGETS",
  defaultMaxTokens: "MODEL_DEFAULT_MAX_TOKENS",
  cacheRead: "MODEL_CACHE_READ_USD_PER_MILLION",
  cacheWrite: "MODEL_CACHE_WRITE_USD_PER_MILLION",
  /** JSON of the fallback profile's runtime keys (key included). */
  fallback: "MODEL_FALLBACK_PROFILE",
  /** Set in a request's scope once a fallback profile answered in it. */
  fallbackAnswered: "MODEL_FALLBACK_ANSWERED",
} as const;
export const MODEL_ADAPTERS = ["openai_compatible", "anthropic"] as const;
export type ModelAdapter = (typeof MODEL_ADAPTERS)[number];
/** How requests are sent: OpenAI-compatible chat completions (default) or the native Messages API. */
export function modelAdapter(config: RuntimeConfig): ModelAdapter {
  return config.MODEL_ADAPTER?.trim() === "anthropic"
    ? "anthropic"
    : "openai_compatible";
}
/** Whether the call's own temperature is sent (default on; some models refuse any). */
export function sendsTemperature(config: RuntimeConfig) {
  return config.MODEL_SEND_TEMPERATURE?.trim().toLowerCase() !== "false";
}
/** Whether response_format json_object is sent (default on; some endpoints refuse it). */
export function jsonModeOn(config: RuntimeConfig) {
  return config.MODEL_JSON_MODE?.trim().toLowerCase() !== "false";
}
/** The answer limit for a call that sets none (voice wording), or null. */
export function defaultMaxTokens(config: RuntimeConfig): number | null {
  const n = Number(config.MODEL_DEFAULT_MAX_TOKENS?.trim() || NaN);
  return Number.isInteger(n) && n >= 256 && n <= 64000 ? n : null;
}
export type CallBudgetOverride = { maxTokens?: number | null; timeoutMs?: number };
/**
 * The profile's own per-task budgets (Super admin, model profiles), or null
 * for the automatic ones (MODEL_CALL_BUDGETS and the model-name allowance).
 * Invalid entries are ignored, never guessed.
 */
export function profileCallBudgets(
  config: RuntimeConfig,
): Partial<Record<ModelCallTask, CallBudgetOverride>> | null {
  const text = config.MODEL_CALL_BUDGETS?.trim();
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Partial<Record<ModelCallTask, CallBudgetOverride>> = {};
  for (const [task, value] of Object.entries(parsed as Record<string, any>)) {
    if (!(task in MODEL_CALL_BUDGETS) || !value || typeof value !== "object") continue;
    const entry: CallBudgetOverride = {};
    const tokens = value.maxTokens;
    if (Number.isInteger(tokens) && tokens >= 256 && tokens <= 64000) entry.maxTokens = tokens;
    else if (tokens === null && MODEL_CALL_BUDGETS[task as ModelCallTask].maxTokens === null)
      entry.maxTokens = null;
    const ms = value.timeoutMs;
    if (Number.isInteger(ms) && ms >= 5000 && ms <= MODEL_CALL_TIMEOUT_CAP_MS) entry.timeoutMs = ms;
    if (Object.keys(entry).length) out[task as ModelCallTask] = entry;
  }
  return Object.keys(out).length ? out : null;
}
/** Whether a fallback profile answered a call in this request's scope. */
export function answeredByFallback(config: RuntimeConfig) {
  return config.MODEL_FALLBACK_ANSWERED === "true";
}
/**
 * What a qualification pins about a profile's request settings beyond the
 * style and effort, only where they differ from the default request: another
 * adapter, no JSON mode, the profile's own answer limits, and an answer from
 * the fallback profile (which no qualification covers).
 */
function profileRequestPin(config: RuntimeConfig) {
  const out: {
    adapter?: ModelAdapter;
    jsonMode?: false;
    maxTokens?: Record<string, number | null>;
    fallback?: true;
  } = {};
  const adapter = modelAdapter(config);
  if (adapter !== "openai_compatible") out.adapter = adapter;
  if (!jsonModeOn(config)) out.jsonMode = false;
  const budgets = profileCallBudgets(config);
  const tokens: Record<string, number | null> = {};
  for (const [task, entry] of Object.entries(budgets ?? {}))
    if (entry && "maxTokens" in entry) tokens[task] = entry.maxTokens ?? null;
  const fallbackTokens = defaultMaxTokens(config);
  if (fallbackTokens !== null) tokens.default = fallbackTokens;
  if (Object.keys(tokens).length)
    out.maxTokens = Object.fromEntries(Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b)));
  if (answeredByFallback(config)) out.fallback = true;
  return Object.keys(out).length ? out : null;
}

// What worked after a refusal, per API address and model, in this process:
// the style (auto only) and the automatic parameters dropped. Bounded; the
// oldest entry is dropped first.
type Learned = { style: ModelRequestStyle; withheld: AutomaticParameter[] };
const learned = new Map<string, Learned>();
const LEARNED_LIMIT = 64;
const learnedKey = (base: string, model: string) =>
  `${base.trim().replace(/\/+$/, "").toLowerCase()} ${model.trim()}`;
export function learnedModelRequestStyle(base: string, model: string) {
  return learned.get(learnedKey(base, model))?.style ?? null;
}
export function learnedWithheldParameters(
  base: string,
  model: string,
): AutomaticParameter[] {
  return [...(learned.get(learnedKey(base, model))?.withheld ?? [])];
}
export function learnModelRequestStyle(
  base: string,
  model: string,
  style: ModelRequestStyle,
  withheld: readonly AutomaticParameter[] = [],
) {
  const key = learnedKey(base, model);
  learned.delete(key);
  learned.set(key, { style, withheld: [...new Set(withheld)].sort() });
  while (learned.size > LEARNED_LIMIT)
    learned.delete(learned.keys().next().value!);
}
/** Tests only: forget every learned style. */
export function forgetLearnedModelRequestStyles() {
  learned.clear();
}

export type ResolvedRequestStyle = {
  style: ModelRequestStyle;
  /** Where the style came from. */
  source: "setting" | "learned" | "model_name";
  /** Auto only: one retry with the other style on a specific refusal. */
  retry: boolean;
  /** Automatic parameters this address and model refused before. */
  withheld: AutomaticParameter[];
};
/** The style the next call to this address and model starts with. */
export function resolveModelRequestStyle(
  base: string,
  model: string,
  config: RuntimeConfig,
): ResolvedRequestStyle {
  const setting = modelRequestStyleSetting(config);
  const remembered = learned.get(learnedKey(base, model));
  if (setting !== "auto")
    return {
      style: setting,
      source: "setting",
      retry: false,
      withheld: remembered?.style === setting ? [...remembered.withheld] : [],
    };
  if (remembered)
    return {
      style: remembered.style,
      source: "learned",
      retry: true,
      withheld: [...remembered.withheld],
    };
  return {
    style: requestStyleForModel(model),
    source: "model_name",
    retry: true,
    withheld: [],
  };
}

/**
 * The model family whose time limits apply: the saved style, or with auto the
 * style the model ID implies. A style learned from a refusal changes the wire
 * form only, never the time limit, so a job lease computed before the call
 * and the call's own limit always agree.
 */
export function modelFamily(config: RuntimeConfig): ModelRequestStyle {
  const setting = modelRequestStyleSetting(config);
  return setting !== "auto"
    ? setting
    : requestStyleForModel(config.MODEL_NAME ?? "");
}

/**
 * What a qualification pins about the request's form, beyond the endpoint,
 * model and prompt versions: the saved request style, the family it (or with
 * auto, the model ID) implies, the reasoning effort sent and whether the
 * reasoning style keeps the call's temperature. The coaching, plan and
 * nutrition pins carry it, so changing the style or the effort invalidates
 * their qualifications until they are evaluated again.
 *
 * Null for the default classic request (automatic style, a model ID of the
 * classic family, no reasoning effort): that request is byte for byte the one
 * sent before request styles existed, so its qualifications stay valid. A
 * style learned from a refusal is not pinned: it follows only a refused
 * request, which never answered.
 */
export type ModelRequestPin = {
  style: ModelRequestStyleSetting;
  family: ModelRequestStyle;
  reasoningEffort: ModelReasoningEffort | null;
  temperature: boolean;
} & NonNullable<ReturnType<typeof profileRequestPin>>;
export function modelRequestPin(config: RuntimeConfig): ModelRequestPin | null {
  const model = config.MODEL_NAME ?? "";
  const style = modelRequestStyleSetting(config);
  const family = modelFamily(config);
  const reasoningEffort = modelReasoningEffort(config, model);
  const profile = profileRequestPin(config);
  const temperature =
    sendsTemperature(config) &&
    (family === "classic" || reasoningKeepsTemperature(config, model));
  if (
    style === "auto" &&
    family === "classic" &&
    reasoningEffort === null &&
    temperature &&
    !profile
  )
    return null;
  return { style, family, reasoningEffort, temperature, ...profile };
}

/**
 * The request body in one style. Messages (including image parts and their
 * `detail`), response_format and every other field pass through unchanged.
 * `withheld` lists automatic parameters to leave out after a refusal.
 */
export function styleRequestBody(
  body: Record<string, unknown>,
  style: ModelRequestStyle,
  config: RuntimeConfig,
  withheld: readonly AutomaticParameter[] = [],
): Record<string, unknown> {
  const out = { ...body };
  if (style === "classic") return out;
  const model = typeof out.model === "string" ? out.model : "";
  if ("max_tokens" in out) {
    if (!("max_completion_tokens" in out))
      out.max_completion_tokens = out.max_tokens;
    delete out.max_tokens;
  }
  let effort = modelReasoningEffort(config, model);
  // Only the automatic effort is ever dropped; a chosen one is sent exactly.
  if (
    effort &&
    withheld.includes("reasoning_effort") &&
    modelReasoningEffortSetting(config) === "auto"
  )
    effort = null;
  const keepTemperature =
    reasoningModelAcceptsTemperature(model) &&
    (effort === null || effort === "none") &&
    !withheld.includes("temperature");
  if (!keepTemperature) delete out.temperature;
  if (effort && !("reasoning_effort" in out)) out.reasoning_effort = effort;
  return out;
}

/**
 * A refusal the other style (or leaving the parameter out) fixes is read from
 * the HTTP status and the parameter the provider rejected, never from one
 * vendor's wording: HTTP 400 with an error object that names a parameter this
 * request controls, in its structured `param` field or, without one, as the
 * first request parameter its message names (quoted or bare, in any words).
 * Recorded examples (29 September 2026 retest, docs/features/model-gateway.md):
 * `param` max_tokens or temperature (OpenAI), "Unrecognized request argument
 * supplied: max_completion_tokens" (Azure, no param), "temperature: ..." (a
 * compatible endpoint without param).
 *
 * Not a refusal: a token limit whose value was refused (a value code such as
 * invalid_value, or a message quoting a number: "max_tokens is too large:
 * 12000"), since another name would not fix it; a parameter the style does
 * not control (response_format, messages for context length), a model without
 * image input, every other status, and a body without an error object.
 */
const STYLE_PARAMETERS: Record<ModelRequestStyle, string[]> = {
  classic: ["max_tokens", "temperature"],
  reasoning: ["max_completion_tokens"],
};
/** Request parameters a message may name; the first one named is the rejected one. */
const NAMED_PARAMETERS = [
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "reasoning_effort",
  "response_format",
  "messages",
  "top_p",
  "stop",
  "tools",
  "seed",
];
const TOKEN_LIMITS = new Set(["max_tokens", "max_completion_tokens"]);
/** The parameter an error object names: its `param`, else the first one its message names. */
export function rejectedParameter(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { message?: unknown; param?: unknown };
  if (typeof e.param === "string" && e.param.trim())
    return e.param.trim().replace(/^(?:body|request)\./, "");
  const message = typeof e.message === "string" ? e.message : "";
  let first: { name: string; at: number } | null = null;
  for (const name of NAMED_PARAMETERS) {
    const match = new RegExp(`(?<![A-Za-z0-9_.])${name}(?![A-Za-z0-9_])`).exec(
      message,
    );
    if (match && (!first || match.index < first.at))
      first = { name, at: match.index };
  }
  return first?.name ?? null;
}
/**
 * The parameter this request sent that the provider refused (HTTP 400, see
 * above), or null. Only such a refusal may be retried. In the reasoning
 * style, a temperature or reasoning effort counts when the sent body carried
 * it.
 */
export function refusedStyleParameter(
  status: number,
  payload: unknown,
  style: ModelRequestStyle,
  sent: Record<string, unknown> = {},
): string | null {
  if (status !== 400) return null;
  const error = (payload as { error?: unknown } | null)?.error;
  if (!error || typeof error !== "object") return null;
  const named = rejectedParameter(error);
  if (!named) return null;
  const candidates = [
    ...STYLE_PARAMETERS[style],
    ...(style === "reasoning"
      ? (["temperature", "reasoning_effort"] as const).filter((p) => p in sent)
      : []),
  ];
  if (!candidates.includes(named)) return null;
  if (TOKEN_LIMITS.has(named)) {
    const e = error as { message?: unknown; code?: unknown };
    // A refused value (too large) is not fixed by another parameter name.
    if (/value|range|too_large|exceed/i.test(String(e.code ?? ""))) return null;
    if (/\d{3,}/.test(typeof e.message === "string" ? e.message : "")) return null;
  }
  return named;
}

export type RequestAttempt = {
  style: ModelRequestStyle;
  withheld: AutomaticParameter[];
};
/**
 * The one retry after a refused parameter, or null. Switching style needs
 * the automatic style setting (a chosen style is sent exactly); leaving out
 * an automatic parameter (a kept temperature, the automatic reasoning
 * effort) is allowed in any style, since the app, not the admin, chose it.
 */
export function retryAfterRefusal(
  refused: string,
  attempt: RequestAttempt,
  options: { switchStyle: boolean; automaticEffort: boolean },
): RequestAttempt | null {
  const without = (parameter: AutomaticParameter) => [
    ...new Set([...attempt.withheld, parameter]),
  ];
  if (attempt.style === "classic") {
    if (!options.switchStyle) return null;
    // A model that refuses the temperature refuses it in either style.
    return {
      style: "reasoning",
      withheld:
        refused === "temperature" ? without("temperature") : attempt.withheld,
    };
  }
  if (refused === "max_completion_tokens")
    return options.switchStyle
      ? { style: "classic", withheld: attempt.withheld }
      : null;
  if (refused === "temperature")
    return { style: "reasoning", withheld: without("temperature") };
  if (refused === "reasoning_effort" && options.automaticEffort)
    return { style: "reasoning", withheld: without("reasoning_effort") };
  return null;
}

/**
 * Why a chosen reasoning effort is not documented for this model ID, or
 * null. OpenAI: none exists from GPT-5.1 on; minimal only on gpt-5, gpt-5-mini
 * and gpt-5-nano; the o-series takes low, medium or high. A refused level is
 * the admin's choice and fails every call until changed, so the connection
 * check says so. Unknown IDs (deployment names) are never flagged.
 */
export function reasoningEffortMismatch(config: RuntimeConfig): string | null {
  const setting = modelReasoningEffortSetting(config);
  const id = modelIdOf(config.MODEL_NAME ?? "");
  const gpt5 = /^gpt-5(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$/.test(id);
  const oSeries = /^o\d+(?:-|$)/.test(id);
  const later = /^gpt-(?:5\.\d|[6-9]|\d{2,})/.test(id);
  if (setting === "none" && (gpt5 || oSeries))
    return "none is accepted by GPT-5.1 and later only";
  if (setting === "minimal" && (oSeries || later))
    return "minimal is documented for gpt-5, gpt-5-mini and gpt-5-nano only";
  return null;
}

/**
 * What calls to this address and model start with, for the AI model
 * connection check: the style and where it came from, the reasoning effort
 * and whether a chosen effort looks wrong for the model ID. This reflects
 * the process that runs the check; another process (the worker) that met a
 * refused parameter retries once and records it on the AI cost row
 * (requestStyleSource refusal_retry, refusedParameter).
 */
export function describeModelRequest(
  base: string,
  model: string,
  config: RuntimeConfig,
) {
  const plan = resolveModelRequestStyle(base, model, config);
  const setting = modelReasoningEffortSetting(config);
  let effort = plan.style === "reasoning" ? modelReasoningEffort(config, model) : null;
  if (effort && setting === "auto" && plan.withheld.includes("reasoning_effort"))
    effort = null;
  const effortSource: "setting" | "automatic" | "not_sent" = effort
    ? setting === "auto"
      ? "automatic"
      : "setting"
    : "not_sent";
  // An effort is sent only in the reasoning style (or after automatic
  // switches to it), so a chosen classic style needs no warning.
  const mismatch =
    plan.style === "reasoning" || plan.retry
      ? reasoningEffortMismatch({ ...config, MODEL_NAME: model })
      : null;
  const sources = {
    setting: "chosen in these settings",
    learned: "learned after a refused parameter",
    model_name: "from the model ID",
  };
  let note = `Calls start with the ${plan.style} request style (${sources[plan.source]})`;
  if (plan.style === "reasoning")
    note += effort
      ? `, reasoning effort ${effort} (${effortSource === "automatic" ? "automatic for this model" : "chosen in these settings"})`
      : ", no reasoning effort (the provider's default; choose low if replies stop at the output limit)";
  note += ".";
  if (mismatch)
    note += ` The chosen reasoning effort may be refused: ${mismatch}; a refused level fails every AI call until it is changed.`;
  if (plan.retry)
    note +=
      " A refused request parameter is retried once and recorded on the AI cost row.";
  return {
    style: plan.style,
    source: plan.source,
    reasoningEffort: effort,
    reasoningEffortSource: effortSource,
    reasoningEffortWarning: mismatch,
    note,
  };
}

/**
 * Short, safe fields of a provider error body for failure messages (type,
 * code and parameter only; the provider's message is not repeated).
 */
export function providerErrorFields(payload: unknown) {
  const error = (payload as { error?: unknown } | null)?.error;
  if (!error || typeof error !== "object") return {};
  const pick = (value: unknown) =>
    typeof value === "string" && /^[A-Za-z0-9_.\-[\]]{1,80}$/.test(value)
      ? value
      : undefined;
  const e = error as Record<string, unknown>;
  return {
    type: pick(e.type),
    code: pick(e.code),
    param: pick(e.param),
  };
}

/**
 * Output tokens for cost. OpenAI and ModelArk count reasoning inside
 * completion_tokens (completion_tokens_details.reasoning_tokens is a part of
 * it); a provider that reports reasoning beside the answer (total_tokens =
 * prompt + completion + reasoning, or more reasoning than completion tokens)
 * has it added, so reasoning is always billed exactly once. Without
 * completion_tokens the output is unknown (the usage-required rule).
 */
export function completionUsage(usage: unknown): {
  output: number | null;
  reasoning: number | null;
} {
  const u = (usage ?? {}) as Record<string, any>;
  const count = (value: unknown): number | null =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 2147483647
      ? value
      : null;
  const completion = count(u.completion_tokens);
  const reasoning = count(
    u.completion_tokens_details?.reasoning_tokens ?? u.reasoning_tokens,
  );
  if (completion === null) return { output: null, reasoning };
  if (!reasoning) return { output: completion, reasoning };
  const prompt = count(u.prompt_tokens),
    total = count(u.total_tokens);
  const beside =
    reasoning > completion ||
    (prompt !== null &&
      total !== null &&
      total === prompt + completion + reasoning);
  const output = beside ? completion + reasoning : completion;
  return { output: output <= 2147483647 ? output : null, reasoning };
}

/**
 * A reply wrapped in one surrounding Markdown code fence (```json ... ``` or
 * ``` ... ```), with nothing but whitespace outside it, is read as the text
 * inside (GLM-4.7 and GLM-5.2 answer this way in JSON mode). Nothing else is
 * loosened: text before or after the fence, a second fence or any other
 * language tag leaves the reply as it is, and the strict JSON.parse decides.
 */
export function unwrapJsonFence(text: string): string {
  const match = /^```(?:json)?[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```$/i.exec(
    text.trim(),
  );
  if (!match || match[1].includes("```")) return text;
  return match[1];
}
/**
 * The first choice's content parsed as strict JSON after unwrapping one outer
 * code fence. Missing content reads as null; invalid JSON throws, as before.
 */
export function modelReplyJson(payload: unknown): unknown {
  const content = (payload as any)?.choices?.[0]?.message?.content;
  return JSON.parse(
    typeof content === "string" ? unwrapJsonFence(content) : (content ?? "null"),
  );
}

// ---------------------------------------------------------------------------
// Time limits per call site and model family. Each call site's base limit is
// the one it had before (unchanged for classic models, multiplier 1); the
// reasoning family (GPT-5 and later, o-series) is slower and defaults to
// twice the time. Both multipliers are Super admin settings (AI model). A
// slower model-name family (MODEL_FAMILY_TIMEOUT_MS, such as ModelArk Seed)
// raises a call site's base limit before the multiplier applies. Every call
// stays within the 300-second cap modelCompletion applies.
// ---------------------------------------------------------------------------
export const MODEL_CALL_TIMEOUT_CAP_MS = 300000;
export const MODEL_TIMEOUT_MULTIPLIER_DEFAULTS: Record<
  ModelRequestStyle,
  number
> = { classic: 1, reasoning: 2 };
const MULTIPLIER_KEYS: Record<ModelRequestStyle, string> = {
  classic: "MODEL_TIMEOUT_MULTIPLIER",
  reasoning: "MODEL_REASONING_TIMEOUT_MULTIPLIER",
};
/** Whether a saved multiplier is valid: 1 to 10, at most two decimals. */
export function validTimeoutMultiplier(text: string) {
  return /^\d{1,2}(\.\d{1,2})?$/.test(text) && Number(text) >= 1 && Number(text) <= 10;
}
export function modelTimeoutMultiplier(config: RuntimeConfig) {
  const family = modelFamily(config);
  const text = config[MULTIPLIER_KEYS[family]]?.trim() ?? "";
  return validTimeoutMultiplier(text)
    ? Number(text)
    : MODEL_TIMEOUT_MULTIPLIER_DEFAULTS[family];
}
/** A call site's base time limit for the configured model's family. */
export function familyTimeoutMs(baseMs: number, config: RuntimeConfig) {
  return Math.min(
    MODEL_CALL_TIMEOUT_CAP_MS,
    Math.round(baseMs * modelTimeoutMultiplier(config)),
  );
}
/**
 * Base output budget and time limit of each call site (plan generation and
 * nutrition have their own sized budgets, planGenerationBudget and
 * nutritionBudget, which apply the same family multiplier).
 */
export const MODEL_CALL_BUDGETS = {
  /** Coaching chat: pick one trainer-approved action (selectCoachAction). */
  coach_selection: { maxTokens: 800, timeoutMs: 30000 },
  /** Coaching drafts and held-out release evaluation (modelDecision). */
  coach_decision: { maxTokens: 2500, timeoutMs: 30000 },
  /** Draft rules from trainer teaching material (compileTrainerRules). */
  rule_compilation: { maxTokens: 5000, timeoutMs: 30000 },
  /** Practice-quiz questions from confirmed rules (generateQuizCases). */
  brain_quiz: { maxTokens: 4000, timeoutMs: 30000 },
  /** One suggested rule from a coach's correction (suggestRuleFromCorrection). */
  brain_correction: { maxTokens: 1500, timeoutMs: 30000 },
  /** Weekly plan adjustment (proposePlanAdaptation). */
  plan_adaptation: { maxTokens: 3000, timeoutMs: 60000 },
  /** Meal-photo estimate (estimateMealPhoto). */
  meal_photo: { maxTokens: 2500, timeoutMs: 30000 },
  /** Voice session wording suggestions (no output limit is sent). */
  voice_suggestions: { maxTokens: null, timeoutMs: 30000 },
} as const;
export type ModelCallTask = keyof typeof MODEL_CALL_BUDGETS;
/**
 * Slower model families named by the configured model ID (matched as a whole
 * word), and the base time limit they need for a call site in place of the
 * call site's own. The request-style multiplier above still applies on top,
 * so this is one mechanism: base limit (call site, or its model-name family)
 * times the request-style family's multiplier, within the 300-second cap.
 * ModelArk Seed 2.0 Pro needed 46 to 56 s to compile rules and 37 s for a
 * meal photo in the model trial (30 September 2026), so both allowances leave
 * room over that. An allowance never shortens a call site's base limit.
 */
export const MODEL_FAMILY_TIMEOUT_MS: ReadonlyArray<{
  family: string;
  pattern: RegExp;
  timeoutMs: Readonly<Partial<Record<ModelCallTask, number>>>;
}> = Object.freeze([
  {
    family: "seed",
    pattern: /(?:^|[^a-z0-9])seed(?:[^a-z0-9]|$)/i,
    timeoutMs: Object.freeze({ rule_compilation: 90000, meal_photo: 60000, brain_quiz: 90000, brain_correction: 60000 }),
  },
]);
/**
 * A call site's base time limit for `model`, before the request-style
 * multiplier: its model-name family's allowance, else the call site's base.
 */
export function modelCallTimeoutMs(
  task: ModelCallTask,
  model: string | null | undefined,
) {
  const base = MODEL_CALL_BUDGETS[task].timeoutMs;
  const family = MODEL_FAMILY_TIMEOUT_MS.find((f) =>
    f.pattern.test(String(model ?? "")),
  );
  return Math.max(base, family?.timeoutMs[task] ?? base);
}
/**
 * A call site's output budget and time limit. A model profile's own budget
 * for the task (Super admin, model profiles) replaces the table above and the
 * model-name allowance: its answer limit is sent as given and its time limit
 * is the call's limit (within the 300-second cap, no multiplier). Without
 * one, the automatic budget applies exactly as before profiles existed.
 */
export function modelCallBudget(task: ModelCallTask, config: RuntimeConfig) {
  const base = MODEL_CALL_BUDGETS[task];
  const own = profileCallBudgets(config)?.[task];
  return {
    maxTokens:
      own && "maxTokens" in own
        ? (own.maxTokens ?? null)
        : (base.maxTokens as number | null),
    timeoutMs: own?.timeoutMs
      ? Math.min(MODEL_CALL_TIMEOUT_CAP_MS, own.timeoutMs)
      : familyTimeoutMs(modelCallTimeoutMs(task, config.MODEL_NAME), config),
  };
}
