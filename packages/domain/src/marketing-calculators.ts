// Public marketing calculators: pure arithmetic with explicit, cited
// assumptions. Every output is an estimate, never a promise; the pages show
// the assumptions, and the Super admin edits them in platform settings
// ("Marketing estimates"). Sources live in packages/contracts
// marketing-content.ts (MARKETING_SOURCES) and on the /methodology page.
import { z } from "zod";
import { BANDS, commission } from "./index.ts";

// ---------------------------------------------------------------------------
// Follower calculator (assumptions version 2026-09-28.3)
//
// Three scenarios from the same arithmetic. Cautious and typical follow the
// cited research; strong is a best case for an engaged audience and weekly
// sharing, calibrated to creator sales examples. The pages headline the
// strong case and show cautious and typical under "How we estimate".

export const FOLLOWER_SCENARIOS = ["cautious", "typical", "strong"] as const;
export type FollowerScenario = (typeof FOLLOWER_SCENARIOS)[number];
export type PerScenario<T = number> = Record<FollowerScenario, T>;

/** Benchmarks for one follower-count tier. */
export type FollowerTier = {
  /** Upper bound of the tier (inclusive); null for the last tier. */
  upTo: number | null;
  /** Share of followers (%) who see at least one of your Stories a month. */
  storyPct: PerScenario;
  /** Share of followers (%) one call-to-action Reel or post reaches. */
  reelPct: PerScenario;
  /** Comments per Reel view (%), the same in every scenario. */
  commentsPerViewPct: number;
};
export type FollowerScenarioRates = {
  /** Chance that one Story viewer opens one link sticker (%). */
  linkClickPct: number;
  /** Share of keyword commenters who open the link sent by DM (%). */
  dmOpenPct: number;
  /** Chance that one broadcast member opens one link message (%). */
  broadcastClickPct: number;
  /** Chance that one profile visitor opens the bio link in a month (%). */
  bioClickPct: number;
  /** Share of people who open your page that become paid subscribers (%). */
  paidPct: number;
  /**
   * Whether Reels reach people your Stories miss (added to them) or the same
   * people (nested inside the Story audience; the cautious reading).
   */
  reelsReachNewPeople: boolean;
};
export type FollowerModelAssumptions = {
  version: string;
  tiers: FollowerTier[];
  scenarios: PerScenario<FollowerScenarioRates>;
  /**
   * Keyword comments per view as a multiple of ordinary comments per view:
   * the extra comments a comment call to action brings (Metricool, +202.78%).
   */
  keywordCommentFactor: number;
  /** Average engagement rate used to scale reach when a rate is known. */
  engagementBenchmarkPct: number;
  /** Largest scaling in either direction (factor and 1/factor). */
  engagementFactorMax: number;
  /**
   * The operator's reason and source for values that differ from the cited
   * defaults; required by settings validation whenever one differs.
   */
  changeNote?: string;
};

/**
 * Defaults (retrieved 28 September 2026; sources and labels on /methodology):
 * - Story audience: cautious = Socialinsider Stories reach, image (brand
 *   accounts); typical = the tier's video reach, at least 5% (IQFluence
 *   guidance that Story views above 5-8% of followers are healthy); strong =
 *   20.5% up to 10,000 followers (Socialinsider: a six-frame Story sequence
 *   reached 20.5% of followers; HypeAuditor: accounts of 1,000-10,000
 *   followers engage most), then the IQFluence 8% / 6.5% / 5% band above.
 * - Reel reach: Socialinsider feed-post reach (cautious) and Reels reach.
 *   Comments per view: Socialinsider 2025 medians (our division).
 * - Link click 1 / 3 / 5% (creator reports; IQFluence median 4.1%). DM open
 *   18 / 30 / 45% (vendor claims). Broadcast click 1.27 / 1.45 / 2.09%
 *   (MailerLite email medians, a proxy). Bio link 1 / 2 / 3% (rule of thumb).
 * - Visit to paid 0.72% (Dynamic Yield luxury retail), 2.9% (RevenueCat
 *   Health & Fitness median download-to-paid) and 10.7% (RevenueCat median
 *   day-35 conversion for hard-paywall apps). Per link Story the strong case
 *   turns 5% × 10.7% = 0.54% of viewers into subscribers: the low end of the
 *   owner-supplied creator example (0.5-1.5% of 100,000 YouTube viewers
 *   buying a $20 plan).
 */
