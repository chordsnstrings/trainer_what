/**
 * The member app's navigation model (docs/features/phone-first.md): the five
 * phone tabs, the More list, the laptop side navigation, which one item is
 * current, the in-app back target of every sub-page and the top bar title.
 * Pure functions, so the rules are tested without a browser
 * (tests/member-shell.test.ts); components/member-shell.tsx renders them.
 */

export type MemberIcon =
  | "today"
  | "program"
  | "timeline"
  | "chat"
  | "nutrition"
  | "meal"
  | "progress"
  | "bookings"
  | "context"
  | "intake"
  | "connections"
  | "galleries"
  | "notifications"
  | "support"
  | "membership"
  | "settings"
  | "privacy"
  | "more";

export type MemberDestination = {
  id: string;
  label: string;
  href: string;
  icon: MemberIcon;
  /** One plain line under the label in the More list. */
  detail?: string;
};

export type MemberNavOptions = {
  /** The coach's own name for the training plan (Design Studio). */
  programLabel: string;
  /** False when nutrition is off for this member: Progress takes its tab. */
  nutrition: boolean;
};

export const MEMBER_HOME = "/app";
export const MEMBER_MORE = "/app/more";

const D = {
  today: { id: "today", label: "Today", href: "/app", icon: "today" },
  program: {
    id: "program",
    label: "My program",
    href: "/app/program",
    icon: "program",
    detail: "Your plan and training calendar",
  },
  timeline: {
    id: "timeline",
    label: "Timeline",
    href: "/app/timeline",
    icon: "timeline",
    detail: "Every day of this block",
  },
  chat: {
    id: "chat",
    label: "Coach chat",
    href: "/app/chat",
    icon: "chat",
    detail: "Messages with your coach",
  },
  nutrition: {
    id: "nutrition",
    label: "Nutrition",
    href: "/app/nutrition",
    icon: "nutrition",
    detail: "Meals, groceries and your diary",
  },
  meal: {
    id: "meal",
    label: "Log a meal",
    href: "/app/nutrition/log",
    icon: "meal",
    detail: "A photo, a barcode or a note",
  },
  progress: {
    id: "progress",
    label: "Progress",
    href: "/app/progress",
    icon: "progress",
    detail: "Sessions, sets and personal bests",
  },
  bookings: {
    id: "bookings",
    label: "Bookings",
    href: "/app/bookings",
    icon: "bookings",
    detail: "Book time with your coach",
  },
  context: {
    id: "context",
    label: "Coaching context",
    href: "/app/twin",
    icon: "context",
    detail: "What your coach knows about you",
  },
  intake: {
    id: "intake",
    label: "Coaching profile",
    href: "/app/intake",
    icon: "intake",
    detail: "Your goals, experience and limits",
  },
  connections: {
    id: "connections",
    label: "Connections",
    href: "/app/wearables",
    icon: "connections",
    detail: "Wearables and Apple Health",
  },
  galleries: {
    id: "galleries",
    label: "Coach galleries",
    href: "/app/galleries",
    icon: "galleries",
    detail: "Photos your coach shares",
  },
  notifications: {
    id: "notifications",
    label: "Notifications",
    href: "/app/notifications",
    icon: "notifications",
    detail: "Updates from your coach",
  },
  support: {
    id: "support",
    label: "Support",
    href: "/app/support",
    icon: "support",
    detail: "Ask for help with your account",
  },
  membership: {
    id: "membership",
    label: "Membership",
    href: "/app/membership",
    icon: "membership",
    detail: "Your plan, payments and receipts",
  },
  settings: {
    id: "settings",
    label: "Profile and settings",
    href: "/app/profile",
    icon: "settings",
    detail: "Sign-in, language and notifications",
  },
  privacy: {
    id: "privacy",
    label: "Privacy and your data",
    href: "/app/profile#privacy",
    icon: "privacy",
    detail: "Download or delete your data",
  },
  more: { id: "more", label: "More", href: MEMBER_MORE, icon: "more" },
} satisfies Record<string, MemberDestination>;

