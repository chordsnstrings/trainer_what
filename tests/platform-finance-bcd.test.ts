// Platform finance phases B-D and the owner's finance decisions of 28
// September 2026 (docs/features/platform-finance.md): the AI Coach Service
// Fee with a 100% markup shown to trainers as one line, Stripe fees shown
// plainly to trainers, and the Super admin's Platform finance screen built
// from the monthly summary. Every account, workspace, amount and provider
// answer here is synthetic.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { governanceFixture, type Person } from "./governance-fixtures.ts";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import { paymentBreakdown } from "../packages/domain/src/index.ts";
import {
  AI_COACH_SERVICE_FEE,
  costProduct,
  financeSettings,
  stripeFeeSettings,
} from "../apps/api/src/cost-accounting.ts";
import { postUsageStatement } from "../apps/api/src/finance-operations.ts";
import {
  csvCell,
  monthsBetween,
  platformPnl,
  rebuildPlatformSummary,
  runPlatformFinanceJobs,
} from "../apps/api/src/platform-pnl.ts";

let f: Awaited<ReturnType<typeof governanceFixture>>;
before(async () => {
  f = await governanceFixture();
});
after(async () => {
  await f?.close();
});

async function costs(
  tenantId: string,
  rows: Array<{ task: string; provider?: string; status: string; cost?: number | null; estimate?: number | null; at: string; complimentary?: boolean }>,
) {
  await f.db.tenant(f.scoped(tenantId, "finance"), async (tx) => {
    for (const r of rows)
      await tx.query(
        "INSERT INTO cost_events(id,tenant_id,task,provider,model,cost_usd,estimated_cost_usd,status,complimentary,product,created_at,pricing) VALUES($1,$2,$3,$4,'fixture-model',$5,$6,$7,$8,$9,$10,'{}')",
        [randomUUID(), tenantId, r.task, r.provider ?? "fixture", r.cost ?? null, r.estimate ?? null, r.status, r.complimentary ?? false, costProduct(r.task), r.at],
      );
  });
}
async function post(
  tenantId: string,
  source: string,
  at: string,
  lines: Array<[string, number]>,
  data: Record<string, unknown> = {},
  currency = "AED",
) {
  await f.db.tenant(f.scoped(tenantId, "finance"), async (tx) => {
    const id = randomUUID();
    await tx.query(
      "INSERT INTO journals(id,tenant_id,source_key,description,data,created_at,currency) VALUES($1,$2,$3,'Synthetic fixture entry',$4,$5,$6)",
      [id, tenantId, source, JSON.stringify(data), at, currency],
    );
    for (const [account, amount] of lines)
      await tx.query(
        "INSERT INTO journal_lines(id,tenant_id,journal_id,account,amount_minor) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), tenantId, id, account, amount],
      );
  });
}
const operatorOf = (p: Person) =>
  ({ tenantId: p.tenantId, userId: p.userId, role: "owner" }) as const;

test("owner decisions: 100% markup by default, trainers see only the AI Coach Service Fee", async () => {
  assert.equal(financeSettings({}).markupPercent, 100);
  assert.equal(financeSettings({ FINANCE_USAGE_MARKUP_PERCENT: "0" }).markupPercent, 0);
  assert.equal(financeSettings({}).complimentaryBearer, "trainer");
  const owner = await f.person({ name: "Owner Service Fee" });
  await costs(owner.tenantId, [
    { task: "coaching", status: "recorded", cost: 1, estimate: 1, at: "2026-05-10T10:00:00Z" },
    { task: "voice.session", provider: "cartesia", status: "estimated", cost: 0.5, estimate: 0.5, at: "2026-05-11T10:00:00Z", complimentary: true },
  ]);
  // 1.5 USD at 4 AED, twice the cost: AED 12.00.
  const statement = await f.db.tenant(operatorOf(owner), (tx) =>
    postUsageStatement(tx, operatorOf(owner), {
      period: "2026-05",
      fxAedPerUsd: 4,
      chargeMinor: 1200,
      feeScheduleVersion: "fixture-v1",
      evidenceReference: "Synthetic usage evidence",
    }),
  );
  assert.equal(Number(statement.charge_minor), 1200);
  const [journal] = await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query("SELECT description,data FROM journals WHERE source_key='usage:2026-05'"),
  );
  assert.equal(journal.description, AI_COACH_SERVICE_FEE);
  assert.equal(journal.data.markupPercent, 100);
  // The owner is told the fee as one line with its amount.
  const [notice] = await f.db.tenant(f.scoped(owner.tenantId, "owner"), (tx) =>
    tx.query("SELECT title,body FROM notifications WHERE user_id=$1 AND dedupe_key='ai-coach-service-fee:2026-05'", [owner.userId]),
  );
  assert.equal(notice.title, "AI Coach Service Fee for May 2026");
  assert.match(notice.body, /^AI Coach Service Fee: AED 12\.00\./);
  assert.doesNotMatch(notice.body, /USD|provider|markup|cost/i);
  // The trainer's statement: one line, no provider cost, calls or features.
  // Posted now, so it is on this month's statement (cash basis), and the
  // notice names that statement.
  const posted = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const postedName = new Date(posted + "-15T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  assert.match(notice.body, new RegExp(`shown on your ${postedName} statement\\.$`));
  const view = await f.call(`/finance/statements/${posted}`, { cookie: owner.cookie });
  assert.equal(view.statusCode, 200, view.body);
  const s = view.json();
  assert.equal(s.aiCoachServiceFeeMinor, 1200);
  // Each fee on the statement is named by the month it is for.
  assert.deepEqual(s.aiCoachServiceFees, [{ period: "2026-05", adjustment: false, amountMinor: 1200 }]);
  for (const hidden of ["usageCost", "usage", "usageByFeature"])
    assert.equal(hidden in s, false, hidden);
  const entry = s.entries.find((e: any) => e.source_key === "usage:2026-05");
  assert.equal(entry.description, AI_COACH_SERVICE_FEE);
  assert.deepEqual(entry.data, { period: "2026-05", amountMinor: 1200 });
  assert.doesNotMatch(view.body, /chargeableUsd|markupPercent|cartesia|fixture-model/);
  // The workspace ledger and usage lists carry the name and amount only.
  const pages = await f.call("/workspace/pages/journals", { cookie: owner.cookie });
  assert.equal(pages.statusCode, 200, pages.body);
  assert.doesNotMatch(pages.body, /chargeableUsd|markupPercent/);
  const usage = await f.call("/workspace/pages/usageStatements", { cookie: owner.cookie });
  assert.deepEqual(Object.keys(usage.json().items[0]).sort(), ["adjustments_minor", "charge_minor", "period"]);
  const calls = await f.call("/workspace/pages/costs", { cookie: owner.cookie });
  assert.doesNotMatch(calls.body, /cost_usd|cartesia|fixture-model/);
  // The trainer's CSV names each line; the usage charge by its name.
  const csv = await f.call("/finance/export", { cookie: owner.cookie });
  assert.match(csv.body, /"usage:2026-05","AI Coach Service Fee"/);
  // One line for the fee: its effect on the trainer's balance, not the
  // platform's side of it.
  assert.equal(csv.body.split("\n").filter((l: string) => l.includes('"usage:2026-05"')).length, 1);
  assert.doesNotMatch(csv.body, /platform_cost_recovery/);
  // The fee for May is deducted from May's payout: named by its month.
  const deductions = await f.call("/finance/deductions", { cookie: owner.cookie });
  assert.deepEqual(deductions.json().aiCoachServiceFees, [{ period: "2026-05", feeMinor: 1200, adjustmentsMinor: 0 }]);
  // Operators still see the provider cost and the markup.
  const admin = await f.operator("finance");
  const operatorView = await f.call(`/admin/tenants/${owner.tenantId}/finance/statements/2026-05`, { cookie: admin.cookie });
  assert.equal(operatorView.json().usageCost.costUsd, 1.5);
});

