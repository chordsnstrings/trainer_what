import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  putRecord,
  type Database,
  type Actor,
} from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { newToken, tokenHash } from "../apps/api/src/auth.ts";
import { journal, transitionPayout } from "../apps/api/src/finance.ts";
import {
  configureFinanceAutomation,
  executeFinanceJob,
} from "../apps/api/src/finance-automation.ts";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";

// Every bank request is answered by this in-process fixture, and every Stripe
// event is a local signed-event double; no provider is contacted.
const LEAN = "https://lean.fixture.test";
const leanEnvironment: Record<string, string> = {
  LEAN_BASE_URL: LEAN,
  LEAN_ACCESS_TOKEN: "synthetic-lean-fixture-token",
  LEAN_SOURCE_ACCOUNT_ID: "synthetic-company-account",
  LEAN_CONTRACT_VERIFIED: "true",
  PAYOUTS_APPROVED: "true",
};
const savedEnvironment = Object.fromEntries(
  Object.keys(leanEnvironment).map((key) => [key, process.env[key]]),
);
const originalFetch = globalThis.fetch;
const leanCalls: Array<{ url: string; key: string | null }> = [];
let leanPayments: "accept" | "timeout" = "accept";

const origin = "http://localhost:3000";
let db: Database, app: Awaited<ReturnType<typeof buildApp>>;
let op1: any, op2: any;

async function request(
  url: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
  cookie?: string,
) {
  return app.inject({
    url: "/api/v1" + url,
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    payload: body as any,
  });
}
// Users, workspaces, memberships and sessions are global rows; every tenant
// table below is written through a tenant transaction.
async function register(slug: string) {
  const tenantId = randomUUID(),
    userId = randomUUID(),
    token = newToken();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES($1,$2,$3,'fixture-only',true)",
      [userId, `Coach ${slug}`, `${slug}@example.test`],
    );
    await tx.query(
      "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,$3,true)",
      [tenantId, slug, `Coach ${slug}`],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [tenantId, userId],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
      [tokenHash(token), userId, tenantId],
    );
  });
  return { tenantId, userId, cookie: "session=" + token };
}
async function member(owner: any): Promise<Actor> {
  const a: Actor = {
    tenantId: owner.tenantId,
    userId: randomUUID(),
    role: "subscriber",
  };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Rank member','fixture-only')",
      [a.userId, a.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'subscriber')",
      [a.tenantId, a.userId],
    );
  });
  return a;
}
const actor = (user: any, role = "owner"): Actor => ({
  tenantId: user.tenantId,
  userId: user.userId,
  role,
});
const admin = (tenantId: string, path = "") =>
  `/admin/tenants/${tenantId}/finance${path}`;
/** Funding plus a reviewed close whose eligibility is cumulative, as closeMonth computes it. */
async function fundAndClose(
  owner: any,
  period: string,
  fundingMinor: number,
  eligibleMinor = fundingMinor,
) {
  const a = actor(owner);
  await db.tenant(a, async (tx) => {
    await journal(tx, a, "fixture-funding:" + period, "Synthetic funding", [
      { account: "bank_cash", amount: fundingMinor },
      { account: "trainer_payable", amount: -fundingMinor },
    ]);
    await putRecord(
      tx,
      a,
      "close",
      { period, cutoff: new Date().toISOString(), eligibleMinor },
      { status: "closed" },
    );
  });
}
async function verifiedDestination(owner: any, providerId: string) {
  const a = actor(owner);
  return db.tenant(a, (tx) =>
    putRecord(
      tx,
      a,
      "beneficiary",
      {
        name: "Synthetic payee",
        maskedIban: "AE•••• 0000",
        fingerprint: randomUUID(),
        providerId,
        holdUntil: "2020-01-01T00:00:00.000Z",
      },
      { status: "verified" },
    ),
  );
}
async function payoutsFor(owner: any, period: string) {
  return db.tenant(actor(owner), (tx) =>
    tx.query("SELECT * FROM payouts WHERE period=$1 ORDER BY revision", [
      period,
    ]),
  );
}
const prepare = (owner: any, period: string) =>
  request("/payout-runs/prepare", "POST", { period }, owner.cookie);
const reconcile = (owner: any, id: string, body: any, cookie: string) =>
  request(
    admin(owner.tenantId, `/payouts/${id}/reconcile`),
    "POST",
    body,
    cookie,
  );
