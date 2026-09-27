import { z } from "zod";

/**
 * Public discovery vocabulary and route policy shared by the API (sitemaps,
 * directory) and the web app (robots.txt, page metadata, directory filters).
 */

export const DIRECTORY_PATH = "/coaches";
export const DIRECTORY_PAGE_SIZE = 24;

/** Platform marketing pages that search engines may index. */
export const PUBLIC_MARKETING_PATHS = [
  "/",
  "/how-it-works",
  "/demo",
  "/pricing",
  "/faq",
  "/terms",
  "/privacy",
  "/ai-disclosure",
] as const;

/**
 * Private app, authentication and API routes. They are disallowed in
 * robots.txt, rendered with noindex metadata and sent with X-Robots-Tag.
 * Robots rules match by prefix, so "/app" also covers "/app/nutrition".
 */
export const PRIVATE_ROUTE_PREFIXES = [
  "/api/",
  "/app",
  "/trainer",
  "/admin",
  "/login",
  "/signup",
  "/join/",
  "/join-coach/",
  "/forgot-password",
  "/reset-password/",
  "/verify-email/",
  "/magic-link",
  "/recover-authenticator",
] as const;

const privateSegments = new Set(
  PRIVATE_ROUTE_PREFIXES.map((prefix) => prefix.split("/")[1]),
);

