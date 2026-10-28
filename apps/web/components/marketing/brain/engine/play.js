/* The playground's runtime ("Throw a moment at your Brain", /trainer-brain
   and /demo): it adopts the server's first frame (play.render.js), plays a
   moment's steps at their recorded timings on the scene's clock, and keeps
   the steps, the result and the settings in step. The edges, the route, the
   dot and the nodes' 3×3 matrices are one canvas over the diagram, on the
   engine's one loop.

   Ported from the approved prototype's runtime half (docs/marketing-revamp-
   2026-10-26/prototypes/shared/brain/brain-play.js) with the changes of
   docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.1 and WP3b:
   - its CSS is a static import (play.run.css); it adopts the markup instead
     of rebuilding it, enables the controls it wires and adds what only it
     shows (the canvas, the skip link, the stamp, the "Throw them all" box);
   - mount() sets data-sc="on" and data-sc-tier (the prototype removed
     data-sc); destroy() undoes its listeners, observers, timers, scene and
     overlay layer;
   - nothing moves in layout once it plays: a run writes its result when it
     starts (the visitor's click) and shows it when it ends; the totals, the
     Pause label, the node values and the log keep their space;
   - attract (an option) plays the first moment once, when the stage is well
     in view and nobody has used the playground yet; never under reduced
     motion or from a settled frame, and it announces nothing;
   - free text finds the closest sample through the local keyword table only
     (no safety rules in the browser, the owner's default);
   - the page's one live region (core.js say()), none of its own;
   - run(traceId) plays a moment on request (brain/mount.tsx: sc:run and
     a[data-run] links). */
import "./play.run.css";
import raw from "../data/traces.client.json";
import * as C from "./core.js";
import { prepare } from "./data.js";
import { decide, defaults, pick, totals } from "./decide.js";
import * as U from "./ui.js";
import { COACH, COPY, FIRST, RES, SPECS, closest, controlsHTML, hlText, isPick, kindTag, msgHTML, picksRow, resultHTML, stateOf, sureVal } from "./play.render.js";
const { h, esc } = C;

const COL = { text: "#F3F4F0", line: "#3A3F39", lime: "#D5F24A", ink: "#171917", red: "#F08A80", amber: "#E0B25C", green: "#7FCB9F" };

/** Listeners and timers a showcase owns, all undone by clear(). */
function owned() {
  const offs = [], timers = new Set();
  return {
    on(el, ev, fn, opt) { el.addEventListener(ev, fn, opt); offs.push(() => el.removeEventListener(ev, fn, opt)); },
    later(fn, ms) { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; },
    add(fn) { offs.push(fn); },
    clear() { timers.forEach(clearTimeout); timers.clear(); offs.splice(0).forEach((f) => f()); },
  };
}
const plen = (p) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
/** The point at k (0..1) along a polyline. */
function along(p, k) {
  let L = plen(p) * k;
  for (let i = 1; i < p.length; i++) {
    const s = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (L <= s || i == p.length - 1) { const f = s ? Math.min(1, L / s) : 1; return [C.lerp(p[i - 1][0], p[i][0], f), C.lerp(p[i - 1][1], p[i][1], f)]; }
    L -= s;
  }
  return p[p.length - 1];
}
/** Strokes a polyline from its start to k (0..1). */
function stroke(c, p, k) {
  const L = plen(p) * k;
  let acc = 0;
  c.beginPath(); c.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) {
    const s = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (acc + s >= L) { const f = s ? (L - acc) / s : 1; c.lineTo(C.lerp(p[i - 1][0], p[i][0], f), C.lerp(p[i - 1][1], p[i][1], f)); break; }
    c.lineTo(p[i][0], p[i][1]); acc += s;
  }
  c.stroke();
}
/** Straight when level, else down (or up) to halfway, across, then on. */
const route = (a, b) => {
  if (Math.abs(a[1] - b[1]) < 6) return [a, b];
  const my = b[1] > a[1] ? a[1] + (b[1] - a[1]) / 2 : b[1] + (a[1] - b[1]) / 2;
  return [a, [a[0], my], [b[0], my], b];
};

