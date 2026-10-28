// Motion hygiene for the public marketing site (apps/web/app/marketing.css
// and components/marketing/motion.tsx), 29 September 2026 microanimation
// pass. It reads the stylesheet as rules with their at-rule context and
// fails when:
// - a transition or keyframe moves anything but transform, opacity, SVG
//   stroke-dashoffset or a disclosure's grid rows (never width, height,
//   top, left, margin and the like), or a transition names no property;
// - a duration or easing is not a --mk-* motion token (delays are
//   choreography times and are exempt, and so is the scroll-driven header
//   shadow, which has no duration), or a reveal, item, load-in or nudge
//   distance, or an item stagger, is not a --mk-dist-* / --mk-stagger-*
//   token (22 October 2026 concept pass);
// - an animation repeats forever, the spring easing is used outside the
//   success states, or the enter easing outside the load-in entrances;
// - the concept pass's motion is not wired as agreed: the commission pills
//   load from the inline start 80ms apart, the FAQ rows cascade, the
//   closing button's arrow nudges once when the button itself comes into
//   view (a trigger of its own, data-mk-cue), the hero's arrow takes over
//   after the relay, and the /features set ticks pop in turn;
// - a :hover rule sits outside @media (hover: hover) / (hover: none);
// - the marketing motion switch (components/marketing/motion-mode.ts) is not
//   wired both ways: with "always" (the owner, 22 October 2026) every short
//   marketing motion plays for every visitor, so every reduced-motion rule
//   that reaches the marketing root or the assistant host must skip
//   [data-mk-motion="always"]; with "device" those same rules (kept, not
//   deleted) stop everything as before: elements in globals.css and
//   app/motion.css, pseudo-elements and the details content box in this
//   file, and the scripts read both settings. The pinned scroll scenes
//   follow both settings in either mode;
// - something is hidden before a reveal without the .mk-motion class that
//   only the script adds (so the page reads the same without JavaScript);
// - the tokens are defined more than once, differ from the agreed values or
//   from the script's copy, or the marketing components import an
//   animation library.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { MAX_STAGGER, MOTION } from "../apps/web/components/marketing/motion.tsx";
import {
  MARKETING_MOTION,
  MARKETING_MOTION_ATTRIBUTE,
  MOTION_ALWAYS_EXCLUDED,
} from "../apps/web/components/marketing/motion-mode.ts";
import { cssRules, splitTop, type Rule } from "./marketing-helpers.ts";

const web = (path: string) => new URL("../apps/web/" + path, import.meta.url);
/**
 * The phase 1 page sheets (app/layout.tsx): the same contract as
 * marketing.css, with its tokens (they define none of their own).
 */
const PAGE_SHEETS = ["marketing-proof.css", "marketing-home.css", "marketing-brain-pages.css", "marketing-pricing.css"];

const tokens = (value: string) => splitTop(value.replace(/\s+/g, " "), " ");

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
  "--mk-ease-enter": "cubic-bezier(0.2, 0.8, 0.2, 1)",
  "--mk-dist-nudge": "3px",
  "--mk-dist-item": "8px",
  "--mk-dist-rise": "12px",
  "--mk-dist-load": "16px",
  "--mk-stagger-step": "40ms",
  "--mk-stagger-load": "80ms",
};
/** What may move: compositor properties, the relay's wire and a disclosure's height. */
const MOVING = new Set(["opacity", "transform", "translate", "scale", "rotate", "stroke-dashoffset"]);
const TRANSITIONS = new Set([...MOVING, "grid-template-rows", "content-visibility"]);
const LAYOUT = /^(width|height|(min|max)-(width|height)|inline-size|block-size|(min|max)-(inline|block)-size|top|left|right|bottom|inset(-.+)?|margin(-.+)?|padding(-.+)?|all)$/;
const DURATION = /^var\(--mk-dur-(press|fast|base|slow|emphasis)\)$/;
const EASING = /^var\(--mk-ease-(out|in|in-out|spring|enter)\)$/;
/** A delay: a choreography time, a stagger (the item's own, or a stagger
 * token), or a calc() of times, numbers and those (the /features set ticks). */
