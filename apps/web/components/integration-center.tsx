"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { HealthKitSyncPanel } from "./healthkit-sync";
import { painDescription } from "./pain-report";
import {
  BottomSheet,
  FileInput,
  ProgressRing,
  Skeleton,
  StickyActionBar,
} from "./phone-ui";
import { VoiceSessionStyle } from "./voice-session-style";
import { VoiceOneOnOne } from "./voice-one-on-one";
import { WebAddressCenter, type WebAddressState } from "./web-address";
import { WebAddressOperations } from "./web-address-operations";
import { TrainerVoiceClone, VoiceCloneOperations } from "./trainer-voice-clone";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import {
  formatCountdown,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatWhen,
} from "../lib/format";

async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "The request could not be completed.");
  return data;
}
function Panel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Notice({ value }: { value: string }) {
  return value ? (
    <p role="status" className="notice">
      {value}
    </p>
  ) : null;
}
function useAction(refresh: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const t = useT("connect"),
    toError = useErrorText();
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await refresh();
      setMessage(success ?? t("saved"));
    } catch (e) {
      setMessage(e instanceof Error ? toError(e) : t("tryAgain"));
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, setMessage, run };
}
async function base64(file: File) {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buffer.length; i += 8192)
    binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
  return btoa(binary);
}

export function IntegrationCenter({
  path = "/app/wearables",
  role = "subscriber",
  integrations = [],
}: {
  path?: string;
  role?: string;
  integrations?: any[];
}) {
  const trainer = role === "owner";
  const t = useT("connect");
  return (
    <div className="stack">
      <div className="page-heading">
        {trainer && <p className="eyebrow">{t("eyebrow")}</p>}
        <h1>
          {!trainer
            ? t("titleMember")
            : path.includes("/voice")
              ? "Your voice, with your permission."
              : path.includes("/domains")
                ? "Your coaching address."
                : t("title")}
        </h1>
        <p className="muted">{trainer ? t("intro") : t("introMember")}</p>
      </div>
      {trainer && (
        <nav className="tabs" aria-label="Integration sections">
          <a href="/trainer/integrations">Health connections</a>
          <a href="/trainer/voice">Trainer voice</a>
          <a href="/trainer/domains">Web address</a>
        </nav>
      )}
      {trainer && path.includes("/voice") ? (
        <>
          {/* Cartesia: clones made here; ElevenLabs: link an existing voice ID. */}
          <TrainerVoiceClone fallback={<VoiceEnrollment />} />
          <VoiceSessionStyle />
          <VoiceOneOnOne />
        </>
      ) : trainer && path.includes("/domains") ? (
        <WebAddressCenter
          manual={(connection) => <DomainCenter connection={connection} />}
        />
      ) : (
        <>
          <HealthConnections integrations={integrations} trainer={trainer} />
          <HealthKitSyncPanel role={role} />
        </>
      )}
    </div>
  );
}

/** Shown when the coach's wearable policy is "No wearable imports". */
export function ImportRefusedNotice({ trainer }: { trainer: boolean }) {
  const t = useT("connect");
  return (
    <p>
      <span className="badge amber">{t("notAccepted")}</span>{" "}
      {trainer ? (
        <>
          Your coaching data policy is “No wearable imports”. Change your{" "}
          <a href="/trainer/onboarding/wearables">wearable policy</a> to accept
          Apple Health exports.
        </>
      ) : (
        t("coachRefuses")
      )}
    </p>
  );
}

const DEVICE_PROVIDERS = ["whoop", "zepp"] as const;
const DEVICE_NAMES: Record<(typeof DEVICE_PROVIDERS)[number], string> = {
  whoop: "WHOOP",
  zepp: "Amazfit / Zepp",
};

