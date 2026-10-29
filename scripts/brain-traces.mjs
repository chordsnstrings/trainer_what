// The Brain showcases' client traces
// (docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.3): writes
// apps/web/components/marketing/brain/data/traces.client.json from the
// canonical traces.json, without code references, file paths or
// verification notes (stripForClient), minified. The render and runtime
// modules import the client copy; only this script and
// tests/marketing-brain-traces.test.ts read traces.json.
//
//   node scripts/brain-traces.mjs           write the client copy
//   node scripts/brain-traces.mjs --check   exit 1 if it is stale
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// apps/web has no "type": "module", so Node detects the engine's ES module
// syntax itself and would warn about it on every run.
process.removeAllListeners("warning").on("warning", (w) => {
  if (w.code !== "MODULE_TYPELESS_PACKAGE_JSON") console.warn(w);
});
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = resolve(root, "apps/web/components/marketing/brain/data");
const { stripForClient } = await import(resolve(root, "apps/web/components/marketing/brain/engine/data.js"));

const full = JSON.parse(await readFile(resolve(data, "traces.json"), "utf8"));
const client = JSON.stringify(stripForClient(full));
const target = resolve(data, "traces.client.json");
if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== client) {
    console.error("traces.client.json is stale: run node scripts/brain-traces.mjs");
    process.exit(1);
  }
  console.log("traces.client.json is current");
} else {
  await writeFile(target, client);
  console.log(`traces.client.json: ${client.length} B, ${gzipSync(client).length} B gzipped`);
}