export const DEFAULT_FOLLOWER_MODEL: FollowerModelAssumptions = {
  version: "2026-09-28.3",
  tiers: [
    {
      upTo: 5000,
      storyPct: { cautious: 9.55, typical: 10.4, strong: 20.5 },
      reelPct: { cautious: 6.65, typical: 9.78, strong: 9.78 },
      commentsPerViewPct: 0.52,
    },
    {
      upTo: 10000,
      storyPct: { cautious: 3.5, typical: 5, strong: 20.5 },
      reelPct: { cautious: 5.75, typical: 7.55, strong: 7.55 },
      commentsPerViewPct: 0.6,
    },
    {
      upTo: 50000,
      storyPct: { cautious: 1.35, typical: 5, strong: 8 },
      reelPct: { cautious: 5.5, typical: 7.1, strong: 7.1 },
      commentsPerViewPct: 0.49,
    },
    {
      upTo: 100000,
      storyPct: { cautious: 0.55, typical: 5, strong: 6.5 },
      reelPct: { cautious: 4.5, typical: 5.6, strong: 5.6 },
      commentsPerViewPct: 0.36,
    },
    {
      upTo: null,
      storyPct: { cautious: 0.5, typical: 5, strong: 5 },
      reelPct: { cautious: 3.5, typical: 5, strong: 5 },
      commentsPerViewPct: 0.37,
    },
  ],
  scenarios: {
    cautious: {
      linkClickPct: 1,
      dmOpenPct: 18,
      broadcastClickPct: 1.27,
      bioClickPct: 1,
      paidPct: 0.72,
      reelsReachNewPeople: false,
    },
    typical: {
      linkClickPct: 3,
      dmOpenPct: 30,
      broadcastClickPct: 1.45,
      bioClickPct: 2,
      paidPct: 2.9,
      reelsReachNewPeople: true,
    },
    strong: {
      linkClickPct: 5,
      dmOpenPct: 45,
      broadcastClickPct: 2.09,
      bioClickPct: 3,
      paidPct: 10.7,
      reelsReachNewPeople: true,
    },
  },
  keywordCommentFactor: 2.0278,
  engagementBenchmarkPct: 0.48,
  engagementFactorMax: 2,
};

const pct = z.number().finite().min(0).max(100);
const perScenario = z
  .object({ cautious: pct, typical: pct, strong: pct })
  .strict()
  .refine((v) => v.cautious <= v.typical && v.typical <= v.strong, {
    message: "Cautious must not exceed typical, nor typical strong",
  });
const rates = z
  .object({
    linkClickPct: pct,
    dmOpenPct: pct,
    broadcastClickPct: pct,
    bioClickPct: pct,
    paidPct: pct,
    reelsReachNewPeople: z.boolean(),
  })
  .strict();
