"use client";
/**
 * The installable member app's screens and prompts (docs/features/pwa.md):
 * the offline screen, the "New version ready" toast, "Install the app" (a
 * row in More and Profile, a one-time card on Today, a bottom sheet with the
 * steps for this phone) and the notifications prompt after a meaningful
 * moment. The rules they follow are pure functions in pwa.ts.
 */
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Bell,
  ChevronRight,
  CloudOff,
  Copy,
  Ellipsis,
  RefreshCw,
  Share,
  SquarePlus,
  Smartphone,
  X,
} from "lucide-react";
import { BottomSheet } from "./phone-ui";
import { MOTION, firstView, prefersReducedMotion } from "./motion";
import {
  OFFLINE_STATE_KEY,
  SW_MESSAGES,
  consentAnswered,
  hasUnsavedInput,
  inAppBrowser,
  installKeys,
  installPromptAvailable,
  installRoute,
  isStandalone,
  lastSyncedText,
  offlineSavedAt,
  onInstallPromptChange,
  openInstallPrompt,
  registerServiceWorker,
  showInstallCard,
  showUpdateToast,
  type InstallRoute,
} from "./pwa";
import { pushReadiness, turnOnPush, type PushReadiness } from "./push-notifications";
import { Rich, useLocale, useT } from "../lib/i18n/react";
import {
  LANGUAGE_COOKIE,
  MEMBER_LANGUAGE_COOKIE,
  languageFromCookieHeader,
} from "../document-language";
import { applyDocumentLanguage } from "./document-direction";

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

// ------------------------------------------------------------------
// Offline
// ------------------------------------------------------------------

/**
 * "You're offline": distinct from the server-error screen. Says when this
 * phone last had the member's data and what still works without a
 * connection. Used by the workspace (no connection and nothing saved) and
 * by /app/offline, the page the service worker falls back to.
 */
export function OfflineScreen({
  onRetry,
  savedAt,
}: {
  onRetry: () => void;
  savedAt: number | null;
}) {
  const locale = useLocale(),
    t = useT("pwa"),
    common = useT("common");
  const synced = lastSyncedText(savedAt, Date.now(), locale);
  return (
    <main className="loading-screen offline-screen">
      <section className="card offline-card" aria-labelledby="offline-title">
        <CloudOff size={28} aria-hidden="true" />
        <h1 id="offline-title">{t("offlineTitle")}</h1>
        <p className="muted">
          {synced ?? t("notSavedYet")} {t("connectThenRetry")}
        </p>
        <h2>{t("whatStillWorks")}</h2>
        <ul>
          <li>{t("worksWorkout")}</li>
          <li>{t("worksMeals")}</li>
        </ul>
        <button className="button" type="button" onClick={onRetry}>
          {common("tryAgain")} <RefreshCw size={15} aria-hidden="true" />
        </button>
      </section>
    </main>
  );
}
/** /app/offline: shown by the service worker when a page cannot load. */
export function OfflinePage() {
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    setSavedAt(offlineSavedAt(read(OFFLINE_STATE_KEY)));
    // Precached for everyone, so rendered in English: switch to the
    // member's language from this device's cookies (member app order).
    const language =
      languageFromCookieHeader(document.cookie, MEMBER_LANGUAGE_COOKIE) ??
      languageFromCookieHeader(document.cookie, LANGUAGE_COOKIE);
    if (language) applyDocumentLanguage(language);
  }, []);
  return (
    <OfflineScreen
      savedAt={savedAt}
      onRetry={() =>
        // The fallback keeps the address that failed; offline itself goes home.
        location.pathname === "/app/offline"
          ? location.assign("/app")
          : location.reload()
      }
    />
  );
}

// ------------------------------------------------------------------
// Service worker and updates
// ------------------------------------------------------------------

let reloadRequested = false;
/**
 * Registers this release's service worker and watches for the next one.
 * Members see "New version ready" and choose when to reload; everyone else
 * (the trainer workspace, sign-in pages) keeps the earlier behaviour: the
 * new worker takes over at once and pages reload only by navigation.
 */
