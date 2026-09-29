/**
 * What the member's Today screen leads with (docs/features/member-screens.md):
 * one "what to do now" with one primary action, a compact status and the
 * next session. Pure, so every plan state is tested without a browser
 * (tests/member-screens.test.ts). Everything comes from one source: the
 * programme API (`/programme/today`, read from the assigned programme's
 * planned sessions) and the member's own workouts from the bootstrap.
 */
import { formatDate, plural } from "../lib/format";

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
export function whenLabel(next: { date: string; inDays: number }) {
  if (next.inDays === 0) return "Today";
  if (next.inDays === 1) return "Tomorrow";
  return formatDate(next.date, { weekday: true, year: false });
}
export function nextLine(next: TodayProgramme["next"]) {
  if (!next) return null;
  return `Next: ${next.label || "Training session"} · ${whenLabel(next)}`;
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
}): TodayFocus {
  const { data, active, programLabel, nutrition, completedToday } = input;
  // A workout already in progress always comes first.
  if (active)
    return {
      label: "In progress",
      title: active.title,
      detail: active.total
        ? `${active.logged} of ${plural(active.total, "set")} logged`
        : "Pick up where you left off.",
      action: {
        kind: "link",
        label: "Continue workout",
        href: `/app/workouts/${active.id}`,
      },
      tone: "default",
    };
  const state = data?.planState ?? "none";
  const intake = !!data?.intakeDone;
  const next = nextLine(data?.next);
  if (state === "none")
    return intake
      ? {
          label: "Get started",
          title: "Choose your coaching membership",
          detail:
            "Your coach's plan appears here day by day once your membership starts.",
          action: {
            kind: "link",
            label: "See membership options",
            href: "/app/membership",
          },
          tone: "waiting",
        }
      : {
          label: "Get started",
          title: "Tell your coach about you",
          detail:
            "Answer a few questions about your goals, experience and limits. It takes about two minutes.",
          action: {
            kind: "link",
            label: "Start your coaching profile",
            href: "/app/intake",
          },
          secondary: {
            label: "See membership options",
            href: "/app/membership",
          },
          tone: "waiting",
        };
  if (state === "ended") {
    const upfront = data?.programme?.billing === "upfront";
    return {
      label: upfront ? "Programme complete" : "Membership ended",
      title: upfront
        ? "You completed your programme"
        : "Your membership has ended",
      detail: "Choose a plan to keep training with your coach.",
      action: {
        kind: "link",
        label: "Choose your next plan",
        href: "/app/membership#offers",
      },
      tone: "done",
    };
  }
  if (state === "awaiting_coach")
    return {
      label: "Your plan",
      title: "Your coach is preparing your plan",
      detail: intake
        ? "Your sessions appear here as soon as it is ready. Ask your coach anything in the meantime."
        : "Your sessions appear here as soon as it is ready. Your answers help your coach plan them.",
      action: intake
        ? { kind: "link", label: "Message your coach", href: "/app/chat" }
        : {
            kind: "link",
            label: "Complete your coaching profile",
            href: "/app/intake",
          },
      tone: "waiting",
    };
  if (state === "self_paced" && data?.plan) {
    const plan = data.plan;
    const week = plan.daysPerWeek
      ? `${plan.completedThisWeek} of ${plural(plan.daysPerWeek, "session")} in the last 7 days`
      : plural(plan.completedThisWeek, "session") + " in the last 7 days";
    return {
      label: "Your plan · at your own pace",
      title: plan.title || programLabel,
      detail: `${week}. Train on the days that suit you.`,
      action: {
        kind: "start",
        label: "Start a workout",
        programId: plan.programId,
      },
      tone: "default",
    };
  }
  const s = data?.session;
  const notStarted = data?.programme?.state === "not_started";
  if (notStarted && data?.programme)
    return {
      label: "Your plan",
      title: `Your programme starts ${formatDate(data.programme.startDate, { weekday: true, year: false })}`,
      detail: "Your first session is ready for you then.",
      action: { kind: "link", label: "Open your plan", href: "/app/program" },
      next,
      tone: "waiting",
    };
  if (
    s &&
    (s.status === "completed" || (s.status === "planned" && completedToday))
  )
    return {
      label: "Today",
      title: "Done for today",
      detail: `${s.label || "Your session"} is logged. Nice work.`,
      action: {
        kind: "link",
        label: "See your progress",
        href: "/app/progress",
      },
      next,
      tone: "done",
    };
  if (s && s.status === "started" && s.workoutId)
    return {
      label: "In progress",
      title: s.label || "Training session",
      detail: "Pick up where you left off.",
      action: {
        kind: "link",
        label: "Continue workout",
        href: `/app/workouts/${s.workoutId}`,
      },
      next,
    };
  if (s && s.status === "planned" && s.programId)
    return {
      label: "Today's session",
      title: s.label || "Training session",
      detail: [plural(s.exercises, "exercise"), s.week ? `week ${s.week}` : ""]
        .filter(Boolean)
        .join(" · "),
      action: {
        kind: "start",
        label: "Start today's session",
        programId: s.programId,
        plannedSessionId: s.id,
      },
      next,
    };
  if (s && s.status === "canceled")
    return {
      label: "Today",
      title: "No session today",
      detail: "Your coach cancelled today's session. Rest, or move gently.",
      action: nutrition
        ? { kind: "link", label: "Log a meal", href: "/app/nutrition/log" }
        : null,
      next,
      tone: "rest",
    };
  return {
    label: "Today",
    title: "Rest day",
    detail: "Recovery is part of the plan. Move gently and sleep well.",
    action: nutrition
      ? { kind: "link", label: "Log a meal", href: "/app/nutrition/log" }
      : null,
    secondary: nutrition
      ? null
      : { label: "Open your plan", href: "/app/program" },
    next,
    tone: "rest",
  };
}

export type StatusTile = { label: string; value: string; href?: string };

/**
 * The compact status under the focus: only numbers that mean something now.
 * Streak and sessions appear once a session was due; nutrition when the
 * coach set targets.
 */
export function todayStatus(data: TodayProgramme | null): StatusTile[] {
  if (!data) return [];
  const tiles: StatusTile[] = [];
  const p = data.programme;
  if (
    p &&
    p.state === "active" &&
    (data.planState === "ready" || data.planState === "self_paced")
  )
    tiles.push({
      label: p.billing === "upfront" ? "Programme" : `Block ${p.block}`,
      value: `Day ${p.day} of ${p.of}`,
      href: "/app/timeline",
    });
  const progress = data.progress;
  if (data.planState === "ready" && progress && progress.scheduled > 0) {
    tiles.push({
      label: `Sessions, last ${progress.windowDays} days`,
      value: `${progress.completed} of ${progress.scheduled}`,
    });
    tiles.push({
      label: "Streak",
      value: plural(progress.streak, "session"),
    });
  }
  const n = data.nutrition;
  if (n?.state === "ready" && n.target?.kcal)
    tiles.push({
      label: "Eaten today",
      value: `${Math.round(n.consumed?.kcal ?? 0)} of ${Math.round(n.target.kcal)} kcal`,
      href: "/app/nutrition",
    });
  return tiles;
}
