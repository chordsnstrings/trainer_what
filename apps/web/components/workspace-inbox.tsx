"use client";
import { useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { WorkspaceScope, useWorkspaceQuery, useWorkspaceValue } from "./workspace-continuity";
import { useSharedInbox } from "./workspace-inbox-store";
import {
  AlertCircle,
  Brain,
  Calendar,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Send,
  X,
} from "lucide-react";
import { formatWhen } from "../lib/format";
import { api, Badge, Card, Empty, type State } from "./workspace-ui";
import { coachSetupOpen } from "./superadmin-access";
import { INBOX_CHANGED, SETUP_HREF } from "./workspace-nav";
import { CoachingMessages } from "./training-workspace";

/**
 * The trainer's home: one inbox of everything waiting on the coach, sorted by
 * urgency (GET /api/v1/trainer/inbox), next to the chat list. Each card acts
 * through the queue's own endpoint; nothing here sends a Brain reply without
 * the coach pressing Approve or writing their own.
 */
type InboxType =
  | "safety"
  | "reply_draft"
  | "question"
  | "support"
  | "chat"
  | "plan_draft"
  | "followup"
  | "booking";
export type InboxItem = {
  id: string;
  type: InboxType;
  urgency: number;
  recordId: string;
  version: number | null;
  clientId: string | null;
  clientName: string | null;
  title: string;
  preview: string;
  draft: string | null;
  createdAt: string;
  actions: string[];
  href: string;
};
export type ChatSummary = {
  clientId: string;
  clientName: string | null;
  lastText: string;
  lastAuthor: string;
  lastAt: string;
  awaitingReply: boolean;
};

const KIND_LABEL: Record<InboxType, string> = {
  safety: "Safety",
  reply_draft: "Reply draft",
  question: "Question",
  support: "Support",
  chat: "Message",
  plan_draft: "Plan",
  followup: "Scheduled message",
  booking: "Booking",
};
const KIND_TONE: Partial<Record<InboxType, string>> = {
  safety: "amber",
};
const KIND_ICON: Record<InboxType, ReactNode> = {
  safety: <AlertCircle size={16} aria-hidden="true" />,
  reply_draft: <Brain size={16} aria-hidden="true" />,
  question: <MessageCircle size={16} aria-hidden="true" />,
  support: <MessageCircle size={16} aria-hidden="true" />,
  chat: <MessageCircle size={16} aria-hidden="true" />,
  plan_draft: <Brain size={16} aria-hidden="true" />,
  followup: <Calendar size={16} aria-hidden="true" />,
  booking: <Calendar size={16} aria-hidden="true" />,
};

const when = (at: string) => formatWhen(at);
const chatHref = (clientId: string | null) =>
  clientId ? `/trainer/messages/${clientId}` : "/trainer/messages";

/** Who wrote a chat message, in plain words for the coach. */
export function authorLabel(author: string) {
  switch (author) {
    case "subscriber":
      return "Client";
    case "trainer":
      return "You";
    case "digital_qualified":
    case "digital":
      return "Your Brain";
    case "digital_reviewed":
      return "Your Brain (you approved)";
    case "system":
      return "Automatic notice";
    default:
      return author.replaceAll("_", " ");
  }
}

type Mode = null | "edit" | "reply" | "reject";

/** One card. Approve and the booking buttons act at once; the others open a
 * short form under the card. A note is asked for only when closing an item
 * without sending anything. */
function InboxCard({
  item,
  onDone,
}: {
  item: InboxItem;
  onDone: (id: string, message: string) => void;
}) {
  const [mode, setMode, clearMode] = useWorkspaceValue<Mode>(`inbox:${item.id}:mode`, null),
    [drafts, setDrafts, clearText] = useWorkspaceValue<Record<string, string>>(`inbox:${item.id}:reply`, {}, true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const text = drafts[mode ?? "reply"] ?? (mode === "edit" ? item.draft ?? "" : "");
  const setText = (value: string) => setDrafts(previous => ({ ...previous, [mode ?? "reply"]: value }));
  const has = (a: string) => item.actions.includes(a);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      clearMode(); clearText();
      onDone(item.id, message);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const open = (next: Mode) => {
    setError("");
    setMode(next);
  };
  const exception = `/exceptions/${item.recordId}/resolve`;
  const approve = () =>
    item.type === "plan_draft"
      ? run(
          () =>
            api(`/brain/plans/${item.recordId}/review`, "POST", {
              action: "approve",
              version: item.version,
            }),
          "Plan approved and sent",
        )
      : run(
          () => api(exception, "POST", { approveDecision: true }),
          "Reply approved and sent",
        );
  const send = () => {
    const body = text.trim();
    if (!body) return;
    if (item.type === "support")
      return run(
        () =>
          api(`/support/${item.recordId}/reply`, "POST", { message: body }),
        "Reply sent",
      );
    if (item.type === "chat")
      return run(
        () =>
          api("/messages", "POST", { text: body, subscriberId: item.clientId }),
        "Message sent",
      );
    return run(
      () => api(exception, "POST", { replyText: body }),
      "Reply sent",
    );
  };
  const reject = () =>
    run(
      () => api(exception, "POST", { note: text.trim() }),
      item.type === "reply_draft" ? "Draft not sent" : "Closed",
    );
  const outcome = (status: "attended" | "no_show") =>
    run(
      () => api(`/bookings/${item.recordId}/outcome`, "POST", { status }),
      status === "attended" ? "Marked as attended" : "Marked as a no-show",
    );
  return (
    <li className={"inbox-card inbox-" + item.type}>
      <div className="inbox-card-head">
        <Badge tone={KIND_TONE[item.type] ?? ""}>
          {KIND_ICON[item.type]} {KIND_LABEL[item.type]}
        </Badge>
        <span className="inbox-client">
          {item.clientId ? (
            <Link href={`/trainer/subscribers/${item.clientId}`}>
              {item.clientName ?? "Client"}
            </Link>
          ) : (
            (item.clientName ?? "")
          )}
        </span>
        <time className="muted" dateTime={item.createdAt}>
          {item.type === "booking" ? when(item.preview) : when(item.createdAt)}
        </time>
      </div>
      <h3>{item.title}</h3>
      {item.preview && item.type !== "booking" && (
        <p className="inbox-preview" dir="auto">
          {item.preview}
        </p>
      )}
      {item.draft && mode !== "edit" && (
        <blockquote className="inbox-draft" dir="auto">
          <small>Your Brain’s draft</small>
          {item.draft}
        </blockquote>
      )}
      {mode && (
        <form
          className="inbox-form"
          onSubmit={(e) => {
            e.preventDefault();
            void (mode === "reject" ? reject() : send());
          }}
        >
          <label>
            <span>
              {mode === "reject"
                ? item.type === "reply_draft"
                  ? "Why not send it? (a short note for your records)"
                  : "Why close it without a reply?"
                : mode === "edit"
                  ? "Your reply"
                  : "Write your reply"}
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={mode === "reject" ? 2 : 4}
              minLength={mode === "reject" ? 3 : 1}
              maxLength={4000}
              required
              autoFocus
              dir="auto"
            />
          </label>
          <div className="button-row">
            <button
              type="submit"
              className="button"
              disabled={busy || text.trim().length < (mode === "reject" ? 3 : 1)}
            >
              {mode === "reject" ? (
                <>
                  <X size={16} /> {item.type === "reply_draft" ? "Don’t send" : "Close"}
                </>
              ) : (
                <>
                  <Send size={16} /> Send
                </>
              )}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setMode(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {!mode && (
        <div className="inbox-actions">
          {has("approve") && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void approve()}
            >
              <Check size={16} /> Approve
            </button>
          )}
          {has("edit_send") && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => open("edit")}
            >
              Edit &amp; send
            </button>
          )}
          {has("reply") && (
            <button
              type="button"
              className={"button" + (has("approve") ? " secondary" : "")}
              disabled={busy}
              onClick={() => open("reply")}
            >
              <Send size={16} /> Reply
            </button>
          )}
          {has("attended") && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void outcome("attended")}
            >
              <Check size={16} /> They came
            </button>
          )}
          {has("no_show") && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void outcome("no_show")}
            >
              No-show
            </button>
          )}
          {has("review") && (
            <Link className="button secondary" href={item.href}>
              {item.type === "safety" ? "Review" : "Open"}{" "}
              <ChevronRight size={16} />
            </Link>
          )}
          {has("open_chat") && item.clientId && (
            <Link className="button secondary" href={chatHref(item.clientId)}>
              <MessageCircle size={16} /> Open chat
            </Link>
          )}
          {has("reject") && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => open("reject")}
            >
              {item.type === "reply_draft" ? "Don’t send" : "Close without reply"}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function useChats() {
  const [chats, setChats] = useState<ChatSummary[] | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setChats((await api("/trainer/chats")).chats);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => clearInterval(timer);
  }, [load]);
  return { chats, error, load };
}

