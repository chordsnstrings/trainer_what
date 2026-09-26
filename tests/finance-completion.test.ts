import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database, type Actor } from "@trainer/db";
import { withRuntimeConfig, requireCommerce } from "@trainer/providers";
import {
  changeRenewal,
  reconcileRenewal,
  billingHistory,
  requestRefund,
  decideRefund,
  currentPaidSubscription,
} from "../apps/api/src/finance-billing.ts";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
let db: Database;
const a: Actor = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  role: "owner",
};
const client: Actor = { ...a, userId: randomUUID(), role: "subscriber" };
const other: Actor = {
  tenantId: randomUUID(),
  userId: randomUUID(),
  role: "owner",
};
const subId = "sub_completion_" + randomUUID();
let counter = 0;
const signed = (
  type: string,
  object: any,
  created = Math.floor(Date.now() / 1000),
) => ({
  id: `evt_finance_${randomUUID()}`,
  type,
  created,
  data: {
    object: {
      metadata: { tenant_id: a.tenantId, user_id: client.userId },
      ...object,
    },
  },
});
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const actor of [a, client, other])
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Finance fixture','not-a-real-login')",
        [actor.userId, actor.userId + "@example.test"],
      );
    for (const actor of [a, other])
      await tx.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Finance fixture')",
        [actor.tenantId, actor.tenantId],
      );
    for (const actor of [a, client, other])
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [actor.tenantId, actor.userId, actor.role],
      );
  });
  await processStripeEvent(
    db,
    signed("customer.subscription.created", {
      id: subId,
      object: "subscription",
      status: "active",
      cancel_at_period_end: false,
      current_period_end: Math.floor(Date.now() / 1000) + 86400,
    }),
  );
});
after(async () => db.close());
test("paused new sales still allow servicing; each cancel/reactivate transition has its own stable identity", async () => {
  const keys: string[] = [];
  const stripe = {
    subscriptions: {
      update: async (id: string, body: any, options: any) => {
        keys.push(options.idempotencyKey);
        return { id, ...body };
      },
    },
  } as any;
  await withRuntimeConfig({ COMMERCE_APPROVED: "false" }, async () => {
    assert.throws(() => requireCommerce());
    await changeRenewal(db, client, true, stripe);
    await changeRenewal(db, client, true, stripe);
    await changeRenewal(db, client, false, stripe);
    await changeRenewal(db, client, true, stripe);
  });
  assert.equal(keys.length, 3);
  assert.equal(new Set(keys).size, 3);
  assert.equal((await billingHistory(db, other)).transitions.length, 0);
});
test("uncertain renewal blocks another dispatch until a provider read confirms the requested state", async () => {
  const stripe = {
    subscriptions: {
      update: async () => {
        counter++;
        throw new Error("Synthetic timeout after possible dispatch");
      },
      retrieve: async () => ({ id: subId, cancel_at_period_end: false }),
    },
  } as any;
  await assert.rejects(
    changeRenewal(db, client, false, stripe),
    /Synthetic timeout/,
  );
  await assert.rejects(
    changeRenewal(db, client, true, stripe),
    /Reconcile the existing/,
  );
  await assert.rejects(
    changeRenewal(db, client, false, stripe),
    /Reconcile the existing/,
  );
  assert.equal(counter, 1);
  await reconcileRenewal(db, client, stripe);
  assert.equal((await billingHistory(db, client)).transitions.length, 0);
});
test("signed invoice history is scoped, sanitizes links and cannot be downgraded by an old failure", async () => {
  const invoice = {
    id: "in_completion",
    charge: "ch_completion",
    subscription: subId,
    amount_paid: 10000,
    amount_due: 10000,
    currency: "aed",
    period_end: Math.floor(Date.now() / 1000) + 86400,
    created: Math.floor(Date.now() / 1000),
    hosted_invoice_url: "https://invoice.stripe.com/i/test",
    invoice_pdf: "https://evil.test/payload",
  };
  await processStripeEvent(db, signed("invoice.paid", invoice));
  await processStripeEvent(db, signed("invoice.paid", invoice));
  await processStripeEvent(db, signed("invoice.payment_failed", invoice, 1));
  const history = await billingHistory(db, client);
  assert.equal(history.invoices.length, 1);
  assert.equal(history.charges.length, 1);
  assert.equal(history.invoices[0].status, "paid");
  assert.equal(history.invoices[0].data.pdfUrl, null);
  assert.equal((await billingHistory(db, other)).charges.length, 0);
  await assert.rejects(
    requestRefund(db, other, {
      chargeId: "ch_completion",
      reason: "Foreign charge",
    }),
    /unavailable/,
  );
});
test("refund amount is bounded, single instruction survives paused commerce and uncertain provider outcomes", async () => {
  const r = await requestRefund(db, client, {
    chargeId: "ch_completion",
    reason: "Seven day refund request",
  });
  await assert.rejects(
    requestRefund(db, client, {
      chargeId: "ch_completion",
      reason: "Duplicate request",
    }),
    /already exists/,
  );
  let calls = 0;
  const stripe = {
    refunds: {
      create: async (body: any, options: any) => {
        calls++;
        assert.equal(body.amount, 10000);
        assert.equal(options.idempotencyKey, `refund:${r.id}`);
        throw new Error("Synthetic uncertain refund");
      },
    },
  } as any;
  await withRuntimeConfig({ COMMERCE_APPROVED: "false" }, async () => {
    await assert.rejects(
      decideRefund(
        db,
        a,
        r.id,
        { approve: true, reason: "Approved", revision: 1 },
        false,
        stripe,
      ),
      /Synthetic uncertain/,
    );
    await assert.rejects(
      decideRefund(
        db,
        a,
        r.id,
        { approve: true, reason: "Retry" },
        false,
        stripe,
      ),
      /already has an instruction/,
    );
  });
  assert.equal(calls, 1);
  assert.equal(
    (await billingHistory(db, client)).requests[0].status,
    "unknown",
  );
  await processStripeEvent(
    db,
    signed("refund.updated", {
      id: "re_completion",
      charge: "ch_completion",
      amount: 10000,
      currency: "aed",
      status: "succeeded",
      metadata: {
        tenant_id: a.tenantId,
        user_id: client.userId,
        refund_request_id: r.id,
      },
    }),
  );
  await processStripeEvent(
    db,
    signed("refund.updated", {
      id: "re_completion",
      charge: "ch_completion",
      amount: 10000,
      currency: "aed",
      status: "pending",
      metadata: {
        tenant_id: a.tenantId,
        user_id: client.userId,
        refund_request_id: r.id,
      },
    }),
  );
  const history = await billingHistory(db, client);
  assert.equal(history.requests[0].status, "succeeded");
  assert.equal(history.charges[0].remainingMinor, 0);
});
test("failed-payment grace is finite, does not slide on retries, and ends immediately on cancellation", async () => {
  const at = Math.floor(Date.now() / 1000) + 1;
  const payload = {
    id: "in_failed_completion",
    subscription: subId,
    amount_due: 10000,
    currency: "aed",
  };
  await processStripeEvent(db, signed("invoice.payment_failed", payload, at));
  const first = await db.tenant(client, (tx) =>
    currentPaidSubscription(tx, client.userId),
  );
  assert.equal(first?.status, "past_due");
  await processStripeEvent(
    db,
    signed("invoice.payment_failed", payload, at + 86400),
  );
  const second = await db.tenant(client, (tx) =>
    currentPaidSubscription(tx, client.userId),
  );
  assert.equal(second?.data.graceUntil, first?.data.graceUntil);
  await processStripeEvent(
    db,
    signed(
      "customer.subscription.deleted",
      { id: subId, object: "subscription", status: "canceled" },
      at + 86401,
    ),
  );
  assert.equal(
    await db.tenant(client, (tx) => currentPaidSubscription(tx, client.userId)),
    undefined,
  );
});
test("coaching staff cannot read billing snapshots or renewal instructions", async () => {
  const rows = await db.tenant({ ...a, role: "staff" }, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind IN ('billing_invoice','subscription_transition')",
    ),
  );
  assert.equal(rows.length, 0);
});

