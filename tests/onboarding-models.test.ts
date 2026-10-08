import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyChat, parseChatReply, mergeChatFacts } from "../packages/domain/src/onboarding-chat.ts";
import { onboardingReply } from "../packages/providers/src/onboarding-chat.ts";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import { modelCallBudget } from "../packages/providers/src/model-request.ts";
import { isSeed20Model, profilePresentation, coachModelLabel, profileRuntimeKeys, type ModelProfileRow } from "../packages/providers/src/model-profiles.ts";

const base = "https://onboarding-models.invalid/v1";
const question = { field: "audience", text: "Who do you usually coach?" };
const clarification = { reply: "Start with who you usually coach.", patch: null, evidence: null, question: null, questionField: null };
const chat = () => ({ ...emptyChat("coach"), messages: [{ id: "person", from: "person" as const, text: "Which one should I answer?", at: new Date().toISOString() }] });
const completion = (content: unknown, finish_reason = "stop") => ({ choices: [{ message: { content }, finish_reason }], usage: { prompt_tokens: 30, completion_tokens: 20 } });
async function withReply<T>(config: Record<string, string>, payload: unknown, run: (send: () => ReturnType<typeof onboardingReply>, sent: any[], costs: any[]) => Promise<T>) {
  const original = globalThis.fetch, sent: any[] = [], costs: any[] = [];
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith(base), "Only the isolated model transport may be called");
    sent.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers)), body: JSON.parse(String(init?.body)) });
    return Response.json(payload);
  };
  try {
    return await withRuntimeConfig({ MODEL_BASE_URL: base, MODEL_API_KEY: "fixture", MODEL_NAME: "seed-2-0-pro-260328", MODEL_REQUEST_STYLE: "auto", ...config }, () => run(
      () => onboardingReply(chat(), question, [], [], false, { reserve: async () => undefined, record: async usage => { costs.push(usage); } }), sent, costs,
    ));
  } finally { globalThis.fetch = original; }
}

test("clarification replies accept empty/null optional fields and ignore unused metadata without inventing facts", () => {
  const reply = parseChatReply({ ...clarification, debug: "ignored", patch: { audience: "athletes" }, evidence: {} });
  assert.equal(reply.question, undefined);
  assert.equal((reply as any).debug, undefined);
  assert.deepEqual(mergeChatFacts(chat(), reply, "Which one should I answer?", "person", "now", []).facts, {});
  for (const raw of [null, [], "answer", {}, { reply: " " }, { reply: "OK", patch: [] }, { reply: "OK", evidence: { age: { quote: "28" } } }])
    assert.throws(() => parseChatReply(raw));
});

for (const model of ["seed-2-0-pro-260328", "gpt-5.5", "other-compatible-model"]) {
  test(`onboarding uses the current ${model} connection, request style and task budget`, async () => {
    await withReply({ MODEL_NAME: model, MODEL_CALL_BUDGETS: JSON.stringify({ onboarding_reply: { maxTokens: 6200, timeoutMs: 90000 } }) }, completion(JSON.stringify(clarification)), async (send, sent, costs) => {
      const reply = await send();
      assert.equal(reply.reply, clarification.reply);
      assert.deepEqual(reply.patch, {});
      assert.equal(sent.length, 1); assert.equal(costs.length, 1);
      assert.equal(sent[0].url, base + "/chat/completions");
      assert.equal(sent[0].body.model, model);
      assert.equal(sent[0].body[model.startsWith("gpt-") ? "max_completion_tokens" : "max_tokens"], 6200);
      assert.equal(costs[0].model, model);
      assert.match(sent[0].body.messages[0].content, /evidence is an object/);
    });
  });
}

