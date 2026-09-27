import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { governanceFixture, password } from "./governance-fixtures.ts";
import { createPayout } from "../apps/api/src/finance.ts";
import { runTenantCycle } from "../apps/worker/src/tenant-cycle.ts";

let f: Awaited<ReturnType<typeof governanceFixture>>;
// A fake Stripe client for renewal changes; no provider is contacted.
const renewals: Array<{ id: string; cancel: boolean; key: string }> = [];
const fakeStripe = {
  subscriptions: {
    update: async (id: string, body: any, options: any) => {
      renewals.push({
        id,
        cancel: body.cancel_at_period_end,
        key: options.idempotencyKey,
      });
      return { id, ...body };
    },
    retrieve: async (id: string) => ({ id, cancel_at_period_end: true }),
  },
} as any;
before(async () => {
  f = await governanceFixture({ providers: { stripe: () => fakeStripe } });
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
  // The undelivered suspension notice email is closed, not sent late; the
  // suspension notice never queued a device notification.
  const noticeJobs = await f.db.tenant(f.scoped(owner.tenantId), (tx) =>
    tx.query(
      "SELECT j.kind,j.status,j.last_error FROM jobs j JOIN notifications n ON n.id::text=j.data->>'notificationId' WHERE n.dedupe_key=$1",
      ["workspace-suspension:" + result.suspension.id],
    ),
  );
  assert.deepEqual(noticeJobs, [
    {
      kind: "email",
      status: "completed",
      last_error: "Superseded by workspace reinstatement",
    },
  ]);
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

test("an operator who follows or staffs a trainer does not make it a platform workspace", async () => {
  const owner = await f.person({ name: "Synthetic Trainer" });
  const operatorFollower = await f.person({
    tenantId: owner.tenantId,
    role: "subscriber",
    platformRole: "support",
  });
  await f.person({
    tenantId: owner.tenantId,
    role: "staff",
    platformRole: "finance",
  });
  const admin = await f.operator("admin");
  const list = await f.call("/admin/governance/workspaces?state=active", {
    cookie: admin.cookie,
  });
  const row = list.json().workspaces.find((w: any) => w.id === owner.tenantId);
  assert.equal(row.platform_workspace, false);
  const suspended = await f.call(
    `/admin/governance/workspaces/${owner.tenantId}/suspend`,
    { body: { reason: "Synthetic operator follower fixture" }, cookie: admin.cookie },
  );
  assert.equal(suspended.statusCode, 200, suspended.body);
  // Member routes are refused in the suspended workspace, but the operator's
  // platform routes (scoped by their own parameters) keep working there.
  const boot = await f.call("/bootstrap", { cookie: operatorFollower.cookie });
  assert.equal(boot.statusCode, 423, boot.body);
  const operatorRoute = await f.call("/admin/governance/workspaces", {
    cookie: operatorFollower.cookie,
  });
  assert.equal(operatorRoute.statusCode, 200, operatorRoute.body);
  // Operator routes still need the operator's own role.
  const forbidden = await f.call("/admin/metrics", {
    cookie: operatorFollower.cookie,
  });
  assert.equal(forbidden.statusCode, 403, forbidden.body);
  // A non-operator member of the workspace gets the suspension, not the route.
  const member = await f.person({ tenantId: owner.tenantId, role: "subscriber" });
  const refused = await f.call("/admin/governance/workspaces", {
    cookie: member.cookie,
  });
  assert.equal(refused.statusCode, 423, refused.body);
});

test("a follower of a suspended workspace can stop renewal, ask for a refund and request erasure", async () => {
  const owner = await f.person();
  const follower = await f.person({
    tenantId: owner.tenantId,
    role: "subscriber",
  });
  const admin = await f.operator("admin");
  const providerId = "sub_fixture_" + follower.userId.slice(0, 8),
    chargeId = "ch_fixture_" + follower.userId.slice(0, 8);
  await f.db.tenant(f.scoped(owner.tenantId, "finance"), async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,price_minor,cancel_at_period_end,data) VALUES($1,$2,$3,$4,'active',now()+interval '20 days',25000,false,'{}')",
      [randomUUID(), owner.tenantId, follower.userId, providerId],
    );
    const journal = randomUUID();
    await tx.query(
      "INSERT INTO journals(id,tenant_id,source_key,description,data) VALUES($1,$2,$3,'Synthetic fixture invoice',$4)",
      [
        journal,
        owner.tenantId,
        "stripe-invoice:in_fixture_" + follower.userId.slice(0, 8),
        JSON.stringify({
          userId: follower.userId,
          chargeId,
          grossMinor: 25000,
          commissionMinor: 3750,
          chargedAt: new Date().toISOString(),
        }),
      ],
    );
    for (const [account, amount] of [
      ["stripe_receivable", 25000],
      ["trainer_payable", -21250],
      ["platform_commission", -3750],
    ] as const)
      await tx.query(
        "INSERT INTO journal_lines(id,tenant_id,journal_id,account,amount_minor) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), owner.tenantId, journal, account, amount],
      );
  });
  const r = await f.call(
    `/admin/governance/workspaces/${owner.tenantId}/suspend`,
    { body: { reason: "Synthetic billing access fixture" }, cookie: admin.cookie },
  );
  assert.equal(r.statusCode, 200, r.body);
  const cookie = follower.cookie;

  const billing = await f.call("/membership/billing", { cookie });
  assert.equal(billing.statusCode, 200, billing.body);
  assert.equal(billing.json().membership.status, "active");
  assert.equal(billing.json().membership.cancel_at_period_end, false);
  assert.equal(billing.json().charges[0].eligible, true);

  const cancel = await f.call("/membership/cancel", { body: {}, cookie });
  assert.equal(cancel.statusCode, 200, cancel.body);
  assert.deepEqual(
    renewals.map((x) => [x.id, x.cancel]),
    [[providerId, true]],
  );
  const after = (await f.call("/membership/billing", { cookie })).json();
  assert.equal(after.membership.cancel_at_period_end, true);
  const reconcile = await f.call("/membership/renewal/reconcile", {
    body: {},
    cookie,
  });
  assert.equal(reconcile.statusCode, 200, reconcile.body);
  // Restarting renewal waits for reinstatement.
  const reactivate = await f.call("/membership/reactivate", { body: {}, cookie });
  assert.equal(reactivate.statusCode, 423, reactivate.body);

  const refund = await f.call("/refund-requests", {
    body: { chargeId, reason: "Synthetic: the coaching service is paused" },
    cookie,
  });
  assert.equal(refund.statusCode, 200, refund.body);
  assert.equal(refund.json().status, "requested");

  const erasure = await f.call("/privacy/delete-request", { body: {}, cookie });
  assert.equal(erasure.statusCode, 200, erasure.body);
  assert.equal(erasure.json().status, "pending_review");

  // Permission can be withdrawn but not newly granted while suspended.
  const withdraw = await f.call("/privacy/consent", {
    body: { type: "coaching", granted: false },
    cookie,
  });
  assert.equal(withdraw.statusCode, 200, withdraw.body);
  const marketing = await f.call("/privacy/consent", {
    body: { type: "marketing", granted: false },
    cookie,
  });
  assert.equal(marketing.statusCode, 200, marketing.body);
  const grant = await f.call("/privacy/consent", {
    body: { type: "coaching", granted: true },
    cookie,
  });
  assert.equal(grant.statusCode, 423, grant.body);
  assert.equal(grant.json().code, "WORKSPACE_SUSPENDED");

  // The trainer's refund decision and other workspace routes stay refused.
  const decision = await f.call(`/refund-requests/${refund.json().id}/decision`, {
    body: { approve: true, reason: "Synthetic approval" },
    cookie: owner.cookie,
  });
  assert.equal(decision.statusCode, 423, decision.body);
  const records = await f.db.tenant(f.scoped(owner.tenantId), (tx) =>
    tx.query(
      "SELECT kind,status FROM records WHERE owner_user_id=$1 AND kind IN ('refund','privacy_request','subscription_transition') ORDER BY kind",
      [follower.userId],
    ),
  );
  assert.deepEqual(records, [
    { kind: "privacy_request", status: "pending_review" },
    { kind: "refund", status: "requested" },
    { kind: "subscription_transition", status: "succeeded" },
  ]);
  const consents = await f.db.tenant(f.scoped(owner.tenantId), (tx) =>
    tx.query(
      "SELECT document_type,granted FROM consent_records WHERE user_id=$1 ORDER BY document_type",
      [follower.userId],
    ),
  );
  assert.deepEqual(consents, [
    { document_type: "coaching", granted: false },
    { document_type: "marketing", granted: false },
  ]);
});

