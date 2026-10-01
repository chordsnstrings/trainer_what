/**
 * Model switch check from the command line (docs/features/model-profiles.md).
 * The profile under test comes from the environment's AI model keys
 * (MODEL_BASE_URL, MODEL_API_KEY, MODEL_NAME and the optional MODEL_* request
 * settings, for example MODEL_ADAPTER=anthropic); the key is never printed.
 *
 *   node --import tsx scripts/model-switch-check/cli.ts [--baseline 0.9]
 *     [--tolerance 0.1] [--concurrency 3] [--out /path/outside/the/repo.json]
 *
 * Super admin runs the same check as a worker job and stores the report.
 * Keep result files outside the repository.
 */
import { writeFileSync } from "node:fs";
import { withRuntimeConfig } from "../../packages/providers/src/configuration.ts";
import { runSwitchCheck } from "./check.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const number = (name: string) => {
  const value = arg(name);
  return value === undefined ? undefined : Number(value);
};
if (!process.env.MODEL_BASE_URL || !process.env.MODEL_API_KEY || !process.env.MODEL_NAME) {
  console.error("Set MODEL_BASE_URL, MODEL_API_KEY and MODEL_NAME for the profile under test.");
  process.exit(2);
}
process.env.MODEL_MAX_DAILY_CALLS ||= "1000";
const report = await withRuntimeConfig({}, () =>
  runSwitchCheck({
    baselineScore: number("baseline") ?? null,
    tolerance: number("tolerance"),
    concurrency: number("concurrency"),
    onCase: (c) =>
      console.log(
        `${c.passed ? "pass" : "FAIL"} ${c.id} ${c.outcome} ${c.latencyMs} ms${c.safetyFailure ? ` SAFETY: ${c.safetyFailure}` : ""}${c.error ? ` (${c.error})` : ""}${c.issues ? ` issues: ${c.issues.join(",")}` : ""}`,
      ),
  }),
);
const t = report.totals;
console.log(
  `score ${t.passed}/${t.cases} (${t.score}); valid JSON ${t.validJson}/${t.cases}; safety failures ${t.safetyFailures}; p95 ${JSON.stringify(t.p95Ms)} ms of limits ${JSON.stringify(t.limitMs)}; usage ${report.usage.calls} calls, ${report.usage.inputTokens} in / ${report.usage.outputTokens} out tokens, USD ${report.usage.costUsd ?? "unpriced"}`,
);
console.log(report.pass ? "PASS" : `FAIL: ${report.reasons.join("; ")}`);
const out = arg("out");
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
