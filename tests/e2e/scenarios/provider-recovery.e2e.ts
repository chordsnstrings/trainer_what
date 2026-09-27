/**
 * Provider-loss recovery: every reconcile route the application offers for a
 * lost Stripe webhook or a lost Stripe response, driven through the public
 * API against the Stripe double.
 *
 * - Lost webhooks (`stripe.autoWebhooks = false`): a paid session's checkout
 *   and its refund are confirmed only by POST /api/v1/bookings/:id/payment/
 *   reconcile (checkout.sessions.retrieve, then refunds.retrieve); an approved
 *   membership refund only by POST /api/v1/refund-requests/:id/reconcile.
 * - Lost responses (`stripe.loseNextResponse`): Stripe applied the request but
 *   the app saw HTTP 500; the renewal change and the promotion coupon are
 *   confirmed by POST /api/v1/membership/renewal/reconcile and POST
 *   /api/v1/finance/promotions/:id/reconcile.
 * - The lost webhooks are then delivered late, as Stripe retries them; the
 *   ledger must not post anything twice (both charge.refunded shapes).
 *
 * Webhooks are switched off only inside one step and always switched back on.
 */
import assert from "node:assert/strict";
import type { E2EContext, FollowerSeed, TrainerSeed } from "../harness/context.ts";

const F = "followers" as const;
const T = "Trainers" as const;
const A = "Super admin" as const;

async function withoutWebhooks<T>(ctx: E2EContext, fn: () => Promise<T>) {
  const stripe = ctx.mocks.stripe;
  const prior = stripe.autoWebhooks;
  stripe.autoWebhooks = false;
  try {
    return await fn();
  } finally {
    stripe.autoWebhooks = prior;
  }
}
const journalsOf = (ctx: E2EContext, tenantId: string, keys: string[]) =>
  ctx.sqlRead<{ source_key: string }>(
    "SELECT source_key FROM journals WHERE tenant_id=$1 AND source_key=ANY($2::text[]) ORDER BY source_key",
    [tenantId, keys],
  );

export async function providerRecoveryScenarios(ctx: E2EContext) {
  const layla = ctx.trainers.find((t) => t.slug === "layla-strength" && t.published);
  const members = ctx.followers.filter((f) => layla && f.trainer === layla && f.paid && f.tier === "workout" && f.client.userId && f.checkout?.subscriptionId);
  if (!layla || members.length === 0) {
    for (const [audience, feature, title] of [
      [F, "Pay for a paid session, with refund on cancellation", "lost checkout and refund webhooks"],
      [T, "Refund decisions", "lost refund webhooks"],
      [F, "Cancel or reactivate renewal", "lost renewal response"],
      [T, "Free trials and promotion codes", "lost coupon response"],
    ] as const)
      ctx.reporter.skip(audience, feature, title, "layla-strength did not launch or has no paid workout member with a subscription");
    return;
  }
  await layla.client.stepUp();
  await bookingRecovery(ctx, layla, members[0]);
  await refundRecovery(ctx, layla, members);
  await renewalRecovery(ctx, members[members.length - 1]);
  await promotionRecovery(ctx, layla);
}

