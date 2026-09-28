import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { IMPORT_HISTORY_LIMIT } from "../apps/api/src/integrations-completion.ts";

// Found by the end-to-end harness: the bounded bootstrap (catalog kinds only)
// stopped carrying `wearable` records, and the connections page only listed
// per-source totals, so a member had no way to learn the id of an Apple Health
// export batch and could not delete it with DELETE /wearables/:id. The
// connections response now lists the member's own export-file batches
// (`importHistory`, newest first, bounded) with their ids.
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
const origin = "http://localhost:3000";
const cookieOf = (r: any) => String(r.headers["set-cookie"]).split(";")[0];
const call = (url: string, method: any = "GET", payload?: any, cookie?: string) =>
  app.inject({ url, method, payload, headers: { origin, ...(cookie ? { cookie } : {}) } });
let owner = "", member = "", other = "";
async function join(email: string) {
  const invite = (await call("/api/v1/invitations", "POST", { email, role: "subscriber" }, owner)).json();
  const joined = await call("/api/v1/invitations/accept", "POST", { token: invite.url.split("/").pop(), name: "Import Member", email, password: "ImportHistory2026!", accepted: true });
  assert.equal(joined.statusCode, 200, joined.body);
  return cookieOf(joined);
}
const observations = (value: number) => [
  { type: "steps", value, unit: "count", measuredAt: new Date(Date.now() - 86400000).toISOString() },
];
async function importBatch(cookie: string, value: number) {
  const r = await call("/api/v1/wearables/import", "POST", { source: "apple_health", consent: true, observations: observations(value) }, cookie);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function connections(cookie: string) {
  const r = await call("/api/v1/integrations/connections", "GET", undefined, cookie);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
before(async () => {
  process.env.SECURITY_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  const r = await call("/api/v1/auth/register", "POST", { name: "Import Coach", email: "import.coach@example.test", password: "ImportHistory2026!", slug: "import-coach", accepted: true });
  assert.equal(r.statusCode, 201, r.body);
  owner = cookieOf(r);
  member = await join("import.member@example.test");
  other = await join("import.other@example.test");
});
after(async () => {
  await app.close();
  await db.close();
});

test("the bootstrap does not carry wearable records, so the connections page names the batches", async () => {
  const first = await importBatch(member, 9120);
  const second = await importBatch(member, 8001);
  const records = (await call("/api/v1/bootstrap", "GET", undefined, member)).json().records;
  assert.equal(records.some((r: any) => r.kind === "wearable"), false, "wearable is outside the bootstrap catalog");
  const view = await connections(member);
  assert.deepEqual(view.importHistory.map((b: any) => b.id), [second.id, first.id], "newest first");
  assert.equal(view.importHistory[0].source, "apple_health");
  assert.equal(view.importHistory[0].observations, 1);
  assert.ok(view.importHistory[0].imported_at);
  assert.equal(view.imports.find((i: any) => i.source === "apple_health").batches, 2);
});

test("a listed batch is deleted and leaves the history and the totals", async () => {
  const before = await connections(member);
  const batch = before.importHistory[0];
  const deleted = await call(`/api/v1/wearables/${batch.id}`, "DELETE", undefined, member);
  assert.equal(deleted.statusCode, 200, deleted.body);
  const after = await connections(member);
  assert.equal(after.importHistory.some((b: any) => b.id === batch.id), false);
  assert.equal(
    after.imports.reduce((n: number, i: any) => n + i.batches, 0),
    before.imports.reduce((n: number, i: any) => n + i.batches, 0) - 1,
  );
});

test("another member sees only their own batches and cannot delete someone else's", async () => {
  const mine = (await connections(member)).importHistory;
  assert.ok(mine.length >= 1);
  assert.deepEqual((await connections(other)).importHistory, []);
  const refused = await call(`/api/v1/wearables/${mine[0].id}`, "DELETE", undefined, other);
  assert.equal(refused.statusCode, 404, refused.body);
  assert.equal((await connections(member)).importHistory.length, mine.length);
});

test("revoked batches leave the deletable history and the list is bounded", async () => {
  assert.equal((await call("/api/v1/integrations/apple_health/revoke", "POST", {}, member)).statusCode < 400, true);
  assert.deepEqual((await connections(member)).importHistory, [], "revoked use is no longer an active import");
  for (let i = 0; i < IMPORT_HISTORY_LIMIT + 2; i++) await importBatch(other, 1000 + i);
  const view = await connections(other);
  assert.equal(view.importHistory.length, IMPORT_HISTORY_LIMIT);
  assert.equal(view.imports.find((i: any) => i.source === "apple_health").batches, IMPORT_HISTORY_LIMIT + 2);
});
