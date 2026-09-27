import { createHash, randomUUID } from "node:crypto";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import { event, type Actor, type Database, type Tx } from "@trainer/db";
import { ProviderUnavailable } from "@trainer/providers";
import {
  runtimeConfig,
  strictSecurity,
} from "../../../packages/providers/src/configuration.ts";
import {
  OIDC_PROVIDER_IDS,
  OIDC_PROVIDERS,
  OidcError,
  exchangeAuthorizationCode,
  isOidcProvider,
  oidcAuthorizationUrl,
  oidcClientConfig,
  oidcRedirectUri,
  pkceChallenge,
  verifyIdToken,
  type OidcClaims,
  type OidcProviderId,
} from "../../../packages/providers/src/oidc.ts";
import { newToken, tokenHash } from "./auth.ts";
import {
  accountAudit,
  accountHost,
  accountMembership,
  queueAccountEmail,
  setAccountCookie,
} from "./account-completion.ts";
import { consumeMfa } from "./security.ts";
import { workspaceLock } from "./privacy-lifecycle.ts";
import { lockActiveInvitation } from "./team.ts";
import { legalAcceptanceVersion } from "./legal.ts";
import { recordSignupAcquisition } from "./acquisition.ts";
import { openSignInSession } from "./sign-in.ts";
import {
  addAccountNotice,
  confirmAccountOwner,
  emailDeliveryConfigured,
  unusablePassword,
} from "./account-self-service.ts";
import type { HostContext } from "./host-routing.ts";

/**
 * Apple and Google sign-in (OpenID Connect authorization code flow with PKCE).
 * The browser that starts a flow receives an httpOnly binder cookie; the
 * stored request keeps only hashes, and the PKCE verifier and nonce are
 * derived from the binder, so the database holds nothing that completes a
 * sign-in. Available on the platform address only (the provider return URL is
 * registered there). Sessions are created through openSignInSession().
 */
type OidcIdentity = Actor & { email: string; mfaAt?: string | null };
type RequestRow = {
  id: string;
  provider: OidcProviderId;
  intent: "sign_in" | "join" | "invite" | "link";
  status: string;
  user_id: string | null;
  session_hash: string | null;
  tenant_id: string | null;
  binder_hash: string;
  payload: any;
  attempts: number;
  expires_at: string;
};
type Outcome =
  | {
      kind: "session";
      token: string;
      role: string;
      tenantId: string;
      userId: string;
      joined: boolean;
    }
  | { kind: "linked"; returnTo: string };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
class MfaPending extends Error {}
export const OIDC_FORM_CALLBACK_PATH = "/api/v1/auth/oidc/apple/callback";
/** Apple posts the result cross-site (form_post); state + binder replace the origin check. */
export const isOidcFormCallback = (path: string) =>
  path === OIDC_FORM_CALLBACK_PATH;
const BINDER = "oidc_binder",
  COOKIE_PATH = "/api/v1/auth/oidc",
  REQUEST_MINUTES = 15,
  MFA_MINUTES = 5,
  MAX_MFA_ATTEMPTS = 5;
const returnPaths = [
  "/app/profile",
  "/trainer/settings",
  "/admin/account-security",
] as const;
/** Codes a failed callback may place in ?signin_error= (the web maps each to wording). */
export const OIDC_REDIRECT_CODES = [
  "OIDC_CANCELLED",
  "OIDC_EXPIRED",
  "OIDC_BROWSER_MISMATCH",
  "OIDC_UNAVAILABLE",
  "OIDC_TOKEN_INVALID",
  "OIDC_TOKEN_REJECTED",
  "OIDC_EMAIL_UNVERIFIED",
  "OIDC_LINK_REQUIRED",
  "OIDC_NO_ACCOUNT",
  "OIDC_PLATFORM_ONLY",
  "OIDC_LINK_EXPIRED",
  "NO_MEMBERSHIP",
  "LEGAL_PENDING",
  "TRAINER_UNAVAILABLE",
  "INVALID_INVITE",
  "INVITE_EMAIL_MISMATCH",
  "IDENTITY_IN_USE",
  "PROVIDER_ALREADY_LINKED",
] as const;
const redirectCodes = new Set<string>(OIDC_REDIRECT_CODES);
const derive = (label: string, id: string, binder: string) =>
  createHash("sha256").update(`${label}:${id}:${binder}`).digest("base64url");
