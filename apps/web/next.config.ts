import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@trainer/domain", "@trainer/contracts"],
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
