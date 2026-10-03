// The member app screens, phone first (docs/features/member-screens.md): the
// one date and time format, Today's "what to do now" for every plan state,
// unknown addresses, chat senders, membership states and errors, the intake
// step flow, the pain report, reads that never stay "Loading" and the plain
// wording rules for subscriber screens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  addCalendarDays,
  calendarDate,
  formatCountdown,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatTime,
  formatWhen,
  humanize,
  labelFor,
  nextDays,
  plural,
  recentDays,
  timeZoneChoices,
  zoneName,
} from "../apps/web/lib/format.ts";
import {
  nextLine,
  todayFocus,
  todayStatus,
  whenLabel,
  type TodayProgramme,
} from "../apps/web/components/member-today-model.ts";
import {
  isMemberRoute,
  memberBackTarget,
  memberPageTitle,
  memberTabs,
} from "../apps/web/components/member-nav.ts";
import {
  PAIN_NO_DETAILS,
  painDescription,
} from "../apps/web/components/pain-report.ts";
import {
  ACCOUNT_UNREACHABLE,
  accountRequest,
  fetchWithin,
} from "../apps/web/components/account-request.ts";
import {
  CHAT_PROMPTS,
  MemberChat,
  senderName,
} from "../apps/web/components/member-chat.tsx";
import {
  MEMBERSHIP_STATUS,
  MemberMembership,
  membershipError,
} from "../apps/web/components/member-membership.tsx";
import {
  MemberNotFound,
  WorkspaceUnavailable,
} from "../apps/web/components/member-states.tsx";
import {
  INTAKE_STEPS,
  MemberIntake,
} from "../apps/web/components/member-intake.tsx";
import {
  moveChoices,
  prescription,
  sessionDay,
} from "../apps/web/components/member-program.tsx";
import {
  activeWorkoutOf,
  finishedOn,
} from "../apps/web/components/member-today.tsx";
import { mealPreparation } from "../apps/web/components/nutrition.tsx";
import {
  BOOKING_STATUS,
  PAYMENT_STATUS,
  missedRule,
} from "../apps/web/components/bookings.tsx";
import { NOTIFICATION_CATEGORIES } from "../apps/web/components/notifications.tsx";
import { HealthKitSyncView } from "../apps/web/components/healthkit-sync.tsx";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_STATUS,
} from "../apps/web/components/support.tsx";
import { voiceReason } from "../apps/web/components/voice-session.tsx";
import { resolveBrandDesign } from "../packages/contracts/src/branding.ts";
import { translator } from "../apps/web/lib/i18n/core.ts";
import { CATALOG } from "../apps/web/lib/i18n/catalog.ts";

const source = (path: string) =>
  readFile(new URL("../" + path, import.meta.url), "utf8");
const render = (type: any, props: any) =>
  renderToStaticMarkup(createElement(type, props));
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

// --------------------------------------------------------------- format
test("one date and time format: 29 Sep 2026, 14:05, never seconds or ISO", () => {
  assert.equal(formatDate("2026-09-29"), "29 Sep 2026");
  assert.equal(
    formatDate("2026-09-29", { weekday: true, year: false }),
    "Tue 29 Sep",
  );
  assert.equal(
    formatDate("2026-09-29", { weekday: "long", longMonth: true, year: false }),
    "Tuesday 29 September",
  );
  // A calendar day is never shifted by a time zone.
  assert.equal(
    formatDate("2026-09-29", { zone: "Pacific/Honolulu" }),
    "29 Sep 2026",
  );
  // An instant is shown in the zone given.
  const instant = "2026-09-29T10:05:42.123Z";
  assert.equal(formatTime(instant, { zone: "Asia/Dubai" }), "14:05");
  assert.equal(
    formatDateTime(instant, { zone: "Asia/Dubai" }),
    "29 Sep 2026, 14:05",
  );
  assert.equal(
    formatDateTime("2026-09-29T22:30:00Z", { zone: "Asia/Dubai" }),
    "30 Sep 2026, 02:30",
  );
  assert.doesNotMatch(formatDateTime(instant, { zone: "UTC" }), /:42|2026-09/);
  // Missing and invalid values.
  assert.equal(formatDate(null), "");
  assert.equal(formatDate("not a date", { fallback: "—" }), "—");
  assert.equal(formatTime("2026-09-29"), "");
});

