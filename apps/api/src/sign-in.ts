import type { Tx } from "@trainer/db";
import { newToken, tokenHash } from "./auth.ts";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

/**
 * How a session was established. Every sign-in path names itself here so a
 * policy (for example an account lock) can be applied to all of them at once.
 */
export type SignInMethod =
  | "password"
  | "registration"
  | "public_join"
  | "invitation"
  | "workspace_switch"
  | "magic_link"
  | "authenticator_recovery"
  | "passkey"
  | "oidc_google"
  | "oidc_apple"
  | "membership_exit";

/**
 * The single place where an authenticated session is created. Callers:
 * app.ts session() (password login, trainer registration, public join,
 * invitation acceptance, workspace switch), account-completion.ts
 * insertAccountSession() (magic link, authenticator recovery, passkey
 * sign-in), oidc-sign-in.ts (Apple and Google) and membership-exit.ts (the
 * follow-on workspace after leaving a trainer).
 *
 * A future account-lock or suspension check belongs in this function, before
 * the insert, so no sign-in path can bypass it. The caller runs it inside the
 * transaction that already holds the workspace and user locks.
 *
 * sessions.authenticated_at records when the person last proved who they are.
 * Methods that only carry an existing session forward (workspace switch, the
 * follow-on session after leaving a trainer) must pass the replaced session's
 * authenticated_at, so opening a session never counts as a fresh sign-in.
 */
const carriedMethods: ReadonlySet<SignInMethod> = new Set([
  "workspace_switch",
  "membership_exit",
]);
export async function openSignInSession(
  tx: Tx,
  input: {
    userId: string;
    tenantId: string;
    mfa: boolean;
    method: SignInMethod;
    /** Required for workspace_switch and membership_exit; ignored otherwise. */
    authenticatedAt?: Date | string | null;
  },
) {
  const carried = carriedMethods.has(input.method);
  if (carried && !input.authenticatedAt)
    throw fail(401, "AUTH_REQUIRED", "Please sign in");
  const [membership] = await tx.query(
    "SELECT m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.tenant_id=$2 AND t.lifecycle_state='active'",
    [input.userId, input.tenantId],
  );
  if (!membership)
    throw fail(403, "NO_MEMBERSHIP", "No active workspace is available");
  const token = newToken();
  await tx.query(
    "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,mfa_at,authenticated_at) VALUES($1,$2,$3,now()+interval '7 days',CASE WHEN $4 THEN now() ELSE NULL END,least(now(),coalesce($5::timestamptz,now())))",
    [
      tokenHash(token),
      input.userId,
      input.tenantId,
      input.mfa,
      carried ? new Date(input.authenticatedAt!).toISOString() : null,
    ],
  );
  return token;
}
/** The authentication time of a live session, for carrying it forward. */
export async function sessionAuthenticatedAt(
  tx: Tx,
  sessionHash: string,
  userId: string,
) {
  const [row] = await tx.query(
    "SELECT authenticated_at FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now()",
    [sessionHash, userId],
  );
  return (row?.authenticated_at ?? null) as Date | string | null;
}
