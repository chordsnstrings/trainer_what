/**
 * Super admin operations over the seeded platform: finance month close and a
 * Lean payout, refunds, safety/support/FinOps/jobs views, infrastructure,
 * custom-domain operations and privacy. Feature names match the "Platform
 * operators" inventory.
 */
import assert from "node:assert/strict";
import type { E2EContext, TrainerSeed } from "../harness/context.ts";
import { domainLifecycle } from "./domains.e2e.ts";

const A = "Super admin" as const;
const T = "Trainers" as const;
const FX = "3.6725";

/**
 * PostgreSQL-compatible round(sum(cost_usd) * fx * (100 + markup)) using exact
 * decimals: the AI Coach Service Fee, with the owner's default 100% markup
 * (28 September 2026).
 */
function usageChargeMinor(costs: Array<string | number | null>, fx = FX, markupPercent = 100) {
  const scaled = (value: string, places: number) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole + fraction.padEnd(places, "0").slice(0, places));
  };
  const sum = costs.reduce<bigint>((acc, c) => acc + scaled(String(c ?? "0"), 8), 0n);
  const product = sum * scaled(fx, 4) * BigInt(100 + markupPercent); // scale 1e12
  const unit = 10n ** 12n;
  return Number((product + unit / 2n) / unit);
}

export async function operatorScenarios(ctx: E2EContext) {
  const { admin, reporter: r } = ctx;
  const omar = ctx.trainers.find((t) => t.slug === "omar-conditioning" && t.published);
  const layla = ctx.trainers.find((t) => t.slug === "layla-strength" && t.published);
  // Sara's members paid full price; Omar's are still in their free trial ($0 invoices).
  const sara = ctx.trainers.find((t) => t.slug === "sara-mobility" && t.published);
  if (layla) await views(ctx, layla, omar);
  if (omar)
    await r.step(T, "Monthly payout runs", `${omar.slug}: payout preparation without a closed month is refused`, async () => {
      await omar.client.fails(409, "POST", "/api/v1/payout-runs/prepare", { period: previousPeriod() }, "PAYOUT_CLOSE_REQUIRED");
    });
  if (sara) await monthCloseAndPayout(ctx, sara);
  else r.skip(A, "Month close", "month close and payout", "sara-mobility did not launch");
  if (layla) await domains(ctx, layla);
  await platformFinance(ctx);
  await r.step(A, "Infrastructure observer", "API and worker observations are reported", async () => {
    const infra = await admin.get("/api/v1/admin/infrastructure");
    assert.ok(JSON.stringify(infra).includes("worker"), JSON.stringify(infra).slice(0, 300));
  });
  await r.step(A, "Operator activity log and operator list", "operator audit lists this run's reads", async () => {
    const security = await admin.get("/api/v1/admin/operations/security");
    assert.ok(security.rows.length > 0);
    assert.ok(security.summary.operators.some((o: any) => o.platform_role === "admin" && o.mfa_enabled));
  });
}

/**
 * Platform finance (docs/features/platform-finance.md, phases B-D): the
 * DigitalOcean billing import against the double, Stripe's fee per payment
 * from the Stripe double's balance transactions, the profit and loss built
 * from the summary and the full ledger export.
 */