test("short 'when' for lists, ranges, day pickers and countdowns", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  assert.equal(
    formatWhen("2026-09-29T08:30:00Z", { zone: "UTC", now }),
    "Today, 08:30",
  );
  assert.equal(
    formatWhen("2026-09-28T21:15:00Z", { zone: "UTC", now }),
    "Yesterday, 21:15",
  );
  assert.equal(
    formatWhen("2026-09-20T09:00:00Z", { zone: "UTC", now }),
    "20 Sep, 09:00",
  );
  assert.equal(
    formatWhen("2025-12-31T09:00:00Z", { zone: "UTC", now }),
    "31 Dec 2025, 09:00",
  );
  assert.equal(
    formatDateRange("2026-09-29", "2026-10-05"),
    "29 Sep – 5 Oct 2026",
  );
  assert.equal(formatDateRange("2026-10-01", "2026-10-07"), "1 – 7 Oct 2026");
  assert.equal(
    formatDateRange("2026-12-28", "2027-01-03"),
    "28 Dec 2026 – 3 Jan 2027",
  );
  assert.equal(addCalendarDays("2026-09-30", 2), "2026-10-02");
  assert.equal(
    calendarDate("2026-09-29T22:30:00Z", "Asia/Dubai"),
    "2026-09-30",
  );
  assert.deepEqual(
    nextDays("2026-09-29", 3).map((d) => d.label),
    ["Today, Tue 29 Sep", "Tomorrow, Wed 30 Sep", "Thu 1 Oct"],
  );
  assert.deepEqual(
    recentDays("2026-09-29", "2026-09-01", 2).map((d) => [d.value, d.label]),
    [
      ["2026-09-29", "Today, Tue 29 Sep"],
      ["2026-09-28", "Yesterday, Mon 28 Sep"],
      ["2026-09-01", "Tue 1 Sep"],
    ],
  );
  assert.equal(formatCountdown(90), "1:30");
  assert.equal(formatCountdown(-4), "0:00");
});

test("wording helpers: time zones by name, plurals and labels instead of keys", () => {
  assert.equal(zoneName("Asia/Dubai"), "Gulf Standard Time");
  assert.equal(zoneName(null), "your local time");
  const choices = timeZoneChoices("Asia/Dubai");
  assert.ok(
    choices.some(
      (c) =>
        c.value === "Asia/Dubai" && /Dubai · Gulf Standard Time/.test(c.label),
    ),
  );
  assert.ok(choices.every((c) => !/^[A-Z][a-z]+\/[A-Za-z_]+$/.test(c.label)));
  assert.equal(plural(1, "serving"), "1 serving");
  assert.equal(plural(2, "completed session"), "2 completed sessions");
  assert.equal(plural(3, "meal entry", "meal entries"), "3 meal entries");
  assert.equal(humanize("payment_pending"), "Payment pending");
  assert.equal(labelFor(BOOKING_STATUS, "confirmed"), "Booked");
  assert.equal(labelFor(BOOKING_STATUS, "something_new"), "Something new");
  assert.equal(labelFor(PAYMENT_STATUS, "not_required"), "No payment needed");
  assert.match(missedRule("forfeit"), /counts as used/);
  assert.match(missedRule("review"), /your coach decides/);
  assert.equal(labelFor(NOTIFICATION_CATEGORIES, "booking"), "Booking");
  assert.equal(labelFor(NOTIFICATION_CATEGORIES, "coaching"), "Coaching");
  assert.equal(labelFor(MEMBERSHIP_STATUS, "past_due"), "Payment due");
});

