import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  type Actor,
  type Database,
  type Tx,
  putRecord,
  event,
} from "@trainer/db";
import { stripeClient, stripeRefused } from "@trainer/providers";
import {
  assertOfferPrice,
  hasPaidTraining,
  modulePassActive,
} from "@trainer/contracts";
import { z } from "zod";
import { requireNutritionReady } from "./nutrition.ts";
import { requireServiceReady } from "./service-readiness.ts";
import { processStripeEvent } from "./stripe-events.ts";
import { instructionSettled, refusalOf } from "./stripe-outcomes.ts";

type Stripe = ReturnType<typeof stripeClient>;
const fail = (code: string, message: string, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });
const ref = (v: any): string | undefined => (typeof v === "string" ? v : v?.id);
const voice = (d: any) =>
  d?.premiumVoice === true || d?.modules?.includes("voice");
const modules = (d: any): string[] => [
  ...new Set([...(d?.modules ?? ["training"]), ...(voice(d) ? ["voice"] : [])]),
];
const pendingSql =
  "SELECT * FROM records WHERE kind='subscription_transition' AND owner_user_id=$1 AND status IN ('submitting','unknown') ORDER BY created_at DESC LIMIT 1";
const lock = (tx: Tx, a: Actor) =>
  tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
const subscriber = (a: Actor) => {
  if (a.role !== "subscriber")
    throw fail("SUBSCRIBER_REQUIRED", "Subscriber access required", 403);
};
async function purchaseContext<T>(
  db: Database,
  a: Actor,
  fn: (tx: Tx) => Promise<T>,
) {
  return db.system(async (system) => {
    await system.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      a.tenantId + ":workspace",
    ]);
    await lock(system, a);
    const [tenant] = await system.query(
      "SELECT lifecycle_state FROM tenants WHERE id=$1",
      [a.tenantId],
    );
    if (tenant?.lifecycle_state !== "active")
      throw fail(
        "WORKSPACE_CLOSED",
        "This workspace no longer accepts purchases.",
      );
    const [membership] = await system.query(
      "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [a.tenantId, a.userId],
    );
    if (membership?.role !== "subscriber")
      throw fail(
        "SUBSCRIBER_REQUIRED",
        "Current subscriber access required.",
        403,
      );
    return system.tenant(a, fn);
  });
}

