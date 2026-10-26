"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api, type Row, type State } from "./workspace-ui";
import { INBOX_CHANGED } from "./workspace-inbox-store";

/**
 * The trainer workspace's live picture (docs/features/trainer-workspace.md,
 * "Today"): who is training with the coach's AI right now, what the Brain
 * did, and whether it is writing a plan. Seeded from /bootstrap (no extra
 * request when a page opens), then refreshed once a minute while the tab is
 * visible, for owners and staff only. Every value comes from records and
 * events the workspace can already read; nothing here is estimated. The
 * decisions finished today come from the server with the inbox
 * (workspace-inbox-store.ts), not from here.
 */

export type LiveTraining = {
  workoutId: string;
  clientId: string;
  name: string;
  workout: string;
  startedAt: string;
  setsDone: number;
  setsTotal: number;
};
export type FeedItem = {
  id: string;
  /** Who acted: the coach's Brain, a client, or the coach. */
  by: "brain" | "client" | "you";
  text: string;
  detail: string;
  at: string;
};
export type LiveSnapshot = {
  training: LiveTraining[];
  feed: FeedItem[];
  /** Plans the Brain started writing in the last 30 minutes and has not finished. */
  writing: number;
  /** When the data was read (not when it was last shown). */
  updatedAt: number;
};

type EventRow = {
  id: string;
  name: string;
  actor_id: string | null;
  subject_id: string | null;
  created_at: string;
  data?: any;
};
type SetRow = { id: string; workout_id: string; user_id: string; created_at: string };

/** A workout counts as "now" for this long after it started. Active workouts
 * are never closed by the server, so older ones are treated as abandoned. */
export const TRAINING_WINDOW_MS = 3 * 3600_000;
/** A plan still being written after this long is shown as stalled, not live. */
export const WRITING_WINDOW_MS = 30 * 60_000;

const PLAN_FINISHED = new Set([
  "brain.plan_delivered",
  "brain.plan_review_required",
  "brain.plan_failed",
  "brain.plan_adapted",
]);

const ms = (iso: string) => Date.parse(iso) || 0;

export function nameMap(members: any[] | undefined): Map<string, string> {
  return new Map(
    (members ?? [])
      .filter((m) => m && m.id && m.name)
      .map((m) => [String(m.id), String(m.name)]),
  );
}

const firstName = (full: string | undefined) =>
  full ? full.trim().split(/\s+/)[0] : "";

/** Sets planned in a workout's program snapshot. */
export function plannedSets(data: any): number {
  const exercises = Array.isArray(data?.program?.exercises)
    ? data.program.exercises
    : [];
  return exercises.reduce(
    (total: number, e: any) =>
      total + (Number.isFinite(Number(e?.sets)) ? Math.max(0, Number(e.sets)) : 0),
    0,
  );
}

/** Active workouts started inside the window, newest first, with their logged sets. */
export function deriveTraining(
  workouts: Row[],
  sets: SetRow[],
  names: Map<string, string>,
  now: number,
): LiveTraining[] {
  const logged = new Map<string, number>();
  for (const s of sets) logged.set(s.workout_id, (logged.get(s.workout_id) ?? 0) + 1);
  return workouts
    .filter((w) => w.kind === "workout" && w.status === "active")
    .map((w) => {
      const startedAt = String(w.data?.startedAt ?? w.created_at);
      const total = plannedSets(w.data);
      return {
        workoutId: w.id,
        clientId: w.owner_user_id,
        name: names.get(w.owner_user_id) ?? "A client",
        workout: String(w.data?.program?.name ?? w.data?.program?.title ?? "a workout"),
        startedAt,
        setsDone: Math.min(logged.get(w.id) ?? 0, total || Infinity),
        setsTotal: total,
      };
    })
    .filter((t) => now - ms(t.startedAt) >= 0 && now - ms(t.startedAt) <= TRAINING_WINDOW_MS)
    .sort((a, b) => ms(b.startedAt) - ms(a.startedAt));
}

