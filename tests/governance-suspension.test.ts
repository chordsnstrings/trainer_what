import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { governanceFixture, password } from "./governance-fixtures.ts";
import { createPayout } from "../apps/api/src/finance.ts";
import { runTenantCycle } from "../apps/worker/src/tenant-cycle.ts";

let f: Awaited<ReturnType<typeof governanceFixture>>;
before(async () => {
  f = await governanceFixture();
});
after(async () => {
  await f?.close();
});

async function readyPayout(tenantId: string, period: string) {
  const id = randomUUID();
  await f.db.tenant(f.scoped(tenantId, "finance"), (tx) =>
    tx.query(
      "INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,status) VALUES($1,$2,$3,12500,'fixture-destination','ready')",
      [id, tenantId, period],
    ),
  );
  return id;
}
const payoutStatus = (tenantId: string, id: string) =>
  f.db
    .tenant(f.scoped(tenantId, "finance"), (tx) =>
      tx.query("SELECT status FROM payouts WHERE id=$1", [id]),
    )
    .then((rows) => rows[0]?.status);
const slugOf = async (tenantId: string) =>
  (
    await f.db.system((tx) =>
      tx.query("SELECT slug FROM tenants WHERE id=$1", [tenantId]),
    )
  )[0].slug as string;

test("suspension needs a Super admin, a fresh authenticator and a reason", async () => {
  const owner = await f.person();
  const admin = await f.operator("admin"),
    stale = await f.operator("admin", false),
    finance = await f.operator("finance");
  const path = `/admin/governance/workspaces/${owner.tenantId}/suspend`;
  const body = { reason: "Synthetic fraud review fixture" };
  let r = await f.call(path, { body, cookie: finance.cookie });
  assert.equal(r.statusCode, 403, r.body);
  assert.equal(r.json().code, "OPERATOR_SCOPE");
  r = await f.call(path, { body, cookie: stale.cookie });
  assert.equal(r.statusCode, 403, r.body);
  assert.equal(r.json().code, "MFA_STEP_UP");
  r = await f.call(path, { body: { reason: "short" }, cookie: admin.cookie });
  assert.equal(r.statusCode, 400, r.body);
  r = await f.call(path, { body, cookie: owner.cookie });
  assert.equal(r.statusCode, 403, r.body);
  // Platform administration workspaces are never suspended.
  r = await f.call(`/admin/governance/workspaces/${admin.tenantId}/suspend`, {
    body,
    cookie: admin.cookie,
  });
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "PLATFORM_WORKSPACE");
});

