"use client";
import { isTrainerPreview } from "../lib/trainer-preview-routing";
import { TrainingPrograms } from "./training-workspace";
import { confirmWorkspace } from "./workspace-feedback";
import { Field } from "./field";
import { TrainingHoldNotice } from "./coaching-completion";
import { WorkoutTools } from "./training-workspace";
import {
  BottomSheet,
  DrawnCheck,
  NumberStepper,
  ProgressRing,
  StickyActionBar,
} from "./phone-ui";
import { haptic, prefersReducedMotion } from "./motion";
import { Rich, useErrorText, useLocale, useT } from "../lib/i18n/react";
import { formatCountdown, formatSetsReps } from "../lib/format";
import { WorkoutComplete } from "./programme-today";
import { painDescription } from "./pain-report";
import { setSchema } from "@trainer/contracts";
import {
  formatDistance,
  formatDuration,
  prescriptionText,
  workMeasure,
} from "../../../packages/domain/src/prescription.ts";
import { needsWorkoutSets } from "./workspace-paging";
import { QUEUED_LABEL, cacheNames, queuedLabel, queuedSummary } from "./pwa";
import {
  discardRejected,
  drainWorkoutQueue,
  offlineQueueKeys,
  readList,
  retryRejected,
  type RejectedEntry,
  type WorkoutQueueItem,
} from "./offline-queue";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "./preview-navigation";
import Link from "./preview-navigation";
import {
  Plus,
  Check,
  MessageCircle,
  Brain,
  AlertCircle,
  Play,
  CheckCircle,
} from "lucide-react";
import {
  type Row,
  api,
  Button,
  Empty,
  Badge,
  Card,
  Heading,
  type ViewProps,
  total,
} from "./workspace-ui";
export function Programs({ state }: ViewProps) { return <TrainingPrograms state={state}/>; }
/** Every set log of one workout (at most 500), newest first. */
export async function workoutSets(workoutId: string) {
  const sets: any[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ workoutId });
    if (cursor) params.set("cursor", cursor);
    const r = await api(`/workspace/pages/sets?${params}`);
    sets.push(...r.items);
    if (!r.hasMore) break;
    cursor = r.cursor;
  }
  return sets;
}
/**
 * An older workout outside the bootstrap's first page is fetched by address,
 * with its set logs, so every session in the history can still be opened; a
 * listed workout gets its set logs the same way when the bootstrap's recent
 * set logs do not cover it.
 */
export function useListedOrFetchedWorkout(
  listed: Row | undefined,
  workoutId: string,
  fetchListedSets: boolean,
) {
  const [fetched, setFetched] = useState<{
    id: string;
    workout?: Row;
    sets: any[];
  } | null>(null);
  const isListed = !!listed;
  useEffect(() => {
    if (!workoutId || !navigator.onLine) return;
    if (isListed && !fetchListedSets) return;
    let active = true;
    void (async () => {
      try {
        const workout = isListed
          ? undefined
          : await api(`/workspace/records/${workoutId}`);
        if (workout && workout.kind !== "workout") return;
        const sets = await workoutSets(workoutId);
        if (active) setFetched({ id: workoutId, workout, sets });
      } catch {
        // The empty state below explains that the workout is unavailable;
        // a listed workout keeps the set logs the bootstrap carried.
      }
    })();
    return () => {
      active = false;
    };
    // Set logs are append-only, so a bootstrap reload does not refetch them.
  }, [isListed, fetchListedSets, workoutId]);
  const mine = fetched?.id === workoutId ? fetched : null;
  return listed
    ? { workout: listed, sets: mine?.sets ?? ([] as any[]) }
    : mine?.workout
      ? { workout: mine.workout, sets: mine.sets }
      : { workout: undefined, sets: [] as any[] };
}
/** The time or distance of a logged timed or distance round (reps 0). */
export const loggedWorkText = (body: {
  durationSeconds?: number | null;
  distanceMeters?: number | null;
}) =>
  typeof body.durationSeconds === "number"
    ? formatDuration(body.durationSeconds)
    : typeof body.distanceMeters === "number"
      ? formatDistance(body.distanceMeters)
      : null;
/**
 * Brings the next set still to log into view after one is logged: smoothly,
 * and only as far as needed (its scroll margin clears the top bar and the
 * sticky action bar).
 */
