"use client";
import { useCallback, useEffect, useState } from "react";

// Automatic Apple Health sync through the HealthKit companion app. The
// companion app itself is separate native work; these screens let a member
// pair it, see its status, disconnect it and delete what it synchronized.
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.message ?? "The request could not be completed.");
  return data;
}
const when = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "Never";
const rowStyle = { flexWrap: "wrap" as const, rowGap: 10 };
const codeStyle = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 24,
  letterSpacing: "0.12em",
  paddingBlock: 8,
  paddingInline: 12,
  overflowWrap: "anywhere" as const,
};

export type Device = {
  id: string;
  name: string;
  platform: string;
  status: string;
  revokedReason: string | null;
  pairedAt: string;
  lastSyncAt: string | null;
  samplesReceived: number;
  lastErrorCode: string | null;
};
export type Status = {
  available: boolean;
  code: string | null;
  message: string;
  coachAllowsSync: boolean;
  consent: boolean;
  wearablePermissionWithdrawn: boolean;
  devices: Device[];
  synced: { days: number; observations: number; last_sync_at: string | null };
  pendingCodeExpiresAt: string | null;
  server: string;
};
const reasons: Record<string, string> = {
  member: "Disconnected by you",
  device: "Disconnected from the app",
  consent: "Wearable permission withdrawn",
  source_revoked: "Apple Health use revoked",
  membership_ended: "Membership ended",
};
const errors: Record<string, string> = {
  HEALTHKIT_POLICY: "Paused: your coach has turned automatic sync off.",
  CONSENT_REQUIRED: "Paused: permission was withdrawn.",
  MEMBERSHIP_ENDED: "Paused: membership is not active.",
  DAILY_QUOTA: "Paused until tomorrow: daily upload allowance reached.",
  HEALTHKIT_SYNC_DISABLED: "Paused: sync is turned off for the platform.",
  IMPORT_REVIEW_PENDING: "Paused: health imports await platform approval.",
  APPLE_IMPORTS_DISABLED: "Paused: Apple Health imports are disabled.",
};