test("a suspended workspace is offline, its team sees a clear status and payouts are held", async () => {
  const owner = await f.person({ name: "Synthetic Owner" });
  const staff = await f.person({ tenantId: owner.tenantId, role: "staff" });
  const follower = await f.person({
    tenantId: owner.tenantId,
    role: "subscriber",
  });
  const admin = await f.operator("admin");
  const slug = await slugOf(owner.tenantId);
  const ready = await readyPayout(owner.tenantId, "2026-07");
  assert.equal((await f.call(`/public/trainers/${slug}`)).statusCode, 200);
  const siteBefore = (await f.call(`/public/sites/${slug}`)).statusCode;
  assert.notEqual(siteBefore, 404);

  const suspended = await f.call(
    `/admin/governance/workspaces/${owner.tenantId}/suspend`,
    {
      body: {
        reason: "Synthetic chargeback investigation fixture",
        notice: "Please contact support about your recent payments.",
      },
      cookie: admin.cookie,
    },
  );
  assert.equal(suspended.statusCode, 200, suspended.body);
  const result = suspended.json();
  assert.deepEqual(result.heldPayouts, [ready]);
  assert.equal(await payoutStatus(owner.tenantId, ready), "held");

  // Members and staff keep a session but get a clear, specific refusal.
  for (const p of [owner, staff, follower]) {
    const r = await f.call("/bootstrap", { cookie: p.cookie });
    assert.equal(r.statusCode, 423, r.body);
    assert.equal(r.json().code, "WORKSPACE_SUSPENDED");
    assert.match(r.json().message, /suspended/);
  }
  const blockedWrite = await f.call("/support", {
    body: { subject: "Fixture", message: "Fixture message", category: "other" },
    cookie: follower.cookie,
  });
  assert.equal(blockedWrite.statusCode, 423, blockedWrite.body);
  const ownerStatus = await f.call("/workspace/status", {
    cookie: owner.cookie,
  });
  assert.equal(ownerStatus.statusCode, 200, ownerStatus.body);
  assert.equal(ownerStatus.json().state, "suspended");
  assert.equal(
    ownerStatus.json().notice,
    "Please contact support about your recent payments.",
  );
  const followerStatus = (
    await f.call("/workspace/status", { cookie: follower.cookie })
  ).json();
  assert.equal(followerStatus.state, "suspended");
  assert.equal(followerStatus.notice, null, "operator notice is team-only");
  // The owner's in-app notification is readable while suspended.
  const inbox = await f.call("/notifications", { cookie: owner.cookie });
  assert.equal(inbox.statusCode, 200, inbox.body);
  const notice = inbox
    .json()
    .find((n: any) => n.title === "Your coaching workspace is suspended");
  assert.ok(notice, "owner notified in-app");
  assert.equal(notice.category, "account");
  assert.equal(
    (
      await f.call(`/notifications/${notice.id}/read`, {
        body: {},
        cookie: owner.cookie,
      })
    ).statusCode,
    200,
  );
  // Account-level routes keep working.
  assert.equal(
    (await f.call("/auth/workspaces", { cookie: owner.cookie })).statusCode,
    200,
  );

  // Public site, storefront and public join are offline.
  assert.equal((await f.call(`/public/trainers/${slug}`)).statusCode, 404);
  assert.equal((await f.call(`/public/sites/${slug}`)).statusCode, 404);
  const join = await f.call("/auth/enroll", {
    body: {
      name: "Synthetic Joiner",
      email: `joiner-${randomUUID()}@example.test`,
      password,
      coachSlug: slug,
      accepted: true,
    },
  });
  assert.equal(join.statusCode, 404, join.body);

  // Payouts cannot be prepared or sent while suspended.
  await assert.rejects(
    f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
      createPayout(tx, f.scoped(owner.tenantId, "finance"), "2026-08", "fixture-destination"),
    ),
    (e: any) => e.code === "PAYOUT_HELD",
  );

  // Billing is not cancelled; finance gets a follow-up item and audit exists.
  const followup = await f.db.tenant(
    f.scoped(owner.tenantId, "finance"),
    (tx) =>
      tx.query(
        "SELECT status,data FROM records WHERE id=$1 AND kind='reconciliation'",
        [result.financeFollowupId],
      ),
  );
  assert.equal(followup[0]?.status, "open");
  assert.match(followup[0].data.description, /Billing continues/);
  assert.deepEqual(followup[0].data.heldPayoutIds, [ready]);
  const audit = await f.db.system((tx) =>
    tx.query(
      "SELECT action,data FROM admin_operations_audit WHERE tenant_id=$1 AND action='workspace.suspended'",
      [owner.tenantId],
    ),
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].data.reason, "Synthetic chargeback investigation fixture");

  // Operators see the state and history.
  const list = await f.call(
    "/admin/governance/workspaces?state=suspended",
    { cookie: admin.cookie },
  );
  assert.equal(list.statusCode, 200, list.body);
  const row = list.json().workspaces.find((w: any) => w.id === owner.tenantId);
  assert.equal(row.lifecycle_state, "suspended");
  assert.equal(row.suspension.heldPayouts, 1);

  // Reinstatement reverses the suspension.
  const conflict = await f.call(
    `/admin/governance/workspaces/${owner.tenantId}/reinstate`,
    {
      body: {
        suspensionId: result.suspension.id,
        revision: 7,
        reason: "Synthetic review completed",
      },
      cookie: admin.cookie,
    },
  );
  assert.equal(conflict.statusCode, 409, conflict.body);
  const reinstated = await f.call(
    `/admin/governance/workspaces/${owner.tenantId}/reinstate`,
    {
      body: {
        suspensionId: result.suspension.id,
        revision: result.suspension.revision,
        reason: "Synthetic review completed",
      },
      cookie: admin.cookie,
    },
  );
  assert.equal(reinstated.statusCode, 200, reinstated.body);
  assert.deepEqual(reinstated.json().releasedPayouts, [ready]);
  assert.equal(await payoutStatus(owner.tenantId, ready), "ready");
  assert.equal(
    (await f.call("/bootstrap", { cookie: follower.cookie })).statusCode,
    200,
  );
  assert.equal((await f.call(`/public/trainers/${slug}`)).statusCode, 200);
  assert.equal((await f.call(`/public/sites/${slug}`)).statusCode, siteBefore);
  const history = await f.call(
    `/admin/governance/workspaces/${owner.tenantId}/history`,
    { cookie: admin.cookie },
  );
  assert.equal(history.json().history[0].status, "lifted");
  const reinstatedInbox = (
    await f.call("/notifications", { cookie: owner.cookie })
  ).json();
  assert.ok(
    reinstatedInbox.some(
      (n: any) => n.title === "Your coaching workspace is active again",
    ),
  );
});

