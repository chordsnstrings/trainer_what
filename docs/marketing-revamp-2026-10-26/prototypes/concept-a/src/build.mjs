// Concept A "Live Brain": static site generator.
//   node concept-a/src/build.mjs   -> writes concept-a/site/*.html (42 pages)
// Assets (site.css, site.js, calc.js, <module>.css/.js, a-field.js, a-brain.css)
// live in site/assets and are authored directly; this script writes the HTML
// pages and, first, copies the shared Brain engine into site/assets/brain/
// (spec showcase-final.md §1.6) so pages can render its static markup in Node.
import { writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { PAGES, SITE, ROOT, content, href } from "./registry.mjs";

const ENGINE_SRC = join(ROOT, "..", "shared", "brain");
const ENGINE_DST = join(SITE, "assets", "brain");
mkdirSync(ENGINE_DST, { recursive: true });
const engine = readdirSync(ENGINE_SRC).filter((f) => /\.(js|css)$/.test(f) || f === "traces.client.json");
for (const f of engine) copyFileSync(join(ENGINE_SRC, f), join(ENGINE_DST, f));

// Page modules load after the copy: they import the engine's Node-safe renderers.
const { renderDocument } = await import("./layout.mjs");
const { esc, textLink } = await import("./components.mjs");
const MODULES = {
  core: (await import("./pages-core.mjs")).pages,
  product: (await import("./pages-product.mjs")).pages,
  audience: (await import("./pages-audience.mjs")).pages,
  money: (await import("./pages-money.mjs")).pages,
  content: (await import("./pages-content.mjs")).pages,
};

/** Visible placeholder for a page whose module has not built it yet. */
function notBuilt(page) {
  return {
    main: `<section class="band band-white stub"><div class="wrap">
  <p class="kicker">${esc(page.eyebrow || page.navLabel)}</p>
  <h1>${esc(page.h1 || page.title)}</h1>
  ${page.lede ? `<p class="lede">${esc(page.lede)}</p>` : ""}
  <div class="stub-note"><strong>Not built yet.</strong> <span class="mono">src/pages-${page.module}.mjs</span> renders <span class="mono">${esc(page.path)}</span> → <span class="mono">${esc(page.file)}</span>.</div>
  <p>${textLink("/", "Back to home")}</p>
</div></section>`,
  };
}

/** Context passed to every render function. */
function ctx(page) {
  return { page, content, href, pages: PAGES };
}

if (!existsSync(join(SITE, "assets"))) mkdirSync(join(SITE, "assets"), { recursive: true });
const stubs = [];
for (const page of PAGES) {
  const render = MODULES[page.module]?.[page.path];
  let result;
  if (typeof render === "function") result = render(ctx(page));
  else {
    stubs.push(page.path);
    result = notBuilt(page);
  }
  writeFileSync(join(SITE, page.file), renderDocument(page, result));
}
console.log(`Copied ${engine.length} engine files to assets/brain/. Built ${PAGES.length} pages into ${SITE}${stubs.length ? `; ${stubs.length} not built yet: ${stubs.join(", ")}` : ""}`);
