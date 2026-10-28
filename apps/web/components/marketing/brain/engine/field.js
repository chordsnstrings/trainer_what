/* The field and the board's runtime: the home hero's "sample hour of your
   Brain" and band 2's board, playing on the server's first frame
   (field.render.js). Static rails are inline SVG drawn once per layout;
   everything that moves (rail dashes, dots, ghosts, rule lines, the nodes'
   3×3 matrices) is one canvas above the nodes, on the engine's one loop.
   Lines stop at node, lane and message boxes, so they pass "under" them.

   Ported from the approved prototype's runtime half (docs/marketing-revamp-
   2026-10-26/prototypes/concept-a/site/assets/a-field.js) with the changes
   of docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.1 and WP2:
   - its CSS is a static import (field.run.css), receipts come through
     import("./receipt.js") and the prefetch takes that loader;
   - destroy() undoes everything: listeners, observers, timers, the scene,
     an open receipt or sheet, the overlay layer; the settings the field and
     the board share are counted and dropped with the last of them;
   - no debug switch, no test handle on the root;
   - reduced motion starts on "Play the field" with aria-pressed="true";
   - the board sets its own data-sc="on" and has no live region (say());
   - the phone settings sheet and receipts mount in the overlay layer;
   - nothing moves in layout once it plays: lane tiles sit in their lists
     by transforms, Noura's tile keeps its slot until her stop lands it,
     streamed and typed words reserve their final size, counts and the
     Pause label have fixed widths, and the reduced-motion still frame adds
     tiles under the ones already shown (zero layout shift);
   - the Paused count holds each stop once in the reduced-motion frame (the
     prototype landed Noura's twice). */
import "./field.run.css";
import raw from "../data/traces.client.json";
import * as C from "./core.js";
import { prepare } from "./data.js";
import { decide, defaults, isOff, pick, totals } from "./decide.js";
import * as U from "./ui.js";
import { AFTER, COPY, FIRST, SHELL, START, fill, id0, msgHTML, subHTML, tileHTML } from "./field.render.js";
const { h, esc, clamp } = C;

const BUB = { voice_lines: "Lines ready", learner: "Suggests: Upper body increments" };
const BLIP_AI = 620, BLIP_CODE = 300; // a ghost (another member's moment) passing through a node: how long it shows busy
const CAP = { sent: 12, waits: 8, paused: 4 }, SHOW = { sent: 4, waits: 3, paused: 2 };
const PACE = "#D5F24A", RED = "#F08A80", AMBER = "#E0B25C", GREEN = "#7FCB9F", PAPER = "#F3F4F0", INK = "#171917";
const LC = { sent: GREEN, waits: AMBER, paused: RED, member: "#C9CEC6", learn: PACE };
const EASE = "cubic-bezier(.4, 0, .2, 1)", ENTER = "cubic-bezier(.2, .8, .2, 1)", SPRING = "cubic-bezier(.34, 1.4, .64, 1)";

/* ------------------------------------------------------------------ the page's settings
   One settings object per page: the field, the board and their receipts
   share it. Counted by mount; the last destroy drops it. */
let page = null;
function share(o) {
  if (!page) {
    const d = prepare(raw, o);
    page = { d, S: defaults(d), subs: new Set(), touched: false, n: 0 };
  }
  page.n++;
  return page;
}
function unshare(p) {
  if (p == page && --p.n <= 0) page = null;
}
/** Changes one setting; every listener re-sorts (src: "user" or "demo"; by: the
    root whose control changed it, the only one that announces the change). */
function set(p, k, v, src, by) {
  if (p.S[k] === v) return;
  p.S[k] = v;
  p.subs.forEach((f) => f(k, src, by));
}

/** Mounts on the root (brain/mount.tsx calls it after load, idle and near). */
export async function mount(root, o) {
  const p = share(o);
  try {
    return o.kind == "board" ? mountBoard(root, o, p) : mountField(root, o, p);
  } catch (e) {
    unshare(p);
    throw e;
  }
}

/* ------------------------------------------------------------------ lifecycle helpers */
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
/** The inline direction's sign (WAAPI keyframes are physical). */
const signOf = (el) => (getComputedStyle(el).direction == "rtl" ? -1 : 1);

/* ------------------------------------------------------------------ shared control wiring */
function wireControls(box, p, k, root) {
  const d = p.d, lvs = [...box.querySelectorAll("[data-level]")], rng = box.querySelector(".mc-bar input"), out = box.querySelector(".mc-bar output");
  const sw = box.querySelector(".mc-sw"), lock = box.querySelector(".mc-lock"), now = box.querySelector(".mc-lvnow");
  box.querySelectorAll("button[disabled], input[disabled]").forEach((b) => (b.disabled = false));
  const setLv = (n, demo) => {
    if (!demo) p.touched = true;
    set(p, "level", n, demo ? "demo" : "user", root); // every control set's sync() then updates its radios
  };
  lvs.forEach((b) => {
    k.on(b, "click", () => setLv(+b.dataset.level));
    k.on(b, "keydown", (e) => {
      const i = lvs.indexOf(b), key = e.key, n = key == "ArrowRight" || key == "ArrowDown" ? 1 : key == "ArrowLeft" || key == "ArrowUp" ? -1 : 0;
      if (!n) return;
      e.preventDefault();
      const nb = lvs[(i + n + 3) % 3];
      nb.focus();
      setLv(+nb.dataset.level);
    });
  });
  let deb = 0;
  k.add(() => clearTimeout(deb));
  rng && k.on(rng, "input", () => {
    out.textContent = rng.value + "%";
    rng.setAttribute("aria-valuetext", rng.value + "%");
    paint(rng);
    clearTimeout(deb);
    deb = setTimeout(() => { p.touched = true; set(p, "bar", +rng.value, "user", root); }, 120);
  });
  sw && k.on(sw, "click", () => { p.touched = true; set(p, "supplementsTopic", !p.S.supplementsTopic, "user", root); });
  let tip = 0;
  k.add(() => clearTimeout(tip));
  lock && k.on(lock, "click", () => {
    replay(lock, "is-shake");
    lock.classList.add("is-tip");
    clearTimeout(tip);
    tip = setTimeout(() => lock.classList.remove("is-tip"), 3200);
    C.say(lock.querySelector(".mc-tip").textContent);
  });
  function paint(r) { r.style.setProperty("--fill", fill(d, +r.value) + "%"); }
  const sync = () => {
    const S = p.S;
    lvs.forEach((b) => { const on = +b.dataset.level == S.level; b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1; });
    if (now) now.textContent = d.labels.levels[S.level].name;
    if (rng && +rng.value != S.bar) { rng.value = S.bar; out.textContent = S.bar + "%"; rng.setAttribute("aria-valuetext", S.bar + "%"); paint(rng); }
    sw && sw.setAttribute("aria-checked", S.supplementsTopic);
  };
  p.subs.add(sync);
  k.add(() => p.subs.delete(sync));
  sync();
  return { setLv, lvs, rng, sw, lock };
}

/* ------------------------------------------------------------------ one-shot effects
   Replays a one-shot CSS effect without a forced reflow: the first time the
   class starts the CSS animation; after that the same keyframes run through
   WAAPI (pseudo-element effects need WAAPI pseudoElement support). */
