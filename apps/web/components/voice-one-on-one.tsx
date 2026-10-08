"use client";
// "Your one-on-one sessions" (Keep training, under Trainer voice): how the
// coach runs a session. The Brain drafts a style summary and a sample
// session; the coach confirms the style once, and every new voice session
// then gets a few extra lines in it, personal to each client. Numbers, counts
// and the safety line stay code's (docs/features/voice-session.md).
import { useCallback, useEffect, useRef, useState } from "react";
import { VOICE_STYLE_SAVED } from "./voice-session-style";

type Answers = {
  open: string;
  form: string;
  count: string;
  rests: string;
  motivate: string;
  struggle: string;
  close: string;
  always: string[];
  never: string[];
};
type View = {
  version: number;
  topics: Array<{ key: Exclude<keyof Answers, "always" | "never">; label: string; hint: string }>;
  answers: Answers;
  answered: number;
  minimumAnswered: number;
  draft: null | {
    summary: string;
    current: boolean;
    preview: Array<{ id: string; owner: "code" | "trainer" | "brain"; text: string; moment?: string }>;
  };
  confirmed: null | { summary: string; confirmedAt: string; current: boolean };
  active: boolean;
  publication?: { releaseId: string | null; pending: boolean };
  modelAvailable: boolean;
  voiceSample: boolean;
  droppedLines?: number;
};
async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? "The request failed.");
  return data;
}
const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const OWNER: Record<string, string> = { code: "from the plan", trainer: "your words", brain: "Brain, in your style" };