async function bookingRecovery(ctx: E2EContext, layla: TrainerSeed, member: FollowerSeed) {
  const { reporter: r, mocks } = ctx;
  const stripe = mocks.stripe;
  const c = member.client;
  let lost: { booking: any; paymentKey: string; refund: any; session: any } | undefined;
  await r.step(F, "Pay for a paid session, with refund on cancellation", `${c.label}: the checkout and refund webhooks are lost; the member's reconcile confirms the payment, then the refund, from Stripe's records`, async () => {
    // Nine days ahead at a quarter past: other suites book this trainer three and six days ahead.
    const startsAt = new Date(Date.now() + 9 * 86400000);
    startsAt.setUTCMinutes(15, 0, 0);
    const slot = await layla.client.post("/api/v1/bookings/slots", {
      title: "Recovery technique check",
      location: "Studio C, Dubai",
      startsAt: startsAt.toISOString(),
      durationMinutes: 30,
      capacity: 1,
      priceMinor: 9000,
    });
    lost = await withoutWebhooks(ctx, async () => {
      const reserved = await c.post(`/api/v1/bookings/slots/${slot.id}/reserve`, {});
      const sessionId = new URL(reserved.checkoutUrl ?? reserved.url).pathname.split("/").pop()!;
      const webhooksBefore = stripe.deliveries.length;
      const completed = await stripe.completeCheckout(sessionId);
      assert.equal(completed.deliveries, undefined, "no webhook was sent");
      assert.equal(stripe.deliveries.length, webhooksBefore);
      let booking = (await c.get("/api/v1/bookings")).bookings.find((b: any) => b.slot_id === slot.id);
      assert.equal(booking.payment_status, "pending", "unconfirmed without the webhook");
      const confirmed = await c.post(`/api/v1/bookings/${booking.id}/payment/reconcile`, {});
      assert.equal(confirmed.status, "complete");
      booking = (await c.get("/api/v1/bookings")).bookings.find((b: any) => b.id === booking.id);
      assert.equal(booking.status, "confirmed");
      assert.equal(booking.payment_status, "paid");
      const [payment] = await ctx.sqlRead<{ id: string }>(
        "SELECT id FROM records WHERE tenant_id=$1 AND kind='booking_payment' AND data->>'bookingId'=$2",
        [layla.tenantId, booking.id],
      );
      const paymentKey = "booking-charge:" + payment.id;
      assert.deepEqual((await journalsOf(ctx, layla.tenantId, [paymentKey])).map((j) => j.source_key), [paymentKey]);
      // Cancelling refunds through Stripe; the refund webhooks are lost as well.
      const canceled = await c.post(`/api/v1/bookings/${booking.id}/cancel`, { reason: "Travel plans changed" });
      assert.equal(canceled.refund?.status, "refunding", JSON.stringify(canceled.refund));
      const refund = [...stripe.refunds.values()].find((x) => x.metadata?.booking_payment_id === payment.id);
      assert.ok(refund, "the refund exists in Stripe");
      booking = (await c.get("/api/v1/bookings")).bookings.find((b: any) => b.id === booking.id);
      assert.equal(booking.payment_status, "refunding", "unconfirmed without the refund webhooks");
      const retrievals = stripe.server.requests("GET", "/v1/refunds/").length;
      const settled = await c.post(`/api/v1/bookings/${booking.id}/payment/reconcile`, {});
      assert.equal(settled.status, "succeeded");
      assert.equal(stripe.server.requests("GET", "/v1/refunds/").length, retrievals + 1, "refunds.retrieve was used");
      booking = (await c.get("/api/v1/bookings")).bookings.find((b: any) => b.id === booking.id);
      assert.equal(booking.status, "canceled");
      assert.equal(booking.payment_status, "refunded");
      const journals = await journalsOf(ctx, layla.tenantId, [paymentKey, "booking-refund:" + refund.id]);
      assert.deepEqual(journals.map((j) => j.source_key), [paymentKey, "booking-refund:" + refund.id]);
      return { booking, paymentKey, refund, session: stripe.sessions.get(sessionId)! };
    });
    return `booking ${lost.booking.id}: paid, then refunded ${lost.refund.amount} AED minor, both confirmed by reconcile`;
  });
  if (!lost) {
    r.skip(A, "Stripe payment events endpoint", "late delivery of lost webhooks", "the lost-webhook booking step failed");
    return;
  }
  const late = lost;
  await r.step(A, "Stripe payment events endpoint", `${c.label}: Stripe delivers the lost webhooks late (current and pre-2022-11-15 charge shapes); every one is accepted and nothing is posted twice`, async () => {
    const charge = [...stripe.charges.values()].find((x) => x.id === late.refund.charge)!;
    const deliveries = [
      await stripe.sendEvent("checkout.session.completed", stripe.publicSession(late.session)),
      await stripe.sendEvent("refund.created", late.refund),
      await stripe.sendEvent("charge.refunded", stripe.chargeEventObject(charge)),
      await stripe.sendEvent("charge.refunded", stripe.chargeEventObject(charge, "2022-08-01"), { apiVersion: "2022-08-01" }),
    ];
    assert.deepEqual(deliveries.map((d) => `${d.type} ${d.status}`), deliveries.map((d) => `${d.type} 200`), deliveries.map((d) => d.body).join(" | "));
    const journals = await journalsOf(ctx, layla.tenantId, [late.paymentKey, "booking-refund:" + late.refund.id]);
    assert.deepEqual(journals.map((j) => j.source_key), [late.paymentKey, "booking-refund:" + late.refund.id], "one charge and one refund journal");
    const booking = (await c.get("/api/v1/bookings")).bookings.find((b: any) => b.id === late.booking.id);
    assert.equal(booking.payment_status, "refunded");
    return deliveries.map((d) => d.type).join(", ");
  });
}

