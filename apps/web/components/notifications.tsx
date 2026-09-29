"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { parseLanguage } from "../document-language";
import { rememberMemberLanguage } from "./document-direction";
import { formatWhen, labelFor, timeZoneChoices } from "../lib/format";

/** Notification categories in words (never the stored key). */
export const NOTIFICATION_CATEGORIES: Record<string, string> = {
  account: "Account",
  authenticators: "Sign-in security",
  booking: "Booking",
  boundaries: "Coaching",
  coaching: "Coaching",
  human_review: "Coach review",
  payout_fee: "Payouts",
  policy_review: "Coaching",
  safety: "Safety",
  server: "Service",
  workout: "Training",
  nutrition: "Nutrition",
  billing: "Membership",
  support: "Support",
};
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
  useEffect(() => {
    void api("/notifications/preferences")
      .then(setValue)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="card">
      <h2>Notifications</h2>
      <p className="muted">
        Choose your reminders and quiet hours. Account security and urgent
        safety alerts remain enabled.
      </p>
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
              setError("Preferences saved.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {[
            ["email", "Email reminders"],
            ["bookings", "Booking notifications"],
            ["workouts", "Workout reminders"],
            ...(value.options?.inquiries
              ? [["inquiries", "Website inquiry alerts by email and device"]]
              : []),
            ["marketing", "Optional product news"],
          ].map(([key, label]) => (
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
            <span>Message language</span>
            <select
              value={value.data.language ?? "en"}
              onChange={(e) =>
                setValue({
                  ...value,
                  data: { ...value.data, language: e.target.value },
                })
              }
            >
              <option value="en">English</option>
              <option value="ar" lang="ar">
                العربية (Arabic)
              </option>
            </select>
          </label>
          <small>
            Messages use reviewed Arabic wording where it is published and
            English otherwise. Arabic also arranges the app from right to left.
          </small>
          <label className="field">
            <span>Time zone for reminders and quiet hours</span>
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
              {timeZoneChoices(value.data.timezone).map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </select>
          </label>
          {[
            ["quietStart", "Quiet hours start"],
            ["quietEnd", "Quiet hours end"],
          ].map(([key, label]) => (
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
          <small>
            Choose the same start and end time to turn quiet hours off.
          </small>
          <p>
            <button className="button" disabled={busy}>
              Save preferences
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
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Notifications</h1>
          <p className="muted">
            Updates about your coaching, bookings and account.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading notifications…</p>}
      {!loading && !error && !rows.length && (
        <section className="card">
          <h2>You’re all caught up</h2>
          <p className="muted">
            New updates from your coach, your bookings and your account appear
            here.
          </p>
        </section>
      )}
      {rows.map((n) => (
        <article className="card" key={n.id}>
          <p className="notification-meta">
            <span>{labelFor(NOTIFICATION_CATEGORIES, n.category)}</span>
            <span>{formatWhen(n.created_at)}</span>
            {!n.read_at && <span className="badge green">New</span>}
          </p>
          {/* Reviewed Arabic templates read right to left in any layout. */}
          <h2 dir="auto">{n.title}</h2>
          <p style={{ whiteSpace: "pre-wrap" }} dir="auto">
            {n.body}
          </p>
          <div className="actions notification-actions">
            {n.href && (
              <Link className="button secondary" href={n.href}>
                Open
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
                    setError((e as Error).message);
                  }
                }}
              >
                Mark read
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
              setError(e.message),
            )
          }
        >
          Load earlier notifications
        </button>
      )}
    </>
  );
}
