"use client";
import { useEffect, useState } from "react";
async function request(path: string, body?: unknown) {
  const r = await fetch("/api/v1/auth/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message);
  return data;
}
export function AccountSecurity() {
  const [status, setStatus] = useState<any>(null),
    [secret, setSecret] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => request("security").then(setStatus);
  useEffect(() => {
    void load().catch((e) => setNotice(e.message));
  }, []);
  async function submit(path: string, body: unknown) {
    setBusy(true);
    setNotice("");
    try {
      const data = await request(path, body);
      if (data.secret) setSecret(data.secret);
      else {
        setSecret("");
        setNotice("Account security updated.");
      }
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Account security</h2>
      <p className="muted">
        Protect your account and verify sensitive financial actions.
      </p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <p>Email: {status?.emailVerified ? "verified" : "verification needed"}</p>
      {status && !status.emailVerified && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void submit("request-verification", {})}
        >
          Send verification email
        </button>
      )}
      <h3>Authenticator</h3>
      <p>
        {status?.mfaEnabled
          ? "Enabled. A fresh code and password confirm sensitive actions for ten minutes."
          : status?.mfaConfigured
            ? "Add this account to your authenticator app."
            : "Authenticator setup is waiting for the security service configuration."}
      </p>
      {status?.mfaConfigured && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void submit(
              secret
                ? "mfa/confirm"
                : status.mfaEnabled
                  ? "mfa/verify"
                  : "mfa/enroll",
              secret
                ? { code: f.get("code") }
                : status.mfaEnabled
                  ? { password: f.get("password"), code: f.get("code") }
                  : { password: f.get("password") },
            );
          }}
        >
          {!secret && (
            <label className="field">
              <span>Current password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
          )}
          {secret && (
            <p className="notice">
              Manual setup key:{" "}
              <code style={{ overflowWrap: "anywhere" }}>{secret}</code>
              <br />
              Use time-based codes, 6 digits, 30 seconds. Save this key in your
              password manager before confirming.
            </p>
          )}
          {(secret || status.mfaEnabled) && (
            <label className="field">
              <span>Authenticator code</span>
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
              />
            </label>
          )}
          <button className="button" disabled={busy}>
            {secret
              ? "Confirm authenticator"
              : status.mfaEnabled
                ? "Verify sensitive actions"
                : "Set up authenticator"}
          </button>
        </form>
      )}
      <div className="divider" />
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => void submit("sessions/revoke", {})}
      >
        Sign out other sessions
      </button>
      <p className="muted">
        <a href="/forgot-password">Reset your password</a>
      </p>
    </section>
  );
}
export function AccountRecovery({ path }: { path: string }) {
  const reset = path.startsWith("/reset-password/"),
    verify = path.startsWith("/verify-email/");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [complete, setComplete] = useState(false);
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>
          {verify
            ? "Verify your email."
            : reset
              ? "Choose a new password."
              : "Get back to your coaching space."}
        </h1>
      </section>
      <section className="card">
        <h2>{verify ? "Email verification" : "Password recovery"}</h2>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {!complete && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                const r = await request(
                  verify
                    ? "verify-email"
                    : reset
                      ? "reset-password"
                      : "forgot-password",
                  verify
                    ? { token: path.split("/").pop() }
                    : reset
                      ? {
                          token: path.split("/").pop(),
                          password: f.get("password"),
                        }
                      : { email: f.get("email") },
                );
                setMessage(
                  r.message ??
                    (verify
                      ? "Email verified. You can return to your workspace."
                      : "Password changed. Sign in with your new password."),
                );
                setComplete(true);
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {!verify && (
              <label className="field">
                <span>{reset ? "New password" : "Email address"}</span>
                <input
                  name={reset ? "password" : "email"}
                  type={reset ? "password" : "email"}
                  minLength={reset ? 12 : undefined}
                  autoComplete={reset ? "new-password" : "email"}
                  required
                />
              </label>
            )}
            <button className="button" disabled={busy}>
              {verify
                ? "Verify email"
                : reset
                  ? "Save password"
                  : "Send reset link"}
            </button>
          </form>
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
