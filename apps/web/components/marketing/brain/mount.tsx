"use client";
// The island that runs a Brain showcase's engine
// (docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.2). Renders nothing.
// The server frame stays in its host (showcase.tsx) until the engine takes
// it over: after the page's load event, on idle, once the root is within
// 200 px of the viewport, through one literal import() per runtime module
// (each its own chunk, with its own CSS; nothing else here reaches the
// engine). Keyboard users get it sooner: the page's first Tab mounts every
// showcase, and focus inside a host mounts it, so a Tab never meets a
// control still waiting, disabled, for its engine. Crawlers and automated
// browsers keep the still frame unless the URL carried ?sc=on. A root the
// engine has not started 6 s after it first came near ends at
// data-sc="off", for good: the still frame, never a flash. Unmounting
// destroys the engine and puts the server's frame back.
import { useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type {
  ShowcaseApi,
  ShowcaseKind,
  ShowcaseOptions,
} from "./engine/types";

/** The runtime modules, by kind: the only way into the engine. */
const LOADERS = {
  field: () => import("./engine/field.js"),
  board: () => import("./engine/field.js"),
  play: () => import("./engine/play.js"),
  anatomy: () => import("./engine/anatomy.js"),
};
const FALLBACK_MS = 6000;

// The head script's test (head.ts), repeated for a client-side navigation and
// for settings changed since the page loaded; a test keeps the two equal.
// Neither reads the marketing motion switch: showcases follow both
// reduced-motion settings.
const REDUCE = "(prefers-reduced-motion: reduce)";
const reduced = () =>
  (typeof matchMedia === "function" && matchMedia(REDUCE).matches) ||
  document.documentElement.dataset.reduceMotion === "on";
/** ?sc=on, kept for the tab: automated browsers get the engine too. */
function forced() {
  const on = /[?&]sc=on(&|$)/.test(location.search);
  try {
    if (on) sessionStorage.setItem("sc-on", "1");
    return on || sessionStorage.getItem("sc-on") === "1";
  } catch {
    return on;
  }
}
const robot = () =>
  navigator.webdriver ||
  /bot[/)-]|bot [0-9]|crawl|spider|slurp|preview|lighthouse/i.test(navigator.userAgent);

/** Whether the engine may load here: not for robots, unless ?sc=on. */
export function engineWanted() {
  return forced() || !robot();
}
/** html.sc-motion and html.sc-pin, exactly as the head script decides them. */
export function showcaseClasses() {
  const motion = !reduced() && engineWanted();
  const pin =
    motion &&
    typeof IntersectionObserver === "function" &&
    typeof CSS !== "undefined" &&
    CSS.supports("position", "sticky");
  return { motion, pin };
}
function applyClasses() {
  const { motion, pin } = showcaseClasses();
  document.documentElement.classList.toggle("sc-motion", motion);
  document.documentElement.classList.toggle("sc-pin", pin);
}

/** fn once el is within 200 px of the viewport. Returns the cancel. */
function near(el: Element, fn: () => void) {
  if (typeof IntersectionObserver !== "function") {
    fn();
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        fn();
      }
    },
    { rootMargin: "200px" },
  );
  io.observe(el);
  return () => io.disconnect();
}
/** fn once el is entirely below the viewport. Returns the cancel. */
function whenBelow(el: Element, fn: () => void) {
  if (typeof IntersectionObserver !== "function") {
    fn();
    return () => {};
  }
  const io = new IntersectionObserver((entries) => {
    const e = entries[entries.length - 1];
    if (!e.isIntersecting && e.boundingClientRect.top >= (e.rootBounds?.height ?? innerHeight)) {
      io.disconnect();
      fn();
    }
  });
  io.observe(el);
  return () => io.disconnect();
}
/** The load event, then idle, then near: fn. Returns the cancel. */
function schedule(host: Element, fn: () => void) {
  let cancel = () => {};
  const idle = () => {
    const go = () => (cancel = near(host, fn));
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(go, { timeout: 1500 });
      cancel = () => cancelIdleCallback(handle);
    } else {
      const timer = window.setTimeout(go, 300);
      cancel = () => clearTimeout(timer);
    }
  };
  if (document.readyState === "complete") idle();
  else {
    addEventListener("load", idle, { once: true });
    cancel = () => removeEventListener("load", idle);
  }
  return () => cancel();
}
// Hosts whose showcase ended at the still frame: final until the island
// unmounts, so an engine that arrives later is never mounted.
const ENDED = new WeakSet<Element>();
/**
 * The still frame, for good. The anatomy also stops pinning, but only once
 * it is entirely below the viewport, so the collapse never moves what the
 * visitor sees; until then its pinned frame shows the complete figure.
 * Returns the cancel of that wait.
 */
