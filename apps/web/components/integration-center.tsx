"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
function Panel({ title, children }: { title: string; children: ReactNode }) {
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
  const run = async (fn: () => Promise<unknown>, success = "Saved") => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await refresh();
      setMessage(success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Please try again.");
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
  if (path.includes("/guided/"))
    return <GuidedSession workoutId={path.split("/").at(-1) ?? ""} />;
  return (
    <div className="stack">
      <div className="page-heading">
        <p className="eyebrow">CONNECTIONS</p>
        <h1>
          {path.includes("/voice")
            ? "Your voice, with your permission."
            : path.includes("/domains")
              ? "Your coaching address."
              : "Connections you control."}
        </h1>
        <p className="muted">
          Choose what you share and see the status of each connection.
        </p>
      </div>
      {trainer && (
        <nav className="tabs" aria-label="Integration sections">
          <a href="/trainer/integrations">Health connections</a>
          <a href="/trainer/voice">Trainer voice</a>
          <a href="/trainer/domains">Custom domains</a>
        </nav>
      )}
      {trainer && path.includes("/voice") ? (
        <VoiceEnrollment />
      ) : trainer && path.includes("/domains") ? (
        <DomainCenter />
      ) : (
        <HealthConnections integrations={integrations} />
      )}
    </div>
  );
}

function HealthConnections({ integrations }: { integrations: any[] }) {
  const [data, setData] = useState<any>({ connections: [], imports: [] }),
    [observations, setObservations] = useState<any[]>([]),
    [consent, setConsent] = useState(false),
    [fileName, setFileName] = useState("");
  const refresh = useCallback(
      async () => setData(await api("/integrations/connections")),
      [],
    ),
    action = useAction(refresh);
  useEffect(() => {
    void refresh().catch((e) => action.setMessage(e.message));
  }, [refresh]);
  const readFile = async (file: File) => {
    setObservations([]);
    setConsent(false);
    setFileName(file.name);
    if (file.size > 15 * 1024 * 1024)
      throw new Error("Choose an Apple Health export under 15 MB.");
    const content = await file.text();
    if (/<!DOCTYPE|<!ENTITY/i.test(content))
      throw new Error(
        "Exports with document entities are not accepted. Export a fresh Apple Health file.",
      );
    const xml = new DOMParser().parseFromString(content, "text/xml");
    if (xml.querySelector("parsererror"))
      throw new Error("This file is not valid Apple Health XML.");
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
    if (!rows.length)
      throw new Error("No numeric health observations were found.");
    if (rows.length > 2000)
      throw new Error(
        "Select an export with at most 2,000 numeric observations. Nothing has been imported.",
      );
    setObservations(rows);
    action.setMessage(
      "Review the export and give permission before importing.",
    );
  };
  return (
    <>
      <Notice value={action.message} />
      <div className="integration-grid">
        {["whoop", "zepp"].map((provider) => {
          const setting = integrations.find((i) => i.id === provider),
            connection = data.connections.find(
              (c: any) => c.provider === provider,
            ),
            enabled = setting?.configured && setting?.approved;
          return (
            <Panel
              key={provider}
              title={provider === "whoop" ? "WHOOP" : "Amazfit / Zepp"}
            >
              <p className="muted">
                {connection?.status ??
                  (enabled
                    ? "Ready to connect"
                    : "Awaiting provider setup and approval")}
              </p>
              {connection?.lastSyncedAt && (
                <p>
                  Last synchronized{" "}
                  {new Date(connection.lastSyncedAt).toLocaleString()}
                  {connection.stale ? " · Stale data" : ""}
                </p>
              )}
              {connection?.summary?.message && (
                <p>{connection.summary.message}</p>
              )}
              <p>
                Used to display health observations and calculate deterministic
                coaching indicators. Excluded from AI prompts and advertising.
              </p>
              <label>
                <input
                  type="checkbox"
                  name={`${provider}-consent`}
                  form={`${provider}-form`}
                  required
                />{" "}
                I allow this coaching workspace to import and use the approved
                observations.
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
                  }, "Opening provider authorization…");
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
                  {connection ? "Reconnect" : "Connect"}
                </button>
              </form>
              {connection?.status === "active" && (
                <button
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      () => api(`/integrations/${provider}/sync`, "POST", {}),
                      "Observations synchronized",
                    )
                  }
                >
                  Sync now
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
                        "Local access stopped; provider revocation queued",
                      )
                    }
                  >
                    Revoke connection
                  </button>
                )}
            </Panel>
          );
        })}
      </div>
      <Panel title="Import Apple Health">
        <p>
          Choose export.xml, review the coverage and give explicit permission.
          Supported numeric observations retain their source, unit and
          measurement time.
        </p>
        <input
          type="file"
          accept=".xml"
          aria-label="Apple Health export XML"
          disabled={action.busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void readFile(file).catch((error) =>
                action.setMessage(error.message),
              );
          }}
        />
        {observations.length > 0 && (
          <div>
            <p>
              {fileName} · {observations.length.toLocaleString()} observations ·{" "}
              {new Set(observations.map((r) => r.type)).size} categories
            </p>
            <p>
              {new Date(
                Math.min(...observations.map((r) => Date.parse(r.measuredAt))),
              ).toLocaleDateString()}{" "}
              –{" "}
              {new Date(
                Math.max(...observations.map((r) => Date.parse(r.measuredAt))),
              ).toLocaleDateString()}
            </p>
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{" "}
              I allow this workspace to import these observations for display
              and deterministic coaching indicators. They will not be used for
              model prompts or advertising.
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
                }, "Health export imported")
              }
            >
              Import reviewed observations
            </button>
          </div>
        )}
      </Panel>
      <Panel title="Imported sources">
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
                  {source.observations} observations · Last updated{" "}
                  {new Date(source.latest_import).toLocaleString()}
                </p>
              </div>
              <button
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    () =>
                      api(`/integrations/${source.source}/revoke`, "POST", {}),
                    "Source use revoked",
                  )
                }
              >
                Revoke use
              </button>
            </div>
          ))
        ) : (
          <p className="muted">No active imported observations.</p>
        )}
        <p className="muted">
          Revoking stops further use. Request an export or deletion from your
          privacy settings.
        </p>
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
            Use an existing voice from the approved provider account. The app
            does not create a voice clone automatically.
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

