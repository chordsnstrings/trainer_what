"use client";
import { sessionOrder } from "../../../packages/domain/src/session-structure.ts";
// Hands-free, voice-led workout session. The pure state machine
// (packages/domain/src/voice-runner.ts) decides what happens; this component
// plays the trainer-voice clips (or shows the words), runs the clock, listens
// for spoken replies and performs the effects: set logs go through the same
// device queue as the workout page, pain opens the existing safety hold.
import { GuidedMusic } from "./guided-music";
import {
  progressKey,
  restoreProgress,
  saveProgress,
  phaseToken,
  mergeCompletedSets,
} from "../lib/guided-runtime";
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
import {
  workMeasure,
  workText,
} from "../../../packages/domain/src/prescription.ts";
import {
  audioSessionSupported,
  joinMp3,
  mp3Info,
  planCue,
  requestWakeLock,
  savedMusicMode,
  setAudioSessionType,
  unlockAudio,
  MUSIC_MODE_KEY,
  type MusicMode,
} from "../lib/audio-session";
import { useTapToTalk, type TalkCapture } from "./voice-tap-to-talk";
import {
  drainWorkoutQueue,
  offlineQueueKeys,
  readList,
  queueOwnerHeaders,
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
    signal: AbortSignal.timeout(20000),
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
function statusLine(ctx: { script: SessionScript }, s: RunnerState, t: VoiceT) {
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
      if (workMeasure(ex) !== "reps") return [ex.name, t("roundOf", { set: s.set, sets: ex.sets }), workText({ ...ex, sets: 1 }), ...(target.loadKg > 0 ? [t("load", { load: target.loadKg })] : [])].join(" · ");
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
  progress?: {
    version: number;
    fingerprint: string;
    state: RunnerState;
    savedAt: number;
  } | null;
  progressVersion?: number;
  completedSets?: string[];
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

/** Seconds a text prompt stays before the runner moves on by itself. */
const readingSeconds = (text: string) => Math.min(9, 1.5 + text.length * 0.045);

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
  return (
    (typeof document !== "undefined" && document.documentElement.lang) ||
    "en-US"
  );
}
function speechType(mime: string) {
  const base = mime.split(";")[0];
  return [
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
  ].includes(base)
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
    ahead && planned?.status === "started" && planned.workoutId
      ? planned.workoutId
      : null;
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
        <h1>{session?.script.title ?? planned?.title ?? t("fallbackTitle")}</h1>
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
          <a
            className="text-link"
            href={`/app/voice-session/${startedWorkout}`}
          >
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
        <section
          className="card voice-status-card"
          aria-labelledby="voice-ahead"
        >
          <div className="card-heading">
            <h2 id="voice-ahead">
              {session.mode === "voice" ? t("trainerVoice") : t("textSession")}
            </h2>
            {audioBadge(session, t) && (
              <span
                className={"badge" + (session.mode === "voice" ? "" : " amber")}
              >
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
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void prepare(false)}
            >
              {t("switchVoice")}
            </button>
          )}
          <button
            className="button"
            disabled={busy || gate.held}
            onClick={() => void startWorkout()}
          >
            {t("startWithVoice")}
          </button>
        </section>
      )}
      {session && gate && !ahead && (
        <Runner
          key={session.id + ":" + (session.scriptFingerprint ?? "")}
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
function voiceBlockedOnlyByConsentFor(gate: {
  reasons: Array<{ code: string }>;
}) {
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
  const [autoPace, setAutoPace] = useState(false);
  const ctx = useMemo(
    () => ({ script, rules: script.rules, deliberate: true, autoPace }),
    [script, autoPace],
  );
  const storageKey = progressKey(tenantId, userId, workoutId);
  const checkpointVersion = useRef(session.progressVersion ?? 0);
  const t = useT("voice"),
    toError = useErrorText();
  // Callbacks and listening effects read the current wording through a ref,
  // so a language change never restarts the microphone or the runner.
  const words = useRef({ t, toError });
  words.current = { t, toError };
  const message = (e: unknown) => words.current.toError(e);
  const [state, setState] = useState<RunnerState>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      let local: any = null;
      try {
        local = JSON.parse(raw ?? "null");
      } catch {}
      const chosen =
        session.progress &&
        (!local ||
          local.baseVersion !== session.progressVersion ||
          session.progress.savedAt > (local.savedAt ?? 0))
          ? JSON.stringify(session.progress)
          : raw;
      return mergeCompletedSets(
        restoreProgress(
          chosen,
          session.scriptFingerprint ?? session.id,
          script,
        ),
        session.completedSets ?? [],
        script,
      );
    } catch {
      return mergeCompletedSets(
        initialRunnerState(script),
        session.completedSets ?? [],
        script,
      );
    }
  });
  const checkpointConflict = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [prompt, setPrompt] = useState(""),
    [notice, setNotice] = useState(""),
    [alert, setAlert] = useState(""),
    [muted, setMuted] = useState(false),
    [deviceSpeech, setDeviceSpeech] = useState(false),
    [heard, setHeard] = useState(""),
    [queued, setQueued] = useState(0),
    [rejected, setRejected] = useState(0),
    [finishState, setFinishState] = useState<"none" | "waiting" | "done">(
      "none",
    ),
    [repsDraft, setRepsDraft] = useState(""),
    [transcriptionConsent, setTranscriptionConsent] = useState(false),
    [clipCount, setClipCount] = useState(0),
    [changed, setChanged] = useState(false),
    // The language the member replies in: "" follows the app's language.
    [replyLanguage, setReplyLanguage] =
      useState<ReplyLanguage>(savedReplyLanguage),
    // "My own music": cues mix over the member's music, tap to talk.
    [music, setMusic] = useState<MusicMode>(savedMusicMode);
  const ownMusic = music === "own";
  const ownMusicRef = useRef(ownMusic);
  ownMusicRef.current = ownMusic;
  const replyLanguageRef = useRef(replyLanguage);
  replyLanguageRef.current = replyLanguage;
  const recognitionLang =
    replyLanguage === "ar"
      ? "ar-AE"
      : replyLanguage === "en"
        ? "en-US"
        : appLanguage();
  const clips = useRef(new Map<string, string>());
  /** The clips' bytes, joined into one clip per cue in "My own music" mode. */
  const clipBytes = useRef(new Map<string, Uint8Array>());
  /** While the member is talking, cues wait. */
  const talkBusy = useRef(false);
  const wakeLock = useRef<{
    release(): Promise<void>;
    released?: boolean;
  } | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const [cuePlaying, setCuePlaying] = useState(false);
  const [question, setQuestion] = useState("");
  const runnerLocale = useLocale();
  const [actualDistance, setActualDistance] = useState("");
  useEffect(() => setActualDistance(""), [state.exercise,state.set]);
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [voiceVolume, setVoiceVolume] = useState(1);
  const speaking = useRef(false);
  const audioEpoch = useRef(0);
  const [voiceRevoked, setVoiceRevoked] = useState(false);
  const voiceRevokedRef = useRef(false);
  const playback = useRef<Playback>({
    playing: false,
    endedAt: 0,
    prompts: [],
    listeners: new Set(),
  });
  const sayQueue = useRef<Array<Extract<RunnerEffect, { type: "say" }>>>([]);
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Finishes the prompt on screen now (used when the voice is muted mid-prompt). */
  const currentDone = useRef<(() => void) | null>(null);
  const promptAwaited = useRef(false);
  const outcomeKey = `${storageKey}:outcomes:${session.id}`;
  const [initialOutcomes] = useState(() =>
    readList<RunnerOutcome & { eventKey?: string }>(localStorage, outcomeKey),
  );
  const outcomes = useRef(initialOutcomes);
  const flushing = useRef<Promise<void> | null>(null);
  const outcomeStatus = useRef<"running" | "completed" | "stopped" | undefined>(
    undefined,
  );
  const persistOutcomes = useCallback(() => {
    try {
      localStorage.setItem(outcomeKey, JSON.stringify(outcomes.current));
    } catch {}
  }, [outcomeKey]);
  const keys = offlineQueueKeys("workout", tenantId, userId);
  const voiceMode =
    session.mode === "voice" && gate.mode === "voice" && !voiceRevoked;
  useEffect(() => {
    if (gate.mode === "voice" && session.mode === "voice") {
      voiceRevokedRef.current = false;
      setVoiceRevoked(false);
    }
  }, [gate.mode, session.mode]);
  const voiceAvailable = voiceMode && clipCount > 0;
  const runnable =
    session.runnable !== false && ["ready", "running"].includes(session.status);

  const setPlaying = useCallback((playing: boolean) => {
    const p = playback.current;
    if (p.playing === playing) return;
    p.playing = playing;
    setCuePlaying(playing);
    if (!playing) p.endedAt = Date.now();
    for (const listener of p.listeners) listener(playing);
  }, []);

  useEffect(() => {
    if (player.current) player.current.volume = voiceVolume;
  }, [voiceVolume]);

  // ---------------------------------------------------------------- audio
  // Clips are fetched by key as they become ready, so early lines play in the
  // trainer's voice while the rest of the session is still being prepared.
  const readyKeys = voiceMode ? (session.audio.readyKeys ?? []) : [];
  const readySignature = readyKeys.join(",");
  useEffect(() => {
    const loaded = clips.current;
    if (!voiceMode) {
      // Voice withdrawn or revoked: the session carries on as text.
      player.current?.pause();
      for (const url of loaded.values()) URL.revokeObjectURL(url);
      loaded.clear();
      clipBytes.current.clear();
      setClipCount(0);
      return;
    }
    const missing = readySignature
      ? readySignature.split(",").filter((k) => !loaded.has(k))
      : [];
    if (!missing.length) return;
    let cancelled = false;
    void (async () => {
      try {
        for (let i = 0; i < missing.length && !cancelled; i += 40) {
          const chunk = missing.slice(i, i + 40);
          const page: {
            clips: Array<{ key: string; shared: boolean; audio: string }>;
            type: string;
          } = await api(
            `/voice-sessions/${session.id}/audio?keys=${encodeURIComponent(chunk.join(","))}`,
          );
          if (cancelled) return;
          for (const clip of page.clips) {
            const bytes = Uint8Array.from(atob(clip.audio), (c) =>
              c.charCodeAt(0),
            );
            const url = URL.createObjectURL(
              new Blob([bytes], { type: page.type }),
            );
            const key = (clip.shared ? "s:" : "l:") + clip.key;
            const prior = loaded.get(key);
            if (prior) URL.revokeObjectURL(prior);
            loaded.set(key, url);
            clipBytes.current.set(key, bytes);
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
      audioEpoch.current++;
      if (promptTimer.current) clearTimeout(promptTimer.current);
      for (const url of clips.current.values()) URL.revokeObjectURL(url);
      clips.current.clear();
      clipBytes.current.clear();
    },
    [],
  );

  // ------------------------------------------------------------ outcomes
  const flush = useCallback(
    async (status?: "running" | "completed" | "stopped"): Promise<void> => {
      if (status) outcomeStatus.current = status;
      if (flushing.current) {
        await flushing.current;
        if (status) return flushRef.current();
        return;
      }
      const batch = outcomes.current.slice(0, 50),
        sentStatus = outcomeStatus.current;
      if (!batch.length && !sentStatus) return;
      const operation = (async () => {
        try {
          await api(
            `/voice-sessions/${session.id}/events`,
            "POST",
            { ...(sentStatus ? { status: sentStatus } : {}), outcomes: batch },
            queueOwnerHeaders(tenantId, userId),
          );
          const sent = new Set(batch);
          outcomes.current = outcomes.current.filter((o) => !sent.has(o));
          if (outcomeStatus.current === sentStatus)
            outcomeStatus.current = undefined;
          persistOutcomes();
        } catch {
          /* Keep stable event keys for retry after reload. */
        }
      })();
      flushing.current = operation;
      await operation;
      flushing.current = null;
    },
    [session.id, tenantId, userId, persistOutcomes],
  );
  const flushRef = useRef(flush);
  flushRef.current = flush;
  // Buffered outcomes are sent when the page closes or the session is replaced.
  useEffect(() => {
    void flushRef.current();
    const retry = () => void flushRef.current();
    const timer = setInterval(retry, 10000);
    window.addEventListener("online", retry);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", retry);
      void flushRef.current();
    };
  }, []);

  // ----------------------------------------------------------- set queue
  const refreshQueue = useCallback(() => {
    setQueued(readList(localStorage, keys.pending).length);
    setRejected(
      readList<RejectedEntry<WorkoutQueueItem>>(localStorage, keys.rejected)
        .length,
    );
  }, [keys.pending, keys.rejected]);
  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    const result = await drainWorkoutQueue(
      localStorage,
      tenantId,
      userId,
      (p, b, h) => api(p, "POST", b, h),
    );
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
    // While the member talks back, cues wait in the queue.
    if (talkBusy.current) {
      speaking.current = false;
      return;
    }
    const next = sayQueue.current.shift();
    if (!next) {
      speaking.current = false;
      return;
    }
    speaking.current = true;
    promptAwaited.current ||= next.wait;
    const epoch = audioEpoch.current;
    setPrompt(next.text);
    const urls = next.items
      .map((item) =>
        clips.current.get("line" in item ? "l:" + item.line : "s:" + item.clip),
      )
      .filter((u): u is string => !!u);
    let finished = false;
    const done = () => {
      if (finished || epoch !== audioEpoch.current) return;
      finished = true;
      currentDone.current = null;
      setPlaying(false);
      if (promptAwaited.current && !sayQueue.current.length) {
        promptAwaited.current = false;
        speaking.current = false;
        dispatchRef.current({ type: "prompt_done" });
      } else playNext();
    };
    currentDone.current = done;
    const keys = next.items.map((item) =>
      "line" in item ? "l:" + item.line : "s:" + item.clip,
    );
    if (
      audible &&
      ownMusicRef.current &&
      urls.length === next.items.length &&
      player.current
    ) {
      // "My own music": one joined clip of at most about 4.5 s per play
      // (Android lowers the music briefly; iPhone mixes it as "ambient"); a
      // longer line stays on screen. Clips that are not MP3 play as before.
      const audio = player.current;
      setAudioSessionType("ambient");
      const parts = keys.map((k) => clipBytes.current.get(k));
      const plan = planCue(
        parts.map((b) => (b ? (mp3Info(b)?.durationMs ?? null) : null)),
      );
      const joined = plan.groups
        .map((g) => joinMp3(g.map((i) => parts[i]!)))
        .filter((j): j is NonNullable<typeof j> => !!j)
        .map((j) =>
          URL.createObjectURL(
            new Blob([j.bytes as BlobPart], { type: "audio/mpeg" }),
          ),
        );
      if (!joined.length) {
        if (next.wait)
          promptTimer.current = setTimeout(
            done,
            readingSeconds(next.text) * 1000,
          );
        else done();
        return;
      }
      playback.current.prompts = [next.text, ...playback.current.prompts].slice(
        0,
        3,
      );
      setPlaying(true);
      let index = 0;
      const playOne = () => {
        if (epoch !== audioEpoch.current || voiceRevokedRef.current) return;
        if (index > 0) URL.revokeObjectURL(joined[index - 1]);
        if (index >= joined.length) return done();
        audio.src = joined[index++];
        audio.onended = playOne;
        audio.onerror = playOne;
        void audio.play().catch(() => {
          if (epoch !== audioEpoch.current) return;
          setPlaying(false);
          for (const url of joined.slice(index - 1)) URL.revokeObjectURL(url);
          promptTimer.current = setTimeout(
            done,
            readingSeconds(next.text) * 1000,
          );
        });
      };
      playOne();
    } else if (audible && urls.length === next.items.length && player.current) {
      const audio = player.current;
      // The echo guard ignores replies while this plays and briefly after.
      playback.current.prompts = [next.text, ...playback.current.prompts].slice(
        0,
        3,
      );
      setPlaying(true);
      let index = 0;
      const playOne = () => {
        if (epoch !== audioEpoch.current || voiceRevokedRef.current) return;
        if (index >= urls.length) return done();
        audio.src = urls[index++];
        audio.onended = playOne;
        audio.onerror = playOne;
        void audio.play().catch(() => {
          if (epoch !== audioEpoch.current) return;
          // Autoplay refused or the file failed: show the words instead.
          setPlaying(false);
          promptTimer.current = setTimeout(
            done,
            readingSeconds(next.text) * 1000,
          );
        });
      };
      playOne();
    } else if (next.wait)
      promptTimer.current = setTimeout(done, readingSeconds(next.text) * 1000);
    else done();
  }, [audible, setPlaying]);
  const logSet = useCallback(
    async (effect: Extract<RunnerEffect, { type: "log_set" }>) => {
      const logicalKey =
        workoutId + ":" + effect.exerciseIndex + ":" + effect.set;
      const pending = readList<WorkoutQueueItem>(localStorage, keys.pending);
      const receipts = readList<string>(localStorage, keys.receipts);
      if (
        pending.some((p) => p.logicalKey === logicalKey) ||
        receipts.includes(logicalKey)
      )
        return;
      pending.push({
        path: `/workouts/${workoutId}/sets`,
        logicalKey,
        body: {
          eventKey: crypto.randomUUID(),
          exercise: effect.exercise,
          exerciseIndex: effect.exerciseIndex,
          set: effect.set,
          reps: effect.reps,
          loadKg: effect.loadKg,
          // A round of timed or distance work logs what was done.
          ...(effect.durationSeconds !== undefined
            ? { durationSeconds: effect.durationSeconds }
            : {}),
          ...(effect.distanceMeters !== undefined
            ? { distanceMeters: effect.distanceMeters }
            : {}),
        },
      });
      localStorage.setItem(keys.pending, JSON.stringify(pending));
      refreshQueue();
      await sync();
    },
    [workoutId, keys.pending, keys.receipts, refreshQueue, sync],
  );
  const painKey = storageKey + ":pain";
  const painSending = useRef(false);
  const sendPain = useCallback(
    async (fresh?: string) => {
      if (painSending.current) return;
      let description = fresh;
      try {
        description = description ?? localStorage.getItem(painKey) ?? undefined;
      } catch {}
      if (!description) return;
      painSending.current = true;
      try {
        await api(
          `/workouts/${workoutId}/pain`,
          "POST",
          { description },
          queueOwnerHeaders(tenantId, userId),
        );
        localStorage.removeItem(painKey);
        setAlert(words.current.t("stopped"));
      } catch (e) {
        setAlert(
          words.current.t("painOffline") + " " + words.current.toError(e),
        );
      } finally {
        painSending.current = false;
      }
    },
    [painKey, workoutId, tenantId, userId],
  );
  const reportPain = useCallback(
    async (description: string) => {
      player.current?.pause();
      setPlaying(false);
      sayQueue.current = [];
      setAlert(words.current.t("stopNow"));
      try {
        localStorage.setItem(painKey, description);
      } catch {
        setAlert(words.current.t("painOffline"));
      }
      await sendPain(description);
    },
    [painKey, sendPain, setPlaying],
  );
  useEffect(() => {
    void sendPain();
    const retry = () => void sendPain();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [sendPain]);
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
  useEffect(() => {
    if (state.phase === "finished" && finishState === "none") void finish();
  }, [state.phase, finishState, finish]);
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
            outcomes.current.push({
              ...effect.outcome,
              eventKey: crypto.randomUUID(),
            });
            persistOutcomes();
            // "I didn't do the last one": the trainer is told; a set already
            // logged stays logged until the member corrects it.
            if (effect.outcome.type === "not_done")
              setNotice(
                effect.outcome.logged ? t("notDoneLogged") : t("notDoneNoted"),
              );
            if (outcomes.current.length >= 10) void flush();
            break;
          case "finished":
            // The finished-state effect also retries after a reload.
            break;
        }
      if (!speaking.current && sayQueue.current.length) playNext();
    },
    [logSet, reportPain, flush, finish, playNext, persistOutcomes],
  );
  const dispatch = useCallback(
    (event: RunnerEvent) => {
      if (
        checkpointConflict.current &&
        !(
          event.type === "command" &&
          ["pause", "pain"].includes(event.command.type)
        )
      )
        return;
      const before = stateRef.current;
      const [next, effects] = stepRunner(ctx, before, event);
      if (
        (event.type === "command" &&
          !["unknown", "ack"].includes(event.command.type)) ||
        event.type === "held" ||
        event.type === "end" ||
        event.type === "extend_rest" ||
        (event.type === "tick" && phaseToken(before) !== phaseToken(next))
      ) {
        if (next === before && !effects.length) return;
        audioEpoch.current++;
        promptAwaited.current = false;
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
      try {
        localStorage.setItem(
          storageKey,
          saveProgress(
            session.scriptFingerprint ?? session.id,
            next,
            checkpointVersion.current,
          ),
        );
      } catch {
        setNotice(words.current.t("progressUnsaved"));
      }
      if (next.phase === "stopped" && before.phase !== "stopped") {
        void flush("stopped");
      }
    },
    [ctx, perform, flush, setPlaying, storageKey, session.scriptFingerprint],
  );
  dispatchRef.current = dispatch;
  const checkpointSending = useRef(false);
  const checkpointSaved = useRef("");
  const saveCheckpoint = useCallback(async () => {
    if (
      checkpointSending.current ||
      checkpointConflict.current ||
      !session.scriptFingerprint ||
      !navigator.onLine
    )
      return;
    const next = stateRef.current;
    const signature = JSON.stringify(next);
    if (next.phase === "ready" || signature === checkpointSaved.current) return;
    checkpointSending.current = true;
    try {
      const result = await api<{ version: number }>(
        `/voice-sessions/${session.id}/progress`,
        "POST",
        {
          fingerprint: session.scriptFingerprint,
          version: checkpointVersion.current,
          state: next,
        },
        queueOwnerHeaders(tenantId, userId),
      );
      checkpointVersion.current = result.version;
      checkpointSaved.current = signature;
      try {
        localStorage.setItem(
          storageKey,
          saveProgress(
            session.scriptFingerprint,
            stateRef.current,
            result.version,
          ),
        );
      } catch {}
    } catch (error) {
      if ((error as ApiError).status === 409) {
        checkpointConflict.current = true;
        dispatchRef.current({ type: "command", command: { type: "pause" } });
        try {
          localStorage.removeItem(storageKey);
        } catch {}
        setNotice(words.current.toError(error));
      }
    } finally {
      checkpointSending.current = false;
    }
  }, [session.id, session.scriptFingerprint, tenantId, userId, storageKey]);
  useEffect(() => {
    const timer = setTimeout(() => void saveCheckpoint(), 250);
    return () => clearTimeout(timer);
  }, [state.phase, state.exercise, state.set, saveCheckpoint]);
  useEffect(() => {
    const timer = setInterval(() => void saveCheckpoint(), 10000);
    const online = () => void saveCheckpoint();
    window.addEventListener("online", online);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, [saveCheckpoint]);
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
    if (done)
      promptTimer.current = setTimeout(done, readingSeconds(prompt) * 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audible]);

  // ----------------------------------------------------------------- clock
  useEffect(() => {
    if (!["rest", "set"].includes(state.phase)) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now(),
        seconds = Math.floor((now - last) / 1000);
      if (talkBusy.current) {
        last = now;
        return;
      }
      if (seconds >= 1) {
        last += seconds * 1000;
        if (seconds > 5) {
          dispatchRef.current({ type: "command", command: { type: "pause" } });
          setNotice(words.current.t("interrupted"));
        } else dispatchRef.current({ type: "tick", seconds });
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
          if (view.gate?.mode !== "voice") {
            voiceRevokedRef.current = true;
            setVoiceRevoked(true);
            player.current?.pause();
            setPlaying(false);
          }
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
      screened?: {
        command: VoiceCommand;
        trainingHeld: boolean;
        sincePlaybackMs: number;
      },
    ) => {
      const captured = phaseToken(stateRef.current);
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
        sincePlaybackMs: screened
          ? screened.sincePlaybackMs
          : Date.now() - p.endedAt,
        prompts: p.prompts,
      });
      // The trainer's own voice from the speaker is not a reply.
      if (!local) return;
      setHeard(text);
      if (local.type === "unknown") {
        setQuestion(text);
        setNotice(words.current.t("questionConfirm"));
        return;
      }
      if (local.type === "pain") {
        command(local);
        if (!screened)
          void api(`/voice-sessions/${session.id}/utterance`, "POST", {
            transcript: text,
          }).catch(() => {});
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
      if (result && captured === phaseToken(stateRef.current)) command(local);
    },
    [command, session.id],
  );
  // The listening effects read the latest handler through a ref, so progress
  // polls and runner changes never restart the microphone mid-reply.
  const transcriptRef = useRef(handleTranscript);
  transcriptRef.current = handleTranscript;

  // ------------------------------------------------- screen and own music
  const keepAwake = useCallback(async () => {
    if (wakeLock.current && !wakeLock.current.released) return;
    wakeLock.current = await requestWakeLock();
  }, []);
  useEffect(() => {
    if (!inProgress) {
      const lock = wakeLock.current;
      wakeLock.current = null;
      void lock?.release().catch(() => {});
      return;
    }
    // The lock is released when the page is hidden; take it again on return.
    const visible = () => {
      if (document.visibilityState === "visible") void keepAwake();
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [inProgress, keepAwake]);
  useEffect(
    () => () => {
      void wakeLock.current?.release().catch(() => {});
    },
    [],
  );
  const chooseMusic = (mode: MusicMode) => {
    setMusic(mode);
    try {
      localStorage.setItem(MUSIC_MODE_KEY, mode);
    } catch {}
    // Own music: no open microphone (tap to talk instead), cues mix in.
    if (mode === "own") {
      setAudioSessionType("ambient");
    } else {
      talk.cancel();
      setAudioSessionType("auto");
    }
  };
  const capturePhase = useRef("");
  // Tap to talk: on-device recognition when offered, else the speech service.
  const talkCapture: TalkCapture | null = deviceSpeech
    ? "device"
    : gate.speechToText && voiceMode
      ? "server"
      : null;
  const talk = useTapToTalk({
    capture: talkCapture,
    lang: recognitionLang,
    graceLeftMs: () => ECHO_GRACE_MS - (Date.now() - playback.current.endedAt),
    sincePlaybackMs: () => Date.now() - playback.current.endedAt,
    onWords: (text) => {
      if (capturePhase.current === phaseToken(stateRef.current))
        void transcriptRef.current(text);
    },
    onMicError: () => setNotice(words.current.t("micPermission")),
    onAudio: async (blob, duration, sincePlaybackMs, currentCapture) => {
      const type = speechType(blob.type);
      if (duration < 300 || !type || blob.size > 480000) return;
      const captured = capturePhase.current;
      try {
        const audio = await blobBase64(blob);
        const r = await api<{
          transcript: string;
          command: VoiceCommand;
          trainingHeld: boolean;
        }>(`/voice-sessions/${session.id}/transcribe`, "POST", {
          audio,
          type,
          durationMs: Math.min(15000, Math.max(200, Math.round(duration))),
          ...(replyLanguageRef.current
            ? { language: replyLanguageRef.current }
            : {}),
        });
        if (r.trainingHeld) {
          dispatchRef.current({ type: "held" });
          void onRefresh();
          return;
        }
        if (!currentCapture() || captured !== phaseToken(stateRef.current))
          return;
        await transcriptRef.current(r.transcript, {
          command: r.command,
          trainingHeld: r.trainingHeld,
          sincePlaybackMs,
        });
      } catch (e) {
        setNotice(message(e));
      }
    },
  });
  talkBusy.current = talk.state.phase !== "idle";
  // A cue that waited for the member's reply plays once the talk is over.
  useEffect(() => {
    if (
      talk.state.phase === "idle" &&
      !speaking.current &&
      sayQueue.current.length
    )
      playNext();
  }, [talk.state.phase, playNext]);
  // Pain, a hold, the end of the session: the microphone closes.
  useEffect(() => {
    if (!inProgress || state.phase === "paused") talk.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inProgress, state.phase]);
  const holdActive = useRef(false);
  const tapToTalk = async (held = false) => {
    if (talk.state.phase === "idle") {
      capturePhase.current = phaseToken(stateRef.current);
      if (talkCapture === "server" && !gate.transcriptionConsent) {
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
      // The member interrupts the coach: the cue on screen ends now.
      talkBusy.current = true;
      if (promptTimer.current) clearTimeout(promptTimer.current);
      if (playback.current.playing) {
        player.current?.pause();
        setPlaying(false);
        const done = currentDone.current;
        currentDone.current = null;
        done?.();
      }
    }
    if (!held || holdActive.current) talk.tap();
  };
  useEffect(() => {
    void onDeviceRecognition(recognitionLang).then(setDeviceSpeech);
  }, [recognitionLang]);
  const withdrawVoice = async () => {
    try {
      await api("/voice-sessions/consent", "POST", { playback: false });
      voiceRevokedRef.current = true;
      setVoiceRevoked(true);
      player.current?.pause();
      await onRefresh();
      setNotice(t("voiceOff"));
    } catch (e) {
      setNotice(message(e));
    }
  };

  const ex = script.exercises[state.exercise];
  const nextWork = sessionOrder(script.exercises).find(p => !state.logged.includes(`${p.exercise}:${p.set}`) && !state.skipped.includes(`${p.exercise}:${p.set}`));
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
      <label className="voice-check guided-auto">
        <input
          type="checkbox"
          checked={autoPace}
          onChange={(e) => setAutoPace(e.target.checked)}
        />
        {t("autoPace")}
      </label>
      <details className="card voice-status-card">
        <summary>{t("sessionOptions")}</summary>
        <div className="card-heading">
          <h2 id="voice-mode">
            {voiceMode ? t("trainerVoice") : t("textSession")}
          </h2>
          {audioBadge(session, t) && (
            <span className={"badge" + (voiceMode ? "" : " amber")}>
              {audioBadge(session, t)}
            </span>
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
          <button
            className="button secondary"
            onClick={() => void onPrepare(false)}
          >
            {t("switchVoice")}
          </button>
        )}
        {session.mode === "text" &&
          runnable &&
          gate.reasons.length === 1 &&
          gate.reasons[0].code === "PLAYBACK_CONSENT" && (
            <button
              className="button secondary"
              onClick={() => void onPrepare(true)}
            >
              {t("useApproved")}
            </button>
          )}
        {voiceMode && (
          <div className="button-row">
            <label>
              {t("voiceVolume")}
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={voiceVolume}
                onChange={(e) => setVoiceVolume(Number(e.target.value))}
              />
            </label>
            <button
              className="button secondary"
              aria-pressed={muted}
              onClick={() => setMuted(!muted)}
            >
              {muted ? t("unmute") : t("mute")}
            </button>
            <button
              className="text-button"
              onClick={() => void withdrawVoice()}
            >
              {t("stopVoice")}
            </button>
          </div>
        )}
        {
          <div className="voice-music stack">
            <div
              className="button-row"
              role="group"
              aria-label={t("musicTitle")}
            >
              <span className="voice-music-label">{t("musicTitle")}</span>
              {(["off", "library", "own"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={"button " + (music === mode ? "" : "secondary")}
                  aria-pressed={music === mode}
                  onClick={() => chooseMusic(mode)}
                >
                  {mode === "off"
                    ? t("musicOff")
                    : mode === "library"
                      ? t("musicLibrary")
                      : t("musicOwn")}
                </button>
              ))}
            </div>
            {ownMusic && (
              <p className="muted">
                {t("musicHelp")}{" "}
                {audioSessionSupported() ? "" : t("musicAndroid") + " "}
                {t("musicLong")}
              </p>
            )}
          </div>
        }
      </details>

      {alert && (
        <p className="notice error voice-alert" role="alert">
          {alert}
        </p>
      )}
      {state.stopReason === "pain" && (
        <button className="button secondary" onClick={() => void sendPain()}>
          {t("retryPain")}
        </button>
      )}
      {checkpointConflict.current && (
        <button className="button secondary" onClick={() => location.reload()}>
          {t("loadProgress")}
        </button>
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
                        setsReps: formatSetsReps(
                          e.sets,
                          (e as any).reps,
                          t.locale,
                        ),
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
            {target.loadKg > 0
              ? ` · ${t("load", { load: target.loadKg })}`
              : ""}
            {target.loadKg < ex.loadKg ? ` ${t("lighter")}` : ""}
          </p>
        )}
        {state.phase === "rest" && (
          <p className="muted">
            {t("nextTarget", {
              name: nextWork ? script.exercises[nextWork.exercise].name : "",
              set: nextWork?.set ?? 1,
            })}
          </p>
        )}
        {ex && (state.phase === "set" || state.phase === "setup") && (
          <p className="muted">
            {ex.cue}{" "}
            {workMeasure(ex) === "reps"
              ? t("effortTarget", { n: ex.rir })
              : (ex.effort ?? "")}
          </p>
        )}
        {ex?.demonstrationUrl && (
          <a
            className="button secondary"
            href={ex.demonstrationUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => command({ type: "pause" })}
          >
            {t("watchDemo")}
          </a>
        )}
        {clock !== null && (
          <p className="voice-clock" aria-hidden="true" dir="ltr">
            {/* Rest counts down on a ring (docs/features/motion.md "k"). */}
            {state.phase === "rest" && ex?.restSeconds > 0 && (
              <ProgressRing value={clock / ex.restSeconds} size={32} ticking />
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
                  // Inside the tap: mix with the member's music (own-music
                  // mode), unlock audio for later cues, keep the screen on.
                  if (ownMusic) setAudioSessionType("ambient");
                  if (voiceMode) void unlockAudio(player.current);
                  void keepAwake();
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
                onClick={() =>
                  command({ type: "pain", transcript: t("painNote") })
                }
              >
                <AlertCircle size={18} aria-hidden="true" />
                {t("painShort")}
              </button>
              {state.phase === "paused" ? (
                <button
                  type="button"
                  className="button"
                  disabled={checkpointConflict.current}
                  onClick={() => command({ type: "resume" })}
                >
                  {t("resume")}
                </button>
              ) : (
                <button
                  type="button"
                  className="button voice-done"
                  disabled={state.phase === "set" && !state.promptReady}
                  onClick={() => command({ type: "done", ...(state.phase === "set" && ex?.distanceMeters && actualDistance !== "" ? { distanceMeters: Math.max(0, Math.min(200000, Math.round(Number(actualDistance)))) } : {}) })}
                >
                  {state.phase === "setup" || state.phase === "rest"
                    ? t("readyNext")
                    : t("done")}
                </button>
              )}
            </StickyActionBar>
            {state.phase === "set" && ex?.distanceMeters && <label>{runnerLocale === "ar" ? "المسافة الفعلية بالمتر؛ انتهيت يؤكد المسافة المستهدفة" : "Actual metres; Done confirms the target if left blank"}<input type="number" min={0} max={200000} value={actualDistance} placeholder={String(ex.distanceMeters)} onChange={e => setActualDistance(e.target.value)} /></label>}
            {state.phase === "rest" && (
              <button
                className="button secondary"
                onClick={() => dispatch({ type: "extend_rest" })}
              >
                {t("moreRest")}
              </button>
            )}
            <div
              className="voice-commands"
              role="group"
              aria-label={t("replies")}
            >
              <button
                className="button secondary"
                onClick={() => command({ type: "too_heavy" })}
              >
                {t("tooHeavy")}
              </button>
              <button
                className="button secondary"
                onClick={() => command({ type: "too_easy" })}
              >
                {t("tooEasy")}
              </button>
              {script.rules.allowSkip && (
                <button
                  className="button secondary"
                  onClick={() => command({ type: "skip" })}
                >
                  {t("skip")}
                </button>
              )}
              <button
                className="button secondary"
                onClick={() => command({ type: "repeat" })}
              >
                {t("repeat")}
              </button>
              {state.phase === "paused" ? (
                <button
                  className="button secondary"
                  disabled={checkpointConflict.current}
                  onClick={() => command({ type: "resume" })}
                >
                  {t("resume")}
                </button>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => command({ type: "pause" })}
                >
                  {t("pause")}
                </button>
              )}
            </div>
            {state.phase === "set" && workMeasure(ex) === "reps" && (
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
        <details className="guided-question">
          <summary>{t("askCoach")}</summary>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (asking || !question.trim()) return;
              setAsking(true);
              setAnswer("");
              command({ type: "pause" });
              try {
                const result = await api<any>("/coaching/ask", "POST", {
                  message: `${question.trim()}\nSession context: ${ex.name}; set ${state.set} of ${ex.sets}; ${statusLine(ctx, state, t)}. Keep the prescribed workout unchanged.`,
                });
                setQuestion("");
                setAnswer(
                  result.data?.text ??
                    result.response?.data?.text ??
                    result.message ??
                    t("questionSaved"),
                );
                await onRefresh();
              } catch (error) {
                setAnswer(message(error));
              } finally {
                setAsking(false);
              }
            }}
          >
            <p className="muted">{t("askHelp")}</p>
            <label>
              {t("yourQuestion")}
              <textarea
                maxLength={2000}
                required
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </label>
            <button
              className="button secondary"
              disabled={asking || !question.trim()}
            >
              {asking ? t("talkSending") : t("askCoach")}
            </button>
            {answer && <p role="status">{answer}</p>}
          </form>
        </details>
      )}
      <GuidedMusic
        enabled={music === "library"}
        ownerKey={`${tenantId}:${userId}`}
        state={state}
        title={ex?.name ?? script.title}
        target={statusLine(ctx, state, t)}
        duck={cuePlaying}
        recording={talk.state.phase !== "idle"}
        dispatch={dispatch}
      />
      {running && state.phase !== "paused" && (
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
              <option value="en" lang="en">
                {t("replyEnglish")}
              </option>
              <option value="ar" lang="ar">
                {t("replyArabic")}
              </option>
            </select>
          </label>
          <p className="muted">{t("talkHelp")}</p>
          {
            // One reply per deliberate tap in every audio mode.
            <div className="stack">
              {talkCapture === "server" && !gate.transcriptionConsent && (
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
                        provider: gate.speechProvider?.name ?? t("theProvider"),
                      })}
                </label>
              )}
              {talkCapture && (
                <button
                  className="button secondary voice-talk"
                  type="button"
                  disabled={
                    talk.state.phase === "sending" ||
                    (talkCapture === "server" &&
                      !gate.transcriptionConsent &&
                      !transcriptionConsent)
                  }
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    holdActive.current = true;
                    void tapToTalk(true);
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    holdActive.current = false;
                    if (talk.state.phase === "recording") talk.tap();
                    else talk.cancel();
                  }}
                  onPointerCancel={() => {
                    holdActive.current = false;
                    talk.cancel();
                  }}
                >
                  {t("holdTalk")}
                </button>
              )}
              {talkCapture ? (
                <button
                  type="button"
                  className={
                    "button voice-talk" +
                    (talk.state.phase === "idle" ? " secondary" : "")
                  }
                  aria-pressed={talk.state.phase === "recording"}
                  disabled={
                    talk.state.phase === "sending" ||
                    (talkCapture === "server" &&
                      !gate.transcriptionConsent &&
                      !transcriptionConsent)
                  }
                  onClick={() => void tapToTalk()}
                >
                  <Mic size={18} aria-hidden="true" />
                  {talk.state.phase === "idle"
                    ? t("talk")
                    : talk.state.phase === "opening"
                      ? t("talkOpening")
                      : talk.state.phase === "recording"
                        ? t("talkListening")
                        : t("talkSending")}
                </button>
              ) : (
                <p className="muted">{t("noSpeech")}</p>
              )}
              {heard && (
                <p role="status">{t("heard", { text: `“${heard}”` })}</p>
              )}
            </div>
          }
        </section>
      )}
    </>
  );
}
