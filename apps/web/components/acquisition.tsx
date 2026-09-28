"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

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
    throw new Error(
      "Your analytics preference could not be saved. Please try again.",
    );
  return response.json();
}
function rememberDecline(value: boolean) {
  try {
    value
      ? localStorage.setItem("analytics-preference", "declined")
      : localStorage.removeItem("analytics-preference");
  } catch {
    /* A browser preference never blocks a choice. */
  }
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

/**
 * Mount once in the root layout. No analytics ID or event is created before
 * opt-in. The layout passes the marketing paths, so the page registry stays
 * out of the client bundle.
 *
 * On marketing pages the first prompt is a slim bottom bar (one sentence,
 * Allow, No thanks, Details) that opens only after the visitor scrolls, so
 * it never covers the hero's call to action or the relay on the first
 * screen. "Details", and the footer's "Analytics preferences" button
 * (any element with data-analytics-preferences), open the full panel. Pages
 * with that footer button show no floating preferences button.
 */
export function AcquisitionConsent({
  marketingPaths = [],
}: {
  marketingPaths?: readonly string[];
}) {
  const path = usePathname() || "/";
  const marketing = marketingPaths.includes(path);
  const [permission, setPermission] = useState<Permission | null>(null),
    [open, setOpen] = useState(false),
    // A first prompt waiting for the visitor to scroll (marketing pages).
    [waiting, setWaiting] = useState(false),
    [bar, setBar] = useState(false),
    [footerEntry, setFooterEntry] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void call("acquisition/consent")
      .then((value) => {
        if (!current) return;
        setPermission(value);
        let declined = false;
        try {
          declined =
            localStorage.getItem("analytics-preference") === "declined";
        } catch {
          /* No browser preference. */
        }
        const ask = !value.granted && !declined;
        const deferred = ask && marketingPaths.includes(window.location.pathname);
        setBar(deferred);
        setWaiting(deferred);
        setOpen(ask && !deferred);
      })
      .catch(() => {
        if (current) setPermission({ granted: false });
      });
    return () => {
      current = false;
    };
    // The first answer decides the prompt; later pages reuse it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The deferred prompt opens on the visitor's first scroll, or at once on
  // a page outside the marketing site (as the prompt always did there).
  useEffect(() => {
    if (!waiting) return;
    if (!marketing) {
      setWaiting(false);
      setOpen(true);
      return;
    }
    const show = () => {
      if (window.scrollY < 40) return;
      setWaiting(false);
      setOpen(true);
    };
    show();
    window.addEventListener("scroll", show, { passive: true });
    return () => window.removeEventListener("scroll", show);
  }, [waiting, marketing]);
  // The footer's button opens the full panel.
  useEffect(() => {
    setFooterEntry(!!document.querySelector("[data-analytics-preferences]"));
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.("[data-analytics-preferences]")) return;
      event.preventDefault();
      setWaiting(false);
      setBar(false);
      setOpen(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [path]);
  useEffect(() => {
    if (permission?.granted && publicPage(path, marketingPaths))
      void call("acquisition/visit", "POST", touch()).catch(() => {});
  }, [path, permission?.granted, marketingPaths]);
  useEffect(() => {
    let current = true;
    const refresh = () => {
      void call("acquisition/consent")
        .then((value) => {
          if (current) setPermission(value);
        })
        .catch(() => {});
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      current = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  async function choose(granted: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const value = granted
        ? await call("acquisition/consent", "POST", {
            granted: true,
            touch: touch(),
          })
        : permission?.granted
          ? await call("acquisition/consent", "DELETE")
          : { granted: false };
      rememberDecline(!granted);
      setPermission(value);
      setOpen(false);
      setBar(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!permission) return null;
  const slot =
    path === "/"
      ? "landing-welcome"
      : path === "/trainer/onboarding"
        ? "onboarding-welcome"
        : null;
  const showBar = open && bar && marketing;
  // Closed: the floating button, unless the page's footer offers one.
  if (!open && footerEntry)
    return permission.granted && slot ? <ExperimentCopy key={slot} slot={slot} /> : null;
  return (
    <>
      {permission.granted && slot && <ExperimentCopy key={slot} slot={slot} />}
      {showBar ? (
        <aside
          className="acquisition-consent consent-bar"
          aria-label="Optional analytics preferences"
        >
          <div className="consent-bar-inner">
            <p>
              Optional analytics show us which links bring trainers here.
              Health and coaching data are never included.
            </p>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <div className="consent-bar-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void choose(true)}
              >
                Allow analytics
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => void choose(false)}
              >
                No thanks
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setBar(false)}
              >
                Details
              </button>
            </div>
          </div>
        </aside>
      ) : (
        <aside
          className="acquisition-consent"
          aria-label="Optional analytics preferences"
          style={{
            position: "fixed",
            bottom: 16,
            insetInlineEnd: 16,
            zIndex: 45,
            maxWidth: "min(390px,calc(100vw - 32px))",
          }}
        >
          {!open ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => setOpen(true)}
            >
              Analytics preferences
            </button>
          ) : (
            <div
              className="card"
              style={{ padding: 20, boxShadow: "0 6px 30px #0002" }}
            >
              <h2 style={{ marginTop: 0 }}>Optional site analytics</h2>
              <p>
                Allow source and campaign codes, signup and purchase milestones,
                and limited wording tests. Health and coaching information stays
                outside these analytics.
              </p>
              <p>
                You can use the full service without analytics. Withdrawing
                removes the linked analytics history for this browser.{" "}
                <a href="/privacy">Read our privacy policy</a>.
              </p>
              {permission.granted && (
                <p className="muted">
                  First source: {permission.firstTouch?.source || "direct"}. Last
                  tagged source: {permission.lastTouch?.source || "direct"}.
                </p>
              )}
              {error && (
                <p role="alert" className="notice error">
                  {error}
                </p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {!permission.granted && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => void choose(true)}
                  >
                    Allow optional analytics
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void choose(false)}
                >
                  {permission.granted
                    ? "Withdraw analytics consent"
                    : "Continue without analytics"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </aside>
      )}
    </>
  );
}
