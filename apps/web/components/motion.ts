"use client";
/**
 * Microanimations for subscriber surfaces (docs/features/motion.md). Small,
 * quick and purposeful: a press answers a tap, a new page or panel settles
 * in, a logged set confirms itself, a value moves the way it changed.
 * Nothing loops except live states (listening, typing, loading), nothing
 * delays input, and everything is skipped when motion is reduced (the
 * device setting or the member's own "Reduce motion" choice).
 *
 * CSS carries most of it (app/motion.css; the tokens below mirror its
 * custom properties). These helpers play the few that need to know what
 * changed, with the Web Animations API, without remounting anything. Only
 * transform and opacity move (plus stroke-dashoffset for SVG rings and
 * checks).
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

/** Durations in milliseconds (app/motion.css uses the same values). */
export const MOTION = {
  /** A press answering a tap; a tint. */
  instant: 80,
  /** Release, a tab crossfade, a number rolling, small state changes. */
  fast: 140,
  /** Arrivals (cards, toasts, messages) and exits; disclosure height. */
  base: 200,
  /** Sheets and bars sliding in from the bottom edge. */
  slow: 280,
  /** Celebration and progress only (a finished workout, a success check). */
  emphasis: 420,
  /** Bars and rings growing to their value the first time they are seen. */
  progress: 640,
  /** Delay between siblings that arrive together. */
  stagger: 30,
  /** A refresh shorter than this never shows the top bar's refresh bar. */
  refreshDelay: 400,
  /** How many siblings are staggered; the rest arrive with the last. */
  staggerMax: 6,
  /** The only loops: live states. */
  loopTyping: 1200,
  loopShimmer: 1400,
  loopBreathe: 4000,
} as const;

/** Easing curves (app/motion.css uses the same values). */
export const EASE = {
  /** Arrivals and releases: fast start, soft landing. */
  out: "cubic-bezier(0.2, 0, 0, 1)",
  /** Departures: gentle start, quick finish. */
  in: "cubic-bezier(0.4, 0, 1, 1)",
  /** Moving from one place to another (the tab indicator). */
  inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  /** A small overshoot for success moments only. */
  spring: "cubic-bezier(0.34, 1.4, 0.64, 1)",
} as const;

/** Distances in CSS pixels (app/motion.css --motion-distance-*). */
export const DISTANCE = { xs: 4, sm: 8, md: 16 } as const;

/**
 * What the motion check (scripts/motion-check.mjs) holds every running
 * animation to: at most 420 ms, rings and progress at most 700 ms; only the
 * live loops repeat.
 */
export const MOTION_LIMITS = { any: 420, progress: 700 } as const;

/** Set to "on" on <html> by the member's "Reduce motion" choice. */
export const REDUCE_MOTION_ATTRIBUTE = "data-reduce-motion";

/**
 * True when motion should be reduced: the device asks for it, the member
 * chose "Reduce motion" in Display preferences, or there is no browser.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return true;
  if (
    typeof document !== "undefined" &&
    document.documentElement?.getAttribute?.(REDUCE_MOTION_ATTRIBUTE) === "on"
  )
    return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 1 left to right, -1 right to left: multiply horizontal movement by it. */
export function inlineSign(el?: Element | null): 1 | -1 {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function")
    return 1;
  const target = el ?? document.documentElement;
  return getComputedStyle(target).direction === "rtl" ? -1 : 1;
}

/**
 * Plays a Web Animation on an element unless motion is reduced or the
 * browser cannot animate. Returns the animation, or null when skipped.
 */
export function playMotion(
  el: Element | null | undefined,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (!el || typeof (el as HTMLElement).animate !== "function") return null;
  if (prefersReducedMotion()) return null;
  return (el as HTMLElement).animate(keyframes, options);
}

/** The delay for the nth sibling arriving together; the 6th and later share one. */
export function stagger(
  index: number,
  step: number = MOTION.stagger,
  cap: number = MOTION.staggerMax - 1,
) {
  return Math.min(Math.max(0, index), cap) * step;
}

/** Keyframes for a block arriving: a fade and a small rise. */
export function arrivalKeyframes(rise: number = DISTANCE.sm): Keyframe[] {
  return [
    { opacity: 0, transform: `translateY(${rise}px)` },
    { opacity: 1, transform: "none" },
  ];
}

/**
 * Screens (or anything keyed) seen in this tab. Entry animations play on a
 * screen's first view only; coming back to it is still.
 */
