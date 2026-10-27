/* Concept B · content group scripts (guides, FAQ, methodology, legal).
   Owned by the content page builder. Loaded (defer) after site.js and
   calc.js on this group's pages only. Uses window.TY. No libraries.
   Motion: transform/opacity only; colour changes are instant. */
(function () {
  "use strict";
  var TY = window.TY; if (!TY) return;
  var d = document, w = window, $ = TY.$, $$ = TY.$$;
  var settle = function (el) { el.style.transition = "none"; void el.offsetWidth; el.style.transition = ""; };
  var mqPhone = w.matchMedia("(max-width: 1023px)");

  /* ---------------- Table of contents: active section + indicator ------ */
  $$("[data-toc]").forEach(function (nav) {
    var links = $$("[data-toc-link]", nav), ind = $(".toc-ind", nav), toggle = $(".toc-toggle", nav);
    var targets = links.map(function (a) { return d.getElementById(a.getAttribute("href").slice(1)); });
    var cur = -2, ticking = false, first = true;
    function place() {
      if (!ind) return;
      if (cur < 0) { ind.style.setProperty("--sy", "0"); return; }
      var a = links[cur];
      ind.style.setProperty("--y", a.offsetTop + "px");
      ind.style.setProperty("--sy", String(a.offsetHeight / 100));
    }
    function set(i) {
      if (i === cur) return; cur = i;
      links.forEach(function (a, j) { if (j === i) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
      if (first && ind) { first = false; place(); settle(ind); } else place();
    }
    function check() {
      ticking = false;
      var line = Math.min(w.innerHeight * 0.4, 260), idx = -1;
      for (var i = 0; i < targets.length; i++) if (targets[i] && targets[i].getBoundingClientRect().top <= line) idx = i;
      set(idx);
    }
    w.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(check); } }, { passive: true });
    w.addEventListener("resize", place);
    check();
    if (!toggle) return;
    var panel = d.getElementById(toggle.getAttribute("aria-controls"));
    function open(o) { nav.classList.toggle("is-open", o); toggle.setAttribute("aria-expanded", String(o)); }
    toggle.addEventListener("click", function () { open(!nav.classList.contains("is-open")); });
    /* Phones: close the sheet instantly, then jump, so the target lands under the header. */
    links.forEach(function (a) {
      a.addEventListener("click", function (e) {
        if (!mqPhone.matches) return;
        var t = d.getElementById(a.getAttribute("href").slice(1)); if (!t) return;
        e.preventDefault();
        if (panel) panel.style.transition = "none";
        open(false);
        if (panel) { void panel.offsetWidth; panel.style.transition = ""; }
        t.scrollIntoView({ block: "start" });
        try { history.pushState(null, "", "#" + t.id); } catch (err) {}
      });
    });
    nav.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("is-open")) { open(false); toggle.focus(); } });
    if (panel) mqPhone.addEventListener("change", function () { open(false); });
  });

  /* ---------------- Guide read to 75% (micro-conversion, section B) ---- */
  var guide = $("[data-guide]");
  if (guide) {
    var gbody = $(".ct-body", guide), readSent = false;
    var onRead = function () {
      if (readSent || !gbody) return;
      var r = gbody.getBoundingClientRect();
      if ((w.innerHeight - r.top) / r.height >= 0.75) { readSent = true; TY.track("guide_read", { guide: guide.getAttribute("data-guide"), depth: 75 }); w.removeEventListener("scroll", onRead); }
    };
    w.addEventListener("scroll", onRead, { passive: true });
  }

  /* ---------------- Pricing guide: carry the price into the calculator - */
  var ready = false;
  d.addEventListener("ty:calc", function (e) {
    var root = e.target, link = root.querySelector && root.querySelector("[data-try-link]");
    if (!link || e.detail.type !== "earnings") return;
    link.setAttribute("href", "earnings-calculator.html?price=" + Math.round(e.detail.inputs.workoutPriceAed) + "&subs=60");
    if (ready) TY.flash($(".ct-try-out", root));
  });
  w.addEventListener("load", function () { ready = true; });

  /* ---------------- FAQ: filter field + topic filter -------------------- */
  var finder = $("[data-finder]");
  if (finder) {
    var list = $("[data-faq-list]"), input = $("[data-filter]", finder), topics = $$("[data-topic]", finder);
    var ind = $(".topic-ind", finder), count = $("[data-count]", finder), empty = $("[data-empty]"), groups = $$("[data-group]", list);
    var clearBtn = $(".finder-clear", finder), topic = "all", timer, LABEL = {};
    topics.forEach(function (b) { LABEL[b.getAttribute("data-topic")] = b.firstChild.textContent.trim(); });
    var shown = function (el) { return !el.hidden && getComputedStyle(el).display !== "none"; };
    /* Questions that the honest-state flags hide (e.g. frontier-only answers). */
    var FLAG = { "if-frontier-on": ["frontier", "off", true], "if-frontier-off": ["frontier", "off", false], "if-payments-on": ["payments", "off", true], "if-payments-off": ["payments", "off", false], "if-voice-on": ["voice", "off", true], "if-voice-off": ["voice", "off", false] };
    var flagHidden = function (el) {
      for (var c in FLAG) if (el.classList.contains(c)) { var f = FLAG[c], is = d.documentElement.getAttribute("data-" + f[0]) === f[1]; if (f[2] ? is : !is) return true; }
      return false;
    };
    function recount() {
      var all = 0, tc = $$("[data-tcount]", finder);
      groups.forEach(function (g, i) {
        var n = $$("[data-q]", g).filter(function (a) { return !flagHidden(a); }).length; all += n;
        var gc = $("[data-gcount]", g); if (gc) gc.textContent = (n < 10 ? "0" : "") + n;
        if (tc[i + 1]) tc[i + 1].textContent = String(n);
      });
      if (tc[0]) tc[0].textContent = String(all);
      $$("[data-total]").forEach(function (t) { t.textContent = String(all); });
    }
    function placeInd(initial) {
      var b = topics.filter(function (x) { return x.getAttribute("aria-pressed") === "true"; })[0]; if (!b || !ind) return;
      ind.style.setProperty("--x", b.offsetLeft + "px"); ind.style.setProperty("--y", b.offsetTop + "px");
      ind.style.setProperty("--sx", String(b.offsetWidth / 100)); ind.style.setProperty("--sy", String(b.offsetHeight / 100));
      if (initial) settle(ind);
      var row = b.parentElement;
      if (row.scrollWidth > row.clientWidth + 2) {
        var left = b.offsetLeft - (row.clientWidth - b.offsetWidth) / 2;
        try { row.scrollTo({ left: Math.max(0, left), behavior: initial ? "auto" : "smooth" }); } catch (err) { row.scrollLeft = left; }
      }
    }
    function apply(say) {
      var raw = input.value.trim(), q = raw.toLowerCase().replace(/[\u2018\u2019]/g, "'"), words = q.split(/\s+/).filter(Boolean), n = 0;
      groups.forEach(function (g) {
        var inTopic = topic === "all" || g.getAttribute("data-group") === topic, any = 0;
        g.hidden = false;
        $$("[data-q]", g).forEach(function (acc) {
          var txt = acc._t || (acc._t = acc.textContent.replace(/\s+/g, " ").replace(/[\u2018\u2019]/g, "'").toLowerCase());
          var ok = inTopic && words.every(function (wd) { return txt.indexOf(wd) > -1; });
          acc.hidden = !ok;
          if (ok && shown(acc)) any++;
        });
        g.hidden = !any; n += any;
      });
      if (empty) empty.hidden = n > 0;
      if (clearBtn) clearBtn.hidden = !raw;
      var text = raw
        ? (n ? n + (n === 1 ? " question matches “" : " questions match “") + raw + "”" : "No questions match “" + raw + "”")
        : topic === "all" ? "Showing all " + n + " questions" : "Showing " + n + " questions about " + LABEL[topic];
      if (say) count.textContent = text; else count.textContent = text;
    }
    function setTopic(t, quiet) {
      topic = t;
      topics.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-topic") === t)); });
      placeInd(false);
      apply(true);
    }
    topics.forEach(function (b) { b.addEventListener("click", function () { if (input.value) input.value = ""; setTopic(b.getAttribute("data-topic")); }); });
    input.addEventListener("input", function () {
      if (input.value.trim() && topic !== "all") { topic = "all"; topics.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-topic") === "all")); }); placeInd(false); }
      clearTimeout(timer); timer = setTimeout(function () { apply(true); }, 180);
    });
    input.addEventListener("keydown", function (e) { if (e.key === "Escape" && input.value) { input.value = ""; apply(true); } });
    $$("[data-clear]").forEach(function (b) { b.addEventListener("click", function () { input.value = ""; setTopic("all", true); input.focus(); }); });
    w.addEventListener("resize", function () { placeInd(true); });
    d.addEventListener("ty:state", function () { recount(); apply(false); });
    recount(); placeInd(true); apply(false);

    /* "Asked most" shortcuts and #fq-n links open the answer */
    var openQ = function (id, focus) {
      var acc = d.getElementById(id); if (!acc || !acc.classList.contains("acc")) return;
      if (!shown(acc) || acc.closest("[hidden]")) { input.value = ""; setTopic("all", true); }
      if (!acc.classList.contains("is-open")) $(".acc-btn", acc).click();
      acc.scrollIntoView({ block: "start" });
      acc.classList.add("is-target"); setTimeout(function () { acc.classList.remove("is-target"); }, 1600);
      if (focus) $(".acc-btn", acc).focus({ preventScroll: true });
    };
    d.addEventListener("click", function (e) {
      var a = e.target.closest("[data-open-q]"); if (!a) return;
      e.preventDefault(); openQ(a.getAttribute("href").slice(1), true);
      try { history.replaceState(null, "", a.getAttribute("href")); } catch (err) {}
    });
    var fromHash = function () { if (/^#fq-\d+$/.test(location.hash)) openQ(location.hash.slice(1), false); };
    setTimeout(fromHash, 60);
    w.addEventListener("hashchange", fromHash);
  }

  /* ---------------- Methodology: filter by page, arrival highlight ------ */
  var lf = $("[data-lfilter]");
  var rows = $$(".src-row");
  if (lf) {
    var sel = $("[data-lf-page]", lf), lcount = $("[data-lf-count]", lf);
    var filter = function () {
      var p = sel.value, n = 0;
      rows.forEach(function (r) { var ok = !p || (" " + r.getAttribute("data-pages") + " ").indexOf(" " + p + " ") > -1; r.hidden = !ok; if (ok) n++; });
      lcount.textContent = p ? n + " of " + rows.length + " sources are used on " + sel.options[sel.selectedIndex].text : "Showing all " + rows.length + " sources";
    };
    sel.addEventListener("change", filter);
    /* Arriving from a Source badge: show the sources of the page it came from. */
    try {
      var ref = d.referrer ? new URL(d.referrer) : null;
      if (ref && ref.origin === location.origin && location.hash) {
        var file = ref.pathname.slice(ref.pathname.lastIndexOf("/") + 1) || "index.html";
        var opt = $('option[data-file="' + file + '"]', sel);
        var row = d.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (opt && row && (" " + row.getAttribute("data-pages") + " ").indexOf(" " + opt.value + " ") > -1) { sel.value = opt.value; filter(); }
      }
    } catch (err) {}
  }
  function arrive() {
    var id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
    var row = d.getElementById(id); if (!row || !row.classList.contains("src-row")) return;
    if (row.hidden && lf) { var s = $("[data-lf-page]", lf); s.value = ""; s.dispatchEvent(new Event("change")); }
    row.classList.remove("is-arrived"); void row.offsetWidth; row.classList.add("is-arrived");
    row.scrollIntoView({ block: "start" });
    row.focus({ preventScroll: true });
  }
  if (rows.length) { arrive(); w.addEventListener("hashchange", arrive); }

  /* ---------------- Permit checklist ------------------------------------ */
  $$("[data-checks]").forEach(function (box) {
    var cbs = $$("[data-check]", box), out = $("[data-checks-out]", box), meter = $(".checks-meter i", box);
    var upd = function () {
      var n = cbs.filter(function (c) { return c.checked; }).length;
      out.textContent = n + " of " + cbs.length + " checked" + (n === cbs.length ? ". Ready to promote your own coaching." : "");
      meter.style.setProperty("--p", String(n / cbs.length));
    };
    cbs.forEach(function (c) { c.addEventListener("change", upd); });
  });
})();
