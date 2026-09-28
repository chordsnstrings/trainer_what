import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AcquisitionConsent } from "../components/acquisition";
import { documentLanguage } from "../components/public-website";
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
import "./marketing.css";

// The trainsyou typeface: Inter, self-hosted by Next at build time (no
// browser request goes to Google). "Inter Display" is not on Google Fonts;
// display sizes use Inter, with Arial as the fallback (globals.css
// --ty-font-body / --ty-font-display). Trainer-branded surfaces keep their
// Design Studio font stacks.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  fallback: ["Arial", "sans-serif"],
});

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
  return (
    <html lang={lang} dir={dir} className={inter.variable}>
      <body>
        {children}
        <AcquisitionConsent marketingPaths={MARKETING_SITE_PATHS} />
      </body>
    </html>
  );
}