async function platformFinance(ctx: E2EContext) {
  const { admin, reporter: r } = ctx;
  const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  await admin.stepUp();
  await r.step(A, "Platform finance", "DigitalOcean billing: only the platform project's items; this month estimated from its droplet", async () => {
    const result = await admin.post("/api/v1/admin/platform-finance/digitalocean/import", {});
    assert.equal(result.projectFound, true);
    // The worker's daily import may have read the invoices first: check what is recorded.
    const status = await admin.get("/api/v1/admin/platform-finance/digitalocean");
    assert.ok(status.invoices.length >= 2, JSON.stringify(status.invoices));
    assert.ok(status.invoices.every((i: any) => i.project_items === 0), "earlier invoices hold only another project's items");
    assert.ok(result.estimate?.projectedUsd > 0, JSON.stringify(result.estimate));
    return `estimate USD ${result.estimate.projectedUsd} for ${result.estimate.month}`;
  });
  await r.step(A, "Platform finance", "Stripe's fee per payment is read from the balance transactions", async () => {
    const swept = await admin.post("/api/v1/admin/platform-finance/stripe-fees/sweep", {});
    const costs = await admin.get(`/api/v1/admin/platform-finance/costs?from=${previousPeriod()}&to=${month}`);
    assert.ok(costs.stripeFees.count > 0, JSON.stringify(swept));
    return `${costs.stripeFees.count} fee record(s)`;
  });
  await r.step(A, "Platform finance", "profit and loss per month with the AI Coach Service Fee, costs and the ledger export", async () => {
    await admin.post("/api/v1/admin/platform-finance/rebuild", { from: previousPeriod(), to: month });
    const pnl = await admin.get(`/api/v1/admin/platform-finance?from=${previousPeriod()}&to=${month}`);
    assert.deepEqual(pnl.summary.missingMonths, []);
    assert.ok(pnl.months[0].income.some((l: any) => l.key === "aiCoachServiceFee"));
    assert.ok(pnl.platformCosts.some((c: any) => c.vendor === "DigitalOcean" && c.estimated), "DigitalOcean estimate counted");
    assert.ok(pnl.trainers.length > 0);
    const ledger = await admin.request("GET", `/api/v1/admin/platform-finance/export/ledger.csv?from=${previousPeriod()}&to=${month}`);
    assert.equal(ledger.status, 200);
    assert.match(ledger.text, /^tenant_id,workspace,month,created_at,journal_id,source_key/);
    return `${pnl.trainers.length} trainer(s), profit AED ${(pnl.total.profitMinor / 100).toFixed(2)}`;
  });
}

/**
 * The month (UAE calendar) that ledger journals and model usage land in once
 * moved 40 days back: last month from about the 11th, the month before on
 * the 1st to the 10th. That month always ended more than its seven-day refund
 * buffer ago, so it can be closed on any day the suite runs.
 */
function previousPeriod() {
  return new Date(Date.now() - 40 * 86400000 + 4 * 3600000).toISOString().slice(0, 7);
}

async function views(ctx: E2EContext, layla: TrainerSeed, omar?: TrainerSeed) {
  const { admin, reporter: r } = ctx;
  await r.step(A, "Per-workspace finance console", `${layla.slug}: finance summary with posted charges`, async () => {
    const finance = await admin.get(`/api/v1/admin/tenants/${layla.tenantId}/finance`);
    assert.ok(finance.summary);
    assert.ok((finance.summary.accounts?.stripe_receivable ?? 0) > 0, JSON.stringify(finance.summary).slice(0, 300));
  });
  await r.step(A, "Refund review and operator refunds", `${layla.slug}: refund requests and charges listed`, async () => {
    const refunds = await admin.get(`/api/v1/admin/tenants/${layla.tenantId}/finance/refunds`);
    assert.ok(refunds.charges.length > 0);
    return `${refunds.requests.length} requests, ${refunds.charges.length} charges`;
  });
  for (const [view, feature, expectRows] of [
    ["safety", "Safety escalations queue", true],
    ["support", "Support conversation queue", true],
    ["finops", "AI cost view (FinOps)", true],
    ["infrastructure", "Background job queue view", false],
    ["brains", "Brain releases and evaluation scores", true],
    ["wearables", "Wearable connection health view", false],
  ] as const)
  {
    // Omar raised a platform support ticket in the trainer suite; Layla has none.
    const tenant = view === "support" && omar ? omar : layla;
    await r.step(A, feature, `operations view ${view} for ${tenant.slug}`, async () => {
      const result = await admin.get(`/api/v1/admin/operations/${view}?tenantId=${tenant.tenantId}`);
      if (expectRows) assert.ok(result.rows.length > 0, `${view} has rows`);
      return `${result.rows.length} rows`;
    });
  }
  await r.step(A, "Email delivery reconciliation", "the email provider mock received account and notification mail", async () => {
    assert.ok(ctx.mocks.email.messages.length > 20);
    const jobs = await ctx.sqlRead<{ status: string; n: string }>(
      "SELECT status,count(*)::text AS n FROM jobs WHERE kind='email' GROUP BY status",
    );
    return JSON.stringify(jobs);
  });
}

