import { randomUUID } from "node:crypto";
import { putRecord, type Actor, type Database } from "@trainer/db";

/** Synthetic prerequisites for financial tests; no provider call is made. */
export async function readyServices(db: Database, owner: Actor) {
  const config: Record<string, string> = {
    MODEL_BASE_URL: "https://model.billing.invalid",
    MODEL_API_KEY: "fixture",
    MODEL_NAME: "fixture",
    VOICE_PROVIDER: "elevenlabs",
    VOICE_BASE_URL: "https://voice.billing.invalid",
    VOICE_API_KEY: "fixture",
    VOICE_MODEL: "fixture",
    VOICE_PRICE_VERSION: "fixture",
    VOICE_USD_PER_1000_CHARACTERS: "1",
    VOICE_DAILY_USD_LIMIT: "5",
    VOICE_CONTRACT_VERIFIED: "true",
  };
  const previous = Object.fromEntries(
    Object.keys(config).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, config);
  await db.tenant(owner, async (tx) => {
    await putRecord(tx, owner, "brain_release", {}, { status: "published" });
    await putRecord(
      tx,
      owner,
      "exercise",
      { name: "Fixture squat", sets: 3, reps: 8, restSeconds: 60 },
      { status: "active" },
    );
    await tx.query(
      "INSERT INTO trainer_voices(id,tenant_id,user_id,status,provider_voice_id,consent_version) VALUES($1,$2,$3,'verified','billing-fixture-voice','fixture')",
      [randomUUID(), owner.tenantId, owner.userId],
    );
    await tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'voice','fixture',true)",
      [randomUUID(), owner.tenantId, owner.userId],
    );
  });
  return () => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}
