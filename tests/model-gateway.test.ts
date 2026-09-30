// The model gateway with current OpenAI models (docs/features/model-gateway.md):
// request styles (max_tokens or max_completion_tokens, temperature), the one
// retry after a refused parameter, reasoning tokens in cost, one outer JSON
// code fence, the meal-photo request and time limits per model family.
//
// Provider messages below are verbatim from the 29 September 2026 retest
// records (brain-retest calls-screen-*.jsonl, compat.refused and failure);
// the surrounding error fields (type, param, code) are OpenAI's standard
// error body. No provider is contacted: every call uses a *.invalid fixture.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  withRuntimeConfig,
  validateIntegrationValues,
  testIntegration,
  ConfigurationError,
  INTEGRATION_CATALOG,
} from "../packages/providers/src/configuration.ts";
import { modelCompletion } from "../packages/providers/src/model-accounting.ts";
import {
  automaticReasoningEffort,
  completionUsage,
  describeModelRequest,
  familyTimeoutMs,
  forgetLearnedModelRequestStyles,
  learnedModelRequestStyle,
  learnedWithheldParameters,
  learnModelRequestStyle,
  MODEL_CALL_BUDGETS,
  modelCallBudget,
  modelFamily,
  modelReasoningEffort,
  modelReplyJson,
  modelRequestPin,
  modelTimeoutMultiplier,
  reasoningEffortMismatch,
  reasoningKeepsTemperature,
  reasoningModelAcceptsTemperature,
  refusedStyleParameter,
  requestStyleForModel,
  resolveModelRequestStyle,
  retryAfterRefusal,
  styleRequestBody,
  unwrapJsonFence,
} from "../packages/providers/src/model-request.ts";
import {
  brainPlanLeaseSeconds,
  generateTrainingPlan,
  planGenerationBudget,
  planModelPin,
  proposePlanAdaptation,
} from "../packages/providers/src/brain-plans.ts";
import {
  nutritionBudget,
  nutritionModel,
  nutritionModelIdentity,
  nutritionWeekLeaseSeconds,
  NUTRITION_WEEK_LEASE_SECONDS,
} from "../packages/providers/src/nutrition.ts";
import { estimateMealPhoto } from "../packages/providers/src/food.ts";
import {
  coachingModelPin,
  selectCoachAction,
} from "../packages/providers/src/coaching.ts";
import {
  compileTrainerRules,
  modelDecision,
} from "../packages/providers/src/index.ts";

const BASE = "https://gateway-fixture.invalid/v1";
const openaiError = (message: string, param: string | null, code: string | null) => ({
  error: { message, type: "invalid_request_error", param, code },
});
// Recorded refusals (retest, 29 September 2026).
const REFUSED_MAX_TOKENS = openaiError(
  "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
  "max_tokens",
  "unsupported_parameter",
);
const REFUSED_TEMPERATURE_0 = openaiError(
  "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.",
  "temperature",
  "unsupported_value",
);
const REFUSED_TEMPERATURE_01 = openaiError(
  "Unsupported value: 'temperature' does not support 0.1 with this model. Only the default (1) value is supported.",
  "temperature",
  "unsupported_value",
);
const REFUSED_TEMPERATURE_O1 = openaiError(
  "Unsupported parameter: 'temperature' is not supported with this model.",
  "temperature",
  "unsupported_parameter",
);
// Recorded errors that another request style would not fix.
const TOO_LARGE = openaiError(
  "max_tokens is too large: 12000. This model supports at most 4096 completion tokens, whereas you provided 12000.",
  "max_tokens",
  null,
);
const GPT4_JSON_MODE = openaiError(
  "Invalid parameter: 'response_format' of type 'json_object' is not supported with this model.",
  "response_format",
  null,
);
const CONTEXT_LENGTH = openaiError(
  "This model's maximum context length is 8192 tokens. However, you requested 16609 tokens (4609 in the messages, 12000 in the completion). Please reduce the length of the messages or completion.",
  "messages",
  "context_length_exceeded",
);
// ModelArk: the recorded message and the parameter the retest recorded
// (app-compat.md); other fields are left out rather than guessed.
const ARK_JSON_MODE = {
  error: {
    message:
      "The parameter `response_format.type` specified in the request are not valid: `json_object` is not supported by this model. Request id: 021790701599289a262ecc6d4",
    param: "response_format.type",
  },
};
const ARK_NO_VISION = {
  error: {
    message:
      "Model do not support image input. Request id: 021790701616047a262ecc6d4c5ad12813924c87f6f247fb29d92",
  },
};
// The mirror of the max_tokens refusal, for a provider that knows only
// max_tokens (not recorded in the retest: no such provider was screened).
const REFUSED_MAX_COMPLETION = openaiError(
  "Unsupported parameter: 'max_completion_tokens' is not supported with this model. Use 'max_tokens' instead.",
  "max_completion_tokens",
  "unsupported_parameter",
);
const AZURE_UNRECOGNIZED = {
  error: {
    code: null,
    message: "Unrecognized request argument supplied: max_completion_tokens",
    param: null,
    type: "invalid_request_error",
  },
};

const PRICED = {
  MODEL_INPUT_USD_PER_MILLION: "2",
  MODEL_OUTPUT_USD_PER_MILLION: "8",
  MODEL_PRICE_VERSION: "gateway-fixture-v1",
};
type Sent = { url: string; body: any };
/** Runs fn with a fetch that answers each request from `answers` in turn. */
async function withProvider<T>(
  answers: Array<{ status: number; body: unknown } | Error>,
  fn: (sent: Sent[]) => Promise<T>,
) {
  const sent: Sent[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const next = answers.shift();
    if (!next) throw new Error("unexpected extra provider request");
    if (next instanceof Error) throw next;
    return Response.json(next.body, { status: next.status });
  }) as typeof fetch;
  try {
    return await fn(sent);
  } finally {
    globalThis.fetch = original;
  }
}
const ok = (content: string, usage: Record<string, unknown> = { prompt_tokens: 100, completion_tokens: 20 }) => ({
  status: 200,
  body: {
    id: "chatcmpl-fixture",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage,
  },
});
function ledger() {
  const events: string[] = [],
    rows: any[] = [];
  return {
    events,
    rows,
    accounting: {
      reserve: async (model: string) => void events.push(`reserve:${model}`),
      record: async (usage: any) => {
        events.push("record");
        rows.push(usage);
      },
    },
  };
}
const APP_BODY = {
  messages: [
    { role: "system", content: "Return only JSON." },
    { role: "user", content: "{}" },
  ],
  response_format: { type: "json_object" },
  max_tokens: 800,
  temperature: 0,
};

beforeEach(() => forgetLearnedModelRequestStyles());

test("the model ID decides the automatic style: current OpenAI reasoning models versus everything else", () => {
  // Every model that refused max_tokens in the retest (app-compat.md row 1).
  for (const model of [
    "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.1", "gpt-5.2", "gpt-5.4",
    "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra",
    "gpt-5.6-luna", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "o1", "o3",
    "o3-mini", "o4-mini", "chat-latest",
    // Snapshots, routing prefixes, fine-tunes and case.
    "gpt-5-mini-2025-08-07", "openai/gpt-5.4", "ft:gpt-5-mini:org:tag:abc", "GPT-5.5", "o4-mini-2025-04-16", "gpt-5-chat-latest",
  ])
    assert.equal(requestStyleForModel(model), "reasoning", model);
  // Every model that accepted the app's request unchanged, and gpt-oss (which
  // refused only response_format) and the legacy models.
  for (const model of [
    "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini",
    "gpt-4-turbo", "gpt-3.5-turbo", "gpt-4", "gpt-oss-120b-250805",
    "seed-2-0-pro-260328", "seed-1-6-flash-250715", "dola-seed-2-1-turbo-260628",
    "deepseek-v4-pro-ga-260813", "deepseek-v3-2-251201", "glm-4-7-251222",
    "glm-5-3-flash-260828", "openchat", "fixture-model", "",
  ])
    assert.equal(requestStyleForModel(model), "classic", model);
});

test("the reasoning style sends max_completion_tokens with the same value and no temperature; classic is the request as written", () => {
  const reasoning = styleRequestBody({ ...APP_BODY, model: "gpt-5-mini" }, "reasoning", {});
  // gpt-5-mini refuses a set temperature and gets the automatic low effort.
  assert.deepEqual(reasoning, {
    model: "gpt-5-mini",
    messages: APP_BODY.messages,
    response_format: { type: "json_object" },
    max_completion_tokens: 800,
    reasoning_effort: "low",
  });
  assert.deepEqual(styleRequestBody({ ...APP_BODY, model: "gpt-5.6-sol" }, "reasoning", {}), {
    model: "gpt-5.6-sol",
    messages: APP_BODY.messages,
    response_format: { type: "json_object" },
    max_completion_tokens: 800,
  });
  assert.deepEqual(styleRequestBody({ ...APP_BODY }, "classic", {}), APP_BODY);
  // The voice wording call sends no output limit: none is invented.
  const voice = styleRequestBody({ messages: [], temperature: 0.4 }, "reasoning", {});
  assert.deepEqual(voice, { messages: [] });
  // The reasoning effort setting is sent in the reasoning style only.
  assert.equal(
    styleRequestBody(APP_BODY, "reasoning", { MODEL_REASONING_EFFORT: "low" }).reasoning_effort,
    "low",
  );
  assert.equal(
    "reasoning_effort" in styleRequestBody(APP_BODY, "classic", { MODEL_REASONING_EFFORT: "low" }),
    false,
  );
  assert.equal(
    "reasoning_effort" in styleRequestBody(APP_BODY, "reasoning", { MODEL_REASONING_EFFORT: "extreme" }),
    false,
  );
  // The caller's body is never modified.
  assert.equal(APP_BODY.max_tokens, 800);
  assert.equal(APP_BODY.temperature, 0);
});

