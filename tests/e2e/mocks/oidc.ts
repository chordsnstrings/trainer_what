/**
 * OpenID Connect issuer doubles for "Sign in with Google" (RS256, query
 * response) and "Sign in with Apple" (ES256, form_post response, ES256
 * client-secret JWT). Discovery, signing keys, an authorization endpoint that
 * signs in whoever the scenario chose, and a token endpoint that checks the
 * client credentials, the redirect address, PKCE and single use of each code.
 * The application reaches these only through the sandbox-only
 * GOOGLE_OIDC_ISSUER / APPLE_OIDC_ISSUER overrides. Test tooling only.
 */
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { MockServer, type MockRequest, type MockResponse } from "./http.ts";

export type OidcIdentity = { sub: string; email: string; emailVerified?: boolean; name?: string };
type PendingCode = {
  clientId: string;
  redirectUri: string;
  nonce: string;
  challenge: string;
  identity: OidcIdentity;
  used: boolean;
};

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export class OidcMock {
  readonly server: MockServer;
  readonly kid = "mock-" + randomBytes(4).toString("hex");
  private signingKey: KeyObject;
  private publicJwk: Record<string, unknown>;
  private codes = new Map<string, PendingCode>();
  /** Who the next visit to the authorization endpoint signs in as. */
  nextIdentity?: OidcIdentity;
  readonly clientId: string;
  readonly clientSecret?: string;
  /** Apple only: the Services key the platform signs its client secret with. */
  readonly apple?: { teamId: string; keyId: string; privateKeyText: string; publicKey: KeyObject };
  tokenExchanges = 0;
  rejectedClients = 0;

  constructor(
    tlsMaterial: { key: string; cert: string },
    readonly provider: "google" | "apple",
  ) {
    this.server = new MockServer(provider + "-oidc", tlsMaterial, { logBodies: false });
    if (provider === "google") {
      const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
      this.signingKey = pair.privateKey;
      this.publicJwk = { ...pair.publicKey.export({ format: "jwk" }), kid: this.kid, alg: "RS256", use: "sig" };
      this.clientId = "mock-google-" + randomBytes(6).toString("hex") + ".apps.googleusercontent.example";
      this.clientSecret = "GOCSPX-mock-" + randomBytes(12).toString("hex");
    } else {
      const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      this.signingKey = pair.privateKey;
      this.publicJwk = { ...pair.publicKey.export({ format: "jwk" }), kid: this.kid, alg: "ES256", use: "sig" };
      this.clientId = "example.sandbox.signin";
      const services = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      this.apple = {
        teamId: "MOCKTEAM01",
        keyId: "MOCKKEY001",
        // The .p8 body without line breaks, as the settings field stores it.
        privateKeyText: (services.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("base64"),
        publicKey: services.publicKey,
      };
    }
    const s = this.server;
    s.route("GET", "/.well-known/openid-configuration", () => ({
      headers: { "cache-control": "public, max-age=300" },
      body: {
        issuer: this.issuer,
        authorization_endpoint: this.issuer + "/authorize",
        token_endpoint: this.issuer + "/token",
        jwks_uri: this.issuer + "/keys",
        response_types_supported: ["code"],
        response_modes_supported: provider === "apple" ? ["query", "fragment", "form_post"] : ["query"],
        id_token_signing_alg_values_supported: [provider === "google" ? "RS256" : "ES256"],
        subject_types_supported: ["public", "pairwise"],
        ...(provider === "google" ? { code_challenge_methods_supported: ["S256"] } : {}),
      },
    }));
    s.route("GET", "/keys", () => ({
      headers: { "cache-control": "public, max-age=300" },
      body: { keys: [this.publicJwk] },
    }));
    s.route("GET", "/authorize", (r) => this.authorize(r));
    s.route("POST", "/token", (r) => this.token(r));
  }
  get issuer() {
    return this.server.url;
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }
  /** Values the Superadmin saves for this connection. */
  settings(): { values: Record<string, string>; secrets: Record<string, string> } {
    if (this.provider === "google")
      return {
        values: { GOOGLE_SIGNIN_CLIENT_ID: this.clientId },
        secrets: { GOOGLE_SIGNIN_CLIENT_SECRET: this.clientSecret! },
      };
    return {
      values: {
        APPLE_SIGNIN_SERVICES_ID: this.clientId,
        APPLE_SIGNIN_TEAM_ID: this.apple!.teamId,
        APPLE_SIGNIN_KEY_ID: this.apple!.keyId,
      },
      secrets: { APPLE_SIGNIN_PRIVATE_KEY: this.apple!.privateKeyText },
    };
  }

  private authorize(r: MockRequest): MockResponse {
    const q = r.query;
    const identity = this.nextIdentity;
    this.nextIdentity = undefined;
    if (q.get("client_id") !== this.clientId) return { status: 400, body: "unknown client" };
    if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge"))
      return { status: 400, body: "authorization code flow with PKCE (S256) required" };
    const redirectUri = q.get("redirect_uri") ?? "";
    if (!/^https:\/\/localhost:\d+\/api\/v1\/auth\/oidc\/(google|apple)\/callback$/.test(redirectUri))
      return { status: 400, body: "redirect_uri is not registered" };
    if (this.provider === "apple" && q.get("response_mode") !== "form_post")
      return { status: 400, body: "Apple requires form_post when name or email is requested" };
    if (!identity) return { status: 401, body: "no mock account chose to sign in" };
    const code = "c_" + randomBytes(24).toString("base64url");
    this.codes.set(code, {
      clientId: this.clientId,
      redirectUri,
      nonce: q.get("nonce") ?? "",
      challenge: q.get("code_challenge") ?? "",
      identity,
      used: false,
    });
    const state = q.get("state") ?? "";
    if (this.provider === "google") {
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      target.searchParams.set("state", state);
      return { status: 302, headers: { location: target.toString() }, body: "" };
    }
    // Apple posts the result back with an auto-submitting form.
    const user = identity.name
      ? JSON.stringify({ name: { firstName: identity.name.split(" ")[0], lastName: identity.name.split(" ").slice(1).join(" ") }, email: identity.email })
      : "";
    const field = (name: string, value: string) =>
      `<input type="hidden" name="${name}" value="${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`;
    return {
      headers: { "content-type": "text/html; charset=utf-8" },
      body: `<!doctype html><form method="post" action="${redirectUri}">${field("code", code)}${field("state", state)}${user ? field("user", user) : ""}</form><script>document.forms[0].submit()</script>`,
    };
  }

  private clientAuthenticated(form: Record<string, string>) {
    if (form.client_id !== this.clientId) return false;
    if (this.provider === "google") return form.client_secret === this.clientSecret;
    const parts = String(form.client_secret ?? "").split(".");
    if (parts.length !== 3) return false;
    try {
      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      const now = Date.now() / 1000;
      return (
        header.alg === "ES256" &&
        header.kid === this.apple!.keyId &&
        claims.iss === this.apple!.teamId &&
        claims.sub === this.clientId &&
        claims.aud === this.issuer &&
        claims.exp > now &&
        claims.iat <= now + 60 &&
        verify(
          "sha256",
          Buffer.from(parts[0] + "." + parts[1]),
          { key: this.apple!.publicKey, dsaEncoding: "ieee-p1363" },
          Buffer.from(parts[2], "base64url"),
        )
      );
    } catch {
      return false;
    }
  }

  private token(r: MockRequest): MockResponse {
    const form = Object.fromEntries(new URLSearchParams(r.rawBody)) as Record<string, string>;
    if (!this.clientAuthenticated(form)) {
      this.rejectedClients++;
      return { status: 401, body: { error: "invalid_client" } };
    }
    if (form.grant_type !== "authorization_code") return { status: 400, body: { error: "unsupported_grant_type" } };
    const pending = this.codes.get(form.code ?? "");
    if (!pending || pending.used) return { status: 400, body: { error: "invalid_grant" } };
    pending.used = true;
    if (pending.redirectUri !== form.redirect_uri) return { status: 400, body: { error: "invalid_grant", error_description: "redirect_uri mismatch" } };
    const challenge = createHash("sha256").update(form.code_verifier ?? "").digest("base64url");
    if (challenge !== pending.challenge) return { status: 400, body: { error: "invalid_grant", error_description: "PKCE verification failed" } };
    this.tokenExchanges++;
    const iat = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: this.issuer,
      aud: this.clientId,
      sub: pending.identity.sub,
      email: pending.identity.email,
      email_verified: this.provider === "apple" ? String(pending.identity.emailVerified ?? true) : pending.identity.emailVerified ?? true,
      nonce: pending.nonce,
      iat,
      exp: iat + 600,
      ...(this.provider === "google" ? { azp: this.clientId, ...(pending.identity.name ? { name: pending.identity.name } : {}) } : {}),
    };
    const alg = this.provider === "google" ? "RS256" : "ES256";
    const input = b64({ alg, kid: this.kid, typ: "JWT" }) + "." + b64(claims);
    const signature = sign(
      "sha256",
      Buffer.from(input),
      alg === "ES256" ? { key: this.signingKey, dsaEncoding: "ieee-p1363" } : this.signingKey,
    ).toString("base64url");
    return {
      body: {
        access_token: "at_" + randomBytes(16).toString("hex"),
        token_type: "Bearer",
        expires_in: 3600,
        id_token: input + "." + signature,
      },
    };
  }
}