/** Upgrade only: preserve included capabilities, term and existing paid access. */
export function upgradeReason(
  s: any,
  offer: any,
  now = Date.now(),
): string | null {
  if (
    !hasPaidTraining(s) ||
    s.status !== "active" ||
    !s.provider_id ||
    s.data?.billing === "upfront"
  )
    return "A monthly paid membership is needed to change packages. Prepaid members can add a one-month module pass below.";
  if (
    s.cancel_at_period_end ||
    !s.period_end ||
    Date.parse(s.period_end) <= now
  )
    return "Turn renewal back on before upgrading.";
  if (
    offer?.status !== "published" ||
    !offer.data?.stripePriceId ||
    !offer.data?.stripeProductId ||
    offer.data.billing === "upfront"
  )
    return "This package is not available for a monthly upgrade.";
  if (
    offer.id === s.data?.productId ||
    !Number.isSafeInteger(Number(s.price_minor)) ||
    Number(s.price_minor) <= 0 ||
    offer.data.priceMinor <= Number(s.price_minor)
  )
    return "Choose a higher package to upgrade.";
  try {
    assertOfferPrice(offer.data);
  } catch {
    return "This package’s price needs to be updated by your coach.";
  }
  const before = modules(s.data),
    after = modules(offer.data);
  if (
    before.some((m) => !after.includes(m)) ||
    !after.some((m) => !before.includes(m))
  )
    return "An upgrade must add features and keep everything already included.";
  if ((s.data?.programmeDays ?? null) !== (offer.data?.programmeDays ?? null))
    return "This package uses a different programme length. Ask your coach to arrange the change.";
  if (
    after.includes("voice") &&
    !before.includes("voice") &&
    s.data?.voiceAddOn &&
    !["canceled", "incomplete_expired"].includes(s.data.voiceAddOn.status)
  )
    return "Your separate voice subscription must end before moving to a package that includes voice.";
  for (const m of ["nutrition", "voice"])
    if (
      after.includes(m) &&
      !before.includes(m) &&
      modulePassActive(s.data?.modulePasses?.[m], now)
    )
      return "Your active module pass must end before moving to a package that includes the same feature.";
  return null;
}
async function eligible(tx: Tx, a: Actor, productId: string) {
  const [s] = await tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [
    a.userId,
  ]);
  const [offer] = await tx.query(
    "SELECT id,status,version,data FROM records WHERE id=$1 AND kind='product'",
    [productId],
  );
  const reason = upgradeReason(s, offer);
  if (reason) throw fail("UPGRADE_NOT_AVAILABLE", reason);
  const [purchase] = await tx.query(
    "SELECT id FROM records WHERE kind='checkout' AND owner_user_id=$1 AND (status IN ('creating','open','unknown') OR (status='completed' AND data->>'purpose'='voice_addon' AND NOT data ? 'subscriptionStatus')) LIMIT 1",
    [a.userId],
  );
  if (purchase)
    throw fail(
      "PURCHASE_PENDING",
      "Check your existing checkout before upgrading.",
    );
  await requireServiceReady(tx, offer.data);
  if (offer.data.modules?.includes("nutrition"))
    await requireNutritionReady(tx);
  return { s, offer };
}
function remoteItem(remote: any, s: any) {
  if (
    remote.id !== s.provider_id ||
    remote.status !== "active" ||
    remote.cancel_at_period_end ||
    remote.cancel_at ||
    remote.pause_collection ||
    remote.pending_update ||
    remote.schedule ||
    remote.collection_method !== "charge_automatically" ||
    remote.items?.data?.length !== 1 ||
    !ref(remote.customer)
  )
    throw fail(
      "SUBSCRIPTION_CHANGED",
      "Your billing needs to finish its current change before upgrading.",
    );
  const item = remote.items.data[0];
  if (
    ref(item.price) !== s.data?.priceId ||
    item.quantity !== 1 ||
    item.price?.currency !== "aed" ||
    item.price?.recurring?.interval !== "month" ||
    item.price?.recurring?.interval_count !== 1 ||
    item.price?.recurring?.usage_type === "metered"
  )
    throw fail(
      "SUBSCRIPTION_CHANGED",
      "Reload your membership before reviewing an upgrade.",
    );
  if (
    remote.latest_invoice &&
    (typeof remote.latest_invoice !== "object" ||
      remote.latest_invoice.status !== "paid")
  )
    throw fail(
      "INVOICE_PENDING",
      "Settle your current invoice before upgrading.",
    );
  return item;
}
async function preview(stripe: Stripe, s: any, offer: any, at: number) {
  const remote: any = await stripe.subscriptions.retrieve(s.provider_id, {
    expand: ["latest_invoice"],
  });
  if (
    (remote.metadata?.tenant_id && remote.metadata.tenant_id !== s.tenant_id) ||
    (remote.metadata?.user_id && remote.metadata.user_id !== s.user_id)
  )
    throw fail(
      "SUBSCRIPTION_CHANGED",
      "The billing account could not be verified.",
    );
  const item = remoteItem(remote, s);
  const price: any = await stripe.prices.retrieve(offer.data.stripePriceId);
  if (
    !price.active ||
    price.unit_amount !== offer.data.priceMinor ||
    price.currency !== "aed" ||
    ref(price.product) !== offer.data.stripeProductId ||
    price.recurring?.interval !== "month" ||
    price.recurring?.interval_count !== 1 ||
    price.recurring?.usage_type !== "licensed"
  )
    throw fail(
      "PRICE_CHANGED",
      "Your coach’s published price needs to be checked before upgrading.",
    );
  const invoice: any = await stripe.invoices.createPreview({
    customer: ref(remote.customer),
    subscription: remote.id,
    subscription_details: {
      items: [{ id: item.id, price: price.id, quantity: 1 }],
      proration_date: at,
      proration_behavior: "always_invoice",
    },
  });
  if (
    invoice.currency !== "aed" ||
    !Number.isSafeInteger(invoice.amount_due) ||
    invoice.amount_due < 0
  )
    throw fail(
      "QUOTE_UNAVAILABLE",
      "An exact upgrade amount is not available. Please try again later.",
    );
  return {
    itemId: item.id,
    customerId: ref(remote.customer),
    amountMinor: invoice.amount_due,
  };
}
const publicQuote = (r: any) => ({
  id: r.id,
  status: r.status,
  name: r.data.name,
  amountMinor: r.data.amountMinor,
  monthlyPriceMinor: r.data.monthlyPriceMinor,
  expiresAt: r.data.expiresAt,
  renewalAt: r.data.renewalAt,
  modules: r.data.modules,
});
const publicPending = (r: any) =>
  r && {
    id: r.id,
    status: r.status,
    name: r.data.name,
    url: r.data.invoiceUrl ?? null,
  };
