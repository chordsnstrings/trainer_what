/* Concept B · money group scripts (/earnings-calculator, /follower-calculator).
   Owned by the money page builder. Loaded (defer) after site.js and calc.js.
   calc.js owns the maths and the data-in / data-out bindings; this file adds
   the slider mirrors, billing switch, extra outputs (sparkbars, levers,
   method lines), the follower bridge, share-with-inputs, the address
   preview phone and decision 8 (price carried into sign-up). No libraries. */
(function () {
  "use strict";
  var TY = window.TY, K = window.TYCalc;
  if (!TY || !K) return;
  var d = document, root = d.documentElement, $ = TY.$, $$ = TY.$$, whole = K.whole;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  var fire = function (el) { el.dispatchEvent(new Event("input", { bubbles: true })); };
  var fill = function (r) { r.style.setProperty("--fill", ((r.value - r.min) / (r.max - r.min)) * 100 + "%"); };
  var smooth = function () { return root.getAttribute("data-motion") === "reduce" ? "auto" : "smooth"; };

  /* ---------------- Slider mirrors: a range drives its number field ----- */
  var LOG = function (r) { return [Math.log10(+r.getAttribute("data-lo")), Math.log10(+r.getAttribute("data-hi"))]; };
  function toPos(r, v) {
    if (r.getAttribute("data-scale") !== "log") return Math.min(+r.max, Math.max(+r.min, v));
    var l = LOG(r); return Math.round(((Math.log10(Math.min(Math.pow(10, l[1]), Math.max(Math.pow(10, l[0]), v || 1))) - l[0]) / (l[1] - l[0])) * +r.max);
  }
  function fromPos(r) {
    if (r.getAttribute("data-scale") !== "log") return +r.value;
    var l = LOG(r), v = Math.pow(10, l[0] + (r.value / r.max) * (l[1] - l[0]));
    var s = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 2)); // three significant figures
    return Math.round(v / s) * s;
  }
  function valueText(r, v) { r.setAttribute("aria-valuetext", (r.getAttribute("data-valuetext") || "{v}").replace("{v}", whole(v))); }
  var fromSlider = false;
  function mirrorFrom(num) {
    if (fromSlider || !num.id) return;
    $$('input[data-mirror="' + num.id + '"]').forEach(function (r) { var v = +num.value || 0; r.value = String(toPos(r, v)); fill(r); valueText(r, v); });
  }
  d.addEventListener("input", function (e) {
    var t = e.target;
    if (!t.matches) return;
    if (t.matches("input[data-mirror]")) {
      var num = d.getElementById(t.getAttribute("data-mirror")); if (!num) return;
      var v = fromPos(t); fill(t); valueText(t, v);
      num.value = String(v); fromSlider = true; fire(num); fromSlider = false;
      return;
    }
    if (t.matches("input[data-in]")) mirrorFrom(t);
    if (t.matches('input[type="range"][data-in]')) {
      $$('[data-show-of="' + t.getAttribute("data-in") + '"]').forEach(function (el) { TY.setValue(el, t.value + "%"); });
    }
  });

  /* Steppers (link Stories): two buttons around a number field */
  d.addEventListener("click", function (e) {
    var b = e.target.closest("[data-step-by]"); if (!b) return;
    var input = b.parentNode.querySelector("input"), v = (+input.value || 0) + +b.getAttribute("data-step-by");
    v = Math.min(+input.max, Math.max(+input.min, v));
    if (String(v) === input.value) return;
    input.value = String(v); fire(input);
  });

  /* Disclosures: More inputs and the 8-step method (not FAQ events) */
  d.addEventListener("click", function (e) {
    var b = e.target.closest("[data-mx-acc]"); if (!b) return;
    var acc = b.closest(".acc"), open = !acc.classList.contains("is-open");
    acc.classList.toggle("is-open", open); b.setAttribute("aria-expanded", String(open));
  });

  /* Sources on phones: the first four, then "Show all" */
  d.addEventListener("click", function (e) {
    var b = e.target.closest("[data-mx-sources]"); if (!b) return;
    var list = d.getElementById(b.getAttribute("aria-controls")), open = !list.classList.contains("is-all");
    list.classList.toggle("is-all", open); b.setAttribute("aria-expanded", String(open));
    b.firstChild.textContent = open ? "Show fewer sources" : "Show all " + list.children.length + " sources";
  });

  /* Settle: the result flashes once input pauses (150 ms) */
  var quiet = false;
  function settle(el) { if (!el || quiet) return; clearTimeout(el._st); el._st = setTimeout(function () { TY.flash(el); }, 150); }
  /* Re-render once silently so this file's extra outputs match the inputs
     (calc.js rendered before these listeners existed). */
  function silentUpdate(rootEl) {
    var an = TY.announce; quiet = true; TY.announce = function () {};
    try { K.update(rootEl, false); } catch (err) {}
    TY.announce = an; quiet = false;
  }

  /* ======================= EARNINGS CALCULATOR ========================== */
  var ec = $(".mx-ecalc");
  if (ec) {
    var hidden = $('[data-in="billing"]', ec), seg = $("[data-mx-seg]", ec);
    var setBilling = function (v, silent) {
      ec.setAttribute("data-billing", v); hidden.value = v;
      $$("[data-billing-radio]", ec).forEach(function (r) { r.checked = r.value === v; });
      if (seg) seg.setAttribute("data-on", v);
      if (!silent) fire(hidden);
    };
    ec.addEventListener("change", function (e) { if (e.target.matches("[data-billing-radio]")) setBilling(e.target.value); });

    var KEYS = [["subscribers", "subs"], ["billing", "billing"], ["price", "price"], ["months", "months"], ["nutritionShare", "nutrition"], ["nutritionPrice", "nutritionPrice"], ["voiceShare", "voice"], ["voicePrice", "voicePrice"], ["sessions", "sessions"], ["sessionPrice", "sessionPrice"], ["rate", "rate"]];
    var field = function (k) { return $('[data-in="' + k + '"]', ec); };
    var DEF = {}; // first-paint values (a hidden input's defaultValue follows its value)
    KEYS.forEach(function (k) { var el = field(k[0]); if (el) DEF[k[0]] = el.value; });
    var shareUrl = function () {
      var u = new URL(location.href); u.hash = "";
      KEYS.forEach(function (k) { var el = field(k[0]); if (el && el.value !== DEF[k[0]]) u.searchParams.set(k[1], el.value); else u.searchParams.delete(k[1]); });
      return u.toString();
    };
    d.addEventListener("click", function (e) {
      var a = e.target.closest('a[href="#share"], [data-share-calc]'); if (!a) return;
      e.preventDefault(); TY.share({ url: shareUrl(), title: d.title });
    });

    /* Restore numbers sent with "Send this to myself" */
    var q = new URLSearchParams(location.search), restored = false;
    KEYS.forEach(function (k) {
      var raw = q.get(k[1]), el = field(k[0]); if (raw === null || !el) return;
      if (k[0] === "billing") { if (raw === "upfront" || raw === "monthly") { setBilling(raw, true); restored = true; } return; }
      var n = Number(raw); if (!Number.isFinite(n) || n < 0) return;
      el.value = String(Math.min(+el.max || Infinity, n)); restored = true;
      mirrorFrom(el);
      if (el.type === "range") { fill(el); $$('[data-show-of="' + k[0] + '"]').forEach(function (s) { TY.setValue(s, el.value + "%"); }); }
    });

    var keep = $("[data-mx-keep]", ec), rateShow = $("[data-rate-show]", ec);
    ec.addEventListener("ty:calc", function (e) {
      if (rateShow) rateShow.textContent = K.aed(Math.round(e.detail.inputs.yourSessionRateAed) * 100);
      settle(keep);
    });
    if (restored) K.update(ec, false); else silentUpdate(ec);

    /* Worked example: load 120 subscribers at AED 199, no extras */
    var EX = { subscribers: 120, price: 199, nutritionShare: 0, voiceShare: 0, sessions: 0, rate: 250 };
    var res = $(".mx-res", ec);
    var showResult = function () { if (res) res.scrollIntoView({ behavior: smooth(), block: "center" }); };
    d.addEventListener("click", function (e) {
      if (!e.target.closest("[data-example]")) return;
      setBilling("monthly", true);
      Object.keys(EX).forEach(function (k) {
        var el = field(k); if (!el) return; el.value = String(EX[k]); mirrorFrom(el);
        if (el.type === "range") { fill(el); $$('[data-show-of="' + k + '"]').forEach(function (s) { TY.setValue(s, el.value + "%"); }); }
      });
      fire(field("subscribers")); showResult();
    });

    /* Follower bridge: estimate subscribers, then use one above */
    var br = $("[data-mx-bridge]"), brLive = br && $("[data-mx-live]", br);
    if (br) {
      var NAMES = { cautious: "cautious", typical: "typical", strong: "best case" };
      br.addEventListener("ty:calc", function (e) {
        var s = e.detail.estimate.scenarios, parts = [];
        $$("[data-pick]", br).forEach(function (b) {
          var k = b.getAttribute("data-pick"), n = K.displayCount(s[k].activeMonth12) || 0;
          b.setAttribute("data-n", n); b.setAttribute("aria-label", "Use " + NAMES[k] + ": " + K.countLabel(s[k].activeMonth12) + " subscribers");
          parts.push(K.countLabel(s[k].activeMonth12));
        });
        TY.announce(brLive, "Active subscribers after 12 months: cautious " + parts[0] + ", typical " + parts[1] + ", best case " + parts[2] + ".");
      });
      br.addEventListener("click", function (e) {
        var b = e.target.closest("[data-pick]"); if (!b) return;
        var subs = field("subscribers"); subs.value = b.getAttribute("data-n"); mirrorFrom(subs); fire(subs);
        TY.track("calc_input", { calc: "follower_bridge", scenario: b.getAttribute("data-pick") });
        showResult();
      });
    }
  }

  /* ======================= FOLLOWER CALCULATOR ========================== */
  var fc = $(".mx-fcalc");
  if (fc) {
    var best = $("[data-mx-best]", fc);
    var CAP = {
      bioLink: function () { return "your bio link, per 1,000 profile visits a month"; },
      keywordReels: function (i) { return i.keywordDms && i.ctaReelsPerMonth > 0 ? "4 more Reels a month with a comment keyword" : "a comment keyword on 4 Reels a month"; },
      moreStories: function () { return "4 more link Stories a month"; },
    };
    var gain = function (n) { return n < 0.05 ? "about the same" : n < 10 ? "+" + n.toFixed(1) : "+" + whole(Math.round(n)); };
    var pct = K.pct;

    function sparks(sc) {
      var max = 0;
      K.FOLLOWER_SCENARIOS.forEach(function (k) { sc[k].activeByMonth.forEach(function (v) { if (v > max) max = v; }); });
      K.FOLLOWER_SCENARIOS.forEach(function (k) {
        var w = $('[data-spark="' + k + '"]', fc); if (!w) return;
        w._data = sc[k].activeByMonth;
        $$("i", w).forEach(function (bar, m) { var v = sc[k].activeByMonth[m], r = max > 0 ? v / max : 0; bar.style.setProperty("--v", v > 0 ? Math.max(0.05, r).toFixed(4) : "0"); });
      });
    }
    function levers(inputs, used) {
      var list = K.followerLevers(inputs);
      $$("[data-lever]").forEach(function (box) {
        var id = box.getAttribute("data-lever"), l = list.filter(function (x) { return x.id === id; })[0];
        box.hidden = !l; if (!l) return;
        var c = $("[data-lever-cap]", box); if (c) c.textContent = CAP[id](used);
        $$("[data-lever-out]", box).forEach(function (el) {
          var key = el.getAttribute("data-lever-out"), v = l[key];
          TY.setValue(el, key === "revenueMonth12Minor" ? (v > 0 ? "+" + K.aed(v) : "no change") : gain(v));
        });
      });
    }
    function methodLines(est) {
      var u = est.inputs, sc = est.scenarios, v = $('[data-method="views"]'), ch = $('[data-method="churn"]');
      if (v) v.textContent = u.storyViews !== null
        ? "Using your " + whole(u.storyViews) + " average Story views in every scenario."
        : "About " + K.FOLLOWER_SCENARIOS.map(function (k) { return whole(Math.round(sc[k].storyViewers)); }).join(", ").replace(/, ([^,]*)$/, " and $1") + " people see your Stories each month at your numbers (cautious, typical, best case).";
      if (ch) ch.textContent = "At your numbers: " + pct(u.yearlyCancelPct) + " a year is about " + pct(Math.round(est.monthlyCancelPct * 100) / 100) + " a month.";
    }
    fc.addEventListener("ty:calc", function (e) {
      var est = e.detail.estimate;
      sparks(est.scenarios); levers(e.detail.inputs, est.inputs); methodLines(est); settle(best);
    });

    /* Spark readout on hover: "Month 6 · 54 active" */
    $$("[data-spark]", fc).forEach(function (w) {
      var read = $("[data-spark-read]", w), base = read.textContent;
      w.addEventListener("pointerover", function (e) {
        var b = e.target.closest("b[data-m]"); if (!b) return;
        var m = +b.getAttribute("data-m"), data = w._data;
        var v = data ? data[m - 1] : null;
        read.textContent = "Month " + m + (v === null ? "" : " · " + K.countLabel(v) + " active");
      });
      w.addEventListener("pointerleave", function () { read.textContent = base; });
    });
    silentUpdate(fc);

    /* Address preview: the typed name and address appear on the sample page */
    var addr = $("#addr-fc"), stage = $(".mx-claim-stage");
    if (addr && stage) {
      var url = $(".phone-url span", stage), name = $(".po-brand b", stage), mono = $(".po-brand .po-mono", stage), by = $(".po-fine", stage);
      addr.addEventListener("input", function () {
        var raw = addr.value.trim().replace(/\s+/g, " ").slice(0, 28), slug = TY.slugFromName(addr.value);
        var words = raw.split(" ").filter(Boolean);
        url.textContent = (slug || "layla-strength") + ".trainsyou.com";
        name.textContent = raw || "Layla Strength";
        mono.textContent = words.length ? (words[0][0] + (words[1] ? words[1][0] : "")).toUpperCase() : "LS";
        by.textContent = "Digital coach, taught by " + (words[0] || "Layla");
      });
    }
  }

  /* ======================= Hero replay (dev panel) ====================== */
  TY.onHero(function (hero, replay) {
    if (!replay) return; // first paint is already the real result
    TY.flash($("[data-mx-keep]") || $("[data-mx-best]"));
  });

  /* ============ Decision 8 + attribution on every sign-up link ========== */
  // Same switch and storage key as the audience pages, so the state carries
  // across the site. Off by default (live): no price_aed, no price line.
  var d8 = store.get("tyB-d8") === "on" ? "on" : "off";
  root.setAttribute("data-d8", d8);
  var ATTR = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "ref"];
  function attribution() {
    var q = new URLSearchParams(location.search), cur = {}, consent = null, first = null;
    ATTR.forEach(function (k) { var v = q.get(k); if (v) cur[k] = v.slice(0, 120); });
    try { consent = (JSON.parse(store.get("tyB") || "{}") || {}).consent; } catch (e) {}
    if (consent !== "granted") return cur;
    try { first = JSON.parse(store.get("tyB-first") || "null"); } catch (e) {}
    if (!first && Object.keys(cur).length) { first = cur; store.set("tyB-first", JSON.stringify(cur)); }
    return first || cur;
  }
  function price() { var el = $('main input[data-in="price"]'); var v = el ? Math.round(+el.value) : NaN; return Number.isFinite(v) && v >= 1 ? v : null; }
  function withParams(url, extra) {
    var h = url.indexOf("#"), hash = h > -1 ? url.slice(h) : "", base = h > -1 ? url.slice(0, h) : url;
    var qi = base.indexOf("?"), path = qi > -1 ? base.slice(0, qi) : base, p = new URLSearchParams(qi > -1 ? base.slice(qi + 1) : "");
    Object.keys(extra).forEach(function (k) { if (extra[k] !== null && extra[k] !== undefined) p.set(k, extra[k]); });
    var s = p.toString(); return path + (s ? "?" + s : "") + hash;
  }
  function decorate() {
    var extra = Object.assign({}, attribution()), pr = d8 === "on" ? price() : null;
    if (pr) extra.price_aed = String(pr);
    $$('a[href^="signup.html"], a[data-href^="signup.html"]').forEach(function (a) {
      if (!a.hasAttribute("data-mx-base")) a.setAttribute("data-mx-base", a.getAttribute("data-href") || a.getAttribute("href"));
      var next = withParams(a.getAttribute("data-mx-base"), extra);
      if (a.classList.contains("js-primary")) { a.setAttribute("data-href", next); if (TY.state.registration === "open") a.setAttribute("href", next); }
      else a.setAttribute("href", next);
    });
  }
  var decoT;
  d.addEventListener("input", function (e) {
    var t = e.target;
    if (t.closest && t.closest("[data-address]")) { var a = t.closest("[data-address]").querySelector("a[data-claim]"); if (a) a.setAttribute("data-mx-base", a.getAttribute("href")); decorate(); return; }
    if (t.matches && t.matches('[data-in="price"], [data-mirror]')) { clearTimeout(decoT); decoT = setTimeout(decorate, 120); }
  });
  d.addEventListener("ty:state", function (e) { if (e.detail && e.detail.key === "registration") decorate(); });
  var dev = $("#dev");
  if (dev && !$("[data-mx-sw]", dev)) {
    var secs = $$(".dev-sec", dev), host = secs[1] || secs[0], row = d.createElement("div");
    row.className = "sw";
    row.innerHTML = '<span id="sw-d8">Price carried into sign-up<small>Decision 8 (price_aed). Live: off</small></span><button type="button" role="switch" aria-labelledby="sw-d8" data-mx-sw></button>';
    if (host) host.appendChild(row);
    var sw = $("button", row);
    var setD8 = function (v) { d8 = v; root.setAttribute("data-d8", v); sw.setAttribute("aria-checked", String(v === "on")); store.set("tyB-d8", v); decorate(); };
    sw.setAttribute("aria-checked", String(d8 === "on"));
    sw.addEventListener("click", function () { setD8(d8 === "on" ? "off" : "on"); });
    var reset = $('[data-dev="reset"]', dev); if (reset) reset.addEventListener("click", function () { setD8("off"); });
  }
  decorate();
})();
