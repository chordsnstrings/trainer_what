"use client";
import { confirmWorkspace } from "./workspace-feedback";
import { useCallback, useEffect, useState } from "react";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import { translator, type Locale } from "../lib/i18n/core";
import healthMessages from "../lib/i18n/messages/health";
import { Skeleton } from "./phone-ui";
import { ACCOUNT_READ_TIMEOUT_MS, fetchWithin } from "./account-request";
import { formatDate, formatTime, formatWhen, humanize } from "../lib/format";

// Automatic Apple Health sync through the HealthKit companion app. The
// companion app itself is separate native work; these screens let a member
// pair it, see its status, disconnect it and delete what it synchronized.
async function api(path: string, method = "GET", body?: unknown) {
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  // A status read that does not answer ends in "Check again", never an
  // endless "Loading sync status…" (account-request.ts fetchWithin).
  const response =
    method === "GET"
      ? await fetchWithin("/api/v1" + path, init, ACCOUNT_READ_TIMEOUT_MS)
      : await fetch("/api/v1" + path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.message ?? "The request could not be completed.");
  return data;
}
/** "Today, 14:05" or "29 Sep, 14:05" (lib/format.ts), never seconds. */
const when = (value?: string | null, locale: Locale = "en") =>
  value
    ? formatWhen(value, { locale })
    : translator(healthMessages, locale)("never");
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
  /** False when the coach chose "No wearable imports". */
  coachAllowsImports?: boolean;
  /** Only the workspace's clients pair devices. */
  canPair?: boolean;
  consent: boolean;
  wearablePermissionWithdrawn: boolean;
  devices: Device[];
  /** Every stored synced day, including display-only days after a revocation. */
  synced: {
    days: number;
    restrictedDays?: number;
    observations: number;
    last_sync_at: string | null;
  };
  pendingCodeExpiresAt: string | null;
  server: string;
};
type HealthKey = keyof typeof healthMessages.en;
const reasonKey = (reason: string) =>
  `reason_${reason}` in healthMessages.en
    ? (`reason_${reason}` as HealthKey)
    : null;
const errorKey = (code: string) =>
  `error_${code}` in healthMessages.en ? (`error_${code}` as HealthKey) : null;

type Pairing = { code: string; expiresAt: string; server: string };
export function HealthKitSyncPanel({ role = "subscriber" }: { role?: string }) {
  const [status, setStatus] = useState<Status | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [pairing, setPairing] = useState<Pairing | null>(null),
    [failed, setFailed] = useState(false);
  const t = useT("health"),
    toError = useErrorText();
  const refresh = useCallback(async () => {
    setStatus(await api("/healthkit/status"));
    setFailed(false);
  }, []);
  // A failed first read says so with a retry, never an endless "Loading".
  const load = useCallback(
    () =>
      refresh().catch(() => {
        setFailed(true);
      }),
    [refresh],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await refresh();
      setMessage(success);
    } catch (e) {
      setMessage(e instanceof Error ? toError(e) : t("tryAgain"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <HealthKitSyncView
      status={status}
      failed={failed}
      onRetry={() => void load()}
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
        }, t("codeCreated"))
      }
      onCancel={() =>
        void run(async () => {
          await api("/healthkit/pairing-codes/cancel", "POST", {});
          setPairing(null);
        }, t("codeCancelled"))
      }
      onDisconnect={async (d) => {
        if (
          (await confirmWorkspace({ title: "Confirm action", detail: t("disconnectConfirm", { name: d.name }), confirm: "Continue" }))
        )
          void run(
            () => api(`/healthkit/devices/${d.id}/revoke`, "POST", {}),
            t("disconnected"),
          );
      }}
      onDelete={async () => {
        if (
          (await confirmWorkspace({ title: "Confirm action", detail: t("deleteConfirm"), confirm: "Continue" }))
        )
          void run(
            () => api("/healthkit/data/delete", "POST", { confirm: true }),
            t("deleted"),
          );
      }}
    />
  );
}

