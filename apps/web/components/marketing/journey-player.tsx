"use client";
// The coach-to-subscriber journey's only client code: the control bar, the
// chapter clock and the root's data attributes. The stage (the mocks) and
// the step captions are server-rendered and arrive as slots, so they never
// enter the JavaScript bundle. React only; no animation library.
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
import {
  useEffect,
  useLayoutEffect,
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
const reducedNow = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(REDUCE).matches;

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
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [chapter, setChapter] = useState(0);
  const [mode, setMode] = useState<Mode>("idle");
  // Whether this chapter's beats play. The first automatic pass shows
  // chapter 1 complete (no blank flash at load); reduced motion never plays
  // them.
  const [run, setRun] = useState(false);
  const [runKey, setRunKey] = useState(0);
  // The visitor paused: nothing moves until Play.
  const [hold, setHold] = useState(false);
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [hover, setHover] = useState(false);
  const [said, setSaid] = useState("");

  // Soft pauses resume by themselves; the visitor's pauses do not.
  const soft = !inView || !pageVisible || hover;
  const clockOn = mode === "playing" && !soft;
  const frozen = hold || (mode === "playing" && soft);

  const chapterRef = useRef(chapter);
  chapterRef.current = chapter;
  const clockOnRef = useRef(clockOn);
  clockOnRef.current = clockOn;
  const clock = useRef<Animation | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const last = timing.length - 1;

  const rtl = () =>
    !!rootRef.current && getComputedStyle(rootRef.current).direction === "rtl";

  /** Shows chapter `i` and plays its beats; a manual choice stops auto-play. */
  const show = (i: number, manual: boolean) => {
    const next = Math.max(0, Math.min(last, i));
    setChapter(next);
    setRun(!reducedNow());
    setRunKey((k) => k + 1);
    setHold(false);
    if (manual) {
      setMode("paused");
      // Announced only after manual navigation, never during auto-play.
      setSaid((prior) =>
        prior === titles[next] ? titles[next] + "\u00a0" : titles[next],
      );
    }
  };
  const advance = () => {
    const c = chapterRef.current;
    if (c >= last) setMode("ended");
    else show(c + 1, false);
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

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
      next.onfinish = () => advanceRef.current();
      if (clockOnRef.current) next.play();
      else next.pause();
    }
    clock.current = next;
  }, [chapter, runKey, reduced]);

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
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCE);
    const apply = () => {
      setReduced(query.matches);
      if (query.matches) {
        setRun(false);
        setMode((m) => (m === "playing" ? "paused" : m));
      }
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // Auto-play only while at least half of the stage is on screen.
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    if (typeof IntersectionObserver !== "function") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) =>
        setInView(entry.isIntersecting && entry.intersectionRatio >= 0.49),
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
    if (mode === "idle" && ready && inView && pageVisible && !reducedNow())
      setMode("playing");
  }, [mode, ready, inView, pageVisible]);

  // Phones: the step cards are a scroll-snap carousel. A chapter change
  // scrolls it to the chapter's card (never the page); a scroll the visitor
  // started selects the card it settles on.
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
  useEffect(() => {
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
      if (best >= 0 && best !== chapterRef.current) show(best, true);
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

  const stop = () => {
    if (mode === "playing" || mode === "idle") {
      setMode("paused");
      setHold(true);
    }
  };
  const toggle = () => {
    if (mode === "playing") {
      setMode("paused");
      setHold(true);
    } else if (mode === "ended") {
      show(0, false);
      setMode("playing");
    } else {
      setHold(false);
      setMode("playing");
    }
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
      show(Number(card.dataset.step) - 1, true);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Touching the step cards holds the one being read.
    if ((e.target as Element).closest?.(".mk-walk-steps")) stop();
  };
  const hovering = (on: boolean) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") setHover(on);
  };
  const onSwipeEnd = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x,
      dy = e.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy))
      show(chapter + (dx < 0 !== rtl() ? 1 : -1), true);
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
        {stage}
      </div>
      {variant === "compact" && (
        <p className="mk-walk-caption">{titles[chapter]}</p>
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
        {variant === "full" && (
          <button
            type="button"
            className="mk-walk-btn"
            aria-label="Previous step"
            disabled={chapter === 0}
            onClick={() => show(chapter - 1, true)}
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
            disabled={chapter === last}
            onClick={() => show(chapter + 1, true)}
          >
            <Icon name="next" />
          </button>
        )}
      </div>
      {captions}
      {foot}
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
