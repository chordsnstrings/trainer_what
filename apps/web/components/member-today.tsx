"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight } from "lucide-react";
import { resolveBrandDesign } from "@trainer/contracts";
import { calendarDate, formatDate } from "../lib/format";
import { CoachSwitcher } from "./joining";
import { EndOfProgramme } from "./programme-today";
import { BrandImage } from "./trainer-design";
import {
  todayFocus,
  todayStatus,
  type ActiveWorkout,
  type TodayAction,
  type TodayProgramme,
} from "./member-today-model";

/**
 * The member's Today screen, phone first (docs/features/member-screens.md):
 * a greeting, what to do now with one primary action at the top, a compact
 * status, the coach's note and what happens when the programme ends. About
 * two phone screens for a normal day; the tab bar covers navigation, so
 * there are no navigation cards or repeated totals here.
 */
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "Something went wrong"), {
      status: r.status,
      code: data.code,
    });
  return data;
}
function zoneQuery() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone ? `?timezone=${encodeURIComponent(zone)}` : "";
  } catch {
    return "";
  }
}

/**
 * The last Today answer for this member, kept in this tab's memory like the
 * workspace's member state, so returning to Today shows it at once and
 * refreshes quietly.
 */
let lastToday: { key: string; data: TodayProgramme } | null = null;

type Row = { id: string; kind: string; status: string; data: any };

export function activeWorkoutOf(
  records: Row[],
  sets: Array<{ workout_id?: string }>,
): ActiveWorkout | null {
  const w = records.find((r) => r.kind === "workout" && r.status === "active");
  if (!w) return null;
  const exercises: any[] = w.data?.program?.exercises ?? [];
  return {
    id: w.id,
    title: w.data?.program?.title ?? "Your workout",
    logged: sets.filter((s) => s.workout_id === w.id).length,
    total: exercises.reduce(
      (sum, e) => sum + (Number.isFinite(e?.sets) ? Number(e.sets) : 0),
      0,
    ),
  };
}

/** Whether a workout was finished on this calendar day (device time). */
export function finishedOn(records: Row[], day: string) {
  return records.some(
    (r) =>
      r.kind === "workout" &&
      r.status === "completed" &&
      typeof r.data?.completedAt === "string" &&
      calendarDate(r.data.completedAt) === day,
  );
}

