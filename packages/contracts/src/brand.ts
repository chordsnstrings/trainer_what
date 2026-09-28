// The trainsyou corporate identity (CI kit v1.0, 25 September 2026; see
// docs/features/brand.md). The platform shows it when its name is the brand
// (the default, or APP_NAME set to trainsyou); a Super admin who sets another
// APP_NAME gets that name with the generated initials icons instead, so the
// logo never contradicts the configured name. Trainers' own websites and
// member apps keep their Design Studio branding and never use these assets.

/** Written as one lowercase word, pronounced "trains you". */
export const BRAND_NAME = "trainsyou";
export const BRAND_DOMAIN = "trainsyou.com";

/** Approved lines from the copy bank (brand-guide/brand-copy.md). */
export const BRAND_COPY = {
  line: "Your coaching. Beyond your hours.",
  descriptor: "Trainer-led AI coaching platform",
  audience: "For personal trainers",
  explanation:
    "Teach your own AI how you coach. Build a paid coaching offering around your methods, your identity and your standards.",
  introduction:
    "trainsyou helps personal trainers teach their own AI, keep control of how it coaches and build a paid offering around access to their expertise.",
  primaryAction: "Teach your AI",
  secondaryAction: "Explore the platform",
} as const;

/** The palette (sRGB) from digital/design-tokens.css. */
export const BRAND_COLORS = {
  white: "#FFFFFF",
  ink: "#171917",
  paper: "#F3F4F0",
  muted: "#616660",
  line: "#D9DDD5",
  /** "Pace": a background accent with ink text, never text on white. */
  pace: "#D5F24A",
  success: "#226044",
  warning: "#805400",
  error: "#AD3535",
} as const;

/** Served by apps/web from public/brand (supplied files, unmodified). */
const BASE = "/brand/";
export const BRAND_ASSETS = {
  lockupInk: BASE + "trainsyou-lockup-ink.svg",
  lockupWhite: BASE + "trainsyou-lockup-white.svg",
  lockupInkPng: BASE + "trainsyou-lockup-ink.png",
  lockupWhitePng: BASE + "trainsyou-lockup-white.png",
  wordmarkInk: BASE + "trainsyou-wordmark-ink.svg",
  wordmarkWhite: BASE + "trainsyou-wordmark-white.svg",
  symbolInk: BASE + "trainsyou-symbol-ink.svg",
  symbolWhite: BASE + "trainsyou-symbol-white.svg",
  faviconSvg: BASE + "favicon.svg",
  faviconIco: BASE + "favicon.ico",
  appleTouchIcon: BASE + "apple-touch-icon.png",
  icon192: BASE + "app-icon-192.png",
  icon512: BASE + "app-icon-512.png",
  shareImage: BASE + "social-share-1200x630.png",
} as const;
/** The lockup's intrinsic size (SVG viewBox 505 × 128). */
export const BRAND_LOCKUP_SIZE = { width: 505, height: 128 } as const;

/**
 * Whether a platform name is the trainsyou brand: "trainsyou", "TrainsYou",
 * "Trains You" or "trainsyou.com", ignoring case, spaces and the domain.
 */
export function usesBrandIdentity(name: string | null | undefined): boolean {
  const key = (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.com$/, "")
    .replace(/[\s._-]+/g, "");
  return key === BRAND_NAME;
}