async function monthCloseAndPayout(ctx: E2EContext, trainer: TrainerSeed) {
  const { admin, reporter: r } = ctx;
  const base = `/api/v1/admin/tenants/${trainer.tenantId}/finance`;
  const period = previousPeriod();
  // The harness cannot wait for a month to end and its seven-day refund
  // buffer. Move this workspace's ledger journals and model usage 40 days
  // back in the throwaway database (amounts untouched), then close that month.
  await ctx.advanceClock(
    `${trainer.slug}: move ledger journals and model usage 40 days back so ${period} has ended`,
    // Immutability triggers are suspended only inside this one transaction.
    `SET LOCAL session_replication_role = replica;
     UPDATE journals SET created_at=created_at-interval '40 days' WHERE tenant_id=$1;
     UPDATE cost_events SET created_at=created_at-interval '40 days' WHERE tenant_id=$1`,
    [trainer.tenantId],
  );
  await admin.stepUp();
  let costs: any[] = [];
  // Debits the harness itself posts after the closed month's cutoff; the payout must net them out.
  let postedUsageMinor = 0,
    settlementFeeMinor = 0,
    closed: any;
  await r.step(A, "AI usage cost reconciliation", `${trainer.slug}: every model call is priced from recorded token usage`, async () => {
    const finance = await admin.get(base);
    assert.equal(finance.unresolvedUsage.length, 0, "no reserved or unknown usage");
    // Trainers see what ran, never its provider cost (owner decision).
    const listed = (await trainer.client.get("/api/v1/bootstrap")).costs;
    assert.ok(listed.length > 0, "usage recorded");
    assert.ok(listed.every((c: any) => !("cost_usd" in c) && !("provider" in c)), "no provider cost on the trainer's list");
    const byStatus = finance.usageByStatus as any[];
    assert.ok(byStatus.every((s: any) => ["recorded", "reconciled", "estimated"].includes(s.status)), "all usage priced");
    costs = byStatus.map((s: any) => s.cost_usd);
    return `${listed.length} priced model calls`;
  });
  await r.step(A, "Monthly AI usage statements", `${trainer.slug}: usage statement for ${period}`, async () => {
    const chargeMinor = usageChargeMinor(costs);
    const preview = await admin.get(`${base}/usage-preview?period=${period}`);
    assert.equal(preview.usage.markupPercent, 100, "the AI Coach Service Fee carries the 100% markup");
    const statement = await admin.post(`${base}/usage-statements`, {
      period,
      fxAedPerUsd: Number(FX),
      chargeMinor,
      feeScheduleVersion: "sandbox-2026-09",
      evidenceReference: "Mock provider usage export reviewed by the Superadmin",
    });
    assert.equal(Number(statement.charge_minor ?? statement.chargeMinor ?? chargeMinor), chargeMinor);
    postedUsageMinor = chargeMinor;
    return `${chargeMinor} AED minor`;
  });
  await r.step(A, "Record Stripe bank settlements", `${trainer.slug}: Stripe payout settled to the bank`, async () => {
    const finance = await admin.get(base);
    const receivable = Number(finance.summary.accounts.stripe_receivable ?? 0);
    assert.ok(receivable > 0, "receivable to settle");
    const fee = Math.round(receivable * 0.029);
    await admin.post(`${base}/settlements`, {
      stripePayoutId: "po_mock_" + Date.now(),
      bankReference: "BANK-MOCK-" + Date.now(),
      grossMinor: receivable,
      feeMinor: fee,
      netMinor: receivable - fee,
      evidenceReference: "Mock Stripe payout report matched to bank statement",
    });
    settlementFeeMinor = fee;
    return `${receivable} settled`;
  });
  await r.step(A, "Month close", `${trainer.slug}: ${period} closed after the refund buffer`, async () => {
    const close = await admin.post(`${base}/close`, { period, evidenceReference: "Sandbox month-end review completed" });
    assert.equal(close.status, "closed");
    assert.ok(close.data.eligibleMinor > 0, JSON.stringify(close.data).slice(0, 300));
    closed = close;
    return `eligible ${close.data.eligibleMinor}`;
  });
  await r.step(T, "Ledger CSV export and monthly statements", `${trainer.slug}: statement for ${period} and ledger CSV`, async () => {
    const statement = await trainer.client.get(`/api/v1/finance/statements/${period}`);
    assert.ok(statement);
    const csv = await trainer.client.request("GET", "/api/v1/finance/export");
    assert.equal(csv.status, 200);
    assert.ok(csv.text.split("\n").length > 2);
  });
  let payout: any;
  await r.step(T, "Monthly payout runs", `${trainer.slug}: payout prepared from the closed month, net of later debits and bounded by available and funded money`, async () => {
    assert.ok(closed, "the month was closed");
    const before = (await admin.get(base)).summary;
    // The only trainer_payable debits after the cutoff are the usage charge and the settlement fee posted above.
    const [later] = await ctx.sqlRead<{ total: string }>(
      "SELECT coalesce(sum(l.amount_minor),0)::text AS total FROM journal_lines l JOIN journals j ON j.id=l.journal_id AND j.tenant_id=l.tenant_id WHERE j.tenant_id=$1 AND l.account='trainer_payable' AND l.amount_minor>0 AND j.created_at>=$2",
      [trainer.tenantId, closed.data.cutoff],
    );
    assert.equal(Number(later.total), postedUsageMinor + settlementFeeMinor, "later debits are the usage charge and the settlement fee");
    const reserved = Number(before.reservedMinor);
    const eligible = Math.max(0, Number(closed.data.eligibleMinor) - postedUsageMinor - settlementFeeMinor - reserved);
    const funded = Math.max(0, Number(before.accounts.bank_cash ?? 0) - reserved);
    const expected = Math.min(eligible, Number(before.availableMinor), funded);
    payout = await trainer.client.post("/api/v1/payout-runs/prepare", { period });
    assert.equal(payout.status, "ready");
    assert.ok(Number(payout.amount_minor) > 0);
    assert.equal(Number(payout.amount_minor), expected, `min(eligible ${eligible}, available ${before.availableMinor}, funded ${funded})`);
    return `${payout.amount_minor} AED minor = min(eligible ${eligible}, available ${before.availableMinor}, funded ${funded})`;
  });
  if (!payout) {
    r.blocked("no payout was prepared", [
      [A, "Payout execution to trainer banks", `${trainer.slug}: payout execution`],
      [A, "Payout cancellation and bank outcome recording", `${trainer.slug}: bank outcome`],
    ]);
    return;
  }
  let payableBefore = 0;
  await r.step(A, "Payout execution to trainer banks", `${trainer.slug}: independent operator sends the payout to the Lean mock`, async () => {
    payableBefore = Number((await admin.get(base)).summary.accounts.trainer_payable ?? 0);
    const before = ctx.mocks.lean.payments.size;
    const result = await admin.post(`${base}/payouts/${payout.id}/execute`, {});
    assert.equal(result.status, "processing");
    assert.equal(ctx.mocks.lean.payments.size, before + 1);
    const payment = [...ctx.mocks.lean.payments.values()].at(-1)!;
    assert.equal(payment.amount, Number(payout.amount_minor) / 100);
    assert.equal(payment.currency, "AED");
    assert.equal(payment.idempotency_key, payout.id, "payout id is the idempotency key");
  });
  await r.step(A, "Payout cancellation and bank outcome recording", `${trainer.slug}: bank confirms the payment`, async () => {
    const paid = await admin.post(`${base}/payouts/${payout.id}/reconcile`, {
      status: "paid",
      bankReference: "LEAN-MOCK-SETTLED",
      evidenceReference: "Mock bank statement shows the credit",
    });
    assert.equal(paid.status, "paid");
    // The confirmed payment is posted once, balanced, and reduces what the platform owes the trainer by exactly its amount.
    const lines = await ctx.sqlRead<{ account: string; amount: string }>(
      "SELECT l.account,l.amount_minor::text AS amount FROM journal_lines l JOIN journals j ON j.id=l.journal_id AND j.tenant_id=l.tenant_id WHERE j.tenant_id=$1 AND j.source_key=$2 ORDER BY l.account",
      [trainer.tenantId, "payout:" + payout.id],
    );
    const amount = Number(payout.amount_minor);
    assert.deepEqual(
      lines.map((l) => [l.account, Number(l.amount)]),
      [["bank_cash", -amount], ["trainer_payable", amount]],
      "payout journal posted and balanced",
    );
    const payableAfter = Number((await admin.get(base)).summary.accounts.trainer_payable ?? 0);
    assert.equal(payableAfter - payableBefore, amount, "trainer_payable owed dropped by exactly the payout");
    return `payout:${payout.id} posted; owed to the trainer ${-payableBefore} → ${-payableAfter}`;
  });
}