/** Mounts on the root (brain/mount.tsx calls it after load, idle and near). */
export async function mount(root, o) {
  const d = prepare(raw, o), S = defaults(d), RM = C.reduced(), L = C.layer(root), k = owned();
  const $ = (s, r = root) => r.querySelector(s), $$ = (s, r = root) => [...r.querySelectorAll(s)];
  const stage = $(".bp-stage"), dia = $(".bp-diagram"), shell = $(".bp-shell"), kindEl = $(".bp-kind"), logOl = $(".bp-logs ol");
  const res = $(".bp-res"), ctls = $(".bp-ctls"), change = $(".bp-change"), again = $(".bp-again"), out = $(".bp-out"), chips = $(".bp-chips");
  const msgBox = () => $(".bp-msg");
  // What only the engine shows: none of it takes space in the frame.
  const cv = h("canvas.bp-cv", { "aria-hidden": "true" }), allBox = h("div.bp-all", { hidden: true });
  const noai = h("div.bp-noai", { hidden: true }, d.labels.noAi), stamp = h("div.bp-stamp", { hidden: true }, COPY.stop);
  const skip = h("a.bp-skip", { href: "#" + out.id, hidden: true }, COPY.skip);
  let sc = null, sub = null, dead = false;

  /* ---------------- geometry (read on resize only) */
  let G = null, ctx = null, edges = null, dirty = true, font = "", fitted = "";
  const nodeEl = (sp) => (sp == "code" ? $(".bp-priv") : $(`.bp-diagram .sc-node[data-sp="${sp}"]`));
  function measure() {
    const b = dia.getBoundingClientRect();
    if (!b.width) return;
    const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height, cx: r.left - b.left + r.width / 2, cy: r.top - b.top + r.height / 2, r: r.right - b.left, b: r.bottom - b.top }; };
    G = { w: b.width, h: b.height, n: {}, mx: {}, bins: {}, ai: {}, rtl: getComputedStyle(dia).direction == "rtl" };
    $$(".sc-node", dia).forEach((e) => { const sp = e.dataset.sp; G.n[sp] = R(e); const m = e.querySelector(".sc-mx"); if (m && !e.hasAttribute("data-off")) G.mx[sp] = R(m); G.ai[sp] = e.dataset.kind == "ai"; });
    $$(".bp-bin", dia).forEach((e) => (G.bins[e.dataset.lane] = R(e)));
    G.idx = {}; Object.keys(G.mx).forEach((sp, i) => (G.idx[sp] = i));
    G.font = font || (font = "600 11px " + (getComputedStyle(stage).getPropertyValue("--sc-mono").trim() || "monospace"));
    G.msg = R(msgBox()); G.shell = R(shell); G.book = R($(".bp-book")); G.kind = R(kindEl.hidden ? $(".bp-sh-h b") : kindEl); G.lanes = R($(".bp-lanes"));
    const size = [G.w, G.h, C.tier.name].join();
    if (!ctx || size != fitted) (ctx = C.fit(cv, G.w, G.h)), (fitted = size);
    dirty = false;
    drawEdges();
    paint();
  }
  // geometry is read again on the next frame (layout is due then anyway), never mid-handler
  const need = () => { dirty = true; RM || !sub ? measure() : sub.wake(); };
  function drawEdges() {
    const { cv: c2, c } = C.bitmap(G.w, G.h), n = G.n;
    c.strokeStyle = COL.line; c.lineWidth = 1;
    const seg = (pts) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); };
    const row = (ids) => ids.forEach((id, i) => i && Math.abs(n[ids[i - 1]].cy - n[id].cy) < 4 && (G.rtl ? n[id].r < n[ids[i - 1]].x : n[id].x > n[ids[i - 1]].r) &&
      seg(G.rtl ? [[n[ids[i - 1]].x, n[id].cy], [n[id].r, n[id].cy]] : [[n[ids[i - 1]].r, n[id].cy], [n[id].x, n[id].cy]]));
    seg([[n.safety.cx, G.msg.b], [n.safety.cx, n.safety.y]]);
    row(["safety", "topics", "memory", "rule_finder"]); row(["checker", "confidence", "lane_gate"]); row(["learner", "examiner"]); row(["code", "learner"]);
    seg([[n.rule_finder.cx, n.rule_finder.b], [n.rule_finder.cx, G.shell.y]]);
    seg([[n.checker.cx, G.shell.b], [n.checker.cx, n.checker.y]]);
    const ly = G.lanes.y - 8;
    seg([[n.lane_gate.cx, n.lane_gate.b], [n.lane_gate.cx, ly]]);
    seg([[G.bins.sent.cx, ly], [G.bins.paused.cx, ly]]);
    for (const l in G.bins) seg([[G.bins[l].cx, ly], [G.bins[l].cx, G.bins[l].y]]);
    edges = c2;
  }

  /* ---------------- canvas state */
  const st = {}; // sp → {s, t0}
  let lines = [], dot = null, trail = [], clock = 0, mode = "one", runTl = null, runEnd = null, allTl = null, allEnd = null;
  const setNode = (sp, s) => {
    const e = nodeEl(sp);
    if (e) e.dataset.state = s;
    st[sp] = { s, t0: clock };
    if (RM) paint();
  };
  function matrix(c, sp, now) {
    const m = G.mx[sp], e = st[sp] || { s: nodeEl(sp) ? nodeEl(sp).dataset.state : "idle", t0: -1e9 }, ai = G.ai[sp], age = clock - e.t0, idx = G.idx[sp];
    let col = COL.text, on = () => 1;
    const s = e.s;
    if (s == "idle") { const a = RM ? 0.25 : 0.25 + 0.07 * Math.sin(((now + idx * 230) / 2800) * Math.PI * 2); on = () => a; }
    else if (s == "work" && ai) { col = COL.ink; const f = Math.floor(age / 90), r = C.rng(f * 31 + idx), lit = new Set([...Array(3 + Math.floor(r() * 3))].map(() => Math.floor(r() * 9))); on = (i) => (lit.has(i) ? 1 : 0.15); }
    else if (s == "work") { const colN = Math.floor(age / 80) % 3; on = (i) => (i % 3 == colN ? 1 : 0.2); }
    else if (s == "hit") { col = COL.red; on = () => (age < 480 && Math.floor(age / 120) % 2 ? 0.15 : 1); }
    else if (s == "skip") on = () => 0.12;
    else if (s == "warn" || s == "waits") col = COL.amber;
    else if (s == "paused") col = COL.red;
    else if (s == "sent") col = COL.green;
    else if (s == "lit") col = COL.ink;
    c.fillStyle = col;
    for (let i = 0; i < 9; i++) {
      c.globalAlpha = on(i);
      const x = m.x + 3 + (i % 3) * 5, y = m.y + 3 + Math.floor(i / 3) * 5;
      if (ai) { c.beginPath(); c.arc(x, y, 1.5, 0, 6.283); c.fill(); } else c.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    c.globalAlpha = 1;
  }
  function paint(now = performance.now()) {
    if (!G || !ctx) return;
    const c = ctx;
    c.clearRect(0, 0, G.w, G.h);
    if (mode == "all") return;
    c.drawImage(edges, 0, 0, G.w, G.h);
    // the run's route, dashed and moving (one dash animation)
    if (dot && dot.keys && !RM) {
      c.save(); c.strokeStyle = COL.lime; c.globalAlpha = 0.28; c.setLineDash([3, 3]); c.lineDashOffset = -((now / 1600) * 6) % 6;
      c.beginPath(); for (const q of dot.keys) if (!q.red) q.p().forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); c.restore();
    }
    for (const l of lines) {
      const a = clock - l.t0;
      if (a < 0) continue;
      const q = Math.min(1, a / l.draw), fade = a > l.draw + l.hold ? 1 - (a - l.draw - l.hold) / l.fade : 1;
      if (fade <= 0) continue;
      c.save(); c.globalAlpha = Math.max(0, fade); c.strokeStyle = l.col; c.lineWidth = l.w || 1.5;
      const P = typeof l.p == "function" ? l.p() : l.p;
      stroke(c, P, l.ease ? C.ease.in(q) : C.ease.out(q));
      if (l.label && q >= 1) { c.fillStyle = l.col; c.font = G.font; c.textAlign = G.rtl ? "end" : "start"; c.fillText(l.label, P[P.length - 1][0] + (G.rtl ? -6 : 6), P[P.length - 1][1] - 6); }
      c.restore();
    }
    lines = lines.filter((l) => clock - l.t0 < l.draw + l.hold + l.fade || l.keep);
    for (const sp in G.mx) matrix(c, sp, now);
    if (dot && dot.pos && !RM) {
      c.save(); c.strokeStyle = COL.lime; c.lineWidth = 1.5;
      for (let i = 1; i < trail.length; i++) { const a = 1 - (clock - trail[i][2]) / 600; if (a <= 0) continue; c.globalAlpha = a; c.beginPath(); c.moveTo(trail[i - 1][0], trail[i - 1][1]); c.lineTo(trail[i][0], trail[i][1]); c.stroke(); }
      const [x, y] = dot.pos;
      if (C.tier.spec.halos) { const g = c.createRadialGradient(x, y, 0, x, y, 14); g.addColorStop(0, "rgba(213,242,74,.25)"); g.addColorStop(1, "rgba(213,242,74,0)"); c.globalAlpha = 1; c.fillStyle = g; c.fillRect(x - 14, y - 14, 28, 28); }
      c.globalAlpha = 1; c.fillStyle = dot.red ? COL.red : COL.lime; c.beginPath(); c.arc(x, y, 4, 0, 6.283); c.fill(); c.restore();
    }
  }

  /* ---------------- the dot: keyframes along the run's route */
  function moveDot() {
    const K = dot.keys, t = runTl ? runTl.t : Infinity;
    const i = K.findIndex((q) => q.at > t);
    if (i == -1) { const q = K[K.length - 1].p(); dot.pos = q[q.length - 1]; return; }
    const q = K[i], a = Math.max(q.dep, i ? K[i - 1].at : 0), p = q.p();
    dot.pos = t < a ? p[0] : along(p, C.ease.io(C.clamp((t - a) / (q.at - a), 0, 1)));
    dot.red = q.red;
    trail.push([dot.pos[0], dot.pos[1], clock]);
    while (trail.length && clock - trail[0][2] > 600) trail.shift();
  }
  // anchors are getters, so routes follow any layout change mid-run
  const bin = (l) => () => [G.bins[l].cx, G.bins[l].cy], MSG = () => [G.msg.cx, G.msg.b - 4];
  const anchor = (t, s) => {
    if (s.sp == "any_ai" || (s.sp == "lane_gate" && t.decide == "floor")) return null;
    if (s.sp == "you" || s.sp == "today") return { id: "waits", f: bin("waits") };
    if (s.sp == "member") return { id: "msg", f: MSG };
    return G.n[s.sp] ? { id: s.sp, f: () => [G.n[s.sp].cx, G.n[s.sp].cy] } : null;
  };

  /* ---------------- a run */
  // cur: the moment on stage; R: its decision when it last played (null while attract waits to play it).
  let cur = d.trace(FIRST), R = null, before = null, busy = false, attract = false, touched = false, stale = false, deb = 0, pend = null;
  const logRow = (t, s, i, stream) => logOl.insertAdjacentHTML("beforeend", U.stepRow(d, t, s, { stream }).replace('<li class="sc-step"', `<li class="sc-step" data-i="${i}"`));
  function chipsBusy(on) {
    busy = on;
    $$(".bp-chip, .bp-all-b, .bp-free button").forEach((b) => b.setAttribute("aria-disabled", String(on)));
    skip.hidden = !on || RM;
  }
  /** Writes a result; due: it shows when the run ends, and keeps its space until then. */
  function showResult(html, due) {
    res.innerHTML = html;
    res.classList.toggle("is-due", !!due);
    res.classList.toggle("is-in", !due);
  }
  function stopRun() {
    if (runTl) runTl.stop(), (runTl = null);
    if (runEnd) runEnd(), (runEnd = null);
  }
  function resetStage(t, from, r) {
    for (const sp in G.n) if (!from) setNode(sp, "idle");
    $$(".sc-val", dia).forEach((e) => (e.textContent = ""));
    $$(".bp-bin", dia).forEach((b) => b.removeAttribute("data-hot"));
    $$(".is-dim", stage).forEach((e) => e.classList.remove("is-dim"));
    stamp.hidden = noai.hidden = true;
    $(".bp-book b").textContent = "24";
    lines = []; trail = [];
    if (!from) logOl.textContent = "";
    else $$("li[data-i]", logOl).forEach((li) => +li.dataset.i >= from && li.remove());
    const tag = kindTag(t, r);
    kindEl.hidden = !tag; kindEl.textContent = tag || "";
    const conf = nodeEl("confidence");
    conf.querySelector(".sc-val").textContent = t.sure ? "" : sureVal(t, r);
    conf.title = t.sure ? d.sp.confidence.line : d.labels.noChatScore;
  }
  /** Plays a moment (from a step: "Run it again" replays only what changed). note: said first. */
  function run(id, from = 0, note = "") {
    const t = d.trace(id);
    if (!t || !G || dead) return Promise.resolve();
    stopRun();
    if (mode == "all") showAll(false);
    pend = null;
    // the run plays in the stage (and pauses off screen): read this before any DOM write.
    // Phones: a chip sits above the stage, so a tap whose stage starts low brings it up. Attract never scrolls.
    const sb = stage.getBoundingClientRect(), away = !attract && (sb.top > innerHeight - 160 || sb.bottom < 160 || (C.phone() && sb.top > innerHeight * 0.4));
    const r = decide(t, S, d);
    $$(".bp-chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.t == d.short(t))));
    before = cur == t && R ? R.lane : null;
    if (cur != t) (from = 0), (ctls.innerHTML = controlsHTML(d, t, S, o.id));
    const old = cur == t && R ? R.steps : [];
    cur = t; R = r; stale = false;
    [kindEl, logOl, change].forEach((e) => e.classList.remove("is-due"));
    if (r.off) { // Low recovery while its flag is off: no run, no pulse, the dashed card from the tests
      resetStage(t, 0, r); dot = null;
      msgBox().outerHTML = msgHTML(t); need();
      setNode("recovery", "focus");
      showResult(resultHTML(d, t, r));
      C.say(`${note}${t.chip}: ${COPY.off}`);
      return Promise.resolve();
    }
    resetStage(t, from, r);
    if (from) [...old.slice(from), ...r.steps.slice(from)].forEach((s) => G.n[s.sp] && setNode(s.sp, "idle"));
    else msgBox().outerHTML = msgHTML(t);
    need();
    // The result is known now: it is written with the click and shown when the run ends, so nothing moves then.
    showResult(resultHTML(d, t, r, before && before != r.lane ? before : null), true);
    if (note) C.say(note);
    const steps = r.steps, base = from ? steps[from].at - 300 : -500, tl = (runTl = C.timeline(sc));
    const floor = t.decide == "floor";
    let prev = (from && anchor(t, steps[from - 1])) || { id: "msg", f: MSG }, keys = [], lastAt = 0;
    const leg = (a, b) => () => route(a(), b());
    steps.forEach((s, i) => {
      if (i < from) return;
      const T = s.at - base, a = anchor(t, s);
      if (a && a.id != prev.id) {
        const p = leg(prev.f, a.f), dur = C.clamp(plen(p()) * 1.1, 160, 420);
        keys.push({ at: T, dep: Math.max(lastAt + 60, T - dur), p }); prev = a; lastAt = T;
      }
      tl.at(T, () => startStep(t, s, i));
      tl.at(T + s.dur, () => endStep(t, s, i, r));
      if (s.out && !RM) { // AI output streams at 40 characters a second; code steps appear whole
        const txt = U.outLines(s).join("\n");
        let f = null;
        tl.span(T + 120, (txt.length / 40) * 1000, (q) => { const pre = logOl.querySelector(`[data-i="${i}"] .sc-out`); if (pre) (f = f || U.streamer(pre, pre.dataset.full))(q); });
      }
    });
    const last = steps[steps.length - 1], end = last.at + last.dur - base + 120;
    const dest = r.lane == "member" ? MSG : r.lane == "learn" ? () => [G.book.cx, G.book.cy] : G.bins[r.lane] && bin(r.lane);
    if (floor) { // the red route: along the inline-start and bottom edges into Training paused
      const p = () => { const s0 = G.n.safety, yb = G.lanes.b + 6, pb = G.bins.paused, x = G.rtl ? G.w - 5 : 5; return [[G.rtl ? s0.r : s0.x, s0.cy], [x, s0.cy], [x, yb], [pb.cx, yb], [pb.cx, pb.b]]; };
      keys.push({ at: end + 600, dep: end, p, red: true });
      tl.at(end, () => lines.push({ p, t0: clock, draw: 600, hold: 99999, fade: 300, col: COL.red, w: 2, ease: 1, keep: 1 }));
    } else if (dest) keys.push({ at: end + 380, dep: end, p: leg(prev.f, dest) });
    dot = { keys, pos: keys.length ? keys[0].p()[0] : null };
    tl.at(end + (floor ? 650 : 420), () => finish(t, r));
    if (!attract) chipsBusy(true); // the attract run stays interruptible: any chip takes over
    sub.wake();
    if (away) dia.scrollIntoView({ block: "start", behavior: RM ? "auto" : "smooth" });
    let done;
    const p = new Promise((r) => (done = r));
    runEnd = done;
    tl.play(1).then(done);
    if (RM) tl.skip();
    return p;
  }
  function startStep(t, s, i) {
    const sp = s.sp == "today" ? null : s.sp, kind = sp && d.sp[sp] ? d.sp[sp].kind : "check";
    if (sp && G.n[sp]) setNode(sp, s.result == "skipped" ? "skip" : "work");
    if (s.sp == "any_ai") { noai.hidden = false; COACH.forEach((c) => setNode(c, "skip")); }
    if (isPick(d, s)) { // code picks: one straight line from the moment's kind to the one specialist
      if (!RM) lines.push({ p: () => [[G.kind.cx, G.kind.b], [G.n[sp].cx, G.n[sp].y]], t0: clock - 1, draw: 240, hold: 500, fade: 600, col: COL.lime, label: COPY.picks });
      logOl.insertAdjacentHTML("beforeend", picksRow(d, i));
    }
    logRow(t, s, i, kind == "ai" && !RM);
    // rule lines from the rulebook to the node that cites a rule
    const cites = (sp == "rule_finder" && s.result == "found") || (sp == "checker" && /cites your rule/i.test(s.say)) || (sp == "lane_gate" && /level|bar/i.test(s.say)) || sp == "set_logger" || (sp == "topics" && s.result == "hit");
    if (cites && G.n[sp] && !RM) lines.push({ p: () => { const n = G.n[sp], y = n.y - 6, x = G.rtl ? G.book.r : G.book.x; return [[x, y], [n.cx, y], [n.cx, n.y]]; }, t0: clock + 60, draw: 240, hold: 400, fade: 600, col: COL.lime });
    if (s.sp == "safety" && s.result == "hit" && !RM) msgBox().classList.add("is-scan"); // the scan sweeps the words
  }
  function endStep(t, s, i, r) {
    const sp = s.sp;
    if (sp == "any_ai") return;
    if (G.n[sp]) setNode(sp, stateOf(s));
    const val = nodeEl(sp) && nodeEl(sp).querySelector(".sc-val");
    if (sp == "confidence" && r.sure) { val.textContent = sureVal(t, r); nodeEl(sp).dataset.state = r.sure.score * 100 >= r.sure.bar ? "pass" : "warn"; }
    if (s.result == "skipped" && val) val.textContent = "Not reached";
    if (sp == "safety" && s.result == "hit") {
      const m = msgBox();
      m.classList.remove("is-scan");
      m.querySelector(".bp-mt").innerHTML = hlText(t.trigger.text, s.highlight || []);
      stamp.hidden = false;
      shell.classList.add("is-dim"); $$(".bp-band[data-band=after], .bp-low", dia).forEach((e) => e.classList.add("is-dim"));
    }
    if (sp == "learner" && s.result == "suggested") lines.push({ p: () => [[G.rtl ? G.n.learner.x : G.n.learner.r, G.n.learner.cy], [G.rtl ? G.book.r : G.book.x, G.n.learner.cy]], t0: clock, draw: 700, hold: 600, fade: 600, col: COL.lime });
    if (sp == "examiner") $(".bp-book b").textContent = "25";
  }
  function finish(t, r) {
    runTl = null;
    const b = $(`.bp-bin[data-lane="${r.lane}"]`, dia);
    if (b) b.setAttribute("data-hot", "");
    if (t.decide == "floor") $$(".is-dim", stage).forEach((e) => e.classList.remove("is-dim"));
    if (r.lane == "member") msgBox().dataset.tag = `${t.member} confirms`;
    showResult(res.innerHTML);
    again.classList.remove("bp-btn-p");
    chipsBusy(false);
    if (!attract) C.say(`Result: ${d.labels.lanes[r.lane]}`); // the self-started run announces nothing
    attract = false;
    paint();
    if (stale) changed(); // a setting changed while it played: the result follows the settings now
  }

  /* ---------------- settings */
  function changed() {
    if (runTl) return void (stale = true);
    const r = decide(cur, S, d), was = R ? R.lane : null;
    showResult(resultHTML(d, cur, r, was && was != r.lane ? was : null));
    again.classList.add("bp-btn-p");
    const sum = $(".bp-sum", ctls);
    if (sum && cur.controls.includes("level")) sum.textContent = d.labels.levels[S.level].summary;
    clearTimeout(deb);
    deb = k.later(() => C.say(`${d.labels.lanes[r.lane]}${r.why ? ". " + r.why : ""}`), 400);
  }
  function pickRadio(b) {
    [...b.parentElement.children].forEach((x) => { const on = x == b; x.setAttribute("aria-checked", String(on)); x.tabIndex = on ? 0 : -1; });
    const v = b.dataset.v;
    S[b.dataset.k] = isNaN(+v) ? v : +v;
    changed();
  }

  /* ---------------- throw them all: twelve mini stacks at 0.6 speed, 120 ms apart */
  function stopAll() {
    if (allTl) allTl.stop(), (allTl = null);
    if (allEnd) allEnd(), (allEnd = null);
  }
  function showAll(on) {
    if (!on) {
      mode = "one"; allBox.hidden = true; dia.hidden = false;
      stopAll(); need();
      return Promise.resolve();
    }
    stopRun(); pend = null;
    mode = "all"; dot = null;
    const list = SPECS[0][2].map((i) => d.trace("t" + i)), noAi = d.labels.noAi;
    allBox.innerHTML = `<div class="bp-all-h"><b>${esc(COPY.allTitle)}</b><button type="button" class="bp-btn bp-back">${esc(COPY.back)}</button></div><div class="bp-minis">` +
      list.map((t) => {
        const r = decide(t, S, d), off = r.off, ai = off ? null : pick(t, d, S), who = ai ? d.sp[ai].name : noAi;
        return `<button type="button" class="bp-mini" data-t="${d.short(t)}"${off ? " data-off" : ""} aria-label="${esc(`${t.member}: ${t.chip}. ${off ? COPY.off : who + ". " + d.labels.lanes[r.lane]}. Open it`)}"><span class="bp-mini-h"><b>${esc(t.member)}</b> ${esc(t.chip)}</span>` +
          (off ? "" : `<span class="bp-mini-ai is-wait" data-kind="${ai ? "ai" : "check"}" aria-hidden="true"><i></i>${esc(who)}</span>`) +
          `<span class="bp-mini-s">${off ? `<i class="bp-ms" data-kind="check" data-state="skip"></i>` : r.steps.map((s) => `<i class="bp-ms" data-kind="${s.sp in d.sp ? d.sp[s.sp].kind : "check"}" data-state="idle"></i>`).join("")}</span>` +
          (off ? `<span class="sc-offchip">${esc(d.labels.status.not_on_yet)}</span>` : U.lane(d, r.lane, "is-wait")) + `</button>`;
      }).join("") +
      // the totals keep their line from the start, and show when the last stack lands
      `</div><p class="bp-totals is-due">${esc(totals(d, S))}</p>`;
    dia.hidden = true; allBox.hidden = false;
    // phones: the button sits above the stage, so bring the twelve stacks up
    const low = C.phone() && stage.getBoundingClientRect().top > innerHeight * 0.4;
    $(".bp-back", allBox).focus({ preventScroll: low });
    if (low) allBox.scrollIntoView({ block: "start", behavior: RM ? "auto" : "smooth" });
    const tl = (allTl = C.timeline(sc));
    let endAt = 0;
    $$(".bp-mini", allBox).forEach((m, j) => {
      const t = d.trace(m.dataset.t), r = decide(t, S, d), blocks = $$(".bp-ms", m), t0 = j * 120;
      if (r.off) return;
      // the one specialist code picked (or "No AI called") shows the moment it is decided
      const aiEl = m.querySelector(".bp-mini-ai"), ai = pick(t, d, S), si = ai ? r.steps.findIndex((s) => s.sp == ai) : r.steps.findIndex((s) => s.result == "hit");
      const sx = si < 0 ? r.steps[r.steps.length - 1] : r.steps[si];
      tl.at(t0 + (sx.at + (ai ? 0 : sx.dur)) * 0.6, () => aiEl.classList.remove("is-wait"));
      r.steps.forEach((s, i) => {
        const a = t0 + s.at * 0.6;
        tl.at(a, () => (blocks[i].dataset.state = s.result == "skipped" ? "skip" : "work"));
        tl.at(a + Math.max(s.dur * 0.6, 90), () => (blocks[i].dataset.state = stateOf(s)));
      });
      const last = r.steps[r.steps.length - 1], e = t0 + (last.at + last.dur) * 0.6 + 150;
      tl.at(e, () => m.querySelector(".sc-lane").classList.remove("is-wait"));
      endAt = Math.max(endAt, e);
    });
    tl.at(endAt + 200, () => { $(".bp-totals", allBox).classList.remove("is-due"); C.say(totals(d, S)); });
    let done;
    const p = new Promise((r) => (done = r));
    allEnd = done;
    tl.play(1).then(done);
    if (RM) tl.skip();
    return p;
  }

  /* ---------------- attract: the frame shows the first moment; with the option, it plays it once */
  function settle() { // the visitor came first: the first moment's frame, as the server drew it
    if (!pend) return;
    pend.forEach(([e, a, v]) => (v == null ? e.removeAttribute(a) : e.setAttribute(a, v)));
    pend = null;
    R = decide(cur, S, d);
    [kindEl, logOl, res, change].forEach((e) => e.classList.remove("is-due"));
    paint();
  }
  function teardown() {
    dead = true;
    stopRun(); stopAll();
    if (sc) sc.destroy();
    k.clear();
    L.release();
  }

  try {
    dia.append(cv);
    shell.append(noai, stamp);
    dia.after(allBox);
    $(".bp-top").append(skip);
    stage.classList.add("sc-cv"); // the canvas draws the matrices now
    $$("[disabled]").forEach((e) => (e.disabled = false));
    sc = C.scene(stage, { resumeOnInput: true });
    sc.button($(".bp-pause"), { pause: COPY.pause, play: COPY.play });
    const wait = !!o.attract && !RM && !o.settled && typeof IntersectionObserver == "function";
    if (wait) {
      // Until it plays, the first moment's frame waits as the server frame did (data-sc="pre"):
      // idle nodes, no lane lit, its kind, steps, result and settings unseen (their space kept).
      pend = [];
      $$(".sc-node, .bp-bin", dia).forEach((e) => {
        pend.push([e, "data-state", e.getAttribute("data-state")], [e, "data-hot", e.getAttribute("data-hot")]);
        if (e.hasAttribute("data-state")) e.setAttribute("data-state", "idle");
        e.removeAttribute("data-hot");
      });
      [kindEl, logOl, res, change].forEach((e) => e.classList.add("is-due"));
      // "well in view": 45% of the stage, or half the viewport when the stage is taller than that (phones)
      const io = new IntersectionObserver((es) => {
        if (!es.some((e) => e.isIntersecting && e.intersectionRect.height >= Math.min(e.boundingClientRect.height * 0.45, innerHeight * 0.5))) return;
        io.disconnect();
        k.later(() => { if (pend && !touched && mode == "one") { attract = true; run(FIRST); } }, 700);
      }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
      io.observe(stage);
      k.add(() => io.disconnect());
    } else R = decide(cur, S, d);
    // a tap or a key (not a scroll that starts on it) is the visitor's: attract stands down
    const touch = () => { touched = true; attract = false; settle(); };
    ["click", "keydown", "change"].forEach((ev) => k.on(root, ev, touch, { capture: true }));

    measure();
    // one loop subscriber: 60 fps while a run plays, 12 fps breathing when idle; asleep under reduced motion and while all twelve play
    sub = sc.loop((dt, now) => {
      clock += dt;
      if (dirty) measure();
      if (dot && dot.keys) moveDot();
      paint(now);
      sub.fps = runTl || lines.length ? 60 : 12;
      return !RM && mode == "one";
    }, 12);
    const ro = new ResizeObserver(() => need());
    ro.observe(dia);
    k.add(() => ro.disconnect());
    k.add(C.tier.on((name) => { root.setAttribute("data-sc-tier", name); need(); }));

    /* ---------------- the picker and the stage's buttons */
    k.on(root, "click", (e) => {
      const c = e.target.closest(".bp-chip");
      if (c) { if (busy) return void e.preventDefault(); return void run(c.dataset.t); }
      if (e.target.closest(".bp-skip")) { e.preventDefault(); if (runTl) runTl.skip(); out.focus(); return; }
      if (e.target.closest(".bp-all-b")) return void (busy || showAll(true));
      const m = e.target.closest(".bp-mini");
      if (m) return void run(m.dataset.t);
      if (e.target.closest(".bp-back")) return void showAll(false);
      const how = e.target.closest(".bp-how");
      if (how) { const n = $(".bp-hownote"); n.hidden = !n.hidden; how.setAttribute("aria-expanded", String(!n.hidden)); }
      if (e.target.closest(".bp-more")) { const all = chips.toggleAttribute("data-all"); $(".bp-more").setAttribute("aria-expanded", String(all)); }
      const tg = e.target.closest(".bp-tg"); // phones: "Step by step" and "Change a setting"
      if (tg) { const open = tg.parentElement.toggleAttribute("data-open"); tg.setAttribute("aria-expanded", String(open)); }
    });
    k.on($("[data-spec]"), "change", (e) => {
      const ord = SPECS.find((s) => s[0] == e.target.value)[2];
      ord.forEach((i) => chips.append(chips.querySelector(`[data-t="t${i}"]`)));
    });
    k.on($(".bp-free"), "submit", (e) => {
      e.preventDefault();
      const v = $(".bp-free textarea").value.trim();
      if (!v || busy) return;
      const id = closest(v), line = COPY.closest.replace("{chip}", d.trace(id).chip);
      $(".bp-closest").textContent = line;
      run(id, 0, line + " ");
    });

    /* ---------------- "Change and run again" */
    k.on(ctls, "input", (e) => {
      const x = e.target, key = x.dataset.k;
      if (!key) return;
      if (x.type == "range") { S[key] = +x.value; const u = key == "minRir" ? "" : "%"; x.setAttribute("aria-valuetext", x.value + u); x.nextElementSibling.textContent = x.value + u; }
      if (x.type == "checkbox") S[key] = x.checked;
      clearTimeout(x._d); x._d = k.later(changed, 120);
    });
    k.on(ctls, "click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-lock")) {
        b.classList.remove("is-shake"); void b.offsetWidth; b.classList.add("is-shake");
        $(".bp-locktip", ctls).hidden = false;
        C.say(COPY.lockTip);
        return;
      }
      if (b.getAttribute("role") == "radio") pickRadio(b);
    });
    k.on(ctls, "keydown", (e) => {
      const b = e.target;
      if (b.getAttribute("role") != "radio" || !/Arrow(Left|Right|Up|Down)/.test(e.key)) return;
      e.preventDefault();
      const all = [...b.parentElement.children], i = all.indexOf(b), fwd = /Down/.test(e.key) || (e.key == "ArrowRight") != G.rtl;
      const n = all[(i + (fwd ? 1 : all.length - 1)) % all.length];
      pickRadio(n); n.focus();
    });
    k.on(again, "click", () => {
      if (busy) return;
      const r = decide(cur, S, d), old = R ? R.steps : [];
      let from = r.steps.findIndex((s, i) => !old[i] || JSON.stringify(s) != JSON.stringify(old[i]));
      if (r.lane != (R && R.lane) && from == -1) from = r.steps.length - 1;
      run(d.short(cur), Math.max(0, from));
    });

    root.setAttribute("data-sc", "on");
    root.setAttribute("data-sc-tier", C.tier.name);
  } catch (e) {
    teardown();
    throw e;
  }
  return {
    destroy() {
      if (!dead) teardown();
    },
    /** Plays one moment ("t2" or its full id), as a chip would; it takes over a run in progress. */
    run(id) {
      if (dead || !d.trace(id)) return Promise.resolve();
      touched = true; attract = false; pend = null;
      const c = chips.querySelector(`[data-t="${d.short(d.trace(id))}"]`);
      if (c && !c.offsetParent && !chips.hasAttribute("data-all")) $(".bp-more").click(); // phones: show the chip it lights
      return run(id);
    },
  };
}
