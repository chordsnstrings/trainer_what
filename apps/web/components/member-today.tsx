"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight } from "lucide-react";
import { resolveBrandDesign } from "@trainer/contracts";
import { calendarDate, formatDate } from "../lib/format";
import { useLocale, useT } from "../lib/i18n/react";
import { CoachSwitcher } from "./joining";
import { EndOfProgramme } from "./programme-today";
import { BrandImage } from "./trainer-design";
import { CountUp, Meter, Skeleton } from "./phone-ui";
import { InstallCard } from "./pwa-ui";
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
 *
 * In the member's language (docs/features/arabic.md). Motion
 * (docs/features/motion.md): on the first view its blocks settle in one
 * after another (`data-stagger`, the shell's arrival), the loading state is
 * a skeleton, the programme and calorie bars grow to their value and the
 * streak counts up once.
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
    title: w.data?.program?.title ?? "",
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
  const t = useT("today"),
    locale = useLocale();
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
  const found = activeWorkoutOf(state.records, state.sets ?? []);
  const active = found
    ? { ...found, title: found.title || t("fYourWorkout") }
    : null;
  const completedToday = !!data?.today && finishedOn(state.records, data.today);
  const focus = todayFocus({
    data,
    active,
    programLabel,
    nutrition,
    completedToday,
    locale,
  });
  const status = todayStatus(data, locale);
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
          ? t("fErrActive")
          : e.code === "SESSION_CHANGED"
            ? t("fErrChanged")
            : t("fErrStart"),
      );
      setStarting(false);
    }
  };
  return (
    <div className="member-today" data-stagger>
      <header className="today-greeting">
        <p className="eyebrow">
          {formatDate(new Date(), {
            weekday: "long",
            longMonth: true,
            year: false,
            locale,
          })}
        </p>
        <h1>{t("greeting", { name: firstName })}</h1>
      </header>
      {hold ? (
        <section
          className="card today-focus is-hold"
          role="status"
          aria-labelledby="today-focus-title"
        >
          <p className="small-label">{t("fSafetyPause")}</p>
          <h2 id="today-focus-title">{t("fPausedTitle")}</h2>
          {hold.data?.reason && <p dir="auto">{hold.data.reason}</p>}
          <p className="muted">{t("fPausedText")}</p>
          <Link className="button" href="/app/chat">
            {t("fMessageCoach")}
          </Link>
        </section>
      ) : !data && !active && !failed ? (
        <section className="card today-focus">
          <Skeleton label={t("fLoadingDay")} lines={3} />
        </section>
      ) : !data && !active && failed ? (
        <section className="card today-focus" role="alert">
          <p className="small-label">{t("fToday")}</p>
          <h2>{t("fLoadFailedTitle")}</h2>
          <p className="muted">{t("fCheckConnection")}</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => void load()}
          >
            {t("tryAgain")}
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
          <h2 id="today-focus-title" dir="auto">
            {focus.title}
          </h2>
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
              {starting ? t("fOpening") : focus.action.label}
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
        <ul className="today-status" aria-label={t("fProgressAria")}>
          {status.map((tile) => {
            const body = (
              <>
                <span className="small-label">{tile.label}</span>
                <strong>
                  <bdi>
                    {/* The streak counts up once (docs/features/motion.md "g"). */}
                    {tile.count !== undefined ? (
                      <CountUp
                        value={tile.count}
                        format={(v) => t("sStreakValue", { count: v })}
                        memoryKey="today:streak"
                      />
                    ) : (
                      tile.value
                    )}
                  </bdi>
                </strong>
                {/* Bars grow to their value the first time they are seen,
                    and from the last value shown when it changed. */}
                {tile.meter && tile.meter.max > 0 && (
                  <Meter
                    value={tile.meter.value}
                    max={tile.meter.max}
                    label={tile.label}
                    className="programme-meter today-meter"
                    memoryKey={tile.meter.key}
                  />
                )}
              </>
            );
            return (
              <li key={tile.label}>
                {tile.href ? (
                  <Link href={tile.href}>{body}</Link>
                ) : (
                  <div>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data && !active && <EndOfProgramme data={data} />}
      <CoachSwitcher current={state.user.tenantId} userId={state.user.userId} />
      <CoachNote name={state.tenant.name} theme={state.tenant.theme} />
      {/* Last on Today: the day's work and the coach's note come first. */}
      <InstallCard
        coachName={state.tenant.name}
        tenantId={state.user.tenantId}
        userId={state.user.userId}
        loggedSession={
          (state.sets ?? []).length > 0 ||
          (state.records as Row[]).some(
            (r) => r.kind === "workout" && r.status === "completed",
          )
        }
      />
    </div>
  );
}

/** The coach's own note from Design Studio, compact. */
export function CoachNote({ name, theme }: { name: string; theme: unknown }) {
  const design = resolveBrandDesign(theme);
  const t = useT("today");
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
          {t("fNoteFrom", { name })}
        </p>
        <p dir={design.welcome ? "auto" : undefined}>
          {design.welcome || t("fWelcome")}
        </p>
      </div>
    </section>
  );
}
