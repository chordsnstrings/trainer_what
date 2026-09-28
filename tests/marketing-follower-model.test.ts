// Follower calculator v3 (assumptions 2026-09-28.3): worked examples, the
// tier-boundary fix, monotonicity, cancellations, the strong-case
// calibration, the levers and the Super admin settings mapping.
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

test("worked examples: 3k, 7k, 20k, 50k and 150k followers at the defaults", () => {
  // AED 199, 8 link Stories and 4 keyword Reels a month, 30% cancellations a year.
  // [month 1, active at month 12, sign-ups over 12 months, AED a month at month 12]
  const expected: Record<number, Record<string, [number, number, number, number]>> = {
    3000: { cautious: [0.2, 1.1, 1.3, 199], typical: [2.1, 7.8, 9.8, 1_592], strong: [22.7, 55.4, 71.7, 10_945] },
    7000: { cautious: [0.3, 1.9, 2.2, 398], typical: [3.5, 13.4, 16.7, 2_587], strong: [52.9, 127.6, 165.5, 25_472] },
    20000: { cautious: [0.3, 2.2, 2.6, 398], typical: [6.8, 26.4, 32.9, 5_174], strong: [76.5, 191.4, 247.2, 38_009] },
    50000: { cautious: [0.5, 3.7, 4.4, 796], typical: [16.9, 65.9, 82.3, 13_134], strong: [150.8, 387.1, 498.4, 77_013] },
    150000: { cautious: [0.6, 4.6, 5.5, 995], typical: [49.0, 181.6, 228.1, 36_218], strong: [280.9, 711.1, 916.9, 141_489] },
  };
  for (const [followers, rows] of Object.entries(expected)) {
    const e = at(Number(followers));
    assert.equal(e.assumptionsVersion, "2026-09-28.3");
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

test("strong case: about 100+ active subscribers at month 12 for 7,000 followers, about 2% signing up", () => {
  const e = at(7000);
  const strong = e.scenarios.strong;
  assert.equal(e.inputs.yearlyCancelPct, 30);
  assert.ok(strong.activeMonth12 >= 100, `active ${strong.activeMonth12}`);
  const share = strong.signups12 / 7000;
  assert.ok(share >= 0.015 && share <= 0.03, `share ${share}`);
  // Per link Story: 5% tap × 10.7% pay = 0.535% of viewers, the low end of the
  // owner's creator example (0.5-1.5% of viewers buying a USD 20 plan).
  const s = DEFAULT_FOLLOWER_MODEL.scenarios.strong;
  near((s.linkClickPct * s.paidPct) / 100, 0.535, 1e-9);
  // It scales with followers, and larger accounts convert a lower share.
  const shares = [3000, 7000, 20000, 50000, 150000].map(
    (f) => at(f).scenarios.strong.signups12 / f,
  );
  for (let k = 1; k < shares.length; k++)
    assert.ok(shares[k] <= shares[k - 1] + 1e-12, `share rises at ${k}: ${shares}`);
  // The strong case is never presented as typical: typical stays far below it.
  assert.ok(e.scenarios.typical.activeMonth12 < strong.activeMonth12 / 5);
});

test("arithmetic: Story audience, saturating visits, sign-ups and cancellations", () => {
  // Stories only, so every visit comes from one channel.
  const e = at(7000, { ctaReelsPerMonth: 0 });
  const strong = e.scenarios.strong,
    cautious = e.scenarios.cautious;
  assert.equal(e.tierIndex, 1);
  // Strong: 20.5% of 7,000. Cautious: 3.5% of 7,000 is 245, but an account
  // never gets fewer viewers than one at the top of the tier below (5,000 × 9.55%).
  near(strong.storyViewers, 1435, 1e-9);
  near(cautious.storyViewers, 477.5, 1e-9);
  near(strong.month1New, 1435 * visitChance(5, 8) * 0.107, 1e-9);
  near(strong.signups12, 1435 * (1 - 0.95 ** 96) * 0.107, 1e-9);
  near(strong.visitors12, 1435 * (1 - 0.95 ** 96), 1e-9);
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
          // Active subscribers also depend on when people join: in the extreme
          // case (60 Stories, 80% cancellations) earlier joining can move them
          // by a hundred-thousandth; everywhere else they never fall.
          const slack = name.startsWith("daily") ? before.activeMonth12 * 1e-4 : 1e-9;
          assert.ok(now.activeMonth12 >= before.activeMonth12 - slack, `active: ${where}`);
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
  // The bio link counts only when profile visits are entered; it adds exactly
  // visits × (1 − (1 − bio click)^T) × visit to paid.
  const base = at(7000).scenarios.strong,
    bio = at(7000, { profileVisitsPerMonth: 1000 }).scenarios.strong;
  near(bio.month1New - base.month1New, 1000 * 0.03 * 0.107, 1e-9);
  near(bio.signups12 - base.signups12, 1000 * (1 - 0.97 ** 12) * 0.107, 1e-9);
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
  // One person decides once: nothing exceeds the audience × visit to paid.
  const saturated = estimateFollowerConversion(
    { followers: 3, linkStoriesPerMonth: 60, priceAed: 100, ctaReelsPerMonth: 0 },
    {
      ...DEFAULT_FOLLOWER_MODEL,
      tiers: [{ ...DEFAULT_FOLLOWER_MODEL.tiers[0], upTo: null, storyPct: { cautious: 100, typical: 100, strong: 100 } }],
      scenarios: {
        ...DEFAULT_FOLLOWER_MODEL.scenarios,
        strong: { ...DEFAULT_FOLLOWER_MODEL.scenarios.strong, linkClickPct: 100, paidPct: 100 },
      },
    },
  );
  assert.equal(saturated.scenarios.strong.month1New, 3);
  assert.equal(saturated.scenarios.strong.signups12, 3);
  // Display: whole people, or "fewer than 1" (null).
  assert.equal(displayCount(0.99), null);
  assert.equal(displayCount(1.4), 1);
  assert.equal(displayCount(127.6), 128);
  assert.equal(engagementRate(1000, [{ likes: 10, comments: 2 }, { likes: 6, comments: 0 }]), 0.9);
  assert.equal(engagementRate(0, [{ likes: 1 }]), null);
});

test("levers: strong-case gains from one change at a time", () => {
  const levers = followerLevers(DEFAULT_FOLLOWER_INPUTS);
  const by = Object.fromEntries(levers.map((l) => [l.id, l]));
  assert.deepEqual(levers.map((l) => l.id), ["bioLink", "keywordReels", "moreStories", "broadcast"]);
  near(by.bioLink.month1New, 3.21, 1e-9);
  near(by.bioLink.signups12, 1000 * (1 - 0.97 ** 12) * 0.107, 1e-9);
  assert.deepEqual(by.keywordReels.change, { ctaReelsPerMonth: 8 });
  assert.ok(by.keywordReels.signups12 > 5);
  // More Stories bring the same viewers sooner: a big first month, little more over a year.
  assert.deepEqual(by.moreStories.change, { linkStoriesPerMonth: 12 });
  assert.ok(by.moreStories.month1New > 10);
  assert.ok(by.moreStories.signups12 < 2);
  assert.deepEqual(by.broadcast.change, { broadcastMembers: 300, broadcastLinksPerMonth: 4 });
  assert.ok(by.broadcast.month1New > 0);
  // Keyword DMs off: the lever switches them on for 4 Reels.
  const off = followerLevers({ ...DEFAULT_FOLLOWER_INPUTS, keywordDms: false, ctaReelsPerMonth: 0 });
  assert.deepEqual(off.find((l) => l.id === "keywordReels")!.change, { keywordDms: true, ctaReelsPerMonth: 4 });
  // A typical-scenario lever is smaller than the strong one.
  const typical = followerLevers(DEFAULT_FOLLOWER_INPUTS, DEFAULT_FOLLOWER_MODEL, "typical");
  assert.ok(typical[0].signups12 < by.bioLink.signups12);
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
  assert.equal(followerModelFromSettings({ [k.version]: "2026-09-28.2" }).version, "2026-09-28.3");
  assert.equal(edited.tiers[0].storyPct.cautious, 8);
  assert.equal(edited.scenarios.strong.linkClickPct, 4);
  assert.equal(edited.scenarios.strong.paidPct, 10.7);
  // A cautious value above typical (or typical above strong) is inconsistent.
  assert.deepEqual(
    followerModelFromSettings({ [k.rates.paidPct.cautious]: "9" }),
    DEFAULT_FOLLOWER_MODEL,
  );
  assert.deepEqual(
    followerModelFromSettings({ [k.story[2].typical]: "12" }),
    DEFAULT_FOLLOWER_MODEL,
  );
  // Each settings default equals the domain default (one source of truth).
  const marketing = INTEGRATION_CATALOG.find((i) => i.id === "marketing")!;
  assert.equal(marketing.controls, true);
  const defaults = Object.fromEntries(marketing.fields.map((f) => [f.key, f.defaultValue]));
  assert.deepEqual(followerModelFromSettings(defaults as Record<string, string>), DEFAULT_FOLLOWER_MODEL);
  assert.equal(defaults[k.version], DEFAULT_FOLLOWER_MODEL.version);
  assert.deepEqual(
    marketing.fields.find((f) => f.key === k.version)!.supersededValues,
    ["2026-09-28", "2026-09-28.2"],
  );
  for (const tier of k.story) for (const s of FOLLOWER_SCENARIOS) assert.ok(tier[s] in defaults, tier[s]);
  for (const rate of Object.values(k.rates)) for (const s of FOLLOWER_SCENARIOS) assert.ok(rate[s] in defaults, rate[s]);
  // The copy's cited figures equal the domain defaults.
  const project = (s: (typeof FOLLOWER_SCENARIOS)[number]) => {
    const { reelsReachNewPeople: _, ...rates } = DEFAULT_FOLLOWER_MODEL.scenarios[s];
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
