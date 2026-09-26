"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
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
              setValue(await api("/notifications/preferences", "PUT", value));
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
            <span>Time zone</span>
            <input
              value={value.data.timezone}
              required
              onChange={(e) =>
                setValue({
                  ...value,
                  data: { ...value.data, timezone: e.target.value },
                })
              }
            />
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
          <small>Set both times alike to disable quiet hours.</small>
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
  async function load(offset = 0) {
    setLoading(true);
    setError("");
    try {
      const d = await api(`/notifications?offset=${offset}`);
      setRows((v) => (offset ? [...v, ...d] : d));
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
          <p className="eyebrow">KEEP IN TOUCH</p>
          <h1>Your notifications.</h1>
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
          <p>You’re all caught up.</p>
        </section>
      )}
      {rows.map((n) => (
        <article className="card" key={n.id}>
          <small>
            {n.category} · {new Date(n.created_at).toLocaleString()}
            {n.read_at ? " · Read" : " · New"}
          </small>
          <h2>{n.title}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>
          <div className="actions">
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
            void load(rows.length).catch((e) => setError(e.message))
          }
        >
          Load earlier notifications
        </button>
      )}
    </>
  );
}
