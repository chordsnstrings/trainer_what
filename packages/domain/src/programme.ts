/**
 * Programme calendar rules, shared by the Today screen, the timeline and the
 * worker. Days are calendar dates in the member's time zone; UTC noon is used
 * only for calendar arithmetic, so daylight-saving changes never shift a day.
 */
export const DEFAULT_PROGRAMME_DAYS = 28;
export const PROGRAMME_DAYS_MIN = 7;
export const PROGRAMME_DAYS_MAX = 365;
/** Days before an upfront programme ends when the member may buy the next one. */
export const RENEWAL_WINDOW_DAYS = 7;
/** Days before an upfront programme ends when the member is told it is ending. */
export const ENDING_NOTICE_DAYS = 3;

export type ProgrammeBilling = "monthly" | "upfront" | "complimentary";
export type ProgrammeState = "not_started" | "active" | "complete";

export function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dateIn(timeZone: string, at: Date | string | number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}
export function addDays(date: string, days: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) /
      86400000,
  );
}
/** A stored length, or the Brain default when the offer is rolling or the value is invalid. */
export function effectiveProgrammeDays(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= PROGRAMME_DAYS_MIN &&
    value <= PROGRAMME_DAYS_MAX
    ? value
    : DEFAULT_PROGRAMME_DAYS;
}

export type ProgrammePosition = {
  state: ProgrammeState;
  billing: ProgrammeBilling;
  /** True when the offer has no trainer-set length (rolling blocks of the default). */
  rolling: boolean;
  /** 1-based day of the current programme (upfront) or block (monthly/rolling); 0 before start. */
  day: number;
  of: number;
  /** 1-based block number; always 1 for an upfront programme. */
  block: number;
  today: string;
  startDate: string;
  /** First and last calendar day of the current programme or block. */
  blockStartDate: string;
  blockEndDate: string;
  /** Days after today left in the programme (upfront) or block. */
  daysRemaining: number;
};

/**
 * Where a member is in their programme.
 *
 * - `upfront`: one programme of `lengthDays` from `startsAt`; it is complete
 *   from `endsAt` (the paid access end), and the day never exceeds the length.
 * - `monthly` and `complimentary`: consecutive blocks of `lengthDays` from
 *   `startsAt` for as long as access continues.
 */
export function programmePosition(input: {
  billing: ProgrammeBilling;
  programmeDays: unknown;
  startsAt: string | Date;
  endsAt?: string | Date | null;
  timeZone: string;
  now?: Date;
}): ProgrammePosition {
  const now = input.now ?? new Date();
  const timeZone = validTimeZone(input.timeZone) ? input.timeZone : "Asia/Dubai";
  const rolling = effectiveProgrammeDays(input.programmeDays) !== input.programmeDays;
  const of = effectiveProgrammeDays(input.programmeDays);
  const startDate = dateIn(timeZone, input.startsAt);
  const today = dateIn(timeZone, now);
  const elapsed = daysBetween(startDate, today);
  const base = { billing: input.billing, rolling, of, today, startDate };
  if (elapsed < 0)
    return {
      ...base,
      state: "not_started",
      day: 0,
      block: 1,
      blockStartDate: startDate,
      blockEndDate: addDays(startDate, of - 1),
      daysRemaining: of - 1 - elapsed,
    };
  if (input.billing === "upfront") {
    const ended =
      !!input.endsAt && new Date(input.endsAt).getTime() <= now.getTime();
    const day = Math.min(elapsed + 1, of);
    return {
      ...base,
      // The paid access end decides completion; a late-evening start can
      // leave a few access hours on the calendar day after the last one.
      state: ended || (!input.endsAt && elapsed >= of) ? "complete" : "active",
      day,
      block: 1,
      blockStartDate: startDate,
      blockEndDate: addDays(startDate, of - 1),
      daysRemaining: ended ? 0 : Math.max(0, of - day),
    };
  }
  const block = Math.floor(elapsed / of) + 1,
    day = (elapsed % of) + 1,
    blockStartDate = addDays(startDate, (block - 1) * of);
  return {
    ...base,
    state: "active",
    day,
    block,
    blockStartDate,
    blockEndDate: addDays(blockStartDate, of - 1),
    daysRemaining: of - day,
  };
}

