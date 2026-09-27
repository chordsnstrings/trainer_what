// Client side of the bounded bootstrap: the bootstrap carries the first page
// of each collection and a `pages` entry ({ hasMore, cursor }); later pages
// come from /api/v1/workspace/pages/:collection and are merged into the lists
// the screens already read. Pure functions, so they are testable without a
// browser.

export type PageInfo = { hasMore: boolean; cursor: string | null };
export type ExtraPages = Record<string, PageInfo & { items: any[] }>;

/** Records page per kind; every other collection pages as a whole. */
export const pageKey = (collection: string, kind?: string) =>
  kind ? `records:${kind}` : collection;
/**
 * Rows a page refers to (an exception page's decisions and member names) are
 * kept under their own key and merged into their collection; they are never
 * a paging position.
 */
const RELATED = "related:";
const RELATED_COLLECTIONS = ["records", "members"];
const collectionOf = (key: string) =>
  key.startsWith("records:")
    ? "records"
    : key.startsWith(RELATED)
      ? key.slice(RELATED.length)
      : key;
const rowIdentity = (collection: string, row: any) =>
  collection === "usageStatements" ? row.period : row.id;

/** The current position: loaded extra pages win over the bootstrap entry. */
export function pageInfo(
  pages: Record<string, any> | undefined,
  extra: ExtraPages,
  collection: string,
  kind?: string,
): PageInfo | undefined {
  const loaded = extra[pageKey(collection, kind)];
  if (loaded) return { hasMore: loaded.hasMore, cursor: loaded.cursor };
  const entry = kind ? pages?.records?.[kind] : pages?.[collection];
  return entry
    ? { hasMore: !!entry.hasMore, cursor: entry.cursor ?? null }
    : undefined;
}

export function canLoadMore(info: PageInfo | undefined) {
  return !!info?.hasMore && !!info.cursor;
}

/** The request for the page after `info`. */
export function nextPagePath(
  collection: string,
  info: PageInfo,
  kind?: string,
) {
  const query = new URLSearchParams({ cursor: info.cursor ?? "" });
  if (kind) query.set("kind", kind);
  return `/workspace/pages/${collection}?${query}`;
}

/** Appends a fetched page; a row already present is kept once. */
export function appendPage(
  extra: ExtraPages,
  key: string,
  page: { items: any[]; hasMore: boolean; cursor: string | null },
): ExtraPages {
  const collection = collectionOf(key);
  const previous = extra[key]?.items ?? [];
  const known = new Set(previous.map((row) => rowIdentity(collection, row)));
  return {
    ...extra,
    [key]: {
      items: [
        ...previous,
        ...page.items.filter((row) => !known.has(rowIdentity(collection, row))),
      ],
      hasMore: page.hasMore,
      cursor: page.cursor,
    },
  };
}

/** Adds a page's related rows (see RELATED) to the loaded pages. */
export function appendRelated(
  extra: ExtraPages,
  related: Record<string, unknown> | undefined,
): ExtraPages {
  let next = extra;
  for (const collection of RELATED_COLLECTIONS) {
    const rows = related?.[collection];
    if (!Array.isArray(rows) || !rows.length) continue;
    next = appendPage(next, RELATED + collection, {
      items: rows,
      hasMore: false,
      cursor: null,
    });
  }
  return next;
}

/**
 * Whether a listed workout's set logs must be read by id. The bootstrap
 * carries only the most recent set logs, plus every log of a follower's own
 * active sessions (so logging works offline); when its set list is complete
 * nothing is missing.
 */
export function needsWorkoutSets(
  workout: { status: string; owner_user_id?: string | null },
  viewer: { role: string; userId: string },
  setsComplete: boolean,
) {
  if (setsComplete) return false;
  return !(
    viewer.role === "subscriber" &&
    workout.status === "active" &&
    workout.owner_user_id === viewer.userId
  );
}

/**
 * The bootstrap state with loaded pages appended after the first page. A row
 * the fresh bootstrap already contains is never duplicated, and the fresh
 * copy wins.
 */
export function mergePages<T extends Record<string, any>>(
  state: T,
  extra: ExtraPages,
): T {
  const keys = Object.keys(extra);
  if (!keys.length) return state;
  const next: Record<string, any> = { ...state };
  for (const key of keys) {
    const collection = collectionOf(key);
    const current: any[] = Array.isArray(next[collection])
      ? next[collection]
      : [];
    const known = new Set(current.map((row) => rowIdentity(collection, row)));
    next[collection] = [
      ...current,
      ...extra[key].items.filter(
        (row) => !known.has(rowIdentity(collection, row)),
      ),
    ];
  }
  return next as T;
}

const URGENT_RANK: Record<string, number> = { safety: 0, policy_review: 1 };
/**
 * The attention list: open safety reviews, then personal-review requests,
 * each oldest (most overdue) first; every other item keeps its order after
 * them.
 */
export function urgentFirst<
  T extends { created_at?: string | Date; data?: { category?: string } },
>(exceptions: T[]): T[] {
  const rank = (e: T) => URGENT_RANK[e.data?.category ?? ""] ?? 2;
  return exceptions
    .map((e, i) => ({ e, i }))
    .sort(
      (x, y) =>
        rank(x.e) - rank(y.e) ||
        (rank(x.e) < 2
          ? +new Date(x.e.created_at ?? 0) - +new Date(y.e.created_at ?? 0)
          : 0) ||
        x.i - y.i,
    )
    .map(({ e }) => e);
}