const RATE_KEYS = [
  "linkClickPct",
  "dmOpenPct",
  "broadcastClickPct",
  "bioClickPct",
  "paidPct",
] as const;
export type FollowerRateKey = (typeof RATE_KEYS)[number];
export const FOLLOWER_RATE_KEYS: readonly FollowerRateKey[] = RATE_KEYS;
export const followerModelSchema = z
  .object({
    version: z.string().trim().min(1).max(40),
    tiers: z
      .array(
        z
          .object({
            upTo: z.number().int().positive().nullable(),
            storyPct: perScenario,
            reelPct: perScenario,
            commentsPerViewPct: pct,
          })
          .strict(),
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
    scenarios: z
      .object({ cautious: rates, typical: rates, strong: rates })
      .strict()
      .refine(
        (s) =>
          RATE_KEYS.every(
            (key) =>
              s.cautious[key] <= s.typical[key] &&
              s.typical[key] <= s.strong[key],
          ),
        { message: "Cautious must not exceed typical, nor typical strong" },
      ),
    keywordCommentFactor: z.number().finite().min(0).max(10),
    engagementBenchmarkPct: z.number().finite().positive().max(100),
    engagementFactorMax: z.number().finite().min(1).max(10),
    changeNote: z.string().trim().max(500).optional(),
  })
  .strict();

/** Earlier default versions; settings still holding one get the current model. */
export const SUPERSEDED_FOLLOWER_VERSIONS: readonly string[] = [
  "2026-09-28",
  "2026-09-28.2",
];
const TIER_KEY_NAMES = ["5K", "10K", "50K", "100K", "ABOVE_100K"] as const;
const SCENARIO_KEY_NAMES: PerScenario<string> = {
  cautious: "CAUTIOUS",
  typical: "TYPICAL",
  strong: "STRONG",
};
const RATE_KEY_NAMES: Record<FollowerRateKey, string> = {
  linkClickPct: "CLICK",
  dmOpenPct: "DM_OPEN",
  broadcastClickPct: "BROADCAST_CLICK",
  bioClickPct: "BIO_CLICK",
  paidPct: "PAID",
};
const perScenarioKeys = (name: (s: string) => string): PerScenario<string> => ({
  cautious: name(SCENARIO_KEY_NAMES.cautious),
  typical: name(SCENARIO_KEY_NAMES.typical),
  strong: name(SCENARIO_KEY_NAMES.strong),
});
/** Settings keys (Super admin, "Marketing estimates") for each assumption. */
export const FOLLOWER_MODEL_SETTING_KEYS = {
  version: "FOLLOWER_MODEL_VERSION",
  changeNote: "FOLLOWER_MODEL_CHANGE_NOTE",
  /** Story audience per tier and scenario: FOLLOWER_STORY_STRONG_10K, ... */
  story: TIER_KEY_NAMES.map((tier) =>
    perScenarioKeys((s) => `FOLLOWER_STORY_${s}_${tier}`),
  ),
  /** Per-scenario rates: FOLLOWER_PAID_STRONG, FOLLOWER_CLICK_TYPICAL, ... */
  rates: Object.fromEntries(
    RATE_KEYS.map((key) => [
      key,
      perScenarioKeys((s) => `FOLLOWER_${RATE_KEY_NAMES[key]}_${s}`),
    ]),
  ) as Record<FollowerRateKey, PerScenario<string>>,
  engagementBenchmarkPct: "FOLLOWER_ENGAGEMENT_BENCHMARK",
  engagementFactorMax: "FOLLOWER_ENGAGEMENT_FACTOR_MAX",
} as const;

/** One assumption that differs from the cited default. */
export type FollowerAdjustment = {
  /** "tiers.1.storyPct.strong", "scenarios.strong.paidPct", ... */
  field: string;
  value: number;
  cited: number;
};
/**
 * The assumptions whose values differ from the cited defaults, so pages can
 * say a value was adjusted by the operator and no longer matches its source.
 */
export function followerModelAdjustments(
  model: FollowerModelAssumptions,
): FollowerAdjustment[] {
  const d = DEFAULT_FOLLOWER_MODEL,
    out: FollowerAdjustment[] = [];
  const check = (field: string, value: number, cited: number | undefined) => {
    if (cited === undefined || Math.abs(value - cited) > 1e-9)
      out.push({ field, value, cited: cited ?? NaN });
  };
  model.tiers.forEach((tier, i) => {
    for (const s of FOLLOWER_SCENARIOS) {
      check(`tiers.${i}.storyPct.${s}`, tier.storyPct[s], d.tiers[i]?.storyPct[s]);
      check(`tiers.${i}.reelPct.${s}`, tier.reelPct[s], d.tiers[i]?.reelPct[s]);
    }
    check(
      `tiers.${i}.commentsPerViewPct`,
      tier.commentsPerViewPct,
      d.tiers[i]?.commentsPerViewPct,
    );
  });
  for (const s of FOLLOWER_SCENARIOS)
    for (const key of RATE_KEYS)
      check(`scenarios.${s}.${key}`, model.scenarios[s][key], d.scenarios[s][key]);
  for (const key of [
    "keywordCommentFactor",
    "engagementBenchmarkPct",
    "engagementFactorMax",
  ] as const)
    check(key, model[key], d[key]);
  return out;
}

/** Settings values that differ from the defaults need a reason (settings save). */
export function followerSettingsNeedNote(
  values: Record<string, string | undefined>,
): boolean {
  const note = values[FOLLOWER_MODEL_SETTING_KEYS.changeNote]?.trim();
  return !note && followerModelAdjustments(followerModelFromSettings(values)).length > 0;
}

/**
 * The effective model from settings values. A blank value keeps its default;
 * an inconsistent combination (a cautious value above typical, typical above
 * strong) falls back to the defaults as a whole, so the public pages never
 * show a model that fails its own rules. Reel reach, comments per view and
 * the keyword factor are cited constants, not settings.
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
  const per = (keys: PerScenario<string>, fallback: PerScenario) => ({
    cautious: num(keys.cautious, fallback.cautious),
    typical: num(keys.typical, fallback.typical),
    strong: num(keys.strong, fallback.strong),
  });
  const scenario = (s: FollowerScenario): FollowerScenarioRates => ({
    ...d.scenarios[s],
    ...Object.fromEntries(
      RATE_KEYS.map((key) => [key, num(k.rates[key][s], d.scenarios[s][key])]),
    ),
  });
  const version = values[k.version]?.trim();
  const candidate = {
    // An earlier published default version reads as the current one.
    version:
      version && !SUPERSEDED_FOLLOWER_VERSIONS.includes(version)
        ? version
        : d.version,
    tiers: d.tiers.map((tier, i) => ({
      ...tier,
      storyPct: per(k.story[i], tier.storyPct),
    })),
    scenarios: {
      cautious: scenario("cautious"),
      typical: scenario("typical"),
      strong: scenario("strong"),
    },
    keywordCommentFactor: d.keywordCommentFactor,
    engagementBenchmarkPct: num(
      k.engagementBenchmarkPct,
      d.engagementBenchmarkPct,
    ),
    engagementFactorMax: num(k.engagementFactorMax, d.engagementFactorMax),
    ...(values[k.changeNote]?.trim()
      ? { changeNote: values[k.changeNote]!.trim().slice(0, 500) }
      : {}),
  };
  const parsed = followerModelSchema.safeParse(candidate);
  return parsed.success
    ? (parsed.data as FollowerModelAssumptions)
    : DEFAULT_FOLLOWER_MODEL;
}

export const FOLLOWER_LIMITS = {
  followers: [0, 10_000_000],
  priceAed: [1, 10_000],
  linkStoriesPerMonth: [0, 60],
  ctaReelsPerMonth: [0, 60],
  profileVisitsPerMonth: [0, 10_000_000],
  broadcastMembers: [0, 10_000_000],
  broadcastLinksPerMonth: [0, 60],
  storyViews: [0, 10_000_000],
  engagementRatePct: [0, 100],
  yearlyCancelPct: [5, 80],
} as const;
export type FollowerInputs = {
  followers: number;
  /** The trainer's own monthly price, used to value the estimate. */
  priceAed: number;
  /** Stories carrying the coaching link each month. */
  linkStoriesPerMonth: number;
  /** Reels or posts with a call to action each month. */
  ctaReelsPerMonth?: number;
  /**
   * A comment keyword sends the link by DM. Off: call-to-action posts count
   * only through bio-link visits.
   */
  keywordDms?: boolean;
  /** Profile visits a month from Insights; the bio link counts only then. */
  profileVisitsPerMonth?: number | null;
  /** Broadcast channel members, and link messages sent there each month. */
  broadcastMembers?: number | null;
  broadcastLinksPerMonth?: number;
  /** Your own average Story views; replaces the Story audience benchmark. */
  storyViews?: number | null;
  /** Measured or typed average engagement rate; omitted when unknown. */
  engagementRatePct?: number | null;
  /** Members who cancel per year (%). */
  yearlyCancelPct?: number;
};
export type FollowerInputsUsed = {
  followers: number;
  priceAed: number;
  linkStoriesPerMonth: number;
  ctaReelsPerMonth: number;
  keywordDms: boolean;
  profileVisitsPerMonth: number | null;
  broadcastMembers: number | null;
  broadcastLinksPerMonth: number;
  storyViews: number | null;
  engagementRatePct: number | null;
  yearlyCancelPct: number;
};
/** The calculator's starting numbers (the strong case's calibration example). */
export const DEFAULT_FOLLOWER_INPUTS: FollowerInputsUsed = {
  followers: 7000,
  priceAed: 199,
  linkStoriesPerMonth: 8,
  ctaReelsPerMonth: 4,
  keywordDms: true,
  profileVisitsPerMonth: null,
  broadcastMembers: null,
  broadcastLinksPerMonth: 4,
  storyViews: null,
  engagementRatePct: null,
  yearlyCancelPct: 30,
};

