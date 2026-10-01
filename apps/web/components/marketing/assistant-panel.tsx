"use client";

/**
 * Kamran's AI voice on the home page (docs/features/kamran-assistant.md),
 * loaded on the first tap of the assistant button. Voice only: hold to talk
 * (or hold Space or Enter), up to 20 seconds; the reply is shown as captions
 * and played in the chosen voice. The conversation lives in this page only.
 * A visitor who wants to start is taken to Start coaching (early access while
 * registration is closed) after the reply, unless they choose to stay.
 */
import "../../app/marketing-assistant.css";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  MARKETING_ASSISTANT_LIMITS as LIMITS,
  MARKETING_ASSISTANT_PUBLIC_TEXT as TEXT,
} from "../../../../packages/domain/src/marketing-assistant-text";
import type { AssistantPanelProps } from "./assistant-button";

type Lang = "en" | "ar";
type Turn = { from: "visitor" | "assistant"; text: string };
type Handoff = { href: string; label: string };
type State = "idle" | "recording" | "sending" | "speaking" | "handoff" | "done" | "off";

const T = TEXT.en;
const MIN_MS = 400;

function visitId() {
  try {
    return crypto.randomUUID();
  } catch {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
}
/** A recording format the server accepts, by what this browser records. */
function recorderType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"])
    if (MediaRecorder.isTypeSupported?.(mime)) return mime;
  return "";
}
const baseType = (mime: string) => {
  const type = mime.split(";")[0]!.trim();
  return ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"].includes(type) ? type : "audio/webm";
};
async function toBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function AssistantPanel({ appName, onClose, onHide }: AssistantPanelProps) {
  const fill = (s: string) => s.replace("{APP_NAME}", appName);
  const [state, setState] = useState<State>("idle");
  const [lang, setLang] = useState<Lang>("en");
  const [turns, setTurns] = useState<Turn[]>([{ from: "assistant", text: fill(T.greeting) }]);
  const [notice, setNotice] = useState("");
  const [left, setLeft] = useState<number>(LIMITS.turnsPerVisit);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [seconds, setSeconds] = useState(0);
  const visit = useRef(visitId());
  const history = useRef<Turn[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const released = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const talk = useRef<HTMLButtonElement | null>(null);
  const log = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    try {
      if (navigator.language?.toLowerCase().startsWith("ar")) setLang("ar");
    } catch {
      // English by default.
    }
    talk.current?.focus();
    let live = true;
    fetch("/api/v1/public/assistant", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (!live || body?.available) return;
        setState("off");
        setNotice(T.unavailable);
        if (body?.hiddenUntil) onHide(body.hiddenUntil);
      })
      .catch(() => {});
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (tick.current) clearInterval(tick.current);
      if (leave.current) clearTimeout(leave.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
      void audio.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  /** Started inside the press, so phones allow the reply to play later. */
  function unlockAudio() {
    try {
      const Context = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Context) return;
      audio.current ??= new Context();
      void audio.current.resume();
    } catch {
      audio.current = null;
    }
  }
  async function play(clips: string[]) {
    const context = audio.current;
    if (!context) {
      for (const clip of clips)
        await new Promise<void>((resolve) => {
          const element = new Audio("data:audio/mpeg;base64," + clip);
          element.onended = () => resolve();
          element.onerror = () => resolve();
          element.play().catch(() => resolve());
        });
      return;
    }
    for (const clip of clips) {
      try {
        const bytes = Uint8Array.from(atob(clip), (c) => c.charCodeAt(0));
        const buffer = await context.decodeAudioData(bytes.buffer);
        await new Promise<void>((resolve) => {
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          source.onended = () => resolve();
          source.start();
        });
      } catch {
        // A clip that cannot play: the caption is on screen.
      }
    }
  }

  async function start() {
    if (state !== "idle" || left <= 0) return;
    setNotice("");
    unlockAudio();
    released.current = false;
    const mime = recorderType();
    if (mime === null || !navigator.mediaDevices?.getUserMedia) {
      setNotice(T.noMic);
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNotice(T.noMic);
      return;
    }
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.current = rec;
    chunks.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void finish(rec.mimeType || mime);
    };
    rec.start();
    started.current = Date.now();
    setSeconds(0);
    setState("recording");
    tick.current = setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 500);
    stopTimer.current = setTimeout(stop, LIMITS.audioSeconds * 1000);
    if (released.current) stop();
  }
  function stop() {
    released.current = true;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (tick.current) clearInterval(tick.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  async function finish(mime: string) {
    const durationMs = Math.min(Date.now() - started.current, LIMITS.audioSeconds * 1000);
    if (durationMs < MIN_MS || !chunks.current.length) {
      setState("idle");
      setNotice(T.hold + ".");
      return;
    }
    setState("sending");
    const blob = new Blob(chunks.current, { type: baseType(mime) });
    chunks.current = [];
    try {
      const response = await fetch("/api/v1/public/assistant/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visit: visit.current,
          audio: await toBase64(blob),
          type: baseType(mime),
          durationMs: Math.max(200, durationMs),
          lang,
          history: history.current.slice(-LIMITS.historyTurns),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return refused(response.status, body);
      const heard = String(body.heard ?? "");
      const caption = String(body.caption ?? "");
      const next: Turn[] = [...(heard ? [{ from: "visitor" as const, text: heard }] : []), { from: "assistant", text: caption }];
      history.current = [...history.current, ...next].slice(-LIMITS.historyTurns);
      setTurns((all) => [...all, ...next]);
      const remaining = Number.isFinite(body.turnsLeft) ? Number(body.turnsLeft) : left - 1;
      setLeft(remaining);
      if (Array.isArray(body.audio) && body.audio.length) {
        setState("speaking");
        await play(body.audio);
      }
      after(body.handoff ?? null, remaining);
    } catch {
      setState("idle");
      setNotice(T.error);
    }
  }
  function refused(_status: number, body: any) {
    const code = String(body?.code ?? "");
    if (code === "ASSISTANT_CAP" || code === "ASSISTANT_OFF") {
      setState("off");
      setNotice(T.unavailable);
      if (code === "ASSISTANT_CAP") onHide(body?.hiddenUntil ?? null);
      return;
    }
    if (code === "ASSISTANT_LIMIT") {
      setState("done");
      setNotice(T.limit);
      return;
    }
    setState("idle");
    setNotice(code === "SPEECH_TOO_LONG" ? T.tooLong : code === "TRANSCRIPTION_FAILED" ? T.notHeard : T.error);
  }
  function after(next: Handoff | null, remaining: number) {
    if (next?.href?.startsWith("/")) {
      setHandoff(next);
      setState("handoff");
      leave.current = setTimeout(() => window.location.assign(next.href), 3000);
      return;
    }
    if (remaining <= 0) {
      setState("done");
      setNotice(T.limit);
      return;
    }
    setState("idle");
  }
  function stay() {
    if (leave.current) clearTimeout(leave.current);
    setHandoff(null);
    setState(left > 0 ? "idle" : "done");
  }

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    void start();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      void start();
    }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      stop();
    }
  };
  const status =
    state === "recording"
      ? `${T.listening} ${seconds}s`
      : state === "sending"
        ? T.thinking
        : state === "speaking"
          ? T.speaking
          : state === "handoff" && handoff
            ? T.handoff.replace("{CTA}", handoff.label)
            : "";
  const canTalk = state === "idle" || state === "recording";
  return (
    <section className="mk-assistant" role="dialog" aria-modal="false" aria-labelledby="mk-assistant-title">
      <header className="mk-assistant-head">
        <div>
          <p id="mk-assistant-title" className="mk-assistant-title">{fill(T.title)}</p>
          <span className="mk-assistant-label">{T.label}</span>
        </div>
        <button
          type="button"
          className="mk-assistant-lang"
          onClick={() => setLang((l) => (l === "en" ? "ar" : "en"))}
          aria-label={lang === "en" ? "Speak Arabic" : "Speak English"}
          disabled={state === "recording" || state === "sending"}
        >
          {lang === "en" ? TEXT.en.language : TEXT.ar.language}
        </button>
        <button type="button" className="mk-assistant-close" onClick={onClose} aria-label={T.close}>
          ×
        </button>
      </header>
      <p className="mk-assistant-notice">{T.micNotice}</p>
      <ol className="mk-assistant-log" ref={log} aria-live="polite">
        {turns.map((turn, i) => (
          <li key={i} className={turn.from === "visitor" ? "is-visitor" : "is-assistant"} dir="auto">
            {turn.text}
          </li>
        ))}
      </ol>
      {notice && (
        <p className="mk-assistant-status" role="status">
          {notice}
        </p>
      )}
      {status && !notice && (
        <p className="mk-assistant-status" role="status">
          {status}
        </p>
      )}
      <div className="mk-assistant-actions">
        {state === "handoff" ? (
          <button type="button" className="button mk-assistant-stay" onClick={stay}>
            {T.stay}
          </button>
        ) : (
          <button
            ref={talk}
            type="button"
            className={`button mk-assistant-talk${state === "recording" ? " is-recording" : ""}`}
            disabled={!canTalk || left <= 0}
            onPointerDown={onPointerDown}
            onPointerUp={stop}
            onPointerCancel={stop}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
          >
            {state === "recording" ? T.release : T.hold}
          </button>
        )}
      </div>
    </section>
  );
}