const homePath = (role: string) => (role === "subscriber" ? "/app" : "/trainer");
function legalGate() {
  if (strictSecurity() && runtimeConfig().LEGAL_APPROVED !== "true")
    throw fail(
      503,
      "LEGAL_PENDING",
      "New accounts are waiting for the published legal documents",
    );
}
function platformHost(req: FastifyRequest) {
  const host = accountHost(req);
  if (host.custom)
    throw fail(
      403,
      "PLATFORM_HOST_REQUIRED",
      "Apple and Google sign-in use the platform address.",
    );
  return host;
}
function requireClient(provider: OidcProviderId) {
  const client = oidcClientConfig(provider);
  if (!client)
    throw new ProviderUnavailable(
      OIDC_PROVIDERS[provider].integrationId,
      `Sign in with ${OIDC_PROVIDERS[provider].name} is not available yet.`,
    );
  return client;
}
function parseProvider(req: FastifyRequest) {
  const provider = (req.params as any).provider;
  if (!isOidcProvider(provider))
    throw fail(404, "NOT_FOUND", "This sign-in method is unavailable");
  return provider;
}
function appleName(user: unknown) {
  if (typeof user !== "string" || user.length > 2000) return null;
  try {
    const parsed = JSON.parse(user);
    const name = [parsed?.name?.firstName, parsed?.name?.lastName]
      .filter((part) => typeof part === "string" && part.trim())
      .join(" ")
      .trim();
    return name ? name.slice(0, 100) : null;
  } catch {
    return null;
  }
}
function displayName(claims: OidcClaims) {
  const name = claims.name?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (name && name.length >= 2) return name.slice(0, 100);
  const local = (claims.email ?? "member").split("@")[0].slice(0, 60);
  return local.length >= 2 ? local : "Member";
}
/** Security notice to the account's address when a sign-in method is added. */
async function linkedEmail(tx: Tx, a: Actor, providerName: string) {
  if (!emailDeliveryConfigured()) return;
  const [u] = await tx.query("SELECT email FROM users WHERE id=$1", [a.userId]);
  await queueAccountEmail(
    tx,
    a,
    u.email,
    `${providerName} sign-in was added`,
    `${providerName} can now be used to sign in to your account. If this was not you, remove it in Account settings, change your password and contact support.`,
    "identity-linked:" + randomUUID(),
  );
}
async function asTenant(tx: Tx, a: Actor) {
  await tx.query("SET LOCAL ROLE trainer_app");
  await tx.query(
    "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role',$3,true)",
    [a.tenantId, a.userId, a.role],
  );
}

/**
 * Resolves the verified identity to an account and workspace, applying the
 * linking rules and registration gates, then opens the session. Throws
 * MfaPending (rolling everything back) when an enrolled authenticator still
 * needs its code.
 */
