import type { FastifyInstance, FastifyRequest } from "fastify";
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
import { assignCommissionRank, recordCharge } from "./finance.ts";
import { subscriptionHasAccess } from "./finance-billing.ts";
import { resolveInvoicePayment } from "./stripe-events.ts";

/**
 * Premium voice as an add-on to a membership (docs/features/programme.md).
 *
 * The add-on is its own Stripe subscription at the trainer-set monthly price
 * of the member's offer, tied to the membership: it is bought only with paid
 * access, entitles only while that access lasts, and the worker cancels it
 * when the membership ends. The provider state is mirrored into the member's
 * `subscriptions.data.voiceAddOn`, which a member cannot write (migration
 * 061 guard). Only a price that is (or was) one of the workspace's add-on
 * prices verifies an add-on; metadata never grants voice.
 */
type StripeLike = ReturnType<typeof stripeClient>;
const uuid = z.string().uuid();
const fail = (code: string, message: string, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode, code });
const idOf = (value: any): string | undefined =>
  typeof value === "string" ? value : (value?.id ?? undefined);
const TERMINAL = new Set(["canceled", "incomplete_expired", "unpaid"]);
const ENTITLED = new Set(["active", "trialing"]);
export const VOICE_RANK_METHOD = "stable-first-paid-v2";

export type VoiceAddOnState = {
  providerId: string;
  status: string;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  priceId: string | null;
  productId: string | null;
  verified: boolean;
  lastStripeEventAt: number;
  intentId?: string | null;
};
/** An add-on grants voice while its verified provider subscription is current. */
export function voiceAddOnEntitled(v: any, now = Date.now()): boolean {
  return (
    !!v &&
    v.verified === true &&
    ENTITLED.has(v.status) &&
    (!v.periodEnd || Date.parse(v.periodEnd) > now)
  );
}
/** Voice sold as part of an older offer's price keeps being included. */
export const voiceIncluded = (data: any) =>
  data?.premiumVoice === true || data?.modules?.includes?.("voice") === true;

function optionalStripe(): StripeLike | undefined {
  try {
    return stripeClient();
  } catch {
    return undefined;
  }
}
const providerActor = (tenantId: string) =>
  elevated("provider-callback", { tenantId, role: "finance" });
