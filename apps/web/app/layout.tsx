import type { Metadata } from "next";
import { AcquisitionConsent } from "../components/acquisition";
import "./globals.css";
import "./nutrition.css";
import "./platform-settings.css";
import "./trainer-design.css";
import "./meal-capture.css";
import "./coach-site.css";
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
  title: "Trainer Brain — Your coaching, amplified",
  description:
    "Build a digital coaching practice around your own methods, judgment and brand.",
};
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
