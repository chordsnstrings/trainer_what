"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "./preview-navigation";
import { ProgrammeDraft } from "./brain-plans";

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
  const load = useCallback(async () => {
    try { setStatus(await control()); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [path, load]);
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
  const generation = status?.generation;
  return <aside className="trainer-preview-bar" aria-label="Trainer test controls">
    <div className="trainer-preview-top"><div><strong>Subscriber preview</strong><small>Your private test profile · progress stays saved</small></div><button type="button" className="button secondary button-small" disabled={busy} onClick={() => void act(endTrainerPreview)}>Back to My Brain</button></div>
    <details open={!!status?.decisions?.length || generation?.status === "pending_review" || path.endsWith("/program") && !status?.workout}>
      <summary>Test controls{status?.decisions?.length ? " · reply ready to review" : ""}{generation?.status === "pending_review" ? " · workout ready to review" : ""}</summary>
      <p>This uses your published Brain and the subscriber app. Test activity stays separate from your customers. Trainer approval here applies only to this test profile.</p>
      {status && !status.brain && <p className="notice">Publish your Brain in My Brain before asking your digital coach for advice or a workout.</p>}
      {status && !status.trainingProfile && <p><Link href="/app/intake">Complete your coaching profile</Link> to try personalised coaching and workouts.</p>}
      {status?.trainingProfile && status?.brain && !status.workout && <button type="button" className="button secondary" disabled={busy} onClick={() => void act(async () => {
        const result = await control("/workout", {});
        if (result.status === "delivered") window.location.assign("/trainer/preview/app/program");
        else if (result.message) setNotice(result.message);
        else if (result.reason) setNotice("Workout preparation: " + String(result.reason).replaceAll("_", " ") + ". Check your Brain's programme settings, then try again.");
        else if (result.status === "failed") setNotice("The workout could not be prepared. Review the details below before trying again.");
        else setNotice("Workout prepared for your review below.");
      })}>{busy ? "Preparing…" : "Prepare my workout"}</button>}
      {generation && ["pending_review", "failed"].includes(generation.status) && <section className="preview-review"><h3>Workout draft · trainer review required</h3>
        <p>Subscribers wait for your approval at this point. Review the same draft here, then try it on yourself.</p>
        {!!generation.reasons?.length && <p>{generation.reasons.join(" · ")}</p>}
        {!!generation.errors?.length && <p role="status" className="notice error">{generation.errors.join(" · ")}</p>}
        {generation.draft && <ProgrammeDraft draft={generation.draft} names={[]} />}
        {generation.draft && !generation.errors?.length && <button type="button" className="button" disabled={busy} onClick={() => void act(async () => { await control("/workout/" + generation.id + "/review", { version: generation.version }); window.location.assign("/trainer/preview/app/program"); })}>Approve for my test profile</button>}
      </section>}
      {status?.decisions?.map((d: any) => <section key={d.id} className="preview-review"><h3>Reply draft · trainer review required</h3>{d.request && <p><strong>You asked:</strong> {d.request}</p>}<p>{d.message}</p>{d.reason && <p className="muted">{d.reason}</p>}<button type="button" className="button secondary" disabled={busy} onClick={() => void act(async () => { await control("/replies/" + d.id + "/review", { version: d.version }); previewChanged(); setNotice("Reply approved for your test conversation."); })}>Approve for my test conversation</button></section>)}
      <button type="button" className="button secondary button-small" disabled={busy} onClick={() => void act(async () => { const result = await control("/start", { reset: true }); window.location.assign(result.href); })}>Start a new test profile</button>
      <p>Want a different response? Return to My Brain to teach it. Your test conversations do not automatically become teaching.</p>
    </details>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="notice error">{error}</p>}
  </aside>;
}