/** Plans the Brain started writing recently and has not finished yet. */
export function plansBeingWritten(events: EventRow[], now: number): number {
  const finished = new Set(
    events.filter((e) => PLAN_FINISHED.has(e.name)).map((e) => e.subject_id),
  );
  return events.filter(
    (e) =>
      e.name === "brain.plan_generation_started" &&
      !finished.has(e.subject_id) &&
      now - ms(e.created_at) <= WRITING_WINDOW_MS,
  ).length;
}

/** What the Brain and clients did, in plain words, newest first. */
export function deriveFeed(
  events: EventRow[],
  names: Map<string, string>,
  userId: string,
  limit = 6,
): FeedItem[] {
  const who = (id: string | null) => firstName(id ? names.get(id) : undefined);
  const items: FeedItem[] = [];
  for (const e of [...events].sort((a, b) => ms(b.created_at) - ms(a.created_at))) {
    const client = who(e.actor_id);
    const forClient = client ? ` for ${client}` : "";
    const line = (by: FeedItem["by"], text: string, detail: string) =>
      items.push({ id: e.id, by, text, detail, at: e.created_at });
    switch (e.name) {
      case "coaching.automatic_delivered":
        line("brain", client ? `Answered ${client}` : "Answered a client", "Sent on its own, within your rules");
        break;
      case "coaching.review_required":
        line("brain", `Drafted a reply${forClient}`, "Waits for you");
        break;
      case "brain.plan_generation_started":
        line("brain", `Started writing a plan${forClient}`, "Your Brain is working on it");
        break;
      case "brain.plan_delivered":
        line("brain", `Sent a plan${forClient}`, "Delivered on its own");
        break;
      case "brain.plan_review_required":
        line("brain", `Wrote a plan${forClient}`, "Waits for you");
        break;
      case "brain.plan_adapted":
        line("brain", `Adjusted a plan${forClient}`, "From how the week went");
        break;
      case "brain.plan_failed":
        line("brain", `Could not draft a plan${forClient}`, "Open plans to try again");
        break;
      case "brain.suggestion_confirmed":
        line(e.actor_id === userId ? "you" : "brain", "Learned a rule from you", "It uses it from now on");
        break;
      case "workout.completed":
        line("client", client ? `${client} finished a workout` : "A client finished a workout", "Coached by your AI");
        break;
      case "workout.started":
        line("client", client ? `${client} started a workout` : "A client started a workout", "Training with your AI");
        break;
      default:
        break;
    }
    if (items.length >= limit) break;
  }
  return items;
}

/** Everything the live picture needs, from rows the workspace already has. */
export function deriveLive(
  input: { events: EventRow[]; workouts: Row[]; sets: SetRow[]; members?: any[] },
  userId: string,
  now: number,
): Omit<LiveSnapshot, "updatedAt"> {
  const names = nameMap(input.members);
  return {
    training: deriveTraining(input.workouts, input.sets, names, now),
    feed: deriveFeed(input.events, names, userId),
    writing: plansBeingWritten(input.events, now),
  };
}

// ---- the shared store --------------------------------------------------

type Source = {
  events: EventRow[];
  workouts: Row[];
  sets: SetRow[];
  members?: any[];
  at: number;
};
type Entry = {
  source: Source | null;
  snapshot: LiveSnapshot;
  listeners: Set<() => void>;
  userId: string;
  stop?: () => void;
  pending?: Promise<void>;
};
const EMPTY: LiveSnapshot = { training: [], feed: [], writing: 0, updatedAt: 0 };
/** Bootstrap payloads already used, so a re-render of an older page never
 * replaces a fresher minute's refresh. */
const seeded = new WeakSet<object>();
const entries = new Map<string, Entry>();
/** Refresh interval while the tab is visible. */
export const LIVE_REFRESH_MS = 60_000;

/** Derives the picture now; listeners hear it only when it changed, so the
 * half-minute clock re-renders nothing unless the training window moved. */
