// JSON request helper shared by the account self-service components.
export type AccountError = Error & { status?: number; code?: string };
export async function accountRequest<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api/v1" + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  let data: any = {};
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "Request failed"), {
      status: r.status,
      code: data.code,
    }) as AccountError;
  return data as T;
}
/** Human wording for sign-in outcomes returned as ?signin_error=CODE. */
export function signInErrorMessage(code: string | null | undefined) {
  if (!code) return "";
  const messages: Record<string, string> = {
    OIDC_CANCELLED: "Sign-in was cancelled.",
    OIDC_EXPIRED: "That sign-in expired or was already used. Start again.",
    OIDC_BROWSER_MISMATCH:
      "Finish signing in in the same browser where you started.",
    OIDC_EMAIL_UNVERIFIED:
      "Your Apple or Google account did not confirm a verified email address.",
    OIDC_LINK_REQUIRED:
      "An account already uses this email. Sign in with your password, then link Apple or Google in Account settings.",
    OIDC_NO_ACCOUNT:
      "No account uses this Apple or Google account yet. Join a coach or open your invitation to create one.",
    OIDC_PLATFORM_ONLY:
      "Apple and Google sign-in are available on the main platform address.",
    OIDC_LINK_EXPIRED:
      "Your session ended before linking finished. Sign in and try again.",
    NO_MEMBERSHIP:
      "Your account has no active coaching workspace. Join a coach to continue.",
    MEMBERSHIP_ENDED:
      "Your coaching membership has ended, so there is no workspace to open. Your account remains; join a coach to continue. Signing in with your password or a passkey shows your coach's message.",
    REMOVED_BY_TRAINER:
      "This coach ended your membership, so you can rejoin only through a new invitation from them.",
    LEGAL_PENDING:
      "New accounts are paused until the published terms are approved.",
    TRAINER_UNAVAILABLE: "This coach is not accepting new members right now.",
    INVALID_INVITE: "This invitation is invalid or expired.",
    INVITE_EMAIL_MISMATCH:
      "Use the Apple or Google account for the invited email address.",
    IDENTITY_IN_USE:
      "That Apple or Google account is already linked to another account.",
    PROVIDER_ALREADY_LINKED: "Remove the currently linked account first.",
  };
  return (
    messages[code] ??
    "Sign-in could not be completed. Try again or use your password."
  );
}
export function formatDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}