test("only the specific unsupported-parameter refusals of a style's own parameters are retryable", () => {
  assert.equal(refusedStyleParameter(400, REFUSED_MAX_TOKENS, "classic"), "max_tokens");
  assert.equal(refusedStyleParameter(400, REFUSED_TEMPERATURE_0, "classic"), "temperature");
  assert.equal(refusedStyleParameter(400, REFUSED_TEMPERATURE_01, "classic"), "temperature");
  assert.equal(refusedStyleParameter(400, REFUSED_TEMPERATURE_O1, "classic"), "temperature");
  assert.equal(refusedStyleParameter(400, REFUSED_MAX_COMPLETION, "reasoning"), "max_completion_tokens");
  assert.equal(refusedStyleParameter(400, AZURE_UNRECOGNIZED, "reasoning"), "max_completion_tokens");
  // The wording alone is enough (a body without param or code) ...
  const bare = (body: any) => ({ error: { message: body.error.message } });
  assert.equal(refusedStyleParameter(400, bare(REFUSED_MAX_TOKENS), "classic"), "max_tokens");
  assert.equal(refusedStyleParameter(400, bare(REFUSED_TEMPERATURE_01), "classic"), "temperature");
  // ... and so is the structured field pair without the wording.
  assert.equal(
    refusedStyleParameter(400, openaiError("Bad request", "max_tokens", "unsupported_parameter"), "classic"),
    "max_tokens",
  );
  // A parameter the style does not send is not its refusal.
  assert.equal(refusedStyleParameter(400, REFUSED_MAX_TOKENS, "reasoning"), null);
  assert.equal(refusedStyleParameter(400, REFUSED_TEMPERATURE_01, "reasoning"), null);
  assert.equal(refusedStyleParameter(400, REFUSED_MAX_COMPLETION, "classic"), null);
  // Other errors are never retried: a refused value, JSON mode, context
  // length, no image input, other statuses and unreadable bodies.
  for (const body of [TOO_LARGE, GPT4_JSON_MODE, CONTEXT_LENGTH, ARK_JSON_MODE, ARK_NO_VISION])
    for (const style of ["classic", "reasoning"] as const)
      assert.equal(refusedStyleParameter(400, body, style), null, JSON.stringify(body));
  assert.equal(refusedStyleParameter(400, openaiError("max_tokens is too large", "max_tokens", "invalid_value"), "classic"), null);
  for (const status of [401, 404, 413, 422, 429, 500, 503])
    assert.equal(refusedStyleParameter(status, REFUSED_MAX_TOKENS, "classic"), null);
  for (const body of [null, {}, { error: "Unsupported parameter: 'max_tokens'" }, "text"])
    assert.equal(refusedStyleParameter(400, body, "classic"), null);
});

test("a reasoning model gets max_completion_tokens and no temperature on the first request", async () => {
  const { events, rows, accounting } = ledger();
  await withProvider([ok('{"ok":true}')], async (sent) => {
    const { usage } = await withRuntimeConfig(PRICED, () =>
      modelCompletion(BASE, "fixture-key", "gpt-5-mini", { ...APP_BODY }, accounting),
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, BASE + "/chat/completions");
    assert.equal(sent[0].body.max_completion_tokens, 800);
    assert.equal("max_tokens" in sent[0].body, false);
    assert.equal("temperature" in sent[0].body, false);
    assert.deepEqual(sent[0].body.response_format, { type: "json_object" });
    assert.deepEqual(usage.request, {
      style: "reasoning",
      source: "model_name",
      retriedAfterRefusal: null,
      reasoningEffort: "low",
    });
  });
  assert.deepEqual(events, ["reserve:gpt-5-mini", "record"]);
  assert.equal(rows[0].output, 20);
  // A classic model's request is unchanged.
  await withProvider([ok('{"ok":true}')], async (sent) => {
    await withRuntimeConfig(PRICED, () =>
      modelCompletion(BASE, "fixture-key", "seed-2-0-pro-260328", { ...APP_BODY }, ledger().accounting),
    );
    assert.deepEqual(sent[0].body, { ...APP_BODY, model: "seed-2-0-pro-260328" });
  });
});

test("automatic retries once in the other style after a refused max_tokens, under one reservation, and remembers the style", async () => {
  const { events, rows, accounting } = ledger();
  // An Azure-style deployment name hides the model family.
  const model = "coach-deployment";
  await withProvider(
    [{ status: 400, body: REFUSED_MAX_TOKENS }, ok('{"ok":true}', { prompt_tokens: 120, completion_tokens: 40 })],
    async (sent) => {
      const { payload, usage } = await withRuntimeConfig(PRICED, () =>
        modelCompletion(BASE, "fixture-key", model, { ...APP_BODY }, accounting),
      );
      assert.equal(sent.length, 2);
      assert.equal(sent[0].body.max_tokens, 800);
      assert.equal(sent[0].body.temperature, 0);
      assert.equal(sent[1].body.max_completion_tokens, 800);
      assert.equal("max_tokens" in sent[1].body, false);
      assert.equal("temperature" in sent[1].body, false);
      // Everything else is identical.
      const { max_tokens: _a, temperature: _b, ...first } = sent[0].body;
      const { max_completion_tokens: _c, ...second } = sent[1].body;
      assert.deepEqual(second, first);
      assert.deepEqual(modelReplyJson(payload), { ok: true });
      // The answering request is the retry after the refusal (C6).
      assert.deepEqual(usage.request, {
        style: "reasoning",
        source: "refusal_retry",
        retriedAfterRefusal: "max_tokens",
        reasoningEffort: null,
      });
      // (120 x 2 + 40 x 8) / 1,000,000
      assert.equal(usage.cost, 0.00056);
    },
  );
  // One reservation and one usage row for the call, with the answering style.
  assert.deepEqual(events, [`reserve:${model}`, "record"]);
  assert.equal(rows.length, 1);
  assert.equal(learnedModelRequestStyle(BASE, model), "reasoning");
  assert.equal(learnedModelRequestStyle(BASE + "/", model), "reasoning");
  assert.equal(learnedModelRequestStyle("https://other.invalid/v1", model), null);
  // The next call starts in the learned style: one request.
  await withProvider([ok('{"ok":true}')], async (sent) => {
    const { usage } = await withRuntimeConfig(PRICED, () =>
      modelCompletion(BASE, "fixture-key", model, { ...APP_BODY }, ledger().accounting),
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.max_completion_tokens, 800);
    assert.deepEqual(usage.request, {
      style: "reasoning",
      source: "learned",
      retriedAfterRefusal: null,
      reasoningEffort: null,
    });
  });
});

test("automatic retries a refused temperature (gpt-5.x value and o1 parameter wording) the same way", async () => {
  for (const refusal of [REFUSED_TEMPERATURE_0, REFUSED_TEMPERATURE_01, REFUSED_TEMPERATURE_O1]) {
    forgetLearnedModelRequestStyles();
    const { events, accounting } = ledger();
    await withProvider([{ status: 400, body: refusal }, ok("{}")], async (sent) => {
      const { usage } = await withRuntimeConfig(PRICED, () =>
        modelCompletion(BASE, "fixture-key", "fixture-model", { ...APP_BODY }, accounting),
      );
      assert.equal(sent.length, 2);
      assert.equal("temperature" in sent[1].body, false);
      assert.equal(usage.request?.retriedAfterRefusal, "temperature");
    });
    assert.deepEqual(events, ["reserve:fixture-model", "record"]);
  }
});

test("a reasoning-named model at a provider that refuses max_completion_tokens falls back to classic once", async () => {
  for (const refusal of [REFUSED_MAX_COMPLETION, AZURE_UNRECOGNIZED]) {
    forgetLearnedModelRequestStyles();
    await withProvider([{ status: 400, body: refusal }, ok("{}")], async (sent) => {
      const { usage } = await withRuntimeConfig(PRICED, () =>
        modelCompletion(BASE, "fixture-key", "gpt-5-mini", { ...APP_BODY }, ledger().accounting),
      );
      assert.equal(sent.length, 2);
      assert.equal(sent[0].body.max_completion_tokens, 800);
      assert.equal(sent[1].body.max_tokens, 800);
      assert.equal(sent[1].body.temperature, 0);
      assert.equal(usage.request?.style, "classic");
    });
    assert.equal(learnedModelRequestStyle(BASE, "gpt-5-mini"), "classic");
  }
});

test("other errors are never retried and the failure names the refused parameter, not the provider's text", async () => {
  for (const [body, expected] of [
    [TOO_LARGE, /Model request failed \(400, parameter max_tokens, invalid_request_error\); usage has been retained/],
    [GPT4_JSON_MODE, /parameter response_format/],
    [CONTEXT_LENGTH, /context_length_exceeded/],
    [ARK_JSON_MODE, /Model request failed \(400, parameter response_format\.type\); usage has been retained/],
    [ARK_NO_VISION, /^Model request failed \(400\); usage has been retained$/],
  ] as const) {
    const { events, rows, accounting } = ledger();
    await withProvider([{ status: 400, body }], async (sent) => {
      await assert.rejects(
        withRuntimeConfig(PRICED, () =>
          modelCompletion(BASE, "fixture-key", "fixture-model", { ...APP_BODY }, accounting),
        ),
        (error: any) => {
          assert.match(error.message, expected);
          assert.doesNotMatch(error.message, /whereas you provided|Request id/);
          assert.equal(error.providerStatus, 400);
          return true;
        },
      );
      assert.equal(sent.length, 1);
    });
    assert.deepEqual(events, ["reserve:fixture-model", "record"]);
    assert.equal(rows[0].cost, null);
  }
  // A server error is not a refusal either.
  await withProvider([{ status: 500, body: { error: { message: "The server had an error processing your request." } } }], async (sent) => {
    await assert.rejects(
      withRuntimeConfig(PRICED, () =>
        modelCompletion(BASE, "fixture-key", "fixture-model", { ...APP_BODY }, ledger().accounting),
      ),
      /Model request failed \(500\)/,
    );
    assert.equal(sent.length, 1);
  });
  assert.equal(learnedModelRequestStyle(BASE, "fixture-model"), null);
});

test("a second refusal ends the call: no third request, nothing learned", async () => {
  const { events, accounting } = ledger();
  await withProvider(
    [{ status: 400, body: REFUSED_MAX_TOKENS }, { status: 400, body: REFUSED_MAX_COMPLETION }],
    async (sent) => {
      await assert.rejects(
        withRuntimeConfig(PRICED, () =>
          modelCompletion(BASE, "fixture-key", "fixture-model", { ...APP_BODY }, accounting),
        ),
        /does not accept max_completion_tokens for this model \(reasoning request style\); the retry after the refused max_tokens was refused too; usage has been retained/,
      );
      assert.equal(sent.length, 2);
    },
  );
  assert.deepEqual(events, ["reserve:fixture-model", "record"]);
  assert.equal(learnedModelRequestStyle(BASE, "fixture-model"), null);
});

