/* The Brain showcases' core engine (ES module, no dependencies): data
   indexing, one rAF loop, scenes (off screen / hidden tab / idle / Pause /
   reading / a Kamran call), timelines, tiers and the frame-time watchdog,
   reduced motion, the overlay layer and its live region, seeded randomness,
   DPR-capped canvases.

   Ported from the approved prototype (docs/marketing-revamp-2026-10-26/
   prototypes/shared/brain/brain-core.js) with the production changes of
   docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.1:
   - nothing runs at import: every browser read is lazy, so the server render
     and the unit tests import this module freely;
   - load(data) takes data (prepare() in data.js builds it) and never goes to
     the network; prefetch(loader, …) takes a literal import(), never a URL;
   - no ?recovery or ?motion switches; ?tier and ?slow only for automated
     browsers (navigator.webdriver), the browser checks' own switches;
   - set() syncs the Pause buttons and onState on every change of reasons
     (the stale-Pause bug), and a Kamran call (html[data-mk-call]) pauses;
   - time in another tab is not idle time, and input ends any idle pause;
   - the watchdog ignores page events (a scroll starting, a resize, the
     consent bar) and steps back up after a good spell (tier.up);
   - data-sc-run marks a showcase root exactly while a frame is scheduled
     for it; the last scene's destroy (or destroyAll) stops the loop and
     removes the document listeners;
   - receipts, the phone sheet and the one live region live in the overlay
     layer (layer()), inside the marketing root, never on <body>. */

/* ---------------------------------------------------------------- browser (lazy) */
let W, D; // window and document, once a browser function first runs
function browser() {
  if (W === undefined) (W = typeof window != "undefined" ? window : null), (D = W && W.document);
  return W;
}
const mq = (q) => !!(browser() && W.matchMedia && W.matchMedia(q).matches);
/** ?tier= and ?slow= are the browser checks' switches: automated browsers only. */
function checkParam(name) {
  return browser() && W.navigator.webdriver ? new URLSearchParams(W.location.search).get(name) : null;
}
const now = () => performance.now();

/* ---------------------------------------------------------------- utils */
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const ease = {
  io: (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2),
  out: (k) => 1 - (1 - k) ** 3,
  in: (k) => k * k * k,
};
/** mulberry32: seeded, deterministic randomness. rng(7)() → [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Tiny DOM builder: h("div.a.b", {attr, on:{click}}, kids…). */
export function h(sel, props, ...kids) {
  browser();
  const [tag, ...cls] = sel.split(".");
  const el = D.createElement(tag || "div");
  if (cls.length) el.className = cls.join(" ");
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k == "on") for (const e in v) el.addEventListener(e, v[e]);
    else if (k == "text") el.textContent = v;
    else if (k == "html") el.innerHTML = v;
    else if (k == "style" && typeof v == "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) if (k != null && k !== false)
    Array.isArray(k) ? add(el, k) : el.append(k.nodeType ? k : String(k));
}
/** HTML-escapes text and attribute values (the platform name included). */
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ---------------------------------------------------------------- data */
/** The traces, indexed. Takes the data prepare() built (data.js); nothing is
    requested over the network. */
export function load(data) {
  return Promise.resolve(index(data));
}
/** Adds lookups: data.sp[id], data.trace("t1" | full id), data.short(t). */
export function index(d) {
  if (d.sp) return d;
  d.sp = {};
  for (const s of d.specialists) d.sp[s.id] = s;
  d.byId = {};
  for (const t of d.traces) d.byId[t.id] = d.byId[t.id.split("-")[0]] = t;
  d.trace = (id) => d.byId[id] || d.byId[String(id).split("-")[0]];
  d.short = (t) => t.id.split("-")[0];
  return d;
}

/* ---------------------------------------------------------------- reduced motion */
const REDUCE = "(prefers-reduced-motion: reduce)";
let rmv = null; // cached while the settings are watched (a scene exists)
const rmFns = new Set();
/** Showcases follow prefers-reduced-motion and the member's own setting
    (<html data-reduce-motion="on">) even under the marketing motion switch's
    "always". */
