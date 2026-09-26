import type { FastifyInstance } from "fastify";
import {
  type Actor,
  type Database,
  type Tx,
  event,
  putRecord,
} from "@trainer/db";
import { requireCommerce, stripeClient } from "@trainer/providers";
import { z } from "zod";
import { checkoutOfferTerms } from "./finance-promotions.ts";
import { processStripeEvent } from "./stripe-events.ts";
const uuid = z.string().uuid();
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { statusCode: 409, code });
const terminalSubscription = (status: string) =>
  ["canceled", "incomplete_expired"].includes(status);
const inputSchema = z
  .object({
    productId: uuid,
    promotionCode: z.string().trim().max(40).optional(),
  })
  .strict();
type CheckoutActor = Actor & { email: string };
type CheckoutOptions = {
  origin: string;
  nutritionReady: (tx: Tx) => Promise<unknown>;
};
async function checkoutLock(tx: Tx, a: Actor) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":workspace",
  ]);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":checkout:" + a.userId,
  ]);
}
async function unresolvedCheckout(tx: Tx, a: Actor) {
  const [r] = await tx.query(
    "SELECT * FROM records WHERE kind='checkout' AND owner_user_id=$1 AND status NOT IN ('expired','closed') ORDER BY created_at,id LIMIT 1 FOR UPDATE",
    [a.userId],
  );
  return r;
}
/** Subscription state comes from Stripe evidence; elapsed local time cannot close a checkout. */
async function settleCheckoutSubscriptionScoped(
  tx: Tx,
  a: Actor,
  subscription: any,
) {
  const intentId = subscription.metadata?.intent_id;
  const rows = await tx.query(
    "SELECT * FROM records WHERE kind='checkout' AND owner_user_id=$1 AND (data->>'subscriptionId'=$2 OR id::text=$3) FOR UPDATE",
    [a.userId, subscription.id, intentId ?? ""],
  );
  for (const r of rows) {
    if (r.data.subscriptionId && r.data.subscriptionId !== subscription.id)
      throw fail(
        "CHECKOUT_SUBSCRIPTION_CONFLICT",
        "The checkout already belongs to another provider subscription",
      );
    const status = terminalSubscription(subscription.status)
      ? "closed"
      : "completed";
    if (r.status === "closed" && status !== "closed") continue;
    await tx.query(
      "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE id=$1",
      [
        r.id,
        status,
        JSON.stringify({
          subscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
        }),
      ],
    );
  }
}
export async function settleCheckoutSubscription(
  tx: Tx,
  a: Actor,
  subscription: any,
) {
  const [context] = await tx.query(
    "SELECT current_setting('app.role',true) AS role",
  );
  await tx.query("SELECT set_config('app.role','owner',true)");
  try {
    await settleCheckoutSubscriptionScoped(tx, a, subscription);
  } finally {
    await tx
      .query("SELECT set_config('app.role',$1,true)", [context.role])
      .catch(() => {});
  }
}
/** Entry is restricted to signed webhook payloads or authenticated provider reads. */
export async function processMembershipCheckoutEvent(db: Database, e: any) {
  if (
    ![
      "checkout.session.completed",
      "checkout.session.expired",
      "checkout.session.async_payment_succeeded",
    ].includes(e.type)
  )
    return false;
  const remote = e.data?.object;
  if (remote?.mode !== "subscription") return false;
  const intentId = remote.metadata?.intent_id ?? remote.client_reference_id;
  if (!uuid.safeParse(intentId).success)
    throw fail(
      "CHECKOUT_MAPPING_REQUIRED",
      "Subscription checkout has no recognized business intent",
    );
  const [r] = await db.system((tx) =>
    tx.query("SELECT * FROM records WHERE id=$1 AND kind='checkout'", [
      intentId,
    ]),
  );
  if (!r)
    throw fail(
      "CHECKOUT_MAPPING_REQUIRED",
      "Subscription checkout business intent is unavailable",
    );
  if (
    remote.client_reference_id !== r.id ||
    remote.metadata?.intent_id !== r.id ||
    remote.metadata?.tenant_id !== r.tenant_id ||
    remote.metadata?.user_id !== r.owner_user_id ||
    (r.data.providerId && r.data.providerId !== remote.id)
  )
    throw fail(
      "CHECKOUT_IDENTITY_MISMATCH",
      "Checkout identity does not match its original instruction",
    );
  const subscriptionId =
    typeof remote.subscription === "string"
      ? remote.subscription
      : remote.subscription?.id;
  if (e.type === "checkout.session.expired" && remote.status !== "expired")
    throw fail(
      "CHECKOUT_STATE_MISMATCH",
      "Provider has not confirmed checkout expiry",
    );
  if (
    e.type !== "checkout.session.expired" &&
    (remote.status !== "complete" || !subscriptionId)
  )
    throw fail(
      "CHECKOUT_STATE_MISMATCH",
      "Provider has not confirmed a completed subscription checkout",
    );
  const a = { tenantId: r.tenant_id, userId: r.owner_user_id, role: "owner" };
  await db.tenant(a, async (tx) => {
    await checkoutLock(tx, a);
    const [current] = await tx.query(
      "SELECT * FROM records WHERE id=$1 FOR UPDATE",
      [r.id],
    );
    if (current.data.providerId && current.data.providerId !== remote.id)
      throw fail(
        "CHECKOUT_IDENTITY_MISMATCH",
        "Provider checkout reference changed",
      );
    if (e.type === "checkout.session.expired") {
      if (["completed", "closed"].includes(current.status)) return;
      await tx.query(
        "UPDATE records SET status='expired',data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [
          r.id,
          JSON.stringify({
            providerId: remote.id,
            providerStatus: "expired",
            expiryEvidence: e.id,
          }),
        ],
      );
    } else {
      if (
        current.data.subscriptionId &&
        current.data.subscriptionId !== subscriptionId
      )
        throw fail(
          "CHECKOUT_SUBSCRIPTION_CONFLICT",
          "Provider subscription reference changed",
        );
      const [s] = await tx.query(
        "SELECT provider_id,status FROM subscriptions WHERE user_id=$1",
        [a.userId],
      );
      const status =
        current.status === "closed" ||
        (s?.provider_id === subscriptionId && terminalSubscription(s.status))
          ? "closed"
          : "completed";
      await tx.query(
        "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE id=$1",
        [
          r.id,
          status,
          JSON.stringify({
            providerId: remote.id,
            subscriptionId,
            providerStatus: "complete",
          }),
        ],
      );
    }
    await event(
      tx,
      a,
      e.type === "checkout.session.expired"
        ? "checkout.expired"
        : "checkout.completed",
      r.id,
      { providerEventId: e.id, providerId: remote.id },
    );
  });
  return true;
}
function assertCheckoutOwnership(remote: any, r: any) {
  if (
    remote.mode !== "subscription" ||
    remote.client_reference_id !== r.id ||
    remote.metadata?.intent_id !== r.id ||
    remote.metadata?.tenant_id !== r.tenant_id ||
    remote.metadata?.user_id !== r.owner_user_id ||
    (r.data.providerId && remote.id !== r.data.providerId)
  )
    throw fail(
      "CHECKOUT_IDENTITY_MISMATCH",
      "Provider checkout does not match the reserved instruction",
    );
}
async function reconcileIntent(
  db: Database,
  a: Actor,
  r: any,
  stripe: ReturnType<typeof stripeClient>,
) {
  let remote: any;
  if (r.data.providerId)
    remote = await stripe.checkout.sessions.retrieve(r.data.providerId);
  else {
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await stripe.checkout.sessions.list({
        limit: 100,
        created: {
          gte: Math.floor(new Date(r.created_at).getTime() / 1000) - 60,
        },
        ...(cursor ? { starting_after: cursor } : {}),
      });
      const matches = result.data.filter(
        (item) => item.client_reference_id === r.id,
      );
      if (matches.length > 1)
        throw fail(
          "CHECKOUT_DUPLICATE_PROVIDER",
          "Multiple provider checkouts match one intent; operator reconciliation is required",
        );
      if (matches.length) {
        remote = matches[0];
        break;
      }
      if (!result.has_more) break;
      cursor = result.data.at(-1)?.id;
      if (!cursor) break;
    }
  }
  if (!remote)
    throw fail(
      "CHECKOUT_UNRESOLVED",
      "No provider outcome is confirmed. The original checkout remains held; a new purchase has not been created",
    );
  assertCheckoutOwnership(remote, r);
  if (remote.status === "expired" || remote.status === "complete") {
    await processMembershipCheckoutEvent(db, {
      type:
        remote.status === "expired"
          ? "checkout.session.expired"
          : "checkout.session.completed",
      id: `reconcile-checkout:${remote.id}:${remote.status}`,
      data: { object: remote },
    });
    if (remote.status === "complete") {
      const sid =
        typeof remote.subscription === "string"
          ? remote.subscription
          : remote.subscription?.id;
      if (!sid)
        throw fail(
          "CHECKOUT_UNRESOLVED",
          "Completed checkout is awaiting its original subscription reference",
        );
      const subscription = await stripe.subscriptions.retrieve(sid);
      if (
        subscription.id !== sid ||
        (subscription.metadata?.tenant_id &&
          subscription.metadata.tenant_id !== a.tenantId) ||
        (subscription.metadata?.user_id &&
          subscription.metadata.user_id !== a.userId)
      )
        throw fail(
          "CHECKOUT_IDENTITY_MISMATCH",
          "Subscription identity conflicts with the completed checkout",
        );
      await processStripeEvent(db, {
        type: "customer.subscription.updated",
        id: `reconcile-checkout-subscription:${sid}:${Date.now()}`,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            ...subscription,
            metadata: {
              ...subscription.metadata,
              tenant_id: a.tenantId,
              user_id: a.userId,
              intent_id: r.id,
            },
          },
        },
      });
    }
  } else if (remote.status === "open") {
    if (!remote.url)
      throw fail(
        "CHECKOUT_UNRESOLVED",
        "Provider has not supplied an open checkout link",
      );
    await db.tenant({ ...a, role: "owner" }, async (tx) => {
      await checkoutLock(tx, a);
      await tx.query(
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
      );
    });
  } else
    throw fail(
      "CHECKOUT_UNRESOLVED",
      "Checkout outcome remains uncertain; another purchase is held",
    );
  return remote;
}
export async function reconcileMembershipCheckout(
  db: Database,
  a: Actor,
  stripe = stripeClient(),
) {
  const [r] = await db.tenant({ ...a, role: "owner" }, (tx) =>
    tx.query(
      "SELECT * FROM records WHERE kind='checkout' AND owner_user_id=$1 AND status NOT IN ('expired','closed') ORDER BY created_at,id LIMIT 1",
      [a.userId],
    ),
  );
  if (!r) return { status: "resolved" };
  const remote = await reconcileIntent(db, a, r, stripe);
  return {
    status: remote.status,
    url: remote.status === "open" ? remote.url : undefined,
  };
}
export async function createMembershipCheckout(
  db: Database,
  a: CheckoutActor,
  raw: unknown,
  options: CheckoutOptions,
  stripe = requireCommerce(),
) {
  if (a.role !== "subscriber")
    throw Object.assign(new Error("Subscriber access required"), {
      statusCode: 403,
      code: "SUBSCRIBER_REQUIRED",
    });
  const input = inputSchema.parse(raw),
    promotionCode = input.promotionCode?.trim().toUpperCase() ?? "";
  // A bounded loop can clear previously verified expired history without changing uncertain intents.
  for (let attempt = 0; attempt < 10; attempt++) {
    const context: any = await db.tenant(
      { ...a, role: "owner" },
      async (tx) => {
        await checkoutLock(tx, a);
        const [t] = await tx.query(
          "SELECT lifecycle_state FROM tenants WHERE id=$1",
          [a.tenantId],
        );
        if (t?.lifecycle_state !== "active")
          throw fail(
            "WORKSPACE_CLOSED",
            "This workspace no longer accepts purchases",
          );
        const [s] = await tx.query(
          "SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE",
          [a.userId],
        );
        if (s && !terminalSubscription(s.status))
          throw fail(
            "ALREADY_SUBSCRIBED",
            "Manage or reconcile the existing subscription before buying another membership",
          );
        const old = await unresolvedCheckout(tx, a);
        if (old) {
          const same =
            old.data.productId === input.productId &&
            (old.data.offerTerms?.promotionCode ?? "") === promotionCode;
          if (
            old.status === "open" &&
            old.data.checkoutUrl &&
            Date.parse(old.data.expiresAt) > Date.now()
          ) {
            if (!same)
              throw fail(
                "CHECKOUT_OPEN",
                "Finish the original checkout or wait for its provider-confirmed expiry before choosing another offer",
              );
            return { existing: true, ready: true, intent: old };
          }
          if (
            old.status === "creating" &&
            Date.now() - new Date(old.created_at).getTime() < 120000
          )
            throw fail(
              "CHECKOUT_PENDING",
              "Your original checkout is being prepared; its provider outcome must be confirmed before another request",
            );
          return { existing: true, ready: false, intent: old, same };
        }
        const [product] = await tx.query(
          "SELECT * FROM records WHERE id=$1 AND kind='product' AND status='published'",
          [input.productId],
        );
        if (!product?.data.stripePriceId)
          throw fail("PRODUCT_UNAVAILABLE", "This offer is unavailable");
        if (product.data.tier === "workout_nutrition")
          await options.nutritionReady(tx);
        const offerTerms = await checkoutOfferTerms(
          tx,
          a,
          product,
          input.promotionCode,
        );
        const intent = await putRecord(
          tx,
          a,
          "checkout",
          {
            productId: product.id,
            offerTerms,
            priceId: product.data.stripePriceId,
            email: a.email,
            expiresAt: new Date(Date.now() + 35 * 60000).toISOString(),
          },
          { ownerId: a.userId, status: "creating" },
        );
        await event(tx, a, "checkout.reserved", intent.id, {
          productId: product.id,
        });
        return { existing: false, intent };
      },
    );
    if (context.existing) {
      if (context.ready)
        return {
          url: context.intent.data.checkoutUrl,
          intentId: context.intent.id,
        };
      const remote = await reconcileIntent(db, a, context.intent, stripe);
      if (remote.status === "open") {
        if (!context.same)
          throw fail(
            "CHECKOUT_OPEN",
            "The original checkout is still open; finish it or wait for provider-confirmed expiry before choosing another offer",
          );
        return { url: remote.url, intentId: context.intent.id };
      }
      continue;
    }
    const intent = context.intent;
    try {
      const metadata = {
        tenant_id: a.tenantId,
        user_id: a.userId,
        intent_id: intent.id,
        product_id: intent.data.productId,
      };
      const remote = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer_email: intent.data.email,
          client_reference_id: intent.id,
          line_items: [{ price: intent.data.priceId, quantity: 1 }],
          expires_at: Math.floor(Date.parse(intent.data.expiresAt) / 1000),
          metadata,
          discounts: intent.data.offerTerms?.couponId
            ? [{ coupon: intent.data.offerTerms.couponId }]
            : undefined,
          subscription_data: {
            trial_period_days: intent.data.offerTerms?.trialDays || undefined,
            metadata,
          },
          success_url: options.origin + "/app/membership?checkout=complete",
          cancel_url: options.origin + "/app/membership",
        },
        { idempotencyKey: "checkout:" + intent.id },
      );
      assertCheckoutOwnership(remote, intent);
      if (!remote.id || !remote.url || remote.status !== "open")
        throw fail(
          "CHECKOUT_UNRESOLVED",
          "Provider did not return a confirmed open checkout; reconcile the existing instruction",
        );
      const [saved] = await db.tenant({ ...a, role: "owner" }, async (tx) => {
        await checkoutLock(tx, a);
        return tx.query(
          "UPDATE records SET status='open',data=data||$2::jsonb,updated_at=now() WHERE id=$1 AND status='creating' RETURNING id",
          [
            intent.id,
            JSON.stringify({
              providerId: remote.id,
              checkoutUrl: remote.url,
              providerStatus: "open",
            }),
          ],
        );
      });
      if (!saved)
        throw fail(
          "CHECKOUT_CHANGED",
          "Checkout state changed while the provider replied; reconcile the original instruction",
        );
      return { url: remote.url, intentId: intent.id };
    } catch (error) {
      await db.tenant({ ...a, role: "owner" }, (tx) =>
        tx.query(
          "UPDATE records SET status='unknown',updated_at=now() WHERE id=$1 AND status='creating'",
          [intent.id],
        ),
      );
      throw error;
    }
  }
  throw fail(
    "CHECKOUT_HISTORY_REVIEW",
    "Earlier checkout history was reconciled; retry to continue after the remaining provider evidence is checked",
  );
}
export function registerSubscriptionCheckout(
  app: FastifyInstance,
  db: Database,
  nutritionReady: (tx: Tx) => Promise<unknown>,
) {
  const identity = (req: any) => {
    if (!req.identity)
      throw Object.assign(new Error("Please sign in"), { statusCode: 401 });
    return req.identity as CheckoutActor;
  };
  app.post("/api/v1/payments/checkout", (req) =>
    createMembershipCheckout(db, identity(req), req.body, {
      origin:
        req.hostContext?.origin ??
        process.env.PUBLIC_APP_URL ??
        "http://localhost:3000",
      nutritionReady,
    }),
  );
  app.post("/api/v1/payments/checkout/reconcile", (req) =>
    reconcileMembershipCheckout(db, identity(req)),
  );
}
