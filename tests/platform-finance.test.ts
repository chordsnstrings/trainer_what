// Platform finance phase A (docs/features/platform-finance.md): voice calls
// priced at their estimate when made, explicit estimates and invoice
// corrections instead of unpriced rows blocking the month, real provider and
// model names with cost tags and reviewed model prices, one reviewed USD to
// AED rate per month, pricing a provider's month from its usage total, the
// domain refund reversal, the richer metrics and the trainer revenue query.
// Every account, workspace, amount and provider response is synthetic.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../packages/db/src/migrations.ts";
import { governanceFixture, type Person } from "./governance-fixtures.ts";
import {
  withRuntimeConfig,
  validateIntegrationValues,
} from "../packages/providers/src/configuration.ts";
import { modelCompletion } from "../packages/providers/src/model-accounting.ts";
import { modelAccounting } from "../apps/api/src/model-accounting.ts";
import {
  costEstimated,
  costNotSent,
  costProduct,
  estimateUnresolvedUsage,
  monthRate,
  periodUsage,
  reserveVoiceCost,
} from "../apps/api/src/cost-accounting.ts";
import {
  closeMonth,
  postUsageStatement,
  reconcileModelUsage,
} from "../apps/api/src/finance-operations.ts";
import {
  configureFinanceAutomation,
  executeFinanceJob,
} from "../apps/api/src/finance-automation.ts";
import {
  computeBusinessMetrics,
  metricsCsv,
} from "../apps/api/src/business-metrics.ts";
import { financialStatement } from "../apps/api/src/finance-statements.ts";
import { trainerRevenue } from "../apps/api/src/admin-operations.ts";
import { processWebAddressStripeEvent } from "../apps/api/src/web-address-orders.ts";
import { usdText, usdUnits } from "../apps/api/src/platform-finance.ts";

let f: Awaited<ReturnType<typeof governanceFixture>>;
before(async () => {
  f = await governanceFixture();
});
after(async () => {
  await f?.close();
});

type Cost = {
  task: string;
  provider?: string;
  status: string;
  cost?: number | null;
  estimate?: number | null;
  at: string;
  complimentary?: boolean;
  userId?: string | null;
  model?: string;
};
async function costs(tenantId: string, rows: Cost[]) {
  const ids: string[] = [];
  await f.db.tenant(f.scoped(tenantId, "finance"), async (tx) => {
    for (const r of rows) {
      const id = randomUUID();
      ids.push(id);
      await tx.query(
        "INSERT INTO cost_events(id,tenant_id,user_id,task,provider,model,cost_usd,estimated_cost_usd,status,complimentary,product,created_at,pricing) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        [
          id,
          tenantId,
          r.userId ?? null,
          r.task,
          r.provider ?? "fixture",
          r.model ?? "fixture-model",
          r.cost ?? null,
          r.estimate ?? null,
          r.status,
          r.complimentary ?? false,
          costProduct(r.task),
          r.at,
          JSON.stringify(
            r.estimate != null ? { reservedCostUsd: r.estimate, estimated: true } : {},
          ),
        ],
      );
    }
  });
  return ids;
}
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
const row = (tenantId: string, id: string) =>
  f.db
    .tenant(f.scoped(tenantId, "finance"), (tx) =>
      tx.query("SELECT * FROM cost_events WHERE id=$1", [id]),
    )
    .then((r) => r[0]);
const finance = (p: Person) =>
  ({ tenantId: p.tenantId, userId: p.userId, role: "owner" }) as const;

test("voice calls are priced at their estimate when made, and unpriced rows are estimated or reconciled instead of blocking the usage charge and month close", async () => {
  const owner = await f.person({ name: "Owner Voice Pricing" });
  const a = f.scoped(owner.tenantId, "owner");
  // A call reserved now that answered: 'estimated' at its stored estimate.
  const live = randomUUID();
  await f.db.tenant(a, (tx) =>
    reserveVoiceCost(tx, {
      id: live,
      tenantId: owner.tenantId,
      userId: owner.userId,
      memberId: null,
      task: "voice.preview",
      provider: "cartesia",
      model: "sonic-fixture",
      priceVersion: "voice-v1",
      pricing: { basis: "characters", characters: 50, reservedCostUsd: 0.0025 },
      traceId: "clip-fixture",
    }),
  );
  await f.db.tenant(a, (tx) =>
    tx.query("UPDATE cost_events SET status='unknown' WHERE id=$1", [live]),
  );
  await f.db.tenant(a, (tx) =>
    costEstimated(tx, live, { providerRequestId: "req-fixture" }),
  );
  const priced = await row(owner.tenantId, live);
  assert.equal(priced.status, "estimated");
  assert.equal(Number(priced.cost_usd), 0.0025);
  assert.equal(Number(priced.estimated_cost_usd), 0.0025);
  assert.equal(priced.product, "trainer_setup");
  assert.equal(priced.pricing.providerRequestId, "req-fixture");
  // The stored estimate cannot be rewritten once a row is priced.
  await assert.rejects(
    f.db.tenant(a, (tx) =>
      tx.query(
        "UPDATE cost_events SET status='reconciled',cost_usd=1,estimated_cost_usd=1,reconciliation='{}' WHERE id=$1",
        [live],
      ),
    ),
    /stored usage estimate cannot be changed/,
  );

  // May: a voice call whose answer was lost (stored estimate), a model call
  // whose answer was lost (average of the same task and model), and one with
  // no basis for an estimate.
  const [voiceUnknown, aiUnknown, noBasis] = await costs(owner.tenantId, [
    { task: "voice.session", provider: "cartesia", status: "unknown", estimate: 0.004, at: "2026-05-10T10:00:00Z" },
    { task: "coaching", provider: "openai", status: "unknown", at: "2026-05-11T10:00:00Z" },
    { task: "brain_compilation", provider: "openai", model: "rare-model", status: "unknown", at: "2026-05-12T10:00:00Z" },
    { task: "coaching", provider: "openai", status: "recorded", cost: 0.01, estimate: 0.01, at: "2026-05-01T10:00:00Z" },
    { task: "coaching", provider: "openai", status: "recorded", cost: 0.03, estimate: 0.03, at: "2026-05-02T10:00:00Z" },
  ]);
  const input = {
    period: "2026-05",
    fxAedPerUsd: 3.6725,
    chargeMinor: 0,
    feeScheduleVersion: "fixture-v1",
    evidenceReference: "Synthetic usage evidence",
  };
  await assert.rejects(
    f.db.tenant(finance(owner), (tx) => postUsageStatement(tx, finance(owner), input)),
    (e: any) => e.code === "USAGE_UNRECONCILED" && /3 provider call/.test(e.message),
  );
  await assert.rejects(
    f.db.tenant(finance(owner), (tx) =>
      closeMonth(tx, finance(owner), "2026-05", "Synthetic close evidence"),
    ),
    (e: any) => e.code === "RECONCILIATION_REQUIRED" && /Estimate unpriced usage/.test(e.message),
  );
  const estimated = await f.db.tenant(finance(owner), (tx) =>
    estimateUnresolvedUsage(tx, finance(owner), {
      before: new Date("2026-05-31T20:00:00Z"),
      evidenceReference: "Operator estimate after provider timeout",
      method: "operator",
    }),
  );
  assert.equal(estimated.estimated, 2);
  assert.equal(estimated.remaining, 1);
  assert.equal(estimated.remainingRows[0].id, noBasis);
  const v = await row(owner.tenantId, voiceUnknown);
  assert.deepEqual(
    [v.status, Number(v.cost_usd), v.reconciliation.basis, v.reconciliation.method],
    ["estimated", 0.004, "stored_estimate", "operator_estimate"],
  );
  const m = await row(owner.tenantId, aiUnknown);
  assert.deepEqual(
    [m.status, Number(m.cost_usd), Number(m.estimated_cost_usd), m.reconciliation.basis],
    ["estimated", 0.02, 0.02, "average_same_task_model"],
  );
  // The row with no basis is reconciled one by one; an estimated row can
  // later be corrected by the invoice and keeps the estimate it replaced.
  await f.db.tenant(finance(owner), (tx) =>
    reconcileModelUsage(tx, finance(owner), noBasis, {
      costUsd: "0.05",
      providerRequestId: "resp-no-basis",
      evidenceReference: "Provider invoice line fixture",
    }),
  );
  const corrected = await f.db.tenant(finance(owner), (tx) =>
    reconcileModelUsage(tx, finance(owner), voiceUnknown, {
      costUsd: "0.005",
      providerRequestId: "clip-invoice-line",
      evidenceReference: "Provider invoice line fixture",
    }),
  );
  assert.equal(corrected.status, "reconciled");
  assert.equal(Number(corrected.estimated_cost_usd), 0.004);
  assert.equal(corrected.reconciliation.previousStatus, "estimated");
  const usage = await f.db.tenant(finance(owner), (tx) =>
    periodUsage(tx, "2026-05", 3.6725),
  );
  assert.equal(usage.unpriced, 0);
  // 0.005 + 0.02 + 0.05 + 0.01 + 0.03 = 0.115 USD at 3.6725 = 42.23 fils.
  assert.equal(usage.chargeableUsd, "0.11500000");
  assert.equal(usage.chargeMinor, 42);
  const statement = await f.db.tenant(finance(owner), (tx) =>
    postUsageStatement(tx, finance(owner), { ...input, chargeMinor: 42 }),
  );
  assert.equal(Number(statement.charge_minor), 42);
  assert.equal(statement.cost_event_count, 5);
  const closed = await f.db.tenant(finance(owner), (tx) =>
    closeMonth(tx, finance(owner), "2026-05", "Synthetic close evidence"),
  );
  assert.equal(closed.status, "closed");
});