export function reduced() {
  if (!browser()) return false;
  if (rmv != null) return rmv;
  const v = mq(REDUCE) || D.documentElement.getAttribute("data-reduce-motion") == "on";
  if (watching) rmv = v;
  return v;
}
/** fn(reduced) whenever either setting changes while a scene exists. Returns
    the unsubscribe. */
export function onReduced(fn) {
  rmFns.add(fn);
  return () => rmFns.delete(fn);
}
export const phone = () => mq("(max-width: 760px)");

/* ---------------------------------------------------------------- tiers + watchdog */
const TIERS = ["full", "lite", "minimal"];
const SPEC = { full: { ghosts: [20, 12], halos: true, dpr: 2, fps: 60 }, lite: { ghosts: [8, 8], halos: false, dpr: 1.5, fps: 30 }, minimal: { ghosts: [0, 0], halos: false, dpr: 1, fps: 30 } }; // minimal: DPR 1 (QA 27 Oct: software-composited canvases cost per pixel)
function startTier() {
  const q = checkParam("tier");
  if (SPEC[q]) return q;
  if (!browser()) return "full";
  const n = W.navigator, c = n.connection, ua = n.userAgent;
  // WebKit (iOS, and in-app browsers on iPhone) reports neither memory nor a
  // reliable core count: it starts full and the watchdog decides.
  const webkit = /iPhone|iPad|iPod/.test(ua) || (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua));
  if (webkit) return "full";
  return (n.hardwareConcurrency && n.hardwareConcurrency <= 4) || (n.deviceMemory && n.deviceMemory <= 3) || (c && c.saveData) ? "lite" : "full";
}
const tierFns = new Set();
let tierName = null, tierTop = 0; // decided on first use; kept for the document (client navigation included)
const left = { full: 0, lite: 0 }; // step downs from each tier
const tierNow = () => tierName || (tierTop = TIERS.indexOf((tierName = startTier())), tierName);
function setTier(name, why) {
  tierName = name;
  tier.log.push([name, why]);
  win = []; winMs = 0; good = 0; bad = false;
  hold(500); // the engines measure and size their canvases again
  tierFns.forEach((f) => f(name));
}
export const tier = {
  get name() { return tierNow(); },
  get spec() { return SPEC[tierNow()]; },
  get ghosts() { return SPEC[tierNow()].ghosts[phone() ? 1 : 0]; },
  /** Step down one tier. */
  down(why) {
    const i = TIERS.indexOf(tierNow());
    if (i < 2) left[TIERS[i]]++, setTier(TIERS[i + 1], why);
  },
  /** Step back up one tier: never above the starting tier, and only into a tier
      left once (a tier left twice holds for the document). A step up wakes every
      sleeping loop subscriber, so one that slept for the lower tier looks again. */
  up(why) {
    const i = TIERS.indexOf(tierNow());
    if (i <= tierTop || left[TIERS[i - 1]] > 1) return;
    setTier(TIERS[i - 1], "up: " + why);
    subs.forEach((s) => (s.awake = true));
    kick();
  },
  /** fn(name) on every change of tier. Returns the unsubscribe. */
  on(fn) { tierFns.add(fn); return () => tierFns.delete(fn); },
  log: [],
};

/* ---------------------------------------------------------------- loop */
const subs = new Set();
let raf = 0, nap = 0, napped = false, last = 0, idleAt = 0, slow = null;
/* The watchdog judges frame gaps (under 250 ms) in windows of 2 s. It steps
   the tier down when a window's median gap is over 20 ms, or when two windows
   in a row stutter: 1 frame in 20 (of 30 or more) over 25 ms, which keeps the
   median at one frame and still breaks the p95 frame budget. Two windows in a
   row with fewer than 1 frame in 40 over 25 ms step it back up (tier.up).
   Page events are not the showcase's frame cost, so frames are not judged
   until 1 s after the load event (QA 27 Oct, concept C), in the 500 ms after
   the loop (re)starts or the tier changes, after a nap, or in the 300 ms
   after a scroll starts, a resize, or a change to <html>'s attributes (a
   restyle of the whole document: QA 28 Oct, the consent bar's height on the
   first scroll). */
