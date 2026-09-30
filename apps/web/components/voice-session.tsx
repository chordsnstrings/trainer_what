"use client";
// Hands-free, voice-led workout session. The pure state machine
// (packages/domain/src/voice-runner.ts) decides what happens; this component
// plays the trainer-voice clips (or shows the words), runs the clock, listens
// for spoken replies and performs the effects: set logs go through the same
// device queue as the workout page, pain opens the existing safety hold.
import { queuedSummary } from "./pwa";
import { ProgressRing, Skeleton, StickyActionBar } from "./phone-ui";
import { AlertCircle, Mic } from "lucide-react";
import { formatDate, formatSetsReps } from "../lib/format";
import { translator, type Locale, type Translator } from "../lib/i18n/core";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import voiceMessages from "../lib/i18n/messages/voice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ECHO_GRACE_MS,
  heardReply,
  initialRunnerState,
  stepRunner,
  type RunnerEffect,
  type RunnerEvent,
  type RunnerOutcome,
  type RunnerState,
  type VoiceCommand,
} from "../../../packages/domain/src/voice-runner.ts";
import type { SessionScript } from "../../../packages/domain/src/voice-session.ts";
import { workMeasure, workText } from "../../../packages/domain/src/prescription.ts";
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
type VoiceT = Translator<(typeof voiceMessages)["en"]>;

/** The runner's status line (runnerStatus in the domain), in the page language. */
function statusLine(
  ctx: { script: SessionScript },
  s: RunnerState,
  t: VoiceT,
) {
  const ex = ctx.script.exercises[s.exercise];
  const target = s.targets[s.exercise]?.[s.set - 1];
  switch (s.phase) {
    case "ready":
      return t("status_ready");
    case "intro":
    case "warmup":
      return t("status_warmup");
    case "setup":
      return t("status_setup", { name: ex.name });
    case "set": {
      const params = {
        name: ex.name,
        set: s.set,
        sets: ex.sets,
        reps: t("reps", { count: target.reps }),
      };
      return target.loadKg > 0
        ? t("status_setLoad", {
            ...params,
            load: t("load", { load: target.loadKg }),
          })
        : t("status_set", params);
    }
    case "rest":
      return t("status_rest", { count: s.restRemaining });
    case "cooldown":
      return t("status_cooldown");
    case "finished":
      return t("status_finished");
    case "paused":
      return t("status_paused");
    case "stopped":
      return s.stopReason === "pain"
        ? t("status_pain")
        : s.stopReason === "member"
          ? t("status_member")
          : t("status_review");
  }
  return "";
}

