// Targeted screenshot after consent. usage: node tools/shot.cjs page.html W H out.png [selector] [setup-js]
// With a selector, scrolls it into view (instant) and shots the element; console errors and overflow are printed.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split("?")[0]); const f = path.join(SITE, p); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(s); }).listen(0, async () => {
  const port = server.address().port, [pg, W, H, out, sel, setup] = process.argv.slice(2);
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined });
  const ctx = await b.newContext({ viewport: { width: +W, height: +H } });
  await ctx.addInitScript(() => { try { localStorage.setItem("tyB", JSON.stringify({ consent: "granted" })); } catch (e) {} });
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(`http://localhost:${port}/${pg}`, { waitUntil: "load" }); await page.waitForTimeout(1200);
  if (setup) { await page.evaluate(setup); await page.waitForTimeout(700); }
  if (sel) { await page.evaluate((s) => { const e = document.querySelector(s); e.scrollIntoView({ block: "center" }); }, sel); await page.waitForTimeout(900); await page.locator(sel).first().screenshot({ path: out }); }
  else await page.screenshot({ path: out });
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  console.log(JSON.stringify({ out, overflow: ov, errs }));
  await b.close(); server.close();
});
