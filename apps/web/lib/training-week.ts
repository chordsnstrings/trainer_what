import { calendarDate } from "./format";
export function trainingWeek(
  records: Array<{ kind: string; status: string; data?: any }>,
  today: string,
) {
  const anchor = new Date(`${today}T12:00:00Z`);
  if (!Number.isFinite(anchor.getTime()))
    return { completed: 0, planned: 0, next: null as string | null };
  anchor.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
  const start = anchor.toISOString().slice(0, 10);
  anchor.setUTCDate(anchor.getUTCDate() + 7);
  const end = anchor.toISOString().slice(0, 10);
  const inWeek = (date: string) => date >= start && date < end;
  // Scheduled and completed are separate evidence; do not count a missed session as completed.
  const planned = records.filter(
    (r) =>
      r.kind === "planned_session" &&
      r.status !== "canceled" &&
      r.status !== "cancelled" &&
      inWeek(String(r.data?.date ?? "")),
  ).length;
  const completed = records.filter(
    (r) =>
      r.kind === "workout" &&
      r.status === "completed" &&
      r.data?.completedAt &&
      inWeek(calendarDate(r.data.completedAt)),
  ).length;
  const next =
    records
      .filter(
        (r) =>
          r.kind === "planned_session" &&
          r.status === "planned" &&
          String(r.data?.date ?? "") >= today,
      )
      .map((r) => String(r.data.date))
      .sort()[0] ?? null;
  return { completed, planned, next };
}
