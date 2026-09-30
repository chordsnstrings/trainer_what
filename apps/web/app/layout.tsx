import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AcquisitionConsent } from "../components/acquisition";
import { LAUNCH_COLOUR_SCRIPT } from "../components/pwa";
import {
  documentLanguage,
  memberMotionChoice,
} from "../components/public-website";
import { LocaleProvider } from "../lib/i18n/react";
import { publicPlatform } from "../components/marketing/platform";
import {
  BRAND_COLORS,
  BRAND_COPY,
  MARKETING_PAGES,
  platformIcons,
  usesBrandIdentity,
} from "@trainer/contracts";

const MARKETING_SITE_PATHS = MARKETING_PAGES.filter(
  (page) => page.renderer !== "workspace",
).map((page) => page.path);
import "./globals.css";
import "./nutrition.css";
import "./platform-settings.css";
import "./trainer-design.css";
import "./meal-capture.css";
import "./coach-site.css";
import "./account-settings.css";
import "./joining.css";
import "./governance.css";
import "./coach-directory.css";
import "./host-operations.css";
import "./provider-sandbox.css";
import "./programme.css";
import "./brain-plans.css";
import "./voice-session.css";
import "./web-address.css";
import "./phone-first.css";
import "./subscriber-public.css";
import "./pwa.css";
import "./appearance.css";
import "./member-screens.css";
import "./marketing.css";
import "./analytics-consent.css";
// Motion for subscriber surfaces: tokens, every animation and transition,
// and the reduced-motion rules (docs/features/motion.md).
import "./motion.css";

// The trainsyou typeface: Inter (SIL OFL 1.1, app/fonts/Inter-OFL.txt), the
// variable-weight files of @fontsource-variable/inter 5.3.0 kept in the
// repository, so neither the build nor the browser contacts Google. Latin is
// preloaded; Latin Extended is listed first but, by its unicode-range, only
// loads for a page that uses those letters. "Inter Display" is not bundled;
// display sizes use Inter, with metric-matched Arial as the fallback
// (globals.css --ty-font-body / --ty-font-display). Trainer-branded surfaces
// keep their Design Studio font stacks.
const interLatin = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
  adjustFontFallback: "Arial",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});
const interLatinExt = localFont({
  src: "./fonts/inter-latin-ext-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-inter-ext",
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
  ],
});
/** Sets --font-inter and --font-inter-ext on <html>. */
const fontVariables = `${interLatin.variable} ${interLatinExt.variable}`;

export async function generateMetadata(): Promise<Metadata> {
  // The platform name comes from the Super admin settings (APP_NAME), and is
  // trainsyou when it is not set.
  const { name } = await publicPlatform();
  const brand = usesBrandIdentity(name);
  const icons = platformIcons(name);
  return {
    title: { default: name, template: "%s | " + name },
    applicationName: name,
    // The trainsyou icons, or PNGs drawn from another configured name's
    // initials (iOS ignores SVG home-screen icons). Coach websites replace
    // these with their own (app/[[...path]]/page.tsx).
    icons: {
      icon: [
        ...(brand
          ? [{ url: icons.favicon, sizes: "32x32" }]
          : [{ url: icons.icon192, sizes: "192x192", type: "image/png" }]),
        ...(icons.faviconSvg
          ? [{ url: icons.faviconSvg, type: "image/svg+xml" }]
          : []),
      ],
      apple: { url: icons.apple180, sizes: "180x180" },
    },
    // Opened from the home screen, iOS shows the app full screen with a
    // light status bar and this title under the icon (the member app puts
    // the coach's name there once signed in: member-app-install.tsx).
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
    other: { "apple-mobile-web-app-capable": "yes" },
    // app/manifest.ts serves /manifest.webmanifest from the configured name.
    description: brand
      ? `${BRAND_COPY.line} ${BRAND_COPY.explanation}`
      : "Build an AI trainer from your own coaching method and sell personalised, day-by-day coaching to your followers, priced in AED.",
  };
}
// The browser chrome follows the platform canvas: paper in light, ink in
// dark. A coach website sets its own colour.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND_COLORS.paper },
    { media: "(prefers-color-scheme: dark)", color: BRAND_COLORS.ink },
  ],
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  // English and left to right unless the visitor chose Arabic (?lang= or the
  // device choice it set), a coach website is written in Arabic, or the
  // signed-in member saved Arabic (mirrored by the workspace, which applies it
  // after sign-in; see components/document-direction.tsx and pageLanguage in
  // document-language.ts for the precedence).
  const { lang, dir } = await documentLanguage();
  // The member's "Reduce motion" choice on this device keeps every
  // subscriber surface still from the first paint (app/motion.css).
  const reduceMotion = (await memberMotionChoice()) === "reduce";
  return (
    // The launch script may set the member app's first-paint colour on
    // <html> before React hydrates (docs/features/pwa.md).
    <html
      lang={lang}
      dir={dir}
      className={fontVariables}
      data-reduce-motion={reduceMotion ? "on" : undefined}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: LAUNCH_COLOUR_SCRIPT }} />
      </head>
      <body>
        {/* Subscriber text follows <html lang> (lib/i18n/react.tsx). */}
        <LocaleProvider locale={lang}>
          {children}
          <AcquisitionConsent marketingPaths={MARKETING_SITE_PATHS} />
        </LocaleProvider>
      </body>
    </html>
  );
}
