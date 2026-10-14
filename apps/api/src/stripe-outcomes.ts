/**
 * Outcomes of payment instructions sent to Stripe (docs/features/payments-stripe.md).
 *
 * An instruction whose answer never arrived stays uncertain and holds the
 * member's next purchase, exit or the month close until reconciled. These
 * rules say when provider evidence settles it instead: Stripe refused it
 * (a 4xx answer created nothing, `stripeRefused` in @trainer/providers), or
 * a reconciliation read long after it was sent shows it never took effect.
 */

/** What a refusing provider said, without request details. */
export const refusalOf = (error: unknown) => {
  const e = error as { statusCode?: number; code?: string; message?: string };
  return {
    statusCode: e?.statusCode ?? null,
    code: e?.code ?? null,
    message: String(e?.message ?? "").slice(0, 300),
    at: new Date().toISOString(),
  };
};
/**
 * A checkout Stripe never created cannot be paid after its own expiry: once
 * that time plus this margin (for Stripe's session list to show every
 * session) has passed with no matching session, the intent is expired.
 */
export const CHECKOUT_ABSENT_AFTER_MS = 15 * 60000;
export const checkoutAbsent = (r: {
  data?: { providerId?: unknown; checkoutId?: unknown; expiresAt?: unknown };
}) =>
  !r.data?.providerId &&
  !r.data?.checkoutId &&
  Number.isFinite(Date.parse(String(r.data?.expiresAt))) &&
  Date.parse(String(r.data!.expiresAt)) + CHECKOUT_ABSENT_AFTER_MS < Date.now();
/**
 * A renewal switch or refund whose effect a provider read still does not
 * show this long after it was sent never took effect (Stripe applies an
 * accepted request before answering it; a request still in flight has long
 * timed out, stripe-node allows 15 s and two retries).
 */
export const INSTRUCTION_SETTLED_AFTER_MS = 10 * 60000;
export const instructionSettled = (r: { created_at: string | Date }) =>
  Date.now() - new Date(r.created_at).getTime() > INSTRUCTION_SETTLED_AFTER_MS;

/** New prepaid packs/passes use captured card payments. Reconciliation must
 * recover the payment time, never restart access or a refund window at read time. */
export async function confirmedCardPaymentTime(
  e: { created?: number },
  stripe: { charges: { retrieve(id: string): Promise<any> } } | undefined,
  chargeId: string | undefined,
  paymentIntentId: string | undefined,
) {
  if (Number.isSafeInteger(e.created) && Number(e.created) > 0)
    return new Date(Number(e.created) * 1000);
  if (stripe && chargeId && paymentIntentId) {
    const charge = await stripe.charges.retrieve(chargeId);
    const payment =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (
      charge.id === chargeId &&
      payment === paymentIntentId &&
      charge.paid &&
      charge.captured &&
      charge.payment_method_details?.type === "card" &&
      Number.isSafeInteger(charge.created) &&
      charge.created > 0
    )
      return new Date(charge.created * 1000);
  }
  throw Object.assign(
    new Error(
      "Confirmed payment time is unavailable; reconcile before granting access.",
    ),
    { code: "PAYMENT_TIME_UNRESOLVED", statusCode: 409 },
  );
}