/** Presentational states of the sync panel; the panel above supplies data. */
export function HealthKitSyncView({
  status,
  failed = false,
  onRetry,
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
  /** The status could not be read: show a retry, not "Loading". */
  failed?: boolean;
  onRetry?: () => void;
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
  const t = useT("health"),
    locale = useLocale();
  return (
    <section className="card" aria-labelledby="healthkit-sync-title">
      <h2 id="healthkit-sync-title">{t("title")}</h2>
      <p className="muted">{t("intro")}</p>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {!status && failed ? (
        <div role="alert">
          <p>{t("statusFailed")}</p>
          {onRetry && (
            <button
              type="button"
              className="button secondary"
              onClick={onRetry}
            >
              {t("checkAgain")}
            </button>
          )}
        </div>
      ) : !status ? (
        <Skeleton label={t("loading")} lines={2} />
      ) : !status.available ? (
        <p>
          <span className="badge amber">{t("notAvailable")}</span>{" "}
          {/* Members read one plain line, never the platform's status. */}
          {role === "subscriber" || locale !== "en"
            ? t("notAvailableText")
            : status.message}
        </p>
      ) : role === "owner" && !status.coachAllowsSync ? (
        <p>
          <span className="badge amber">Not enabled</span> Choose “Allow
          permitted imports and Apple Health sync” in your{" "}
          <a href="/trainer/onboarding/wearables">wearable policy</a> to let
          clients connect.
        </p>
      ) : role === "owner" || status.canPair === false ? (
        <p>
          <span className="badge">{t("forClients")}</span>{" "}
          {role === "owner"
            ? "Automatic sync is on for your clients. Each client pairs their own iPhone from their Connections page; team accounts do not pair devices."
            : t("clientsOnly")}
        </p>
      ) : !status.coachAllowsSync ? (
        <p>
          <span className="badge amber">{t("notEnabled")}</span>{" "}
          {t("coachOff")}
          {status.coachAllowsImports === false ? "" : t("stillImport")}
        </p>
      ) : status.wearablePermissionWithdrawn ? (
        <p>
          <span className="badge amber">{t("withdrawn")}</span>{" "}
          {t("withdrawnText")}
        </p>
      ) : (
        <div>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => onConsent(e.target.checked)}
            />{" "}
            {t("allow")}
          </label>
          <div className="button-row">
            <button
              type="button"
              className="button"
              disabled={busy || !consent || full}
              onClick={onCreate}
            >
              {t("createCode")}
            </button>
            {(pairing || status.pendingCodeExpiresAt) && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={onCancel}
              >
                {t("cancelCode")}
              </button>
            )}
          </div>
          {full && (
            <p className="muted">{t("full")}</p>
          )}
          {pairing && (
            <div aria-live="polite">
              <p className="small-label">{t("pairingCode")}</p>
              <p style={codeStyle} dir="ltr">
                <strong>{pairing.code}</strong>
              </p>
              <p>
                {(() => {
                  const [before, after] = t
                    .template("pairingHelp")
                    .split("<server></server>");
                  const fill = (text: string) =>
                    text.replace(
                      "{time}",
                      formatTime(pairing.expiresAt, { locale }),
                    );
                  return (
                    <>
                      {fill(before)}
                      <code style={{ overflowWrap: "anywhere" }}>
                        {pairing.server}
                      </code>
                      {fill(after ?? "")}
                    </>
                  );
                })()}
              </p>
            </div>
          )}
        </div>
      )}
      {status && (active.length > 0 || past.length > 0) && (
        <div>
          <h3>{t("pairedDevices")}</h3>
          {[...active, ...past].map((d) => (
            <div className="list-row" key={d.id} style={rowStyle}>
              <div>
                <strong>
                  <bdi>{d.name}</bdi>
                </strong>{" "}
                <span
                  className={"badge" + (d.status === "active" ? " green" : "")}
                >
                  {d.status === "active" ? t("connected") : t("disconnectedBadge")}
                </span>
                <p>
                  {t("deviceLine", {
                    paired: when(d.pairedAt, locale),
                    last: when(d.lastSyncAt, locale),
                    entries: t("entries", { count: d.samplesReceived }),
                  })}
                </p>
                {d.status === "active" && d.lastErrorCode && (
                  <p className="muted">
                    {t(
                      (errorKey(d.lastErrorCode) ?? "uploadRefused") as "uploadRefused",
                    )}
                  </p>
                )}
                {d.status !== "active" &&
                  d.revokedReason &&
                  reasonKey(d.revokedReason) && (
                    <p className="muted">
                      {t(reasonKey(d.revokedReason) as "reason_member")}
                    </p>
                  )}
              </div>
              {d.status === "active" && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  aria-label={t("disconnectName", { name: d.name })}
                  onClick={() => onDisconnect(d)}
                >
                  {t("disconnect")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {status && status.synced.days > 0 && (
        <div className="list-row" style={rowStyle}>
          <div>
            <strong>{t("syncedData")}</strong>
            <p>
              {t("syncedLine", {
                days: t("days", { count: status.synced.days }),
                observations: t("derived", {
                  count: status.synced.observations,
                }),
                when: when(status.synced.last_sync_at, locale),
              })}
            </p>
            {(status.synced.restrictedDays ?? 0) > 0 && (
              <p className="muted">
                {status.synced.restrictedDays === status.synced.days
                  ? t("allRestricted")
                  : t("someRestricted", {
                      count: status.synced.restrictedDays ?? 0,
                    })}
              </p>
            )}
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onDelete}
          >
            {t("deleteSynced")}
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
const activityName = (value: string) => humanize(value);
export function dayLine(d: Day, locale: Locale = "en") {
  if (locale === "en")
    return [
      d.steps !== null && `${Math.round(d.steps).toLocaleString("en")} steps`,
      d.activeEnergyKcal !== null &&
        `${Math.round(d.activeEnergyKcal).toLocaleString("en")} kcal active`,
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
  const t = translator(healthMessages, locale);
  return [
    d.steps !== null && t("steps", { count: Math.round(d.steps) }),
    d.activeEnergyKcal !== null &&
      t("kcalActive", { n: Math.round(d.activeEnergyKcal) }),
    d.sleepMinutes !== null &&
      t("asleep", {
        time: t("hoursMinutes", {
          h: Math.floor(d.sleepMinutes / 60),
          m: Math.round(d.sleepMinutes % 60),
        }),
      }),
    ...d.workouts.map((w) =>
      t("workoutMinutes", {
        activity: activityName(w.activity),
        n: Math.round(w.minutes),
      }),
    ),
    d.restingHeartRate !== null &&
      t("restingHr", { n: Math.round(d.restingHeartRate) }),
    d.hrvMs !== null && t("hrv", { n: d.hrvMs }),
    d.bodyMassKg !== null && t("bodyMass", { n: d.bodyMassKg }),
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
  const t = useT("health"),
    locale = useLocale();
  if (!days.length) return null;
  return (
    <section className="card" aria-labelledby="healthkit-activity-title">
      <h2 id="healthkit-activity-title">{t("activityTitle")}</h2>
      <p className="muted">
        {locale === "en" && notice ? `${notice} ` : ""}
        {t("lastSynced", { when: when(lastSyncAt, locale) })}
      </p>
      {days.map((d) => (
        <div className="list-row" key={d.day} style={rowStyle}>
          <div>
            <strong>
              {formatDate(d.day, { weekday: true, year: false, locale })}
            </strong>
            <p>{dayLine(d, locale) || t("pending")}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
