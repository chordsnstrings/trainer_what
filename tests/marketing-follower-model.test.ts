// Follower calculator v3 (assumptions 2026-09-28.4): worked examples, the
// tier-boundary fix, audience renewal, monotonicity in followers and in every
// lever, cancellations, the strong-case calibration, the levers and the Super
// admin settings mapping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CITED_ASSUMPTIONS } from "@trainer/contracts";
import {
  DEFAULT_FOLLOWER_INPUTS,
  DEFAULT_FOLLOWER_MODEL,
  FOLLOWER_MODEL_SETTING_KEYS,
  FOLLOWER_SCENARIOS,
  displayCount,
  engagementRate,
  estimateFollowerConversion,
  followerLevers,
  followerModelAdjustments,
  followerModelFromSettings,
  followerSettingsNeedNote,
  followerSettingsProblem,
  monthlyChurn,
  visitChance,
  type FollowerEstimate,
  type FollowerScenarioEstimate,
  type FollowerInputs,
} from "../packages/domain/src/marketing-calculators.ts";
import { INTEGRATION_CATALOG } from "../packages/providers/src/configuration.ts";

const near = (actual: number, expected: number, tolerance = 0.05, what = "") =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what} expected ${expected} ± ${tolerance}, got ${actual}`,
  );
const at = (followers: number, extra: Partial<FollowerInputs> = {}): FollowerEstimate =>
  estimateFollowerConversion({ ...DEFAULT_FOLLOWER_INPUTS, followers, ...extra });
/** First visits over 12 months from a renewing group (the model's recursion). */
const bioVisits = (people: number, chance: number, renewal: number) => {
  let fresh = 1,
    total = 0;
  for (let m = 0; m < 12; m++) {
    total += people * chance * fresh;
    fresh = (1 - renewal) * (1 - chance) * fresh + renewal;
  }
  return total;
};

test("worked examples: 3k, 7k, 20k, 50k and 150k followers at the defaults", () => {
  // AED 199, 8 link Stories and 4 keyword Reels a month, 30% cancellations a year.
  // [month 1, active at month 12, sign-ups over 12 months, AED a month at month 12]
  const expected: Record<number, Record<string, [number, number, number, number]>> = {
    3000: { cautious: [0.2, 1.1, 1.3, 199], typical: [2.1, 8.4, 10.5, 1_592], strong: [13.2, 50.3, 61.9, 9_950] },
    7000: { cautious: [0.3, 1.9, 2.2, 398], typical: [3.5, 14.5, 18.0, 2_985], strong: [30.7, 116.4, 143.3, 23_084] },
    20000: { cautious: [0.3, 2.2, 2.6, 398], typical: [6.8, 28.6, 35.4, 5_771], strong: [44.4, 171.9, 211.3, 34_228] },
    50000: { cautious: [0.5, 3.7, 4.4, 796], typical: [16.9, 71.4, 88.5, 14_129], strong: [87.4, 344.2, 422.7, 68_456] },
    150000: { cautious: [0.6, 4.6, 5.5, 995], typical: [49.0, 196.6, 244.7, 39_203], strong: [162.8, 634.2, 779.3, 126_166] },
  };
  for (const [followers, rows] of Object.entries(expected)) {
    const e = at(Number(followers));
    assert.equal(e.assumptionsVersion, "2026-09-28.4");
    for (const s of FOLLOWER_SCENARIOS) {
      const r = e.scenarios[s],
        [m1, a12, c12, aed] = rows[s];
      near(r.month1New, m1, 0.05, `${followers} ${s} month 1`);
      near(r.activeMonth12, a12, 0.05, `${followers} ${s} active`);
      near(r.signups12, c12, 0.05, `${followers} ${s} sign-ups`);
      assert.equal(r.revenueMonth12Minor, aed * 100, `${followers} ${s} AED`);
    }
  }
});

test("strong case: over 100 active subscribers at month 12 for 7,000 followers, still growing", () => {
  const e = at(7000);
  const strong = e.scenarios.strong;
  assert.equal(e.inputs.yearlyCancelPct, 30);
  assert.ok(strong.activeMonth12 >= 100, `active ${strong.activeMonth12}`);
  // The owner's direction: the transformation keeps on happening. Active
  // subscribers rise every month to month 12, and month 12 still brings new
  // sign-ups, for every account size and cancellations up to 50% a year.
  for (const followers of [500, 3000, 7000, 20_000, 150_000])
    for (const yearlyCancelPct of [5, 30, 50]) {
      const r = at(followers, { yearlyCancelPct }).scenarios.strong;
      for (let m = 1; m < 12; m++)
        assert.ok(
          r.activeByMonth[m] > r.activeByMonth[m - 1],
          `${followers} at ${yearlyCancelPct}%: month ${m + 1} ${r.activeByMonth[m]} after ${r.activeByMonth[m - 1]}`,
        );
      assert.ok(r.newByMonth[11] > r.newByMonth[0] / 10, `${followers}: month 12 ${r.newByMonth[11]}`);
    }
  // About 2% of followers sign up over a year up to 10,000 followers, a lower
  // share for larger accounts.
  const share = strong.signups12 / 7000;
  assert.ok(share >= 0.015 && share <= 0.025, `share ${share}`);
  const shares = [3000, 7000, 20000, 50000, 150000].map(
    (f) => at(f).scenarios.strong.signups12 / f,
  );
  for (let k = 1; k < shares.length; k++)
    assert.ok(shares[k] <= shares[k - 1] + 1e-12, `share rises at ${k}: ${shares}`);
  // Per link Story: 5% tap × 6.2% pay = 0.31% of viewers.
  const s = DEFAULT_FOLLOWER_MODEL.scenarios.strong;
  near((s.linkClickPct * s.paidPct) / 100, 0.31, 1e-9);
  // The strong case is never presented as typical: typical stays far below it.
  assert.ok(e.scenarios.typical.activeMonth12 < strong.activeMonth12 / 5);
});

test("arithmetic: Story audience, renewing visits, sign-ups and cancellations", () => {
  // Stories only, so every visit comes from one channel.
  const e = at(7000, { ctaReelsPerMonth: 0 });
  const strong = e.scenarios.strong,
    cautious = e.scenarios.cautious;
  assert.equal(e.tierIndex, 1);
  // Strong: 20.5% of 7,000. Cautious: 3.5% of 7,000 is 245, but an account
  // never gets fewer viewers than one at the top of the tier below (5,000 × 9.55%).
  near(strong.storyViewers, 1435, 1e-9);
  near(cautious.storyViewers, 477.5, 1e-9);
  // Each month 8% of the audience is new to the link; the rest keep their
  // chance only until they visit.
  const c = visitChance(5, 8);
  let fresh = 1;
  const visits: number[] = [];
  for (let m = 0; m < 12; m++) {
    visits.push(1435 * c * fresh);
    fresh = 0.92 * (1 - c) * fresh + 0.08;
  }
  for (let m = 0; m < 12; m++) near(strong.newByMonth[m], visits[m] * 0.062, 1e-9, `month ${m + 1}`);
  near(strong.visitors12, visits.reduce((a, b) => a + b, 0), 1e-9);
  near(strong.signups12, strong.visitors12 * 0.062, 1e-9);
  // More people visit over a year than the monthly audience would alone.
  assert.ok(strong.visitors12 > 1435 * (1 - 0.95 ** 96));
  // Cautious keeps the same people all year: 1 − (1 − c)^(k·12).
  near(cautious.visitors12, 477.5 * (1 - 0.99 ** 96), 1e-9);
  // Active: each month's joiners, less cancellations since they joined.
  const churn = monthlyChurn(30);
  assert.equal(strong.activeByMonth[0], strong.newByMonth[0]);
  for (let m = 1; m < 12; m++)
    near(
      strong.activeByMonth[m],
      strong.activeByMonth[m - 1] * (1 - churn) + strong.newByMonth[m],
      1e-9,
    );
  assert.equal(strong.revenueMonth12Minor, Math.round(strong.activeMonth12) * 199 * 100);
  assert.ok(strong.activeMonth12 <= strong.signups12);
  // Keyword Reels reach new people each Reel in typical and strong: a Reel's
  // viewers × keyword comments per view × DM link opened, every Reel.
  const reels = at(7000, { linkStoriesPerMonth: 0 }).scenarios.strong;
  const perReel = 7000 * 0.0755 * ((0.6 * 2.0278) / 100) * 0.45;
  for (const n of reels.newByMonth) near(n, perReel * 4 * 0.062, 1e-9);
});

test("cancellations: a yearly rate becomes 1 − (1 − yearly)^(1/12) a month, 5-80%", () => {
  near(monthlyChurn(30), 1 - 0.7 ** (1 / 12), 1e-12);
  near((1 - monthlyChurn(30)) ** 12, 0.7, 1e-12);
  near((1 - monthlyChurn(55)) ** 12, 0.45, 1e-12);
  assert.equal(monthlyChurn(0), 0);
  assert.equal(monthlyChurn(100), 1);
  near(at(7000).monthlyCancelPct, monthlyChurn(30) * 100, 1e-12);
  assert.equal(at(7000, { yearlyCancelPct: 1 }).inputs.yearlyCancelPct, 5);
  assert.equal(at(7000, { yearlyCancelPct: 99 }).inputs.yearlyCancelPct, 80);
  // A missing or non-numeric rate is the 30% default, not the lowest allowed.
  for (const yearlyCancelPct of [NaN, Infinity, undefined]) {
    const e = at(7000, { yearlyCancelPct });
    assert.equal(e.inputs.yearlyCancelPct, 30, String(yearlyCancelPct));
    assert.equal(e.scenarios.strong.revenueMonth12Minor, at(7000).scenarios.strong.revenueMonth12Minor);
  }
  // More cancellations: fewer active, the same sign-ups.
  const low = at(7000, { yearlyCancelPct: 10 }).scenarios.strong,
    high = at(7000, { yearlyCancelPct: 60 }).scenarios.strong;
  assert.ok(low.activeMonth12 > high.activeMonth12);
  near(low.signups12, high.signups12, 1e-9);
  assert.equal(low.month1New, high.month1New);
});

test("tier boundaries never lower an estimate (the 5,000 / 5,001 cliff is gone)", () => {
  for (const boundary of [5000, 10000, 50000, 100000]) {
    const below = at(boundary),
      above = at(boundary + 1);
    for (const s of FOLLOWER_SCENARIOS)
      for (const key of ["storyViewers", "month1New", "signups12", "activeMonth12"] as const)
        assert.ok(
          above.scenarios[s][key] >= below.scenarios[s][key] - 1e-9,
          `${s} ${key} falls at ${boundary}: ${below.scenarios[s][key]} → ${above.scenarios[s][key]}`,
        );
  }
});

test("monotone in followers from 100 to 1,000,000: viewers, visits, sign-ups and active subscribers", () => {
  const followers: number[] = [];
  for (let f = 100; f <= 1_000_000; f = Math.ceil(f * 1.02) + 1) followers.push(f);
  // Fine steps where one tier's Reel figures overtake another's.
  for (let f = 4_900; f <= 7_000; f += 7) followers.push(f);
  for (let f = 110_000; f <= 113_000; f += 7) followers.push(f);
  for (const b of [5000, 10000, 50000, 100000]) followers.push(b - 1, b, b + 1);
  followers.sort((a, b) => a - b);
  const variants: Array<[string, Partial<FollowerInputs>]> = [
    ["defaults", {}],
    ["Stories only", { ctaReelsPerMonth: 0 }],
    ["no keyword DMs", { keywordDms: false }],
    ["broadcast channel", { broadcastMembers: 300 }],
    ["engaged", { engagementRatePct: 2 }],
    ["quiet", { engagementRatePct: 0.1 }],
    ["own Story views", { storyViews: 800 }],
    ["bio link", { profileVisitsPerMonth: 1000 }],
    ["daily Stories, high cancellations", { linkStoriesPerMonth: 60, yearlyCancelPct: 80 }],
    ["60 Reels only, high cancellations", { linkStoriesPerMonth: 0, ctaReelsPerMonth: 60, yearlyCancelPct: 80 }],
    ["8 Stories and 60 Reels, high cancellations", { ctaReelsPerMonth: 60, yearlyCancelPct: 80 }],
    ["engaged, 60 Reels, high cancellations", { ctaReelsPerMonth: 60, yearlyCancelPct: 80, engagementRatePct: 3 }],
  ];
  for (const [name, extra] of variants) {
    let previous: FollowerEstimate | null = null;
    for (const f of followers) {
      const e = at(f, extra);
      if (previous)
        for (const s of FOLLOWER_SCENARIOS) {
          const now = e.scenarios[s],
            before: FollowerScenarioEstimate = previous.scenarios[s];
          const where = `${name}, ${s}, ${f} followers`;
          assert.ok(now.storyViewers >= before.storyViewers - 1e-9, `viewers: ${where}`);
          assert.ok(now.visitors12 >= before.visitors12 - 1e-9, `visitors: ${where}`);
          assert.ok(now.signups12 >= before.signups12 - 1e-9, `sign-ups: ${where}`);
          let cumulative = 0,
            previousCumulative = 0;
          for (let m = 0; m < 12; m++) {
            cumulative += now.newByMonth[m];
            previousCumulative += before.newByMonth[m];
            assert.ok(cumulative >= previousCumulative - 1e-9, `month ${m + 1}: ${where}`);
          }
          // Typical and strong: active subscribers never fall. Cautious keeps
          // the same people all year, so where a larger tier's Reel figures
          // bring its sign-ups sooner (and sooner sign-ups have longer to
          // cancel) its month-12 count can move by up to 0.5% in these
          // variants, and by a ten-thousandth at the default cancellations.
          const slack =
            s !== "cautious" ? 1e-9 : before.activeMonth12 * (extra.yearlyCancelPct === 80 ? 5e-3 : 1e-4);
          assert.ok(now.activeMonth12 >= before.activeMonth12 - slack, `active: ${where}`);
        }
      previous = e;
    }
  }
});

test("monotone in every lever: more sharing, members, engagement or views never lower the headline", () => {
  const sweeps: Array<[string, (v: number) => Partial<FollowerInputs>, number[]]> = [
    ["link Stories", (v) => ({ linkStoriesPerMonth: v }), Array.from({ length: 61 }, (_, i) => i)],
    ["keyword Reels", (v) => ({ ctaReelsPerMonth: v }), Array.from({ length: 61 }, (_, i) => i)],
    ["broadcast members", (v) => ({ broadcastMembers: v }), [0, 50, 100, 300, 600, 1000, 1435, 2000, 3000, 7000]],
    ["broadcast links", (v) => ({ broadcastMembers: 800, broadcastLinksPerMonth: v }), Array.from({ length: 61 }, (_, i) => i)],
    ["engagement", (v) => ({ engagementRatePct: v }), Array.from({ length: 101 }, (_, i) => i * 0.02)],
    ["own Story views", (v) => ({ storyViews: v }), Array.from({ length: 71 }, (_, i) => i * 100)],
    ["profile visits", (v) => ({ profileVisitsPerMonth: v }), [0, 100, 500, 1000, 5000, 20000]],
  ];
  for (const yearlyCancelPct of [5, 30, 50, 80])
    for (const followers of [1000, 5000, 7000, 20_000, 150_000])
      for (const [name, make, values] of sweeps) {
        let previous: FollowerEstimate | null = null;
        for (const v of values) {
          const e = at(followers, { yearlyCancelPct, ...make(v) });
          if (previous)
            for (const s of FOLLOWER_SCENARIOS) {
              const now = e.scenarios[s],
                before: FollowerScenarioEstimate = previous.scenarios[s];
              const where = `${name} ${v}, ${s}, ${followers} followers, ${yearlyCancelPct}%`;
              assert.ok(now.signups12 >= before.signups12 - 1e-9, `sign-ups: ${where}`);
              // Strong (the headline and the levers) renews its audience faster
              // than people cancel, so it never falls at any cancellation rate;
              // typical (1.5% renewal) never falls up to the 30% default.
              // Cautious keeps the same people all year, and typical renews more
              // slowly than 50-80% cancellations: extra chances bring sign-ups
              // sooner, and sooner sign-ups have longer to cancel, so one step
              // can lower their month-12 count by about 1% at most.
              if (s === "strong" || (s === "typical" && yearlyCancelPct <= 30)) {
                assert.ok(now.activeMonth12 >= before.activeMonth12 - 1e-9, `active: ${where}`);
                assert.ok(now.revenueMonth12Minor >= before.revenueMonth12Minor, `AED: ${where}`);
              } else assert.ok(now.activeMonth12 >= before.activeMonth12 * 0.985 - 1e-9, `active: ${where}`);
            }
          previous = e;
        }
      }
});

test("scenarios are ordered: cautious ≤ typical ≤ strong", () => {
  for (const followers of [0, 50, 999, 3000, 5000, 5001, 7000, 20_000, 80_000, 2_000_000])
    for (const extra of [
      {},
      { ctaReelsPerMonth: 0 },
      { linkStoriesPerMonth: 60 },
      { broadcastMembers: 500, profileVisitsPerMonth: 2000 },
      { engagementRatePct: 3, storyViews: 900 },
      { engagementRatePct: 3 },
      { engagementRatePct: 0.1, ctaReelsPerMonth: 60 },
      { yearlyCancelPct: 80 },
    ] as Array<Partial<FollowerInputs>>) {
      const e = at(followers, extra);
      for (const key of ["storyViewers", "month1New", "signups12", "activeMonth12", "visitors12"] as const) {
        const { cautious, typical, strong } = e.scenarios;
        assert.ok(cautious[key] <= typical[key] + 1e-9 && typical[key] <= strong[key] + 1e-9, `${key} at ${followers} ${JSON.stringify(extra)}`);
      }
      for (const s of FOLLOWER_SCENARIOS) {
        const r = e.scenarios[s];
        assert.ok(r.newByMonth.every((n) => n >= 0));
        assert.ok(r.signups12 <= r.visitors12 * (DEFAULT_FOLLOWER_MODEL.scenarios[s].paidPct / 100) + 1e-9);
        assert.ok(r.storyViewers <= e.inputs.followers + 1e-9);
        assert.ok(r.activeMonth12 <= r.signups12 + 1e-9 && r.month1New <= r.signups12 + 1e-9);
      }
    }
});

test("inputs: zero gives zero, clamping, own Story views, optional channels and engagement", () => {
  const zero = estimateFollowerConversion({ followers: -50, linkStoriesPerMonth: -1, priceAed: -3, ctaReelsPerMonth: -2 });
  assert.equal(zero.inputs.followers, 0);
  assert.equal(zero.inputs.priceAed, 1);
  for (const s of FOLLOWER_SCENARIOS) {
    const r = zero.scenarios[s];
    assert.equal(r.storyViewers, 0);
    assert.equal(r.month1New, 0);
    assert.equal(r.signups12, 0);
    assert.equal(r.activeMonth12, 0);
    assert.equal(r.revenueMonth12Minor, 0);
  }
  const none = at(7000, { linkStoriesPerMonth: 0, ctaReelsPerMonth: 0 });
  for (const s of FOLLOWER_SCENARIOS) assert.equal(none.scenarios[s].signups12, 0);
  // Your own Story views replace the benchmark in every scenario, capped at followers.
  const views = at(7000, { storyViews: 900 });
  for (const s of FOLLOWER_SCENARIOS) assert.equal(views.scenarios[s].storyViewers, 900);
  assert.equal(at(700, { storyViews: 5000 }).scenarios.strong.storyViewers, 700);
  // The bio link counts only when profile visits are entered; its visitors
  // renew like every audience (8% a month in the strong case).
  const base = at(7000).scenarios.strong,
    bio = at(7000, { profileVisitsPerMonth: 1000 }).scenarios.strong;
  near(bio.month1New - base.month1New, 1000 * 0.03 * 0.062, 1e-9);
  near(bio.signups12 - base.signups12, bioVisits(1000, 0.03, 0.08) * 0.062, 1e-9);
  near(
    at(7000, { profileVisitsPerMonth: 1000 }).scenarios.cautious.signups12 - at(7000).scenarios.cautious.signups12,
    1000 * (1 - 0.99 ** 12) * 0.0072,
    1e-9,
  );
  // Without the keyword funnel, call-to-action Reels add nothing.
  const off = at(7000, { keywordDms: false }).scenarios.strong,
    storiesOnly = at(7000, { ctaReelsPerMonth: 0 }).scenarios.strong;
  near(off.signups12, storiesOnly.signups12, 1e-12);
  assert.ok(base.signups12 > off.signups12);
  // Broadcast members are followers.
  assert.equal(at(1000, { broadcastMembers: 5000 }).inputs.broadcastMembers, 1000);
  // Engagement scales Story reach within ×0.5 to ×2 of the 0.48% average.
  const eng = (rate: number | null) => at(5000, { engagementRatePct: rate });
  assert.equal(eng(0.96).engagementFactor, 2);
  assert.equal(eng(5).engagementFactor, 2);
  assert.equal(eng(0.12).engagementFactor, 0.5);
  near(eng(0.72).engagementFactor, 1.5, 1e-9);
  assert.equal(eng(null).engagementFactor, 1);
  near(eng(0.96).scenarios.cautious.storyViewers, 5000 * 0.191, 1e-9);
  near(eng(0.96).scenarios.typical.storyViewers, 5000 * 0.208, 1e-9);
  // One person decides once: with no renewal nothing exceeds the audience ×
  // visit to paid; with renewal, only the people new to the link each month
  // (8% of the audience) add to it.
  const saturate = (audienceRenewalPct: number) =>
    estimateFollowerConversion(
      { followers: 3, linkStoriesPerMonth: 60, priceAed: 100, ctaReelsPerMonth: 0 },
      {
        ...DEFAULT_FOLLOWER_MODEL,
        tiers: [{ ...DEFAULT_FOLLOWER_MODEL.tiers[0], upTo: null, storyPct: { cautious: 100, typical: 100, strong: 100 } }],
        scenarios: {
          ...DEFAULT_FOLLOWER_MODEL.scenarios,
          strong: { ...DEFAULT_FOLLOWER_MODEL.scenarios.strong, linkClickPct: 100, paidPct: 100, audienceRenewalPct },
        },
      },
    ).scenarios.strong;
  assert.equal(saturate(0).month1New, 3);
  assert.equal(saturate(0).signups12, 3);
  assert.equal(saturate(8).month1New, 3);
  near(saturate(8).signups12, 3 * (1 + 11 * 0.08), 1e-9);
  for (let m = 1; m < 12; m++) near(saturate(8).newByMonth[m], 3 * 0.08, 1e-9);
  // The monthly amount uses the same whole count the pages show: between 0.5
  // and 1 active subscriber the page says "fewer than 1" and AED 0.
  for (const followers of [28, 200, 300, 1500, 2000])
    for (const s of FOLLOWER_SCENARIOS) {
      const r = at(followers).scenarios[s];
      assert.equal(r.revenueMonth12Minor, (displayCount(r.activeMonth12) ?? 0) * 199 * 100, `${followers} ${s}`);
    }
  const fraction = at(300).scenarios.typical;
  assert.ok(fraction.activeMonth12 >= 0.5 && fraction.activeMonth12 < 1, `${fraction.activeMonth12}`);
  assert.equal(fraction.revenueMonth12Minor, 0);
  // Display: whole people, or "fewer than 1" (null).
  assert.equal(displayCount(0.99), null);
  assert.equal(displayCount(1.4), 1);
  assert.equal(displayCount(127.6), 128);
  assert.equal(engagementRate(1000, [{ likes: 10, comments: 2 }, { likes: 6, comments: 0 }]), 0.9);
  assert.equal(engagementRate(0, [{ likes: 1 }]), null);
});

test("engagement is not counted twice in the strong case", () => {
  // The strong Story share already assumes an engaged audience (HypeAuditor:
  // accounts of 1,000-10,000 followers engage most), so a high engagement rate
  // does not raise it again; a low one still lowers it.
  const base = at(7000).scenarios.strong;
  for (const engagementRatePct of [0.96, 2.19, 4]) {
    const e = at(7000, { engagementRatePct });
    assert.equal(e.engagementFactor, 2);
    near(e.scenarios.strong.storyViewers, 1435, 1e-9, `${engagementRatePct}`);
    // Keyword comments still scale (not an engaged-audience assumption), so
    // the result moves a little, and 12-month sign-ups stay near 2% of followers.
    assert.ok(e.scenarios.strong.signups12 / 7000 <= 0.025, `${e.scenarios.strong.signups12}`);
    assert.ok(e.scenarios.strong.activeMonth12 < base.activeMonth12 * 1.1);
  }
  near(at(7000, { engagementRatePct: 0.24 }).scenarios.strong.storyViewers, 1435 / 2, 1e-9);
  // For accounts up to 10,000 followers, strong sign-ups stay within 1-2.5%
  // of followers over a year at any engagement at or above the average.
  for (const followers of [1000, 3000, 5000, 7000, 10_000])
    for (const engagementRatePct of [null, 0.48, 1, 2.19, 10]) {
      const share = at(followers, { engagementRatePct }).scenarios.strong.signups12 / followers;
      assert.ok(share >= 0.01 && share <= 0.025, `${followers} at ${engagementRatePct}: ${share}`);
    }
  // Above 10,000 followers the strong share is never below the typical share
  // at the same engagement (5% × 2 = 10% beats the 8% strong band at 20,000).
  const big = at(40_000, { engagementRatePct: 3 });
  near(big.scenarios.strong.storyViewers, 40_000 * 0.1, 1e-9);
  assert.ok(big.scenarios.strong.storyViewers >= big.scenarios.typical.storyViewers);
});

test("levers: strong-case gains from one change at a time", () => {
  const levers = followerLevers(DEFAULT_FOLLOWER_INPUTS);
  const by = Object.fromEntries(levers.map((l) => [l.id, l]));
  assert.deepEqual(levers.map((l) => l.id), ["bioLink", "keywordReels", "moreStories", "broadcast"]);
  near(by.bioLink.month1New, 1000 * 0.03 * 0.062, 1e-9);
  near(by.bioLink.signups12, bioVisits(1000, 0.03, 0.08) * 0.062, 1e-9);
  assert.deepEqual(by.keywordReels.change, { ctaReelsPerMonth: 8 });
  assert.ok(by.keywordReels.signups12 > 5);
  // More Stories reach more of the audience before people drift away: more
  // subscribers in the first month and more active at month 12 (the headline).
  assert.deepEqual(by.moreStories.change, { linkStoriesPerMonth: 12 });
  assert.ok(by.moreStories.month1New > 10);
  assert.ok(by.moreStories.activeMonth12 > 5, `${by.moreStories.activeMonth12}`);
  assert.deepEqual(by.broadcast.change, { broadcastMembers: 300, broadcastLinksPerMonth: 4 });
  assert.ok(by.broadcast.month1New > 0);
  // Every lever shown raises the headline and its monthly amount.
  for (const lever of levers) {
    assert.ok(lever.activeMonth12 > 0, lever.id);
    assert.ok(lever.revenueMonth12Minor >= 0, lever.id);
  }
  // Keyword DMs off: the lever switches them on for 4 Reels.
  const off = followerLevers({ ...DEFAULT_FOLLOWER_INPUTS, keywordDms: false, ctaReelsPerMonth: 0 });
  assert.deepEqual(off.find((l) => l.id === "keywordReels")!.change, { keywordDms: true, ctaReelsPerMonth: 4 });
  // A typical-scenario lever is smaller than the strong one.
  const typical = followerLevers(DEFAULT_FOLLOWER_INPUTS, DEFAULT_FOLLOWER_MODEL, "typical");
  assert.ok(typical[0].signups12 < by.bioLink.signups12);
  // A change that would lower month-12 active subscribers is not offered: in
  // the cautious scenario (the same people all year) at 80% cancellations,
  // more Stories bring sign-ups sooner and more of them cancel by month 12.
  const busy = { ...DEFAULT_FOLLOWER_INPUTS, linkStoriesPerMonth: 30, yearlyCancelPct: 80 };
  const lower = estimateFollowerConversion({ ...busy, linkStoriesPerMonth: 34 }).scenarios.cautious.activeMonth12;
  assert.ok(lower < estimateFollowerConversion(busy).scenarios.cautious.activeMonth12);
  assert.ok(!followerLevers(busy, DEFAULT_FOLLOWER_MODEL, "cautious").some((l) => l.id === "moreStories"));
});

test("the Super admin's assumptions: settings map onto the model and inconsistent sets fall back", () => {
  const k = FOLLOWER_MODEL_SETTING_KEYS;
  assert.deepEqual(followerModelFromSettings({}), DEFAULT_FOLLOWER_MODEL);
  assert.equal(k.story[1].strong, "FOLLOWER_STORY_STRONG_10K");
  assert.equal(k.rates.paidPct.strong, "FOLLOWER_PAID_STRONG");
  assert.equal(k.rates.linkClickPct.cautious, "FOLLOWER_CLICK_CAUTIOUS");
  const edited = followerModelFromSettings({
    [k.version]: "2026-10-01",
    [k.story[0].cautious]: "8",
    [k.rates.linkClickPct.strong]: "4",
  });
  assert.equal(edited.version, "2026-10-01");
  // A version saved while an earlier default was current reads as the new one.
  for (const old of ["2026-09-28", "2026-09-28.2", "2026-09-28.3"])
    assert.equal(followerModelFromSettings({ [k.version]: old }).version, "2026-09-28.4");
  assert.equal(edited.tiers[0].storyPct.cautious, 8);
  assert.equal(edited.scenarios.strong.linkClickPct, 4);
  assert.equal(edited.scenarios.strong.paidPct, 6.2);
  assert.equal(k.rates.audienceRenewalPct.strong, "FOLLOWER_RENEWAL_STRONG");
  assert.equal(
    followerModelFromSettings({ [k.rates.audienceRenewalPct.strong]: "5" }).scenarios.strong.audienceRenewalPct,
    5,
  );
  // A cautious value above typical (or typical above strong) is inconsistent.
  assert.deepEqual(
    followerModelFromSettings({ [k.rates.paidPct.cautious]: "9" }),
    DEFAULT_FOLLOWER_MODEL,
  );
  assert.deepEqual(
    followerModelFromSettings({ [k.story[2].typical]: "12" }),
    DEFAULT_FOLLOWER_MODEL,
  );
  // The settings save refuses such a set with the reason, instead of saving a
  // change the public pages would ignore (a strong value lowered below typical).
  assert.equal(followerSettingsProblem({}), null);
  assert.equal(followerSettingsProblem({ [k.rates.paidPct.strong]: "9" }), null);
  assert.equal(
    followerSettingsProblem({ [k.rates.paidPct.strong]: "2" }),
    "Cautious must not exceed typical, nor typical strong",
  );
  assert.equal(followerModelFromSettings({ [k.rates.paidPct.strong]: "2" }).scenarios.strong.paidPct, 6.2);
  assert.match(followerSettingsProblem({ [k.rates.audienceRenewalPct.strong]: "60" }) ?? "", /50/);
  // Each settings default equals the domain default (one source of truth).
  const marketing = INTEGRATION_CATALOG.find((i) => i.id === "marketing")!;
  assert.equal(marketing.controls, true);
  const defaults = Object.fromEntries(marketing.fields.map((f) => [f.key, f.defaultValue]));
  assert.deepEqual(followerModelFromSettings(defaults as Record<string, string>), DEFAULT_FOLLOWER_MODEL);
  assert.equal(defaults[k.version], DEFAULT_FOLLOWER_MODEL.version);
  assert.deepEqual(
    marketing.fields.find((f) => f.key === k.version)!.supersededValues,
    ["2026-09-28", "2026-09-28.2", "2026-09-28.3"],
  );
  for (const tier of k.story) for (const s of FOLLOWER_SCENARIOS) assert.ok(tier[s] in defaults, tier[s]);
  for (const rate of Object.values(k.rates)) for (const s of FOLLOWER_SCENARIOS) assert.ok(rate[s] in defaults, rate[s]);
  // The copy's cited figures equal the domain defaults.
  const project = (s: (typeof FOLLOWER_SCENARIOS)[number]) => {
    const { reelsReachNewPeople: _, engagedStoryShare: __, ...rates } = DEFAULT_FOLLOWER_MODEL.scenarios[s];
    return rates;
  };
  assert.deepEqual(CITED_ASSUMPTIONS, {
    scenarios: { cautious: project("cautious"), typical: project("typical"), strong: project("strong") },
    engagementBenchmarkPct: DEFAULT_FOLLOWER_MODEL.engagementBenchmarkPct,
  });
  // A value that differs from its cited default needs the operator's reason.
  assert.deepEqual(followerModelAdjustments(DEFAULT_FOLLOWER_MODEL), []);
  assert.equal(followerSettingsNeedNote(defaults as Record<string, string>), false);
  assert.equal(followerSettingsNeedNote({ [k.rates.paidPct.strong]: "9" }), true);
  assert.equal(
    followerSettingsNeedNote({ [k.rates.paidPct.strong]: "9", [k.changeNote]: "Own trial data, Q3 2026" }),
    false,
  );
  const noted = followerModelFromSettings({ [k.rates.paidPct.strong]: "9", [k.changeNote]: "Own trial data" });
  assert.equal(noted.changeNote, "Own trial data");
  assert.deepEqual(followerModelAdjustments(noted).map((a) => a.field), ["scenarios.strong.paidPct"]);
});