test("effective fee revisions preserve historical charges and ledger statements reconcile", async () => {
  const { publishFinancePolicy } =
    await import("../apps/api/src/finance-policy.ts");
  const { financialStatement, allocateCost } =
    await import("../apps/api/src/finance-statements.ts");
  const { recordCharge } = await import("../apps/api/src/finance.ts");
  const effectiveAt = new Date(Date.now() + 60000).toISOString();
  const policy = await db.tenant(a, (tx) =>
    publishFinancePolicy(tx, a, {
      revision: null,
      effectiveAt,
      commissionBps: [1000, 900, 800, 700],
      bookingFeeBps: 500,
      graceDays: 5,
      reason: "Reviewed prospective fixture policy",
    }),
  );
  await assert.rejects(
    db.tenant(a, (tx) =>
      publishFinancePolicy(tx, a, {
        revision: null,
        effectiveAt,
        commissionBps: [1000, 900, 800, 700],
        graceDays: 3,
        reason: "Outdated settings request",
      }),
    ),
    /changed/,
  );
  const oldCharge = await db.tenant(a, (tx) =>
    recordCharge(tx, a, "fixture-old-fee", 10000, 1, {
      chargedAt: new Date(Date.now() - 1000).toISOString(),
    }),
  );
  const newCharge = await db.tenant(a, (tx) =>
    recordCharge(tx, a, "fixture-new-fee", 10000, 1, {
      chargedAt: new Date(Date.now() + 61000).toISOString(),
    }),
  );
  assert.equal(oldCharge?.data.commissionMinor, 2500);
  assert.equal(newCharge?.data.commissionMinor, 1000);
  assert.equal(newCharge?.data.policy, policy.id);
  await assert.rejects(
    db.tenant(a, (tx) =>
      tx.query("UPDATE records SET data='{}' WHERE id=$1", [policy.id]),
    ),
    /immutable/,
  );
  const period = new Date().toISOString().slice(0, 7),
    input = {
      intent: randomUUID(),
      period,
      category: "infrastructure",
      amountMinor: 500,
      chargeTrainer: true,
      description: "Allocated test server cost",
      evidenceReference: "Synthetic approved invoice reference",
    };
  const cost = await db.tenant(a, (tx) => allocateCost(tx, a, input));
  const repeated = await db.tenant(a, (tx) => allocateCost(tx, a, input));
  assert.equal(cost.id, repeated.id);
  await assert.rejects(
    db.tenant(a, (tx) => allocateCost(tx, a, { ...input, amountMinor: 501 })),
    /different evidence/,
  );
  const statement = await db.tenant(a, (tx) => financialStatement(tx, period));
  assert.equal(statement.totals.allocatedCostsMinor, 500);
  assert.equal(statement.allocations.length, 1);
  assert.equal(
    statement.totals.closingPayableMinor,
    statement.current.earnedMinor,
  );
});
test("promotion creation is product-bound and first-membership trial terms are stable", async () => {
  const { createPromotion, checkoutOfferTerms } =
    await import("../apps/api/src/finance-promotions.ts");
  const product = await db.tenant(a, async (tx) => {
    const [r] = await tx.query(
      "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,'product',$3,'published',$4) RETURNING *",
      [
        randomUUID(),
        a.tenantId,
        a.userId,
        JSON.stringify({
          name: "Fixture",
          stripeProductId: "prod_fixture",
          stripePriceId: "price_fixture",
          trialDays: 7,
        }),
      ],
    );
    return r;
  });
  let calls = 0;
  const stripe = {
    coupons: {
      create: async (body: any) => {
        calls++;
        assert.deepEqual(body.applies_to.products, ["prod_fixture"]);
        assert.equal(body.duration, "once");
        return { id: body.id };
      },
    },
  } as any;
  const input = {
    code: "WELCOME",
    productId: product.id,
    percentOff: 10,
    maxRedemptions: 20,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    reason: "Fixture first invoice promotion",
  };
  const r = await createPromotion(db, a, input, stripe);
  assert.equal(r.status, "published");
  await assert.rejects(createPromotion(db, a, input, stripe), /already has/);
  assert.equal(calls, 1);
  const terms = await db.tenant(a, (tx) =>
    checkoutOfferTerms(tx, a, product, "welcome"),
  );
  assert.equal(terms.trialDays, 7);
  assert.equal(terms.couponId, "trainer_" + r.id);
  const returning = await db.tenant(a, (tx) =>
    checkoutOfferTerms(tx, client, product, "WELCOME"),
  );
  assert.equal(returning.trialDays, 0);
  await assert.rejects(
    db.tenant(other, (tx) => checkoutOfferTerms(tx, other, product, "WELCOME")),
    /unavailable/,
  );
});

