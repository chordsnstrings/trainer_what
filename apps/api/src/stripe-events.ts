import {
  processMembershipCheckoutEvent,
  settleCheckoutSubscription,
} from "./finance-checkout.ts";
import { processBookingStripeEvent } from "./finance-bookings.ts";
import { processVoiceAddOnEvent } from "./voice-addon.ts";
import { endRefundedProgramme } from "./programme-billing.ts";
import { randomUUID } from "node:crypto";
import {
  type Database,
  type Tx,
  type Actor,
  event,
  putRecord,
  elevated,
} from "@trainer/db";
import { stripeClient } from "@trainer/providers";
import "./stripe-alerts.ts";
import { recordCharge, journal, assignCommissionRank } from "./finance.ts";
import { recordFirstPaidAcquisition } from "./acquisition.ts";
import {
  processWebAddressStripeEvent,
  type WebAddressStripe,
} from "./web-address-orders.ts";
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
export async function resolveInvoicePayment(object: any, stripe?: StripeLike) {
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
/**
 * How long an event that matches no object of this platform is answered with
 * an error (so Stripe retries while the object it refers to may still be
 * arriving) before it is acknowledged and parked for an operator.
 */
export const UNMATCHED_RETRY_SECONDS = 3600;
/**
 * An event for a Stripe object the platform did not create (a Payment Link,
 * a Dashboard invoice, a refund of someone else's charge). `foreign` is set
 * when the object's own shape proves it: membership, add-on and web address
 * invoices and subscriptions always carry the platform's metadata. Otherwise
 * it is parked only after UNMATCHED_RETRY_SECONDS, because the object it
 * refers to may still be arriving; until then it fails as before. The
 * webhook route answers a parked event with 2xx and keeps its receipt.
 */
export function unmatchedStripeEvent(
  e: any,
  message: string,
  foreign = false,
): Error {
  const created = Number(e?.created ?? 0);
  const aged =
    created > 0 && Date.now() / 1000 - created > UNMATCHED_RETRY_SECONDS;
  return foreign || aged
    ? Object.assign(new Error(message), {
        statusCode: 409,
        code: "STRIPE_EVENT_UNMATCHED",
        unmatched: true,
      })
    : new Error(message);
}
/** Whether an event is old enough that data it refers to is no longer arriving. */
export const eventAged = (e: any) =>
  Number(e?.created ?? 0) > 0 &&
  Date.now() / 1000 - Number(e.created) > UNMATCHED_RETRY_SECONDS;
const INVOICE_CLOSED = new Set(["invoice.voided", "invoice.marked_uncollectible"]);
/** Invoice record states in the order they may replace each other. */
const invoiceRank: Record<string, number> = {
  open: 0,
  uncollectible: 1,
  void: 2,
  paid: 3,
};
/**
 * Stores an invoice's state on its billing_invoice record. Paid wins over
 * everything; void and uncollectible end an open invoice (Stripe stops
 * collecting it, so it no longer holds a month close); an older event never
 * reopens a closed invoice.
 */
export async function projectBillingInvoice(
  tx: Tx,
  a: Actor,
  memberId: string,
  e: any,
  snapshot: Record<string, unknown>,
) {
  const status =
    e.type === "invoice.paid"
      ? "paid"
      : e.type === "invoice.voided"
        ? "void"
        : e.type === "invoice.marked_uncollectible"
          ? "uncollectible"
          : "open";
  const data = {
    ...snapshot,
    ...(status === "uncollectible"
      ? { writtenOff: true, writtenOffReason: "stripe_marked_uncollectible" }
      : {}),
  };
  const [invoice] = await tx.query(
    "SELECT * FROM records WHERE kind='billing_invoice' AND data->>'invoiceId'=$1",
    [snapshot.invoiceId],
  );
  if (!invoice) {
    await putRecord(tx, a, "billing_invoice", data, {
      ownerId: memberId,
      status,
    });
    return;
  }
  const from = invoiceRank[invoice.status] ?? 0,
    to = invoiceRank[status];
  if (
    invoice.status !== "paid" &&
    (to > from ||
      (to === from &&
        Number(snapshot.eventTime ?? 0) >= Number(invoice.data.eventTime ?? 0)))
  )
    await tx.query(
      "UPDATE records SET status=$2,data=$3,version=version+1,updated_at=now() WHERE id=$1",
      [invoice.id, status, JSON.stringify(data)],
    );
}
/**
 * A subscription that ended (canceled, unpaid or expired) leaves its failed
 * invoices open at Stripe with collection stopped: they no longer hold the
 * trainer's month close or the member's erasure. A later payment of one of
 * them still arrives as invoice.paid and is posted then.
 */
export async function closeEndedSubscriptionInvoices(
  tx: Tx,
  subscriptionId: string,
  status: string,
  eventId: string,
) {
  if (!["canceled", "unpaid", "incomplete_expired"].includes(status)) return;
  await tx.query(
    "UPDATE records SET status='uncollectible',data=data||$2::jsonb,version=version+1,updated_at=now() WHERE kind='billing_invoice' AND status='open' AND data->>'subscriptionId'=$1",
    [
      subscriptionId,
      JSON.stringify({
        writtenOff: true,
        writtenOffReason: "subscription_ended",
        closedByEvent: eventId,
      }),
    ],
  );
}
const supported = new Set([
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "invoice.marked_uncollectible",
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
  // A trainer's own web address subscription (docs/features/web-addresses.md)
  // is never a member payment: it is handled first and completely.
  if (
    await processWebAddressStripeEvent(db, e, {
      stripe: deps.stripe as unknown as WebAddressStripe | undefined,
    })
  )
    return { processed: true };
  if (await processBookingStripeEvent(db, e)) return { processed: true };
  // A voice add-on is its own provider subscription tied to the membership;
  // its checkout, subscription and invoice events never touch the membership.
  if (await processVoiceAddOnEvent(db, e, deps)) return { processed: true };
  if (await processMembershipCheckoutEvent(db, e, deps))
    return { processed: true };
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
    throw unmatchedStripeEvent(
      e,
      "Payment event mapping unresolved; retain receipt for reconciliation",
      // Every invoice and subscription this platform creates carries its
      // metadata; one without it (a Dashboard invoice, a Payment Link
      // subscription) is not the platform's.
      object.object === "invoice" || object.object === "subscription",
    );
  const [member] = await db.system((tx) =>
    tx.query(
      "SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [tenantId, userId],
    ),
  );
  // A follower who left or was removed keeps a recorded exit; the winding-down
  // subscription's remaining provider events must still reach the ledger.
  const [former] = member
    ? []
    : await db.tenant(
        elevated("provider-callback", { tenantId, role: "finance" }),
        (tx) =>
          tx.query("SELECT id FROM membership_exits WHERE user_id=$1 LIMIT 1", [
            userId,
          ]),
      );
  if (!member && !former)
    throw new Error(
      "Payment event refers to an unknown subscriber relationship",
    );
  // The provider acted, not the member: the projection runs as an allowlisted
  // service identity; the member is the subject of its rows.
  const a = elevated("provider-callback", { tenantId, role: "finance" });
  const eventTime = Number(e.created ?? 0);
  // Paid without an identifiable Stripe payment (marked paid outside Stripe,
  // or split across several payments): access follows the invoice, the money
  // is left to an operator (a reconciliation record), never guessed.
  let outOfBand = false;
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
    if (!chargeId && !posted) {
      if (!eventAged(e))
        throw new Error(
          "Invoice payment identity unresolved; retain receipt for reconciliation",
        );
      outOfBand = true;
    }
  }
  // Set when a subscription event is applied from the provider's current
  // object instead of its own (possibly stale) payload.
  let authoritative = false;
  if (e.type.startsWith("customer.subscription.") && eventTime) {
    const [row] = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT data->>'lastStripeEventAt' AS last FROM subscriptions WHERE user_id=$1",
        [userId],
      ),
    );
    const last = Number(row?.last ?? 0);
    // Stripe timestamps have one-second resolution and delivery order is not
    // guaranteed (an invoice event may be newer than a plan change delivered
    // late): a subscription event that is not newer than the last applied
    // event is applied only from the provider's current object.
    const stripe =
      eventTime <= last ? (deps.stripe ?? optionalStripe()) : undefined;
    if (eventTime === last && !stripe)
      throw new Error(
        "Same-second subscription events need provider confirmation; retain receipt for reconciliation",
      );
    if (stripe) {
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
      authoritative = true;
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
    const newer = authoritative || !eventTime || eventTime >= lastTime;
    // An upfront programme has no provider subscription: a subscription event
    // for this member then concerns an older (or unexpected) membership.
    const differentSubscription = !!(
      subscriptionId &&
      (current?.provider_id
        ? subscriptionId !== current.provider_id
        : current?.data?.billing === "upfront")
    );
    // An upfront programme whose paid access is over is history even before
    // the worker sweep closes it: a new membership may replace it at once. A
    // terminal event of an older membership is still only history.
    const upfrontEnded =
      current?.data?.billing === "upfront" &&
      !current.provider_id &&
      !!current.period_end &&
      new Date(current.period_end).getTime() <= Date.now() &&
      !["canceled", "incomplete_expired", "unpaid"].includes(object.status);
    const currentTerminal =
      ["canceled", "incomplete_expired"].includes(current?.status) ||
      upfrontEnded;

    // Entitlements come from a signed event's actual price mapped to our immutable offer.
    // Caller-controlled metadata never grants a module; unknown price changes fail closed.
    const line = object.items?.data?.[0] ?? object.lines?.data?.[0];
    const priceId =
      typeof line?.price === "string"
        ? line.price
        : (line?.price?.id ?? line?.pricing?.price_details?.price);
    let productAccess: any = {};
    // The offer's own price: the membership's list price.
    let offerPriceMinor: number | undefined;
    if (
      newer &&
      priceId &&
      (e.type.startsWith("customer.subscription.") ||
        !current?.data?.priceId ||
        // A new membership after an upfront programme maps its own price.
        (current?.data?.billing === "upfront" && differentSubscription))
    ) {
      const [offer] = await tx.query(
        "SELECT id,data FROM records WHERE kind='product' AND data->>'stripePriceId'=$1",
        [priceId],
      );
      if (Number.isSafeInteger(offer?.data?.priceMinor))
        offerPriceMinor = offer.data.priceMinor;
      productAccess = offer
        ? {
            productId: offer.id,
            tier: offer.data.tier ?? "workout",
            modules: offer.data.modules ?? ["training"],
            premiumVoice: offer.data.premiumVoice === true,
            priceId,
            // The membership snapshots the offer's billing and trainer-set
            // programme length (block length for a monthly offer).
            billing: "monthly",
            programmeDays: offer.data.programmeDays ?? null,
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
    // Day 1 of the programme: the start of a new membership (or of one that
    // replaces an ended membership or upfront programme). A continuing
    // membership keeps its start; one stored before programme starts existed
    // starts at its first payment.
    const startSeconds =
      Number(
        object.start_date ??
          object.lines?.data?.[0]?.period?.start ??
          object.created ??
          eventTime,
      ) || Math.floor(Date.now() / 1000);
    const lengthChanged =
      !!current?.data &&
      Object.prototype.hasOwnProperty.call(current.data, "programmeDays") &&
      productAccess.programmeDays !== undefined &&
      (productAccess.programmeDays ?? null) !==
        (current.data.programmeDays ?? null);
    const programme =
      !current ||
      (currentTerminal &&
        (differentSubscription || current.data?.billing === "upfront"))
        ? {
            programmeStartsAt: new Date(startSeconds * 1000).toISOString(),
            upfront: null,
            ...(current?.data?.upfront
              ? {
                  programmeHistory: [
                    ...(Array.isArray(current.data.programmeHistory)
                      ? current.data.programmeHistory
                      : []),
                    current.data.upfront,
                  ].slice(-10),
                }
              : {}),
          }
        : lengthChanged
          ? // A plan change to a different block length starts a new block
            // (Day 1) instead of renumbering the current one mid-way.
            {
              programmeStartsAt: new Date(
                (eventTime || Math.floor(Date.now() / 1000)) * 1000,
              ).toISOString(),
            }
          : current.data?.programmeStartsAt
            ? {}
            : {
                programmeStartsAt:
                  current.data?.firstPaidAt ??
                  new Date(startSeconds * 1000).toISOString(),
              };
    if (
      ["invoice.paid", "invoice.payment_failed"].includes(e.type) ||
      INVOICE_CLOSED.has(e.type)
    ) {
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
      await projectBillingInvoice(tx, a, userId, e, {
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
        ...(outOfBand ? { outOfBand: true } : {}),
      });
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
        ...programme,
        ...(firstPaidAt ? { firstPaidAt } : {}),
        lastStripeEventAt: Math.max(lastTime, eventTime),
        ...(newer ? { graceUntil: null, pastDueSince: null } : {}),
      };
      // The membership's price is its offer's list price. An invoice amount
      // (a free trial, a discounted month, a plan-change proration) is only
      // the fallback for a membership whose price is not known yet.
      const sameSubscription =
        !!current &&
        (!subscriptionId || current.provider_id === subscriptionId);
      const priceMinor =
        offerPriceMinor ??
        (sameSubscription && current.price_minor != null
          ? current.price_minor
          : amount);
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
            priceMinor,
            JSON.stringify(metadata),
          ],
        );
      if (outOfBand) {
        // Once per invoice, however often the event or a sync replays it.
        const [open] = await tx.query(
          "SELECT id FROM records WHERE kind='reconciliation' AND data->>'invoiceId'=$1",
          [object.id],
        );
        if (!open) {
          await putRecord(
            tx,
            a,
            "reconciliation",
            {
              reason:
                "A membership invoice was marked paid without a Stripe payment the platform can identify; record the money outside Stripe or correct the invoice in Stripe",
              invoiceId: object.id,
              userId,
              amountMinor: amount,
            },
            { ownerId: userId, status: "open" },
          );
          await event(tx, a, "invoice.paid_out_of_band", object.id, {
            providerEventId: e.id,
          });
        }
      } else if (amount > 0) {
        // The commission rank is assigned once, at the first positive charge, and reused for every
        // later charge, so churn or a late invoice never re-ranks a payer. Under the tenant lock held
        // above, ranks are issued in sequence after every stored rank, so no two payers share one in
        // any processing order. Payers with an earlier positive charge but no stored rank (charged
        // before ranks were stored) are ranked in the same step, in first-paid then user-ID order.
        // A subscriber with no positive charge (a free trial) never takes a slot. Treatment of
        // churned and re-entering subscribers, and of a first charge processed after later payers
        // were ranked, remains a finance-policy decision.
        const rank = await assignCommissionRank(
          tx,
          userId,
          current,
          firstPaidAt,
          COMMISSION_RANK_METHOD,
        );
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
        await settleCheckoutSubscription(tx, userId, object);
        await closeEndedSubscriptionInvoices(tx, object.id, object.status, e.id);
        await event(tx, a, "subscription.historical_terminal", object.id, {
          providerEventId: e.id,
          status: object.status,
        });
        return;
      }
      const period =
        object.current_period_end ??
        object.items?.data?.[0]?.current_period_end;
      // In flexible billing mode the Dashboard (and Customer Portal) schedule
      // an end with cancel_at and leave cancel_at_period_end false; either
      // one means the membership does not renew. A cancel_at-only schedule
      // is kept so switching renewal back on clears that field.
      const scheduledCancelAt =
        !object.cancel_at_period_end && Number(object.cancel_at) > 0
          ? Number(object.cancel_at)
          : null;
      const itemPrice = object.items?.data?.[0]?.price?.unit_amount;
      const priceMinor =
        offerPriceMinor ??
        (Number.isSafeInteger(itemPrice) ? itemPrice : null);
      const data = {
        ...current?.data,
        ...productAccess,
        ...programme,
        lastStripeEventAt: Math.max(lastTime, eventTime),
        scheduledCancelAt,
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
        "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,cancel_at_period_end,price_minor,data) VALUES($1,$2,$3,$4,$5,$6,$7,coalesce($8::bigint,0),$9) ON CONFLICT(tenant_id,user_id) DO UPDATE SET provider_id=excluded.provider_id,status=excluded.status,period_end=coalesce(excluded.period_end,subscriptions.period_end),cancel_at_period_end=excluded.cancel_at_period_end,price_minor=CASE WHEN $8::bigint IS NULL THEN subscriptions.price_minor ELSE excluded.price_minor END,data=excluded.data",
        [
          randomUUID(),
          tenantId,
          userId,
          object.id,
          object.status,
          period ? new Date(period * 1000) : null,
          !!object.cancel_at_period_end || scheduledCancelAt !== null,
          priceMinor,
          JSON.stringify(data),
        ],
      );
      await closeEndedSubscriptionInvoices(tx, object.id, object.status, e.id);
      await settleCheckoutSubscription(tx, userId, object);
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
      await applyRefund(tx, a, userId, object, chargeId, e.id);
    else if (e.type === "charge.refunded") {
      for (const refund of object.refunds?.data ?? [])
        await applyRefund(tx, a, userId, refund, object.id, e.id);
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
      // A membership charge is found by its charge id; a paid coaching
      // session's charge journal records only its payment intent.
      const [original] = await tx.query(
        "SELECT * FROM journals WHERE (data->>'chargeId'=$1 AND (source_key LIKE 'stripe-invoice:%' OR source_key LIKE 'stripe-programme:%')) OR ($2::text IS NOT NULL AND source_key LIKE 'booking-charge:%' AND data->>'paymentIntentId'=$2) ORDER BY created_at LIMIT 1",
        [chargeId, paymentIntentId ?? null],
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
          // A lost dispute takes back what Stripe did not already return:
          // never more than the charge less its refunds and earlier losses,
          // nor more than the dispute's own balance transactions withdrew
          // net of any reinstatement (a dispute of a partly refunded charge
          // closes as lost while Stripe returns the refunded part).
          // Commission is reversed at most once across refunds and disputes.
          const [prior] = await tx.query(
            "SELECT coalesce(sum((data->>'refundAmountMinor')::bigint),0)::text AS refunded,coalesce(sum((data->>'disputeLossMinor')::bigint),0)::text AS lost,coalesce(sum((data->>'commissionReversalMinor')::bigint),0)::text AS reversed FROM journals WHERE data->>'originalJournalId'=$1 OR ($2::text IS NOT NULL AND source_key LIKE 'booking-refund%' AND data->>'bookingId'=$2)",
            [
              original.id,
              original.source_key.startsWith("booking-charge:")
                ? (original.data.bookingId ?? null)
                : null,
            ],
          );
          const gross = Number(original.data.grossMinor),
            commission = Number(original.data.commissionMinor ?? 0);
          const transactions = Array.isArray(object.balance_transactions)
            ? object.balance_transactions
            : [];
          const withdrawn =
            transactions.length &&
            transactions.every(
              (t: any) =>
                t?.currency === "aed" && Number.isSafeInteger(t.amount),
            )
              ? Math.max(
                  0,
                  -transactions.reduce((n: number, t: any) => n + t.amount, 0),
                )
              : amount;
          const lost = Math.max(
            0,
            Math.min(
              amount,
              withdrawn,
              gross - Number(prior.refunded) - Number(prior.lost),
            ),
          );
          const unreversed = Math.max(0, commission - Number(prior.reversed));
          const final =
            Number(prior.refunded) + Number(prior.lost) + lost >= gross;
          const fee = final
            ? unreversed
            : Math.min(unreversed, Math.round((commission * lost) / gross));
          await journal(
            tx,
            a,
            `dispute-resolution:${object.id}`,
            "Dispute lost",
            [
              { account: "dispute_reserve", amount },
              { account: "stripe_receivable", amount: -lost },
              { account: "platform_commission", amount: fee },
              { account: "trainer_payable", amount: -fee - (amount - lost) },
            ],
            {
              disputeId: object.id,
              originalJournalId: original.id,
              disputeLossMinor: lost,
              commissionReversalMinor: fee,
              chargeId: chargeId ?? null,
            },
          );
          // Money taken back by a lost dispute ends what it paid for, as a
          // full refund does: an upfront programme, or the voice add-on.
          if (final && lost > 0) {
            if (original.source_key.startsWith("stripe-programme:"))
              await endRefundedProgramme(tx, a, userId, original, object.id);
            else if (original.data.purpose === "voice_addon")
              await tx.query(
                "UPDATE subscriptions SET data=jsonb_set(data,'{voiceAddOn,endRequested}',to_jsonb($2::text)) WHERE user_id=$1 AND data->'voiceAddOn'->>'providerId'=$3 AND data->'voiceAddOn'->>'status' NOT IN ('canceled','incomplete_expired','unpaid')",
                [
                  userId,
                  "disputed:" + object.id,
                  original.data.subscriptionId ?? "",
                ],
              );
          }
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
  /** The refunded member (the provider callback acts as a service identity). */
  memberId: string,
  refund: any,
  chargeId: string | undefined,
  eventId: string,
) {
  // A canceled refund moved no money, as a failed one: both are final and
  // free the charge for a new refund request. A refund can fail after it
  // succeeded (the bank returned it); a failed one never succeeds again.
  const status =
    refund.status === "succeeded"
      ? "succeeded"
      : ["failed", "canceled"].includes(refund.status)
        ? "failed"
        : "submitted";
  await tx.query(
    "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE kind='refund' AND data->>'chargeId'=$4 AND (data->>'providerRefundId'=$1 OR id::text=$5) AND NOT coalesce(data->'failedRefundIds','[]'::jsonb) ? $1 AND status<>'failed' AND (status<>'succeeded' OR $2='failed')",
    [
      refund.id,
      status,
      JSON.stringify({
        providerRefundId: refund.id,
        providerStatus: refund.status,
      }),
      chargeId,
      refund.metadata?.refund_request_id ?? "",
    ],
  );
  if (status === "failed") {
    // Money a posted refund sent back returned to the Stripe balance: the
    // refund journal is compensated, so the charge counts as unrefunded
    // again (its commission is earned again).
    const [posted] = await tx.query(
      "SELECT * FROM journals WHERE source_key=$1",
      [`stripe-refund:${refund.id}`],
    );
    if (posted) {
      const amount = Number(posted.data.refundAmountMinor),
        fee = Number(posted.data.commissionReversalMinor ?? 0);
      await journal(
        tx,
        a,
        `stripe-refund-reversal:${refund.id}`,
        "Refund returned; charge restored",
        [
          { account: "stripe_receivable", amount },
          { account: "trainer_payable", amount: -(amount - fee) },
          { account: "platform_commission", amount: -fee },
        ],
        {
          originalJournalId: posted.data.originalJournalId,
          refundAmountMinor: -amount,
          commissionReversalMinor: -fee,
          reversedRefundId: refund.id,
          chargeId,
          userId: memberId,
          ...(posted.data.purpose ? { purpose: posted.data.purpose } : {}),
        },
      );
      await event(tx, a, "refund.reversed", refund.id, {
        providerEventId: eventId,
        status: refund.status,
      });
    }
    return;
  }
  if (refund.status !== "succeeded") return;
  const [exists] = await tx.query(
    "SELECT id FROM journals WHERE source_key=$1 OR source_key=$2",
    [`stripe-refund:${refund.id}`, `stripe-refund-reversal:${refund.id}`],
  );
  if (exists) return;
  const [original] = await tx.query(
    "SELECT * FROM journals WHERE data->>'chargeId'=$1 AND (source_key LIKE 'stripe-invoice:%' OR source_key LIKE 'stripe-programme:%')",
    [chargeId],
  );
  const programmeCharge = original?.source_key.startsWith("stripe-programme:");
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
    programmeCharge
      ? "Programme refund"
      : original.data.purpose === "voice_addon"
        ? "Voice add-on refund"
        : "Subscription refund",
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
      userId: memberId,
      ...(original.data.purpose ? { purpose: original.data.purpose } : {}),
    },
  );
  // A fully refunded upfront programme no longer grants access.
  if (programmeCharge && final)
    await endRefundedProgramme(tx, a, memberId, original, refund.id);
  // A fully refunded voice add-on charge ends premium voice now; the worker
  // cancels the add-on subscription so it does not renew.
  if (final && original.data.purpose === "voice_addon")
    await tx.query(
      "UPDATE subscriptions SET data=jsonb_set(data,'{voiceAddOn,endRequested}',to_jsonb($2::text)) WHERE user_id=$1 AND data->'voiceAddOn'->>'providerId'=$3 AND data->'voiceAddOn'->>'status' NOT IN ('canceled','incomplete_expired','unpaid')",
      [memberId, "refunded:" + refund.id, original.data.subscriptionId ?? ""],
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
