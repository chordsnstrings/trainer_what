// Public marketing calculators: pure arithmetic with explicit, cited
// assumptions. Every output is an estimate range, never a promise; the pages
// show the assumptions, and the Super admin edits them in platform settings
// ("Marketing estimates"). Sources live in packages/contracts marketing.ts
// (MARKETING_SOURCES) and on the /methodology page.
import { z } from "zod";
import { BANDS, commission } from "./index.ts";

/** Story reach as a percentage of followers, per follower-count tier. */
export type FollowerTier = {
  /** Upper bound of the tier (inclusive); null for the last tier. */
  upTo: number | null;
  reachLowPct: number;
  reachHighPct: number;
};
export type FollowerModelAssumptions = {
  version: string;
  tiers: FollowerTier[];
  /** Share of Story viewers who open a link sticker. */
  linkClickLowPct: number;
  linkClickHighPct: number;
  /** Share of visits that become a paid subscription. */
  purchaseLowPct: number;
  purchaseHighPct: number;
  /** Average engagement rate used to scale reach when a rate is known. */
  engagementBenchmarkPct: number;
  /** Largest scaling in either direction (factor and 1/factor). */
  engagementFactorMax: number;
};

/**
 * Defaults from the cited sources (retrieved 28 September 2026):
 * Story reach by tier, image to video (Socialinsider Stories benchmarks);
 * link-sticker click-through 1-5% of viewers (creator reports; no industry
 * benchmark exists); purchase conversion 1.51% (APAC) to 5.39% (beauty and
 * personal care) of sessions (Dynamic Yield); engagement 0.48% (Socialinsider).
 */
export const DEFAULT_FOLLOWER_MODEL: FollowerModelAssumptions = {
  version: "2026-09-28",
  tiers: [
    { upTo: 5000, reachLowPct: 9.55, reachHighPct: 10.4 },
    { upTo: 10000, reachLowPct: 3.5, reachHighPct: 4.2 },
    { upTo: 50000, reachLowPct: 1.35, reachHighPct: 2 },
    { upTo: 100000, reachLowPct: 0.55, reachHighPct: 0.65 },
    { upTo: null, reachLowPct: 0.5, reachHighPct: 0.65 },
  ],
  linkClickLowPct: 1,
  linkClickHighPct: 5,
  purchaseLowPct: 1.51,
  purchaseHighPct: 5.39,
  engagementBenchmarkPct: 0.48,
  engagementFactorMax: 2,
};

const pct = z.number().finite().min(0).max(100);
export const followerModelSchema = z
  .object({
    version: z.string().trim().min(1).max(40),
    tiers: z
      .array(
        z
          .object({
            upTo: z.number().int().positive().nullable(),
            reachLowPct: pct,
            reachHighPct: pct,
          })
          .strict()
          .refine((t) => t.reachLowPct <= t.reachHighPct, {
            message: "A tier's low reach must not exceed its high reach",
          }),
      )
      .min(1)
      .max(8)
      .refine(
        (tiers) =>
          tiers.every(
            (t, i) =>
              (i === tiers.length - 1) === (t.upTo === null) &&
              (i === 0 || (t.upTo ?? Infinity) > (tiers[i - 1].upTo ?? 0)),
          ),
        { message: "Tiers ascend and only the last one is open-ended" },
      ),
    linkClickLowPct: pct,
    linkClickHighPct: pct,
    purchaseLowPct: pct,
    purchaseHighPct: pct,
    engagementBenchmarkPct: z.number().finite().positive().max(100),
    engagementFactorMax: z.number().finite().min(1).max(10),
  })
  .strict()
  .refine(
    (m) =>
      m.linkClickLowPct <= m.linkClickHighPct &&
      m.purchaseLowPct <= m.purchaseHighPct,
    { message: "Each low assumption must not exceed its high assumption" },
  );