test("a refusal that reports usage, or a transport failure on the retry, is never retried or hidden", async () => {
  // Reported usage means a billed call: record it, do not send another.
  const billed = { ...REFUSED_MAX_TOKENS, usage: { prompt_tokens: 10, completion_tokens: 0 } };
  const first = ledger();
  await withProvider([{ status: 400, body: billed }], async (sent) => {
    await assert.rejects(
      withRuntimeConfig(PRICED, () =>
        modelCompletion(BASE, "fixture-key", "fixture-model", { ...APP_BODY }, first.accounting),
      ),
      /does not accept max_tokens for this model \(classic request style\); set the AI model request style to reasoning; usage/,
    );
    assert.equal(sent.length, 1);
  });
  assert.equal(first.rows[0].input, 10);
  // The retry fails in transit: the one reservation is recorded as unknown.
  const second = ledger();
  await withProvider(
    [{ status: 400, body: REFUSED_MAX_TOKENS }, new Error("Synthetic reset; no response")],
    async (sent) => {
      await assert.rejects(
        withRuntimeConfig(PRICED, () =>
          modelCompletion(BASE, "fixture-key", "fixture-model", { ...APP_BODY }, second.accounting),
        ),
        /usage requires provider reconciliation/,
      );
      assert.equal(sent.length, 2);
    },
  );
  assert.deepEqual(second.events, ["reserve:fixture-model", "record"]);
  assert.equal(second.rows[0].cost, null);
  assert.equal(second.rows[0].request.style, "reasoning");
  assert.equal(second.rows[0].request.retriedAfterRefusal, "max_tokens");
});

test("an explicit request style is sent exactly and never retried", async () => {
  // Classic for a reasoning model: the refusal fails the call with advice.
  const { events, accounting } = ledger();
  await withProvider([{ status: 400, body: REFUSED_MAX_TOKENS }], async (sent) => {
    await assert.rejects(
      withRuntimeConfig({ ...PRICED, MODEL_REQUEST_STYLE: "classic" }, () =>
        modelCompletion(BASE, "fixture-key", "gpt-5-mini", { ...APP_BODY }, accounting),
      ),
      /does not accept max_tokens for this model \(classic request style\); set the AI model request style to reasoning or automatic/,
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.max_tokens, 800);
  });
  assert.deepEqual(events, ["reserve:gpt-5-mini", "record"]);
  assert.equal(learnedModelRequestStyle(BASE, "gpt-5-mini"), null);
  // Reasoning for a model ID that auto would send classic, with an effort.
  await withProvider([ok("{}")], async (sent) => {
    const { usage } = await withRuntimeConfig(
      { ...PRICED, MODEL_REQUEST_STYLE: "reasoning", MODEL_REASONING_EFFORT: "minimal" },
      () => modelCompletion(BASE, "fixture-key", "coach-deployment", { ...APP_BODY }, ledger().accounting),
    );
    assert.equal(sent[0].body.max_completion_tokens, 800);
    assert.equal(sent[0].body.reasoning_effort, "minimal");
    assert.equal("temperature" in sent[0].body, false);
    assert.deepEqual(usage.request, {
      style: "reasoning",
      source: "setting",
      retriedAfterRefusal: null,
      reasoningEffort: "minimal",
    });
  });
  // A learned style never overrides an explicit setting.
  forgetLearnedModelRequestStyles();
  await withProvider([{ status: 400, body: REFUSED_MAX_TOKENS }, ok("{}")], () =>
    withRuntimeConfig(PRICED, () =>
      modelCompletion(BASE, "fixture-key", "coach-deployment", { ...APP_BODY }, ledger().accounting),
    ),
  );
  assert.deepEqual(
    resolveModelRequestStyle(BASE, "coach-deployment", { MODEL_REQUEST_STYLE: "classic" }),
    { style: "classic", source: "setting", retry: false, withheld: [] },
  );
  assert.deepEqual(resolveModelRequestStyle(BASE, "coach-deployment", {}), {
    style: "reasoning",
    source: "learned",
    retry: true,
    withheld: [],
  });
  // Blank or unknown settings read as automatic.
  assert.equal(resolveModelRequestStyle(BASE, "o3", { MODEL_REQUEST_STYLE: "" }).source, "model_name");
  assert.equal(resolveModelRequestStyle(BASE, "o3", { MODEL_REQUEST_STYLE: "fast" }).style, "reasoning");
});

test("reasoning tokens are billed once inside the output, and missing usage stays unknown", async () => {
  // OpenAI and ModelArk: reasoning is part of completion_tokens (gpt-5-nano
  // meal photo: 2,500 of 2,500 completion tokens were reasoning).
  assert.deepEqual(
    completionUsage({
      prompt_tokens: 1000,
      completion_tokens: 2500,
      total_tokens: 3500,
      completion_tokens_details: { reasoning_tokens: 2500 },
    }),
    { output: 2500, reasoning: 2500 },
  );
  assert.deepEqual(
    completionUsage({ prompt_tokens: 1219, completion_tokens: 901, completion_tokens_details: { reasoning_tokens: 776 } }),
    { output: 901, reasoning: 776 },
  );
  // A provider that reports reasoning beside the answer has it added.
  assert.deepEqual(
    completionUsage({
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 410,
      completion_tokens_details: { reasoning_tokens: 300 },
    }),
    { output: 310, reasoning: 300 },
  );
  assert.deepEqual(
    completionUsage({ prompt_tokens: 100, completion_tokens: 10, reasoning_tokens: 300 }),
    { output: 310, reasoning: 300 },
  );
  assert.deepEqual(completionUsage({ prompt_tokens: 5, completion_tokens: 7 }), { output: 7, reasoning: null });
  // The usage-required rule: no completion count, no output and no cost.
  assert.deepEqual(completionUsage({ prompt_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } }), {
    output: null,
    reasoning: 3,
  });
  assert.deepEqual(completionUsage(undefined), { output: null, reasoning: null });

  const { rows, accounting } = ledger();
  await withProvider(
    [
      ok("{}", {
        prompt_tokens: 1000,
        completion_tokens: 2500,
        total_tokens: 3500,
        completion_tokens_details: { reasoning_tokens: 2100 },
      }),
      ok("{}", { prompt_tokens: 1000, completion_tokens_details: { reasoning_tokens: 10 } }),
    ],
    async () => {
      const priced = await withRuntimeConfig(PRICED, () =>
        modelCompletion(BASE, "fixture-key", "gpt-5-nano", { ...APP_BODY }, accounting),
      );
      // (1000 x 2 + 2500 x 8) / 1,000,000: reasoning counted once.
      assert.equal(priced.usage.cost, 0.022);
      assert.equal(priced.usage.output, 2500);
      assert.equal(priced.usage.reasoning, 2100);
      const unpriced = await withRuntimeConfig(PRICED, () =>
        modelCompletion(BASE, "fixture-key", "gpt-5-nano", { ...APP_BODY }, accounting),
      );
      assert.equal(unpriced.usage.output, null);
      assert.equal(unpriced.usage.cost, null);
    },
  );
  assert.equal(rows.length, 2);
});

test("one surrounding ```json fence is unwrapped before the strict parse; nothing else is loosened", async () => {
  // Recorded GLM-4.7 and GLM-5.2 replies (retest screen).
  const glm47 =
    '```json\n{\n  "changes": [],\n  "reason": "The week was harder than planned (logged RIR 1 vs prescribed RIR 2).",\n  "selfConfidence": 1,\n  "uncertainties": [],\n  "evidenceIds": []\n}\n```';
  const glm52 =
    '```json\n{"actionId":"K1","requiresHumanReview":false,"reason":"User reports being tired and sore, matching K1\'s request terms.","evidenceIds":["R1"]}\n```';
  const reply = (content: unknown) => ({ choices: [{ message: { content } }] });
  assert.deepEqual((modelReplyJson(reply(glm47)) as any).changes, []);
  assert.equal((modelReplyJson(reply(glm52)) as any).actionId, "K1");
  // Plain JSON, surrounding whitespace, a bare fence and a one-line fence.
  assert.deepEqual(modelReplyJson(reply('{"a":1}')), { a: 1 });
  assert.deepEqual(modelReplyJson(reply('\n  ```json\n{"a":1}\n```  \n')), { a: 1 });
  assert.deepEqual(modelReplyJson(reply('```\n{"a":1}\n```')), { a: 1 });
  assert.deepEqual(modelReplyJson(reply('```JSON {"a":1}```')), { a: 1 });
  assert.equal(modelReplyJson(reply(null)), null);
  assert.equal(modelReplyJson({}), null);
  // Not loosened: text outside the fence, two fences, another language,
  // an unclosed fence, JSON with trailing prose, invalid JSON inside.
  for (const content of [
    'Here is the JSON:\n```json\n{"a":1}\n```',
    '```json\n{"a":1}\n```\nHope this helps.',
    '```json\n{"a":1}\n```\n```json\n{"b":2}\n```',
    '```javascript\n{"a":1}\n```',
    '```json\n{"a":1}',
    '{"a":1} and more',
    "```json\n{a:1}\n```",
    "```json\n```",
  ])
    assert.throws(() => modelReplyJson(reply(content)), SyntaxError, content);
  assert.equal(unwrapJsonFence('```json\n{"a":1}\n```\n```json\n{"b":2}\n```'), '```json\n{"a":1}\n```\n```json\n{"b":2}\n```');

  // Through an app call site: a fenced nutrition reply passes validation.
  await withProvider([ok('```json\n{"ok":true}\n```')], async () => {
    const result = await withRuntimeConfig(
      { ...PRICED, MODEL_BASE_URL: BASE, MODEL_API_KEY: "fixture-key", MODEL_NAME: "glm-4-7-251222" },
      () => nutritionModel("nutrition_recipe", "Return {ok}.", {}, z.object({ ok: z.boolean() }).strict(), ledger().accounting),
    );
    assert.deepEqual(result, { ok: true });
  });
  // Prose around it is still invalid output there.
  await withProvider([ok('Sure! ```json\n{"ok":true}\n```')], async () => {
    await assert.rejects(
      withRuntimeConfig(
        { ...PRICED, MODEL_BASE_URL: BASE, MODEL_API_KEY: "fixture-key", MODEL_NAME: "glm-4-7-251222" },
        () => nutritionModel("nutrition_recipe", "Return {ok}.", {}, z.object({ ok: z.boolean() }).strict(), ledger().accounting),
      ),
      (error: any) => error.name === "ModelOutputInvalid",
    );
  });
});