type Gate = {
  mode: "voice" | "text";
  reasons: Array<{ code: string; message: string }>;
  premium: boolean;
  voiceReady: boolean;
  contractReady: boolean;
  playbackConsent: boolean;
  transcriptionConsent: boolean;
  speechToText: boolean;
  speechProvider?: { name: string; zeroRetention: boolean } | null;
  held: boolean;
  budget: { spentUsd: number; capUsd: number; reached: boolean } | null;
};
type SessionView = {
  id: string;
  workoutId: string | null;
  plannedSessionId?: string | null;
  mode: "voice" | "text";
  status: string;
  runnable?: boolean;
  stale?: boolean;
  scriptFingerprint?: string;
  audioStatus: string;
  unavailableReason: { code: string; message: string } | null;
  script: SessionScript;
  audio: {
    ready: number;
    total: number;
    failed: number;
    sharedReady: number;
    sharedTotal: number;
    readyKeys?: string[];
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
/** The language spoken replies are recognised in; "" follows the app. */
type ReplyLanguage = "" | "en" | "ar";
const REPLY_LANGUAGE_KEY = "voice-reply-language";
/** A per-device choice; unreadable storage falls back to the app's language. */
function savedReplyLanguage(): ReplyLanguage {
  try {
    const value = localStorage.getItem(REPLY_LANGUAGE_KEY);
    return value === "en" || value === "ar" ? value : "";
  } catch {
    return "";
  }
}
function appLanguage() {
  return (typeof document !== "undefined" && document.documentElement.lang) || "en-US";
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

type Planned = {
  id: string;
  status: string;
  date: string | null;
  label: string | null;
  programId: string | null;
  title: string | null;
  workoutId: string | null;
};
type Loaded = {
  gate: Gate;
  session: SessionView | null;
  stale?: boolean;
  planned?: Planned;
  workoutStatus?: string;
};

/** The count a plural agrees with: the last number in "10" or "8-12". */
const lastCount = (value: unknown) => {
  const numbers = String(value ?? "").match(/\d+/g);
  return numbers ? Number(numbers[numbers.length - 1]) : 0;
};

/**
 * The voice-led session page. `workoutId` runs the session for an active
 * workout; `plannedSessionId` prepares it ahead of the day, so the trainer's
 * voice is ready before the member starts.
 */
export function VoiceSessionRunner({
  workoutId,
  plannedSessionId,
  tenantId,
  userId,
}: {
  workoutId?: string;
  plannedSessionId?: string;
  tenantId: string;
  userId: string;
}) {
  const [gate, setGate] = useState<Gate | null>(null),
    [session, setSession] = useState<SessionView | null>(null),
    [planned, setPlanned] = useState<Planned | null>(null),
    [stale, setStale] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [loaded, setLoaded] = useState(false);
  const t = useT("voice"),
    locale = useLocale(),
    toError = useErrorText();
  const errorRef = useRef(toError);
  errorRef.current = toError;
  const message = (e: unknown) => errorRef.current(e);
  const ahead = !workoutId && !!plannedSessionId;
  const refresh = useCallback(async () => {
    const r = await api<Loaded>(
      ahead
        ? `/voice-sessions/planned/${plannedSessionId}`
        : `/voice-sessions/workout/${workoutId}`,
    );
    setGate(r.gate);
    setSession(r.session);
    setStale(!!r.stale);
    setPlanned(r.planned ?? null);
    setLoaded(true);
    return r;
  }, [ahead, workoutId, plannedSessionId]);
  useEffect(() => {
    void refresh().catch((e) => {
      setNotice(errorRef.current(e));
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
        ...(ahead ? { plannedSessionId } : { workoutId }),
        ...(playbackConsent ? { playbackConsent: true } : {}),
      });
      setSession(view);
      setStale(false);
      if (view.gate) setGate(view.gate);
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(false);
    }
  };
  const startWorkout = async () => {
    if (!planned?.programId) return;
    setBusy(true);
    setNotice("");
    try {
      const workout = await api<{ id: string }>("/workouts/start", "POST", {
        programId: planned.programId,
        plannedSessionId: planned.id,
      });
      window.location.assign(`/app/voice-session/${workout.id}`);
    } catch (e) {
      setNotice(message(e));
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
        <section className="card">
          <Skeleton label={t("loading")} lines={4} block />
        </section>
      </div>
    );
  const startedWorkout =
    ahead && planned?.status === "started" && planned.workoutId ? planned.workoutId : null;
  const plannedOpen = !ahead || planned?.status === "planned";
  return (
    <div className="stack voice-session">
      <div className="page-heading">
        <p className="eyebrow">
          {session?.mode === "text" ||
          (gate && gate.mode === "text" && !voiceBlockedOnlyByConsentFor(gate))
            ? t("eyebrowGuided")
            : t("eyebrow")}
        </p>
        <h1>
          {session?.script.title ?? planned?.title ?? t("fallbackTitle")}
        </h1>
        <p className="muted">
          {ahead
            ? planned?.date
              ? t("aheadOn", {
                  date: formatDate(planned.date, {
                    weekday: true,
                    year: false,
                    locale,
                    fallback: planned.date,
                  }),
                })
              : t("aheadDay")
            : ""}
          {session?.mode === "text" ||
          (gate && gate.mode === "text" && !voiceBlockedOnlyByConsentFor(gate))
            ? t("introText")
            : t("intro")}
        </p>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {startedWorkout && (
        <p className="notice">
          {t("started")}{" "}
          <a className="text-link" href={`/app/voice-session/${startedWorkout}`}>
            {t("openRunner")}
          </a>
        </p>
      )}
      {ahead && !plannedOpen && !startedWorkout && (
        <p className="notice">{t("notOpen")}</p>
      )}
      {!session && gate && plannedOpen && !startedWorkout && (
        <section className="card" aria-labelledby="voice-prepare">
          <h2 id="voice-prepare">{t("prepareTitle")}</h2>
          {stale && <p className="notice">{t("staleText")}</p>}
          {gate.held ? (
            <p className="notice error" role="alert">
              {t("held")}
            </p>
          ) : (
            <>
              {gate.mode === "voice" || voiceBlockedOnlyByConsent ? (
                <>
                  <p>{t("voiceText")}</p>
                  {voiceBlockedOnlyByConsent && (
                    <label className="voice-check">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />{" "}
                      {t("consentVoice")}
                    </label>
                  )}
                  <StickyActionBar label={t("sessionActions")}>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void prepare(false)}
                    >
                      {t("useText")}
                    </button>
                    <button
                      className="button voice-prepare"
                      disabled={busy || (voiceBlockedOnlyByConsent && !consent)}
                      onClick={() => void prepare(voiceBlockedOnlyByConsent)}
                    >
                      {t("prepareVoice")}
                    </button>
                  </StickyActionBar>
                </>
              ) : (
                <>
                  {/* One plain reason, never the list of internal checks. */}
                  <p className="voice-reason">
                    {voiceReason(gate.reasons, locale)}
                  </p>
                  <StickyActionBar label={t("sessionActions")}>
                    <button
                      className="button voice-prepare"
                      disabled={busy}
                      onClick={() => void prepare(false)}
                    >
                      {ahead ? t("prepareText") : t("startText")}
                    </button>
                  </StickyActionBar>
                </>
              )}
            </>
          )}
        </section>
      )}
      {session && gate && ahead && plannedOpen && (
        <section className="card voice-status-card" aria-labelledby="voice-ahead">
          <div className="card-heading">
            <h2 id="voice-ahead">
              {session.mode === "voice" ? t("trainerVoice") : t("textSession")}
            </h2>
            {audioBadge(session, t) && (
              <span className={"badge" + (session.mode === "voice" ? "" : " amber")}>
                {audioBadge(session, t)}
              </span>
            )}
          </div>
          {session.unavailableReason && (
            <p className="muted">
              {voiceReason([session.unavailableReason], locale)}
            </p>
          )}
          <p className="muted">
            {session.audioStatus === "generating"
              ? t("preparingAhead")
              : t("readyAhead")}
          </p>
          {session.mode === "text" && gate.mode === "voice" && (
            <button className="button secondary" disabled={busy} onClick={() => void prepare(false)}>
              {t("switchVoice")}
            </button>
          )}
          <button className="button" disabled={busy || gate.held} onClick={() => void startWorkout()}>
            {t("startWithVoice")}
          </button>
        </section>
      )}
      {session && gate && !ahead && (
        <Runner
          key={session.id}
          session={session}
          gate={gate}
          workoutId={workoutId!}
          tenantId={tenantId}
          userId={userId}
          onRefresh={refresh}
          onPrepare={prepare}
        />
      )}
      {workoutId ? (
        <a className="text-link" href={`/app/workouts/${workoutId}`}>
          {t("openLog")}
        </a>
      ) : (
        <a className="text-link" href="/app/program">
          {t("backCalendar")}
        </a>
      )}
    </div>
  );
}
/**
 * One plain reason a session is guided in text instead of the coach's voice
 * (the server lists every check that failed). Most important first; the
 * member can act on the membership and the permission, not on the rest.
 */
export function voiceReason(
  reasons: Array<{ code: string; message?: string }>,
  locale: Locale = "en",
) {
  const t = translator(voiceMessages, locale);
  const codes = new Set(reasons.map((r) => r.code));
  if (codes.has("TRAINING_HELD")) return t("vrHeld");
  if (codes.has("MEMBERSHIP_REQUIRED")) return t("vrMembership");
  // The same order as the server's stored reason (voice-session.ts), so
  // the preparation page and the running session say the same thing.
  if (codes.has("VOICE_MEMBERSHIP")) return t("vrVoicePlan");
  if (
    codes.has("VOICE_CONTRACT") ||
    codes.has("VOICE_NOT_VERIFIED") ||
    codes.has("VOICE_UNAVAILABLE")
  )
    return t("vrUnavailable");
  if (codes.has("VOICE_BUDGET")) return t("vrBudget");
  if (codes.has("VOICE_SCRIPT_INVALID")) return t("vrScript");
  if (codes.has("PLAYBACK_CONSENT")) return t("vrConsent");
  return t("vrText");
}
function voiceBlockedOnlyByConsentFor(gate: { reasons: Array<{ code: string }> }) {
  return (
    gate.reasons.length > 0 &&
    gate.reasons.every((r) => r.code === "PLAYBACK_CONSENT")
  );
}
const audioBadge = (session: SessionView, t: VoiceT) =>
  session.audioStatus === "generating"
    ? t("badgePreparing", {
        // One run "3/10" (an isolate with no strong letter reads left to right).
        progress: `${session.audio.ready}/${session.audio.total}`,
      })
    : session.mode === "voice"
      ? session.audioStatus === "capped"
        ? t("badgePaused")
        : t("badgeReady")
      : // The heading already says "Text-guided session".
        "";

/** Holds whether the trainer's voice is audible now, for the echo guard. */
type Playback = {
  playing: boolean;
  endedAt: number;
  prompts: string[];
  listeners: Set<(playing: boolean) => void>;
};

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
  // The script only changes with its fingerprint; a progress poll hands over a
  // new object each time, which must not reset listening or the runner.
  const script = useMemo(
    () => session.script,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.id, session.scriptFingerprint],
  );
  const ctx = useMemo(() => ({ script, rules: script.rules }), [script]);
  const t = useT("voice"),
    toError = useErrorText();
  // Callbacks and listening effects read the current wording through a ref,
  // so a language change never restarts the microphone or the runner.
  const words = useRef({ t, toError });
  words.current = { t, toError };
  const message = (e: unknown) => words.current.toError(e);
  const [state, setState] = useState<RunnerState>(() => initialRunnerState(script));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [prompt, setPrompt] = useState(""),
    [notice, setNotice] = useState(""),
    [alert, setAlert] = useState(""),
    [muted, setMuted] = useState(false),
    [listening, setListening] = useState<Listening>("off"),
    [deviceSpeech, setDeviceSpeech] = useState(false),
    [heard, setHeard] = useState(""),
    [queued, setQueued] = useState(0),
    [rejected, setRejected] = useState(0),
    [finishState, setFinishState] = useState<"none" | "waiting" | "done">("none"),
    [repsDraft, setRepsDraft] = useState(""),
    [transcriptionConsent, setTranscriptionConsent] = useState(false),
    [clipCount, setClipCount] = useState(0),
    [changed, setChanged] = useState(false),
    // The language the member replies in: "" follows the app's language.
    [replyLanguage, setReplyLanguage] = useState<ReplyLanguage>(savedReplyLanguage);
  const replyLanguageRef = useRef(replyLanguage);
  replyLanguageRef.current = replyLanguage;
  const recognitionLang =
    replyLanguage === "ar" ? "ar-AE" : replyLanguage === "en" ? "en-US" : appLanguage();
  const clips = useRef(new Map<string, string>());
  const player = useRef<HTMLAudioElement | null>(null);
  const speaking = useRef(false);
  const playback = useRef<Playback>({ playing: false, endedAt: 0, prompts: [], listeners: new Set() });
  const sayQueue = useRef<Array<Extract<RunnerEffect, { type: "say" }>>>([]);
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Finishes the prompt on screen now (used when the voice is muted mid-prompt). */
  const currentDone = useRef<(() => void) | null>(null);
  const outcomes = useRef<RunnerOutcome[]>([]);
  const keys = offlineQueueKeys("workout", tenantId, userId);
  const voiceMode = session.mode === "voice";
  const voiceAvailable = voiceMode && clipCount > 0;
  const runnable = session.runnable !== false && ["ready", "running"].includes(session.status);

  const setPlaying = useCallback((playing: boolean) => {
    const p = playback.current;
    if (p.playing === playing) return;
    p.playing = playing;
    if (!playing) p.endedAt = Date.now();
    for (const listener of p.listeners) listener(playing);
  }, []);

  // ---------------------------------------------------------------- audio
  // Clips are fetched by key as they become ready, so early lines play in the
  // trainer's voice while the rest of the session is still being prepared.
  const readyKeys = voiceMode ? session.audio.readyKeys ?? [] : [];
  const readySignature = readyKeys.join(",");
  useEffect(() => {
    const loaded = clips.current;
    if (!voiceMode) {
      // Voice withdrawn or revoked: the session carries on as text.
      player.current?.pause();
      for (const url of loaded.values()) URL.revokeObjectURL(url);
      loaded.clear();
      setClipCount(0);
      return;
    }
    const missing = readySignature ? readySignature.split(",").filter((k) => !loaded.has(k)) : [];
    if (!missing.length) return;
    let cancelled = false;
    void (async () => {
      try {
        for (let i = 0; i < missing.length && !cancelled; i += 40) {
          const chunk = missing.slice(i, i + 40);
          const page: {
            clips: Array<{ key: string; shared: boolean; audio: string }>;
            type: string;
          } = await api(`/voice-sessions/${session.id}/audio?keys=${encodeURIComponent(chunk.join(","))}`);
          for (const clip of page.clips) {
            const bytes = Uint8Array.from(atob(clip.audio), (c) => c.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([bytes], { type: page.type }));
            const key = (clip.shared ? "s:" : "l:") + clip.key;
            const prior = loaded.get(key);
            if (prior) URL.revokeObjectURL(prior);
            loaded.set(key, url);
          }
          setClipCount(loaded.size);
          if (!page.clips.length) break;
        }
      } catch (e) {
        if (!cancelled)
          setNotice(
            words.current.t("loadFailed", {
              reason: words.current.toError(e),
            }),
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.id, voiceMode, readySignature]);
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
  const flushRef = useRef(flush);
  flushRef.current = flush;
  // Buffered outcomes are sent when the page closes or the session is replaced.
  useEffect(() => () => void flushRef.current(), []);

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
      setNotice(words.current.t("signedOut"));
    else if (result.stopped)
      setNotice(
        words.current.t("savedHere", {
          reason: words.current.toError(result.stopped.failure),
        }),
      );
    else if (result.rejected.length) setNotice(words.current.t("notAccepted"));
  }, [tenantId, userId, refreshQueue]);
  useEffect(() => {
    refreshQueue();
    const online = () => void sync();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [sync, refreshQueue]);

  // ------------------------------------------------------------- effects
  const dispatchRef = useRef<(event: RunnerEvent) => void>(() => {});
  const audible = !muted && voiceAvailable;
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
      setPlaying(false);
      if (next.wait && !sayQueue.current.length) {
        speaking.current = false;
        dispatchRef.current({ type: "prompt_done" });
      } else playNext();
    };
    currentDone.current = done;
    if (audible && urls.length === next.items.length && player.current) {
      const audio = player.current;
      // The echo guard ignores replies while this plays and briefly after.
      playback.current.prompts = [next.text, ...playback.current.prompts].slice(0, 3);
      setPlaying(true);
      let index = 0;
      const playOne = () => {
        if (index >= urls.length) return done();
        audio.src = urls[index++];
        audio.onended = playOne;
        audio.onerror = playOne;
        void audio.play().catch(() => {
          // Autoplay refused or the file failed: show the words instead.
          setPlaying(false);
          promptTimer.current = setTimeout(done, readingSeconds(next.text) * 1000);
        });
      };
      playOne();
    } else if (next.wait) promptTimer.current = setTimeout(done, readingSeconds(next.text) * 1000);
    else done();
  }, [audible, setPlaying]);
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
          // A round of timed or distance work logs what was done.
          ...(effect.durationSeconds !== undefined ? { durationSeconds: effect.durationSeconds } : {}),
          ...(effect.distanceMeters !== undefined ? { distanceMeters: effect.distanceMeters } : {}),
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
      setPlaying(false);
      sayQueue.current = [];
      const { t: say, toError: explain } = words.current;
      setAlert(say("stopNow"));
      for (let attempt = 0; attempt < 3; attempt++)
        try {
          await api(`/workouts/${workoutId}/pain`, "POST", { description });
          setAlert(say("stopped"));
          return;
        } catch (e) {
          const error = e as ApiError;
          if (error.status && error.status < 500) {
            setAlert(say("painRefused", { reason: explain(error) }));
            return;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      setAlert(say("painOffline"));
    },
    [workoutId, setPlaying],
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
            // "I didn't do the last one": the trainer is told; a set already
            // logged stays logged until the member corrects it.
            if (effect.outcome.type === "not_done")
              setNotice(
                effect.outcome.logged
                  ? t("notDoneLogged")
                  : t("notDoneNoted"),
              );
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
        (event.type === "command" && !["unknown", "ack"].includes(event.command.type)) ||
        event.type === "held" ||
        event.type === "end"
      ) {
        // A reply interrupts the current prompt.
        if (promptTimer.current) clearTimeout(promptTimer.current);
        player.current?.pause();
        setPlaying(false);
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
    [ctx, perform, flush, setPlaying],
  );
  dispatchRef.current = dispatch;
  const command = useCallback(
    (c: VoiceCommand) => dispatch({ type: "command", command: c }),
    [dispatch],
  );
  // Voice switched off mid-prompt: the words stay on screen for reading time.
  useEffect(() => {
    if (audible || !playback.current.playing) return;
    player.current?.pause();
    setPlaying(false);
    const done = currentDone.current;
    if (done) promptTimer.current = setTimeout(done, readingSeconds(prompt) * 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audible]);

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
  // The trainer may place a hold (for example from a note) or change the
  // workout (a substitution); check now and then.
  const inProgress = !["ready", "finished", "stopped"].includes(state.phase);
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => {
      void api<SessionView & { gate?: Gate }>(`/voice-sessions/${session.id}`)
        .then((view) => {
          if (view.gate?.held) dispatchRef.current({ type: "held" });
          else if (view.stale) {
            dispatchRef.current({ type: "end" });
            setChanged(true);
          }
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [inProgress, session.id]);

  // ------------------------------------------------------ spoken replies
  const handleTranscript = useCallback(
    async (
      transcript: string,
      screened?: { command: VoiceCommand; trainingHeld: boolean; sincePlaybackMs: number },
    ) => {
      const text = transcript.trim();
      if (!text) return;
      // A hold opened by the server's screening is final, whatever was heard.
      if (screened?.trainingHeld) {
        setHeard(text);
        command({ type: "pain", transcript: text });
        return;
      }
      const p = playback.current;
      const local = heardReply({
        transcript: text,
        playing: screened ? false : p.playing,
        sincePlaybackMs: screened ? screened.sincePlaybackMs : Date.now() - p.endedAt,
        prompts: p.prompts,
      });
      // The trainer's own voice from the speaker is not a reply.
      if (!local) return;
      setHeard(text);
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
  // The listening effects read the latest handler through a ref, so progress
  // polls and runner changes never restart the microphone mid-reply.
  const transcriptRef = useRef(handleTranscript);
  transcriptRef.current = handleTranscript;
  useEffect(() => {
    void onDeviceRecognition(recognitionLang).then(setDeviceSpeech);
  }, [recognitionLang]);
  useEffect(() => {
    if (listening !== "device") return;
    const Ctor = recognitionConstructor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.processLocally = true;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = recognitionLang;
    let active = true,
      running = false,
      restart: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      if (!active || running || playback.current.playing) return;
      try {
        recognition.start();
        running = true;
      } catch {}
    };
    recognition.onresult = (e: any) => {
      const result = e.results[e.results.length - 1];
      if (result?.isFinal) void transcriptRef.current(String(result[0]?.transcript ?? ""));
    };
    recognition.onend = () => {
      running = false;
      if (active && !playback.current.playing) restart = setTimeout(start, 250);
    };
    recognition.onerror = (e: any) => {
      if (["not-allowed", "service-not-allowed", "language-not-supported"].includes(e?.error)) {
        active = false;
        setListening("off");
        setNotice(words.current.t("micUnavailable"));
      }
    };
    // Recognition is off while the trainer's voice plays (its echo would be
    // heard as a reply) and resumes shortly after.
    const onPlayback = (playing: boolean) => {
      if (restart) clearTimeout(restart);
      if (playing) {
        try {
          recognition.abort();
        } catch {}
      } else restart = setTimeout(start, ECHO_GRACE_MS);
    };
    playback.current.listeners.add(onPlayback);
    start();
    return () => {
      active = false;
      playback.current.listeners.delete(onPlayback);
      if (restart) clearTimeout(restart);
      try {
        recognition.abort();
      } catch {}
    };
  }, [listening, recognitionLang]);
  useEffect(() => {
    if (listening !== "server") return;
    let stream: MediaStream | null = null,
      audioContext: AudioContext | null = null,
      stopped = false,
      frame = 0;
    let recorder: MediaRecorder | null = null,
      discard = false;
    // A recording that overlaps the trainer's voice is thrown away unsent.
    const onPlayback = (playing: boolean) => {
      if (playing && recorder) {
        discard = true;
        const r = recorder;
        recorder = null;
        try {
          r.stop();
        } catch {}
      }
    };
    playback.current.listeners.add(onPlayback);
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        setListening("off");
        setNotice(words.current.t("micPermission"));
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let started = 0,
        quietSince = 0,
        chunks: Blob[] = [];
      const loop = () => {
        if (stopped) return;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        const loud = Math.sqrt(sum / samples.length) > 0.03,
          now = performance.now();
        const p = playback.current;
        // Never record while the trainer's voice plays or just after it.
        const quietSpeaker = !p.playing && Date.now() - p.endedAt >= ECHO_GRACE_MS;
        if (!recorder && loud && quietSpeaker) {
          chunks = [];
          discard = false;
          const sincePlaybackMs = Date.now() - p.endedAt;
          let rec: MediaRecorder;
          try {
            rec = new MediaRecorder(stream!, { audioBitsPerSecond: 16000 });
          } catch {
            rec = new MediaRecorder(stream!);
          }
          recorder = rec;
          rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          rec.onstop = () => {
            if (discard || stopped) return;
            const duration = performance.now() - started;
            const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
            const type = speechType(blob.type);
            if (duration < 300 || !type || blob.size > 480000) return;
            void blobBase64(blob).then((audio) =>
              api<{ transcript: string; command: VoiceCommand; trainingHeld: boolean }>(
                `/voice-sessions/${session.id}/transcribe`,
                "POST",
                {
                  audio,
                  type,
                  durationMs: Math.min(15000, Math.max(200, Math.round(duration))),
                  ...(replyLanguageRef.current ? { language: replyLanguageRef.current } : {}),
                },
              )
                .then((r) =>
                  transcriptRef.current(r.transcript, { command: r.command, trainingHeld: r.trainingHeld, sincePlaybackMs }),
                )
                .catch((e) => setNotice(message(e))),
            );
          };
          rec.start();
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
      playback.current.listeners.delete(onPlayback);
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      void audioContext?.close().catch(() => {});
    };
  }, [listening, session.id]);

  const startListening = async (mode: Listening) => {
    if (mode === "server" && !gate.transcriptionConsent) {
      if (!transcriptionConsent) {
        setNotice(t("agreeFirst"));
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
      if (listening === "server") setListening("off");
      await onRefresh();
      setNotice(t("voiceOff"));
    } catch (e) {
      setNotice(message(e));
    }
  };

  const ex = script.exercises[state.exercise];
  const target = state.targets[state.exercise]?.[state.set - 1];
  const running = !["ready", "finished", "stopped"].includes(state.phase);
  // A timed round counts down; other sets count up.
  const clock =
    state.phase === "rest"
      ? state.restRemaining
      : state.phase === "set"
        ? typeof state.workLeft === "number"
          ? state.workLeft
          : state.setElapsed
        : null;
  return (
    <>
      <section className="card voice-status-card" aria-labelledby="voice-mode">
        <div className="card-heading">
          <h2 id="voice-mode">
            {voiceMode ? t("trainerVoice") : t("textSession")}
          </h2>
          {audioBadge(session, t) && (
            <span className={"badge" + (voiceMode ? "" : " amber")}>{audioBadge(session, t)}</span>
          )}
        </div>
        {session.unavailableReason && (
          <p className="muted">
            {voiceReason([session.unavailableReason], t.locale)}
          </p>
        )}
        {session.audioStatus === "generating" && (
          <p className="muted">{t("generating")}</p>
        )}
        {session.audioStatus === "capped" && (
          <p className="muted">{t("capped")}</p>
        )}
        {session.mode === "text" && gate.mode === "voice" && runnable && (
          <button className="button secondary" onClick={() => void onPrepare(false)}>
            {t("switchVoice")}
          </button>
        )}
        {session.mode === "text" && runnable && gate.reasons.length === 1 && gate.reasons[0].code === "PLAYBACK_CONSENT" && (
          <button className="button secondary" onClick={() => void onPrepare(true)}>
            {t("useApproved")}
          </button>
        )}
        {voiceMode && (
          <div className="button-row">
            <button
              className="button secondary"
              aria-pressed={muted}
              onClick={() => setMuted(!muted)}
            >
              {muted ? t("unmute") : t("mute")}
            </button>
            <button className="text-button" onClick={() => void withdrawVoice()}>
              {t("stopVoice")}
            </button>
          </div>
        )}
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
          {statusLine(ctx, state, t)}
        </h2>
        {state.phase === "ready" && (
          // What the session holds, before it starts.
          <ul className="voice-plan">
            {script.exercises.map((e) => (
              <li key={e.index}>
                <strong>{e.name}</strong>
                <span className="muted">
                  {(e as any).reps
                    ? t("setsByReps", {
                        setsReps: formatSetsReps(e.sets, (e as any).reps, t.locale),
                        count: lastCount((e as any).reps),
                      })
                    : t("setCount", { count: Number(e.sets) })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {ex && ["setup", "set", "rest"].includes(state.phase) && target && (
          <p className="voice-target">
            <bdi>{ex.name}</bdi> ·{" "}
            {workMeasure(ex) === "reps"
              ? t("setOf", { set: state.set, sets: ex.sets })
              : t("roundOf", { set: state.set, sets: ex.sets })}{" "}
            ·{" "}
            {workMeasure(ex) === "reps" ? (
              t("reps", { count: target.reps })
            ) : (
              <bdi>{workText({ ...ex, sets: 1 })}</bdi>
            )}
            {target.loadKg > 0 ? ` · ${t("load", { load: target.loadKg })}` : ""}
            {target.loadKg < ex.loadKg ? ` ${t("lighter")}` : ""}
          </p>
        )}
        {clock !== null && (
          <p className="voice-clock" aria-hidden="true" dir="ltr">
            {/* Rest counts down on a ring (docs/features/motion.md "k"). */}
            {state.phase === "rest" && ex?.restSeconds > 0 && (
              <ProgressRing
                value={clock / ex.restSeconds}
                size={32}
                ticking
              />
            )}
            {Math.floor(clock / 60)}:{String(clock % 60).padStart(2, "0")}
          </p>
        )}
        <p className="voice-prompt" aria-live="polite">
          {/* Each new cue fades in; the live region itself stays put. */}
          <span className="voice-cue is-new" key={prompt}>
            {prompt}
          </span>
        </p>
        <audio ref={player} preload="none" hidden />
        {changed ? (
          <div className="stack">
            <p className="notice">{t("changed")}</p>
            <button className="button" onClick={() => void onPrepare(false)}>
              {t("prepareAgain")}
            </button>
          </div>
        ) : state.phase === "ready" ? (
          runnable ? (
            <StickyActionBar label={t("sessionActions")}>
              <button
                className="button voice-start"
                onClick={() => {
                  void flush("running");
                  dispatch({ type: "start" });
                }}
              >
                {t("startSession")}
              </button>
            </StickyActionBar>
          ) : session.status === "revoked" || session.stale ? (
            <div className="stack">
              <p className="notice">{t("noMatch")}</p>
              <button className="button" onClick={() => void onPrepare(false)}>
                {t("prepareAgain")}
              </button>
            </div>
          ) : (
            <p className="notice">{t("ended")}</p>
          )
        ) : running ? (
          <>
            {/* Done and Pain stay in thumb reach above the tab bar, never
                below the fold (phone-first rules: safety controls visible). */}
            <StickyActionBar label={t("sessionActions")}>
              <button
                type="button"
                className="button secondary voice-pain workout-pain"
                onClick={() => command({ type: "pain", transcript: t("painNote") })}
              >
                <AlertCircle size={18} aria-hidden="true" />
                {t("painShort")}
              </button>
              {state.phase === "paused" ? (
                <button type="button" className="button" onClick={() => command({ type: "resume" })}>
                  {t("resume")}
                </button>
              ) : (
                <button type="button" className="button voice-done" onClick={() => command({ type: "done" })}>
                  {t("done")}
                </button>
              )}
            </StickyActionBar>
            <div className="voice-commands" role="group" aria-label={t("replies")}>
              <button className="button secondary" onClick={() => command({ type: "too_heavy" })}>
                {t("tooHeavy")}
              </button>
              <button className="button secondary" onClick={() => command({ type: "too_easy" })}>
                {t("tooEasy")}
              </button>
              {script.rules.allowSkip && (
                <button className="button secondary" onClick={() => command({ type: "skip" })}>
                  {t("skip")}
                </button>
              )}
              <button className="button secondary" onClick={() => command({ type: "repeat" })}>
                {t("repeat")}
              </button>
              {state.phase === "paused" ? (
                <button className="button secondary" onClick={() => command({ type: "resume" })}>
                  {t("resume")}
                </button>
              ) : (
                <button className="button secondary" onClick={() => command({ type: "pause" })}>
                  {t("pause")}
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
                  command({ type: "reps", reps, typed: true });
                }}
              >
                <label>
                  <span>{t("repsDone")}</span>
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
                  {t("logReps")}
                </button>
              </form>
            )}
            <button
              className="text-button"
              onClick={() => dispatch({ type: "end" })}
            >
              {t("endEarly")}
            </button>
          </>
        ) : state.phase === "finished" ? (
          <p className="notice">
            {finishState === "done"
              ? t("finished")
              : finishState === "waiting"
                ? t("waiting")
                : t("complete")}
            {finishState === "waiting" && (
              <button className="text-button" onClick={() => void finish()}>
                {t("tryAgain")}
              </button>
            )}
          </p>
        ) : null}
        {(queued > 0 || rejected > 0) && (
          <p className="muted" role="status">
            {queued > 0 && `${queuedSummary(queued, "set", t.locale)}. `}
            {rejected > 0 && t("needAttention", { count: rejected })}
          </p>
        )}
      </section>

      {running && (
        <section className="card" aria-labelledby="voice-replies">
          <h2 id="voice-replies">{t("spokenReplies")}</h2>
          <label className="voice-reply-language">
            <span>{t("replyIn")}</span>{" "}
            <select
              value={replyLanguage}
              onChange={(e) => {
                const value = e.target.value as ReplyLanguage;
                setReplyLanguage(value);
                try {
                  localStorage.setItem(REPLY_LANGUAGE_KEY, value);
                } catch {}
              }}
            >
              <option value="">{t("replyAppLanguage")}</option>
              <option value="en" lang="en">{t("replyEnglish")}</option>
              <option value="ar" lang="ar">{t("replyArabic")}</option>
            </select>
          </label>
          <p className="muted">{t("spokenHelp")}</p>
          {listening === "off" ? (
            <div className="stack">
              {deviceSpeech && (
                <button className="button secondary" onClick={() => void startListening("device")}>
                  {t("listenDevice")}
                </button>
              )}
              {gate.speechToText && voiceMode && (
                <>
                  {!gate.transcriptionConsent && (
                    <label className="voice-check">
                      <input
                        type="checkbox"
                        checked={transcriptionConsent}
                        onChange={(e) => setTranscriptionConsent(e.target.checked)}
                      />{" "}
                      {t("sendClips", {
                        provider: gate.speechProvider?.name ?? t("theService"),
                      })}
                      {gate.speechProvider?.zeroRetention
                        ? t("zeroRetention")
                        : t("ownTerms", {
                            provider:
                              gate.speechProvider?.name ?? t("theProvider"),
                          })}
                    </label>
                  )}
                  <button
                    className="button secondary"
                    disabled={!gate.transcriptionConsent && !transcriptionConsent}
                    onClick={() => void startListening("server")}
                  >
                    {t("listenService")}
                  </button>
                </>
              )}
              {!deviceSpeech && !(gate.speechToText && voiceMode) && (
                <p className="muted">{t("noSpeech")}</p>
              )}
            </div>
          ) : (
            <div className="stack">
              {/* A calm breathing ring while listening (a live state). */}
              <div className="listening">
                <span className="listening-ring" aria-hidden="true">
                  <span className="listening-ring-pulse" />
                  <Mic size={20} />
                </span>
                <p role="status">
                  {listening === "device"
                    ? t("listeningDevice")
                    : t("listeningService")}
                  {heard && ` ${t("heard", { text: `“${heard}”` })}`}
                </p>
              </div>
              <button className="button secondary" onClick={() => setListening("off")}>
                {t("stopListening")}
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
                  {t("withdraw")}
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
