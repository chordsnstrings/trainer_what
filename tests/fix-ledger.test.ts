import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  putRecord,
  type Database,
  type Actor,
  type Tx,
} from "@trainer/db";
import { withRuntimeConfig } from "@trainer/providers";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import {
  billingHistory,
  currentPaidSubscription,
  registerFinanceBilling,
} from "../apps/api/src/finance-billing.ts";
import {
  createPayout,
  financeSummary,
  recordCharge,
  transitionPayout,
} from "../apps/api/src/finance.ts";
import {
  closeMonth,
  recordStripeDebit,
} from "../apps/api/src/finance-operations.ts";

// Every Stripe interaction in this file is a local double; no key is configured.
const noStripe = { STRIPE_SECRET_KEY: "" };
let db: Database;
before(async () => {
  db = await createDatabase({ memory: true });
});
after(async () => db.close());

async function workspace(): Promise<Actor> {
  const owner: Actor = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    role: "owner",
  };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Ledger owner','fixture-only')",
      [owner.userId, owner.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Ledger fixture')",
      [owner.tenantId, owner.tenantId],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [owner.tenantId, owner.userId],
    );
  });
  return owner;
}
async function member(w: Actor, role = "subscriber"): Promise<Actor> {
  const a: Actor = { tenantId: w.tenantId, userId: randomUUID(), role };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Ledger member','fixture-only')",
      [a.userId, a.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [a.tenantId, a.userId, role],
    );
  });
  return a;
}
const now = () => Math.floor(Date.now() / 1000);
function signed(a: Actor, type: string, object: any, created = now()) {
  return {
    id: "evt_ledger_" + randomUUID(),
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
function invoice(a: Actor, id: string, sub: string, created: number) {
  return signed(
    a,
    "invoice.paid",
    {
      id,
      object: "invoice",
      subscription: sub,
      charge: "ch_" + id,
      amount_paid: 10000,
      currency: "aed",
      created,
      period_end: now() + 86400,
    },
    created,
  );
}
async function charge(owner: Actor, invoiceId: string) {
  const [j] = await db.tenant(owner, (tx) =>
    tx.query("SELECT * FROM journals WHERE source_key=$1", [
      "stripe-invoice:" + invoiceId,
    ]),
  );
  return j;
}
/** HTTP requests read their configuration snapshot from the process environment. */
async function withEnv<T>(
  values: Record<string, string>,
  run: () => Promise<T>,
) {
  const previous = Object.entries(values).map(
    ([key]) => [key, process.env[key]] as const,
  );
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [key, value] of previous)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
/** A journal at an explicit time, for close/cutoff fixtures. Lines must balance. */
async function postAt(
  tx: Tx,
  a: Actor,
  source: string,
  at: string,
  lines: Record<string, number>,
  data: Record<string, unknown> = {},
) {
  const id = randomUUID();
  await tx.query(
    "INSERT INTO journals(id,tenant_id,source_key,description,data,created_at) VALUES($1,$2,$3,'Ledger fixture',$4,$5)",
    [id, a.tenantId, source, JSON.stringify(data), at],
  );
  for (const [account, amount] of Object.entries(lines))
    await tx.query(
      "INSERT INTO journal_lines(id,tenant_id,journal_id,account,amount_minor) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), a.tenantId, id, account, amount],
    );
  return id;
}

test("finance-commerce:G2 a canceled payer's invoice uses its first-paid position, not the 25% band", async () => {
  const owner = await workspace(),
    payer = await member(owner),
    sub = "sub_rank_" + randomUUID();
  // Global users go through the service role; tenant rows through a tenant
  // transaction, as the restricted PostgreSQL runtime role requires.
  const earlier = await db.system((tx) =>
    tx.query(
      "INSERT INTO users(id,email,name,password_hash) SELECT gen_random_uuid(),'rank-'||g||'-'||$1::text||'@example.test','Rank fixture','fixture-only' FROM generate_series(1,100) g RETURNING id",
      [owner.tenantId],
    ),
  );
  await db.tenant(owner, async (tx) => {
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,status,data) SELECT gen_random_uuid(),$1::uuid,u,'active','{\"firstPaidAt\":\"2025-01-01T00:00:00.000Z\"}'::jsonb FROM unnest($2::uuid[]) u",
      [owner.tenantId, earlier.map((row: { id: string }) => row.id)],
    );
    await tx.query(
      "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,data) VALUES($1,$2,$3,$4,'canceled',$5)",
      [
        randomUUID(),
        owner.tenantId,
        payer.userId,
        sub,
        JSON.stringify({
          firstPaidAt: "2026-01-01T00:00:00.000Z",
          lastStripeEventAt: now(),
        }),
      ],
    );
  });
  await processStripeEvent(db, invoice(payer, "in_rank_final", sub, now()));
  const j = await charge(owner, "in_rank_final");
  assert.equal(j.data.rank, 101);
  assert.equal(j.data.commissionBps, 2000);
  assert.equal(j.data.commissionMinor, 2000);
  assert.equal(j.data.rankMethod, "stable-first-paid-v1");
  assert.equal(j.data.firstPaidAt, "2026-01-01T00:00:00.000Z");
  const [s] = await db.tenant(owner, (tx) =>
    tx.query("SELECT status,data FROM subscriptions WHERE user_id=$1", [
      payer.userId,
    ]),
  );
  assert.equal(s.status, "canceled");
  assert.equal(s.data.commissionRank, 101);
});