test("paid bookings use one-time checkout, signed exact-price confirmation and a single compensating refund", async () => {
  const {
    preparePaidBooking,
    startBookingCheckout,
    processBookingStripeEvent,
    refundCanceledBooking,
  } = await import("../apps/api/src/finance-bookings.ts");
  const { slot, booking } = await db.tenant(a, async (tx) => {
    const [slot] = await tx.query(
      "INSERT INTO booking_slots(id,tenant_id,trainer_id,starts_at,ends_at,capacity,title,location,price_minor) VALUES($1,$2,$3,now()+interval '2 days',now()+interval '2 days 1 hour',1,'Paid test session','Gym',15000) RETURNING *",
      [randomUUID(), a.tenantId, a.userId],
    );
    const [booking] = await tx.query(
      "INSERT INTO bookings(id,tenant_id,slot_id,user_id) VALUES($1,$2,$3,$4) RETURNING *",
      [randomUUID(), a.tenantId, slot.id, client.userId],
    );
    return { slot, booking };
  });
  const payment = await db.tenant({ ...client, role: "staff" }, async (tx) => {
    const p = await preparePaidBooking(tx, client, slot, booking);
    const [role] = await tx.query(
      "SELECT current_setting('app.role',true) AS role",
    );
    assert.equal(role.role, "staff");
    return p;
  });
  let remote: any,
    calls = 0,
    refundCalls = 0;
  const stripe = {
    checkout: {
      sessions: {
        create: async (body: any, opts: any) => {
          calls++;
          assert.equal(body.mode, "payment");
          assert.deepEqual(body.payment_method_types, ["card"]);
          assert.equal(opts.idempotencyKey, "booking-checkout:" + payment!.id);
          remote = {
            ...body,
            id: "cs_booking_fixture",
            url: "https://checkout.stripe.com/c/fixture",
            currency: "aed",
            amount_total: 15000,
            payment_status: "paid",
            payment_intent: "pi_booking_fixture",
          };
          return remote;
        },
      },
    },
    refunds: {
      create: async (body: any, opts: any) => {
        refundCalls++;
        assert.equal(body.payment_intent, "pi_booking_fixture");
        assert.equal(body.amount, 15000);
        assert.equal(opts.idempotencyKey, "booking-refund:" + payment!.id);
        return { id: "re_booking_fixture" };
      },
    },
  } as any;
  await startBookingCheckout(db, client, booking.id, stripe);
  await startBookingCheckout(db, client, booking.id, stripe);
  assert.equal(calls, 1);
  await assert.rejects(
    processBookingStripeEvent(
      db,
      {
        type: "checkout.session.completed",
        data: { object: { ...remote, amount_total: 14999 } },
      },
      stripe,
    ),
    /amount/,
  );
  await processBookingStripeEvent(
    db,
    { type: "checkout.session.completed", data: { object: remote } },
    stripe,
  );
  await processBookingStripeEvent(
    db,
    { type: "checkout.session.completed", data: { object: remote } },
    stripe,
  );
  let rows = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM bookings WHERE id=$1", [booking.id]),
  );
  assert.equal(rows[0].status, "confirmed");
  await db.tenant(a, (tx) =>
    tx.query("UPDATE bookings SET status='canceled' WHERE id=$1", [booking.id]),
  );
  await refundCanceledBooking(db, a, booking.id, stripe);
  await refundCanceledBooking(db, a, booking.id, stripe);
  assert.equal(refundCalls, 1);
  const refund = {
    id: "re_booking_fixture",
    amount: 15000,
    currency: "aed",
    status: "succeeded",
    payment_intent: "pi_booking_fixture",
    metadata: remote.metadata,
  };
  await processBookingStripeEvent(
    db,
    { type: "refund.updated", data: { object: refund } },
    stripe,
  );
  await processBookingStripeEvent(
    db,
    { type: "refund.updated", data: { object: refund } },
    stripe,
  );
  rows = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM bookings WHERE id=$1", [booking.id]),
  );
  assert.equal(rows[0].payment_status, "refunded");
  const journalCount = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM journals WHERE source_key=$1 OR source_key=$2",
      ["booking-charge:" + payment!.id, "booking-refund:re_booking_fixture"],
    ),
  );
  assert.equal(journalCount[0].n, 2);
});

