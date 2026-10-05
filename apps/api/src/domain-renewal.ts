import type { Actor, Database } from "@trainer/db";
import { event } from "@trainer/db";
import type { WebAddressStripe } from "./web-address-orders.ts";

/** A committed intent survives a lost provider response or process restart.
 * The order worker's lease serializes every attempt, using the same Stripe key.
 * No opposite intent is accepted until this one is confirmed. */
export async function applyDomainRenewal(
  db: Database,
  actor: Actor,
  order: Record<string, any>,
  stripe: WebAddressStripe,
) {
  const intent = order.evidence?.renewalIntent;
  if (!intent) return true;
  try {
    const before = await stripe.subscriptions.retrieve(
      order.stripe_subscription_id,
    );
    const alreadyEnded = ["canceled", "incomplete_expired"].includes(
      before?.status,
    );
    let priceChange = {};
    if (intent.amountMinor && !alreadyEnded) {
      const item = before.items?.data?.[0];
      if (
        before.items?.data?.length !== 1 ||
        item?.price?.recurring?.interval !== "year" ||
        (item.price.recurring.interval_count ?? 1) !== 1 ||
        item.quantity !== 1 ||
        item.price.currency !== intent.currency.toLowerCase()
      )
        throw new Error("Unexpected domain billing structure");
      priceChange = {
        proration_behavior: "none",
        items: [
          {
            id: item.id,
            quantity: 1,
            price_data: {
              currency: intent.currency.toLowerCase(),
              unit_amount: intent.amountMinor,
              product:
                typeof item.price.product === "string"
                  ? item.price.product
                  : item.price.product.id,
              recurring: { interval: "year" },
            },
          },
        ],
      };
    }
    if (!alreadyEnded)
      await stripe.subscriptions.update(
        order.stripe_subscription_id,
        { cancel_at_period_end: !intent.enabled, ...priceChange },
        { idempotencyKey: `web-address-renewal:${order.id}:${intent.id}` },
      );
    const current = alreadyEnded
      ? before
      : await stripe.subscriptions.retrieve(order.stripe_subscription_id);
    const ended = ["canceled", "incomplete_expired"].includes(current.status);
    const enabled =
      !ended && !current.cancel_at_period_end && !current.cancel_at;
    if (enabled !== intent.enabled && !ended)
      throw new Error("Renewal not confirmed");
    if (
      intent.amountMinor &&
      !ended &&
      current.items?.data?.[0]?.price?.unit_amount !== intent.amountMinor
    )
      throw new Error("Price not confirmed");
    await db.tenant(actor, async (tx) => {
      const [saved] = await tx.query(
        "UPDATE domain_orders SET renewal_enabled=$2,billing_status=$3,notices='{}'::jsonb,evidence=(evidence-'renewalIntent')||jsonb_build_object('renewalSwitchedAt',$4::bigint),version=version+1,updated_at=now() WHERE id=$1 AND evidence->'renewalIntent'->>'id'=$5 RETURNING id",
        [
          order.id,
          enabled,
          current.status,
          Math.floor(Date.now() / 1000),
          intent.id,
        ],
      );
      if (saved && intent.amountMinor && !ended)
        await tx.query(
          "UPDATE domain_orders SET evidence=evidence||$2::jsonb WHERE id=$1",
          [
            order.id,
            JSON.stringify({
              agreedRenewalPriceMinor: intent.amountMinor,
              renewalOffer: {
                ...order.evidence.renewalOffer,
                state: "accepted",
                acceptedAt: intent.requestedAt,
              },
            }),
          ],
        );
      if (saved)
        await event(
          tx,
          actor,
          enabled ? "web_address.renewal_on" : "web_address.renewal_off",
          order.id,
        );
    });
    return true;
  } catch {
    await db.tenant(actor, (tx) =>
      tx.query(
        "UPDATE domain_orders SET next_attempt_at=now()+interval '1 minute',attention=coalesce(attention,CASE WHEN (evidence->'renewalIntent'->>'requestedAt')::timestamptz<now()-interval '10 minutes' THEN 'A renewal setting could not be confirmed with Stripe. Check billing connectivity and reconcile the pending intent.' END) WHERE id=$1 AND evidence->'renewalIntent'->>'id'=$2",
        [order.id, intent.id],
      ),
    );
    return false;
  }
}
