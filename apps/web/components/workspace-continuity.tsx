"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type SetStateAction } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { confirmWorkspace } from "./workspace-feedback";

export const WorkspaceScope = createContext("");
import { views, draftPrefix, workspaceSessionVersion } from "./workspace-session";
export { clearWorkspaceViews } from "./workspace-session";
type Guard = { dirty: () => boolean; save: () => Promise<boolean> };
const guards = new Set<Guard>();
let leaving: Promise<boolean> | null = null;

/** Wait for in-flight saves too. A failed save must never become navigation. */
export function flushWorkspaceEdits(): Promise<boolean> {
  if (leaving) return leaving;
  leaving = (async () => {
    for (const guard of [...guards]) {
      if (guard.dirty() && !(await guard.save())) return false;
    }
    return true;
  })().catch(() => false).finally(() => { leaving = null; });
  return leaving;
}

export function useSaveBeforeLeave(dirty: boolean | (() => boolean), save: () => Promise<boolean>) {
  const current = useRef({ dirty, save });
  current.current = { dirty, save };
  useEffect(() => {
    const guard: Guard = { dirty: () => typeof current.current.dirty === "function" ? current.current.dirty() : current.current.dirty, save: () => current.current.save() };
    guards.add(guard);
    return () => { guards.delete(guard); };
  }, []);
}

/** Configuration needs an explicit Save; never persist credentials as drafts. */
export function useConfirmBeforeLeave(dirty: boolean) {
  const scope = useContext(WorkspaceScope), discarded = useRef(false);
  useEffect(() => { if (!dirty) discarded.current = false; }, [dirty]);
  useSaveBeforeLeave(() => !!scope && dirty && !discarded.current, async () => {
    const accepted = await confirmWorkspace({ title: "Discard changes?", detail: "Your changes have not been saved. Stay here to save them, or discard them and leave.", confirm: "Discard and leave", danger: true });
    discarded.current = accepted;
    return accepted;
  });
}

/** In-memory view state; drafts additionally survive reload in this tab only. */
export function useWorkspaceValue<T>(key: string, initial: T, draft = false) {
  const scope = useContext(WorkspaceScope);
  const id = `${draftPrefix}${scope}:${key}`;
  const session = useRef(workspaceSessionVersion());
  const restore = () => {
    if (!scope || typeof window === "undefined") return initial;
    if (views.has(id)) return views.get(id) as T;
    if (draft) try {
      const saved = JSON.parse(sessionStorage.getItem(id) ?? "null");
      if (saved && "value" in saved) return saved.value as T;
    } catch {}
    return initial;
  };
  const [value, setValue] = useState<T>(restore);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!scope) return;
    latest.current = restore(); setValue(latest.current);
    // A save can finish after its originating screen unmounts. Keep a newly
    // mounted instance in sync with that result instead of showing stale drafts.
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) return;
      latest.current = restore(); setValue(latest.current);
    };
    window.addEventListener("workspace-value-changed", changed);
    return () => window.removeEventListener("workspace-value-changed", changed);
  }, [id]);
  const set = useCallback((next: SetStateAction<T>) => {
    // A request completing after sign-out must not recreate personal drafts.
    if (session.current !== workspaceSessionVersion()) return;
    const current = scope && views.has(id) ? views.get(id) as T : latest.current;
    const result = typeof next === "function" ? (next as (v: T) => T)(current) : next;
    latest.current = result;
    setValue(result);
    if (scope) {
      views.set(id, result);
      if (draft) try { sessionStorage.setItem(id, JSON.stringify({ value: result })); } catch {}
      window.dispatchEvent(new CustomEvent("workspace-value-changed", { detail: id }));
    }
  }, [id, scope, draft]);
  const clear = useCallback(() => {
    if (session.current !== workspaceSessionVersion()) return;
    views.delete(id);
    try { sessionStorage.removeItem(id); } catch {}
  }, [id]);
  return [value, set, clear] as const;
}

/** Native history keeps filters shareable without remounting the workspace. */
export function useWorkspaceQuery(key: string, initial = "") {
  const params = useSearchParams();
  const value = params.get(key) ?? initial;
  const set = useCallback((next: string) => {
    const url = new URL(window.location.href);
    if (next && next !== initial) url.searchParams.set(key, next);
    else url.searchParams.delete(key);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [key, initial]);
  return [value, set] as const;
}

export function WorkspaceContinuity({ scope }: { scope: string }) {
  const router = useRouter(), path = usePathname(), search = useSearchParams().toString();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const click = async (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || ![...guards].some(g => g.dirty())) return;
      const url = new URL(anchor.href, location.href);
      if (!/^https?:$/.test(url.protocol) || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSaving(true);
      const saved = await flushWorkspaceEdits();
      setSaving(false);
      if (!saved) return;
      if (url.origin === location.origin) router.push(url.pathname + url.search + url.hash);
      else window.location.assign(url.href);
    };
    const unload = (event: BeforeUnloadEvent) => {
      if ([...guards].some(g => g.dirty())) { event.preventDefault(); event.returnValue = ""; }
    };
    document.addEventListener("click", click, true);
    window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("click", click, true); window.removeEventListener("beforeunload", unload); };
  }, [router]);
  useEffect(() => {
    const key = `${draftPrefix}${scope}:scroll:${path}?${search}`;
    let y = Number(views.get(key) ?? 0);
    try { if (!y) y = Number(sessionStorage.getItem(key) ?? 0); } catch {}
    let restoring = y > 0;
    const restore = () => {
      if (!restoring) return;
      window.scrollTo({ top: y, behavior: "instant" });
      if (document.documentElement.scrollHeight - innerHeight >= y) restoring = false;
    };
    const frame = requestAnimationFrame(restore);
    const observer = new ResizeObserver(restore);
    observer.observe(document.body);
    const cancelRestore = () => { restoring = false; };
    const remember = () => { if (!restoring) { views.set(key, window.scrollY); try { sessionStorage.setItem(key, String(window.scrollY)); } catch {} } };
    window.addEventListener("scroll", remember, { passive: true });
    window.addEventListener("wheel", cancelRestore, { passive: true });
    window.addEventListener("touchstart", cancelRestore, { passive: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("scroll", remember); window.removeEventListener("wheel", cancelRestore); window.removeEventListener("touchstart", cancelRestore); };
  }, [scope, path, search]);
  return saving ? <div className="workspace-save-notice" role="status">Saving your changes…</div> : null;
}
