"use client";
import { Field } from "./field";
import { useEffect, useState } from "react";
import {
  EFFORTS,
  prescriptionText,
  workMeasure,
  type WorkMeasure,
} from "../../../packages/domain/src/prescription.ts";

/**
 * Trainer Brain plans (docs/features/brain-plans.md): the trainer's review
 * queue, confidence settings, learning stats, library equipment tags and plan
 * qualification; the subscriber's generated plan; the intake notice.
 */
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Request failed");
  return d;
}
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const percent = (n: number | null | undefined) =>
  typeof n === "number" ? `${Math.round(n * 100)}%` : "—";
const label = (value: string) => value.replaceAll("_", " ");

type ExerciseRow = {
  name: string;
  /** Sets of rep work; rounds of timed or distance work. */
  sets: number;
  /** Exactly one of reps, durationSeconds and distanceMeters. */
  reps?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  paceSecondsPerKm?: number;
  effort?: string;
  loadKg: number;
  rir: number;
  restSeconds: number;
  cue: string;
  alternatives: string[];
};
/** Switches an exercise to another measure, keeping a sensible amount of work. */
function withMeasure(e: ExerciseRow, measure: WorkMeasure): ExerciseRow {
  const {
    reps: _r,
    durationSeconds: _d,
    distanceMeters: _m,
    paceSecondsPerKm,
    effort,
    ...rest
  } = e;
  if (measure === "reps")
    return { ...rest, reps: 10, restSeconds: Math.max(rest.restSeconds, 30) };
  return {
    ...rest,
    ...(measure === "time" ? { durationSeconds: 60 } : { distanceMeters: 1000 }),
    ...(paceSecondsPerKm ? { paceSecondsPerKm } : {}),
    ...(effort ? { effort } : {}),
  };
}

const HELD_FIELDS: Record<string, string> = {
  loadKg: "load kg",
  sets: "sets",
  reps: "reps",
  durationSeconds: "seconds",
  distanceMeters: "metres",
  paceSecondsPerKm: "pace s/km",
  effort: "effort",
  rir: "RIR",
  restSeconds: "rest s",
};

