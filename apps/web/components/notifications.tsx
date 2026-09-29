"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { parseLanguage } from "../document-language";
import { rememberMemberLanguage } from "./document-direction";
import { PREFERENCES_SAVED_EVENT } from "./appearance";
import { Skeleton } from "./phone-ui";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import { formatDateTime, timeZoneChoices } from "../lib/format";

const CATEGORIES = [
  "workout",
  "workouts",
  "booking",
  "bookings",
  "message",
  "messages",
  "coaching",
  "nutrition",
  "billing",
  "membership",
  "account",
  "security",
  "safety",
  "support",
  "system",
] as const;
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "The request failed");
  return d;
}
export function NotificationPreferences() {
  const [value, setValue] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const t = useT("prefs"),
    locale = useLocale(),
    toError = useErrorText();
  useEffect(() => {
    void api("/notifications/preferences")
      .then(setValue)
      .catch((e) => setError(toError(e)));
    // Display preferences saves the appearance on its own: take its newer
    // version and value, keeping any unsaved change made here.
    const saved = (event: Event) => {
      const next = (event as CustomEvent).detail;
      setValue((v: any) =>
        v
          ? {
              ...v,
              version: next.version,
              data: { ...v.data, theme: next.data?.theme },
            }
          : v,
      );
    };
    window.addEventListener(PREFERENCES_SAVED_EVENT, saved);
    return () => window.removeEventListener(PREFERENCES_SAVED_EVENT, saved);
  }, []);
  return (
    <section className="card">
      <h2>{t("notifications")}</h2>
      <p className="muted">{t("notificationsText")}</p>
      {error && (
        <p className="notice" role="status">
          {error}
        </p>
      )}
      {value && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const { options, ...body } = value;
              const saved = await api(
                "/notifications/preferences",
                "PUT",
                body,
              );
              setValue({ ...saved, options });
              // The saved language also sets the workspace direction.
              const language = parseLanguage(saved.data?.language);
              if (language) rememberMemberLanguage(language);
              // Said in the language just chosen (the page switches with it).
              setError(
                language === "ar"
                  ? "تم حفظ التفضيلات."
                  : language === "en"
                    ? "Preferences saved."
                    : t("preferencesSaved"),
              );
            } catch (e) {
              setError(toError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {(
            [
              "email",
              "bookings",
              "workouts",
              ...(value.options?.inquiries ? ["inquiries"] : []),
              "marketing",
            ] as Array<
              "email" | "bookings" | "workouts" | "inquiries" | "marketing"
            >
          ).map((key) => [key, t(key)] as const).map(([key, label]) => (
            <label className="check-field" key={key}>
              <input
                type="checkbox"
                checked={value.data[key]}
                onChange={(e) =>
                  setValue({
                    ...value,
                    data: { ...value.data, [key]: e.target.checked },
                  })
                }
              />
              {label}
            </label>
          ))}
          <label className="field">
            <span>{t("language")}</span>
            <select
              value={value.data.language ?? "en"}
              onChange={(e) =>
                setValue({
                  ...value,
                  data: { ...value.data, language: e.target.value },
                })
              }
            >
              <option value="en" lang="en">
                {t("english")}
              </option>
              <option value="ar" lang="ar">
                {t("arabic")}
              </option>
            </select>
          </label>
          <small>{t("languageHelp")}</small>
          <label className="field">
            <span>{t("timeZone")}</span>
            {/* People pick a place and its zone name, never a raw zone id. */}
            <select
              value={value.data.timezone}
              required
              onChange={(e) =>
                setValue({
                  ...value,
                  data: { ...value.data, timezone: e.target.value },
                })
              }
            >
              {timeZoneChoices(value.data.timezone, locale).map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["quietStart", t("quietStart")],
              ["quietEnd", t("quietEnd")],
            ] as const
          ).map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                type="time"
                value={`${String(Math.floor(value.data[key] / 60)).padStart(2, "0")}:${String(value.data[key] % 60).padStart(2, "0")}`}
                required
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  setValue({
                    ...value,
                    data: { ...value.data, [key]: h * 60 + m },
                  });
                }}
              />
            </label>
          ))}
          <small>{t("quietHelp")}</small>
          <p>
            <button className="button" disabled={busy}>
              {t("savePreferences")}
            </button>
          </p>
        </form>
      )}
    </section>
  );
}
export function NotificationInbox() {
  const [rows, setRows] = useState<any[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const t = useT("prefs"),
    locale = useLocale(),
    toError = useErrorText();
  const category = (key: string) =>
    (CATEGORIES as readonly string[]).includes(key)
      ? t(`category_${key as (typeof CATEGORIES)[number]}`)
      : t("category_other");
  // Older pages continue after the last notification shown (a keyset
  // cursor), so a notice arriving meanwhile neither repeats nor hides one.
  async function load(before?: string) {
    setLoading(true);
    setError("");
    try {
      const d: any[] = await api(
        before
          ? `/notifications?before=${encodeURIComponent(before)}`
          : "/notifications",
      );
      setRows((v) =>
        before ? [...v, ...d.filter((n) => !v.some((r) => r.id === n.id))] : d,
      );
      setMore(d.length === 50);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load().catch((e) => setError(toError(e)));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("keepInTouch")}</p>
          <h1>{t("yourNotifications")}</h1>
        </div>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => void load().catch((e) => setError(toError(e)))}
        >
          {t("refresh")}
        </button>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {loading && (
        <section className="card">
          <Skeleton label={t("loadingNotifications")} lines={3} />
        </section>
      )}
      {!loading && !error && !rows.length && (
        <section className="card">
          <p>{t("caughtUp")}</p>
        </section>
      )}
      {rows.map((n) => (
        <article className="card" key={n.id}>
          <small>
            {category(n.category)} ·{" "}
            {formatDateTime(n.created_at, { locale })}
            {n.read_at ? t("read") : t("newNote")}
          </small>
          {/* Reviewed Arabic templates read right to left in any layout. */}
          <h2 dir="auto">{n.title}</h2>
          <p style={{ whiteSpace: "pre-wrap" }} dir="auto">
            {n.body}
          </p>
          <div className="actions">
            {n.href && (
              <Link className="button secondary" href={n.href}>
                {t("open")}
              </Link>
            )}
            {!n.read_at && (
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await api(`/notifications/${n.id}/read`, "POST", {});
                    setRows((current) =>
                      current.map((r) =>
                        r.id === n.id
                          ? { ...r, read_at: new Date().toISOString() }
                          : r,
                      ),
                    );
                  } catch (e) {
                    setError(toError(e));
                  }
                }}
              >
                {t("markRead")}
              </button>
            )}
          </div>
        </article>
      ))}
      {more && (
        <button
          className="button secondary"
          disabled={loading}
          onClick={() =>
            void load(rows[rows.length - 1]?.id).catch((e) =>
              setError(toError(e)),
            )
          }
        >
          {t("loadEarlier")}
        </button>
      )}
    </>
  );
}
