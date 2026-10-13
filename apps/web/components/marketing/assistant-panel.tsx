"use client";

import "../../app/marketing-assistant.css";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Minus,
  Maximize2,
  X,
} from "lucide-react";
import {
  MARKETING_ASSISTANT_LIMITS as LIMITS,
  MARKETING_ASSISTANT_PUBLIC_TEXT as TEXT,
} from "../../../../packages/domain/src/marketing-assistant-text";
import {
  assistantDestination,
  assistantPage,
} from "../../../../packages/domain/src/marketing-assistant-navigation";
import { ConversationAudio, pcmWav } from "../../lib/conversation-audio";
import { VoiceInput, VOICE_SAMPLE_RATE } from "../../lib/voice-input";
import { VoicePlayback } from "../../lib/voice-playback";
import { VoiceWaitCues } from "../../lib/voice-wait-cues";
import { setAudioSessionType } from "../../lib/audio-session";
import type { AssistantPanelProps } from "./assistant-button";

type Phase =
  | "idle"
  | "connecting"
  | "listening"
  | "hearing"
  | "thinking"
  | "speaking"
  | "ended";
type Turn = { from: "visitor" | "assistant"; text: string };
type Resources = {
  context: AudioContext;
  stream: MediaStream;
  input?: VoiceInput;
  tentative?: boolean;
  capture: ConversationAudio;
  echo: boolean;
  player?: VoicePlayback;
  cue?: AudioBufferSourceNode;
};
const T = TEXT.en;
async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Persistent in the platform layout. All conversation memory is tab-local. */
export function AssistantPanel({
  appName,
  onClose,
  onHide,
  minimized,
  onMinimize,
  onNavigate,
}: AssistantPanelProps) {
  const router = useRouter(),
    pathname = usePathname();
  const page = useRef(pathname);
  page.current = pathname;
  const [phase, setPhase] = useState<Phase>("idle"),
    phaseRef = useRef<Phase>("idle");
  const [lang, setLang] = useState<"en" | "ar">("en"),
    language = useRef(lang);
  language.current = lang;
  const [muted, setMuted] = useState(false),
    mute = useRef(false);
  const [notice, setNotice] = useState(""),
    [cueSpeaking, setCueSpeaking] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([
    { from: "assistant", text: T.greeting.replace("{APP_NAME}", appName) },
  ]);
  const [handoff, setHandoff] = useState<{
    href: string;
    label: string;
  } | null>(null);
  const [shown, setShown] = useState(""),
    [follow, setFollow] = useState(true),
    followRef = useRef(true);
  const alive = useRef(true),
    epoch = useRef(0),
    active = useRef(false),
    inFlight = useRef(false),
    interrupted = useRef(false);
  const visit = useRef(""),
    history = useRef<Turn[]>([]),
    left = useRef<number>(LIMITS.turnsPerVisit);
  const resources = useRef<Resources | null>(null),
    abort = useRef<AbortController | null>(null);
  const wait = useRef<VoiceWaitCues | null>(null),
    clips = useRef<string[]>([]),
    queued = useRef<Float32Array[] | null>(null);
  const quietUntil = useRef(0),
    started = useRef(0),
    log = useRef<HTMLOListElement>(null),
    startButton = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onClose, onHide, onNavigate });
  callbacks.current = { onClose, onHide, onNavigate };
  const current = (token: number) =>
    alive.current && active.current && epoch.current === token;
  const change = (value: Phase) => {
    phaseRef.current = value;
    if (alive.current) setPhase(value);
  };
  const isActive = !["idle", "ended"].includes(phase);

  useEffect(() => {
    alive.current = true;
    if (navigator.language?.toLowerCase().startsWith("ar")) setLang("ar");
    startButton.current?.focus();
    let live = true;
    void fetch("/api/v1/public/assistant", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (live && !body.available) {
          end();
          setNotice(T.unavailable);
          if (body.hiddenUntil) callbacks.current.onHide(body.hiddenUntil);
        }
      })
      .catch(() => {});
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        end();
        callbacks.current.onClose();
      }
    };
    const hidden = () => {
      if (document.hidden && active.current) {
        end();
        setNotice(
          "The call ended when you left this tab. You can start again here.",
        );
      }
    };
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      live = false;
      alive.current = false;
      end();
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useEffect(() => {
    // Scroll only the caption list, never the marketing page being demonstrated.
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns, minimized, phase, notice, shown]);
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      if (Date.now() - started.current >= 15 * 60000) {
        end();
        setNotice(
          "This call reached 15 minutes. You can continue exploring the site.",
        );
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isActive]);

  function stopCue() {
    try {
      resources.current?.cue?.stop();
    } catch {}
    if (resources.current) resources.current.cue = undefined;
    if (alive.current) setCueSpeaking(false);
  }
  function stopWaiting() {
    wait.current?.end();
  }
  function end() {
    active.current = false;
    epoch.current++;
    abort.current?.abort();
    stopWaiting();
    clips.current = [];
    queued.current = null;
    inFlight.current = false;
    const r = resources.current;
    resources.current = null;
    if (r) {
      r.input?.dispose();
      try {
        r.player?.stop();
      } catch {}
      r.stream.getTracks().forEach((t) => t.stop());
      r.capture.reset();
      void r.context.close().catch(() => {});
      setAudioSessionType("ambient");
    }
    mute.current = false;
    if (alive.current) {
      setMuted(false);
      change("ended");
    }
  }
  async function play(
    encoded: string,
    token: number,
    cue = false,
    valid = () => true,
  ) {
    const r = resources.current;
    if (
      !r ||
      !current(token) ||
      !valid() ||
      interrupted.current ||
      (cue && mute.current)
    )
      return;
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const buffer = await r.context.decodeAudioData(bytes.buffer);
    await r.context.resume();
    if (
      !current(token) ||
      resources.current !== r ||
      !valid() ||
      interrupted.current ||
      (cue && mute.current)
    )
      return;
    if (!cue) {
      change("speaking");
      const player = new VoicePlayback(r.context, buffer);
      r.player = player;
      if (!r.tentative) player.resume();
      await player.done;
      if (r.player === player) r.player = undefined;
      return;
    }
    await new Promise<void>((resolve) => {
      const source = r.context.createBufferSource();
      source.buffer = buffer; source.connect(r.context.destination);
      r.cue = source; setCueSpeaking(true);
      source.onended = () => {
        source.disconnect();
        if (r.cue === source) { r.cue = undefined; if (alive.current) setCueSpeaking(false); }
        resolve();
      };
      source.start(); source.stop(r.context.currentTime + Math.min(buffer.duration, 4));
    });
  }
  function interrupt() {
    interrupted.current = true;
    stopWaiting();
    try {
      resources.current?.player?.stop();
    } catch {}
    if (alive.current)
      setNotice(
        language.current === "ar" ? "أسمعك. تفضل." : "I'm listening. Go ahead.",
      );
  }
  function drain(token: number) {
    if (!current(token) || inFlight.current) return;
    const next = queued.current;
    if (next && !mute.current && left.current > 0) {
      queued.current = null;
      void turn(next, token);
    } else if (left.current <= 0) {
      end();
      setNotice(T.limit);
    } else change(resources.current?.capture.active ? "hearing" : "listening");
  }
  async function turn(chunks: Float32Array[], token: number) {
    const r = resources.current;
    if (!r || !current(token) || inFlight.current || left.current <= 0) return;
    inFlight.current = true;
    interrupted.current = false;
    change("thinking");
    setNotice("");
    const fromPage = page.current;
    wait.current?.begin();
    try {
      const wav = pcmWav(chunks, VOICE_SAMPLE_RATE, LIMITS.audioSeconds);
      const audio = await base64(wav.blob);
      if (!current(token)) return;
      const response = await fetch("/api/v1/public/assistant/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([
          abort.current!.signal,
          AbortSignal.timeout(60000),
        ]),
        body: JSON.stringify({
          visit: visit.current,
          audio,
          type: "audio/wav",
          durationMs: wav.durationMs,
          lang: language.current,
          history: history.current.slice(-LIMITS.historyTurns),
          currentPage: assistantPage(fromPage),
          allowNavigation: followRef.current,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!current(token)) return;
      stopWaiting();
      setNotice("");
      if (!response.ok) {
        if (body.code === "ASSISTANT_CAP" || body.code === "ASSISTANT_OFF") {
          end();
          setNotice(T.unavailable);
          return;
        }
        if (body.code === "ASSISTANT_LIMIT") {
          end();
          setNotice(T.limit);
          return;
        }
        throw Error(
          body.code === "TRANSCRIPTION_FAILED" ? T.notHeard : T.error,
        );
      }
      const next: Turn[] = [
        ...(body.heard
          ? [{ from: "visitor" as const, text: String(body.heard) }]
          : []),
        { from: "assistant", text: String(body.caption ?? "") },
      ];
      history.current = [...history.current, ...next].slice(
        -LIMITS.historyTurns,
      );
      setTurns((all) => [...all, ...next]);
      left.current = Number.isFinite(body.turnsLeft)
        ? body.turnsLeft
        : left.current - 1;
      const destination = assistantDestination(body.navigate);
      // Do not pull someone back after they browsed elsewhere during a slow reply.
      if (
        !interrupted.current &&
        !mute.current &&
        followRef.current &&
        fromPage === page.current &&
        destination &&
        destination.href !== page.current
      ) {
        setShown(destination.label);
        callbacks.current.onNavigate();
        router.push(destination.href);
      }
      if (
        !interrupted.current &&
        body.handoff &&
        ["/signup", "/get-started#early-access"].includes(body.handoff.href)
      )
        setHandoff(body.handoff);
      if (!interrupted.current && Array.isArray(body.audio)) {
        for (const clip of body.audio.slice(0, 3)) {
          if (!current(token) || interrupted.current) break;
          await play(clip, token).catch(() => {
            if (current(token))
              setNotice(
                "The audio couldn't play. You can read the reply here and keep talking.",
              );
          });
        }
      }
      if (current(token) && !interrupted.current) {
        quietUntil.current = performance.now() + 350;
        r.capture.reset();
      }
    } catch (e) {
      if (current(token)) {
        end();
        setNotice(
          (e as Error).name === "TimeoutError"
            ? "The reply took too long. Start another call when you're ready."
            : (e as Error).message || T.error,
        );
      }
    } finally {
      if (current(token)) {
        inFlight.current = false;
        stopWaiting();
        drain(token);
      }
    }
  }
  async function start() {
    if (active.current || left.current <= 0) return;
    active.current = true;
    const token = ++epoch.current;
    change("connecting");
    setNotice("");
    setHandoff(null);
    mute.current = false;
    setMuted(false);
    started.current = Date.now();
    abort.current = new AbortController();
    visit.current ||= crypto.randomUUID();
    let stream: MediaStream | undefined, context: AudioContext | undefined;
    try {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (
        !Ctor ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof AudioWorkletNode === "undefined"
      )
        throw Error(
          "Voice calls need a current browser with microphone access.",
        );
      context = new Ctor({ sampleRate: 48000 });
      await context!.resume();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (!current(token)) {
        stream.getTracks().forEach((t) => t.stop());
        void context!.close();
        return;
      }
      const r: Resources = {
        context: context!, stream,
        capture: new ConversationAudio(VOICE_SAMPLE_RATE, LIMITS.audioSeconds, 224),
        echo: stream.getAudioTracks()[0]?.getSettings().echoCancellation === true,
      };
      resources.current = r;
      setAudioSessionType("play-and-record");
      inFlight.current = false;
      interrupted.current = false;
      queued.current = null;
      quietUntil.current = 0;
      wait.current = new VoiceWaitCues({
        clips: () => clips.current,
        play: (clip, valid) => play(clip, token, true, valid),
        stop: stopCue,
        longWait: () => {
          if (current(token))
            setNotice(
              language.current === "ar"
                ? "يستغرق الرد وقتًا أطول قليلًا. أنا معك."
                : "This reply is taking a little longer. I'm still with you.",
            );
        },
      });
      // Preparation is optional and never blocks listening. Poll only an existing shared claim.
      void (async () => {
        for (let attempt = 0; attempt < 4 && current(token); attempt++) {
          const result = await fetch("/api/v1/public/assistant/cues", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lang: language.current }),
            signal: abort.current!.signal,
          }).then((res) => res.json());
          if (!current(token)) return;
          if (Array.isArray(result.cues))
            clips.current = result.cues.slice(0, 2);
          if (!result.pending) return;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      })().catch(() => {});
      r.input = await VoiceInput.create({
        context: r.context, stream, signal: abort.current!.signal,
        mode: () => {
          if (!current(token) || mute.current || queued.current || performance.now() < quietUntil.current ||
              (!r.echo && (r.cue || (phaseRef.current === "speaking" && !interrupted.current)))) return "blocked";
          return inFlight.current && !interrupted.current ? "interrupt" : "listen";
        },
        onReset: () => { r.capture.reset(); r.tentative = false; r.player?.resume(); },
        onError: () => { if (current(token)) { end(); setNotice("Voice processing stopped. Please start another call."); } },
        onFrame: (pcm, decision) => {
          if (!current(token)) return;
          r.tentative = decision.tentative;
          if (decision.tentative) r.player?.pause();
          else r.player?.resume();
          if (decision.interrupt && inFlight.current && !interrupted.current) interrupt();
          const ready = r.capture.push(pcm, decision.speech);
          if (ready) {
            if (inFlight.current) {
              queued.current = ready;
              setNotice(language.current === "ar" ? "سمعت إضافتك. لحظة واحدة." : "I've heard your addition. One moment.");
            } else void turn(ready, token);
          } else if (!inFlight.current) change(r.capture.active ? "hearing" : "listening");
        },
      });
      if (!current(token)) { r.input.dispose(); return; }
      change("listening");
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      if (
        context &&
        context.state !== "closed" &&
        resources.current?.context !== context
      )
        void context.close().catch(() => {});
      if (current(token)) {
        end();
        setNotice(
          (e as Error).name === "NotAllowedError"
            ? T.noMic
            : (e as Error).message,
        );
      }
    }
  }
  function toggleMute() {
    mute.current = !mute.current;
    setMuted(mute.current);
    resources.current?.input?.reset();
    resources.current?.capture.reset();
    queued.current = null;
    resources.current?.stream.getAudioTracks().forEach((t) => {
      t.enabled = !mute.current;
    });
    if (mute.current) {
      stopWaiting();
      setNotice("");
    }
  }
  const status = muted
    ? "Microphone muted"
    : phase === "connecting"
      ? "Connecting…"
      : phase === "thinking"
        ? "One moment…"
        : phase === "speaking"
          ? "Kamran is speaking"
          : phase === "hearing"
            ? "Listening…"
            : phase === "listening"
              ? "I'm listening"
              : phase === "ended"
                ? "Call ended"
                : "A conversation, at your pace";
  return (
    <section
      className={`mk-assistant${minimized ? " is-minimized" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="mk-assistant-title"
      data-phase={phase}
      data-cue={cueSpeaking ? "speaking" : "quiet"}
    >
      <header className="mk-assistant-head">
        <div>
          <p id="mk-assistant-title" className="mk-assistant-title">
            Kamran
          </p>
          <span className="mk-assistant-label">{T.label}</span>
        </div>
        {!minimized && (
          <button
            type="button"
            className="mk-assistant-lang"
            disabled={isActive}
            onClick={() => setLang((l) => (l === "en" ? "ar" : "en"))}
            aria-label={lang === "en" ? "Speak Arabic" : "Speak English"}
          >
            {lang === "en" ? TEXT.en.language : TEXT.ar.language}
          </button>
        )}
        <button
          type="button"
          className="mk-assistant-close"
          onClick={onMinimize}
          aria-label={minimized ? "Expand call" : "Minimize call"}
        >
          {minimized ? <Maximize2 size={18} /> : <Minus size={18} />}
        </button>
        <button
          type="button"
          className="mk-assistant-close"
          onClick={() => {
            end();
            onClose();
          }}
          aria-label="Close and end call"
        >
          <X size={18} />
        </button>
      </header>
      {!minimized && (
        <>
          <p className="mk-assistant-notice">
            {isActive
              ? resources.current?.echo
                ? "Speak naturally, pause for a reply, or speak to interrupt."
                : "Speak naturally and pause for a reply. Use Let me speak to interrupt."
              : T.micNotice}
          </p>
          <ol className="mk-assistant-log" ref={log} aria-live="polite">
            {turns.map((item, i) => (
              <li
                key={i}
                className={
                  item.from === "visitor" ? "is-visitor" : "is-assistant"
                }
                dir="auto"
              >
                {item.text}
              </li>
            ))}
          </ol>
          <label className="mk-assistant-follow">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => {
                followRef.current = e.target.checked;
                setFollow(e.target.checked);
              }}
            />{" "}
            Show relevant pages as we talk
          </label>
          {handoff && (
            <Link
              className="mk-assistant-signup"
              href={handoff.href}
              onClick={() => end()}
            >
              {handoff.label} →
            </Link>
          )}
        </>
      )}
      {shown && (
        <p className="mk-assistant-notice">
          Opened {shown}. Your call continues.
        </p>
      )}
      <p className="mk-assistant-status" role="status">
        {notice || status}
      </p>
      <div className="mk-assistant-actions">
        {isActive ? (
          <>
            <button
              type="button"
              className="mk-assistant-control"
              onClick={toggleMute}
              aria-label={muted ? T.unmute : T.mute}
              aria-pressed={muted}
            >
              {muted ? <MicOff size={18} /> : <Mic size={18} />}{" "}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              className="mk-assistant-control is-end"
              onClick={() => {
                end();
                setNotice("");
              }}
            >
              <PhoneOff size={18} />
              {T.end}
            </button>
            {(phase === "speaking" || cueSpeaking) && !muted && (
              <button
                type="button"
                className="mk-assistant-control"
                onClick={interrupt}
              >
                {T.interrupt}
              </button>
            )}
          </>
        ) : (
          <button
            ref={startButton}
            type="button"
            className="button mk-assistant-talk"
            onClick={() => void start()}
            disabled={left.current <= 0}
          >
            <Phone size={18} />
            {T.start}
          </button>
        )}
      </div>
    </section>
  );
}
