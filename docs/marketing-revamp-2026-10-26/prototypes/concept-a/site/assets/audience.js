/* Audience pages: specialty switcher, follower estimate, RTL preview, address mirror,
 * attribution carry-over, sign-up and sign-in forms. Uses window.ty (site.js) and,
 * on specialty pages, window.tyCalc (calc.js). Prototype only: nothing is sent. */
(function () {
  "use strict";
  var ty = window.ty, d = document;
  if (!ty) return;
  var $ = ty.$, $$ = ty.$$, on = ty.on;

  /* ---- attribution (section B): UTM, gclid, fbclid and ref ride along to sign-up.
     With consent the first touch is stored and reused; without it only this URL's values pass. */
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "ref"];
  function pick(search) {
    var u = new URLSearchParams(search), o = {};
    KEYS.forEach(function (k) { var v = u.get(k); if (v) o[k] = v.slice(0, 120); });
    return o;
  }
  var here = pick(location.search), granted = ty.store.get("tyA.consent") === "granted", first = {};
  try { first = JSON.parse(ty.store.get("tyA.attr") || "{}") || {}; } catch (e) { first = {}; }
  if (granted && !Object.keys(first).length && Object.keys(here).length) { first = here; ty.store.set("tyA.attr", JSON.stringify(here)); }
  var attr = granted && Object.keys(first).length ? first : here;
  on(d, "click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="signup.html"]');
    if (!a || !Object.keys(attr).length) return;
    var u = new URL(a.getAttribute("href"), location.href);
    Object.keys(attr).forEach(function (k) { if (!u.searchParams.has(k)) u.searchParams.set(k, attr[k]); });
    a.setAttribute("href", "signup.html" + u.search + u.hash);
  }, true);

  /* ---- /for-trainers: the specialty switcher re-skins the console and plays its decision once. */
  $$("[data-ft-switch]").forEach(function (box) {
    on(box, "ty:tab", function (e) {
      box.classList.add("is-touched");
      var panel = d.getElementById(e.detail.tab.getAttribute("aria-controls")), c = panel && $("[data-console]", panel);
      if (c) ty.play(c);
      ty.track("demo_play", { scenario: e.detail.tab.getAttribute("data-key"), location: "for-trainers" });
    });
  });
  on(d, "ty:replay", function () {
    var c = $("[data-ft-switch] [role=tabpanel]:not([hidden]) [data-console]");
    if (c) ty.play(c);
  });

  /* ---- compact follower estimate (specialty pages); maths from calc.js only. */
  var bucket = function (p) { return p < 150 ? "<150" : p < 250 ? "150-249" : p < 400 ? "250-399" : "400+"; };
  $$("[data-aud-fc]").forEach(function (box) {
    var C = window.tyCalc;
    if (!C) return;
    var live = $("[data-live]", box), result = $(".calc-result", box), started = false, watching = false;
    var num = function (k, fb) { var v = parseFloat(($('[data-k="' + k + '"]', box) || {}).value); return isFinite(v) ? v : fb; };
    function run() {
      var price = num("price", 199), est = C.estimateFollowers({ followers: num("followers", 0), priceAed: price, linkStoriesPerMonth: num("stories", 0) });
      var v = function (k) { return est.scenarios[k].revenueMonth12Minor; }, max = Math.max(1, v("strong"));
      ty.swap($(".afc-strong", box), C.aed(v("strong")));
      ["cautious", "typical", "strong"].forEach(function (k) {
        var lane = $('[data-lane="' + k + '"]', box);
        $(".calc-lane-bar span", lane).style.setProperty("--v", (v(k) / max).toFixed(4));
        ty.swap($(".vx", lane), C.aed(v(k)));
      });
      ty.announce(live, "Best case up to " + C.aed(v("strong")) + " a month. Typical " + C.aed(v("typical")) + ". Cautious " + C.aed(v("cautious")) + ".");
      var props = { calc: "follower", scenario: "strong", price_bucket: bucket(price) };
      if (!started) {
        started = true;
        var seen = null;
        try { seen = sessionStorage.getItem("tyA.calc.follower"); sessionStorage.setItem("tyA.calc.follower", "1"); } catch (e) { /* no storage */ }
        if (!seen) ty.track("calc_input", props);
      }
      if (!watching && "IntersectionObserver" in window) {
        watching = true;
        var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); ty.track("calc_result_view", props); } }, { threshold: 0.3 });
        io.observe(result);
      }
    }
    $$("input", box).forEach(function (i) { on(i, "input", run); });
    on($("form", box), "submit", function (e) { e.preventDefault(); });
  });

  /* ---- /uae: English / Arabic preview on the subscriber-app vignette only (real app strings). */
  $$("[data-rtl]").forEach(function (box) {
    var screen = $("[data-rtl-screen]", box), btns = $$("[data-lang]", box), font = false;
    function set(lang) {
      var ar = lang === "ar";
      if (screen.getAttribute("lang") === lang) return;
      if (ar && !font) {
        font = true;
        var l = d.createElement("link");
        l.rel = "stylesheet";
        l.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap";
        d.head.appendChild(l);
      }
      $$("[data-ar]", screen).forEach(function (el) {
        if (!el.hasAttribute("data-en")) el.setAttribute("data-en", el.textContent);
        el.textContent = el.getAttribute(ar ? "data-ar" : "data-en");
      });
      screen.setAttribute("lang", lang);
      screen.setAttribute("dir", ar ? "rtl" : "ltr");
      btns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang)); });
      screen.classList.remove("is-swap");
      void screen.offsetWidth;
      screen.classList.add("is-swap");
    }
    btns.forEach(function (b) { on(b, "click", function () { set(b.getAttribute("data-lang")); }); });
  });

  /* ---- /get-started: the page preview mirrors the coaching name as it is typed. */
  $$("[data-gs-claim]").forEach(function (box) {
    var input = $("[data-address] input", box), slug = $("[data-gs-slug]", box), name = $("[data-gs-name]", box), ini = $("[data-gs-ini]", box);
    if (!input) return;
    on(input, "input", function () {
      var v = input.value.trim();
      var initials = v.split(/\s+/).map(function (w) { return (w.match(/[A-Za-z0-9]/) || [""])[0]; }).join("").slice(0, 2).toUpperCase();
      slug.textContent = ty.slugFromName(v) || "your-name";
      name.textContent = v || "Your coaching name";
      ini.textContent = initials || "YN";
      box.classList.toggle("has-name", !!v);
    });
  });

  /* ---- shared form helpers */
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function fieldError(wrap, msg) {
    if (!wrap) return;
    var err = $(".field-err", wrap), input = $("input", wrap);
    wrap.classList.toggle("is-invalid", !!msg);
    if (input) input.setAttribute("aria-invalid", String(!!msg));
    if (err) { err.textContent = msg || ""; err.hidden = !msg; }
  }
  function reveal(el) { el.hidden = false; el.focus(); }

  /* Early-access forms (registration closed): in-page result only. */
  $$("[data-early]").forEach(function (f) {
    on(f, "submit", function (e) {
      e.preventDefault();
      var email = f.elements.email, ok = EMAIL.test(email.value.trim());
      fieldError(email.closest(".field"), ok ? "" : "Enter an email address like name@example.com.");
      if (!ok) { email.focus(); return; }
      f.hidden = true;
      reveal($(".early-done", f.parentNode));
    });
  });

  /* ---- /signup: carried address and price, inline guidance, section B events, in-page result. */
  var su = $("[data-signup]");
  if (su) {
    var q = new URLSearchParams(location.search);
    var slugQ = q.get("slug") || "", priceQ = parseInt(q.get("price_aed") || q.get("price") || "", 10);
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slugQ)) slugQ = "";
    if (!(priceQ >= 1 && priceQ <= 10000)) priceQ = 0;
    var entry = "direct";
    try { var r = new URL(d.referrer); entry = r.origin === location.origin ? (r.pathname.split("/").pop() || "index.html").replace(/\.html$/, "") : "external"; } catch (e) { /* no referrer */ }
    var base = { has_slug: !!slugQ, has_price: !!priceQ, has_source: Object.keys(attr).length > 0, entry_page: entry };
    if (slugQ) { $("[data-slug-text]").textContent = slugQ; $("[data-slug-chip]").hidden = false; }
    if (priceQ) { $("[data-price-text]").textContent = "AED " + ty.fmt(priceQ); $("[data-price-chip]").hidden = false; }
    var hidden = $("[data-attr-fields]");
    var carry = Object.assign({}, attr, slugQ ? { slug: slugQ } : {}, priceQ ? { price_aed: priceQ } : {});
    Object.keys(carry).forEach(function (k) {
      var i = d.createElement("input");
      i.type = "hidden"; i.name = k; i.value = carry[k];
      hidden.appendChild(i);
    });
    ty.track("signup_view", base);

    var started = false;
    on(su, "focusin", function (e) {
      if (started || !e.target.name) return;
      started = true;
      ty.track("signup_field_start", Object.assign({ field: e.target.name }, base));
    });
    var pw = su.elements.password, hint = $("[data-pw-hint]"), count = $(".su-pw-n .vx", hint);
    on(pw, "input", function () {
      var n = pw.value.length;
      ty.swap(count, String(Math.min(n, 99)));
      hint.classList.toggle("is-ok", n >= 12);
      if (n >= 12) fieldError(pw.closest(".field"), "");
    });
    var toggle = $("[data-pw-toggle]");
    on(toggle, "click", function () {
      var show = pw.type === "password";
      pw.type = show ? "text" : "password";
      toggle.textContent = show ? "Hide" : "Show";
      toggle.setAttribute("aria-pressed", String(show));
      pw.focus();
    });

    var alertBox = $("[data-su-alert]"), wrap = $("[data-signup-form]"), done = $("[data-signup-done]");
    on(su, "submit", function (e) {
      e.preventDefault();
      var el = su.elements, errs = [];
      var checks = [
        ["name", el.name.value.trim().length >= 2, "Enter your name (at least 2 characters).", "name_short"],
        ["email", EMAIL.test(el.email.value.trim()), "Enter an email address like name@example.com.", "email_invalid"],
        ["password", el.password.value.length >= 12, "Use at least 12 characters.", "password_short"],
        ["terms", el.terms.checked, "Accept the terms to create your account.", "terms_unchecked"],
      ];
      checks.forEach(function (c) {
        fieldError($('[data-field="' + c[0] + '"]', su), c[1] ? "" : c[2]);
        if (!c[1]) errs.push(c);
      });
      if (errs.length) {
        alertBox.textContent = errs.length === 1 ? errs[0][2] : "Check the " + errs.length + " highlighted fields.";
        alertBox.hidden = false;
        el[errs[0][0]].focus();
        ty.track("signup_error", Object.assign({ error_type: errs.map(function (c) { return c[3]; }).join(",") }, base));
        return;
      }
      alertBox.hidden = true;
      ty.track("signup_submit", base);
      su.classList.add("is-busy");
      setTimeout(function () {
        su.classList.remove("is-busy");
        var sum = $("[data-su-sum]");
        sum.textContent = "";
        [["Name", el.name.value.trim()], ["Email", el.email.value.trim()], ["Address hint", slugQ ? slugQ + ".trainsyou.com" : "chosen in setup"], ["Price", priceQ ? "AED " + ty.fmt(priceQ) + " (decision 8)" : "set in setup"], ["Source", Object.keys(attr).length ? Object.keys(attr).map(function (k) { return k + "=" + attr[k]; }).join(" · ") : "none"]].forEach(function (row) {
          var div = d.createElement("div"), dt = d.createElement("dt"), dd = d.createElement("dd");
          dt.textContent = row[0]; dd.textContent = row[1];
          div.appendChild(dt); div.appendChild(dd); sum.appendChild(div);
        });
        wrap.hidden = true;
        reveal(done);
      }, 650);
    });
    on($("[data-su-reset]"), "click", function () {
      su.reset();
      hint.classList.remove("is-ok");
      ty.swap(count, "0");
      done.hidden = true;
      wrap.hidden = false;
      su.elements.name.focus();
    });
  }

  /* ---- /login: prototype notes in the page; nothing signs in. */
  var li = $("[data-login]");
  if (li) {
    var note = $("[data-li-note]"), liAlert = $("[data-li-alert]");
    var say = function (t) { note.textContent = t; note.hidden = false; };
    $$("[data-proto-note]").forEach(function (b) { on(b, "click", function () { say(b.getAttribute("data-proto-note")); }); });
    on(li, "submit", function (e) {
      e.preventDefault();
      var ok = EMAIL.test(li.elements.email.value.trim()) && li.elements.password.value.length > 0;
      liAlert.textContent = ok ? "" : "Enter your email address and password.";
      liAlert.hidden = ok;
      if (!ok) { (li.elements.email.value ? li.elements.password : li.elements.email).focus(); return; }
      say("Prototype: sign-in isn’t connected, so nothing was checked or sent.");
    });
  }
})();
