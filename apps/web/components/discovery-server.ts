import { headers } from "next/headers";
import { verifiedProxyHeaders } from "../host-proxy";

// Server-only helpers for discovery pages and crawler files. proxy.ts removes
// any client-supplied x-trainer-* headers before it sets these, so they are
// trustworthy inside the web server.

/** The public origin of the host that served this request. */
export async function requestOrigin(): Promise<{
  origin: string;
  coachHost: boolean;
}> {
  const incoming = await headers();
  const coach = incoming.get("x-trainer-site-origin");
  return {
    origin: new URL(
      coach ?? process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
    ).origin,
    coachHost: !!coach,
  };
}

/** A GET to the API signed for this request's host, like the coach website. */
export async function signedApiGet(target: string): Promise<Response> {
  const incoming = await headers();
  const { origin } = await requestOrigin();
  return fetch(
    new URL(target, process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"),
    {
      headers: verifiedProxyHeaders(
        new Headers(),
        new URL(origin).host,
        "GET",
        target,
        process.env.INTERNAL_PROXY_SECRET,
        Date.now(),
        incoming.get("x-trainer-client-ip"),
      ),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    },
  );
}

export type SitemapFile = {
  entries: Array<{ url: string; lastModified?: string }>;
  page: number;
  pages: number;
};

/**
 * One sitemap file for this request's host, decided by the API from the
 * signed host. Null when that file does not exist. Any other failure throws:
 * crawlers retry an unavailable sitemap, but an empty one would drop pages.
 */
export async function sitemapFile(page: number): Promise<SitemapFile | null> {
  const response = await signedApiGet(
    `/api/v1/public/discovery/sitemap?page=${page}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("The sitemap is temporarily unavailable.");
  return response.json();
}

const xmlHeaders = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=300",
};
export function xmlResponse(body: string): Response {
  return new Response(body, { headers: xmlHeaders });
}
export function sitemapMissing(): Response {
  return new Response("This sitemap does not exist.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
export function sitemapUnavailable(): Response {
  return new Response("The sitemap is temporarily unavailable.", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": "300",
      "Cache-Control": "no-store",
    },
  });
}
