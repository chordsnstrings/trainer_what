// Brain showcase glue for the generator (round 2, 27 Oct).
// 1. Copies the shared engine (../shared/brain) into site/assets/brain/ on
//    every build, so a rebuild never leaves stale or missing engine files.
// 2. Exposes the server-rendered first frames: C's "Anatomy of a decision"
//    section (site/assets/c-anatomy.js render) and the playground
//    (brain-play.js renderStatic), plus the inline bootstrap.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/content.mjs";

const SHARED = resolve(ROOT, "../shared/brain");
const DEST = resolve(ROOT, "site/assets/brain");
export const ENGINE_FILES = ["brain-boot.js", "brain-core.js", "brain-decide.js", "brain-ui.js", "brain-play.js", "brain-base.css", "brain-play.css", "traces.client.json"];
// Minify on copy when esbuild is available (the repo's node_modules); never bundle, so
// relative ES-module imports and exports stay exactly as authored.
let esbuild = null;
try { esbuild = createRequire("/home/user/trainer_what/package.json")("esbuild"); } catch (e) { esbuild = null; }
function ship(from, to) {
  const src = readFileSync(from, "utf8"), ext = extname(from);
  const out = esbuild && (ext == ".js" || ext == ".css") ? esbuild.transformSync(src, { loader: ext.slice(1), minify: true, ...(ext == ".js" ? { format: "esm", target: "es2020" } : {}) }).code : src;
  writeFileSync(to, out);
}
mkdirSync(DEST, { recursive: true });
for (const f of ENGINE_FILES) ship(resolve(SHARED, f), resolve(DEST, f));
// Concept C's own showcase files: authored in src/showcase/, shipped minified to site/assets/.
for (const f of ["c-anatomy.js", "c-anatomy.css"]) ship(resolve(ROOT, "src/showcase", f), resolve(ROOT, "site/assets", f));

const imp = (p) => import(pathToFileURL(p).href);
const Core = await imp(resolve(DEST, "brain-core.js"));
const CA = await imp(resolve(ROOT, "site/assets/c-anatomy.js"));
const PLAY = await imp(resolve(DEST, "brain-play.js"));
const UI = await imp(resolve(DEST, "brain-ui.js"));
const data = () => Core.index(JSON.parse(readFileSync(resolve(DEST, "traces.client.json"), "utf8")));

/** The bootstrap, inlined at the end of <body> (spec §1.6: ≤ 1 KB). */
export const BOOT = `<script>${readFileSync(resolve(DEST, "brain-boot.js"), "utf8").replace(/^\/\*[\s\S]*?\*\/\s*/, "").trim()}</script>`;
/** Stylesheets per showcase kind (page-relative). */
export const CSS = { anatomy: ["assets/brain/brain-base.css", "assets/c-anatomy.css"], play: ["assets/brain/brain-base.css", "assets/brain/brain-play.css", "assets/c-anatomy.css"] };
/** C's anatomy section. o: {n, fig, id}. */
export const anatomy = (o) => CA.render(data(), o);
export const NOTES = CA.NOTES;
/** The playground's no-JS markup (t1 resolved) inside its mount element. */
export function playground({ id = "play", cta = "signup.html", labelledby } = {}) {
  return `<div class="bp c-play" id="${id}" data-showcase="play" data-sc-module="assets/brain/brain-play.js" data-cta="${cta}" data-heading="off"${labelledby ? ` aria-labelledby="${labelledby}"` : ""}>${PLAY.renderStatic(data(), { cta, heading: false })}</div>`;
}
export const PLAY_COPY = PLAY.COPY;
/** The trace data (index()ed), for page echoes built from the same facts. */
export const brainData = data;
/** A specialist node as static HTML: pill = AI specialist, square = code, dashed = not on yet. */
export function nodeChip(d, id, extra = "") {
  const s = d.sp[id], off = s.status == "not_on_yet";
  return `<span class="c-node" data-kind="${s.kind}"${off ? " data-off" : ""}>${UI.icon(s.icon, 14)}${s.name}${off ? ` <small>${d.labels.status.not_on_yet}</small>` : ""}${extra}</span>`;
}
