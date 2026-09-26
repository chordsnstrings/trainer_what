import type { Actor, Database, Tx } from "@trainer/db";
import { event, putRecord } from "@trainer/db";
import { requireCommerce, stripeClient } from "@trainer/providers";
import { z } from "zod";
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { statusCode: 409, code });
export const promotionSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/)
      .transform((x) => x.toUpperCase()),
    productId: z.string().uuid(),
    percentOff: z.number().int().min(1).max(100),
    maxRedemptions: z.number().int().min(1).max(100000),
    expiresAt: z.string().datetime(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export async function createPromotion(
  db: Database,
  a: Actor,
  raw: unknown,
  stripe = requireCommerce(),
) {
  const input = promotionSchema.parse(raw);
  if (Date.parse(input.expiresAt) <= Date.now())
    throw fail("PROMOTION_EXPIRED", "Choose a future expiry for this offer");
  const intent = await db.tenant(a, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [a.tenantId]);
    const [existing] = await tx.query(
      "SELECT * FROM records WHERE kind='promotion' AND data->>'code'=$1",
      [input.code],
    );
    if (existing)
      throw fail(
        "PROMOTION_EXISTS",
        "This code already has a provider instruction; inspect or reconcile it",
      );
    const [product] = await tx.query(
      "SELECT * FROM records WHERE id=$1 AND kind='product' AND status='published'",
      [input.productId],
    );
    if (!product?.data.stripeProductId)
      throw fail(
        "PRODUCT_REQUIRED",
        "Publish this offer to Stripe before adding a promotion",
      );
    return putRecord(
      tx,
      a,
      "promotion",
      { ...input, stripeProductId: product.data.stripeProductId },
      { status: "creating" },
    );
  });
  try {
    const coupon = await stripe.coupons.create(
      {
        id: "trainer_" + intent.id,
        name: input.code,
        percent_off: input.percentOff,
        duration: "once",
        applies_to: { products: [intent.data.stripeProductId] },
        max_redemptions: input.maxRedemptions,
        redeem_by: Math.floor(Date.parse(input.expiresAt) / 1000),
        metadata: { tenant_id: a.tenantId, promotion_id: intent.id },
      },
      { idempotencyKey: "promotion:" + intent.id },
    );
    await db.tenant(a, async (tx) => {
      await tx.query(
        "UPDATE records SET status='published',data=data||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND status IN ('creating','unknown')",
        [intent.id, JSON.stringify({ couponId: coupon.id })],
      );
      await event(tx, a, "finance.promotion_published", intent.id, {
        code: input.code,
      });
    });
    return { id: intent.id, status: "published" };
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
export async function reconcilePromotion(
  db: Database,
  a: Actor,
  id: string,
  stripe = stripeClient(),
) {
  const [r] = await db.tenant(a, (tx) =>
    tx.query("SELECT * FROM records WHERE kind='promotion' AND id=$1", [
      z.string().uuid().parse(id),
    ]),
  );
  if (!r) throw fail("PROMOTION_REQUIRED", "Promotion unavailable");
  if (!["creating", "unknown"].includes(r.status)) return r;
  const coupon = await stripe.coupons.retrieve("trainer_" + r.id);
  if (
    coupon.metadata?.tenant_id !== a.tenantId ||
    coupon.metadata?.promotion_id !== r.id ||
    coupon.percent_off !== r.data.percentOff ||
    coupon.duration !== "once" ||
    !coupon.applies_to?.products.includes(r.data.stripeProductId)
  )
    throw fail(
      "PROMOTION_MISMATCH",
      "Provider coupon does not match the original instruction",
    );
  return db.tenant(a, async (tx) => {
    const [updated] = await tx.query(
      "UPDATE records SET status='published',data=data||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1 AND status IN ('creating','unknown') RETURNING *",
      [r.id, JSON.stringify({ couponId: coupon.id })],
    );
    await event(tx, a, "finance.promotion_reconciled", r.id);
    return updated ?? r;
  });
}
/** Persist these terms on the checkout intent; never recompute a retry against changed offers. */
export async function checkoutOfferTerms(
  tx: Tx,
  a: Actor,
  product: any,
  code?: string,
) {
  const [prior] = await tx.query(
    "SELECT id FROM subscriptions WHERE user_id=$1",
    [a.userId],
  );
  const [trialUse] = await tx.query(
    "SELECT id FROM records WHERE kind='checkout' AND owner_user_id=$1 AND (data->'offerTerms'->>'trialDays')::integer>0 AND status<>'expired' LIMIT 1",
    [a.userId],
  );
  const trialDays =
    !prior && !trialUse
      ? Math.max(0, Math.min(30, Number(product.data.trialDays ?? 0)))
      : 0;
  let couponId: string | undefined;
  if (code) {
    const [promotion] = await tx.query(
      "SELECT * FROM records WHERE kind='promotion' AND status='published' AND data->>'code'=$1 AND data->>'productId'=$2 AND (data->>'expiresAt')::timestamptz>now()",
      [code.trim().toUpperCase(), product.id],
    );
    if (!promotion?.data.couponId)
      throw fail(
        "PROMOTION_UNAVAILABLE",
        "That code is unavailable for this offer",
      );
    couponId = promotion.data.couponId;
  }
  if (!Number.isSafeInteger(trialDays))
    throw fail("OFFER_INVALID", "Trial settings need review");
  return {
    trialDays,
    ...(couponId ? { couponId } : {}),
    ...(code ? { promotionCode: code.trim().toUpperCase() } : {}),
  };
}
