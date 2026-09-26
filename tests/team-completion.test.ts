import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDatabase, type Database } from "@trainer/db";
import {
  registerTeamRoutes,
  lockActiveInvitation,
  touchTeamSession,
} from "../apps/api/src/team.ts";
import { tokenHash } from "../apps/api/src/auth.ts";
let db: Database;
const app = Fastify();
const owner = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
const staff = { ...owner, userId: randomUUID(), role: "staff" };
const finance = { ...owner, userId: randomUUID(), role: "finance" };
const foreign = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const a of [owner, staff, finance, foreign])
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Team fixture','unused')",
        [a.userId, a.userId + "@example.test"],
      );
    for (const a of [owner, foreign])
      await tx.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1::uuid,$1::uuid::text,'Team fixture')",
        [a.tenantId],
      );
    for (const a of [owner, staff, finance, foreign])
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [a.tenantId, a.userId, a.role],
      );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'staff')",
      [foreign.tenantId, staff.userId],
    );
  });
  app.setErrorHandler((e: any, _r, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ code: e.code, message: e.message }),
  );
  registerTeamRoutes(app, db, (req) => ({
    ...({ staff, finance, foreign }[String(req.headers["x-actor"])] ?? owner),
    mfaAt: req.headers["x-stale"] ? null : new Date().toISOString(),
  }));
});
after(async () => {
  await app.close();
  await db.close();
});
const req = (
  path: string,
  method: any = "GET",
  payload?: any,
  headers: any = {},
) => app.inject({ url: "/api/v1/team" + path, method, payload, headers });
test("team management requires current ownership and fresh MFA", async () => {
  for (const who of ["staff", "finance"])
    assert.equal(
      (await req("", "GET", undefined, { "x-actor": who })).statusCode,
      403,
    );
  assert.equal(
    (await req("", "GET", undefined, { "x-stale": "yes" })).statusCode,
    403,
  );
  await db.system((tx) =>
    tx.query(
      "UPDATE memberships SET role='staff' WHERE tenant_id=$1 AND user_id=$2",
      [owner.tenantId, owner.userId],
    ),
  );
  assert.equal(
    (
      await req("/invitations", "POST", {
        email: randomUUID() + "@example.test",
        role: "staff",
      })
    ).statusCode,
    403,
  );
  await db.system((tx) =>
    tx.query(
      "UPDATE memberships SET role='owner' WHERE tenant_id=$1 AND user_id=$2",
      [owner.tenantId, owner.userId],
    ),
  );
});
test("issuing a replacement invite invalidates the old link; revoke is scoped and audited", async () => {
  const email = randomUUID() + "@example.test",
    first = await req("/invitations", "POST", { email, role: "staff" });
  assert.equal(first.statusCode, 200, first.body);
  const firstHash = tokenHash(first.json().url.split("/").pop());
  assert.ok(await db.system((tx) => lockActiveInvitation(tx, firstHash)));
  const second = await req("/invitations", "POST", { email, role: "finance" });
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(
    await db.system((tx) => lockActiveInvitation(tx, firstHash)),
    null,
  );
  const secondHash = tokenHash(second.json().url.split("/").pop());
  assert.equal(
    (
      await req(
        `/invitations/${second.json().id}/revoke`,
        "POST",
        { reason: "Foreign owner must not revoke" },
        { "x-actor": "foreign" },
      )
    ).statusCode,
    409,
  );
  const revoked = await req(`/invitations/${second.json().id}/revoke`, "POST", {
    reason: "Owner reviewed and revoked",
  });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(
    await db.system((tx) => lockActiveInvitation(tx, secondHash)),
    null,
  );
  const list = await req("");
  assert.equal(list.statusCode, 200, list.body);
  assert.ok(
    list.json().audit.some((a: any) => a.name === "team.invitation_revoked"),
  );
  assert.equal(JSON.stringify(list.json()).includes(firstHash), false);
});
test("acceptance refuses a staff invite after its issuing owner loses ownership", async () => {
  const created = await req("/invitations", "POST", {
    email: randomUUID() + "@example.test",
    role: "staff",
  });
  assert.equal(created.statusCode, 200, created.body);
  const hash = tokenHash(created.json().url.split("/").pop());
  await db.system((tx) =>
    tx.query(
      "UPDATE memberships SET role='staff' WHERE tenant_id=$1 AND user_id=$2",
      [owner.tenantId, owner.userId],
    ),
  );
  assert.equal(await db.system((tx) => lockActiveInvitation(tx, hash)), null);
  await db.system((tx) =>
    tx.query(
      "UPDATE memberships SET role='owner' WHERE tenant_id=$1 AND user_id=$2",
      [owner.tenantId, owner.userId],
    ),
  );
});
test("role changes use CAS and revoke only this workspace's sessions", async () => {
  const local = tokenHash(randomUUID()),
    remote = tokenHash(randomUUID());
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day'),($4,$2,$5,now()+interval '1 day')",
      [local, staff.userId, owner.tenantId, remote, foreign.tenantId],
    );
  });
  const change = await req("/" + staff.userId, "PATCH", {
    revision: 1,
    role: "finance",
    reason: "Moved into finance team",
  });
  assert.equal(change.statusCode, 200, change.body);
  assert.equal(change.json().version, 2);
  assert.equal(
    (
      await req("/" + staff.userId, "PATCH", {
        revision: 1,
        role: "staff",
        reason: "Stale role change must fail",
      })
    ).statusCode,
    409,
  );
  const sessions = await db.system((tx) =>
    tx.query("SELECT tenant_id FROM sessions WHERE user_id=$1", [staff.userId]),
  );
  assert.deepEqual(
    sessions.map((s) => s.tenant_id),
    [foreign.tenantId],
  );
  assert.equal(
    (
      await req("/" + owner.userId, "PATCH", {
        revision: 1,
        role: "staff",
        reason: "Must not transfer implicitly",
      })
    ).statusCode,
    400,
  );
});
test("revocation rejects stale revision and protects owner while removing team access", async () => {
  assert.equal(
    (
      await req("/" + staff.userId, "DELETE", {
        revision: 1,
        reason: "Stale removal must fail",
      })
    ).statusCode,
    409,
  );
  const remove = await req("/" + staff.userId, "DELETE", {
    revision: 2,
    reason: "Workspace role no longer needed",
  });
  assert.equal(remove.statusCode, 200, remove.body);
  const remaining = await db.system((tx) =>
    tx.query("SELECT tenant_id FROM memberships WHERE user_id=$1", [
      staff.userId,
    ]),
  );
  assert.deepEqual(
    remaining.map((m) => m.tenant_id),
    [foreign.tenantId],
  );
  assert.equal(
    (
      await req("/" + owner.userId, "DELETE", {
        revision: 1,
        reason: "Owner cannot remove self",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await req("/" + foreign.userId, "DELETE", {
        revision: 1,
        reason: "Foreign owner cannot be removed",
      })
    ).statusCode,
    409,
  );
});
test("last-active tracking is throttled and the team listing excludes subscribers", async () => {
  const hash = tokenHash(randomUUID());
  await db.system((tx) =>
    tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,last_seen_at) VALUES($1,$2,$3,now()+interval '1 day',now()-interval '1 day')",
      [hash, finance.userId, owner.tenantId],
    ),
  );
  await touchTeamSession(db, hash);
  const [one] = await db.system((tx) =>
    tx.query("SELECT last_seen_at FROM sessions WHERE token_hash=$1", [hash]),
  );
  await touchTeamSession(db, hash);
  const [two] = await db.system((tx) =>
    tx.query("SELECT last_seen_at FROM sessions WHERE token_hash=$1", [hash]),
  );
  assert.equal(String(one.last_seen_at), String(two.last_seen_at));
  assert.ok(Date.now() - new Date(one.last_seen_at).getTime() < 30000);
  const list = await req("");
  assert.ok(
    list
      .json()
      .members.every((m: any) =>
        ["owner", "staff", "finance"].includes(m.role),
      ),
  );
  assert.ok(
    list.json().members.find((m: any) => m.id === finance.userId).last_active,
  );
});
