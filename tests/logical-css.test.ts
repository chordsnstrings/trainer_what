// Right-to-left readiness guard: apps/web styles use logical properties.
//
// Fails when a stylesheet under apps/web, or an inline style object in an
// apps/web component, uses a physical left/right property or value that would
// not mirror in a right-to-left (Arabic) layout. A justified exception goes in
// ALLOWED below with its reason; an entry that no longer matches fails too, so
// the list stays current.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const require = createRequire(import.meta.url);
// Babel's parser as bundled by the pinned Next.js (no new dependency).
const { parse } = require("next/dist/compiled/babel/parser") as {
  parse: (code: string, options: object) => any;
};
const root = fileURLToPath(new URL("../", import.meta.url));
const webRoot = join(root, "apps/web");

type Finding = {
  file: string;
  line: number;
  declaration: string;
  rule: string;
};
/** Justified physical declarations: `file` relative to the repository root. */
const ALLOWED: Array<{ file: string; declaration: string; reason: string }> =
  [
    {
      file: "apps/web/app/marketing.css",
      declaration: "translate: 40px 0",
      reason:
        "The home relay's decorative dot travels along its wire inside .mk-relay-wire, an SVG that already mirrors with scale: var(--inline-sign) 1, so the dot's own offset must stay positive in both directions.",
    },
  ];

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

/** Declarations of a stylesheet with 1-based line numbers. */
export function cssDeclarations(source: string) {
  // Blank comments while keeping offsets (and so line numbers).
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, " "),
  );
  const out: Array<{ property: string; value: string; line: number }> = [];
  const breaks: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") breaks.push(i);
  const lineAt = (offset: number) => {
    let lo = 0,
      hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  const block = /\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  const seen = new Set<number>();
  // Innermost blocks hold declarations; repeat until nested rules are read.
  let pending = text;
  for (let pass = 0; pass < 4; pass++) {
    block.lastIndex = 0;
    let next = pending;
    while ((match = block.exec(pending))) {
      const start = match.index + 1;
      if (!seen.has(start)) {
        seen.add(start);
        let offset = start;
        for (const raw of match[1].split(";")) {
          const colon = raw.indexOf(":");
          if (colon > 0) {
            const lead = raw.length - raw.trimStart().length;
            out.push({
              property: raw.slice(0, colon).trim(),
              value: raw.slice(colon + 1).trim(),
              line: lineAt(offset + lead),
            });
          }
          offset += raw.length + 1;
        }
      }
      // Replace the read block with same-length filler so outer blocks
      // become innermost on the next pass.
      next =
        next.slice(0, match.index) +
        " ".repeat(match[0].length) +
        next.slice(match.index + match[0].length);
    }
    if (next === pending) break;
    pending = next;
  }
  return out;
}

const CSS_PROPERTY = (key: string) =>
  key.startsWith("--")
    ? key
    : key
        .replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())
        .replace(/^ms-/, "-ms-");

