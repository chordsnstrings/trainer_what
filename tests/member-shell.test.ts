// The phone-first member shell and its shared controls
// (docs/features/phone-first.md): navigation rules, the rendered frame,
// the primitives' helpers and markup, and the mobile-first stylesheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  activeDestination,
  activeTab,
  allMemberDestinations,
  memberBackTarget,
  memberPageTitle,
  memberTabs,
  moreGroups,
  sideNavigation,
  unreadCoachMessages,
} from "../apps/web/components/member-nav.ts";
import {
  MEMBER_ICONS,
  MemberShell,
  MoreScreen,
} from "../apps/web/components/member-shell.tsx";
import {
  FileInput,
  NumberStepper,
  ResponsiveTable,
  ScrollTabs,
  StickyActionBar,
  keyboardOverlap,
  parseStepperValue,
  scrollEdges,
  stepValue,
} from "../apps/web/components/phone-ui.tsx";

const withNutrition = { programLabel: "Strength with Alex", nutrition: true };
const withoutNutrition = { programLabel: "My program", nutrition: false };
const source = (path: string) =>
  readFile(new URL("../" + path, import.meta.url), "utf8");

test("five tabs: Today, the coach's programme label, chat, Nutrition or Progress, More", () => {
  assert.deepEqual(
    memberTabs(withNutrition).map((t) => [t.label, t.href]),
    [
      ["Today", "/app"],
      ["Strength with Alex", "/app/program"],
      ["Chat", "/app/chat"],
      ["Nutrition", "/app/nutrition"],
      ["More", "/app/more"],
    ],
  );
  const without = memberTabs(withoutNutrition);
  assert.equal(without.length, 5);
  assert.deepEqual(
    [without[3].label, without[3].href],
    ["Progress", "/app/progress"],
  );
});

test("exactly one tab is current, and sub-pages light their parent tab", () => {
  const cases: Array<[string, string, typeof withNutrition]> = [
    ["/app", "today", withNutrition],
    ["/app/program", "program", withNutrition],
    ["/app/timeline", "program", withNutrition],
    ["/app/workouts/abc", "program", withNutrition],
    ["/app/guided/abc", "program", withNutrition],
    ["/app/voice-session/planned/abc", "program", withNutrition],
    ["/app/chat", "chat", withNutrition],
    ["/app/nutrition", "nutrition", withNutrition],
    ["/app/nutrition/log", "nutrition", withNutrition],
    ["/app/progress", "more", withNutrition],
    ["/app/progress", "progress", withoutNutrition],
    ["/app/nutrition", "more", withoutNutrition],
    ["/app/bookings", "more", withNutrition],
    ["/app/more", "more", withNutrition],
    ["/app/profile", "more", withNutrition],
  ];
  for (const [path, tab, options] of cases)
    assert.equal(activeTab(path, options), tab, path);
});

test("the laptop side navigation marks one item: Log a meal never also lights Nutrition", () => {
  assert.equal(activeDestination("/app"), "today");
  assert.equal(activeDestination("/app/nutrition/log"), "meal");
  assert.equal(activeDestination("/app/nutrition"), "nutrition");
  assert.equal(activeDestination("/app/workouts/abc"), "program");
  assert.equal(activeDestination("/app/chat"), "chat");
  assert.equal(activeDestination("/app/membership"), "membership");
  assert.equal(activeDestination("/app/wearables"), "connections");
  const items = sideNavigation(withNutrition).flatMap((g) => g.items);
  for (const path of ["/app/progress", "/app/bookings", "/app/twin"])
    assert.equal(
      items.filter((d) => d.id === activeDestination(path)).length,
      1,
      path,
    );
});

