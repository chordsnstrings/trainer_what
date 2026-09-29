"use client";
import { useLocale } from "../lib/i18n/react";
import { translator, type Locale } from "../lib/i18n/core";
import contextMessages from "../lib/i18n/messages/context";
import { errorText } from "../lib/i18n/errors";
import { formatDateTime, timeZoneChoices } from "../lib/format";
import { useCallback, useEffect, useState } from "react";
import {
  communicationStyles,
  datedContextState,
  contextLocalDate,
  emptyClientContext,
  type ClientContextData,
  type ClientContextView,
} from "../../../packages/domain/src/client-context.ts";

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
  // The member edits their own context in their language; the coach's view
  // (read only) stays English.
  const page = useLocale();
  const locale: Locale = editable ? page : "en";
  const t = translator(contextMessages, locale);
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
        throw Object.assign(new Error(body.message ?? t("loadFailed")), {
          status: r.status,
          code: body.code,
        });
      setSaved(body);
      setDraft(body.data);
    } catch (e) {
      setSaved(null);
      setError(locale === "en" ? (e as Error).message : errorText(e, locale));
    } finally {
      setBusy(false);
    }
  }, [userId, locale]);
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
        throw Object.assign(new Error(body.message ?? t("saveFailed")), {
          status: r.status,
          code: body.code,
        });
      setSaved(body);
      setDraft(body.data);
      setNotice(t("saved"));
    } catch (e) {
      setError(locale === "en" ? (e as Error).message : errorText(e, locale));
    } finally {
      setBusy(false);
    }
  };
  const change = (patch: Partial<ClientContextData>) =>
    setDraft((d) => ({ ...d, ...patch }));
  return (
    <section className="card">
      <h2>{t("prefsTitle")}</h2>
      <p>{t("prefsIntro")}</p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => void load()}
      >
        {t("reload")}
      </button>
      {saved && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset className="context-fieldset" disabled={!editable || busy}>
            <label className="field">
              <span>{t("style")}</span>
              <select
                value={draft.communicationStyle}
                onChange={(e) =>
                  change({
                    communicationStyle: e.target
                      .value as ClientContextData["communicationStyle"],
                  })
                }
              >
                {Object.keys(communicationStyles).map((value) => (
                  <option key={value} value={value}>
                    {t(`style_${value as keyof typeof communicationStyles}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("notes")}</span>
              <textarea
                aria-label={t("notes")}
                maxLength={1000}
                value={draft.communicationNotes}
                onChange={(e) => change({ communicationNotes: e.target.value })}
              />
            </label>
            {(["exerciseLikes", "exerciseDislikes"] as const).map((key) => (
              <label className="field" key={key}>
                <span>
                  {key === "exerciseLikes" ? t("likes") : t("dislikes")}
                </span>
                <textarea
                  aria-label={
                    key === "exerciseLikes" ? t("likes") : t("dislikes")
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
                    {t("change", {
                      n: index + 1,
                      state: (() => {
                        try {
                          return t(`change_${datedContextState(item)}`);
                        } catch {
                          return t("invalidZone");
                        }
                      })(),
                    })}
                  </legend>
                  <label className="field">
                    <span>{t("type")}</span>
                    <select
                      value={item.kind}
                      onChange={(e) =>
                        update({
                          kind: e.target.value as "travel" | "schedule",
                        })
                      }
                    >
                      <option value="travel">{t("travel")}</option>
                      <option value="schedule">{t("schedule")}</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>{t("changeTitle")}</span>
                    <input
                      required
                      maxLength={120}
                      value={item.title}
                      onChange={(e) => update({ title: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>{t("from")}</span>
                    <input
                      required
                      type="date"
                      value={item.startsOn}
                      onChange={(e) => update({ startsOn: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>{t("through")}</span>
                    <input
                      required
                      type="date"
                      min={item.startsOn}
                      value={item.endsOn}
                      onChange={(e) => update({ endsOn: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>{t("zone")}</span>
                    {/* A place and its zone name, never a raw zone id. */}
                    <select
                      required
                      value={item.timezone}
                      onChange={(e) => update({ timezone: e.target.value })}
                    >
                      {timeZoneChoices(item.timezone, locale).map((zone) => (
                        <option key={zone.value} value={zone.value}>
                          {zone.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>{t("availability")}</span>
                    <textarea
                      aria-label={t("availability")}
                      maxLength={500}
                      value={item.availabilityNotes}
                      onChange={(e) =>
                        update({ availabilityNotes: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t("equipment")}</span>
                    <textarea
                      aria-label={t("equipment")}
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
                      {t("removeChange")}
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
                  {t("addChange")}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setDraft(emptyClientContext())}
                >
                  {t("clearAll")}
                </button>
                <button type="submit" className="button">
                  {busy ? t("saving") : t("save")}
                </button>
              </div>
            )}
          </fieldset>
          <small>
            {saved.provenance.updatedAt
              ? t("updated", {
                  when:
                    locale === "en"
                      ? new Date(saved.provenance.updatedAt).toLocaleString()
                      : formatDateTime(saved.provenance.updatedAt, { locale }),
                })
              : t("none")}
            {!editable && " · Only the client can edit these preferences."}
          </small>
        </form>
      )}
    </section>
  );
}