async function refundRecovery(ctx: E2EContext, layla: TrainerSeed, members: FollowerSeed[]) {
  const { reporter: r, mocks } = ctx;
  const stripe = mocks.stripe;
  await r.step(T, "Refund decisions", `${layla.slug}: an approved refund's webhooks are lost; the owner's reconcile finds the Stripe refund and posts it to the ledger once`, async () => {
    const disputed = new Set([...stripe.disputes.values()].map((d) => d.charge));
    let pick: { member: FollowerSeed; charge: any } | undefined;
    for (const member of members) {
      const billing = await member.client.get("/api/v1/membership/billing");
      const charge = billing.charges.find((x: any) => x.eligible && !disputed.has(x.chargeId));
      if (charge) {
        pick = { member, charge };
        break;
      }
    }
    assert.ok(pick, "a paid member of layla-strength has an undisputed charge inside the refund window");
    const { member, charge } = pick;
    return withoutWebhooks(ctx, async () => {
      const request = await member.client.post("/api/v1/refund-requests", { chargeId: charge.chargeId, reason: "Injured this week, could not train" });
      await layla.client.okMfa("POST", `/api/v1/refund-requests/${request.id}/decision`, { approve: true, reason: "Approved: medical reason" });
      const refund = [...stripe.refunds.values()].find((x) => x.metadata?.refund_request_id === request.id);
      assert.ok(refund, "Stripe holds the refund");
      let billing = await member.client.get("/api/v1/membership/billing");
      assert.equal(billing.charges.find((x: any) => x.chargeId === charge.chargeId).refundedMinor, 0, "nothing posted without a webhook");
      const reconciled = await layla.client.okMfa("POST", `/api/v1/refund-requests/${request.id}/reconcile`, {});
      assert.equal(reconciled.status, "succeeded");
      billing = await member.client.get("/api/v1/membership/billing");
      assert.equal(billing.charges.find((x: any) => x.chargeId === charge.chargeId).refundedMinor, refund.amount);
      assert.equal(billing.requests.find((x: any) => x.id === request.id)?.status, "succeeded");
      const again = await layla.client.okMfa("POST", `/api/v1/refund-requests/${request.id}/reconcile`, {});
      assert.equal(again.status, "succeeded", "a second reconcile changes nothing");
      const journals = await journalsOf(ctx, layla.tenantId, ["stripe-refund:" + refund.id]);
      assert.equal(journals.length, 1, "one refund journal");
      // The lost webhook arrives late and is absorbed.
      const late = await stripe.sendEvent("refund.created", refund);
      assert.equal(late.status, 200, late.body);
      assert.equal((await journalsOf(ctx, layla.tenantId, ["stripe-refund:" + refund.id])).length, 1);
      return `${member.client.label}: ${refund.amount} AED minor refunded by reconcile`;
    });
  });
}

