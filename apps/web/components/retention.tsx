"use client";
import { useCallback, useEffect, useState } from "react";

type Policy = {
  version: number;
  data: { enabled: boolean; windowDays: number; cancellationThreshold: number };
};
type Member = {
  userId: string;
  name: string;
  state: "scheduled" | "ended" | "recovered" | "unverified";
  subscriptionStatus: string | null;
  accessUntil: string | null;
  occurredAt: string;
  evidence: {
    eventId: string;
    source: "signed_subscription_event" | "confirmed_instruction";
    providerEventId: string | null;
    instructionId: string | null;
    providerId: string;
    recordedAt: string;
    occurredAt: string;
    kind: "scheduled" | "ended";
    invoiceId: string;
    journalId: string;
    paidAt: string;
    paidMinor: number;
  };
};
type Summary = {
  policy: Policy;
  observedAt: string;
  complete: boolean;
  thresholdMet: boolean;
  period: {
    current: { start: string; end: string; windowEnd: string };
    previous: { start: string; end: string };
  };
  counts: {
    recorded: number;
    affected: number;
    scheduled: number;
    ended: number;
    recovered: number;
    unverified: number;
  };
  previousRecorded: number | null;
  cohort: Member[];
  basis: string;
  coverage: {
    eventLimit: number;
    cohortLimit: number;
    scannedEvents: number;
    unverifiableSources: number;
    excludedWithoutPayment: number;
  };
};
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1/retention/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(
        value.message ??
          value.error ??
          "Retention records could not be loaded.",
      ),
      { status: response.status },
    );
  return value;
}
const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        timeZone: "UTC",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }) + " UTC"
    : "Not recorded";
const labels: Record<Member["state"], string> = {
  scheduled: "Cancellation scheduled",
  ended: "Membership ended",
  recovered: "Recovered / renewal resumed",
  unverified: "Current outcome unverified",
};

