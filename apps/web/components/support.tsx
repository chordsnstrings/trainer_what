"use client";
import { useState } from "react";
export function Support({
  records,
  action,
  busy,
}: {
  records: any[];
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
  busy: boolean;
}) {
  const [selected, setSelected] = useState("");
  const thread = records.find((r) => r.id === selected);
  async function post(path: string, body: unknown) {
    const r = await fetch("/api/v1/support" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    return d;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">WE’RE HERE TO HELP</p>
          <h1>A clear path to support.</h1>
          <p className="muted">
            Keep account, billing and coaching questions in one conversation.
          </p>
        </div>
      </div>
      <section className="card">
        <h2>Start a conversation</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action(
              () => post("", Object.fromEntries(f)),
              "Support request saved",
            );
          }}
        >
          <label className="field">
            <span>Subject</span>
            <input name="subject" minLength={3} required />
          </label>
          <label className="field">
            <span>Category</span>
            <select name="category">
              {["account", "billing", "coaching", "technical", "privacy"].map(
                (c) => (
                  <option key={c}>{c}</option>
                ),
              )}
            </select>
          </label>
          <label className="field">
            <span>How can we help?</span>
            <textarea name="message" minLength={5} maxLength={4000} required />
          </label>
          <button className="button" disabled={busy}>
            Send request
          </button>
        </form>
      </section>
      <section className="card">
        <h2>Your conversations</h2>
        {records.map((r) => (
          <button
            className="list-row text-button"
            key={r.id}
            onClick={() => setSelected(r.id)}
          >
            {r.data.subject} · {r.status}
          </button>
        ))}
        {!records.length && (
          <p className="muted">Your support conversations will appear here.</p>
        )}
      </section>
      {thread && (
        <section className="card">
          <h2>{thread.data.subject}</h2>
          {thread.data.messages.map((m: any, i: number) => (
            <div className="notice" key={i}>
              <p>{m.text}</p>
              <small>{new Date(m.at).toLocaleString()}</small>
            </div>
          ))}
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
                "Reply saved",
              );
            }}
          >
            <label className="field">
              <span>Reply</span>
              <textarea name="message" maxLength={4000} required />
            </label>
            <label className="check-field">
              <input name="resolve" type="checkbox" />
              Resolve this conversation
            </label>
            <button className="button" disabled={busy}>
              Send reply
            </button>
          </form>
        </section>
      )}
    </>
  );
}