test("every sub-page has an in-app back target; tabs have none", () => {
  for (const tab of memberTabs(withNutrition))
    assert.equal(memberBackTarget(tab.href, withNutrition), null, tab.href);
  assert.equal(
    memberBackTarget("/app/timeline", withNutrition),
    "/app/program",
  );
  assert.equal(
    memberBackTarget("/app/workouts/w1", withNutrition),
    "/app/program",
  );
  assert.equal(
    memberBackTarget("/app/guided/w1", withNutrition),
    "/app/workouts/w1",
  );
  assert.equal(
    memberBackTarget("/app/voice-session/w1", withNutrition),
    "/app/workouts/w1",
  );
  assert.equal(
    memberBackTarget("/app/voice-session/planned/p1", withNutrition),
    "/app/program",
  );
  assert.equal(
    memberBackTarget("/app/nutrition/log", withNutrition),
    "/app/nutrition",
  );
  assert.equal(
    memberBackTarget("/app/nutrition", withoutNutrition),
    "/app/more",
  );
  assert.equal(memberBackTarget("/app/progress", withNutrition), "/app/more");
  assert.equal(memberBackTarget("/app/progress", withoutNutrition), null);
  const tabs = new Set(memberTabs(withNutrition).map((t) => t.href));
  for (const d of allMemberDestinations(withNutrition))
    if (!tabs.has(d.href.split("#")[0]))
      assert.ok(memberBackTarget(d.href, withNutrition), d.href);
});

test("More lists everything that is not a tab, in groups", () => {
  const ids = (options: typeof withNutrition) =>
    moreGroups(options).flatMap((g) => g.items.map((i) => i.id));
  for (const id of [
    "progress",
    "bookings",
    "context",
    "connections",
    "galleries",
    "notifications",
    "support",
    "membership",
    "settings",
    "privacy",
  ])
    assert.ok(ids(withNutrition).includes(id), id);
  assert.ok(ids(withoutNutrition).includes("nutrition"));
  assert.ok(!ids(withoutNutrition).includes("progress"));
  for (const group of moreGroups(withNutrition))
    for (const item of group.items) assert.ok(item.detail, item.id);
});

test("titles are plain words; a workout shows its own name", () => {
  assert.equal(memberPageTitle("/app", withNutrition), null);
  assert.equal(
    memberPageTitle("/app/program", withNutrition),
    "Strength with Alex",
  );
  assert.equal(
    memberPageTitle("/app/workouts/w1", {
      ...withNutrition,
      workoutTitle: "Upper body",
    }),
    "Upper body",
  );
  assert.equal(memberPageTitle("/app/twin", withNutrition), "Coaching context");
  assert.equal(memberPageTitle("/app/more", withNutrition), "More");
});

test("the chat badge counts coach replies after the member last looked or wrote", () => {
  const m = (author: string, at: string) => ({
    created_at: at,
    data: { author },
  });
  const messages = [
    m("trainer", "2026-09-29T08:00:00Z"),
    m("subscriber", "2026-09-29T09:00:00Z"),
    m("digital_qualified", "2026-09-29T10:00:00Z"),
    m("trainer", "2026-09-29T11:00:00Z"),
    m("system", "2026-09-29T12:00:00Z"),
  ];
  assert.equal(unreadCoachMessages(messages, null), 2);
  assert.equal(unreadCoachMessages(messages, "2026-09-29T10:30:00Z"), 1);
  assert.equal(unreadCoachMessages(messages, "2026-09-29T11:30:00Z"), 0);
  assert.equal(unreadCoachMessages([], null), 0);
});

test("each destination has its own icon", () => {
  const icons = Object.values(MEMBER_ICONS);
  assert.equal(new Set(icons).size, icons.length);
});

const shell = (path: string, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(MemberShell, {
      path,
      tenant: { id: "t1", name: "Alex Morgan", theme: {} },
      user: { name: "Sam Taylor", tenantId: "t1", userId: "u1" },
      nav: withNutrition,
      messages: [
        {
          created_at: "2026-09-29T08:00:00Z",
          data: { author: "trainer" },
        },
      ],
      onSignOut: () => {},
      children: createElement("h1", null, "Page"),
      ...extra,
    }),
  );

