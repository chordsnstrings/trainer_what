import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type Actor,
  type Database,
  type Tx,
  elevated,
  event,
  putRecord,
} from "@trainer/db";
import { stripeClient } from "@trainer/providers";
import { voiceAddOnPriceSchema } from "@trainer/contracts";
import {
  RENEWAL_WINDOW_DAYS,
  effectiveProgrammeDays,
} from "../../../packages/domain/src/programme.ts";
import { assignCommissionRank, recordCharge } from "./finance.ts";
import { recordFirstPaidAcquisition } from "./acquisition.ts";

/**
 * Offer billing and upfront programme payments (docs/features/programme.md).
 *
 * An upfront programme is one Stripe Checkout payment for the whole programme.
 * The completed session posts an immutable `stripe-programme:<intent>` journal
 * with the member's stable commission rank (as a membership invoice does) and
 * writes the paid access window onto the member's `subscriptions` row, which
 * has no provider subscription (`provider_id` NULL, `data.billing='upfront'`).
 */
type StripeLike = ReturnType<typeof stripeClient>;
const uuid = z.string().uuid();
const fail = (code: string, message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode, code });
const idOf = (value: any): string | undefined =>
  typeof value === "string" ? value : (value?.id ?? undefined);
const DAY = 86400000;
export const PROGRAMME_RANK_METHOD = "stable-first-paid-v2";

export type OfferBilling = "monthly" | "upfront";
/** Offers stored before billing existed are monthly. */
export const offerBilling = (data: any): OfferBilling =>
  data?.billing === "upfront" ? "upfront" : "monthly";

/** The workout + nutrition offer must be comparable with its workout-only pair. */
export function assertComparableOffer(
  offer: { billing: OfferBilling; programmeDays: number | null },
  base: any,
) {
  // The same length for monthly pairs too: a plan change between them then
  // never changes the block length mid-block.
  if (
    offerBilling(base) !== offer.billing ||
    (base.programmeDays ?? null) !== (offer.programmeDays ?? null)
  )
    throw fail(
      "OFFER_PAIR_BILLING",
      "Workout + nutrition must use the same billing and programme length as its workout-only offer.",
      400,
    );
}

/**
 * A separate Stripe product and monthly price for an offer's voice add-on.
 * Idempotency keys follow the offer version and add-on price, so a repeated
 * request never mints a second price for the same terms.
 */
export async function createVoiceAddOnPrice(
  stripe: StripeLike,
  tenantId: string,
  product: any,
  input: { priceMinor: number; version: number },
) {
  const priceMinor = voiceAddOnPriceSchema.parse(input.priceMinor);
  const remote = await stripe.products.create(
    {
      name: `${product.data.name} · premium voice`,
      description: "Premium guided voice add-on for this coaching membership",
      metadata: {
        tenant_id: tenantId,
        product_id: product.id,
        purpose: "voice_addon",
      },
    },
    { idempotencyKey: `voice-product:${product.id}` },
  );
  const price = await stripe.prices.create(
    {
      product: remote.id,
      currency: "aed",
      unit_amount: priceMinor,
      recurring: { interval: "month" },
      metadata: {
        tenant_id: tenantId,
        product_id: product.id,
        purpose: "voice_addon",
      },
    },
    {
      idempotencyKey: `voice-price:${product.id}:v${input.version}:${priceMinor}`,
    },
  );
  const history: string[] = Array.isArray(product.data.voicePriceIds)
    ? product.data.voicePriceIds
    : [];
  return {
    voiceAddOnMinor: priceMinor,
    voiceStripeProductId: remote.id,
    voiceStripePriceId: price.id,
    // Members keep the add-on price they bought; every price the offer ever
    // used stays recognised for their provider events.
    voicePriceIds: Array.from(new Set([...history, price.id])),
  };
}