let win = [], winMs = 0, good = 0, bad = false, judgeFrom = 0, loadAt = null;
const hold = (ms) => (judgeFrom = Math.max(judgeFrom, now() + ms));
function watchLoad() {
  if (loadAt != null) return;
  loadAt = D.readyState == "complete" ? 0 : Infinity;
  if (loadAt) W.addEventListener("load", () => (loadAt = now()), { once: true });
}
function judge() {
  const n = win.length, late = win.filter((g) => g > 25).length, mid = win.sort((a, b) => a - b)[n >> 1];
  const stutter = n >= 30 && late / n >= 0.05, again = stutter && bad;
  win = []; winMs = 0; bad = stutter;
  if (mid > 20) tier.down("median " + mid.toFixed(1) + " ms");
  else if (again) tier.down(late + "/" + n + " frames > 25 ms, a second window");
  else if (stutter || n < 30 || late / n >= 0.025) good = 0;
  else if (++good >= 2) (good = 0), tier.up(late + "/" + n + " frames > 25 ms");
}
/** A subscriber's frame interval at its fps, capped by the tier (4 ms early is on time). */
const every = (s) => 1000 / Math.min(s.fps || 60, tier.spec.fps) - 4;
function frame(t) {
  raf = 0;
  const gap = last && !napped ? t - last : 0, early = napped ? 16.7 : 0;
  if (!last) hold(500);
  last = t; napped = false;
  const t0 = now();
  if (slow == null) slow = +checkParam("slow") || 0; // ?slow=30 burns 30 ms a frame to force the watchdog
  if (slow) while (now() - t0 < slow);
  let next = Infinity; // when the next subscriber is due
  for (const s of subs) {
    if (!s.awake || (s.sc && !s.sc.running)) continue;
    // after a nap, whatever is due within a frame runs now too: slow subscribers keep one nap
    if (s.t && t - s.t < every(s) - early) { next = Math.min(next, s.t + every(s)); continue; }
    const dt = s.t ? Math.min(t - s.t, 100) : 16.7;
    s.t = t;
    if (s.fn(dt, t) === false) (s.awake = false), (s.t = 0);
    else next = Math.min(next, t + every(s));
  }
  if (t - idleAt > 1000) {
    idleAt = t;
    scenes.forEach((s) => s.running && s.idleMs && t - Math.max(lastInput, s.since) > s.idleMs && s.set("idle", true));
  }
  if (gap && gap < 250 && t > judgeFrom && t > loadAt + 1000) {
    win.push(gap);
    if ((winMs += gap) >= 2000) judge();
  }
  if (next == Infinity) (last = 0), (win = []), (winMs = 0), (bad = false);
  // A kick in this frame (a subscriber woke, the tier changed) has asked for
  // the next one already: one frame a frame.
  else if (raf);
  // Nothing due in the next two frames (12 fps breathing, the 10 fps
  // reduced-motion field): nap until it is due, then ask for a frame, instead
  // of waking at every frame. 30 and 60 fps wake at every frame: the watchdog
  // judges those gaps.
  else if (next - t > 42) (napped = true), (nap = setTimeout(() => { nap = 0; raf = W.requestAnimationFrame(frame); }, next - now()));
  else raf = W.requestAnimationFrame(frame);
  marks();
}
function kick() {
  if (!raf && browser()) {
    if (nap) clearTimeout(nap), (nap = 0);
    watchLoad();
    raf = W.requestAnimationFrame(frame);
  }
  marks();
}
/* data-sc-run: on a showcase root exactly while a frame is scheduled (or a
   nap runs) that will run one of its scenes' subscribers (the browser checks
   read it). */
const marked = new Set();
function marks() {
  const on = new Set();
  if (raf || nap) for (const s of subs) if (s.awake && s.sc && s.sc.running) on.add(s.sc.root);
  for (const r of marked) if (!on.has(r)) r.removeAttribute("data-sc-run"), marked.delete(r);
  for (const r of on) if (!marked.has(r)) r.setAttribute("data-sc-run", ""), marked.add(r);
}
function halt() {
  if (raf) W.cancelAnimationFrame(raf);
  if (nap) clearTimeout(nap);
  raf = nap = last = 0; win = []; winMs = 0; bad = false;
  marks();
}
/** Registers fn(dt, now) on the one loop. Return false from fn to sleep
    until handle.wake(). Gated by its scene (paused scenes get no frames). */