test("model calls record the real provider and model, the member, product and complimentary access, and use the reviewed model price", async () => {
  const owner = await f.person({ name: "Owner Model Tags" });
  const complimentary = await f.person({ tenantId: owner.tenantId, role: "subscriber" });
  const upfront = await f.person({ tenantId: owner.tenantId, role: "subscriber" });
  await f.db.tenant(f.scoped(owner.tenantId, "owner"), async (tx) => {
    await tx.query(
      "INSERT INTO complimentary_access(id,tenant_id,user_id,tier,reason,granted_by) VALUES($1,$2,$3,'workout','Synthetic grant',$4)",
      [randomUUID(), owner.tenantId, complimentary.userId, owner.userId],
    );
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,price_minor,data) VALUES($1,$2,$3,NULL,'active',now()+interval '60 days',90000,$4)",
      [
        randomUUID(),
        owner.tenantId,
        upfront.userId,
        JSON.stringify({ tier: "workout", billing: "upfront", programmeDays: 90 }),
      ],
    );
  });
  const admin = await f.operator("admin");
  const price = await f.call("/admin/finance/model-prices", {
    cookie: admin.cookie,
    body: {
      provider: "openai",
      model: "fixture-model",
      inputUsdPerMillion: 10,
      outputUsdPerMillion: 20,
      priceVersion: "reviewed-fixture-v1",
      effectiveFrom: "2026-01-01T00:00:00Z",
      source: "Synthetic price page fixture",
    },
  });
  assert.equal(price.statusCode, 200, price.body);
  const duplicate = await f.call("/admin/finance/model-prices", {
    cookie: admin.cookie,
    body: {
      provider: "openai",
      model: "fixture-model",
      inputUsdPerMillion: 11,
      outputUsdPerMillion: 22,
      priceVersion: "reviewed-fixture-v2",
      effectiveFrom: "2026-01-01T00:00:00Z",
      source: "Synthetic price page fixture",
    },
  });
  assert.equal(duplicate.json().code, "PRICE_EXISTS");
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      id: "fixture-response",
      usage: { prompt_tokens: 100, completion_tokens: 25 },
      choices: [],
    });
  const member = {
    tenantId: owner.tenantId,
    userId: complimentary.userId,
    role: "subscriber",
  };
  try {
    const settings = {
      MODEL_BASE_URL: "https://api.openai.com/v1",
      MODEL_INPUT_USD_PER_MILLION: "2",
      MODEL_OUTPUT_USD_PER_MILLION: "4",
      MODEL_PRICE_VERSION: "settings-v1",
      MODEL_MAX_DAILY_CALLS: "100",
    };
    const reviewed = await withRuntimeConfig(settings, () =>
      modelCompletion(
        "https://model.fixture.invalid/v1",
        "fixture-model-key",
        "fixture-model",
        {},
        modelAccounting(f.db, member, "coaching"),
      ),
    );
    // (100 x 10 + 25 x 20) / 1,000,000 at the reviewed price.
    assert.equal(reviewed.usage.cost, 0.0015);
    assert.equal(reviewed.usage.priceVersion, "reviewed-fixture-v1");
    // Another provider with no reviewed price keeps the settings' price.
    const fallback = await withRuntimeConfig(
      { ...settings, MODEL_PROVIDER: "anthropic" },
      () =>
        modelCompletion(
          "https://model.fixture.invalid/v1",
          "fixture-model-key",
          "fixture-model",
          {},
          modelAccounting(f.db, member, "coaching"),
        ),
    );
    assert.equal(fallback.usage.cost, 0.0003);
  } finally {
    globalThis.fetch = original;
  }
  const rows = await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query(
      "SELECT provider,model,member_id,product,complimentary,status,cost_usd::text AS cost,estimated_cost_usd::text AS estimate,price_version FROM cost_events WHERE user_id=$1 ORDER BY created_at",
      [complimentary.userId],
    ),
  );
  assert.deepEqual(rows, [
    {
      provider: "openai",
      model: "fixture-model",
      member_id: complimentary.userId,
      product: "membership",
      complimentary: true,
      status: "recorded",
      cost: "0.00150000",
      estimate: "0.00150000",
      price_version: "reviewed-fixture-v1",
    },
    {
      provider: "anthropic",
      model: "fixture-model",
      member_id: complimentary.userId,
      product: "membership",
      complimentary: true,
      status: "recorded",
      cost: "0.00030000",
      estimate: "0.00030000",
      price_version: "settings-v1",
    },
  ]);
  // A Brain plan the worker generates for a member on an upfront programme.
  await withRuntimeConfig({ MODEL_BASE_URL: "https://openrouter.ai/api/v1" }, () =>
    modelAccounting(f.db, f.scoped(owner.tenantId, "owner"), "brain_plan", {
      memberId: upfront.userId,
    }).reserve("plan-model"),
  );
  const [plan] = await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query(
      "SELECT provider,member_id,product,complimentary FROM cost_events WHERE task='brain_plan'",
    ),
  );
  assert.deepEqual(plan, {
    provider: "openrouter",
    member_id: upfront.userId,
    product: "programme",
    complimentary: false,
  });
});

