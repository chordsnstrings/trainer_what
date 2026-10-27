/* Concept B · audience group scripts (/for-trainers, specialties, /uae,
   /get-started, /signup, /login). Owned by the audience page builder.
   Uses window.TY and window.TYCalc. No libraries. */
(function () {
  "use strict";
  var TY = window.TY; if (!TY) return;
  var d = document, root = d.documentElement, $ = TY.$, $$ = TY.$$;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  /* ---------------- Decision 8: price carried into sign-up --------------
     Off by default (live). A switch in the dev panel turns it on so the
     carried price chip and the specialty price line can be reviewed. */
  var d8 = store.get("tyB-d8") === "on" ? "on" : "off";
  root.setAttribute("data-d8", d8);
  var dev = d.getElementById("dev");
  if (dev) {
    var secs = dev.querySelectorAll(".dev-sec"), host = secs[1] || secs[0];
    var row = d.createElement("div"); row.className = "sw";
    row.innerHTML = '<span id="sw-d8">Price carried into sign-up<small>Decision 8 (price_aed). Live: off</small></span><button type="button" role="switch" aria-labelledby="sw-d8" data-au-sw="d8"></button>';
    if (host) host.appendChild(row);
    var swb = row.querySelector("button");
    var setD8 = function (v) { d8 = v; root.setAttribute("data-d8", v); swb.setAttribute("aria-checked", String(v === "on")); store.set("tyB-d8", v); decorate(); signupPrice(); };
    swb.setAttribute("aria-checked", String(d8 === "on"));
    swb.addEventListener("click", function () { setD8(d8 === "on" ? "off" : "on"); });
    var reset = dev.querySelector('[data-dev="reset"]');
    if (reset) reset.addEventListener("click", function () { setD8("off"); });
  }

  /* ---------------- Attribution carried into every sign-up link ---------
     Section B: with consent, first-touch parameters are stored and reused;
     without consent nothing is stored and only this URL's pass through. */
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "ref"];
  function attribution() {
    var q = new URLSearchParams(location.search), cur = {};
    KEYS.forEach(function (k) { var v = q.get(k); if (v) cur[k] = v.slice(0, 120); });
    var consent = null;
    try { consent = (JSON.parse(store.get("tyB") || "{}") || {}).consent; } catch (e) {}
    if (consent !== "granted") return cur;
    var first = null;
    try { first = JSON.parse(store.get("tyB-first") || "null"); } catch (e) {}
    if (!first && Object.keys(cur).length) { first = cur; store.set("tyB-first", JSON.stringify(cur)); }
    return first || cur;
  }
  var attr = attribution();
  function currentPrice() {
    var el = $('[data-pricer] input[data-sync="price"]') || $('input[data-sync="price"]');
    var v = el ? Math.round(+el.value) : NaN;
    return Number.isFinite(v) && v >= 199 ? v : null;
  }
  function withParams(url, extra) {
    var hashAt = url.indexOf("#"), hash = hashAt > -1 ? url.slice(hashAt) : "", base = hashAt > -1 ? url.slice(0, hashAt) : url;
    var qAt = base.indexOf("?"), path = qAt > -1 ? base.slice(0, qAt) : base, p = new URLSearchParams(qAt > -1 ? base.slice(qAt + 1) : "");
    Object.keys(extra).forEach(function (k) { if (extra[k] !== null && extra[k] !== undefined) p.set(k, extra[k]); });
    var s = p.toString();
    return path + (s ? "?" + s : "") + hash;
  }
  function decorate() {
    var extra = Object.assign({}, attr), price = d8 === "on" ? currentPrice() : null;
    if (price) extra.price_aed = String(price);
    $$('a[href^="signup.html"], a[data-href^="signup.html"]').forEach(function (a) {
      if (!a.hasAttribute("data-au-base")) a.setAttribute("data-au-base", a.getAttribute("data-href") || a.getAttribute("href"));
      var next = withParams(a.getAttribute("data-au-base"), extra);
      if (a.classList.contains("js-primary")) {
        a.setAttribute("data-href", next);
        if (TY.state.registration === "open") a.setAttribute("href", next);
      } else a.setAttribute("href", next);
    });
  }
  decorate();
  d.addEventListener("ty:state", function (e) { if (e.detail && e.detail.key === "registration") decorate(); });
  d.addEventListener("ty:price", decorate);
  // AddressPreview rewrites its claim link on input (site.js runs first).
  d.addEventListener("input", function (e) {
    var t = e.target;
    if (t.closest && t.closest("[data-address]")) {
      var a = t.closest("[data-address]").querySelector("a[data-claim]");
      if (a) { a.setAttribute("data-au-base", a.getAttribute("href")); decorate(); }
    }
    if (t.matches && t.matches('[data-sync="price"]')) decorate();
  });

  /* ---------------- Specialty hero: the rule card applies the rule ------ */
  var ruleHl = $("[data-hero] .au-hl");
  if (ruleHl) {
    TY.onHero(function (hero, replay) {
      var t0 = replay ? 160 : 0;
      if (replay) { ruleHl.classList.remove("is-swept"); void ruleHl.offsetWidth; }
      setTimeout(function () { ruleHl.classList.add("is-swept"); }, t0);
      setTimeout(function () { TY.flash($("[data-flash-outcome]", hero)); }, t0 + 460);
    });
  }
  /* UAE hero: your price, flashed once in the "what followers pay" chart. */
  var payFlash = $("[data-hero] [data-flash-pay]");
  if (payFlash) TY.onHero(function (hero, replay) { setTimeout(function () { TY.flash(payFlash); }, replay ? 160 : 0); });
  /* Get started hero: the price step lights up in the minutes bar. */
  var keySeg = $("[data-hero] .au-mins-seg.is-key");
  if (keySeg) TY.onHero(function (hero, replay) { setTimeout(function () { TY.flash(keySeg); }, replay ? 160 : 120); });

  /* ---------------- Specialty price ladder: marker follows the price ---- */
  var ladder = $("[data-ladder]");
  if (ladder) {
    var lmax = +ladder.getAttribute("data-max") || 1000, axis = $(".au-ladder-axis", ladder), read = $("[data-ladder-read]", ladder);
    var lastP = null;
    var syncLadder = function () {
      var p = currentPrice(); if (!p || p === lastP) return; lastP = p;
      axis.style.setProperty("--p", Math.min(100, (p / lmax) * 100).toFixed(2));
      read.textContent = p <= 350 ? "Your price sits inside what one session costs." : "Your price is above one session, and coaches every day.";
      TY.flash($("[data-flash-ladder]", ladder));
    };
    lastP = currentPrice();
    d.addEventListener("ty:price", syncLadder);
    d.addEventListener("input", function (e) { if (e.target.matches && e.target.matches('[data-sync="price"]')) syncLadder(); });
  }

  /* ---------------- UAE: subscriber-app language preview (RTL) --------- */
  var seg = $(".au-langseg");
  if (seg) {
    var screen = $(".au-ar-vis .phone-screen");
    var applyLang = function (on, animate) {
      $$(".au-app [data-ar]").forEach(function (el) { el.textContent = el.getAttribute(on ? "data-ar" : "data-en"); });
      if (screen) screen.setAttribute("lang", on ? "ar" : "en");
      $$("button", seg).forEach(function (b) { b.setAttribute("aria-pressed", String((b.getAttribute("data-lang") === "ar") === on)); });
      if (animate && screen && screen.animate) screen.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(.2,0,0,1)" });
    };
    seg.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-lang]"); if (!b) return;
      var on = b.getAttribute("data-lang") === "ar";
      if ((TY.state.rtl === "on") === on) return;
      TY.set("rtl", on ? "on" : "off");
    });
    d.addEventListener("ty:state", function (e) { if (e.detail && e.detail.key === "rtl") applyLang(e.detail.value === "on", true); });
    applyLang(TY.state.rtl === "on", false);
  }

  /* ---------------- Prototype notes (login alternatives) ---------------- */
  d.addEventListener("click", function (e) { var b = e.target.closest("[data-proto-note]"); if (b) TY.toast(b.getAttribute("data-proto-note")); });

  /* ---------------- Form helpers --------------------------------------- */
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function fieldError(input, msg) {
    var out = input.id ? d.getElementById(input.id + "-e") : null;
    if (msg) { input.setAttribute("aria-invalid", "true"); if (out) { out.textContent = msg; out.hidden = false; } }
    else { input.removeAttribute("aria-invalid"); if (out) { out.textContent = ""; out.hidden = true; } }
  }

  /* ---------------- Sign-up (protected path; prototype submit) --------- */
  var form = $("[data-signup]");
  var q = new URLSearchParams(location.search);
  var slug = q.get("slug") || ""; if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) slug = "";
  var rawPrice = q.get("price_aed") || q.get("price") || "";
  var carriedPrice = /^\d{3,4}$/.test(rawPrice) ? Math.min(9999, Math.max(199, +rawPrice)) : null;
  function entryPage() {
    try { var r = new URL(d.referrer); if (r.origin === location.origin) { var f = r.pathname.slice(r.pathname.lastIndexOf("/") + 1); return f.replace(/\.html$/, "") || "index"; } return "external"; } catch (e) { return "direct"; }
  }
  function signupPrice() {
    var chipEl = $("[data-price-chip]"), carried = $("[data-carried]");
    if (!chipEl || !carried) return;
    var show = d8 === "on" && !!carriedPrice;
    chipEl.hidden = !show;
    if (show) $("[data-price-out]", chipEl).textContent = "AED " + carriedPrice.toLocaleString("en");
    carried.hidden = !slug && !show;
    if (form) form.elements.price_aed.value = show ? String(carriedPrice) : "";
  }
  if (form) {
    var entry = entryPage(), started = false;
    var base = function () { var p = { has_slug: !!slug, entry_page: entry }; if (d8 === "on") p.has_price = !!carriedPrice; return p; };
    if (slug) { $("[data-slug-out]").textContent = slug; $("[data-slug-chip]").hidden = false; form.elements.slug.value = slug; }
    signupPrice();
    var src = {}; KEYS.forEach(function (k) { var v = q.get(k); if (v) src[k] = v.slice(0, 120); });
    form.elements.source.value = Object.keys(src).length ? JSON.stringify(src) : "";
    TY.track("signup_view", Object.assign(base(), { source: src.utm_source || src.ref || undefined }));
    var startOnce = function (e) {
      if (started || !e.target.name || e.target.type === "hidden") return;
      started = true; TY.track("signup_field_start", Object.assign(base(), { field: e.target.name }));
    };
    form.addEventListener("focusin", startOnce);
    form.addEventListener("input", startOnce);

    var pass = form.elements.password, help = $("[data-pw-help]"), helpText = $("[data-pw-text]");
    var pwHint = function () {
      var n = pass.value.length, ok = n >= 12;
      help.classList.toggle("is-ok", ok);
      helpText.textContent = ok ? "12 characters or more. Good." : n ? "At least 12 characters. " + (12 - n) + " to go." : "At least 12 characters.";
      if (ok && pass.getAttribute("aria-invalid")) fieldError(pass, "");
    };
    pass.addEventListener("input", pwHint);
    var tog = $("[data-pw-toggle]");
    tog.addEventListener("click", function () {
      var show = pass.type === "password";
      pass.type = show ? "text" : "password";
      tog.textContent = show ? "Hide" : "Show";
      tog.setAttribute("aria-pressed", String(show));
      tog.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
    // Clear an error as soon as the field is fixed.
    form.addEventListener("input", function (e) {
      var t = e.target; if (!t.getAttribute || !t.getAttribute("aria-invalid")) return;
      if ((t.name === "name" && t.value.trim().length >= 2) || (t.name === "email" && EMAIL.test(t.value.trim()))) fieldError(t, "");
    });
    form.addEventListener("change", function (e) { if (e.target.name === "accepted" && e.target.checked) fieldError(e.target, ""); });
    var legalBox = form.elements.accepted;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = form.elements, errs = [];
      var check = function (input, ok, type, msg) { if (ok) fieldError(input, ""); else { fieldError(input, msg); errs.push([input, type]); } };
      check(f.name, f.name.value.trim().length >= 2, "name_short", "Enter your name.");
      check(f.email, EMAIL.test(f.email.value.trim()), "email_invalid", "Enter an email address like name@example.com.");
      check(f.password, f.password.value.length >= 12, "password_short", "Use at least 12 characters.");
      check(legalBox, legalBox.checked, "terms_unchecked", "Accept the terms to continue.");
      if (errs.length) {
        TY.track("signup_error", Object.assign(base(), { error_type: errs.map(function (x) { return x[1]; }).join(",") }));
        errs[0][0].focus();
        return;
      }
      var btn = form.querySelector(".au-submit"), done = $("[data-done]", form);
      btn.setAttribute("aria-disabled", "true"); btn.disabled = true;
      done.hidden = false; done.focus({ preventScroll: true });
      TY.track("signup_submit", Object.assign(base(), { source: src.utm_source || src.ref || undefined }));
    });
  }

  /* ---------------- Early access (registration closed) ----------------- */
  $$("[data-au-early]").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var err = $("[data-err]", f), done = $("[data-done]", f), el = f.elements, miss = [];
      if (el.name.value.trim().length < 2) miss.push("your name");
      if (!EMAIL.test(el.email.value.trim())) miss.push("an email address");
      if (!el.consent.checked) miss.push("your OK to be contacted");
      if (miss.length) { err.textContent = "Add " + miss.join(", ") + " to join."; err.hidden = false; return; }
      err.hidden = true;
      done.textContent = "You’re on the early-access list. We’ll tell you here when sign-ups reopen. Prototype: nothing was sent.";
      done.hidden = false;
      $$("input, button[type=submit]", f).forEach(function (x) { x.disabled = true; });
      TY.track("signup_submit", { mode: "early_access", has_slug: !!slug });
    });
  });

  /* ---------------- Sign in (prototype) -------------------------------- */
  var login = $("[data-login]");
  if (login) login.addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("[data-err]", login), done = $("[data-done]", login), el = login.elements;
    if (!EMAIL.test(el.email.value.trim()) || !el.password.value) { err.textContent = "Enter your email address and password."; err.hidden = false; done.hidden = true; return; }
    err.hidden = true; done.textContent = "Prototype: you would be signed in and taken to your workspace."; done.hidden = false;
  });
})();
