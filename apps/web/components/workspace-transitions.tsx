"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { flushWorkspaceEdits, workspaceHasEdits } from "./workspace-continuity";
import { prefersReducedMotion } from "./motion";
import { directionBetween, rankPlaces, type Place } from "./workspace-places";

/**
 * Page-to-page motion in the backend workspace (docs/features/motion.md,
 * "Trainer workspace"). The address changes at once, never after an
 * animation. The page being left dims, a thin bar at the top shows the next
 * one coming, and the new page arrives from where it sits in the menu:
 * further down rises from below, further up drops from above. The workspace
 * mounts again for each address, so what carries over between pages lives
 * here, outside React state. Under reduced motion nothing moves.
 */

type Direction = "forward" | "back" | "none";
/** Each move between pages has an id: only the page a move opened ends it. */
let legs = 0;
let leg: { id: number; to: string; direction: Direction; focus: boolean } | null = null;
let bar: { state: "idle" | "running" | "done"; at: number } = { state: "idle", at: 0 };
const listeners = new Set<() => void>();
let doneTimer = 0,
  staleTimer = 0,
  listening = false;

function setBar(state: (typeof bar)["state"], at = bar.at) {
  bar = { state, at };
  for (const listener of listeners) listener();
}
const content = () => document.getElementById("workspace-content");

/** The move is over (arrived, abandoned or timed out): the dim goes and the bar completes. */
function endLeg() {
  leg = null;
  window.clearTimeout(staleTimer);
  content()?.classList.remove("is-leaving");
  if (bar.state !== "running") return;
  setBar("done");
  doneTimer = window.setTimeout(() => setBar("idle"), 420);
}

/** The menu's links, top to bottom, as drawn for this person. */
function menuHrefs(): string[] {
  return [...document.querySelectorAll<HTMLAnchorElement>(".workspace.platform-ui .sidebar nav a[href]")].map(
    (a) => new URL(a.href, location.href).pathname,
  );
}

/** A workspace address is about to open. `focus`: move keyboard focus to
 * the new page when it arrives (Jump to). */
export function startLeg(to: string, focus = false) {
  const from = location.pathname;
  if (to === from) return;
  leg = { id: ++legs, to, direction: directionBetween(menuHrefs(), from, to), focus };
  window.clearTimeout(doneTimer);
  window.clearTimeout(staleTimer);
  setBar("running", Date.now());
  if (!prefersReducedMotion()) content()?.classList.add("is-leaving");
  // A page that never comes (an error screen, a blocked move) still ends it.
  staleTimer = window.setTimeout(endLeg, 10_000);
}

/**
 * Bubble phase on document, added after React's own listener there: every
 * onClick has run. next/link prevents the browser's navigation when it moves
 * client-side, so a prevented click on a workspace link is a page change;
 * an unprevented one reloads the page (nothing to carry over). Links that
 * take over the click themselves opt out with data-route-leg="off".
 */
function onClick(event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || !anchor.closest(".workspace.platform-ui") || anchor.closest('[data-route-leg="off"], .sbe, .sb-site')) return;
  if (!event.defaultPrevented || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || !/^\/(trainer|admin|setup)(\/|$)/.test(url.pathname)) return;
  // Back to the page on screen: a move still in flight is abandoned.
  if (url.pathname === location.pathname) {
    if (leg) endLeg();
    return;
  }
  // Unsaved changes are saved first, with their own notice (workspace-continuity.tsx).
  if (workspaceHasEdits()) return;
  startLeg(url.pathname);
}

/** The click listener lives as long as the document: there is one, and the
 * workspace mounts again on every page. */
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!listening) {
    listening = true;
    document.addEventListener("click", onClick);
  }
  return () => {
    listeners.delete(listener);
  };
}
const snapshot = () => bar;

/** The bar at the top while the next page loads. Decorative: the page
 * itself says "Loading…" to assistive technology. */
export function RouteBar() {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return state.state === "idle" ? null : <RouteBarLine key={state.at} state={state.state} at={state.at} />;
}
/** One move's bar. The workspace mounts again on the new address; the bar
 * carries on from where it was (measured once, so a re-render never moves it). */
function RouteBarLine({ state, at }: { state: "running" | "done"; at: number }) {
  const [elapsed] = useState(() => Math.min(Date.now() - at, 3000));
  return (
    <div className="route-bar" data-state={state} aria-hidden="true" style={{ "--route-elapsed": `${-elapsed}ms` } as CSSProperties}>
      <span />
    </div>
  );
}

/**
 * How the page on screen arrived, for a moment once it is ready (`null`
 * afterwards and under reduced motion). Ends the move that opened it.
 */
export function useRouteArrival(path: string, ready: boolean): Direction | null {
  // The newest move when this page mounted (or its address changed) brought
  // it here; a move started from this page has a higher id and belongs to
  // the next page.
  const [opened, setOpened] = useState(() => ({ path, by: legs }));
  if (opened.path !== path) setOpened({ path, by: legs });
  const openedBy = opened.path === path ? opened.by : legs;
  const [arrival, setArrival] = useState<{ path: string; direction: Direction | null } | null>(null);
  // Decided while rendering, so the page's first frame already moves the
  // right way (an effect would start it one frame late, from the wrong side).
  if (ready && arrival?.path !== path) {
    const came = leg && leg.id === openedBy && leg.to === path ? leg.direction : "none";
    setArrival({ path, direction: prefersReducedMotion() ? null : came });
  }
  useEffect(() => {
    content()?.classList.remove("is-leaving");
  }, [path]);
  // Once per page: end the move that brought it, never a newer one.
  useEffect(() => {
    if (!ready || legs !== openedBy) return;
    const focus = leg?.focus && leg.to === path;
    endLeg();
    if (focus) content()?.focus({ preventScroll: true });
  }, [ready, path, openedBy]);
  useEffect(() => {
    if (!arrival?.direction) return;
    const timer = window.setTimeout(() => setArrival({ path: arrival.path, direction: null }), 640);
    return () => window.clearTimeout(timer);
  }, [arrival]);
  return ready && arrival?.path === path ? arrival.direction : null;
}

