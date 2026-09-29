import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { createDatabase, putRecord, type Actor, type Database } from "@trainer/db";
import * as providers from "@trainer/providers";
import { stripeClient, withRuntimeConfig } from "@trainer/providers";
import { productSchema, voiceAddOnPriceSchema } from "@trainer/contracts";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import {
  createMembershipCheckout,
  reconcileMembershipCheckout,
} from "../apps/api/src/finance-checkout.ts";
import {
  billingHistory,
  changeRenewal,
  decideRefund,
  reconcileRenewal,
  requestRefund,
  subscriptionHasAccess,
} from "../apps/api/src/finance-billing.ts";
import {
  preparePaidBooking,
  refundCanceledBooking,
  startBookingCheckout,
} from "../apps/api/src/finance-bookings.ts";
import { closeMonth, monthCutoff } from "../apps/api/src/finance-operations.ts";
import { settlementBlockers } from "../apps/api/src/privacy-lifecycle.ts";
import { endFollowerMembership } from "../apps/api/src/membership-exit.ts";
import {
  addVoiceAddOn,
  endOrphanedVoiceAddOns,
} from "../apps/api/src/voice-addon.ts";
import { createPromotion } from "../apps/api/src/finance-promotions.ts";
import { platformAlertRules } from "../apps/api/src/platform-alerts.ts";
import { seedScope } from "./scope-fixtures.ts";
import {
  evt,
  fakeStripe,
  follower,
  offer,
  paidProgrammeSession,
  workspace,
  withEnv,
  type Member,
} from "./programme-fixtures.ts";

/**
 * Regression tests for the Stripe payment defects found on 29 September 2026
 * (docs/features/payments-stripe.md). Event payloads are shaped like the
 * live account's API version, 2026-06-24.dahlia: invoices carry no charge,
 * no payments list and no top-level subscription (the subscription and its
 * metadata are under parent.subscription_details), subscriptions carry their
 * period on the item, and every event has api_version and livemode. Stripe
 * itself is a local double; no key is configured and nothing leaves the test.
 */
const DAHLIA = "2026-06-24.dahlia";
const DAY = 86400000;
const noStripe = { STRIPE_SECRET_KEY: "" };
const options = { origin: "http://localhost:3000", nutritionReady: async () => {} };
let db: Database;
before(async () => {
  db = await createDatabase({ memory: true });
});
after(async () => db.close());

const nowSec = () => Math.floor(Date.now() / 1000);
function event(type: string, object: any, created = nowSec()) {
  return {
    id: "evt_" + randomUUID(),
    object: "event",
    api_version: DAHLIA,
    livemode: false,
    type,
    created,
    data: { object },
  };
}
function subscription(
  m: Actor,
  id: string,
  priceId: string,
  over: Record<string, any> = {},
) {
  const start = nowSec();
  return {
    id,
    object: "subscription",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    billing_mode: { type: "flexible" },
    created: start,
    start_date: start,
    metadata: { tenant_id: m.tenantId, user_id: m.userId },
    items: {
      object: "list",
      data: [
        {
          id: "si_" + id,
          object: "subscription_item",
          price: { id: priceId, object: "price", unit_amount: 30000, currency: "aed" },
          current_period_start: start,
          current_period_end: start + 30 * 86400,
        },
      ],
    },
    ...over,
  };
}
function invoice(
  m: Actor,
  id: string,
  subscriptionId: string,
  priceId: string,
  over: Record<string, any> = {},
) {
  const start = nowSec();
  return {
    id,
    object: "invoice",
    status: "paid",
    amount_paid: 30000,
    amount_due: 30000,
    currency: "aed",
    created: start,
    number: "INV-" + id,
    hosted_invoice_url: "https://invoice.stripe.com/i/" + id,
    parent: {
      type: "subscription_details",
      subscription_details: {
        subscription: subscriptionId,
        metadata: { tenant_id: m.tenantId, user_id: m.userId },
      },
    },
    lines: {
      object: "list",
      data: [
        {
          id: "il_" + id,
          amount: 30000,
          period: { start, end: start + 30 * 86400 },
          pricing: { type: "price_details", price_details: { price: priceId } },
        },
      ],
    },
    ...over,
  };
}
/** A Stripe double that answers invoice payments (basil+ webhooks omit them). */
function stripeDouble(over: Record<string, any> = {}) {
  const store = new Map<string, any>();
  const calls: Array<{ call: string; id?: string; body?: any; key?: string }> = [];
  const double: any = {
    calls,
    store,
    invoicePayments: {
      list: async ({ invoice: id }: any) => ({
        data: [
          {
            id: "inpay_" + id,
            status: "paid",
            payment: {
              type: "payment_intent",
              payment_intent: { id: "pi_" + id, latest_charge: "ch_" + id },
            },
          },
        ],
        has_more: false,
      }),
    },
    paymentIntents: { retrieve: async (id: string) => ({ id, latest_charge: "ch_" + id }) },
    subscriptions: {
      retrieve: async (id: string) => store.get(id) ?? { id, status: "active" },
      update: async (id: string, body: any, o: any) => {
        calls.push({ call: "subscription.update", id, body, key: o?.idempotencyKey });
        const sub = { ...(store.get(id) ?? { id, status: "active" }), ...body };
        if (body.cancel_at === "") sub.cancel_at = null;
        store.set(id, sub);
        return sub;
      },
      cancel: async (id: string, _b: any, o: any) => {
        calls.push({ call: "subscription.cancel", id, key: o?.idempotencyKey });
        const sub = { ...(store.get(id) ?? { id }), status: "canceled" };
        store.set(id, sub);
        return sub;
      },
    },
    ...over,
  };
  return double;
}
/** A Stripe API refusal as stripe-node raises it (HTTP 4xx: nothing was created). */
const refusal = (message: string, code: string, statusCode = 400) =>
  new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    message,
    code,
    statusCode,
  } as any);
const rows = (owner: Actor, sql: string, values: any[] = []) =>
  db.tenant(seedScope(owner, "finance"), (tx) => tx.query(sql, values));
const sub = async (owner: Actor, userId: string) =>
  (await rows(owner, "SELECT * FROM subscriptions WHERE user_id=$1", [userId]))[0];
