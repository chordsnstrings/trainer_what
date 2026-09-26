import { createHmac } from "node:crypto";

// Keep this small server-only module independent of the API/database bundle.
export function proxyHost(value: string) {
  if (!value || /[\s,@/\\#?]/.test(value) || value.length > 260)
    throw new Error("Invalid request host");
  const u = new URL("https://" + value);
  if (u.username || u.password || u.pathname !== "/")
    throw new Error("Invalid request host");
  return u.host.toLowerCase().replace(/\.$/, "");
}
export function verifiedProxyHeaders(
  incoming: Headers,
  host: string,
  method: string,
  target: string,
  secret: string | undefined,
  now = Date.now(),
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
      normalized = proxyHost(host);
    headers.set("x-trainer-host", normalized);
    headers.set("x-trainer-host-time", time);
    headers.set(
      "x-trainer-host-signature",
      createHmac("sha256", secret)
        .update(
          [
            "trainer-host-v1",
            normalized,
            method.toUpperCase(),
            target,
            time,
          ].join("\n"),
        )
        .digest("hex"),
    );
  }
  return headers;
}
export function customHostPath(path: string, slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
  if (/^\/(admin|trainer|signup)(\/|$)/.test(path)) return null;
  if (path === "/coach/" + slug || path.startsWith("/coach/" + slug + "/"))
    return path;
  if (path.startsWith("/coach/")) return null;
  if (path.startsWith("/join-coach/"))
    return path === "/join-coach/" + slug ? path : null;
  if (
    /^\/(app|login|forgot-password|reset-password|verify-email|magic-link|join|terms|privacy|ai-disclosure)(\/|$)/.test(
      path,
    )
  )
    return path;
  return "/coach/" + slug + (path === "/" ? "" : path);
}
