/* trainsyou Brain showcase · core engine (ES module, no dependencies).
   Data loading, decide(), one rAF loop, scenes (offscreen / hidden / idle /
   user pause), timelines, tiers + frame-time watchdog, reduced motion, live
   region, seeded randomness, DPR-capped canvases. See README.md. */
const W = typeof window != "undefined" ? window : null, D = W && document;
const mq = (q) => !!(W && W.matchMedia && matchMedia(q).matches);
const qs = W ? new URLSearchParams(location.search) : new URLSearchParams();

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
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ---------------------------------------------------------------- data */
let pending = null;
/** Loads traces (inline <script type="application/json" data-brain-traces>
    first, else `src`, else traces.client.json beside this module). */
export function load(src) {
  if (pending && !src) return pending;
  const inl = D && D.querySelector("script[data-brain-traces]");
  const p = inl ? Promise.resolve(JSON.parse(inl.textContent))
    : fetch(src || new URL("traces.client.json", import.meta.url)).then((r) => {
      if (!r.ok) throw new Error("traces " + r.status);
      return r.json();
    });
  const out = p.then(index);
  if (!src) pending = out;
  return out;
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

/* ---------------------------------------------------------------- flags + settings */
/** Page flags. Recovery (WHOOP_TRAINING_APPROVED) is off unless
    <html data-recovery="on"> or ?recovery=on. */
export function flags() {
  const r = D && D.documentElement;
  return { recovery: (r && r.getAttribute("data-recovery") == "on") || qs.get("recovery") == "on" };
}
/* ---------------------------------------------------------------- reduced motion */
const rmq = W && W.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
/** Showcases follow prefers-reduced-motion even under motion "always". Also
    <html data-reduce-motion="on"> (the member's setting) and ?motion=reduce. */
let rmv = null;
export function reduced() {
  if (rmv == null) rmv = !!((rmq && rmq.matches) || qs.get("motion") == "reduce" || (D && D.documentElement.getAttribute("data-reduce-motion") == "on"));
  return rmv;
}
export function onReduced(fn) { if (rmq && rmq.addEventListener) rmq.addEventListener("change", () => { rmv = null; fn(reduced()); }); }
export const phone = () => mq("(max-width: 760px)");

/* ---------------------------------------------------------------- tiers + watchdog */
const ua = W ? navigator.userAgent : "";
export const webkit = /iPhone|iPad|iPod/.test(ua) || (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua));
const TIERS = ["full", "lite", "minimal"];
const SPEC = { full: { ghosts: [20, 12], halos: true, dpr: 2, fps: 60 }, lite: { ghosts: [8, 8], halos: false, dpr: 1.5, fps: 30 }, minimal: { ghosts: [0, 0], halos: false, dpr: 1, fps: 30 } }; // minimal: DPR 1 (QA 27 Oct: software-composited canvases cost per pixel)
function startTier() {
  const q = qs.get("tier");
  if (SPEC[q]) return q;
  if (!W || webkit) return "full";
  const n = navigator, c = n.connection;
  return (n.hardwareConcurrency && n.hardwareConcurrency <= 4) || (n.deviceMemory && n.deviceMemory <= 3) || (c && c.saveData) ? "lite" : "full";
}
const tierFns = new Set();
export const tier = {
  name: startTier(),
  get spec() { return SPEC[this.name]; },
  get ghosts() { return SPEC[this.name].ghosts[phone() ? 1 : 0]; },
  /** Step down one tier (never up within a page view). */
  down(why) {
    const i = TIERS.indexOf(this.name);
    if (i < 2) { this.name = TIERS[i + 1]; this.log.push([this.name, why]); tierFns.forEach((f) => f(this.name)); }
  },
  on(fn) { tierFns.add(fn); },
  log: [],
};