const lines = async (owner: Actor, source: string) =>
  Object.fromEntries(
    (
      await rows(
        owner,
        "SELECT l.account,l.amount_minor::int AS amount FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.source_key=$1",
        [source],
      )
    ).map((r: any) => [r.account, r.amount]),
  );
const balance = async (owner: Actor, account: string, userId: string) =>
  Number(
    (
      await rows(
        owner,
        "SELECT coalesce(sum(l.amount_minor),0)::int AS n FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account=$1 AND (j.data->>'userId'=$2 OR j.source_key LIKE 'dispute-%')",
        [account, userId],
      )
    )[0].n,
  );
/** A paid monthly membership through dahlia-shaped events. */
async function paidMember(owner: Member, product: any, stripe = stripeDouble()) {
  const m = await follower(db, owner);
  const sid = "sub_" + randomUUID().slice(0, 12);
  const price = product.data.stripePriceId;
  await processStripeEvent(db, event("customer.subscription.created", subscription(m, sid, price)), { stripe });
  const inv = invoice(m, "in_" + randomUUID().slice(0, 12), sid, price);
  await processStripeEvent(db, event("invoice.paid", inv), { stripe });
  return { m, sid, inv, stripe, chargeId: "ch_" + inv.id };
}

test("F5: a plan change delivered after the proration invoice is applied from Stripe's current subscription", async () => {
  const owner = await workspace(db);
  const basic = await offer(db, owner, { modules: ["training"] });
  const plus = await offer(db, owner, { modules: ["training", "nutrition"], tier: "workout_nutrition" });
  const { m, sid, stripe } = await paidMember(owner, basic);
  const t = nowSec();
  const changed = subscription(m, sid, plus.data.stripePriceId);
  stripe.store.set(sid, changed);
  // The proration invoice (T+5) arrives first; the plan change (T) later.
  await processStripeEvent(
    db,
    event("invoice.paid", invoice(m, "in_prorate_" + randomUUID().slice(0, 8), sid, plus.data.stripePriceId, { amount_paid: 1000 }), t + 5),
    { stripe },
  );
  await processStripeEvent(db, event("customer.subscription.updated", changed, t), { stripe });
  const s = await sub(owner, m.userId);
  assert.equal(s.data.productId, plus.id, "the member has the plan they paid for");
  assert.deepEqual(s.data.modules, ["training", "nutrition"]);
});

test("F5: a late voice add-on change is applied from Stripe's current add-on subscription", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, { voiceStripePriceId: "price_voice_" + randomUUID().slice(0, 6), voiceAddOnMinor: 2000 });
  const { m, stripe } = await paidMember(owner, product);
  const vid = "sub_voice_" + randomUUID().slice(0, 8);
  const voice = (over: any = {}) => ({
    ...subscription(m, vid, product.data.voiceStripePriceId),
    metadata: { tenant_id: m.tenantId, user_id: m.userId, purpose: "voice_addon" },
    ...over,
  });
  const t = nowSec();
  await processStripeEvent(db, event("customer.subscription.created", voice(), t - 10), { stripe });
  await processStripeEvent(
    db,
    event("invoice.paid", {
      ...invoice(m, "in_voice_" + randomUUID().slice(0, 8), vid, product.data.voiceStripePriceId, { amount_paid: 2000 }),
      parent: { type: "subscription_details", subscription_details: { subscription: vid, metadata: { tenant_id: m.tenantId, user_id: m.userId, purpose: "voice_addon" } } },
    }, t + 5),
    { stripe },
  );
  // The member stopped the add-on at T; that event is delivered last.
  stripe.store.set(vid, voice({ cancel_at_period_end: true }));
  await processStripeEvent(db, event("customer.subscription.updated", voice({ cancel_at_period_end: true }), t), { stripe });
  assert.equal((await sub(owner, m.userId)).data.voiceAddOn.cancelAtPeriodEnd, true);
});

test("F6: an end scheduled with cancel_at shows as not renewing, and switching renewal back on clears cancel_at", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const { m, sid, stripe } = await paidMember(owner, product);
  const end = nowSec() + 30 * 86400;
  const scheduled = subscription(m, sid, product.data.stripePriceId, { cancel_at: end });
  stripe.store.set(sid, scheduled);
  await processStripeEvent(db, event("customer.subscription.updated", scheduled), { stripe });
  let s = await sub(owner, m.userId);
  assert.equal(s.cancel_at_period_end, true, "the membership does not renew");
  assert.equal(s.data.scheduledCancelAt, end);
  await changeRenewal(db, m, false, stripe);
  const call = stripe.calls.find((c: any) => c.call === "subscription.update");
  assert.deepEqual(call.body, { cancel_at: "" }, "cancel_at_period_end=false alone would leave cancel_at");
  s = await sub(owner, m.userId);
  assert.equal(s.cancel_at_period_end, false);
});

test("MONEY-5: a trial's AED 0 invoice and a proration never replace the membership's price", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, { priceMinor: 19900 });
  const m = await follower(db, owner);
  const sid = "sub_" + randomUUID().slice(0, 12);
  const stripe = stripeDouble();
  await processStripeEvent(db, event("invoice.paid", invoice(m, "in_trial_" + randomUUID().slice(0, 8), sid, product.data.stripePriceId, { amount_paid: 0, amount_due: 0 })), { stripe });
  assert.equal(Number((await sub(owner, m.userId)).price_minor), 19900, "the trial shows the offer's price");
  await processStripeEvent(db, event("invoice.paid", invoice(m, "in_pr_" + randomUUID().slice(0, 8), sid, product.data.stripePriceId, { amount_paid: 3750 }), nowSec() + 2), { stripe });
  assert.equal(Number((await sub(owner, m.userId)).price_minor), 19900, "a proration amount is not a price");
  const history = await billingHistory(db, m);
  assert.equal(Number(history.membership.price_minor), 19900);
});