test("the meal-photo request keeps its image part and detail in the reasoning style", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const estimate = {
    items: [
      {
        name: "Rice",
        portion: "One bowl",
        amount: 150,
        unit: "g",
        kcal: 195,
        protein: 4,
        carbohydrate: 42,
        fat: 2,
        preparation: "cooked",
        uncertainty: "Photo estimate",
      },
    ],
    questions: [],
    notes: "Estimated from the photo.",
  };
  const settings = {
    ...PRICED,
    MODEL_BASE_URL: BASE,
    MODEL_API_KEY: "fixture-key",
    MODEL_VISION_ENABLED: "true",
    MEAL_PHOTOS_ENABLED: "true",
  };
  for (const model of ["gpt-5.4-mini", "gpt-4.1-mini"]) {
    await withProvider([ok("```json\n" + JSON.stringify(estimate) + "\n```")], async (sent) => {
      const result = await withRuntimeConfig({ ...settings, MODEL_NAME: model }, () =>
        estimateMealPhoto(jpeg, "lunch", ledger().accounting),
      );
      assert.equal(result.items[0].name, "Rice");
      const body = sent[0].body;
      const user = body.messages[1].content;
      assert.equal(user[1].type, "image_url");
      // Detail "low" is a documented Chat Completions value; every GPT-5.x,
      // GPT-6 and o-series model answered the app's photo request with it.
      assert.deepEqual(user[1].image_url, {
        url: "data:image/jpeg;base64," + jpeg.toString("base64"),
        detail: "low",
      });
      assert.deepEqual(body.response_format, { type: "json_object" });
      if (model.startsWith("gpt-5")) {
        assert.equal(body.max_completion_tokens, 2500);
        assert.equal("max_tokens" in body, false);
        // gpt-5.4-mini accepts the photo's temperature (retest), so it keeps it.
        assert.equal(body.temperature, 0.1);
        assert.equal("reasoning_effort" in body, false);
      } else {
        assert.equal(body.max_tokens, 2500);
        assert.equal(body.temperature, 0.1);
      }
    });
  }
});

test("time limits come from each call site's budget per model family; classic defaults are unchanged", () => {
  const classic = { MODEL_NAME: "gpt-4.1" };
  const seed = { MODEL_NAME: "seed-2-0-pro-260328" };
  const reasoning = { MODEL_NAME: "gpt-5-mini" };
  assert.equal(modelFamily(seed), "classic");
  assert.equal(modelFamily(classic), "classic");
  assert.equal(modelFamily(reasoning), "reasoning");
  assert.equal(modelFamily({ MODEL_NAME: "gpt-5-mini", MODEL_REQUEST_STYLE: "classic" }), "classic");
  assert.equal(modelFamily({ MODEL_NAME: "coach-deployment", MODEL_REQUEST_STYLE: "reasoning" }), "reasoning");
  // The values each call site used before this change.
  assert.deepEqual(
    Object.fromEntries(Object.keys(MODEL_CALL_BUDGETS).map((task) => [task, modelCallBudget(task as any, classic)])),
    {
      coach_selection: { maxTokens: 800, timeoutMs: 30000 },
      coach_decision: { maxTokens: 2500, timeoutMs: 30000 },
      rule_compilation: { maxTokens: 5000, timeoutMs: 30000 },
      plan_adaptation: { maxTokens: 3000, timeoutMs: 60000 },
      meal_photo: { maxTokens: 2500, timeoutMs: 30000 },
      voice_suggestions: { maxTokens: null, timeoutMs: 30000 },
    },
  );
  // A slower model-name family (Seed) raises the base of the two call sites
  // it needs more time for; the style multiplier then applies to that base.
  assert.equal(modelCallBudget("rule_compilation", seed).timeoutMs, 90000);
  assert.equal(modelCallBudget("meal_photo", seed).timeoutMs, 60000);
  assert.equal(modelCallBudget("coach_decision", seed).timeoutMs, 30000);
  assert.equal(modelCallBudget("rule_compilation", { ...seed, MODEL_TIMEOUT_MULTIPLIER: "2" }).timeoutMs, 180000);
  assert.equal(modelCallBudget("rule_compilation", { ...seed, MODEL_TIMEOUT_MULTIPLIER: "5" }).timeoutMs, 300000);
  assert.deepEqual(planGenerationBudget({ daysPerWeek: 3, weeks: 4 }, seed), planGenerationBudget({ daysPerWeek: 3, weeks: 4 }, classic));
  assert.deepEqual(nutritionBudget("nutrition_week", {}, seed), nutritionBudget("nutrition_week", {}, classic));
  assert.deepEqual(planGenerationBudget({ daysPerWeek: 3, weeks: 4 }, classic), { maxTokens: 6240, timeoutMs: 69000 });
  assert.deepEqual(planGenerationBudget({ daysPerWeek: 7, weeks: 53 }, classic), { maxTokens: 14950, timeoutMs: 166500 });
  assert.deepEqual(nutritionBudget("nutrition_week", {}, classic), { maxTokens: 12000, timeoutMs: 150000 });
  assert.equal(nutritionWeekLeaseSeconds(classic), 240);
  assert.equal(NUTRITION_WEEK_LEASE_SECONDS, 240);
  // Reasoning models get twice the time by default, within the 300 s cap.
  assert.equal(modelTimeoutMultiplier(reasoning), 2);
  assert.equal(modelCallBudget("coach_selection", reasoning).timeoutMs, 60000);
  assert.equal(modelCallBudget("plan_adaptation", reasoning).timeoutMs, 120000);
  assert.equal(planGenerationBudget({ daysPerWeek: 3, weeks: 4 }, reasoning).timeoutMs, 138000);
  assert.equal(planGenerationBudget({ daysPerWeek: 7, weeks: 53 }, reasoning).timeoutMs, 300000);
  assert.equal(nutritionBudget("nutrition_week", {}, reasoning).timeoutMs, 300000);
  // Output budgets do not change with the family.
  assert.equal(modelCallBudget("coach_selection", reasoning).maxTokens, 800);
  assert.equal(nutritionBudget("nutrition_week", {}, reasoning).maxTokens, 12000);
  // The week lease covers the longer limit plus the 90 s around the call.
  assert.equal(nutritionWeekLeaseSeconds(reasoning), 390);
  // Both multipliers are settings; invalid values fall back to the default.
  assert.equal(familyTimeoutMs(30000, { ...classic, MODEL_TIMEOUT_MULTIPLIER: "1.5" }), 45000);
  assert.equal(familyTimeoutMs(30000, { ...reasoning, MODEL_REASONING_TIMEOUT_MULTIPLIER: "3" }), 90000);
  assert.equal(familyTimeoutMs(30000, { ...reasoning, MODEL_TIMEOUT_MULTIPLIER: "5" }), 60000);
  assert.equal(familyTimeoutMs(30000, { ...classic, MODEL_TIMEOUT_MULTIPLIER: "0.5" }), 30000);
  assert.equal(familyTimeoutMs(30000, { ...classic, MODEL_TIMEOUT_MULTIPLIER: "abc" }), 30000);
  assert.equal(familyTimeoutMs(200000, { ...classic, MODEL_TIMEOUT_MULTIPLIER: "10" }), 300000);
  assert.equal(nutritionWeekLeaseSeconds({ ...classic, MODEL_TIMEOUT_MULTIPLIER: "1.5" }), 315);
});