export function loop(fn, o = {}) {
  const s = { fn, fps: o.fps, sc: o.scene, awake: true, t: 0 };
  subs.add(s);
  kick();
  return {
    wake() { s.awake = true; kick(); },
    stop() { subs.delete(s); if (!subs.size) halt(); else marks(); },
    set fps(v) { s.fps = v; },
    get awake() { return s.awake; },
  };
}

/* ---------------------------------------------------------------- scenes */
let lastInput = 0, scrollAt = 0;
const scenes = new Set();
/* The document listeners live while a scene exists: input (idle resume),
   the hidden tab, a Kamran call, both reduced-motion settings, and what the
   watchdog does not judge (a scroll starting, a resize, <html>'s attributes). */
let watching = null;
function listen() {
  if (watching) return;
  lastInput = now();
  const html = D.documentElement, rmq = W.matchMedia ? W.matchMedia(REDUCE) : null;
  const bump = (e) => {
    lastInput = now();
    if (e.type == "scroll") {
      if (lastInput - scrollAt > 500) hold(300); // a scroll starts
      scrollAt = lastInput;
    }
    scenes.forEach((s) => s.reasons.has("idle") && s.o.resumeOnInput !== false && s.set("idle", false));
  };
  const hidden = () => scenes.forEach((s) => s.set("hidden", D.hidden));
  const shown = (e) => e.persisted && (lastInput = now()); // back from the back/forward cache: no idle time
  const call = () => scenes.forEach((s) => s.set("call", html.hasAttribute("data-mk-call")));
  const motion = () => {
    rmv = null;
    const v = reduced();
    rmFns.forEach((f) => f(v));
  };
  const resize = () => hold(300);
  const INPUT = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"], opt = { passive: true, capture: true };
  INPUT.forEach((e) => W.addEventListener(e, bump, opt));
  W.addEventListener("resize", resize);
  W.addEventListener("pageshow", shown);
  D.addEventListener("visibilitychange", hidden);
  if (rmq && rmq.addEventListener) rmq.addEventListener("change", motion);
  const mo = W.MutationObserver ? new MutationObserver((list) => {
    for (const m of list) m.attributeName == "data-mk-call" ? call() : m.attributeName == "data-reduce-motion" ? motion() : hold(300);
  }) : null;
  if (mo) mo.observe(html, { attributes: true });
  watching = () => {
    INPUT.forEach((e) => W.removeEventListener(e, bump, opt));
    W.removeEventListener("resize", resize);
    W.removeEventListener("pageshow", shown);
    D.removeEventListener("visibilitychange", hidden);
    if (rmq && rmq.removeEventListener) rmq.removeEventListener("change", motion);
    if (mo) mo.disconnect();
  };
}
function quiet() {
  if (watching) watching(), (watching = null), (rmv = null);
}
/** A showcase region. Pauses its loop subscribers when off screen, when the
    tab is hidden, during a Kamran call, after idle (90 s, 60 s on phones; 0
    disables) and on pause(). Idle counts from the last input or from when the
    scene last started running (back from another tab, on screen again), and
    input ends an idle pause unless resumeOnInput is false.
    o: {idle, resumeOnInput, onState(running, reasons)}. */