async function complete(
  tx: Tx,
  row: RequestRow,
  claims: OidcClaims,
  host: HostContext,
  registrationVersion: string,
  code?: string,
): Promise<Outcome> {
  const provider = row.provider,
    providerName = OIDC_PROVIDERS[provider].name;
  if (row.intent === "link") {
    const [session] = await tx.query(
      "SELECT tenant_id FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now()",
      [row.session_hash, row.user_id],
    );
    if (!session)
      throw fail(401, "OIDC_LINK_EXPIRED", "Sign in again to link this account");
    await workspaceLock(tx, session.tenant_id);
    await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      row.user_id,
    ]);
    const [existing] = await tx.query(
      "SELECT user_id FROM account_identities WHERE provider=$1 AND subject=$2 FOR UPDATE",
      [provider, claims.subject],
    );
    if (existing && existing.user_id !== row.user_id)
      throw fail(
        409,
        "IDENTITY_IN_USE",
        `This ${providerName} account is linked to another account`,
      );
    if (!existing) {
      const [other] = await tx.query(
        "SELECT id FROM account_identities WHERE user_id=$1 AND provider=$2",
        [row.user_id, provider],
      );
      if (other)
        throw fail(
          409,
          "PROVIDER_ALREADY_LINKED",
          `Remove the linked ${providerName} account first`,
        );
      await tx.query(
        "INSERT INTO account_identities(id,user_id,provider,subject,email,email_verified) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          row.user_id,
          provider,
          claims.subject,
          claims.email,
          claims.emailVerified,
        ],
      );
      const [m] = await tx.query(
        "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",
        [session.tenant_id, row.user_id],
      );
      if (m)
        await accountAudit(
          tx,
          { tenantId: session.tenant_id, userId: row.user_id!, role: m.role },
          "security.identity_linked",
          row.user_id!,
          { provider },
        );
      await addAccountNotice(
        tx,
        row.user_id!,
        "identity_linked",
        `${providerName} sign-in added`,
        `You can now sign in with ${providerName}. If this was not you, remove it in Account settings and change your password.`,
      );
      if (m)
        await linkedEmail(
          tx,
          { tenantId: session.tenant_id, userId: row.user_id!, role: m.role },
          providerName,
        );
    }
    await tx.query(
      "UPDATE oidc_sign_in_requests SET status='completed',payload=payload-'claims' WHERE id=$1",
      [row.id],
    );
    return { kind: "linked", returnTo: row.payload.returnTo };
  }
  let invite: any = null;
  if (row.intent === "join") {
    await workspaceLock(tx, row.tenant_id!);
    const [open] = await tx.query(
      "SELECT id FROM tenants WHERE id=$1 AND published=true AND lifecycle_state='active' FOR UPDATE",
      [row.tenant_id],
    );
    if (!open)
      throw fail(
        404,
        "TRAINER_UNAVAILABLE",
        "This coaching space is not accepting public signups",
      );
  }
  if (row.intent === "invite") {
    invite = await lockActiveInvitation(tx, row.payload.inviteHash);
    if (!invite)
      throw fail(400, "INVALID_INVITE", "Invitation is invalid or expired");
  }
  // Lock order matches the other sign-in paths: workspace, then user rows.
  let lockedTenant: string | null = null;
  if (row.intent === "sign_in") {
    const [known] = await tx.query(
      "SELECT user_id FROM account_identities WHERE provider=$1 AND subject=$2",
      [provider, claims.subject],
    );
    const candidate =
      known?.user_id ??
      (claims.email && claims.emailVerified
        ? (
            await tx.query("SELECT id FROM users WHERE email=$1", [
              claims.email,
            ])
          )[0]?.id
        : undefined);
    const selected = candidate
      ? await accountMembership(tx, candidate, host).catch(() => null)
      : null;
    if (selected) {
      await workspaceLock(tx, selected.tenant_id);
      lockedTenant = selected.tenant_id;
    }
  }
  const [linked] = await tx.query(
    "SELECT user_id FROM account_identities WHERE provider=$1 AND subject=$2 FOR UPDATE",
    [provider, claims.subject],
  );
  let userId: string = linked?.user_id,
    autoLinked = false,
    created = false;
  if (!userId) {
    if (!claims.email || !claims.emailVerified)
      throw fail(
        403,
        "OIDC_EMAIL_UNVERIFIED",
        `${providerName} did not confirm a verified email address`,
      );
    const [local] = await tx.query(
      "SELECT id,email_verified,platform_role FROM users WHERE email=$1 FOR UPDATE",
      [claims.email],
    );
    if (local) {
      // Automatic linking only for a provider-verified email that matches a
      // verified local email; platform accounts link from settings only.
      const [other] = await tx.query(
        "SELECT id FROM account_identities WHERE user_id=$1 AND provider=$2",
        [local.id, provider],
      );
      if (!local.email_verified || local.platform_role !== "none" || other)
        throw fail(
          409,
          "OIDC_LINK_REQUIRED",
          `Sign in with your password, then link ${providerName} in Account settings`,
        );
      userId = local.id;
      autoLinked = true;
    } else {
      if (row.intent === "sign_in")
        throw fail(
          404,
          "OIDC_NO_ACCOUNT",
          `No account uses this ${providerName} account yet`,
        );
      legalGate();
      if (
        row.intent === "invite" &&
        String(invite.payload.email).toLowerCase() !== claims.email
      )
        throw fail(
          403,
          "INVITE_EMAIL_MISMATCH",
          "Use the account for the invited email address",
        );
      userId = randomUUID();
      created = true;
      // The provider verified the address; no password exists until the
      // member sets one.
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash,email_verified) VALUES($1,$2,$3,$4,true)",
        [userId, claims.email, displayName(claims), unusablePassword()],
      );
    }
    await tx.query(
      "INSERT INTO account_identities(id,user_id,provider,subject,email,email_verified) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        userId,
        provider,
        claims.subject,
        claims.email,
        claims.emailVerified,
      ],
    );
  }
  const [user] = await tx.query(
    "SELECT id,email FROM users WHERE id=$1 FOR UPDATE",
    [userId],
  );
  const [security] = await tx.query(
    "SELECT enabled FROM user_security WHERE user_id=$1",
    [userId],
  );
  let mfa = false;
  if (security?.enabled) {
    if (code === undefined) throw new MfaPending();
    mfa = await consumeMfa(tx, userId, code);
  }
  let tenantId: string,
    role: string,
    joined = false;
  if (row.intent === "sign_in") {
    const m = await accountMembership(
      tx,
      userId,
      host,
      lockedTenant ?? undefined,
    );
    if (!lockedTenant) await workspaceLock(tx, m.tenant_id);
    tenantId = m.tenant_id;
    role = m.role;
  } else {
    legalGate();
    const targetTenant: string =
      row.intent === "join" ? row.tenant_id! : invite.tenant_id;
    const targetRole: string =
      row.intent === "join" ? "subscriber" : invite.payload.role;
    if (
      row.intent === "invite" &&
      String(invite.payload.email).toLowerCase() !== user.email
    )
      throw fail(
        403,
        "INVITE_EMAIL_MISMATCH",
        "Use the account for the invited email address",
      );
    const [inserted] = await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id",
      [targetTenant, userId, targetRole],
    );
    if (row.intent === "invite")
      await tx.query(
        "UPDATE one_time_tokens SET consumed_at=now() WHERE token_hash=$1",
        [row.payload.inviteHash],
      );
    const [m] = await tx.query(
      "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2",
      [targetTenant, userId],
    );
    tenantId = targetTenant;
    role = m.role;
    joined = !!inserted && role === "subscriber";
    if (inserted) {
      const actor = { tenantId, userId, role };
      await asTenant(tx, actor);
      await tx.query(
        "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'registration',$4,true)",
        [randomUUID(), tenantId, userId, registrationVersion],
      );
      if (row.intent === "join")
        await event(tx, actor, "subscriber.enrolled", userId, {
          method: `oidc_${provider}`,
        });
      await tx.query("RESET ROLE");
    }
  }
  await tx.query(
    "UPDATE account_identities SET last_used_at=now(),email=coalesce($3,email),email_verified=$4 WHERE provider=$1 AND subject=$2",
    [provider, claims.subject, claims.email, claims.emailVerified],
  );
  await accountAudit(
    tx,
    { tenantId, userId, role },
    "security.oidc_signed_in",
    userId,
    { provider, linkedAutomatically: autoLinked, accountCreated: created },
  );
  if (autoLinked) {
    await addAccountNotice(
      tx,
      userId,
      "identity_linked",
      `${providerName} sign-in added`,
      `${providerName} confirmed your email address, so it was linked to your account. If this was not you, remove it in Account settings and change your password.`,
    );
    await linkedEmail(tx, { tenantId, userId, role }, providerName);
  }
  await tx.query(
    "UPDATE oidc_sign_in_requests SET status='completed',payload=payload-'claims' WHERE id=$1",
    [row.id],
  );
  return {
    kind: "session",
    token: await openSignInSession(tx, {
      userId,
      tenantId,
      mfa,
      method: provider === "google" ? "oidc_google" : "oidc_apple",
    }),
    role,
    tenantId,
    userId,
    joined,
  };
}

