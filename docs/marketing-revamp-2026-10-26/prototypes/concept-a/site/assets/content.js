/* Concept A content group: TOC, FAQ palette + topics, methodology filters, guide tools. Uses window.ty. */
(function () {
  "use strict";
  var ty = window.ty, d = document, w = window;
  if (!ty) return;
  var $ = ty.$, $$ = ty.$$, on = ty.on;
  var esc = function (s) { var e = d.createElement("i"); e.textContent = s; return e.innerHTML; };
  var shown = function (el) { var s = el.closest("[data-show]"); return !s || getComputedStyle(s).display !== "none"; };
  var raf = function (fn) { var t = false; return function () { if (t) return; t = true; requestAnimationFrame(function () { t = false; fn(); }); }; };
  function arrive(el) { if (!el) return; el.classList.remove("is-arrived"); void el.offsetWidth; el.classList.add("is-arrived"); }

  $$("[data-toc]").forEach(function (nav) {
    var links = $$("[data-toc-link]", nav), ink = $(".toc-ink", nav), btn = $(".toc-toggle", nav), cur = -2;
    var secs = links.map(function (a) { return d.getElementById(a.getAttribute("data-toc-link")); });
    function paint(i) {
      if (i === cur) return;
      cur = i;
      links.forEach(function (a, k) { if (k === i) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
      if (!ink) return;
      if (i < 0) { ink.style.opacity = "0"; return; }
      var a = links[i];
      ink.style.opacity = "1";
      ink.style.transform = "translateY(" + a.offsetTop + "px) scaleY(" + a.offsetHeight / 100 + ")";
    }
    var pick = raf(function () {
      var line = w.innerHeight * 0.32, i = -1;
      secs.forEach(function (s, k) { if (s && s.getBoundingClientRect().top <= line) i = k; });
      paint(i);
    });
    on(w, "scroll", pick, { passive: true });
    on(w, "resize", function () { cur = -2; pick(); });
    pick();
    if (btn) {
      on(btn, "click", function () {
        var open = btn.getAttribute("aria-expanded") !== "true";
        btn.setAttribute("aria-expanded", String(open));
        nav.classList.toggle("is-open", open);
      });
      links.forEach(function (a) { on(a, "click", function () { if (nav.classList.contains("is-open")) btn.click(); }); });
    }
  });

  var art = $("[data-guide-body]");
  if (art) {
    var read = false;
    on(w, "scroll", raf(function () {
      if (read) return;
      var r = art.getBoundingClientRect();
      if ((w.innerHeight - r.top) / r.height >= 0.75) { read = true; ty.track("guide_read", { depth: 75 }); }
    }), { passive: true });
  }

  var C = w.tyCalc;
  var num = function (el, lo, hi, fb) { var v = el && el.value.trim() !== "" ? +el.value : NaN; return isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : fb; };
  var bucket = function (p) { return p < 150 ? "<150" : p < 250 ? "150-249" : p < 400 ? "250-399" : "400+"; };
  function firstUse(box, calc, props) {
    if (box._used) return;
    box._used = true;
    props.calc = calc;
    props.where = "guide";
    ty.track("calc_input", props);
    var res = $(".calc-window", box), io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); ty.track("calc_result_view", props); } }, { threshold: 0.3 });
    if (res) io.observe(res);
  }
  if (C) {
    $$("[data-mini-earn]").forEach(function (box) {
      var price = $('[name="price"]', box), subs = $('[name="subs"]', box), go = $("[data-mini-go]", box), live = $("[data-live]", box);
      on(box, "input", function () {
        var p = num(price, 1, 10000, 199), n = num(subs, 0, 100000, 60), e = C.compactEarnings(n, p, 250);
        ty.swap($(".me-net", box), C.aed(e.beforeOtherCostsMinor));
        ty.swap($(".me-pct", box), C.pct(e.effectiveCommissionPct, 2));
        ty.swap($(".me-subs", box), C.aed(e.subscriptionMonthlyMinor));
        ty.swap($(".me-comm", box), "− " + C.aed(e.commissionMinor));
        if (go) go.setAttribute("href", "earnings-calculator.html?price=" + p + "&subs=" + n);
        ty.announce(live, C.aed(e.beforeOtherCostsMinor) + " a month before other costs and tax, at AED " + p + " with " + n + " paying subscribers.");
        firstUse(box, "earnings", { price_bucket: bucket(p) });
      });
    });
    $$("[data-mini-follow]").forEach(function (box) {
      var f = $('[name="followers"]', box), live = $("[data-live]", box);
      on(box, "input", function () {
        var n = num(f, 0, 10000000, 7000), est = C.estimateFollowers(Object.assign({}, C.FOLLOWER_DEFAULTS, { followers: n })), s = est.scenarios, max = Math.max(1, s.strong.revenueMonth12Minor);
        ["cautious", "typical", "strong"].forEach(function (k) {
          var v = s[k].revenueMonth12Minor, lane = $('[data-lane="' + k + '"]', box);
          ty.swap($(".mfl-" + k, box), C.aed(v));
          if (lane) $(".calc-lane-bar span", lane).style.setProperty("--v", (v / max).toFixed(4));
        });
        ty.swap($(".mf-strong", box), C.aed(s.strong.revenueMonth12Minor));
        ty.announce(live, "Up to " + C.aed(s.strong.revenueMonth12Minor) + " a month in the best case, " + C.aed(s.typical.revenueMonth12Minor) + " typical, for " + C.whole(n) + " followers.");
        firstUse(box, "followers", { price_bucket: bucket(199) });
      });
    });
  }

  var groups = $("[data-faq-groups]");
  if (groups) {
    var tl = $('[role="tablist"]', groups), ink = $(".faq-ink", groups);
    var inkTo = function (tab) {
      if (!tab || !ink) return;
      ink.style.transform = "translateX(" + tab.offsetLeft + "px) scaleX(" + tab.offsetWidth / 100 + ")";
      var l = tab.offsetLeft, r = l + tab.offsetWidth;
      if (l < tl.scrollLeft || r > tl.scrollLeft + tl.clientWidth) tl.scrollLeft = Math.max(0, l - 16);
    };
    var sel = function () { return $('[aria-selected="true"]', tl); };
    on(groups, "ty:tab", function (e) { inkTo(e.detail.tab); });
    inkTo(sel());
    requestAnimationFrame(function () { ink.classList.add("is-ready"); });
    on(w, "resize", raf(function () { inkTo(sel()); }));
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { inkTo(sel()); });
  }
  function openItem(item, focus) {
    if (!item) return;
    var panel = item.closest('[role="tabpanel"]');
    if (groups && panel && groups.tySelect) {
      var tabs = $$('[role="tab"]', groups);
      for (var i = 0; i < tabs.length; i++) if (tabs[i].getAttribute("aria-controls") === panel.id) groups.tySelect(i);
    }
    var b = $(".faq-q button", item);
    if (b && b.getAttribute("aria-expanded") !== "true") b.click();
    item.scrollIntoView({ block: "start" });
    if (focus && b) b.focus({ preventScroll: true });
    arrive(item);
    try { history.replaceState(null, "", "#" + item.id); } catch (e) { }
  }
  var hashItem = function () { var id = location.hash.slice(1); var el = id && d.getElementById(id); return el && el.hasAttribute("data-faq-item") ? el : null; };
  if (hashItem()) on(w, "load", function () { openItem(hashItem(), false); });
  on(w, "hashchange", function () { if (hashItem()) openItem(hashItem(), false); });

  var pal = $("[data-palette]");
  if (pal) {
    var input = $("input", pal), list = $(".pal-list", pal), label = $(".pal-label", pal), empty = $(".pal-empty", pal), count = $("[data-pal-count]", pal), plive = $("[data-live]", pal);
    var suggest = (pal.getAttribute("data-suggest") || "").split(" "), items = [], view = [], active = -1, arrow = $(".ic", list).outerHTML;
    list.setAttribute("role", "listbox");
    var index = function () {
      items = $$("[data-faq-item]").filter(shown).map(function (it) {
        var panel = it.closest('[role="tabpanel"]');
        var a = $$(".faq-a p, .faq-a li", it).filter(shown).map(function (p) { return p.textContent.replace(/\s+/g, " ").trim(); }).join(" ");
        return { el: it, id: it.id.slice(2), q: $(".faq-q span", it).textContent.trim(), a: a, g: panel ? panel.getAttribute("data-group") : "" };
      });
      count.textContent = items.length + " questions";
      input.setAttribute("placeholder", "Search " + items.length + " questions");
    };
    var mark = function (text, terms) {
      var out = esc(text);
      terms.forEach(function (t) { var e = esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); if (e) out = out.replace(new RegExp("(" + e + ")(?![^<]*>)", "gi"), '<mark class="hl">$1</mark>'); });
      return out;
    };
    var snippet = function (a, t) {
      var i = a.toLowerCase().indexOf(t);
      if (i < 0) return "";
      var s = Math.max(0, i - 36), e = Math.min(a.length, i + t.length + 60);
      return (s ? "…" : "") + a.slice(s, e) + (e < a.length ? "…" : "");
    };
    function render(announce) {
      var q = input.value.trim().toLowerCase(), terms = q.split(/\s+/).filter(Boolean);
      if (!terms.length) view = suggest.map(function (id) { return items.filter(function (x) { return x.id === id; })[0]; }).filter(Boolean);
      else view = items.map(function (it) {
        var ql = it.q.toLowerCase(), hay = ql + " " + it.a.toLowerCase() + " " + it.g.toLowerCase(), s = 0;
        for (var i = 0; i < terms.length; i++) { if (hay.indexOf(terms[i]) < 0) return null; s += ql.indexOf(terms[i]) >= 0 ? 3 : 1; }
        return { it: it, s: s };
      }).filter(Boolean).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.it; });
      var top = view.slice(0, 5);
      label.textContent = terms.length ? (view.length ? view.length + (view.length === 1 ? " match" : " matches") + (view.length > 5 ? " · top 5" : "") : "No matches") : "Suggested";
      list.hidden = !top.length;
      empty.hidden = !!top.length;
      if (!top.length) $("[data-pal-term]", empty).textContent = input.value.trim();
      list.innerHTML = top.map(function (it, i) {
        var t0 = terms[0], inQ = !t0 || it.q.toLowerCase().indexOf(t0) >= 0, sn = inQ ? "" : snippet(it.a, t0);
        return '<li role="presentation"><a class="pal-opt" role="option" id="pal-o' + i + '" href="#' + it.el.id + '" tabindex="-1" aria-selected="false" data-i="' + i + '"><span class="pal-g">' + esc(it.g) + '</span><span class="pal-t">' + mark(it.q, terms) + "</span>" + (sn ? '<span class="pal-s">' + mark(sn, terms) + "</span>" : "") + arrow + "</a></li>";
      }).join("");
      setActive(terms.length && top.length ? 0 : -1);
      if (announce) ty.announce(plive, terms.length ? (view.length ? view.length + " questions match" : "No questions match") : "Suggested questions");
    }
    function setActive(i) {
      var opts = $$(".pal-opt", list);
      active = opts.length ? Math.max(-1, Math.min(opts.length - 1, i)) : -1;
      opts.forEach(function (o, k) { o.setAttribute("aria-selected", String(k === active)); });
      if (active >= 0) input.setAttribute("aria-activedescendant", opts[active].id);
      else input.removeAttribute("aria-activedescendant");
    }
    function choose(i) {
      var it = view[i];
      if (it) openItem(it.el, true);
    }
    on(input, "input", function () { render(true); });
    on(input, "keydown", function (e) {
      var n = $$(".pal-opt", list).length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (n) setActive(active < 0 ? (e.key === "ArrowDown" ? 0 : n - 1) : (active + (e.key === "ArrowDown" ? 1 : -1) + n) % n); }
      else if (e.key === "Enter") { e.preventDefault(); choose(active < 0 ? 0 : active); }
      else if (e.key === "Escape" && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ""; render(true); }
    });
    on(list, "click", function (e) {
      var o = e.target.closest(".pal-opt");
      if (!o) return;
      e.preventDefault();
      choose(+o.getAttribute("data-i"));
    });
    on(list, "mousemove", function (e) { var o = e.target.closest(".pal-opt"); if (o && +o.getAttribute("data-i") !== active) setActive(+o.getAttribute("data-i")); });
    $$("[data-pal-try]", pal).forEach(function (b) { on(b, "click", function () { input.value = b.getAttribute("data-pal-try"); render(true); input.focus(); }); });
    on(d, "keydown", function (e) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target, tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
      e.preventDefault();
      input.focus();
    });
    on(d, "ty:flags", function () { index(); render(false); });
    index();
    render(false);
  }

  var srcList = $("[data-sources]"), filt = $("[data-src-filters]");
  if (srcList && filt) {
    var rows = $$(".src", srcList), chips = $$("[data-fam]", filt), pageSel = $("select", filt), cnt = $("[data-src-count]", filt), flive = $("[data-live]", filt), fam = "all";
    var apply = function (say) {
      var pg = pageSel.value, n = 0;
      rows.forEach(function (r) {
        var ok = (fam === "all" || r.getAttribute("data-family") === fam) && (pg === "all" || (" " + r.getAttribute("data-pages") + " ").indexOf(" " + pg + " ") >= 0);
        r.hidden = !ok;
        if (ok) n++;
      });
      chips.forEach(function (c) { c.setAttribute("aria-pressed", String(c.getAttribute("data-fam") === fam)); });
      cnt.textContent = n;
      if (say) ty.announce(flive, n + " of " + rows.length + " sources shown");
    };
    chips.forEach(function (c) { on(c, "click", function () { fam = c.getAttribute("data-fam"); apply(true); }); });
    on(pageSel, "change", function () { apply(true); });
    var land = function () {
      var id = decodeURIComponent(location.hash.slice(1)), el = id && d.getElementById(id);
      if (!el) return;
      if (el.classList.contains("src") && el.hidden) { fam = "all"; pageSel.value = "all"; apply(false); el.scrollIntoView({ block: "start" }); }
      var target = el.classList.contains("arrive") ? el : $("[data-arrive]", el);
      arrive(target);
    };
    on(w, "hashchange", land);
    land();
  }

  if ($('[lang="ar"]', d.body)) {
    var l = d.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap";
    d.head.appendChild(l);
  }

  var miss = $("[data-miss-path]");
  if (miss && !/\/404\.html$/.test(location.pathname)) miss.textContent = decodeURIComponent(location.pathname.split("/").pop() || "/");
})();
