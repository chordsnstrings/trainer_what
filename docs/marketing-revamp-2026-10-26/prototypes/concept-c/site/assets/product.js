/* Concept C product pages (product builder). Uses window.ty (site.js).
   Figures play one change once; widgets crossfade values; nothing loops. */
(() => {
  "use strict";
  const ty = window.ty;
  if (!ty) return;
  const d = document;
  const $ = (s, r) => (r || d).querySelector(s);
  const $$ = (s, r) => [...(r || d).querySelectorAll(s)];
  const slot = (r, k) => $(`[data-vx="${k}"]`, r);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const restart = (el, c) => { el.classList.remove(c); void el.offsetWidth; el.classList.add(c); };
  const say = (id, t) => ty.announce($("#" + id), t);

  /* Figures: one state change, once (hero after load, others on view) */
  const plays = $$("[data-play]");
  const play = (el, ms) => setTimeout(() => el.classList.add("is-played"), ms);
  const arm = () => plays.forEach((el) => {
    if (el.closest("[data-hero]") && ty.inView(el)) return play(el, 450);
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= innerHeight * 0.4)) { io.disconnect(); play(el, 300); }
    }, { threshold: [0, 0.25, 0.5] });
    io.observe(el);
  });
  d.readyState === "complete" ? arm() : addEventListener("load", arm);
  ty.onReplay(() => plays.forEach((el) => { if (el.closest("[data-hero]")) { el.classList.remove("is-played"); void el.offsetWidth; play(el, 350); } }));

  /* How it works: the manual's contents act as vertical tabs */
  $$("[data-manual]").forEach((root) => {
    const fill = $(".sl-fill", root), list = $('[role="tablist"]', root), n = $$('[role="tab"]', root).length;
    let at = 0;
    const api = ty.wireTabs(root, (i, t) => {
      at = i;
      fill.style.strokeDashoffset = String(100 - (100 * (i + 1)) / n);
      ty.swap(slot(root, "man"), String(i + 1));
      if (list.scrollWidth > list.clientWidth + 2) list.scrollTo({ left: Math.max(0, t.offsetLeft - 16), behavior: "smooth" });
    });
    $$("[data-man-step]", root).forEach((b) => on(b, "click", () => api.select(Math.max(0, Math.min(n - 1, at + +b.dataset.manStep)))));
  });

  /* Trainer Brain: confirm, edit or reject a rule */
  const rv = $("[data-rule-review]");
  if (rv) {
    const card = $("#tb-rule"), ed = $("#tb-edit"), ta = $("#tb-edit-in"), btn = (k) => $(`[data-rc="${k}"]`, rv);
    const stage = (s) => $$("[data-rc-step]", rv).forEach((x) => { x.hidden = x.dataset.rcStep !== s; });
    const done = (m) => { $("[data-rc-msg]", rv).textContent = m; ed.hidden = true; btn("edit").setAttribute("aria-expanded", "false"); stage("done"); say("tb-live", m); btn("undo").focus(); };
    const reset = () => { ty.resetRule(card); card.classList.remove("is-rejected"); stage("pending"); };
    on(rv, "click", (e) => {
      const b = e.target.closest("[data-rc]");
      if (!b) return;
      const k = b.dataset.rc;
      if (k === "confirm") { ty.confirmRule(card); done("Confirmed. Your AI can use this rule from its next tested release."); ty.track("demo_rule_edit", { field: "confirm", location: "trainer-brain" }); }
      else if (k === "reject") { card.classList.add("is-rejected"); ty.swap(slot(card, "rule-status"), '<span class="rc-state rc-state--no">Rejected · not used</span>', { html: true }); done("Rejected. It won’t be used. The source stays on file."); }
      else if (k === "edit") { const o = ed.hidden; ed.hidden = !o; b.setAttribute("aria-expanded", String(o)); if (o) ta.focus(); }
      else if (k === "save") {
        if (ta.value.trim()) $(".rc-text", card).textContent = ta.value.trim();
        ed.hidden = true; btn("edit").setAttribute("aria-expanded", "false"); btn("edit").focus();
        say("tb-live", "Wording saved. It keeps its source.");
        ty.track("demo_rule_edit", { field: "wording", location: "trainer-brain" });
      } else if (k === "undo") { reset(); btn("confirm").focus(); say("tb-live", "Back to waiting for your OK."); }
    });
    ty.onReplay(reset);
  }

  /* Trainer Brain: release rollback, blind comparison */
  $$("[data-releases]").forEach((r) => {
    let at = 3;
    on($("[data-rel-toggle]", r), "click", () => {
      at = at === 3 ? 2 : 3;
      $(".pd-rel-live", r).style.setProperty("--at", at);
      $$(".pd-rel-list li", r).forEach((li, i) => li.classList.toggle("is-live", i === at));
      const s = at === 3 ? "Live: v4 · passed your test cases" : "Live: v3 · rolled back from v4";
      ty.swap(slot(r, "rel"), s);
      ty.swap(slot(r, "rel-btn"), at === 3 ? "Roll back to v3" : "Restore v4");
      say("rel-live", s);
    });
  });
  $$("[data-compare]").forEach((c) => {
    let shown = false;
    const b = $("[data-cmp-reveal]", c);
    on(b, "click", () => {
      shown = !shown;
      ty.swap(slot(c, "cmp-a"), shown ? "Your AI" : "Reply A");
      ty.swap(slot(c, "cmp-b"), shown ? "Your reply" : "Reply B");
      b.textContent = shown ? "Hide sources" : "Reveal which is yours";
      say("cmp-live", shown ? "Reply A is your AI. Reply B is your reply." : "Sources hidden.");
    });
  });

  /* Features: capability disclosures, opened by #cap-… links too */
  const cap = (q, force) => {
    const o = force ?? q.getAttribute("aria-expanded") !== "true";
    q.setAttribute("aria-expanded", String(o));
    q.closest(".pd-cap").classList.toggle("is-open", o);
  };
  $$(".pd-cap-q").forEach((q) => on(q, "click", () => cap(q)));
  const hash = () => { const m = location.hash.match(/^#cap-([a-z]+)$/), q = m && $(`#cap-${m[1]}-q`); if (q) cap(q, true); };
  addEventListener("hashchange", hash); hash();

  /* Subscriber app: the Arabic face loads only for the RTL preview */
  ty.onFlags((f) => {
    if (f["rtl-preview"] !== "on" || $("#pd-ar") || !$("[data-rtl-vignette]")) return;
    d.head.insertAdjacentHTML("beforeend", '<link id="pd-ar" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;600&display=swap">');
  });

  /* Demo: four worked examples */
  const demo = $("[data-demo]");
  if (demo) {
    on($("[data-tabs]", demo), "ty:tab", (e) => {
      const w = $$(".pd-worked", demo)[e.detail.index];
      restart(w, "pd-run");
      ty.track("demo_play", { scenario: w.dataset.decision });
      say("dec-live", `Example ${e.detail.index + 1}: ${$(".pd-wk-out .pd-b", w).textContent}.`);
    });
    const result = (w, m, ok) => { const r = $("[data-result]", w); w.classList.toggle("is-confirmed", !!ok); r.textContent = m; r.hidden = false; say("dec-live", m); };
    on(demo, "click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const w = b.closest(".pd-worked"), k = b.dataset.act, fix = $(".pd-fix", w), c = $('[data-act="correct"]', w);
      if (k === "correct") { const o = fix.hidden; fix.hidden = !o; b.setAttribute("aria-expanded", String(o)); w.classList.remove("is-confirmed"); if (o) $("input", fix).focus(); return; }
      if (fix) { fix.hidden = true; c.setAttribute("aria-expanded", "false"); }
      result(w, { confirm: "Confirmed. Your OK is recorded and teaches the next release.", resume: "Training resumes, with your note to the subscriber.", keep: "Kept paused. The subscriber sees your note, and training waits." }[k], k === "confirm");
      ty.track("demo_rule_edit", { scenario: w.dataset.decision, field: k });
    });
    on(demo, "change", (e) => {
      if (!e.target.matches(".pd-fix input")) return;
      const w = e.target.closest(".pd-worked");
      result(w, `Your correction: “${e.target.value}”. It becomes a suggested rule for you to confirm.`);
      ty.track("demo_rule_edit", { scenario: w.dataset.decision, field: "correction", value: e.target.value });
    });
  }

  /* Demo: change the rule (deterministic, same three logged sessions) */
  const rb = $("[data-rule-builder]");
  if (rb) {
    const LOG = [2, 3, 3], W = ["no", "one", "two", "three", "four", "five", "six"];
    const LIM = { sessions: [1, 6, 1], rir: [0, 5, 1], kg: [0.5, 10, 0.5] };
    const fmt = (n) => String(Math.round(n * 100) / 100);
    const val = (k) => { const [lo, hi, st] = LIM[k], i = $("#rb-" + k); let v = Number(i.value); if (i.value === "" || !isFinite(v)) v = lo; return Math.min(hi, Math.max(lo, Math.round(v / st) * st)); };
    const applied = $('[data-vx="rb-chip"] > span', rb).innerHTML;
    const upd = () => {
      const s = val("sessions"), r = val("rir"), kg = val("kg");
      let n = 0;
      for (let i = LOG.length - 1; i >= 0 && LOG[i] >= r; i--) n++;
      LOG.forEach((v, j) => ty.swap(slot(rb, "easy-" + j), v >= r ? "Easy" : "—"));
      ty.swap(slot(rb, "sessions"), String(s)); ty.swap(slot(rb, "rir"), String(r)); ty.swap(slot(rb, "kg"), fmt(kg));
      const ok = n >= s, m = s - n, have = `${W[n][0].toUpperCase() + W[n].slice(1)} easy session${n === 1 ? "" : "s"} in a row. Your rule needs ${W[s]}.`;
      const out = ok ? `Applied: 60 → ${fmt(60 + kg)} kg` : n ? `Not yet: ${W[m]} more easy session${m > 1 ? "s" : ""}` : "Not yet: no easy sessions";
      const why = ok || n ? have : `No logged session had ${r}+ reps in reserve.`;
      ty.swap(slot(rb, "outcome"), out); ty.swap(slot(rb, "why"), why);
      ty.swap(slot(rb, "rb-chip"), ok ? applied : '<span class="chip chip--neutral">No change yet</span>', { html: true });
      say("rb-live", `${out}. ${why}`);
    };
    const track = (k) => ty.track("demo_rule_edit", { field: k, value: val(k) });
    on(rb, "input", ty.debounce((e) => { if (e.target.matches("[data-rule]")) upd(); }, 90));
    on(rb, "change", (e) => { if (!e.target.matches("[data-rule]")) return; const k = e.target.dataset.rule; e.target.value = fmt(val(k)); upd(); track(k); });
    on(rb, "click", (e) => {
      const b = e.target.closest("[data-num]");
      if (!b) return;
      const i = $("#" + b.getAttribute("aria-controls")), k = i.dataset.rule, [lo, hi, st] = LIM[k];
      i.value = fmt(Math.min(hi, Math.max(lo, val(k) + b.dataset.num * st)));
      upd(); track(k);
    });
  }

  /* Demo: how sure must it be? (the squat decision is 86% sure) */
  const th = $("[data-threshold]");
  if (th) {
    const rg = $("#thr-range", th);
    on(rg, "input", () => {
      const v = +rg.value, ok = 86 >= v, t = `${v}%: ${ok ? "86% clears it, applied automatically" : "unsure, goes to you"}`;
      rg.style.setProperty("--p", ((v - 60) / 35) * 100 + "%");
      ty.swap(slot(th, "thr"), v + "%");
      ty.swap(slot(th, "thr-out"), ok ? "Applied automatically" : "Unsure → to you");
      ty.swap(slot(th, "thr-why"), ok ? `86% clears your ${v}% bar.` : `86% is below your ${v}% bar, so a draft comes to you.`);
      $$("[data-lanes] [data-lane]", th).forEach((li) => {
        const act = li.dataset.lane === (ok ? "applied" : "toyou"), was = li.classList.contains("is-active");
        li.classList.toggle("is-active", act);
        if (act && !was) restart(li, "pd-lane-in");
      });
      rg.setAttribute("aria-valuetext", t);
      say("thr-live", t);
    });
    on(rg, "change", () => ty.track("demo_threshold", { value: +rg.value }));
  }
})();
