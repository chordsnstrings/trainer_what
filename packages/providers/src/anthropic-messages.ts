/**
 * Native Messages API adapter (model profiles with adapter "anthropic",
 * docs/features/model-profiles.md). The app's call sites write one
 * OpenAI-shaped request (system and user messages, max_tokens, temperature,
 * response_format); this module turns it into a Messages request and the
 * answer back into the chat-completion shape every call site reads, so the
 * strict JSON parse and every validator stay unchanged. Plain fetch through
 * providerRequest: no SDK dependency.
 *
 * - System messages become system text blocks; the last one carries
 *   cache_control (prompt caching): the instructions and rules part repeats
 *   across calls, so repeat input is read from cache at a fraction of the
 *   input price (the prefix must be at least the model's minimum, 512 tokens
 *   on the current models, or it is simply not cached).
 * - response_format json_schema becomes output_config.format (structured
 *   output); json_object has no equivalent and is left out: every prompt
 *   already asks for one JSON object in plain words, and the reply is parsed
 *   strictly as before. No assistant prefill (refused by current models).
 * - Images: an image_url data URL becomes a base64 image block.
 * - Temperature is sent only when the profile sends temperatures (current
 *   models refuse a set temperature); the reasoning effort setting becomes
 *   output_config.effort (none and minimal read as low).
 * - Usage: input_tokens (uncached), cache_read_input_tokens and
 *   cache_creation_input_tokens are added up as prompt_tokens, with the cache
 *   parts kept for cost accounting; output_tokens (thinking included) is the
 *   output billed.
 * - stop_reason refusal: the answer is withheld (no content), so the call
 *   site treats it as invalid output that goes to the coach. The server-side
 *   refusal fallback to another model is deliberately not requested: only the
 *   pinned model may answer for a qualification.
 */
export const ANTHROPIC_VERSION = "2023-06-01";
/** Answer limit when the call sets none (the Messages API requires one). */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;
export type AnthropicOptional = "temperature" | "format";

type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };
type ChatMessage = { role: string; content: string | ChatPart[] | null };

function contentBlocks(content: ChatMessage["content"]) {
  if (typeof content === "string" || content == null) return content ?? "";
  return content.map((part) => {
    if (part?.type === "image_url") {
      const url = String(part.image_url?.url ?? "");
      const data = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(url);
      return data
        ? {
            type: "image",
            source: { type: "base64", media_type: data[1].toLowerCase(), data: data[2] },
          }
        : { type: "image", source: { type: "url", url } };
    }
    return { type: "text", text: String((part as { text?: unknown })?.text ?? "") };
  });
}
const textOf = (content: ChatMessage["content"]) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .map((part) => (part?.type === "text" ? part.text : ""))
        .join("\n");

const EFFORTS: Record<string, string> = {
  none: "low",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

/** The Messages request for one app request. */
export function anthropicRequestBody(
  body: Record<string, unknown>,
  options: {
    effort?: string | null;
    sendTemperature: boolean;
    withheld?: readonly AnthropicOptional[];
    defaultMaxTokens?: number | null;
  },
): Record<string, unknown> {
  const system: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  for (const message of (body.messages ?? []) as ChatMessage[]) {
    if (message.role === "system" || message.role === "developer") {
      const text = textOf(message.content);
      if (text) system.push({ type: "text", text });
      continue;
    }
    messages.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: contentBlocks(message.content),
    });
  }
  if (system.length) system[system.length - 1].cache_control = { type: "ephemeral" };
  const limit = [body.max_tokens, body.max_completion_tokens].find(
    (n) => Number.isInteger(n) && (n as number) > 0,
  ) as number | undefined;
  const out: Record<string, unknown> = {
    model: body.model,
    max_tokens: limit ?? options.defaultMaxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
    ...(system.length ? { system } : {}),
    messages,
  };
  const withheld = new Set(options.withheld ?? []);
  if (
    options.sendTemperature &&
    !withheld.has("temperature") &&
    typeof body.temperature === "number"
  )
    out.temperature = Math.min(1, Math.max(0, body.temperature));
  const outputConfig: Record<string, unknown> = {};
  const effort = options.effort ? EFFORTS[options.effort] : undefined;
  if (effort) outputConfig.effort = effort;
  const format = body.response_format as
    | { type?: string; json_schema?: { schema?: unknown } }
    | undefined;
  if (
    format?.type === "json_schema" &&
    format.json_schema?.schema &&
    typeof format.json_schema.schema === "object" &&
    !withheld.has("format")
  )
    outputConfig.format = { type: "json_schema", schema: format.json_schema.schema };
  if (Object.keys(outputConfig).length) out.output_config = outputConfig;
  return out;
}

const FINISH: Record<string, string> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  refusal: "content_filter",
  tool_use: "tool_calls",
};
const count = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

/**
 * A Messages answer in the chat-completion shape the call sites read. A
 * refusal carries no content (the call site withholds it as invalid output).
 */
export function anthropicChatCompletion(payload: any) {
  const blocks: any[] = Array.isArray(payload?.content) ? payload.content : [];
  const refused = payload?.stop_reason === "refusal";
  const text = blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  const usage = payload?.usage ?? {};
  const input = count(usage.input_tokens),
    cacheRead = count(usage.cache_read_input_tokens) ?? 0,
    cacheWrite = count(usage.cache_creation_input_tokens) ?? 0,
    output = count(usage.output_tokens);
  return {
    id: typeof payload?.id === "string" ? payload.id : null,
    model: payload?.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: refused ? null : text },
        finish_reason: FINISH[payload?.stop_reason] ?? payload?.stop_reason ?? null,
      },
    ],
    usage: {
      ...(input !== null ? { prompt_tokens: input + cacheRead + cacheWrite } : {}),
      ...(output !== null ? { completion_tokens: output } : {}),
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
    },
  };
}

/** Whether a Messages body reports token usage (a billed call). */
export function anthropicReportsUsage(payload: any) {
  return (
    count(payload?.usage?.input_tokens) !== null ||
    count(payload?.usage?.output_tokens) !== null
  );
}

/**
 * The optional parameter a 400 answer rejected, by status and the parameter
 * its error names (never the wording): temperature, or the structured output
 * format, when this request sent it. Anything else is not retried.
 */
export function anthropicRefusedParameter(
  status: number,
  payload: any,
  sent: Record<string, unknown>,
): AnthropicOptional | null {
  if (status !== 400) return null;
  const message =
    typeof payload?.error?.message === "string" ? payload.error.message : "";
  if (!message) return null;
  if ("temperature" in sent && /(?<![A-Za-z0-9_.])temperature(?![A-Za-z0-9_])/.test(message))
    return "temperature";
  const config = sent.output_config as Record<string, unknown> | undefined;
  if (config?.format && /output_config\.format|json_schema/.test(message)) return "format";
  return null;
}