/** Settings keys (Super admin, "Marketing estimates") for each assumption. */
export const FOLLOWER_MODEL_SETTING_KEYS = {
  version: "FOLLOWER_MODEL_VERSION",
  tiers: [
    ["FOLLOWER_REACH_UP_TO_5K_LOW", "FOLLOWER_REACH_UP_TO_5K_HIGH"],
    ["FOLLOWER_REACH_UP_TO_10K_LOW", "FOLLOWER_REACH_UP_TO_10K_HIGH"],
    ["FOLLOWER_REACH_UP_TO_50K_LOW", "FOLLOWER_REACH_UP_TO_50K_HIGH"],
    ["FOLLOWER_REACH_UP_TO_100K_LOW", "FOLLOWER_REACH_UP_TO_100K_HIGH"],
    ["FOLLOWER_REACH_ABOVE_100K_LOW", "FOLLOWER_REACH_ABOVE_100K_HIGH"],
  ],
  linkClickLowPct: "FOLLOWER_LINK_CLICK_LOW",
  linkClickHighPct: "FOLLOWER_LINK_CLICK_HIGH",
  purchaseLowPct: "FOLLOWER_PURCHASE_LOW",
  purchaseHighPct: "FOLLOWER_PURCHASE_HIGH",
  engagementBenchmarkPct: "FOLLOWER_ENGAGEMENT_BENCHMARK",
  engagementFactorMax: "FOLLOWER_ENGAGEMENT_FACTOR_MAX",
} as const;

/**
 * The effective model from settings values. A blank value keeps its default;
 * an inconsistent combination falls back to the defaults as a whole, so the
 * public pages never show a model that fails its own rules.
 */
export function followerModelFromSettings(
  values: Record<string, string | undefined>,
): FollowerModelAssumptions {
  const d = DEFAULT_FOLLOWER_MODEL,
    k = FOLLOWER_MODEL_SETTING_KEYS;
  const num = (key: string, fallback: number) => {
    const text = values[key]?.trim();
    const value = text ? Number(text) : NaN;
    return Number.isFinite(value) ? value : fallback;
  };
  const candidate = {
    version: values[k.version]?.trim() || d.version,
    tiers: d.tiers.map((tier, i) => ({
      upTo: tier.upTo,
      reachLowPct: num(k.tiers[i][0], tier.reachLowPct),
      reachHighPct: num(k.tiers[i][1], tier.reachHighPct),
    })),
    linkClickLowPct: num(k.linkClickLowPct, d.linkClickLowPct),
    linkClickHighPct: num(k.linkClickHighPct, d.linkClickHighPct),
    purchaseLowPct: num(k.purchaseLowPct, d.purchaseLowPct),
    purchaseHighPct: num(k.purchaseHighPct, d.purchaseHighPct),
    engagementBenchmarkPct: num(
      k.engagementBenchmarkPct,
      d.engagementBenchmarkPct,
    ),
    engagementFactorMax: num(k.engagementFactorMax, d.engagementFactorMax),
  };
  const parsed = followerModelSchema.safeParse(candidate);
  return parsed.success
    ? (parsed.data as FollowerModelAssumptions)
    : DEFAULT_FOLLOWER_MODEL;
}

export const FOLLOWER_LIMITS = {
  followers: [0, 10_000_000],
  linkStoriesPerMonth: [0, 60],
  priceAed: [1, 10_000],
  engagementRatePct: [0, 100],
} as const;
export type FollowerInputs = {
  followers: number;
  /** Stories carrying the coaching link each month. */
  linkStoriesPerMonth: number;
  /** The trainer's own monthly price, used only to value the range. */
  priceAed: number;
  /** Measured or typed average engagement rate; omitted when unknown. */
  engagementRatePct?: number | null;
};
export type Range = { low: number; high: number };
export type FollowerEstimate = {
  inputs: Required<Omit<FollowerInputs, "engagementRatePct">> & {
    engagementRatePct: number | null;
  };
  tierIndex: number;
  engagementFactor: number;
  reachPct: Range;
  /** Story views carrying the link, per month. */
  linkViews: Range;
  /** Visits to the coaching page, per month. */
  visits: Range;
  /** New paying subscribers per month (fractional; see displayRange). */
  subscribers: Range;
  /** Monthly subscription revenue those subscribers add, in AED fils. */
  monthlyRevenueMinor: Range;
  /** After twelve months of steady sharing, before any cancellations. */
  twelveMonthSubscribers: Range;
  assumptionsVersion: string;
};