test("late paid booking cannot take an occupied seat and uncertain compensation never dispatches twice", async () => {
  const {
    preparePaidBooking,
    startBookingCheckout,
    processBookingStripeEvent,
    refundCanceledBooking,
  } = await import("../apps/api/src/finance-bookings.ts");
  const { slot, booking } = await db.tenant(a, async (tx) => {
    const [slot] = await tx.query(
      "INSERT INTO booking_slots(id,tenant_id,trainer_id,starts_at,ends_at,capacity,title,location,price_minor) VALUES($1,$2,$3,now()+interval '3 days',now()+interval '3 days 1 hour',1,'Late paid session','Gym',15000) RETURNING *",
      [randomUUID(), a.tenantId, a.userId],
    );
    const [booking] = await tx.query(
      "INSERT INTO bookings(id,tenant_id,slot_id,user_id) VALUES($1,$2,$3,$4) RETURNING *",
      [randomUUID(), a.tenantId, slot.id, client.userId],
    );
    return { slot, booking };
  });
  const p = await db.tenant(a, (tx) =>
    preparePaidBooking(tx, client, slot, booking),
  );
  let remote: any,
    refundCalls = 0;
  const stripe = {
    checkout: {
      sessions: {
        create: async (body: any) => {
          remote = {
            ...body,
            id: "cs_late_fixture",
            url: "https://checkout.stripe.com/c/late",
            amount_total: 15000,
            currency: "aed",
            payment_status: "paid",
            payment_intent: "pi_late_fixture",
          };
          return remote;
        },
      },
    },
    refunds: {
      create: async () => {
        refundCalls++;
        throw new Error("Synthetic refund timeout");
      },
    },
  } as any;
  await startBookingCheckout(db, client, booking.id, stripe);
  await db.tenant(a, async (tx) => {
    await tx.query(
      "UPDATE bookings SET hold_expires_at=now()-interval '1 minute' WHERE id=$1",
      [booking.id],
    );
    await tx.query(
      "INSERT INTO bookings(id,tenant_id,slot_id,user_id,status) VALUES($1,$2,$3,$4,'confirmed')",
      [randomUUID(), a.tenantId, slot.id, a.userId],
    );
  });
  await assert.rejects(
    processBookingStripeEvent(
      db,
      { type: "checkout.session.completed", data: { object: remote } },
      stripe,
    ),
    /Synthetic refund timeout/,
  );
  await processBookingStripeEvent(
    db,
    { type: "checkout.session.completed", data: { object: remote } },
    stripe,
  );
  await refundCanceledBooking(db, a, booking.id, stripe);
  assert.equal(refundCalls, 1);
  const [row] = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT b.status,r.status AS payment FROM bookings b JOIN records r ON r.data->>'bookingId'=b.id::text AND r.kind='booking_payment' WHERE b.id=$1 AND r.id=$2",
      [booking.id, p!.id],
    ),
  );
  assert.equal(row.status, "canceled");
  assert.equal(row.payment, "refund_unknown");
});

