"use client";
import { memberApiUrl } from "../lib/trainer-preview-routing";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "./preview-navigation";
import { useRouter } from "./preview-navigation";
import { ArrowRight } from "lucide-react";
import { Field } from "./field";
import { BottomSheet } from "./phone-ui";
import { TrainingHoldNotice } from "./coaching-completion";
import { MemberPlan } from "./brain-plans";
import {
  addCalendarDays,
  calendarDate,
  formatDate,
  formatSetsReps,
  formatWhen,
  nextDays,
} from "../lib/format";
import { translator, type Locale } from "../lib/i18n/core";
import planMessages from "../lib/i18n/messages/plan";
import { useLocale, useT } from "../lib/i18n/react";
import { Skeleton } from "./phone-ui";

/**
 * The member's programme tab (/app/program), phone first
 * (docs/features/member-screens.md): what is up next with one primary
 * action, the plan and its exercises in plain words, and the next sessions
 * of the calendar (the whole block is on the timeline). Read from the
 * assigned programme and its planned sessions (/training/overview): the same
 * source as Today and the timeline. In the member's language
 * (docs/features/arabic.md); its blocks settle in on the first view
 * (`data-stagger`) and the loading state is a skeleton.
 */
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(memberApiUrl("/api/v1" + path), {
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

/** The last whole number in "10" or "8-12" (for the unit's plural form). */
const lastNumber = (value: unknown) => {
  const found = String(value).match(/\d+(?:\.\d+)?(?!.*\d)/);
  return found ? Number(found[0]) : 0;
};

/**
 * "3 × 10 reps · 16 kg · rest 90 s · leave 2 reps in reserve"; Arabic
 * "3 × 10 تكرارات · 16 كغ · راحة 90 ث · مع ترك تكرارين احتياطيًا", with
 * "3 × 10" kept left to right as one piece.
 */
export function prescription(e: any, locale: Locale = "en") {
  const t = translator(planMessages, locale);
  const parts: string[] = [];
  if (e.sets && e.reps)
    parts.push(
      t("pxReps", {
        setsReps: formatSetsReps(e.sets, e.reps, locale),
        count: lastNumber(e.reps),
      }),
    );
  else if (e.sets && e.seconds)
    parts.push(
      t("pxSeconds", { setsSeconds: formatSetsReps(e.sets, e.seconds, locale) }),
    );
  else if (e.sets) parts.push(t("pxSets", { count: Number(e.sets) }));
  if (typeof e.loadKg === "number" && e.loadKg > 0)
    parts.push(t("pxLoad", { kg: e.loadKg }));
  if (typeof e.restSeconds === "number" && e.restSeconds > 0)
    parts.push(t("pxRest", { n: e.restSeconds }));
  if (typeof e.rir === "number") parts.push(t("pxRir", { count: e.rir }));
  return parts.join(" · ");
}

/** "Today", "Tomorrow" or "Thu 1 Oct" for a calendar date. */
export function sessionDay(date: string, today: string, locale: Locale = "en") {
  const t = translator(planMessages, locale);
  if (date === today) return t("today");
  if (date === addCalendarDays(today, 1)) return t("tomorrow");
  return formatDate(date, { weekday: true, year: false, locale });
}

/**
 * Days a planned session can move to: the next 14 days, without days that
 * already have another planned or started session (the API refuses those),
 * keeping the session's own day so the picker opens on it.
 */
export function moveChoices(
  today: string,
  session: any,
  planned: any[],
  locale: Locale = "en",
) {
  const taken = new Set(
    planned
      .filter(
        (p) => p.id !== session.id && ["planned", "started"].includes(p.status),
      )
      .map((p) => String(p.data.date)),
  );
  return nextDays(today, 14, locale).filter(
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
  const t = useT("plan"),
    locale = useLocale();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [sheet, setSheet] = useState<Sheet>(null),
    // The plan last loaded on this device, shown when it cannot load now.
    [savedAt, setSavedAt] = useState<number | null>(null);
  // "trainer:" keys are removed at sign-out (clearLocalData).
  const cacheKey = `trainer:overview:${state.user?.tenantId}:${state.user?.userId}`;
  const load = useCallback(
    () =>
      api("/training/overview").then(
        (d) => {
          setData(d);
          setError("");
          setSavedAt(null);
          try {
            localStorage.setItem(
              cacheKey,
              JSON.stringify({ savedAt: Date.now(), data: d }),
            );
          } catch {}
        },
        () => {
          let cached: { savedAt: number; data: any } | null = null;
          try {
            cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
          } catch {}
          if (cached?.data) {
            setData((current: any) => current ?? cached.data);
            setSavedAt(cached.savedAt);
            setError("");
          } else setError(t("loadFailed"));
        },
      ),
    [t, cacheKey],
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
          ? t("errActive")
          : e.code === "SESSION_CHANGED"
            ? t("errChanged")
            : t("errStart"),
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
          ? t("movedTo", {
              day: formatDate(String(f.get("date")), {
                weekday: true,
                year: false,
                locale,
              }),
            })
          : t("skippedNote"),
      );
      setSheet(null);
      await load();
    } catch (e: any) {
      // The server's own sentence is English; other languages get ours.
      setError(
        locale === "en" && e.message && !/^[A-Z_]+$/.test(e.message)
          ? e.message
          : t("saveFailed"),
      );
    } finally {
      setBusy(false);
    }
  };
  const sheetDescription = sheet
    ? t("sheetDescription", {
        label: sheet.session.data.label || t("trainingSession"),
        day: formatDate(sheet.session.data.date, {
          weekday: true,
          year: false,
          locale,
        }),
      })
    : undefined;
  return (
    <div className="member-program" data-stagger>
      <header className="page-heading">
        <h1>{t("title")}</h1>
      </header>
      {error && (
        <div role="alert" className="notice error">
          <p>{error}</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setError("");
              void load();
            }}
          >
            {t("tryAgain")}
          </button>
        </div>
      )}
      {savedAt !== null && (
        <div role="status" className="notice">
          <p>
            {t("savedPlan", {
              when: formatWhen(new Date(savedAt), { locale }),
            })}
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={() => void load()}
          >
            {t("tryAgain")}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      <TrainingHoldNotice records={records} />
      <MemberPlan />
      {!data && !error && (
        <section className="card">
          <Skeleton label={t("loading")} lines={4} />
        </section>
      )}
      {data && active && (
        <section className="card program-next" aria-labelledby="program-active">
          <p className="small-label">{t("inProgress")}</p>
          <h2 id="program-active" dir="auto">
            {active.data?.program?.title ?? t("yourWorkout")}
          </h2>
          <Link className="button" href={`/app/workouts/${active.id}`}>
            {t("continueWorkout")} <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
      )}
      {data && !active && next && (
        <section className="card program-next" aria-labelledby="program-next">
          <p className="small-label">
            {t("upNext", { day: sessionDay(next.data.date, today, locale) })}
          </p>
          <h2 id="program-next" dir="auto">
            {next.data.label || t("trainingSession")}
          </h2>
          <p className="muted">
            {t("exercises", {
              count: next.data.program?.exercises?.length ?? 0,
            })}
            {next.data.week ? t("week", { n: next.data.week }) : ""}
          </p>
          {next.status === "started" && next.data.workoutId ? (
            <Link
              className="button"
              href={`/app/workouts/${next.data.workoutId}`}
            >
              {t("continueSession")} <ArrowRight size={18} aria-hidden="true" />
            </Link>
          ) : (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void start(next.data.programId, next.id)}
            >
              {busy ? t("opening") : t("startThis")}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          )}
        </section>
      )}
      {data && !programs.length && !planned.length && (
        <section className="card" role="status">
          <h2>{t("preparing")}</h2>
          <p className="muted">{t("preparingText")}</p>
          <Link className="button secondary" href="/app/chat">
            {t("messageCoach")}
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
            <h2 id={`plan-${p.id}`} dir="auto">
              {p.data.title}
            </h2>
            {p.data.goal && <p dir="auto">{p.data.goal}</p>}
            <p className="muted">
              {t("planMeta", {
                weeks: t("weeks", { count: p.data.weeks ?? 4 }),
                perWeek: t("perWeek", {
                  count: p.data.daysPerWeek ?? sessions.length,
                }),
              })}
            </p>
            {sessions.map((s, i) => (
              <details key={i} className="program-session" open={i === 0}>
                <summary>
                  <bdi>{s.label || t("sessionN", { n: i + 1 })}</bdi>{" "}
                  <span className="muted">
                    · {t("exercises", { count: s.exercises?.length ?? 0 })}
                  </span>
                </summary>
                <ul className="program-exercises">
                  {(s.exercises ?? []).map((e: any) => (
                    <li key={e.name}>
                      <strong dir="auto">{e.name}</strong>
                      <span className="muted">{prescription(e, locale)}</span>
                      {e.cue && <span dir="auto">{e.cue}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {!scheduled && !active && (
              <>
                <p className="muted">{t("selfPaced")}</p>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => void start(p.id)}
                >
                  {t("startWorkout")}
                </button>
              </>
            )}
          </section>
        );
      })}
      {upcoming.length > 1 && (
        <section className="card" aria-labelledby="program-calendar">
          <h2 id="program-calendar">{t("comingUp")}</h2>
          <ul className="program-calendar">
            {upcoming.slice(1, 7).map((s) => (
              <li key={s.id}>
                <div>
                  <span className="program-calendar-day">
                    {sessionDay(s.data.date, today, locale)}
                  </span>
                  <strong dir="auto">
                    {s.data.label || t("trainingSession")}
                  </strong>
                </div>
                {s.status === "planned" && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    aria-label={t("changeAria", {
                      label: s.data.label || t("session"),
                      day: sessionDay(s.data.date, today, locale),
                    })}
                    onClick={() => setSheet({ kind: "options", session: s })}
                  >
                    {t("change")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <Link className="text-link" href="/app/timeline">
            {t("everyDay")}
          </Link>
        </section>
      )}
      {upcoming.length <= 1 && planned.length > 0 && (
        <p>
          <Link className="text-link" href="/app/timeline">
            {t("everyDay")}
          </Link>
        </p>
      )}
      {/* Choices for one session: move, skip or prepare it voice-led. */}
      <BottomSheet
        open={sheet?.kind === "options"}
        onClose={() => setSheet(null)}
        title={t("changeTitle")}
        description={sheetDescription}
      >
        {sheet && (
          <div className="sheet-choices">
            <button
              type="button"
              className="button secondary"
              onClick={() => setSheet({ kind: "move", session: sheet.session })}
            >
              {t("moveDay")}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setSheet({ kind: "skip", session: sheet.session })}
            >
              {t("skipThis")}
            </button>
            <Link
              className="button secondary"
              href={`/app/voice-session/planned/${sheet.session.id}`}
            >
              {t("prepareVoice")}
            </Link>
          </div>
        )}
      </BottomSheet>
      <BottomSheet
        open={sheet?.kind === "move" || sheet?.kind === "skip"}
        onClose={() => setSheet(null)}
        title={sheet?.kind === "skip" ? t("skipTitle") : t("moveTitle")}
        description={sheetDescription}
        footer={
          <>
            <button
              type="button"
              className="button secondary"
              onClick={() => setSheet(null)}
            >
              {t("keepIt")}
            </button>
            <button
              type="submit"
              form="program-sheet-form"
              className="button"
              disabled={busy}
            >
              {sheet?.kind === "skip" ? t("skipSession") : t("saveDate")}
            </button>
          </>
        }
      >
        {sheet && sheet.kind !== "options" && (
          <form id="program-sheet-form" onSubmit={(e) => void submitSheet(e)}>
            {sheet.kind === "move" && (
              <Field label={t("newDay")}>
                {/* The next two weeks as plain days (never a US-style date
                    field), without days that already have a session. */}
                <select
                  name="date"
                  defaultValue={sheet.session.data.date}
                  required
                  data-autofocus
                >
                  {moveChoices(today, sheet.session, planned, locale).map(
                    (day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ),
                  )}
                </select>
              </Field>
            )}
            <Field
              label={sheet.kind === "move" ? t("whyMove") : t("whySkip")}
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
            <small>{t("coachSees")}</small>
          </form>
        )}
      </BottomSheet>
    </div>
  );
}