function HealthConnections({
  integrations,
  trainer = false,
}: {
  integrations: any[];
  trainer?: boolean;
}) {
  const [data, setData] = useState<any>({ connections: [], imports: [] }),
    [observations, setObservations] = useState<any[]>([]),
    [consent, setConsent] = useState(false),
    [fileName, setFileName] = useState("");
  const t = useT("connect"),
    locale = useLocale(),
    toError = useErrorText();
  const connectionStatus = (status: string) =>
    [
      "active",
      "pending",
      "error",
      "revoked",
      "revocation_pending",
      "expired",
    ].includes(status)
      ? t(`status_${status}` as "status_active")
      : status.replaceAll("_", " ");
  // The coach's policy "No wearable imports" refuses export imports.
  const importsRefused = data.coachAllowsImports === false;
  const refresh = useCallback(
      async () => setData(await api("/integrations/connections")),
      [],
    ),
    action = useAction(refresh);
  useEffect(() => {
    void refresh().catch((e) => action.setMessage(toError(e)));
  }, [refresh]);
  const readFile = async (file: File) => {
    setObservations([]);
    setConsent(false);
    setFileName(file.name);
    if (file.size > 15 * 1024 * 1024) throw new Error(t("tooLarge"));
    const content = await file.text();
    if (/<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error(t("entities"));
    const xml = new DOMParser().parseFromString(content, "text/xml");
    if (xml.querySelector("parsererror")) throw new Error(t("invalidXml"));
    const rows = Array.from(xml.querySelectorAll("Record"))
      .filter((n) => n.getAttribute("value")?.trim())
      .map((n) => ({
        type: n.getAttribute("type") ?? "",
        value: Number(n.getAttribute("value")),
        unit: n.getAttribute("unit") ?? "",
        measuredAt: n.getAttribute("startDate") ?? "",
      }))
      .filter(
        (r) =>
          r.type &&
          Number.isFinite(r.value) &&
          Number.isFinite(Date.parse(r.measuredAt)),
      )
      .map((r) => ({ ...r, measuredAt: new Date(r.measuredAt).toISOString() }));
    if (!rows.length) throw new Error(t("noNumbers"));
    if (rows.length > 2000) throw new Error(t("tooMany"));
    setObservations(rows);
    action.setMessage(t("reviewFirst"));
  };
  const comingDevices = DEVICE_PROVIDERS.filter((provider) => {
    const setting = integrations.find((i) => i.id === provider);
    return (
      !(setting?.configured && setting?.approved) &&
      !data.connections.some((c: any) => c.provider === provider)
    );
  }).map((provider) => DEVICE_NAMES[provider]);
  return (
    <>
      <Notice value={action.message} />
      {/* Members see only devices they can connect; the rest is one line. */}
      {!trainer && comingDevices.length > 0 && (
        <p className="muted">
          {t("moreDevices", { devices: comingDevices.join(", ") })}
        </p>
      )}
      <div className="integration-grid">
        {DEVICE_PROVIDERS.filter(
          (provider) =>
            trainer || !comingDevices.includes(DEVICE_NAMES[provider]),
        ).map((provider) => {
          const setting = integrations.find((i) => i.id === provider),
            connection = data.connections.find(
              (c: any) => c.provider === provider,
            ),
            enabled = setting?.configured && setting?.approved;
          return (
            <Panel key={provider} title={DEVICE_NAMES[provider]}>
              <p className="muted">
                {connection
                  ? connectionStatus(connection.status)
                  : enabled
                    ? t("readyToConnect")
                    : trainer
                      ? "Awaiting provider setup and approval"
                      : t("notAvailable")}
              </p>
              {connection?.lastSyncedAt && (
                <p>
                  {t("lastSynced", {
                    when: formatWhen(connection.lastSyncedAt, { locale }),
                  })}
                  {connection.stale ? t("stale") : ""}
                </p>
              )}
              {connection?.summary?.message && (
                <p dir="auto">{connection.summary.message}</p>
              )}
              {(enabled || connection || trainer) && (
                <>
                  <p>{t("usedFor")}</p>
                  <label>
                    <input
                      type="checkbox"
                      name={`${provider}-consent`}
                      form={`${provider}-form`}
                      required
                    />{" "}
                    {t("allowImport")}
                  </label>
                  <form
                    id={`${provider}-form`}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action.run(async () => {
                        const r = await api(
                          `/integrations/${provider}/connect`,
                          "POST",
                          { consent: true },
                        );
                        window.location.assign(r.url);
                      }, t("opening"));
                    }}
                  >
                    <button
                      type="submit"
                      disabled={
                        action.busy ||
                        !enabled ||
                        connection?.status === "revocation_pending"
                      }
                    >
                      {connection ? t("reconnect") : t("connect")}
                    </button>
                    {!enabled && (
                      <p className="control-reason">
                        {trainer
                          ? "This provider is waiting for platform setup and approval."
                          : t("cannotConnect")}
                      </p>
                    )}
                  </form>
                </>
              )}
              {connection?.status === "active" && (
                <button
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      () => api(`/integrations/${provider}/sync`, "POST", {}),
                      t("synced"),
                    )
                  }
                >
                  {t("syncNow")}
                </button>
              )}
              {connection &&
                !["revoked", "revocation_pending"].includes(
                  connection.status,
                ) && (
                  <button
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(
                        () =>
                          api(`/integrations/${provider}/revoke`, "POST", {}),
                        t("revokedQueued"),
                      )
                    }
                  >
                    {t("revoke")}
                  </button>
                )}
            </Panel>
          );
        })}
      </div>
      <Panel title={t("importAppleHealth")}>
        <p>{t("importText")}</p>
        {importsRefused && <ImportRefusedNotice trainer={trainer} />}
        <FileInput
          label={t("exportLabel")}
          hint={t("exportHint")}
          buttonLabel={t("chooseExport")}
          accept=".xml,text/xml,application/xml"
          disabled={action.busy || importsRefused}
          disabledReason={importsRefused ? t("importsOff") : undefined}
          onFiles={([file]) =>
            void readFile(file).catch((error) =>
              action.setMessage(error.message),
            )
          }
        />
        {observations.length > 0 && !importsRefused && (
          <div>
            <p>
              {t("fileSummary", {
                file: fileName,
                observations: t("observations", { count: observations.length }),
                count: new Set(observations.map((r) => r.type)).size,
              })}
            </p>
            <p>
              {formatDateRange(
                Math.min(...observations.map((r) => Date.parse(r.measuredAt))),
                Math.max(...observations.map((r) => Date.parse(r.measuredAt))),
                { locale },
              )}
            </p>
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{" "}
              {t("allowReviewed")}
            </label>
            <button
              disabled={action.busy || !consent}
              onClick={() =>
                void action.run(async () => {
                  await api("/wearables/import", "POST", {
                    source: "apple_health",
                    observations,
                    consent: true,
                  });
                  setObservations([]);
                  setConsent(false);
                }, t("imported"))
              }
            >
              {t("importReviewed")}
            </button>
          </div>
        )}
      </Panel>
      <Panel title={t("importedSources")}>
        {data.imports.length ? (
          data.imports.map((source: any) => (
            <div className="list-row" key={source.source}>
              <div>
                <strong>
                  {source.source === "apple_health"
                    ? "Apple Health"
                    : source.source}
                </strong>
                <p>
                  {t("lastUpdated", {
                    observations: t("observations", {
                      count: Number(source.observations) || 0,
                    }),
                    when: formatWhen(source.latest_import, { locale }),
                  })}
                </p>
              </div>
              <button
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    () =>
                      api(`/integrations/${source.source}/revoke`, "POST", {}),
                    t("sourceRevoked"),
                  )
                }
              >
                {t("revokeUse")}
              </button>
            </div>
          ))
        ) : (
          <p className="muted">{t("noImports")}</p>
        )}
        {(data.importHistory ?? []).map((batch: any) => (
          <div className="list-row" key={batch.id}>
            <div>
              <strong>
                {batch.source === "apple_health"
                  ? t("appleExport")
                  : t("manualImport")}
              </strong>
              <p>
                {t("importedOn", {
                  observations: t("observations", {
                    count: Number(batch.observations) || 0,
                  }),
                  when: formatWhen(batch.imported_at, { locale }),
                })}
              </p>
            </div>
            <button
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  () => api(`/wearables/${batch.id}`, "DELETE"),
                  t("importDeleted"),
                )
              }
            >
              {t("deleteImport")}
            </button>
          </div>
        ))}
        <p className="muted">{t("revokeHelp")}</p>
      </Panel>
    </>
  );
}