test("finance scheduling and signed receipt replay retain stable job and journal identities", async () => {
  const { configureFinanceAutomation, scheduleFinance, executeFinanceJob } =
    await import("../apps/api/src/finance-automation.ts");
  const config = {
    revision: 0,
    enabled: true,
    reconcileStripe: false,
    closeMonthly: true,
    preparePayouts: false,
    executePayouts: false,
    maxPayoutMinor: 0,
    fxAedPerUsd: 3.67,
    fxEvidence: "Synthetic reviewed rate only for isolated tests",
    reason: "Synthetic finance automation qualification",
  };
  const c = await db.tenant(a, (tx) =>
    configureFinanceAutomation(tx, a, config),
  );
  await assert.rejects(
    db.tenant(a, (tx) => configureFinanceAutomation(tx, a, config)),
    /changed/,
  );
  await scheduleFinance(db, a.tenantId);
  await scheduleFinance(db, a.tenantId);
  const jobs = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM jobs WHERE kind LIKE 'finance_%'"),
  );
  assert.equal(jobs.filter((j) => j.kind === "finance_replay").length, 1);
  assert.equal(new Set(jobs.map((j) => j.intent_key)).size, jobs.length);
  const payload = signed("invoice.paid", {
    id: "in_replay_fixture",
    charge: "ch_replay_fixture",
    subscription: subId,
    amount_paid: 1200,
    currency: "aed",
    period_end: Math.floor(Date.now() / 1000) + 86400,
  });
  await db.system((tx) =>
    tx.query(
      "INSERT INTO provider_events(provider,external_id,payload,status) VALUES('stripe',$1,$2,'failed')",
      [payload.id, JSON.stringify(payload)],
    ),
  );
  const job = jobs.find((j) => j.kind === "finance_replay");
  assert.equal(
    (await executeFinanceJob(db, a.tenantId, job)).status,
    "completed",
  );
  await executeFinanceJob(db, a.tenantId, job);
  const [effects] = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT count(*)::int AS n FROM journals WHERE source_key='stripe-invoice:in_replay_fixture'",
    ),
  );
  assert.equal(effects.n, 1);
  const changed = await executeFinanceJob(db, a.tenantId, {
    kind: "finance_monthly",
    data: { configVersion: c.version + 1, period: "2026-08" },
  });
  assert.equal(changed.code, "AUTOMATION_APPROVAL_CHANGED");
  await assert.rejects(
    db.tenant(a, (tx) =>
      configureFinanceAutomation(tx, a, {
        ...config,
        revision: c.version,
        executePayouts: true,
      }),
    ),
    /positive cap/,
  );
});

