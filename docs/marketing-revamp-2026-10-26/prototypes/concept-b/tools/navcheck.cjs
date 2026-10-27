// Click-through navigation smoke test: view transitions fire without console errors.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split("?")[0]); const f = path.join(SITE, p); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(s); }).listen(0, async () => {
  const port = server.address().port;
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(() => {
    try { localStorage.setItem("tyB", JSON.stringify({ consent: "granted" })); } catch (e) {}
    window.__vt = []; addEventListener("pagereveal", (e) => { window.__vt.push(!!e.viewTransition); setTimeout(() => { window.__vtName = [...document.querySelectorAll("[data-vt]")].map((x) => x.style.viewTransitionName).join(","); }, 0); });
  });
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED/.test(m.text())) errs.push(m.text()); });
  await page.goto(`http://localhost:${port}/index.html`); await page.waitForTimeout(800);
  await page.click('.price-tile a[href="earnings-calculator.html"]'); await page.waitForLoadState("load"); await page.waitForTimeout(800);
  console.log("home->earnings", page.url().split("/").pop(), await page.evaluate(() => ({ vt: window.__vt, names: window.__vtName })));
  await page.goBack(); await page.waitForTimeout(800);
  console.log("back", page.url().split("/").pop(), await page.evaluate(() => ({ vt: window.__vt, dir: document.documentElement.style.getPropertyValue("--dir") })));
  await page.click('.hdr-nav a[href="pricing.html"]'); await page.waitForTimeout(800);
  console.log("->pricing", await page.evaluate(() => ({ vt: window.__vt, dir: document.documentElement.style.getPropertyValue("--dir") })));
  console.log("errors", errs);
  await b.close(); server.close();
});
