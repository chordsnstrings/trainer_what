"use client";
import { useEffect, useState } from "react";
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
    throw new Error("Passkeys need a supported browser on HTTPS or localhost.");
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
            if (!credential) throw new Error("No passkey was selected.");
            const r = await request("/authenticate/verify", {
              challengeId: c.challengeId,
              response: responseJSON(credential as PublicKeyCredential),
            });
            window.location.assign(destination(r));
          } catch (e) {
            setMessage(
              (e as Error).name === "NotAllowedError"
                ? "Passkey selection was canceled or timed out."
                : (e as Error).message,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Sign in with a passkey
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
  const load = () => request("").then(setRows);
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, []);
  return (
    <section>
      <h3>Passkeys</h3>
      <p className="muted">
        Use your device’s fingerprint, face recognition or security key. A
        passkey is registered to this website address. Keep another sign-in
        method for a lost device.
      </p>
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
            if (!credential) throw new Error("No passkey was created.");
            await request("/register/verify", {
              challengeId: c.challengeId,
              response: responseJSON(credential as PublicKeyCredential),
            });
            await load();
            setMessage("Passkey added.");
          } catch (e) {
            setMessage(
              (e as Error).name === "NotAllowedError"
                ? "Passkey setup was canceled or timed out."
                : (e as Error).message,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>Device name</span>
          <input
            name="label"
            minLength={2}
            maxLength={80}
            required
            placeholder="My phone"
          />
        </label>
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
          <span>Authenticator code, if enabled</span>
          <input
            name="code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            autoComplete="one-time-code"
          />
        </label>
        <button className="button secondary" disabled={busy}>
          Add a passkey
        </button>
      </form>
      {rows.map((row) => (
        <details key={row.id}>
          <summary>
            {row.label} · {row.rp_id}
          </summary>
          <p>
            Added {new Date(row.created_at).toLocaleDateString()}
            {row.last_used_at
              ? " · last used " + new Date(row.last_used_at).toLocaleString()
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
                setMessage("Passkey revoked and other sessions signed out.");
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>Current password to remove this passkey</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Revoke passkey
            </button>
          </form>
        </details>
      ))}
    </section>
  );
}
