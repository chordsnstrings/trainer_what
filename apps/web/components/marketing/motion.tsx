"use client";
// The marketing site's motion helpers: the section reveal (one island in
// MarketingSite) and the calculators' settle. Everything else is CSS in
// app/marketing.css (the "Motion" block). No animation library: an
// IntersectionObserver marks units and the Web Animations API plays the
// settle. Every word stays in the server-rendered HTML; the reveal only hides
// a unit that is wholly below the first screen once this script runs, so the
// page reads the same without JavaScript. Reduced motion (the device setting
// or the member's own choice) stops both only while the marketing motion
// switch is "device" (motion-mode.ts); with "always" they run for every
// visitor.
import { useEffect, useRef, type RefObject } from "react";
import { MARKETING_MOTION } from "./motion-mode";

/**
 * The motion tokens in milliseconds and easings, the same values as the
 * --mk-* tokens in app/marketing.css (tests/marketing-motion-sitewide.test.ts keeps
 * them equal); the Web Animations API cannot read a CSS duration token.
 */
export const MOTION = {
  press: 80,
  fast: 140,
  base: 200,
  slow: 280,
  emphasis: 420,
  easeOut: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

const REDUCED = "(prefers-reduced-motion: reduce)";
/** The device setting, or the member's own "Reduce motion" choice
 * (<html data-reduce-motion="on">, app/layout.tsx), read only while the
 * marketing motion switch is "device" (motion-mode.ts); with "always" it is
 * never reduced. */
const reduced = () =>
  MARKETING_MOTION === "device" &&
  ((typeof matchMedia === "function" && matchMedia(REDUCED).matches) ||
    document.documentElement.dataset.reduceMotion === "on");

/**
 * The reveal units: each home band's content, each block of an inner page
 * (a section, the calculator, a grid, the FAQs, the related links) and the
 * closing panel. Never the hero, the breadcrumbs, the page heading or the
 * relay, and never the small "Last updated" line. Never the journey player
 * either (the /how-it-works steps section and the home band while a coach
 * can launch, components/marketing/journey.tsx): its stage has its own
 * one-off chapter motion, which a rise on top would double.
 */
const UNITS = [
  ".mk-home-band > .mk-home-inner",
  ".mk-page > :not(div:not([class]), .mk-breadcrumbs, .mk-page-head, .mk-updated)",
  ".mk-page > div:not([class]) > *",
  ".mk-closing",
].join(", ");
/** What never waits for a reveal: the first screen's showpieces and the journey. */
const NEVER = ".mk-hero, .mk-page-head, .mk-relay, .mk-walk-section, .mk-walk-band";
/** While scroll scenes are on (scene-mount.tsx), scroll moves their sections instead. */
const SCENES = "[data-scene]";
/** The longest item stagger in app/marketing.css (--mk-stagger: six
 * --mk-stagger-step or three --mk-stagger-load), in ms. */
export const MAX_STAGGER = 240;
/** Grids whose items follow their unit in a short stagger (app/marketing.css). */
const GRIDS =
  ".mk-cards, .mk-tiles, .mk-icon-tiles, .mk-steps, .mk-checklist, .mk-anchors, .mk-band-pills, .mk-screens, .mk-faqs";
/**
 * Widgets with a trigger of their own (data-mk-cue), as the concept gives
 * its barbell its own observer: their unit reveals when its top enters the
 * view, and on a phone these sit far below that line, so their motion
 * would be over before it could be seen. The commission pills and the FAQ
 * rows (grids: their items wait for the grid itself, not for the unit) and
 * the closing panel's button (its arrow nudges once when it comes into
 * view). An element that is itself a unit (the FAQs on an inner page)
 * keeps its unit's trigger, which is already its own.
 */
const CUES = ".mk-band-pills, .mk-faqs, .mk-closing-cta";

/**
 * The section reveal. Units whose top is below the first screen when the
 * page loads wait (data-mk-reveal="pending", unseen and 12px lower,
 * only while the page root has .mk-motion) and rise once when they enter
 * the view; the items of their grids carry data-mk-item and follow in a
 * stagger. A cue (CUES, data-mk-cue) is observed the same way but never
 * fades itself: it only holds its own grid's items, or its arrow's nudge,
 * until it enters the view. Nothing waits without IntersectionObserver, under reduced
 * motion in "device" mode (motion-mode.ts), when it holds the address's
 * #target or when it is taller than one and a half screens (it is revealed
 * by scrolling anyway, and fading it would restyle and repaint a large
 * area); printing shows everything. The marks sit on the elements that
 * move, so marking and revealing restyle only those elements.
 */
export function MarketingMotion({ path }: { path: string }) {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".mk");
    if (!root || typeof IntersectionObserver !== "function" || reduced())
      return;
    root.classList.add("mk-motion");
    const scenes = document.documentElement.classList.contains("scenes-on");
    const units = [...root.querySelectorAll<HTMLElement>(UNITS)].filter(
      (unit) => !unit.closest(NEVER) && !(scenes && unit.closest(SCENES)),
    );
    const unitSet = new Set<Element>(units);
    const cues = [...root.querySelectorAll<HTMLElement>(CUES)].filter(
      (cue) => !unitSet.has(cue) && !cue.closest(NEVER) && !(scenes && cue.closest(SCENES)),
    );
    const cueSet = new Set<Element>(cues);
    let target: Element | null = null;
    try {
      if (location.hash) target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    } catch {
      target = null;
    }
    const first = new WeakSet<Element>();
    const items = new Map<Element, HTMLElement[]>();
    // Once a grid's items have risen (the longest stagger plus the rise)
    // they are "done", so a link card's own hover timing applies again.
    const timers: number[] = [];
    const settleItems = (unit: HTMLElement) => {
      for (const item of items.get(unit) ?? [])
        if (item.dataset.mkItem === "in") item.dataset.mkItem = "done";
    };
    // A unit fades and rises; a cue only releases its items or its nudge.
    const mark = (unit: HTMLElement, state: "pending" | "in") => {
      if (cueSet.has(unit)) unit.dataset.mkCue = state;
      else unit.dataset.mkReveal = state;
      for (const item of items.get(unit) ?? []) item.dataset.mkItem = state;
      if (state === "in" && items.get(unit)?.length)
        timers.push(
          window.setTimeout(
            () => settleItems(unit),
            MOTION.slow + MAX_STAGGER + MOTION.fast,
          ),
        );
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const unit = entry.target as HTMLElement;
          if (!first.has(unit)) {
            // The first report says where the unit starts: only a unit
            // wholly below the first screen waits; the rest stay as they are.
            first.add(unit);
            const box = entry.boundingClientRect;
            const below = box.top >= window.innerHeight;
            const tall = box.height > window.innerHeight * 1.5;
            const holdsTarget = !!target && (unit.contains(target) || target.contains(unit));
            if (below && !tall && !holdsTarget) {
              // A grid that is a cue of its own keeps its items.
              const grids = [
                ...(unit.matches(GRIDS) ? [unit] : []),
                ...[...unit.querySelectorAll<HTMLElement>(GRIDS)].filter((grid) => !cueSet.has(grid)),
              ];
              items.set(
                unit,
                grids.flatMap((grid) => [...grid.children] as HTMLElement[]),
              );
              mark(unit, "pending");
            } else observer.unobserve(unit);
            continue;
          }
          if (entry.isIntersecting) {
            mark(unit, "in");
            observer.unobserve(unit);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    for (const unit of [...units, ...cues]) observer.observe(unit);
    const showAll = () => {
      observer.disconnect();
      for (const unit of units)
        if (unit.dataset.mkReveal === "pending") mark(unit, "in");
      for (const cue of cues) if (cue.dataset.mkCue === "pending") mark(cue, "in");
    };
    window.addEventListener("beforeprint", showAll);
    return () => {
      window.removeEventListener("beforeprint", showAll);
      showAll();
      for (const timer of timers) window.clearTimeout(timer);
      for (const unit of [...units, ...cues]) settleItems(unit);
    };
  }, [path]);
  return null;
}

