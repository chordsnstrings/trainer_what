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
  // Posted now, so it is on this month's statement (cash basis).
  const posted = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const view = await f.call(`/finance/statements/${posted}`, { cookie: owner.cookie });
  assert.equal(view.statusCode, 200, view.body);
  const s = view.json();
  assert.equal(s.aiCoachServiceFeeMinor, 1200);
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
  assert.deepEqual(Object.keys(usage.json().items[0]).sort(), ["charge_minor", "period"]);
  const calls = await f.call("/workspace/pages/costs", { cookie: owner.cookie });
  assert.doesNotMatch(calls.body, /cost_usd|cartesia|fixture-model/);
  // The trainer's CSV names each line; the usage charge by its name.
  const csv = await f.call("/finance/export", { cookie: owner.cookie });
  assert.match(csv.body, /"usage:2026-05","AI Coach Service Fee"/);
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
  const staff = await f.person({ tenantId: owner.tenantId, role: "staff" });
  assert.equal((await f.call("/finance/fees", { cookie: staff.cookie })).statusCode, 403);
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
  assert.equal(line("costs", "stripeFees"), 2000);
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
