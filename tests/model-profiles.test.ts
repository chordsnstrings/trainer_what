// Model profiles (docs/features/model-profiles.md): the migrated default
// profile changes nothing sent or pinned; profile request settings, budgets
// and the native Messages adapter (mock transport, no provider contacted);
// refusals read by status and parameter; the fallback profile (its answers
// never automatic); and the Super admin switch procedure under PGlite.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  runtimeConfig,
  withRuntimeConfig,
} from "../packages/providers/src/configuration.ts";
import { modelCompletion, type ModelUsage } from "../packages/providers/src/model-accounting.ts";
import {
  answeredByFallback,
  forgetLearnedModelRequestStyles,
  MODEL_PROFILE_KEYS,
  modelCallBudget,
  modelReplyJson,
  refusedStyleParameter,
} from "../packages/providers/src/model-request.ts";
import {
  coachFacingPin,
  coachModelLabel,
  labelNamesModel,
  profileRuntimeKeys,
  type ModelProfileRow,
} from "../packages/providers/src/model-profiles.ts";
import { coachingModelPin } from "../packages/providers/src/coaching.ts";
import { planModelPin } from "../packages/providers/src/brain-plans.ts";
import { nutritionModelIdentity } from "../packages/providers/src/nutrition.ts";

const BASE = "https://profiles-fixture.invalid/v1";
const FALLBACK = "https://profiles-fallback.invalid/v1";
const ENV = {
  MODEL_BASE_URL: BASE,
  MODEL_API_KEY: "fixture-key",
  MODEL_NAME: "seed-2-0-pro-260328",
  MODEL_INPUT_USD_PER_MILLION: "0.5",
  MODEL_OUTPUT_USD_PER_MILLION: "3",
  MODEL_PRICE_VERSION: "fixture-v1",
};
const APP_BODY = {
  messages: [
    { role: "system", content: "Return only one JSON object." },
    { role: "user", content: '{"request":"move my session"}' },
  ],
  response_format: { type: "json_object" },
  max_tokens: 800,
  temperature: 0,
};
type Answer = { status: number; body: unknown } | Error;
async function withProvider<T>(answers: Answer[], fn: (sent: any[]) => Promise<T>) {
  const sent: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    sent.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body ?? "null")) });
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
const chatOk = (content: string) => ({
  status: 200,
  body: { id: "chatcmpl-fixture", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100 } },
});
function ledger() {
  const rows: ModelUsage[] = [];
  return {
    rows,
    accounting: { reserve: async () => undefined, record: async (u: ModelUsage) => void rows.push(u) },
  };
}
const profile = (over: Partial<ModelProfileRow> = {}): ModelProfileRow => ({
  id: "7c1e0000-0000-4000-8000-000000000001",
  slug: "current-settings",
  name: "Current AI model settings",
  label: "Standard model",
  tier: "standard",
  adapter: "openai_compatible",
  role: "active",
  inherit_settings: true,
  settings: {},
  revision: 1,
  ...over,
});
const pins = () => ({
  coaching: coachingModelPin(),
  plan: planModelPin(),
  nutrition: nutritionModelIdentity(),
});
beforeEach(() => forgetLearnedModelRequestStyles());

test("the migrated default profile sends the same bytes and keeps every qualification pin", async () => {
  const before = await withRuntimeConfig(ENV, pins);
  const keys = profileRuntimeKeys(profile(), {});
  // It adds only its label and empty profile keys: no address, key or model.
  assert.equal(keys.MODEL_BASE_URL, undefined);
  assert.equal(keys.MODEL_NAME, undefined);
  const after = await withRuntimeConfig({ ...ENV, ...keys }, pins);
  assert.deepEqual(after, before);
  assert.equal(JSON.stringify(after), JSON.stringify(before));
  const send = (extra: Record<string, string>) =>
    withProvider([chatOk("{}")], async (sent) => {
      const { usage } = await withRuntimeConfig({ ...ENV, ...extra }, () =>
        modelCompletion(BASE, "fixture-key", ENV.MODEL_NAME, APP_BODY, ledger().accounting),
      );
      return { sent: sent.map((s) => ({ url: s.url, body: JSON.stringify(s.body) })), cost: usage.cost, pricing: usage.pricing };
    });
  assert.deepEqual(await send(keys), await send({}));
});