/* ---------------------------------------------------------------- loop */
const subs = new Set();
let raf = 0, last = 0, win = [0, 0, 0, 0], idleAt = 0, warm = 0;
// Watchdog warm-up (QA 27 Oct, concept C): page load and module mount jank are not the showcase's frame cost.
// Frames are not judged until 1 s after the load event, nor in the first 500 ms after the loop (re)starts.
let loadAt = D && D.readyState == "complete" ? 0 : Infinity;
if (W && loadAt) addEventListener("load", () => (loadAt = performance.now()), { once: true });
const slow = +qs.get("slow") || 0; // QA: ?slow=30 burns 30 ms a frame to force the watchdog
export const stats = { frames: 0, gaps: [], work: [] };
const keep = (a, v) => { a.push(v); if (a.length > 1200) a.shift(); };
function frame(now) {
  raf = 0;
  const gap = last ? now - last : 0;
  if (!last) warm = now + 500;
  last = now;
  const t0 = performance.now();
  if (slow) while (performance.now() - t0 < slow);
  let live = false;
  for (const s of subs) {
    if (!s.awake || (s.sc && !s.sc.running)) continue;
    live = true;
    const fps = Math.min(s.fps || 60, tier.spec.fps);
    if (s.t && now - s.t < 1000 / fps - 4) continue;
    const dt = s.t ? Math.min(now - s.t, 100) : 16.7;
    s.t = now;
    if (s.fn(dt, now) === false) { s.awake = false; s.t = 0; }
  }
  if (now - idleAt > 1000) {
    idleAt = now;
    scenes.forEach((s) => s.running && s.idleMs && now - lastInput > s.idleMs && s.set("idle", true));
  }
  if (gap && gap < 250) {
    stats.frames++; keep(stats.gaps, gap); keep(stats.work, performance.now() - t0);
  }
  if (gap && gap < 250 && now > warm && now > loadAt + 1000) {
    win[0] += gap; win[1]++; win[2] += gap; if (gap > 25) win[3]++;
    // step down when frames average over 20 ms for 2 s, or when 1 frame in 20 is slow (> 25 ms) over 2 s:
    // a steady stutter can average under 20 ms and still break the p95 frame budget
    if (win[2] >= 2000) {
      if (win[0] / win[1] > 20) tier.down("avg " + (win[0] / win[1]).toFixed(1) + " ms");
      else if (win[1] >= 30 && win[3] / win[1] >= 0.05) tier.down(win[3] + "/" + win[1] + " frames > 25 ms");
      win = [0, 0, 0, 0];
    }
  }
  if (live) raf = requestAnimationFrame(frame);
  else last = 0, win = [0, 0, 0, 0];
}
function kick() { if (!raf && W) raf = requestAnimationFrame(frame); }
/** Registers fn(dt, now) on the one loop. Return false from fn to sleep
    until handle.wake(). Gated by its scene (paused scenes get no frames). */
export function loop(fn, o = {}) {
  const s = { fn, fps: o.fps, sc: o.scene, awake: true, t: 0 };
  subs.add(s);
  kick();
  return {
    wake() { s.awake = true; kick(); },
    stop() { subs.delete(s); },
    set fps(v) { s.fps = v; },
    get awake() { return s.awake; },
  };
}
/** p95 of a list of numbers (for QA). */
export const p95 = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length * 0.95)] : 0; };

/* ---------------------------------------------------------------- scenes */
let lastInput = W ? performance.now() : 0;
const scenes = new Set();
if (W) {
  const bump = () => {
    lastInput = performance.now();
    scenes.forEach((s) => s.reasons.has("idle") && s.o.resumeOnInput && s.play());
  };
  ["pointerdown", "keydown", "wheel", "touchstart", "scroll"].forEach((e) => addEventListener(e, bump, { passive: true, capture: true }));
  D.addEventListener("visibilitychange", () => scenes.forEach((s) => s.set("hidden", D.hidden)));
}
/** A showcase region. Pauses its loop subscribers when offscreen, when the
    tab is hidden, after idle (90 s, 60 s on phones; 0 disables) and on
    pause(). o: {idle, resumeOnInput, onState(running, reasons)}. */
