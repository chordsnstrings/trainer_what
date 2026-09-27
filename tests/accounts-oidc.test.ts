import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  accountsContext,
  cookieValue,
  ok,
  password,
  sessionCookie,
  withEnv,
  type Person,
} from "./accounts-fixtures.ts";
import {
  checkOidcConnection,
  setOidcTestOverrides,
  verifyIdToken,
} from "../packages/providers/src/oidc.ts";

// Mock OpenID providers on reserved .test domains, served through the
// existing fixture transport (fetch replacement for *.test under node --test).
const GOOGLE = "https://google.oidc.test",
  APPLE = "https://apple.oidc.test";
let clock = Date.now();
const now = () => clock;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const s256 = (v: string) => createHash("sha256").update(v).digest("base64url");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });
type MockUser = {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
};
class MockIssuer {
  keys: Array<{ kid: string; privateKey: KeyObject; jwk: any }> = [];
  codes = new Map<string, any>();
  fetches = { discovery: 0, jwks: 0, token: 0 };
  issuerOverride: string | null = null;
  constructor(
    public issuer: string,
    public clientId: () => string,
    public verifyClient: (form: URLSearchParams) => boolean,
    public emailVerifiedAsString = false,
  ) {
    this.addKey();
  }
  addKey() {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const kid = "kid-" + randomUUID().slice(0, 8);
    this.keys.push({
      kid,
      privateKey,
      jwk: { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" },
    });
    return kid;
  }
  mint(claims: Record<string, unknown>, options: { kid?: string; key?: KeyObject } = {}) {
    const key = this.keys.find((k) => k.kid === (options.kid ?? this.keys.at(-1)!.kid))!;
    const input = b64({ alg: "RS256", kid: key.kid, typ: "JWT" }) + "." + b64(claims);
    return (
      input +
      "." +
      sign("sha256", Buffer.from(input), options.key ?? key.privateKey).toString("base64url")
    );
  }
  claims(user: MockUser, nonce: string, extra: Record<string, unknown> = {}) {
    const t = Math.floor(now() / 1000);
    return {
      iss: this.issuer,
      aud: this.clientId(),
      sub: user.sub,
      ...(user.email ? { email: user.email } : {}),
      email_verified: this.emailVerifiedAsString
        ? String(user.email_verified ?? true)
        : (user.email_verified ?? true),
      ...(user.name ? { name: user.name } : {}),
      nonce,
      iat: t,
      exp: t + 600,
      ...extra,
    };
  }
  authorize(url: URL, user: MockUser) {
    assert.equal(url.origin + url.pathname, this.issuer + "/authorize");
    const q = url.searchParams;
    assert.equal(q.get("response_type"), "code");
    assert.equal(q.get("code_challenge_method"), "S256");
    for (const key of ["state", "nonce", "code_challenge", "redirect_uri"])
      assert.ok(q.get(key), key);
    const code = "code-" + randomUUID();
    this.codes.set(code, {
      clientId: q.get("client_id"),
      redirectUri: q.get("redirect_uri"),
      nonce: q.get("nonce"),
      challenge: q.get("code_challenge"),
      user,
    });
    return { code, state: q.get("state")! };
  }
  handle(url: URL, init: RequestInit = {}) {
    if (url.pathname === "/.well-known/openid-configuration") {
      this.fetches.discovery++;
      return json({
        issuer: this.issuerOverride ?? this.issuer,
        authorization_endpoint: this.issuer + "/authorize",
        token_endpoint: this.issuer + "/token",
        jwks_uri: this.issuer + "/jwks",
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") {
      this.fetches.jwks++;
      return json({ keys: this.keys.map((k) => k.jwk) });
    }
    if (url.pathname === "/token") {
      this.fetches.token++;
      const form = new URLSearchParams(String(init.body));
      if (form.get("client_id") !== this.clientId() || !this.verifyClient(form))
        return json({ error: "invalid_client" }, 401);
      const grant = this.codes.get(form.get("code") ?? "");
      if (!grant) return json({ error: "invalid_grant" }, 400);
      this.codes.delete(form.get("code")!);
      if (
        form.get("grant_type") !== "authorization_code" ||
        grant.redirectUri !== form.get("redirect_uri") ||
        s256(form.get("code_verifier") ?? "") !== grant.challenge
      )
        return json({ error: "invalid_grant" }, 400);
      return json({
        access_token: "unused",
        token_type: "Bearer",
        id_token: this.mint(this.claims(grant.user, grant.nonce)),
      });
    }
    return json({ error: "not_found" }, 404);
  }
}

const settings = {
  google: { id: "google-client.apps.test", secret: "google-secret-" + randomUUID() },
  apple: {
    services: "test.trainer.signin",
    team: "TEAM123456",
    keyId: "KEY1234567",
    ...(() => {
      const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      return {
        publicKey,
        pem: String(privateKey.export({ type: "pkcs8", format: "pem" })).replace(/\n/g, ""),
      };
    })(),
  },
};
function appleClientValid(form: URLSearchParams) {
  const parts = String(form.get("client_secret")).split(".");
  if (parts.length !== 3) return false;
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  return (
    header.alg === "ES256" &&
    header.kid === settings.apple.keyId &&
    verify(
      "sha256",
      Buffer.from(parts[0] + "." + parts[1]),
      { key: settings.apple.publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(parts[2], "base64url"),
    ) &&
    claims.iss === settings.apple.team &&
    claims.sub === settings.apple.services &&
    claims.aud === APPLE &&
    claims.exp > now() / 1000 &&
    claims.exp - claims.iat <= 300
  );
}
let googleSecretAccepted = settings.google.secret;
const google = new MockIssuer(
  GOOGLE,
  () => settings.google.id,
  (form) => form.get("client_secret") === googleSecretAccepted,
);
const apple = new MockIssuer(APPLE, () => settings.apple.services, appleClientValid, true);

let ctx: Awaited<ReturnType<typeof accountsContext>>, admin: Person;
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.origin === GOOGLE) return google.handle(url, init);
    if (url.origin === APPLE) return apple.handle(url, init);
    throw new Error("Unexpected network request in test: " + url.origin);
  }) as typeof fetch;
  setOidcTestOverrides({ issuers: { google: GOOGLE, apple: APPLE }, now });
  ctx = await accountsContext();
  admin = await ctx.person({ platformRole: "admin", mfa: true, mfaFresh: true });
});
after(async () => {
  await ctx.close();
  globalThis.fetch = originalFetch;
});