test("Stripe fees are shown to trainers before they set a price and with each month", async () => {
  // AED 199 a month: 2.9% + AED 1 = AED 6.77; 25% commission AED 49.75.
  const b = paymentBreakdown(19900, { percentBps: 290, fixedMinor: 100, internationalBps: 100 }, 2500);
  assert.deepEqual(
    [b.stripeFeeMinor, b.internationalFeeMinor, b.commissionMinor, b.youReceiveMinor],
    [677, 876, 4975, 14248],
  );
  assert.deepEqual(stripeFeeSettings({}), { percentBps: 290, fixedMinor: 100, internationalBps: 100 });
  assert.deepEqual(
    stripeFeeSettings({ FINANCE_STRIPE_FEE_PERCENT: "3.25", FINANCE_STRIPE_FEE_FIXED_AED: "1.5", FINANCE_STRIPE_INTERNATIONAL_PERCENT: "" }),
    { percentBps: 325, fixedMinor: 150, internationalBps: 100 },
  );
  const owner = await f.person({ name: "Owner Fees" });
  const fees = await f.call("/finance/fees", { cookie: owner.cookie });
  assert.equal(fees.statusCode, 200, fees.body);
  assert.deepEqual(fees.json().commissionBps, [2500, 2000, 1500, 1000]);
  assert.equal(fees.json().stripe.percentBps, 290);
  assert.equal(fees.json().bookingFeeBps, 0);
  // Staff set paid session prices: they see Stripe's fee and the booking
  // fee, not the commission bands.
  const staff = await f.person({ tenantId: owner.tenantId, role: "staff" });
  const staffFees = await f.call("/finance/fees", { cookie: staff.cookie });
  assert.equal(staffFees.statusCode, 200, staffFees.body);
  assert.deepEqual([staffFees.json().commissionBps, staffFees.json().bookingFeeBps, staffFees.json().stripe.percentBps], [null, 0, 290]);
  const member = await f.person({ tenantId: owner.tenantId, role: "subscriber" });
  assert.equal((await f.call("/finance/fees", { cookie: member.cookie })).statusCode, 403);
  // Stripe fees deducted at settlement are named per month and on the statement.
  const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  await post(owner.tenantId, "stripe-settlement:po_fixture", new Date().toISOString(), [
    ["bank_cash", 9323],
    ["trainer_payable", 677],
    ["stripe_receivable", -10000],
  ], { feeMinor: 677 });
  const deductions = await f.call("/finance/deductions", { cookie: owner.cookie });
  assert.deepEqual(
    deductions.json().months.find((m: any) => m.month === month),
    { month, stripeFeesMinor: 677, aiCoachServiceFeeMinor: 0, otherChargesMinor: 0 },
  );
  assert.deepEqual(deductions.json().aiCoachServiceFees, []);
  const statement = await f.call(`/finance/statements/${month}`, { cookie: owner.cookie });
  assert.equal(statement.json().stripeFeesMinor, 677);
});

test("the Platform finance screen: profit and loss, trainers, features, providers, domains, flags and exports", async () => {
  const one = await f.person({ name: "Owner Pnl One" });
  const two = await f.person({ name: "Owner Pnl Two" });
  const at = "2024-11-10T10:00:00Z";
  await post(one.tenantId, "stripe-invoice:pnl1", at, [["stripe_receivable", 20000], ["trainer_payable", -15000], ["platform_commission", -5000]], { grossMinor: 20000, commissionMinor: 5000, userId: randomUUID() });
  await post(one.tenantId, "stripe-programme:pnl2", at, [["stripe_receivable", 40000], ["trainer_payable", -30000], ["platform_commission", -10000]], { grossMinor: 40000, commissionMinor: 10000, userId: randomUUID() });
  await post(one.tenantId, "stripe-refund:pnl3", at, [["stripe_receivable", -20000], ["trainer_payable", 15000], ["platform_commission", 5000]], { refundAmountMinor: 20000, commissionReversalMinor: 5000 });
  await post(one.tenantId, "usage:2024-10", at, [["trainer_payable", 800], ["platform_cost_recovery", -800]]);
  await post(one.tenantId, "stripe-settlement:pnl4", at, [["bank_cash", 38000], ["trainer_payable", 2000], ["stripe_receivable", -40000]], { feeMinor: 2000 });
  const orderId = randomUUID();
  await post(one.tenantId, "web-address-invoice:pnl5", at, [["web_address_receivable", 1999], ["web_address_revenue", -1999]], { orderId, hostname: "pnl-one.example", grossMinor: 1999 }, "USD");
  await post(one.tenantId, "web-address-registrar:pnl6", at, [["registrar_cost", 1148], ["registrar_prepaid", -1148]], { orderId, hostname: "pnl-one.example" }, "USD");
  await costs(one.tenantId, [
    { task: "coaching", provider: "openai", status: "recorded", cost: 2, estimate: 2, at },
    { task: "voice.session", provider: "cartesia", status: "estimated", cost: 1, estimate: 1, at },
    { task: "brain_plan", provider: "openai", status: "unknown", estimate: 0.5, at },
  ]);
  // Workspace two only costs money this month: flagged, no budget limit.
  await costs(two.tenantId, [{ task: "coaching", provider: "openai", status: "recorded", cost: 3, estimate: 3, at }]);
  const rebuilt = await rebuildPlatformSummary(f.db, ["2024-11"]);
  assert.ok(rebuilt.rows >= 2);
  const fin = await f.operator("finance");
  const r = await f.call("/admin/platform-finance?from=2024-11&to=2024-11", { cookie: fin.cookie });
  assert.equal(r.statusCode, 200, r.body);
  const d = r.json();
  assert.deepEqual(d.summary.missingMonths, []);
  const m = d.months[0];
  const line = (side: string, key: string) => m[side].find((l: any) => l.key === key).aedMinor;
  // Default rate 3.6725 (no reviewed rate for November 2024).
  assert.equal(m.rate.source, "default");
  assert.equal(line("income", "subscriptions"), 5000);
  assert.equal(line("income", "programmes"), 10000);
  assert.equal(line("income", "aiCoachServiceFee"), 800);
  assert.equal(line("income", "stripeFeesRecovered"), 2000);
  assert.equal(line("income", "domains"), Math.round(1999 * 3.6725));
  assert.equal(line("costs", "aiProvider"), Math.round(5 * 3.6725 * 100));
  assert.equal(line("costs", "voiceProvider"), Math.round(1 * 3.6725 * 100));
  // No payment's fee was read from Stripe: each is estimated at the fee
  // settings (2.9% + AED 1.00; about 27 US cents on a dollar payment), never
  // replaced by the fees recorded at settlement (those are income here).
  const stripeLine = m.costs.find((l: any) => l.key === "stripeFees");
  assert.equal(stripeLine.aedMinor, 680 + 1260 + Math.round((58 + 27) * 3.6725));
  assert.equal(stripeLine.estimatedMinor, stripeLine.aedMinor);
  assert.ok(m.notes.some((n: string) => n.includes("read from Stripe for 0 of 3")), m.notes.join(" | "));
  assert.equal(line("costs", "registrar"), Math.round(1148 * 3.6725));
  assert.equal(line("costs", "refundsDisputes"), 5000);
  assert.equal(m.profitMinor, m.incomeMinor - m.costsMinor);
  assert.equal(m.unpricedCalls, 1);
  const trainerTwo = d.trainers.find((t: any) => t.tenantId === two.tenantId);
  assert.equal(trainerTwo.contributionMinor, -Math.round(3 * 3.6725 * 100));
  assert.ok(trainerTwo.flags.includes("cost_without_income"));
  assert.ok(trainerTwo.flags.includes("negative_contribution"));
  const trainerOne = d.trainers.find((t: any) => t.tenantId === one.tenantId);
  assert.equal(trainerOne.aiCoachServiceFeeMinor, 800);
  assert.equal(trainerOne.payingMemberMonths, 2);
  assert.ok(d.flags.some((x: any) => x.kind === "usage_not_charged" && x.tenantId === two.tenantId));
  assert.ok(d.features.some((x: any) => x.task === "voice.session" && x.usd === 1));
  assert.ok(d.providers.some((x: any) => x.provider === "openai" && x.usd === 5 && x.unpriced === 1));
  const order = d.domains.orders.find((o: any) => o.orderId === orderId);
  assert.deepEqual([order.currency, order.paidMinor, order.registrarCostMinor, order.profitMinor], ["USD", 1999, 1148, 851]);
  // Access: platform finance roles with fresh MFA; audited; trainers never.
  const support = await f.operator("support");
  assert.equal((await f.call("/admin/platform-finance", { cookie: support.cookie })).statusCode, 403);
  const stale = await f.operator("finance", false);
  assert.equal((await f.call("/admin/platform-finance", { cookie: stale.cookie })).json().code, "MFA_STEP_UP");
  assert.equal((await f.call("/admin/platform-finance", { cookie: one.cookie })).statusCode, 403);
  assert.equal((await f.call("/admin/platform-finance/export/ledger.csv?from=2024-11&to=2024-11", { cookie: one.cookie })).statusCode, 403);
  const audit = await f.db.system((tx) =>
    tx.query("SELECT action FROM admin_operations_audit WHERE actor_id=$1", [fin.userId]),
  );
  assert.ok(audit.some((a: any) => a.action === "platform_finance.read"));
  // Exports: each tab, the full ledger and every cost row.
  for (const tab of ["pnl", "trainers", "features", "providers", "domains", "payouts", "flags"]) {
    const csv = await f.call(`/admin/platform-finance/export/${tab}.csv?from=2024-11&to=2024-11`, { cookie: fin.cookie });
    assert.equal(csv.statusCode, 200, tab + " " + csv.body);
    assert.match(String(csv.headers["content-type"]), /text\/csv/);
  }
  const ledger = await f.call("/admin/platform-finance/export/ledger.csv?from=2024-11&to=2024-11", { cookie: fin.cookie });
  assert.match(ledger.body, /stripe-programme:pnl2/);
  assert.match(ledger.body, /web-address-registrar:pnl6/);
  const costCsv = await f.call("/admin/platform-finance/export/costs.csv?from=2024-11&to=2024-11", { cookie: fin.cookie });
  assert.equal(costCsv.body.trim().split("\n").filter((l: string) => l.startsWith("provider_call")).length >= 4, true);
  assert.ok(audit.length >= 1);
  const exported = await f.db.system((tx) =>
    tx.query("SELECT count(*)::int AS n FROM admin_operations_audit WHERE actor_id=$1 AND action='platform_finance.exported'", [fin.userId]),
  );
  assert.equal(exported[0].n, 9);
  // A month whose summary was never built is named, not shown as zero.
  const missing = await platformPnl(f.db, { from: "2024-01", to: "2024-01" });
  assert.deepEqual(missing.summary.missingMonths, ["2024-01"]);
  assert.throws(() => monthsBetween("2020-01", "2024-01"), /at most 36/);
});

