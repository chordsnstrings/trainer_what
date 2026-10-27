// Injects the playground's no-JS markup (t1 resolved) into demo.html and
// reports gzip sizes against the budgets. Run: node tools/build-demo.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { renderStatic } from "../brain-play.js";
const here = new URL("../", import.meta.url);
const data = JSON.parse(readFileSync(new URL("traces.client.json", here), "utf8"));
const page = new URL("demo.html", here);
const html = readFileSync(page, "utf8").replace(/<!--static:start-->[\s\S]*?<!--static:end-->/, `<!--static:start-->\n${renderStatic(data, { cta: "#play" })}\n<!--static:end-->`);
writeFileSync(page, html);
const gz = (f) => gzipSync(readFileSync(new URL(f, here)), { level: 9 }).length;
const budget = { "brain-boot.js": 1024, "brain-core.js": 6144, "brain-decide.js": null, "brain-play.js": 16384, "brain-anatomy.js": 12288, "brain-ui.js": null, "brain-base.css": null, "brain-play.css": null, "brain-anatomy.css": null, "traces.client.json": null };
for (const [f, b] of Object.entries(budget)) console.log(f.padEnd(20), String(readFileSync(new URL(f, here)).length).padStart(6), "B raw", String(gz(f)).padStart(6), "B gz", b ? (gz(f) <= b ? "OK ≤ " + b : "OVER " + b) : "");