test("STATE-8/MONEY-1: a failed renewal that is never paid no longer holds month closes and payouts", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  // A membership whose first payment failed (no money arrived, so the
  // month close has no Stripe receivable to settle).
  const m = await follower(db, owner);
  const sid = "sub_" + randomUUID().slice(0, 12);
  const stripe = stripeDouble();
  await processStripeEvent(db, event("customer.subscription.created", subscription(m, sid, product.data.stripePriceId, { status: "past_due" })), { stripe });
  const failed = invoice(m, "in_failed_" + randomUUID().slice(0, 8), sid, product.data.stripePriceId, { status: "open", amount_paid: 0 });
  await processStripeEvent(db, event("invoice.payment_failed", failed), { stripe });
  const record = async () =>
    (await rows(owner, "SELECT status,data FROM records WHERE kind='billing_invoice' AND data->>'invoiceId'=$1", [failed.id]))[0];
  assert.equal((await record()).status, "open");
  // The month before the failure is not held by it.
  const now = new Date();
  const month = (d: Date) => new Date(d.getTime() + 4 * 3600000).toISOString().slice(0, 7);
  const previous = month(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)));
  const close = (period: string, at: Date) =>
    db.tenant(owner, (tx) => closeMonth(tx, owner, period, "Synthetic close evidence", at));
  const closed = await close(previous, now);
  assert.equal(closed.data.period, previous);
  // Its own month is held while Stripe may still collect it ...
  const current = month(now);
  const after = new Date(monthCutoff(current).getTime() + 8 * DAY);
  await assert.rejects(close(current, after), /RECONCILIATION_REQUIRED|Resolve/);
  // ... and freed once the subscription ends (Stripe stops collecting).
  await processStripeEvent(db, event("customer.subscription.deleted", subscription(m, sid, product.data.stripePriceId, { status: "canceled" }), nowSec() + 5), { stripe });
  const ended = await record();
  assert.equal(ended.status, "uncollectible");
  assert.equal(ended.data.writtenOff, true);
  assert.equal((await close(current, after)).data.period, current);
  const blockers = await db.tenant(seedScope(owner, "finance"), (tx) => settlementBlockers(tx, m.userId));
  assert.ok(!blockers.some((b: any) => b.kind === "invoice"), "erasure is not held by it");
});

test("STATE-8/MONEY-1: invoice.voided and invoice.marked_uncollectible close the failed invoice; a later payment still wins", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const { m, sid, stripe } = await paidMember(owner, product);
  const status = async (id: string) =>
    (await rows(owner, "SELECT status FROM records WHERE kind='billing_invoice' AND data->>'invoiceId'=$1", [id]))[0]?.status;
  const a = invoice(m, "in_void_" + randomUUID().slice(0, 8), sid, product.data.stripePriceId, { status: "open", amount_paid: 0 });
  await processStripeEvent(db, event("invoice.payment_failed", a), { stripe });
  await processStripeEvent(db, event("invoice.voided", { ...a, status: "void" }), { stripe });
  assert.equal(await status(a.id), "void");
  // An older failure delivered late does not reopen it.
  await processStripeEvent(db, event("invoice.payment_failed", a, nowSec() - 60), { stripe });
  assert.equal(await status(a.id), "void");
  const b = invoice(m, "in_unc_" + randomUUID().slice(0, 8), sid, product.data.stripePriceId, { status: "open", amount_paid: 0 });
  await processStripeEvent(db, event("invoice.payment_failed", b), { stripe });
  await processStripeEvent(db, event("invoice.marked_uncollectible", { ...b, status: "uncollectible" }), { stripe });
  assert.equal(await status(b.id), "uncollectible");
  await processStripeEvent(db, event("invoice.paid", { ...b, status: "paid", amount_paid: 30000 }, nowSec() + 5), { stripe });
  assert.equal(await status(b.id), "paid");
  assert.equal((await lines(owner, "stripe-invoice:" + b.id)).stripe_receivable, 30000, "the late payment is posted");
});

test("MONEY-3: a lost full dispute after a partial refund posts only what Stripe kept, and commission is reversed once", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const { m, stripe, chargeId, inv } = await paidMember(owner, product);
  const charge = await lines(owner, "stripe-invoice:" + inv.id);
  const commission = -charge.platform_commission;
  const refund = { id: "re_" + randomUUID().slice(0, 8), object: "refund", amount: 12000, currency: "aed", status: "succeeded", charge: chargeId, payment_intent: "pi_" + inv.id, metadata: {} };
  await processStripeEvent(db, event("refund.created", refund), { stripe });
  const dispute = {
    id: "dp_" + randomUUID().slice(0, 8),
    object: "dispute",
    amount: 30000,
    currency: "aed",
    charge: chargeId,
    payment_intent: "pi_" + inv.id,
    status: "needs_response",
    metadata: {},
    balance_transactions: [{ id: "txn_w", object: "balance_transaction", amount: -30000, currency: "aed", fee: 5500 }],
  };
  await processStripeEvent(db, event("charge.dispute.created", dispute), { stripe });
  // Partially won: Stripe returns the refunded part and reports "lost".
  await processStripeEvent(db, event("charge.dispute.closed", {
    ...dispute,
    status: "lost",
    balance_transactions: [...dispute.balance_transactions, { id: "txn_r", object: "balance_transaction", amount: 12000, currency: "aed", fee: 0 }],
  }), { stripe });
  const lost = await lines(owner, "dispute-resolution:" + dispute.id);
  assert.equal(lost.stripe_receivable, -18000, "only the unrefunded part left the Stripe balance");
  assert.equal(await balance(owner, "stripe_receivable", m.userId), 0, "the charge's net cash is zero");
  assert.equal(await balance(owner, "platform_commission", m.userId), 0, "commission reversed exactly once");
  assert.ok(commission > 0);
});

test("MONEY-3: a dispute lost after a full refund takes nothing more", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const { m, stripe, chargeId, inv } = await paidMember(owner, product);
  await processStripeEvent(db, event("refund.created", { id: "re_" + randomUUID().slice(0, 8), object: "refund", amount: 30000, currency: "aed", status: "succeeded", charge: chargeId, metadata: {} }), { stripe });
  const dispute = { id: "dp_" + randomUUID().slice(0, 8), object: "dispute", amount: 30000, currency: "aed", charge: chargeId, payment_intent: "pi_" + inv.id, status: "lost", metadata: {}, balance_transactions: [{ amount: -30000, currency: "aed" }, { amount: 30000, currency: "aed" }] };
  await processStripeEvent(db, event("charge.dispute.closed", dispute), { stripe });
  assert.equal(await balance(owner, "stripe_receivable", m.userId), 0);
  assert.equal(await balance(owner, "platform_commission", m.userId), 0);
  assert.equal(await balance(owner, "trainer_payable", m.userId), 0, "the trainer owes nothing for money already returned");
});

