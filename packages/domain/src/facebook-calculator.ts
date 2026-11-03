// Facebook Page calculator (assumptions version 2026-11-03): the follower to
// subscriber estimate for a trainer's Facebook Page, on researched Facebook
// Page reach figures. Pure arithmetic with explicit, cited assumptions, like
// the follower (Instagram) calculator in marketing-calculators.ts, whose
// scenarios, tier rule, engagement scaling, audience renewal and monthly
// helpers it reuses. Visit to paid comes from the follower model, so one
// "Marketing estimates" change moves both calculators; the Facebook figures
// are cited defaults with no platform settings yet, and the owner signs them
// off before trainers see this estimate. Sources live in packages/contracts
// marketing-content.ts (MARKETING_SOURCES).
//
// Three channels: posts carrying your link, Reels whose comment keyword sends
// the link by Messenger (a Page private reply), and your Page's own link,
// counted only when you enter your Page visits. Stories, Groups, links in
// comments and ads are not counted.
import {
  DEFAULT_FOLLOWER_INPUTS,
  DEFAULT_FOLLOWER_MODEL,
  FOLLOWER_LIMITS,
  MONTHS,
  addInto,
  clamp,
  cumulate,
  displayCount,
  groupVisits,
  monthlyChurn,
  nestedVisits,
  optional,
  visitChance,
  type Channel,
  type FollowerModelAssumptions,
  type FollowerScenario,
  type PerScenario,
} from "./marketing-calculators.ts";

/** Benchmarks for one Facebook Page follower tier. */
export type FacebookTier = {
  /** Upper bound of the tier (inclusive); null for the last tier. */
  upTo: number | null;
  /**
   * Average reach of one organic Page post as a share of followers (%),
   * across post formats; the same in every scenario.
   */
  postReachPct: number;
  /**
   * Average engagement rate for Pages this size (%): reactions, comments and
   * shares per post divided by followers. Your own rate is compared with it,
   * so a Page with typical engagement for its size is not scaled.
   */
  engagementBenchmarkPct: number;
};
export type FacebookScenarioRates = {
  /** Reach of one post carrying your link, as a share of an average post's reach (%). */
  linkPostRelativeReachPct: number;
  /** Reach of one call-to-action Reel, as a share of an average post's reach (%). */
  reelRelativeReachPct: number;
  /** Chance that one person who sees a link post opens the link (%). */
  linkClickPct: number;
  /** Share of keyword commenters who open the link sent by Messenger (%). */
  dmOpenPct: number;
  /** Chance that one Facebook Page visitor opens your Page's link in a month (%). */
  pageLinkClickPct: number;
  /**
   * Share of each audience that is new to your link each month (%): new
   * followers, and people Facebook starts showing your posts and Reels to,
   * in place of people who drift away. 0 keeps the same people all year.
   */
  audienceRenewalPct: number;
  /**
   * Whether Reels reach people your link posts miss (added to them) or the
   * same people (nested inside the link-post audience; the cautious reading).
   */
  reelsReachNewPeople: boolean;
};
export type FacebookModelAssumptions = {
  version: string;
  tiers: FacebookTier[];
  scenarios: PerScenario<FacebookScenarioRates>;
  /** Comments per Reel viewer (%), the same in every tier and scenario. */
  reelCommentsPerViewPct: number;
  /**
   * Keyword comments per view as a multiple of ordinary comments per view:
   * the extra comments a comment call to action brings.
   */
  keywordCommentFactor: number;
  /** Largest engagement scaling in either direction (factor and 1/factor). */
  engagementFactorMax: number;
  /**
   * The operator's reason and source for values that differ from the cited
   * defaults (kept for parity; unused while the model is defaults-only).
   */
  changeNote?: string;
};

const RATE_KEYS = [
  "linkPostRelativeReachPct",
  "reelRelativeReachPct",
  "linkClickPct",
  "dmOpenPct",
  "pageLinkClickPct",
  "audienceRenewalPct",
] as const;
export type FacebookRateKey = (typeof RATE_KEYS)[number];
/** Per-scenario numeric rates; each keeps cautious ≤ typical ≤ strong. */
export const FACEBOOK_RATE_KEYS: readonly FacebookRateKey[] = RATE_KEYS;