test("sign-in prefers an active workspace and still lands on a suspended one with a clear status", async () => {
  const admin = await f.operator("admin");
  const suspendedOwner = await f.person();
  const active = await f.workspace("Active studio");
  await f.db.system((tx) =>
    tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [active, suspendedOwner.userId],
    ),
  );
  const onlySuspended = await f.person({
    tenantId: suspendedOwner.tenantId,
    role: "subscriber",
  });
  const r = await f.call(
    `/admin/governance/workspaces/${suspendedOwner.tenantId}/suspend`,
    { body: { reason: "Synthetic policy review fixture" }, cookie: admin.cookie },
  );
  assert.equal(r.statusCode, 200, r.body);
  const preferred = await f.call("/auth/login", {
    body: { email: suspendedOwner.email, password },
  });
  assert.equal(preferred.statusCode, 200, preferred.body);
  const boot = await f.call("/bootstrap", { cookie: f.cookieOf(preferred) });
  assert.equal(boot.statusCode, 200, boot.body);
  assert.equal(boot.json().user.tenantId, active);
  const workspaces = (
    await f.call("/auth/workspaces", { cookie: f.cookieOf(preferred) })
  ).json().workspaces;
  assert.equal(
    workspaces.find((w: any) => w.tenantId === suspendedOwner.tenantId)?.state,
    "suspended",
  );
  const fallback = await f.call("/auth/login", {
    body: { email: onlySuspended.email, password },
  });
  assert.equal(fallback.statusCode, 200, fallback.body);
  const status = await f.call("/workspace/status", {
    cookie: f.cookieOf(fallback),
  });
  assert.equal(status.json().state, "suspended");
  assert.equal(
    (await f.call("/bootstrap", { cookie: f.cookieOf(fallback) })).statusCode,
    423,
  );
});

test("the worker skips automated work for a suspended workspace and sends only critical email", async () => {
  const admin = await f.operator("admin");
  const owner = await f.person();
  const insertJob = (kind: string, category: string | null) =>
    f.db.tenant(f.scoped(owner.tenantId), async (tx) => {
      const id = randomUUID();
      await tx.query(
        "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          owner.tenantId,
          kind,
          "fixture:" + id,
          JSON.stringify({ category, to: "fixture@example.test", text: "Fixture" }),
        ],
      );
      return id;
    });
  const reminder = await insertJob("email", "workout");
  const nutrition = await insertJob("nutrition_week", null);
  const r = await f.call(
    `/admin/governance/workspaces/${owner.tenantId}/suspend`,
    { body: { reason: "Synthetic worker review fixture" }, cookie: admin.cookie },
  );
  assert.equal(r.statusCode, 200, r.body);
  const called: string[] = [];
  const step = (name: string) => async () => {
    called.push(name);
  };
  const schedulers = {
    nutrition: step("nutrition"),
    finance: step("finance"),
    notifications: step("notifications"),
    lifecycleMessages: step("lifecycleMessages"),
    retentionAlerts: step("retentionAlerts"),
    coachingFollowups: step("coachingFollowups"),
  };
  const handled: Array<{ kind: string; category: string }> = [];
  const complete = async (_db: any, tenantId: string, job: any) => {
    handled.push({ kind: job.kind, category: job.data.category });
    await f.db.tenant(f.scoped(tenantId), (tx) =>
      tx.query("UPDATE jobs SET status='completed',leased_until=NULL WHERE id=$1", [
        job.id,
      ]),
    );
  };
  const handlers = {
    finance: complete,
    nutrition: complete,
    push: complete,
    email: complete,
  };
  const tenant = { id: owner.tenantId, lifecycle_state: "suspended" };
  // The suspension notice (critical account email) is the only job sent.
  for (let i = 0; i < 3; i++)
    await runTenantCycle(f.db, tenant, {}, schedulers, handlers);
  assert.deepEqual(called, []);
  assert.deepEqual(handled, [{ kind: "email", category: "account" }]);
  const pending = await f.db.tenant(f.scoped(owner.tenantId), (tx) =>
    tx.query("SELECT id FROM jobs WHERE status='pending' ORDER BY id"),
  );
  assert.deepEqual(
    pending.map((j) => j.id).sort(),
    [reminder, nutrition].sort(),
  );
  // An active workspace runs every scheduler and claims any due job.
  const ran = await runTenantCycle(
    f.db,
    { id: owner.tenantId, lifecycle_state: "active" },
    {},
    schedulers,
    handlers,
  );
  assert.deepEqual(called, [
    "nutrition",
    "finance",
    "notifications",
    "lifecycleMessages",
    "retentionAlerts",
    "coachingFollowups",
  ]);
  assert.ok(ran.some((x) => x.startsWith("job:")));
});
