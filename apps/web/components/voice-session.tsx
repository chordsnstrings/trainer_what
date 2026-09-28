"use client";
// Hands-free, voice-led workout session. The pure state machine
// (packages/domain/src/voice-runner.ts) decides what happens; this component
// plays the trainer-voice clips (or shows the words), runs the clock, listens
// for spoken replies and performs the effects: set logs go through the same
// device queue as the workout page, pain opens the existing safety hold.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  initialRunnerState,
  parseVoiceCommand,
  runnerStatus,
  stepRunner,
  type RunnerEffect,
  type RunnerEvent,
  type RunnerOutcome,
  type RunnerState,
  type VoiceCommand,
} from "../../../packages/domain/src/voice-runner.ts";
import type { SessionScript } from "../../../packages/domain/src/voice-session.ts";
import {
  drainWorkoutQueue,
  offlineQueueKeys,
  readList,
  type RejectedEntry,
  type WorkoutQueueItem,
} from "./offline-queue";

type ApiError = Error & { status?: number; code?: string };
async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined
        ? headers
        : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(data.message ?? "The request failed."), {
      status: response.status,
      code: data.code,
    }) as ApiError;
  return data as T;
}
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Please try again.";

type Gate = {
  mode: "voice" | "text";
  reasons: Array<{ code: string; message: string }>;
  premium: boolean;
  voiceReady: boolean;
  contractReady: boolean;
  playbackConsent: boolean;
  transcriptionConsent: boolean;
  speechToText: boolean;
  held: boolean;
  budget: { spentUsd: number; capUsd: number; reached: boolean } | null;
};
type SessionView = {
  id: string;
  workoutId: string;
  mode: "voice" | "text";
  status: string;
  audioStatus: string;
  unavailableReason: { code: string; message: string } | null;
  script: SessionScript;
  audio: {
    ready: number;
    total: number;
    failed: number;
    sharedReady: number;
    sharedTotal: number;
  };
  gate?: Gate;
};
type Listening = "off" | "device" | "server";

/** Seconds a text prompt stays before the runner moves on by itself. */
const readingSeconds = (text: string) =>
  Math.min(9, 1.5 + text.length * 0.045);

