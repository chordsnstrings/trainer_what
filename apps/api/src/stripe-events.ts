import {
  processMembershipCheckoutEvent,
  settleCheckoutSubscription,
} from "./finance-checkout.ts";
import { processBookingStripeEvent } from "./finance-bookings.ts";
import { randomUUID } from "node:crypto";
import {
  type Database,
  type Tx,
  type Actor,
  event,
  putRecord,
} from "@trainer/db";
import { stripeClient } from "@trainer/providers";
import { recordCharge, journal } from "./finance.ts";
import { recordFirstPaidAcquisition } from "./acquisition.ts";
type StripeLike = ReturnType<typeof stripeClient>;
/**
 * Stable rank, assigned once at a subscriber's first positive charge as the next number after
 * every stored rank; payers ranked together are ordered by first paid date and user ID. v1 ranked
 * by a first-paid position that could repeat a number; its stored ranks are kept.
 */
export const COMMISSION_RANK_METHOD = "stable-first-paid-v2";
const idOf = (value: any): string | undefined =>
  typeof value === "string" ? value : (value?.id ?? undefined);
function optionalStripe(): StripeLike | undefined {
  try {
    return stripeClient();
  } catch {
    return undefined;
  }
}
/**
 * Basil and later invoices (the pinned dahlia API) carry no `charge`; the paid InvoicePayment
 * names a PaymentIntent, or a bare charge only when no PaymentIntent exists.
 */