async function saveSettings(
  id: string,
  values: Record<string, string>,
  secrets: Record<string, string>,
) {
  const current = ok(await ctx.call("/admin/settings", { cookie: admin.cookie })).integrations.find(
    (i: any) => i.id === id,
  );
  return ok(
    await ctx.call(`/admin/settings/${id}`, {
      method: "PUT",
      body: { revision: current.revision, enabled: true, values, secrets },
      cookie: admin.cookie,
    }),
  );
}
async function testSettings(id: string, revision: number) {
  return ok(
    await ctx.call(`/admin/settings/${id}/test`, { body: { revision }, cookie: admin.cookie }),
  );
}
async function providers() {
  return Object.fromEntries(
    ok(await ctx.call("/auth/oidc/providers")).providers.map((p: any) => [p.id, p.enabled]),
  );
}
async function start(
  provider: "google" | "apple",
  body: Record<string, unknown>,
  cookie?: string,
  path = "start",
) {
  const r = await ctx.call(`/auth/oidc/${provider}/${path}`, { body, cookie });
  const payload = ok(r);
  return {
    url: new URL(payload.authorizationUrl),
    binder: cookieValue(r, "oidc_binder"),
  };
}
async function finish(
  provider: "google" | "apple",
  flow: { url: URL; binder: string },
  user: MockUser,
  options: { binder?: string; extra?: Record<string, string> } = {},
) {
  const issuer = provider === "google" ? google : apple;
  const { code, state } = issuer.authorize(flow.url, user);
  const cookie = options.binder ?? flow.binder;
  if (provider === "google")
    return ctx.call(
      `/auth/oidc/google/callback?${new URLSearchParams({ code, state, ...options.extra })}`,
      { cookie },
    );
  return ctx.call("/auth/oidc/apple/callback", {
    method: "POST",
    body: new URLSearchParams({ code, state, ...options.extra }).toString(),
    cookie,
    headers: {
      origin: "https://appleid.apple.com",
      "content-type": "application/x-www-form-urlencoded",
    },
  });
}
const location = (r: any) => String(r.headers.location ?? "");