test("the member frame: a tab bar with one current tab, back on sub-pages, no drawer", () => {
  const today = shell("/app");
  const tabbar = today.slice(today.indexOf('class="member-tabbar"'));
  assert.equal(tabbar.match(/aria-current="page"/g)?.length, 1);
  assert.match(
    tabbar,
    // "is-arriving": the tab moved to plays its microanimation once.
    /<a class="member-tab(?: is-arriving)?" aria-current="page" href="\/app">/,
  );
  assert.doesNotMatch(today, /class="member-back/);
  assert.doesNotMatch(today, /Open navigation|Close navigation|mobile-menu/);
  // Trainer-facing copy never reaches a member.
  assert.doesNotMatch(
    today,
    /BUILT AROUND YOU|Your methods|Your business|Published/,
  );
  // The member's own name, not the coach's twice.
  assert.match(today, /Sam Taylor/);
  // The unread badge is announced with the chat tab.
  assert.match(tabbar, /1 unread message/);
  const workout = shell("/app/workouts/w1", { workoutTitle: "Upper body" });
  assert.match(
    workout,
    /class="member-back(?: is-arriving)?" aria-label="Back" href="\/app\/program"/,
  );
  assert.match(workout, /member-topbar-title">Upper body</);
  const chat = shell("/app/chat");
  assert.doesNotMatch(chat, /unread message/);
  // The side navigation marks one item.
  const side = chat.slice(0, chat.indexOf('class="member-frame"'));
  assert.equal(side.match(/aria-current="page"/g)?.length, 1);
});

test("More renders grouped one-tap links and a sign-out button", () => {
  const html = renderToStaticMarkup(
    createElement(MoreScreen, {
      nav: withNutrition,
      tenantId: "t1",
      userId: "u1",
      onSignOut: () => {},
    }),
  );
  assert.match(html, /<h1[^>]*>More<\/h1>/);
  for (const href of [
    "/app/progress",
    "/app/bookings",
    "/app/twin",
    "/app/wearables",
    "/app/galleries",
    "/app/notifications",
    "/app/support",
    "/app/membership",
    "/app/profile",
  ])
    assert.match(html, new RegExp(`href="${href}"`), href);
  assert.match(html, /Sign out/);
});

test("stepper, keyboard and scroll helpers", () => {
  assert.equal(parseStepperValue("12,5"), 12.5);
  assert.equal(parseStepperValue(" 10 "), 10);
  assert.equal(parseStepperValue("1e3"), null);
  assert.equal(parseStepperValue(""), null);
  assert.equal(stepValue(16, 1, { step: 0.5 }), 16.5);
  assert.equal(stepValue(0, -1, { min: 0 }), 0);
  assert.equal(stepValue(200, 1, { max: 200 }), 200);
  assert.equal(stepValue(null, 1, { min: 0 }), 1);
  assert.equal(stepValue(2.5, 1, { step: 2.5 }), 5);
  assert.equal(
    keyboardOverlap({
      innerHeight: 844,
      visualHeight: 500,
      offsetTop: 0,
      scale: 1,
    }),
    344,
  );
  // Toolbar movement and pinch zoom are not a keyboard.
  assert.equal(
    keyboardOverlap({
      innerHeight: 844,
      visualHeight: 780,
      offsetTop: 0,
      scale: 1,
    }),
    0,
  );
  assert.equal(
    keyboardOverlap({
      innerHeight: 844,
      visualHeight: 400,
      offsetTop: 0,
      scale: 2,
    }),
    0,
  );
  assert.deepEqual(
    scrollEdges({ scrollLeft: 0, scrollWidth: 600, clientWidth: 300 }),
    { start: false, end: true },
  );
  // Right to left: scrollLeft runs negative towards the end.
  assert.deepEqual(
    scrollEdges({ scrollLeft: -300, scrollWidth: 600, clientWidth: 300 }),
    { start: true, end: false },
  );
  assert.deepEqual(
    scrollEdges({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 }),
    { start: false, end: false },
  );
});

test("the shared controls render accessible, phone-sized markup", () => {
  const stepper = renderToStaticMarkup(
    createElement(NumberStepper, {
      label: "Weight (kg)",
      name: "load",
      decimal: true,
      defaultValue: 102.5,
      inputLabel: "Goblet squat set 1 weight",
    }),
  );
  assert.match(stepper, /inputMode="decimal"|inputmode="decimal"/);
  assert.match(stepper, /name="load"/);
  assert.match(stepper, /value="102.5"/);
  assert.match(stepper, /aria-label="Less Goblet squat set 1 weight"/);
  assert.match(stepper, /aria-label="More Goblet squat set 1 weight"/);
  const reps = renderToStaticMarkup(
    createElement(NumberStepper, {
      label: "Reps",
      name: "reps",
      defaultValue: 10,
    }),
  );
  assert.match(reps, /inputMode="numeric"|inputmode="numeric"/);

  const file = renderToStaticMarkup(
    createElement(FileInput, {
      label: "Photos or PDFs",
      buttonLabel: "Attach photos or PDFs",
      disabled: true,
      disabledReason: "Tick the permission box above to attach files.",
      onFiles: () => {},
    }),
  );
  assert.match(file, /type="file"/);
  assert.match(file, /aria-labelledby=/);
  assert.match(file, /Attach photos or PDFs/);
  assert.match(file, /class="control-reason">Tick the permission box/);

  const table = renderToStaticMarkup(
    createElement(ResponsiveTable, {
      label: "Progress by exercise",
      columns: [
        { key: "exercise", label: "Exercise" },
        { key: "sets", label: "Sets", numeric: true },
      ],
      rows: [{ key: "a", cells: { exercise: "Goblet squat", sets: 3 } }],
    }),
  );
  assert.match(table, /role="region" aria-label="Progress by exercise"/);
  assert.match(table, /data-label="Sets"/);
  assert.match(table, /scope="row"/);

  const tabs = renderToStaticMarkup(
    createElement(ScrollTabs, {
      label: "Your nutrition",
      idPrefix: "n",
      selected: "b",
      onSelect: () => {},
      tabs: [
        { id: "a", label: "Meal plan" },
        { id: "b", label: "Weekly groceries" },
      ],
    }),
  );
  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /id="n-tab-b"[^>]*aria-selected="true"/);
  assert.match(
    tabs,
    /aria-selected="false"[^>]*tabindex="-1"|tabindex="-1"[^>]*aria-selected="false"/i,
  );

  const bar = renderToStaticMarkup(
    createElement(StickyActionBar, {
      label: "Workout actions",
      note: "Next: set 2",
      children: createElement("button", { className: "button" }, "Log set 2"),
    }),
  );
  assert.match(bar, /role="region" aria-label="Workout actions"/);
});

test("the stylesheet is phone first and safe-area aware", async () => {
  const css = await source("apps/web/app/phone-first.css");
  // Larger screens are added with min-width; nothing patches a desktop
  // layout with max-width.
  assert.doesNotMatch(css, /@media[^{]*max-width/);
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.match(css, /--member-bottom-inset:/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /overscroll-behavior-y: contain/);
  assert.match(css, /prefers-reduced-motion/);
  // Member fields are 16 px (no iOS zoom).
  assert.match(
    css,
    /\.member-shell select,\s*\.member-shell textarea \{\s*font-size: 16px;/,
  );
  // The tab bar is at least 56 px tall.
  const tab = css.match(/\.member-tab \{[^}]*min-block-size: (\d+)px/);
  assert.ok(tab && Number(tab[1]) >= 56);
  const layout = await source("apps/web/app/layout.tsx");
  assert.match(layout, /import "\.\/phone-first\.css";/);
});

test("the member app is installed-app ready and wired into the workspace", async () => {
  const page = await source("apps/web/app/[[...path]]/page.tsx");
  // The member app also names its colour schemes (docs/features/dark-mode.md).
  assert.match(page, /path\[0\] === "app"\s*\?\s*\{ viewportFit: "cover"/);
  const workspace = await source("apps/web/components/workspace.tsx");
  assert.match(workspace, /<MemberShell/);
  assert.match(workspace, /path === "\/app\/more" && subscriber/);
  // A member keeps the frame while a page refreshes.
  assert.match(workspace, /loading && state\.user\.role !== "subscriber"/);
  const api = await source("apps/api/src/app.ts");
  assert.match(
    api,
    /memberApp: \{ nutrition: await hasNutritionAccess\(tx, a\.userId\) \}/,
  );
  const shellSource = await source("apps/web/components/member-shell.tsx");
  // Links to other sites leave the installed app.
  assert.match(shellSource, /display-mode: standalone/);
  assert.match(
    shellSource,
    /window\.open\(url\.href, "_blank", "noopener,noreferrer"\)/,
  );
});