export function RetentionPanel() {
  const [value, setValue] = useState<Summary | null>(null),
    [enabled, setEnabled] = useState(false),
    [days, setDays] = useState("14"),
    [threshold, setThreshold] = useState("3"),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [stale, setStale] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [selected, setSelected] = useState<Member | null>(null),
    [evidenceLoading, setEvidenceLoading] = useState(false);
  const apply = useCallback((next: Summary) => {
    if (
      !Number.isInteger(next.policy?.version) ||
      !Array.isArray(next.cohort) ||
      typeof next.complete !== "boolean"
    )
      throw new Error(
        "The saved retention summary could not be read. Reload it before making changes.",
      );
    setValue(next);
    setEnabled(next.policy.data.enabled);
    setDays(String(next.policy.data.windowDays));
    setThreshold(String(next.policy.data.cancellationThreshold));
    setStale(false);
    setSelected(null);
  }, []);
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      apply(await request<Summary>("summary"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apply]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const locked = loading || saving || stale || !value;
  return (
    <section className="card" id="retention" aria-busy={loading || saving}>
      <h2>Recorded membership cancellations</h2>
      <p className="muted">
        Review confirmed cancellation instructions and signed billing events for
        members with an earlier positive invoice. Scheduled cancellations and
        ended memberships are shown separately. Recovered memberships do not
        count toward the alert threshold.
      </p>
      {loading && <p role="status">Loading recorded cancellations…</p>}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="notice" role="status">
          {success}
        </p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (locked || !value) return;
          const windowDays = Number(days),
            cancellationThreshold = Number(threshold);
          if (
            !Number.isInteger(windowDays) ||
            windowDays < 7 ||
            windowDays > 30 ||
            !Number.isInteger(cancellationThreshold) ||
            cancellationThreshold < 1 ||
            cancellationThreshold > 100
          ) {
            setError(
              "Choose a window of 7–30 days and a threshold of 1–100 members.",
            );
            return;
          }
          setSaving(true);
          setError("");
          setSuccess("");
          try {
            await request<Policy>("policy", "PUT", {
              version: value.policy.version,
              data: { enabled, windowDays, cancellationThreshold },
            });
            apply(await request<Summary>("summary"));
            setSuccess("Retention alert policy saved.");
          } catch (e) {
            const conflict = (e as Error & { status?: number }).status === 409;
            setStale(conflict);
            setError(
              conflict
                ? "This policy changed. Reload the saved policy before making another change."
                : (e as Error).message,
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="check-field">
          <input
            type="checkbox"
            checked={enabled}
            disabled={locked}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setSuccess("");
            }}
          />
          Enable owner retention alerts
        </label>
        <label className="field">
          <span>Fixed UTC window (days)</span>
          <input
            type="number"
            min={7}
            max={30}
            step={1}
            required
            value={days}
            disabled={locked}
            onChange={(e) => {
              setDays(e.target.value);
              setSuccess("");
            }}
          />
        </label>
        <label className="field">
          <span>Unique currently affected members needed for an alert</span>
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            required
            value={threshold}
            disabled={locked}
            onChange={(e) => {
              setThreshold(e.target.value);
              setSuccess("");
            }}
          />
        </label>
        <p className="muted">
          Off until enabled. At most one alert per saved policy and fixed
          window, with at least 24 hours between alerts. Email follows your
          notification preferences and quiet hours. This policy sends no
          messages to subscribers.
        </p>
        <div className="actions">
          <button className="button" type="submit" disabled={locked}>
            {saving ? "Saving…" : "Save retention policy"}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={loading || saving}
            onClick={() => void reload()}
          >
            Reload policy and records
          </button>
        </div>
      </form>
      {value && (
        <>
          <p className="muted">
            Saved policy revision {value.policy.version} ·{" "}
            {value.policy.data.enabled ? "Alerts enabled" : "Alerts disabled"} ·
            Checked {when(value.observedAt)}
          </p>
          <p>
            Current fixed window: {when(value.period.current.start)} through{" "}
            {when(value.period.current.windowEnd)}. Counts so far stop at{" "}
            {when(value.period.current.end)}.
          </p>
          {!value.complete && (
            <p className="notice" role="status">
              Partial evidence: no retention alert will be created or sent. The
              scan is limited to {value.coverage.eventLimit} events and{" "}
              {value.coverage.cohortLimit} members; missing source evidence or
              an unresolved current outcome also requires review.
            </p>
          )}
          <dl>
            <dt>Currently affected</dt>
            <dd>
              {value.counts.affected} ({value.counts.scheduled} scheduled,{" "}
              {value.counts.ended} ended)
            </dd>
            <dt>Recovered / renewal resumed</dt>
            <dd>{value.counts.recovered}</dd>
            <dt>Current outcome unverified</dt>
            <dd>{value.counts.unverified}</dd>
            <dt>Members with recorded cancellations this elapsed window</dt>
            <dd>{value.counts.recorded}</dd>
            <dt>Preceding comparable elapsed window</dt>
            <dd>
              {value.previousRecorded === null
                ? "Comparison unavailable with the recorded coverage"
                : `${value.previousRecorded} members · ${when(value.period.previous.start)} through ${when(value.period.previous.end)}`}
            </dd>
          </dl>
          <p className="muted">{value.basis}</p>
          <p className="muted">
            Checked {value.coverage.scannedEvents} source events.{" "}
            {value.coverage.excludedWithoutPayment} cancellation evidence
            entries lacked a linked earlier positive invoice and are excluded.{" "}
            {value.coverage.unverifiableSources} source entries could not be
            verified.
          </p>
          {value.thresholdMet && (
            <p className="notice">
              The saved threshold is met. Review the recorded business data and
              its current membership outcomes.
            </p>
          )}
          {value.cohort.length === 0 ? (
            <p>No qualifying cancellation records in the current window.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <caption>Current-window recorded cohort</caption>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Current outcome</th>
                    <th>Cancellation recorded for</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {value.cohort.map((row) => (
                    <tr key={row.userId}>
                      <td>{row.name}</td>
                      <td>
                        {labels[row.state]}
                        {row.state === "scheduled" && (
                          <small> · Period end {when(row.accessUntil)}</small>
                        )}
                      </td>
                      <td>{when(row.occurredAt)}</td>
                      <td>
                        <button
                          className="button secondary"
                          type="button"
                          disabled={loading || saving || evidenceLoading}
                          onClick={async () => {
                            setEvidenceLoading(true);
                            setError("");
                            setSelected(null);
                            try {
                              setSelected(
                                await request<Member>(
                                  `evidence/${row.evidence.eventId}`,
                                ),
                              );
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setEvidenceLoading(false);
                            }
                          }}
                        >
                          View billing evidence
                          <span className="sr-only"> for {row.name}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {evidenceLoading && <p role="status">Rechecking source evidence…</p>}
          {selected && (
            <section
              aria-label={`Recorded evidence for ${selected.name}`}
              className="notice"
            >
              <h3>Recorded evidence: {selected.name}</h3>
              <p>
                {labels[selected.state]} · Current billing status:{" "}
                {selected.subscriptionStatus ?? "Not recorded"}
              </p>
              <dl>
                <dt>Source</dt>
                <dd>
                  {selected.evidence.source === "signed_subscription_event"
                    ? "Processed signed subscription event"
                    : "Provider-confirmed cancellation instruction"}
                </dd>
                <dt>Cancellation evidence</dt>
                <dd>
                  {selected.evidence.kind === "scheduled"
                    ? "Cancellation scheduled"
                    : "Membership ended"}{" "}
                  · {when(selected.evidence.occurredAt)}
                </dd>
                <dt>Recorded by this app</dt>
                <dd>{when(selected.evidence.recordedAt)}</dd>
                <dt>Audit event</dt>
                <dd>
                  <code>{selected.evidence.eventId}</code>
                </dd>
                <dt>Provider event / confirmed instruction</dt>
                <dd>
                  <code>
                    {selected.evidence.providerEventId ??
                      selected.evidence.instructionId}
                  </code>
                </dd>
                <dt>Provider subscription</dt>
                <dd>
                  <code>{selected.evidence.providerId}</code>
                </dd>
                <dt>Earlier positive invoice</dt>
                <dd>
                  <code>{selected.evidence.invoiceId}</code> · Paid{" "}
                  {when(selected.evidence.paidAt)}
                </dd>
                <dt>Immutable payment journal</dt>
                <dd>
                  <code>{selected.evidence.journalId}</code>
                </dd>
              </dl>
              <button
                className="button secondary"
                type="button"
                onClick={() => setSelected(null)}
              >
                Close evidence
              </button>
            </section>
          )}
        </>
      )}
    </section>
  );
}