/** Inline style objects in a TSX module: `style={{…}}`, style identifiers and CSSProperties objects. */
export function inlineStyleDeclarations(source: string) {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const objects: any[] = [];
  const styleNames = new Set<string>();
  const declarations = new Map<string, any>();
  /**
   * Every style object a style expression can evaluate to: object literals,
   * both branches of `a ? {…} : {…}`, `open && {…}`, spreads inside a style
   * object (`{ ...base, ...(open ? {…} : {}) }`) and named style objects.
   * Call arguments are data, not styles, and are not followed.
   */
  const collect = (expression: any) => {
    if (!expression) return;
    switch (expression.type) {
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
      case "ParenthesizedExpression":
        return collect(expression.expression);
      case "ConditionalExpression":
        collect(expression.consequent);
        return collect(expression.alternate);
      case "LogicalExpression":
        collect(expression.left);
        return collect(expression.right);
      case "SequenceExpression":
        return collect(expression.expressions.at(-1));
      case "Identifier":
        styleNames.add(expression.name);
        return;
      case "ObjectExpression":
        objects.push(expression);
        for (const property of expression.properties)
          if (property.type === "SpreadElement") collect(property.argument);
        return;
    }
  };
  const visit = (node: any) => {
    if (!node || typeof node.type !== "string") return;
    if (
      node.type === "JSXAttribute" &&
      node.name?.name === "style" &&
      node.value?.type === "JSXExpressionContainer"
    )
      collect(node.value.expression);
    if (
      node.type === "VariableDeclarator" &&
      node.id?.type === "Identifier" &&
      node.init
    ) {
      declarations.set(node.id.name, node.init);
      const annotation = source.slice(
        node.id.typeAnnotation?.start ?? 0,
        node.id.typeAnnotation?.end ?? 0,
      );
      if (/CSSProperties/.test(annotation)) collect(node.init);
    }
    for (const key of Object.keys(node)) {
      if (["loc", "start", "end", "extra"].includes(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast.program);
  // Named style objects, including names reached through other names.
  const resolved = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const name of [...styleNames])
      if (!resolved.has(name) && declarations.has(name)) {
        resolved.add(name);
        collect(declarations.get(name));
        grew = true;
      }
  }
  const out: Array<{ property: string; value: string; line: number }> = [];
  for (const object of new Set(objects))
    for (const property of object.properties) {
      if (property.type !== "ObjectProperty" || property.computed) continue;
      const key =
        property.key.type === "Identifier"
          ? property.key.name
          : property.key.type === "StringLiteral"
            ? property.key.value
            : null;
      if (!key) continue;
      const v = property.value;
      const value =
        v.type === "StringLiteral"
          ? v.value
          : v.type === "NumericLiteral"
            ? String(v.value)
            : v.type === "TemplateLiteral" && v.expressions.length === 0
              ? v.quasis[0].value.cooked
              : source.slice(v.start, v.end);
      out.push({
        property: CSS_PROPERTY(key),
        value,
        line: property.loc.start.line,
      });
    }
  return out;
}

async function files(dir: string, pattern: RegExp): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path, pattern)));
    else if (pattern.test(entry.name)) out.push(path);
  }
  return out.sort();
}
async function findings() {
  const found: Finding[] = [];
  for (const path of await files(webRoot, /\.css$/)) {
    for (const d of cssDeclarations(await readFile(path, "utf8"))) {
      const rule = physicalRule(d.property, d.value);
      if (rule)
        found.push({
          file: relative(root, path),
          line: d.line,
          declaration: `${d.property}: ${d.value}`,
          rule,
        });
    }
  }
  for (const path of await files(webRoot, /\.tsx$/)) {
    for (const d of inlineStyleDeclarations(await readFile(path, "utf8"))) {
      const rule = physicalRule(d.property, d.value);
      if (rule)
        found.push({
          file: relative(root, path),
          line: d.line,
          declaration: `${d.property}: ${d.value}`,
          rule,
        });
    }
  }
  return found;
}

