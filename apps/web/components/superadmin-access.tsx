import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { SETUP_PATH } from "./setup-wizard-model";

/** Where a Superadmin manages platform settings after signing in. */
export const SUPERADMIN_HOME = "/admin/settings";
export const ACCOUNT_SECURITY_PATH = "/admin/account-security";

type Signed = { user: { role: string; platformRole?: string } };

/**
 * Where sign-in lands. A Superadmin opens the Super admin area, never the
 * coach setup of their platform administration workspace; subscribers open
 * the member app and coaches keep their existing landing.
 */
export function signInLanding(s: Signed, from: string) {
  if (s.user.platformRole === "admin") return SUPERADMIN_HOME;
  if (s.user.role === "subscriber") return "/app";
  return from === "/signup" ? SETUP_PATH : "/trainer";
}

/**
 * The coach setup wizard and its go-live prompts are for coaching pages. A
 * platform administration workspace has none, so it never shows them.
 */
export function coachSetupOpen(state: {
  user: { role: string };
  tenant: { published?: boolean };
  platformWorkspace?: boolean;
}) {
  return (
    state.user.role === "owner" &&
    !state.tenant.published &&
    !state.platformWorkspace
  );
}

/** A Superadmin without an enrolled authenticator cannot use Super admin. */
export function needsAuthenticator(state: {
  user: { platformRole?: string };
  superadmin?: { mfaEnabled?: boolean };
  authenticatorRequired?: boolean;
}) {
  return (
    state.authenticatorRequired !== false &&
    state.user.platformRole === "admin" &&
    state.superadmin?.mfaEnabled === false
  );
}

export function SuperadminAuthenticatorBanner({
  state,
  path,
}: {
  state: Parameters<typeof needsAuthenticator>[0];
  path: string;
}) {
  if (!needsAuthenticator(state) || path === ACCOUNT_SECURITY_PATH) return null;
  return (
    <Link
      href={ACCOUNT_SECURITY_PATH}
      className="notice superadmin-authenticator-banner"
      role="status"
    >
      <ShieldCheck size={17} aria-hidden="true" />
      <span>
        <strong>Set up your authenticator app to use Super admin</strong> Open
        Account security to add this account to your authenticator app.
      </span>
    </Link>
  );
}
