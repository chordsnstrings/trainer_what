// Motion rules for subscriber stylesheets (docs/features/motion.md):
// - every animation and transition uses the motion tokens (no raw times or
//   curves), sits inside @media (prefers-reduced-motion: no-preference) and
//   is stopped by the member's own "Reduce motion" rule;
// - nothing transitions or animates width, height, top, left or margin (only
//   transform, opacity, stroke-dashoffset and grid-template-rows move);
// - every @keyframes used exists and moves only those properties;
// - hover effects live inside @media (hover: hover); no will-change;
// - every horizontal movement mirrors right to left, and the screen
//   transitions run the opposite way in Arabic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/** Stylesheets that style subscriber surfaces (the member app, the coach
 * website, joining, sign-in, legal and account pages). The trainer
 * workspace's and the marketing site's own sheets keep their own motion. */
export const SUBSCRIBER_CSS = [
  "motion.css",
  "phone-first.css",
  "subscriber-public.css",
  "coach-site.css",
  "coach-directory.css",
  "joining.css",
  "pwa.css",
  "analytics-consent.css",
  "appearance.css",
  "account-settings.css",
  "programme.css",
  "voice-session.css",
  "nutrition.css",
  "meal-capture.css",
];
const css = (name: string) =>
  readFile(new URL(`../apps/web/app/${name}`, import.meta.url), "utf8");

type Decl = { prop: string; value: string; line: number };
type Rule = { selector: string; decls: Decl[]; context: string[] };
type Keyframes = { name: string; props: string[]; values: string[] };

/** A small CSS reader: rules with their at-rule context, and @keyframes. */
export function readCss(source: string) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const rules: Rule[] = [];
  const keyframes: Keyframes[] = [];
  const lineAt = (i: number) => text.slice(0, i).split("\n").length;
  function block(start: number, context: string[]): number {
    let i = start,
      buffer = "",
      bufferStart = start;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "{") {
        const prelude = buffer.trim();
        if (prelude.startsWith("@keyframes")) {
          const end = matching(i);
          const body = text.slice(i + 1, end);
          const decls = [...body.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)];
          keyframes.push({
            name: prelude.split(/\s+/)[1],
            props: decls.map((d) => d[1]),
            values: decls.map((d) => d[2].trim()),
          });
          i = end + 1;
        } else if (prelude.startsWith("@")) {
          i = block(i + 1, [...context, prelude]);
        } else {
          const end = matching(i);
          const body = text.slice(i + 1, end);
          const decls: Decl[] = [];
          let offset = i + 1;
          for (const part of body.split(";")) {
            const colon = part.indexOf(":");
            if (colon > 0) {
              const prop = part.slice(0, colon).trim();
              if (/^-?-?[a-z-]+$/.test(prop))
                decls.push({
                  prop,
                  value: part.slice(colon + 1).trim(),
                  line: lineAt(offset + part.search(/\S/)),
                });
            }
            offset += part.length + 1;
          }
          rules.push({ selector: prelude, decls, context });
          i = end + 1;
        }
        buffer = "";
        bufferStart = i;
        continue;
      }
      if (ch === "}") return i + 1;
      if (ch === ";" && buffer.trim().startsWith("@")) {
        buffer = "";
        i++;
        continue;
      }
      buffer += ch;
      i++;
    }
    void bufferStart;
    return i;
  }
  function matching(open: number) {
    let depth = 0;
    for (let j = open; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}" && --depth === 0) return j;
    }
    return text.length;
  }
  block(0, []);
  return { rules, keyframes };
}

const MOTION_PROP = /^(transition|animation)(-[a-z-]+)?$/;
const ALLOWED = new Set([
  "transform",
  "translate",
  "scale",
  "rotate",
  "opacity",
  "stroke-dashoffset",
  "grid-template-rows",
  // A closing disclosure stays visible until its height has closed.
  "content-visibility",
]);
const FORBIDDEN = /^(width|height|inline-size|block-size|top|left|right|bottom|inset|margin|padding|all)(-|$)/;
const noPreference = (context: string[]) =>
  context.some((c) => /prefers-reduced-motion:\s*no-preference/.test(c));

