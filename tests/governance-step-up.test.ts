import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { governanceFixture } from "./governance-fixtures.ts";
import {
  operatorRouteInventory,
  isOperatorRoute,
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

test("every operator route refuses a stale authenticator before any handler runs", async () => {
  const admin = await f.operator("admin", false);
  const finance = await f.operator("finance", false);
  const failures: string[] = [];
  let stateChanging = 0;
  for (const route of operatorRouteInventory(f.app)) {
    const write = route.method !== "GET";
    if (write) stateChanging++;
    for (const who of [admin, finance]) {
      const r = await f.call(concrete(route.url).replace("/api/v1", ""), {
        method: route.method,
        cookie: who.cookie,
        ...(write ? { body: {} } : {}),
      });
      if (r.statusCode !== 403 || r.json().code !== "MFA_STEP_UP")
        failures.push(`${route.method} ${route.url}: ${r.statusCode} ${r.body.slice(0, 80)}`);
    }
  }
  assert.deepEqual(failures, []);
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