export function revealNextSet() {
  document
    .querySelector(".set-row:not(.is-done) .set-log")
    ?.closest("form")
    ?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
}
/** Plain words for a workout's status (the badge on the workout screen). */
export function workoutStatusText(
  status: string,
  t: ReturnType<typeof useT<"workout">>,
) {
  return ["active", "completed", "safety_hold", "paused", "abandoned"].includes(
    status,
  )
    ? t(`status_${status}` as "status_active")
    : status.replaceAll("_", " ");
}
export function Workout({ state, records, action, busy, path }: ViewProps) {
  const workoutId = path.split("/").pop() ?? "";
  const listedWorkout = records("workout").find((w) => w.id === workoutId);
  const found = useListedOrFetchedWorkout(
    listedWorkout,
    workoutId,
    !!listedWorkout &&
      needsWorkoutSets(listedWorkout, state.user, !state.pages?.sets?.hasMore),
  );
  const workout = found.workout,
    loggedSets = found.sets.length
      ? [...state.sets, ...found.sets]
      : state.sets;
  const t = useT("workout"),
    locale = useLocale(),
    toError = useErrorText();
  const [queued, setQueued] = useState(0),
    [notice, setNotice] = useState(""),
    [rejected, setRejected] = useState<RejectedEntry<WorkoutQueueItem>[]>([]);
  const { tenantId, userId } = state.user,
    keys = offlineQueueKeys("workout", tenantId, userId),
    key = keys.pending,
    receiptKey = keys.receipts,
    rejectedKey = keys.rejected;
  const [localDone, setLocalDone] = useState<string[]>([]);
  // Values logged on this screen, shown until the refreshed logs arrive.
  const [submitted, setSubmitted] = useState<
    Record<
      string,
      {
        loadKg: number;
        reps: number;
        rir: number;
        durationSeconds?: number;
        distanceMeters?: number;
      }
    >
  >({});
  const [painOpen, setPainOpen] = useState(false),
    [painText, setPainText] = useState(""),
    [restUntil, setRestUntil] = useState<number | null>(null),
    [restLeft, setRestLeft] = useState(0),
    // The prescribed rest, for the ring counting it down.
    [restTotal, setRestTotal] = useState(0),
    // Finished on this screen: the completion moment shows once.
    [finished, setFinished] = useState(false),
    // The set logged last on this screen: it confirms itself once
    // (phone-first.css "Motion") and the next set comes into view.
    [justLogged, setJustLogged] = useState<string | null>(null),
    // The one set shown with its steppers: the next to log unless the
    // member opened another (phone first: one set at a time).
    [openSet, setOpenSet] = useState<string | null>(null);
  useEffect(() => {
    if (!restUntil) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((restUntil - Date.now()) / 1000));
      setRestLeft(left);
      if (!left) setRestUntil(null);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [restUntil]);
  const refreshQueue = useCallback(() => {
    setQueued(readList(localStorage, key).length);
    setLocalDone(readList<string>(localStorage, receiptKey));
    setRejected(readList(localStorage, rejectedKey));
  }, [key, receiptKey, rejectedKey]);
  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    const result = await drainWorkoutQueue(
      localStorage,
      tenantId,
      userId,
      (p, b, h) => api(p, "POST", b, h),
    );
    refreshQueue();
    if (result.stopped?.reason === "session") setNotice(t("sessionEnded"));
    else if (result.stopped)
      setNotice(
        t("savedOnDevice", { reason: toError(result.stopped.failure) }),
      );
    else if (result.rejected.length) setNotice(t("rejectedOne"));
    // Back online and everything sent: say so plainly (then it goes).
    else if (result.synced.length && !readList(localStorage, key).length)
      setNotice(t("allSynced"));
  }, [tenantId, userId, refreshQueue, t, toError, key]);
  useEffect(() => {
    if (notice !== t("allSynced")) return;
    const gone = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(gone);
  }, [notice, t]);
  useEffect(() => {
    refreshQueue();
    const online = () => void sync();
    window.addEventListener("online", online);
    void sync();
    return () => window.removeEventListener("online", online);
  }, [sync, refreshQueue]);
  useEffect(() => {
    if (isTrainerPreview() || !workout || !navigator.onLine || !("caches" in window)) return;
    let active = true;
    void (async () => {
      try {
        await navigator.serviceWorker.ready;
        // This release's caches (components/pwa.ts, public/sw.js): the
        // workout page with the personal pages, its assets with the build.
        const names = cacheNames();
        const [pages, shell] = await Promise.all([
          caches.open(names.pages),
          caches.open(names.shell),
        ]);
        const assets = performance
          .getEntriesByType("resource")
          .map((r) => r.name)
          .filter((url) => url.startsWith(location.origin + "/_next/static/"));
        await Promise.all([
          pages.add(path),
          ...[...new Set(assets)].map((url) => shell.add(url)),
        ]);
        if (active) setNotice(t("savedForDevice"));
      } catch {
        if (active) setNotice(t("keepOpen"));
      }
    })();
    return () => {
      active = false;
    };
  }, [workout?.id, path]);
  if (!workout)
    return <Empty title={t("unavailable")} detail={t("unavailableDetail")} />;
  const active = workout.status === "active";
  const pendingItems = readList<WorkoutQueueItem>(localStorage, key);
  // Every set's state: logged (with the values actually saved), saved on
  // this device, needing attention, or still to do.
  const exercises = (workout.data.program.exercises as any[]).map(
    (ex: any, i: number) => ({
      ex,
      i,
      sets: Array.from({ length: ex.sets }, (_, set) => {
        const logicalKey = workout.id + ":" + i + ":" + (set + 1);
        const legacyKey = workout.id + ":" + ex.name + ":" + (set + 1);
        const pending = pendingItems.find(
          (p) => p.logicalKey === logicalKey || p.logicalKey === legacyKey,
        );
        const saved = loggedSets.find(
          (s) =>
            s.workout_id === workout.id &&
            s.data.exercise === ex.name &&
            s.data.set === set + 1 &&
            (s.data.exerciseIndex == null || s.data.exerciseIndex === i),
        );
        const needsAttention = rejected.some(
          (r) =>
            r.item.logicalKey === logicalKey || r.item.logicalKey === legacyKey,
        );
        const values = saved?.data ?? pending?.body ?? submitted[logicalKey];
        return {
          set: set + 1,
          logicalKey,
          formId: `set-${i}-${set + 1}`,
          pending: !!pending,
          done:
            !!pending ||
            !!saved ||
            localDone.includes(logicalKey) ||
            localDone.includes(legacyKey),
          needsAttention,
          values: values
            ? {
                loadKg: values.loadKg,
                reps: values.reps,
                rir: values.rir,
                durationSeconds: values.durationSeconds,
                distanceMeters: values.distanceMeters,
              }
            : null,
        };
      }),
    }),
  );
  const next = exercises
    .flatMap(({ ex, sets }) => sets.map((s) => ({ ...s, ex })))
    .find((s) => !s.done && !s.needsAttention);
  // The set on screen with its steppers: one the member opened, else next.
  const current =
    exercises
      .flatMap(({ ex, sets }) => sets.map((s) => ({ ...s, ex })))
      .find((s) => s.logicalKey === openSet && !s.done && !s.needsAttention) ??
    next;

  const remaining = exercises.reduce(
    (n, { sets }) => n + sets.filter((s) => !s.done).length,
    0,
  );
  const finishBlocked =
    queued > 0 ||
    rejected.some((r) => r.item.path === `/workouts/${workout.id}/sets`);
  const finish = () => {
    haptic();
    // No toast: the completion card itself says the workout is done.
    void action(
      () => api(`/workouts/${workout.id}/finish`, "POST", {}),
      "",
    ).then((result) => {
      if (result === null) return;
      // The completion moment is at the top of the workout: go there once,
      // instantly, before the card rises, so nothing jumps under it.
      window.scrollTo({ top: 0, behavior: "auto" });
      setFinished(true);
    });
  };
  const allSets = exercises.flatMap(({ sets }) => sets);
  const restText =
    restLeft > 0 ? t("rest", { time: formatCountdown(restLeft, locale) }) : "";
  return (
    <>
      <TrainingHoldNotice records={state.records} />
      <Heading
        eyebrow={t("eyebrow")}
        title={workout.data.program.title}
        detail={t("detail")}
        action={<Badge>{workoutStatusText(workout.status, t)}</Badge>}
      />
      {finished && workout.status === "completed" && (
        <WorkoutComplete
          done={allSets.filter((s) => s.done).length}
          total={allSets.length}
        />
      )}
      {active && (
        <div className="workout-modes">
          <Link className="button secondary" href={`/app/guided/${workout.id}`}>
            <Play size={16} aria-hidden="true" />
            {t("guided")}
          </Link>
          <p className="muted">{t("modesHelp")}</p>
        </div>
      )}
      {queued > 0 && (
        <div className="notice">
          {queuedSummary(queued, "set", locale)}.{" "}
          <button className="text-button" onClick={() => void sync()}>
            {t("syncNow")}
          </button>
        </div>
      )}
      {/* Keyed by its words: it drops in once per new message, not again
          when the page re-renders after a reload. */}
      {notice && (
        <div className="notice" role="status" key={notice}>
          {notice}
        </div>
      )}
      {rejected.length > 0 && (
        <div className="notice error" role="alert">
          <strong>{t("needAttention", { count: rejected.length })}</strong>{" "}
          {t("notAccepted", { count: rejected.length })}
          <ul>
            {rejected.map((entry) => (
              <li key={entry.item.body.eventKey}>
                {loggedWorkText(entry.item.body) !== null
                  ? t("rejectedWorkLine", {
                      exercise: entry.item.body.exercise,
                      set: entry.item.body.set,
                      work: loggedWorkText(entry.item.body) ?? "",
                      load: entry.item.body.loadKg,
                      reason: toError(entry.failure),
                    })
                  : t("rejectedLine", {
                      exercise: entry.item.body.exercise,
                      set: entry.item.body.set,
                      reps: entry.item.body.reps,
                      load: entry.item.body.loadKg,
                      reason: toError(entry.failure),
                    })}{" "}
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    retryRejected<WorkoutQueueItem>(
                      localStorage,
                      keys,
                      entry.item.body.eventKey,
                      (item) => item.body.eventKey,
                    );
                    refreshQueue();
                    void sync();
                  }}
                >
                  {t("tryAgain")}
                </button>{" "}
                <button
                  className="text-button"
                  type="button"
                  onClick={async () => {
                    if (
                      !(await confirmWorkspace({
                        title: "Confirm action",
                        detail: t("discardConfirm"),
                        confirm: "Continue",
                      }))
                    )
                      return;
                    discardRejected<WorkoutQueueItem>(
                      localStorage,
                      keys,
                      entry.item.body.eventKey,
                      (item) => item.body.eventKey,
                    );
                    refreshQueue();
                  }}
                >
                  {t("discard")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {exercises.map(({ ex, i, sets }) => (
        <Card key={i} className="workout-exercise">
          <div className="card-heading">
            <div className="exercise-title">
              <span className="step-circle">{i + 1}</span>
              <h2 dir="auto">{ex.name}</h2>
            </div>
            <span className="muted exercise-prescription">
              {/* Timed and distance work: the domain's prescription line. */}
              {workMeasure(ex) === "reps"
                ? t("prescription", {
                    setsReps: formatSetsReps(ex.sets, ex.reps, locale),
                    rest: ex.restSeconds,
                  })
                : prescriptionText(ex, { rir: false })}
            </span>
          </div>
          {ex.cue && (
            <p className="muted" dir="auto">
              {ex.cue}
            </p>
          )}
          {/* "Reps left" is explained once, in the first exercise. */}
          {i === exercises[0]?.i && (
            <p className="rir-help">
              <Rich
                t={t}
                k="rirHelp"
                params={{ rir: ex.rir ?? 2 }}
                tags={{ b: (text) => <strong>{text}</strong> }}
              />
            </p>
          )}
          {sets.map((row) => (
            <form
              className={
                "set-row" +
                (row.done ? " is-done" : "") +
                (active &&
                !row.done &&
                !row.needsAttention &&
                row.logicalKey !== current?.logicalKey
                  ? " is-later"
                  : "") +
                (row.done && row.logicalKey === justLogged
                  ? " just-logged"
                  : "")
              }
              id={row.formId}
              key={row.set}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!active) return;
                // Timed and distance rounds log the time or distance done (reps 0).
                const measure = workMeasure(ex);
                const f = new FormData(e.currentTarget),
                  body = {
                    eventKey: crypto.randomUUID(),
                    rir: Number(f.get("rir")),
                    notes: String(f.get("notes") || ""),
                    exercise: ex.name,
                    exerciseIndex: i,
                    set: row.set,
                    reps: measure === "reps" ? Number(f.get("reps")) : 0,
                    loadKg: Number(f.get("load")),
                    ...(measure === "time"
                      ? { durationSeconds: Number(f.get("duration")) }
                      : measure === "distance"
                        ? { distanceMeters: Number(f.get("distance")) }
                        : {}),
                  };
                const endpoint = `/workouts/${workout.id}/sets`;
                const { notes: _notes, ...setLog } = body,
                  checked = setSchema.safeParse(setLog);
                if (!checked.success) {
                  setNotice(t("checkSet"));
                  return;
                }
                const pending = readList<WorkoutQueueItem>(localStorage, key);
                if (
                  pending.some((p) => p.logicalKey === row.logicalKey) ||
                  readList<RejectedEntry<WorkoutQueueItem>>(
                    localStorage,
                    rejectedKey,
                  ).some((r) => r.item.logicalKey === row.logicalKey) ||
                  localDone.includes(row.logicalKey)
                )
                  return;
                pending.push({
                  path: endpoint,
                  body,
                  logicalKey: row.logicalKey,
                });
                setSubmitted((old) => ({
                  ...old,
                  [row.logicalKey]: {
                    loadKg: body.loadKg,
                    reps: body.reps,
                    rir: body.rir,
                    durationSeconds: (body as { durationSeconds?: number })
                      .durationSeconds,
                    distanceMeters: (body as { distanceMeters?: number })
                      .distanceMeters,
                  },
                }));
                setJustLogged(row.logicalKey);
                setOpenSet(null);
                haptic();
                requestAnimationFrame(revealNextSet);
                localStorage.setItem(key, JSON.stringify(pending));
                setQueued(pending.length);
                // The prescribed rest starts as soon as the set is logged.
                if (ex.restSeconds > 0) {
                  setRestTotal(ex.restSeconds);
                  setRestUntil(Date.now() + ex.restSeconds * 1000);
                }
                await sync();
                const stillPending = readList<WorkoutQueueItem>(
                  localStorage,
                  key,
                ).some((p) => p.logicalKey === row.logicalKey);
                setNotice(
                  t(stillPending ? "setQueued" : "setLogged", {
                    set: row.set,
                    exercise: ex.name,
                  }),
                );
              }}
            >
              <div className="set-row-head">
                <strong>
                  {workMeasure(ex) === "reps"
                    ? t("setN", { n: row.set })
                    : t("roundN", { n: row.set })}
                </strong>
                {row.done && (
                  <span className="set-logged">
                    <span className="set-logged-status">
                      {/* Drawn once when this set was just logged. */}
                      <DrawnCheck />
                      {row.pending
                        ? locale === "en"
                          ? QUEUED_LABEL
                          : queuedLabel(locale)
                        : t("logged")}
                    </span>
                    {row.values && (
                      <span className="set-logged-values">
                        {loggedWorkText(row.values) !== null
                          ? t("loggedWorkLine", {
                              kg: row.values.loadKg,
                              work: loggedWorkText(row.values) ?? "",
                              rir: row.values.rir ?? 2,
                            })
                          : t("loggedLine", {
                              kg: row.values.loadKg,
                              count: row.values.reps,
                              rir: row.values.rir ?? 2,
                            })}
                      </span>
                    )}
                  </span>
                )}
                {row.needsAttention && (
                  <span className="set-attention">{t("needsAttention")}</span>
                )}
                {active &&
                  !row.done &&
                  !row.needsAttention &&
                  row.logicalKey !== current?.logicalKey && (
                    <button
                      type="button"
                      className="button secondary set-open"
                      aria-label={t("openSetLabel", {
                        exercise: ex.name,
                        set: row.set,
                      })}
                      onClick={() => setOpenSet(row.logicalKey)}
                    >
                      {t("openSet")}
                    </button>
                  )}
              </div>
              {active &&
                !row.done &&
                !row.needsAttention &&
                row.logicalKey === current?.logicalKey && (
                  <>
                    <NumberStepper
                      label={t("weightKg")}
                      name="load"
                      decimal
                      step={0.5}
                      min={0}
                      max={500}
                      defaultValue={ex.loadKg}
                      inputLabel={t("weightLabel", {
                        exercise: ex.name,
                        set: row.set,
                      })}
                    />
                    {workMeasure(ex) === "time" ? (
                      <NumberStepper
                        label={t("seconds")}
                        name="duration"
                        min={0}
                        max={36000}
                        defaultValue={ex.durationSeconds}
                        inputLabel={t("secondsLabel", {
                          exercise: ex.name,
                          set: row.set,
                        })}
                      />
                    ) : workMeasure(ex) === "distance" ? (
                      <NumberStepper
                        label={t("metres")}
                        name="distance"
                        min={0}
                        max={200000}
                        defaultValue={ex.distanceMeters}
                        inputLabel={t("metresLabel", {
                          exercise: ex.name,
                          set: row.set,
                        })}
                      />
                    ) : (
                      <NumberStepper
                        label={t("reps")}
                        name="reps"
                        min={0}
                        max={200}
                        defaultValue={ex.reps}
                        inputLabel={t("repsLabel", {
                          exercise: ex.name,
                          set: row.set,
                        })}
                      />
                    )}
                    <NumberStepper
                      label={t("repsLeft")}
                      name="rir"
                      min={0}
                      max={10}
                      defaultValue={ex.rir ?? 2}
                      enterKeyHint="done"
                      inputLabel={t("rirLabel", {
                        exercise: ex.name,
                        set: row.set,
                      })}
                    />
                    <button
                      type="submit"
                      className="button secondary set-log"
                      disabled={busy}
                    >
                      {t("logSet", { n: row.set })}
                    </button>
                    <details className="set-note">
                      <summary>{t("addNote", { n: row.set })}</summary>
                      <label className="field">
                        <span>{t("note")}</span>
                        <textarea
                          name="notes"
                          maxLength={1000}
                          rows={2}
                          enterKeyHint="done"
                          aria-label={t("noteLabel", {
                            exercise: ex.name,
                            set: row.set,
                          })}
                        />
                      </label>
                    </details>
                  </>
                )}
            </form>
          ))}
        </Card>
      ))}
      {active && next && (
        <div className="workout-finish">
          <Button secondary disabled={busy || finishBlocked} onClick={finish}>
            {t("finishNow")}
          </Button>
          <p className="control-reason">
            {finishBlocked
              ? t("finishWaits")
              : t("notLoggedYet", { count: remaining })}
          </p>
        </div>
      )}
      <WorkoutTools
        workout={workout}
        userId={state.user.userId}
        onChange={async () => {
          await action(async () => ({}), t("sessionUpdated"));
        }}
        rest={{
          left: restLeft,
          start: (seconds) => {
            setRestTotal(seconds);
            setRestUntil(Date.now() + seconds * 1000);
          },
          reset: () => {
            setRestUntil(null);
            setRestLeft(0);
          },
        }}
      />
      {active && (
        <StickyActionBar
          label={t("actions")}
          note={
            restText ? (
              <span role="timer" aria-live="off">
                <ProgressRing
                  value={restTotal ? restLeft / restTotal : 0}
                  size={24}
                  ticking
                />
                {restText}
                {current
                  ? t("nextAfterRest", {
                      exercise: current.ex.name,
                      set: current.set,
                    })
                  : ""}
              </span>
            ) : current ? (
              t("next", { exercise: current.ex.name, set: current.set })
            ) : finishBlocked ? (
              t("waitingSync")
            ) : (
              t("allLogged")
            )
          }
        >
          <button
            type="button"
            className="button secondary workout-pain"
            disabled={busy}
            onClick={() => setPainOpen(true)}
          >
            <AlertCircle size={18} aria-hidden="true" />
            {t("reportPain")}
          </button>
          {current ? (
            <button
              type="submit"
              form={current.formId}
              className="button"
              disabled={busy}
            >
              {t("logSet", { n: current.set })}
            </button>
          ) : (
            <button
              type="button"
              className="button"
              disabled={busy || finishBlocked}
              onClick={finish}
            >
              {t("finish")} <CheckCircle size={18} aria-hidden="true" />
            </button>
          )}
        </StickyActionBar>
      )}
      <BottomSheet
        open={painOpen}
        onClose={() => setPainOpen(false)}
        title={t("painTitle")}
        description={t("painDescription")}
        footer={
          <>
            <button
              type="button"
              className="button secondary"
              onClick={() => setPainOpen(false)}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              form="workout-pain-report"
              className="button"
              disabled={busy}
            >
              {t("stopNotify")}
            </button>
          </>
        }
      >
        <form
          id="workout-pain-report"
          onSubmit={(e) => {
            e.preventDefault();
            // Stopping never waits for a note (pain-report.ts).
            const description = painDescription(painText);
            setPainOpen(false);
            setPainText("");
            void action(
              () =>
                api(`/workouts/${workout.id}/pain`, "POST", { description }),
              t("paused"),
            );
          }}
        >
          <label className="field">
            <span>{t("whatHappened")}</span>
            {/* No autofocus: the phone keyboard would open mid-slide and
                cover "Stop workout and notify coach"; the note is optional. */}
            <textarea
              value={painText}
              onChange={(e) => setPainText(e.target.value)}
              rows={4}
              maxLength={2000}
              enterKeyHint="send"
              placeholder={t("painExample")}
            />
          </label>
        </form>
      </BottomSheet>
    </>
  );
}
