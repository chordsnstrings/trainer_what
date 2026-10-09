// Only the isolated conversation browser runner uses this synthetic release.
import { createDatabase, putRecord } from "@trainer/db";
import { assertLocalSyntheticTarget } from "./synthetic-guard.ts";
assertLocalSyntheticTarget("Fidelity review browser fixture");
const db = await createDatabase();
try {
  const a = await db.system(async (tx) => {
    const [row] = await tx.query(
      "SELECT m.tenant_id,m.user_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id WHERE t.slug='alex-morgan' AND u.email='coach@example.test' AND m.role='owner' AND EXISTS(SELECT 1 FROM records r WHERE r.tenant_id=t.id AND r.kind='nutrition_setup' AND r.data->>'synthetic'='true')",
    );
    if (!row) throw Error("The known synthetic coaching workspace is required");
    return { tenantId: row.tenant_id, userId: row.user_id, role: "owner" };
  });
  await db.tenant(a, async (tx) => {
    const rules = await tx.query(
      "SELECT * FROM records WHERE kind='rule' AND status='confirmed' ORDER BY id",
    );
    await putRecord(
      tx,
      a,
      "brain_release",
      { rules, communication: { tone: "calm" }, synthetic: true },
      { status: "published" },
    );
  });
} finally {
  await db.close();
}