test("STATE-4: a lost chargeback on an upfront programme ends its access as a full refund does", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, { billing: "upfront", programmeDays: 84, priceMinor: 90000 });
  const m = await follower(db, owner);
  const stripe = fakeStripe();
  const result = await createMembershipCheckout(db, m, { productId: product.id }, options, stripe);
  const [intent] = await rows(owner, "SELECT * FROM records WHERE id=$1", [result.intentId]);
  const session = paidProgrammeSession(intent);
  await processStripeEvent(db, evt("checkout.session.completed", session), { stripe });
  const before = await sub(owner, m.userId);
  assert.ok(subscriptionHasAccess(before));
  const [programme] = await rows(owner, "SELECT data FROM journals WHERE source_key LIKE 'stripe-programme:%' AND data->>'userId'=$1", [m.userId]);
  const dispute = { id: "dp_" + randomUUID().slice(0, 8), object: "dispute", amount: 90000, currency: "aed", charge: programme.data.chargeId, payment_intent: session.payment_intent, status: "lost", metadata: {}, balance_transactions: [{ amount: -90000, currency: "aed" }] };
  await processStripeEvent(db, event("charge.dispute.closed", dispute), { stripe });
  const afterDispute = await sub(owner, m.userId);
  assert.equal(subscriptionHasAccess(afterDispute), false, "a won chargeback does not keep the programme");
});

test("STATE-1: a checkout Stripe refuses is closed, so the member can buy again and leave", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const m = await follower(db, owner);
  const refusing = fakeStripe({
    checkout: {
      sessions: {
        create: async () => {
          throw refusal("The coupon has reached its redemption limit", "coupon_expired");
        },
      },
    },
  });
  await assert.rejects(createMembershipCheckout(db, m, { productId: product.id }, options, refusing), /redemption limit/);
  const [refused] = await rows(owner, "SELECT status,data FROM records WHERE kind='checkout' AND owner_user_id=$1", [m.userId]);
  assert.equal(refused.status, "closed");
  assert.equal(refused.data.providerRefusal.code, "coupon_expired");
  const [blockers] = await db.tenant(m, (tx) => tx.query("SELECT * FROM membership_exit_blockers($1)", [m.userId]));
  assert.equal(blockers.checkout, 0, "leaving is not refused");
  const ok = fakeStripe();
  const next = await createMembershipCheckout(db, m, { productId: product.id }, options, ok);
  assert.ok(next.url, "a new purchase starts");
});

test("STATE-1: a voice add-on checkout Stripe refuses is closed, so it can be bought again", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, { voiceStripePriceId: "price_vr_" + randomUUID().slice(0, 6), voiceAddOnMinor: 2000 });
  const { m } = await paidMember(owner, product);
  const refusing = fakeStripe({ checkout: { sessions: { create: async () => { throw refusal("No such price", "resource_missing", 404); } } } });
  await assert.rejects(addVoiceAddOn(db, m, options, () => refusing, () => refusing), /No such price/);
  const [refused] = await rows(owner, "SELECT status FROM records WHERE kind='checkout' AND owner_user_id=$1", [m.userId]);
  assert.equal(refused.status, "closed");
  const ok = fakeStripe();
  const next = await addVoiceAddOn(db, m, options, () => ok, () => ok);
  assert.ok(next.url);
});

test("STATE-1: an uncertain checkout Stripe never created expires after its own expiry", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const m = await follower(db, owner);
  const lost = fakeStripe({
    checkout: {
      sessions: {
        create: async () => {
          throw new Error("Synthetic timeout");
        },
        list: async () => ({ data: [], has_more: false }),
      },
    },
  });
  await assert.rejects(createMembershipCheckout(db, m, { productId: product.id }, options, lost), /Synthetic timeout/);
  const [r] = await rows(owner, "SELECT * FROM records WHERE kind='checkout' AND owner_user_id=$1", [m.userId]);
  assert.equal(r.status, "unknown");
  await rows(owner, "UPDATE records SET data=data||$2::jsonb WHERE id=$1", [r.id, JSON.stringify({ expiresAt: new Date(Date.now() - 20 * 60000).toISOString() })]);
  assert.deepEqual(await reconcileMembershipCheckout(db, m, lost), { status: "expired", url: undefined });
  const [after] = await rows(owner, "SELECT status FROM records WHERE id=$1", [r.id]);
  assert.equal(after.status, "expired");
});

test("STATE-1: a renewal switch Stripe refuses fails instead of holding the member's exit", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const { m, sid } = await paidMember(owner, product);
  const stripe = stripeDouble();
  stripe.subscriptions.update = async () => {
    throw refusal("A canceled subscription can only update its cancellation_details and metadata.", "resource_missing");
  };
  await assert.rejects(changeRenewal(db, m, true, stripe), /canceled subscription/);
  const [t] = await rows(owner, "SELECT status,data FROM records WHERE kind='subscription_transition' AND owner_user_id=$1", [m.userId]);
  assert.equal(t.status, "failed");
  const [blockers] = await db.tenant(m, (tx) => tx.query("SELECT * FROM membership_exit_blockers($1)", [m.userId]));
  assert.equal(blockers.renewal, 0);
  // An uncertain switch whose effect Stripe still does not show long after is settled too.
  const lost = stripeDouble();
  lost.subscriptions.update = async () => {
    throw new Error("Synthetic timeout");
  };
  await assert.rejects(changeRenewal(db, m, true, lost), /Synthetic timeout/);
  await rows(owner, "UPDATE records SET created_at=now()-interval '1 hour' WHERE kind='subscription_transition' AND owner_user_id=$1 AND status='unknown'", [m.userId]);
  lost.store.set(sid, { id: sid, status: "active", cancel_at_period_end: false, cancel_at: null });
  await reconcileRenewal(db, m, lost);
  const statuses = (await rows(owner, "SELECT status FROM records WHERE kind='subscription_transition' AND owner_user_id=$1 ORDER BY created_at", [m.userId])).map((r: any) => r.status);
  assert.deepEqual(statuses, ["failed", "failed"]);
});