const seen = new Set<string>();
/** True the first time `key` is asked about in this tab, then false. */
export function firstView(key: string) {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
/** For tests: forget what was seen. */
export function resetFirstViews() {
  seen.clear();
}

/**
 * Fixed UI inside page content: the sticky action bar, bottom sheets, and
 * anything another screen marks with data-fixed-ui (an install prompt, a
 * toast). A transform on one of their ancestors would carry them along.
 */
export const FIXED_UI = ".sticky-action-bar, .bottom-sheet, [data-fixed-ui]";
const SKIP = `.skip-link, [hidden], script, style, template, ${FIXED_UI}`;

/**
 * The blocks of a container that arrive one after another. A block holding
 * fixed UI is entered instead (its children arrive; the fixed piece keeps
 * its own entrance), so nothing fixed ever sits inside a moving box. A
 * screen's own wrapper marked `data-stagger` (Today, the programme, chat,
 * settings) is entered too, so its blocks arrive one by one rather than
 * the whole screen as one.
 */
export function arrivalTargets(container: Element, depth = 0): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(container.children)) {
    if (el.matches(SKIP)) continue;
    const fixed = !!el.querySelector(FIXED_UI);
    if ((fixed || el.hasAttribute("data-stagger")) && depth < 3) {
      out.push(...arrivalTargets(el, depth + 1));
      continue;
    }
    if (fixed) continue;
    out.push(el);
  }
  return out;
}

/** The arrival playing on each block, so a new one can replace it. */
const arrivals = new WeakMap<Element, Animation>();

/**
 * Lets the blocks of a container settle in, one after another: a screen's
 * first view, a newly selected tab panel. Opacity and an 8 px rise only;
 * the first six are 30 ms apart, the rest arrive with the sixth.
 */
export function playArrival(
  container: Element | null | undefined,
  rise: number = DISTANCE.sm,
) {
  if (!container || prefersReducedMotion()) return;
  arrivalTargets(container).forEach((el, index) => {
    // A second arrival (a quick second tap) replaces the first.
    arrivals.get(el)?.cancel();
    const animation = playMotion(el, arrivalKeyframes(rise), {
      duration: MOTION.base,
      delay: stagger(index),
      easing: EASE.out,
      fill: "backwards",
    });
    if (animation) arrivals.set(el, animation);
  });
}

/**
 * A number that moved up or down rolls: the new value comes in from the
 * side it moved toward (from below for more, from above for less)...
 */
export function tickKeyframes(
  direction: 1 | -1,
  distance: number = DISTANCE.sm,
): Keyframe[] {
  return [
    { opacity: 0, transform: `translateY(${direction * distance}px)` },
    { opacity: 1, transform: "none" },
  ];
}
/** ...while the old value leaves the other way. */
export function rollOutKeyframes(
  direction: 1 | -1,
  distance: number = DISTANCE.sm,
): Keyframe[] {
  return [
    { opacity: 1, transform: "none" },
    { opacity: 0, transform: `translateY(${-direction * distance}px)` },
  ];
}

/** Three 4 px shakes, for the first invalid field after a submit. */
export function shakeKeyframes(sign: 1 | -1 = 1): Keyframe[] {
  const x = (n: number) => ({ transform: `translateX(${n * sign}px)` });
  const d = DISTANCE.xs;
  return [x(0), x(d), x(-d), x(d), x(-d), x(d), x(-d), x(0)];
}

/**
 * A 10 ms haptic tick (Log set, Finish) where the device supports it and
 * motion is not reduced.
 */
export function haptic() {
  if (prefersReducedMotion()) return;
  try {
    navigator.vibrate?.(10);
  } catch {}
}

/**
 * Plays `keyframes` on `ref` whenever `value` changes after the first render
 * (the first render is the element arriving, not a change).
 */
export function useMotionOnChange<T>(
  ref: RefObject<Element | null>,
  value: T,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) {
  const previous = useRef(value);
  const frames = useRef(keyframes),
    timing = useRef(options);
  frames.current = keyframes;
  timing.current = options;
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    playMotion(ref.current, frames.current, timing.current);
  }, [ref, value]);
}

/** True when any part of `el` is inside the viewport now. */
export function inViewport(el: Element) {
  const r = el.getBoundingClientRect();
  return (
    r.bottom > 0 &&
    r.top < window.innerHeight &&
    r.right > 0 &&
    r.left < window.innerWidth
  );
}

/**
 * Calls `start` once, when `el` is first in view: at once if it already is
 * (so it starts before the first paint, with no flash of the end state),
 * otherwise when it scrolls in. Returns a cleanup.
 */
export function whenFirstInView(el: Element, start: () => void) {
  if (inViewport(el) || typeof IntersectionObserver !== "function") {
    start();
    return () => {};
  }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    observer.disconnect();
    start();
  });
  observer.observe(el);
  return () => observer.disconnect();
}

/** What each keyed meter showed last in this tab (0-1). */
const meterMemory = new Map<string, number>();

/** Keyframes for a fill growing from `from` to `to` of its track (0-1). */
export function meterKeyframes(from: number, to: number): Keyframe[] {
  const start = to > 0 ? Math.max(0, from / to) : 0;
  return [{ transform: `scaleX(${start})` }, { transform: "none" }];
}

/**
 * A bar's fill (already drawn at its value) grows from zero the first time
 * it is seen, and from the value it showed last when that changed (a meal
 * logged since). `key` remembers the last value in this tab. The fill
 * needs `transform-origin` at its inline start (the .motion-meter-fill
 * class in motion.css). With reduced motion the value shows directly.
 */
