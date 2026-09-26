"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { trainingAdherence } from "../../../packages/domain/src/client-twin.ts";
type Adherence = ReturnType<typeof trainingAdherence>;
const sessionLabels: Record<string, string> = {
  scheduled: "Scheduled today",
  completed: "Completed",
  missed: "Missed · no completion recorded",
  upcoming: "Upcoming",
  canceled: "Canceled",
  in_progress: "In progress",
  held: "On hold",
  abandoned: "Abandoned",
  unverified: "Evidence needs review",
};
function SessionEvidence({
  sessions,
  subscriber,
}: {
  sessions: Adherence["sessions"];
  subscriber: boolean;
}) {
  return (
    <details>
      <summary>Session evidence ({sessions.length})</summary>
      {sessions.map((session) => (
        <div className="list-row" key={session.id}>
          <div>
            <strong>
              {session.date ?? "Date unavailable"} · {session.label}
            </strong>
            <p>
              {sessionLabels[session.state]} ·{" "}
              {session.timezone ?? "Timezone unavailable"}
              {session.week ? ` · Week ${session.week}` : ""}
            </p>
            {session.issue && <p>{session.issue}</p>}
            {session.completion &&
              (subscriber ? (
                <Link href={`/app/workouts/${session.completion.workoutId}`}>
                  View completed workout
                </Link>
              ) : (
                <p>Completed workout: {session.completion.workoutId}</p>
              ))}
            <small>Source records: {session.sourceRecordIds.join(", ")}</small>
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
  return (
    <section className="card">
      <h2>Planned training and progress</h2>
      <p className="muted">{adherence.coverage}</p>
      {adherence.window.timezones.map((window) => (
        <p key={window.timezone}>
          {window.from} to {window.through} · {window.timezone}
        </p>
      ))}
      <div className="stats-grid">
        {(["completed", "missed", "scheduled", "upcoming"] as const).map(
          (state) => (
            <div key={state}>
              <small>{sessionLabels[state]}</small>
              <h3>{adherence.counts[state]}</h3>
            </div>
          ),
        )}
      </div>
      <p>
        {adherence.counts.canceled} canceled · {adherence.counts.in_progress} in
        progress · {adherence.counts.held} on hold ·{" "}
        {adherence.counts.abandoned} abandoned · {adherence.counts.unverified}{" "}
        awaiting evidence
      </p>
      {!adherence.plannedSessions && (
        <p>No planned sessions are recorded in this window.</p>
      )}
      {adherence.partial && (
        <p className="notice">
          Schedule coverage is partial or completion evidence needs review.
        </p>
      )}
      {adherence.sessions.length > 0 && (
        <SessionEvidence
          sessions={adherence.sessions}
          subscriber={subscriber}
        />
      )}
      <h3>Latest assigned block</h3>
      {block ? (
        <>
          <strong>{block.title}</strong>
          <p>
            {block.weeks ?? "Unspecified"} weeks ·{" "}
            {block.from ?? "Start unavailable"} to{" "}
            {block.through ?? "End unavailable"}
          </p>
          <p>
            {block.plannedSessions} recorded planned sessions
            {block.expectedSessions !== null
              ? ` of ${block.expectedSessions} expected`
              : ""}{" "}
            · {block.counts.completed} completed · {block.counts.missed} missed
            · {block.counts.scheduled} scheduled today · {block.counts.upcoming}{" "}
            upcoming · {block.counts.canceled} canceled
          </p>
          <p>
            {block.counts.in_progress} in progress · {block.counts.held} on hold
            · {block.counts.abandoned} abandoned · {block.counts.unverified}{" "}
            awaiting evidence
          </p>
          <p className="muted">{block.coverage}</p>
          {!block.complete && (
            <p className="notice">
              Block coverage is incomplete. Missing or conflicting records are
              not treated as completed sessions.
            </p>
          )}
          <SessionEvidence sessions={block.sessions} subscriber={subscriber} />
        </>
      ) : (
        <p>No assigned block is recorded.</p>
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
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/v1/clients/${userId}/twin`),
        data = await r.json();
      if (!r.ok) throw new Error(data.message);
      setSnapshot(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);
  const data = snapshot?.data;
  const labels: Record<string, string> = {
    age: "Age",
    goal: "Goal",
    experience: "Training experience",
    daysPerWeek: "Days available each week",
    equipment: "Equipment",
    limitations: "Self-reported limitations",
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CLIENT TWIN</p>
          <h1>
            {subscriber
              ? "Your coaching context."
              : `${name ?? "Subscriber"} · coaching context`}
          </h1>
          <p>See what is known, where it came from and what needs updating.</p>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? "Refreshing…" : "Refresh context"}
        </button>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <section className="card">
            <h2>Coaching profile</h2>
            <p className="muted">
              Last snapshot: {new Date(data.calculatedAt).toLocaleString()}.
              Digital coaching consent:{" "}
              {data.coaching.consent === null
                ? "not recorded"
                : data.coaching.consent
                  ? "active"
                  : "revoked"}
              .
            </p>
            {data.coaching.profile.map((f: any) => (
              <div className="list-row" key={f.key}>
                <div>
                  <strong>{labels[f.key] ?? f.key}</strong>
                  <p>
                    {f.value === null || f.value === ""
                      ? "Not provided"
                      : String(f.value)}
                  </p>
                  {f.observedAt && (
                    <small>
                      Self-reported{" "}
                      {new Date(f.observedAt).toLocaleDateString()}
                    </small>
                  )}
                </div>
                <span className="badge">{f.state}</span>
              </div>
            ))}
            {subscriber && (
              <Link href="/app/profile" className="button secondary">
                Review or correct my profile
              </Link>
            )}
            {data.coaching.safetyHolds.length > 0 && (
              <p className="notice">
                {data.coaching.safetyHolds.length} active safety holds need
                trainer review.
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
            <h2>Recorded training · last 28 days</h2>
            <div className="stats-grid">
              <div>
                <small>Completed sessions</small>
                <h3>{data.coaching.training.completedSessions}</h3>
              </div>
              <div>
                <small>Days with logged sets</small>
                <h3>{data.coaching.training.trainingDays}</h3>
              </div>
              <div>
                <small>Logged sets</small>
                <h3>{data.coaching.training.loggedSets}</h3>
              </div>
            </div>
            <p className="muted">{data.coaching.training.coverage}</p>
            {data.coaching.training.performance.map((p: any) => (
              <div className="list-row" key={p.exercise}>
                <div>
                  <strong>{p.exercise}</strong>
                  <p>
                    {p.loggedSets} sets · {p.volumeKg.toLocaleString()} kg total
                    logged load × repetitions
                  </p>
                </div>
                <small>{new Date(p.lastLoggedAt).toLocaleDateString()}</small>
              </div>
            ))}
          </section>
          <section className="card">
            <h2>Imported observations</h2>
            <p className="muted">{data.wearables.notice}</p>
            <div className="two-columns">
              {data.wearables.metrics.map((m: any) => (
                <div className="card" key={m.key}>
                  <span className="badge">{m.state.replaceAll("_", " ")}</span>
                  <h3>{m.label}</h3>
                  <p>
                    {m.latest === null
                      ? "No usable observation"
                      : `${Math.round(m.latest * 100) / 100} ${m.unit}`}
                  </p>
                  {m.observedAt && (
                    <p className="muted">
                      Measured {new Date(m.observedAt).toLocaleString()}
                    </p>
                  )}
                  <p>
                    Personal baseline:{" "}
                    {m.baseline === null
                      ? "insufficient history"
                      : `${Math.round(m.baseline * 100) / 100} ${m.unit}`}
                  </p>
                  <small>
                    {m.baselineDays} prior days available in the 28-day window.{" "}
                    {m.partial ? "Partial coverage." : ""}
                  </small>
                  <details>
                    <summary>Source and calculation</summary>
                    <p>{m.baselineMethod}</p>
                    <p>
                      Sources: {m.sources.join(", ") || "not available"}.{" "}
                      {m.sampleCount} unique observations.
                    </p>
                    <p className="muted">
                      These observations can be displayed and used in permitted
                      deterministic calculations. They are excluded from AI
                      model prompts.
                    </p>
                  </details>
                </div>
              ))}
            </div>
          </section>
          {data.partialInput && (
            <p className="notice">
              This snapshot reached the current record limit; its coverage is
              partial.
            </p>
          )}
        </>
      )}
    </>
  );
}
