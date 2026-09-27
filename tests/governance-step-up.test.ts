import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { governanceFixture } from "./governance-fixtures.ts";
import {
  operatorRouteInventory,
  isOperatorRoute,
  stepUpExempt,
  STEP_UP_EXEMPT_ROUTES,
} from "../apps/api/src/operator-step-up.ts";

let f: Awaited<ReturnType<typeof governanceFixture>>;
before(async () => {
  f = await governanceFixture();
});
after(async () => {
  await f?.close();
});
// Parameter values only need to match the route; the guard runs before any
// handler, parameter parsing or body validation.
const concrete = (url: string) =>
  url
    .replace(":view", "trainers")
    .replace(":action", "acknowledge")
    .replace(":period", "2026-01")
    .replace(/:[A-Za-z]+/g, () => randomUUID());

test("the operator route inventory covers every admin and operator-authority route", () => {
  const routes = operatorRouteInventory(f.app);
  const keys = new Set(routes.map((r) => r.method + " " + r.url));
  assert.ok(routes.length >= 60, `only ${routes.length} operator routes found`);
  for (const expected of [
    "POST /api/v1/admin/governance/workspaces/:tenantId/suspend",
    "POST /api/v1/admin/governance/accounts/:userId/lock",
    "GET /api/v1/admin/metrics",
    "GET /api/v1/admin/metrics.csv",
    "POST /api/v1/admin/alerts/:id/resolve",
    "GET /api/v1/admin/tenants/:tenantId/finance/controls",
    "POST /api/v1/admin/tenants/:tenantId/finance/policies",
    "POST /api/v1/admin/tenants/:tenantId/finance/automation",
    "POST /api/v1/admin/tenants/:tenantId/finance/payouts/:id/execute",
    "POST /api/v1/payout-runs/:id/execute",
    "GET /api/v1/admin/overview",
  ])
    assert.ok(keys.has(expected), expected + " missing from the inventory");
  assert.equal(isOperatorRoute("/api/v1/payout-runs/abc/execute"), true);
  assert.equal(isOperatorRoute("/api/v1/payout-runs/prepare"), false);
});

// The router matches percent-decoded paths: an encoded spelling reaches the
// same handler, so it must meet the same guard.
const encoded = (path: string) =>
  path
    .replace("/api/v1/admin/", "/api/v1/%61dmin/")
    .replace("/api/v1/payout-runs/", "/api/v1/p%61yout-runs/");

test("every operator route refuses a stale authenticator before any handler runs, however the path is spelled", async () => {
  const admin = await f.operator("admin", false);
  const finance = await f.operator("finance", false);
  const failures: string[] = [];
  let stateChanging = 0;
  const inventory = operatorRouteInventory(f.app);
  for (const route of inventory) {
    // Revocation-only routes are covered by their own test below.
    if (stepUpExempt(route.method, route.url)) continue;
    const write = route.method !== "GET";
    if (write) stateChanging++;
    for (const who of [admin, finance])
      for (const path of [concrete(route.url), encoded(concrete(route.url))]) {
        const r = await f.call(path.replace("/api/v1", ""), {
          method: route.method,
          cookie: who.cookie,
          ...(write ? { body: {} } : {}),
        });
        if (r.statusCode !== 403 || r.json().code !== "MFA_STEP_UP")
          failures.push(`${route.method} ${path}: ${r.statusCode} ${r.body.slice(0, 80)}`);
      }
  }
  assert.deepEqual(failures, []);
  // Every exemption names a real operator route.
  const keys = new Set(inventory.map((r) => r.method + " " + r.url));
  for (const exempt of STEP_UP_EXEMPT_ROUTES)
    assert.ok(keys.has(exempt), exempt + " is not an operator route");
  assert.deepEqual([...STEP_UP_EXEMPT_ROUTES], [
    "POST /api/v1/admin/support-previews/:id/end",
  ]);
  assert.ok(stateChanging >= 40, `only ${stateChanging} state-changing routes`);
  // Nothing was written by any refused request.
  const [audit] = await f.db.system((tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM admin_operations_audit WHERE actor_id=ANY($1::uuid[])",
      [[admin.userId, finance.userId]],
    ),
  );
  assert.equal(audit.n, 0);
});