export function registerOidcSignIn(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => OidcIdentity,
) {
  const rate = { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } };
  const setBinder = (reply: FastifyReply, binder: string) =>
    reply.setCookie(BINDER, binder, {
      path: COOKIE_PATH,
      httpOnly: true,
      // Apple returns with a cross-site POST, which only carries a
      // SameSite=None cookie; that requires Secure (production HTTPS).
      secure: strictSecurity(),
      sameSite: strictSecurity() ? "none" : "lax",
      maxAge: REQUEST_MINUTES * 60,
    });
  const clearBinder = (reply: FastifyReply) =>
    reply.clearCookie(BINDER, { path: COOKIE_PATH });
  async function begin(
    reply: FastifyReply,
    provider: OidcProviderId,
    host: HostContext,
    input: {
      intent: RequestRow["intent"];
      userId?: string;
      sessionHash?: string;
      tenantId?: string | null;
      payload: Record<string, unknown>;
    },
  ) {
    const client = requireClient(provider),
      binder = newToken(),
      state = newToken(),
      id = randomUUID();
    let authorizationUrl: string;
    try {
      authorizationUrl = await oidcAuthorizationUrl(client, {
        redirectUri: oidcRedirectUri(provider, host.origin),
        state,
        nonce: derive("nonce", id, binder),
        codeChallenge: pkceChallenge(derive("pkce", id, binder)),
      });
    } catch (error) {
      if (error instanceof OidcError)
        throw new ProviderUnavailable(
          OIDC_PROVIDERS[provider].integrationId,
          error.message,
        );
      throw error;
    }
    await db.system(async (tx) => {
      // Housekeeping: provider claims held for an abandoned authenticator
      // step are removed at expiry; old request rows after a day.
      await tx.query(
        "UPDATE oidc_sign_in_requests SET payload=payload-'claims',status=CASE WHEN status IN ('started','exchanging','mfa_pending') THEN 'failed' ELSE status END WHERE expires_at<now() AND (payload ? 'claims' OR status IN ('started','exchanging','mfa_pending'))",
      );
      await tx.query(
        "DELETE FROM oidc_sign_in_requests WHERE expires_at<now()-interval '1 day'",
      );
      await tx.query(
        "INSERT INTO oidc_sign_in_requests(id,state_hash,binder_hash,provider,intent,user_id,session_hash,tenant_id,payload,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+make_interval(mins=>$10::int))",
        [
          id,
          tokenHash(state),
          tokenHash(binder),
          provider,
          input.intent,
          input.userId ?? null,
          input.sessionHash ?? null,
          input.tenantId ?? null,
          JSON.stringify({ ...input.payload, origin: host.origin }),
          REQUEST_MINUTES,
        ],
      );
    });
    setBinder(reply, binder);
    return { authorizationUrl };
  }
  async function finish(
    req: FastifyRequest,
    reply: FastifyReply,
    row: RequestRow,
    claims: OidcClaims,
    code?: string,
  ) {
    const host = accountHost(req);
    const version = ["join", "invite"].includes(row.intent)
      ? await legalAcceptanceVersion(db, "registration")
      : "";
    const outcome = await db.system((tx) =>
      complete(tx, row, claims, host, version, code),
    );
    clearBinder(reply);
    if (outcome.kind === "linked")
      return `${outcome.returnTo}?linked=${row.provider}`;
    setAccountCookie(reply, outcome.token);
    if (outcome.joined)
      try {
        await recordSignupAcquisition(
          db,
          req,
          {
            tenantId: outcome.tenantId,
            userId: outcome.userId,
            role: "subscriber",
          },
          "enroll",
        );
      } catch {
        req.log.warn("Enrollment acquisition conversion could not be recorded");
      }
    return homePath(outcome.role);
  }
  const markFailed = (id: string) =>
    db.system((tx) =>
      tx.query(
        "UPDATE oidc_sign_in_requests SET status='failed',payload=payload-'claims' WHERE id=$1 AND status<>'completed'",
        [id],
      ),
    );
  const errorPath = (row: RequestRow | null) =>
    row?.intent === "join"
      ? `/join-coach/${encodeURIComponent(row.payload.coachSlug ?? "")}`
      : row?.intent === "link"
        ? row.payload.returnTo
        : "/login";
  const errorCode = (error: unknown) => {
    const code =
      error instanceof OidcError
        ? error.code
        : error instanceof ProviderUnavailable
          ? "OIDC_UNAVAILABLE"
          : (error as any)?.code;
    return redirectCodes.has(code) ? code : "OIDC_FAILED";
  };

  async function callback(
    req: FastifyRequest,
    reply: FastifyReply,
    provider: OidcProviderId,
    params: Record<string, unknown>,
  ) {
    const go = (path: string) => reply.redirect(path, 303);
    if (accountHost(req).custom)
      return go("/login?signin_error=OIDC_PLATFORM_ONLY");
    const state = typeof params.state === "string" ? params.state : "",
      binder = req.cookies[BINDER] ?? "";
    if (!state || state.length > 200)
      return go("/login?signin_error=OIDC_EXPIRED");
    const claimed = await db.system(async (tx) => {
      const [row] = await tx.query<RequestRow>(
        "SELECT * FROM oidc_sign_in_requests WHERE state_hash=$1 AND provider=$2 FOR UPDATE",
        [tokenHash(state), provider],
      );
      if (!row) return { row: null, problem: "OIDC_EXPIRED" };
      if (row.status !== "started" || Date.parse(row.expires_at) <= Date.now())
        return { row, problem: "OIDC_EXPIRED" };
      // A callback carried to another browser (login CSRF) never completes.
      if (!binder || tokenHash(binder) !== row.binder_hash) {
        await tx.query(
          "UPDATE oidc_sign_in_requests SET status='failed' WHERE id=$1",
          [row.id],
        );
        return { row, problem: "OIDC_BROWSER_MISMATCH" };
      }
      // One exchange per request: a replayed callback finds it claimed.
      await tx.query(
        "UPDATE oidc_sign_in_requests SET status='exchanging' WHERE id=$1",
        [row.id],
      );
      return { row, problem: null };
    });
    const row = claimed.row;
    if (claimed.problem)
      return go(`${errorPath(row)}?signin_error=${claimed.problem}`);
    try {
      if (params.error || typeof params.code !== "string" || !params.code)
        throw new OidcError("OIDC_CANCELLED", "Sign-in was cancelled");
      if (params.code.length > 2048)
        throw new OidcError("OIDC_TOKEN_REJECTED", "Invalid sign-in code");
      const client = requireClient(provider);
      const { idToken } = await exchangeAuthorizationCode(client, {
        code: params.code,
        redirectUri: oidcRedirectUri(provider, row!.payload.origin),
        codeVerifier: derive("pkce", row!.id, binder),
      });
      const claims = await verifyIdToken(provider, idToken, {
        clientId: client.clientId,
        nonce: derive("nonce", row!.id, binder),
      });
      // Apple sends the member's name once, beside the token.
      if (provider === "apple" && !claims.name)
        claims.name = appleName(params.user);
      try {
        return go(await finish(req, reply, row!, claims));
      } catch (error) {
        if (!(error instanceof MfaPending)) throw error;
        await db.system((tx) =>
          tx.query(
            "UPDATE oidc_sign_in_requests SET status='mfa_pending',attempts=0,payload=payload||jsonb_build_object('claims',$2::jsonb),expires_at=now()+make_interval(mins=>$3::int) WHERE id=$1",
            [row!.id, JSON.stringify(claims), MFA_MINUTES],
          ),
        );
        return go("/sign-in/verify");
      }
    } catch (error) {
      await markFailed(row!.id);
      clearBinder(reply);
      return go(`${errorPath(row)}?signin_error=${errorCode(error)}`);
    }
  }

  app.get("/api/v1/auth/oidc/providers", async (req) => {
    const host = accountHost(req);
    return {
      providers: OIDC_PROVIDER_IDS.map((id) => ({
        id,
        name: OIDC_PROVIDERS[id].name,
        enabled: !host.custom && !!oidcClientConfig(id),
      })),
    };
  });
  app.post("/api/v1/auth/oidc/:provider/start", rate, async (req, reply) => {
    const provider = parseProvider(req),
      host = platformHost(req);
    const b = z
      .object({
        intent: z.enum(["sign_in", "join", "invite"]),
        coachSlug: z.string().min(1).max(40).optional(),
        inviteToken: z.string().min(20).max(200).optional(),
        accepted: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    requireClient(provider);
    if (b.intent === "sign_in")
      return begin(reply, provider, host, { intent: "sign_in", payload: {} });
    // New accounts follow the password sign-up gates: published terms,
    // explicit acceptance, and a public join or an invitation.
    if (b.accepted !== true)
      throw fail(
        400,
        "TERMS_REQUIRED",
        "Accept the published terms before continuing",
      );
    legalGate();
    if (b.intent === "join") {
      if (!b.coachSlug)
        throw fail(400, "VALIDATION", "Choose the coach to join");
      const [tenant] = await db.system((tx) =>
        tx.query(
          "SELECT id FROM tenants WHERE slug=$1 AND published=true AND lifecycle_state='active'",
          [b.coachSlug],
        ),
      );
      if (!tenant)
        throw fail(
          404,
          "TRAINER_UNAVAILABLE",
          "This coaching space is not accepting public signups",
        );
      return begin(reply, provider, host, {
        intent: "join",
        tenantId: tenant.id,
        payload: { coachSlug: b.coachSlug },
      });
    }
    if (!b.inviteToken)
      throw fail(400, "VALIDATION", "Open your invitation link again");
    const [invite] = await db.system((tx) =>
      tx.query(
        "SELECT tenant_id FROM one_time_tokens WHERE token_hash=$1 AND purpose='invite' AND consumed_at IS NULL AND expires_at>now()",
        [tokenHash(b.inviteToken!)],
      ),
    );
    if (!invite)
      throw fail(400, "INVALID_INVITE", "Invitation is invalid or expired");
    return begin(reply, provider, host, {
      intent: "invite",
      tenantId: invite.tenant_id,
      payload: { inviteHash: tokenHash(b.inviteToken) },
    });
  });
  app.post("/api/v1/auth/oidc/:provider/link", rate, async (req, reply) => {
    const a = identity(req),
      provider = parseProvider(req),
      host = platformHost(req);
    const b = z
      .object({
        password: z.string().max(128).optional(),
        code: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
        returnTo: z.enum(returnPaths),
      })
      .strict()
      .parse(req.body);
    requireClient(provider);
    const sessionHash = tokenHash(req.cookies.session ?? "");
    // Linking adds a way into the account, so ownership is proven again.
    await db.system(async (tx) => {
      await workspaceLock(tx, a.tenantId);
      await confirmAccountOwner(tx, a.userId, sessionHash, b);
    });
    return begin(reply, provider, host, {
      intent: "link",
      userId: a.userId,
      sessionHash,
      payload: { returnTo: b.returnTo },
    });
  });
  app.get("/api/v1/auth/oidc/:provider/callback", async (req, reply) =>
    callback(req, reply, parseProvider(req), (req.query as any) ?? {}),
  );
  // Only this route accepts a form body, so no other endpoint gains a
  // cross-site "simple" request content type.
  app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 16384 },
      (_req, body, done) => {
        try {
          done(null, Object.fromEntries(new URLSearchParams(String(body))));
        } catch (error) {
          done(error as Error);
        }
      },
    );
    scope.post(OIDC_FORM_CALLBACK_PATH, rate, async (req, reply) =>
      callback(req, reply, "apple", (req.body as any) ?? {}),
    );
  });
  const pendingRow = async (tx: Tx, binder: string) =>
    (
      await tx.query<RequestRow>(
        "SELECT * FROM oidc_sign_in_requests WHERE binder_hash=$1 AND status='mfa_pending' AND expires_at>now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        [tokenHash(binder)],
      )
    )[0];
  app.get("/api/v1/auth/oidc/pending", async (req) => {
    const binder = req.cookies[BINDER];
    const row = binder
      ? await db.system((tx) => pendingRow(tx, binder))
      : undefined;
    if (!row)
      throw fail(404, "OIDC_EXPIRED", "This sign-in expired. Start again.");
    return {
      provider: row.provider,
      name: OIDC_PROVIDERS[row.provider].name,
      expiresAt: row.expires_at,
    };
  });
  app.post("/api/v1/auth/oidc/verify", rate, async (req, reply) => {
    const b = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .strict()
      .parse(req.body);
    const binder = req.cookies[BINDER] ?? "";
    const row = await db.system(async (tx) => {
      const found = binder ? await pendingRow(tx, binder) : undefined;
      if (!found || found.attempts >= MAX_MFA_ATTEMPTS)
        throw fail(400, "OIDC_EXPIRED", "This sign-in expired. Start again.");
      await tx.query(
        "UPDATE oidc_sign_in_requests SET attempts=attempts+1 WHERE id=$1",
        [found.id],
      );
      return found;
    });
    try {
      const redirect = await finish(req, reply, row, row.payload.claims, b.code);
      return { ok: true, redirect };
    } catch (error: any) {
      // A wrong code keeps the pending sign-in for the remaining attempts.
      if (error?.code === "MFA_REQUIRED") throw error;
      await markFailed(row.id);
      clearBinder(reply);
      throw error;
    }
  });
}
