// Which .reveal units stay pending after a slow scroll? usage: node tools/pending.cjs page.html [w] [h]
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html"; const f = path.join(SITE, p); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(s); }).listen(0, async () => {
  const port = server.address().port, [pg, W = 1366, H = 900] = process.argv.slice(2);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: +W, height: +H } });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`http://localhost:${port}/${pg}`); await page.waitForTimeout(400);
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += 300) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(60); }
  await page.waitForTimeout(600);
  const left = await page.evaluate(() => [...document.querySelectorAll(".reveal-pending")].map((e) => { const r = e.getBoundingClientRect(); return `${e.tagName}.${e.className} h=${Math.round(r.height)} top=${Math.round(r.top + scrollY)} vis=${getComputedStyle(e).display}`; }));
  console.log(JSON.stringify({ left, errs }, null, 1));
  await b.close(); server.close();
});