test("STATE-1/MONEY-2: a member refund Stripe refuses, cancels or fails can be requested again; a refund returned after it succeeded is reversed", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const { m, stripe, chargeId } = await paidMember(owner, product);
  const request = () => requestRefund(db, m, { chargeId, reason: "Not what I expected" });
  const approve = (id: string, s: any) => decideRefund(db, owner, id, { approve: true, reason: "Approved in review" }, false, s);
  // Refused (the charge is disputed): nothing moved.
  let r = await request();
  const refusing = stripeDouble({ refunds: { create: async () => { throw refusal("Charge ch_x has been charged back; cannot issue a refund.", "charge_disputed"); } } });
  await assert.rejects(approve(r.id, refusing), /charged back/);
  assert.equal((await rows(owner, "SELECT status FROM records WHERE id=$1", [r.id]))[0].status, "failed");
  // Canceled at Stripe: final, nothing moved.
  r = await request();
  await approve(r.id, stripeDouble({ refunds: { create: async () => ({ id: "re_c_" + r.id.slice(0, 6), status: "pending" }) } }));
  await processStripeEvent(db, event("refund.updated", { id: "re_c_" + r.id.slice(0, 6), object: "refund", amount: 30000, currency: "aed", status: "canceled", charge: chargeId, metadata: { refund_request_id: r.id } }), { stripe });
  assert.equal((await rows(owner, "SELECT status FROM records WHERE id=$1", [r.id]))[0].status, "failed");
  // Succeeded, then returned by the bank: the posting is reversed.
  r = await request();
  const refundId = "re_s_" + r.id.slice(0, 6);
  await approve(r.id, stripeDouble({ refunds: { create: async () => ({ id: refundId, status: "succeeded" }) } }));
  const refund = { id: refundId, object: "refund", amount: 30000, currency: "aed", status: "succeeded", charge: chargeId, metadata: { refund_request_id: r.id } };
  await processStripeEvent(db, event("refund.updated", refund), { stripe });
  assert.equal(await balance(owner, "stripe_receivable", m.userId), 0);
  await processStripeEvent(db, event("refund.updated", { ...refund, status: "failed" }, nowSec() + 5), { stripe });
  assert.equal(await balance(owner, "stripe_receivable", m.userId), 30000, "the returned money is on the Stripe balance again");
  assert.equal((await rows(owner, "SELECT status FROM records WHERE id=$1", [r.id]))[0].status, "failed");
  const history = await billingHistory(db, m);
  assert.equal(history.charges[0].remainingMinor, 30000);
  assert.equal(history.charges[0].eligible, true, "the member may ask again");
});

async function bookingWorkspace(price = 15000) {
  const owner = await workspace(db);
  const m = await follower(db, owner);
  const { slot, booking } = await db.tenant(seedScope(owner), async (tx) => {
    const [slot] = await tx.query(
      "INSERT INTO booking_slots(id,tenant_id,trainer_id,starts_at,ends_at,capacity,title,location,price_minor) VALUES($1,$2,$3,now()+interval '2 days',now()+interval '2 days 1 hour',1,'Paid session','Studio',$4) RETURNING *",
      [randomUUID(), owner.tenantId, owner.userId, price],
    );
    const [booking] = await tx.query(
      "INSERT INTO bookings(id,tenant_id,slot_id,user_id) VALUES($1,$2,$3,$4) RETURNING *",
      [randomUUID(), owner.tenantId, slot.id, m.userId],
    );
    return { slot, booking };
  });
  // A 10% booking fee, so refunds reverse a commission.
  await db.tenant(seedScope(owner, "finance"), (tx) =>
    putRecord(
      tx,
      seedScope(owner, "finance"),
      "finance_policy",
      {
        effectiveAt: new Date(Date.now() - DAY).toISOString(),
        commissionBps: [2500, 2000, 1500, 1000],
        bookingFeeBps: 1000,
        graceDays: 3,
        reason: "Fixture booking fee",
        revision: null,
      },
      { status: "published", ownerId: owner.userId },
    ),
  );
  return { owner, m, slot, booking };
}
async function paidSession() {
  const { owner, m, slot, booking } = await bookingWorkspace();
  const payment = await db.tenant(m, (tx) => preparePaidBooking(tx, m, slot, booking));
  let remote: any;
  const pi = "pi_bk_" + randomUUID().slice(0, 8);
  const refunds: any[] = [];
  const stripe: any = {
    refunds,
    checkout: {
      sessions: {
        create: async (body: any) =>
          (remote = { ...body, id: "cs_" + pi, url: "https://checkout.stripe.com/c/" + pi, currency: "aed", amount_total: 15000, payment_status: "paid", payment_intent: pi }),
      },
    },
    refunds_create_calls: 0,
  };
  stripe.refunds = {
    create: async (body: any, o: any) => {
      stripe.refunds_create_calls++;
      const r = { id: "re_bk_" + stripe.refunds_create_calls + "_" + pi, amount: body.amount, metadata: body.metadata, key: o?.idempotencyKey };
      refunds.push(r);
      return r;
    },
  };
  await startBookingCheckout(db, m, booking.id, stripe);
  await processStripeEvent(db, event("checkout.session.completed", remote), { stripe });
  return { owner, m, booking, payment: payment!, pi, stripe, refunds };
}
const bookingState = async (owner: Actor, bookingId: string) =>
  db.tenant(seedScope(owner), async (tx) => ({
    booking: (await tx.query("SELECT status,payment_status FROM bookings WHERE id=$1", [bookingId]))[0],
    payment: (await tx.query("SELECT status,data FROM records WHERE kind='booking_payment' AND data->>'bookingId'=$1", [bookingId]))[0],
  }));

