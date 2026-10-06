"use client";
// The coach-to-subscriber journey's only client code: the control bar, the
// chapter clock and the root's data attributes. The stage (the mocks) and
// the step captions are server-rendered and arrive as slots, so they never
// enter the JavaScript bundle. Each slot sits in its own <Activity> (always
// visible): the server still sends it complete and in place, but the
// browser hydrates it after the controls, at low priority and in small,
// interruptible pieces instead of one long task; the wrappers are memoised,
// so this component's re-renders never reach them. React only; no
// animation library.
//
// Motion: the stage's beats are CSS keyframes (app/marketing-journey.css)
// that run while the root carries data-run, and pause (animation-play-state)
// while it carries data-hold. The chapter clock is a Web Animations API
// animation on the active progress segment (a target-less one under reduced
// motion, so nothing on screen moves); its finish advances the chapter.
// Every beat keeps `animation-fill-mode: both`, so the stage's animations
// stay reachable through getAnimations() and a chapter restarts by
// rewinding their current time, with no forced reflow. The CSS animations
// are never played or paused through the API: that would detach them from
// the style sheet, and a removed animation would keep running.
//
// Scroll scenes (home only, docs/features/scroll-scenes.md): while the band
// is pinned, components/marketing/journey-scene.ts sends "mk-scene" events
// ({active, q}: progress 0 to 1 through the pin) to the root. Then scroll is
// the clock: no auto-play and no clock advance; the chapter is floor(q * 8)
// and every stage animation and the clock are set to that point in time.
// The controls ask the scene to scroll there ("mk-scene:seek").
import {
  Activity,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

/** One chapter's clock, in milliseconds from its start. */
export type JourneyTiming = {
  /** The chapter's length: its beats, then its complete picture held. */
  ms: number;
  /** When the forward crossing (coach to subscriber) starts, or null. */
  go: number | null;
  /** When the dashed return crossing (subscriber to coach) starts, or null. */
  back: number | null;
  /** The side a phone-width stage shows first. */
  start: "coach" | "phone";
  /** When a phone-width stage swaps sides (each arrival). */
  swaps: number[];
};
type Mode = "idle" | "playing" | "paused" | "ended";

const REDUCE = "(prefers-reduced-motion: reduce)";
/** The device setting, or the member's own "Reduce motion" choice
 * (<html data-reduce-motion="on">, app/layout.tsx). */
const reducedNow = () =>
  typeof window !== "undefined" &&
  ((typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCE).matches) ||
    document.documentElement.dataset.reduceMotion === "on");
/** Each chapter holds its complete picture for its last 2.5 s (JOURNEY_TIMING). */
const HOLD_MS = 2500;
/** Scrubbing: the first 70% of a chapter's slice plays its beats; the rest holds. */
const SCRUB_BEATS = 0.7;