test("product-roadmap:M5 the commission rank is stored once and survives churn and late invoices", async () => {
  const owner = await workspace(),
    first = await member(owner),
    second = await member(owner),
    later = await member(owner),
    t0 = now() - 1000;
  await processStripeEvent(db, invoice(first, "in_m5_a", "sub_m5_a", t0));
  await processStripeEvent(
    db,
    invoice(second, "in_m5_b1", "sub_m5_b", t0 + 10),
  );
  assert.equal((await charge(owner, "in_m5_a")).data.rank, 1);
  assert.equal((await charge(owner, "in_m5_b1")).data.rank, 2);
  await processStripeEvent(
    db,
    signed(
      first,
      "customer.subscription.deleted",
      { id: "sub_m5_a", object: "subscription", status: "canceled" },
      t0 + 20,
    ),
  );
  // Churn ahead of the payer does not move it into another band.
  await processStripeEvent(
    db,
    invoice(second, "in_m5_b2", "sub_m5_b", t0 + 30),
  );
  assert.equal((await charge(owner, "in_m5_b2")).data.rank, 2);
  // A late, older invoice for a payer who is no longer active keeps the stored rank.
  await db.tenant(owner, (tx) =>
    tx.query("UPDATE subscriptions SET status='canceled' WHERE user_id=$1", [
      second.userId,
    ]),
  );
  await processStripeEvent(db, invoice(second, "in_m5_b0", "sub_m5_b", t0 + 5));
  const late = await charge(owner, "in_m5_b0");
  assert.equal(late.data.rank, 2);
  assert.equal(late.data.rankMethod, "stable-first-paid-v1");
  // Stable rank keeps a churned subscriber's slot; recycling it is a pending finance decision.
  await processStripeEvent(db, invoice(later, "in_m5_c", "sub_m5_c", t0 + 40));
  assert.equal((await charge(owner, "in_m5_c")).data.rank, 3);
});

test("finance-commerce:G3 a same-second subscription event applies only the provider's current state", async () => {
  const owner = await workspace(),
    client = await member(owner),
    sub = "sub_tie_" + randomUUID(),
    t = now();
  const object = (status: string) => ({
    id: sub,
    object: "subscription",
    status,
    current_period_end: t + 86400,
  });
  await processStripeEvent(
    db,
    signed(client, "customer.subscription.updated", object("active"), t),
  );
  const stale = signed(
    client,
    "customer.subscription.created",
    object("incomplete"),
    t,
  );
  await withRuntimeConfig(noStripe, () =>
    assert.rejects(processStripeEvent(db, stale), /provider confirmation/),
  );
  const retrieved: string[] = [];
  const stripe = {
    subscriptions: {
      retrieve: async (id: string) => {
        retrieved.push(id);
        return {
          ...object("active"),
          metadata: { tenant_id: client.tenantId, user_id: client.userId },
        };
      },
    },
  } as any;
  await processStripeEvent(db, stale, { stripe });
  assert.deepEqual(retrieved, [sub]);
  const s = await db.tenant(client, (tx) =>
    currentPaidSubscription(tx, client.userId),
  );
  assert.equal(s?.status, "active");
  // A payment in the same second as creation still activates the membership.
  const payer = await member(owner),
    paidSub = "sub_tie_paid_" + randomUUID();
  await processStripeEvent(
    db,
    signed(
      payer,
      "customer.subscription.created",
      { ...object("incomplete"), id: paidSub },
      t,
    ),
  );
  await processStripeEvent(db, invoice(payer, "in_tie_paid", paidSub, t));
  const paid = await db.tenant(payer, (tx) =>
    currentPaidSubscription(tx, payer.userId),
  );
  assert.equal(paid?.status, "active");
});

