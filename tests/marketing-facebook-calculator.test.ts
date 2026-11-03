// Facebook Page calculator (assumptions 2026-11-03): the worked example at
// 7,000 followers, scenario order, tier boundaries and monotonicity in
// followers and in every lever, engagement against each tier's benchmark,
// the link-post, keyword Reel and Page-link channels, the visit to paid
// shared with the follower model, input limits, the levers, the engagement
// rate Connect Facebook measures, and the cited defaults and sources.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKETING_SOURCES } from "@trainer/contracts";
import {
  DEFAULT_FACEBOOK_INPUTS,
  DEFAULT_FACEBOOK_MODEL,
  FACEBOOK_LIMITS,
  FACEBOOK_RATE_KEYS,
  estimateFacebookConversion,
  facebookEngagementRate,
  facebookInputsUsed,
  facebookLevers,
  facebookTierIndex,
  type FacebookEstimate,
  type FacebookInputs,
  type FacebookLeverId,
  type FacebookModelAssumptions,
  type FacebookScenarioEstimate,
  type FacebookScenarioRates,
} from "../packages/domain/src/facebook-calculator.ts";
import {
  DEFAULT_FOLLOWER_INPUTS,
  DEFAULT_FOLLOWER_MODEL,
  FOLLOWER_LIMITS,
  FOLLOWER_MODEL_SETTING_KEYS,
  FOLLOWER_SCENARIOS,
  displayCount,
  engagementRate,
  estimateFollowerConversion,
  followerModelFromSettings,
  monthlyChurn,
  visitChance,
  type FollowerModelAssumptions,
} from "../packages/domain/src/marketing-calculators.ts";

