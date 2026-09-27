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
const collectionOf = (key: string) =>
  key.startsWith("records:") ? "records" : key;
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
