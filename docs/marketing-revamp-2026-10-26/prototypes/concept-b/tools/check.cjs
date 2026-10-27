// Browser check: serves site/, loads pages at phone and desktop sizes,
// collects console errors, checks horizontal overflow, counts words, and
// writes screenshots to shots/. Usage: node tools/check.cjs [page.html ...]
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site"), SHOTS = path.join(__dirname, "..", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ["index.html", "pricing.html"];
const sizes = (process.env.SIZES || "390x844,1366x900").split(",").map((s) => s.split("x").map(Number));
const full = process.env.FULL !== "0";

server.listen(0, async () => {
  const port = server.address().port;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch(proxy ? { proxy } : {});
  for (const [w, h] of sizes) {
    for (const pg of pages) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
      page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url() + " " + (r.failure() || {}).errorText));
      await page.goto(`http://127.0.0.1:${port}/${pg}`, { waitUntil: "load" });
      await page.waitForTimeout(1600);
      const name = pg.replace(".html", "") + "-" + w;
      await page.screenshot({ path: path.join(SHOTS, name + "-top.png") });
      const info = await page.evaluate(() => {
        const de = document.documentElement;
        const over = [];
        document.querySelectorAll("body *").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > de.clientWidth + 1 || r.left < -1) && getComputedStyle(el).position !== "fixed" && !el.closest(".sheet,.dev,.table-wrap,.tabs")) over.push(el.tagName + "." + (el.className && el.className.baseVal === undefined ? el.className : "") );
        });
        document.querySelectorAll("main *").forEach((n) => { if (getComputedStyle(n).display === "none") n.setAttribute("data-wc-none", ""); });
        const main = document.querySelector("main").cloneNode(true);
        main.querySelectorAll("[data-wc-none],[data-wc-skip],[data-wc-calc],.acc-panel,.sr-only,script,style,[hidden]").forEach((n) => n.remove());
        const cnt = (t) => t.split(/\s+/).filter((x) => /[A-Za-z0-9]/.test(x)).length;
        const words = cnt(main.textContent);
        const bySection = [...main.children].map((c) => (c.id || c.className.split(" ")[0]) + ":" + cnt(c.textContent)).join(" ");
        const all = document.querySelector("main").innerText.split(/\s+/).filter((x) => /[A-Za-z0-9]/.test(x)).length;
        return { bySection, scrollW: de.scrollWidth, clientW: de.clientWidth, over: over.slice(0, 8), h1: document.querySelectorAll("h1").length, words, all,
          fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family + " " + f.weight + " " + f.stretch).slice(0, 6) };
      });
      // Accept consent, scroll through to trigger reveals, then full page.
      if (full) {
        const btn = await page.$('[data-consent="granted"]');
        if (btn && (await btn.isVisible())) await btn.click();
        const H = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < H; y += Math.round(h * 0.6)) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(120); }
        await page.waitForTimeout(600);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, name + "-full.png"), fullPage: true });
        if (process.env.SEG) {
          const segH = Math.round(h * 1.3), total = await page.evaluate(() => document.documentElement.scrollHeight);
          for (let y = 0, k = 0; y < total; y += segH, k++)
            await page.screenshot({ path: path.join(SHOTS, `${name}-seg${k}.png`), fullPage: true, clip: { x: 0, y, width: w, height: Math.min(segH, total - y) } });
        }
      }
      console.log(JSON.stringify({ page: pg, size: `${w}x${h}`, ...info, errors }));
      await ctx.close();
    }
  }
  await browser.close();
  server.close();
});
