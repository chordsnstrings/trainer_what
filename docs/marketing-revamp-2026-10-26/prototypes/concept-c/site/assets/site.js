/* Concept C "The Method" runtime (deferred). No libraries.
   window.ty = { track, swap, announce, flags, onFlags, onReplay, replayHero,
                 observeReveal, inView, debounce, slugFromName }
   window.tyTrack(event, props) logs section B events to the console.
   DO NOT EDIT from page builds: group behaviour goes in <group>.js. */
(function () {
  "use strict";
  var d = document.documentElement;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var mqPhone = matchMedia("(max-width: 760px)");
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  var ty = (window.ty = window.ty || {});

  /* ---------- Tracking (section B events; console only) ---------- */
  ty.track = window.tyTrack = function (event, props) {
    var payload = Object.assign({ concept: "C", page: document.body.getAttribute("data-path") }, props || {});
    var consent = d.getAttribute("data-consent");
    try { console.log("%ctyTrack%c " + event + (consent === "granted" ? "" : " (held: consent " + consent + ")"), "background:#D5F24A;color:#171917;padding:1px 4px;border-radius:2px", "", payload); } catch (e) {}
  };
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-track]");
    if (!el) return;
    var props = {};
    try { props = JSON.parse(el.getAttribute("data-track-props") || "{}"); } catch (err) {}
    if (el.getAttribute("data-cta") === "primary" && d.getAttribute("data-registration") === "closed") props.label = "Join early access — free";
    ty.track(el.getAttribute("data-track"), props);
  });

  /* ---------- Helpers ---------- */
  ty.debounce = function (fn, ms) {
    var t;
    return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  };
  ty.inView = function (el) { var r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; };
  /** Crossfade a .vx slot to new text (or HTML with {html:true}). */
  ty.swap = function (slot, value, opts) {
    if (!slot) return;
    var cur = slot.lastElementChild;
    var asHtml = opts && opts.html;
    if (cur && (asHtml ? cur.innerHTML === value : cur.textContent === String(value))) return;
    var next = document.createElement("span");
    next.className = "vx-pre";
    if (asHtml) next.innerHTML = value; else next.textContent = value;
    slot.appendChild(next);
    $$("span.vx-out", slot).forEach(function (o) { if (o.parentNode === slot) slot.removeChild(o); });
    if (cur) { cur.classList.add("vx-out"); cur.setAttribute("aria-hidden", "true"); setTimeout(function () { if (cur.parentNode) cur.parentNode.removeChild(cur); }, 220); }
    void next.offsetWidth;
    next.classList.remove("vx-pre");
  };
  /** Polite announcement, debounced ~500 ms (one live region per widget). */
  var annTimers = new WeakMap();
  ty.announce = function (region, text) {
    if (!region) return;
    clearTimeout(annTimers.get(region));
    annTimers.set(region, setTimeout(function () { region.textContent = text; }, 500));
  };
  ty.slugFromName = function (name) {
    var s = String(name).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "").slice(0, 40).replace(/-+$/, "");
    return s.length >= 3 ? s : "";
  };

  /* ---------- Reveal once (section D): below the first viewport only ---------- */
  var io = null;
  function reveal(el) { el.classList.remove("reveal-pending"); el.classList.add("is-in"); }
  ty.observeReveal = function (root) {
    var units = $$("[data-reveal]", root || document).filter(function (el) {
      return !el.classList.contains("is-in") && !el.closest("[data-hero]");
    });
    units.forEach(function (el) {
      var stag = $$(":scope > [data-stagger] > *, :scope[data-stagger] > *", el);
      stag.forEach(function (c, i) { if (!c.style.getPropertyValue("--i")) c.style.setProperty("--i", Math.min(i, 5)); });
      if (el.getBoundingClientRect().top >= innerHeight) { el.classList.add("reveal-pending"); io.observe(el); }
    });
  };
  try {
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && (en.intersectionRatio >= 0.15 || en.intersectionRect.height >= innerHeight * 0.25)) {
            reveal(en.target); io.unobserve(en.target);
          }
        });
      }, { threshold: [0, 0.05, 0.1, 0.15] });
      ty.observeReveal();
      /* Web fonts swap after setup and can pull a pending unit up into the
         first viewport; reveal anything that now starts on screen. */
      var settle = function () { $$(".reveal-pending").forEach(function (el) { if (el.getBoundingClientRect().top < innerHeight) { reveal(el); io.unobserve(el); } }); };
      addEventListener("load", function () { settle(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle); });
    }
  } catch (err) {
    $$(".reveal-pending").forEach(reveal);
  }

  /* ---------- Header: scrolled hairline ---------- */
  var header = $("[data-header]");
  /* A 1 px sentinel 5 px down the page: no scrollY read per frame (reading it inside a rAF forced a
     style recalc of whatever the showcases had just written, every frame, QA 27 Oct). */
  if (header && "IntersectionObserver" in window) {
    var sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    sentinel.style.cssText = "position:absolute;top:5px;left:0;width:1px;height:1px;pointer-events:none;visibility:hidden";
    document.body.prepend(sentinel);
    new IntersectionObserver(function (en) { header.classList.toggle("is-scrolled", !en[en.length - 1].isIntersecting); }).observe(sentinel);
  } else if (header) {
    var ticking = false;
    var onScroll = function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () { ticking = false; header.classList.toggle("is-scrolled", scrollY > 4); });
    };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
  }

  /* Open/close with an exit animation: hidden attr + .is-open class. */
  function openEl(el) { el.hidden = false; void el.offsetWidth; el.classList.add("is-open"); }
  function closeEl(el, ms) {
    el.classList.remove("is-open");
    clearTimeout(el._t);
    el._t = setTimeout(function () { if (!el.classList.contains("is-open")) el.hidden = true; }, ms || 200);
  }

  /* ---------- Desktop dropdown ---------- */
  $$(".nav-menu-btn").forEach(function (btn) {
    var menu = document.getElementById(btn.getAttribute("aria-controls"));
    var item = btn.closest(".nav-item");
    function set(open) { btn.setAttribute("aria-expanded", String(open)); open ? openEl(menu) : closeEl(menu, 160); }
    btn.addEventListener("click", function () { set(btn.getAttribute("aria-expanded") !== "true"); });
    item.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") { set(false); btn.focus(); }
      if (e.key === "ArrowDown" && e.target === btn) { e.preventDefault(); set(true); var f = $("a", menu); if (f) f.focus(); }
    });
    item.addEventListener("focusout", function (e) { if (!item.contains(e.relatedTarget)) set(false); });
    document.addEventListener("click", function (e) { if (!item.contains(e.target) && btn.getAttribute("aria-expanded") === "true") set(false); });
  });

  /* ---------- Mobile menu sheet ---------- */
  var mBtn = $("[data-menu-btn]"), mMenu = $("[data-mobile-menu]");
  function setMenu(open) {
    if (!mBtn || !mMenu) return;
    mBtn.setAttribute("aria-expanded", String(open));
    $(".menu-btn-label", mBtn).textContent = open ? "Close" : "Menu";
    d.classList.toggle("menu-open", open);
    if (open) { openEl(mMenu); var f = $("a, button", mMenu); if (f) f.focus({ preventScroll: true }); }
    else closeEl(mMenu, 280);
    updateSticky();
  }
  if (mBtn && mMenu) {
    mBtn.addEventListener("click", function () { setMenu(mBtn.getAttribute("aria-expanded") !== "true"); });
    document.addEventListener("keydown", function (e) {
      if (mBtn.getAttribute("aria-expanded") !== "true") return;
      if (e.key === "Escape") { setMenu(false); mBtn.focus(); }
      if (e.key === "Tab") { // trap focus in header button + sheet
        var f = [mBtn].concat($$("a[href], button:not([disabled])", mMenu));
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    mMenu.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
    addEventListener("resize", ty.debounce(function () { if (innerWidth > 1239 && d.classList.contains("menu-open")) setMenu(false); }, 150));
  }

  /* ---------- Sticky mobile CTA ---------- */
  var sticky = $("[data-sticky]");
  var heroGone = false, overEnd = false, pinVis = [];
  function updateSticky() {
    if (!sticky) return;
    // phones: hidden while a pinned showcase stage fills the screen (it covered the stage's honesty strip)
    var overPin = pinVis.some(function (x) { return !x.hasAttribute("data-flat"); });
    var show = mqPhone.matches && heroGone && !overEnd && !overPin && d.getAttribute("data-consent") !== "unset" && !d.classList.contains("consent-open") && !d.classList.contains("menu-open");
    sticky.classList.toggle("is-shown", show);
    sticky.setAttribute("aria-hidden", String(!show));
    if (show) sticky.removeAttribute("inert"); else sticky.setAttribute("inert", "");
  }
  if ("IntersectionObserver" in window) {
    var hero = $("[data-hero]") || $("main > section");
    if (sticky && hero) new IntersectionObserver(function (en) {
      heroGone = !en[0].isIntersecting && en[0].boundingClientRect.top < 0; updateSticky();
    }).observe(hero);
    var vis = new Set();
    var endIo = new IntersectionObserver(function (en) {
      en.forEach(function (x) { if (x.isIntersecting) vis.add(x.target); else vis.delete(x.target); });
      overEnd = vis.size > 0; d.classList.toggle("at-end", overEnd); updateSticky();
    });
    $$("[data-closing], .site-footer").forEach(function (e) { endIo.observe(e); });
    var pinIo = new IntersectionObserver(function (en) {
      en.forEach(function (x) { pinVis = pinVis.filter(function (y) { return y !== x.target; }); if (x.isIntersecting) pinVis.push(x.target); });
      updateSticky();
    }, { rootMargin: "-64px 0px -45% 0px" });
    $$("[data-showcase=\"anatomy\"]").forEach(function (e) { pinIo.observe(e); });
    mqPhone.addEventListener("change", updateSticky);
    updateSticky();
  }

  /* ---------- Consent (prototype simulation) ---------- */
  var bar = $("[data-consent-bar]");
  function setConsentBar(open) {
    if (!bar) return;
    bar.hidden = !open; d.classList.toggle("consent-open", open);
    if (open) d.style.setProperty("--consent-h", bar.offsetHeight + "px");
    updateSticky();
  }
  if (bar && d.getAttribute("data-consent") === "unset") setConsentBar(true);
  document.addEventListener("click", function (e) {
    var c = e.target.closest("[data-consent]");
    if (c && c.tagName === "BUTTON") {
      var v = c.getAttribute("data-consent");
      d.setAttribute("data-consent", v); store.set("ty-c-consent", v); setConsentBar(false);
      ty.track("consent_choice", { value: v });
    }
    if (e.target.closest("[data-consent-open]")) { setConsentBar(true); var b = $("button", bar); if (b) b.focus(); }
  });

  /* ---------- Product-state flags (dev panel) ---------- */
  var FLAGS = { payments: ["off", "on"], publish: ["blocked", "open"], registration: ["closed", "open"], frontier: ["off", "on"], voice: ["off", "on"], "rtl-preview": ["off", "on"] };
  var LIVE = { payments: "off", publish: "blocked", registration: "open", frontier: "off", voice: "off", "rtl-preview": "off" };
  var flagFns = [];
  ty.flags = function () { var o = {}; for (var k in FLAGS) o[k] = d.getAttribute("data-" + k); return o; };
  ty.onFlags = function (fn) { flagFns.push(fn); };
  function applyFlags() {
    var f = ty.flags();
    $$("[data-flag]").forEach(function (sw) {
      var k = sw.getAttribute("data-flag"), on = f[k] === sw.getAttribute("data-on");
      sw.setAttribute("aria-checked", String(on));
      var st = $("[data-switch-state]", sw); if (st) st.textContent = f[k];
    });
    // Registration closed: every primary CTA opens the early-access form.
    $$('a[data-cta="primary"]').forEach(function (a) {
      var base = a.getAttribute("data-href") || a.getAttribute("href");
      a.setAttribute("data-href", base);
      a.setAttribute("href", f.registration === "closed" ? "signup.html#early-access" : base);
    });
    // RTL preview: subscriber-app vignettes only; [data-ar] holds real member-app strings.
    $$("[data-rtl-vignette]").forEach(function (v) {
      var rtl = f["rtl-preview"] === "on";
      v.setAttribute("dir", rtl ? "rtl" : "ltr"); v.setAttribute("lang", rtl ? "ar" : "en");
      $$("[data-ar]", v).forEach(function (t) {
        if (!t.hasAttribute("data-en")) t.setAttribute("data-en", t.textContent);
        t.textContent = rtl ? t.getAttribute("data-ar") : t.getAttribute("data-en");
      });
    });
    flagFns.forEach(function (fn) { try { fn(f); } catch (e) {} });
  }
  function saveFlags() { store.set("ty-c-flags", JSON.stringify(ty.flags())); }
  document.addEventListener("click", function (e) {
    var sw = e.target.closest("[data-flag]");
    if (sw) {
      var k = sw.getAttribute("data-flag"), cur = d.getAttribute("data-" + k);
      d.setAttribute("data-" + k, cur === sw.getAttribute("data-on") ? sw.getAttribute("data-off") : sw.getAttribute("data-on"));
      saveFlags(); applyFlags();
    }
    if (e.target.closest("[data-reset-flags]")) { for (var f in LIVE) d.setAttribute("data-" + f, LIVE[f]); saveFlags(); applyFlags(); }
  });
  applyFlags();

  /* ---------- Rule card confirm (C's success state; spring on the stamp) ---------- */
  ty.confirmRule = function (card) {
    if (!card || card.classList.contains("is-confirmed")) return;
    var btn = $("[data-rc-confirm]", card), tpl = $("template[data-rc-done]", card);
    if (btn) { btn.style.transform = "scale(.97)"; setTimeout(function () { btn.style.transform = ""; }, 80); }
    setTimeout(function () {
      card.classList.add("is-animating", "is-confirmed");
      if (tpl) ty.swap($('[data-vx="rule-status"]', card), tpl.innerHTML, { html: true });
      ty.swap($('[data-vx="rc-btn"]', card), "Confirmed");
      card.dispatchEvent(new CustomEvent("ty:confirmed"));
    }, 120);
  };
  ty.resetRule = function (card) {
    if (!card) return;
    card.classList.remove("is-animating", "is-confirmed");
    var slot = $('[data-vx="rule-status"]', card), tpl = $("template[data-rc-wait]", card);
    if (slot && tpl) slot.innerHTML = "<span>" + tpl.innerHTML + "</span>";
    var b = $('[data-vx="rc-btn"]', card); if (b) b.innerHTML = "<span>Confirm</span>";
  };

  /* ---------- Hero replay ---------- */
  var replayFns = [];
  ty.onReplay = function (fn) { replayFns.push(fn); };
  ty.replayHero = function () {
    var hero = $("[data-hero]");
    if (hero) hero.scrollIntoView({ block: "start" });
    $$("[data-hero] .mk-mark").forEach(function (m) { m.classList.add("hl-reset"); void m.offsetWidth; m.classList.remove("hl-reset"); });
    replayFns.forEach(function (fn) { try { fn(); } catch (e) {} });
  };
  document.addEventListener("click", function (e) { if (e.target.closest("[data-replay-hero]")) ty.replayHero(); });

  /* ---------- Dev panel ---------- */
  var devBtn = $("[data-dev-toggle]"), devPanel = $("#dev-panel");
  function setDev(open) { devBtn.setAttribute("aria-expanded", String(open)); open ? openEl(devPanel) : closeEl(devPanel, 160); }
  if (devBtn && devPanel) {
    devBtn.addEventListener("click", function () { setDev(devBtn.getAttribute("aria-expanded") !== "true"); });
    $("[data-dev-close]", devPanel).addEventListener("click", function () { setDev(false); devBtn.focus(); });
    devPanel.addEventListener("keydown", function (e) { if (e.key === "Escape") { setDev(false); devBtn.focus(); } });
  }

  /* ---------- Tabs (ARIA, roving tabindex) and stepper ---------- */
  function wireTabs(root, onSelect) {
    var list = $('[role="tablist"]', root);
    var tabs = $$('[role="tab"]', list);
    var ink = $(".tab-ink", list);
    function moveInk(t) { if (!ink) return; ink.style.setProperty("--x", t.offsetLeft + "px"); ink.style.setProperty("--sx", t.offsetWidth / 100); }
    function select(i, focus) {
      i = (i + tabs.length) % tabs.length;
      var prev = tabs.findIndex(function (t) { return t.getAttribute("aria-selected") === "true"; });
      tabs.forEach(function (t, j) {
        var on = j === i;
        t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
        t.classList.toggle("is-done", j < i);
        var p = document.getElementById(t.getAttribute("aria-controls"));
        if (on && p.hidden) { p.hidden = false; p.classList.remove("panel-enter"); void p.offsetWidth; p.classList.add("panel-enter"); }
        if (!on) p.hidden = true;
      });
      if (focus) tabs[i].focus();
      moveInk(tabs[i]);
      if (onSelect && prev !== i) onSelect(i, tabs[i]);
      return i;
    }
    tabs.forEach(function (t, i) { t.addEventListener("click", function () { select(i); }); });
    list.addEventListener("keydown", function (e) {
      var i = tabs.indexOf(document.activeElement); if (i < 0) return;
      var k = e.key, back = d.dir === "rtl" ? "ArrowRight" : "ArrowLeft", fwd = d.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
      if (k === fwd || k === "ArrowDown") { e.preventDefault(); select(i + 1, true); }
      else if (k === back || k === "ArrowUp") { e.preventDefault(); select(i - 1, true); }
      else if (k === "Home") { e.preventDefault(); select(0, true); }
      else if (k === "End") { e.preventDefault(); select(tabs.length - 1, true); }
    });
    var cur = tabs.findIndex(function (t) { return t.getAttribute("aria-selected") === "true"; });
    requestAnimationFrame(function () { moveInk(tabs[Math.max(cur, 0)]); });
    addEventListener("resize", ty.debounce(function () { var c = tabs.find(function (t) { return t.getAttribute("aria-selected") === "true"; }); if (c) moveInk(c); }, 120));
    return { select: select, tabs: tabs };
  }
  ty.wireTabs = wireTabs;
  $$("[data-tabs]").forEach(function (root) {
    wireTabs(root, function (i, t) { root.dispatchEvent(new CustomEvent("ty:tab", { detail: { index: i, key: t.getAttribute("data-tab-key") } })); });
  });
  $$("[data-stepper]").forEach(function (root) {
    var fill = $(".sl-fill", root), count = $('[data-vx="step"]', root), rail = $(".stepper-rail", root);
    var n = $$('[role="tab"]', root).length, at = 0;
    var api = wireTabs(root, function (i, t) {
      at = i;
      if (fill) fill.style.strokeDashoffset = String(100 - (100 * (i + 1)) / n);
      ty.swap(count, String(i + 1));
      if (rail && rail.scrollWidth > rail.clientWidth) rail.scrollTo({ left: Math.max(0, t.offsetLeft - 24), behavior: "smooth" });
      root.dispatchEvent(new CustomEvent("ty:step", { detail: { index: i } }));
    });
    $$("[data-step]", root).forEach(function (b) {
      b.addEventListener("click", function () { api.select(at + Number(b.getAttribute("data-step"))); });
    });
  });

  /* ---------- FAQ accordion ---------- */
  $$("[data-faq] .faq-q").forEach(function (q) {
    q.addEventListener("click", function () {
      var open = q.getAttribute("aria-expanded") !== "true";
      q.setAttribute("aria-expanded", String(open));
      q.closest(".faq-item").classList.toggle("is-open", open);
      if (open) ty.track("faq_open", { question: q.getAttribute("data-faq-id") });
    });
  });

  /* ---------- AddressPreview ---------- */
  $$("[data-address]").forEach(function (form) {
    var input = $("[data-address-input]", form), out = $("[data-address-slug]", form), live = $("[data-address-live]", form);
    var sent = false;
    input.addEventListener("focus", function () { form.classList.add("is-focused"); });
    input.addEventListener("blur", function () { form.classList.remove("is-focused"); });
    input.addEventListener("input", function () {
      var s = ty.slugFromName(input.value);
      out.textContent = s || "your-name";
      ty.announce(live, (s || "your-name") + ".trainsyou.com");
      if (!sent && input.value.trim().length >= 3) { sent = true; ty.track("address_typed", { length: input.value.trim().length, location: form.getAttribute("data-track-location") }); }
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var s = ty.slugFromName(input.value);
      if (!s) { input.focus(); ty.announce(live, "Type at least three letters of your coaching name."); return; }
      ty.track("cta_click", { label: "Claim this address", location: form.getAttribute("data-track-location") });
      location.href = (d.getAttribute("data-registration") === "closed" ? "signup.html?slug=" + encodeURIComponent(s) + "#early-access" : "signup.html?slug=" + encodeURIComponent(s));
    });
  });

  /* ---------- Send this to myself (Web Share, copy fallback) ---------- */
  $$("[data-share]").forEach(function (b) {
    var status = b.nextElementSibling && b.nextElementSibling.hasAttribute("data-share-status") ? b.nextElementSibling : null;
    b.addEventListener("click", function () {
      var url = location.href, title = document.title;
      if (navigator.share) {
        navigator.share({ title: title, url: url }).then(function () { ty.track("share_self", { method: "share" }); }).catch(function () {});
      } else {
        var done = function () { if (status) status.textContent = "Link copied"; var t = $("span", b); var old = t.textContent; t.textContent = "Link copied"; setTimeout(function () { t.textContent = old; }, 1800); ty.track("share_self", { method: "copy" }); };
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done); else done();
      }
    });
  });

  /* ---------- Kamran (prototype: no call is placed) ---------- */
  var pop = $("[data-kamran-pop]"), kStart = 0, kFrom = null;
  function closeK() { if (!pop || pop.hidden) return; pop.hidden = true; var s = (Date.now() - kStart) / 1000; ty.track("kamran_end", { duration: s < 30 ? "<30s" : s < 120 ? "30-120s" : ">120s" }); if (kFrom) kFrom.focus(); }
  document.addEventListener("click", function (e) {
    var k = e.target.closest("[data-kamran]");
    if (k && pop) { kFrom = k; pop.hidden = false; kStart = Date.now(); $("[data-kamran-close]", pop).focus(); ty.track("kamran_start", { location: k.getAttribute("data-track-location") }); return; }
    if (e.target.closest("[data-kamran-close]")) closeK();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeK(); });

  /* ---------- Prototype forms: never leave the page ---------- */
  $$("form[data-proto-form]").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var r = $("[data-form-result]", f) || $("[data-form-result]");
      if (r) { r.hidden = false; r.focus && r.focus(); }
      ty.track(f.getAttribute("data-proto-form") || "form_submit", {});
    });
  });

  /* ---------- Attribution pass-through to signup links (no storage without consent) ---------- */
  (function () {
    var keep = new URLSearchParams();
    new URLSearchParams(location.search).forEach(function (v, k) { if (/^(utm_[a-z]+|gclid|fbclid|ref)$/.test(k)) keep.set(k, v); });
    if (d.getAttribute("data-consent") === "granted") {
      var first = store.get("ty-c-first-touch");
      if (!first && keep.toString()) store.set("ty-c-first-touch", keep.toString());
      else if (first && !keep.toString()) keep = new URLSearchParams(first);
    }
    var q = keep.toString(); if (!q) return;
    $$('a[href^="signup.html"]').forEach(function (a) {
      var h = a.getAttribute("href"), parts = h.split("#");
      a.setAttribute("href", parts[0] + (parts[0].indexOf("?") > -1 ? "&" : "?") + q + (parts[1] ? "#" + parts[1] : ""));
      if (a.hasAttribute("data-href")) a.setAttribute("data-href", a.getAttribute("href"));
    });
  })();
})();
