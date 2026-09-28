"use client";
// The trainer's own voice clone (docs/features/trainer-voice.md): record or
// upload, consent, Quick or Pro, preview, use, stop and delete.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Recording = { id: string; type: string; seconds: number; bytes: number; status: "stored" | "sent" };
type Clone = {
  id: string;
  kind: "instant" | "pro";
  status: "draft" | "processing" | "ready" | "active" | "failed";
  version: number;
  language: string;
  progress: string | null;
  error: { code: string; message: string } | null;
  retryable?: boolean;
  hasPreview: boolean;
  recordings: Recording[];
  totalSeconds: number;
  readiness: { ready: boolean; message: string | null } | null;
};
type Overview = {
  provider: string | null;
  available: { quick: boolean; pro: boolean; proSlotsLeft: number };
  encryption: boolean;
  proPriceAed: number | null;
  reviewRequired: boolean;
  providerTrainingOptOut: boolean;
  consent: { version: string; statements: Record<string, string>; granted: boolean };
  limits: {
    instant: { minSeconds: number; maxSeconds: number; maxBytes: number };
    pro: { minTotalSeconds: number; maxBytes: number; maxFiles: number };
  };
  languages: Array<{ code: string; name: string }>;
  previewLine: string;
  workspaceVoice: { status: string; provider: string; cloneId: string | null } | null;
  clones: Clone[];
};