test("label, tier and price edits never change a pin; connection and request settings do", () => {
  const own = profile({
    inherit_settings: false,
    slug: "frontier",
    label: "Frontier model",
    tier: "frontier",
    settings: { baseUrl: "https://frontier.invalid/v1", model: "frontier-a", inputUsdPerMillion: 4, outputUsdPerMillion: 20, priceVersion: "v1" },
  });
  const pin = (p: ModelProfileRow) => withRuntimeConfig(profileRuntimeKeys(p, { key: "k" }), pins);
  const base = pin(own);
  assert.deepEqual(pin({ ...own, label: "Premium model", tier: "standard", name: "Renamed" }), base);
  assert.deepEqual(pin({ ...own, settings: { ...own.settings, inputUsdPerMillion: 2, outputUsdPerMillion: 9, cacheReadUsdPerMillion: 0.2, priceVersion: "v2" } }), base);
  for (const changed of [
    { ...own, settings: { ...own.settings, model: "frontier-b" } },
    { ...own, adapter: "anthropic" as const },
    { ...own, settings: { ...own.settings, sendTemperature: false } },
    { ...own, settings: { ...own.settings, jsonMode: false } },
    { ...own, settings: { ...own.settings, budgets: { coach_selection: { maxTokens: 4000 } } } },
  ])
    for (const area of ["coaching", "plan", "nutrition"] as const)
      assert.notDeepEqual(pin(changed)[area], base[area], JSON.stringify(changed).slice(0, 80));
  // A time limit alone changes no request and no pin.
  assert.deepEqual(pin({ ...own, settings: { ...own.settings, budgets: { coach_selection: { timeoutMs: 90000 } } } }), base);
});

test("a profile's own budgets replace the fixed table and the model-name allowance", () => {
  const seed = { ...ENV };
  assert.deepEqual(modelCallBudget("rule_compilation", seed), { maxTokens: 5000, timeoutMs: 90000 });
  const own = { ...seed, [MODEL_PROFILE_KEYS.budgets]: JSON.stringify({ rule_compilation: { maxTokens: 8000, timeoutMs: 45000 }, coach_selection: { maxTokens: 4000 } }) };
  assert.deepEqual(modelCallBudget("rule_compilation", own), { maxTokens: 8000, timeoutMs: 45000 });
  assert.deepEqual(modelCallBudget("coach_selection", own), { maxTokens: 4000, timeoutMs: 30000 });
  assert.deepEqual(modelCallBudget("meal_photo", own), modelCallBudget("meal_photo", seed));
  // Invalid entries are ignored, never guessed.
  const bad = { ...seed, [MODEL_PROFILE_KEYS.budgets]: JSON.stringify({ coach_selection: { maxTokens: 5, timeoutMs: 999999 }, unknown: {} }) };
  assert.deepEqual(modelCallBudget("coach_selection", bad), modelCallBudget("coach_selection", seed));
});

test("refusals are read from the status and the rejected parameter, in any wording", () => {
  const bare = (message: string) => ({ type: "error", error: { type: "invalid_request_error", message } });
  assert.equal(refusedStyleParameter(400, bare("temperature: this model does not take a sampling setting"), "classic"), "temperature");
  assert.equal(refusedStyleParameter(400, bare("`max_tokens` is not permitted here; send max_completion_tokens"), "classic"), "max_tokens");
  assert.equal(refusedStyleParameter(400, { error: { param: "body.max_completion_tokens", message: "nope" } }, "reasoning"), "max_completion_tokens");
  // A refused value, another parameter, another status: never retried.
  assert.equal(refusedStyleParameter(400, bare("max_tokens: 64001 is greater than the maximum of 64000"), "classic"), null);
  assert.equal(refusedStyleParameter(400, bare("response_format is not supported; temperature ignored"), "classic"), null);
  assert.equal(refusedStyleParameter(422, bare("temperature: not supported"), "classic"), null);
  assert.equal(refusedStyleParameter(429, bare("temperature: not supported"), "classic"), null);
});