test("CSV cells neutralize spreadsheet formulas", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("-12.50"), "-12.50");
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("@evil"), "'@evil");
});

test("the worker builds the summary once an hour", async () => {
  const now = new Date();
  await runPlatformFinanceJobs(f.db, now);
  const runs = async () =>
    (await f.db.system((tx) => tx.query("SELECT count(*)::int AS n FROM platform_finance_runs WHERE kind='summary' AND status='succeeded'")))[0].n;
  const first = await runs();
  await runPlatformFinanceJobs(f.db, now);
  assert.equal(await runs(), first);
  await withRuntimeConfig({}, () => runPlatformFinanceJobs(f.db, new Date(now.getTime() + 2 * 3600000)));
  assert.equal(await runs(), first + 1);
});

// ---- Phase C -------------------------------------------------------------------

test("platform costs: receipts, reversals, recurring months, payout bank fees and registrar top-ups", async () => {
  const fin = await f.operator("finance");
  const intent = randomUUID();
  const body = {
    intent,
    month: "2025-01",
    category: "server",
    description: "Synthetic server bill",
    vendor: "Synthetic host",
    amount: "24.00",
    currency: "USD",
    receiptReference: "INV-SYN-1",
  };
  const first = await f.call("/admin/platform-finance/costs", { cookie: fin.cookie, body });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().amountMinor, 2400);
  // A retried request records nothing twice; other values under the same intent are refused.
  const again = await f.call("/admin/platform-finance/costs", { cookie: fin.cookie, body });
  assert.equal(again.json().id, first.json().id);
  assert.equal((await f.call("/admin/platform-finance/costs", { cookie: fin.cookie, body: { ...body, amount: "25.00" } })).json().code, "INTENT_CONFLICT");
  // Entries are never changed: a reversal corrects them, once.
  const wrong = await f.call("/admin/platform-finance/costs", { cookie: fin.cookie, body: { ...body, intent: randomUUID(), amount: "99.00" } });
  const reversed = await f.call(`/admin/platform-finance/costs/${wrong.json().id}/reverse`, { cookie: fin.cookie, body: { reason: "Entered twice by mistake" } });
  assert.equal(reversed.json().amountMinor, -9900);
  const reversedAgain = await f.call(`/admin/platform-finance/costs/${wrong.json().id}/reverse`, { cookie: fin.cookie, body: { reason: "Entered twice by mistake" } });
  assert.equal(reversedAgain.json().id, reversed.json().id);
  await assert.rejects(
    f.db.system((tx) => tx.query("UPDATE platform_costs SET amount_minor=1 WHERE id=$1", [first.json().id])),
    // The trigger refuses it; under PostgreSQL the service role has no UPDATE grant either.
    /immutable|permission denied/,
  );
  // A registrar top-up is a prepayment: in the registrar's book, not a cost.
  await f.call("/admin/platform-finance/costs", { cookie: fin.cookie, body: { ...body, intent: randomUUID(), category: "registrar_topup", amount: "50.00", description: "Registrar top-up" } });
  // A recurring cost enters each month once.
  const recurring = await f.call("/admin/platform-finance/recurring", {
    cookie: fin.cookie,
    body: { category: "email", description: "Synthetic email plan", amount: "15.00", currency: "USD", receiptReference: "PLAN-SYN", startsMonth: "2024-12" },
  });
  assert.equal(recurring.statusCode, 200, recurring.body);
  const { postRecurringCosts } = await import("../apps/api/src/platform-costs.ts");
  const posted = await postRecurringCosts(f.db, "2025-02");
  assert.ok(posted.posted >= 3);
  assert.equal((await postRecurringCosts(f.db, "2025-02")).posted, 0);
  const ended = await f.call(`/admin/platform-finance/recurring/${recurring.json().id}/end`, { cookie: fin.cookie, body: { revision: 1, endsMonth: "2025-01" } });
  assert.equal(ended.json().ends_month, "2025-01");
  // A payout's bank fee: once per payout sent to the bank.
  const owner = await f.person({ name: "Owner Payout Fee" });
  const payoutId = randomUUID();
  await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query("INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,revision,status,prepared_by) VALUES($1,$2,'2025-01',50000,$3,1,'ready',$4)", [payoutId, owner.tenantId, randomUUID(), fin.userId]),
  );
  const fee = { tenantId: owner.tenantId, payoutId, amount: "5.25", currency: "AED", receiptReference: "BANK-STMT-1" };
  assert.equal((await f.call("/admin/platform-finance/payout-fees", { cookie: fin.cookie, body: fee })).json().code, "PAYOUT_NOT_SENT");
  await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) => tx.query("UPDATE payouts SET status='submitted' WHERE id=$1", [payoutId]));
  const recorded = await f.call("/admin/platform-finance/payout-fees", { cookie: fin.cookie, body: fee });
  assert.equal(recorded.statusCode, 200, recorded.body);
  assert.equal((await f.call("/admin/platform-finance/payout-fees", { cookie: fin.cookie, body: { ...fee, amount: "6.00" } })).json().code, "INTENT_CONFLICT");
  const month = recorded.json().month;
  // The profit and loss counts server, email plan and the payout fee, never the top-up.
  const pnl = await platformPnl(f.db, { from: "2025-01", to: "2025-01" });
  const line = (key: string) => pnl.months[0].costs.find((l: any) => l.key === key)!.aedMinor;
  assert.equal(line("platform"), Math.round(2400 * 3.6725) + Math.round(1500 * 3.6725));
  assert.equal(pnl.domains.registrar.topUpsMinor.USD, 5000);
  const inMonth = await platformPnl(f.db, { from: month, to: month });
  assert.equal(inMonth.months[0].costs.find((l: any) => l.key === "payoutFees")!.aedMinor, 525);
  const costs = await f.call("/admin/platform-finance/costs?from=2024-12&to=2025-02", { cookie: fin.cookie });
  assert.equal(costs.statusCode, 200, costs.body);
  assert.ok(costs.json().entries.some((e: any) => e.source === "recurring" && e.month === "2024-12"));
  // Months entered before the last month was set stay; none after it follow.
  assert.equal((await postRecurringCosts(f.db, "2025-04")).posted, 0);
  const later = await f.call("/admin/platform-finance/costs?from=2025-03&to=2025-04", { cookie: fin.cookie });
  assert.ok(!later.json().entries.some((e: any) => e.source === "recurring" && e.description === "Synthetic email plan"));
  // Trainers never reach these routes.
  assert.equal((await f.call("/admin/platform-finance/costs", { cookie: owner.cookie })).statusCode, 403);
});