/** The trainer sets or changes the voice add-on price of a published offer. */
export function registerOfferVoiceAddOn(
  app: FastifyInstance,
  db: Database,
  owner: (req: FastifyRequest) => Actor,
  commerce: () => StripeLike,
) {
  app.post("/api/v1/products/:id/voice-addon", async (req) => {
    const a = owner(req);
    const body = z
      .object({ priceMinor: voiceAddOnPriceSchema })
      .strict()
      .parse(req.body);
    const productId = uuid.parse((req.params as any).id);
    const product = await db.tenant(a, async (tx) => {
      const [p] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='product'",
        [productId],
      );
      if (!p) throw fail("NOT_FOUND", "This offer is unavailable", 404);
      if (p.data.voiceIncluded === true || p.data.premiumVoice === true)
        throw fail(
          "VOICE_INCLUDED",
          "This offer already includes premium voice for its members.",
        );
      return p;
    });
    if (
      product.data.voiceStripePriceId &&
      product.data.voiceAddOnMinor === body.priceMinor
    )
      return { ok: true, voiceAddOnMinor: body.priceMinor };
    // A draft offer keeps the price until activation creates it with Stripe.
    const voice =
      product.status === "published"
        ? await createVoiceAddOnPrice(commerce(), a.tenantId, product, {
            priceMinor: body.priceMinor,
            version: product.version,
          })
        : { voiceAddOnMinor: body.priceMinor };
    await db.tenant(a, async (tx) => {
      await tx.query(
        "UPDATE records SET data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND kind='product'",
        [product.id, JSON.stringify(voice)],
      );
      await event(tx, a, "product.voice_addon_priced", product.id, {
        priceMinor: body.priceMinor,
      });
    });
    return { ok: true, voiceAddOnMinor: body.priceMinor };
  });
}

/**
 * Whether a member's current row blocks a new membership purchase.
 * `renew_upfront`: an upfront programme in its last days (another upfront
 * programme may be bought; it is queued to start when the current one ends).
 * `ended`: an upfront programme whose access has ended.
 */
export function upfrontAdmission(
  s: any,
  now = Date.now(),
): "none" | "held" | "renew_upfront" | "ended" {
  if (!s) return "none";
  if (s.data?.billing !== "upfront") return "held";
  const end = s.period_end ? new Date(s.period_end).getTime() : 0;
  if (["canceled", "incomplete_expired"].includes(s.status) || end <= now)
    return "ended";
  // One programme is queued at a time.
  const next = s.data?.nextProgramme;
  if (next && !(Date.parse(next.startsAt) <= now)) return "held";
  return end - now <= RENEWAL_WINDOW_DAYS * DAY ? "renew_upfront" : "held";
}

function optionalStripe(): StripeLike | undefined {
  try {
    return stripeClient();
  } catch {
    return undefined;
  }
}
async function checkoutLock(tx: Tx, tenantId: string, userId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId]);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":checkout:" + userId,
  ]);
}

/**
 * Upfront programme Checkout events (`mode: payment`, `purpose: programme`).
 * Only signed webhook payloads or authenticated provider reads reach it.
 */