export type FollowerScenarioEstimate = {
  scenario: FollowerScenario;
  /** People who see at least one of your Stories in a month. */
  storyViewers: number;
  /** People who open your page at least once over twelve months. */
  visitors12: number;
  /** New paying subscribers in each month 1-12 (fractional). */
  newByMonth: number[];
  /** Active subscribers at the end of each month 1-12, after cancellations. */
  activeByMonth: number[];
  /** New paying subscribers in the first month. */
  month1New: number;
  /** Active subscribers at month 12, after cancellations. */
  activeMonth12: number;
  /** Everyone who signs up over twelve months, before cancellations. */
  signups12: number;
  /**
   * The whole active subscribers at month 12 × your price, in fils, before
   * platform commission, payment processing and tax.
   */
  revenueMonth12Minor: number;
};
export type FollowerEstimate = {
  inputs: FollowerInputsUsed;
  tierIndex: number;
  engagementFactor: number;
  /** Monthly cancellation share (%) equal to the yearly rate. */
  monthlyCancelPct: number;
  scenarios: PerScenario<FollowerScenarioEstimate>;
  assumptionsVersion: string;
};

const clamp = (value: number, [min, max]: readonly [number, number]) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const optional = (
  value: number | null | undefined,
  limits: readonly [number, number],
) =>
  value === undefined || value === null || !Number.isFinite(value)
    ? null
    : Math.floor(clamp(value, limits));

