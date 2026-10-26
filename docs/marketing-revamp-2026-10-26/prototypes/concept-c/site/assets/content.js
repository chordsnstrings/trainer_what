/* Concept C content group (owner: content builder). Uses window.ty from site.js.
   1. Contents rail active state  2. Chapter/source filters  3. Arrival highlight. */
(function () {
  "use strict";
  var d = document, ty = window.ty || {};
  var $$ = function (s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); };
  var announce = function (el, t) { if (ty.announce) ty.announce(el, t); else el.textContent = t; };
  var debounce = ty.debounce || function (f) { return f; };

  /* ---------- 1. Contents rail ---------- */
  $$("[data-ctoc]").forEach(function (nav) {
    var links = $$("a[href^='#']", nav), ink = nav.querySelector(".ctoc-ink");
    var secs = links.map(function (a) { return d.getElementById(a.getAttribute("href").slice(1)); });
    var cur = -1, ticking = false;
    function set(i) {
      if (i === cur) return;
      cur = i;
      links.forEach(function (a, j) { a.classList.toggle("is-active", j === i); if (j === i) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current"); });
      if (ink && i > -1) { var a = links[i]; ink.style.setProperty("--y", a.offsetTop + "px"); ink.style.setProperty("--sy", a.offsetHeight / 100); }
      else if (ink) ink.style.setProperty("--sy", 0);
    }
    function update() {
      ticking = false;
      var line = innerHeight * 0.3, i = -1;
      secs.forEach(function (s, j) { if (s && s.getBoundingClientRect().top <= line) i = j; });
      set(i);
    }
    addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener("resize", debounce(function () { cur = -2; update(); }, 120));
    update();
  });
  /* The mobile contents disclosure closes first, then the page moves to the
     section, so the collapse never shifts the target. */
  $$(".toc-m a").forEach(function (a) {
    a.addEventListener("click", function (e) {
      var m = a.closest("details"), id = a.getAttribute("href"), t = d.getElementById(id.slice(1));
      if (!m || !t) return;
      e.preventDefault(); m.open = false;
      requestAnimationFrame(function () { t.scrollIntoView({ block: "start" }); history.pushState(null, "", id); });
    });
  });

  /* ---------- 2. Filters ---------- */
  function inkTo(bar, btn) {
    var ink = bar.querySelector(".chap-ink"); if (!ink || !btn) return;
    ink.style.setProperty("--x", btn.offsetLeft + "px"); ink.style.setProperty("--sx", btn.offsetWidth / 100);
  }
  function pressed(bar, btn) {
    $$("button", bar).forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
    inkTo(bar, btn);
    if (bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: Math.max(0, btn.offsetLeft - 24), behavior: "smooth" });
  }
  function keepInk(bar) {
    var on = function () { inkTo(bar, bar.querySelector("[aria-pressed='true']")); };
    requestAnimationFrame(on);
    addEventListener("resize", debounce(on, 120));
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(on);
  }

  /* FAQ: chapters + search */
  $$("[data-faq-filter]").forEach(function (root) {
    var input = root.querySelector("[data-fq-input]"), bar = root.querySelector(".chapbar");
    var count = root.querySelector("[data-fq-count]"), live = root.querySelector("[data-fq-live]"), empty = root.querySelector("[data-fq-empty]");
    var chapters = $$("[data-fq-chapter]", root), ch = "all";
    var items = $$(".faq-item", root).map(function (el) { return { el: el, ch: el.getAttribute("data-chapter"), text: el.textContent.toLowerCase().replace(/\s+/g, " ") }; });
    function apply(speak) {
      var q = input.value.trim().toLowerCase(), shown = 0;
      items.forEach(function (it) { var on = (ch === "all" || it.ch === ch) && (!q || it.text.indexOf(q) > -1); it.el.hidden = !on; if (on) shown++; });
      chapters.forEach(function (c) { c.hidden = !items.some(function (it) { return !it.el.hidden && it.el.closest("[data-fq-chapter]") === c; }); });
      empty.hidden = shown > 0;
      var msg = shown ? (shown === items.length ? "All " + shown + " questions" : shown + " of " + items.length + " questions") : "No question matches";
      count.textContent = msg;
      if (speak) announce(live, msg);
    }
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-fq-ch]"); if (!b) return;
      ch = b.getAttribute("data-fq-ch"); pressed(bar, b); apply(true);
    });
    input.addEventListener("input", debounce(function () { apply(true); }, 150));
    keepInk(bar);
  });

  /* Methodology: sources by the page that cites them */
  $$("[data-src-filter]").forEach(function (root) {
    var bar = root.querySelector(".chapbar"), count = root.querySelector("[data-src-count]"), live = root.querySelector("[data-src-live]");
    var rows = $$("[data-on]", root);
    root.tyShow = function (f, speak) {
      var n = 0;
      rows.forEach(function (r) { var on = f === "all" || (" " + r.getAttribute("data-on") + " ").indexOf(" " + f + " ") > -1; r.hidden = !on; if (on) n++; });
      pressed(bar, bar.querySelector("[data-src-f='" + f + "']"));
      var label = bar.querySelector("[data-src-f='" + f + "']").firstChild.textContent.trim();
      var msg = f === "all" ? "All " + n + " sources" : n + " sources cited on " + label;
      count.textContent = msg;
      if (speak) announce(live, msg);
    };
    bar.addEventListener("click", function (e) { var b = e.target.closest("button[data-src-f]"); if (b) root.tyShow(b.getAttribute("data-src-f"), true); });
    keepInk(bar);
  });

  /* ---------- 3. Arrival highlight ---------- */
  function arrive() {
    var id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
    var el = d.getElementById(id); if (!el) return;
    if (!el.classList.contains("arrive-row")) {
      if (!el.classList.contains("dsec")) return;
      el = el.querySelector(".sec-head"); if (!el) return;
      el.classList.add("arrive-row");
    }
    if (el.hidden) { var f = el.closest("[data-src-filter]"); if (f && f.tyShow) { f.tyShow("all"); el.scrollIntoView(); } }
    /* Wait until any (smooth) scroll to the row has settled, then mark it. */
    var t, on = function () { clearTimeout(t); t = setTimeout(done, 140); };
    function done() {
      removeEventListener("scroll", on);
      var r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
      el.classList.add("is-arrived");
      setTimeout(function () { el.classList.remove("is-arrived"); }, 700);
    }
    addEventListener("scroll", on, { passive: true }); on();
  }
  addEventListener("hashchange", arrive);
  if (d.readyState === "complete") arrive(); else addEventListener("load", arrive);
})();
