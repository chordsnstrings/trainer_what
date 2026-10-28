/* The decision anatomy's runtime (/trainer-brain, "How it decides"), on
   the server's first frame (anatomy.render.js): a one-time burst from the
   reply card when the figure comes into view, then, pinned under the site
   header, the scroll steps (a)–(i) and the correction (j), other members'
   moments running beside it, and the What-if replays. Where the first
   frame's CSS does not pin (reduced motion, a viewport under 700 px tall,
   flattened), it plays the flat plates: the What-ifs swap them at once.
   One rAF loop (core.js), no canvas, no infinite CSS animation.

   Ported from the approved prototype's runtime half (docs/marketing-revamp-
   2026-10-26/prototypes/concept-c/src/showcase/c-anatomy.js) with the
   changes of docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.1 and WP3a:
   - its CSS is a static import (anatomy.run.css); it pins exactly where
     app/brain-anatomy.css pins (html.sc-pin, 700 px tall or more), under the
     header (--sc-top), and a viewport that crosses 700 px tall or 760 px
     wide starts it again in the new mode, from the finished figure;
   - destroy() removes every listener (the window's scroll and hashchange
     included), observer, timer, scene and loop, and the overlay layer;
   - announcements go to the one live region (core.js say());
   - a settled first frame (html.sc-late) skips the intro, and a scroll
     into the pin before it starts skips it too;
   - plates the moment never reaches keep a dark matrix. */
import "./anatomy.run.css";
import raw from "../data/traces.client.json";
import * as C from "./core.js";
import { prepare } from "./data.js";
import { defaults, pick } from "./decide.js";
import { COPY, GHOSTS, LET, dark, model, stackHTML } from "./anatomy.render.js";
const { clamp } = C;

const RX = 56, RZ = -32, PERSP = 1600;
const rad = (deg) => (deg * Math.PI) / 180, S56 = Math.sin(rad(RX)), C56 = Math.cos(rad(RX));
/** Where a point 1 px down the stack's plane lands after rotateX(56°) rotateZ(−32°): [x, y, z]. */
const OFF = [-Math.sin(rad(RZ)), Math.cos(rad(RZ)) * C56, Math.cos(rad(RZ)) * S56];
const num = (cs, k) => parseFloat(cs.getPropertyValue(k)) || 0;
const sm = (a, b, k) => clamp((k - a) / (b - a), 0, 1);
const smooth = (k) => k * k * (3 - 2 * k);
/** Step table. Desktop: (a)–(i) 0.08 each from 0.06, (j) 0.78–0.90, recompress 0.90–1.
    Phones: 6 steps (fan out; a+b+c; d+e; f; g+h; i+j), focus plate per step. */
const DESK = { hold: 0.06, step: 0.08, j: [0.78, 0.9] };
const PHONE = [[0, 0.08, null, ""], [0.08, 0.23, "b", "abc"], [0.23, 0.38, "e", "de"], [0.38, 0.53, "f", "f"], [0.53, 0.68, "h", "gh"], [0.68, 0.8, "i", "i"], [0.8, 0.9, "j", "j"]];
function stateAt(p, phone) {
  const end = p >= 0.9, e = end ? 1 - smooth(sm(0.9, 0.985, p)) : 1;
  const j = p >= 0.78 && p < 0.9 ? (p - 0.78) / 0.12 : 0;
  if (phone) {
    const row = PHONE.find((x) => p >= x[0] && p < x[1]) || PHONE[0], q = (p - row[0]) / (row[1] - row[0]);
    const k = end ? -1 : row[2] == "j" ? -1 : LET.indexOf(row[2]);
    return { e, k, q, j: row[2] == "j" ? q : 0, end, notes: end ? "" : row[3], dot: PHONE.indexOf(row) - 1 };
  }
  const k = p >= DESK.hold && p < 0.78 ? Math.floor((p - DESK.hold) / DESK.step) : -1;
  return { e, k, q: k >= 0 ? (p - DESK.hold - k * DESK.step) / DESK.step : 0, j, end, notes: k >= 0 ? LET[k] : j ? "j" : "" };
}
/** Scroll position (p) of a note letter, for the note buttons and #<id>-b links. */
function pOf(k, phone) {
  if (phone) { const r = PHONE.find((x) => x[3].includes(k)) || PHONE[0]; return (r[0] + r[1]) / 2; }
  return k == "j" ? 0.87 : DESK.hold + LET.indexOf(k) * DESK.step + DESK.step * 0.5;
}
/** Listeners, timers and cleanups owned by one run of the figure. */
function owned() {
  const offs = [], timers = new Set();
  return {
    on(el, ev, fn, opt) { el.addEventListener(ev, fn, opt); offs.push(() => el.removeEventListener(ev, fn, opt)); },
    later(fn, ms) { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; },
    add(fn) { offs.push(fn); },
    clear() { timers.forEach(clearTimeout); timers.clear(); offs.splice(0).forEach((f) => f()); },
  };
}
/** Root attributes a run sets; a restart clears them with the plates. */
const STATES = ["data-trace", "data-tease", "data-step", "data-end", "data-stop"];
/** Where the first frame's CSS changes mode (app/brain-anatomy.css). */
const MODES = ["(min-height: 700px)", "(max-width: 760px)"];
/** The root's custom properties that differ before and after the engine (app/brain-anatomy.css). */
const PINNED = ["--e", "--pl", "--card", "--gh"];
/** A task boundary (scheduler.yield where there is one): mounting stays clear of long tasks at 4x CPU. */
const nextTask = () => (globalThis.scheduler && scheduler.yield ? scheduler.yield() : new Promise((r) => setTimeout(r)));

