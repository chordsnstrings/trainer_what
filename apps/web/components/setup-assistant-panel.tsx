"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, X, RotateCcw } from "lucide-react";
import { setupApi } from "./setup-wizard-api";
import type { ChatStep } from "./setup-wizard-model";

/**
 * The setup assistant beside a wizard step (docs/features/setup-wizard.md):
 * a compact chat panel next to the short form on a laptop, a full-screen
 * sheet on a phone. It only drafts. About, page and plan drafts are copied
 * into the step's form for the coach to check and save; Brain drafts become
 * draft rules the coach still approves.
 */
type Turn = { id: string; from: "assistant" | "coach"; text: string };
type StepView = {
  version: number;
  turns: Turn[];
  nextQuestion: { key: string; text: string };
  done: boolean;
  draft: Record<string, unknown>;
  missing: string[];
  dropped: Array<{ field: string; reason: string }>;
  applied: Record<string, unknown>;
};

const FIELD_WORDS: Record<string, string> = {
  publicName: "Your name",
  businessName: "Business name",
  specialty: "Specialty",
  audience: "Who you coach",
  city: "Where you coach",
  headline: "Headline",
  bio: "About you",
  name: "Plan name",
  description: "Plan description",
  priceAed: "Price (AED)",
  billing: "Billing",
  programmeDays: "Programme length (days)",
  maxSessionMinutes: "Longest session (minutes)",
  maxLoadJumpPct: "Biggest load jump (%)",
  maxWeeklyVolumeIncreasePct: "Weekly volume increase (%)",
};
const fieldWord = (key: string) =>
  FIELD_WORDS[key] ??
  key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const shown = (value: unknown) =>
  Array.isArray(value)
    ? value.join("; ")
    : typeof value === "object" && value
      ? JSON.stringify(value)
      : String(value);

export function AssistantPanel({
  step,
  open,
  onClose,
  onUseDraft,
  onTaught,
}: {
  step: ChatStep;
  open: boolean;
  onClose: () => void;
  /** About, page and plan: copy the draft into the form. */
  onUseDraft?: (draft: Record<string, unknown>) => void;
  /** Brain: new draft rules or limits were saved. */
  onTaught?: () => void;
}) {
  const [view, setView] = useState<StepView | null>(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const load = useCallback(async () => {
    try {
      const all = await setupApi("/setup-assistant");
      setView(all.steps[step]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [step]);
  useEffect(() => {
    if (open && !view) void load();
  }, [open, view, load]);
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [view?.turns.length, busy]);
  if (!open) return null;
  const send = async (message: string) => {
    if (!view || !message.trim()) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const next = await setupApi(`/setup-assistant/${step}/messages`, "POST", {
        text: message.trim(),
        version: view.version,
      });
      setView(next);
      setText("");
    } catch (e) {
      const err = e as Error & { code?: string };
      setError(
        err.code === "SETUP_CHANGED"
          ? "This chat changed in another window. It has been reloaded."
          : err.message,
      );
      if (err.code === "SETUP_CHANGED") await load();
    } finally {
      setBusy(false);
    }
  };
  const apply = async (target: "compile" | "limits") => {
    if (!view) return;
    setBusy(true);
    setError("");
    try {
      const out = await setupApi(`/setup-assistant/${step}/apply`, "POST", {
        target,
        version: view.version,
      });
      setView(out.step);
      setNote(
        target === "compile"
          ? "Draft rules are ready in the list. Nothing is used until you approve them."
          : "Your limits are saved. The rest keep the safe defaults.",
      );
      onTaught?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const restart = async () => {
    if (!view || !window.confirm("Start this chat again? Your saved answers stay.")) return;
    setBusy(true);
    try {
      await setupApi(`/setup-assistant/${step}/restart`, "POST", {
        version: view.version,
      });
      setView(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const draft = Object.entries(view?.draft ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  const lastCoach = view?.turns.at(-1)?.from === "coach";
  const limits = draft.some(([k]) => k.startsWith("max"));
  return (
    <section
      className="setup-chat"
      aria-label="Chat with the setup assistant"
      data-fixed-ui
    >
      <header className="setup-chat-head">
        <strong>Setup assistant</strong>
        <span className="muted">It drafts. You decide.</span>
        <button
          type="button"
          className="icon-button"
          onClick={() => void restart()}
          disabled={busy || !view?.turns.length}
          aria-label="Start this chat again"
          title="Start this chat again"
        >
          <RotateCcw size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close the chat"
        >
          <X size={16} />
        </button>
      </header>
      <ol className="setup-chat-turns" ref={list} aria-live="polite">
        {view?.turns.map((t) => (
          <li key={t.id} className={`setup-bubble from-${t.from}`}>
            {t.text}
          </li>
        ))}
        {view && !busy && !lastCoach && (
          <li className="setup-bubble from-assistant">{view.nextQuestion.text}</li>
        )}
        {busy && (
          <li className="setup-bubble from-assistant is-typing">Thinking…</li>
        )}
        {!view && !error && <li className="muted">Loading…</li>}
      </ol>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="notice success" role="status">
          {note}
        </p>
      )}
      {draft.length > 0 && (
        <div className="setup-chat-draft">
          <p className="eyebrow">Draft so far</p>
          <dl>
            {draft.map(([k, v]) => (
              <div key={k}>
                <dt>{fieldWord(k)}</dt>
                <dd>{shown(v)}</dd>
              </div>
            ))}
          </dl>
          {view!.dropped.length > 0 && (
            <p className="muted">
              Left out to keep your page safe: {view!.dropped.map((d) => fieldWord(d.field)).join(", ")}.
            </p>
          )}
          <div className="button-row">
            {step === "brain" ? (
              <>
                <button
                  type="button"
                  className="button"
                  disabled={busy || !view!.turns.some((t) => t.from === "coach")}
                  onClick={() => void apply("compile")}
                >
                  Draft my rules from this chat
                </button>
                {limits && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void apply("limits")}
                  >
                    Save my limits
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  onUseDraft?.(view!.draft);
                  setNote("Copied into the form. Check it, then save.");
                }}
              >
                Put this in the form
              </button>
            )}
          </div>
        </div>
      )}
      <form
        className="setup-chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label className="sr-only" htmlFor={`setup-chat-${step}`}>
          Your answer
        </label>
        <textarea
          id={`setup-chat-${step}`}
          rows={2}
          value={text}
          maxLength={4000}
          placeholder="Type your answer"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          disabled={busy || !view}
        />
        <div className="button-row">
          <button
            type="button"
            className="button secondary"
            disabled={busy || !view}
            onClick={() => void send("skip")}
          >
            Skip this question
          </button>
          <button className="button" disabled={busy || !view || !text.trim()}>
            <Send size={15} /> Send
          </button>
        </div>
      </form>
    </section>
  );
}
