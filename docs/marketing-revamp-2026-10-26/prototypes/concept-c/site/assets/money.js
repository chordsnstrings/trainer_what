/* Concept C: money pages (/earnings-calculator, /follower-calculator).
   F = pure formatting, shared with the build (Node require) so the first
   paint and every live update render identical markup. Maths come only from
   calc.js (a 1:1 port of packages/domain/src/marketing-calculators.ts).
   Motion: values crossfade (ty.swap), tally strokes draw once on reveal,
   nothing counts up. Owned by the money page builder. */
(function (root) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports;
  var C = NODE ? require("./calc.js") : root.tyCalc;
  if (!C) return;

  var S = ["cautious", "typical", "strong"];
  var NAME = { cautious: "Cautious", typical: "Typical", strong: "Strong" };
  var R = C.FOLLOWER_MODEL.scenarios;
  var aed = C.aedWhole, whole = C.whole, pct = C.pct, cl = C.countLabel;
  var aedN = function (n) { return aed(Math.round(n * 100)); };
  var r1 = function (n) { return Math.round(n * 10) / 10; };
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, isFinite(v) ? v : a)); };
  var f2 = function (n) { return (Math.round(n * 100) / 100).toString(); };
  var tri = function (fn) { return S.map(fn).join(" · "); };
  var F = { S: S, NAME: NAME };

  /* ---------- Earnings ---------- */
  /** Tally marks: one stroke per session, gates of five, capped at 100. */
  F.tally = function (n) {
    if (n === null || !isFinite(n) || n <= 0) return '<span class="mc-tally-none">No sessions to compare</span>';
    var shown = Math.min(n, 100), out = "";
    for (var g = 0; g * 5 < shown; g++) {
      var k = Math.min(5, shown - g * 5), d = "";
      for (var j = 0; j < Math.min(k, 4); j++) d += "M" + (4 + j * 6) + " 3V21";
      if (k === 5) d += "M1 16L25 8";
      out += '<svg class="mc-tg" style="--i:' + Math.min(g, 5) + '" width="26" height="24" viewBox="0 0 26 24" aria-hidden="true"><path d="' + d + '" pathLength="1"/></svg>';
    }
    if (n > 100) out += '<span class="mc-tally-more">+' + whole(n - 100) + " more</span>";
    return out;
  };
  /** Position on the band ruler (piecewise, so the first band stays readable). */
  F.ruler = function (n) {
    var P = [[0, 100, 0, 0.2], [100, 300, 0.2, 0.45], [300, 1000, 0.45, 0.75], [1000, 1500, 0.75, 1]];
    if (!(n > 0)) return 0;
    for (var i = 0; i < P.length; i++) if (n <= P[i][1]) return r2(P[i][2] + ((n - P[i][0]) / (P[i][1] - P[i][0])) * (P[i][3] - P[i][2]));
    return 1;
  };
  F.earn = function (v) {
    var e = C.estimateEarnings(v), up = v.billing === "upfront";
    var n = e.bands.reduce(function (s, b) { return s + b.subscribers; }, 0);
    var sn = Math.floor(clamp(v.sessionsPerMonth, 0, 1000)), sp = clamp(v.sessionPriceAed, 0, 10000);
    var price = Math.round(clamp(v.workoutPriceAed, 0, 10000));
    return {
      e: e,
      kept: aed(e.beforeOtherCostsMinor),
      sessions: e.equivalentSessions === null ? "—" : "about " + whole(e.equivalentSessions),
      tally: F.tally(e.equivalentSessions),
      subsK: up ? "Subscriptions, monthly equivalent" : "Subscriptions",
      subsX: whole(n) + " × " + aed(e.averageMonthlyMinor) + " average",
      subsV: aed(e.subscriptionMonthlyMinor),
      shareX: pct(e.effectiveCommissionPct) + " overall",
      shareV: "−" + aed(e.commissionMinor),
      sessX: whole(sn) + " × " + aedN(sp),
      sessV: aed(e.sessionsMonthlyMinor),
      bands: e.bands.map(function (b) { return { n: whole(b.subscribers), c: aed(b.commissionMinor), empty: b.subscribers === 0 }; }),
      p: F.ruler(n),
      sum2: pct(clamp(v.nutritionSharePct, 0, 100)) + " on nutrition · " + pct(clamp(v.voiceSharePct, 0, 100)) + " add voice",
      sum3: whole(sn) + " a month at " + aedN(sp),
      price: price,
      priceText: "AED " + whole(price),
      say: aed(e.beforeOtherCostsMinor) + " a month before other costs and tax. Our share " + pct(e.effectiveCommissionPct) +
        " overall" + (e.equivalentSessions === null ? "." : ". About " + whole(e.equivalentSessions) + " sessions at your usual rate."),
    };
  };

  /* ---------- Followers ---------- */
  var gain = function (n) { return n < 0.05 ? "about the same" : n < 10 ? "+" + n.toFixed(1) : "+" + whole(Math.round(n)); };
  F.fol = function (input) {
    var est = C.estimateFollowerConversion(input), s = est.scenarios, i = est.inputs, st = s.strong;
    var lev = {};
    C.followerLevers(input, undefined, "strong").forEach(function (l) { lev[l.id] = l; });
    var weekly = i.linkStoriesPerMonth >= 4 || (i.keywordDms && i.ctaReelsPerMonth >= 4);
    var cells = {};
    S.forEach(function (k) {
      cells[k] = { first: cl(s[k].month1New), active: cl(s[k].activeMonth12), signups: cl(s[k].signups12), aed: aed(s[k].revenueMonth12Minor) };
    });
    var pv = i.profileVisitsPerMonth !== null, bc = !!i.broadcastMembers;
    var steps = [
      i.storyViews !== null ? "Your " + whole(i.storyViews) + " views, every case" : tri(function (k) { return whole(Math.round(s[k].storyViewers)); }) + " people",
      i.linkStoriesPerMonth > 0 ? tri(function (k) { return pct(r1(C.visitChance(R[k].linkClickPct, i.linkStoriesPerMonth) * 100)); }) + " visit" : "No link Stories",
      tri(function (k) { return pct(R[k].audienceRenewalPct); }) + " new a month",
      i.keywordDms && i.ctaReelsPerMonth > 0 ? tri(function (k) { return pct(R[k].dmOpenPct); }) + " open the link" : "Off: no keyword Reels",
      pv && bc ? "Bio link and channel counted" : pv ? tri(function (k) { return pct(R[k].bioClickPct); }) + " of visits" : bc ? tri(function (k) { return pct(R[k].broadcastClickPct); }) + " per message" : "Not counted yet",
      tri(function (k) { return pct(R[k].paidPct); }) + " pay",
      pct(i.yearlyCancelPct) + " a year → " + pct(r2(est.monthlyCancelPct)) + " a month",
      i.engagementRatePct === null ? "Not entered" : "×" + est.engagementFactor.toFixed(2),
    ];
    var lv = {};
    ["bioLink", "keywordReels", "moreStories"].forEach(function (id) {
      var l = lev[id];
      lv[id] = l ? { first: gain(l.month1New), active: gain(l.activeMonth12) } : { first: "—", active: "—" };
    });
    var typ = C.displayCount(s.typical.activeMonth12) || 0;
    return {
      est: est, i: i, cells: cells, steps: steps, lv: lv,
      headline: aed(st.revenueMonth12Minor),
      upto: st.revenueMonth12Minor > 0,
      caseText: weekly ? "an engaged, growing audience and weekly sharing" : "an engaged, growing audience",
      growing: st.activeByMonth[11] > st.activeByMonth[10] + 1e-9,
      cancel: pct(i.yearlyCancelPct) + " a year",
      cancelM: "about " + pct(r2(est.monthlyCancelPct)) + " a month",
      storyBest: i.storyViews !== null ? whole(i.storyViews) + ", yours" : "about " + whole(Math.round(st.storyViewers)),
      share: i.followers > 0 ? pct(r2((st.signups12 / i.followers) * 100)) : "—",
      sumReels: whole(i.ctaReelsPerMonth) + " Reels a month · keyword " + (i.keywordDms ? "on" : "off") + " · " + pct(i.yearlyCancelPct) + " cancel a year",
      keywordTitle: i.keywordDms && i.ctaReelsPerMonth > 0 ? "4 more keyword Reels a month" : "A comment keyword on 4 Reels a month",
      carry: "earnings-calculator.html?subscribers=" + typ + "&price=" + i.priceAed,
      typ: whole(typ),
      price: i.priceAed,
      priceText: "AED " + whole(i.priceAed),
      say: "Best case: up to " + aed(st.revenueMonth12Minor) + " a month at your price, before platform commission. Typical " +
        aed(s.typical.revenueMonth12Minor) + ". Cautious " + aed(s.cautious.revenueMonth12Minor) + ".",
    };
  };

  /* Chart: active subscribers by month, three cases, one axis, linear. */
  var nice = function (x) {
    if (!(x > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  };
  var endCount = function (v) { var c = C.displayCount(v); return c === null ? "under 1" : whole(c); };
  F.readout = function (vals, m) {
    return "Month " + (m + 1) + ": strong " + endCount(vals.strong[m]) + ", typical " + endCount(vals.typical[m]) + ", cautious " + endCount(vals.cautious[m]) + " active";
  };
  F.chart = function (est) {
    var s = est.scenarios, max = 0, vals = {}, pts = {};
    S.forEach(function (k) { vals[k] = s[k].activeByMonth; vals[k].forEach(function (v) { if (v > max) max = v; }); });
    var step = Math.max(1, nice(max / 4)), top = Math.max(step, Math.ceil(max / step - 1e-9) * step), ticks = [];
    for (var t = 0; t <= top + 1e-9; t += step) ticks.push(t);
    var Y = function (v) { return 100 - (v / top) * 100; };
    var grid = "", paths = "";
    ticks.forEach(function (t) { var y = f2(Y(t)); grid += '<line class="mc-gl' + (t === 0 ? " mc-gl--0" : "") + '" x1="0" x2="100" y1="' + y + '" y2="' + y + '" vector-effect="non-scaling-stroke"/>'; });
    S.forEach(function (k) {
      pts[k] = vals[k].map(Y);
      var d = pts[k].map(function (y, m) { return (m ? "L" : "M") + f2((m / 11) * 100) + " " + f2(y); }).join("");
      paths += '<path class="mc-ln mc-ln--' + k + '" d="' + d + '" vector-effect="non-scaling-stroke"/>';
    });
    var ends = S.map(function (k) { return { k: k, y: pts[k][11], t: NAME[k] + " " + endCount(vals[k][11]) }; })
      .sort(function (a, b) { return a.y - b.y; });
    for (var j = 1; j < ends.length; j++) ends[j].y = Math.max(ends[j].y, ends[j - 1].y + 12);
    ends[ends.length - 1].y = Math.min(ends[ends.length - 1].y, 100);
    for (j = ends.length - 2; j >= 0; j--) ends[j].y = Math.min(ends[j].y, ends[j + 1].y - 12);
    var html = '<div class="mc-cg"><div class="mc-yax">' +
      ticks.map(function (t) { return '<span style="top:' + f2(Y(t)) + '%">' + whole(t) + "</span>"; }).join("") +
      '</div><div class="mc-pb"><svg class="mc-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">' + grid + paths +
      '</svg></div><div class="mc-ends">' +
      ends.map(function (e) { return '<span class="mc-end mc-end--' + e.k + '" style="top:' + f2(e.y) + '%">' + e.t + "</span>"; }).join("") +
      "</div></div>";
    return { html: html, pts: pts, vals: vals };
  };
  F.monthRows = function (est) {
    var out = "";
    for (var m = 0; m < 12; m++) {
      out += '<tr><th scope="row">Month ' + (m + 1) + "</th>" + S.map(function (k) { return '<td class="num">' + cl(est.scenarios[k].activeByMonth[m]) + "</td>"; }).join("") + "</tr>";
    }
    return out;
  };

  if (NODE) { module.exports = F; return; }

  /* =====================================================================
     Browser behaviour
     ===================================================================== */
  var ty = root.ty;
  if (!ty) return;
  var d = document, html = d.documentElement;
  var $ = function (s, r) { return (r || d).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); };
  var slot = function (r, k) { return $('[data-vx="' + k + '"]', r); };
  var quiet = false; // first paint already holds identical server markup
  var put = function (r, k, v, asHtml) { if (asHtml && quiet) return; ty.swap(slot(r, k), v, asHtml ? { html: true } : undefined); };
  var once = function (key) { try { if (sessionStorage.getItem(key)) return false; sessionStorage.setItem(key, "1"); } catch (e) {} return true; };
  var bucket = function (p) { return p < 150 ? "<150" : p < 250 ? "150-249" : p < 400 ? "250-399" : "400+"; };
  var num = function (el, fb) { var t = el.value.trim(), n = Number(t); return t === "" || !isFinite(n) ? fb : n; };
  var opt = function (el) { var t = el.value.trim(), n = Number(t); return t === "" || !isFinite(n) ? null : n; };
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var query = new URLSearchParams(location.search);

  /* Disclosure groups and method rows: button + region, grid-rows only. */
  $$("[data-mc-group]").forEach(function (g) {
    var btn = $(".mc-gbtn", g);
    if (!btn) return;
    var mode = g.getAttribute("data-mc-group");
    g._set = function (open) { btn.setAttribute("aria-expanded", String(open)); g.classList.toggle("is-open", open); };
    g._set(!(mode === "closed" || (mode === "phone-closed" && matchMedia("(max-width: 760px)").matches)));
    btn.addEventListener("click", function () { g._set(btn.getAttribute("aria-expanded") !== "true"); });
  });
  $$("[data-mc-row]").forEach(function (row) {
    var btn = $("button[aria-expanded]", row);
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(open));
      row.classList.toggle("is-open", open);
      if (open) ty.track("faq_open", { question: "method-" + row.getAttribute("data-mc-row") });
    });
  });
  requestAnimationFrame(function () { requestAnimationFrame(function () { html.classList.add("mc-anim"); }); });

  /* The result's CTA carries the price (and slug) into sign-up. */
  var carried = [];
  function carry(a, params) {
    var base = a.getAttribute("data-href") || a.getAttribute("href");
    var path = base.split("#")[0], qi = path.indexOf("?");
    var sp = new URLSearchParams(qi < 0 ? "" : path.slice(qi + 1));
    path = qi < 0 ? path : path.slice(0, qi);
    for (var k in params) { if (params[k] === null || params[k] === "" || params[k] === undefined) sp.delete(k); else sp.set(k, params[k]); }
    var qs = sp.toString(), url = path + (qs ? "?" + qs : "");
    a.setAttribute("data-href", url);
    a.setAttribute("href", html.getAttribute("data-registration") === "closed" ? path + (qs ? "?" + qs : "") + "#early-access" : url);
    if (carried.indexOf(a) < 0) carried.push(a);
  }
  ty.onFlags(function () { carried.forEach(function (a) { carry(a, {}); }); });

  function viewOnce(el, props) {
    if (!el || !("IntersectionObserver" in root)) return;
    var io = new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) { io.disconnect(); ty.track("calc_result_view", props()); }
    }, { threshold: 0.4 });
    io.observe(el);
  }
  function firstInput(calc) {
    return function (e) {
      var k = e.target && e.target.getAttribute && e.target.getAttribute("data-k");
      if (k && once("ty-c-calc-" + calc)) ty.track("calc_input", { calc: calc, field: k });
    };
  }

  /* ---------- Earnings calculator ---------- */
  var ec = $("[data-ec]");
  if (ec) {
    var ED = C.DEFAULT_EARNINGS_INPUTS, eIn = {};
    $$("[data-k]", ec).forEach(function (el) { eIn[el.getAttribute("data-k")] = el; });
    var QMAP = { subscribers: "subscribers", billing: "billing", price: "workoutPriceAed", months: "programmeMonths", nutrition: "nutritionSharePct",
      nutrition_price: "nutritionPriceAed", voice: "voiceSharePct", voice_price: "voicePriceAed", sessions: "sessionsPerMonth", session_price: "sessionPriceAed", rate: "yourSessionRateAed" };
    var eLive = $("#ec-live"), eCta = $(".mc-cta [data-cta=primary]", ec), eCarry = $("[data-mc-carry]", ec), eSum = {};
    $$("[data-sum]", ec).forEach(function (el) { eSum[el.getAttribute("data-sum")] = el; });
    var readE = function () {
      var v = {};
      for (var k in ED) {
        var el = eIn[k];
        if (!el) v[k] = ED[k];
        else if (k === "billing") v[k] = el.value === "upfront" ? "upfront" : "monthly";
        else v[k] = num(el, Number(ED[k]) || 0); // empty falls back to the default, as in islands.tsx
      }
      return v;
    };
    var labels = function (up) {
      $$("[data-label-monthly]", ec).forEach(function (l) {
        var t = l.querySelector("[data-label-text]");
        t.textContent = l.getAttribute(up ? "data-label-upfront" : "data-label-monthly");
      });
      $$("[data-upfront-only]", ec).forEach(function (f) { f.hidden = !up; });
    };
    var eUpdate = function () {
      var v = readE(), o = F.earn(v), up = v.billing === "upfront";
      labels(up);
      put(ec, "kept", o.kept);
      put(ec, "sessions", o.sessions);
      put(ec, "tally", o.tally, true);
      put(ec, "subsK", o.subsK);
      put(ec, "subsX", o.subsX);
      put(ec, "subsV", o.subsV);
      put(ec, "shareX", o.shareX);
      put(ec, "shareV", o.shareV);
      put(ec, "sessX", o.sessX);
      put(ec, "sessV", o.sessV);
      put(ec, "sumV", o.kept);
      o.bands.forEach(function (b, i) {
        put(ec, "bn" + i, b.n);
        put(ec, "bc" + i, b.c);
        var row = $('[data-band="' + i + '"]', ec); if (row) row.classList.toggle("is-empty", b.empty);
      });
      var fill = $(".mc-rfill", ec); if (fill) fill.style.setProperty("--p", o.p);
      if (eSum.g2) eSum.g2.textContent = o.sum2;
      if (eSum.g3) eSum.g3.textContent = o.sum3;
      if (eCta) carry(eCta, { price_aed: o.price > 0 ? o.price : null });
      if (eCarry) { eCarry.hidden = !(o.price > 0); put(eCarry, "price", o.priceText); }
      ty.announce(eLive, o.say);
    };
    // Prefill from a shared or carried link (?subscribers=15&price=199 ...).
    var pre = false;
    for (var qk in QMAP) {
      if (query.has(qk) && eIn[QMAP[qk]]) {
        var val = query.get(qk);
        if (QMAP[qk] === "billing") { if (val === "upfront" || val === "monthly") { eIn.billing.value = val; pre = true; } }
        else if (val !== "" && isFinite(Number(val))) { eIn[QMAP[qk]].value = String(Number(val)); pre = true; }
      }
    }
    var track = firstInput("earnings");
    ec.addEventListener("input", function (e) { track(e); });
    ec.addEventListener("input", ty.debounce(eUpdate, 120));
    ec.addEventListener("change", function (e) { if (e.target === eIn.billing) { track(e); eUpdate(); } });
    $$("form", ec).forEach(function (f) { f.addEventListener("submit", function (e) { e.preventDefault(); }); });
    quiet = !pre; eUpdate(); quiet = false;
    if (pre) $$("[data-mc-group]", ec).forEach(function (g) { if (g._set) g._set(true); });
    viewOnce($(".mc-sheet", ec), function () { return { calc: "earnings", price_bucket: bucket(readE().workoutPriceAed) }; });

    // "Send this to myself" shares a link that restores these numbers.
    d.addEventListener("click", function (e) {
      if (!e.target.closest || !e.target.closest("[data-share]") || !ec.contains(e.target)) return;
      var v = readE(), sp = new URLSearchParams();
      for (var qk2 in QMAP) { var k = QMAP[qk2]; if (String(v[k]) !== String(ED[k])) sp.set(qk2, v[k]); }
      try { history.replaceState(null, "", location.pathname + (sp.toString() ? "?" + sp : "") + location.hash); } catch (err) {}
    }, true);

    // Worked example: load it into the calculator.
    $$("[data-ec-example]").forEach(function (b) {
      b.addEventListener("click", function () {
        var set = { subscribers: 120, billing: "monthly", workoutPriceAed: 199, nutritionSharePct: 0, voiceSharePct: 0, sessionsPerMonth: 0, yourSessionRateAed: 250 };
        for (var k in set) if (eIn[k]) eIn[k].value = set[k];
        eUpdate();
        var target = $("#calculator");
        if (target) target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        setTimeout(function () { if (eIn.subscribers) eIn.subscribers.focus({ preventScroll: true }); }, reduce ? 0 : 450);
        ty.track("calc_input", { calc: "earnings", field: "worked_example" });
      });
    });
  }

  /* ---------- Follower calculator ---------- */
  var fc = $("[data-fc]");
  if (fc) {
    var FD = C.DEFAULT_FOLLOWER_INPUTS, fIn = {};
    $$("[data-k]", fc).forEach(function (el) { fIn[el.getAttribute("data-k")] = el; });
    var fLive = $("#fc-live"), fCta = $(".mc-cta [data-cta=primary]", fc), fCarry = $("[data-mc-carry]", fc), fSlug = "";
    var chartRoot = $("[data-fc-chart]"), hov = chartRoot && $(".mc-hov", chartRoot), readout = chartRoot && $("[data-fc-readout]", chartRoot);
    var chartData = null, month = 11;
    var readF = function () {
      return {
        followers: num(fIn.followers, 0),
        priceAed: num(fIn.priceAed, 1),
        linkStoriesPerMonth: num(fIn.linkStoriesPerMonth, 0),
        ctaReelsPerMonth: num(fIn.ctaReelsPerMonth, 0),
        keywordDms: fIn.keywordDms ? fIn.keywordDms.checked : FD.keywordDms,
        yearlyCancelPct: num(fIn.yearlyCancelPct, FD.yearlyCancelPct),
        profileVisitsPerMonth: opt(fIn.profileVisitsPerMonth),
        broadcastMembers: opt(fIn.broadcastMembers),
        broadcastLinksPerMonth: num(fIn.broadcastLinksPerMonth, 0),
        storyViews: opt(fIn.storyViews),
        engagementRatePct: opt(fIn.engagementRatePct),
      };
    };
    var showMonth = function (m, active) {
      if (!chartData || !hov) return;
      month = m;
      var x = (m / 11) * 100, cross = $(".mc-x", hov);
      cross.style.left = x + "%";
      S.forEach(function (k) { var dot = $(".mc-dot--" + k, hov); dot.style.left = x + "%"; dot.style.top = chartData.pts[k][m] + "%"; });
      hov.classList.toggle("is-active", !!active);
      var text = F.readout(chartData.vals, m);
      hov.setAttribute("aria-valuenow", String(m + 1));
      hov.setAttribute("aria-valuetext", text);
      if (readout) readout.textContent = text.charAt(0).toUpperCase() + text.slice(1);
    };
    var fUpdate = function () {
      var o = F.fol(readF());
      put(fc, "headline", o.headline);
      var up = $("[data-upto]", fc); if (up) up.hidden = !o.upto;
      put(fc, "case", o.caseText);
      S.forEach(function (k) {
        put(fc, k + "-first", o.cells[k].first);
        put(fc, k + "-active", o.cells[k].active);
        put(fc, k + "-signups", o.cells[k].signups);
        put(fc, k + "-aed", o.cells[k].aed);
      });
      var g = $("[data-growing]", fc); if (g) g.hidden = !o.growing;
      put(fc, "cancel", o.cancel);
      put(fc, "cancelM", o.cancelM);
      put(d, "storyBest", o.storyBest);
      put(d, "typ", o.typ);
      var carryLink = $("[data-fc-carry]"); if (carryLink) carryLink.setAttribute("href", o.carry);
      o.steps.forEach(function (t, i) { put(d, "st-" + i, t); });
      ["bioLink", "keywordReels", "moreStories"].forEach(function (id) { put(d, "lv-" + id + "-first", o.lv[id].first); put(d, "lv-" + id + "-active", o.lv[id].active); });
      put(d, "lv-keywordTitle", o.keywordTitle);
      put(d, "share", o.share);
      var entered = ["profileVisitsPerMonth", "broadcastMembers", "storyViews", "engagementRatePct"].filter(function (k) { return fIn[k] && fIn[k].value.trim() !== ""; }).length;
      var sum = $('[data-sum="own"]', fc); if (sum) sum.textContent = entered ? entered + " entered" : "None entered";
      var sumR = $('[data-sum="reels"]', fc); if (sumR) sumR.textContent = o.sumReels;
      if (chartRoot) {
        chartData = F.chart(o.est);
        put(chartRoot, "chart", chartData.html, true);
        var tb = $("[data-fc-months]"); if (tb) tb.innerHTML = F.monthRows(o.est);
        showMonth(month, hov && hov.classList.contains("is-active"));
      }
      if (fCta) carry(fCta, { price_aed: o.price, slug: fSlug || null });
      if (fCarry) put(fCarry, "price", o.priceText);
      ty.announce(fLive, o.say);
    };
    var fTrack = firstInput("follower");
    fc.addEventListener("input", function (e) { fTrack(e); });
    fc.addEventListener("input", ty.debounce(fUpdate, 120));
    fc.addEventListener("change", function (e) { if (e.target === fIn.keywordDms) { fTrack(e); fUpdate(); } });
    $$("form", fc).forEach(function (f) { f.addEventListener("submit", function (e) { e.preventDefault(); }); });
    var fpre = false;
    [["followers", "followers"], ["price", "priceAed"]].forEach(function (p) {
      var v = query.get(p[0]);
      if (v !== null && v !== "" && isFinite(Number(v))) { fIn[p[1]].value = String(Number(v)); fpre = true; }
    });
    quiet = !fpre; fUpdate(); quiet = false;
    viewOnce($(".mc-sheet", fc), function () { return { calc: "follower", scenario: "strong", price_bucket: bucket(readF().priceAed) }; });

    // "Enter your Story views": open the optional numbers and focus the field.
    $$("[data-fc-views]").forEach(function (b) {
      b.addEventListener("click", function () {
        var g = $("#fc-own"); if (g && g._set) g._set(true);
        setTimeout(function () { if (fIn.storyViews) { fIn.storyViews.focus({ preventScroll: true }); fIn.storyViews.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); } }, 60);
      });
    });
    $$("[data-fc-focus]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        var el = $("#" + a.getAttribute("data-fc-focus")); if (!el) return;
        e.preventDefault();
        var g = el.closest("[data-mc-group]"); if (g && g._set) g._set(true);
        setTimeout(function () { el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); }, 60);
        setTimeout(function () { el.focus({ preventScroll: true }); }, reduce ? 80 : 460);
      });
    });

    // Chart scrubbing: pointer or arrow keys move the month (instant, no tween).
    if (hov) {
      var pick = function (e) { var r = hov.getBoundingClientRect(); return Math.max(0, Math.min(11, Math.round(((e.clientX - r.left) / r.width) * 11))); };
      hov.addEventListener("pointermove", function (e) { showMonth(pick(e), true); });
      hov.addEventListener("pointerdown", function (e) { showMonth(pick(e), true); });
      hov.addEventListener("pointerleave", function () { if (d.activeElement !== hov) showMonth(11, false); });
      hov.addEventListener("focus", function () { showMonth(month, true); });
      hov.addEventListener("blur", function () { showMonth(11, false); });
      hov.addEventListener("keydown", function (e) {
        var m = e.key === "ArrowRight" || e.key === "ArrowUp" ? month + 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? month - 1 : e.key === "Home" ? 0 : e.key === "End" ? 11 : null;
        if (m === null) return;
        e.preventDefault();
        showMonth(Math.max(0, Math.min(11, m)), true);
      });
    }

    // AddressPreview: a live bio preview, and the slug joins the result's CTA.
    var addr = $("#fc-addr");
    if (addr) {
      var bName = $("[data-bio-name]"), bIni = $("[data-bio-initials]"), bSlug = $("[data-bio-slug]");
      addr.addEventListener("input", function () {
        var name = addr.value.trim().slice(0, 60);
        fSlug = ty.slugFromName(name);
        if (bName) bName.textContent = name || "Your coaching name";
        if (bIni) bIni.textContent = (name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join("") || "Y").toUpperCase();
        if (bSlug) bSlug.textContent = fSlug || "your-name";
        if (fCta) carry(fCta, { slug: fSlug || null });
      });
    }
  }
})(typeof self !== "undefined" ? self : this);