test("the native Messages adapter: cached system blocks, no temperature, effort, images and cache-priced usage", async () => {
  const keys = profileRuntimeKeys(
    profile({
      inherit_settings: false,
      adapter: "anthropic",
      tier: "frontier",
      label: "Frontier model",
      settings: { baseUrl: BASE, model: "frontier-native", requestStyle: "reasoning", reasoningEffort: "low", sendTemperature: false, defaultMaxTokens: 3000, inputUsdPerMillion: 4, outputUsdPerMillion: 20, cacheReadUsdPerMillion: 0.2, cacheWriteUsdPerMillion: 5, priceVersion: "fixture-native" },
    }),
    { key: "native-key" },
  );
  const answer = {
    status: 200,
    body: {
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"actionId":null}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 50 },
    },
  };
  const body = {
    ...APP_BODY,
    messages: [
      APP_BODY.messages[0],
      { role: "user", content: [{ type: "text", text: "Estimate this meal." }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA", detail: "low" } }] },
    ],
  };
  await withProvider([answer], async (sent) => {
    const { rows, accounting } = ledger();
    const { payload, usage } = await withRuntimeConfig(keys, () =>
      modelCompletion(BASE, "native-key", "frontier-native", body, accounting),
    );
    assert.equal(sent[0].url, BASE + "/messages");
    assert.equal(sent[0].headers["x-api-key"], "native-key");
    assert.equal(sent[0].headers["anthropic-version"], "2023-06-01");
    assert.equal(sent[0].headers.authorization, undefined);
    assert.deepEqual(sent[0].body.system, [{ type: "text", text: "Return only one JSON object.", cache_control: { type: "ephemeral" } }]);
    assert.equal(sent[0].body.max_tokens, 800);
    assert.equal("temperature" in sent[0].body, false);
    assert.equal("response_format" in sent[0].body, false);
    assert.deepEqual(sent[0].body.output_config, { effort: "low" });
    assert.deepEqual(sent[0].body.messages[0].content[1], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
    assert.deepEqual(modelReplyJson(payload), { actionId: null });
    assert.equal(usage.input, 1000);
    assert.equal(usage.output, 50);
    assert.deepEqual(usage.cache, { read: 900, write: 0 });
    // 100 uncached x 4 + 900 cached x 0.2 + 50 x 20, per million.
    assert.equal(usage.cost, (100 * 4 + 900 * 0.2 + 50 * 20) / 1e6);
    assert.equal(rows.length, 1);
  });
  // A call that sets no limit gets the profile's; a refusal is withheld.
  await withProvider([{ status: 200, body: { id: "msg_r", content: [], stop_reason: "refusal", usage: { input_tokens: 10, output_tokens: 0 } } }], async (sent) => {
    const { payload } = await withRuntimeConfig(keys, () =>
      modelCompletion(BASE, "native-key", "frontier-native", { messages: APP_BODY.messages }, ledger().accounting),
    );
    assert.equal(sent[0].body.max_tokens, 3000);
    assert.equal((payload as any).choices[0].message.content, null);
    assert.equal(modelReplyJson(payload), null);
  });
  // A rejected temperature (sent only when the profile sends temperatures) is dropped once.
  const warm = { ...keys, [MODEL_PROFILE_KEYS.sendTemperature]: "" };
  await withProvider([{ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "temperature: not supported for this model" } } }, answer], async (sent) => {
    const { usage } = await withRuntimeConfig(warm, () =>
      modelCompletion(BASE, "native-key", "frontier-native", APP_BODY, ledger().accounting),
    );
    assert.equal(sent[0].body.temperature, 0);
    assert.equal("temperature" in sent[1].body, false);
    assert.equal(usage.request?.retriedAfterRefusal, "temperature");
  });
});