// ---------------------------------------------------------------- Today
const base = (over: Partial<TodayProgramme> = {}): TodayProgramme => ({
  planState: "ready",
  today: "2026-09-30",
  intakeDone: true,
  programme: {
    state: "active",
    billing: "monthly",
    day: 3,
    of: 28,
    block: 1,
    startDate: "2026-09-28",
  },
  session: null,
  next: { id: "n", date: "2026-10-02", label: "Upper body", inDays: 2 },
  progress: {
    streak: 2,
    completed: 2,
    scheduled: 3,
    percent: 67,
    windowDays: 28,
  },
  ...over,
});
const focus = (data: TodayProgramme | null, extra: any = {}) =>
  todayFocus({
    data,
    active: null,
    programLabel: "Strength with Alex",
    nutrition: true,
    ...extra,
  });

test("Today, new follower: one next step, never programme buttons that lead nowhere", () => {
  const noIntake = focus(
    base({ planState: "none", intakeDone: false, programme: null, next: null }),
  );
  assert.equal(noIntake.title, "Tell your coach about you");
  assert.deepEqual(noIntake.action, {
    kind: "link",
    label: "Start your coaching profile",
    href: "/app/intake",
  });
  assert.equal(noIntake.secondary?.href, "/app/membership");
  const intake = focus(
    base({ planState: "none", programme: null, next: null }),
  );
  assert.equal(intake.title, "Choose your coaching membership");
  for (const f of [noIntake, intake]) {
    assert.notEqual((f.action as any)?.href, "/app/program");
    assert.notEqual(f.secondary?.href, "/app/program");
    assert.equal(f.next, undefined);
  }
  assert.deepEqual(
    todayStatus(base({ planState: "none", programme: null })),
    [],
  );
});

test("Today follows the plan: waiting, self-paced, not started, planned, started, done, cancelled, rest, ended", () => {
  const waiting = focus(base({ planState: "awaiting_coach", next: null }));
  assert.equal(waiting.title, "Your coach is preparing your plan");
  assert.equal((waiting.action as any).href, "/app/chat");
  assert.equal(
    (
      focus(base({ planState: "awaiting_coach", intakeDone: false }))
        .action as any
    ).href,
    "/app/intake",
  );
  const selfPaced = focus(
    base({
      planState: "self_paced",
      plan: {
        programId: "p1",
        title: "Strength foundations",
        daysPerWeek: 3,
        sessions: [{ label: "A", exercises: 3 }],
        completedThisWeek: 1,
      },
    }),
  );
  assert.equal(selfPaced.title, "Strength foundations");
  assert.match(selfPaced.detail, /^1 of 3 sessions in the last 7 days/);
  assert.deepEqual(selfPaced.action, {
    kind: "start",
    label: "Start a workout",
    programId: "p1",
  });
  const notStarted = focus(
    base({
      programme: {
        ...base().programme!,
        state: "not_started",
        startDate: "2026-10-01",
      },
    }),
  );
  assert.equal(notStarted.title, "Your programme starts Thu 1 Oct");
  const session = {
    id: "s1",
    label: "Lower body",
    status: "planned",
    week: 1,
    exercises: 4,
    programId: "p1",
    workoutId: null,
  };
  const planned = focus(base({ session }));
  assert.equal(planned.title, "Lower body");
  assert.equal(planned.detail, "4 exercises · week 1");
  assert.deepEqual(planned.action, {
    kind: "start",
    label: "Start today's session",
    programId: "p1",
    plannedSessionId: "s1",
  });
  assert.equal(planned.next, "Next: Upper body · Fri 2 Oct");
  const started = focus(
    base({ session: { ...session, status: "started", workoutId: "w1" } }),
  );
  assert.deepEqual(started.action, {
    kind: "link",
    label: "Continue workout",
    href: "/app/workouts/w1",
  });
  assert.equal(
    focus(base({ session: { ...session, status: "completed" } })).title,
    "Done for today",
  );
  // A workout finished today outside the planned session still reads done.
  assert.equal(
    focus(base({ session }), { completedToday: true }).title,
    "Done for today",
  );
  const cancelled = focus(
    base({ session: { ...session, status: "canceled" } }),
  );
  assert.equal(cancelled.title, "No session today");
  const rest = focus(base());
  assert.equal(rest.title, "Rest day");
  assert.equal((rest.action as any).href, "/app/nutrition/log");
  const restNoNutrition = focus(base(), { nutrition: false });
  assert.equal(restNoNutrition.action, null);
  assert.equal(restNoNutrition.secondary?.href, "/app/program");
  assert.equal(
    focus(base({ planState: "ended" })).title,
    "Your membership has ended",
  );
  assert.equal(
    focus(
      base({
        planState: "ended",
        programme: { ...base().programme!, billing: "upfront" },
      }),
    ).title,
    "You completed your programme",
  );
});

