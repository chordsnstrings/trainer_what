import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as signBytes,
  timingSafeEqual,
  verify as verifyBytes,
  type KeyObject,
} from "node:crypto";
import {
  ConfigurationError,
  providerRequest,
  runtimeConfig,
  type IntegrationTestResult,
  type RuntimeConfig,
} from "./configuration.ts";
import { sandboxOverride } from "./sandbox.ts";

/**
 * OpenID Connect sign-in with Google and Apple: discovery, signing-key cache,
 * ID-token verification, the Apple ES256 client secret, the authorization code
 * exchange and the Superadmin connection check. Domain decisions (which
 * account an identity reaches, registration gates, sessions) live in the API.
 */
export type OidcProviderId = "google" | "apple";
type JsonWebKey = Record<string, any> & { kid: string; kty: string };
export const OIDC_PROVIDER_IDS: OidcProviderId[] = ["google", "apple"];
export const OIDC_PROVIDERS: Record<
  OidcProviderId,
  {
    name: string;
    integrationId: string;
    issuer: string;
    acceptedIssuers: string[];
    scope: string;
    responseMode?: "form_post";
  }
> = {
  google: {
    name: "Google",
    integrationId: "google_signin",
    issuer: "https://accounts.google.com",
    // Google documents both forms for the iss claim.
    acceptedIssuers: ["https://accounts.google.com", "accounts.google.com"],
    scope: "openid email profile",
  },
  apple: {
    name: "Apple",
    integrationId: "apple_signin",
    issuer: "https://appleid.apple.com",
    acceptedIssuers: ["https://appleid.apple.com"],
    // Apple returns the email in the ID token only when it was requested; a
    // requested scope requires the form_post response mode.
    scope: "name email",
    responseMode: "form_post",
  },
};
export class OidcError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OidcError";
    this.code = code;
  }
}
export function isOidcProvider(value: unknown): value is OidcProviderId {
  return value === "google" || value === "apple";
}

type TestOverrides = {
  issuers?: Partial<Record<OidcProviderId, string>>;
  now?: () => number;
};
let overrides: TestOverrides = {};
/**
 * Test tooling only: points a provider at an in-test mock issuer on a reserved
 * domain (served through the fixture transport in configuration.ts) and may
 * pin the clock. Refused outside the Node test runner and in production.
 */
export function setOidcTestOverrides(next: TestOverrides) {
  if (!process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === "production")
    throw new Error(
      "OIDC test overrides are available only inside the Node test runner",
    );
  for (const issuer of Object.values(next.issuers ?? {}))
    if (!/^https:\/\/[a-z0-9.-]+\.(test|invalid)$/.test(String(issuer)))
      throw new Error("Test issuers must use a reserved .test domain");
  overrides = next;
  clearOidcCaches();
}
const now = () => overrides.now?.() ?? Date.now();
/**
 * Local mock-provider sandbox only (sandbox.ts): a loopback HTTPS mock issuer.
 * Null in every real deployment, where the variable is refused at startup.
 */
function sandboxIssuer(provider: OidcProviderId) {
  const url = sandboxOverride(
    provider === "google" ? "GOOGLE_OIDC_ISSUER" : "APPLE_OIDC_ISSUER",
  );
  return url ? url.href.replace(/\/$/, "") : undefined;
}
export function oidcIssuer(provider: OidcProviderId) {
  return (
    overrides.issuers?.[provider] ??
    sandboxIssuer(provider) ??
    OIDC_PROVIDERS[provider].issuer
  );
}
function acceptedIssuers(provider: OidcProviderId) {
  const override = overrides.issuers?.[provider] ?? sandboxIssuer(provider);
  return override ? [override] : OIDC_PROVIDERS[provider].acceptedIssuers;
}

