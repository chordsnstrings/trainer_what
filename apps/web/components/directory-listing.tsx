"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Option = { id: string; label: string };
type Listing = {
  listed: boolean;
  specialties: string[];
  languages: string[];
  version: number;
  directoryOpen: boolean;
  published: boolean;
  visible: boolean;
  status: "not_listed" | "directory_closed" | "waiting_for_launch" | "listed";
  preview: {
    name: string;
    headline: string;
    photoUrl: string | null;
    url: string;
  };
  options: { specialties: Option[]; languages: Option[] };
};

async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message ?? "Please try again.");
  return data;
}

const statusText: Record<Listing["status"], string> = {
  not_listed:
    "Not listed. Visitors can still reach your website through its own address.",
  directory_closed:
    "The platform directory is closed right now. Your choice is saved and applies when it reopens.",
  waiting_for_launch:
    "Saved. You will appear in the directory once your coaching storefront is launched.",
  listed: "Listed. Visitors can find you in the public coach directory.",
};
const limits = { specialties: 6, languages: 8 } as const;

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((word) => Array.from(word)[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "•"
  );
}

/**
 * Opt-in listing in the platform's public coach directory. Off by default;
 * only the name, headline, photo, specialties, languages and website link are
 * shown, never anything about members.
 */
export function DirectoryListingSettings() {
  const [data, setData] = useState<Listing | null>(null),
    [draft, setDraft] = useState<{
      listed: boolean;
      specialties: string[];
      languages: string[];
    } | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  function accept(next: Listing) {
    setData(next);
    setDraft({
      listed: next.listed,
      specialties: next.specialties,
      languages: next.languages,
    });
  }
  async function load() {
    setMessage("");
    try {
      accept(await api("/tenant/directory"));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function toggle(key: "specialties" | "languages", id: string) {
    if (!draft) return;
    const current = draft[key];
    setDraft({
      ...draft,
      [key]: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    });
  }
  async function save() {
    if (!data || !draft) return;
    setBusy(true);
    setMessage("");
    try {
      const saved: Listing = await api("/tenant/directory", "PUT", {
        version: data.version,
        ...draft,
      });
      accept(saved);
      setMessage(
        saved.listed
          ? statusText[saved.status]
          : "Directory listing turned off.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const missing =
    draft?.listed && (!draft.specialties.length || !draft.languages.length);
  return (
    <section
      className="card directory-settings"
      aria-labelledby="directory-heading"
    >
      <h2 id="directory-heading">Public coach directory</h2>
      <p className="muted">
        Choose whether prospective clients can find you in the platform’s coach
        directory. It shows your name, headline, photo, specialties, languages
        and a link to your website. Nothing about your members is ever shown.
      </p>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!data && !message && <p>Loading your directory listing…</p>}
      {!data && message && (
        <button className="secondary" type="button" onClick={() => void load()}>
          Retry loading directory listing
        </button>
      )}
      {data && draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="directory-status" data-status={data.status}>
            {statusText[data.status]}
            {data.visible && (
              <>
                {" "}
                <Link href="/coaches">Open the directory</Link>
              </>
            )}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.listed}
              onChange={(e) => setDraft({ ...draft, listed: e.target.checked })}
            />
            List my coaching in the public directory
          </label>
          {(["specialties", "languages"] as const).map((key) => (
            <fieldset key={key} className="directory-choices">
              <legend>
                {key === "specialties"
                  ? `Specialties (up to ${limits.specialties})`
                  : `Coaching languages (up to ${limits.languages})`}
              </legend>
              <div className="directory-options">
                {data.options[key].map((option) => {
                  const checked = draft[key].includes(option.id);
                  return (
                    <label className="check" key={option.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && draft[key].length >= limits[key]}
                        onChange={() => toggle(key, option.id)}
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          {missing && (
            <p className="muted" role="note">
              Choose at least one specialty and one language to be listed.
            </p>
          )}
          <div className="directory-preview" aria-label="Directory preview">
            {data.preview.photoUrl ? (
              <img
                src={data.preview.photoUrl}
                alt=""
                width={56}
                height={56}
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="directory-initials" aria-hidden="true">
                {initials(data.preview.name)}
              </span>
            )}
            <div>
              <strong>{data.preview.name}</strong>
              <p className="muted">
                {data.preview.headline ||
                  "Add a headline to your website or Design Studio."}
              </p>
            </div>
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              Discard changes
            </button>
            <button type="submit" disabled={busy || !!missing}>
              Save directory listing
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
