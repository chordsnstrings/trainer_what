import {
  type Actor,
  type Database,
  type Tx,
  putRecord,
  event,
} from "@trainer/db";
import { requireCommerce, stripeClient } from "@trainer/providers";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { journal } from "./finance.ts";
import { effectiveFinancePolicy, feeInMinor } from "./finance-policy.ts";
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { statusCode: 409, code });
/** Called only while reservation holds its slot row lock. No external calls. */
async function preparePaidBookingScoped(
  tx: Tx,
  a: Actor,
  slot: any,
  booking: any,
) {
  const amountMinor = Number(slot.price_minor ?? 0);
  if (!amountMinor) return null;
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 100 ||
    amountMinor > 100000000
  )
    throw fail(
      "BOOKING_PRICE_INVALID",
      "Paid sessions require a valid AED price",
    );
  const [prior] = await tx.query(
    "SELECT * FROM records WHERE kind='booking_payment' AND data->>'bookingId'=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
    [booking.id],
  );
  if (prior && !["expired", "refunded", "canceled"].includes(prior.status)) {
    if (["pending", "creating", "open", "unknown"].includes(prior.status))
      return prior;
    throw fail(
      "BOOKING_PAYMENT_EXISTS",
      "Reconcile the previous payment before making another reservation",
    );
  }
  const policy = await effectiveFinancePolicy(tx);
  const expiresAt = new Date(Date.now() + 35 * 60000).toISOString();
  const r = await putRecord(
    tx,
    a,
    "booking_payment",
    {
      bookingId: booking.id,
      slotId: slot.id,
      title: slot.title,
      amountMinor,
      currency: "aed",
      expiresAt,
      commissionMinor: feeInMinor(amountMinor, policy.data.bookingFeeBps ?? 0),
      policyId: policy.id,
    },
    { ownerId: booking.user_id, status: "pending" },
  );
  await tx.query(
    "UPDATE bookings SET status='payment_pending',payment_status='pending',hold_expires_at=$2 WHERE id=$1",
    [booking.id, expiresAt],
  );
  return r;
}
export async function preparePaidBooking(
  tx: Tx,
  a: Actor,
  slot: any,
  booking: any,
) {
  const [context] = await tx.query(
    "SELECT current_setting('app.role',true) AS role",
  );
  await tx.query("SELECT set_config('app.role','owner',true)");
  try {
    return await preparePaidBookingScoped(tx, a, slot, booking);
  } finally {
    await tx
      .query("SELECT set_config('app.role',$1,true)", [context.role])
      .catch(() => {});
  }
}
export async function startBookingCheckout(
  db: Database,
  a: Actor,
  bookingId: string,
  stripe = requireCommerce(),
) {
  const r = await db.tenant({ ...a, role: "owner" }, async (tx) => {
    const [p] = await tx.query(
      "SELECT * FROM records WHERE kind='booking_payment' AND data->>'bookingId'=$1 AND owner_user_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",
      [z.string().uuid().parse(bookingId), a.userId],
    );
    if (!p)
      throw fail("BOOKING_PAYMENT_REQUIRED", "Paid reservation unavailable");
    if (
      p.status === "open" &&
      p.data.checkoutUrl &&
      Date.parse(p.data.expiresAt) > Date.now()
    )
      return p;
    if (p.status !== "pending")
      throw fail(
        "BOOKING_PAYMENT_UNRESOLVED",
        "Check the original checkout before creating another payment",
      );
    if (Date.parse(p.data.expiresAt) <= Date.now() + 30 * 60000) {
      // No request was ever dispatched while this intent remained pending.
      await tx.query(
        "UPDATE records SET status='expired',updated_at=now() WHERE id=$1",
        [p.id],
      );
      await tx.query(
        "UPDATE bookings SET status='canceled',payment_status='expired',hold_expires_at=NULL WHERE id=$1 AND status='payment_pending'",
        [bookingId],
      );
      return { ...p, status: "expired" };
    }
    const [b] = await tx.query(
      "SELECT * FROM bookings WHERE id=$1 AND user_id=$2",
      [bookingId, a.userId],
    );
    if (!b || b.status !== "payment_pending")
      throw fail(
        "BOOKING_CANCELED",
        "This reservation is no longer awaiting payment",
      );
    await tx.query(
      "UPDATE records SET status='creating',updated_at=now() WHERE id=$1",
      [p.id],
    );
    return p;
  });
  if (r.status === "expired")
    throw fail(
      "BOOKING_HOLD_EXPIRED",
      "The unused hold expired; reserve the session again if a seat remains",
    );
  if (r.status === "open")
    return {
      url: r.data.checkoutUrl,
      checkoutUrl: r.data.checkoutUrl,
      status: "open",
    };
  const origin = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const metadata = {
      tenant_id: a.tenantId,
      user_id: r.owner_user_id,
      booking_payment_id: r.id,
      booking_id: bookingId,
      payment_kind: "booking",
    };
    const remote = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        client_reference_id: r.id,
        line_items: [
          {
            price_data: {
              currency: "aed",
              unit_amount: r.data.amountMinor,
              product_data: { name: r.data.title },
            },
            quantity: 1,
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        expires_at: Math.floor(Date.parse(r.data.expiresAt) / 1000),
        success_url: origin + "/app/bookings?payment=complete",
        cancel_url: origin + "/app/bookings?payment=canceled",
      },
      { idempotencyKey: "booking-checkout:" + r.id },
    );
    if (!remote.id || !remote.url)
      throw new Error("Checkout did not return a payment reference");
    await db.tenant({ ...a, role: "owner" }, async (tx) => {
      await tx.query(
        "UPDATE records SET status='open',data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND status='creating'",
        [
          r.id,
          JSON.stringify({ checkoutId: remote.id, checkoutUrl: remote.url }),
        ],
      );
      await event(tx, a, "booking.checkout_created", bookingId, {
        paymentId: r.id,
      });
    });
    return { url: remote.url, checkoutUrl: remote.url, status: "open" };
  } catch (error) {
    await db.tenant({ ...a, role: "owner" }, (tx) =>
      tx.query(
        "UPDATE records SET status='unknown',updated_at=now() WHERE id=$1 AND status='creating'",
        [r.id],
      ),
    );
    throw error;
  }
}
export async function refundCanceledBooking(
  db: Database,
  a: Actor,
  bookingId: string,
  stripe?: ReturnType<typeof stripeClient>,
) {
  const intent: any = await db.tenant({ ...a, role: "owner" }, async (tx) => {
    const [b] = await tx.query(
      "SELECT * FROM bookings WHERE id=$1 FOR UPDATE",
      [bookingId],
    );
    if (!b || b.status !== "canceled") return null;
    const [p] = await tx.query(
      "SELECT * FROM records WHERE kind='booking_payment' AND data->>'bookingId'=$1 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",
      [bookingId],
    );
    if (!p) return null;
    if (p.status === "pending") {
      await tx.query(
        "UPDATE records SET status='canceled',updated_at=now() WHERE id=$1",
        [p.id],
      );
      await tx.query(
        "UPDATE bookings SET payment_status='canceled',hold_expires_at=NULL WHERE id=$1",
        [bookingId],
      );
      return null;
    }
    if (p.status === "open") return { ...p, expire: true };
    if (p.status !== "paid") return null;
    if (!p.data.paymentIntentId)
      throw fail(
        "PAYMENT_REFERENCE_REQUIRED",
        "Reconcile the original payment reference before refunding",
      );
    await tx.query(
      "UPDATE records SET status='refund_submitting',updated_at=now() WHERE id=$1",
      [p.id],
    );
    await tx.query(
      "UPDATE bookings SET payment_status='refunding' WHERE id=$1",
      [bookingId],
    );
    return { ...p, expire: false };
  });
  if (!intent) return { status: "held_or_complete" };
  if (intent.expire) {
    try {
      const remote = await (stripe ?? stripeClient()).checkout.sessions.expire(
        intent.data.checkoutId,
      );
      await processBookingStripeEvent(db, {
        type: "checkout.session.expired",
        id: "reconcile-expiry:" + remote.id,
        data: { object: remote },
      });
      return { status: "canceled" };
    } catch {
      throw fail(
        "CHECKOUT_UNRESOLVED",
        "The original checkout may have completed; reconcile it before another payment",
      );
    }
  }
  try {
    const refund = await (stripe ?? stripeClient()).refunds.create(
      {
        payment_intent: intent.data.paymentIntentId,
        amount: intent.data.amountMinor,
        metadata: {
          tenant_id: a.tenantId,
          user_id: intent.owner_user_id,
          booking_payment_id: intent.id,
          payment_kind: "booking",
        },
      },
      { idempotencyKey: "booking-refund:" + intent.id },
    );
    if (!refund.id) throw new Error("Refund reference missing");
    await db.tenant({ ...a, role: "owner" }, (tx) =>
      tx.query(
        "UPDATE records SET status='refund_pending',data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND status='refund_submitting'",
        [intent.id, JSON.stringify({ refundId: refund.id })],
      ),
    );
    return { status: "refunding" };
  } catch (error) {
    await db.tenant({ ...a, role: "owner" }, (tx) =>
      tx.query(
        "UPDATE records SET status='refund_unknown',updated_at=now() WHERE id=$1 AND status='refund_submitting'",
        [intent.id],
      ),
    );
    throw error;
  }
}
/** Only signed webhooks or authenticated Stripe reads may call this projection. */
export async function processBookingStripeEvent(
  db: Database,
  e: any,
  refundClient?: ReturnType<typeof stripeClient>,
) {
  const object = e.data?.object;
  if (!object) return false;
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.expired",
      "refund.created",
      "refund.updated",
    ].includes(e.type)
  )
    return false;
  let paymentId = object.metadata?.booking_payment_id;
  const pi =
    typeof object.payment_intent === "string"
      ? object.payment_intent
      : object.payment_intent?.id;
  if (!paymentId && pi) {
    const [m] = await db.system((tx) =>
      tx.query(
        "SELECT external_id,tenant_id FROM provider_objects WHERE provider='stripe' AND external_id=$1 AND kind='booking_payment_intent'",
        [pi],
      ),
    );
    if (m) {
      const [r] = await db.system((tx) =>
        tx.query(
          "SELECT id FROM records WHERE tenant_id=$1 AND kind='booking_payment' AND data->>'paymentIntentId'=$2",
          [m.tenant_id, pi],
        ),
      );
      paymentId = r?.id;
    }
  }
  if (!paymentId) return false;
  const [p] = await db.system((tx) =>
    tx.query("SELECT * FROM records WHERE id=$1 AND kind='booking_payment'", [
      z.string().uuid().parse(paymentId),
    ]),
  );
  if (!p)
    throw fail(
      "BOOKING_MAPPING_REQUIRED",
      "Booking payment identity has not been reconciled",
    );
  if (object.metadata?.tenant_id && object.metadata.tenant_id !== p.tenant_id)
    throw fail(
      "BOOKING_MAPPING_CONFLICT",
      "Payment tenant does not match the reservation",
    );
  if (object.metadata?.user_id && object.metadata.user_id !== p.owner_user_id)
    throw fail(
      "BOOKING_MAPPING_CONFLICT",
      "Payment user does not match the reservation",
    );
  const a = { tenantId: p.tenant_id, userId: p.owner_user_id, role: "owner" };
  if (pi)
    await db.system(async (tx) => {
      await tx.query(
        "INSERT INTO provider_objects(provider,external_id,tenant_id,user_id,kind) VALUES('stripe',$1,$2,$3,'booking_payment_intent') ON CONFLICT DO NOTHING",
        [pi, a.tenantId, a.userId],
      );
      const [prior] = await tx.query(
        "SELECT * FROM provider_objects WHERE provider='stripe' AND external_id=$1",
        [pi],
      );
      if (
        prior &&
        (prior.tenant_id !== a.tenantId || prior.user_id !== a.userId)
      )
        throw fail(
          "PAYMENT_OWNER_CONFLICT",
          "Provider payment already maps to a different owner",
        );
    });
  let compensation = false;
  await db.tenant(a, async (tx) => {
    const [slot] = await tx.query(
      "SELECT * FROM booking_slots WHERE id=$1 FOR UPDATE",
      [p.data.slotId],
    );
    const [b] = await tx.query(
      "SELECT * FROM bookings WHERE id=$1 FOR UPDATE",
      [p.data.bookingId],
    );
    const [r] = await tx.query("SELECT * FROM records WHERE id=$1 FOR UPDATE", [
      p.id,
    ]);
    if (!slot || !b)
      throw fail("BOOKING_REQUIRED", "Reservation history is unavailable");
    if (e.type.startsWith("checkout.")) {
      if (r.data.checkoutId && r.data.checkoutId !== object.id)
        throw fail(
          "BOOKING_CHECKOUT_CONFLICT",
          "Checkout identity does not match its original instruction",
        );
      if (e.type === "checkout.session.expired") {
        if (["pending", "creating", "open", "unknown"].includes(r.status)) {
          await tx.query(
            "UPDATE records SET status='expired',updated_at=now() WHERE id=$1",
            [r.id],
          );
          if (b.status === "payment_pending")
            await tx.query(
              "UPDATE bookings SET status='canceled',payment_status='expired',hold_expires_at=NULL WHERE id=$1",
              [b.id],
            );
        }
        return;
      }
      if (object.payment_status !== "paid") return;
      if (
        object.mode !== "payment" ||
        object.currency !== "aed" ||
        object.amount_total !== r.data.amountMinor ||
        !pi
      )
        throw fail(
          "BOOKING_AMOUNT_MISMATCH",
          "Payment amount, currency or purpose does not match the reserved session",
        );
      if (
        [
          "paid",
          "refund_submitting",
          "refund_pending",
          "refund_unknown",
          "refunded",
        ].includes(r.status)
      ) {
        compensation = r.status === "paid" && b.status === "canceled";
        return;
      }
      const [count] = await tx.query(
        "SELECT count(*)::int AS n FROM bookings WHERE slot_id=$1 AND id<>$2 AND (status='confirmed' OR (status='payment_pending' AND hold_expires_at>now()))",
        [slot.id, b.id],
      );
      const canConfirm =
        slot.status === "open" &&
        new Date(slot.starts_at).getTime() > Date.now() &&
        count.n < slot.capacity &&
        b.status === "payment_pending";
      await journal(
        tx,
        a,
        "booking-charge:" + r.id,
        "Paid coaching session",
        [
          { account: "stripe_receivable", amount: r.data.amountMinor },
          {
            account: "trainer_payable",
            amount: -(r.data.amountMinor - r.data.commissionMinor),
          },
          { account: "platform_commission", amount: -r.data.commissionMinor },
        ],
        {
          bookingId: b.id,
          userId: b.user_id,
          paymentIntentId: pi,
          grossMinor: r.data.amountMinor,
          commissionMinor: r.data.commissionMinor,
          policy: r.data.policyId,
        },
      );
      await tx.query(
        "UPDATE records SET status='paid',data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [r.id, JSON.stringify({ checkoutId: object.id, paymentIntentId: pi })],
      );
      await tx.query(
        "UPDATE bookings SET status=$2,payment_status='paid',hold_expires_at=NULL WHERE id=$1",
        [b.id, canConfirm ? "confirmed" : "canceled"],
      );
      compensation = !canConfirm;
      await event(
        tx,
        a,
        canConfirm
          ? "booking.payment_confirmed"
          : "booking.payment_compensation_required",
        b.id,
        { paymentId: r.id },
      );
    } else {
      if (
        object.currency !== "aed" ||
        object.amount !== r.data.amountMinor ||
        (pi && r.data.paymentIntentId !== pi) ||
        (r.data.refundId && r.data.refundId !== object.id)
      )
        throw fail(
          "BOOKING_REFUND_MISMATCH",
          "Refund does not match the original payment instruction",
        );
      if (r.status === "refunded") return;
      if (
        ![
          "paid",
          "refund_submitting",
          "refund_pending",
          "refund_unknown",
        ].includes(r.status)
      )
        throw fail(
          "BOOKING_REFUND_UNRECONCILED",
          "Original payment needs reconciliation first",
        );
      if (object.status !== "succeeded") {
        await tx.query(
          "UPDATE records SET status='refund_unknown',data=data||$2::jsonb,updated_at=now() WHERE id=$1",
          [
            r.id,
            JSON.stringify({
              refundId: object.id,
              refundStatus: object.status,
            }),
          ],
        );
        return;
      }
      await journal(
        tx,
        a,
        "booking-refund:" + object.id,
        "Canceled coaching session refund",
        [
          { account: "stripe_receivable", amount: -r.data.amountMinor },
          {
            account: "trainer_payable",
            amount: r.data.amountMinor - r.data.commissionMinor,
          },
          { account: "platform_commission", amount: r.data.commissionMinor },
        ],
        {
          bookingId: b.id,
          userId: b.user_id,
          refundAmountMinor: r.data.amountMinor,
          commissionReversalMinor: r.data.commissionMinor,
        },
      );
      await tx.query(
        "UPDATE records SET status='refunded',data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [r.id, JSON.stringify({ refundId: object.id })],
      );
      await tx.query(
        "UPDATE bookings SET status='canceled',payment_status='refunded',hold_expires_at=NULL WHERE id=$1",
        [b.id],
      );
      await event(tx, a, "booking.refunded", b.id, { refundId: object.id });
    }
  });
  if (compensation)
    await refundCanceledBooking(
      db,
      a,
      p.data.bookingId,
      refundClient ?? stripeClient(),
    );
  return true;
}
export async function reconcileBookingPayment(
  db: Database,
  a: Actor,
  bookingId: string,
  stripe?: ReturnType<typeof stripeClient>,
) {
  const [p] = await db.tenant({ ...a, role: "owner" }, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind='booking_payment' AND data->>'bookingId'=$1 AND ($2<>'subscriber' OR owner_user_id=$3) ORDER BY created_at DESC,id DESC LIMIT 1",
      [z.string().uuid().parse(bookingId), a.role, a.userId],
    ),
  );
  if (!p) throw fail("BOOKING_PAYMENT_REQUIRED", "Booking payment unavailable");
  if (p.status === "pending" && Date.parse(p.data.expiresAt) <= Date.now()) {
    await db.tenant({ ...a, role: "owner" }, async (tx) => {
      await tx.query("SELECT id FROM booking_slots WHERE id=$1 FOR UPDATE", [
        p.data.slotId,
      ]);
      await tx.query(
        "UPDATE bookings SET status='canceled',payment_status='expired',hold_expires_at=NULL WHERE id=$1 AND status='payment_pending'",
        [bookingId],
      );
      await tx.query(
        "UPDATE records SET status='expired',updated_at=now() WHERE id=$1 AND status='pending'",
        [p.id],
      );
    });
    return { status: "expired" };
  }
  const provider = stripe ?? stripeClient();
  if (["creating", "unknown"].includes(p.status) && !p.data.checkoutId) {
    const page = await provider.checkout.sessions.list({
      limit: 100,
      created: {
        gte: Math.floor(new Date(p.created_at).getTime() / 1000) - 60,
      },
    });
    const remote = page.data.find(
      (r) =>
        r.client_reference_id === p.id &&
        r.metadata?.tenant_id === a.tenantId &&
        r.metadata?.user_id === p.owner_user_id,
    );
    if (!remote)
      throw fail(
        "BOOKING_PAYMENT_UNRESOLVED",
        "No matching checkout is confirmed in the provider history; the existing instruction remains held",
      );
    await db.tenant({ ...a, role: "owner" }, (tx) =>
      tx.query(
        "UPDATE records SET data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [
          p.id,
          JSON.stringify({ checkoutId: remote.id, checkoutUrl: remote.url }),
        ],
      ),
    );
    await processBookingStripeEvent(
      db,
      {
        type:
          remote.status === "expired"
            ? "checkout.session.expired"
            : "checkout.session.completed",
        id: `reconcile:${remote.id}:${remote.status}`,
        data: { object: remote },
      },
      provider,
    );
    if (remote.status === "open")
      await db.tenant({ ...a, role: "owner" }, (tx) =>
        tx.query(
          "UPDATE records SET status='open',updated_at=now() WHERE id=$1 AND status IN ('creating','unknown')",
          [p.id],
        ),
      );
    return { status: remote.status };
  }
  if (
    ["refund_submitting", "refund_unknown", "refund_pending"].includes(
      p.status,
    ) &&
    !p.data.refundId
  ) {
    const page = await provider.refunds.list({
      payment_intent: p.data.paymentIntentId,
      limit: 100,
    });
    const match = page.data.find(
      (r) => r.metadata?.booking_payment_id === p.id,
    );
    if (!match)
      throw fail(
        "BOOKING_REFUND_UNRESOLVED",
        "No provider refund confirms this instruction; it remains held",
      );
    await processBookingStripeEvent(
      db,
      {
        type: "refund.updated",
        id: `reconcile:${match.id}:${match.status}`,
        data: { object: match },
      },
      provider,
    );
    return { status: match.status };
  }
  if (p.data.refundId) {
    const r = await provider.refunds.retrieve(p.data.refundId);
    await processBookingStripeEvent(
      db,
      {
        type: "refund.updated",
        id: `reconcile:${r.id}:${r.status}`,
        data: { object: r },
      },
      provider,
    );
    return { status: r.status };
  }
  if (p.data.checkoutId) {
    const r = await provider.checkout.sessions.retrieve(p.data.checkoutId);
    await processBookingStripeEvent(
      db,
      {
        type:
          r.status === "expired"
            ? "checkout.session.expired"
            : "checkout.session.completed",
        id: `reconcile:${r.id}:${r.status}`,
        data: { object: r },
      },
      provider,
    );
    return { status: r.status };
  }
  throw fail(
    "BOOKING_PAYMENT_UNRESOLVED",
    "Provider reference is unknown; an operator must reconcile the original idempotency intent before another payment",
  );
}
export function registerBookingPayments(app: FastifyInstance, db: Database) {
  const identity = (req: any) => {
    if (!req.identity)
      throw Object.assign(new Error("Please sign in"), { statusCode: 401 });
    return req.identity;
  };
  app.post("/api/v1/bookings/:id/checkout", (req) =>
    startBookingCheckout(db, identity(req), (req.params as any).id),
  );
  app.post("/api/v1/bookings/:id/payment/reconcile", (req) =>
    reconcileBookingPayment(db, identity(req), (req.params as any).id),
  );
}