/** Chance that a person opens at least one of `times` links at `clickPct`. */
export function visitChance(clickPct: number, times: number): number {
  const p = Math.min(1, Math.max(0, clickPct / 100));
  return times <= 0 ? 0 : 1 - Math.pow(1 - p, times);
}
/** Monthly cancellation share from a yearly one: 1 − (1 − yearly)^(1/12). */
export function monthlyChurn(yearlyPct: number): number {
  const yearly = Math.min(1, Math.max(0, yearlyPct / 100));
  return yearly >= 1 ? 1 : 1 - Math.pow(1 - yearly, 1 / 12);
}

/** The inputs as the calculator uses them: defaults filled, then clamped. */
export function followerInputsUsed(input: FollowerInputs): FollowerInputsUsed {
  const L = FOLLOWER_LIMITS,
    D = DEFAULT_FOLLOWER_INPUTS;
  const whole = (value: number | undefined, limits: readonly [number, number], fallback: number) =>
    Math.floor(clamp(value ?? fallback, limits));
  const followers = whole(input.followers, L.followers, 0);
  const members = optional(input.broadcastMembers, L.broadcastMembers);
  const views = optional(input.storyViews, L.storyViews);
  return {
    followers,
    priceAed: Math.round(clamp(input.priceAed, L.priceAed)),
    linkStoriesPerMonth: whole(input.linkStoriesPerMonth, L.linkStoriesPerMonth, 0),
    ctaReelsPerMonth: whole(input.ctaReelsPerMonth, L.ctaReelsPerMonth, D.ctaReelsPerMonth),
    keywordDms: input.keywordDms ?? D.keywordDms,
    profileVisitsPerMonth: optional(input.profileVisitsPerMonth, L.profileVisitsPerMonth),
    // Broadcast members and Story viewers are followers.
    broadcastMembers: members === null ? null : Math.min(members, followers),
    broadcastLinksPerMonth: whole(
      input.broadcastLinksPerMonth,
      L.broadcastLinksPerMonth,
      D.broadcastLinksPerMonth,
    ),
    storyViews: views === null ? null : Math.min(views, followers),
    engagementRatePct:
      input.engagementRatePct === undefined ||
      input.engagementRatePct === null ||
      !Number.isFinite(input.engagementRatePct)
        ? null
        : clamp(input.engagementRatePct, L.engagementRatePct),
    yearlyCancelPct: clamp(input.yearlyCancelPct ?? D.yearlyCancelPct, L.yearlyCancelPct),
  };
}

