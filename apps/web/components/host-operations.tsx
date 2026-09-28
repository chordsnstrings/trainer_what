"use client";
import { useCallback, useEffect, useState } from "react";

type Level = "ok" | "warning" | "critical" | "unavailable" | "info";
type Metric = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  status: Level;
  warning: number | null;
  critical: number | null;
  detail: string;
};
type Backups = {
  state: string;
  stale: boolean;
  message: string;
  reportedAt: string | null;
  reportStale?: boolean;
  lastSuccessAt: string | null;
  ageHours: number | null;
  sizeBytes: number | null;
  location: string | null;
  offsite: string | null;
  name: string | null;
  sha256: string | null;
  count: number;
  lastFailure: { at: string; message: string } | null;
  lastVerification: {
    at: string;
    ok: boolean;
    backup: string | null;
    message: string;
  } | null;
  policy: { intervalHours: number; keep: number } | null;
  thresholds: { warnAgeHours: number; criticalAgeHours: number };
};
type DnsAnswer = {
  name: string;
  addresses: string[];
  source: string;
  ok: boolean;
};
type Request = {
  id: string;
  action: string;
  label: string;
  target: string | null;
  parameters?: { url: string; rootDomain: string | null } | null;
  reason: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  finishedAt: string | null;
  result: { message?: string; details?: Record<string, unknown> } | null;
  resultVerified: boolean | null;
  notPickedUp: boolean;
  outcomeUnknown: boolean;
};
type Snapshot = {
  asOf: string;
  overall: Level;
  thresholds: {
    revision: number;
    values: Record<string, number>;
    reason: string;
  };
  controller: {
    state: string;
    reportedAt: string | null;
    ageSeconds: number | null;
    release: string | null;
  };
  metricsSource: "controller" | "api" | null;
  metrics: Metric[];
  containers:
    | { service: string; state: string; health: string | null; status: Level }[]
    | null;
  deploy: {
    current: string | null;
    previous: string | null;
    serving: string | null;
    deployedAt: number | null;
    paused: boolean;
    pausedAt: number | null;
    pausedReason?: string | null;
  } | null;
  edge: {
    onDemandTls: boolean;
    onDemandConfigured?: boolean;
    pendingReapply?: boolean;
    endpoint: string;
  } | null;
  /** Absent from reports of controllers older than the address change. */
  address?: {
    publicIpv4: string | null;
    rootDomain: string | null;
    redirectFrom: string[];
    changeInProgress: boolean;
    lastChange: {
      from: string;
      to: string;
      at: string;
      status: string;
    } | null;
  } | null;
  backups: Backups;
  signingAvailable: boolean;
  actions: {
    allowlist: {
      action: string;
      label: string;
      description: string;
      targets: readonly string[];
      /** Requested from its own form (the platform address section). */
      form?: string;
    }[];
    ttlMinutes: number;
    perHour: number;
    recent: Request[];
    pickup: string;
  };
  outOfScope: { capability: string; reason: string }[];
};
type AddressCheck = {
  valid: boolean;
  origin: string | null;
  current: string | null;
  rootDomain: string | null;
  currentRootDomain: string | null;
  changed: boolean;
  serverIpv4: string | null;
  resolution: {
    name: string;
    a: string[];
    aaaa: string[];
    ok: boolean;
    purpose: string;
  }[];
  checks: { key: string; ok: boolean; level: string; message: string }[];
  providerUpdates: { name: string; value: string; where: string }[];
  procedure: string[];
};

