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
  const rows = await db.tenant({ ...a, role: "staff" }, tx => tx.query("SELECT * FROM records WHERE kind IN ('billing_invoice','subscription_transition')"));
  assert.equal(rows.length, 0);
});