/** On-device speech recognition only (never a browser's cloud service). */
function recognitionConstructor(): any {
  if (typeof window === "undefined") return null;
  return (
    (window as any).SpeechRecognition ??
    (window as any).webkitSpeechRecognition ??
    null
  );
}
async function onDeviceRecognition(lang: string) {
  const Ctor = recognitionConstructor();
  if (!Ctor || typeof Ctor.available !== "function") return false;
  try {
    return (
      (await Ctor.available({ langs: [lang], processLocally: true })) ===
      "available"
    );
  } catch {
    return false;
  }
}
function speechType(mime: string) {
  const base = mime.split(";")[0];
  return ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"].includes(base)
    ? base
    : null;
}
async function blobBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function VoiceSessionRunner({
  workoutId,
  tenantId,
  userId,
}: {
  workoutId: string;
  tenantId: string;
  userId: string;
}) {
  const [gate, setGate] = useState<Gate | null>(null),
    [session, setSession] = useState<SessionView | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const r = await api<{ gate: Gate; session: SessionView | null }>(
      `/voice-sessions/workout/${workoutId}`,
    );
    setGate(r.gate);
    setSession(r.session);
    setLoaded(true);
    return r;
  }, [workoutId]);
  useEffect(() => {
    void refresh().catch((e) => {
      setNotice(message(e));
      setLoaded(true);
    });
  }, [refresh]);
  // While the trainer's voice is being prepared, check progress.
  useEffect(() => {
    if (session?.audioStatus !== "generating") return;
    const timer = setInterval(() => void refresh().catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [session?.audioStatus, refresh]);
  const prepare = async (playbackConsent: boolean) => {
    setBusy(true);
    setNotice("");
    try {
      const view = await api<SessionView>("/voice-sessions", "POST", {
        workoutId,
        ...(playbackConsent ? { playbackConsent: true } : {}),
      });
      setSession(view);
      if (view.gate) setGate(view.gate);
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(false);
    }
  };
  const voiceBlockedOnlyByConsent =
    !!gate &&
    gate.reasons.length > 0 &&
    gate.reasons.every((r) => r.code === "PLAYBACK_CONSENT");
  if (!loaded)
    return (
      <div className="stack voice-session">
        <p role="status">Loading your session…</p>
      </div>
    );
  return (
    <div className="stack voice-session">
      <div className="page-heading">
        <p className="eyebrow">VOICE-LED SESSION</p>
        <h1>{session?.script.title ?? "Your workout, guided"}</h1>
        <p className="muted">
          Your trainer's session plan, one step at a time. Say or tap “pain”
          at any moment and the session stops and your trainer is told.
        </p>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!session && gate && (
        <section className="card" aria-labelledby="voice-prepare">
          <h2 id="voice-prepare">Prepare this session</h2>
          {gate.held ? (
            <p className="notice error" role="alert">
              Training is paused for your trainer's review.
            </p>
          ) : (
            <>
              {gate.mode === "voice" || voiceBlockedOnlyByConsent ? (
                <>
                  <p>
                    Your trainer's approved voice will guide you through every
                    exercise, set and rest. Audio is prepared ahead of time.
                  </p>
                  {voiceBlockedOnlyByConsent && (
                    <label className="voice-check">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />{" "}
                      I want this session read in my trainer's approved voice.
                    </label>
                  )}
                  <div className="button-row">
                    <button
                      className="button"
                      disabled={busy || (voiceBlockedOnlyByConsent && !consent)}
                      onClick={() => void prepare(voiceBlockedOnlyByConsent)}
                    >
                      Prepare voice-led session
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void prepare(false)}
                    >
                      Use text guidance
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <ul className="voice-reasons">
                    {gate.reasons.map((r) => (
                      <li key={r.code}>{r.message}</li>
                    ))}
                  </ul>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void prepare(false)}
                  >
                    Start text-guided session
                  </button>
                </>
              )}
            </>
          )}
        </section>
      )}
      {session && gate && (
        <Runner
          key={session.id + ":" + session.mode}
          session={session}
          gate={gate}
          workoutId={workoutId}
          tenantId={tenantId}
          userId={userId}
          onRefresh={refresh}
          onPrepare={prepare}
        />
      )}
      <a className="text-link" href={`/app/workouts/${workoutId}`}>
        Open the workout log
      </a>
    </div>
  );
}

