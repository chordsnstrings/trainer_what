/* Concept C: Home + Pricing behaviour. Uses window.ty (site.js) and
   window.tyCalc (calc.js). Values change by stacked-span crossfade only. */
(function () {
  "use strict";
  var ty = window.ty, C = window.tyCalc;
  if (!ty) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var slot = function (root, k) { return $('[data-vx="' + k + '"]', root); };
  var once = function (key) { try { if (sessionStorage.getItem(key)) return false; sessionStorage.setItem(key, "1"); } catch (e) {} return true; };
  var priceBucket = function (p) { return p < 150 ? "<150" : p < 250 ? "150-249" : p < 400 ? "250-399" : "400+"; };
  var num = function (input, fallback) { var v = input.value.trim(); var n = Number(v); return v === "" || !isFinite(n) ? fallback : n; };

  /* ---------- Home hero: the rule is confirmed once, after load ---------- */
  var card = $("#hero-rule");
  if (card) {
    var played = false;
    var play = function () {
      if (played) return; played = true;
      setTimeout(function () { ty.confirmRule(card); }, 300);
    };
    var start = function () {
      if (ty.inView(card)) play();
      else if ("IntersectionObserver" in window) {
        var o = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { o.disconnect(); play(); } }, { threshold: 0.5 });
        o.observe(card);
      } else play();
    };
    if (document.readyState === "complete") start(); else addEventListener("load", start);
    ty.onReplay(function () { ty.resetRule(card); played = false; setTimeout(play, 200); });
  }

  /* ---------- Home: compact follower calculator ---------- */
  var fc = $("[data-follower-calc]");
  if (fc && C) {
    var fLive = $("#fc-live", fc), fViewed = false;
    var fUpdate = function () {
      var i = {};
      $$("input[data-k]", fc).forEach(function (el) { i[el.getAttribute("data-k")] = el; });
      var inputs = Object.assign({}, C.DEFAULT_FOLLOWER_INPUTS, {
        followers: num(i.followers, 0), priceAed: num(i.priceAed, 1), linkStoriesPerMonth: num(i.linkStoriesPerMonth, 0),
      });
      var est = C.estimateFollowerConversion(inputs), s = est.scenarios;
      ty.swap(slot(fc, "headline"), C.aedWhole(s.strong.revenueMonth12Minor));
      ["cautious", "typical", "strong"].forEach(function (k) {
        ty.swap(slot(fc, k + "-aed"), C.aedWhole(s[k].revenueMonth12Minor));
        ty.swap(slot(fc, k + "-active"), C.countLabel(s[k].activeMonth12));
      });
      ty.announce(fLive, "Best case: up to " + C.aedWhole(s.strong.revenueMonth12Minor) + " a month at your price, before platform commission. Typical " +
        C.aedWhole(s.typical.revenueMonth12Minor) + ". Cautious " + C.aedWhole(s.cautious.revenueMonth12Minor) + ".");
      if (!fViewed) { fViewed = true; ty.track("calc_result_view", { calc: "follower", scenario: "strong", price_bucket: priceBucket(est.inputs.priceAed) }); }
    };
    fc.addEventListener("input", ty.debounce(function (e) {
      if (once("ty-c-calc-follower")) ty.track("calc_input", { calc: "follower", field: e.target.getAttribute("data-k") });
      fUpdate();
    }, 120));
    fc.addEventListener("submit", function (e) { e.preventDefault(); });
  }

  /* ---------- Pricing: band meter (blended share at one price) ---------- */
  var bm = $("[data-band-meter]");
  if (bm && C) {
    var SEG = [[0, 0.2, 1, 100], [0.2, 0.45, 100, 300], [0.45, 0.75, 300, 1000], [0.75, 1, 1000, 1500]];
    var posToCount = function (pos) {
      var x = pos / 1000;
      for (var k = 0; k < SEG.length; k++) {
        var s = SEG[k];
        if (x <= s[1] || k === SEG.length - 1) return Math.max(1, Math.min(1500, Math.round(s[2] + ((x - s[0]) / (s[1] - s[0])) * (s[3] - s[2]))));
      }
      return 1;
    };
    var range = $("#bm-range", bm), fill = $(".bm-fill", bm), bLive = $("#bm-live", bm), moved = false;
    var bUpdate = function () {
      var pos = Number(range.value), n = posToCount(pos), rate = C.blendedRatePct(n, 199);
      fill.style.setProperty("--p", pos / 1000);
      ty.swap(slot(bm, "count"), C.whole(n));
      ty.swap(slot(bm, "rate"), rate.toFixed(1) + "%");
      ty.swap(slot(bm, "keep"), (100 - rate).toFixed(1) + "%");
      var text = n + " subscribers: our share " + rate.toFixed(1) + "%";
      range.setAttribute("aria-valuetext", text);
      ty.announce(bLive, text + ", you keep " + (100 - rate).toFixed(1) + "%.");
    };
    range.addEventListener("input", function () {
      if (!moved) { moved = true; ty.track("calc_input", { calc: "band_meter", field: "subscribers" }); }
      bUpdate();
    });
  }

  /* ---------- Pricing: compact earnings calculator ---------- */
  var ec = $("[data-earnings-calc]");
  if (ec && C) {
    var eLive = $("#ec-live", ec);
    var eUpdate = function () {
      var i = {};
      $$("input[data-k]", ec).forEach(function (el) { i[el.getAttribute("data-k")] = el; });
      var D = C.DEFAULT_EARNINGS_INPUTS;
      var e = C.estimateEarnings(Object.assign({}, D, {
        subscribers: num(i.subscribers, 0), workoutPriceAed: num(i.workoutPriceAed, 0), yourSessionRateAed: num(i.yourSessionRateAed, 0),
        nutritionSharePct: 0, voiceSharePct: 0, sessionsPerMonth: 0,
      }));
      ty.swap(slot(ec, "kept"), C.aedWhole(e.beforeOtherCostsMinor));
      ty.swap(slot(ec, "sessions"), e.equivalentSessions === null ? "—" : "about " + C.whole(e.equivalentSessions));
      ty.swap(slot(ec, "subs"), C.aedWhole(e.subscriptionMonthlyMinor));
      ty.swap(slot(ec, "comm"), "−" + C.aedWhole(e.commissionMinor));
      ty.swap(slot(ec, "eff"), C.pct(e.effectiveCommissionPct));
      ty.announce(eLive, C.aedWhole(e.beforeOtherCostsMinor) + " a month before other costs and tax. Commission " + C.pct(e.effectiveCommissionPct) + " overall.");
    };
    ec.addEventListener("input", ty.debounce(function (e) {
      if (once("ty-c-calc-earnings")) ty.track("calc_input", { calc: "earnings_compact", field: e.target.getAttribute("data-k") });
      eUpdate();
    }, 120));
    ec.addEventListener("submit", function (e) { e.preventDefault(); });
  }
})();