/** True for a private app, auth or API path (exact segment match). */
export function isPrivatePath(path: string): boolean {
  const first = path.split(/[?#]/)[0].split("/")[1] ?? "";
  return privateSegments.has(first);
}

/**
 * Whether a platform-host page may be indexed. Coach website pages are decided
 * by whether the site is published; every other path is noindex.
 */
export function isIndexablePlatformPath(path: string): boolean {
  const clean = path.split(/[?#]/)[0].replace(/(.)\/+$/, "$1") || "/";
  return (
    (PUBLIC_MARKETING_PATHS as readonly string[]).includes(clean) ||
    clean === DIRECTORY_PATH
  );
}

export type RobotsPolicy = {
  rules: { userAgent: string; allow: string[]; disallow: string[] };
  sitemap: string;
};

/** The same private routes are closed on the platform and on coach domains. */
export function robotsPolicy(origin: string, coachHost: boolean): RobotsPolicy {
  const base = new URL(origin).origin;
  return {
    rules: {
      userAgent: "*",
      allow: ["/"],
      disallow: [
        ...PRIVATE_ROUTE_PREFIXES,
        // The directory exists only on the platform address.
        ...(coachHost ? [DIRECTORY_PATH] : []),
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}

export const DIRECTORY_SPECIALTIES = [
  { id: "strength", label: "Strength training" },
  { id: "weight_loss", label: "Weight loss" },
  { id: "muscle_gain", label: "Muscle gain" },
  { id: "general_fitness", label: "General fitness" },
  { id: "endurance", label: "Running and endurance" },
  { id: "conditioning", label: "HIIT and conditioning" },
  { id: "functional", label: "Functional and hybrid fitness" },
  { id: "mobility", label: "Mobility and flexibility" },
  { id: "yoga", label: "Yoga" },
  { id: "pilates", label: "Pilates" },
  { id: "combat", label: "Boxing and martial arts" },
  { id: "sports_performance", label: "Sports performance" },
  { id: "pre_postnatal", label: "Pre and postnatal fitness" },
  { id: "active_ageing", label: "Active ageing" },
  { id: "nutrition_habits", label: "Nutrition habits" },
] as const;

export const DIRECTORY_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ar", label: "Arabic" },
  { id: "hi", label: "Hindi" },
  { id: "ur", label: "Urdu" },
  { id: "ml", label: "Malayalam" },
  { id: "ta", label: "Tamil" },
  { id: "tl", label: "Filipino" },
  { id: "bn", label: "Bengali" },
  { id: "fa", label: "Persian" },
  { id: "tr", label: "Turkish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "es", label: "Spanish" },
  { id: "it", label: "Italian" },
  { id: "pt", label: "Portuguese" },
  { id: "ru", label: "Russian" },
  { id: "zh", label: "Chinese" },
] as const;

export type DirectorySpecialty = (typeof DIRECTORY_SPECIALTIES)[number]["id"];
export type DirectoryLanguage = (typeof DIRECTORY_LANGUAGES)[number]["id"];
const specialtyIds = DIRECTORY_SPECIALTIES.map((s) => s.id) as [
  DirectorySpecialty,
  ...DirectorySpecialty[],
];
const languageIds = DIRECTORY_LANGUAGES.map((l) => l.id) as [
  DirectoryLanguage,
  ...DirectoryLanguage[],
];
export const directorySpecialtySchema = z.enum(specialtyIds);
export const directoryLanguageSchema = z.enum(languageIds);

/** Owner listing choices. Listing needs at least one specialty and language. */
export const directoryListingSchema = z
  .object({
    version: z.number().int().min(0),
    listed: z.boolean(),
    specialties: z.array(directorySpecialtySchema).max(6),
    languages: z.array(directoryLanguageSchema).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    for (const key of ["specialties", "languages"] as const)
      if (new Set(value[key]).size !== value[key].length)
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Choose each option once.",
        });
    if (value.listed && !value.specialties.length)
      context.addIssue({
        code: "custom",
        path: ["specialties"],
        message: "Choose at least one specialty to be listed.",
      });
    if (value.listed && !value.languages.length)
      context.addIssue({
        code: "custom",
        path: ["languages"],
        message: "Choose at least one coaching language to be listed.",
      });
  });
export type DirectoryListingInput = z.infer<typeof directoryListingSchema>;

const optionalFilter = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : v),
    schema.optional(),
  );
/** Public directory search. Unknown filters are rejected, never ignored. */
export const directorySearchSchema = z
  .object({
    q: z.preprocess(
      (v) => (typeof v === "string" ? v.trim() : v),
      z.string().max(80).optional(),
    ),
    specialty: optionalFilter(directorySpecialtySchema),
    language: optionalFilter(directoryLanguageSchema),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export type DirectorySearch = z.infer<typeof directorySearchSchema>;

/** Home-screen label: the leading whole words that fit, else a clean cut. */
export function shortAppName(name: string, max = 12): string {
  const clean = name.trim().replace(/\s+/g, " ");
  const length = (value: string) => Array.from(value).length;
  if (length(clean) <= max) return clean;
  let label = "";
  for (const word of clean.split(" ")) {
    const next = label ? label + " " + word : word;
    if (length(next) > max) break;
    label = next;
  }
  return label || Array.from(clean).slice(0, max).join("");
}

/** Up to two initials for a generated icon; letters only, never markup. */
export function appInitials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((word) => Array.from(word).find((c) => /\p{L}|\p{N}/u.test(c)) ?? "")
    .filter(Boolean);
  return (letters.length ? letters.slice(0, 2).join("") : "•").toUpperCase();
}

export const PLATFORM_THEME = {
  background: "#f7f8f4",
  theme: "#254d42",
} as const;

/** The platform install manifest; public/manifest.webmanifest must match it. */
export function platformManifest(appName = "Trainer Brain") {
  const name = appName.trim() || "Trainer Brain";
  return {
    name,
    short_name: shortAppName(name, 15),
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: PLATFORM_THEME.background,
    theme_color: PLATFORM_THEME.theme,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}

/** Member install icon files and their pixel sizes. */
export const APP_ICON_FILES = {
  "180.png": { size: 180, variant: "apple" },
  "192.png": { size: 192, variant: "any" },
  "512.png": { size: 512, variant: "any" },
  "maskable-512.png": { size: 512, variant: "maskable" },
} as const;
export type AppIconFile = keyof typeof APP_ICON_FILES;