export function useMeterMotion(
  ref: RefObject<Element | null>,
  ratio: number,
  key?: string,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const value = Math.max(0, Math.min(1, ratio));
    const before = key ? meterMemory.get(key) : undefined;
    if (key) meterMemory.set(key, value);
    if (prefersReducedMotion() || value <= 0) return;
    if (before === undefined)
      return whenFirstInView(el, () =>
        playMotion(el, meterKeyframes(0, value), {
          duration: MOTION.progress,
          easing: EASE.out,
        }),
      );
    if (before !== value)
      playMotion(el, meterKeyframes(before, value), {
        duration: MOTION.progress,
        easing: EASE.out,
      });
  }, [ref, ratio, key]);
}

/**
 * An SVG ring's stroke (pathLength 1, stroke-dasharray 1) that fills from
 * `from` to `to` (0-1): stroke-dashoffset runs from 1 - from to 1 - to.
 */
export function ringKeyframes(from: number, to: number): Keyframe[] {
  return [
    { strokeDashoffset: String(1 - from) },
    { strokeDashoffset: String(1 - to) },
  ];
}

/** Ease-out for count-ups (matches --ease-out closely enough for numbers). */
function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Counts a number up in `el` from `from` to `to` over `duration` once,
 * writing `format(value)` each frame and the exact final text at the end.
 * With reduced motion the final value is written at once. Returns a cancel.
 */
export function countUp(
  el: HTMLElement,
  from: number,
  to: number,
  format: (value: number) => string,
  duration: number = MOTION.progress,
) {
  const final = format(to);
  // Write into the existing text node, so React keeps owning it.
  const write = (text: string) => {
    const node = el.firstChild;
    if (node && node.nodeType === 3 && !node.nextSibling) node.nodeValue = text;
    else el.textContent = text;
  };
  if (
    prefersReducedMotion() ||
    from === to ||
    typeof requestAnimationFrame !== "function"
  ) {
    write(final);
    return () => {};
  }
  let frame = 0;
  const started = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / duration);
    write(t >= 1 ? final : format(Math.round(from + (to - from) * easeOut(t))));
    if (t < 1) frame = requestAnimationFrame(step);
  };
  write(format(from));
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
    write(final);
  };
}

/**
 * Runs `update` (which must change the page synchronously, for example a
 * store the page reads) inside a View Transition when the browser has them
 * and motion is not reduced, so the whole page crossfades (opacity only,
 * app/motion.css "Theme"); otherwise it just runs. `kind` goes on
 * <html data-vt> so the stylesheet picks the right crossfade.
 */
export function withViewTransition(kind: string, update: () => void) {
  const doc = typeof document === "undefined" ? null : document;
  const start = (
    doc as (Document & { startViewTransition?: (cb: () => void) => unknown }) | null
  )?.startViewTransition;
  if (!doc || prefersReducedMotion() || typeof start !== "function") {
    update();
    return;
  }
  doc.documentElement.dataset.vt = kind;
  try {
    start.call(doc, () => flushSync(update));
  } catch {
    update();
  }
}

/**
 * True when the browser runs React's View Transitions (transition types and
 * view-transition-class, Chromium 125+, Safari 18.2+). Otherwise a new page
 * gets the plain fade-in fallback.
 */
export function supportsViewTransitions() {
  return (
    typeof document !== "undefined" &&
    typeof (document as { startViewTransition?: unknown }).startViewTransition ===
      "function" &&
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("view-transition-class", "none")
  );
}

/**
 * While mounted: the first field the browser finds invalid after a submit
 * shakes three times by 4 px (one per submit attempt), so the member sees
 * where to look. The browser's own message still explains why.
 */
export function useInvalidShake() {
  useEffect(() => {
    let pending = false;
    const onInvalid = (event: Event) => {
      if (pending) return;
      const field = event.target as Element | null;
      if (!field) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
      });
      playMotion(field, shakeKeyframes(inlineSign(field)), {
        duration: MOTION.slow,
        easing: EASE.inOut,
      });
    };
    document.addEventListener("invalid", onInvalid, true);
    return () => document.removeEventListener("invalid", onInvalid, true);
  }, []);
}

const NONE: ReadonlySet<string> = new Set();
/**
 * The keys of a list that arrived after it first loaded (a meal just
 * logged, a new message), for a moment, so they can slide in (the
 * .motion-arrive class). Nothing on the first load (`ready` false until
 * the list's data is there), nothing for items that were already shown.
 */
export function useArrivals(keys: string[], ready: boolean) {
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(NONE);
  const signature = keys.join("\n");
  useLayoutEffect(() => {
    if (!ready) return;
    if (!known.current) {
      known.current = new Set(keys);
      return;
    }
    const seen = known.current;
    const added = keys.filter((key) => !seen.has(key));
    for (const key of added) seen.add(key);
    if (!added.length) return;
    setFresh(new Set(added));
    const done = window.setTimeout(() => setFresh(NONE), MOTION.base + 100);
    return () => window.clearTimeout(done);
    // `signature` stands for `keys`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, ready]);
  return fresh;
}