export type OidcClientConfig = {
  provider: OidcProviderId;
  clientId: string;
  clientSecret?: string;
  apple?: { teamId: string; keyId: string; privateKey: string };
};
/** Null until every required credential is present in the active settings. */
export function oidcClientConfig(
  provider: OidcProviderId,
  config: RuntimeConfig = runtimeConfig(),
): OidcClientConfig | null {
  const value = (key: string) => config[key]?.trim() ?? "";
  if (provider === "google") {
    const clientId = value("GOOGLE_SIGNIN_CLIENT_ID"),
      clientSecret = value("GOOGLE_SIGNIN_CLIENT_SECRET");
    return clientId && clientSecret
      ? { provider, clientId, clientSecret }
      : null;
  }
  const clientId = value("APPLE_SIGNIN_SERVICES_ID"),
    teamId = value("APPLE_SIGNIN_TEAM_ID"),
    keyId = value("APPLE_SIGNIN_KEY_ID"),
    privateKey = value("APPLE_SIGNIN_PRIVATE_KEY");
  return clientId && teamId && keyId && privateKey
    ? { provider, clientId, apple: { teamId, keyId, privateKey } }
    : null;
}
export function oidcRedirectUri(provider: OidcProviderId, origin: string) {
  return `${origin.replace(/\/$/, "")}/api/v1/auth/oidc/${provider}/callback`;
}

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
  code_challenge_methods_supported?: string[];
};
type Cached<T> = { value: T; expiresAt: number; fetchedAt: number };
const discoveryCache = new Map<string, Cached<Discovery>>();
const jwksCache = new Map<string, Cached<JsonWebKey[]>>();
export function clearOidcCaches() {
  discoveryCache.clear();
  jwksCache.clear();
}
/** Honour the provider's max-age within five minutes and one day. */
function lifetime(response: Response) {
  const match = /max-age=(\d+)/i.exec(
    response.headers.get("cache-control") ?? "",
  );
  const seconds = match ? Number(match[1]) : 3600;
  return Math.min(86400, Math.max(300, seconds)) * 1000;
}
function httpsEndpoint(value: unknown) {
  try {
    const url = new URL(String(value));
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.hash
    );
  } catch {
    return false;
  }
}
async function json(response: Response, code: string, message: string) {
  try {
    return (await response.json()) as any;
  } catch {
    throw new OidcError(code, message);
  }
}
export async function oidcDiscovery(
  provider: OidcProviderId,
  refresh = false,
): Promise<Discovery> {
  const issuer = oidcIssuer(provider),
    cached = discoveryCache.get(issuer),
    name = OIDC_PROVIDERS[provider].name;
  if (!refresh && cached && cached.expiresAt > now()) return cached.value;
  const unavailable = () =>
    new OidcError(
      "OIDC_UNAVAILABLE",
      `${name} sign-in configuration could not be read`,
    );
  let response: Response;
  try {
    response = await providerRequest(
      issuer + "/.well-known/openid-configuration",
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch {
    throw unavailable();
  }
  if (!response.ok) throw unavailable();
  const doc = await json(response, "OIDC_UNAVAILABLE", unavailable().message);
  if (
    doc?.issuer !== issuer ||
    !httpsEndpoint(doc.authorization_endpoint) ||
    !httpsEndpoint(doc.token_endpoint) ||
    !httpsEndpoint(doc.jwks_uri)
  )
    throw new OidcError(
      "OIDC_UNAVAILABLE",
      `${name} published an unexpected sign-in configuration`,
    );
  discoveryCache.set(issuer, {
    value: doc,
    fetchedAt: now(),
    expiresAt: now() + lifetime(response),
  });
  return doc;
}
async function signingKeys(
  discovery: Discovery,
  refresh = false,
): Promise<JsonWebKey[]> {
  const cached = jwksCache.get(discovery.jwks_uri);
  if (!refresh && cached && cached.expiresAt > now()) return cached.value;
  // An unknown key id forces a refresh, at most once per ten seconds, so a
  // stream of forged tokens cannot turn into a stream of provider requests.
  if (refresh && cached && now() - cached.fetchedAt < 10000)
    return cached.value;
  let response: Response;
  try {
    response = await providerRequest(discovery.jwks_uri, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new OidcError(
      "OIDC_UNAVAILABLE",
      "Provider signing keys could not be read",
    );
  }
  if (!response.ok)
    throw new OidcError(
      "OIDC_UNAVAILABLE",
      "Provider signing keys could not be read",
    );
  const doc = await json(
    response,
    "OIDC_UNAVAILABLE",
    "Provider signing keys could not be read",
  );
  const keys: JsonWebKey[] = Array.isArray(doc?.keys)
    ? doc.keys.filter(
        (key: any) =>
          key &&
          typeof key.kid === "string" &&
          ["RSA", "EC"].includes(key.kty) &&
          (key.use === undefined || key.use === "sig"),
      )
    : [];
  jwksCache.set(discovery.jwks_uri, {
    value: keys,
    fetchedAt: now(),
    expiresAt: now() + lifetime(response),
  });
  return keys;
}

const segment = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function decodeSegment(value: string): any {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidToken();
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalidToken();
  }
}
const invalidToken = (detail = "could not be verified") =>
  new OidcError("OIDC_TOKEN_INVALID", `The sign-in response ${detail}`);
function sameText(a: string, b: string) {
  const left = createHash("sha256").update(a).digest(),
    right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right) && a === b;
}
export type OidcClaims = {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};
/**
 * Verifies an ID token signature against the provider's published keys, then
 * issuer, audience (and authorized party), expiry, issue time and nonce.
 */
export async function verifyIdToken(
  provider: OidcProviderId,
  idToken: unknown,
  expected: { clientId: string; nonce: string },
): Promise<OidcClaims> {
  if (typeof idToken !== "string" || idToken.length > 16384)
    throw invalidToken();
  const parts = idToken.split(".");
  if (parts.length !== 3) throw invalidToken();
  const header = decodeSegment(parts[0]),
    claims = decodeSegment(parts[1]);
  if (!/^[A-Za-z0-9_-]+$/.test(parts[2])) throw invalidToken();
  if (
    !["RS256", "ES256"].includes(header?.alg) ||
    typeof header.kid !== "string" ||
    header.crit !== undefined
  )
    throw invalidToken("uses an unsupported signature");
  const discovery = await oidcDiscovery(provider);
  if (
    Array.isArray(discovery.id_token_signing_alg_values_supported) &&
    !discovery.id_token_signing_alg_values_supported.includes(header.alg)
  )
    throw invalidToken("uses an unsupported signature");
  const find = (keys: JsonWebKey[]) =>
    keys.find(
      (key: any) =>
        key.kid === header.kid &&
        (key.alg === undefined || key.alg === header.alg),
    );
  let jwk = find(await signingKeys(discovery));
  if (!jwk) jwk = find(await signingKeys(discovery, true));
  if (!jwk) throw invalidToken("was signed by an unknown key");
  let key: KeyObject;
  try {
    key = createPublicKey({ key: jwk as any, format: "jwk" });
  } catch {
    throw invalidToken("was signed by an unusable key");
  }
  if (
    (header.alg === "RS256" && key.asymmetricKeyType !== "rsa") ||
    (header.alg === "ES256" &&
      (key.asymmetricKeyType !== "ec" ||
        key.asymmetricKeyDetails?.namedCurve !== "prime256v1"))
  )
    throw invalidToken("was signed by a mismatched key");
  const valid = verifyBytes(
    "sha256",
    Buffer.from(parts[0] + "." + parts[1]),
    header.alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key,
    Buffer.from(parts[2], "base64url"),
  );
  if (!valid) throw invalidToken("signature is invalid");
  const seconds = now() / 1000,
    skew = 60;
  if (!acceptedIssuers(provider).includes(claims?.iss))
    throw invalidToken("came from an unexpected issuer");
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !audience.includes(expected.clientId) ||
    (audience.length > 1 && claims.azp !== expected.clientId) ||
    (claims.azp !== undefined && claims.azp !== expected.clientId)
  )
    throw invalidToken("was issued for another application");
  if (typeof claims.exp !== "number" || claims.exp + skew <= seconds)
    throw invalidToken("has expired");
  if (
    typeof claims.iat !== "number" ||
    claims.iat - skew > seconds ||
    seconds - claims.iat > 600
  )
    throw invalidToken("is not current");
  if (
    claims.nbf !== undefined &&
    (typeof claims.nbf !== "number" || claims.nbf - skew > seconds)
  )
    throw invalidToken("is not yet valid");
  if (
    typeof claims.nonce !== "string" ||
    !sameText(claims.nonce, expected.nonce)
  )
    throw invalidToken("does not belong to this sign-in");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255)
    throw invalidToken("has no subject");
  const email =
    typeof claims.email === "string" &&
    claims.email.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email.trim())
      ? claims.email.trim().toLowerCase()
      : null;
  return {
    issuer: claims.iss,
    subject: claims.sub,
    email,
    // Apple sends the flag as a string, Google as a boolean.
    emailVerified:
      email !== null &&
      (claims.email_verified === true || claims.email_verified === "true"),
    name:
      typeof claims.name === "string" && claims.name.trim()
        ? claims.name.trim().slice(0, 100)
        : null,
  };
}