test("finance-commerce:G4 closed inquiries and prevented disputes release the reserve", async () => {
  const owner = await workspace(),
    client = await member(owner);
  for (const [status, opened] of [
    ["warning_closed", "warning_needs_response"],
    ["prevented", "needs_response"],
  ]) {
    const id = "in_dispute_" + status;
    await processStripeEvent(db, invoice(client, id, "sub_dispute", now()));
    const before = await db.tenant(owner, financeSummary);
    const dispute = (type: string, disputeStatus: string) => ({
      id: "evt_" + randomUUID(),
      type,
      created: now(),
      data: {
        object: {
          id: "dp_" + status,
          object: "dispute",
          charge: "ch_" + id,
          amount: 10000,
          currency: "aed",
          status: disputeStatus,
          metadata: {},
        },
      },
    });
    await processStripeEvent(db, dispute("charge.dispute.created", opened));
    const closed = dispute("charge.dispute.closed", status);
    await processStripeEvent(db, closed);
    await processStripeEvent(db, closed);
    const after = await db.tenant(owner, financeSummary);
    assert.equal(after.accounts.dispute_reserve ?? 0, 0, status);
    assert.equal(
      after.accounts.trainer_payable,
      before.accounts.trainer_payable,
      status,
    );
  }
  await assert.rejects(
    processStripeEvent(db, {
      id: "evt_" + randomUUID(),
      type: "charge.dispute.closed",
      data: {
        object: {
          id: "dp_open",
          charge: "ch_in_dispute_prevented",
          amount: 10000,
          currency: "aed",
          status: "under_review",
        },
      },
    }),
    /unresolved/,
  );
});

