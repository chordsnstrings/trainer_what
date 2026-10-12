/** Bounded, fictional replay through the real active Seed provider; never a fixture. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_VERSION, emptyChat, memberQuestions, mergeChatFacts, nextChatQuestion, profileReady,
  type ChatData,
} from "../packages/domain/src/onboarding-chat.ts";
import {
  finishChatTurn, onboardingContext, prepareChatTurn, preservePreparedFacts, recentOnboardingTurns,
} from "../packages/domain/src/onboarding-context.ts";
import { onboardingReply } from "../packages/providers/src/onboarding-chat.ts";
import { runtimeConfig, withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import { isSeed20Model } from "../packages/providers/src/model-profiles.ts";
import { modelCallBudget } from "../packages/providers/src/model-request.ts";
import type { ModelAccounting, ModelUsage } from "../packages/providers/src/model-accounting.ts";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node --import tsx scripts/onboarding-live-check.ts --out /absolute/path/outside/repository.json [--max-calls 14] [--max-cost-usd 0.50]\nRequires existing MODEL_BASE_URL, MODEL_API_KEY and a Seed 2.0 MODEL_NAME. No secrets are fetched, no provider is mocked, and no application records are changed.");
  process.exit(0);
}
const flags = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  if (!["--out", "--max-calls", "--max-cost-usd"].includes(args[i]) || !args[i + 1] || flags.has(args[i])) throw new Error("Use --help for the supported arguments.");
  flags.set(args[i], args[i + 1]);
}
const destination = flags.get("--out");
if (!destination || !isAbsolute(destination)) throw new Error("--out must name an absolute report path outside the repository.");
const root = fileURLToPath(new URL("../", import.meta.url)), out = resolve(destination), fromRoot = relative(root, out);
if (!fromRoot.startsWith(".." + sep) && !isAbsolute(fromRoot)) throw new Error("Keep live reports outside the repository.");
const maxCalls = Number(flags.get("--max-calls") ?? 14), maxCost = flags.has("--max-cost-usd") ? Number(flags.get("--max-cost-usd")) : null;
if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 32) throw new Error("--max-calls must be an integer from 1 to 32.");
if (maxCost !== null && (!Number.isFinite(maxCost) || maxCost <= 0)) throw new Error("--max-cost-usd must be a positive finite amount.");
const config = runtimeConfig(), usage: ModelUsage[] = [];
const report: {
  version: string; startedAt: string; completedAt?: string; model: string | null;
  status: "running" | "blocked" | "passed" | "failed"; blocker?: string;
  limits: { maxCalls: number; maxCostUsd: number | null }; callsReserved: number;
  turns: Array<Record<string, unknown>>; usage: ModelUsage[]; summary?: Record<string, unknown>;
} = { version: "onboarding-live-replay-v1", startedAt: new Date().toISOString(), model: config.MODEL_NAME ?? null, status: "running", limits: { maxCalls, maxCostUsd: maxCost }, callsReserved: 0, turns: [], usage };
const flush = async () => { await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); };
const cleanError = (error: unknown) => String((error as Error)?.message ?? error).replaceAll(config.MODEL_API_KEY || "\u0000", "[redacted]").slice(0, 600);
const priced = (key: string) => config[key]?.trim() && Number.isFinite(Number(config[key])) && Number(config[key]) >= 0 ? Number(config[key]) : null;
const inputPrice = priced("MODEL_INPUT_USD_PER_MILLION"), outputPrice = priced("MODEL_OUTPUT_USD_PER_MILLION");
const inputCeilingPrice = inputPrice === null ? null : Math.max(inputPrice, priced("MODEL_CACHE_READ_USD_PER_MILLION") ?? 0, priced("MODEL_CACHE_WRITE_USD_PER_MILLION") ?? 0);
let inputBound = 0;
const sourceBytes = Buffer.byteLength(await readFile(new URL("../packages/providers/src/onboarding-chat.ts", import.meta.url), "utf8"));
const budget = modelCallBudget("onboarding_reply", config);
function requireCostConfiguration() {
  if (maxCost !== null && (inputPrice === null || outputPrice === null || !config.MODEL_PRICE_VERSION?.trim() || budget.maxTokens === null)) throw new Error("A cost ceiling requires configured input/output prices, MODEL_PRICE_VERSION and a finite onboarding_reply output-token limit. No unpriced call will be sent.");
}
const accounting: ModelAccounting = {
  reserve: async model => {
    if (model !== config.MODEL_NAME) throw new Error("The model changed; replay stopped without fallback.");
    if (report.callsReserved >= maxCalls) throw new Error("The maximum call count has been reached.");
    if (maxCost !== null) {
      requireCostConfiguration();
      if (usage.some(row => row.cost === null)) throw new Error("A previous call has unknown cost; no further call is allowed under the cost ceiling.");
      // A byte per input token is deliberately conservative; include the whole
      // provider source for literal instructions and 4096 tokens of envelope margin.
      const reserve = (inputBound * inputCeilingPrice! + budget.maxTokens! * outputPrice!) / 1_000_000;
      if (usage.reduce((sum, row) => sum + (row.cost ?? 0), 0) + reserve > maxCost) throw new Error("The remaining cost ceiling cannot cover the next call's conservative token allowance.");
    }
    report.callsReserved++;
  },
  record: async row => {
    usage.push(row); await flush();
    if (maxCost !== null && (row.cost === null || usage.reduce((sum, entry) => sum + (entry.cost ?? 0), 0) > maxCost)) throw new Error("Reported cost is unknown or exceeded the configured ceiling; the replay stopped for reconciliation without another call.");
  },
};
type Check = { name: string; passes: (chat: ChatData) => boolean };
type Turn = { text: string; checks: Check[] };
const check = (name: string, passes: Check["passes"]): Check => ({ name, passes });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fresh = (facts: Record<string, unknown> = {}) => {
  const chat = emptyChat("member"); chat.facts = facts;
  chat.lastQuestion = nextChatQuestion(chat, [], false);
  chat.messages.push({ id: randomUUID(), from: "assistant", text: chat.lastQuestion.text, questionField: chat.lastQuestion.field, at: new Date().toISOString() });
  return chat;
};
const scenarios: Array<{ name: string; chat: ChatData; turns: Turn[] }> = [
  { name: "reported-weekday-conversation", chat: fresh(), turns: [
    { text: "I want to loose fat and gain muslces", checks: [check("understands the goal despite typos", c => typeof c.facts.goal === "string" && c.facts.goal.length > 5)] },
    { text: "minimal. not much", checks: [check("remembers beginner experience", c => c.facts.experience === "beginner")] },
    { text: "4 days shoudl be fine", checks: [check("understands four sessions", c => c.facts.daysPerWeek === 4)] },
    { text: "weekdays mostly", checks: [check("accepts weekday availability without exact-day loop", c => same(c.facts.availableWeekdays, [1, 2, 3, 4, 5]) && c.lastQuestion?.field !== "availableWeekdays")] },
    { text: "you let me know which days i should go", checks: [check("chooses four days only after delegation", c => same(c.facts.availableWeekdays, [1, 2, 4, 5]) && c.memory.availableWeekdays?.origin === "suggested")] },
    { text: "45 minutes?", checks: [check("recognises a tentative duration answer", c => c.facts.maxSessionMinutes === 45)] },
    { text: "I'm at the gym so usual gym equipments", checks: [check("understands gym equipment", c => /gym/i.test(String(c.facts.equipment)))] },
    { text: "40", checks: [check("uses the question to interpret age", c => c.facts.age === 40)] },
    { text: "I'm not very flexible", checks: [check("preserves the limitation disclosure", c => /not very flexible/i.test(String(c.facts.limitations))), check("has a complete profile", profileReady)] },
  ] },
  { name: "correction-and-hypothetical", chat: fresh({ goal: "Lose fat and gain muscle", experience: "beginner", daysPerWeek: 4, availableWeekdays: [1, 2, 3, 4, 5], maxSessionMinutes: 45, equipment: "Gym", age: 40, limitations: "Not very flexible" }), turns: [
    { text: "Actually I can only do three sessions now, and Friday is impossible.", checks: [check("applies the explicit correction", c => c.facts.daysPerWeek === 3 && same(c.facts.availableWeekdays, [1, 2, 3, 4]))] },
    { text: "Would weekends be better if my schedule changed?", checks: [check("a hypothetical question does not overwrite availability", c => c.facts.daysPerWeek === 3 && same(c.facts.availableWeekdays, [1, 2, 3, 4]))] },
  ] },
  { name: "uncertainty-recommendation-acceptance", chat: fresh({ goal: "Build strength", experience: "beginner" }), turns: [
    { text: "I'm not sure", checks: [check("uncertainty does not delegate a decision", c => c.facts.daysPerWeek === undefined && c.dialogue?.preferences.daysPerWeek?.status !== "delegated")] },
    { text: "How many sessions would you recommend?", checks: [check("a recommendation stays proposed", c => c.facts.daysPerWeek === undefined && c.dialogue?.preferences.daysPerWeek?.status === "recommendation")] },
    { text: "That sounds good", checks: [check("accepts the current proposal only", c => c.facts.daysPerWeek === 3 && c.dialogue?.preferences.daysPerWeek?.status === "accepted")] },
  ] },
];

try {
  const missing = ["MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_NAME"].filter(key => !config[key]);
  if (missing.length) throw new Error("Live Seed replay unavailable: missing " + missing.join(", ") + ". No model call was made; credentials were not fetched.");
  if (!isSeed20Model(config.MODEL_NAME)) throw new Error("MODEL_NAME must identify Seed 2.0; this replay will not switch or call another model.");
  requireCostConfiguration();
  const base = new URL(config.MODEL_BASE_URL!);
  if (base.protocol !== "https:" || base.username || base.password || base.search || /(^|\.)(?:localhost|invalid|test|example)$/.test(base.hostname) || /^(?:127\.|0\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/.test(base.hostname)) throw new Error("A real public HTTPS provider endpoint is required; fixture, local and credential-bearing URLs are refused.");
  await flush();
  await withRuntimeConfig({}, async () => {
    for (const scenario of scenarios) for (const turn of scenario.turns) {
      const c = scenario.chat, at = new Date().toISOString(), id = randomUUID(), asked = c.lastQuestion!;
      c.messages.push({ id, from: "person", text: turn.text, at, questionField: asked.field });
      const notices = prepareChatTurn(c, asked, turn.text, id, at, false), prepared = structuredClone(c), firstUsage = usage.length, started = Date.now();
      const context = { version: CHAT_VERSION, audience: c.audience, mode: c.mode, facts: c.facts, question: asked, fields: memberQuestions, nutritionIncluded: false, profile: { saved: !!c.applied.profile, editing: !!c.profileEditing }, understanding: onboardingContext(c, asked, false), brainRules: [], conversation: recentOnboardingTurns(c), attachments: [] };
      inputBound = Buffer.byteLength(JSON.stringify(context)) + sourceBytes + 4096;
      // Deliberately exercise the real model even for turns the app can answer locally.
      const answer = await onboardingReply(c, asked, [], [], false, accounting);
      const merged = mergeChatFacts(c, answer, turn.text, id, at, [], false);
      preservePreparedFacts(merged, prepared, id, answer); Object.assign(c, merged);
      const result = finishChatTurn(c, answer, asked, turn.text, id, at, [], false, notices);
      c.messages.push({ id: randomUUID(), from: "assistant", text: result.reply, at });
      if (result.question) { c.lastQuestion = result.question; c.messages.push({ id: randomUUID(), from: "assistant", text: result.question.text, questionField: result.question.field, at }); }
      const checks = turn.checks.map(assertion => ({ name: assertion.name, passed: assertion.passes(c) }));
      report.turns.push({ scenario: scenario.name, user: turn.text, asked, rawStructuredReply: answer, deliveredReply: result, facts: structuredClone(c.facts), choices: structuredClone(c.dialogue?.preferences ?? {}), checks, latencyMs: Date.now() - started, usage: usage.slice(firstUsage) });
      await flush();
      console.log(`${checks.every(item => item.passed) ? "PASS" : "FAIL"} ${scenario.name}: ${checks.map(item => `${item.passed ? "ok" : "FAIL"} ${item.name}`).join("; ")}`);
    }
  });
  report.status = report.turns.every(turn => (turn.checks as Array<{ passed: boolean }>).every(item => item.passed)) ? "passed" : "failed";
} catch (error) {
  report.status = report.turns.length || usage.length ? "failed" : "blocked";
  report.blocker = cleanError(error);
  console.error(report.blocker);
} finally {
  report.completedAt = new Date().toISOString();
  report.summary = { completedTurns: report.turns.length, plannedTurns: scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0), callsReserved: report.callsReserved, recordedCalls: usage.length, inputTokens: usage.every(row => row.input !== null) ? usage.reduce((sum, row) => sum + (row.input ?? 0), 0) : null, outputTokens: usage.every(row => row.output !== null) ? usage.reduce((sum, row) => sum + (row.output ?? 0), 0) : null, costUsd: usage.every(row => row.cost !== null) ? usage.reduce((sum, row) => sum + (row.cost ?? 0), 0) : null, humanConversationQualityGraded: false };
  await flush();
  console.log(JSON.stringify({ status: report.status, ...report.summary, report: out }));
}
process.exitCode = report.status === "passed" ? 0 : report.status === "blocked" ? 2 : 1;
