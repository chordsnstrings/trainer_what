/** Versioned commercial policy. All amounts are AED fils, never floats. */
export const MEMBERSHIP_PRICING_VERSION = "membership-2026-10-14";
export const MEMBERSHIP_MINIMUMS = {
  training: 19900,
  nutrition: 29900,
  complete: 39900,
} as const;
export const MODULE_PASS_PRICES = { nutrition: 15000, voice: 10000 } as const;
export type ModulePass = keyof typeof MODULE_PASS_PRICES;
export type PrepayMonths = 6 | 12;
export const PREPAY_REFUND_DAYS = 15;

export function monthlyMinimum(data: {
  tier?: string;
  premiumVoice?: boolean;
  voiceIncluded?: boolean;
  modules?: string[];
}) {
  const nutrition =
    data.tier === "workout_nutrition" || data.modules?.includes("nutrition");
  const voice =
    data.premiumVoice || data.voiceIncluded || data.modules?.includes("voice");
  return nutrition ? (voice ? 39900 : 29900) : voice ? 29900 : 19900;
}
export function minimumOfferPrice(
  data: { billing?: string; programmeDays?: number | null } & Parameters<
    typeof monthlyMinimum
  >[0],
) {
  return (
    monthlyMinimum(data) *
    (data.billing === "upfront"
      ? Math.max(1, Math.ceil((data.programmeDays ?? 30) / 30))
      : 1)
  );
}
export function assertOfferPrice(
  data: { priceMinor?: number } & Parameters<typeof minimumOfferPrice>[0],
) {
  const minimum = minimumOfferPrice(data);
  if (
    !Number.isSafeInteger(data.priceMinor) ||
    Number(data.priceMinor) < minimum
  )
    throw Object.assign(
      new Error(
        `This offer requires a price of at least AED ${(minimum / 100).toFixed(2)}. Ask your trainer to publish an updated offer.`,
      ),
      { statusCode: 409, code: "PRICE_BELOW_MINIMUM" },
    );
}
export function prepayQuote(monthlyPriceMinor: number, months: PrepayMonths) {
  if (
    !Number.isSafeInteger(monthlyPriceMinor) ||
    monthlyPriceMinor < 19900 ||
    ![6, 12].includes(months)
  )
    throw new Error("Invalid prepaid price");
  const discountBps = months === 6 ? 1000 : 3000;
  const listMinor = monthlyPriceMinor * months;
  const amountMinor = Number(
    (BigInt(listMinor) * BigInt(10000 - discountBps) + 5000n) / 10000n,
  );
  return {
    policyVersion: MEMBERSHIP_PRICING_VERSION,
    months,
    monthlyPriceMinor,
    listMinor,
    discountBps,
    amountMinor,
    refundWindowDays: PREPAY_REFUND_DAYS,
  };
}

/** Calendar months in Asia/Dubai, clamped to the last day (Jan 31 -> Feb 28). */
export function addMembershipMonths(
  value: string | Date,
  months: number,
): Date {
  const local = new Date(new Date(value).getTime() + 4 * 3600000);
  if (
    !Number.isFinite(local.getTime()) ||
    !Number.isInteger(months) ||
    months < 0
  )
    throw new Error("Invalid membership date");
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0),
  ).getUTCDate();
  local.setUTCDate(Math.min(day, last));
  return new Date(local.getTime() - 4 * 3600000);
}

export function prepaidRefundQuote(
  data: any,
  refundedMinor = 0,
  now = new Date(),
) {
  const terms = data.prepay;
  if (!terms || terms.policyVersion !== MEMBERSHIP_PRICING_VERSION) return null;
  const chargedAt = new Date(data.chargedAt);
  const startsAt = new Date(data.accessStartsAt);
  const deadline = new Date(
    chargedAt.getTime() + PREPAY_REFUND_DAYS * 86400000,
  );
  if (
    ![chargedAt, startsAt, deadline].every((d) =>
      Number.isFinite(d.getTime()),
    ) ||
    ![6, 12].includes(terms.months) ||
    !Number.isSafeInteger(terms.monthlyPriceMinor) ||
    terms.monthlyPriceMinor <= 0
  )
    throw new Error("Prepaid refund terms require reconciliation");
  let usedMonths = 0;
  while (
    usedMonths < terms.months &&
    now.getTime() >= addMembershipMonths(startsAt, usedMonths).getTime()
  )
    usedMonths++;
  const retainedMinor = Math.min(
    data.grossMinor,
    usedMonths * terms.monthlyPriceMinor,
  );
  return {
    policyVersion: terms.policyVersion,
    eligible:
      now.getTime() >= chargedAt.getTime() &&
      now.getTime() < deadline.getTime(),
    deadline: deadline.toISOString(),
    usedMonths,
    monthlyPriceMinor: terms.monthlyPriceMinor,
    retainedMinor,
    amountMinor: Math.max(0, data.grossMinor - refundedMinor - retainedMinor),
    accessUntil: addMembershipMonths(startsAt, usedMonths).toISOString(),
  };
}

/** Trials, free invoices and complimentary grants cannot unlock paid modules. */
export function hasPaidTraining(s: any, now = Date.now()): boolean {
  return (
    !!s &&
    s.status === "active" &&
    !!s.period_end &&
    Date.parse(s.period_end) > now &&
    (s.data?.billing === "upfront"
      ? Number(s.data?.upfront?.amountMinor) > 0
      : !!s.data?.firstPaidAt)
  );
}
export function modulePassActive(pass: any, now = Date.now()): boolean {
  return (
    pass?.verified === true &&
    !pass.endedReason &&
    Date.parse(pass.startsAt) <= now &&
    Date.parse(pass.endsAt) > now
  );
}
