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
let leg: { to: string; direction: Direction } | null = null;
let bar: { state: "idle" | "running" | "done"; at: number } = { state: "idle", at: 0 };
const listeners = new Set<() => void>();
let doneTimer = 0,
  staleTimer = 0,
  listening = false;

function setBar(state: (typeof bar)["state"], at = bar.at) {
  bar = { state, at };
  for (const listener of listeners) listener();
}
function finishBar() {
  if (bar.state !== "running") return;
  window.clearTimeout(staleTimer);
  setBar("done");
  doneTimer = window.setTimeout(() => setBar("idle"), 420);
}
const content = () => document.getElementById("workspace-content");

/** The menu's links, top to bottom, as drawn for this person. */
function menuHrefs(): string[] {
  return [...document.querySelectorAll<HTMLAnchorElement>(".workspace.platform-ui .sidebar nav a[href]")].map(
    (a) => new URL(a.href, location.href).pathname,
  );
}

/** A workspace address is about to open. */
export function startLeg(to: string) {
  const from = location.pathname;
  if (to === from) return;
  leg = { to, direction: directionBetween(menuHrefs(), from, to) };
  window.clearTimeout(doneTimer);
  window.clearTimeout(staleTimer);
  setBar("running", Date.now());
  if (!prefersReducedMotion()) content()?.classList.add("is-leaving");
  // A page that never comes (an error screen, a blocked move) still ends the bar.
  staleTimer = window.setTimeout(() => {
    content()?.classList.remove("is-leaving");
    leg = null;
    finishBar();
  }, 10_000);
}

function onClick(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || !anchor.closest(".workspace.platform-ui")) return;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || url.pathname === location.pathname || !/^\/(trainer|admin|setup)(\/|$)/.test(url.pathname)) return;
  // Unsaved changes are saved first, with their own notice (workspace-continuity.tsx).
  if (workspaceHasEdits()) return;
  startLeg(url.pathname);
}

/** The bar at the top while the next page loads. Decorative: the page
 * itself says "Loading…" to assistive technology. */
export function RouteBar() {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (!listening) {
        listening = true;
        document.addEventListener("click", onClick, true);
      }
      return () => listeners.delete(listener);
    },
    () => bar,
    () => bar,
  );
  if (state.state === "idle") return null;
  // The workspace mounts again on the new address: the bar carries on from
  // where it was instead of starting over.
  const style = { "--route-elapsed": `${-Math.min(Date.now() - state.at, 3000)}ms` } as CSSProperties;
  return (
    <div className="route-bar" data-state={state.state} aria-hidden="true" style={style}>
      <span />
    </div>
  );
}

/**
 * How the page on screen arrived, for a moment once it is ready (`null`
 * afterwards and under reduced motion). Ends the bar.
 */
export function useRouteArrival(path: string, ready: boolean): Direction | null {
  const [arrival, setArrival] = useState<{ path: string; direction: Direction | null } | null>(null);
  // Decided while rendering, so the page's first frame already moves the
  // right way (an effect would start it one frame late, from the wrong side).
  if (ready && arrival?.path !== path) {
    const came = leg && leg.to === path ? leg.direction : "none";
    setArrival({ path, direction: prefersReducedMotion() ? null : came });
  }
  useEffect(() => {
    content()?.classList.remove("is-leaving");
  }, [path]);
  useEffect(() => {
    if (!ready || !arrival) return;
    leg = null;
    finishBar();
    if (!arrival.direction) return;
    const timer = window.setTimeout(() => setArrival({ path: arrival.path, direction: null }), 640);
    return () => window.clearTimeout(timer);
  }, [ready, arrival]);
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

/**
 * "Jump to": Ctrl or Cmd + K, or the button in the top bar, opens a short
 * list of every place in this person's menu. Type to filter, arrows to move,
 * Enter to go. Unsaved changes are saved before it leaves.
 */
export function JumpMenu() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(false);
  const id = useId();
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  const shown = rankPlaces(places, query).slice(0, 12);
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
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (dialog.current?.open) dialog.current.close();
      else open();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const go = async (place: Place | undefined) => {
    if (!place) return;
    dialog.current?.close();
    const to = place.href.split(/[?#]/)[0];
    if (to === location.pathname && !place.href.includes("#")) return;
    if (!(await flushWorkspaceEdits())) return;
    startLeg(to);
    router.push(place.href);
  };
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (shown.length ? (a + step + shown.length) % shown.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void go(shown[active]);
    }
  };
  return (
    <>
      <button type="button" className="jump-trigger" onClick={open} aria-haspopup="dialog" aria-label="Jump to a page" aria-keyshortcuts="Control+K Meta+K">
        <Search size={15} aria-hidden="true" />
        <span className="jump-trigger-label">Jump to</span>
        <kbd className="jump-trigger-key" aria-hidden="true">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <dialog
        ref={dialog}
        className="jump-menu"
        aria-label="Jump to a page"
        onClick={(event) => {
          // A click on the backdrop closes it.
          if (event.target === dialog.current) dialog.current?.close();
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
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
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
        <ul id={`${id}-list`} role="listbox" aria-label="Places" className="jump-list">
          {shown.map((place, i) => (
            <li
              key={place.href}
              id={`${id}-${i}`}
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
        {!shown.length && <p className="jump-empty muted" role="status">Nothing called “{query.trim()}”.</p>}
      </dialog>
    </>
  );
}