test("finance-commerce:M1 a dahlia invoice resolves its charge through the invoice payment before posting", async () => {
  const owner = await workspace(),
    client = await member(owner),
    sub = "sub_dahlia_" + randomUUID();
  const dahlia = (id: string) => ({
    id: "evt_" + randomUUID(),
    type: "invoice.paid",
    created: now(),
    data: {
      object: {
        id,
        object: "invoice",
        amount_paid: 10000,
        amount_due: 10000,
        currency: "aed",
        created: now(),
        parent: {
          type: "subscription_details",
          subscription_details: {
            subscription: sub,
            metadata: { tenant_id: client.tenantId, user_id: client.userId },
          },
        },
        lines: { data: [{ period: { end: now() + 86400 } }] },
      },
    },
  });
  await withRuntimeConfig(noStripe, () =>
    assert.rejects(
      processStripeEvent(db, dahlia("in_dahlia_1")),
      /identity unresolved/,
    ),
  );
  assert.equal(await charge(owner, "in_dahlia_1"), undefined);
  const lists: any[] = [],
    intents: string[] = [];
  const stripe = {
    invoicePayments: {
      list: async (params: any) => {
        lists.push(params);
        return {
          has_more: false,
          data: [
            {
              status: "paid",
              payment:
                params.invoice === "in_dahlia_1"
                  ? {
                      type: "payment_intent",
                      payment_intent: {
                        id: "pi_dahlia_1",
                        latest_charge: "ch_dahlia_1",
                      },
                    }
                  : { type: "payment_intent", payment_intent: "pi_dahlia_2" },
            },
          ],
        };
      },
    },
    paymentIntents: {
      retrieve: async (id: string) => {
        intents.push(id);
        return { id, latest_charge: "ch_dahlia_2" };
      },
    },
  } as any;
  await processStripeEvent(db, dahlia("in_dahlia_1"), { stripe });
  await processStripeEvent(db, dahlia("in_dahlia_2"), { stripe });
  assert.equal(lists[0].invoice, "in_dahlia_1");
  assert.equal(lists[0].status, "paid");
  assert.deepEqual(intents, ["pi_dahlia_2"]);
  const first = await charge(owner, "in_dahlia_1");
  assert.equal(first.data.chargeId, "ch_dahlia_1");
  assert.equal(first.data.paymentIntentId, "pi_dahlia_1");
  assert.equal(
    (await charge(owner, "in_dahlia_2")).data.chargeId,
    "ch_dahlia_2",
  );
  // A replay after posting reuses the recorded identity without a provider call.
  await withRuntimeConfig(noStripe, () =>
    processStripeEvent(db, dahlia("in_dahlia_1")),
  );
  assert.equal(lists.length, 2);
  const history = await billingHistory(db, client);
  assert.equal(history.charges.length, 2);
  assert.ok(history.charges.every((c: any) => c.eligible));
  await processStripeEvent(db, {
    id: "evt_" + randomUUID(),
    type: "charge.dispute.created",
    created: now(),
    data: {
      object: {
        id: "dp_dahlia",
        object: "dispute",
        charge: "ch_dahlia_1",
        payment_intent: "pi_dahlia_1",
        amount: 10000,
        currency: "aed",
        status: "needs_response",
        metadata: {},
      },
    },
  });
  const [reserve] = await db.tenant(owner, (tx) =>
    tx.query(
      "SELECT data FROM journals WHERE source_key='dispute-reserve:dp_dahlia'",
    ),
  );
  assert.equal(reserve.data.chargeId, "ch_dahlia_1");
});

test("finance-commerce:G7 a payout cannot release earnings reduced by post-cutoff debits", async () => {
  const owner = await workspace();
  const prepare = () =>
    db.tenant(owner, (tx) =>
      createPayout(tx, owner, "2026-06", "fixture-beneficiary"),
    );
  const june = await db.tenant(owner, async (tx) => {
    const id = await postAt(
      tx,
      owner,
      "stripe-invoice:in_g7_june",
      "2026-06-15T00:00:00Z",
      { bank_cash: 10000, trainer_payable: -10000 },
      { chargeId: "ch_g7_june" },
    );
    await closeMonth(
      tx,
      owner,
      "2026-06",
      "Synthetic June close evidence",
      new Date("2026-07-15T00:00:00Z"),
    );
    await postAt(tx, owner, "usage:2026-06", "2026-07-02T00:00:00Z", {
      trainer_payable: 2000,
      platform_cost_recovery: -2000,
    });
    await postAt(tx, owner, "fixture-july-earning", "2026-07-03T00:00:00Z", {
      bank_cash: 5000,
      trainer_payable: -5000,
    });
    return id;
  });
  const first = await prepare();
  assert.equal(Number(first.amount_minor), 8000);
  await db.tenant(owner, async (tx) => {
    await transitionPayout(tx, owner, first.id, "canceled");
    // A buffer-week refund of a June charge reduces June's release.
    await postAt(
      tx,
      owner,
      "stripe-refund:re_g7_june",
      "2026-07-04T00:00:00Z",
      { trainer_payable: 1000, bank_cash: -1000 },
      { originalJournalId: june },
    );
    // Reversals of a charge posted after the cutoff belong to the next close with that charge.
    const july = await postAt(
      tx,
      owner,
      "stripe-invoice:in_g7_july",
      "2026-07-05T00:00:00Z",
      { bank_cash: 4000, trainer_payable: -4000 },
      { chargeId: "ch_g7_july" },
    );
    await postAt(
      tx,
      owner,
      "stripe-refund:re_g7_july",
      "2026-07-06T00:00:00Z",
      { trainer_payable: 1500, bank_cash: -1500 },
      { originalJournalId: july },
    );
    await postAt(
      tx,
      owner,
      "dispute-reserve:dp_g7_july",
      "2026-07-07T00:00:00Z",
      { trainer_payable: 1000, dispute_reserve: -1000 },
      { chargeId: "ch_g7_july" },
    );
  });
  const second = await prepare();
  assert.equal(second.revision, 2);
  assert.equal(Number(second.amount_minor), 7000);
});