/**
 * Defaults, version 2026-11-03 (retrieved 3 November 2026; sources and
 * labels on /methodology). Organic brand-Page benchmarks, not trainer data;
 * each figure is measured, a labelled proxy or our assumption.
 * - Post reach by Page size: Socialinsider, Social media reach statistics
 *   (published 3 September 2026, updated 21 October 2026; organic posts by
 *   brand Pages, January 2025-August 2026): 1-5K 4.35%, 5-10K 3.40%, 10-50K
 *   2.70%, 50-100K 1.50%, 100K-1M 0.50% of followers. Pages under 1,000
 *   followers (excluded from the study) use the 1-5K figure, and Pages above
 *   1 million the 100K-1M figure: our assumptions.
 * - Link posts: the same study's reach by format, links 0.20% against images
 *   1.20% (the best format) and 0.78%, the average of its five formats
 *   (images 1.20, albums 1.15, status 0.80, Reels 0.55, links 0.20). One
 *   link post reaches 16.67% (cautious, against images) or 25.64% (typical,
 *   strong, against the average) of an average post (our division). Meta:
 *   98.9% of US Feed views in Q2 2026 were of posts without an outside link.
 * - Reels: 0.55% on the same basis: 45.83% (cautious) or 70.51% (typical,
 *   strong) of an average post (our division).
 * - Engagement benchmark by Page size: Socialinsider Facebook Reels
 *   engagement by followers, January-June 2026 (0.30 / 0.25 / 0.20 / 0.18 /
 *   0.15%), times 0.15 / 0.18 (all formats against Reels, 2025) = 0.25 /
 *   0.21 / 0.17 / 0.15 / 0.125% (our scaling).
 * - Comments per Reel viewer 0.46%: Buffer's median Facebook video
 *   engagement per reach in 2025 (4.84%) times comments' share of
 *   Socialinsider's 2025 per-Reel interactions (19 of 200, 9.5%) (our
 *   arithmetic). Keyword factor 2.0278: Metricool's Instagram figure (+202.78%
 *   comments with a comment call to action), used as a proxy.
 * - Link click per person reached 1 / 2.5 / 2.8%: 2.5% and 2.8% are Echobox's
 *   average and highest (magazines) organic Facebook click-through for
 *   publishers (6.5 million posts, May 2020-April 2021; measured, dated, a
 *   proxy); 1% is our assumption, the low end creators report for link taps.
 * - Messenger link open 18 / 30 / 45%: the Instagram auto-DM vendor claims
 *   (CommuniPass, ChatAutoDM), used as a proxy. A Page may send one private
 *   reply per comment within 7 days (Meta Private Replies).
 * - Page link per Facebook Page visit 1 / 2 / 3%: the link-in-bio rule of
 *   thumb (Hopp by Wix), used as a proxy for the action button or website.
 * - New people each month 0 / 1.5 / 8%: typical is about the yearly follower
 *   growth Socialinsider measured on Facebook brand Pages in 2025 (14.5-22.7%
 *   by tier, 38.2% for 10-50K; about 1.1-1.7% a month); strong is our
 *   assumption, as for Instagram, beside Meta's 36.6% of US Feed views from
 *   recommended posts (Q2 2026) and Buffer's 4.3% average monthly follower
 *   growth (October 2026); it outpaces the default 2.9% monthly cancellations.
 * - Engagement scaling at most ×2 either way: our assumption, as for Instagram.
 * Visit to paid and cancellations come from the follower model (shared).
 */
export const DEFAULT_FACEBOOK_MODEL: FacebookModelAssumptions = {
  version: "2026-11-03",
  tiers: [
    { upTo: 5000, postReachPct: 4.35, engagementBenchmarkPct: 0.25 },
    { upTo: 10000, postReachPct: 3.4, engagementBenchmarkPct: 0.21 },
    { upTo: 50000, postReachPct: 2.7, engagementBenchmarkPct: 0.17 },
    { upTo: 100000, postReachPct: 1.5, engagementBenchmarkPct: 0.15 },
    { upTo: null, postReachPct: 0.5, engagementBenchmarkPct: 0.125 },
  ],
  scenarios: {
    cautious: {
      linkPostRelativeReachPct: 16.67,
      reelRelativeReachPct: 45.83,
      linkClickPct: 1,
      dmOpenPct: 18,
      pageLinkClickPct: 1,
      audienceRenewalPct: 0,
      reelsReachNewPeople: false,
    },
    typical: {
      linkPostRelativeReachPct: 25.64,
      reelRelativeReachPct: 70.51,
      linkClickPct: 2.5,
      dmOpenPct: 30,
      pageLinkClickPct: 2,
      audienceRenewalPct: 1.5,
      reelsReachNewPeople: true,
    },
    strong: {
      linkPostRelativeReachPct: 25.64,
      reelRelativeReachPct: 70.51,
      linkClickPct: 2.8,
      dmOpenPct: 45,
      pageLinkClickPct: 3,
      audienceRenewalPct: 8,
      reelsReachNewPeople: true,
    },
  },
  reelCommentsPerViewPct: 0.46,
  keywordCommentFactor: 2.0278,
  engagementFactorMax: 2,
};

