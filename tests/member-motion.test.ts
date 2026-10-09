// Microanimations on subscriber surfaces (docs/features/motion.md): the
// helpers in components/motion.ts, the tokens they share with
// app/motion.css, screen-transition directions, the "Reduce motion" choice
// and how the shell, the shared controls and the screens use them. The
// stylesheet's own rules are in tests/motion-css.test.ts; the browser budget
// is scripts/motion-check.mjs (npm run test:motion).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DISTANCE,
  EASE,
  FIXED_UI,
  MOTION,
  MOTION_LIMITS,
  REDUCE_MOTION_ATTRIBUTE,
  arrivalKeyframes,
  arrivalTargets,
  countUp,
  firstView,
  haptic,
  meterKeyframes,
  playArrival,
  playMotion,
  prefersReducedMotion,
  resetFirstViews,
  ringKeyframes,
  rollOutKeyframes,
  shakeKeyframes,
  stagger,
  tickKeyframes,
} from "../apps/web/components/motion.ts";
import {
  BottomSheet,
  CountUp,
  DrawnCheck,
  Meter,
  ProgressRing,
  Skeleton,
  Toast,
} from "../apps/web/components/phone-ui.tsx";
import {
  screenKey,
  shellChanges,
} from "../apps/web/components/member-shell.tsx";
import { navDirection } from "../apps/web/components/member-nav.ts";
import {
  MEMBER_MOTION_COOKIE,
  motionCookie,
  motionFromCookieHeader,
  parseMotionChoice,
} from "../apps/web/color-scheme.ts";
import { CATALOG } from "../apps/web/lib/i18n/catalog.ts";

const prefs = CATALOG.prefs;

const source = (path: string) =>
  readFile(new URL("../" + path, import.meta.url), "utf8");

/** Runs `fn` with a stand-in window (and optionally <html> attributes). */
function withBrowser(
  { reduce = false, attribute = null as string | null, vibrate = null as null | ((n: number) => void) },
  fn: () => void,
) {
  const g = globalThis as any;
  const saved = {
    window: g.window,
    document: g.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  g.window = {
    matchMedia: (q: string) => ({ matches: q.includes("reduce") ? reduce : false }),
  };
  g.document = {
    documentElement: {
      getAttribute: (name: string) =>
        name === REDUCE_MOTION_ATTRIBUTE ? attribute : null,
    },
  };
  if (vibrate)
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate },
      configurable: true,
    });
  try {
    fn();
  } finally {
    g.window = saved.window;
    g.document = saved.document;
    if (saved.navigator)
      Object.defineProperty(globalThis, "navigator", saved.navigator);
  }
}

test("tokens: five durations, four curves, three distances, a 30 ms stagger for six", () => {
  assert.deepEqual(
    [MOTION.instant, MOTION.fast, MOTION.base, MOTION.slow, MOTION.emphasis],
    [80, 140, 200, 280, 420],
  );
  // Feedback within 100 ms; celebration only up to 420 ms; progress 700 ms.
  assert.ok(MOTION.instant < 100);
  assert.equal(MOTION_LIMITS.any, MOTION.emphasis);
  assert.ok(MOTION.progress <= MOTION_LIMITS.progress);
  assert.deepEqual(EASE, {
    out: "cubic-bezier(0.2, 0, 0, 1)",
    in: "cubic-bezier(0.4, 0, 1, 1)",
    inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
    spring: "cubic-bezier(0.34, 1.4, 0.64, 1)",
  });
  assert.deepEqual(DISTANCE, { xs: 4, sm: 8, md: 16 });
  assert.equal(MOTION.stagger, 30);
  assert.equal(stagger(0), 0);
  assert.equal(stagger(2), 60);
  // The sixth and every later one share the last delay: 150 ms at most.
  assert.equal(stagger(5), 150);
  assert.equal(stagger(50), stagger(5));
  assert.equal(stagger(-3), 0);
  // Arrivals with their stagger stay inside the budget.
  assert.ok(stagger(99) + MOTION.base <= MOTION_LIMITS.any);
});