test("a provider invoice prices calls, records plan fees and adjusts a month already charged, once", async () => {
  const { parseInvoice } = await import("../apps/api/src/provider-invoices.ts");
  assert.throws(() => parseInvoice("csv", "request_id,amount\nx,abc\n"), /US dollars/);
  assert.throws(() => parseInvoice("csv", "request_id,foo\nx,1\n"), /cost_usd column/);
  assert.throws(() => parseInvoice("json", JSON.stringify({ totalUsd: "3", lines: [{ cost_usd: "1" }] })), /totalUsd/);
  assert.equal(parseInvoice("csv", 'cost_usd,description\n"1.50","A, quoted ""line"""\n').lines[0].description, 'A, quoted "line"');
  const fin = await f.operator("finance");
  const owner = await f.person({ name: "Owner Invoice" });
  const at = "2024-12-10T10:00:00Z";
  await f.db.tenant(f.scoped(owner.tenantId, "finance"), async (tx) => {
    for (const [trace, est] of [["req-inv-1", 1], [null, 0.5], [null, 0.5]] as const)
      await tx.query(
        "INSERT INTO cost_events(id,tenant_id,task,provider,model,cost_usd,estimated_cost_usd,status,product,created_at,pricing,trace_id) VALUES($1,$2,'coaching','acmeai','m',$3,$3,'estimated','membership',$4,'{}',$5)",
        [randomUUID(), owner.tenantId, est, at, trace],
      );
  });
  // Charged at the estimates: 2 USD at 4 AED with the 100% markup.
  await f.db.tenant(operatorOf(owner), (tx) =>
    postUsageStatement(tx, operatorOf(owner), { period: "2024-12", fxAedPerUsd: 4, chargeMinor: 1600, feeScheduleVersion: "fixture-v1", evidenceReference: "Synthetic usage evidence" }),
  );
  const content = "request_id,cost_usd,kind,description\nreq-inv-1,1.20,usage,One call\n,1.40,usage,Other calls\n,10.00,plan,Monthly plan\n";
  const importInvoice = (extra: Record<string, unknown> = {}) =>
    f.call("/admin/platform-finance/invoices", {
      cookie: fin.cookie,
      body: { provider: "acmeai", month: "2024-12", reference: "ACME-2024-12", format: "csv", content, evidenceReference: "Synthetic provider invoice export", ...extra },
    });
  const r = await importInvoice();
  assert.equal(r.statusCode, 200, r.body);
  const result = r.json();
  assert.equal(result.reconciledRequests, 1);
  assert.equal(result.planUsd, "10.00000000");
  // 2.60 USD now at 4 AED and 100% = 2080; charged 1600: +480 as an adjustment.
  assert.deepEqual(result.corrections.posted, [{ tenantId: owner.tenantId, differenceMinor: 480 }]);
  const rows = await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query("SELECT status,cost_usd::text AS cost FROM cost_events WHERE provider='acmeai' ORDER BY cost_usd"),
  );
  assert.deepEqual(rows.map((x: any) => [x.status, Number(x.cost)]), [["reconciled", 0.7], ["reconciled", 0.7], ["reconciled", 1.2]]);
  // The posted statement is unchanged; the adjustment is a new journal.
  const [statement] = await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) => tx.query("SELECT charge_minor FROM usage_statements WHERE period='2024-12'"));
  assert.equal(Number(statement.charge_minor), 1600);
  const [adjustment] = await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query("SELECT source_key,description,data FROM journals WHERE source_key LIKE 'usage-adjustment:2024-12:%'"),
  );
  assert.equal(adjustment.description, "AI Coach Service Fee adjustment");
  assert.equal(adjustment.data.markupPercent, 100);
  // The key trainers can see carries a hash, never the invoice reference
  // (which may name the provider); the reference stays in operator data.
  assert.match(adjustment.source_key, /^usage-adjustment:2024-12:[0-9a-f]{16}$/);
  assert.equal(adjustment.data.reference, "ACME-2024-12");
  // The same import again changes nothing; other content under the reference is refused.
  const repeat = await importInvoice();
  assert.equal(repeat.json().alreadyImported, true);
  assert.equal((await importInvoice({ content: content.replace("10.00", "11.00") })).json().code, "INVOICE_CONFLICT");
  const corrections = await f.call("/admin/platform-finance/usage-corrections", { cookie: fin.cookie, body: { period: "2024-12", reference: "ACME-2024-12" } });
  assert.deepEqual(corrections.json().posted, []);
  // The plan fee is a platform cost of the month.
  const pnl = await platformPnl(f.db, { from: "2024-12", to: "2024-12" });
  assert.ok(pnl.platformCosts.some((c: any) => c.category === "provider_plan" && c.amountMinor === 1000 && c.currency === "USD"));
  assert.ok(pnl.providers.some((p: any) => p.provider === "acmeai" && p.invoicedUsd === 2.6 && p.planUsd === 10), JSON.stringify(pnl.providers));
  // The trainer sees the adjustment only as the AI Coach Service Fee.
  const posted = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const view = await f.call(`/finance/statements/${posted}`, { cookie: owner.cookie });
  assert.equal(view.json().aiCoachServiceFeeMinor, 1600 + 480);
  const entry = view.json().entries.find((e: any) => e.source_key.startsWith("usage-adjustment:"));
  assert.deepEqual([entry.description, entry.data], ["AI Coach Service Fee adjustment", { period: "2024-12", amountMinor: 480 }]);
  assert.deepEqual(view.json().aiCoachServiceFees, [
    { period: "2024-12", adjustment: false, amountMinor: 1600 },
    { period: "2024-12", adjustment: true, amountMinor: 480 },
  ]);
  assert.doesNotMatch(view.body, /acmeai|ACME|chargeableUsd|markupPercent/);
  const usage = await f.call("/workspace/pages/usageStatements", { cookie: owner.cookie });
  const december = usage.json().items.find((i: any) => i.period === "2024-12");
  assert.deepEqual([Number(december.charge_minor), Number(december.adjustments_minor)], [1600, 480]);
  // The adjustment notice names the month it is for and the statement it is on.
  const [notice] = await f.db.tenant(f.scoped(owner.tenantId, "owner"), (tx) =>
    tx.query("SELECT dedupe_key,body FROM notifications WHERE user_id=$1 AND dedupe_key LIKE 'ai-coach-service-fee:2024-12:%'", [owner.userId]),
  );
  assert.doesNotMatch(notice.dedupe_key, /ACME/);
  assert.match(notice.body, /AED 4\.80 more for December 2024\. .* shown on your .* statement\.$/);
  // The workspace's events carry no provider, provider cost or rate: the
  // platform's pricing events are not listed and cost fields are removed.
  const events = await f.call("/workspace/pages/events", { cookie: owner.cookie });
  assert.equal(events.statusCode, 200, events.body);
  assert.doesNotMatch(events.body, /acmeai|costUsd|allocatedUsd|estimatedUsd|AedPerUsd|providerRequestId|req-inv-1/);
  assert.ok(!events.json().items.some((e: any) => ["finance.usage_reconciled", "finance.provider_usage_priced", "finance.usage_corrected_after_charge", "finance.usage_estimated"].includes(e.name)));
  const boot = await f.call("/bootstrap", { cookie: owner.cookie });
  assert.equal(boot.statusCode, 200, boot.body);
  assert.doesNotMatch(JSON.stringify(boot.json().events ?? []), /acmeai|costUsd|allocatedUsd|AedPerUsd/);
  // The invoice import rebuilt the month's summary: its calls are priced
  // at the invoice (2.60 USD) without a manual rebuild.
  const pnl2 = await platformPnl(f.db, { from: "2024-12", to: "2024-12" });
  const trainer = pnl2.trainers.find((t: any) => t.tenantId === owner.tenantId);
  assert.equal(trainer?.providerCostMinor, Math.round(2.6 * pnl2.months[0].rate.aedPerUsd * 100));
  assert.deepEqual(pnl2.summary.missingMonths, []);
  // A CSV with a very wide header, or rows wider than it, is refused.
  assert.throws(() => parseInvoice("csv", "cost_usd," + Array.from({ length: 60 }, (_, i) => "c" + i).join(",") + "\n1\n"), /at most 50 columns/);
  assert.throws(() => parseInvoice("csv", "cost_usd,description\n1,a,b\n"), /more fields than the header/);
  assert.equal(parseInvoice("csv", "cost_usd,description\n1,a,\n").lines.length, 1);
});

