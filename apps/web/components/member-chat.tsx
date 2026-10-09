"use client";
import { memberApiUrl } from "../lib/trainer-preview-routing";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { previewChanged } from "./trainer-preview";
import { OnboardingCall } from "./onboarding-call";
import { Paperclip, Send, Phone } from "lucide-react";
import {
  ChatAttachmentList,
  ChatAttachmentPicker,
  type ChatAttachment,
} from "./chat-attachments";
import { BottomSheet, Skeleton, StickyActionBar } from "./phone-ui";
import { MOTION } from "./motion";
import { unsavedMark } from "./pwa";
import { formatWhen } from "../lib/format";
import { translator, type Locale } from "../lib/i18n/core";
import chatMessages from "../lib/i18n/messages/chat";
import { useLocale, useT } from "../lib/i18n/react";
import { fetchWithin, ACCOUNT_READ_TIMEOUT_MS } from "./account-request";
import { useWorkspaceValue } from "./workspace-continuity";

/**
 * Coach chat for the member, phone first (docs/features/member-screens.md):
 * the conversation as bubbles with the coach's name and "You", times
 * without seconds, a readable empty state with prompts, and the composer
 * pinned at the bottom above the tab bar (and on the keyboard while
 * typing). Attachments open in a bottom sheet. The coach's side stays
 * CoachingMessages in training-workspace.tsx.
 *
 * In the member's language (docs/features/arabic.md). Motion
 * (docs/features/motion.md "h"): the first load is a skeleton; a message on
 * its way shows at once, faded and marked "Sending"; the digital coach shows
 * typing dots while it prepares a reply; messages that arrive later slide
 * in; the send button scales in when there is something to send.
 */
async function api(path: string, method = "GET", body?: unknown) {
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const r = method === "GET"
    ? await fetchWithin(memberApiUrl("/api/v1" + path), init, ACCOUNT_READ_TIMEOUT_MS)
    : await fetch(memberApiUrl("/api/v1" + path), init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(d.message ?? "Something went wrong"), {
      code: d.code,
      status: r.status,
    });
  return d;
}

/** Who wrote a message, in words: the coach's name, "You", "Digital coach". */
export function senderName(
  author: string | undefined,
  coachName: string,
  locale: Locale = "en",
) {
  const t = translator(chatMessages, locale);
  if (author === "subscriber") return t("you");
  if (author === "digital_qualified") return t("digital");
  if (author === "system") return t("update");
  return coachName;
}

const PROMPT_KEYS = ["prompt1", "prompt2", "prompt3"] as const;
/** Ideas that start a first conversation, in the member's language. */
export function chatPrompts(locale: Locale = "en") {
  const t = translator(chatMessages, locale);
  return PROMPT_KEYS.map((key) => t(key));
}
export const CHAT_PROMPTS = chatPrompts();

