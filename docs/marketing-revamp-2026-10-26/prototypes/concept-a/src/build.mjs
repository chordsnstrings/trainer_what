// Concept A "Live Brain": static site generator.
//   node concept-a/src/build.mjs   -> writes concept-a/site/*.html (42 pages)
// Assets (site.css, site.js, calc.js, <module>.css/.js) live in site/assets and
// are authored directly; this script only writes the HTML pages.
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PAGES, SITE, content, href } from "./registry.mjs";
import { renderDocument } from "./layout.mjs";
import { esc, textLink } from "./components.mjs";
import { pages as core } from "./pages-core.mjs";
import { pages as product } from "./pages-product.mjs";
import { pages as audience } from "./pages-audience.mjs";
import { pages as money } from "./pages-money.mjs";
import { pages as contentPages } from "./pages-content.mjs";

const MODULES = { core, product, audience, money, content: contentPages };

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
console.log(`Built ${PAGES.length} pages into ${SITE}${stubs.length ? `; ${stubs.length} not built yet: ${stubs.join(", ")}` : ""}`);