function program(options: MemberNavOptions): MemberDestination {
  return { ...D.program, label: options.programLabel || D.program.label };
}

/** The five phone tabs: Today, the programme, Coach chat, Nutrition or Progress, More. */
export function memberTabs(options: MemberNavOptions): MemberDestination[] {
  return [
    { ...D.today },
    program(options),
    { ...D.chat, label: "Chat" },
    options.nutrition ? { ...D.nutrition } : { ...D.progress },
    { ...D.more },
  ];
}

/** The More screen: everything that is not a tab, grouped. */
export function moreGroups(
  options: MemberNavOptions,
): Array<{ title: string; items: MemberDestination[] }> {
  return [
    {
      title: "Training and coaching",
      items: [
        options.nutrition ? D.progress : D.nutrition,
        D.timeline,
        ...(options.nutrition ? [D.meal] : []),
        D.bookings,
        D.context,
        D.intake,
        D.galleries,
      ],
    },
    {
      title: "Updates and help",
      items: [D.notifications, D.connections, D.support],
    },
    {
      title: "Your account",
      items: [D.membership, D.settings, D.privacy],
    },
  ];
}

/** Laptop side navigation: the tab destinations first, then the rest. */
export function sideNavigation(
  options: MemberNavOptions,
): Array<{ title?: string; items: MemberDestination[] }> {
  return [
    {
      items: [
        D.today,
        program(options),
        D.timeline,
        D.chat,
        ...(options.nutrition ? [D.nutrition, D.meal] : []),
        D.progress,
      ],
    },
    {
      title: "Coaching",
      items: [
        ...(options.nutrition ? [] : [D.nutrition]),
        D.bookings,
        D.context,
        D.intake,
        D.galleries,
      ],
    },
    {
      title: "Updates and help",
      items: [D.notifications, D.connections, D.support],
    },
    { title: "Your account", items: [D.membership, D.settings] },
  ];
}