export function GuidedSession({ workoutId }: { workoutId: string }) {
  const [data, setData] = useState<any>(null),
    [index, setIndex] = useState(0),
    [rest, setRest] = useState(0),
    [running, setRunning] = useState(false),
    [audioUrl, setAudioUrl] = useState<string | null>(null),
    [voiceConsent, setVoiceConsent] = useState(false),
    [paused, setPaused] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const refresh = useCallback(
      async () => setData(await api(`/guided/${workoutId}`)),
      [workoutId],
    ),
    action = useAction(refresh);
  useEffect(() => {
    const read = () =>
      void refresh().catch((e) => {
        action.setMessage(e.message);
        setPaused(true);
        setRunning(false);
        player.current?.pause();
      });
    read();
    const timer = setInterval(read, 10000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!running || rest <= 0 || paused) return;
    const deadline = Date.now() + rest * 1000,
      timer = setInterval(() => {
        const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        setRest(seconds);
        if (!seconds) setRunning(false);
      }, 250);
    return () => clearInterval(timer);
  }, [running, paused]);
  const segment = data?.segments?.[index];
  return (
    <div className="stack">
      <div className="page-heading">
        <h1>{data?.name ?? "Guided workout"}</h1>
        <p>
          {data?.warning ??
            "Follow your assigned workout and stop if you experience pain or dizziness."}
        </p>
      </div>
      <Notice value={action.message} />
      {segment && (
        <Panel
          title={`${index + 1} of ${data.segments.length} · ${segment.name}`}
        >
          <p>{segment.text}</p>
          <p className="metric-value" aria-live="polite">
            {rest > 0
              ? `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, "0")}`
              : "Ready"}
          </p>
          <button
            disabled={paused}
            onClick={() => {
              setRunning(false);
              setRest(segment.restSeconds);
              setTimeout(() => setRunning(true), 0);
            }}
          >
            Start rest timer
          </button>
          <button
            onClick={() => setRunning(!running)}
            disabled={paused || rest <= 0}
          >
            {running ? "Pause timer" : "Resume timer"}
          </button>
          <div className="button-row">
            <button
              disabled={paused || index === 0}
              onClick={() => {
                setIndex(index - 1);
                setRunning(false);
                setRest(0);
                setAudioUrl(null);
              }}
            >
              Previous exercise
            </button>
            <button
              disabled={paused || index >= data.segments.length - 1}
              onClick={() => {
                setIndex(index + 1);
                setRunning(false);
                setRest(0);
                setAudioUrl(null);
              }}
            >
              Next exercise
            </button>
          </div>
          <hr />
          {data.audioAvailable ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={voiceConsent}
                  onChange={(e) => setVoiceConsent(e.target.checked)}
                />{" "}
                I want this workout instruction read in my trainer's approved
                voice.
              </label>
              <button
                disabled={action.busy || paused || !voiceConsent}
                onClick={() =>
                  void action.run(async () => {
                    const r = await api(`/guided/${workoutId}/audio`, "POST", {
                      segment: index,
                      consent: true,
                    });
                    setAudioUrl(r.audioUrl);
                    if (!r.audioUrl)
                      throw new Error(
                        r.message ??
                          "Audio is awaiting review. Written instructions remain available.",
                      );
                  }, "Trainer voice is ready")
                }
              >
                Prepare trainer voice
              </button>
              {audioUrl && (
                <audio ref={player} controls src={audioUrl} preload="none" />
              )}
            </>
          ) : (
            <p className="muted">
              Written guidance is included. Trainer voice requires verified
              enrollment and a membership with premium voice access.
            </p>
          )}
        </Panel>
      )}
      <Panel title="Stop or report a problem">
        <button
          onClick={() => {
            setPaused(true);
            setRunning(false);
            player.current?.pause();
          }}
        >
          Pause this guide
        </button>
        <a className="text-link" href={`/app/workouts/${workoutId}`}>
          Open workout logging
        </a>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const description = new FormData(e.currentTarget).get(
              "description",
            );
            setPaused(true);
            setRunning(false);
            player.current?.pause();
            void action.run(
              () => api(`/workouts/${workoutId}/pain`, "POST", { description }),
              "Workout paused and your coach notified",
            );
          }}
        >
          <label>
            Pain or a safety concern
            <textarea
              name="description"
              required
              minLength={3}
              maxLength={2000}
            />
          </label>
          <button disabled={action.busy}>Stop workout and notify coach</button>
        </form>
      </Panel>
    </div>
  );
}

