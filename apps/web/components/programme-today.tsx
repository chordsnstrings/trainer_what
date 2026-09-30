"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useT } from "../lib/i18n/react";
import { formatDate, formatDateRange, formatNumber } from "../lib/format";
import type { Locale } from "../lib/i18n/core";
import { CountUp, DrawnCheck, ProgressRing, Skeleton } from "./phone-ui";
import { MOTION } from "./motion";

/**
 * What happens when the programme ends, the programme timeline
 * (docs/features/programme.md) and the workout's completion moment. The
 * Today screen itself is components/member-today.tsx. Every line is in the
 * member's language (docs/features/arabic.md).
 */
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "The request failed"), {
      status: r.status,
      code: data.code,
    });
  return data;
}
function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}
const zoneQuery = () => {
  const zone = deviceTimeZone();
  return zone ? `?timezone=${encodeURIComponent(zone)}` : "";
};
/** A calendar day: "Tue 29 Sep" (Arabic "الثلاثاء، 29 سبتمبر"). */
const calendarDay = (date: string, locale: Locale = "en") =>
  formatDate(date, { weekday: true, year: false, locale });

export function EndOfProgramme({ data }: { data: any }) {
  const end = data.endOfProgramme;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const t = useT("today"),
    locale = useLocale();
  if (!end || end.state === "none") return null;
  // A monthly block rolling into the next one is routine: said once on the
  // timeline, not on Today.
  if (end.state === "next_block" || end.state === "renews") return null;
  const renew = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api("/payments/checkout", "POST", {
        productId: end.renewProductId,
      });
      if (r?.url) window.location.assign(r.url);
    } catch {
      setError(t("fCheckoutFailed"));
    } finally {
      setBusy(false);
    }
  };
  const renewControl =
    end.canRenew &&
    (end.renewProductId ? (
      <button className="button" disabled={busy} onClick={() => void renew()}>
        {busy ? t("openingCheckout") : t("startNext")}
      </button>
    ) : (
      <Link className="button secondary" href="/app/membership#offers">
        {t("chooseNext")}
      </Link>
    ));
  return (
    <div
      className={
        "programme-end" +
        (end.state === "ends" || end.state === "ended" ? " ending" : "")
      }
      role="status"
    >
      {end.state === "ends" && (
        <p>
          {t("accessEnds", { date: formatDate(end.at, { locale }) })}
          {data.programme?.billing === "upfront"
            ? t("paidInFull")
            : t("renewalOff")}
        </p>
      )}
      {end.state === "ended" && (
        <p>
          {data.programme?.billing === "upfront"
            ? t("completedProgramme")
            : t("membershipEnded")}
        </p>
      )}
      {renewControl}
      {error && (
        <p className="muted" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const STATUS_KEYS = [
  "done",
  "missed",
  "today",
  "upcoming",
  "rest",
  "canceled",
] as const;

/** The block's days in weeks of seven, for the phone list. */
export function timelineWeeks<T extends { date: string }>(days: T[]) {
  const weeks: Array<{ index: number; from: string; to: string; days: T[] }> =
    [];
  days.forEach((d, i) => {
    const w = Math.floor(i / 7);
    if (!weeks[w])
      weeks[w] = { index: w + 1, from: d.date, to: d.date, days: [] };
    weeks[w].days.push(d);
    weeks[w].to = d.date;
  });
  return weeks;
}

/**
 * Every day of the current programme (upfront) or block (monthly), with its
 * session and status, by week (the current week open). Its blocks settle in
 * on the first view (`data-stagger`); a week opens to its height (the
 * disclosure motion in motion.css).
 */
export function ProgrammeTimeline({ programLabel }: { programLabel?: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(false);
  const t = useT("today"),
    locale = useLocale();
  const load = () =>
    api("/programme/timeline" + zoneQuery()).then(
      (d) => {
        setData(d);
        setError(false);
      },
      () => setError(true),
    );
  useEffect(() => {
    void load();
  }, []);
  if (error)
    return (
      <section className="card" role="alert">
        <h1>{t("tlTitle")}</h1>
        <p className="muted">{t("tlFailed")}</p>
        <button className="button secondary" onClick={() => void load()}>
          {t("tryAgain")}
        </button>
      </section>
    );
  if (!data)
    return (
      <section className="card">
        <Skeleton label={t("tlLoading")} lines={5} />
      </section>
    );
  const p = data.programme;
  if (!p)
    return (
      <section className="card">
        <h1>{t("noProgramme")}</h1>
        <p className="muted">{t("noProgrammeText")}</p>
        <Link className="button" href="/app/membership">
          {t("membershipOptions")}
        </Link>
      </section>
    );
  const days: any[] = data.days ?? [];
  const done = days.filter((d) => d.status === "done").length,
    sessions = days.filter((d) => d.kind === "session").length;
  const range = formatDateRange(p.blockStartDate, p.blockEndDate, { locale });
  const status = (value: string) =>
    (STATUS_KEYS as readonly string[]).includes(value)
      ? t(`status_${value as (typeof STATUS_KEYS)[number]}`)
      : t("status_upcoming");
  return (
    <div className="programme-timeline-page" data-stagger>
      <header className="page-heading">
        <p className="eyebrow">
          {t("tlEyebrow", {
            label:
              p.billing === "upfront"
                ? t("tlProgramme")
                : t("sBlock", { n: p.block }),
            range,
          })}
        </p>
        <h1>
          {p.state === "not_started"
            ? t("starts", { date: calendarDay(p.startDate, locale) })
            : p.state === "complete"
              ? t("fProgrammeComplete")
              : t("dayOf", { day: p.day, of: p.of })}
        </h1>
        {data.planState === "ready" && (
          <p className="muted">
            {t("sessionsDone", { done, count: sessions })}
            {p.rolling
              ? t("tlRolling", {
                  count: p.of,
                  date: calendarDay(nextDay(p.blockEndDate), locale),
                })
              : ""}
          </p>
        )}
      </header>
      {data.planState === "awaiting_coach" && (
        <section className="card" role="status">
          <h2>{t("preparing")}</h2>
          <p className="muted">{t("preparingText")}</p>
          <Link className="button secondary" href="/app/chat">
            {t("fMessageCoach")}
          </Link>
        </section>
      )}
      {data.planState === "self_paced" && data.plan && (
        <section className="card" aria-labelledby="self-paced-title">
          <p className="small-label">{t("tlOwnPace")}</p>
          <h2 id="self-paced-title" dir="auto">
            {data.plan.title || programLabel}
          </h2>
          <p className="muted">
            {data.plan.daysPerWeek
              ? t("tlPerWeek", { count: data.plan.daysPerWeek })
              : t("tlSuitYou")}{" "}
            {t("tlDoneWeek", { n: data.plan.completedThisWeek })}
          </p>
          <ul className="timeline-plan-sessions">
            {data.plan.sessions.map((s: any, i: number) => (
              <li key={i}>
                <strong dir="auto">
                  {s.label || t("tlSessionN", { n: i + 1 })}
                </strong>
                <span className="muted">
                  {t("exercises", { count: s.exercises })}
                </span>
              </li>
            ))}
          </ul>
          <Link className="button" href="/app/program">
            {programLabel ? t("tlOpen", { label: programLabel }) : t("fOpenPlan")}
          </Link>
        </section>
      )}
      {data.planState === "ended" && (
        <section className="card" role="status">
          <h2>
            {p.billing === "upfront"
              ? t("completedProgramme")
              : t("fEndedTitle")}
          </h2>
          <Link className="button" href="/app/membership#offers">
            {t("chooseNext")}
          </Link>
        </section>
      )}
      {data.planState === "ready" &&
        timelineWeeks(days).map((week) => {
          const current = week.days.some((d: any) => d.date === p.today);
          const planned = week.days.filter(
            (d: any) => d.kind === "session",
          ).length;
          return (
            // The current week is open; the others fold to one line each.
            <details
              className="card timeline-week"
              key={week.index}
              open={current || undefined}
            >
              <summary>
                <strong>{t("tlWeek", { n: week.index })}</strong>
                <span className="muted">
                  {t("tlWeekLine", {
                    range: formatDateRange(week.from, week.to, { locale }),
                    sessions: t("sStreakValue", { count: planned }),
                  })}
                </span>
              </summary>
              <ol className="programme-timeline">
                {week.days.map((d: any) => (
                  <li
                    key={d.date}
                    className={
                      d.status + (d.date === p.today ? " is-today" : "")
                    }
                    aria-current={d.date === p.today ? "date" : undefined}
                  >
                    <span className="timeline-date">
                      {calendarDay(d.date, locale)}
                    </span>
                    <strong className="timeline-label" dir="auto">
                      {d.kind === "session"
                        ? d.label || t("trainingSession")
                        : t("rest")}
                    </strong>
                    {d.kind === "session" && (
                      <span
                        className={
                          "badge" +
                          (d.status === "done"
                            ? " green"
                            : d.status === "missed"
                              ? " amber"
                              : "")
                        }
                      >
                        {status(d.status)}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          );
        })}
    </div>
  );
}
function nextDay(date: string) {
  return new Date(Date.parse(date + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The short completion moment after Finish (docs/features/motion.md "f"):
 * the ring fills to the share of sets logged, the check draws and the
 * streak counts up, over --motion-emphasis. No confetti. With reduced
 * motion everything shows at its final state.
 */
export function WorkoutComplete({
  done,
  total,
}: {
  done: number;
  total: number;
}) {
  const t = useT("workout"),
    locale = useLocale();
  const [streak, setStreak] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    api("/programme/today" + zoneQuery()).then(
      (d) => {
        if (live && d?.programme && typeof d?.progress?.streak === "number")
          setStreak(d.progress.streak);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  return (
    <section
      className="card workout-complete is-new"
      aria-labelledby="workout-complete-title"
    >
      <span className="workout-complete-badge">
        <ProgressRing value={total ? done / total : 1} from={0} size={64} />
        <DrawnCheck draw emphasis />
      </span>
      <div>
        <h2 id="workout-complete-title" role="status">
          {t("doneTitle")}
        </h2>
        <p className="muted">{t("doneText")}</p>
      </div>
      <dl className="workout-complete-stats">
        <div>
          <dt>{t("doneSets")}</dt>
          <dd>
            {t("doneSetsValue", {
              done: formatNumber(done, locale),
              total: formatNumber(total, locale),
            })}
          </dd>
        </div>
        {streak !== null && streak > 0 && (
          <div>
            <dt>{t("doneStreak")}</dt>
            <dd>
              <CountUp
                value={streak}
                duration={MOTION.emphasis}
                format={(v) => t("streakDays", { count: v })}
              />
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
