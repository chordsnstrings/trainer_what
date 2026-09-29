"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClientContext } from "./client-context";
import { formatDate, formatDateTime, plural } from "../lib/format";

/**
 * The member's own coaching context (/app/twin), in plain words
 * (docs/features/member-screens.md): what the coach knows from the coaching
 * profile, how the member likes to be coached (editable), the training
 * recorded and still planned, and device data with a clear next step when
 * nothing is connected. The coach's view of the same snapshot stays in
 * client-twin.tsx.
 */
const PROFILE_LABELS: Record<string, string> = {
  age: "Age",
  goal: "Goal",
  experience: "Training experience",
  daysPerWeek: "Days you can train each week",
  equipment: "Equipment",
  limitations: "Limitations you told your coach about",
};
const EXPERIENCE: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

function profileValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "")
    return "Not answered yet";
  if (key === "experience") return EXPERIENCE[String(value)] ?? String(value);
  return String(value);
}

export function MemberCoachingContext({ userId }: { userId: string }) {
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
    <div className="member-context">
      <header className="page-heading">
        <h1>Your coaching context</h1>
        <p className="muted">
          What your coach knows about you and where it came from. Update
          anything that has changed.
        </p>
      </header>
      {failed && (
        <section className="card" role="alert">
          <p>Your coaching context could not be loaded.</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => void load()}
          >
            Try again
          </button>
        </section>
      )}
      {!data && !failed && (
        <section className="card" aria-busy="true">
          <p className="muted">Loading your coaching context…</p>
        </section>
      )}
      {data && (
        <>
          <section className="card" aria-labelledby="context-profile">
            <h2 id="context-profile">Your coaching profile</h2>
            <p className="muted">
              {missingProfile
                ? `${plural(missingProfile, "question")} not answered yet. Your answers help your coach plan your training.`
                : "From your answers to the coaching profile questions."}
            </p>
            <dl className="context-facts">
              {data.coaching.profile.map((f: any) => (
                <div key={f.key}>
                  <dt>{PROFILE_LABELS[f.key] ?? "Detail"}</dt>
                  <dd
                    className={
                      f.value === null || f.value === "" ? "muted" : undefined
                    }
                  >
                    {profileValue(f.key, f.value)}
                  </dd>
                </div>
              ))}
            </dl>
            <Link href="/app/intake" className="button secondary">
              {missingProfile
                ? "Answer the coaching profile questions"
                : "Update your coaching profile"}
            </Link>
            {data.coaching.consent === false && (
              <p className="notice">
                You withdrew permission for your coach to use these answers for
                digital coaching. You can give it again in Profile and settings.
              </p>
            )}
          </section>
          <ClientContext key={userId} userId={userId} editable />
          <section className="card" aria-labelledby="context-training">
            <h2 id="context-training">Recorded training · last 28 days</h2>
            <dl className="context-stats">
              <div>
                <dt>Sessions completed</dt>
                <dd>{training?.completedSessions ?? 0}</dd>
              </div>
              <div>
                <dt>Days you trained</dt>
                <dd>{training?.trainingDays ?? 0}</dd>
              </div>
              <div>
                <dt>Sets logged</dt>
                <dd>{training?.loggedSets ?? 0}</dd>
              </div>
            </dl>
            {block && (
              <p>
                {block.title}:{" "}
                {plural(
                  block.counts.upcoming + block.counts.scheduled,
                  "planned session",
                )}{" "}
                still to come
                {block.counts.missed
                  ? `, ${plural(block.counts.missed, "session")} missed`
                  : ""}
                . <Link href="/app/timeline">See every day</Link>
              </p>
            )}
            {(training?.performance ?? []).length > 0 && (
              <ul className="context-list">
                {training.performance.map((p: any) => (
                  <li key={p.exercise}>
                    <strong>{p.exercise}</strong>
                    <span className="muted">
                      {plural(p.loggedSets, "set")} · last{" "}
                      {formatDate(p.lastLoggedAt, { year: false })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!training?.completedSessions && !training?.loggedSets && (
              <p className="muted">
                Nothing logged in the last 28 days yet. Your sessions appear
                here as you log them.
              </p>
            )}
          </section>
          <section className="card" aria-labelledby="context-devices">
            <h2 id="context-devices">From your devices</h2>
            {withData.length === 0 ? (
              <>
                <p>
                  No device data yet. Connect a wearable or import from Apple
                  Health, and your coach can see your sleep, steps and heart
                  rate alongside your training.
                </p>
                <Link href="/app/wearables" className="button secondary">
                  Connect a device
                </Link>
              </>
            ) : (
              <>
                <ul className="context-list">
                  {withData.map((m) => (
                    <li key={m.key}>
                      <strong>{m.label}</strong>
                      <span dir="auto">
                        {Math.round(m.latest * 100) / 100} {m.unit}
                      </span>
                      {m.observedAt && (
                        <span className="muted">
                          Measured{" "}
                          {formatDateTime(m.observedAt, { year: false })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {withoutData.length > 0 && (
                  <p className="muted">
                    No data yet for{" "}
                    {withoutData.map((m) => m.label.toLowerCase()).join(", ")}.
                  </p>
                )}
                <p className="muted">
                  Device data is shown to you and your coach. The digital coach
                  does not use it.
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
