import { createDatabase } from "@trainer/db";
import {
  integrationStatus,
  runtimeConfig,
  withRuntimeConfig,
} from "@trainer/providers";
import { loadRuntimeSettings } from "../apps/api/src/platform-settings.ts";
const required = ["DATABASE_URL", "PUBLIC_APP_URL", "SECURITY_ENCRYPTION_KEY"];
const flags = [
  "LEGAL_APPROVED",
  "COMMERCE_APPROVED",
  "PAYOUTS_APPROVED",
  "LEAN_CONTRACT_VERIFIED",
  "NUTRITION_ENABLED",
  "NUTRITION_SCOPE_APPROVED",
  "BUNDLE_CHANGES_APPROVED",
];
const missing = required.filter((k) => !process.env[k]);
const findings: string[] = [];
if (
  process.env.PUBLIC_APP_URL &&
  !process.env.PUBLIC_APP_URL.startsWith("https://")
)
  findings.push("Production public URL requires HTTPS");
if (
  process.env.SECURITY_ENCRYPTION_KEY &&
  Buffer.from(process.env.SECURITY_ENCRYPTION_KEY, "base64").length !== 32
)
  findings.push("Security encryption key must decode to 32 bytes");
let database = "not checked";
let settings: Record<string, string> = {};
if (process.env.DATABASE_URL) {
  const db = await createDatabase();
  try {
    await db.system((tx) => tx.query("SELECT 1"));
    settings = await loadRuntimeSettings(db);
    database = "connected; migrations and runtime role checked";
  } finally {
    await db.close();
  }
}
const report = withRuntimeConfig(settings, () => ({
  database,
  missing,
  findings,
  flags: Object.fromEntries(
    flags.map((k) => [k, runtimeConfig()[k] === "true"]),
  ),
  integrations: integrationStatus(),
  notice:
    "Configured flags are operator declarations; this check does not verify provider approval, fund transfers, browser behavior or recovery evidence.",
}));
console.log(JSON.stringify(report, null, 2));
if (missing.length || findings.length) process.exitCode = 1;
