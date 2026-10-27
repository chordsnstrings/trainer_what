// Arriving on page.html#id: is the target (or an ancestor) hidden by a reveal? usage: node tools/hashcheck.cjs "page.html#id" [w] [h]
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split("?")[0]); const f = path.join(SITE, p); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(s); }).listen(0, async () => {
  const port = server.address().port, [u, W = 1366, H = 900] = process.argv.slice(2);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: +W, height: +H } });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`http://localhost:${port}/${u}`);
  for (const t of [100, 600]) {
    await page.waitForTimeout(t);
    console.log(t, await page.evaluate(() => { const el = document.getElementById(location.hash.slice(1)); if (!el) return "no target"; const r = el.getBoundingClientRect(); const pend = el.closest(".reveal-pending"); return { top: Math.round(r.top), scrollY, pending: !!pend, op: getComputedStyle(pend || el).opacity }; }));
  }
  await b.close(); server.close();
});
