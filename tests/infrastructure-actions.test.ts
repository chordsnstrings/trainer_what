import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDatabase, type Database } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import {
  registerInfrastructureActions,
  workerDispatchControl,
} from "../apps/api/src/infrastructure-actions.ts";
let db: Database;
const app = Fastify(),
  operator = {
    userId: randomUUID(),
    tenantId: randomUUID(),
    role: "owner",
    platformRole: "admin",
  };
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system((tx) =>
    tx.query(
      "INSERT INTO users(id,email,name,password_hash,platform_role) VALUES($1,'infra-actions@example.test','Operator','unused','admin')",
      [operator.userId],
    ),
  );
  app.setErrorHandler((e: any, _req, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ message: e.message, code: e.code }),
  );
  registerInfrastructureActions(app, db, (req) => ({
    ...operator,
    platformRole: String(req.headers["x-role"] ?? "admin"),
    mfaAt: String(req.headers["x-mfa"] ?? new Date().toISOString()),
  }));
});
after(async () => {
  await app.close();
  await db.close();
});
const req = (
  path = "",
  body?: any,
  headers: Record<string, string | undefined> = {},
) =>
  app.inject({
    url: "/api/v1/admin/infrastructure/operations" + path,
    method: body ? "POST" : "GET",
    payload: body,
    headers,
  });
const state = async () => {
  const r = await req();
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
async function policy(enabled = true, limit = 20) {
  const s = await state();
  const r = await req("/policy", {
    revision: s.policy.revision,
    enabled,
    actionsPerHour: limit,
    monthlyCostCapMinor: 0,
    reason: "Synthetic reviewed policy change",
  });
  assert.equal(r.statusCode, 200, r.body);
}
async function propose(paused = true) {
  const s = await state();
  const b = {
    requestId: randomUUID(),
    resourceId: "worker:primary",
    action: "set_worker_dispatch",
    policyRevision: s.policy.revision,
    expectedRevision: s.resource.revision,
    estimatedMonthlyCostMinor: 0,
    desired: { paused, intervalMs: 10000 },
    reason: "Synthetic maintenance operation",
  };
  const r = await req("", b);
  assert.equal(r.statusCode, 200, r.body);
  return { body: b, operation: r.json() };
}
const review = { reason: "Operator verified this exact operation" };
test("disabled defaults, role, MFA and fixed action/resource scope fail closed", async () => {
  const s = await state();
  assert.equal(s.policy.enabled, false);
  assert.equal((await workerDispatchControl(db)).paused, false);
  for (const headers of [
    { "x-role": "finance" },
    { "x-mfa": "invalid" },
    { "x-mfa": new Date(Date.now() + 60000).toISOString() },
  ])
    assert.equal((await req("", undefined, headers)).statusCode, 403);
  await assert.rejects(
    db.tenant(operator, (tx) =>
      tx.query("SELECT * FROM infrastructure_actions"),
    ),
    /permission denied/,
  );
  await policy();
  const { body } = await propose();
  for (const patch of [
    { action: "delete_database" },
    { resourceId: "foreign-worker" },
    { estimatedMonthlyCostMinor: 1 },
    { desired: { paused: false, intervalMs: 1 } },
  ])
    assert.equal(
      (await req("", { ...body, ...patch, requestId: randomUUID() }))
        .statusCode,
      400,
    );
});
test("review, execution and rollback are idempotent and preserve original intent", async () => {
  const { body, operation: op } = await propose();
  assert.equal((await req("", body)).json().id, op.id);
  assert.equal(
    (await req("", { ...body, reason: "Different maintenance operation" }))
      .statusCode,
    409,
  );
  assert.equal((await req(`/${op.id}/execute`, review)).statusCode, 409);
  assert.equal((await req(`/${op.id}/approve`, review)).statusCode, 200);
  let r = await req(`/${op.id}/execute`, review);
  assert.equal(r.statusCode, 200, r.body);
  const revision = r.json().result_revision;
  assert.equal(
    (await req(`/${op.id}/execute`, review)).json().result_revision,
    revision,
  );
  assert.deepEqual(await workerDispatchControl(db), {
    revision,
    paused: true,
    intervalMs: 10000,
  });
  await policy(false);
  r = await req(`/${op.id}/rollback`, review);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await workerDispatchControl(db)).paused, false);
  const undone = await workerDispatchControl(db);
  assert.equal((await req(`/${op.id}/rollback`, review)).statusCode, 200);
  assert.deepEqual(await workerDispatchControl(db), undone);
  await assert.rejects(
    db.system((tx) =>
      tx.query(
        "UPDATE infrastructure_actions SET desired_state='{}'::jsonb WHERE id=$1",
        [op.id],
      ),
    ),
    /immutable/,
  );
});
test("changed policy/resource and revoked approval cannot execute or overwrite newer operations", async () => {
  await policy();
  let first = await propose();
  await req(`/${first.operation.id}/approve`, review);
  await policy();
  assert.equal(
    (await req(`/${first.operation.id}/execute`, review)).statusCode,
    409,
  );
  first = await propose();
  const stale = await propose(false);
  await req(`/${first.operation.id}/approve`, review);
  assert.equal(
    (await req(`/${first.operation.id}/execute`, review)).statusCode,
    200,
  );
  assert.equal(
    (await req(`/${stale.operation.id}/approve`, review)).statusCode,
    409,
  );
  const later = await propose(false);
  await req(`/${later.operation.id}/approve`, review);
  assert.equal(
    (await req(`/${later.operation.id}/execute`, review)).statusCode,
    200,
  );
  assert.equal(
    (await req(`/${first.operation.id}/rollback`, review)).statusCode,
    409,
  );
});
test("hourly limits, expiry and current operator authority remain enforced", async () => {
  await policy(true, 1);
  const { operation: op } = await propose();
  await req(`/${op.id}/approve`, review);
  assert.equal(
    (await req(`/${op.id}/execute`, review)).json().code,
    "RATE_LIMIT",
  );
  await policy(true, 20);
  const expired = await propose();
  // Test the expiry gate without mutating its sealed original intent.
  const originalNow = Date.now;
  Date.now = () => originalNow() + 16 * 60000;
  try {
    assert.equal(
      (
        await req(`/${expired.operation.id}/approve`, review, {
          "x-mfa": new Date(Date.now()).toISOString(),
        })
      ).json().code,
      "OPERATION_EXPIRED",
    );
  } finally {
    Date.now = originalNow;
  }
  await db.system((tx) =>
    tx.query("UPDATE users SET platform_role='support' WHERE id=$1", [
      operator.userId,
    ]),
  );
  assert.equal((await req()).statusCode, 403);
});

test("assembled application registers the broker beside the observe-only endpoints", async () => {
  const assembled = await buildApp({ db, testing: true });
  try {
    await assembled.ready();
    assert.equal(
      assembled.hasRoute({
        method: "POST",
        url: "/api/v1/admin/infrastructure/operations",
      }),
      true,
    );
    assert.equal(
      assembled.hasRoute({
        method: "POST",
        url: "/api/v1/admin/infrastructure/actions",
      }),
      true,
    );
    assert.equal(
      assembled.hasRoute({ method: "GET", url: "/api/v1/admin/affiliates" }),
      true,
    );
  } finally {
    await assembled.close();
  }
});
