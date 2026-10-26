/**
 * The places the "Jump to" menu (Ctrl or Cmd + K) offers, and how a typed
 * query ranks them. Places come from the navigation as it is drawn, so the
 * menu offers exactly what this person's menu does. Pure, so it is unit
 * tested (tests/workspace-places.test.ts).
 */
export type Place = { label: string; href: string; group: string; detail?: string };

/** A link's place in the navigation for direction: top to bottom. */
export function placeIndex(hrefs: string[], path: string): number {
  let best = -1,
    length = -1;
  hrefs.forEach((href, i) => {
    const base = href.split(/[?#]/)[0];
    const inside = path === base || (base !== "/trainer" && base !== "/admin" && path.startsWith(base + "/"));
    if (inside && base.length > length) {
      best = i;
      length = base.length;
    }
  });
  return best;
}

/** Further down the menu arrives from below, further up from above. */
export function directionBetween(hrefs: string[], from: string, to: string): "forward" | "back" | "none" {
  const a = placeIndex(hrefs, from),
    b = placeIndex(hrefs, to);
  if (a < 0 || b < 0 || a === b) return "none";
  return b > a ? "forward" : "back";
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Places matching every word typed, best first: a label that starts with
 * the query, then a label word that does, then a match anywhere. An empty
 * query keeps the menu's order. */
export function rankPlaces(places: Place[], query: string): Place[] {
  const q = query.trim().toLowerCase();
  const unique = places.filter((p, i) => places.findIndex((o) => o.href === p.href) === i);
  if (!q) return unique;
  const terms = words(q);
  const score = (p: Place) => {
    const label = p.label.toLowerCase();
    const all = `${label} ${p.group.toLowerCase()} ${(p.detail ?? "").toLowerCase()}`;
    if (!terms.every((t) => all.includes(t))) return -1;
    if (label.startsWith(q)) return 3;
    if (words(label).some((w) => w.startsWith(terms[0]))) return 2;
    return label.includes(terms[0]) ? 1 : 0;
  };
  return unique
    .map((p, i) => ({ p, i, s: score(p) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.p);
}