export function MemberChat({ state }: { state: any }) {
  const t = useT("chat"),
    common = useT("common"),
    locale = useLocale();
  const [callOpen, setCallOpen] = useState(false), [callActive, setCallActive] = useState(false);
  const userId: string = state.user.userId;
  const coach: string = state.tenant.name;
  const coachFirst = coach.split(" ")[0];
  const [messages, setMessages] = useState<any[]>([]),
    [loaded, setLoaded] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [personal, setPersonal] = useState(false),
    [readError, setReadError] = useState(false),
    [reading, setReading] = useState(false),
    [uploading, setUploading] = useState(false),
    [attachOpen, setAttachOpen] = useState(false),
    [composerKey, setComposerKey] = useState(0),
    [fresh, setFresh] = useState<string[]>([]);
  const [text, setText] = useWorkspaceValue("member-chat-text", "", true);
  const [attachments, setAttachments] = useWorkspaceValue<ChatAttachment[]>("member-chat-files", [], true);
  // Pending requests survive route changes in memory, never a browser restart.
  const [busy, setBusy] = useWorkspaceValue("member-chat-busy", false);
  const [error, setError] = useWorkspaceValue("member-chat-error", "");
  const [notice, setNotice] = useWorkspaceValue("member-chat-notice", "");
  const [sending, setSending] = useWorkspaceValue<{ text: string; digital: boolean } | null>("member-chat-sending", null);
  const end = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    seenLatest = useRef(""),
    known = useRef<{ ids: Set<string>; latest: number } | null>(null),
    sentText = useRef("");
  const load = useCallback(async (before?: string) => {
    setReading(true);
    try {
      const result = await api(
        "/messages/thread" + (before ? "?before=" + before : ""),
      );
      setMessages((old) =>
        before
          ? [...result.messages, ...old]
          : [
              ...old.filter(
                (m) => !result.messages.some((r: any) => r.id === m.id),
              ),
              ...result.messages,
            ].sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime(),
            ),
      );
      if (before || !seenLatest.current) setHasMore(result.hasMore);
      setPersonal(!!result.personalReview);
      setLoaded(true);
      if (!before) setReadError(false);
    } finally { setReading(false); }
  }, []);
  const refresh = useCallback(() => load().catch(() => setReadError(true)), [load]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 8000);
    return () => clearInterval(timer);
    // `t` changes only with the language; the thread is the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);
  // Messages newer than any seen before slide in: not the first load, not
  // older pages, not the member's own message just shown as sending.
  useLayoutEffect(() => {
    if (!loaded) return;
    const time = (m: any) => new Date(m.created_at).getTime();
    if (!known.current) {
      known.current = {
        ids: new Set(messages.map((m) => m.id)),
        latest: Math.max(0, ...messages.map(time)),
      };
      return;
    }
    const seen = known.current;
    const added = messages.filter((m) => !seen.ids.has(m.id));
    for (const m of added) {
      seen.ids.add(m.id);
      seen.latest = Math.max(seen.latest, time(m));
    }
    const arriving = added
      .filter(
        (m) =>
          !(m.data?.author === "subscriber" && m.data?.text === sentText.current),
      )
      .filter((m) => time(m) >= seen.latest - 60000)
      .map((m) => m.id);
    if (!arriving.length) return;
    setFresh(arriving);
    const done = window.setTimeout(() => setFresh([]), MOTION.base + 100);
    return () => window.clearTimeout(done);
  }, [messages, loaded]);
  // The newest message stays in view when one arrives.
  const latest = messages.at(-1)?.id ?? "";
  useEffect(() => {
    if (!latest || latest === seenLatest.current) return;
    const first = !seenLatest.current;
    seenLatest.current = latest;
    end.current?.scrollIntoView({
      block: "end",
      behavior: first ? "auto" : "smooth",
    });
  }, [latest]);
  async function send(digital: boolean) {
    if (callActive || busy || uploading || (!text.trim() && !attachments.length) || (digital && attachments.length)) return;
    setBusy(true);
    setError("");
    setNotice("");
    const draft = text;
    sentText.current = draft.trim();
    setSending({ text: draft.trim(), digital });
    // Hide the draft while sending, but retain it until the POST succeeds.
    try {
      const result = await api(
        digital ? "/coaching/ask" : "/messages",
        "POST",
        digital
          ? { message: draft }
          : {
              text: draft,
              subscriberId: userId,
              attachmentIds: attachments.map((file) => file.id),
            },
      );
      setText((current) => current === draft ? "" : current);
      setAttachments((current) => current.filter(file => !attachments.some(sent => sent.id === file.id)));
      setComposerKey((v) => v + 1);
      // The server's own sentence is English; other languages get ours.
      if (result.pendingReview)
        setNotice(
          (locale === "en" && result.message) ||
            t("pending", { coach: coachFirst }),
        );
      // A failed refresh must never turn a committed send into a retry.
      await refresh();
      if (state.trainerPreview) previewChanged();
    } catch (e: any) {
      setError(e.status === 429 ? t("tooMany") : t("notSent"));
    } finally {
      setBusy(false);
      setSending(null);
    }
  }
  useEffect(() => {
    if (!state.trainerPreview) return;
    const update = () => void refresh();
    window.addEventListener("trainer-preview-changed", update);
    return () => window.removeEventListener("trainer-preview-changed", update);
  }, [state.trainerPreview, refresh]);
  const canSend =
    !callActive && !busy && !uploading && (!!text.trim() || attachments.length > 0);
  return (
    <div className="member-chat">
      <header className="member-chat-intro">
        <h1 className="sr-only">{t("title")}</h1>
        <p className="muted">{state.trainerPreview ? t("previewIntro") : t("intro", { coach })}</p>
        <button type="button" className="button secondary button-small" disabled={busy} onClick={() => setCallOpen(true)}><Phone size={16} />{t(callActive ? "returnToCall" : "talkToCoach")}</button>
      </header>
      <OnboardingCall audience="member" mode="setup" purpose="coaching" coachName={coach} open={callOpen} onOpenChange={setCallOpen} onActiveChange={setCallActive} onConversation={() => { void refresh(); if (state.trainerPreview) previewChanged(); }} />
      {personal && (
        <p className="notice" role="status">
          {t("personal", { coach: coachFirst })}
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {readError && (
        <div className="notice error" role="alert">
          <p>{t("loadFailed")}</p>
          <button type="button" className="button secondary" disabled={reading} onClick={() => void refresh()}>
            {reading ? common("loading") : common("retry")}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <section className="chat-thread" aria-label={t("conversation")}>
        {hasMore && messages.length > 0 && (
          <button
            type="button"
            className="text-button chat-earlier"
            disabled={reading}
            onClick={() =>
              void load(messages[0].id).catch(() =>
                setError(t("earlierFailed")),
              )
            }
          >
            {t("loadEarlier")}
          </button>
        )}
        {!loaded && !readError && <Skeleton label={t("loading")} lines={4} />}
        {loaded && !messages.length && !sending && (
          <div className="chat-empty">
            <h2>{t("emptyTitle", { coach: coachFirst })}</h2>
            <p className="muted">{t("emptyText", { coach: coachFirst })}</p>
            <div className="chat-prompts">
              {chatPrompts(locale).map((prompt) => (
                <button
                  type="button"
                  className="button secondary"
                  key={prompt}
                  onClick={() => {
                    setText(prompt);
                    input.current?.focus();
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        <ol className="chat-messages" aria-live="polite">
          {messages.map((m) => {
            const mine = m.data.author === "subscriber";
            return (
              <li
                key={m.id}
                className={
                  "chat-message" +
                  (mine ? " is-mine" : "") +
                  (m.data.author === "digital_qualified" ? " is-digital" : "") +
                  (fresh.includes(m.id) ? " is-new" : "")
                }
              >
                <p className="chat-meta">
                  <strong dir="auto">
                    {senderName(m.data.author, coach, locale)}
                  </strong>
                  <span>
                    {m.data.scheduled
                      ? t("scheduled", {
                          when: formatWhen(m.created_at, { locale }),
                        })
                      : formatWhen(m.created_at, { locale })}
                  </span>
                </p>
                {m.data.text && (
                  <p className="chat-text" dir="auto">
                    {m.data.text}
                  </p>
                )}
                <ChatAttachmentList
                  files={m.data.attachments ?? []}
                  user={state.user}
                  onRemove={(id) =>
                    setMessages((old) =>
                      old.map((message) =>
                        message.id === m.id
                          ? {
                              ...message,
                              data: {
                                ...message.data,
                                attachments: message.data.attachments.filter(
                                  (file: ChatAttachment) => file.id !== id,
                                ),
                              },
                            }
                          : message,
                      ),
                    )
                  }
                />
              </li>
            );
          })}
          {/* The member's message on its way: shown at once, faded. */}
          {sending &&
            !messages.some(
              (m) =>
                m.data?.author === "subscriber" &&
                m.data?.text === sending.text &&
                Date.now() - new Date(m.created_at).getTime() < 120000,
            ) && (
              <li
                className="chat-message is-mine is-new is-sending"
                aria-live="off"
              >
                <p className="chat-meta">
                  <strong>{t("you")}</strong>
                  <span className="chat-sending">{t("sending")}</span>
                </p>
                <p className="chat-text" dir="auto">
                  {sending.text}
                </p>
              </li>
            )}
        </ol>
        {sending?.digital && (
          <p className="chat-typing" role="status">
            <span className="chat-typing-dots" aria-hidden="true">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </span>
            {t("typing")}
          </p>
        )}
        <div ref={end} />
      </section>
      <StickyActionBar
        label={t("composer")}
        note={
          attachments.length
            ? t("attachedNote", {
                count: attachments.length,
                coach: coachFirst,
              })
            : undefined
        }
      >
        <form
          className="chat-composer"
          {...unsavedMark(!!text.trim() || attachments.length > 0)}
          onSubmit={(event) => {
            event.preventDefault();
            void send(false);
          }}
        >
          <label className="sr-only" htmlFor="chat-message">
            {t("yourMessage")}
          </label>
          <textarea
            id="chat-message"
            ref={input}
            value={busy ? "" : text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            rows={Math.min(4, Math.max(1, text.split("\n").length))}
            placeholder={t("placeholder", { coach: coachFirst })}
            enterKeyHint="send"
            autoComplete="off"
          />
          <div className="chat-composer-actions">
            <button
              type="button"
              className="icon-button chat-attach"
              aria-label={
                attachments.length
                  ? t("attachCount", { count: attachments.length })
                  : t("attach")
              }
              disabled={busy}
              onClick={() => setAttachOpen(true)}
            >
              <Paperclip size={20} aria-hidden="true" />
              {attachments.length > 0 && (
                <span className="chat-attach-count" aria-hidden="true">
                  {attachments.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className="button secondary chat-send"
              disabled={
                !text.trim() || callActive || busy || uploading || attachments.length > 0
              }
              onClick={() => void send(true)}
            >
              {t("askDigital")}
            </button>
            <button
              type="submit"
              className="button chat-send"
              disabled={!canSend}
            >
              <Send size={16} aria-hidden="true" />
              {/* Short on a phone; the full name is the accessible name. */}
              <span aria-hidden="true">{t("sendShort")}</span>
              <span className="sr-only">{t("sendTo", { coach: coachFirst })}</span>
            </button>
          </div>
        </form>
      </StickyActionBar>
      <BottomSheet
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        title={t("sheetTitle")}
        description={t("sheetDescription", { coach: coachFirst })}
        footer={
          <button
            type="button"
            className="button"
            disabled={uploading}
            onClick={() => setAttachOpen(false)}
          >
            {uploading ? t("preparing") : t("done")}
          </button>
        }
      >
        <ChatAttachmentPicker
          key={composerKey}
          subjectId={userId}
          files={attachments}
          user={state.user}
          onChange={setAttachments}
          onBusy={setUploading}
          disabled={busy}
        />
      </BottomSheet>
    </div>
  );
}