const clamp = (value: number, [min, max]: readonly [number, number]) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/** Monthly follower-to-subscriber estimate. Pure; inputs are clamped. */
export function estimateFollowerConversion(
  input: FollowerInputs,
  model: FollowerModelAssumptions = DEFAULT_FOLLOWER_MODEL,
): FollowerEstimate {
  const followers = Math.floor(
      clamp(input.followers, FOLLOWER_LIMITS.followers),
    ),
    stories = Math.floor(
      clamp(input.linkStoriesPerMonth, FOLLOWER_LIMITS.linkStoriesPerMonth),
    ),
    price = Math.round(clamp(input.priceAed, FOLLOWER_LIMITS.priceAed)),
    engagement =
      input.engagementRatePct === undefined ||
      input.engagementRatePct === null ||
      !Number.isFinite(input.engagementRatePct)
        ? null
        : clamp(input.engagementRatePct, FOLLOWER_LIMITS.engagementRatePct);
  const tierIndex = Math.max(
    0,
    model.tiers.findIndex((t) => t.upTo === null || followers <= t.upTo),
  );
  const tier = model.tiers[tierIndex];
  const max = model.engagementFactorMax;
  const engagementFactor =
    engagement === null
      ? 1
      : Math.min(
          max,
          Math.max(1 / max, engagement / model.engagementBenchmarkPct),
        );
  const reach = {
    low: Math.min(100, tier.reachLowPct * engagementFactor),
    high: Math.min(100, tier.reachHighPct * engagementFactor),
  };
  const linkViews = {
    low: (followers * reach.low * stories) / 100,
    high: (followers * reach.high * stories) / 100,
  };
  const visits = {
    low: (linkViews.low * model.linkClickLowPct) / 100,
    high: (linkViews.high * model.linkClickHighPct) / 100,
  };
  // Nobody subscribes twice: a month can never add more than the audience.
  const subscribers = {
    low: Math.min(followers, (visits.low * model.purchaseLowPct) / 100),
    high: Math.min(followers, (visits.high * model.purchaseHighPct) / 100),
  };
  return {
    inputs: {
      followers,
      linkStoriesPerMonth: stories,
      priceAed: price,
      engagementRatePct: engagement,
    },
    tierIndex,
    engagementFactor,
    reachPct: reach,
    linkViews,
    visits,
    subscribers,
    monthlyRevenueMinor: {
      low: Math.round(subscribers.low * price * 100),
      high: Math.round(subscribers.high * price * 100),
    },
    twelveMonthSubscribers: {
      low: Math.min(followers, subscribers.low * 12),
      high: Math.min(followers, subscribers.high * 12),
    },
    assumptionsVersion: model.version,
  };
}

/**
 * Whole-number display of an estimate range: the low end rounds down and the
 * high end rounds to nearest (never below the low end), so a range is never
 * inflated by rounding up.
 */
export function displayRange(range: Range): Range {
  const low = Math.floor(range.low + 1e-9);
  return { low, high: Math.max(low, Math.round(range.high)) };
}

