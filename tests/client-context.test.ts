import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDatabase, type Actor, type Database } from "@trainer/db";
import { clientContextRoutes } from "../apps/api/src/client-context.ts";
import {
  emptyClientContext,
  datedContextState,
} from "../packages/domain/src/client-context.ts";
import {
  exportPersonalData,
  erasePersonalData,
} from "../apps/api/src/privacy-lifecycle.ts";

let db: Database;
const app = Fastify();
const owner: Actor = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  role: "owner",
};
const client = { ...owner, userId: randomUUID(), role: "subscriber" };
const peer = { ...client, userId: randomUUID() };
const foreign = { ...owner, tenantId: randomUUID(), userId: randomUUID() };
const actors = [owner, client, peer, foreign];
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const id of [owner.tenantId, foreign.tenantId])
      await tx.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1::uuid,$1::text,'Fixture')",
        [id],
      );
    for (const a of actors) {
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Fixture','fixture')",
        [a.userId, a.userId + "@example.test"],
      );
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [a.tenantId, a.userId, a.role],
      );
    }
  });
  app.setErrorHandler((e: any, _req, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ message: e.message }),
  );
  clientContextRoutes(app, db, (req) =>
    actors.find((a) => a.userId === req.headers["x-fixture"])!,
  );
});
after(async () => {
  await app.close();
  await db.close();
});
const request = (a: Actor, data?: any, version = 0, target = client.userId) =>
  app.inject({
    url: `/api/v1/clients/${target}/context`,
    method: data ? "PUT" : "GET",
    headers: { "x-fixture": a.userId },
    payload: data ? { version, data } : undefined,
  });

test("only the current client writes; stale revisions and cross-client access fail", async () => {
  assert.equal((await request(peer)).statusCode, 403);
  assert.equal((await request(foreign)).statusCode, 404);
  assert.equal((await request(owner, emptyClientContext())).statusCode, 403);
  const saved = await request(client, {
    ...emptyClientContext(),
    communicationStyle: "concise",
    communicationNotes: "Keep my notes private",
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().version, 1);
  assert.deepEqual(saved.json().allowedUses, ["render"]);
  assert.equal((await request(client, emptyClientContext())).statusCode, 409);
  assert.equal(
    (await request(client)).headers["cache-control"],
    "private, no-store",
  );
  const hidden = await db.tenant(peer, (tx) =>
    tx.query("SELECT * FROM records WHERE kind='client_context'"),
  );
  assert.equal(hidden.length, 0);
});
test("trainer views require current consent, and revoked membership rejects stale sessions", async () => {
  assert.equal((await request(owner)).statusCode, 403);
  await db.tenant(owner, (tx) =>
    tx.query(
      "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','fixture',true)",
      [randomUUID(), owner.tenantId, client.userId],
    ),
  );
  assert.equal((await request(owner)).statusCode, 200);
  await db.system((tx) =>
    tx.query("DELETE FROM memberships WHERE tenant_id=$1 AND user_id=$2", [
      peer.tenantId,
      peer.userId,
    ]),
  );
  assert.equal(
    (await request(peer, emptyClientContext(), 0, peer.userId)).statusCode,
    403,
  );
});
test("invalid date ranges/timezones cannot persist and local dates determine status", async () => {
  const change = {
    id: randomUUID(),
    kind: "travel" as const,
    title: "Travel",
    startsOn: "2026-09-27",
    endsOn: "2026-09-28",
    timezone: "Asia/Dubai",
    availabilityNotes: "",
    equipmentNotes: "",
  };
  assert.equal(
    datedContextState(change, new Date("2026-09-26T21:00:00Z")),
    "active",
  );
  for (const patch of [{ endsOn: "2026-09-26" }, { timezone: "invalid" }])
    assert.equal(
      (
        await request(
          client,
          { ...emptyClientContext(), datedChanges: [{ ...change, ...patch }] },
          1,
        )
      ).statusCode,
      400,
    );
});
test("personal export includes context, erasure removes it, and audit omits its text", async () => {
  const exported = await exportPersonalData(db, client);
  assert.match(JSON.stringify(exported), /Keep my notes private/);
  const events = await db.tenant(owner, (tx) =>
    tx.query("SELECT * FROM events WHERE name='client_context.updated'"),
  );
  assert.equal(events.length, 1);
  assert.doesNotMatch(JSON.stringify(events), /Keep my notes private/);
  await db.tenant(
    owner,
    (tx) =>
      erasePersonalData(
        tx,
        owner,
        client.userId,
        client.userId + "@example.test",
      ),
    { privacyErasure: true },
  );
  assert.equal((await request(client)).json().version, 0);
});
