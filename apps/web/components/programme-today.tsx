"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import { formatDate, formatDateRange, formatNumber } from "../lib/format";
import type { Locale } from "../lib/i18n/core";

/** The subscriber's day-by-day programme view and its timeline (docs/features/programme.md). */
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
/** "Tue 29 Sep" (Arabic "الثلاثاء، 29 سبتمبر") for a programme day. */
const calendarDay = (date: string, locale: Locale = "en") =>
  formatDate(date, { weekday: true, year: false, locale });
/** "29 Sep 2026" for an instant (renewal, end of access). */
const instantDay = (value?: string | null, locale: Locale = "en") =>
  value ? formatDate(value, { locale }) : "—";
const round = (n: number | null | undefined) =>
  typeof n === "number" ? Math.round(n) : null;

function EndOfProgramme({ data }: { data: any }) {
  const end = data.endOfProgramme;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const t = useT("today"),
    locale = useLocale(),
    toError = useErrorText();
  if (!end || end.state === "none") return null;
  const renew = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api("/payments/checkout", "POST", {
        productId: end.renewProductId,
      });
      if (r?.url) window.location.assign(r.url);
    } catch (e: any) {
      setError(toError(e));
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
      {end.state === "next_block" && (
        <p>
          {t("blockEnds", {
            end: calendarDay(data.programme.blockEndDate, locale),
            start: calendarDay(end.at, locale),
          })}
        </p>
      )}
      {end.state === "renews" && (
        <p>
          {end.at
            ? t("renewsOn", { date: instantDay(end.at, locale) })
            : t("renewsMonthly")}
        </p>
      )}
      {end.state === "ends" && (
        <p>
          {t("accessEnds", { date: instantDay(end.at, locale) })}
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

function Nutrition({ n }: { n: any }) {
  const tr = useT("today");
  if (!n) return null;
  if (n.state === "permission")
    return (
      <div className="programme-tile">
        <p className="small-label">{tr("nutritionToday")}</p>
        <p>{tr("allowNutrition")}</p>
        <Link className="text-link" href="/app/nutrition">
          {tr("openNutrition")}
        </Link>
      </div>
    );
  if (n.state === "setup")
    return (
      <div className="programme-tile">
        <p className="small-label">{tr("nutritionToday")}</p>
        <p>{tr("addPreferences")}</p>
        <Link className="text-link" href="/app/nutrition">
          {tr("setUpNutrition")}
        </Link>
      </div>
    );
  const t = n.target;
  const kcal = round(n.consumed?.kcal) ?? 0;
  const goal = t?.kcal ?? round(n.planned?.kcal);
  const macros = [
    [tr("protein"), "protein"],
    [tr("carbohydrate"), "carbohydrate"],
    [tr("fat"), "fat"],
  ] as const;
  return (
    <div className="programme-tile programme-nutrition">
      <p className="small-label">{tr("nutritionToday")}</p>
      <h3>
        {/* "1200 / 2000" is one left-to-right run inside the sentence. */}
        {tr("kcalValue", { value: goal ? `${kcal} / ${goal}` : kcal })}
      </h3>
      {goal ? (
        <div
          className="programme-meter"
          role="progressbar"
          aria-label={tr("caloriesLabel")}
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-valuenow={Math.min(kcal, goal)}
        >
          <span
            style={{ inlineSize: `${Math.min(100, (kcal / goal) * 100)}%` }}
          />
        </div>
      ) : (
        <p className="muted">{tr("noTarget")}</p>
      )}
      {macros.map(([label, key]) =>
        t?.[key] != null ? (
          <div className="programme-macro" key={key}>
            <span>{label}</span>
            <span dir="ltr">
              {round(n.consumed?.[key]) ?? 0} / {round(t[key])} g
            </span>
          </div>
        ) : null,
      )}
      <p className="muted">
        {tr("mealsLogged", { count: n.meals ?? 0 })}
        {t?.reviewDue ? tr("reviewDue") : ""}
      </p>
      <Link className="text-link" href="/app/nutrition/log">
        {tr("logMeal")}
      </Link>
    </div>
  );
}

/** Today: Day N of M, today's session or rest, what's next, streak, nutrition and the programme end. */
export function ProgrammeToday() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const t = useT("today"),
    locale = useLocale();
  const load = useCallback(
    () =>
      api("/programme/today" + zoneQuery()).then(
        (d) => {
          setData(d);
          setError("");
        },
        (e) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (error)
    return (
      <section className="card programme-today" aria-live="polite">
        <p className="muted">{t("loadFailed")}</p>
        <button className="button secondary" onClick={() => void load()}>
          {t("tryAgain")}
        </button>
      </section>
    );
  if (!data)
    return (
      <section className="card programme-today" aria-busy="true">
        <p className="muted">{t("loading")}</p>
      </section>
    );
  const p = data.programme;
  if (!p)
    return (
      <section className="card programme-today">
        <p className="eyebrow">{t("yourProgramme")}</p>
        <h2>{t("startProgramme")}</h2>
        <p className="muted">{t("startProgrammeText")}</p>
        <Link className="button" href="/app/membership">
          {t("membershipOptions")}
        </Link>
      </section>
    );
  const s = data.session;
  const progress = data.progress;
  return (
    <section
      className="card programme-today"
      aria-labelledby="programme-today-title"
    >
      <div className="programme-day">
        <p className="eyebrow" id="programme-today-title">
          {p.state === "not_started"
            ? t("startsSoon")
            : p.state === "complete"
              ? t("complete")
              : p.billing === "upfront"
                ? t("yourProgramme")
                : t("block", { n: p.block })}
        </p>
        <strong>
          {p.state === "not_started"
            ? t("starts", { date: calendarDay(p.startDate, locale) })
            : t("dayOf", { day: p.day, of: p.of })}
        </strong>
        {p.rolling && p.state !== "not_started" && (
          <span className="badge">{t("rollingBlocks", { count: p.of })}</span>
        )}
      </div>
      <div
        className="programme-meter"
        role="progressbar"
        aria-label={t("progressLabel")}
        aria-valuemin={0}
        aria-valuemax={p.of}
        aria-valuenow={p.day}
      >
        <span
          style={{ inlineSize: `${Math.min(100, (p.day / p.of) * 100)}%` }}
        />
      </div>
      {data.planState === "ended" ? null : (
        <div className="programme-columns">
          <div className="programme-tile">
            <p className="small-label">
              {t("todayOn", { date: calendarDay(data.today, locale) })}
            </p>
            {data.planState === "awaiting_coach" && !s ? (
              <>
                <h3>{t("preparing")}</h3>
                <p className="muted">{t("preparingText")}</p>
              </>
            ) : s ? (
              <>
                <h3 dir="auto">{s.label ?? t("trainingSession")}</h3>
                <p className="muted">
                  {s.status === "completed"
                    ? t("done")
                    : s.status === "canceled"
                      ? t("canceled")
                      : t("exercises", { count: s.exercises }) +
                        (s.week ? t("week", { n: s.week }) : "")}
                </p>
                {!["completed", "canceled"].includes(s.status) && (
                  <Link className="button" href="/app/program">
                    {s.status === "started"
                      ? t("continueSession")
                      : t("startSession")}
                  </Link>
                )}
              </>
            ) : (
              <>
                <h3>{t("restDay")}</h3>
                <p className="muted">{t("restText")}</p>
              </>
            )}
          </div>
          <div className="programme-tile">
            <p className="small-label">{t("whatsNext")}</p>
            {data.next ? (
              <>
                <h3 dir="auto">{data.next.label ?? t("trainingSession")}</h3>
                <p className="muted">
                  {data.next.inDays === 1
                    ? t("tomorrow")
                    : t("inDays", {
                        date: calendarDay(data.next.date, locale),
                        count: data.next.inDays,
                      })}
                </p>
              </>
            ) : (
              <p className="muted">{t("notScheduled")}</p>
            )}
            <div className="programme-stats">
              <div>
                <span className="small-label">{t("streak")}</span>
                <strong>{formatNumber(progress.streak, locale)}</strong>
              </div>
              <div>
                <span className="small-label">{t("adherence")}</span>
                <strong>
                  {progress.percent === null
                    ? "—"
                    : formatNumber(progress.percent / 100, locale, {
                        style: "percent",
                      })}
                </strong>
              </div>
              <div>
                <span className="small-label">
                  {t("lastDays", { count: progress.windowDays })}
                </span>
                <strong>
                  <bdi dir="ltr">
                    {progress.completed}/{progress.scheduled}
                  </bdi>
                </strong>
              </div>
            </div>
          </div>
          <Nutrition n={data.nutrition} />
        </div>
      )}
      <EndOfProgramme data={data} />
      <p>
        <Link className="text-link" href="/app/timeline">
          {p.billing === "upfront" ? t("wholeProgramme") : t("wholeBlock")}
        </Link>
      </p>
    </section>
  );
}

const STATUS_KEYS = [
  "done",
  "missed",
  "today",
  "upcoming",
  "rest",
  "unplanned",
  "canceled",
] as const;
/** Every day of the current programme (upfront) or block (monthly), with its session and status. */
export function ProgrammeTimeline() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const t = useT("today"),
    locale = useLocale();
  useEffect(() => {
    api("/programme/timeline" + zoneQuery()).then(setData, (e) =>
      setError(e.message),
    );
  }, []);
  if (error)
    return (
      <section className="card">
        <p className="muted" role="alert">
          {t("timelineFailed")}
        </p>
      </section>
    );
  if (!data)
    return (
      <section className="card" aria-busy="true">
        <p className="muted">{t("loadingProgramme")}</p>
      </section>
    );
  const p = data.programme;
  if (!p)
    return (
      <section className="card">
        <h2>{t("noProgramme")}</h2>
        <p className="muted">{t("noProgrammeText")}</p>
        <Link className="button" href="/app/membership">
          {t("membershipOptions")}
        </Link>
      </section>
    );
  const done = data.days.filter((d: any) => d.status === "done").length,
    sessions = data.days.filter((d: any) => d.kind === "session").length;
  return (
    <section className="card" aria-labelledby="programme-timeline-title">
      <p className="eyebrow">
        {p.billing === "upfront" ? t("programme") : t("block", { n: p.block })}{" "}
        ·{" "}
        {locale === "en" ? (
          <>
            {calendarDay(p.blockStartDate)} – {calendarDay(p.blockEndDate)}
          </>
        ) : (
          formatDateRange(p.blockStartDate, p.blockEndDate, { locale })
        )}
      </p>
      <h2 id="programme-timeline-title">
        {p.state === "not_started"
          ? t("startingSoon")
          : t("dayOf", { day: p.day, of: p.of })}
      </h2>
      <p className="muted">
        {t("sessionsDone", { done, count: sessions })}
        {p.rolling ? t("rollingNote", { count: p.of }) : ""}
      </p>
      {data.planState === "awaiting_coach" && (
        <p role="status">{t("preparingTimeline")}</p>
      )}
      <ol className="programme-timeline">
        {data.days.map((d: any) => (
          <li
            key={d.date}
            className={d.status}
            aria-current={d.status === "today" ? "date" : undefined}
          >
            <span className="small-label">{t("dayN", { n: d.day })}</span>
            <span>{calendarDay(d.date, locale)}</span>
            <strong dir="auto">
              {d.kind === "session"
                ? (d.label ?? t("session"))
                : d.kind === "unplanned"
                  ? "—"
                  : t("rest")}
            </strong>
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
              {(STATUS_KEYS as readonly string[]).includes(d.status)
                ? t(`status_${d.status as (typeof STATUS_KEYS)[number]}`)
                : d.status}
            </span>
          </li>
        ))}
      </ol>
      <p>
        <Link className="text-link" href="/app">
          {t("backToToday")}
        </Link>
      </p>
    </section>
  );
}