export function scene(el, o = {}) {
  browser();
  listen();
  const s = {
    el, o, root: el.closest("[data-showcase]") || el, reasons: new Set(["offscreen"]), running: false, since: 0,
    idleMs: o.idle === 0 ? 0 : (o.idle || (phone() ? 60 : 90)) * 1000,
    set(r, on) {
      if (s.reasons.has(r) == !!on) return;
      on ? s.reasons.add(r) : s.reasons.delete(r);
      apply();
    },
    pause(r = "user") { s.set(r, true); },
    play() {
      lastInput = now();
      const idle = s.reasons.delete("idle"), user = s.reasons.delete("user");
      if (idle || user) apply();
    },
    loop(fn, fps) { return loop(fn, { scene: s, fps }); },
    btns: [],
    /** Binds a Pause/Play button; every Pause control carries [data-sc-pause].
        Its label says what a press does ("Pause", or "Play" while the visitor's
        pause or idle holds), so it carries no aria-pressed: a toggle's name
        never changes (ARIA practices). */
    button(b, lab = { pause: "Pause", play: "Play" }) {
      b._lab = lab; b.setAttribute("data-sc-pause", ""); b.removeAttribute("aria-pressed"); s.btns.push(b); sync(b);
      b.addEventListener("click", () => (s.reasons.has("user") || s.reasons.has("idle") ? s.play() : s.pause()));
    },
    destroy() {
      if (!scenes.delete(s)) return;
      io && io.disconnect();
      for (const x of [...subs]) if (x.sc == s) subs.delete(x);
      s.running = false;
      if (!scenes.size) quiet();
      if (!subs.size) halt(); else marks();
    },
  };
  // Every change of reasons (not only a flip of running) reaches the buttons
  // and onState: open a receipt, press Pause, close it, and the button reads
  // "Play" (the prototype's stale label).
  function apply() {
    const run = !s.reasons.size;
    if (run != s.running) { s.running = run; if (run) (s.since = now()), kick(); }
    o.onState && o.onState(run, [...s.reasons]);
    s.btns.forEach(sync);
    marks();
  }
  // Writes only what changed: a label written again is a new text node (a restyle).
  const sync = (b) => {
    const p = s.reasons.has("user") || s.reasons.has("idle"), t = b.querySelector("[data-label]") || b, label = p ? b._lab.play : b._lab.pause;
    if (t.textContent != label) t.textContent = label;
    if (b.getAttribute("data-state") != (p ? "paused" : "playing")) b.setAttribute("data-state", p ? "paused" : "playing");
  };
  if (D.hidden) s.reasons.add("hidden");
  if (D.documentElement.hasAttribute("data-mk-call")) s.reasons.add("call");
  // the strip under the sticky site header (--sc-top, app/brain-stage.css) counts as off screen (QA 27 Oct: a
  // figure whose last 9 px sat under the header kept animating)
  const top = parseFloat(W.getComputedStyle(el).getPropertyValue("--sc-top")) || 0;
  const io = W.IntersectionObserver ? new IntersectionObserver((e) => s.set("offscreen", !e[e.length - 1].isIntersecting), top > 0 ? { rootMargin: `-${top}px 0px 0px 0px` } : undefined) : null;
  scenes.add(s);
  io ? io.observe(el) : s.set("offscreen", false);
  return s;
}
/** Stops everything: every scene, every loop subscriber, the scheduled frame
    and the document listeners. The tier is kept for the document. */
export function destroyAll() {
  [...scenes].forEach((s) => s.destroy());
  subs.clear();
  halt();
  quiet();
  rmFns.clear();
  tierFns.clear();
  clearTimeout(liveAt);
}

/* ---------------------------------------------------------------- timelines */
/** Scheduled events on a scene's clock (pauses with the scene).
    tl.at(ms, fn) · tl.span(ms, dur, fn(k)) · tl.play(speed) → Promise ·
    tl.skip() runs everything now · tl.stop(). */
export function timeline(sc) {
  const ev = [], sp = [];
  let t = 0, i = 0, sub = null, res = null, speed = 1;
  const tick = () => {
    while (i < ev.length && ev[i][0] <= t) ev[i++][1](t);
    for (const x of sp) if (!x.done && t >= x.a) { const k = x.d ? clamp((t - x.a) / x.d, 0, 1) : 1; x.fn(k); if (k >= 1) x.done = 1; }
    if (i >= ev.length && sp.every((x) => x.done)) { tl.stop(); res && res(); return false; }
  };
  const tl = {
    get t() { return t; },
    at(ms, fn) { ev.push([ms, fn]); return tl; },
    span(ms, dur, fn) { sp.push({ a: ms, d: dur, fn }); return tl; },
    play(k = 1) {
      speed = k; ev.sort((a, b) => a[0] - b[0]);
      const p = new Promise((r) => (res = r));
      sub = (sc ? sc.loop.bind(sc) : (f) => loop(f))((dt) => { t += dt * speed; return tick(); });
      return p;
    },
    skip() { t = Infinity; tick(); },
    stop() { if (sub) sub.stop(), (sub = null); },
  };
  return tl;
}