test("MONEY-2: a failed session refund frees the month close and can be sent again; a Dashboard refund is then accepted", async () => {
  const { owner, booking, pi, stripe, refunds, payment } = await paidSession();
  await db.tenant(seedScope(owner), (tx) => tx.query("UPDATE bookings SET status='canceled' WHERE id=$1", [booking.id]));
  await refundCanceledBooking(db, owner, booking.id, stripe);
  const first = refunds[0];
  await processStripeEvent(db, event("refund.updated", { id: first.id, object: "refund", amount: 15000, currency: "aed", status: "failed", failure_reason: "expired_or_canceled_card", payment_intent: pi, metadata: first.metadata }));
  let s = await bookingState(owner, booking.id);
  assert.equal(s.payment.status, "refund_failed");
  assert.equal(s.booking.payment_status, "refund_failed");
  const period = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const at = new Date(monthCutoff(period).getTime() + 8 * DAY);
  // The failed refund no longer holds the close (the paid session's Stripe
  // receivable, the next check, still needs its settlement).
  await assert.rejects(
    db.tenant(owner, (tx) => closeMonth(tx, owner, period, "Synthetic close evidence", at)),
    (e: any) => e.code === "SETTLEMENT_REQUIRED",
  );
  // Sent again as a new instruction (a new idempotency key).
  await refundCanceledBooking(db, owner, booking.id, stripe);
  assert.equal(refunds.length, 2);
  assert.notEqual(refunds[1].key, refunds[0].key);
  // The trainer refunds it in the Dashboard instead; that refund is accepted.
  await processStripeEvent(db, event("refund.created", { id: "re_dashboard_" + pi, object: "refund", amount: 15000, currency: "aed", status: "succeeded", payment_intent: pi, metadata: {} }));
  s = await bookingState(owner, booking.id);
  assert.equal(s.payment.status, "refunded");
  assert.equal(s.booking.payment_status, "refunded");
});

test("MONEY-4 and the refund-reversal gap: a partial Dashboard refund of a session is posted pro rata; one returned later is reversed", async () => {
  const { owner, booking, pi, payment } = await paidSession();
  const partial = { id: "re_part_" + pi, object: "refund", amount: 5000, currency: "aed", status: "succeeded", payment_intent: pi, metadata: {} };
  await processStripeEvent(db, event("refund.created", partial));
  const posted = await lines(owner, "booking-refund:" + partial.id);
  assert.equal(posted.stripe_receivable, -5000);
  const commission = Number(payment.data.commissionMinor);
  assert.equal(commission, 1500);
  assert.equal(posted.platform_commission, 500, "commission reversed pro rata");
  let s = await bookingState(owner, booking.id);
  assert.equal(s.payment.status, "paid", "the session stays paid");
  await processStripeEvent(db, event("refund.updated", { ...partial, status: "failed" }, nowSec() + 5));
  assert.equal((await lines(owner, "booking-refund-reversal:" + partial.id)).stripe_receivable, 5000);
});

test("STATE-1/F2: a session Stripe cannot charge is refused before Stripe, and a refused checkout releases the seat", async () => {
  const cheap = await bookingWorkspace(150);
  await assert.rejects(
    db.tenant(cheap.m, (tx) => preparePaidBooking(tx, cheap.m, cheap.slot, cheap.booking)),
    /at least AED 2.00/,
  );
  const { owner, m, slot, booking } = await bookingWorkspace();
  await db.tenant(m, (tx) => preparePaidBooking(tx, m, slot, booking));
  const refusing: any = { checkout: { sessions: { create: async () => { throw refusal("Amount must be at least 2.00 aed", "amount_too_small"); } } } };
  await assert.rejects(startBookingCheckout(db, m, booking.id, refusing), /at least 2.00/);
  const s = await bookingState(owner, booking.id);
  assert.equal(s.payment.status, "canceled");
  assert.equal(s.booking.status, "canceled");
  const [blockers] = await db.tenant(m, (tx) => tx.query("SELECT * FROM membership_exit_blockers($1)", [m.userId]));
  assert.equal(blockers.checkout, 0);
});

test("F2: offers, add-ons and discounts below Stripe's AED 2.00 minimum are refused", async () => {
  const base = { name: "Tiny", description: "Fixture", tier: "workout" };
  assert.equal(productSchema.safeParse({ ...base, priceMinor: 150 }).success, false);
  assert.equal(productSchema.safeParse({ ...base, priceMinor: 200 }).success, true);
  assert.equal(voiceAddOnPriceSchema.safeParse(150).success, false);
  const owner = await workspace(db);
  const old = await offer(db, owner, { priceMinor: 150 });
  const m = await follower(db, owner);
  const stripe = fakeStripe();
  await assert.rejects(createMembershipCheckout(db, m, { productId: old.id }, options, stripe), /AED 2.00/);
  assert.equal(stripe.calls.length, 0, "no provider instruction");
  const priced = await offer(db, owner, { priceMinor: 300 });
  await assert.rejects(
    createPromotion(db, owner, { code: "HALFOFF", productId: priced.id, percentOff: 50, maxRedemptions: 5, expiresAt: new Date(Date.now() + DAY).toISOString(), reason: "Launch offer" }, fakeStripe()),
    /AED 1.50/,
  );
});

test("STATE-3/STATE-5: leaving with an unpaid renewal ends the subscription now, so a later retry cannot charge a former member", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const { m, sid } = await paidMember(owner, product);
  await rows(owner, "UPDATE subscriptions SET status='past_due' WHERE user_id=$1", [m.userId]);
  const stripe = stripeDouble();
  await endFollowerMembership(db, { tenantId: m.tenantId, followerId: m.userId, actorId: m.userId, kind: "left", stripe: () => stripe });
  assert.deepEqual(stripe.calls.map((c: any) => c.call), ["subscription.cancel"], "cancelled now, not at period end");
  assert.equal((await sub(owner, m.userId)).status, "canceled");
  // STATE-5: an unpaid membership can be cancelled by the member.
  const other = await paidMember(owner, product);
  await rows(owner, "UPDATE subscriptions SET status='unpaid' WHERE user_id=$1", [other.m.userId]);
  const s2 = stripeDouble();
  await changeRenewal(db, other.m, true, s2);
  assert.deepEqual(s2.calls.map((c: any) => c.call), ["subscription.cancel"]);
  assert.equal((await sub(owner, other.m.userId)).status, "canceled");
  assert.ok(sid);
});

