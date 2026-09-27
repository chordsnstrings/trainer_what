#!/usr/bin/env node
/**
 * Per-feature results table from one or more harness reports (run the harness
 * with --features=<inventory> so the report carries `inventory.table`).
 *
 *   node scripts/e2e/coverage-table.mjs report-a.json [report-b.json ...] [--out=FILE]
 *
 * With several reports the table has one result column per run and a
 * flakiness section listing every step whose status differs between runs.
 * Exit code 1 when a provider-dependent feature has neither a scenario nor a
 * stated local limit in any run, or when any report has a failed step.
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith("--out="))?.slice(6);
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: coverage-table.mjs report.json [more.json] [--out=FILE]");
  process.exit(2);
}
const reports = files.map((file) => ({ file, report: JSON.parse(readFileSync(file, "utf8")) }));
for (const { file, report } of reports)
  if (!report.inventory?.table) {
    console.error(`${file} has no inventory table; run the harness with --features=<inventory>`);
    process.exit(2);
  }
const label = (r, i) => r.report.run?.id ?? `run ${i + 1}`;
const symbol = { pass: "pass", fail: "FAIL", equivalent: "pass (same flow)", "not-local": "not local", "not-exercised": "NOT EXERCISED" };
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const lines = [];
lines.push("# End-to-end harness: per-feature results");
lines.push("");
lines.push(`Generated from ${reports.map((r, i) => "`" + label(r, i) + "`").join(" and ")} by \`scripts/e2e/coverage-table.mjs\`.`);
lines.push("");
lines.push(
  "Inventory status comes from the inventory file given to the run, a snapshot: a feature built after it (for example one marked not_built) keeps its snapshot status here. \"pass (same flow)\" means another audience's step runs exactly this flow (`EQUIVALENT_FEATURES` in `tests/e2e/harness/report.ts`). A local limit names the part of a feature the sandbox cannot exercise (`LOCAL_LIMITS`).",
);
lines.push("");
lines.push("| Run | Steps | Passed | Failed | Skipped | Duration |");
lines.push("| --- | --- | --- | --- | --- | --- |");
for (const [i, r] of reports.entries()) {
  const s = r.report.summary;
  lines.push(`| ${label(r, i)} | ${s.steps} | ${s.passed} | ${s.failed} | ${s.skipped} | ${r.report.run?.durationSeconds ?? "?"} s |`);
}
lines.push("");
const base = reports[0].report.inventory.table;
const audiences = [...new Set(base.map((row) => row.audience))];
const counts = {};
for (const audience of audiences) {
  const rows = base.filter((row) => row.audience === audience);
  lines.push(`## ${audience}`);
  lines.push("");
  lines.push(`| Feature | Inventory status | Provider-dependent | ${reports.map((r, i) => label(r, i)).join(" | ")} | Steps | Local limit or equivalent flow |`);
  lines.push(`| --- | --- | --- | ${reports.map(() => "---").join(" | ")} | --- | --- |`);
  for (const row of rows) {
    const results = reports.map((r) => r.report.inventory.table.find((x) => x.audience === row.audience && x.feature === row.feature));
    for (const [i, x] of results.entries()) {
      const key = `${label(reports[i], i)}|${x?.result}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const note = row.via ? `same flow as ${row.via}` : row.limit ?? "";
    lines.push(
      `| ${cell(row.feature)} | ${cell(row.inventoryStatus.split(";")[0].slice(0, 40))} | ${row.providerDependent ? "yes" : "no"} | ${results
        .map((x) => symbol[x?.result] ?? "?")
        .join(" | ")} | ${results.map((x) => (x ? `${x.passed}/${x.steps}` : "-")).join(", ")} | ${cell(note)} |`,
    );
  }
  lines.push("");
}
lines.push("## Totals");
lines.push("");
lines.push("| Run | pass | pass (same flow) | not local | NOT EXERCISED | FAIL |");
lines.push("| --- | --- | --- | --- | --- | --- |");
for (const [i, r] of reports.entries()) {
  const l = label(r, i);
  lines.push(`| ${l} | ${counts[l + "|pass"] ?? 0} | ${counts[l + "|equivalent"] ?? 0} | ${counts[l + "|not-local"] ?? 0} | ${counts[l + "|not-exercised"] ?? 0} | ${counts[l + "|fail"] ?? 0} |`);
}
lines.push("");
let unaccounted = [];
for (const r of reports) unaccounted.push(...(r.report.inventory.providerDependentUnaccounted ?? []));
unaccounted = [...new Set(unaccounted)];
lines.push("## Provider-dependent features without a scenario or a stated limit");
lines.push("");
lines.push(unaccounted.length ? unaccounted.map((x) => `- ${x}`).join("\n") : "None.");
lines.push("");
if (reports.length > 1) {
  lines.push("## Flakiness: steps whose status differs between runs");
  lines.push("");
  const byId = reports.map((r) => new Map(r.report.steps.map((s) => [s.id, s])));
  const ids = [...new Set(reports.flatMap((r) => r.report.steps.map((s) => s.id)))];
  const differing = ids.filter((id) => new Set(byId.map((m) => m.get(id)?.status ?? "absent")).size > 1);
  if (!differing.length) lines.push("None: every step has the same status in every run.");
  else {
    lines.push(`| Step | ${reports.map((r, i) => label(r, i)).join(" | ")} |`);
    lines.push(`| --- | ${reports.map(() => "---").join(" | ")} |`);
    for (const id of differing) lines.push(`| ${cell(id)} | ${byId.map((m) => m.get(id)?.status ?? "absent").join(" | ")} |`);
  }
  lines.push("");
  const shared = ids.filter((id) => byId.every((m) => m.has(id)));
  const slow = shared
    .map((id) => ({ id, d: byId.map((m) => m.get(id).durationMs) }))
    .filter((x) => Math.max(...x.d) > 5000 && Math.max(...x.d) > 3 * Math.max(1, Math.min(...x.d)))
    .sort((a, b) => Math.max(...b.d) - Math.max(...a.d))
    .slice(0, 15);
  lines.push("Steps whose duration varies by more than 3x (over 5 s), usually authenticator windows or request budgets:");
  lines.push("");
  lines.push(slow.length ? slow.map((x) => `- ${x.id}: ${x.d.map((d) => (d / 1000).toFixed(1) + " s").join(" vs ")}`).join("\n") : "- none");
  lines.push("");
}
const text = lines.join("\n");
if (out) writeFileSync(out, text + "\n");
else console.log(text);
const failed = reports.some((r) => r.report.summary.failed > 0);
process.exit(unaccounted.length || failed ? 1 : 0);