type Channel = { people: number; chance: number };
/**
 * People who visit at least once when channels reach nested groups (each
 * smaller audience sits inside the larger ones; Stories are ranked by
 * closeness, so the closest followers see everything). Each person visits
 * with 1 − Π(1 − chance) over the channels that reach them.
 */
function nestedVisitors(channels: Channel[]): number {
  const sizes = [...new Set(channels.map((c) => c.people))]
    .filter((size) => size > 0)
    .sort((a, b) => a - b);
  let total = 0,
    previous = 0;
  for (const size of sizes) {
    let miss = 1;
    for (const c of channels) if (c.people >= size) miss *= 1 - c.chance;
    total += (size - previous) * (1 - miss);
    previous = size;
  }
  return total;
}

/** How many people each channel reaches, for one scenario. */
type Audiences = {
  /** People who see at least one of your Stories a month. */
  story: number;
  /** People one call-to-action Reel reaches. */
  reelViewers: number;
  /** Keyword comments one such Reel gets (viewers × keyword comments per view). */
  keywordComments: number;
  /** Broadcast channel members. */
  broadcast: number;
};
function audiences(
  model: FollowerModelAssumptions,
  scenario: FollowerScenario,
  i: FollowerInputsUsed,
  engagement: number,
): Audiences {
  const F = i.followers;
  const reelsAt = (tier: FollowerTier, audience: number) =>
    Math.min(audience, (audience * tier.reelPct[scenario]) / 100);
  return {
    // Your own Story views replace the benchmark (and its engagement scaling).
    story:
      i.storyViews ??
      acrossTiers(model, F, (tier, audience) =>
        Math.min(audience, (audience * engagement * tier.storyPct[scenario]) / 100),
      ),
    reelViewers: acrossTiers(model, F, reelsAt),
    keywordComments: acrossTiers(
      model,
      F,
      (tier, audience) =>
        reelsAt(tier, audience) *
        Math.min(
          1,
          (engagement * tier.commentsPerViewPct * model.keywordCommentFactor) / 100,
        ),
    ),
    broadcast: Math.min(F, i.broadcastMembers ?? 0),
  };
}