const STAGGER_VAR = String.raw`var\(--mk-(?:stagger(?:-step|-load)?|set-step)(?:, ?[\d.]+m?s)?\)`;
const TIME = new RegExp(String.raw`^(-?[\d.]+m?s|${STAGGER_VAR}|calc\((?:[\d.]+m?s|[\d.]+|${STAGGER_VAR}|[\s+*-])+\))$`);
const KEYWORD_EASING = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|(cubic-bezier|steps|linear)\(.*\))$/;
/** The success states that may use the spring (relay ticks, "Applied automatically", pops). */
const SPRING_ALLOWED = [
  ".mk-relay-rows svg",
  ".mk-lane-auto",
  ".badge[data-mk-success]",
  '.mk-sets[data-mk-cue="in"] svg',
  ".mk-screen-note svg",
  ".mk-queue-item.done .badge svg",
];
/** The load-in entrances that may use the enter easing (the concept's plate curve). */
const ENTER_ALLOWED = ['.mk-band-pills > [data-mk-item="in"]', ".mk .mk-hero .mk-mark::before"];
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
    ".x { transition: opacity var(--mk-dur-fast) var(--mk-ease-out) calc(var(--other) + 1ms); }",
    ".x { transition: opacity var(--mk-dur-fast) var(--mk-ease-bounce); }",
  ])
    assert.ok(check(bad).length, bad);
  for (const good of [
    ".x { transition: opacity var(--mk-dur-fast) var(--mk-ease-out) 120ms, translate var(--mk-dur-slow) var(--mk-ease-out) var(--mk-stagger, 0ms); }",
    ".x { transition: grid-template-rows var(--mk-dur-slow) var(--mk-ease-out), content-visibility var(--mk-dur-slow) allow-discrete; }",
    ".x { transition: none; }",
    ".x { animation: k var(--mk-dur-base) var(--mk-ease-spring) 80ms both; }",
    ".x { animation: k linear both; animation-timeline: scroll(root block); }",
    ".x { animation-name: k; animation-timing-function: var(--mk-ease-out); animation-duration: var(--mk-dur-emphasis); }",
    ".x { transition: translate var(--mk-dur-slow) var(--mk-ease-enter) var(--mk-stagger-load); }",
    ".x { transition: opacity var(--mk-dur-fast) var(--mk-ease-out) calc(520ms + var(--mk-set-step, 0ms)); }",
    ".x { animation: k var(--mk-dur-emphasis) var(--mk-ease-in-out) 2.55s 1; }",
  ])
    assert.deepEqual(check(good), [], good);
});

test("marketing motion uses the tokens, moves only transform, opacity and disclosure rows, and never loops", async () => {
  const css = await readFile(web("app/marketing.css"), "utf8");
  const pageCss = await Promise.all(PAGE_SHEETS.map((sheet) => readFile(web("app/" + sheet), "utf8")));
  const rules = [css, ...pageCss].flatMap((source) => cssRules(source));
  // The tokens: defined once, on the marketing roots, with the agreed values.
  for (const [token, value] of Object.entries(TOKENS)) {
    const defined = rules.flatMap((r) =>
      r.declarations.filter((d) => d.property === token).map((d) => ({ rule: r.selector, value: d.value })),
    );
    assert.equal(defined.length, 1, `${token} is defined ${defined.length} times`);
    assert.equal(defined[0].rule, ".mk, .mk-header, .mk-footer, .mk-assistant-host", token);
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
  for (const source of [css, ...pageCss])
    assert.doesNotMatch(source, /\binfinite\b/, "no marketing animation repeats forever");
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
  // The enter curve is for the load-in entrances only.
  const enters = rules.filter((r) =>
    r.declarations.some((d) => !d.property.startsWith("--") && d.value.includes("--mk-ease-enter")),
  );
  assert.ok(enters.length >= 1, "the commission pills use the enter curve");
  for (const rule of enters)
    for (const selector of rule.selectors)
      assert.ok(
        ENTER_ALLOWED.some((allowed) => selector.includes(allowed)),
        `the enter curve on ${selector} (load-in entrances only: ${ENTER_ALLOWED.join(", ")})`,
      );
  // Motion distances are tokens: the reveal, an item, a load-in and the
  // arrow nudge (the hover lift of a card is its own 2px).
  for (const rule of rules)
    for (const d of rule.declarations) {
      if (d.property !== "translate" || !/(\.mk-motion|lucide-arrow-right|@keyframes mk-nudge)/.test(rule.selector + rule.context.join(" "))) continue;
      assert.doesNotMatch(d.value, /(^|[\s(])[1-9][\d.]*px/, `line ${rule.line} ${rule.selector}: translate ${d.value} uses a --mk-dist token`);
    }
});

test("hover effects only where the pointer hovers; in \"device\" mode reduced motion stops everything", async () => {
  const css = await readFile(web("app/marketing.css"), "utf8");
  const globals = await readFile(web("app/globals.css"), "utf8");
  const rules = cssRules(css);
  const pageRules = (await Promise.all(PAGE_SHEETS.map((sheet) => readFile(web("app/" + sheet), "utf8")))).flatMap(
    (source) => cssRules(source),
  );
  for (const rule of [...rules, ...pageRules])
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
  // globals.css stops every element's transitions and animations, except
  // under [data-mk-motion="always"] (the marketing switch).
  const G = MOTION_ALWAYS_EXCLUDED;
  const reducedGlobals = cssRules(globals).filter(
    (r) => r.context.includes("@media (prefers-reduced-motion: reduce)") && r.selector === `*${G}`,
  );
  assert.ok(
    reducedGlobals.some(
      (r) =>
        r.declarations.some((d) => d.property === "transition" && d.value === "none" && d.important) &&
        r.declarations.some((d) => d.property === "animation" && d.value === "none" && d.important),
    ),
    `globals.css: *${G} { transition: none !important; animation: none !important } under reduced motion`,
  );
  // `*` does not reach pseudo-elements or the details content box: this
  // file stops them for every marketing root (in "device" mode, and for the
  // header and footer outside .mk).
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
    `:is(.mk, .mk-header, .mk-footer)${G}::after`,
    `:is(.mk, .mk-header, .mk-footer)${G} ::before`,
    `:is(.mk, .mk-header, .mk-footer)${G} ::after`,
    `:is(.mk, .mk-header, .mk-footer)${G} ::details-content`,
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
        r.selectors.includes(`.mk-motion${G} [data-mk-reveal="pending"]`) &&
        r.declarations.some((d) => d.property === "opacity" && d.value === "1" && d.important),
    ),
  );
  // The motion plays outside any no-preference query (the switch decides
  // who sees it): the relay, the header shadow, the demo and the phone menu.
  assert.doesNotMatch(css, /prefers-reduced-motion: no-preference/);
  for (const name of ["mk-draw", "mk-ring", "mk-tick", "mk-header-shadow", "mk-drop", "mk-rise", "mk-pop", "mk-stamp", "mk-menu-out", "mk-fade", "mk-fade-out"])
    assert.ok(
      rules.some((r) => r.declarations.some((d) => /^animation(-name)?$/.test(d.property) && d.value.split(/[\s,]+/).includes(name))),
      `${name} is still used`,
    );
});

