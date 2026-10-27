// Concept B · static site generator.
//   node src/build.mjs  ->  writes site/*.html (42 flat pages)
// Foundation-owned dispatcher: builders add renderers in pages-*.mjs only.
import "./brain-sync.mjs"; // first: copies the shared Brain engine into site/assets/brain
import { writeFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

import { content, registry, SITE, href, esc, pageFor, C, LIVE } from "./core.mjs";
import * as h from "./components.mjs";
import { renderPage } from "./layout.mjs";
import { pages as core } from "./pages-core.mjs";
import { pages as product } from "./pages-product.mjs";
import { pages as audience } from "./pages-audience.mjs";
import { pages as money } from "./pages-money.mjs";
import { pages as contentPages } from "./pages-content.mjs";

const MODULES = { core, product, audience, money, content: contentPages };

/** Visible fallback for a page nobody has built yet. */
function stub(ctx) {
  const p = ctx.page;
  return {
    main: `<section class="page-hero"><div class="container"><div class="stub" role="note">
<p class="eyebrow">Not built yet</p>
<h1>${esc(p.h1 || p.title)}</h1>
${p.lede ? `<p>${esc(p.lede)}</p>` : ""}
<p class="fine">Owner: the ${esc(ctx.group)} builder, in src/pages-${esc(ctx.group)}.mjs.</p>
</div></div></section>`,
  };
}

const written = new Set(), missing = [];
for (const entry of registry) {
  const render = MODULES[entry.group]?.[entry.path];
  const ctx = { ...entry, content, C, h, href, esc, pageFor, registry, LIVE };
  let out = render ? render(ctx) : (missing.push(entry.path), stub(ctx));
  if (typeof out === "string") out = { main: out };
  const html = renderPage(entry, out);
  writeFileSync(join(SITE, entry.file), html);
  written.add(entry.file);
}

// Remove stale pages from earlier builds.
for (const f of readdirSync(SITE)) if (f.endsWith(".html") && !written.has(f)) unlinkSync(join(SITE, f));

// Link check: every relative .html link must exist.
const broken = new Set();
for (const f of written) {
  const html = (await import("node:fs")).readFileSync(join(SITE, f), "utf8");
  for (const m of html.matchAll(/href="([^"#?]+\.html)[^"]*"/g)) if (!existsSync(join(SITE, m[1]))) broken.add(`${f} -> ${m[1]}`);
  for (const m of html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)) if (!existsSync(join(SITE, m[1]))) broken.add(`${f} -> ${m[1]}`);
}
console.log(`Built ${written.size} pages into ${SITE}`);
if (missing.length) console.log(`Not built yet (${missing.length}): ${missing.join(", ")}`);
if (broken.size) { console.log(`Broken links (${broken.size}):\n  ${[...broken].join("\n  ")}`); process.exitCode = 1; }