/**
 * The Apple .p8 key arrives without line breaks (settings values are single
 * line); PEM markers and whitespace are ignored. Only a P-256 PKCS#8 key is
 * accepted.
 */
export function applePrivateKey(text: string): KeyObject {
  const body = text
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  let key: KeyObject;
  try {
    if (!/^[A-Za-z0-9+/]+=*$/.test(body)) throw new Error("format");
    key = createPrivateKey({
      key: Buffer.from(body, "base64"),
      format: "der",
      type: "pkcs8",
    });
  } catch {
    throw new ConfigurationError(
      "The Apple private key must be the contents of the .p8 key file",
    );
  }
  if (
    key.asymmetricKeyType !== "ec" ||
    key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  )
    throw new ConfigurationError(
      "The Apple private key must be a P-256 (ES256) key",
    );
  return key;
}
/** Apple requires the client secret to be a short-lived ES256-signed JWT. */
export function appleClientSecret(client: OidcClientConfig, issuedAt = now()) {
  if (!client.apple) throw new ConfigurationError("Apple settings missing");
  const key = applePrivateKey(client.apple.privateKey),
    iat = Math.floor(issuedAt / 1000);
  const input =
    segment({ alg: "ES256", kid: client.apple.keyId, typ: "JWT" }) +
    "." +
    segment({
      iss: client.apple.teamId,
      iat,
      exp: iat + 300,
      aud: oidcIssuer("apple"),
      sub: client.clientId,
    });
  return (
    input +
    "." +
    signBytes("sha256", Buffer.from(input), {
      key,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url")
  );
}
function clientSecret(client: OidcClientConfig) {
  return client.provider === "apple"
    ? appleClientSecret(client)
    : (client.clientSecret ?? "");
}
export async function oidcAuthorizationUrl(
  client: OidcClientConfig,
  input: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  },
) {
  const discovery = await oidcDiscovery(client.provider),
    provider = OIDC_PROVIDERS[client.provider],
    url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", provider.scope);
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (provider.responseMode)
    url.searchParams.set("response_mode", provider.responseMode);
  if (client.provider === "google")
    url.searchParams.set("prompt", "select_account");
  return url.toString();
}
async function tokenRequest(
  client: OidcClientConfig,
  fields: Record<string, string>,
) {
  const discovery = await oidcDiscovery(client.provider),
    body = new URLSearchParams({
      ...fields,
      client_id: client.clientId,
      client_secret: clientSecret(client),
    }).toString();
  return providerRequest(discovery.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(Buffer.byteLength(body)),
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
}
/** Exchanges the code with the PKCE verifier; only the ID token is used. */
export async function exchangeAuthorizationCode(
  client: OidcClientConfig,
  input: { code: string; redirectUri: string; codeVerifier: string },
) {
  const name = OIDC_PROVIDERS[client.provider].name;
  let response: Response;
  try {
    response = await tokenRequest(client, {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    });
  } catch (error) {
    if (error instanceof OidcError) throw error;
    throw new OidcError(
      "OIDC_UNAVAILABLE",
      `${name} could not be reached to finish signing in`,
    );
  }
  const payload = await json(
    response,
    "OIDC_TOKEN_REJECTED",
    `${name} did not accept the sign-in`,
  );
  if (!response.ok || typeof payload?.id_token !== "string")
    throw new OidcError(
      "OIDC_TOKEN_REJECTED",
      `${name} did not accept the sign-in`,
    );
  return { idToken: payload.id_token as string };
}
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

/**
 * Superadmin connection check: live discovery document and signing keys,
 * local Apple key validation, then a token-endpoint probe with a code that
 * cannot exist. A valid client receives invalid_grant; rejected credentials
 * receive invalid_client. No sign-in is performed and nothing is stored.
 */
export async function checkOidcConnection(
  provider: OidcProviderId,
  config: RuntimeConfig,
): Promise<IntegrationTestResult> {
  const checkedAt = new Date().toISOString(),
    name = OIDC_PROVIDERS[provider].name;
  const client = oidcClientConfig(provider, config);
  if (!client)
    return {
      status: "failed",
      message: `Required ${name} sign-in settings are missing.`,
      checkedAt,
    };
  try {
    if (client.apple) applePrivateKey(client.apple.privateKey);
    const discovery = await oidcDiscovery(provider, true);
    if (
      Array.isArray(discovery.response_types_supported) &&
      !discovery.response_types_supported.includes("code")
    )
      return {
        status: "failed",
        message: `${name} does not advertise the authorization code flow.`,
        checkedAt,
      };
    const keys = await signingKeys(discovery, true);
    if (!keys.length)
      return {
        status: "failed",
        message: `${name} published no usable signing keys.`,
        checkedAt,
      };
    const origin = new URL(
      runtimeConfig().PUBLIC_APP_URL ?? "http://localhost:3000",
    ).origin;
    const response = await tokenRequest(client, {
      grant_type: "authorization_code",
      code: "connection-check-" + randomBytes(12).toString("hex"),
      redirect_uri: oidcRedirectUri(provider, origin),
      code_verifier: randomBytes(32).toString("base64url"),
    });
    const payload = await response.json().catch(() => ({}) as any);
    const details = {
      issuer: discovery.issuer,
      signingKeys: keys.length,
      pkceAdvertised:
        Array.isArray(discovery.code_challenge_methods_supported) &&
        discovery.code_challenge_methods_supported.includes("S256"),
    };
    if (payload?.error === "invalid_grant")
      return {
        status: "verified",
        message: `${name} discovery, signing keys and client credentials verified without signing anyone in. Register ${oidcRedirectUri(provider, origin)} as the return URL.`,
        checkedAt,
        details,
      };
    if (["invalid_client", "unauthorized_client"].includes(payload?.error))
      return {
        status: "failed",
        message: `${name} rejected the client credentials.`,
        checkedAt,
        details,
      };
    return {
      status: "validated",
      message: `${name} discovery and signing keys verified. The client credentials could not be confirmed by the provider response.`,
      checkedAt,
      details,
    };
  } catch (error) {
    return {
      status: "failed",
      message:
        error instanceof ConfigurationError || error instanceof OidcError
          ? error.message
          : `${name} connection check could not complete.`,
      checkedAt,
    };
  }
}
