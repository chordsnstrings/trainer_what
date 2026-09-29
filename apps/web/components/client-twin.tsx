"use client";
import { useLocale } from "../lib/i18n/react";
import { translator, type Locale, type Translator } from "../lib/i18n/core";
import contextMessages from "../lib/i18n/messages/context";
import { errorText } from "../lib/i18n/errors";
import { formatDate, formatDateRange, formatDateTime, formatNumber, zoneName } from "../lib/format";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClientContext } from "./client-context";
import type { trainingAdherence } from "../../../packages/domain/src/client-twin.ts";
type Adherence = ReturnType<typeof trainingAdherence>;
type T = Translator<typeof contextMessages.en>;
const SESSION_STATES = [
  "scheduled",
  "completed",
  "missed",
  "upcoming",
  "canceled",
  "in_progress",
  "held",
  "abandoned",
  "unverified",
] as const;
const sessionLabel = (t: T, state: string) =>
  (SESSION_STATES as readonly string[]).includes(state)
    ? t(`session_${state as (typeof SESSION_STATES)[number]}`)
    : state.replaceAll("_", " ");
/** Members read this in their language; the coach's view stays English. */
function useContextText(subscriber: boolean) {
  const page = useLocale();
  const locale: Locale = subscriber ? page : "en";
  return { t: translator(contextMessages, locale), locale };
}
function SessionEvidence({
  sessions,
  subscriber,
}: {
  sessions: Adherence["sessions"];
  subscriber: boolean;
}) {
  const { t, locale } = useContextText(subscriber);
  return (
    <details>
      <summary>{t("evidence", { n: sessions.length })}</summary>
      {sessions.map((session) => (
        <div className="list-row" key={session.id}>
          <div>
            <strong>
              {session.date
                ? subscriber
                  ? formatDate(session.date, { locale })
                  : session.date
                : t("dateUnavailable")}{" "}
              · <bdi>{session.label}</bdi>
            </strong>
            <p>
              {sessionLabel(t, session.state)} ·{" "}
              {session.timezone
                ? subscriber
                  ? zoneName(session.timezone, locale)
                  : session.timezone
                : t("zoneUnavailable")}
              {session.week ? t("week", { n: session.week }) : ""}
            </p>
            {session.issue && <p dir="auto">{session.issue}</p>}
            {session.completion &&
              (subscriber ? (
                <Link href={`/app/workouts/${session.completion.workoutId}`}>
                  {t("viewWorkout")}
                </Link>
              ) : (
                <p>Completed workout: {session.completion.workoutId}</p>
              ))}
            {!subscriber && (
              <small>Source records: {session.sourceRecordIds.join(", ")}</small>
            )}
          </div>
        </div>
      ))}
    </details>
  );
}
export function TrainingScheduleSummary({
  adherence,
  subscriber = false,
}: {
  adherence: Adherence;
  subscriber?: boolean;
}) {
  const block = adherence.currentBlock;
  const { t, locale } = useContextText(subscriber);
  const range = (from: string | null, through: string | null) =>
    subscriber
      ? formatDateRange(from, through, { locale })
      : `${from ?? "Start unavailable"} to ${through ?? "End unavailable"}`;
  return (
    <section className="card">
      <h2>{t("plannedTraining")}</h2>
      <p className="muted" dir="auto">
        {adherence.coverage}
      </p>
      {adherence.window.timezones.map((window) => (
        <p key={window.timezone}>
          {t("windowLine", {
            range: range(window.from, window.through),
            zone: subscriber
              ? zoneName(window.timezone, locale)
              : window.timezone,
          })}
        </p>
      ))}
      <div className="stats-grid">
        {(["completed", "missed", "scheduled", "upcoming"] as const).map(
          (state) => (
            <div key={state}>
              <small>{sessionLabel(t, state)}</small>
              <h3>{formatNumber(adherence.counts[state], locale)}</h3>
            </div>
          ),
        )}
      </div>
      <p>
        {t("otherCounts", {
          canceled: adherence.counts.canceled,
          inProgress: adherence.counts.in_progress,
          held: adherence.counts.held,
          abandoned: adherence.counts.abandoned,
          unverified: adherence.counts.unverified,
        })}
      </p>
      {!adherence.plannedSessions && <p>{t("noPlanned")}</p>}
      {adherence.partial && <p className="notice">{t("partial")}</p>}
      {adherence.sessions.length > 0 && (
        <SessionEvidence
          sessions={adherence.sessions}
          subscriber={subscriber}
        />
      )}
      <h3>{t("latestBlock")}</h3>
      {block ? (
        <>
          <strong dir="auto">{block.title}</strong>
          <p>
            {t("blockWeeks", {
              weeks:
                block.weeks === null || block.weeks === undefined
                  ? t("unspecifiedWeeks")
                  : t("weeksCount", { count: block.weeks }),
              range: range(block.from, block.through),
            })}
          </p>
          <p>
            {t("blockCounts", {
              planned: block.plannedSessions,
              expected:
                block.expectedSessions !== null
                  ? t("ofExpected", { n: block.expectedSessions })
                  : "",
              completed: block.counts.completed,
              missed: block.counts.missed,
              scheduled: block.counts.scheduled,
              upcoming: block.counts.upcoming,
              canceled: block.counts.canceled,
            })}
          </p>
          <p>
            {t("blockCounts2", {
              inProgress: block.counts.in_progress,
              held: block.counts.held,
              abandoned: block.counts.abandoned,
              unverified: block.counts.unverified,
            })}
          </p>
          <p className="muted" dir="auto">
            {block.coverage}
          </p>
          {!block.complete && <p className="notice">{t("incomplete")}</p>}
          <SessionEvidence sessions={block.sessions} subscriber={subscriber} />
        </>
      ) : (
        <p>{t("noBlock")}</p>
      )}
    </section>
  );
}
export function ClientTwin({
  userId,
  name,
  subscriber = false,
}: {
  userId: string;
  name?: string;
  subscriber?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { t, locale } = useContextText(subscriber);
  /** "62 bpm": a measurement with its unit, in the member's language. */
  const measure = (value: number, unit: string) => {
    const rounded = Math.round(value * 100) / 100;
    return subscriber
      ? t("measureValue", {
          value: rounded,
          unit: t.dynamic(`unit_${unit}`, unit),
        })
      : `${rounded} ${unit}`;
  };
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/v1/clients/${userId}/twin`),
        data = await r.json();
      if (!r.ok)
        throw Object.assign(new Error(data.message), {
          status: r.status,
          code: data.code,
        });
      setSnapshot(data);
    } catch (e) {
      setError(errorText(e, locale));
    } finally {
      setBusy(false);
    }
  }, [userId, locale]);
  useEffect(() => {
    void load();
  }, [load]);
  const data = snapshot?.data;
  const fieldLabel = (key: string) =>
    ["age", "goal", "experience", "daysPerWeek", "equipment", "limitations"].includes(
      key,
    )
      ? t(`field_${key}` as "field_age")
      : key;
  const stateLabel = (state: string) =>
    subscriber &&
    ["current", "stale", "missing", "provided", "expired"].includes(state)
      ? t(`state_${state}` as "state_current")
      : state;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{subscriber ? t("eyebrow") : "CLIENT TWIN"}</p>
          <h1>
            {subscriber
              ? t("title")
              : `${name ?? "Subscriber"} · coaching context`}
          </h1>
          <p>{t("intro")}</p>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? t("refreshing") : t("refresh")}
        </button>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <ClientContext key={userId} userId={userId} editable={subscriber} />
          <section className="card">
            <h2>{t("profile")}</h2>
            <p className="muted">
              {t("lastSnapshot", {
                when: subscriber
                  ? formatDateTime(data.calculatedAt, { locale })
                  : new Date(data.calculatedAt).toLocaleString(),
                consent:
                  data.coaching.consent === null
                    ? t("consentNone")
                    : data.coaching.consent
                      ? t("consentActive")
                      : t("consentRevoked"),
              })}
            </p>
            {data.coaching.profile.map((f: any) => (
              <div className="list-row" key={f.key}>
                <div>
                  <strong>{fieldLabel(f.key)}</strong>
                  <p dir="auto">
                    {f.value === null || f.value === ""
                      ? t("notProvided")
                      : String(f.value)}
                  </p>
                  {f.observedAt && (
                    <small>
                      {t("selfReported", {
                        date: subscriber
                          ? formatDate(f.observedAt, { locale })
                          : new Date(f.observedAt).toLocaleDateString(),
                      })}
                    </small>
                  )}
                </div>
                <span className="badge">{stateLabel(f.state)}</span>
              </div>
            ))}
            {subscriber && (
              <Link href="/app/intake" className="button secondary">
                {t("reviewProfile")}
              </Link>
            )}
            {data.coaching.safetyHolds.length > 0 && (
              <p className="notice">
                {t("safetyHolds", { count: data.coaching.safetyHolds.length })}
              </p>
            )}
          </section>
          {data.coaching.adherence && (
            <TrainingScheduleSummary
              adherence={data.coaching.adherence}
              subscriber={subscriber}
            />
          )}
          <section className="card">
            <h2>{t("recorded")}</h2>
            <div className="stats-grid">
              <div>
                <small>{t("completedSessions")}</small>
                <h3>{data.coaching.training.completedSessions}</h3>
              </div>
              <div>
                <small>{t("daysWithSets")}</small>
                <h3>{data.coaching.training.trainingDays}</h3>
              </div>
              <div>
                <small>{t("loggedSets")}</small>
                <h3>{data.coaching.training.loggedSets}</h3>
              </div>
            </div>
            <p className="muted" dir="auto">
              {data.coaching.training.coverage}
            </p>
            {data.coaching.training.performance.map((p: any) => (
              <div className="list-row" key={p.exercise}>
                <div>
                  <strong dir="auto">{p.exercise}</strong>
                  <p>
                    {t("performanceLine", {
                      sets: t("sets", { count: p.loggedSets }),
                      volume: subscriber
                        ? formatNumber(p.volumeKg, "en")
                        : p.volumeKg.toLocaleString(),
                    })}
                  </p>
                </div>
                <small>
                  {subscriber
                    ? formatDate(p.lastLoggedAt, { locale })
                    : new Date(p.lastLoggedAt).toLocaleDateString()}
                </small>
              </div>
            ))}
          </section>
          <section className="card">
            <h2>{t("imported")}</h2>
            <p className="muted" dir="auto">
              {data.wearables.notice}
            </p>
            <div className="two-columns">
              {data.wearables.metrics.map((m: any) => (
                <div className="card" key={m.key}>
                  <span className="badge">
                    {t.dynamic(
                      `metricState_${m.state}`,
                      m.state.replaceAll("_", " "),
                    )}
                  </span>
                  <h3 dir="auto">{t.dynamic(`metric_${m.key}`, m.label)}</h3>
                  <p>
                    {m.latest === null ? (
                      t("noObservation")
                    ) : (
                      <bdi dir={subscriber ? undefined : "ltr"}>
                        {measure(m.latest, m.unit)}
                      </bdi>
                    )}
                  </p>
                  {m.observedAt && (
                    <p className="muted">
                      {t("measured", {
                        when: subscriber
                          ? formatDateTime(m.observedAt, { locale })
                          : new Date(m.observedAt).toLocaleString(),
                      })}
                    </p>
                  )}
                  <p>
                    {t("baseline", {
                      value:
                        m.baseline === null
                          ? t("insufficient")
                          : measure(m.baseline, m.unit),
                    })}
                  </p>
                  <small>
                    {t("priorDays", { count: m.baselineDays })}
                    {m.partial ? t("partialCoverage") : ""}
                  </small>
                  <details>
                    <summary>{t("sourceCalc")}</summary>
                    <p dir="auto">
                      {subscriber &&
                      m.baselineMethod === contextMessages.en.baselineMethod
                        ? t("baselineMethod")
                        : m.baselineMethod}
                    </p>
                    <p>
                      {t("sources", {
                        sources: m.sources.join(", ") || t("notAvailable"),
                        observations: t("uniqueObservations", {
                          count: m.sampleCount,
                        }),
                      })}
                    </p>
                    <p className="muted">{t("excluded")}</p>
                  </details>
                </div>
              ))}
            </div>
          </section>
          {data.partialInput && (
            <p className="notice">{t("partialSnapshot")}</p>
          )}
        </>
      )}
    </>
  );
}
