/**
 * Mock-provider sandbox for the local end-to-end harness.
 *
 * The sandbox lets a production-mode process (NODE_ENV=production) send its
 * provider requests to local HTTPS mocks. It must be impossible to reach in a
 * real deployment, so it is honoured only when all of these hold:
 *   - TRAINER_PROVIDER_SANDBOX is exactly "mock";
 *   - PUBLIC_APP_URL is a loopback URL (localhost, 127.0.0.1 or ::1);
 *   - the API listens on a loopback address (API_HOST, default 127.0.0.1).
 * Startup refuses the variable, and every sandbox-only endpoint override, in
 * any other situation. Only process environment is read: the Superadmin
 * settings store cannot hold these keys.
 */
import { Resolver } from "node:dns/promises";

type Env = Record<string, string | undefined>;

export const PROVIDER_SANDBOX_VARIABLE = "TRAINER_PROVIDER_SANDBOX";
/** Endpoint overrides that exist only for the sandbox. */
export const PROVIDER_SANDBOX_OVERRIDES = [
  "STRIPE_API_BASE_URL",
  "WHOOP_API_BASE_URL",
  "FOOD_LOOKUP_BASE_URL",
  // OpenID Connect issuers for Sign in with Google / Apple (mock issuers).
  "GOOGLE_OIDC_ISSUER",
  "APPLE_OIDC_ISSUER",
  // Namecheap XML API double (web addresses).
  "NAMECHEAP_API_BASE_URL",
  // 101domain REST API double (web addresses).
  "REGISTRAR_101DOMAIN_API_BASE_URL",
  // DigitalOcean DNS API double (zones for bought domains and the root).
  "DIGITALOCEAN_API_BASE_URL",
] as const;
/**
 * A loopback DNS server (127.0.0.1:<port>) that answers the custom-domain
 * ownership (TXT), target (CNAME) and address (A) lookups in the sandbox.
 * Not a URL, so it is validated separately from the endpoint overrides.
 */
export const PROVIDER_SANDBOX_DNS_VARIABLE = "DOMAIN_DNS_SERVER";
export type ProviderSandboxOverride =
  (typeof PROVIDER_SANDBOX_OVERRIDES)[number];

export class ProviderSandboxRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderSandboxRefused";
  }
}

const loopbackNames = new Set(["localhost", "127.0.0.1", "::1"]);
export function isLoopbackHostname(value: string): boolean {
  return loopbackNames.has(
    value
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, ""),
  );
}
function loopbackUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      isLoopbackHostname(url.hostname)
    );
  } catch {
    return false;
  }
}

/** "mock" when the sandbox is honoured for this process, otherwise null. */
export function providerSandbox(env: Env = process.env): "mock" | null {
  if (env[PROVIDER_SANDBOX_VARIABLE] !== "mock") return null;
  if (!loopbackUrl(env.PUBLIC_APP_URL)) return null;
  if (!isLoopbackHostname(env.API_HOST ?? "127.0.0.1")) return null;
  return "mock";
}

/** A sandbox endpoint must be HTTPS on a loopback host, without credentials. */
export function sandboxEndpoint(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !isLoopbackHostname(url.hostname)
  )
    return null;
  return url;
}

/** True when the sandbox is honoured and the URL is an HTTPS loopback endpoint. */
export function sandboxAllowsEndpoint(
  value: string | URL,
  env: Env = process.env,
): boolean {
  return (
    providerSandbox(env) === "mock" && sandboxEndpoint(String(value)) !== null
  );
}

/** The override URL, only when the sandbox is honoured; otherwise null. */
export function sandboxOverride(
  key: ProviderSandboxOverride,
  env: Env = process.env,
): URL | null {
  const value = env[key]?.trim();
  if (!value || providerSandbox(env) !== "mock") return null;
  return sandboxEndpoint(value);
}

function dnsServerValue(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  const match = /^127\.0\.0\.1:(\d{1,5})$/.exec(text);
  return match && Number(match[1]) > 0 && Number(match[1]) < 65536
    ? text
    : null;
}
/** The sandbox DNS server, only when the sandbox is honoured; otherwise null. */
export function sandboxDnsServer(env: Env = process.env): string | null {
  if (providerSandbox(env) !== "mock") return null;
  return dnsServerValue(env[PROVIDER_SANDBOX_DNS_VARIABLE]);
}
let cachedResolver: { server: string; resolver: Resolver } | undefined;
/**
 * A resolver bound to the sandbox DNS server, or null outside the sandbox.
 * Callers fall back to the system resolver when this is null.
 */
export function sandboxResolver(env: Env = process.env): Resolver | null {
  const server = sandboxDnsServer(env);
  if (!server) return null;
  if (cachedResolver?.server !== server) {
    const resolver = new Resolver({ timeout: 2000, tries: 2 });
    resolver.setServers([server]);
    cachedResolver = { server, resolver };
  }
  return cachedResolver.resolver;
}
/** Loopback IPv4 answers the sandbox resolver may return (127.0.0.0/8). */
export function isSandboxLoopbackAddress(address: string) {
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}

/**
 * Called by API and worker startup. Refuses the sandbox variable or any
 * sandbox-only override unless the sandbox is honoured, and refuses override
 * values that are not HTTPS loopback endpoints.
 */
export function assertProviderSandboxBinding(env: Env = process.env) {
  const requested = env[PROVIDER_SANDBOX_VARIABLE];
  const overrides: string[] = PROVIDER_SANDBOX_OVERRIDES.filter((key) =>
    env[key]?.trim(),
  );
  if (env[PROVIDER_SANDBOX_DNS_VARIABLE]?.trim())
    overrides.push(PROVIDER_SANDBOX_DNS_VARIABLE);
  if (requested === undefined && !overrides.length) return null;
  if (providerSandbox(env) !== "mock")
    throw new ProviderSandboxRefused(
      requested !== undefined
        ? `${PROVIDER_SANDBOX_VARIABLE} is only accepted as "mock" for a loopback PUBLIC_APP_URL and a loopback API_HOST. Remove it from any shared or public deployment.`
        : `${overrides.join(", ")} can only be set together with ${PROVIDER_SANDBOX_VARIABLE}=mock on a loopback address. Remove it from any shared or public deployment.`,
    );
  for (const key of overrides)
    if (key === PROVIDER_SANDBOX_DNS_VARIABLE) {
      if (!dnsServerValue(env[key]))
        throw new ProviderSandboxRefused(
          `${key} must be 127.0.0.1:<port> (a loopback DNS server).`,
        );
    } else if (!sandboxEndpoint(env[key]!.trim()))
      throw new ProviderSandboxRefused(
        `${key} must be an HTTPS loopback URL without credentials.`,
      );
  return "mock" as const;
}

/** Public status for readiness and the admin screens. Never includes URLs. */
export function providerSandboxStatus(env: Env = process.env) {
  return providerSandbox(env) === "mock"
    ? {
        providerSandbox: "mock" as const,
        providerSandboxNotice:
          "MOCK PROVIDERS: this local sandbox sends payments, payouts, email, AI, push, wearables, voice, food lookups, Apple/Google sign-in and custom-domain DNS to local test doubles. Nothing here is real.",
      }
    : { providerSandbox: null, providerSandboxNotice: null };
}