test("Stripe's fee per charge, refund and dispute is read once from its balance transaction", async () => {
  const { sweepStripeFees, captureFeesAfterWebhook } = await import("../apps/api/src/stripe-fees.ts");
  const owner = await f.person({ name: "Owner Stripe Fees" });
  const at = new Date().toISOString();
  await post(owner.tenantId, "stripe-invoice:in_fee1", at, [["stripe_receivable", 19900], ["trainer_payable", -14925], ["platform_commission", -4975]], { grossMinor: 19900, commissionMinor: 4975, chargeId: "ch_fee1" });
  await post(owner.tenantId, "stripe-refund:re_fee1", at, [["stripe_receivable", -19900], ["trainer_payable", 14925], ["platform_commission", 4975]], { refundAmountMinor: 19900, commissionReversalMinor: 4975, chargeId: "ch_fee1" });
  await post(owner.tenantId, "web-address-invoice:in_fee2", at, [["web_address_receivable", 1999], ["web_address_revenue", -1999]], { grossMinor: 1999, chargeId: "ch_fee2" }, "USD");
  await post(owner.tenantId, "dispute-reserve:dp_fee1", at, [["trainer_payable", 19900], ["dispute_reserve", -19900]], { chargeId: "ch_fee1" });
  const created = Math.floor(Date.now() / 1000);
  const bt = (id: string, amount: number, fee: number, currency = "aed") => ({ id, object: "balance_transaction", amount, currency, fee, net: amount - fee, created, fee_details: [{ amount: fee, currency, type: "stripe_fee", description: "Stripe processing fees" }] });
  const reads: string[] = [];
  const stripe = {
    charges: {
      retrieve: async (id: string) => {
        reads.push(id);
        return id === "ch_fee1"
          ? { id, balance_transaction: bt("txn_fee1", 19900, 677) }
          : { id, balance_transaction: { ...bt("txn_fee2", 7341, 459), exchange_rate: 3.6725 } };
      },
    },
    refunds: { retrieve: async (id: string) => (reads.push(id), { id, charge: "ch_fee1", balance_transaction: bt("txn_re1", -19900, 0) }) },
    disputes: { retrieve: async (id: string) => (reads.push(id), { id, charge: "ch_fee1", balance_transactions: [bt("txn_dp1", -19900, 5500)] }) },
    paymentIntents: { retrieve: async () => { throw new Error("not used"); } },
  };
  const first = await sweepStripeFees(f.db, stripe, { tenantId: owner.tenantId });
  assert.deepEqual([first.recorded, first.failed], [4, 0]);
  const second = await sweepStripeFees(f.db, stripe, { tenantId: owner.tenantId });
  assert.deepEqual([second.recorded, reads.length], [0, 4]);
  // A webhook for the workspace reads nothing new.
  await captureFeesAfterWebhook(f.db, stripe, { data: { object: { metadata: { tenant_id: owner.tenantId } } } });
  assert.equal(reads.length, 4);
  const rows = await f.db.system((tx) => tx.query("SELECT balance_transaction_id,source_type,product,fee_minor FROM stripe_fees WHERE tenant_id=$1 ORDER BY balance_transaction_id", [owner.tenantId]));
  assert.deepEqual(
    rows.map((r: any) => [r.balance_transaction_id, r.source_type, r.product, Number(r.fee_minor)]),
    [["txn_dp1", "dispute", "membership", 5500], ["txn_fee1", "charge", "membership", 677], ["txn_fee2", "charge", "domain", 459], ["txn_re1", "refund", "membership", 0]],
  );
  // The trainer sees Stripe's fee on their own payments (not the platform's domain fees).
  const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const view = await f.call(`/finance/statements/${month}`, { cookie: owner.cookie });
  assert.equal(view.statusCode, 200, view.body);
  assert.deepEqual(view.json().stripeFeesOnPayments, [{ currency: "AED", count: 3, feeMinor: 6177 }]);
  // The profit and loss uses Stripe's recorded fees for the month.
  await rebuildPlatformSummary(f.db, [month]);
  const pnl = await platformPnl(f.db, { from: month, to: month });
  const stripeLine = pnl.months[0].costs.find((l: any) => l.key === "stripeFees")!.aedMinor;
  assert.ok(stripeLine >= 677 + 459 + 5500, String(stripeLine));
  const trainer = pnl.trainers.find((t: any) => t.tenantId === owner.tenantId);
  assert.equal(trainer?.stripeFeesMinor, 677 + 459 + 5500);
});

// ---- Phase D -------------------------------------------------------------------

test("DigitalOcean billing: only the project's items, a month estimate from its resources, replaced by the invoice, read-only and idempotent", async () => {
  const { DigitalOceanMock } = await import("./e2e/mocks/digitalocean.ts");
  const { DigitalOceanBilling, projectItems } = await import("../packages/providers/src/digitalocean-billing.ts");
  const { importDigitalOceanBilling } = await import("../apps/api/src/digitalocean-costs.ts");
  const token = DigitalOceanMock.token();
  const mock = new DigitalOceanMock({ key: "unused", cert: "unused" }, token);
  mock.seedBilling({ months: ["2026-07", "2026-08"], firstPlatformMonth: "2026-09" });
  const client = new DigitalOceanBilling(token, { transport: mock.fetch });
  const now = new Date("2026-09-28T12:00:00Z");
  const first = await importDigitalOceanBilling(f.db, { client, project: "GymMembership", now });
  // July and August: invoices of the team, none of the platform's items.
  assert.deepEqual(first.invoicesImported.map((i: any) => [i.month, i.items]), [["2026-08", 0], ["2026-07", 0]]);
  // September: the droplet from 27 September 08:00, hourly to the month end,
  // with weekly backups (+20%); the domain is free.
  const hours = (Date.parse("2026-10-01T00:00:00Z") - Date.parse("2026-09-27T08:00:00Z")) / 3600000;
  assert.equal(first.estimate!.projectedUsd, Number((0.03571 * hours * 1.2).toFixed(4)));
  assert.deepEqual(first.estimate!.notEstimated, []);
  // Only GET requests, only the platform project's resources.
  assert.ok(mock.calls.every((c) => c.method === "GET"));
  assert.ok(!mock.calls.some((c) => c.path.includes("500000009")));
  // Once September has ended, the whole month's estimate counts (until the
  // invoice arrives); while it runs, the cost so far, beside income to date.
  const afterMonth = new Date("2026-10-05T00:00:00Z");
  let pnl = await platformPnl(f.db, { from: "2026-09", to: "2026-09", now: afterMonth });
  const estimate = pnl.platformCosts.find((c: any) => c.source === "estimate");
  assert.ok(estimate && estimate.estimated && estimate.amountMinor === Math.round(first.estimate!.projectedUsd * 100));
  assert.equal(pnl.months[0].inProgress, false);
  const platformLine = pnl.months[0].costs.find((l: any) => l.key === "platform")!;
  // The estimate is counted in the estimated part of the costs.
  assert.ok(platformLine.estimatedMinor! >= Math.round(estimate.amountMinor * pnl.months[0].rate.aedPerUsd));
  assert.ok(pnl.months[0].estimatedCostMinor >= platformLine.estimatedMinor!);
  const during = await platformPnl(f.db, { from: "2026-09", to: "2026-09", now });
  const soFar = during.platformCosts.find((c: any) => c.source === "estimate");
  assert.equal(soFar?.amountMinor, Math.round(first.estimate!.toDateUsd * 100));
  assert.equal(during.months[0].inProgress, true);
  assert.ok(during.months[0].notes.some((n: string) => n.includes("in progress")));
  // A repeat reads the invoices again but records nothing twice.
  const again = await importDigitalOceanBilling(f.db, { client, project: "GymMembership", now });
  assert.deepEqual(again.invoicesImported, []);
  // September's invoice arrives: its project items replace the estimate.
  mock.seedBilling({ months: ["2026-07", "2026-08", "2026-09"], firstPlatformMonth: "2026-09" });
  const later = await importDigitalOceanBilling(f.db, { client, project: "GymMembership", now: new Date("2026-10-02T12:00:00Z") });
  assert.deepEqual(later.invoicesImported.map((i: any) => [i.month, i.items, i.usd]), [["2026-09", 2, "3.72"]]);
  pnl = await platformPnl(f.db, { from: "2026-09", to: "2026-09", now: afterMonth });
  const september = pnl.platformCosts.filter((c: any) => c.vendor === "DigitalOcean");
  assert.deepEqual(september.map((c: any) => [c.source, c.amountMinor, c.estimated]).sort(), [["digitalocean", 310, false], ["digitalocean", 62, false]]);
  // Unrelated projects never reach the platform's costs.
  const items = projectItems(mock.billing.items.get("20260900-0000-4000-8000-000000000001")!, "gymmembership");
  assert.equal(items.length, 2);
  const [row] = await f.db.system((tx) => tx.query("SELECT count(*)::int AS n FROM platform_costs WHERE source='digitalocean' AND description LIKE '%shop%'"));
  assert.equal(row.n, 0);
  // Only the project's figures are kept: never the team's total.
  const stored = await f.db.system((tx) => tx.query("SELECT * FROM digitalocean_invoices WHERE month='2026-09'"));
  assert.deepEqual(stored.map((r: any) => [r.project_name, r.project_items, Number(r.project_amount_usd)]), [["GymMembership", 2, 3.72]]);
  assert.ok(stored.every((r: any) => !("team_amount_usd" in r)));
  // The adapter refuses anything but GET, and never echoes the token.
  mock.failNext("GET", /^\/v2\/customers\/my\/invoices$/, 401);
  const failed = await importDigitalOceanBilling(f.db, { client, project: "GymMembership", now }).catch((e: Error) => e);
  assert.ok(failed instanceof Error && !String(failed.message).includes(token));
  // A project name that is not in the team (a typo, a renamed project)
  // fails the run instead of importing every invoice as costing nothing.
  const typo = await importDigitalOceanBilling(f.db, { client, project: "GymMembershp", now }).catch((e: Error) => e);
  assert.ok(typo instanceof Error && /not found/.test(typo.message), String(typo));
  const [run] = await f.db.system((tx) => tx.query("SELECT status,error FROM platform_finance_runs WHERE kind='digitalocean' ORDER BY started_at DESC LIMIT 1"));
  assert.equal(run.status, "failed");
  // Invoices are read once per project: a changed project setting reads the
  // earlier invoices again for the new project.
  const switched = await importDigitalOceanBilling(f.db, { client, project: "Unrelated Shop", now: new Date("2026-10-02T12:00:00Z") });
  assert.deepEqual(switched.invoicesImported.map((i: any) => [i.month, i.items]), [["2026-09", 1], ["2026-08", 1], ["2026-07", 1]]);
  const both = await f.db.system((tx) => tx.query("SELECT project_name FROM digitalocean_invoices WHERE month='2026-09' ORDER BY project_name"));
  assert.deepEqual(both.map((r: any) => r.project_name), ["GymMembership", "Unrelated Shop"]);
});

