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
  return Object.fromEntries(
    [
      ["source", "utm_source"],
      ["medium", "utm_medium"],
      ["campaign", "utm_campaign"],
      ["referral", "ref"],
    ].flatMap(([key, param]) => {
      const value = q.get(param);
      return value && value.length <= 200 ? [[key, value]] : [];
    }),
  );
}
const publicPage = (path: string) =>
  ["/", "/pricing", "/how-it-works", "/demo", "/faq", "/signup"].includes(
    path,
  ) ||
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

/** Mount once in the root layout. No analytics ID or event is created before opt-in. */
export function AcquisitionConsent() {
  const path = usePathname() || "/";
  const [permission, setPermission] = useState<Permission | null>(null),
    [open, setOpen] = useState(false),
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
        setOpen(!value.granted && !declined);
      })
      .catch(() => {
        if (current) setPermission({ granted: false });
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (permission?.granted && publicPage(path))
      void call("acquisition/visit", "POST", touch()).catch(() => {});
  }, [path, permission?.granted]);
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
  return (
    <>
      {permission.granted && slot && <ExperimentCopy key={slot} slot={slot} />}
      <aside
        aria-label="Optional analytics preferences"
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
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
    </>
  );
}