export async function upgradeOptions(db: Database, a: Actor) {
  subscriber(a);
  return db.tenant(a, async (tx) => {
    const [s] = await tx.query("SELECT * FROM subscriptions WHERE user_id=$1", [
      a.userId,
    ]);
    const offers = await tx.query(
      "SELECT id,status,data FROM records WHERE kind='product' AND status='published' ORDER BY created_at",
    );
    const [pending] = await tx.query(pendingSql, [a.userId]);
    return {
      pending:
        pending?.data?.purpose === "upgrade" ? publicPending(pending) : null,
      blocked: !!pending,
      offers: offers
        .filter(
          (o) =>
            o.id !== s?.data?.productId &&
            o.data.priceMinor > Number(s?.price_minor ?? 0),
        )
        .map((o) => ({
          id: o.id,
          name: o.data.name,
          priceMinor: o.data.priceMinor,
          modules: modules(o.data),
          reason: upgradeReason(s, o),
        })),
      prepaid: s?.data?.billing === "upfront",
    };
  });
}
export async function quoteUpgrade(
  db: Database,
  a: Actor,
  productId: string,
  stripe: Stripe,
) {
  subscriber(a);
  const context = await purchaseContext(db, a, async (tx) => {
    const [pending] = await tx.query(pendingSql, [a.userId]);
    if (pending)
      throw fail(
        "UPGRADE_PENDING",
        "Check the pending membership change before starting another.",
      );
    return eligible(tx, a, productId);
  });
  const at = Math.floor(Date.now() / 1000);
  const quote = await preview(stripe, context.s, context.offer, at);
  const r = await purchaseContext(db, a, async (tx) => {
    await lock(tx, a);
    const current = await eligible(tx, a, productId);
    if (
      current.s.data.priceId !== context.s.data.priceId ||
      current.offer.version !== context.offer.version
    )
      throw fail("PRICE_CHANGED", "Your plan changed. Review a fresh quote.");
    return putRecord(
      tx,
      a,
      "subscription_transition",
      {
        purpose: "upgrade",
        subscriptionId: current.s.id,
        providerId: current.s.provider_id,
        fromPriceId: current.s.data.priceId,
        productId,
        targetPriceId: current.offer.data.stripePriceId,
        offerVersion: current.offer.version,
        name: current.offer.data.name,
        monthlyPriceMinor: current.offer.data.priceMinor,
        modules: modules(current.offer.data),
        renewalAt: current.s.period_end,
        prorationDate: at,
        expiresAt: new Date((at + 300) * 1000).toISOString(),
        ...quote,
      },
      { ownerId: a.userId, status: "confirmed" },
    ); // A confirmed quote is not a payment instruction.
  });
  return publicQuote(r);
}
async function applyUpgradeEvidence(
  db: Database,
  a: Actor,
  intent: any,
  remote: any,
  stripe: Stripe,
) {
  if (
    remote.id !== intent.data.providerId ||
    ref(remote.customer) !== intent.data.customerId ||
    (remote.metadata?.tenant_id && remote.metadata.tenant_id !== a.tenantId) ||
    (remote.metadata?.user_id && remote.metadata.user_id !== a.userId)
  )
    throw fail(
      "UPGRADE_UNRESOLVED",
      "The payment account could not be verified.",
    );
  let invoice: any = remote.latest_invoice;
  if (typeof invoice === "string")
    invoice = await stripe.invoices.retrieve(invoice);
  const item = remote.items?.data?.find(
    (i: any) => i.id === intent.data.itemId,
  );
  const applied =
    !remote.pending_update &&
    ref(item?.price) === intent.data.targetPriceId &&
    remote.status === "active" &&
    invoice?.status === "paid" &&
    invoice.currency === "aed" &&
    invoice.amount_due === intent.data.amountMinor &&
    ref(invoice.customer) === intent.data.customerId &&
    ref(
      invoice.parent?.subscription_details?.subscription ??
        invoice.subscription,
    ) === intent.data.providerId &&
    invoice.billing_reason === "subscription_update";
  const pendingTarget = remote.pending_update?.subscription_items?.some(
    (i: any) => ref(i.price) === intent.data.targetPriceId,
  );
  const failed =
    !applied &&
    !remote.pending_update &&
    ref(item?.price) === intent.data.fromPriceId &&
    instructionSettled({
      created_at: intent.data.submittedAt ?? intent.created_at,
    }) &&
    (!intent.data.invoiceId ||
      (invoice?.id === intent.data.invoiceId && invoice.status === "void"));
  let invoiceUrl: string | null = null;
  if (pendingTarget && invoice?.hosted_invoice_url) {
    try {
      const u = new URL(invoice.hosted_invoice_url);
      if (u.protocol === "https:" && u.hostname === "invoice.stripe.com")
        invoiceUrl = u.href;
    } catch {}
  }
  if (applied)
    await processStripeEvent(
      db,
      {
        id: `upgrade-confirmed:${intent.id}:${invoice.id}`,
        type: "customer.subscription.updated",
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            ...remote,
            object: "subscription",
            metadata: {
              ...remote.metadata,
              tenant_id: a.tenantId,
              user_id: a.userId,
            },
          },
        },
      },
      { stripe },
    );
  await db.tenant(a, async (tx) => {
    await lock(tx, a);
    await tx.query(
      "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE id=$1 AND kind='subscription_transition' AND owner_user_id=$4 AND status IN ('submitting','unknown')",
      [
        intent.id,
        applied ? "succeeded" : failed ? "failed" : "unknown",
        JSON.stringify({
          invoiceId:
            pendingTarget || applied ? invoice?.id : intent.data.invoiceId,
          invoiceUrl,
        }),
        a.userId,
      ],
    );
    if (applied)
      await event(tx, a, "subscription.upgrade_confirmed", intent.id, {
        productId: intent.data.productId,
      });
  });
  return {
    status: applied ? "succeeded" : failed ? "failed" : "pending",
    url: invoiceUrl,
  };
}
export async function confirmUpgrade(
  db: Database,
  a: Actor,
  quoteId: string,
  stripe: Stripe,
) {
  subscriber(a);
  const r: any = await purchaseContext(db, a, async (tx) => {
    await lock(tx, a);
    const [r] = await tx.query(
      "SELECT * FROM records WHERE id=$1 AND kind='subscription_transition' AND owner_user_id=$2 AND data->>'purpose'='upgrade' FOR UPDATE",
      [quoteId, a.userId],
    );
    if (!r)
      throw fail(
        "QUOTE_NOT_FOUND",
        "This upgrade quote is not available.",
        404,
      );
    if (r.status === "succeeded") return { ...r, done: true };
    if (r.status !== "confirmed")
      throw fail(
        "UPGRADE_PENDING",
        "Check this upgrade’s status before trying again.",
      );
    if (Date.parse(r.data.expiresAt) <= Date.now())
      throw fail(
        "QUOTE_EXPIRED",
        "This quote expired. Review a fresh amount before paying.",
      );
    const [pending] = await tx.query(pendingSql, [a.userId]);
    if (pending)
      throw fail(
        "UPGRADE_PENDING",
        "Check the pending membership change before starting another.",
      );
    const { s, offer } = await eligible(tx, a, r.data.productId);
    if (
      s.provider_id !== r.data.providerId ||
      s.data.priceId !== r.data.fromPriceId ||
      offer.version !== r.data.offerVersion
    )
      throw fail(
        "PRICE_CHANGED",
        "Your package changed. Review a fresh quote.",
      );
    const checked = await preview(stripe, s, offer, r.data.prorationDate);
    if (
      checked.amountMinor !== r.data.amountMinor ||
      checked.itemId !== r.data.itemId ||
      checked.customerId !== r.data.customerId
    )
      throw fail(
        "PRICE_CHANGED",
        "The amount due changed. Review a fresh quote before paying.",
      );
    const submittedAt = new Date().toISOString();
    await tx.query(
      "UPDATE records SET status='submitting',data=data||$2::jsonb,updated_at=now() WHERE id=$1",
      [r.id, JSON.stringify({ submittedAt })],
    );
    await event(tx, a, "subscription.upgrade_requested", r.id, {
      productId: r.data.productId,
      amountMinor: r.data.amountMinor,
    });
    return { ...r, data: { ...r.data, submittedAt }, done: false };
  });
  if (r.done) return { status: "succeeded", url: null };
  let remote;
  try {
    remote = await stripe.subscriptions.update(
      r.data.providerId,
      {
        items: [
          { id: r.data.itemId, price: r.data.targetPriceId, quantity: 1 },
        ],
        payment_behavior: "pending_if_incomplete",
        proration_behavior: "always_invoice",
        proration_date: r.data.prorationDate,
        expand: ["latest_invoice"],
      },
      { idempotencyKey: `upgrade:${r.id}` },
    );
  } catch (error) {
    const refused = stripeRefused(error);
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE records SET status=$2,data=data||$3::jsonb,updated_at=now() WHERE id=$1 AND status='submitting'",
        [
          r.id,
          refused ? "failed" : "unknown",
          JSON.stringify(refused ? { providerRefusal: refusalOf(error) } : {}),
        ],
      ),
    );
    throw fail(
      refused ? "UPGRADE_REFUSED" : "UPGRADE_PENDING",
      refused
        ? "The payment provider refused this change. Your package has not changed; review your payment method before trying again."
        : "The upgrade result needs checking. Check status before trying another payment.",
    );
  }
  try {
    return await applyUpgradeEvidence(db, a, r, remote, stripe);
  } catch {
    // A read/projection failure after dispatch cannot prove the paid change failed.
    await db.tenant(a, (tx) =>
      tx.query(
        "UPDATE records SET status='unknown',updated_at=now() WHERE id=$1 AND status='submitting'",
        [r.id],
      ),
    );
    throw fail(
      "UPGRADE_PENDING",
      "The upgrade result needs checking. Check status before trying another payment.",
    );
  }
}
/** Read provider evidence only; unknown outcomes never resend a paid instruction. */
export async function reconcileUpgrade(db: Database, a: Actor, stripe: Stripe) {
  const [r] = await db.tenant(a, (tx) => tx.query(pendingSql, [a.userId]));
  if (!r || r.data.purpose !== "upgrade") return { status: "resolved" };
  const remote = await stripe.subscriptions.retrieve(r.data.providerId, {
    expand: ["latest_invoice"],
  });
  return applyUpgradeEvidence(db, a, r, remote, stripe);
}
export function registerMembershipUpgrades(
  app: FastifyInstance,
  db: Database,
  providers: { commerce: () => Stripe; stripe: () => Stripe },
) {
  const actor = (req: FastifyRequest) => {
    if (!req.identity) throw fail("SIGN_IN_REQUIRED", "Please sign in", 401);
    subscriber(req.identity);
    return req.identity;
  };
  app.get("/api/v1/membership/upgrades", (req) =>
    upgradeOptions(db, actor(req)),
  );
  app.post("/api/v1/membership/change-plan", (req) => {
    const a = actor(req);
    const b = z
      .object({ productId: z.string().uuid() })
      .strict()
      .parse(req.body);
    return quoteUpgrade(db, a, b.productId, providers.commerce());
  });
  app.post("/api/v1/membership/upgrades/confirm", (req) => {
    const a = actor(req);
    const b = z.object({ quoteId: z.string().uuid() }).strict().parse(req.body);
    return confirmUpgrade(db, a, b.quoteId, providers.commerce());
  });
  app.post("/api/v1/membership/upgrades/reconcile", (req) =>
    reconcileUpgrade(db, actor(req), providers.stripe()),
  );
}
