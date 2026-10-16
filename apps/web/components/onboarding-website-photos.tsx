"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, X } from "lucide-react";
import { fileBase64, onboardingRequest as request } from "../lib/onboarding-http";
import { websitePhotosSchema, type WebsitePhotos } from "../../../packages/domain/src/website-interview";

type Photo = { id: string; url: string; filename: string; generated?: boolean };
export function OnboardingWebsitePhotos({ disabled, onChoose }: { disabled: boolean; onChoose: (choice: WebsitePhotos) => Promise<void> }) {
  const [library, setLibrary] = useState<Photo[]>([]), [chosen, setChosen] = useState<WebsitePhotos["photos"]>([]);
  const [rights, setRights] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [offset, setOffset] = useState<number | null>(0);
  const picker = useRef<HTMLInputElement>(null), mounted = useRef(true), flight = useRef(false);
  async function load(at = 0) {
    try {
      const data = await request(`/tenant/media?offset=${at}`);
      if (!mounted.current) return;
      setLibrary(old => [...new Map([...old, ...data.items].map(p => [p.id, p])).values()]);
      setOffset(data.items.length === 48 ? at + 48 : null); setLoaded(true);
    } catch (e) { if (mounted.current) { setError((e as Error).message); setLoaded(true); } }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  function select(photo: Photo) {
    setChosen(old => old.some(p => p.mediaId === photo.id) ? old.filter(p => p.mediaId !== photo.id) : old.length < 8 ? [...old, { mediaId: photo.id, role: old.length ? "training" : "portrait", alt: "" }] : old);
  }
  async function upload(files: File[]) {
    if (!rights || disabled || flight.current || !files.length) return;
    if (files.length + chosen.length > 8) { setError("Choose up to eight photos for this draft."); return; }
    flight.current = true; setBusy(true); setError("");
    try {
      for (const file of files) {
        if (!file.size || file.size > 8 * 1024 * 1024) throw Error("Choose JPEG, PNG or WebP photos up to 8 MB each.");
        const photo = await request("/tenant/media", { filename: file.name, data: await fileBase64(file), rightsConfirmed: true });
        if (!mounted.current) return;
        setLibrary(old => [photo, ...old.filter(p => p.id !== photo.id)]);
        setChosen(old => old.some(p => p.mediaId === photo.id) ? old : [...old, { mediaId: photo.id, role: old.length ? "training" : "portrait", alt: "" }]);
      }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { flight.current = false; if (mounted.current) setBusy(false); }
  }
  const valid = websitePhotosSchema.safeParse({ choice: "photos", photos: chosen, rightsConfirmed: rights }).success;
  return <section className="onboarding-inline-card onboarding-website-photos" aria-label="Photos for your website">
    <h3>Your website, your photos</h3>
    <p>A portrait and a few training photos give the studio enough to build your pages and photo scroll sections. Choose up to eight.</p>
    <label className="onboarding-choice"><input type="checkbox" checked={rights} disabled={disabled || busy} onChange={e => setRights(e.target.checked)} /> I have permission to use these photos on my public website, including permission from anyone shown.</label>
    <input ref={picker} hidden type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Upload website photos" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; void upload(files); }} />
    <button type="button" className="button secondary" disabled={!rights || disabled || busy || chosen.length >= 8} onClick={() => picker.current?.click()}><Camera size={17} /> Upload my photos</button>
    {!loaded && <p role="status">Loading your photo library…</p>}
    {!!library.length && <div className="onboarding-website-photo-grid">{library.map(photo => {
      const selected = chosen.some(p => p.mediaId === photo.id);
      return <button key={photo.id} type="button" aria-label={(selected ? "Remove " : "Choose ") + photo.filename} aria-pressed={selected} disabled={disabled || busy || !selected && chosen.length >= 8} onClick={() => select(photo)}>
        <img src={photo.url} alt={photo.filename} loading="lazy" width={180} height={130} />
        <span>{selected && <Check size={14} />} {photo.filename}{photo.generated ? " · AI image" : ""}</span>
      </button>;
    })}</div>}
    {offset !== null && loaded && <button type="button" className="text-link" disabled={disabled || busy} onClick={() => void load(offset)}>More photos</button>}
    {chosen.map((photo, i) => <div className="onboarding-website-photo-detail" key={photo.mediaId}>
      <div className="onboarding-card-top"><strong>Photo {i + 1}</strong><button type="button" className="onboarding-icon" aria-label={`Remove photo ${i + 1}`} disabled={disabled || busy} onClick={() => setChosen(old => old.filter(p => p.mediaId !== photo.mediaId))}><X size={16} /></button></div>
      <label>Use this as<select value={photo.role} disabled={disabled || busy} onChange={e => setChosen(old => old.map(p => p.mediaId === photo.mediaId ? { ...p, role: e.target.value as typeof photo.role } : p))}><option value="portrait">My portrait</option><option value="cover">Main website photo</option><option value="training">My training</option></select></label>
      <label>What does this photo show?<input value={photo.alt} maxLength={240} disabled={disabled || busy} placeholder="For example, me coaching a squat" onChange={e => setChosen(old => old.map(p => p.mediaId === photo.mediaId ? { ...p, alt: e.target.value } : p))} /></label>
    </div>)}
    {error && <p role="alert" className="onboarding-warning">{error}</p>}
    {busy && <p role="status">Saving your photos…</p>}
    <div className="onboarding-website-photo-actions">
      <button type="button" className="button" disabled={disabled || busy || !valid} onClick={() => void onChoose({ choice: "photos", photos: chosen, rightsConfirmed: true })}>Use these photos</button>
      <button type="button" className="text-link" disabled={disabled || busy} onClick={() => void onChoose({ choice: "later", photos: [], rightsConfirmed: false })}>Prepare my draft; I’ll add photos later</button>
    </div>
    <small>Files shared privately in chat are kept separate. Selecting photos here does not publish your website.</small>
  </section>;
}