const FXK = {
  "is-land": (s) => [[{ opacity: 0, transform: `translateX(${-10 * s}px)` }, { opacity: 1, transform: "translateY(0)" }], { duration: 280, easing: ENTER }],
  "is-roll": () => [[{ opacity: 0.2, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: ENTER }],
  "is-bounce": () => [[{ transform: "translateY(-4px)" }, { transform: "none" }], { duration: 420, easing: SPRING }],
  "is-flash2": () => [[{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: EASE, pseudoElement: "::after" }],
  "is-alarm": () => [[{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: EASE, pseudoElement: "::after" }],
  "is-cite": () => [[{ opacity: 1 }, { opacity: 0 }], { duration: 640, easing: EASE, pseudoElement: "::after" }],
  "is-nudge": () => [[{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(1.025, 1.3)" }], { duration: 900, iterations: 2, easing: EASE, pseudoElement: "::after" }],
  "is-pulse": () => [[{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(1.6)" }], { duration: 900, iterations: 2, easing: EASE, pseudoElement: "::after" }],
  "is-ping": () => [[{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(1.1, 1.6)" }], { duration: 900, iterations: 2, easing: EASE, pseudoElement: "::after" }],
};
const PSEUDO_FX = () => typeof KeyframeEffect != "undefined" && "pseudoElement" in KeyframeEffect.prototype;
function replay(el, cls, sign = 1) {
  if (!el) return;
  if (!el.classList.contains(cls)) { el.classList.add(cls); return; }
  const k = FXK[cls] && FXK[cls](sign);
  if (k && el.animate && (!k[1].pseudoElement || PSEUDO_FX())) { try { el.animate(k[0], k[1]); return; } catch { /* the class restart below */ } }
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
}
/** FLIP: first rects in, animate every moved element from there (WAAPI, finite). */
function flip(first, ms) {
  let i = 0;
  first.forEach((a, el) => {
    const b = el.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: ms, delay: 40 * i++, easing: EASE, fill: "backwards" });
  });
}

/* ------------------------------------------------------------------ receipts */
/** Opens a moment's receipt (receipt.js): in the field's zoom on desktop, else a
    dialog or (phones) a bottom sheet in the overlay layer. */
async function openReceipt(id, from, ctx) {
  const A = await import("./receipt.js");
  if (ctx.dead()) return null;
  const opt = { d: ctx.p.d, settings: ctx.p.S, from: from.getBoundingClientRect(), cta: ctx.o.cta, id: ctx.o.id, layer: ctx.layer, onClose: ctx.onClose, onChange: ctx.onChange };
  if (ctx.zoom && !C.phone()) {
    opt.mount = await ctx.zoom(id);
    if (ctx.dead()) return null;
  } else if (ctx.hold) ctx.hold(true);
  return A.open(id, opt);
}

/* ------------------------------------------------------------------ the board */
function mountBoard(root, o, p) {
  const d = p.d, RM = C.reduced(), L = C.layer(root), k = owned();
  let dead = false, rx = null, seen = false;
  wireControls(root.querySelector(".mb-ctrl"), p, k, root);
  const note = root.querySelector(".mb-note"), diff = root.querySelector(".mb-diff"), tot = root.querySelector(".mb-tot");
  const lists = {}, cards = {};
  root.querySelectorAll(".mb-col").forEach((c) => (lists[c.dataset.lane] = c.querySelector(".mb-list")));
  root.querySelectorAll(".mb-c").forEach((c) => (cards[c.dataset.t] = c));
  // Re-sorts animate only while the board is on screen. Off screen (the
  // field's auto-demo, far above) it re-sorts at once and nobody sees a move.
  const io = new IntersectionObserver((e) => (seen = e[e.length - 1].isIntersecting));
  io.observe(root);
  k.add(() => io.disconnect());
  k.on(root, "click", async (e) => {
    const b = e.target.closest(".mb-b");
    if (!b) return;
    const api = await openReceipt(b.dataset.t, b, { p, o, layer: L.el, dead: () => dead, onClose: () => (rx = null) });
    if (api) rx = api;
  });
  function apply(key, src, anim, by) {
    const S = p.S, moved = [], first = new Map();
    if (anim) Object.values(cards).forEach((c) => first.set(c, c.getBoundingClientRect()));
    for (const id in cards) {
      const t = d.trace(id), r = decide(t, S, d), c = cards[id], col = c.closest(".mb-col").dataset.lane;
      const su = c.querySelector(".mb-sure");
      if (su) { su.textContent = r.sure ? r.sure.display : ""; su.dataset.ok = r.lane == "sent" ? 1 : 0; }
      c.querySelector(".mb-why").textContent = id == "t9" && !S.supplementsTopic ? COPY.drafted : "";
      if (col != r.lane) { lists[r.lane].append(c); moved.push([t, col, r]); }
    }
    root.querySelectorAll(".mb-col").forEach((c) => (c.querySelector(".mb-n").textContent = c.querySelectorAll(".mb-c").length));
    if (anim) flip(first, 420);
    if (key == "level") note.textContent = d.labels.levels[S.level].summary + (S.level > 1 ? " " + d.labels.levels.note : "");
    else if (key == "supplementsTopic" && !S.supplementsTopic) note.textContent = COPY.suppOff;
    tot.textContent = totals(d, S);
    // Only a change the visitor made is described (and announced); the auto-demo says nothing.
    const said = src != "user" ? "" : moved.length ? moved.map(([t, b, r]) => `${t.member}: before, ${d.labels.lanes[b]}. Now, ${d.labels.lanes[r.lane]}.${r.why ? " Why: " + r.why : ""}`).join(" ")
      : key == "bar" ? "No moment crossed your bar." : key == "supplementsTopic" ? (S.supplementsTopic ? "Khalid's question waits for you personally." : "Khalid's question still waits for you, drafted for you. " + COPY.suppOff) : "";
    diff.textContent = said;
    if (said && by == root) C.say(said);
  }
  const resort = (key, src, by) => apply(key, src, seen && !RM, by);
  p.subs.add(resort);
  k.add(() => p.subs.delete(resort));
  apply(null, "", false); // the field may have changed a setting already
  root.setAttribute("data-sc", "on");
  root.setAttribute("data-sc-tier", C.tier.name);
  return {
    destroy() {
      if (dead) return;
      dead = true;
      k.clear();
      rx && rx.close(true);
      L.release();
      unshare(p);
    },
  };
}

/* ------------------------------------------------------------------ the field */
function mountField(root, o, p) {
  const d = p.d, RM = C.reduced(), k = owned(), L = C.layer(root), sign = signOf(root);
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const body = $(".mc-body"), frame = $(".mc-frame"), rails = $(".mc-rails"), cv = $(".mc-cv2"), sheet = $(".mc-sheet"), moreb = $(".mc-moreb");
  const sheetHome = sheet.parentElement, pb = $(".mc-pause");
  let ph = C.phone(), G = null, ctx = null, W = 0, T = 0, freeze = 0, seq = 0, drawnAt = -1e9, dead = false;
  const Q = [], dots = [], rules = [], streams = [], rips = [], R = C.rng(7), RG = C.rng(11);
  const at = (t, fn) => { let i = Q.length; while (i && Q[i - 1][0] > t) i--; Q.splice(i, 0, [t, fn]); };
  const sc = C.scene(root, { onState: (run, why) => { $(".mc-reading").hidden = !why.includes("read"); } });
  const NS = {}, nodes = {};
  $$(".mc-frame [data-sp]").forEach((n, i) => {
    const sp = n.dataset.sp;
    nodes[sp] = n; NS[sp] = { mode: "idle", t0: 0, i, ai: n.dataset.kind == "ai", on: [], roll: 0, owner: 0, blip: 0, b0: 0 };
  });
  const lanes = {}, lists = {};
  $$(".mc-lane").forEach((sec) => { lanes[sec.dataset.lane] = sec; lists[sec.dataset.lane] = sec.querySelector(".mc-tl"); });
  root.classList.add("sc-cv");

  /* ---- reset the server-rendered result states, then play (a settled frame keeps them).
     Noura's tile keeps its slot in Training paused, hidden, until her stop lands it. */
  const resetFirst = () => {
    $$(".mc-li.sc-res").forEach((li) => li.classList.add("is-due"));
    frame.classList.remove("is-stop", "is-dim");
    $(".mc-in .mc-msg").classList.remove("is-hit", "mc-hitres");
    $$(".mc-hitres").forEach((e) => e.classList.remove("mc-hitres"));
    setNode("safety", "idle");
  };

  /* ---- geometry: rects relative to the body, read once and on resize */
  const Y = new Map(), HT = new Map(); // a tile's offset in its list; tile heights by content
  function measure() {
    ph = C.phone();
    dock();
    const b = body.getBoundingClientRect();
    const R_ = (el) => { const r = el.getBoundingClientRect(), x = r.left - b.left, y = r.top - b.top; return { x, y, w: r.width, h: r.height, r: x + r.width, b: y + r.height, cx: x + r.width / 2, cy: y + r.height / 2 }; };
    const g = { W: b.width, H: b.height, n: {}, m: {}, lane: {}, mx: {} };
    if (!ph) for (const l in lists) lists[l].classList.add("is-stack");
    for (const sp in nodes) if (nodes[sp].offsetParent) {
      g.n[sp] = R_(nodes[sp]);
      const slot = nodes[sp].querySelector(".sc-mx");
      if (slot && slot.offsetParent && slot.offsetWidth) g.mx[sp] = R_(slot);
    }
    $$(".mc-m").forEach((m) => (g.m[m.dataset.t] = R_(m)));
    for (const l in lanes) g.lane[l] = { box: R_(lanes[l]), list: R_(ph ? lanes[l].querySelector(".mc-lh") : lists[l]) };
    g.fr = R_(frame); g.inb = R_($(".mc-in")); g.shell = R_($(".mc-shell")); g.first = R_($(".mc-first")); g.after = R_($(".mc-after"));
    g.spine = ph ? null : R_($(".mc-spine")); g.lanes = R_($(".mc-lanes"));
    g.learn = ph ? null : R_($(".mc-learn"));
    g.bus1 = (g.first.b + g.shell.y) / 2; g.bus2 = (g.shell.b + g.after.y) / 2;
    const r1 = SHELL[0].map((sp) => g.n[sp]);
    g.ch = [(g.shell.x + r1[0].x) / 2, (r1[0].r + r1[1].x) / 2, (r1[1].r + r1[2].x) / 2, (r1[2].r + g.shell.r) / 2];
    g.gL = ph ? g.fr.x + 4 : g.fr.x - 8;
    g.nr = ph ? g.shell.r + 4 : (g.shell.r + g.spine.x) / 2;
    g.gR = ph ? g.fr.r - 4 : g.lanes.x - 8;
    g.bot = ph ? g.lanes.y - 7 : g.H - 5;
    // boxes the moving layer never draws inside (lines are cut at their edges in JS), so dots pass "under" nodes,
    // lane cards and the message: a canvas clip or an erase pass costs a full-canvas mask every frame.
    g.boxes = [...Object.values(g.n), ...Object.values(g.lane).map((l) => l.box), g.inb, ...(ph ? [R_($(".mc-cr"))] : [])].map((r) => ({ x: r.x, y: r.y, r: r.r, b: r.b })); // phones: the readout line too
    G = g;
    ctx = C.fit(cv, g.W, g.H);
    drawnAt = -1e9;
    rails.setAttribute("width", g.W); rails.setAttribute("height", g.H); rails.setAttribute("viewBox", `0 0 ${g.W} ${g.H}`);
    rails.innerHTML = drawStatic();
    HT.clear();
  }
  const col = (sp) => { const c = G.ch; return SHELL.findIndex((r) => r.includes(sp)) < 0 ? [c[0], c[1]] : [c[SHELL.flat().indexOf(sp) % 3], c[SHELL.flat().indexOf(sp) % 3 + 1]]; };
  const row = (sp) => SHELL.findIndex((r) => r.includes(sp));

  /* ---- static rails (inline SVG, drawn once per layout) */
  function drawStatic() {
    const g = G, out = [], f = (v) => Math.round(v * 10) / 10;
    const Ln = (pts, a = 0.17, w = 1) => out.push(`<path d="M${pts.map((q) => f(q[0]) + " " + f(q[1])).join("L")}" stroke-opacity="${a}"${w != 1 ? ` stroke-width="${w}"` : ""}/>`);
    Ln([[g.gL, g.bus1], [g.nr, g.bus1]]); Ln([[g.gL, g.bus2], [g.nr, g.bus2]]);
    for (const x of g.ch) Ln([[x, g.bus1], [x, g.bus2]], 0.08);
    Ln([[g.nr, g.bus1], [g.nr, g.bus2]], 0.08);
    for (const sp of FIRST) { const n = g.n[sp]; Ln([[n.cx, g.inb.b], [n.cx, g.bus1]], 0.08); }
    for (const sp of AFTER) { const n = g.n[sp]; Ln([[n.cx, g.bus2], [n.cx, n.cy]]); }
    for (const r of [...SHELL, ["set_logger"]]) { const n = g.n[r[0]]; Ln([[g.ch[0], n.cy], [g.ch[3], n.cy]], 0.08); }
    Ln([[g.first.x, g.first.cy], [g.first.r, g.first.cy]], 0.1); Ln([[g.after.x, g.after.cy], [g.after.r, g.after.cy]], 0.1);
    if (!ph) {
      Ln([[g.gL, g.inb.y], [g.gL, g.bot], [g.gR, g.bot], [g.gR, g.lanes.y + 14]], 0.1);
      for (const key in g.m) { const m = g.m[key]; Ln([[m.r, m.cy], [g.gL, m.cy]], 0.06); }
      const ln = g.learn; Ln([[ln.x, ln.cy], [ln.r, ln.cy]], 0.1);
    } else Ln([[g.gL, g.inb.cy], [g.gL, g.bot], [g.gR, g.bot]], 0.1);
    return `<g fill="none" stroke="${PAPER}">${out.join("")}</g>`;
  }
  const laneRails = () => {
    const g = G, gate = g.n.lane_gate;
    return ["sent", "waits", "paused"].map((l) => {
      const t = laneTarget(l);
      return [l, ph ? [[gate.cx, gate.b], [gate.cx, g.bot], [t[0], g.bot], t] : [[gate.r, gate.cy], [g.gR, gate.cy], [g.gR, t[1]], t]];
    });
  };
  const laneTarget = (l) => { const Ln = G.lane[l]; return ph ? [Ln.box.cx, Ln.box.cy] : [Ln.box.x + 16, Ln.list.y + 12]; };

  /* ---- nodes and matrices */
  function setNode(sp, state, o2 = {}) {
    const n = nodes[sp];
    if (!n) return;
    const s = NS[sp];
    if (o2.owner) s.owner = o2.owner;
    else if (o2.ifOwner && s.owner != o2.ifOwner) return;
    n.dataset.state = state;
    const who = o2.owner && WHO[o2.owner];
    if (who && state != "idle") n.dataset.who = who; else if (n.dataset.who) delete n.dataset.who;
    s.mode = state == "work" ? (s.ai ? "ai" : "code") : state == "hit" ? "hit" : state == "skip" ? "skip" : state == "idle" ? "idle" : "pass";
    s.t0 = T;
    if (o2.val != null) n.querySelector(".mc-v").textContent = o2.val;
    if (state == "idle" && !o2.keepVal) n.querySelector(".mc-v").textContent = "";
  }
  const disp = (rr) => (ph ? rr.sure.display.replace(" · your bar", " · bar") : rr.sure.display); // phones: fits the node
  const release = (sp, owner, ms = 1400) => at(W + ms, () => { if (NS[sp].owner == owner) setNode(sp, "idle"); });
  /* Matrices are drawn on the top canvas at each node's slot (one canvas, no per-node layers). */
  function drawMx(now, c) {
    const dim = frame.classList.contains("is-dim");
    for (const sp in NS) {
      const s = NS[sp], m = G.mx[sp], st = nodes[sp].dataset.state, lit = st == "lit" || s.mode == "ai";
      if (!m || nodes[sp].hasAttribute("data-off")) continue;
      const age = now - s.t0, blip = now < s.blip && s.mode == "idle", dk = dim && sp != "safety" ? 0.35 : 1;
      if ((s.mode == "ai" || (blip && s.ai)) && now - s.roll > 90) { s.roll = now; s.on = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(() => RG() < 0.45); }
      for (let i = 0; i < 9; i++) {
        const cx = i % 3, cy = (i / 3) | 0;
        let a;
        if (s.mode == "idle") a = 0.18 + 0.14 * (0.5 + 0.5 * Math.sin(((now + s.i * 230) / 2800) * 6.283));
        else if (s.mode == "ai") a = s.on.includes(i) ? 1 : 0.22;
        else if (s.mode == "code") a = cx == ((age / 80) | 0) % 3 ? 1 : 0.25;
        else if (s.mode == "hit") a = age < 480 && ((age / 120) | 0) % 2 ? 0.3 : 1;
        else if (s.mode == "skip") a = 0.12;
        else a = 1;
        if (blip) a = s.ai ? (s.on.includes(i) ? 1 : 0.2) : cx == (((now - s.b0) / 80) | 0) % 3 ? 0.95 : 0.25;
        c.globalAlpha = a * dk * (st == "idle" && !blip ? 0.8 : 1);
        c.fillStyle = s.mode == "hit" ? RED : lit ? INK : PAPER;
        const x = m.x + 1.5 + cx * 5, y = m.y + 1.5 + cy * 5;
        if (s.ai) { c.beginPath(); c.arc(x + 1.5, y + 1.5, 1.5, 0, 6.283); c.fill(); } else c.fillRect(x, y, 3, 3);
      }
      // the busy node's outline: Pace for an AI specialist, paper for a code step; fades over the blip
      if (blip && !dim) {
        const n = G.n[sp], q = (now - s.b0) / (s.blip - s.b0), rr = s.ai ? n.h / 2 + 2 : 5;
        c.globalAlpha = (s.ai ? 0.6 : 0.4) * (1 - q * q); c.strokeStyle = PAPER; c.lineWidth = 1;
        c.beginPath();
        if (c.roundRect) c.roundRect(n.x - 2, n.y - 2, n.w + 4, n.h + 4, rr); else c.rect(n.x - 2, n.y - 2, n.w + 4, n.h + 4);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
  }

  /* ---- streamed AI words (40 characters/s). The final text reserves the box,
     the live copy overlays it, so the box never grows while it streams. */
  function stream(el, text) {
    const live = h("span.mc-sl");
    live.append(document.createTextNode(""), h("span.sc-caret"));
    el.append(h("span.mc-sf", { text }), live);
    streams.push({ el: live, text, t0: W, done: false });
  }
  /* ---- bubbles (inside their node) */
  let capT = 0;
  function bubble(sp, text, o2 = {}) {
    const n = nodes[sp];
    if (!n || !G.n[sp]) return;
    if (ph) {
      // phones: one two-line readout inside the shell (beside Set logger) instead of floating bubbles
      const cap = $(".mc-cr"), nm = (d.sp[sp] && d.sp[sp].name) || "Privacy", life = (o2.ai ? (text.length / 40) * 1000 : 0) + (o2.hold || 1400);
      const line = `<b>${esc(nm)}:</b> `, basis = o2.basis ? " " + U.basis(d, o2.basis) : "";
      cap.classList.add("is-read"); cap.classList.toggle("is-ai", !!o2.ai);
      if (o2.ai && !RM && C.tier.name != "minimal") {
        // the final line holds the layout (its basis tag shows in place); the live copy streams over it
        cap.innerHTML = `<span class="mc-sf">${line}<span>${esc(text)}</span>${basis}</span><span class="mc-sl">${line}<span></span></span>`;
        const tx = cap.querySelector(".mc-sl span");
        tx.append(document.createTextNode(""), h("span.sc-caret"));
        streams.push({ el: tx, text, t0: W, done: false });
      } else cap.innerHTML = line + esc(text) + basis;
      const my = ++capT;
      at(W + life, () => { if (capT == my) { cap.classList.remove("is-read", "is-ai"); cap.textContent = COPY.codeRule; } });
      return;
    }
    n.querySelectorAll(".mc-bub").forEach((b) => b.remove());
    const b = h("span.mc-bub" + (o2.ai ? ".is-ai" : "") + (o2.red ? ".is-red" : ""), { "data-pos": o2.pos || (row(sp) == 0 || sp == "learner" || sp == "examiner" || sp == "privacy" ? "up" : "down") });
    const tx = h("span.mc-bt");
    b.append(tx);
    if (o2.basis) b.insertAdjacentHTML("beforeend", U.basis(d, o2.basis));
    n.append(b);
    if (o2.ai && !RM && C.tier.name != "minimal") stream(tx, text); else tx.textContent = text;
    const life = (o2.ai ? (text.length / 40) * 1000 : 0) + (o2.hold || 1400);
    at(W + life, () => { b.classList.add("is-out"); k.later(() => b.remove(), 220); });
    return b;
  }

  /* ---- incoming message (one slot) */
  function incoming(t) {
    const box = $(".mc-in"), old = box.querySelector(".mc-msg:not(.is-out)");
    if (old) { old.classList.add("is-out"); k.later(() => old.remove(), 260); }
    box.insertAdjacentHTML("beforeend", msgHTML(t));
    const m = box.lastElementChild;
    m.classList.add("is-new");
    return m;
  }
  function memberOn(id, on) { const m = root.querySelector(`.mc-m[data-t="${id}"]`); m && m.classList.toggle("is-on", on); }

  /* ---- subtitle (160 ms crossfade) */
  let subA = true, subLock = 0;
  function sub(html, hold = 0) {
    if (W < subLock && !hold) return;
    if (hold) subLock = W + hold;
    const a = $(".mc-s1"), b = $(".mc-s2"), [on, off] = subA ? [b, a] : [a, b];
    on.innerHTML = html; on.classList.add("is-on"); off.classList.remove("is-on");
    subA = !subA;
  }

  /* ---- lanes and tiles: each list's tiles sit in it by transforms (no tile ever
     moves another in layout); heights are read once per tile and content */
  const tiles = {}; // id -> {li, lane, n}
  let spot = 1;
  const laneOf = (id) => { const t = d.trace(id), r = decide(t, p.S, d); return t.decide == "learn" ? "waits" : r.lane; };
  const lisOf = (l) => [...lists[l].children].filter((li) => li.classList.contains("mc-li"));
  const due = (li) => li.classList.contains("is-due"); // a reserved slot: not landed yet
  function place(l) {
    if (ph) return;
    let y = 0;
    for (const li of lists[l].children) {
      if (li.hidden) continue;
      // its place first: a height read below must not see a tile that just appeared at the top
      if (Y.get(li) !== y) { li.style.transform = `translateY(${y}px)`; Y.set(li, y); }
      const key = li.classList.contains("mc-more") ? "+" : li.dataset.t + (li.querySelector(".mc-sub2").textContent ? "*" : "");
      let ht = HT.get(key);
      if (ht == null) HT.set(key, (ht = li.offsetHeight));
      y += ht + 4;
    }
  }
  /** A moment lands in its lane: on top, or (the reduced-motion still frame)
      under the tiles already there, so none of them moves. */
  function land(id, lane, under) {
    let tl = tiles[id];
    const list = lists[lane];
    if (!tl) {
      const at = under ? list.querySelector(".mc-more") : list.firstElementChild;
      at.insertAdjacentHTML("beforebegin", tileHTML(d, id));
      tl = tiles[id] = { li: at.previousElementSibling, lane, n: 0 };
    } else { list.prepend(tl.li); tl.lane = lane; Y.delete(tl.li); }
    tl.n++;
    tl.li.classList.remove("is-due");
    replay(tl.li, "is-land", sign);
    replay(lanes[lane], "is-flash2");
    if (id == "t10" && lane == "sent") spot++;
    counts();
  }
  function counts() {
    for (const l of ["sent", "waits", "paused"]) {
      const sec = lanes[l], lis = lisOf(l);
      const n = Math.min(CAP[l], lis.reduce((a, li) => a + (tiles[li.dataset.t] ? tiles[li.dataset.t].n : 1), 0));
      const ce = sec.querySelector(".mc-c");
      if (ce.textContent != String(n)) { ce.textContent = n; replay(ce, "is-roll"); }
      sec.querySelector(".mc-csr").textContent = `: ${n} in this sample hour`;
      lis.forEach((li, i) => (li.hidden = i >= SHOW[l]));
      const more = n - Math.min(lis.length, SHOW[l]), mo = lists[l].querySelector(".mc-more");
      mo.hidden = more <= 0; mo.textContent = "+" + more;
      const last = lis.find((li) => !due(li));
      sec.querySelector(".mc-last").textContent = last ? d.trace(last.dataset.t).member : "—";
      if (l == "waits") sec.querySelector(".mc-chk2 b").textContent = spot && tiles.t10 && tiles.t10.lane == "sent" ? spot : 0;
      place(l);
    }
    rove();
  }
  function rove() {
    for (const l in lists) {
      const b = lisOf(l).filter((li) => !li.hidden && !due(li)).map((li) => li.firstElementChild);
      if (!b.some((x) => x.tabIndex == 0)) b.forEach((x, i) => (x.tabIndex = i ? -1 : 0));
    }
  }
  /** Settings changed: tiles change lanes (FLIP from where they were, by transforms); future moments follow decide(). */
  function resort(key, src, by) {
    const S = p.S, moved = [], first = new Map();
    for (const id in tiles) first.set(tiles[id].li, { l: tiles[id].lane, y: Y.get(tiles[id].li) || 0 });
    for (const id in tiles) {
      const tl = tiles[id], to = laneOf(id), s2 = tl.li.querySelector(".mc-sub2"), why = id == "t9" && !S.supplementsTopic ? COPY.drafted : "";
      if (s2.textContent != why) s2.textContent = why;
      if (to != tl.lane) { lists[to].prepend(tl.li); tl.lane = to; Y.delete(tl.li); moved.push(id); }
    }
    counts();
    if (!RM && !ph && G) {
      let i = 0;
      first.forEach((a, li) => {
        const tl = tiles[li.dataset.t];
        if (!tl || li.hidden || a.l == tl.lane) return;
        const A = G.lane[a.l].list, B = G.lane[tl.lane].list;
        li.animate([{ transform: `translate(${A.x - B.x}px,${A.y + a.y - B.y}px)` }, { transform: li.style.transform }], { duration: 420, delay: 40 * i++, easing: EASE, fill: "backwards" });
      });
    }
    const gate = G && G.n.lane_gate;
    if (key == "level") {
      const Lv = d.labels.levels[S.level];
      if (gate && !ph) bubble("lane_gate", `Level ${S.level}: ${Lv.summary}`, { hold: 2600, pos: "down" }); // phones: the subtitle carries it
      sub(`<b>Level ${S.level}:</b> ${esc(Lv.summary)}${S.level > 1 ? " " + esc(d.labels.levels.note) : ""}`, 2600);
    }
    if (key == "bar") {
      $$(".mc-gauge b").forEach((b) => b.style.setProperty("--bar", S.bar + "%"));
      sub(`<b>Your bar: ${S.bar}%.</b> Plans below it wait for you. Aisha's is 78%, Fatima's 86%.`, 2600);
    }
    if (key == "supplementsTopic") {
      setNode("topics", S.supplementsTopic ? "idle" : "warn", { val: S.supplementsTopic ? "" : "Off" });
      if (!S.supplementsTopic) bubble("topics", COPY.suppOff, { hold: 2600, pos: "down" });
      sub(S.supplementsTopic ? "<b>Supplements:</b> you answer these yourself. No AI called." : `<b>Supplements:</b> ${esc(COPY.drafted)}. ${esc(COPY.suppOff)}`, 2600);
    }
    if (src == "user" && by == root) {
      const names = moved.map((id) => d.trace(id).member);
      C.say(names.length ? `${names.join(", ")} moved to ${COPY.laneShort[tiles[moved[0]].lane]}.` : "No moment changed lanes.");
    }
  }

  /* ---- dots */
  function seg(pts, a, dur, ez) {
    const P = round(pts), lens = [0];
    for (let i = 1; i < P.length; i++) lens.push(lens[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const Lt = lens[lens.length - 1];
    return { P, lens, L: Lt, a, b: a + (dur || clamp(Lt / 0.62, 200, 560)), ez };
  }
  function round(pts) {
    const out = [pts[0]], r = 9;
    for (let i = 1; i < pts.length - 1; i++) {
      const [q0, q, n] = [pts[i - 1], pts[i], pts[i + 1]];
      const d1 = Math.hypot(q[0] - q0[0], q[1] - q0[1]), d2 = Math.hypot(n[0] - q[0], n[1] - q[1]);
      if (d1 < 1 || d2 < 1) { out.push(q); continue; }
      const k1 = Math.min(r, d1 / 2) / d1, k2 = Math.min(r, d2 / 2) / d2;
      const A = [q[0] - (q[0] - q0[0]) * k1, q[1] - (q[1] - q0[1]) * k1], B = [q[0] + (n[0] - q[0]) * k2, q[1] + (n[1] - q[1]) * k2];
      for (let s = 0; s <= 4; s++) { const u = s / 4, v = 1 - u; out.push([v * v * A[0] + 2 * v * u * q[0] + u * u * B[0], v * v * A[1] + 2 * v * u * q[1] + u * u * B[1]]); }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function posAt(dot, w) {
    let s = dot.segs[0];
    for (const x of dot.segs) { if (w >= x.a) s = x; else break; }
    if (!s) return null;
    let q = clamp((w - s.a) / (s.b - s.a), 0, 1);
    q = s.ez == "in" ? q * q : s.ez == "lin" ? q : C.ease.io(q);
    const target = q * s.L;
    let i = 1;
    while (i < s.lens.length - 1 && s.lens[i] < target) i++;
    const l0 = s.lens[i - 1], l1 = s.lens[i], u = l1 > l0 ? (target - l0) / (l1 - l0) : 0;
    return [s.P[i - 1][0] + (s.P[i][0] - s.P[i - 1][0]) * u, s.P[i - 1][1] + (s.P[i][1] - s.P[i - 1][1]) * u];
  }

  /* ---- routes: ops = {mv: pts[], dur?, ez?} | {node, dwell, in(), out()} | {fn} | {wait} */
  function route(id, o2 = {}) {
    const t = d.trace(id), S = p.S, r = decide(t, S, d), g = G, ops = [], kind = t.decide, ghost = !!o2.ghost;
    const steps = r.steps.filter((x) => x.result != "skipped");
    const has = (sp) => steps.some((x) => x.sp == sp);
    const ai = pick(t, d, S);
    let cur = o2.start;
    const mv = (pts, dur, ez) => { ops.push({ mv: [cur, ...pts], dur, ez }); cur = pts[pts.length - 1]; };
    const N = (sp) => g.n[sp];
    const node = (sp, dwell, fin, fout) => ops.push({ node: sp, dwell: ghost ? 0 : dwell, in: ghost ? () => { const q = NS[sp]; q.b0 = T; q.blip = T + (q.ai ? BLIP_AI : BLIP_CODE); } : fin, out: ghost ? null : fout });
    const intoFirst = (sp) => { const n = N(sp); mv([[cur[0], g.first.y - 9], [n.cx, g.first.y - 9], [n.cx, n.cy]]); };
    const hop = (sp) => { const n = N(sp); mv([[n.cx, n.cy]], ghost ? null : clamp(Math.abs(n.cx - cur[0]) / 1.3, 60, 200)); };
    const down1 = () => mv([[cur[0], g.bus1]]);
    const toShell = (sp) => {
      const n = N(sp);
      if (sp == "set_logger" || row(sp) > 0) { const [l] = col(sp); mv([[l, g.bus1], [l, n.cy], [n.cx, n.cy]]); }
      else mv([[n.cx, g.bus1], [n.cx, n.cy]]);
    };
    const outShell = (sp) => { const n = N(sp), [, rr] = col(sp); mv([[rr, n.cy], [rr, g.bus2]]); };
    const toAfter = (sp) => { const n = N(sp); mv([[n.cx, g.bus2], [n.cx, n.cy]]); };
    const toLane = (l, dur, ez) => {
      const tg = laneTarget(l);
      if (ph) mv([[cur[0], g.bot], [tg[0], g.bot], tg], dur, ez);
      else mv([[g.gR, cur[1]], [g.gR, tg[1]], tg], dur, ez);
    };
    const hooks = o2.hooks || {};
    const H = (name, ...a) => hooks[name] && hooks[name](...a);
    const firstChecks = FIRST.filter(has);
    // a stop: the safety rules stop it, no AI called
    if (kind == "floor") {
      intoFirst("safety");
      node("safety", 120, () => H("scan"), () => H("stop"));
      if (!ghost) ops.push({ wait: 400 });
      const n = N("safety");
      if (ph) mv([[g.gL, n.cy], [g.gL, g.bot], [laneTarget("paused")[0], g.bot], laneTarget("paused")], ghost ? null : 600, "in");
      else mv([[g.gL, n.cy], [g.gL, g.bot], [g.gR, g.bot], [g.gR, laneTarget("paused")[1]], laneTarget("paused")], ghost ? null : 640, "in");
      ops.push({ fn: () => H("land", "paused") });
      return ops;
    }
    if (kind == "voice") {
      mv([[cur[0], g.first.y - 9], [g.gL, g.first.y - 9], [g.gL, g.bus1]]);
      toShell("voice_lines"); node("voice_lines", 1000, () => H("ai", "voice_lines"), () => H("aiOut", "voice_lines"));
      outShell("voice_lines"); toAfter("checker"); node("checker", 140, () => H("work", "checker"), () => H("pass", "checker", "Lines checked"));
      ops.push({ fn: () => H("voice2") });
      return ops;
    }
    if (kind == "recovery") {
      const n = N("recovery") || N("lane_gate");
      mv([[cur[0], g.first.y - 9], [g.gL, g.first.y - 9], [g.gL, n.cy], [n.cx, n.cy]]);
      node("recovery", 700, () => H("work", "recovery"), () => H("pass", "recovery", "−10% load"));
      toLane("sent"); ops.push({ fn: () => H("land", "sent") });
      return ops;
    }
    if (!firstChecks.length) firstChecks.push("safety");
    intoFirst(firstChecks[0]);
    firstChecks.forEach((sp, i) => {
      if (i) hop(sp);
      const st = steps.find((x) => x.sp == sp);
      node(sp, sp == "topics" && st.result == "hit" ? 420 : sp == "rule_finder" ? 160 : 110, () => H("work", sp), () => H("check", sp, st));
    });
    if (kind == "topic" && !ai) {
      down1(); mv([[g.nr, g.bus1], [g.nr, g.bus2]]); toAfter("lane_gate");
      node("lane_gate", 160, () => H("work", "lane_gate"), () => H("gate", r.lane));
      toLane(r.lane); ops.push({ fn: () => H("land", r.lane) });
      return ops;
    }
    down1();
    if (ai) { ops.push({ fn: () => H("picks", ai) }); toShell(ai); node(ai, kind == "meal" ? 1300 : 1100, () => H("ai", ai), () => H("aiOut", ai)); outShell(ai); }
    if (kind == "meal") {
      toAfter("checker"); node("checker", 140, () => H("work", "checker"), () => H("pass", "checker", "Fits the format"));
      const m = g.m[id];
      if (m && !ph) mv([[g.gL, N("checker").cy], [g.gL, m.cy], [m.r - 10, m.cy]]);
      else mv([[g.gL, N("checker").cy], [g.gL, g.inb.cy], [g.inb.cx, g.inb.cy]]);
      ops.push({ fn: () => H("member") });
      return ops;
    }
    const after = AFTER.filter((sp) => has(sp) || (sp == "confidence" && has("checker") && has("lane_gate")));
    if (!after.length) after.push("lane_gate");
    toAfter(after[0]);
    after.forEach((sp, i) => {
      if (i) hop(sp);
      const st = steps.find((x) => x.sp == sp);
      if (sp == "confidence") node(sp, r.sure ? 560 : 60, () => H("conf", r), () => H("confOut", r));
      else if (sp == "lane_gate") node(sp, 170, () => H("work", sp), () => H("gate", r.lane));
      else node(sp, st && st.result == "warn" ? 200 : 120, () => H("work", sp), () => H("check", sp, st));
    });
    toLane(laneOf(id)); ops.push({ fn: () => H("land", laneOf(id)) });
    return ops;
  }
  function run(ops, t0, dot) {
    let tc = t0;
    for (const op of ops) {
      if (op.mv) { const s = seg(op.mv, tc, op.dur, op.ez); dot.segs.push(s); tc = s.b; }
      else if (op.node) { op.in && at(tc, op.in); tc += op.dwell; op.out && at(tc, op.out); }
      else if (op.wait) tc += op.wait;
      else if (op.fn) at(tc, op.fn);
    }
    dot.end = tc;
    return tc;
  }

  /* ---- a narrated moment */
  let codePicks = 0;
  const fg = new Set(), WHO = {}; // owner → the member's initial, shown on every node their moment lights

  function moment(id, o2 = {}) {
    const t = d.trace(id), S = p.S, r = decide(t, S, d), own = ++seq;
    WHO[own] = t.member[0];
    const dot = { segs: [], col: PACE, ghost: false, trail: [], born: W, end: 0, a: 1 };
    const m = { id, t, r, dot, own };
    fg.add(m);
    let msg = o2.msg;
    if (o2.first) { msg = $(".mc-in .mc-msg"); sub(subHTML(t)); }
    else if (!o2.resume) { msg = incoming(t); if (!o2.quiet) sub(subHTML(t)); }
    memberOn(id, true);
    const start = [G.inb.x + Math.min(G.inb.w / 2, 40), G.inb.b - 2]; // cached geometry: no forced layout per moment
    const hooks = {
      work: (sp) => setNode(sp, "work", { owner: own }),
      check: (sp, st) => {
        const plan = t.decide == "plan";
        const v = !st ? "✓" : st.result == "hit" ? (sp == "topics" ? "Your choice" : "STOP") : st.result == "none" || /^No approved/.test(st.say) ? "none fits"
          : sp == "safety" ? "clear" : sp == "memory" ? "read" : sp == "rule_finder" ? (plan ? "your rules" : "1 fits") : sp == "checker" ? (st.result == "warn" ? "1 warning" : plan ? "in your limits" : "cites your rule") : "✓";
        setNode(sp, st && st.result == "hit" ? (sp == "topics" ? "warn" : "hit") : st && st.result == "warn" ? "warn" : "pass", { owner: own, val: v });
        if (sp == "topics" && st && st.result == "hit") bubble("topics", `${COPY.noAi} · Your choice: you answer supplements`, { pos: "down", hold: 1800 });
        if (sp == "rule_finder" && t.decide == "learn") bubble("rule_finder", st.say, { pos: "down", hold: 1600 });
        if (((sp == "rule_finder" || sp == "checker") && t.rule && st && st.result != "warn" && st.result != "none" && t.decide != "plan") || (sp == "checker" && t.decide == "plan")) ruleLine(sp);
        release(sp, own, 1500);
      },
      pass: (sp, v) => { setNode(sp, "pass", { owner: own, val: v }); release(sp, own, 1500); },
      picks: () => { if (codePicks++ < 2) { const c = $(".mc-cap"); c.classList.add("is-flash"); at(W + 900, () => c.classList.remove("is-flash")); } },
      ai: (sp) => {
        setNode(sp, "work", { owner: own });
        const st = r.steps.find((x) => x.sp == sp);
        bubble(sp, BUB[sp] || (st && st.say) || "", { ai: true, basis: st && st.basis, hold: 1400 });
      },
      aiOut: (sp) => { setNode(sp, "lit", { owner: own }); release(sp, own, 1700); },
      conf: (rr) => {
        const n = nodes.confidence;
        if (!rr.sure) { setNode("confidence", "idle", { val: "—", keepVal: true }); n.title = d.labels.noChatScore; return; }
        setNode("confidence", "work", { owner: own, val: disp(rr) });
        const pct = rr.sure.pct != null ? rr.sure.pct : Math.round(rr.sure.score * 100);
        n.querySelector(".mc-gauge i").style.setProperty("--v", pct / 100);
        n.classList.toggle("is-below", pct < S.bar);
      },
      confOut: (rr) => {
        if (!rr.sure) { at(W + 900, () => { if (NS.confidence.owner <= own) nodes.confidence.querySelector(".mc-v").textContent = ""; }); return; }
        const pct = rr.sure.pct != null ? rr.sure.pct : Math.round(rr.sure.score * 100);
        setNode("confidence", pct >= S.bar ? "pass" : "warn", { owner: own, val: disp(rr) });
        if (pct < S.bar) { dot.col = AMBER; replay(nodes.confidence, "is-bounce"); }
        at(W + 1600, () => { if (NS.confidence.owner == own) { setNode("confidence", "idle"); nodes.confidence.querySelector(".mc-gauge i").style.setProperty("--v", 0); nodes.confidence.classList.remove("is-below"); } });
      },
      gate: (lane) => {
        setNode("lane_gate", lane == "sent" ? "sent" : lane == "paused" ? "paused" : "waits", { owner: own, val: COPY.laneShort[lane] || "" });
        if (t.decide == "chat_action" && lane == "sent") ruleLine("lane_gate");
        dot.col = LC[lane] || PACE;
        release("lane_gate", own, 1300);
      },
      scan: () => { setNode("safety", "work", { owner: own }); msg && msg.classList.add("is-scan"); },
      stop: () => {
        setNode("safety", "hit", { owner: own, val: "STOP" });
        msg && msg.classList.add("is-hit");
        if (frame.classList.contains("is-stop")) { frame.classList.remove("is-stop"); void frame.offsetWidth; } // stops are >= 6 moments apart: rare
        frame.classList.add("is-stop", "is-dim");
        replay(root, "is-alarm");
        freeze = T + 400;
        at(W + 10, () => { dot.col = RED; });
        at(W + 700, () => frame.classList.remove("is-dim"));
        at(W + 1900, () => frame.classList.remove("is-stop"));
        release("safety", own, 2600);
      },
      member: () => {
        const mr = root.querySelector(`.mc-m[data-t="${id}"]`), mm = root.querySelector(`.mc-in .mc-msg[data-t="${id}"]:not(.is-out)`);
        [mr, mm].forEach((e) => e && (e.dataset.tag = "Priya confirms"));
        at(W + 2400, () => [mr, mm].forEach((e) => e && delete e.dataset.tag));
      },
      land: (lane) => land(id, lane),
      voice2: () => {
        setNode("safety", "pass", { owner: own, val: "safety line" });
        bubble("safety", "Say pain or tap Stop", { pos: "down", hold: 1500 });
        at(W + 900, () => {
          const m2 = incoming({ ...t, trigger: { text: "“too heavy”", lang: "en" } });
          m2.querySelector(".mc-mt").textContent = "After set 1 she says: “too heavy”";
          const d2 = { segs: [], col: PACE, ghost: false, trail: [], born: W, end: 0, a: 1 };
          const n = G.n.safety, sp = G.n.set_logger, [l, rr2] = col("set_logger"), tg = laneTarget("sent");
          const ops2 = [{ mv: [[start[0], start[1]], [start[0], G.first.y - 9], [n.cx, G.first.y - 9], [n.cx, n.cy]] },
            { node: "safety", dwell: 300, in: () => setNode("safety", "work", { owner: own }), out: () => { setNode("safety", "pass", { owner: own, val: "no pain" }); bubble("safety", "Screened for pain, in English and Arabic", { pos: "down", hold: 1300 }); release("safety", own); } },
            { mv: [[n.cx, n.cy], [n.cx, G.bus1], [l, G.bus1], [l, sp.cy], [sp.cx, sp.cy]] },
            { node: "set_logger", dwell: 1000, in: () => { setNode("set_logger", "work", { owner: own }); bubble("set_logger", "“Too heavy” → your 10% rule → 54 kg", { pos: "down", hold: 1600 }); }, out: () => { setNode("set_logger", "pass", { owner: own, val: "54 kg" }); release("set_logger", own); } },
            { mv: [[sp.cx, sp.cy], [rr2, sp.cy], [rr2, G.bus2], ...(ph ? [[rr2, G.bot], [tg[0], G.bot], tg] : [[G.gR, G.bus2], [G.gR, tg[1]], tg])] },
            { fn: () => { d2.col = GREEN; land(id, "sent"); } }];
          d2.end = run(ops2, W, d2);
          dots.push(d2);
          // the second leg is still this moment: it holds its foreground slot until it lands
          at(d2.end + 300, () => { memberOn(id, false); fg.delete(m); });
        });
      },
    };
    let ops = route(id, { start, hooks });
    if (o2.resume) {
      const i = ops.findIndex((x) => x.node == o2.resume);
      ops = ops.slice(i);
      ops[0] = { ...ops[0], dwell: o2.remain || 600, in: null };
      const n = G.n[o2.resume];
      dot.segs.push(seg([[n.cx, n.cy], [n.cx, n.cy + 0.01]], W, 1));
      NS[o2.resume].owner = own; NS[o2.resume].mode = "ai";
      at(W + (o2.remain || 600) + 1400, () => nodes[o2.resume].querySelectorAll(".mc-bub").forEach((b) => { b.classList.add("is-out"); k.later(() => b.remove(), 220); }));
    }
    dot.end = run(ops, W, dot);
    dots.push(dot);
    at(dot.end + 200, () => { if (t.decide != "voice") fg.delete(m), memberOn(id, false); }); // voice: its second leg releases it
    at(dot.end + 1400, () => { if (!fg.size && !RM) sub(esc(COPY.tap)); });
    return m;
  }

  /* ---- rule lines from the rulebook spine (Pace, 1.5 px: draw 240, hold 400, fade 600) */
  function ruleLine(sp) {
    if (ph || !G.spine) return;
    const n = G.n[sp], x0 = G.spine.x;
    const pts = sp == "checker" ? [[x0, G.bus2 - 4], [n.cx + 10, G.bus2 - 4], [n.cx + 10, n.y]] : [[x0, n.cy], [n.r, n.cy]];
    rules.push({ s: seg(pts, T, 240, "lin"), t0: T });
    replay($(".mc-spine"), "is-cite");
  }

  /* ---- ghosts: unlabelled moments on true paths, never Not-on-yet nodes */
  const pool = d.traces.filter((t) => !isOff(t, p.S) && t.decide != "learn" && t.decide != "recovery");
  const wsum = pool.reduce((a, t) => a + t.weight, 0);
  const wpick = (rnd) => { let x = rnd() * wsum; for (const t of pool) if ((x -= t.weight) < 0) return t; return pool[0]; };
  let nextGhost = 0;
  function ghost() {
    if (dots.filter((x) => x.ghost).length >= C.tier.ghosts) return;
    const t = wpick(RG), g = G;
    const x = ph ? g.inb.x + 10 + RG() * (g.inb.w - 20) : g.first.x + RG() * g.first.w;
    const dot = { segs: [], ghost: true, born: W, end: 0, red: t.decide == "floor" };
    const lane = t.decide == "floor" ? "paused" : t.decide == "meal" ? null : laneOf(id0(t));
    dot.lc = LC[lane] || PACE;
    if (lane && g.lane[lane]) { const Ln = g.lane[lane], tg = laneTarget(lane); dot.rp = ph ? [tg[0], Ln.box.y] : [Ln.box.x, tg[1]]; }
    const ops = route(id0(t), { ghost: true, start: [x, g.inb.y + 6] });
    let tc = W;
    for (const op of ops) if (op.mv) { const s = seg(op.mv, tc, null, "lin"); s.b = s.a + s.L / (0.2 + RG() * 0.12); dot.segs.push(s); tc = s.b; } else if (op.node && op.in) at(tc, op.in);
    dot.end = tc;
    dots.push(dot);
  }

  /* ---- halo sprites (one radial gradient per colour, drawn once) */
  const haloCache = {};
  function halo(c0) {
    if (haloCache[c0]) return haloCache[c0];
    const b = C.bitmap(28, 28), gr = b.c.createRadialGradient(14, 14, 0, 14, 14, 14);
    gr.addColorStop(0, c0 + "55"); gr.addColorStop(1, c0 + "00"); b.c.fillStyle = gr; b.c.fillRect(0, 0, 28, 28);
    return (haloCache[c0] = b.cv);
  }

  /* ---- the loop */
  const pre = []; // work that must run first in a frame (settings changes that FLIP)
  function frameFn(dt) {
    while (pre.length) pre.shift()();
    T += dt;
    if (T >= freeze) {
      W += dt;
      while (Q.length && Q[0][0] <= W) Q.shift()[1]();
      if (!RM && W >= nextGhost) { ghost(); nextGhost = W + 300 + RG() * 200; }
    }
    for (const s of streams) if (!s.done) {
      const n = Math.min(s.text.length, Math.round(((W - s.t0) / 1000) * 40));
      if (n != s.n) { s.n = n; s.el.firstChild.data = s.text.slice(0, n); }
      if (n >= s.text.length) { s.done = true; const car = s.el.querySelector(".sc-caret"); car && car.remove(); }
    }
    if (streams.length > 20) streams.splice(0, streams.length - 20);
    // lite/minimal: while no dot or rule line moves, the matrices' breathing and the rail dashes redraw at ~12 fps
    if (C.tier.name != "full" && !dots.length && !rules.length && !rips.length && T - drawnAt < (C.tier.name == "minimal" ? 160 : 83)) return;
    drawnAt = T; draw();
  }
  function draw() {
    const g = G, c = ctx;
    c.clearRect(0, 0, g.W, g.H);
    // lane rails: dash 3 3, offset loop 1.6 s
    c.setLineDash([3, 3]); c.lineDashOffset = C.tier.name == "minimal" ? 0 : -((T / 1600) % 1) * 6; c.lineWidth = 1;
    for (const [l, pts] of laneRails()) { c.strokeStyle = LC[l] + "66"; c.beginPath(); poly(c, pts); c.stroke(); }
    c.setLineDash([]);
    // rule lines
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i], age = T - r.t0, a = age < 640 ? 1 : 1 - (age - 640) / 600;
      if (a <= 0) { rules.splice(i, 1); continue; }
      const q = clamp(age / 240, 0, 1), s = r.s;
      c.strokeStyle = PACE; c.globalAlpha = a; c.lineWidth = 1.5; c.beginPath();
      c.moveTo(s.P[0][0], s.P[0][1]);
      for (let j = 1; j < s.P.length; j++) { const Lj = s.lens[j]; if (Lj <= q * s.L) c.lineTo(s.P[j][0], s.P[j][1]); else { const u = (q * s.L - s.lens[j - 1]) / (Lj - s.lens[j - 1]); c.lineTo(s.P[j - 1][0] + (s.P[j][0] - s.P[j - 1][0]) * u, s.P[j - 1][1] + (s.P[j][1] - s.P[j - 1][1]) * u); break; } }
      c.stroke(); c.globalAlpha = 1;
    }
    const halos = C.tier.spec.halos;
    for (let i = dots.length - 1; i >= 0; i--) {
      const dt_ = dots[i];
      if (W > dt_.end + (dt_.ghost ? 260 : 900)) { dots.splice(i, 1); continue; }
      const q = posAt(dt_, W);
      if (!q) continue;
      const fade = W > dt_.end ? Math.max(0, 1 - (W - dt_.end) / 260) : Math.min(1, (W - dt_.born) / 160);
      const hid = inBox(q[0], q[1]);
      if (dt_.ghost) {
        // ghosts: other members' moments (hidden while "inside" a node, which shows busy); a ripple where each lands
        if (W >= dt_.end && !dt_.rip) { dt_.rip = 1; dt_.rp && rips.push([dt_.rp[0], dt_.rp[1], dt_.lc, T]); }
        if (hid) continue;
        const gc = dt_.red ? RED : PAPER, q2 = posAt(dt_, W - 70);
        if (q2 && W > dt_.born + 70) { c.globalAlpha = 0.32 * fade; c.strokeStyle = gc; c.lineWidth = 2; c.lineCap = "round"; c.beginPath(); poly(c, [q2, q]); c.stroke(); c.lineCap = "butt"; }
        if (halos) { c.globalAlpha = 0.16 * fade; c.fillStyle = gc; c.beginPath(); c.arc(q[0], q[1], 6.5, 0, 6.283); c.fill(); }
        c.globalAlpha = 0.85 * fade; c.fillStyle = gc;
        c.beginPath(); c.arc(q[0], q[1], 2.3, 0, 6.283); c.fill(); c.globalAlpha = 1;
        continue;
      }
      // the route so far stays lit (in the outcome colour once decided), then fades with the dot
      c.lineWidth = 2; c.strokeStyle = dt_.col; c.globalAlpha = 0.5 * (W > dt_.end ? Math.max(0, 1 - (W - dt_.end) / 900) : 1);
      c.beginPath();
      for (const sg of dt_.segs) {
        if (sg.a > W) break;
        if (sg.b <= W) poly(c, sg.P);
        else { const q3 = posAt({ segs: [sg] }, W), pts = [sg.P[0]]; let j = 1; const tgt = clamp((W - sg.a) / (sg.b - sg.a), 0, 1); while (j < sg.P.length - 1 && sg.lens[j] < (sg.ez == "in" ? tgt * tgt : sg.ez == "lin" ? tgt : C.ease.io(tgt)) * sg.L) pts.push(sg.P[j++]); pts.push(q3); poly(c, pts); }
      }
      c.stroke(); c.globalAlpha = 1;
      // trail (600 ms)
      dt_.trail.push([q[0], q[1], T]);
      while (dt_.trail.length && T - dt_.trail[0][2] > 600) dt_.trail.shift();
      c.lineWidth = 1.5; c.strokeStyle = dt_.col;
      for (let j = 1; j < dt_.trail.length; j++) {
        const a = dt_.trail[j - 1], b = dt_.trail[j];
        if (inBox(a[0], a[1]) || inBox(b[0], b[1])) continue;
        c.globalAlpha = (1 - (T - b[2]) / 600) * 0.9 * fade; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      }
      if (!hid) {
        c.globalAlpha = fade;
        if (halos) c.drawImage(halo(dt_.col), q[0] - 14, q[1] - 14, 28, 28);
        c.fillStyle = dt_.col; c.beginPath(); c.arc(q[0], q[1], 3.5, 0, 6.283); c.fill();
        c.globalAlpha = 1;
      }
    }
    // landing ripples, in the lane's colour (ghosts never change the counts)
    for (let i = rips.length - 1; i >= 0; i--) {
      const r = rips[i], q = (T - r[3]) / 520;
      if (q >= 1) { rips.splice(i, 1); continue; }
      const e = 1 - (1 - q) * (1 - q);
      c.globalAlpha = 0.9 * (1 - q); c.strokeStyle = r[2]; c.lineWidth = 1.5;
      c.beginPath(); c.arc(r[0], r[1], 2.5 + 10 * e, 0, 6.283); c.stroke();
    }
    c.globalAlpha = 1;
    drawMx(T, c);
  }
  /* Lines are cut at box edges (Liang-Barsky per box) instead of clipping the canvas. */
  function inBox(x, y) { for (const B of G.boxes) if (x > B.x && x < B.r && y > B.y && y < B.b) return true; return false; }
  function poly(c, pts) { for (let i = 1; i < pts.length; i++) cut(c, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); }
  const hidT = [];
  function cut(c, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0; let n = 0;
    for (const B of G.boxes) {
      if (Math.max(x0, x1) <= B.x || Math.min(x0, x1) >= B.r || Math.max(y0, y1) <= B.y || Math.min(y0, y1) >= B.b) continue;
      let t0 = 0, t1 = 1;
      const clipT = (pp, qq) => { if (pp == 0) return qq >= 0; const t = qq / pp; if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
      if (clipT(-dx, x0 - B.x) && clipT(dx, B.r - x0) && clipT(-dy, y0 - B.y) && clipT(dy, B.b - y0) && t1 > t0) { hidT[n++] = t0; hidT[n++] = t1; }
    }
    if (!n) { c.moveTo(x0, y0); c.lineTo(x1, y1); return; }
    const iv = []; for (let i = 0; i < n; i += 2) iv.push([hidT[i], hidT[i + 1]]);
    iv.sort((a, b) => a[0] - b[0]);
    let t = 0;
    for (const [a, b] of iv) { if (a > t) { c.moveTo(x0 + dx * t, y0 + dy * t); c.lineTo(x0 + dx * a, y0 + dy * a); } if (b > t) t = b; }
    if (t < 1) { c.moveTo(x0 + dx * t, y0 + dy * t); c.lineTo(x1, y1); }
  }

  /* ---- the 30-second story, then a seeded playlist (SHOWCASE_DESIGN.md §2 storyboard) */
  let playlistAt = Infinity, lastStop = -99, nPlayed = 0, hourAt = 75000;
  function story(settled) {
    const P = ph;
    // a settled frame already shows Noura's stop: its stamp fades as the hour plays on
    if (settled) { at(1900, () => frame.classList.remove("is-still")); at(2600, () => setNode("safety", "idle")); }
    else at(0, () => moment("t2", { first: true }));
    at(0, () => moment("t1", { resume: "reply_picker", remain: 700, quiet: true }));
    at(2200, () => moment("t8"));
    if (!P) at(3400, () => moment("t4", { quiet: true }));
    at(5200, () => moment("t10"));
    at(6600, () => moment("t7", { quiet: P }));
    at(8000, () => demo(1));
    at(11000, () => demo(2));
    at(12500, () => moment("t9"));
    at(14000, () => moment("t5"));
    at(16500, () => learnLoop());
    at(20600, () => nudge());
    playlistAt = 23400;
  }
  function demo(n) {
    if (p.touched) return;
    const b = root.querySelector(`.mc-ctrl [data-level="${n}"]`), dm = $(".mc-demo"), lv = b.parentElement;
    b.classList.remove("is-press"); void b.offsetWidth; b.classList.add("is-press");
    dm.style.setProperty("--x", (sign > 0 ? b.offsetLeft + b.offsetWidth / 2 : lv.offsetWidth - b.offsetLeft - b.offsetWidth / 2) + "px");
    dm.classList.add("is-shown");
    // applied at the start of a frame, before other events dirty the layout
    at(W + 320, () => pre.push(() => ctl.setLv(n, true)));
    at(W + 2400, () => { dm.classList.remove("is-shown"); b.classList.remove("is-press"); });
  }
  function nudge() {
    if (p.touched) return;
    replay($(".mc-lv"), "is-nudge");
    sub(esc(COPY.turn), 2800);
  }
  let card = null;
  function learnLoop() {
    const Lc = COPY.learn, own = ++seq;
    if (!card) { card = h("div.mc-learncard", { "aria-hidden": "true" }); body.append(card); }
    replay($(".mc-lane[data-lane='waits'] .mc-ls"), "is-pulse");
    sub(subHTML(d.trace("t7")), 3600);
    // The typed edit and the Learner's line hold their final size (the final
    // copy is hidden, the live one fills in over it), so no word moves.
    const typed = "2.5 kg", learner = `Learner · <span>${esc(BUB.learner)}</span> ${U.basis(d, "tests")}`;
    const html = (end) => `<p class="mc-lc-h"><span class="mc-ls">LS</span>${esc(Lc[0])}</p><p class="mc-lc-d">Draft: “Add <s>5 kg</s> <ins><span class="mc-sf">${typed}</span><span class="mc-sl"></span></ins> next time.”</p>` +
      `<p class="mc-lc-s${end}" data-s="1">${esc(Lc[1])}</p><p class="mc-lc-s mc-lc-ai${end}" data-s="2"><span class="mc-sf">${learner}</span><span class="mc-sl">Learner · <span></span></span></p>` +
      `<p class="mc-lc-s${end}" data-s="3"><span class="mc-q">${esc(Lc[end ? 3 : 2])}</span></p><p class="mc-lc-s${end}" data-s="4"><span class="mc-ex">${esc(Lc[4])}</span> · Examiner: your AI answers your test cases, code marks them. <b>${end ? esc(Lc[5]) : ""}</b></p>`;
    // The card grows downwards from where its last line ends at the lane's foot, so nothing in it ever moves up.
    card.innerHTML = html(" is-up");
    card.style.top = Math.round(G.H - (ph ? 74 : 0) - card.offsetHeight) + "px";
    card.innerHTML = html("");
    card.classList.remove("is-up"); void card.offsetWidth; card.classList.add("is-up");
    const ins = card.querySelector("ins .mc-sl"), sh = (i) => card.querySelector(`[data-s="${i}"]`).classList.add("is-up");
    const tz = tiles.t7 && tiles.t7.li; tz && tz.classList.add("is-edit");
    typed.split("").forEach((ch, i) => at(W + 500 + i * 83, () => (ins.textContent += ch)));
    at(W + 1100, () => { sh(1); setNode("privacy", "pass", { owner: own, val: "[client]" }); release("privacy", own, 3000); });
    at(W + 1500, () => {
      sh(2);
      const tg = card.querySelector(".mc-lc-ai .mc-sl span");
      tg.append(document.createTextNode(""), h("span.sc-caret"));
      streams.push({ el: tg, text: BUB.learner, t0: W, done: false });
      setNode("learner", "work", { owner: own });
      if (!ph && G.learn) { const n = G.n.learner, tl = G.lane.waits.box; const dt2 = { segs: [], col: PACE, ghost: false, trail: [], born: W, end: 0 }; dt2.segs.push(seg([[tl.x + 4, tl.cy], [G.gR, tl.cy], [G.gR, n.cy], [n.r, n.cy]], W, 700)); dt2.end = W + 700; dots.push(dt2); }
    });
    at(W + 2600, () => { setNode("learner", "lit", { owner: own }); release("learner", own, 1600); setNode("checker", "pass", { owner: own, val: "no new numbers ✓" }); release("checker", own); });
    at(W + 2900, () => sh(3));
    at(W + 3400, () => { const q = card.querySelector(".mc-q"); q.textContent = Lc[3]; q.classList.add("is-ok"); });
    at(W + 3600, () => { sh(4); setNode("examiner", "work", { owner: own, val: Lc[4] }); });
    at(W + 4300, () => {
      setNode("examiner", "pass", { owner: own, val: Lc[5] }); release("examiner", own, 1800);
      card.querySelector("[data-s='4'] b").textContent = Lc[5];
      $(".mc-bn").textContent = "25"; $(".mc-spine").classList.add("is-new");
      at(W + 3000, () => $(".mc-spine").classList.add("is-kept"));
    });
    at(W + 6400, () => { card.classList.remove("is-up"); tz && tz.classList.remove("is-edit"); });
  }
  function nextFromPlaylist() {
    let t = wpick(R), tries = 0;
    while (tries++ < 12 && ((t.decide == "floor" && nPlayed - lastStop < 6) || [...fg].some((m) => m.id == id0(t)))) t = wpick(R);
    if (t.decide == "floor") lastStop = nPlayed;
    nPlayed++;
    moment(id0(t));
  }
  function newHour() {
    const lw = $(".mc-lanes");
    lw.classList.add("is-reset");
    at(W + 420, () => {
      for (const id in tiles) { Y.delete(tiles[id].li); tiles[id].li.remove(); delete tiles[id]; }
      for (const l in START) for (const id of START[l]) land(id, laneOf(id));
      spot = 1; counts();
      $(".mc-bn").textContent = "24"; $(".mc-spine").classList.remove("is-new", "is-kept");
      lw.classList.remove("is-reset");
      sub(esc(COPY.newHour), 1800);
    });
  }
  let nextMoment = 0;
  function director() {
    if (W >= playlistAt && W >= nextMoment) {
      if (fg.size < (ph ? 1 : 2)) nextFromPlaylist();
      nextMoment = W + 2400 + R() * 1200;
    }
    if (W >= hourAt) { hourAt += 75000; newHour(); }
  }

  /* ---- reduced motion: a still frame after the stop; "Play the field" changes the state every 2.5 s */
  function staticFinal() {
    for (const t of d.traces) { const id = id0(t); if (isOff(t, p.S) || id == "t4") continue; if (!tiles[id]) land(id, laneOf(id), true); }
    land("t2", "paused");
    $$(".mc-m.is-on").forEach((m) => m.classList.remove("is-on"));
    memberOn("t2", true); memberOn("t1", true); // Omar's moment holds the lit Reply picker (its "O" badge)
    frame.classList.add("is-stop");
    $(".mc-in .mc-msg").classList.add("is-hit");
    setNode("safety", "hit", { val: "STOP" });
    sub(subHTML(d.trace("t2")));
  }
  let rmIdx = 0;
  const rmOrder = ["t1", "t8", "t4", "t10", "t7", "t9", "t5", "t6", "t11", "t12", "t2"];
  function rmStep() {
    const id = rmOrder[rmIdx++ % rmOrder.length], t = d.trace(id), S = p.S, r = decide(t, S, d);
    Object.keys(nodes).forEach((sp) => setNode(sp, "idle"));
    $$(".mc-bub").forEach((b) => b.remove());
    $$(".mc-m.is-on").forEach((m) => m.classList.remove("is-on"));
    memberOn(id, true);
    frame.classList.remove("is-stop");
    incoming(t);
    for (const st of r.steps) {
      if (!(st.sp in nodes) || st.result == "skipped") continue;
      const ai = d.sp[st.sp] && d.sp[st.sp].kind == "ai";
      setNode(st.sp, st.result == "hit" ? "hit" : ai ? "lit" : st.sp == "lane_gate" ? (r.lane == "sent" ? "sent" : r.lane == "paused" ? "paused" : "waits") : st.result == "warn" ? "warn" : "pass", { val: st.sp == "confidence" && r.sure ? r.sure.display : "" });
    }
    if (t.decide == "floor") { frame.classList.add("is-stop"); $(".mc-in .mc-msg:last-child").classList.add("is-hit"); }
    const a = pick(t, d, S);
    if (a) bubble(a, BUB[a] || r.steps.find((x) => x.sp == a).say, { ai: true, basis: r.steps.find((x) => x.sp == a).basis, hold: 2300 });
    sub(subHTML(t));
  }

  /* ---- receipts: the zoom (desktop), or the sheet in the overlay layer (phones) */
  let rx = null, zoomHost = null;
  const field = {
    async zoom(id) {
      sc.set("read", true);
      const t = d.trace(id), a = pick(t, d, p.S) || "safety", n = G.n[a] || G.n.safety;
      body.style.transformOrigin = `${n.cx}px ${n.cy}px`;
      root.classList.add("is-zoom");
      zoomHost && zoomHost.remove();
      const host = (zoomHost = h("div.mc-rx"));
      root.append(host);
      if (!RM) await new Promise((r) => k.later(r, 420));
      root.classList.add("is-read");
      return host;
    },
    unzoom() {
      root.classList.remove("is-read", "is-zoom");
      zoomHost && zoomHost.remove(); zoomHost = null;
      sc.set("read", false);
    },
    hold(on) { sc.set("read", on); },
    focusControl(t) {
      const kind = t.decide;
      const el = kind == "plan" ? ctl.rng : kind == "topic" ? ctl.sw : kind == "floor" ? ctl.lock : $(".mc-lv [aria-checked='true']");
      if (ph && sheet.contains(el)) openSheet(true, el);
      el.focus();
      replay(kind == "plan" ? el.parentElement : el, "is-ping");
    },
  };
  async function receipt(id, from) {
    if (rx) rx.close(true);
    const api = await openReceipt(id, from, { p, o, layer: L.el, dead: () => dead, zoom: field.zoom, hold: field.hold, onChange: (t) => field.focusControl(t), onClose: () => { rx = null; field.unzoom(); } });
    if (api) rx = api;
  }

  /* ---- the phone settings sheet: in the overlay layer, over a backdrop */
  let sheetOpen = false, back = null;
  function dock() {
    if (ph && sheet.parentElement != L.el) { sheet.hidden = true; L.el.append(sheet); }
    else if (!ph && sheet.parentElement != sheetHome) {
      sheetOpen = false; moreb.setAttribute("aria-expanded", "false"); back && back.remove();
      sheet.classList.remove("is-open"); sheet.hidden = false; sheetHome.append(sheet);
      sc.set("read", false);
    }
  }
  function openSheet(on, to) {
    if (!ph || on == sheetOpen) return;
    sheetOpen = on;
    moreb.setAttribute("aria-expanded", on);
    if (on) {
      if (!back) { back = h("div.mc-sheetback"); k.on(back, "click", () => openSheet(false)); }
      L.el.insertBefore(back, sheet);
      sheet.hidden = false;
      void sheet.offsetWidth; // the closed position first, so the slide-in runs
      sheet.classList.add("is-open"); back.classList.add("is-open");
      sc.set("read", true);
      k.later(() => sheetOpen && (to || sheet.querySelector("[data-close]")).focus(), 30);
    } else {
      sheet.classList.remove("is-open"); back.classList.remove("is-open");
      k.later(() => { if (!sheetOpen) { sheet.hidden = true; back.remove(); } }, 300);
      sc.set("read", false);
      moreb.focus();
    }
  }
  k.on(sheet, "click", (e) => { if (e.target.closest("[data-close]")) openSheet(false); });
  k.on(sheet, "keydown", (e) => {
    if (e.key == "Escape") return openSheet(false);
    if (e.key != "Tab" || !sheetOpen) return; // Tab cycles inside the open sheet until Done or Esc
    const f = [...sheet.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex='0']")];
    const i = f.indexOf(document.activeElement), n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i == f.length - 1 ? 0 : i + 1;
    if (f.length) { e.preventDefault(); f[n].focus(); }
  });

  /* ---- interactions */
  const ctl = wireControls($(".mc-ctrl"), p, k, root);
  k.on(root, "click", (e) => {
    const b = e.target.closest(".mc-tile, .mc-m");
    if (b && !b.disabled && b.dataset.t) { receipt(b.dataset.t, b); return; }
    const bin = e.target.closest(".mc-bin");
    if (bin) { binList(bin); return; }
    if (e.target.closest(".mc-moreb")) openSheet(!sheetOpen);
    const how = e.target.closest(".mc-how");
    if (how) { const hp = $(".mc-howp"); hp.hidden = !hp.hidden; how.setAttribute("aria-expanded", !hp.hidden); }
  });
  k.on(root, "keydown", (e) => {
    if (e.key == "Escape" && rx) rx.close(); // the receipt in the zoom closes from anywhere in the field
    if (e.key == "Escape") { const hp = $(".mc-howp"); if (!hp.hidden) { hp.hidden = true; $(".mc-how").setAttribute("aria-expanded", "false"); } closeBin(); }
    const b = e.target.closest(".mc-tile, .mc-m");
    if (!b || !/^Arrow(Up|Down)$/.test(e.key) || b.closest(".mc-binlist")) return;
    const list = [...b.closest("ul").querySelectorAll(b.classList.contains("mc-m") ? ".mc-m" : ".mc-li:not([hidden]):not(.is-due) .mc-tile")];
    const i = list.indexOf(b), nb = list[clamp(i + (e.key == "ArrowDown" ? 1 : -1), 0, list.length - 1)];
    e.preventDefault(); list.forEach((x) => (x.tabIndex = -1)); nb.tabIndex = 0; nb.focus();
  });
  let binBox = null, binFrom = null;
  function binList(bin) {
    closeBin();
    binFrom = bin; // Esc or Done returns focus here
    const l = bin.dataset.bin;
    binBox = h("div.mc-binlist", { role: "dialog", "aria-label": COPY.lanes[l][0] });
    binBox.innerHTML = `<p><b>${esc(COPY.lanes[l][0])}</b><button type="button" class="mc-x" data-binx>${esc(COPY.done)}</button></p><ul>${lisOf(l).filter((li) => !due(li)).map((li) => `<li><button type="button" class="mc-tile" data-t="${li.dataset.t}">${li.querySelector(".mc-tn").innerHTML}</button></li>`).join("")}</ul>`;
    root.append(binBox);
    k.on(binBox, "click", (e) => { if (e.target.closest("[data-binx]")) closeBin(bin); });
    binBox.querySelector("button").focus();
  }
  function closeBin(focus = binFrom) { if (binBox) { binBox.remove(); binBox = null; focus && focus.focus(); } }
  k.add(C.prefetch(() => import("./receipt.js"), root, 10000));

  /* ---- pause button, resize, start */
  let ro = null;
  function teardown() {
    dead = true;
    rx && rx.close(true);
    sc.destroy();
    k.clear();
    closeBin(null);
    if (sheet.parentElement == L.el) sheet.remove();
    back && back.remove();
    L.release();
  }
  try {
    pb.disabled = false;
    $$(".mc-m, .mc-bin, .mc-moreb, .mc-how").forEach((b) => (b.disabled = false));
    measure();
    k.add(C.tier.on((name) => { measure(); counts(); root.setAttribute("data-sc-tier", name); if (RM) draw(); }));
    let rz = 0, lastW = G.W, lastP = ph;
    ro = new ResizeObserver(() => {
      clearTimeout(rz);
      rz = setTimeout(() => {
        const w = body.getBoundingClientRect().width;
        if (Math.abs(w - lastW) < 2 && C.phone() == lastP) return;
        measure(); counts(); lastW = G.W; lastP = ph; dots.length = 0; if (RM) draw();
      }, 120);
    });
    ro.observe(body);
    k.add(() => { ro.disconnect(); clearTimeout(rz); });
    p.subs.add(resort);
    k.add(() => p.subs.delete(resort));
    const own = () => { for (const li of $$(".mc-li")) tiles[li.dataset.t] = { li, lane: li.closest(".mc-lane").dataset.lane, n: due(li) ? 0 : 1 }; };
    if (RM) {
      root.classList.add("is-rm");
      resetFirst(); own(); staticFinal(); counts();
      sc.button(pb, { pause: COPY.pause, play: COPY.playField });
      sc.pause(); // a still frame until the visitor asks: "Play the field", aria-pressed="true"
      let acc = 2500;
      sc.loop((dt) => { acc += dt; T += dt; W += dt; while (Q.length && Q[0][0] <= W) Q.shift()[1](); if (acc >= 2500) { acc = 0; rmStep(); } draw(); }, 10);
      draw();
    } else {
      sc.button(pb, { pause: COPY.pause, play: COPY.play });
      if (o.settled) { frame.classList.add("is-still"); setNode("safety", "hit", { val: "STOP" }); } else resetFirst();
      own(); counts();
      k.later(() => { for (const l in lists) lists[l].classList.add("is-glide"); }, 100); // tiles glide once placed
      Object.keys(NS).forEach((sp) => { const s_ = NS[sp], n = nodes[sp], dly = (n.offsetTop + n.offsetLeft) * 0.9; if (s_.owner || sp == "safety") return; s_.mode = "code"; s_.t0 = -dly; at(dly + 240, () => { if (!NS[sp].owner && NS[sp].mode == "code") NS[sp].mode = "idle"; }); });
      story(o.settled);
      sc.loop((dt) => { frameFn(dt); director(); }, 60);
    }
    root.setAttribute("data-sc", "on");
    root.setAttribute("data-sc-tier", C.tier.name);
  } catch (e) {
    teardown();
    throw e;
  }
  return {
    destroy() {
      if (dead) return;
      teardown();
      unshare(p);
    },
  };
}
