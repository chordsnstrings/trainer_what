"use client";
import { useLocale, useT } from "../lib/i18n/react";
import { formatDateTime } from "../lib/format";
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
  const t = useT("support"),
    locale = useLocale();
  const thread = records.find((r) => r.id === selected);
  const status = (value: string) =>
    ["open", "waiting", "answered", "pending", "resolved", "closed"].includes(
      value,
    )
      ? t(`status_${value}` as "status_open")
      : value.replaceAll("_", " ");
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
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p className="muted">{t("intro")}</p>
        </div>
      </div>
      <section className="card">
        <h2>{t("start")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action(
              () => post("", Object.fromEntries(f)),
              t("saved"),
            );
          }}
        >
          <label className="field">
            <span>{t("subject")}</span>
            <input name="subject" minLength={3} required />
          </label>
          <label className="field">
            <span>{t("category")}</span>
            <select name="category">
              {(
                ["account", "billing", "coaching", "technical", "privacy"] as const
              ).map((c) => (
                <option key={c} value={c}>
                  {t(`category_${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("help")}</span>
            <textarea name="message" minLength={5} maxLength={4000} required />
          </label>
          <button className="button" disabled={busy}>
            {t("send")}
          </button>
        </form>
      </section>
      <section className="card">
        <h2>{t("yours")}</h2>
        {records.map((r) => (
          <button
            className="list-row text-button"
            key={r.id}
            onClick={() => setSelected(r.id)}
          >
            <bdi>{r.data.subject}</bdi> · {status(r.status)}
          </button>
        ))}
        {!records.length && <p className="muted">{t("empty")}</p>}
      </section>
      {thread && (
        <section className="card">
          <h2 dir="auto">{thread.data.subject}</h2>
          {thread.data.messages.map((m: any, i: number) => (
            <div className="notice" key={i}>
              <p dir="auto">{m.text}</p>
              <small>{formatDateTime(m.at, { locale })}</small>
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
                t("replySaved"),
              );
            }}
          >
            <label className="field">
              <span>{t("reply")}</span>
              <textarea name="message" maxLength={4000} required />
            </label>
            <label className="check-field">
              <input name="resolve" type="checkbox" />
              {t("resolve")}
            </label>
            <button className="button" disabled={busy}>
              {t("sendReply")}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