test("Today: a workout in progress comes first; status shows only numbers that mean something", () => {
  const active = { id: "w9", title: "Strength A", logged: 2, total: 9 };
  const f = focus(base({ planState: "none" }), { active });
  assert.equal(f.label, "In progress");
  assert.equal(f.detail, "2 of 9 sets logged");
  assert.deepEqual(f.action, {
    kind: "link",
    label: "Continue workout",
    href: "/app/workouts/w9",
  });
  assert.deepEqual(
    todayStatus(
      base({
        nutrition: {
          state: "ready",
          target: { kcal: 2000 },
          consumed: { kcal: 850.4 },
        },
      }),
    ).map((t) => [t.label, t.value]),
    [
      ["Block 1", "Day 3 of 28"],
      ["Sessions, last 28 days", "2 of 3"],
      ["Streak", "2 sessions"],
      ["Eaten today", "850 of 2000 kcal"],
    ],
  );
  // Nothing scheduled yet: no "0/0" and no empty streak.
  const empty = todayStatus(
    base({
      progress: {
        streak: 0,
        completed: 0,
        scheduled: 0,
        percent: null,
        windowDays: 28,
      },
    }),
  );
  assert.deepEqual(
    empty.map((t) => t.label),
    ["Block 1"],
  );
  assert.equal(whenLabel({ date: "2026-10-01", inDays: 1 }), "Tomorrow");
  assert.equal(nextLine(null), null);
  const records = [
    {
      id: "w1",
      kind: "workout",
      status: "active",
      data: { program: { title: "A", exercises: [{ sets: 3 }, { sets: 2 }] } },
    },
    {
      id: "w2",
      kind: "workout",
      status: "completed",
      data: { completedAt: "2026-09-30T08:00:00Z" },
    },
  ];
  assert.deepEqual(
    activeWorkoutOf(records, [{ workout_id: "w1" }, { workout_id: "w2" }]),
    {
      id: "w1",
      title: "A",
      logged: 1,
      total: 5,
    },
  );
  assert.equal(finishedOn(records, calendarDate("2026-09-30T08:00:00Z")), true);
});

// ---------------------------------------------------- programme, nav, 404
test("programme: plain prescriptions, day names and move choices without taken days", () => {
  assert.equal(
    prescription({ sets: 3, reps: 10, loadKg: 16, restSeconds: 90, rir: 2 }),
    "3 × 10 reps · 16 kg · rest 90 s · leave 2 reps in reserve",
  );
  assert.equal(prescription({ sets: 2, seconds: 30 }), "2 × 30 s");
  assert.equal(sessionDay("2026-09-30", "2026-09-30"), "Today");
  assert.equal(sessionDay("2026-10-01", "2026-09-30"), "Tomorrow");
  assert.equal(sessionDay("2026-10-02", "2026-09-30"), "Fri 2 Oct");
  const session = { id: "a", status: "planned", data: { date: "2026-10-02" } };
  const planned = [
    session,
    { id: "b", status: "planned", data: { date: "2026-10-01" } },
    { id: "c", status: "canceled", data: { date: "2026-10-03" } },
  ];
  const choices = moveChoices("2026-09-30", session, planned).map(
    (d) => d.value,
  );
  assert.equal(choices.includes("2026-10-01"), false);
  assert.equal(choices.includes("2026-10-02"), true);
  assert.equal(choices.includes("2026-10-03"), true);
  assert.equal(choices.length, 13);
});

