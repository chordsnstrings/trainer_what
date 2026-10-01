import { modelCompletion, type ModelAccounting } from "./model-accounting.ts";
import { ModelOutputInvalid, ProviderUnavailable } from "./index.ts";
import { runtimeConfig } from "./configuration.ts";
import { modelReplyJson } from "./model-request.ts";
import {
  assistantReplySchema,
  marketingAssistantInstruction,
  marketingAssistantUserMessage,
  type AssistantModelReply,
  type AssistantTurn,
} from "../../domain/src/marketing-assistant.ts";

/**
 * Output and time budget of one spoken turn: a short JSON reply. The answer
 * limit leaves room for a reasoning model's thinking; the time limit keeps a
 * spoken conversation usable (the page shows "Thinking…" meanwhile).
 */
export const MARKETING_ASSISTANT_BUDGET = { maxTokens: 1500, timeoutMs: 20000 } as const;

/**
 * One home page assistant turn through the active model profile. The reply is
 * only parsed here; screenAssistantReply checks it before it is spoken.
 */
export async function marketingAssistantModel(
  input: { appName: string; facts: string; history: AssistantTurn[]; visitor: string },
  accounting: ModelAccounting,
): Promise<AssistantModelReply> {
  const { MODEL_BASE_URL: base, MODEL_API_KEY: key, MODEL_NAME: model } = runtimeConfig();
  if (!base || !key || !model)
    throw new ProviderUnavailable("model", "The assistant is not available right now.");
  const { payload } = await modelCompletion(
    base,
    key,
    model,
    {
      model,
      temperature: 0.3,
      max_tokens: MARKETING_ASSISTANT_BUDGET.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: marketingAssistantInstruction(input.appName, input.facts) },
        { role: "user", content: marketingAssistantUserMessage(input.history, input.visitor) },
      ],
    },
    accounting,
    { timeoutMs: MARKETING_ASSISTANT_BUDGET.timeoutMs },
  );
  let raw: unknown;
  try {
    raw = modelReplyJson(payload);
  } catch {
    throw new ModelOutputInvalid("The assistant's reply could not be read.");
  }
  const parsed = assistantReplySchema.safeParse(raw);
  if (!parsed.success) throw new ModelOutputInvalid("The assistant's reply could not be read.");
  return parsed.data;
}