export async function processProgrammeCheckoutEvent(
  db: Database,
  e: any,
  deps: { stripe?: StripeLike } = {},
) {
  const remote = e.data?.object;
  if (remote?.mode !== "payment" || remote.metadata?.purpose !== "programme")
    return false;
  if (
    ![
      "checkout.session.completed",
      "checkout.session.expired",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
    ].includes(e.type)
  )
    return false;
  const intentId = remote.metadata?.intent_id ?? remote.client_reference_id;
  if (
    !uuid.safeParse(intentId).success ||
    !uuid.safeParse(remote.metadata?.tenant_id).success ||
    !uuid.safeParse(remote.metadata?.user_id).success
  )
    throw fail(
      "CHECKOUT_MAPPING_REQUIRED",
      "Programme checkout tenant, user and business intent are required",
    );
  // The provider acted, not the member: a service identity scopes the
  // projection; the member is the subject of its rows.
  const a = elevated("provider-callback", {
    tenantId: remote.metadata.tenant_id,
    role: "finance",
  });
  const [r] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM records WHERE id=$1 AND kind='checkout'", [
      intentId,
    ]),
  );
  if (!r)
    throw fail(
      "CHECKOUT_MAPPING_REQUIRED",
      "Programme checkout business intent is unavailable",
    );
  if (
    r.data.billing !== "upfront" ||
    remote.client_reference_id !== r.id ||
    remote.metadata?.intent_id !== r.id ||
    remote.metadata?.user_id !== r.owner_user_id ||
    (r.data.providerId && r.data.providerId !== remote.id)
  )
    throw fail(
      "CHECKOUT_IDENTITY_MISMATCH",
      "Checkout identity does not match its original instruction",
    );
  const memberId = r.owner_user_id as string;
  if (
    e.type === "checkout.session.expired" ||
    e.type === "checkout.session.async_payment_failed"
  ) {
    if (e.type === "checkout.session.expired" && remote.status !== "expired")
      throw fail(
        "CHECKOUT_STATE_MISMATCH",
        "Provider has not confirmed checkout expiry",
      );
    await db.tenant(a, async (tx) => {
      await checkoutLock(tx, a.tenantId, memberId);
      const [current] = await tx.query(
        "SELECT * FROM records WHERE id=$1 FOR UPDATE",
        [r.id],
      );
      if (["completed", "closed", "expired"].includes(current.status)) return;
      await tx.query(
        "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE id=$1",
        [
          r.id,
          e.type === "checkout.session.expired" ? "expired" : "closed",
          JSON.stringify({
            providerId: remote.id,
            providerStatus:
              e.type === "checkout.session.expired"
                ? "expired"
                : "payment_failed",
            expiryEvidence: e.id,
          }),
        ],
      );
      await event(
        tx,
        a,
        e.type === "checkout.session.expired"
          ? "checkout.expired"
          : "programme.payment_failed",
        r.id,
        { providerEventId: e.id, providerId: remote.id },
      );
    });
    return true;
  }
  if (remote.status !== "complete")
    throw fail(
      "CHECKOUT_STATE_MISMATCH",
      "Provider has not confirmed a completed programme checkout",
    );
  if (remote.payment_status === "unpaid") {
    // A delayed payment method: access starts on async_payment_succeeded.
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE records SET data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND status NOT IN ('completed','closed','expired')",
        [
          r.id,
          JSON.stringify({
            providerId: remote.id,
            providerStatus: "processing",
          }),
        ],
      ),
    );
    return true;
  }
  const amount = remote.amount_total;
  if (
    !["paid", "no_payment_required"].includes(remote.payment_status) ||
    remote.currency !== "aed" ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > r.data.amountMinor ||
    (!r.data.offerTerms?.couponId && amount !== r.data.amountMinor)
  )
    throw fail(
      "PROGRAMME_AMOUNT_MISMATCH",
      "Payment amount, currency or status does not match the reserved programme",
    );
  const paymentIntentId = idOf(remote.payment_intent);
  let chargeId: string | undefined = r.data.chargeId ?? undefined;
  if (amount > 0 && !chargeId && paymentIntentId) {
    const stripe = deps.stripe ?? optionalStripe();
    if (stripe)
      chargeId = idOf(
        (await stripe.paymentIntents.retrieve(paymentIntentId)).latest_charge,
      );
  }
  // Journals are immutable, so the refundable charge must be known first.
  if (amount > 0 && (!paymentIntentId || !chargeId))
    throw new Error(
      "Programme payment identity unresolved; retain receipt for reconciliation",
    );
  await db.system(async (tx) => {
    for (const [externalId, kind] of [
      [remote.id, "checkout.session"],
      [paymentIntentId, "programme_payment_intent"],
      [chargeId, "charge"],
    ])
      if (externalId) {
        const [old] = await tx.query(
          "SELECT tenant_id,user_id FROM provider_objects WHERE provider='stripe' AND external_id=$1",
          [externalId],
        );
        if (old && (old.tenant_id !== a.tenantId || old.user_id !== memberId))
          throw new Error("Conflicting provider object ownership");
        await tx.query(
          "INSERT INTO provider_objects(provider,external_id,tenant_id,user_id,kind) VALUES('stripe',$1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [externalId, a.tenantId, memberId, kind],
        );
      }
  });
  let paid = false;
  await db.tenant(a, async (tx) => {
    await checkoutLock(tx, a.tenantId, memberId);
    const [current] = await tx.query(
      "SELECT * FROM records WHERE id=$1 FOR UPDATE",
      [r.id],
    );
    if (current.status === "completed" && current.data.accessEndsAt) return;
    const [product] = await tx.query(
      "SELECT id,data FROM records WHERE id=$1 AND kind='product'",
      [r.data.productId],
    );
    if (!product)
      throw fail(
        "PRODUCT_UNAVAILABLE",
        "The programme offer of this payment is unavailable",
      );
    const days = effectiveProgrammeDays(r.data.programmeDays);
    const paidAt = new Date(
      (Number(e.created) || Math.floor(Date.now() / 1000)) * 1000,
    );
    const [locked] = await tx.query(
      "SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE",
      [memberId],
    );
    const s = await promoteQueuedProgramme(tx, a, locked);
    const sEnd = s?.period_end ? new Date(s.period_end).getTime() : 0;
    const liveUpfront =
      s?.data?.billing === "upfront" &&
      !["canceled", "incomplete_expired"].includes(s.status) &&
      sEnd > paidAt.getTime();
    // A current monthly membership should have blocked this purchase, as
    // should a second queued programme. The money is still posted; access is
    // not replaced and finance reviews it.
    const monthlyConflict =
      !!s &&
      s.data?.billing !== "upfront" &&
      !!s.provider_id &&
      !["canceled", "incomplete_expired"].includes(s.status) &&
      (!s.period_end || sEnd > paidAt.getTime());
    const queueConflict = liveUpfront && !!s.data?.nextProgramme;
    const conflict = monthlyConflict || queueConflict;
    // A programme renewed before the current one ends is queued: it starts
    // when the current programme ends, so both keep their own Day 1..M.
    const startsAt = liveUpfront ? new Date(sEnd) : paidAt;
    const endsAt = new Date(startsAt.getTime() + days * DAY);
    const firstPaidAt: string | undefined =
      s?.data?.firstPaidAt ?? (amount > 0 ? paidAt.toISOString() : undefined);
    const window = {
      intentId: r.id,
      checkoutId: remote.id,
      paymentIntentId: paymentIntentId ?? null,
      chargeId: chargeId ?? null,
      amountMinor: amount,
      paidAt: paidAt.toISOString(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      queuedAfter: liveUpfront ? new Date(sEnd).toISOString() : null,
      programmeDays: days,
      productId: product.id,
      tier: product.data.tier ?? "workout",
      modules: product.data.modules ?? ["training"],
      premiumVoice: product.data.premiumVoice === true,
      priceId: r.data.priceId,
      listPriceMinor: r.data.amountMinor,
    };
    if (!conflict && liveUpfront)
      // Access continues through the queued programme; the current window,
      // offer and Day 1 stay until it starts (promoteQueuedProgramme).
      await tx.query(
        "UPDATE subscriptions SET period_end=$2,data=data||$3::jsonb WHERE id=$1",
        [
          s.id,
          endsAt,
          JSON.stringify({
            nextProgramme: window,
            ...(firstPaidAt && !s.data?.firstPaidAt ? { firstPaidAt } : {}),
          }),
        ],
      );
    else if (!conflict) {
      const keep = s
        ? Object.fromEntries(
            [
              "commissionRank",
              "commissionRankMethod",
              "firstPaidAt",
              "voiceAddOn",
            ]
              .filter((k) => s.data?.[k] !== undefined)
              .map((k) => [k, s.data[k]]),
          )
        : {};
      const history = Array.isArray(s?.data?.programmeHistory)
        ? s.data.programmeHistory
        : [];
      const data = {
        ...keep,
        billing: "upfront",
        productId: product.id,
        tier: product.data.tier ?? "workout",
        modules: product.data.modules ?? ["training"],
        // An older offer that included premium voice keeps including it.
        premiumVoice: product.data.premiumVoice === true,
        priceId: r.data.priceId,
        programmeDays: days,
        programmeStartsAt: startsAt.toISOString(),
        upfront: window,
        programmeHistory: [
          ...history,
          ...(s?.data?.upfront ? [s.data.upfront] : []),
        ].slice(-10),
        ...(firstPaidAt ? { firstPaidAt } : {}),
        graceUntil: null,
        pastDueSince: null,
      };
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,provider_id,status,period_end,cancel_at_period_end,price_minor,data) VALUES($1,$2,$3,NULL,'active',$4,false,$5,$6) ON CONFLICT(tenant_id,user_id) DO UPDATE SET provider_id=NULL,status='active',period_end=excluded.period_end,cancel_at_period_end=false,price_minor=excluded.price_minor,data=excluded.data",
        [
          randomUUID(),
          a.tenantId,
          memberId,
          endsAt,
          r.data.amountMinor,
          JSON.stringify(data),
        ],
      );
    }
    if (amount > 0) {
      const [row] = await tx.query(
        "SELECT * FROM subscriptions WHERE user_id=$1",
        [memberId],
      );
      const rank = await assignCommissionRank(
        tx,
        memberId,
        row,
        firstPaidAt,
        PROGRAMME_RANK_METHOD,
      );
      await recordCharge(tx, a, `stripe-programme:${r.id}`, amount, rank, {
        description: "Programme payment",
        purpose: "programme",
        userId: memberId,
        chargeId: chargeId ?? null,
        paymentIntentId: paymentIntentId ?? null,
        checkoutId: remote.id,
        intentId: r.id,
        productId: product.id,
        programmeDays: days,
        accessStartsAt: startsAt.toISOString(),
        accessEndsAt: endsAt.toISOString(),
        chargedAt: paidAt.toISOString(),
        firstPaidAt,
        rankMethod: row?.data?.commissionRankMethod ?? PROGRAMME_RANK_METHOD,
      });
      paid = true;
    }
    await tx.query(
      "UPDATE records SET status='completed',data=data||$2::jsonb,updated_at=now() WHERE id=$1",
      [
        r.id,
        JSON.stringify({
          providerId: remote.id,
          providerStatus: "complete",
          paymentIntentId: paymentIntentId ?? null,
          chargeId: chargeId ?? null,
          amountPaidMinor: amount,
          accessStartsAt: startsAt.toISOString(),
          accessEndsAt: endsAt.toISOString(),
          ...(conflict ? { accessConflict: true } : {}),
        }),
      ],
    );
    if (conflict)
      await putRecord(
        tx,
        a,
        "reconciliation",
        {
          reason: queueConflict
            ? "An upfront programme was paid while another is already queued; review access and refund"
            : "An upfront programme was paid while a monthly membership is current; review access and refund",
          checkoutId: r.id,
          userId: memberId,
          chargeId: chargeId ?? null,
          amountMinor: amount,
        },
        { ownerId: memberId, status: "open" },
      );
    await event(tx, a, "checkout.completed", r.id, {
      providerEventId: e.id,
      providerId: remote.id,
    });
    await event(
      tx,
      a,
      conflict ? "programme.payment_conflict" : "programme.paid",
      r.id,
      {
        memberId,
        programmeDays: days,
        accessStartsAt: startsAt.toISOString(),
        accessEndsAt: endsAt.toISOString(),
        queued: liveUpfront && !conflict,
        amountMinor: amount,
      },
    );
  });
  if (paid)
    try {
      await recordFirstPaidAcquisition(db, a.tenantId, memberId);
    } catch {
      console.warn("Payment acquisition conversion could not be recorded");
    }
  return true;
}