/** Mounts on the root (brain/mount.tsx calls it after load, idle and near). */
export async function mount(root, o) {
  const d = prepare(raw, o), S0 = defaults(d), snap = root.innerHTML;
  const modes = MODES.map((q) => matchMedia(q));
  let run = null, dead = false, again = 0, L = null;
  // The overlay layer holds only the live region here: it comes with the first announcement, since a node
  // inserted at mount restyles the whole page (figure()).
  const say = (msg) => { if (!L) L = C.layer(root); C.say(msg); };
  // The viewport crossed a line where the CSS pins or flattens (a phone
  // turned, a window resized): start again in the new mode, from the
  // finished figure (no second intro).
  const restart = () => {
    clearTimeout(again);
    again = setTimeout(() => {
      if (dead) return;
      run.stop();
      root.innerHTML = snap;
      STATES.forEach((a) => root.removeAttribute(a));
      run = figure(root, d, S0, o, true, say);
    }, 150);
  };
  await nextTask(); // the chunk and the trace data in one task, the figure in the next
  try {
    // The root's custom properties of the moment (the reply card's, app/brain-anatomy.css) stay, inline, for
    // the engine's life: it moves those parts itself, and any change there, even to equal values from another
    // rule, restyles every node of the figure (35–60 ms at 4x CPU).
    const cs = getComputedStyle(root);
    for (const k of PINNED) root.style.setProperty(k, cs.getPropertyValue(k));
    // on before the figure reads: the run sheet's restyle shares the mount's one style pass
    root.setAttribute("data-sc", "on");
    root.setAttribute("data-sc-tier", C.tier.name);
    run = figure(root, d, S0, o, o.settled, say);
    modes.forEach((m) => m.addEventListener("change", restart));
  } catch (e) {
    if (run) run.stop();
    if (L) L.release();
    throw e;
  }
  return {
    destroy() {
      if (dead) return;
      dead = true;
      clearTimeout(again);
      modes.forEach((m) => m.removeEventListener("change", restart));
      run.stop();
      if (L) L.release();
    },
  };
}

/** One run of the figure on the root's current markup: pinned or flat, as the CSS lays it out.
    It reads first (style, geometry, scroll: one style and layout pass) and writes after. Text changes
    go through the text node's data: on these pages an inserted or removed node, anywhere, restyles the
    whole document (a global :has() rule; 35–55 ms at 4x CPU), so mounting inserts none of its own. */