test("STATE-2: the renewal gap neither cancels a paid voice add-on nor removes membership access", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, { voiceStripePriceId: "price_v_" + randomUUID().slice(0, 6), voiceAddOnMinor: 2000 });
  const { m } = await paidMember(owner, product);
  await rows(
    owner,
    "UPDATE subscriptions SET period_end=now()-interval '20 seconds',data=data||$2::jsonb WHERE user_id=$1",
    [m.userId, JSON.stringify({ voiceAddOn: { providerId: "sub_v_gap", status: "active", verified: true, periodEnd: new Date(Date.now() + 15 * DAY).toISOString(), cancelAtPeriodEnd: false, priceId: product.data.voiceStripePriceId, productId: product.id, lastStripeEventAt: nowSec() - 100 } })],
  );
  const stripe = stripeDouble();
  const result = await endOrphanedVoiceAddOns(db, owner.tenantId, seedScope(owner), stripe);
  assert.equal(result.ended, 0);
  assert.deepEqual(stripe.calls, [], "Stripe still bills the membership: the add-on stays");
  assert.equal(subscriptionHasAccess(await sub(owner, m.userId)), true, "access continues until the renewal arrives");
  // A membership Stripe ended does end the add-on.
  await rows(owner, "UPDATE subscriptions SET status='canceled' WHERE user_id=$1", [m.userId]);
  const ended = await endOrphanedVoiceAddOns(db, owner.tenantId, seedScope(owner), stripe);
  assert.equal(ended.ended, 1);
});

/** Posts a correctly signed webhook to the real route. */
async function webhook(app: any, payload: any, secret: string) {
  const raw = JSON.stringify(payload),
    t = nowSec(),
    v1 = createHmac("sha256", secret).update(t + "." + raw).digest("hex");
  return app.inject({
    url: "/api/v1/webhooks/stripe",
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", "stripe-signature": `t=${t},v1=${v1}` },
    payload: raw,
  });
}

const webhookStatus = async (id: string) =>
  (await db.system((tx) => tx.query("SELECT status FROM provider_events WHERE external_id=$1", [id])))[0]?.status;

test("F7: the webhook route refuses an event of the other Stripe mode", async () => {
  const { buildApp } = await import("../apps/api/src/app.ts");
  const secret = "whsec_fixture_not_a_credential";
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_fixture_not_a_credential", STRIPE_WEBHOOK_SECRET: secret }, async () => {
    const app = await buildApp({ db, testing: true });
    try {
      // A live event beside a test-mode key grants nothing and is not stored.
      const owner = await workspace(db);
      const product = await offer(db, owner, {});
      const m = await follower(db, owner);
      const live = { ...event("invoice.paid", invoice(m, "in_live_" + randomUUID().slice(0, 6), "sub_live", product.data.stripePriceId, { charge: "ch_live" })), livemode: true };
      const refused = await webhook(app, live, secret);
      assert.equal(refused.statusCode, 400);
      assert.equal(refused.json().code, "STRIPE_MODE_MISMATCH");
      assert.equal(await webhookStatus(live.id), undefined);
      assert.equal(await sub(owner, m.userId), undefined, "no paid access");
      // The same event in the key's mode is processed.
      const test = { ...live, id: "evt_" + randomUUID(), livemode: false };
      assert.equal((await webhook(app, test, secret)).statusCode, 200);
      assert.equal((await sub(owner, m.userId)).status, "active");
    } finally {
      await app.close();
    }
  });
});

test("F3/F4: the webhook route parks events for objects the platform never created, and alerts on them and on an unverified API version", async () => {
  const { buildApp } = await import("../apps/api/src/app.ts");
  const secret = "whsec_fixture_not_a_credential";
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_fixture_not_a_credential", STRIPE_WEBHOOK_SECRET: secret }, async () => {
    const app = await buildApp({ db, testing: true });
    try {
      const status = webhookStatus;
      // A Dashboard invoice, a Payment Link subscription checkout and an
      // old refund of someone else's charge are acknowledged and parked.
      const foreignInvoice = event("invoice.paid", { id: "in_dashboard", object: "invoice", status: "paid", amount_paid: 5000, currency: "aed", parent: null, metadata: {} });
      const foreignCheckout = event("checkout.session.completed", { id: "cs_link", object: "checkout.session", mode: "subscription", status: "complete", subscription: "sub_link", metadata: {}, client_reference_id: null });
      const oldRefund = event("refund.created", { id: "re_other", object: "refund", amount: 100, currency: "aed", status: "succeeded", charge: "ch_other", metadata: {} }, nowSec() - 7200);
      for (const e of [foreignInvoice, foreignCheckout, oldRefund]) {
        const response = await webhook(app, e, secret);
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().parked, true);
        assert.equal(await status(e.id), "parked");
      }
      // A fresh refund of an unknown charge may still be waiting for its
      // charge: it keeps failing so Stripe retries.
      const fresh = event("refund.created", { id: "re_fresh", object: "refund", amount: 100, currency: "aed", status: "succeeded", charge: "ch_unknown_yet", metadata: {} });
      assert.equal((await webhook(app, fresh, secret)).statusCode, 500);
      // F4: a payload version the handling was not verified against.
      const endive = { ...event("customer.subscription.updated", { id: "sub_x", object: "subscription", metadata: {} }), api_version: "2026-09-30.endive" };
      await webhook(app, endive, secret);
      const context = { db, now: new Date(), tenantSignals: async () => [] };
      const rules = new Map(platformAlertRules().map((r) => [r.id, r]));
      const parked = await rules.get("stripe.events_parked")!.evaluate(context as any);
      assert.equal(parked.length, 1);
      // The three above and the endive subscription event (no platform metadata).
      assert.match(parked[0].detail, /4 Stripe event/);
      const version = await rules.get("stripe.webhook_api_version")!.evaluate(context as any);
      assert.deepEqual(version.map((a) => a.dedupeKey), ["stripe.webhook_api_version:2026-09-30.endive"]);
    } finally {
      await app.close();
    }
  });
});

