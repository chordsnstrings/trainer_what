import { randomUUID } from "node:crypto";
import { createDatabase, putRecord } from "@trainer/db";
import { assertLocalSyntheticTarget } from "./synthetic-guard.ts";
assertLocalSyntheticTarget("WHOOP training browser fixture");
const db = await createDatabase();
try {
  const a = await db.system(async (tx) => {
    const [row] = await tx.query(
      "SELECT m.user_id,m.tenant_id FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE t.slug='alex-morgan' AND u.email='sam.taylor@example.test' AND m.role='subscriber' AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.tenant_id=t.id AND s.data->>'synthetic'='true')",
    );
    if (!row) throw Error("The known synthetic coaching member is required");
    return { tenantId: row.tenant_id, userId: row.user_id, role: "subscriber" };
  });
  await db.tenant(a, async (tx) => {
    await tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'wearable:whoop','synthetic-fixture',true)",
      [randomUUID(), a.tenantId, a.userId],
    );
    await tx.query(
      "INSERT INTO integration_connections(id,tenant_id,user_id,provider,status,credentials,last_synced_at,next_sync_at,scopes) VALUES($1,$2,$3,'whoop','active','fixture-unused',now(),now()+interval '30 days',$4)",
      [
        randomUUID(),
        a.tenantId,
        a.userId,
        ["offline", "read:recovery", "read:sleep"],
      ],
    );
    await putRecord(
      tx,
      a,
      "wearable",
      {
        source: "whoop",
        allowedUses: ["render", "deterministic_feature"],
        restrictions: ["no_model_prompt"],
        observations: [
          ...[{ type: "sleep_seconds", value: 25920, unit: "seconds" }, { type: "hrv_rmssd_ms", value: 54, unit: "ms" }, { type: "resting_heart_rate", value: 57, unit: "bpm" }].map(o => ({ ...o, id: `synthetic-${o.type}`, sleepId: "synthetic-main-sleep", measuredAt: new Date(Date.now() - 1000).toISOString(), trainingReady: true, calibrating: false })),
          {
            id: "synthetic-recovery",
            sleepId: "synthetic-main-sleep",
            type: "recovery_score",
            value: 25,
            unit: "percent",
            measuredAt: new Date(Date.now() - 1000).toISOString(),
            trainingReady: true,
            calibrating: false,
          },
        ],
      },
      { status: "imported" },
    );
  });
} finally {
  await db.close();
}
