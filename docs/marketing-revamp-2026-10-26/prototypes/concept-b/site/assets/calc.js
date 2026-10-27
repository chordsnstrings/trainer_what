/* trainsyou Concept B · calculator maths and bindings (foundation-owned).
   The maths is ported line for line from
   packages/domain/src/marketing-calculators.ts (follower model version
   2026-09-28.4) and packages/domain/src/index.ts (BANDS, commission).
   Never change a ratio here. The same file runs in Node at build time so
   first-paint figures are real HTML (no count-up on load). */
(function (g) {
  "use strict";

  /* ---------------- Commission bands (domain index.ts) -------------------- */
  var BANDS = [
    { count: 100, bps: 2500 },
    { count: 200, bps: 2000 },
    { count: 700, bps: 1500 },
    { count: Infinity, bps: 1000 },
  ];
  function commission(amountMinor, rank) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !Number.isSafeInteger(rank) || rank < 1)
      throw new Error("Invalid commission inputs");
    var bps = rank <= 100 ? 2500 : rank <= 300 ? 2000 : rank <= 1000 ? 1500 : 1000;
    return Number((BigInt(amountMinor) * BigInt(bps) + 5000n) / 10000n);
  }

  /* ---------------- Follower model ---------------------------------------- */
  var FOLLOWER_SCENARIOS = ["cautious", "typical", "strong"];
  var DEFAULT_FOLLOWER_MODEL = {
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
  var DEFAULT_FOLLOWER_INPUTS = {
    followers: 7000, priceAed: 199, linkStoriesPerMonth: 8, ctaReelsPerMonth: 4, keywordDms: true,
    profileVisitsPerMonth: null, broadcastMembers: null, broadcastLinksPerMonth: 4, storyViews: null,
    engagementRatePct: null, yearlyCancelPct: 30,
  };

  var clamp = function (value, lim) { return Math.min(lim[1], Math.max(lim[0], Number.isFinite(value) ? value : lim[0])); };
  var optional = function (value, lim) { return value === undefined || value === null || !Number.isFinite(value) ? null : Math.floor(clamp(value, lim)); };
  function visitChance(clickPct, times) { var p = Math.min(1, Math.max(0, clickPct / 100)); return times <= 0 ? 0 : 1 - Math.pow(1 - p, times); }
  function monthlyChurn(yearlyPct) { var y = Math.min(1, Math.max(0, yearlyPct / 100)); return y >= 1 ? 1 : 1 - Math.pow(1 - y, 1 / 12); }

  function followerInputsUsed(input) {
    var L = FOLLOWER_LIMITS, D = DEFAULT_FOLLOWER_INPUTS;
    var whole = function (value, lim, fallback) { return Math.floor(clamp(value === undefined || value === null ? fallback : value, lim)); };
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

  var MONTHS = 12;
  function groupVisits(people, chance, renewal) {
    var out = [], fresh = 1;
    for (var m = 0; m < MONTHS; m++) { out.push(people > 0 ? people * chance * fresh : 0); fresh = (1 - renewal) * (1 - chance) * fresh + renewal; }
    return out;
  }
  var addInto = function (total, add) { add.forEach(function (v, m) { total[m] += v; }); };
  var cumulate = function (values) { var sum = 0; return values.map(function (v) { return (sum += v); }); };
  function nestedVisits(channels, renewal) {
    var sizes = Array.from(new Set(channels.map(function (c) { return c.people; }))).filter(function (s) { return s > 0; }).sort(function (a, b) { return a - b; });
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
    model = model || DEFAULT_FOLLOWER_MODEL;
    return Math.max(0, model.tiers.findIndex(function (t) { return t.upTo === null || followers <= t.upTo; }));
  }
  function tiersUpTo(model, followers) {
    var index = followerTierIndex(followers, model);
    return model.tiers.slice(0, index + 1).map(function (tier) { return [tier, Math.min(followers, tier.upTo === null ? Infinity : tier.upTo)]; });
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
      story: i.storyViews !== null && i.storyViews !== undefined ? i.storyViews
        : Math.max.apply(null, [0].concat(tiers.map(function (ta) { return Math.min(ta[1], (ta[1] * storyShare(ta[0])) / 100); }))),
      reels: tiers.map(function (ta) {
        return {
          viewers: Math.min(ta[1], (ta[1] * ta[0].reelPct[scenario]) / 100),
          perView: Math.min(1, (engagement * ta[0].commentsPerViewPct * model.keywordCommentFactor) / 100) * (rates.dmOpenPct / 100),
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
    model = model || DEFAULT_FOLLOWER_MODEL;
    var i = followerInputsUsed(input), max = model.engagementFactorMax;
    var engagement = i.engagementRatePct === null ? 1 : Math.min(max, Math.max(1 / max, i.engagementRatePct / model.engagementBenchmarkPct));
    var churn = monthlyChurn(i.yearlyCancelPct);
    var run = function (scenario) {
      var rates = model.scenarios[scenario], reach = audiences(model, scenario, i, engagement), paid = rates.paidPct / 100;
      var byMonth = (reach.reels.length ? reach.reels : [{ viewers: 0, perView: 0 }]).map(function (reel) { return cumulate(monthlyVisits(reach, reel, rates, i)); });
      var upTo = byMonth[0].map(function (_, m) { return Math.max.apply(null, byMonth.map(function (c) { return c[m]; })); });
      var visits = upTo.map(function (c, m) { return c - (m ? upTo[m - 1] : 0); });
      var newByMonth = visits.map(function (people) { return paid * people; });
      var activeByMonth = [];
      newByMonth.forEach(function (n, m) { activeByMonth.push((m ? activeByMonth[m - 1] * (1 - churn) : 0) + n); });
      var activeMonth12 = activeByMonth[MONTHS - 1];
      return {
        scenario: scenario, storyViewers: reach.story, visitors12: visits.reduce(function (s, v) { return s + v; }, 0),
        newByMonth: newByMonth, activeByMonth: activeByMonth, month1New: newByMonth[0], activeMonth12: activeMonth12,
        signups12: newByMonth.reduce(function (s, n) { return s + n; }, 0),
        revenueMonth12Minor: (displayCount(activeMonth12) || 0) * i.priceAed * 100,
      };
    };
    return {
      inputs: i, tierIndex: followerTierIndex(i.followers, model), engagementFactor: engagement, monthlyCancelPct: churn * 100,
      scenarios: { cautious: run("cautious"), typical: run("typical"), strong: run("strong") }, assumptionsVersion: model.version,
    };
  }

  function followerLevers(input, model, scenario) {
    model = model || DEFAULT_FOLLOWER_MODEL; scenario = scenario || "strong";
    var base = estimateFollowerConversion(input, model), i = base.inputs, now = base.scenarios[scenario];
    var cap = function (n) { return Math.min(60, n); };
    var changes = [
      ["bioLink", { profileVisitsPerMonth: (i.profileVisitsPerMonth || 0) + 1000 }],
      ["keywordReels", i.keywordDms && i.ctaReelsPerMonth > 0 ? { ctaReelsPerMonth: cap(i.ctaReelsPerMonth + 4) } : { keywordDms: true, ctaReelsPerMonth: Math.max(i.ctaReelsPerMonth, 4) }],
      ["moreStories", { linkStoriesPerMonth: cap(i.linkStoriesPerMonth + 4) }],
      ["broadcast", i.broadcastMembers ? { broadcastMembers: i.broadcastMembers + 300 } : { broadcastMembers: 300, broadcastLinksPerMonth: i.broadcastLinksPerMonth || 4 }],
    ];
    return changes.map(function (c) {
      var next = estimateFollowerConversion(Object.assign({}, i, c[1]), model).scenarios[scenario];
      return { id: c[0], change: c[1], month1New: next.month1New - now.month1New, signups12: next.signups12 - now.signups12,
        activeMonth12: next.activeMonth12 - now.activeMonth12, revenueMonth12Minor: next.revenueMonth12Minor - now.revenueMonth12Minor };
    }).filter(function (l) { return l.activeMonth12 >= -1e-9; });
  }

  /* ---------------- Earnings ---------------------------------------------- */
  var EARNINGS_LIMITS = { subscribers: [0, 100000], priceAed: [0, 10000], sharePct: [0, 100], programmeMonths: [1, 24], sessionsPerMonth: [0, 1000] };
  var DEFAULT_EARNINGS_INPUTS = {
    subscribers: 60, billing: "monthly", workoutPriceAed: 199, programmeMonths: 3, nutritionSharePct: 30, nutritionPriceAed: 299,
    voiceSharePct: 0, voicePriceAed: 49, sessionsPerMonth: 0, sessionPriceAed: 250, yourSessionRateAed: 250,
  };
  function estimateEarnings(input) {
    var n = Math.floor(clamp(input.subscribers, EARNINGS_LIMITS.subscribers)),
      months = Math.floor(clamp(input.programmeMonths, EARNINGS_LIMITS.programmeMonths)),
      price = function (v) { return Math.round(clamp(v, EARNINGS_LIMITS.priceAed) * 100); },
      share = function (v) { return clamp(v, EARNINGS_LIMITS.sharePct) / 100; };
    var perMonth = function (minor) { return input.billing === "upfront" ? minor / months : minor; };
    var nutritionShare = share(input.nutritionSharePct);
    var averageMonthlyMinor = Math.round(
      perMonth(price(input.workoutPriceAed)) * (1 - nutritionShare) + perMonth(price(input.nutritionPriceAed)) * nutritionShare + price(input.voicePriceAed) * share(input.voiceSharePct));
    var bands = [], left = n, rank = 1, commissionMinor = 0;
    BANDS.forEach(function (band) {
      var count = Math.min(left, band.count), bandCommission = count * commission(averageMonthlyMinor, rank);
      bands.push({ from: rank, to: band.count === Infinity ? null : rank + band.count - 1, ratePct: band.bps / 100, subscribers: count, commissionMinor: bandCommission });
      commissionMinor += bandCommission; left -= count; rank += band.count === Infinity ? count : band.count;
    });
    var subscriptionMonthlyMinor = averageMonthlyMinor * n,
      sessionsMonthlyMinor = Math.floor(clamp(input.sessionsPerMonth, EARNINGS_LIMITS.sessionsPerMonth)) * price(input.sessionPriceAed),
      beforeOtherCostsMinor = subscriptionMonthlyMinor - commissionMinor + sessionsMonthlyMinor,
      rate = price(input.yourSessionRateAed);
    return {
      averageMonthlyMinor: averageMonthlyMinor, subscriptionMonthlyMinor: subscriptionMonthlyMinor, sessionsMonthlyMinor: sessionsMonthlyMinor,
      commissionMinor: commissionMinor,
      effectiveCommissionPct: subscriptionMonthlyMinor ? Math.round((commissionMinor / subscriptionMonthlyMinor) * 10000) / 100 : 0,
      bands: bands, beforeOtherCostsMinor: beforeOtherCostsMinor, equivalentSessions: rate > 0 ? Math.round(beforeOtherCostsMinor / rate) : null,
    };
  }

  /* ---------------- Formatting (same output as aedWhole, en-AE) ----------- */
  var nf0 = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }), nf2 = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }), nf1 = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 1 });
  var whole = function (n) { return nf0.format(n); };
  var aed = function (minor) { return "AED " + nf0.format(Math.round(minor / 100)); };
  var pct = function (n) { return nf2.format(n) + "%"; };
  var pct1 = function (n) { return nf1.format(n) + "%"; };
  var countLabel = function (n) { var c = displayCount(n); return c === null ? "fewer than 1" : whole(c); };
  /* Earnings inputs with the compact calculator's rule: no nutrition, voice or sessions. */
  function compactEarnings(subscribers, priceAed, sessionRate) {
    return estimateEarnings(Object.assign({}, DEFAULT_EARNINGS_INPUTS, { subscribers: subscribers, workoutPriceAed: priceAed, nutritionSharePct: 0, voiceSharePct: 0, sessionsPerMonth: 0, yourSessionRateAed: sessionRate === undefined ? 250 : sessionRate }));
  }
  /* Fill of each band (0..1) for the band meter; band 4 fills over 1,001–1,500. */
  function bandFills(n) { return [Math.min(1, n / 100), Math.min(1, Math.max(0, n - 100) / 200), Math.min(1, Math.max(0, n - 300) / 700), Math.min(1, Math.max(0, n - 1000) / 500)]; }
  /* Marker position on the 25% → 10% rate axis, 0..100. */
  function ratePos(ratePct) { return Math.max(0, Math.min(100, ((25 - ratePct) / 15) * 100)); }
  var priceBucket = function (p) { return p < 200 ? "<200" : p < 300 ? "200-299" : p < 500 ? "300-499" : "500+"; };

  var API = {
    BANDS: BANDS, commission: commission, FOLLOWER_SCENARIOS: FOLLOWER_SCENARIOS, DEFAULT_FOLLOWER_MODEL: DEFAULT_FOLLOWER_MODEL,
    FOLLOWER_LIMITS: FOLLOWER_LIMITS, DEFAULT_FOLLOWER_INPUTS: DEFAULT_FOLLOWER_INPUTS, EARNINGS_LIMITS: EARNINGS_LIMITS,
    DEFAULT_EARNINGS_INPUTS: DEFAULT_EARNINGS_INPUTS, estimateFollowerConversion: estimateFollowerConversion, followerLevers: followerLevers,
    followerInputsUsed: followerInputsUsed, followerTierIndex: followerTierIndex, visitChance: visitChance, monthlyChurn: monthlyChurn,
    estimateEarnings: estimateEarnings, compactEarnings: compactEarnings, displayCount: displayCount, bandFills: bandFills, ratePos: ratePos,
    whole: whole, aed: aed, pct: pct, pct1: pct1, countLabel: countLabel, priceBucket: priceBucket,
  };
  g.TYCalc = API;
  if (typeof document === "undefined") return; // Node build: maths only

  /* ======================================================================
     DOM bindings. Inputs carry data-in="<key>", outputs data-out="<key>".
     Every root dispatches "ty:calc" ({ type, inputs, estimate }) after
     each update so group scripts can render extra outputs.
     ====================================================================== */
  var d = document, TY = g.TY || {};
  var setV = function (el, text) { if (TY.setValue) TY.setValue(el, text); else el.textContent = text; };
  var num = function (value, fallback) { return value === "" || value === null || value === undefined || !Number.isFinite(+value) ? (fallback || 0) : +value; };
  var outs = function (rootEl, key) { return rootEl.querySelectorAll('[data-out="' + key + '"]'); };
  function put(rootEl, key, text) { Array.prototype.forEach.call(outs(rootEl, key), function (el) { setV(el, text); }); }
  function readIn(rootEl, key) { var el = rootEl.querySelector('[data-in="' + key + '"]'); if (!el) return undefined; return el.type === "checkbox" ? el.checked : el.value; }
  function rangeFill(el) { if (el && el.type === "range") { var p = ((el.value - el.min) / (el.max - el.min)) * 100; el.style.setProperty("--fill", p + "%"); } }

  var started = {};
  function onInputOnce(type, rootEl) {
    if (started[type]) return; started[type] = true;
    var props = { calc: type }, sc = rootEl.getAttribute("data-scenario"), pr = +(readIn(rootEl, "price") || (rootEl.querySelector('[data-sync="price"]') || {}).value);
    if (sc) props.scenario = sc;
    if (pr) props.price_bucket = priceBucket(pr);
    TY.track && TY.track("calc_input", props);
  }
  function resultView(type, rootEl, price) {
    clearTimeout(rootEl._rv);
    rootEl._rv = setTimeout(function () {
      var r = (rootEl.querySelector("[data-result]") || rootEl).getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) TY.track && TY.track("calc_result_view", { calc: type, price_bucket: priceBucket(price) });
    }, 600);
  }

  var renderers = {
    /* Follower estimate: three scenarios side by side */
    follower: function (rootEl) {
      var D = DEFAULT_FOLLOWER_INPUTS, opt = function (k) { var v = readIn(rootEl, k); return v === undefined || v === "" ? null : num(v); };
      var has = function (k) { return readIn(rootEl, k) !== undefined; };
      var inputs = {
        followers: num(readIn(rootEl, "followers")),
        priceAed: num(readIn(rootEl, "price"), 1),
        linkStoriesPerMonth: num(readIn(rootEl, "stories")),
        ctaReelsPerMonth: has("reels") ? num(readIn(rootEl, "reels")) : D.ctaReelsPerMonth,
        keywordDms: has("keywordDms") ? !!readIn(rootEl, "keywordDms") : D.keywordDms,
        yearlyCancelPct: has("cancel") ? num(readIn(rootEl, "cancel"), D.yearlyCancelPct) : D.yearlyCancelPct,
        profileVisitsPerMonth: opt("visits"), broadcastMembers: opt("members"),
        broadcastLinksPerMonth: has("links") ? num(readIn(rootEl, "links")) : D.broadcastLinksPerMonth,
        storyViews: opt("views"), engagementRatePct: opt("engagement"),
      };
      var e = estimateFollowerConversion(inputs);
      FOLLOWER_SCENARIOS.forEach(function (s) {
        var r = e.scenarios[s];
        put(rootEl, s + ".revenue", aed(r.revenueMonth12Minor));
        put(rootEl, s + ".active", countLabel(r.activeMonth12));
        put(rootEl, s + ".month1", countLabel(r.month1New));
        put(rootEl, s + ".signups", countLabel(r.signups12));
      });
      put(rootEl, "price", "AED " + whole(e.inputs.priceAed));
      var live = rootEl.querySelector("[data-live]");
      TY.announce && TY.announce(live, "Best case " + aed(e.scenarios.strong.revenueMonth12Minor) + " a month at month 12, before platform commission. Typical " + aed(e.scenarios.typical.revenueMonth12Minor) + ". Cautious " + aed(e.scenarios.cautious.revenueMonth12Minor) + ".");
      return { inputs: inputs, estimate: e, price: e.inputs.priceAed };
    },
    /* Take-home and earnings (compact unless data-full is set) */
    earnings: function (rootEl) {
      var full = rootEl.hasAttribute("data-full"), D = DEFAULT_EARNINGS_INPUTS;
      var v = function (k, fb) { var x = readIn(rootEl, k); return x === undefined ? fb : num(x, Number(fb) || 0); };
      var billing = readIn(rootEl, "billing") === "upfront" ? "upfront" : "monthly";
      var inputs = {
        subscribers: v("subscribers", D.subscribers), billing: full ? billing : "monthly",
        workoutPriceAed: v("price", D.workoutPriceAed), programmeMonths: v("months", D.programmeMonths),
        nutritionSharePct: full ? v("nutritionShare", D.nutritionSharePct) : 0, nutritionPriceAed: v("nutritionPrice", D.nutritionPriceAed),
        voiceSharePct: full ? v("voiceShare", D.voiceSharePct) : 0, voicePriceAed: v("voicePrice", D.voicePriceAed),
        sessionsPerMonth: full ? v("sessions", D.sessionsPerMonth) : 0, sessionPriceAed: v("sessionPrice", D.sessionPriceAed),
        yourSessionRateAed: v("rate", D.yourSessionRateAed),
      };
      var e = estimateEarnings(inputs), n = Math.floor(clamp(inputs.subscribers, EARNINGS_LIMITS.subscribers));
      put(rootEl, "subscribers", whole(n));
      put(rootEl, "price", "AED " + whole(inputs.workoutPriceAed));
      put(rootEl, "avg", aed(e.averageMonthlyMinor));
      put(rootEl, "revenue", aed(e.subscriptionMonthlyMinor));
      put(rootEl, "commission", "−" + aed(e.commissionMinor));
      put(rootEl, "rate", pct1(e.effectiveCommissionPct));
      put(rootEl, "keep", aed(e.beforeOtherCostsMinor));
      put(rootEl, "sessionsIncome", aed(e.sessionsMonthlyMinor));
      put(rootEl, "sessions", e.equivalentSessions === null ? "—" : whole(e.equivalentSessions));
      e.bands.forEach(function (b, k) {
        put(rootEl, "band." + k + ".subs", whole(b.subscribers));
        put(rootEl, "band." + k + ".commission", aed(b.commissionMinor));
      });
      var fills = bandFills(n);
      Array.prototype.forEach.call(rootEl.querySelectorAll("[data-band-fill]"), function (el) { el.style.setProperty("--fill", String(fills[+el.getAttribute("data-band-fill")])); });
      Array.prototype.forEach.call(rootEl.querySelectorAll("[data-rate-marker]"), function (el) { el.style.setProperty("--pos", String(ratePos(e.effectiveCommissionPct))); });
      var live = rootEl.querySelector("[data-live]");
      TY.announce && TY.announce(live, "You keep " + aed(e.beforeOtherCostsMinor) + " before card processing, from " + whole(n) + " subscribers at AED " + whole(inputs.workoutPriceAed) + ". Our share " + pct1(e.effectiveCommissionPct) + ".");
      return { inputs: inputs, estimate: e, price: inputs.workoutPriceAed };
    },
  };
  API.renderers = renderers;

  function update(rootEl, fromUser) {
    var type = rootEl.getAttribute("data-calc"), r = renderers[type]; if (!r) return;
    Array.prototype.forEach.call(rootEl.querySelectorAll('input[type="range"]'), rangeFill);
    var res = r(rootEl);
    rootEl.dispatchEvent(new CustomEvent("ty:calc", { bubbles: true, detail: { type: type, inputs: res.inputs, estimate: res.estimate } }));
    if (fromUser) { onInputOnce(rootEl.getAttribute("data-calc-name") || type, rootEl); resultView(rootEl.getAttribute("data-calc-name") || type, rootEl, res.price); }
  }
  API.update = update;

  /* Price carries across every widget on the page (data-sync="price"). */
  function syncPrice(src) {
    var value = src.value;
    Array.prototype.forEach.call(d.querySelectorAll('[data-sync="price"]'), function (el) {
      if (el === src || el.value === value) return;
      var min = el.min !== "" ? +el.min : -Infinity, max = el.max !== "" ? +el.max : Infinity;
      el.value = String(Math.min(max, Math.max(min, +value)));
      rangeFill(el);
      var host = el.closest("[data-calc]"); if (host) update(host, false);
      var pr = el.closest("[data-pricer]"); if (pr) pricerShow(pr);
    });
    Array.prototype.forEach.call(d.querySelectorAll("[data-show-price]"), function (el) {
      var off = +(el.getAttribute("data-show-price") || 0); setV(el, "AED " + whole(Math.max(1, +value) + off));
    });
  }
  API.syncPrice = syncPrice;

  /* Price stepper: [data-pricer] with data-min/max/step, two [data-step] buttons and a hidden data-sync input */
  function pricerShow(pr) {
    var input = pr.querySelector("input"), v = +input.value;
    Array.prototype.forEach.call(pr.querySelectorAll("[data-pricer-out]"), function (el) { setV(el, "AED " + whole(v)); });
    var dn = pr.querySelector('[data-step="-1"]'), up = pr.querySelector('[data-step="1"]');
    if (dn) dn.setAttribute("aria-disabled", String(v <= +pr.getAttribute("data-min")));
    if (up) up.setAttribute("aria-disabled", String(v >= +pr.getAttribute("data-max")));
  }
  d.addEventListener("click", function (e) {
    var b = e.target.closest("[data-pricer] [data-step]"); if (!b) return;
    var pr = b.closest("[data-pricer]"), input = pr.querySelector("input"), step = +pr.getAttribute("data-step") || 10;
    var v = Math.min(+pr.getAttribute("data-max"), Math.max(+pr.getAttribute("data-min"), +input.value + step * +b.getAttribute("data-step")));
    if (v === +input.value) return;
    input.value = String(v); pricerShow(pr);
    TY.flash && TY.flash(pr.querySelector(".flash"));
    var live = pr.querySelector("[data-live]"); TY.announce && TY.announce(live, "Your price AED " + whole(v) + " a month");
    onInputOnce(pr.getAttribute("data-calc-name") || "price", pr);
    syncPrice(input);
    pr.dispatchEvent(new CustomEvent("ty:price", { bubbles: true, detail: { price: v } }));
  });

  d.addEventListener("input", function (e) {
    var el = e.target; if (!el.matches || !el.matches("[data-in]")) return;
    var host = el.closest("[data-calc]");
    if (el.type === "range") {
      rangeFill(el);
      var vt = el.getAttribute("data-valuetext"); if (vt) el.setAttribute("aria-valuetext", vt.replace("{v}", whole(+el.value)));
    }
    if (host) update(host, true);
    if (el.getAttribute("data-sync") === "price") syncPrice(el);
  });
  d.addEventListener("change", function (e) { var el = e.target; if (el.matches && el.matches("select[data-in], input[type=checkbox][data-in]")) { var host = el.closest("[data-calc]"); if (host) update(host, true); } });

  function init() {
    Array.prototype.forEach.call(d.querySelectorAll('input[type="range"]'), rangeFill);
    Array.prototype.forEach.call(d.querySelectorAll("[data-calc]"), function (rootEl) { update(rootEl, false); });
  }
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", init); else init();
})(typeof window !== "undefined" ? window : globalThis);