test("F3: an app invoice marked paid outside Stripe renews access after the retry window and leaves the money to finance, once", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const { m, sid } = await paidMember(owner, product);
  const noPayment = stripeDouble({ invoicePayments: { list: async () => ({ data: [], has_more: false }) } });
  const paid = invoice(m, "in_oob_" + randomUUID().slice(0, 8), sid, product.data.stripePriceId);
  // While its payment may still be arriving, the event keeps failing.
  await assert.rejects(processStripeEvent(db, event("invoice.paid", paid), { stripe: noPayment }), /identity unresolved/);
  const late = event("invoice.paid", paid, nowSec() - 7200);
  await processStripeEvent(db, late, { stripe: noPayment });
  await processStripeEvent(db, { ...late, id: "reconcile-invoice:" + paid.id + ":paid" }, { stripe: noPayment });
  assert.equal((await sub(owner, m.userId)).status, "active");
  assert.deepEqual(await lines(owner, "stripe-invoice:" + paid.id), {}, "no Stripe charge is invented");
  const open = await rows(owner, "SELECT status FROM records WHERE kind='reconciliation' AND data->>'invoiceId'=$1", [paid.id]);
  assert.deepEqual(open.map((r: any) => r.status), ["open"]);
});

test("F4: every Stripe request is pinned to the API version the SDK was generated for", () => {
  // A new stripe-node major changes this constant's type check and this test.
  assert.equal((providers as any).STRIPE_API_VERSION, "2026-08-26.dahlia");
  const client: any = withRuntimeConfig(
    { STRIPE_SECRET_KEY: "sk_test_fixture_not_a_credential" },
    () => stripeClient(),
  );
  assert.equal(client.getApiField("version"), "2026-08-26.dahlia");
});

test("gap: Commerce approved off refuses a membership checkout before any intent is reserved", async () => {
  const { buildApp } = await import("../apps/api/src/app.ts");
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const m = await follower(db, owner);
  await withEnv({ STRIPE_SECRET_KEY: "sk_test_fixture_not_a_credential", COMMERCE_APPROVED: "false" }, async () => {
    const app = await buildApp({ db, testing: true });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/payments/checkout",
        headers: { origin: "http://localhost:3000", cookie: "session=" + m.token },
        payload: { productId: product.id },
      });
      assert.equal(response.statusCode, 503, response.body);
    } finally {
      await app.close();
    }
  });
  assert.equal((await rows(owner, "SELECT id FROM records WHERE kind='checkout' AND owner_user_id=$1", [m.userId])).length, 0);
});

test("gap: a voice add-on's failed renewal is mirrored as past due with an open invoice, and async payment events are handled", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, { voiceStripePriceId: "price_v2_" + randomUUID().slice(0, 6), voiceAddOnMinor: 2000 });
  const { m, stripe } = await paidMember(owner, product);
  const vid = "sub_voice2_" + randomUUID().slice(0, 8);
  const meta = { tenant_id: m.tenantId, user_id: m.userId, purpose: "voice_addon" };
  await processStripeEvent(db, event("customer.subscription.created", { ...subscription(m, vid, product.data.voiceStripePriceId), metadata: meta }, nowSec() - 10), { stripe });
  const failed = { ...invoice(m, "in_vfail_" + randomUUID().slice(0, 6), vid, product.data.voiceStripePriceId, { status: "open", amount_paid: 0, amount_due: 2000 }), parent: { type: "subscription_details", subscription_details: { subscription: vid, metadata: meta } } };
  await processStripeEvent(db, event("invoice.payment_failed", failed), { stripe });
  assert.equal((await sub(owner, m.userId)).data.voiceAddOn.status, "past_due");
  const [record] = await rows(owner, "SELECT status FROM records WHERE kind='billing_invoice' AND data->>'invoiceId'=$1", [failed.id]);
  assert.equal(record.status, "open");
  // A delayed membership payment: async_payment_succeeded completes the
  // intent like checkout.session.completed; async_payment_failed grants nothing.
  const buyer = await follower(db, owner);
  const s2 = fakeStripe();
  const started = await createMembershipCheckout(db, buyer, { productId: product.id }, options, s2);
  const [intent] = await rows(owner, "SELECT * FROM records WHERE id=$1", [started.intentId]);
  const session = { id: intent.data.providerId, object: "checkout.session", mode: "subscription", status: "complete", payment_status: "unpaid", subscription: "sub_async_" + buyer.userId.slice(0, 6), client_reference_id: intent.id, metadata: { tenant_id: buyer.tenantId, user_id: buyer.userId, intent_id: intent.id, product_id: product.id } };
  await processStripeEvent(db, event("checkout.session.async_payment_failed", session), { stripe: s2 });
  assert.equal(subscriptionHasAccess(await sub(owner, buyer.userId)), false);
  await processStripeEvent(db, event("checkout.session.async_payment_succeeded", { ...session, payment_status: "paid" }), { stripe: s2 });
  const [done] = await rows(owner, "SELECT status FROM records WHERE id=$1", [intent.id]);
  assert.equal(done.status, "completed");
});

test("gap: a refund that arrives before its charge is retried, then applied once the charge is recorded", async () => {
  const owner = await workspace(db);
  const product = await offer(db, owner, {});
  const m = await follower(db, owner);
  const stripe = stripeDouble();
  const sid = "sub_" + randomUUID().slice(0, 12);
  const inv = invoice(m, "in_early_" + randomUUID().slice(0, 8), sid, product.data.stripePriceId);
  const refund = event("refund.created", { id: "re_early_" + inv.id, object: "refund", amount: 30000, currency: "aed", status: "succeeded", charge: "ch_" + inv.id, metadata: {} });
  await assert.rejects(processStripeEvent(db, refund, { stripe }), (e: any) => !e.unmatched);
  await processStripeEvent(db, event("invoice.paid", inv), { stripe });
  await processStripeEvent(db, refund, { stripe });
  assert.equal(await balance(owner, "stripe_receivable", m.userId), 0);
});
