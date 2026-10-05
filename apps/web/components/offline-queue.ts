// Device queues for set logs and meal diary entries. This module is free of
// React and browser globals so replay, rejection and sign-out rules can be
// tested directly; components pass `localStorage` as the store.

export type QueueStore = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
export type QueueFailure = { status?: number; code?: string; message: string };
export type RejectedEntry<T> = {
  item: T;
  failure: QueueFailure;
  rejectedAt: string;
};
export type QueueKeys = { pending: string; rejected: string; receipts: string };
/** retry: connection or server trouble; session: sign in again; blocked: access changed. */
export type QueueStop = "retry" | "session" | "blocked";
export type DrainResult<T> = {
  synced: T[];
  rejected: RejectedEntry<T>[];
  stopped?: { reason: QueueStop; failure: QueueFailure };
};
export type WorkoutQueueItem = {
  path: string;
  logicalKey: string;
  body: {
    eventKey: string;
    exercise: string;
    exerciseIndex?: number;
    set: number;
    reps: number;
    loadKg: number;
    rir?: number;
    /** A round of timed or distance work: what was done (reps 0). */
    durationSeconds?: number;
    distanceMeters?: number;
    notes?: string;
  };
};
export type NutritionQueueItem = {
  eventKey: string;
  date: string;
  timezone: string;
  name: string;
  correctsId?: string;
  [field: string]: unknown;
};
type Post = (
  path: string,
  body: unknown,
  headers: Record<string, string>,
) => Promise<unknown>;

/**
 * Every replay names the member who saved the queue. The API refuses it with
 * QUEUE_OWNER_MISMATCH while another member is signed in, e.g. from a tab left
 * open after sign-out, so entries never reach someone else's record.
 */
export const QUEUE_OWNER_HEADER = "X-Queue-Owner";
export const QUEUE_OWNER_MISMATCH = "SESSION_OWNER_MISMATCH";
export function queueOwnerHeaders(tenantId: string, userId: string) {
  return { [QUEUE_OWNER_HEADER]: `${tenantId}:${userId}` };
}

