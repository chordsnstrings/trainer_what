"use client";
/**
 * Microanimations for subscriber surfaces (docs/features/phone-first.md,
 * "Motion"). Small, quick and purposeful: a press answers a tap, a new page
 * or panel settles in, a logged set confirms itself, a value ticks in the
 * direction it moved. Nothing loops except progress, nothing delays input,
 * and everything is skipped when the device asks for reduced motion.
 *
 * CSS carries most of it (app/phone-first.css, the tokens below mirror its
 * --motion-* custom properties); these helpers play the few that need to
 * know what changed (Web Animations API), without remounting anything.
 */
import { useEffect, useRef, type RefObject } from "react";

/** Durations in milliseconds (the CSS tokens use the same values). */
export const MOTION = {
  /** Answering a press. */
  press: 90,
  /** Colour and small state changes; a value ticking. */
  fast: 140,
  /** Things arriving: a page, a panel, a sheet's backdrop. */
  enter: 240,
  /** A sheet or bar sliding in from the bottom edge. */
  slide: 280,
  /** Leaving is quicker than arriving. */
  exit: 180,
  /** Delay between siblings that arrive together (capped, see stagger). */
  stagger: 28,
} as const;

/** Easing curves (the CSS tokens use the same values). */
export const EASE = {
  /** Arrivals: fast start, soft landing. */
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  /** Departures: gentle start, quick finish. */
  in: "cubic-bezier(0.55, 0, 1, 0.45)",
  /** A small overshoot for confirmations (a check, a badge). */
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

/** True when the device asks for reduced motion (or cannot say). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

/** The delay for the nth sibling arriving together; capped so the last never waits long. */
export function stagger(index: number, step: number = MOTION.stagger, cap = 5) {
  return Math.min(Math.max(0, index), cap) * step;
}

/** Keyframes for a block arriving: a fade and a small rise. */
export function arrivalKeyframes(rise = 8): Keyframe[] {
  return [
    { opacity: 0, transform: `translateY(${rise}px)` },
    { opacity: 1, transform: "none" },
  ];
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
 * its own entrance), so nothing fixed ever sits inside a moving box.
 */
export function arrivalTargets(container: Element, depth = 0): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(container.children)) {
    if (el.matches(SKIP)) continue;
    if (el.querySelector(FIXED_UI)) {
      if (depth < 3) out.push(...arrivalTargets(el, depth + 1));
      continue;
    }
    out.push(el);
  }
  return out;
}

/** The arrival playing on each block, so a new one can replace it. */
const arrivals = new WeakMap<Element, Animation>();

/**
 * Lets the blocks of a container settle in, one after another: a new page,
 * a newly selected tab panel. Opacity and a small rise only; the first five
 * are staggered, the rest arrive with the fifth.
 */
export function playArrival(container: Element | null | undefined, rise = 8) {
  if (!container || prefersReducedMotion()) return;
  arrivalTargets(container).forEach((el, index) => {
    // A second arrival (a quick second tap) replaces the first.
    arrivals.get(el)?.cancel();
    const animation = playMotion(el, arrivalKeyframes(rise), {
      duration: MOTION.enter,
      delay: stagger(index),
      easing: EASE.out,
      fill: "backwards",
    });
    if (animation) arrivals.set(el, animation);
  });
}

/**
 * A value that moved up or down: the new value slides in from the side it
 * came from (up for more, down for less) and fades up to full strength.
 */
export function tickKeyframes(direction: 1 | -1, distance = 6): Keyframe[] {
  return [
    { opacity: 0.35, transform: `translateY(${direction * distance}px)` },
    { opacity: 1, transform: "none" },
  ];
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