function clean(path: string) {
  const bare = path.split(/[?#]/)[0].replace(/\/+$/, "");
  return bare || MEMBER_HOME;
}

/** The pages that sit under the programme tab (and its side navigation item). */
function isProgramPage(path: string) {
  return (
    path === "/app/program" ||
    path.startsWith("/app/workouts/") ||
    path.startsWith("/app/guided/") ||
    path.startsWith("/app/voice-session/")
  );
}

/** Which of the five tabs is current for a path. */
export function activeTab(path: string, options: MemberNavOptions): string {
  const p = clean(path);
  if (p === MEMBER_HOME) return "today";
  if (isProgramPage(p) || p === "/app/timeline") return "program";
  if (p === "/app/chat") return "chat";
  if (
    options.nutrition &&
    (p === "/app/nutrition" || p.startsWith("/app/nutrition/"))
  )
    return "nutrition";
  if (!options.nutrition && p === "/app/progress") return "progress";
  return "more";
}

/** The single side navigation item that is current, or null. */
export function activeDestination(path: string): string | null {
  const p = clean(path);
  if (p === MEMBER_HOME) return "today";
  if (isProgramPage(p)) return "program";
  if (p === "/app/nutrition/log") return "meal";
  const all = Object.values(D).filter((d) => d.id !== "privacy");
  // Longest address first, so /app/nutrition/log never also lights Nutrition.
  const match = all
    .filter((d) => d.href !== MEMBER_HOME)
    .sort((a, b) => b.href.length - a.href.length)
    .find((d) => p === d.href || p.startsWith(d.href + "/"));
  return match?.id ?? null;
}

/** Top-level screens (tabs) have no back button; every other page does. */
export function memberBackTarget(
  path: string,
  options: MemberNavOptions,
): string | null {
  const p = clean(path);
  const tabs = memberTabs(options).map((t) => t.href);
  if (tabs.includes(p)) return null;
  if (p === "/app/timeline") return "/app/program";
  const guided = p.match(/^\/app\/guided\/([^/]+)$/);
  if (guided) return `/app/workouts/${guided[1]}`;
  if (p.startsWith("/app/voice-session/planned/")) return "/app/program";
  const voice = p.match(/^\/app\/voice-session\/([^/]+)$/);
  if (voice) return `/app/workouts/${voice[1]}`;
  if (p.startsWith("/app/workouts/")) return "/app/program";
  if (p.startsWith("/app/nutrition/")) return "/app/nutrition";
  return MEMBER_MORE;
}

const TITLES: Array<[RegExp, string]> = [
  [/^\/app\/timeline$/, "Timeline"],
  [/^\/app\/workouts\//, "Workout"],
  [/^\/app\/guided\//, "Guided session"],
  [/^\/app\/voice-session\//, "Voice-led session"],
  [/^\/app\/chat$/, "Coach chat"],
  [/^\/app\/nutrition\/log$/, "Log a meal"],
  [/^\/app\/nutrition(\/|$)/, "Nutrition"],
  [/^\/app\/notifications$/, "Notifications"],
  [/^\/app\/bookings$/, "Bookings"],
  [/^\/app\/support$/, "Support"],
  [/^\/app\/progress$/, "Progress"],
  [/^\/app\/twin$/, "Coaching context"],
  [/^\/app\/intake$/, "Coaching profile"],
  [/^\/app\/membership$/, "Membership"],
  [/^\/app\/wearables$/, "Connections"],
  [/^\/app\/galleries$/, "Coach galleries"],
  [/^\/app\/profile$/, "Profile and settings"],
  [/^\/app\/more$/, "More"],
];

/**
 * The compact top bar's title. Today shows the coach's identity instead
 * (null here); a workout passes its own name.
 */
export function memberPageTitle(
  path: string,
  options: MemberNavOptions & { workoutTitle?: string | null },
): string | null {
  const p = clean(path);
  if (p === MEMBER_HOME) return null;
  if (p === "/app/program") return program(options).label;
  if (p.startsWith("/app/workouts/") && options.workoutTitle)
    return options.workoutTitle;
  return TITLES.find(([pattern]) => pattern.test(p))?.[1] ?? "Your coaching";
}

type ChatMessage = { created_at: string; data?: { author?: string } };

/**
 * Coach messages (the coach's own and qualified digital replies) newer than
 * both the last time this member opened Coach chat on this device and the
 * member's own latest message. There is no server read state yet, so this
 * device-local count drives the tab badge.
 */
export function unreadCoachMessages(
  messages: ChatMessage[],
  lastSeen: string | null,
): number {
  const time = (value: string | null | undefined) => {
    const t = value ? Date.parse(value) : NaN;
    return Number.isFinite(t) ? t : 0;
  };
  const ownLatest = Math.max(
    0,
    ...messages
      .filter((m) => m.data?.author === "subscriber")
      .map((m) => time(m.created_at)),
  );
  const since = Math.max(time(lastSeen), ownLatest);
  return messages.filter(
    (m) =>
      (m.data?.author === "trainer" ||
        m.data?.author === "digital_qualified") &&
      time(m.created_at) > since,
  ).length;
}

/** The device key for when this member last opened Coach chat. */
export const chatSeenKey = (tenantId: string, userId: string) =>
  `member:chat-seen:${tenantId}:${userId}`;

/** Every address the member navigation offers (for checks and tests). */
export function allMemberDestinations(options: MemberNavOptions) {
  const seen = new Map<string, MemberDestination>();
  for (const d of [
    ...memberTabs(options),
    ...moreGroups(options).flatMap((g) => g.items),
    ...sideNavigation(options).flatMap((g) => g.items),
  ])
    seen.set(d.id, d);
  return [...seen.values()];
}