test("the Super admin DigitalOcean import route, the billing settings and the finance alerts", async () => {
  const { DigitalOceanMock } = await import("./e2e/mocks/digitalocean.ts");
  const { validateIntegrationValues } = await import("../packages/providers/src/configuration.ts");
  const { evaluatePlatformAlerts, platformAlertRules } = await import("../apps/api/src/platform-alerts.ts");
  const { startRun, finishRun } = await import("../apps/api/src/platform-finance-runs.ts");
  assert.doesNotThrow(() => validateIntegrationValues("digitalocean_billing", { DO_BILLING_PROJECT: "GymMembership" }));
  assert.throws(() => validateIntegrationValues("digitalocean_billing", { DO_BILLING_PROJECT: "x".repeat(200) }), /project/i);
  const fin = await f.operator("finance");
  // Without a token the import is refused with a clear status, nothing sent.
  const missing = await f.call("/admin/platform-finance/digitalocean/import", { cookie: fin.cookie, body: {} });
  assert.equal(missing.statusCode, 503, missing.body);
  // Alerts: a failed import, a low registrar balance and cost without income.
  const ids = platformAlertRules().map((r) => r.id);
  for (const id of ["finance.cost_without_income", "finance.usage_unpriced_aging", "finance.digitalocean_import", "finance.registrar_balance_low"])
    assert.ok(ids.includes(id), id);
  const run = await startRun(f.db, "digitalocean", null);
  await finishRun(f.db, run, { error: "DigitalOcean answered HTTP 401: Unable to authenticate you." });
  const reading = await startRun(f.db, "registrar_balance", null);
  await finishRun(f.db, reading, { result: { currency: "USD", available: "3.50", registrar: "namecheap" } });
  const owner = await f.person({ name: "Owner Alert Cost" });
  const busy = await f.person({ name: "Owner Alert Open Month" });
  const owes = await f.person({ name: "Owner Alert Owes" });
  const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const [y, mo] = month.split("-").map(Number);
  const earlier = new Date(Date.UTC(y, mo - 3, 1)).toISOString().slice(0, 7);
  // A finished month with usage, no AI Coach Service Fee and no income.
  await costs(owner.tenantId, [{ task: "coaching", provider: "openai", status: "recorded", cost: 4, estimate: 4, at: earlier + "-10T10:00:00Z" }]);
  // Usage in the month in progress: its fee is not due yet, so no alert.
  await costs(busy.tenantId, [{ task: "coaching", provider: "openai", status: "recorded", cost: 4, estimate: 4, at: new Date().toISOString() }]);
  // A fee the trainer's earnings do not cover (only complimentary members).
  await post(owes.tenantId, `usage:${earlier}`, new Date().toISOString(), [["trainer_payable", 2938], ["platform_cost_recovery", -2938]], { period: earlier, chargeMinor: 2938 });
  await rebuildPlatformSummary(f.db, [earlier, month]);
  const rules = platformAlertRules().filter((r) => ["finance.cost_without_income", "finance.service_fee_owed", "finance.digitalocean_import", "finance.registrar_balance_low"].includes(r.id));
  await evaluatePlatformAlerts(f.db, { rules });
  const alerts = await f.db.system((tx) => tx.query("SELECT rule,severity,dedupe_key,detail FROM platform_alerts WHERE status<>'resolved' AND rule LIKE 'finance.%'"));
  assert.ok(alerts.some((a: any) => a.rule === "finance.digitalocean_import"));
  assert.ok(alerts.some((a: any) => a.rule === "finance.registrar_balance_low" && a.severity === "critical"));
  assert.ok(alerts.some((a: any) => a.rule === "finance.cost_without_income" && a.dedupe_key === `finance.cost_without_income:${owner.tenantId}:${earlier}`));
  assert.ok(!alerts.some((a: any) => a.rule === "finance.cost_without_income" && a.dedupe_key.includes(busy.tenantId)));
  const owed = alerts.find((a: any) => a.rule === "finance.service_fee_owed" && a.dedupe_key.includes(owes.tenantId));
  assert.ok(owed && /AED 29\.38/.test(owed.detail), JSON.stringify(alerts));
  // The Platform finance screen shows the same: nothing received, owed.
  const view = await platformPnl(f.db, { from: month, to: month });
  const debtor = view.trainers.find((t: any) => t.tenantId === owes.tenantId)!;
  assert.deepEqual([debtor.aiCoachServiceFeeMinor, debtor.aiCoachServiceFeeOwedMinor], [0, 2938]);
  assert.ok(debtor.flags.includes("service_fee_owed"));
  assert.ok(!view.flags.some((x: any) => x.kind === "cost_without_income" && x.tenantId === busy.tenantId));
  assert.equal(view.months[0].inProgress, true);
  // Month over month trends for each cost line.
  const pnl = await f.call(`/admin/platform-finance?from=${month}&to=${month}`, { cookie: fin.cookie });
  assert.ok(Array.isArray(pnl.json().trends));
  // The DigitalOcean view shows the project's own figures only.
  const billing = await f.call("/admin/platform-finance/digitalocean", { cookie: fin.cookie });
  assert.equal(billing.statusCode, 200, billing.body);
  assert.doesNotMatch(billing.body, /team/i);
  void DigitalOceanMock;
});

// ---- Review round 1 (stage 2026-09-28w) ---------------------------------------

