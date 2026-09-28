import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Database, Actor } from "@trainer/db";
import {
  runtimeConfig,
  strictSecurity,
} from "../../../packages/providers/src/configuration.ts";
import {
  RESERVED_SLUGS,
  platformRootDomain,
  subdomainEligible,
  subdomainHost,
  subdomainLabel,
} from "../../../packages/domain/src/web-address.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
export type HostContext = {
  host: string;
  origin: string;
  tenantId: string | null;
  tenantSlug: string | null;
  custom: boolean;
  /** A workspace subdomain of the platform root (same rules as a custom domain). */
  subdomain?: boolean;
  verifiedProxy: boolean;
  // Edge-observed client address, present only inside a verified proxy proof.
  clientIp?: string;
  /** Development only: loopback spellings of the configured local address. */
  localOrigins?: string[];
};
const loopback = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
export const HOST_HEADERS = {
  host: "x-trainer-host",
  time: "x-trainer-host-time",
  signature: "x-trainer-host-signature",
  clientIp: "x-trainer-client-ip",
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
  clientIp?: string,
) {
  // v2 binds the edge-observed client address into the same proof.
  const fields = [
    clientIp ? "trainer-host-v2" : "trainer-host-v1",
    canonicalHost(host),
    method.toUpperCase(),
    target,
    timestamp,
  ];
  if (clientIp) fields.push(clientIp);
  return createHmac("sha256", proxyKey(secret))
    .update(fields.join("\n"))
    .digest("hex");
}
type HostRequest = {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url: string;
};
type HostOptions = {
  now?: number;
  secret?: string;
  publicUrl?: string;
  production?: boolean;
};
// Verify the request's host proof, if any. Host mapping is a separate step.
function verifyHostProof(request: HostRequest, options: HostOptions) {
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
    signature = read(HOST_HEADERS.signature),
    clientIp = read(HOST_HEADERS.clientIp);
  let verifiedProxy = false,
    host = canonicalHost(read("host") ?? configured);
  if (h || ts || signature || clientIp !== undefined) {
    if (
      !h ||
      !ts ||
      !signature ||
      !/^\d{10,16}$/.test(ts) ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      (clientIp !== undefined &&
        (clientIp.length > 45 || clientIp.includes("%") || !isIP(clientIp))) ||
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
      clientIp,
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
  const client = verifiedProxy && clientIp ? { clientIp } : {};
  return { publicUrl, configured, host, verifiedProxy, client };
}
/**
 * Health and readiness probes never depend on host mapping: the host
 * controller probes web on its loopback port, which no tenant maps. A supplied
 * proof must still be valid, so a verified client address keeps keying the
 * probe's rate budget. The context is the platform's and never selects a tenant.
 */
export function resolveProbeHost(
  request: HostRequest,
  options: HostOptions = {},
): HostContext {
  const { publicUrl, configured, verifiedProxy, client } = verifyHostProof(
    request,
    options,
  );
  return {
    host: configured,
    origin: publicUrl.origin,
    tenantId: null,
    tenantSlug: null,
    custom: false,
    verifiedProxy,
    ...client,
  };
}
export async function resolveRequestHost(
  db: Database,
  request: HostRequest,
  options: HostOptions = {},
): Promise<HostContext> {
  const { publicUrl, configured, host, verifiedProxy, client } =
    verifyHostProof(request, options);
  const production = options.production ?? strictSecurity();
  if (
    host === configured ||
    (!production && !verifiedProxy && loopback.test(host))
  )
    return {
      host: configured,
      origin: publicUrl.origin,
      tenantId: null,
      tenantSlug: null,
      custom: false,
      verifiedProxy,
      ...client,
      // The router treats localhost and 127.0.0.1 as one local address outside
      // production, so the origin gate accepts both on the configured port.
      ...(!production && loopback.test(configured)
        ? {
            localOrigins: ["localhost", "127.0.0.1"].map(
              (name) =>
                `${publicUrl.protocol}//${name}${publicUrl.port ? ":" + publicUrl.port : ""}`,
            ),
          }
        : {}),
    };
  if (!verifiedProxy)
    throw fail(
      421,
      "UNKNOWN_HOST",
      "This address is not connected to a coaching website.",
    );
  // Every published workspace is served at <slug>.<PLATFORM_ROOT_DOMAIN>.
  const root = platformRoot(),
    label = subdomainLabel(host, root);
  if (root && label !== null) {
    const found = await subdomainTenant(db, label);
    if (found)
      return {
        host,
        origin: "https://" + host,
        tenantId: found.tenant_id,
        tenantSlug: found.slug,
        custom: true,
        subdomain: true,
        verifiedProxy,
        ...client,
      };
    // A renamed workspace's previous name redirects for a while.
    const moved = await movedSlug(db, label);
    if (moved && subdomainEligible(moved))
      throw Object.assign(
        fail(421, "HOST_MOVED", "This coaching website has a new address."),
        { location: "https://" + subdomainHost(moved, root) },
      );
    throw fail(
      421,
      "UNKNOWN_HOST",
      "This address is not connected to a published coaching website.",
    );
  }
  // A suspended workspace keeps its address so signed-in members see the
  // suspension notice; its public pages refuse because they require 'active'.
  const [mapping] = await db.system((tx) =>
    tx.query(
      "SELECT m.tenant_id,t.slug FROM domain_mappings m JOIN tenants t ON t.id=m.tenant_id WHERE m.hostname=$1 AND m.active=true AND m.verified_at IS NOT NULL AND t.published=true AND COALESCE(to_jsonb(t)->>'lifecycle_state','active') IN ('active','suspended')",
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
    ...client,
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
    return (
      origin === parsed.origin &&
      (parsed.origin === context.origin ||
        (!context.custom && !!context.localOrigins?.includes(parsed.origin)))
    );
  } catch {
    return false;
  }
}

/** PLATFORM_ROOT_DOMAIN when it is a valid DNS name; null turns subdomains off. */
export function platformRoot() {
  return platformRootDomain(runtimeConfig().PLATFORM_ROOT_DOMAIN);
}
/** The published workspace served at a subdomain label (suspended ones keep it, as for domains). */
export async function subdomainTenant(db: Database, label: string) {
  // Reserved names (www, app, api, mail …) never select a workspace.
  if (!subdomainEligible(label) || RESERVED_SLUGS.has(label)) return null;
  const [row] = await db.system((tx) =>
    tx.query<{ tenant_id: string; slug: string }>(
      "SELECT id AS tenant_id,slug FROM tenants WHERE slug=$1 AND published=true AND lifecycle_state IN ('active','suspended')",
      [label],
    ),
  );
  return row ?? null;
}
/** The current slug of a published workspace whose previous slug this is, within its redirect window. */
export async function movedSlug(db: Database, previous: string) {
  const [row] = await db.system((tx) =>
    tx.query<{ slug: string }>(
      "SELECT t.slug FROM tenant_slug_redirects r JOIN tenants t ON t.id=r.tenant_id WHERE r.slug=$1 AND r.redirect_until>now() AND t.slug<>r.slug AND t.published=true AND t.lifecycle_state IN ('active','suspended')",
      [previous],
    ),
  );
  return row?.slug ?? null;
}
/**
 * The workspace a verified coach host (an active custom-domain mapping or a
 * workspace subdomain) belongs to, or null. For callers that check an origin
 * recorded earlier, such as the wearable OAuth relay.
 */
export async function coachHostTenant(db: Database, hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const label = subdomainLabel(host, platformRoot());
  if (label !== null)
    return (await subdomainTenant(db, label))?.tenant_id ?? null;
  const [mapping] = await db.system((tx) =>
    tx.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM domain_mappings WHERE hostname=$1 AND active=true AND verified_at IS NOT NULL",
      [host],
    ),
  );
  return mapping?.tenant_id ?? null;
}
