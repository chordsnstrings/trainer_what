"use client";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import { formatDate, formatDateTime } from "../lib/format";
import { useEffect, useState } from "react";
import { PasskeySettings } from "./passkeys";
import { AuthPage, ReturnToSignIn } from "./auth-page";
async function request(path: string, body?: unknown) {
  const r = await fetch("/api/v1/auth/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.message);
  return value;
}
export function AccountExtras() {
  const [data, setData] = useState<any>(null),
    [codes, setCodes] = useState<string[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const t = useT("account"),
    locale = useLocale(),
    toError = useErrorText();
  const load = () => request("account").then(setData);
  useEffect(() => {
    const refresh = () => void load().catch((e) => setMessage(toError(e)));
    refresh();
    window.addEventListener("account-security-updated", refresh);
    return () =>
      window.removeEventListener("account-security-updated", refresh);
  }, []);
  return (
    <section className="card">
      <h2>{t("accessRecovery")}</h2>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <PasskeySettings />
      <h3>{t("recoveryCodes")}</h3>
      <p className="muted">{t("recoveryText")}</p>
      <p>
        {t("codesAvailable", { count: data?.recoveryCodesRemaining ?? 0 })}
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
              setMessage(locale === "en" ? r.message : t("codesReplaced"));
            } catch (e) {
              setMessage(toError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>{t("passwordVerifyFirst")}</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="button secondary" disabled={busy}>
            {t("replaceCodes")}
          </button>
        </form>
      )}
      {codes.length > 0 && (
        <div className="notice">
          <label className="field">
            <span>{t("shownOnceCopy")}</span>
            <textarea
              readOnly
              rows={10}
              value={codes.join("\n")}
              aria-label={t("newCodesLabel")}
            />
          </label>
          <button className="button secondary" onClick={() => setCodes([])}>
            {t("savedCodes")}
          </button>
        </div>
      )}
      <h3>{t("sessions")}</h3>
      {data?.sessions.map((s: any) => (
        <div className="card" key={s.id}>
          <strong>
            <bdi>{s.workspace}</bdi>
            {s.current ? t("thisSession") : ""}
          </strong>
          <p>
            {locale === "en"
              ? `Last active ${new Date(s.last_seen_at).toLocaleString()} · expires ${new Date(s.expires_at).toLocaleDateString()}.`
              : t("lastActive", {
                  when: formatDateTime(s.last_seen_at, { locale }),
                  date: formatDate(s.expires_at, { locale }),
                })}
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
                setMessage(t("sessionSignedOut"));
              } catch (e) {
                setMessage(toError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {s.current ? t("signOut") : t("signOutSession")}
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
  const t = useT("auth"),
    toError = useErrorText();
  return (
    <AuthPage
      title={
        recover
          ? t("recoverTitle")
          : token
            ? t("confirmSignInTitle")
            : t("emailLinkTitle")
      }
      intro={
        recover
          ? t("recoverIntro")
          : token
            ? t("confirmIntro")
            : t("emailLinkIntro")
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
                // The server's sentence in English; the same fact otherwise.
                setMessage(t.locale === "en" ? r.message : t("emailLinkSent"));
                setComplete(true);
              } catch (e) {
                setMessage(toError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {!token && (
              <label className="field">
                <span>{t("emailAddress")}</span>
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  enterKeyHint={recover ? "next" : "send"}
                  required
                />
              </label>
            )}
            {token && (
              <label className="field">
                <span>{t("codeIfUsed")}</span>
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  enterKeyHint="go"
                  pattern="[0-9]{6}"
                  maxLength={6}
                />
              </label>
            )}
            {recover && (
              <>
                <label className="field">
                  <span>{t("currentPassword")}</span>
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    enterKeyHint="next"
                    required
                  />
                </label>
                <label className="field">
                  <span>{t("recoveryCode")}</span>
                  <input
                    name="recoveryCode"
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="go"
                    minLength={20}
                    maxLength={100}
                    required
                  />
                </label>
              </>
            )}
            <button className="button" disabled={busy}>
              {recover
                ? t("recoverButton")
                : token
                  ? t("confirmButton")
                  : t("sendLink")}
            </button>
          </form>
        )}
        <ReturnToSignIn />
    </AuthPage>
  );
}
