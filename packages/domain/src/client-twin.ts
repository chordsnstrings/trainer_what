import { addTrainingDays, trainingDateSchema } from "./coaching-completion.ts";

type RecordRow = {
  id: string;
  kind: string;
  status: string;
  data: any;
  created_at: string | Date;
  updated_at?: string | Date;
};
type ScheduleEvidence = {
  plannedSessions: RecordRow[];
  linkedWorkouts: RecordRow[];
  partial?: boolean;
  linkedWorkoutsPartial?: boolean;
  currentBlock?: {
    program: RecordRow;
    lineage: RecordRow[];
    sessions: RecordRow[];
    expectedSessions: number | null;
    complete: boolean;
  } | null;
};
type SessionState =
  | "scheduled"
  | "completed"
  | "missed"
  | "upcoming"
  | "canceled"
  | "in_progress"
  | "held"
  | "abandoned"
  | "unverified";
function calendarDate(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** Calendar evidence only: a past date without a recorded completion is not proof of inactivity. */
export function trainingAdherence(input: ScheduleEvidence & { now: Date }) {
  const summarize = (plan: RecordRow) => {
    const date = trainingDateSchema.safeParse(plan.data.date).success
      ? (plan.data.date as string)
      : null;
    const timezone =
      typeof plan.data.timezone === "string" ? plan.data.timezone : null;
    let today: string | null = null;
    if (timezone) {
      try {
        today = calendarDate(input.now, timezone);
      } catch {}
    }
    const related = input.linkedWorkouts.filter(
      (workout) =>
        workout.id === plan.data.workoutId ||
        workout.data.plannedSessionId === plan.id,
    );
    const workout =
      related.length === 1 &&
      related[0].id === plan.data.workoutId &&
      related[0].data.plannedSessionId === plan.id &&
      related[0].data.programId === plan.data.programId
        ? related[0]
        : null;
    let state: SessionState = "unverified",
      issue: string | null = null;
    const completedAt = workout?.data.completedAt ?? null;
    if (!date || !today) issue = "Session date or timezone is unavailable";
    else if (
      related.length > 1 ||
      ((related.length || plan.data.workoutId) && !workout)
    )
      issue = "Workout linkage needs review";
    else if (plan.status === "canceled") {
      if (workout?.status === "completed")
        issue = "Canceled plan conflicts with a recorded completion";
      else state = "canceled";
    } else if (workout?.status === "completed") {
      if (
        completedAt !== null &&
        (!Number.isFinite(Date.parse(completedAt)) ||
          Date.parse(completedAt) > input.now.getTime())
      )
        issue = "Completion timestamp needs review";
      else state = "completed";
    } else if (workout?.status === "active") state = "in_progress";
    else if (workout?.status === "safety_hold") state = "held";
    else if (plan.status === "abandoned" || workout?.status === "abandoned")
      state = "abandoned";
    else if (workout || ["started", "completed"].includes(plan.status))
      issue = "Completion evidence is unavailable";
    else if (plan.status === "planned")
      state =
        date < today ? "missed" : date === today ? "scheduled" : "upcoming";
    else issue = "Session status needs review";
    return {
      id: plan.id,
      programId: plan.data.programId ?? null,
      label: plan.data.label ?? "Planned session",
      date,
      timezone,
      today,
      week: Number.isInteger(plan.data.week) ? plan.data.week : null,
      state,
      recordedStatus: plan.status,
      issue,
      workoutId: workout?.id ?? null,
      completion:
        state === "completed" ? { workoutId: workout!.id, completedAt } : null,
      sourceRecordIds: [plan.id, ...related.map((row) => row.id)],
    };
  };
  const count = (rows: ReturnType<typeof summarize>[]) => {
    const counts: Record<SessionState, number> = {
      scheduled: 0,
      completed: 0,
      missed: 0,
      upcoming: 0,
      canceled: 0,
      in_progress: 0,
      held: 0,
      abandoned: 0,
      unverified: 0,
    };
    for (const row of rows) counts[row.state]++;
    return counts;
  };
  const sessions = input.plannedSessions
    .map(summarize)
    .filter(
      (row) =>
        !row.today ||
        !row.date ||
        (row.date >= addTrainingDays(row.today, -27) &&
          row.date <= addTrainingDays(row.today, 28)),
    )
    .sort(
      (a, b) =>
        (a.date ?? "").localeCompare(b.date ?? "") || a.id.localeCompare(b.id),
    );
  const timezones = [
    ...new Set(
      sessions.flatMap((row) =>
        row.today && row.timezone ? [row.timezone] : [],
      ),
    ),
  ].sort();
  const block = input.currentBlock;
  const blockSessions =
    block?.sessions
      .map(summarize)
      .sort(
        (a, b) =>
          (a.date ?? "").localeCompare(b.date ?? "") ||
          a.id.localeCompare(b.id),
      ) ?? [];
  const blockDates = blockSessions
    .flatMap((row) => (row.date ? [row.date] : []))
    .sort();
  return {
    window: {
      pastDaysIncludingToday: 28,
      futureDays: 28,
      timezones: timezones.map((timezone) => {
        const today = calendarDate(input.now, timezone);
        return {
          timezone,
          today,
          from: addTrainingDays(today, -27),
          through: addTrainingDays(today, 28),
        };
      }),
    },
    plannedSessions: sessions.length,
    counts: count(sessions),
    sessions,
    partial:
      !!input.partial ||
      !!input.linkedWorkoutsPartial ||
      sessions.some((row) => row.state === "unverified"),
    coverage:
      "Previous 28 calendar days including today, plus the next 28 days, in each session's timezone. Missed means a past planned date with no linked completion recorded; it does not establish activity outside the app. Canceled, abandoned, held and in-progress sessions are counted separately.",
    currentBlock: block
      ? {
          programId: block.program.id,
          title: block.program.data.title ?? "Assigned block",
          status: block.program.status,
          weeks: block.program.data.weeks ?? null,
          expectedSessions: block.expectedSessions,
          plannedSessions: blockSessions.length,
          counts: count(blockSessions),
          from: blockDates[0] ?? null,
          through: blockDates.at(-1) ?? null,
          complete:
            block.complete &&
            !input.linkedWorkoutsPartial &&
            blockSessions.every((row) => row.state !== "unverified"),
          sourceRecordIds: block.lineage.map((program) => program.id),
          sessions: blockSessions,
          coverage:
            "Whole recorded schedule for the latest assigned block and its linked revisions, including moved and canceled sessions. Completeness requires the expected session count and available linkage evidence.",
        }
      : null,
  };
}
const DAY = 86400000;
function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = Object.create(null);
  for (const item of items) (groups[key(item)] ??= []).push(item);
  return groups;
}
const median = (a: number[]) => {
  const sorted = [...a].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length
    ? sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2
    : null;
};
const dubaiDay = (time: number) =>
  new Date(time + 4 * 3600000).toISOString().slice(0, 10);