export type PlannedDay = {
  id?: string;
  date: string;
  label?: string;
  status: string;
  week?: number;
  exercises?: number;
  /** The assigned programme this session belongs to. */
  programId?: string | null;
  /** The workout started from this session, once started. */
  workoutId?: string | null;
};
export type TimelineDay = {
  date: string;
  day: number;
  kind: "session" | "rest";
  label: string | null;
  sessionId: string | null;
  status: "done" | "missed" | "today" | "upcoming" | "rest" | "canceled";
};
const DONE = new Set(["completed"]);
const SKIPPED = new Set(["canceled"]);
/** One entry per calendar day of the current programme or block. */
export function programmeTimeline(
  position: ProgrammePosition,
  sessions: PlannedDay[],
): TimelineDay[] {
  const byDate = new Map<string, PlannedDay>();
  for (const s of sessions) {
    const prior = byDate.get(s.date);
    // A canceled plan never hides an active session on the same day.
    if (!prior || (SKIPPED.has(prior.status) && !SKIPPED.has(s.status)))
      byDate.set(s.date, s);
  }
  return Array.from({ length: position.of }, (_, i) => {
    const date = addDays(position.blockStartDate, i),
      s = byDate.get(date);
    if (!s)
      return {
        date,
        day: i + 1,
        kind: "rest" as const,
        label: null,
        sessionId: null,
        status: "rest" as const,
      };
    const status: TimelineDay["status"] = DONE.has(s.status)
      ? "done"
      : SKIPPED.has(s.status)
        ? "canceled"
        : date < position.today
          ? "missed"
          : date === position.today
            ? "today"
            : "upcoming";
    return {
      date,
      day: i + 1,
      kind: "session" as const,
      label: s.label ?? null,
      sessionId: s.id ?? null,
      status,
    };
  });
}

/**
 * Streak: consecutive scheduled sessions completed, newest first, up to today
 * (today counts only once done). Rest days and sessions the coach canceled
 * neither break nor extend it. Adherence: completed share of the sessions
 * scheduled in the window before today, plus today's when done.
 */
export function adherence(
  sessions: PlannedDay[],
  today: string,
  windowDays = 28,
) {
  const from = addDays(today, -windowDays + 1);
  const due = sessions
    .filter(
      (s) =>
        !SKIPPED.has(s.status) &&
        s.date >= from &&
        (s.date < today || (s.date === today && DONE.has(s.status))),
    )
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let streak = 0;
  for (const s of due) {
    if (!DONE.has(s.status)) break;
    streak++;
  }
  const completed = due.filter((s) => DONE.has(s.status)).length;
  return {
    streak,
    completed,
    scheduled: due.length,
    percent: due.length ? Math.round((completed / due.length) * 100) : null,
    windowDays,
  };
}

export type EndOfProgramme =
  | { state: "renews"; at: string | null }
  | { state: "next_block"; at: string }
  | { state: "ends"; at: string; canRenew: boolean }
  | { state: "ended"; at: string | null; canRenew: boolean }
  | { state: "none" };
/** What happens when the current programme or block ends. */
export function endOfProgramme(input: {
  billing: ProgrammeBilling | null;
  position: ProgrammePosition | null;
  accessEndsAt?: string | Date | null;
  accessActive: boolean;
  cancelAtPeriodEnd?: boolean;
  now?: Date;
}): EndOfProgramme {
  const now = (input.now ?? new Date()).getTime();
  const end = input.accessEndsAt ? new Date(input.accessEndsAt) : null;
  if (input.billing === "upfront") {
    if (!input.accessActive || (end && end.getTime() <= now))
      return {
        state: "ended",
        at: end ? end.toISOString() : null,
        canRenew: true,
      };
    return {
      state: "ends",
      at: end ? end.toISOString() : "",
      canRenew:
        !!end && end.getTime() - now <= RENEWAL_WINDOW_DAYS * 86400000,
    };
  }
  if (input.billing === "monthly") {
    if (!input.accessActive)
      return {
        state: "ended",
        at: end ? end.toISOString() : null,
        canRenew: true,
      };
    if (input.cancelAtPeriodEnd && end)
      return { state: "ends", at: end.toISOString(), canRenew: false };
    if (input.position)
      return {
        state: "next_block",
        at: addDays(input.position.blockEndDate, 1),
      };
    return { state: "renews", at: end ? end.toISOString() : null };
  }
  if (input.billing === "complimentary" && input.position)
    return { state: "next_block", at: addDays(input.position.blockEndDate, 1) };
  return { state: "none" };
}

/**
 * The programme window that applies now: the current one, or a queued one
 * whose start has passed but which the worker has not promoted yet.
 */
export function effectiveProgrammeWindow(data: any, now = Date.now()) {
  const next = data?.billing === "upfront" ? data.nextProgramme : null;
  if (next && Date.parse(next.startsAt) <= now)
    return {
      programmeStartsAt: next.startsAt as string,
      programmeDays: next.programmeDays as number,
      productId: (next.productId ?? data.productId ?? null) as string | null,
      endsAt: next.endsAt as string,
      queued: null,
    };
  return {
    programmeStartsAt: data?.programmeStartsAt as string | undefined,
    programmeDays: data?.programmeDays,
    productId: (data?.productId ?? null) as string | null,
    endsAt: (next ? data?.upfront?.endsAt : undefined) as string | undefined,
    queued: next ?? null,
  };
}
