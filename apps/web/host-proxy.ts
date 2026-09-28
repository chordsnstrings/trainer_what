import { createHmac } from "node:crypto";
import { isIP } from "node:net";

// Keep this small server-only module independent of the API/database bundle.
export function proxyHost(value: string) {
  if (!value || /[\s,@/\\#?]/.test(value) || value.length > 260)
    throw new Error("Invalid request host");
  const u = new URL("https://" + value);
  if (u.username || u.password || u.pathname !== "/")
    throw new Error("Invalid request host");
  return u.host.toLowerCase().replace(/\.$/, "");
}
// The edge (Caddy) overwrites X-Forwarded-For with the connecting address, and
// Next only fills it from the socket when it is absent. Take the entry nearest
// to this server and accept only a literal IP address.
export function edgeClientIp(forwardedFor: string | null | undefined) {
  const value = forwardedFor?.split(",").pop()?.trim() ?? "";
  return value.length <= 45 && !value.includes("%") && isIP(value)
    ? value
    : undefined;
}
export function verifiedProxyHeaders(
  incoming: Headers,
  host: string,
  method: string,
  target: string,
  secret: string | undefined,
  now = Date.now(),
  clientIp?: string | null,
) {
  const headers = new Headers(incoming);
  for (const key of [...headers.keys()])
    if (
      key.startsWith("x-trainer-") ||
      key.startsWith("x-forwarded-") ||
      key === "forwarded"
    )
      headers.delete(key);
  if (secret) {
    if (Buffer.byteLength(secret) < 32)
      throw new Error(
        "The internal proxy signing key must contain at least 32 bytes",
      );
    const time = String(now),
      normalized = proxyHost(host),
      client = edgeClientIp(clientIp);
    headers.set("x-trainer-host", normalized);
    headers.set("x-trainer-host-time", time);
    // The client address is only carried inside the signed provenance; the API
    // keys anonymous request budgets on it.
    if (client) headers.set("x-trainer-client-ip", client);
    const fields = [
      client ? "trainer-host-v2" : "trainer-host-v1",
      normalized,
      method.toUpperCase(),
      target,
      time,
    ];
    if (client) fields.push(client);
    headers.set(
      "x-trainer-host-signature",
      createHmac("sha256", secret).update(fields.join("\n")).digest("hex"),
    );
  }
  return headers;
}
/**
 * The new address of a renamed workspace's previous subdomain, from the API's
 * HOST_MOVED answer: only an https origin that is itself a subdomain of the
 * configured platform root is followed.
 */
export function movedHostLocation(
  body: unknown,
  rootDomain: string | undefined,
): string | null {
  const root = (rootDomain ?? "").trim().toLowerCase().replace(/\.$/, "");
  const answer = body as { code?: unknown; location?: unknown } | null;
  if (!root || answer?.code !== "HOST_MOVED") return null;
  if (typeof answer.location !== "string") return null;
  try {
    const url = new URL(answer.location);
    const label = url.hostname.slice(0, -(root.length + 1));
    return url.protocol === "https:" &&
      url.origin === answer.location &&
      !url.port &&
      url.hostname.endsWith("." + root) &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
/**
 * Where a bought domain's page request redirects, from the API's host
 * answer: only an https origin (no port, path or credentials) that is either
 * a workspace subdomain (one label) of the configured platform root, or the
 * domain itself when the request came to its www name. Anything else is
 * ignored and the site is served.
 */
export function forwardLocation(
  redirect: unknown,
  host: string,
  rootDomain: string | undefined,
): string | null {
  if (typeof redirect !== "string") return null;
  let url: URL;
  try {
    url = new URL(redirect);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== redirect ||
    url.port ||
    url.username ||
    url.password
  )
    return null;
  const target = url.hostname.toLowerCase();
  const current = host.toLowerCase().replace(/:\d+$/, "");
  if (current.startsWith("www.") && target === current.slice(4))
    return url.origin;
  const root = (rootDomain ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!root || !target.endsWith("." + root) || target === current) return null;
  const label = target.slice(0, -(root.length + 1));
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    ? url.origin
    : null;
}
/**
 * A forwarded domain's permanent redirect is cached for an hour only, so
 * switching back to showing the site takes effect within the hour.
 */
export const FORWARD_CACHE_CONTROL = "public, max-age=3600";
export function customHostPath(path: string, slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  // Crawler files describe the connected coach website itself.
  if (path === "/robots.txt" || path === "/sitemap.xml") return path;
  if (/^\/(admin|trainer|signup)(\/|$)/.test(path)) return null;
  if (path === "/coach/" + slug || path.startsWith("/coach/" + slug + "/"))
    return path;
  if (path.startsWith("/coach/")) return null;
  if (path.startsWith("/join-coach/"))
    return path === "/join-coach/" + slug ? path : null;
  if (
    /^\/(app|login|forgot-password|reset-password|verify-email|verify-email-change|magic-link|recover-authenticator|join|terms|privacy|ai-disclosure)(\/|$)/.test(
      path,
    )
  )
    return path;
  return "/coach/" + slug + (path === "/" ? "" : path);
}
