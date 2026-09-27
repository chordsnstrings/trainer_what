import type { Metadata, Viewport } from "next";
import { AcquisitionConsent } from "../components/acquisition";
import { documentLanguage } from "../components/public-website";
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
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  // Real PNG sizes for install surfaces; iOS ignores SVG home-screen icons.
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
  title: "Trainer Brain — Your coaching, amplified",
  description:
    "Build a digital coaching practice around your own methods, judgment and brand.",
};
export const viewport: Viewport = { themeColor: "#254d42" };
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  // English and left to right unless the visitor chose Arabic (?lang= or the
  // device cookie mirrored from a member's saved language), or a coach
  // website is written in Arabic. The workspace applies the member's saved
  // language after sign-in (components/document-direction.tsx).
  const { lang, dir } = await documentLanguage();
  return (
    <html lang={lang} dir={dir}>
      <body>
        {children}
        <AcquisitionConsent />
      </body>
    </html>
  );
}