test("cash basis: the AI Coach Service Fee is income when the trainer's earnings cover it, and owed until then", async () => {
  // A trainer with only complimentary members: no earnings in January or
  // February, the platform paid for their usage and charged the fee.
  const owner = await f.person({ name: "Owner Complimentary Only" });
  const at = (month: string, day = 10) => `${month}-${String(day).padStart(2, "0")}T10:00:00Z`;
  await costs(owner.tenantId, [
    { task: "coaching", provider: "openai", status: "recorded", cost: 10, estimate: 10, at: at("2023-01"), complimentary: true },
    { task: "coaching", provider: "openai", status: "recorded", cost: 5, estimate: 5, at: at("2023-02"), complimentary: true },
  ]);
  // January's fee (USD 10 at 3.6725, 100% markup) posted in February,
  // February's in March; the statements record what each month charged.
  const fee = async (period: string, postedMonth: string, charge: number) => {
    await post(owner.tenantId, `usage:${period}`, at(postedMonth, 3), [["trainer_payable", charge], ["platform_cost_recovery", -charge]], { period, chargeMinor: charge });
    await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
      tx.query(
        "INSERT INTO usage_statements(id,tenant_id,period,total_cost_usd,fx_aed_per_usd,charge_minor,cost_event_count,fee_schedule_version,evidence_reference,journal_id) VALUES($1,$2,$3,1,3.6725,$4,1,'fixture-v1','Synthetic usage evidence',(SELECT id FROM journals WHERE source_key=$5))",
        [randomUUID(), owner.tenantId, period, charge, `usage:${period}`],
      ),
    );
  };
  await fee("2023-01", "2023-02", 7345);
  await fee("2023-02", "2023-03", 3673);
  // In April the trainer's first paid member: earnings of AED 150.00.
  await post(owner.tenantId, "stripe-invoice:in_cash1", at("2023-04"), [["stripe_receivable", 20000], ["trainer_payable", -15000], ["platform_commission", -5000]], { grossMinor: 20000, commissionMinor: 5000, userId: randomUUID() });
  await rebuildPlatformSummary(f.db, monthsBetween("2023-01", "2023-04"));
  const fee4 = (d: any, month: string) => d.months.find((m: any) => m.month === month);
  const received = (m: any) => m.income.find((l: any) => l.key === "aiCoachServiceFee").aedMinor;
  // Only this workspace is active in 2023.
  const q1 = await platformPnl(f.db, { from: "2023-01", to: "2023-03" });
  assert.deepEqual(["2023-01", "2023-02", "2023-03"].map((m) => received(fee4(q1, m))), [0, 0, 0]);
  assert.deepEqual(["2023-01", "2023-02", "2023-03"].map((m) => fee4(q1, m).feeOwedMinor), [0, 7345, 7345 + 3673]);
  assert.ok(fee4(q1, "2023-03").notes.some((n: string) => n.includes("Owed by trainers") && n.includes("AED 110.18")));
  const trainer = q1.trainers.find((t: any) => t.tenantId === owner.tenantId)!;
  assert.deepEqual([trainer.aiCoachServiceFeeMinor, trainer.aiCoachServiceFeeOwedMinor], [0, 7345 + 3673]);
  assert.ok(trainer.flags.includes("service_fee_owed"));
  // The fee charged for a month's usage matches its cost: no "cost without
  // income" for January or February (the fee is owed, flagged above).
  assert.ok(!q1.flags.some((x: any) => x.kind === "cost_without_income" && x.tenantId === owner.tenantId), JSON.stringify(q1.flags));
  // April's earnings cover both fees: received in April, nothing owed.
  const april = await platformPnl(f.db, { from: "2023-04", to: "2023-04" });
  assert.equal(received(april.months[0]), 7345 + 3673);
  assert.equal(april.months[0].feeOwedMinor, 0);
  const paid = april.trainers.find((t: any) => t.tenantId === owner.tenantId)!;
  assert.deepEqual([paid.aiCoachServiceFeeMinor, paid.aiCoachServiceFeeOwedMinor], [7345 + 3673, 0]);
  assert.ok(!paid.flags.includes("service_fee_owed"));
  // A domain payment for no open order is owed back: not domain income.
  const orderId = randomUUID();
  await post(owner.tenantId, "web-address-invoice:in_unmatched", at("2023-04", 12), [["web_address_receivable", 1999], ["web_address_refund_liability", -1999]], { orderId, hostname: "unmatched.example", kind: "unmatched", grossMinor: 1999 }, "USD");
  await post(owner.tenantId, "web-address-refund:re_unmatched", at("2023-04", 13), [["web_address_refund_liability", 1999], ["web_address_receivable", -1999]], { orderId, hostname: "unmatched.example", refundAmountMinor: 1999, ofUnmatchedPayment: true }, "USD");
  await rebuildPlatformSummary(f.db, ["2023-04"]);
  const domains = await platformPnl(f.db, { from: "2023-04", to: "2023-04" });
  assert.equal(domains.months[0].income.find((l: any) => l.key === "domains")!.aedMinor, 0);
  assert.equal(domains.months[0].costs.find((l: any) => l.key === "refundsDisputes")!.aedMinor, 0);
  assert.deepEqual(domains.domains.orders.filter((o: any) => o.orderId === orderId).map((o: any) => [o.paidMinor, o.refundedMinor]), [[0, 0]]);
});

test("Stripe fees: read per payment, estimated until read, and a won dispute read again", async () => {
  const { sweepStripeFees, captureFeesAfterWebhook } = await import("../apps/api/src/stripe-fees.ts");
  const { runStripeFeeSweep } = await import("../apps/api/src/platform-pnl.ts");
  const owner = await f.person({ name: "Owner Fee Coverage" });
  const now = new Date().toISOString();
  // Seconds apart, so the newest (read first) is the second payment.
  const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  await post(owner.tenantId, "stripe-invoice:in_cov1", ago(3), [["stripe_receivable", 10000], ["trainer_payable", -7500], ["platform_commission", -2500]], { grossMinor: 10000, commissionMinor: 2500, chargeId: "ch_cov1" });
  await post(owner.tenantId, "dispute-reserve:dp_cov1", ago(2), [["trainer_payable", 10000], ["dispute_reserve", -10000]], { chargeId: "ch_cov1" });
  await post(owner.tenantId, "stripe-invoice:in_cov2", ago(1), [["stripe_receivable", 20000], ["trainer_payable", -15000], ["platform_commission", -5000]], { grossMinor: 20000, commissionMinor: 5000, chargeId: "ch_cov2" });
  const created = Math.floor(Date.now() / 1000);
  const bt = (id: string, amount: number, fee: number) => ({ id, object: "balance_transaction", amount, currency: "aed", fee, net: amount - fee, created, fee_details: [] });
  let reinstated = false;
  const reads: string[] = [];
  const stripe = {
    // Any other workspace's charge in the window answers too.
    charges: { retrieve: async (id: string) => (reads.push(id), { id, balance_transaction: bt("txn_" + id.replace(/[^A-Za-z0-9]/g, ""), 10000, id === "ch_cov1" ? 390 : id === "ch_cov2" ? 680 : 100) }) },
    refunds: { retrieve: async (id: string) => (reads.push(id), { id, charge: "ch_x", balance_transaction: bt("txn_" + id.replace(/[^A-Za-z0-9]/g, ""), -100, 0) }) },
    disputes: {
      retrieve: async (id: string) => (
        reads.push(id),
        {
          id,
          charge: id === "dp_dom" ? "ch_dom" : "ch_cov1",
          balance_transactions: id === "dp_cov1" && reinstated
            ? [bt("txn_dpcov1", -10000, 5500), bt("txn_dpcov1back", 10000, -5500)]
            : [bt("txn_" + id.replace(/[^A-Za-z0-9]/g, ""), -10000, 5500)],
        }
      ),
    },
    paymentIntents: { retrieve: async () => { throw new Error("not used"); } },
  };
  // One read now: one payment is read, the other is estimated.
  const one = await sweepStripeFees(f.db, stripe, { tenantId: owner.tenantId, limit: 1 });
  assert.equal(one.recorded, 1);
  assert.deepEqual(one.touched, [{ tenantId: owner.tenantId, months: [month] }]);
  await rebuildPlatformSummary(f.db, [month], null, { tenantIds: [owner.tenantId] });
  let pnl = await platformPnl(f.db, { from: month, to: month });
  let trainer = pnl.trainers.find((t: any) => t.tenantId === owner.tenantId)!;
  // The second payment's fee was read (680); the first is estimated at
  // 2.9% + AED 1.00 (390); the dispute not read yet counts as nothing.
  assert.deepEqual(reads, ["ch_cov2"]);
  assert.equal(trainer.stripeFeesMinor, 680 + 390);
  assert.ok(pnl.months[0].notes.some((n: string) => /read from Stripe for \d+ of \d+/.test(n)));
  // The worker's sweep reads the rest and rebuilds the months it touched.
  await runStripeFeeSweep(f.db, stripe as any);
  pnl = await platformPnl(f.db, { from: month, to: month });
  trainer = pnl.trainers.find((t: any) => t.tenantId === owner.tenantId)!;
  assert.equal(trainer.stripeFeesMinor, 390 + 680 + 5500);
  // The dispute is won: Stripe reinstates the funds (and here the fee); the
  // closed dispute is read again for its second balance transaction, once.
  await post(owner.tenantId, "dispute-resolution:dp_cov1", now, [["dispute_reserve", 10000], ["trainer_payable", -10000]], { disputeId: "dp_cov1", status: "won" });
  reinstated = true;
  const again = await sweepStripeFees(f.db, stripe, { tenantId: owner.tenantId });
  assert.equal(again.recorded, 1);
  const before = reads.length;
  assert.equal((await sweepStripeFees(f.db, stripe, { tenantId: owner.tenantId })).recorded, 0);
  assert.equal(reads.length, before);
  // A domain payment's dispute has no ledger entry until lost: its webhook
  // reads it, and the fee is the platform's (product domain).
  await post(owner.tenantId, "web-address-invoice:in_dom", now, [["web_address_receivable", 1999], ["web_address_revenue", -1999]], { grossMinor: 1999, chargeId: "ch_dom" }, "USD");
  await captureFeesAfterWebhook(f.db, stripe, { type: "charge.dispute.created", data: { object: { id: "dp_dom", object: "dispute", charge: "ch_dom", metadata: { tenant_id: owner.tenantId } } } });
  const [domainFee] = await f.db.system((tx) => tx.query("SELECT product,fee_minor FROM stripe_fees WHERE source_id='dp_dom'"));
  assert.deepEqual([domainFee.product, Number(domainFee.fee_minor)], ["domain", 5500]);
  await rebuildPlatformSummary(f.db, [month], null, { tenantIds: [owner.tenantId] });
  pnl = await platformPnl(f.db, { from: month, to: month });
  trainer = pnl.trainers.find((t: any) => t.tenantId === owner.tenantId)!;
  // Read fees: the two charges, the dispute withdrawn and reinstated, the
  // domain dispute, and the domain payment's own fee (read by the same
  // webhook's sweep of the workspace).
  assert.equal(trainer.stripeFeesMinor, 390 + 680 + 5500 - 5500 + 5500 + 100);
  // The trainer's statement says how many were read, and names refunds and disputes.
  const view = await f.call(`/finance/statements/${month}`, { cookie: owner.cookie });
  assert.deepEqual(view.json().stripeFeesRead, { sources: 3, read: 3 });
});