test("one reviewed USD to AED rate per month: revisions, metrics conversion, and usage statements must use it", async () => {
  const fin = await f.operator("finance");
  const support = await f.operator("support");
  assert.equal(
    (await f.call("/admin/finance/exchange-rates", { cookie: support.cookie })).statusCode,
    403,
  );
  const listed = await f.call("/admin/finance/exchange-rates", { cookie: fin.cookie });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json().defaultAedPerUsd, 3.6725);
  const set = (aedPerUsd: number) =>
    f.call("/admin/finance/exchange-rates", {
      cookie: fin.cookie,
      body: { month: "2026-03", aedPerUsd, source: "Synthetic central bank rate" },
    });
  assert.equal((await set(3.7)).json().revision, 1);
  const second = await set(3.68);
  assert.equal(second.json().revision, 2);
  assert.equal((await set(3.68)).json().unchanged, true);
  assert.equal((await set(3.1234567)).json().code, "RATE_PRECISION");
  const rate = await monthRate(f.db, "2026-03");
  assert.deepEqual([rate.aedPerUsd, rate.source, rate.revision], [3.68, "reviewed", 2]);
  assert.equal((await monthRate(f.db, "2026-04")).source, "default");

  const owner = await f.person({ name: "Owner Exchange Rate" });
  await costs(owner.tenantId, [
    { task: "coaching", status: "recorded", cost: 10, estimate: 10, at: "2026-03-10T10:00:00Z" },
    { task: "coaching", status: "recorded", cost: 10, estimate: 10, at: "2026-04-10T10:00:00Z" },
  ]);
  const metrics = await computeBusinessMetrics(f.db, { ...fin, role: "finance" }, {
    months: 2,
    now: new Date("2026-04-15T12:00:00Z"),
  });
  const [mar, apr] = metrics.series;
  assert.deepEqual(
    [mar.aedPerUsd, mar.fxSource, mar.providerCostAedMinor],
    [3.68, "reviewed", 3680],
  );
  assert.deepEqual([apr.aedPerUsd, apr.fxSource, apr.aiCostUsd], [3.6725, "default", 10]);
  assert.equal(
    apr.providerCostAedMinor,
    Math.round((apr.aiCostUsd + apr.voiceCostUsd) * 3.6725 * 100),
  );
  assert.equal(metrics.fx.months[0]?.source, "reviewed");

  // The usage statement for March must convert at the reviewed rate.
  const route = (body: unknown) =>
    f.call(`/admin/tenants/${owner.tenantId}/finance/usage-statements`, {
      cookie: fin.cookie,
      body,
    });
  const statement = {
    period: "2026-03",
    fxAedPerUsd: 3.6725,
    chargeMinor: 3673,
    feeScheduleVersion: "fixture-v1",
    evidenceReference: "Synthetic usage evidence",
  };
  const mismatch = await route(statement);
  assert.equal(mismatch.statusCode, 409, mismatch.body);
  assert.equal(mismatch.json().code, "FX_RATE_MISMATCH");
  const preview = await f.call(
    `/admin/tenants/${owner.tenantId}/finance/usage-preview?period=2026-03`,
    { cookie: fin.cookie },
  );
  assert.equal(preview.statusCode, 200, preview.body);
  assert.deepEqual(
    [preview.json().rate.aedPerUsd, preview.json().usage.chargeMinor],
    [3.68, 3680],
  );
  const posted = await route({ ...statement, fxAedPerUsd: 3.68, chargeMinor: 3680 });
  assert.equal(posted.statusCode, 200, posted.body);
  // April has no reviewed rate: an operator's rate is accepted, as before,
  // and the preview says the default rate converts it.
  const aprilPreview = await f.call(
    `/admin/tenants/${owner.tenantId}/finance/usage-preview?period=2026-04`,
    { cookie: fin.cookie },
  );
  assert.deepEqual(aprilPreview.json().chargeRate, { aedPerUsd: 3.6725, source: "default" });
  const april = await route({ ...statement, period: "2026-04", fxAedPerUsd: 3.67, chargeMinor: 3670 });
  assert.equal(april.statusCode, 200, april.body);
  // A posted statement shows what it charged beside the month's current
  // priced usage at that statement's rate.
  const postedPreview = await f.call(
    `/admin/tenants/${owner.tenantId}/finance/usage-preview?period=2026-04`,
    { cookie: fin.cookie },
  );
  assert.deepEqual(
    [postedPreview.json().postedComparison.chargeMinor, postedPreview.json().postedComparison.currentChargeMinor, postedPreview.json().postedComparison.differenceMinor],
    [3670, 3670, 0],
  );
  // Revising March after its usage was charged at 3.68 needs a confirmation;
  // the charge keeps its rate and metrics flag the month.
  const revised = await set(3.7);
  assert.equal(revised.statusCode, 409, revised.body);
  assert.equal(revised.json().code, "POSTED_STATEMENTS_DIFFER");
  assert.equal((await monthRate(f.db, "2026-03")).revision, 2);
  const confirmed = await f.call("/admin/finance/exchange-rates", {
    cookie: fin.cookie,
    body: { month: "2026-03", aedPerUsd: 3.7, source: "Synthetic central bank rate", acknowledgePostedStatements: true },
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.deepEqual([confirmed.json().revision, confirmed.json().usageStatementsAtOtherRate], [3, 1]);
  const flagged = await computeBusinessMetrics(f.db, { ...fin, role: "finance" }, {
    months: 2,
    now: new Date("2026-04-15T12:00:00Z"),
  });
  assert.ok(flagged.series[0].usageChargedAtOtherRate >= 1);
  const audit = await f.db.system((tx) =>
    tx.query(
      "SELECT action,data FROM admin_operations_audit WHERE actor_id=$1 AND action LIKE 'finance.exchange_rate%' ORDER BY created_at",
      [fin.userId],
    ),
  );
  assert.ok(audit.some((r) => r.action === "finance.exchange_rate_unchanged"));
  const last = audit.filter((r) => r.action === "finance.exchange_rate_set").at(-1)!;
  assert.deepEqual(
    [last.data.aedPerUsd, last.data.previousAedPerUsd, last.data.previousRevision, last.data.source, last.data.usageStatementsAtOtherRate],
    [3.7, 3.68, 2, "Synthetic central bank rate", 1],
  );
});

test("the usage markup and who pays for complimentary members are settings whose defaults keep today's charge", async () => {
  const owner = await f.person({ name: "Owner Usage Settings" });
  await costs(owner.tenantId, [
    { task: "coaching", status: "recorded", cost: 1, estimate: 1, at: "2026-04-05T10:00:00Z" },
    { task: "coaching", status: "recorded", cost: 1, estimate: 1, at: "2026-04-06T10:00:00Z", complimentary: true },
  ]);
  const usage = (config: Record<string, string>) =>
    withRuntimeConfig(config, () =>
      f.db.tenant(finance(owner), (tx) => periodUsage(tx, "2026-04", 4)),
    );
  const today = await usage({});
  assert.deepEqual([today.chargeableUsd, today.chargeMinor, today.platformBorneUsd], ["2.00000000", 800, "0.00000000"]);
  const markup = await usage({ FINANCE_USAGE_MARKUP_PERCENT: "10" });
  assert.equal(markup.chargeMinor, 880);
  const platform = await usage({ FINANCE_COMPLIMENTARY_USAGE_BEARER: "platform" });
  assert.deepEqual([platform.chargeableUsd, platform.chargeMinor, platform.platformBorneUsd], ["1.00000000", 400, "1.00000000"]);
  assert.throws(() => validateIntegrationValues("platform_finance", { FINANCE_USD_TO_AED: "20" }), /between 1 and 10/);
  assert.throws(() => validateIntegrationValues("platform_finance", { FINANCE_USAGE_MARKUP_PERCENT: "150" }), /0 to 100/);
  assert.throws(() => validateIntegrationValues("platform_finance", { FINANCE_COMPLIMENTARY_USAGE_BEARER: "member" }), /unsupported selection/);
  assert.throws(() => validateIntegrationValues("model", { MODEL_PROVIDER: "Open AI!" }), /short name/);
});

test("a provider's month is priced from its usage total across workspaces, in proportion to the estimates", async () => {
  const admin = await f.operator("admin");
  const stale = await f.operator("admin", false);
  const one = await f.person({ name: "Owner Provider One" });
  const two = await f.person({ name: "Owner Provider Two" });
  const [estimatedOne, unknownOne, , , noEstimate] = await costs(one.tenantId, [
    { task: "voice.session", provider: "cartesia", status: "estimated", cost: 0.3, estimate: 0.3, at: "2026-06-03T10:00:00Z" },
    { task: "voice.transcription", provider: "cartesia", status: "unknown", estimate: 0.1, at: "2026-06-04T10:00:00Z" },
    { task: "voice.clone", provider: "cartesia", status: "recorded", cost: 0.05, estimate: 0.05, at: "2026-06-05T10:00:00Z" },
    { task: "voice.session", provider: "elevenlabs", status: "estimated", cost: 0.2, estimate: 0.2, at: "2026-06-05T10:00:00Z" },
    { task: "voice.session", provider: "cartesia", status: "unknown", at: "2026-06-06T10:00:00Z" },
  ]);
  const [estimatedTwo] = await costs(two.tenantId, [
    { task: "voice.guidance", provider: "cartesia", status: "estimated", cost: 0.6, estimate: 0.6, at: "2026-06-07T10:00:00Z" },
  ]);
  // Workspace two was already charged for June at the estimates.
  await f.db.tenant(finance(two), (tx) =>
    postUsageStatement(tx, finance(two), {
      period: "2026-06",
      fxAedPerUsd: 3.6725,
      chargeMinor: 220,
      feeScheduleVersion: "fixture-v1",
      evidenceReference: "Synthetic usage evidence",
    }),
  );
  const preview = async (reference?: string) => {
    const r = await f.call(
      "/admin/finance/provider-usage?period=2026-06&provider=Cartesia" +
        (reference ? "&invoiceReference=" + reference : ""),
      { cookie: admin.cookie },
    );
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  assert.equal(
    (await f.call("/admin/finance/provider-usage?period=2026-06&provider=cartesia", { cookie: stale.cookie })).json().code,
    "MFA_STEP_UP",
  );
  // The provider list for the month (for the screen's selector).
  const listed = await f.call("/admin/finance/provider-usage/providers?period=2026-06", { cookie: admin.cookie });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.ok(listed.json().providers.some((p: any) => p.provider === "cartesia" && p.workspaces >= 2));
  // The provider name is matched case-insensitively.
  const p = await preview();
  assert.deepEqual(
    [p.provider, p.adjustableRows, p.adjustableEstimateUsd, p.fixedRows, p.fixedUsd, p.withoutEstimate, p.usageStatementsPosted],
    ["cartesia", 3, "1.00000000", 1, "0.05000000", 1, 1],
  );
  const price = (body: Record<string, unknown>) =>
    f.call("/admin/finance/provider-usage/price", {
      cookie: admin.cookie,
      body: {
        period: "2026-06",
        provider: "cartesia",
        usageTotalUsd: "1.75",
        invoiceReference: "INV-CARTESIA-2026-06",
        evidenceReference: "Synthetic provider usage report",
        expectedRows: 3,
        expectedEstimateUsd: "1.00000000",
        ...body,
      },
    });
  // The total also covers the call with no estimate: pricing waits until it
  // is reconciled, so its cost is never counted twice.
  const blocked = await price({});
  assert.equal(blocked.json().code, "ROWS_WITHOUT_ESTIMATE", blocked.body);
  assert.equal((await row(one.tenantId, estimatedOne)).status, "estimated");
  await f.db.tenant(finance(one), (tx) =>
    reconcileModelUsage(tx, finance(one), noEstimate, {
      costUsd: "0.2",
      providerRequestId: "invoice-line-no-estimate",
      evidenceReference: "Provider invoice line fixture",
    }),
  );
  const ready = await preview();
  assert.deepEqual(
    [ready.adjustableRows, ready.fixedRows, ready.fixedUsd, ready.withoutEstimate],
    [3, 2, "0.25000000", 0],
  );
  assert.equal((await price({ expectedRows: 2 })).json().code, "PREVIEW_CHANGED");
  assert.equal((await price({ usageTotalUsd: "0.01" })).json().code, "TOTAL_BELOW_PRICED");
  // A mistyped total far from the estimates needs an explicit confirmation.
  const typo = await price({ usageTotalUsd: "150.25" });
  assert.equal(typo.json().code, "FACTOR_REVIEW_REQUIRED", typo.body);
  const month = new Date().toISOString().slice(0, 7);
  assert.equal((await price({ period: month })).json().code, "PERIOD_OPEN");
  const r = await price({});
  assert.equal(r.statusCode, 200, r.body);
  // 1.75 less the 0.25 already priced = 1.50 over estimates of 1.00.
  assert.deepEqual(
    [r.json().priced, r.json().allocatedUsd, r.json().allocatedThisRunUsd, r.json().allocatedTotalUsd, r.json().factor, r.json().usageStatementsPosted],
    [3, "1.50000000", "1.50000000", "1.50000000", 1.5, 1],
  );
  assert.ok(r.json().note);
  // Workspace two was charged 0.6 USD (220 fils); its priced usage is now
  // 0.9 USD (331 fils): the difference is reported, not charged.
  assert.deepEqual(
    r.json().chargedWorkspaces.map((w: any) => [w.tenantId, w.chargeMinor, w.currentChargeableUsd, w.currentChargeMinor, w.differenceMinor]),
    [[two.tenantId, 220, "0.90000000", 331, 111]],
  );
  const after = await Promise.all([
    row(one.tenantId, estimatedOne),
    row(one.tenantId, unknownOne),
    row(two.tenantId, estimatedTwo),
  ]);
  assert.deepEqual(
    after.map((x) => [x.status, Number(x.cost_usd), Number(x.estimated_cost_usd), x.reconciliation.invoiceReference]),
    [
      ["reconciled", 0.45, 0.3, "INV-CARTESIA-2026-06"],
      ["reconciled", 0.15, 0.1, "INV-CARTESIA-2026-06"],
      ["reconciled", 0.9, 0.6, "INV-CARTESIA-2026-06"],
    ],
  );
  assert.equal(after[1].reconciliation.previousStatus, "unknown");
  // The provider's month now equals its invoice: nothing counted twice.
  const monthTotal = async () => {
    let total = 0;
    for (const t of [one, two])
      for (const x of await f.db.tenant(finance(t), (tx) =>
        tx.query("SELECT coalesce(sum(cost_usd),0)::text AS usd FROM cost_events WHERE provider='cartesia' AND created_at>='2026-06-01' AND created_at<'2026-07-01'"),
      ))
        total += Number(x.usd);
    return Math.round(total * 1e8) / 1e8;
  };
  assert.equal(await monthTotal(), 1.75);
  // Audited before and after, and each changed workspace has its own event.
  const audit = await f.db.system((tx) =>
    tx.query(
      "SELECT action,data FROM admin_operations_audit WHERE actor_id=$1 AND action LIKE 'finance.provider_usage_pric%' ORDER BY created_at",
      [admin.userId],
    ),
  );
  assert.ok(audit.some((x) => x.action === "finance.provider_usage_pricing_started" && x.data.evidenceReference));
  const done = audit.find((x) => x.action === "finance.provider_usage_priced")!;
  assert.equal(done.data.allocatedTotalUsd, "1.50000000");
  assert.deepEqual(done.data.workspaces.map((w: any) => w.tenantId).sort(), [one.tenantId, two.tenantId].sort());
  const [workspaceEvent] = await f.db.tenant(finance(one), (tx) =>
    tx.query("SELECT data FROM events WHERE name='finance.provider_usage_priced'"),
  );
  assert.deepEqual([workspaceEvent.data.rows, workspaceEvent.data.allocatedUsd], [2, "0.60000000"]);
  // A preview with the reference shows the calls it priced, so re-running
  // with the same reference continues (nothing left to price); a preview
  // without it shows nothing left to price.
  assert.equal((await preview()).adjustableRows, 0);
  const resumed = await preview("INV-CARTESIA-2026-06");
  assert.deepEqual([resumed.adjustableRows, resumed.pricedByReference], [3, 3]);
  const again = await price({});
  assert.equal(again.statusCode, 200, again.body);
  assert.deepEqual([again.json().priced, again.json().alreadyPriced], [0, 3]);
  assert.equal((await price({ usageTotalUsd: "2.00" })).json().code, "INVOICE_CONFLICT");
  // A call estimated after the reference was used cannot join that run: its
  // shares were already written for the calls it saw.
  await costs(two.tenantId, [
    { task: "voice.guidance", provider: "cartesia", status: "estimated", cost: 0.1, estimate: 0.1, at: "2026-06-20T10:00:00Z" },
  ]);
  const grown = await price({ expectedRows: 4, expectedEstimateUsd: "1.10000000" });
  assert.equal(grown.json().code, "REFERENCE_SCOPE_CHANGED", grown.body);
  // The other provider's row is untouched.
  const other = await f.db.tenant(f.scoped(one.tenantId, "finance"), (tx) =>
    tx.query("SELECT status FROM cost_events WHERE provider='elevenlabs'"),
  );
  assert.deepEqual(other, [{ status: "estimated" }]);
  // Exact decimal helpers.
  assert.equal(usdText(usdUnits("1.23456789")), "1.23456789");
  assert.equal(usdText(usdUnits("0.000000005")), "0.00000001");
});

test("provider pricing shares add up exactly to the amount spread", async () => {
  const admin = await f.operator("admin");
  const one = await f.person({ name: "Owner Rounding One" });
  const two = await f.person({ name: "Owner Rounding Two" });
  const rows = [
    ...(await costs(one.tenantId, [
      { task: "voice.session", provider: "rounding-fixture", status: "estimated", cost: 0.1, estimate: 0.1, at: "2026-01-10T10:00:00Z" },
      { task: "voice.session", provider: "rounding-fixture", status: "estimated", cost: 0.1, estimate: 0.1, at: "2026-01-11T10:00:00Z" },
    ])).map((id) => [one.tenantId, id]),
    ...(await costs(two.tenantId, [
      { task: "voice.session", provider: "rounding-fixture", status: "estimated", cost: 0.1, estimate: 0.1, at: "2026-01-12T10:00:00Z" },
    ])).map((id) => [two.tenantId, id]),
  ];
  const r = await f.call("/admin/finance/provider-usage/price", {
    cookie: admin.cookie,
    body: {
      period: "2026-01",
      provider: "rounding-fixture",
      usageTotalUsd: "0.2",
      invoiceReference: "INV-ROUNDING-2026-01",
      evidenceReference: "Synthetic provider usage report",
      expectedRows: 3,
      expectedEstimateUsd: "0.3",
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual([r.json().allocatedUsd, r.json().allocatedThisRunUsd], ["0.20000000", "0.20000000"]);
  let sum = 0n;
  for (const [tenantId, id] of rows) sum += usdUnits((await row(tenantId, id)).cost_usd);
  assert.equal(usdText(sum), "0.20000000");
});

test("automatic month close waits for unresolved usage by default, estimates it only when turned on, and a re-run after a correction or a new rate keeps the posted charge and reaches the payout", async () => {
  const owner = await f.person({ name: "Owner Automation Estimate" });
  const operator = await f.operator("finance");
  const [answered, unknown] = await costs(owner.tenantId, [
    { task: "voice.session", provider: "cartesia", status: "estimated", cost: 0.5, estimate: 0.5, at: "2026-07-10T10:00:00Z" },
    { task: "voice.guidance", provider: "cartesia", status: "unknown", estimate: 0.5, at: "2026-07-11T10:00:00Z" },
  ]);
  // Earnings before July's cutoff, funded, so a payout can be prepared.
  await post(owner.tenantId, "fixture-earning:2026-07", "2026-07-15T10:00:00Z", [
    ["bank_cash", 5000],
    ["trainer_payable", -5000],
  ]);
  await f.db.tenant(finance(owner), (tx) =>
    tx.query(
      "INSERT INTO records(id,tenant_id,kind,data,status) VALUES($1,$2,'beneficiary',$3,'verified')",
      [randomUUID(), owner.tenantId, JSON.stringify({ name: "Synthetic payee", providerId: "ben_fixture", holdUntil: "2020-01-01T00:00:00.000Z" })],
    ),
  );
  const a = {
    tenantId: owner.tenantId,
    userId: operator.userId,
    role: "finance",
    elevation: "platform-operator" as const,
  };
  const config = await f.db.tenant(a, (tx) =>
    configureFinanceAutomation(tx, a, {
      revision: 0,
      enabled: true,
      reconcileStripe: false,
      closeMonthly: true,
      preparePayouts: true,
      executePayouts: true,
      // A cap below the payout: the run stops before any bank call, as a
      // real run blocked by the cap or the bank contract would.
      maxPayoutMinor: 1,
      fxAedPerUsd: 3.6725,
      fxEvidence: "Central bank reference rate fixture",
      reason: "Reviewed synthetic automation fixture",
    }),
  );
  const job = {
    kind: "finance_monthly",
    data: { period: "2026-07", configVersion: config.version },
  };
  // Default (today's behaviour): the unresolved call blocks the month.
  await assert.rejects(
    executeFinanceJob(f.db, owner.tenantId, job),
    (e: any) => e.code === "USAGE_UNRECONCILED",
  );
  assert.equal((await row(owner.tenantId, unknown)).status, "unknown");
  const on = { FINANCE_ESTIMATE_UNRESOLVED_USAGE: "true" };
  const result: any = await withRuntimeConfig(on, () =>
    executeFinanceJob(f.db, owner.tenantId, job),
  );
  assert.deepEqual([result.status, result.code], ["blocked", "PAYOUT_CAP_EXCEEDED"]);
  const estimated = await row(owner.tenantId, unknown);
  assert.deepEqual(
    [estimated.status, Number(estimated.cost_usd), estimated.reconciliation.method],
    ["estimated", 0.5, "automatic_estimate"],
  );
  const statement = async () =>
    (
      await f.db.tenant(finance(owner), (tx) =>
        tx.query("SELECT * FROM usage_statements WHERE period='2026-07'"),
      )
    )[0];
  // 1 USD at the automation's approved rate: no reviewed rate for July.
  const first = await statement();
  assert.deepEqual([Number(first.charge_minor), first.cost_event_count], [367, 2]);
  const payouts = async () =>
    f.db.tenant(finance(owner), (tx) =>
      tx.query("SELECT id,status FROM payouts WHERE period='2026-07'"),
    );
  const [payout] = await payouts();
  assert.equal(payout.status, "ready");
  // The invoice corrects the answered call after the charge: the correction
  // is recorded against the statement, never charged here.
  const corrected: any = await f.db.tenant(finance(owner), (tx) =>
    reconcileModelUsage(tx, finance(owner), answered, {
      costUsd: "0.8",
      providerRequestId: "invoice-line-after-charge",
      evidenceReference: "Provider invoice line fixture",
    }),
  );
  assert.deepEqual(
    [corrected.correctionAfterCharge.period, corrected.correctionAfterCharge.previousCostUsd, corrected.correctionAfterCharge.statementChargeMinor],
    ["2026-07", "0.50000000", 367],
  );
  // Re-run after the correction: the posted statement is kept and the run
  // reaches the same payout (blocked by the cap again, not by the usage).
  const rerun: any = await withRuntimeConfig(on, () =>
    executeFinanceJob(f.db, owner.tenantId, job),
  );
  assert.deepEqual([rerun.status, rerun.code], ["blocked", "PAYOUT_CAP_EXCEEDED"]);
  assert.equal(Number((await statement()).charge_minor), 367);
  // A reviewed rate recorded for July after the charge: the re-run still
  // keeps the posted statement.
  const fin = await f.operator("finance");
  const rate = await f.call("/admin/finance/exchange-rates", {
    cookie: fin.cookie,
    body: { month: "2026-07", aedPerUsd: 3.7, source: "Synthetic central bank rate", acknowledgePostedStatements: true },
  });
  assert.equal(rate.statusCode, 200, rate.body);
  const third: any = await executeFinanceJob(f.db, owner.tenantId, job);
  assert.deepEqual([third.status, third.code], ["blocked", "PAYOUT_CAP_EXCEEDED"]);
  const kept = await statement();
  assert.deepEqual([Number(kept.charge_minor), Number(kept.fx_aed_per_usd)], [367, 3.6725]);
  assert.deepEqual((await payouts()).map((x: any) => x.id), [payout.id]);
  const [close] = await f.db.tenant(finance(owner), (tx) =>
    tx.query("SELECT status FROM records WHERE kind='close' AND data->>'period'='2026-07'"),
  );
  assert.equal(close.status, "closed");
});

test("a month-close run at a reviewed rate other than the approved one records the override", async () => {
  const owner = await f.person({ name: "Owner Automation Rate" });
  const operator = await f.operator("finance");
  await costs(owner.tenantId, [
    { task: "coaching", provider: "openai", status: "recorded", cost: 1, estimate: 1, at: "2026-08-20T10:00:00Z" },
  ]);
  await f.db.system((tx) =>
    tx.query(
      "INSERT INTO exchange_rates(id,month,revision,aed_per_usd,source,reviewed_by) SELECT $1,'2026-08',coalesce(max(revision),0)+1,3.7,'Synthetic reviewed rate',$2 FROM exchange_rates WHERE month='2026-08'",
      [randomUUID(), operator.userId],
    ),
  );
  const a = {
    tenantId: owner.tenantId,
    userId: operator.userId,
    role: "finance",
    elevation: "platform-operator" as const,
  };
  const config = await f.db.tenant(a, (tx) =>
    configureFinanceAutomation(tx, a, {
      revision: 0,
      enabled: true,
      reconcileStripe: false,
      closeMonthly: true,
      preparePayouts: false,
      executePayouts: false,
      maxPayoutMinor: 0,
      fxAedPerUsd: 3.6725,
      fxEvidence: "Central bank reference rate fixture",
      reason: "Reviewed synthetic automation fixture",
    }),
  );
  const result: any = await executeFinanceJob(f.db, owner.tenantId, {
    kind: "finance_monthly",
    data: { period: "2026-08", configVersion: config.version },
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.rate, { aedPerUsd: 3.7, source: "reviewed" });
  assert.deepEqual(
    [result.rateOverride.approvedAedPerUsd, result.rateOverride.reviewedAedPerUsd],
    [3.6725, 3.7],
  );
  const [e] = await f.db.tenant(finance(owner), (tx) =>
    tx.query("SELECT data FROM events WHERE name='finance.automation_rate_override'"),
  );
  assert.equal(e.data.period, "2026-08");
});

test("a voice call that fails before it is sent costs nothing; one sent without an answer stays for the invoice", async () => {
  const owner = await f.person({ name: "Owner Voice Not Sent" });
  const a = f.scoped(owner.tenantId, "owner");
  const reserve = async () => {
    const id = randomUUID();
    await f.db.tenant(a, (tx) =>
      reserveVoiceCost(tx, {
        id,
        tenantId: owner.tenantId,
        userId: owner.userId,
        memberId: null,
        task: "voice.session",
        provider: "cartesia",
        model: "sonic-fixture",
        priceVersion: "voice-v1",
        pricing: { basis: "characters", characters: 40, reservedCostUsd: 0.002 },
        traceId: "clip-not-sent",
      }),
    );
    return id;
  };
  const notSent = await reserve();
  const sent = await reserve();
  await f.db.tenant(a, (tx) =>
    tx.query("UPDATE cost_events SET status='unknown' WHERE id=$1", [sent]),
  );
  await f.db.tenant(a, async (tx) => {
    await costNotSent(tx, notSent);
    await costNotSent(tx, sent);
  });
  const released = await row(owner.tenantId, notSent);
  assert.deepEqual(
    [released.status, Number(released.cost_usd), released.pricing.released],
    ["recorded", 0, "not_sent"],
  );
  const pending = await row(owner.tenantId, sent);
  assert.deepEqual([pending.status, pending.cost_usd], ["unknown", null]);
});

test("metrics and statements show products, disputes, recovered and absorbed costs, domains, estimated and complimentary cost", async () => {
  const fin = await f.operator("finance");
  const owner = await f.person({ name: "Owner Metrics Split" });
  const member = await f.person({ tenantId: owner.tenantId, role: "subscriber" });
  const at = "2026-02-10T10:00:00Z";
  const before = await computeBusinessMetrics(f.db, { ...fin, role: "finance" }, {
    months: 1,
    now: new Date("2026-02-20T12:00:00Z"),
  });
  const charge = (source: string, gross: number, data: Record<string, unknown> = {}) =>
    post(owner.tenantId, source, at, [
      ["stripe_receivable", gross],
      ["trainer_payable", -(gross - gross / 5)],
      ["platform_commission", -(gross / 5)],
    ], { userId: member.userId, grossMinor: gross, commissionMinor: gross / 5, ...data });
  await charge("stripe-invoice:ms1", 10000);
  await charge("stripe-invoice:va1", 2000, { purpose: "voice_addon" });
  await charge("stripe-programme:pg1", 30000, { purpose: "programme" });
  await charge("booking-charge:bk1", 5000);
  await post(owner.tenantId, "dispute-reserve:dp1", at, [["trainer_payable", 4000], ["dispute_reserve", -4000]]);
  await post(owner.tenantId, "dispute-resolution:dp1", at, [
    ["dispute_reserve", 4000],
    ["stripe_receivable", -4000],
    ["platform_commission", 800],
    ["trainer_payable", -800],
  ]);
  await post(owner.tenantId, "usage:2026-01", at, [["trainer_payable", 300], ["platform_cost_recovery", -300]]);
  await post(owner.tenantId, "allocated-cost:al1", at, [["trainer_payable", 700], ["platform_cost_recovery", -700]]);
  await post(owner.tenantId, "web-address-invoice:in1", at, [["web_address_receivable", 9000], ["web_address_revenue", -9000]], { grossMinor: 9000 });
  await post(owner.tenantId, "web-address-refund:re1", at, [["web_address_revenue", 9000], ["web_address_receivable", -9000]], { refundAmountMinor: 9000 });
  await post(owner.tenantId, "web-address-refund-reversal:re1", at, [["web_address_revenue", -9000], ["web_address_receivable", 9000]], { refundAmountMinor: 9000 });
  await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query(
      "INSERT INTO records(id,tenant_id,kind,data,status) VALUES($1,$2,'cost_allocation',$3,'posted')",
      [randomUUID(), owner.tenantId, JSON.stringify({ period: "2026-02", amountMinor: 2500, chargeTrainer: false, category: "infrastructure" })],
    ),
  );
  await costs(owner.tenantId, [
    { task: "voice.session", provider: "cartesia", status: "estimated", cost: 0.4, estimate: 0.4, at },
    { task: "coaching", provider: "openai", status: "recorded", cost: 0.25, estimate: 0.25, at, complimentary: true },
    { task: "voice_session_suggestions", provider: "openai", status: "recorded", cost: 0.05, estimate: 0.05, at },
    { task: "voice.transcription", provider: "cartesia", status: "unknown", estimate: 0.02, at },
    // An AI call whose lost answer was estimated: AI, never shown as voice.
    { task: "coaching", provider: "openai", status: "estimated", cost: 0.1, estimate: 0.1, at },
  ]);
  const r = await computeBusinessMetrics(f.db, { ...fin, role: "finance" }, {
    months: 1,
    now: new Date("2026-02-20T12:00:00Z"),
  });
  const d = (key: keyof (typeof r.series)[number]) =>
    Math.round(((r.series[0][key] as number) - (before.series[0][key] as number)) * 10000) / 10000;
  assert.deepEqual(
    [d("membershipGrossMinor"), d("voiceAddOnGrossMinor"), d("programmeGrossMinor"), d("bookingGrossMinor"), d("subscriptionGrossMinor")],
    [10000, 2000, 30000, 5000, 42000],
  );
  assert.deepEqual([d("disputesOpenedMinor"), d("disputeLossesMinor")], [4000, 4000]);
  assert.deepEqual([d("usageRecoveryMinor"), d("allocatedRecoveryMinor"), d("costRecoveryMinor"), d("absorbedCostsMinor")], [300, 700, 1000, 2500]);
  // Domains stay in the currency they were journaled in (AED here); none of
  // it is in US cents.
  assert.deepEqual([d("domainPaymentsAedMinor"), d("domainRefundsAedMinor"), d("domainNetSalesAedMinor")], [9000, 0, 9000]);
  assert.deepEqual([d("domainPaymentsUsdCents"), d("domainRefundsUsdCents"), d("domainNetSalesUsdCents")], [0, 0, 0]);
  // voice_session_suggestions is a model call: AI, not voice. The estimated
  // part is split between AI and voice.
  assert.deepEqual(
    [d("aiCostUsd"), d("voiceCostUsd"), d("estimatedAiCostUsd"), d("estimatedVoiceCostUsd"), d("unpricedRequests"), d("unpricedEstimateUsd"), d("complimentaryCostUsd")],
    [0.4, 0.4, 0.1, 0.4, 1, 0.02, 0.25],
  );
  const header = metricsCsv(r).split("\n")[0].split(",");
  for (const field of ["membershipGrossMinor", "disputeLossesMinor", "absorbedCostsMinor", "domainNetSalesAedMinor", "domainNetSalesUsdCents", "estimatedAiCostUsd", "estimatedVoiceCostUsd", "aedPerUsd", "fxSource", "usageChargedAtOtherRate"])
    assert.ok(header.includes(field), field);
  // The operator statement shows the same month by product, with disputes,
  // domains (refund reversed) and usage by feature at the month's rate.
  const s = await f.db.tenant(
    { tenantId: owner.tenantId, userId: fin.userId, role: "finance", elevation: "platform-operator" },
    (tx) => financialStatement(tx, "2026-02", { platformView: true, rate: { month: "2026-02", aedPerUsd: 3.6725, source: "default", revision: null, note: null, reviewedAt: null } }),
  );
  assert.deepEqual(s.revenue, { membershipMinor: 10000, programmeMinor: 30000, voiceAddOnMinor: 2000, sessionsMinor: 5000 });
  assert.deepEqual(s.disputes, { openedMinor: 4000, releasedMinor: 0, lostMinor: 4000 });
  assert.deepEqual([s.webAddresses.paymentsMinor, s.webAddresses.refundsMinor], [9000, 0]);
  assert.deepEqual(
    [s.usageCost.costUsd, s.usageCost.estimatedUsd, s.usageCost.unpricedCalls, s.usageCost.complimentaryUsd, s.usageCost.costAedMinor],
    [0.8, 0.5, 1, 0.25, 294],
  );
});

test("a domain refund that fails after it was journaled is reversed once, and a late pending snapshot does not re-post it", async () => {
  const owner = await f.person({ name: "Owner Domain Refund" });
  const orderId = randomUUID();
  await f.db.tenant(f.scoped(owner.tenantId, "owner"), (tx) =>
    tx.query(
      "INSERT INTO domain_orders(id,tenant_id,hostname,status,token,quote,mode,registrar) VALUES($1,$2,$3,'active',$4,$5,'automatic','namecheap')",
      [orderId, owner.tenantId, "refund-" + orderId.slice(0, 8) + ".example", randomUUID(), JSON.stringify({ priceMinor: 9000 })],
    ),
  );
  await post(owner.tenantId, "web-address-invoice:in_refund", new Date().toISOString(), [
    ["web_address_receivable", 9000],
    ["web_address_revenue", -9000],
  ], { orderId, kind: "registration", grossMinor: 9000, paymentIntentId: "pi_refund_fixture" });
  const metadata = { purpose: "web_address", tenant_id: owner.tenantId, web_address_order_id: orderId };
  const refundEvent = (type: string, id: string, status: string) =>
    processWebAddressStripeEvent(f.db, {
      id: "evt_" + randomUUID(),
      type,
      data: {
        object: {
          id,
          object: "refund",
          status,
          amount: 9000,
          currency: "aed",
          payment_intent: "pi_refund_fixture",
          failure_reason: status === "failed" ? "expired_or_canceled_card" : undefined,
          metadata,
        },
      },
    });
  const journals = async () =>
    (
      await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
        tx.query("SELECT source_key FROM journals WHERE source_key LIKE 'web-address-refund%'"),
      )
    ).sort((x, y) => (x.source_key < y.source_key ? -1 : 1));
  assert.equal(await refundEvent("refund.created", "re_fail_fixture", "pending"), true);
  assert.deepEqual((await journals()).map((j) => j.source_key), ["web-address-refund:re_fail_fixture"]);
  await refundEvent("refund.updated", "re_fail_fixture", "failed");
  await refundEvent("refund.updated", "re_fail_fixture", "failed");
  assert.deepEqual((await journals()).map((j) => j.source_key), [
    "web-address-refund-reversal:re_fail_fixture",
    "web-address-refund:re_fail_fixture",
  ]);
  const balances = await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query("SELECT account,sum(amount_minor)::int AS n FROM journal_lines WHERE account LIKE 'web_address%' GROUP BY 1 ORDER BY 1"),
  );
  assert.deepEqual(balances, [
    { account: "web_address_receivable", n: 9000 },
    { account: "web_address_revenue", n: -9000 },
  ]);
  const [order] = await f.db.tenant(f.scoped(owner.tenantId, "owner"), (tx) =>
    tx.query("SELECT attention FROM domain_orders WHERE id=$1", [orderId]),
  );
  assert.match(order.attention, /re_fail_fixture\) failed.*reversed/);
  // The reversal is in the refund journal's own currency.
  const currencies = await f.db.tenant(f.scoped(owner.tenantId, "finance"), (tx) =>
    tx.query("SELECT source_key,currency,data->>'currency' AS recorded FROM journals WHERE source_key LIKE 'web-address-refund%re_fail_fixture' ORDER BY source_key"),
  );
  assert.deepEqual(
    currencies.map((j) => [j.currency, j.recorded]),
    [["AED", "AED"], ["AED", null]],
  );
  // Out of order: the failure arrives before the pending snapshot, before a
  // succeeded snapshot, and before a charge.refunded payload listing it.
  await refundEvent("refund.updated", "re_late_fixture", "canceled");
  await refundEvent("refund.created", "re_late_fixture", "pending");
  await refundEvent("refund.updated", "re_late_fixture", "succeeded");
  await processWebAddressStripeEvent(f.db, {
    id: "evt_" + randomUUID(),
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_refund_fixture",
        object: "charge",
        payment_intent: "pi_refund_fixture",
        metadata,
        refunds: {
          data: [
            { id: "re_late_fixture", object: "refund", status: "succeeded", amount: 9000, payment_intent: "pi_refund_fixture", metadata },
          ],
        },
      },
    },
  });
  assert.equal((await journals()).filter((j) => j.source_key.includes("re_late_fixture")).length, 0);
  const period = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const statement = await f.db.tenant(
    { tenantId: owner.tenantId, userId: owner.userId, role: "owner" },
    (tx) => financialStatement(tx, period),
  );
  assert.deepEqual([statement.webAddresses.paymentsMinor, statement.webAddresses.refundsMinor], [9000, 0]);
});

