"use client";
import { useT } from "../lib/i18n/react";
/**
 * Light, dark or the device's setting for subscriber surfaces
 * (docs/features/dark-mode.md). The choice lives with the member's other
 * preferences (per coach), is mirrored into a cookie so the next server
 * render and first paint use it, and is held here for this tab so every
 * mounted surface changes at once. The styles are app/appearance.css.
 */
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CirclePause, Monitor, Moon, Sun } from "lucide-react";
import { brandDarkPalette, resolveBrandDesign } from "@trainer/contracts";
import {
  DEFAULT_COLOR_SCHEME,
  DEFAULT_MOTION_CHOICE,
  colorSchemeCookie,
  colorSchemeFromCookieHeader,
  motionCookie,
  motionFromCookieHeader,
  parseColorScheme,
  themeColorsFor,
  type ColorSchemeChoice,
  type MotionChoice,
} from "../color-scheme";
import { REDUCE_MOTION_ATTRIBUTE, withViewTransition } from "./motion";

let current: ColorSchemeChoice | null = null;
const listeners = new Set<() => void>();
function read(): ColorSchemeChoice {
  current ??=
    colorSchemeFromCookieHeader(document.cookie) ?? DEFAULT_COLOR_SCHEME;
  return current;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** Applies a choice to every mounted surface and mirrors it on this device. */
export function rememberColorScheme(choice: ColorSchemeChoice) {
  document.cookie = colorSchemeCookie(choice, location.protocol === "https:");
  if (choice === current) return;
  current = choice;
  for (const listener of listeners) listener();
}
/**
 * The member's choice on this device. `serverValue` is what the server
 * rendered with (the same cookie), so hydration matches.
 */
export function useColorScheme(
  serverValue: ColorSchemeChoice = DEFAULT_COLOR_SCHEME,
) {
  return useSyncExternalStore(subscribe, read, () => serverValue);
}

/**
 * The member's "Reduce motion" choice on this device (docs/features/motion.md).
 * "reduce" sets data-reduce-motion="on" on <html>, which app/motion.css and
 * prefersReducedMotion() treat like the device setting.
 */
let motionChoice: MotionChoice | null = null;
const motionListeners = new Set<() => void>();
function readMotion(): MotionChoice {
  motionChoice ??=
    motionFromCookieHeader(document.cookie) ?? DEFAULT_MOTION_CHOICE;
  return motionChoice;
}
function subscribeMotion(listener: () => void) {
  motionListeners.add(listener);
  return () => motionListeners.delete(listener);
}
/** Applies the motion choice to the page at once and mirrors it on this device. */
export function rememberMotionChoice(choice: MotionChoice) {
  document.cookie = motionCookie(choice, location.protocol === "https:");
  const root = document.documentElement;
  if (choice === "reduce") root.setAttribute(REDUCE_MOTION_ATTRIBUTE, "on");
  else root.removeAttribute(REDUCE_MOTION_ATTRIBUTE);
  if (choice === motionChoice) return;
  motionChoice = choice;
  for (const listener of motionListeners) listener();
}
export function useMotionChoice() {
  return useSyncExternalStore(
    subscribeMotion,
    readMotion,
    () => DEFAULT_MOTION_CHOICE,
  );
}

type Preferences = { data: Record<string, unknown>; version: number };
const pending = new Map<string, Promise<Preferences | null>>();
/**
 * The signed-in member's saved preferences. Surfaces that mount together
 * (language and appearance) share one request.
 */
export function memberPreferences(member: string) {
  let request = pending.get(member);
  if (!request) {
    request = fetch("/api/v1/notifications/preferences", {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? (r.json() as Promise<Preferences>) : null))
      .catch(() => null)
      .finally(() => pending.delete(member));
    pending.set(member, request);
  }
  return request;
}

type Undo = () => void;
/**
 * Points the page's theme-color metas at `entries` (one per device scheme,
 * or one for both), in place: the root layout's copies change and extra
 * copies are added only when needed. Undo restores what it changed.
 */
function applyThemeColors(
  entries: Array<{ media?: string; color: string }>,
): Undo {
  const metas = [
    ...document.head.querySelectorAll<HTMLMetaElement>(
      'meta[name="theme-color"]',
    ),
  ];
  const saved = metas.map((meta) => ({
    meta,
    content: meta.getAttribute("content"),
    media: meta.getAttribute("media"),
  }));
  const created: HTMLMetaElement[] = [];
  while (metas.length < entries.length) {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    metas.push(meta);
    created.push(meta);
  }
  const set = metas.map((meta, i) => {
    const entry = entries[Math.min(i, entries.length - 1)];
    meta.setAttribute("content", entry.color);
    if (entry.media) meta.setAttribute("media", entry.media);
    else meta.removeAttribute("media");
    return entry.color;
  });
  return () => {
    for (const meta of created) meta.remove();
    saved.forEach(({ meta, content, media }, i) => {
      // Another screen may have replaced it since; leave that change alone.
      if (meta.getAttribute("content") !== set[i]) return;
      if (content === null) meta.removeAttribute("content");
      else meta.setAttribute("content", content);
      if (media === null) meta.removeAttribute("media");
      else meta.setAttribute("media", media);
    });
  };
}
/**
 * The browser and status bar colour of a coach-branded subscriber surface:
 * the coach's primary colour in light (as in the install manifests) and the
 * dark top bar colour in dark, following the member's choice.
 */
export function useSubscriberThemeColor(
  theme: unknown,
  choice: ColorSchemeChoice,
  enabled = true,
) {
  const light = resolveBrandDesign(theme).primary,
    dark = brandDarkPalette(theme).themeColor;
  useEffect(() => {
    if (!enabled) return;
    return applyThemeColors(themeColorsFor(choice, { light, dark }));
  }, [enabled, choice, light, dark]);
}

/**
 * The member app's appearance: applies the member's saved choice (which may
 * differ from this device's mirror, for example after choosing Dark on
 * another phone) and keeps the browser colour in step.
 */
export function MemberAppearance({
  member,
  theme,
  choice,
}: {
  /** `<tenantId>:<userId>` */
  member: string;
  theme: unknown;
  choice: ColorSchemeChoice;
}) {
  useEffect(() => {
    let active = true;
    void memberPreferences(member).then((saved) => {
      const next = parseColorScheme(saved?.data?.theme);
      if (active && next) rememberColorScheme(next);
    });
    return () => {
      active = false;
    };
  }, [member]);
  useSubscriberThemeColor(theme, choice);
  return null;
}

/** Tells other preference forms on the page about a newer saved version. */
export const PREFERENCES_SAVED_EVENT = "member-preferences-saved";

const OPTIONS: Array<{
  value: ColorSchemeChoice;
  label: "matchDevice" | "light" | "dark";
  detail: "matchDeviceDetail" | "lightDetail" | "darkDetail";
  icon: ReactNode;
}> = [
  {
    value: "system",
    label: "matchDevice",
    detail: "matchDeviceDetail",
    icon: <Monitor size={20} aria-hidden="true" />,
  },
  {
    value: "light",
    label: "light",
    detail: "lightDetail",
    icon: <Sun size={20} aria-hidden="true" />,
  },
  {
    value: "dark",
    label: "dark",
    detail: "darkDetail",
    icon: <Moon size={20} aria-hidden="true" />,
  },
];

/**
 * Profile and settings > Display preferences. A choice applies at once and
 * is saved for this coach; if saving fails the previous choice comes back.
 */
export function DisplayPreferences() {
  const choice = useColorScheme();
  const t = useT("prefs");
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState<{
      text: string;
      tone: "success" | "error";
    } | null>(null),
    // The radio answers the tap at once; the colours follow a frame later
    // inside the crossfade.
    [picked, setPicked] = useState<ColorSchemeChoice | null>(null);
  useEffect(() => setPicked(null), [choice]);
  async function choose(next: ColorSchemeChoice) {
    if (next === choice || busy) return;
    setPicked(next);
    const previous = choice;
    // Colours crossfade over --motion-base, only for this change the member
    // made (app/motion.css "Theme"); instant with reduced motion.
    withViewTransition("theme", () => rememberColorScheme(next));
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/v1/preferences/appearance", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next }),
      });
      if (!response.ok) throw new Error("not saved");
      const saved = (await response.json()) as Preferences;
      window.dispatchEvent(
        new CustomEvent(PREFERENCES_SAVED_EVENT, { detail: saved }),
      );
      setStatus({ text: t("displaySaved"), tone: "success" });
    } catch {
      setPicked(null);
      rememberColorScheme(previous);
      setStatus({ text: t("displayFailed"), tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card display-preferences" id="display">
      <h2>{t("display")}</h2>
      <p className="muted">{t("displayText")}</p>
      <fieldset className="appearance-choice" aria-busy={busy}>
        <legend>{t("appearance")}</legend>
        {OPTIONS.map((option) => (
          <label className="appearance-option" key={option.value}>
            <input
              type="radio"
              name="appearance"
              value={option.value}
              checked={(picked ?? choice) === option.value}
              onChange={() => void choose(option.value)}
            />
            <span className="appearance-option-icon">{option.icon}</span>
            <span className="appearance-option-text">
              <strong>{t(option.label)}</strong>
              <small>{t(option.detail)}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {status && (
        <p
          className={`notice ${status.tone === "error" ? "error" : "success"}`}
          role={status.tone === "error" ? "alert" : "status"}
        >
          {status.text}
        </p>
      )}
      <MotionPreference />
    </section>
  );
}

const MOTION_OPTIONS: Array<{
  value: MotionChoice;
  label: "motionSystem" | "motionReduce";
  detail: "motionSystemDetail" | "motionReduceDetail";
  icon: ReactNode;
}> = [
  {
    value: "system",
    label: "motionSystem",
    detail: "motionSystemDetail",
    icon: <Monitor size={20} aria-hidden="true" />,
  },
  {
    value: "reduce",
    label: "motionReduce",
    detail: "motionReduceDetail",
    icon: <CirclePause size={20} aria-hidden="true" />,
  },
];

/**
 * Display preferences > Motion: follow the device, or keep every screen
 * still on this device. Applies at once; saved on this device.
 */
export function MotionPreference() {
  const choice = useMotionChoice();
  const t = useT("prefs");
  const [saved, setSaved] = useState(false);
  return (
    <>
      <fieldset className="appearance-choice motion-choice">
        <legend>{t("motion")}</legend>
        {MOTION_OPTIONS.map((option) => (
          <label className="appearance-option" key={option.value}>
            <input
              type="radio"
              name="motion"
              value={option.value}
              checked={choice === option.value}
              onChange={() => {
                rememberMotionChoice(option.value);
                setSaved(true);
              }}
            />
            <span className="appearance-option-icon">{option.icon}</span>
            <span className="appearance-option-text">
              <strong>{t(option.label)}</strong>
              <small>{t(option.detail)}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {saved && (
        <p className="notice success" role="status">
          {t("motionSaved")}
        </p>
      )}
    </>
  );
}
