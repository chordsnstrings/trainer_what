// Motion hygiene for the public marketing site (apps/web/app/marketing.css
// and components/marketing/motion.tsx), 29 September 2026 microanimation
// pass. It reads the stylesheet as rules with their at-rule context and
// fails when:
// - a transition or keyframe moves anything but transform, opacity, SVG
//   stroke-dashoffset or a disclosure's grid rows (never width, height,
//   top, left, margin and the like), or a transition names no property;
// - a duration or easing is not a --mk-* motion token (delays are
//   choreography times and are exempt, and so is the scroll-driven header
//   shadow, which has no duration);
// - an animation repeats forever, or the spring easing is used outside the
//   success states;
// - a :hover rule sits outside @media (hover: hover) / (hover: none);
// - motion escapes the reduced-motion rules: elements are stopped by
//   globals.css, pseudo-elements and the details content box by this file;
// - something is hidden before a reveal without the .mk-motion class that
//   only the script adds (so the page reads the same without JavaScript);
// - the tokens are defined more than once, differ from the agreed values or
//   from the script's copy, or the marketing components import an
//   animation library.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { MAX_STAGGER, MOTION } from "../apps/web/components/marketing/motion.tsx";

const web = (path: string) => new URL("../apps/web/" + path, import.meta.url);

type Declaration = { property: string; value: string; important: boolean };
type Rule = {
  selector: string;
  selectors: string[];
  declarations: Declaration[];
  /** Enclosing at-rule preludes, outermost first. */
  context: string[];
  line: number;
};

/** Splits on a separator at the top level (outside parentheses, brackets and strings). */
function splitTop(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0,
    quote = "",
    current = "";
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = "";
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === separator && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}
const tokens = (value: string) => splitTop(value.replace(/\s+/g, " "), " ");

/** Every rule of a stylesheet with its at-rule context (no CSS nesting). */
export function cssRules(source: string): Rule[] {
  // Blank comments, keeping line numbers.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const rules: Rule[] = [];
  const lineAt = (offset: number) => text.slice(0, offset).split("\n").length;
  const walk = (start: number, end: number, context: string[]) => {
    let i = start;
    while (i < end) {
      const open = text.indexOf("{", i);
      if (open < 0 || open >= end) break;
      const prelude = text.slice(i, open).trim();
      // The matching brace.
      let depth = 1,
        j = open + 1;
      for (; j < end && depth; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
      }
      const close = j - 1;
      const body = text.slice(open + 1, close);
      if (prelude.startsWith("@") && !/^@(font-face|page|property)\b/.test(prelude)) {
        walk(open + 1, close, [...context, prelude.replace(/\s+/g, " ")]);
      } else {
        const declarations = splitTop(body, ";").map((raw) => {
          const colon = raw.indexOf(":");
          const value = raw.slice(colon + 1).trim();
          return {
            property: raw.slice(0, colon).trim().toLowerCase(),
            value: value.replace(/\s*!important$/, "").replace(/\s+/g, " "),
            important: /!important$/.test(value),
          };
        });
        const selector = prelude.replace(/\s+/g, " ");
        rules.push({
          selector,
          selectors: splitTop(selector, ","),
          declarations,
          context,
          line: lineAt(i + (text.slice(i, open).length - text.slice(i, open).trimStart().length)),
        });
      }
      i = close + 1;
    }
  };
  walk(0, text.length, []);
  return rules;
}

