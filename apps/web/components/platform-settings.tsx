"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Globe,
  KeyRound,
  LockKeyhole,
  Mail,
  PlugZap,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Unplug,
  Wallet,
  X,
} from "lucide-react";
import { AccountSecurity } from "./account-security";

type IntegrationField = {
  key: string;
  label: string;
  type: "secret" | "text" | "url" | "number" | "boolean" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
  help?: string;
  defaultValue?: string;
};
type ConnectionTest = {
  status: "verified" | "validated" | "unavailable" | "failed";
  message: string;
  checkedAt: string;
  revision: number;
};
type Integration = {
  id: string;
  name: string;
  description: string;
  category: string;
  implemented: boolean;
  fields: IntegrationField[];
  setupNotes?: string;
  values: Record<string, string>;
  secrets: Record<string, boolean>;
  revision: number;
  enabled: boolean;
  active: boolean;
  lastTest: ConnectionTest | null;
  source?: "superadmin" | "environment";
  credentialStatus?:
    | "empty"
    | "environment"
    | "ready"
    | "encryption_unavailable"
    | "credentials_unreadable";
};
type AuditEntry = {
  id: string;
  integrationId: string;
  revision: number;
  action: "saved" | "tested" | "disconnected";
  actorId: string;
  changedFields: string[];
  result?: string;
  createdAt: string;
};
type SettingsEnvelope = {
  encryptionReady: boolean;
  integrations: Integration[];
  audit: AuditEntry[];
};
type RequestError = Error & { code?: string; status?: number };
const integrationIcons = {
  application: SlidersHorizontal,
  stripe: CreditCard,
  lean: Wallet,
  model: Sparkles,
  email: Mail,
  whoop: Activity,
  apple: Activity,
  zepp: Activity,
  voice: Activity,
  domains: Globe,
};
const categories: Record<string, { name: string; description: string }> = {
  platform: {
    name: "Platform controls",
    description: "Set the operating rules for your coaching platform.",
  },
  payments: {
    name: "Payments & payouts",
    description:
      "Collect subscriptions and manage the trainer payout connection.",
  },
  intelligence: {
    name: "Coaching intelligence",
    description: "Configure the model behind each trainer’s coaching methods.",
  },
  communications: {
    name: "Communication",
    description: "Keep account and coaching messages connected.",
  },
  health: {
    name: "Health & activity",
    description: "Bring consented activity data into the coaching experience.",
  },
  branding: {
    name: "Client experience",
    description:
      "Connect voice and custom domains as adapters become available.",
  },
};

async function request<T>(
  path = "",
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/v1/admin/settings${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(
        result.message || "Settings could not be loaded. Please try again.",
      ),
      { code: result.code, status: response.status },
    );
  return result as T;
}

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Dubai",
      }).format(date) + " GST";
}

function statusOf(integration: Integration) {
  if (integration.id === "application")
    return { label: "Platform controls", tone: "neutral" };
  if (
    ["encryption_unavailable", "credentials_unreadable"].includes(
      integration.credentialStatus ?? "",
    )
  )
    return { label: "Credentials unavailable", tone: "warning" };
  if (!integration.implemented)
    return { label: "Adapter pending", tone: "neutral" };
  if (integration.active && integration.source === "environment")
    return { label: "Inherited configuration", tone: "neutral" };
  if (integration.active) return { label: "Enabled", tone: "positive" };
  if (integration.lastTest?.status === "failed")
    return { label: "Check failed", tone: "warning" };
  if (integration.lastTest?.status === "unavailable")
    return { label: "Check unavailable", tone: "warning" };
  if (integration.enabled)
    return { label: "Needs verification", tone: "warning" };
  if (
    integration.lastTest &&
    ["verified", "validated"].includes(integration.lastTest.status) &&
    integration.lastTest.revision === integration.revision
  )
    return { label: "Ready to enable", tone: "positive" };
  if (integration.revision > 0)
    return { label: "Saved · inactive", tone: "neutral" };
  return { label: "Not configured", tone: "neutral" };
}

function Status({ integration }: { integration: Integration }) {
  const status = statusOf(integration);
  return (
    <span className={`ps-status ps-status--${status.tone}`}>
      <span aria-hidden="true" />
      {status.label}
    </span>
  );
}