test("motion lives in motion.css; the other subscriber sheets hold none", async () => {
  for (const name of SUBSCRIBER_CSS.filter((n) => n !== "motion.css")) {
    const { rules, keyframes } = readCss(await css(name));
    const moving = rules.flatMap((r) =>
      r.decls
        .filter((d) => MOTION_PROP.test(d.prop) && d.value !== "none")
        .map((d) => `${name}:${d.line} ${r.selector} { ${d.prop}: ${d.value} }`),
    );
    assert.deepEqual(moving, [], name);
    assert.deepEqual(keyframes.map((k) => k.name), [], `${name} @keyframes`);
  }
});

test("every animation and transition uses the tokens and stays inside the no-preference query", async () => {
  const { rules, keyframes } = readCss(await css("motion.css"));
  const defined = new Set(keyframes.map((k) => k.name));
  const problems: string[] = [];
  let checked = 0;
  for (const rule of rules)
    for (const d of rule.decls) {
      if (!MOTION_PROP.test(d.prop)) continue;
      const where = `motion.css:${d.line} ${rule.selector.replace(/\s+/g, " ").slice(0, 60)} { ${d.prop} }`;
      if (d.value.replace(/\s*!important/, "") === "none") {
        // Only the reduced-motion rules switch motion off.
        if (!/data-reduce-motion|view-transition/.test(rule.selector) && !rule.context.some((c) => /reduce\)/.test(c)))
          problems.push(`${where}: "none" outside the reduced-motion rules`);
        continue;
      }
      checked++;
      if (!noPreference(rule.context))
        problems.push(`${where}: outside @media (prefers-reduced-motion: no-preference)`);
      // Times: tokens only.
      const times = d.value.match(/(?<![\w-])\d*\.?\d+m?s\b/g) ?? [];
      if (times.length) problems.push(`${where}: raw time ${times.join(", ")}`);
      if (/(^|[\s,])(ease|ease-in|ease-out|ease-in-out|step-start|step-end)(?=[\s,]|$)|cubic-bezier\(/.test(d.value))
        problems.push(`${where}: raw easing (use var(--ease-*) or linear)`);
      if (/(animation|transition)(-duration|-delay)?$/.test(d.prop) && d.prop !== "transition-property" && d.prop !== "animation-name") {
        const vars = d.value.match(/var\(--([a-z-]+)/g) ?? [];
        for (const v of vars)
          if (!/--(motion-|ease-)/.test(v)) problems.push(`${where}: ${v} is not a motion token`);
        if (!/var\(--motion-/.test(d.value) && d.prop !== "animation-name")
          problems.push(`${where}: no duration token`);
      }
      if (d.prop === "transition" || d.prop === "transition-property") {
        for (const part of d.value.split(",")) {
          const prop = part.trim().split(/\s+/)[0];
          if (FORBIDDEN.test(prop) || !ALLOWED.has(prop))
            problems.push(`${where}: transitions ${prop}`);
        }
      }
      if (d.prop === "animation" || d.prop === "animation-name") {
        for (const part of d.value.split(",")) {
          const name = part
            .trim()
            .split(/\s+/)
            .find((w) => /^motion-[a-z-]+$/.test(w));
          if (!name) problems.push(`${where}: no motion-* keyframes named`);
          else if (!defined.has(name)) problems.push(`${where}: @keyframes ${name} missing`);
          if (/\binfinite\b/.test(part) && !/motion-(shimmer|refresh|typing|breathe)\b/.test(part))
            problems.push(`${where}: only live states may loop`);
        }
      }
    }
  assert.deepEqual(problems, []);
  assert.ok(checked > 40, `${checked} motion declarations checked`);
});

test("keyframes move only transform, opacity and stroke-dashoffset", async () => {
  const { keyframes } = readCss(await css("motion.css"));
  assert.ok(keyframes.length >= 20);
  for (const k of keyframes) {
    assert.match(k.name, /^motion-/);
    for (const prop of k.props)
      assert.ok(
        ["transform", "opacity", "stroke-dashoffset"].includes(prop),
        `@keyframes ${k.name} animates ${prop}`,
      );
  }
});

test("the member's Reduce motion choice and the device setting stop everything", async () => {
  const text = await css("motion.css");
  const { rules } = readCss(text);
  const off = rules.find((r) => r.selector.includes(':root[data-reduce-motion="on"] *,'));
  assert.ok(off, "the in-app reduce rule");
  for (const target of ["*", "*::before", "*::after", "*::backdrop"])
    assert.ok(off.selector.includes(`:root[data-reduce-motion="on"] ${target}`), target);
  assert.deepEqual(
    off.decls.map((d) => `${d.prop}: ${d.value}`),
    ["animation: none !important", "transition: none !important", "scroll-behavior: auto !important"],
  );
  // View Transitions too, both ways.
  const vt = rules.filter((r) => /::view-transition-(group|old|new)\(\*\)/.test(r.selector) && r.decls.some((d) => d.value === "none !important"));
  assert.ok(vt.some((r) => r.selector.includes("data-reduce-motion")));
  assert.ok(vt.some((r) => r.context.some((c) => /prefers-reduced-motion: reduce/.test(c))));
});

test("hover effects only on hover devices; no will-change; taps pass through transitions", async () => {
  const { rules } = readCss(await css("motion.css"));
  for (const rule of rules.filter((r) => /:hover/.test(r.selector)))
    if (rule.decls.some((d) => d.prop === "transform" && d.value !== "none"))
      assert.ok(
        rule.context.some((c) => /\(hover: hover\)/.test(c)),
        `${rule.selector} lifts outside @media (hover: hover)`,
      );
  for (const name of SUBSCRIBER_CSS)
    assert.doesNotMatch(await css(name), /will-change/, name);
  assert.ok(
    rules.some((r) => r.selector.trim() === "::view-transition" && r.decls.some((d) => d.prop === "pointer-events" && d.value === "none")),
  );
});

/**
 * The horizontal distance a translate moves for a direction sign, from a
 * keyframe or rule value (0 when it has none).
 */
function horizontal(value: string, sign: 1 | -1, shift = 0) {
  const m = value.match(/translateX\((.+)\)\s*$/) ?? value.match(/^translateX\((.+)\)/);
  if (!m) return 0;
  const expr = m[1]
    .replace(/var\(--inline-sign,\s*1\)/g, String(sign))
    .replace(/var\(--motion-shift,\s*0px\)/g, `${shift}px`)
    .replace(/var\(--motion-title-shift,\s*0px\)/g, `${shift}px`)
    .replace(/var\(--motion-distance-xs\)/g, "4px")
    .replace(/var\(--motion-distance-sm\)/g, "8px")
    .replace(/var\(--motion-distance-md\)/g, "16px")
    .replace(/calc/g, "")
    .replace(/(-?\d*\.?\d+)px/g, "$1")
    .replace(/(-?\d*\.?\d+)%/g, "$1");
  // eslint-disable-next-line no-new-func
  return Number(Function(`return (${expr});`)());
}

test("every horizontal movement mirrors right to left", async () => {
  const text = await css("motion.css");
  const { rules, keyframes } = readCss(text);
  const moves: string[] = [];
  for (const k of keyframes)
    k.values.forEach((v, i) => {
      if (k.props[i] === "transform" && /translateX\(/.test(v)) {
        moves.push(k.name);
        const ltr = horizontal(v, 1, 16),
          rtl = horizontal(v, -1, 16);
        assert.ok(ltr !== 0, `${k.name} moves`);
        assert.equal(rtl, -ltr, `${k.name}: ${v} does not mirror`);
      }
    });
  for (const rule of rules)
    for (const d of rule.decls) {
      if (d.prop === "translate" && !/^0\b|none/.test(d.value))
        assert.match(d.value, /--inline-sign/, `${rule.selector} translate`);
      if (d.prop === "transform" && /translateX/.test(d.value))
        assert.match(d.value, /--inline-sign/, `${rule.selector} transform`);
    }
  assert.ok(moves.includes("motion-slide-in") && moves.includes("motion-title-in"));
});

test("screen transitions: forward comes from the inline end, back reverses, both mirror in Arabic", async () => {
  const { rules, keyframes } = readCss(await css("motion.css"));
  const slideIn = keyframes.find((k) => k.name === "motion-slide-in")!;
  const value = slideIn.values[slideIn.props.indexOf("transform")];
  /** Where the new page starts (px, + is to the right) for a direction. */
  const start = (kind: "nav-forward" | "nav-back", sign: 1 | -1) => {
    const rule = rules.find((r) =>
      r.selector.includes(`:root[data-vt="${kind}"]::view-transition-new(.member-page)`),
    )!;
    const shift = rule.decls.find((d) => d.prop === "--motion-shift")!.value;
    const px = horizontal(`translateX(${shift})`, 1);
    assert.match(rule.decls.find((d) => d.prop === "animation")!.value, /^motion-slide-in /);
    return horizontal(value, sign, px);
  };
  // Left to right: a sub-page comes in from the right; back from the left.
  assert.equal(start("nav-forward", 1), 16);
  assert.equal(start("nav-back", 1), -16);
  // Right to left: mirrored.
  assert.equal(start("nav-forward", -1), -16);
  assert.equal(start("nav-back", -1), 16);
  // The page left behind moves the other way, faster than the new one comes.
  const old = (kind: string) =>
    rules.find((r) => r.selector.includes(`:root[data-vt="${kind}"]::view-transition-old(.member-page)`))!;
  assert.match(old("nav-forward").decls.find((d) => d.prop === "--motion-shift")!.value, /\* -1\)/);
  assert.match(old("nav-forward").decls.find((d) => d.prop === "animation")!.value, /motion-slide-out var\(--motion-fast\)/);
  // Tabs crossfade (opacity only).
  const tabOld = rules.find((r) => r.selector.trim() === "::view-transition-old(.member-page)")!;
  assert.match(tabOld.decls[0].value, /^motion-fade-out var\(--motion-fast\)/);
  // The frame stays still during navigation.
  assert.ok(
    rules.some(
      (r) =>
        r.selector.includes(':root[data-vt^="nav-"]::view-transition-group(member-tabbar)') &&
        r.decls.some((d) => d.prop === "animation" && d.value === "none"),
    ),
  );
  // ...and never goes blank. React names the entering page after the bars
  // were captured, so without a z-index its opaque snapshot paints over the
  // bars while it fades in (seen frame by frame in motion-check.mjs). The
  // bars' groups sit above the page, the live new bar shows, and the old
  // picture is hidden only while a new one is there (:only-child keeps it).
  for (const name of ["member-topbar", "member-tabbar", "member-sidenav", "member-action-bar", "member-consent"]) {
    const on = (pseudo: string) =>
      rules.filter((r) =>
        r.selector
          .split(",")
          .some((part) => part.trim() === `:root[data-vt^="nav-"]::view-transition-${pseudo}`),
      );
    const decl = (pseudo: string, prop: string) =>
      on(pseudo).flatMap((r) => r.decls.filter((d) => d.prop === prop).map((d) => d.value));
    assert.deepEqual(decl(`group(${name})`, "z-index"), ["1"], `${name}: above the page`);
    assert.ok(decl(`group(${name})`, "animation").includes("none"), `${name}: held still`);
    assert.ok(decl(`new(${name})`, "animation").includes("none"), `${name}: new bar not faded`);
    assert.ok(decl(`old(${name})`, "opacity").includes("0"), `${name}: no ghost behind the new bar`);
    assert.ok(decl(`old(${name}):only-child`, "opacity").includes("1"), `${name}: a bar only the old page had stays until it fades`);
    assert.match(decl(`old(${name}):only-child`, "animation")[0] ?? "", /^motion-fade-out /);
    assert.match(decl(`new(${name}):only-child`, "animation")[0] ?? "", /^motion-fade-in /);
    for (const pseudo of [`old(${name})`, `new(${name})`, `group(${name})`])
      assert.deepEqual(decl(pseudo, "display"), [], `${name}: never display:none`);
  }
  // The analytics bar (root layout, outside the page) has a name of its own.
  assert.ok(
    rules.some(
      (r) =>
        r.selector.trim() === '.consent-bar[data-audience="people"]' &&
        r.decls.some((d) => d.prop === "view-transition-name" && d.value === "member-consent"),
    ),
  );
});