/** Keys are scoped to one workspace member, so another account never replays them. */
export function offlineQueueKeys(
  kind: "workout" | "nutrition",
  tenantId: string,
  userId: string,
): QueueKeys {
  const pending =
    kind === "workout"
      ? `trainer:queue:${tenantId}:${userId}`
      : `trainer:nutrition:${tenantId}:${userId}:queue`;
  return {
    pending,
    rejected: pending + ":rejected",
    receipts: pending + ":receipts",
  };
}
export function isOfflineQueueKey(key: string) {
  return (
    key.startsWith("trainer:queue:") ||
    /^trainer:nutrition:[^:]+:[^:]+:queue(:|$)/.test(key)
  );
}
export function readList<T = any>(store: QueueStore, key: string): T[] {
  try {
    const value = JSON.parse(store.getItem(key) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function writeList(store: QueueStore, key: string, list: unknown[]) {
  if (list.length) store.setItem(key, JSON.stringify(list));
  else store.removeItem(key);
}
export function queueFailure(error: unknown): QueueFailure {
  const e = error as { status?: unknown; code?: unknown; message?: unknown };
  return {
    status: typeof e?.status === "number" ? e.status : undefined,
    code: typeof e?.code === "string" ? e.code : undefined,
    message: String(e?.message ?? "Request failed"),
  };
}
/**
 * A failure either stops the replay with every entry kept, or rejects only the
 * entry that was sent. Only the second kind lets later entries continue.
 */
export function classifyQueueFailure(
  failure: QueueFailure,
  blockedStatuses: number[] = [402, 403],
): QueueStop | "rejected" {
  // Another member's session: stop and keep the queue for its owner.
  if (failure.code === QUEUE_OWNER_MISMATCH) return "session";
  const status = failure.status;
  // 423: the workspace is suspended; keep entries until it is reinstated.
  if (!status || status >= 500 || [408, 423, 425, 429].includes(status))
    return "retry";
  if (status === 401) return "session";
  if (blockedStatuses.includes(status)) return "blocked";
  return status >= 400 ? "rejected" : "retry";
}
/**
 * Replays the live queue, not a snapshot: entries added while a request is in
 * flight are sent in the same pass. Each entry is attempted once per pass.
 */
export async function drainQueue<T>(
  store: QueueStore,
  keys: QueueKeys,
  post: (item: T) => Promise<unknown>,
  options: {
    id: (item: T) => string;
    receipt?: (item: T) => string | undefined;
    blockedStatuses?: number[];
    now?: () => Date;
  },
): Promise<DrainResult<T>> {
  const synced: T[] = [],
    rejected: RejectedEntry<T>[] = [],
    attempted = new Set<string>();
  const remove = (id: string) =>
    writeList(
      store,
      keys.pending,
      readList<T>(store, keys.pending).filter((x) => options.id(x) !== id),
    );
  for (;;) {
    const item = readList<T>(store, keys.pending).find(
      (x) => !attempted.has(options.id(x)),
    );
    if (!item) return { synced, rejected };
    const id = options.id(item);
    attempted.add(id);
    try {
      await post(item);
    } catch (error) {
      const failure = queueFailure(error),
        kind = classifyQueueFailure(failure, options.blockedStatuses);
      if (kind !== "rejected")
        return { synced, rejected, stopped: { reason: kind, failure } };
      const entry: RejectedEntry<T> = {
        item,
        failure,
        rejectedAt: (options.now?.() ?? new Date()).toISOString(),
      };
      remove(id);
      writeList(store, keys.rejected, [
        ...readList<RejectedEntry<T>>(store, keys.rejected).filter(
          (x) => options.id(x.item) !== id,
        ),
        entry,
      ]);
      rejected.push(entry);
      continue;
    }
    remove(id);
    const receipt = options.receipt?.(item);
    if (receipt)
      writeList(store, keys.receipts, [
        ...new Set([...readList<string>(store, keys.receipts), receipt]),
      ]);
    synced.push(item);
  }
}
const running = new Map<string, { again: boolean }>();
const inFlight = new Map<string, Promise<unknown>>();
/**
 * One replay per queue at a time. A call made during a replay does not start
 * a second one; it makes the current replay run again before resolving.
 */
export function runExclusive<R>(key: string, task: () => Promise<R>) {
  const current = running.get(key);
  if (current) {
    current.again = true;
    return inFlight.get(key) as Promise<R>;
  }
  const state = { again: false };
  running.set(key, state);
  const promise = (async () => {
    try {
      let result: R;
      do {
        state.again = false;
        result = await task();
      } while (state.again);
      return result;
    } finally {
      running.delete(key);
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
export function drainWorkoutQueue(
  store: QueueStore,
  tenantId: string,
  userId: string,
  post: Post,
) {
  const keys = offlineQueueKeys("workout", tenantId, userId),
    owner = queueOwnerHeaders(tenantId, userId);
  return runExclusive(keys.pending, () =>
    drainQueue<WorkoutQueueItem>(
      store,
      keys,
      (item) => post(item.path, item.body, owner),
      { id: (item) => item.body.eventKey, receipt: (item) => item.logicalKey },
    ),
  );
}
export function drainNutritionQueue(
  store: QueueStore,
  tenantId: string,
  userId: string,
  post: Post,
) {
  const keys = offlineQueueKeys("nutrition", tenantId, userId),
    owner = queueOwnerHeaders(tenantId, userId);
  return runExclusive(keys.pending, () =>
    drainQueue<NutritionQueueItem>(
      store,
      keys,
      (item) => post("/nutrition/logs", item, owner),
      { id: (item) => item.eventKey },
    ),
  );
}
/** Moves a rejected entry back to the replay queue, optionally changed. */
export function retryRejected<T>(
  store: QueueStore,
  keys: QueueKeys,
  id: string,
  idOf: (item: T) => string,
  change: (item: T) => T = (item) => item,
) {
  const rejected = readList<RejectedEntry<T>>(store, keys.rejected),
    entry = rejected.find((x) => idOf(x.item) === id);
  if (!entry) return false;
  writeList(
    store,
    keys.rejected,
    rejected.filter((x) => x !== entry),
  );
  writeList(store, keys.pending, [
    ...readList<T>(store, keys.pending),
    change(entry.item),
  ]);
  return true;
}
export function discardRejected<T>(
  store: QueueStore,
  keys: QueueKeys,
  id: string,
  idOf: (item: T) => string,
) {
  writeList(
    store,
    keys.rejected,
    readList<RejectedEntry<T>>(store, keys.rejected).filter(
      (x) => idOf(x.item) !== id,
    ),
  );
}
/** Entries on this device that the workspace has not accepted yet. */
export function unsyncedCount(
  store: QueueStore,
  tenantId: string,
  userId: string,
) {
  return (["workout", "nutrition"] as const).reduce((count, kind) => {
    const keys = offlineQueueKeys(kind, tenantId, userId);
    return (
      count +
      readList(store, keys.pending).length +
      readList(store, keys.rejected).length
    );
  }, 0);
}
/** Replays both queues while the session is still valid, e.g. before sign-out. */
export async function replayOfflineQueues(
  store: QueueStore,
  tenantId: string,
  userId: string,
  post: Post,
) {
  await drainWorkoutQueue(store, tenantId, userId, post);
  await drainNutritionQueue(store, tenantId, userId, post);
}
/**
 * Leaves the current session by sign-out or workspace switch. Both queues
 * replay first, while this session is still valid; unsynced entries need
 * confirmation and are never removed. Caches are cleared after `leave`:
 * this app's device data here, and the browser's cached pages through
 * `afterLeave` (clearPersonalCaches in pwa.ts). Returns false when the
 * person chose to stay.
 */
export async function leaveSession(
  store: QueueStore,
  tenantId: string,
  userId: string,
  options: {
    online: boolean;
    post: Post;
    confirm: (unsynced: number) => boolean | Promise<boolean>;
    leave: () => Promise<unknown>;
    afterLeave?: () => Promise<unknown> | unknown;
  },
) {
  if (options.online)
    await replayOfflineQueues(store, tenantId, userId, options.post).catch(
      () => {},
    );
  const unsynced = unsyncedCount(store, tenantId, userId);
  if (unsynced > 0 && !(await options.confirm(unsynced))) return false;
  await options.leave();
  clearLocalData(store, { keepQueues: true });
  await options.afterLeave?.();
  return true;
}
/**
 * The outcome of one entry after a replay. An entry that is neither waiting
 * nor set aside was accepted, unless the replay stopped because access
 * changed: the caller then removes the queue, so the entry was discarded.
 */
export function entryOutcome<T>(
  store: QueueStore,
  keys: QueueKeys,
  id: string,
  idOf: (item: T) => string,
  result: DrainResult<T> | null | undefined,
): "pending" | "rejected" | "discarded" | "accepted" {
  if (readList<T>(store, keys.pending).some((x) => idOf(x) === id))
    return "pending";
  if (
    readList<RejectedEntry<T>>(store, keys.rejected).some(
      (x) => idOf(x.item) === id,
    )
  )
    return "rejected";
  if (result?.synced.some((x) => idOf(x) === id)) return "accepted";
  return result?.stopped?.reason === "blocked" ? "discarded" : "accepted";
}
/**
 * Clears this app's device data. With `keepQueues`, unsynced member-scoped
 * queues stay so the same person can replay them after signing in again.
 */
export function clearLocalData(
  store: QueueStore,
  { keepQueues }: { keepQueues: boolean },
) {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith("trainer:")) keys.push(key);
  }
  for (const key of keys)
    if (!keepQueues || !isOfflineQueueKey(key)) store.removeItem(key);
}
