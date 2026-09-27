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
type Env = Record<string, string | undefined>;

export const PROVIDER_SANDBOX_VARIABLE = "TRAINER_PROVIDER_SANDBOX";
/** Endpoint overrides that exist only for the sandbox. */
export const PROVIDER_SANDBOX_OVERRIDES = [
  "STRIPE_API_BASE_URL",
  "WHOOP_API_BASE_URL",
  "FOOD_LOOKUP_BASE_URL",
] as const;
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

/**
 * Called by API and worker startup. Refuses the sandbox variable or any
 * sandbox-only override unless the sandbox is honoured, and refuses override
 * values that are not HTTPS loopback endpoints.
 */
export function assertProviderSandboxBinding(env: Env = process.env) {
  const requested = env[PROVIDER_SANDBOX_VARIABLE];
  const overrides = PROVIDER_SANDBOX_OVERRIDES.filter((key) =>
    env[key]?.trim(),
  );
  if (requested === undefined && !overrides.length) return null;
  if (providerSandbox(env) !== "mock")
    throw new ProviderSandboxRefused(
      requested !== undefined
        ? `${PROVIDER_SANDBOX_VARIABLE} is only accepted as "mock" for a loopback PUBLIC_APP_URL and a loopback API_HOST. Remove it from any shared or public deployment.`
        : `${overrides.join(", ")} can only be set together with ${PROVIDER_SANDBOX_VARIABLE}=mock on a loopback address. Remove it from any shared or public deployment.`,
    );
  for (const key of overrides)
    if (!sandboxEndpoint(env[key]!.trim()))
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
          "MOCK PROVIDERS: this local sandbox sends payments, payouts, email, AI, push, wearables, voice and food lookups to local test doubles. Nothing here is real.",
      }
    : { providerSandbox: null, providerSandboxNotice: null };
}
