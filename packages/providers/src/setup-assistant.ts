import { modelCompletion, type ModelAccounting } from "./model-accounting.ts";
import { ModelOutputInvalid, ProviderUnavailable } from "./index.ts";
import { runtimeConfig, type RuntimeConfig } from "./configuration.ts";
import { familyTimeoutMs, modelReplyJson } from "./model-request.ts";
import {
  setupAssistantInstruction,
  setupReplySchema,
  SETUP_ASSISTANT_PROMPT_VERSION,
  type SetupReply,
  type SetupStep,
  type Specialty,
} from "../../domain/src/setup-assistant.ts";

/** Everything one setup-assistant call may carry, in characters. */
export const SETUP_ASSISTANT_CONTEXT_LIMIT = 40000;
/**
 * Output and time budget of one setup-assistant turn. Seed-family models get
 * a longer base (they needed 40 s and more for comparable JSON drafts in the
 * model trial); the request-style multiplier applies on top, within the cap.
 */
export function setupAssistantBudget(config: RuntimeConfig) {
  const seed = /(?:^|[^a-z0-9])seed(?:[^a-z0-9]|$)/i.test(
    String(config.MODEL_NAME ?? ""),
  );
  return {
    maxTokens: 1500,
    timeoutMs: familyTimeoutMs(seed ? 60000 : 30000, config),
  };
}
export type SetupAssistantInput = {
  step: SetupStep;
  /** Coach answers from earlier steps, for context and grounding. */
  earlier: Array<{ question: string; answer: string }>;
  /** This step's conversation, oldest first. */
  conversation: Array<{ from: "assistant" | "coach"; text: string }>;
  /** The coach's own reviewed material (programme file, website text). */
  material: Array<{ title: string; text: string }>;
  /** What is drafted so far in this step. */
  draft: Record<string, unknown>;
};
/**
 * One setup-assistant turn: the coach's words in, draft fields and follow-up
 * questions out. The reply is only parsed here; every value is checked by
 * groundSetupDraft, screenedGaps and screenedReply before anyone sees it.
 */
export async function setupAssistantModel(
  input: SetupAssistantInput,
  specialties: readonly Specialty[],
  accounting: ModelAccounting,
): Promise<SetupReply> {
  const config = runtimeConfig();
  const {
    MODEL_BASE_URL: base,
    MODEL_API_KEY: key,
    MODEL_NAME: model,
  } = config;
  if (!base || !key || !model)
    throw new ProviderUnavailable(
      "model",
      "The setup assistant is not switched on yet. Fill in the short form instead; nothing you typed is lost.",
    );
  const content = JSON.stringify({
    promptVersion: SETUP_ASSISTANT_PROMPT_VERSION,
    step: input.step,
    ...(input.step === "about"
      ? { offeredSpecialties: specialties }
      : {}),
    earlierAnswers: input.earlier,
    ownMaterial: input.material,
    draftSoFar: input.draft,
    conversation: input.conversation,
  });
  if (content.length > SETUP_ASSISTANT_CONTEXT_LIMIT)
    throw Object.assign(
      new Error(
        "This conversation is too long for the assistant. Use the short form for this step, or start the step again.",
      ),
      { statusCode: 409, code: "SETUP_CONTEXT_TOO_LARGE" },
    );
  const budget = setupAssistantBudget(config);
  const { payload } = await modelCompletion(
    base,
    key,
    model,
    {
      model,
      temperature: 0.2,
      max_tokens: budget.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: setupAssistantInstruction(input.step, specialties),
        },
        { role: "user", content },
      ],
    },
    accounting,
    { timeoutMs: budget.timeoutMs },
  );
  let raw: unknown;
  try {
    raw = modelReplyJson(payload);
  } catch {
    throw new ModelOutputInvalid(
      "The assistant's draft could not be read. Nothing was changed.",
    );
  }
  const parsed = setupReplySchema.safeParse(raw);
  if (!parsed.success)
    throw new ModelOutputInvalid(
      "The assistant's draft could not be read. Nothing was changed.",
    );
  return parsed.data;
}