test("the CSS tokens match the motion helpers", async () => {
  const css = await source("apps/web/app/motion.css");
  const token = (name: string) =>
    css.match(new RegExp(`--${name}: ([^;]+);`))?.[1].trim();
  for (const [name, value] of [
    ["motion-instant", MOTION.instant],
    ["motion-fast", MOTION.fast],
    ["motion-base", MOTION.base],
    ["motion-slow", MOTION.slow],
    ["motion-emphasis", MOTION.emphasis],
    ["motion-progress", MOTION.progress],
    ["motion-loop-typing", MOTION.loopTyping],
    ["motion-loop-shimmer", MOTION.loopShimmer],
    ["motion-loop-breathe", MOTION.loopBreathe],
    ["motion-stagger", MOTION.stagger],
  ] as const)
    assert.equal(token(name), `${value}ms`, name);
  assert.equal(token("ease-out"), "cubic-bezier(0.2, 0, 0, 1)");
  assert.equal(token("ease-in"), "cubic-bezier(0.4, 0, 1, 1)");
  assert.equal(token("ease-in-out"), EASE.inOut);
  assert.equal(token("ease-spring"), EASE.spring);
  assert.equal(token("motion-distance-xs"), "4px");
  assert.equal(token("motion-distance-sm"), "8px");
  assert.equal(token("motion-distance-md"), "16px");
  // The old tokens are gone everywhere.
  assert.doesNotMatch(
    css + (await source("apps/web/app/phone-first.css")),
    /--motion-(press|enter|slide|exit)\b/,
  );
});

test("keyframes: arrivals rise, numbers roll, shakes stay small, bars and rings grow", () => {
  assert.deepEqual(arrivalKeyframes(), [
    { opacity: 0, transform: "translateY(8px)" },
    { opacity: 1, transform: "none" },
  ]);
  // More: the new number comes up from below, the old one leaves upward.
  assert.equal(tickKeyframes(1)[0].transform, "translateY(8px)");
  assert.equal(rollOutKeyframes(1).at(-1)?.transform, "translateY(-8px)");
  // Less: the other way round.
  assert.equal(tickKeyframes(-1)[0].transform, "translateY(-8px)");
  assert.equal(rollOutKeyframes(-1).at(-1)?.transform, "translateY(8px)");
  // Three 4 px shakes, mirrored right to left, back to rest.
  const shake = shakeKeyframes(1).map((k) => k.transform);
  assert.equal(shake.filter((t) => t === "translateX(4px)").length, 3);
  assert.equal(shake.filter((t) => t === "translateX(-4px)").length, 3);
  assert.equal(shake.at(-1), "translateX(0px)");
  const px = (sign: 1 | -1) =>
    shakeKeyframes(sign).map((k) => parseFloat(String(k.transform).slice(11)));
  assert.deepEqual(px(-1), px(1).map((n) => (n === 0 ? 0 : -n)));
  // A bar grows from zero, or from the value it showed last.
  assert.deepEqual(meterKeyframes(0, 0.5), [
    { transform: "scaleX(0)" },
    { transform: "none" },
  ]);
  assert.equal(meterKeyframes(0.25, 0.5)[0].transform, "scaleX(0.5)");
  assert.equal(meterKeyframes(0.5, 0)[0].transform, "scaleX(0)");
  // A ring fills by its stroke (pathLength 1).
  assert.deepEqual(ringKeyframes(0, 0.75), [
    { strokeDashoffset: "1" },
    { strokeDashoffset: "0.25" },
  ]);
});