export const FACEBOOK_LIMITS = {
  followers: [0, 10_000_000],
  // The price and cancellations are the same inputs as the follower calculator's.
  priceAed: FOLLOWER_LIMITS.priceAed,
  linkPostsPerMonth: [0, 60],
  ctaReelsPerMonth: [0, 60],
  pageVisitsPerMonth: [0, 10_000_000],
  linkPostViewers: [0, 10_000_000],
  engagementRatePct: [0, 100],
  yearlyCancelPct: FOLLOWER_LIMITS.yearlyCancelPct,
} as const;
export type FacebookInputs = {
  /** Facebook Page followers. */
  followers: number;
  /** The trainer's own monthly price, used to value the estimate. */
  priceAed: number;
  /** Posts carrying the coaching link each month. */
  linkPostsPerMonth: number;
  /** Reels with a call to action each month. */
  ctaReelsPerMonth?: number;
  /**
   * A comment keyword sends the link by Messenger (a Page private reply).
   * Off: call-to-action Reels count only through the Page visits you enter.
   */
  keywordDms?: boolean;
  /** Facebook Page visits a month from Insights; the Page link counts only then. */
  pageVisitsPerMonth?: number | null;
  /** Your link posts' average viewers from Insights; replaces the link-post audience benchmark. */
  linkPostViewers?: number | null;
  /** Measured (Connect Facebook) or typed engagement rate; omitted when unknown. */
  engagementRatePct?: number | null;
  /** Members who cancel per year (%). */
  yearlyCancelPct?: number;
};
export type FacebookInputsUsed = {
  followers: number;
  priceAed: number;
  linkPostsPerMonth: number;
  ctaReelsPerMonth: number;
  keywordDms: boolean;
  pageVisitsPerMonth: number | null;
  linkPostViewers: number | null;
  engagementRatePct: number | null;
  yearlyCancelPct: number;
};
/** The calculator's starting numbers (7,000 followers, as the follower calculator). */
export const DEFAULT_FACEBOOK_INPUTS: FacebookInputsUsed = {
  followers: 7000,
  priceAed: DEFAULT_FOLLOWER_INPUTS.priceAed,
  linkPostsPerMonth: 4,
  ctaReelsPerMonth: 4,
  keywordDms: true,
  pageVisitsPerMonth: null,
  linkPostViewers: null,
  engagementRatePct: null,
  yearlyCancelPct: DEFAULT_FOLLOWER_INPUTS.yearlyCancelPct,
};