test("trainer business analytics reads revenue from the journals payments post", async () => {
  const owner = await f.person({ name: "Owner Analytics Revenue" });
  const at = new Date().toISOString();
  const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  await post(owner.tenantId, "stripe-invoice:an1", at, [["stripe_receivable", 10000], ["trainer_payable", -8000], ["platform_commission", -2000]], { grossMinor: 10000, commissionMinor: 2000 });
  await post(owner.tenantId, "stripe-invoice:an2", at, [["stripe_receivable", 3000], ["trainer_payable", -2400], ["platform_commission", -600]], { grossMinor: 3000, commissionMinor: 600, purpose: "voice_addon" });
  await post(owner.tenantId, "stripe-programme:an3", at, [["stripe_receivable", 20000], ["trainer_payable", -16000], ["platform_commission", -4000]], { grossMinor: 20000, commissionMinor: 4000 });
  await post(owner.tenantId, "booking-charge:an4", at, [["stripe_receivable", 5000], ["trainer_payable", -5000]], { grossMinor: 5000, commissionMinor: 0 });
  await post(owner.tenantId, "stripe-refund:an5", at, [["stripe_receivable", -10000], ["trainer_payable", 8000], ["platform_commission", 2000]], { refundAmountMinor: 10000, commissionReversalMinor: 2000 });
  await post(owner.tenantId, "usage:2026-01", at, [["trainer_payable", 100], ["platform_cost_recovery", -100]]);
  await post(owner.tenantId, "payout:an6", at, [["trainer_payable", 1000], ["bank_cash", -1000]]);
  const revenue = await f.db.tenant(
    { tenantId: owner.tenantId, userId: owner.userId, role: "owner" },
    trainerRevenue,
  );
  assert.deepEqual(revenue, [
    {
      month,
      gross_minor: 38000,
      memberships_minor: 10000,
      programmes_minor: 20000,
      voice_add_on_minor: 3000,
      sessions_minor: 5000,
      refunds_minor: 10000,
      platform_commission_minor: 4600,
      earned_minor: 23400,
      usage_and_fees_minor: 100,
      paid_out_minor: 1000,
    },
  ]);
  const view = await f.call("/analytics/business", { cookie: owner.cookie });
  assert.equal(view.statusCode, 200, view.body);
  assert.equal(view.json().revenue[0].gross_minor, 38000);
});