function ExerciseRows({
  exercises,
  names,
  onChange,
  legend,
}: {
  exercises: ExerciseRow[];
  names: string[];
  onChange?: (next: ExerciseRow[]) => void;
  legend: string;
}) {
  const replace = (i: number, next: ExerciseRow) =>
    onChange?.(exercises.map((e, j) => (j === i ? next : e)));
  const patch = (i: number, key: keyof ExerciseRow, value: unknown) =>
    replace(i, { ...exercises[i], [key]: value });
  if (!onChange)
    return (
      <ul className="plan-exercises">
        {exercises.map((e) => (
          <li key={e.name}>
            <strong>{e.name}</strong>{" "}
            <span className="muted">{prescriptionText(e)}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <fieldset className="plan-editor-session">
      <legend>{legend}</legend>
      {exercises.map((e, i) => {
        const measure = workMeasure(e);
        type NumberField = [keyof ExerciseRow, string, number, number, number];
        const work: NumberField =
          measure === "time"
            ? ["durationSeconds", "Seconds each", 5, 7200, 5]
            : measure === "distance"
              ? ["distanceMeters", "Metres each", 10, 50000, 10]
              : ["reps", "Reps", 1, 30, 1];
        const fields: NumberField[] = [
          ["sets", measure === "reps" ? "Sets" : "Rounds", 1, 10, 1],
          work,
          ["loadKg", "Load kg", 0, 500, 0.5],
          ["rir", "RIR", 0, 5, 1],
          // No rest only for one continuous bout; the validator checks it.
          ["restSeconds", "Rest s", measure === "reps" ? 15 : 0, 600, 5],
        ];
        return (
          <div className="plan-exercise-row" key={i}>
            <Field label="Exercise">
              <select
                value={e.name}
                onChange={(event) => patch(i, "name", event.target.value)}
              >
                {[...new Set([e.name, ...names])].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Measure">
              <select
                value={measure}
                onChange={(event) =>
                  replace(i, withMeasure(e, event.target.value as WorkMeasure))
                }
              >
                <option value="reps">Reps</option>
                <option value="time">Time</option>
                <option value="distance">Distance</option>
              </select>
            </Field>
            {fields.map(([key, text, min, max, step]) => (
              <Field key={key} label={text}>
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={Number(e[key] ?? 0)}
                  onChange={(event) =>
                    patch(i, key, Number(event.target.value))
                  }
                />
              </Field>
            ))}
            {measure !== "reps" && (
              <Field label="Effort">
                <select
                  value={e.effort ?? ""}
                  onChange={(event) =>
                    replace(i, {
                      ...e,
                      effort: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">Not set</option>
                  {EFFORTS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <button
              type="button"
              className="text-button"
              disabled={exercises.length <= 1}
              onClick={() => onChange(exercises.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="button secondary"
        disabled={exercises.length >= 12 || !names.length}
        onClick={() =>
          onChange([
            ...exercises,
            {
              name: names.find((n) => !exercises.some((e) => e.name === n)) ?? names[0],
              sets: 3,
              reps: 10,
              loadKg: 0,
              rir: 2,
              restSeconds: 90,
              cue: "",
              alternatives: [],
            },
          ])
        }
      >
        Add exercise
      </button>
    </fieldset>
  );
}

function ProgrammeDraft({
  draft,
  names,
  onChange,
}: {
  draft: any;
  names: string[];
  onChange?: (next: any) => void;
}) {
  const setSession = (i: number, patch: any) =>
    onChange?.({
      ...draft,
      sessions: draft.sessions.map((s: any, j: number) =>
        j === i ? { ...s, ...patch } : s,
      ),
    });
  const setWeek = (i: number, patch: any) =>
    onChange?.({
      ...draft,
      weeks: draft.weeks.map((w: any, j: number) =>
        j === i ? { ...w, ...patch } : w,
      ),
    });
  return (
    <div className="plan-draft">
      <h4>{draft.title}</h4>
      {draft.summary && <p className="muted">{draft.summary}</p>}
      {draft.sessions.map((s: any, i: number) => (
        <div key={s.key} className="plan-session">
          {onChange ? (
            <div className="form-grid">
              <Field label={`Session ${s.key} name`}>
                <input
                  value={s.label}
                  maxLength={120}
                  onChange={(e) => setSession(i, { label: e.target.value })}
                />
              </Field>
              <Field label="Weekday">
                <select
                  value={s.weekday}
                  onChange={(e) =>
                    setSession(i, { weekday: Number(e.target.value) })
                  }
                >
                  {WEEKDAYS.map((d, n) => (
                    <option key={d} value={n}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : (
            <h5>
              {s.label} · {WEEKDAYS[s.weekday]}
            </h5>
          )}
          <ExerciseRows
            legend={`Session ${s.key} exercises`}
            exercises={s.exercises}
            names={names}
            onChange={
              onChange ? (next) => setSession(i, { exercises: next }) : undefined
            }
          />
        </div>
      ))}
      <details>
        <summary>
          {draft.weeks.length} weeks of progression
        </summary>
        <ol className="plan-weeks">
          {draft.weeks.map((w: any, i: number) => (
            <li key={w.week}>
              {onChange ? (
                <div className="plan-exercise-row">
                  <Field label={`Week ${w.week} focus`}>
                    <input
                      value={w.focus}
                      maxLength={120}
                      onChange={(e) => setWeek(i, { focus: e.target.value })}
                    />
                  </Field>
                  {(
                    [
                      ["volumeFactor", "Volume ×", 0.4, 1.6, 0.05],
                      ["loadFactor", "Load ×", 0.5, 1.3, 0.025],
                      ["rirDelta", "RIR ±", -3, 3, 1],
                    ] as const
                  ).map(([key, text, min, max, step]) => (
                    <Field key={key} label={text}>
                      <input
                        type="number"
                        min={min}
                        max={max}
                        step={step}
                        value={w[key]}
                        onChange={(e) =>
                          setWeek(i, { [key]: Number(e.target.value) })
                        }
                      />
                    </Field>
                  ))}
                  <label className="plan-check">
                    <input
                      type="checkbox"
                      checked={w.deload}
                      onChange={(e) => setWeek(i, { deload: e.target.checked })}
                    />{" "}
                    Deload
                  </label>
                </div>
              ) : (
                <span>
                  Week {w.week}: {w.focus}
                  {w.deload ? " (deload)" : ""} · volume ×{w.volumeFactor} ·
                  load ×{w.loadFactor}
                </span>
              )}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function ReviewItem({
  item,
  names,
  busy,
  act,
}: {
  item: any;
  names: string[];
  busy: boolean;
  act: (fn: () => Promise<any>, success: string) => Promise<any>;
}) {
  const [editing, setEditing] = useState<any>(null),
    [note, setNote] = useState("");
  const spot = item.status === "delivered" && item.outcome?.spotCheck === "pending";
  const programme = item.type === "programme";
  const startEdit = () => {
    if (programme) {
      const { selfConfidence, uncertainties, evidenceIds, ...plan } = item.draft;
      setEditing(structuredClone(plan));
    } else setEditing(structuredClone(item.draft));
  };
  const review = (action: string, extra: any = {}) =>
    act(
      () =>
        api(`/brain/plans/${item.id}/review`, "POST", {
          action,
          version: item.version,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...extra,
        }),
      action === "reject"
        ? "Plan rejected; the Brain learns from your reason"
        : action === "edit"
          ? "Edited plan delivered; the Brain learns from your changes"
          : "Plan approved",
    );
  return (
    <article className="card plan-review">
      <div className="plan-review-head">
        <span className="badge">
          {spot
            ? "Spot check"
            : item.status === "failed"
              ? "Needs you"
              : item.status === "not_sent"
                ? "Waiting for the model"
                : "Review"}
        </span>
        <h3>
          {item.subscriberName} ·{" "}
          {programme
            ? `${item.inputs?.programmeDays ?? "?"}-day programme`
            : `Week ${item.inputs?.week ?? "?"} adjustment`}
        </h3>
      </div>
      {item.confidence && (
        <p>
          Confidence <strong>{percent(item.confidence.score)}</strong> (your
          threshold {percent(item.confidence.threshold)}) · rules{" "}
          {percent(item.confidence.signals?.ruleCoverage)} · similar reviewed
          plans {percent(item.confidence.signals?.caseCoverage)} · checks{" "}
          {percent(item.confidence.signals?.validation)} · model{" "}
          {percent(item.confidence.signals?.model)}
        </p>
      )}
      {(item.routeReasons?.length > 0 || item.error) && (
        <ul className="plan-reasons">
          {item.error && <li>{item.error}</li>}
          {item.routeReasons.map((r: string) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {item.validation?.errors?.length > 0 && (
        <p className="notice" role="alert">
          Your bounds reject this draft: {item.validation.errors.slice(0, 4).join("; ")}
        </p>
      )}
      {item.replacedText?.length > 0 && (
        <details>
          <summary>The Brain&rsquo;s own wording, replaced before the member sees it</summary>
          <ul className="plan-reasons">
            {item.replacedText.map((r: any) => (
              <li key={r.field}>
                <strong>{r.field}</strong>: {r.text}
              </li>
            ))}
          </ul>
        </details>
      )}
      {item.inputs?.profile && (
        <p className="muted">
          {label(item.inputs.profile.experience)} · {item.inputs.profile.daysPerWeek}{" "}
          days · {item.inputs.profile.goal} · equipment:{" "}
          {item.inputs.profile.equipment || "none listed"} · limitations:{" "}
          {item.inputs.profile.limitations || "none"}
        </p>
      )}
      {item.inputs?.outcomes && (
        <p className="muted">
          This week: {item.inputs.outcomes.completedSessions} of{" "}
          {item.inputs.outcomes.dueSessions} sessions completed ·{" "}
          {item.inputs.outcomes.loggedSets} sets logged
        </p>
      )}
      {item.progressionHold?.length > 0 && (
        <p className="muted">
          No increase next week: {item.progressionHold.join("; ")}.
        </p>
      )}
      {item.held?.length > 0 && (
        <details>
          <summary>
            Next week held at this week&rsquo;s values
          </summary>
          <ul className="plan-reasons">
            {item.held.map((h: any) => (
              <li key={`${h.sessionKey}:${h.exercise}:${h.field}`}>
                Session {h.sessionKey} · {h.exercise}:{" "}
                {HELD_FIELDS[h.field] ?? h.field} {String(h.from)} →{" "}
                {String(h.to)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!editing && item.draft && programme && (
        <ProgrammeDraft draft={item.draft} names={names} />
      )}
      {!editing &&
        item.draft &&
        !programme &&
        item.draft.sessions.map((s: any) => (
          <ExerciseRows
            key={s.plannedSessionId}
            legend={`Session ${s.sessionKey}`}
            exercises={s.exercises}
            names={names}
          />
        ))}
      {editing && programme && (
        <ProgrammeDraft draft={editing} names={names} onChange={setEditing} />
      )}
      {editing &&
        !programme &&
        editing.sessions.map((s: any, i: number) => (
          <ExerciseRows
            key={s.plannedSessionId}
            legend={`Session ${s.sessionKey}`}
            exercises={s.exercises}
            names={names}
            onChange={(next) =>
              setEditing({
                sessions: editing.sessions.map((x: any, j: number) =>
                  j === i ? { ...x, exercises: next } : x,
                ),
              })
            }
          />
        ))}
      <Field label="Note for the Brain (required to reject)">
        <textarea
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="button-row">
        {!editing && item.draft && !item.validation?.errors?.length && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void review("approve")}
          >
            {spot ? "Looks right" : "Approve and deliver"}
          </button>
        )}
        {!editing && item.draft && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={startEdit}
          >
            Edit
          </button>
        )}
        {editing && (
          <>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void review("edit", programme ? { plan: editing } : { week: editing }).then(
                  (r) => r && setEditing(null),
                )
              }
            >
              Deliver my edit
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Cancel edit
            </button>
          </>
        )}
        {!editing && !spot && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  api(`/brain/plans/${item.id}/regenerate`, "POST", {
                    version: item.version,
                  }),
                "The Brain prepared a fresh attempt",
              )
            }
          >
            Regenerate
          </button>
        )}
        {item.status !== "not_sent" && (
          <button
            className="button secondary"
            disabled={busy || note.trim().length < 5}
            onClick={() => void review("reject")}
          >
            {spot ? "Withdraw" : "Reject"}
          </button>
        )}
      </div>
    </article>
  );
}

function SettingsCard({
  settings,
  version,
  busy,
  act,
}: {
  settings: any;
  version: number | null;
  busy: boolean;
  act: (fn: () => Promise<any>, success: string) => Promise<any>;
}) {
  return (
    <section className="card">
      <h2>Confidence and safety settings</h2>
      <p className="muted">
        Plans at or above your threshold are delivered automatically once plan
        qualification passes. Medical limitations, pain reports and red-flag
        terms always come to you. A new exercise starts within one load jump of
        the subscriber&rsquo;s logged or library load, or at most at your start
        limit when there is neither.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const f = new FormData(event.currentTarget);
          const n = (k: string) => Number(f.get(k));
          void act(
            () =>
              api("/brain/plans/settings", "PUT", {
                version,
                settings: {
                  mode: f.get("mode"),
                  threshold: n("threshold") / 100,
                  spotCheckRate: n("spotCheckRate") / 100,
                  youngBrainReviews: n("youngBrainReviews"),
                  defaultBlockDays: n("defaultBlockDays"),
                  bounds: {
                    maxWeeklyVolumeIncreasePct: n("maxWeeklyVolumeIncreasePct"),
                    maxLoadJumpPct: n("maxLoadJumpPct"),
                    maxSessionMinutes: n("maxSessionMinutes"),
                    minRestSeconds: n("minRestSeconds"),
                    maxRestSeconds: n("maxRestSeconds"),
                    startLoadCapKg: {
                      beginner: n("capBeginner"),
                      intermediate: n("capIntermediate"),
                      advanced: n("capAdvanced"),
                    },
                  },
                },
              }),
            "Plan settings saved",
          );
        }}
      >
        <div className="form-grid">
          <Field label="Delivery">
            <select name="mode" defaultValue={settings.mode}>
              <option value="automatic">Automatic when confident</option>
              <option value="supervised">Every plan to me</option>
            </select>
          </Field>
          {(
            [
              ["threshold", "Confidence threshold (%)", 50, 99, Math.round(settings.threshold * 100)],
              ["spotCheckRate", "Spot-check share while young (%)", 0, 100, Math.round(settings.spotCheckRate * 100)],
              ["youngBrainReviews", "Young until this many reviews", 0, 500, settings.youngBrainReviews],
              ["defaultBlockDays", "Default block length (days)", 7, 365, settings.defaultBlockDays],
              ["maxWeeklyVolumeIncreasePct", "Max weekly volume increase (%)", 0, 50, settings.bounds.maxWeeklyVolumeIncreasePct],
              ["maxLoadJumpPct", "Max load jump (%)", 0, 30, settings.bounds.maxLoadJumpPct],
              ["maxSessionMinutes", "Max session length (minutes)", 20, 180, settings.bounds.maxSessionMinutes],
              ["minRestSeconds", "Shortest rest (seconds)", 15, 300, settings.bounds.minRestSeconds],
              ["maxRestSeconds", "Longest rest (seconds)", 30, 600, settings.bounds.maxRestSeconds],
              ["capBeginner", "Start load limit, beginner (kg)", 0, 500, settings.bounds.startLoadCapKg?.beginner ?? 20],
              ["capIntermediate", "Start load limit, intermediate (kg)", 0, 500, settings.bounds.startLoadCapKg?.intermediate ?? 40],
              ["capAdvanced", "Start load limit, advanced (kg)", 0, 500, settings.bounds.startLoadCapKg?.advanced ?? 60],
            ] as const
          ).map(([name, text, min, max, value]) => (
            <Field key={name} label={text}>
              <input
                name={name}
                type="number"
                min={min}
                max={max}
                defaultValue={value}
                required
              />
            </Field>
          ))}
        </div>
        <button className="button" disabled={busy}>
          Save settings
        </button>
      </form>
    </section>
  );
}

/**
 * "A: Goblet squat, 3x10 @ 20 kg, RIR 2" per line into scenario sessions;
 * timed and distance work add a unit: "B: Easy run, 1x20 min",
 * "B: Run intervals, 6x60 s", "C: Row, 4x500 m" (sets are rounds, and one
 * continuous bout has no rest).
 */
function parseScenarioWeek(text: string) {
  const sessions = new Map<string, any[]>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m =
      /^([A-G])\s*:\s*(.+?)\s*,\s*(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|min|mins|minutes?|m|metres?|meters?|km)?(?:\s*@\s*(\d+(?:\.\d+)?)\s*kg)?(?:\s*,\s*RIR\s*(\d))?$/i.exec(
        line,
      );
    if (!m) throw new Error(`Write each exercise as "A: Goblet squat, 3x10 @ 20 kg, RIR 2" or "B: Easy run, 1x20 min" (${line})`);
    const key = m[1].toUpperCase();
    const sets = Number(m[3]),
      amount = Number(m[4]),
      unit = (m[5] ?? "").toLowerCase();
    const work = !unit
      ? { reps: Math.round(amount) }
      : /^(s|sec)/.test(unit)
        ? { durationSeconds: Math.round(amount) }
        : unit.startsWith("min")
          ? { durationSeconds: Math.round(amount * 60) }
          : unit === "km"
            ? { distanceMeters: Math.round(amount * 1000) }
            : { distanceMeters: Math.round(amount) };
    sessions.set(key, [
      ...(sessions.get(key) ?? []),
      {
        name: m[2],
        sets,
        ...work,
        loadKg: Number(m[6] ?? 0),
        rir: Number(m[7] ?? 2),
        restSeconds: unit && sets === 1 ? 0 : 90,
        cue: "",
        alternatives: [],
      },
    ]);
  }
  if (!sessions.size) throw new Error("Add at least one exercise to the scenario week");
  return [...sessions].map(([sessionKey, exercises]) => ({ sessionKey, exercises }));
}

function QualificationCard({
  qualification,
  busy,
  act,
}: {
  qualification: any;
  busy: boolean;
  act: (fn: () => Promise<any>, success: string) => Promise<any>;
}) {
  const latest = qualification.latest;
  const [type, setType] = useState<"programme" | "adaptation">("programme");
  return (
    <section className="card">
      <h2>Plan qualification</h2>
      <p>
        {qualification.qualified
          ? "Qualified: confident plans are delivered automatically."
          : "Supervised: every plan comes to you until plan generation passes your held-out scenarios for the current Brain, model, bounds and threshold."}
      </p>
      <p className="muted">
        {qualification.adaptationQualified
          ? "Weekly adjustments are qualified too: confident ones are applied automatically."
          : "Weekly adjustments come to you until adaptation scenarios (one the Brain should apply, one for you) pass as well."}
      </p>
      {latest && (
        <p className="muted">
          Latest run {latest.status} ({latest.passed} of {latest.total})
          {latest.current ? "" : " — for an earlier Brain, bounds, threshold or scenario set"}
        </p>
      )}
      {latest?.outcomes?.some((o: any) => !o.passed) && (
        <ul className="plan-reasons">
          {latest.outcomes
            .filter((o: any) => !o.passed)
            .map((o: any) => (
              <li key={o.scenarioId}>
                {qualification.scenarios.find((s: any) => s.id === o.scenarioId)?.title ?? "Scenario"}:
                expected {o.expected === "review" ? "review by you" : "automatic"}, the Brain
                routed it {o.route === "automatic" ? "automatically" : "to you"}
                {o.reasons?.length ? ` (${o.reasons.slice(0, 2).join("; ")})` : ""}
              </li>
            ))}
        </ul>
      )}
      <ul className="plan-reasons">
        {qualification.scenarios.map((s: any) => (
          <li key={s.id}>
            <strong>{s.title}</strong> ·{" "}
            {s.type === "adaptation" ? "weekly adjustment, " : ""}
            {s.profile.experience}, {s.profile.daysPerWeek} days
            {s.type === "adaptation"
              ? `, ${Math.round((s.outcomes?.adherence ?? 0) * 100)}% done`
              : `, ${s.programmeDays} days`}{" "}
            · expect {s.expected === "review" ? "review by you" : "automatic"}{" "}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    api(`/brain/plans/scenarios/${s.id}/archive`, "POST", {
                      version: s.version,
                    }),
                  "Scenario archived",
                )
              }
            >
              Archive
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget,
            f = new FormData(form);
          const profile = {
            goal: f.get("goal"),
            experience: f.get("experience"),
            daysPerWeek: Number(f.get("daysPerWeek")),
            equipment: f.get("equipment"),
            limitations: f.get("limitations"),
          };
          void act(
            () =>
              api(
                "/brain/plans/scenarios",
                "POST",
                type === "adaptation"
                  ? {
                      type: "adaptation",
                      title: f.get("title"),
                      expected: f.get("expected"),
                      profile,
                      week: parseScenarioWeek(String(f.get("week") ?? "")),
                      outcomes: {
                        adherence: Number(f.get("adherence")) / 100,
                        rirDelta: Number(f.get("rirDelta")),
                        painReported: f.get("painReported") === "on",
                      },
                    }
                  : {
                      title: f.get("title"),
                      programmeDays: Number(f.get("programmeDays")),
                      expected: f.get("expected"),
                      profile,
                    },
              ),
            "Held-out scenario saved",
          ).then((r) => r && form.reset());
        }}
      >
        <h3>Add a held-out scenario</h3>
        <div className="form-grid">
          <Field label="Scenario type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "programme" | "adaptation")}
            >
              <option value="programme">A new programme</option>
              <option value="adaptation">A weekly adjustment</option>
            </select>
          </Field>
          <Field label="Title">
            <input name="title" required minLength={3} maxLength={150} />
          </Field>
          <Field label="Goal">
            <input name="goal" required minLength={3} maxLength={1000} />
          </Field>
          <Field label="Experience">
            <select name="experience" defaultValue="beginner">
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </Field>
          <Field label="Days per week">
            <input name="daysPerWeek" type="number" min={1} max={7} defaultValue={3} required />
          </Field>
          <Field label="Equipment">
            <input name="equipment" maxLength={1000} />
          </Field>
          <Field label="Limitations">
            <input name="limitations" maxLength={2000} defaultValue="None reported" />
          </Field>
          {type === "programme" ? (
            <Field label="Programme days">
              <input name="programmeDays" type="number" min={7} max={365} defaultValue={28} required />
            </Field>
          ) : (
            <>
              <Field label="Share of the week completed (%)">
                <input name="adherence" type="number" min={0} max={100} defaultValue={100} required />
              </Field>
              <Field label="Effort against the plan (RIR difference)">
                <select name="rirDelta" defaultValue="0">
                  <option value="-2">Much harder than planned (−2)</option>
                  <option value="-1">Harder than planned (−1)</option>
                  <option value="0">As planned</option>
                  <option value="1">Easier than planned (+1)</option>
                  <option value="2">Much easier than planned (+2)</option>
                </select>
              </Field>
              <Field label="Pain reported this week">
                <input name="painReported" type="checkbox" />
              </Field>
            </>
          )}
          <Field label="Expected result">
            <select name="expected" defaultValue="deliverable">
              <option value="deliverable">
                {type === "programme" ? "Delivered automatically" : "Applied automatically"}
              </option>
              <option value="review">Must come to me</option>
            </select>
          </Field>
        </div>
        {type === "adaptation" && (
          <Field label="The prescribed week (one exercise per line, e.g. A: Goblet squat, 3x10 @ 20 kg, RIR 2 or B: Easy run, 1x20 min)">
            <textarea name="week" rows={4} required maxLength={4000} />
          </Field>
        )}
        <div className="button-row">
          <button className="button secondary" disabled={busy}>
            Save scenario
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void act(
                () => api("/brain/plans/qualify", "POST", {}),
                "Qualification finished",
              )
            }
          >
            Run qualification
          </button>
        </div>
      </form>
    </section>
  );
}

function LibraryCard({
  library,
  busy,
  act,
}: {
  library: any[];
  busy: boolean;
  act: (fn: () => Promise<any>, success: string) => Promise<any>;
}) {
  const untagged = library.filter((e) => !Array.isArray(e.equipment));
  return (
    <section className="card">
      <h2>Library equipment</h2>
      <p className="muted">
        The Brain may use only your library exercises and their approved
        alternatives. Tag the equipment each needs so plans are checked against
        every subscriber&rsquo;s equipment: a plan using an untagged exercise or
        alternative comes to you instead of going out automatically (unless the
        subscriber has a full gym). Add an alternative as its own library
        exercise to tag it. {untagged.length} of {library.length} untagged.
      </p>
      <ul className="plan-library">
        {library.map((e) => (
          <li key={e.id}>
            <form
              className="plan-exercise-row"
              onSubmit={(event) => {
                event.preventDefault();
                const f = new FormData(event.currentTarget);
                void act(
                  () =>
                    api(`/brain/plans/exercises/${e.id}/equipment`, "POST", {
                      version: e.version,
                      equipment: String(f.get("equipment") ?? "")
                        .split(",")
                        .map((s) => s.trim())
                        .filter((s) => s.length >= 2),
                    }),
                  "Equipment saved",
                );
              }}
            >
              <Field label={e.name}>
                <input
                  name="equipment"
                  defaultValue={(e.equipment ?? []).join(", ")}
                  placeholder="e.g. dumbbells, bench or bodyweight"
                />
              </Field>
              <button className="button secondary" disabled={busy}>
                Save
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BrainPlans({ role }: { role: string }) {
  const [data, setData] = useState<any>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [member, setMember] = useState("");
  const owner = role === "owner";
  const load = async () => setData(await api("/brain/plans/workspace"));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function act(fn: () => Promise<any>, success: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const r = await fn();
      await load();
      setMessage(success);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const names: string[] = (data?.library ?? []).map((e: any) => e.name);
  return (
    <>
      <div className="page-heading">
        <h1>Plans your Brain writes</h1>
        <p className="muted">
          Your Brain prepares each subscriber&rsquo;s programme from your rules,
          cases and reviewed plans, delivers the ones it is confident about and
          sends the rest to you. Every decision you make teaches it.
        </p>
      </div>
      <nav className="button-row" aria-label="Brain sections">
        <a className="button secondary" href="/trainer/brain">
          Brain overview
        </a>
        <a className="button secondary" href="/trainer/brain/teaching">
          Teach through cases
        </a>
        <a className="button" href="/trainer/brain/plans" aria-current="page">
          Plans
        </a>
      </nav>
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
      {!data && !error && <p>Loading your plans…</p>}
      {data && (
        <>
          <section className="card">
            <h2>Status</h2>
            {!data.modelConfigured && (
              <p className="notice">
                No coaching model is configured, so the Brain cannot prepare
                plans yet. Your platform administrator enables it.
              </p>
            )}
            <div className="plan-stats">
              <p>
                <strong>{data.qualification.qualified ? "Qualified" : "Supervised"}</strong>
                <span className="muted">delivery mode</span>
              </p>
              <p>
                <strong>{data.stats.pending}</strong>
                <span className="muted">waiting for you</span>
              </p>
              <p>
                <strong>{data.stats.automatic}</strong>
                <span className="muted">delivered automatically (90 days)</span>
              </p>
              <p>
                <strong>{percent(data.stats.averageConfidence)}</strong>
                <span className="muted">average confidence</span>
              </p>
              <p>
                <strong>{data.stats.reviewed}</strong>
                <span className="muted">
                  reviews learned{data.stats.young ? " (still young)" : ""}
                </span>
              </p>
            </div>
          </section>
          <section>
            <h2>Review queue</h2>
            {!data.queue.length && (
              <p className="muted">Nothing is waiting for you.</p>
            )}
            {data.queue.map((item: any) => (
              <ReviewItem
                key={item.id + ":" + item.version}
                item={item}
                names={names}
                busy={busy}
                act={act}
              />
            ))}
          </section>
          <section className="card">
            <h2>Prepare a plan now</h2>
            <p className="muted">
              The Brain also prepares plans on its own after intake and before
              each block ends.
            </p>
            <div className="plan-exercise-row">
              <Field label="Subscriber">
                <select value={member} onChange={(e) => setMember(e.target.value)}>
                  <option value="">Choose a subscriber</option>
                  {data.members.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                className="button"
                disabled={busy || !member || !data.modelConfigured}
                onClick={() =>
                  void act(
                    () => api("/brain/plans/generate", "POST", { subscriberId: member }),
                    "The Brain prepared a plan",
                  )
                }
              >
                Prepare plan
              </button>
            </div>
          </section>
          {owner && (
            <SettingsCard
              key={data.settingsVersion ?? "default"}
              settings={data.settings}
              version={data.settingsVersion}
              busy={busy}
              act={act}
            />
          )}
          <section className="card">
            <h2>What the Brain has learned</h2>
            {!data.stats.segments.length && (
              <p className="muted">
                No reviewed plans yet. Each approval, edit or rejection becomes
                a private example for similar subscribers.
              </p>
            )}
            <ul className="plan-reasons">
              {data.stats.segments.map((s: any) => (
                <li key={s.goal + s.experience}>
                  {label(s.goal)} · {s.experience}: {s.approved} approved,{" "}
                  {s.edited} edited, {s.rejected} rejected
                </li>
              ))}
            </ul>
            <h3>Recent plans</h3>
            <ul className="plan-reasons">
              {data.recent.map((r: any) => (
                <li key={r.id}>
                  {new Date(r.createdAt).toLocaleDateString()} · {r.subscriberName} ·{" "}
                  {r.type} · {label(r.status)}
                  {r.decision ? ` (${r.decision})` : ""} · confidence{" "}
                  {percent(r.score)}
                </li>
              ))}
            </ul>
          </section>
          <LibraryCard library={data.library} busy={busy} act={act} />
          {owner && (
            <QualificationCard
              qualification={data.qualification}
              busy={busy}
              act={act}
            />
          )}
        </>
      )}
    </>
  );
}

const MEMBER_STATE: Record<string, string> = {
  preparing: "Your trainer's Brain is preparing your plan from your profile.",
  in_review: "Your trainer is reviewing your plan before it reaches you.",
  delivered: "Your plan is ready.",
  with_trainer: "Your trainer is preparing your plan personally.",
};
/** The subscriber's generated plan and its state. */
export function MemberPlan() {
  const [data, setData] = useState<any>();
  useEffect(() => {
    void api("/brain/plans/mine")
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data || (!data.status && !data.program)) return null;
  const p = data.program;
  return (
    <section className="card member-plan">
      <h2>{p ? p.title : "Your plan"}</h2>
      {data.status && (
        <p role="status">{MEMBER_STATE[data.status.state] ?? MEMBER_STATE.preparing}</p>
      )}
      {p && (
        <>
          {p.summary && <p className="muted">{p.summary}</p>}
          <p className="muted">
            {p.startDate} to {p.endDate} · {p.programmeDays} days
          </p>
          <ol className="plan-weeks">
            {p.weeks.map((w: any) => (
              <li key={w.week}>
                Week {w.week}: {w.focus}
                {w.deload ? " (lighter recovery week)" : ""}
              </li>
            ))}
          </ol>
          <h3>Coming up</h3>
          {!data.upcoming.length && (
            <p className="muted">No sessions left in this block.</p>
          )}
          {data.upcoming.map((s: any) => (
            <div key={s.id} className="plan-session">
              <h4>
                {s.date} · {s.label} · week {s.week}
              </h4>
              <ExerciseRows
                legend={s.label}
                exercises={(s.exercises ?? []).map((e: any) => ({
                  ...e,
                  alternatives: (e.alternatives ?? []).map((a: any) => a.name ?? a),
                }))}
                names={[]}
              />
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/** Shown with the intake form: what happens after the subscriber saves it. */
export function PlanIntakeNotice() {
  return (
    <p className="muted plan-intake-notice">
      When you save this, your trainer&rsquo;s Brain prepares your training
      plan from it: your goal, experience, training days and equipment. Your
      trainer reviews it whenever the Brain is not sure. Anything you list as a
      limitation, and any pain you report later, always goes to your trainer
      personally.
    </p>
  );
}
