"use client";
import { useErrorText, useT } from "../lib/i18n/react";
import { useEffect, useState } from "react";
import { AuthPage, ReturnToSignIn } from "./auth-page";
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
    [codes, setCodes] = useState<string[]>([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const t = useT("account"),
    toError = useErrorText();
  const load = () => request("security").then(setStatus);
  useEffect(() => {
    void load().catch((e) => setNotice(toError(e)));
  }, []);
  async function submit(path: string, body: unknown) {
    setBusy(true);
    setNotice("");
    try {
      const data = await request(path, body);
      setCodes(data.recoveryCodes ?? []);
      if (data.secret) setSecret(data.secret);
      else {
        setSecret("");
        setNotice(
          t.locale === "en"
            ? (data.message ?? t("securityUpdated"))
            : t("securityUpdated"),
        );
      }
      await load();
      window.dispatchEvent(new Event("account-security-updated"));
    } catch (e) {
      setNotice(toError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>{t("security")}</h2>
      <p className="muted">{t("securityText")}</p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {codes.length > 0 && (
        <div className="notice">
          <strong>{t("codesShownOnce")}</strong>
          <textarea
            readOnly
            rows={codes.length}
            value={codes.join("\n")}
            aria-label={t("codesLabel")}
            style={{ width: "100%", fontFamily: "monospace" }}
          />
        </div>
      )}
      <p>{status?.emailVerified ? t("emailVerified") : t("emailNeeded")}</p>
      {status && !status.emailVerified && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void submit("request-verification", {})}
        >
          {t("sendVerification")}
        </button>
      )}
      <h3>{t("authenticator")}</h3>
      <p>
        {status?.mfaEnabled
          ? t("mfaEnabled")
          : status?.mfaConfigured
            ? t("mfaAdd")
            : t("mfaWaiting")}
      </p>
      {status?.mfaConfigured &&
        status.hasPassword === false &&
        !status.mfaEnabled && (
          <p className="muted" role="note">
            {t("mfaNoPassword")}
          </p>
        )}
      {status?.mfaConfigured &&
        (status.hasPassword !== false || status.mfaEnabled) && (
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
                <span>{t("currentPassword")}</span>
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
                {t("setupKey")}{" "}
                <code style={{ overflowWrap: "anywhere" }}>{secret}</code>
                <br />
                {t("setupKeyHelp")}
              </p>
            )}
            {(secret || status.mfaEnabled) && (
              <label className="field">
                <span>{t("authenticatorCode")}</span>
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
                ? t("confirmAuthenticator")
                : status.mfaEnabled
                  ? t("verifySensitive")
                  : t("setUpAuthenticator")}
            </button>
          </form>
        )}
      <div className="divider" />
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => void submit("sessions/revoke", {})}
      >
        {t("signOutOthers")}
      </button>
      <p className="muted">
        <a href="/forgot-password">{t("resetPassword")}</a>
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
  const t = useT("auth"),
    toError = useErrorText();
  return (
    <AuthPage
      title={
        verify
          ? t("verifyTitle")
          : reset
            ? t("newPasswordTitle")
            : t("resetTitle")
      }
      intro={
        verify
          ? t("verifyIntro")
          : reset
            ? t("newPasswordIntro")
            : t("resetIntro")
      }
    >
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
                // The server's sentence in English; the same fact otherwise.
                const own = verify
                  ? t("verified")
                  : reset
                    ? t("passwordChanged")
                    : t("resetSent");
                setMessage(t.locale === "en" ? (r.message ?? own) : own);
                setComplete(true);
              } catch (e) {
                setMessage(toError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {!verify && (
              <label className="field">
                <span>{reset ? t("newPassword") : t("emailAddress")}</span>
                <input
                  name={reset ? "password" : "email"}
                  type={reset ? "password" : "email"}
                  inputMode={reset ? undefined : "email"}
                  minLength={reset ? 12 : undefined}
                  autoComplete={reset ? "new-password" : "email"}
                  enterKeyHint={reset ? "done" : "send"}
                  required
                />
              </label>
            )}
            <button className="button" disabled={busy}>
              {verify
                ? t("verifyButton")
                : reset
                  ? t("savePassword")
                  : t("sendResetLink")}
            </button>
          </form>
        )}
        <ReturnToSignIn />
    </AuthPage>
  );
}