test("the suspension gate decides from the matched route, so encoded paths get the same answer", async () => {
  const owner = await f.person();
  const follower = await f.person({ tenantId: owner.tenantId, role: "subscriber" });
  const admin = await f.operator("admin");
  const r = await f.call(
    `/admin/governance/workspaces/${owner.tenantId}/suspend`,
    { body: { reason: "Synthetic encoded path fixture" }, cookie: admin.cookie },
  );
  assert.equal(r.statusCode, 200, r.body);
  const status = await f.call("/workspace/%73tatus", { cookie: follower.cookie });
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().state, "suspended");
  const boot = await f.call("/%62ootstrap", { cookie: follower.cookie });
  assert.equal(boot.statusCode, 423, boot.body);
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

test("the worker skips automated work for a suspended workspace and sends only critical and transactional email", async () => {
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
  const bookingReminder = await insertJob("email", "booking");
  const refundNotice = await f.db.tenant(f.scoped(owner.tenantId), async (tx) => {
    const id = randomUUID();
    await tx.query(
      "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,'email',$3,$4)",
      [
        id,
        owner.tenantId,
        "fixture:" + id,
        JSON.stringify({
          category: "booking",
          transactional: true,
          to: "fixture@example.test",
          text: "Fixture refund confirmation",
        }),
      ],
    );
    return id;
  });
  const push = await insertJob("push", null);
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
    complimentaryAccess: step("complimentaryAccess"),
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
  // Only the suspension notice (critical account email) and the money
  // confirmation (transactional refund email) are sent.
  for (let i = 0; i < 4; i++)
    await runTenantCycle(f.db, tenant, {}, schedulers, handlers);
  assert.deepEqual(called, []);
  assert.deepEqual(
    handled.map((h) => h.kind + ":" + h.category).sort(),
    ["email:account", "email:booking"],
  );
  const pending = await f.db.tenant(f.scoped(owner.tenantId), (tx) =>
    tx.query("SELECT id FROM jobs WHERE status='pending' ORDER BY id"),
  );
  assert.deepEqual(
    pending.map((j) => j.id).sort(),
    [reminder, nutrition, bookingReminder, push].sort(),
  );
  const [sent] = await f.db.tenant(f.scoped(owner.tenantId), (tx) =>
    tx.query("SELECT status FROM jobs WHERE id=$1", [refundNotice]),
  );
  assert.equal(sent.status, "completed");
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
    "complimentaryAccess",
    "lifecycleMessages",
    "retentionAlerts",
    "coachingFollowups",
  ]);
  assert.ok(ran.some((x) => x.startsWith("job:")));
});