/** Engagement rate (%) from recent posts: mean(likes + comments) / followers. */
export function engagementRate(
  followers: number,
  posts: Array<{ likes?: number | null; comments?: number | null }>,
): number | null {
  if (!Number.isFinite(followers) || followers <= 0 || !posts.length)
    return null;
  const total = posts.reduce(
    (sum, p) =>
      sum +
      Math.max(0, Number(p.likes) || 0) +
      Math.max(0, Number(p.comments) || 0),
    0,
  );
  return Math.round((total / posts.length / followers) * 100 * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Earnings calculator

export const EARNINGS_LIMITS = {
  subscribers: [0, 100_000],
  priceAed: [0, 10_000],
  sharePct: [0, 100],
  programmeMonths: [1, 24],
  sessionsPerMonth: [0, 1_000],
} as const;
export type EarningsInputs = {
  subscribers: number;
  billing: "monthly" | "upfront";
  /** Workout tier: monthly price, or the whole programme price when upfront. */
  workoutPriceAed: number;
  /** Programme length in months (upfront billing divides by it). */
  programmeMonths: number;
  /** Share of subscribers on workout + nutrition, and that tier's price. */
  nutritionSharePct: number;
  nutritionPriceAed: number;
  /** Share of subscribers adding the voice coach, and its monthly price. */
  voiceSharePct: number;
  voicePriceAed: number;
  /** Paid one-to-one sessions sold each month, and their price. */
  sessionsPerMonth: number;
  sessionPriceAed: number;
  /** Your usual in-person rate per session, for the hours comparison. */
  yourSessionRateAed: number;
};
export type EarningsBand = {
  from: number;
  to: number | null;
  ratePct: number;
  subscribers: number;
  commissionMinor: number;
};
export type EarningsEstimate = {
  /** Average monthly subscription amount per subscriber, in fils. */
  averageMonthlyMinor: number;
  subscriptionMonthlyMinor: number;
  sessionsMonthlyMinor: number;
  commissionMinor: number;
  effectiveCommissionPct: number;
  bands: EarningsBand[];
  /** Subscriptions minus commission, plus sessions: before other costs. */
  beforeOtherCostsMinor: number;
  /** Sessions at your own rate that would earn the same amount. */
  equivalentSessions: number | null;
};

/** Monthly earnings estimate; commission follows the marginal bands. */
export function estimateEarnings(input: EarningsInputs): EarningsEstimate {
  const n = Math.floor(clamp(input.subscribers, EARNINGS_LIMITS.subscribers)),
    months = Math.floor(
      clamp(input.programmeMonths, EARNINGS_LIMITS.programmeMonths),
    ),
    price = (v: number) => Math.round(clamp(v, EARNINGS_LIMITS.priceAed) * 100),
    share = (v: number) => clamp(v, EARNINGS_LIMITS.sharePct) / 100;
  const perMonth = (minor: number) =>
    input.billing === "upfront" ? minor / months : minor;
  const nutritionShare = share(input.nutritionSharePct);
  // Average monthly amount per subscriber: the tier mix plus the voice add-on.
  const averageMonthlyMinor = Math.round(
    perMonth(price(input.workoutPriceAed)) * (1 - nutritionShare) +
      perMonth(price(input.nutritionPriceAed)) * nutritionShare +
      price(input.voicePriceAed) * share(input.voiceSharePct),
  );
  const bands: EarningsBand[] = [];
  let left = n,
    rank = 1,
    commissionMinor = 0;
  for (const band of BANDS) {
    const count = Math.min(left, band.count);
    const bandCommission = count * commission(averageMonthlyMinor, rank);
    bands.push({
      from: rank,
      to: band.count === Infinity ? null : rank + band.count - 1,
      ratePct: band.bps / 100,
      subscribers: count,
      commissionMinor: bandCommission,
    });
    commissionMinor += bandCommission;
    left -= count;
    rank += band.count === Infinity ? count : band.count;
  }
  const subscriptionMonthlyMinor = averageMonthlyMinor * n,
    sessionsMonthlyMinor =
      Math.floor(clamp(input.sessionsPerMonth, EARNINGS_LIMITS.sessionsPerMonth)) *
      price(input.sessionPriceAed),
    beforeOtherCostsMinor =
      subscriptionMonthlyMinor - commissionMinor + sessionsMonthlyMinor,
    rate = price(input.yourSessionRateAed);
  return {
    averageMonthlyMinor,
    subscriptionMonthlyMinor,
    sessionsMonthlyMinor,
    commissionMinor,
    effectiveCommissionPct: subscriptionMonthlyMinor
      ? Math.round((commissionMinor / subscriptionMonthlyMinor) * 10000) / 100
      : 0,
    bands,
    beforeOtherCostsMinor,
    equivalentSessions: rate > 0 ? Math.round(beforeOtherCostsMinor / rate) : null,
  };
}

/** The shared defaults of the public earnings calculator. */
export const DEFAULT_EARNINGS_INPUTS: EarningsInputs = {
  subscribers: 60,
  billing: "monthly",
  workoutPriceAed: 199,
  programmeMonths: 3,
  nutritionSharePct: 30,
  nutritionPriceAed: 299,
  voiceSharePct: 0,
  voicePriceAed: 49,
  sessionsPerMonth: 0,
  sessionPriceAed: 250,
  yourSessionRateAed: 250,
};

/** Whole dirhams for estimates ("AED 22,885"); amounts are in fils. */
export function aedWhole(minor: number): string {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(Math.round(minor / 100));
}