test("automatic payout approval is rechecked within the dispatch transaction", async () => {
  const { executePayout } = await import("../apps/api/src/payout-execution.ts");
  const [config] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM records WHERE kind='finance_automation'"),
  );
  const payout = await db.tenant(a, async (tx) => {
    const [p] = await tx.query(
      "INSERT INTO payouts(id,tenant_id,period,amount_minor,beneficiary_id,status) VALUES($1,$2,'2040-01',100,'fixture-destination','ready') RETURNING *",
      [randomUUID(), a.tenantId],
    );
    return p;
  });
  await withRuntimeConfig(
    {
      LEAN_BASE_URL: "https://finance-fixture.invalid",
      LEAN_ACCESS_TOKEN: "synthetic_fixture_token",
      LEAN_SOURCE_ACCOUNT_ID: "fixture-source",
      LEAN_CONTRACT_VERIFIED: "true",
      PAYOUTS_APPROVED: "true",
    },
    () =>
      assert.rejects(
        executePayout(db, a, payout.id, {
          configurationId: config.id,
          revision: config.version,
          maxPayoutMinor: 100,
        }),
        /approval or cap changed/,
      ),
  );
  const [current] = await db.tenant(a, (tx) =>
    tx.query("SELECT status FROM payouts WHERE id=$1", [payout.id]),
  );
  assert.equal(current.status, "ready");
});

test("admin refund review enforces role and fresh MFA, supports scoped late requests and CAS overrides", async () => {
  const Fastify = (await import("fastify")).default;
  const { registerFinanceBilling, decideRefund } =
    await import("../apps/api/src/finance-billing.ts");
  const { recordCharge } = await import("../apps/api/src/finance.ts");
  const api = Fastify();
  let actor: any = {
    ...a,
    platformRole: "finance",
    name: "Finance reviewer",
    email: "finance@example.test",
    emailVerified: true,
    mfaAt: new Date().toISOString(),
  };
  api.addHook("onRequest", async (req) => {
    req.identity = actor;
  });
  registerFinanceBilling(api, db);
  try {
    const route = `/api/v1/admin/tenants/${a.tenantId}/finance/refunds`;
    actor = { ...actor, platformRole: "none" };
    assert.equal(
      (await api.inject({ method: "GET", url: route })).statusCode,
      403,
    );
    actor = {
      ...actor,
      platformRole: "finance",
      mfaAt: new Date(Date.now() - 20 * 60000).toISOString(),
    };
    assert.equal(
      (await api.inject({ method: "GET", url: route })).statusCode,
      403,
    );
    actor = { ...actor, mfaAt: new Date().toISOString() };
    await db.tenant(a, (tx) =>
      recordCharge(tx, a, "stripe-invoice:in_admin_override_fixture", 9000, 1, {
        userId: client.userId,
        chargeId: "ch_admin_override_fixture",
        chargedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      }),
    );
    let review = await api.inject({
      method: "GET",
      url: route + "?chargeId=ch_admin_override_fixture",
    });
    assert.equal(review.statusCode, 200, review.body);
    assert.equal(review.json().charges.length, 1);
    assert.equal(review.json().charges[0].remainingMinor, 9000);
    const foreign = await api.inject({
      method: "GET",
      url: `/api/v1/admin/tenants/${other.tenantId}/finance/refunds?chargeId=ch_admin_override_fixture`,
    });
    assert.equal(foreign.json().charges.length, 0);
    const created = await api.inject({
      method: "POST",
      url: route,
      payload: {
        userId: client.userId,
        chargeId: "ch_admin_override_fixture",
        reason: "Reviewed billing exception outside the normal request window",
      },
    });
    assert.equal(created.statusCode, 200, created.body);
    const r = created.json();
    let decision = await api.inject({
      method: "POST",
      url: route + `/${r.id}/decision`,
      payload: {
        approve: false,
        reason: "First review declined with recorded evidence",
        revision: r.version + 1,
      },
    });
    assert.equal(decision.statusCode, 409);
    decision = await api.inject({
      method: "POST",
      url: route + `/${r.id}/decision`,
      payload: {
        approve: false,
        reason: "First review declined with recorded evidence",
        revision: r.version,
      },
    });
    assert.equal(decision.statusCode, 200, decision.body);
    let calls = 0;
    const stripe = {
      refunds: {
        create: async (body: any) => {
          calls++;
          assert.equal(body.amount, 9000);
          return { id: "re_admin_override_fixture" };
        },
      },
    } as any;
    await decideRefund(
      db,
      actor,
      r.id,
      {
        approve: true,
        reason: "Independent admin review overturns the prior decline",
        revision: r.version + 1,
      },
      true,
      stripe,
    );
    assert.equal(calls, 1);
    review = await api.inject({
      method: "GET",
      url: route + "?chargeId=ch_admin_override_fixture",
    });
    assert.equal(review.json().requests[0].status, "submitted");
    assert.equal(review.json().charges[0].requestId, r.id);
  } finally {
    await api.close();
  }
});