/** What settles in a calculator result, and how. */
export type SettleTarget = {
  selector: string;
  duration: number;
  keyframes: Keyframe[];
};
const RISE: Keyframe[] = [
  { opacity: 0.55, translate: "0 4px" },
  { opacity: 1, translate: "0 0" },
];
/** A calculator's result: the figure, then the changed rows and cells. */
export const SETTLE_RESULT: SettleTarget[] = [
  { selector: ".mk-result-figure", duration: MOTION.base, keyframes: RISE },
  {
    selector: ".mk-funnel dd, .mk-bands td, .mk-headline li",
    duration: MOTION.fast,
    keyframes: RISE,
  },
];
/** The coaching address preview. */
export const SETTLE_ADDRESS: SettleTarget[] = [
  {
    selector: ".mk-address-preview span",
    duration: MOTION.fast,
    keyframes: [{ opacity: 0.5 }, { opacity: 1 }],
  },
];

/**
 * Settles the values that changed inside `ref` once input pauses for
 * `delay` ms: a short fade and a 4px rise, never a count-up (the result is
 * an aria-live region, its width must not jitter, and an estimate should
 * not look like a rolling total). Only on the marketing site, and under
 * reduced motion only in "device" mode (motion-mode.ts); the text itself
 * changes at once.
 */
export function useSettle(
  ref: RefObject<HTMLElement | null>,
  targets: SettleTarget[],
  delay: number,
) {
  const seen = useRef<WeakMap<Element, string> | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const read = () =>
      targets.flatMap((target) =>
        [...root.querySelectorAll(target.selector)].map(
          (el) => [el, target, el.textContent ?? ""] as const,
        ),
      );
    if (!seen.current) {
      // The first render only records the values.
      seen.current = new WeakMap(read().map(([el, , text]) => [el, text]));
      return;
    }
    const known = seen.current;
    const timer = window.setTimeout(() => {
      const play =
        !!root.closest(".mk") &&
        !reduced() &&
        typeof root.animate === "function";
      for (const [el, target, text] of read()) {
        const before = known.get(el);
        known.set(el, text);
        if (!play || before === undefined || before === text) continue;
        el.animate(target.keyframes, {
          duration: target.duration,
          easing: MOTION.easeOut,
        });
      }
    }, delay);
    return () => window.clearTimeout(timer);
  });
}