const payments = () => leanCalls.filter((c) => c.url.endsWith("/payment"));
const automation = {
  enabled: true,
  reconcileStripe: false,
  closeMonthly: true,
  preparePayouts: true,
  executePayouts: true,
  maxPayoutMinor: 100000,
  fxAedPerUsd: 3.6725,
  fxEvidence: "Central bank reference rate fixture",
  reason: "Reviewed synthetic automation fixture",
};
async function approveAutomation(owner: any, operator: any) {
  const a = { ...actor(operator, "finance"), tenantId: owner.tenantId };
  return db.tenant(a, (tx) =>
    configureFinanceAutomation(tx, a, { ...automation, revision: 0 }),
  );
}
/** A July instruction marked failed on an operator's word only, before provider confirmation existed. */
async function legacyUnconfirmedFailure(owner: any) {
  const a = actor(owner);
  await fundAndClose(owner, "2026-07", 5000);
  const r = await prepare(owner, "2026-07");
  assert.equal(r.statusCode, 200, r.body);
  const first = r.json();
  await db.tenant(a, async (tx) => {
    await transitionPayout(tx, a, first.id, "submitted");
    await transitionPayout(tx, a, first.id, "unknown");
    await transitionPayout(tx, a, first.id, "failed", "operator-said-failed");
  });
  return first;
}

before(async () => {
  Object.assign(process.env, leanEnvironment);
  globalThis.fetch = async (input: any, init: any = {}) => {
    const url = String(input);
    if (!url.startsWith(LEAN + "/"))
      throw new Error("No external request is permitted in this fixture");
    const key = new Headers(init.headers).get("idempotency-key");
    leanCalls.push({ url, key });
    if (url === LEAN + "/payouts/v1/payment")
      return leanPayments === "accept"
        ? Response.json({ id: "pay_" + key, status: "pending" })
        : new Response("gateway timeout", { status: 504 });
    return new Response("not found", { status: 404 });
  };
  db = await createDatabase({ memory: true });
  app = await buildApp({ db, testing: true });
  op1 = await register("fix2-finance-one");
  op2 = await register("fix2-finance-two");
  await db.system(async (tx) => {
    for (const op of [op1, op2]) {
      await tx.query("UPDATE users SET platform_role='finance' WHERE id=$1", [
        op.userId,
      ]);
      await tx.query("UPDATE sessions SET mfa_at=now() WHERE user_id=$1", [
        op.userId,
      ]);
    }
  });
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await app?.close();
  await db?.close();
});

test("fix2:1 an unconfirmed failed instruction blocks preparing a later period's cumulative payout", async () => {
  const owner = await register("fix2-gate-prepare");
  await verifiedDestination(owner, "dest_fix2_gate_prepare");
  const first = await legacyUnconfirmedFailure(owner);
  // August eligibility is cumulative and still includes July's possibly-settled 5000.
  await fundAndClose(owner, "2026-08", 3000, 8000);
  let r = await prepare(owner, "2026-08");
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "PAYOUT_RECONCILIATION_REQUIRED");
  assert.equal((await payoutsFor(owner, "2026-08")).length, 0);

  // An independent provider-confirmed failure releases the obligation.
  r = await reconcile(
    owner,
    first.id,
    {
      status: "failed",
      providerStatus: "not_found",
      bankReference: "NO-DEBIT-FIX2-1",
      evidenceReference: "Provider has no instruction under this key",
    },
    op2.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  r = await prepare(owner, "2026-08");
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(Number(r.json().amount_minor), 8000);
});

test("fix2:1 an unconfirmed failed instruction blocks dispatching an instruction for another period", async () => {
  const owner = await register("fix2-gate-execute");
  await verifiedDestination(owner, "dest_fix2_gate_execute");
  await legacyUnconfirmedFailure(owner);
  await fundAndClose(owner, "2026-08", 3000, 8000);
  // Prepared before the workspace-wide gate existed.
  const id = randomUUID();
  await db.tenant(actor(owner), (tx) =>
    tx.query(
      "INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,revision,prepared_by,status) VALUES($1,$2,'2026-08',8000,'dest_fix2_gate_execute',1,$3,'ready')",
      [id, owner.tenantId, owner.userId],
    ),
  );
  const sent = payments().length;
  const r = await request(
    admin(owner.tenantId, `/payouts/${id}/execute`),
    "POST",
    {},
    op1.cookie,
  );
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "PAYOUT_RECONCILIATION_REQUIRED");
  assert.equal(payments().length, sent);
  assert.equal((await payoutsFor(owner, "2026-08"))[0].status, "ready");
});

test("fix2:1 the monthly automation cannot prepare or dispatch past an unconfirmed failure in another period", async () => {
  const owner = await register("fix2-gate-automation");
  await verifiedDestination(owner, "dest_fix2_gate_automation");
  await legacyUnconfirmedFailure(owner);
  await fundAndClose(owner, "2026-08", 3000, 8000);
  const config = await approveAutomation(owner, op1);
  const sent = payments().length;
  await assert.rejects(
    executeFinanceJob(db, owner.tenantId, {
      kind: "finance_monthly",
      data: { period: "2026-08", configVersion: config.version },
    }),
    (error: any) => error.code === "PAYOUT_RECONCILIATION_REQUIRED",
  );
  assert.equal(payments().length, sent);
  assert.equal((await payoutsFor(owner, "2026-08")).length, 0);
});

