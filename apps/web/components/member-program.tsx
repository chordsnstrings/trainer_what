"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Field } from "./field";
import { BottomSheet } from "./phone-ui";
import { TrainingHoldNotice } from "./coaching-completion";
import { MemberPlan } from "./brain-plans";
import {
  addCalendarDays,
  calendarDate,
  formatDate,
  nextDays,
  plural,
} from "../lib/format";

/**
 * The member's programme tab (/app/program), phone first
 * (docs/features/member-screens.md): what is up next with one primary
 * action, the plan and its exercises in plain words, and the next sessions
 * of the calendar (the whole block is on the timeline). Read from the
 * assigned programme and its planned sessions (/training/overview): the same
 * source as Today and the timeline.
 */
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(d.message ?? "Something went wrong"), {
      code: d.code,
      status: r.status,
    });
  return d;
}

/** "3 × 10 reps · 16 kg · rest 90 s · leave 2 reps in reserve". */
export function prescription(e: any) {
  const parts: string[] = [];
  if (e.sets && e.reps) parts.push(`${e.sets} × ${e.reps} reps`);
  else if (e.sets && e.seconds) parts.push(`${e.sets} × ${e.seconds} s`);
  else if (e.sets) parts.push(plural(e.sets, "set"));
  if (typeof e.loadKg === "number" && e.loadKg > 0)
    parts.push(`${e.loadKg} kg`);
  if (typeof e.restSeconds === "number" && e.restSeconds > 0)
    parts.push(`rest ${e.restSeconds} s`);
  if (typeof e.rir === "number")
    parts.push(`leave ${plural(e.rir, "rep")} in reserve`);
  return parts.join(" · ");
}

/** "Today", "Tomorrow" or "Thu 1 Oct" for a calendar date. */
export function sessionDay(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addCalendarDays(today, 1)) return "Tomorrow";
  return formatDate(date, { weekday: true, year: false });
}

/**
 * Days a planned session can move to: the next 14 days, without days that
 * already have another planned or started session (the API refuses those),
 * keeping the session's own day so the picker opens on it.
 */
export function moveChoices(today: string, session: any, planned: any[]) {
  const taken = new Set(
    planned
      .filter(
        (p) => p.id !== session.id && ["planned", "started"].includes(p.status),
      )
      .map((p) => String(p.data.date)),
  );
  return nextDays(today).filter(
    (day) => day.value === session.data.date || !taken.has(day.value),
  );
}

type Sheet =
  | { kind: "options"; session: any }
  | { kind: "move"; session: any }
  | { kind: "skip"; session: any }
  | null;

