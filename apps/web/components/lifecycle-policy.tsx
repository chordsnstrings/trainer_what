"use client";
import { useCallback, useEffect, useState } from "react";

type Policy = {
  version: number;
  data: { enabled: boolean; missedAfterDays: number };
};
async function request(method = "GET", body?: Policy): Promise<Policy> {
  const response = await fetch("/api/v1/lifecycle/workout-policy", {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(value.message ?? "The reminder policy could not be saved."),
      { status: response.status },
    );
  if (
    !Number.isInteger(value.version) ||
    value.version < 0 ||
    typeof value.data?.enabled !== "boolean" ||
    !Number.isInteger(value.data.missedAfterDays) ||
    value.data.missedAfterDays < 1 ||
    value.data.missedAfterDays > 7
  )
    throw new Error(
      "The saved reminder policy could not be read. Please reload it.",
    );
  return value;
}

export function WorkoutNotificationPolicy() {
  const [policy, setPolicy] = useState<Policy | null>(null),
    [enabled, setEnabled] = useState(false),
    [days, setDays] = useState("1"),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [stale, setStale] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const apply = useCallback((value: Policy) => {
    setPolicy(value);
    setEnabled(value.data.enabled);
    setDays(String(value.data.missedAfterDays));
    setStale(false);
  }, []);
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      apply(await request());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apply]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const locked = loading || saving || !policy || stale;
  return (
    <section className="card" aria-busy={loading || saving}>
      <h2>Missed-workout reminders</h2>
      <p className="muted">
        Send a reminder to the client’s in-app inbox when a planned workout has
        no recorded completion. Each client’s workout reminder preferences and
        quiet hours are respected.
      </p>
      <p className="muted">
        Active, held and canceled sessions are excluded. A missing completion
        record does not mean the client did no exercise.
      </p>
      {loading && <p role="status">Loading saved reminder policy…</p>}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="notice" role="status">
          {success}
        </p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (locked || !policy) return;
          const missedAfterDays = Number(days);
          if (
            !Number.isInteger(missedAfterDays) ||
            missedAfterDays < 1 ||
            missedAfterDays > 7
          ) {
            setError("Choose between 1 and 7 calendar days.");
            return;
          }
          setSaving(true);
          setError("");
          setSuccess("");
          try {
            apply(
              await request("PUT", {
                version: policy.version,
                data: { enabled, missedAfterDays },
              }),
            );
            setSuccess("Reminder policy saved.");
          } catch (e) {
            const conflict = (e as Error & { status?: number }).status === 409;
            setStale(conflict);
            setError(
              conflict
                ? "This policy changed since you opened it. Reload the saved policy before making another change."
                : (e as Error).message,
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="check-field">
          <input
            type="checkbox"
            checked={enabled}
            disabled={locked}
            onChange={(event) => {
              setEnabled(event.target.checked);
              setSuccess("");
            }}
          />
          Enable missed-workout reminders
        </label>
        <label className="field">
          <span>Calendar days after the planned date</span>
          <input
            type="number"
            min={1}
            max={7}
            step={1}
            required
            value={days}
            disabled={locked}
            onChange={(event) => {
              setDays(event.target.value);
              setSuccess("");
            }}
          />
        </label>
        <div className="actions">
          <button className="button" type="submit" disabled={locked}>
            {saving ? "Saving…" : "Save reminder policy"}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={loading || saving}
            onClick={() => void reload()}
          >
            Reload saved policy
          </button>
        </div>
      </form>
    </section>
  );
}
