/* trainsyou concept C: calculator maths, ported 1:1 from
 * packages/domain/src/marketing-calculators.ts (assumptions 2026-09-28.4)
 * and packages/domain/src/index.ts (BANDS, commission). Pure functions, no DOM.
 * Exposes window.tyCalc (and module.exports under Node for checks).
 * Do not change a ratio here: every figure is cited on /methodology. */
(function (root) {
  "use strict";

  // ---- Commission bands (packages/domain/src/index.ts) ----
  var BANDS = [
    { count: 100, bps: 2500 },
    { count: 200, bps: 2000 },
    { count: 700, bps: 1500 },
    { count: Infinity, bps: 1000 },
  ];
  /** Commission in fils for one charge at a subscriber position (rounds half up). */
  function commission(amountMinor, rank) {
    var bps = rank <= 100 ? 2500 : rank <= 300 ? 2000 : rank <= 1000 ? 1500 : 1000;
    return Math.floor((amountMinor * bps + 5000) / 10000);
  }
  /** Commission in fils for `count` subscribers all paying `priceMinor`. */
  function projectedCommission(count, priceMinor) {
    var total = 0, left = count, rank = 1;
    for (var b = 0; b < BANDS.length && left > 0; b++) {
      var n = Math.min(left, BANDS[b].count);
      total += n * commission(priceMinor, rank);
      left -= n;
      rank += n;
    }
    return total;
  }

  // ---- Follower model ----
  var SCENARIOS = ["cautious", "typical", "strong"];
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
    followers: [0, 10000000], priceAed: [1, 10000], linkStoriesPerMonth: [0, 60],
    ctaReelsPerMonth: [0, 60], profileVisitsPerMonth: [0, 10000000], broadcastMembers: [0, 10000000],
    broadcastLinksPerMonth: [0, 60], storyViews: [0, 10000000], engagementRatePct: [0, 100], yearlyCancelPct: [5, 80],
  };
  var DEFAULT_FOLLOWER_INPUTS = {
    followers: 7000, priceAed: 199, linkStoriesPerMonth: 8, ctaReelsPerMonth: 4, keywordDms: true,
    profileVisitsPerMonth: null, broadcastMembers: null, broadcastLinksPerMonth: 4, storyViews: null,
    engagementRatePct: null, yearlyCancelPct: 30,
  };
  var MONTHS = 12;

  function clamp(value, lim) {
    return Math.min(lim[1], Math.max(lim[0], Number.isFinite(value) ? value : lim[0]));
  }
  function optional(value, lim) {
    return value === undefined || value === null || !Number.isFinite(value) ? null : Math.floor(clamp(value, lim));
  }
  function visitChance(clickPct, times) {
    var p = Math.min(1, Math.max(0, clickPct / 100));
    return times <= 0 ? 0 : 1 - Math.pow(1 - p, times);
  }
  function monthlyChurn(yearlyPct) {
    var y = Math.min(1, Math.max(0, yearlyPct / 100));
    return y >= 1 ? 1 : 1 - Math.pow(1 - y, 1 / 12);
  }
  function followerInputsUsed(input) {
    var L = FOLLOWER_LIMITS, D = DEFAULT_FOLLOWER_INPUTS;
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
      engagementRatePct: input.engagementRatePct === undefined || input.engagementRatePct === null || !Number.isFinite(input.engagementRatePct)
        ? null : clamp(input.engagementRatePct, L.engagementRatePct),
      yearlyCancelPct: clamp(input.yearlyCancelPct !== undefined && Number.isFinite(input.yearlyCancelPct) ? input.yearlyCancelPct : D.yearlyCancelPct, L.yearlyCancelPct),
    };
  }
  function groupVisits(people, chance, renewal) {
    var out = [], fresh = 1;
    for (var m = 0; m < MONTHS; m++) {
      out.push(people > 0 ? people * chance * fresh : 0);
      fresh = (1 - renewal) * (1 - chance) * fresh + renewal;
    }
    return out;
  }
  function addInto(total, add) { add.forEach(function (v, m) { total[m] += v; }); }
  function cumulate(values) { var s = 0; return values.map(function (v) { return (s += v); }); }
  function nestedVisits(channels, renewal) {
    var sizes = Array.from(new Set(channels.map(function (c) { return c.people; })))
      .filter(function (s) { return s > 0; }).sort(function (a, b) { return a - b; });
    var total = new Array(MONTHS).fill(0), previous = 0;
    sizes.forEach(function (size) {
      var miss = 1;
      channels.forEach(function (c) { if (c.people >= size) miss *= 1 - c.chance; });
      addInto(total, groupVisits(size - previous, 1 - miss, renewal));
      previous = size;
    });
    return total;
  }
  function followerTierIndex(followers, model) {
    model = model || MODEL;
    return Math.max(0, model.tiers.findIndex(function (t) { return t.upTo === null || followers <= t.upTo; }));
  }
  function tiersUpTo(model, followers) {
    var index = followerTierIndex(followers, model);
    return model.tiers.slice(0, index + 1).map(function (t) { return [t, Math.min(followers, t.upTo === null ? Infinity : t.upTo)]; });
  }
  function audiences(model, scenario, i, engagement) {
    var F = i.followers, rates = model.scenarios[scenario];
    var storyShare = function (tier) {
      return rates.engagedStoryShare
        ? Math.max(tier.storyPct[scenario] * Math.min(1, engagement), tier.storyPct.typical * engagement)
        : tier.storyPct[scenario] * engagement;
    };
    var tiers = tiersUpTo(model, F);
    return {
      story: i.storyViews !== null ? i.storyViews : Math.max.apply(null, [0].concat(tiers.map(function (p) {
        return Math.min(p[1], (p[1] * storyShare(p[0])) / 100);
      }))),
      reels: tiers.map(function (p) {
        return {
          viewers: Math.min(p[1], (p[1] * p[0].reelPct[scenario]) / 100),
          perView: Math.min(1, (engagement * p[0].commentsPerViewPct * model.keywordCommentFactor) / 100) * (rates.dmOpenPct / 100),
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
    if (reels && rates.reelsReachNewPeople) addInto(total, new Array(MONTHS).fill(reel.viewers * reel.perView * i.ctaReelsPerMonth));
    if (i.profileVisitsPerMonth) addInto(total, groupVisits(i.profileVisitsPerMonth, rates.bioClickPct / 100, renewal));
    return total;
  }
  function displayCount(value) { return value < 1 ? null : Math.round(value); }

  function estimateFollowerConversion(input, model) {
    model = model || MODEL;
    var i = followerInputsUsed(input), max = model.engagementFactorMax;
    var engagement = i.engagementRatePct === null ? 1
      : Math.min(max, Math.max(1 / max, i.engagementRatePct / model.engagementBenchmarkPct));
    var churn = monthlyChurn(i.yearlyCancelPct);
    function run(scenario) {
      var rates = model.scenarios[scenario];
      var reach = audiences(model, scenario, i, engagement);
      var paid = rates.paidPct / 100;
      var byMonth = (reach.reels.length ? reach.reels : [{ viewers: 0, perView: 0 }])
        .map(function (reel) { return cumulate(monthlyVisits(reach, reel, rates, i)); });
      var upTo = byMonth[0].map(function (_, m) { return Math.max.apply(null, byMonth.map(function (c) { return c[m]; })); });
      var visits = upTo.map(function (c, m) { return c - (m ? upTo[m - 1] : 0); });
      var newByMonth = visits.map(function (p) { return paid * p; });
      var activeByMonth = [];
      newByMonth.forEach(function (n, m) { activeByMonth.push((m ? activeByMonth[m - 1] * (1 - churn) : 0) + n); });
      var activeMonth12 = activeByMonth[MONTHS - 1];
      return {
        scenario: scenario,
        storyViewers: reach.story,
        visitors12: visits.reduce(function (s, v) { return s + v; }, 0),
        newByMonth: newByMonth,
        activeByMonth: activeByMonth,
        month1New: newByMonth[0],
        activeMonth12: activeMonth12,
        signups12: newByMonth.reduce(function (s, n) { return s + n; }, 0),
        revenueMonth12Minor: (displayCount(activeMonth12) || 0) * i.priceAed * 100,
      };
    }
    return {
      inputs: i,
      tierIndex: followerTierIndex(i.followers, model),
      engagementFactor: engagement,
      monthlyCancelPct: churn * 100,
      scenarios: { cautious: run("cautious"), typical: run("typical"), strong: run("strong") },
      assumptionsVersion: model.version,
    };
  }
  function followerLevers(input, model, scenario) {
    model = model || MODEL; scenario = scenario || "strong";
    var base = estimateFollowerConversion(input, model);
    var i = base.inputs, now = base.scenarios[scenario];
    var cap = function (n) { return Math.min(60, n); };
    var changes = [
      ["bioLink", { profileVisitsPerMonth: (i.profileVisitsPerMonth || 0) + 1000 }],
      ["keywordReels", i.keywordDms && i.ctaReelsPerMonth > 0
        ? { ctaReelsPerMonth: cap(i.ctaReelsPerMonth + 4) }
        : { keywordDms: true, ctaReelsPerMonth: Math.max(i.ctaReelsPerMonth, 4) }],
      ["moreStories", { linkStoriesPerMonth: cap(i.linkStoriesPerMonth + 4) }],
      ["broadcast", i.broadcastMembers
        ? { broadcastMembers: i.broadcastMembers + 300 }
        : { broadcastMembers: 300, broadcastLinksPerMonth: i.broadcastLinksPerMonth || 4 }],
    ];
    return changes.map(function (c) {
      var next = estimateFollowerConversion(Object.assign({}, i, c[1]), model).scenarios[scenario];
      return {
        id: c[0], change: c[1],
        month1New: next.month1New - now.month1New,
        signups12: next.signups12 - now.signups12,
        activeMonth12: next.activeMonth12 - now.activeMonth12,
        revenueMonth12Minor: next.revenueMonth12Minor - now.revenueMonth12Minor,
      };
    }).filter(function (l) { return l.activeMonth12 >= -1e-9; });
  }

  // ---- Earnings ----
  var EARNINGS_LIMITS = { subscribers: [0, 100000], priceAed: [0, 10000], sharePct: [0, 100], programmeMonths: [1, 24], sessionsPerMonth: [0, 1000] };
  var DEFAULT_EARNINGS_INPUTS = {
    subscribers: 60, billing: "monthly", workoutPriceAed: 199, programmeMonths: 3, nutritionSharePct: 30,
    nutritionPriceAed: 299, voiceSharePct: 0, voicePriceAed: 49, sessionsPerMonth: 0, sessionPriceAed: 250, yourSessionRateAed: 250,
  };
  function estimateEarnings(input) {
    var L = EARNINGS_LIMITS;
    var n = Math.floor(clamp(input.subscribers, L.subscribers));
    var months = Math.floor(clamp(input.programmeMonths, L.programmeMonths));
    var price = function (v) { return Math.round(clamp(v, L.priceAed) * 100); };
    var share = function (v) { return clamp(v, L.sharePct) / 100; };
    var perMonth = function (minor) { return input.billing === "upfront" ? minor / months : minor; };
    var nutritionShare = share(input.nutritionSharePct);
    var averageMonthlyMinor = Math.round(
      perMonth(price(input.workoutPriceAed)) * (1 - nutritionShare) +
      perMonth(price(input.nutritionPriceAed)) * nutritionShare +
      price(input.voicePriceAed) * share(input.voiceSharePct));
    var bands = [], left = n, rank = 1, commissionMinor = 0;
    BANDS.forEach(function (band) {
      var count = Math.min(left, band.count);
      var bandCommission = count * commission(averageMonthlyMinor, rank);
      bands.push({ from: rank, to: band.count === Infinity ? null : rank + band.count - 1, ratePct: band.bps / 100, subscribers: count, commissionMinor: bandCommission });
      commissionMinor += bandCommission;
      left -= count;
      rank += band.count === Infinity ? count : band.count;
    });
    var subscriptionMonthlyMinor = averageMonthlyMinor * n;
    var sessionsMonthlyMinor = Math.floor(clamp(input.sessionsPerMonth, L.sessionsPerMonth)) * price(input.sessionPriceAed);
    var beforeOtherCostsMinor = subscriptionMonthlyMinor - commissionMinor + sessionsMonthlyMinor;
    var rate = price(input.yourSessionRateAed);
    return {
      averageMonthlyMinor: averageMonthlyMinor,
      subscriptionMonthlyMinor: subscriptionMonthlyMinor,
      sessionsMonthlyMinor: sessionsMonthlyMinor,
      commissionMinor: commissionMinor,
      effectiveCommissionPct: subscriptionMonthlyMinor ? Math.round((commissionMinor / subscriptionMonthlyMinor) * 10000) / 100 : 0,
      bands: bands,
      beforeOtherCostsMinor: beforeOtherCostsMinor,
      equivalentSessions: rate > 0 ? Math.round(beforeOtherCostsMinor / rate) : null,
    };
  }

  // ---- Formatting (same as islands.tsx) ----
  var nfWhole = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 });
  var nfPct = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 });
  /** "AED 22,885" from fils. Uses a plain space so slots measure predictably. */
  function aedWhole(minor) { return "AED " + nfWhole.format(Math.round(minor / 100)); }
  function whole(n) { return nfWhole.format(n); }
  function pct(n) { return nfPct.format(n) + "%"; }
  function countLabel(n) { var c = displayCount(n); return c === null ? "fewer than 1" : whole(c); }
  /** Blended commission rate (%) for `count` subscribers at one price. */
  function blendedRatePct(count, priceAed) {
    if (count <= 0) return 0;
    var minor = Math.round(priceAed * 100);
    return (projectedCommission(count, minor) / (count * minor)) * 100;
  }
  function slugFromName(name) {
    var slug = String(name).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "").slice(0, 40).replace(/-+$/, "");
    return slug.length >= 3 ? slug : "";
  }

  var api = {
    BANDS: BANDS, commission: commission, projectedCommission: projectedCommission, blendedRatePct: blendedRatePct,
    FOLLOWER_SCENARIOS: SCENARIOS, FOLLOWER_MODEL: MODEL, FOLLOWER_LIMITS: FOLLOWER_LIMITS, DEFAULT_FOLLOWER_INPUTS: DEFAULT_FOLLOWER_INPUTS,
    estimateFollowerConversion: estimateFollowerConversion, followerLevers: followerLevers, followerTierIndex: followerTierIndex,
    visitChance: visitChance, monthlyChurn: monthlyChurn, displayCount: displayCount,
    EARNINGS_LIMITS: EARNINGS_LIMITS, DEFAULT_EARNINGS_INPUTS: DEFAULT_EARNINGS_INPUTS, estimateEarnings: estimateEarnings,
    aedWhole: aedWhole, whole: whole, pct: pct, countLabel: countLabel, slugFromName: slugFromName,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.tyCalc = api;
})(typeof self !== "undefined" ? self : this);
