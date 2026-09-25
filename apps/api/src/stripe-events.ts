import { randomUUID } from "node:crypto";
import { type Database, type Tx, type Actor, event } from "@trainer/db";
import { recordCharge, journal } from "./finance.ts";
const supported = new Set([
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "refund.created",
  "refund.updated",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
]);
export async function processStripeEvent(db: Database, e: any) {
  if (!supported.has(e.type)) return { ignored: true };
  const object = e.data.object;
  const meta = object.metadata?.tenant_id
    ? object.metadata
    : (object.parent?.subscription_details?.metadata ??
      object.subscription_details?.metadata);
  let tenantId = meta?.tenant_id,
    userId = meta?.user_id;
  const subscriptionId =
    typeof object.subscription === "string"
      ? object.subscription
      : (object.parent?.subscription_details?.subscription ??
        (object.object === "subscription" ? object.id : undefined));
  const chargeId =
    typeof object.charge === "string"
      ? object.charge
      : (object.charge?.id ?? object.payments?.data?.[0]?.payment?.charge);
  if (!tenantId || !userId) {
    const refs = [object.id, subscriptionId, chargeId].filter(Boolean);
    const [mapping] = await db.system((tx) =>
      tx.query(
        "SELECT tenant_id,user_id FROM provider_objects WHERE provider='stripe' AND external_id=ANY($1::text[]) LIMIT 1",
        [refs],
      ),
    );
    tenantId = mapping?.tenant_id;
    userId = mapping?.user_id;
  }
  if ((!tenantId || !userId) && subscriptionId) {
    const [mapping] = await db.system((tx) =>
      tx.query(
        "SELECT payload->'data'->'object'->'metadata' AS metadata FROM provider_events WHERE provider='stripe' AND payload->'data'->'object'->>'id'=$1 LIMIT 1",
        [subscriptionId],
      ),
    );
    tenantId = mapping?.metadata?.tenant_id;
    userId = mapping?.metadata?.user_id;
  }
  if (!tenantId || !userId)
    throw new Error(
      "Payment event mapping unresolved; retain receipt for reconciliation",
    );
  const [member] = await db.system((tx) =>
    tx.query(
      "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [tenantId, userId],
    ),
  );
  if (!member)
    throw new Error(
      "Payment event refers to an unknown subscriber relationship",
    );
  const a = { tenantId, userId, role: "finance" };
  await db.system(async (tx) => {
    for (const [externalId, kind] of [
      [object.id, object.object ?? "payment"],
      [subscriptionId, "subscription"],
      [chargeId, "charge"],
    ])
      if (externalId) {
        const [old] = await tx.query(
          "SELECT tenant_id,user_id FROM provider_objects WHERE provider='stripe' AND external_id=$1",
          [externalId],
        );
        if (old && (old.tenant_id !== tenantId || old.user_id !== userId))
          throw new Error("Conflicting provider object ownership");
        await tx.query(
          "INSERT INTO provider_objects(provider,external_id,tenant_id,user_id,kind) VALUES('stripe',$1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [externalId, tenantId, userId, kind],
        );
      }
  });
  await db.tenant(a, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId]);
    const [current] = await tx.query(
      "SELECT * FROM subscriptions WHERE user_id=$1",
      [userId],
    );
    const eventTime = Number(e.created ?? 0),
      lastTime = Number(current?.data?.lastStripeEventAt ?? 0);
    const newer = !eventTime || eventTime >= lastTime;
    // Entitlements come from a signed event's actual price mapped to our immutable offer.
    // Caller-controlled metadata never grants a module; unknown price changes fail closed.
    const line = object.items?.data?.[0] ?? object.lines?.data?.[0];
    const priceId =
      typeof line?.price === "string"
        ? line.price
        : (line?.price?.id ?? line?.pricing?.price_details?.price);
    let productAccess: any = {};
    if (
      newer &&
      priceId &&
      (e.type.startsWith("customer.subscription.") || !current?.data?.priceId)
    ) {
      const [offer] = await tx.query(
        "SELECT id,data FROM records WHERE kind='product' AND data->>'stripePriceId'=$1",
        [priceId],
      );
      productAccess = offer
        ? {
            productId: offer.id,
            tier: offer.data.tier ?? "workout",
            modules: offer.data.modules ?? ["training"],
            priceId,
          }
        : { modules: [], priceId, unmappedPrice: true };
    } else if (!current?.data?.modules) {
      productAccess = { modules: ["training"], tier: "workout" };
    }
    if (e.type === "invoice.paid") {
      const amount = object.amount_paid;
      if (
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        object.currency !== "aed"
      )
        throw new Error("Unsupported invoice amount/currency");
      const end = object.lines?.data?.[0]?.period?.end ?? object.period_end;
      if (!end) throw new Error("Invoice period end is required");
      const firstPaidAt =
        current?.data?.firstPaidAt ??
        new Date(
          (object.created ?? e.created ?? Date.now() / 1000) * 1000,
        ).toISOString();
      const status =
        newer && current?.status !== "canceled"
          ? "active"
          : (current?.status ?? "active");
      const metadata = {
        ...current?.data,
        ...productAccess,
        firstPaidAt,
        lastStripeEventAt: Math.max(lastTime, eventTime),
      };
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,price_minor,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,user_id) DO UPDATE SET status=excluded.status,provider_id=excluded.provider_id,period_end=greatest(subscriptions.period_end,excluded.period_end),price_minor=excluded.price_minor,data=excluded.data",
        [
          randomUUID(),
          tenantId,
          userId,
          subscriptionId ?? current?.provider_id,
          status,
          new Date(end * 1000),
          amount,
          JSON.stringify(metadata),
        ],
      );
      const [position] = await tx.query(
        "SELECT rank FROM (SELECT user_id,row_number() OVER(ORDER BY (data->>'firstPaidAt')::timestamptz,user_id)::int AS rank FROM subscriptions WHERE status IN ('active','trialing') AND data ? 'firstPaidAt') ranked WHERE user_id=$1",
        [userId],
      );
      if (amount > 0)
        await recordCharge(
          tx,
          a,
          `stripe-invoice:${object.id}`,
          amount,
          position?.rank ?? 1,
          {
            userId,
            chargeId:
              chargeId ?? object.payments?.data?.[0]?.payment?.charge ?? null,
            invoiceId: object.id,
            chargedAt: new Date(
              (object.created ?? e.created ?? Date.now() / 1000) * 1000,
            ).toISOString(),
          },
        );
      await event(tx, a, "invoice.paid", object.id, { providerEventId: e.id });
    } else if (e.type.startsWith("customer.subscription.") && newer) {
      const period =
        object.current_period_end ??
        object.items?.data?.[0]?.current_period_end;
      const data = {
        ...current?.data,
        ...productAccess,
        lastStripeEventAt: eventTime,
      };
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,cancel_at_period_end,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,user_id) DO UPDATE SET status=excluded.status,period_end=coalesce(excluded.period_end,subscriptions.period_end),cancel_at_period_end=excluded.cancel_at_period_end,data=excluded.data",
        [
          randomUUID(),
          tenantId,
          userId,
          object.id,
          object.status,
          period ? new Date(period * 1000) : null,
          !!object.cancel_at_period_end,
          JSON.stringify(data),
        ],
      );
      await event(tx, a, "subscription.updated", object.id, {
        status: object.status,
        providerEventId: e.id,
      });
    } else if (e.type === "invoice.payment_failed" && newer) {
      await tx.query(
        "UPDATE subscriptions SET status='past_due',data=data||$2::jsonb WHERE user_id=$1 AND status<>'canceled'",
        [userId, JSON.stringify({ lastStripeEventAt: eventTime })],
      );
      await event(tx, a, "payment.failed", object.id, {
        providerEventId: e.id,
      });
    } else if (e.type.startsWith("refund."))
      await applyRefund(tx, a, object, chargeId, e.id);
    else if (e.type === "charge.refunded") {
      for (const refund of object.refunds?.data ?? [])
        await applyRefund(tx, a, refund, object.id, e.id);
      if (object.refunds?.has_more)
        throw new Error(
          "Refund page incomplete; reconciliation must retrieve all refunds",
        );
    } else if (
      e.type === "charge.dispute.created" ||
      e.type === "charge.dispute.closed"
    ) {
      const amount = object.amount;
      if (
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        object.currency !== "aed"
      )
        throw new Error("Unsupported dispute amount");
      const [original] = await tx.query(
        "SELECT * FROM journals WHERE data->>'chargeId'=$1 AND source_key LIKE 'stripe-invoice:%'",
        [chargeId],
      );
      if (!original) throw new Error("Disputed charge has not been reconciled");
      await journal(
        tx,
        a,
        `dispute-reserve:${object.id}`,
        "Dispute reserve",
        [
          { account: "trainer_payable", amount },
          { account: "dispute_reserve", amount: -amount },
        ],
        { disputeId: object.id, chargeId },
      );
      if (e.type === "charge.dispute.closed") {
        if (object.status === "won")
          await journal(
            tx,
            a,
            `dispute-resolution:${object.id}`,
            "Dispute won; reserve released",
            [
              { account: "dispute_reserve", amount },
              { account: "trainer_payable", amount: -amount },
            ],
            { disputeId: object.id },
          );
        else if (object.status === "lost") {
          const fee = Math.round(
            (original.data.commissionMinor * amount) / original.data.grossMinor,
          );
          await journal(
            tx,
            a,
            `dispute-resolution:${object.id}`,
            "Dispute lost",
            [
              { account: "dispute_reserve", amount },
              { account: "stripe_receivable", amount: -amount },
              { account: "platform_commission", amount: fee },
              { account: "trainer_payable", amount: -fee },
            ],
            { disputeId: object.id },
          );
        } else throw new Error("Dispute final outcome is unresolved");
      }
      await event(tx, a, "dispute.updated", object.id, {
        status: object.status,
        providerEventId: e.id,
      });
    }
  });
  return { processed: true };
}
async function applyRefund(
  tx: Tx,
  a: Actor,
  refund: any,
  chargeId: string | undefined,
  eventId: string,
) {
  await tx.query(
    "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE kind='refund' AND (data->>'providerRefundId'=$1 OR data->>'chargeId'=$4)",
    [
      refund.id,
      refund.status === "succeeded"
        ? "succeeded"
        : refund.status === "failed"
          ? "failed"
          : "submitted",
      JSON.stringify({
        providerRefundId: refund.id,
        providerStatus: refund.status,
      }),
      chargeId,
    ],
  );
  if (refund.status !== "succeeded") return;
  const [exists] = await tx.query(
    "SELECT id FROM journals WHERE source_key=$1",
    [`stripe-refund:${refund.id}`],
  );
  if (exists) return;
  const [original] = await tx.query(
    "SELECT * FROM journals WHERE data->>'chargeId'=$1 AND source_key LIKE 'stripe-invoice:%'",
    [chargeId],
  );
  if (!original) throw new Error("Refunded charge has not been reconciled");
  const amount = refund.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0 || refund.currency !== "aed")
    throw new Error("Unsupported refund amount");
  const [prior] = await tx.query(
    "SELECT coalesce(sum((data->>'refundAmountMinor')::bigint),0)::text AS refunded,coalesce(sum((data->>'commissionReversalMinor')::bigint),0)::text AS reversed FROM journals WHERE data->>'originalJournalId'=$1",
    [original.id],
  );
  if (Number(prior.refunded) + amount > original.data.grossMinor)
    throw new Error("Refund exceeds original charge");
  const final = Number(prior.refunded) + amount === original.data.grossMinor;
  const fee = final
    ? original.data.commissionMinor - Number(prior.reversed)
    : Math.round(
        (original.data.commissionMinor * amount) / original.data.grossMinor,
      );
  await journal(
    tx,
    a,
    `stripe-refund:${refund.id}`,
    "Subscription refund",
    [
      { account: "stripe_receivable", amount: -amount },
      { account: "trainer_payable", amount: amount - fee },
      { account: "platform_commission", amount: fee },
    ],
    {
      originalJournalId: original.id,
      refundAmountMinor: amount,
      commissionReversalMinor: fee,
      chargeId,
      userId: a.userId,
    },
  );
  await event(tx, a, "refund.succeeded", refund.id, {
    providerEventId: eventId,
  });
}
