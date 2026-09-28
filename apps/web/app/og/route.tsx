import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import {
  BRAND_ASSETS,
  BRAND_COLORS,
  BRAND_COPY,
  BRAND_LOCKUP_SIZE,
  MARKETING_IMAGE_SIZE,
  brandText,
  marketingPage,
  usesBrandIdentity,
} from "@trainer/contracts";
import { publicPlatform } from "../../components/marketing/platform";

// The social preview of a marketing page (Open Graph and Twitter), laid out
// like the supplied trainsyou share card: the lockup, the page's eyebrow and
// H1 on white, and the relay mark on a Pace panel. The brand's home page uses
// the supplied card itself (marketingImage). Another configured APP_NAME gets
// its name and initials instead of the trainsyou artwork. Unknown paths get
// the home page's preview.

const svgCache = new Map<string, string>();
/** A public/brand SVG as a data URI (the web process runs from apps/web). */
async function brandSvg(path: string): Promise<string | null> {
  if (svgCache.has(path)) return svgCache.get(path)!;
  for (const root of [process.cwd(), join(process.cwd(), "apps/web")]) {
    try {
      const svg = await readFile(join(root, "public", path));
      const uri = "data:image/svg+xml;base64," + svg.toString("base64");
      svgCache.set(path, uri);
      return uri;
    } catch {
      // Try the next root; the text fallback below still renders.
    }
  }
  return null;
}

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "/";
  const platform = await publicPlatform();
  const page = marketingPage(path) ?? marketingPage("/")!;
  const t = (s: string) => brandText(s, platform.name, platform.followerModel);
  const h1 = t(page.h1);
  const brand = usesBrandIdentity(platform.name);
  const [lockup, symbol] = brand
    ? await Promise.all([
        brandSvg(BRAND_ASSETS.lockupInk),
        brandSvg(BRAND_ASSETS.symbolInk),
      ])
    : [null, null];
  const lockupHeight = 64;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: BRAND_COLORS.white,
          color: BRAND_COLORS.ink,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "56px 64px",
          }}
        >
          {lockup ? (
            <img
              src={lockup}
              alt=""
              height={lockupHeight}
              width={Math.round(
                (lockupHeight * BRAND_LOCKUP_SIZE.width) /
                  BRAND_LOCKUP_SIZE.height,
              )}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 8,
                  backgroundColor: BRAND_COLORS.ink,
                  color: BRAND_COLORS.white,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                  fontWeight: 700,
                }}
              >
                {platform.initials}
              </div>
              <div style={{ fontSize: 34, fontWeight: 600 }}>
                {platform.name}
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div
              style={{
                fontSize: 20,
                letterSpacing: 2,
                color: BRAND_COLORS.muted,
              }}
            >
              {t(page.eyebrow)}
            </div>
            <div
              style={{
                fontSize: h1.length > 70 ? 46 : h1.length > 40 ? 54 : 64,
                fontWeight: 500,
                lineHeight: 1.08,
                letterSpacing: -1.5,
              }}
            >
              {h1}
            </div>
          </div>
          <div style={{ fontSize: 22, color: BRAND_COLORS.muted }}>
            {brand
              ? `${BRAND_COPY.descriptor} · Built for the UAE · Priced in AED`
              : "Your method, trained into an AI trainer · Built for the UAE · Priced in AED"}
          </div>
        </div>
        {brand && (
          <div
            style={{
              width: 330,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: BRAND_COLORS.pace,
            }}
          >
            {symbol && <img src={symbol} alt="" width={220} height={220} />}
          </div>
        )}
      </div>
    ),
    {
      ...MARKETING_IMAGE_SIZE,
      headers: { "Cache-Control": "public, max-age=3600" },
    },
  );
}
