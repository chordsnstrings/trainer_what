/* Concept A money group: calculators on tyCalc (calc.js); results carry the price into sign-up. */
(function () {
  "use strict";
  var ty = window.ty, C = window.tyCalc, d = document;
  if (!ty || !C) return;
  var $ = ty.$, $$ = ty.$$, on = ty.on, SC = ["cautious", "typical", "strong"], Q = new URLSearchParams(location.search);
  var num = function (el, fb) { var v = el && el.value.trim() !== "" ? +el.value : NaN; return isFinite(v) ? v : fb; };
  var bucket = function (p) { return p < 150 ? "<150" : p < 250 ? "150-249" : p < 400 ? "250-399" : "400+"; };
  var count = function (n) { var c = C.displayCount(n); return c === null ? "< 1" : C.whole(c); };
  var gain = function (n) { return n < 0.05 ? "about the same" : n < 10 ? "+" + n.toFixed(1) : "+" + C.whole(Math.round(n)); };
  var put = ty.swap;
  function o(box, c, text) { $$(".o-" + c, box).forEach(function (el) { put(el, text); }); }
  function bar(el, v) { if (el) el.style.setProperty("--v", Math.max(0, Math.min(1, v)).toFixed(4)); }
  function tracker(name, box) {
    var first, viewed;
    return function (props) {
      props.calc = name;
      if (!first) {
        first = 1;
        var k = "tyA.calc." + name, seen;
        try { seen = sessionStorage.getItem(k); sessionStorage.setItem(k, "1"); } catch (e) { /* no storage */ }
        if (!seen) ty.track("calc_input", props);
      }
      if (viewed) return;
      viewed = 1;
      var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); ty.track("calc_result_view", props); } }, { threshold: 0.3 });
      io.observe($(".mc-window", box));
    };
  }
  var carried = {};
  function carry(p) {
    if (p) carried = p;
    if (ty.flags().registration === "closed") return;
    var q = carried.price_aed ? "?price_aed=" + carried.price_aed : "", claim = $("[data-address-claim]");
    $$('a[data-cta="primary"]').forEach(function (a) { a.setAttribute("href", "signup.html" + q); });
    if (claim && q) { var h = claim.getAttribute("href"); claim.setAttribute("href", h + (h.indexOf("?") < 0 ? q : "&" + q.slice(1))); }
  }
  on(d, "ty:flags", function () { carry(); });
  function setup(box) {
    var p = $(".mc-peek", box), win = $(".mc-window", box), fig = $(".calc-figure-line", win);
    fig.classList.add("flash");
    new IntersectionObserver(function (es) { p.classList.toggle("is-away", es[0].isIntersecting); }, { threshold: 0.2 }).observe(win);
    on($("form", box), "submit", function (e) { e.preventDefault(); });
    on(d, "ty:replay", function () { ty.flash(fig); });
    return fig;
  }
  function disclose(btn, open) {
    btn.setAttribute("aria-expanded", String(open));
    d.getElementById(btn.getAttribute("aria-controls")).classList.toggle("is-open", open);
    btn.closest("li, .mc-opt").classList.toggle("is-open", open);
  }
  function toggler(btn) { on(btn, "click", function () { disclose(btn, btn.getAttribute("aria-expanded") !== "true"); }); }

  /* earnings */
  var eb = $("[data-earn-calc]");
  if (eb) (function () {
    var D = C.EARNINGS_DEFAULTS, ins = $$("[data-k]", eb), subs = $("#me-subs"), range = $("#me-subs-r"), cells = $$(".mc-cells i", eb), more = $(".mc-cells-more", eb);
    var kOf = function (el) { return el.getAttribute("data-k"); };
    var t = tracker("earnings", eb), fig = setup(eb), out = $("[data-share-out]", eb);
    var billing = function () { return $('input[name="billing"]:checked', eb).value; };
    function syncRange() { range.value = Math.max(0, Math.min(1500, Math.round(num(subs, 0)))); ty.rangeFill(range); range.setAttribute("aria-valuetext", C.whole(num(subs, 0)) + " paying subscribers"); }
    function run(user) {
      var i = { billing: billing() };
      ins.forEach(function (el) { i[kOf(el)] = num(el, D[kOf(el)]); });
      var e = C.estimateEarnings(i), up = i.billing === "upfront", s = e.equivalentSessions;
      eb.classList.toggle("is-upfront", up);
      $("[data-upfront-only]", eb).classList.toggle("is-open", up);
      o(eb, "net", C.aed(e.beforeOtherCostsMinor));
      o(eb, "sess", s === null ? "–" : C.whole(s));
      o(eb, "rate", "AED " + C.whole(i.yourSessionRateAed));
      o(eb, "n", C.whole(Math.max(0, Math.floor(i.subscribers))));
      o(eb, "avg", C.aed(e.averageMonthlyMinor));
      o(eb, "subs", C.aed(e.subscriptionMonthlyMinor));
      o(eb, "pct", C.pct(e.effectiveCommissionPct, 2));
      o(eb, "comm", "− " + C.aed(e.commissionMinor));
      o(eb, "sessamt", C.aed(e.sessionsMonthlyMinor));
      e.bands.forEach(function (b, k) {
        var row = $('[data-band="' + k + '"]', eb);
        row.classList.toggle("is-used", b.subscribers > 0);
        bar($(".mc-band-bar span", row), b.subscribers / [100, 200, 700, 500][k]);
        put($(".mc-band-n .vx", row), C.whole(b.subscribers));
        put($(".mc-band-v .vx", row), "− " + C.aed(b.commissionMinor));
      });
      cells.forEach(function (c, k) { c.classList.toggle("on", k < s); });
      more.hidden = !(s > 60); more.textContent = "+" + C.whole(s - 60);
      put($(".mc-carry-v", eb), C.whole(i.workoutPriceAed));
      carry({ price_aed: up ? 0 : Math.round(i.workoutPriceAed) });
      if (user) {
        ty.announce($("[data-live]", eb), C.aed(e.beforeOtherCostsMinor) + " a month before other costs and tax.");
        t({ scenario: "full", price_bucket: bucket(i.workoutPriceAed) });
      }
    }
    on(eb, "input", function (e) {
      if (e.target === range) { subs.value = range.value; range.setAttribute("aria-valuetext", C.whole(+range.value) + " paying subscribers"); }
      else if (e.target === subs) syncRange();
      run(1);
    });
    ins.forEach(function (el) { if (Q.has(el.name)) el.value = Q.get(el.name); });
    if (Q.get("billing") === "upfront") $('input[value="upfront"]', eb).checked = true;
    syncRange();
    run();
    on($("[data-share]", eb), "click", function () {
      var p = new URLSearchParams(), url, msg = " It opens this calculator with your numbers.";
      ins.forEach(function (el) { if (el.value.trim()) p.set(el.name, el.value.trim()); });
      if (billing() === "upfront") p.set("billing", "upfront");
      url = location.href.split(/[?#]/)[0] + "?" + p;
      function done(m, text) { out.textContent = text + msg; ty.track("share_self", { method: m }); }
      function show() { done("shown", "Copy this link: " + url + "."); }
      if (navigator.share) navigator.share({ title: "My earnings estimate", url: url }).then(function () { done("share", "Shared."); }, function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { done("copy", "Link copied."); }, show);
      else show();
    });
    on($("[data-load-example]"), "click", function () {
      var ex = { subscribers: 120, workoutPriceAed: 199, nutritionSharePct: 0, voiceSharePct: 0, sessionsPerMonth: 0, yourSessionRateAed: 250 };
      ins.forEach(function (el) { if (kOf(el) in ex) el.value = ex[kOf(el)]; });
      $('input[value="monthly"]', eb).checked = true;
      syncRange(); run(1);
      var still = getComputedStyle(d.documentElement).getPropertyValue("--m").trim() === "0";
      $("#result").scrollIntoView({ behavior: still ? "auto" : "smooth" });
      setTimeout(function () { ty.flash(fig); }, still ? 0 : 450);
    });
  })();

  /* follower */
  var fb = $("[data-follow-calc]");
  if (fb) (function () {
    var f = function (id) { return $("#mf-" + id, fb); }, kw = f("kw"), optBtn = $("[data-opt]", fb), t = tracker("follower", fb);
    var chart = $("[data-chart]"), plot = $(".mc-plot", chart), tip = $(".mc-tip", plot), cross = $(".mc-cross", plot), last;
    setup(fb);
    function inputs() {
      var i = { keywordDms: kw.checked };
      $$("[data-k]", fb).forEach(function (el) { var v = el.getAttribute("data-fb"); i[el.getAttribute("data-k")] = num(el, v === null ? null : +v); });
      return i;
    }
    function levers(input) {
      var base = C.estimateFollowers(input), i = base.inputs, now = base.scenarios.strong, cap = function (n) { return Math.min(60, n); };
      var ch = {
        bioLink: { profileVisitsPerMonth: (i.profileVisitsPerMonth || 0) + 1000 },
        keywordReels: i.keywordDms && i.ctaReelsPerMonth > 0 ? { ctaReelsPerMonth: cap(i.ctaReelsPerMonth + 4) } : { keywordDms: true, ctaReelsPerMonth: Math.max(i.ctaReelsPerMonth, 4) },
        moreStories: { linkStoriesPerMonth: cap(i.linkStoriesPerMonth + 4) },
      };
      Object.keys(ch).forEach(function (k) {
        var nx = C.estimateFollowers(Object.assign({}, i, ch[k])).scenarios.strong, box = $('[data-lever="' + k + '"]');
        put($(".g-m1", box), gain(nx.month1New - now.month1New));
        put($(".g-a12", box), gain(nx.activeMonth12 - now.activeMonth12));
      });
    }
    function niceMax(v) {
      var p = Math.pow(10, Math.floor(Math.log10(v))), m = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10], k = 0;
      while (m[k] * p < v) k++;
      return m[k] * p;
    }
    function draw(est) {
      var S = est.scenarios, max = niceMax(Math.max(1e-9, Math.max.apply(null, S.strong.activeByMonth.concat(S.typical.activeByMonth, S.cautious.activeByMonth)))), end = {}, lab = {}, prev = -100;
      SC.forEach(function (s) {
        var pts = S[s].activeByMonth.map(function (v, m) { return (m * 600 / 11).toFixed(1) + "," + (220 - v / max * 220).toFixed(1); }).join(" ");
        var g = $('[data-line="' + s + '"]', chart), old = $("polyline:not(.is-out)", g), nu;
        if (old.getAttribute("points") !== pts) {
          nu = old.cloneNode(); nu.setAttribute("points", pts); nu.setAttribute("class", "is-in");
          old.setAttribute("class", "is-out"); g.appendChild(nu); setTimeout(function () { old.remove(); }, 260);
        }
        end[s] = (1 - S[s].activeByMonth[11] / max) * 100;
      });
      SC.concat().sort(function (a, b) { return end[a] - end[b]; }).forEach(function (s) { lab[s] = prev = Math.max(end[s], prev + 11); });
      SC.forEach(function (s) {
        var dl = $('[data-dl="' + s + '"]', chart);
        $('[data-end="' + s + '"]', chart).style.setProperty("--y", end[s].toFixed(2));
        dl.style.setProperty("--y", (lab[s] - Math.max(0, prev - 100)).toFixed(2));
        put($(".vx", dl), count(S[s].activeMonth12));
      });
      $$("[data-gl]", chart).forEach(function (gl) { put($(".vx", gl), C.whole(max * gl.getAttribute("data-gl"))); });
      $$(".mc-months tbody tr", chart.parentNode).forEach(function (tr, m) { $$("td", tr).forEach(function (td, k) { td.textContent = count(S[SC[k]].activeByMonth[m]); }); });
      last = est;
    }
    function run(user) {
      var est = C.estimateFollowers(inputs()), S = est.scenarios, u = est.inputs, st = S.strong;
      var max = Math.max(1, S.cautious.revenueMonth12Minor, S.typical.revenueMonth12Minor, st.revenueMonth12Minor);
      o(fb, "strong", C.aed(st.revenueMonth12Minor));
      o(fb, "ctx", "Best case: an engaged, growing audience" + (u.linkStoriesPerMonth >= 4 || (u.keywordDms && u.ctaReelsPerMonth >= 4) ? " and weekly sharing" : "") + (st.activeByMonth[11] > st.activeByMonth[10] + 1e-9 ? ", still growing at month 12" : "") + ".");
      o(fb, "cancel", C.pct(u.yearlyCancelPct));
      SC.forEach(function (s) {
        var r = S[s], v = { m1: count(r.month1New), a12: count(r.activeMonth12), su: count(r.signups12), aed: C.aed(r.revenueMonth12Minor) };
        Object.keys(v).forEach(function (row) { put($('[data-row="' + row + '"] [data-s="' + s + '"] .vx', fb), v[row]); });
        bar($('[data-row="aed"] [data-s="' + s + '"] .mc-sc-bar span', fb), r.revenueMonth12Minor / max);
      });
      levers(inputs());
      o(d, "viewers", u.storyViews === null ? "≈ " + C.whole(Math.round(st.storyViewers)) : C.whole(u.storyViews));
      draw(est);
      put($(".mc-carry-v", fb), C.whole(u.priceAed));
      carry({ price_aed: u.priceAed });
      if (user) {
        ty.announce($("[data-live]", fb), "Best case up to " + C.aed(st.revenueMonth12Minor) + " a month. Typical " + C.aed(S.typical.revenueMonth12Minor) + ". Cautious " + C.aed(S.cautious.revenueMonth12Minor) + ".");
        t({ scenario: "strong", price_bucket: bucket(u.priceAed) });
      }
    }
    on(fb, "input", function () { run(1); });
    toggler(optBtn);
    $$("[data-steps] button").forEach(toggler);
    run();
    on($("[data-enter-views]"), "click", function () {
      disclose(optBtn, true);
      f("views").focus();
    });
    var addr = $("#mf-addr"), stk = $("[data-sticker]"), tm;
    stk.classList.add("flash");
    on(addr, "input", function () {
      put($(".o-slug", stk), ty.slugFromName(addr.value) || "your-name");
      carry(); clearTimeout(tm); tm = setTimeout(function () { ty.flash(stk); }, 300);
    });
    on(plot, "pointermove", function (e) {
      var r = plot.getBoundingClientRect(), m = Math.max(0, Math.min(11, Math.round((e.clientX - r.left) / r.width * 11))), x = m / 11 * r.width;
      cross.style.transform = "translateX(" + x + "px)";
      tip.textContent = "Month " + (m + 1) + " · active\n" + ["Best case", "Typical", "Cautious"].map(function (l, k) { return l + "  " + count(last.scenarios[SC[2 - k]].activeByMonth[m]); }).join("\n");
      tip.style.transform = "translateX(" + Math.max(0, Math.min(r.width - tip.offsetWidth, x > r.width / 2 ? x - tip.offsetWidth - 12 : x + 12)) + "px)";
      plot.classList.add("is-hover");
    });
    on(plot, "pointerleave", function () { plot.classList.remove("is-hover"); });
  })();
})();