async function domains(ctx: E2EContext, trainer: TrainerSeed) {
  const { admin, reporter: r, mocks } = ctx;
  const hostname = "layla-strength-coaching.example";
  let order: any;
  let owned: any;
  await r.step(T, "Custom domain", `${trainer.slug}: requests ${hostname}`, async () => {
    order = await trainer.client.post("/api/v1/domains", { hostname, alreadyOwned: false });
    assert.equal(order.status, "requested");
  });
  if (!order) return;
  await r.step(A, "Custom domain operations", `${hostname}: registrar quote, trainer approval and registration evidence`, async () => {
    const check = await fetch(`${mocks.registrar.url}/v1/domains/check?domain=${hostname}`, {
      headers: { authorization: `Bearer ${mocks.secrets.registrar}` },
    }).then((x) => x.json());
    assert.equal(check.available, true);
    const quoted = await admin.post(`/api/v1/admin/integrations/domains/${order.id}/quote`, {
      revision: Number(order.version),
      amountMinor: check.priceMinor,
      currency: "AED",
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      renewalMinor: check.renewalMinor,
      termMonths: 12,
      providerReference: "mock-registrar-quote-" + hostname,
    });
    const approved = await trainer.client.okMfa("POST", `/api/v1/domains/${order.id}/approve`, {
      revision: Number(quoted.version),
      amountMinor: check.priceMinor,
      currency: "AED",
      accepted: true,
    });
    const registration = await fetch(`${mocks.registrar.url}/v1/domains`, {
      method: "POST",
      headers: { authorization: `Bearer ${mocks.secrets.registrar}`, "content-type": "application/json" },
      body: JSON.stringify({ domain: hostname }),
    }).then((x) => x.json());
    owned = await admin.post(`/api/v1/admin/integrations/domains/${order.id}/ownership`, {
      revision: Number(approved.version),
      registrarReference: registration.id,
      paymentEvidence: "Mock registrar invoice paid from the platform account",
      expiresAt: registration.expiresAt,
    });
    assert.equal(owned.status, "owned");
    return "registrar evidence recorded; DNS and activation continue in the domain lifecycle";
  });
  if (owned?.status === "owned") await domainLifecycle(ctx, trainer, owned);
}