/** People who open your page at least once within `months` months. */
function visitorsWithin(
  months: number,
  a: Audiences,
  rates: FollowerScenarioRates,
  i: FollowerInputsUsed,
): number {
  if (months <= 0) return 0;
  const channels: Channel[] = [];
  if (i.linkStoriesPerMonth > 0)
    channels.push({
      people: a.story,
      chance: visitChance(rates.linkClickPct, i.linkStoriesPerMonth * months),
    });
  if (a.broadcast > 0 && i.broadcastLinksPerMonth > 0)
    channels.push({
      people: a.broadcast,
      chance: visitChance(rates.broadcastClickPct, i.broadcastLinksPerMonth * months),
    });
  let reels: Channel | null = null;
  if (i.keywordDms && i.ctaReelsPerMonth > 0 && a.reelViewers > 0) {
    // Per Reel viewer per Reel: keyword comments per view × DM link opened.
    const perView = (a.keywordComments / a.reelViewers) * (rates.dmOpenPct / 100);
    reels = {
      people: a.reelViewers,
      chance: visitChance(perView * 100, i.ctaReelsPerMonth * months),
    };
  }
  if (reels && !rates.reelsReachNewPeople) channels.push(reels);
  return (
    nestedVisitors(channels) +
    (reels && rates.reelsReachNewPeople ? reels.people * reels.chance : 0) +
    (i.profileVisitsPerMonth ?? 0) * visitChance(rates.bioClickPct, months)
  );
}

/** The tier a follower count falls in. */
export function followerTierIndex(
  followers: number,
  model: FollowerModelAssumptions = DEFAULT_FOLLOWER_MODEL,
): number {
  return Math.max(
    0,
    model.tiers.findIndex((t) => t.upTo === null || followers <= t.upTo),
  );
}

/**
 * Tier boundaries never lower an audience: each channel reaches at least as
 * many people as it would for an account at the top of each smaller tier
 * (max over tiers j ≤ yours of the audience of min(followers, top of j) with
 * tier j's benchmarks). So more followers never mean fewer viewers, visitors
 * or sign-ups.
 */
function acrossTiers(
  model: FollowerModelAssumptions,
  followers: number,
  at: (tier: FollowerTier, audience: number) => number,
): number {
  const index = followerTierIndex(followers, model);
  let best = 0;
  for (let j = 0; j <= index; j++) {
    const tier = model.tiers[j];
    best = Math.max(best, at(tier, Math.min(followers, tier.upTo ?? Infinity)));
  }
  return best;
}

/**
 * Follower-to-subscriber estimate for the three scenarios. Pure; inputs are
 * clamped.
 *
 *   g     = your engagement / benchmark, within ×(1/max)..×max (1 if unknown)
 *   S     = Story audience = followers × Story share (× g), or your views
 *   v(T)  = 1 − (1 − rate)^(times × T)          chance of a visit by month T
 *   D(T)  = nested union of Stories and broadcast (and Reels when cautious)
 *           + Reel viewers × v_reel(T) (typical and strong)
 *           + profile visits × (1 − (1 − bio click)^T)
 *   C(T)  = visit to paid × D(T)                one decision per person
 *   N_m   = C(m) − C(m − 1)                     new subscribers in month m
 *   A_m   = Σ N_i × (1 − churn)^(m − i)         active in month m
 *   churn = 1 − (1 − yearly cancellations)^(1/12)
 */
