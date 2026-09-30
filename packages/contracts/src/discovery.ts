import { z } from "zod";
import { INDEXABLE_MARKETING_PAGES, isHiddenSpecialty } from "./marketing.ts";
import {
  BRAND_ASSETS,
  BRAND_COLORS,
  BRAND_COPY,
  BRAND_NAME,
  usesBrandIdentity,
} from "./brand.ts";

/**
 * Public discovery vocabulary and route policy shared by the API (sitemaps,
 * directory) and the web app (robots.txt, page metadata, directory filters).
 */

export const DIRECTORY_PATH = "/coaches";
export const DIRECTORY_PAGE_SIZE = 24;

/**
 * Platform marketing pages that search engines may index, derived from the
 * marketing registry (packages/contracts/src/marketing.ts) so the sitemap,
 * robots metadata and pages never drift apart.
 */
export const PUBLIC_MARKETING_PATHS: readonly string[] =
  INDEXABLE_MARKETING_PAGES.map((page) => page.path);

/**
 * First path segments of private app and authentication routes. They are
 * disallowed in robots.txt, rendered with noindex metadata and sent with
 * X-Robots-Tag. API routes live under "/api/".
 */
export const PRIVATE_ROUTE_SEGMENTS = [
  "app",
  "trainer",
  "admin",
  "login",
  "signup",
  "join",
  "join-coach",
  "forgot-password",
  "reset-password",
  "verify-email",
  "magic-link",
  "recover-authenticator",
  "sign-in",
  "account-recovery",
  "verify-email-change",
] as const;
export const API_ROUTE_PREFIX = "/api/";

const privateSegments = new Set<string>([...PRIVATE_ROUTE_SEGMENTS, "api"]);

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

/**
 * Top-level paths that a connected coach domain serves from the platform (or
 * refuses) instead of the coach's website. apps/web/host-proxy.ts
 * customHostPath() decides, and a test keeps the two in step. Note that the
 * bare "/coach" and "/join-coach" addresses do reach the coach's website; only
 * their subtrees are special. A coach page with one of these addresses is
 * reachable on that domain only under /coach/<slug>/<page>.
 */
export const COACH_HOST_PLATFORM_SEGMENTS = [
  "app",
  "trainer",
  "admin",
  "login",
  "signup",
  "join",
  "forgot-password",
  "reset-password",
  "verify-email",
  "magic-link",
  "recover-authenticator",
  "terms",
  "privacy",
  "ai-disclosure",
] as const;
const coachHostPlatformSegments = new Set<string>(COACH_HOST_PLATFORM_SEGMENTS);

/** The address of a coach website page on the coach's connected domain. */
export function coachHostPagePath(tenantSlug: string, page: string): string {
  return coachHostPlatformSegments.has(page)
    ? `/coach/${tenantSlug}/${page}`
    : `/${page}`;
}

/**
 * robots.txt rules for the private routes. A plain rule matches by prefix, so
 * "/app" would also close a coach page called "/approach". Each segment is
 * closed as a subtree ("/app/"), and exactly ("$" anchors the end, RFC 9309)
 * and with a query string ("/app?") wherever that address is private: on a
 * coach domain a bare address the proxy gives to the coach's website stays
 * open.
 */
export function privateRouteDisallowRules(coachHost: boolean): string[] {
  return [
    API_ROUTE_PREFIX,
    ...PRIVATE_ROUTE_SEGMENTS.flatMap((segment) =>
      coachHost && !coachHostPlatformSegments.has(segment)
        ? [`/${segment}/`]
        : [`/${segment}$`, `/${segment}/`, `/${segment}?`],
    ),
  ];
}

export type RobotsPolicy = {
  rules: { userAgent: string; allow: string[]; disallow: string[] };
  sitemap: string;
};

/**
 * The same private routes are closed on the platform and on coach domains.
 * The directory needs no rule on a coach domain: the proxy maps "/coaches"
 * there to the coach's own website, so it is the coach's page.
 */
export function robotsPolicy(origin: string, coachHost: boolean): RobotsPolicy {
  const base = new URL(origin).origin;
  return {
    rules: {
      userAgent: "*",
      allow: ["/"],
      disallow: privateRouteDisallowRules(coachHost),
    },
    sitemap: `${base}${SITEMAP_PATH}`,
  };
}