async function lock(tx: Tx, tenantId: string, userId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId]);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    tenantId + ":voice:" + userId,
  ]);
}
async function mapOwner(
  db: Database,
  refs: Array<string | undefined>,
  metadata: any,
) {
  if (
    uuid.safeParse(metadata?.tenant_id).success &&
    uuid.safeParse(metadata?.user_id).success
  )
    return {
      tenantId: metadata.tenant_id as string,
      userId: metadata.user_id as string,
    };
  const ids = refs.filter(Boolean);
  if (!ids.length) return null;
  const [m] = await db.system((tx) =>
    tx.query(
      "SELECT tenant_id,user_id FROM provider_objects WHERE provider='stripe' AND external_id=ANY($1::text[]) AND kind IN ('voice_addon_subscription','voice_addon_invoice') LIMIT 1",
      [ids],
    ),
  );
  return m ? { tenantId: m.tenant_id, userId: m.user_id } : null;
}
async function recordOwnership(
  db: Database,
  tenantId: string,
  userId: string,
  objects: Array<[string | undefined, string]>,
) {
  await db.system(async (tx) => {
    for (const [externalId, kind] of objects)
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
}
async function isVoiceSubscription(db: Database, id?: string) {
  if (!id) return false;
  const [row] = await db.system((tx) =>
    tx.query(
      "SELECT 1 FROM provider_objects WHERE provider='stripe' AND external_id=$1 AND kind='voice_addon_subscription'",
      [id],
    ),
  );
  return !!row;
}

/**
 * Routes a signed provider event (or an authenticated provider read) that
 * concerns a voice add-on. Returns false for every other event.
 */
export async function processVoiceAddOnEvent(
  db: Database,
  e: any,
  deps: { stripe?: StripeLike } = {},
) {
  const object = e.data?.object;
  if (!object) return false;
  if (e.type.startsWith("checkout.session.")) {
    if (object.mode !== "subscription" || object.metadata?.purpose !== "voice_addon")
      return false;
    await processVoiceCheckout(db, e);
    return true;
  }
  if (e.type.startsWith("customer.subscription.")) {
    if (
      object.metadata?.purpose !== "voice_addon" &&
      !(await isVoiceSubscription(db, object.id))
    )
      return false;
    const owner = await mapOwner(db, [object.id], object.metadata);
    if (!owner)
      throw new Error(
        "Voice add-on mapping unresolved; retain receipt for reconciliation",
      );
    await projectVoiceAddOn(db, owner.tenantId, owner.userId, object, {
      eventId: e.id,
      eventTime: Number(e.created ?? 0),
      stripe: deps.stripe,
    });
    return true;
  }
  if (e.type === "invoice.paid" || e.type === "invoice.payment_failed") {
    const meta =
      object.parent?.subscription_details?.metadata ??
      object.subscription_details?.metadata;
    const subscriptionId =
      idOf(object.subscription) ??
      object.parent?.subscription_details?.subscription;
    if (
      meta?.purpose !== "voice_addon" &&
      !(await isVoiceSubscription(db, subscriptionId))
    )
      return false;
    await processVoiceInvoice(db, e, subscriptionId, meta, deps);
    return true;
  }
  return false;
}

async function processVoiceCheckout(db: Database, e: any) {
  const remote = e.data.object;
  const intentId = remote.metadata?.intent_id ?? remote.client_reference_id;
  if (
    !uuid.safeParse(intentId).success ||
    !uuid.safeParse(remote.metadata?.tenant_id).success ||
    !uuid.safeParse(remote.metadata?.user_id).success
  )
    throw fail(
      "CHECKOUT_MAPPING_REQUIRED",
      "Voice add-on checkout tenant, user and business intent are required",
    );
  const a = providerActor(remote.metadata.tenant_id);
  const [r] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM records WHERE id=$1 AND kind='checkout'", [
      intentId,
    ]),
  );
  if (
    !r ||
    r.data.purpose !== "voice_addon" ||
    remote.client_reference_id !== r.id ||
    remote.metadata?.user_id !== r.owner_user_id ||
    (r.data.providerId && r.data.providerId !== remote.id)
  )
    throw fail(
      "CHECKOUT_IDENTITY_MISMATCH",
      "Voice add-on checkout does not match its original instruction",
    );
  const subscriptionId = idOf(remote.subscription);
  const expired = e.type === "checkout.session.expired";
  if (expired ? remote.status !== "expired" : remote.status !== "complete" || !subscriptionId)
    throw fail(
      "CHECKOUT_STATE_MISMATCH",
      "Provider has not confirmed the voice add-on checkout outcome",
    );
  if (subscriptionId)
    await recordOwnership(db, a.tenantId, r.owner_user_id, [
      [subscriptionId, "voice_addon_subscription"],
    ]);
  await db.tenant(a, async (tx) => {
    await lock(tx, a.tenantId, r.owner_user_id);
    const [current] = await tx.query(
      "SELECT * FROM records WHERE id=$1 FOR UPDATE",
      [r.id],
    );
    if (expired && ["completed", "closed"].includes(current.status)) return;
    await tx.query(
      "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE id=$1",
      [
        r.id,
        expired ? "expired" : "completed",
        JSON.stringify({
          providerId: remote.id,
          providerStatus: expired ? "expired" : "complete",
          ...(subscriptionId ? { subscriptionId } : {}),
        }),
      ],
    );
    await event(
      tx,
      a,
      expired ? "voice_addon.checkout_expired" : "voice_addon.checkout_completed",
      r.id,
      { providerEventId: e.id, providerId: remote.id },
    );
  });
}