test("the marketing motion switch: one constant, on the marketing root and the assistant host, with both modes wired", async () => {
  // One constant, one of the two modes; the attribute carries it to CSS.
  assert.ok(["always", "device"].includes(MARKETING_MOTION), MARKETING_MOTION);
  assert.equal(MARKETING_MOTION_ATTRIBUTE, "data-mk-motion");
  // The exclusion matches only "always" (with "device" nothing carries
  // it, so every rule matches what it matched before) and sits in :where()
  // (no added specificity, so the cascade is unchanged).
  assert.equal(MOTION_ALWAYS_EXCLUDED, ':not(:where([data-mk-motion="always"], [data-mk-motion="always"] *))');
  const modeSource = await readFile(web("components/marketing/motion-mode.ts"), "utf8");
  assert.doesNotMatch(modeSource, /^\s*["']use client["']/m, "server code reads the switch");
  assert.doesNotMatch(modeSource, /^\s*import\s/m, "motion-mode.ts imports nothing");
  assert.match(modeSource, /^export const MARKETING_MOTION = "(always|device)" as MarketingMotionMode;$/m);
  // The attribute is rendered from the constant on the marketing root and
  // the assistant host, and nowhere else (the member app, the trainer
  // workspace, coach websites and the sign-in pages never carry it).
  const site = await readFile(web("components/marketing/site.tsx"), "utf8");
  assert.match(site, /<div className="public mk platform-ui" data-mk-motion=\{MARKETING_MOTION\}>/);
  const host = await readFile(web("components/marketing/assistant-button.tsx"), "utf8");
  assert.match(host, /className="mk-assistant-host public platform-ui"\s+data-mk-motion=\{MARKETING_MOTION\}/);
  const carriers: string[] = [];
  const walk = async (dir: URL, rel: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(new URL(entry.name + "/", dir), rel + entry.name + "/");
      else if (/\.tsx?$/.test(entry.name) && /data-mk-motion=\{/.test(await readFile(new URL(entry.name, dir), "utf8")))
        carriers.push(rel + entry.name);
    }
  };
  await walk(web("app/"), "app/");
  await walk(web("components/"), "components/");
  assert.deepEqual(carriers.sort(), ["components/marketing/assistant-button.tsx", "components/marketing/site.tsx"]);

  // CSS: every reduced-motion rule that reaches the marketing root or the
  // assistant host is kept and skips "always". Element rules: the device's
  // (globals.css) and the member's own choice (motion.css).
  const G = MOTION_ALWAYS_EXCLUDED;
  const globals = cssRules(await readFile(web("app/globals.css"), "utf8"));
  assert.ok(globals.some((r) => r.context.includes("@media (prefers-reduced-motion: reduce)") && r.selector === `*${G}`));
  assert.ok(!globals.some((r) => r.context.includes("@media (prefers-reduced-motion: reduce)") && r.selector === "*"), "no unscoped `*` rule");
  const member = cssRules(await readFile(web("app/motion.css"), "utf8"));
  const cookie = member.find((r) => r.selectors[0] === `:root[data-reduce-motion="on"] *${G}`);
  assert.ok(cookie, "the member's Reduce motion rule skips the marketing root in always mode");
  assert.deepEqual(cookie.selectors, ["", "::before", "::after", "::backdrop"].map((p) => `:root[data-reduce-motion="on"] *${G}${p}`));
  // Marketing stylesheets: every rule under reduced motion, and every rule
  // keyed on the member's choice, carries the exclusion on every selector.
  // A sheet that moves nothing (a still page sheet) needs no such rules.
  const sheets = ["marketing.css", "marketing-assistant.css", "marketing-journey.css", ...PAGE_SHEETS];
  let scoped = 0;
  for (const sheet of sheets) {
    const sheetRules = cssRules(await readFile(web("app/" + sheet), "utf8"));
    const reduceRules = sheetRules.filter(
      (r) =>
        !r.context.some((c) => c.startsWith("@keyframes")) &&
        (r.context.some((c) => c.includes("prefers-reduced-motion: reduce")) || r.selector.includes("data-reduce-motion")),
    );
    if (sheetRules.some(moves)) assert.ok(reduceRules.length, `${sheet} keeps its reduced-motion rules for "device" mode`);
    for (const rule of reduceRules)
      for (const selector of rule.selectors) {
        scoped++;
        assert.ok(selector.includes(G), `${sheet}:${rule.line} ${selector} must skip [data-mk-motion="always"]`);
      }
    // And the no-preference wrappers are gone: in "always" mode the motion
    // plays for everyone; in "device" mode the rules above stop it.
    assert.ok(
      !sheetRules.some((r) => r.context.some((c) => c.includes("prefers-reduced-motion: no-preference"))),
      `${sheet} has no no-preference wrapper`,
    );
  }
  assert.ok(scoped >= 12, `${scoped} scoped reduced-motion selectors`);

  // Kamran's Talk button: the marketing press in "always" mode, the
  // subscriber press (motion.css) in "device" mode.
  const marketing = cssRules(await readFile(web("app/marketing.css"), "utf8"));
  assert.ok(
    marketing.some(
      (r) =>
        r.selectors.includes('.mk-assistant-host:where([data-mk-motion="always"]) .button:active:not(:disabled)') &&
        r.declarations.some((d) => d.property === "scale" && d.value === "0.97"),
    ),
  );
  assert.ok(marketing.some((r) => r.selectors.includes('.mk-assistant-host:where([data-mk-motion="always"]) .button')));
  const press = member.filter((r) => r.context.some((c) => c.includes("no-preference")) && /\.public:not\(/.test(r.selector) && /\.button/.test(r.selector));
  assert.ok(press.length >= 2, "the subscriber press and its :active state");
  for (const r of press) assert.match(r.selector, /\.public:not\(\.mk, \[data-mk-motion="always"\]\)/);

  // JavaScript: the reveal, the settle and the journey player read both
  // settings, and only in "device" mode.
  const motion = await readFile(web("components/marketing/motion.tsx"), "utf8");
  assert.match(
    motion,
    /const reduced = \(\) =>\s+MARKETING_MOTION === "device" &&\s+\(\(typeof matchMedia === "function" && matchMedia\(REDUCED\)\.matches\) \|\|\s+document\.documentElement\.dataset\.reduceMotion === "on"\);/,
  );
  assert.match(motion, /const REDUCED = "\(prefers-reduced-motion: reduce\)";/);
  assert.match(motion, /typeof IntersectionObserver !== "function" \|\| reduced\(\)/);
  assert.match(motion, /!root\.closest\("\.mk"\) &&\s+!reduced\(\) &&/);
  const player = await readFile(web("components/marketing/journey-player.tsx"), "utf8");
  assert.match(
    player,
    /const reducedNow = \(\) =>\s+MARKETING_MOTION === "device" &&\s+typeof window !== "undefined" &&\s+\(\(typeof window\.matchMedia === "function" &&\s+window\.matchMedia\(REDUCE\)\.matches\) \|\|\s+document\.documentElement\.dataset\.reduceMotion === "on"\);/,
  );
  // The listener for a setting changed on an open page is kept for "device".
  assert.match(player, /useEffect\(\(\) => \{\s+if \(MARKETING_MOTION !== "device"\) return;\s+const query =/);
  assert.match(player, /attributeFilter: \["data-reduce-motion"\]/);
  assert.match(player, /setRun\(!reducedNow\(\)\)/);
  assert.match(player, /behavior: reducedNow\(\) \? "instant" : "smooth"/);
  // The chapter clock keeps its fallback: without the segment's <i> (or
  // under reduced motion in "device" mode) a target-less animation still
  // advances the chapter instead of crashing.
  assert.match(
    player,
    /reduced \|\| !fill\s+\? new Animation\(\s+new KeyframeEffect\(null, null, \{ duration \}\),\s+document\.timeline,\s+\)\s+: fill\.animate\(/,
  );

  // The pinned scroll scenes are not switched (Variant B): the head script
  // and the mount run the same reduced-motion tests, and neither reads the
  // marketing switch, so the pin is decided before the first paint and
  // never shifts the page.
  const head = await readFile(web("components/marketing/scenes-head.ts"), "utf8");
  const mount = await readFile(web("components/marketing/scene-mount.tsx"), "utf8");
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(head, /if\(d\.getAttribute\("data-reduce-motion"\)==="on"\)return;/);
  assert.match(head, /if\(window\.matchMedia&&matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches\)return;/);
  assert.match(mount, /const REDUCE = "\(prefers-reduced-motion: reduce\)";/);
  assert.match(
    mount,
    /const reduced = \(\) =>\s+\(typeof matchMedia === "function" && matchMedia\(REDUCE\)\.matches\) \|\|\s+document\.documentElement\.dataset\.reduceMotion === "on";/,
  );
  assert.match(mount, /location\.pathname === "\/" &&\s+!reduced\(\) &&/);
  for (const [name, source] of [["scenes-head.ts", head], ["scene-mount.tsx", mount]] as const) {
    assert.doesNotMatch(code(source), /MARKETING_MOTION|motion-mode|data-mk-motion/, `${name} must not read the marketing switch`);
    // Both test the same two settings.
    assert.match(source, /prefers-reduced-motion: reduce/, name);
    assert.match(source, /reduce-?[mM]otion/, name);
  }
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
      if (/data-mk-(reveal|item|cue)/.test(selector))
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
  // The script marks grid items "done" after the longest stagger. Each
  // item's --mk-stagger is a stagger token or a whole multiple of one.
  const ms = (name: string) => Number(token(name).replace(/ms$/, ""));
  const staggers = [...css.matchAll(/--mk-stagger:\s*([^;]+);/g)].map(([, value]) => {
    const m = value.trim().match(/^(?:calc\((\d+) \* var\((--mk-stagger-(?:step|load))\)\)|var\((--mk-stagger-(?:step|load))\))$/);
    assert.ok(m, `--mk-stagger: ${value} is a stagger token or a whole multiple of one`);
    return m[1] ? Number(m[1]) * ms(m[2]) : ms(m[3]);
  });
  assert.ok(staggers.length >= 9, `${staggers.length} item staggers`);
  assert.equal(Math.max(...staggers), MAX_STAGGER);
  // Marketing components import React, Next's link/router, the icon set, the
  // workspace packages and each other: no animation library. Subfolders (the
  // Brain engine, with its plain .js modules) included.
  const dir = new URL("../apps/web/components/marketing/", import.meta.url);
  for (const file of (await readdir(dir, { recursive: true })).filter((f) => /\.(tsx?|js)$/.test(f))) {
    const source = await readFile(new URL(file, dir), "utf8");
    for (const [, from] of source.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s+"([^"]+)"/g))
      assert.ok(
        /^(react|next\/(link|navigation)|lucide-react|@trainer\/(contracts|domain)|\.{1,2}\/)/.test(from),
        `${file} imports ${from}`,
      );
  }
  const motion = await readFile(new URL("motion.tsx", dir), "utf8");
  assert.deepEqual(
    [...motion.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]),
    ["react", "./motion-mode"],
    "motion.tsx imports only react and the marketing motion switch",
  );
  // The reveal observes with IntersectionObserver, checks reduced motion
  // (in "device" mode, motion-mode.ts) and never touches the hero, the page
  // heading or the relay.
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
    const count = [...css.matchAll(/--mk-(?:dur|ease|dist|stagger)-[a-z-]+\s*:/g)].length;
    assert.equal(count, file === "marketing.css" ? Object.keys(TOKENS).length : 0, `${file} defines ${count} motion token(s)`);
  }
  const rules = cssRules(await readFile(web("app/marketing.css"), "utf8"));
  // The player's control buttons press like every other button, and hold
  // still under reduced motion.
  // (Previous and Next at either end are aria-disabled, not disabled, and
  // do not press.)
  const press = rules.find((r) => r.selectors.includes('.mk .mk-walk-btn:active:not([aria-disabled="true"])'));
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

test("the concept pass (22 October 2026): pills, FAQ rows, the arrow hand-offs and the set ticks, each on its own trigger", async () => {
  const css = await readFile(web("app/marketing.css"), "utf8");
  const rules = cssRules(css);
  const find = (selector: string) => rules.find((r) => r.selectors.includes(selector));
  const value = (selector: string, property: string) => find(selector)?.declarations.find((d) => d.property === property)?.value;
  const motion = await readFile(web("components/marketing/motion.tsx"), "utf8");
  const list = (name: string) =>
    motion
      .match(new RegExp(`const ${name} =\\s+"([^"]+)";`))![1]
      .split(",")
      .map((s) => s.trim());
  // The FAQs are a grid (the heading, then each question), and the pills,
  // the FAQs, the closing button and the /features set table have a
  // trigger of their own.
  assert.ok(list("GRIDS").includes(".mk-faqs") && list("GRIDS").includes(".mk-band-pills"));
  assert.deepEqual(list("CUES"), [".mk-band-pills", ".mk-faqs", ".mk-closing-cta", ".mk-sets"]);
  assert.match(motion, /if \(cueSet\.has\(unit\)\) unit\.dataset\.mkCue = state;\s+else unit\.dataset\.mkReveal = state;/);
  assert.match(motion, /\.filter\(\(grid\) => !cueSet\.has\(grid\)\)/, "a unit leaves a cue's items to the cue");
  assert.match(
    motion,
    /\(cue\) => !unitSet\.has\(cue\) && !cue\.closest\(NEVER\) && !\(scenes && cue\.closest\(SCENES\)\)/,
    "a cue never sits in the hero, the relay, the journey or a running scene",
  );
  assert.match(motion, /for \(const unit of \[\.\.\.units, \.\.\.cues\]\) observer\.observe\(unit\);/);
  assert.match(motion, /for \(const cue of cues\) if \(cue\.dataset\.mkCue === "pending"\) mark\(cue, "in"\);/, "printing releases the cues");
  // Every grid in GRIDS has its 40ms steps; the pills and the screens load
  // 80ms apart (the first pill at once, the fourth 240ms later).
  const GRID_LIST = list("GRIDS").join(", ");
  for (const [n, steps] of [[2, "var(--mk-stagger-step)"], [3, "calc(2 * var(--mk-stagger-step))"], ["n + 7", "calc(6 * var(--mk-stagger-step))"]] as const)
    assert.equal(value(`:is(${GRID_LIST}) > :nth-child(${n})`, "--mk-stagger"), steps, `grid item ${n}`);
  assert.equal(value(":is(.mk-screens, .mk-band-pills) > :nth-child(2)", "--mk-stagger"), "var(--mk-stagger-load)");
  assert.equal(value(":is(.mk-screens, .mk-band-pills) > :nth-child(n + 4)", "--mk-stagger"), "calc(3 * var(--mk-stagger-load))");
  // The pills slide in from the inline start (mirrored right to left) on the
  // enter curve; every other item keeps its 8px rise.
  assert.equal(
    value('.mk-motion .mk-band-pills > [data-mk-item="pending"]', "translate"),
    "calc(-1 * var(--mk-dist-load) * var(--inline-sign, 1)) 0",
  );
  assert.equal(
    value('.mk-motion .mk-band-pills > [data-mk-item="in"]', "transition"),
    "opacity var(--mk-dur-slow) var(--mk-ease-out) var(--mk-stagger, 0ms), translate var(--mk-dur-slow) var(--mk-ease-enter) var(--mk-stagger, 0ms)",
  );
  assert.equal(value('.mk-motion [data-mk-item="pending"]', "translate"), "0 var(--mk-dist-item)");
  assert.equal(value('.mk-motion [data-mk-reveal="pending"]', "translate"), "0 var(--mk-dist-rise)");
  // The nudge: one forward step and back, mirrored, never repeated.
  const nudge = rules.filter((r) => r.context.includes("@keyframes mk-nudge"));
  assert.deepEqual(
    nudge.map((r) => [r.selector, r.declarations.map((d) => `${d.property}: ${d.value}`).join("; ")]),
    [["50%", "translate: calc(var(--mk-dist-nudge) * var(--inline-sign, 1)) 0"]],
  );
  const nudges = rules.filter((r) => r.declarations.some((d) => d.property === "animation" && d.value.startsWith("mk-nudge ")));
  assert.deepEqual(nudges.flatMap((r) => r.selectors).sort(), [
    ".mk .mk-hero .mk-cta > .lucide-arrow-right",
    '.mk-motion .mk-closing-cta[data-mk-cue="in"] > .lucide-arrow-right',
  ]);
  // The closing arrow: 280ms after its button comes into view, done by about 700ms.
  assert.equal(
    value('.mk-motion .mk-closing-cta[data-mk-cue="in"] > .lucide-arrow-right', "animation"),
    "mk-nudge var(--mk-dur-emphasis) var(--mk-ease-in-out) 280ms 1",
  );
  // The hero's arrow takes over after the relay's last tick has popped,
  // keyed on .mk-cta (whatever its label), and ends well inside the 4.5 s
  // the brand check allows the home page's first-screen motion.
  const seconds = (t: string) => (t.endsWith("ms") ? Number(t.slice(0, -2)) / 1000 : Number(t.slice(0, -1)));
  const hero = value(".mk .mk-hero .mk-cta > .lucide-arrow-right", "animation")!;
  assert.match(hero, /^mk-nudge var\(--mk-dur-emphasis\) var\(--mk-ease-in-out\) ([\d.]+m?s) 1$/);
  const heroDelay = seconds(hero.split(" ")[3]);
  const lastTick = seconds(value(".mk-relay-rows li:nth-child(3) svg", "animation-delay")!) + MOTION.slow / 1000;
  assert.ok(heroDelay >= lastTick, `the hand-off (${heroDelay}s) follows the relay's last tick (${lastTick}s)`);
  assert.ok(heroDelay + MOTION.emphasis / 1000 <= 3, `the hand-off ends by 3 s (${heroDelay + MOTION.emphasis / 1000}s)`);
  // The /features set ticks pop one after another, 80ms apart from 520ms,
  // on the set table's own trigger (its section is too tall to wait on a
  // phone); the other screen ticks keep their section's reveal.
  const TICKS = "opacity var(--mk-dur-fast) var(--mk-ease-out) calc(520ms + var(--mk-set-step, 0ms)), scale var(--mk-dur-slow) var(--mk-ease-spring) calc(520ms + var(--mk-set-step, 0ms))";
  assert.equal(value('.mk-motion .mk-sets[data-mk-cue="in"] svg', "transition"), TICKS);
  assert.equal(value('.mk-motion [data-mk-reveal="in"] :is(.mk-screen-note svg, .mk-queue-item.done .badge svg)', "transition"), TICKS);
  assert.equal(value('.mk-motion .mk-sets[data-mk-cue="pending"] svg', "opacity"), "0");
  assert.equal(value('.mk-motion .mk-sets[data-mk-cue="pending"] svg', "scale"), "0.4");
  assert.ok(
    !rules.some((r) => r.selectors.some((s) => s.includes("[data-mk-reveal") && s.includes(".mk-sets"))),
    "the set ticks never wait for their section's reveal as well",
  );
  assert.equal(value(".mk-sets tr:nth-child(2)", "--mk-set-step"), "var(--mk-stagger-load)");
  assert.equal(value(".mk-sets tr:nth-child(n + 3)", "--mk-set-step"), "calc(2 * var(--mk-stagger-load))");
  // 520ms is after the screens' own rise and their longest load stagger.
  assert.ok(520 >= MOTION.slow + MAX_STAGGER, "a tick never pops before its screen has landed");
  // In "device" mode reduced motion still stops all of it: the arrows are
  // held in place and no item waits (the reduced-motion block), and the
  // script never runs.
  const G = MOTION_ALWAYS_EXCLUDED;
  const reduced = rules.filter((r) => r.context.some((c) => c.includes("prefers-reduced-motion: reduce")));
  assert.ok(reduced.some((r) => r.selector.includes(".lucide-arrow-right") && r.selector.includes(G) && r.declarations.some((d) => d.property === "translate" && d.important)));
  assert.ok(reduced.some((r) => r.selectors.includes(`.mk-motion${G} [data-mk-item="pending"]`)));
  const release = reduced.find((r) => r.selectors.includes(`.mk-motion${G} .mk-sets[data-mk-cue="pending"] svg`));
  assert.ok(
    release && ["opacity", "scale"].every((p) => release.declarations.some((d) => d.property === p && d.important)),
    "the set ticks never wait under reduced motion in device mode",
  );
});

test("the home page's first paint waits for the whole hero (CLS 0 when the parser yields mid-hero)", async () => {
  // A render-blocking rel=expect on an empty marker that closes the hero
  // keeps the first paint whole: the H1, the field's first frame, the lede
  // and the calls to action arrive together (the earlier relay hero moved
  // 0.0022 at 1366x900 when a paint fell between its buttons and the line
  // under them, 22 October 2026).
  const home = await readFile(web("components/marketing/pages/home.tsx"), "utf8");
  const hero = home.match(/<section className="mk-hero mk-hm-hero" aria-labelledby="mk-hero-h">[\s\S]*?<\/section>/)![0];
  assert.match(hero, /<link rel="expect" href="#mk-hero-end" blocking="render" \/>/);
  assert.ok(hero.indexOf('<link rel="expect"') < hero.indexOf('className="eyebrow"'), "the link comes before the copy");
  // The marker is the hero's last child, always rendered.
  assert.match(hero, /<span id="mk-hero-end" hidden \/>\s+<\/section>$/);
  // Only the home hero blocks the first paint, across the renderers
  // (site.tsx's legacy Home, which no path reaches since BESPOKE["/"], goes
  // with the phase 1 clean-up).
  const site = await readFile(web("components/marketing/site.tsx"), "utf8");
  assert.match(site, /"\/": \(c\) => <HomePage \{\.\.\.c\} \/>/);
  const pages = await Promise.all(
    (await readdir(web("components/marketing/pages")))
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => readFile(web("components/marketing/pages/" + file), "utf8")),
  );
  const live = site.replace(/\nfunction Home\(\{[\s\S]*?\n\}\n/, "\n");
  assert.equal([live, ...pages].join("\n").match(/rel="expect"/g)?.length, 1, "only the home hero blocks the first paint");
});

test('the Pace sweep behind "trains": once at load, from the left, scale only, and at rest the fill the span had', async () => {
  const rules = cssRules(await readFile(web("app/marketing.css"), "utf8"));
  const top = (selector: string) => rules.find((r) => !r.context.length && r.selectors.includes(selector));
  const value = (selector: string, property: string) => top(selector)?.declarations.find((d) => d.property === property)?.value;
  // The span: its own stacking context (with z-index -1 alone the fill
  // would paint under the hero's background), ink, its fragments cloned,
  // and no background of its own: the fill is its ::before.
  assert.equal(value(".mk-mark", "position"), "relative");
  assert.equal(value(".mk-mark", "isolation"), "isolate");
  assert.equal(value(".mk-mark", "color"), "var(--on-lime)");
  assert.equal(value(".mk-mark", "box-decoration-break"), "clone");
  assert.equal(value(".mk-mark", "background-color"), undefined);
  assert.equal(value(".mk-mark", "background"), undefined);
  for (const [property, expected] of [
    ["content", '""'],
    ["position", "absolute"],
    ["inset", "0"],
    ["z-index", "-1"],
    ["border-radius", "inherit"],
    ["background-color", "var(--lime)"],
  ])
    assert.equal(value(".mk-mark::before", property), expected, `.mk-mark::before ${property}`);
  // The sweep: the home hero's mark only, once, 120ms in, on the enter
  // curve, from a fixed left edge (the H1 stays English under ?lang=ar, so
  // it does not follow --inline-sign), and only `scale` moves.
  assert.equal(value(".mk .mk-hero .mk-mark::before", "transform-origin"), "0 50%");
  assert.equal(value(".mk .mk-hero .mk-mark::before", "animation"), "mk-sweep var(--mk-dur-emphasis) var(--mk-ease-enter) 120ms 1 backwards");
  assert.deepEqual(
    rules.filter((r) => r.context.includes("@keyframes mk-sweep")).map((r) => [r.selector, r.declarations.map((d) => `${d.property}: ${d.value}`)]),
    [["from", ["scale: 0 1"]]],
  );
  assert.deepEqual(
    rules.filter((r) => r.declarations.some((d) => /^animation/.test(d.property) && d.value.includes("mk-sweep"))).map((r) => r.selector),
    [".mk .mk-hero .mk-mark::before"],
  );
  // Colour changes stay instant: nothing transitions or animates the mark's colour.
  for (const rule of rules.filter((r) => r.selector.includes(".mk-mark")))
    for (const d of rule.declarations)
      if (/^(transition|animation)/.test(d.property)) assert.doesNotMatch(d.value, /color|background/, `${rule.selector} ${d.property}`);
});

test("the phone menu: a native details that animates in and out and closes on Escape, a tap outside or a link", async () => {
  const frame = await readFile(web("components/marketing/frame.tsx"), "utf8");
  const menu = await readFile(web("components/marketing/mobile-menu.tsx"), "utf8");
  const css = await readFile(web("app/marketing.css"), "utf8");
  // Without JavaScript it is still a <details> with a "Menu" summary.
  assert.match(menu, /^"use client";/);
  assert.match(menu, /<details className="mk-mobile-menu" ref=\{ref\}>/);
  assert.match(frame, /<MobileMenu>\s*<summary>\s*<span>Menu<\/span>/);
  // Every row carries its own stagger, buttons last; the rows rise in.
  assert.match(frame, /className="mk-mobile-actions mk-mobile-row" style=\{rise\(\)\}/);
  assert.match(css, /\.mk-mobile-menu\[open\] \.mk-mobile-row \{\s*animation: mk-rise-short var\(--mk-dur-base\) var\(--mk-ease-out\) var\(--mk-stagger, 0ms\) both;/);
  // The exit runs on --mk-dur-fast; the script keeps the menu open at least that long.
  assert.match(css, /\.mk-mobile-menu\[data-closing\] > \.mk-mobile-panel \{\s*animation: mk-menu-out var\(--mk-dur-fast\)/);
  const fast = Number(TOKENS["--mk-dur-fast"].replace("ms", ""));
  const exit = Number(menu.match(/const EXIT_MS = (\d+);/)?.[1]);
  assert.ok(exit >= fast && exit <= fast + 40, `EXIT_MS ${exit} follows --mk-dur-fast ${fast}`);
  // Escape, a tap outside and a link close it; reduced motion (outside
  // "always") closes at once; the page behind stops scrolling while open.
  assert.match(menu, /event\.key === "Escape"/);
  assert.match(menu, /\.mk-mobile-panel a/);
  assert.match(menu, /prefers-reduced-motion: reduce/);
  assert.match(menu, /data-mk-motion="always"/);
  assert.match(css, /html\.mk-menu-open \{\s*overflow: hidden;\s*scrollbar-gutter: stable;/);
  // The dimmed page covers the viewport: the header's blur (which would make
  // the header the fixed overlay's containing block) pauses while open.
  assert.match(css, /\.mk-header \{[^}]*backdrop-filter: blur/);
  assert.match(css, /\.mk-header:has\(\.mk-mobile-menu\[open\]\) \{\s*backdrop-filter: none;/);
  // Kamran's button does not cover the pinned buttons.
  assert.match(css, /:root:has\(\.mk-header \.mk-mobile-menu\[open\]\) \.mk-assistant-fab \{\s*visibility: hidden;/);
  // Past the breakpoint the menu closes, and the lock applies only below it.
  const breakpoint = menu.match(/const SHOWS = "\((max-width: \d+px)\)";/)?.[1];
  assert.ok(breakpoint && css.includes(`@media (${breakpoint}) {\n  .mk-nav,`), `menu breakpoint ${breakpoint} matches the CSS`);
  assert.match(css, new RegExp(`@media \\(${breakpoint}\\) \\{\\s*html\\.mk-menu-open \\{`));
  assert.match(menu, /if \(!shows\.matches && menu\.open\) finish\(\);/);
});