export function useAppServiceWorker(member: boolean) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    const offer = (worker: ServiceWorker | null | undefined) => {
      if (!worker || !navigator.serviceWorker.controller || !active) return;
      if (member) setWaiting(worker);
      else worker.postMessage({ type: SW_MESSAGES.skipWaiting });
    };
    const onFound = () => {
      const worker = registration?.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed") offer(worker);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible")
        void registration?.update().catch(() => {});
    };
    const onControllerChange = () => {
      // Only the tab where the member tapped Reload reloads.
      if (reloadRequested) location.reload();
    };
    void registerServiceWorker().then((r) => {
      if (!r || !active) return;
      registration = r;
      offer(r.waiting);
      r.addEventListener("updatefound", onFound);
    });
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      registration?.removeEventListener("updatefound", onFound);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [member]);
  const reload = useCallback(() => {
    if (!waiting) return;
    reloadRequested = true;
    waiting.postMessage({ type: SW_MESSAGES.skipWaiting });
    // Already active (another tab chose Reload first): reload now.
    if (waiting.state === "activated") location.reload();
  }, [waiting]);
  return { waiting: !!waiting, reload };
}

/**
 * "New version ready — Reload": small, above the tab bar and any action
 * bar, never while a session runs (the workout, guided or voice screens),
 * and never reloading over something typed and not saved.
 */