/** Mirrors a provider add-on subscription into the member's membership row. */
export async function projectVoiceAddOn(
  db: Database,
  tenantId: string,
  userId: string,
  input: any,
  meta: { eventId: string; eventTime: number; stripe?: StripeLike },
) {
  let object = input;
  const a = providerActor(tenantId);
  const [member] = await db.system((tx) =>
    tx.query(
      "SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [tenantId, userId],
    ),
  );
  // A follower who left keeps a recorded exit; the winding-down add-on's
  // remaining provider events must still be mirrored.
  const [former] = member
    ? []
    : await db.tenant(a, (tx) =>
        tx.query("SELECT id FROM membership_exits WHERE user_id=$1 LIMIT 1", [
          userId,
        ]),
      );
  if (!member && !former)
    throw new Error("Voice add-on refers to an unknown subscriber relationship");
  await recordOwnership(db, tenantId, userId, [
    [object.id, "voice_addon_subscription"],
  ]);
  const [row] = await db.tenant(a, (tx) =>
    tx.query(
      "SELECT data->'voiceAddOn' AS v FROM subscriptions WHERE user_id=$1",
      [userId],
    ),
  );
  if (
    row?.v?.providerId === object.id &&
    Number(row.v.lastStripeEventAt ?? 0) === meta.eventTime &&
    meta.eventTime
  ) {
    // Same-second events arrive in any order: apply the provider's current object.
    const stripe = meta.stripe ?? optionalStripe();
    if (stripe) {
      const remote: any = await stripe.subscriptions.retrieve(object.id);
      if (remote.id !== object.id)
        throw new Error("Conflicting provider object ownership");
      object = { ...remote, metadata: { ...object.metadata, ...remote.metadata } };
    }
  }
  const line = object.items?.data?.[0];
  const priceId: string | null =
    (typeof line?.price === "string" ? line.price : line?.price?.id) ?? null;
  const period =
    object.current_period_end ?? line?.current_period_end ?? null;
  await db.tenant(a, async (tx) => {
    await lock(tx, tenantId, userId);
    const [s] = await tx.query(
      "SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE",
      [userId],
    );
    if (!s)
      throw new Error(
        "A voice add-on without a membership requires reconciliation",
      );
    const v: VoiceAddOnState | undefined = s.data?.voiceAddOn ?? undefined;
    if (v && v.providerId === object.id && meta.eventTime < v.lastStripeEventAt)
      return;
    if (v && v.providerId !== object.id && !TERMINAL.has(v.status)) {
      // An older add-on's late event never replaces the current one.
      if (TERMINAL.has(object.status)) return;
      throw new Error(
        "A different active voice add-on requires reconciliation before replacing the current one",
      );
    }
    const [offer] = priceId
      ? await tx.query(
          "SELECT id FROM records WHERE kind='product' AND (data->>'voiceStripePriceId'=$1 OR coalesce(data->'voicePriceIds','[]'::jsonb) ? $1) LIMIT 1",
          [priceId],
        )
      : [];
    const next: VoiceAddOnState = {
      providerId: object.id,
      status: String(object.status),
      periodEnd: period ? new Date(period * 1000).toISOString() : null,
      cancelAtPeriodEnd: !!object.cancel_at_period_end,
      priceId,
      productId: offer?.id ?? null,
      verified: !!offer,
      lastStripeEventAt: Math.max(meta.eventTime, v?.lastStripeEventAt ?? 0),
      intentId: object.metadata?.intent_id ?? v?.intentId ?? null,
    };
    await tx.query(
      "UPDATE subscriptions SET data=data||jsonb_build_object('voiceAddOn',$2::jsonb) WHERE id=$1",
      [s.id, JSON.stringify(next)],
    );
    await tx.query(
      "UPDATE records SET status=$3,data=data||$4::jsonb,updated_at=now() WHERE kind='checkout' AND owner_user_id=$1 AND data->>'purpose'='voice_addon' AND (data->>'subscriptionId'=$2 OR id::text=$5) AND status<>'closed'",
      [
        userId,
        object.id,
        TERMINAL.has(object.status) ? "closed" : "completed",
        JSON.stringify({
          subscriptionId: object.id,
          subscriptionStatus: object.status,
        }),
        uuid.safeParse(object.metadata?.intent_id).success
          ? object.metadata.intent_id
          : "",
      ],
    );
    await event(tx, a, "voice_addon.updated", object.id, {
      memberId: userId,
      status: object.status,
      verified: next.verified,
      cancelAtPeriodEnd: next.cancelAtPeriodEnd,
      providerEventId: meta.eventId,
    });
  });
}

