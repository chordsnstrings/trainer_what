"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClientContext } from "./client-context";
import { formatDate, formatDateTime, formatList } from "../lib/format";
import { useLocale, useT } from "../lib/i18n/react";
import { Skeleton } from "./phone-ui";

/**
 * The member's own coaching context (/app/twin), in plain words
 * (docs/features/member-screens.md): what the coach knows from the coaching
 * profile, how the member likes to be coached (editable), the training
 * recorded and still planned, and device data with a clear next step when
 * nothing is connected. The coach's view of the same snapshot stays in
 * client-twin.tsx. In the member's language (docs/features/arabic.md); the
 * loading state is a skeleton and its blocks settle in on the first view.
 */

export function MemberCoachingContext({ userId }: { userId: string }) {
  const t = useT("context"),
    locale = useLocale();
  const profileValue = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "")
      return t("mcNotAnswered");
    if (key === "experience")
      return t.dynamic(`exp_${String(value)}`, String(value));
    return String(value);
  };
  const [snapshot, setSnapshot] = useState<any>(null),
    [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await fetch(`/api/v1/clients/${userId}/twin`, {
        credentials: "same-origin",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message);
      setSnapshot(data);
    } catch {
      setFailed(true);
    }
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);
  const data = snapshot?.data;
  const training = data?.coaching?.training;
  const adherence = data?.coaching?.adherence;
  const block = adherence?.currentBlock;
  const metrics: any[] = data?.wearables?.metrics ?? [];
  const withData = metrics.filter((m) => m.latest !== null);
  const withoutData = metrics.filter((m) => m.latest === null);
  const missingProfile = (data?.coaching?.profile ?? []).filter(
    (f: any) => f.value === null || f.value === "",
  ).length;
  return (
    <div className="member-context" data-stagger>
      <header className="page-heading">
        <h1>{t("mcTitle")}</h1>
        <p className="muted">{t("mcIntro")}</p>
      </header>
      {failed && (
        <section className="card" role="alert">
          <p>{t("mcFailed")}</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => void load()}
          >
            {t("mcTryAgain")}
          </button>
        </section>
      )}
      {!data && !failed && (
        <section className="card">
          <Skeleton label={t("mcLoading")} lines={5} />
        </section>
      )}
      {data && (
        <>
          <section className="card" aria-labelledby="context-profile">
            <h2 id="context-profile">{t("mcProfile")}</h2>
            <p className="muted">
              {missingProfile
                ? t("mcMissing", { count: missingProfile })
                : t("mcFromAnswers")}
            </p>
            <dl className="context-facts">
              {data.coaching.profile.map((f: any) => (
                <div key={f.key}>
                  <dt>{t.dynamic(`mc_${f.key}`, t("mcDetail"))}</dt>
                  <dd
                    className={
                      f.value === null || f.value === "" ? "muted" : undefined
                    }
                    dir="auto"
                  >
                    {profileValue(f.key, f.value)}
                  </dd>
                </div>
              ))}
            </dl>
            <Link href="/app/intake" className="button secondary">
              {missingProfile ? t("mcAnswer") : t("mcUpdate")}
            </Link>
            {data.coaching.consent === false && (
              <p className="notice">{t("mcConsentOff")}</p>
            )}
          </section>
          <ClientContext key={userId} userId={userId} editable />
          <section className="card" aria-labelledby="context-training">
            <h2 id="context-training">{t("recorded")}</h2>
            <dl className="context-stats">
              <div>
                <dt>{t("mcSessionsCompleted")}</dt>
                <dd>{training?.completedSessions ?? 0}</dd>
              </div>
              <div>
                <dt>{t("mcDaysTrained")}</dt>
                <dd>{training?.trainingDays ?? 0}</dd>
              </div>
              <div>
                <dt>{t("mcSetsLogged")}</dt>
                <dd>{training?.loggedSets ?? 0}</dd>
              </div>
            </dl>
            {block && (
              <p>
                {t("mcToCome", {
                  title: block.title,
                  count: block.counts.upcoming + block.counts.scheduled,
                })}
                {block.counts.missed
                  ? t("mcMissed", { count: block.counts.missed })
                  : ""}
                . <Link href="/app/timeline">{t("mcSeeEvery")}</Link>
              </p>
            )}
            {(training?.performance ?? []).length > 0 && (
              <ul className="context-list">
                {training.performance.map((p: any) => (
                  <li key={p.exercise}>
                    <strong dir="auto">{p.exercise}</strong>
                    <span className="muted">
                      {t("mcPerf", {
                        sets: t("sets", { count: p.loggedSets }),
                        date: formatDate(p.lastLoggedAt, {
                          year: false,
                          locale,
                        }),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!training?.completedSessions && !training?.loggedSets && (
              <p className="muted">{t("mcNothing")}</p>
            )}
          </section>
          <section className="card" aria-labelledby="context-devices">
            <h2 id="context-devices">{t("mcDevices")}</h2>
            {withData.length === 0 ? (
              <>
                <p>{t("mcNoDevice")}</p>
                <Link href="/app/wearables" className="button secondary">
                  {t("mcConnect")}
                </Link>
              </>
            ) : (
              <>
                <ul className="context-list">
                  {withData.map((m) => (
                    <li key={m.key}>
                      <strong>{t.dynamic(`metric_${m.key}`, m.label)}</strong>
                      <span>
                        {t("measureValue", {
                          value: Math.round(m.latest * 100) / 100,
                          unit: t.dynamic(`unit_${m.unit}`, m.unit),
                        })}
                      </span>
                      {m.observedAt && (
                        <span className="muted">
                          {t("measured", {
                            when: formatDateTime(m.observedAt, {
                              year: false,
                              locale,
                            }),
                          })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {withoutData.length > 0 && (
                  <p className="muted">
                    {t("mcNoDataFor", {
                      list:
                        locale === "en"
                          ? withoutData
                              .map((m) => m.label.toLowerCase())
                              .join(", ")
                          : formatList(
                              withoutData.map((m) =>
                                t.dynamic(`metric_${m.key}`, m.label),
                              ),
                              locale,
                            ),
                    })}
                  </p>
                )}
                <p className="muted">{t("mcDeviceNote")}</p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
