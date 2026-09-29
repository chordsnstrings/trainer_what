"use client";
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";

type LegalKey = "terms" | "privacy" | "ai-disclosure";
/** The document names people know (not internal keys). */
export const LEGAL_TITLES: Record<LegalKey, string> = {
  terms: "Terms of service",
  privacy: "Privacy policy",
  "ai-disclosure": "Digital coaching disclosure",
};
/** "29 Sept 2026": a date, never a time with seconds. */
export function legalDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

/**
 * A published platform document (terms, privacy policy, digital coaching
 * disclosure) as a readable phone page: 16 px gutters, a styled way home,
 * 16 px body text. When the platform has not published the document yet the
 * page says so plainly, and joining forms do not ask anyone to accept it
 * (components/legal-acceptance.tsx).
 */
export function PublishedLegal({
  documentKey,
  platformName,
}: {
  documentKey: LegalKey;
  platformName?: string;
}) {
  const [version, setVersion] = useState(""),
    [data, setData] = useState<any>(null),
    [state, setState] = useState<"loading" | "ready" | "unpublished" | "failed">(
      "loading",
    ),
    [attempt, setAttempt] = useState(0);
  useEffect(() => setVersion(""), [documentKey]);
  useEffect(() => {
    let active = true;
    setData(null);
    setState("loading");
    void fetch(
      `/api/v1/public/documents/${documentKey}${version ? `?version=${version}` : ""}`,
    )
      .then(async (r) => {
        const result = await r.json().catch(() => ({}));
        if (!active) return;
        if (r.ok) {
          setData(result);
          setState("ready");
        } else
          setState(
            result.code === "LEGAL_NOT_PUBLISHED" ? "unpublished" : "failed",
          );
      })
      .catch(() => {
        if (active) setState("failed");
      });
    return () => {
      active = false;
    };
  }, [documentKey, version, attempt]);
  const title = LEGAL_TITLES[documentKey];
  // "Terms of service" reads as plural.
  const plural = documentKey === "terms";
  return (
    <main className="legal-page" id="main">
      <a className="legal-home" href="/">
        <ChevronLeft size={18} aria-hidden="true" className="bidi-mirror" />
        Home
      </a>
      <article className="legal-document" aria-labelledby="legal-title">
        <h1 id="legal-title">{data?.document.title ?? title}</h1>
        {state === "unpublished" ? (
          <div className="legal-state" role="status">
            <h2>Not published yet</h2>
            <p>
              {platformName
                ? `The ${title.toLowerCase()} for ${platformName}`
                : `This ${title.toLowerCase()}`}{" "}
              {plural ? "are" : "is"} still being approved and will appear on
              this page once {plural ? "they are" : "it is"} published.
            </p>
            <p className="muted">
              Until then, nobody is asked to accept {plural ? "them" : "it"}{" "}
              when they join a coach.
            </p>
          </div>
        ) : state === "failed" ? (
          <div className="legal-state" role="alert">
            <p>This page could not be loaded. Check your connection and try again.</p>
            <button
              type="button"
              className="button secondary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again
            </button>
          </div>
        ) : state === "loading" || !data ? (
          <p className="muted" role="status">
            Loading…
          </p>
        ) : (
          <>
            <p className="legal-meta muted">
              Version {data.document.version} · in effect from{" "}
              {legalDate(data.document.effective_at)}
            </p>
            {data.versions.length > 1 && (
              <label className="field legal-versions">
                <span>Earlier versions</span>
                <select
                  value={version || String(data.document.version)}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  {data.versions.map((v: any) => (
                    <option value={v.version} key={v.version}>
                      Version {v.version}, in effect from{" "}
                      {legalDate(v.effective_at)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="legal-body" dir="auto">
              {data.document.content}
            </div>
          </>
        )}
      </article>
    </main>
  );
}