async function renewalRecovery(ctx: E2EContext, member: FollowerSeed) {
  const { reporter: r, mocks } = ctx;
  const stripe = mocks.stripe;
  const c = member.client;
  const subscriptionId = member.checkout!.subscriptionId!;
  await r.step(F, "Cancel or reactivate renewal", `${c.label}: Stripe applies the cancellation but the answer is lost; the member's reconcile confirms it; reactivation restores the renewal`, async () => {
    const sub = stripe.subscriptions.get(subscriptionId)!;
    assert.equal(sub.cancel_at_period_end, false, "renewal is on before the step");
    await withoutWebhooks(ctx, async () => {
      stripe.loseNextResponse("POST", new RegExp(`^/v1/subscriptions/${subscriptionId}$`));
      const failed = await c.request("POST", "/api/v1/membership/cancel", {});
      assert.ok(failed.status >= 500, `the app reports an unconfirmed change: ${failed.status} ${failed.text.slice(0, 200)}`);
      assert.equal(sub.cancel_at_period_end, true, "Stripe applied the cancellation");
      let billing = await c.get("/api/v1/membership/billing");
      assert.equal(billing.transitions.length, 1, "the instruction is held as unresolved");
      assert.equal(billing.membership.cancel_at_period_end, false, "not shown as cancelled before it is confirmed");
      await c.fails(409, "POST", "/api/v1/membership/reactivate", {}, "RENEWAL_UNRESOLVED");
      const resolved = await c.post("/api/v1/membership/renewal/reconcile", {});
      assert.equal(resolved.status, "resolved");
      billing = await c.get("/api/v1/membership/billing");
      assert.equal(billing.transitions.length, 0);
      assert.equal(billing.membership.cancel_at_period_end, true, "confirmed from Stripe's subscription");
    });
    await c.post("/api/v1/membership/reactivate", {});
    assert.equal(sub.cancel_at_period_end, false);
    const billing = await c.get("/api/v1/membership/billing");
    assert.equal(billing.membership.cancel_at_period_end, false);
    return `subscription ${subscriptionId}: cancellation confirmed by reconcile, then reactivated`;
  });
}

async function promotionRecovery(ctx: E2EContext, layla: TrainerSeed) {
  const { reporter: r, mocks } = ctx;
  const stripe = mocks.stripe;
  await r.step(T, "Free trials and promotion codes", `${layla.slug}: Stripe creates the coupon but the answer is lost; the owner's reconcile publishes the promotion from the coupon`, async () => {
    const code = "RECOVER" + Date.now().toString(36).toUpperCase().slice(-5);
    const body = {
      code,
      productId: layla.products.workout.id,
      percentOff: 15,
      maxRedemptions: 5,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      reason: "Sandbox: coupon answer lost on the way back",
    };
    await layla.client.stepUp();
    stripe.loseNextResponse("POST", /^\/v1\/coupons$/);
    const failed = await layla.client.request("POST", "/api/v1/finance/promotions", body);
    assert.ok(failed.status >= 500, `the app reports an unconfirmed coupon: ${failed.status} ${failed.text.slice(0, 200)}`);
    const [held] = await ctx.sqlRead<{ id: string; status: string }>(
      "SELECT id,status FROM records WHERE tenant_id=$1 AND kind='promotion' AND data->>'code'=$2",
      [layla.tenantId, code],
    );
    assert.equal(held?.status, "unknown", "the promotion is held until reconciled");
    assert.ok(stripe.coupons.has("trainer_" + held.id), "Stripe created the coupon");
    await layla.client.fails(409, "POST", "/api/v1/finance/promotions", body, "PROMOTION_EXISTS");
    const published = await layla.client.okMfa("POST", `/api/v1/finance/promotions/${held.id}/reconcile`, {});
    assert.equal(published.status, "published");
    assert.equal(published.data.couponId, "trainer_" + held.id);
    await layla.client.okMfa("POST", `/api/v1/finance/promotions/${held.id}/archive`, { revision: published.version, reason: "Sandbox: recovery check finished" });
    return `${code}: unknown → published by reconcile → archived`;
  });
}