test("finance controls, automation, overview and payout dispatch need a fresh code; a fresh code passes the guard", async () => {
  const owner = await f.person();
  const stale = await f.operator("finance", false);
  const fresh = await f.operator("finance", true);
  const paths = [
    `/admin/tenants/${owner.tenantId}/finance/controls`,
    `/admin/tenants/${owner.tenantId}/finance/statements/2026-01`,
    `/admin/tenants/${owner.tenantId}/finance/automation`,
    "/admin/overview",
  ];
  for (const path of paths) {
    const refused = await f.call(path, { cookie: stale.cookie });
    assert.equal(refused.json().code, "MFA_STEP_UP", path);
    const allowed = await f.call(path, { cookie: fresh.cookie });
    assert.notEqual(allowed.json().code, "MFA_STEP_UP", path);
    assert.ok(allowed.statusCode < 500, path + " " + allowed.body);
  }
  const controls = await f.call(
    `/admin/tenants/${owner.tenantId}/finance/controls`,
    { cookie: fresh.cookie },
  );
  assert.equal(controls.statusCode, 200, controls.body);
  const execute = await f.call(`/payout-runs/${randomUUID()}/execute`, {
    body: {},
    cookie: stale.cookie,
  });
  assert.equal(execute.json().code, "MFA_STEP_UP");
});

test("non-operators get the route's own refusal, not a step-up prompt", async () => {
  const owner = await f.person({ fresh: false });
  const r = await f.call("/admin/metrics", { cookie: owner.cookie });
  assert.equal(r.statusCode, 403);
  assert.notEqual(r.json().code, "MFA_STEP_UP");
  const anonymous = await f.call("/admin/alerts");
  assert.equal(anonymous.statusCode, 401);
});

test("an encoded admin path cannot skip the step-up guard", async () => {
  const stale = await f.operator("admin", false);
  const fresh = await f.operator("admin", true);
  for (const path of ["/admin/settings", "/%61dmin/settings", "/%61dmin/%73ettings"]) {
    const r = await f.call(path, { cookie: stale.cookie });
    assert.equal(r.statusCode, 403, path + " " + r.body);
    assert.equal(r.json().code, "MFA_STEP_UP", path);
    const ok = await f.call(path, { cookie: fresh.cookie });
    assert.notEqual(ok.json().code, "MFA_STEP_UP", path);
  }
});

test("a stale support operator can still stop their own preview but cannot read it", async () => {
  const support = await f.operator("support", false);
  const owner = await f.person();
  const client = await f.person({ tenantId: owner.tenantId, role: "subscriber" });
  const [session] = await f.db.system((tx) =>
    tx.query("SELECT session_id FROM sessions WHERE user_id=$1", [support.userId]),
  );
  const grantId = randomUUID();
  await f.db.system((tx) =>
    tx.query(
      "INSERT INTO support_preview_grants(id,operator_id,session_id,tenant_id,target_user_id,target_role,membership_version,case_id,request_key,fingerprint,reason,scopes,expires_at) VALUES($1,$2,$3,$4,$5,'subscriber',1,$6,$7,'synthetic-fingerprint','Synthetic support preview fixture',ARRAY['account'],now()+interval '12 minutes')",
      [grantId, support.userId, session.session_id, owner.tenantId, client.userId, randomUUID(), randomUUID()],
    ),
  );
  const read = await f.call(`/admin/support-previews/${grantId}`, {
    cookie: support.cookie,
  });
  assert.equal(read.statusCode, 403, read.body);
  assert.equal(read.json().code, "MFA_STEP_UP");
  const correction = await f.call(`/admin/support-previews/${grantId}/elevations`, {
    body: {},
    cookie: support.cookie,
  });
  assert.equal(correction.json().code, "MFA_STEP_UP");
  // The exemption follows the matched route, including an encoded spelling.
  const stop = await f.call(`/%61dmin/support-previews/${grantId}/end`, {
    body: { revision: 1 },
    cookie: support.cookie,
  });
  assert.equal(stop.statusCode, 200, stop.body);
  assert.equal(stop.json().grant.status, "revoked");
  const [grant] = await f.db.system((tx) =>
    tx.query("SELECT status,end_reason FROM support_preview_grants WHERE id=$1", [grantId]),
  );
  assert.deepEqual(grant, { status: "revoked", end_reason: "operator_stopped" });
  // Stopping again is harmless; reading still needs a fresh code.
  const again = await f.call(`/admin/support-previews/${grantId}/end`, {
    body: { revision: 1 },
    cookie: support.cookie,
  });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(
    (await f.call(`/admin/support-previews/${grantId}`, { cookie: support.cookie })).json().code,
    "MFA_STEP_UP",
  );
});
