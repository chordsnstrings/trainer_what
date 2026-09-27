// Document language and direction. Shared by proxy.ts, the root layout and
// client components, so it has no server-only or browser-only imports.
//
// English is the product language; Arabic is supported for layout (right to
// left) and for any Arabic text already present. Only these two values are
// ever written into the page, a cookie or a header.
export const LANGUAGES = ["en", "ar"] as const;
export type Language = (typeof LANGUAGES)[number];
export type Direction = "ltr" | "rtl";
/** Device choice: set by `?lang=` or mirrored from a member's saved language. */
export const LANGUAGE_COOKIE = "trainer_lang";
/** One year; the choice is a display preference, not an identity. */
export const LANGUAGE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
/** Server-set request headers (proxy.ts removes client copies of x-trainer-*). */
export const LANGUAGE_HEADER = "x-trainer-lang";
export const PAGE_PATH_HEADER = "x-trainer-path";
export const DEFAULT_LANGUAGE: Language = "en";

export function parseLanguage(value: unknown): Language | null {
  return typeof value === "string" &&
    (LANGUAGES as readonly string[]).includes(value)
    ? (value as Language)
    : null;
}
export function directionOf(language: Language): Direction {
  return language === "ar" ? "rtl" : "ltr";
}
export type LanguageSource = "query" | "cookie" | "site" | "default";
/**
 * Public pages: an explicit `?lang=` on this request, then the device cookie,
 * then the coach website's own language, then English. Invalid values are
 * ignored at every step.
 */
export function resolveDocumentLanguage(input: {
  query?: unknown;
  cookie?: unknown;
  site?: unknown;
}): { lang: Language; dir: Direction; source: LanguageSource } {
  const pick = (
    [
      ["query", input.query],
      ["cookie", input.cookie],
      ["site", input.site],
    ] as const
  )
    .map(([source, value]) => [source, parseLanguage(value)] as const)
    .find(([, lang]) => lang !== null);
  const lang = pick?.[1] ?? DEFAULT_LANGUAGE;
  return { lang, dir: directionOf(lang), source: pick?.[0] ?? "default" };
}
/** The coach slug of a public coach website path (`/coach/<slug>/...`). */
export function coachSiteSlug(path: string | null | undefined) {
  const match = /^\/coach\/([a-z0-9][a-z0-9-]{0,39})(?:\/|$)/.exec(path ?? "");
  return match ? match[1] : null;
}
/** A `Set-Cookie` value for the device language (client or server). */
export function languageCookie(language: Language, secure: boolean) {
  return `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
/** Reads the device language from a `Cookie` header or `document.cookie`. */
export function languageFromCookieHeader(header: string | null | undefined) {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LANGUAGE_COOKIE) return parseLanguage(rest.join("="));
  }
  return null;
}
