import { ImageResponse } from "next/og";
import {
  MARKETING_IMAGE_SIZE,
  brandText,
  marketingPage,
} from "@trainer/contracts";
import { publicPlatform } from "../../components/marketing/platform";

// The social preview of a marketing page (Open Graph and Twitter): the brand
// name, the page's eyebrow and H1. Referenced from marketingMetadata() and
// the page JSON-LD; unknown paths get the home page's preview.
export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "/";
  const platform = await publicPlatform();
  const page = marketingPage(path) ?? marketingPage("/")!;
  const t = (s: string) => brandText(s, platform.name, platform.followerModel);
  const h1 = t(page.h1);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#254d42",
          color: "#f7f8f4",
          padding: "64px 72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              backgroundColor: "#f7f8f4",
              color: "#254d42",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            {platform.initials}
          </div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>{platform.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 24, letterSpacing: 3, color: "#c9e86f" }}>
            {t(page.eyebrow)}
          </div>
          <div
            style={{
              fontSize: h1.length > 70 ? 50 : 60,
              fontWeight: 700,
              lineHeight: 1.12,
            }}
          >
            {h1}
          </div>
        </div>
        <div style={{ fontSize: 24, color: "#d9e4dc" }}>
          Your method, trained into an AI trainer · Built for the UAE · Priced in AED
        </div>
      </div>
    ),
    {
      ...MARKETING_IMAGE_SIZE,
      headers: { "Cache-Control": "public, max-age=3600" },
    },
  );
}
