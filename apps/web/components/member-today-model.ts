/**
 * What the member's Today screen leads with (docs/features/member-screens.md):
 * one "what to do now" with one primary action, a compact status and the
 * next session. Pure, so every plan state is tested without a browser
 * (tests/member-screens.test.ts). Everything comes from one source: the
 * programme API (`/programme/today`, read from the assigned programme's
 * planned sessions) and the member's own workouts from the bootstrap.
 */
import { formatDate } from "../lib/format";
import { translator, type Locale } from "../lib/i18n/core";
import todayMessages from "../lib/i18n/messages/today";

/** The Today wording in the member's language (English by default, for tests). */
const words = (locale: Locale = "en") => translator(todayMessages, locale);

export type TodayProgramme = {
  planState?: "none" | "awaiting_coach" | "ready" | "self_paced" | "ended";
  today?: string;
  intakeDone?: boolean;
  programme?: {
    state: "not_started" | "active" | "complete";
    billing: "monthly" | "upfront" | "complimentary";
    day: number;
    of: number;
    block: number;
    startDate: string;
    blockStartDate?: string;
    blockEndDate?: string;
  } | null;
  session?: {
    id: string;
    label: string | null;
    status: string;
    week: number | null;
    exercises: number;
    programId?: string | null;
    workoutId?: string | null;
  } | null;
  next?: {
    id: string;
    date: string;
    label: string | null;
    inDays: number;
    exercises?: number;
  } | null;
  plan?: {
    programId: string;
    title: string | null;
    daysPerWeek: number | null;
    sessions: Array<{ label: string | null; exercises: number }>;
    completedThisWeek: number;
  } | null;
  progress?: {
    streak: number;
    completed: number;
    scheduled: number;
    percent: number | null;
    windowDays: number;
  };
  nutrition?: any;
  endOfProgramme?: { state: string; at?: string | null; canRenew?: boolean };
};

export type ActiveWorkout = {
  id: string;
  title: string;
  logged: number;
  total: number;
};

export type TodayAction =
  | { kind: "link"; label: string; href: string }
  | {
      kind: "start";
      label: string;
      programId: string;
      plannedSessionId?: string | null;
    };

export type TodayFocus = {
  /** Short label above the title ("Today", "In progress"). */
  label: string;
  title: string;
  detail: string;
  /** The screen's one primary action. */
  action: TodayAction | null;
  /** At most one quieter follow-up link. */
  secondary?: { label: string; href: string } | null;
  /** "Next: Upper body · Thu 1 Oct". */
  next?: string | null;
  tone?: "default" | "done" | "rest" | "waiting";
};

/** "Tomorrow", "Thu 1 Oct" (a calendar date, never shifted). */
export function whenLabel(
  next: { date: string; inDays: number },
  locale: Locale = "en",
) {
  const t = words(locale);
  if (next.inDays === 0) return t("fToday");
  if (next.inDays === 1) return t("tomorrow");
  return formatDate(next.date, { weekday: true, year: false, locale });
}
export function nextLine(next: TodayProgramme["next"], locale: Locale = "en") {
  if (!next) return null;
  const t = words(locale);
  return t("fNext", {
    label: next.label || t("trainingSession"),
    when: whenLabel(next, locale),
  });
}

/**
 * The one thing to do now. `nutrition` is whether the member's coaching
 * includes nutrition (then a rest day's action is logging a meal).
 */