async function resolveInvoicePayment(object: any, stripe?: StripeLike) {
  let payments: any[] | undefined = object.payments?.has_more
    ? undefined
    : object.payments?.data;
  if (!payments?.length) {
    if (!stripe) return {};
    const page = await stripe.invoicePayments.list({
      invoice: object.id,
      status: "paid",
      limit: 10,
      expand: ["data.payment.payment_intent"],
    });
    if (page.has_more) return {};
    payments = page.data;
  }
  const paid = payments.filter((p) => p?.status === "paid");
  if (paid.length !== 1) return {};
  const intent = paid[0].payment?.payment_intent;
  let chargeId =
    idOf(paid[0].payment?.charge) ?? idOf(intent?.latest_charge ?? undefined);
  const paymentIntentId = idOf(intent);
  if (!chargeId && paymentIntentId && stripe)
    chargeId = idOf(
      (await stripe.paymentIntents.retrieve(paymentIntentId)).latest_charge,
    );
  return { chargeId, paymentIntentId };
}
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
export async function processStripeEvent(
  db: Database,
  e: any,
  deps: { stripe?: StripeLike } = {},
) {
  if (await processBookingStripeEvent(db, e)) return { processed: true };
  if (await processMembershipCheckoutEvent(db, e)) return { processed: true };
  if (!supported.has(e.type)) return { ignored: true };
  let object = e.data.object;
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
  let chargeId: string | undefined = idOf(object.charge),
    paymentIntentId: string | undefined = idOf(object.payment_intent);
  if (!tenantId || !userId) {
    const refs = [object.id, subscriptionId, chargeId, paymentIntentId].filter(
      Boolean,
    );
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
  const eventTime = Number(e.created ?? 0);
  if (e.type === "invoice.paid" && !chargeId && object.amount_paid > 0) {
    // Journals are immutable, so the charge link must be known before money is posted.
    const [posted] = await db.tenant(a, (tx) =>
      tx.query("SELECT data FROM journals WHERE source_key=$1", [
        `stripe-invoice:${object.id}`,
      ]),
    );
    const resolved = posted
      ? {
          chargeId: posted.data.chargeId ?? undefined,
          paymentIntentId: posted.data.paymentIntentId ?? undefined,
        }
      : await resolveInvoicePayment(object, deps.stripe ?? optionalStripe());
    chargeId = resolved.chargeId;
    paymentIntentId ??= resolved.paymentIntentId;
    if (!chargeId && !posted)
      throw new Error(
        "Invoice payment identity unresolved; retain receipt for reconciliation",
      );
  }
  if (e.type.startsWith("customer.subscription.") && eventTime) {
    const [row] = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT data->>'lastStripeEventAt' AS last FROM subscriptions WHERE user_id=$1",
        [userId],
      ),
    );
    if (Number(row?.last ?? 0) === eventTime) {
      // Stripe timestamps have one-second resolution and delivery order is not guaranteed;
      // a same-second subscription event is applied only from the provider's current object.
      const stripe = deps.stripe ?? optionalStripe();
      if (!stripe)
        throw new Error(
          "Same-second subscription events need provider confirmation; retain receipt for reconciliation",
        );
      const remote: any = await stripe.subscriptions.retrieve(object.id);
      if (
        remote.id !== object.id ||
        (remote.metadata?.tenant_id &&
          remote.metadata.tenant_id !== tenantId) ||
        (remote.metadata?.user_id && remote.metadata.user_id !== userId)
      )
        throw new Error("Conflicting provider object ownership");
      object = {
        ...remote,
        metadata: {
          ...object.metadata,
          ...remote.metadata,
          tenant_id: tenantId,
          user_id: userId,
        },
      };
    }
  }
  await db.system(async (tx) => {
    for (const [externalId, kind] of [
      [object.id, object.object ?? "payment"],
      [subscriptionId, "subscription"],
      [chargeId, "charge"],
      [paymentIntentId, "payment_intent"],
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
    const lastTime = Number(current?.data?.lastStripeEventAt ?? 0);
    const newer = !eventTime || eventTime >= lastTime;
    const differentSubscription = !!(
      subscriptionId &&
      current?.provider_id &&
      subscriptionId !== current.provider_id
    );
    const currentTerminal = ["canceled", "incomplete_expired"].includes(
      current?.status,
    );

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
            premiumVoice: offer.data.premiumVoice === true,
            priceId,
          }
        : { modules: [], priceId, unmappedPrice: true, premiumVoice: false };
    } else if (!current?.data?.modules) {
      productAccess = {
        modules: ["training"],
        tier: "workout",
        premiumVoice: false,
      };
    } else if (newer && !priceId && !current?.data?.priceId) {
      // Legacy grants without a verified offer mapping never enable paid voice.
      productAccess = {
        premiumVoice: false,
        modules: current.data.modules.filter(
          (module: string) => module !== "voice",
        ),
      };
    }
    if (["invoice.paid", "invoice.payment_failed"].includes(e.type)) {
      const safeLink = (value: unknown) => {
        try {
          const url = new URL(String(value));
          return url.protocol === "https:" &&
            (url.hostname === "invoice.stripe.com" ||
              url.hostname.endsWith(".stripe.com"))
            ? url.toString()
            : null;
        } catch {
          return null;
        }
      };
      const [invoice] = await tx.query(
        "SELECT * FROM records WHERE kind='billing_invoice' AND data->>'invoiceId'=$1",
        [object.id],
      );
      const snapshot = {
        invoiceId: object.id,
        subscriptionId,
        chargeId: chargeId ?? null,
        paymentIntentId: paymentIntentId ?? null,
        amountPaid: object.amount_paid ?? 0,
        amountDue: object.amount_due ?? 0,
        currency: object.currency,
        number: object.number ?? null,
        hostedUrl: safeLink(object.hosted_invoice_url),
        pdfUrl: safeLink(object.invoice_pdf),
        issuedAt: new Date((object.created ?? eventTime) * 1000).toISOString(),
        providerEventId: e.id,
        eventTime,
      };
      if (!invoice)
        await putRecord(tx, a, "billing_invoice", snapshot, {
          ownerId: userId,
          status: e.type === "invoice.paid" ? "paid" : "open",
        });
      else if (
        eventTime >= Number(invoice.data.eventTime ?? 0) &&
        invoice.status !== "paid"
      )
        await tx.query(
          "UPDATE records SET status=$2,data=$3,version=version+1,updated_at=now() WHERE id=$1",
          [
            invoice.id,
            e.type === "invoice.paid" ? "paid" : "open",
            JSON.stringify(snapshot),
          ],
        );
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
      // A $0 invoice (a free trial) is not a payment and never starts the first-paid clock.
      const firstPaidAt: string | undefined =
        current?.data?.firstPaidAt ??
        (amount > 0
          ? new Date(
              (object.created ?? e.created ?? Date.now() / 1000) * 1000,
            ).toISOString()
          : undefined);
      const status =
        newer && current?.status !== "canceled"
          ? "active"
          : (current?.status ?? "active");
      const metadata = {
        ...current?.data,
        ...productAccess,
        ...(firstPaidAt ? { firstPaidAt } : {}),
        lastStripeEventAt: Math.max(lastTime, eventTime),
        ...(newer ? { graceUntil: null, pastDueSince: null } : {}),
      };
      // A late invoice from an older membership still posts money, but cannot replace current access.
      if (!differentSubscription || (newer && currentTerminal))
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
      if (amount > 0) {
        // The commission rank is assigned once, at the first positive charge, and reused for every
        // later charge, so churn or a late invoice never re-ranks a payer. Under the tenant lock held
        // above, ranks are issued in sequence after every stored rank, so no two payers share one in
        // any processing order. Payers with an earlier positive charge but no stored rank (charged
        // before ranks were stored) are ranked in the same step, in first-paid then user-ID order.
        // A subscriber with no positive charge (a free trial) never takes a slot. Treatment of
        // churned and re-entering subscribers, and of a first charge processed after later payers
        // were ranked, remains a finance-policy decision.
        let rank = Number(current?.data?.commissionRank);
        if (!Number.isSafeInteger(rank) || rank < 1) {
          const assigned = await tx.query(
            "WITH top AS (SELECT coalesce(max((data->>'commissionRank')::int),0) AS n FROM subscriptions WHERE data ? 'commissionRank'), pending AS (SELECT s.id,row_number() OVER (ORDER BY coalesce((s.data->>'firstPaidAt')::timestamptz,$3::timestamptz),s.user_id) AS n FROM subscriptions s WHERE NOT s.data ? 'commissionRank' AND (s.user_id=$1 OR (s.data ? 'firstPaidAt' AND EXISTS(SELECT 1 FROM journals j WHERE j.source_key LIKE 'stripe-invoice:%' AND j.data->>'userId'=s.user_id::text AND (j.data->>'grossMinor')::numeric>0)))) UPDATE subscriptions s SET data=$2::jsonb||jsonb_build_object('commissionRank',top.n+pending.n)||s.data FROM top,pending WHERE s.id=pending.id RETURNING s.user_id=$1 AS payer,(s.data->>'commissionRank')::int AS rank",
            [
              userId,
              JSON.stringify({
                firstPaidAt,
                commissionRankMethod: COMMISSION_RANK_METHOD,
              }),
              firstPaidAt,
            ],
          );
          rank = Number(assigned.find((row) => row.payer)?.rank);
          if (!Number.isSafeInteger(rank) || rank < 1)
            throw new Error(
              "Subscriber commission rank unavailable; retain receipt for reconciliation",
            );
        }
        await recordCharge(tx, a, `stripe-invoice:${object.id}`, amount, rank, {
          userId,
          chargeId: chargeId ?? null,
          paymentIntentId: paymentIntentId ?? null,
          invoiceId: object.id,
          chargedAt: new Date(
            (object.created ?? e.created ?? Date.now() / 1000) * 1000,
          ).toISOString(),
          firstPaidAt,
          rankMethod:
            current?.data?.commissionRankMethod ?? COMMISSION_RANK_METHOD,
        });
      }
      await event(tx, a, "invoice.paid", object.id, { providerEventId: e.id });
    } else if (e.type.startsWith("customer.subscription.") && newer) {
      if (differentSubscription && !currentTerminal) {
        if (!["canceled", "incomplete_expired"].includes(object.status))
          throw new Error(
            "A different active provider subscription requires reconciliation before replacing the current membership",
          );
        await settleCheckoutSubscription(tx, a, object);
        await event(tx, a, "subscription.historical_terminal", object.id, {
          providerEventId: e.id,
          status: object.status,
        });
        return;
      }
      const period =
        object.current_period_end ??
        object.items?.data?.[0]?.current_period_end;
      const data = {
        ...current?.data,
        ...productAccess,
        lastStripeEventAt: eventTime,
        ...([
          "active",
          "trialing",
          "canceled",
          "unpaid",
          "incomplete_expired",
        ].includes(object.status)
          ? { graceUntil: null, pastDueSince: null }
          : object.status === "past_due"
            ? await graceSnapshot(tx, current, eventTime)
            : {}),
      };
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,cancel_at_period_end,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,user_id) DO UPDATE SET provider_id=excluded.provider_id,status=excluded.status,period_end=coalesce(excluded.period_end,subscriptions.period_end),cancel_at_period_end=excluded.cancel_at_period_end,data=excluded.data",
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
      await settleCheckoutSubscription(tx, a, object);
      await event(tx, a, "subscription.updated", object.id, {
        status: object.status,
        providerEventId: e.id,
      });
    } else if (
      e.type === "invoice.payment_failed" &&
      newer &&
      !differentSubscription
    ) {
      await tx.query(
        "UPDATE subscriptions SET status='past_due',data=data||$2::jsonb WHERE user_id=$1 AND status<>'canceled'",
        [
          userId,
          JSON.stringify({
            lastStripeEventAt: eventTime,
            ...(await graceSnapshot(tx, current, eventTime)),
          }),
        ],
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
        // Won disputes, closed inquiries and prevented disputes withdraw nothing through the dispute;
        // any prevention refund is posted from its own refund event.
        if (["won", "warning_closed", "prevented"].includes(object.status))
          await journal(
            tx,
            a,
            `dispute-resolution:${object.id}`,
            object.status === "won"
              ? "Dispute won; reserve released"
              : "Dispute closed without loss; reserve released",
            [
              { account: "dispute_reserve", amount },
              { account: "trainer_payable", amount: -amount },
            ],
            { disputeId: object.id, status: object.status },
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
  if (e.type === "invoice.paid" && object.amount_paid > 0) {
    try {
      await recordFirstPaidAcquisition(db, tenantId, userId);
    } catch {
      console.warn("Payment acquisition conversion could not be recorded");
    }
  }
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
    "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE kind='refund' AND data->>'chargeId'=$4 AND (data->>'providerRefundId'=$1 OR id::text=$5) AND (status<>'succeeded' OR $2='succeeded')",
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
      refund.metadata?.refund_request_id ?? "",
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

/** Grace is pinned at the first failed payment, never extended by webhook retries. */
async function graceSnapshot(tx: Tx, current: any, eventTime: number) {
  if (current?.data?.pastDueSince)
    return {
      pastDueSince: current.data.pastDueSince,
      graceUntil: current.data.graceUntil ?? null,
    };
  const at = new Date((eventTime || Math.floor(Date.now() / 1000)) * 1000);
  const [policy] = await tx.query(
    "SELECT data FROM records WHERE kind='finance_policy' AND status='published' AND (data->>'effectiveAt')::timestamptz<=$1 ORDER BY (data->>'effectiveAt')::timestamptz DESC LIMIT 1",
    [at.toISOString()],
  );
  const days = Number(policy?.data?.graceDays ?? 3);
  return {
    pastDueSince: at.toISOString(),
    graceUntil: new Date(
      at.getTime() +
        Math.max(0, Math.min(14, Number.isFinite(days) ? days : 0)) * 86400000,
    ).toISOString(),
  };
}
