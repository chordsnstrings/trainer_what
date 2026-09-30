"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Rich, useLocale, useT } from "../lib/i18n/react";
import { translator, type Locale } from "../lib/i18n/core";
import consentMessages from "../lib/i18n/messages/consent";
import { MOTION, prefersReducedMotion } from "./motion";
import { legalHref } from "./pwa";

/**
 * The privacy policy's address: from the member app it carries ?from=app,
 * so the page leads back into the app (an installed app has no browser
 * back button).
 */
function usePrivacyHref() {
  const path = usePathname() ?? "";
  return legalHref("privacy", path === "/app" || path.startsWith("/app/"));
}

type Permission = {
  granted: boolean;
  firstTouch?: { source: string; campaign: string };
  lastTouch?: { source: string; campaign: string };
  expiresAt?: string;
};
function touch() {
  const q = new URLSearchParams(window.location.search);
  // A coach page on the shared address names its workspace, so a coach only
  // ever sees attribution captured on their own pages.
  const site = /^\/(?:coach|join-coach)\/([a-z][a-z0-9-]{2,39})(?:\/|$)/.exec(
    window.location.pathname,
  )?.[1];
  return {
    ...Object.fromEntries(
      [
        ["source", "utm_source"],
        ["medium", "utm_medium"],
        ["campaign", "utm_campaign"],
        ["referral", "ref"],
      ].flatMap(([key, param]) => {
        const value = q.get(param);
        return value && value.length <= 200 ? [[key, value]] : [];
      }),
    ),
    ...(site ? { site } : {}),
  };
}
const publicPage = (path: string, marketing: readonly string[]) =>
  marketing.includes(path) ||
  path === "/signup" ||
  /^\/coach\//.test(path) ||
  /^\/join-coach\//.test(path);
async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/v1/public/" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok)
    throw Object.assign(
      new Error(
        "Your analytics preference could not be saved. Please try again.",
      ),
      { status: response.status, code: "ANALYTICS_SAVE" },
    );
  return response.json();
}

/**
 * The visitor's answer on this site, kept in the browser (a preference, never
 * an identifier): "allowed", "declined" (No thanks, Continue without
 * analytics, or a withdrawal) or "dismissed" (closed without choosing, which
 * leaves analytics off). Any answer ends the first prompt for good on this
 * site; it can be changed only from a footer link on public pages or from
 * Profile > Privacy in the member app.
 */
export type AnalyticsChoice = "allowed" | "declined" | "dismissed";
export type AnalyticsAnswer = "allow" | "decline" | "dismiss";
export const ANALYTICS_CHOICE_KEY = "analytics-preference";
/** Tells every mounted consent control (bar, sheet, setting) of a change. */
export const ANALYTICS_CHOICE_EVENT = "analytics-preference-change";
const CHOICES: readonly string[] = ["allowed", "declined", "dismissed"];
type ChoiceStore = Pick<Storage, "getItem" | "setItem">;
// The answer for this visit when the browser refuses storage, so the prompt
// still stays gone on every page until the tab closes.
let unsavedChoice: AnalyticsChoice | null = null;
function browserStore(): ChoiceStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
export function readAnalyticsChoice(
  store: ChoiceStore | null = browserStore(),
): AnalyticsChoice | null {
  let value: string | null = null;
  try {
    value = store?.getItem(ANALYTICS_CHOICE_KEY) ?? null;
  } catch {
    /* Blocked storage: the answer for this visit, if any. */
  }
  return value && CHOICES.includes(value)
    ? (value as AnalyticsChoice)
    : unsavedChoice;
}
export function saveAnalyticsChoice(
  choice: AnalyticsChoice,
  store: ChoiceStore | null = browserStore(),
) {
  try {
    if (!store) throw new Error("no storage");
    store.setItem(ANALYTICS_CHOICE_KEY, choice);
    unsavedChoice = null;
  } catch {
    unsavedChoice = choice;
  }
}
/** What an answer leaves saved in the browser. */
export function choiceFor(answer: AnalyticsAnswer): AnalyticsChoice {
  return answer === "allow"
    ? "allowed"
    : answer === "decline"
      ? "declined"
      : "dismissed";
}
/** The first prompt shows only before any answer on this site. */
export function asksForAnalytics(
  permission: { granted: boolean } | null,
  choice: AnalyticsChoice | null,
) {
  return !!permission && !permission.granted && choice === null;
}
/**
 * The bar shows while the visitor has not answered and the preferences sheet
 * is closed. On a marketing page it waits for the first scroll, so it never
 * covers the hero's call to action or the relay on the first screen.
 */