/** The places in this person's menu, with the group each sits in. */
function menuPlaces(): Place[] {
  return [...document.querySelectorAll<HTMLAnchorElement>(".workspace.platform-ui .sidebar nav a[href]")].map((a) => {
    const group = a.closest("details")?.querySelector("summary .nav-label")?.textContent?.trim() ?? "";
    const label = (a.querySelector(".nav-label")?.textContent ?? a.textContent ?? "").trim();
    return { label, href: a.getAttribute("href") ?? "/trainer", group };
  });
}

const isMacLike = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * "Jump to": Cmd + K on a Mac (Control + K deletes to the end of the line
 * there), Ctrl + K elsewhere, or the button in the top bar, opens a short
 * list of every place in this person's menu. Type to filter, arrows to move,
 * Enter to go. Unsaved changes are saved before it leaves.
 */
export function JumpMenu() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pressedBackdrop = useRef(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(false);
  const id = useId();
  useEffect(() => setMac(isMacLike()), []);
  const shown = rankPlaces(places, query).slice(0, 12);
  const current = shown[active];
  // Stable while the menu is open: rankPlaces returns the same objects.
  const optionId = (place: Place) => `${id}-o${places.indexOf(place)}`;
  const open = () => {
    const d = dialog.current;
    if (!d || d.open) return;
    setPlaces(menuPlaces());
    setQuery("");
    setActive(0);
    d.showModal();
    input.current?.focus();
  };
  useEffect(() => {
    const macLike = isMacLike();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return;
      if (macLike ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return;
      const k = (event.key ?? "").toLowerCase();
      // Arabic, Hebrew, Cyrillic… report their own letter: fall back to the
      // physical key, but never take another Latin layout's K position.
      if (k !== "k" && !(event.code === "KeyK" && !/^[a-z]$/.test(k))) return;
      // Another dialog is asking something; it answers first.
      if (!dialog.current?.open && document.querySelector("dialog[open]")) return;
      event.preventDefault();
      if (dialog.current?.open) dialog.current.close();
      else open();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView({ block: "nearest" });
    // optionId depends on `places`, which changes only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  const go = async (place: Place | undefined) => {
    if (!place) return;
    dialog.current?.close();
    if (place.href === location.pathname + location.search + location.hash) return;
    if (!(await flushWorkspaceEdits())) return;
    startLeg(place.href.split(/[?#]/)[0], true);
    router.push(place.href);
  };
  const onKey = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (shown.length ? (a + step + shown.length) % shown.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void go(current);
    }
  };
  const status = query.trim()
    ? shown.length
      ? `${shown.length} ${shown.length === 1 ? "place" : "places"}`
      : `Nothing called “${query.trim()}”`
    : "";
  return (
    <>
      <button type="button" className="jump-trigger" onClick={open} aria-haspopup="dialog" aria-label="Jump to a page" aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}>
        <Search size={15} aria-hidden="true" />
        <span className="jump-trigger-label">Jump to</span>
        <kbd className="jump-trigger-key" aria-hidden="true">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <dialog
        ref={dialog}
        className="jump-menu"
        aria-label="Jump to a page"
        // Only a press that starts and ends on the backdrop closes it (not a
        // text selection that ends outside the box).
        onPointerDown={(event) => {
          pressedBackdrop.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          if (pressedBackdrop.current && event.target === event.currentTarget) event.currentTarget.close();
          pressedBackdrop.current = false;
        }}
      >
        <div className="jump-field">
          <Search size={17} aria-hidden="true" />
          <label className="sr-only" htmlFor={`${id}-q`}>Page or tool</label>
          <input
            ref={input}
            id={`${id}-q`}
            type="text"
            role="combobox"
            aria-expanded={shown.length > 0}
            aria-controls={`${id}-list`}
            aria-activedescendant={current ? optionId(current) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder="Jump to a page or tool"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
          <kbd aria-hidden="true">Esc</kbd>
        </div>
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label="Places"
          className="jump-list"
          // Keep focus in the field while choosing with the mouse.
          onMouseDown={(event) => event.preventDefault()}
        >
          {shown.map((place, i) => (
            <li
              key={place.href}
              id={optionId(place)}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : ""}
              onPointerMove={() => setActive(i)}
              onClick={() => void go(place)}
            >
              <span className="jump-label">{place.label}</span>
              {place.group && <span className="jump-group">{place.group}</span>}
              {i === active && <CornerDownLeft className="jump-enter" size={15} aria-hidden="true" />}
            </li>
          ))}
        </ul>
        {!shown.length && <p className="jump-empty muted">Nothing called “{query.trim()}”.</p>}
        <p className="sr-only" role="status">{status}</p>
      </dialog>
    </>
  );
}