test("the Super admin overview shows each trainer's commission, costs charged back and AI and voice cost", async () => {
  const admin = await f.operator("admin");
  const owner = await f.person({ name: "Owner Overview Costs" });
  await post(owner.tenantId, "stripe-invoice:ov1", new Date().toISOString(), [["stripe_receivable", 10000], ["trainer_payable", -8000], ["platform_commission", -2000]], { grossMinor: 10000, commissionMinor: 2000 });
  await post(owner.tenantId, "usage:2026-01", new Date().toISOString(), [["trainer_payable", 150], ["platform_cost_recovery", -150]]);
  await costs(owner.tenantId, [
    { task: "coaching", status: "recorded", cost: 1.25, estimate: 1.25, at: new Date().toISOString() },
    { task: "voice.session", provider: "cartesia", status: "estimated", cost: 0.5, estimate: 0.5, at: new Date().toISOString() },
    { task: "voice.session", provider: "cartesia", status: "unknown", estimate: 0.5, at: new Date().toISOString() },
  ]);
  const r = await f.call("/admin/overview", { cookie: admin.cookie });
  assert.equal(r.statusCode, 200, r.body);
  const t = r.json().tenants.find((x: any) => x.id === owner.tenantId);
  assert.ok(t, "the newest workspace is on the first page");
  assert.equal(t.finance.commissionMinor, 2000);
  assert.equal(-t.finance.accounts.platform_cost_recovery, 150);
  assert.deepEqual(t.costSummary.ai, { requests: 1, costUsd: 1.25, estimatedUsd: 0, unpriced: 0 });
  assert.deepEqual(t.costSummary.voice, { requests: 2, costUsd: 0.5, estimatedUsd: 0.5, unpriced: 1 });
});

