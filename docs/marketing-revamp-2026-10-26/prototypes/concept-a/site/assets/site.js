/* trainsyou · Concept A "Live Brain" · runtime (no libraries).
 * Builders: do not edit; use window.ty (documented in src/BUILDERS.md).
 * Parts: helpers · tracking + consent · flags + dev panel · header + menu ·
 * reveal · "trains" mark · console player · view transitions · value swaps ·
 * accordion · tabs · steppers · rule builder · threshold · address · sticky stack · Kamran. */
(function () {
  "use strict";
  var d = document, root = d.documentElement, w = window;
  var $ = function (s, el) { return (el || d).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || d).querySelectorAll(s)); };
  var on = function (el, ev, fn, o) { if (el) el.addEventListener(ev, fn, o); };
  var store = {
    get: function (k) { try { return w.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v === null) w.localStorage.removeItem(k); else w.localStorage.setItem(k, v); } catch (e) { /* storage blocked: state lives in memory */ } },
  };
  var page = d.body.getAttribute("data-page") || location.pathname;
  var reflow = function (el) { return el && el.offsetWidth; };
  var inView = function (el, frac) {
    var r = el.getBoundingClientRect(), vh = w.innerHeight;
    if (!r.height) return false;
    var vis = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    return vis / Math.min(r.height, vh) >= (frac || 0.5);
  };

  /* ---------------------------------------------------- tracking + consent */
  var consent = store.get("tyA.consent") || "pending";
  w.tyTrack = function (event, props) {
    var p = Object.assign({ concept: "A", page: page, consent: consent }, props || {});
    (w.tyEvents = w.tyEvents || []).push([event, p]);
    if (w.console && console.log) console.log("%ctyTrack%c " + event, "background:#D5F24A;color:#171917;padding:1px 4px;border-radius:3px", "color:inherit", p);
  };
  var track = w.tyTrack;
  var labelOf = function (el) {
    var vis = $$("[data-show]", el).filter(function (s) { return s.offsetParent !== null; })[0];
    return ((vis || el).textContent || "").replace(/\s+/g, " ").trim();
  };
  on(d, "click", function (e) {
    var a = e.target.closest && e.target.closest("[data-cta],[data-track]");
    if (!a) return;
    if (a.hasAttribute("data-cta")) track("cta_click", { label: labelOf(a), location: a.getAttribute("data-loc") || "inline", kind: a.getAttribute("data-cta") });
    else track(a.getAttribute("data-track"), Object.assign({}, a.dataset));
  });

  /* ------------------------------------------------- flags + dev panel */
  var FLAG_OFF = { payments: "off", publish: "off", registration: "closed", frontier: "off", voice: "off", motion: "always" };
  var DEFAULTS = { payments: "off", publish: "off", registration: "open", frontier: "off", voice: "off", motion: "always" };
  var flags = {};
  Object.keys(DEFAULTS).forEach(function (k) { flags[k] = root.getAttribute("data-" + k) || DEFAULTS[k]; });
  function saveFlags() {
    var diff = {};
    Object.keys(flags).forEach(function (k) { if (flags[k] !== DEFAULTS[k]) diff[k] = flags[k]; });
    store.set("tyA.flags", Object.keys(diff).length ? JSON.stringify(diff) : null);
  }
  function syncFlags() {
    Object.keys(flags).forEach(function (k) { root.setAttribute("data-" + k, flags[k]); });
    $$(".dev-switch").forEach(function (s) { s.setAttribute("aria-checked", String(flags[s.getAttribute("data-flag")] === s.getAttribute("data-on"))); });
    var closed = flags.registration === "closed";
    $$('a[data-cta="primary"]').forEach(function (a) { a.setAttribute("href", closed ? "get-started.html#early-access" : "signup.html"); });
    $$("[data-address]").forEach(function (f) { if (f._sync) f._sync(); });
    d.dispatchEvent(new CustomEvent("ty:flags", { detail: Object.assign({}, flags) }));
  }
  function setFlag(k, v) { flags[k] = v; syncFlags(); saveFlags(); updateStack(); }
  var dev = $("#devpanel"), devBtn = $("[data-dev-open]");
  function floatEl(el, open) {
    if (!el) return;
    clearTimeout(el._t);
    if (open) { el.hidden = false; reflow(el); el.classList.add("is-open"); }
    else { el.classList.remove("is-open"); el._t = setTimeout(function () { el.hidden = true; }, 220); }
  }
  function devOpen(open) {
    floatEl(dev, open);
    if (devBtn) devBtn.setAttribute("aria-expanded", String(open));
    if (open) setTimeout(function () { var f = $(".dev-switch", dev); if (f) f.focus(); }, 30);
    else if (devBtn && dev.contains(d.activeElement)) devBtn.focus();
  }
  on(devBtn, "click", function () { devOpen(dev.hidden); });
  on($("[data-dev-close]"), "click", function () { devOpen(false); });
  on(dev, "keydown", function (e) { if (e.key === "Escape") devOpen(false); });
  $$(".dev-switch").forEach(function (s) {
    on(s, "click", function () {
      var k = s.getAttribute("data-flag"), onV = s.getAttribute("data-on");
      setFlag(k, flags[k] === onV ? FLAG_OFF[k] : onV);
    });
  });
  on($("[data-dev-reset]"), "click", function () { flags = Object.assign({}, DEFAULTS); syncFlags(); saveFlags(); store.set("tyA.consent", null); });
  on($("[data-replay-hero]"), "click", function () { w.tyReplayHero(); });

  /* ------------------------------------------------------ header + menu */
  var header = $("[data-header]"), ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; if (header) header.classList.toggle("is-scrolled", w.scrollY > 4); });
  }
  on(w, "scroll", onScroll, { passive: true });
  onScroll();
  var dropBtn = $(".nav-drop-btn"), drop = $("#nav-drop");
  function dropOpen(open, focusFirst) {
    if (!dropBtn) return;
    dropBtn.setAttribute("aria-expanded", String(open));
    floatEl(drop, open);
    if (open && focusFirst) setTimeout(function () { var a = $("a", drop); if (a) a.focus(); }, 20);
  }
  on(dropBtn, "click", function () { dropOpen(dropBtn.getAttribute("aria-expanded") !== "true"); });
  on(dropBtn, "keydown", function (e) { if (e.key === "ArrowDown") { e.preventDefault(); dropOpen(true, true); } });
  on(drop, "keydown", function (e) {
    var links = $$("a", drop), i = links.indexOf(d.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); links[(i + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length].focus(); }
  });
  on(d, "click", function (e) { if (dropBtn && !e.target.closest(".nav-drop-wrap")) dropOpen(false); });
  on(d, "keydown", function (e) {
    if (e.key !== "Escape") return;
    if (dropBtn && dropBtn.getAttribute("aria-expanded") === "true") { dropOpen(false); dropBtn.focus(); }
    if (menuIsOpen) menu(false);
    if (kpop && !kpop.hidden) kamran(false);
  });
  on($(".nav-drop-wrap"), "focusout", function (e) { if (!e.relatedTarget || !e.relatedTarget.closest(".nav-drop-wrap")) dropOpen(false); });

  var menuBtn = $(".menu-btn"), sheet = $("#menu-sheet"), menuIsOpen = false;
  function menu(open) {
    if (!menuBtn || open === menuIsOpen) return;
    menuIsOpen = open;
    menuBtn.setAttribute("aria-expanded", String(open));
    root.classList.toggle("menu-open", open);
    floatEl(sheet, open);
    if (open) setTimeout(function () { var a = $("a", sheet); if (a) a.focus(); }, 40);
    else menuBtn.focus();
    updateSticky();
  }
  on(menuBtn, "click", function () { menu(!menuIsOpen); });
  on(sheet, "keydown", function (e) {
    if (e.key !== "Tab") return;
    var f = $$("a,button", sheet), last = f[f.length - 1];
    if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); menuBtn.focus(); }
  });
  on(menuBtn, "keydown", function (e) {
    if (menuIsOpen && e.key === "Tab" && e.shiftKey) { var f = $$("a,button", sheet); e.preventDefault(); f[f.length - 1].focus(); }
    else if (menuIsOpen && e.key === "Tab") { e.preventDefault(); $("a", sheet).focus(); }
  });
  on(w, "resize", function () { if (menuIsOpen && w.innerWidth >= 1240) menu(false); });

  /* ----------------------------------------------- reveal (below the fold) */
  try {
    if ("IntersectionObserver" in w) {
      var rio = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.remove("reveal-pending");
          e.target.classList.add("is-in");
          rio.unobserve(e.target);
        });
      }, { threshold: 0.15 });
      var vh = w.innerHeight;
      $$("[data-reveal]").forEach(function (u) {
        if (u.getBoundingClientRect().top < vh) return; // first screen is never hidden
        if (u.getAttribute("data-reveal") === "stagger") $$(".ri", u).forEach(function (it, i) { it.style.setProperty("--i", Math.min(i, 5)); });
        u.classList.add("reveal-pending");
        rio.observe(u);
      });
    }
  } catch (err) {
    $$(".reveal-pending").forEach(function (u) { u.classList.remove("reveal-pending"); });
  }

  /* --------------------------------------------------- value helpers */
  /** Crossfade a .vx slot to `text` (old and new stacked; nothing reflows). */
  function swap(el, text) {
    if (!el) return;
    text = String(text);
    var cur = $(".vx-cur", el);
    if (cur && cur.textContent === text) return;
    $$(".vx-out", el).forEach(function (n) { n.remove(); });
    var next = d.createElement("span");
    next.className = "vx-cur vx-in";
    next.textContent = text;
    if (cur) {
      cur.className = "vx-out";
      cur.setAttribute("aria-hidden", "true");
      var gone = function () { if (cur.parentNode) cur.remove(); };
      cur.addEventListener("animationend", gone, { once: true });
      setTimeout(gone, 400);
    }
    el.appendChild(next);
  }
  /** Re-run the Pace-wash + tick on a .flash (or .rb-out) element. */
  function flash(el) { if (!el) return; el.classList.remove("is-flash"); reflow(el); el.classList.add("is-flash"); }
  /** Debounced polite announcement (~500 ms) into an aria-live element. */
  function announce(el, text) { if (!el) return; clearTimeout(el._a); el._a = setTimeout(function () { el.textContent = text; }, 500); }
  /** Keep a range input's filled track in step with its value. */
  function rangeFill(r) { var p = ((r.value - r.min) / (r.max - r.min)) * 100; r.style.setProperty("--fill", p + "%"); }
  $$('input[type="range"]').forEach(function (r) { rangeFill(r); on(r, "input", function () { rangeFill(r); }); });
  var fmt = function (v) { return String(+(+v).toFixed(2)); };

  /* ------------------------------------------- "trains" mark + console */
  function markOn() { $$(".mk-mark").forEach(function (m) { m.classList.remove("is-on"); reflow(m); m.classList.add("is-on"); }); }
  requestAnimationFrame(function () { requestAnimationFrame(markOn); });
  function setState(c, state) {
    c.setAttribute("data-state", state);
    var done = state === "done";
    $$(".vs-a", c).forEach(function (s) { s.setAttribute("aria-hidden", String(done)); });
    $$(".vs-b", c).forEach(function (s) { s.setAttribute("aria-hidden", String(!done)); });
  }
  /** Play a [data-console] (or any [data-state] vignette) once: start -> done. */
  function play(c) {
    if (!c) return;
    setState(c, "start");
    reflow(c);
    requestAnimationFrame(function () { setState(c, "done"); });
    c._played = true;
  }
  $$("[data-replay]").forEach(function (b) {
    on(b, "click", function () { var c = d.getElementById(b.getAttribute("data-replay")); play(c); track("demo_play", { scenario: "hero-replay" }); });
  });
  // Autoplay waits until the part that changes (the lane pill on show) is fully on screen,
  // clear of the header and the bottom stack (consent bar or sticky CTA), so the one
  // change is seen rather than played behind the consent bar.
  var autos = $$("[data-console][data-autoplay]"), waiting = [], ckTick = false;
  function focusOf(c) {
    return $$(".console-lane-m .lane-pill, .cp-lane .lane-pill", c).filter(function (p) { return p.offsetParent !== null; })[0] || c;
  }
  function seenNow(c) {
    var f = focusOf(c);
    if (f === c) return inView(c, 0.35);
    var r = f.getBoundingClientRect(), top = header ? header.getBoundingClientRect().bottom : 0;
    var stack = parseFloat(root.style.getPropertyValue("--stack")) || 0;
    return r.height > 0 && r.top >= top && r.bottom <= w.innerHeight - stack;
  }
  function check() {
    ckTick = false;
    waiting = waiting.filter(function (c) { if (c._played) return false; if (seenNow(c)) { play(c); return false; } return true; });
    if (!waiting.length) { w.removeEventListener("scroll", onCheck); w.removeEventListener("resize", onCheck); d.removeEventListener("ty:stack", onCheck); }
  }
  function onCheck() { if (!ckTick) { ckTick = true; requestAnimationFrame(check); } }
  function arm() {
    waiting = autos.slice();
    on(w, "scroll", onCheck, { passive: true });
    on(w, "resize", onCheck);
    on(d, "ty:stack", onCheck);
    check();
  }
  if (d.readyState === "complete") setTimeout(arm, 300);
  else on(w, "load", function () { setTimeout(arm, 300); });
  w.tyReplayHero = function () {
    markOn();
    var c = $("[data-console]");
    if (c) play(c);
    d.dispatchEvent(new CustomEvent("ty:replay"));
  };

  /* ---------------------------------------------- view transitions */
  // Shared-element morph home -> /demo only, and only when the console is in the first viewport.
  var isFile = function (u, re) { try { return re.test(new URL(u, location.href).pathname); } catch (e) { return false; } };
  on(w, "pageswap", function (e) {
    if (!e.viewTransition) return;
    var c = $(".brain-console"), to = e.activation && e.activation.entry && e.activation.entry.url;
    if (c && page === "/" && to && isFile(to, /\/demo\.html$/) && inView(c, 0.6)) c.style.viewTransitionName = "brain-console";
    else if (c) c.style.viewTransitionName = "";
  });
  on(w, "pagereveal", function (e) {
    if (!e.viewTransition) return;
    var c = $(".brain-console"), from = w.navigation && navigation.activation && navigation.activation.from && navigation.activation.from.url;
    if (c && page === "/demo" && from && isFile(from, /\/index\.html$/) && inView(c, 0.6)) {
      c.style.viewTransitionName = "brain-console";
      e.viewTransition.finished.then(function () { c.style.viewTransitionName = ""; });
    }
  });

  /* ------------------------------------------------------- accordion */
  $$("[data-accordion] .faq-q button").forEach(function (b) {
    on(b, "click", function () {
      var item = b.closest(".faq-item"), open = !item.classList.contains("is-open");
      item.classList.toggle("is-open", open);
      b.setAttribute("aria-expanded", String(open));
      if (open) track("faq_open", { question: b.getAttribute("data-faq") });
    });
  });

  /* ----------------------------------------------------------- tabs */
  /** ARIA tabs with roving tabindex, arrows, Home/End; [data-walk-step] buttons step through. */
  function initTabs(box) {
    var list = $('[role="tablist"]', box), tabs = $$('[role="tab"]', list), n = tabs.length, cur = 0;
    var rtl = function () { return getComputedStyle(box).direction === "rtl"; };
    function select(i, focus) {
      cur = Math.max(0, Math.min(n - 1, i));
      tabs.forEach(function (t, k) {
        var sel = k === cur;
        t.setAttribute("aria-selected", String(sel));
        t.tabIndex = sel ? 0 : -1;
        var p = d.getElementById(t.getAttribute("aria-controls"));
        if (p) p.hidden = !sel;
      });
      list.style.setProperty("--k", cur);
      $$("[data-walk-step]", box).forEach(function (b) {
        var dir = +b.getAttribute("data-walk-step"), end = dir < 0 ? cur === 0 : cur === n - 1;
        b.setAttribute("aria-disabled", String(end));
      });
      if (focus) tabs[cur].focus();
      box.dispatchEvent(new CustomEvent("ty:tab", { bubbles: true, detail: { index: cur, tab: tabs[cur] } }));
    }
    tabs.forEach(function (t, i) {
      on(t, "click", function () { select(i); });
      on(t, "keydown", function (e) {
        var next = { ArrowRight: rtl() ? -1 : 1, ArrowLeft: rtl() ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[e.key], j = null;
        if (next) j = (i + next + n) % n;
        if (e.key === "Home") j = 0;
        if (e.key === "End") j = n - 1;
        if (j !== null) { e.preventDefault(); select(j, true); }
      });
    });
    $$("[data-walk-step]", box).forEach(function (b) {
      on(b, "click", function () { if (b.getAttribute("aria-disabled") !== "true") select(cur + +b.getAttribute("data-walk-step")); });
    });
    var start = tabs.findIndex(function (t) { return t.getAttribute("aria-selected") === "true"; });
    select(start < 0 ? 0 : start);
    box.tySelect = select;
  }
  $$("[data-tabs]").forEach(initTabs);

  /* ------------------------------------------------------- steppers */
  function initStepper(s) {
    var min = +s.getAttribute("data-min"), max = +s.getAttribute("data-max"), step = +s.getAttribute("data-step") || 1;
    var v = +s.getAttribute("data-value"), val = $(".stepper-val", s), btns = $$("[data-delta]", s);
    var unit = (val.getAttribute("aria-valuetext") || "").replace(/^[\d.]+\s*/, "");
    function paint() {
      btns[0].setAttribute("aria-disabled", String(v <= min));
      btns[1].setAttribute("aria-disabled", String(v >= max));
    }
    function set(nv) {
      nv = +Math.min(max, Math.max(min, Math.round(nv / step) * step)).toFixed(2);
      if (nv === v) return;
      v = nv;
      s.setAttribute("data-value", v);
      swap($(".vx", val), fmt(v));
      val.setAttribute("aria-valuenow", v);
      val.setAttribute("aria-valuetext", fmt(v) + (unit ? " " + unit : ""));
      paint();
      s.dispatchEvent(new CustomEvent("ty:change", { bubbles: true, detail: { name: s.getAttribute("data-stepper"), value: v } }));
    }
    btns.forEach(function (b) { on(b, "click", function () { set(v + +b.getAttribute("data-delta") * step); }); });
    on(val, "keydown", function (e) {
      var k = e.key, nv = { ArrowUp: v + step, ArrowRight: v + step, ArrowDown: v - step, ArrowLeft: v - step, Home: min, End: max, PageUp: v + step * 2, PageDown: v - step * 2 }[k];
      if (nv !== undefined) { e.preventDefault(); set(nv); }
    });
    paint();
  }
  $$("[data-stepper]").forEach(initStepper);

  /* --------------------------------------------------- rule builder */
  $$("[data-rule-builder]").forEach(function (rb) {
    var logS = +rb.getAttribute("data-log-sessions"), logR = +rb.getAttribute("data-log-rir"), base = +rb.getAttribute("data-base"), lift = rb.getAttribute("data-lift");
    var out = $(".rb-out", rb), lane = $("[data-rb-lane]", rb), to = $(".rb-to", rb), live = $("[data-live]", rb);
    var get = function (n) { var s = $('[data-stepper="' + n + '"]', rb); return s ? +s.getAttribute("data-value") : null; };
    on(rb, "ty:change", function (e) {
      var s = get("sessions"), r = get("rir"), kg = get("kg"), tone = "applied", label = "Applied automatically", val = fmt(base + kg) + " kg";
      if (s > logS) { tone = "wait"; label = s - logS === 1 ? "Not yet: one more easy session" : "Not yet: " + (s - logS) + " more easy sessions"; val = base + " kg"; }
      else if (r !== null && r > logR) { tone = "wait"; label = "Not yet: reps in reserve too low"; val = base + " kg"; }
      lane.setAttribute("data-tone", tone);
      out.setAttribute("data-tone", tone);
      swap($(".vx", lane), label);
      swap(to, val);
      flash(out);
      announce(live, tone === "applied" ? "Applied automatically: " + lift + " moves from " + base + " to " + val + "." : label + ". " + lift + " stays at " + base + " kg.");
      track("demo_rule_edit", { field: e.detail.name, value: e.detail.value });
    });
  });

  /* ------------------------------------------------------ threshold */
  $$("[data-threshold]").forEach(function (t) {
    var conf = +t.getAttribute("data-confidence"), input = $('input[type="range"]', t), lane = $("[data-th-lane]", t), live = $("[data-live]", t);
    function upd(user) {
      var v = +input.value, ok = conf >= v, tone = ok ? "applied" : "toyou", text = ok ? "Applied automatically" : "Unsure → to you";
      input.setAttribute("aria-valuetext", v + "%: " + (ok ? "sure enough, applied automatically" : "unsure, goes to you"));
      swap($(".th-val .vx", t), v + "%");
      if (lane.getAttribute("data-tone") !== tone) { lane.setAttribute("data-tone", tone); swap($(".vx", lane), text); }
      if (user) { announce(live, "Threshold " + v + "%. Sample decision at " + conf + "%: " + text.replace("→", "goes") + "."); track("demo_threshold", { value: v }); }
    }
    on(input, "input", function () { upd(true); });
    upd(false);
  });

  /* ------------------------------------------------- address preview */
  function slugFromName(name) {
    var s = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "").slice(0, 40).replace(/-+$/, "");
    return s.length >= 3 ? s : "";
  }
  $$("[data-address]").forEach(function (f) {
    var input = $("input", f), out = $("[data-address-out]", f), claim = $("[data-address-claim]", f), sent = false;
    f._sync = function () {
      var slug = slugFromName(input.value), closed = flags.registration === "closed";
      out.textContent = slug || "your-name";
      claim.setAttribute("href", closed ? "get-started.html" + (slug ? "?slug=" + encodeURIComponent(slug) : "") + "#early-access" : slug ? "signup.html?slug=" + encodeURIComponent(slug) : "signup.html");
      if (!sent && input.value.trim().length >= 3) { sent = true; track("address_typed", { length: input.value.trim().length }); }
    };
    on(input, "input", f._sync);
    on(f, "submit", function (e) { e.preventDefault(); location.href = claim.getAttribute("href"); });
    f._sync();
  });

  /* --------------------------------- consent, sticky CTA, bottom stack */
  var bar = $("[data-consent]"), sticky = $("[data-sticky]");
  var seen = { hero: true, closing: false, footer: false };
  function updateStack() {
    var h = 0;
    if (bar && !bar.hidden) h = bar.offsetHeight;
    else if (sticky && sticky.classList.contains("is-shown") && getComputedStyle(sticky).display !== "none") h = sticky.offsetHeight;
    if (root.style.getPropertyValue("--stack") !== h + "px") { root.style.setProperty("--stack", h + "px"); d.dispatchEvent(new CustomEvent("ty:stack")); }
  }
  function updateSticky() {
    if (!sticky) return;
    var show = consent !== "pending" && !seen.hero && !seen.closing && !seen.footer && !menuIsOpen;
    sticky.classList.toggle("is-shown", show);
    root.classList.toggle("at-footer", !!seen.footer); // the floating Kamran pill steps aside over the footer links
    sticky.inert = !show;
    updateStack();
  }
  function showConsent(open) { if (!bar) return; bar.hidden = !open; updateSticky(); }
  $$("[data-consent-choice]").forEach(function (b) {
    on(b, "click", function () {
      consent = b.getAttribute("data-consent-choice");
      store.set("tyA.consent", consent);
      showConsent(false);
      track("consent_choice", { choice: consent });
    });
  });
  $$("[data-consent-open]").forEach(function (b) { on(b, "click", function () { showConsent(true); devOpen(false); }); });
  showConsent(consent === "pending");
  if ("IntersectionObserver" in w) {
    var targets = { hero: $("[data-hero]") || $("main > section"), closing: $("[data-closing]"), footer: $("[data-footer]") };
    var sio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { seen[e.target._k] = e.isIntersecting; });
      updateSticky();
    });
    Object.keys(targets).forEach(function (k) { if (targets[k]) { targets[k]._k = k; sio.observe(targets[k]); } });
  }
  on(w, "resize", updateStack);

  /* ---------------------------------------------------------- Kamran */
  var kpop = $("#kamran-pop"), kStart = 0, kFrom = null;
  function kamran(open, from) {
    if (!kpop) return;
    floatEl(kpop, open);
    if (open) {
      kStart = Date.now();
      kFrom = from;
      track("kamran_start", {});
      setTimeout(function () { var b = $("[data-kamran-close]", kpop); if (b) b.focus(); }, 30);
    } else if (kStart) {
      var s = (Date.now() - kStart) / 1000;
      track("kamran_end", { duration: s < 10 ? "<10s" : s < 60 ? "10-60s" : ">60s" });
      kStart = 0;
      if (kFrom) kFrom.focus();
    }
  }
  $$("[data-kamran]").forEach(function (b) { on(b, "click", function () { kamran(kpop.hidden, b); }); });
  on($("[data-kamran-close]"), "click", function () { kamran(false); });

  /* ------------------------------------------------------ public API */
  w.ty = { $: $, $$: $$, on: on, swap: swap, flash: flash, announce: announce, play: play, setState: setState, initTabs: initTabs, initStepper: initStepper, rangeFill: rangeFill, fmt: fmt, track: track, store: store, flags: function () { return Object.assign({}, flags); }, setFlag: setFlag, slugFromName: slugFromName, inView: inView };
  syncFlags();
})();