export function todayFocus(input: {
  data: TodayProgramme | null;
  active: ActiveWorkout | null;
  programLabel: string;
  nutrition: boolean;
  /**
   * A workout of this member finished today (from the bootstrap), for a
   * workout started outside today's planned session: today still reads done.
   */
  completedToday?: boolean;
  /** The member's language; English by default. */
  locale?: Locale;
}): TodayFocus {
  const { data, active, programLabel, nutrition, completedToday, locale } =
    input;
  const t = words(locale);
  // A workout already in progress always comes first.
  if (active)
    return {
      label: t("fInProgress"),
      title: active.title,
      detail: active.total
        ? t("fSetsLogged", { done: active.logged, count: active.total })
        : t("fPickUp"),
      action: {
        kind: "link",
        label: t("fContinueWorkout"),
        href: `/app/workouts/${active.id}`,
      },
      tone: "default",
    };
  const state = data?.planState ?? "none";
  const intake = !!data?.intakeDone;
  const next = nextLine(data?.next, locale);
  if (state === "none")
    return intake
      ? {
          label: t("fGetStarted"),
          title: t("fChooseMembership"),
          detail: t("fChooseMembershipText"),
          action: {
            kind: "link",
            label: t("membershipOptions"),
            href: "/app/membership",
          },
          tone: "waiting",
        }
      : {
          label: t("fGetStarted"),
          title: t("fTellCoach"),
          detail: t("fTellCoachText"),
          action: {
            kind: "link",
            label: t("fStartProfile"),
            href: "/app/intake",
          },
          secondary: {
            label: t("membershipOptions"),
            href: "/app/membership",
          },
          tone: "waiting",
        };
  if (state === "ended") {
    const upfront = data?.programme?.billing === "upfront";
    return {
      label: upfront ? t("fProgrammeComplete") : t("fMembershipEnded"),
      title: upfront ? t("fCompletedTitle") : t("fEndedTitle"),
      detail: t("fEndedText"),
      action: {
        kind: "link",
        label: t("chooseNext"),
        href: "/app/membership#offers",
      },
      tone: "done",
    };
  }
  if (state === "awaiting_coach")
    return {
      label: t("fYourPlan"),
      title: t("preparing"),
      detail: intake ? t("fAwaitingAsk") : t("fAwaitingIntake"),
      action: intake
        ? { kind: "link", label: t("fMessageCoach"), href: "/app/chat" }
        : {
            kind: "link",
            label: t("completeProfile"),
            href: "/app/intake",
          },
      tone: "waiting",
    };
  if (state === "self_paced" && data?.plan) {
    const plan = data.plan;
    const week = plan.daysPerWeek
      ? t("fWeekOf", { done: plan.completedThisWeek, count: plan.daysPerWeek })
      : t("fWeekCount", { count: plan.completedThisWeek });
    return {
      label: t("fSelfPacedLabel"),
      title: plan.title || programLabel,
      detail: t("fSelfPacedText", { week }),
      action: {
        kind: "start",
        label: t("fStartWorkout"),
        programId: plan.programId,
      },
      tone: "default",
    };
  }
  const s = data?.session;
  const notStarted = data?.programme?.state === "not_started";
  if (notStarted && data?.programme)
    return {
      label: t("fYourPlan"),
      title: t("fStartsOn", {
        date: formatDate(data.programme.startDate, {
          weekday: true,
          year: false,
          locale,
        }),
      }),
      detail: t("fFirstReady"),
      action: { kind: "link", label: t("fOpenPlan"), href: "/app/program" },
      next,
      tone: "waiting",
    };
  if (
    s &&
    (s.status === "completed" || (s.status === "planned" && completedToday))
  )
    return {
      label: t("fToday"),
      title: t("fDoneTitle"),
      detail: t("fDoneText", { label: s.label || t("fYourSession") }),
      action: {
        kind: "link",
        label: t("fSeeProgress"),
        href: "/app/progress",
      },
      next,
      tone: "done",
    };
  if (s && s.status === "started" && s.workoutId)
    return {
      label: t("fInProgress"),
      title: s.label || t("trainingSession"),
      detail: t("fPickUp"),
      action: {
        kind: "link",
        label: t("fContinueWorkout"),
        href: `/app/workouts/${s.workoutId}`,
      },
      next,
    };
  if (s && s.status === "planned" && s.programId)
    return {
      label: t("fTodaySession"),
      title: s.label || t("trainingSession"),
      // "4 exercises · week 1".
      detail:
        t("exercises", { count: s.exercises }) +
        (s.week ? t("week", { n: s.week }) : ""),
      action: {
        kind: "start",
        label: t("fStartToday"),
        programId: s.programId,
        plannedSessionId: s.id,
      },
      next,
    };
  if (s && s.status === "canceled")
    return {
      label: t("fToday"),
      title: t("fNoSession"),
      detail: t("fCanceledText"),
      action: nutrition
        ? { kind: "link", label: t("logMeal"), href: "/app/nutrition/log" }
        : null,
      next,
      tone: "rest",
    };
  return {
    label: t("fToday"),
    title: t("restDay"),
    detail: t("restText"),
    action: nutrition
      ? { kind: "link", label: t("logMeal"), href: "/app/nutrition/log" }
      : null,
    secondary: nutrition
      ? null
      : { label: t("fOpenPlan"), href: "/app/program" },
    next,
    tone: "rest",
  };
}

export type StatusTile = {
  label: string;
  value: string;
  href?: string;
  /** A share to draw as a bar that grows to its value (docs/features/motion.md "g"). */
  meter?: { value: number; max: number; key: string };
  /** A count that counts up once (the streak); `value` is its text. */
  count?: number;
};

/**
 * The compact status under the focus: only numbers that mean something now.
 * Streak and sessions appear once a session was due; nutrition when the
 * coach set targets.
 */
export function todayStatus(
  data: TodayProgramme | null,
  locale: Locale = "en",
): StatusTile[] {
  if (!data) return [];
  const t = words(locale);
  const tiles: StatusTile[] = [];
  const p = data.programme;
  if (
    p &&
    p.state === "active" &&
    (data.planState === "ready" || data.planState === "self_paced")
  )
    tiles.push({
      label: p.billing === "upfront" ? t("sProgramme") : t("sBlock", { n: p.block }),
      value: t("dayOf", { day: p.day, of: p.of }),
      href: "/app/timeline",
      meter: { value: p.day, max: p.of, key: "today:programme" },
    });
  const progress = data.progress;
  if (data.planState === "ready" && progress && progress.scheduled > 0) {
    tiles.push({
      label: t("sSessionsWindow", { count: progress.windowDays }),
      value: t("sOf", { done: progress.completed, total: progress.scheduled }),
    });
    tiles.push({
      label: t("streak"),
      value: t("sStreakValue", { count: progress.streak }),
      count: progress.streak,
    });
  }
  const n = data.nutrition;
  if (n?.state === "ready" && n.target?.kcal)
    tiles.push({
      label: t("sEaten"),
      value: t("sKcal", {
        eaten: Math.round(n.consumed?.kcal ?? 0),
        target: Math.round(n.target.kcal),
      }),
      href: "/app/nutrition",
      // Moves from the value shown last when a meal was logged since.
      meter: {
        value: Math.round(n.consumed?.kcal ?? 0),
        max: Math.round(n.target.kcal),
        key: "today:kcal",
      },
    });
  return tiles;
}