test("the AI model settings accept only the documented request styles, efforts and multipliers", async () => {
  assert.deepEqual(
    validateIntegrationValues("model", {
      MODEL_REQUEST_STYLE: "reasoning",
      MODEL_REASONING_EFFORT: "low",
      MODEL_TIMEOUT_MULTIPLIER: "1.5",
      MODEL_REASONING_TIMEOUT_MULTIPLIER: "2",
    }),
    {
      MODEL_REQUEST_STYLE: "reasoning",
      MODEL_REASONING_EFFORT: "low",
      MODEL_TIMEOUT_MULTIPLIER: "1.5",
      MODEL_REASONING_TIMEOUT_MULTIPLIER: "2",
    },
  );
  for (const style of ["auto", "classic", "reasoning"])
    validateIntegrationValues("model", { MODEL_REQUEST_STYLE: style });
  validateIntegrationValues("model", { MODEL_REASONING_EFFORT: "" });
  for (const effort of ["auto", "omit", "none", "minimal", "low", "medium", "high"])
    validateIntegrationValues("model", { MODEL_REASONING_EFFORT: effort });
  for (const values of [
    { MODEL_REQUEST_STYLE: "fast" },
    { MODEL_REASONING_EFFORT: "extreme" },
    { MODEL_TIMEOUT_MULTIPLIER: "0.5" },
    { MODEL_TIMEOUT_MULTIPLIER: "11" },
    { MODEL_REASONING_TIMEOUT_MULTIPLIER: "1.234" },
    { MODEL_REASONING_TIMEOUT_MULTIPLIER: "-2" },
  ])
    assert.throws(() => validateIntegrationValues("model", values), ConfigurationError, JSON.stringify(values));
  // The connection test reports the style calls will start with.
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [{ id: "gpt-5-mini" }, { id: "coach-deployment" }] });
  try {
    const fields = {
      MODEL_BASE_URL: BASE,
      MODEL_API_KEY: "fixture-key",
      MODEL_INPUT_USD_PER_MILLION: "1",
      MODEL_OUTPUT_USD_PER_MILLION: "2",
      MODEL_PRICE_VERSION: "fixture-v1",
      MODEL_MAX_DAILY_CALLS: "100",
    };
    const auto = await testIntegration("model", { ...fields, MODEL_NAME: "gpt-5-mini" });
    assert.equal(auto.status, "verified");
    assert.deepEqual(auto.details, {
      model: "gpt-5-mini",
      requestStyle: "reasoning",
      requestStyleSource: "model_name",
      reasoningEffort: "low",
      reasoningEffortSource: "automatic",
      timeLimitMultiplier: 2,
    });
    const chosen = await testIntegration("model", {
      ...fields,
      MODEL_NAME: "coach-deployment",
      MODEL_REQUEST_STYLE: "reasoning",
      MODEL_REASONING_TIMEOUT_MULTIPLIER: "3",
    });
    assert.deepEqual(chosen.details, {
      model: "coach-deployment",
      requestStyle: "reasoning",
      requestStyleSource: "setting",
      reasoningEffort: "not_sent",
      reasoningEffortSource: "not_sent",
      timeLimitMultiplier: 3,
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("Super admin saves the request style and time limits; runtime settings and the cost row carry them", async () => {
  const { governanceFixture } = await import("./governance-fixtures.ts");
  const { loadRuntimeSettings } = await import("../apps/api/src/platform-settings.ts");
  const { modelAccounting } = await import("../apps/api/src/model-accounting.ts");
  const { randomBytes } = await import("node:crypto");
  const encryption = process.env.SECURITY_ENCRYPTION_KEY;
  process.env.SECURITY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const f = await governanceFixture();
  const original = globalThis.fetch;
  try {
    const admin = await f.operator("admin");
    const values = {
      MODEL_BASE_URL: "https://gateway-admin.invalid/v1",
      MODEL_NAME: "coach-deployment",
      MODEL_INPUT_USD_PER_MILLION: "2",
      MODEL_OUTPUT_USD_PER_MILLION: "8",
      MODEL_PRICE_VERSION: "fixture-v1",
      MODEL_MAX_DAILY_CALLS: "100",
      MODEL_REQUEST_STYLE: "reasoning",
      MODEL_REASONING_EFFORT: "low",
      MODEL_REASONING_TIMEOUT_MULTIPLIER: "3",
    };
    const refused = await f.call("/admin/settings/model", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: 0, enabled: true, values: { ...values, MODEL_REQUEST_STYLE: "fast" }, secrets: { MODEL_API_KEY: "fixture-key" } },
    });
    assert.equal(refused.statusCode, 400, refused.body);
    const saved = await f.call("/admin/settings/model", {
      method: "PUT",
      cookie: admin.cookie,
      body: { revision: 0, enabled: true, values, secrets: { MODEL_API_KEY: "fixture-key" } },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    // Blank fields with a default read as the default.
    assert.equal(saved.json().values.MODEL_TIMEOUT_MULTIPLIER, "1");
    assert.equal(saved.json().values.MODEL_REQUEST_STYLE, "reasoning");
    globalThis.fetch = async () => Response.json({ data: [{ id: "coach-deployment" }] });
    const checked = await f.call("/admin/settings/model/test", {
      cookie: admin.cookie,
      body: { revision: saved.json().revision },
    });
    assert.equal(checked.statusCode, 200, checked.body);
    assert.equal(checked.json().active, true);
    assert.equal(
      checked.json().lastTest.message,
      "Credentials verified with a read-only provider request. Calls start with the reasoning request style (chosen in these settings), reasoning effort low (chosen in these settings).",
    );
    const runtime = await loadRuntimeSettings(f.db);
    assert.equal(runtime.MODEL_REQUEST_STYLE, "reasoning");
    assert.equal(runtime.MODEL_REASONING_EFFORT, "low");
    assert.equal(runtime.MODEL_TIMEOUT_MULTIPLIER, "1");
    assert.equal(runtime.MODEL_REASONING_TIMEOUT_MULTIPLIER, "3");
    assert.equal(modelCallBudget("coach_selection", runtime).timeoutMs, 90000);
    // A call under these settings: reasoning request with the effort, and the
    // cost row records the reasoning tokens and the style.
    const owner = await f.person({ name: "Owner Gateway" });
    const actor = { tenantId: owner.tenantId, userId: owner.userId, role: "owner" };
    const sent: any[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({
        id: "chatcmpl-gateway",
        choices: [{ message: { content: '```json\n{"ok":true}\n```' } }],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
          completion_tokens_details: { reasoning_tokens: 320 },
        },
      });
    }) as typeof fetch;
    const { payload, usage } = await withRuntimeConfig(runtime, () =>
      modelCompletion(runtime.MODEL_BASE_URL!, runtime.MODEL_API_KEY!, runtime.MODEL_NAME!, { ...APP_BODY }, modelAccounting(f.db, actor as any, "coaching")),
    );
    assert.deepEqual(modelReplyJson(payload), { ok: true });
    assert.equal(sent[0].max_completion_tokens, 800);
    assert.equal(sent[0].reasoning_effort, "low");
    assert.equal("temperature" in sent[0], false);
    assert.equal(usage.cost, 0.006);
    const [row] = await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
      tx.query("SELECT status,input_tokens,output_tokens,cost_usd::text AS cost,pricing FROM cost_events WHERE task='coaching'"),
    );
    assert.equal(row.status, "recorded");
    assert.equal(row.input_tokens, 1000);
    assert.equal(row.output_tokens, 500);
    assert.equal(row.cost, "0.00600000");
    assert.deepEqual(row.pricing, {
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 8,
      reasoningTokens: 320,
      requestStyle: "reasoning",
      requestStyleSource: "setting",
      reasoningEffort: "low",
    });
  } finally {
    globalThis.fetch = original;
    await f.close();
    if (encryption === undefined) delete process.env.SECURITY_ENCRYPTION_KEY;
    else process.env.SECURITY_ENCRYPTION_KEY = encryption;
  }
});

// ---------------------------------------------------------------------------
// Review round (29 September 2026 retest of the fixed code, findings C1-C7).
// ---------------------------------------------------------------------------

const REFUSED_EFFORT_NONE = openaiError(
  "Unsupported value: 'reasoning_effort' does not support 'none' with this model. Supported values are: 'minimal', 'low', 'medium', and 'high'.",
  "reasoning_effort",
  "unsupported_value",
);
const REFUSED_EFFORT_PARAMETER = openaiError(
  "Unsupported parameter: 'reasoning_effort' is not supported with this model.",
  "reasoning_effort",
  "unsupported_parameter",
);

test("C2: gpt-5.1, 5.2 and 5.4 keep the call's temperature in the reasoning style unless a reasoning effort other than none is sent", () => {
  // Every model that accepted temperature 0.1 in the retest probe, with
  // snapshots, a routing prefix and a fine-tune.
  for (const model of [
    "gpt-5.1", "gpt-5.2", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano",
    "gpt-5.1-2025-11-13", "openai/gpt-5.4", "GPT-5.2", "ft:gpt-5.4-mini:org:tag:abc",
  ])
    assert.equal(reasoningModelAcceptsTemperature(model), true, model);
  // Every reasoning model that refused it, other variants and unknown IDs.
  for (const model of [
    "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra",
    "gpt-5.6-luna", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "o1", "o3", "o3-mini",
    "o4-mini", "chat-latest", "gpt-5.1-codex", "gpt-5.4-pro", "gpt-5.1-chat-latest",
    "coach-deployment", "gpt-4.1",
  ])
    assert.equal(reasoningModelAcceptsTemperature(model), false, model);
  const body = (model: string) => ({ ...APP_BODY, model, temperature: 0.1 });
  // No effort (automatic sends none to these models) or effort none: kept.
  for (const config of [{}, { MODEL_REASONING_EFFORT: "none" }, { MODEL_REASONING_EFFORT: "omit" }]) {
    const wire = styleRequestBody(body("gpt-5.1"), "reasoning", config);
    assert.equal(wire.temperature, 0.1, JSON.stringify(config));
    assert.equal(wire.max_completion_tokens, 800);
    assert.equal("max_tokens" in wire, false);
  }
  assert.equal(styleRequestBody(body("gpt-5.4-nano"), "reasoning", {}).temperature, 0.1);
  assert.equal(reasoningKeepsTemperature({ MODEL_NAME: "gpt-5.2" }), true);
  // Another effort: OpenAI takes a temperature only with effort none.
  for (const effort of ["minimal", "low", "medium", "high"]) {
    const wire = styleRequestBody(body("gpt-5.1"), "reasoning", { MODEL_REASONING_EFFORT: effort });
    assert.equal("temperature" in wire, false, effort);
    assert.equal(wire.reasoning_effort, effort);
  }
  // The refusing families lose it, as before.
  for (const model of ["gpt-5-mini", "gpt-5.5", "gpt-6-luna", "o3", "coach-deployment"])
    assert.equal("temperature" in styleRequestBody(body(model), "reasoning", {}), false, model);
  // A temperature the provider refused before is withheld.
  assert.equal("temperature" in styleRequestBody(body("gpt-5.1"), "reasoning", {}, ["temperature"]), false);
});

test("C2: a kept temperature the provider refuses is dropped once, in any style setting, and remembered", async () => {
  for (const settings of [{}, { MODEL_REQUEST_STYLE: "reasoning" }]) {
    forgetLearnedModelRequestStyles();
    const { events, rows, accounting } = ledger();
    await withProvider([{ status: 400, body: REFUSED_TEMPERATURE_01 }, ok("{}")], async (sent) => {
      const { usage } = await withRuntimeConfig({ ...PRICED, ...settings }, () =>
        modelCompletion(BASE, "fixture-key", "gpt-5.4-mini", { ...APP_BODY, temperature: 0.1 }, accounting),
      );
      assert.equal(sent.length, 2);
      assert.equal(sent[0].body.temperature, 0.1);
      assert.equal(sent[0].body.max_completion_tokens, 800);
      assert.equal("temperature" in sent[1].body, false);
      assert.equal(sent[1].body.max_completion_tokens, 800);
      assert.deepEqual(usage.request, {
        style: "reasoning",
        source: "refusal_retry",
        retriedAfterRefusal: "temperature",
        reasoningEffort: null,
      });
    });
    assert.deepEqual(events, ["reserve:gpt-5.4-mini", "record"]);
    assert.equal(rows.length, 1);
    assert.deepEqual(learnedWithheldParameters(BASE, "gpt-5.4-mini"), ["temperature"]);
    // The next call leaves it out from the start.
    await withProvider([ok("{}")], async (sent) => {
      await withRuntimeConfig({ ...PRICED, ...settings }, () =>
        modelCompletion(BASE, "fixture-key", "gpt-5.4-mini", { ...APP_BODY, temperature: 0.1 }, ledger().accounting),
      );
      assert.equal(sent.length, 1);
      assert.equal("temperature" in sent[0].body, false);
    });
  }
  // A classic refusal of the temperature switches style and withholds it.
  forgetLearnedModelRequestStyles();
  assert.deepEqual(
    retryAfterRefusal("temperature", { style: "classic", withheld: [] }, { switchStyle: true, automaticEffort: true }),
    { style: "reasoning", withheld: ["temperature"] },
  );
  assert.equal(
    retryAfterRefusal("temperature", { style: "classic", withheld: [] }, { switchStyle: false, automaticEffort: true }),
    null,
  );
  // In the reasoning style a temperature counts only when it was sent.
  assert.equal(refusedStyleParameter(400, REFUSED_TEMPERATURE_01, "reasoning"), null);
  assert.equal(
    refusedStyleParameter(400, REFUSED_TEMPERATURE_01, "reasoning", { temperature: 0.1 }),
    "temperature",
  );
});