function VoiceEnrollment() {
  const [profile, setProfile] = useState<any>(null),
    [sample, setSample] = useState<File | null>(null);
  const refresh = useCallback(
      async () => setProfile(await api("/voice/profile")),
      [],
    ),
    action = useAction(refresh);
  useEffect(() => {
    void refresh().catch((e) => action.setMessage(e.message));
  }, [refresh]);
  return (
    <>
      <Notice value={action.message} />
      <Panel title="Trainer voice enrollment">
        <p>
          Your voice can read the instructions in a client's assigned workout.
          You retain control of its use. Enrollment is reviewed for identity and
          provider rights before it becomes available.
        </p>
        <p>
          Status: <strong>{profile?.status ?? "Not enrolled"}</strong>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void action.run(async () => {
              if (sample && sample.size > 6 * 1024 * 1024)
                throw new Error("Use an MP3 or WAV sample under 6 MB.");
              await api("/voice/profile", "POST", {
                revision: profile?.version ?? 0,
                providerVoiceId: form.get("providerVoiceId"),
                voiceKind: form.get("voiceKind"),
                creatorVerified: form.get("creatorVerified") === "on",
                statement: form.get("statement"),
                consent: true,
                rights: true,
                ...(sample
                  ? {
                      sample: {
                        base64: await base64(sample),
                        type: sample.name.toLowerCase().endsWith(".wav")
                          ? "audio/wav"
                          : "audio/mpeg",
                      },
                    }
                  : {}),
              });
            }, "Voice enrollment submitted for identity and rights review");
          }}
        >
          <label>
            Provider voice ID
            <input
              name="providerVoiceId"
              defaultValue={profile?.providerVoiceId ?? ""}
              required
              maxLength={100}
              pattern="[A-Za-z0-9_-]+"
            />
          </label>
          <p className="muted">
            Use an existing voice from the approved ElevenLabs account. With
            ElevenLabs the app does not make the clone; when the platform uses
            Cartesia you record your voice here instead.
          </p>
          <label>
            Voice type
            <select
              name="voiceKind"
              defaultValue={profile?.evidence?.voiceKind ?? "professional"}
            >
              <option value="professional">Professional clone</option>
              <option value="instant">Instant clone</option>
            </select>
          </label>
          <label>
            <input type="checkbox" name="creatorVerified" required /> This is my
            own voice. For a professional clone, I created and identity-verified
            it in my own provider account and shared it for this use.
          </label>
          <label>
            Rights statement
            <textarea
              name="statement"
              required
              minLength={20}
              maxLength={2000}
              defaultValue={profile?.evidence?.rightsStatement ?? ""}
              placeholder="Confirm that this is your own voice and describe your permission for assigned workout guidance."
            />
          </label>
          <label>
            Optional identity sample
            <input
              type="file"
              accept="audio/mpeg,audio/wav,.mp3,.wav"
              onChange={(e) => setSample(e.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            <input type="checkbox" required /> I own or control the rights to
            this voice and the submitted sample.
          </label>
          <label>
            <input type="checkbox" required /> I consent to its use for premium
            assigned workout guidance until I revoke it.
          </label>
          <button disabled={action.busy}>Submit voice for review</button>
        </form>
        {profile && profile.status !== "revoked" && (
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(
                () => api("/voice/revoke", "POST", {}),
                "Voice generation and stored playback revoked",
              )
            }
          >
            Revoke voice permission
          </button>
        )}
        <p className="muted">
          Revocation stops this app's use immediately. Remove the voice
          separately from the provider account if you also want the
          provider-side clone removed.
        </p>
      </Panel>
    </>
  );
}

