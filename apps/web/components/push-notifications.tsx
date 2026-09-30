"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isStandalone, registerServiceWorker } from "./pwa";
import { translator, type Locale, type PlainKey } from "../lib/i18n/core";
import pushMessages from "../lib/i18n/messages/push";
import { parseLanguage } from "../document-language";
import { useLocale, useT } from "../lib/i18n/react";
import { formatDateTime } from "../lib/format";

/** A push message key (lib/i18n/messages/push.ts). */
export type PushMessage = PlainKey<typeof pushMessages.en>;
/** The page's language, for text built outside a component. */
function deviceLocale(): Locale {
  return (
    (typeof document !== "undefined" &&
      parseLanguage(document.documentElement.lang)) ||
    "en"
  );
}

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

/** Carries a message key; the screen shows it in the member's language. */
class PushRequestError extends Error {
  constructor(readonly key: PushMessage) {
    super(key);
  }
}

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
        ? "errSignIn"
        : response.status === 409 || response.status === 429
          ? "errLimit"
          : response.status === 503
            ? "errUnavailable"
            : "errFailed",
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
  // The same release-versioned worker the app registers (components/pwa.ts).
  await registerServiceWorker();
  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const timeout = window.setTimeout(
      () =>
        reject(
          new PushRequestError(
            "errPreparing",
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
            "errPrepare",
          ),
        );
      },
    );
  });
}

function actionError(error: unknown, fallback: PushMessage): PushMessage {
  if (error instanceof PushRequestError) return error.key;
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "errNotAllowed";
  }
  return fallback;
}

/** Whether this device can turn on push from a prompt (not the settings card). */
export type PushReadiness =
  | { kind: "ready"; publicKey: string }
  | { kind: "ios-install" }
  | { kind: "enabled" }
  | { kind: "unavailable" };
/**
 * What a prompt after a meaningful moment (install, a coach's reply) can
 * offer: turn push on, explain that iPhone needs the installed app, or
 * nothing (not configured, unsupported, blocked, or already on).
 */
export async function pushReadiness(): Promise<PushReadiness> {
  try {
    const browser = await readBrowserState();
    if (browser.support === "install") return { kind: "ios-install" };
    if (browser.support !== "supported" || browser.permission === "denied")
      return { kind: "unavailable" };
    const settings = await pushApi<PushSettings>();
    if (!settings.configured || !settings.publicKey)
      return { kind: "unavailable" };
    if (
      browser.permission === "granted" &&
      browser.subscription &&
      settings.devices.some((device) => device.current) &&
      hasCurrentKey(browser.subscription, settings.publicKey)
    )
      return { kind: "enabled" };
    return { kind: "ready", publicKey: settings.publicKey };
  } catch {
    return { kind: "unavailable" };
  }
}
/**
 * Turns push on for this device from the member's own tap: permission first
 * (still inside the tap), then the subscription, saved for this sign-in.
 */
export async function turnOnPush(
  publicKey: string,
): Promise<{ ok: boolean; message: PushMessage }> {
  try {
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== "granted")
      return {
        ok: false,
        message:
          permission === "denied"
            ? "blockedApp"
            : "stillOff",
      };
    const registration = await readyRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (
      subscription &&
      (subscriptionExpired(subscription) ||
        !hasCurrentKey(subscription, publicKey))
    ) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKeyBytes(publicKey),
    });
    await pushApi("", "POST", {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime,
      publicKey,
      label: translator(pushMessages, deviceLocale())(
        isStandalone() ? "installedApp" : "thisBrowser",
      ),
    });
    return { ok: true, message: "onForPhone" };
  } catch (e) {
    return {
      ok: false,
      message: actionError(
        e,
        "couldNotTurnOn",
      ),
    };
  }
}

export function PushNotifications() {
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [browser, setBrowser] = useState<BrowserState>({
    support: "checking",
    permission: null,
    subscription: null,
    readFailed: false,
  });
  const t = useT("push"),
    common = useT("common"),
    locale = useLocale();
  const [label, setLabel] = useState(() =>
    translator(pushMessages, deviceLocale())("thisBrowser"),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsRetry, setNeedsRetry] = useState(false);
  const [error, setError] = useState<PushMessage | "">("");
  const [notice, setNotice] = useState<PushMessage | "">("");
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
          "couldNotLoad",
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
        "expired",
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
            ? "blockedSite"
            : "notEnabled",
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
            "oldNotCleared",
          );
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKeyBytes(settings.publicKey),
        });
      }
      const deviceLabel = label.trim() || t("thisBrowser");
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
      setNotice("enabledBrowser");
    } catch (e) {
      setBrowser(await readBrowserState());
      setError(
        actionError(
          e,
          "couldNotConfirm",
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
            "couldNotRemove",
          ),
        );
        if (device?.current && !browserError)
          setNotice(
            "subscriptionCleared",
          );
      } else if (browserError) {
        setError(
          "partlyDisconnected",
        );
      } else {
        setNotice(
          device && !device.current
            ? "deviceRemoved"
            : "disabledBrowser",
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
      <h2>{t("title")}</h2>
      <p className="muted">{t("intro")}</p>
      {loading && <p role="status">{t("checking")}</p>}
      {error && (
        <p className="notice error" role="alert">
          {t(error)}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {t(notice)}
        </p>
      )}
      {settings && !settings.configured && (
        <p className="notice">{t("notConfigured")}</p>
      )}
      {browser.support === "insecure" && (
        <p className="notice">{t("insecure")}</p>
      )}
      {browser.support === "install" && (
        <p className="notice">{t("iosInstall")}</p>
      )}
      {browser.support === "unsupported" && (
        <p className="notice">{t("unsupported")}</p>
      )}
      {browser.permission === "denied" && (
        <p className="notice">{t("deniedBrowser")}</p>
      )}
      {browser.readFailed && <p className="notice">{t("readFailed")}</p>}
      {!loading && connected && (
        <p role="status">{t("enabledSession")}</p>
      )}
      {!loading && canEnable && !connected && (
        <>
          {reconnect && <p className="muted">{t("reconnectHint")}</p>}
          <label className="field">
            <span>{t("deviceLabel")}</span>
            <input
              value={label}
              maxLength={60}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("deviceLabelExample")}
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
                ? t("updating")
                : reconnect
                  ? t("reconnect")
                  : t("enable")}
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
            {t("clearSubscription")}
          </button>
        </p>
      )}
      {settings && (
        <>
          <h3>{t("savedDevices")}</h3>
          {settings.devices.length ? (
            <p className="muted">
              {t("devicesOf", {
                count: settings.maxDevices,
                n: settings.devices.length,
              })}
            </p>
          ) : (
            <p className="muted">{t("noDevices")}</p>
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
                  <strong>
                    <bdi>{device.label}</bdi>
                  </strong>
                  {device.current && t("thisSession")}
                  <br />
                  <small className="muted">
                    {t("connectionEnds", {
                      date: formatDateTime(device.expiresAt, { locale }),
                    })}
                  </small>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || loading}
                  aria-label={t(
                    device.current ? "removeDeviceHere" : "removeDevice",
                    { name: device.label },
                  )}
                  onClick={() => void remove(device)}
                >
                  {common("remove")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted">{t("stopsWhen")}</p>
      <button
        type="button"
        className="button secondary"
        disabled={busy || loading}
        onClick={() => {
          setNotice("");
          void refresh();
        }}
      >
        {t("refresh")}
      </button>
    </section>
  );
}