async function processVoiceInvoice(
  db: Database,
  e: any,
  subscriptionId: string | undefined,
  meta: any,
  deps: { stripe?: StripeLike },
) {
  const object = e.data.object;
  let chargeId: string | undefined = idOf(object.charge),
    paymentIntentId: string | undefined = idOf(object.payment_intent);
  const owner = await mapOwner(
    db,
    [subscriptionId, object.id, chargeId],
    object.metadata?.tenant_id ? object.metadata : meta,
  );
  if (!owner || !subscriptionId)
    throw new Error(
      "Voice add-on invoice mapping unresolved; retain receipt for reconciliation",
    );
  const { tenantId, userId } = owner;
  const a = providerActor(tenantId);
  const eventTime = Number(e.created ?? 0);
  if (e.type === "invoice.paid" && !chargeId && object.amount_paid > 0) {
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
  await recordOwnership(db, tenantId, userId, [
    [subscriptionId, "voice_addon_subscription"],
    [object.id, "voice_addon_invoice"],
    [chargeId, "charge"],
    [paymentIntentId, "payment_intent"],
  ]);
  let paid = false;
  await db.tenant(a, async (tx) => {
    await lock(tx, tenantId, userId);
    const [s] = await tx.query(
      "SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE",
      [userId],
    );
    if (!s)
      throw new Error(
        "A voice add-on invoice without a membership requires reconciliation",
      );
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
    const snapshot = {
      invoiceId: object.id,
      subscriptionId,
      purpose: "voice_addon",
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
    const [invoice] = await tx.query(
      "SELECT * FROM records WHERE kind='billing_invoice' AND data->>'invoiceId'=$1",
      [object.id],
    );
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
    const v = s.data?.voiceAddOn;
    const current = v?.providerId === subscriptionId;
    if (e.type === "invoice.payment_failed") {
      if (current && eventTime >= Number(v.lastStripeEventAt ?? 0))
        await tx.query(
          "UPDATE subscriptions SET data=data||jsonb_build_object('voiceAddOn',$2::jsonb) WHERE id=$1",
          [
            s.id,
            JSON.stringify({
              ...v,
              status: "past_due",
              lastStripeEventAt: eventTime,
            }),
          ],
        );
      await event(tx, a, "voice_addon.payment_failed", object.id, {
        memberId: userId,
        providerEventId: e.id,
      });
      return;
    }
    const amount = object.amount_paid;
    if (!Number.isSafeInteger(amount) || amount < 0 || object.currency !== "aed")
      throw new Error("Unsupported invoice amount/currency");
    const end = object.lines?.data?.[0]?.period?.end ?? object.period_end;
    if (current && end && eventTime >= Number(v.lastStripeEventAt ?? 0) && !TERMINAL.has(v.status))
      await tx.query(
        "UPDATE subscriptions SET data=data||jsonb_build_object('voiceAddOn',$2::jsonb) WHERE id=$1",
        [
          s.id,
          JSON.stringify({
            ...v,
            status: "active",
            periodEnd: new Date(
              Math.max(Date.parse(v.periodEnd ?? "") || 0, end * 1000),
            ).toISOString(),
            lastStripeEventAt: eventTime,
          }),
        ],
      );
    if (amount > 0) {
      const chargedAt = new Date(
        (object.created ?? e.created ?? Date.now() / 1000) * 1000,
      ).toISOString();
      const firstPaidAt: string = s.data?.firstPaidAt ?? chargedAt;
      const rank = await assignCommissionRank(
        tx,
        userId,
        s,
        firstPaidAt,
        VOICE_RANK_METHOD,
      );
      await recordCharge(tx, a, `stripe-invoice:${object.id}`, amount, rank, {
        description: "Voice add-on payment",
        purpose: "voice_addon",
        userId,
        chargeId: chargeId ?? null,
        paymentIntentId: paymentIntentId ?? null,
        invoiceId: object.id,
        subscriptionId,
        chargedAt,
        firstPaidAt,
        rankMethod: s.data?.commissionRankMethod ?? VOICE_RANK_METHOD,
      });
      paid = true;
    }
    await event(tx, a, "voice_addon.invoice_paid", object.id, {
      memberId: userId,
      providerEventId: e.id,
    });
  });
  return paid;
}

// ---------------------------------------------------------------- member API

type Member = Actor & { email?: string };
const subscriber = (a: Actor) => {
  if (a.role !== "subscriber")
    throw fail("SUBSCRIBER_REQUIRED", "Subscriber access required", 403);
  return a;
};
/** The member's own add-on state, offer price and pending purchase. */
export async function voiceAddOnStatus(db: Database, a: Actor) {
  subscriber(a);
  return db.tenant(a, async (tx) => {
    const [s] = await tx.query(
      "SELECT status,period_end,data FROM subscriptions WHERE user_id=$1",
      [a.userId],
    );
    const paid = subscriptionHasAccess(s);
    const [offer] = s?.data?.productId
      ? await tx.query(
          "SELECT id,data FROM records WHERE id=$1 AND kind='product'",
          [s.data.productId],
        )
      : [];
    const [pending] = await tx.query(
      "SELECT id,status,data FROM records WHERE kind='checkout' AND owner_user_id=$1 AND data->>'purpose'='voice_addon' AND status IN ('creating','open','unknown') ORDER BY created_at DESC LIMIT 1",
      [a.userId],
    );
    const v = s?.data?.voiceAddOn ?? null;
    const included = paid && voiceIncluded(s?.data);
    return {
      included,
      available:
        paid &&
        !included &&
        !!offer?.data?.voiceStripePriceId &&
        !!offer?.data?.voiceAddOnMinor,
      priceMinor: offer?.data?.voiceAddOnMinor ?? null,
      active: paid && voiceAddOnEntitled(v),
      status: v?.status ?? null,
      periodEnd: v?.periodEnd ?? null,
      cancelAtPeriodEnd: v?.cancelAtPeriodEnd === true,
      pending: pending
        ? {
            status: pending.status,
            url:
              pending.status === "open" &&
              Date.parse(pending.data.expiresAt) > Date.now()
                ? pending.data.checkoutUrl
                : null,
          }
        : null,
    };
  });
}

/** Adds the add-on through a subscription Checkout, or resumes one set to end. */
export async function addVoiceAddOn(
  db: Database,
  a: Member,
  options: { origin: string },
  stripe: () => StripeLike,
  commerce: () => StripeLike,
) {
  subscriber(a);
  // A new sale needs approved commerce; resolve it before any intent is
  // reserved, so a refused sale leaves nothing to reconcile.
  let client: StripeLike | undefined, refused: unknown;
  try {
    client = commerce();
  } catch (error) {
    refused = error;
  }
  const context: any = await db.tenant(a, async (tx) => {
    await lock(tx, a.tenantId, a.userId);
    const [s] = await tx.query(
      "SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE",
      [a.userId],
    );
    if (!subscriptionHasAccess(s))
      throw fail(
        "MEMBERSHIP_REQUIRED",
        "Premium voice is added to a current paid membership.",
      );
    if (voiceIncluded(s.data))
      throw fail("VOICE_INCLUDED", "Your membership already includes voice.");
    const v = s.data?.voiceAddOn;
    if (voiceAddOnEntitled(v)) {
      if (!v.cancelAtPeriodEnd)
        throw fail("VOICE_ACTIVE", "Premium voice is already on your membership.");
      return { resume: v };
    }
    if (v && !TERMINAL.has(v.status) && v.status !== "incomplete")
      throw fail(
        "VOICE_REVIEW",
        "Your voice add-on needs a billing review before another purchase.",
      );
    const [offer] = await tx.query(
      "SELECT id,data FROM records WHERE id=$1 AND kind='product'",
      [s.data?.productId ?? null],
    );
    if (!offer?.data?.voiceStripePriceId || !offer.data.voiceAddOnMinor)
      throw fail(
        "VOICE_UNAVAILABLE",
        "Your coach has not priced premium voice for this membership yet.",
      );
    const [old] = await tx.query(
      "SELECT * FROM records WHERE kind='checkout' AND owner_user_id=$1 AND data->>'purpose'='voice_addon' AND status IN ('creating','open','unknown') ORDER BY created_at LIMIT 1 FOR UPDATE",
      [a.userId],
    );
    if (old) {
      if (
        old.status === "open" &&
        old.data.checkoutUrl &&
        Date.parse(old.data.expiresAt) > Date.now()
      )
        return { existing: old };
      if (
        old.status === "creating" &&
        Date.now() - new Date(old.created_at).getTime() < 120000
      )
        throw fail(
          "CHECKOUT_PENDING",
          "Your voice add-on checkout is being prepared; try again shortly.",
        );
      return { reconcile: old };
    }
    if (refused) throw refused;
    const [user] = await tx.query("SELECT email FROM users WHERE id=$1", [
      a.userId,
    ]);
    const intent = await putRecord(
      tx,
      a,
      "checkout",
      {
        purpose: "voice_addon",
        productId: offer.id,
        priceId: offer.data.voiceStripePriceId,
        amountMinor: offer.data.voiceAddOnMinor,
        email: user?.email ?? a.email ?? null,
        membershipId: s.id,
        expiresAt: new Date(Date.now() + 35 * 60000).toISOString(),
      },
      { ownerId: a.userId, status: "creating" },
    );
    await event(tx, a, "voice_addon.reserved", intent.id, {
      productId: offer.id,
    });
    return { intent };
  });
  if (context.existing)
    return { url: context.existing.data.checkoutUrl, intentId: context.existing.id };
  if (context.resume) {
    const provider = stripe();
    const remote: any = await provider.subscriptions.update(
      context.resume.providerId,
      { cancel_at_period_end: false },
      {
        idempotencyKey: `voice-addon-resume:${context.resume.providerId}:${context.resume.lastStripeEventAt}`,
      },
    );
    if (remote.id !== context.resume.providerId || remote.cancel_at_period_end)
      throw fail(
        "VOICE_UNRESOLVED",
        "The provider has not confirmed that voice continues; check again shortly.",
      );
    await projectVoiceAddOn(db, a.tenantId, a.userId, remote, {
      eventId: `voice-addon-resume:${remote.id}`,
      eventTime: Math.floor(Date.now() / 1000),
      stripe: provider,
    });
    return { resumed: true };
  }
  if (context.reconcile) {
    const outcome = await reconcileVoiceCheckout(db, a, context.reconcile, stripe());
    if (outcome.status === "open") return { url: outcome.url, intentId: context.reconcile.id };
    throw fail(
      "CHECKOUT_RECONCILED",
      "Your earlier voice add-on checkout was checked; reload your membership to continue.",
    );
  }
  const intent = context.intent;
  try {
    if (!client) throw refused;
    const metadata = {
      tenant_id: a.tenantId,
      user_id: a.userId,
      intent_id: intent.id,
      product_id: intent.data.productId,
      purpose: "voice_addon",
    };
    const remote: any = await client!.checkout.sessions.create(
      {
        mode: "subscription",
        customer_email: intent.data.email ?? undefined,
        client_reference_id: intent.id,
        line_items: [{ price: intent.data.priceId, quantity: 1 }],
        expires_at: Math.floor(Date.parse(intent.data.expiresAt) / 1000),
        metadata,
        subscription_data: { metadata },
        success_url: options.origin + "/app/membership?voice=added",
        cancel_url: options.origin + "/app/membership",
      },
      { idempotencyKey: "voice-addon:" + intent.id },
    );
    if (
      remote.mode !== "subscription" ||
      remote.client_reference_id !== intent.id ||
      !remote.id ||
      !remote.url ||
      remote.status !== "open"
    )
      throw fail(
        "CHECKOUT_UNRESOLVED",
        "Provider did not return a confirmed open checkout; check again before retrying",
      );
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE records SET status='open',data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND status='creating'",
        [
          intent.id,
          JSON.stringify({
            providerId: remote.id,
            checkoutUrl: remote.url,
            providerStatus: "open",
          }),
        ],
      ),
    );
    return { url: remote.url, intentId: intent.id };
  } catch (error) {
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE records SET status='unknown',updated_at=now() WHERE id=$1 AND status='creating'",
        [intent.id],
      ),
    );
    throw error;
  }
}