test("monthly job reauthorization binds the displayed policy revision with fresh MFA and preserves payment identities", async () => {
  const { configureFinanceAutomation, reauthorizeFinanceJob } =
    await import("../apps/api/src/finance-automation.ts");
  const [c] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM records WHERE kind='finance_automation'"),
  );
  const next = await db.tenant(a, (tx) =>
    configureFinanceAutomation(tx, a, {
      revision: c.version,
      enabled: true,
      reconcileStripe: false,
      closeMonthly: true,
      preparePayouts: false,
      executePayouts: false,
      maxPayoutMinor: 0,
      fxAedPerUsd: 3.67,
      fxEvidence: "Synthetic reviewed FX evidence remains unchanged",
      reason:
        "Reauthorize blocked monthly close with current reviewed settings",
    }),
  );
  const job = await db.tenant(a, async (tx) => {
    const [j] = await tx.query(
      "SELECT * FROM jobs WHERE kind='finance_monthly' LIMIT 1",
    );
    await tx.query(
      "UPDATE jobs SET status='blocked',attempts=1,leased_until=NULL WHERE id=$1",
      [j.id],
    );
    return j;
  });
  const operator = {
      ...a,
      platformRole: "finance",
      mfaAt: new Date().toISOString(),
    },
    input = {
      attempts: 1,
      configurationRevision: next.version,
      reason: "Resolved prior reconciliation issue and reviewed current limits",
    };
  const payoutsBefore = await db.tenant(a, (tx) =>
    tx.query("SELECT id,status,revision FROM payouts ORDER BY id"),
  );
  await assert.rejects(
    db.tenant(a, (tx) =>
      reauthorizeFinanceJob(
        tx,
        { ...operator, mfaAt: new Date(Date.now() - 20 * 60000).toISOString() },
        job.id,
        input,
      ),
    ),
    /Verify your authenticator/,
  );
  await assert.rejects(
    db.tenant(a, (tx) =>
      reauthorizeFinanceJob(tx, operator, job.id, {
        ...input,
        configurationRevision: c.version,
      }),
    ),
    /configuration changed/,
  );
  await assert.rejects(
    db.tenant(a, (tx) =>
      reauthorizeFinanceJob(tx, operator, job.id, { ...input, attempts: 2 }),
    ),
    /job changed/i,
  );
  const result = await db.tenant(a, (tx) =>
    reauthorizeFinanceJob(tx, operator, job.id, input),
  );
  assert.equal(result.jobId, job.id);
  assert.equal(result.intentKey, job.intent_key);
  assert.equal(result.configurationRevision, next.version);
  const [after] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM jobs WHERE id=$1", [job.id]),
  );
  assert.equal(after.data.period, job.data.period);
  assert.equal(after.data.configVersion, next.version);
  assert.equal(after.status, "pending");
  assert.deepEqual(
    await db.tenant(a, (tx) =>
      tx.query("SELECT id,status,revision FROM payouts ORDER BY id"),
    ),
    payoutsBefore,
  );
  await assert.rejects(
    db.tenant(a, (tx) => reauthorizeFinanceJob(tx, operator, job.id, input)),
    /job changed/i,
  );
});