export type FacebookScenarioEstimate = {
  scenario: FollowerScenario;
  /** People who see your link posts (one post's reach; the same people each post). */
  linkPostViewers: number;
  /** People one call-to-action Reel reaches (the largest tier figure). */
  reelViewers: number;
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
export type FacebookEstimate = {
  inputs: FacebookInputsUsed;
  tierIndex: number;
  engagementFactor: number;
  /** Your tier's engagement benchmark (%), which your own rate is compared with. */
  engagementBenchmarkPct: number;
  /** Monthly cancellation share (%) equal to the yearly rate. */
  monthlyCancelPct: number;
  scenarios: PerScenario<FacebookScenarioEstimate>;
  assumptionsVersion: string;
  /** Version of the follower model whose visit-to-paid rates were used. */
  paidAssumptionsVersion: string;
};

/** The inputs as the calculator uses them: defaults filled, then clamped. */
export function facebookInputsUsed(input: FacebookInputs): FacebookInputsUsed {
  const L = FACEBOOK_LIMITS,
    D = DEFAULT_FACEBOOK_INPUTS;
  const whole = (value: number | undefined, limits: readonly [number, number], fallback: number) =>
    Math.floor(clamp(value ?? fallback, limits));
  const followers = whole(input.followers, L.followers, 0);
  const viewers = optional(input.linkPostViewers, L.linkPostViewers);
  return {
    followers,
    priceAed: Math.round(clamp(input.priceAed, L.priceAed)),
    linkPostsPerMonth: whole(input.linkPostsPerMonth, L.linkPostsPerMonth, 0),
    ctaReelsPerMonth: whole(input.ctaReelsPerMonth, L.ctaReelsPerMonth, D.ctaReelsPerMonth),
    keywordDms: input.keywordDms ?? D.keywordDms,
    pageVisitsPerMonth: optional(input.pageVisitsPerMonth, L.pageVisitsPerMonth),
    // Link-post viewers are followers (the same people see each link post).
    linkPostViewers: viewers === null ? null : Math.min(viewers, followers),
    engagementRatePct:
      input.engagementRatePct === undefined ||
      input.engagementRatePct === null ||
      !Number.isFinite(input.engagementRatePct)
        ? null
        : clamp(input.engagementRatePct, L.engagementRatePct),
    // A missing or non-numeric rate is the default, not the lowest allowed.
    yearlyCancelPct: clamp(
      input.yearlyCancelPct !== undefined && Number.isFinite(input.yearlyCancelPct)
        ? input.yearlyCancelPct
        : D.yearlyCancelPct,
      L.yearlyCancelPct,
    ),
  };
}

/** The tier a Page's follower count falls in. */
export function facebookTierIndex(
  followers: number,
  model: FacebookModelAssumptions = DEFAULT_FACEBOOK_MODEL,
): number {
  return Math.max(
    0,
    model.tiers.findIndex((t) => t.upTo === null || followers <= t.upTo),
  );
}

/**
 * Tier boundaries never lower an audience: each channel reaches at least as
 * many people as it would for a Page at the top of each smaller tier. These
 * are the tiers j ≤ yours, each with min(followers, top of j).
 */
function tiersUpTo(
  model: FacebookModelAssumptions,
  followers: number,
): Array<[FacebookTier, number]> {
  const index = facebookTierIndex(followers, model);
  return model.tiers
    .slice(0, index + 1)
    .map((tier) => [tier, Math.min(followers, tier.upTo ?? Infinity)]);
}

/** The comment-keyword Reel channel with one follower-count tier's figures. */
type ReelReach = {
  /** People one call-to-action Reel reaches. */
  viewers: number;
  /** Chance that one viewer comments the keyword and opens the Messenger link. */
  perView: number;
};

/** First visits to your page in each month 1-12, for one scenario. */
function monthlyVisits(
  linkPostViewers: number,
  reel: ReelReach,
  rates: FacebookScenarioRates,
  i: FacebookInputsUsed,
): number[] {
  const renewal = rates.audienceRenewalPct / 100;
  const channels: Channel[] = [];
  if (i.linkPostsPerMonth > 0)
    channels.push({
      people: linkPostViewers,
      chance: visitChance(rates.linkClickPct, i.linkPostsPerMonth),
    });
  const reels = i.keywordDms && i.ctaReelsPerMonth > 0 && reel.viewers > 0;
  // Cautious: Reel viewers are people your link posts already reach, with
  // repeated chances. Otherwise each Reel reaches mostly new people (Meta:
  // over a third of Feed views are recommended posts from accounts people
  // don't follow), so every Reel's keyword commenters count afresh.
  if (reels && !rates.reelsReachNewPeople)
    channels.push({
      people: reel.viewers,
      chance: visitChance(reel.perView * 100, i.ctaReelsPerMonth),
    });
  const total = nestedVisits(channels, renewal);
  if (reels && rates.reelsReachNewPeople)
    addInto(
      total,
      new Array<number>(MONTHS).fill(
        reel.viewers * reel.perView * i.ctaReelsPerMonth,
      ),
    );
  if (i.pageVisitsPerMonth)
    addInto(
      total,
      groupVisits(i.pageVisitsPerMonth, rates.pageLinkClickPct / 100, renewal),
    );
  return total;
}

/**
 * Facebook Page follower-to-subscriber estimate for the three scenarios.
 * Pure; inputs are clamped. Visit to paid is the follower model's, so an
 * operator change to it moves this estimate too.
 *
 *   A_j   = min(followers, top of tier j)  for each tier j up to yours
 *   g     = your engagement / your tier's benchmark, within ×(1/max)..×max
 *           (1 if unknown)
 *   L     = link-post audience = max_j A_j × post reach_j × link share × g,
 *           or your own link-post viewers (at most your followers)
 *   R_j   = Reel viewers = A_j × post reach_j × Reel share
 *   k     = min(1, g × comments per Reel viewer × keyword factor)
 *           × Messenger open                 a Reel viewer's visit chance
 *   c     = 1 − (1 − rate)^times             a person's chance of a visit a month
 *   r     = audience renewal a month         share of each group new to your link
 *   f_1   = 1;  f_(m+1) = (1 − r)(1 − c) f_m + r      share not yet visited
 *   V_m   = Σ groups people × c × f_m       link posts nested (Reels too when
 *                                            cautious), Page visits
 *           + Reels a month × R_j × k        (typical, strong: new people each Reel)
 *   D(T)  = Σ_(m ≤ T) V_m, the most any tier j's Reel figures give
 *   N_m   = visit to paid × (D(m) − D(m − 1))      one decision per person
 *   A_m   = A_(m−1) × (1 − churn) + N_m      active in month m
 *   churn = 1 − (1 − yearly cancellations)^(1/12)
 */
export function estimateFacebookConversion(
  input: FacebookInputs,
  model: FacebookModelAssumptions = DEFAULT_FACEBOOK_MODEL,
  followerModel: FollowerModelAssumptions = DEFAULT_FOLLOWER_MODEL,
): FacebookEstimate {
  const i = facebookInputsUsed(input);
  const tierIndex = facebookTierIndex(i.followers, model);
  // Your rate is compared with the average for Pages your size, so a Page
  // with typical engagement for its size is not scaled (1 when unknown).
  const benchmark = model.tiers[tierIndex]?.engagementBenchmarkPct ?? 0;
  const max = model.engagementFactorMax;
  const engagement =
    i.engagementRatePct === null || !(benchmark > 0)
      ? 1
      : Math.min(max, Math.max(1 / max, i.engagementRatePct / benchmark));
  const churn = monthlyChurn(i.yearlyCancelPct);
  const tiers = tiersUpTo(model, i.followers);
  const run = (scenario: FollowerScenario): FacebookScenarioEstimate => {
    const rates = model.scenarios[scenario];
    // Your own link-post viewers replace the benchmark (and its engagement scaling).
    const linkPostViewers =
      i.linkPostViewers ??
      Math.max(
        0,
        ...tiers.map(([tier, audience]) =>
          Math.min(
            audience,
            (audience * tier.postReachPct * rates.linkPostRelativeReachPct * engagement) /
              10_000,
          ),
        ),
      );
    const perView =
      Math.min(
        1,
        (engagement * model.reelCommentsPerViewPct * model.keywordCommentFactor) / 100,
      ) *
      (rates.dmOpenPct / 100);
    const reels: ReelReach[] = tiers.map(([tier, audience]) => ({
      viewers: Math.min(
        audience,
        (audience * tier.postReachPct * rates.reelRelativeReachPct) / 10_000,
      ),
      perView,
    }));
    const paid = followerModel.scenarios[scenario].paidPct / 100;
    // Reel viewers come from one tier. Visitors by each month are the most
    // any tier's Reel figures give, so tier boundaries never lower visitors
    // or sign-ups by any month.
    const byMonth = (reels.length ? reels : [{ viewers: 0, perView: 0 }]).map(
      (reel) => cumulate(monthlyVisits(linkPostViewers, reel, rates, i)),
    );
    const upTo = byMonth[0].map((_, m) => Math.max(...byMonth.map((c) => c[m])));
    const visits = upTo.map((c, m) => c - (m ? upTo[m - 1] : 0));
    const newByMonth = visits.map((people) => paid * people);
    const activeByMonth: number[] = [];
    newByMonth.forEach((n, m) =>
      activeByMonth.push((m ? activeByMonth[m - 1] * (1 - churn) : 0) + n),
    );
    const activeMonth12 = activeByMonth[MONTHS - 1];
    return {
      scenario,
      linkPostViewers,
      reelViewers: Math.max(0, ...reels.map((reel) => reel.viewers)),
      visitors12: visits.reduce((sum, v) => sum + v, 0),
      newByMonth,
      activeByMonth,
      month1New: newByMonth[0],
      activeMonth12,
      signups12: newByMonth.reduce((sum, n) => sum + n, 0),
      // The same whole count the pages show ("fewer than 1" is none).
      revenueMonth12Minor: (displayCount(activeMonth12) ?? 0) * i.priceAed * 100,
    };
  };
  return {
    inputs: i,
    tierIndex,
    engagementFactor: engagement,
    engagementBenchmarkPct: benchmark,
    monthlyCancelPct: churn * 100,
    scenarios: {
      cautious: run("cautious"),
      typical: run("typical"),
      strong: run("strong"),
    },
    assumptionsVersion: model.version,
    paidAssumptionsVersion: followerModel.version,
  };
}

export type FacebookLeverId = "pageLink" | "keywordReels" | "moreLinkPosts";
export type FacebookLever = {
  id: FacebookLeverId;
  /** The one change made to your inputs. */
  change: Partial<FacebookInputs>;
  /** Differences against your current estimate, in the chosen scenario. */
  month1New: number;
  signups12: number;
  activeMonth12: number;
  revenueMonth12Minor: number;
};
/**
 * "What raises your number": the estimate re-run with one change at a time.
 * Page link: 1,000 more Page visits a month. Keyword Reels: turn the comment
 * keyword on for 4 Reels a month, or 4 more such Reels. Link posts: 4 more a
 * month. A change that would lower active subscribers at month 12 (the
 * headline) is left out.
 */
export function facebookLevers(
  input: FacebookInputs,
  model: FacebookModelAssumptions = DEFAULT_FACEBOOK_MODEL,
  followerModel: FollowerModelAssumptions = DEFAULT_FOLLOWER_MODEL,
  scenario: FollowerScenario = "strong",
): FacebookLever[] {
  const base = estimateFacebookConversion(input, model, followerModel);
  const i = base.inputs,
    now = base.scenarios[scenario];
  const cap = (n: number) => Math.min(60, n);
  const changes: Array<[FacebookLeverId, Partial<FacebookInputs>]> = [
    ["pageLink", { pageVisitsPerMonth: (i.pageVisitsPerMonth ?? 0) + 1000 }],
    [
      "keywordReels",
      i.keywordDms && i.ctaReelsPerMonth > 0
        ? { ctaReelsPerMonth: cap(i.ctaReelsPerMonth + 4) }
        : { keywordDms: true, ctaReelsPerMonth: Math.max(i.ctaReelsPerMonth, 4) },
    ],
    ["moreLinkPosts", { linkPostsPerMonth: cap(i.linkPostsPerMonth + 4) }],
  ];
  return changes
    .map(([id, change]) => {
      const next = estimateFacebookConversion({ ...i, ...change }, model, followerModel)
        .scenarios[scenario];
      return {
        id,
        change,
        month1New: next.month1New - now.month1New,
        signups12: next.signups12 - now.signups12,
        activeMonth12: next.activeMonth12 - now.activeMonth12,
        revenueMonth12Minor: next.revenueMonth12Minor - now.revenueMonth12Minor,
      };
    })
    .filter((lever) => lever.activeMonth12 >= -1e-9);
}

/**
 * Engagement rate (%) from recent Page posts, as Socialinsider measures it:
 * mean(reactions + comments + shares) / followers. A missing count is 0
 * (Meta leaves shares out when a post has none); null when unknown (no
 * followers or no posts).
 */
export function facebookEngagementRate(
  followers: number,
  posts: Array<{
    reactions?: number | null;
    comments?: number | null;
    shares?: number | null;
  }>,
): number | null {
  if (!Number.isFinite(followers) || followers <= 0 || !posts.length)
    return null;
  const count = (value: number | null | undefined) => Math.max(0, Number(value) || 0);
  const total = posts.reduce(
    (sum, p) => sum + count(p.reactions) + count(p.comments) + count(p.shares),
    0,
  );
  return Math.round((total / posts.length / followers) * 100 * 1000) / 1000;
}
