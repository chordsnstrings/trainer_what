/* trainsyou · Concept B · "24 hours of your Brain" (spec §3).
   One ink stage, three drivers:
   - pin:   ≥ 761 px wide and ≥ 700 px tall. The page scroll drives p.
   - play:  phones and short viewports. A clock drives a ~34 s player card.
   - cards: reduced motion (or no JS). Static hour cards, final state.
   Everything you see is a pure function of p; only the ambient sparkle
   (pausable, stops offscreen / hidden / idle) uses the clock. One rAF loop
   (brain-core), one canvas, no libraries. Runs in Node for the static HTML. */
import * as B from "../../site/assets/brain/brain-core.js";
import * as Dec from "../../site/assets/brain/brain-decide.js";
import * as U from "../../site/assets/brain/brain-ui.js";

export const esc = B.esc;
/* ------------------------------------------------------------------ copy (spec §6 B) */
export const COPY = {
  you: { coach: "You: coaching in person", lunch: "You: lunch", today: "You: checking Today", sleep: "You: asleep" },
  // phones: the step line before the first moment (CD review: "all mine to control" in the first screen)
  introLine: "Code checks each moment before and after, with your rules. Anything unsure waits in your Today list.",
};
const PICK = { reply_picker: "a rule fits", draft_writer: "no rule fits", plan_writer: "new plan", week_reviewer: "week ends", meal_photo: "meal photo", voice_lines: "before a voice session" };
export const BEATS = [
  { t: "t5", at: "07:30", name: "Sara’s voice session" },
  { t: "t8", at: "09:00", name: "Aisha’s week ended",
    today: { title: "Your Brain suggests a plan change", sub: "Aisha · 78% · your bar 80%" } },
  { t: "t4", at: "12:30", name: "Priya’s meal photo" },
  { t: "t10", at: "14:00", name: "Fatima’s first plan",
    today: { title: "Check a plan your Brain sent", sub: "Fatima · Spot check: 1 in 4 sent plans while fewer than 20 are reviewed.", tone: "check" } },
  { t: "t1", at: "17:45", name: "Omar asks to go up" },
  { t: "t2", at: "19:20", name: "Noura’s knee popped",
    today: { title: "Training paused: a safety report", sub: "Noura · joint injury · due within 24 hours", tone: "paused" } },
  { t: "t7", at: "21:00", name: "You check Today", only: [2, 3, 5, 6, 7, 8, 11], win: [0.36, 0.95], capQ: 0.84,
    today: { title: "Your Brain drafted a reply", sub: "Zayed · Draft: “Add 5 kg next time.”", q: 0.5, done: "You edited it · new rule" } },
];
// captions live in brain-day-html.js (CAPS); capQ is where phones switch to the second half of a long one
export const OUTRO = { t: "t9", at: "02:00", name: "Khalid asks about creatine", win: [0.2, 0.42], outro: true, capQ: 0.46,
  today: { title: "Waiting for your reply", sub: "Khalid · supplements · due within 72 hours", q: 0.4 } };
export const HAMDAN = { t: "t3", at: "06:10", name: "Hamdan’s low recovery" };

