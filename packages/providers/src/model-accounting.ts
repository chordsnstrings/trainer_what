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
export type ModelAccounting = {
  reserve: (model: string) => Promise<void>;
  record: (usage: ModelUsage) => Promise<void>;
};
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
) {
  const config = runtimeConfig();
  const pricing = {
    inputUsdPerMillion: price(config.MODEL_INPUT_USD_PER_MILLION),
    outputUsdPerMillion: price(config.MODEL_OUTPUT_USD_PER_MILLION),
  };
  const priceVersion = config.MODEL_PRICE_VERSION?.trim() || null;
  const unknown: ModelUsage = {
    model,
    input: null,
    output: null,
    cost: null,
    requestId: null,
    priceVersion,
    pricing,
  };
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
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ ...body, model }),
      },
      async () => {
        await accounting.reserve(model);
        attempted = true;
      },
    );
    payload = await response.json();
  } catch (error) {
    if (!attempted) throw error;
    await accounting.record(unknown);
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
    ...unknown,
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
