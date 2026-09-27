"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PushDevice = {
  id: string;
  label: string;
  expiresAt: string;
  current: boolean;
};

type PushSettings = {
  configured: boolean;
  publicKey: string | null;
  devices: PushDevice[];
  maxDevices: number;
};

type BrowserState = {
  support: "checking" | "supported" | "insecure" | "install" | "unsupported";
  permission: NotificationPermission | null;
  subscription: PushSubscription | null;
  readFailed: boolean;
};

class PushRequestError extends Error {}

async function pushApi<T>(
  path = "",
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1/notifications/push${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    // Do not surface raw provider errors: they may contain a private endpoint.
    throw new PushRequestError(
      response.status === 401 || response.status === 403
        ? "Your sign-in needs refreshing. Sign in again, then retry."
        : response.status === 409 || response.status === 429
          ? "Push setup changed or the device limit was reached. Refresh, remove an unused device if needed, then retry."
          : response.status === 503
            ? "Push notifications are temporarily unavailable. Try again later."
            : "The push settings request failed. Refresh and try again.",
    );
  }
  return response.json();
}

function publicKeyBytes(publicKey: string) {
  const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
  const raw = window.atob(
    (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/"),
  );
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function hasCurrentKey(subscription: PushSubscription, publicKey: string) {
  try {
    const existing = subscription.options.applicationServerKey;
    if (!existing) return false;
    const expected = publicKeyBytes(publicKey);
    const actual = new Uint8Array(existing);
    return (
      actual.length === expected.length &&
      actual.every((byte, i) => byte === expected[i])
    );
  } catch {
    return false;
  }
}

function subscriptionExpired(subscription: PushSubscription) {
  return (
    subscription.expirationTime !== null &&
    subscription.expirationTime <= Date.now()
  );
}

async function readBrowserState(): Promise<BrowserState> {
  const empty = { permission: null, subscription: null, readFailed: false };
  if (!window.isSecureContext) return { ...empty, support: "insecure" };
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return { ...empty, support: "install" };
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return { ...empty, support: "unsupported" };
  }
  const state: BrowserState = {
    ...empty,
    support: "supported",
    permission: Notification.permission,
  };
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    state.subscription = registration
      ? await registration.pushManager.getSubscription()
      : null;
  } catch {
    state.readFailed = true;
  }
  return state;
}

async function readyRegistration() {
  await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const timeout = window.setTimeout(
      () =>
        reject(
          new PushRequestError(
            "The app is still preparing notifications. Check your connection and try again.",
          ),
        ),
      15000,
    );
    navigator.serviceWorker.ready.then(
      (registration) => {
        window.clearTimeout(timeout);
        resolve(registration);
      },
      () => {
        window.clearTimeout(timeout);
        reject(
          new PushRequestError(
            "The app could not prepare notifications. Refresh and retry.",
          ),
        );
      },
    );
  });
}

function actionError(error: unknown, fallback: string) {
  if (error instanceof PushRequestError) return error.message;
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Notifications were not allowed. Check this site's notification permission in your browser settings, then retry.";
  }
  return fallback;
}

