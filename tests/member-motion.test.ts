// Microanimations on subscriber surfaces (docs/features/phone-first.md,
// "Motion"): the helpers in components/motion.ts, and the stylesheet's
// promise that with reduced motion the member app is the same, only still.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EASE,
  FIXED_UI,
  MOTION,
  arrivalKeyframes,
  arrivalTargets,
  playArrival,
  playMotion,
  prefersReducedMotion,
  stagger,
  tickKeyframes,
} from "../apps/web/components/motion.ts";
import { BottomSheet } from "../apps/web/components/phone-ui.tsx";
import { shellChanges } from "../apps/web/components/member-shell.tsx";

const source = (path: string) =>
  readFile(new URL("../" + path, import.meta.url), "utf8");

/**
 * Splits a stylesheet into what lies outside the
 * `@media (... prefers-reduced-motion: no-preference ...)` blocks (`still`)
 * and what lies inside them (`moving`).
 */
function splitMotionBlocks(css: string) {
  let out = "",
    inside = "",
    i = 0;
  const opener = /@media[^{]*prefers-reduced-motion:\s*no-preference[^{]*\{/g;
  for (let m = opener.exec(css); m; m = opener.exec(css)) {
    out += css.slice(i, m.index);
    let depth = 1,
      j = m.index + m[0].length;
    while (depth && j < css.length) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    inside += css.slice(m.index, j);
    i = j;
    opener.lastIndex = j;
  }
  return { still: out + css.slice(i), moving: inside };
}

test("motion is small and quick: presses under 100 ms, arrivals under 300 ms", () => {
  assert.ok(MOTION.press < 100);
  assert.ok(MOTION.fast <= 150);
  assert.ok(MOTION.enter <= 300 && MOTION.slide <= 300);
  // Leaving is quicker than arriving.
  assert.ok(MOTION.exit < MOTION.slide);
  // Five staggered blocks all start within 150 ms.
  assert.equal(stagger(0), 0);
  assert.equal(stagger(2), 2 * MOTION.stagger);
  assert.equal(stagger(50), stagger(5));
  assert.ok(stagger(50) <= 150);
  assert.equal(stagger(-3), 0);
  for (const curve of Object.values(EASE))
    assert.match(curve, /^cubic-bezier\(/);
});

test("the CSS tokens match the motion helpers", async () => {
  const css = await source("apps/web/app/phone-first.css");
  const token = (name: string) =>
    css.match(new RegExp(`--${name}: ([^;]+);`))?.[1].trim();
  assert.equal(token("motion-press"), `${MOTION.press}ms`);
  assert.equal(token("motion-fast"), `${MOTION.fast}ms`);
  assert.equal(token("motion-enter"), `${MOTION.enter}ms`);
  assert.equal(token("motion-slide"), `${MOTION.slide}ms`);
  assert.equal(token("motion-exit"), `${MOTION.exit}ms`);
  assert.equal(token("ease-out"), EASE.out);
  assert.equal(token("ease-in"), EASE.in);
  assert.equal(token("ease-spring"), EASE.spring);
});

test("keyframes: arrivals rise and fade; a value ticks the way it moved", () => {
  assert.deepEqual(arrivalKeyframes(8), [
    { opacity: 0, transform: "translateY(8px)" },
    { opacity: 1, transform: "none" },
  ]);
  assert.equal(arrivalKeyframes(4)[0].transform, "translateY(4px)");
  assert.equal(tickKeyframes(1)[0].transform, "translateY(6px)");
  assert.equal(tickKeyframes(-1)[0].transform, "translateY(-6px)");
  assert.equal(tickKeyframes(1).at(-1)?.transform, "none");
});

test("without a browser, or with reduced motion, nothing plays", () => {
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
  assert.equal(playMotion(null, [{ opacity: 0 }], { duration: 10 }), null);
  playArrival(el);
  assert.equal(played, 0);

  const original = (globalThis as any).window;
  try {
    for (const reduce of [true, false]) {
      (globalThis as any).window = {
        matchMedia: (q: string) => ({
          matches: q.includes("reduce") ? reduce : false,
        }),
      };
      assert.equal(prefersReducedMotion(), reduce);
      const result = playMotion(el, [{ opacity: 0 }], { duration: 10 });
      assert.equal(result === null, reduce);
    }
    assert.equal(played, 1);
  } finally {
    (globalThis as any).window = original;
  }
});

/** A tiny element stand-in: class names, attributes and children. */
type Fake = {
  name: string;
  classes: string[];
  attrs: string[];
  children: Fake[];
  matches: (selector: string) => boolean;
  querySelector: (selector: string) => Fake | null;
};
function fake(name: string, classes: string[] = [], children: Fake[] = [], attrs: string[] = []): Fake {
  const node: Fake = {
    name,
    classes,
    attrs,
    children,
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

test("a page arrives block by block, and nothing fixed ever moves with a block", () => {
  const heading = fake("div", ["page-heading"]);
  const card = fake("section", ["card"]);
  const bar = fake("div", ["sticky-action-bar"]);
  const sheet = fake("dialog", ["bottom-sheet"]);
  // A fragment page: heading, card, the bar and a sheet side by side.
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
  // A page wrapped in one block that holds the bar: its children arrive
  // instead, and the bar keeps its own entrance.
  const panel = fake("section", ["card"]);
  const wrapped = fake("main", [], [
    fake("div", ["stack"], [heading, panel, bar]),
  ]);
  const targets = arrivalTargets(wrapped as unknown as Element) as unknown as Fake[];
  assert.deepEqual(targets, [heading, panel]);
  // Another screen can mark its own fixed piece.
  const toast = fake("div", ["toast"], [], ["data-fixed-ui"]);
  assert.deepEqual(
    arrivalTargets(fake("main", [], [card, toast]) as unknown as Element),
    [card],
  );
  assert.match(FIXED_UI, /\.sticky-action-bar/);
  assert.match(FIXED_UI, /\[data-fixed-ui\]/);
});

test("with reduced motion the member app is the same, only still", async () => {
  const css = await source("apps/web/app/phone-first.css");
  const { still, moving } = splitMotionBlocks(css);
  // Outside the no-preference blocks: no animation and no transition at all.
  assert.doesNotMatch(still, /(^|[;{\s])animation(-name)?\s*:/m);
  assert.doesNotMatch(still, /(^|[;{\s])transition(-[a-z]+)?\s*:/m);
  // Inside them: the shell and the shared controls are animated.
  for (const selector of [
    ".member-tab.is-arriving[aria-current=\"page\"] .member-tab-icon::before",
    ".member-badge.is-new",
    ".member-topbar-title",
    ".sticky-action-bar",
    ".bottom-sheet[open]",
    ".bottom-sheet[open][data-closing]",
    ".scroll-tabs [role=\"tab\"]::after",
    ".member-shell .set-row.just-logged::before",
    ".more-link:active .more-chevron",
    ".stepper-button:active:not(:disabled)",
  ])
    assert.ok(moving.includes(selector), selector);
  // Every animation names keyframes that exist.
  const defined = new Set(
    [...css.matchAll(/@keyframes ([a-z-]+)/g)].map((m) => m[1]),
  );
  const used = [...css.matchAll(/animation(?:-name)?:\s*([^;]+);/g)].flatMap(
    (m) => m[1].match(/member-[a-z-]+/g) ?? [],
  );
  assert.ok(used.length > 10);
  for (const name of used) assert.ok(defined.has(name), `@keyframes ${name}`);
  // Only transform and opacity move (plus colours cross-fading and the
  // refresh bar's background position): nothing reflows the page.
  for (const m of css.matchAll(/@keyframes ([a-z-]+) \{([\s\S]*?)\n\}/g)) {
    const props = [...m[2].matchAll(/([a-z-]+):/g)].map((p) => p[1]);
    for (const prop of props)
      assert.ok(
        ["opacity", "transform", "background-position-x"].includes(prop),
        `${m[1]} animates ${prop}`,
      );
  }
  // Touch devices never keep a hover lift after a tap.
  assert.match(css, /@media \(hover: none\)[\s\S]*?\.button:hover:not\(:disabled\) \{\s*transform: none;/);
});

test("the shell animates only what changed since the previous page", () => {
  const before = { tab: "today", destination: "today", unread: 1, back: false };
  // Today to the programme: a new tab; tabs have no back button.
  assert.deepEqual(
    shellChanges(before, { tab: "program", destination: "program", unread: 1, back: false }),
    { tab: true, destination: true, unread: false, back: false },
  );
  // Programme to a workout: same tab (no pill replay), a back button arrives.
  assert.deepEqual(
    shellChanges(
      { tab: "program", destination: "program", unread: 1, back: false },
      { tab: "program", destination: null, unread: 1, back: true },
    ),
    { tab: false, destination: true, unread: false, back: true },
  );
  // A new coach reply pops the badge; reading them (0) does not.
  assert.equal(shellChanges(before, { ...before, unread: 2 }).unread, true);
  assert.equal(shellChanges(before, { ...before, unread: 0 }).unread, false);
  // Sub-page to sub-page: the back button is already there.
  assert.equal(
    shellChanges({ ...before, back: true }, { ...before, back: true }).back,
    false,
  );
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
  // It slides away before closing, and closes at once with reduced motion.
  assert.match(ui, /el\.dataset\.closing = ""/);
  assert.match(ui, /if \(prefersReducedMotion\(\)\) return finish\(\);/);
});

test("the shell, the controls and the workout screen play their microanimations", async () => {
  const shell = await source("apps/web/components/member-shell.tsx");
  assert.match(shell, /playArrival\(main\.current\);\s*\}, \[path\]\);/);
  assert.match(shell, /"member-badge" \+ \(changed\.unread \? " is-new" : ""\)/);
  assert.match(shell, /key=\{unread\}/);
  assert.match(shell, /className="member-topbar-title" key=\{title\}/);
  const ui = await source("apps/web/components/phone-ui.tsx");
  assert.match(ui, /playMotion\(input\.current, tickKeyframes\(direction\)/);
  assert.match(ui, /playArrival\(document\.getElementById\(tabPanelId\(idPrefix\)\), 6\)/);
  const workspace = await source("apps/web/components/workspace.tsx");
  assert.match(workspace, /setJustLogged\(row\.logicalKey\);\s*requestAnimationFrame\(revealNextSet\);/);
  assert.match(workspace, /" just-logged"/);
  assert.match(workspace, /behavior: prefersReducedMotion\(\) \? "auto" : "smooth"/);
});
