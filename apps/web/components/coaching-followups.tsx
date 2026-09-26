"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Followup = {
  id: string;
  version: number;
  status: string;
  author_name?: string;
  data: {
    text: string;
    dueAt: string;
    timezone: string;
    authorUserId: string;
    reviewReason?: string;
    deliveredAt?: string;
    canceledAt?: string;
  };
};
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/v1/coaching/followups" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "Unable to update scheduled follow-ups");
  return data;
}
function localInput(iso: string) {
  const value = new Date(iso);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function when(r: Followup) {
  return (
    new Date(r.data.dueAt).toLocaleString(undefined, {
      timeZone: r.data.timezone,
    }) +
    " · " +
    r.data.timezone
  );
}
export function CoachingFollowups({
  subscriberId,
  user,
}: {
  subscriberId: string;
  user: { userId: string; role: string };
}) {
  const [upcoming, setUpcoming] = useState<Followup[]>([]),
    [history, setHistory] = useState<Followup[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Followup | null>(null),
    [text, setText] = useState(""),
    [due, setDue] = useState(""),
    [timezone, setTimezone] = useState("UTC"),
    [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const intent = useRef<string | null>(null);
  const load = useCallback(async () => {
    const [next, past] = await Promise.all([
      api("?subscriberId=" + subscriberId),
      api("?subscriberId=" + subscriberId + "&view=history"),
    ]);
    setUpcoming(next.records);
    setHistory(past.records);
    setCursor(past.nextCursor);
    setLoaded(true);
  }, [subscriberId]);
  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void load().catch((e) => setError(e.message));
    }, 30000);
    return () => clearInterval(timer);
  }, [load]);
  function reset() {
    setEditing(null);
    setText("");
    setDue("");
    setReviewed(false);
    intent.current = null;
  }
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      intent.current ??= crypto.randomUUID();
      const body = {
        text,
        dueAt: new Date(due).toISOString(),
        timezone,
        reviewed,
      };
      await api(editing ? "/" + editing.id : "", editing ? "PATCH" : "POST", {
        ...body,
        ...(editing
          ? { version: editing.version }
          : { subscriberId, requestKey: intent.current }),
      });
      reset();
      await load();
      setNotice(
        "Follow-up scheduled. Delivery will recheck the client's current coaching context.",
      );
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function cancel(r: Followup) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/" + r.id + "/cancel", "POST", { version: r.version });
      if (editing?.id === r.id) reset();
      await load();
      setNotice("Follow-up canceled");
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card" aria-label="Scheduled follow-ups">
      <h2>Scheduled follow-ups</h2>
      <p className="muted">
        Write a personal message now for later delivery. Drafts are visible only
        to your coaching team. Changed access, consent, instructions, safety
        holds or personal takeover return the message for review.
      </p>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3>{editing ? "Review and reschedule" : "Schedule a message"}</h3>
        <label className="field">
          <span>Follow-up message</span>
          <textarea
            required
            rows={3}
            maxLength={4000}
            value={text}
            disabled={busy}
            onChange={(e) => {
              setText(e.target.value);
              setReviewed(false);
              intent.current = null;
            }}
          />
        </label>
        <div className="form-grid">
          <label className="field">
            <span>Delivery date and time</span>
            <input
              type="datetime-local"
              required
              value={due}
              disabled={busy}
              onChange={(e) => {
                setDue(e.target.value);
                setReviewed(false);
                intent.current = null;
              }}
            />
          </label>
          <label className="field">
            <span>Schedule timezone (this device)</span>
            <input value={timezone} readOnly />
          </label>
        </div>
        <p className="muted">
          Choose between one minute and 90 days ahead.
          {due && !Number.isNaN(Date.parse(due))
            ? " Delivery: " +
              new Date(due).toLocaleString() +
              " (" +
              new Date(due).toISOString() +
              ")."
            : ""}
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={reviewed}
            disabled={busy}
            onChange={(e) => setReviewed(e.target.checked)}
          />{" "}
          I reviewed this message against the client's current plan and
          circumstances.
        </label>
        <div className="button-row">
          <button
            className="button"
            type="submit"
            disabled={busy || !reviewed || !text.trim() || !due}
          >
            {editing ? "Save reviewed schedule" : "Schedule follow-up"}
          </button>
          {editing && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={reset}
            >
              Stop editing
            </button>
          )}
        </div>
      </form>
      <h3>Upcoming and awaiting review</h3>
      {!loaded && <p role="status">Loading follow-ups…</p>}
      {loaded && !upcoming.length && <p>No upcoming follow-ups.</p>}
      {upcoming.map((r) => (
        <article
          key={r.id}
          style={{ borderTop: "1px solid var(--line)", paddingBlock: 16 }}
        >
          <strong>
            {r.status === "review_required" ? "Needs your review" : "Scheduled"}
          </strong>
          <p className="muted">
            {when(r)} · {r.author_name ?? "Coach"} · revision {r.version}
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{r.data.text}</p>
          {r.data.reviewReason && (
            <p className="notice">
              {r.data.reviewReason}. Resolve the issue, then review and
              reschedule or cancel.
            </p>
          )}
          {(user.role === "owner" || r.data.authorUserId === user.userId) && (
            <div className="button-row">
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(r);
                  setText(r.data.text);
                  setDue(localInput(r.data.dueAt));
                  setReviewed(false);
                  setNotice("");
                  setError("");
                }}
              >
                Review / reschedule
              </button>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => void cancel(r)}
              >
                Cancel follow-up
              </button>
            </div>
          )}
        </article>
      ))}
      <details>
        <summary>Delivery and cancellation history</summary>
        {!history.length && <p>No completed follow-ups.</p>}
        {history.map((r) => (
          <article
            key={r.id}
            style={{ borderTop: "1px solid var(--line)", paddingBlock: 12 }}
          >
            <strong>
              {r.status === "delivered"
                ? "Delivered to conversation"
                : "Canceled"}
            </strong>
            <p className="muted">
              Scheduled for {when(r)} · {r.author_name ?? "Coach"}
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{r.data.text}</p>
            {r.data.deliveredAt && (
              <p className="muted">
                Delivered {new Date(r.data.deliveredAt).toLocaleString()}. Email
                delivery is tracked separately in notifications.
              </p>
            )}
          </article>
        ))}
        {cursor && (
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const more = await api(
                  "?subscriberId=" +
                    subscriberId +
                    "&view=history&before=" +
                    cursor,
                );
                setHistory((v) => [...v, ...more.records]);
                setCursor(more.nextCursor);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Load older follow-ups
          </button>
        )}
      </details>
    </section>
  );
}