test("finance-commerce:G8 close checks only pre-cutoff receivables and a negative balance can be reconciled", async () => {
  const owner = await workspace();
  const close = (period: string, at: string) =>
    db.tenant(owner, (tx) =>
      closeMonth(tx, owner, period, "Synthetic close evidence", new Date(at)),
    );
  await db.tenant(owner, async (tx) => {
    await postAt(tx, owner, "fixture-may-charge", "2026-05-10T00:00:00Z", {
      stripe_receivable: 10000,
      trainer_payable: -7500,
      platform_commission: -2500,
    });
    await postAt(tx, owner, "fixture-may-settlement", "2026-05-20T00:00:00Z", {
      bank_cash: 9700,
      trainer_payable: 300,
      stripe_receivable: -10000,
    });
    await postAt(tx, owner, "fixture-june-charge", "2026-06-02T00:00:00Z", {
      stripe_receivable: 6000,
      trainer_payable: -4500,
      platform_commission: -1500,
    });
  });
  // A charge after the cutoff is in transit and does not block the settled month.
  const may = await close("2026-05", "2026-06-10T00:00:00Z");
  assert.equal(may.status, "closed");
  assert.equal(may.data.eligibleMinor, 7200);
  await assert.rejects(close("2026-06", "2026-07-10T00:00:00Z"), (e: any) => {
    assert.equal(e.code, "SETTLEMENT_REQUIRED");
    return true;
  });
  await db.tenant(owner, async (tx) => {
    await postAt(tx, owner, "fixture-june-settlement", "2026-07-03T00:00:00Z", {
      bank_cash: 6000,
      stripe_receivable: -6000,
    });
    await postAt(tx, owner, "fixture-late-refund", "2026-07-05T00:00:00Z", {
      stripe_receivable: -6000,
      trainer_payable: 4500,
      platform_commission: 1500,
    });
  });
  assert.equal(
    (await close("2026-06", "2026-07-10T00:00:00Z")).status,
    "closed",
  );
  // A refund after settlement leaves a negative Stripe balance; it no longer blocks close.
  assert.equal(
    (await db.tenant(owner, financeSummary)).accounts.stripe_receivable,
    -6000,
  );
  assert.equal(
    (await close("2026-07", "2026-08-10T00:00:00Z")).status,
    "closed",
  );
  const debit = {
    stripeDebitId: "fixture-debit-1",
    bankReference: "bank-debit-fixture",
    amountMinor: 6000,
    evidenceReference: "Synthetic bank statement debit line",
  };
  await assert.rejects(
    db.tenant(owner, (tx) =>
      recordStripeDebit(tx, owner, { ...debit, amountMinor: 6001 }),
    ),
    /negative Stripe balance/,
  );
  const posted = await db.tenant(owner, (tx) =>
    recordStripeDebit(tx, owner, debit),
  );
  assert.equal(
    (await db.tenant(owner, (tx) => recordStripeDebit(tx, owner, debit)))?.id,
    posted?.id,
  );
  await assert.rejects(
    db.tenant(owner, (tx) =>
      recordStripeDebit(tx, owner, { ...debit, bankReference: "other-ref" }),
    ),
    /different evidence/,
  );
  const summary = await db.tenant(owner, financeSummary);
  assert.equal(summary.accounts.stripe_receivable, 0);
  assert.equal(summary.accounts.bank_cash, 9700 + 6000 - 6000);
});

