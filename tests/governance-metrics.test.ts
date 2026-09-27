import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { governanceFixture, type Person } from "./governance-fixtures.ts";
import {
  computeBusinessMetrics,
  metricsCsv,
  metricMonths,
} from "../apps/api/src/business-metrics.ts";

let f: Awaited<ReturnType<typeof governanceFixture>>;
before(async () => {
  f = await governanceFixture();
});
after(async () => {
  await f?.close();
});
const now = new Date("2026-09-15T12:00:00Z");
const operatorActor = (p: Person) => ({ ...p, role: "finance" });

async function post(
  tenantId: string,
  source: string,
  at: string,
  lines: Array<[string, number]>,
  data: Record<string, unknown> = {},
) {
  await f.db.tenant(f.scoped(tenantId, "finance"), async (tx) => {
    const id = randomUUID();
    await tx.query(
      "INSERT INTO journals(id,tenant_id,source_key,description,data,created_at) VALUES($1,$2,$3,'Synthetic fixture entry',$4,$5)",
      [id, tenantId, source, JSON.stringify(data), at],
    );
    for (const [account, amount] of lines)
      await tx.query(
        "INSERT INTO journal_lines(id,tenant_id,journal_id,account,amount_minor) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), tenantId, id, account, amount],
      );
  });
}
const invoice = (tenantId: string, id: string, userId: string, gross: number, fee: number, at: string) =>
  post(
    tenantId,
    "stripe-invoice:" + id,
    at,
    [
      ["stripe_receivable", gross],
      ["trainer_payable", -(gross - fee)],
      ["platform_commission", -fee],
    ],
    { userId, grossMinor: gross, commissionMinor: fee },
  );
const subscriptionEvent = (tenantId: string, userId: string, subject: string, status: string, at: string) =>
  f.db.tenant(f.scoped(tenantId, "finance"), (tx) =>
    tx.query(
      "INSERT INTO events(id,tenant_id,actor_id,name,subject_id,data,created_at) VALUES($1,$2,$3,'subscription.updated',$4,$5,$6)",
      [randomUUID(), tenantId, userId, subject, JSON.stringify({ status }), at],
    ),
  );
const subscription = (tenantId: string, userId: string, status: string, tier: string, price: number, ending = false) =>
  f.db.tenant(f.scoped(tenantId, "finance"), (tx) =>
    tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,price_minor,cancel_at_period_end,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [randomUUID(), tenantId, userId, "sub_" + userId, status, price, ending, JSON.stringify({ tier })],
    ),
  );

test("metrics are correct with zero data and require Super admin or finance with a fresh code", async () => {
  const finance = await f.operator("finance");
  const zero = await computeBusinessMetrics(f.db, operatorActor(finance), {
    months: 3,
    now,
  });
  assert.deepEqual(
    zero.series.map((m) => m.month),
    ["2026-07", "2026-08", "2026-09"],
  );
  assert.deepEqual(zero.snapshot.trainers, {
    total: 0,
    active: 0,
    published: 0,
    suspended: 0,
    closed: 0,
  });
  assert.equal(zero.snapshot.followers, 0);
  assert.equal(zero.snapshot.mrrMinor, 0);
  for (const m of [...zero.series, zero.totals]) {
    assert.equal(m.grossMinor, 0);
    assert.equal(m.commissionMinor, 0);
    assert.equal(m.takeRate, null);
    assert.equal(m.refundRate, null);
    assert.equal(m.churnRate, null);
    assert.equal(m.trialConversionRate, null);
    assert.equal(m.costToRevenue, null);
  }
  const csv = metricsCsv(zero).trim().split("\n");
  assert.equal(csv.length, 5);
  assert.match(csv[0], /^month,grossMinor,/);
  assert.match(csv[4], /^total,0,/);

  const support = await f.operator("support");
  const stale = await f.operator("finance", false);
  assert.equal((await f.call("/admin/metrics", { cookie: support.cookie })).statusCode, 403);
  assert.equal(
    (await f.call("/admin/metrics", { cookie: stale.cookie })).json().code,
    "MFA_STEP_UP",
  );
  const live = await f.call("/admin/metrics?months=6", { cookie: finance.cookie });
  assert.equal(live.statusCode, 200, live.body);
  assert.equal(live.json().series.length, 6);
  assert.equal(live.json().currency, "AED");
  const exported = await f.call("/admin/metrics.csv?months=2", { cookie: finance.cookie });
  assert.equal(exported.statusCode, 200, exported.body);
  assert.match(String(exported.headers["content-type"]), /^text\/csv/);
  assert.match(String(exported.headers["content-disposition"]), /attachment; filename="platform-metrics-\d{4}-\d{2}\.csv"/);
  assert.equal(exported.body.trim().split("\n").length, 4);
  const audit = await f.db.system((tx) =>
    tx.query(
      "SELECT action FROM admin_operations_audit WHERE actor_id=$1 ORDER BY created_at",
      [finance.userId],
    ),
  );
  assert.deepEqual(audit.map((r) => r.action), ["metrics.read", "metrics.exported"]);
});