test("C5: automatic reasoning effort is low for the models whose default spent the output budget, and not sent to others", () => {
  for (const model of [
    "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5-mini-2025-08-07", "openai/gpt-5-nano",
    "o1", "o3", "o3-mini", "o4-mini", "o4-mini-2025-04-16", "ft:gpt-5-mini:org:tag:abc",
  ])
    assert.equal(automaticReasoningEffort(model), "low", model);
  for (const model of [
    "gpt-5.1", "gpt-5.2", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-5.6-sol",
    "gpt-6-luna", "chat-latest", "gpt-5-chat-latest", "gpt-5-pro", "gpt-5-codex",
    "o1-mini", "o1-preview", "o3-pro", "coach-deployment", "gpt-4.1", "",
  ])
    assert.equal(automaticReasoningEffort(model), null, model);
  // The setting: automatic (default, blank or unknown), not sent, or a level.
  assert.equal(modelReasoningEffort({ MODEL_NAME: "gpt-5-mini" }), "low");
  assert.equal(modelReasoningEffort({ MODEL_NAME: "gpt-5-mini", MODEL_REASONING_EFFORT: "auto" }), "low");
  assert.equal(modelReasoningEffort({ MODEL_NAME: "gpt-5-mini", MODEL_REASONING_EFFORT: "bogus" }), "low");
  assert.equal(modelReasoningEffort({ MODEL_NAME: "gpt-5-mini", MODEL_REASONING_EFFORT: "omit" }), null);
  assert.equal(modelReasoningEffort({ MODEL_NAME: "gpt-5-mini", MODEL_REASONING_EFFORT: "high" }), "high");
  assert.equal(modelReasoningEffort({ MODEL_NAME: "gpt-5.1", MODEL_REASONING_EFFORT: "low" }), "low");
  // On the wire: reasoning style only.
  const wire = (model: string, config = {}) =>
    styleRequestBody({ ...APP_BODY, model }, requestStyleForModel(model), config);
  assert.equal(wire("gpt-5-nano").reasoning_effort, "low");
  assert.equal(wire("o3-mini").reasoning_effort, "low");
  assert.equal("reasoning_effort" in wire("gpt-5.5"), false);
  assert.equal("reasoning_effort" in wire("gpt-5-nano", { MODEL_REASONING_EFFORT: "omit" }), false);
  assert.equal("reasoning_effort" in wire("seed-2-0-pro-260328"), false);
});

test("C5: a refused automatic effort is dropped once and remembered; a refused chosen effort fails with the setting to change", async () => {
  // Automatic: one retry without it, learned for the next call.
  for (const refusal of [REFUSED_EFFORT_NONE, REFUSED_EFFORT_PARAMETER]) {
    forgetLearnedModelRequestStyles();
    const { events, accounting } = ledger();
    await withProvider([{ status: 400, body: refusal }, ok("{}")], async (sent) => {
      const { usage } = await withRuntimeConfig(PRICED, () =>
        modelCompletion(BASE, "fixture-key", "o3-mini", { ...APP_BODY }, accounting),
      );
      assert.equal(sent.length, 2);
      assert.equal(sent[0].body.reasoning_effort, "low");
      assert.equal("reasoning_effort" in sent[1].body, false);
      assert.equal(sent[1].body.max_completion_tokens, 800);
      assert.equal(usage.request?.retriedAfterRefusal, "reasoning_effort");
      assert.equal(usage.request?.source, "refusal_retry");
      assert.equal(usage.request?.reasoningEffort, null);
    });
    assert.deepEqual(events, ["reserve:o3-mini", "record"]);
    assert.deepEqual(learnedWithheldParameters(BASE, "o3-mini"), ["reasoning_effort"]);
    await withProvider([ok("{}")], async (sent) => {
      await withRuntimeConfig(PRICED, () =>
        modelCompletion(BASE, "fixture-key", "o3-mini", { ...APP_BODY }, ledger().accounting),
      );
      assert.equal("reasoning_effort" in sent[0].body, false);
    });
    // A chosen effort is never suppressed by what automatic learned.
    await withProvider([ok("{}")], async (sent) => {
      await withRuntimeConfig({ ...PRICED, MODEL_REASONING_EFFORT: "high" }, () =>
        modelCompletion(BASE, "fixture-key", "o3-mini", { ...APP_BODY }, ledger().accounting),
      );
      assert.equal(sent[0].body.reasoning_effort, "high");
    });
  }
  // Chosen: sent exactly, no retry, and the failure names the value and the setting.
  forgetLearnedModelRequestStyles();
  const { events, accounting } = ledger();
  await withProvider([{ status: 400, body: REFUSED_EFFORT_NONE }], async (sent) => {
    await assert.rejects(
      withRuntimeConfig({ ...PRICED, MODEL_REASONING_EFFORT: "none" }, () =>
        modelCompletion(BASE, "fixture-key", "gpt-5-mini", { ...APP_BODY }, accounting),
      ),
      (error: any) => {
        assert.equal(
          error.message,
          "Model request failed (400): the provider does not accept reasoning_effort none for this model (reasoning request style); choose another AI model reasoning effort, or automatic; usage has been retained",
        );
        assert.doesNotMatch(error.message, /Supported values/);
        return true;
      },
    );
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.reasoning_effort, "none");
  });
  assert.deepEqual(events, ["reserve:gpt-5-mini", "record"]);
  assert.deepEqual(learnedWithheldParameters(BASE, "gpt-5-mini"), []);
  // The structured field pair alone is recognised too; in classic it never is.
  assert.equal(
    refusedStyleParameter(400, openaiError("Bad request", "reasoning_effort", "unsupported_value"), "reasoning", { reasoning_effort: "low" }),
    "reasoning_effort",
  );
  assert.equal(refusedStyleParameter(400, REFUSED_EFFORT_NONE, "classic", { reasoning_effort: "low" }), null);
});

