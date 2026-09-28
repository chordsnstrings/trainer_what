import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database, type Actor } from "@trainer/db";
import { createPayout } from "../apps/api/src/finance.ts";

// Found by the end-to-end harness: preparing a payout for a month that has not
// been closed, or that closed with nothing to release (a workspace whose members
// are all in a free trial), returned HTTP 500. Both are expected business
// states, like the destination checks on the same route, and now answer 409.
let db: Database;
const a: Actor = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    await tx.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Payout fixture','not-a-real-login')", [
      a.userId,
      a.userId + "@example.test",
    ]);
    await tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Payout fixture')", [a.tenantId, a.tenantId]);
    await tx.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [a.tenantId, a.userId]);
  });
});
after(async () => db.close());

const prepare = (period: string) => db.tenant(a, (tx) => createPayout(tx, a, period, "dest_fixture"));

test("payout preparation without a closed month is a 409 conflict", async () => {
  await assert.rejects(prepare("2026-07"), (e: any) => e.statusCode === 409 && e.code === "PAYOUT_CLOSE_REQUIRED");
});

test("a closed month with nothing eligible is a 409 conflict and prepares nothing", async () => {
  await db.tenant(a, (tx) =>
    tx.query(
      "INSERT INTO records(id,tenant_id,kind,status,data) VALUES($1,$2,'close','closed',$3)",
      [randomUUID(), a.tenantId, { period: "2026-08", cutoff: "2026-08-31T20:00:00.000Z", eligibleMinor: 0 }],
    ),
  );
  await assert.rejects(prepare("2026-08"), (e: any) => e.statusCode === 409 && e.code === "PAYOUT_NOTHING_AVAILABLE");
  const payouts = await db.tenant(a, (tx) => tx.query("SELECT id FROM payouts"));
  assert.equal(payouts.length, 0);
});