test("Apple and Google sign-in stay off until Superadmin settings hold encrypted credentials and pass the discovery connection check", async () => {
  assert.deepEqual(await providers(), { google: false, apple: false });
  const closed = await ctx.call("/auth/oidc/google/start", { body: { intent: "sign_in" } });
  assert.equal(closed.statusCode, 503);
  assert.match(closed.json().message, /not available yet/);
  googleSecretAccepted = "the-real-secret";
  let saved = await saveSettings(
    "google_signin",
    { GOOGLE_SIGNIN_CLIENT_ID: settings.google.id },
    { GOOGLE_SIGNIN_CLIENT_SECRET: settings.google.secret },
  );
  assert.equal((await providers()).google, false, "saving alone does not activate");
  const rejected = await testSettings("google_signin", saved.revision);
  assert.equal(rejected.lastTest.status, "failed", "a rejected client secret fails the check");
  assert.equal((await providers()).google, false);
  googleSecretAccepted = settings.google.secret;
  saved = await saveSettings(
    "google_signin",
    { GOOGLE_SIGNIN_CLIENT_ID: settings.google.id },
    { GOOGLE_SIGNIN_CLIENT_SECRET: settings.google.secret },
  );
  const discoveryBefore = google.fetches.discovery;
  const verified = await testSettings("google_signin", saved.revision);
  assert.equal(verified.lastTest.status, "verified");
  assert.ok(google.fetches.discovery > discoveryBefore, "the check reads the live discovery document");
  const appleSaved = await saveSettings(
    "apple_signin",
    {
      APPLE_SIGNIN_SERVICES_ID: settings.apple.services,
      APPLE_SIGNIN_TEAM_ID: settings.apple.team,
      APPLE_SIGNIN_KEY_ID: settings.apple.keyId,
    },
    { APPLE_SIGNIN_PRIVATE_KEY: settings.apple.pem },
  );
  assert.equal((await testSettings("apple_signin", appleSaved.revision)).lastTest.status, "verified");
  assert.deepEqual(await providers(), { google: true, apple: true });
  const [row] = await ctx.db.system((tx) =>
    tx.query("SELECT encrypted_secrets::text AS stored FROM platform_settings WHERE integration_id='apple_signin'"),
  );
  assert.doesNotMatch(row.stored, /BEGIN PRIVATE KEY|MIG/);
  const [googleRow] = await ctx.db.system((tx) =>
    tx.query("SELECT encrypted_secrets::text AS stored FROM platform_settings WHERE integration_id='google_signin'"),
  );
  assert.doesNotMatch(googleRow.stored, new RegExp(settings.google.secret));
  // A discovery document naming another issuer fails the check.
  google.issuerOverride = "https://impostor.oidc.test";
  const mismatch = await checkOidcConnection("google", {
    GOOGLE_SIGNIN_CLIENT_ID: settings.google.id,
    GOOGLE_SIGNIN_CLIENT_SECRET: settings.google.secret,
  });
  google.issuerOverride = null;
  assert.equal(mismatch.status, "failed");
  const badKey = await checkOidcConnection("apple", {
    APPLE_SIGNIN_SERVICES_ID: "x",
    APPLE_SIGNIN_TEAM_ID: "y",
    APPLE_SIGNIN_KEY_ID: "z",
    APPLE_SIGNIN_PRIVATE_KEY: "not a key",
  });
  assert.equal(badKey.status, "failed");
  assert.match(badKey.message, /\.p8/);
  assert.throws(() => setOidcTestOverrides({ issuers: { google: "https://accounts.google.com" } }));
  setOidcTestOverrides({ issuers: { google: GOOGLE, apple: APPLE }, now });
});