export function showsConsentBar(state: {
  permission: { granted: boolean } | null;
  choice: AnalyticsChoice | null;
  marketing: boolean;
  scrolled: boolean;
  sheetOpen: boolean;
}) {
  return (
    asksForAnalytics(state.permission, state.choice) &&
    !state.sheetOpen &&
    (!state.marketing || state.scrolled)
  );
}

/**
 * The saved consent (the server's readback), the browser's answer and one
 * `choose` for every consent control. A choice in one control reaches the
 * others at once (ANALYTICS_CHOICE_EVENT) and other tabs through storage.
 */
export function useAnalyticsConsent() {
  const [permission, setPermission] = useState<Permission | null>(null),
    [choice, setChoice] = useState<AnalyticsChoice | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const load = () => {
      setChoice(readAnalyticsChoice());
      void call("acquisition/consent").then(
        (value: Permission) => {
          if (live.current) setPermission(value);
        },
        () => {
          if (live.current) setPermission((p) => p ?? { granted: false });
        },
      );
    };
    const changed = (event: Event) => {
      setChoice(readAnalyticsChoice());
      const value = (event as CustomEvent<Permission | undefined>).detail;
      if (value) setPermission(value);
    };
    load();
    window.addEventListener("focus", load);
    window.addEventListener("storage", load);
    window.addEventListener(ANALYTICS_CHOICE_EVENT, changed);
    return () => {
      live.current = false;
      window.removeEventListener("focus", load);
      window.removeEventListener("storage", load);
      window.removeEventListener(ANALYTICS_CHOICE_EVENT, changed);
    };
  }, []);
  async function choose(answer: AnalyticsAnswer) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      const granted = !!permission?.granted;
      // Closing never changes a saved consent; it only ends the prompt.
      if (answer === "dismiss" && granted) return true;
      const value: Permission =
        answer === "allow"
          ? await call("acquisition/consent", "POST", {
              granted: true,
              touch: touch(),
            })
          : granted
            ? await call("acquisition/consent", "DELETE")
            : { granted: false };
      saveAnalyticsChoice(choiceFor(answer));
      if (live.current) {
        setChoice(choiceFor(answer));
        setPermission(value);
      }
      // Every other mounted control (bar, sheet, Profile) follows at once.
      window.dispatchEvent(
        new CustomEvent(ANALYTICS_CHOICE_EVENT, { detail: value }),
      );
      return true;
    } catch (e) {
      if (live.current) setError((e as Error).message);
      return false;
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return { permission, choice, busy, error, choose };
}