export function MemberToday({
  state,
  programLabel,
  nutrition,
}: {
  state: any;
  programLabel: string;
  nutrition: boolean;
}) {
  const router = useRouter();
  const key = `${state.user.tenantId}:${state.user.userId}`;
  const [data, setData] = useState<TodayProgramme | null>(() =>
      lastToday?.key === key ? lastToday.data : null,
    ),
    [failed, setFailed] = useState(false),
    [starting, setStarting] = useState(false),
    [startError, setStartError] = useState("");
  const load = useCallback(
    () =>
      api("/programme/today" + zoneQuery()).then(
        (d) => {
          lastToday = { key, data: d };
          setData(d);
          setFailed(false);
        },
        () => setFailed(true),
      ),
    [key],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const hold = (state.records as Row[]).find(
    (r) => r.kind === "training_hold" && r.status === "active",
  );
  const active = activeWorkoutOf(state.records, state.sets ?? []);
  const completedToday = !!data?.today && finishedOn(state.records, data.today);
  const focus = todayFocus({
    data,
    active,
    programLabel,
    nutrition,
    completedToday,
  });
  const status = todayStatus(data);
  const firstName = String(state.user.name ?? "").split(" ")[0];
  const start = async (action: Extract<TodayAction, { kind: "start" }>) => {
    setStarting(true);
    setStartError("");
    try {
      const workout = await api("/workouts/start", "POST", {
        programId: action.programId,
        ...(action.plannedSessionId
          ? { plannedSessionId: action.plannedSessionId }
          : {}),
      });
      router.push(`/app/workouts/${workout.id}`);
    } catch (e: any) {
      setStartError(
        e.code === "WORKOUT_ACTIVE"
          ? "You already have a workout in progress. Finish or end it first."
          : e.code === "SESSION_CHANGED"
            ? "Your coach just changed this session. Open your plan to see the new one."
            : "The session could not be started. Check your connection and try again.",
      );
      setStarting(false);
    }
  };
  return (
    <div className="member-today">
      <header className="today-greeting">
        <p className="eyebrow">
          {formatDate(new Date(), {
            weekday: "long",
            longMonth: true,
            year: false,
          })}
        </p>
        <h1>Good to see you, {firstName}.</h1>
      </header>
      {hold ? (
        <section
          className="card today-focus is-hold"
          role="status"
          aria-labelledby="today-focus-title"
        >
          <p className="small-label">Safety pause</p>
          <h2 id="today-focus-title">Your training is paused</h2>
          {hold.data?.reason && <p>{hold.data.reason}</p>}
          <p className="muted">
            Your coach reviews this before your next session. Seek urgent local
            medical help for severe or urgent symptoms.
          </p>
          <Link className="button" href="/app/chat">
            Message your coach
          </Link>
        </section>
      ) : !data && !active && !failed ? (
        <section className="card today-focus" aria-busy="true">
          <p className="small-label">Today</p>
          <p className="muted">Loading your day…</p>
        </section>
      ) : !data && !active && failed ? (
        <section className="card today-focus" role="alert">
          <p className="small-label">Today</p>
          <h2>Today&apos;s plan could not be loaded</h2>
          <p className="muted">Check your connection, then try again.</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => void load()}
          >
            Try again
          </button>
        </section>
      ) : (
        <section
          className={
            "card today-focus" + (focus.tone ? ` is-${focus.tone}` : "")
          }
          aria-labelledby="today-focus-title"
        >
          <p className="small-label">{focus.label}</p>
          <h2 id="today-focus-title">{focus.title}</h2>
          {/* Isolated: a leading number ("3 exercises") and the full stop
              stay in place right to left. */}
          {focus.detail && (
            <p className="muted">
              <bdi>{focus.detail}</bdi>
            </p>
          )}
          {focus.action?.kind === "link" && (
            <Link className="button today-primary" href={focus.action.href}>
              {focus.action.label}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          )}
          {focus.action?.kind === "start" && (
            <button
              type="button"
              className="button today-primary"
              disabled={starting}
              onClick={() =>
                void start(
                  focus.action as Extract<TodayAction, { kind: "start" }>,
                )
              }
            >
              {starting ? "Opening your workout…" : focus.action.label}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          )}
          {startError && (
            <p className="notice error" role="alert">
              {startError}
            </p>
          )}
          {focus.next && (
            <p className="today-next">
              <bdi>{focus.next}</bdi>
            </p>
          )}
          {focus.secondary && (
            <Link className="today-secondary" href={focus.secondary.href}>
              {focus.secondary.label}
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          )}
        </section>
      )}
      {!hold && status.length > 0 && (
        <ul className="today-status" aria-label="Your progress">
          {status.map((tile) => (
            <li key={tile.label}>
              {tile.href ? (
                <Link href={tile.href}>
                  <span className="small-label">{tile.label}</span>
                  <strong>
                    <bdi>{tile.value}</bdi>
                  </strong>
                </Link>
              ) : (
                <div>
                  <span className="small-label">{tile.label}</span>
                  <strong>
                    <bdi>{tile.value}</bdi>
                  </strong>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && !active && <EndOfProgramme data={data} />}
      <CoachSwitcher current={state.user.tenantId} userId={state.user.userId} />
      <CoachNote name={state.tenant.name} theme={state.tenant.theme} />
    </div>
  );
}

/** The coach's own note from Design Studio, compact. */
export function CoachNote({ name, theme }: { name: string; theme: unknown }) {
  const design = resolveBrandDesign(theme);
  return (
    <section
      className="card today-coach-note"
      aria-labelledby="coach-note-title"
    >
      {/* Sized in CSS (48 px), so nothing shifts when the photo loads. */}
      <BrandImage
        src={design.photoUrl}
        alt=""
        className="today-coach-photo"
        fallback={
          <span className="avatar today-coach-photo" aria-hidden="true">
            {name.slice(0, 1)}
          </span>
        }
      />
      <div>
        <p className="small-label" id="coach-note-title">
          A note from {name}
        </p>
        <p>
          {design.welcome ||
            "Welcome to your coaching space. Make room for one positive step today. Your plan and your coach are right here."}
        </p>
      </div>
    </section>
  );
}