test("finance job failures remain blocked and stale workers cannot overwrite a newer lease", async () => {
  const { persistFinanceJobOutcome, runClaimedFinanceJob } =
    await import("../apps/api/src/finance-automation.ts");
  const job = await db.tenant(a, async (tx) => {
    const [j] = await tx.query(
      "INSERT INTO jobs(id,tenant_id,kind,intent_key,data,attempts,leased_until) VALUES($1,$2,'finance_unknown',$3,'{}',1,now()+interval '2 minutes') RETURNING *",
      [randomUUID(), a.tenantId, "fixture-cas:" + randomUUID()],
    );
    return j;
  });
  const [newClaim] = await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE jobs SET attempts=2,leased_until=now()+interval '3 minutes' WHERE id=$1 RETURNING *",
      [job.id],
    ),
  );
  assert.equal(
    (
      await persistFinanceJobOutcome(db, a.tenantId, job, {
        status: "blocked",
        code: "FINANCE_RECONCILIATION_REQUIRED",
      })
    ).updated,
    false,
  );
  let [stored] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM jobs WHERE id=$1", [job.id]),
  );
  assert.equal(stored.status, "pending");
  assert.equal(stored.attempts, 2);
  const result = await runClaimedFinanceJob(db, a.tenantId, newClaim);
  assert.equal(result.updated, true);
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "FINANCE_JOB_UNSUPPORTED");
  [stored] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM jobs WHERE id=$1", [job.id]),
  );
  assert.equal(stored.status, "blocked");
  assert.equal(stored.last_error, "FINANCE_JOB_UNSUPPORTED");
  assert.equal(stored.leased_until, null);
});

test("premium voice is an optional feature of the two existing tiers and only a verified offer enables it", async () => {
  const { productSchema } = await import("@trainer/contracts");
  const base = {
    name: "Fixture voice offer",
    description: "Coaching membership",
    priceMinor: 12000,
  };
  assert.equal(productSchema.parse(base).premiumVoice, false);
  assert.equal(
    productSchema.parse({ ...base, premiumVoice: true, tier: "workout" })
      .premiumVoice,
    true,
  );
  assert.equal(
    productSchema.parse({
      ...base,
      premiumVoice: true,
      tier: "workout_nutrition",
      baseProductId: randomUUID(),
    }).premiumVoice,
    true,
  );
  assert.equal(
    productSchema.safeParse({ ...base, premiumVoice: "true" }).success,
    false,
  );
  assert.equal(
    productSchema.safeParse({ ...base, tier: "voice" }).success,
    false,
  );
  await db.tenant(a, async (tx) => {
    for (const [priceId, flag] of [
      ["price_voice_fixture", true],
      ["price_plain_fixture", false],
      ["price_legacy_fixture", undefined],
    ] as const)
      await tx.query(
        "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,'product',$3,'published',$4)",
        [
          randomUUID(),
          a.tenantId,
          a.userId,
          JSON.stringify({
            ...base,
            stripePriceId: priceId,
            tier: "workout",
            modules: ["training"],
            ...(flag === undefined ? {} : { premiumVoice: flag }),
          }),
        ],
      );
  });
  const [currentVoiceState] = await db.tenant(a, (tx) =>
    tx.query("SELECT data FROM subscriptions WHERE user_id=$1", [
      client.userId,
    ]),
  );
  let time =
    Math.max(
      Math.floor(Date.now() / 1000),
      Number(currentVoiceState?.data?.lastStripeEventAt ?? 0),
    ) + 100;
  const project = async (priceId?: string) => {
    await processStripeEvent(
      db,
      signed(
        "customer.subscription.updated",
        {
          id: subId,
          object: "subscription",
          status: "active",
          current_period_end: time + 86400,
          metadata: {
            tenant_id: a.tenantId,
            user_id: client.userId,
            premiumVoice: "true",
          },
          ...(priceId ? { items: { data: [{ price: { id: priceId } }] } } : {}),
        },
        time++,
      ),
    );
    const [s] = await db.tenant(a, (tx) =>
      tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [client.userId]),
    );
    return s;
  };
  assert.equal((await project("price_voice_fixture")).data.premiumVoice, true);
  assert.equal((await project("price_plain_fixture")).data.premiumVoice, false);
  assert.equal((await project("price_voice_fixture")).data.premiumVoice, true);
  let state = await project("price_unknown_fixture");
  assert.equal(state.data.premiumVoice, false);
  assert.deepEqual(state.data.modules, []);
  assert.equal(
    (await project("price_legacy_fixture")).data.premiumVoice,
    false,
  );
  await db.tenant(a, (tx) =>
    tx.query(
      "UPDATE subscriptions SET data=(data-'priceId')||$2::jsonb WHERE user_id=$1",
      [
        client.userId,
        JSON.stringify({ premiumVoice: true, modules: ["training", "voice"] }),
      ],
    ),
  );
  state = await project();
  assert.equal(state.data.premiumVoice, false);
  assert.deepEqual(state.data.modules, ["training"]);
});
