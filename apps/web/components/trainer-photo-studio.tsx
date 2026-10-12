"use client";
import { useEffect, useState } from "react";
import { Camera, Check, ImagePlus, RefreshCw } from "lucide-react";
import { useWorkspaceValue } from "./workspace-continuity";

type Photo = { id: string; url: string; filename: string; generated?: boolean };
type Job = {
  id: string;
  requestId: string;
  status: string;
  style: string;
  referenceIds: string[];
  url?: string;
  photo?: Photo;
};
type Intent = {
  requestId: string;
  referenceIds: string[];
  style: string;
  detail: string;
  consent: true;
};
const looks = [
  {
    id: "portrait",
    title: "Coach portrait",
    text: "Natural light. A relaxed, familiar face.",
  },
  {
    id: "training",
    title: "Training moment",
    text: "Your presence in a warm training space.",
  },
  {
    id: "website",
    title: "Website cover",
    text: "A wide composition with room for your story.",
  },
];
async function api(path = "", method = "GET", body?: unknown) {
  const response = await fetch("/api/v1/tenant/photo-studio" + path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(method === "POST" && !path ? 210000 : 20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(
        data.message ||
          "The photo studio could not be reached. Please try again.",
      ),
      { code: data.code },
    );
  return data;
}
export function TrainerPhotoStudio({
  photos,
  onKept,
}: {
  photos: Photo[];
  onKept: (photo: Photo) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [style, setStyle] = useState("portrait"),
    [detail, setDetail] = useState("");
  const [consent, setConsent] = useState(false),
    [available, setAvailable] = useState(false),
    [loaded, setLoaded] = useState(false),
    [reason, setReason] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const [intent, setIntent] = useWorkspaceValue<Intent | null>(
    "photo-studio-intent",
    null,
    true,
  );
  const originals = photos.filter((photo) => !photo.generated);
  async function load(append = false) {
    const result = await api(append ? `?offset=${jobs.length}` : "");
    setAvailable(result.available);
    setReason(result.reason || "");
    setJobs((current) =>
      append
        ? [
            ...current,
            ...result.items.filter(
              (item: Job) => !current.some((job) => job.id === item.id),
            ),
          ]
        : result.items,
    );
    setMore(result.items.length === 24);
    setLoaded(true);
    setIntent((current) =>
      current &&
      result.items.some(
        (job: Job) =>
          job.requestId === current.requestId && job.status !== "running",
      )
        ? null
        : current,
    );
  }
  useEffect(() => {
    void load().catch((e) => {
      setLoaded(true);
      setError(e.message);
    });
  }, []);
  const pending = jobs.some((job) => job.status === "running");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [pending]);
  useEffect(() => {
    setSelected((current) =>
      current.filter((id) => originals.some((photo) => photo.id === id)),
    );
  }, [photos]);
  async function generate() {
    if (busy) return;
    const request = intent ?? {
      requestId: crypto.randomUUID(),
      referenceIds: selected,
      style,
      detail,
      consent: true as const,
    };
    setIntent(request);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const job = await api("", "POST", request);
      setJobs((current) => [
        job,
        ...current.filter((item) => item.id !== job.id),
      ]);
      setIntent(null);
    } catch (e: any) {
      setError(e.message);
      // Validation never reached a provider; an uncertain transport keeps the exact intent.
      if (
        [
          "PHOTO_UNAVAILABLE",
          "PHOTO_DAILY_LIMIT",
          "PHOTO_REFERENCE_UNAVAILABLE",
          "PHOTO_PRIVATE_DETAILS",
          "PHOTO_OUTCOME_PENDING",
          "PHOTO_ACCESS_CHANGED",
        ].includes(e.code)
      )
        setIntent(null);
    } finally {
      setBusy(false);
    }
  }
  async function act(job: Job, keep: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/${job.id}${keep ? "/keep" : ""}`,
        keep ? "POST" : "DELETE",
        keep ? { likenessConfirmed: true } : undefined,
      );
      if (keep) {
        setJobs((current) =>
          current.map((item) => (item.id === job.id ? result : item)),
        );
        setNotice(
          "Photo kept in your library. You can now choose where to use it.",
        );
        await onKept(result.photo);
      } else setJobs((current) => current.filter((item) => item.id !== job.id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="photo-studio" aria-labelledby="photo-studio-title">
      <header className="photo-studio-heading">
        <span className="photo-studio-icon">
          <Camera size={22} aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">Your photo studio</p>
          <h3 id="photo-studio-title">A new setting. Still you.</h3>
          <p className="muted">
            Turn your photos into natural portraits and website imagery. Your
            originals stay unchanged.
          </p>
        </div>
      </header>
      {!loaded && <p role="status">Opening your photo studio…</p>}
      {loaded && !available && (
        <p className="notice">
          {reason ||
            "The photo studio is unavailable right now. Your own uploads are ready to use."}
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              void load().then(
                () => setError(""),
                (e) => setError(e.message),
              )
            }
          >
            Refresh studio
          </button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {available && (
        <form
          className="photo-studio-form"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <fieldset disabled={busy || !!intent}>
            <legend>1. Choose photos of you</legend>
            <p className="muted">
              Select up to three clear photos of the same person. A front view
              and another angle help preserve your likeness.
            </p>
            {!originals.length && <p>Upload a photo above to get started.</p>}
            <div className="photo-reference-grid">
              {originals.map((photo) => (
                <button
                  type="button"
                  key={photo.id}
                  aria-pressed={selected.includes(photo.id)}
                  aria-label={`Use ${photo.filename} as a reference`}
                  disabled={
                    !selected.includes(photo.id) && selected.length >= 3
                  }
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(photo.id)
                        ? current.filter((id) => id !== photo.id)
                        : [...current, photo.id],
                    )
                  }
                >
                  <img src={photo.url} alt={photo.filename} loading="lazy" />
                  <span>
                    {selected.includes(photo.id) ? (
                      <Check size={15} aria-hidden="true" />
                    ) : (
                      <ImagePlus size={15} aria-hidden="true" />
                    )}
                    {selected.includes(photo.id) ? "Selected" : "Choose"}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={busy || !!intent}>
            <legend>2. Pick a setting</legend>
            <div className="photo-look-grid">
              {looks.map((look) => (
                <label className="photo-look" key={look.id}>
                  <input
                    type="radio"
                    name="photo-look"
                    value={look.id}
                    checked={style === look.id}
                    onChange={() => setStyle(look.id)}
                  />
                  <span>
                    <strong>{look.title}</strong>
                    <small>{look.text}</small>
                  </span>
                </label>
              ))}
            </div>
            <label className="field">
              A personal touch <span className="muted">Optional</span>
              <textarea
                maxLength={500}
                rows={2}
                placeholder="For example, a bright studio with warm neutral colours"
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
              />
            </label>
            <label className="photo-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              These are photos of me as an adult. I agree to send the selected
              photos to the AI model to create a private draft.
            </label>
          </fieldset>
          <div className="photo-generate-row">
            <div>
              <strong>One photo at a time</strong>
              <p className="muted">
                Face, age and body shape are kept in the brief. Review the
                result before using it.
              </p>
            </div>
            <button
              type="submit"
              className="button"
              disabled={busy || (!intent && (!selected.length || !consent))}
            >
              {busy
                ? "Preparing your photo…"
                : intent
                  ? "Retry the same request"
                  : "Create photo draft"}
            </button>
          </div>
          {intent && !busy && (
            <p className="muted">
              We haven’t confirmed this request yet. Retrying checks the same
              request and does not purchase it twice.
            </p>
          )}
        </form>
      )}
      {!!jobs.length && (
        <div className="photo-studio-drafts">
          <div className="photo-drafts-heading">
            <h4>3. Review your drafts</h4>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void load().catch((e) => setError(e.message))}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Check status
            </button>
          </div>
          {jobs.map((job) => (
            <article className="photo-draft" key={job.id}>
              {job.status === "ready" && (
                <>
                  <div className="photo-comparison">
                    <figure>
                      <img
                        src={
                          photos.find(
                            (photo) => photo.id === job.referenceIds[0],
                          )?.url
                        }
                        alt="Your original reference"
                        loading="lazy"
                      />
                      <figcaption>Original</figcaption>
                    </figure>
                    <figure>
                      <a href={job.url} target="_blank" rel="noopener">
                        <img
                          src={job.url}
                          alt="Generated coaching photo draft — review your likeness"
                          loading="lazy"
                        />
                      </a>
                      <figcaption>New draft · open to inspect</figcaption>
                    </figure>
                  </div>
                  <label className="photo-consent">
                    <input
                      type="checkbox"
                      checked={reviewed.includes(job.id)}
                      onChange={(e) =>
                        setReviewed((current) =>
                          e.target.checked
                            ? [...current, job.id]
                            : current.filter((id) => id !== job.id),
                        )
                      }
                    />
                    I checked the face, hands and body. This photo represents me
                    accurately.
                  </label>
                  <div className="button-row">
                    <button
                      type="button"
                      className="button"
                      disabled={busy || !reviewed.includes(job.id)}
                      onClick={() => void act(job, true)}
                    >
                      Keep in photo library
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void act(job, false)}
                    >
                      Discard draft
                    </button>
                  </div>
                </>
              )}
              {job.status === "kept" && (
                <div className="photo-kept">
                  <Check size={18} aria-hidden="true" />
                  <span>
                    Kept in your photo library
                    {job.photo ? ` · ${job.photo.filename}` : ""}
                  </span>
                </div>
              )}
              {job.status === "running" && (
                <p role="status">
                  Preparing your photo. You can leave this screen and find the
                  draft here later.
                </p>
              )}
              {job.status === "failed" && (
                <>
                  <p>
                    This draft could not be prepared. Check your reference
                    photos and the model connection before trying again.
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void act(job, false)}
                  >
                    Dismiss
                  </button>
                </>
              )}
              {job.status === "unknown" && (
                <p className="notice">
                  The model’s response could not be confirmed. This request is
                  kept for a status check; it will not be generated again
                  automatically. Contact support if it stays unresolved.
                </p>
              )}
            </article>
          ))}
          {more && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void load(true).catch((e) => setError(e.message))}
            >
              Load older drafts
            </button>
          )}
        </div>
      )}
    </section>
  );
}