export function AppUpdateToast({
  path,
  waiting,
  onReload,
}: {
  path: string;
  waiting: boolean;
  onReload: () => void;
}) {
  const [later, setLater] = useState(false),
    [leaving, setLeaving] = useState(false),
    [blocked, setBlocked] = useState(false);
  const t = useT("pwa");
  useEffect(() => {
    if (!leaving) return;
    const gone = window.setTimeout(() => setLater(true), MOTION.fast + 40);
    return () => window.clearTimeout(gone);
  }, [leaving]);
  if (later || !showUpdateToast({ waiting, path })) return null;
  return (
    <div
      className={"app-update-toast" + (leaving ? " is-leaving" : "")}
      role="status"
      data-fixed-ui
      inert={leaving || undefined}
    >
      <p>
        <strong>{t("newVersion")}</strong>
        {blocked && <span>{t("saveFirst")}</span>}
      </p>
      <button
        type="button"
        className="button"
        onClick={() => {
          if (hasUnsavedInput(document)) return setBlocked(true);
          onReload();
        }}
      >
        {t("reload")}
      </button>
      <button
        type="button"
        className="icon-button app-update-later"
        aria-label={t("later")}
        onClick={() =>
          prefersReducedMotion() ? setLater(true) : setLeaving(true)
        }
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------
// Install
// ------------------------------------------------------------------

function subscribeStandalone(callback: () => void) {
  const query = window.matchMedia?.("(display-mode: standalone)");
  query?.addEventListener?.("change", callback);
  const stop = onInstallPromptChange(callback);
  return () => {
    query?.removeEventListener?.("change", callback);
    stop();
  };
}
/** How this browser installs the app; null during server render. */
export function useInstallRoute(): InstallRoute | null {
  return useSyncExternalStore(
    subscribeStandalone,
    () =>
      installRoute({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
        standalone: isStandalone(),
        promptAvailable: installPromptAvailable(),
      }),
    () => null,
  );
}

async function copyLink(): Promise<boolean> {
  const link = location.origin + "/app";
  try {
    await navigator.clipboard.writeText(link);
    return true;
  } catch {
    return false;
  }
}

function Step({
  n,
  picture,
  children,
}: {
  n: number;
  picture: ReactNode;
  children: ReactNode;
}) {
  const t = useT("pwa");
  return (
    <li className="install-step">
      <span className="install-step-picture" aria-hidden="true">
        {picture}
      </span>
      <span className="install-step-text">
        <span className="install-step-number">{t("step", { n })}</span>
        <span>{children}</span>
      </span>
    </li>
  );
}

/**
 * The steps for this phone, in a bottom sheet: iPhone Safari (Share, Add to
 * Home Screen, Add), another iPhone browser or a social app's browser (open
 * in Safari or Chrome, with Copy link), the browser menu elsewhere, and the
 * notifications offer once the app is installed.
 */
export function InstallSheet({
  open,
  onClose,
  coachName,
  route,
  installed,
}: {
  open: boolean;
  onClose: () => void;
  coachName: string;
  route: InstallRoute | null;
  /** The member just accepted the browser's own install prompt. */
  installed?: boolean;
}) {
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  const t = useT("pwa"),
    common = useT("common");
  const b = { b: (text: ReactNode) => <strong>{text}</strong> };
  useEffect(() => {
    if (!open) setCopied("");
  }, [open]);
  const app =
    typeof navigator === "undefined" ? null : inAppBrowser(navigator.userAgent);
  const copy = (
    <button
      type="button"
      className="button"
      onClick={async () => setCopied((await copyLink()) ? "yes" : "no")}
    >
      <Copy size={16} aria-hidden="true" />
      {copied === "yes" ? t("linkCopied") : t("copyLink")}
    </button>
  );
  const coach = { coach: coachName };
  let title = t("addToHomeTitle", coach),
    body: ReactNode,
    footer: ReactNode = (
      <button type="button" className="button" onClick={onClose}>
        {common("done")}
      </button>
    );
  if (installed || route === "installed") {
    title = t("onHomeTitle", coach);
    body = (
      <>
        <p>{t("openFromHome")}</p>
        <PushPrompt coachName={coachName} />
      </>
    );
  } else if (route === "ios") {
    body = (
      <>
        <ol className="install-steps">
          <Step n={1} picture={<Share size={22} />}>
            <Rich t={t} k="iosShare" tags={b} />
          </Step>
          <Step n={2} picture={<SquarePlus size={22} />}>
            <Rich t={t} k="iosAdd" tags={b} />
          </Step>
          <Step
            n={3}
            picture={<span className="install-step-add">{t("iosAddWord")}</span>}
          >
            <Rich t={t} k="iosConfirm" tags={b} params={coach} />
          </Step>
        </ol>
        <p className="muted">{t("iosNotifications", coach)}</p>
      </>
    );
  } else if (route === "ios-other" || route === "in-app") {
    title = route === "ios-other" ? t("openInSafari") : t("openInBrowser");
    body = (
      <>
        <p>
          {route === "in-app"
            ? t("inAppCannot", { app: app ?? t("thisApp"), coach: coachName })
            : t("iosOtherBrowser", coach)}
        </p>
        {route === "in-app" && (
          <p className="muted">
            <Rich
              t={t}
              k="inAppMenu"
              tags={{
                menu: () => <Ellipsis size={16} aria-label={t("theMenu")} />,
              }}
            />
          </p>
        )}
        {copied === "no" && (
          <p className="notice" role="status">
            {t("copyFailed", { link: `${location.origin}/app` })}
          </p>
        )}
      </>
    );
    footer = copy;
  } else {
    body = (
      <ol className="install-steps">
        <Step n={1} picture={<Ellipsis size={22} />}>
          {t("menuOpen")}
        </Step>
        <Step n={2} picture={<Smartphone size={22} />}>
          <Rich t={t} k="menuInstall" tags={b} />
        </Step>
      </ol>
    );
  }
  return (
    <BottomSheet open={open} onClose={onClose} title={title} footer={footer}>
      {body}
    </BottomSheet>
  );
}

/**
 * Starts installing from the member's own tap: the browser's prompt where
 * Chromium kept one, otherwise the steps for this phone.
 */
function useInstallAction() {
  const route = useInstallRoute();
  const [sheet, setSheet] = useState<"" | "steps" | "installed">("");
  const start = async () => {
    if (route === "prompt") {
      const outcome = await openInstallPrompt();
      if (outcome === "accepted") return setSheet("installed");
      if (outcome === "dismissed") return;
    }
    setSheet("steps");
  };
  return { route, sheet, setSheet, start };
}

/** "Install the app" in More and Profile; hidden in the installed app. */
export function InstallAppRow({
  coachName,
  variant = "more",
}: {
  coachName: string;
  variant?: "more" | "card";
}) {
  const { route, sheet, setSheet, start } = useInstallAction();
  const t = useT("pwa");
  if (!route || route === "installed") return null;
  const sheetView = (
    <InstallSheet
      open={!!sheet}
      onClose={() => setSheet("")}
      coachName={coachName}
      route={route}
      installed={sheet === "installed"}
    />
  );
  if (variant === "card")
    return (
      <section className="card install-app-card" aria-labelledby="install-h">
        <h2 id="install-h">{t("installApp")}</h2>
        <p className="muted">{t("installCardText", { coach: coachName })}</p>
        <button
          type="button"
          className="button secondary"
          onClick={() => void start()}
        >
          <Smartphone size={16} aria-hidden="true" />
          {t("installApp")}
        </button>
        {sheetView}
      </section>
    );
  return (
    <section className="more-group">
      <ul className="more-list">
        <li>
          <button
            type="button"
            className="more-link"
            onClick={() => void start()}
          >
            <span className="more-icon">
              <Smartphone size={20} aria-hidden="true" />
            </span>
            <span className="more-text">
              <strong>{t("installApp")}</strong>
              <small>{t("installRowDetail", { coach: coachName })}</small>
            </span>
            <ChevronRight
              className="more-chevron"
              size={18}
              aria-hidden="true"
            />
          </button>
        </li>
      </ul>
      {sheetView}
    </section>
  );
}

/** Counts one visit per browser tab session for this member. */
function useVisits(tenantId: string, userId: string) {
  const [visits, setVisits] = useState(0);
  useEffect(() => {
    const keys = installKeys(tenantId, userId);
    let count = Number(read(keys.visits)) || 0;
    try {
      const seen = `member-app:visit-counted:${tenantId}:${userId}`;
      if (!sessionStorage.getItem(seen)) {
        sessionStorage.setItem(seen, "1");
        count += 1;
        write(keys.visits, String(count));
      }
    } catch {}
    setVisits(count);
  }, [tenantId, userId]);
  return visits;
}
/** Whether the analytics question has been answered on this device. */
function useConsentAnswered() {
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () => {
      const stored = read("analytics-preference");
      if (consentAnswered(stored, undefined)) return setAnswered(true);
      void fetch("/api/v1/public/acquisition/consent", {
        credentials: "same-origin",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((value) => {
          if (live) setAnswered(consentAnswered(stored, value?.granted));
        })
        .catch(() => {});
    };
    check();
    window.addEventListener("analytics-preference-change", check);
    window.addEventListener("storage", check);
    return () => {
      live = false;
      window.removeEventListener("analytics-preference-change", check);
      window.removeEventListener("storage", check);
    };
  }, []);
  return answered;
}

/**
 * The one-time install card on Today, inline (never over content): after
 * the member has used the app (a second visit or a logged session), after
 * the analytics choice, never in the installed app and never again once
 * dismissed (remembered per member on this device).
 */
export function InstallCard({
  coachName,
  tenantId,
  userId,
  loggedSession,
}: {
  coachName: string;
  tenantId: string;
  userId: string;
  loggedSession: boolean;
}) {
  const { route, sheet, setSheet, start } = useInstallAction();
  const t = useT("pwa"),
    common = useT("common");
  const visits = useVisits(tenantId, userId),
    consent = useConsentAnswered();
  const keys = installKeys(tenantId, userId);
  const [dismissed, setDismissed] = useState(true),
    // "Not now": the card sinks away, then leaves the page.
    [leaving, setLeaving] = useState(false),
    // It rises in only the first time it shows in this tab.
    [arriving, setArriving] = useState(false);
  useEffect(() => setDismissed(!!read(keys.dismissed)), [keys.dismissed]);
  useEffect(() => {
    if (!leaving) return;
    const gone = window.setTimeout(() => setDismissed(true), MOTION.base + 40);
    return () => window.clearTimeout(gone);
  }, [leaving]);
  const dismiss = () => {
    write(keys.dismissed, new Date().toISOString());
    if (prefersReducedMotion()) setDismissed(true);
    else setLeaving(true);
  };
  const visible =
    !!route &&
    showInstallCard({
      installed: route === "installed",
      dismissed,
      consentAnswered: consent,
      visits,
      loggedSession,
    });
  useEffect(() => {
    if (visible && firstView("install-card")) setArriving(true);
  }, [visible]);
  return (
    <>
      {visible && (
        <section
          className={
            "card install-card" +
            (arriving ? " is-new" : "") +
            (leaving ? " is-leaving" : "")
          }
          aria-labelledby="install-card-title"
          inert={leaving || undefined}
        >
          <span className="install-card-icon" aria-hidden="true">
            <Smartphone size={22} />
          </span>
          <div className="install-card-text">
            <h2 id="install-card-title">
              {t("addToHomeTitle", { coach: coachName })}
            </h2>
            <p className="muted">{t("installTodayText")}</p>
          </div>
          <div className="install-card-actions">
            <button
              type="button"
              className="text-button"
              onClick={dismiss}
            >
              {common("notNow")}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => void start()}
            >
              {t("installApp")}
            </button>
          </div>
        </section>
      )}
      <InstallSheet
        open={!!sheet}
        onClose={() => {
          // Once the sheet was opened from the card, the card has done its job.
          setSheet("");
          dismiss();
        }}
        coachName={coachName}
        route={route}
        installed={sheet === "installed"}
      />
    </>
  );
}

// ------------------------------------------------------------------
// Notifications after a meaningful moment
// ------------------------------------------------------------------

/**
 * Offers notifications after a meaningful moment (installing, a coach's
 * reply), never on first load: turn them on here, or on iPhone outside the
 * installed app, why they need it. Nothing when push is unavailable, off in
 * this app, already on or already answered here.
 */
export function PushPrompt({
  coachName,
  askedKey,
}: {
  coachName: string;
  /** Remembers a "Not now" per member (installKeys().pushAsked). */
  askedKey?: string;
}) {
  const [ready, setReady] = useState<PushReadiness | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [hidden, setHidden] = useState(false);
  const t = useT("pwa"),
    common = useT("common"),
    push = useT("push");
  useEffect(() => {
    if (askedKey && read(askedKey)) {
      setHidden(true);
      return;
    }
    let live = true;
    void pushReadiness().then((value) => live && setReady(value));
    return () => {
      live = false;
    };
  }, [askedKey]);
  if (hidden || !ready || ready.kind === "unavailable" || ready.kind === "enabled")
    return message ? (
      <p className="notice" role="status">
        {push(message as never)}
      </p>
    ) : null;
  const notNow = () => {
    if (askedKey) write(askedKey, new Date().toISOString());
    setHidden(true);
  };
  return (
    <section className="push-prompt" aria-labelledby="push-prompt-title">
      <Bell size={20} aria-hidden="true" />
      <div>
        <h3 id="push-prompt-title">{t("pushTitle", { coach: coachName })}</h3>
        {ready.kind === "ios-install" ? (
          <p className="muted">{t("pushIos")}</p>
        ) : (
          <p className="muted">{t("pushShort")}</p>
        )}
        {message && (
          <p className="notice" role="status">
            {push(message as never)}
          </p>
        )}
        <div className="push-prompt-actions">
          <button type="button" className="text-button" onClick={notNow}>
            {common("notNow")}
          </button>
          {ready.kind === "ready" && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await turnOnPush(ready.publicKey);
                setBusy(false);
                if (askedKey) write(askedKey, new Date().toISOString());
                setMessage(result.message);
                if (result.ok) setReady({ kind: "enabled" });
              }}
            >
              {t("turnOnNotifications")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