function Icon({
  name,
}: {
  name: "pause" | "play" | "replay" | "back" | "next";
}) {
  const common = {
    viewBox: "0 0 24 24",
    width: 18,
    height: 18,
    "aria-hidden": true,
    focusable: false,
  } as const;
  if (name === "pause")
    return (
      <svg {...common} key={name}>
        <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
      </svg>
    );
  if (name === "play")
    return (
      <svg {...common} key={name}>
        <path d="M8 5v14l11-7z" fill="currentColor" />
      </svg>
    );
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  if (name === "replay")
    return (
      <svg {...common} key={name}>
        <path
          {...stroke}
          d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
        />
        <path {...stroke} d="M3 3v5h5" />
      </svg>
    );
  // Previous and next point along the reading direction and mirror.
  return (
    <svg {...common} className="bidi-mirror">
      <path
        {...stroke}
        d={name === "back" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"}
      />
    </svg>
  );
}

export function JourneyPlayer({
  variant,
  groupLabel,
  titles,
  stepIds,
  timing,
  head,
  stage,
  captions,
  foot,
  subs,
  subLabel,
}: {
  variant: "full" | "compact";
  /** The id of the visible label that names the chapter buttons' group. */
  groupLabel: string;
  /** The eight step titles, in order. */
  titles: string[];
  /** Full: the id prefix of each step's number and heading (`p-n1`, `p-t1`). */
  stepIds?: string;
  timing: JourneyTiming[];
  head?: ReactNode;
  stage: ReactNode;
  captions?: ReactNode;
  foot?: ReactNode;
  /** Compact: each chapter's subscriber line, shown under its title. */
  subs?: string[];
  /** Compact: the label before the subscriber line (server-rendered). */
  subLabel?: ReactNode;
}) {
  // The server-rendered slots, hydrated late (see above); the same objects
  // on every render.
  const stageNode = useMemo(
    () => <Activity mode="visible">{stage}</Activity>,
    [stage],
  );
  const captionsNode = useMemo(
    () => captions && <Activity mode="visible">{captions}</Activity>,
    [captions],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [chapter, setChapter] = useState(0);
  const [mode, setMode] = useState<Mode>("idle");
  // Whether this chapter's beats play. The first automatic pass shows
  // chapter 1 complete (no blank flash at load); reduced motion never plays
  // them.
  const [run, setRun] = useState(false);
  const [runKey, setRunKey] = useState(0);
  // The visitor paused (Pause, keyboard focus, a touch on the step cards):
  // nothing moves until Play.
  const [hold, setHold] = useState(false);
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [hover, setHover] = useState(false);
  const [said, setSaid] = useState("");
  // Scroll drives the chapters (see above).
  const [scrub, setScrub] = useState(false);

  // Soft pauses resume by themselves; the visitor's pauses do not. Off
  // screen or in a hidden tab everything holds; a mouse over the player only
  // stops the chapter clock, so the chapter's beats finish and its complete
  // picture stays while the visitor looks at it.
  const away = !inView || !pageVisible;
  const clockOn = !scrub && mode === "playing" && !away && !hover;
  const frozen = scrub || hold || (mode === "playing" && away);

  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;
  const clockOnRef = useRef(clockOn);
  clockOnRef.current = clockOn;
  const clock = useRef<Animation | null>(null);
  const scrubRef = useRef(scrub);
  scrubRef.current = scrub;
  // The scene's latest progress through the pin.
  const scrubQ = useRef(0);
  // Whether a mouse entering the player counts as hovering: not after an
  // explicit Play or Replay until the pointer has left once (swapping the
  // button's icon under a resting pointer also reads as an entry).
  const hoverArmed = useRef(true);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const last = timing.length - 1;

  const rtl = () =>
    !!rootRef.current && getComputedStyle(rootRef.current).direction === "rtl";

  /**
   * Shows chapter `i` and plays its beats; a manual choice stops auto-play.
   * `announce`: say the step's name in the live region, for changes where
   * focus does not land on the chapter's own button (Previous, Next, a
   * swipe, a card); never during auto-play.
   */
  const show = (i: number, manual: boolean, announce = false) => {
    const next = Math.max(0, Math.min(last, i));
    if (scrubRef.current && manual) {
      // Scroll is the clock: go to where this chapter's picture is complete.
      seek((next + 0.75) / timing.length);
      if (announce)
        setSaid((prior) =>
          prior === titles[next] ? titles[next] + "\u00a0" : titles[next],
        );
      return;
    }
    setChapter(next);
    setRun(!reducedNow());
    setRunKey((k) => k + 1);
    setHold(false);
    if (manual) setMode("paused");
    if (announce)
      setSaid((prior) =>
        prior === titles[next] ? titles[next] + "\u00a0" : titles[next],
      );
  };
  const advance = () => {
    const c = chapterRef.current;
    if (c >= last) setMode("ended");
    else show(c + 1, false);
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  /** Asks the scroll scene to scroll the page to progress `q`. */
  const seek = (q: number) =>
    rootRef.current?.dispatchEvent(
      new CustomEvent("mk-scene:seek", {
        bubbles: true,
        detail: { q: Math.max(0, Math.min(1, q)) },
      }),
    );
  /** Sets the stage's animations and the clock to the scroll's point in time. */
  const scrubTo = () => {
    const n = timing.length;
    const q = scrubQ.current;
    const c = Math.min(last, Math.floor(q * n));
    if (c !== chapterRef.current) return; // the chapter's layout effect comes back here
    const p = Math.min(1, q * n - c);
    const ms = timing[c].ms;
    const t = p < SCRUB_BEATS ? (p / SCRUB_BEATS) * (ms - HOLD_MS) : ms;
    const view = viewRef.current;
    if (view && typeof view.getAnimations === "function")
      for (const a of view.getAnimations({ subtree: true }))
        if (typeof CSSAnimation === "function" && a instanceof CSSAnimation)
          a.currentTime = t;
    if (clock.current) clock.current.currentTime = p * ms;
  };

  useLayoutEffect(() => setReady(true), []);
  // The clock never outlives the player.
  useEffect(() => () => clock.current?.cancel(), []);

  // Each chapter start: rewind the stage's animations (the beats of a newly
  // shown scene start by themselves; the shared wire and frames restart
  // here) and start the chapter's clock.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view && run && typeof view.getAnimations === "function")
      for (const a of view.getAnimations({ subtree: true }))
        if (typeof CSSAnimation === "function" && a instanceof CSSAnimation)
          a.currentTime = 0;
    clock.current?.cancel();
    const duration = timing[chapter].ms;
    const fill = rootRef.current?.querySelector<HTMLElement>(
      `[data-seg="${chapter}"] i`,
    );
    let next: Animation | null = null;
    if (
      typeof Animation === "function" &&
      typeof KeyframeEffect === "function"
    ) {
      next =
        reduced || !fill
          ? new Animation(
              new KeyframeEffect(null, null, { duration }),
              document.timeline,
            )
          : fill.animate([{ scale: "0 1" }, { scale: "1 1" }], {
              duration,
              easing: "linear",
              fill: "forwards",
            });
      next.onfinish = () => {
        if (!scrubRef.current) advanceRef.current();
      };
      if (clockOnRef.current) next.play();
      else next.pause();
    }
    clock.current = next;
  }, [chapter, runKey, reduced]);
  // While scrolling drives the chapters, after the rewind above: the stage
  // and the clock show the scroll's point in time.
  useLayoutEffect(() => {
    if (scrub) scrubTo();
  }, [chapter, runKey, reduced, scrub, run]);

  // The scroll scene's progress (journey-scene.ts). Asks for the current
  // state once listening, in case the scene started first.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onScene = (e: Event) => {
      const { active, q } = (e as CustomEvent<{ active: boolean; q: number }>)
        .detail;
      scrubQ.current = q;
      if (!active) {
        if (scrubRef.current) {
          // Scenes switched off: hold the current picture until Play.
          scrubRef.current = false;
          setScrub(false);
          setMode((m) => (m === "ended" ? m : "paused"));
          setHold(true);
        }
        return;
      }
      if (!scrubRef.current) {
        scrubRef.current = true;
        setScrub(true);
        setRun(true);
        setHold(false);
      }
      setMode(q >= 0.999 ? "ended" : "paused");
      const c = Math.min(last, Math.floor(q * timing.length));
      if (c !== chapterRef.current) {
        chapterRef.current = c;
        setChapter(c);
        setRunKey((k) => k + 1);
      } else scrubTo();
    };
    root.addEventListener("mk-scene", onScene);
    root.dispatchEvent(new CustomEvent("mk-scene:hello", { bubbles: true }));
    return () => root.removeEventListener("mk-scene", onScene);
  }, []);

  useEffect(() => {
    const c = clock.current;
    if (!c) return;
    if (clockOn) {
      if (c.playState === "paused") c.play();
    } else if (c.playState === "running") c.pause();
  }, [clockOn, chapter, runKey]);

  // Reduced motion, read now and whenever the setting changes: no auto-play,
  // static complete chapters, instant changes.
  useEffect(() => {
    const query =
      typeof window.matchMedia === "function"
        ? window.matchMedia(REDUCE)
        : null;
    const apply = () => {
      const on = reducedNow();
      setReduced(on);
      if (on) {
        setRun(false);
        setMode((m) => (m === "playing" ? "paused" : m));
      }
    };
    apply();
    query?.addEventListener("change", apply);
    // The member's own choice can change too (data-reduce-motion on <html>).
    const observer =
      typeof MutationObserver === "function" ? new MutationObserver(apply) : null;
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-reduce-motion"],
    });
    return () => {
      query?.removeEventListener("change", apply);
      observer?.disconnect();
    };
  }, []);

  // Auto-play only while at least half of the stage is on screen.
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    if (typeof IntersectionObserver !== "function") {
      setInView(true);
      return;
    }
    // Several entries can arrive in one callback (a fast scroll, a busy
    // main thread); the latest one is the current state.
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        setInView(entry.isIntersecting && entry.intersectionRatio >= 0.49);
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const read = () => setPageVisible(document.visibilityState === "visible");
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);
  useEffect(() => {
    if (
      mode === "idle" &&
      !scrub &&
      ready &&
      inView &&
      pageVisible &&
      !reducedNow()
    )
      setMode("playing");
  }, [mode, scrub, ready, inView, pageVisible]);

  // The step cards are a scroll-snap carousel (on phones always; wider, once
  // this island is ready: four or two cards in view). A chapter change
  // scrolls it to the chapter's card (never the page); a scroll the visitor
  // started selects the card it settles on. Only while it scrolls is it a
  // keyboard stop (its arrows scroll it); otherwise it is plain content.
  const scroller = () =>
    rootRef.current?.querySelector<HTMLElement>(".mk-walk-steps") ?? null;
  const carousel = (el: HTMLElement | null): el is HTMLElement =>
    !!el && el.scrollWidth > el.clientWidth + 1;
  /** How far a card's start is from the carousel's snap line (px). */
  const offset = (sc: HTMLElement, card: HTMLElement) => {
    const r = card.getBoundingClientRect(),
      s = sc.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(sc).scrollPaddingInlineStart) || 0;
    return rtl() ? r.right - (s.right - pad) : r.left - (s.left + pad);
  };
  // Not on mount (the first card is already in place): reading the
  // layout there would force it in the middle of hydration.
  const cardsMounted = useRef(false);
  useEffect(() => {
    if (!cardsMounted.current) {
      cardsMounted.current = true;
      return;
    }
    const sc = scroller();
    if (!carousel(sc)) return;
    const card = sc.querySelector<HTMLElement>(`[data-step="${chapter + 1}"]`);
    if (!card) return;
    const delta = offset(sc, card);
    if (Math.abs(delta) >= 2)
      sc.scrollBy({
        left: delta,
        behavior: reducedNow() ? "instant" : "smooth",
      });
  }, [chapter, runKey]);
  useEffect(() => {
    const sc = scroller();
    if (!sc) return;
    let byVisitor = false,
      timer = 0;
    const began = () => {
      byVisitor = true;
    };
    const settled = () => {
      if (!byVisitor || !carousel(sc)) return;
      byVisitor = false;
      let best = -1,
        distance = Infinity;
      for (const card of sc.querySelectorAll<HTMLElement>("[data-step]")) {
        const d = Math.abs(offset(sc, card));
        if (d < distance) {
          distance = d;
          best = Number(card.dataset.step) - 1;
        }
      }
      if (best >= 0 && best !== chapterRef.current) show(best, true, true);
    };
    // Without scrollend, a pause in scrolling counts as its end.
    const scrollEnd = "onscrollend" in window;
    const scrolled = () => {
      if (scrollEnd) return;
      clearTimeout(timer);
      timer = setTimeout(settled, 150) as unknown as number;
    };
    const passive = { passive: true } as const;
    for (const type of ["pointerdown", "touchstart", "wheel", "keydown"])
      sc.addEventListener(type, began, passive);
    sc.addEventListener("scroll", scrolled, passive);
    sc.addEventListener("scrollend", settled);
    // Mounted once; it reads the current chapter through a ref.
    return () => {
      clearTimeout(timer);
      for (const type of ["pointerdown", "touchstart", "wheel", "keydown"])
        sc.removeEventListener(type, began);
      sc.removeEventListener("scroll", scrolled);
      sc.removeEventListener("scrollend", settled);
    };
  }, []);
  // Measured in a ResizeObserver callback (it runs after layout, so the
  // read never forces one; it also runs once when observing starts).
  useEffect(() => {
    const sc = scroller();
    if (!sc || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      if (sc.scrollWidth > sc.clientWidth + 1) sc.tabIndex = 0;
      else sc.removeAttribute("tabindex");
    });
    observer.observe(sc);
    return () => observer.disconnect();
  }, [ready]);

  const stop = () => {
    if (scrubRef.current) return;
    if (mode === "playing" || mode === "idle") {
      setMode("paused");
      setHold(true);
    }
  };
  const toggle = () => {
    // While scrolling drives the chapters, Play goes to the start of the
    // next chapter and Replay to the start of the walkthrough.
    if (scrubRef.current) {
      seek(mode === "ended" ? 0 : (chapter + 1.01) / timing.length);
      return;
    }
    if (mode === "playing") {
      setMode("paused");
      setHold(true);
      return;
    }
    // An explicit Play or Replay wins over the mouse resting on the player;
    // the hover pause comes back once the pointer has left and re-entered.
    hoverArmed.current = false;
    setHover(false);
    if (mode === "ended") show(0, false);
    else setHold(false);
    setMode("playing");
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const back = rtl() ? "ArrowRight" : "ArrowLeft",
      forward = rtl() ? "ArrowLeft" : "ArrowRight";
    let target: number | null = null;
    if (e.key === forward) target = chapter + 1;
    else if (e.key === back) target = chapter - 1;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = last;
    if (target === null) return;
    e.preventDefault();
    const t = Math.max(0, Math.min(last, target));
    show(t, true);
    e.currentTarget
      .querySelectorAll<HTMLButtonElement>("[data-seg]")
      [t]?.focus();
  };
  // Keyboard focus entering the player stops auto-play (it resumes only
  // through Play); a pointer's focus does not.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      typeof target.matches === "function" &&
      target.matches(":focus-visible")
    )
      stop();
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const card = (e.target as Element).closest?.<HTMLElement>("[data-step]");
    if (card && rootRef.current?.contains(card))
      show(Number(card.dataset.step) - 1, true, true);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Touching the step cards holds the one being read.
    if ((e.target as Element).closest?.(".mk-walk-steps")) stop();
  };
  const hovering = (on: boolean) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    if (!on) hoverArmed.current = true;
    setHover(on && hoverArmed.current);
  };
  const onSwipeEnd = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x,
      dy = e.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy))
      show(chapter + (dx < 0 !== rtl() ? 1 : -1), true, true);
  };

  const t = timing[chapter];
  const end =
    t.swaps.length % 2 ? (t.start === "coach" ? "phone" : "coach") : t.start;
  const style = {
    "--w-go": (t.go ?? 0) + "ms",
    "--w-back": (t.back ?? 0) + "ms",
    "--w-sw1": (t.swaps[0] ?? 0) + "ms",
    "--w-sw2": (t.swaps[1] ?? 0) + "ms",
  } as CSSProperties;
  const flag = (on: boolean) => (on ? "" : undefined);
  const label =
    mode === "playing" ? "Pause" : mode === "ended" ? "Replay" : "Play";
  return (
    <div
      ref={rootRef}
      className={"mk-walk mk-walk-" + variant}
      data-chapter={chapter + 1}
      data-state={mode}
      data-run={flag(run)}
      data-hold={flag(frozen)}
      data-ready={flag(ready)}
      data-start={t.start}
      data-end={end}
      data-go={flag(t.go !== null)}
      data-back={flag(t.back !== null)}
      data-sw2={flag(t.swaps.length > 1)}
      data-scrub={flag(scrub)}
      style={style}
      onFocus={onFocus}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerEnter={hovering(true)}
      onPointerLeave={hovering(false)}
    >
      {head}
      <div
        ref={viewRef}
        className="mk-walk-view"
        onPointerDown={(e) => {
          swipe.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={onSwipeEnd}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        {stageNode}
      </div>
      {variant === "compact" && (
        <div className="mk-walk-cap">
          <p className="mk-walk-caption">{titles[chapter]}</p>
          {subs?.[chapter] && (
            <p className="mk-walk-then">
              {subLabel} <span>{subs[chapter]}</span>
            </p>
          )}
        </div>
      )}
      <div className="mk-walk-bar">
        <button
          type="button"
          className="mk-walk-btn mk-walk-play"
          aria-label={label}
          onClick={toggle}
        >
          <Icon
            name={
              mode === "playing"
                ? "pause"
                : mode === "ended"
                  ? "replay"
                  : "play"
            }
          />
        </button>
        {/* At either end the arrow stays focusable (aria-disabled, not
            disabled), so keyboard focus is never dropped to the page. */}
        {variant === "full" && (
          <button
            type="button"
            className="mk-walk-btn"
            aria-label="Previous step"
            aria-disabled={chapter === 0 ? true : undefined}
            onClick={() => chapter > 0 && show(chapter - 1, true, true)}
          >
            <Icon name="back" />
          </button>
        )}
        <div
          className="mk-walk-segs"
          role="group"
          aria-labelledby={groupLabel}
          onKeyDown={onKey}
        >
          {titles.map((title, i) => (
            <button
              key={i}
              type="button"
              className="mk-walk-seg"
              data-seg={i}
              tabIndex={i === chapter ? 0 : -1}
              aria-current={i === chapter ? "step" : undefined}
              data-done={flag(mode === "ended" || i < chapter)}
              {...(stepIds
                ? {
                    "aria-labelledby": `${stepIds}-n${i + 1} ${stepIds}-t${i + 1}`,
                  }
                : { "aria-label": title })}
              onClick={() => show(i, true)}
            >
              <span>
                <i />
              </span>
            </button>
          ))}
        </div>
        {variant === "full" && (
          <button
            type="button"
            className="mk-walk-btn"
            aria-label="Next step"
            aria-disabled={chapter === last ? true : undefined}
            onClick={() => chapter < last && show(chapter + 1, true, true)}
          >
            <Icon name="next" />
          </button>
        )}
      </div>
      {captionsNode}
      {foot}
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