/** Resolves an uncertain add-on checkout from provider evidence only. */
export async function reconcileVoiceCheckout(
  db: Database,
  a: Actor,
  r: any,
  stripe: StripeLike,
) {
  let remote: any;
  if (r.data.providerId)
    remote = await stripe.checkout.sessions.retrieve(r.data.providerId);
  else {
    const result = await stripe.checkout.sessions.list({
      limit: 100,
      created: {
        gte: Math.floor(new Date(r.created_at).getTime() / 1000) - 60,
      },
    });
    const matches = result.data.filter(
      (item: any) => item.client_reference_id === r.id,
    );
    if (matches.length > 1)
      throw fail(
        "CHECKOUT_DUPLICATE_PROVIDER",
        "Multiple provider checkouts match one add-on purchase; operator reconciliation is required",
      );
    remote = matches[0];
  }
  if (!remote)
    throw fail(
      "CHECKOUT_UNRESOLVED",
      "No provider outcome is confirmed; the original add-on purchase remains held",
    );
  if (
    remote.client_reference_id !== r.id ||
    remote.metadata?.user_id !== r.owner_user_id ||
    remote.metadata?.purpose !== "voice_addon"
  )
    throw fail(
      "CHECKOUT_IDENTITY_MISMATCH",
      "Provider checkout does not match the reserved add-on purchase",
    );
  if (remote.status === "complete" || remote.status === "expired") {
    await processVoiceAddOnEvent(
      db,
      {
        id: `reconcile-voice-checkout:${remote.id}:${remote.status}`,
        type:
          remote.status === "complete"
            ? "checkout.session.completed"
            : "checkout.session.expired",
        data: { object: remote },
      },
      { stripe },
    );
    const sid = idOf(remote.subscription);
    if (remote.status === "complete" && sid) {
      const subscription: any = await stripe.subscriptions.retrieve(sid);
      await projectVoiceAddOn(db, r.tenant_id, r.owner_user_id, subscription, {
        eventId: `reconcile-voice-subscription:${sid}`,
        eventTime: Math.floor(Date.now() / 1000),
        stripe,
      });
    }
    return { status: remote.status };
  }
  if (remote.status === "open" && remote.url) {
    await db.tenant(providerActor(r.tenant_id), (tx) =>
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
    return { status: "open", url: remote.url as string };
  }
  throw fail(
    "CHECKOUT_UNRESOLVED",
    "The add-on checkout outcome remains uncertain; it stays held",
  );
}

/** Stops the add-on at the end of its paid period (the member keeps voice until then). */
export async function removeVoiceAddOn(
  db: Database,
  a: Actor,
  stripe: () => StripeLike,
) {
  subscriber(a);
  const v = await db.tenant(a, async (tx) => {
    const [s] = await tx.query(
      "SELECT data FROM subscriptions WHERE user_id=$1",
      [a.userId],
    );
    const v = s?.data?.voiceAddOn;
    if (!v?.providerId || TERMINAL.has(v.status))
      throw fail("VOICE_NOT_ACTIVE", "There is no voice add-on to remove.", 404);
    await event(tx, a, "voice_addon.removal_requested", v.providerId);
    return v;
  });
  if (v.cancelAtPeriodEnd) return { ok: true, accessUntil: v.periodEnd };
  const client = stripe();
  // Setting the end-of-period flag is idempotent. The key follows the mirrored
  // provider state: a retry after an unknown outcome (nothing mirrored yet)
  // replays the same instruction, while a later change (after a resume) is a
  // new instruction with a new key.
  const remote: any = await client.subscriptions.update(
    v.providerId,
    { cancel_at_period_end: true },
    { idempotencyKey: `voice-addon-cancel:${v.providerId}:${v.lastStripeEventAt}` },
  );
  if (remote.id !== v.providerId || remote.cancel_at_period_end !== true)
    throw fail(
      "VOICE_UNRESOLVED",
      "The provider has not confirmed the change; check again shortly.",
    );
  await projectVoiceAddOn(db, a.tenantId, a.userId, remote, {
    eventId: `voice-addon-cancel:${remote.id}`,
    eventTime: Math.floor(Date.now() / 1000),
    stripe: client,
  });
  return { ok: true, accessUntil: v.periodEnd };
}

/**
 * The worker ends add-ons whose membership no longer has paid access (a
 * canceled membership, or an upfront programme that ended or was refunded).
 * Without configured provider access nothing is sent; entitlement already
 * requires paid access.
 */
export async function endOrphanedVoiceAddOns(
  db: Database,
  tenantId: string,
  actor: Actor,
  stripe?: StripeLike,
) {
  const rows = await db.tenant(actor, (tx) =>
    tx.query(
      "SELECT user_id,status,period_end,data FROM subscriptions WHERE data ? 'voiceAddOn' AND data->'voiceAddOn'->>'status' IN ('active','trialing','past_due','incomplete') LIMIT 100",
    ),
  );
  const orphaned = rows.filter((s) => !subscriptionHasAccess(s));
  if (!orphaned.length) return { ended: 0, pending: 0 };
  const client = stripe ?? optionalStripe();
  if (!client) return { ended: 0, pending: orphaned.length };
  let ended = 0;
  for (const s of orphaned) {
    const v = s.data.voiceAddOn;
    try {
      const remote: any = await client.subscriptions.cancel(v.providerId, undefined, {
        idempotencyKey: `voice-addon-end:${v.providerId}`,
      });
      if (remote.id !== v.providerId) continue;
      await projectVoiceAddOn(db, tenantId, s.user_id, remote, {
        eventId: `voice-addon-end:${remote.id}`,
        eventTime: Math.floor(Date.now() / 1000),
        stripe: client,
      });
      ended++;
    } catch {
      console.error("Voice add-on end could not be confirmed");
    }
  }
  return { ended, pending: orphaned.length - ended };
}

export function registerVoiceAddOn(
  app: FastifyInstance,
  db: Database,
  providers: { commerce: () => StripeLike; stripe: () => StripeLike },
) {
  const identity = (req: FastifyRequest) => {
    if (!req.identity)
      throw Object.assign(new Error("Please sign in"), { statusCode: 401 });
    return req.identity as Member;
  };
  const origin = (req: any) =>
    req.hostContext?.origin ?? process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
  app.get("/api/v1/membership/voice-addon", (req) =>
    voiceAddOnStatus(db, identity(req)),
  );
  app.post("/api/v1/membership/voice-addon", (req) =>
    addVoiceAddOn(
      db,
      identity(req),
      { origin: origin(req) },
      providers.stripe,
      providers.commerce,
    ),
  );
  app.post("/api/v1/membership/voice-addon/cancel", (req) =>
    removeVoiceAddOn(db, identity(req), providers.stripe),
  );
  app.post("/api/v1/membership/voice-addon/reconcile", async (req) => {
    const a = subscriber(identity(req));
    const [pending] = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT * FROM records WHERE kind='checkout' AND owner_user_id=$1 AND data->>'purpose'='voice_addon' AND status IN ('creating','open','unknown') ORDER BY created_at LIMIT 1",
        [a.userId],
      ),
    );
    if (!pending) return { status: "resolved" };
    return reconcileVoiceCheckout(db, a, pending, providers.stripe());
  });
}

