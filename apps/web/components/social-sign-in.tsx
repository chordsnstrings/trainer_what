"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  accountRequest,
  signInErrorMessage,
  type AccountError,
} from "./account-request";
import { AuthPage, ReturnToSignIn } from "./auth-page";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";

type Provider = { id: string; name: string; enabled: boolean };

/**
 * Apple and Google buttons for sign-in, public join and invitation pages.
 * Shown only for providers the Superadmin has configured and checked. New
 * accounts need the same terms acceptance as the password form.
 */
export function SocialSignIn({
  intent,
  coachSlug,
  inviteToken,
  accepted: given,
}: {
  intent: "sign_in" | "join" | "invite";
  coachSlug?: string;
  inviteToken?: string;
  /**
   * The page's own terms acceptance (components/legal-acceptance.tsx). When
   * given, these buttons follow it instead of showing a second checkbox.
   */
  accepted?: boolean;
}) {
  const [providers, setProviders] = useState<Provider[]>([]),
    [message, setMessage] = useState(""),
    // An ended or missing membership is a state to explain, not an error.
    [neutral, setNeutral] = useState(false),
    [ticked, setTicked] = useState(false),
    [busy, setBusy] = useState("");
  const t = useT("auth"),
    locale = useLocale(),
    toError = useErrorText();
  useEffect(() => {
    accountRequest<{ providers: Provider[] }>("/auth/oidc/providers")
      .then((r) => setProviders(r.providers.filter((p) => p.enabled)))
      .catch(() => setProviders([]));
    const params = new URLSearchParams(window.location.search);
    const error = params.get("signin_error");
    if (error) {
      setMessage(signInErrorMessage(error, locale));
      setNeutral(error === "MEMBERSHIP_ENDED" || error === "NO_MEMBERSHIP");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  if (!providers.length && !message) return null;
  const needsTerms = intent !== "sign_in";
  const ownBox = needsTerms && given === undefined;
  const accepted = given ?? ticked;
  return (
    <div className="acct-social">
      {message && (
        <div
          className={neutral ? "notice" : "notice error"}
          role={neutral ? "status" : "alert"}
        >
          {message}
        </div>
      )}
      {providers.length > 0 && (
        <>
          <p className="acct-or">
            <span>{t("or")}</span>
          </p>
          {ownBox && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={ticked}
                onChange={(e) => setTicked(e.target.checked)}
              />
              {t("acceptPublished")}
            </label>
          )}
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              className="button secondary acct-social-button"
              disabled={!!busy || (needsTerms && !accepted)}
              onClick={async () => {
                setBusy(p.id);
                setMessage("");
                try {
                  const r = await accountRequest(
                    `/auth/oidc/${p.id}/start`,
                    "POST",
                    {
                      intent,
                      ...(coachSlug ? { coachSlug } : {}),
                      ...(inviteToken ? { inviteToken } : {}),
                      ...(needsTerms ? { accepted } : {}),
                    },
                  );
                  window.location.assign(r.authorizationUrl);
                } catch (e) {
                  setNeutral(false);
                  setMessage(toError(e as AccountError));
                  setBusy("");
                }
              }}
            >
              {busy === p.id
                ? t("opening", { provider: p.name })
                : t("continueWith", { provider: p.name })}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/** Second step after Apple or Google when the account has an authenticator. */
export function SocialSignInVerify() {
  const [pending, setPending] = useState<{ name: string } | null>(null),
    [message, setMessage] = useState(""),
    [expired, setExpired] = useState(false),
    [busy, setBusy] = useState(false);
  const t = useT("auth"),
    toError = useErrorText();
  useEffect(() => {
    accountRequest("/auth/oidc/pending")
      .then(setPending)
      .catch(() => setExpired(true));
  }, []);
  return (
    <AuthPage eyebrow={t("yourAccount")} title={t("oneMoreStep")}>
        <h2>{t("authenticatorCode")}</h2>
        {expired ? (
          <p className="notice error" role="alert">
            {t("signInExpired")}
          </p>
        ) : (
          <>
            <p className="muted">
              {pending
                ? t("providerConfirmed", { provider: pending.name })
                : t("checkingSignIn")}
            </p>
            {message && (
              <p className="notice error" role="alert">
                {message}
              </p>
            )}
            {pending && (
              <form
                onSubmit={async (e: FormEvent<HTMLFormElement>) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  setMessage("");
                  try {
                    const r = await accountRequest("/auth/oidc/verify", "POST", {
                      code: String(f.get("code") ?? "").trim(),
                    });
                    window.location.assign(r.redirect);
                  } catch (error) {
                    const err = error as AccountError;
                    if (err.code === "OIDC_EXPIRED") setExpired(true);
                    setMessage(toError(err));
                    setBusy(false);
                  }
                }}
              >
                <label className="field">
                  <span>{t("authenticatorCode")}</span>
                  <input
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                  />
                </label>
                <button className="button" disabled={busy}>
                  {t("finishSignIn")}
                </button>
              </form>
            )}
          </>
        )}
        <ReturnToSignIn />
    </AuthPage>
  );
}