/**
 * Finance obligations job: resolves an uncertain upfront programme checkout
 * from provider evidence only (the member's own reconcile goes through
 * finance-checkout's reconcileMembershipCheckout).
 */
export async function reconcileProgrammeCheckout(
  db: Database,
  r: any,
  stripe: StripeLike,
) {
  let remote: any;
  if (r.data.providerId)
    remote = await stripe.checkout.sessions.retrieve(r.data.providerId);
  else {
    const page = await stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: Math.floor(new Date(r.created_at).getTime() / 1000) - 60 },
    });
    const matches = page.data.filter(
      (item: any) => item.client_reference_id === r.id,
    );
    if (matches.length > 1)
      throw fail(
        "CHECKOUT_DUPLICATE_PROVIDER",
        "Multiple provider checkouts match one programme purchase; operator reconciliation is required",
      );
    remote = matches[0];
  }
  if (!remote)
    throw fail(
      "CHECKOUT_UNRESOLVED",
      "No provider outcome is confirmed; the programme purchase remains held",
    );
  if (remote.status === "complete" || remote.status === "expired") {
    await processProgrammeCheckoutEvent(
      db,
      {
        id: `reconcile-programme-checkout:${remote.id}:${remote.status}`,
        type:
          remote.status === "complete"
            ? "checkout.session.completed"
            : "checkout.session.expired",
        data: { object: remote },
      },
      { stripe },
    );
    return { status: remote.status as string };
  }
  if (remote.status === "open" && remote.url && remote.client_reference_id === r.id) {
    await db.tenant(
      elevated("provider-callback", { tenantId: r.tenant_id, role: "finance" }),
      (tx) =>
        tx.query(
          "UPDATE records SET status='open',data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND status IN ('creating','unknown','open')",
          [
            r.id,
            JSON.stringify({
              providerId: remote.id,
              checkoutUrl: remote.url,
              providerStatus: "open",
              expiresAt: new Date(remote.expires_at * 1000).toISOString(),
            }),
          ],
        ),
    );
    return { status: "open" };
  }
  throw fail(
    "CHECKOUT_UNRESOLVED",
    "The programme checkout outcome remains uncertain; it stays held",
  );
}