async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? "The request could not be completed.");
  return data;
}
async function base64(blob: Blob) {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 8192)
    binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
  return btoa(binary);
}
/** The provider accepts MP3, WAV, FLAC, OGG and WebM (not the MP4 audio Safari records). */
function sampleType(type: string, name = ""): string | null {
  const base = type.split(";")[0].trim().toLowerCase();
  const byName = name.toLowerCase().split(".").pop() ?? "";
  if (base === "audio/mpeg" || base === "audio/mp3" || byName === "mp3") return "audio/mpeg";
  if (["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(base) || byName === "wav") return "audio/wav";
  if (base === "audio/flac" || base === "audio/x-flac" || byName === "flac") return "audio/flac";
  if (base === "audio/ogg" || byName === "ogg" || byName === "oga") return "audio/ogg";
  if (base === "audio/webm" || byName === "webm") return "audio/webm";
  return null;
}
/** The recording's length, decoded in the browser. */
async function duration(blob: Blob, fallback?: number) {
  try {
    const context = new AudioContext();
    try {
      return (await context.decodeAudioData(await blob.arrayBuffer())).duration;
    } finally {
      void context.close();
    }
  } catch {
    if (fallback) return fallback;
    throw new Error("This recording could not be read. Use MP3, WAV, FLAC, OGG or WebM.");
  }
}
const minutes = (seconds: number) =>
  seconds >= 90 ? `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s` : `${Math.round(seconds)} s`;
const KIND = { instant: "Quick clone", pro: "Pro clone" } as const;
const STATUS: Record<Clone["status"], [string, string]> = {
  draft: ["Recording", ""],
  processing: ["Being made", "amber"],
  ready: ["Ready to preview", ""],
  active: ["In use", "green"],
  failed: ["Needs attention", "red"],
};

/** Records from the microphone up to `maxSeconds`, then hands the audio over. */
function Recorder({ maxSeconds, onDone, disabled }: { maxSeconds: number; onDone: (blob: Blob, seconds: number) => void; disabled: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "unsupported">("idle"),
    [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null),
    started = useRef(0),
    timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);
  const stop = () => recorder.current?.state === "recording" && recorder.current.stop();
  const start = async () => {
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"].find(
      (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    );
    if (!type || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const rec = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 128000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      if (timer.current) clearInterval(timer.current);
      stream.getTracks().forEach((t) => t.stop());
      setState("idle");
      onDone(new Blob(chunks, { type: type.split(";")[0] }), (Date.now() - started.current) / 1000);
    };
    recorder.current = rec;
    started.current = Date.now();
    setElapsed(0);
    rec.start(1000);
    setState("recording");
    timer.current = setInterval(() => {
      const seconds = (Date.now() - started.current) / 1000;
      setElapsed(seconds);
      if (seconds >= maxSeconds) stop();
    }, 250);
  };
  if (state === "unsupported")
    return <p className="muted">This browser cannot record in a format the voice provider accepts. Upload an MP3, WAV, FLAC, OGG or WebM file instead.</p>;
  return state === "recording" ? (
    <p>
      <span className="badge red">Recording</span> {Math.floor(elapsed)} s of up to {maxSeconds} s{" "}
      <button type="button" onClick={stop}>
        Stop
      </button>
    </p>
  ) : (
    <button type="button" disabled={disabled} onClick={() => void start().catch(() => setState("unsupported"))}>
      Record with my microphone
    </button>
  );
}

export function TrainerVoiceClone({ fallback }: { fallback: ReactNode }) {
  const [view, setView] = useState<Overview | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [playing, setPlaying] = useState<string | null>(null);
  const refresh = useCallback(async () => setView(await api("/voice/clones")), []);
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, [refresh]);
  // A clone being made is checked again until it is ready or needs attention.
  const processing = view?.provider === "cartesia" && view.clones.some((c) => c.status === "processing");
  const onlyPro = view?.clones.filter((c) => c.status === "processing").every((c) => c.kind === "pro");
  useEffect(() => {
    if (!processing) return;
    const id = setInterval(() => void refresh().catch(() => undefined), onlyPro ? 30000 : 5000);
    return () => clearInterval(id);
  }, [processing, onlyPro, refresh]);
  const run = async (fn: () => Promise<unknown>, success: string | ((result: any) => string)) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await fn();
      await refresh();
      setMessage(typeof success === "string" ? success : success(result));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  if (!view) return message ? <p role="status" className="notice">{message}</p> : null;
  // Voice clones switched off (another provider, or voice paused): clones
  // already made stay listed so the trainer can still delete them.
  const paused = view.provider !== "cartesia";
  if (paused && !view.clones.length) return <>{fallback}</>;
  const drafts = paused ? [] : view.clones.filter((c) => c.status === "draft");
  const deleteClone = (clone: Clone) =>
    run(() => api(`/voice/clones/${clone.id}`, "DELETE"), (r) => r?.message ?? "Voice deleted");
  const addRecording = (clone: Clone, blob: Blob, measured?: number, name?: string) =>
    run(async () => {
      const type = sampleType(blob.type, name);
      if (!type) throw new Error("Use an MP3, WAV, FLAC, OGG or WebM recording.");
      const limit = clone.kind === "pro" ? view.limits.pro.maxBytes : view.limits.instant.maxBytes;
      if (blob.size > limit) throw new Error(`Use a recording under ${Math.round(limit / 1048576)} MB.`);
      const seconds = await duration(blob, measured);
      await api(`/voice/clones/${clone.id}/samples`, "POST", {
        audio: await base64(blob),
        type,
        durationSeconds: Math.max(0.5, Math.round(seconds * 100) / 100),
      });
    }, "Recording added");
  return (
    <>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="card">
        <h2>Your voice clone</h2>
        <p>
          Record your own voice and we make a private copy of it with our voice provider, Cartesia. Your subscribers with premium voice then hear
          you read their assigned workouts. Only your workspace can use it, and you can stop or delete it at any time.
        </p>
        <p>
          Voice for your members:{" "}
          <strong>
            {view.workspaceVoice?.status === "verified" && view.workspaceVoice.cloneId
              ? "your clone is in use"
              : view.workspaceVoice?.status === "pending" && view.workspaceVoice.cloneId
                ? "waiting for the platform's identity check"
                : "written guidance (no voice in use)"}
          </strong>
        </p>
        {!view.encryption && <p className="notice">The platform has not finished its storage setup, so recordings cannot be accepted yet.</p>}
        {paused && (
          <p className="notice">
            Voice clones are switched off on this platform for now. Your clones below are not used; you can still delete them here and at the voice provider.
          </p>
        )}
      </section>
      {view.clones
        .filter((c) => c.status !== "draft" || paused)
        .map((clone) => (
          <section className="card" key={clone.id}>
            <h3>
              {KIND[clone.kind]} <span className={`badge ${STATUS[clone.status][1]}`}>{STATUS[clone.status][0]}</span>
            </h3>
            <p className="muted">
              {view.languages.find((l) => l.code === clone.language)?.name ?? clone.language} · {minutes(clone.totalSeconds)} of recordings
            </p>
            {clone.progress && !paused && <p>{clone.progress}</p>}
            {clone.error && <p className="notice">{clone.error.message}</p>}
            {!paused && (clone.status === "ready" || clone.status === "active") && (
              <div className="stack">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/voice/clones/${clone.id}/preview`, "POST", {});
                      setPlaying(clone.id);
                    }, "Preview ready")
                  }
                >
                  {clone.hasPreview ? "Play the preview" : "Make a preview"}
                </button>
                {(playing === clone.id || clone.hasPreview) && (
                  <figure>
                    <audio controls preload="none" src={`/api/v1/voice/clones/${clone.id}/preview?v=${clone.version}`} autoPlay={playing === clone.id} />
                    <figcaption className="muted">“{view.previewLine}”</figcaption>
                  </figure>
                )}
                {clone.status === "ready" && (
                  <button
                    type="button"
                    disabled={busy || !clone.hasPreview}
                    title={clone.hasPreview ? undefined : "Listen to the preview first"}
                    onClick={() =>
                      void run(
                        () => api(`/voice/clones/${clone.id}/activate`, "POST", { revision: clone.version }),
                        view.reviewRequired ? "Sent for the platform's identity check" : "Your members now hear this voice",
                      )
                    }
                  >
                    Use this voice for my members
                  </button>
                )}
                {clone.status === "active" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() => api(`/voice/clones/${clone.id}/deactivate`, "POST", { revision: clone.version }), "Members get written guidance again")
                    }
                  >
                    Stop using this voice
                  </button>
                )}
              </div>
            )}
            {!paused && clone.status === "failed" && clone.retryable && (
              <button type="button" disabled={busy} onClick={() => void run(() => api(`/voice/clones/${clone.id}/retry`, "POST", { revision: clone.version }), "Sent again")}>
                Try again
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Delete this voice? It is removed here and at the voice provider, and members stop hearing it."))
                  void deleteClone(clone);
              }}
            >
              Delete this voice
            </button>
          </section>
        ))}
      {drafts.map((clone) => (
        <section className="card" key={clone.id}>
          <h3>{KIND[clone.kind]}: add your recordings</h3>
          <p>
            {clone.kind === "instant"
              ? `Record ${view.limits.instant.minSeconds} to ${view.limits.instant.maxSeconds} seconds of yourself speaking naturally, alone, in a quiet room: for example, coach an imaginary client through a warm-up. A new recording replaces the previous one.`
              : `Add at least 30 minutes of clear recordings of only your voice, in one language, with no music or background noise. Several files are fine; each can be up to ${Math.round(view.limits.pro.maxBytes / 1048576)} MB (MP3, FLAC or OGG keep files small).`}
          </p>
          <Recorder
            maxSeconds={clone.kind === "instant" ? view.limits.instant.maxSeconds : 300}
            disabled={busy || !view.encryption}
            onDone={(blob, seconds) => void addRecording(clone, blob, seconds)}
          />
          <label>
            Or upload a recording
            <input
              type="file"
              accept="audio/mpeg,audio/wav,audio/flac,audio/ogg,audio/webm,.mp3,.wav,.flac,.ogg,.webm"
              multiple={clone.kind === "pro"}
              disabled={busy || !view.encryption}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                void (async () => {
                  for (const file of files) await addRecording(clone, file, undefined, file.name);
                })();
              }}
            />
          </label>
          {clone.recordings.length > 0 && (
            <ul>
              {clone.recordings.map((r, index) => (
                <li key={r.id}>
                  Recording {index + 1}: {minutes(r.seconds)}{" "}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => api(`/voice/clones/${clone.id}/samples/${r.id}`, "DELETE"), "Recording removed")}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">
            {minutes(clone.totalSeconds)} recorded. {clone.readiness?.message ?? "Ready to send."}
          </p>
          <button
            type="button"
            disabled={busy || !clone.readiness?.ready}
            onClick={() =>
              void run(
                () => api(`/voice/clones/${clone.id}/submit`, "POST", { revision: clone.version }),
                clone.kind === "instant" ? "Your Quick clone is being made" : "Your recordings are on their way; training takes up to 3 hours",
              )
            }
          >
            {clone.kind === "instant" ? "Make my Quick clone" : "Send for Pro training"}
          </button>{" "}
          <button type="button" disabled={busy} onClick={() => void run(() => api(`/voice/clones/${clone.id}`, "DELETE"), "Recordings deleted")}>
            Cancel and delete recordings
          </button>
        </section>
      ))}
      {paused ? fallback : <NewClone view={view} busy={busy} run={run} />}
    </>
  );
}

/** Operators: every workspace's clones (no audio but the preview) and provider deletions that need attention. */
export function VoiceCloneOperations() {
  const [data, setData] = useState<{ clones: any[]; deletions: any[] } | null>(null),
    [message, setMessage] = useState("");
  const refresh = useCallback(async () => setData(await api("/admin/integrations/voice-clones")), []);
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, [refresh]);
  if (!data) return message ? <p className="muted">{message}</p> : null;
  return (
    <section className="card">
      <h2>Trainer voice clones</h2>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {!data.clones.length && <p className="muted">No trainer has a voice clone.</p>}
      <ul>
        {data.clones.map((c) => (
          <li key={c.id}>
            <strong>{c.tenant_name}</strong>: {c.kind === "pro" ? "Pro" : "Quick"} clone, {c.status}
            {c.step ? ` (${c.step})` : ""}, {c.language}
            {c.workspace_voice_status ? `; workspace voice ${c.workspace_voice_status}` : ""}
            {c.error?.message ? `; ${c.error.message}` : ""}
            {c.has_preview && (
              <>
                {" "}
                <a href={`/api/v1/admin/integrations/voice-clones/${c.id}/preview?tenantId=${c.tenant_id}`} target="_blank" rel="noreferrer">
                  Listen to its preview
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
      <h3>Deletions at the provider</h3>
      {!data.deletions.length && <p className="muted">Nothing is waiting to be deleted.</p>}
      <ul>
        {data.deletions.map((d) => (
          <li key={d.id}>
            {d.tenant_name}: {d.kind} ({d.reason}), {d.status}, {d.attempts} attempts{d.last_error ? `; ${d.last_error}` : ""}{" "}
            {d.status === "attention" && (
              <button
                type="button"
                onClick={() =>
                  void api(`/admin/integrations/voice-deletions/${d.id}/retry`, "POST", { tenantId: d.tenant_id })
                    .then(refresh)
                    .then(() => setMessage("Deletion queued again"))
                    .catch((e) => setMessage(e.message))
                }
              >
                Try again
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewClone({ view, busy, run }:{ view: Overview; busy: boolean; run: (fn: () => Promise<unknown>, success: string | ((result: any) => string)) => Promise<void> }) {
  const [kind, setKind] = useState<"instant" | "pro">("instant");
  const open = (k: "instant" | "pro") => view.clones.some((c) => c.kind === k && (c.status === "draft" || c.status === "processing"));
  if (!view.available.quick && !view.available.pro) return null;
  if (open("instant") && (open("pro") || !view.available.pro)) return null;
  const proBlocked = !view.available.pro || view.available.proSlotsLeft < 1 || open("pro");
  const chosen = kind === "pro" && proBlocked ? "instant" : kind;
  return (
    <section className="card">
      <h2>{view.clones.length ? "Record a new voice" : "Make your voice clone"}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void run(
            () =>
              api("/voice/clones", "POST", {
                kind: chosen,
                language: form.get("language"),
                consent: { ownVoice: true, cloning: true, subscriberUse: true, deletion: true },
                ...(chosen === "pro" ? { proAcknowledged: true } : {}),
              }),
            "Consent recorded. Add your recordings.",
          );
        }}
      >
        <fieldset>
          <legend>Kind of clone</legend>
          <label>
            <input type="radio" name="kind" value="instant" checked={chosen === "instant"} disabled={!view.available.quick || open("instant")} onChange={() => setKind("instant")} />{" "}
            Quick clone: 10 to 60 seconds of your voice, ready in about a minute.
          </label>
          <label>
            <input type="radio" name="kind" value="pro" checked={chosen === "pro"} disabled={proBlocked} onChange={() => setKind("pro")} /> Pro clone:
            closer to your real voice, from at least 30 minutes of recordings.
          </label>
          {view.available.pro ? (
            <p className="muted">
              A Pro clone takes more of your time: you record at least 30 minutes, and the provider trains it for up to 3 hours.
              {view.proPriceAed ? ` The platform charges AED ${view.proPriceAed} for it, billed separately.` : ""}{" "}
              {view.available.proSlotsLeft < 1 ? "No Pro places are free right now; a Quick clone is available." : ""}
            </p>
          ) : (
            <p className="muted">Pro clones are not offered on this platform yet.</p>
          )}
        </fieldset>
        <label>
          Language you will speak in
          <select name="language" defaultValue="en">
            {view.languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Your consent</legend>
          {Object.entries(view.consent.statements).map(([key, text]) => (
            <label key={key}>
              <input type="checkbox" required /> {text}
            </label>
          ))}
          {chosen === "pro" && (
            <label>
              <input type="checkbox" required /> I understand a Pro clone needs at least 30 minutes of recordings and takes up to 3 hours to train.
            </label>
          )}
          <p className="muted">
            {view.providerTrainingOptOut
              ? "The platform's provider account has opted out of the provider using recordings to train its own models."
              : "Cartesia's terms let it use uploaded recordings to improve its models unless the platform opts out; the platform has not opted out."}{" "}
            Your recordings are kept encrypted only until the provider has them, and are never shown to your subscribers.
          </p>
        </fieldset>
        <button disabled={busy || !view.encryption}>Agree and start</button>
      </form>
    </section>
  );
}
