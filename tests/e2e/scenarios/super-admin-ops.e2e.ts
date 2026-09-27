/**
 * Super admin operations over the seeded platform: finance month close and a
 * Lean payout, refunds, safety/support/FinOps/jobs views, infrastructure,
 * custom-domain operations and privacy. Feature names match the "Platform
 * operators" inventory.
 */
import assert from "node:assert/strict";
import type { E2EContext, TrainerSeed } from "../harness/context.ts";

const A = "Super admin" as const;
const T = "Trainers" as const;
const FX = "3.6725";

/** PostgreSQL-compatible round(sum(cost_usd) * fx * 100) using exact decimals. */
function usageChargeMinor(costs: Array<string | number | null>, fx = FX) {
  const scaled = (value: string, places: number) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole + fraction.padEnd(places, "0").slice(0, places));
  };
  const sum = costs.reduce<bigint>((acc, c) => acc + scaled(String(c ?? "0"), 8), 0n);
  const product = sum * scaled(fx, 4) * 100n; // scale 1e12
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

function previousPeriod() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
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
  await r.step(A, "AI usage cost reconciliation", `${trainer.slug}: every model call is priced from recorded token usage`, async () => {
    const finance = await admin.get(base);
    assert.equal(finance.unresolvedUsage.length, 0, "no reserved or unknown usage");
    costs = (await trainer.client.get("/api/v1/bootstrap")).costs;
    assert.ok(costs.length > 0 && costs.every((c: any) => c.cost_usd !== null), "all usage priced");
    return `${costs.length} priced model calls`;
  });
  await r.step(A, "Monthly AI usage statements", `${trainer.slug}: usage statement for ${period}`, async () => {
    const chargeMinor = usageChargeMinor(costs.map((c: any) => c.cost_usd));
    const statement = await admin.post(`${base}/usage-statements`, {
      period,
      fxAedPerUsd: Number(FX),
      chargeMinor,
      feeScheduleVersion: "sandbox-2026-09",
      evidenceReference: "Mock provider usage export reviewed by the Superadmin",
    });
    assert.equal(Number(statement.charge_minor ?? statement.chargeMinor ?? chargeMinor), chargeMinor);
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
    return `${receivable} settled`;
  });
  await r.step(A, "Month close", `${trainer.slug}: ${period} closed after the refund buffer`, async () => {
    const close = await admin.post(`${base}/close`, { period, evidenceReference: "Sandbox month-end review completed" });
    assert.equal(close.status, "closed");
    assert.ok(close.data.eligibleMinor > 0, JSON.stringify(close.data).slice(0, 300));
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
  await r.step(T, "Monthly payout runs", `${trainer.slug}: payout prepared from the closed month`, async () => {
    payout = await trainer.client.post("/api/v1/payout-runs/prepare", { period });
    assert.equal(payout.status, "ready");
    assert.ok(Number(payout.amount_minor) > 0);
    return `${payout.amount_minor} AED minor`;
  });
  if (!payout) return;
  await r.step(A, "Payout execution to trainer banks", `${trainer.slug}: independent operator sends the payout to the Lean mock`, async () => {
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
  });
}

async function domains(ctx: E2EContext, trainer: TrainerSeed) {
  const { admin, reporter: r, mocks } = ctx;
  const hostname = "layla-strength-coaching.example";
  let order: any;
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
    const owned = await admin.post(`/api/v1/admin/integrations/domains/${order.id}/ownership`, {
      revision: Number(approved.version),
      registrarReference: registration.id,
      paymentEvidence: "Mock registrar invoice paid from the platform account",
      expiresAt: registration.expiresAt,
    });
    assert.equal(owned.status, "owned");
    return "DNS TXT/CNAME and live TLS activation are not simulated (see feature doc)";
  });
}