const TOKENS: Record<string, string> = {
  "--mk-dur-press": "80ms",
  "--mk-dur-fast": "140ms",
  "--mk-dur-base": "200ms",
  "--mk-dur-slow": "280ms",
  "--mk-dur-emphasis": "420ms",
  "--mk-ease-out": "cubic-bezier(0.2, 0, 0, 1)",
  "--mk-ease-in": "cubic-bezier(0.4, 0, 1, 1)",
  "--mk-ease-in-out": "cubic-bezier(0.4, 0, 0.2, 1)",
  "--mk-ease-spring": "cubic-bezier(0.34, 1.4, 0.64, 1)",
};
/** What may move: compositor properties, the relay's wire and a disclosure's height. */
const MOVING = new Set(["opacity", "transform", "translate", "scale", "rotate", "stroke-dashoffset"]);
const TRANSITIONS = new Set([...MOVING, "grid-template-rows", "content-visibility"]);
const LAYOUT = /^(width|height|(min|max)-(width|height)|inline-size|block-size|(min|max)-(inline|block)-size|top|left|right|bottom|inset(-.+)?|margin(-.+)?|padding(-.+)?|all)$/;
const DURATION = /^var\(--mk-dur-(press|fast|base|slow|emphasis)\)$/;
const EASING = /^var\(--mk-ease-(out|in|in-out|spring)\)$/;
const TIME = /^(-?[\d.]+m?s|var\(--mk-stagger(, ?[\d.]+m?s)?\))$/;
const KEYWORD_EASING = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|(cubic-bezier|steps|linear)\(.*\))$/;
/** The success states that may use the spring (relay ticks, "Applied automatically", pops). */
const SPRING_ALLOWED = [
  ".mk-relay-rows svg",
  ".mk-lane-auto",
  ".badge[data-mk-success]",
  ".mk-sets svg",
  ".mk-screen-note svg",
  ".mk-queue-item.done .badge svg",
];
/** :hover rules that are functions, not effects: they stay on every device. */
const HOVER_ALLOWED = [
  {
    selector: ".mk-nav-group:hover > .mk-dropdown",
    reason:
      "Opens a header menu on the devices that can hover; the same menu opens on keyboard focus. It is behaviour, not decoration, and its motion is on the menu's own tokens.",
  },
];
/** Elements hidden without the .mk-motion class: closed or decorative states that never hold unrevealed content. */
const HIDDEN_ALLOWED = [".mk-dropdown", ".mk-relay-dot", ":not([open])"];
const ROOT = /^(:is\(\.mk, \.mk-header, \.mk-footer\)|\.mk|\.mk-header|\.mk-footer)(?=$|[\s:.>[])/;

/** Why one transition or animation list breaks the rules, or null. */
function motionProblems(rule: Rule, keyframes: Set<string>): string[] {
  const problems: string[] = [];
  const scroll = rule.declarations.some((d) => d.property === "animation-timeline");
  for (const { property, value } of rule.declarations) {
    if (value === "none") continue;
    if (property === "transition") {
      for (const item of splitTop(value, ",")) {
        const parts = tokens(item);
        const names = parts.filter(
          (t) => !DURATION.test(t) && !EASING.test(t) && !TIME.test(t) && !KEYWORD_EASING.test(t) && t !== "allow-discrete" && t !== "normal",
        );
        const times = parts.filter((t) => DURATION.test(t) || TIME.test(t));
        const easing = parts.find((t) => EASING.test(t) || KEYWORD_EASING.test(t));
        if (names.length !== 1) problems.push(`"${item}" must name exactly one property`);
        for (const name of names) {
          if (!TRANSITIONS.has(name)) problems.push(`transitions ${name}`);
          if (LAYOUT.test(name)) problems.push(`animates layout (${name})`);
        }
        if (!times[0] || !DURATION.test(times[0])) problems.push(`"${item}": the duration is not a --mk-dur token`);
        if (times.length > 2) problems.push(`"${item}": too many times`);
        if (names[0] !== "content-visibility" && !(easing && EASING.test(easing)))
          problems.push(`"${item}": the easing is not a --mk-ease token`);
      }
    } else if (property === "transition-property") {
      for (const name of splitTop(value, ","))
        if (!TRANSITIONS.has(name) || LAYOUT.test(name)) problems.push(`transitions ${name}`);
    } else if (property === "transition-duration" || property === "animation-duration") {
      for (const t of splitTop(value, ",")) if (!DURATION.test(t)) problems.push(`${property}: ${t} is not a --mk-dur token`);
    } else if (property === "transition-timing-function" || property === "animation-timing-function") {
      for (const t of splitTop(value, ",")) if (!EASING.test(t)) problems.push(`${property}: ${t} is not a --mk-ease token`);
    } else if (property === "animation-iteration-count") {
      if (/infinite/.test(value)) problems.push("repeats forever");
    } else if (property === "animation-name") {
      for (const name of splitTop(value, ",")) if (!keyframes.has(name)) problems.push(`unknown keyframes ${name}`);
      if (!rule.declarations.some((d) => d.property === "animation-timing-function"))
        problems.push("animation-name without its own --mk-ease timing function");
    } else if (property === "animation") {
      for (const item of splitTop(value, ",")) {
        const parts = tokens(item);
        if (parts.includes("infinite")) problems.push(`"${item}" repeats forever`);
        const name = parts.find((t) => keyframes.has(t));
        if (!name) problems.push(`"${item}" names no keyframes in this file`);
        const times = parts.filter((t) => DURATION.test(t) || TIME.test(t));
        const easing = parts.find((t) => EASING.test(t) || KEYWORD_EASING.test(t));
        if (scroll) {
          // Scroll-driven: progress follows the scroll, so no duration and a
          // linear mapping.
          if (times.length) problems.push(`"${item}": a scroll-driven animation takes no time`);
          if (easing !== "linear") problems.push(`"${item}": a scroll-driven animation maps linearly`);
          continue;
        }
        if (!times[0] || !DURATION.test(times[0])) problems.push(`"${item}": the duration is not a --mk-dur token`);
        if (!(easing && EASING.test(easing))) problems.push(`"${item}": the easing is not a --mk-ease token`);
      }
    }
  }
  return problems;
}
const moves = (rule: Rule) =>
  rule.declarations.some(
    (d) =>
      d.value !== "none" &&
      /^(transition|transition-property|transition-duration|animation|animation-name|animation-duration)$/.test(d.property),
  );

test("the CSS reader keeps at-rule context, selectors and !important", () => {
  const rules = cssRules(`/* .a:hover { x } */
.a { transition: opacity var(--mk-dur-fast) var(--mk-ease-out); }
@media (hover: hover) { .b:hover, .c { translate: 0 -2px; } }
@supports (x: y) { @media (prefers-reduced-motion: reduce) { .d::after { animation: none !important; } } }
@keyframes k { from { opacity: 0; } to { opacity: 1 } }`);
  assert.deepEqual(
    rules.map((r) => [r.selector, r.context.join(" | "), r.declarations.map((d) => `${d.property}=${d.value}${d.important ? "!" : ""}`).join(";")]),
    [
      [".a", "", "transition=opacity var(--mk-dur-fast) var(--mk-ease-out)"],
      [".b:hover, .c", "@media (hover: hover)", "translate=0 -2px"],
      [".d::after", "@supports (x: y) | @media (prefers-reduced-motion: reduce)", "animation=none!"],
      ["from", "@keyframes k", "opacity=0"],
      ["to", "@keyframes k", "opacity=1"],
    ],
  );
  assert.deepEqual(rules[1].selectors, [".b:hover", ".c"]);
  // The checker flags what the rules forbid and passes what they allow.
  const keyframes = new Set(["k"]);
  const check = (css: string) => cssRules(css).flatMap((r) => motionProblems(r, keyframes));
  for (const bad of [
    ".x { transition: width var(--mk-dur-fast) var(--mk-ease-out); }",
    ".x { transition: all var(--mk-dur-fast) var(--mk-ease-out); }",
    ".x { transition: opacity 0.15s var(--mk-ease-out); }",
    ".x { transition: opacity var(--mk-dur-fast) ease; }",
    ".x { transition: opacity var(--mk-dur-fast); }",
    ".x { transition: var(--mk-dur-fast); }",
    ".x { transition-duration: 200ms; }",
    ".x { animation: k 1s var(--mk-ease-out); }",
    ".x { animation: k var(--mk-dur-base) var(--mk-ease-out) infinite; }",
    ".x { animation: k var(--mk-dur-base) linear; }",
    ".x { animation-name: k; animation-duration: var(--mk-dur-base); }",
    ".x { animation: missing var(--mk-dur-base) var(--mk-ease-out); }",
    ".x { transition: margin-top var(--mk-dur-fast) var(--mk-ease-out); }",
  ])
    assert.ok(check(bad).length, bad);
  for (const good of [
    ".x { transition: opacity var(--mk-dur-fast) var(--mk-ease-out) 120ms, translate var(--mk-dur-slow) var(--mk-ease-out) var(--mk-stagger, 0ms); }",
    ".x { transition: grid-template-rows var(--mk-dur-slow) var(--mk-ease-out), content-visibility var(--mk-dur-slow) allow-discrete; }",
    ".x { transition: none; }",
    ".x { animation: k var(--mk-dur-base) var(--mk-ease-spring) 80ms both; }",
    ".x { animation: k linear both; animation-timeline: scroll(root block); }",
    ".x { animation-name: k; animation-timing-function: var(--mk-ease-out); animation-duration: var(--mk-dur-emphasis); }",
  ])
    assert.deepEqual(check(good), [], good);
});

test("marketing motion uses the tokens, moves only transform, opacity and disclosure rows, and never loops", async () => {
  const css = await readFile(web("app/marketing.css"), "utf8");
  const rules = cssRules(css);
  // The tokens: defined once, on the marketing roots, with the agreed values.
  for (const [token, value] of Object.entries(TOKENS)) {
    const defined = rules.flatMap((r) =>
      r.declarations.filter((d) => d.property === token).map((d) => ({ rule: r.selector, value: d.value })),
    );
    assert.equal(defined.length, 1, `${token} is defined ${defined.length} times`);
    assert.equal(defined[0].rule, ".mk, .mk-header, .mk-footer", token);
    assert.equal(defined[0].value, value, token);
  }
  // No motion literal hides outside a token (the tokens' own definitions excepted).
  for (const rule of rules)
    for (const d of rule.declarations)
      if (!d.property.startsWith("--") && /^(transition|animation)/.test(d.property))
        assert.doesNotMatch(
          d.value.replace(/var\([^)]*\)/g, "var()"),
          /cubic-bezier|\bease(-in|-out|-in-out)?\b|steps\(/,
          `${rule.selector} ${d.property}`,
        );
  const keyframes = new Set(
    rules.flatMap((r) => r.context.map((c) => c.match(/^@keyframes ([\w-]+)$/)?.[1]).filter((n): n is string => !!n)),
  );
  assert.ok(keyframes.size >= 5, "the relay, header and demo keyframes are read");
  const problems: string[] = [];
  for (const rule of rules) {
    // Keyframes move compositor properties (and the relay's wire) only.
    if (rule.context.some((c) => c.startsWith("@keyframes"))) {
      for (const d of rule.declarations)
        if (!MOVING.has(d.property)) problems.push(`${rule.context.at(-1)} ${rule.selector}: ${d.property}`);
      continue;
    }
    for (const p of motionProblems(rule, keyframes)) problems.push(`line ${rule.line} ${rule.selector}: ${p}`);
  }
  assert.deepEqual(problems, []);
  assert.doesNotMatch(css, /\binfinite\b/, "no marketing animation repeats forever");
  // The spring is for success states only.
  const springs = rules.filter((r) =>
    r.declarations.some((d) => !d.property.startsWith("--") && d.value.includes("--mk-ease-spring")),
  );
  assert.ok(springs.length >= 4, "the relay ticks, the lane, the demo label and the screen ticks use the spring");
  for (const rule of springs)
    for (const selector of rule.selectors)
      assert.ok(
        SPRING_ALLOWED.some((allowed) => selector.includes(allowed)),
        `the spring on ${selector} (success states only: ${SPRING_ALLOWED.join(", ")})`,
      );
});

test("hover effects only where the pointer hovers; reduced motion stops everything", async () => {
  const css = await readFile(web("app/marketing.css"), "utf8");
  const globals = await readFile(web("app/globals.css"), "utf8");
  const rules = cssRules(css);
  for (const rule of rules)
    for (const selector of rule.selectors) {
      if (!selector.includes(":hover")) continue;
      if (HOVER_ALLOWED.some((a) => a.selector === selector)) continue;
      assert.ok(
        rule.context.some((c) => /^@media .*\(hover: (hover|none)\)/.test(c)),
        `${selector} (line ${rule.line}) must sit inside @media (hover: hover)`,
      );
    }
  for (const a of HOVER_ALLOWED) {
    assert.ok(rules.some((r) => r.selectors.includes(a.selector)), `stale hover allowance ${a.selector}`);
    assert.ok(a.reason.length > 40);
  }
  // globals.css stops every element's transitions and animations.
  const reducedGlobals = cssRules(globals).filter(
    (r) => r.context.includes("@media (prefers-reduced-motion: reduce)") && r.selector === "*",
  );
  assert.ok(
    reducedGlobals.some(
      (r) =>
        r.declarations.some((d) => d.property === "transition" && d.value === "none" && d.important) &&
        r.declarations.some((d) => d.property === "animation" && d.value === "none" && d.important),
    ),
    "globals.css: * { transition: none !important; animation: none !important } under reduced motion",
  );
  // `*` does not reach pseudo-elements or the details content box: this
  // file stops them for every marketing root.
  const reduced = rules.filter((r) => r.context.some((c) => c.includes("prefers-reduced-motion: reduce")));
  const stops = (selector: string) =>
    reduced.some(
      (r) =>
        r.selectors.includes(selector) &&
        r.declarations.some((d) => d.property === "transition" && d.value === "none" && d.important) &&
        (selector.includes("details-content") ||
          r.declarations.some((d) => d.property === "animation" && d.value === "none" && d.important)),
    );
  for (const selector of [
    ":is(.mk, .mk-header, .mk-footer)::after",
    ":is(.mk, .mk-header, .mk-footer) ::before",
    ":is(.mk, .mk-header, .mk-footer) ::after",
    ":is(.mk, .mk-header, .mk-footer) ::details-content",
  ])
    assert.ok(stops(selector), `reduced motion stops ${selector}`);
  // Every moving pseudo-element sits under a marketing root, so those rules
  // reach it; only ::before, ::after and ::details-content move.
  for (const rule of rules.filter(moves))
    for (const selector of rule.selectors) {
      const pseudo = selector.match(/::[\w-]+/g) ?? [];
      if (!pseudo.length) continue;
      for (const p of pseudo)
        assert.ok(["::before", "::after", "::details-content"].includes(p), `${selector}: ${p} moves`);
      assert.match(selector, ROOT, `${selector} (line ${rule.line}) must start at a marketing root`);
    }
  // Hover, press and nudge movements are removed, and nothing stays hidden.
  const still = reduced.find((r) => r.declarations.some((d) => d.property === "scale" && d.value === "none" && d.important));
  assert.ok(still && /\.button/.test(still.selector) && /summary/.test(still.selector) && /lucide-arrow-right/.test(still.selector));
  assert.ok(
    reduced.some(
      (r) =>
        r.selectors.includes('.mk-motion [data-mk-reveal="pending"]') &&
        r.declarations.some((d) => d.property === "opacity" && d.value === "1" && d.important),
    ),
  );
  // Auto-playing keyframes (the relay, the header shadow, the demo, the
  // phone menu) sit inside prefers-reduced-motion: no-preference.
  for (const rule of rules)
    if (rule.declarations.some((d) => (d.property === "animation" || d.property === "animation-name") && d.value !== "none"))
      assert.ok(
        rule.context.some((c) => c.includes("prefers-reduced-motion: no-preference")),
        `${rule.selector} (line ${rule.line}) animates outside prefers-reduced-motion: no-preference`,
      );
});

test("nothing is hidden before a reveal without the script's .mk-motion class", async () => {
  const rules = cssRules(await readFile(web("app/marketing.css"), "utf8"));
  for (const rule of rules) {
    if (rule.context.some((c) => c.startsWith("@keyframes") || c.startsWith("@starting-style"))) continue;
    // A waiting unit is at 0.001 (painted but unseen), which hides it too.
    if (!rule.declarations.some((d) => d.property === "opacity" && Number(d.value) < 0.01)) continue;
    for (const selector of rule.selectors) {
      if (/::(before|after)$/.test(selector)) continue; // decorative overlays and rings
      assert.ok(
        selector.startsWith(".mk-motion ") || HIDDEN_ALLOWED.some((a) => selector.includes(a)),
        `${selector} (line ${rule.line}) hides content without .mk-motion`,
      );
    }
  }
  // Every reveal state waits on the script's class.
  for (const rule of rules)
    for (const selector of rule.selectors)
      if (/data-mk-(reveal|item)/.test(selector))
        assert.ok(selector.startsWith(".mk-motion"), `${selector} must start with .mk-motion`);
  // Adding .mk-motion to the page root, and marking or revealing a unit,
  // must restyle only the elements that move: every rule under .mk-motion
  // ends in a class, an attribute or an icon/meter element, never a
  // universal or structural selector that would restyle a whole section
  // (measured: that cost long tasks while scrolling /features).
  for (const rule of rules)
    for (const selector of rule.selectors) {
      if (!selector.startsWith(".mk-motion")) continue;
      for (const compound of rightmostCompounds(selector))
        assert.match(
          compound,
          /^(\[data-mk-(reveal|item)="[a-z]+"\]|\.[\w-]+(\.[\w-]+)*|span|svg)$/,
          `${selector}: ends in ${compound}`,
        );
    }
});

/** The rightmost compound of a selector, expanded through a trailing :is(). */
function rightmostCompounds(selector: string): string[] {
  // Split on top-level combinators (outside parentheses and brackets).
  const parts: string[] = [];
  let depth = 0,
    current = "";
  for (const ch of selector.trim()) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && /[\s>+~]/.test(ch)) {
      if (current) parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current) parts.push(current);
  const last = parts.at(-1) ?? "";
  const is = last.match(/^:is\((.*)\)$/);
  return is ? splitTop(is[1], ",").flatMap(rightmostCompounds) : [last];
}

