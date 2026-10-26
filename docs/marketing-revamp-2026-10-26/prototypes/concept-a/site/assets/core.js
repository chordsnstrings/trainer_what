/* Core pages: home follower calculator, pricing band meter and compact earnings calculator.
 * Uses window.ty (site.js) and window.tyCalc (calc.js). */
(function () {
  "use strict";
  var ty = window.ty, C = window.tyCalc;
  if (!ty || !C) return;
  var $ = ty.$, $$ = ty.$$;
  var num = function (el, fb) { var v = parseFloat(el && el.value); return isFinite(v) ? v : fb; };
  var bucket = function (p) { return p < 150 ? "<150" : p < 250 ? "150-249" : p < 400 ? "250-399" : "400+"; };
  /** calc_input once per calc per session; calc_result_view once the result is seen after an input. */
  function tracker(name, result) {
    var first = false, viewed = false;
    return function (props) {
      if (!first) {
        first = true;
        var key = "tyA.calc." + name, seen = null;
        try { seen = sessionStorage.getItem(key); sessionStorage.setItem(key, "1"); } catch (e) { /* no storage */ }
        if (!seen) ty.track("calc_input", Object.assign({ calc: name }, props));
      }
      if (viewed || !result) return;
      viewed = true;
      if (!("IntersectionObserver" in window)) return ty.track("calc_result_view", Object.assign({ calc: name }, props));
      var io = new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) { io.disconnect(); ty.track("calc_result_view", Object.assign({ calc: name }, props)); }
      }, { threshold: 0.3 });
      io.observe(result);
    };
  }

  /* Follower calculator (home band 6). */
  $$("[data-follower-calc]").forEach(function (box) {
    var f = $("#fc-followers", box), p = $("#fc-price", box), s = $("#fc-stories", box), live = $("[data-live]", box);
    var t = tracker("follower", $(".calc-result", box));
    function run(user) {
      var price = num(p, 199);
      var est = C.estimateFollowers({ followers: num(f, 0), priceAed: price, linkStoriesPerMonth: num(s, 0) });
      var v = function (k) { return est.scenarios[k].revenueMonth12Minor; };
      var max = Math.max(1, v("strong"), v("typical"), v("cautious"));
      ty.swap($(".fc-strong", box), C.aed(v("strong")));
      ["cautious", "typical", "strong"].forEach(function (k) {
        var lane = $('[data-lane="' + k + '"]', box);
        $(".calc-lane-bar span", lane).style.setProperty("--v", (v(k) / max).toFixed(4));
        ty.swap($(".vx", lane), C.aed(v(k)));
      });
      if (user) {
        ty.announce(live, "Best case up to " + C.aed(v("strong")) + " a month. Typical " + C.aed(v("typical")) + ". Cautious " + C.aed(v("cautious")) + ".");
        t({ scenario: "strong", price_bucket: bucket(price) });
      }
    }
    [f, p, s].forEach(function (el) { ty.on(el, "input", function () { run(true); }); });
    ty.on($("form", box), "submit", function (e) { e.preventDefault(); });
  });

  /* Pricing: band meter (1-1,500 subscribers at your price). */
  $$("[data-band-meter]").forEach(function (m) {
    var r = $("#meter-range", m), p = $("#meter-price", m), live = $("[data-live]", m), segs = $$(".seg", m);
    var t = tracker("band-meter", m);
    function run(user) {
      var n = Math.round(num(r, 1)), price = num(p, 199), e = C.compactEarnings(n, price, 250);
      r.setAttribute("aria-valuetext", C.whole(n) + " paying subscribers, blended rate " + C.pct(e.effectiveCommissionPct));
      ty.swap($(".meter-count .vx", m), C.whole(n));
      ty.swap($(".m-rate", m), C.pct(e.effectiveCommissionPct));
      ty.swap($(".m-share", m), C.aed(e.commissionMinor));
      ty.swap($(".m-keep", m), C.aed(e.subscriptionMonthlyMinor - e.commissionMinor));
      segs.forEach(function (sg) {
        var from = +sg.getAttribute("data-from"), size = +sg.getAttribute("data-size"), fill = Math.max(0, Math.min(1, (n - from + 1) / size));
        $(".seg-fill", sg).style.setProperty("--f", fill);
        sg.classList.toggle("is-active", n >= from && n < from + size);
      });
      if (user) {
        ty.announce(live, C.whole(n) + " subscribers: blended rate " + C.pct(e.effectiveCommissionPct) + ", our share " + C.aed(e.commissionMinor) + " a month.");
        t({ scenario: "bands", price_bucket: bucket(price) });
      }
    }
    ty.on(r, "input", function () { run(true); });
    ty.on(p, "input", function () { run(true); });
    run(false);
  });

  /* Pricing: compact earnings calculator. */
  $$("[data-earnings-calc]").forEach(function (box) {
    var n = $("#ec-subs", box), p = $("#ec-price", box), rate = $("#ec-rate", box), live = $("[data-live]", box);
    var t = tracker("earnings", $(".calc-result", box));
    function run() {
      var price = num(p, 0), e = C.compactEarnings(num(n, 0), price, num(rate, 0));
      ty.swap($(".ec-net", box), C.aed(e.beforeOtherCostsMinor));
      ty.swap($(".ec-sess", box), e.equivalentSessions === null ? "–" : C.whole(e.equivalentSessions));
      ty.swap($(".ec-subs", box), C.aed(e.subscriptionMonthlyMinor));
      ty.swap($(".ec-comm", box), "− " + C.aed(e.commissionMinor));
      ty.swap($(".ec-pct", box), C.pct(e.effectiveCommissionPct, 2));
      ty.announce(live, C.aed(e.beforeOtherCostsMinor) + " a month before other costs and tax.");
      t({ scenario: "compact", price_bucket: bucket(price) });
    }
    [n, p, rate].forEach(function (el) { ty.on(el, "input", run); });
    ty.on($("form", box), "submit", function (e) { e.preventDefault(); });
  });
})();
