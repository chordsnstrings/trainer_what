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
 *               value, temperature is left out (provider default), and the
 *               optional reasoning effort setting is added.
 *
 * The Super admin setting MODEL_REQUEST_STYLE is auto (default), classic or
 * reasoning. Auto decides from the model ID and, as a safety net, retries once
 * with the other style when the provider answers HTTP 400 with the specific
 * unsupported-parameter error for a parameter the style controls; the style
 * that worked is remembered for that address and model in this process.
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
 * The style a model ID implies. Reasoning: OpenAI GPT-5 and later (gpt-5,
 * gpt-5-mini, gpt-5.1 ... gpt-6-*), the o-series (o1, o3, o3-mini, o4-mini)
 * and chat-latest, also behind a routing prefix (openai/gpt-5) or as a
 * fine-tune (ft:gpt-5-mini:...). Everything else is classic, including
 * gpt-4.1, gpt-4o, gpt-oss and the ModelArk Seed, DeepSeek and GLM models,
 * which accept the app's request unchanged.
 */
export function requestStyleForModel(model: string): ModelRequestStyle {
  const id = (model.trim().toLowerCase().split("/").pop() ?? "").replace(
    /^ft:/,
    "",
  );
  const gpt = /^gpt-(\d+)(?:[.-]|$)/.exec(id);
  if (gpt && Number(gpt[1]) >= 5) return "reasoning";
  if (/^o\d+(?:-|$)/.test(id)) return "reasoning";
  if (id === "chat-latest") return "reasoning";
  return "classic";
}

export const otherRequestStyle = (style: ModelRequestStyle): ModelRequestStyle =>
  style === "classic" ? "reasoning" : "classic";

// The style that worked after a refusal, per API address and model, in this
// process (auto only). Bounded; the oldest entry is dropped first.
const learned = new Map<string, ModelRequestStyle>();
const LEARNED_LIMIT = 64;
const learnedKey = (base: string, model: string) =>
  `${base.trim().replace(/\/+$/, "").toLowerCase()} ${model.trim()}`;
export function learnedModelRequestStyle(base: string, model: string) {
  return learned.get(learnedKey(base, model)) ?? null;
}
export function learnModelRequestStyle(
  base: string,
  model: string,
  style: ModelRequestStyle,
) {
  const key = learnedKey(base, model);
  learned.delete(key);
  learned.set(key, style);
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
};
/** The style the next call to this address and model starts with. */
export function resolveModelRequestStyle(
  base: string,
  model: string,
  config: RuntimeConfig,
): ResolvedRequestStyle {
  const setting = modelRequestStyleSetting(config);
  if (setting !== "auto")
    return { style: setting, source: "setting", retry: false };
  const remembered = learnedModelRequestStyle(base, model);
  if (remembered) return { style: remembered, source: "learned", retry: true };
  return {
    style: requestStyleForModel(model),
    source: "model_name",
    retry: true,
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

/** The reasoning effort to send in the reasoning style, or null (not sent). */
export function modelReasoningEffort(config: RuntimeConfig) {
  const value = config.MODEL_REASONING_EFFORT?.trim().toLowerCase() ?? "";
  return (MODEL_REASONING_EFFORTS as readonly string[]).includes(value)
    ? value
    : null;
}

/**
 * The request body in one style. Messages (including image parts and their
 * `detail`), response_format and every other field pass through unchanged.
 */
export function styleRequestBody(
  body: Record<string, unknown>,
  style: ModelRequestStyle,
  config: RuntimeConfig,
): Record<string, unknown> {
  const out = { ...body };
  if (style === "classic") return out;
  if ("max_tokens" in out) {
    if (!("max_completion_tokens" in out))
      out.max_completion_tokens = out.max_tokens;
    delete out.max_tokens;
  }
  delete out.temperature;
  const effort = modelReasoningEffort(config);
  if (effort && !("reasoning_effort" in out)) out.reasoning_effort = effort;
  return out;
}

/**
 * The provider's refusals the other style fixes, as OpenAI words them
 * (recorded in the 29 September 2026 retest, docs/features/model-gateway.md):
 *   max_tokens:  "Unsupported parameter: 'max_tokens' is not supported with
 *                this model. Use 'max_completion_tokens' instead."
 *   temperature: "Unsupported value: 'temperature' does not support 0.1 with
 *                this model. Only the default (1) value is supported."
 *                "Unsupported parameter: 'temperature' is not supported with
 *                this model." (o1)
 *   max_completion_tokens (the mirror, for a provider that only knows
 *                max_tokens): "Unsupported parameter:
 *                'max_completion_tokens' ..." or Azure's "Unrecognized request
 *                argument supplied: max_completion_tokens".
 * A refused value that another name would not fix ("max_tokens is too
 * large", a context-length error), a refused response_format, a model without
 * image input and every other error are not these refusals.
 */
const STYLE_PARAMETERS: Record<ModelRequestStyle, string[]> = {
  classic: ["max_tokens", "temperature"],
  reasoning: ["max_completion_tokens"],
};
function refusalWording(param: string, message: string) {
  const p = param.replace(/[^a-z_]/g, "");
  return (
    new RegExp(`unsupported parameter:\\s*['"\`]${p}['"\`]`, "i").test(
      message,
    ) ||
    new RegExp(`['"\`]${p}['"\`] is not supported with this model`, "i").test(
      message,
    ) ||
    new RegExp(`unrecognized request argument supplied:\\s*${p}\\b`, "i").test(
      message,
    ) ||
    (p === "temperature" &&
      /unsupported value:\s*['"`]temperature['"`] does not support/i.test(
        message,
      ))
  );
}
/**
 * The parameter this style sends that the provider refused as unsupported
 * (HTTP 400, see above), or null. Only such a refusal may be retried.
 */
export function refusedStyleParameter(
  status: number,
  payload: unknown,
  style: ModelRequestStyle,
): string | null {
  if (status !== 400) return null;
  const error = (payload as { error?: unknown } | null)?.error;
  if (!error || typeof error !== "object") return null;
  const e = error as { message?: unknown; param?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  const param = typeof e.param === "string" ? e.param : null;
  const code = typeof e.code === "string" ? e.code : null;
  for (const candidate of STYLE_PARAMETERS[style]) {
    if (refusalWording(candidate, message)) return candidate;
    // A structured refusal without OpenAI's wording.
    if (
      param === candidate &&
      (code === "unsupported_parameter" ||
        (candidate === "temperature" && code === "unsupported_value"))
    )
      return candidate;
  }
  return null;
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
// twice the time. Both multipliers are Super admin settings (AI model). Every
// call stays within the 300-second cap modelCompletion applies.
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
  /** Weekly plan adjustment (proposePlanAdaptation). */
  plan_adaptation: { maxTokens: 3000, timeoutMs: 60000 },
  /** Meal-photo estimate (estimateMealPhoto). */
  meal_photo: { maxTokens: 2500, timeoutMs: 30000 },
  /** Voice session wording suggestions (no output limit is sent). */
  voice_suggestions: { maxTokens: null, timeoutMs: 30000 },
} as const;
export type ModelCallTask = keyof typeof MODEL_CALL_BUDGETS;
export function modelCallBudget(task: ModelCallTask, config: RuntimeConfig) {
  const base = MODEL_CALL_BUDGETS[task];
  return {
    maxTokens: base.maxTokens as number | null,
    timeoutMs: familyTimeoutMs(base.timeoutMs, config),
  };
}
