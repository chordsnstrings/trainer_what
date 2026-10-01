// The Brain's model calls for narration in the coach's style
// (packages/domain/src/voice-narration.ts holds the prompts and every check):
// one call per new voice session for its extra lines, and one call when the
// coach asks for a style draft. Replies are only read here; every line is
// checked by applyNarration before it can be stored or spoken.
import { modelCompletion, type ModelAccounting } from "./model-accounting.ts";
import { ModelOutputInvalid, ProviderUnavailable } from "./index.ts";
import { runtimeConfig, type RuntimeConfig } from "./configuration.ts";
import { familyTimeoutMs, modelReplyJson } from "./model-request.ts";
import {
  narrationMessages,
  oneOnOneMessages,
  readNarration,
  readOneOnOneDraft,
  type NarrationInput,
  type NarrationLines,
  type OneOnOneAnswers,
} from "../../domain/src/voice-narration.ts";

const seedFamily = (config: RuntimeConfig) =>
  /(?:^|[^a-z0-9])seed(?:[^a-z0-9]|$)/i.test(String(config.MODEL_NAME ?? ""));
/**
 * One session's narration. The member waits while a session is prepared, so
 * the limit is short; on a timeout the session is prepared without Brain
 * lines. Seed-family models get a longer base (8-20 s in the live test).
 */
export function narrationBudget(config: RuntimeConfig) {
  return { maxTokens: 1500, timeoutMs: familyTimeoutMs(seedFamily(config) ? 30000 : 20000, config) };
}
/** The coach's style draft (asked from the trainer screen). */
export function oneOnOneBudget(config: RuntimeConfig) {
  return { maxTokens: 2000, timeoutMs: familyTimeoutMs(seedFamily(config) ? 60000 : 30000, config) };
}
function modelSettings() {
  const config = runtimeConfig();
  const { MODEL_BASE_URL: base, MODEL_API_KEY: key, MODEL_NAME: model } = config;
  if (!base || !key || !model)
    throw new ProviderUnavailable("model", "The Brain's model is not configured yet.");
  return { config, base, key, model };
}
export const narrationAvailable = () => {
  const c = runtimeConfig();
  return !!(c.MODEL_BASE_URL && c.MODEL_API_KEY && c.MODEL_NAME);
};
/** The Brain's extra lines for one session. Unchecked: the caller runs applyNarration. */
export async function generateNarration(
  input: NarrationInput,
  accounting: ModelAccounting,
): Promise<NarrationLines> {
  const { config, base, key, model } = modelSettings();
  const budget = narrationBudget(config);
  const { payload } = await modelCompletion(
    base,
    key,
    model,
    {
      model,
      temperature: 0.5,
      max_tokens: budget.maxTokens,
      response_format: { type: "json_object" },
      messages: narrationMessages(input),
    },
    accounting,
    { timeoutMs: budget.timeoutMs },
  );
  let raw: unknown;
  try {
    raw = modelReplyJson(payload);
  } catch {
    throw new ModelOutputInvalid("The session's extra lines could not be read.");
  }
  const lines = readNarration(raw, input.plan.length);
  if (!lines) throw new ModelOutputInvalid("The session's extra lines were not in the expected form.");
  return lines;
}
/** The coach's style summary and the sample session's lines. Unchecked lines. */
export async function draftOneOnOneStyle(answers: OneOnOneAnswers, accounting: ModelAccounting) {
  const { config, base, key, model } = modelSettings();
  const budget = oneOnOneBudget(config);
  const { payload } = await modelCompletion(
    base,
    key,
    model,
    {
      model,
      temperature: 0.4,
      max_tokens: budget.maxTokens,
      response_format: { type: "json_object" },
      messages: oneOnOneMessages(answers),
    },
    accounting,
    { timeoutMs: budget.timeoutMs },
  );
  let raw: unknown;
  try {
    raw = modelReplyJson(payload);
  } catch {
    throw new ModelOutputInvalid("The style draft could not be read. Try again.");
  }
  const draft = readOneOnOneDraft(raw);
  if (!draft) throw new ModelOutputInvalid("The style draft was not usable. Try again.");
  return draft;
}