/** Chats, WhatsApp-style: latest first, a dot when the client wrote last. */
export function ChatList({
  chats,
  error,
  current,
  compact = false,
}: {
  chats: ChatSummary[] | null;
  error?: string;
  current?: string;
  compact?: boolean;
}) {
  if (error)
    return (
      <p className="notice error" role="alert">
        {error}
      </p>
    );
  if (!chats) return <p className="muted">Loading chats…</p>;
  if (!chats.length)
    return (
      <Empty
        title="No chats yet"
        detail="When a client messages you, the conversation shows here."
      />
    );
  const shown = compact ? chats.slice(0, 12) : chats;
  return (
    <>
      <ul className="chat-list">
        {shown.map((c) => (
          <li key={c.clientId}>
            <Link
              href={chatHref(c.clientId)}
              className={
                (c.awaitingReply ? "is-unread " : "") +
                (current === c.clientId ? "active" : "")
              }
              aria-current={current === c.clientId ? "page" : undefined}
            >
              <span className="avatar" aria-hidden="true">
                {(c.clientName ?? "?").slice(0, 1)}
              </span>
              <span className="chat-list-main">
                <span className="chat-list-top">
                  <strong>{c.clientName ?? "Client"}</strong>
                  <time dateTime={c.lastAt}>{when(c.lastAt)}</time>
                </span>
                <span className="chat-list-preview" dir="auto">
                  {c.lastAuthor !== "subscriber" && (
                    <span className="muted">{authorLabel(c.lastAuthor)}: </span>
                  )}
                  {c.lastText || "Attachment"}
                </span>
              </span>
              {c.awaitingReply && (
                <span className="unread-dot" aria-label="Waiting for your reply" />
              )}
            </Link>
          </li>
        ))}
      </ul>
      {compact && chats.length > shown.length && (
        <Link className="text-button" href="/trainer/messages">
          All chats <ChevronRight size={14} />
        </Link>
      )}
    </>
  );
}

