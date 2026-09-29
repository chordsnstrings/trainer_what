/**
 * The installable member app (docs/features/pwa.md): the service worker's
 * release and cache names, clearing personal caches, install detection and
 * the rules for when the install card, the update toast and the push prompt
 * may appear. Pure functions are tested in tests/pwa.test.ts; the browser
 * helpers guard every API they use, so they are safe during server render.
 */

/** The build's release (next.config.ts), which versions the service worker. */
export const APP_RELEASE = process.env.NEXT_PUBLIC_APP_RELEASE || "dev";

/** Cache names; the service worker (public/sw.js) builds the same ones. */
export function cacheNames(release: string = APP_RELEASE) {
  return {
    /** Build assets and the offline page: no personal data. */
    shell: `trainer-shell-${release}`,
    /** Member app pages opened on this device: cleared on sign-out. */
    pages: `trainer-pages-${release}`,
  };
}
/** The service worker's address for a release. */
export function serviceWorkerUrl(release: string = APP_RELEASE) {
  return `/sw.js?v=${encodeURIComponent(release)}`;
}
/**
 * Caches that may hold pages of a signed-in person: every release's page
 * cache, and the workout cache of earlier releases (it kept workout pages).
 */
export function isPersonalCache(name: string) {
  return (
    name.startsWith("trainer-pages-") ||
    name.startsWith("trainer-workout-shell-")
  );
}

/** Messages the page sends to the service worker. */
export const SW_MESSAGES = {
  skipWaiting: "SKIP_WAITING",
  clearPersonal: "CLEAR_PERSONAL",
} as const;

let registration: Promise<ServiceWorkerRegistration | undefined> | null =
  null;
/**
 * Registers this release's service worker once per page. Every caller (the
 * workspace, push setup) shares it, so the script address never flips
 * between two values.
 */
export function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return Promise.resolve(undefined);
  registration ??= navigator.serviceWorker
    .register(serviceWorkerUrl(), { scope: "/", updateViaCache: "none" })
    .catch(() => undefined);
  return registration;
}

/**
 * Removes every cached page of the person who is leaving (sign-out, a coach
 * switch, leaving a coach, an ended session), so a shared phone never shows
 * the previous person's app offline. Build assets and the offline page stay.
 * Also tells the service worker, in case another tab re-adds a page.
 */
export async function clearPersonalCaches() {
  try {
    localStorage.removeItem(LAUNCH_COLOUR_KEY);
  } catch {}
  try {
    navigator.serviceWorker?.controller?.postMessage({
      type: SW_MESSAGES.clearPersonal,
    });
  } catch {}
  if (typeof caches === "undefined") return;
  try {
    const names = await caches.keys();
    await Promise.all(
      names.filter(isPersonalCache).map((name) => caches.delete(name)),
    );
  } catch {}
}

/**
 * The coach's surface colour, remembered so the installed app's first paint
 * matches its launch screen (the inline script in app/layout.tsx). A brand
 * colour, not personal data; removed with the personal caches.
 */
export const LAUNCH_COLOUR_KEY = "member-app:launch";
export function rememberLaunchColour(colour: string) {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return;
  try {
    localStorage.setItem(LAUNCH_COLOUR_KEY, colour);
  } catch {}
}
/** Runs before the first paint (app/layout.tsx); keep it tiny and safe. */
export const LAUNCH_COLOUR_SCRIPT = `try{if(/^\\/app(\\/|$)/.test(location.pathname)){var c=localStorage.getItem(${JSON.stringify(LAUNCH_COLOUR_KEY)});if(c&&/^#[0-9a-f]{6}$/i.test(c)){var r=document.documentElement;r.style.setProperty("--member-launch",c);r.setAttribute("data-launch","member")}}}catch(e){}`;

// ------------------------------------------------------------------
// Install detection
// ------------------------------------------------------------------

/** Webviews inside social apps, which cannot install a web app. */
const IN_APP_BROWSERS: Array<[RegExp, string]> = [
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, "Facebook"],
  [/WhatsApp/i, "WhatsApp"],
  [/musical_ly|BytedanceWebview|TikTok|trill_/i, "TikTok"],
  [/Snapchat/i, "Snapchat"],
  [/LinkedInApp/i, "LinkedIn"],
  [/\bLine\//i, "LINE"],
  [/Twitter|TwitterAndroid/i, "X"],
];
/** The social app whose built-in browser this is, or null. */
export function inAppBrowser(userAgent: string): string | null {
  return IN_APP_BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
}
export function isIos(
  userAgent: string,
  platform = "",
  maxTouchPoints = 0,
): boolean {
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    // iPadOS reports itself as a Mac with touch.
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}
export type InstallRoute =
  /** Already opened from the home screen. */
  | "installed"
  /** Chromium kept the install prompt: our button opens it. */
  | "prompt"
  /** iPhone or iPad Safari: Share, Add to Home Screen, Add. */
  | "ios"
  /** iPhone or iPad in another browser: open this page in Safari. */
  | "ios-other"
  /** A social app's browser: open this page in Safari or Chrome. */
  | "in-app"
  /** Android or desktop without a kept prompt: the browser menu. */
  | "menu";