function DomainCenter() {
  const [orders, setOrders] = useState<any[]>([]),
    refresh = useCallback(async () => setOrders(await api("/domains")), []),
    action = useAction(refresh);
  useEffect(() => {
    void refresh().catch((e) => action.setMessage(e.message));
  }, [refresh]);
  return (
    <>
      <Notice value={action.message} />
      <Panel title="Connect a custom domain">
        <p>
          Your existing coaching address continues to work while your domain is
          prepared.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action.run(
              () =>
                api("/domains", "POST", {
                  hostname: f.get("hostname"),
                  alreadyOwned: f.get("owned") === "on",
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
            <input name="owned" type="checkbox" /> I already own this domain.
          </label>
          <button disabled={action.busy}>Add domain</button>
        </form>
      </Panel>
      {orders.map((order) => (
        <Panel key={order.id} title={order.hostname}>
          <p>
            Status: <strong>{order.status}</strong>
            {order.expires_at
              ? ` · Expires ${new Date(order.expires_at).toLocaleDateString()}`
              : ""}
          </p>
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
              A platform operator will obtain an exact registrar quote for your
              approval.
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
              <p>Add this TXT record at your DNS provider:</p>
              <dl>
                <dt>Name</dt>
                <dd>
                  <code>_trainer-verify.{order.hostname}</code>
                </dd>
                <dt>Value</dt>
                <dd style={{ overflowWrap: "anywhere" }}>
                  <code>trainer-verification={order.token}</code>
                </dd>
              </dl>
              <button
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    () =>
                      api(`/domains/${order.id}/verify`, "POST", {
                        revision: order.version,
                      }),
                    "Ownership verified; DNS and TLS activation awaits the operator",
                  )
                }
              >
                Check ownership
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
              onClick={() =>
                void action.run(
                  () =>
                    api(`/domains/${order.id}/cancel`, "POST", {
                      revision: order.version,
                    }),
                  "Domain disconnected; registrar registration remains yours",
                )
              }
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
      {voices.map((voice) => (
        <Panel title={`${voice.name} · Voice ${voice.status}`} key={voice.id}>
          <p>{voice.evidence.rightsStatement}</p>
          <p>
            Provider voice ID: <code>{voice.provider_voice_id}</code>
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