test("fix2:4 the automation approver is the dispatcher and cannot confirm that dispatch failed", async () => {
  const owner = await register("fix2-automation-dispatcher");
  await verifiedDestination(owner, "dest_fix2_automation_dispatcher");
  await fundAndClose(owner, "2026-08", 5000);
  const config = await approveAutomation(owner, op1);
  const sent = payments().length;
  leanPayments = "timeout";
  try {
    await assert.rejects(
      executeFinanceJob(db, owner.tenantId, {
        kind: "finance_monthly",
        data: { period: "2026-08", configVersion: config.version },
      }),
    );
  } finally {
    leanPayments = "accept";
  }
  assert.equal(payments().length, sent + 1);
  const [p] = await payoutsFor(owner, "2026-08");
  assert.equal(p.status, "unknown");
  const failed = {
    status: "failed",
    providerStatus: "not_found",
    bankReference: "NO-DEBIT-FIX2-4",
    evidenceReference: "Provider has no instruction under this key",
  };
  let r = await reconcile(owner, p.id, failed, op1.cookie);
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "SEPARATION_OF_DUTIES");
  assert.equal((await payoutsFor(owner, "2026-08"))[0].status, "unknown");
  r = await reconcile(owner, p.id, failed, op2.cookie);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "failed");
  // The dispatch is attributed to the reviewed approval that authorized it.
  const [submitted] = await db.tenant(actor(owner), (tx) =>
    tx.query(
      "SELECT actor_id FROM events WHERE name='payout.submitted' AND subject_id=$1",
      [p.id],
    ),
  );
  assert.equal(submitted.actor_id, op1.userId);
});

test("fix2:5 the dispatcher cannot record a return that permits another instruction", async () => {
  const owner = await register("fix2-return-dispatcher");
  await verifiedDestination(owner, "dest_fix2_return_dispatcher");
  await fundAndClose(owner, "2026-08", 5000);
  let r = await prepare(owner, "2026-08");
  assert.equal(r.statusCode, 200, r.body);
  const first = r.json();
  r = await request(
    admin(owner.tenantId, `/payouts/${first.id}/execute`),
    "POST",
    {},
    op1.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  // Recording settlement does not release the obligation, so the dispatcher may.
  r = await reconcile(
    owner,
    first.id,
    {
      status: "paid",
      bankReference: "BANK-FIX2-PAID-1",
      evidenceReference: "Company bank statement line fixture",
    },
    op1.cookie,
  );
  assert.equal(r.statusCode, 200, r.body);
  const returned = {
    status: "returned",
    bankReference: "BANK-FIX2-RETURN-1",
    evidenceReference: "Company bank statement return line fixture",
  };
  r = await reconcile(owner, first.id, returned, op1.cookie);
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, "SEPARATION_OF_DUTIES");
  assert.equal((await payoutsFor(owner, "2026-08"))[0].status, "paid");
  r = await prepare(owner, "2026-08");
  assert.equal(r.json().id, first.id);

  r = await reconcile(owner, first.id, returned, op2.cookie);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "returned");
  r = await prepare(owner, "2026-08");
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().revision, 2);
});

const now = () => Math.floor(Date.now() / 1000);
// Provider object identities are global, so each run uses its own.
const run = randomUUID().slice(0, 8);
const ref = (name: string) => `${name}_${run}`;
function stripeEvent(a: Actor, type: string, object: any, created: number) {
  return {
    id: "evt_fix2_" + randomUUID(),
    type,
    created,
    data: {
      object: {
        metadata: { tenant_id: a.tenantId, user_id: a.userId },
        ...object,
      },
    },
  };
}
function paidInvoice(
  a: Actor,
  id: string,
  sub: string,
  created: number,
  amount = 10000,
) {
  return stripeEvent(
    a,
    "invoice.paid",
    {
      id,
      object: "invoice",
      subscription: sub,
      ...(amount > 0 ? { charge: "ch_" + id } : {}),
      amount_paid: amount,
      currency: "aed",
      created,
      period_end: now() + 86400,
    },
    created,
  );
}
async function charged(owner: any, invoiceId: string) {
  const [j] = await db.tenant(actor(owner), (tx) =>
    tx.query("SELECT data FROM journals WHERE source_key=$1", [
      "stripe-invoice:" + invoiceId,
    ]),
  );
  return j.data;
}
async function subscription(owner: any, userId: string) {
  const [s] = await db.tenant(actor(owner), (tx) =>
    tx.query("SELECT status,data FROM subscriptions WHERE user_id=$1", [
      userId,
    ]),
  );
  return s;
}