export function estimateFollowerConversion(
  input: FollowerInputs,
  model: FollowerModelAssumptions = DEFAULT_FOLLOWER_MODEL,
): FollowerEstimate {
  const i = followerInputsUsed(input);
  const max = model.engagementFactorMax;
  const engagement =
    i.engagementRatePct === null
      ? 1
      : Math.min(
          max,
          Math.max(1 / max, i.engagementRatePct / model.engagementBenchmarkPct),
        );
  const churn = monthlyChurn(i.yearlyCancelPct);
  const run = (scenario: FollowerScenario): FollowerScenarioEstimate => {
    const rates = model.scenarios[scenario];
    const reach = audiences(model, scenario, i, engagement);
    const paid = rates.paidPct / 100;
    const visitors = Array.from({ length: 13 }, (_, months) =>
      visitorsWithin(months, reach, rates, i),
    );
    const cumulative = visitors.map((people) => paid * people);
    const newByMonth = cumulative
      .slice(1)
      .map((c, m) => Math.max(0, c - cumulative[m]));
    const activeByMonth = newByMonth.map((_, m) =>
      newByMonth
        .slice(0, m + 1)
        .reduce((sum, n, joined) => sum + n * Math.pow(1 - churn, m - joined), 0),
    );
    const activeMonth12 = activeByMonth[11];
    return {
      scenario,
      storyViewers: reach.story,
      visitors12: visitors[12],
      newByMonth,
      activeByMonth,
      month1New: newByMonth[0],
      activeMonth12,
      signups12: cumulative[12],
      revenueMonth12Minor: Math.round(activeMonth12) * i.priceAed * 100,
    };
  };
  return {
    inputs: i,
    tierIndex: followerTierIndex(i.followers, model),
    engagementFactor: engagement,
    monthlyCancelPct: churn * 100,
    scenarios: {
      cautious: run("cautious"),
      typical: run("typical"),
      strong: run("strong"),
    },
    assumptionsVersion: model.version,
  };
}

export type FollowerLeverId = "bioLink" | "keywordReels" | "moreStories" | "broadcast";
export type FollowerLever = {
  id: FollowerLeverId;
  /** The one change made to your inputs. */
  change: Partial<FollowerInputs>;
  /** Differences against your current estimate, in the chosen scenario. */
  month1New: number;
  signups12: number;
  activeMonth12: number;
};
/**
 * "What raises your number": the estimate re-run with one change at a time.
 * Bio link: 1,000 more profile visits a month. Keyword Reels: turn the
 * comment keyword on for 4 Reels a month, or 4 more such Reels. Stories: 4
 * more link Stories. Broadcast: a channel of 300 members with 4 link
 * messages a month, or 300 more members.
 */
export function followerLevers(
  input: FollowerInputs,
  model: FollowerModelAssumptions = DEFAULT_FOLLOWER_MODEL,
  scenario: FollowerScenario = "strong",
): FollowerLever[] {
  const base = estimateFollowerConversion(input, model);
  const i = base.inputs,
    now = base.scenarios[scenario];
  const cap = (n: number) => Math.min(60, n);
  const changes: Array<[FollowerLeverId, Partial<FollowerInputs>]> = [
    ["bioLink", { profileVisitsPerMonth: (i.profileVisitsPerMonth ?? 0) + 1000 }],
    [
      "keywordReels",
      i.keywordDms && i.ctaReelsPerMonth > 0
        ? { ctaReelsPerMonth: cap(i.ctaReelsPerMonth + 4) }
        : { keywordDms: true, ctaReelsPerMonth: Math.max(i.ctaReelsPerMonth, 4) },
    ],
    ["moreStories", { linkStoriesPerMonth: cap(i.linkStoriesPerMonth + 4) }],
    [
      "broadcast",
      i.broadcastMembers
        ? { broadcastMembers: i.broadcastMembers + 300 }
        : {
            broadcastMembers: 300,
            broadcastLinksPerMonth: i.broadcastLinksPerMonth || 4,
          },
    ],
  ];
  return changes.map(([id, change]) => {
    const next = estimateFollowerConversion({ ...i, ...change }, model)
      .scenarios[scenario];
    return {
      id,
      change,
      month1New: next.month1New - now.month1New,
      signups12: next.signups12 - now.signups12,
      activeMonth12: next.activeMonth12 - now.activeMonth12,
    };
  });
}

/** Range for display (kept for estimate ranges elsewhere). */
export type Range = { low: number; high: number };
/**
 * Whole-number display of an estimate range: the low end rounds down and the
 * high end rounds to nearest (never below the low end), so a range is never
 * inflated by rounding up.
 */
export function displayRange(range: Range): Range {
  const low = Math.floor(range.low + 1e-9);
  return { low, high: Math.max(low, Math.round(range.high)) };
}
/** A whole count for display, or null when below one person. */
export function displayCount(value: number): number | null {
  return value < 1 ? null : Math.round(value);
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
