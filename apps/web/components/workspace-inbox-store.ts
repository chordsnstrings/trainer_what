"use client";
import { useCallback, useSyncExternalStore } from "react";
import { api } from "./workspace-ui";
import type { InboxItem } from "./workspace-inbox";

export const INBOX_CHANGED = "trainer-inbox-changed";
type Snapshot = { items: InboxItem[] | null; count: number; error: string };
const empty: Snapshot = { items: null, count: 0, error: "" };
type Entry = { snapshot: Snapshot; listeners: Set<() => void>; pending?: Promise<void>; at: number; epoch: number; stop?: () => void };
const entries = new Map<string, Entry>();
let listening = false;
const entry = (scope: string) => {
  let result = entries.get(scope);
  if (!result) { result = { snapshot: empty, listeners: new Set(), at: 0, epoch: 0 }; entries.set(scope, result); }
  return result;
};
const publish = (e: Entry, snapshot: Snapshot) => { e.snapshot = snapshot; for (const listener of e.listeners) listener(); };
function load(e: Entry): Promise<void> {
  if (e.pending) return e.pending;
  const epoch = e.epoch;
  e.pending = api("/trainer/inbox").then(r => {
    if (e.epoch !== epoch) return;
    e.at = Date.now(); publish(e, { items: r.items, count: Number(r.counts?.total ?? r.items.length), error: "" });
  }, error => { if (e.epoch === epoch) publish(e, { ...e.snapshot, error: error.message }); }).finally(() => { e.pending = undefined; });
  return e.pending;
}
export function useSharedInbox(scope: string, enabled = true) {
  const e = entry(enabled ? scope : "disabled");
  const subscribe = useCallback((listener: () => void) => {
    if (!enabled || !scope) return () => {};
    if (!listening) {
      window.addEventListener("workspace-session-cleared", () => {
        for (const value of entries.values()) { value.epoch++; value.at = 0; publish(value, empty); }
        entries.clear();
      });
      listening = true;
    }
    e.listeners.add(listener);
    if (e.listeners.size === 1) {
      if (Date.now() - e.at > 15000) void load(e);
      const refresh = () => { if (document.visibilityState === "visible") void load(e); };
      const invalidate = () => { e.at = 0; if (e.pending) void e.pending.then(() => load(e)); else void load(e); };
      const timer = setInterval(refresh, 30000);
      window.addEventListener(INBOX_CHANGED, invalidate);
      document.addEventListener("visibilitychange", refresh);
      e.stop = () => {
        clearInterval(timer);
        window.removeEventListener(INBOX_CHANGED, invalidate);
        document.removeEventListener("visibilitychange", refresh);
      };
    }
    return () => { e.listeners.delete(listener); if (!e.listeners.size) { e.stop?.(); } };
  }, [scope, enabled, e]);
  const snapshot = useSyncExternalStore(subscribe, () => e.snapshot, () => empty);
  const setItems = useCallback((update: (items: InboxItem[] | null) => InboxItem[] | null) => {
    const items = update(e.snapshot.items);
    publish(e, { ...e.snapshot, items, count: Math.max(0, e.snapshot.count - ((e.snapshot.items?.length ?? 0) - (items?.length ?? 0))) });
  }, [e]);
  return { ...snapshot, load: () => load(e), setItems };
}