const base = "/api/v1/admin/infrastructure";
async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(base + path, {
    credentials: "same-origin",
    cache: "no-store",
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.message ??
        "The host view could not be loaded. Platform administrator access and a recent authenticator check are required.",
    );
  return data as T;
}
const when = (value: string | number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : new Date(
        typeof value === "number" && value < 1e12 ? value * 1000 : value,
      ).toLocaleString();
const bytes = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : value >= 1073741824
      ? (value / 1073741824).toFixed(2) + " GiB"
      : value >= 1048576
        ? (value / 1048576).toFixed(1) + " MiB"
        : Math.max(1, Math.round(value / 1024)) + " KiB";
const short = (sha: string | null | undefined) =>
  sha ? sha.slice(0, 12) : "—";
const levelText: Record<string, string> = {
  ok: "Within limits",
  warning: "Warning",
  critical: "Critical",
  unavailable: "Not reported",
  info: "Information",
};
function Status({ level, label }: { level: string; label?: string }) {
  return (
    <span className={"host-level host-level-" + level}>
      {label ?? levelText[level] ?? level}
    </span>
  );
}
const controllerText: Record<string, string> = {
  measured: "Host controller reporting",
  stale: "Host report is stale",
  unreported: "No host controller report",
  unverified: "Host report failed verification",
  invalid: "Host report is unreadable or dated in the future",
  signing_unavailable: "Signing secret unavailable",
};
const thresholdLabels: Record<string, string> = {
  reportFreshnessSeconds: "Host report freshness (seconds)",
  diskWarnPercent: "Disk used warning (%)",
  diskCriticalPercent: "Disk used critical (%)",
  memoryAvailableWarnPercent: "Memory available warning (%)",
  memoryAvailableCriticalPercent: "Memory available critical (%)",
  loadPerCpuWarn: "Load per CPU warning",
  loadPerCpuCritical: "Load per CPU critical",
  backupWarnAgeHours: "Backup age warning (hours)",
  backupCriticalAgeHours: "Backup age critical (hours)",
};

/** Host metrics with thresholds; also mounted on the observer page. */
export function HostMetricsPanel({
  snapshot,
  compact = false,
}: {
  snapshot?: Snapshot | null;
  compact?: boolean;
}) {
  const [data, setData] = useState<Snapshot | null>(snapshot ?? null),
    [error, setError] = useState("");
  useEffect(() => {
    if (snapshot !== undefined) {
      setData(snapshot);
      return;
    }
    call<Snapshot>("/host")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [snapshot]);
  if (error)
    return (
      <section className="card host-ops" aria-label="Host metrics">
        <h2>Server host</h2>
        <p className="notice error" role="alert">
          {error}
        </p>
      </section>
    );
  if (!data)
    return (
      <section className="card host-ops" aria-label="Host metrics">
        <h2>Server host</h2>
        <p role="status">Loading host measurements…</p>
      </section>
    );
  return (
    <section className="card host-ops" aria-label="Host metrics">
      <div className="card-heading">
        <h2>Server host</h2>
        <Status level={data.overall} />
      </div>
      <p className="muted">
        {controllerText[data.controller.state] ?? data.controller.state}
        {data.controller.reportedAt
          ? ` · last report ${when(data.controller.reportedAt)}`
          : ""}
        {data.metricsSource === "api"
          ? " · figures below are as seen from the API container until the host controller reports"
          : ""}
      </p>
      {!data.metrics.length ? (
        <p>
          No fresh host measurements are available. Availability is unknown.
        </p>
      ) : (
        <ul className="host-metrics">
          {data.metrics.map((m) => (
            <li key={m.key}>
              <span className="host-metric-label">{m.label}</span>
              <strong>
                {m.value === null ? "—" : m.value.toLocaleString()} {m.unit}
              </strong>
              <Status level={m.status} />
              <small>
                {m.detail}
                {m.warning !== null &&
                  ` · warning ${m.warning}, critical ${m.critical}`}
              </small>
            </li>
          ))}
        </ul>
      )}
      {data.containers && (
        <>
          <h3>Containers</h3>
          <ul className="host-containers">
            {data.containers.map((c) => (
              <li key={c.service}>
                <span>{c.service}</span>
                <span className="muted">
                  {c.state}
                  {c.health ? ` · ${c.health}` : ""}
                </span>
                <Status level={c.status} />
              </li>
            ))}
          </ul>
        </>
      )}
      {compact && (
        <p>
          <a className="button secondary" href="/admin/infrastructure/host">
            Host, backups and host actions
          </a>
        </p>
      )}
    </section>
  );
}

function BackupCard({ backups }: { backups: Backups }) {
  const level =
    backups.state === "healthy"
      ? "ok"
      : backups.state === "stale" || backups.state === "missing"
        ? "critical"
        : "warning";
  return (
    <section className="card host-ops" aria-label="Database backups">
      <div className="card-heading">
        <h2>Database backups</h2>
        <Status level={level} label={backups.state.replaceAll("_", " ")} />
      </div>
      <p>{backups.message}</p>
      <dl className="host-facts">
        <div>
          <dt>Last success</dt>
          <dd>
            {when(backups.lastSuccessAt)}
            {backups.ageHours !== null &&
              ` (${backups.ageHours.toFixed(1)} h ago)`}
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{bytes(backups.sizeBytes)}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>
            {backups.location === "local+offsite"
              ? "This server and off-server storage"
              : backups.location === "local"
                ? "This server only"
                : "—"}
          </dd>
        </div>
        <div>
          <dt>Off-server copy</dt>
          <dd>
            {backups.offsite === "uploaded"
              ? "Uploaded"
              : backups.offsite === "failed"
                ? "Upload failed; retried hourly"
                : backups.offsite === "invalid"
                  ? "Storage settings are incomplete or invalid"
                  : "Local only (no off-server storage configured)"}
          </dd>
        </div>
        <div>
          <dt>Kept on server</dt>
          <dd>
            {backups.count}
            {backups.policy
              ? ` of ${backups.policy.keep}, every ${backups.policy.intervalHours} h`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Alert thresholds</dt>
          <dd>
            warning after {backups.thresholds.warnAgeHours} h, critical after{" "}
            {backups.thresholds.criticalAgeHours} h
          </dd>
        </div>
      </dl>
      {backups.name && (
        <p className="muted host-wrap">
          Latest: {backups.name} · SHA-256 {backups.sha256}
        </p>
      )}
      {backups.lastFailure && (
        <p className="notice error">
          Last failure {when(backups.lastFailure.at)}:{" "}
          {backups.lastFailure.message}
        </p>
      )}
      {backups.lastVerification ? (
        <p
          className={
            "notice" + (backups.lastVerification.ok ? " success" : " error")
          }
        >
          Restore check {when(backups.lastVerification.at)}:{" "}
          {backups.lastVerification.message}
        </p>
      ) : (
        <p className="muted">
          No restore check has run yet. Use “Verify the latest backup” below.
        </p>
      )}
      <p className="muted">
        Dumps are PostgreSQL custom format, encrypted with a key derived from
        the server's encryption key and authenticated before any restore. Keep a
        private copy of the server's runtime settings, or the backups cannot be
        decrypted.
      </p>
    </section>
  );
}

/** What the edge serves; a pending re-apply means runtime.env has moved on. */
export function EdgeState({ edge }: { edge: Snapshot["edge"] }) {
  return (
    <>
      {edge?.onDemandTls
        ? "On-demand certificates for verified domains"
        : "Platform address only"}
      {edge?.pendingReapply && (
        <span className="host-pending">
          Pending re-apply: the edge does not serve the current runtime settings
          yet
          {edge.onDemandConfigured && !edge.onDemandTls
            ? ", so new coach domains cannot get certificates"
            : ""}
          . Request &ldquo;Re-apply runtime settings&rdquo;.
        </span>
      )}
    </>
  );
}

/** DNS answers, blocking checks, warnings and provider settings for a proposed address. */
export function AddressCheckResult({ result }: { result: AddressCheck }) {
  const warnings = result.checks.filter((c) => !c.ok && c.level === "warning");
  return (
    <div role="status" className="host-address-result">
      <p>
        <Status
          level={result.valid && result.changed ? "ok" : "critical"}
          label={
            result.valid && result.changed
              ? "Ready to switch"
              : result.valid
                ? "Nothing to change"
                : "Not ready"
          }
        />
      </p>
      {result.resolution.length > 0 && (
        <table className="host-dns">
          <caption>
            What these names resolve to now
            {result.serverIpv4
              ? ` (this server: ${result.serverIpv4})`
              : " (this server's address is not reported yet)"}
          </caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">A (IPv4)</th>
              <th scope="col">AAAA (IPv6)</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {result.resolution.map((r) => (
              <tr key={r.purpose}>
                <td>
                  <span className="host-wrap">{r.name}</span>
                  <small className="muted"> · {r.purpose}</small>
                </td>
                <td>{r.a.join(", ") || "none"}</td>
                <td>{r.aaaa.join(", ") || "none"}</td>
                <td>
                  <Status
                    level={r.ok ? "ok" : "critical"}
                    label={r.ok ? "Points here" : "Not this server"}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul className="host-checks">
        {result.checks.map((c) => (
          <li key={c.key}>
            <Status
              level={
                c.ok
                  ? "ok"
                  : c.level === "error"
                    ? "critical"
                    : c.level === "warning"
                      ? "warning"
                      : "info"
              }
              label={c.ok ? "OK" : c.level}
            />{" "}
            <span className="host-wrap">{c.message}</span>
          </li>
        ))}
      </ul>
      {warnings.length > 0 && (
        <p className="notice">
          {warnings.length} warning{warnings.length === 1 ? "" : "s"} above do
          not block the switch; read them before requesting it.
        </p>
      )}
      {result.providerUpdates.length > 0 && (
        <>
          <h3>Update these after the move</h3>
          <ul className="host-provider-updates">
            {result.providerUpdates.map((u) => (
              <li key={u.name}>
                <strong>{u.name}:</strong>{" "}
                <code className="host-wrap">{u.value}</code>
                <br />
                <small className="muted">{u.where}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>What happens</h3>
      <ol>
        {result.procedure.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

const changeStatusText: Record<string, string> = {
  pending:
    "Waiting for the host controller. It picks requests up about every five minutes.",
  running:
    "Switching now. The platform restarts and may be unreachable for a few minutes.",
  succeeded: "Moved",
  failed: "Not moved",
  rejected: "Refused by the host controller",
  expired: "Expired before the host controller picked it up",
  canceled: "Canceled",
};
/** The latest address change: its target, live progress and signed result. */
export function AddressChangeProgress({
  request,
  unreachable,
}: {
  request: Request;
  unreachable?: boolean;
}) {
  const to = request.parameters?.url ?? null;
  const details = request.result?.details ?? {};
  const active = request.status === "pending" || request.status === "running";
  return (
    <div
      className="host-address-progress"
      role="status"
      aria-live="polite"
      aria-label="Platform address change progress"
    >
      <div className="card-heading">
        <strong>
          {to ? `Move to ${to}` : request.label}
          {request.parameters?.rootDomain
            ? ` · root domain ${request.parameters.rootDomain}`
            : ""}
        </strong>
        <Status
          level={
            request.status === "succeeded"
              ? "ok"
              : active
                ? "warning"
                : request.status === "canceled" || request.status === "expired"
                  ? "info"
                  : "critical"
          }
          label={request.status}
        />
      </div>
      <p>{changeStatusText[request.status] ?? request.status}</p>
      {request.result?.message && (
        <p className="host-wrap">
          {request.result.message}
          {request.resultVerified === false &&
            " (this message is not signed by the host controller)"}
        </p>
      )}
      {active && unreachable && to && (
        <p className="notice">
          This page cannot reach the platform right now. While the services
          restart that is expected. If the move finished, this address redirects
          to <a href={to + "/admin/infrastructure/host"}>{to}</a>; sign in there
          again to see the result.
        </p>
      )}
      {request.status === "succeeded" && to && (
        <p>
          <a className="button" href={to + "/admin/infrastructure/host"}>
            Open the host page at {to}
          </a>{" "}
          <span className="muted">You sign in again there.</span>
        </p>
      )}
      {request.status === "failed" && details.restored === true && (
        <p className="notice">
          The previous address and settings were restored automatically.
        </p>
      )}
      {Array.isArray(details.dns) && (
        <ul className="host-checks">
          {(details.dns as DnsAnswer[]).map((d) => (
            <li key={d.name}>
              <Status
                level={d.ok ? "ok" : "critical"}
                label={d.ok ? "OK" : "DNS"}
              />{" "}
              <span className="host-wrap">
                {d.name}: {d.addresses.join(", ") || "no A record"} ({d.source})
              </span>
            </li>
          ))}
        </ul>
      )}
      <small className="muted">
        Requested {when(request.createdAt)}
        {request.finishedAt ? ` · finished ${when(request.finishedAt)}` : ""}
      </small>
    </div>
  );
}

export function PlatformAddressChange({
  data,
  busy,
  run,
  reload,
  unreachable,
}: {
  data: Snapshot;
  busy: boolean;
  run: (fn: () => Promise<string | void>) => Promise<void>;
  reload: () => Promise<void>;
  unreachable?: boolean;
}) {
  const [address, setAddress] = useState(""),
    [root, setRoot] = useState(""),
    [result, setResult] = useState<AddressCheck | null>(null),
    [checked, setChecked] = useState(""),
    [reason, setReason] = useState(""),
    [understood, setUnderstood] = useState(false);
  const state = data.address ?? null;
  const latest = data.actions.recent.find(
    (r) => r.action === "change_platform_address",
  );
  const active =
    latest && (latest.status === "pending" || latest.status === "running");
  const inputs = JSON.stringify([address.trim(), root.trim()]);
  const ready =
    !!result && result.valid && result.changed && checked === inputs;
  return (
    <section className="card host-ops" aria-label="Platform address">
      <h2>Change the platform address</h2>
      <p className="muted">
        Moves the platform to a new HTTPS address, for example your own domain.
        The host controller checks DNS from the server first and changes nothing
        unless the new name points only to this server; if the new address
        fails, it restores the previous one automatically.
      </p>
      <dl className="host-facts">
        <div>
          <dt>Current address</dt>
          <dd className="host-wrap">{data.edge?.endpoint || "—"}</dd>
        </div>
        <div>
          <dt>This server (public IPv4)</dt>
          <dd>{state?.publicIpv4 ?? "Not reported yet"}</dd>
        </div>
        <div>
          <dt>Root domain for workspace addresses</dt>
          <dd>{state?.rootDomain ?? "Not set"}</dd>
        </div>
        <div>
          <dt>Old addresses redirecting here</dt>
          <dd className="host-wrap">
            {state?.redirectFrom.length
              ? state.redirectFrom.join(", ")
              : "None"}
          </dd>
        </div>
      </dl>
      {state?.redirectFrom.length ? (
        <p className="muted">
          Old addresses keep redirecting until you request &ldquo;Remove
          old-address redirects&rdquo; under Request a host action.
        </p>
      ) : null}
      {state?.lastChange?.status === "restore_failed" && (
        <p className="notice error">
          The last address change could not restore the previous address
          automatically. Run hostops.py reapply from the DigitalOcean console
          (see the host operations guide).
        </p>
      )}
      {latest && (
        <AddressChangeProgress request={latest} unreachable={unreachable} />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const checkedInputs = inputs;
            setResult(
              await call<AddressCheck>("/platform-address/check", {
                url: address.trim(),
                ...(root.trim() ? { rootDomain: root.trim() } : {}),
              }),
            );
            setChecked(checkedInputs);
            setUnderstood(false);
          });
        }}
      >
        <fieldset disabled={busy}>
          <label className="field">
            <span>New platform address</span>
            <input
              type="url"
              required
              placeholder="https://trainsyou.com"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Root domain for workspace addresses (optional)</span>
            <input
              placeholder="trainsyou.com"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              aria-describedby="host-root-hint"
            />
            <small className="muted" id="host-root-hint">
              Sets PLATFORM_ROOT_DOMAIN so each workspace gets name.your-domain.
              Leave empty to keep it as it is ({state?.rootDomain ?? "not set"}
              ). Needs a wildcard A record.
            </small>
          </label>
          <button className="button secondary">Check DNS</button>
        </fieldset>
      </form>
      {result && <AddressCheckResult result={result} />}
      {result && checked !== inputs && (
        <p className="notice">
          The address changed since the last check. Check DNS again before
          requesting the switch.
        </p>
      )}
      {ready && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await call("/host/actions", {
                requestId: crypto.randomUUID(),
                action: "change_platform_address",
                parameters: {
                  url: result!.origin,
                  ...(result!.rootDomain
                    ? { rootDomain: result!.rootDomain }
                    : {}),
                },
                reason,
              });
              setReason("");
              setUnderstood(false);
              await reload();
              return "Address change requested. Keep this page open to follow its progress.";
            });
          }}
        >
          <fieldset disabled={busy || !data.signingAvailable || !!active}>
            <h3>Request the switch</h3>
            <ul className="host-warnings">
              <li>
                Passkeys are tied to the current hostname and stop working after
                the move; their owners sign in with password and authenticator
                (or a recovery code) and add a new passkey.
              </li>
              <li>
                Everyone, including you, signs in again at the new address. The
                old address redirects there until you remove the redirect.
              </li>
              <li>
                Update the Stripe webhook endpoint and every OAuth redirect URL
                listed above; until then, payment events and sign-in with Google
                or Apple, WHOOP, Zepp and Instagram connections fail.
              </li>
            </ul>
            <label className="field">
              <span>Reason (recorded in the audit log)</span>
              <textarea
                required
                minLength={10}
                maxLength={500}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                required
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
              />{" "}
              I have read the warnings and will update the provider settings
              after the move.
            </label>
            <button className="button" disabled={!understood}>
              Request the switch to {result!.origin}
            </button>
            {active && (
              <p className="muted">
                An address change is already waiting or running.
              </p>
            )}
          </fieldset>
        </form>
      )}
    </section>
  );
}

export function HostOperations() {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [action, setAction] = useState("backup_now"),
    [target, setTarget] = useState("api"),
    [reason, setReason] = useState("");
  const [thresholds, setThresholds] = useState<Record<string, number>>({}),
    [thresholdReason, setThresholdReason] = useState("");
  const [unreachable, setUnreachable] = useState(false);
  const load = useCallback(async () => {
    const snapshot = await call<Snapshot>("/host");
    setData(snapshot);
    setThresholds(snapshot.thresholds.values);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, [load]);
  // Follow a waiting or running address change. While the services restart (or
  // after the move, when this address redirects) the page cannot load; that is
  // shown as progress, not as an error.
  const moving = data?.actions.recent.find(
    (r) =>
      r.action === "change_platform_address" &&
      (r.status === "pending" || r.status === "running"),
  );
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => {
      void load()
        .then(() => setUnreachable(false))
        .catch(() => setUnreachable(true));
    }, 15000);
    return () => clearInterval(timer);
  }, [moving?.id, moving?.status, load]);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const done = await fn();
      if (done) setMessage(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selected = data?.actions.allowlist.find((a) => a.action === action);
  // Actions with their own form (the address change) are requested there.
  const generic = data?.actions.allowlist.filter((a) => !a.form) ?? [];
  const deploy = data?.deploy;
  return (
    <div className="stack host-ops">
      <div className="page-heading">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>Host and backups.</h1>
          <p>
            Server measurements, encrypted database backups and a short list of
            reviewed host actions. Every request needs a recent authenticator
            check and a reason, and is recorded.
          </p>
        </div>
      </div>
      <nav className="tabs" aria-label="Infrastructure views">
        <a href="/admin/infrastructure/actions">Approved operations</a>
        <a href="/admin/infrastructure">Job operations</a>
        <a href="/admin/infrastructure/observer">Infrastructure observations</a>
        <a href="/admin/infrastructure/host" aria-current="page">
          Host and backups
        </a>
      </nav>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      <div className="button-row">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => void run(() => load())}
        >
          Refresh
        </button>
      </div>
      {!data ? (
        !error && <p role="status">Loading host status…</p>
      ) : (
        <>
          <HostMetricsPanel snapshot={data} />
          <BackupCard backups={data.backups} />
          <section className="card host-ops" aria-label="Deployment">
            <h2>Deployment</h2>
            {deploy ? (
              <dl className="host-facts">
                <div>
                  <dt>Serving</dt>
                  <dd>
                    {short(deploy.serving ?? deploy.current)}
                    {deploy.serving ? " (rolled back)" : ""}
                  </dd>
                </div>
                <div>
                  <dt>Latest deployed</dt>
                  <dd>
                    {short(deploy.current)} · {when(deploy.deployedAt)}
                  </dd>
                </div>
                <div>
                  <dt>Previous</dt>
                  <dd>{short(deploy.previous)}</dd>
                </div>
                <div>
                  <dt>Automatic deploys</dt>
                  <dd>
                    {deploy.paused
                      ? `Paused ${when(deploy.pausedAt)}${deploy.pausedReason === "rollback" ? " after a rollback" : deploy.pausedReason === "unreadable" ? " (control file unreadable)" : ""}`
                      : "Running"}
                  </dd>
                </div>
                <div>
                  <dt>Coach-domain HTTPS</dt>
                  <dd>
                    <EdgeState edge={data.edge} />
                  </dd>
                </div>
              </dl>
            ) : (
              <p>No verified deployment state has been reported.</p>
            )}
          </section>
          <section className="card host-ops" aria-label="Request a host action">
            <h2>Request a host action</h2>
            <p className="muted">
              {data.actions.pickup} Requests expire after{" "}
              {data.actions.ttlMinutes} minutes if not picked up; at most{" "}
              {data.actions.perHour} each hour.
            </p>
            {!data.signingAvailable && (
              <p className="notice error">
                Host actions are unavailable: the internal signing secret is not
                configured on this server.
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await call("/host/actions", {
                    requestId: crypto.randomUUID(),
                    action,
                    ...(action === "restart_service" ? { target } : {}),
                    reason,
                  });
                  setReason("");
                  await load();
                  return "Request recorded. The host controller will pick it up on its next cycle.";
                });
              }}
            >
              <fieldset disabled={busy || !data.signingAvailable}>
                <label className="field">
                  <span>Action</span>
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    {generic.map((a) => (
                      <option key={a.action} value={a.action}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                {selected && <p className="muted">{selected.description}</p>}
                {action === "restart_service" && (
                  <label className="field">
                    <span>Service</span>
                    <select
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="api">API</option>
                      <option value="web">Web</option>
                      <option value="worker">Worker</option>
                    </select>
                  </label>
                )}
                <label className="field">
                  <span>Reason (recorded in the audit log)</span>
                  <textarea
                    required
                    minLength={10}
                    maxLength={500}
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="button">Request action</button>
              </fieldset>
            </form>
            <h3>Not available here</h3>
            {data.outOfScope.map((item) => (
              <p key={item.capability}>
                <strong>{item.capability}:</strong> {item.reason}
              </p>
            ))}
          </section>
          <section className="card host-ops" aria-label="Host action history">
            <h2>Recent host actions</h2>
            {!data.actions.recent.length && (
              <p>No host actions requested yet.</p>
            )}
            <ul className="host-requests">
              {data.actions.recent.map((r) => (
                <li key={r.id}>
                  <div className="card-heading">
                    <strong>
                      {r.label}
                      {r.target ? ` · ${r.target}` : ""}
                    </strong>
                    <Status
                      level={
                        r.status === "succeeded"
                          ? "ok"
                          : ["failed", "rejected"].includes(r.status) ||
                              r.outcomeUnknown
                            ? "critical"
                            : r.status === "canceled" || r.status === "expired"
                              ? "info"
                              : "warning"
                      }
                      label={r.status}
                    />
                  </div>
                  <p className="host-wrap">{r.reason}</p>
                  <small className="muted">
                    Requested {when(r.createdAt)}
                    {r.finishedAt ? ` · finished ${when(r.finishedAt)}` : ""}
                  </small>
                  {r.result?.message && (
                    <p className="host-wrap">
                      {r.result.message}
                      {r.resultVerified === false &&
                        " (this result is not signed by the host controller)"}
                    </p>
                  )}
                  {r.notPickedUp && (
                    <p className="notice">
                      Not picked up before it expired. Check that the host
                      controller is running.
                    </p>
                  )}
                  {r.outcomeUnknown && (
                    <p className="notice error">
                      No result was recorded. Check the host before requesting
                      it again.
                    </p>
                  )}
                  {r.status === "pending" && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await call(`/host/actions/${r.id}/cancel`, {
                            reason: "Canceled from the host operations view",
                          });
                          await load();
                          return "Request canceled.";
                        })
                      }
                    >
                      Cancel request
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="card host-ops" aria-label="Host thresholds">
            <h2>Host thresholds</h2>
            <p className="muted">
              Revision {data.thresholds.revision} · {data.thresholds.reason}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await call("/host/thresholds", {
                    revision: data.thresholds.revision,
                    thresholds,
                    reason: thresholdReason,
                  });
                  setThresholdReason("");
                  await load();
                  return "Thresholds saved.";
                });
              }}
            >
              <fieldset disabled={busy}>
                <div className="host-threshold-grid">
                  {Object.keys(thresholdLabels).map((key) => (
                    <label className="field" key={key}>
                      <span>{thresholdLabels[key]}</span>
                      <input
                        type="number"
                        step="any"
                        required
                        value={thresholds[key] ?? ""}
                        onChange={(e) =>
                          setThresholds({
                            ...thresholds,
                            [key]: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label className="field">
                  <span>Reason for the change</span>
                  <input
                    required
                    minLength={10}
                    maxLength={500}
                    value={thresholdReason}
                    onChange={(e) => setThresholdReason(e.target.value)}
                  />
                </label>
                <button className="button">Save thresholds</button>
              </fieldset>
            </form>
          </section>
          <PlatformAddressChange
            data={data}
            busy={busy}
            run={run}
            reload={load}
            unreachable={unreachable}
          />
        </>
      )}
    </div>
  );
}
