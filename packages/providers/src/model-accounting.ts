import { runtimeConfig, providerRequest } from "./configuration.ts";
export type ModelUsage = {
  model: string;
  input: number | null;
  output: number | null;
  cost: number | null;
  requestId: string | null;
  priceVersion: string | null;
  pricing: {
    inputUsdPerMillion: number | null;
    outputUsdPerMillion: number | null;
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

// Accounting is mandatory and starts immediately before sending, after local validation.
// Response accounting finishes before any model-authored content is parsed or persisted.
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
  const unknown = (): ModelUsage => ({
    model,
    input: null,
    output: null,
    cost: null,
    requestId: null,
    priceVersion,
    pricing,
  });
  let attempted = false;
  let response: Response, payload: any;
  try {
    response = await providerRequest(
      base.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(
          Math.min(300000, Math.max(1000, options.timeoutMs ?? 30000)),
        ),
        body: JSON.stringify({ ...body, model }),
      },
      async () => {
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
      },
    );
    payload = await response.json();
  } catch (error) {
    if (!attempted) throw error;
    await accounting.record(unknown());
    throw new Error(
      "Model response unavailable; usage requires provider reconciliation",
    );
  }
  const input = tokens(payload?.usage?.prompt_tokens);
  const output = tokens(payload?.usage?.completion_tokens);
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
  };
  await accounting.record(usage);
  if (!response.ok)
    throw new Error(
      `Model request failed (${response.status}); usage has been retained`,
    );
  return { payload, usage };
}