export function VoiceOneOnOne() {
  const [view, setView] = useState<View | null>(null),
    [answers, setAnswers] = useState<Answers | null>(null),
    [always, setAlways] = useState(""),
    [never, setNever] = useState(""),
    [dirty, setDirty] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [sample, setSample] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const show = useCallback((v: View) => {
    setView(v);
    setAnswers(v.answers);
    setAlways(v.answers.always.join("\n"));
    setNever(v.answers.never.join("\n"));
    setDirty(false);
  }, []);
  useEffect(() => {
    void call("/voice-sessions/one-on-one")
      .then(show)
      .catch((e) => setNotice(e.message));
  }, [show]);
  // The phrases form saves into the same versioned style.
  useEffect(() => {
    const saved = (e: Event) => {
      const version = (e as CustomEvent<{ version: number }>).detail?.version;
      if (typeof version === "number") setView((v) => (v ? { ...v, version } : v));
    };
    window.addEventListener(VOICE_STYLE_SAVED, saved);
    return () => window.removeEventListener(VOICE_STYLE_SAVED, saved);
  }, []);
  useEffect(() => () => {
    if (sample) URL.revokeObjectURL(sample);
  }, [sample]);
  if (!view || !answers) return notice ? <p className="notice">{notice}</p> : null;
  const run = async (label: string, fn: () => Promise<View | void>) => {
    setBusy(label);
    setNotice("");
    try {
      const next = await fn();
      if (next) {
        show(next);
        window.dispatchEvent(new CustomEvent(VOICE_STYLE_SAVED, { detail: { version: next.version } }));
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy("");
    }
  };
  const save = () =>
    run("save", () =>
      call("/voice-sessions/one-on-one", "PUT", {
        revision: view.version,
        answers: { ...answers, always: lines(always).slice(0, 8), never: lines(never).slice(0, 8) },
      }),
    );
  const answered = view.topics.filter((t) => answers[t.key].trim()).length;
  return (
    <section className="card voice-one-on-one" id="one-on-one" aria-labelledby="one-on-one-title">
      <div className="card-heading">
        <h2 id="one-on-one-title">How your Brain communicates</h2>
        <span className={"badge" + (view.active ? "" : " amber")}>{view.active ? "Confirmed" : "Needs teaching"}</span>
      </div>
      <p className="muted">
        Teach one communication style for your messages, training plans, food guidance and spoken workouts.
        Use the words you would actually say to a client. Your Brain checks confirmed changes before publishing them;
        each subscriber still gets guidance suited to their own plan and needs.
      </p>
      {view.confirmed && !view.confirmed.current && (
        <p className="notice">Your answers changed since you confirmed. Draft and confirm the update when it sounds like you.</p>
      )}
      {view.publication?.pending && <p className="notice">Your shared style has an update waiting for Brain checks. Subscribers keep the last published version until it passes.</p>}
      {!view.publication?.releaseId && <p className="muted">Review and publish your Brain to use this shared style across your coaching.</p>}
      <div className="stack">
        {view.topics.map((topic) => (
          <label key={topic.key} className="field">
            <span>{topic.label}</span>
            <small className="muted">{topic.hint}</small>
            <textarea
              rows={2}
              maxLength={300}
              value={answers[topic.key]}
              onChange={(e) => {
                setAnswers({ ...answers, [topic.key]: e.target.value });
                setDirty(true);
              }}
            />
          </label>
        ))}
        <label className="field">
          <span>Phrases you always use</span>
          <small className="muted">One per line, up to eight.</small>
          <textarea rows={3} value={always} onChange={(e) => (setAlways(e.target.value), setDirty(true))} />
        </label>
        <label className="field">
          <span>Things you never say</span>
          <small className="muted">One per line, up to eight. The Brain never uses them.</small>
          <textarea rows={3} value={never} onChange={(e) => (setNever(e.target.value), setDirty(true))} />
        </label>
      </div>
      <div className="button-row">
        <button className="button secondary" type="button" disabled={!!busy || !dirty} onClick={() => void save()}>
          {busy === "save" ? "Saving…" : "Save answers"}
        </button>
        <button
          className="button"
          type="button"
          disabled={!!busy || dirty || answered < view.minimumAnswered || !view.modelAvailable}
          onClick={() =>
            void run("draft", () => call("/voice-sessions/one-on-one/draft", "POST", { revision: view.version }))
          }
        >
          {busy === "draft" ? "Drafting…" : "Draft my style"}
        </button>
      </div>
      {answered < view.minimumAnswered && (
        <p className="muted">Answer at least {view.minimumAnswered} questions, save, then draft your style.</p>
      )}
      {!view.modelAvailable && <p className="muted">Drafting is not switched on yet for this platform.</p>}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {view.draft && (
        <div className="voice-preview">
          <h3>Your session style</h3>
          <p>{view.draft.summary}</p>
          <h3>Sample session</h3>
          <ol>
            {view.draft.preview.map((l) => (
              <li key={l.id}>
                <span className={"badge" + (l.owner === "brain" ? " accent" : "")}>{OWNER[l.owner]}</span>{" "}
                {l.moment ? <em>{l.moment}: </em> : null}
                {l.text}
              </li>
            ))}
          </ol>
          {typeof view.droppedLines === "number" && view.droppedLines > 0 && (
            <p className="muted">{view.droppedLines} suggested line(s) did not pass the checks and were left out.</p>
          )}
          <div className="button-row">
            {view.voiceSample && (
              <button
                className="button secondary"
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void run("voice", async () => {
                    const r = await call("/voice-sessions/one-on-one/sample-audio", "POST", {});
                    const bytes = Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0));
                    const url = URL.createObjectURL(new Blob([bytes], { type: r.type }));
                    setSample(url);
                    if (audio.current) {
                      audio.current.src = url;
                      void audio.current.play().catch(() => {});
                    }
                  })
                }
              >
                {busy === "voice" ? "Preparing…" : "Hear it in your voice"}
              </button>
            )}
            {view.draft.current && !(view.confirmed?.current && view.active) && (
              <button
                className="button"
                type="button"
                disabled={!!busy || dirty}
                onClick={() =>
                  void run("confirm", () =>
                    call("/voice-sessions/one-on-one/confirm", "POST", { revision: view.version, confirmed: true }),
                  )
                }
              >
                Confirm this style
              </button>
            )}
            {view.active && (
              <button
                className="text-button"
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void run("off", () =>
                    call("/voice-sessions/one-on-one/confirm", "POST", { revision: view.version, confirmed: false }),
                  )
                }
              >
                Remove from next Brain update
              </button>
            )}
          </div>
          <audio ref={audio} controls={!!sample} hidden={!sample} />
        </div>
      )}
      {view.active && view.confirmed && (
        <p className="muted">
          Confirmed {new Date(view.confirmed.confirmedAt).toLocaleDateString()}. Your published Brain determines which style subscribers receive.
        </p>
      )}
    </section>
  );
}