test("fix2:2 commission ranks stay unique when an older first charge is processed late", async () => {
  const owner = await register("fix2-rank-order");
  const a = await member(owner),
    b = await member(owner),
    c = await member(owner),
    t0 = now() - 1000;
  // B's later invoice is processed first; A's older invoice arrives after a retry.
  await processStripeEvent(
    db,
    paidInvoice(b, ref("in_fix2_b"), ref("sub_fix2_b"), t0 + 10),
  );
  await processStripeEvent(
    db,
    paidInvoice(a, ref("in_fix2_a"), ref("sub_fix2_a"), t0),
  );
  await processStripeEvent(
    db,
    paidInvoice(c, ref("in_fix2_c"), ref("sub_fix2_c"), t0 + 20),
  );
  const ranks = [
    (await charged(owner, ref("in_fix2_b"))).rank,
    (await charged(owner, ref("in_fix2_a"))).rank,
    (await charged(owner, ref("in_fix2_c"))).rank,
  ];
  assert.deepEqual(ranks, [1, 2, 3]);
  const stored = await Promise.all(
    [b, a, c].map(async (x) => (await subscription(owner, x.userId)).data),
  );
  assert.deepEqual(
    stored.map((d) => d.commissionRank),
    [1, 2, 3],
  );
});

test("fix2:3 subscribers without a positive charge never take a commission rank", async () => {
  const owner = await register("fix2-rank-evidence");
  const o = actor(owner);
  const ranked = await member(owner),
    legacy = await member(owner),
    trialOnly = await member(owner),
    converted = await member(owner),
    payer = await member(owner),
    t0 = now() - 1000;
  // A payer holding a stored rank, and a legacy payer with a positive charge but no stored rank.
  await db.tenant(o, async (tx) => {
    for (const [who, data] of [
      [
        ranked,
        {
          firstPaidAt: "2024-06-01T00:00:00.000Z",
          commissionRank: 1,
          commissionRankMethod: "stable-first-paid-v1",
        },
      ],
      [legacy, { firstPaidAt: "2025-01-01T00:00:00.000Z" }],
    ] as const) {
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,status,data) VALUES($1,$2,$3,'canceled',$4)",
        [randomUUID(), owner.tenantId, who.userId, JSON.stringify(data)],
      );
      await journal(
        tx,
        o,
        `stripe-invoice:in_fix2_history_${who.userId}`,
        "Subscription payment",
        [
          { account: "stripe_receivable", amount: 10000 },
          { account: "trainer_payable", amount: -7500 },
          { account: "platform_commission", amount: -2500 },
        ],
        { userId: who.userId, grossMinor: 10000 },
      );
    }
  });
  // Two free trials each post a $0 invoice; one cancels without ever paying.
  await processStripeEvent(
    db,
    paidInvoice(trialOnly, ref("in_fix2_trial_t"), ref("sub_fix2_t"), t0, 0),
  );
  await processStripeEvent(
    db,
    stripeEvent(
      trialOnly,
      "customer.subscription.deleted",
      { id: ref("sub_fix2_t"), object: "subscription", status: "canceled" },
      t0 + 5,
    ),
  );
  await processStripeEvent(
    db,
    paidInvoice(
      converted,
      ref("in_fix2_trial_c"),
      ref("sub_fix2_conv"),
      t0 + 1,
      0,
    ),
  );
  const trial = await subscription(owner, trialOnly.userId);
  assert.equal(trial.status, "canceled");
  assert.equal(trial.data.firstPaidAt, undefined);
  assert.equal(trial.data.commissionRank, undefined);

  await processStripeEvent(
    db,
    paidInvoice(payer, ref("in_fix2_payer"), ref("sub_fix2_p"), t0 + 10),
  );
  const first = await charged(owner, ref("in_fix2_payer"));
  assert.equal(first.rank, 3);
  assert.equal(first.commissionBps, 2500);
  // The stored rank is kept; the legacy payer is ranked in first-paid order.
  assert.equal(
    (await subscription(owner, ranked.userId)).data.commissionRank,
    1,
  );
  assert.equal(
    (await subscription(owner, ranked.userId)).data.commissionRankMethod,
    "stable-first-paid-v1",
  );
  assert.equal(
    (await subscription(owner, legacy.userId)).data.commissionRank,
    2,
  );
  assert.equal(
    (await subscription(owner, trialOnly.userId)).data.commissionRank,
    undefined,
  );

  // The converted trial is ranked at its first positive charge.
  await processStripeEvent(
    db,
    paidInvoice(
      converted,
      ref("in_fix2_convert"),
      ref("sub_fix2_conv"),
      t0 + 30,
    ),
  );
  assert.equal((await charged(owner, ref("in_fix2_convert"))).rank, 4);
  assert.equal(
    (await subscription(owner, converted.userId)).data.firstPaidAt,
    new Date((t0 + 30) * 1000).toISOString(),
  );
});