export function installRoute(input: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone: boolean;
  promptAvailable: boolean;
}): InstallRoute {
  if (input.standalone) return "installed";
  if (inAppBrowser(input.userAgent)) return "in-app";
  if (input.promptAvailable) return "prompt";
  if (isIos(input.userAgent, input.platform, input.maxTouchPoints))
    // Safari, and since iOS 16.4 other iOS browsers, can add to the home
    // screen from Share; Safari is the dependable one to explain.
    return /CriOS|FxiOS|EdgiOS|OPiOS/.test(input.userAgent) ? "ios-other" : "ios";
  return "menu";
}
/** True when the page runs as the installed app. */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
let deferredPrompt: InstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();
const notifyPrompt = () => promptListeners.forEach((listener) => listener());
/**
 * Keeps Chromium's install prompt instead of its mini-infobar, from the
 * moment this module loads, so the member's own tap on "Install the app"
 * opens it later.
 */
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    notifyPrompt();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyPrompt();
  });
}
export function installPromptAvailable() {
  return deferredPrompt !== null;
}
export function onInstallPromptChange(listener: () => void) {
  promptListeners.add(listener);
  return () => void promptListeners.delete(listener);
}
/** Opens the kept prompt; the browser allows it once. */
export async function openInstallPrompt(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const event = deferredPrompt;
  if (!event) return "unavailable";
  deferredPrompt = null;
  notifyPrompt();
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return "unavailable";
  }
}

// ------------------------------------------------------------------
// When install, update and push prompts may appear
// ------------------------------------------------------------------

/** Per member on this device; ids only, never names or content. */
export function installKeys(tenantId: string, userId: string) {
  const scope = `${tenantId}:${userId}`;
  return {
    dismissed: `member-app:install-dismissed:${scope}`,
    visits: `member-app:visits:${scope}`,
    pushAsked: `member-app:push-asked:${scope}`,
  };
}
/**
 * The one-time install card on Today: only after the member has used the
 * app (a second visit or a logged session), never before the analytics
 * choice, never once installed or dismissed.
 */
export function showInstallCard(input: {
  installed: boolean;
  dismissed: boolean;
  consentAnswered: boolean;
  visits: number;
  loggedSession: boolean;
}) {
  return (
    !input.installed &&
    !input.dismissed &&
    input.consentAnswered &&
    (input.visits >= 2 || input.loggedSession)
  );
}
/**
 * The analytics question is answered when the browser kept an answer or the
 * saved consent is on. Both consent components store their answer under
 * "analytics-preference".
 */
export function consentAnswered(
  stored: string | null,
  granted: boolean | undefined,
) {
  return (
    granted === true ||
    (stored !== null && ["allowed", "declined", "dismissed"].includes(stored))
  );
}
/** Screens where the app never reloads itself or offers to: a session is running. */
export function isSessionScreen(path: string) {
  return (
    path.startsWith("/app/workouts/") ||
    path.startsWith("/app/guided/") ||
    path.startsWith("/app/voice-session/")
  );
}
/** Any form field changed and not saved: a reload would lose it. */
export function hasUnsavedInput(root: ParentNode) {
  for (const field of root.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select")) {
    if (field.closest("[data-ignore-unsaved]")) continue;
    if (field instanceof HTMLSelectElement) {
      if (
        [...field.options].some((o) => o.selected !== o.defaultSelected)
      )
        return true;
    } else if (
      field instanceof HTMLInputElement &&
      ["checkbox", "radio"].includes(field.type)
    ) {
      if (field.checked !== field.defaultChecked) return true;
    } else if (
      !(field instanceof HTMLInputElement && ["file", "hidden", "search"].includes(field.type)) &&
      field.value !== field.defaultValue
    )
      return true;
  }
  return false;
}
/** The update toast waits while a session runs; the reload never happens by itself. */
export function showUpdateToast(input: { waiting: boolean; path: string }) {
  return input.waiting && !isSessionScreen(input.path);
}

/** "Saved on this phone — will sync", the label of every queued entry. */
export const QUEUED_LABEL = "Saved on this phone — will sync";
export function queuedSummary(count: number, kind: "set" | "meal") {
  const noun =
    kind === "set"
      ? count === 1
        ? "set log"
        : "set logs"
      : count === 1
        ? "meal"
        : "meals";
  return `${count} ${noun} saved on this phone — will sync`;
}

/** When the member's data last reached this phone, in plain words. */
export function lastSyncedText(savedAt: number | null, now = Date.now()) {
  if (!savedAt || !Number.isFinite(savedAt)) return null;
  const minutes = Math.max(0, Math.round((now - savedAt) / 60000));
  if (minutes < 1) return "Last updated just now.";
  if (minutes < 60)
    return `Last updated ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24)
    return `Last updated ${hours} ${hours === 1 ? "hour" : "hours"} ago.`;
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(savedAt));
  return `Last updated ${date}.`;
}
/** The member state kept for offline use (workspace.tsx) and when it was saved. */
export const OFFLINE_STATE_KEY = "trainer:offline";
export function offlineSavedAt(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return typeof value?.savedAt === "number" ? value.savedAt : null;
  } catch {
    return null;
  }
}

/** Shows the unread coach messages on the installed app's icon, where supported. */
export function setAppBadge(count: number) {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => {});
    else void nav.clearAppBadge?.()?.catch(() => {});
  } catch {}
}
