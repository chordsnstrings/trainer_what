// Audience group check: serves site/ on PORT (default 4347), loads each
// audience page at phone and desktop sizes, reports console errors, sideways
// overflow, broken same-site links and H1 count, and writes screenshots to
// shots/audience/. Usage: node tools/audience-check.cjs [page.html ...]
// Env: SIZES=390x844,1366x900  FULL=0 (skip full-page)  SEG=1 (segments)
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site"), SHOTS = path.join(__dirname, "..", "shots", "audience");
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
const ALL = ["for-trainers.html", "for-trainers--weight-loss.html", "for-trainers--strength.html", "for-trainers--muscle-gain.html", "for-trainers--pre-postnatal.html", "uae.html", "get-started.html", "signup.html", "login.html"];
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const sizes = (process.env.SIZES || "390x844,1366x900").split(",").map((s) => s.split("x").map(Number));
const PORT = +(process.env.PORT || 4347);

server.listen(PORT, "127.0.0.1", async () => {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch(proxy ? { proxy } : {});
  let bad = 0;
  for (const [w, h] of sizes) {
    for (const pg of pages) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
      page.on("requestfailed", (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push("requestfailed: " + r.url()); });
      await page.goto(`http://127.0.0.1:${PORT}/${pg}`, { waitUntil: "load" });
      await page.waitForTimeout(1200);
      const name = pg.replace(".html", "") + "-" + w;
      await page.screenshot({ path: path.join(SHOTS, name + "-top.png") });
      if (process.env.FULL !== "0") {
        const btn = await page.$('[data-consent="granted"]');
        if (btn && (await btn.isVisible())) await btn.click();
        const H = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < H; y += Math.round(h * 0.6)) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(110); }
        await page.waitForTimeout(700);
      }
      const info = await page.evaluate(async () => {
        const de = document.documentElement, over = [];
        document.querySelectorAll("body *").forEach((el) => {
          const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
          if (r.width && (r.right > de.clientWidth + 1 || r.left < -1) && cs.position !== "fixed" && !el.closest(".sheet,.dev,.table-wrap,.tabs,.sr-only") && cs.visibility !== "hidden")
            over.push(el.tagName.toLowerCase() + "." + String(el.className && el.className.baseVal === undefined ? el.className : "").split(" ").slice(0, 2).join(".") + " r=" + Math.round(r.right));
        });
        const links = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => /^[a-z0-9-]+\.html/.test(h));
        const files = [...new Set(links.map((x) => x.split(/[?#]/)[0]))];
        const ext = [...document.querySelectorAll('a[href^="http"]')].filter((a) => a.target !== "_blank" || !/noopener/.test(a.rel)).map((a) => a.href);
        const small = [...document.querySelectorAll("main a, main button, main input, main select")].filter((el) => {
          const r = el.getBoundingClientRect(); if (!r.width || getComputedStyle(el).visibility === "hidden") return false;
          if (el.closest("p, li, .fine, .crumbs") && el.tagName === "A" && !el.className) return false; // inline text links
          return el.type !== "hidden" && el.type !== "checkbox" && (r.height < 44 && r.width < 44 || r.height < 24);
        }).map((el) => el.tagName.toLowerCase() + "." + (el.className || "") + " " + Math.round(el.getBoundingClientRect().height)).slice(0, 6);
        return { scrollW: de.scrollWidth, clientW: de.clientWidth, over: over.slice(0, 6), h1: document.querySelectorAll("h1").length, mark: document.querySelectorAll("h1 .mk-mark").length, files, ext, small };
      });
      info.broken = info.files.filter((f) => !fs.existsSync(path.join(SITE, f))); delete info.files;
      if (process.env.FULL !== "0") {
        await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(SHOTS, name + "-full.png"), fullPage: true });
        if (process.env.SEG) {
          const segH = Math.round(h * 1.4), total = await page.evaluate(() => document.documentElement.scrollHeight);
          for (let y = 0, k = 0; y < total; y += segH, k++)
            await page.screenshot({ path: path.join(SHOTS, `${name}-seg${k}.png`), fullPage: true, clip: { x: 0, y, width: w, height: Math.min(segH, total - y) } });
        }
      }
      const fail = errors.length || info.scrollW > info.clientW || info.over.length || info.h1 !== 1 || info.broken.length || info.ext.length;
      if (fail) bad++;
      console.log((fail ? "FAIL " : "ok   ") + JSON.stringify({ page: pg, size: `${w}x${h}`, ...info, errors }));
      await ctx.close();
    }
  }
  await browser.close();
  server.close();
  process.exitCode = bad ? 1 : 0;
});
