"use client";
import { memberApiUrl } from "../lib/trainer-preview-routing";
import { useEffect, useState } from "react";
import Link from "./preview-navigation";
import { parseLanguage } from "../document-language";
import { rememberMemberLanguage } from "./document-direction";
import { PREFERENCES_SAVED_EVENT } from "./appearance";
import { LoadingOrRetry } from "./phone-ui";
import { RefreshCw } from "lucide-react";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import { formatWhen, timeZoneChoices } from "../lib/format";
import { translator, type Locale } from "../lib/i18n/core";
import prefsMessages from "../lib/i18n/messages/prefs";

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
  "authenticators",
  "boundaries",
  "human_review",
  "payout_fee",
  "policy_review",
  "server",
] as const;
/** A notification category in words (never the stored key). */
export function notificationCategory(key: string, locale: Locale = "en") {
  const t = translator(prefsMessages, locale);
  return (CATEGORIES as readonly string[]).includes(key)
    ? t(`category_${key as (typeof CATEGORIES)[number]}`)
    : t("category_other");
}
/** The English words, for callers that read the map. */
export const NOTIFICATION_CATEGORIES: Record<string, string> =
  Object.fromEntries(CATEGORIES.map((key) => [key, notificationCategory(key)]));
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(memberApiUrl("/api/v1" + path), {
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
              {/* 24-hour times, like the rest of the app (a native time
                  field follows the phone's 12-hour setting). */}
              <select
                value={value.data[key]}
                required
                onChange={(e) =>
                  setValue({
                    ...value,
                    data: { ...value.data, [key]: Number(e.target.value) },
                  })
                }
              >
                {quietTimes(value.data[key]).map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {clock(minutes)}
                  </option>
                ))}
              </select>
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
/** "22:00": minutes after midnight as a 24-hour time. */
const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** Every half hour, plus the saved time when it is not on the half hour. */
function quietTimes(current: number) {
  const times = Array.from({ length: 48 }, (_, i) => i * 30);
  return times.includes(current)
    ? times
    : [...times, current].sort((a, b) => a - b);
}

export function NotificationInbox() {
  const [rows, setRows] = useState<any[]>([]),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const t = useT("prefs"),
    locale = useLocale(),
    toError = useErrorText();
  const category = (key: string) => notificationCategory(key, locale);
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
          <h1>{t("yourNotifications")}</h1>
          <p className="muted">{t("notificationsIntro")}</p>
        </div>
        {/* A small control: the notifications are the page, not Refresh. */}
        <button
          type="button"
          className="icon-button notifications-refresh"
          aria-label={t("refresh")}
          title={t("refresh")}
          aria-busy={loading || undefined}
          onClick={() => {
            if (!loading) void load().catch((e) => setError(toError(e)));
          }}
        >
          <RefreshCw size={20} aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {loading && (
        <section className="card">
          <LoadingOrRetry
            label={t("loadingNotifications")}
            onRetry={() => void load().catch((e) => setError(toError(e)))}
          />
        </section>
      )}
      {!loading && !error && !rows.length && (
        <section className="card">
          <h2>{t("caughtUp")}</h2>
          <p className="muted">{t("caughtUpText")}</p>
        </section>
      )}
      {rows.map((n) => (
        <article className="card" key={n.id}>
          <p className="notification-meta">
            <span>{category(n.category)}</span>
            <span>{formatWhen(n.created_at, { locale })}</span>
            {!n.read_at && <span className="badge green">{t("newBadge")}</span>}
          </p>
          {/* Reviewed Arabic templates read right to left in any layout. */}
          <h2 dir="auto">{n.title}</h2>
          <p style={{ whiteSpace: "pre-wrap" }} dir="auto">
            {n.body}
          </p>
          <div className="actions notification-actions">
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