function IntegrationIcon({ id }: { id: string }) {
  const Icon = integrationIcons[id as keyof typeof integrationIcons] ?? PlugZap;
  return (
    <span className={`ps-provider-icon ps-provider-icon--${id}`}>
      <Icon size={23} strokeWidth={1.6} aria-hidden="true" />
    </span>
  );
}

function AuditLog({
  entries,
  integrations,
}: {
  entries: AuditEntry[];
  integrations: Integration[];
}) {
  return (
    <section className="ps-audit" aria-labelledby="settings-activity-title">
      <div className="ps-section-title">
        <div>
          <p className="eyebrow">CHANGE HISTORY</p>
          <h2 id="settings-activity-title">Recent activity</h2>
        </div>
        <span className="ps-caption">Credential values are never shown</span>
      </div>
      {entries.length ? (
        <ol className="ps-audit-list">
          {entries.slice(0, 10).map((entry) => {
            const integration = integrations.find(
              (item) => item.id === entry.integrationId,
            );
            const labels = entry.changedFields.map(
              (key) =>
                integration?.fields.find((field) => field.key === key)?.label ??
                (key === "enabled"
                  ? "Activation"
                  : key.replaceAll("_", " ").toLowerCase()),
            );
            return (
              <li key={entry.id}>
                <span className="ps-audit-dot" aria-hidden="true">
                  <Check size={13} />
                </span>
                <div>
                  <strong>
                    {integration?.name ?? entry.integrationId}{" "}
                    {entry.action === "tested"
                      ? "connection checked"
                      : entry.action === "disconnected"
                        ? "disconnected"
                        : "settings saved"}
                  </strong>
                  <p>
                    {entry.action === "tested"
                      ? `Result: ${entry.result ?? "recorded"}`
                      : labels.length
                        ? labels.join(" · ")
                        : "Configuration updated"}
                    <span className="ps-audit-revision">
                      {" "}
                      · Revision {entry.revision}
                    </span>
                  </p>
                </div>
                <time dateTime={entry.createdAt}>
                  {displayDate(entry.createdAt)}
                </time>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="ps-quiet-empty">
          <ShieldCheck size={21} />
          <div>
            <strong>Your settings history starts here.</strong>
            <p>
              Saves, connection checks and disconnections appear as they happen.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function PlatformSettings({
  path,
  platformRole,
  onSettingsChanged,
}: {
  path: string;
  platformRole: string;
  onSettingsChanged?: () => void | Promise<void>;
}) {
  const [data, setData] = useState<SettingsEnvelope | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const selectedId = path.startsWith("/admin/integrations/")
    ? path.split("/")[3]
    : "";
  useEffect(() => {
    if (platformRole !== "admin") {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    request<SettingsEnvelope>("", "GET", undefined, controller.signal)
      .then(setData)
      .catch((caught: RequestError) => {
        if (caught.name !== "AbortError") setError(caught);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [platformRole, refresh]);

  const reload = () => setRefresh((value) => value + 1);
  if (platformRole !== "admin")
    return (
      <section className="ps-access">
        <LockKeyhole size={30} />
        <h1>Superadmin access required.</h1>
        <p>
          Platform connections and API settings are managed by the platform
          owner.
        </p>
        <Link href="/trainer" className="button secondary">
          Return to your workspace
        </Link>
      </section>
    );
  if (loading && !data)
    return (
      <section className="ps-loading" aria-live="polite">
        <Settings2 size={28} />
        <h1>Opening platform settings…</h1>
        <p>Loading saved configuration and connection status.</p>
      </section>
    );
  if (error && !data)
    return (
      <section className="ps-access">
        <CircleHelp size={30} />
        <h1>Settings are unavailable.</h1>
        <p role="alert">{error.message}</p>
        <button className="button secondary" onClick={reload}>
          Try again <RefreshCw size={15} />
        </button>
      </section>
    );
  if (!data) return null;
  const selected = data.integrations.find(
    (integration) => integration.id === selectedId,
  );
  const providers = data.integrations.filter(
    (integration) => integration.id !== "application",
  );
  const activeCount = providers.filter(
    (integration) => integration.active,
  ).length;
  const visible = data.integrations.filter((integration) => {
    const matchesQuery =
      `${integration.name} ${integration.description} ${integration.category}`
        .toLowerCase()
        .includes(query.toLowerCase());
    return (
      matchesQuery &&
      (filter === "all" ||
        (filter === "active" &&
          integration.active &&
          integration.id !== "application") ||
        (filter === "attention" &&
          !integration.active &&
          integration.id !== "application"))
    );
  });
  const groups = [
    ...new Set(visible.map((integration) => integration.category)),
  ];
  const replaceIntegration = (updated: Integration) => {
    setData((current) =>
      current
        ? {
            ...current,
            integrations: current.integrations.map((item) =>
              item.id === updated.id ? updated : item,
            ),
          }
        : current,
    );
    // Refresh the sanitized activity feed without unmounting the saved form.
    void request<SettingsEnvelope>()
      .then(setData)
      .catch(() => {});
    void onSettingsChanged?.();
  };
  return (
    <div className="platform-settings">
      <nav className="ps-breadcrumbs" aria-label="Platform navigation">
        <Link href="/admin">Platform overview</Link>
        <ChevronRight size={13} />
        <Link
          href="/admin/settings"
          aria-current={!selectedId ? "page" : undefined}
        >
          Settings & connections
        </Link>
        {selected && (
          <>
            <ChevronRight size={13} />
            <span aria-current="page">{selected.name}</span>
          </>
        )}
      </nav>
      {error && (
        <p className="ps-notice ps-notice--error" role="alert">
          {error.message}
          <button className="text-button" onClick={reload}>
            Reload
          </button>
        </p>
      )}
      {selectedId ? (
        selected ? (
          <IntegrationEditor
            key={selected.id}
            integration={selected}
            encryptionReady={data.encryptionReady}
            onUpdate={replaceIntegration}
            onReload={reload}
            audit={data.audit.filter(
              (entry) => entry.integrationId === selected.id,
            )}
          />
        ) : (
          <section className="ps-access">
            <PlugZap size={30} />
            <h1>Connection not found.</h1>
            <p>This integration is not in the platform catalog.</p>
            <Link href="/admin/settings" className="button secondary">
              Browse connections
            </Link>
          </section>
        )
      ) : (
        <>
          <header className="ps-page-heading">
            <div>
              <p className="eyebrow">SUPERADMIN / CONTROL CENTER</p>
              <h1>Platform settings.</h1>
              <p>
                One place for the services, API keys and operating rules behind
                your platform.
              </p>
            </div>
            <Link className="button secondary" href="/admin/security">
              <ShieldCheck size={16} />
              Account security
            </Link>
          </header>
          <div className="ps-summary">
            <div>
              <span className="ps-summary-icon">
                <PlugZap size={20} />
              </span>
              <div>
                <strong>
                  {activeCount}
                  <span> / {providers.length}</span>
                </strong>
                <p>Connections enabled</p>
              </div>
            </div>
            <div>
              <span className="ps-summary-icon">
                <KeyRound size={20} />
              </span>
              <div>
                <strong>
                  {data.encryptionReady ? "Protected" : "Setup needed"}
                </strong>
                <p>
                  {data.encryptionReady
                    ? "Encrypted credential storage"
                    : "Credential storage is unavailable"}
                </p>
              </div>
            </div>
            <div>
              <span className="ps-summary-icon">
                <ShieldCheck size={20} />
              </span>
              <div>
                <strong>Owner controlled</strong>
                <p>Identity verification for changes</p>
              </div>
            </div>
          </div>
          {!data.encryptionReady && (
            <div className="ps-notice ps-notice--warning" role="status">
              <KeyRound size={20} />
              <div>
                <strong>Secure storage needs its initial setup.</strong>
                <p>
                  Your deployment administrator must configure the encryption
                  key before API credentials can be saved. Existing credential
                  values are never sent to this page.
                </p>
              </div>
            </div>
          )}
          <div className="ps-toolbar">
            <label className="ps-search">
              <Search size={17} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a connection or setting"
                aria-label="Find a connection or setting"
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={15} />
                </button>
              )}
            </label>
            <div className="ps-filters" aria-label="Filter connections">
              {[
                ["all", "All"],
                ["active", "Enabled"],
                ["attention", "To configure"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "is-selected" : ""}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {groups.length ? (
            groups.map((category) => (
              <section
                className="ps-catalog-group"
                key={category}
                aria-labelledby={`category-${category}`}
              >
                <div className="ps-section-title">
                  <div>
                    <h2 id={`category-${category}`}>
                      {categories[category]?.name ??
                        category.replaceAll("_", " ")}
                    </h2>
                    <p>
                      {categories[category]?.description ??
                        "Manage connections and their availability across the platform."}
                    </p>
                  </div>
                </div>
                <div className="ps-catalog-grid">
                  {visible
                    .filter((integration) => integration.category === category)
                    .map((integration) => (
                      <Link
                        href={`/admin/integrations/${integration.id}`}
                        className={`ps-integration-card ${integration.id === "application" ? "ps-integration-card--platform" : ""}`}
                        key={integration.id}
                      >
                        <div className="ps-card-top">
                          <IntegrationIcon id={integration.id} />
                          <Status integration={integration} />
                        </div>
                        <h3>{integration.name}</h3>
                        <p>{integration.description}</p>
                        <div className="ps-card-bottom">
                          <span>
                            {integration.id === "application"
                              ? "Manage controls"
                              : integration.revision > 0
                                ? "Manage connection"
                                : "Configure connection"}
                          </span>
                          <ArrowRight size={17} />
                        </div>
                      </Link>
                    ))}
                </div>
              </section>
            ))
          ) : (
            <div className="ps-quiet-empty">
              <Search size={24} />
              <div>
                <strong>No matching connections.</strong>
                <p>Try another search or choose a different filter.</p>
              </div>
            </div>
          )}
          <AuditLog entries={data.audit} integrations={data.integrations} />
        </>
      )}
    </div>
  );
}

function IntegrationEditor({
  integration,
  encryptionReady,
  onUpdate,
  onReload,
  audit,
}: {
  integration: Integration;
  encryptionReady: boolean;
  onUpdate: (updated: Integration) => void;
  onReload: () => void;
  audit: AuditEntry[];
}) {
  const initialValues = Object.fromEntries(
    integration.fields
      .filter((field) => field.type !== "secret")
      .map((field) => [
        field.key,
        integration.values[field.key] ??
          field.defaultValue ??
          (field.type === "boolean" ? "false" : ""),
      ]),
  );
  const [values, setValues] = useState(initialValues);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [clearSecrets, setClearSecrets] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<RequestError | null>(null);
  const [message, setMessage] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [applicationOrigin, setApplicationOrigin] = useState("");
  const controls = integration.id === "application";
  const dirty =
    JSON.stringify(values) !== JSON.stringify(initialValues) ||
    Object.values(secrets).some((value) => value.length > 0) ||
    clearSecrets.length > 0;
  const currentTest =
    integration.lastTest?.revision === integration.revision
      ? integration.lastTest
      : null;
  const tested =
    !!currentTest && ["verified", "validated"].includes(currentTest.status);
  const credentialProblem = [
    "encryption_unavailable",
    "credentials_unreadable",
  ].includes(integration.credentialStatus ?? "");
  const canEnable =
    integration.implemented && tested && !dirty && !credentialProblem;
  const secretsFields = integration.fields.filter(
    (field) => field.type === "secret",
  );
  const valueFields = integration.fields.filter(
    (field) => field.type !== "secret",
  );
  useEffect(() => {
    setApplicationOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    setValues(
      Object.fromEntries(
        integration.fields
          .filter((field) => field.type !== "secret")
          .map((field) => [
            field.key,
            integration.values[field.key] ??
              field.defaultValue ??
              (field.type === "boolean" ? "false" : ""),
          ]),
      ),
    );
    setSecrets({});
    setClearSecrets([]);
  }, [integration.id, integration.revision]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  async function mutate(
    action: "save" | "test" | "toggle" | "disconnect",
    payload?: unknown,
  ) {
    setBusy(action);
    setError(null);
    setMessage("");
    try {
      const updated = await request<Integration>(
        `/${integration.id}${action === "test" || action === "disconnect" ? `/${action}` : ""}`,
        action === "test" || action === "disconnect" ? "POST" : "PUT",
        payload ?? { revision: integration.revision },
      );
      setSecrets({});
      setClearSecrets([]);
      setDisconnecting(false);
      onUpdate(updated);
      setMessage(
        action === "test"
          ? (updated.lastTest?.message ?? "Connection check completed.")
          : action === "disconnect"
            ? "Integration disconnected. Stored credentials have been removed."
            : action === "toggle"
              ? updated.enabled
                ? "Integration enabled."
                : "Integration disabled."
              : "Configuration saved.",
      );
    } catch (caught) {
      const problem = caught as RequestError;
      setError(problem);
      if (problem.code === "MFA_STEP_UP") setShowSecurity(true);
    } finally {
      setBusy("");
    }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    const replacements = Object.fromEntries(
      Object.entries(secrets).filter(([, value]) => value.trim().length > 0),
    );
    void mutate("save", {
      revision: integration.revision,
      enabled: integration.enabled,
      values,
      ...(Object.keys(replacements).length ? { secrets: replacements } : {}),
      ...(clearSecrets.length ? { clearSecrets } : {}),
    });
  }
  function discard() {
    setValues(initialValues);
    setSecrets({});
    setClearSecrets([]);
    setError(null);
    setMessage("");
  }
  function fieldHelp(field: IntegrationField) {
    return field.help ? (
      <small id={`help-${field.key}`}>{field.help}</small>
    ) : null;
  }
  return (
    <>
      <Link
        href="/admin/settings"
        className="ps-back-link"
        onClick={(event) => {
          if (
            dirty &&
            !window.confirm("Discard the unsaved changes to this connection?")
          )
            event.preventDefault();
        }}
      >
        <ArrowLeft size={15} />
        All settings & connections
      </Link>
      <header className="ps-page-heading ps-page-heading--detail">
        <div className="ps-provider-heading">
          <IntegrationIcon id={integration.id} />
          <div>
            <p className="eyebrow">
              {controls ? "PLATFORM CONTROLS" : "CONNECTION SETTINGS"}
            </p>
            <h1>{integration.name}</h1>
            <p>{integration.description}</p>
          </div>
        </div>
        <Status integration={integration} />
      </header>
      {!controls && (
        <ol className="ps-setup-steps" aria-label="Connection setup progress">
          <li className={integration.revision > 0 ? "is-done" : "is-current"}>
            <span>{integration.revision > 0 ? <Check size={13} /> : "1"}</span>
            <div>
              <strong>Configure</strong>
              <small>Save account details</small>
            </div>
          </li>
          <li
            className={
              tested ? "is-done" : integration.revision > 0 ? "is-current" : ""
            }
          >
            <span>{tested ? <Check size={13} /> : "2"}</span>
            <div>
              <strong>Check</strong>
              <small>Test the saved configuration</small>
            </div>
          </li>
          <li
            className={
              integration.active ? "is-done" : tested ? "is-current" : ""
            }
          >
            <span>{integration.active ? <Check size={13} /> : "3"}</span>
            <div>
              <strong>Enable</strong>
              <small>Make available to the platform</small>
            </div>
          </li>
        </ol>
      )}
      {credentialProblem && (
        <div className="ps-notice ps-notice--warning" role="status">
          <KeyRound size={19} />
          <div>
            <strong>Saved credentials cannot be read.</strong>
            <p>
              {integration.credentialStatus === "encryption_unavailable"
                ? "The platform encryption key is unavailable. A deployment administrator needs to restore it before this connection can run."
                : "This connection is inactive because its saved credentials could not be decrypted. Restore the correct encryption key, replace every affected key, or disconnect and configure it again."}
            </p>
          </div>
        </div>
      )}
      {integration.source === "environment" && (
        <div className="ps-notice" role="status">
          <Settings2 size={18} />
          <div>
            <strong>Initial deployment configuration</strong>
            <p>
              These starting values come from your deployment. Saving moves this
              integration under Superadmin control; future updates can be made
              here.
            </p>
          </div>
        </div>
      )}
      {error && (
        <div className="ps-notice ps-notice--error" role="alert">
          <CircleHelp size={19} />
          <div>
            <strong>
              {error.code === "SETTINGS_CONFLICT"
                ? "These settings changed while you were editing."
                : error.code === "MFA_STEP_UP"
                  ? "Verify your identity to continue."
                  : "This action could not be completed."}
            </strong>
            <p>{error.message}</p>
            {error.code === "SETTINGS_CONFLICT" && (
              <button
                type="button"
                className="button secondary"
                onClick={onReload}
              >
                Reload latest settings <RefreshCw size={14} />
              </button>
            )}
            {error.code === "MFA_STEP_UP" && (
              <a className="text-link" href="#settings-security">
                Open account security <ArrowRight size={14} />
              </a>
            )}
          </div>
        </div>
      )}
      {message && (
        <div className="ps-notice ps-notice--success" role="status">
          <CheckCircle2 size={19} />
          {message}
        </div>
      )}
      <div className="ps-detail-grid">
        <div className="ps-editor-main">
          <form onSubmit={save} className="ps-config-form" autoComplete="off">
            {!!valueFields.length && (
              <section className="ps-panel">
                <div className="ps-panel-heading">
                  <div>
                    <p className="eyebrow">
                      {controls ? "OPERATING RULES" : "ACCOUNT CONFIGURATION"}
                    </p>
                    <h2>
                      {controls
                        ? "Your platform, your rules."
                        : "Connection details"}
                    </h2>
                  </div>
                  <Settings2 size={20} />
                </div>
                <div className="ps-fields">
                  {controls && (
                    <label className="ps-field">
                      <span>
                        Application address
                        <small>Managed by your deployment</small>
                      </span>
                      <input
                        type="url"
                        aria-label="Application address"
                        readOnly
                        value={applicationOrigin}
                      />
                      <small>
                        This is the address you are using. Domain and HTTPS
                        changes are configured with the deployment.
                      </small>
                    </label>
                  )}
                  {valueFields.map((field) =>
                    field.type === "boolean" ? (
                      <label
                        className="ps-toggle-field"
                        key={field.key}
                        htmlFor={`setting-${field.key}`}
                      >
                        <span>
                          <strong>{field.label}</strong>
                          {field.help && (
                            <small id={`help-${field.key}`}>{field.help}</small>
                          )}
                        </span>
                        <input
                          id={`setting-${field.key}`}
                          aria-label={field.label}
                          type="checkbox"
                          role="switch"
                          checked={values[field.key] === "true"}
                          onChange={(event) =>
                            setValues({
                              ...values,
                              [field.key]: String(event.target.checked),
                            })
                          }
                          aria-describedby={
                            field.help ? `help-${field.key}` : undefined
                          }
                          disabled={!!busy}
                        />
                        <span className="ps-switch" aria-hidden="true" />
                      </label>
                    ) : (
                      <label
                        className="ps-field"
                        key={field.key}
                        htmlFor={`setting-${field.key}`}
                      >
                        <span>
                          {field.label}
                          {field.required && <small>Needed to activate</small>}
                        </span>
                        {field.type === "select" ? (
                          <select
                            id={`setting-${field.key}`}
                            aria-label={field.label}
                            value={values[field.key] ?? ""}
                            onChange={(event) =>
                              setValues({
                                ...values,
                                [field.key]: event.target.value,
                              })
                            }
                            disabled={!!busy}
                            aria-describedby={
                              field.help ? `help-${field.key}` : undefined
                            }
                          >
                            <option value="">Select an option</option>
                            {field.options?.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={`setting-${field.key}`}
                            aria-label={field.label}
                            type={
                              field.type === "number"
                                ? "number"
                                : field.type === "url"
                                  ? "url"
                                  : "text"
                            }
                            step={field.type === "number" ? "any" : undefined}
                            value={values[field.key] ?? ""}
                            onChange={(event) =>
                              setValues({
                                ...values,
                                [field.key]: event.target.value,
                              })
                            }
                            disabled={!!busy}
                            aria-describedby={
                              field.help ? `help-${field.key}` : undefined
                            }
                            maxLength={2048}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        )}
                        {fieldHelp(field)}
                      </label>
                    ),
                  )}
                </div>
              </section>
            )}
            {!!secretsFields.length && (
              <section className="ps-panel">
                <div className="ps-panel-heading">
                  <div>
                    <p className="eyebrow">ENCRYPTED & PRIVATE</p>
                    <h2>API credentials</h2>
                  </div>
                  <KeyRound size={21} />
                </div>
                <p className="ps-panel-description">
                  Saved keys cannot be revealed here. Leave a field blank to
                  keep its existing key; enter a new key to replace it.
                </p>
                {!encryptionReady && (
                  <p className="ps-notice ps-notice--warning">
                    Credential storage is unavailable. Ask your deployment
                    administrator to configure the platform encryption key.
                  </p>
                )}
                <div className="ps-fields">
                  {secretsFields.map((field) => (
                    <div className="ps-secret-field" key={field.key}>
                      <label
                        className="ps-field"
                        htmlFor={`setting-${field.key}`}
                      >
                        <span>
                          {field.label}
                          <span
                            className={`ps-presence ${integration.secrets[field.key] ? "is-saved" : ""}`}
                          >
                            {integration.secrets[field.key] ? (
                              <>
                                <LockKeyhole size={11} />
                                {integration.source === "environment"
                                  ? "From deployment"
                                  : "Stored securely"}
                              </>
                            ) : (
                              "Not set"
                            )}
                          </span>
                        </span>
                        <input
                          id={`setting-${field.key}`}
                          aria-label={field.label}
                          name={`new-${field.key}`}
                          type="password"
                          autoComplete="new-password"
                          spellCheck={false}
                          value={secrets[field.key] ?? ""}
                          placeholder={
                            clearSecrets.includes(field.key)
                              ? "Will be removed when saved"
                              : integration.secrets[field.key]
                                ? "Leave blank to keep saved key"
                                : "Enter a key to configure"
                          }
                          onChange={(event) =>
                            setSecrets({
                              ...secrets,
                              [field.key]: event.target.value,
                            })
                          }
                          disabled={
                            !!busy ||
                            !encryptionReady ||
                            clearSecrets.includes(field.key)
                          }
                          aria-describedby={`secret-help-${field.key}`}
                          maxLength={8192}
                        />
                      </label>
                      <small id={`secret-help-${field.key}`}>
                        {field.help ??
                          "This value is sent securely to the server and stored encrypted."}
                      </small>
                      {integration.secrets[field.key] && (
                        <label className="ps-clear-secret">
                          <input
                            type="checkbox"
                            checked={clearSecrets.includes(field.key)}
                            onChange={(event) => {
                              setClearSecrets(
                                event.target.checked
                                  ? [...clearSecrets, field.key]
                                  : clearSecrets.filter(
                                      (key) => key !== field.key,
                                    ),
                              );
                              setSecrets({ ...secrets, [field.key]: "" });
                            }}
                            disabled={!!busy}
                          />
                          Remove saved {field.label}
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            <div className="ps-save-bar">
              <div>
                <span className={dirty ? "ps-unsaved" : "ps-saved"}>
                  <span />
                  {dirty
                    ? "Unsaved changes"
                    : integration.revision
                      ? "All changes saved"
                      : "Not saved yet"}
                </span>
                <small>
                  {controls
                    ? "Changes apply to platform operations."
                    : "Saving changes requires a fresh connection check."}
                </small>
              </div>
              <div className="ps-save-actions">
                {dirty && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={!!busy}
                    onClick={discard}
                  >
                    Discard
                  </button>
                )}
                <button
                  type="submit"
                  className="button"
                  disabled={
                    !!busy ||
                    (!dirty && integration.revision > 0) ||
                    (!encryptionReady &&
                      (clearSecrets.length > 0 ||
                        Object.values(secrets).some(Boolean)))
                  }
                >
                  {busy === "save" ? "Saving…" : "Save configuration"}
                  <Check size={15} />
                </button>
              </div>
            </div>
          </form>
        </div>
        <aside className="ps-editor-aside">
          {!controls && (
            <section className="ps-panel ps-readiness">
              <p className="eyebrow">CONNECTION STATUS</p>
              <h2>
                {integration.active
                  ? "Available to the platform."
                  : tested
                    ? "Ready for your decision."
                    : "Let’s get connected."}
              </h2>
              {!integration.implemented && (
                <div className="ps-inline-note">
                  <CircleHelp size={18} />
                  <p>
                    This provider’s adapter is not available yet. You can save
                    its configuration, but entering keys does not enable the
                    connection.
                  </p>
                </div>
              )}
              <dl>
                <div>
                  <dt>Configuration</dt>
                  <dd>
                    {integration.revision
                      ? `Revision ${integration.revision}`
                      : "Not saved"}
                  </dd>
                </div>
                <div>
                  <dt>Latest check</dt>
                  <dd>
                    {currentTest
                      ? currentTest.status === "verified"
                        ? "Verified"
                        : currentTest.status === "validated"
                          ? "Configuration validated"
                          : currentTest.status === "failed"
                            ? "Failed"
                            : "Unavailable"
                      : integration.source === "environment"
                        ? "Not tested here"
                        : "Not checked"}
                  </dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>{integration.active ? "Enabled" : "Inactive"}</dd>
                </div>
              </dl>
              {currentTest && (
                <div
                  className={`ps-test-result ps-test-result--${currentTest.status}`}
                >
                  <strong>
                    {currentTest.status === "verified"
                      ? "Connection verified"
                      : currentTest.status === "validated"
                        ? "Configuration validated"
                        : currentTest.status === "failed"
                          ? "Connection check failed"
                          : "Connection check unavailable"}
                  </strong>
                  <p>{currentTest.message}</p>
                  <time dateTime={currentTest.checkedAt}>
                    {displayDate(currentTest.checkedAt)}
                  </time>
                </div>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={!!busy || dirty || !integration.revision}
                onClick={() => void mutate("test")}
              >
                {busy === "test" ? "Checking connection…" : "Test connection"}
                <RefreshCw size={15} />
              </button>
              {dirty && (
                <p className="ps-caption">
                  Save your changes before checking the connection.
                </p>
              )}
              <div className="ps-divider" />
              <div className="ps-activation">
                <strong>Platform availability</strong>
                <p>
                  {integration.id === "stripe"
                    ? "Disable to stop new payment actions while keeping webhook processing available. Individual commerce controls still apply."
                    : "Enable after checking the saved configuration. Feature-specific controls still apply."}
                </p>
                <button
                  className={`button ${integration.enabled ? "secondary" : ""}`}
                  type="button"
                  disabled={
                    !!busy || dirty || (!integration.enabled && !canEnable)
                  }
                  onClick={() =>
                    void mutate("toggle", {
                      revision: integration.revision,
                      enabled: !integration.enabled,
                      values: {},
                    })
                  }
                >
                  {busy === "toggle"
                    ? "Updating…"
                    : integration.enabled
                      ? "Disable integration"
                      : "Enable integration"}
                  <PlugZap size={15} />
                </button>
                {!canEnable && !integration.enabled && (
                  <small>
                    {!integration.implemented
                      ? "Available when the adapter is implemented."
                      : "A successful check is needed to enable this connection."}
                  </small>
                )}
              </div>
            </section>
          )}
          <section className="ps-panel ps-guidance">
            <span className="ps-guidance-icon">
              <ShieldCheck size={22} />
            </span>
            <h3>
              {controls ? "Change with context." : "Your keys stay private."}
            </h3>
            <p>
              {controls
                ? "These controls affect every trainer workspace. Only mark a review complete once the underlying requirements have been verified."
                : "Only Superadmins can change these credentials. Saved values are encrypted, never displayed, and excluded from the activity feed."}
            </p>
            {integration.setupNotes && (
              <p className="ps-setup-note">{integration.setupNotes}</p>
            )}
            <button
              type="button"
              className="text-link"
              onClick={() => setShowSecurity(!showSecurity)}
            >
              {showSecurity ? "Hide account security" : "Verify your identity"}
              <ArrowRight size={14} />
            </button>
          </section>
          {!controls && integration.revision > 0 && (
            <section className="ps-disconnect">
              <button
                type="button"
                className="text-button"
                disabled={!!busy}
                onClick={() => {
                  setDisconnecting(!disconnecting);
                  setAcknowledged(false);
                }}
              >
                <Unplug size={15} />
                Disconnect this integration
              </button>
              {disconnecting && (
                <div className="ps-disconnect-confirm">
                  <strong>Remove the connection?</strong>
                  <p>
                    {integration.id === "stripe"
                      ? "This disables Stripe and removes its saved credentials. Webhook verification and payment reconciliation will stop until keys are configured again. Use Disable integration above if you need to keep webhook processing."
                      : "This disables the integration and removes its saved credentials. You will need to enter keys and check the connection again to reconnect."}
                  </p>
                  <label>
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                    />
                    I understand what will be disconnected.
                  </label>
                  <button
                    type="button"
                    className="button ps-danger-button"
                    disabled={!acknowledged || !!busy}
                    onClick={() => void mutate("disconnect")}
                  >
                    {busy === "disconnect"
                      ? "Disconnecting…"
                      : "Disconnect and clear credentials"}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setDisconnecting(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
      {showSecurity && (
        <div id="settings-security" className="ps-security-panel">
          <AccountSecurity />
          <p className="ps-caption">
            After verification, return to your configuration above and try the
            action again.
          </p>
        </div>
      )}
      <AuditLog entries={audit} integrations={[integration]} />
    </>
  );
}