test("reduced motion: the device setting, the member's own choice, or no browser", () => {
  // Node has no window: treated as reduced motion.
  assert.equal(prefersReducedMotion(), true);
  let played = 0;
  const el = {
    animate: () => {
      played++;
      return {} as Animation;
    },
  } as unknown as Element;
  assert.equal(playMotion(el, [{ opacity: 0 }], { duration: 10 }), null);
  playArrival(el);
  assert.equal(played, 0);
  withBrowser({ reduce: true }, () => {
    assert.equal(prefersReducedMotion(), true);
    assert.equal(playMotion(el, [{ opacity: 0 }], { duration: 10 }), null);
  });
  withBrowser({ attribute: "on" }, () => {
    // "Reduce motion: On" in Display preferences, on <html>.
    assert.equal(prefersReducedMotion(), true);
    assert.equal(playMotion(el, [{ opacity: 0 }], { duration: 10 }), null);
  });
  withBrowser({}, () => {
    assert.equal(prefersReducedMotion(), false);
    assert.notEqual(playMotion(el, [{ opacity: 0 }], { duration: 10 }), null);
    assert.equal(playMotion(null, [{ opacity: 0 }], { duration: 10 }), null);
  });
  assert.equal(played, 1);
});

test("haptics: a 10 ms tick where supported, never with reduced motion", () => {
  const ticks: number[] = [];
  withBrowser({ vibrate: (n) => ticks.push(n) }, () => haptic());
  withBrowser({ reduce: true, vibrate: (n) => ticks.push(n) }, () => haptic());
  withBrowser({ attribute: "on", vibrate: (n) => ticks.push(n) }, () => haptic());
  assert.deepEqual(ticks, [10]);
});

test("numbers show their final value at once with reduced motion; entries play on first view only", () => {
  const node = { firstChild: null, textContent: "" } as unknown as HTMLElement;
  countUp(node, 0, 12, (v) => `${v} days`);
  assert.equal(node.textContent, "12 days");
  resetFirstViews();
  assert.equal(firstView("screen:/app"), true);
  assert.equal(firstView("screen:/app"), false);
  assert.equal(firstView("screen:/app/chat"), true);
  // One key per screen, ids folded.
  assert.equal(
    screenKey("/app/workouts/0b7c2c1e-58a4-4c43-9b1f-7a8e2b6d9c10?x=1"),
    "/app/workouts/:id",
  );
  assert.equal(screenKey("/app/more/"), "/app/more");
});

/** A tiny element stand-in: class names, attributes and children. */
type Fake = {
  name: string;
  classes: string[];
  attrs: string[];
  children: Fake[];
  matches: (selector: string) => boolean;
  hasAttribute: (name: string) => boolean;
  querySelector: (selector: string) => Fake | null;
};
function fake(name: string, classes: string[] = [], children: Fake[] = [], attrs: string[] = []): Fake {
  const node: Fake = {
    name,
    classes,
    attrs,
    children,
    hasAttribute: (attr) => attrs.includes(attr),
    matches: (selector) =>
      selector.split(",").some((part) => {
        const s = part.trim();
        if (s.startsWith(".")) return classes.includes(s.slice(1));
        if (s.startsWith("[")) return attrs.includes(s.slice(1, -1));
        return s === name;
      }),
    querySelector: (selector) => {
      for (const child of children) {
        if (child.matches(selector)) return child;
        const deeper = child.querySelector(selector);
        if (deeper) return deeper;
      }
      return null;
    },
  };
  return node;
}

