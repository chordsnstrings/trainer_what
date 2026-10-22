// The scroll-scenes engine's frame loop (apps/web/components/marketing/
// scroll-scenes.ts, docs/features/scroll-scenes.md, "The frame loop"): it is
// event-driven and stops when nothing can change. These tests drive the real
// engine in a small fake page (no DOM library): a frame clock, the window's
// listeners and the observers it creates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_MS, mountScenes, registerScene, type Ctx } from "../apps/web/components/marketing/scroll-scenes.ts";

type Call = { name: string; p: number; t: number; mx: number };
const calls: Call[] = [];
const probe = (name: string) => () => (c: Ctx) => {
  calls.push({ name, p: c.p, t: c.t, mx: c.mx });
  c.move(c.el, c.p < 1 ? { y: 10 * (1 - c.p) } : {});
};
// A pure function of progress, and one that also moves with time and the pointer.
registerScene("probe", probe("probe"));
registerScene("probe-ambient", probe("probe-ambient"), { ambient: true });

type Listener = { type: string; fn: (e?: unknown) => void; options: unknown };

class FakeElement {
  dataset: Record<string, string>;
  style: Record<string, string> = { transform: "", opacity: "", transformOrigin: "", clipPath: "", transition: "" };
  listeners: Listener[] = [];
  constructor(
    scene: string,
    public top: number,
    public offsetHeight = 600,
  ) {
    this.dataset = { scene };
  }
  scrollHeight = 0;
  clientHeight = 0;
  hasAttribute() {
    return false;
  }
  querySelector() {
    return null;
  }
  getBoundingClientRect() {
    return { top: this.top - page.scrollY, height: this.offsetHeight };
  }
  addEventListener(type: string, fn: () => void, options?: unknown) {
    this.listeners.push({ type, fn, options });
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners = this.listeners.filter((l) => l.type !== type || l.fn !== fn);
  }
}

/** The fake page: one shared state, reset for each test. */
const page = {
  clock: 1000,
  scrollY: 0,
  frames: new Map<number, (now: number) => void>(),
  nextFrame: 1,
  listeners: [] as Listener[],
  classes: new Set<string>(),
  attributes: new Set<string>(),
  observers: { intersection: [] as Fake[], mutation: [] as Fake[], resize: [] as Fake[] },
  fontsReady: Promise.resolve(),
};
type Fake = { callback: (...args: unknown[]) => void; observed: unknown[]; options: unknown[]; disconnected: boolean };
const observer = (list: Fake[]) =>
  class {
    fake: Fake;
    constructor(callback: (...args: unknown[]) => void) {
      this.fake = { callback, observed: [], options: [], disconnected: false };
      list.push(this.fake);
    }
    observe(target: unknown, options?: unknown) {
      this.fake.observed.push(target);
      this.fake.options.push(options);
    }
    disconnect() {
      this.fake.disconnected = true;
    }
  };

