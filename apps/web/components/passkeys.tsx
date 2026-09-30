"use client";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import { useEffect, useState } from "react";
import { formatDate, formatWhen } from "../lib/format";
async function request(path: string, body?: unknown) {
  const r = await fetch("/api/v1/auth/passkeys" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.message);
  return value;
}
const bytes = (s: string) =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
const encoded = (value: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
function responseJSON(credential: PublicKeyCredential) {
  if (typeof credential.toJSON === "function") return credential.toJSON();
  const r = credential.response as AuthenticatorAttestationResponse &
    AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: encoded(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: encoded(r.clientDataJSON),
      ...(r.attestationObject
        ? {
            attestationObject: encoded(r.attestationObject),
            transports: r.getTransports?.() ?? [],
          }
        : {
            authenticatorData: encoded(r.authenticatorData),
            signature: encoded(r.signature),
            userHandle: r.userHandle ? encoded(r.userHandle) : null,
          }),
    },
  };
}
function creation(options: any): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: bytes(options.challenge),
    user: { ...options.user, id: bytes(options.user.id) },
    excludeCredentials: options.excludeCredentials?.map((c: any) => ({
      ...c,
      id: bytes(c.id),
    })),
  };
}
function authentication(options: any): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: bytes(options.challenge),
    allowCredentials: options.allowCredentials?.map((c: any) => ({
      ...c,
      id: bytes(c.id),
    })),
  };
}
function supported() {
  if (
    !globalThis.isSecureContext ||
    !("PublicKeyCredential" in globalThis) ||
    !navigator.credentials
  )
    throw Object.assign(
      new Error("Passkeys need a supported browser on HTTPS or localhost."),
      { code: "PASSKEY_UNSUPPORTED" },
    );
}
const destination = (r: any) =>
  r.platformRole && r.platformRole !== "none"
    ? "/admin"
    : r.role === "subscriber"
      ? "/app"
      : "/trainer";
export function PasskeyLoginButton() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const t = useT("auth"),
    toError = useErrorText();
  return (
    <div>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            supported();
            const c = await request("/authenticate/options", {}),
              credential = await navigator.credentials.get({
                publicKey: authentication(c.options),
              });
            if (!credential)
              throw Object.assign(new Error("No passkey was selected."), {
                code: "PASSKEY_NONE",
              });
            const r = await request("/authenticate/verify", {
              challengeId: c.challengeId,
              response: responseJSON(credential as PublicKeyCredential),
            });
            window.location.assign(destination(r));
          } catch (e) {
            setMessage(
              (e as Error).name === "NotAllowedError"
                ? t("passkeyCancelled")
                : toError(e),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("passkeySignIn")}
      </button>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
export function PasskeySettings() {
  const [rows, setRows] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const t = useT("account"),
    locale = useLocale(),
    toError = useErrorText();
  const load = () => request("").then(setRows);
  useEffect(() => {
    void load().catch((e) => setMessage(toError(e)));
  }, []);
  return (
    <section>
      <h3>{t("passkeys")}</h3>
      <p className="muted">{t("passkeysText")}</p>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setMessage("");
          try {
            supported();
            const c = await request("/register/options", {
                label: f.get("label"),
                password: f.get("password"),
                ...(f.get("code") ? { code: f.get("code") } : {}),
              }),
              credential = await navigator.credentials.create({
                publicKey: creation(c.options),
              });
            if (!credential) throw new Error(t("noPasskeyCreated"));
            await request("/register/verify", {
              challengeId: c.challengeId,
              response: responseJSON(credential as PublicKeyCredential),
            });
            await load();
            setMessage(t("passkeyAdded"));
          } catch (e) {
            setMessage(
              (e as Error).name === "NotAllowedError"
                ? t("passkeyCanceled")
                : toError(e),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>{t("deviceName")}</span>
          <input
            name="label"
            minLength={2}
            maxLength={80}
            required
            placeholder={t("deviceExample")}
          />
        </label>
        <label className="field">
          <span>{t("currentPassword")}</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <label className="field">
          <span>{t("codeIfEnabled")}</span>
          <input
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            autoComplete="one-time-code"
          />
        </label>
        <button className="button secondary" disabled={busy}>
          {t("addPasskey")}
        </button>
      </form>
      {rows.map((row) => (
        <details key={row.id}>
          <summary>
            <bdi>{row.label}</bdi> · <span dir="ltr">{row.rp_id}</span>
          </summary>
          <p>
            {t("added", { date: formatDate(row.created_at, { locale }) })}
            {row.last_used_at
              ? t("lastUsed", {
                  when: formatWhen(row.last_used_at, { locale }),
                })
              : ""}
            .
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await request("/" + row.id + "/revoke", {
                  password: f.get("password"),
                });
                await load();
                setMessage(t("passkeyRevoked"));
              } catch (e) {
                setMessage(toError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>{t("passwordToRemove")}</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button className="button secondary" disabled={busy}>
              {t("revokePasskey")}
            </button>
          </form>
        </details>
      ))}
    </section>
  );
}
