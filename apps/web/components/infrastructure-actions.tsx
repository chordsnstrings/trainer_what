"use client";
import { useCallback, useEffect, useState } from "react";
const prefix = "/api/v1/admin/infrastructure/operations";
export function InfrastructureActions() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [reason, setReason] = useState(""),
    [paused, setPaused] = useState(false),
    [interval, setIntervalValue] = useState(5000);
  const [enabled, setEnabled] = useState(false),
    [rate, setRate] = useState(4),
    [cap, setCap] = useState(0);
  const load = useCallback(async () => {
    const r = await fetch(prefix, { cache: "no-store" }),
      d = await r.json();
    if (!r.ok) throw new Error(d.message);
    setData(d);
    setEnabled(d.policy.enabled);
    setRate(d.policy.actions_per_hour);
    setCap(Number(d.policy.monthly_cost_cap_minor) / 100);
    setPaused(d.resource.paused);
    setIntervalValue(d.resource.interval_ms);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(prefix + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        d = await r.json();
      if (!r.ok) throw new Error(d.message);
      await load();
      setMessage("Operation recorded.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>Guarded infrastructure controls.</h1>
          <p>
            Each change needs an exact proposal and explicit approval. Cloud
            purchases and deployments remain disabled.
          </p>
        </div>
      </div>
      <nav className="tabs" aria-label="Infrastructure views">
        <a href="/admin/infrastructure/observer">Measurements</a>
        <a href="/admin/infrastructure/actions" aria-current="page">
          Approved actions
        </a>
      </nav>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => void load().catch((e) => setError(e.message))}
      >
        Refresh state
      </button>
      {data && (
        <>
          <section className="card">
            <h2>Worker dispatch</h2>
            <p>
              {data.resource.paused ? "Paused" : "Running"} · new cycle every{" "}
              {data.resource.interval_ms / 1000} seconds · revision{" "}
              {data.resource.revision}
            </p>
            <p>
              Pausing prevents new worker cycles, including reminders, provider
              synchronization and scheduled finance work. A current cycle
              finishes normally. Restore dispatch here after the maintenance
              window.
            </p>
            <p>
              Approved resource: primary application worker. Added cloud cost:
              AED 0.
            </p>
          </section>
          <section className="card">
            <h2>Execution policy</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act("/policy", {
                  revision: data.policy.revision,
                  enabled,
                  actionsPerHour: rate,
                  monthlyCostCapMinor: Math.round(cap * 100),
                  reason,
                });
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  Allow reviewed worker operations
                </label>
                <label>
                  Maximum operations each hour
                  <input
                    required
                    type="number"
                    min="1"
                    max="20"
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                  />
                </label>
                <label>
                  Maximum added monthly cloud cost (AED)
                  <input
                    required
                    type="number"
                    min="0"
                    max="10000000"
                    step="0.01"
                    value={cap}
                    onChange={(e) => setCap(Number(e.target.value))}
                  />
                </label>
                <label>
                  Reason for the change
                  <input
                    required
                    minLength={10}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="button">Save reviewed policy</button>
              </fieldset>
            </form>
          </section>
          <section className="card">
            <h2>Propose a reversible change</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act("", {
                  requestId: crypto.randomUUID(),
                  resourceId: "worker:primary",
                  action: "set_worker_dispatch",
                  policyRevision: data.policy.revision,
                  expectedRevision: data.resource.revision,
                  estimatedMonthlyCostMinor: 0,
                  desired: { paused, intervalMs: interval },
                  reason,
                });
              }}
            >
              <fieldset disabled={busy || !data.policy.enabled}>
                <label>
                  <input
                    type="checkbox"
                    checked={paused}
                    onChange={(e) => setPaused(e.target.checked)}
                  />
                  Pause new worker cycles
                </label>
                <label>
                  Cycle interval (milliseconds)
                  <input
                    required
                    type="number"
                    min="1000"
                    max="60000"
                    step="1000"
                    value={interval}
                    onChange={(e) => setIntervalValue(Number(e.target.value))}
                  />
                </label>
                <label>
                  Reason
                  <input
                    required
                    minLength={10}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="button">Create proposal</button>
              </fieldset>
            </form>
          </section>
          <section className="card">
            <h2>Proposals and execution history</h2>
            <p>
              Proposals expire after 15 minutes. Policy or worker changes
              invalidate earlier approvals. Rollback is available only while the
              resource still matches that operation.
            </p>
            {data.actions.map((op: any) => (
              <div className="card" key={op.id}>
                <strong>
                  {op.status.replaceAll("_", " ")} ·{" "}
                  {new Date(op.created_at).toLocaleString()}
                </strong>
                <p>
                  {op.before_state.paused ? "Paused" : "Running"} →{" "}
                  {op.desired_state.paused ? "Paused" : "Running"}; interval{" "}
                  {op.before_state.intervalMs / 1000}s →{" "}
                  {op.desired_state.intervalMs / 1000}s
                </p>
                <p>{op.reason}</p>
                <small>
                  Expires {new Date(op.expires_at).toLocaleString()} · resource
                  revision {op.expected_revision}
                </small>
                {["proposed", "approved"].includes(op.status) &&
                  new Date(op.expires_at).getTime() < Date.now() && (
                    <p className="notice">
                      Expired. Cancel this proposal and create a fresh one.
                    </p>
                  )}
                <label>
                  Action reason
                  <input
                    minLength={10}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div className="actions">
                  {(op.status === "proposed"
                    ? ["approve", "cancel"]
                    : op.status === "approved"
                      ? ["execute", "cancel"]
                      : op.status === "succeeded"
                        ? ["rollback"]
                        : []
                  ).map((action) => (
                    <button
                      key={action}
                      className="button secondary"
                      disabled={busy || reason.trim().length < 10}
                      onClick={() =>
                        void act(`/${op.id}/${action}`, { reason })
                      }
                    >
                      {action === "execute"
                        ? "Execute approved change"
                        : action === "rollback"
                          ? "Roll back change"
                          : action === "approve"
                            ? "Approve this exact change"
                            : "Cancel proposal"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
