import type { NextConfig } from "next";
/**
 * One id per build: the build id and the release the service worker is
 * versioned by (`/sw.js?v=<release>`, docs/features/pwa.md). APP_RELEASE
 * (for example a commit) makes it readable; the build time keeps every
 * build distinct. It is baked into the bundle at build time.
 */
// Next evaluates this file again in its build workers; they inherit the
// value the first evaluation put in the environment, so it is one per build.
const release = (process.env.NEXT_PUBLIC_APP_RELEASE ||= [
  (process.env.APP_RELEASE ?? "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40),
  Date.now().toString(36),
]
  .filter(Boolean)
  .join("-"));
const config: NextConfig = {
  transpilePackages: ["@trainer/domain", "@trainer/contracts"],
  generateBuildId: async () => release,
  env: { NEXT_PUBLIC_APP_RELEASE: release },
  // API forwarding lives in proxy.ts so tenant-host provenance is signed on
  // the exact forwarded method/path/query before the request reaches the API.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
      {
        // Private app and sign-in routes are never search results. The same
        // list is disallowed in robots.txt (packages/contracts discovery.ts).
        source:
          "/:section(app|trainer|admin|login|signup|join|join-coach|forgot-password|reset-password|verify-email|magic-link|recover-authenticator|sign-in|account-recovery|verify-email-change)/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
