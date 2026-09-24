import type { Metadata } from "next";
import "./globals.css";
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
      <body>{children}</body>
    </html>
  );
}