test("migration 073 fills the estimate and product of rows written before it", async () => {
  // Every migration up to 072 on a fresh embedded database, rows as the
  // previous release wrote them, then 073.
  const source = fileURLToPath(new URL("../packages/db/migrations/", import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), "finance-073-"));
  const pg = new PGlite();
  const client = {
    query: (sql: string, values?: any[]) => pg.query(sql, values),
    exec: (sql: string) => pg.exec(sql),
  };
  try {
    const files = (await readdir(source)).filter((n) => n.endsWith(".sql")).sort();
    for (const name of files.filter((n) => n < "073"))
      await copyFile(join(source, name), join(directory, name));
    await applyMigrations(client, directory);
    const tenant = randomUUID();
    await pg.query("INSERT INTO tenants(id,slug,name) VALUES($1,'migration-fixture','Migration fixture')", [tenant]);
    const insert = (task: string, status: string, cost: number | null, pricing: unknown) =>
      pg.query(
        "INSERT INTO cost_events(id,tenant_id,task,provider,model,cost_usd,status,pricing,created_at) VALUES($1,$2,$3,'fixture','fixture-model',$4,$5,$6,'2026-06-01T10:00:00Z') RETURNING id",
        [randomUUID(), tenant, task, cost, status, JSON.stringify(pricing)],
      ).then((r: any) => r.rows[0].id as string);
    const voiceReserved = await insert("voice.session", "unknown", null, { basis: "characters", reservedCostUsd: 0.0042 });
    const clonePreview = await insert("voice.preview", "recorded", 0.001, { reservedCostUsd: 0.001 });
    const recordedModel = await insert("coaching", "recorded", 0.0123, {});
    const released = await insert("nutrition_week", "recorded", 0, {});
    const lostModel = await insert("brain_plan", "unknown", null, {});
    for (const name of files.filter((n) => n >= "073"))
      await copyFile(join(source, name), join(directory, name));
    await applyMigrations(client, directory);
    const { rows } = await pg.query<any>(
      "SELECT id,estimated_cost_usd::text AS estimate,product,complimentary,status FROM cost_events",
    );
    const by = new Map(rows.map((r: any) => [r.id, r]));
    assert.deepEqual(
      [voiceReserved, clonePreview, recordedModel, released, lostModel].map((id) => {
        const r: any = by.get(id);
        return [r.estimate, r.product, r.complimentary, r.status];
      }),
      [
        ["0.00420000", "voice_addon", false, "unknown"],
        ["0.00100000", "trainer_setup", false, "recorded"],
        ["0.01230000", "membership", false, "recorded"],
        ["0.00000000", "nutrition", false, "recorded"],
        [null, "membership", false, "unknown"],
      ],
    );
  } finally {
    await pg.close();
    await rm(directory, { recursive: true, force: true });
  }
});