test("a first view arrives block by block, and nothing fixed ever moves with a block", () => {
  const heading = fake("div", ["page-heading"]);
  const card = fake("section", ["card"]);
  const bar = fake("div", ["sticky-action-bar"]);
  const sheet = fake("dialog", ["bottom-sheet"]);
  const main = fake("main", [], [
    fake("a", ["skip-link"]),
    heading,
    card,
    bar,
    sheet,
    fake("div", [], [], ["hidden"]),
  ]);
  assert.deepEqual(
    arrivalTargets(main as unknown as Element).map((n) => (n as unknown as Fake).classes[0]),
    ["page-heading", "card"],
  );
  const panel = fake("section", ["card"]);
  const wrapped = fake("main", [], [fake("div", ["stack"], [heading, panel, bar])]);
  assert.deepEqual(arrivalTargets(wrapped as unknown as Element), [heading, panel]);
  const toast = fake("div", ["member-toast"], [], ["data-fixed-ui"]);
  assert.deepEqual(
    arrivalTargets(fake("main", [], [card, toast]) as unknown as Element),
    [card],
  );
  // A screen wrapper marked data-stagger (Today, the programme, chat,
  // settings) lets its blocks arrive one by one.
  const focus = fake("section", ["today-focus"]);
  const status = fake("ul", ["today-status"]);
  assert.deepEqual(
    arrivalTargets(
      fake("main", [], [fake("div", ["member-today"], [heading, focus, status], ["data-stagger"])]) as unknown as Element,
    ),
    [heading, focus, status],
  );
  assert.match(FIXED_UI, /\.sticky-action-bar/);
  assert.match(FIXED_UI, /\[data-fixed-ui\]/);
});

test("screen transitions: forward into a sub-page, back up its chain, a crossfade between tabs", () => {
  const nav = { programLabel: "Strength with Alex", nutrition: true } as any;
  // First page shown: nothing to animate from.
  assert.equal(navDirection(null, "/app", nav), "none");
  assert.equal(navDirection("/app", "/app", nav), "none");
  // Tabs crossfade.
  assert.equal(navDirection("/app", "/app/program", nav), "tab");
  assert.equal(navDirection("/app/program", "/app/chat", nav), "tab");
  assert.equal(navDirection("/app/chat", "/app/more", nav), "tab");
  // More > Bookings opens forward; its back button goes back.
  assert.equal(navDirection("/app/more", "/app/bookings", nav), "forward");
  assert.equal(navDirection("/app/bookings", "/app/more", nav), "back");
  // Deeper: programme > workout > guided session, and back again.
  assert.equal(navDirection("/app/program", "/app/workouts/w1", nav), "forward");
  assert.equal(navDirection("/app/workouts/w1", "/app/guided/w1", nav), "forward");
  assert.equal(navDirection("/app/guided/w1", "/app/workouts/w1", nav), "back");
  assert.equal(navDirection("/app/workouts/w1", "/app/program", nav), "back");
  // A link on Today into a sub-page moves forward.
  assert.equal(navDirection("/app", "/app/notifications", nav), "forward");
  // A tab tapped from a sub-page of another tab crossfades.
  assert.equal(navDirection("/app/bookings", "/app", nav), "tab");
  assert.equal(navDirection("/app/nutrition/log", "/app/chat", nav), "tab");
  // Nutrition's own sub-page returns to it.
  assert.equal(navDirection("/app/nutrition/log", "/app/nutrition", nav), "back");
});

test("the shell animates only what changed since the previous page", () => {
  const before = { tab: "today", destination: "today", unread: 1, back: false };
  assert.deepEqual(
    shellChanges(before, { tab: "program", destination: "program", unread: 1, back: false }),
    { tab: true, destination: true, unread: false, back: false },
  );
  assert.deepEqual(
    shellChanges(
      { tab: "program", destination: "program", unread: 1, back: false },
      { tab: "program", destination: null, unread: 1, back: true },
    ),
    { tab: false, destination: true, unread: false, back: true },
  );
  assert.equal(shellChanges(before, { ...before, unread: 2 }).unread, true);
  assert.equal(shellChanges(before, { ...before, unread: 0 }).unread, false);
  assert.equal(
    shellChanges({ ...before, back: true }, { ...before, back: true }).back,
    false,
  );
});

