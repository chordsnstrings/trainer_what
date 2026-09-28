"use client";
import { useEffect, useState, type FormEvent } from "react";
import { accountRequest, formatDate, type AccountError } from "./account-request";

function Shell({
  title,
  heading,
  children,
}: {
  title: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>{title}</h1>
      </section>
      <section className="card">
        <h2>{heading}</h2>
        {children}
        <p>
          <a className="text-link" href="/login">
            Return to sign in
          </a>
        </p>
      </section>
    </main>
  );
}

/**
 * The new address opens this page from its confirmation email. A button,
 * not the page load, applies the change, so link scanners cannot consume it.
 */
export function EmailChangeConfirm({ token }: { token: string }) {
  const [message, setMessage] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <Shell title="Confirm your new email." heading="Email change">
      {message && (
        <p className={`notice ${done ? "success" : "error"}`} role="status">
          {message}
        </p>
      )}
      {!done && (
        <>
          <p className="muted">
            Confirming makes this address your sign-in email. Other devices
            are signed out.
          </p>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await accountRequest("/account/email/confirm", "POST", {
                  token,
                });
                setDone(true);
                setMessage(r.message);
              } catch (e) {
                setMessage((e as AccountError).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm new email
          </button>
        </>
      )}
    </Shell>
  );
}

/** One-time link from a support operator; the authenticator still applies. */
export function RecoveryLinkReset({ token }: { token: string }) {
  const [state, setState] = useState<{
      mfaRequired: boolean;
      expiresAt: string;
    } | null>(null),
    [message, setMessage] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    accountRequest("/auth/account-recovery/inspect", "POST", { token })
      .then(setState)
      .catch((e) => setMessage((e as Error).message));
  }, [token]);
  return (
    <Shell title="Choose a new password." heading="Account recovery">
      {message && (
        <p className={`notice ${done ? "success" : "error"}`} role="status">
          {message}
        </p>
      )}
      {state && !done && (
        <form
          onSubmit={async (e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget),
              password = String(f.get("password") ?? "");
            if (password !== String(f.get("confirm") ?? "")) {
              setMessage("The passwords do not match.");
              return;
            }
            setBusy(true);
            setMessage("");
            try {
              const r = await accountRequest("/auth/account-recovery", "POST", {
                token,
                password,
                ...(state.mfaRequired
                  ? { code: String(f.get("code") ?? "").trim() }
                  : {}),
              });
              setDone(true);
              setMessage(r.message);
            } catch (error) {
              setMessage((error as AccountError).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="muted">
            This link was created for you by support and expires{" "}
            {formatDate(state.expiresAt)}. Setting a password signs out every
            device.
          </p>
          <label className="field">
            <span>New password</span>
            <input
              name="password"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
            <small className="muted">At least 12 characters.</small>
          </label>
          <label className="field">
            <span>Repeat new password</span>
            <input
              name="confirm"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          {state.mfaRequired && (
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
              <small className="muted">
                Your authenticator stays in place. If you also lost it, tell
                support: an authenticator reset is a separate verified step.
              </small>
            </label>
          )}
          <button className="button" disabled={busy}>
            Save new password
          </button>
        </form>
      )}
    </Shell>
  );
}
