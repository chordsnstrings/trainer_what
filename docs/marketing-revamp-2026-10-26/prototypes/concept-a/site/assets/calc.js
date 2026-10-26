/* trainsyou concept A: calculator maths.
 * An exact port of packages/domain/src/marketing-calculators.ts
 * (follower assumptions version 2026-09-28.4) and packages/domain/src/index.ts
 * (BANDS, commission). Pure functions only; no DOM. Exposed as window.tyCalc.
 * Never change a ratio here without changing the source module first. */
(function (g) {
  "use strict";
  var BANDS = [
    { count: 100, bps: 2500 },
    { count: 200, bps: 2000 },
    { count: 700, bps: 1500 },
    { count: Infinity, bps: 1000 },
  ];
  /** Commission in fils for one subscriber at `rank` paying `amountMinor`. */
  function commission(amountMinor, rank) {
    var bps = rank <= 100 ? 2500 : rank <= 300 ? 2000 : rank <= 1000 ? 1500 : 1000;
    // BigInt rounding in the source: (amount * bps + 5000) / 10000, floored.
    return Math.floor((amountMinor * bps + 5000) / 10000);
  }

  var SCEN = ["cautious", "typical", "strong"];
  var MODEL = {
    version: "2026-09-28.4",
    tiers: [
      { upTo: 5000, storyPct: { cautious: 9.55, typical: 10.4, strong: 20.5 }, reelPct: { cautious: 6.65, typical: 9.78, strong: 9.78 }, commentsPerViewPct: 0.52 },
      { upTo: 10000, storyPct: { cautious: 3.5, typical: 5, strong: 20.5 }, reelPct: { cautious: 5.75, typical: 7.55, strong: 7.55 }, commentsPerViewPct: 0.6 },
      { upTo: 50000, storyPct: { cautious: 1.35, typical: 5, strong: 8 }, reelPct: { cautious: 5.5, typical: 7.1, strong: 7.1 }, commentsPerViewPct: 0.49 },
      { upTo: 100000, storyPct: { cautious: 0.55, typical: 5, strong: 6.5 }, reelPct: { cautious: 4.5, typical: 5.6, strong: 5.6 }, commentsPerViewPct: 0.36 },
      { upTo: null, storyPct: { cautious: 0.5, typical: 5, strong: 5 }, reelPct: { cautious: 3.5, typical: 5, strong: 5 }, commentsPerViewPct: 0.37 },
    ],
    scenarios: {
      cautious: { linkClickPct: 1, dmOpenPct: 18, broadcastClickPct: 1.27, bioClickPct: 1, paidPct: 0.72, audienceRenewalPct: 0, reelsReachNewPeople: false, engagedStoryShare: false },
      typical: { linkClickPct: 3, dmOpenPct: 30, broadcastClickPct: 1.45, bioClickPct: 2, paidPct: 2.9, audienceRenewalPct: 1.5, reelsReachNewPeople: true, engagedStoryShare: false },
      strong: { linkClickPct: 5, dmOpenPct: 45, broadcastClickPct: 2.09, bioClickPct: 3, paidPct: 6.2, audienceRenewalPct: 8, reelsReachNewPeople: true, engagedStoryShare: true },
    },
    keywordCommentFactor: 2.0278,
    engagementBenchmarkPct: 0.48,
    engagementFactorMax: 2,
  };
  var FOLLOWER_LIMITS = {
    followers: [0, 10000000], priceAed: [1, 10000], linkStoriesPerMonth: [0, 60], ctaReelsPerMonth: [0, 60],
    profileVisitsPerMonth: [0, 10000000], broadcastMembers: [0, 10000000], broadcastLinksPerMonth: [0, 60],
    storyViews: [0, 10000000], engagementRatePct: [0, 100], yearlyCancelPct: [5, 80],
  };
  var FOLLOWER_DEFAULTS = {
    followers: 7000, priceAed: 199, linkStoriesPerMonth: 8, ctaReelsPerMonth: 4, keywordDms: true,
    profileVisitsPerMonth: null, broadcastMembers: null, broadcastLinksPerMonth: 4, storyViews: null,
    engagementRatePct: null, yearlyCancelPct: 30,
  };
  var MONTHS = 12;
  var fin = function (v) { return typeof v === "number" && isFinite(v); };
  function clamp(value, lim) { return Math.min(lim[1], Math.max(lim[0], fin(value) ? value : lim[0])); }
  function optional(value, lim) { return value === undefined || value === null || !fin(value) ? null : Math.floor(clamp(value, lim)); }
  function visitChance(clickPct, times) { var p = Math.min(1, Math.max(0, clickPct / 100)); return times <= 0 ? 0 : 1 - Math.pow(1 - p, times); }
  function monthlyChurn(yearlyPct) { var y = Math.min(1, Math.max(0, yearlyPct / 100)); return y >= 1 ? 1 : 1 - Math.pow(1 - y, 1 / 12); }
  function displayCount(v) { return v < 1 ? null : Math.round(v); }

  function followerInputsUsed(input) {
    var L = FOLLOWER_LIMITS, D = FOLLOWER_DEFAULTS;
    var whole = function (v, lim, fb) { return Math.floor(clamp(v === undefined || v === null ? fb : v, lim)); };
    var followers = whole(input.followers, L.followers, 0);
    var members = optional(input.broadcastMembers, L.broadcastMembers);
    var views = optional(input.storyViews, L.storyViews);
    return {
      followers: followers,
      priceAed: Math.round(clamp(input.priceAed, L.priceAed)),
      linkStoriesPerMonth: whole(input.linkStoriesPerMonth, L.linkStoriesPerMonth, 0),
      ctaReelsPerMonth: whole(input.ctaReelsPerMonth, L.ctaReelsPerMonth, D.ctaReelsPerMonth),
      keywordDms: input.keywordDms === undefined || input.keywordDms === null ? D.keywordDms : input.keywordDms,
      profileVisitsPerMonth: optional(input.profileVisitsPerMonth, L.profileVisitsPerMonth),
      broadcastMembers: members === null ? null : Math.min(members, followers),
      broadcastLinksPerMonth: whole(input.broadcastLinksPerMonth, L.broadcastLinksPerMonth, D.broadcastLinksPerMonth),
      storyViews: views === null ? null : Math.min(views, followers),
      engagementRatePct: input.engagementRatePct === undefined || input.engagementRatePct === null || !fin(input.engagementRatePct) ? null : clamp(input.engagementRatePct, L.engagementRatePct),
      yearlyCancelPct: clamp(input.yearlyCancelPct !== undefined && fin(input.yearlyCancelPct) ? input.yearlyCancelPct : D.yearlyCancelPct, L.yearlyCancelPct),
    };
  }
  function groupVisits(people, chance, renewal) {
    var out = [], fresh = 1;
    for (var m = 0; m < MONTHS; m++) { out.push(people > 0 ? people * chance * fresh : 0); fresh = (1 - renewal) * (1 - chance) * fresh + renewal; }
    return out;
  }
  function addInto(total, add) { add.forEach(function (v, m) { total[m] += v; }); }
  function cumulate(values) { var s = 0; return values.map(function (v) { return (s += v); }); }
  function zeros() { var a = []; for (var m = 0; m < MONTHS; m++) a.push(0); return a; }
  function nestedVisits(channels, renewal) {
    var sizes = [];
    channels.forEach(function (c) { if (c.people > 0 && sizes.indexOf(c.people) < 0) sizes.push(c.people); });
    sizes.sort(function (a, b) { return a - b; });
    var total = zeros(), previous = 0;
    sizes.forEach(function (size) {
      var miss = 1;
      channels.forEach(function (c) { if (c.people >= size) miss *= 1 - c.chance; });
      addInto(total, groupVisits(size - previous, 1 - miss, renewal));
      previous = size;
    });
    return total;
  }
  function tierIndex(followers) {
    var t = MODEL.tiers;
    for (var k = 0; k < t.length; k++) if (t[k].upTo === null || followers <= t[k].upTo) return k;
    return 0;
  }
  function tiersUpTo(followers) {
    var idx = tierIndex(followers);
    return MODEL.tiers.slice(0, idx + 1).map(function (t) { return [t, Math.min(followers, t.upTo === null ? Infinity : t.upTo)]; });
  }
  function audiences(scenario, i, engagement) {
    var F = i.followers, rates = MODEL.scenarios[scenario];
    var storyShare = function (tier) {
      return rates.engagedStoryShare
        ? Math.max(tier.storyPct[scenario] * Math.min(1, engagement), tier.storyPct.typical * engagement)
        : tier.storyPct[scenario] * engagement;
    };
    var tiers = tiersUpTo(F);
    var story = i.storyViews;
    if (story === null) {
      story = 0;
      tiers.forEach(function (p) { story = Math.max(story, Math.min(p[1], (p[1] * storyShare(p[0])) / 100)); });
    }
    return {
      story: story,
      reels: tiers.map(function (p) {
        return {
          viewers: Math.min(p[1], (p[1] * p[0].reelPct[scenario]) / 100),
          perView: Math.min(1, (engagement * p[0].commentsPerViewPct * MODEL.keywordCommentFactor) / 100) * (rates.dmOpenPct / 100),
        };
      }),
      broadcast: Math.min(F, i.broadcastMembers || 0),
    };
  }
  function monthlyVisits(a, reel, rates, i) {
    var renewal = rates.audienceRenewalPct / 100, channels = [];
    if (i.linkStoriesPerMonth > 0) channels.push({ people: a.story, chance: visitChance(rates.linkClickPct, i.linkStoriesPerMonth) });
    if (a.broadcast > 0 && i.broadcastLinksPerMonth > 0) channels.push({ people: a.broadcast, chance: visitChance(rates.broadcastClickPct, i.broadcastLinksPerMonth) });
    var reels = i.keywordDms && i.ctaReelsPerMonth > 0 && reel.viewers > 0;
    if (reels && !rates.reelsReachNewPeople) channels.push({ people: reel.viewers, chance: visitChance(reel.perView * 100, i.ctaReelsPerMonth) });
    var total = nestedVisits(channels, renewal);
    if (reels && rates.reelsReachNewPeople) addInto(total, zeros().map(function () { return reel.viewers * reel.perView * i.ctaReelsPerMonth; }));
    if (i.profileVisitsPerMonth) addInto(total, groupVisits(i.profileVisitsPerMonth, rates.bioClickPct / 100, renewal));
    return total;
  }
  /** Follower-to-subscriber estimate for the three scenarios (pure, clamped). */
  function estimateFollowers(input) {
    var i = followerInputsUsed(input), max = MODEL.engagementFactorMax;
    var engagement = i.engagementRatePct === null ? 1 : Math.min(max, Math.max(1 / max, i.engagementRatePct / MODEL.engagementBenchmarkPct));
    var churn = monthlyChurn(i.yearlyCancelPct);
    var run = function (scenario) {
      var rates = MODEL.scenarios[scenario], reach = audiences(scenario, i, engagement), paid = rates.paidPct / 100;
      var list = reach.reels.length ? reach.reels : [{ viewers: 0, perView: 0 }];
      var byMonth = list.map(function (reel) { return cumulate(monthlyVisits(reach, reel, rates, i)); });
      var upTo = byMonth[0].map(function (_, m) { return Math.max.apply(null, byMonth.map(function (c) { return c[m]; })); });
      var visits = upTo.map(function (c, m) { return c - (m ? upTo[m - 1] : 0); });
      var newByMonth = visits.map(function (p) { return paid * p; });
      var active = [];
      newByMonth.forEach(function (n, m) { active.push((m ? active[m - 1] * (1 - churn) : 0) + n); });
      var activeMonth12 = active[MONTHS - 1];
      return {
        scenario: scenario,
        storyViewers: reach.story,
        visitors12: visits.reduce(function (s, v) { return s + v; }, 0),
        newByMonth: newByMonth,
        activeByMonth: active,
        month1New: newByMonth[0],
        activeMonth12: activeMonth12,
        signups12: newByMonth.reduce(function (s, n) { return s + n; }, 0),
        revenueMonth12Minor: (displayCount(activeMonth12) || 0) * i.priceAed * 100,
      };
    };
    var out = { inputs: i, tierIndex: tierIndex(i.followers), engagementFactor: engagement, monthlyCancelPct: churn * 100, scenarios: {}, assumptionsVersion: MODEL.version };
    SCEN.forEach(function (s) { out.scenarios[s] = run(s); });
    return out;
  }

  var EARNINGS_LIMITS = { subscribers: [0, 100000], priceAed: [0, 10000], sharePct: [0, 100], programmeMonths: [1, 24], sessionsPerMonth: [0, 1000] };
  var EARNINGS_DEFAULTS = {
    subscribers: 60, billing: "monthly", workoutPriceAed: 199, programmeMonths: 3, nutritionSharePct: 30, nutritionPriceAed: 299,
    voiceSharePct: 0, voicePriceAed: 49, sessionsPerMonth: 0, sessionPriceAed: 250, yourSessionRateAed: 250,
  };
  /** Monthly earnings estimate; commission follows the marginal bands. */
  function estimateEarnings(input) {
    var L = EARNINGS_LIMITS;
    var n = Math.floor(clamp(input.subscribers, L.subscribers));
    var months = Math.floor(clamp(input.programmeMonths, L.programmeMonths));
    var price = function (v) { return Math.round(clamp(v, L.priceAed) * 100); };
    var share = function (v) { return clamp(v, L.sharePct) / 100; };
    var perMonth = function (minor) { return input.billing === "upfront" ? minor / months : minor; };
    var ns = share(input.nutritionSharePct);
    var avg = Math.round(perMonth(price(input.workoutPriceAed)) * (1 - ns) + perMonth(price(input.nutritionPriceAed)) * ns + price(input.voicePriceAed) * share(input.voiceSharePct));
    var bands = [], left = n, rank = 1, comm = 0;
    BANDS.forEach(function (band) {
      var count = Math.min(left, band.count), bc = count * commission(avg, rank);
      bands.push({ from: rank, to: band.count === Infinity ? null : rank + band.count - 1, ratePct: band.bps / 100, subscribers: count, commissionMinor: bc });
      comm += bc; left -= count; rank += band.count === Infinity ? count : band.count;
    });
    var subs = avg * n;
    var sessions = Math.floor(clamp(input.sessionsPerMonth, L.sessionsPerMonth)) * price(input.sessionPriceAed);
    var before = subs - comm + sessions, rate = price(input.yourSessionRateAed);
    return {
      averageMonthlyMinor: avg, subscriptionMonthlyMinor: subs, sessionsMonthlyMinor: sessions, commissionMinor: comm,
      effectiveCommissionPct: subs ? Math.round((comm / subs) * 10000) / 100 : 0,
      bands: bands, beforeOtherCostsMinor: before, equivalentSessions: rate > 0 ? Math.round(before / rate) : null,
    };
  }
  /** The compact calculator's inputs: subscriptions only, no add-ons or sessions. */
  function compactEarnings(subscribers, priceAed, yourRateAed) {
    var d = EARNINGS_DEFAULTS;
    return estimateEarnings({
      subscribers: subscribers, billing: "monthly", workoutPriceAed: priceAed, programmeMonths: d.programmeMonths,
      nutritionSharePct: 0, nutritionPriceAed: d.nutritionPriceAed, voiceSharePct: 0, voicePriceAed: d.voicePriceAed,
      sessionsPerMonth: 0, sessionPriceAed: d.sessionPriceAed, yourSessionRateAed: yourRateAed,
    });
  }

  var nf0 = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 });
  var api = {
    BANDS: BANDS, commission: commission, FOLLOWER_MODEL: MODEL, FOLLOWER_LIMITS: FOLLOWER_LIMITS, FOLLOWER_DEFAULTS: FOLLOWER_DEFAULTS,
    EARNINGS_LIMITS: EARNINGS_LIMITS, EARNINGS_DEFAULTS: EARNINGS_DEFAULTS, estimateFollowers: estimateFollowers,
    estimateEarnings: estimateEarnings, compactEarnings: compactEarnings, displayCount: displayCount, visitChance: visitChance, monthlyChurn: monthlyChurn,
    /** "AED 22,885" from fils (whole dirhams, as the live site prints). */
    aed: function (minor) { return "AED " + nf0.format(Math.round(minor / 100)); },
    whole: function (n) { return nf0.format(n); },
    pct: function (n, dp) { return new Intl.NumberFormat("en-AE", { maximumFractionDigits: dp === undefined ? 1 : dp }).format(n) + "%"; },
  };
  g.tyCalc = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
