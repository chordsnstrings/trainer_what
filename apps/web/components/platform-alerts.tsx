"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Field } from "./field";
import {
  GovernanceError,
  GovernanceLinks,
  governanceApi,
  when,
} from "./governance-shared";

type Failure = { message: string; code?: string } | null;
const statuses = [
  ["active", "Needs attention"],
  ["open", "Open"],
  ["acknowledged", "Acknowledged"],
  ["resolved", "Resolved"],
] as const;
const severityLabel: Record<string, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Notice",
};

/** Operator alert inbox (/admin/alerts), filtered to the operator's scope. */
export function PlatformAlerts({ platformRole }: { platformRole: string }) {
  const [status, setStatus] = useState<string>("active"),
    [page, setPage] = useState(0),
    [data, setData] = useState<any>(null),
    [error, setError] = useState<Failure>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState<{ id: string; action: string } | null>(null);
  const load = useCallback(async () => {
    setData(
      await governanceApi(`/admin/alerts?status=${status}&page=${page}`),
    );
  }, [status, page]);
  useEffect(() => {
    load().catch(setError);
  }, [load]);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await fn();
      setOpen(null);
      setMessage(done);
      await load();
    } catch (e) {
      setError(e as Failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="governance">
      <div className="page-heading">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>Operator alerts.</h1>
          <p className="muted">
            Infrastructure thresholds, waiting safety escalations, failed jobs,
            reconciliation exceptions, uncertain emails and payout failures.
            Alerts clear automatically when their condition clears.
          </p>
        </div>
      </div>
      <GovernanceLinks platformRole={platformRole} />
      {data && (
        <p className="muted" aria-live="polite">
          {data.counts.open} open · {data.counts.acknowledged} acknowledged ·{" "}
          {data.counts.critical} critical
        </p>
      )}
      <div className="governance-filters">
        <nav className="tabs" aria-label="Alert status">
          {statuses.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={status === value ? "selected" : ""}
              aria-pressed={status === value}
              onClick={() => {
                setStatus(value);
                setPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        {data?.canEvaluate && (
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () => governanceApi("/admin/alerts/evaluate", "POST", {}),
                "Checks ran. The inbox shows the current conditions.",
              )
            }
          >
            Run checks now
          </button>
        )}
      </div>
      <GovernanceError error={error} />
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {!data ? (
        !error && <p>Loading alerts…</p>
      ) : data.alerts.length === 0 ? (
        <section className="card">
          <p className="muted">No alerts in this view.</p>
        </section>
      ) : (
        <ul className="governance-list">
          {data.alerts.map((a: any) => {
            const editing = open && open.id === a.id ? open.action : null;
            return (
            <li key={a.id} className={"card governance-alert severity-" + a.severity}>
              <div className="governance-item-head">
                <div>
                  <strong>{a.title}</strong>
                  <small className="muted">
                    {a.workspace ? a.workspace + " · " : ""}first seen {when(a.first_seen_at)} · last seen{" "}
                    {when(a.last_seen_at)}
                    {a.occurrences > 1 ? ` · changed ${a.occurrences - 1} time(s)` : ""} ·{" "}
                    {a.deliveries} operator(s) notified
                  </small>
                </div>
                <span className={"badge " + (a.severity === "info" ? "" : a.severity === "critical" ? "amber governance-critical" : "amber")}>
                  {severityLabel[a.severity] ?? a.severity} · {a.status}
                </span>
              </div>
              <p>{a.detail}</p>
              {a.acknowledged_at && (
                <p className="muted">
                  Acknowledged {when(a.acknowledged_at)} by {a.acknowledged_by}
                  {a.acknowledgement_note ? `: ${a.acknowledgement_note}` : ""}
                </p>
              )}
              {a.resolved_at && (
                <p className="muted">
                  {a.resolution === "operator"
                    ? `Resolved ${when(a.resolved_at)} by ${a.resolved_by}: ${a.resolution_note}`
                    : `Condition cleared ${when(a.resolved_at)}`}
                </p>
              )}
              {a.data?.href && a.data.href.startsWith("/admin") && (
                <p>
                  <Link className="text-link" href={a.data.href}>
                    Open the related screen
                  </Link>
                </p>
              )}
              {a.status !== "resolved" &&
                (editing ? (
                  <form
                    className="governance-action"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
                      void run(
                        () =>
                          governanceApi(`/admin/alerts/${a.id}/${editing}`, "POST", {
                            revision: a.revision,
                            ...(note ? { note } : {}),
                          }),
                        editing === "resolve" ? "Alert resolved." : "Alert acknowledged.",
                      );
                    }}
                  >
                    <fieldset disabled={busy}>
                      <legend>{editing === "resolve" ? "Resolve this alert" : "Acknowledge this alert"}</legend>
                      <Field label={editing === "resolve" ? "What was done (required)" : "Note (optional)"}>
                        <textarea
                          name="note"
                          rows={2}
                          maxLength={1000}
                          minLength={editing === "resolve" ? 10 : undefined}
                          required={editing === "resolve"}
                        />
                      </Field>
                      {editing === "resolve" && (
                        <p className="muted">
                          The same condition will not reopen this alert; any
                          change to it opens a new one.
                        </p>
                      )}
                      <div className="button-row">
                        <button className="button" type="submit">
                          {editing === "resolve" ? "Resolve" : "Acknowledge"}
                        </button>
                        <button className="button secondary" type="button" onClick={() => setOpen(null)}>
                          Cancel
                        </button>
                      </div>
                    </fieldset>
                  </form>
                ) : (
                  <div className="button-row">
                    {a.status === "open" && (
                      <button className="button secondary" type="button" onClick={() => setOpen({ id: a.id, action: "acknowledge" })}>
                        Acknowledge…
                      </button>
                    )}
                    <button className="button secondary" type="button" onClick={() => setOpen({ id: a.id, action: "resolve" })}>
                      Resolve…
                    </button>
                  </div>
                ))}
            </li>
            );
          })}
        </ul>
      )}
      {data && (page > 0 || data.hasMore) && (
        <div className="button-row">
          <button className="button secondary" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button className="button secondary" type="button" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