/** The access fields of a programme window, as the membership row holds them. */
const windowAccess = (w: any) => ({
  upfront: w,
  programmeStartsAt: w.startsAt,
  programmeDays: w.programmeDays,
  ...(w.productId ? { productId: w.productId } : {}),
  ...(w.tier ? { tier: w.tier } : {}),
  ...(Array.isArray(w.modules) ? { modules: w.modules } : {}),
  ...(typeof w.premiumVoice === "boolean" ? { premiumVoice: w.premiumVoice } : {}),
  ...(w.priceId ? { priceId: w.priceId } : {}),
});
const historyWith = (s: any, w: any) =>
  [
    ...(Array.isArray(s.data?.programmeHistory) ? s.data.programmeHistory : []),
    ...(w ? [w] : []),
  ].slice(-10);

/**
 * A queued programme becomes the current one once its start has passed:
 * its window, offer, length and Day 1 replace the finished programme's, which
 * moves to the history. Runs under the row lock the caller holds (the
 * checkout projection, a refund, the worker sweep) and returns the row.
 */
export async function promoteQueuedProgramme(
  tx: Tx,
  a: Actor,
  s: any,
  now = Date.now(),
) {
  const next = s?.data?.billing === "upfront" ? s.data.nextProgramme : null;
  if (!next || !(Date.parse(next.startsAt) <= now)) return s;
  const [row] = await tx.query(
    "UPDATE subscriptions SET price_minor=coalesce($3::bigint,price_minor),data=(data||$2::jsonb)-'nextProgramme' WHERE id=$1 RETURNING *",
    [
      s.id,
      JSON.stringify({
        ...windowAccess(next),
        programmeHistory: historyWith(s, s.data.upfront),
      }),
      Number.isSafeInteger(next.listPriceMinor) ? next.listPriceMinor : null,
    ],
  );
  await event(tx, a, "programme.started", next.intentId, {
    memberId: s.user_id,
    programmeDays: next.programmeDays,
    startsAt: next.startsAt,
    endsAt: next.endsAt,
  });
  return row;
}

