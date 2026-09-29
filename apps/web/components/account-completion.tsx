"use client";
import { useEffect, useState } from "react";
import { PasskeySettings } from "./passkeys";
import { formatDate, formatWhen, plural } from "../lib/format";
import { accountRequest } from "./account-request";
/** Reads have a time limit and a readable error (account-request.ts). */
function request(path: string, body?: unknown) {
  return accountRequest(
    "/auth/" + path,
    body === undefined ? "GET" : "POST",
    body,
  );
}
export function AccountExtras() {
  const [data, setData] = useState<any>(null),
    [codes, setCodes] = useState<string[]>([]),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false);
  const load = () =>
    request("account").then((value) => {
      setData(value);
      setFailed(false);
    });
  useEffect(() => {
    const refresh = () =>
      void load().catch(() => {
        setFailed(true);
      });
    refresh();
    window.addEventListener("account-security-updated", refresh);
    return () =>
      window.removeEventListener("account-security-updated", refresh);
  }, []);
  return (
    <section className="card">
      <h2>Access and recovery</h2>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <PasskeySettings />
      <h3>Authenticator recovery codes</h3>
      <p className="muted">
        Save these privately before you lose your authenticator. Recovery
        requires your password and one code, invalidates every code and signs
        out all sessions. Set up a new authenticator immediately afterward.
      </p>
      <p>
        {!data
          ? failed
            ? "Your recovery codes could not be checked just now."
            : "Checking your recovery codes…"
          : data.mfaEnabled
            ? `${plural(data.recoveryCodesRemaining ?? 0, "recovery code")} left.`
            : "Recovery codes appear once you set up an authenticator app."}
      </p>
      {data?.mfaEnabled && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setCodes([]);
            try {
              const r = await request("mfa/recovery-codes", {
                password: f.get("password"),
              });
              setCodes(r.codes);
              await load();
              setMessage(r.message);
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>Current password (verify Account security first)</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="button secondary" disabled={busy}>
            Replace recovery codes
          </button>
        </form>
      )}
      {codes.length > 0 && (
        <div className="notice">
          <label className="field">
            <span>Shown once — copy to your password manager</span>
            <textarea
              readOnly
              rows={10}
              value={codes.join("\n")}
              aria-label="Your new recovery codes"
            />
          </label>
          <button className="button secondary" onClick={() => setCodes([])}>
            I saved my codes
          </button>
        </div>
      )}
      <h3>Where you are signed in</h3>
      {!data && !failed && <p className="muted">Checking your sign-ins…</p>}
      {!data && failed && (
        <div role="alert">
          <p>Where you are signed in could not be checked just now.</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setFailed(false);
              void load().catch(() => setFailed(true));
            }}
          >
            Try again
          </button>
        </div>
      )}
      {data?.sessions.map((s: any) => (
        <div className="card" key={s.id}>
          <strong>
            {s.current ? "This device" : "Another device or browser"}
          </strong>
          <p>
            Last active {formatWhen(s.last_seen_at)} · signs out by itself on{" "}
            {formatDate(s.expires_at)}
            {s.workspace ? ` · opened in ${s.workspace}` : ""}.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await request("sessions/" + s.id + "/revoke", {});
                if (r.current) {
                  window.location.assign("/login");
                  return;
                }
                await load();
                setMessage("Session signed out.");
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign out{!s.current ? " session" : ""}
          </button>
        </div>
      ))}
    </section>
  );
}
export function MagicAccess({ path }: { path: string }) {
  const recover = path === "/recover-authenticator",
    token = path.startsWith("/magic-link/") ? path.split("/").pop() : undefined;
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [complete, setComplete] = useState(false);
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>
          {recover
            ? "Recover your authenticator."
            : token
              ? "Confirm your sign-in."
              : "Email a secure sign-in link."}
        </h1>
        <p>
          {recover
            ? "Use a saved recovery code and your password. Your existing sessions and recovery codes will be revoked."
            : token
              ? "Confirm below to use this link. If an authenticator is enabled, enter its fresh code."
              : "A single-use link expires after 15 minutes. Your authenticator remains required if enabled."}
        </p>
      </section>
      <section className="card">
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
                  recover
                    ? "mfa/recover"
                    : token
                      ? "magic-link/consume"
                      : "magic-link",
                  recover
                    ? {
                        email: f.get("email"),
                        password: f.get("password"),
                        recoveryCode: f.get("recoveryCode"),
                      }
                    : token
                      ? {
                          token,
                          ...(f.get("code") ? { code: f.get("code") } : {}),
                        }
                      : { email: f.get("email") },
                );
                if (recover || token) {
                  window.location.assign(
                    r.platformRole && r.platformRole !== "none"
                      ? "/admin"
                      : r.role === "subscriber"
                        ? "/app/profile"
                        : "/trainer/settings",
                  );
                  return;
                }
                setMessage(r.message);
                setComplete(true);
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {!token && (
              <label className="field">
                <span>Email address</span>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
            )}
            {token && (
              <label className="field">
                <span>Authenticator code, if enabled</span>
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                />
              </label>
            )}
            {recover && (
              <>
                <label className="field">
                  <span>Current password</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label className="field">
                  <span>Saved recovery code</span>
                  <input
                    name="recoveryCode"
                    autoComplete="one-time-code"
                    minLength={20}
                    maxLength={100}
                    required
                  />
                </label>
              </>
            )}
            <button className="button" disabled={busy}>
              {recover
                ? "Recover authenticator"
                : token
                  ? "Confirm sign-in"
                  : "Send sign-in link"}
            </button>
          </form>
        )}
        <p className="auth-return">
          <a href="/login">Return to sign in</a>
        </p>
      </section>
    </main>
  );
}
