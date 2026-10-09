"use client";
import { memberApiUrl } from "../lib/trainer-preview-routing";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FileText, Paperclip, Plus, X, Image as ImageIcon } from "lucide-react";
import type { OnboardingAttachment } from "../../../packages/domain/src/onboarding-chat";
import { fileBase64, onboardingRequest as request } from "../lib/onboarding-http";

export const ONBOARDING_FILE_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.md,.rtf,.odt,.ods,.pptx,.json,.jpg,.jpeg,.png,.webp";
export function OnboardingFile({ file, remove, disabled = false }: { file: OnboardingAttachment; remove?: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [body, setBody] = useState(file.preview ?? ""), [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  async function preview() {
    setOpen(!open);
    if (loaded || open) return;
    try { const next = await request("/onboarding-chat/attachments/" + file.id); setBody(next.text); setLoaded(true); }
    catch (e) { setError((e as Error).message); }
  }
  return <div className={"onboarding-file" + (file.image ? " photo" : "")}>
    {file.image && <img src={memberApiUrl("/api/v1/onboarding-chat/attachments/" + file.id + "?image=1")} alt={file.name} loading="lazy" width={280} height={180} />}
    <div className="onboarding-file-row">
      <span className="onboarding-file-symbol" aria-hidden="true">{file.image ? <ImageIcon size={20} /> : <FileText size={22} />}</span>
      <button type="button" className="onboarding-file-title" onClick={() => void preview()} aria-expanded={open}><strong dir="auto">{file.name}</strong><small>{file.format} · {Math.max(1, Math.round(file.bytes / 1024))} KB · {open ? "Close preview" : "Preview"}</small></button>
      {remove && <button type="button" className="onboarding-icon" aria-label={"Remove " + file.name} disabled={disabled} onClick={remove}><X size={17} /></button>}
    </div>
    {open && <div className="onboarding-file-preview">
      {error ? <p role="alert">{error}</p> : <pre dir="auto">{body || (file.image ? "No text was detected. Add a message about what matters in this image." : "Reading the saved text…")}</pre>}
      {file.warnings.map(w => <small key={w}>{w}</small>)}
      <small>{file.image ? "A private copy without photo metadata." : "Text copy saved. Keep your original file for its formatting."}</small>
    </div>}
  </div>;
}
export type OnboardingFilesHandle = { add: (files: File[]) => void };
export const OnboardingFiles = forwardRef<OnboardingFilesHandle, {
  files: OnboardingAttachment[]; onChange: (files: OnboardingAttachment[]) => void; onBusy: (busy: boolean) => void; disabled: boolean; ios: boolean;
}>(function OnboardingFiles({ files, onChange, onBusy, disabled, ios }, ref) {
  const [open, setOpen] = useState(false), [rights, setRights] = useState(false), [error, setError] = useState(""), [uploading, setUploading] = useState("");
  const picker = useRef<HTMLInputElement>(null), flight = useRef(false), alive = useRef(true), latest = useRef(files);
  const keys = useRef(new Map<string, string>()), pasted = useRef<File[]>([]);
  latest.current = files;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const add = async (chosen: File[]) => {
    if (disabled || flight.current || !chosen.length) return;
    setOpen(true); setError("");
    if (!rights) { pasted.current = chosen; return; }
    if (chosen.length + latest.current.length > 3) { setError("Send up to three files at a time."); return; }
    flight.current = true; onBusy(true);
    try {
      for (const file of chosen) {
        if (!file.size || file.size > 5 * 1024 * 1024) throw Error("Choose files under 5 MB each.");
        if (!ONBOARDING_FILE_ACCEPT.split(",").some(ext => file.name.toLowerCase().endsWith(ext))) throw Error("Use a PDF, Office document, note, spreadsheet or JPEG, PNG or WebP image.");
        setUploading(file.name);
        const key = file.name + ":" + file.size + ":" + file.lastModified;
        if (!keys.current.has(key)) keys.current.set(key, crypto.randomUUID());
        const result = await request("/onboarding-chat/attachments", { id: keys.current.get(key), fileName: file.name, contentBase64: await fileBase64(file), rights: true });
        if (!alive.current) return;
        latest.current = [...latest.current.filter(f => f.id !== result.id), result];
        onChange(latest.current);
      }
      pasted.current = [];
      setOpen(false);
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { flight.current = false; if (alive.current) { setUploading(""); onBusy(false); } }
  };
  useImperativeHandle(ref, () => ({ add: chosen => void add(chosen) }));
  return <div className="onboarding-attach-control">
    <button type="button" className="onboarding-icon" aria-label="Attach files" aria-expanded={open} disabled={disabled || !!uploading || files.length >= 3} onClick={() => setOpen(!open)}>{ios ? <Plus size={24} /> : <Paperclip size={21} />}</button>
    <input ref={picker} type="file" accept={ONBOARDING_FILE_ACCEPT} multiple hidden aria-label="Choose files for this conversation" onChange={e => { const chosen = Array.from(e.target.files ?? []); e.target.value = ""; void add(chosen); }} />
    {open && <div className="onboarding-attach-menu">
      <div className="onboarding-card-top"><strong>Something to share?</strong><button type="button" className="onboarding-icon" aria-label="Close attachments" onClick={() => { setOpen(false); pasted.current = []; }}><X size={17} /></button></div>
      <p>Plans, notes, PDFs, Word, Excel, slides or photos. Up to 3 files, 5 MB each.</p>
      <label className="onboarding-choice"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} /> These are mine, or I have permission to use them.</label>
      <button type="button" className="button" disabled={!rights || !!uploading} onClick={() => pasted.current.length ? void add(pasted.current) : picker.current?.click()}>{pasted.current.length ? "Add shared files" : "Choose files"}</button>
      {error && <p className="onboarding-warning" role="alert">{error}</p>}
      {uploading && <p role="status">Reading {uploading}…</p>}
    </div>}
    {!!uploading && !open && <span className="sr-only" role="status">Reading {uploading}…</span>}
  </div>;
});
