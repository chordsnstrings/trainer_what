import { createDatabase } from "@trainer/db";
import { randomUUID } from "node:crypto";
import { assertLocalSyntheticTarget } from "./synthetic-guard.ts";

// This fixture enables browser testing of website draft/publication. It does not
// qualify a Brain, configure providers, create charges, or bypass the launch API.
assertLocalSyntheticTarget("Browser launch fixture");
const db = await createDatabase();
try {
  const client = await db.system(async (tx) => {
    const [demo] = await tx.query(
      "SELECT t.id FROM tenants t JOIN memberships m ON m.tenant_id=t.id AND m.role='owner' JOIN users u ON u.id=m.user_id WHERE t.slug='alex-morgan' AND u.email='coach@example.test' AND t.lifecycle_state='active' AND EXISTS(SELECT 1 FROM records r WHERE r.tenant_id=t.id AND r.kind='nutrition_setup' AND r.data->>'synthetic'='true') AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.tenant_id=t.id AND s.data->>'synthetic'='true') FOR UPDATE OF t",
    );
    if (!demo)
      throw new Error(
        "Seed the known synthetic demo workspace before browser completion checks",
      );
    await tx.query("UPDATE tenants SET published=true WHERE id=$1", [demo.id]);
    const [subscriber] = await tx.query(
      "SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.role='subscriber' AND u.email='sam.taylor@example.test'",
      [demo.id],
    );
    if (!subscriber)
      throw new Error("The synthetic browser subscriber is missing");
    return {
      tenantId: demo.id,
      userId: subscriber.user_id,
      role: "subscriber",
    };
  });
  await db.tenant(client, (tx) =>
    tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','synthetic-browser-fixture',true)",
      [randomUUID(), client.tenantId, client.userId],
    ),
  );
  console.log(
    "Browser fixture: synthetic Alex Morgan launch state prepared; website draft and publication remain UI-tested.",
  );
} finally {
  await db.close();
}