export function PushNotifications() {
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [browser, setBrowser] = useState<BrowserState>({
    support: "checking",
    permission: null,
    subscription: null,
    readFailed: false,
  });
  const [label, setLabel] = useState("This browser");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsRetry, setNeedsRetry] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busyRef = useRef(false);
  const loadVersion = useRef(0);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    try {
      const [nextSettings, nextBrowser] = await Promise.all([
        pushApi<PushSettings>(),
        readBrowserState(),
      ]);
      if (version !== loadVersion.current) return;
      setSettings(nextSettings);
      setBrowser(nextBrowser);
    } catch (e) {
      if (version !== loadVersion.current) return;
      setSettings(null);
      setError(
        actionError(
          e,
          "Could not load push settings. Check your connection and retry.",
        ),
      );
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const update = () => {
      if (document.visibilityState === "visible" && !busyRef.current) {
        setNotice("");
        void refresh();
      }
    };
    const subscriptionChanged = (event: MessageEvent) => {
      if (event.data?.type !== "trainer-push-subscription-changed") return;
      setNeedsRetry(true);
      setNotice(
        "Your browser's push connection expired. Reconnect to receive updates again.",
      );
      void refresh();
    };
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.addEventListener("message", subscriptionChanged);
    return () => {
      loadVersion.current++;
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", update);
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.removeEventListener(
          "message",
          subscriptionChanged,
        );
    };
  }, [refresh]);

  async function enable() {
    if (
      busyRef.current ||
      !settings?.configured ||
      !settings.publicKey ||
      browser.support !== "supported"
    )
      return;
    busyRef.current = true;
    loadVersion.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // Request permission directly in this click handler, before registration or network work.
      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
      setBrowser((value) => ({ ...value, permission }));
      if (permission !== "granted") {
        setNotice(
          permission === "denied"
            ? "Notifications are blocked. Allow them in this site's browser settings, then return and refresh."
            : "Notifications were not enabled. You can try again when you are ready.",
        );
        return;
      }
      setNeedsRetry(true);
      const registration = await readyRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (
        subscription &&
        (subscriptionExpired(subscription) ||
          !hasCurrentKey(subscription, settings.publicKey))
      ) {
        await subscription.unsubscribe();
        subscription = await registration.pushManager.getSubscription();
        if (subscription)
          throw new PushRequestError(
            "The old push connection could not be cleared. Retry or remove this site's notification permission in your browser settings.",
          );
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKeyBytes(settings.publicKey),
        });
      }
      const deviceLabel = label.trim() || "This browser";
      // Payloadless push needs the endpoint and VAPID public key only, never subscription encryption keys.
      const saved = await pushApi<{ id: string; expiresAt: string }>(
        "",
        "POST",
        {
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime,
          publicKey: settings.publicKey,
          label: deviceLabel,
        },
      );
      setBrowser({
        support: "supported",
        permission,
        subscription,
        readFailed: false,
      });
      setSettings(
        (value) =>
          value && {
            ...value,
            devices: [
              ...value.devices.filter(
                (device) => !device.current && device.id !== saved.id,
              ),
              {
                ...saved,
                label: deviceLabel,
                current: true,
              },
            ],
          },
      );
      setNeedsRetry(false);
      setNotice("Push notifications are enabled for this browser.");
    } catch (e) {
      setBrowser(await readBrowserState());
      setError(
        actionError(
          e,
          "Could not confirm this browser's push connection. Check your connection, then retry enabling it.",
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      setLoading(false);
    }
  }

  async function remove(device?: PushDevice) {
    if (busyRef.current) return;
    busyRef.current = true;
    loadVersion.current++;
    setBusy(true);
    setError("");
    setNotice("");
    let serverError: unknown;
    let browserError = false;
    try {
      if (device) {
        try {
          await pushApi<void>(`/${encodeURIComponent(device.id)}`, "DELETE");
          setSettings(
            (value) =>
              value && {
                ...value,
                devices: value.devices.filter((item) => item.id !== device.id),
              },
          );
        } catch (e) {
          serverError = e;
        }
      }
      // Removing another device never changes this browser's subscription.
      if (!device || device.current) {
        try {
          if ("serviceWorker" in navigator) {
            const registration =
              await navigator.serviceWorker.getRegistration("/");
            const subscription =
              await registration?.pushManager.getSubscription();
            if (subscription) {
              await subscription.unsubscribe();
              if (await registration!.pushManager.getSubscription())
                browserError = true;
            }
          }
        } catch {
          browserError = true;
        }
        setBrowser(await readBrowserState());
        setNeedsRetry(false);
      }
      if (serverError) {
        setError(
          actionError(
            serverError,
            "Could not remove the saved device. Check your connection, then retry its Remove button.",
          ),
        );
        if (device?.current && !browserError)
          setNotice(
            "This browser's push subscription is cleared. Its saved device still needs to be removed.",
          );
      } else if (browserError) {
        setError(
          "Push is disconnected from your account, but the browser subscription could not be cleared. Retry clearing it or use this site's notification settings.",
        );
      } else {
        setNotice(
          device && !device.current
            ? "Device removed. It will no longer receive updates."
            : "Push notifications are disabled for this browser.",
        );
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      setLoading(false);
    }
  }

  const currentDevice = settings?.devices.find((device) => device.current);
  const keyMatches = !!(
    settings?.publicKey &&
    browser.subscription &&
    !subscriptionExpired(browser.subscription) &&
    hasCurrentKey(browser.subscription, settings.publicKey)
  );
  const connected = !!(
    settings?.configured &&
    currentDevice &&
    keyMatches &&
    browser.permission === "granted" &&
    !needsRetry
  );
  const canEnable = !!(
    settings?.configured &&
    settings.publicKey &&
    browser.support === "supported" &&
    browser.permission !== "denied"
  );
  const reconnect = !!(currentDevice || browser.subscription || needsRetry);

  return (
    <section className="card" aria-busy={loading || busy}>
      <h2>Browser push notifications</h2>
      <p className="muted">
        Get a generic update alert while the app is closed. Open your inbox to
        see the details.
      </p>
      {loading && <p role="status">Checking push notifications…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {settings && !settings.configured && (
        <p className="notice">
          Push notifications have not been configured for this app. You can
          still remove saved devices below.
        </p>
      )}
      {browser.support === "insecure" && (
        <p className="notice">
          Open this app over HTTPS to enable browser push notifications.
        </p>
      )}
      {browser.support === "install" && (
        <p className="notice">
          On iPhone or iPad, open the Share menu and choose Add to Home Screen.
          Open the installed app, sign in, then enable notifications here.
        </p>
      )}
      {browser.support === "unsupported" && (
        <p className="notice">
          This browser does not support push notifications. Your in-app inbox
          remains available.
        </p>
      )}
      {browser.permission === "denied" && (
        <p className="notice">
          Notifications are blocked in your browser. Allow this site in your
          browser's notification settings, then refresh below.
        </p>
      )}
      {browser.readFailed && (
        <p className="notice">
          The browser connection could not be checked. Refresh to retry; saved
          devices can still be removed.
        </p>
      )}
      {!loading && connected && (
        <p role="status">Enabled for this browser and sign-in session.</p>
      )}
      {!loading && canEnable && !connected && (
        <>
          {reconnect && (
            <p className="muted">
              Reconnect this browser after a session, browser subscription, or
              push configuration change.
            </p>
          )}
          <label className="field">
            <span>Device label</span>
            <input
              value={label}
              maxLength={60}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="For example, Personal phone"
            />
          </label>
          <p>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void enable()}
            >
              {busy
                ? "Updating…"
                : reconnect
                  ? "Reconnect this browser"
                  : "Enable push on this browser"}
            </button>
          </p>
        </>
      )}
      {!currentDevice && browser.subscription && (
        <p>
          <button
            type="button"
            className="button secondary"
            disabled={busy || loading}
            onClick={() => void remove()}
          >
            Clear this browser subscription
          </button>
        </p>
      )}
      {settings && (
        <>
          <h3>
            Saved devices ({settings.devices.length}/{settings.maxDevices})
          </h3>
          {!settings.devices.length && (
            <p className="muted">No devices are connected to your account.</p>
          )}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {settings.devices.map((device) => (
              <li
                key={device.id}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <div style={{ flex: "1 1 200px", overflowWrap: "anywhere" }}>
                  <strong>{device.label}</strong>
                  {device.current && " · This sign-in session"}
                  <br />
                  <small className="muted">
                    Connection ends{" "}
                    {new Date(device.expiresAt).toLocaleString()}
                  </small>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || loading}
                  aria-label={`Remove ${device.label}${device.current ? " from this browser" : ""}`}
                  onClick={() => void remove(device)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted">
        Push stops when you sign out, revoke this session, or the session
        expires. Enable it again after signing in. Removing another device
        disconnects it from this account.
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={busy || loading}
        onClick={() => {
          setNotice("");
          void refresh();
        }}
      >
        Refresh push status
      </button>
    </section>
  );
}