test("native Claude onboarding uses the active Messages adapter and accepts nullable optional fields", async () => {
  const payload = { id: "fixture", content: [{ type: "thinking", thinking: "not public" }, { type: "text", text: JSON.stringify(clarification) }], stop_reason: "end_turn", usage: { input_tokens: 30, output_tokens: 20 } };
  await withReply({ MODEL_NAME: "claude-sonnet-5-5", MODEL_ADAPTER: "anthropic", MODEL_SEND_TEMPERATURE: "false", MODEL_REASONING_EFFORT: "low" }, payload, async (send, sent, costs) => {
    assert.equal((await send()).reply, clarification.reply);
    assert.equal(sent[0].url, base + "/messages");
    assert.equal(sent[0].body.model, "claude-sonnet-5-5");
    assert.equal(sent[0].body.max_tokens, 4096);
    assert.equal(sent[0].body.temperature, undefined);
    assert.equal(sent[0].headers["x-api-key"], "fixture");
    assert.equal(costs.length, 1);
  });
});

test("compatible text blocks and fenced JSON work with profile JSON mode off", async () => {
  await withReply({ MODEL_JSON_MODE: "false" }, completion([{ type: "reasoning", text: "private" }, { type: "text", text: "```json\n" + JSON.stringify(clarification) + "\n```" }]), async (send, sent) => {
    assert.equal((await send()).reply, clarification.reply);
    assert.equal(sent[0].body.response_format, undefined);
  });
});

test("truncated, malformed and reasoning-only replies are withheld, recorded once and never automatically retried", async () => {
  for (const payload of [completion(JSON.stringify(clarification), "length"), completion("{bad"), completion([{ type: "reasoning", text: JSON.stringify(clarification) }])]) {
    await withReply({}, payload, async (send, sent, costs) => {
      await assert.rejects(send, /reply (was cut short|could not be read)/);
      assert.equal(sent.length, 1); assert.equal(costs.length, 1);
    });
  }
});

test("onboarding has room for structured output and uses model-family timeouts unless the profile overrides them", () => {
  assert.deepEqual(modelCallBudget("onboarding_reply", { MODEL_NAME: "seed-2-0-pro-260328" }), { maxTokens: 4096, timeoutMs: 60000 });
  assert.deepEqual(modelCallBudget("onboarding_reply", { MODEL_NAME: "gpt-5.5" }), { maxTokens: 4096, timeoutMs: 60000 });
  assert.deepEqual(modelCallBudget("onboarding_reply", { MODEL_NAME: "fixture" }), { maxTokens: 4096, timeoutMs: 30000 });
});

test("Seed 2.0 is frontier for inherited and named profiles without relabelling other model families", () => {
  for (const model of ["Seed 2.0 Pro", "seed-2-0-pro-260328", "doubao-seed-2.0", "bytedance/seed-2.0-pro"]) assert.equal(isSeed20Model(model), true, model);
  for (const model of ["seed-1-6", "seed-2-1", "seed-2-01", "notseed-2-0", "fixture"]) assert.equal(isSeed20Model(model), false, model);
  const profile: ModelProfileRow = { id: "fixture", slug: "current-settings", name: "Current settings", label: "Standard model", tier: "standard", adapter: "openai_compatible", role: "active", inherit_settings: true, settings: {}, revision: 1 };
  assert.deepEqual(profilePresentation(profile, "seed-2-0-pro-260328"), { label: "Frontier model", tier: "frontier" });
  assert.deepEqual(profilePresentation(profile, "other-model"), { label: "Standard model", tier: "standard" });
  assert.equal(profileRuntimeKeys(profile, { inheritedModel: "seed-2-0-pro-260328" }).MODEL_PROFILE_TIER, "frontier");
  assert.equal(profileRuntimeKeys(profile, { inheritedModel: "seed-2-0-pro-260328" }).MODEL_NAME, undefined);
  assert.equal(profilePresentation({ ...profile, inherit_settings: false, settings: { model: "seed-2-0-pro-260328" } }).tier, "frontier");
  assert.equal(coachModelLabel({ MODEL_NAME: "seed-2-0-pro-260328" }), "Frontier model");
  assert.equal(coachModelLabel({ MODEL_NAME: "seed-2-0-pro-260328", MODEL_PROFILE_LABEL: "Premium model" }), "Premium model");
});