test("the Reduce motion choice: two values, a device cookie, en and ar text", () => {
  assert.equal(MEMBER_MOTION_COOKIE, "trainer_member_motion");
  assert.equal(parseMotionChoice("reduce"), "reduce");
  assert.equal(parseMotionChoice("system"), "system");
  for (const bad of ["on", "", null, "REDUCE", 1]) assert.equal(parseMotionChoice(bad), null);
  assert.match(motionCookie("reduce", true), /^trainer_member_motion=reduce; Path=\/; Max-Age=\d+; SameSite=Lax; Secure$/);
  assert.equal(motionFromCookieHeader("a=1; trainer_member_motion=reduce"), "reduce");
  assert.equal(motionFromCookieHeader("trainer_member_motion=wobble"), null);
  assert.equal(motionFromCookieHeader(null), null);
  for (const key of ["motion", "motionSystem", "motionSystemDetail", "motionReduce", "motionReduceDetail", "motionSaved"] as const) {
    assert.ok(prefs.en[key], `en ${key}`);
    assert.ok(prefs.ar[key], `ar ${key}`);
    assert.notEqual(prefs.en[key], prefs.ar[key], key);
  }
  assert.equal(prefs.en.motionReduce, "Reduce motion");
});

test("the shared motion pieces render accessible markup", () => {
  const skeleton = renderToStaticMarkup(
    createElement(Skeleton, { label: "Loading your day", lines: 3, block: true }),
  );
  assert.match(skeleton, /role="status" aria-busy="true"/);
  assert.match(skeleton, /<span class="sr-only">Loading your day<\/span>/);
  assert.equal(skeleton.match(/skeleton-line/g)?.length, 4);
  assert.doesNotMatch(skeleton, /Loading…/);
  const toast = renderToStaticMarkup(
    createElement(Toast, { onDone: () => {}, children: "Saved" }),
  );
  assert.match(toast, /class="member-toast" role="status" data-fixed-ui="true"/);
  assert.match(toast, /Saved/);
  const check = renderToStaticMarkup(createElement(DrawnCheck, { draw: true, emphasis: true }));
  assert.match(check, /class="drawn-check is-drawing is-emphasis"/);
  assert.match(check, /aria-hidden="true"/);
  assert.match(check, /pathLength="1"/);
  const ring = renderToStaticMarkup(createElement(ProgressRing, { value: 0.25, ticking: true }));
  assert.match(ring, /class="progress-ring-value is-ticking"[^>]*pathLength="1" style="stroke-dashoffset:0.75"/);
  // Numbers and bars carry their final value in the page.
  assert.equal(
    renderToStaticMarkup(createElement(CountUp, { value: 7, format: (v: number) => `${v} days` })),
    "<span>7 days</span>",
  );
  const meter = renderToStaticMarkup(
    createElement(Meter, { value: 1500, max: 2000, label: "Calories" }),
  );
  assert.match(meter, /role="progressbar" aria-label="Calories" aria-valuemin="0" aria-valuemax="2000" aria-valuenow="1500"/);
  assert.match(meter, /class="motion-meter-fill" style="inline-size:75%"/);
});

