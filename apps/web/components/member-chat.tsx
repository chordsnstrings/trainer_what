"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Send } from "lucide-react";
import {
  ChatAttachmentList,
  ChatAttachmentPicker,
  type ChatAttachment,
} from "./chat-attachments";
import { BottomSheet, StickyActionBar } from "./phone-ui";
import { formatWhen, plural } from "../lib/format";

/**
 * Coach chat for the member, phone first (docs/features/member-screens.md):
 * the conversation as bubbles with the coach's name and "You", times
 * without seconds, a readable empty state with prompts, and the composer
 * pinned at the bottom above the tab bar (and on the keyboard while
 * typing). Attachments open in a bottom sheet. The coach's side stays
 * CoachingMessages in training-workspace.tsx.
 */
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(d.message ?? "Something went wrong"), {
      code: d.code,
      status: r.status,
    });
  return d;
}

/** Who wrote a message, in words: the coach's name, "You", "Digital coach". */
export function senderName(author: string | undefined, coachName: string) {
  if (author === "subscriber") return "You";
  if (author === "digital_qualified") return "Digital coach";
  if (author === "system") return "Update";
  return coachName;
}

export const CHAT_PROMPTS = [
  "How should I warm up before my session?",
  "Can we adjust my plan for a busy week?",
  "What should I focus on this week?",
];

export function MemberChat({ state }: { state: any }) {
  const userId: string = state.user.userId;
  const coach: string = state.tenant.name;
  const coachFirst = coach.split(" ")[0];
  const [messages, setMessages] = useState<any[]>([]),
    [loaded, setLoaded] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [personal, setPersonal] = useState(false),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [attachments, setAttachments] = useState<ChatAttachment[]>([]),
    [uploading, setUploading] = useState(false),
    [attachOpen, setAttachOpen] = useState(false),
    [composerKey, setComposerKey] = useState(0);
  const end = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    seenLatest = useRef("");
  const load = useCallback(async (before?: string) => {
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
  }, []);
  useEffect(() => {
    void load().catch(() =>
      setError("Messages could not be loaded. Check your connection."),
    );
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [load]);
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
    if (busy || uploading || (digital && attachments.length)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api(
        digital ? "/coaching/ask" : "/messages",
        "POST",
        digital
          ? { message: text }
          : {
              text,
              subscriberId: userId,
              attachmentIds: attachments.map((file) => file.id),
            },
      );
      setText("");
      setAttachments([]);
      setComposerKey((v) => v + 1);
      if (result.pendingReview)
        setNotice(
          result.message ??
            `${coachFirst} will answer this personally. You will see the reply here.`,
        );
      await load();
    } catch (e: any) {
      setError(
        e.status === 429
          ? "You have sent a lot of messages in a short time. Wait a moment, then try again."
          : "Your message was not sent. Check your connection and try again; your text is still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  const canSend =
    !busy && !uploading && (!!text.trim() || attachments.length > 0);
  return (
    <div className="member-chat">
      <header className="member-chat-intro">
        <h1 className="sr-only">Coach chat</h1>
        <p className="muted">
          Messages with {coach}. Replies from the digital coach are labelled.
        </p>
      </header>
      {personal && (
        <p className="notice" role="status">
          {coachFirst} is answering you personally for now.
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <section className="chat-thread" aria-label="Conversation">
        {hasMore && messages.length > 0 && (
          <button
            type="button"
            className="text-button chat-earlier"
            onClick={() =>
              void load(messages[0].id).catch(() =>
                setError("Earlier messages could not be loaded."),
              )
            }
          >
            Load earlier messages
          </button>
        )}
        {!loaded && !error && (
          <p className="muted" aria-busy="true">
            Loading your messages…
          </p>
        )}
        {loaded && !messages.length && (
          <div className="chat-empty">
            <h2>Start a conversation with {coachFirst}</h2>
            <p className="muted">
              Ask about your plan, share how a session felt, or tell{" "}
              {coachFirst} what is coming up this week. Tap an idea to start.
            </p>
            <div className="chat-prompts">
              {CHAT_PROMPTS.map((prompt) => (
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
                  (m.data.author === "digital_qualified" ? " is-digital" : "")
                }
              >
                <p className="chat-meta">
                  <strong>{senderName(m.data.author, coach)}</strong>
                  <span>
                    {m.data.scheduled ? "Scheduled · " : ""}
                    {formatWhen(m.created_at)}
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
        </ol>
        <div ref={end} />
      </section>
      <StickyActionBar
        label="Write a message"
        note={
          attachments.length
            ? `${plural(attachments.length, "file")} attached for ${coachFirst}. The digital coach does not read attachments.`
            : undefined
        }
      >
        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(false);
          }}
        >
          <label className="sr-only" htmlFor="chat-message">
            Your message
          </label>
          <textarea
            id="chat-message"
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            rows={Math.min(4, Math.max(1, text.split("\n").length))}
            placeholder={`Message ${coachFirst}`}
            enterKeyHint="send"
            autoComplete="off"
          />
          <div className="chat-composer-actions">
            <button
              type="button"
              className="icon-button chat-attach"
              aria-label={
                attachments.length
                  ? `Photos and PDFs, ${attachments.length} attached`
                  : "Attach photos or PDFs"
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
              className="button secondary"
              disabled={
                !text.trim() || busy || uploading || attachments.length > 0
              }
              onClick={() => void send(true)}
            >
              Ask digital coach
            </button>
            <button type="submit" className="button" disabled={!canSend}>
              <Send size={16} aria-hidden="true" />
              Send to {coachFirst}
            </button>
          </div>
        </form>
      </StickyActionBar>
      <BottomSheet
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        title="Photos and PDFs"
        description={`They go to ${coachFirst} with your next message.`}
        footer={
          <button
            type="button"
            className="button"
            disabled={uploading}
            onClick={() => setAttachOpen(false)}
          >
            {uploading ? "Preparing…" : "Done"}
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