const metricDefinitions = [
  {
    key: "resting_heart_rate",
    label: "Resting heart rate",
    types: ["resting_heart_rate", "HKQuantityTypeIdentifierRestingHeartRate"],
    units: ["bpm", "count/min"],
    unit: "bpm",
    factor: (unit: string) => 1,
    staleDays: 2,
  },
  {
    key: "hrv",
    label: "Heart-rate variability (SDNN)",
    types: ["hrv", "HKQuantityTypeIdentifierHeartRateVariabilitySDNN"],
    units: ["ms", "s"],
    unit: "ms",
    factor: (unit: string) => (unit === "s" ? 1000 : 1),
    staleDays: 2,
  },
  {
    key: "body_mass",
    label: "Body mass",
    types: ["body_mass", "HKQuantityTypeIdentifierBodyMass"],
    units: ["kg", "g", "lb"],
    unit: "kg",
    factor: (unit: string) =>
      unit === "g" ? 0.001 : unit === "lb" ? 0.45359237 : 1,
    staleDays: 7,
  },
  {
    key: "sleep_minutes",
    label: "Self-reported sleep duration",
    types: ["sleep_minutes"],
    units: ["min", "h"],
    unit: "min",
    factor: (unit: string) => (unit === "h" ? 60 : 1),
    staleDays: 2,
  },
];
export function clientTwin(input: {
  records: RecordRow[];
  sets: any[];
  coachingConsent: boolean | null;
  wearableConsent: boolean | null;
  schedule?: ScheduleEvidence;
  now?: Date;
}) {
  const now = (input.now ?? new Date()).getTime(),
    cutoff = now - 28 * DAY;
  const intake = input.records.find((r) => r.kind === "intake");
  const observed = intake ? new Date(intake.created_at).getTime() : null;
  const profile = [
    "age",
    "goal",
    "experience",
    "daysPerWeek",
    "equipment",
    "limitations",
  ].map((key) => ({
    key,
    value: intake?.data[key] ?? null,
    state:
      !intake || intake.data[key] === undefined || intake.data[key] === ""
        ? "missing"
        : now - (observed ?? 0) > 90 * DAY
          ? "stale"
          : "provided",
    observedAt: observed ? new Date(observed).toISOString() : null,
    sourceRecordIds: intake ? [intake.id] : [],
  }));
  const recent = input.sets.filter((r) => {
    const t = new Date(r.created_at).getTime();
    return t >= cutoff && t <= now;
  });
  const workouts = input.records.filter(
    (r) =>
      r.kind === "workout" &&
      new Date(r.created_at).getTime() >= cutoff &&
      new Date(r.created_at).getTime() <= now,
  );
  const performance = Object.entries(
    groupBy(recent, (r) => r.data.exercise),
  ).map(([exercise, rows]) => ({
    exercise,
    loggedSets: rows!.length,
    volumeKg:
      Math.round(
        rows!.reduce((sum, r) => sum + r.data.reps * r.data.loadKg, 0) * 100,
      ) / 100,
    lastLoggedAt: new Date(
      Math.max(...rows!.map((r) => new Date(r.created_at).getTime())),
    ).toISOString(),
    sourceEventIds: rows!.map((r) => r.id),
    sourceCorrectionIds: rows!
      .filter((r) => r.correctionId)
      .map((r) => r.correctionId),
  }));
  const training = {
    windowStart: new Date(cutoff).toISOString(),
    windowEnd: new Date(now).toISOString(),
    completedSessions: workouts.filter((w) => w.status === "completed").length,
    loggedSets: recent.length,
    trainingDays: new Set(
      recent.map((r) => dubaiDay(new Date(r.created_at).getTime())),
    ).size,
    performance,
    coverage:
      "Recorded sessions only; this does not establish activity outside the app.",
  };
  const wearableRows = input.records.filter((r) => r.kind === "wearable"),
    dedup = new Set<string>();
  const metrics = metricDefinitions.map((def) => {
    const samples: Array<{
      value: number;
      time: number;
      recordId: string;
      source: string;
    }> = [];
    if (input.wearableConsent !== false)
      for (const row of wearableRows) {
        if (!row.data.allowedUses?.includes("deterministic_feature")) continue;
        for (const sample of row.data.observations ?? []) {
          if (
            !def.types.includes(sample.type) ||
            !def.units.includes(sample.unit)
          )
            continue;
          const time = new Date(sample.measuredAt).getTime(),
            value = Number(sample.value) * def.factor(sample.unit);
          if (
            !Number.isFinite(time) ||
            time < cutoff ||
            time > now ||
            !Number.isFinite(value) ||
            value < 0
          )
            continue;
          const key = [row.data.source, def.key, time, value].join(":");
          if (dedup.has(key)) continue;
          dedup.add(key);
          samples.push({
            value,
            time,
            recordId: row.id,
            source: row.data.source ?? "import",
          });
        }
      }
    samples.sort((a, b) => a.time - b.time);
    const latest = samples.at(-1),
      latestDay = latest ? dubaiDay(latest.time) : null;
    const daily = Object.entries(groupBy(samples, (s) => dubaiDay(s.time)))
      .filter(([day]) => day !== latestDay)
      .map(([, values]) => median(values!.map((v) => v.value))!);
    const baseline = daily.length >= 7 ? median(daily) : null;
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      state:
        input.wearableConsent === false
          ? "permission_denied"
          : !latest
            ? "unknown"
            : now - latest.time > def.staleDays * DAY
              ? "stale"
              : "current",
      latest: latest?.value ?? null,
      observedAt: latest ? new Date(latest.time).toISOString() : null,
      baseline,
      baselineMethod:
        "Median of prior daily medians; at least 7 distinct days; latest measurement day excluded",
      baselineDays: daily.length,
      sampleCount: samples.length,
      partial: daily.length < 27,
      deltaPercent:
        baseline !== null && baseline > 0 && latest
          ? Math.round(((latest.value - baseline) / baseline) * 10000) / 100
          : null,
      sourceRecordIds: [...new Set(samples.map((s) => s.recordId))],
      sources: [...new Set(samples.map((s) => s.source))],
      allowedUses: ["render", "deterministic_feature"],
    };
  });
  return {
    calculationVersion: "client-twin-v1",
    calculatedAt: new Date(now).toISOString(),
    clockBucket: Math.floor(now / 3600000),
    coaching: {
      profile,
      training,
      adherence: input.schedule
        ? trainingAdherence({ ...input.schedule, now: new Date(now) })
        : null,
      safetyHolds: input.records
        .filter((r) => r.kind === "workout" && r.status === "safety_hold")
        .map((r) => r.id),
      consent: input.coachingConsent,
      allowedUses: input.coachingConsent
        ? ["render", "model_prompt"]
        : ["render"],
    },
    wearables: {
      metrics,
      notice:
        "These are descriptive personal records, not medical advice or a readiness score. Missing imported data does not prove that a measurement is absent or that provider permission was denied.",
      allowedUses: ["render", "deterministic_feature"],
    },
    allowedUses: ["render", "deterministic_feature"],
  };
}
