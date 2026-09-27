"use client";
import { useEffect, useRef, useState } from "react";

type Grant = {
  id: string;
  caseId: string;
  scopes: string[];
  reason: string;
  expiresAt: string;
  revision: number;
  status: string;
};
type Settings = {
  email: boolean;
  bookings: boolean;
  workouts: boolean;
  quietStart: number;
  quietEnd: number;
  timezone: string;
};
type Elevation = {
  id: string;
  action: string;
  reason: string;
  changes: Partial<Omit<Settings, "email">>;
  expectedVersion: number;
  status: string;
  revision: number;
  expiresAt: string;
};
type Preview = {
  grant: Grant;
  serverTime: string;
  operator: { id: string; name: string };
  workspace: { name: string; slug: string; published: boolean };
  target: { name: string; role: string };
  case: { id: string; category: string };
  projection: {
    account?: { emailVerified: boolean; role: string };
    access?: {
      workspaceMembership: string;
      subscriptionStatus: string;
      accessUntil: string | null;
      renewalCancelled: boolean;
    };
    connections?: { provider: string; status: string; updated_at: string }[];
    notificationSettings?: { data: Settings; version: number };
    trainingSchedule?: {
      state: string;
      partial: boolean;
      window: string;
      sessions: {
        id: string;
        date: string;
        label: string;
        timezone: string;
        status: string;
        exercise_count: number;
      }[];
    };
    nutritionSchedule?: {
      state: string;
      window: string;
      meals: {
        plan_id: string;
        date: string;
        slot: string;
        name: string;
        servings: number | null;
      }[];
    };
  };
  elevation: Elevation | null;
  limitations: string;
};
async function request(path: string, body?: unknown) {
  const response = await fetch("/api/v1/admin/support-previews" + path, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "Support preview unavailable.");
  return data;
}
export function SupportPreviewLaunch({
  tenantId,
  caseId,
  caseRevision,
  open,
}: {
  tenantId: string;
  caseId: string;
  caseRevision: number;
  open: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const intent = useRef({ fingerprint: "", key: "" });
  if (!open)
    return (
      <p className="muted">
        Support previews are available for open cases only.
      </p>
    );
  return (
    <details>
      <summary>Open a read-only support preview</summary>
      <p>
        Open only the customer screens needed for this case, for up to 15
        minutes. Verify your authenticator in your own account settings first.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const form = new FormData(event.currentTarget);
          const body = {
            tenantId,
            caseId,
            caseRevision,
            reason: String(form.get("reason") ?? ""),
            minutes: Number(form.get("minutes")),
            scopes: form.getAll("scopes").map(String).sort(),
          };
          const fingerprint = JSON.stringify(body);
          if (intent.current.fingerprint !== fingerprint)
            intent.current = { fingerprint, key: crypto.randomUUID() };
          setBusy(true);
          setError("");
          void request("", { ...body, requestKey: intent.current.key })
            .then(({ grant }) =>
              window.location.assign("/admin/support/preview/" + grant.id),
            )
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          <span>Reason for access</span>
          <textarea
            name="reason"
            minLength={10}
            maxLength={500}
            required
            placeholder="Describe the problem you are investigating."
          />
        </label>
        <p className="muted">
          Keep passwords, payment details and medical information out of this
          reason.
        </p>
        <fieldset>
          <legend>Information needed for this case</legend>
          <label>
            <input
              type="checkbox"
              name="scopes"
              value="account"
              defaultChecked
            />{" "}
            Account role and verification
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              name="scopes"
              value="access"
              defaultChecked
            />{" "}
            Membership and subscription access status
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              name="scopes"
              value="connections"
              defaultChecked
            />{" "}
            Connection status only
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              name="scopes"
              value="notification_settings"
            />{" "}
            Notification settings
          </label>
          <br />
          <label>
            <input type="checkbox" name="scopes" value="training_schedule" />{" "}
            Training schedule — health data, current coaching permission
            required
          </label>
          <br />
          <label>
            <input type="checkbox" name="scopes" value="nutrition_schedule" />{" "}
            Meal schedule — health data, current nutrition permission required
          </label>
        </fieldset>
        <label className="field">
          <span>Expires after</span>
          <select name="minutes" defaultValue="15">
            <option value="5">5 minutes</option>
            <option value="10">10 minutes</option>
            <option value="15">15 minutes</option>
          </select>
        </label>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? "Opening preview…" : "Start read-only preview"}
        </button>
      </form>
    </details>
  );
}
export function SupportPreview({ grantId }: { grantId: string }) {
  const [data, setData] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [ended, setEnded] = useState(false),
    [busy, setBusy] = useState(false),
    [seconds, setSeconds] = useState(0);
  const grant = useRef<Grant | null>(null),
    halted = useRef(false),
    deadline = useRef(0),
    refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true,
      running = false;
    halted.current = false;
    grant.current = null;
    setData(null);
    setError("");
    setEnded(false);
    const load = async () => {
      if (!active || halted.current || running) return;
      running = true;
      try {
        const result: Preview = await request("/" + grantId);
        if (active && !halted.current) {
          grant.current = result.grant;
          deadline.current =
            performance.now() +
            Math.max(
              0,
              Date.parse(result.grant.expiresAt) -
                Date.parse(result.serverTime),
            );
          setSeconds(
            Math.ceil(Math.max(0, deadline.current - performance.now()) / 1000),
          );
          setData(result);
          setError("");
        }
      } catch (e) {
        if (active) {
          setData(null);
          setError((e as Error).message);
        }
      } finally {
        running = false;
      }
    };
    refresh.current = load;
    void load();
    const poll = setInterval(() => void load(), 15000);
    const tick = setInterval(() => {
      if (!grant.current || halted.current) return;
      const remaining = Math.ceil(
        Math.max(0, deadline.current - performance.now()) / 1000,
      );
      setSeconds(remaining);
      if (!remaining) {
        halted.current = true;
        setData(null);
        setEnded(true);
        void request("/" + grantId + "/end", {
          revision: grant.current.revision,
        }).catch(() => {});
      }
    }, 1000);
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener("focus", focus);
    };
  }, [grantId]);
  async function stop() {
    if (!grant.current || busy) return;
    halted.current = true;
    setData(null);
    setBusy(true);
    setError("");
    try {
      await request("/" + grantId + "/end", {
        revision: grant.current.revision,
      });
      setEnded(true);
    } catch (e) {
      setError(
        "The preview is hidden. " +
          (e as Error).message +
          " You can retry stopping it; server access expires automatically.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div
        className="notice"
        style={{ position: "sticky", top: 0, zIndex: 3, borderWidth: 2 }}
      >
        <strong>
          {data?.elevation
            ? "Support preview · notification correction enabled"
            : "Read-only support preview"}
        </strong>
        {data && (
          <p>
            Viewing {data.target.name} in {data.workspace.name}. You remain
            signed in as {data.operator.name}.
          </p>
        )}
        {data?.elevation && (
          <p>
            Only the exact reminder or quiet-hour correction shown below can be
            applied, once.
          </p>
        )}
        {data && (
          <p aria-live="off">
            Expires in {Math.floor(seconds / 60)}:
            {String(seconds % 60).padStart(2, "0")} ·{" "}
            {new Date(data.grant.expiresAt).toLocaleTimeString()}
          </p>
        )}
        {!ended && grant.current && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void stop()}
          >
            {busy ? "Stopping…" : "Stop preview"}
          </button>
        )}
        <a href="/admin/support">Return to support cases</a>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {ended ? (
        <section className="card">
          <h1>Preview ended</h1>
          <p>
            Request a new preview from the open support case if further
            investigation is needed.
          </p>
        </section>
      ) : !data ? (
        <p role="status">
          {error
            ? "Preview information is hidden."
            : "Loading scoped support preview…"}
        </p>
      ) : (
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {data.workspace.name} · {data.target.role}
              </p>
              <h1>{data.target.name}</h1>
              <p>
                Case {data.case.id} · {data.case.category}
              </p>
            </div>
          </div>
          <section className="card">
            <h2>Purpose and limits</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{data.grant.reason}</p>
            <p>{data.limitations}</p>
            <p className="muted">
              Access is checked again on every refresh and automatically ends
              when the case, membership or sign-in session is no longer valid.
            </p>
          </section>
          {data.projection.account && (
            <section className="card">
              <h2>Account</h2>
              <p>Role: {data.projection.account.role}</p>
              <p>
                Email:{" "}
                {data.projection.account.emailVerified
                  ? "Verified"
                  : "Verification pending"}
              </p>
            </section>
          )}
          {data.projection.access && (
            <section className="card">
              <h2>Access</h2>
              <p>
                Workspace membership:{" "}
                {data.projection.access.workspaceMembership}
              </p>
              <p>
                Subscription:{" "}
                {data.projection.access.subscriptionStatus.replaceAll("_", " ")}
              </p>
              {data.projection.access.accessUntil && (
                <p>
                  Current period ends:{" "}
                  {new Date(
                    data.projection.access.accessUntil,
                  ).toLocaleString()}
                </p>
              )}
              <p>
                Renewal cancellation:{" "}
                {data.projection.access.renewalCancelled
                  ? "Scheduled"
                  : "Not scheduled"}
              </p>
            </section>
          )}
          {data.projection.connections && (
            <section className="card">
              <h2>Connections</h2>
              {data.projection.connections.length ? (
                data.projection.connections.map((c, i) => (
                  <article className="list-row" key={i}>
                    <div>
                      <strong>{c.provider.replaceAll("_", " ")}</strong>
                      <p>
                        {c.status} · updated{" "}
                        {new Date(c.updated_at).toLocaleString()}
                      </p>
                    </div>
                  </article>
                ))
              ) : (
                <p>No connection status is recorded.</p>
              )}
            </section>
          )}
          {data.projection.trainingSchedule && (
            <section className="card">
              <h2>Training schedule</h2>
              {data.projection.trainingSchedule.state !== "available" ? (
                <p>
                  Training details are hidden. Current subscriber coaching
                  permission is required.
                </p>
              ) : (
                <>
                  <p className="muted">
                    {data.projection.trainingSchedule.window}. Session labels
                    and status only.
                  </p>
                  {data.projection.trainingSchedule.sessions.length ? (
                    data.projection.trainingSchedule.sessions.map((s) => (
                      <article className="list-row" key={s.id}>
                        <div>
                          <strong>{s.label || "Training session"}</strong>
                          <p>
                            {s.date} · {s.timezone || "Time zone unavailable"} ·{" "}
                            {s.exercise_count} exercises
                          </p>
                        </div>
                        <span className="badge">{s.status}</span>
                      </article>
                    ))
                  ) : (
                    <p>No sessions in this date window.</p>
                  )}
                  {data.projection.trainingSchedule.partial && (
                    <p>Showing the first 40 sessions in this date window.</p>
                  )}
                </>
              )}
            </section>
          )}
          {data.projection.nutritionSchedule && (
            <section className="card">
              <h2>Meal schedule</h2>
              {data.projection.nutritionSchedule.state !== "available" ? (
                <p>
                  Meal details are hidden. Current subscriber nutrition
                  permission is required.
                </p>
              ) : (
                <>
                  <p className="muted">
                    {data.projection.nutritionSchedule.window}. Planned meals
                    and portions only.
                  </p>
                  {data.projection.nutritionSchedule.meals.length ? (
                    data.projection.nutritionSchedule.meals.map((m, i) => (
                      <article className="list-row" key={m.plan_id + ":" + i}>
                        <div>
                          <strong>{m.name}</strong>
                          <p>
                            {m.date} · {m.slot}
                            {m.servings !== null
                              ? ` · ${m.servings} servings`
                              : ""}
                          </p>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p>No delivered meals in this date window.</p>
                  )}
                </>
              )}
            </section>
          )}
          {data.projection.notificationSettings && (
            <NotificationCorrection
              key={data.grant.id}
              preview={data}
              settings={data.projection.notificationSettings}
              refresh={() => refresh.current()}
            />
          )}
        </>
      )}
    </>
  );
}

const settingLabels = {
  bookings: "Booking reminders",
  workouts: "Workout reminders",
  quietStart: "Quiet hours start",
  quietEnd: "Quiet hours end",
  timezone: "Time zone",
};
const clockTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const settingValue = (key: string, value: unknown) =>
  typeof value === "boolean"
    ? value
      ? "On"
      : "Off"
    : key === "quietStart" || key === "quietEnd"
      ? clockTime(Number(value))
      : String(value);
function NotificationCorrection({
  preview,
  settings,
  refresh,
}: {
  preview: Preview;
  settings: { data: Settings; version: number };
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [seconds, setSeconds] = useState(0);
  const intent = useRef({ fingerprint: "", key: "" });
  const elevation = preview.elevation;
  useEffect(() => {
    if (!elevation) {
      setSeconds(0);
      return;
    }
    const deadline =
      performance.now() +
      Math.max(
        0,
        Date.parse(elevation.expiresAt) - Date.parse(preview.serverTime),
      );
    const tick = () =>
      setSeconds(Math.ceil(Math.max(0, deadline - performance.now()) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [elevation?.id, elevation?.expiresAt, preview.serverTime]);
  async function act(path: string, body: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request("/" + preview.grant.id + path, body);
      if (result.elevation.status === "applied")
        setMessage("Correction saved. The preview is read-only again.");
      else if (result.elevation.status !== "active")
        setMessage(
          "Correction approval ended. Settings were not changed by this request.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Notification settings</h2>
      <p>
        Email delivery: {settings.data.email ? "On" : "Off"}. Support
        corrections preserve delivery-channel settings, marketing choices and
        account or safety alerts.
      </p>
      <dl>
        {Object.entries(settingLabels).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{settingValue(key, settings.data[key as keyof Settings])}</dd>
          </div>
        ))}
      </dl>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {elevation ? (
        <div className="notice">
          <h3>Review the exact correction</h3>
          <p>
            Prepared by {preview.operator.name} for {preview.target.name}.
            Applies once to settings version {elevation.expectedVersion}.
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{elevation.reason}</p>
          <ul>
            {Object.entries(elevation.changes).map(([key, value]) => (
              <li key={key}>
                {settingLabels[key as keyof typeof settingLabels]}:{" "}
                {settingValue(key, settings.data[key as keyof Settings])} →{" "}
                {settingValue(key, value)}
              </li>
            ))}
          </ul>
          <p>
            {seconds
              ? `Approval expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.`
              : "Approval expired. Discard it and prepare a new correction."}{" "}
            Customer changes will cancel this approval.
          </p>
          <button
            className="button"
            disabled={busy || !seconds}
            onClick={() =>
              void act("/elevations/" + elevation.id + "/apply", {
                revision: elevation.revision,
              })
            }
          >
            {busy ? "Working…" : "Apply this correction once"}
          </button>{" "}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void act("/elevations/" + elevation.id + "/end", {
                revision: elevation.revision,
              })
            }
          >
            Discard approval
          </button>
        </div>
      ) : (
        <details>
          <summary>Prepare a notification correction</summary>
          <p>
            This grants up to five minutes to apply the exact change you review.
            Enter the customer’s requested correction and its reason.
          </p>
          <form
            key={settings.version}
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              const form = new FormData(event.currentTarget);
              const minute = (key: string) =>
                String(form.get(key))
                  .split(":")
                  .reduce((hours, value) => hours * 60 + Number(value), 0);
              const values = {
                bookings: form.get("bookings") === "on",
                workouts: form.get("workouts") === "on",
                quietStart: minute("quietStart"),
                quietEnd: minute("quietEnd"),
                timezone: String(form.get("timezone")).trim(),
              };
              const changes = Object.fromEntries(
                Object.entries(values).filter(
                  ([key, value]) =>
                    settings.data[key as keyof Settings] !== value,
                ),
              );
              if (!Object.keys(changes).length) {
                setError("Choose at least one changed setting.");
                return;
              }
              const body = {
                revision: preview.grant.revision,
                action: "notification_preferences",
                reason: String(form.get("reason")),
                version: settings.version,
                changes,
              };
              const fingerprint = JSON.stringify(body);
              if (intent.current.fingerprint !== fingerprint)
                intent.current = { fingerprint, key: crypto.randomUUID() };
              void act("/elevations", {
                ...body,
                requestKey: intent.current.key,
              });
            }}
          >
            <label>
              <input
                name="bookings"
                type="checkbox"
                defaultChecked={settings.data.bookings}
              />{" "}
              Booking reminders
            </label>
            <br />
            <label>
              <input
                name="workouts"
                type="checkbox"
                defaultChecked={settings.data.workouts}
              />{" "}
              Workout reminders
            </label>
            <label className="field">
              <span>Quiet hours start</span>
              <input
                name="quietStart"
                type="time"
                defaultValue={clockTime(settings.data.quietStart)}
                required
              />
            </label>
            <label className="field">
              <span>Quiet hours end</span>
              <input
                name="quietEnd"
                type="time"
                defaultValue={clockTime(settings.data.quietEnd)}
                required
              />
            </label>
            <p className="muted">
              Matching start and end times disable quiet hours.
            </p>
            <label className="field">
              <span>Time zone</span>
              <input
                name="timezone"
                defaultValue={settings.data.timezone}
                maxLength={80}
                required
              />
            </label>
            <label className="field">
              <span>Reason for this correction</span>
              <textarea
                name="reason"
                minLength={10}
                maxLength={500}
                placeholder="Describe the correction requested in this case. Exclude sensitive information."
                required
              />
            </label>
            <button className="button" disabled={busy}>
              {busy
                ? "Preparing…"
                : "Authorize exact correction for up to 5 minutes"}
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
