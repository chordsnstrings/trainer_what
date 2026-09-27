import { createDatabase } from "@trainer/db";
import {
  integrationStatus,
  runtimeConfig,
  withRuntimeConfig,
} from "@trainer/providers";
import { loadRuntimeSettings } from "../apps/api/src/platform-settings.ts";
import { encryptionKeyring } from "../apps/api/src/sealing.ts";
import { resealSecrets, sealedTotals } from "../apps/api/src/key-rotation.ts";
const required = [
  "DATABASE_URL",
  "PUBLIC_APP_URL",
  "SECURITY_ENCRYPTION_KEY",
  "INTERNAL_PROXY_SECRET",
];
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
if (process.env.PUBLIC_APP_URL) {
  try {
    const origin = new URL(process.env.PUBLIC_APP_URL);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.origin !== process.env.PUBLIC_APP_URL
    )
      findings.push(
        "Production public URL must be one exact HTTPS origin without credentials, path, query or fragment",
      );
  } catch {
    findings.push("Production public URL is invalid");
  }
}
if (
  process.env.INTERNAL_PROXY_SECRET &&
  Buffer.byteLength(process.env.INTERNAL_PROXY_SECRET) < 32
)
  findings.push(
    "Internal proxy signing secret must contain at least 32 UTF-8 bytes",
  );
if (
  process.env.INTERNAL_PROXY_SECRET &&
  process.env.INTERNAL_PROXY_SECRET === process.env.SECURITY_ENCRYPTION_KEY
)
  findings.push(
    "Use a separate internal proxy secret and account encryption key",
  );
if (
  process.env.SECURITY_ENCRYPTION_KEY &&
  Buffer.from(process.env.SECURITY_ENCRYPTION_KEY, "base64").length !== 32
)
  findings.push("Security encryption key must decode to 32 bytes");
const keyring = encryptionKeyring();
if (keyring.invalidPrevious)
  findings.push("Each previous encryption key must decode to 32 bytes");
let database = "not checked";
let settings: Record<string, string> = {};
let sealedValues: ReturnType<typeof sealedTotals> | "not checked" =
  "not checked";
if (process.env.DATABASE_URL) {
  const db = await createDatabase();
  try {
    await db.system((tx) => tx.query("SELECT 1"));
    settings = await loadRuntimeSettings(db);
    database = "connected; migrations and runtime role checked";
    if (keyring.active) {
      // Counts only. "legacy" values use the active key in the older envelope.
      sealedValues = sealedTotals(await resealSecrets(db, { apply: false }));
      if (sealedValues.previous)
        findings.push(
          `${sealedValues.previous} sealed values still use a previous encryption key; run npm run secrets:reseal before removing it`,
        );
      if (sealedValues.unreadable)
        findings.push(
          `${sealedValues.unreadable} sealed values cannot be opened with the configured encryption keys`,
        );
    }
  } finally {
    await db.close();
  }
}
const report = withRuntimeConfig(settings, () => ({
  database,
  sealedValues,
  previousEncryptionKeys: keyring.previous.length,
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