test("the physical-direction checker flags what does not mirror and passes logical forms", () => {
  for (const [property, value] of [
    ["margin-left", "auto"],
    ["padding-right", "4px"],
    ["border-left", "1px solid red"],
    ["border-right-color", "red"],
    ["border-top-left-radius", "4px"],
    ["left", "0"],
    ["right", "16px"],
    ["text-align", "left"],
    ["text-align", "right"],
    ["float", "right"],
    ["clear", "left"],
    ["justify-content", "left"],
    ["background-position", "right 4px center"],
    ["transform-origin", "left top"],
    ["background", "linear-gradient(to right, #fff, #000)"],
    ["margin", "0 0 0 34px"],
    ["padding", "5px 8px 5px 5px"],
    ["inset", "0 auto 0 0"],
    ["border-radius", "4px 0"],
    ["border-radius", "4px 4px 0 4px"],
    ["transform", "translateX(-100%)"],
    ["transform", "translate(14px, 0)"],
    ["transform", "rotate(2deg) translateX(4px)"],
    ["translate", "10px 0"],
    ["transform", "scaleX(-1)"],
    ["background", "url(x.svg) no-repeat right 8px center"],
    ["background", "#fff url('/i.svg') left top / 12px no-repeat"],
    ["mask", "url(m.svg) right center no-repeat"],
    ["-webkit-mask-position", "left"],
    ["transform", "matrix(-1, 0, 0, 1, 0, 0)"],
    ["transform", "matrix(1,0,0,1,12,0)"],
    ["transform", "matrix3d(-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)"],
    ["transform", "scale(-1, 1)"],
    ["scale", "-1 1"],
  ])
    assert.ok(physicalRule(property, value), `${property}: ${value}`);
  for (const [property, value] of [
    ["margin-inline-start", "auto"],
    ["padding-inline", "5px 8px"],
    ["border-inline-start", "1px solid red"],
    ["inset-inline-end", "0"],
    ["text-align", "start"],
    ["text-align", "center"],
    ["margin", "0 auto 16px"],
    ["margin", "4px 0 0"],
    ["padding", "10px 20px 10px 20px"],
    ["border-radius", "50%"],
    ["border-radius", "8px 8px 0 0"],
    ["transform", "translateX(0)"],
    ["transform", "translateX(calc(-100% * var(--inline-sign, 1)))"],
    ["transform", "translateY(-4px)"],
    ["transform", "translate(0, -50%)"],
    ["transform", "scaleX(var(--inline-sign))"],
    ["--sidebar-left", "4px"],
    ["flex-direction", "row"],
    ["grid-template-columns", "1fr 2fr"],
    ["background", "url(/icons/arrow-right.svg) no-repeat center"],
    ["background", "linear-gradient(180deg, #fff, #000)"],
    ["background", "var(--paper)"],
    ["transform", "matrix(1, 0, 0, 1, 0, -4)"],
    ["transform", "matrix(calc(-1 * var(--inline-sign)), 0, 0, 1, 0, 0)"],
    ["transform", "scale(1.02)"],
    ["transform", "scale(1, -1)"],
    ["scale", "1.1"],
  ])
    assert.equal(physicalRule(property, value), null, `${property}: ${value}`);
  // Declarations are read inside media queries and with their lines.
  const css =
    "/* left: 0 */\n.a{color:red}\n@media (max-width: 650px) {\n  .b {\n    margin-left: 0;\n  }\n}\n";
  const parsed = cssDeclarations(css);
  assert.deepEqual(
    parsed.map((d) => [d.property, d.value, d.line]),
    [
      ["color", "red", 2],
      ["margin-left", "0", 5],
    ],
  );
  // Inline styles: object literals, style identifiers and CSSProperties
  // objects; ordinary data objects (an image crop) are not styles.
  const tsx = `import type { CSSProperties } from "react";
const box = { marginRight: 8 };
const typed: CSSProperties = { textAlign: "left" };
const crop = { left: 4, top: 2 };
const base = { borderLeftWidth: 1 };
const chosen = open ? { float: "left" } : base;
export const A = () => <div style={{ right: 16, paddingInlineStart: 4 }}><p style={box} /><i style={typed} />
  <b style={open ? { right: 0, marginLeft: 8 } : undefined} />
  <s style={{ ...(open && { left: 1 }) }} />
  <u style={{ ...(open ? { paddingRight: 4 } : {}), ...chosen }} />
  <em style={(open && { clear: "right" }) as CSSProperties} />
  <q style={styleFor({ left: 99 })} />
</div>;`;
  const inline = inlineStyleDeclarations(tsx).map(
    (d) => d.property + ":" + d.value,
  );
  assert.deepEqual(inline.sort(), [
    "border-left-width:1",
    "clear:right",
    "float:left",
    "left:1",
    "margin-left:8",
    "margin-right:8",
    "padding-inline-start:4",
    "padding-right:4",
    "right:0",
    "right:16",
    "text-align:left",
  ]);
});

test("apps/web stylesheets and inline styles use logical left/right forms", async () => {
  const found = await findings();
  const unexpected = found.filter(
    (f) =>
      !ALLOWED.some(
        (a) => a.file === f.file && a.declaration === f.declaration,
      ),
  );
  assert.deepEqual(
    unexpected.map((f) => `${f.file}:${f.line} ${f.declaration} (${f.rule})`),
    [],
    "Use logical properties (margin-inline-start, inset-inline-end, text-align: start, border-inline-start, var(--inline-sign) for transforms), or add a justified ALLOWED entry.",
  );
  const stale = ALLOWED.filter(
    (a) =>
      !found.some((f) => f.file === a.file && f.declaration === a.declaration),
  );
  assert.deepEqual(stale, [], "Remove allowlist entries that no longer apply");
  for (const entry of ALLOWED) assert.ok(entry.reason.length > 20);
});

test("the stylesheets define the direction helpers the logical rules rely on", async () => {
  const css = await readFile(join(webRoot, "app/globals.css"), "utf8");
  assert.match(css, /\[dir="rtl"\]\s*\{\s*--inline-sign:\s*-1;/);
  assert.match(css, /\[dir="ltr"\]\s*\{\s*--inline-sign:\s*1;/);
  // Directional icons mirror; LTR data stays left to right.
  for (const icon of [
    "arrow-right",
    "chevron-right",
    "arrow-up-right",
    "log-out",
  ])
    assert.match(css, new RegExp(`\\.lucide-${icon},`));
  assert.match(css, /input\[type="tel"\],[\s\S]*?direction: ltr;/);
});