function DomainCenter({
  connection,
}: {
  connection?: WebAddressState["connection"];
}) {
  const [orders, setOrders] = useState<any[]>([]),
    refresh = useCallback(async () => setOrders(await api("/domains")), []),
    action = useAction(refresh);
  useEffect(() => {
    void refresh().catch((e) => action.setMessage(e.message));
  }, [refresh]);
  return (
    <>
      <Notice value={action.message} />
      {action.message && (
        <button
          type="button"
          disabled={action.busy}
          onClick={() => void action.run(refresh, "Address status refreshed.")}
        >
          Refresh status
        </button>
      )}
      <Panel title="Connect a custom domain">
        <p>
          Your existing coaching address continues to work while your domain is
          prepared.
        </p>
        {!connection?.enabled ? (
          <p className="muted">
            Domain connections are not enabled yet. Your platform address
            continues to work.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void action.run(
                () =>
                  api("/domains", "POST", {
                    hostname: f.get("hostname"),
                    alreadyOwned: true,
                    includeWww: f.get("www") === "on",
                  }),
                "Domain request saved",
              );
            }}
          >
            <label>
              Domain
              <input
                name="hostname"
                placeholder="coach.example.com"
                required
                maxLength={253}
              />
            </label>
            <label>
              <input name="owned" type="checkbox" required /> I own this domain
              and can edit its DNS.
            </label>
            <label>
              <input name="www" type="checkbox" /> Also connect www and redirect
              it here.
            </label>
            <button disabled={action.busy}>Add domain</button>
          </form>
        )}
      </Panel>
      {orders.map((order) => (
        <Panel key={order.id} title={order.hostname}>
          <p>
            Status: <strong>{order.status}</strong>
            {order.expires_at
              ? ` · Expires ${new Date(order.expires_at).toLocaleDateString()}`
              : ""}
          </p>
          {order.health && <p role="status">{order.health.message}</p>}
          {order.reservationExpiresAt &&
            !["active", "expired", "cancelled"].includes(order.status) && (
              <p className="muted">
                Complete setup by{" "}
                {new Date(order.reservationExpiresAt).toLocaleDateString()}.
                Unverified requests do not reserve the domain.
              </p>
            )}
          {order.quote && (
            <p>
              Registration: {(order.quote.amountMinor / 100).toFixed(2)}{" "}
              {order.quote.currency} for {order.quote.termMonths} months.
              Renewal estimate: {(order.quote.renewalMinor / 100).toFixed(2)}{" "}
              {order.quote.currency}. Quote expires{" "}
              {new Date(order.quote.expiresAt).toLocaleString()}.
            </p>
          )}
          {order.status === "requested" && (
            <p>
              The platform team will send you an exact price for your approval.
            </p>
          )}
          {order.status === "quoted" && (
            <button
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  () =>
                    api(`/domains/${order.id}/approve`, "POST", {
                      revision: order.version,
                      amountMinor: order.quote.amountMinor,
                      currency: order.quote.currency,
                      accepted: true,
                    }),
                  "Exact-price quote approved; registration awaits operator reconciliation",
                )
              }
            >
              Approve this exact quote
            </button>
          )}
          {order.status === "approved" && (
            <p>
              Your quote is approved. Registration and its payment evidence will
              be confirmed by the platform operator.
            </p>
          )}
          {["owned", "verified"].includes(order.status) && (
            <>
              <p>
                Add these records at your DNS provider. Use the full hostname,
                or @ when your provider asks for the root name. Keep email
                records unchanged.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Name</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      order.hostname,
                      ...(order.includeWww ? ["www." + order.hostname] : []),
                    ].map((host) => (
                      <tr key={host}>
                        <td>{connection?.ipv4 ? "A" : "CNAME"}</td>
                        <td>{host}</td>
                        <td>
                          {connection?.ipv4 ||
                            connection?.cname ||
                            "Platform setup pending"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Remove conflicting A/AAAA records for these names. A root domain
                needs A records or CNAME flattening. DNS updates may take up to
                48 hours.
              </p>
              <p>Add this ownership TXT record:</p>
              <dl>
                <dt>Name</dt>
                <dd>
                  <code>_trainer-verify.{order.hostname}</code>{" "}
                  <button
                    type="button"
                    onClick={() =>
                      void action.run(
                        () =>
                          navigator.clipboard.writeText(
                            `_trainer-verify.${order.hostname}`,
                          ),
                        "Record name copied.",
                      )
                    }
                  >
                    Copy name
                  </button>
                </dd>
                <dt>Value</dt>
                <dd style={{ overflowWrap: "anywhere" }}>
                  <code>trainer-verification={order.token}</code>{" "}
                  <button
                    type="button"
                    onClick={() =>
                      void action.run(
                        () =>
                          navigator.clipboard.writeText(
                            `trainer-verification=${order.token}`,
                          ),
                        "TXT value copied.",
                      )
                    }
                  >
                    Copy value
                  </button>
                </dd>
              </dl>
              <button
                disabled={action.busy || !connection?.enabled}
                onClick={() =>
                  void action.run(async () => {
                    try {
                      const verified =
                        order.status === "verified"
                          ? order
                          : await api(`/domains/${order.id}/verify`, "POST", {
                              revision: order.version,
                            });
                      await api(`/domains/${order.id}/connect`, "POST", {
                        revision: verified.version,
                      });
                    } finally {
                      await refresh();
                    }
                  }, "Connection checked. Website verification status is shown above.")
                }
              >
                Verify and connect
              </button>
            </>
          )}
          {order.status === "active" && (
            <a
              href={`https://${order.hostname}`}
              target="_blank"
              rel="noreferrer"
            >
              Open your coaching website
            </a>
          )}
          {!["cancelled", "expired"].includes(order.status) && (
            <button
              disabled={action.busy}
              onClick={() => {
                if (
                  !window.confirm(
                    `Disconnect ${order.hostname}? Visitors will need your platform address. This does not cancel registration at your domain provider.`,
                  )
                )
                  return;
                void action.run(
                  () =>
                    api(`/domains/${order.id}/cancel`, "POST", {
                      revision: order.version,
                    }),
                  order.alreadyOwned
                    ? "Domain disconnected; your registration is not affected."
                    : "Domain disconnected",
                );
              }}
            >
              Disconnect domain
            </button>
          )}
        </Panel>
      ))}
    </>
  );
}

