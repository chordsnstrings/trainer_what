import type { Metadata, Viewport } from "next";
import { AcquisitionConsent } from "../components/acquisition";
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
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <AcquisitionConsent />
      </body>
    </html>
  );
}