function reset() {
  calls.length = 0;
  page.clock = 1000;
  page.scrollY = 0;
  page.frames.clear();
  page.listeners = [];
  page.classes = new Set(["scenes-on"]);
  page.attributes = new Set();
  page.observers = { intersection: [], mutation: [], resize: [] };
  const html = {
    classList: { contains: (c: string) => page.classes.has(c) },
    hasAttribute: (a: string) => page.attributes.has(a),
  };
  Object.assign(globalThis as unknown as Record<string, unknown>, {
    innerWidth: 1366,
    innerHeight: 800,
    document: { documentElement: html, body: { body: true }, fonts: { ready: page.fontsReady } },
    getComputedStyle: () => ({
      paddingTop: "0",
      paddingBottom: "0",
      borderTopWidth: "0",
      borderBottomWidth: "0",
      top: "0",
      transform: "none",
      opacity: "1",
      direction: "ltr",
    }),
    addEventListener: (type: string, fn: () => void, options?: unknown) => page.listeners.push({ type, fn, options }),
    removeEventListener: (type: string, fn: () => void) => {
      page.listeners = page.listeners.filter((l) => l.type !== type || l.fn !== fn);
    },
    requestAnimationFrame: (fn: (now: number) => void) => {
      const id = page.nextFrame++;
      page.frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame: (id: number) => page.frames.delete(id),
    IntersectionObserver: observer(page.observers.intersection),
    MutationObserver: observer(page.observers.mutation),
    ResizeObserver: observer(page.observers.resize),
  });
  Object.defineProperty(globalThis, "scrollY", { get: () => page.scrollY, configurable: true });
  Object.defineProperty(globalThis, "performance", { value: { now: () => page.clock }, configurable: true, writable: true });
}

/** One frame, 16ms after the last; returns how many callbacks ran. */
function frame() {
  page.clock += 16;
  const due = [...page.frames.values()];
  page.frames.clear();
  due.forEach((fn) => fn(page.clock));
  return due.length;
}
/** Frames until the loop stops (at most `max`); returns how many there were. */
function untilIdle(max = 200) {
  let n = 0;
  while (page.frames.size && n < max) n += frame();
  return n;
}
const fire = (type: string, e?: unknown) => page.listeners.filter((l) => l.type === type).forEach((l) => l.fn(e));
const intersect = (...els: FakeElement[]) =>
  page.observers.intersection[0].callback(els.map((target) => ({ target, isIntersecting: true })));
const mutate = (attributeName: string) => page.observers.mutation[0].callback([{ attributeName }]);
function mount(...els: FakeElement[]) {
  return mountScenes({ querySelectorAll: () => els } as unknown as ParentNode);
}
const maxIdleFrames = Math.ceil(IDLE_MS / 16) + 1;

test("the loop stops shortly after the last wake-up and draws a pure scene only when its progress changes", () => {
  reset();
  // Its top at 500px in an 800px viewport: progress (800 - 500) / (800 x .7).
  const el = new FakeElement("probe", 500);
  const cleanup = mount(el);
  intersect(el);
  const n = untilIdle();
  assert.ok(n > 0 && n <= maxIdleFrames, `${n} frames after mounting`);
  assert.equal(page.frames.size, 0, "the loop stopped");
  assert.deepEqual(calls.map((c) => c.p.toFixed(3)), ["0.536"], "drawn once: progress did not change");
  // A second with no input: no frame at all.
  page.clock += 1000;
  assert.equal(page.frames.size, 0);
  // A scroll wakes it and the scene draws at the new progress, then it stops again.
  page.scrollY = 112;
  fire("scroll");
  assert.equal(page.frames.size, 1, "a scroll requests a frame");
  fire("scroll");
  assert.equal(page.frames.size, 1, "never more than one frame pending");
  assert.ok(untilIdle() <= maxIdleFrames);
  assert.deepEqual(calls.map((c) => c.p.toFixed(3)), ["0.536", "0.736"]);
  // Fully in: the scene is at rest and no inline style is left.
  page.scrollY = 1000;
  fire("scroll");
  untilIdle();
  assert.equal(calls.at(-1)?.p, 1);
  assert.equal(el.style.transform, "");
  cleanup();
});

test("an ambient scene is drawn on every frame only while it is part-way through", () => {
  reset();
  const el = new FakeElement("probe-ambient", 500);
  const cleanup = mount(el);
  intersect(el);
  for (let i = 0; i < 40; i++) frame();
  assert.equal(page.frames.size, 1, "still running 640ms later: it floats with time");
  assert.equal(calls.length, 40);
  assert.ok(calls.at(-1)!.t > calls[0].t);
  // The pointer moves it, so pointer input reaches it.
  fire("pointermove", { clientX: 1366, clientY: 400 });
  frame();
  assert.equal(calls.at(-1)?.mx, 0.5);
  // Landed: it stops.
  page.scrollY = 1000;
  fire("scroll");
  untilIdle();
  assert.equal(page.frames.size, 0);
  assert.equal(calls.at(-1)?.p, 1);
  cleanup();
});

test("pointer input wakes the loop only when an ambient scene is mounted", () => {
  reset();
  const el = new FakeElement("probe", 500);
  const cleanup = mount(el);
  intersect(el);
  untilIdle();
  fire("pointermove", { clientX: 10, clientY: 10 });
  assert.equal(page.frames.size, 0, "a pure scene ignores the pointer");
  cleanup();
});

test("scenes-on removed: the inline styles go at once, without a scroll, and the loop sleeps until it comes back", () => {
  reset();
  const el = new FakeElement("probe", 500);
  const cleanup = mount(el);
  intersect(el);
  untilIdle();
  assert.notEqual(el.style.transform, "", "part-way through: moved");
  page.clock += 1000;
  page.classes.delete("scenes-on");
  mutate("class");
  assert.equal(page.frames.size, 1, "removing the class wakes the loop");
  frame();
  assert.equal(el.style.transform, "", "today's page at once");
  assert.equal(page.frames.size, 0, "and the loop sleeps");
  page.classes.add("scenes-on");
  mutate("class");
  untilIdle();
  assert.notEqual(el.style.transform, "", "drawn again when scenes come back");
  cleanup();
});

test("data-scenes-still wakes the loop and redraws a moving scene at its still pose", () => {
  reset();
  const el = new FakeElement("probe-ambient", 500);
  const cleanup = mount(el);
  intersect(el);
  for (let i = 0; i < 10; i++) frame();
  assert.ok(calls.at(-1)!.t > 0);
  page.attributes.add("data-scenes-still");
  mutate("data-scenes-still");
  const n = untilIdle();
  assert.ok(n > 0 && n <= maxIdleFrames, `${n} frames after the toggle`);
  assert.equal(calls.at(-1)?.t, 0, "redrawn with the clock at 0");
  assert.equal(page.frames.size, 0, "still: nothing moves on its own, so the loop stops");
  page.attributes.delete("data-scenes-still");
  mutate("data-scenes-still");
  assert.equal(page.frames.size, 1);
  cleanup();
});

test("resize, web fonts, a seek and a change of size each wake the loop", async () => {
  reset();
  const el = new FakeElement("probe", 500);
  const cleanup = mount(el);
  intersect(el);
  untilIdle();
  const before = calls.length;
  fire("resize");
  assert.equal(page.frames.size, 1, "resize");
  untilIdle();
  assert.equal(calls.length, before + 1, "resize measures again and redraws");
  await page.fontsReady;
  await Promise.resolve();
  untilIdle();
  assert.equal(calls.length, before + 2, "the web fonts being ready measures again and redraws");
  el.listeners.filter((l) => l.type === "mk-scene:seek").forEach((l) => l.fn());
  assert.equal(page.frames.size, 1, "mk-scene:seek");
  untilIdle();
  const sizes = page.observers.resize[0];
  assert.ok(sizes.observed.includes(el) && sizes.observed.some((t) => (t as { body?: boolean }).body), "the page and each scene are watched");
  sizes.callback([]);
  assert.equal(page.frames.size, 1, "content changing size");
  untilIdle();
  cleanup();
});

test("every listener is passive and the cleanup removes all of them", () => {
  reset();
  const el = new FakeElement("probe", 500);
  const cleanup = mount(el);
  const types = page.listeners.map((l) => l.type).sort();
  assert.deepEqual(types, ["pointermove", "resize", "scroll"]);
  for (const l of [...page.listeners, ...el.listeners])
    assert.deepEqual(l.options, { passive: true }, `${l.type} is passive`);
  assert.deepEqual(page.observers.mutation[0].options, [{ attributes: true, attributeFilter: ["class", "data-scenes-still"] }]);
  const scroll = page.listeners.find((l) => l.type === "scroll")!.fn;
  cleanup();
  assert.equal(page.listeners.length, 0);
  assert.equal(el.listeners.length, 0);
  for (const kind of ["intersection", "mutation", "resize"] as const)
    assert.ok(page.observers[kind].every((o) => o.disconnected), `${kind} observer disconnected`);
  assert.equal(page.frames.size, 0);
  scroll();
  assert.equal(page.frames.size, 0, "nothing wakes it after the cleanup");
});

test("without scenes-on the engine does nothing", () => {
  reset();
  page.classes.clear();
  const cleanup = mount(new FakeElement("probe", 500));
  assert.equal(page.listeners.length, 0);
  assert.equal(page.frames.size, 0);
  cleanup();
});