test("quality-delivery:G2 tenant refund routes enforce roles and reconcile an unknown provider refund once", async () => {
  const Fastify = (await import("fastify")).default;
  const owner = await workspace(),
    client = await member(owner),
    staff = await member(owner, "staff");
  for (const id of ["ch_route_decline", "ch_route_unknown"])
    await db.tenant(owner, (tx) =>
      recordCharge(tx, owner, "stripe-invoice:in_" + id, 9000, 1, {
        userId: client.userId,
        chargeId: id,
        chargedAt: new Date().toISOString(),
      }),
    );
  let refundList: any[] = [],
    creates = 0,
    listed = 0;
  const stripe = {
    refunds: {
      create: async () => {
        creates++;
        throw new Error("Synthetic timeout after possible dispatch");
      },
      list: async (params: any) => {
        listed++;
        assert.equal(params.charge, "ch_route_unknown");
        return { data: refundList, has_more: false };
      },
    },
  } as any;
  const base = {
    name: "Ledger fixture",
    email: "fixture@example.test",
    emailVerified: true,
    platformRole: "none",
    mfaAt: new Date().toISOString(),
  };
  let actor: any = { ...base, ...client };
  const api = Fastify();
  api.addHook("onRequest", async (req) => {
    req.identity = actor;
  });
  registerFinanceBilling(api, db, { stripe: () => stripe });
  const post = (url: string, payload: any = {}) =>
    api.inject({ method: "POST", url: "/api/v1" + url, payload });
  try {
    const requested: Record<string, any> = {};
    for (const chargeId of ["ch_route_decline", "ch_route_unknown"]) {
      const r = await post("/refund-requests", {
        chargeId,
        reason: "Synthetic subscriber refund request",
      });
      assert.equal(r.statusCode, 200, r.body);
      requested[chargeId] = r.json();
    }
    const duplicate = await post("/refund-requests", {
      chargeId: "ch_route_decline",
      reason: "Synthetic duplicate refund request",
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().code, "ALREADY_REQUESTED");
    const declineId = requested.ch_route_decline.id,
      unknownId = requested.ch_route_unknown.id;
    for (const who of [staff, client]) {
      actor = { ...base, ...who };
      const denied = await post(`/refund-requests/${declineId}/decision`, {
        approve: false,
        reason: "Not permitted",
      });
      assert.equal(denied.statusCode, 403);
      assert.equal(denied.json().code, "OWNER_REQUIRED");
    }
    actor = { ...base, ...owner };
    const stale = await post(`/refund-requests/${declineId}/decision`, {
      approve: false,
      reason: "Owner review declined",
      revision: requested.ch_route_decline.version + 1,
    });
    assert.equal(stale.statusCode, 409);
    const declined = await post(`/refund-requests/${declineId}/decision`, {
      approve: false,
      reason: "Owner review declined",
    });
    assert.equal(declined.statusCode, 200, declined.body);
    const approved = await post(`/refund-requests/${unknownId}/decision`, {
      approve: true,
      reason: "Owner approved the refund",
    });
    assert.equal(approved.statusCode, 500);
    assert.equal(creates, 1);
    const status = async () =>
      (
        await db.tenant(owner, (tx) =>
          tx.query("SELECT status FROM records WHERE id=$1", [unknownId]),
        )
      )[0].status;
    assert.equal(await status(), "unknown");
    const unresolved = await post(`/refund-requests/${unknownId}/reconcile`);
    assert.equal(unresolved.statusCode, 409);
    assert.equal(unresolved.json().code, "REFUND_UNRESOLVED");
    assert.equal(await status(), "unknown");
    refundList = [
      {
        id: "re_route_unknown",
        object: "refund",
        status: "succeeded",
        amount: 9000,
        currency: "aed",
        charge: "ch_route_unknown",
        metadata: {
          refund_request_id: unknownId,
          tenant_id: owner.tenantId,
          user_id: client.userId,
        },
      },
    ];
    for (let i = 0; i < 2; i++) {
      const reconciled = await post(`/refund-requests/${unknownId}/reconcile`);
      assert.equal(reconciled.statusCode, 200, reconciled.body);
      assert.equal(reconciled.json().status, "succeeded");
    }
    assert.equal(listed, 2);
    assert.equal(creates, 1);
    assert.equal(await status(), "succeeded");
    const [journals] = await db.tenant(owner, (tx) =>
      tx.query(
        "SELECT count(*)::int AS n FROM journals WHERE source_key='stripe-refund:re_route_unknown'",
      ),
    );
    assert.equal(journals.n, 1);
    actor = {
      ...base,
      ...owner,
      platformRole: "finance",
      mfaAt: new Date(Date.now() - 20 * 60000).toISOString(),
    };
    const admin = await post(
      `/admin/tenants/${owner.tenantId}/finance/refunds/${unknownId}/reconcile`,
    );
    assert.equal(admin.statusCode, 403);
  } finally {
    await api.close();
  }
});

test("quality-delivery:G4 product activation and plan change use the injected Stripe provider behind their gates", async () => {
  const { buildApp } = await import("../apps/api/src/app.ts");
  const { tokenHash } = await import("../apps/api/src/auth.ts");
  const owner = await workspace(),
    client = await member(owner),
    baseClient = await member(owner),
    ownerToken = randomUUID(),
    clientToken = randomUUID(),
    baseToken = randomUUID();
  await db.system(async (tx) => {
    for (const [a, token] of [
      [owner, ownerToken],
      [client, clientToken],
      [baseClient, baseToken],
    ] as const)
      await tx.query(
        "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [tokenHash(token), a.userId, a.tenantId],
      );
  });
  const calls: Array<{ call: string; body: any; key?: string }> = [];
  let items = [{ id: "si_fixture" }];
  const stripe = {
    products: {
      create: async (body: any, options: any) => {
        calls.push({ call: "product", body, key: options.idempotencyKey });
        return { id: "prod_fixture" };
      },
    },
    prices: {
      create: async (body: any, options: any) => {
        calls.push({ call: "price", body, key: options.idempotencyKey });
        return { id: "price_activated_fixture" };
      },
    },
    subscriptions: {
      retrieve: async (id: string) => ({
        id,
        customer: "cus_fixture",
        items: { data: items },
      }),
    },
    billingPortal: {
      configurations: {
        create: async (body: any, options: any) => {
          calls.push({
            call: "portal-config",
            body,
            key: options.idempotencyKey,
          });
          return { id: "bpc_fixture" };
        },
      },
      sessions: {
        create: async (body: any) => {
          calls.push({ call: "portal-session", body });
          return { url: "https://billing.stripe.com/p/session/fixture" };
        },
      },
    },
  } as any;
  const app = await buildApp({
    db,
    testing: true,
    providers: { stripe: () => stripe },
  });
  const post = (url: string, token: string, payload: any = {}) =>
    app.inject({
      method: "POST",
      url: "/api/v1" + url,
      headers: { origin: "http://localhost:3000", cookie: "session=" + token },
      payload,
    });
  try {
    const draft = await db.tenant(owner, (tx) =>
      putRecord(
        tx,
        owner,
        "product",
        {
          name: "Workout",
          description: "Fixture",
          priceMinor: 12000,
          tier: "workout",
          modules: ["training"],
        },
        { status: "draft" },
      ),
    );
    const blocked = await withEnv({ COMMERCE_APPROVED: "false" }, () =>
      post(`/products/${draft.id}/activate`, ownerToken),
    );
    assert.equal(blocked.statusCode, 503, blocked.body);
    assert.equal(calls.length, 0);
    const approved = { COMMERCE_APPROVED: "true" };
    for (let i = 0; i < 2; i++) {
      const activated = await withEnv(approved, () =>
        post(`/products/${draft.id}/activate`, ownerToken),
      );
      assert.equal(activated.statusCode, 200, activated.body);
    }
    // A repeated activation never mints another provider product or price.
    assert.deepEqual(
      calls.map((c) => c.key),
      [`product:${draft.id}`, `price:${draft.id}:v${draft.version}`],
    );
    assert.equal(calls[1].body.unit_amount, 12000);
    const [published] = await db.tenant(owner, (tx) =>
      tx.query("SELECT status,data FROM records WHERE id=$1", [draft.id]),
    );
    assert.equal(published.status, "published");
    assert.equal(published.data.stripePriceId, "price_activated_fixture");
    const nutritionDraft = await db.tenant(owner, (tx) =>
      putRecord(
        tx,
        owner,
        "product",
        {
          name: "Workout + nutrition",
          description: "Fixture",
          priceMinor: 18000,
          tier: "workout_nutrition",
          baseProductId: draft.id,
          modules: ["training", "nutrition"],
        },
        { status: "draft" },
      ),
    );
    const notReady = await withEnv(approved, () =>
      post(`/products/${nutritionDraft.id}/activate`, ownerToken),
    );
    assert.equal(notReady.statusCode, 409, notReady.body);
    assert.equal(notReady.json().code, "NUTRITION_NOT_READY");
    assert.equal(calls.length, 2);

    // Plan change: the subscriber is on the combined offer and moves to its paired base offer.
    const [base, combined, unpaired] = await db.tenant(owner, async (tx) => {
      const make = (data: any) =>
        putRecord(tx, owner, "product", data, { status: "published" });
      const b = await make({
        name: "Base",
        tier: "workout",
        stripeProductId: "prod_base",
        stripePriceId: "price_base_" + owner.tenantId,
      });
      const c = await make({
        name: "Combined",
        tier: "workout_nutrition",
        baseProductId: b.id,
        stripeProductId: "prod_combined",
        stripePriceId: "price_combined_" + owner.tenantId,
      });
      const u = await make({
        name: "Unpaired",
        tier: "workout",
        stripeProductId: "prod_unpaired",
        stripePriceId: "price_unpaired_" + owner.tenantId,
      });
      for (const [a, productId] of [
        [client, c.id],
        [baseClient, b.id],
      ] as const)
        await tx.query(
          "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,data) VALUES($1,$2,$3,$4,'active',now()+interval '10 days',$5)",
          [
            randomUUID(),
            owner.tenantId,
            a.userId,
            "sub_plan_" + a.userId,
            JSON.stringify({ productId }),
          ],
        );
      return [b, c, u];
    });
    const change = (token: string, productId: string, allowed = "true") =>
      withEnv({ BUNDLE_CHANGES_APPROVED: allowed }, () =>
        post("/membership/change-plan", token, { productId }),
      );
    const byOwner = await change(ownerToken, base.id);
    assert.equal(byOwner.statusCode, 403);
    assert.equal(byOwner.json().code, "SUBSCRIBER_REQUIRED");
    const pending = await change(clientToken, base.id, "false");
    assert.equal(pending.statusCode, 503);
    assert.equal(pending.json().code, "PLAN_CHANGES_PENDING");
    const pair = await change(clientToken, unpaired.id);
    assert.equal(pair.statusCode, 409, pair.body);
    assert.equal(pair.json().code, "PLAN_PAIR");
    // The combined offer stays behind nutrition readiness before any other plan check.
    const notReadyPlan = await change(clientToken, combined.id);
    assert.equal(notReadyPlan.statusCode, 409, notReadyPlan.body);
    assert.equal(notReadyPlan.json().code, "NUTRITION_NOT_READY");
    const same = await change(baseToken, base.id);
    assert.equal(same.statusCode, 409, same.body);
    assert.equal(same.json().code, "SAME_PLAN");
    items = [{ id: "si_one" }, { id: "si_two" }];
    const review = await change(clientToken, base.id);
    assert.equal(review.statusCode, 409, review.body);
    assert.equal(review.json().code, "BILLING_REVIEW");
    items = [{ id: "si_one" }];
    const keys: string[] = [];
    for (let i = 0; i < 2; i++) {
      const opened = await change(clientToken, base.id);
      assert.equal(opened.statusCode, 200, opened.body);
      assert.equal(
        opened.json().url,
        "https://billing.stripe.com/p/session/fixture",
      );
      keys.push(calls.filter((c) => c.call === "portal-config").at(-1)!.key!);
    }
    assert.match(keys[0], /^membership-portal:[0-9a-f]{64}$/);
    assert.equal(keys[0], keys[1]);
    const session = calls.filter((c) => c.call === "portal-session").at(-1)!;
    assert.equal(
      session.body.flow_data.subscription_update_confirm.items[0].price,
      base.data.stripePriceId,
    );
    const [opened] = await db.tenant(owner, (tx) =>
      tx.query(
        "SELECT count(*)::int AS n FROM events WHERE name='subscription.change_confirmation_opened'",
      ),
    );
    assert.equal(opened.n, 2);
  } finally {
    await app.close();
  }
});