/**
 * A fully refunded upfront programme charge ends the access it paid for.
 * The current programme ends now (a queued one then starts now); a queued
 * programme is removed and access returns to the end of the current one; a
 * programme already over changes nothing. Runs in the provider callback's
 * scope inside the refund projection.
 */
export async function endRefundedProgramme(
  tx: Tx,
  a: Actor,
  memberId: string,
  original: any,
  refundId: string,
) {
  const [locked] = await tx.query(
    "SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE",
    [memberId],
  );
  const s = await promoteQueuedProgramme(tx, a, locked);
  if (!s || s.data?.billing !== "upfront") return;
  const intentId = original.data.intentId;
  const now = Date.now();
  const at = new Date(now).toISOString();
  const current = s.data.upfront,
    next = s.data.nextProgramme;
  let accessEndsAt: string;
  if (next?.intentId === intentId) {
    // The queued programme is refunded before it started.
    accessEndsAt = current?.endsAt ?? new Date(s.period_end).toISOString();
    await tx.query(
      "UPDATE subscriptions SET period_end=$2,data=(data-'nextProgramme')||$3::jsonb WHERE id=$1",
      [
        s.id,
        accessEndsAt,
        JSON.stringify({
          programmeHistory: historyWith(s, {
            ...next,
            refundedAt: at,
            refundId,
          }),
        }),
      ],
    );
  } else if (current?.intentId === intentId) {
    const refunded = { ...current, refundedAt: at, refundId };
    if (next) {
      // The queued programme starts now, for its full length.
      const startsNow = {
        ...next,
        startsAt: at,
        endsAt: new Date(now + effectiveProgrammeDays(next.programmeDays) * DAY).toISOString(),
      };
      accessEndsAt = startsNow.endsAt;
      await tx.query(
        "UPDATE subscriptions SET status='active',period_end=$2,price_minor=coalesce($4::bigint,price_minor),data=(data-'nextProgramme')||$3::jsonb WHERE id=$1",
        [
          s.id,
          accessEndsAt,
          JSON.stringify({
            ...windowAccess(startsNow),
            programmeHistory: historyWith(s, refunded),
          }),
          Number.isSafeInteger(next.listPriceMinor) ? next.listPriceMinor : null,
        ],
      );
    } else {
      accessEndsAt = at;
      await tx.query(
        "UPDATE subscriptions SET status='canceled',period_end=least(period_end,$2::timestamptz),data=data||$3::jsonb WHERE id=$1",
        [
          s.id,
          at,
          JSON.stringify({
            upfront: refunded,
            endedReason: "refunded",
            endedAt: at,
          }),
        ],
      );
    }
  } else return;
  await event(tx, a, "programme.refunded", intentId, {
    memberId,
    refundId,
    accessEndsAt,
  });
}
