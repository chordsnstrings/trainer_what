import { memberApiUrl } from "../lib/trainer-preview-routing";
import { formatDateTime } from "../lib/format";
// JSON request helper shared by the account self-service components.
import { translator, type Locale } from "../lib/i18n/core";
import authMessages from "../lib/i18n/messages/auth";
export type AccountError = Error & { status?: number; code?: string };
/**
 * A read that has not answered by then is reported, never left loading.
 * Root cause of the "Loading your account…" screen (docs/features/
 * member-screens.md): the account cards waited for their first read with no
 * time limit, and two of them hid a failed read behind made-up defaults
 * ("verification needed", "0 recovery codes"), so a read held up by a busy
 * server or a flaky connection looked like a page that never loads.
 */
export const ACCOUNT_READ_TIMEOUT_MS = 15_000;
export const ACCOUNT_UNREACHABLE =
  "Your account details could not be reached. Check your connection and try again.";
/** Fetch with a time limit that works even when the fetch ignores `signal`. */
export async function fetchWithin(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller?.signal }),
      timedOut,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function accountRequest<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  let r: Response;
  const init: RequestInit = {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  };
  try {
    // Reads end in a message with a retry, never an endless "Loading…";
    // changes are never cut short (their outcome must be known).
    r =
      method === "GET"
        ? await fetchWithin(
            memberApiUrl("/api/v1" + path),
            init,
            options.timeoutMs ?? ACCOUNT_READ_TIMEOUT_MS,
          )
        : await fetch(memberApiUrl("/api/v1" + path), init);
  } catch {
    throw Object.assign(new Error(ACCOUNT_UNREACHABLE), {
      status: 0,
      code: "NETWORK",
    }) as AccountError;
  }
  let data: any = {};
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  if (!r.ok)
    throw Object.assign(
      new Error(
        data.message ||
          (r.status === 429
            ? "Too many requests. Wait a moment, then try again."
            : "That did not work. Try again in a moment."),
      ),
      {
        status: r.status,
        code: data.code,
      },
    ) as AccountError;
  return data as T;
}
/** Human wording for sign-in outcomes returned as ?signin_error=CODE. */
export function signInErrorMessage(
  code: string | null | undefined,
  locale: Locale = "en",
) {
  if (!code) return "";
  if (locale !== "en") {
    const t = translator(authMessages, locale);
    return Object.hasOwn(authMessages.en, code) && /^[A-Z_]+$/.test(code)
      ? t(code as "OIDC_CANCELLED")
      : t("signInFailed");
  }
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
/** "29 Sep 2026, 14:05": the app's one date and time format (lib/format.ts). */
export function formatDate(value: string | null | undefined) {
  return formatDateTime(value);
}
