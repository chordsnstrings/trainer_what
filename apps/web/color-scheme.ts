// A member's appearance choice (docs/features/dark-mode.md). Shared by the
// catch-all page (server) and client components, so it has no server-only or
// browser-only imports.
//
// Subscriber surfaces (the member app, the coach website and the coach's
// sign-in and joining pages) follow the device's colour scheme unless the
// member chose Light or Dark in Profile and settings > Display. The choice
// is saved per member (with the other member preferences) and mirrored into
// a cookie, so the next server render and the first paint on this device
// already use it. Only these three values are ever written into the page or
// the cookie. The marketing site, the directory and the platform's own
// sign-in pages stay light, and the trainer workspace keeps following the
// device.
export const COLOR_SCHEMES = ["system", "light", "dark"] as const;
export type ColorSchemeChoice = (typeof COLOR_SCHEMES)[number];
export const DEFAULT_COLOR_SCHEME: ColorSchemeChoice = "system";
/** The mirrored choice on this device. */
export const MEMBER_SCHEME_COOKIE = "trainer_member_scheme";
/** One year; a display preference, not an identity. */
export const COLOR_SCHEME_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function parseColorScheme(value: unknown): ColorSchemeChoice | null {
  return typeof value === "string" &&
    (COLOR_SCHEMES as readonly string[]).includes(value)
    ? (value as ColorSchemeChoice)
    : null;
}
/** A `Set-Cookie` value for the mirrored choice (client or server). */
export function colorSchemeCookie(choice: ColorSchemeChoice, secure: boolean) {
  return `${MEMBER_SCHEME_COOKIE}=${choice}; Path=/; Max-Age=${COLOR_SCHEME_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
/** Reads the mirrored choice from a `Cookie` header or `document.cookie`. */
export function colorSchemeFromCookieHeader(header: string | null | undefined) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === MEMBER_SCHEME_COOKIE) return parseColorScheme(rest.join("="));
  }
  return null;
}
/**
 * The browser colour (`theme-color`) for a subscriber surface: the coach's
 * primary colour in light (as in the coach's install manifests) and the dark
 * top bar colour in dark. "system" gives one copy per device scheme; an
 * explicit choice gives one copy for both.
 */
export function themeColorsFor(
  choice: ColorSchemeChoice,
  colors: { light: string; dark: string },
): Array<{ media?: string; color: string }> {
  if (choice === "light") return [{ color: colors.light }];
  if (choice === "dark") return [{ color: colors.dark }];
  return [
    { media: "(prefers-color-scheme: light)", color: colors.light },
    { media: "(prefers-color-scheme: dark)", color: colors.dark },
  ];
}
