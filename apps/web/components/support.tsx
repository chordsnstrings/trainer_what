"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatWhen, humanize } from "../lib/format";
import { translator, type Locale } from "../lib/i18n/core";
import supportMessages from "../lib/i18n/messages/support";
import { Rich, useLocale, useT } from "../lib/i18n/react";

const CATEGORY_KEYS = [
  "account",
  "billing",
  "coaching",
  "technical",
  "privacy",
] as const;
const STATUS_KEYS = [
  "open",
  "waiting",
  "answered",
  "pending",
  "resolved",
  "closed",
] as const;
/** Support topics in words, in the reader's language; the stored value stays the API's key. */
export function supportCategories(locale: Locale = "en"): Array<[string, string]> {
  const t = translator(supportMessages, locale);
  return CATEGORY_KEYS.map((key) => [key, t(`category_${key}`)]);
}
/** A conversation's status in words (the key itself if it is new). */
export function supportStatus(status: string, locale: Locale = "en") {
  const t = translator(supportMessages, locale);
  return (STATUS_KEYS as readonly string[]).includes(status)
    ? t(`status_${status as (typeof STATUS_KEYS)[number]}`)
    : humanize(status);
}
/** The English words, for callers that read the maps. */
export const SUPPORT_CATEGORIES = supportCategories();
export const SUPPORT_STATUS: Record<string, string> = Object.fromEntries(
  STATUS_KEYS.map((key) => [key, supportStatus(key)]),
);

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
  const t = useT("support"),
    locale = useLocale();
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
    // The status and code travel with the error, so it reads in the
    // member's language (lib/i18n/errors.ts).
    if (!r.ok)
      throw r.status === 409
        ? Object.assign(new Error(t("errFull")), {
            status: r.status,
            code: "SUPPORT_THREAD_FULL",
          })
        : Object.assign(new Error(d.message ?? t("errNotSent")), {
            status: r.status,
            code: d.code,
          });
    return d;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">
            {member ? (
              <Rich
                t={t}
                k="memberIntro"
                tags={{ a: (s) => <Link href="/app/chat">{s}</Link> }}
              />
            ) : (
              t("intro")
            )}
          </p>
        </div>
      </div>
      <section className="card" aria-labelledby="support-list">
        <h2 id="support-list">{t("yours")}</h2>
        {!records.length && <p className="muted">{t("empty")}</p>}
        <ul className="support-list">
          {records.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="support-row"
                aria-current={r.id === selected ? "true" : undefined}
                onClick={() => setSelected(r.id)}
              >
                <strong dir="auto">{r.data.subject}</strong>
                <span className="muted">
                  {supportStatus(r.status, locale)}
                  {r.data.messages?.length
                    ? ` · ${formatWhen(r.data.messages.at(-1).at, { locale })}`
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
            {Object.fromEntries(supportCategories(locale))[
              thread.data.category
            ] ?? thread.data.category}{" "}
            · {supportStatus(thread.status, locale)}
          </p>
          <h2 id="support-thread" dir="auto">
            {thread.data.subject}
          </h2>
          <ol className="support-messages">
            {thread.data.messages.map((m: any, i: number) => (
              <li key={i}>
                <p className="chat-meta">
                  <strong>
                    {userId && m.authorId === userId
                      ? t("you")
                      : t("supportTeam")}
                  </strong>
                  <span>{formatWhen(m.at, { locale })}</span>
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
                t("replySaved"),
              );
            }}
          >
            <label className="field">
              <span>{t("reply")}</span>
              <textarea name="message" maxLength={4000} rows={3} required />
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
      <section className="card" aria-labelledby="support-new">
        <h2 id="support-new">{t("start")}</h2>
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
            <span>{t("about")}</span>
            <select name="category" defaultValue="account">
              {supportCategories(locale).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("subject")}</span>
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
            <span>{t("help")}</span>
            <textarea
              name="message"
              minLength={5}
              maxLength={4000}
              rows={4}
              required
            />
          </label>
          <button className="button" disabled={busy}>
            {t("send")}
          </button>
        </form>
      </section>
    </>
  );
}
