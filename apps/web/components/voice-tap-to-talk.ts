"use client";
// Tap to talk for "My own music" mode: one reply per tap, the microphone
// closed after it (apps/web/lib/tap-to-talk.ts holds the states). The audio
// session is "play-and-record" only while recording, "ambient" otherwise.
import { useCallback, useEffect, useRef, useState } from "react";
import { SpeechGate, speechBand } from "../lib/speech-gate";
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
    analyser?: AnalyserNode;
    recorder?: MediaRecorder;
    chunks: Blob[];
    frame?: number;
    ticker?: ReturnType<typeof setInterval>;
    recognition?: any;
    discard?: boolean;
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
        void navigator.mediaDevices
          .getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          })
          .then((stream) => {
            if (
              attempt.current !== mine ||
              stateRef.current.phase !== "opening"
            ) {
              stream.getTracks().forEach((t) => t.stop());
              return;
            }
            m.stream = stream;
            m.audioContext = new AudioContext();
            m.analyser = m.audioContext.createAnalyser();
            m.analyser.fftSize = 1024;
            m.audioContext.createMediaStreamSource(stream).connect(m.analyser);
            ready();
          })
          .catch(() => {
            if (attempt.current !== mine) return;
            dispatchRef.current({ type: "mic_failed" });
            opts.current.onMicError();
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
        if (!m.stream || !m.analyser) return;
        let rec: MediaRecorder;
        try {
          rec = new MediaRecorder(m.stream, { audioBitsPerSecond: 16000 });
        } catch {
          rec = new MediaRecorder(m.stream);
        }
        m.recorder = rec;
        m.chunks = [];
        m.discard = false;
        rec.ondataavailable = (e) => e.data.size && m.chunks.push(e.data);
        rec.onstop = () => {
          if (m.discard || attempt.current !== mine) return;
          const duration = Date.now() - (m.started ?? Date.now());
          const blob = new Blob(m.chunks, {
            type: rec.mimeType || "audio/webm",
          });
          void opts.current
            .onAudio(
              blob,
              duration,
              m.sincePlayback ?? 0,
              () => attempt.current === mine,
            )
            .finally(() => {
              if (attempt.current === mine)
                dispatchRef.current({ type: "done" });
            });
        };
        rec.start();
        const samples = new Float32Array(m.analyser.fftSize);
        const spectrum = new Float32Array(m.analyser.frequencyBinCount);
        const gate = new SpeechGate();
        const loop = () => {
          if (
            attempt.current !== mine ||
            stateRef.current.phase !== "recording" ||
            !m.analyser
          )
            return;
          m.analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += v * v;
          m.analyser.getFloatFrequencyData(spectrum);
          const band = speechBand(
            spectrum,
            m.audioContext?.sampleRate ?? 48000,
            m.analyser.fftSize,
          );
          const now = Date.now();
          dispatchRef.current({
            type: "level",
            loud: gate.sample(
              Math.sqrt(sum / samples.length),
              band.ratio,
              band.activeBins,
              now,
            ),
            now,
          });
          m.frame = requestAnimationFrame(loop);
        };
        loop();
        return;
      }
      case "stop_and_send":
        try {
          m.recorder?.stop();
        } catch {}
        m.recorder = undefined;
        return;
      case "discard":
        m.discard = true;
        try {
          m.recorder?.stop();
        } catch {}
        m.recorder = undefined;
        try {
          m.recognition?.abort();
        } catch {}
        return;
      case "close_mic":
        if (m.frame) cancelAnimationFrame(m.frame);
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
        m.stream = m.audioContext = m.analyser = undefined;
        m.frame = m.ticker = undefined;
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