type Pairing = { code: string; expiresAt: string; server: string };
export function HealthKitSyncPanel({ role = "subscriber" }: { role?: string }) {
  const [status, setStatus] = useState<Status | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [pairing, setPairing] = useState<Pairing | null>(null);
  const refresh = useCallback(async () => {
    setStatus(await api("/healthkit/status"));
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, [refresh]);
  const run = async (fn: () => Promise<unknown>, success: string) => {
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
  return (
    <HealthKitSyncView
      status={status}
      role={role}
      message={message}
      busy={busy}
      consent={consent}
      pairing={pairing}
      onConsent={setConsent}
      onCreate={() =>
        void run(async () => {
          setPairing(
            await api("/healthkit/pairing-codes", "POST", { consent: true }),
          );
          setConsent(false);
        }, "Pairing code created. It works once, for 10 minutes.")
      }
      onCancel={() =>
        void run(async () => {
          await api("/healthkit/pairing-codes/cancel", "POST", {});
          setPairing(null);
        }, "Pairing code cancelled.")
      }
      onDisconnect={(d) => {
        if (
          window.confirm(
            `Disconnect ${d.name}? It will stop sending Apple Health data.`,
          )
        )
          void run(
            () => api(`/healthkit/devices/${d.id}/revoke`, "POST", {}),
            "Device disconnected. Synced data stays until you delete it or revoke its use.",
          );
      }}
      onDelete={() => {
        if (
          window.confirm(
            "Delete all Apple Health data synced from your devices? This cannot be undone. Exported files you imported yourself are not affected.",
          )
        )
          void run(
            () => api("/healthkit/data/delete", "POST", { confirm: true }),
            "Synced Apple Health data deleted.",
          );
      }}
    />
  );
}

/** Presentational states of the sync panel; the panel above supplies data. */
export function HealthKitSyncView({
  status,
  role,
  message,
  busy,
  consent,
  pairing,
  onConsent,
  onCreate,
  onCancel,
  onDisconnect,
  onDelete,
}: {
  status: Status | null;
  role: string;
  message: string;
  busy: boolean;
  consent: boolean;
  pairing: Pairing | null;
  onConsent: (value: boolean) => void;
  onCreate: () => void;
  onCancel: () => void;
  onDisconnect: (device: Device) => void;
  onDelete: () => void;
}) {
  const active = status?.devices.filter((d) => d.status === "active") ?? [];
  const past = status?.devices.filter((d) => d.status !== "active") ?? [];
  const full = active.length >= 5;
  return (
    <section className="card" aria-labelledby="healthkit-sync-title">
      <h2 id="healthkit-sync-title">Automatic Apple Health sync</h2>
      <p className="muted">
        Pair the companion iPhone app to send workouts, heart rate, heart-rate
        variability, resting heart rate, sleep, steps, active energy and body
        mass in the background. Data is used for display and deterministic
        coaching indicators only, never for AI prompts or advertising.
      </p>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {!status ? (
        <p className="muted">Loading sync status…</p>
      ) : !status.available ? (
        <p>
          <span className="badge amber">Not available</span> {status.message}
        </p>
      ) : !status.coachAllowsSync ? (
        <p>
          <span className="badge amber">Not enabled</span>{" "}
          {role === "owner" ? (
            <>
              Choose “Allow permitted imports and Apple Health sync” in your{" "}
              <a href="/trainer/onboarding/wearables">wearable policy</a> to let
              clients connect.
            </>
          ) : (
            "Your coach has not enabled automatic Apple Health sync. You can still import an Apple Health export file."
          )}
        </p>
      ) : status.wearablePermissionWithdrawn ? (
        <p>
          <span className="badge amber">Permission withdrawn</span> You withdrew
          wearable permission. Grant it again in your privacy settings before
          connecting Apple Health.
        </p>
      ) : (
        <div>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => onConsent(e.target.checked)}
            />{" "}
            I allow this coaching workspace to receive my Apple Health data from
            paired devices until I disconnect them or revoke Apple Health use.
          </label>
          <div className="button-row">
            <button
              type="button"
              className="button"
              disabled={busy || !consent || full}
              onClick={onCreate}
            >
              Create pairing code
            </button>
            {(pairing || status.pendingCodeExpiresAt) && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={onCancel}
              >
                Cancel code
              </button>
            )}
          </div>
          {full && (
            <p className="muted">
              Five devices are connected. Disconnect one to pair another.
            </p>
          )}
          {pairing && (
            <div aria-live="polite">
              <p className="small-label">PAIRING CODE</p>
              <p style={codeStyle}>
                <strong>{pairing.code}</strong>
              </p>
              <p>
                In the companion app, enter the server address{" "}
                <code style={{ overflowWrap: "anywhere" }}>
                  {pairing.server}
                </code>{" "}
                and this code before{" "}
                {new Date(pairing.expiresAt).toLocaleTimeString()}. Never share
                it; anyone with the code can add a device to your account.
              </p>
            </div>
          )}
        </div>
      )}
      {status && (active.length > 0 || past.length > 0) && (
        <div>
          <h3>Paired devices</h3>
          {[...active, ...past].map((d) => (
            <div className="list-row" key={d.id} style={rowStyle}>
              <div>
                <strong>{d.name}</strong>{" "}
                <span
                  className={"badge" + (d.status === "active" ? " green" : "")}
                >
                  {d.status === "active" ? "Connected" : "Disconnected"}
                </span>
                <p>
                  Paired {when(d.pairedAt)} · Last sync {when(d.lastSyncAt)} ·{" "}
                  {d.samplesReceived.toLocaleString()} entries
                </p>
                {d.status === "active" && d.lastErrorCode && (
                  <p className="muted">
                    {errors[d.lastErrorCode] ?? "The last upload was refused."}
                  </p>
                )}
                {d.status !== "active" && d.revokedReason && (
                  <p className="muted">{reasons[d.revokedReason]}</p>
                )}
              </div>
              {d.status === "active" && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  aria-label={`Disconnect ${d.name}`}
                  onClick={() => onDisconnect(d)}
                >
                  Disconnect
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {status && status.synced.days > 0 && (
        <div className="list-row" style={rowStyle}>
          <div>
            <strong>Synced data</strong>
            <p>
              {status.synced.days} days · {status.synced.observations} derived
              observations · Updated {when(status.synced.last_sync_at)}
            </p>
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onDelete}
          >
            Delete synced data
          </button>
        </div>
      )}
    </section>
  );
}

export type Day = {
  day: string;
  steps: number | null;
  activeEnergyKcal: number | null;
  sleepMinutes: number | null;
  workoutMinutes: number | null;
  workouts: Array<{ activity: string; minutes: number }>;
  restingHeartRate: number | null;
  hrvMs: number | null;
  bodyMassKg: number | null;
};
const hours = (minutes: number) =>
  `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
const activityName = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export function dayLine(d: Day) {
  return [
    d.steps !== null && `${Math.round(d.steps).toLocaleString()} steps`,
    d.activeEnergyKcal !== null &&
      `${Math.round(d.activeEnergyKcal).toLocaleString()} kcal active`,
    d.sleepMinutes !== null && `${hours(d.sleepMinutes)} asleep`,
    ...d.workouts.map(
      (w) => `${activityName(w.activity)} ${Math.round(w.minutes)} min`,
    ),
    d.restingHeartRate !== null &&
      `resting heart rate ${Math.round(d.restingHeartRate)} bpm`,
    d.hrvMs !== null && `HRV ${d.hrvMs} ms`,
    d.bodyMassKg !== null && `${d.bodyMassKg} kg`,
  ]
    .filter(Boolean)
    .join(" · ");
}
/** Recent synced activity for the Progress page (member or coach view). */
export function HealthKitActivityCard({ userId }: { userId?: string }) {
  const [data, setData] = useState<ActivityData | null>(null);
  useEffect(() => {
    let current = true;
    setData(null);
    if (!userId) return;
    api(`/healthkit/activity?days=14&userId=${encodeURIComponent(userId)}`)
      .then((result) => current && setData(result))
      .catch(() => current && setData(null));
    return () => {
      current = false;
    };
  }, [userId]);
  return data ? <HealthKitActivityList {...data} /> : null;
}
type ActivityData = {
  days: Day[];
  lastSyncAt: string | null;
  notice?: string;
};
export function HealthKitActivityList({
  days,
  lastSyncAt,
  notice,
}: ActivityData) {
  if (!days.length) return null;
  return (
    <section className="card" aria-labelledby="healthkit-activity-title">
      <h2 id="healthkit-activity-title">Activity from Apple Health</h2>
      <p className="muted">
        {notice} Last synced {when(lastSyncAt)}.
      </p>
      {days.map((d) => (
        <div className="list-row" key={d.day} style={rowStyle}>
          <div>
            <strong>
              {new Date(d.day + "T12:00:00").toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </strong>
            <p>{dayLine(d) || "Measurements recorded; totals pending."}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
