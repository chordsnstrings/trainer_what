import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database, type Actor } from "@trainer/db";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import {
  preparePaidBooking,
  startBookingCheckout,
  refundCanceledBooking,
} from "../apps/api/src/finance-bookings.ts";

// Found by the end-to-end harness: Stripe sends charge.refunded for a refunded
// paid session as well as refund.created. The subscription ledger has no
// record of booking charges, so the event failed with HTTP 500 and would be
// retried forever. It now applies the refunds through the booking refund path.
// Which payload shape arrives depends on the webhook endpoint's API version:
// before 2022-11-15 a charge carried its refunds list (the failing case);
// from 2022-11-15 it does not, and the refund.* events carry the refund.
let db: Database;
const a: Actor = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
const client: Actor = { ...a, userId: randomUUID(), role: "subscriber" };
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const actor of [a, client])
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Booking refund fixture','not-a-real-login')",
        [actor.userId, actor.userId + "@example.test"],
      );
    await tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Booking refund fixture')", [a.tenantId, a.tenantId]);
    for (const actor of [a, client])
      await tx.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)", [a.tenantId, actor.userId, actor.role]);
  });
});
after(async () => db.close());

async function paidBooking(suffix: string) {
  const { slot, booking } = await db.tenant(a, async (tx) => {
    const [slot] = await tx.query(
      "INSERT INTO booking_slots(id,tenant_id,trainer_id,starts_at,ends_at,capacity,title,location,price_minor) VALUES($1,$2,$3,now()+interval '2 days',now()+interval '2 days 1 hour',1,'Paid session','Studio',15000) RETURNING *",
      [randomUUID(), a.tenantId, a.userId],
    );
    const [booking] = await tx.query(
      "INSERT INTO bookings(id,tenant_id,slot_id,user_id) VALUES($1,$2,$3,$4) RETURNING *",
      [randomUUID(), a.tenantId, slot.id, client.userId],
    );
    return { slot, booking };
  });
  // In the reserving follower's own scope: a follower never acts as staff.
  const payment = await db.tenant(client, (tx) => preparePaidBooking(tx, client, slot, booking));
  let remote: any;
  const pi = "pi_booking_" + suffix;
  const stripe = {
    checkout: {
      sessions: {
        create: async (body: any) =>
          (remote = { ...body, id: "cs_" + suffix, url: "https://checkout.stripe.com/c/" + suffix, currency: "aed", amount_total: 15000, payment_status: "paid", payment_intent: pi }),
      },
    },
    refunds: { create: async () => ({ id: "re_" + suffix }) },
  } as any;
  await startBookingCheckout(db, client, booking.id, stripe);
  await processStripeEvent(db, { id: "evt_paid_" + suffix, type: "checkout.session.completed", data: { object: remote } }, { stripe });
  await db.tenant(a, (tx) => tx.query("UPDATE bookings SET status='canceled' WHERE id=$1", [booking.id]));
  await refundCanceledBooking(db, a, booking.id, stripe);
  const refund = { id: "re_" + suffix, object: "refund", amount: 15000, currency: "aed", status: "succeeded", payment_intent: pi, charge: "ch_" + suffix, metadata: remote.metadata };
  const charge = { id: "ch_" + suffix, object: "charge", amount: 15000, amount_refunded: 15000, refunded: true, currency: "aed", payment_intent: pi, metadata: {}, refunds: { object: "list", data: [refund], has_more: false } };
  return { booking, payment: payment!, refund, charge };
}
async function state(bookingId: string, paymentId: string, refundId: string) {
  return db.tenant(a, async (tx) => ({
    booking: (await tx.query("SELECT status,payment_status FROM bookings WHERE id=$1", [bookingId]))[0],
    journals: (
      await tx.query("SELECT source_key FROM journals WHERE source_key=ANY($1::text[]) ORDER BY source_key", [
        ["booking-charge:" + paymentId, "booking-refund:" + refundId],
      ])
    ).map((r: any) => r.source_key),
  }));
}

test("API versions before 2022-11-15: charge.refunded after refund.created for a paid session is accepted and posts nothing twice", async () => {
  const { booking, payment, refund, charge } = await paidBooking("after");
  await processStripeEvent(db, { id: "evt_refund_after", type: "refund.created", data: { object: refund } });
  await processStripeEvent(db, { id: "evt_charge_after", type: "charge.refunded", data: { object: charge } });
  const s = await state(booking.id, payment.id, refund.id);
  assert.equal(s.booking.payment_status, "refunded");
  assert.deepEqual(s.journals, ["booking-charge:" + payment.id, "booking-refund:" + refund.id]);
});

test("API versions before 2022-11-15: charge.refunded alone confirms a paid-session refund once", async () => {
  const { booking, payment, refund, charge } = await paidBooking("alone");
  await processStripeEvent(db, { id: "evt_charge_alone", type: "charge.refunded", data: { object: charge } });
  await processStripeEvent(db, { id: "evt_charge_alone_retry", type: "charge.refunded", data: { object: charge } });
  const s = await state(booking.id, payment.id, refund.id);
  assert.equal(s.booking.payment_status, "refunded");
  assert.deepEqual(s.journals, ["booking-charge:" + payment.id, "booking-refund:" + refund.id]);
});

test("charge.refunded for an unrelated charge still takes the subscription path", async () => {
  await assert.rejects(
    processStripeEvent(db, {
      id: "evt_unmapped",
      type: "charge.refunded",
      data: { object: { id: "ch_unknown", object: "charge", payment_intent: "pi_unknown", refunds: { data: [], has_more: false } } },
    }),
    /mapping unresolved/,
  );
});

test("API versions from 2022-11-15: charge.refunded without a refunds list is accepted and changes nothing; refund.created confirms once", async () => {
  const { booking, payment, refund, charge } = await paidBooking("current");
  const { refunds: _embedded, ...current } = charge;
  await processStripeEvent(db, { id: "evt_charge_current", type: "charge.refunded", data: { object: current } });
  let s = await state(booking.id, payment.id, refund.id);
  assert.equal(s.booking.payment_status, "refunding", "no refund is inferred from the charge alone");
  assert.deepEqual(s.journals, ["booking-charge:" + payment.id]);
  await processStripeEvent(db, { id: "evt_refund_current", type: "refund.created", data: { object: refund } });
  await processStripeEvent(db, { id: "evt_charge_current_retry", type: "charge.refunded", data: { object: current } });
  s = await state(booking.id, payment.id, refund.id);
  assert.equal(s.booking.payment_status, "refunded");
  assert.deepEqual(s.journals, ["booking-charge:" + payment.id, "booking-refund:" + refund.id]);
});