test("unknown member addresses get a not-found screen with a way back", () => {
  for (const path of [
    "/app",
    "/app/program",
    "/app/nutrition/log",
    "/app/workouts/abc-123",
    "/app/voice-session/planned/x1",
  ])
    assert.equal(isMemberRoute(path), true, path);
  for (const path of [
    "/app/foo",
    "/app/program/extra",
    "/app/workouts/",
    "/app/nutrition/plan",
  ])
    assert.equal(isMemberRoute(path), false, path);
  assert.equal(
    memberPageTitle("/app/foo", { programLabel: "Programme", nutrition: true }),
    "Page not found",
  );
  assert.equal(
    memberBackTarget("/app/foo", {
      programLabel: "Programme",
      nutrition: true,
    }),
    "/app",
  );
  const html = text(render(MemberNotFound, {}));
  assert.match(html, /This page does not exist/);
  assert.match(html, /Go to Today/);
  assert.match(html, /See everything in More/);
});

test("the workspace error screen is clearly an error, with a retry and a way to sign out", () => {
  const html = render(WorkspaceUnavailable, {
    message: "The app could not connect just now.",
    onRetry: () => {},
    onSignOut: () => {},
  });
  assert.match(html, /role="alert"/);
  assert.match(text(html), /Your coaching app could not open/);
  assert.match(text(html), /Try again/);
  assert.match(text(html), /Sign out/);
});

test("the default programme label follows the product's spelling", () => {
  assert.equal(resolveBrandDesign({}).programLabel, "Programme");
  assert.equal(
    memberTabs({
      programLabel: resolveBrandDesign({}).programLabel,
      nutrition: true,
    })[1].label,
    "Plan",
  );
});

// ------------------------------------------------------------------ chat
const memberState = {
  user: {
    userId: "u1",
    tenantId: "t1",
    role: "subscriber",
    name: "Sam Taylor",
  },
  tenant: { name: "Alex Morgan", theme: {} },
  records: [],
  subscriptions: [],
};
test("coach chat: senders are the coach's name and You; the composer is pinned; loading is not an empty chat", () => {
  assert.equal(senderName("subscriber", "Alex Morgan"), "You");
  assert.equal(senderName("trainer", "Alex Morgan"), "Alex Morgan");
  assert.equal(senderName(undefined, "Alex Morgan"), "Alex Morgan");
  assert.equal(senderName("digital_qualified", "Alex Morgan"), "Digital coach");
  assert.ok(CHAT_PROMPTS.length >= 3);
  const html = render(MemberChat, { state: memberState });
  // Before the thread answers it says so; "no messages" is never assumed.
  assert.match(text(html), /Loading your messages/);
  assert.doesNotMatch(text(html), /No messages yet|Start a conversation/);
  assert.match(html, /role="region" aria-label="Write a message"/);
  assert.match(text(html), /Send to Alex/);
  assert.doesNotMatch(text(html), /\btrainer\b|\bsubscriber\b/);
});