/* ------------------------------------------------------------------ board rows */
export const GROUPS = [
  { label: "Checks first", sub: "your rules", rows: ["safety", "topics", "memory", "rule_finder"] },
  { label: "Your Brain", sub: "code picks one", rows: ["reply_picker", "draft_writer", "plan_writer", "week_reviewer", "meal_photo", "voice_lines", "set_logger"], shell: 1 },
  { label: "Checks after", sub: "your rules", rows: ["checker", "confidence", "lane_gate"] },
  { label: "Learns from you", rows: ["learner", "examiner"] },
];
const ROW = {};
GROUPS.flatMap((g) => g.rows).forEach((id, i) => (ROW[id] = i));
const NROWS = 16, DAY0 = 360, DAY1 = 1800;
const COL = { on: "#F3F4F0", ai: "#D5F24A", warn: "#E0B25C", hit: "#F08A80", sent: "#7FCB9F", waits: "#E0B25C", paused: "#F08A80", member: "#C9CEC6", learn: "#D5F24A" };
const mins = (s) => { const [h, m] = s.split(":").map(Number); const v = h * 60 + m; return v < DAY0 ? v + 1440 : v; };
const hhmm = (m) => { m = ((Math.floor(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
const initials = (n) => n.slice(0, 2).toUpperCase();
const cellOf = (s, d) => (s.result == "skipped" ? null : s.result == "hit" ? (s.sp == "safety" ? "hit" : "warn") : s.result == "warn" ? "warn" : d.sp[s.sp] && d.sp[s.sp].kind == "ai" ? "ai" : "on");

/* ------------------------------------------------------------------ beat prep (pure) */
function prep(b, d, S) {
  const t = d.trace(b.t), r = Dec.decide(t, S, d), all = r.steps;
  const idx = b.only || all.map((_, i) => i);
  const rows = [];
  idx.forEach((i) => {
    const s = all[i], sp = d.sp[s.sp], ai = sp && sp.kind == "ai";
    if (ai && s.sp != "learner" && PICK[s.sp]) rows.push({ kind: "picks", name: "Code picks", say: `${sp.name} · ${PICK[s.sp]}`, w: 0.7 });
    rows.push({
      i, sp: s.sp, kind: ai ? "ai" : s.sp == "you" || s.sp == "member" ? "you" : "check",
      name: U.nameOf(d, s, t), say: s.result == "skipped" && !/^Not reached/.test(s.say || "") ? "Not reached · " + (s.say || "") : s.say || "", out: ai ? U.outLines(s).slice(0, 2).join("  ") : "",
      res: s.result, cell: s.sp in ROW ? cellOf(s, d) : null, hl: s.highlight || null, ai, usesAi: sp && sp.usesAi,
      w: ai ? 3.2 : s.sp == "you" ? 1.8 : s.result == "skipped" ? 0.45 : 1,
    });
  });
  const [a, z] = b.win || [0.15, 0.62];
  const W = rows.reduce((x, y) => x + y.w, 0);
  let c = a;
  for (const x of rows) { x.a = c; c += ((z - a) * x.w) / W; x.b = c; }
  const laneQ = b.t == "t7" ? 0.95 : z;
  const m = mins(b.at);
  const cells = rows.filter((x) => x.cell).map((x) => ({ row: ROW[x.sp], st: x.cell, q: x.a + 0.02 }));
  const hit = rows.find((x) => x.res == "hit" && x.sp == "safety");
  return { ...b, tr: t, r, rows, laneQ, m, cells, lane: r.lane, hitQ: hit ? hit.b : null, todayQ: b.today ? b.today.q || Math.min(0.99, laneQ + 0.04) : null };
}

/* ------------------------------------------------------------------ the day model */
export function model(d, o = {}) {
  d = B.index(d);
  const S = Dec.defaults(d);
  S.recoveryFlag = !!o.recovery;
  const beats = (S.recoveryFlag ? [HAMDAN, ...BEATS] : BEATS).map((b) => prep(b, d, S));
  const outro = prep(OUTRO, d, S);
  // seeded ghost moments: true paths, never a Not-on-yet node, stops ~1 in 8
  const rnd = B.rng(7), pool = d.traces.filter((t) => !t.defaultOff && t.decide != "learn" && t.decide != "recovery");
  const tw = pool.reduce((x, t) => x + t.weight, 0);
  const DENS = [[360, 420, 1], [420, 540, 6], [540, 720, 3], [720, 840, 4.5], [840, 1020, 3], [1020, 1260, 6], [1260, 1380, 2.2], [1380, 1800, 0.35]];
  const dw = DENS.reduce((x, s) => x + (s[1] - s[0]) * s[2], 0);
  const named = [...beats, outro].map((b) => b.m);
  const ghosts = [];
  let sinceStop = 9, guard = 0;
  while (ghosts.length < (o.ghosts || 48) && guard++ < 999) {
    let u = rnd() * dw, m = DAY0;
    for (const [a, z, w] of DENS) { const L = (z - a) * w; if (u < L) { m = a + u / w; break; } u -= L; }
    if (named.some((x) => Math.abs(x - m) < 7)) continue;
    let k = rnd() * tw, t = pool[0];
    for (const x of pool) { if ((k -= x.weight) < 0) { t = x; break; } }
    const stop = t.decide == "floor";
    if (stop && sinceStop < 6) continue;
    sinceStop = stop ? 0 : sinceStop + 1;
    const cells = t.steps.filter((s) => s.sp in ROW).map((s, j) => ({ row: ROW[s.sp], st: cellOf(s, d), dt: j * 1.3 })).filter((c) => c.st);
    ghosts.push({ m, cells, lane: t.lane, end: cells.length * 1.3 + 1, ph: rnd() * 6.28, stop });
  }
  ghosts.sort((a, b) => a.m - b.m);
  // the whole day as ghosts, for the one-time "day at a glance" sweep
  const allG = [...ghosts, ...[...beats, outro].map((b) => ({ m: b.m, cells: b.cells.map((c, j) => ({ row: c.row, st: c.st, dt: j * 1.3 })), lane: b.lane, end: b.cells.length * 1.3 + 1, ph: 1, stop: b.hitQ != null }))].sort((a, b) => a.m - b.m);
  return { d, S, beats, outro, ghosts, allG };
}

/** Segments: intro, each beat, outro. pin lengths are fractions of p; play lengths are ms. */
function segs(M, mode) {
  const n = M.beats.length;
  const L = mode == "pin" ? [0.04, ...M.beats.map(() => 0.84 / n), 0.12] : [900, ...M.beats.map(() => 4200), 5200];
  const tot = L.reduce((a, b) => a + b, 0);
  let c = 0;
  return { tot, list: L.map((len, i) => { const s = { i, k: i - 1, a: c, len }; c += len; return s; }) };
}
/** State at p ∈ [0,1]: which segment, local q, and the clock (minutes since 00:00, may exceed 1440). */
function stateAt(M, SG, p) {
  const x = B.clamp(p, 0, 1) * SG.tot;
  let s = SG.list[SG.list.length - 1];
  for (const y of SG.list) if (x < y.a + y.len) { s = y; break; }
  const q = B.clamp((x - s.a) / s.len, 0, 1), n = M.beats.length, k = s.k;
  let clock, rolling = false;
  const roll = (from, to, a, z) => { if (q > a && q < z) rolling = true; return B.lerp(from, to, B.ease.io(B.clamp((q - a) / (z - a), 0, 1))); };
  if (k < 0) clock = DAY0 + 0;
  else if (k < n) {
    const b = M.beats[k], prev = k == 0 ? DAY0 : M.beats[k - 1].m + (M.beats[k - 1].t == "t7" ? 6 : 8);
    if (b.t == "t7") clock = q < 0.15 ? roll(prev, b.m, 0, 0.15) : q < 0.38 ? roll(b.m, b.m + 5, 0.34, 0.38) : roll(b.m + 5, b.m + 6, 0.86, 0.9);
    else clock = q < 0.15 ? roll(prev, b.m, 0, 0.15) : b.m + 8 * B.clamp((q - 0.15) / 0.85, 0, 1);
  } else {
    const last = M.beats[n - 1].m + 6, o = M.outro.m;
    clock = q < 0.2 ? roll(last, o, 0, 0.2) : q < 0.46 ? o + 4 * ((q - 0.2) / 0.26) : roll(o + 4, DAY1 - 15, 0.46, 0.6);
  }
  return { seg: s.i, k, q, clock, p, rolling };
}
const past = (st, k, q) => st.k > k || (st.k == k && st.q >= q);

export const panelKey = (b, i) => (b.outro ? "o" : String(i));

/* ================================================================== browser */
// the mount runs in short tasks (QA 27 Oct: one 340 ms task at 4x CPU): yield between the steps
const nextTask = () => new Promise((r) => setTimeout(r, 0));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
export async function mount(el) {
  const d = await B.load(el.dataset.src);
  await nextTask();
  const M = model(d, { recovery: B.flags().recovery });
  await nextTask();
  const $ = (s) => el.querySelector(s), $$ = (s) => [...el.querySelectorAll(s)];
  const RM = () => B.reduced() || document.documentElement.getAttribute("data-motion") == "reduce";
  const pickMode = () => (RM() ? "cards" : innerWidth > 760 && innerHeight >= 700 ? "pin" : "play");
  let mode = pickMode();
  el.removeAttribute("data-sc");
  el.setAttribute("data-mode", mode);
  if (B.flags().recovery) { /* the start frame was built without Hamdan: rebuild */
    const host = $("[data-dy-host]");
    const H = await import("./brain-day-html.js"), cards = $("[data-dy-cards]");
    if (host) host.innerHTML = H.stageHTML(d, { M, mode, cta: el.dataset.cta });
    if (cards) cards.outerHTML = H.cardsHTML(d, { M });
  }
  if (mode == "cards") return;
  // the static hour cards stay readable by screen readers, but out of the tab order while the stage plays
  el.querySelectorAll(".dy-cards details").forEach((x) => { x.open = true; x.querySelector("summary").setAttribute("tabindex", "-1"); });
  $("[data-dy-cards]") && $("[data-dy-cards]").classList.add("sr-only");
  await nextFrame(); // the browser restyles the band in its own frame, before anything reads layout
  const stage = $("[data-dy-stage]"), board = $(".dy-board");
  const cv0 = $(".dy-cv0"), cvB = $(".dy-cv"), cvL = $(".dy-cvl"), gl = $(".dy-gl"), gli = gl.querySelector(".dy-gli"), dimEl = $(".dy-dim");
  const R = {
    hh: $(".dy-hh .dy-strip"), m1: $(".dy-m1 .dy-strip"), m2: $(".dy-m2 .dy-strip"), hm: $("[data-dy-hm]"), you: $("[data-dy-you]"),
    now: $("[data-dy-now]"), sees: $("[data-dy-sees]"), tl: $("[data-dy-tl]"), cnt: $("[data-dy-cnt]"), tnote: $("[data-dy-tnote]"), end: $("[data-dy-end]"),
    range: $("[data-dy-range]"), stamp: $(".dy-stamp"), nowBox: $(".dy-now"), marks: $$(".dy-mk"), n: {}, wash: $(".dy-wash"),
    pn: {}, ps: {}, caps: {}, mini: {},
  };
  $$("[data-dy-n]").forEach((x) => (R.n[x.dataset.dyN] = x));
  R.end.hidden = false;
  R.tcs = [...R.tl.children];
  R.now.querySelectorAll(":scope > .dy-pnl").forEach((x) => (R.pn[x.dataset.pnl] = x));
  R.sees.querySelectorAll(":scope > .dy-pnl").forEach((x) => (R.ps[x.dataset.pnl] = x));
  $$("[data-dy-subtitle] > [data-cap]").forEach((x) => (R.caps[x.dataset.cap] = x));
  $$(".dy-mini .dy-n").forEach((x) => (R.mini[x.dataset.sp] = x));
  R.curP = R.now.querySelector(".is-cur"); R.curS = R.sees.querySelector(".is-cur"); R.curC = $("[data-dy-subtitle] > .is-cur");
  R.line = $("[data-dy-line]"); R.sun = $("[data-dy-sun]");
  const setCap = (k) => { const x = R.caps[k]; if (!x || x == R.curC) return; R.curC && R.curC.classList.remove("is-cur"); x.classList.add("is-cur"); R.curC = x; };
  const setPanel = (k) => {
    const p = R.pn[k], s = R.ps[k];
    if (p != R.curP) { if (R.curP) { R.curP.classList.remove("is-cur"); R.curP.setAttribute("aria-hidden", "true"); } p.classList.add("is-cur"); p.removeAttribute("aria-hidden"); R.curP = p; }
    if (s != R.curS) { if (R.curS) { R.curS.classList.remove("is-cur"); R.curS.setAttribute("aria-hidden", "true"); } s.classList.add("is-cur"); s.removeAttribute("aria-hidden"); R.curS = s; }
  };
  setCap(mode == "play" ? "play" : "pin");

  const sc = B.scene(stage, { resumeOnInput: false });
  sc.button($(".dy-pause"));
  // brain-core syncs the button only when "running" flips; a pause while offscreen would leave a stale label
  const pause = () => { sc.pause(); const z = $(".dy-pause"), on = sc.reasons.has("user") || sc.reasons.has("idle"); z.setAttribute("aria-pressed", String(on)); z.querySelector("[data-label]").textContent = on ? "Play" : "Pause"; z.dataset.state = on ? "paused" : "playing"; };
  let SG = segs(M, mode), P = 0, PT = 0, T = 0, started = mode == "pin", ended = false, last = {};
  // one-time "the day at a glance": a 1.5 s sweep lights every moment of the sample day, then it plays hour by hour
  const PV_SWEEP = 1500, PV_HOLD = 1100, PV_FADE = 500, PV_END = PV_SWEEP + PV_HOLD + PV_FADE;
  let pv = -1;
  const ALL = [...M.beats, M.outro], NB = M.beats.length;

  /* ---------------- canvases (QA 27 Oct: only small canvases change per frame)
     strips (.dy-cvt, six) the timeline: static slice + settled moments; one strip redrawn when its set changes
     cv0  unused since the CD review (hidden): a full-board canvas was copied again at every commit
     cvB  a narrow band that follows the playhead (CSS transform): young moments, the current moment, the playhead
     cvL  the label column (static slice + lit labels): redrawn only when a label's state changes
     glance  the one-time sweep: small strip canvases drawn just ahead of a composited wipe, then faded
     .dy-dim  the stop's dim over the Brain (opacity only) */
  let G = null, cB = null, cL = null, stat = null, BG = "#171917", sigL = null, offB = null, dimV = -1, glReady = false;
  const FR = new Float32Array(NROWS), FR0 = new Float32Array(NROWS);
  function layout(deferDots) {
    const w = Math.round(board.clientWidth), hh = Math.round(board.clientHeight);
    if (!w || !hh) return;
    const ph = w < 520, spine = ph ? 0 : 30, labW = ph ? 76 : 166;
    const top = ph ? 30 : 42, youH = ph ? 6 : 9, gap = ph ? 6 : 8, laneH = ph ? 6 : 8, hy = ph ? 8 : 11, my = ph ? 18 : 27;
    const shellPad = ph ? 3 : 6, shellT = ph ? 0 : 15;
    const avail = hh - top - youH - gap * 5 - laneH - shellPad * 2 - shellT - 6;
    const nr = ph ? 10 : NROWS; // phones: each check band is one row; the 7 specialists keep theirs
    const pitch = B.clamp(Math.floor(avail / nr), 3, 13);
    const x0 = spine + labW, x1 = w - (ph ? 2 : 8);
    const X = (m) => x0 + ((m - DAY0) / (DAY1 - DAY0)) * (x1 - x0);
    let y = top + youH + gap;
    const rowY = [], gy = [];
    GROUPS.forEach((g) => {
      const g0 = y;
      if (g.shell) y += shellPad + shellT;
      if (ph && !g.shell) { g.rows.forEach((id) => (rowY[ROW[id]] = y + pitch / 2)); y += pitch; }
      else g.rows.forEach((id) => { rowY[ROW[id]] = y + pitch / 2; y += pitch; });
      if (g.shell) y += shellPad;
      gy.push([g0, y]);
      y += gap;
    });
    const laneY = y + laneH / 2;
    G = { hy, my, w, h: hh, ph, spine, labW, top, youH, x0, x1, X, rowY, gy, laneY, pitch, cs: B.clamp(pitch - (ph ? 3 : 5), 2.5, 6) };
    G.bw = Math.ceil(X(DAY0 + 150) - X(DAY0)) + 26;
    const sm = B.phone(); if (sm !== R.small) { R.small = sm; last.sig = last.line = null; }
    G.r = Math.min(window.devicePixelRatio || 1, B.tier.spec.dpr);
    // (CD review perf, 27 Oct) no full-board canvas: with software compositing every canvas on screen is copied again at
    // each commit, changed or not (a 1,087 px board canvas cost ~3 ms of every scrolled frame at 4x CPU). The static layer is
    // drawn into the label canvas (left) and into the six strips (the timeline), which hold it under the settled moments.
    if (!cv0.hidden) { cv0.hidden = true; cv0.width = cv0.height = 0; }
    cB = B.fit(cvB, G.bw, hh); cL = B.fit(cvL, Math.ceil(x0), hh); cL._f = null;
    Object.assign(dimEl.style, { left: x0 - 2 + "px", top: gy[1][0] + "px", width: x1 - x0 + 4 + "px", height: gy[3][1] - gy[1][0] + "px" });
    stat = drawStatic(); sigL = offB = null; glReady = false; G.dots = [];
    slice(cL, stat, 0, Math.ceil(x0)); // the label column until the first label pass
    // strips over the timeline for the settled moments (6 of them; each one a small canvas of its own)
    const NT = 6, tw = Math.ceil((x1 + 8 - x0) / NT);
    board.querySelectorAll(".dy-cvt").forEach((x) => x.remove());
    G.tiles = Array.from({ length: NT }, (_, i) => {
      const a = Math.floor(x0) + i * tw, b = Math.min(w, a + tw), cv = document.createElement("canvas");
      cv.className = "dy-cvt"; cv.setAttribute("aria-hidden", "true"); cv.style.left = a + "px";
      cv0.after(cv);
      const c = B.fit(cv, b - a, hh), T = { a, b, cv, c, sig: null, r: G.r };
      c.setTransform(G.r, 0, 0, G.r, -a * G.r, 0); bg(c, T); // the static slice now; the moments follow, one strip a frame
      return T;
    });
    // the unlit dot grid: two more short tasks at mount (one per shape); skipped if a newer layout replaced this one
    const G0 = G, dg = (ai) => { if (G0 !== G) return; const bm = drawDots(ai); G.dots.push(bm); for (const T of G.tiles) { T.c.setTransform(T.r, 0, 0, T.r, -T.a * T.r, 0); slice(T.c, bm, T.a, T.b); } };
    if (deferDots) nextTask().then(() => dg(true)).then(nextTask).then(() => dg(false)); else { dg(true); dg(false); }
    if (pv >= 0 && pv < PV_END) glance();
    placeMarks();
    draw(performance.now());
  }
  // a vertical slice [a, b) of a board-sized bitmap, drawn at the same board coordinates
  function slice(c, bm, a, b) { const k = bm.width / G.w; c.drawImage(bm, a * k, 0, (b - a) * k, bm.height, a, 0, b - a, G.h); }
  function bg(c, T) { slice(c, stat, T.a, T.b); for (const bm of G.dots) slice(c, bm, T.a, T.b); }
  function drawStatic() {
    const { cv: bcv, c } = B.bitmap(G.w, G.h), g = G;
    const font = (s, w = 500) => `${w} ${s}px Inter, system-ui, sans-serif`;
    // daylight wash 06:00–17:45
    c.fillStyle = "rgba(243,244,240,.045)";
    c.fillRect(g.X(360), g.top - 4, g.X(1065) - g.X(360), g.laneY - g.top + 10);
    // hour grid + labels
    c.font = `700 ${g.ph ? 9 : 11}px Archivo, "Arial Narrow", sans-serif`;
    c.textBaseline = "alphabetic";
    for (let m = 360; m <= 1800; m += 180) {
      const x = Math.round(g.X(m)) + 0.5;
      c.fillStyle = "rgba(243,244,240,.07)"; c.fillRect(x, g.hy + 3, 1, g.laneY - g.hy + 1);
      c.fillStyle = "#8A8F87"; c.textAlign = m == 1800 ? "right" : m == 360 ? "left" : "center";
      c.fillText(hhmm(m).slice(0, 2), x + (m == 1800 ? -3 : m == 360 ? 3 : 0), g.hy);
    }
    // You strip
    const yy = g.top, Y = g.youH;
    const blocks = [[360, 720, "c"], [720, 780, "l"], [780, 1260, "c"], [1260, 1320, "t"], [1320, 1800, "s"]];
    for (const [a, z, k] of blocks) {
      const xa = g.X(a) + 1, xz = g.X(z) - 1;
      if (k == "s") { c.strokeStyle = "rgba(243,244,240,.16)"; c.lineWidth = 1; for (let x = xa; x < xz; x += 5) { c.beginPath(); c.moveTo(x, yy + Y); c.lineTo(x + Y, yy); c.stroke(); } }
      else { c.fillStyle = k == "c" ? "rgba(243,244,240,.2)" : k == "t" ? "#D5F24A" : "rgba(243,244,240,.08)"; c.beginPath(); c.roundRect(xa, yy, xz - xa, Y, 2); c.fill(); }
    }
    c.fillStyle = "#A9AEA6"; c.font = font(g.ph ? 9 : 11, 600); c.textAlign = "left"; c.textBaseline = "middle";
    c.fillText("You", g.spine, yy + Y / 2);
    // groups: labels, shell, brackets
    GROUPS.forEach((gr, gi) => {
      const [g0, g1] = g.gy[gi];
      if (gr.shell) {
        c.strokeStyle = "#8A8F87"; c.lineWidth = 1; c.beginPath(); c.roundRect(g.spine - (g.ph ? 0 : 4) + 0.5, g0 + 0.5, g.w - g.spine - (g.ph ? 1 : 4), g1 - g0, g.ph ? 6 : 10); c.stroke();
        if (!g.ph) {
          c.fillStyle = "#D5F24A"; c.beginPath(); c.arc(g.spine + 8, g0 + 10, 7, 0, 7); c.fill();
          c.fillStyle = "#171917"; c.font = font(7.5, 700); c.textAlign = "center"; c.fillText("LS", g.spine + 8, g0 + 10.5);
          c.textAlign = "left"; c.fillStyle = "#F3F4F0"; c.font = font(11.5, 600); c.fillText("Your Brain", g.spine + 20, g0 + 10.5);
          c.fillStyle = "#A9AEA6"; c.font = font(10.5); c.fillText("Code picks the specialist. No AI chooses which AI runs.", g.x0 + 2, g0 + 10.5);
        }
      }
      if (g.ph) {
        // phones (CD review): readable group labels (fitted to the column) and, in the shell, one slot per specialist that lights with its row
        const t = gr.label, maxW = g.labW - (gr.shell ? 24 : 8);
        let fs = 10; c.font = font(fs, gr.shell ? 700 : 600); while (fs > 7.5 && c.measureText(t).width > maxW) c.font = font((fs -= 0.5), gr.shell ? 700 : 600);
        c.fillStyle = gr.shell ? "#F3F4F0" : "#A9AEA6"; c.textAlign = "left";
        if (gr.shell) { const [a, b] = t.split(" "); c.fillText(a, 6, (g0 + g1) / 2 - 6); c.fillText(b, 6, (g0 + g1) / 2 + 6); gr.rows.forEach((id) => phGlyph(c, g.labW - 12, g.rowY[ROW[id]], d.sp[id].kind == "ai", "#8A8F87", null)); }
        else c.fillText(t, 4, (g0 + g1) / 2);
      }
      else if (!gr.shell) {
        const t = gr.label + (gr.sub ? " · " + gr.sub : ""), y = g.rowY[ROW[gr.rows[0]]];
        c.font = font(10.5, 600); const tw = c.measureText(t).width;
        c.fillStyle = "#171917"; c.fillRect(g.x1 - tw - 10, y - 7, tw + 10, 14);
        c.fillStyle = "#A9AEA6"; c.textAlign = "right"; c.fillText(t, g.x1 - 2, y + 0.5); c.textAlign = "left";
      }
    });
    // rulebook spine (desktop)
    if (!g.ph) {
      const s0 = g.gy[0][0], s1 = g.gy[2][1];
      c.fillStyle = "#202320"; c.strokeStyle = "#3A3F39"; c.beginPath(); c.roundRect(2, s0, 18, s1 - s0, 5); c.fill(); c.stroke();
      [0, 2].forEach((gi) => { const [a, z] = g.gy[gi]; c.strokeStyle = "rgba(213,242,74,.55)"; c.lineWidth = 1.25; c.beginPath(); c.moveTo(22, a + 1); c.lineTo(26, a + 1); c.lineTo(26, z - 3); c.lineTo(22, z - 3); c.stroke(); });
    }
    // legend (desktop): two lines above the labels, clear of the hour labels
    if (!g.ph) {
      c.textBaseline = "middle"; c.textAlign = "left"; c.font = font(10.5); c.fillStyle = "#A9AEA6";
      glyph(c, g.spine + 8, 8, true, "#A9AEA6"); c.fillText("AI specialist", g.spine + 30, 8.5);
      glyph(c, g.spine + 8, 23, false, "#A9AEA6"); c.fillText("Code, no AI", g.spine + 30, 23.5);
    }
    // row labels + glyph outlines (idle) + unlit dot grid
    const lf = B.clamp(g.pitch - 0.5, 9, 11.5);
    c.font = font(lf); c.textAlign = "left"; c.textBaseline = "middle";
    for (const id in ROW) {
      const y = g.rowY[ROW[id]], sp = d.sp[id], ai = sp.kind == "ai";
      if (!g.ph) { glyph(c, g.spine + 8, y, ai, "#8A8F87", null); c.fillStyle = "#A9AEA6"; c.fillText(sp.name + (sp.usesAi ? " · uses your AI" : ""), g.spine + 30, y + 0.5); }
    }
    if (!g.ph) {
      c.fillStyle = "#A9AEA6"; c.font = font(11, 600); c.textAlign = "left"; c.fillText("Where it went", g.spine + 30, g.laneY);
    } else { c.fillStyle = "#A9AEA6"; c.font = font(10, 600); c.textAlign = "left"; c.fillText("Lane", 4, g.laneY); }
    return bcv;
  }
  function drawDots(only) {
    const { cv: bcv, c } = B.bitmap(G.w, G.h), g = G;
    // the unlit dot grid: one path per shape (2,300 separate fills cost ~100 ms at 4x CPU; QA 27 Oct)
    const s2 = (g.cs * 0.8) / 2;
    c.fillStyle = "rgba(243,244,240,.055)";
    for (const ai of [only]) {
      c.beginPath();
      for (const id in ROW) {
        if ((d.sp[id].kind == "ai") != ai) continue;
        const y = g.rowY[ROW[id]];
        for (let m = DAY0 + 5; m < DAY1; m += g.ph ? 15 : 10) { const x = g.X(m); if (ai) { c.moveTo(x + s2, y); c.arc(x, y, s2, 0, 6.3); } else c.rect(x - s2, y - s2, s2 * 2, s2 * 2); }
      }
      c.fill();
    }
    return bcv;
  }
  // setting ctx.font re-parses the font every time (it dominated the frame): only set it when it changes
  function setFont(c, f) { if (c._f !== f) { c.font = f; c._f = f; } }
  function glyph(c, x, y, ai, col, fill) {
    c.lineWidth = 1.25; c.strokeStyle = col; c.beginPath();
    if (ai) c.roundRect(x - 8, y - 4.5, 16, 9, 4.5); else c.roundRect(x - 4.5, y - 4.5, 9, 9, 1.5);
    if (fill) { c.fillStyle = fill; c.fill(); } else c.stroke();
  }
  // phones: a specialist's slot beside the shell label (pill = AI, square = code)
  function phGlyph(c, x, y, ai, col, fill) {
    c.lineWidth = 1; c.beginPath();
    if (ai) c.roundRect(x - 7, y - 3, 14, 6, 3); else c.roundRect(x - 3, y - 3, 6, 6, 1);
    if (fill) { c.fillStyle = fill; c.fill(); } else { c.strokeStyle = col; c.stroke(); }
  }
  // plain paths: in testing, a path per dot beat drawImage of small sprites by 30x
  function dot(c, x, y, s, ai) {
    if (ai) { c.beginPath(); c.arc(x, y, s / 2, 0, 6.3); c.fill(); }
    else c.fillRect(x - s / 2, y - s / 2, s, s);
  }
  const glow = (c, x, y, r, col) => { c.fillStyle = col; c.globalAlpha *= 0.45; c.beginPath(); c.arc(x, y, r, 0, 6.3); c.fill(); c.globalAlpha *= 0.6; c.beginPath(); c.arc(x, y, r * 0.62, 0, 6.3); c.fill(); };
  function placeMarks() {
    R.marks.forEach((b, i) => {
      const m = ALL[i].m;
      b.tabIndex = G.ph ? -1 : 0; b.toggleAttribute("aria-hidden", G.ph);
      b.style.left = G.X(m) + "px";
      b.style.top = G.my + "px";
    });
  }

  /* ---------------- per-frame draw */
  const AIr = new Set(Object.keys(ROW).filter((id) => d.sp[id].kind == "ai")), SHELL = new Set(GROUPS[1].rows);
  const rowIds = Object.keys(ROW);
  // one named moment's column (cells, rail, lane mark); cur: the moment playing now
  function beatCol(c, b, k, st, cur, glowOn, now) {
    const g = G, x = g.X(b.m);
    let any = false, y0 = 1e9, y1 = -1e9;
    for (const ce of b.cells) if (past(st, k, ce.q)) { y0 = Math.min(y0, g.rowY[ce.row]); y1 = Math.max(y1, g.rowY[ce.row]); }
    const lp = past(st, k, b.laneQ);
    if (lp) y1 = g.laneY;
    if (y1 > y0) { c.globalAlpha = cur ? 0.9 : 0.5; c.fillStyle = lp ? COL[b.lane] : COL.ai; c.fillRect(x - 1, y0, 2, y1 - y0); c.globalAlpha = 1; }
    for (const ce of b.cells) {
      if (!past(st, k, ce.q)) continue;
      any = true;
      const y = g.rowY[ce.row], col = COL[ce.st];
      if (glowOn) { c.globalAlpha = 0.45 + 0.15 * Math.sin(now / 160 + ce.row); glow(c, x, y, g.cs * 2.4, col); }
      c.globalAlpha = 1; c.fillStyle = col; dot(c, x, y, g.cs * 1.35, AIr.has(rowIds[ce.row]));
    }
    if (lp) { c.fillStyle = COL[b.lane]; c.fillRect(x - 2.5, g.laneY - 3.5, 5, 7); }
    if (any && cur) { c.globalAlpha = 0.3; c.fillStyle = "#D5F24A"; c.fillRect(x - 0.5, g.top + g.youH + 2, 1, g.laneY - g.top - g.youH); c.globalAlpha = 1; }
  }
  // phones: the named moments as small markers on the canvas (the DOM buttons are for desktop)
  function markers(c, st) {
    ALL.forEach((m, i) => {
      const k = m.outro ? NB : i, x = G.X(m.m), on = st.k == k, done = st.k > k || (on && st.q >= m.laneQ);
      c.beginPath(); c.arc(x, G.my, on ? 6 : 4.5, 0, 6.3);
      if (on) { c.fillStyle = COL.ai; c.fill(); } else if (done) { c.fillStyle = "#F3F4F0"; c.fill(); } else { c.strokeStyle = "#8A8F87"; c.lineWidth = 1.25; c.stroke(); }
    });
  }
  function draw(now) {
    if (!G || !cL) return;
    const g = G, st = stateAt(M, SG, P), clock = st.clock, amb = sc.running && B.tier.name != "minimal", halos = B.tier.spec.halos;
    let nOld = 0;
    while (nOld < M.ghosts.length && M.ghosts[nOld].m <= clock - 140) nOld++;
    const cb = st.k >= 0 ? ALL[Math.min(st.k, NB)] : null, inBand = !!cb && clock - cb.m < 140;
    let nY = nOld; while (nY < M.ghosts.length && M.ghosts[nY].m <= clock) nY++;
    // anything that moves on its own (shimmer, glow)? if not, the loop can sleep while the scroll is still
    g.td = amb && (nY > nOld || (inBand && halos && cb.cells.some((ce) => past(st, st.k, ce.q))));
    let curSig = "";
    if (cb && !inBand) { for (const ce of cb.cells) curSig += past(st, st.k, ce.q) ? 1 : 0; curSig += past(st, st.k, cb.laneQ) ? "L" : ""; }
    // 1) settled moments, in vertical strips: a moment settling (or a beat ending) re-uploads one small strip, not the board
    let redraws = 0;
    for (const T of g.tiles) {
      const a = T.a - 16, z = T.b + 16;
      let sig = halos ? "h" : "";
      for (let i = 0; i < nOld; i++) { const x = g.X(M.ghosts[i].m); if (x >= a && x <= z) sig += i + ","; }
      ALL.forEach((b, i) => {
        const kk = b.outro ? NB : i, x = g.X(b.m);
        if (x < a || x > z) return;
        if (kk < st.k) sig += "|p" + kk; else if (kk == st.k && !inBand) sig += "|c" + kk + curSig;
        if (g.ph) sig += st.k == kk ? (st.q >= b.laneQ ? "D" : "O") : st.k > kk ? "d" : "n";
      });
      if (sig === T.sig || redraws >= 1) continue; // one strip a frame: a beat ending never lands on one frame with everything else
      T.sig = sig; redraws++;
      if (T.r !== g.r) { T.c = B.fit(T.cv, T.b - T.a, g.h); T.r = g.r; } // a tier step-down lowers the DPR at the strip's next redraw
      const c = T.c;
      c.setTransform(T.r, 0, 0, T.r, -T.a * T.r, 0); c.globalAlpha = 1; c.clearRect(T.a, 0, T.b - T.a, g.h); bg(c, T);
      for (let i = 0; i < nOld; i++) { const x = g.X(M.ghosts[i].m); if (x >= a && x <= z) ghostLayer(c, M.ghosts, i, i + 1, clock, 1, FR0, now, false, halos); }
      ALL.forEach((b, i) => { const kk = b.outro ? NB : i, x = g.X(b.m); if (x >= a && x <= z && (kk < st.k || (kk == st.k && !inBand))) beatCol(c, b, kk, st, kk == st.k, false, now); });
      if (g.ph) markers(c, st);
      c.globalAlpha = 1;
    }
    // 2) cvB: the band around the playhead
    FR.fill(0);
    const gx = pv >= 0 && pv < PV_END ? glanceAt() : null;
    const sweep = !!gx && gx.k < 1, head = sweep ? gx.pc : clock, px = g.X(Math.min(head, DAY1 - 0.5)), off = Math.floor(px) - (g.bw - 10), r = g.r;
    if (off !== offB) { offB = off; cvB.style.transform = `translate3d(${off}px,0,0)`; }
    cB.setTransform(r, 0, 0, r, -off * r, 0);
    cB.globalAlpha = 1; cB.clearRect(off, 0, g.bw, g.h);
    if (sweep) { let i0 = 0; while (i0 < M.allG.length && M.allG[i0].m <= gx.pc - 140) i0++; ghostLayer(cB, M.allG, i0, M.allG.length, gx.pc, gx.mul, FR, now, amb, halos); cB.globalAlpha = 1; cB.fillStyle = "#D5F24A"; cB.fillRect(px - 1, g.hy + 4, 2, g.laneY - g.hy); }
    ghostLayer(cB, M.ghosts, nOld, M.ghosts.length, clock, 1, FR, now, amb, halos);
    cB.globalAlpha = 1;
    let dv = 0;
    if (cb && inBand) {
      beatCol(cB, cb, st.k, st, true, halos && amb, now);
      // the stop: dim the Brain, a red column through it
      if (cb.hitQ != null && st.q >= cb.hitQ - 0.02) {
        const f = B.clamp(1 - (st.q - cb.hitQ) / 0.3, 0, 1);
        if (f > 0) {
          dv = Math.round(50 * f) / 100;
          cB.globalCompositeOperation = "source-atop"; cB.globalAlpha = dv; cB.fillStyle = "#171917"; cB.fillRect(g.x0 - 2, g.gy[1][0], g.x1 - g.x0 + 4, g.gy[3][1] - g.gy[1][0]); cB.globalCompositeOperation = "source-over";
          const x = g.X(cb.m); cB.globalAlpha = 0.25 + 0.6 * f; cB.fillStyle = "#F08A80"; cB.fillRect(x - 1.5, g.top + g.youH + 2, 3, g.laneY - g.top - g.youH);
          cB.globalAlpha = 1;
        }
      }
    }
    if (dv !== dimV) { dimV = dv; dimEl.style.opacity = dv; }
    // playhead (hidden during the glance sweep: the sweep line is the head)
    if (!sweep) {
      cB.fillStyle = "rgba(213,242,74,.14)"; cB.fillRect(px - 6, g.hy + 4, 12, g.laneY - g.hy);
      cB.fillStyle = "#D5F24A"; cB.fillRect(px - 1, g.hy + 4, 2, g.laneY - g.hy);
      cB.beginPath(); cB.moveTo(px - 5, g.hy + 3); cB.lineTo(px + 5, g.hy + 3); cB.lineTo(px, g.hy + 9); cB.fill();
    }
    // 3) cvL: the label column, only when a label changes (and not in the frame a strip was redrawn)
    if (!redraws) labels(st, now, amb);
  }
  function labels(st, now, amb) {
    const g = G, c = cL, b = st.k >= 0 ? ALL[Math.min(st.k, NB)] : null, cur = {};
    if (b) for (const x of b.rows) if (x.sp in ROW && x.cell && st.q >= x.a) cur[x.sp] = { work: st.q < x.b, col: COL[x.cell], x };
    const tk = M.beats.findIndex((x) => x.t == "t7"), n25 = !g.ph && tk >= 0 && past(st, tk, 0.95);
    if (amb) for (const id in cur) if (cur[id].work) g.td = true; // the working node's matrix animates
    if (HOLD && ++labN % 4) return;
    let sig = (n25 ? "25|" : "24|") + BG;
    for (let r = 0; r < NROWS; r++) {
      const id = rowIds[r], u = cur[id], f = Math.round(FR[r] * 4);
      if (!u && f <= 0) continue;
      sig += "|" + r + (u ? (u.work ? "w" + (amb ? Math.floor(now / (AIr.has(id) ? 90 : 80)) : "") : "d") + u.x.cell : "") + ":" + f;
    }
    if (sig === sigL) return;
    sigL = sig;
    c.clearRect(0, 0, g.x0 + 2, g.h); slice(c, stat, 0, Math.ceil(g.x0));
    if (g.ph) {
      for (let r = 0; r < NROWS; r++) {
        const id = rowIds[r], u = cur[id], f = Math.round(FR[r] * 4) / 4;
        let col;
        if (u && u.work) { c.globalAlpha = 1; col = u.col; } else if (f > 0) { c.globalAlpha = f; col = AIr.has(id) ? COL.ai : "#F3F4F0"; } else continue;
        if (SHELL.has(id)) phGlyph(c, g.labW - 12, g.rowY[r], AIr.has(id), col, col);
        else { c.fillStyle = col; c.fillRect(g.labW - 7, g.rowY[r] - g.pitch / 2 + 0.5, 3, g.pitch - 1); }
      }
      c.globalAlpha = 1;
      return;
    }
    const lf = B.clamp(g.pitch - 0.5, 9, 11.5), F = [`500 ${lf}px Inter, system-ui, sans-serif`, `600 ${lf}px Inter, system-ui, sans-serif`, `700 ${lf}px Inter, system-ui, sans-serif`];
    const texts = [[], [], []];
    for (let r = 0; r < NROWS; r++) {
      const id = rowIds[r], y = g.rowY[r], ai = AIr.has(id), sp = d.sp[id], u = cur[id], f = Math.round(FR[r] * 4) / 4;
      if (!u && f <= 0) continue; // idle rows are in the static layer
      c.globalAlpha = 1; c.fillStyle = BG; c.fillRect(g.spine + 1, y - g.pitch / 2, g.x0 - g.spine - 4, g.pitch); // covers the idle label below
      const name = sp.name + (sp.usesAi ? " · uses your AI" : "");
      if (u) {
        glyph(c, g.spine + 8, y, ai, u.col, ai || u.x.cell == "hit" || u.work ? u.col : null);
        if (u.work && amb) matrix(c, g.spine + 8, y, ai, now);
        if (u.work && /rule_finder|checker|lane_gate/.test(id) && u.x.res != "hit") { c.strokeStyle = "rgba(213,242,74,.85)"; c.lineWidth = 1.25; c.beginPath(); c.moveTo(20, y); c.lineTo(g.spine - 1, y); c.stroke(); c.fillStyle = "#D5F24A"; c.beginPath(); c.arc(20, y, 2, 0, 6.3); c.fill(); }
        texts[u.work ? 2 : 1].push([name, y, u.x.cell == "hit" ? "#F08A80" : "#F3F4F0", 1]);
      } else {
        glyph(c, g.spine + 8, y, ai, ai ? COL.ai : "#F3F4F0", null);
        c.globalAlpha = f; glyph(c, g.spine + 8, y, ai, ai ? COL.ai : "#F3F4F0", ai ? COL.ai : "#F3F4F0"); c.globalAlpha = 1;
        texts[0].push([name, y, "#F3F4F0", 0.62 + 0.38 * f]);
      }
    }
    // text last, one font switch per weight
    c.textAlign = "left"; c.textBaseline = "middle";
    texts.forEach((list, i) => { if (!list.length) return; setFont(c, F[i]); for (const [t, y, col, a] of list) { c.globalAlpha = a; c.fillStyle = col; c.fillText(t, g.spine + 30, y + 0.5); } });
    c.globalAlpha = 1;
    // the rulebook spine: 24 rules, 25 once your edit passes its check
    const s0 = g.gy[0][0], s1 = g.gy[2][1], r = g.r;
    c.setTransform(0, -r, r, 0, 11 * r, ((s0 + s1) / 2) * r); // rotate -90° about the spine centre
    c.fillStyle = n25 ? "#D5F24A" : "#F3F4F0"; setFont(c, "600 9.5px Inter, system-ui, sans-serif"); c.textAlign = "center";
    c.fillText(`Your method · ${n25 ? 25 : 24} rules (sample)`, 0, 0);
    c.setTransform(r, 0, 0, r, 0, 0);
  }
  function ghostLayer(c, list, i0, i1, clock, mul, fr, now, amb, halos) {
    const g = G;
    for (let i = i0; i < i1; i++) {
      const gh = list[i];
      const age = clock - gh.m;
      if (age < 0) break;
      const x = g.X(gh.m), fresh = B.clamp(1 - age / 45, 0, 1);
      let y0 = 1e9, y1 = -1e9;
      for (const ce of gh.cells) if (age >= ce.dt) { const y = g.rowY[ce.row]; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (age > gh.end) y1 = g.laneY;
      if (y1 > y0) { c.globalAlpha = (0.12 + 0.45 * fresh) * mul; c.fillStyle = gh.stop ? COL.hit : "#F3F4F0"; c.fillRect(x - 0.5, y0, 1, y1 - y0); }
      for (const ce of gh.cells) {
        const a = age - ce.dt;
        if (a < 0) continue;
        const f = Math.max(0, 1 - a / 40), ai = AIr.has(rowIds[ce.row]), loud = ai || ce.st != "on";
        if (f > 0 && (loud || rowIds[ce.row] == "set_logger")) fr[ce.row] = Math.max(fr[ce.row], f * mul);
        // code checks stay quiet; the one specialist each moment used glows
        let al = loud ? 0.62 + 0.38 * f : 0.26 + 0.5 * f;
        if (amb && a < 140) al *= 0.82 + 0.18 * Math.sin(now / 200 + gh.ph + ce.row * 1.7);
        if (halos && loud) { c.globalAlpha = (0.3 + 0.45 * f) * mul; glow(c, x, g.rowY[ce.row], g.cs * (1.5 + 0.8 * f), COL[ce.st]); }
        c.globalAlpha = al * mul; c.fillStyle = COL[ce.st];
        dot(c, x, g.rowY[ce.row], g.cs * (loud ? 1.15 + 0.3 * f : 0.8 + 0.2 * f), ai);
      }
      if (age > gh.end) { c.globalAlpha = 0.7 * mul; c.fillStyle = COL[gh.lane]; c.fillRect(x - 1.5, g.laneY - 3, 3, 6); }
    }
  }
  function matrix(c, x, y, ai, now) {
    const t = Math.floor(now / (ai ? 90 : 80));
    c.fillStyle = "#171917";
    if (ai) { for (let i = 0; i < 3; i++) if ((t * 7 + i * 3) % 5 < 3) { c.beginPath(); c.arc(x - 4 + i * 4, y, 1.1, 0, 6.3); c.fill(); } }
    else { const col = t % 3; c.fillStyle = "#F3F4F0"; c.fillRect(x - 3 + col * 2.2, y - 2.5, 1.4, 5); }
  }
  /* ---------------- the glance: every moment lit once, in strips drawn just ahead of a composited wipe, then faded
     (QA 27 Oct: one full-board canvas cost a 120 ms task at 4x CPU; a strip is a few ms) */
  let glT = [];
  function glance() {
    if (!G || glReady) return;
    gli.textContent = "";
    glT = G.tiles.map((T) => { const cv = document.createElement("canvas"); cv.style.left = T.a + "px"; gli.append(cv); return { a: T.a, b: T.b, cv, done: false }; });
    glReady = true;
    last.glx = 0; last.glo = "1"; gl.style.opacity = 1; gl.style.transform = `translate3d(${-G.w}px,0,0)`; gli.style.transform = `translate3d(${G.w}px,0,0)`;
    gl.hidden = false;
  }
  function glanceAt() {
    const k = B.clamp(pv / PV_SWEEP, 0, 1), pc = DAY0 + (DAY1 - DAY0) * B.ease.io(k), mul = 1 - B.clamp((pv - PV_SWEEP - PV_HOLD) / PV_FADE, 0, 1);
    // reveal up to 140 sample minutes behind the head; the band canvas draws the fresh part
    const x = k < 1 ? Math.max(0, Math.round(G.X(pc - 140))) : G.w, W = G.w;
    // draw at most one strip a frame, just before the wipe reaches it
    const T = glT.find((t) => !t.done && t.a - 60 <= x);
    if (T) {
      T.done = true;
      const c = B.fit(T.cv, T.b - T.a, G.h); c.setTransform(G.r, 0, 0, G.r, -T.a * G.r, 0);
      for (let i = 0; i < M.allG.length; i++) { const gx = G.X(M.allG[i].m); if (gx >= T.a - 16 && gx <= T.b + 16) ghostLayer(c, M.allG, i, i + 1, DAY1 + 1e4, 1, FR0, 0, false, B.tier.spec.halos); }
      c.globalAlpha = 1;
    }
    if (x !== last.glx) { last.glx = x; gl.style.transform = `translate3d(${x - W}px,0,0)`; gli.style.transform = `translate3d(${W - x}px,0,0)`; }
    const o = mul.toFixed(2); if (o !== last.glo) { last.glo = o; gl.style.opacity = o; }
    return { k, pc, mul };
  }
  function glanceEnd() { gl.hidden = true; gli.textContent = ""; glT = []; glReady = false; }
  // phones (CD review): during the glance the mini Brain lights each specialist as the sweep reaches its moments,
  // so the whole roster is lit by the end of the day (several lit = several members' moments, never one message)
  const seenR = new Uint8Array(NROWS);
  function glanceMini() {
    if (!R.small) return;
    const k = B.clamp(pv / PV_SWEEP, 0, 1);
    for (let r = 0; r < NROWS; r++) {
      const id = rowIds[r], x = R.mini[id]; if (!x) continue;
      const loud = AIr.has(id) || id == "set_logger";
      const hot = loud ? FR[r] > 0.02 : id == "examiner" ? seenR[ROW.learner] : k > 0.04; // any trace of a moment counts as seen (a 30 fps sweep steps ~30 sample minutes a frame)
      if (hot) seenR[r] = 1;
      const v = loud && FR[r] > 0.3 ? "work" : seenR[r] ? "done" : "idle";
      if (x.dataset.state != v) x.dataset.state = v;
    }
  }

  /* ---------------- DOM state (only on change) */
  function setClock(m, rolling) {
    if (!rolling) m = Math.floor(m + 1e-6);
    const t = ((m % 1440) + 1440) % 1440, h = Math.floor(t / 60), mm = t - h * 60;
    const hpos = h + Math.max(0, mm - 59), m1 = Math.floor(mm / 10) + Math.max(0, (mm % 10) - 9), m2 = mm % 10;
    const key = hpos.toFixed(3) + m1.toFixed(3) + m2.toFixed(3);
    if (key == last.clock) return;
    last.clock = key;
    R.hh.style.transform = `translateY(${-hpos}em)`;
    R.m1.style.transform = `translateY(${-(m1 % 6 == 0 && m1 > 0 && mm >= 59 ? 6 : m1)}em)`;
    R.m2.style.transform = `translateY(${-m2}em)`;
  }
  const youAt = (m) => { const t = ((m % 1440) + 1440) % 1440; return t >= 360 && t < 720 ? "coach" : t < 780 && t >= 720 ? "lunch" : t >= 780 && t < 1260 ? "coach" : t >= 1260 && t < 1320 ? "today" : "sleep"; };
  function stepStates(b, st) {
    const q = st.k == (b.outro ? NB : M.beats.indexOf(b)) ? st.q : 1;
    const sig = [];
    for (const x of b.rows) sig.push(q < x.a ? "idle" : q < x.b ? "work" : x.res == "skipped" ? "skip" : x.res == "hit" ? (x.sp == "safety" ? "hit" : "warn") : x.res == "warn" ? "warn" : "done");
    return { q, sig };
  }
  function renderDOM(st) {
    setClock(st.clock, st.rolling);
    const y = youAt(st.clock), sun = (st.clock % 1440) >= 360 && (st.clock % 1440) < 1065 ? "sun" : "moon";
    if (sun != last.sun) { last.sun = sun; R.sun.dataset.k = sun; }
    const t24 = ((st.clock % 1440) + 1440) % 1440, wash = t24 >= 360 && t24 < 1050 ? 1 : t24 >= 1050 && t24 < 1170 ? 1 - (t24 - 1050) / 120 : t24 >= 300 && t24 < 360 ? (t24 - 300) / 60 : 0;
    const wk = (Math.round(wash * 25) / 25).toFixed(2);
    // the wash is its own composited layer: opacity only, no repaint and no style change down the stage
    if (wk != last.wash) { last.wash = wk; R.wash.style.opacity = wk; const m = (a, b) => Math.round(a + (b - a) * 0.06 * wash); BG = `rgb(${m(23, 243)},${m(25, 244)},${m(23, 240)})`; }
    if (y != last.you) { last.you = y; R.you.textContent = COPY.you[y]; R.you.parentNode.dataset.you = y; }
    const b = st.k < 0 ? null : st.k < NB ? M.beats[st.k] : M.outro;
    const bk = b ? b.t : "intro";
    // a fast scroll holds the text panels (the board, clock and counts keep moving); they catch up as soon as it slows
    last.held = HOLD;
    if (HOLD) { tallyState(st); return; }
    if (bk != last.beat) {
      last.beat = bk; last.sig = null; last.typed = null; last.line = null;
      const key = b ? panelKey(b, st.k) : "intro";
      setPanel(key);
      if (!b) setCap(mode == "play" ? "play" : "pin");
      R.nowBox.dataset.beat = bk;
      R.marks.forEach((m) => m.toggleAttribute("data-cur", !!(b && (m.dataset.k == "o" ? b.outro : +m.dataset.k == st.k && !b.outro))));
      R.steps = R.curP.querySelectorAll(".dy-st");
      R.outs = [...R.steps].map((x) => x.querySelector(".dy-out"));
      R.rowB = null;
      if (!b) for (const id in R.mini) R.mini[id].dataset.state = pv === Infinity && R.small ? "done" : "idle"; // after the glance the intro keeps the roster lit
      if (!b) { R.line.textContent = COPY.introLine; R.line.removeAttribute("data-seen"); }
    }
    R.marks.forEach((m) => { const k = m.dataset.k == "o" ? NB : +m.dataset.k; const done = st.k > k || (st.k == k && st.q >= ALL[k].laneQ); if (m._d !== done) { m._d = done; m.toggleAttribute("data-done", done); } });
    if (b) {
      const { q, sig } = stepStates(b, st), s = sig.join();
      const ck = panelKey(b, st.k);
      setCap(b.capQ && B.phone() ? ck + (q < b.capQ ? "a" : "b") : ck);
      if (s != last.sig) {
        last.sig = s; sig.forEach((v, j) => R.steps[j] && (R.steps[j].dataset.state = v));
        let j = -1; sig.forEach((v, i) => v != "idle" && (j = i));
        const x = b.rows[j];
        // long beats (21:00) can have more steps than the panel shows: keep the current one in view
        if (!R.small && R.steps.length) {
          const list = R.steps[0].parentNode;
          if (!R.rowB) { R.rowT = [...R.steps].map((r) => r.offsetTop - list.offsetTop); R.rowB = [...R.steps].map((r, i) => R.rowT[i] + r.offsetHeight); R.listH = list.clientHeight; }
          // (CD review) scroll to a row boundary: the first row shown is whole (a half-cut row could be the stop that matters)
          let want = 0;
          if (j >= 0 && R.rowB[j] > R.listH) { let k = 0; while (k < j && R.rowB[j] - R.rowT[k] > R.listH) k++; want = R.rowT[k]; }
          if (list.scrollTop != want) list.scrollTop = want;
        }
        R.lineStep = x ? `<b>${esc(x.name)}:</b> ${esc(x.say)}` : "";
        R.line.dataset.state = j < 0 ? "idle" : sig[j];
        const ms = {};
        b.rows.forEach((r, i) => { if (r.sp in ROW && sig[i] != "idle") ms[r.sp] = sig[i]; });
        if (R.small) for (const id in R.mini) { const v = ms[id] || "idle"; if (R.mini[id].dataset.state != v) R.mini[id].dataset.state = v; }
      }
      // streamed AI text, in proportion to progress
      // the AI text is laid out once; words are revealed by visibility, so streaming never re-lays out text (QA 27 Oct)
      b.rows.forEach((x, j) => {
        const o = R.outs[j]; if (!o) return;
        const ws = o._ws || (o._ws = [...o.children]), k = B.clamp((q - x.a) / (x.b - x.a), 0, 1), n = Math.round(ws.length * k), was = o._l || 0;
        if (was === n) return;
        for (let i = Math.min(was, n); i < Math.max(was, n); i++) ws[i].classList.toggle("on", i < n);
        if (was > 0) ws[was - 1].classList.remove("last");
        if (n > 0 && n < ws.length) ws[n - 1].classList.add("last");
        o._l = n; o.classList.toggle("is-on", n > 0 && n < ws.length);
      });
      // phones: the current step, then what the member sees (with provenance marks)
      const seen = b.t != "t7" && q >= b.laneQ + 0.04, lk = seen ? "s" : R.lineStep;
      if (R.small && lk != last.line) {
        last.line = lk;
        const ms = b.r.memberSees, verb = b.tr.channel == "voice" ? "hears" : "sees";
        R.line.innerHTML = seen ? `<b>What ${esc(b.tr.member)} ${verb}:</b> ${ms ? ms.parts.map(U.marks).join(" ") : "Nothing yet. It waits for you first."}` : R.lineStep;
        R.line.toggleAttribute("data-seen", seen);
      }
      const showLane = q >= b.laneQ, lc = R.curP.querySelector("[data-dy-lc]");
      if (lc && lc._s !== showLane) { lc._s = showLane; lc.classList.toggle("is-on", showLane); lc.setAttribute("aria-hidden", String(!showLane)); }
      const sees = R.curS.firstElementChild;
      if (sees) { const on = b.t == "t7" ? q >= 0.5 : q >= b.laneQ - 0.02; if (sees._s !== on) { sees._s = on; sees.classList.toggle("is-on", on); } }
      // floors: red words + the stamp
      if (b.hitQ != null) {
        const hit = q >= b.hitQ - 0.04, msg = R.curP.querySelector("[data-dy-msg]");
        if (msg && msg._h !== hit) { msg._h = hit; const tr = b.tr, hl = tr.steps.find((s) => s.highlight); let s2 = esc(tr.trigger.text); if (hit && hl) for (const w of hl.highlight) s2 = s2.split(esc(w)).join(`<mark class="bp-hl">${esc(w)}</mark>`); msg.innerHTML = s2; }
        const sk = B.clamp((q - b.hitQ) / 0.06, 0, 1), so = sk > 0 ? "1" : "0", stf = `translate(-50%,-50%) rotate(-5deg) scale(${(1.14 - 0.14 * sk).toFixed(3)})`;
        if (so != last.so) { last.so = so; R.stamp.style.opacity = so; }
        if (stf != last.stf) { last.stf = stf; R.stamp.style.transform = stf; }
      } else if (last.so != "0") { last.so = "0"; R.stamp.style.opacity = 0; }
      if (b.t == "t7") editState(q);
    } else if (last.so != "0") { last.so = "0"; R.stamp.style.opacity = 0; }
    todayState(st);
    tallyState(st);
    const e = st.k >= NB && st.q >= 0.62;
    // the end card is always laid out; showing it is a visibility change, not a layout one
    if (e !== last.end) { last.end = e; R.end.toggleAttribute("data-on", e); R.end.setAttribute("aria-hidden", String(!e)); el.toggleAttribute("data-ended", e); }
    if (mode == "play") {
      const v = Math.round(P * 1000);
      if (v != last.rv) { last.rv = v; R.range.value = v; }
      const vt = b ? `${b.at}, ${b.name}` : "06:00, the day starts";
      if (vt != last.vt) { last.vt = vt; R.range.setAttribute("aria-valuetext", vt); }
    }
  }
  function editState(q) {
    const cl = R.curP.querySelector("[data-dy-clear]");
    if (cl) { [...cl.children].forEach((li, i) => li.toggleAttribute("data-done", q >= 0.17 + i * 0.06)); cl.toggleAttribute("data-gone", q >= 0.36); }
    const typed = R.curS.querySelector("[data-dy-typed]"), want = "2.5 kg", L = Math.round(want.length * B.clamp((q - 0.56) / 0.08, 0, 1));
    if (typed && last.typed !== L) { last.typed = L; typed.textContent = want.slice(0, L); R.curS.querySelector("[data-dy-s]").classList.toggle("is-on", q >= 0.55); }
    [["[data-dy-c1]", 0.64], ["[data-dy-c2]", 0.76], ["[data-dy-c3]", 0.9]].forEach(([s, a]) => { const x = R.curS.querySelector(s); x && x.classList.toggle("is-on", q >= a); });
    const cf = R.curS.querySelector("[data-dy-conf]"); if (cf) { const v = q >= 0.84 ? "Confirmed" : ""; if (cf.textContent != v) cf.textContent = v; }
  }
  function todayState(st) {
    const tk = M.beats.findIndex((x) => x.t == "t7");
    let sig = "", waiting = 0;
    const want = {};
    ALL.forEach((b, i) => {
      const k = b.outro ? NB : i;
      if (!b.today || !past(st, k, b.todayQ)) return;
      let done = false;
      if (b.t == "t7") done = past(st, tk, 0.9);
      else if (!b.outro && tk >= 0) done = past(st, tk, 0.17 + 0.06 * ["t2", "t8", "t10"].indexOf(b.t));
      want[b.t] = done; sig += b.t + (done ? "d" : "") + ","; if (!done) waiting++;
    });
    if (sig == last.today) return;
    last.today = sig;
    for (const li of R.tcs) {
      const t = li.dataset.t, on = t in want, done = !!want[t], b = ALL.find((x) => x.t == t);
      if (li.hidden == on) { li.hidden = !on; li.toggleAttribute("data-in", on); }
      if (li.hasAttribute("data-done") != done) {
        li.toggleAttribute("data-done", done); li.querySelector(".dy-ok").hidden = !done;
        if (b.today.done) li.querySelector("span").textContent = done ? b.today.done : b.today.sub;
      }
    }
    R.tl.toggleAttribute("data-empty", !sig);
    R.cnt.textContent = `${waiting} waiting`;
    const note = past(st, NB, 0.46) ? "Once a week, your AI reads your edits and suggests new rules. They wait for your OK." : "";
    if (R.tnote.textContent != note) R.tnote.textContent = note;
  }
  function tallyState(st) {
    const c = { sent: 0, member: 0, waits: 0, paused: 0, learn: 0 };
    ALL.forEach((b, i) => {
      const k = b.outro ? NB : i;
      if (b.t == "t7") { if (past(st, k, 0.5)) c.waits++; if (past(st, k, 0.95)) c.learn++; return; }
      if (past(st, k, b.laneQ)) c[b.lane]++;
    });
    for (const k in c) if (R.n[k] && R.n[k]._v !== c[k]) { R.n[k]._v = c[k]; R.n[k].textContent = c[k]; R.n[k].parentNode.toggleAttribute("data-bump", true); setTimeout(() => R.n[k].parentNode.removeAttribute("data-bump"), 400); }
  }

  /* ---------------- drivers */
  // canvas first: setting ctx.font resolves the canvas element's style, which would force a style recalc after DOM writes (QA 27 Oct)
  let V = 0, vP = null, vT = 0, HOLD = false, labN = 0;
  function frame(now) {
    if (vP != null && now > vT) V = V * 0.7 + 0.3 * ((Math.abs(P - vP) / (now - vT)) * 1000);
    vP = P; vT = now;
    HOLD = mode == "pin" && V > 0.12; // p per second: the whole day in under ~8 s of scrolling
    draw(now); renderDOM(stateAt(M, SG, P));
  }
  const ambient = sc.loop((dt, now) => {
    if (pv >= 0 && pv < PV_END) {
      pv += dt;
      if (mode == "pin" && PT > 0.03) pv = PV_END; // the visitor is already scrolling the day: skip the glance
      if (pv >= PV_END) { pv = Infinity; glanceEnd(); last.beat = undefined; if (mode == "play") started = true; }
      else { draw(now); renderDOM(stateAt(M, SG, P)); glanceMini(); setClock(DAY0 + (DAY1 - DAY0) * B.ease.io(B.clamp(pv / PV_SWEEP, 0, 1)), pv < PV_SWEEP); setCap("glance"); return; }
    }
    if (mode == "play") {
      if (!started || ended) return false;
      T = Math.min(SG.tot, T + dt);
      P = T / SG.tot;
      if (T >= SG.tot) { ended = true; frame(now); pause(); return false; }
    } else if (Math.abs(PT - P) > 1e-4) P += (PT - P) * (1 - Math.exp(-dt / 90));
    // at rest: draw only what moves on its own; with nothing moving, tick slowly without drawing (so idle still pauses)
    else if (P == PT && last.p === P) { if (last.held) frame(now); else if (G && G.td) draw(now); ambient.fps = last.held || (G && G.td) ? 30 : 2; return; }
    else P = PT;
    last.p = P;
    frame(now);
    if (mode == "pin") ambient.fps = P == PT ? 30 : 60;

  }, 60);
  // pin: scroll → target p (works even when the ambient sparkle is paused)
  const wrap = el.querySelector("[data-dy-pin]") || el;
  let scrollSub = null;
  // geometry is read on resize only, so a scroll never forces a layout
  let geo = null;
  function measure() {
    const r = wrap.getBoundingClientRect(), hdr = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 72;
    geo = { top: scrollY + r.top, span: Math.max(1, r.height - (innerHeight - hdr)), hdr };
  }
  function readScroll() {
    if (!geo) measure();
    PT = B.clamp((scrollY + geo.hdr - geo.top) / geo.span, 0, 1);
    // paused by the visitor (or idle): the scroll still drives the day. Off screen or in a hidden tab: nothing to draw (QA 27 Oct)
    if (!sc.running) {
      if (sc.reasons.has("offscreen") || sc.reasons.has("hidden")) return;
      if (!scrollSub) scrollSub = B.loop((dt, now) => { if (sc.running || sc.reasons.has("offscreen") || sc.reasons.has("hidden")) return false; if (P == PT && last.p === P && !last.held) return false; P += (PT - P) * (1 - Math.exp(-dt / 90)); if (Math.abs(PT - P) < 1e-4) P = PT; last.p = P; frame(now); if (P == PT && !last.held) return false; });
      else scrollSub.wake();
    } else ambient.wake();
  }
  if (mode == "pin") { addEventListener("scroll", readScroll, { passive: true }); readScroll(); P = PT; }
  new ResizeObserver(() => { if (mode == "pin") { measure(); readScroll(); } }).observe(document.body);
  const io = new IntersectionObserver((e) => {
    if (!e.some((x) => x.intersectionRatio >= 0.45) || pv != -1) return;
    io.disconnect();
    if (P < 0.02) { pv = 0; glance(); } else if (mode == "play") started = true;
    ambient.wake();
  }, { threshold: [0, 0.45, 0.6] });
  io.observe(stage);
  sc.o.onState = (run) => { if (run) ambient.wake(); };
  new IntersectionObserver((e) => { const x = e[e.length - 1]; document.documentElement.classList.toggle("dy-on", x.intersectionRatio > 0.3); stage.classList.toggle("dy-live", x.isIntersecting); }, { threshold: [0, 0.3, 0.6] }).observe(stage);

  /* ---------------- visitor controls (these announce; the auto-play never does) */
  const beatStart = (k) => { const s = SG.list[k + 1]; return (s.a + s.len * 0.74) / SG.tot; };
  function jump(k) {
    k = B.clamp(k, 0, NB);
    const b = ALL[k], p = beatStart(k);
    if (pv >= 0 && pv < PV_END) { pv = Infinity; glanceEnd(); last.beat = undefined; }
    if (mode == "pin") {
      const r = wrap.getBoundingClientRect(), hdr = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 72;
      const span = r.height - (innerHeight - hdr);
      scrollTo({ top: scrollY + r.top - hdr + p * span + 2, behavior: "smooth" });
    } else {
      started = true; ended = false; T = p * SG.tot; P = T / SG.tot; pause(); frame(performance.now());
    }
    B.say(`${b.at}, ${b.name}: ${Dec.laneText(d, b.lane)}`);
  }
  const curK = () => stateAt(M, SG, P).k;
  $("[data-dy-prev]").addEventListener("click", () => jump(curK() - 1));
  $("[data-dy-next]").addEventListener("click", () => jump(curK() < 0 ? 0 : curK() + 1));
  R.marks.forEach((m) => m.addEventListener("click", () => jump(m.dataset.k == "o" ? NB : +m.dataset.k)));
  R.range.addEventListener("input", () => { if (pv >= 0 && pv < PV_END) { pv = Infinity; glanceEnd(); last.beat = undefined; } started = true; ended = false; pause(); P = R.range.value / 1000; T = P * SG.tot; frame(performance.now()); });
  $("[data-dy-replay]").addEventListener("click", () => {
    if (mode == "pin") { const r = wrap.getBoundingClientRect(); scrollTo({ top: scrollY + r.top - 80, behavior: "smooth" }); return; }
    T = 0; P = 0; ended = false; started = true; sc.play(); ambient.wake(); B.say("Replaying the sample day");
  });
  $(".dy-pause").addEventListener("click", () => { if (mode == "play" && ended && sc.running) { T = 0; P = 0; ended = false; ambient.wake(); } });

  /* ---------------- size, fonts, tier, mode changes */
  // a later size change re-lays out; the first callback (on observe) is left to the mount's own layout below
  new ResizeObserver(() => { if (!G || (Math.round(board.clientWidth) == G.w && Math.round(board.clientHeight) == G.h)) return; layout(); }).observe(board);
  // canvas text needs the web fonts: redraw once they load (only if they were not loaded at mount)
  if (document.fonts && document.fonts.status != "loaded") document.fonts.ready.then(() => G && layout());
  // a tier step-down changes the DPR of the per-frame canvases only; the static layer and the strips stay as drawn
  B.tier.on(() => { if (!G) return; G.r = Math.min(window.devicePixelRatio || 1, B.tier.spec.dpr); cB = B.fit(cvB, G.bw, G.h); cL = B.fit(cvL, Math.ceil(G.x0), G.h); cL._f = null; sigL = offB = null; draw(performance.now()); });
  let rz = 0;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { const m = pickMode(); if (m != mode && m != "cards") { mode = m; el.setAttribute("data-mode", mode); SG = segs(M, mode); last = {}; if (mode == "pin") { addEventListener("scroll", readScroll, { passive: true }); readScroll(); P = PT; } else { started = true; T = P * SG.tot; } layout(); } }, 200); });
  await nextTask();
  layout(true);
  frame(performance.now());
  return (el.__dy = { M, get p() { return P; }, set p(v) { PT = P = v; T = v * SG.tot; frame(performance.now()); }, sc, mode: () => mode, state: () => stateAt(M, SG, P) });
}
export default mount;
