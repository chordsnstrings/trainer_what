import { createDatabase } from "@trainer/db";
import { resealSecrets, sealedTotals } from "../apps/api/src/key-rotation.ts";

if (!process.env.DATABASE_URL)
  throw new Error(
    "Set the deployed runtime DATABASE_URL before re-sealing stored secrets.",
  );
const db = await createDatabase();
try {
  // Counts only: this command never prints a secret, envelope or key.
  const sealedValues = await resealSecrets(db, { apply: true });
  const totals = sealedTotals(sealedValues);
  console.log(JSON.stringify({ sealedValues, totals }, null, 2));
  if (totals.unreadable) {
    process.exitCode = 1;
    console.log(
      "Some sealed values cannot be opened with the configured keys and were left unchanged. Keep the previous keys until those credentials are replaced or cleared.",
    );
  } else
    console.log(
      "Every sealed value now uses the active key. After the API and worker run without SECURITY_ENCRYPTION_PREVIOUS_KEYS and readiness passes, destroy the retired key.",
    );
} finally {
  await db.close();
}
