import { randomUUID } from "node:crypto";
import { createDatabase } from "@trainer/db";
import { assertLocalSyntheticTarget } from "./synthetic-guard.ts";
import { seedPreviewBrain } from "../tests/trainer-preview-fixtures.ts";
assertLocalSyntheticTarget("Trainer subscriber preview browser fixture");
const db = await createDatabase();
try {
  const a = await db.system(async tx => {
    const [row] = await tx.query("SELECT m.user_id,m.tenant_id FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE t.slug='alex-morgan' AND u.email='coach@example.test' AND m.role='owner'");
    if (!row) throw Error("The known synthetic coaching workspace is required");
    return { tenantId: row.tenant_id, userId: row.user_id, role: "owner" };
  });
  await seedPreviewBrain(db, a);
  // Independent trainer accounts keep long automated journeys from consuming
  // each other's per-user API budget. They share the same synthetic Brain.
  await db.system(async tx => {
    for (const width of [1280, 390]) {
      const id = randomUUID();
      await tx.query("INSERT INTO users(id,email,name,password_hash,email_verified) SELECT $1,$2,name,password_hash,email_verified FROM users WHERE id=$3", [id, `preview-${width}@example.test`, a.userId]);
      await tx.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [a.tenantId, id]);
    }
  });
  await db.tenant(a, async tx => {
    await tx.query("INSERT INTO trainer_voices(id,tenant_id,user_id,status,provider,provider_voice_id,evidence,consent_version,verified_at) VALUES($1,$2,$3,'verified','cartesia','synthetic-preview-coach','{}','fixture',now())", [randomUUID(), a.tenantId, a.userId]);
    await tx.query("INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'voice','fixture',true)", [randomUUID(), a.tenantId, a.userId]);
  });
} finally { await db.close(); }