// ------------------------------------------------------------ membership
test("membership: no empty plan picker, a plan in plain words, no checkout card while a plan is active", () => {
  const none = text(
    render(MemberMembership, {
      state: memberState,
      offers: [],
      onChanged: () => {},
    }),
  );
  assert.match(none, /Memberships are not open yet/);
  assert.match(none, /Message your coach/);
  assert.doesNotMatch(none, /Checkout status|Discount code/);
  const offers = [
    {
      id: "p1",
      status: "published",
      data: {
        name: "Coaching",
        description: "Monthly coaching",
        priceMinor: 19900,
        billing: "monthly",
      },
    },
  ];
  const choose = text(
    render(MemberMembership, {
      state: memberState,
      offers,
      onChanged: () => {},
    }),
  );
  assert.match(choose, /Choose your coaching membership/);
  assert.match(choose, /Join this plan/);
  assert.match(choose, /Have a discount code\?/);
  const active = text(
    render(MemberMembership, {
      state: {
        ...memberState,
        subscriptions: [
          {
            id: "s1",
            status: "active",
            price_minor: 19900,
            period_end: "2026-10-30T10:00:00Z",
            data: { productId: "p1", modules: ["training", "nutrition"] },
          },
        ],
      },
      offers,
      onChanged: () => {},
    }),
  );
  assert.match(active, /AED 199\.00 a month/);
  assert.match(active, /Active Training and nutrition coaching/);
  assert.match(active, /Renews on 30 Oct 2026/);
  assert.match(active, /Stop renewal…/);
  assert.doesNotMatch(
    active,
    /Checkout status|checkout was not finished|No invoices/,
  );
});

test("membership errors are plain words with a next step", () => {
  assert.match(
    membershipError(
      { status: 503, message: "This connection is not configured" },
      "stop your renewal",
    ),
    /Payments are not available in the app right now, so we could not stop your renewal\. Message your coach/,
  );
  assert.match(
    membershipError({ status: 409 }, "stop your renewal"),
    /changed while you were looking/,
  );
  assert.match(membershipError({}, "open checkout"), /Check your connection/);
  assert.match(
    membershipError(
      { status: 400, message: "PROVIDER_REFUSED" },
      "open checkout",
    ),
    /We could not open checkout/,
  );
  assert.equal(
    membershipError(
      { status: 400, message: "That discount code has expired." },
      "open checkout",
    ),
    "That discount code has expired.",
  );
});

// ---------------------------------------------------------------- intake
test("intake opens on the questions as a step flow with Next in the sticky bar", () => {
  // Step titles are catalog keys (docs/features/arabic.md); English here.
  const profileEn = translator(CATALOG.profile, "en");
  assert.deepEqual(
    INTAKE_STEPS.map((s) => profileEn(s.title)),
    [
      "About you",
      "Your goal",
      "Your training week",
      "Anything your coach should know",
    ],
  );
  const html = render(MemberIntake, { intake: null });
  assert.match(text(html), /Step 1 of 4/);
  assert.match(html, /role="region" aria-label="Coaching profile steps"/);
  assert.match(text(html), /Next/);
  assert.match(
    html,
    /name="age"[^>]*inputMode="numeric"|inputMode="numeric"[^>]*name="age"/i,
  );
  // Security settings stay in Profile and settings.
  assert.doesNotMatch(text(html), /Authenticator|Passkey|password|Leave Alex/i);
  // Only the first step is shown.
  assert.equal((html.match(/<fieldset[^>]*hidden/g) ?? []).length, 3);
});

// -------------------------------------------------------------- safety
test("the pain report stops the workout even without a note", () => {
  assert.equal(painDescription(""), PAIN_NO_DETAILS);
  assert.equal(painDescription("  "), PAIN_NO_DETAILS);
  assert.equal(
    painDescription("ow"),
    "Pain or a problem during the workout: ow",
  );
  assert.equal(painDescription(" sharp knee pain "), "sharp knee pain");
  assert.ok(PAIN_NO_DETAILS.length >= 3);
});

