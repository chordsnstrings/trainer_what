import { cookies, headers } from "next/headers";
import { cache } from "react";
import { verifiedProxyHeaders } from "../host-proxy";
import {
  LANGUAGE_COOKIE,
  LANGUAGE_HEADER,
  PAGE_PATH_HEADER,
  coachSiteSlug,
  resolveDocumentLanguage,
} from "../document-language";

// Server-only helpers shared by the root layout and the catch-all page. The
// React cache makes the layout's language lookup and the page's render one
// API request per page load.

/** A published coach website, or null when it is not available here. */
export const publicWebsite = cache(async (slug: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) return null;
  const incoming = await headers(),
    origin =
      incoming.get("x-trainer-site-origin") ??
      process.env.PUBLIC_APP_URL ??
      "http://localhost:3000";
  const target = `/api/v1/public/sites/${slug}`;
  const response = await fetch(
    new URL(target, process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"),
    {
      headers: verifiedProxyHeaders(
        new Headers(),
        new URL(origin).host,
        "GET",
        target,
        process.env.INTERNAL_PROXY_SECRET,
        Date.now(),
        // Set by proxy.ts from the edge address after removing client copies.
        incoming.get("x-trainer-client-ip"),
      ),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    },
  );
  if (response.status === 404 || response.status === 421) return null;
  if (!response.ok)
    throw new Error("This coaching website is temporarily unavailable.");
  return response.json();
});

/**
 * The document language for this request: an explicit `?lang=` (forwarded by
 * proxy.ts), the device cookie, the coach website's language on its pages,
 * then English. A signed-in member's saved language is applied in the
 * workspace and mirrored into the cookie, so later page loads start in it.
 */
export async function documentLanguage() {
  const incoming = await headers(),
    jar = await cookies();
  const query = incoming.get(LANGUAGE_HEADER),
    cookie = jar.get(LANGUAGE_COOKIE)?.value;
  const explicit = resolveDocumentLanguage({ query, cookie });
  const slug = coachSiteSlug(incoming.get(PAGE_PATH_HEADER));
  if (explicit.source !== "default" || !slug) return explicit;
  // The page shows its own error when the website cannot be loaded; the
  // document then keeps the English default.
  const site = await publicWebsite(slug).then(
    (data) => data?.site?.language,
    () => undefined,
  );
  return resolveDocumentLanguage({ site });
}
