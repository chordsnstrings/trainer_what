type RecordRow = {
  id: string;
  kind: string;
  status: string;
  data: any;
  created_at: string | Date;
  updated_at?: string | Date;
};
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
    sourceCorrectionIds: rows!.filter((r) => r.correctionId).map((r) => r.correctionId),
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