test("the fallback profile answers only when the active one is unavailable, and marks the scope", async () => {
  const fallbackKeys = { MODEL_BASE_URL: FALLBACK, MODEL_API_KEY: "fallback-key", MODEL_NAME: "fallback-model", MODEL_PROVIDER: "fallback" };
  const config = { ...ENV, [MODEL_PROFILE_KEYS.fallback]: JSON.stringify(fallbackKeys) };
  const withFallback = () => {
    const first = ledger(),
      second = ledger();
    return { first, second, accounting: { ...first.accounting, fallback: () => second.accounting } };
  };
  await withProvider([{ status: 503, body: { error: { message: "overloaded" } } }, chatOk('{"ok":true}')], async (sent) => {
    const l = withFallback();
    await withRuntimeConfig(config, async () => {
      const before = coachingModelPin();
      const { usage } = await modelCompletion(BASE, "fixture-key", ENV.MODEL_NAME, APP_BODY, l.accounting);
      assert.equal(usage.fallback, true);
      assert.equal(sent[1].url, FALLBACK + "/chat/completions");
      assert.equal(sent[1].body.model, "fallback-model");
      assert.equal(l.first.rows.length, 1);
      assert.equal(l.second.rows.length, 1);
      // Nothing produced in this scope can match a qualification any more.
      assert.equal(answeredByFallback(runtimeConfig()), true);
      assert.notDeepEqual(coachingModelPin(), before);
      assert.equal((coachingModelPin() as any).request.fallback, true);
    });
  });
  // Evaluations and checks offer no fallback accounting: the failure stands.
  await withProvider([{ status: 503, body: { error: { message: "overloaded" } } }], async () => {
    await assert.rejects(
      withRuntimeConfig(config, () => modelCompletion(BASE, "fixture-key", ENV.MODEL_NAME, APP_BODY, ledger().accounting)),
      /Model request failed \(503/,
    );
  });
  // A configuration error (400, 401) is never hidden by the fallback.
  await withProvider([{ status: 401, body: { error: { message: "bad key" } } }], async () => {
    await assert.rejects(
      withRuntimeConfig(config, () => modelCompletion(BASE, "fixture-key", ENV.MODEL_NAME, APP_BODY, withFallback().accounting)),
      /Model request failed \(401/,
    );
  });
});

test("coach-facing labels never name a model or vendor; coach pins carry the label only", () => {
  for (const bad of ["Claude Opus", "GPT-5.5", "Seed Pro", "chatgpt model", "Sonnet-5", "OpenAI frontier", "Anthropic"])
    assert.equal(labelNamesModel(bad), true, bad);
  for (const ok of ["Frontier model", "Standard model", "Advanced model"]) assert.equal(labelNamesModel(ok), false, ok);
  const pin = coachFacingPin({ endpoint: "https://api.example.invalid/v1", model: "secret-model-id", promptVersion: "p1" }, { MODEL_PROFILE_LABEL: "Frontier model" });
  assert.deepEqual(pin, { endpoint: "configured", model: "Frontier model", promptVersion: "p1" });
});

test("Super admin: seeded profiles, key, test, switch check job, activate, frontier flag, rechecks and switch-back (PGlite)", async () => {
  const { governanceFixture } = await import("./governance-fixtures.ts");
  const { loadRuntimeSettings } = await import("../apps/api/src/platform-settings.ts");
  const { processModelSwitchChecks } = await import("../apps/api/src/model-profiles.ts");
  const { publicAvailability } = await import("../apps/api/src/marketing.ts");
  const encryption = process.env.SECURITY_ENCRYPTION_KEY;
  process.env.SECURITY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const saved = { ...process.env };
  Object.assign(process.env, ENV);
  const original = globalThis.fetch;
  const f = await governanceFixture();
  try {
    const admin = await f.operator("admin");
    const coach = await f.person({ name: "Coach Profiles" });
    const list = await f.call("/admin/model-profiles", { cookie: admin.cookie });
    assert.equal(list.statusCode, 200, list.body);
    const profiles = list.json().profiles;
    assert.deepEqual(profiles.map((p: any) => p.slug).sort(), ["anthropic-opus", "anthropic-sonnet", "current-settings", "openai-chatgpt"]);
    const current = profiles.find((p: any) => p.slug === "current-settings");
    assert.equal(current.role, "active");
    assert.equal(current.effective.model, ENV.MODEL_NAME);
    assert.equal(profiles.find((p: any) => p.slug === "anthropic-opus").key, "missing");
    for (const p of profiles) assert.equal(labelNamesModel(p.label), false, p.label);
    // The default profile changes nothing a pin reads.
    const runtime = await loadRuntimeSettings(f.db);
    // The untouched default profile adds nothing to the runtime settings.
    assert.deepEqual(runtime, {});
    assert.equal(coachModelLabel(runtime), "Standard model");
    assert.deepEqual(withRuntimeConfig(runtime, pins), withRuntimeConfig({}, pins));
    // A vendor name in a label is refused.
    const opus = profiles.find((p: any) => p.slug === "anthropic-opus");
    const edit = (body: any) => f.call(`/admin/model-profiles/${opus.id}`, { method: "PUT", cookie: admin.cookie, body });
    const bodyOf = (p: any, over: any = {}) => ({ revision: p.revision, name: p.name, label: p.label, tier: p.tier, adapter: p.adapter, settings: { ...p.settings, baseUrl: "https://frontier.invalid/v1" }, ...over });
    assert.equal((await edit(bodyOf(opus, { label: "Opus 5.5" }))).statusCode, 400);
    const savedProfile = await edit(bodyOf(opus));
    assert.equal(savedProfile.statusCode, 200, savedProfile.body);
    // Activation needs a key, a passing connection test and a passing switch check.
    const activate = () => f.call(`/admin/model-profiles/${opus.id}/activate`, { cookie: admin.cookie, body: {} });
    assert.equal((await activate()).json().code, "PROFILE_KEY_MISSING");
    const key = await f.call(`/admin/model-profiles/${opus.id}/key`, { method: "PUT", cookie: admin.cookie, body: { key: "sk-fixture-frontier" } });
    assert.equal(key.statusCode, 200, key.body);
    assert.equal(JSON.stringify((await f.call("/admin/model-profiles", { cookie: admin.cookie })).json()).includes("sk-fixture"), false);
    assert.equal((await activate()).json().code, "PROFILE_UNTESTED");
    const headers: any[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      headers.push({ url: String(url), ...Object.fromEntries(new Headers(init?.headers).entries()) });
      return Response.json({ data: [{ id: "claude-opus-5-5" }] });
    }) as typeof fetch;
    const tested = await f.call(`/admin/model-profiles/${opus.id}/test`, { cookie: admin.cookie, body: {} });
    assert.equal(tested.json().status, "verified", tested.body);
    assert.equal(headers[0].url, "https://frontier.invalid/v1/models");
    assert.equal(headers[0]["x-api-key"], "sk-fixture-frontier");
    assert.equal((await activate()).json().code, "PROFILE_UNCHECKED");
    const queued = await f.call(`/admin/model-profiles/${opus.id}/check`, { cookie: admin.cookie, body: {} });
    assert.equal(queued.json().status, "queued", queued.body);
    let ranWith: Record<string, string | undefined> = {};
    await processModelSwitchChecks(f.db, {
      run: async () => {
        ranWith = runtimeConfig();
        return { pass: true, reasons: [], totals: { cases: 18, passed: 18, score: 1, validJson: 18, safetyFailures: 0, p95Ms: {}, limitMs: {} }, usage: { calls: 18, inputTokens: 1, outputTokens: 1, costUsd: 0.01 } } as any;
      },
    });
    // The check ran on the profile under test, never with a fallback.
    assert.equal(ranWith.MODEL_NAME, "claude-opus-5-5");
    assert.equal(ranWith.MODEL_ADAPTER, "anthropic");
    assert.equal(ranWith.MODEL_API_KEY, "sk-fixture-frontier");
    assert.equal(ranWith[MODEL_PROFILE_KEYS.fallback], "");
    const checked = (await f.call("/admin/model-profiles", { cookie: admin.cookie })).json().profiles.find((p: any) => p.id === opus.id);
    assert.equal(checked.latestCheck.status, "passed");
    assert.equal(checked.ready.checked, true);
    assert.equal(publicAvailability(withRuntimeConfig(runtime, runtimeConfig)).frontier, false);
    const activated = await activate();
    assert.equal(activated.statusCode, 200, activated.body);
    assert.equal(activated.json().from, current.id);
    const after = await loadRuntimeSettings(f.db);
    assert.equal(after.MODEL_NAME, "claude-opus-5-5");
    assert.equal(after.MODEL_PROFILE_LABEL, "Frontier model");
    assert.equal(after.MODEL_API_KEY, "sk-fixture-frontier");
    assert.notDeepEqual(withRuntimeConfig(after, pins), withRuntimeConfig(runtime, pins));
    assert.equal(withRuntimeConfig(after, () => publicAvailability()).frontier, true);
    // Every active workspace gets a background re-check on the new model.
    // Read in the coach's own workspace scope (jobs are workspace rows).
    const [job] = await f.db.tenant(
      { tenantId: coach.tenantId, userId: coach.userId, role: "owner" },
      (tx) => tx.query("SELECT kind,data FROM jobs WHERE kind='brain_check'"),
    );
    assert.equal(job?.data?.trigger, "model_switch");
    // A label edit of the active profile is fine; its connection is not.
    const active = (await f.call("/admin/model-profiles", { cookie: admin.cookie })).json().profiles.find((p: any) => p.id === opus.id);
    assert.equal((await edit(bodyOf(active, { label: "Premium model" }))).statusCode, 200);
    const relabelled = await loadRuntimeSettings(f.db);
    assert.deepEqual(withRuntimeConfig(relabelled, pins), withRuntimeConfig(after, pins));
    const again = (await f.call("/admin/model-profiles", { cookie: admin.cookie })).json().profiles.find((p: any) => p.id === opus.id);
    assert.equal((await edit(bodyOf(again, { settings: { ...again.settings, baseUrl: "https://frontier.invalid/v1", model: "claude-sonnet-5-5" } }))).json().code, "PROFILE_ACTIVE");
    // One click back; no new check needed for the earlier profile.
    const back = await f.call("/admin/model-profiles/switch-back", { cookie: admin.cookie, body: {} });
    assert.equal(back.statusCode, 200, back.body);
    const restored = await loadRuntimeSettings(f.db);
    assert.equal(coachModelLabel(restored), "Standard model");
    assert.equal(restored.MODEL_NAME, undefined);
    assert.deepEqual(withRuntimeConfig(restored, pins), withRuntimeConfig(runtime, pins));
    // The frontier profile as fallback: its keys reach the runtime for failover only.
    const fallback = await f.call("/admin/model-profiles/fallback", { method: "PUT", cookie: admin.cookie, body: { profileId: opus.id } });
    assert.equal(fallback.statusCode, 200, fallback.body);
    const withFb = await loadRuntimeSettings(f.db);
    assert.equal(JSON.parse(withFb[MODEL_PROFILE_KEYS.fallback]).MODEL_NAME, "claude-opus-5-5");
    assert.equal(withFb.MODEL_NAME, undefined);
    const audit = (await f.call("/admin/model-profiles", { cookie: admin.cookie })).json().audit.map((a: any) => a.action);
    for (const action of ["key_saved", "tested", "check_requested", "check_completed", "activated", "switched_back", "fallback_set"])
      assert.ok(audit.includes(action), action);
    // Coaches never reach these routes.
    assert.equal((await f.call("/admin/model-profiles", { cookie: coach.cookie })).statusCode, 403);
  } finally {
    globalThis.fetch = original;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    if (encryption === undefined) delete process.env.SECURITY_ENCRYPTION_KEY;
    else process.env.SECURITY_ENCRYPTION_KEY = encryption;
    await f.db.close();
  }
});
