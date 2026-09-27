"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  accountRequest,
  signInErrorMessage,
  type AccountError,
} from "./account-request";

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
}: {
  intent: "sign_in" | "join" | "invite";
  coachSlug?: string;
  inviteToken?: string;
}) {
  const [providers, setProviders] = useState<Provider[]>([]),
    [message, setMessage] = useState(""),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState("");
  useEffect(() => {
    accountRequest<{ providers: Provider[] }>("/auth/oidc/providers")
      .then((r) => setProviders(r.providers.filter((p) => p.enabled)))
      .catch(() => setProviders([]));
    const params = new URLSearchParams(window.location.search);
    const error = params.get("signin_error");
    if (error) {
      setMessage(signInErrorMessage(error));
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);
  if (!providers.length && !message) return null;
  const needsTerms = intent !== "sign_in";
  return (
    <div className="acct-social">
      {message && (
        <div className="notice error" role="alert">
          {message}
        </div>
      )}
      {providers.length > 0 && (
        <>
          <p className="acct-or">
            <span>or</span>
          </p>
          {needsTerms && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              I accept the published terms and understand the digital coaching
              disclosure.
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
                  setMessage((e as AccountError).message);
                  setBusy("");
                }
              }}
            >
              {busy === p.id ? `Opening ${p.name}…` : `Continue with ${p.name}`}
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
  useEffect(() => {
    accountRequest("/auth/oidc/pending")
      .then(setPending)
      .catch(() => setExpired(true));
  }, []);
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>One more step.</h1>
      </section>
      <section className="card">
        <h2>Authenticator code</h2>
        {expired ? (
          <p className="notice error" role="alert">
            This sign-in expired. Start again from the sign-in page.
          </p>
        ) : (
          <>
            <p className="muted">
              {pending
                ? `${pending.name} confirmed your identity. Enter the six-digit code from your authenticator app to finish signing in.`
                : "Checking your sign-in…"}
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
                    setMessage(err.message);
                    setBusy(false);
                  }
                }}
              >
                <label className="field">
                  <span>Authenticator code</span>
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
                  Finish signing in
                </button>
              </form>
            )}
          </>
        )}
        <p>
          <a className="text-link" href="/login">
            Return to sign in
          </a>
        </p>
      </section>
    </main>
  );
}