function end(host: Element, kind: ShowcaseKind) {
  ENDED.add(host);
  const root = host.firstElementChild;
  if (!root) return () => {};
  root.setAttribute("data-sc", "off");
  return kind === "anatomy"
    ? whenBelow(root, () => root.setAttribute("data-sc-flat", ""))
    : () => {};
}
/** The 6 s fallback, from the first time the host comes near. Returns the cancel. */
function fallback(host: Element, kind: ShowcaseKind) {
  let timer = 0,
    flat = () => {};
  const cancel = near(host, () => {
    timer = window.setTimeout(() => {
      if (host.firstElementChild?.getAttribute("data-sc") === "pre") flat = end(host, kind);
    }, FALLBACK_MS);
  });
  return () => {
    cancel();
    clearTimeout(timer);
    flat();
  };
}
/** What can hold focus in a host, in order (its controls once the engine has armed them). */
const focusables = (host: Element) =>
  [...host.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary, [tabindex]")].filter(
    (e) => !(e as HTMLButtonElement).disabled && e.tabIndex >= 0 && e.checkVisibility?.() !== false,
  );
/** A plain left click: no modifier key, not already handled. */
const plainClick = (e: MouseEvent) =>
  !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
const target = (e: Event, selector: string) =>
  e.target instanceof Element ? e.target.closest<HTMLAnchorElement>(selector) : null;

/** The app router, or null where none is mounted (the unit tests' server renders). */
function useAppRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

// The server's frame of each host, taken once, so a second mount (Strict
// Mode) and a remount restore the original.
const SNAPSHOTS = new WeakMap<Element, string>();