test("the script's motion values are the CSS tokens, and no animation library is imported", async () => {
  const css = await readFile(web("app/marketing.css"), "utf8");
  const token = (name: string) => css.match(new RegExp(`${name}:\\s*([^;]+);`))![1].trim();
  assert.equal(`${MOTION.press}ms`, token("--mk-dur-press"));
  assert.equal(`${MOTION.fast}ms`, token("--mk-dur-fast"));
  assert.equal(`${MOTION.base}ms`, token("--mk-dur-base"));
  assert.equal(`${MOTION.slow}ms`, token("--mk-dur-slow"));
  assert.equal(`${MOTION.emphasis}ms`, token("--mk-dur-emphasis"));
  assert.equal(MOTION.easeOut, token("--mk-ease-out"));
  // The script marks grid items "done" after the longest stagger.
  const staggers = [...css.matchAll(/--mk-stagger:\s*(\d+)ms/g)].map((m) => Number(m[1]));
  assert.equal(Math.max(...staggers), MAX_STAGGER);
  // Marketing components import React, Next's link, the icon set, the
  // workspace packages and each other: no animation library.
  const dir = new URL("../apps/web/components/marketing/", import.meta.url);
  for (const file of (await readdir(dir)).filter((f) => /\.tsx?$/.test(f))) {
    const source = await readFile(new URL(file, dir), "utf8");
    for (const [, from] of source.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s+"([^"]+)"/g))
      assert.ok(
        /^(react|next\/link|lucide-react|@trainer\/(contracts|domain)|\.{1,2}\/)/.test(from),
        `${file} imports ${from}`,
      );
  }
  const motion = await readFile(new URL("motion.tsx", dir), "utf8");
  assert.deepEqual(
    [...motion.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]),
    ["react"],
    "motion.tsx imports only react",
  );
  // The reveal observes with IntersectionObserver, checks reduced motion and
  // never touches the hero, the page heading or the relay.
  assert.match(motion, /new IntersectionObserver\(/);
  assert.match(motion, /prefers-reduced-motion: reduce/);
  assert.match(motion, /\.mk-hero, \.mk-page-head, \.mk-relay/);
  assert.match(motion, /classList\.add\("mk-motion"\)/);
});