test("C4: the reasoning effort setting says what unselected sends, labels the model-limited levels and the check warns about a mismatch", async () => {
  const model = INTEGRATION_CATALOG.find((d) => d.id === "model")!;
  const effort = model.fields.find((f) => f.key === "MODEL_REASONING_EFFORT")!;
  assert.equal(effort.defaultValue, "auto");
  assert.deepEqual(
    effort.options!.map((o) => [o.value, o.label]),
    [
      ["auto", "Automatic (low for GPT-5, GPT-5 mini and nano and the o-series; not sent to others)"],
      ["omit", "Not sent (the provider's default)"],
      ["none", "none (GPT-5.1 and later only)"],
      ["minimal", "minimal (gpt-5, gpt-5-mini and gpt-5-nano only)"],
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
    ],
  );
  assert.doesNotMatch(effort.help!, /send none/);
  assert.match(effort.help!, /sends nothing to other models \(the provider's default/);
  assert.match(effort.help!, /a refused chosen level fails every AI call until it is changed/);
  // Documented mismatches only; deployment names are never flagged.
  for (const [name, level, expected] of [
    ["gpt-5-mini", "none", "none is accepted by GPT-5.1 and later only"],
    ["gpt-5", "none", "none is accepted by GPT-5.1 and later only"],
    ["o3", "none", "none is accepted by GPT-5.1 and later only"],
    ["o4-mini", "minimal", "minimal is documented for gpt-5, gpt-5-mini and gpt-5-nano only"],
    ["gpt-5.1", "minimal", "minimal is documented for gpt-5, gpt-5-mini and gpt-5-nano only"],
    ["gpt-6-luna", "minimal", "minimal is documented for gpt-5, gpt-5-mini and gpt-5-nano only"],
    ["gpt-5.1", "none", null],
    ["gpt-5-nano", "minimal", null],
    ["o3", "low", null],
    ["coach-deployment", "none", null],
    ["gpt-5-mini", "auto", null],
  ] as const)
    assert.equal(reasoningEffortMismatch({ MODEL_NAME: name, MODEL_REASONING_EFFORT: level }), expected, `${name} ${level}`);
  // The connection check carries the warning (details and note).
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [{ id: "gpt-5-mini" }] });
  try {
    const fields = {
      MODEL_BASE_URL: BASE,
      MODEL_API_KEY: "fixture-key",
      MODEL_NAME: "gpt-5-mini",
      MODEL_INPUT_USD_PER_MILLION: "1",
      MODEL_OUTPUT_USD_PER_MILLION: "2",
      MODEL_PRICE_VERSION: "fixture-v1",
      MODEL_MAX_DAILY_CALLS: "100",
      MODEL_REASONING_EFFORT: "none",
    };
    const checked = await testIntegration("model", fields);
    assert.equal(checked.status, "verified");
    assert.equal(checked.details?.reasoningEffort, "none");
    assert.equal(checked.details?.reasoningEffortSource, "setting");
    assert.equal(checked.details?.reasoningEffortWarning, "none is accepted by GPT-5.1 and later only");
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(
    describeModelRequest(BASE, "gpt-5-mini", { MODEL_REASONING_EFFORT: "none" }).note,
    "Calls start with the reasoning request style (from the model ID), reasoning effort none (chosen in these settings). The chosen reasoning effort may be refused: none is accepted by GPT-5.1 and later only; a refused level fails every AI call until it is changed. A refused request parameter is retried once and recorded on the AI cost row.",
  );
  // C5: the reasoning style without any effort says so.
  assert.equal(
    describeModelRequest(BASE, "coach-deployment", { MODEL_REQUEST_STYLE: "reasoning" }).note,
    "Calls start with the reasoning request style (chosen in these settings), no reasoning effort (the provider's default; choose low if replies stop at the output limit).",
  );
  assert.equal(
    describeModelRequest(BASE, "gpt-5-nano", {}).note,
    "Calls start with the reasoning request style (from the model ID), reasoning effort low (automatic for this model). A refused request parameter is retried once and recorded on the AI cost row.",
  );
  assert.equal(
    describeModelRequest(BASE, "gpt-4.1", {}).note,
    "Calls start with the classic request style (from the model ID). A refused request parameter is retried once and recorded on the AI cost row.",
  );
  // A chosen classic style never sends an effort, so it is not flagged.
  assert.equal(
    describeModelRequest(BASE, "gpt-5-mini", { MODEL_REQUEST_STYLE: "classic", MODEL_REASONING_EFFORT: "none" }).reasoningEffortWarning,
    null,
  );
});

test("C1: the request style and reasoning effort are part of every qualification pin; the default classic pin is unchanged", () => {
  const base = { MODEL_BASE_URL: BASE, MODEL_API_KEY: "fixture-key", MODEL_NAME: "gpt-4.1" };
  const pins = (config: Record<string, string>) =>
    withRuntimeConfig(config, () => ({
      coaching: coachingModelPin(),
      plan: planModelPin(),
      nutrition: nutritionModelIdentity(),
    }));
  // The default classic request is the request sent before request styles:
  // its pins keep exactly their earlier keys, so qualifications stay valid.
  const classic = pins(base);
  assert.deepEqual(Object.keys(classic.coaching), ["endpoint", "model", "promptVersion", "policyVersion", "retrieval"]);
  assert.deepEqual(Object.keys(classic.plan), [
    "endpoint", "model", "promptVersion", "adaptationPromptVersion", "validatorVersion", "confidenceVersion", "retrieval",
  ]);
  assert.deepEqual(Object.keys(classic.nutrition), ["base", "model", "promptVersion"]);
  assert.equal(modelRequestPin(base), null);
  assert.equal(modelRequestPin({ ...base, MODEL_REASONING_EFFORT: "omit" }), null);
  // The reviewer's probe: classic to reasoning on gpt-4.1, and an effort.
  const variants: Record<string, Record<string, string>> = {
    reasoning: { ...base, MODEL_REQUEST_STYLE: "reasoning" },
    classicChosen: { ...base, MODEL_REQUEST_STYLE: "classic" },
    effort: { ...base, MODEL_REASONING_EFFORT: "minimal" },
    reasoningEffort: { ...base, MODEL_REQUEST_STYLE: "reasoning", MODEL_REASONING_EFFORT: "minimal" },
  };
  const seen = new Set([JSON.stringify(classic)]);
  for (const [name, config] of Object.entries(variants)) {
    const p = pins(config);
    for (const key of ["coaching", "plan", "nutrition"] as const)
      assert.notDeepEqual(p[key], classic[key], `${name} ${key}`);
    assert.equal(seen.has(JSON.stringify(p)), false, name);
    seen.add(JSON.stringify(p));
  }
  assert.deepEqual(pins(variants.reasoningEffort).coaching.request, {
    style: "reasoning",
    family: "reasoning",
    reasoningEffort: "minimal",
    temperature: false,
  });
  // A reasoning model under auto: the family the ID implies and the automatic effort.
  const mini = { ...base, MODEL_NAME: "gpt-5-mini" };
  assert.deepEqual(modelRequestPin(mini), { style: "auto", family: "reasoning", reasoningEffort: "low", temperature: false });
  assert.notDeepEqual(modelRequestPin({ ...mini, MODEL_REASONING_EFFORT: "medium" }), modelRequestPin(mini));
  assert.notDeepEqual(modelRequestPin({ ...mini, MODEL_REQUEST_STYLE: "reasoning" }), modelRequestPin(mini));
  assert.deepEqual(modelRequestPin({ ...base, MODEL_NAME: "gpt-5.1" }), {
    style: "auto",
    family: "reasoning",
    reasoningEffort: null,
    temperature: true,
  });
  // A style learned from a refusal is not pinned.
  forgetLearnedModelRequestStyles();
  const before = JSON.stringify(pins(base));
  learnModelRequestStyle(BASE, "gpt-4.1", "reasoning", ["temperature"]);
  assert.equal(resolveModelRequestStyle(BASE, "gpt-4.1", base).style, "reasoning");
  assert.equal(JSON.stringify(pins(base)), before);
  forgetLearnedModelRequestStyles();
  // The time multipliers change no pin (they change no request).
  assert.deepEqual(pins({ ...base, MODEL_TIMEOUT_MULTIPLIER: "3" }), classic);
});

test("C1: changing the request style or effort changes the coaching material digest, the plan contract and the nutrition digest (PGlite)", async () => {
  const { governanceFixture } = await import("./governance-fixtures.ts");
  const { coachingRuntimeReadiness } = await import("../apps/api/src/coaching-runtime.ts");
  const { planQualificationState } = await import("../apps/api/src/brain-plans.ts");
  const { nutritionMaterial, nutritionReadiness } = await import("../apps/api/src/nutrition.ts");
  const { defaultPlanSettings } = await import("../packages/domain/src/brain-plans.ts");
  const { putRecord } = await import("@trainer/db");
  const f = await governanceFixture();
  try {
    const owner = await f.person({ name: "Owner Pins" });
    const actor = f.scoped(owner.tenantId);
    const base = { MODEL_BASE_URL: BASE, MODEL_API_KEY: "fixture-key", MODEL_NAME: "gpt-4.1" };
    const digests = (config: Record<string, string>) =>
      withRuntimeConfig(config, () =>
        f.db.tenant(actor, async (tx) => ({
          coaching: (await coachingRuntimeReadiness(tx)).contractDigest,
          plan: (await planQualificationState(tx, defaultPlanSettings())).contractDigest,
          nutrition: (await nutritionMaterial(tx)).digest,
        })),
      );
    const classic = await digests(base);
    assert.deepEqual(await digests(base), classic, "stable");
    // The time multiplier changes no request and no digest.
    assert.deepEqual(await digests({ ...base, MODEL_TIMEOUT_MULTIPLIER: "2" }), classic);
    const changes: Array<Record<string, string>> = [
      { MODEL_REQUEST_STYLE: "reasoning" },
      { MODEL_REQUEST_STYLE: "classic" },
      { MODEL_REASONING_EFFORT: "minimal" },
      { MODEL_REQUEST_STYLE: "reasoning", MODEL_REASONING_EFFORT: "high" },
    ];
    for (const change of changes) {
      const changed = await digests({ ...base, ...change });
      for (const key of ["coaching", "plan", "nutrition"] as const)
        assert.notEqual(changed[key], classic[key], `${JSON.stringify(change)} ${key}`);
    }
    // An activated nutrition release says why automatic weeks paused.
    await withRuntimeConfig(base, () =>
      f.db.tenant(actor, async (tx) => {
        const material = await nutritionMaterial(tx);
        await putRecord(
          tx,
          actor,
          "nutrition_release",
          { qualificationVersion: 2, digest: material.digest, model: nutritionModelIdentity() },
          { status: "published", ownerId: owner.userId },
        );
      }),
    );
    const gaps = (config: Record<string, string>) =>
      withRuntimeConfig(config, () => f.db.tenant(actor, async (tx) => (await nutritionReadiness(tx)).gaps as string[]));
    assert.equal((await gaps(base)).some((g) => /after activation/.test(g)), false);
    assert.ok(
      (await gaps({ ...base, MODEL_REQUEST_STYLE: "reasoning" })).includes(
        "The AI model's request style or reasoning effort changed after activation. New automatic weeks and swaps pause until you evaluate and activate again; delivered plans stay available.",
      ),
    );
    assert.ok(
      (await gaps({ ...base, MODEL_NAME: "gpt-4o" })).some((g) => g.startsWith("The model connection changed after activation")),
    );
  } finally {
    await f.close();
  }
});

test("C3: a brain_plan job's lease covers its longest model call for the configured family", () => {
  const classic = { MODEL_NAME: "gpt-4.1" };
  const seed = { MODEL_NAME: "seed-2-0-pro-260328" };
  const reasoning = { MODEL_NAME: "gpt-5-mini" };
  assert.equal(modelFamily(seed), "classic");
  assert.equal(brainPlanLeaseSeconds(classic), 257);
  assert.equal(brainPlanLeaseSeconds(reasoning), 390);
  assert.equal(brainPlanLeaseSeconds({ ...classic, MODEL_TIMEOUT_MULTIPLIER: "1.5" }), 340);
  assert.equal(brainPlanLeaseSeconds({ ...reasoning, MODEL_REASONING_TIMEOUT_MULTIPLIER: "10" }), 390);
  // Every plan size and the weekly adjustment fit, with 90 s for the
  // transactions around the call (the reviewer's probe sizes included).
  for (const config of [classic, reasoning, { ...classic, MODEL_TIMEOUT_MULTIPLIER: "1.5" }]) {
    const lease = brainPlanLeaseSeconds(config) * 1000;
    for (let days = 1; days <= 7; days++)
      for (let weeks = 1; weeks <= 53; weeks++)
        assert.ok(planGenerationBudget({ daysPerWeek: days, weeks }, config).timeoutMs + 90000 <= lease, `${days}x${weeks}`);
    assert.ok(modelCallBudget("plan_adaptation", config).timeoutMs + 90000 <= lease);
  }
});

test("C3/C7: the worker's claim leases meal weeks and Brain plan jobs for the configured family; other jobs keep two minutes (PGlite)", async () => {
  const { governanceFixture } = await import("./governance-fixtures.ts");
  const { claimJob } = await import("../apps/worker/src/dispatch.ts");
  const f = await governanceFixture();
  try {
    const owner = await f.person({ name: "Owner Leases" });
    const worker = f.scoped(owner.tenantId, "staff");
    const leases = async (config: Record<string, string>) => {
      await f.db.tenant(worker, (tx) => tx.query("UPDATE jobs SET status='cancelled' WHERE status='pending'"));
      for (const [kind, wait] of [["nutrition_week", 30], ["brain_plan", 20], ["email", 10]] as const) {
        const id = randomUUID();
        await f.db.tenant(worker, (tx) =>
          tx.query(
            `INSERT INTO jobs(id,tenant_id,kind,intent_key,data,available_at) VALUES($1,$2,$3,$4,$5,now()-interval '${wait} seconds')`,
            [id, owner.tenantId, kind, "gateway:" + id, JSON.stringify({})],
          ),
        );
      }
      const out: Record<string, number> = {};
      for (let i = 0; i < 3; i++) {
        const job = (await withRuntimeConfig(config, () => claimJob(f.db, owner.tenantId)))!;
        const [row] = await f.db.tenant(worker, (tx) =>
          tx.query("SELECT extract(epoch FROM leased_until-now())::float8 AS lease FROM jobs WHERE id=$1", [job.id]),
        );
        out[job.kind] = row.lease;
      }
      return out;
    };
    const near = (actual: number, expected: number, label: string) =>
      assert.ok(actual > expected - 10 && actual <= expected, `${label}: ${actual} (expected about ${expected})`);
    const reasoning = await leases({ MODEL_NAME: "gpt-5-mini" });
    near(reasoning.nutrition_week, 390, "reasoning meal week");
    near(reasoning.brain_plan, 390, "reasoning brain plan");
    near(reasoning.email, 120, "email");
    const classic = await leases({ MODEL_NAME: "seed-2-0-pro-260328" });
    near(classic.nutrition_week, NUTRITION_WEEK_LEASE_SECONDS, "classic meal week");
    near(classic.brain_plan, 257, "classic brain plan");
    near(classic.email, 120, "email");
  } finally {
    await f.close();
  }
});

// C7 (a) and (b): every call site passes its own budget's time limit to the
// provider request, and reads a reply in one ```json fence exactly as the
// same reply without it, under a reasoning model's configuration.
const REASONING_SITE = {
  ...PRICED,
  MODEL_BASE_URL: BASE,
  MODEL_API_KEY: "fixture-key",
  MODEL_NAME: "gpt-5-mini",
  MODEL_VISION_ENABLED: "true",
  MEAL_PHOTOS_ENABLED: "true",
};
/** Runs fn with a provider answering `content`; returns the result (or error) and the time limits set. */
async function atCallSite(content: string, fn: () => Promise<unknown>) {
  const limits: number[] = [];
  const timeout = AbortSignal.timeout;
  AbortSignal.timeout = ((ms: number) => {
    limits.push(ms);
    return timeout.call(AbortSignal, ms);
  }) as typeof AbortSignal.timeout;
  try {
    return await withProvider([ok(content)], async (sent) => {
      let result: unknown, error: any = null;
      try {
        result = await withRuntimeConfig(REASONING_SITE, fn);
      } catch (e) {
        error = e;
      }
      return { result, error, limits, body: sent[0]?.body };
    });
  } finally {
    AbortSignal.timeout = timeout;
  }
}
const fenced = (json: string) => "```json\n" + json + "\n```";
test("C7: each call site sends its budget's time limit and reads one outer ```json fence like the plain reply (reasoning model)", async () => {
  const ruleId = randomUUID(),
    actionId = randomUUID(),
    sourceId = randomUUID();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const planInput = {
    profile: { goal: "Build strength", experience: "beginner", daysPerWeek: 3, equipment: "Dumbbells" },
    programme: { days: 28, weeks: 4, startDate: "2026-10-01" },
    bounds: {},
    twin: null,
    previous: null,
    material: { rules: [], cases: [], examples: [], templates: [] } as any,
  };
  const sites: Array<{
    name: string;
    timeoutMs: number;
    reply: string;
    call: () => Promise<unknown>;
    /** What must hold for the plain reply (it parsed and passed). */
    parsed: (result: any) => void;
  }> = [
    {
      name: "selectCoachAction (coach_selection)",
      timeoutMs: modelCallBudget("coach_selection", REASONING_SITE).timeoutMs,
      reply: JSON.stringify({ actionId: "K1", requiresHumanReview: false, reason: "Fits the action.", evidenceIds: ["R1"] }),
      call: () =>
        selectCoachAction(
          {
            tenantId: randomUUID(),
            request: "I am tired and sore today",
            facts: {},
            actions: [{ id: actionId, data: { type: "message", evidenceIds: [ruleId], allowedUses: ["model_prompt"] } }],
            examples: [],
            rules: [{ id: ruleId, data: { directive: "Deload when tired", allowedUses: ["model_prompt"] } }],
          },
          ledger().accounting,
        ),
      parsed: (r) => assert.equal(r.selection.actionId, actionId),
    },
    {
      name: "modelDecision (coach_decision)",
      timeoutMs: modelCallBudget("coach_decision", REASONING_SITE).timeoutMs,
      reply: JSON.stringify({ type: "message", message: "Keep today's session light.", reason: "Rule applies.", evidenceIds: ["EV1"], requiresHumanReview: true }),
      call: () =>
        modelDecision("coaching_draft", "I am tired", [{ id: ruleId, data: { directive: "Deload", allowedUses: ["model_prompt"] } }], ledger().accounting),
      parsed: (r) => assert.deepEqual(r.decision.evidenceIds, [ruleId]),
    },
    {
      name: "compileTrainerRules (rule_compilation)",
      timeoutMs: modelCallBudget("rule_compilation", REASONING_SITE).timeoutMs,
      reply: JSON.stringify({ rules: [], conflicts: [] }),
      call: () =>
        compileTrainerRules(
          [{ id: sourceId, data: { title: "Method", text: "Deload every fourth week.", allowedUses: ["model_prompt", "trainer_specific_learning"] } }],
          ledger().accounting,
        ),
      parsed: (r) => assert.deepEqual(r.rules, []),
    },
    {
      name: "generateTrainingPlan (planGenerationBudget)",
      timeoutMs: planGenerationBudget({ daysPerWeek: 3, weeks: 4 }, REASONING_SITE).timeoutMs,
      reply: JSON.stringify({ title: "Plan" }),
      call: () => generateTrainingPlan(planInput, ledger().accounting),
      // A parsed object reaches the schema (its errors name the missing
      // fields); unreadable content is the null-content error instead.
      parsed: (r) => {
        assert.ok(r.errors.length > 1, JSON.stringify(r.errors));
        assert.ok(!r.errors.includes("Model output: plan Invalid input: expected object, received null"), JSON.stringify(r.errors));
      },
    },
    {
      name: "proposePlanAdaptation (plan_adaptation)",
      timeoutMs: modelCallBudget("plan_adaptation", REASONING_SITE).timeoutMs,
      reply: JSON.stringify({ changes: [], reason: "Keep next week as planned.", selfConfidence: 0.8, uncertainties: [], evidenceIds: [] }),
      call: () =>
        proposePlanAdaptation(
          { profile: planInput.profile, week: 1, currentWeek: {}, nextWeek: {}, outcomes: {}, progressionHold: [], bounds: {}, material: planInput.material },
          ledger().accounting,
        ),
      parsed: (r) => {
        assert.deepEqual(r.errors, []);
        assert.equal(r.proposal.reason, "Keep next week as planned.");
      },
    },
    {
      name: "estimateMealPhoto (meal_photo)",
      timeoutMs: modelCallBudget("meal_photo", REASONING_SITE).timeoutMs,
      reply: JSON.stringify({
        items: [{ name: "Rice", portion: "One bowl", amount: 150, unit: "g", kcal: 195, protein: 4, carbohydrate: 42, fat: 2, preparation: "cooked", uncertainty: "Photo estimate" }],
        questions: [],
        notes: "Estimated from the photo.",
      }),
      call: () => estimateMealPhoto(jpeg, "lunch", ledger().accounting),
      parsed: (r) => assert.equal(r.items[0].name, "Rice"),
    },
    {
      name: "nutritionModel week (nutritionBudget)",
      timeoutMs: nutritionBudget("nutrition_week", {}, REASONING_SITE).timeoutMs,
      reply: JSON.stringify({ ok: true }),
      call: () => nutritionModel("nutrition_week", "Return {ok}.", {}, z.object({ ok: z.boolean() }).strict(), ledger().accounting),
      parsed: (r) => assert.deepEqual(r, { ok: true }),
    },
    {
      name: "nutritionModel evaluation (nutritionBudget)",
      timeoutMs: nutritionBudget("nutrition_evaluation", {}, REASONING_SITE).timeoutMs,
      reply: JSON.stringify({ ok: true }),
      call: () => nutritionModel("nutrition_evaluation", "Return {ok}.", {}, z.object({ ok: z.boolean() }).strict(), ledger().accounting),
      parsed: (r) => assert.deepEqual(r, { ok: true }),
    },
  ];
  for (const site of sites) {
    // The reasoning family's limit differs from the classic default, so a
    // dropped {timeoutMs} (30 s) would fail here.
    assert.notEqual(site.timeoutMs, 30000, site.name);
    const plain = await atCallSite(site.reply, site.call);
    assert.equal(plain.error, null, `${site.name}: ${plain.error?.message}`);
    site.parsed(plain.result);
    assert.deepEqual(plain.limits, [site.timeoutMs], site.name);
    // The reasoning request: no max_tokens, the automatic effort.
    assert.equal("max_tokens" in plain.body, false, site.name);
    assert.equal(plain.body.reasoning_effort, "low", site.name);
    const wrapped = await atCallSite(fenced(site.reply), site.call);
    assert.equal(wrapped.error, null, `${site.name} (fenced): ${wrapped.error?.message}`);
    const strip = (value: any) => JSON.parse(JSON.stringify(value, (k, v) => (k === "usage" || k === "retrieval" ? undefined : v)));
    assert.deepEqual(strip(wrapped.result), strip(plain.result), site.name);
    // Prose around the fence is still not unwrapped.
    const prose = await atCallSite("Here it is: " + fenced(site.reply), site.call);
    assert.notDeepEqual(
      prose.error ? String(prose.error?.name) : strip(prose.result),
      strip(plain.result),
      `${site.name} (prose)`,
    );
  }
});