test("workout and guided session: Report pain opens a sheet whose stop button never waits for typing", async () => {
  for (const file of [
    "apps/web/components/workspace-training.tsx",
    "apps/web/components/integration-center.tsx",
  ]) {
    const src = await source(file);
    // The wording is the catalog's (lib/i18n/messages/workout.ts).
    assert.match(src, /t\("reportPain"\)/);
    assert.match(src, /title=\{t\("painTitle"\)\}/);
    assert.match(src, /painDescription\(painText\)/);
    assert.doesNotMatch(src, /disabled=\{[^}]*painText/);
    assert.doesNotMatch(src, /window\.prompt\([^)]*pain/i);
  }
  const workout = CATALOG.workout.en;
  assert.equal(workout.reportPain, "Report pain");
  assert.equal(workout.painTitle, "Report pain or a problem");
  assert.equal(workout.whatHappened, "What happened? (optional)");
  assert.equal(workout.gConcern, "What happened? (optional)");
});

// ------------------------------------------------- reads never stay loading
test("account reads end in a message after a time limit instead of loading forever", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (() => new Promise(() => {})) as any;
    await assert.rejects(fetchWithin("/x", {}, 20), /timeout/);
    await assert.rejects(
      accountRequest("/account", "GET", undefined, { timeoutMs: 20 }),
      (e: any) => {
        assert.equal(e.message, ACCOUNT_UNREACHABLE);
        assert.equal(e.code, "NETWORK");
        return true;
      },
    );
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as any;
    await assert.rejects(accountRequest("/account"), /That did not work/);
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: 1 }), { status: 200 })) as any;
    assert.deepEqual(await accountRequest("/account"), { ok: 1 });
  } finally {
    globalThis.fetch = original;
  }
  // Every account card shows a failed read with a retry.
  for (const file of [
    "account-settings.tsx",
    "account-security.tsx",
    "account-completion.tsx",
  ]) {
    const src = await source("apps/web/components/" + file);
    // "Try again" comes from the account catalog.
    assert.match(src, /t\("tryAgain"\)/, file);
  }
  assert.equal(CATALOG.account.en.tryAgain, "Try again");
  const security = await source("apps/web/components/account-security.tsx");
  assert.doesNotMatch(security, /await fetch\(/);
});

test("Apple Health sync status: a failed read offers Check again instead of Loading", () => {
  const props = {
    role: "subscriber",
    message: "",
    busy: false,
    consent: false,
    pairing: null,
    onConsent() {},
    onPair() {},
    onRevoke() {},
    onDelete() {},
  };
  const failed = text(
    render(HealthKitSyncView, {
      ...props,
      status: null,
      failed: true,
      onRetry() {},
    }),
  );
  assert.match(failed, /could not be checked just now/);
  assert.match(failed, /Check again/);
  assert.doesNotMatch(failed, /Loading sync status/);
  assert.match(
    text(render(HealthKitSyncView, { ...props, status: null })),
    /Loading sync status/,
  );
});

// ------------------------------------------------------------- wording
test("nutrition wording: one preparation line, test data only in development", async () => {
  assert.equal(
    mealPreparation({
      cookingName: "Hob preparation",
      minutes: 20,
      equipment: ["hob"],
    }),
    "Hob preparation · 20 min",
  );
  assert.equal(
    mealPreparation({
      cookingName: "Oven bake",
      minutes: 35,
      equipment: ["tray"],
    }),
    "Oven bake · 35 min · tray",
  );
  assert.equal(mealPreparation({}), "");
  const src = await source("apps/web/components/nutrition.tsx");
  assert.doesNotMatch(
    src,
    /serving\(s\)|Approx\. |fixture data|qualified for personal use/,
  );
  assert.match(src, /environment === "development"/);
  const capture = await source("apps/web/components/meal-capture.tsx");
  assert.doesNotMatch(
    capture,
    /awaiting the platform|awaiting platform activation|EAN-8/,
  );
  // The wording is the catalog's (lib/i18n/messages/capture.ts).
  assert.match(capture, /t\("estimateThenEdit"\)/);
  assert.match(capture, /label=\{t\("mealActions"\)\}/);
  assert.equal(CATALOG.capture.en.estimateThenEdit, "An estimate, then your edit.");
  assert.equal(CATALOG.capture.en.mealActions, "Meal actions");
  const nutritionEn = JSON.stringify(CATALOG.nutrition.en);
  assert.doesNotMatch(
    nutritionEn,
    /serving\(s\)|Approx\. |fixture data|qualified for personal use/,
  );
  assert.doesNotMatch(
    JSON.stringify(CATALOG.capture.en),
    /awaiting the platform|awaiting platform activation|EAN-8/,
  );
});

