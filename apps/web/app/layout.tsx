import type { Metadata, Viewport } from "next";
import { AcquisitionConsent } from "../components/acquisition";
import { documentLanguage } from "../components/public-website";
import { publicPlatform } from "../components/marketing/platform";
import { MARKETING_PAGES } from "@trainer/contracts";

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
import "./marketing.css";
export async function generateMetadata(): Promise<Metadata> {
  // The platform name comes from the Super admin settings (APP_NAME).
  const { name } = await publicPlatform();
  return {
    ...metadata,
    title: { default: name, template: "%s | " + name },
    applicationName: name,
  };
}
// app/manifest.ts serves /manifest.webmanifest from the configured name;
// the icons are PLATFORM_ICON_BASE files drawn from its initials.
const metadata: Metadata = {
  // Real PNG sizes for install surfaces, drawn from the configured name's
  // initials; iOS ignores SVG home-screen icons.
  icons: {
    icon: [
      {
        url: "/api/v1/public/platform/icon/192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: { url: "/api/v1/public/platform/icon/180.png", sizes: "180x180" },
  },
  description:
    "Build an AI trainer from your own coaching method and sell personalised, day-by-day coaching to your followers, priced in AED.",
};
export const viewport: Viewport = { themeColor: "#254d42" };
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
    <html lang={lang} dir={dir}>
      <body>
        {children}
        <AcquisitionConsent marketingPaths={MARKETING_SITE_PATHS} />
      </body>
    </html>
  );
}
