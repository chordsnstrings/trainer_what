import { createHmac, timingSafeEqual } from "node:crypto";
import type { Database, Actor } from "@trainer/db";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
export type HostContext = {
  host: string;
  origin: string;
  tenantId: string | null;
  tenantSlug: string | null;
  custom: boolean;
  verifiedProxy: boolean;
};
export const HOST_HEADERS = {
  host: "x-trainer-host",
  time: "x-trainer-host-time",
  signature: "x-trainer-host-signature",
} as const;
export function canonicalHost(value: string): string {
  if (!value || /[\s,@/\\#?]/.test(value) || value.length > 260)
    throw fail(400, "INVALID_HOST", "Invalid request host.");
  let url: URL;
  try {
    url = new URL("https://" + value);
  } catch {
    throw fail(400, "INVALID_HOST", "Invalid request host.");
  }
  if (url.username || url.password || url.pathname !== "/")
    throw fail(400, "INVALID_HOST", "Invalid request host.");
  return url.host.toLowerCase().replace(/\.$/, "");
}
function proxyKey(secret = process.env.INTERNAL_PROXY_SECRET) {
  if (!secret || Buffer.byteLength(secret) < 32)
    throw fail(
      503,
      "HOST_PROXY_UNAVAILABLE",
      "A separate internal proxy signing key is required.",
    );
  return secret;
}
export function signHostRequest(
  host: string,
  method: string,
  target: string,
  timestamp: string,
  secret?: string,
) {
  return createHmac("sha256", proxyKey(secret))
    .update(
      [
        "trainer-host-v1",
        canonicalHost(host),
        method.toUpperCase(),
        target,
        timestamp,
      ].join("\n"),
    )
    .digest("hex");
}
export async function resolveRequestHost(
  db: Database,
  request: {
    headers: Record<string, string | string[] | undefined>;
    method: string;
    url: string;
  },
  options: {
    now?: number;
    secret?: string;
    publicUrl?: string;
    production?: boolean;
  } = {},
): Promise<HostContext> {
  const publicUrl = new URL(
      options.publicUrl ??
        runtimeConfig().PUBLIC_APP_URL ??
        "http://localhost:3000",
    ),
    configured = canonicalHost(publicUrl.host);
  const read = (key: string) => {
    const v = request.headers[key];
    if (Array.isArray(v))
      throw fail(
        400,
        "INVALID_HOST",
        "Repeated host headers are not accepted.",
      );
    return v;
  };
  const h = read(HOST_HEADERS.host),
    ts = read(HOST_HEADERS.time),
    signature = read(HOST_HEADERS.signature);
  let verifiedProxy = false,
    host = canonicalHost(read("host") ?? configured);
  if (h || ts || signature) {
    if (
      !h ||
      !ts ||
      !signature ||
      !/^\d{10,16}$/.test(ts) ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      Math.abs((options.now ?? Date.now()) - Number(ts)) > 30000
    )
      throw fail(
        400,
        "HOST_SIGNATURE",
        "Request host proof is invalid or expired.",
      );
    const expected = signHostRequest(
      h,
      request.method,
      request.url,
      ts,
      options.secret,
    );
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      throw fail(
        400,
        "HOST_SIGNATURE",
        "Request host proof does not match this request.",
      );
    host = canonicalHost(h);
    verifiedProxy = true;
  }
  const production =
    options.production ?? process.env.NODE_ENV === "production";
  if (
    host === configured ||
    (!production &&
      !verifiedProxy &&
      /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
  )
    return {
      host: configured,
      origin: publicUrl.origin,
      tenantId: null,
      tenantSlug: null,
      custom: false,
      verifiedProxy,
    };
  if (!verifiedProxy)
    throw fail(
      421,
      "UNKNOWN_HOST",
      "This address is not connected to a coaching website.",
    );
  const [mapping] = await db.system((tx) =>
    tx.query(
      "SELECT m.tenant_id,t.slug FROM domain_mappings m JOIN tenants t ON t.id=m.tenant_id WHERE m.hostname=$1 AND m.active=true AND m.verified_at IS NOT NULL AND t.published=true AND COALESCE(to_jsonb(t)->>'lifecycle_state','active')='active'",
      [host],
    ),
  );
  if (!mapping)
    throw fail(
      421,
      "UNKNOWN_HOST",
      "This address is not connected to a published coaching website.",
    );
  return {
    host,
    origin: "https://" + host,
    tenantId: mapping.tenant_id,
    tenantSlug: mapping.slug,
    custom: true,
    verifiedProxy,
  };
}
export function enforceHostTenant(
  context: HostContext,
  actor?: Actor & { platformRole?: string },
) {
  if (
    context.custom &&
    actor &&
    (actor.tenantId !== context.tenantId ||
      (actor.platformRole && actor.platformRole !== "none"))
  )
    throw fail(
      403,
      "HOST_TENANT_MISMATCH",
      "Sign in to the workspace connected to this address.",
    );
}
export function allowedRequestOrigin(
  context: HostContext,
  origin: string | undefined,
) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.origin === context.origin && origin === parsed.origin;
  } catch {
    return false;
  }
}