export function MemberProgram({
  state,
  programLabel,
}: {
  state: any;
  programLabel: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [sheet, setSheet] = useState<Sheet>(null);
  const load = useCallback(
    () =>
      api("/training/overview").then(
        (d) => {
          setData(d);
          setError("");
        },
        () =>
          setError(
            "Your plan could not be loaded. Check your connection, then try again.",
          ),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const records: any[] = data?.records ?? [];
  const today = calendarDate(new Date());
  const programs = records.filter(
    (r) => r.kind === "program" && r.status === "assigned",
  );
  const planned = records
    .filter((r) => r.kind === "planned_session")
    .sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)));
  const upcoming = planned.filter(
    (p) =>
      (p.status === "planned" && p.data.date >= today) ||
      p.status === "started",
  );
  const active =
    records.find((r) => r.kind === "workout" && r.status === "active") ??
    state.records?.find(
      (r: any) => r.kind === "workout" && r.status === "active",
    );
  const next = upcoming[0] ?? null;
  const start = async (programId: string, plannedSessionId?: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await api("/workouts/start", "POST", {
        programId,
        ...(plannedSessionId ? { plannedSessionId } : {}),
      });
      router.push(`/app/workouts/${r.id}`);
    } catch (e: any) {
      setError(
        e.code === "WORKOUT_ACTIVE"
          ? "You already have a workout in progress. Finish or end it first."
          : e.code === "SESSION_CHANGED"
            ? "Your coach just changed this session. The plan below is up to date."
            : "The session could not be started. Check your connection and try again.",
      );
      if (e.code === "SESSION_CHANGED") void load();
      setBusy(false);
    }
  };
  const submitSheet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sheet) return;
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (sheet.kind === "move")
        await api(`/training/sessions/${sheet.session.id}/reschedule`, "POST", {
          version: sheet.session.version,
          date: f.get("date"),
          note: f.get("note"),
        });
      else
        await api(`/training/sessions/${sheet.session.id}/cancel`, "POST", {
          version: sheet.session.version,
          note: f.get("note"),
        });
      setNotice(
        sheet.kind === "move"
          ? `Moved to ${formatDate(String(f.get("date")), { weekday: true, year: false })}. Your coach can see the change.`
          : "Session skipped. Your coach can see why.",
      );
      setSheet(null);
      await load();
    } catch (e: any) {
      setError(
        e.message && !/^[A-Z_]+$/.test(e.message)
          ? e.message
          : "That change could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="member-program">
      <header className="page-heading">
        <h1>Your training plan</h1>
      </header>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      <TrainingHoldNotice records={records} />
      <MemberPlan />
      {!data && !error && (
        <section className="card" aria-busy="true">
          <p className="muted">Loading your plan…</p>
        </section>
      )}
      {data && active && (
        <section className="card program-next" aria-labelledby="program-active">
          <p className="small-label">In progress</p>
          <h2 id="program-active">
            {active.data?.program?.title ?? "Your workout"}
          </h2>
          <Link className="button" href={`/app/workouts/${active.id}`}>
            Continue workout <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
      )}
      {data && !active && next && (
        <section className="card program-next" aria-labelledby="program-next">
          <p className="small-label">
            Up next · {sessionDay(next.data.date, today)}
          </p>
          <h2 id="program-next">{next.data.label || "Training session"}</h2>
          <p className="muted">
            <bdi>
              {plural(next.data.program?.exercises?.length ?? 0, "exercise")}
              {next.data.week ? ` · week ${next.data.week}` : ""}
            </bdi>
          </p>
          {next.status === "started" && next.data.workoutId ? (
            <Link
              className="button"
              href={`/app/workouts/${next.data.workoutId}`}
            >
              Continue session <ArrowRight size={18} aria-hidden="true" />
            </Link>
          ) : (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void start(next.data.programId, next.id)}
            >
              {busy ? "Opening your workout…" : "Start this session"}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          )}
        </section>
      )}
      {data && !programs.length && !planned.length && (
        <section className="card" role="status">
          <h2>Your coach is preparing your plan</h2>
          <p className="muted">
            Your sessions appear here as soon as it is ready.
          </p>
          <Link className="button secondary" href="/app/chat">
            Message your coach
          </Link>
        </section>
      )}
      {programs.map((p) => {
        const scheduled = planned.some((s) => s.data.programId === p.id);
        const sessions: any[] = p.data.sessions ?? [
          { label: p.data.title, exercises: p.data.exercises ?? [] },
        ];
        return (
          <section
            className="card program-plan"
            key={p.id}
            aria-labelledby={`plan-${p.id}`}
          >
            <h2 id={`plan-${p.id}`}>{p.data.title}</h2>
            {p.data.goal && <p>{p.data.goal}</p>}
            <p className="muted">
              <bdi>
                {plural(p.data.weeks ?? 4, "week")} ·{" "}
                {plural(p.data.daysPerWeek ?? sessions.length, "session")} a
                week
              </bdi>
            </p>
            {sessions.map((s, i) => (
              <details key={i} className="program-session" open={i === 0}>
                <summary>
                  {s.label || `Session ${i + 1}`}{" "}
                  <span className="muted">
                    · {plural(s.exercises?.length ?? 0, "exercise")}
                  </span>
                </summary>
                <ul className="program-exercises">
                  {(s.exercises ?? []).map((e: any) => (
                    <li key={e.name}>
                      <strong>{e.name}</strong>
                      <span className="muted">
                        <bdi>{prescription(e)}</bdi>
                      </span>
                      {e.cue && <span>{e.cue}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {!scheduled && !active && (
              <>
                <p className="muted">
                  Train these sessions on the days that suit you.
                </p>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => void start(p.id)}
                >
                  Start workout
                </button>
              </>
            )}
          </section>
        );
      })}
      {upcoming.length > 1 && (
        <section className="card" aria-labelledby="program-calendar">
          <h2 id="program-calendar">Coming up</h2>
          <ul className="program-calendar">
            {upcoming.slice(1, 7).map((s) => (
              <li key={s.id}>
                <div>
                  <span className="program-calendar-day">
                    {sessionDay(s.data.date, today)}
                  </span>
                  <strong>{s.data.label || "Training session"}</strong>
                </div>
                {s.status === "planned" && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    aria-label={`Change ${s.data.label || "session"} on ${sessionDay(s.data.date, today)}`}
                    onClick={() => setSheet({ kind: "options", session: s })}
                  >
                    Change
                  </button>
                )}
              </li>
            ))}
          </ul>
          <Link className="text-link" href="/app/timeline">
            See every day of this block
          </Link>
        </section>
      )}
      {upcoming.length <= 1 && planned.length > 0 && (
        <p>
          <Link className="text-link" href="/app/timeline">
            See every day of this block
          </Link>
        </p>
      )}
      {/* Choices for one session: move, skip or prepare it voice-led. */}
      <BottomSheet
        open={sheet?.kind === "options"}
        onClose={() => setSheet(null)}
        title="Change this session"
        description={
          sheet
            ? `${sheet.session.data.label || "Training session"} · ${formatDate(sheet.session.data.date, { weekday: true, year: false })}`
            : undefined
        }
      >
        {sheet && (
          <div className="sheet-choices">
            <button
              type="button"
              className="button secondary"
              onClick={() => setSheet({ kind: "move", session: sheet.session })}
            >
              Move to another day
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setSheet({ kind: "skip", session: sheet.session })}
            >
              Skip this session
            </button>
            <Link
              className="button secondary"
              href={`/app/voice-session/planned/${sheet.session.id}`}
            >
              Prepare it as a voice-led session
            </Link>
          </div>
        )}
      </BottomSheet>
      <BottomSheet
        open={sheet?.kind === "move" || sheet?.kind === "skip"}
        onClose={() => setSheet(null)}
        title={
          sheet?.kind === "skip" ? "Skip this session?" : "Move this session"
        }
        description={
          sheet
            ? `${sheet.session.data.label || "Training session"} · ${formatDate(sheet.session.data.date, { weekday: true, year: false })}`
            : undefined
        }
        footer={
          <>
            <button
              type="button"
              className="button secondary"
              onClick={() => setSheet(null)}
            >
              Keep it
            </button>
            <button
              type="submit"
              form="program-sheet-form"
              className="button"
              disabled={busy}
            >
              {sheet?.kind === "skip" ? "Skip session" : "Save new date"}
            </button>
          </>
        }
      >
        {sheet && sheet.kind !== "options" && (
          <form id="program-sheet-form" onSubmit={(e) => void submitSheet(e)}>
            {sheet.kind === "move" && (
              <Field label="New day">
                {/* The next two weeks as plain days (never a US-style date
                    field), without days that already have a session. */}
                <select
                  name="date"
                  defaultValue={sheet.session.data.date}
                  required
                  data-autofocus
                >
                  {moveChoices(today, sheet.session, planned).map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field
              label={
                sheet.kind === "move"
                  ? "Why are you moving it?"
                  : "Why are you skipping it?"
              }
            >
              <input
                name="note"
                required
                minLength={3}
                maxLength={1000}
                enterKeyHint="done"
                autoComplete="off"
                {...(sheet.kind === "skip" ? { "data-autofocus": true } : {})}
              />
            </Field>
            <small>Your coach sees this note.</small>
          </form>
        )}
      </BottomSheet>
    </div>
  );
}
