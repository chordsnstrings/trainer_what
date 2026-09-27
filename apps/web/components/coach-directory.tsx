import Link from "next/link";
import type { ReactNode } from "react";
import { DIRECTORY_PAGE_SIZE, appInitials } from "@trainer/contracts";

type Option = { id: string; label: string };
export type DirectoryCoach = {
  slug: string;
  name: string;
  headline: string;
  photoUrl: string | null;
  specialties: Option[];
  languages: Option[];
  url: string;
};
export type DirectoryData = {
  coaches: DirectoryCoach[];
  nextOffset: number | null;
  query: { q: string; specialty: string; language: string; offset: number };
  options: { specialties: Option[]; languages: Option[] };
  error?: string;
};

/** Search addresses keep only known filters, so links stay canonical. */
export function directoryHref(
  query: DirectoryData["query"],
  offset = 0,
): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.specialty) params.set("specialty", query.specialty);
  if (query.language) params.set("language", query.language);
  if (offset > 0) params.set("offset", String(offset));
  const search = params.toString();
  return "/coaches" + (search ? "?" + search : "");
}

function CoachCard({ coach }: { coach: DirectoryCoach }) {
  const headingId = `coach-${coach.slug}`;
  return (
    <li>
      <article className="directory-card" aria-labelledby={headingId}>
        {coach.photoUrl ? (
          <img
            className="directory-photo"
            src={coach.photoUrl}
            alt=""
            width={72}
            height={72}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            className="directory-photo directory-initials"
            aria-hidden="true"
          >
            {appInitials(coach.name)}
          </span>
        )}
        <div className="directory-card-body">
          <h2 id={headingId}>{coach.name}</h2>
          {coach.headline && <p>{coach.headline}</p>}
          <ul className="directory-tags" aria-label="Specialties">
            {coach.specialties.map((s) => (
              <li key={s.id}>{s.label}</li>
            ))}
          </ul>
          <p className="muted directory-languages">
            Coaches in {coach.languages.map((l) => l.label).join(", ")}
          </p>
          <a className="button secondary" href={coach.url}>
            Visit {coach.name}’s website
          </a>
        </div>
      </article>
    </li>
  );
}

/**
 * The public coach directory. It is rendered on the server with a plain GET
 * form, so search, filters and paging work without client JavaScript.
 */
export function CoachDirectory({
  data,
  platformName,
}: {
  data: DirectoryData;
  platformName: string;
}) {
  const { query } = data;
  const filtered = !!(query.q || query.specialty || query.language);
  const previous =
    query.offset > 0 ? Math.max(0, query.offset - DIRECTORY_PAGE_SIZE) : null;
  return (
    <DirectoryFrame platformName={platformName}>
      <p className="eyebrow">FIND A COACH</p>
      <h1>Coaches who chose to be found.</h1>
      <p className="muted directory-intro">
        Every coach here opted in. Each profile links to the coach’s own
        website, where you can read about their approach and memberships.
      </p>
      <form
        className="directory-search"
        method="get"
        action="/coaches"
        role="search"
      >
        <label className="field">
          <span>Name or focus</span>
          <input
            name="q"
            type="search"
            maxLength={80}
            defaultValue={query.q}
            placeholder="For example, strength or a coach’s name"
          />
        </label>
        <label className="field">
          <span>Specialty</span>
          <select name="specialty" defaultValue={query.specialty}>
            <option value="">Any specialty</option>
            {data.options.specialties.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Language</span>
          <select name="language" defaultValue={query.language}>
            <option value="">Any language</option>
            {data.options.languages.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="directory-search-actions">
          <button className="button" type="submit">
            Search coaches
          </button>
          {filtered && <Link href="/coaches">Clear filters</Link>}
        </div>
      </form>
      {data.error ? (
        <p className="notice" role="alert">
          {data.error}
        </p>
      ) : data.coaches.length ? (
        <>
          <p className="muted directory-count" role="status">
            Showing {query.offset + 1}–{query.offset + data.coaches.length}
            {filtered ? " matching coaches" : " coaches"}
          </p>
          <ul className="directory-grid">
            {data.coaches.map((coach) => (
              <CoachCard key={coach.slug} coach={coach} />
            ))}
          </ul>
        </>
      ) : (
        <section className="card directory-empty" role="status">
          <h2>
            {filtered
              ? "No coaches match this search."
              : "No coaches are listed yet."}
          </h2>
          <p className="muted">
            {filtered
              ? "Try another specialty or language, or clear the filters."
              : "Coaches appear here after they launch and choose to be listed."}
          </p>
        </section>
      )}
      {(previous !== null || data.nextOffset !== null) && (
        <nav className="directory-pages" aria-label="Directory pages">
          {previous !== null && (
            <Link href={directoryHref(query, previous)}>Previous coaches</Link>
          )}
          {data.nextOffset !== null && (
            <Link href={directoryHref(query, data.nextOffset)}>
              More coaches
            </Link>
          )}
        </nav>
      )}
    </DirectoryFrame>
  );
}

/** Shared public header and footer of the directory pages. */
function DirectoryFrame({
  platformName,
  children,
}: {
  platformName: string;
  children: ReactNode;
}) {
  return (
    <div className="public directory-page">
      <header className="public-header">
        <Link href="/" className="wordmark" aria-label={platformName + " home"}>
          <span className="brand-mark">b.</span>
          <span>
            trainer<span className="wordmark-light">brain</span>
          </span>
        </Link>
        <nav aria-label="Platform">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/pricing">The economics</Link>
          <Link href="/login">Sign in</Link>
        </nav>
        <Link className="button" href="/signup">
          List your coaching
        </Link>
      </header>
      <main className="directory">{children}</main>
      <footer className="directory-footer">
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/ai-disclosure">Digital coaching</Link>
      </footer>
    </div>
  );
}

/**
 * Shown at /coaches while the Super admin has closed the directory, so the
 * marketing header link and trainers' links explain the state instead of
 * ending on a missing page.
 */
export function CoachDirectoryClosed({
  platformName = "Trainer Brain",
}: {
  platformName?: string;
}) {
  return (
    <DirectoryFrame platformName={platformName}>
      <p className="eyebrow">FIND A COACH</p>
      <section className="card directory-empty" role="status">
        <h1 className="directory-closed-title">
          The coach directory is closed right now.
        </h1>
        <p className="muted">
          Coaches’ own websites are still open. If you have a coach’s link or
          invitation, use it to visit their website or join.
        </p>
        <p>
          <Link href="/">Return to the home page</Link>
        </p>
      </section>
    </DirectoryFrame>
  );
}
