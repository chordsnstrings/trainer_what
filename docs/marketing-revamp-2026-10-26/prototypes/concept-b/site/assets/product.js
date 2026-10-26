/* Concept B · product group scripts (owner: product builder). Deferred after
   site.js and calc.js. Uses window.TY; no libraries, no loops, no timers
   beyond one short sequence per click. */
(function () {
  "use strict";
  var TY = window.TY;
  if (!TY) return;
  var $ = TY.$, $$ = TY.$$, d = document, W = window;
  var on = function (el, ev, fn) { if (el) el.addEventListener(ev, fn); };
  var sel = function (el) { return el.getAttribute("aria-selected") === "true"; };
  /* Move a lane highlight (translateY, 280 ms in CSS) and mark the lane. */
  function lane(box, i) {
    box.style.setProperty("--lane", i); box.setAttribute("data-lane", i);
    $$(".lane", box).forEach(function (l, j) { l.classList.toggle("is-active", j === +i); });
  }

  /* How it works: tabs crossfade (initTabs), line draws, device screens swap. */
  $$("[data-hiw]").forEach(function (root) {
    var list = $("[role=tablist]", root), api = TY.initTabs(list), n = api.tabs.length;
    var prev = $("[data-hiw-prev]", root), next = $("[data-hiw-next]", root);
    var cur = function () { return api.tabs.findIndex(sel); };
    on(list, "ty:tab", function (e) {
      var i = e.detail.index;
      api.tabs.forEach(function (t, j) { t.classList.toggle("is-done", j <= i); });
      $$(".fg", root).forEach(function (l) { l.style.setProperty("--p", (i + 1) / n); });
      $$(".hiw-scr", root).forEach(function (s) { s.classList.toggle("is-on", +s.getAttribute("data-s") === i); });
      prev.disabled = !i; next.disabled = i === n - 1;
      $("[data-hiw-count]", root).textContent = i + 1 + " of " + n;
    });
    on(list, "keydown", function (e) {
      var k = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (k) { e.preventDefault(); api.select((cur() + k + n) % n, true); }
    });
    on(prev, "click", function () { api.select(Math.max(0, cur() - 1)); });
    on(next, "click", function () { api.select(Math.min(n - 1, cur() + 1)); });
  });

  /* Trainer Brain: rule card (Confirm stamps with spring), releases, blind compare. */
  $$("[data-rule-card]").forEach(function (card) {
    var opts = $$(".rc-opt", card), pick = "2.5 kg", live = $("[data-live]", card);
    function mode(m, msg, state) {
      card.classList.toggle("is-confirmed", m === "confirm"); card.classList.toggle("is-rejected", m === "reject");
      $("[data-rc-actions]", card).hidden = m !== "idle"; $("[data-rc-editor]", card).hidden = m !== "edit";
      $("[data-rc-done]", card).hidden = m !== "confirm" && m !== "reject";
      if (msg) $("[data-rc-msg]", card).textContent = msg;
      TY.setValue($("[data-rc-state]", card), state); TY.announce(live, msg || state);
    }
    function choose(o) { opts.forEach(function (x) { x.setAttribute("aria-checked", x === o); x.tabIndex = x === o ? 0 : -1; }); pick = o.getAttribute("data-kg"); }
    var focus = function (a) { $("[data-rc=" + a + "]", card).focus(); };
    opts.forEach(function (x) { x.tabIndex = x.getAttribute("aria-checked") === "true" ? 0 : -1; });
    on(card, "click", function (e) {
      var o = e.target.closest(".rc-opt"), b = e.target.closest("[data-rc]"), a = b && b.getAttribute("data-rc");
      if (o) return choose(o);
      if (!a) return;
      if (a === "confirm") { mode(a, "Confirmed. It joins your next tested release.", "Confirmed"); focus("undo"); }
      if (a === "reject") { mode(a, "Rejected. Your AI won’t use it.", "Rejected"); focus("undo"); }
      if (a === "edit") { mode("edit", "", "Editing"); opts.filter(function (x) { return x.tabIndex === 0; })[0].focus(); }
      if (a === "save") { var kg = $("[data-rc-kg]", card); TY.setValue(kg, pick); TY.flash(kg.closest(".flash")); mode("idle", "Saved: add " + pick + ". Waiting for you to confirm.", "Edited · waiting for you"); focus("confirm"); }
      if (a === "undo") { mode("idle", "", "Waiting for you"); focus("confirm"); }
      TY.track("demo_rule_edit", { scenario: "rule_card", field: a, value: a === "save" ? pick : undefined });
    });
    on(card, "keydown", function (e) {
      var o = e.target.closest(".rc-opt"), k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!o || !k) return;
      if (getComputedStyle(card).direction === "rtl" && /Left|Right/.test(e.key)) k = -k;
      e.preventDefault(); var nb = opts[(opts.indexOf(o) + k + opts.length) % opts.length]; choose(nb); nb.focus();
    });
  });
  $$("[data-releases]").forEach(function (r) {
    var back = false;
    on($("[data-rel-btn]", r), "click", function () {
      back = !back;
      var v = back ? 2 : 3;
      $(".rel-track", r).style.setProperty("--v", v);
      $$(".rel", r).forEach(function (el) { el.classList.toggle("is-live", +el.getAttribute("data-v") === v); });
      TY.setValue($("[data-rel-now]", r), "v" + (v + 1) + " is live");
      $("[data-rel-label]", r).textContent = back ? "Restore v4" : "Roll back to v3";
      TY.announce($("[data-live]", r), (back ? "Rolled back" : "Restored") + ". Version " + (v + 1) + " is live.");
      TY.track("demo_rule_edit", { scenario: "releases", field: "rollback", value: "v" + (v + 1) });
    });
  });
  $$("[data-compare]").forEach(function (c) {
    var b = $("[data-cmp-btn]", c);
    on(b, "click", function () {
      var shown = c.classList.toggle("is-revealed");
      b.setAttribute("aria-pressed", shown); b.textContent = shown ? "Hide again" : "Reveal which is yours";
      $$(".sw2", c).forEach(function (s) { s.children[0].setAttribute("aria-hidden", shown); s.children[1].setAttribute("aria-hidden", !shown); });
    });
  });

  /* Feature vignettes ship in their final state (state B, complete HTML), so
     the first screen is never hidden. A vignette that starts below the first
     screen is "armed" (back to state A, off screen) and plays its one change
     when 60% visible. "Replay hero" replays the hero one for review. */
  function aria(v) { $$(".sw2", v).forEach(function (s) { s.children[0].setAttribute("aria-hidden", "true"); s.children[1].removeAttribute("aria-hidden"); }); }
  function play(v, replay) {
    if (replay) { v.classList.add("vg-armed"); v.classList.remove("is-b"); void v.offsetWidth; }
    v.classList.add("is-b"); aria(v);
    setTimeout(function () { $$("[data-vflash], .vg-stmt .st-row--total", v).forEach(function (el) { el.classList.add("flash"); TY.flash(el); }); }, 220);
  }
  var vigs = $$("[data-vig]");
  if (vigs.length) {
    var io = W.IntersectionObserver && new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.intersectionRatio >= 0.6) { io.unobserve(e.target); setTimeout(play, 240, e.target); } });
    }, { threshold: [0, 0.6] });
    vigs.forEach(function (v) {
      var r = v.getBoundingClientRect();
      if (!io || r.top < innerHeight) return; // first screen: stays in its final state
      v.classList.add("vg-armed"); v.classList.remove("is-b"); io.observe(v);
    });
    TY.onHero(function (hero, replay) { if (replay) $$("[data-vig]", hero).forEach(function (v) { play(v, true); }); });
  }

  /* Features: the 91-capability disclosures (grid rows). */
  on(d, "click", function (e) {
    var b = e.target.closest(".cap-btn");
    if (b) b.setAttribute("aria-expanded", b.closest(".cap").classList.toggle("is-open"));
  });

  /* Subscriber app: EN / AR preview, this vignette only (real member-app strings). */
  var rtl = $$("[data-rtl-set]");
  function syncRtl() {
    rtl.forEach(function (b) { b.setAttribute("aria-pressed", TY.state.rtl === b.getAttribute("data-rtl-set")); });
    var sw = $('[data-sw="rtl"]'); if (sw) sw.setAttribute("aria-checked", TY.state.rtl === "on");
  }
  if (rtl.length) {
    rtl.forEach(function (b) { on(b, "click", function () { TY.set("rtl", b.getAttribute("data-rtl-set")); syncRtl(); }); });
    on(d, "ty:state", function (e) { if (e.detail.key === "rtl") syncRtl(); });
    syncRtl();
  }

  /* Nutrition: calc.js computes the average; we render the share and the mix. */
  $$(".nt[data-calc]").forEach(function (root) {
    on(root, "ty:calc", function (e) {
      var s = +$("[data-in=nutritionShare]", root).value;
      TY.setValue($("[data-nt-share]", root), s + "%");
      $(".nt-mix-n", root).style.setProperty("--s", s / 100);
      TY.announce($("[data-nt-live]", root), "Average " + W.TYCalc.aed(e.detail.estimate.averageMonthlyMinor) + " a month, with " + s + "% adding nutrition.");
    });
  });

  /* Demo: on tab click only — message enters, typing dots (opacity, ~1 s),
     meter fills, lane slides 280 ms, outcome crossfades with a Pace flash. */
  $$("[data-demo]").forEach(function (root) {
    var tabs = $$("[role=tab]", root), timers = [], live = $("[data-dm-live]", root);
    var later = function (fn, ms) { timers.push(setTimeout(fn, ms)); };
    var stage = function (s) { root.setAttribute("data-stage", s); };
    function show(i, focus) {
      timers.forEach(clearTimeout); timers = [];
      var t = tabs[i], s = t.getAttribute("data-sure");
      tabs.forEach(function (x, j) { x.setAttribute("aria-selected", i === j); x.tabIndex = i === j ? 0 : -1; });
      if (focus) t.focus();
      $("#dm-panel", root).setAttribute("aria-labelledby", t.id);
      $$(".dm-l", root).forEach(function (l) { l.classList.toggle("is-on", +l.getAttribute("data-l") === i); });
      stage(0);
      TY.track("demo_play", { scenario: t.getAttribute("data-key") });
      later(function () { stage(1); $(".dm-meter .meter", root).style.setProperty("--v", s ? s / 100 : 0); TY.setValue($("[data-dm-sure]", root), s ? s + "%" : "Rule"); }, 320);
      later(function () { lane($(".dm-lanes", root), t.getAttribute("data-lane")); }, 700);
      later(function () { stage(2); var o = $(".dm-out-l.is-on .dm-out", root); o.classList.add("flash"); TY.flash(o); TY.setValue($("[data-dm-pays]", root), t.getAttribute("data-pays")); }, 1050);
      later(function () { stage("done"); TY.announce(live, t.getAttribute("data-say")); }, 1420);
    }
    on(root, "click", function (e) {
      var t = e.target.closest("[role=tab]"), a = e.target.closest("[data-ap]");
      if (t && (!sel(t) || root.getAttribute("data-stage") === "done")) show(tabs.indexOf(t));
      if (a) {
        var m = $("[data-ap-msg]", root), k = a.getAttribute("data-ap");
        m.textContent = k === "approve" ? "Approved. Sent to the subscriber." : "Noted. Your correction becomes teaching.";
        TY.announce(live, m.textContent); TY.track("demo_rule_edit", { scenario: "hotel_gym", field: k });
      }
    });
    on($(".dm-tabs", root), "keydown", function (e) {
      var i = tabs.indexOf(d.activeElement), n = tabs.length, r = getComputedStyle(root).direction === "rtl" ? -1 : 1;
      var k = { ArrowRight: r, ArrowDown: 1, ArrowLeft: -r, ArrowUp: -1 }[e.key];
      var to = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : k ? (i + k + n) % n : null;
      if (i > -1 && to !== null) { e.preventDefault(); show(to, true); }
    });
  });

  /* Rule builder: "After [2] sessions at [3] or more reps in reserve, add [2.5] kg".
     Deterministic against the sample's last three sessions (4, 3, 1 in reserve). */
  $$("[data-rb]").forEach(function (rb) {
    var st = { n: 2, r: 3, kg: 2.5 }, LIM = { n: [1, 4, 1], r: [1, 5, 1], kg: [0.5, 5, 0.5] }, logs = $$(".rb-s", rb), out = $("[data-rb-out]", rb);
    var kg = function (x) { return String(Math.round(x * 100) / 100); };
    function compute(user) {
      var q = 0;
      while (q < logs.length && +logs[q].getAttribute("data-rir") >= st.r) q++;
      logs.forEach(function (l, j) { l.classList.toggle("is-ok", j < st.n && j < q); l.classList.toggle("is-miss", j < st.n && j >= q); });
      var ok = q >= st.n, need = st.n - q;
      var text = ok ? "60 kg → " + kg(60 + st.kg) + " kg" : "Not yet: " + (need === 1 ? "one more easy session" : need + " more easy sessions");
      out.classList.toggle("is-wait", !ok);
      TY.setValue($("[data-rb-res]", rb), text);
      TY.setValue($("[data-rb-lane]", rb), ok ? "Applied automatically" : "Waits for the next session");
      $$("[data-rb-step]", rb).forEach(function (b) {
        var k = b.getAttribute("data-rb-step");
        b.setAttribute("aria-disabled", +b.getAttribute("data-d") < 0 ? st[k] <= LIM[k][0] : st[k] >= LIM[k][1]);
      });
      if (user) {
        TY.flash(out);
        TY.announce($("[data-live]", rb), (ok ? "Applied automatically. Back squat " + text.replace("→", "to") : text) + ". Rule: after " + st.n + " sessions at " + st.r + " or more reps in reserve, add " + kg(st.kg) + " kilograms.");
      }
    }
    on(rb, "click", function (e) {
      var b = e.target.closest("[data-rb-step]"); if (!b) return;
      var k = b.getAttribute("data-rb-step"), L = LIM[k], v = Math.min(L[1], Math.max(L[0], st[k] + L[2] * b.getAttribute("data-d")));
      if (v === st[k]) return;
      st[k] = v;
      TY.setValue($('[data-rb-v="' + k + '"]', rb), kg(v));
      compute(true);
      TY.track("demo_rule_edit", { scenario: "rule_builder", field: { n: "sessions", r: "reps_in_reserve", kg: "kg" }[k], value: v });
    });
    compute(false);
  });

  /* How sure must it be? The sample decision is 86%; above that line it goes to you. */
  $$("[data-th]").forEach(function (th) {
    var input = $("[data-th-in]", th);
    function upd(user) {
      var t = +input.value, ok = t <= 86;
      var txt = ok ? "86% is sure enough. The change is applied and logged." : "86% is below your line. The change comes to you as a draft.";
      TY.setValue($("[data-th-v]", th), t + "%");
      $(".th-mark b", th).textContent = "Must be " + t + "%";
      $(".th-mark", th).style.setProperty("--t", (t - 50) / 50);
      input.style.setProperty("--fill", ((t - 60) / 35) * 100 + "%");
      input.setAttribute("aria-valuetext", t + "%: " + (ok ? "sure enough, applied automatically" : "unsure, goes to you"));
      lane($(".th-lanes", th), ok ? 0 : 1);
      TY.setValue($("[data-th-res]", th), txt);
      if (user) TY.announce($("[data-live]", th), t + "%. " + txt);
    }
    on(input, "input", function () { upd(true); });
    on(input, "change", function () { TY.track("demo_threshold", { scenario: "squats_easy", value: +input.value }); });
    upd(false);
  });
})();