test("Google sign-in binds state, nonce and PKCE to the starting browser and links only a verified matching email", async () => {
  const member = await ctx.person({ role: "subscriber", tenantId: (await ctx.person()).tenantId });
  const flow = await start("google", { intent: "sign_in" });
  assert.ok(flow.binder.startsWith("oidc_binder="));
  const [stored] = await ctx.db.system((tx) =>
    tx.query("SELECT payload::text AS payload,state_hash,binder_hash FROM oidc_sign_in_requests ORDER BY created_at DESC LIMIT 1"),
  );
  assert.notEqual(stored.state_hash, flow.url.searchParams.get("state"));
  assert.doesNotMatch(stored.payload, new RegExp(flow.url.searchParams.get("nonce")!));
  // The same callback in another browser (no binder) never signs in.
  const hijacked = await finish("google", flow, { sub: "g-" + member.userId, email: member.email }, { binder: "oidc_binder=forged" });
  assert.equal(hijacked.statusCode, 303);
  assert.equal(location(hijacked), "/login?signin_error=OIDC_BROWSER_MISMATCH");
  assert.equal(sessionCookie(hijacked), "");
  const second = await start("google", { intent: "sign_in" });
  const signedIn = await finish("google", second, { sub: "g-" + member.userId, email: member.email });
  assert.equal(signedIn.statusCode, 303, signedIn.body);
  assert.equal(location(signedIn), "/app");
  const cookie = sessionCookie(signedIn);
  assert.equal(ok(await ctx.call("/bootstrap", { cookie })).user.userId, member.userId);
  const account = ok(await ctx.call("/account", { cookie }));
  assert.deepEqual(account.identities.map((i: any) => i.provider), ["google"]);
  assert.ok(account.notices.some((n: any) => n.kind === "identity_linked"));
  const [audit] = await ctx.events(member.tenantId, "security.oidc_signed_in", member.userId);
  assert.deepEqual(audit.data, { provider: "google", linkedAutomatically: true, accountCreated: false });
  const [linkedMail] = await ctx.emailJobs(member.tenantId, member.email, "identity-linked");
  assert.match(linkedMail.data.text, /Google can now be used to sign in/);
  const exported = ok(await ctx.call("/privacy/export", { cookie }));
  assert.deepEqual(
    exported.signInIdentities.map((i: any) => [i.provider, i.subject]),
    [["google", "g-" + member.userId]],
  );
  // Replaying the completed callback cannot sign in again.
  const replay = await ctx.call(
    `/auth/oidc/google/callback?${new URLSearchParams({ code: "code-replayed", state: second.url.searchParams.get("state")! })}`,
    { cookie: second.binder },
  );
  assert.equal(location(replay), "/login?signin_error=OIDC_EXPIRED");
  const cancelled = await start("google", { intent: "sign_in" });
  const refusal = await ctx.call(
    `/auth/oidc/google/callback?${new URLSearchParams({ error: "access_denied", state: cancelled.url.searchParams.get("state")! })}`,
    { cookie: cancelled.binder },
  );
  assert.equal(location(refusal), "/login?signin_error=OIDC_CANCELLED");
  const cases: Array<[Promise<Person> | Person, MockUser, string]> = [
    [ctx.person({ verified: false }), { sub: "g-unverified-local" }, "OIDC_LINK_REQUIRED"],
    [ctx.person({ platformRole: "support" }), { sub: "g-platform" }, "OIDC_LINK_REQUIRED"],
    [ctx.person(), { sub: "g-unverified-provider", email_verified: false }, "OIDC_EMAIL_UNVERIFIED"],
  ];
  for (const [who, user, code] of cases) {
    const p = await who;
    const r = await finish("google", await start("google", { intent: "sign_in" }), { email: p.email, ...user });
    assert.equal(location(r), `/login?signin_error=${code}`);
    const [linked] = await ctx.db.system((tx) =>
      tx.query("SELECT count(*)::int n FROM account_identities WHERE user_id=$1", [p.userId]),
    );
    assert.equal(linked.n, 0);
  }
  const unknown = `nobody-${randomUUID()}@example.test`;
  const none = await finish("google", await start("google", { intent: "sign_in" }), { sub: "g-new", email: unknown });
  assert.equal(location(none), "/login?signin_error=OIDC_NO_ACCOUNT");
  const [created] = await ctx.db.system((tx) =>
    tx.query("SELECT count(*)::int n FROM users WHERE email=$1", [unknown]),
  );
  assert.equal(created.n, 0, "plain sign-in never creates an account");
});

