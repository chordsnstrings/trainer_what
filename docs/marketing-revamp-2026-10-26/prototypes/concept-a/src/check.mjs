// Browser check for concept A pages (Playwright, Chromium).
//   node src/check.mjs index pricing            -> 390x844 and 1366x900
//   node src/check.mjs --widths=360,768 demo    -> custom widths (height 900)
// Serves ../site on a free port from 4310, loads each page, collects console
// errors and page errors, checks horizontal overflow, scrolls to trigger reveals
// and writes screenshots to ../shots/<page>-<width>-{top,full}.png.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { SITE, ROOT } from "./registry.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const args = process.argv.slice(2);
const widthArg = args.find((a) => a.startsWith("--widths="));
const sizes = widthArg ? widthArg.slice(9).split(",").map((w) => [+w, 900]) : [[390, 844], [1366, 900]];
const names = args.filter((a) => !a.startsWith("--"));
const pagesToCheck = names.length ? names : ["index", "pricing"];
const SHOTS = join(ROOT, "shots");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

function serve() {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = normalize(join(SITE, p));
      if (!file.startsWith(SITE)) throw new Error("outside");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/html" });
      res.end(await readFile(join(SITE, "404.html")).catch(() => "404"));
    }
  });
  return new Promise((resolve) => {
    let port = 4310;
    server.on("error", () => server.listen(++port));
    server.listen(port, () => resolve({ server, port: server.address().port }));
  });
}

const { server, port } = await serve();
await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch();
let failures = 0;
for (const name of pagesToCheck) {
  for (const [width, height] of sizes) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${port}/${name}.html`, { waitUntil: "load" });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: join(SHOTS, `${name}-${width}-top.png`) });
    const allow = page.locator('[data-consent-choice="granted"]');
    if (await allow.isVisible()) await allow.click();
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += Math.round(height * 0.6)) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const wide = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > vw + 1 || r.left < -1) && getComputedStyle(el).position !== "fixed") {
          const clipped = el.closest(".table-wrap, .tabs-list, .phone-screen, .window-screen, [hidden]");
          if (!clipped) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} r=${Math.round(r.right)}`);
        }
      });
      return { scrollW: document.documentElement.scrollWidth, vw, wide: wide.slice(0, 8) };
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SHOTS, `${name}-${width}-full.png`), fullPage: true });
    if (args.includes("--sections")) {
      const bands = page.locator("main > section, body > footer");
      const n = await bands.count();
      for (let i = 0; i < n; i++) await bands.nth(i).screenshot({ path: join(SHOTS, `${name}-${width}-s${String(i).padStart(2, "0")}.png`) });
    }
    const bad = overflow.scrollW > overflow.vw || errors.length;
    if (bad) failures++;
    console.log(`${bad ? "FAIL" : "ok  "} ${name} @${width}: scrollWidth ${overflow.scrollW}/${overflow.vw}${overflow.wide.length ? " wide: " + overflow.wide.join(", ") : ""}${errors.length ? "\n     errors: " + errors.join(" | ") : ""}`);
    await ctx.close();
  }
}
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