const near = (actual: number, expected: number, tolerance = 0.05, what = "") =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what} expected ${expected} ± ${tolerance}, got ${actual}`,
  );
const at = (followers: number, extra: Partial<FacebookInputs> = {}): FacebookEstimate =>
  estimateFacebookConversion({ ...DEFAULT_FACEBOOK_INPUTS, followers, ...extra });
/** First visits over 12 months from a renewing group (the model's recursion). */
const groupTotal = (people: number, chance: number, renewal: number) => {
  let fresh = 1,
    total = 0;
  for (let m = 0; m < 12; m++) {
    total += people * chance * fresh;
    fresh = (1 - renewal) * (1 - chance) * fresh + renewal;
  }
  return total;
};
/** The default model with some rates changed in every scenario. */
const withRates = (change: Partial<FacebookScenarioRates>): FacebookModelAssumptions["scenarios"] => ({
  cautious: { ...DEFAULT_FACEBOOK_MODEL.scenarios.cautious, ...change },
  typical: { ...DEFAULT_FACEBOOK_MODEL.scenarios.typical, ...change },
  strong: { ...DEFAULT_FACEBOOK_MODEL.scenarios.strong, ...change },
});
const METRICS = [
  "linkPostViewers",
  "reelViewers",
  "visitors12",
  "month1New",
  "signups12",
  "activeMonth12",
] as const;

test("worked example: 7,000 followers at the defaults, strong about 5 active subscribers at month 12", () => {
  // AED 199, 4 link posts and 4 keyword Reels a month, engagement unknown,
  // 30% cancellations a year. 7,000 followers sit in the 5-10K tier (3.40%
  // post reach); the 1-5K tier at its top (5,000 × 4.35%) is smaller.
  const e = at(7000);
  assert.equal(e.assumptionsVersion, "2026-11-03");
  assert.equal(e.paidAssumptionsVersion, DEFAULT_FOLLOWER_MODEL.version);
  assert.equal(e.tierIndex, 1);
  assert.equal(e.engagementFactor, 1);
  assert.equal(e.engagementBenchmarkPct, 0.21);
  near(e.monthlyCancelPct, monthlyChurn(30) * 100, 1e-12);
  // Link-post audience: 7,000 × 3.40% × 25.64% = 61.02 beats 5,000 × 4.35% ×
  // 25.64% = 55.77 (cautious × 16.67%: 39.67 against 36.26). One Reel
  // reaches 7,000 × 3.40% × 70.51% = 167.81 (cautious × 45.83%: 109.08).
  const { cautious, typical, strong } = e.scenarios;
  near(strong.linkPostViewers, 7000 * 0.034 * 0.2564, 1e-9);
  near(typical.linkPostViewers, 7000 * 0.034 * 0.2564, 1e-9);
  near(cautious.linkPostViewers, 7000 * 0.034 * 0.1667, 1e-9);
  near(strong.reelViewers, 7000 * 0.034 * 0.7051, 1e-9);
  near(cautious.reelViewers, 7000 * 0.034 * 0.4583, 1e-9);
  // Strong, month 1: a follower who sees the link posts opens one of the 4
  // with c = 1 − 0.972^4 = 10.74%; a Reel viewer comments the keyword and
  // opens the Messenger link with k = 0.46% × 2.0278 × 45% = 0.42%, and each
  // of the 4 Reels reaches new people: 6.55 + 2.82 = 9.37 visits × 6.2% paid.
  const c = visitChance(2.8, 4),
    k = ((0.46 * 2.0278) / 100) * 0.45;
  near(c, 1 - 0.972 ** 4, 1e-12);
  const visits1 = 7000 * 0.034 * 0.2564 * c + 4 * 7000 * 0.034 * 0.7051 * k;
  near(visits1, 9.3705, 1e-4);
  near(strong.month1New, visits1 * 0.062, 1e-12);
  // The exact results: [month 1, active at month 12, sign-ups over 12 months,
  // visitors over 12 months, AED a month at month 12]. The research rounded
  // them to 0.02 / 0.14 / 0.16 (cautious), 0.22 / 1.62 / 1.94 (typical) and
  // 0.58 / 4.56 / 5.42 (strong). Strong renews 8% of its audiences a month,
  // so month 12 still brings 0.38 new subscribers.
  const expected: Record<string, [number, number, number, number, number]> = {
    cautious: [0.016442, 0.136242, 0.161711, 22.459824, 0],
    typical: [0.224915, 1.622956, 1.941017, 66.931632, 398],
    strong: [0.58097, 4.561602, 5.415243, 87.342628, 995],
  };
  for (const s of FOLLOWER_SCENARIOS) {
    const r = e.scenarios[s],
      [m1, a12, s12, v12, aed] = expected[s];
    near(r.month1New, m1, 1e-6, `${s} month 1`);
    near(r.activeMonth12, a12, 1e-6, `${s} active`);
    near(r.signups12, s12, 1e-6, `${s} sign-ups`);
    near(r.visitors12, v12, 1e-6, `${s} visitors`);
    assert.equal(r.revenueMonth12Minor, aed * 100, `${s} AED`);
    assert.equal(r.newByMonth.length, 12);
    assert.equal(r.activeByMonth.length, 12);
    // Active subscribers still grow at month 12 in every scenario.
    for (let m = 1; m < 12; m++) assert.ok(r.activeByMonth[m] > r.activeByMonth[m - 1], `${s} month ${m + 1}`);
  }
  near(strong.newByMonth[11], 0.3822, 1e-4);
  // Strong: 4.56 active rounds to 5, so the page says about 5 (5 × AED 199 = 995).
  assert.equal(displayCount(strong.activeMonth12), 5);
  assert.equal(displayCount(cautious.activeMonth12), null);
  // Far below Instagram at the same follower count (about 116): an organic
  // link post reaches under 1% of a Page's followers (3.40% × 25.64%),
  // against a 20.5% Story audience on Instagram.
  const instagram = estimateFollowerConversion({ ...DEFAULT_FOLLOWER_INPUTS, followers: 7000 }).scenarios.strong;
  near(instagram.activeMonth12, 116.4, 0.05);
  assert.ok(strong.activeMonth12 < instagram.activeMonth12 / 20);
  // The strong case at month 12 by Page size, as the research states.
  for (const [followers, active] of [
    [1000, 0.834],
    [3000, 2.501],
    [10_000, 6.517],
    [20_000, 10.35],
    [50_000, 25.875],
    [100_000, 28.75],
  ])
    near(at(followers).scenarios.strong.activeMonth12, active, 0.001, `${followers}`);
  // The strong first month is below 1 for Pages up to 15,172 followers.
  assert.ok(at(15_172).scenarios.strong.month1New < 1);
  assert.ok(at(15_173).scenarios.strong.month1New >= 1);
});

test("scenarios are ordered: cautious ≤ typical ≤ strong, and nothing exceeds its audience", () => {
  for (const followers of [0, 50, 999, 3000, 5000, 5001, 7000, 10_001, 20_000, 80_000, 150_000, 2_000_000])
    for (const extra of [
      {},
      { ctaReelsPerMonth: 0 },
      { linkPostsPerMonth: 0 },
      { linkPostsPerMonth: 60 },
      { keywordDms: false },
      { pageVisitsPerMonth: 2000 },
      { engagementRatePct: 3, linkPostViewers: 900 },
      { engagementRatePct: 3 },
      { engagementRatePct: 0.05, ctaReelsPerMonth: 60 },
      { yearlyCancelPct: 80 },
      { linkPostsPerMonth: 60, ctaReelsPerMonth: 60, yearlyCancelPct: 80 },
    ] as Array<Partial<FacebookInputs>>) {
      const e = at(followers, extra);
      const where = `${followers} ${JSON.stringify(extra)}`;
      for (const key of METRICS) {
        const { cautious, typical, strong } = e.scenarios;
        assert.ok(
          cautious[key] <= typical[key] + 1e-9 && typical[key] <= strong[key] + 1e-9,
          `${key} at ${where}: ${cautious[key]} / ${typical[key]} / ${strong[key]}`,
        );
      }
      for (const s of FOLLOWER_SCENARIOS) {
        const r = e.scenarios[s];
        assert.ok(r.newByMonth.every((n) => n >= 0), where);
        // One decision per person: sign-ups are visitors × visit to paid.
        near(r.signups12, r.visitors12 * (DEFAULT_FOLLOWER_MODEL.scenarios[s].paidPct / 100), 1e-9, where);
        assert.ok(r.linkPostViewers <= e.inputs.followers + 1e-9, where);
        assert.ok(r.reelViewers <= e.inputs.followers + 1e-9, where);
        assert.ok(r.activeMonth12 <= r.signups12 + 1e-9 && r.month1New <= r.signups12 + 1e-9, where);
      }
    }
});

test("tier boundaries never lower anything: monotone in followers from 0 to 1,000,000", () => {
  for (const boundary of [5000, 10000, 50000, 100000])
    for (const extra of [{}, { engagementRatePct: 0.2 }, { pageVisitsPerMonth: 1000 }]) {
      const below = at(boundary, extra),
        above = at(boundary + 1, extra);
      assert.equal(above.tierIndex, below.tierIndex + 1);
      for (const s of FOLLOWER_SCENARIOS)
        for (const key of METRICS)
          assert.ok(
            above.scenarios[s][key] >= below.scenarios[s][key] - 1e-9,
            `${s} ${key} falls at ${boundary} ${JSON.stringify(extra)}: ${below.scenarios[s][key]} → ${above.scenarios[s][key]}`,
          );
    }
  const followers: number[] = [];
  for (let f = 0; f <= 1_000_000; f = Math.ceil(f * 1.02) + 1) followers.push(f);
  // Fine steps around each boundary, where a smaller tier's figures still lead.
  for (const b of [5000, 10000, 50000, 100000]) for (let f = b - 300; f <= b + 2000; f += 7) followers.push(f);
  followers.sort((a, b) => a - b);
  const variants: Array<[string, Partial<FacebookInputs>]> = [
    ["defaults", {}],
    ["link posts only", { ctaReelsPerMonth: 0 }],
    ["keyword off", { keywordDms: false }],
    ["Reels only", { linkPostsPerMonth: 0 }],
    // A known rate: the benchmark falls with Page size, so g only rises.
    ["engaged", { engagementRatePct: 2 }],
    ["quiet", { engagementRatePct: 0.05 }],
    ["0.2% engagement", { engagementRatePct: 0.2 }],
    ["own link-post viewers", { linkPostViewers: 300 }],
    ["Page visits", { pageVisitsPerMonth: 1000 }],
    ["60 link posts, high cancellations", { linkPostsPerMonth: 60, yearlyCancelPct: 80 }],
    ["60 Reels only, high cancellations", { linkPostsPerMonth: 0, ctaReelsPerMonth: 60, yearlyCancelPct: 80 }],
    ["engaged, 60 Reels, high cancellations", { ctaReelsPerMonth: 60, yearlyCancelPct: 80, engagementRatePct: 3 }],
  ];
  for (const [name, extra] of variants) {
    let previous: FacebookEstimate | null = null;
    for (const f of followers) {
      const e = at(f, extra);
      if (previous)
        for (const s of FOLLOWER_SCENARIOS) {
          const now = e.scenarios[s],
            before: FacebookScenarioEstimate = previous.scenarios[s];
          const where = `${name}, ${s}, ${f} followers`;
          // Every channel's figure is the most any tier up to yours gives, and
          // the same Reel figures lead in every month, so even the cautious
          // month-12 count never falls (no slack needed, unlike Instagram).
          for (const key of METRICS) assert.ok(now[key] >= before[key] - 1e-9, `${key}: ${where}`);
          let cumulative = 0,
            previousCumulative = 0;
          for (let m = 0; m < 12; m++) {
            cumulative += now.newByMonth[m];
            previousCumulative += before.newByMonth[m];
            assert.ok(cumulative >= previousCumulative - 1e-9, `month ${m + 1}: ${where}`);
          }
        }
      previous = e;
    }
  }
});

test("monotone in every lever: more sharing, engagement, viewers or visits never lower the headline", () => {
  const sweeps: Array<[string, (v: number) => Partial<FacebookInputs>, number[]]> = [
    ["link posts", (v) => ({ linkPostsPerMonth: v }), Array.from({ length: 61 }, (_, i) => i)],
    ["keyword Reels", (v) => ({ ctaReelsPerMonth: v }), Array.from({ length: 61 }, (_, i) => i)],
    ["engagement", (v) => ({ engagementRatePct: v }), Array.from({ length: 101 }, (_, i) => i * 0.01)],
    ["own link-post viewers", (v) => ({ linkPostViewers: v }), Array.from({ length: 71 }, (_, i) => i * 100)],
    ["Page visits", (v) => ({ pageVisitsPerMonth: v }), [0, 100, 500, 1000, 5000, 20000]],
  ];
  for (const yearlyCancelPct of [5, 30, 50, 80])
    for (const followers of [1000, 5000, 7000, 20_000, 150_000])
      for (const [name, make, values] of sweeps) {
        let previous: FacebookEstimate | null = null;
        for (const v of values) {
          const e = at(followers, { yearlyCancelPct, ...make(v) });
          if (previous)
            for (const s of FOLLOWER_SCENARIOS) {
              const now = e.scenarios[s],
                before: FacebookScenarioEstimate = previous.scenarios[s];
              const where = `${name} ${v}, ${s}, ${followers} followers, ${yearlyCancelPct}%`;
              assert.ok(now.signups12 >= before.signups12 - 1e-9, `sign-ups: ${where}`);
              // Strong renews its audience faster than people cancel, so it never
              // falls; typical (1.5% renewal) never falls up to the 30% default.
              // Cautious keeps the same people all year, and typical renews more
              // slowly than 50-80% cancellations: more link posts bring sign-ups
              // sooner, and sooner sign-ups have longer to cancel, so one step
              // can lower their month-12 count, by under 1%.
              if (s === "strong" || (s === "typical" && yearlyCancelPct <= 30)) {
                assert.ok(now.activeMonth12 >= before.activeMonth12 - 1e-9, `active: ${where}`);
                assert.ok(now.revenueMonth12Minor >= before.revenueMonth12Minor, `AED: ${where}`);
              } else assert.ok(now.activeMonth12 >= before.activeMonth12 * 0.99 - 1e-9, `active: ${where}`);
            }
          previous = e;
        }
      }
});

test("engagement: g = 1 at each tier's benchmark, within ×0.5 to ×2, scaling link posts and keyword comments", () => {
  const benchmarks = DEFAULT_FACEBOOK_MODEL.tiers.map((t) => t.engagementBenchmarkPct);
  assert.deepEqual(benchmarks, [0.25, 0.21, 0.17, 0.15, 0.125]);
  // The research's points (2,000 / 7,000 / 30,000 / 75,000 / 300,000) and
  // each tier's first and last follower count.
  const samples: Array<[number, number]> = [
    [0, 0], [1, 0], [2000, 0], [5000, 0],
    [5001, 1], [7000, 1], [10_000, 1],
    [10_001, 2], [30_000, 2], [50_000, 2],
    [50_001, 3], [75_000, 3], [100_000, 3],
    [100_001, 4], [300_000, 4], [10_000_000, 4],
  ];
  for (const [followers, tier] of samples) {
    const benchmark = benchmarks[tier];
    const e = at(followers, { engagementRatePct: benchmark });
    assert.equal(e.tierIndex, tier, `${followers}`);
    assert.equal(facebookTierIndex(followers), tier, `${followers}`);
    assert.equal(e.engagementBenchmarkPct, benchmark, `${followers}`);
    assert.equal(e.engagementFactor, 1, `${followers}`);
    // A Page with typical engagement for its size gets the unknown-rate estimate.
    assert.deepEqual(e.scenarios, at(followers).scenarios, `${followers}`);
    const g = (engagementRatePct: number) => at(followers, { engagementRatePct }).engagementFactor;
    assert.equal(g(benchmark * 2), 2);
    assert.equal(g(benchmark * 10), 2);
    assert.equal(g(100), 2);
    assert.equal(g(benchmark / 2), 0.5);
    assert.equal(g(benchmark / 10), 0.5);
    assert.equal(g(0), 0.5);
    near(g(benchmark * 1.5), 1.5, 1e-12);
    near(g(benchmark * 0.75), 0.75, 1e-12);
  }
  for (const engagementRatePct of [null, undefined, NaN, Infinity])
    assert.equal(at(7000, { engagementRatePct }).engagementFactor, 1, String(engagementRatePct));
  // g scales the link-post audience and the keyword rate, not Reel reach. In
  // the typical and strong cases both channels scale alike, so ×2 engagement
  // doubles the whole estimate.
  const base = at(7000),
    doubled = at(7000, { engagementRatePct: 0.42 });
  assert.equal(doubled.engagementFactor, 2);
  for (const s of FOLLOWER_SCENARIOS) {
    near(doubled.scenarios[s].linkPostViewers, base.scenarios[s].linkPostViewers * 2, 1e-9, s);
    assert.equal(doubled.scenarios[s].reelViewers, base.scenarios[s].reelViewers, s);
  }
  for (const s of ["typical", "strong"] as const) {
    near(doubled.scenarios[s].month1New, base.scenarios[s].month1New * 2, 1e-12, s);
    near(doubled.scenarios[s].activeMonth12, base.scenarios[s].activeMonth12 * 2, 1e-12, s);
  }
  // The cap is the model's: ×3 when the model allows it.
  const wider = estimateFacebookConversion(
    { ...DEFAULT_FACEBOOK_INPUTS, engagementRatePct: 5 },
    { ...DEFAULT_FACEBOOK_MODEL, engagementFactorMax: 3 },
  );
  assert.equal(wider.engagementFactor, 3);
  near(
    estimateFacebookConversion(
      { ...DEFAULT_FACEBOOK_INPUTS, engagementRatePct: 0.01 },
      { ...DEFAULT_FACEBOOK_MODEL, engagementFactorMax: 3 },
    ).engagementFactor,
    1 / 3,
    1e-12,
  );
});

test("link-post audience: your own viewers replace the benchmark in every scenario, capped at followers", () => {
  const own = at(7000, { linkPostViewers: 300 });
  for (const s of FOLLOWER_SCENARIOS) assert.equal(own.scenarios[s].linkPostViewers, 300, s);
  // Engagement no longer scales it (it is your measured audience).
  const ownEngaged = at(7000, { linkPostViewers: 300, engagementRatePct: 0.42 });
  for (const s of FOLLOWER_SCENARIOS) assert.equal(ownEngaged.scenarios[s].linkPostViewers, 300, s);
  // Capped at followers: the same people see each link post, and they follow you.
  const capped = at(700, { linkPostViewers: 5000 });
  assert.equal(capped.inputs.linkPostViewers, 700);
  for (const s of FOLLOWER_SCENARIOS) assert.equal(capped.scenarios[s].linkPostViewers, 700, s);
  assert.equal(facebookInputsUsed({ followers: 0, priceAed: 199, linkPostsPerMonth: 4, linkPostViewers: 50 }).linkPostViewers, 0);
  // Zero viewers entered is a measured zero, not unknown: no link-post visits.
  const noViewers = at(7000, { linkPostViewers: 0, ctaReelsPerMonth: 0 });
  for (const s of FOLLOWER_SCENARIOS) assert.equal(noViewers.scenarios[s].signups12, 0, s);
  // The benchmark never exceeds followers either, even at 100% reach and ×2 engagement.
  const saturated: FacebookModelAssumptions = {
    ...DEFAULT_FACEBOOK_MODEL,
    tiers: [{ upTo: null, postReachPct: 100, engagementBenchmarkPct: 0.1 }],
    scenarios: withRates({ linkPostRelativeReachPct: 100, reelRelativeReachPct: 100 }),
  };
  const full = estimateFacebookConversion({ ...DEFAULT_FACEBOOK_INPUTS, followers: 900, engagementRatePct: 1 }, saturated);
  assert.equal(full.engagementFactor, 2);
  for (const s of FOLLOWER_SCENARIOS) {
    assert.equal(full.scenarios[s].linkPostViewers, 900, s);
    assert.equal(full.scenarios[s].reelViewers, 900, s);
  }
  // Repeat link posts reach the same people: with no new people (cautious)
  // and no Reels, 60 link posts a month for a year reach at most the audience.
  const daily = at(7000, { linkPostsPerMonth: 60, ctaReelsPerMonth: 0 }).scenarios.cautious;
  near(daily.visitors12, daily.linkPostViewers * (1 - 0.99 ** (60 * 12)), 1e-9);
  assert.ok(daily.visitors12 <= daily.linkPostViewers);
  // One person decides once: with every link opened and every visitor paying,
  // sign-ups equal the audience; with renewal only the people new to the link
  // each month (8% of the audience) add to it.
  const saturate = (audienceRenewalPct: number) =>
    estimateFacebookConversion(
      { followers: 3, priceAed: 100, linkPostsPerMonth: 60, ctaReelsPerMonth: 0 },
      { ...saturated, scenarios: withRates({ linkPostRelativeReachPct: 100, linkClickPct: 100, audienceRenewalPct }) },
      {
        ...DEFAULT_FOLLOWER_MODEL,
        scenarios: { ...DEFAULT_FOLLOWER_MODEL.scenarios, strong: { ...DEFAULT_FOLLOWER_MODEL.scenarios.strong, paidPct: 100 } },
      },
    ).scenarios.strong;
  assert.equal(saturate(0).month1New, 3);
  assert.equal(saturate(0).signups12, 3);
  assert.equal(saturate(8).month1New, 3);
  near(saturate(8).signups12, 3 * (1 + 11 * 0.08), 1e-9);
  for (let m = 1; m < 12; m++) near(saturate(8).newByMonth[m], 3 * 0.08, 1e-9);
});

test("channels: the keyword sends the link by Messenger, and the Page link counts only with Page visits", () => {
  // Keyword off removes the Reel channel: the same as no Reels at all.
  for (const followers of [3000, 7000, 60_000])
    for (const s of FOLLOWER_SCENARIOS) {
      const off = at(followers, { keywordDms: false }).scenarios[s],
        noReels = at(followers, { ctaReelsPerMonth: 0 }).scenarios[s],
        on = at(followers).scenarios[s];
      const where = `${followers} ${s}`;
      assert.deepEqual(off.newByMonth, noReels.newByMonth, where);
      assert.deepEqual(off.activeByMonth, noReels.activeByMonth, where);
      assert.ok(on.signups12 > off.signups12, where);
    }
  for (const s of FOLLOWER_SCENARIOS) {
    assert.equal(at(7000, { linkPostsPerMonth: 0, keywordDms: false }).scenarios[s].signups12, 0, s);
    assert.equal(at(7000, { linkPostsPerMonth: 0, ctaReelsPerMonth: 0 }).scenarios[s].signups12, 0, s);
  }
  // Reels alone (typical and strong: new people each Reel): Reels × viewers ×
  // keyword visit chance every month, × visit to paid.
  const reelsOnly = at(7000, { linkPostsPerMonth: 0 }).scenarios.strong;
  const k = ((0.46 * 2.0278) / 100) * 0.45;
  for (let m = 0; m < 12; m++) near(reelsOnly.newByMonth[m], 4 * 7000 * 0.034 * 0.7051 * k * 0.062, 1e-12);
  // Cautious nests Reel viewers with the link-post audience: the people both
  // reach visit with 1 − (1 − c_link)(1 − c_reel), the rest by Reels alone.
  const cautious = at(7000).scenarios.cautious;
  const cLink = visitChance(1, 4),
    cReel = visitChance(((0.46 * 2.0278) / 100) * 0.18 * 100, 4),
    both = 7000 * 0.034 * 0.1667,
    reelOnly = 7000 * 0.034 * 0.4583 - both;
  near(cautious.month1New, (both * (1 - (1 - cLink) * (1 - cReel)) + reelOnly * cReel) * 0.0072, 1e-12);
  // Page visits turn on the Page-link channel: 1,000 visits a month × 3%
  // (strong) × 6.2% in month 1, renewing like every audience.
  const base = at(7000).scenarios,
    page = at(7000, { pageVisitsPerMonth: 1000 }).scenarios;
  near(page.strong.month1New - base.strong.month1New, 1000 * 0.03 * 0.062, 1e-9);
  near(page.strong.signups12 - base.strong.signups12, groupTotal(1000, 0.03, 0.08) * 0.062, 1e-9);
  near(page.typical.signups12 - base.typical.signups12, groupTotal(1000, 0.02, 0.015) * 0.029, 1e-9);
  near(page.cautious.signups12 - base.cautious.signups12, 1000 * (1 - 0.99 ** 12) * 0.0072, 1e-9);
  // No visits entered (blank, zero or not a number): no Page-link channel.
  for (const pageVisitsPerMonth of [null, undefined, 0, NaN])
    assert.deepEqual(at(7000, { pageVisitsPerMonth }).scenarios, base, String(pageVisitsPerMonth));
  // With the keyword off and no link posts, only the Page visits entered count.
  const pageOnly = at(7000, { linkPostsPerMonth: 0, keywordDms: false, pageVisitsPerMonth: 1000 }).scenarios.strong;
  near(pageOnly.signups12, groupTotal(1000, 0.03, 0.08) * 0.062, 1e-9);
});

test("visit to paid comes from the follower model: an operator change moves both calculators", () => {
  const strongPaid = (paidPct: number): FollowerModelAssumptions => ({
    ...DEFAULT_FOLLOWER_MODEL,
    version: "operator-test",
    scenarios: {
      ...DEFAULT_FOLLOWER_MODEL.scenarios,
      strong: { ...DEFAULT_FOLLOWER_MODEL.scenarios.strong, paidPct },
    },
  });
  const base = at(7000),
    doubled = estimateFacebookConversion(DEFAULT_FACEBOOK_INPUTS, DEFAULT_FACEBOOK_MODEL, strongPaid(12.4));
  assert.equal(doubled.paidAssumptionsVersion, "operator-test");
  assert.equal(doubled.assumptionsVersion, "2026-11-03");
  const b = base.scenarios.strong,
    d = doubled.scenarios.strong;
  near(d.visitors12, b.visitors12, 1e-12);
  near(d.month1New, b.month1New * 2, 1e-12);
  near(d.signups12, b.signups12 * 2, 1e-12);
  near(d.activeMonth12, b.activeMonth12 * 2, 1e-12);
  assert.deepEqual(doubled.scenarios.cautious, base.scenarios.cautious);
  assert.deepEqual(doubled.scenarios.typical, base.scenarios.typical);
  // Through the Super admin settings ("Marketing estimates").
  const settings = followerModelFromSettings({
    [FOLLOWER_MODEL_SETTING_KEYS.rates.paidPct.strong]: "3.1",
    [FOLLOWER_MODEL_SETTING_KEYS.changeNote]: "Own trial data",
  });
  assert.equal(settings.scenarios.strong.paidPct, 3.1);
  near(
    estimateFacebookConversion(DEFAULT_FACEBOOK_INPUTS, DEFAULT_FACEBOOK_MODEL, settings).scenarios.strong.signups12,
    b.signups12 / 2,
    1e-12,
  );
  // The levers follow it too.
  const pageLink = (model: FollowerModelAssumptions) =>
    facebookLevers(DEFAULT_FACEBOOK_INPUTS, DEFAULT_FACEBOOK_MODEL, model).find((l) => l.id === "pageLink")!;
  near(pageLink(strongPaid(12.4)).signups12, pageLink(DEFAULT_FOLLOWER_MODEL).signups12 * 2, 1e-12);
  // Only visit to paid is read: the follower model's Instagram figures do not
  // move the Facebook estimate.
  const instagramOnly: FollowerModelAssumptions = {
    ...DEFAULT_FOLLOWER_MODEL,
    version: "instagram-only",
    tiers: DEFAULT_FOLLOWER_MODEL.tiers.map((tier) => ({
      ...tier,
      storyPct: { cautious: 50, typical: 60, strong: 70 },
      reelPct: { cautious: 50, typical: 60, strong: 70 },
      commentsPerViewPct: 9,
    })),
    scenarios: {
      cautious: { ...DEFAULT_FOLLOWER_MODEL.scenarios.cautious, linkClickPct: 40, dmOpenPct: 80, bioClickPct: 40, audienceRenewalPct: 20 },
      typical: { ...DEFAULT_FOLLOWER_MODEL.scenarios.typical, linkClickPct: 40, dmOpenPct: 80, bioClickPct: 40, audienceRenewalPct: 20 },
      strong: { ...DEFAULT_FOLLOWER_MODEL.scenarios.strong, linkClickPct: 40, dmOpenPct: 80, bioClickPct: 40, audienceRenewalPct: 20 },
    },
    keywordCommentFactor: 9,
    engagementBenchmarkPct: 5,
    engagementFactorMax: 9,
  };
  for (const input of [DEFAULT_FACEBOOK_INPUTS, { ...DEFAULT_FACEBOOK_INPUTS, engagementRatePct: 2.1, pageVisitsPerMonth: 800 }]) {
    const own = estimateFacebookConversion(input, DEFAULT_FACEBOOK_MODEL, instagramOnly),
      cited = estimateFacebookConversion(input);
    assert.deepEqual(own.scenarios, cited.scenarios);
    assert.equal(own.engagementFactor, cited.engagementFactor);
  }
});

test("inputs: limits clamp and floor, defaults fill the gaps, zero gives zero", () => {
  // The price and cancellations are the follower calculator's inputs.
  assert.deepEqual(FACEBOOK_LIMITS.priceAed, FOLLOWER_LIMITS.priceAed);
  assert.deepEqual(FACEBOOK_LIMITS.yearlyCancelPct, FOLLOWER_LIMITS.yearlyCancelPct);
  assert.equal(DEFAULT_FACEBOOK_INPUTS.priceAed, DEFAULT_FOLLOWER_INPUTS.priceAed);
  assert.equal(DEFAULT_FACEBOOK_INPUTS.yearlyCancelPct, DEFAULT_FOLLOWER_INPUTS.yearlyCancelPct);
  // Below the limits: the lowest allowed.
  assert.deepEqual(
    facebookInputsUsed({
      followers: -50,
      priceAed: -3,
      linkPostsPerMonth: -1,
      ctaReelsPerMonth: -2,
      pageVisitsPerMonth: -5,
      linkPostViewers: -9,
      engagementRatePct: -1,
      yearlyCancelPct: 1,
    }),
    {
      followers: 0,
      priceAed: 1,
      linkPostsPerMonth: 0,
      ctaReelsPerMonth: 0,
      keywordDms: true,
      pageVisitsPerMonth: 0,
      linkPostViewers: 0,
      engagementRatePct: 0,
      yearlyCancelPct: 5,
    },
  );
  // Above them: the highest allowed.
  assert.deepEqual(
    facebookInputsUsed({
      followers: 2e7,
      priceAed: 99_999,
      linkPostsPerMonth: 100,
      ctaReelsPerMonth: 61,
      pageVisitsPerMonth: 2e7,
      linkPostViewers: 2e7,
      engagementRatePct: 250,
      yearlyCancelPct: 99,
    }),
    {
      followers: 10_000_000,
      priceAed: 10_000,
      linkPostsPerMonth: 60,
      ctaReelsPerMonth: 60,
      keywordDms: true,
      pageVisitsPerMonth: 10_000_000,
      linkPostViewers: 10_000_000,
      engagementRatePct: 100,
      yearlyCancelPct: 80,
    },
  );
  // Counts are floored and the price rounded; rates keep their decimals.
  assert.deepEqual(
    facebookInputsUsed({
      followers: 7000.9,
      priceAed: 199.6,
      linkPostsPerMonth: 4.7,
      ctaReelsPerMonth: 2.9,
      keywordDms: false,
      pageVisitsPerMonth: 1234.8,
      linkPostViewers: 300.6,
      engagementRatePct: 0.123,
      yearlyCancelPct: 33.3,
    }),
    {
      followers: 7000,
      priceAed: 200,
      linkPostsPerMonth: 4,
      ctaReelsPerMonth: 2,
      keywordDms: false,
      pageVisitsPerMonth: 1234,
      linkPostViewers: 300,
      engagementRatePct: 0.123,
      yearlyCancelPct: 33.3,
    },
  );
  // Missing optional inputs: 4 keyword Reels, 30% cancellations and no own numbers.
  assert.deepEqual(facebookInputsUsed({ followers: 7000, priceAed: 199, linkPostsPerMonth: 4 }), DEFAULT_FACEBOOK_INPUTS);
  // A missing or non-numeric cancellation rate is the 30% default, not the lowest allowed.
  for (const yearlyCancelPct of [NaN, Infinity, undefined]) {
    const e = at(7000, { yearlyCancelPct });
    assert.equal(e.inputs.yearlyCancelPct, 30, String(yearlyCancelPct));
    assert.deepEqual(e.scenarios, at(7000).scenarios);
  }
  // Own numbers that are blank or not a number are unknown, not zero.
  for (const value of [null, undefined, NaN, Infinity]) {
    const used = facebookInputsUsed({
      followers: 7000,
      priceAed: 199,
      linkPostsPerMonth: 4,
      pageVisitsPerMonth: value,
      linkPostViewers: value,
      engagementRatePct: value,
    });
    assert.equal(used.pageVisitsPerMonth, null, String(value));
    assert.equal(used.linkPostViewers, null, String(value));
    assert.equal(used.engagementRatePct, null, String(value));
  }
  assert.equal(facebookInputsUsed({ followers: NaN, priceAed: 199, linkPostsPerMonth: 4 }).followers, 0);
  // More cancellations: fewer active, the same sign-ups.
  const low = at(7000, { yearlyCancelPct: 10 }).scenarios.strong,
    high = at(7000, { yearlyCancelPct: 60 }).scenarios.strong;
  assert.ok(low.activeMonth12 > high.activeMonth12);
  near(low.signups12, high.signups12, 1e-12);
  near(at(7000, { yearlyCancelPct: 60 }).monthlyCancelPct, monthlyChurn(60) * 100, 1e-12);
  // No followers, or nothing shared: nobody in any scenario.
  const zero = estimateFacebookConversion({ followers: -50, priceAed: -3, linkPostsPerMonth: 60, ctaReelsPerMonth: 60 });
  assert.equal(zero.inputs.followers, 0);
  for (const s of FOLLOWER_SCENARIOS) {
    const r = zero.scenarios[s];
    for (const key of METRICS) assert.equal(r[key], 0, `${s} ${key}`);
    assert.equal(r.revenueMonth12Minor, 0);
  }
  // The monthly amount uses the whole count the pages show: below 1 active
  // subscriber the page says "fewer than 1" and AED 0.
  for (const followers of [500, 1000, 1300, 3000, 7000, 40_000])
    for (const s of FOLLOWER_SCENARIOS) {
      const r = at(followers).scenarios[s];
      assert.equal(r.revenueMonth12Minor, (displayCount(r.activeMonth12) ?? 0) * 199 * 100, `${followers} ${s}`);
    }
  const fraction = at(1000).scenarios.strong;
  assert.ok(fraction.activeMonth12 >= 0.5 && fraction.activeMonth12 < 1, `${fraction.activeMonth12}`);
  assert.equal(fraction.revenueMonth12Minor, 0);
});

test("levers: strong-case gains from one change at a time, never one that lowers month-12 active subscribers", () => {
  const levers = facebookLevers(DEFAULT_FACEBOOK_INPUTS);
  assert.deepEqual(levers.map((l) => l.id), ["pageLink", "keywordReels", "moreLinkPosts"]);
  const by = Object.fromEntries(levers.map((l) => [l.id, l]));
  // Page link: 1,000 Page visits a month. 4.56 → 21.44 active, 5 → 21 whole
  // subscribers: AED 3,184 more a month.
  assert.deepEqual(by.pageLink.change, { pageVisitsPerMonth: 1000 });
  near(by.pageLink.month1New, 1000 * 0.03 * 0.062, 1e-9);
  near(by.pageLink.signups12, groupTotal(1000, 0.03, 0.08) * 0.062, 1e-9);
  near(by.pageLink.activeMonth12, 16.877, 0.001);
  assert.equal(by.pageLink.revenueMonth12Minor, 16 * 199 * 100);
  // 4 more keyword Reels and 4 more link posts: one more whole subscriber each.
  assert.deepEqual(by.keywordReels.change, { ctaReelsPerMonth: 8 });
  near(by.keywordReels.activeMonth12, 1.79, 0.001);
  assert.equal(by.keywordReels.revenueMonth12Minor, 199 * 100);
  assert.deepEqual(by.moreLinkPosts.change, { linkPostsPerMonth: 8 });
  near(by.moreLinkPosts.activeMonth12, 1.12, 0.001);
  assert.equal(by.moreLinkPosts.revenueMonth12Minor, 199 * 100);
  // Keyword off: the lever switches it on, for 4 Reels or the Reels you post.
  assert.deepEqual(
    facebookLevers({ ...DEFAULT_FACEBOOK_INPUTS, keywordDms: false, ctaReelsPerMonth: 0 }).find((l) => l.id === "keywordReels")!.change,
    { keywordDms: true, ctaReelsPerMonth: 4 },
  );
  assert.deepEqual(
    facebookLevers({ ...DEFAULT_FACEBOOK_INPUTS, keywordDms: false, ctaReelsPerMonth: 6 }).find((l) => l.id === "keywordReels")!.change,
    { keywordDms: true, ctaReelsPerMonth: 6 },
  );
  // Page visits already entered: 1,000 more. Posting counts stop at 60 a month.
  assert.deepEqual(
    facebookLevers({ ...DEFAULT_FACEBOOK_INPUTS, pageVisitsPerMonth: 500 }).find((l) => l.id === "pageLink")!.change,
    { pageVisitsPerMonth: 1500 },
  );
  const busy = Object.fromEntries(
    facebookLevers({ ...DEFAULT_FACEBOOK_INPUTS, linkPostsPerMonth: 58, ctaReelsPerMonth: 59 }).map((l) => [l.id, l.change]),
  );
  assert.deepEqual(busy.moreLinkPosts, { linkPostsPerMonth: 60 });
  assert.deepEqual(busy.keywordReels, { ctaReelsPerMonth: 60 });
  // A typical-scenario lever is smaller than the strong one.
  const typical = facebookLevers(DEFAULT_FACEBOOK_INPUTS, DEFAULT_FACEBOOK_MODEL, DEFAULT_FOLLOWER_MODEL, "typical");
  assert.ok(typical[0].activeMonth12 < by.pageLink.activeMonth12);
  // A change that would lower month-12 active subscribers is not offered: in
  // the cautious scenario (the same people all year) at 80% cancellations, 4
  // more link posts bring sign-ups sooner and more of them cancel by month 12.
  const heavy = { ...DEFAULT_FACEBOOK_INPUTS, linkPostsPerMonth: 30, yearlyCancelPct: 80 };
  assert.ok(
    estimateFacebookConversion({ ...heavy, linkPostsPerMonth: 34 }).scenarios.cautious.activeMonth12 <
      estimateFacebookConversion(heavy).scenarios.cautious.activeMonth12,
  );
  assert.deepEqual(
    facebookLevers(heavy, DEFAULT_FACEBOOK_MODEL, DEFAULT_FOLLOWER_MODEL, "cautious").map((l) => l.id),
    ["pageLink", "keywordReels"],
  );
  // Everywhere: a lever is shown exactly when it keeps or raises month-12
  // active subscribers, and the strong case (the headline) always shows all three.
  for (const s of FOLLOWER_SCENARIOS)
    for (const yearlyCancelPct of [5, 30, 50, 80])
      for (const followers of [1000, 7000, 60_000])
        for (const linkPostsPerMonth of [0, 4, 30]) {
          const input = { ...DEFAULT_FACEBOOK_INPUTS, followers, yearlyCancelPct, linkPostsPerMonth };
          const now = estimateFacebookConversion(input).scenarios[s].activeMonth12;
          const shown = new Map(
            facebookLevers(input, DEFAULT_FACEBOOK_MODEL, DEFAULT_FOLLOWER_MODEL, s).map((l) => [l.id, l]),
          );
          const candidates: Array<[FacebookLeverId, Partial<FacebookInputs>]> = [
            ["pageLink", { pageVisitsPerMonth: 1000 }],
            ["keywordReels", { ctaReelsPerMonth: 8 }],
            ["moreLinkPosts", { linkPostsPerMonth: linkPostsPerMonth + 4 }],
          ];
          for (const [id, change] of candidates) {
            const delta = estimateFacebookConversion({ ...input, ...change }).scenarios[s].activeMonth12 - now;
            const where = `${id}, ${s}, ${followers} followers, ${linkPostsPerMonth} link posts, ${yearlyCancelPct}%`;
            assert.equal(shown.has(id), delta >= -1e-9, `${where}: ${delta}`);
            const lever = shown.get(id);
            if (lever) {
              assert.deepEqual(lever.change, change, where);
              near(lever.activeMonth12, delta, 1e-12, where);
              assert.ok(lever.activeMonth12 >= -1e-9, where);
            }
          }
          if (s === "strong") assert.equal(shown.size, 3, `strong ${followers} ${linkPostsPerMonth} ${yearlyCancelPct}%`);
        }
});

test("engagement rate: (reactions + comments + shares) per post ÷ followers, null when unknown", () => {
  assert.equal(
    facebookEngagementRate(1000, [{ reactions: 10, comments: 2, shares: 3 }, { reactions: 6, comments: 0 }]),
    1.05,
  );
  // Missing, blank, negative or non-numeric counts are 0 (Meta leaves shares
  // out when a post has none).
  assert.equal(
    facebookEngagementRate(1000, [{ reactions: 10, comments: null, shares: undefined }, { reactions: -4, comments: NaN }]),
    0.5,
  );
  // Three decimals, as the Instagram rate: 10 interactions over 3 posts at
  // 7,000 followers is 0.0476…%.
  assert.equal(facebookEngagementRate(7000, [{ reactions: 7, comments: 1, shares: 1 }, { reactions: 1 }, {}]), 0.048);
  // With no shares it is the Instagram formula (likes + comments).
  for (const [followers, posts] of [
    [1000, [[10, 2], [6, 0]]],
    [7000, [[7, 1], [1, 0], [0, 0]]],
    [123_456, [[2500, 80], [1800, 41], [3100, 120], [990, 15]]],
    [37, [[3, 1]]],
  ] as Array<[number, Array<[number, number]>]>)
    assert.equal(
      facebookEngagementRate(followers, posts.map(([reactions, comments]) => ({ reactions, comments }))),
      engagementRate(followers, posts.map(([likes, comments]) => ({ likes, comments }))),
      `${followers}`,
    );
  // Unknown: no followers, followers not a number, or no posts.
  for (const followers of [0, -10, NaN, Infinity])
    assert.equal(facebookEngagementRate(followers, [{ reactions: 5, comments: 1, shares: 1 }]), null, `${followers}`);
  assert.equal(facebookEngagementRate(1000, []), null);
  // Posts nobody engaged with are a measured 0%, not unknown.
  assert.equal(facebookEngagementRate(1000, [{}, { reactions: 0, comments: 0, shares: 0 }]), 0);
  // A Page engaging at the average for its size is not scaled: 7,000
  // followers with 14.7 interactions a post is 0.21%, the 5-10K benchmark.
  const posts = Array.from({ length: 10 }, (_, i) => ({ reactions: i < 7 ? 11 : 10, comments: 3, shares: 1 }));
  const rate = facebookEngagementRate(7000, posts);
  assert.equal(rate, 0.21);
  assert.equal(at(7000, { engagementRatePct: rate }).engagementFactor, 1);
});

test("the defaults: cited figures, our divisions, ordered rates and the sources they cite", () => {
  const m = DEFAULT_FACEBOOK_MODEL;
  assert.equal(m.version, "2026-11-03");
  // Socialinsider post reach by Page size.
  assert.deepEqual(m.tiers.map((t) => t.upTo), [5000, 10000, 50000, 100000, null]);
  assert.deepEqual(m.tiers.map((t) => t.postReachPct), [4.35, 3.4, 2.7, 1.5, 0.5]);
  // Link and Reel shares: Socialinsider's format reach (images 1.20, albums
  // 1.15, status 0.80, Reels 0.55, links 0.20), against images (cautious) or
  // the five-format average, 0.78 (typical and strong), to two decimals.
  const formats = [1.2, 1.15, 0.8, 0.55, 0.2],
    average = formats.reduce((sum, f) => sum + f, 0) / formats.length;
  near(average, 0.78, 1e-12);
  const pct = (share: number) => Math.round(share * 10_000) / 100;
  assert.equal(m.scenarios.cautious.linkPostRelativeReachPct, pct(0.2 / 1.2));
  assert.equal(m.scenarios.typical.linkPostRelativeReachPct, pct(0.2 / 0.78));
  assert.equal(m.scenarios.strong.linkPostRelativeReachPct, pct(0.2 / 0.78));
  assert.equal(m.scenarios.cautious.reelRelativeReachPct, pct(0.55 / 1.2));
  assert.equal(m.scenarios.typical.reelRelativeReachPct, pct(0.55 / 0.78));
  assert.equal(m.scenarios.strong.reelRelativeReachPct, pct(0.55 / 0.78));
  // Engagement benchmark: Reels engagement by followers × 0.15 / 0.18 (all
  // formats against Reels), rounded.
  [0.3, 0.25, 0.2, 0.18, 0.15].forEach((reels, j) =>
    near(m.tiers[j].engagementBenchmarkPct, (reels * 0.15) / 0.18, 0.005, `tier ${j}`),
  );
  // Comments per Reel viewer: Buffer's 4.84% × comments' 19 of 200 interactions.
  near(m.reelCommentsPerViewPct, (4.84 * 19) / 200, 0.005);
  // The keyword factor and the engagement cap are the Instagram ones.
  assert.equal(m.keywordCommentFactor, DEFAULT_FOLLOWER_MODEL.keywordCommentFactor);
  assert.equal(m.engagementFactorMax, DEFAULT_FOLLOWER_MODEL.engagementFactorMax);
  // Larger Pages reach a smaller share and engage no more, so a Page's own
  // rate is never scaled down for growing.
  for (let j = 1; j < m.tiers.length; j++) {
    assert.ok(m.tiers[j].postReachPct < m.tiers[j - 1].postReachPct, `tier ${j}`);
    assert.ok(m.tiers[j].engagementBenchmarkPct <= m.tiers[j - 1].engagementBenchmarkPct, `tier ${j}`);
  }
  // Every rate keeps cautious ≤ typical ≤ strong; cautious nests Reels inside
  // the link-post audience; strong renews faster than the default cancellations.
  for (const key of FACEBOOK_RATE_KEYS) {
    const { cautious, typical, strong } = m.scenarios;
    assert.ok(cautious[key] <= typical[key] && typical[key] <= strong[key], key);
  }
  assert.deepEqual(FOLLOWER_SCENARIOS.map((s) => m.scenarios[s].reelsReachNewPeople), [false, true, true]);
  assert.deepEqual(FOLLOWER_SCENARIOS.map((s) => m.scenarios[s].audienceRenewalPct), [0, 1.5, 8]);
  assert.ok(m.scenarios.strong.audienceRenewalPct > monthlyChurn(DEFAULT_FACEBOOK_INPUTS.yearlyCancelPct) * 100);
  // Every source the defaults cite is listed, retrieved 3 November 2026, and
  // the Instagram sources reused as proxies are still there.
  const sources = new Map(MARKETING_SOURCES.map((s) => [s.id, s]));
  for (const id of [
    "socialinsider-reach-facebook",
    "socialinsider-facebook",
    "socialinsider-video-statistics",
    "buffer-engagement-2026",
    "buffer-facebook-benchmarks",
    "meta-widely-viewed-content",
    "techcrunch-facebook-link-limit",
    "socialmediatoday-facebook-link-limit",
    "echobox-facebook-ctr-2021",
    "meta-private-replies",
  ]) {
    const source = sources.get(id);
    assert.ok(source, id);
    assert.equal(source.retrieved, "2026-11-03", id);
    assert.match(source.url, /^https:\/\//, id);
    assert.match(source.usedFor, /Facebook Page estimate/, id);
  }
  for (const id of [
    "metricool-2026",
    "communipass-auto-dm",
    "chatautodm-2026",
    "hopp-bio-link",
    "creatorflow-link-sticker",
    "revenuecat-state-2026",
    "dynamicyield-conversion",
  ])
    assert.ok(sources.has(id), id);
});

test("the Facebook calculator loads only the follower calculator: no settings schema, no domain index, no formatter", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../packages/domain/src/facebook-calculator.ts", import.meta.url), "utf8");
  assert.deepEqual(
    [...source.matchAll(/^import [^;]*? from "([^"]+)";/gm)].map((m) => m[1]),
    ["./marketing-calculators.ts"],
  );
  assert.doesNotMatch(source, /\bz\.|new Intl\.NumberFormat/);
});