test("new accounts come only from a public join or an invitation, under the legal gate and explicit terms acceptance", async () => {
  const trainer = await ctx.person();
  const [{ slug }] = await ctx.db.system((tx) =>
    tx.query("SELECT slug FROM tenants WHERE id=$1", [trainer.tenantId]),
  );
  const unaccepted = await ctx.call("/auth/oidc/google/start", { body: { intent: "join", coachSlug: slug } });
  assert.equal(unaccepted.json().code, "TERMS_REQUIRED");
  await withEnv({ NODE_ENV: "production", LEGAL_APPROVED: undefined }, async () => {
    const pending = await ctx.call("/auth/oidc/google/start", {
      body: { intent: "join", coachSlug: slug, accepted: true },
    });
    assert.equal(pending.statusCode, 503);
    assert.equal(pending.json().code, "LEGAL_PENDING");
  });
  const email = `joiner-${randomUUID()}@example.test`;
  const joined = await finish(
    "google",
    await start("google", { intent: "join", coachSlug: slug, accepted: true }),
    { sub: "g-joiner-" + randomUUID(), email, name: "Joining Person" },
  );
  assert.equal(location(joined), "/app");
  const cookie = sessionCookie(joined);
  const account = ok(await ctx.call("/account", { cookie }));
  assert.equal(account.profile.email, email);
  assert.equal(account.profile.name, "Joining Person");
  assert.equal(account.profile.emailVerified, true);
  assert.equal(account.profile.hasPassword, false);
  const boot = ok(await ctx.call("/bootstrap", { cookie }));
  assert.equal(boot.user.role, "subscriber");
  assert.equal(boot.tenant.id, trainer.tenantId);
  assert.equal(boot.consents.filter((c: any) => c.document_type === "registration").length, 1);
  assert.equal((await ctx.events(trainer.tenantId, "subscriber.enrolled", boot.user.userId)).length, 1);
  // Password sign-in is impossible until the member sets a password.
  assert.equal((await ctx.call("/auth/login", { body: { email, password } })).statusCode, 401);
  // Invitations: the provider email must be the invited address.
  const invitedEmail = `invited-${randomUUID()}@example.test`;
  const invitation = ok(
    await ctx.call("/invitations", { body: { email: invitedEmail, role: "subscriber" }, cookie: trainer.cookie }),
  );
  const inviteToken = String(invitation.url).split("/").pop()!;
  const mismatch = await finish(
    "google",
    await start("google", { intent: "invite", inviteToken, accepted: true }),
    { sub: "g-wrong-" + randomUUID(), email: `other-${randomUUID()}@example.test` },
  );
  assert.equal(location(mismatch), "/login?signin_error=INVITE_EMAIL_MISMATCH");
  const accepted = await finish(
    "google",
    await start("google", { intent: "invite", inviteToken, accepted: true }),
    { sub: "g-invited-" + randomUUID(), email: invitedEmail },
  );
  assert.equal(location(accepted), "/app");
  const [invite] = await ctx.db.system((tx) =>
    tx.query("SELECT consumed_at IS NOT NULL AS used FROM one_time_tokens WHERE token_hash=$1", [
      createHash("sha256").update(inviteToken).digest("hex"),
    ]),
  );
  assert.equal(invite.used, true);
  const again = await ctx.call("/auth/oidc/google/start", {
    body: { intent: "invite", inviteToken, accepted: true },
  });
  assert.equal(again.json().code, "INVALID_INVITE");
});

test("an enrolled authenticator is still required after Apple or Google confirms the identity", async () => {
  const trainer = await ctx.person();
  const member = await ctx.person({ mfa: true, role: "staff", tenantId: trainer.tenantId });
  const sub = "g-mfa-" + member.userId;
  const flow = await start("google", { intent: "sign_in" });
  const r = await finish("google", flow, { sub, email: member.email });
  assert.equal(location(r), "/sign-in/verify");
  assert.equal(sessionCookie(r), "", "no session before the authenticator code");
  const linkedCount = async () =>
    (
      await ctx.db.system((tx) =>
        tx.query("SELECT count(*)::int n FROM account_identities WHERE user_id=$1", [member.userId]),
      )
    )[0].n;
  assert.equal(await linkedCount(), 0, "nothing is linked until the sign-in completes");
  assert.equal(ok(await ctx.call("/auth/oidc/pending", { cookie: flow.binder })).provider, "google");
  assert.equal((await ctx.call("/auth/oidc/pending")).statusCode, 404, "bound to the starting browser");
  const wrong = await ctx.call("/auth/oidc/verify", { body: { code: "000000" }, cookie: flow.binder });
  assert.equal(wrong.statusCode, 401);
  const done = await ctx.call("/auth/oidc/verify", {
    body: { code: await ctx.freshCode(member.userId) },
    cookie: flow.binder,
  });
  assert.equal(ok(done).redirect, "/trainer");
  const cookie = sessionCookie(done);
  const [session] = await ctx.db.system((tx) =>
    tx.query("SELECT mfa_at IS NOT NULL AS mfa FROM sessions WHERE token_hash=$1", [
      createHash("sha256").update(cookie.slice("session=".length)).digest("hex"),
    ]),
  );
  assert.equal(session.mfa, true);
  assert.equal(await linkedCount(), 1);
  const reused = await ctx.call("/auth/oidc/verify", {
    body: { code: await ctx.freshCode(member.userId) },
    cookie: flow.binder,
  });
  assert.equal(reused.json().code, "OIDC_EXPIRED");
  // Five wrong codes end a pending sign-in.
  const guessed = await start("google", { intent: "sign_in" });
  assert.equal(location(await finish("google", guessed, { sub, email: member.email })), "/sign-in/verify");
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await ctx.call("/auth/oidc/verify", { body: { code: "000000" }, cookie: guessed.binder })).statusCode,
      401,
    );
  const locked = await ctx.call("/auth/oidc/verify", {
    body: { code: await ctx.freshCode(member.userId) },
    cookie: guessed.binder,
  });
  assert.equal(locked.json().code, "OIDC_EXPIRED");
  // Provider claims held for an abandoned authenticator step do not outlive it.
  const abandoned = await start("google", { intent: "sign_in" });
  assert.equal(location(await finish("google", abandoned, { sub, email: member.email })), "/sign-in/verify");
  await ctx.db.system((tx) =>
    tx.query("UPDATE oidc_sign_in_requests SET expires_at=now()-interval '1 second' WHERE status='mfa_pending'"),
  );
  await start("google", { intent: "sign_in" });
  const [held] = await ctx.db.system((tx) =>
    tx.query("SELECT count(*)::int n FROM oidc_sign_in_requests WHERE payload ? 'claims'"),
  );
  assert.equal(held.n, 0);
});