function Runner({
  session,
  gate,
  workoutId,
  tenantId,
  userId,
  onRefresh,
  onPrepare,
}: {
  session: SessionView;
  gate: Gate;
  workoutId: string;
  tenantId: string;
  userId: string;
  onRefresh: () => Promise<unknown>;
  onPrepare: (consent: boolean) => Promise<void>;
}) {
  const ctx = useMemo(
    () => ({ script: session.script, rules: session.script.rules }),
    [session.script],
  );
  const [state, setState] = useState<RunnerState>(() =>
    initialRunnerState(session.script),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const [prompt, setPrompt] = useState(""),
    [notice, setNotice] = useState(""),
    [alert, setAlert] = useState(""),
    [muted, setMuted] = useState(session.mode !== "voice"),
    [listening, setListening] = useState<Listening>("off"),
    [deviceSpeech, setDeviceSpeech] = useState(false),
    [heard, setHeard] = useState(""),
    [queued, setQueued] = useState(0),
    [rejected, setRejected] = useState(0),
    [finishState, setFinishState] = useState<"none" | "waiting" | "done">("none"),
    [repsDraft, setRepsDraft] = useState(""),
    [transcriptionConsent, setTranscriptionConsent] = useState(false),
    [clipCount, setClipCount] = useState(0);
  const clips = useRef(new Map<string, string>());
  const player = useRef<HTMLAudioElement | null>(null);
  const speaking = useRef(false);
  const sayQueue = useRef<Array<Extract<RunnerEffect, { type: "say" }>>>([]);
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Finishes the prompt on screen now (used when the voice is muted mid-prompt). */
  const currentDone = useRef<(() => void) | null>(null);
  const outcomes = useRef<RunnerOutcome[]>([]);
  const keys = offlineQueueKeys("workout", tenantId, userId);
  const voiceAvailable = session.mode === "voice" && clipCount > 0;

  // ---------------------------------------------------------------- audio
  useEffect(() => {
    if (session.mode !== "voice") return;
    let cancelled = false;
    const loaded = clips.current;
    void (async () => {
      try {
        let after: string | null = null;
        do {
          const page: {
            clips: Array<{ key: string; shared: boolean; audio: string }>;
            next: string | null;
            type: string;
          } = await api(
            `/voice-sessions/${session.id}/audio${after ? `?after=${encodeURIComponent(after)}` : ""}`,
          );
          for (const clip of page.clips) {
            const bytes = Uint8Array.from(atob(clip.audio), (c) => c.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([bytes], { type: page.type }));
            const key = (clip.shared ? "s:" : "l:") + clip.key;
            const prior = loaded.get(key);
            if (prior) URL.revokeObjectURL(prior);
            loaded.set(key, url);
          }
          after = page.next;
        } while (after && !cancelled);
        if (!cancelled) setClipCount(loaded.size);
      } catch (e) {
        if (!cancelled) setNotice("Trainer voice could not be loaded: " + message(e) + " The session continues with text.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Loaded once when the session opens and again when preparation settles.
  }, [session.id, session.mode, session.audioStatus]);
  useEffect(
    () => () => {
      for (const url of clips.current.values()) URL.revokeObjectURL(url);
      clips.current.clear();
    },
    [],
  );

  // ------------------------------------------------------------ outcomes
  const flush = useCallback(
    async (status?: "running" | "completed" | "stopped") => {
      const batch = outcomes.current.splice(0, 50);
      if (!batch.length && !status) return;
      try {
        await api(`/voice-sessions/${session.id}/events`, "POST", {
          ...(status ? { status } : {}),
          outcomes: batch,
        });
      } catch {
        // Outcomes are coaching feedback, not the workout record; keep them for the next try.
        outcomes.current.unshift(...batch);
      }
    },
    [session.id],
  );

  // ----------------------------------------------------------- set queue
  const refreshQueue = useCallback(() => {
    setQueued(readList(localStorage, keys.pending).length);
    setRejected(readList<RejectedEntry<WorkoutQueueItem>>(localStorage, keys.rejected).length);
  }, [keys.pending, keys.rejected]);
  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    const result = await drainWorkoutQueue(localStorage, tenantId, userId, (p, b, h) => api(p, "POST", b, h));
    refreshQueue();
    if (result.stopped?.reason === "session")
      setNotice("Your sign-in ended. Set logs stay on this device and sync after you sign in.");
    else if (result.stopped)
      setNotice("Saved on this device. " + result.stopped.failure.message);
    else if (result.rejected.length)
      setNotice("A set log was not accepted. Review it on the workout log.");
  }, [tenantId, userId, refreshQueue]);
  useEffect(() => {
    refreshQueue();
    const online = () => void sync();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [sync, refreshQueue]);

  // ------------------------------------------------------------- effects
  const dispatchRef = useRef<(event: RunnerEvent) => void>(() => {});
  const playNext = useCallback(() => {
    const next = sayQueue.current.shift();
    if (!next) {
      speaking.current = false;
      return;
    }
    speaking.current = true;
    setPrompt(next.text);
    const urls = next.items
      .map((item) => clips.current.get("line" in item ? "l:" + item.line : "s:" + item.clip))
      .filter((u): u is string => !!u);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      currentDone.current = null;
      if (next.wait && !sayQueue.current.length) {
        speaking.current = false;
        dispatchRef.current({ type: "prompt_done" });
      } else playNext();
    };
    currentDone.current = done;
    if (!muted && voiceAvailable && urls.length === next.items.length && player.current) {
      const audio = player.current;
      let index = 0;
      const playOne = () => {
        if (index >= urls.length) return done();
        audio.src = urls[index++];
        audio.onended = playOne;
        audio.onerror = playOne;
        void audio.play().catch(() => {
          // Autoplay refused or the file failed: show the words instead.
          promptTimer.current = setTimeout(done, readingSeconds(next.text) * 1000);
        });
      };
      playOne();
    } else if (next.wait) promptTimer.current = setTimeout(done, readingSeconds(next.text) * 1000);
    else done();
  }, [muted, voiceAvailable]);
  const logSet = useCallback(
    async (effect: Extract<RunnerEffect, { type: "log_set" }>) => {
      const logicalKey = workoutId + ":" + effect.exercise + ":" + effect.set;
      const pending = readList<WorkoutQueueItem>(localStorage, keys.pending);
      const receipts = readList<string>(localStorage, keys.receipts);
      if (pending.some((p) => p.logicalKey === logicalKey) || receipts.includes(logicalKey)) return;
      pending.push({
        path: `/workouts/${workoutId}/sets`,
        logicalKey,
        body: {
          eventKey: crypto.randomUUID(),
          exercise: effect.exercise,
          set: effect.set,
          reps: effect.reps,
          loadKg: effect.loadKg,
        },
      });
      localStorage.setItem(keys.pending, JSON.stringify(pending));
      refreshQueue();
      await sync();
    },
    [workoutId, keys.pending, keys.receipts, refreshQueue, sync],
  );
  const reportPain = useCallback(
    async (description: string) => {
      player.current?.pause();
      sayQueue.current = [];
      setAlert(
        "Stop exercising. Your trainer is being told. If your symptoms are severe or urgent, get local medical help now.",
      );
      for (let attempt = 0; attempt < 3; attempt++)
        try {
          await api(`/workouts/${workoutId}/pain`, "POST", { description });
          setAlert("Session stopped and your trainer has been told. If your symptoms are severe or urgent, get local medical help now.");
          return;
        } catch (e) {
          const error = e as ApiError;
          if (error.status && error.status < 500) {
            setAlert(error.message + " Message your trainer about how you feel.");
            return;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      setAlert("You appear to be offline. Stop exercising and contact your trainer; get local medical help if symptoms are severe.");
    },
    [workoutId],
  );
  const finish = useCallback(async () => {
    await flush("completed");
    await sync();
    if (readList(localStorage, keys.pending).length) {
      setFinishState("waiting");
      return;
    }
    try {
      await api(`/workouts/${workoutId}/finish`, "POST");
      setFinishState("done");
    } catch (e) {
      setNotice(message(e));
      setFinishState("waiting");
    }
  }, [flush, sync, keys.pending, workoutId]);
  const perform = useCallback(
    (effects: RunnerEffect[]) => {
      for (const effect of effects)
        switch (effect.type) {
          case "say":
            sayQueue.current.push(effect);
            break;
          case "log_set":
            void logSet(effect);
            break;
          case "report_pain":
            void reportPain(effect.description);
            break;
          case "outcome":
            outcomes.current.push(effect.outcome);
            if (outcomes.current.length >= 10) void flush();
            break;
          case "finished":
            void finish();
            break;
        }
      if (!speaking.current && sayQueue.current.length) playNext();
    },
    [logSet, reportPain, flush, finish, playNext],
  );
  const dispatch = useCallback(
    (event: RunnerEvent) => {
      const before = stateRef.current;
      const [next, effects] = stepRunner(ctx, before, event);
      if (
        (event.type === "command" && event.command.type !== "unknown") ||
        event.type === "held" ||
        event.type === "end"
      ) {
        // A reply interrupts the current prompt.
        if (promptTimer.current) clearTimeout(promptTimer.current);
        player.current?.pause();
        sayQueue.current = [];
        speaking.current = false;
        currentDone.current = null;
      }
      stateRef.current = next;
      setState(next);
      perform(effects);
      if (next.phase === "stopped" && before.phase !== "stopped") {
        setListening("off");
        void flush("stopped");
      }
    },
    [ctx, perform, flush],
  );
  dispatchRef.current = dispatch;
  const command = useCallback(
    (c: VoiceCommand) => dispatch({ type: "command", command: c }),
    [dispatch],
  );

  // ----------------------------------------------------------------- clock
  useEffect(() => {
    if (!["rest", "set"].includes(state.phase)) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now(),
        seconds = Math.floor((now - last) / 1000);
      if (seconds >= 1) {
        last += seconds * 1000;
        dispatchRef.current({ type: "tick", seconds });
      }
    }, 250);
    return () => clearInterval(timer);
  }, [state.phase]);
  // The trainer may place a hold (for example from a note); check now and then.
  const inProgress = !["ready", "finished", "stopped"].includes(state.phase);
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => {
      void api<{ gate?: Gate }>(`/voice-sessions/${session.id}`)
        .then((view) => {
          if (view.gate?.held) dispatchRef.current({ type: "held" });
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [inProgress, session.id]);

  // ------------------------------------------------------ spoken replies
  const handleTranscript = useCallback(
    async (transcript: string, screened?: { command: VoiceCommand; trainingHeld: boolean }) => {
      const text = transcript.trim();
      if (!text) return;
      setHeard(text);
      const local = parseVoiceCommand(text);
      if (local.type === "pain") {
        command(local);
        if (!screened) void api(`/voice-sessions/${session.id}/utterance`, "POST", { transcript: text }).catch(() => {});
        return;
      }
      // The server re-screens every reply with the trainer's safety policy.
      const result =
        screened ??
        (await api<{ command: VoiceCommand; trainingHeld: boolean }>(
          `/voice-sessions/${session.id}/utterance`,
          "POST",
          { transcript: text },
        ).catch(() => null));
      if (result?.trainingHeld) {
        command({ type: "pain", transcript: text });
        return;
      }
      command(local);
    },
    [command, session.id],
  );
  useEffect(() => {
    void onDeviceRecognition(document.documentElement.lang || "en-US").then(setDeviceSpeech);
  }, []);
  useEffect(() => {
    if (listening !== "device") return;
    const Ctor = recognitionConstructor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.processLocally = true;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = document.documentElement.lang || "en-US";
    let active = true;
    recognition.onresult = (e: any) => {
      const result = e.results[e.results.length - 1];
      if (result?.isFinal) void handleTranscript(String(result[0]?.transcript ?? ""));
    };
    recognition.onend = () => {
      if (active) {
        try {
          recognition.start();
        } catch {}
      }
    };
    recognition.onerror = (e: any) => {
      if (["not-allowed", "service-not-allowed", "language-not-supported"].includes(e?.error)) {
        active = false;
        setListening("off");
        setNotice("Spoken replies stopped: the microphone or on-device recognition is unavailable. Use the buttons.");
      }
    };
    try {
      recognition.start();
    } catch {}
    return () => {
      active = false;
      try {
        recognition.stop();
      } catch {}
    };
  }, [listening, handleTranscript]);
  useEffect(() => {
    if (listening !== "server") return;
    let stream: MediaStream | null = null,
      audioContext: AudioContext | null = null,
      stopped = false,
      frame = 0;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        setListening("off");
        setNotice("Microphone permission is needed for spoken replies. Use the buttons.");
        return;
      }
      audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let recorder: MediaRecorder | null = null,
        started = 0,
        quietSince = 0,
        chunks: Blob[] = [];
      const loop = () => {
        if (stopped) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        const loud = Math.sqrt(sum / samples.length) > 0.03,
          now = performance.now();
        // Never transcribe the trainer's own voice while it plays.
        if (!recorder && loud && !speaking.current) {
          chunks = [];
          recorder = new MediaRecorder(stream!);
          recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          recorder.onstop = () => {
            const duration = performance.now() - started;
            const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
            const type = speechType(blob.type);
            if (duration < 300 || !type || blob.size > 480000) return;
            void blobBase64(blob).then((audio) =>
              api<{ transcript: string; command: VoiceCommand; trainingHeld: boolean }>(
                `/voice-sessions/${session.id}/transcribe`,
                "POST",
                { audio, type, durationMs: Math.min(15000, Math.max(200, Math.round(duration))) },
              )
                .then((r) => handleTranscript(r.transcript, { command: r.command, trainingHeld: r.trainingHeld }))
                .catch((e) => setNotice(message(e))),
            );
          };
          recorder.start();
          started = now;
          quietSince = 0;
        } else if (recorder) {
          if (loud) quietSince = 0;
          else if (!quietSince) quietSince = now;
          if ((quietSince && now - quietSince > 800) || now - started > 6000) {
            const r = recorder;
            recorder = null;
            r.stop();
          }
        }
        frame = requestAnimationFrame(loop);
      };
      loop();
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      void audioContext?.close().catch(() => {});
    };
  }, [listening, handleTranscript, session.id]);

  const startListening = async (mode: Listening) => {
    if (mode === "server" && !gate.transcriptionConsent) {
      if (!transcriptionConsent) {
        setNotice("Agree to transcription first.");
        return;
      }
      try {
        await api("/voice-sessions/consent", "POST", { transcription: true });
        await onRefresh();
      } catch (e) {
        setNotice(message(e));
        return;
      }
    }
    setListening(mode);
  };
  const withdrawVoice = async () => {
    try {
      await api("/voice-sessions/consent", "POST", { playback: false });
      setListening("off");
      await onRefresh();
      setNotice("Your trainer's voice is off and its stored audio for you was removed. The session continues with text.");
    } catch (e) {
      setNotice(message(e));
    }
  };

  const ex = session.script.exercises[state.exercise];
  const target = state.targets[state.exercise]?.[state.set - 1];
  const running = !["ready", "finished", "stopped"].includes(state.phase);
  const clock =
    state.phase === "rest"
      ? state.restRemaining
      : state.phase === "set"
        ? state.setElapsed
        : null;
  return (
    <>
      <section className="card voice-status-card" aria-labelledby="voice-mode">
        <div className="card-heading">
          <h2 id="voice-mode">
            {session.mode === "voice" ? "Your trainer's voice" : "Text-guided session"}
          </h2>
          <span className={"badge" + (session.mode === "voice" ? "" : " amber")}>
            {session.audioStatus === "generating"
              ? `Preparing ${session.audio.ready}/${session.audio.total}`
              : session.mode === "voice"
                ? session.audioStatus === "capped"
                  ? "Voice limit reached"
                  : "Voice ready"
                : "Text"}
          </span>
        </div>
        {session.unavailableReason && <p className="muted">{session.unavailableReason.message}</p>}
        {session.audioStatus === "generating" && (
          <p className="muted">
            Your trainer's voice is being prepared. You can start now; lines that are not ready are shown as text.
          </p>
        )}
        {session.audioStatus === "capped" && (
          <p className="muted">Today's voice limit was reached. The rest of this session is shown as text.</p>
        )}
        {session.mode === "text" && gate.mode === "voice" && (
          <button className="button secondary" onClick={() => void onPrepare(false)}>
            Switch to your trainer's voice
          </button>
        )}
        {session.mode === "text" && gate.reasons.length === 1 && gate.reasons[0].code === "PLAYBACK_CONSENT" && (
          <button className="button secondary" onClick={() => void onPrepare(true)}>
            Use my trainer's approved voice
          </button>
        )}
        <div className="button-row">
          <button
            className="button secondary"
            aria-pressed={muted}
            onClick={() => {
              if (!muted) {
                // Muting mid-prompt: the words stay on screen for reading time.
                player.current?.pause();
                const done = currentDone.current;
                if (done)
                  promptTimer.current = setTimeout(done, readingSeconds(prompt) * 1000);
              }
              setMuted(!muted);
            }}
          >
            {muted ? "Unmute voice" : "Mute voice"}
          </button>
          {session.mode === "voice" && (
            <button className="text-button" onClick={() => void withdrawVoice()}>
              Stop using my trainer's voice
            </button>
          )}
        </div>
      </section>

      {alert && (
        <p className="notice error voice-alert" role="alert">
          {alert}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <section className="card voice-runner" aria-labelledby="voice-now">
        <h2 id="voice-now" className="voice-now">
          {runnerStatus(ctx, state)}
        </h2>
        {ex && ["setup", "set", "rest"].includes(state.phase) && target && (
          <p className="voice-target">
            {ex.name} · set {state.set} of {ex.sets} · {target.reps} reps
            {target.loadKg > 0 ? ` · ${target.loadKg} kg` : ""}
            {target.loadKg < ex.loadKg ? " (lighter)" : ""}
          </p>
        )}
        {clock !== null && (
          <p className="voice-clock" aria-hidden="true">
            {Math.floor(clock / 60)}:{String(clock % 60).padStart(2, "0")}
          </p>
        )}
        <p className="voice-prompt" aria-live="polite">
          {prompt}
        </p>
        <audio ref={player} preload="none" hidden />
        {state.phase === "ready" ? (
          <button
            className="button voice-start"
            onClick={() => {
              void flush("running");
              dispatch({ type: "start" });
            }}
          >
            Start session
          </button>
        ) : running ? (
          <>
            <div className="voice-commands" role="group" aria-label="Session replies">
              <button className="button" onClick={() => command({ type: "done" })}>
                Done
              </button>
              <button className="button secondary" onClick={() => command({ type: "too_heavy" })}>
                Too heavy
              </button>
              <button className="button secondary" onClick={() => command({ type: "too_easy" })}>
                Too easy
              </button>
              <button className="button secondary" onClick={() => command({ type: "skip" })}>
                Skip
              </button>
              <button className="button secondary" onClick={() => command({ type: "repeat" })}>
                Repeat
              </button>
              {state.phase === "paused" ? (
                <button className="button secondary" onClick={() => command({ type: "resume" })}>
                  Resume
                </button>
              ) : (
                <button className="button secondary" onClick={() => command({ type: "pause" })}>
                  Pause
                </button>
              )}
            </div>
            {state.phase === "set" && (
              <form
                className="voice-reps"
                onSubmit={(e) => {
                  e.preventDefault();
                  const reps = Number(repsDraft);
                  if (!Number.isInteger(reps) || reps < 0 || reps > 200) return;
                  setRepsDraft("");
                  command({ type: "reps", reps });
                }}
              >
                <label>
                  <span>Reps done</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={200}
                    value={repsDraft}
                    onChange={(e) => setRepsDraft(e.target.value)}
                  />
                </label>
                <button className="button secondary" type="submit">
                  Log reps
                </button>
              </form>
            )}
            <button
              className="button voice-pain"
              onClick={() => command({ type: "pain", transcript: "Pain button pressed during the voice session" })}
            >
              Pain — stop now
            </button>
            <button
              className="text-button"
              onClick={() => dispatch({ type: "end" })}
            >
              End session without finishing
            </button>
          </>
        ) : state.phase === "finished" ? (
          <p className="notice">
            {finishState === "done"
              ? "Workout finished and saved."
              : finishState === "waiting"
                ? "Session complete. Your workout will be finished once your set logs sync."
                : "Session complete."}
            {finishState === "waiting" && (
              <button className="text-button" onClick={() => void finish()}>
                Try again
              </button>
            )}
          </p>
        ) : null}
        {(queued > 0 || rejected > 0) && (
          <p className="muted" role="status">
            {queued > 0 && `${queued} set logs waiting to sync. `}
            {rejected > 0 && `${rejected} set logs need attention on the workout log.`}
          </p>
        )}
      </section>

      {running && (
        <section className="card" aria-labelledby="voice-replies">
          <h2 id="voice-replies">Spoken replies</h2>
          <p className="muted">
            Say “done”, a number of reps, “too heavy”, “pause”, “skip” or “pain”.
            The buttons always work.
          </p>
          {listening === "off" ? (
            <div className="stack">
              {deviceSpeech && (
                <button className="button secondary" onClick={() => void startListening("device")}>
                  Listen on this device
                </button>
              )}
              {gate.speechToText && session.mode === "voice" && (
                <>
                  {!gate.transcriptionConsent && (
                    <label className="voice-check">
                      <input
                        type="checkbox"
                        checked={transcriptionConsent}
                        onChange={(e) => setTranscriptionConsent(e.target.checked)}
                      />{" "}
                      Send short clips of my replies to the speech service for
                      transcription. Clips are not stored.
                    </label>
                  )}
                  <button
                    className="button secondary"
                    disabled={!gate.transcriptionConsent && !transcriptionConsent}
                    onClick={() => void startListening("server")}
                  >
                    Listen with the speech service
                  </button>
                </>
              )}
              {!deviceSpeech && !(gate.speechToText && session.mode === "voice") && (
                <p className="muted">Spoken replies are not available on this device. Use the buttons.</p>
              )}
            </div>
          ) : (
            <div className="stack">
              <p role="status">
                Listening{listening === "device" ? " on this device" : " with the speech service"}.
                {heard && ` Heard: “${heard}”.`}
              </p>
              <button className="button secondary" onClick={() => setListening("off")}>
                Stop listening
              </button>
              {listening === "server" && (
                <button
                  className="text-button"
                  onClick={() => {
                    setListening("off");
                    void api("/voice-sessions/consent", "POST", { transcription: false })
                      .then(() => onRefresh())
                      .catch((e) => setNotice(message(e)));
                  }}
                >
                  Withdraw transcription permission
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
