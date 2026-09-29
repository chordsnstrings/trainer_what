"use client";
import { useCallback, useEffect, useState } from "react";
import {
  communicationStyles,
  datedContextState,
  contextLocalDate,
  emptyClientContext,
  type ClientContextData,
  type ClientContextView,
} from "../../../packages/domain/src/client-context.ts";
import { formatDateTime } from "../lib/format";

export function ClientContext({
  userId,
  editable,
}: {
  userId: string;
  editable: boolean;
}) {
  const [saved, setSaved] = useState<ClientContextView | null>(null);
  const [draft, setDraft] = useState<ClientContextData>(emptyClientContext);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(`/api/v1/clients/${userId}/context`, {
        cache: "no-store",
      });
      const body = await r.json();
      if (!r.ok)
        throw new Error(body.message ?? "Preferences could not be loaded");
      setSaved(body);
      setDraft(body.data);
    } catch (e) {
      setSaved(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [userId]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async () => {
    if (!saved) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(`/api/v1/clients/${userId}/context`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: saved.version, data: draft }),
      });
      const body = await r.json();
      if (!r.ok)
        throw new Error(body.message ?? "Preferences could not be saved");
      setSaved(body);
      setDraft(body.data);
      setNotice("Preferences saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const change = (patch: Partial<ClientContextData>) =>
    setDraft((d) => ({ ...d, ...patch }));
  return (
    <section className="card">
      <h2>
        {editable
          ? "How you like to be coached"
          : "Preferences and upcoming changes"}
      </h2>
      <p>
        {editable
          ? "Optional notes for your coach, including travel or schedule changes coming up. They do not change your plan by themselves."
          : "Optional, self-reported context for your trainer. These notes do not automatically change your training or nutrition plan."}
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!editable && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Reload saved preferences
        </button>
      )}
      {saved && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset className="context-fieldset" disabled={!editable || busy}>
            <label className="field">
              <span>Communication style</span>
              <select
                value={draft.communicationStyle}
                onChange={(e) =>
                  change({
                    communicationStyle: e.target
                      .value as ClientContextData["communicationStyle"],
                  })
                }
              >
                {Object.entries(communicationStyles).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Communication preferences</span>
              <textarea
                aria-label="Communication preferences"
                maxLength={1000}
                value={draft.communicationNotes}
                onChange={(e) => change({ communicationNotes: e.target.value })}
              />
            </label>
            {(["exerciseLikes", "exerciseDislikes"] as const).map((key) => (
              <label className="field" key={key}>
                <span>
                  {key === "exerciseLikes"
                    ? "Exercises you enjoy"
                    : "Exercises you prefer to avoid"}{" "}
                  (one per line)
                </span>
                <textarea
                  aria-label={
                    key === "exerciseLikes"
                      ? "Exercises you enjoy (one per line)"
                      : "Exercises you prefer to avoid (one per line)"
                  }
                  value={draft[key].join("\n")}
                  onChange={(e) =>
                    change({ [key]: e.target.value.split("\n") })
                  }
                  onBlur={() =>
                    change({
                      [key]: draft[key].map((v) => v.trim()).filter(Boolean),
                    })
                  }
                />
              </label>
            ))}
            {draft.datedChanges.map((item, index) => {
              const update = (patch: Partial<typeof item>) =>
                change({
                  datedChanges: draft.datedChanges.map((row) =>
                    row.id === item.id ? { ...row, ...patch } : row,
                  ),
                });
              return (
                <fieldset key={item.id}>
                  <legend>
                    Change {index + 1} ·{" "}
                    {(() => {
                      try {
                        return datedContextState(item);
                      } catch {
                        return "Choose a valid timezone";
                      }
                    })()}
                  </legend>
                  <label className="field">
                    <span>Type</span>
                    <select
                      value={item.kind}
                      onChange={(e) =>
                        update({
                          kind: e.target.value as "travel" | "schedule",
                        })
                      }
                    >
                      <option value="travel">Travel</option>
                      <option value="schedule">Schedule change</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Title</span>
                    <input
                      required
                      maxLength={120}
                      value={item.title}
                      onChange={(e) => update({ title: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>From</span>
                    <input
                      required
                      type="date"
                      value={item.startsOn}
                      onChange={(e) => update({ startsOn: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Through</span>
                    <input
                      required
                      type="date"
                      min={item.startsOn}
                      value={item.endsOn}
                      onChange={(e) => update({ endsOn: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Time zone while away</span>
                    <input
                      required
                      maxLength={80}
                      value={item.timezone}
                      onChange={(e) => update({ timezone: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Availability</span>
                    <textarea
                      aria-label="Availability"
                      maxLength={500}
                      value={item.availabilityNotes}
                      onChange={(e) =>
                        update({ availabilityNotes: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Available equipment</span>
                    <textarea
                      aria-label="Available equipment"
                      maxLength={500}
                      value={item.equipmentNotes}
                      onChange={(e) =>
                        update({ equipmentNotes: e.target.value })
                      }
                    />
                  </label>
                  {editable && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        change({
                          datedChanges: draft.datedChanges.filter(
                            (row) => row.id !== item.id,
                          ),
                        })
                      }
                    >
                      Remove change
                    </button>
                  )}
                </fieldset>
              );
            })}
            {editable && (
              <div className="button-row context-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={draft.datedChanges.length >= 8}
                  onClick={() => {
                    const date = contextLocalDate(
                      Intl.DateTimeFormat().resolvedOptions().timeZone,
                    );
                    change({
                      datedChanges: [
                        ...draft.datedChanges,
                        {
                          id: crypto.randomUUID(),
                          kind: "travel",
                          title: "",
                          startsOn: date,
                          endsOn: date,
                          timezone:
                            Intl.DateTimeFormat().resolvedOptions().timeZone,
                          availabilityNotes: "",
                          equipmentNotes: "",
                        },
                      ],
                    });
                  }}
                >
                  {editable
                    ? "Add travel or a schedule change"
                    : "Add dated change"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setDraft(emptyClientContext())}
                >
                  Clear all fields
                </button>
                <button type="submit" className="button">
                  {busy ? "Saving…" : "Save preferences"}
                </button>
              </div>
            )}
          </fieldset>
          <small>
            {saved.provenance.updatedAt
              ? `Updated ${formatDateTime(saved.provenance.updatedAt)}`
              : "No preferences saved yet."}
            {!editable && " · Only the client can edit these preferences."}
          </small>
        </form>
      )}
    </section>
  );
}