test("member screens use the shared format, plain labels and 'coach' wording", async () => {
  const files = [
    "member-today.tsx",
    "member-program.tsx",
    "member-chat.tsx",
    "member-membership.tsx",
    "member-context.tsx",
    "member-intake.tsx",
    "programme-today.tsx",
    "bookings.tsx",
    "notifications.tsx",
    "support.tsx",
    "voice-session.tsx",
    "meal-capture.tsx",
    "healthkit-sync.tsx",
    "account-completion.tsx",
    "passkeys.tsx",
  ];
  for (const file of files) {
    const src = await source("apps/web/components/" + file);
    assert.doesNotMatch(
      src,
      /toLocaleString\(\)|toLocaleDateString\(|toLocaleTimeString\(/,
      file,
    );
    assert.doesNotMatch(src, /\.replaceAll\("_", " "\)/, file);
  }
  // The training hold's wording is the profile catalog's.
  assert.equal(CATALOG.profile.en.messageTrainer, "Message your coach");
  assert.doesNotMatch(JSON.stringify(CATALOG.profile.en), /Message your trainer/);
  // The development notice stays development-only.
  const workspace = await source("apps/web/components/workspace.tsx");
  assert.match(
    workspace,
    /state\.environment === "development" &&\s*!path\.startsWith\("\/app\/chat"\) \? \(\s*<p className="member-dev-note">/,
  );
});

test("the member screens stylesheet is phone first and logical", async () => {
  const css = await source("apps/web/app/member-screens.css");
  assert.doesNotMatch(css, /max-width\s*:\s*\d+px\s*\)/);
  assert.doesNotMatch(css, /@media[^{]*max-width/);
  assert.doesNotMatch(
    css,
    /(^|[\s;{])(margin|padding)-(left|right|top|bottom)\s*:/m,
  );
  assert.doesNotMatch(css, /\b(animation|transition)\s*:/);
  const layout = await source("apps/web/app/layout.tsx");
  assert.match(layout, /import "\.\/member-screens\.css";/);
});

test("voice sessions give one plain reason, never the list of internal checks", () => {
  const all = [
    { code: "VOICE_MEMBERSHIP" },
    { code: "VOICE_CONTRACT" },
    { code: "VOICE_NOT_VERIFIED" },
    { code: "PLAYBACK_CONSENT" },
  ];
  const reason = voiceReason(all);
  // The server stores the first failed check in this order, so the
  // preparation page and the running session give the same reason.
  assert.equal(
    reason,
    "Your plan does not include your coach's voice, so this session is guided in text.",
  );
  assert.equal(
    voiceReason([{ code: "VOICE_CONTRACT" }, { code: "PLAYBACK_CONSENT" }]),
    "Your coach's voice is not available yet, so this session is guided in text. Everything else works the same.",
  );
  assert.doesNotMatch(reason, /enrollment|verification|platform|permission/i);
  assert.match(voiceReason([{ code: "TRAINING_HELD" }, ...all]), /paused/);
  assert.match(voiceReason([{ code: "PLAYBACK_CONSENT" }]), /Tick the box/);
  assert.equal(voiceReason([]), "This session is guided in text.");
});

test("support shows categories and statuses in words", () => {
  assert.equal(labelFor(SUPPORT_STATUS, "open"), "Open");
  assert.equal(labelFor(SUPPORT_STATUS, "pending"), "Waiting for your reply");
  const categories = Object.fromEntries(SUPPORT_CATEGORIES);
  assert.equal(categories.account, "My account or sign-in");
  assert.ok(Object.values(categories).every((label) => /^[A-Z]/.test(label)));
});