function publish(e: Entry) {
  if (!e.source) return;
  const derived = deriveLive(e.source, e.userId, Date.now());
  const { updatedAt: _, ...last } = e.snapshot;
  if (e.snapshot !== EMPTY && JSON.stringify(derived) === JSON.stringify(last)) return;
  e.snapshot = { ...derived, updatedAt: e.source.at };
  for (const listener of e.listeners) listener();
}

/** Reads the picture again. `eventsOnly` after the coach acts: an action
 * changes the feed, never who is training. */
function refresh(e: Entry, eventsOnly = false): Promise<void> {
  if (e.pending) return e.pending;
  const started = Date.now();
  e.pending = Promise.all([
    api("/workspace/pages/events?limit=100"),
    eventsOnly && e.source ? null : api("/workspace/pages/records?kind=workout&status=active&limit=20"),
    eventsOnly && e.source ? null : api("/workspace/pages/sets?limit=100"),
  ])
    .then(([events, workouts, sets]) => {
      e.source = {
        events: events.items ?? [],
        workouts: workouts ? (workouts.items ?? []) : (e.source?.workouts ?? []),
        sets: sets ? (sets.items ?? []) : (e.source?.sets ?? []),
        members: e.source?.members,
        at: started,
      };
      publish(e);
    })
    // A failed refresh keeps the last picture; the next minute tries again.
    .catch(() => {})
    .finally(() => {
      e.pending = undefined;
    });
  return e.pending;
}

/**
 * The live picture for this workspace scope. `state` seeds it from
 * bootstrap whenever a page loads; owners and staff then refresh it every
 * minute while the tab is visible. Other roles get an empty picture and no
 * requests.
 */
export function useLive(scope: string, state: State | null, enabled: boolean) {
  const key = enabled && scope ? scope : "";
  let e = entries.get(key);
  if (!e) {
    e = { source: null, snapshot: EMPTY, listeners: new Set(), userId: "" };
    entries.set(key, e);
  }
  const entry = e;
  // Bootstrap is newer than the last minute's refresh only when it arrived later.
  useEffect(() => {
    if (!key || !state) return;
    entry.userId = String(state.user?.userId ?? "");
    const marker = (state.events ?? state.records) as object | undefined;
    if (marker && seeded.has(marker)) return;
    if (marker) seeded.add(marker);
    const fromBootstrap: Source = {
      events: (state.events ?? []) as EventRow[],
      workouts: (state.records ?? []).filter((r) => r.kind === "workout"),
      sets: (state.sets ?? []) as SetRow[],
      members: state.members,
      at: Date.now(),
    };
    entry.source = entry.source
      ? { ...fromBootstrap, members: state.members ?? entry.source.members }
      : fromBootstrap;
    publish(entry);
  }, [key, state, entry]);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!key) return () => {};
      entry.listeners.add(listener);
      if (entry.listeners.size === 1) {
        const tick = () => {
          if (document.visibilityState === "visible") void refresh(entry);
        };
        const timer = window.setInterval(tick, LIVE_REFRESH_MS);
        // The coach just finished something: the feed follows, after any
        // read already in flight (which may predate the action).
        const acted = () => {
          if (entry.pending) void entry.pending.then(() => refresh(entry, true));
          else void refresh(entry, true);
        };
        window.addEventListener(INBOX_CHANGED, acted);
        // The training window and the writing window move on their own.
        const clock = window.setInterval(() => {
          if (document.visibilityState === "visible") publish(entry);
        }, 30_000);
        const cleared = () => {
          entry.source = null;
          entry.snapshot = EMPTY;
        };
        window.addEventListener("workspace-session-cleared", cleared);
        entry.stop = () => {
          window.clearInterval(timer);
          window.clearInterval(clock);
          window.removeEventListener("workspace-session-cleared", cleared);
          window.removeEventListener(INBOX_CHANGED, acted);
        };
      }
      return () => {
        entry.listeners.delete(listener);
        if (!entry.listeners.size) entry.stop?.();
      };
    },
    [key, entry],
  );
  return useSyncExternalStore(subscribe, () => entry.snapshot, () => EMPTY);
}
