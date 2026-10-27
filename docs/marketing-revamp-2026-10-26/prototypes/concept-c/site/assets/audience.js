/* Concept C: audience page group behaviour. Owned by the audience page builder.
   Uses window.ty (site.js) and window.tyCalc (calc.js, specialty pages).
   Values change by stacked-span crossfade only. Do not edit site.js. */
(function () {
  "use strict";
  var ty = window.ty, C = window.tyCalc;
  if (!ty) return;
  var d = document;
  var $ = function (s, r) { return (r || d).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || d).querySelectorAll(s)); };
  var q = new URLSearchParams(location.search);
  var setText = function (slot, t) { slot.textContent = ""; var s = d.createElement("span"); s.textContent = t; slot.appendChild(s); };

  /* ---------- Specialty hero: highlight sweeps the rule, then it is applied (once, after load) ---------- */
  var fig = $("[data-au-fig]"), ap = fig && $("[data-au-apply]", fig);
  if (ap) {
    var slot = $('[data-vx="au-next"]', ap), played = 0, tm;
    var play = function () {
      if (played) return; played = 1;
      fig.classList.add("is-swept");
      tm = setTimeout(function () { ty.swap(slot, ap.getAttribute("data-to")); ap.classList.add("is-applied"); }, 560);
    };
    var start = function () {
      if (ty.inView(ap) || !("IntersectionObserver" in window)) return void setTimeout(play, 250);
      var o = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { o.disconnect(); setTimeout(play, 150); } }, { threshold: 0.6 });
      o.observe(ap);
    };
    if (d.readyState === "complete") start(); else addEventListener("load", start);
    ty.onReplay(function () {
      clearTimeout(tm); played = 0;
      fig.classList.remove("is-swept"); ap.classList.remove("is-applied");
      setText(slot, ap.getAttribute("data-from"));
      setTimeout(play, 320);
    });
  }

  /* ---------- Review topics: switches the visitor flips ---------- */
  $$("[data-au-topics]").forEach(function (list) {
    var count = $('[data-vx="au-count"]', list.closest(".window"));
    list.addEventListener("click", function (e) {
      var b = e.target.closest('[role="switch"]');
      if (!b) return;
      b.setAttribute("aria-checked", String(b.getAttribute("aria-checked") !== "true"));
      var n = $$('[aria-checked="true"]', list).length;
      ty.swap(count, n + (n === 1 ? " topic" : " topics"));
    });
  });

  /* ---------- Compact follower calculator (calc.js maths, unchanged) ---------- */
  var fc = $("[data-au-calc]");
  if (fc && C) {
    var live = $("#fc-live", fc), viewed = 0, first = 0;
    var num = function (el, fb) { var v = el.value.trim(), n = Number(v); return v === "" || !isFinite(n) ? fb : n; };
    var bucket = function (p) { return p < 150 ? "<150" : p < 250 ? "150-249" : p < 400 ? "250-399" : "400+"; };
    var vx = function (k) { return $('[data-vx="' + k + '"]', fc); };
    var update = function () {
      var i = {};
      $$("input[data-k]", fc).forEach(function (el) { i[el.getAttribute("data-k")] = el; });
      var est = C.estimateFollowerConversion(Object.assign({}, C.DEFAULT_FOLLOWER_INPUTS, {
        followers: num(i.followers, 0), priceAed: num(i.priceAed, 1), linkStoriesPerMonth: num(i.linkStoriesPerMonth, 0),
      })), s = est.scenarios;
      ty.swap(vx("headline"), C.aedWhole(s.strong.revenueMonth12Minor));
      ["cautious", "typical", "strong"].forEach(function (k) {
        ty.swap(vx(k + "-aed"), C.aedWhole(s[k].revenueMonth12Minor));
        ty.swap(vx(k + "-active"), C.countLabel(s[k].activeMonth12));
      });
      ty.announce(live, "Best case: up to " + C.aedWhole(s.strong.revenueMonth12Minor) + " a month at your price, before platform commission. Typical " +
        C.aedWhole(s.typical.revenueMonth12Minor) + ". Cautious " + C.aedWhole(s.cautious.revenueMonth12Minor) + ".");
      if (!viewed) { viewed = 1; ty.track("calc_result_view", { calc: "follower", scenario: "strong", price_bucket: bucket(est.inputs.priceAed) }); }
    };
    fc.addEventListener("input", ty.debounce(function (e) {
      if (!first) {
        first = 1;
        var fresh = true;
        try { fresh = !sessionStorage.getItem("ty-c-calc-follower"); sessionStorage.setItem("ty-c-calc-follower", "1"); } catch (x) {}
        if (fresh) ty.track("calc_input", { calc: "follower", field: e.target.getAttribute("data-k") });
      }
      update();
    }, 120));
    fc.addEventListener("submit", function (e) { e.preventDefault(); });
  }

  /* ---------- Carried parameters: ?slug (pre-fill only), ?price_aed (decision 8), source ---------- */
  var slug = (q.get("slug") || "").toLowerCase(), okSlug = /^[a-z][a-z0-9-]{2,39}$/.test(slug);
  var price = Math.round(Number(q.get("price_aed") || q.get("price"))), okPrice = price >= 1 && price <= 10000;
  if (okSlug) {
    $$("[data-au-slugchip]").forEach(function (el) { el.hidden = false; $("[data-au-slug]", el).textContent = slug; });
    $$("[data-au-slugfield]").forEach(function (el) { el.value = slug; });
  }
  if (okPrice) $$("[data-au-pricechip]").forEach(function (el) { el.hidden = false; $("[data-au-price]", el).textContent = "AED " + price.toLocaleString("en-US"); });
  var signup = $('[data-au-form="signup"]');
  if (signup) {
    var src = [];
    q.forEach(function (v, k) {
      if (!/^(utm_[a-z]+|gclid|fbclid|ref)$/.test(k)) return;
      src.push(k);
      var hid = d.createElement("input"); hid.type = "hidden"; hid.name = k; hid.value = v; signup.appendChild(hid);
    });
    var entry = "direct";
    try { if (d.referrer) { var u = new URL(d.referrer); entry = u.origin === location.origin ? (u.pathname.split("/").pop() || "index.html") : "external"; } } catch (x) {}
    ty.track("signup_view", { has_slug: okSlug, has_price: okPrice, entry_page: entry, source: src.join(",") || "none" });
  }

  /* ---------- Forms: inline validation, in-page result (prototype never submits) ---------- */
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var RULES = {
    name: function (v) { return v.length >= 2; },
    email: function (v) { return EMAIL.test(v); },
    consent: function (v) { return v; },
    terms: function (v) { return v; },
  };
  $$("[data-au-form]").forEach(function (f) {
    var kind = f.getAttribute("data-au-form"), started = 0;
    var check = function (w) {
      var name = w.getAttribute("data-field"), el = f.elements[name];
      var rule = name === "password" ? function (v) { return kind === "signup" ? v.length >= 12 : v.length > 0; } : RULES[name];
      if (!el || !rule) return true;
      var ok = rule(el.type === "checkbox" ? el.checked : el.value.trim());
      var ids = (el.getAttribute("aria-describedby") || "").split(" ");
      ids.forEach(function (id) { var e = id && d.getElementById(id); if (e && e.hasAttribute("data-err")) e.hidden = ok; });
      el.setAttribute("aria-invalid", String(!ok));
      w.classList.toggle("is-invalid", !ok);
      return ok;
    };
    f.addEventListener("focusin", function (e) {
      if (kind === "signup" && !started && e.target.name) { started = 1; ty.track("signup_field_start", { field: e.target.name }); }
    });
    f.addEventListener("input", function (e) {
      var w = e.target.closest("[data-field]");
      if (w && w.classList.contains("is-invalid")) check(w);
      if (e.target.name === "password" && kind === "signup") {
        var hint = $("[data-au-pwhint]", f), n = e.target.value.length;
        hint.textContent = n === 0 ? "At least 12 characters." : n < 12 ? 12 - n + (n === 11 ? " more character." : " more characters.") : "Long enough.";
        hint.classList.toggle("is-ok", n >= 12);
      }
    });
    f.addEventListener("change", function (e) { var w = e.target.closest("[data-field]"); if (w && w.classList.contains("is-invalid")) check(w); });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var bad = $$("[data-field]", f).filter(function (w) { return !check(w); });
      if (bad.length) {
        var el = f.elements[bad[0].getAttribute("data-field")];
        if (el && el.focus) el.focus();
        if (kind === "signup") ty.track("signup_error", { error_type: bad.map(function (w) { return w.getAttribute("data-field") + "_invalid"; }).join(",") });
        return;
      }
      var done = $("[data-au-done]", f), finish = function () { f.classList.add("is-done"); done.hidden = false; done.focus(); };
      if (kind === "signup") {
        var btn = $(".au-submit", f);
        ty.track("signup_submit", { has_slug: okSlug, has_price: okPrice });
        btn.classList.add("is-busy");
        ty.swap($('[data-vx="au-btn"]', btn), "Opening your setup…");
        setTimeout(function () { finish(); ty.track("signup", { prototype: true }); }, 700);
      } else {
        if (kind === "early") ty.track("signup_submit", { mode: "early_access", has_slug: okSlug });
        finish();
      }
    });
  });

  /* Show or hide the sign-up password. */
  $$("[data-au-pw]").forEach(function (b) {
    b.addEventListener("click", function () {
      var i = d.getElementById(b.getAttribute("aria-controls")), show = i.type === "password";
      i.type = show ? "text" : "password";
      b.textContent = show ? "Hide" : "Show";
      b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });
  /* Sign-in alternatives explain themselves in place. */
  $$("[data-au-note]").forEach(function (b) {
    b.addEventListener("click", function () { var s = $("[data-au-status]"); if (s) s.textContent = b.getAttribute("data-au-note"); });
  });

  /* ---------- Arabic preview of the follower-app vignette (same flag as the dev panel) ---------- */
  var langs = $$("[data-au-lang]");
  if (langs.length) {
    var font = 0;
    var sync = function (f) {
      var ar = f["rtl-preview"] === "on";
      langs.forEach(function (b) { b.setAttribute("aria-pressed", String((b.getAttribute("data-au-lang") === "ar") === ar)); });
      if (ar && !font) {
        font = 1;
        var l = d.createElement("link");
        l.rel = "stylesheet";
        l.href = "https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;600&display=swap";
        d.head.appendChild(l);
      }
    };
    langs.forEach(function (b) {
      b.addEventListener("click", function () {
        var want = b.getAttribute("data-au-lang") === "ar", sw = $('[data-flag="rtl-preview"]');
        if (sw && want !== (ty.flags()["rtl-preview"] === "on")) sw.click();
      });
    });
    ty.onFlags(sync);
    sync(ty.flags());
  }
})();
