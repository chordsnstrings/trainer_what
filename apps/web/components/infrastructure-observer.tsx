"use client";
import { useCallback, useEffect, useState } from "react";

type Measurement = { state: string; value: number | null; reason?: string };
type Observation = {
  id: string;
  service: string;
  collector_id: string;
  window_started_at: string;
  window_ended_at: string;
  recorded_at: string;
  measurements: Record<string, Measurement>;
};
type Recommendation = {
  id: string;
  service: string;
  status: string;
  revision: number;
  policy_revision: number;
  latest_observation_id: string;
  first_observation_id: string;
  measured_value: number;
  threshold_value: number;
  title: string;
  recommendation: string;
  canResolve: boolean;
};
type Policy = {
  revision: number;
  created_at: string;
  reason_code: string;
  thresholds: Record<string, number>;
};
type Snapshot = {
  asOf: string;
  coverage: string;
  policy: Policy;
  metricDefinitions: Record<
    string,
    { label: string; unit: string; explanation: string }
  >;
  unavailableSources: { source: string; reason: string }[];
  services: {
    service: string;
    state: string;
    observation: Observation | null;
  }[];
  recommendations: Recommendation[];
};
const thresholdLabels: Record<string, string> = {
  freshnessSeconds: "Evidence freshness (seconds)",
  minimumRequests: "Minimum requests for API thresholds",
  apiP95Ms: "API sampled p95 limit (ms)",
  apiErrorPercent: "API server error limit (%)",
  processRssMb: "Process resident memory limit (MiB)",
  processCpuPercent: "Process CPU limit (% of one core)",
  databaseProbeMs: "Database round-trip limit (ms)",
  databaseConnectionPercent: "Database connection limit (%)",
  queueReadyCount: "Ready job count limit",
  queueOldestReadySeconds: "Oldest ready job limit (seconds)",
  queueFailedCount: "Blocked or failed job count limit",
  workerFailedCycles: "Failed worker iteration limit",
};
async function api(path = "", body?: unknown) {
  const response = await fetch("/api/v1/admin/infrastructure" + path, {
    credentials: "same-origin",
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "The observation could not be loaded.");
  return data;
}
function time(value: string) {
  return new Date(value).toLocaleString();
}
function Evidence({
  observation,
  definitions,
}: {
  observation: Observation;
  definitions: Snapshot["metricDefinitions"];
}) {
  return (
    <>
      <p className="muted">
        {observation.service} process · interval{" "}
        {time(observation.window_started_at)} –{" "}
        {time(observation.window_ended_at)} · saved{" "}
        {time(observation.recorded_at)}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th scope="col">Measurement</th>
              <th scope="col">Value</th>
              <th scope="col">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(observation.measurements).map(
              ([key, measurement]) => (
                <tr key={key}>
                  <th scope="row" title={definitions[key]?.explanation}>
                    {definitions[key]?.label ?? key}
                  </th>
                  <td>
                    {measurement.value === null
                      ? "Unavailable"
                      : `${measurement.value.toLocaleString()} ${definitions[key]?.unit ?? ""}`}
                  </td>
                  <td>
                    {measurement.state}
                    {measurement.reason
                      ? ` · ${measurement.reason.replaceAll("_", " ")}`
                      : ""}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function InfrastructureObserver() {
  const [data, setData] = useState<Snapshot | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [thresholds, setThresholds] = useState<Record<string, number>>({}),
    [policyRevision, setPolicyRevision] = useState(0),
    [reasonCode, setReasonCode] = useState("baseline_tuning");
  const [evidence, setEvidence] = useState<Observation | null>(null),
    [policies, setPolicies] = useState<Policy[] | null>(null);
  const load = useCallback(async (resetForm = false) => {
    const next = (await api()) as Snapshot;
    setData(next);
    if (resetForm) {
      setThresholds(next.policy.thresholds);
      setPolicyRevision(next.policy.revision);
    }
  }, []);
  useEffect(() => {
    void load(true).catch((e) => setMessage(e.message));
  }, [load]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  };
  const lifecycle = async (
    recommendation: Recommendation,
    action: "acknowledge" | "resolve",
  ) => {
    await api(`/recommendations/${recommendation.id}/${action}`, {
      requestId: crypto.randomUUID(),
      revision: recommendation.revision,
      evidenceId: recommendation.latest_observation_id,
      policyRevision: recommendation.policy_revision,
    });
    await load();
    setMessage(
      action === "acknowledge"
        ? "Recommendation acknowledged."
        : "Recommendation resolved using fresh recovery evidence.",
    );
  };
  return (
    <div className="stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>Infrastructure observations</h1>
          <p>
            Observe-only. Measurements and recommendations never execute
            infrastructure changes.
          </p>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void run(() => load())}
        >
          Refresh observations
        </button>
      </div>
      <nav className="tabs" aria-label="Infrastructure views">
        <a href="/admin/infrastructure">Job operations</a>
        <a href="/admin/infrastructure/observer" aria-current="page">
          Infrastructure observations
        </a>
      </nav>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!data ? (
        <p>
          Loading observations… Platform administrator access and recent MFA are
          required.
        </p>
      ) : (
        <>
          <p className="muted">
            As of {time(data.asOf)}. {data.coverage}
          </p>
          {data.services.map((service) => (
            <section className="card" key={service.service}>
              <h2>
                {service.service === "api" ? "API process" : "Worker process"} ·{" "}
                {service.state}
              </h2>
              {service.state === "stale" && (
                <p className="notice">
                  These measurements are historical. Fresh evidence is needed to
                  establish recovery.
                </p>
              )}
              {service.observation ? (
                <Evidence
                  observation={service.observation}
                  definitions={data.metricDefinitions}
                />
              ) : (
                <p>
                  No reporting evidence has been received. Availability is
                  unknown.
                </p>
              )}
            </section>
          ))}
          <section className="card">
            <h2>Sources not connected</h2>
            {data.unavailableSources.map((source) => (
              <p key={source.source}>
                <strong>{source.source}:</strong> {source.reason}
              </p>
            ))}
          </section>
          <section className="card">
            <h2>Recommendations</h2>
            <p className="muted">
              Limits trigger when a measured value exceeds its threshold.
              Acknowledging records operator attention. Resolution requires
              fresh, complete recovery evidence under the current policy.
            </p>
            {!data.recommendations.length && (
              <p>
                No recommendations have been raised from the available evidence.
              </p>
            )}
            {data.recommendations.map((recommendation) => (
              <article className="card" key={recommendation.id}>
                <h3>{recommendation.title}</h3>
                <p>
                  {recommendation.service} · {recommendation.status} · policy{" "}
                  {recommendation.policy_revision}
                </p>
                <p>{recommendation.recommendation}</p>
                <p>
                  Recorded value:{" "}
                  {recommendation.measured_value.toLocaleString()}. Threshold:{" "}
                  {recommendation.threshold_value.toLocaleString()}.
                </p>
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        setEvidence(
                          await api(
                            `/observations/${recommendation.first_observation_id}`,
                          ),
                        ),
                      )
                    }
                  >
                    Opening evidence
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () =>
                        setEvidence(
                          await api(
                            `/observations/${recommendation.latest_observation_id}`,
                          ),
                        ),
                      )
                    }
                  >
                    Latest evidence
                  </button>
                  {recommendation.status === "open" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(() => lifecycle(recommendation, "acknowledge"))
                      }
                    >
                      Acknowledge
                    </button>
                  )}
                  {recommendation.status !== "resolved" && (
                    <button
                      disabled={busy || !recommendation.canResolve}
                      onClick={() =>
                        void run(() => lifecycle(recommendation, "resolve"))
                      }
                    >
                      Resolve with recovery evidence
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>
          {evidence && (
            <section className="card" aria-label="Selected observation">
              <h2>Recorded evidence</h2>
              <p className="muted">Observation {evidence.id}</p>
              <Evidence
                observation={evidence}
                definitions={data.metricDefinitions}
              />
              <button className="secondary" onClick={() => setEvidence(null)}>
                Close evidence
              </button>
            </section>
          )}
          <section className="card">
            <h2>Observation policy · version {policyRevision}</h2>
            <p>
              Threshold changes create a new immutable version. They do not
              authorize scaling, restarts, spending, or other execution.
            </p>
            {policyRevision !== data.policy.revision && (
              <p className="notice">
                A newer policy is available. Reload its values before saving.
              </p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api("/policy", {
                    requestId: crypto.randomUUID(),
                    revision: policyRevision,
                    thresholds,
                    reasonCode,
                  });
                  await load(true);
                  setPolicies(null);
                  setMessage("A new observation policy version was saved.");
                });
              }}
            >
              <div className="form-grid">
                {Object.entries(thresholds).map(([key, value]) => (
                  <label key={key}>
                    {thresholdLabels[key] ?? key}
                    <input
                      type="number"
                      required
                      min={0}
                      step="any"
                      value={value}
                      onChange={(event) =>
                        setThresholds((current) => ({
                          ...current,
                          [key]: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <label>
                Operational reason
                <select
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                >
                  <option value="baseline_tuning">Baseline tuning</option>
                  <option value="capacity_review">Capacity review</option>
                  <option value="incident_review">Incident review</option>
                  <option value="release_review">Release review</option>
                </select>
              </label>
              <div className="button-row">
                <button disabled={busy || !policyRevision}>
                  Save new policy version
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void run(() => load(true))}
                >
                  Reload current values
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => setPolicies(await api("/policies")))
                  }
                >
                  Policy history
                </button>
              </div>
            </form>
            {policies && (
              <div>
                {policies.map((policy) => (
                  <details key={policy.revision}>
                    <summary>
                      Version {policy.revision} · {time(policy.created_at)} ·{" "}
                      {policy.reason_code.replaceAll("_", " ")}
                    </summary>
                    <dl>
                      {Object.entries(policy.thresholds).map(([key, value]) => (
                        <div key={key}>
                          <dt>{thresholdLabels[key] ?? key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