function ExperimentCopy({ slot }: { slot: string }) {
  const [copy, setCopy] = useState<any>(null),
    view = useRef<HTMLElement>(null);
  useEffect(() => {
    let current = true;
    setCopy(null);
    void call("experiments/" + slot)
      .then((value) => {
        if (current && value.text) setCopy(value);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [slot]);
  useEffect(() => {
    const element = view.current;
    if (!copy || !element || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting) &&
          document.visibilityState === "visible"
        ) {
          observer.disconnect();
          void call(`experiments/${slot}/exposure`, "POST", {
            revision: copy.revision,
            variant: copy.variant,
          }).catch(() => {});
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [copy, slot]);
  return copy ? (
    <aside
      ref={view}
      className="notice"
      style={{ margin: "1rem auto", maxWidth: 900 }}
    >
      {copy.text}
    </aside>
  ) : null;
}

/** The bar's sentence: trainers on the marketing site, people elsewhere. */
export const CONSENT_BAR_TEXT = {
  trainers:
    "Optional analytics show us which links bring trainers here. Health and coaching data are never included.",
  people:
    "Optional analytics count which links bring people here. They never include your health or coaching information.",
} as const;

/**
 * The first prompt: a slim bar along the bottom with two equal choices, a
 * close button and the privacy policy. It sits above the member app's bottom
 * chrome (--member-bottom-inset) and a spacer after the page reserves its
 * height, so the end of every page scrolls clear of it and it never hides a
 * page's own controls. --consent-bar-block-size carries its height to any
 * other fixed element while it shows.
 */
export function ConsentBar({
  audience,
  busy = false,
  error = "",
  onChoose,
  locale = "en",
  leaving = false,
}: {
  audience: keyof typeof CONSENT_BAR_TEXT;
  busy?: boolean;
  error?: string;
  onChoose: (answer: AnalyticsAnswer) => void;
  /** The marketing site (trainers) is always English. */
  locale?: Locale;
  /**
   * Answered: the bar slides away (subscriber pages, app/motion.css) and is
   * then removed. It takes no taps and is hidden from assistive technology
   * while it goes.
   */
  leaving?: boolean;
}) {
  const t = translator(consentMessages, audience === "trainers" ? "en" : locale);
  const privacyHref = usePrivacyHref();
  const bar = useRef<HTMLElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const root = document.documentElement;
    const update = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      setSize(height);
      root.style.setProperty("--consent-bar-block-size", height + "px");
    };
    update();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--consent-bar-block-size");
    };
  }, []);
  return (
    <>
      <div
        className="consent-bar-space"
        aria-hidden="true"
        style={{ blockSize: size }}
      />
      <aside
        ref={bar}
        className={"acquisition-consent consent-bar" + (leaving ? " is-leaving" : "")}
        data-audience={audience}
        aria-label={t("optionalAnalytics")}
        aria-hidden={leaving || undefined}
        inert={leaving || undefined}
      >
        <div className="consent-bar-inner">
          <div className="consent-bar-copy">
            <p className="consent-bar-text">
              {audience === "trainers" ? CONSENT_BAR_TEXT[audience] : t("barText")}{" "}
              <a className="consent-link" href={privacyHref}>
                {t("privacyPolicy")}
              </a>
            </p>
            {error && (
              <p role="alert" className="consent-error">
                {error}
              </p>
            )}
          </div>
          <div className="consent-bar-actions">
            <button
              type="button"
              className="consent-choice"
              disabled={busy}
              onClick={() => onChoose("allow")}
            >
              {t("allow")}
            </button>
            <button
              type="button"
              className="consent-choice"
              disabled={busy}
              onClick={() => onChoose("decline")}
            >
              {t("noThanks")}
            </button>
          </div>
          <button
            type="button"
            className="consent-close"
            aria-label={t("close")}
            disabled={busy}
            onClick={() => onChoose("dismiss")}
          >
            <X aria-hidden="true" size={22} />
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * The full preferences, opened only from a footer link or the member app's
 * Profile > Privacy: a bottom sheet on phones and a centred dialog on wider
 * screens (a native modal <dialog>: focus stays inside, Escape and the
 * backdrop close it). Allow and decline carry equal weight.
 */
export function ConsentSheet({
  permission,
  busy = false,
  error = "",
  onChoose,
  onClose,
  locale = "en",
}: {
  permission: Permission;
  busy?: boolean;
  error?: string;
  onChoose: (answer: AnalyticsAnswer) => Promise<boolean>;
  onClose: () => void;
  locale?: Locale;
}) {
  const t = translator(consentMessages, locale);
  const privacyHref = usePrivacyHref();
  const sheet = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = sheet.current;
    if (!dialog || dialog.open) return;
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute("open", "");
    }
  }, []);
  const close = () => {
    const dialog = sheet.current;
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    else onClose();
  };
  const answer = async (value: AnalyticsAnswer) => {
    if (await onChoose(value)) close();
  };
  return (
    <dialog
      ref={sheet}
      className="acquisition-consent consent-sheet"
      aria-labelledby="consent-sheet-title"
      onClose={onClose}
      onClick={(event) => {
        // A tap on the backdrop lands on the dialog itself.
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="consent-sheet-body">
        <div className="consent-sheet-head">
          <h2 id="consent-sheet-title">{t("sheetTitle")}</h2>
          <button
            type="button"
            className="consent-close"
            aria-label={t("close")}
            onClick={close}
          >
            <X aria-hidden="true" size={22} />
          </button>
        </div>
        <p>{t("sheetWhat")}</p>
        <p>
          <Rich
            t={t}
            k="sheetOff"
            tags={{
              link: (text) => (
                <a className="consent-link" href={privacyHref}>
                  {text}
                </a>
              ),
            }}
          />
        </p>
        <p className="consent-state">
          {permission.granted ? t("on") : t("off")}
        </p>
        {permission.granted && (
          <p className="muted">
            {t("sources", {
              first: permission.firstTouch?.source || t("direct"),
              last: permission.lastTouch?.source || t("direct"),
            })}
          </p>
        )}
        {error && (
          <p role="alert" className="consent-error">
            {error}
          </p>
        )}
        <div className="consent-sheet-actions">
          {!permission.granted && (
            <button
              type="button"
              className="consent-choice"
              disabled={busy}
              onClick={() => void answer("allow")}
            >
              {t("allowOptional")}
            </button>
          )}
          <button
            type="button"
            className="consent-choice"
            disabled={busy}
            onClick={() => void answer("decline")}
          >
            {permission.granted ? t("withdraw") : t("continueWithout")}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Profile > Privacy (the member app and the workspace settings): the
 * visitor's own switch for optional analytics in this browser.
 */
export function AnalyticsSetting() {
  const { permission, busy, error, choose } = useAnalyticsConsent();
  const t = useT("consent");
  const privacyHref = usePrivacyHref();
  const on = !!permission?.granted;
  return (
    <div className="analytics-setting">
      <h3>{t("sheetTitle")}</h3>
      <p className="muted">
        {t("settingText")}{" "}
        <a className="consent-link" href={privacyHref}>
          {t("privacyPolicy")}
        </a>
      </p>
      <p className="analytics-setting-state" role="status">
        {!permission
          ? t("checking")
          : on
            ? t("settingOn")
            : t("settingOff")}
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button secondary analytics-setting-action"
        disabled={!permission || busy}
        onClick={() => void choose(on ? "decline" : "allow")}
      >
        {on ? t("turnOff") : t("turnOn")}
      </button>
    </div>
  );
}

/**
 * Mount once in the root layout. No analytics ID or event is created before
 * opt-in. The layout passes the marketing paths, so the page registry stays
 * out of the client bundle.
 *
 * Before an answer: the slim bar (ConsentBar), which on marketing pages
 * opens only after the visitor scrolls. After any answer (allow, No thanks
 * or close) nothing floats on any page, and it stays that way after a
 * reload. The preferences sheet opens only from an element with
 * data-analytics-preferences (the public footers); the member app changes
 * the answer in Profile > Privacy (AnalyticsSetting).
 */
export function AcquisitionConsent({
  marketingPaths = [],
}: {
  marketingPaths?: readonly string[];
}) {
  const path = usePathname() || "/";
  const marketing = marketingPaths.includes(path);
  // The marketing site stays English; subscriber pages follow <html lang>.
  const pageLocale = useLocale();
  const locale = marketing ? "en" : pageLocale;
  const { permission, choice, busy, error, choose } = useAnalyticsConsent();
  const [scrolled, setScrolled] = useState(false),
    [sheetOpen, setSheetOpen] = useState(false),
    [leaving, setLeaving] = useState(false);
  const asking = asksForAnalytics(permission, choice);
  const bar = showsConsentBar({
    permission,
    choice,
    marketing,
    scrolled,
    sheetOpen,
  });
  // After an answer on a subscriber page the bar slides away and is then
  // removed from the page (docs/features/motion.md "j"); on the marketing
  // site, and with reduced motion, it goes at once.
  // Decided while rendering, so the bar never leaves the page for a frame
  // before it slides away.
  const [barShown, setBarShown] = useState(false);
  if (bar && !barShown) setBarShown(true);
  if (bar && leaving) setLeaving(false);
  if (!bar && barShown) {
    setBarShown(false);
    if (!marketing && !prefersReducedMotion()) setLeaving(true);
  }
  useEffect(() => {
    if (!leaving) return;
    const gone = window.setTimeout(() => setLeaving(false), MOTION.base + 40);
    return () => window.clearTimeout(gone);
  }, [leaving]);
  // The deferred prompt on a marketing page waits for the first scroll.
  useEffect(() => {
    if (!asking || !marketing || scrolled) return;
    const show = () => {
      if (window.scrollY >= 40) setScrolled(true);
    };
    show();
    window.addEventListener("scroll", show, { passive: true });
    return () => window.removeEventListener("scroll", show);
  }, [asking, marketing, scrolled]);
  // A footer link (any element with data-analytics-preferences) opens the
  // preferences sheet.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.("[data-analytics-preferences]")) return;
      event.preventDefault();
      setSheetOpen(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  useEffect(() => {
    if (permission?.granted && publicPage(path, marketingPaths))
      void call("acquisition/visit", "POST", touch()).catch(() => {});
  }, [path, permission?.granted, marketingPaths]);
  if (!permission) return null;
  const slot =
    path === "/"
      ? "landing-welcome"
      : path === "/trainer/onboarding"
        ? "onboarding-welcome"
        : null;
  return (
    <>
      {permission.granted && slot && <ExperimentCopy key={slot} slot={slot} />}
      {(bar || leaving) && (
        <ConsentBar
          audience={marketing ? "trainers" : "people"}
          busy={busy}
          error={error}
          onChoose={(answer) => void choose(answer)}
          locale={locale}
          leaving={!bar && leaving}
        />
      )}
      {sheetOpen && (
        <ConsentSheet
          permission={permission}
          busy={busy}
          error={error}
          onChoose={choose}
          locale={locale}
          onClose={() => {
            setSheetOpen(false);
            // Closing the sheet before any answer is an answer too.
            if (asksForAnalytics(permission, readAnalyticsChoice()))
              void choose("dismiss");
          }}
        />
      )}
    </>
  );
}
