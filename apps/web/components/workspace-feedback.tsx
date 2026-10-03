"use client";
import { useEffect, useRef, useState } from "react";

type Question = { title: string; detail: string; confirm?: string; danger?: boolean; notice?: boolean; input?: string };
type Request = Question & { finish: (accepted: boolean, value?: string) => void };
let present: ((request: Request) => void) | null = null;

/** Member screens retain their existing prompt until they mount a host. */
export function confirmWorkspace(question: Question): Promise<boolean> {
  if (!present) return Promise.resolve(window.confirm(question.detail));
  return new Promise(resolve => present?.({ ...question, finish: resolve }));
}
export function notifyWorkspace(detail: string, title = "Please check") {
  if (!present) { window.alert(detail); return; }
  present({ title, detail, notice: true, finish: () => {} });
}
export function promptWorkspace(detail: string, initial = ""): Promise<string | null> {
  if (!present) return Promise.resolve(window.prompt(detail, initial));
  return new Promise(resolve => present?.({ title: "Add details", detail, input: initial, finish: (accepted, value) => resolve(accepted ? value ?? "" : null) }));
}

export function WorkspaceFeedback() {
  const [question, setQuestion] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  const current = useRef<Request | null>(null), dialog = useRef<HTMLDialogElement>(null);
  const finish = (accepted: boolean) => {
    current.current?.finish(accepted, value); current.current = null;
    dialog.current?.close(); setQuestion(null);
  };
  useEffect(() => {
    present = request => {
      current.current?.finish(false);
      current.current = request; setValue(request.input ?? ""); setQuestion(request);
    };
    return () => { present = null; current.current?.finish(false); };
  }, []);
  useEffect(() => { if (question && !dialog.current?.open) dialog.current?.showModal(); }, [question]);
  return <dialog ref={dialog} className="workspace-dialog" aria-labelledby="workspace-dialog-title" aria-describedby="workspace-dialog-detail" onCancel={e => { e.preventDefault(); finish(false); }}>
    {question && <form onSubmit={event => { event.preventDefault(); finish(true); }}>
      <h2 id="workspace-dialog-title">{question.title}</h2>
      <p id="workspace-dialog-detail">{question.detail}</p>
      {question.input !== undefined && <label className="field"><span>Details</span><input autoFocus value={value} onChange={e => setValue(e.target.value)} required aria-describedby="workspace-dialog-detail" /></label>}
      <div className="button-row">
        {!question.notice && <button type="button" className="button secondary" autoFocus onClick={() => finish(false)}>Cancel</button>}
        <button type="submit" className={`button${question.danger ? " danger" : ""}`} autoFocus={question.notice}>{question.confirm ?? (question.notice ? "Got it" : "Continue")}</button>
      </div>
    </form>}
  </dialog>;
}