export function scene(el, o = {}) {
  const s = {
    el, o, reasons: new Set(["offscreen"]), running: false, subs: [],
    idleMs: o.idle === 0 ? 0 : (o.idle || (phone() ? 60 : 90)) * 1000,
    set(r, on) {
      on ? s.reasons.add(r) : s.reasons.delete(r);
      const run = !s.reasons.size;
      if (run != s.running) {
        s.running = run;
        if (run) kick();
        o.onState && o.onState(run, [...s.reasons]);
        s.btns.forEach(sync);
      }
    },
    pause(r = "user") { s.set(r, true); },
    play() { lastInput = performance.now(); s.reasons.delete("idle"); s.set("user", false); },
    loop(fn, fps) { const l = loop(fn, { scene: s, fps }); s.subs.push(l); return l; },
    btns: [],
    /** Binds a Pause/Play button (visible label + aria-pressed). */
    button(b, lab = { pause: "Pause", play: "Play" }) {
      b._lab = lab; s.btns.push(b); sync(b);
      b.addEventListener("click", () => (s.reasons.has("user") || s.reasons.has("idle") ? s.play() : s.pause()));
    },
    destroy() { io && io.disconnect(); scenes.delete(s); s.subs.forEach((x) => x.stop()); },
  };
  const sync = (b) => {
    const p = s.reasons.has("user") || s.reasons.has("idle");
    b.setAttribute("aria-pressed", String(p));
    const t = b.querySelector("[data-label]") || b;
    t.textContent = p ? b._lab.play : b._lab.pause;
    b.setAttribute("data-state", p ? "paused" : "playing");
  };
  if (D.hidden) s.reasons.add("hidden");
  // the strip under a sticky site header (--header-h) counts as off screen (QA 27 Oct: a figure whose last 9 px sat
  // under the header kept animating)
  const hh = parseFloat(getComputedStyle(D.documentElement).getPropertyValue("--header-h")) || 0;
  const io = W.IntersectionObserver ? new IntersectionObserver((e) => s.set("offscreen", !e[e.length - 1].isIntersecting), hh > 0 ? { rootMargin: `-${hh}px 0px 0px 0px` } : undefined) : null;
  io ? io.observe(el) : s.set("offscreen", false);
  scenes.add(s);
  return s;
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

/* ---------------------------------------------------------------- live region */
let live = null;
/** Polite announcement. Use only for changes the visitor caused. */
export function say(msg) {
  if (!live) {
    live = h("div", { "aria-live": "polite", role: "status", class: "sc-sr" });
    D.body.append(live);
  }
  live.textContent = "";
  setTimeout(() => (live.textContent = msg), 60);
}

/* ---------------------------------------------------------------- canvas */
/** Sizes a canvas to w×h CSS px at a DPR capped by the tier (≤ 2). */
export function fit(cv, w, h) {
  const r = Math.min(W.devicePixelRatio || 1, tier.spec.dpr);
  cv.width = Math.round(w * r); cv.height = Math.round(h * r);
  cv.style.width = w + "px"; cv.style.height = h + "px";
  const c = cv.getContext("2d");
  c.setTransform(r, 0, 0, r, 0, 0);
  return c;
}
/** A bitmap for pre-drawn static layers (OffscreenCanvas when available). */
export function bitmap(w, h) {
  const r = Math.min(W.devicePixelRatio || 1, tier.spec.dpr);
  const cv = W.OffscreenCanvas ? new OffscreenCanvas(Math.round(w * r), Math.round(h * r)) : Object.assign(D.createElement("canvas"), { width: Math.round(w * r), height: Math.round(h * r) });
  const c = cv.getContext("2d");
  c.setTransform(r, 0, 0, r, 0, 0);
  return { cv, c };
}

/* ---------------------------------------------------------------- boot (module side) */
/** Calls mount(el) once el is within 200 px of the viewport. */
export function whenNear(el, mount) {
  if (!W.IntersectionObserver) return mount(el);
  const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) io.disconnect(), mount(el); }, { rootMargin: "200px" });
  io.observe(el);
}
/** Prefetches a module on idle after `ms`, or on the first pointerdown/focus inside `el`. */
export function prefetch(url, el, ms = 10000) {
  let done = false;
  const go = () => { if (!done) done = true, import(url).catch(() => {}); };
  setTimeout(() => (W.requestIdleCallback ? requestIdleCallback(go) : go()), ms);
  if (el) ["pointerdown", "focusin"].forEach((e) => el.addEventListener(e, go, { once: true }));
}
