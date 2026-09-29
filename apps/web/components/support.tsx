"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatWhen, labelFor } from "../lib/format";

/** Support topics in words; the stored value stays the API's key. */
export const SUPPORT_CATEGORIES: Array<[string, string]> = [
  ["account", "My account or sign-in"],
  ["billing", "Payments and membership"],
  ["coaching", "My coaching"],
  ["technical", "Something is not working"],
  ["privacy", "Privacy and my data"],
];
export const SUPPORT_STATUS: Record<string, string> = {
  open: "Open",
  pending: "Waiting for your reply",
  resolved: "Solved",
  closed: "Closed",
};

export function Support({
  records,
  action,
  busy,
  userId,
  member = false,
}: {
  records: any[];
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  busy: boolean;
  /** The signed-in person, so their own messages read "You". */
  userId?: string;
  /** The member app: plain help wording and a pointer to coach chat. */
  member?: boolean;
}) {
  const [selected, setSelected] = useState("");
  const thread = records.find((r) => r.id === selected);
  const threadRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected)
      threadRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [selected]);
  async function post(path: string, body: unknown) {
    const r = await fetch("/api/v1/support" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new Error(
        r.status === 409
          ? "This conversation is full. Start a new one below."
          : (d.message ?? "Your message was not sent. Try again."),
      );
    return d;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Support</h1>
          <p className="muted">
            {member ? (
              <>
                Help with your account, payments or the app. For questions about
                your training, <Link href="/app/chat">message your coach</Link>.
              </>
            ) : (
              "Keep account, billing and coaching questions in one conversation."
            )}
          </p>
        </div>
      </div>
      <section className="card" aria-labelledby="support-list">
        <h2 id="support-list">Your conversations</h2>
        {!records.length && (
          <p className="muted">
            You have not asked for help yet. Start a conversation below and the
            support team replies here.
          </p>
        )}
        <ul className="support-list">
          {records.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="support-row"
                aria-current={r.id === selected ? "true" : undefined}
                onClick={() => setSelected(r.id)}
              >
                <strong>{r.data.subject}</strong>
                <span className="muted">
                  {labelFor(SUPPORT_STATUS, r.status)}
                  {r.data.messages?.length
                    ? ` · ${formatWhen(r.data.messages.at(-1).at)}`
                    : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {thread && (
        <section
          className="card"
          ref={threadRef}
          aria-labelledby="support-thread"
        >
          <p className="small-label">
            {labelFor(
              Object.fromEntries(SUPPORT_CATEGORIES),
              thread.data.category,
            )}{" "}
            · {labelFor(SUPPORT_STATUS, thread.status)}
          </p>
          <h2 id="support-thread">{thread.data.subject}</h2>
          <ol className="support-messages">
            {thread.data.messages.map((m: any, i: number) => (
              <li key={i}>
                <p className="chat-meta">
                  <strong>
                    {userId && m.authorId === userId ? "You" : "Support"}
                  </strong>
                  <span>{formatWhen(m.at)}</span>
                </p>
                <p dir="auto">{m.text}</p>
              </li>
            ))}
          </ol>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action(
                () =>
                  post("/" + thread.id + "/reply", {
                    message: f.get("message"),
                    resolve: f.get("resolve") === "on",
                  }),
                "Reply sent",
              );
            }}
          >
            <label className="field">
              <span>Your reply</span>
              <textarea name="message" maxLength={4000} rows={3} required />
            </label>
            <label className="check-field">
              <input name="resolve" type="checkbox" />
              My question is solved
            </label>
            <button className="button" disabled={busy}>
              Send reply
            </button>
          </form>
        </section>
      )}
      <section className="card" aria-labelledby="support-new">
        <h2 id="support-new">Start a conversation</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action(
              () => post("", Object.fromEntries(f)),
              "Sent. The support team replies here.",
            );
          }}
        >
          <label className="field">
            <span>What is it about?</span>
            <select name="category" defaultValue="account">
              {SUPPORT_CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Subject</span>
            <input
              name="subject"
              minLength={3}
              maxLength={150}
              required
              autoComplete="off"
              enterKeyHint="next"
            />
          </label>
          <label className="field">
            <span>How can we help?</span>
            <textarea
              name="message"
              minLength={5}
              maxLength={4000}
              rows={4}
              required
            />
          </label>
          <button className="button" disabled={busy}>
            Send
          </button>
        </form>
      </section>
    </>
  );
}
