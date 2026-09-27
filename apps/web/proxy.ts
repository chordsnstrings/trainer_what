import { NextResponse, type NextRequest } from "next/server";
import { customHostPath, proxyHost, verifiedProxyHeaders } from "./host-proxy";

export async function proxy(request: NextRequest) {
  try {
    const publicUrl = new URL(
        process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
      ),
      host = proxyHost(request.headers.get("host") ?? request.nextUrl.host),
      canonical = proxyHost(publicUrl.host);
    const secret = process.env.INTERNAL_PROXY_SECRET,
      production = process.env.NODE_ENV === "production";
    const local = !production && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host),
      custom = host !== canonical && !local;
    if (production && (!secret || Buffer.byteLength(secret) < 32))
      return NextResponse.json(
        { message: "The internal request-signing key is not configured." },
        { status: 503 },
      );
    const incomingTarget = request.nextUrl.pathname + request.nextUrl.search;
    const forwarded = verifiedProxyHeaders(
      request.headers,
      local ? canonical : host,
      request.method,
      incomingTarget,
      secret,
    );
    if (request.nextUrl.pathname.startsWith("/api/")) {
      const upstream = new URL(
        incomingTarget,
        process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000",
      );
      return NextResponse.rewrite(upstream, {
        request: { headers: forwarded },
      });
    }
    if (!custom) return NextResponse.next({ request: { headers: forwarded } });
    if (!secret)
      return NextResponse.json(
        { message: "Custom domain routing requires internal request signing." },
        { status: 503 },
      );
    const lookup = "/api/v1/public/host";
    const response = await fetch(
      new URL(lookup, process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"),
      {
        headers: verifiedProxyHeaders(
          new Headers(),
          host,
          "GET",
          lookup,
          secret,
        ),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      return NextResponse.json(
        {
          message:
            "This address is not connected to a published coaching website.",
        },
        { status: 421 },
      );
    const mapping = await response.json();
    if (
      !mapping.custom ||
      typeof mapping.tenantSlug !== "string" ||
      typeof mapping.tenantId !== "string"
    )
      return NextResponse.json(
        { message: "This coaching address is unavailable." },
        { status: 421 },
      );
    const path = customHostPath(request.nextUrl.pathname, mapping.tenantSlug);
    if (!path)
      return NextResponse.json(
        { message: "Use the platform address for this workspace or page." },
        { status: 403 },
      );
    forwarded.set("x-trainer-site-slug", mapping.tenantSlug);
    forwarded.set("x-trainer-site-tenant", mapping.tenantId);
    forwarded.set("x-trainer-site-origin", "https://" + host);
    const url = request.nextUrl.clone();
    url.pathname = path;
    return NextResponse.rewrite(url, { request: { headers: forwarded } });
  } catch {
    return NextResponse.json(
      {
        message:
          "This request could not be routed to a verified coaching address.",
      },
      { status: 400 },
    );
  }
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icons/).*)",
  ],
};