test("one set of motion tokens; the journey player shares the sitewide press and reveal rules (its hover rules: tests/marketing-journey.test.ts)", async () => {
  // The tokens are defined once across every stylesheet: the journey's
  // (app/marketing-journey.css) and the rest only use them.
  const dir = web("app/");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".css"))) {
    const css = (await readFile(new URL(file, dir), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    const count = [...css.matchAll(/--mk-(?:dur|ease)-[a-z-]+\s*:/g)].length;
    assert.equal(count, file === "marketing.css" ? Object.keys(TOKENS).length : 0, `${file} defines ${count} motion token(s)`);
  }
  const rules = cssRules(await readFile(web("app/marketing.css"), "utf8"));
  // The player's control buttons press like every other button, and hold
  // still under reduced motion.
  const press = rules.find((r) => r.selectors.includes(".mk .mk-walk-btn:active:not(:disabled)"));
  assert.ok(press && press.selectors.includes(":is(.mk, .mk-header) .button:active:not(:disabled)"), "the journey buttons share the press");
  assert.ok(
    rules.some(
      (r) =>
        r.selectors.includes(".mk .mk-walk-btn") &&
        r.declarations.some((d) => d.property === "transition" && d.value === "scale var(--mk-dur-fast) var(--mk-ease-out)"),
    ),
  );
  assert.ok(
    rules.some(
      (r) =>
        r.context.some((c) => c.includes("prefers-reduced-motion: reduce")) &&
        r.selector.includes(".mk-walk-btn") &&
        r.declarations.some((d) => d.property === "scale" && d.value === "none" && d.important),
    ),
  );
  // The relay's ring pulses on the hero relay only, never on the journey's
  // copy of the mark in its laptop bar.
  const ring = rules.filter((r) => r.declarations.some((d) => d.property === "animation" && d.value.startsWith("mk-ring ")));
  assert.deepEqual(
    ring.flatMap((r) => r.selectors),
    [".mk .mk-relay .mk-relay-mark::after"],
  );
  // The reveal never marks the journey: it has its own chapter motion.
  const motion = await readFile(web("components/marketing/motion.tsx"), "utf8");
  assert.match(motion, /\.mk-walk-section, \.mk-walk-band/);
  assert.match(motion, /!unit\.closest\(NEVER\)/);
  const journey = await readFile(web("components/marketing/journey.tsx"), "utf8");
  assert.match(journey, /className="mk-section mk-walk-section"/);
  assert.match(journey, /className="mk-home-band mk-home-paper mk-walk-band"/);
});
