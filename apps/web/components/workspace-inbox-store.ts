"use client";
import { useCallback, useSyncExternalStore } from "react";
import { api } from "./workspace-ui";
import type { InboxItem } from "./workspace-inbox";
import { isDecision } from "./trainer-queue";

export const INBOX_CHANGED = "trainer-inbox-changed";
type Snapshot = {
  items: InboxItem[] | null;
  count: number;
  /** Rule suggestions waiting for the owner (Today's "Make this a rule?"). */
  rules: number;
  /** Decisions this coach finished since the start of their day (server count). */
  done: number;
  error: string;
  updatedAt: number;
};
const empty: Snapshot = { items: null, count: 0, rules: 0, done: 0, error: "", updatedAt: 0 };
type Entry = {
  snapshot: Snapshot;
  listeners: Set<() => void>;
  pending?: Promise<void>;
  at: number;
  epoch: number;
  stop?: () => void;
  /** Items finished here (item id, or `rule:<id>`), with when. A load that
   * started before a finish cannot know about it, so the finish is applied on
   * top of that load; a load started after it already reflects it. */
  finished: Map<string, number>;
};
const entries = new Map<string, Entry>();
let listening = false;
const entry = (scope: string) => {
  let result = entries.get(scope);
  if (!result) {
    result = { snapshot: empty, listeners: new Set(), at: 0, epoch: 0, finished: new Map() };
    entries.set(scope, result);
  }
  return result;
};
/** Listeners hear only real changes: an unchanged poll re-renders nothing. */
const publish = (e: Entry, snapshot: Snapshot) => {
  const { updatedAt: _a, ...next } = snapshot;
  const { updatedAt: _b, ...last } = e.snapshot;
  if (e.snapshot !== empty && JSON.stringify(next) === JSON.stringify(last)) return;
  e.snapshot = snapshot;
  for (const listener of e.listeners) listener();
};
const startOfLocalDay = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** The server's answer with this tab's newer finishes applied. */
function withFinished(e: Entry, s: Snapshot): Snapshot {
  if (!e.finished.size) return s;
  const keys = [...e.finished.keys()];
  const items = s.items?.filter((i) => !e.finished.has(i.id)) ?? null;
  const removed = (s.items?.length ?? 0) - (items?.length ?? 0);
  const rules = keys.filter((k) => k.startsWith("rule:")).length;
  return {
    ...s,
    items,
    count: Math.max(0, s.count - removed),
    rules: Math.max(0, s.rules - rules),
    done: s.done + keys.length,
  };
}
function load(e: Entry): Promise<void> {
  if (e.pending) return e.pending;
  const epoch = e.epoch,
    started = Date.now();
  e.pending = api(`/trainer/inbox?since=${startOfLocalDay()}`)
    .then(
      (r) => {
        if (e.epoch !== epoch) return;
        // Finishes before this load started are in its answer now.
        for (const [key, at] of e.finished) if (at < started) e.finished.delete(key);
        e.at = Date.now();
        publish(
          e,
          withFinished(e, {
            items: r.items,
            count: Number(r.counts?.total ?? r.items.length),
            rules: Number(r.counts?.rules ?? 0),
            done: Number(r.done?.count ?? 0),
            error: "",
            updatedAt: Date.now(),
          }),
        );
      },
      (error) => {
        if (e.epoch === epoch) publish(e, { ...e.snapshot, error: error.message });
      },
    )
    .finally(() => {
      e.pending = undefined;
    });
  return e.pending;
}
/** Reload now, or straight after a load already in flight (whose answer may
 * predate the change). */
function invalidate(e: Entry) {
  e.at = 0;
  if (e.pending) void e.pending.then(() => load(e));
  else void load(e);
}
export function useSharedInbox(scope: string, enabled = true) {
  const e = entry(enabled ? scope : "disabled");
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!enabled || !scope) return () => {};
      if (!listening) {
        window.addEventListener("workspace-session-cleared", () => {
          for (const value of entries.values()) {
            value.epoch++;
            value.at = 0;
            value.finished.clear();
            value.snapshot = empty;
            for (const l of value.listeners) l();
          }
          entries.clear();
        });
        listening = true;
      }
      e.listeners.add(listener);
      if (e.listeners.size === 1) {
        if (Date.now() - e.at > 15000) void load(e);
        const refresh = () => {
          if (document.visibilityState === "visible") void load(e);
        };
        const changed = () => invalidate(e);
        const timer = setInterval(refresh, 30000);
        window.addEventListener(INBOX_CHANGED, changed);
        document.addEventListener("visibilitychange", refresh);
        e.stop = () => {
          clearInterval(timer);
          window.removeEventListener(INBOX_CHANGED, changed);
          document.removeEventListener("visibilitychange", refresh);
        };
      }
      return () => {
        e.listeners.delete(listener);
        if (!e.listeners.size) e.stop?.();
      };
    },
    [scope, enabled, e],
  );
  const snapshot = useSyncExternalStore(subscribe, () => e.snapshot, () => empty);
  /**
   * The coach finished an inbox item (`{ id }`) or a rule suggestion
   * (`{ rule }`): it leaves the list and counts as done at once, in one
   * update, and the inbox reloads after any load in flight. Every page that
   * finishes something calls this, so the rail and Today agree.
   */
  const finish = useCallback(
    (what: { id: string } | { rule: string }) => {
      const key = "id" in what ? what.id : `rule:${what.rule}`;
      if (e.finished.has(key)) return;
      e.finished.set(key, Date.now());
      const s = e.snapshot;
      const items = "id" in what ? (s.items?.filter((i) => i.id !== what.id) ?? null) : s.items;
      const removed = (s.items?.length ?? 0) - (items?.length ?? 0);
      publish(e, {
        ...s,
        items,
        count: Math.max(0, s.count - removed),
        rules: "rule" in what ? Math.max(0, s.rules - 1) : s.rules,
        done: s.done + 1,
        updatedAt: Date.now(),
      });
      window.dispatchEvent(new Event(INBOX_CHANGED));
    },
    [e],
  );
  return { ...snapshot, load: () => load(e), finish };
}

/** Today's "x of y": decisions finished today against those finished plus
 * those still waiting (inbox decisions and rule suggestions). Upcoming
 * sessions wait in the queue but are not decisions yet. */
export function todayProgress(s: Pick<Snapshot, "items" | "done" | "rules">) {
  const waiting = (s.items ?? []).filter(isDecision).length + s.rules;
  return { done: s.done, waiting, total: s.done + waiting };
}
