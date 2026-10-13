"use client";
// Tap to talk for "My own music" mode: one reply per tap, the microphone
// closed after it (apps/web/lib/tap-to-talk.ts holds the states). The audio
// session is "play-and-record" only while recording, "ambient" otherwise.
import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceInput, VOICE_SAMPLE_RATE } from "../lib/voice-input";
import { pcmWav } from "../lib/conversation-audio";
import { setAudioSessionType } from "../lib/audio-session";
import {
  idleTalk,
  stepTalk,
  type TalkEffect,
  type TalkEvent,
  type TalkState,
} from "../lib/tap-to-talk";

export type TalkCapture = "server" | "device";
type Options = {
  /** How the reply is heard: the speech service, or on-device recognition. */
  capture: TalkCapture | null;
  /** Recognition language for on-device recognition. */
  lang: string;
  /** Milliseconds left in the echo grace after the last cue. */
  graceLeftMs: () => number;
  /** A recorded reply for the speech service. */
  onAudio: (
    audio: Blob,
    durationMs: number,
    sincePlaybackMs: number,
    current: () => boolean,
  ) => Promise<void>;
  /** On-device words. */
  onWords: (text: string) => void;
  onMicError: () => void;
  /** Milliseconds since the last cue ended (for the server's echo guard). */
  sincePlaybackMs: () => number;
};
function recognitionConstructor(): any {
  if (typeof window === "undefined") return null;
  return (
    (window as any).SpeechRecognition ??
    (window as any).webkitSpeechRecognition ??
    null
  );
}
export function useTapToTalk(options: Options) {
  const [state, setState] = useState<TalkState>(idleTalk);
  const stateRef = useRef(state);
  const opts = useRef(options);
  opts.current = options;
  // One attempt per tap: late callbacks from an older attempt are ignored.
  const attempt = useRef(0);
  const media = useRef<{
    stream?: MediaStream;
    audioContext?: AudioContext;
    input?: VoiceInput;
    inputAbort?: AbortController;
    chunks: Float32Array[];
    ticker?: ReturnType<typeof setInterval>;
    recognition?: any;
    started?: number;
    sincePlayback?: number;
  }>({ chunks: [] });

  const dispatchRef = useRef<(e: TalkEvent) => void>(() => {});
  const perform = (fx: TalkEffect) => {
    const m = media.current,
      o = opts.current,
      mine = attempt.current;
    switch (fx) {
      case "session_record":
        setAudioSessionType("play-and-record");
        break;
      case "session_ambient":
        setAudioSessionType("ambient");
        break;
      case "open_mic": {
        const ready = () =>
          setTimeout(
            () => {
              if (attempt.current === mine)
                dispatchRef.current({ type: "mic_ready", now: Date.now() });
            },
            Math.max(0, o.graceLeftMs()),
          );
        if (o.capture === "device") {
          const Ctor = recognitionConstructor();
          if (!Ctor) {
            dispatchRef.current({ type: "mic_failed" });
            o.onMicError();
            return;
          }
          const r = new Ctor();
          r.processLocally = true;
          r.continuous = false;
          r.interimResults = false;
          r.lang = o.lang;
          r.onresult = (e: any) => {
            const result = e.results[e.results.length - 1];
            if (attempt.current !== mine || !result?.isFinal) return;
            dispatchRef.current({ type: "result" });
            opts.current.onWords(String(result[0]?.transcript ?? ""));
          };
          r.onend = () => {
            if (attempt.current === mine)
              dispatchRef.current({ type: "cancel" });
          };
          r.onerror = (e: any) => {
            if (attempt.current !== mine) return;
            dispatchRef.current({ type: "cancel" });
            if (
              [
                "not-allowed",
                "service-not-allowed",
                "language-not-supported",
              ].includes(e?.error)
            )
              opts.current.onMicError();
          };
          m.recognition = r;
          ready();
          return;
        }
        try {
          if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") throw Error("Microphone processing unavailable");
          m.audioContext = new AudioContext({ sampleRate: 48000 });
          void m.audioContext.resume().catch(() => {
            if (attempt.current === mine) { dispatchRef.current({ type: "cancel" }); opts.current.onMicError(); }
          });
        } catch {
          dispatchRef.current({ type: "mic_failed" }); o.onMicError(); return;
        }
        m.inputAbort = new AbortController();
        void navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
          .then(async stream => {
            if (attempt.current !== mine || stateRef.current.phase !== "opening") { stream.getTracks().forEach(t => t.stop()); return; }
            m.stream = stream;
            const input = await VoiceInput.create({
              context: m.audioContext!, stream, signal: m.inputAbort!.signal,
              mode: () => attempt.current === mine && stateRef.current.phase === "recording" ? "listen" : "blocked",
              onReset: () => { m.chunks = []; },
              onError: () => { if (attempt.current === mine) { dispatchRef.current({ type: "cancel" }); opts.current.onMicError(); } },
              onFrame: (pcm, decision) => {
                if (attempt.current !== mine || stateRef.current.phase !== "recording") return;
                m.chunks.push(pcm);
                dispatchRef.current({ type: "level", loud: decision.speech, now: Date.now() });
              },
            });
            if (attempt.current !== mine || stateRef.current.phase !== "opening") { input.dispose(); return; }
            m.input = input; ready();
          })
          .catch(() => {
            if (attempt.current !== mine || stateRef.current.phase !== "opening") return;
            dispatchRef.current({ type: "mic_failed" }); o.onMicError();
          });
        return;
      }
      case "start_recording": {
        m.started = Date.now();
        m.sincePlayback = o.sincePlaybackMs();
        if (o.capture === "device") {
          try {
            m.recognition?.start();
          } catch {
            dispatchRef.current({ type: "cancel" });
            return;
          }
          // The clock drives the no-speech and 6-second limits.
          m.ticker = setInterval(
            () =>
              dispatchRef.current({
                type: "level",
                loud: false,
                now: Date.now(),
              }),
            250,
          );
          return;
        }
        m.chunks = [];
        // A wall clock still closes the mic if capture stops producing frames.
        m.ticker = setInterval(() => dispatchRef.current({ type: "level", loud: false, now: Date.now() }), 250);
        return;
      }
      case "stop_and_send": {
        const wav = pcmWav(m.chunks, VOICE_SAMPLE_RATE, 6);
        m.chunks = [];
        void opts.current.onAudio(wav.blob, wav.durationMs, m.sincePlayback ?? 0, () => attempt.current === mine)
          .finally(() => { if (attempt.current === mine) dispatchRef.current({ type: "done" }); });
        return;
      }
      case "discard":
        m.chunks = [];
        try { m.recognition?.abort(); } catch {}
        return;
      case "close_mic":
        m.inputAbort?.abort(); m.input?.dispose();
        if (m.ticker) clearInterval(m.ticker);
        m.stream?.getTracks().forEach((t) => t.stop());
        void m.audioContext?.close().catch(() => {});
        if (m.recognition) {
          const r = m.recognition;
          m.recognition = undefined;
          r.onend = r.onerror = r.onresult = null;
          try {
            r.stop();
          } catch {}
        }
        m.stream = m.audioContext = m.input = m.inputAbort = undefined;
        m.ticker = undefined; m.chunks = [];
        return;
    }
  };
  const dispatch = useCallback((e: TalkEvent) => {
    if (e.type === "cancel") attempt.current++;
    const before = stateRef.current;
    const [next, effects] = stepTalk(before, e);
    if (before.phase === "idle" && next.phase === "opening") attempt.current++;
    stateRef.current = next;
    setState(next);
    for (const fx of effects) perform(fx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  dispatchRef.current = dispatch;
  const tap = useCallback(
    () => dispatch({ type: "tap", now: Date.now() }),
    [dispatch],
  );
  const cancel = useCallback(() => dispatch({ type: "cancel" }), [dispatch]);
  // Leaving the page closes everything.
  useEffect(() => () => dispatchRef.current({ type: "cancel" }), []);
  return { state, tap, cancel };
}
