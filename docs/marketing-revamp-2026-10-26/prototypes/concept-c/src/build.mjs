#!/usr/bin/env node
// Concept C "The Method": static site generator.
//   node src/build.mjs            -> writes all 42 pages into ../site/
//   node src/build.mjs /pricing   -> writes only the listed paths
// Assets (site.css, site.js, boot.js, calc.js and the per-group files) are
// authored directly in site/assets/ and are never overwritten here.
//
// Page modules export `pages`: { "<path>": (ctx) => PageResult }.
// See src/BUILDERS.md for the contract, helpers and class vocabulary.
// The Brain showcase engine is copied from ../shared/brain into site/assets/brain/
// on every build (lib-brain.mjs runs first; it never deletes other assets).
import "./lib-brain.mjs";
import { writeFileSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, content } from "./lib/content.mjs";
import { PAGES, href, fileFor, pageFor } from "./lib/registry.mjs";
import * as h from "./lib/components.mjs";
import { renderDocument } from "./lib/layout.mjs";

import { pages as core } from "./pages-core.mjs";
import { pages as product } from "./pages-product.mjs";
import { pages as audience } from "./pages-audience.mjs";
import { pages as money } from "./pages-money.mjs";
import { pages as contentPages } from "./pages-content.mjs";

const MODULES = {
  core: ["src/pages-core.mjs", core],
  product: ["src/pages-product.mjs", product],
  audience: ["src/pages-audience.mjs", audience],
  money: ["src/pages-money.mjs", money],
  content: ["src/pages-content.mjs", contentPages],
};

const SITE = resolve(ROOT, "site");
mkdirSync(resolve(SITE, "assets"), { recursive: true });

const only = process.argv.slice(2);
const targets = only.length ? only.map(pageFor) : PAGES;
const report = [];

for (const page of targets) {
  const [moduleName, map] = MODULES[page.owner];
  const render = map[page.path];
  const ctx = { page, content, href, h, pageFor };
  let result;
  if (typeof render === "function") {
    result = render(ctx);
    if (!result || typeof result.main !== "string") throw new Error(`${page.path}: render must return { main: string }`);
    report.push(`${page.path.padEnd(42)} built   (${moduleName})`);
  } else {
    result = { main: h.stubMain(page, moduleName), closing: false };
    report.push(`${page.path.padEnd(42)} STUB    (${moduleName})`);
  }
  const html = renderDocument(page, result);
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) throw new Error(`${page.path}: expected exactly one <h1>, found ${h1s}`);
  writeFileSync(resolve(SITE, fileFor(page.path)), html);
}

// Remove stale pages from a previous full build.
if (!only.length) {
  const keep = new Set(PAGES.map((p) => p.file));
  for (const f of readdirSync(SITE)) if (f.endsWith(".html") && !keep.has(f)) unlinkSync(resolve(SITE, f));
}

console.log(report.join("\n"));
console.log(`\n${targets.length} page(s) written to ${SITE}`);
