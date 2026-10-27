// Browser check for concept C pages (Playwright, no install needed).
//   node src/tools/check.cjs [file.html ...] [--widths=390,1366] [--port=4310] [--no-shots]
// Serves ../site on a free port, loads each page at each width, scrolls to
// trigger reveals, reports console errors, horizontal overflow and H1 count,
// and saves screenshots to ../shots/<page>-<width>.png (+ -top first screen).
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const SITE = path.resolve(__dirname, "../../site");
const SHOTS = path.resolve(__dirname, "../../shots");
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=")[1] : d; };
const files = args.filter((a) => !a.startsWith("--"));
const pages = files.length ? files : ["index.html", "pricing.html"];
const widths = opt("widths", "390,1366").split(",").map(Number);
const heights = { 360: 780, 390: 844, 768: 1024, 1024: 768, 1366: 900, 1600: 1000 };
const shots = !args.includes("--no-shots");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = path.join(SITE, p === "/" ? "index.html" : p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(Number(opt("port", 0)), r));
  const port = server.address().port;
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  let failed = 0;
  for (const file of pages) {
    for (const w of widths) {
      const ctx = await browser.newContext({ viewport: { width: w, height: heights[w] || 900 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
      page.on("requestfailed", (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push("requestfailed: " + r.url()); });
      await page.goto(`http://127.0.0.1:${port}/${file}`, { waitUntil: "load" });
      await page.waitForTimeout(400);
      const name = file.replace(/\.html$/, "");
      if (shots) await page.screenshot({ path: path.join(SHOTS, `${name}-${w}-top.png`) });
      // Scroll through to trigger every reveal, then return to top.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += Math.round(innerHeight * 0.5)) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 140)); }
        scrollTo(0, document.body.scrollHeight); await new Promise((r) => setTimeout(r, 500));
      });
      const info = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        wide: [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 1 && getComputedStyle(el).position !== "fixed" && !el.closest(".tbl-wrap, .stepper-rail, .tablist"); }).slice(0, 5).map((el) => el.tagName.toLowerCase() + "." + [...el.classList].join(".")),
        h1: document.querySelectorAll("h1").length,
        pending: document.querySelectorAll(".reveal-pending").length,
      }));
      if (shots) { await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, `${name}-${w}.png`), fullPage: true }); }
      const bad = errors.length || info.overflow > 0 || info.h1 !== 1;
      if (bad) failed++;
      console.log(`${bad ? "FAIL" : "ok  "} ${file} @${w}: errors=${errors.length} overflowX=${info.overflow}px h1=${info.h1} stillPending=${info.pending}${info.wide.length ? " wide=" + info.wide.join(",") : ""}`);
      errors.slice(0, 6).forEach((e) => console.log("     " + e));
      await ctx.close();
    }
  }
  await browser.close();
  server.close();
  process.exitCode = failed ? 1 : 0;
})();