test("Apple sign-in uses an ES256 client secret and a cross-site form_post callback; the name arrives beside the token", async () => {
  const trainer = await ctx.person();
  const [{ slug }] = await ctx.db.system((tx) =>
    tx.query("SELECT slug FROM tenants WHERE id=$1", [trainer.tenantId]),
  );
  const flow = await start("apple", { intent: "join", coachSlug: slug, accepted: true });
  assert.equal(flow.url.searchParams.get("response_mode"), "form_post");
  assert.equal(flow.url.searchParams.get("scope"), "name email");
  const email = `apple-${randomUUID()}@privaterelay.example.test`;
  const r = await finish(
    "apple",
    flow,
    { sub: "a-" + randomUUID(), email },
    { extra: { user: JSON.stringify({ name: { firstName: "Apple", lastName: "Member" } }) } },
  );
  assert.equal(r.statusCode, 303, r.body);
  assert.equal(location(r), "/app");
  const account = ok(await ctx.call("/account", { cookie: sessionCookie(r) }));
  assert.equal(account.profile.name, "Apple Member");
  assert.deepEqual(account.identities.map((i: any) => i.provider), ["apple"]);
  // Other endpoints keep the origin check and do not accept form bodies.
  const crossSite = await ctx.call("/auth/oidc/google/start", {
    body: { intent: "sign_in" },
    headers: { origin: "https://appleid.apple.com" },
  });
  assert.equal(crossSite.statusCode, 403);
  const form = await ctx.call("/auth/login", {
    method: "POST",
    body: "email=a%40b.test&password=x",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  assert.equal(form.statusCode, 415);
});

test("linking from signed-in settings re-proves ownership; unlinking keeps at least one sign-in method", async () => {
  const member = await ctx.person();
  const refused = await ctx.call("/auth/oidc/apple/link", {
    body: { returnTo: "/trainer/settings" },
    cookie: member.cookie,
  });
  assert.equal(refused.json().code, "INVALID_PASSWORD");
  const flow = await start("apple", { password, returnTo: "/trainer/settings" }, member.cookie, "link");
  const appleSub = "a-link-" + randomUUID();
  const linked = await finish("apple", flow, { sub: appleSub, email: `relay-${randomUUID()}@example.test` });
  assert.equal(location(linked), "/trainer/settings?linked=apple");
  let account = ok(await ctx.call("/account", { cookie: member.cookie }));
  assert.deepEqual(account.identities.map((i: any) => i.provider), ["apple"]);
  // The same Apple ID cannot be linked to a second account.
  const other = await ctx.person();
  const taken = await finish(
    "apple",
    await start("apple", { password, returnTo: "/trainer/settings" }, other.cookie, "link"),
    { sub: appleSub, email: other.email },
  );
  assert.equal(location(taken), "/trainer/settings?signin_error=IDENTITY_IN_USE");
  // Signing in with the linked Apple ID reaches the member's account.
  const viaApple = await finish("apple", await start("apple", { intent: "sign_in" }), { sub: appleSub });
  assert.equal(location(viaApple), "/trainer");
  assert.equal(ok(await ctx.call("/bootstrap", { cookie: sessionCookie(viaApple) })).user.userId, member.userId);
  ok(
    await ctx.call("/account/identities/apple/unlink", { body: { password }, cookie: member.cookie }),
  );
  account = ok(await ctx.call("/account", { cookie: member.cookie }));
  assert.deepEqual(account.identities, []);
  // An account created through Google has no password: its only method stays.
  const trainer = await ctx.person();
  const [{ slug }] = await ctx.db.system((tx) =>
    tx.query("SELECT slug FROM tenants WHERE id=$1", [trainer.tenantId]),
  );
  const created = await finish(
    "google",
    await start("google", { intent: "join", coachSlug: slug, accepted: true }),
    { sub: "g-only-" + randomUUID(), email: `only-${randomUUID()}@example.test` },
  );
  const cookie = sessionCookie(created);
  const last = await ctx.call("/account/identities/google/unlink", { body: {}, cookie });
  assert.equal(last.statusCode, 409);
  assert.equal(last.json().code, "LAST_SIGN_IN_METHOD");
  ok(await ctx.call("/account/password/set", { body: { password: "OwnPassword2026!" }, cookie }));
  ok(await ctx.call("/account/identities/google/unlink", { body: { password: "OwnPassword2026!" }, cookie }));
});

test("ID tokens are verified against the provider keys, issuer, audience, expiry and nonce; keys are cached and refreshed on rotation", async () => {
  const nonce = "nonce-" + randomUUID(),
    user = { sub: "unit-" + randomUUID(), email: "Unit@Example.test" };
  const expected = { clientId: settings.google.id, nonce };
  const fetches = google.fetches.jwks;
  const claims = await verifyIdToken("google", google.mint(google.claims(user, nonce)), expected);
  assert.equal(claims.email, "unit@example.test");
  assert.equal(claims.emailVerified, true);
  await verifyIdToken("google", google.mint(google.claims(user, nonce)), expected);
  assert.ok(google.fetches.jwks - fetches <= 1, "signing keys are cached");
  const forged = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const bad: Array<[string, RegExp]> = [
    [google.mint(google.claims(user, nonce), { key: forged }), /signature is invalid/],
    [google.mint(google.claims(user, nonce, { iss: "https://evil.oidc.test" })), /unexpected issuer/],
    [google.mint(google.claims(user, nonce, { aud: "another-client" })), /another application/],
    [google.mint(google.claims(user, nonce, { exp: Math.floor(now() / 1000) - 120 })), /expired/],
    [google.mint(google.claims(user, "other-nonce")), /does not belong/],
    [google.mint(google.claims(user, nonce, { iat: Math.floor(now() / 1000) - 3600 })), /not current/],
    ["a.b", /could not be verified/],
  ];
  for (const [token, message] of bad)
    await assert.rejects(verifyIdToken("google", token, expected), message);
  const unsigned =
    b64({ alg: "none", kid: google.keys[0].kid }) + "." + b64(google.claims(user, nonce)) + ".AAAA";
  await assert.rejects(verifyIdToken("google", unsigned, expected), /unsupported signature/);
  // Rotation: a new key id forces one refresh (throttled to once per ten seconds).
  const rotated = google.addKey();
  clock += 11_000;
  const before = google.fetches.jwks;
  await verifyIdToken("google", google.mint(google.claims(user, nonce), { kid: rotated }), expected);
  assert.equal(google.fetches.jwks, before + 1);
  const unknownKid = google.mint(google.claims(user, nonce), { kid: rotated });
  const tampered = unknownKid.replace(/^[^.]+/, b64({ alg: "RS256", kid: "missing-kid" }));
  await assert.rejects(verifyIdToken("google", tampered, expected), /unknown key/);
  assert.equal(google.fetches.jwks, before + 1, "unknown keys do not trigger a request storm");
  // Cached discovery and keys expire with the provider's max-age.
  const discovery = google.fetches.discovery;
  clock += 3601_000;
  await verifyIdToken("google", google.mint(google.claims(user, nonce)), expected);
  assert.equal(google.fetches.discovery, discovery + 1);
  clock = Date.now();
});