/* ---------------------------------------------------------------- overlay layer */
/* Receipts, their backdrop, the field's phone settings sheet and the live
   region mount in one layer, the last child of the marketing root (.mk): the
   --mk-* tokens reach it and its rules stay under [data-showcase]
   (app/brain-stage.css). Counted by holder; the last release removes it. */
const layers = new Map(); // host element → {el, n}
/** The overlay layer for a showcase root: {el, release()}. */
export function layer(root) {
  browser();
  const host = root.closest(".mk") || D.body;
  let l = layers.get(host);
  if (!l || !l.el.isConnected) {
    l = { el: h("div.sc-layer", { "data-showcase": "layer" }), n: 0 };
    host.append(l.el);
    layers.set(host, l);
  }
  l.n++;
  let held = true;
  return {
    el: l.el,
    release() {
      if (!held) return;
      held = false;
      if (--l.n > 0) return;
      l.el.remove();
      if (layers.get(host) == l) layers.delete(host);
    },
  };
}
/** Makes everything outside el inert (the other children of el and of each
    of its ancestors below <html>): the page behind a modal in the overlay
    layer is out of reach for focus, the pointer and assistive tech. Returns
    the undo, which restores only what it set. */
export function inertOutside(el) {
  browser();
  const set = [];
  for (let n = el; n.parentElement && n.parentElement != D.documentElement; n = n.parentElement)
    for (const s of n.parentElement.children) if (s != n && !s.inert && s.tagName != "SCRIPT") (s.inert = true), set.push(s);
  return () => set.forEach((s) => (s.inert = false));
}

/* ---------------------------------------------------------------- live region */
let live = null, liveAt = 0;
/** Polite announcement, in the one live region (in the overlay layer). Use
    only for changes the visitor caused. */
export function say(msg) {
  if (!browser()) return;
  if (!live || !live.isConnected) {
    const l = [...layers.values()].find((x) => x.el.isConnected);
    if (!l) return;
    live = l.el.querySelector("[data-sc-live]") || l.el.appendChild(h("div.sc-sr", { "aria-live": "polite", role: "status", "data-sc-live": true }));
  }
  const el = live;
  el.textContent = "";
  clearTimeout(liveAt);
  liveAt = setTimeout(() => (el.textContent = msg), 60);
}

/* ---------------------------------------------------------------- canvas */
/** Sizes a canvas to w×h CSS px at a DPR capped by the tier (≤ 2). */
export function fit(cv, w, h) {
  browser();
  const r = Math.min(W.devicePixelRatio || 1, tier.spec.dpr);
  cv.width = Math.round(w * r); cv.height = Math.round(h * r);
  cv.style.width = w + "px"; cv.style.height = h + "px";
  const c = cv.getContext("2d");
  c.setTransform(r, 0, 0, r, 0, 0);
  return c;
}
/** A bitmap for pre-drawn static layers (OffscreenCanvas when available). */
export function bitmap(w, h) {
  browser();
  const r = Math.min(W.devicePixelRatio || 1, tier.spec.dpr);
  const cv = W.OffscreenCanvas ? new OffscreenCanvas(Math.round(w * r), Math.round(h * r)) : Object.assign(D.createElement("canvas"), { width: Math.round(w * r), height: Math.round(h * r) });
  const c = cv.getContext("2d");
  c.setTransform(r, 0, 0, r, 0, 0);
  return { cv, c };
}

/* ---------------------------------------------------------------- prefetch */
/** Prefetches a module on idle after `ms`, or on the first pointerdown/focus
    inside `el`. `loader` is a literal import, e.g. () => import("./receipt.js"),
    so the bundler can split it. Returns the cancel. */
export function prefetch(loader, el, ms = 10000) {
  browser();
  let done = false;
  const go = () => { if (!done) (done = true), loader().catch(() => {}); };
  const t = setTimeout(() => (W.requestIdleCallback ? W.requestIdleCallback(go) : go()), ms);
  const ev = ["pointerdown", "focusin"];
  if (el) ev.forEach((e) => el.addEventListener(e, go, { once: true }));
  return () => { done = true; clearTimeout(t); if (el) ev.forEach((e) => el.removeEventListener(e, go)); };
}