test("payout bank fees can be corrected after a reversal, and the registrar book is kept in US dollars", async () => {
  const fin = await f.operator("finance");
  const owner = await f.person({ name: "Owner Fee Correction" });
  const payoutId = randomUUID();
  await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query("INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,revision,status,prepared_by) VALUES($1,$2,'2023-06',50000,$3,1,'submitted',$4)", [payoutId, owner.tenantId, randomUUID(), fin.userId]),
  );
  const fee = { tenantId: owner.tenantId, payoutId, amount: "5.25", currency: "AED", receiptReference: "BANK-STMT-9" };
  const wrong = await f.call("/admin/platform-finance/payout-fees", { cookie: fin.cookie, body: fee });
  assert.equal(wrong.statusCode, 200, wrong.body);
  assert.equal((await f.call("/admin/platform-finance/payout-fees", { cookie: fin.cookie, body: { ...fee, amount: "4.75" } })).json().code, "INTENT_CONFLICT");
  const reversal = await f.call(`/admin/platform-finance/costs/${wrong.json().id}/reverse`, { cookie: fin.cookie, body: { reason: "The bank charged 4.75, not 5.25" } });
  assert.equal(reversal.statusCode, 200, reversal.body);
  // After the reversal the correct fee is recorded; a retry returns it.
  const right = await f.call("/admin/platform-finance/payout-fees", { cookie: fin.cookie, body: { ...fee, amount: "4.75" } });
  assert.equal(right.statusCode, 200, right.body);
  assert.equal(right.json().amountMinor, 475);
  assert.equal((await f.call("/admin/platform-finance/payout-fees", { cookie: fin.cookie, body: { ...fee, amount: "4.75" } })).json().id, right.json().id);
  assert.equal((await f.call("/admin/platform-finance/payout-fees", { cookie: fin.cookie, body: { ...fee, amount: "6.00" } })).json().code, "INTENT_CONFLICT");
  await rebuildPlatformSummary(f.db, ["2023-06"], null, { tenantIds: [owner.tenantId] });
  const pnl = await platformPnl(f.db, { from: "2023-06", to: "2023-06" });
  const payout: any = pnl.payouts.find((p: any) => p.id === payoutId);
  assert.deepEqual([payout?.bankFeeMinor, payout?.bankFeeCurrency], [475, "AED"]);
  // The registrar charges in dollars: an order quoted in AED journals its
  // cost in AED at the quote's rate, and the book counts its USD cost.
  const book = async (): Promise<any> => (await platformPnl(f.db, { from: "2023-06", to: "2023-06" })).domains.registrar;
  const start = await book();
  await post(owner.tenantId, "web-address-registrar:op_aed", "2023-06-10T10:00:00Z", [["registrar_cost", 4216], ["registrar_prepaid", -4216]], { orderId: randomUUID(), hostname: "aed-order.example", currency: "AED", usd: "11.48", usdToAed: "3.6725" }, "AED");
  await post(owner.tenantId, "web-address-registrar:op_usd", "2023-06-10T10:00:00Z", [["registrar_cost", 1148], ["registrar_prepaid", -1148]], { orderId: randomUUID(), hostname: "usd-order.example", currency: "USD", usd: "11.48" }, "USD");
  const after = await book();
  assert.equal(after.chargedMinor.USD - (start.chargedMinor.USD ?? 0), 2296);
  if (after.bookBalanceMinor && start.bookBalanceMinor)
    assert.equal(start.bookBalanceMinor.USD - after.bookBalanceMinor.USD, 2296);
});

test("the worker's daily pass rebuilds older months, and personal exports carry no provider cost", async () => {
  const owner = await f.person({ name: "Owner Daily Rebuild" });
  const now = new Date();
  const month = new Date(now.getTime() + 4 * 3600000).toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const old = new Date(Date.UTC(y, m - 6, 1)).toISOString().slice(0, 7);
  await costs(owner.tenantId, [{ task: "coaching", provider: "openai", status: "estimated", cost: 1, estimate: 1, at: old + "-10T10:00:00Z" }]);
  await rebuildPlatformSummary(f.db, [old], null, { tenantIds: [owner.tenantId] });
  // An invoice correction to that month without an operation's refresh:
  await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query("UPDATE cost_events SET status='reconciled',cost_usd=3,reconciliation='{\"evidence\":\"synthetic\"}' WHERE tenant_id=$1", [owner.tenantId]),
  );
  const cost = async () => (await platformPnl(f.db, { from: old, to: old })).trainers.find((t: any) => t.tenantId === owner.tenantId)!.providerCostMinor;
  const rate = (await platformPnl(f.db, { from: old, to: old })).months[0].rate.aedPerUsd;
  assert.equal(await cost(), Math.round(1 * rate * 100));
  // The next daily pass (over the last 13 months) brings it up to date.
  await runPlatformFinanceJobs(f.db, new Date(now.getTime() + 21 * 3600000));
  assert.equal(await cost(), Math.round(3 * rate * 100));
  const built = (await platformPnl(f.db, { from: old, to: old })).months[0].builtAt;
  assert.ok(built && Date.parse(built) >= now.getTime() - 60000);
  // A member's personal export lists what ran and when, never the
  // provider, model or price of a call.
  await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query("INSERT INTO cost_events(id,tenant_id,user_id,task,provider,model,cost_usd,estimated_cost_usd,status,product,pricing) VALUES($1,$2,$3,'coaching','secretai','secret-model',0.5,0.5,'recorded','membership','{}')", [randomUUID(), owner.tenantId, owner.userId]),
  );
  const exported = await f.call("/privacy/export", { cookie: owner.cookie });
  assert.equal(exported.statusCode, 200, exported.body);
  const usage = exported.json().usage;
  assert.ok(Array.isArray(usage) && usage.length >= 1);
  assert.deepEqual(Object.keys(usage[0]).sort(), ["created_at", "id", "task"]);
  assert.doesNotMatch(JSON.stringify(usage), /secretai|secret-model|0\.5/);
});
