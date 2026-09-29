"use client";
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useLocale, useT } from "../lib/i18n/react";
import { formatDate } from "../lib/format";
import type { Locale } from "../lib/i18n/core";

type LegalKey = "terms" | "privacy" | "ai-disclosure";
/** The document names people know (not internal keys). */
export const LEGAL_TITLES: Record<LegalKey, string> = {
  terms: "Terms of service",
  privacy: "Privacy policy",
  "ai-disclosure": "Digital coaching disclosure",
};
/** "29 Sept 2026" (Arabic "29 سبتمبر 2026"): a date, never a time with seconds. */
export function legalDate(value: string | null | undefined, locale: Locale = "en") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return locale === "en"
    ? date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : formatDate(date, { locale });
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
  const t = useT("public"),
    common = useT("common"),
    locale = useLocale();
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
  const title = t(
    documentKey === "terms"
      ? "termsTitle"
      : documentKey === "privacy"
        ? "privacyTitle"
        : "aiTitle",
  );
  // "Terms of service" reads as plural.
  const plural = documentKey === "terms";
  const document = locale === "en" ? title.toLowerCase() : title;
  // The platform writes its documents; an Arabic page keeps the product's
  // title and says the text itself is the platform's English.
  const english = locale !== "en" && !/[\u0600-\u06FF]/.test(data?.document.content ?? "");
  return (
    <main className="legal-page" id="main">
      <a className="legal-home" href="/">
        <ChevronLeft size={18} aria-hidden="true" className="bidi-mirror" />
        {t("home")}
      </a>
      <article className="legal-document" aria-labelledby="legal-title">
        <h1 id="legal-title">
          {locale === "en" ? (data?.document.title ?? title) : title}
        </h1>
        {state === "unpublished" ? (
          <div className="legal-state" role="status">
            <h2>{t("notPublished")}</h2>
            <p>
              {platformName
                ? t(plural ? "stillApprovingForMany" : "stillApprovingFor", {
                    document,
                    platform: platformName,
                  })
                : t(plural ? "stillApprovingMany" : "stillApproving", {
                    document,
                  })}
            </p>
            <p className="muted">
              {t(plural ? "nobodyAskedMany" : "nobodyAsked")}
            </p>
          </div>
        ) : state === "failed" ? (
          <div className="legal-state" role="alert">
            <p>{t("loadFailed")}</p>
            <button
              type="button"
              className="button secondary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              {common("tryAgain")}
            </button>
          </div>
        ) : state === "loading" || !data ? (
          <p className="muted" role="status">
            {common("loading")}
          </p>
        ) : (
          <>
            <p className="legal-meta muted">
              {t("versionMeta", {
                version: data.document.version,
                date: legalDate(data.document.effective_at, locale),
              })}
            </p>
            {english && (
              <p className="legal-meta muted">{t("documentLanguageNote")}</p>
            )}
            {data.versions.length > 1 && (
              <label className="field legal-versions">
                <span>{t("earlierVersions")}</span>
                <select
                  value={version || String(data.document.version)}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  {data.versions.map((v: any) => (
                    <option value={v.version} key={v.version}>
                      {t("versionOption", {
                        version: v.version,
                        date: legalDate(v.effective_at, locale),
                      })}
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
