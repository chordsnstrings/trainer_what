/** Navigation intent only. Prices and eligibility always come from the current server offer. */
export function safeJoinReturn(value: string | null): string | null {
  if (!value || value.length > 1000 || /[\\\u0000-\u0020]/.test(value))
    return null;
  try {
    const url = new URL(value, "https://local.invalid");
    if (
      url.origin !== "https://local.invalid" ||
      !/^\/(join-coach\/[a-z0-9][a-z0-9-]{0,79}|join\/[a-zA-Z0-9_-]{1,256})$/.test(
        url.pathname,
      )
    )
      return null;
    const query = new URLSearchParams();
    const offer = url.searchParams.get("offer");
    if (offer && /^[a-zA-Z0-9_-]{1,128}$/.test(offer))
      query.set("offer", offer);
    if (url.searchParams.get("lang") === "ar") query.set("lang", "ar");
    return url.pathname + (query.size ? "?" + query : "");
  } catch {
    return null;
  }
}
const KEY = "trainsyou:joining-task";
export function rememberJoinReturn(
  value: string,
  storage: Pick<Storage, "setItem">,
  now = Date.now(),
) {
  const path = safeJoinReturn(value);
  if (path)
    storage.setItem(KEY, JSON.stringify({ path, expires: now + 3600000 }));
}
export function readJoinReturn(
  storage: Pick<Storage, "getItem">,
  now = Date.now(),
): string | null {
  try {
    const data = JSON.parse(storage.getItem(KEY) || "null");
    return data?.expires > now ? safeJoinReturn(data.path) : null;
  } catch {
    return null;
  }
}
export function joinedOfferDestination(
  path: string | null,
  coachSlug: string | undefined,
): string | null {
  const safe = safeJoinReturn(path);
  if (!safe || !coachSlug) return null;
  const url = new URL(safe, "https://local.invalid");
  if (url.pathname !== `/join-coach/${coachSlug}`) return null;
  const offer = url.searchParams.get("offer");
  return offer ? `/app/membership?offer=${encodeURIComponent(offer)}` : null;
}
