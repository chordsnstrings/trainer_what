// Shared Brain showcase engine: copied from ../shared/brain on every build so
// site/assets/brain always matches the shared source (tools, demo and the
// full traces.json with code refs stay behind). Imported first by build.mjs,
// so page modules can import the engine from site/assets afterwards.
import { readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
const from = new URL("../../shared/brain/", import.meta.url).pathname;
const to = new URL("../site/assets/brain/", import.meta.url).pathname;
mkdirSync(to, { recursive: true });
for (const f of readdirSync(from)) if (/^brain-.*\.(js|css)$/.test(f) || f === "traces.client.json") copyFileSync(join(from, f), join(to, f));

// Concept B's day showcase: source in src/day, minified into site/assets/day
// (esbuild from the repo when present; a plain copy otherwise). The source
// imports the engine from site/assets/brain so the generator can run it in Node.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const daySrc = new URL("./day/", import.meta.url).pathname, dayOut = new URL("../site/assets/day/", import.meta.url).pathname;
mkdirSync(dayOut, { recursive: true });
let esb = null;
try { esb = createRequire("/home/user/trainer_what/package.json")("esbuild"); } catch (e) { /* no minifier: copy as is */ }
for (const f of ["brain-day.js", "brain-day-html.js", "brain-day.css"]) {
  let code = readFileSync(join(daySrc, f), "utf8");
  if (f.endsWith(".js")) code = code.replaceAll("../../site/assets/brain/", "../brain/");
  if (esb) code = esb.transformSync(code, { loader: f.endsWith(".js") ? "js" : "css", minify: true, format: f.endsWith(".js") ? "esm" : undefined, target: "es2020", legalComments: "none" }).code;
  writeFileSync(join(dayOut, f), code);
}
