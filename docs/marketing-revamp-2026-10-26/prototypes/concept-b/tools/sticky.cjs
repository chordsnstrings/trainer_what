// Sticky CTA state at page top after consent. usage: node tools/sticky.cjs page.html [w] [h]
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split("?")[0]); const f = path.join(SITE, p); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(s); }).listen(0, async () => {
  const port = server.address().port, [u, W = 390, H = 844] = process.argv.slice(2);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: +W, height: +H } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/index.html`); await page.waitForTimeout(300); await page.click('[data-consent="granted"]');
  await page.goto(`http://localhost:${port}/${u}`); await page.waitForTimeout(900);
  console.log(await page.evaluate(() => { const h = document.querySelector("[data-hero] .cta-row"); const r = h && h.getBoundingClientRect(); return { sticky: document.querySelector(".sticky-cta").className, heroCtaTop: r && Math.round(r.top), heroCtaBottom: r && Math.round(r.bottom), scrollY }; }));
  await b.close(); server.close();
});
