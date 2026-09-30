import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@trainer/domain", "@trainer/contracts"],
  experimental: {
    // API calls are forwarded by proxy.ts. Next's default forwarding timeout
    // (30 s) cut interactive model requests that are allowed longer: a meal
    // week has 150 s and a nutrition evaluation up to 300 s
    // (packages/providers/src/nutrition.ts nutritionBudget).
    proxyTimeout: 330_000,
  },
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