export function Inbox({ state }: { state: State }) {
  const { items, error, load, setItems } = useSharedInbox(useContext(WorkspaceScope));
  const chats = useChats();
  const [done, setDone] = useState(""),
    [view, setView] = useWorkspaceQuery("view", "todo");
  const onDone = (id: string, message: string) => {
    setItems((list) => list?.filter((i) => i.id !== id) ?? list);
    setDone(message);
    window.dispatchEvent(new Event(INBOX_CHANGED));
    void chats.load();
  };
  const unread = chats.chats?.filter((c) => c.awaitingReply).length ?? 0;
  const setupOpen = coachSetupOpen(state);
  return (
    <div className="trainer-inbox">
      <div className="page-heading">
        <div>
          <h1>Inbox</h1>
          <p className="muted">
            Everything waiting for you, most urgent first.
          </p>
        </div>
      </div>
      {setupOpen && (
        <Link href={SETUP_HREF} className="card trainer-setup-banner">
          <CheckCircle size={20} aria-hidden="true" />
          <span>
            <strong>Finish setting up</strong>
            <small>
              About 15 minutes to your page going live. Your answers are saved
              as you go.
            </small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      )}
      {done && (
        <p className="notice success" role="status">
          <Check size={17} /> {done}
        </p>
      )}
      <div className="inbox-switch" role="tablist" aria-label="Inbox view">
        <button
          type="button"
          role="tab"
          aria-selected={view === "todo"}
          className={view === "todo" ? "active" : ""}
          onClick={() => setView("todo")}
        >
          To do{items?.length ? ` (${items.length})` : ""}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "chats"}
          className={view === "chats" ? "active" : ""}
          onClick={() => setView("chats")}
        >
          Chats{unread ? ` (${unread})` : ""}
        </button>
      </div>
      <div className={"inbox-layout show-" + view}>
        <section className="inbox-todo" aria-label="To do">
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {!items && !error && <p className="muted">Loading your inbox…</p>}
          {items && !items.length && (
            <Card>
              <Empty
                title="You’re all caught up"
                detail="New messages, replies your Brain drafted, plans, safety reports and bookings will show here."
              />
            </Card>
          )}
          {!!items?.length && (
            <ul className="inbox-list">
              {items.map((item) => (
                <InboxCard key={item.id} item={item} onDone={onDone} />
              ))}
            </ul>
          )}
        </section>
        <aside className="inbox-chats card" aria-label="Chats">
          <div className="card-heading">
            <h2>Chats</h2>
            <Link className="text-button" href="/trainer/messages">
              See all
            </Link>
          </div>
          <ChatList chats={chats.chats} error={chats.error} compact />
        </aside>
      </div>
    </div>
  );
}

/** /trainer/messages: every chat. */
export function Chats() {
  const { chats, error } = useChats();
  return (
    <div className="trainer-chats">
      <div className="page-heading">
        <div>
          <h1>Chats</h1>
          <p className="muted">
            A dot means the client wrote last and is waiting for you.
          </p>
        </div>
        <Link className="button secondary" href="/trainer/subscribers">
          Message a client
        </Link>
      </div>
      <Card>
        <ChatList chats={chats} error={error} />
      </Card>
    </div>
  );
}

/** /trainer/messages/:clientId: one conversation. */
export function ChatThread({
  state,
  clientId,
}: {
  state: State;
  clientId: string;
}) {
  const { chats } = useChats();
  const name =
    chats?.find((c) => c.clientId === clientId)?.clientName ??
    state.members?.find((m) => m.id === clientId)?.name ??
    null;
  return (
    <div className="chat-thread-page">
      <div className="chat-thread-head">
        <Link href="/trainer/messages" className="text-button">
          <ChevronLeft size={16} /> All chats
        </Link>
        <Link href={`/trainer/subscribers/${clientId}`} className="text-button">
          Client page <ChevronRight size={16} />
        </Link>
      </div>
      <CoachingMessages
        key={clientId}
        state={state}
        subscriberId={clientId}
        clientName={name ?? undefined}
      />
    </div>
  );
}