test("executive metrics are computed from the ledger, subscriptions, events, costs and payouts", async () => {
  const admin = await f.operator("admin");
  const a = await f.person({ name: "Owner A" });
  const b = await f.person({ name: "Owner B" });
  await f.db.system((tx) => tx.query("UPDATE tenants SET published=false WHERE id=$1", [b.tenantId]));
  const c = await f.person({ name: "Owner C" });
  await f.db.system((tx) => tx.query("UPDATE tenants SET lifecycle_state='suspended' WHERE id=$1", [c.tenantId]));
  const m1 = await f.person({ tenantId: a.tenantId, role: "subscriber" });
  const m2 = await f.person({ tenantId: a.tenantId, role: "subscriber" });
  const m3 = await f.person({ tenantId: b.tenantId, role: "subscriber" });
  const m4 = await f.person({ tenantId: b.tenantId, role: "subscriber" });
  await f.person({ tenantId: c.tenantId, role: "subscriber" });
  // An operator who follows a trainer does not make it a platform workspace.
  await f.person({ tenantId: a.tenantId, role: "subscriber", platformRole: "support" });

  await invoice(a.tenantId, "inv0", m1.userId, 10000, 1500, "2026-06-10T10:00:00Z");
  await invoice(a.tenantId, "inv1", m1.userId, 10000, 1500, "2026-07-10T10:00:00Z");
  await invoice(a.tenantId, "inv2", m2.userId, 20000, 3000, "2026-07-12T10:00:00Z");
  await invoice(a.tenantId, "inv3", m1.userId, 10000, 1500, "2026-08-10T10:00:00Z");
  await post(a.tenantId, "booking-charge:b1", "2026-08-15T10:00:00Z", [
    ["stripe_receivable", 5000],
    ["trainer_payable", -4250],
    ["platform_commission", -750],
  ]);
  await post(a.tenantId, "stripe-refund:r1", "2026-08-20T10:00:00Z", [
    ["stripe_receivable", -10000],
    ["trainer_payable", 8500],
    ["platform_commission", 1500],
  ]);
  await post(a.tenantId, "payout:p1", "2026-09-05T10:00:00Z", [
    ["trainer_payable", 8000],
    ["bank_cash", -8000],
  ]);
  await post(a.tenantId, "usage:2026-08", "2026-09-06T10:00:00Z", [
    ["trainer_payable", 300],
    ["platform_cost_recovery", -300],
  ]);
  await invoice(b.tenantId, "inv4", m3.userId, 15000, 2250, "2026-09-02T10:00:00Z");
  // Events: a cancellation in August and two trials, one converted.
  await subscriptionEvent(a.tenantId, m2.userId, "sub_m2", "canceled", "2026-08-25T10:00:00Z");
  await subscriptionEvent(b.tenantId, m3.userId, "sub_m3", "trialing", "2026-08-28T10:00:00Z");
  await subscriptionEvent(b.tenantId, m4.userId, "sub_m4", "trialing", "2026-09-08T10:00:00Z");
  // A trial canceled before any charge is not churn; it is reported apart.
  await subscriptionEvent(b.tenantId, m4.userId, "sub_m4", "canceled", "2026-09-12T10:00:00Z");
  // Provider cost in September: AI, voice and one unpriced request.
  await f.db.tenant(f.scoped(a.tenantId, "finance"), async (tx) => {
    for (const [task, provider, cost, status] of [
      ["coach_reply", "configured-model", 1, "recorded"],
      ["voice.guidance", "elevenlabs", 0.25, "recorded"],
      ["coach_reply", "configured-model", null, "unknown"],
    ] as const)
      await tx.query(
        "INSERT INTO cost_events(id,tenant_id,task,provider,model,cost_usd,status,created_at) VALUES($1,$2,$3,$4,'fixture-model',$5,$6,'2026-09-03T10:00:00Z')",
        [randomUUID(), a.tenantId, task, provider, cost, status],
      );
    await tx.query(
      "INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,status) VALUES($1,$2,'2026-08',5000,'fixture-destination','ready')",
      [randomUUID(), a.tenantId],
    );
  });
  await subscription(a.tenantId, m1.userId, "active", "workout", 10000, true);
  await subscription(a.tenantId, m2.userId, "canceled", "workout_nutrition", 20000);
  await subscription(b.tenantId, m3.userId, "active", "workout_nutrition", 15000);
  await subscription(b.tenantId, m4.userId, "trialing", "workout", 0);

  const r = await computeBusinessMetrics(f.db, operatorActor(admin), { months: 3, now });
  assert.deepEqual(r.snapshot.trainers, {
    total: 3,
    active: 2,
    published: 1,
    suspended: 1,
    closed: 0,
  });
  assert.equal(r.snapshot.followers, 6);
  assert.equal(r.snapshot.mrrMinor, 25000);
  assert.deepEqual(
    {
      active: r.snapshot.memberships.active,
      trialing: r.snapshot.memberships.trialing,
      pastDue: r.snapshot.memberships.pastDue,
      pending: r.snapshot.memberships.pendingCancellations,
    },
    { active: 2, trialing: 1, pastDue: 0, pending: 1 },
  );
  assert.deepEqual(r.snapshot.memberships.byTier.workout, {
    active: 1,
    trialing: 1,
    pastDue: 0,
    mrrMinor: 10000,
  });
  assert.deepEqual(r.snapshot.memberships.byTier.workout_nutrition, {
    active: 1,
    trialing: 0,
    pastDue: 0,
    mrrMinor: 15000,
  });
  assert.deepEqual(r.snapshot.payouts.ready, { count: 1, amountMinor: 5000 });

  const [jul, aug, sep] = r.series;
  assert.deepEqual(
    [jul.grossMinor, jul.commissionMinor, jul.takeRate, jul.payingMembers, jul.newPayingMembers, jul.churnRate],
    [30000, 4500, 0.15, 2, 1, 0],
  );
  assert.deepEqual(
    [aug.subscriptionGrossMinor, aug.bookingGrossMinor, aug.grossMinor, aug.refundsMinor, aug.refundRate, aug.commissionMinor, aug.takeRate],
    [10000, 5000, 15000, 10000, 0.6667, 750, 0.05],
  );
  assert.deepEqual(
    [aug.cancellations, aug.churnRate, aug.trialsStarted, aug.trialsConverted, aug.trialConversionRate],
    [1, 0.5, 1, 1, 1],
  );
  assert.deepEqual(
    [sep.grossMinor, sep.commissionMinor, sep.costRecoveryMinor, sep.platformRevenueMinor, sep.payoutsPaidMinor, sep.newPayingMembers],
    [15000, 2250, 300, 2550, 8000, 1],
  );
  assert.deepEqual(
    [sep.aiCostUsd, sep.voiceCostUsd, sep.unpricedRequests, sep.providerCostAedMinor, sep.costToRevenue],
    [1, 0.25, 1, 459, 0.18],
  );
  assert.deepEqual([sep.trialsStarted, sep.trialsConverted, sep.trialConversionRate], [1, 0, 0]);
  assert.deepEqual(
    [sep.cancellations, sep.unpaidCancellations, sep.churnRate],
    [0, 1, 0],
  );
  assert.equal(aug.unpaidCancellations, 0);
  const t = r.totals;
  assert.deepEqual(
    [t.grossMinor, t.refundsMinor, t.refundRate, t.commissionMinor, t.takeRate, t.platformRevenueMinor],
    [60000, 10000, 0.1667, 7500, 0.125, 7800],
  );
  assert.deepEqual(
    [t.payingMembers, t.newPayingMembers, t.cancellations, t.churnRate, t.trialsStarted, t.trialsConverted],
    [null, 2, 1, 0.25, 2, 1],
  );
  assert.equal(t.unpaidCancellations, 1);
  assert.deepEqual([t.providerCostAedMinor, t.costToRevenue, t.payoutsPaidMinor], [459, 0.0588, 8000]);
  const csv = metricsCsv(r).trim().split("\n");
  assert.equal(csv[2].split(",")[0], "2026-08");
  assert.equal(csv[2].split(",")[1], "15000");
  // Non-additive paying members are blank in the total row.
  const header = csv[0].split(",");
  assert.equal(csv[4].split(",")[header.indexOf("payingMembers")], "");
  assert.equal(csv[4].split(",")[header.indexOf("unpaidCancellations")], "1");
});

test("months follow the Asia/Dubai calendar", () => {
  // 21:30 UTC on 31 August is already 1 September in Dubai.
  assert.deepEqual(metricMonths(2, new Date("2026-08-31T21:30:00Z")), [
    "2026-08",
    "2026-09",
  ]);
  assert.deepEqual(metricMonths(1, new Date("2026-01-15T00:00:00Z")), ["2026-01"]);
  assert.deepEqual(metricMonths(3, new Date("2026-02-01T00:00:00Z")), [
    "2025-12",
    "2026-01",
    "2026-02",
  ]);
});