export function ShowcaseMount({
  id,
  kind,
  options,
}: {
  /** The host's id (showcase.tsx). */
  id: string;
  kind: ShowcaseKind;
  options: ShowcaseOptions;
}) {
  const router = useAppRouter();
  // The latest options and router, without remounting the engine: equal HTML
  // means equal options, and a changed payload remounts the island (its key).
  const latest = useRef({ options, router });
  useLayoutEffect(() => {
    latest.current = { options, router };
  });

  // Before the first paint, a client-side navigation included: the head
  // script's classes, and the fallback clock.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-sc-ready", "");
    applyClasses();
    const host = document.getElementById(id);
    if (!host || !engineWanted()) return;
    return fallback(host, kind);
  }, [id, kind]);

  useEffect(() => {
    const host = document.getElementById(id);
    if (!host) return;
    if (!SNAPSHOTS.has(host)) SNAPSHOTS.set(host, host.innerHTML);
    const snapshot = SNAPSHOTS.get(host)!;
    if (!engineWanted()) return;
    let alive = true,
      api: ShowcaseApi | null = null,
      loading: Promise<ShowcaseApi | null> | null = null,
      rearmed = () => {},
      flat = () => {};
    const navigate = (href: string) => {
      const { router } = latest.current;
      if (router) router.push(href);
      else location.assign(href);
    };
    // A mark where the import starts: the browser check times the mount's
    // long tasks from it (scripts/marketing-showcase-check.mjs).
    const load = () => {
      performance.mark(`sc-mount:${id}`);
      return LOADERS[kind]();
    };
    const mount = () =>
      (loading ??= load()
        .then(async (module) => {
          const root = host.firstElementChild;
          if (!alive || ENDED.has(host) || !(root instanceof HTMLElement)) return null;
          const settled = document.documentElement.classList.contains("sc-late");
          const next = await module.mount(root, { ...latest.current.options, kind, id, settled, navigate });
          if (alive && !ENDED.has(host)) return (api = next);
          // Unmounted, or the fallback ended it while the engine was
          // mounting: the server's still frame, for good.
          next.destroy();
          if (alive) {
            host.innerHTML = snapshot;
            flat = end(host, kind);
          }
          return null;
        })
        .catch(() => {
          // The engine failed to load or to mount: the server's still frame.
          if (alive) {
            host.innerHTML = snapshot;
            flat = end(host, kind);
          }
          return null;
        }));
    const cancelSchedule = schedule(host, () => void mount());
    // Keyboard users: the page's first Tab mounts every showcase (each island
    // hears it), focus inside the host mounts it at once (A11Y-2).
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      document.removeEventListener("keydown", onTab, true);
      void mount();
    };
    const onFocus = () => void mount();
    document.addEventListener("keydown", onTab, true);
    host.addEventListener("focusin", onFocus);

    // Either reduced-motion setting changed: the classes again, and a running
    // engine starts over from the server's frame. Focus inside it goes back
    // to the same control once it is armed again, or to its root (A11Y-12).
    const changed = () => {
      applyClasses();
      if (!api) return;
      const was = document.activeElement;
      const at = was instanceof HTMLElement && host.contains(was) ? { cls: was.classList[0], t: was.dataset.t, i: focusables(host).indexOf(was) } : null;
      api.destroy();
      api = null;
      loading = null;
      host.innerHTML = snapshot;
      rearmed();
      rearmed = fallback(host, kind);
      void mount().then(() => {
        if (!at || !alive || (document.activeElement && document.activeElement !== document.body)) return;
        const all = focusables(host);
        const to = (at.t && all.find((e) => e.dataset.t === at.t && e.classList.contains(at.cls))) || all[at.i] || (host.firstElementChild as HTMLElement | null);
        if (to && !to.matches("a[href], button, input, select, textarea, summary, [tabindex]")) to.tabIndex = -1;
        to?.focus({ preventScroll: true });
      });
    };
    const query = typeof matchMedia === "function" ? matchMedia(REDUCE) : null;
    query?.addEventListener("change", changed);
    const observer = new MutationObserver(changed);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-reduce-motion"],
    });

    // The engine's calls to action (a[data-sc-cta], in a root or in the
    // overlay layer) go through the router on a plain left click.
    const cta = (e: MouseEvent) => {
      const a = target(e, "a[data-sc-cta]");
      if (!a || !plainClick(e) || a.target || !a.closest("[data-showcase]")) return;
      const url = new URL(a.href);
      if (url.origin !== location.origin) return;
      e.preventDefault();
      navigate(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", cta);

    // The playground runs a moment on request (an sc:run event on the host,
    // or a link with data-run elsewhere on the page), mounting at once.
    const run = (trace: string) => void mount().then((engine) => engine?.run?.(trace));
    const onRun = (e: Event) => {
      const trace = (e as CustomEvent<{ trace?: string }>).detail?.trace;
      if (trace) run(trace);
    };
    const onRunLink = (e: MouseEvent) => {
      const a = target(e, "a[data-run]");
      if (!a || !plainClick(e)) return;
      const to = a.hash ? document.getElementById(a.hash.slice(1)) : null;
      if (to && !host.contains(to) && !to.contains(host)) return;
      run(a.dataset.run!);
    };
    if (kind === "play") {
      host.addEventListener("sc:run", onRun);
      document.addEventListener("click", onRunLink);
    }

    return () => {
      alive = false;
      cancelSchedule();
      document.removeEventListener("keydown", onTab, true);
      host.removeEventListener("focusin", onFocus);
      rearmed();
      flat();
      query?.removeEventListener("change", changed);
      observer.disconnect();
      document.removeEventListener("click", cta);
      host.removeEventListener("sc:run", onRun);
      document.removeEventListener("click", onRunLink);
      api?.destroy();
      api = null;
      host.innerHTML = snapshot;
      ENDED.delete(host);
    };
  }, [id, kind]);
  return null;
}
