"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "./preview-navigation";
import { ProgrammeDraft } from "./brain-plans";
import { DisplayPreferences } from "./appearance";

async function control(path = "", body?: unknown) {
  const response = await fetch("/api/v1/trainer-preview" + path, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Your test profile could not be opened. Try again.");
  return data;
}
export function previewChanged() {
  window.dispatchEvent(new Event("trainer-preview-changed"));
}
export async function endTrainerPreview() {
  const result = await control("/end", {});
  window.location.assign(result.href);
}
export function TryMyAI() {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function start() {
    setBusy(true); setError("");
    try { const result = await control("/start", {}); window.location.assign(result.href); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div className="trainer-preview-entry">
    <div><strong>Experience your own coaching</strong><p>Chat, work out and try nutrition as your subscriber.</p></div>
    <button type="button" className="button secondary" disabled={busy} onClick={() => void start()}>{busy ? "Opening your test profile…" : "Try my AI"}</button>
    {error && <p role="alert" className="notice error">{error}</p>}
  </div>;
}
export function PreviewUnavailable({ message }: { message: string }) {
  return <main className="loading-screen"><h1>Subscriber preview</h1><p role="status">{message}</p><a className="button" href="/trainer/brain">Back to My Brain</a></main>;
}
export function TrainerPreviewBar() {
  const path = usePathname();
  const [status, setStatus] = useState<any>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  const attempted = useRef(new Set<string>());
  useEffect(() => setControlsOpen(false), [path]);
  const reviewReady = status?.generation?.errors?.length || status?.generation?.status === "failed";
  const load = useCallback(async () => {
    try { setStatus(await control()); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [path, load]);
  useEffect(() => { void control("/continue", {}).then(result => { if (result.blocked?.length) setNotice(result.blocked.join(" ")); return load(); }).catch(e => setError(e.message)); }, [load]);
  useEffect(() => {
    const update = () => void load();
    window.addEventListener("trainer-preview-changed", update);
    window.addEventListener("focus", update);
    return () => { window.removeEventListener("trainer-preview-changed", update); window.removeEventListener("focus", update); };
  }, [load]);
  async function act(fn: () => Promise<any>) {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function prepareWorkout() {
    const result = await control("/workout", {});
    if (result.status === "delivered") { setNotice("Your test workout is ready in Training."); previewChanged(); }
    else if (result.message) setNotice(result.message);
    else if (result.reason) setNotice("Workout preparation: " + String(result.reason).replaceAll("_", " ") + ". Check your Brain's programme settings, then try again.");
    else setNotice("The workout could not be delivered. Check the preparation details below.");
  }
  useEffect(() => {
    if (!status?.profile || !status.trainingProfile || !status.brain || status.workout || busy || attempted.current.has(status.profile.id)) return;
    attempted.current.add(status.profile.id);
    void act(prepareWorkout);
  }, [status, busy]);
  const generation = status?.generation;
  return <aside className="trainer-preview-bar" aria-label="Trainer test controls">
    <div className="trainer-preview-top"><div><strong>Subscriber preview</strong><small>Your private test profile · progress stays saved</small></div><button type="button" className="button secondary button-small" disabled={busy} onClick={() => void act(endTrainerPreview)}>Back to My Brain</button></div>
    <details open={controlsOpen} onToggle={e => setControlsOpen(e.currentTarget.open)}>
      <summary>Test controls{busy ? " · preparing your workout" : reviewReady ? " · workout needs attention" : ""}</summary>
      <p>This uses your published Brain and the subscriber app. Replies and valid workouts are approved automatically for your private test profile. Test activity stays separate from your customers.</p>
      {status && !status.brain && <p className="notice">Publish your Brain in My Brain before asking your digital coach for advice or a workout.</p>}
      {status && !status.trainingProfile && <p><Link href="/app/intake">Complete your coaching profile</Link> to try personalised coaching and workouts.</p>}
      {status?.workout && <p><Link href="/app/program">Open my workout</Link></p>}
      {status?.trainingProfile && status?.brain && !status.workout && <button type="button" className="button secondary" disabled={busy} onClick={() => void act(prepareWorkout)}>{busy ? "Preparing…" : "Check workout preparation"}</button>}
      {generation && ["pending_review", "failed"].includes(generation.status) && !busy && <section className="preview-review"><h3>Workout preparation needs attention</h3>
        <p>Valid test workouts appear automatically. This draft could not pass the delivery checks.</p>
        {!!generation.reasons?.length && <p>{generation.reasons.join(" · ")}</p>}
        {!!generation.errors?.length && <p role="status" className="notice error">{generation.errors.join(" · ")}</p>}
        {generation.draft && <ProgrammeDraft draft={generation.draft} names={[]} />}
      </section>}
      {status?.decisions?.map((d: any) => <section key={d.id} className="preview-review"><h3>An earlier reply could not be delivered</h3>{d.request && <p><strong>You asked:</strong> {d.request}</p>}{d.reason && <p>{d.reason}</p>}<p>Return to your conversation and ask again using your current profile.</p></section>)}
      <button type="button" className="button secondary button-small" disabled={busy} onClick={() => void act(async () => { const result = await control("/start", { reset: true }); window.location.assign(result.href); })}>Start a new test profile</button>
      <p>Want a different response? Return to My Brain to teach it. Your test conversations do not automatically become teaching.</p>
      <DisplayPreferences />
    </details>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="notice error">{error}</p>}
  </aside>;
}
