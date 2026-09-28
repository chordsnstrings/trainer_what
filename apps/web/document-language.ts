// Document language and direction. Shared by proxy.ts, the root layout and
// client components, so it has no server-only or browser-only imports.
//
// English is the product language; Arabic is supported for layout (right to
// left) and for any Arabic text already present. Only these two values are
// ever written into the page, a cookie or a header.
export const LANGUAGES = ["en", "ar"] as const;
export type Language = (typeof LANGUAGES)[number];
export type Direction = "ltr" | "rtl";
/** The visitor's explicit device choice. Only `?lang=` sets it (proxy.ts). */
export const LANGUAGE_COOKIE = "trainer_lang";
/**
 * The signed-in member's saved language, mirrored by the workspace so the
 * next server render of the workspace starts in it. It is a preference, not
 * an explicit choice: it never overrides `?lang=`, the device choice or a
 * coach website's own language on public pages.
 */
export const MEMBER_LANGUAGE_COOKIE = "trainer_member_lang";
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
export type LanguageSource = "query" | "cookie" | "site" | "member" | "default";
/**
 * Picks the first valid source; invalid values are ignored at every step.
 *
 * Public pages: an explicit `?lang=` on this request, then the device choice
 * cookie, then the coach website's own language, then the signed-in member's
 * mirrored language, then English.
 *
 * Signed-in workspace pages (`workspace: true`): the member's saved language
 * decides there (the workspace applies it after sign-in), so its mirror comes
 * first and the server render matches; then `?lang=`, the device choice and
 * English for a member whose language is not mirrored yet.
 */
export function resolveDocumentLanguage(input: {
  query?: unknown;
  cookie?: unknown;
  site?: unknown;
  member?: unknown;
  workspace?: boolean;
}): { lang: Language; dir: Direction; source: LanguageSource } {
  const sources: Array<[LanguageSource, unknown]> = input.workspace
    ? [
        ["member", input.member],
        ["query", input.query],
        ["cookie", input.cookie],
      ]
    : [
        ["query", input.query],
        ["cookie", input.cookie],
        ["site", input.site],
        ["member", input.member],
      ];
  const pick = sources
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
/** Signed-in workspace addresses (trainer, follower and Super admin). */
export function isWorkspacePath(path: string | null | undefined) {
  return /^\/(trainer|app|admin)(\/|$)/.test(path ?? "");
}
/**
 * The document language of one page request. On a coach website without an
 * explicit choice it asks for the website's language (`siteLanguage` returns
 * the website's language, English for a website without one, or undefined
 * when the website cannot be loaded).
 */
export async function pageLanguage(input: {
  path: string | null | undefined;
  query?: unknown;
  cookie?: unknown;
  member?: unknown;
  siteLanguage: (slug: string) => Promise<unknown>;
}) {
  const { path, query, cookie, member } = input;
  const slug = coachSiteSlug(path);
  if (!slug)
    return resolveDocumentLanguage({
      query,
      cookie,
      member,
      workspace: isWorkspacePath(path),
    });
  const explicit = resolveDocumentLanguage({ query, cookie });
  if (explicit.source !== "default") return explicit;
  const site = await input.siteLanguage(slug).catch(() => undefined);
  return resolveDocumentLanguage({ site, member });
}
/** A `Set-Cookie` value for a language cookie (client or server). */
export function languageCookie(
  language: Language,
  secure: boolean,
  name: string = LANGUAGE_COOKIE,
) {
  return `${name}=${language}; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
/** Reads a language cookie from a `Cookie` header or `document.cookie`. */
export function languageFromCookieHeader(
  header: string | null | undefined,
  name: string = LANGUAGE_COOKIE,
) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return parseLanguage(rest.join("="));
  }
  return null;
}
