"use client";
import { useEffect, useState } from "react";

async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/v1" + path, { method, credentials: "same-origin", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "Request failed");
  return result;
}
export function TrainingHoldReview({ onChange }: { onChange?: () => void | Promise<void> }) {
  const [holds, setHolds] = useState<any[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = async () => setHolds(await api("/training/holds"));
  useEffect(() => { void load().catch((e) => setError(e.message)); }, []);
  return <section className="card" aria-label="Training safety holds">
    <h2>Training safety holds</h2>
    <p className="muted">A hold pauses all training for the client. Review the report before explicitly resuming the session or ending it.</p>
    {error && <p role="alert" className="notice">{error}</p>}
    {!holds.some((h) => h.status === "active") && <p>No active training holds.</p>}
    {holds.filter((h) => h.status === "active").map((hold) => <form key={hold.id} onSubmit={async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(hold.id); setError("");
      try { await api(`/training/holds/${hold.id}/resolve`, "POST", { version: hold.version, action: form.get("action"), note: form.get("note"), reviewed: form.get("reviewed") === "on" }); await load(); await onChange?.(); }
      catch (e) { setError((e as Error).message); } finally { setBusy(""); }
    }}>
      <h3>{hold.data.reason}</h3>
      <p className="muted">Reported {new Date(hold.created_at).toLocaleString()} · {(hold.data.workoutIds ?? []).length} paused session(s)</p>
      <label className="field"><span>Review and instructions for the client</span><textarea name="note" required minLength={10} maxLength={4000} rows={3} /></label>
      <label className="field"><span>Training decision</span><select name="action"><option value="abandon">End the paused session</option><option value="resume">Resume the paused session</option></select></label>
      <label className="check-field"><input name="reviewed" type="checkbox" required />I have reviewed the report and decided how the client should continue.</label>
      <button className="button" disabled={!!busy} type="submit">{busy === hold.id ? "Saving review…" : "Record review and notify client"}</button>
    </form>)}
  </section>;
}

export function TrainingHoldNotice({ records }: { records: any[] }) {
  const hold = records.find((r) => r.kind === "training_hold" && r.status === "active");
  if (!hold) return null;
  return <section className="notice" role="status"><strong>Your training is paused.</strong><p>{hold.data.reason}</p><p>Your trainer must review this hold before another session can begin. You can still send them a message. Seek urgent local medical help for severe or urgent symptoms.</p><a href="/app/chat">Message your trainer</a></section>;
}
