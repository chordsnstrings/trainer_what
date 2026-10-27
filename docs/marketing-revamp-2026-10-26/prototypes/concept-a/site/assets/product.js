/* trainsyou · Concept A "Live Brain" · product pages.
 * Vignettes (play once) · stepper console · rule ledger · releases · compare replies ·
 * capability matrix · demo scenarios + threshold meter · RTL preview · pain report.
 * Uses window.ty from site.js (documented in src/BUILDERS.md). */
(function () {
  "use strict";
  var ty = window.ty;
  if (!ty) return;
  var $ = ty.$, $$ = ty.$$, on = ty.on, d = document, w = window;
  var attr = function (el, k) { return el.getAttribute(k); };

  /* Vignettes: one state change, played once when half in view (after load). */
  function arm() {
    var vs = $$("[data-vignette]");
    if (!("IntersectionObserver" in w)) return vs.forEach(ty.play);
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting && !e.target._played) { io.unobserve(e.target); ty.play(e.target); }
      });
    }, { threshold: 0.5 });
    vs.forEach(function (v) { io.observe(v); });
  }
  if (d.readyState === "complete") setTimeout(arm, 300);
  else on(w, "load", function () { setTimeout(arm, 300); });
  on(d, "click", function (e) {
    var b = e.target.closest && e.target.closest("[data-vreplay]");
    if (!b) return;
    ty.play(b.closest("[data-vignette]"));
    ty.track("demo_play", { scenario: "vignette-replay" });
  });
  on(d, "ty:replay", function () { $$("[data-hero] [data-vignette]").forEach(ty.play); });

  /* /how-it-works: the console in 8 states follows the stepper tabs. */
  $$("[data-hw]").forEach(function (box) {
    var ls = $$(".hw-l", box), tabs = $$('[role="tab"]', box);
    on(box, "ty:tab", function (e) {
      var i = e.detail.index;
      ls.forEach(function (l) { l.classList.toggle("is-on", +attr(l, "data-i") === i); });
      tabs.forEach(function (t, j) { t.classList.toggle("is-done", j < i); });
      box.style.setProperty("--k", i);
    });
  });

  /* /trainer-brain: rule card Confirm / Edit / Reject (+ Approve all, which skips flagged rules). */
  $$("[data-ledger]").forEach(function (box) {
    var card = $("[data-rule-card]", box), txt = $(".rc-text", card), ed = $(".rc-edit", card), ta = $("textarea", card);
    var live = $("[data-live]", card), st = $(".rc-status .vx", card), cnt = $(".tb-count", box), lbl = $(".rc-confirm-l", card);
    var orig = txt.textContent, editing = false;
    var btn = function (a) { return $('[data-rc-act="' + a + '"]', box); };
    var LABEL = { pending: "To review", confirmed: "Confirmed", edited: "Edited · confirmed", rejected: "Rejected · not used" };
    function edit(open) {
      editing = open; ed.hidden = !open; txt.hidden = open;
      lbl.textContent = open ? "Save and confirm" : "Confirm";
      btn("edit").textContent = open ? "Cancel" : "Edit";
      if (open) { ta.value = txt.textContent; ta.focus(); }
    }
    function set(state, msg) {
      var done = state !== "pending";
      card.setAttribute("data-rc", state);
      ["confirm", "edit", "reject"].forEach(function (a) { btn(a).hidden = done; });
      btn("undo").hidden = !done;
      btn("all").disabled = done;
      ty.swap(st, LABEL[state]);
      ty.swap(cnt, done ? "1 flagged" : "1 to review · 1 flagged");
      $(".rc-stamp-l", card).textContent = state === "edited" ? "Edited" : "Confirmed";
      ty.announce(live, msg);
      if (done) { btn("undo").focus(); ty.track("demo_rule_edit", { field: "rule_card", value: state }); }
    }
    on(box, "click", function (e) {
      var b = e.target.closest("[data-rc-act]");
      if (!b) return;
      var a = attr(b, "data-rc-act");
      if (a === "edit") return edit(!editing);
      if (a === "confirm" || a === "all") {
        var v = editing ? ta.value.trim() : "", changed = v && v !== txt.textContent;
        if (editing) { if (v) txt.textContent = v; edit(false); }
        return set(changed ? "edited" : "confirmed", a === "all" ? "Approved 1 rule. The flagged rule still needs you." : "Rule confirmed.");
      }
      if (a === "reject") { if (editing) edit(false); return set("rejected", "Rule rejected. It won’t be used."); }
      if (a === "undo") { txt.textContent = orig; set("pending", "Back to review."); btn("confirm").focus(); }
    });
  });

  /* Release timeline: roll back moves the Live marker one version (translateX). */
  $$("[data-release]").forEach(function (r) {
    var back = false, live = $("[data-live]", r);
    on($("[data-rel-btn]", r), "click", function () {
      back = !back;
      r.classList.toggle("is-back", back);
      ty.swap($(".rel-msg", r), back ? "v3 live · v4 kept, not in use" : "v4 live · checked against your test cases");
      ty.swap($(".rel-btn-l", r), back ? "Restore v4" : "Roll back to v3");
      ty.announce(live, back ? "Rolled back. Version 3 is live." : "Version 4 is live again.");
      ty.track("demo_play", { scenario: back ? "rollback" : "restore" });
    });
  });

  /* Compare my replies: reveal which blind reply was yours. */
  $$("[data-compare]").forEach(function (c) {
    var live = $("[data-live]", c);
    on($("[data-compare-btn]", c), "click", function () {
      var show = attr(c, "data-state") !== "done";
      if (show) ty.play(c); else ty.setState(c, "start");
      ty.swap($(".cmp-btn-l", c), show ? "Hide labels" : "Save ratings and reveal");
      ty.announce(live, show ? "Reply A was yours. Reply B was your AI." : "Labels hidden.");
    });
  });
  /* /features: capability areas open and close (grid rows); #cap-* links open their area. */
  $$("[data-caps]").forEach(function (box) {
    var caps = $$(".cap", box), all = $("[data-caps-all]"), open = false;
    function set(c, v) { c.classList.toggle("is-open", v); $("button", c).setAttribute("aria-expanded", String(v)); }
    caps.forEach(function (c) { on($("button", c), "click", function () { set(c, !c.classList.contains("is-open")); }); });
    on(all, "click", function () {
      open = !open;
      caps.forEach(function (c) { set(c, open); });
      ty.swap($(".caps-all-l", all), open ? "Close all" : "Open all");
    });
    function fromHash() {
      var id = location.hash.slice(1), c = id && d.getElementById(id);
      if (c && caps.indexOf(c) > -1) set(c, true);
    }
    on(w, "hashchange", fromHash);
    fromHash();
  });

  /* /features/subscriber-app: EN ↔ AR preview of the member app (this vignette only). */
  $$("[data-rtl]").forEach(function (b) {
    on(b, "click", function () {
      var ar = attr(b, "data-rtl") === "ar", fig = b.closest("figure"), t = $("[data-rtl-target]", fig);
      if (ar && !d.getElementById("ty-ar-font")) {
        var l = d.createElement("link");
        l.id = "ty-ar-font"; l.rel = "stylesheet";
        l.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap";
        d.head.appendChild(l);
      }
      t.setAttribute("dir", ar ? "rtl" : "ltr");
      t.setAttribute("lang", ar ? "ar" : "en");
      $$("[data-en]", t).forEach(function (s) { s.textContent = attr(s, ar ? "data-ar" : "data-en"); });
      $$("[data-rtl]", fig).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      ty.track("rtl_preview", { lang: ar ? "ar" : "en" });
    });
  });

  /* /features/safety: tapping Report pain replays the pause. */
  $$("[data-pain]").forEach(function (b) {
    on(b, "click", function () {
      var fig = b.closest("[data-vignette]");
      ty.play(fig);
      ty.announce($("[data-live]", fig), "Workout paused. Your coach has been told.");
      ty.track("demo_play", { scenario: "pain-report" });
    });
  });
  /* /demo: scenario tabs. The message enters, typing dots (≤1.2 s), then the decision plays once. */
  $$("[data-demo]").forEach(function (box) {
    var live = $("[data-live]", box), timers = [];
    var cur = function () { var p = $(".dm-panel:not([hidden])", box); return p && $("[data-console]", p); };
    on(box, "ty:tab", function (e) {
      timers.forEach(clearTimeout); timers = [];
      $$("[data-console]", box).forEach(function (c) { c.classList.remove("is-msg", "is-thinking"); });
      var tab = e.detail.tab, c = cur();
      if (!c) return;
      ty.setState(c, "start"); c._played = true;
      c.classList.add("is-msg"); c.offsetWidth;
      ty.track("demo_play", { scenario: attr(tab, "data-scenario") });
      timers.push(setTimeout(function () { c.classList.remove("is-msg"); }, 60));
      timers.push(setTimeout(function () { c.classList.add("is-thinking"); }, 340));
      timers.push(setTimeout(function () { c.classList.remove("is-thinking"); ty.play(c); }, 1500));
      timers.push(setTimeout(function () { ty.announce(live, $(".dm-q", tab).textContent + ": " + $(".dm-out", tab).textContent + "."); }, 1800));
    });
    on(d, "ty:replay", function () { var c = cur(); if (c) ty.play(c); });
  });
  /* Threshold meter: the bar marker follows the slider; the fill turns amber below it. */
  $$(".th-window").forEach(function (box) {
    var viz = $(".th-viz", box), r = $('input[type="range"]', box), conf = +attr($("[data-threshold]", box), "data-confidence");
    function upd() { viz.style.setProperty("--t", r.value / 100); viz.classList.toggle("is-below", conf < +r.value); }
    on(r, "input", upd); upd();
  });

  /* Role lists animate on a tab switch only, never on first paint. */
  on(d, "ty:tab", function (e) { if (e.target.classList) e.target.classList.add("tabs-touched"); });
})();