export function IntegrationOperations() {
  const [voices, setVoices] = useState<any[]>([]),
    [domains, setDomains] = useState<any[]>([]);
  const refresh = useCallback(async () => {
      const [v, d] = await Promise.all([
        api("/admin/integrations/voices"),
        api("/admin/integrations/domains"),
      ]);
      setVoices(v);
      setDomains(d);
    }, []),
    action = useAction(refresh);
  useEffect(() => {
    void refresh().catch((e) => action.setMessage(e.message));
  }, [refresh]);
  return (
    <div className="stack">
      <div className="page-heading">
        <h1>Voice and domain operations</h1>
        <p>
          Record account-specific evidence before activating trainer
          capabilities. Recent administrator MFA is required.
        </p>
      </div>
      <Notice value={action.message} />
      <WebAddressOperations />
      <VoiceCloneOperations />
      {voices.map((voice) => (
        <Panel title={`${voice.name} · Voice ${voice.status}`} key={voice.id}>
          <p>{voice.evidence.rightsStatement}</p>
          <p>
            Provider: {voice.provider ?? "elevenlabs"}
            {voice.clone_id ? " (clone made in the app)" : ""}. Provider voice
            ID: <code>{voice.provider_voice_id}</code>
          </p>
          {voice.has_sample && (
            <a
              href={`/api/v1/admin/integrations/voices/${voice.id}/sample`}
              target="_blank"
              rel="noreferrer"
            >
              Open private identity sample
            </a>
          )}
          {voice.status === "pending" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action.run(
                  () =>
                    api(
                      `/admin/integrations/voices/${voice.id}/verify`,
                      "POST",
                      {
                        revision: voice.version,
                        evidence: f.get("evidence"),
                        ownerIdentityVerified: true,
                        providerRightsVerified: true,
                      },
                    ),
                  "Voice identity and rights verification recorded",
                );
              }}
            >
              <label>
                Verification evidence
                <textarea
                  name="evidence"
                  required
                  minLength={20}
                  maxLength={2000}
                />
              </label>
              <label>
                <input type="checkbox" required /> I verified the trainer's
                identity and ownership of the voice.
              </label>
              <label>
                <input type="checkbox" required /> I verified the provider
                account rights and permitted use.
              </label>
              <button disabled={action.busy}>Verify trainer voice</button>
            </form>
          )}
        </Panel>
      ))}
      {domains.map((order) => (
        <Panel
          title={`${order.tenant_name} · ${order.hostname}`}
          key={order.id}
        >
          <p>
            Status: <strong>{order.status}</strong>
          </p>
          {["requested", "quoted"].includes(order.status) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action.run(
                  () =>
                    api(
                      `/admin/integrations/domains/${order.id}/quote`,
                      "POST",
                      {
                        revision: order.version,
                        amountMinor: Math.round(Number(f.get("amount")) * 100),
                        renewalMinor: Math.round(
                          Number(f.get("renewal")) * 100,
                        ),
                        currency: f.get("currency"),
                        termMonths: Number(f.get("term")),
                        expiresAt: new Date(
                          String(f.get("expires")),
                        ).toISOString(),
                        providerReference: f.get("reference"),
                      },
                    ),
                  "Registrar quote ready for trainer approval",
                );
              }}
            >
              <label>
                Exact registration amount
                <input
                  name="amount"
                  type="number"
                  min="0"
                  max="10000"
                  step=".01"
                  required
                />
              </label>
              <label>
                Currency
                <select name="currency">
                  <option>AED</option>
                  <option>USD</option>
                </select>
              </label>
              <label>
                Renewal estimate
                <input
                  name="renewal"
                  type="number"
                  min="0"
                  step=".01"
                  required
                />
              </label>
              <label>
                Term in months
                <input
                  name="term"
                  type="number"
                  min="1"
                  max="120"
                  defaultValue="12"
                  required
                />
              </label>
              <label>
                Quote expiry
                <input name="expires" type="datetime-local" required />
              </label>
              <label>
                Registrar quote reference
                <input
                  name="reference"
                  required
                  minLength={3}
                  maxLength={300}
                />
              </label>
              <button disabled={action.busy}>Record quote</button>
            </form>
          )}
          {order.status === "approved" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action.run(
                  () =>
                    api(
                      `/admin/integrations/domains/${order.id}/ownership`,
                      "POST",
                      {
                        revision: order.version,
                        registrarReference: f.get("reference"),
                        paymentEvidence: f.get("evidence"),
                        expiresAt: new Date(
                          String(f.get("expires")),
                        ).toISOString(),
                      },
                    ),
                  "Registration and payment evidence recorded",
                );
              }}
            >
              <label>
                Registrar confirmation
                <input
                  name="reference"
                  required
                  minLength={3}
                  maxLength={300}
                />
              </label>
              <label>
                Payment evidence
                <textarea
                  name="evidence"
                  required
                  minLength={10}
                  maxLength={1000}
                />
              </label>
              <label>
                Registration expiry
                <input name="expires" type="datetime-local" required />
              </label>
              <button disabled={action.busy}>
                Reconcile completed registration
              </button>
            </form>
          )}
          {order.status === "verified" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action.run(
                  () =>
                    api(
                      `/admin/integrations/domains/${order.id}/activate`,
                      "POST",
                      {
                        revision: order.version,
                        dnsTarget: f.get("target"),
                        registrarReference: f.get("reference"),
                        expiresAt: new Date(
                          String(f.get("expires")),
                        ).toISOString(),
                      },
                    ),
                  "DNS, TLS and ownership verified; domain activated",
                );
              }}
            >
              <label>
                Approved CNAME target
                <input name="target" required />
              </label>
              <label>
                Registrar evidence reference
                <input
                  name="reference"
                  required
                  minLength={3}
                  maxLength={300}
                />
              </label>
              <label>
                Registration expiry
                <input name="expires" type="datetime-local" required />
              </label>
              <button disabled={action.busy}>
                Verify DNS and TLS, then activate
              </button>
            </form>
          )}
          {["active", "expired"].includes(order.status) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action.run(
                  () =>
                    api(
                      `/admin/integrations/domains/${order.id}/renew`,
                      "POST",
                      {
                        revision: order.version,
                        evidence: f.get("evidence"),
                        expiresAt: new Date(
                          String(f.get("expires")),
                        ).toISOString(),
                      },
                    ),
                  "Renewal evidence recorded",
                );
              }}
            >
              <label>
                New registration expiry
                <input name="expires" type="datetime-local" required />
              </label>
              <label>
                Registrar renewal evidence
                <textarea
                  name="evidence"
                  required
                  minLength={20}
                  maxLength={1000}
                />
              </label>
              <button disabled={action.busy}>Reconcile renewal</button>
            </form>
          )}
        </Panel>
      ))}
      {!voices.length && !domains.length && (
        <Panel title="No pending requests">
          <p>Trainer voice enrollments and domain requests will appear here.</p>
        </Panel>
      )}
    </div>
  );
}