test("the bottom sheet shows a grab handle and closes by button, Escape or backdrop", async () => {
  const markup = renderToStaticMarkup(
    createElement(BottomSheet, {
      open: false,
      onClose: () => {},
      title: "Report pain or a problem",
      children: createElement("p", null, "Body"),
    }),
  );
  assert.match(markup, /class="bottom-sheet-handle" aria-hidden="true"/);
  assert.match(markup, /aria-label="Close"/);
  const ui = await source("apps/web/components/phone-ui.tsx");
  // The modal closes at once (the page works again), then the sheet slides
  // away as a non-modal dialog (faster than it came) and closes; with
  // reduced motion it closes at once.
  assert.match(ui, /shut\(\);\s*el\.dataset\.closing = "";\s*el\.show\(\);/);
  assert.match(ui, /closing\.current = window\.setTimeout\(\(\) => \{[\s\S]*?shut\(\);\s*\}, MOTION\.base \+ 40\)/);
  assert.match(ui, /if \(prefersReducedMotion\(\) \|\| typeof el\.show !== "function"\) \{\s*shut\(\);/);
});

test("the shell, the controls and the screens play their microanimations", async () => {
  const shell = await source("apps/web/components/member-shell.tsx");
  // Screen transitions: the direction goes on <html data-vt> in the commit;
  // the boundary is the page route's, around the workspace.
  assert.match(shell, /useLayoutEffect\(\(\) => \{\s*document\.documentElement\.dataset\.vt = "nav-" \+ direction;/);
  assert.match(shell, /<ViewTransition enter=\{motion\} exit=\{motion\} update="none" default="none">/);
  const page = await source("apps/web/app/[[...path]]/page.tsx");
  assert.match(page, /if \(path\[0\] === "app" \|\| path\[0\] === "trainer" && path\[1\] === "preview" && path\[2\] === "app"\)\s*return \(\s*<MemberPageTransition>\s*<Workspace/);
  // First views settle in; without View Transitions a new page fades in.
  // First view of a screen settles in, but never on top of a navigation's
  // View Transition (no second arrival after the crossfade).
  assert.match(shell, /const first = firstView\("screen:" \+ screenKey\(path\)\);/);
  assert.match(shell, /if \(first && !navigating\) playArrival\(el\);/);
  assert.match(shell, /!supportsViewTransitions\(\)/);
  // The tab pill slides across from the tab you left; badges pop.
  assert.match(shell, /pseudoElement: "::before"/);
  assert.match(shell, /data-tab=\{item\.id\}/);
  assert.match(shell, /"member-badge" \+ \(changed\.unread \? " is-new" : ""\)/);
  assert.match(shell, /useInvalidShake\(\);/);
  assert.match(shell, /t\("backOnline"\)/);
  const ui = await source("apps/web/components/phone-ui.tsx");
  assert.match(ui, /playMotion\(leaving, rollOutKeyframes\(direction\)/);
  assert.match(ui, /playMotion\(input\.current, tickKeyframes\(direction\)/);
  const workspace = await source("apps/web/components/workspace.tsx");
  const training = await source("apps/web/components/workspace-training.tsx");
  assert.match(training, /setJustLogged\(row\.logicalKey\);\s*setOpenSet\(null\);\s*haptic\(\);\s*requestAnimationFrame\(revealNextSet\);/);
  assert.match(training, /const finish = \(\) => \{\s*haptic\(\);/);
  assert.match(training, /<WorkoutComplete/);
  assert.match(training, /<ProgressRing\s+value=\{restTotal \? restLeft \/ restTotal : 0\}/);
  assert.match(training, /<DrawnCheck \/>/);
  // Members get a toast for "Saved"; trainers keep their notice.
  assert.match(workspace, /success && !subscriber &&/);
  assert.match(workspace, /<Toast key=\{success\} onDone=\{\(\) => setSuccess\(""\)\}>/);
  const chat = await source("apps/web/components/training-workspace.tsx");
  assert.match(chat, /className="chat-typing" role="status"/);
  assert.match(chat, /chat-message is-new is-sending/);
  assert.match(chat, /className=\{sub \? "button chat-send" : "button"\}/);
  const consent = await source("apps/web/components/acquisition.tsx");
  assert.match(consent, /\(bar \|\| leaving\) &&/);
  assert.match(consent, /inert=\{leaving \|\| undefined\}/);
  const appearance = await source("apps/web/components/appearance.tsx");
  assert.match(appearance, /withViewTransition\("theme", \(\) => rememberColorScheme\(next\)\)/);
  assert.match(appearance, /<MotionPreference \/>/);
  const layout = await source("apps/web/app/layout.tsx");
  assert.match(layout, /import "\.\/motion\.css";/);
  assert.match(layout, /data-reduce-motion=\{reduceMotion \? "on" : undefined\}/);
});