export const SITEMAP_PATH = "/sitemap.xml";
/** Further sitemap files when the platform needs a sitemap index. */
export const sitemapFilePath = (page: number) => `/sitemaps/${page}.xml`;
/** Sitemaps stay well below the 50,000 URL protocol limit. */
export const SITEMAP_URL_LIMIT = 45000;
/**
 * Coach websites per platform sitemap file. A website has at most
 * 1 + 4 standard sections + 100 custom pages = 105 addresses, so a file holds
 * at most 400 * 105 + marketing pages, below SITEMAP_URL_LIMIT.
 */
export const SITEMAP_COACHES_PER_FILE = 400;
export const COACH_SITE_MAX_URLS = 105;

export type SitemapEntry = { url: string; lastModified?: string };

const escapeXmlText = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

/** A sitemaps.org <urlset> document. */
export function sitemapUrlSetXml(entries: readonly SitemapEntry[]): string {
  const urls = entries.map(
    (entry) =>
      `<url>\n<loc>${escapeXmlText(entry.url)}</loc>\n` +
      (entry.lastModified
        ? `<lastmod>${escapeXmlText(entry.lastModified)}</lastmod>\n`
        : "") +
      `</url>\n`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${SITEMAP_NS}">\n${urls.join("")}</urlset>\n`;
}

/** A sitemaps.org <sitemapindex> document naming each sitemap file. */
export function sitemapIndexXml(locations: readonly string[]): string {
  const files = locations.map(
    (loc) => `<sitemap>\n<loc>${escapeXmlText(loc)}</loc>\n</sitemap>\n`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="${SITEMAP_NS}">\n${files.join("")}</sitemapindex>\n`;
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

/**
 * The specialties coaches and visitors may choose from: every directory
 * specialty except the hidden ones (HIDDEN_SPECIALTIES in marketing.ts).
 * Hidden ids stay in DIRECTORY_SPECIALTIES so stored listings and requests
 * that already use them still validate; they are just not offered or shown.
 */
export const OFFERED_DIRECTORY_SPECIALTIES = DIRECTORY_SPECIALTIES.filter(
  (s) => !isHiddenSpecialty(s.id),
);

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

/** The platform's install colours: the trainsyou paper and ink. */
export const PLATFORM_THEME = {
  background: BRAND_COLORS.paper,
  theme: BRAND_COLORS.ink,
} as const;

/** Where the API serves the platform's generated icons (initials of the name). */
export const PLATFORM_ICON_BASE = "/api/v1/public/platform/icon/";
/**
 * The platform's icons: the supplied trainsyou icons when the platform name
 * is the brand, otherwise PNGs the API draws from the configured name's
 * initials, so a renamed platform never shows another name's logo.
 */
export function platformIcons(appName: string = BRAND_NAME) {
  if (usesBrandIdentity(appName))
    return {
      icon192: BRAND_ASSETS.icon192 as string,
      icon512: BRAND_ASSETS.icon512 as string,
      // The relay mark sits inside the maskable safe zone of an opaque Pace
      // square, so one file serves both purposes.
      maskable512: BRAND_ASSETS.icon512 as string,
      apple180: BRAND_ASSETS.appleTouchIcon as string,
      favicon: BRAND_ASSETS.faviconIco as string,
      faviconSvg: BRAND_ASSETS.faviconSvg as string | null,
    };
  return {
    icon192: PLATFORM_ICON_BASE + "192.png",
    icon512: PLATFORM_ICON_BASE + "512.png",
    maskable512: PLATFORM_ICON_BASE + "maskable-512.png",
    apple180: PLATFORM_ICON_BASE + "180.png",
    favicon: PLATFORM_ICON_BASE + "192.png",
    faviconSvg: null as string | null,
  };
}
/**
 * Installed-app launch marker. Every install manifest opens its start page
 * with `?source=pwa` and its shortcuts with `?source=shortcut`, so a launch
 * from the home screen can be told apart from a visit (the query string is
 * ignored by the app itself).
 */
export const PWA_SOURCE = "pwa";
export const PWA_SHORTCUT_SOURCE = "shortcut";
/** App-store categories for every install manifest. */
export const APP_CATEGORIES = ["health", "fitness", "lifestyle"] as const;
/**
 * An open window of the installed app is reused when it is launched again
 * (home-screen icon, shortcut or notification), instead of a second copy.
 */
export const APP_LAUNCH_HANDLER: {
  client_mode: Array<"navigate-existing" | "auto">;
} = { client_mode: ["navigate-existing", "auto"] };

/**
 * The platform install manifest, served by apps/web/app/manifest.ts at
 * /manifest.webmanifest and by the API to anonymous visitors. The name is
 * the configured APP_NAME (trainsyou when unset); see platformIcons. Its
 * `id` is "/app", the id browsers derived from the earlier start_url, so
 * apps installed before the launch marker keep their identity.
 */
export function platformManifest(appName: string = BRAND_NAME) {
  const name = appName.trim() || BRAND_NAME;
  const icons = platformIcons(name);
  const icon = (src: string, sizes: string, purpose: "any" | "maskable") => ({
    src,
    sizes,
    type: "image/png",
    purpose,
  });
  return {
    id: "/app",
    name,
    short_name: shortAppName(name, 15),
    ...(usesBrandIdentity(name) ? { description: BRAND_COPY.descriptor } : {}),
    start_url: `/app?source=${PWA_SOURCE}`,
    scope: "/",
    display: "standalone",
    background_color: PLATFORM_THEME.background,
    theme_color: PLATFORM_THEME.theme,
    lang: "en",
    dir: "ltr",
    categories: [...APP_CATEGORIES],
    launch_handler: APP_LAUNCH_HANDLER,
    icons: [
      icon(icons.icon192, "192x192", "any"),
      icon(icons.icon512, "512x512", "any"),
      icon(icons.maskable512, "512x512", "maskable"),
    ],
  };
}

/** The home-screen shortcuts a member app can offer (long-press the icon). */
export const APP_SHORTCUTS = {
  workout: {
    name: "Today's workout",
    short_name: "Workout",
    description: "Open today's session",
    path: "/app/program",
  },
  meal: {
    name: "Log a meal",
    short_name: "Log a meal",
    description: "A photo, a barcode or a note",
    path: "/app/nutrition/log",
  },
  chat: {
    name: "Coach chat",
    short_name: "Chat",
    description: "Message your coach",
    path: "/app/chat",
  },
  booking: {
    name: "Book a session",
    short_name: "Book",
    description: "Book time with your coach",
    path: "/app/bookings",
  },
} as const;
export type AppShortcut = keyof typeof APP_SHORTCUTS;
/**
 * The same shortcuts for a member whose saved language is Arabic (the
 * manifest's `lang`), in the words the member app uses
 * (apps/web/lib/i18n/messages/nav.ts).
 */
export const APP_SHORTCUTS_AR: Record<
  AppShortcut,
  { name: string; short_name: string; description: string }
> = {
  workout: {
    name: "تمرين اليوم",
    short_name: "التمرين",
    description: "فتح جلسة اليوم",
  },
  meal: {
    name: "تسجيل وجبة",
    short_name: "تسجيل وجبة",
    description: "صورة أو باركود أو ملاحظة",
  },
  chat: {
    name: "محادثة المدرب",
    short_name: "المحادثة",
    description: "مراسلة مدربك",
  },
  booking: {
    name: "حجز جلسة",
    short_name: "حجز",
    description: "حجز موعد مع مدربك",
  },
};

/**
 * Member install icon files and their pixel sizes. Shortcut icons draw the
 * feature's symbol on the coach's primary colour.
 */
export const APP_ICON_FILES = {
  "180.png": { size: 180, variant: "apple" },
  "192.png": { size: 192, variant: "any" },
  "512.png": { size: 512, variant: "any" },
  "maskable-512.png": { size: 512, variant: "maskable" },
  "shortcut-workout-96.png": {
    size: 96,
    variant: "shortcut",
    shortcut: "workout",
  },
  "shortcut-meal-96.png": { size: 96, variant: "shortcut", shortcut: "meal" },
  "shortcut-chat-96.png": { size: 96, variant: "shortcut", shortcut: "chat" },
  "shortcut-booking-96.png": {
    size: 96,
    variant: "shortcut",
    shortcut: "booking",
  },
} as const satisfies Record<
  string,
  {
    size: number;
    variant: "any" | "apple" | "maskable" | "shortcut";
    shortcut?: AppShortcut;
  }
>;
export type AppIconFile = keyof typeof APP_ICON_FILES;

/** What the member app manifest is built from (apps/api/src/discovery.ts). */
export type MemberManifestInput = {
  slug: string;
  name: string;
  role: string;
  primary: string;
  surface: string;
  /** The member's saved language; English otherwise. */
  language?: string | null;
  /** Coaching features on for this member (shortcuts only for these). */
  features: { nutrition: boolean; bookings: boolean };
  /** The address of one icon file (per-workspace key and revision). */
  icon: (file: AppIconFile) => string;
};
/** A short plain description that names the coach. */
export function memberAppDescription(
  name: string,
  nutrition: boolean,
  language: "en" | "ar" = "en",
) {
  // U+2068/U+2069 keep a Latin coach name in place inside the Arabic line.
  if (language === "ar")
    return nutrition
      ? `تدريبك ووجباتك ورسائلك مع \u2068${name}\u2069.`
      : `تدريبك ورسائلك مع \u2068${name}\u2069.`;
  return nutrition
    ? `Your training, meals and messages with ${name}.`
    : `Your training and messages with ${name}.`;
}
/**
 * The coach-branded install manifest for a signed-in member. One stable id
 * per coach (`/coach/<slug>`, the same as the coach website's manifest), so
 * two coaches' apps install side by side and a reinstall is the same app.
 * Subscribers open Today; the coach's team opens the trainer workspace and
 * gets no shortcuts (the trainer workspace is unchanged).
 */
export function memberAppManifest(input: MemberManifestInput) {
  const subscriber = input.role === "subscriber";
  const lang = input.language === "ar" ? "ar" : "en";
  const icon = (
    file: AppIconFile,
    sizes: string,
    purpose: "any" | "maskable",
  ) => ({ src: input.icon(file), sizes, type: "image/png", purpose });
  const shortcuts: AppShortcut[] = subscriber
    ? [
        "workout",
        ...(input.features.nutrition ? (["meal"] as const) : []),
        "chat",
        ...(input.features.bookings ? (["booking"] as const) : []),
      ]
    : [];
  return {
    id: `/coach/${input.slug}`,
    name: input.name,
    short_name: shortAppName(input.name),
    description: subscriber
      ? memberAppDescription(input.name, input.features.nutrition, lang)
      : `The coaching workspace of ${input.name}.`,
    start_url: `${subscriber ? "/app" : "/trainer"}?source=${PWA_SOURCE}`,
    scope: "/",
    display: "standalone",
    background_color: input.surface,
    theme_color: input.primary,
    lang,
    dir: lang === "ar" ? "rtl" : "ltr",
    categories: [...APP_CATEGORIES],
    launch_handler: APP_LAUNCH_HANDLER,
    icons: [
      icon("192.png", "192x192", "any"),
      icon("512.png", "512x512", "any"),
      icon("maskable-512.png", "512x512", "maskable"),
    ],
    ...(shortcuts.length
      ? {
          shortcuts: shortcuts.map((id) => {
            const { path, ...english } = APP_SHORTCUTS[id];
            const shortcut = lang === "ar" ? APP_SHORTCUTS_AR[id] : english;
            return {
              ...shortcut,
              url: `${path}?source=${PWA_SHORTCUT_SOURCE}`,
              icons: [
                {
                  src: input.icon(`shortcut-${id}-96.png`),
                  sizes: "96x96",
                  type: "image/png",
                  purpose: "any",
                },
              ],
            };
          }),
        }
      : {}),
  };
}

/**
 * The install manifest of a launched coach website
 * (`/api/v1/public/sites/<slug>/manifest.webmanifest`). It has the same id
 * as the member app of that coach, so installing from the website and
 * installing after sign-in give one app, which opens the member app.
 */
export function coachSiteManifest(input: {
  slug: string;
  name: string;
  primary: string;
  surface: string;
  language?: string | null;
}) {
  const lang = input.language === "ar" ? "ar" : "en";
  const base = `/api/v1/public/sites/${input.slug}/icon/`;
  const icon = (file: string, sizes: string, purpose: "any" | "maskable") => ({
    src: base + file,
    sizes,
    type: "image/png",
    purpose,
  });
  return {
    id: `/coach/${input.slug}`,
    name: input.name,
    short_name: shortAppName(input.name),
    description:
      lang === "ar"
        ? `تدريب شخصي مع \u2068${input.name}\u2069.`
        : `Personal coaching with ${input.name}.`,
    start_url: `/app?source=${PWA_SOURCE}`,
    scope: "/",
    display: "standalone",
    background_color: input.surface,
    theme_color: input.primary,
    lang,
    dir: lang === "ar" ? "rtl" : "ltr",
    categories: [...APP_CATEGORIES],
    launch_handler: APP_LAUNCH_HANDLER,
    icons: [
      icon("192", "192x192", "any"),
      icon("512", "512x512", "any"),
      icon("maskable-512", "512x512", "maskable"),
    ],
  };
}
