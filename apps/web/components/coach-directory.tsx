import Link from "next/link";
import type { ReactNode } from "react";
import {
  DEFAULT_PLATFORM_NAME,
  DIRECTORY_PAGE_SIZE,
  appInitials,
} from "@trainer/contracts";
import { MarketingHeader } from "./marketing/frame";
import { SubscriberFooter } from "./subscriber-footer";
import { translator, type Locale, type Translator } from "../lib/i18n/core";
import publicMessages, { DIRECTORY_LABELS_AR } from "../lib/i18n/messages/public";
import { formatList, formatRange } from "../lib/format";

type T = Translator<typeof publicMessages.en>;
/** A specialty or language name in the page's language. */
function optionLabel(option: Option, locale: Locale) {
  return locale === "ar"
    ? (DIRECTORY_LABELS_AR[option.id] ?? option.label)
    : option.label;
}
/** Bold lead-in before the rest of a line: "<b>Question?</b> Answer." */
function lead(text: string) {
  const match = /^<b>(.*?)<\/b>\s*(.*)$/.exec(text);
  return match ? (
    <>
      <strong>{match[1]}</strong> {match[2]}
    </>
  ) : (
    text
  );
}

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

function CoachCard({
  coach,
  t,
  locale,
}: {
  coach: DirectoryCoach;
  t: T;
  locale: Locale;
}) {
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
          <h2 id={headingId} dir="auto">
            {coach.name}
          </h2>
          {coach.headline && <p dir="auto">{coach.headline}</p>}
          <ul className="directory-tags" aria-label={t("specialties")}>
            {coach.specialties.map((s) => (
              <li key={s.id}>{optionLabel(s, locale)}</li>
            ))}
          </ul>
          <p className="muted directory-languages">
            {t("coachesIn", {
              languages:
                locale === "en"
                  ? coach.languages.map((l) => l.label).join(", ")
                  : formatList(
                      coach.languages.map((l) => optionLabel(l, locale)),
                      locale,
                    ),
            })}
          </p>
          <a className="button secondary directory-visit" href={coach.url}>
            {t("visitWebsite", { name: coach.name })}
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
  locale = "en",
}: {
  data: DirectoryData;
  platformName: string;
  /** The document language (rendered on the server). */
  locale?: Locale;
}) {
  const t = translator(publicMessages, locale);
  const { query } = data;
  const filtered = !!(query.q || query.specialty || query.language);
  const previous =
    query.offset > 0 ? Math.max(0, query.offset - DIRECTORY_PAGE_SIZE) : null;
  return (
    <DirectoryFrame platformName={platformName}>
      <p className="eyebrow">{t("findCoachEyebrow")}</p>
      <h1>{t("directoryTitle")}</h1>
      <p className="muted directory-intro">{t("directoryIntro")}</p>
      <form
        className="directory-search"
        method="get"
        action="/coaches"
        role="search"
      >
        <label className="field">
          <span>{t("nameOrFocus")}</span>
          <input
            name="q"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={80}
            defaultValue={query.q}
            placeholder={t("searchPlaceholder")}
          />
        </label>
        <label className="field">
          <span>{t("specialty")}</span>
          <select name="specialty" defaultValue={query.specialty}>
            <option value="">{t("anySpecialty")}</option>
            {data.options.specialties.map((o) => (
              <option key={o.id} value={o.id}>
                {optionLabel(o, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("language")}</span>
          <select name="language" defaultValue={query.language}>
            <option value="">{t("anyLanguage")}</option>
            {data.options.languages.map((o) => (
              <option key={o.id} value={o.id}>
                {optionLabel(o, locale)}
              </option>
            ))}
          </select>
        </label>
        <div className="directory-search-actions">
          <button className="button" type="submit">
            {t("searchCoaches")}
          </button>
          {filtered && (
            <Link className="button secondary" href="/coaches">
              {t("clearFilters")}
            </Link>
          )}
        </div>
      </form>
      {data.error ? (
        <p className="notice" role="alert">
          {locale === "en" ? data.error : t("searchUnreadable")}
        </p>
      ) : data.coaches.length ? (
        <>
          <p className="muted directory-count" role="status">
            {t(filtered ? "showingMatching" : "showing", {
              // "3–10" is one left-to-right range in either direction.
              range: formatRange(
                query.offset + 1,
                query.offset + data.coaches.length,
                locale,
              ),
            })}
          </p>
          <ul className="directory-grid">
            {data.coaches.map((coach) => (
              <CoachCard
                key={coach.slug}
                coach={coach}
                t={t}
                locale={locale}
              />
            ))}
          </ul>
        </>
      ) : (
        <DirectoryEmpty filtered={filtered} t={t} />
      )}
      {(previous !== null || data.nextOffset !== null) && (
        <nav className="directory-pages" aria-label={t("directoryPages")}>
          {previous !== null && (
            <Link href={directoryHref(query, previous)}>
              {t("previousCoaches")}
            </Link>
          )}
          {data.nextOffset !== null && (
            <Link href={directoryHref(query, data.nextOffset)}>
              {t("moreCoaches")}
            </Link>
          )}
        </nav>
      )}
    </DirectoryFrame>
  );
}

/**
 * No results, with somewhere to go next: clear the filters, open a coach's
 * link or invitation, or sign in for someone who already has a coach.
 */
function DirectoryEmpty({ filtered, t }: { filtered: boolean; t: T }) {
  return (
    <section
      className="card directory-empty"
      role="status"
      aria-labelledby="directory-empty-title"
    >
      <h2 id="directory-empty-title">
        {filtered ? t("noMatch") : t("noneListed")}
      </h2>
      <p className="muted">{filtered ? t("noMatchHint") : t("noneListedHint")}</p>
      <ul className="directory-next">
        <li>{lead(t("haveLink"))}</li>
        <li>{lead(t("alreadyCoaching"))}</li>
      </ul>
      <div className="directory-empty-actions">
        {filtered ? (
          <Link className="button" href="/coaches">
            {t("clearFilters")}
          </Link>
        ) : null}
        <Link
          className={filtered ? "button secondary" : "button"}
          href="/login"
        >
          {t("signIn")}
        </Link>
      </div>
    </section>
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
    <div className="public directory-page platform-ui">
      <MarketingHeader
        appName={platformName}
        initials={appInitials(platformName)}
        cta={{ label: "List your coaching", href: "/get-started" }}
        path="/coaches"
      />
      <main className="directory" id="main">
        {children}
      </main>
      {/* Visitors looking for a coach get the subscriber footer, not the
          trainer-marketing one. */}
      <SubscriberFooter name={platformName} directory={false} />
    </div>
  );
}

/**
 * Shown at /coaches while the Super admin has closed the directory, so the
 * marketing header link and trainers' links explain the state instead of
 * ending on a missing page.
 */
export function CoachDirectoryClosed({
  platformName = DEFAULT_PLATFORM_NAME,
  locale = "en",
}: {
  platformName?: string;
  locale?: Locale;
}) {
  const t = translator(publicMessages, locale);
  return (
    <DirectoryFrame platformName={platformName}>
      <p className="eyebrow">{t("findCoachEyebrow")}</p>
      <section className="card directory-empty" role="status">
        <h1 className="directory-closed-title">{t("directoryClosed")}</h1>
        <p className="muted">{t("directoryClosedText")}</p>
        <div className="directory-empty-actions">
          <Link className="button secondary" href="/">
            {t("returnHome")}
          </Link>
        </div>
      </section>
    </DirectoryFrame>
  );
}
