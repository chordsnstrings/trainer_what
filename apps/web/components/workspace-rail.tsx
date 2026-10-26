"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pause, PanelLeft, PanelLeftClose, Play } from "lucide-react";
import type { LiveSnapshot } from "./workspace-live";
import { prefersReducedMotion } from "./motion";

/**
 * The trainer rail's own controls (docs/features/trainer-workspace.md):
 * keep the menu open, and pause the live motion (WCAG 2.2.2). Both are this
 * device's choice, kept in localStorage; the shell remounts on every page,
 * so the choice is read again each time from one module-level store.
 */
const PINNED = "trainer-rail-pinned",
  PAUSED = "trainer-live-motion";
type Prefs = { pinned: boolean; paused: boolean };
const DEFAULTS: Prefs = { pinned: false, paused: false };
let prefs: Prefs | null = null;
const listeners = new Set<() => void>();
function read(): Prefs {
  if (prefs) return prefs;
  try {
    prefs = {
      pinned: localStorage.getItem(PINNED) === "1",
      paused: localStorage.getItem(PAUSED) === "paused",
    };
  } catch {
    prefs = { ...DEFAULTS };
  }
  return prefs;
}
function write(next: Partial<Prefs>) {
  prefs = { ...read(), ...next };
  try {
    localStorage.setItem(PINNED, prefs.pinned ? "1" : "0");
    localStorage.setItem(PAUSED, prefs.paused ? "paused" : "live");
  } catch {}
  for (const listener of listeners) listener();
}
export function useRailPrefs() {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => DEFAULTS,
  );
  return {
    ...value,
    setPinned: (pinned: boolean) => write({ pinned }),
    setPaused: (paused: boolean) => write({ paused }),
  };
}

/** What the rail's status line says, in turn: only live, true facts. */
export function tickerLines(live: LiveSnapshot | undefined, waiting: number): string[] {
  if (!live) return [];
  const lines: string[] = [];
  const training = live.training.length;
  if (training) lines.push(`${training} ${training === 1 ? "client is" : "clients are"} training with your AI`);
  if (live.writing) lines.push(`Your Brain is writing ${live.writing === 1 ? "a plan" : `${live.writing} plans`}`);
  lines.push(waiting ? `${waiting} ${waiting === 1 ? "decision waits" : "decisions wait"} for you` : "Nothing waits for you");
  if (live.doneToday) lines.push(`${live.doneToday} done today`);
  if (live.feed[0]) lines.push(live.feed[0].text);
  return lines;
}

/** One line of what is happening now, turning every five seconds. */
export function RailTicker({ lines, paused }: { lines: string[]; paused: boolean }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (paused || lines.length < 2 || prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setIndex((i) => i + 1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [paused, lines.length]);
  if (!lines.length) return null;
  const line = lines[index % lines.length];
  return (
    <p className="rail-ticker" aria-hidden="true">
      <span className="rail-ticker-dot" />
      <span key={line} className="rail-ticker-line">{line}</span>
    </p>
  );
}

export function RailControls({ pinned, paused, setPinned, setPaused }: ReturnType<typeof useRailPrefs>) {
  const reduced = typeof window !== "undefined" && prefersReducedMotion();
  return (
    <>
      <button
        type="button"
        className="text-button rail-control"
        aria-pressed={paused}
        disabled={reduced}
        onClick={() => setPaused(!paused)}
      >
        <span className="nav-icon">{paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}</span>
        <span className="nav-label">{reduced ? "Motion is off on this device" : paused ? "Play live motion" : "Pause live motion"}</span>
      </button>
      <button
        type="button"
        className="text-button rail-control rail-pin"
        aria-pressed={pinned}
        onClick={() => setPinned(!pinned)}
      >
        <span className="nav-icon">{pinned ? <PanelLeftClose size={16} aria-hidden="true" /> : <PanelLeft size={16} aria-hidden="true" />}</span>
        <span className="nav-label">{pinned ? "Fold the menu" : "Keep the menu open"}</span>
      </button>
    </>
  );
}
