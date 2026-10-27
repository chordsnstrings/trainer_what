// Helpers shared by the marketing and stylesheet tests. They live here, not
// in a *.test.ts file, because importing a test file registers its tests
// again (the same reason as tests/programme-fixtures.ts):
// - cssRules: a stylesheet as rules with their at-rule context
//   (tests/marketing-motion-sitewide.test.ts);
// - the WCAG contrast maths over design tokens (tests/brand.test.ts);
// - physicalRule: why a declaration would not mirror right to left
//   (tests/logical-css.test.ts);
// - MODEL_OR_VENDOR: model and vendor names (tests/model-name-guard.test.ts);
// - PLACEHOLDER and C0_BANNED: prototype placeholders and the replaced
//   vocabulary, which the phase 1 pages, their registry entries and the
//   Brain traces must not contain.
import assert from "node:assert/strict";

export type Declaration = { property: string; value: string; important: boolean };
export type Rule = {
  selector: string;
  selectors: string[];
  declarations: Declaration[];
  /** Enclosing at-rule preludes, outermost first. */
  context: string[];
  line: number;
};

/** Splits on a separator at the top level (outside parentheses, brackets and strings). */
export function splitTop(text: string, separator: string): string[] {
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

// Minimal colour maths for the token checks (WCAG 2.x relative luminance).
export type Rgb = [number, number, number];
export const hex = (h: string): Rgb => {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgb;
};
export const luminance = ([r, g, b]: Rgb) => {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
export function declarations(block: string) {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
export function resolver(...layers: Record<string, string>[]) {
  const merged = Object.assign({}, ...layers);
  const resolve = (value: string, depth = 0): Rgb => {
    assert.ok(depth < 10, "token cycle: " + value);
    const v = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return hex(v);
    const ref = v.match(/^var\((--[\w-]+)\)$/);
    if (ref) return resolve(merged[ref[1]], depth + 1);
    const mix = v.match(/^color-mix\(in srgb, (var\(--[\w-]+\)) (\d+)%, (var\(--[\w-]+\))\)$/);
    if (mix) {
      const [a, share, b] = [resolve(mix[1], depth + 1), Number(mix[2]) / 100, resolve(mix[3], depth + 1)];
      return a.map((c, i) => Math.round(c * share + b[i] * (1 - share))) as Rgb;
    }
    throw new Error("unresolvable token value " + v);
  };
  return (name: string) => resolve(`var(${name})`);
}

// Right to left: physical left/right forms that would not mirror.
const PHYSICAL_PROPERTY =
  /^(?:(?:margin|padding|scroll-margin|scroll-padding)-(?:left|right)|border-(?:left|right)(?:-(?:width|style|color))?|border-(?:top|bottom)-(?:left|right)-radius|left|right)$/;
const SIDE_VALUE_PROPERTIES = new Set([
  "text-align",
  "text-align-last",
  "float",
  "clear",
  "justify-content",
  "justify-items",
  "justify-self",
  "background-position",
  "background-position-x",
  "object-position",
  "transform-origin",
  "perspective-origin",
  "mask-position",
  "-webkit-mask-position",
  "caption-side",
  // Shorthands that carry a position (`background: url(x) right 8px center`).
  "background",
  "mask",
  "-webkit-mask",
  "border-image",
]);
const FOUR_SIDE_SHORTHANDS = new Set([
  "margin",
  "padding",
  "inset",
  "border-width",
  "border-style",
  "border-color",
  "scroll-margin",
  "scroll-padding",
]);

/** Splits a value on top-level whitespace (not inside parentheses). */
function tokens(value: string) {
  const out: string[] = [];
  let depth = 0,
    current = "";
  for (const ch of value.trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = "";
    } else current += ch;
  }
  if (current) out.push(current);
  return out.filter((t) => t !== "!important");
}
/** The argument lists of every call to `name(` in a value. */
function calls(value: string, name: RegExp) {
  const out: string[] = [];
  const re = new RegExp(name.source + "\\(", "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    let depth = 1,
      i = match.index + match[0].length;
    const start = i;
    for (; i < value.length && depth; i++) {
      if (value[i] === "(") depth++;
      if (value[i] === ")") depth--;
    }
    out.push(value.slice(start, i - 1));
  }
  return out;
}
function isZero(v: string) {
  return /^-?0(?:\.0+)?(?:[a-z%]+)?$/i.test(v.trim());
}
function signed(v: string) {
  return v.includes("--inline-sign");
}
/** Why a CSS declaration would not mirror in right to left, or null. */
export function physicalRule(property: string, value: string): string | null {
  const prop = property.trim().toLowerCase(),
    val = value.trim().toLowerCase();
  if (prop.startsWith("--")) return null;
  if (PHYSICAL_PROPERTY.test(prop))
    return "physical property: use the inline-start/end form";
  // Addresses and quoted strings are not positions (`url(arrow-right.svg)`).
  const positions = val
    .replace(/url\([^)]*\)/g, "url()")
    .replace(/"[^"]*"|'[^']*'/g, '""');
  if (
    SIDE_VALUE_PROPERTIES.has(prop) &&
    /(^|[^a-z0-9-])(left|right)($|[^a-z0-9-])/.test(positions)
  )
    return "physical value: use start/end or a logical form";
  if (/gradient\(\s*to\s+(left|right)\b/.test(val))
    return "physical gradient direction";
  if (FOUR_SIDE_SHORTHANDS.has(prop)) {
    const t = tokens(val);
    if (t.length === 4 && t[1] !== t[3])
      return "asymmetric four-value shorthand: use -block and -inline";
  }
  if (prop === "border-radius") {
    for (const part of val.split("/")) {
      const t = tokens(part);
      if (
        (t.length === 2 && t[0] !== t[1]) ||
        (t.length === 3 && !(t[0] === t[1] && t[1] === t[2])) ||
        (t.length === 4 && !(t[0] === t[1] && t[2] === t[3]))
      )
        return "asymmetric corner radii: use border-start-start-radius etc.";
    }
  }
  if (prop === "transform" || prop === "translate" || prop === "scale") {
    const args = (re: RegExp) => calls(val, re).map((a) => a.split(","));
    const xs = [
      ...calls(val, /translatex/),
      ...args(/translate(?!x|y|z|3d)/).map((a) => a[0]),
      ...args(/translate3d/).map((a) => a[0]),
      // matrix(a, b, c, d, tx, ty) and matrix3d(..., tx at index 12, ...)
      ...args(/(?<![a-z0-9])matrix(?!3d)/).map((a) => a[4] ?? "0"),
      ...args(/matrix3d/).map((a) => a[12] ?? "0"),
      ...(prop === "translate" ? [tokens(val)[0] ?? "0"] : []),
    ];
    if (xs.some((x) => !isZero(x) && !signed(x)))
      return "horizontal translation: multiply by var(--inline-sign)";
    const flips = [
      ...calls(val, /scalex/),
      ...args(/(?<![a-z0-9])scale(?!x|y|z|3d)/).map((a) => a[0]),
      ...args(/scale3d/).map((a) => a[0]),
      ...args(/(?<![a-z0-9])matrix(?!3d)/).map((a) => a[0]),
      ...args(/matrix3d/).map((a) => a[0]),
      ...(prop === "scale" ? [tokens(val)[0] ?? "1"] : []),
    ];
    if (flips.some((x) => x.trim().startsWith("-") && !signed(x)))
      return "horizontal flip: use var(--inline-sign)";
  }
  return null;
}

/** Model, vendor and hosting-platform names (case-insensitive, whole words). */
export const MODEL_OR_VENDOR =
  /\b(?:seed[\s-]*2(?:\.0)?|seed[\s-]*pro|bytedance|byteplus|modelark|volcengine|doubao|openai|chatgpt|gpt(?:-?\d[\w.]*)?|anthropic|claude|opus|sonnet|haiku|gemini|deepseek|qwen|llama|mistral|grok)\b/i;

/**
 * Owner-decision placeholders from the prototypes ("[rate: owner to state]",
 * "[Portability wording: owner to confirm.]", "decision 3"), which must
 * never ship (docs/marketing-revamp-2026-10-26/phase1/PLAN.md §1.6).
 */
export const PLACEHOLDER = /\[(rate|owner)[^\]]*\]|owner to (state|confirm|supply)|decision \d/i;

/**
 * The C0 vocabulary (PLAYBOOK.md C0 "Copy rules"): terms replaced on the
 * redesigned marketing pages, each with what to write instead. "floor"
 * covers "safety floor" and "the floor".
 */
export const C0_BANNED: ReadonlyArray<{ term: RegExp; instead: string }> = [
  { term: /held-out/i, instead: "your test cases" },
  { term: /marginal bands?/i, instead: "our share for each group of subscribers" },
  { term: /confidence threshold/i, instead: "how sure it must be" },
  { term: /\bfloor\b/i, instead: "safety rules it can't switch off" },
];
