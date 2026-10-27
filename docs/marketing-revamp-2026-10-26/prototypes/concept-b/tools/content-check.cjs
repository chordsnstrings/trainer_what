// Content group browser check: serves site/ on PORT (default 4383), loads
// each content page at 390x844 and 1366x900, collects console errors,
// horizontal overflow, H1 count and broken same-site links, and writes
// screenshots to shots/content/. Usage: node tools/content-check.cjs [page.html ...]
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site"), SHOTS = path.join(__dirname, "..", "shots", "content");
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
const ALL = ["guides.html", "guides--pricing-online-coaching-uae.html", "guides--instagram-followers-to-clients.html", "guides--uae-advertiser-permit.html", "guides--writing-coaching-rules.html", "faq.html", "about.html", "methodology.html", "terms.html", "privacy.html", "ai-disclosure.html", "coaches.html", "404.html"];
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const sizes = (process.env.SIZES || "390x844,1366x900").split(",").map((s) => s.split("x").map(Number));
const full = process.env.FULL !== "0";
server.listen(Number(process.env.PORT || 4383), async () => {
  const port = server.address().port;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch(proxy ? { proxy } : {});
  for (const [w, h] of sizes) for (const pg of pages) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
    const page = await ctx.newPage(); const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url() + " " + (r.failure() || {}).errorText));
    await page.goto(`http://127.0.0.1:${port}/${pg}`, { waitUntil: "load" }); await page.waitForTimeout(900);
    const name = pg.replace(".html", "") + "-" + w;
    await page.screenshot({ path: path.join(SHOTS, name + "-top.png") });
    const info = await page.evaluate(() => {
      const de = document.documentElement, over = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > de.clientWidth + 1 || r.left < -1) && getComputedStyle(el).position !== "fixed" && !el.closest(".sheet,.dev,.table-wrap,.tabs,.topics")) over.push(el.tagName + "." + String(el.className.baseVal ?? el.className).slice(0, 40));
      });
      const links = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"));
      const ext = [...document.querySelectorAll('a[href^="http"]')].filter((a) => a.target !== "_blank" || !/noopener/.test(a.rel)).map((a) => a.href);
      return { scrollW: de.scrollWidth, clientW: de.clientWidth, over: over.slice(0, 6), h1: document.querySelectorAll("h1").length, links: links.length, badExt: ext.slice(0, 3),
        ids: (() => { const s = new Set(), dup = []; document.querySelectorAll("[id]").forEach((e) => { if (s.has(e.id)) dup.push(e.id); s.add(e.id); }); return dup.slice(0, 5); })(),
        hashMissing: [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href").slice(1)).filter((id) => id && !document.getElementById(id)).slice(0, 5) };
    });
    if (full) {
      const btn = await page.$('[data-consent="granted"]'); if (btn && (await btn.isVisible())) await btn.click();
      const H = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < H; y += Math.round(h * 0.6)) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(90); }
      await page.waitForTimeout(500); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, name + "-full.png"), fullPage: true });
      if (process.env.SEG) {
        const segH = Math.round(h * 1.3), total = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0, k = 0; y < total; y += segH, k++) await page.screenshot({ path: path.join(SHOTS, `${name}-seg${k}.png`), fullPage: true, clip: { x: 0, y, width: w, height: Math.min(segH, total - y) } });
      }
      info.pending = await page.evaluate(() => document.querySelectorAll(".reveal-pending").length);
    }
    console.log(JSON.stringify({ page: pg, size: `${w}x${h}`, ...info, errors }));
    await ctx.close();
  }
  await browser.close(); server.close();
});