function figure(root, d, S0, o, settled, say) {
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const frame = $(".ca-frame"), grid = $(".ca-grid"), scene = $(".ca-scene"), cam = $(".ca-cam"), stack = $(".ca-stack"), svg = $(".ca-svg"), book = $(".ca-book");
  const noteLis = $$(".ca-nl li"), dots = $$(".ca-dots i"), ghosts = $$(".ca-g"), nl = $(".ca-nl"), pb = $(".ca-pause");
  const RM = C.reduced(), phone = C.phone(), flat = getComputedStyle(frame).position != "sticky", k = owned();
  const link = new RegExp(`^#${o.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-([a-j])$`);
  let dead = false, M = model(d, d.trace("t1"), S0), plates = [], mores = [], tagEl = null, gsc = null, gscIntro = null;
  const collect = () => {
    plates = $$(".ca-stack .ca-p");
    mores = plates.map((n) => n.querySelector(".ca-more"));
    tagEl = plates[5] && plates[5].querySelector(".ca-x .ca-tag");
  };
  collect();
  /** The controls come alive (after the mount's reads). */
  const arm = () => {
    root.dataset.trace = "t1";
    $$(".ca-nb, .ca-wb").forEach((b) => (b.disabled = false));
    // On phones the notes outside the current step are visually hidden: out of the tab order too.
    if (phone) noteLis.forEach((li) => (li.querySelector("button").tabIndex = -1));
  };

  /* ---------------- plates (re-rendered only for a What-if) */
  function setTrace(id, level) {
    const S = level ? { ...S0, level } : S0;
    M = model(d, d.trace(id), S);
    stack.innerHTML = stackHTML(d, M, S);
    collect();
    if (G) centres();
    root.dataset.trace = id + (level ? "l" + level : "");
    $(".ca-card b").textContent = id == "t1" && !level ? `Answered ${M.t.member}` : `${M.t.member} · ${M.t.chip}`;
    const c = $(".ca-card .ca-lane");
    c.dataset.lane = M.r.lane;
    c.textContent = d.labels.lanes[M.r.lane];
    $(".ca-bcite mark").textContent = M.t.rule ? M.t.rule.title : "";
  }

  /* ---------------- scroll → p → V (pinned). The loop is registered before every other subscriber of this
     figure, so its one scrollY read per frame happens before any style write of that frame (no forced
     style/layout); the scroll handler itself only flags and wakes it. No rect reads in the loop. */
  let target = 0, cur = 0, curStep = "", wi = null, need = false, render = null;
  if (!flat) {
    render = C.loop(() => {
      if (need) { need = false; readScroll(false); }
      if (cur != target) { cur += (target - cur) * 0.28; if (Math.abs(target - cur) < 0.0004) cur = target; apply(cur); }
      return cur != target;
    });
    k.add(() => render.stop());
  }

  /* ---------------- geometry (rect reads on resize and step change only; every read before the writes) */
  let G = null;
  function layout() {
    if (flat || dead) return;
    const g = grid.getBoundingClientRect(), s = scene.getBoundingClientRect(), cs = getComputedStyle(root), y = scrollY;
    G = { W: g.width, H: g.height, ox: s.left - g.left + (s.width * num(cs, "--ox")) / 100, oy: s.top - g.top + (s.height * num(cs, "--oy")) / 100,
      pw: num(cs, "--pw"), ph: num(cs, "--ph"), gap: num(cs, "--gap"), tz: num(cs, "--tz"), ty: num(cs, "--ty"), tx: num(cs, "--tx"), txf: cs.getPropertyValue("--txf").trim() ? num(cs, "--txf") : num(cs, "--tx"),
      top: root.getBoundingClientRect().top + y, y, len: Math.max(1, root.offsetHeight - frame.offsetHeight), lift: num(cs, "--lift"), vh: innerHeight, hh: num(cs, "--sc-top"),
      sx: s.left - g.left, sy: s.top - g.top, sw: s.width, sh: s.height };
    const b = book.getBoundingClientRect();
    G.book = [b.right - g.left, b.top - g.top + b.height * 0.5];
    // (f) keeps its compact box when inspected; its overlay hangs below it. Lift it by half the overhang so
    // the inspected card sits where the grown plate used to (layout values, read on resize only).
    // Never lift its header out of the scene (short phones): the camera is at 0.86 while (f) is inspected.
    const fp = plates[5], x = fp && fp.querySelector(".ca-x");
    if (x) {
      const over = Math.max(0, (x.offsetTop + x.offsetHeight - fp.offsetHeight) / 2), kz = PERSP / (PERSP - G.tz);
      const room = G.ty - fp.offsetHeight / 2 + (G.oy - G.sy - 12) / (0.86 * kz); // the inspected centre sits at oy + cam·k·(ty − fx)
      G.fx = clamp(room, 0, over);
    } else G.fx = 0;
    centres();
    notesGeo(g);
    attr(svg, "viewBox", `0 0 ${G.W} ${G.H}`);
    noteAt = null; last = {};
    draw();
  }
  /** Each plate's centre below the stack's axis: (i) grows with its content, the others sit on it. */
  function centres() { G.cy = plates.map((n) => n.offsetTop + n.offsetHeight / 2); }
  /* Desktop notes: titles never move in layout. The open note's text is out of flow under its title and the
     titles below slide down by its height with a transform (no layout shift, no layout per frame), so each
     title's anchor is fixed: read here on resize (and when fonts load), never in the loop. */
  let noteAt = null;
  const NA = {}, BH = {};
  function notesGeo(g) {
    if (phone) return;
    const lr = nl.getBoundingClientRect();
    noteLis.forEach((li) => { const n = li.dataset.k; BH[n] = li.querySelector(".ca-nt").offsetHeight; NA[n] = [lr.left - g.left - 10, lr.top - g.top + li.offsetTop + 13]; });
  }
  function noteAnchor() {
    const li = noteLis.find((x) => x.hasAttribute("data-focus"));
    return !li || phone ? null : NA[li.dataset.k] || null;
  }
  /** Stack-local point → grid px (rotateX(56°) rotateZ(−32°), camera scale, perspective 1600). */
  function P(x, y, z, V) {
    const rz = (RZ * V.e * Math.PI) / 180, rx = (RX * V.e * Math.PI) / 180;
    const x1 = x * Math.cos(rz) - y * Math.sin(rz), y1 = x * Math.sin(rz) + y * Math.cos(rz);
    const y2 = y1 * Math.cos(rx) - z * Math.sin(rx), z2 = y1 * Math.sin(rx) + z * Math.cos(rx), kz = PERSP / (PERSP - z2);
    return [G.ox + V.cam * x1 * kz, G.oy - LF() + V.cam * y2 * kz];
  }
  const zOf = (i, V) => (4 - i) * G.gap * V.ex[i];
  // pre-pin camera lift; the intro teaser (V.tl) cancels it so the card it brings forward stays inside the scene
  const LF = () => V.pre * G.lift * (1 - (V.tl || 0));

  /* ---------------- the view: everything is a function of V */
  // V = {e, ex[9], cam, k (inspected), f (flatness), q, j, lit (plates lit up to index), pulse (0..1 along a→i), ghost, end, stop}
  let V = { pre: 0, e: 1, ex: Array(9).fill(1), cam: 1, k: -1, f: 0, q: 0, j: 0, lit: 9, pulse: null, ghost: 0.72, end: 0, stop: 0 }, last = {};
  const fx = (v) => v.toFixed(2);
  /* Style writes go to the few elements that use them (never inherited from the
     section root, which would restyle the whole figure every frame), and only on change. */
  const memo = new WeakMap();
  const put = (node, p, v) => { if (!node) return; let m = memo.get(node); if (!m) memo.set(node, (m = {})); if (m[p] !== v) { m[p] = v; p[0] == "-" ? node.style.setProperty(p, v) : (node.style[p] = v); } };
  const card = $(".ca-card"), stopEl = $(".ca-stop"), ghostWrap = $(".ca-ghosts"), mean = $(".ca-mean");
  const labs = { brk: $$(".ca-brk"), cite: { e: $('.ca-cite[data-c="e"]'), g: $('.ca-cite[data-c="g"]'), h: $('.ca-cite[data-c="h"]') } };
  function draw() {
    if (!G) return;
    const e = V.e, pre = LF().toFixed(1) + "px", pl = clamp(e / 0.25, 0, 1);
    put(stack, "transform", `rotateX(${fx(RX * e)}deg) rotateZ(${fx(RZ * e)}deg)`);
    put(cam, "transform", `scale(${V.cam.toFixed(3)})`);
    put(cam, "translate", `0 -${pre}`);
    // direct properties, not inherited custom properties: a custom property set here restyled every
    // descendant each frame (~55 ghost elements; QA 27 Oct trace: 125 elements, 16–24 ms a frame at 4x)
    const cv = clamp((0.35 - e) / 0.3, 0, 1);
    put(card, "translate", `-50% calc(-50% - ${pre})`); put(stopEl, "translate", `-50% calc(-50% - ${pre})`);
    put(card, "opacity", fx(cv)); put(card, "transform", `scale(${(0.94 + cv * 0.06).toFixed(3)})`);
    put(ghostWrap, "opacity", fx(Math.min(1, V.ghost))); put(mean, "opacity", fx(Math.min(1, V.ghost * 1.8)));
    put(ghostWrap, "transform", `translateY(-${pre}) scale(${V.cam.toFixed(3)})`);
    plates.forEach((n, i) => {
      const me = i == V.k, z = zOf(i, V);
      let tr = `translateZ(${z.toFixed(1)}px)`;
      if (me && V.f > 0) {
        // brought forward flat to (tx, ty, tz); a plate whose centre sits cy below the axis lands that far off
        // (the stack's rotation carries it), so the move takes it back: every inspected plate centres alike
        const f = V.f, cy = G.cy[i] || 0;
        const dx = ((i == 5 ? G.txf : G.tx) - cy * OFF[0]) * f, dy = (G.ty - (i == 5 ? G.fx : 0) + z * S56 - cy * OFF[1]) * f, dz = (G.tz - z * C56 - cy * OFF[2]) * f;
        tr += ` rotateZ(${fx(32 * f)}deg) rotateX(${fx(-56 * f)}deg) translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, ${dz.toFixed(1)}px)`;
      } else if (V.k >= 0) tr += ` translateZ(${(-30 * V.f).toFixed(1)}px)`;
      put(n, "transform", tr);
      // burst/recompress fade only; dimming for inspect and (j) is an attribute with a CSS transition
      const op = clamp((V.ex[i] * e) / 0.25, 0, 1);
      put(n, "opacity", op >= 1 ? "" : op.toFixed(3));
      put(n, "transition", op >= 1 ? "" : "none"); // per-frame opacity must not retrigger the dim transition every frame
      n.toggleAttribute("data-me", me && V.f > 0.02);
      n.toggleAttribute("data-lit", i < V.lit);
      n.classList.toggle("is-open", me && V.f > 0.55);
      if (me && i != 5) put(mores[i], "--q", fx(V.q)); // (f)'s drawer has no --q effects (it reveals by words below)
    });
    // inspected (f): reason reveals with scroll, in its one text node (a new node would restyle the page)
    const fp = plates[5], rs = fp && fp.querySelector(".ca-rs");
    if (rs) {
      const full = rs.dataset.full;
      let n = V.k == 5 ? Math.round(full.length * clamp((V.q - 0.25) / 0.5, 0, 1)) : V.lit > 5 ? full.length : 0;
      if (n > 0 && n < full.length) n = Math.max(0, full.lastIndexOf(" ", n)); // word by word: ~20 text layouts, not one a frame
      if (last.rs != n) { const t = rs.firstChild, s = full.slice(0, n) || " "; if (t.data != s) t.data = s; last.rs = n; }
    }
    const dim = V.k >= 0 && V.f > 0.12 ? "k" : V.j > 0.02 ? "j" : "";
    if ((stack.dataset.dim || "") != dim) dim ? (stack.dataset.dim = dim) : stack.removeAttribute("data-dim");
    put(tagEl, "--fq", fx(V.k == 5 ? clamp((V.q - 0.08) / 0.2, 0, 1) : 0));
    const bk = V.k >= 0 && (phone || ![4, 6, 7].includes(V.k)) ? 1 - V.f : 1;
    put(book, "opacity", fx(pl * bk * (phone ? clamp(1 - V.pre * 3, 0, 1) : 1)));
    put(book, "--jq", fx(V.j));
    book.toggleAttribute("data-jl", V.j > 0.5);
    root.toggleAttribute("data-end", !!V.end);
    const ins = V.k >= 0 && V.f > 0.3 ? LET[V.k] : "";
    if (ghostWrap.dataset.insp != ins) ghostWrap.dataset.insp = ins;
    root.toggleAttribute("data-stop", !!V.stop);
    paths(); // svg: thread, pulse, rule lines, brackets, leader
  }
  const at = (i, V, dx = 0) => P(dx, 0, zOf(i, V), V);
  const L2 = (a, b) => `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  const amemo = new WeakMap();
  const attr = (node, a, v) => { let m = amemo.get(node); if (!m) amemo.set(node, (m = {})); if (m[a] !== v) { m[a] = v; node.setAttribute(a, v); } };
  const sv = [...svg.children].map((n) => ({ setAttribute: (a, v) => attr(n, a, v), classList: n.classList }));
  function paths() {
    const e = V.e, vis = e >= 0.3 ? clamp((e - 0.3) / 0.4, 0, 1) : 0, svv = fx(vis);
    labs.brk.forEach((x) => put(x, "--sv", root.hasAttribute("data-step") || (V.k >= 0 && V.f > 0.15) ? "0" : svv)); // hidden while a plate is inspected (also the intro teaser)
    for (const c in labs.cite) put(labs.cite[c], "--sv", svv);
    if (!vis) { for (const p of sv) p.setAttribute("d", ""); svg.classList.toggle("has-dot", false); return; }
    put(svg, "opacity", svv);
    svg.classList.toggle("is-insp", V.k >= 0 && V.f > 0.15);
    const top = at(0, V), bot = at(8, V);
    sv[0].setAttribute("d", L2([top[0], top[1] - 30], [bot[0], bot[1] + 30]));
    sv[1].setAttribute("d", L2([top[0], top[1] - 30], [bot[0], bot[1] + 30]));
    const pu = V.pulse, y0 = top[1] - 30, y1 = bot[1] + 30;
    let py = 0;
    if (pu != null) {
      const i = clamp(Math.floor(pu), 0, 7), a = at(i, V)[1], b = at(i + 1, V)[1];
      py = pu < 0 ? top[1] + (top[1] - y0) * pu : pu > 8 ? bot[1] + (y1 - bot[1]) * (pu - 8) : a + (b - a) * (pu - i);
    }
    put(svg.children[1], "strokeDashoffset", pu == null ? "1" : fx(1 - clamp((py - y0) / (y1 - y0), 0, 1)));
    sv[1].classList.toggle("is-red", !!V.stop);
    // rule lines from the rulebook to (e), (g), (h); lit as the pulse passes them
    const lx = -G.pw / 2, kz = PERSP / (PERSP - G.tz * V.f);
    [[4, "e"], [6, "g"], [7, "h"]].forEach(([i, c], n) => {
      const me = V.k == i && V.f > 0.15;
      const a = G.book, b = me ? [G.ox + V.cam * (G.tx * V.f - G.pw / 2) * kz, G.oy - LF() + V.cam * (G.ty * V.f) * kz] : at(i, V, lx), p = sv[2 + n];
      p.setAttribute("d", `M${a[0].toFixed(1)} ${a[1].toFixed(1)}C${(a[0] + 60).toFixed(1)} ${a[1].toFixed(1)} ${(b[0] - 60).toFixed(1)} ${b[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`);
      const lit = V.k == i ? 1 : V.k >= 0 ? 0 : V.pulse != null && V.pulse > i - 0.2 && V.pulse < i + 1.8 ? 1 : 0;
      p.classList.toggle("is-off", V.k >= 0 && (!me || phone));
      p.classList.toggle("is-lit", !!lit);
      const l = labs.cite[c];
      if (l) { put(l, "transform", `translate(${(b[0] - G.sx - 6).toFixed(1)}px, ${(b[1] - G.sy).toFixed(1)}px)`); l.classList.toggle("is-lit", !!lit && (me || (V.pulse != null && Math.abs(V.pulse - i) < 1.2))); }
    });
    // "Your rules" brackets beside (b)–(e) and (g)–(h)
    const bx = lx - 26;
    [[1, 4], [6, 7]].forEach(([a, b], n) => {
      const A = at(a, V, bx), Z = at(b, V, bx);
      sv[5 + n].setAttribute("d", `M${(A[0] + 8).toFixed(1)} ${A[1].toFixed(1)}L${A[0].toFixed(1)} ${A[1].toFixed(1)}L${Z[0].toFixed(1)} ${Z[1].toFixed(1)}L${(Z[0] + 8).toFixed(1)} ${Z[1].toFixed(1)}`);
      put(labs.brk[n], "transform", `translate(${(A[0] - G.sx - 10).toFixed(1)}px, ${((A[1] + Z[1]) / 2 - G.sy).toFixed(1)}px)`);
    });
    // leader: inspected plate → its note (desktop)
    const lead = sv[7];
    if (!phone && V.k >= 0 && V.f > 0.6 && !root.hasAttribute("data-tease")) { // no leader during the intro teaser: its note is below the fold
      noteAt = noteAt || noteAnchor();
      const kk = PERSP / (PERSP - G.tz), a = [G.ox + V.cam * ((V.k == 5 ? G.txf : G.tx) + G.pw / 2) * kk, G.oy - LF() + V.cam * G.ty * kk];
      lead.setAttribute("d", noteAt ? `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${(noteAt[0] - 24).toFixed(1)} ${noteAt[1].toFixed(1)}L${noteAt[0].toFixed(1)} ${noteAt[1].toFixed(1)}` : "");
    } else lead.setAttribute("d", "");
    // pulse dot
    if (pu != null) for (const c of [sv[8], sv[9]]) c.setAttribute("cx", top[0].toFixed(1)), c.setAttribute("cy", py.toFixed(1));
    svg.classList.toggle("has-dot", pu != null);
  }

  /* ---------------- matrices: code sweep / AI sparkle (one plate at a time) */
  const rnd = C.rng(7);
  const sparkAt = new WeakMap();
  function sparkle(n, kind, s) {
    if (kind == "ai" && s < 1) { const t = performance.now(); if (t - (sparkAt.get(n) || 0) < 90) return; sparkAt.set(n, t); }
    // (f): the picked pill's matrix (in the compact row and in the overlay), never the first pill's
    const mxs = n.classList.contains("ca-brain") ? n.querySelectorAll(".ca-sp[data-pick] .ca-mx") : [n.querySelector(".ca-mx")];
    const on = [...Array(9)].map((_, i) => (s >= 1 ? "on" : kind == "check" ? (i % 3 <= Math.floor(s * 3) ? "on" : "") : rnd() < 0.45 ? "on" : ""));
    for (const mx of mxs) if (mx) for (let i = 0; i < 9; i++) if (mx.children[i].className != on[i]) mx.children[i].className = on[i];
  }
  /** Every plate the moment reaches, fully lit; the others stay dark. */
  const lightAll = () => plates.forEach((n, i) => !dark(M.plates[i]) && sparkle(n, n.dataset.kind == "msg" ? "check" : n.dataset.kind, 1));
  const darkAll = () => plates.forEach((n) => n.querySelectorAll(".ca-mx i").forEach((x) => (x.className = "")));

  /* ---------------- start: the flat plates (reduced motion, short viewports, flattened) */
  const jumpFlat = (c) => { const n = c == "j" ? book : plates[LET.indexOf(c)]; if (n) n.scrollIntoView({ behavior: RM ? "auto" : "smooth", block: "center" }); };
  const fromHash = () => { const m = location.hash.match(link); if (m) k.later(() => jump(m[1]), 60); };
  const jump = (c) => (flat ? jumpFlat(c) : scrollTo({ top: G.top - G.hh + pOf(c, phone) * G.len + 1, behavior: RM ? "auto" : "smooth" }));
  k.on(root, "click", (e) => {
    const nb = e.target.closest(".ca-nb");
    if (nb) return jump(nb.dataset.k);
    const w = e.target.closest(".ca-wb");
    if (w) whatIf(w.dataset.w, w);
  });
  k.on(window, "hashchange", fromHash);
  const stop = () => {
    dead = true;
    k.clear();
    if (gsc) gsc.destroy();
    if (gscIntro) gscIntro.destroy();
  };
  /* What-if: another moment on the same plates. Flat: they swap at once; pinned: re-explode and run it (2.4 s). */
  function whatIf(w, btn) {
    $$(".ca-wb").forEach((b) => b.setAttribute("aria-pressed", String(b == btn)));
    if (w == "base") {
      clearWhatIf();
      if (!flat) onScroll(true);
      say(`${M.t.member}: ${d.labels.lanes[M.r.lane]}.`);
      return;
    }
    const [, , id, lvl] = COPY.whatIf.find((x) => x[0] == w);
    setTrace(id, lvl);
    wi = w;
    say(`${M.t.member}: ${d.labels.lanes[M.r.lane]}.${M.stop ? " No AI called." : ""}`);
    if (flat) return;
    gsc.play(); gscIntro.play(); // a What-if is the visitor asking for motion
    if (RM) { V = { ...V, e: 1, ex: Array(9).fill(1), lit: 9, k: -1, f: 0, end: 0, stop: M.stop ? 1 : 0, cam: 1 }; draw(); lightAll(); return; }
    const tl = C.timeline(gscIntro);
    V = { ...V, k: -1, f: 0, j: 0, end: 0, lit: 0, stop: 0, pulse: null, cam: 1 };
    darkAll();
    draw();
    const e0 = V.e;
    tl.span(0, 500, (q) => { V.e = e0 + (1 - e0) * C.ease.out(q); V.ex.fill(1); draw(); });
    const keys = M.stop ? [[0, -0.7], [140, 0], [340, 1], [900, 1], [1300, 7], [1500, 8], [1800, 8.8]]
      : [[0, -0.7], [140, 0], [300, 1], [440, 2], [580, 3], [720, 4], [900, 5], [1500, 5], [1680, 6], [1860, 7], [2080, 8], [2300, 8.8]];
    runPulse(tl, 420, keys, M.stop ? () => { V.stop = 1; } : null);
    tl.play();
  }
  function clearWhatIf() {
    if (!wi) return;
    wi = null;
    setTrace("t1");
    if (flat) return;
    V.stop = 0; V.lit = 9; V.pulse = null;
    lightAll();
  }
  if (flat) {
    arm();
    if (phone) $$(".ca-nb").forEach((b) => (b.tabIndex = -1));
    fromHash();
    return { stop };
  }

  /* ---------------- ghosts: other members' moments, one specialist each */
  // Pause follows the ambient scene through onState, as core's button() would, except that the label
  // changes in its text node: button() replaces the node at every change of reasons (a page restyle).
  const label = pb.querySelector("[data-label]").firstChild, held = () => gsc.reasons.has("user") || gsc.reasons.has("idle");
  const pauseState = () => {
    const p = held();
    pb.setAttribute("aria-pressed", String(p));
    if (label.data != (p ? COPY.play : COPY.pause)) label.data = p ? COPY.play : COPY.pause;
    pb.setAttribute("data-state", p ? "paused" : "playing");
  };
  // both scenes read the header's height (--sc-top): before any write
  gsc = C.scene(scene, { resumeOnInput: true, onState: pauseState });
  gscIntro = C.scene(root, { idle: 0 });
  const G0 = ghosts.map((g, i) => ({ g, t: i * 420, run: -1 }));
  // the pill a ghost member's moment uses, in the inspected Brain card (base trace only)
  const GP = GHOSTS.map(([id]) => [pick(d.trace(id), d, S0), d.trace(id).member]);
  function byTag(i, on) {
    const [sp, who] = GP[i];
    if (!sp || !plates[5] || root.dataset.trace != "t1") return;
    const pill = plates[5].querySelector(`.ca-x .ca-sp[data-sp="${sp}"]`);
    if (!pill || pill.hasAttribute("data-pick")) return;
    on ? pill.setAttribute("data-by", who) : pill.removeAttribute("data-by");
  }
  const tierGhosts = () => (C.tier.name == "minimal" ? 0 : C.tier.name == "lite" ? 2 : phone ? 3 : 5);
  let clock = 0;
  gsc.loop((dt) => {
    clock += dt;
    const max = tierGhosts();
    if (!max) { G0.forEach((x, i) => { if (x.run != -2) (x.g.dataset.run = "4"), (x.run = -2), byTag(i, false); }); return false; } // minimal tier: stacks hidden, no tags, no frames (tiers never step back up)
    G0.forEach((x, i) => {
      if (i >= max || (phone && x.g.hasAttribute("data-desk"))) { if (x.run != -2) (x.g.dataset.run = "4"), (x.run = -2), byTag(i, !(phone && x.g.hasAttribute("data-desk"))); return; } // static, lit stacks keep their tag
      const c = clock - x.t;
      if (c < 0) return;
      const per = 5200 + i * 700, ph = c % per, run = ph < 300 ? 0 : ph < 700 ? 1 : ph < 1300 ? 2 : ph < 1900 ? 3 : ph < per - 500 ? 4 : 5;
      if (run != x.run) { x.g.dataset.run = x.run = run; byTag(i, run >= 2 && run <= 4); }
    });
  }, 30);

  /* ---------------- intro: burst (1.2 s, 0.9 s on phones), then Omar's pulse runs once.
     The pulse is in plate units (-0.7 → 8.8); a plate lights as the pulse reaches it. */
  let introTl = null, introDone = false;
  /* pulse keyframes (ms, plate): a → e, a hold at (f) of h ms while the teaser plays, then g → i */
  const TEASE = (h) => [[0, -0.7], [140, 0], [300, 1], [450, 2], [600, 3], [750, 4], [920, 5], [h, 5], [h + 200, 6], [h + 400, 7], [h + 660, 8], [h + 920, 8.8]];
  function runPulse(tl, T, keys, onStop) {
    const len = keys[keys.length - 1][0], pAt = (u) => { for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) { const [a, pa] = keys[i - 1], [b, pb_] = keys[i]; return pa + ((pb_ - pa) * (u - a)) / (b - a || 1); } return keys[keys.length - 1][1]; };
    const arrive = [...Array(9)].map((_, i) => (keys.find((x) => x[1] >= i) || [len])[0]);
    tl.span(T, len, (q) => {
      const u = q * len;
      V.pulse = pAt(u);
      V.lit = Math.max(V.lit, clamp(Math.floor(V.pulse + 1e-6) + 1, 0, 9));
      for (let i = 0; i < 9; i++) {
        const s = (u - arrive[i]) / (i == 5 ? 820 : 220);
        if (s >= 0 && s <= 1.3 && !dark(M.plates[i])) sparkle(plates[i], i == 5 ? "ai" : "check", Math.min(1, s));
      }
      if (onStop && V.pulse >= 0.97 && !V.stop) onStop();
      draw();
    });
    tl.at(T + len + 120, () => { V.pulse = null; draw(); });
  }
  /** The figure before the burst: the reply card, as the first frame's pre-state shows it. */
  function card0() {
    V = { ...V, e: 0, ex: Array(9).fill(0), lit: 0, pulse: null, ghost: 0 };
    darkAll();
    draw();
  }
  function intro() {
    if (RM || progress() > 0.015) return finish();
    const tl = (introTl = C.timeline(gscIntro));
    const dur = phone ? 900 : 1200;
    root.setAttribute("data-tease", "");
    card0();
    tl.span(0, dur, (q) => { V.e = C.ease.out(q); V.ex = V.ex.map((_, i) => C.ease.out(clamp(q * 1.3 - (8 - i) * 0.035, 0, 1))); draw(); });
    tl.span(dur * 0.5, 700, (q) => { V.ghost = 0.72 * q; draw(); });
    // Teaser (round 2 review): when the pulse reaches (f), "Your Brain" comes forward by itself with its seven
    // specialists, the one code picked lit, while other members' stacks run beside it. Time-driven, once;
    // any scroll into the pin skips it (introTl.skip) and the scroll state takes over.
    const T0 = dur + 100, F0 = T0 + 860, F1 = F0 + 3400, camAt = (f) => 1 - 0.14 * f;
    runPulse(tl, T0, TEASE(F1 - T0 + 380));
    tl.at(F0 + 620, () => { gsc.set("intro", false); });
    tl.span(F0, 560, (q) => { const f = smooth(q); V.k = 5; V.f = f; V.tl = f; V.q = 0; V.cam = camAt(f); V.ghost = 0.72 + 0.38 * f; draw(); });
    tl.span(F0 + 360, 1900, (q) => { V.q = 0.08 + 0.7 * q; draw(); });
    tl.span(F1, 460, (q) => { const f = 1 - smooth(q); V.f = f; V.tl = f; V.cam = camAt(f); V.ghost = 0.72 + 0.38 * f; if (q >= 1) { V.k = -1; V.q = 0; } draw(); });
    return tl.play().then(() => { if (!dead) finish(); });
  }
  /** y: the scroll position when the caller has just read it (mounting), so nothing reads it after a write. */
  function finish(y) {
    introTl = null; introDone = true;
    gsc.set("intro", false);
    V = { ...V, e: 1, ex: Array(9).fill(1), lit: 9, pulse: null, ghost: 0.72, tl: 0, k: -1, f: 0, q: 0, cam: 1 };
    curStep = "?"; root.removeAttribute("data-tease");
    lightAll();
    onScroll(true, y);
    draw();
  }

  function apply(p) {
    if (!introDone) return;
    if (wi && p < 0.88) clearWhatIf();
    if (wi) return;
    const s = stateAt(p, phone);
    const f = s.k >= 0 ? clamp(Math.min(s.q / 0.22, (1 - s.q) / 0.14), 0, 1) : 0;
    V.e = s.e; V.ex.fill(1); V.k = s.k; V.f = smooth(f); V.q = s.q; V.j = s.j; V.end = s.end; V.lit = 9;
    V.cam = 1 - 0.14 * (s.k == 5 ? V.f : 0) - 0.06 * Math.min(1, s.j * 2);
    V.ghost = s.k == 5 ? 0.72 + 0.38 * V.f : s.k >= 0 ? 0.72 - 0.47 * V.f : s.j ? 0.15 : 0.72;
    draw();
    const key = s.notes + (s.end ? "end" : "");
    if (key != curStep) { curStep = key; noteSet(s.notes, s.k >= 0 ? LET[s.k] : s.j ? "j" : "", s.dot); }
  }
  function noteSet(list, foc, dot) {
    noteLis.forEach((li) => {
      const on = !!list && list.includes(li.dataset.k), b = li.querySelector("button");
      li.toggleAttribute("data-on", on);
      li.toggleAttribute("data-focus", li.dataset.k == foc);
      b.setAttribute("aria-current", on ? "step" : "false");
      if (phone) b.tabIndex = on ? 0 : -1;
    });
    root.toggleAttribute("data-step", !!list);
    dots.forEach((x, i) => x.toggleAttribute("data-on", phone && i <= dot));
    if (!phone) nl.style.setProperty("--bh", (foc && BH[foc] ? BH[foc] : 0) + "px");
    noteAt = null;
  }
  // reading scrollY lays the page out: y, when given, is the position layout() has just read
  const progress = (y = scrollY) => (G ? clamp((y - (G.top - G.hh)) / G.len, 0, 1) : 0);
  function readScroll(force, y = scrollY) {
    if (!G) return;
    const p = progress(y), pre = clamp((G.top - G.hh - y) / (G.vh - G.hh), 0, 1);
    if (pre != V.pre) { V.pre = pre; if (!introDone || cur == target) draw(); }
    if (introTl && p > 0.015) introTl.skip();
    target = p;
    if (force) { cur = p; apply(cur); }
  }
  function onScroll(force, y) {
    if (force) readScroll(true, y);
    else need = true;
    render.wake();
  }
  k.on(window, "scroll", () => onScroll(), { passive: true });
  // the figure's own size, and the page above it (a disclosure opened, an image in): rect reads on change only
  const ro = new ResizeObserver(() => { layout(); onScroll(true, G && G.y); });
  ro.observe(grid);
  ro.observe(document.documentElement);
  k.add(() => ro.disconnect());
  // fonts still loading: measure again once they are in (already in: the mount's measure stands)
  if (document.fonts && document.fonts.status == "loading") document.fonts.ready.then(() => { if (!dead) layout(), onScroll(true, G && G.y); });
  // tiers (SHOWCASE_DESIGN.md §1.6): lite drops halos and most ghosts, minimal drops ghosts; the watchdog only steps down
  k.add(C.tier.on((n) => { root.setAttribute("data-sc-tier", n); draw(); }));

  layout(); // the mount's reads, then its first writes
  const noIntro = settled || progress(G && G.y) > 0.015 || link.test(location.hash);
  arm();
  pb.setAttribute("data-sc-pause", "");
  pb.disabled = false;
  gsc.pause("intro"); // ghosts start after the burst (they are invisible before it; no frames spent on them); Pause's first state
  // the intro runs ~7 s (burst + teaser), so Pause stops it too (WCAG 2.2.2), not only the ambient stacks
  k.on(pb, "click", () => {
    held() ? gsc.play() : gsc.pause();
    held() ? gscIntro.pause() : gscIntro.play();
  });
  if (noIntro) { finish(G && G.y); fromHash(); }
  else {
    card0();
    // burst when at least a quarter of the frame is in view
    const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) { io.disconnect(); intro(); } }, { threshold: phone ? 0.12 : 0.22 });
    io.observe(frame);
    k.add(() => io.disconnect());
  }
  return { stop };
}
