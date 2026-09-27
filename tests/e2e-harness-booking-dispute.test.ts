import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabase, type Database, type Actor } from "@trainer/db";
import { processStripeEvent } from "../apps/api/src/stripe-events.ts";
import { preparePaidBooking, startBookingCheckout } from "../apps/api/src/finance-bookings.ts";

// Found by the end-to-end harness: a card dispute on a paid coaching session
// failed the Stripe webhook with HTTP 500 ("Disputed charge has not been
// reconciled"), because the dispute path looked only for subscription invoice
// journals. Stripe would retry for days and the disputed money was never
// reserved, so the trainer could be paid out money the bank then took back.
// The session charge journal is now found by its payment intent and the same
// reserve, release and loss journals as a membership dispute are posted.
let db: Database;
const a: Actor = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
const client: Actor = { ...a, userId: randomUUID(), role: "subscriber" };
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const actor of [a, client])
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Booking dispute fixture','not-a-real-login')",
        [actor.userId, actor.userId + "@example.test"],
      );
    await tx.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Booking dispute fixture')", [a.tenantId, a.tenantId]);
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
  const payment = await db.tenant({ ...client, role: "staff" }, (tx) => preparePaidBooking(tx, client, slot, booking));
  let remote: any;
  const pi = "pi_dispute_" + suffix;
  const stripe = {
    checkout: {
      sessions: {
        create: async (body: any) =>
          (remote = { ...body, id: "cs_" + suffix, url: "https://checkout.stripe.com/c/" + suffix, currency: "aed", amount_total: 15000, payment_status: "paid", payment_intent: pi }),
      },
    },
  } as any;
  await startBookingCheckout(db, client, booking.id, stripe);
  await processStripeEvent(db, { id: "evt_paid_" + suffix, type: "checkout.session.completed", data: { object: remote } }, { stripe });
  const dispute = (status: string) => ({
    id: "dp_" + suffix,
    object: "dispute",
    amount: 15000,
    currency: "aed",
    charge: "ch_" + suffix,
    payment_intent: pi,
    status,
    metadata: {},
  });
  return { payment: payment!, dispute };
}
const ledger = (paymentId: string, disputeId: string) =>
  db.tenant(a, async (tx) =>
    (
      await tx.query(
        "SELECT j.source_key,l.account,l.amount_minor::int AS amount FROM journals j JOIN journal_lines l ON l.journal_id=j.id WHERE j.source_key=ANY($1::text[]) ORDER BY j.source_key,l.account",
        [["booking-charge:" + paymentId, "dispute-reserve:" + disputeId, "dispute-resolution:" + disputeId]],
      )
    ).map((r: any) => `${r.source_key.split(":")[0]} ${r.account} ${r.amount}`),
  );

test("a dispute on a paid-session charge is reserved, and a lost dispute is posted once", async () => {
  const { payment, dispute } = await paidBooking("lost");
  await processStripeEvent(db, { id: "evt_dispute_created", type: "charge.dispute.created", data: { object: dispute("needs_response") } });
  await processStripeEvent(db, { id: "evt_dispute_created_retry", type: "charge.dispute.created", data: { object: dispute("needs_response") } });
  await processStripeEvent(db, { id: "evt_dispute_lost", type: "charge.dispute.closed", data: { object: dispute("lost") } });
  const lines = await ledger(payment.id, "dp_lost");
  assert.ok(lines.includes("dispute-reserve dispute_reserve -15000"), lines.join("\n"));
  assert.ok(lines.includes("dispute-reserve trainer_payable 15000"));
  assert.ok(lines.includes("dispute-resolution stripe_receivable -15000"));
  assert.equal(lines.filter((l) => l.startsWith("dispute-reserve")).length, 2, "the reserve is posted once");
});

test("a won dispute on a paid-session charge releases the reserve", async () => {
  const { payment, dispute } = await paidBooking("won");
  await processStripeEvent(db, { id: "evt_dispute_created_won", type: "charge.dispute.created", data: { object: dispute("needs_response") } });
  await processStripeEvent(db, { id: "evt_dispute_won", type: "charge.dispute.closed", data: { object: dispute("won") } });
  const lines = await ledger(payment.id, "dp_won");
  assert.ok(lines.includes("dispute-resolution dispute_reserve 15000"), lines.join("\n"));
  assert.ok(lines.includes("dispute-resolution trainer_payable -15000"));
});
