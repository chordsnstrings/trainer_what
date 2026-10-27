// Product group browser check (owned by the product builder).
// Serves site/ on a fixed free port, loads each page at each size, reports
// console errors, failed requests, horizontal overflow, H1 count and
// external-link hygiene, and writes screenshots to shots/product/.
// Usage: PORT=4337 SIZES=390x844,1366x900 FULL=1 node tools/product-check.cjs page.html ...
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site"), SHOTS = path.join(__dirname, "..", "shots", "product");
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
const pages = process.argv.slice(2);
const sizes = (process.env.SIZES || "390x844,1366x900").split(",").map((s) => s.split("x").map(Number));
const full = process.env.FULL === "1", seg = process.env.SEG === "1";
let tryPort = +(process.env.PORT || 4361);
server.on("error", (e) => { if (e.code === "EADDRINUSE" && tryPort < 4390) server.listen(++tryPort, "127.0.0.1"); else throw e; });
server.listen(tryPort, "127.0.0.1");
server.on("listening", async () => {
  const port = server.address().port;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch(proxy ? { proxy } : {});
  let bad = 0;
  for (const [w, h] of sizes) for (const pg of pages) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("requestfailed", (r) => { if (!/fonts\.g/.test(r.url())) errors.push("requestfailed: " + r.url()); });
    await page.goto(`http://127.0.0.1:${port}/${pg}`, { waitUntil: "load" });
    await page.waitForTimeout(1300);
    const name = pg.replace(".html", "") + "-" + w;
    await page.screenshot({ path: path.join(SHOTS, name + "-top.png") });
    const btn = await page.$('[data-consent="granted"]');
    if (btn && (await btn.isVisible())) { await btn.click(); await page.waitForTimeout(350); }
    const H = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += Math.round(h * 0.55)) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(110); }
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const de = document.documentElement, over = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (r.width && (r.right > de.clientWidth + 1 || r.left < -1) && cs.position !== "fixed" && cs.visibility !== "hidden" && cs.opacity !== "0" && !el.closest(".sheet,.dev,.table-wrap,.tabs,[aria-hidden=true] .hiw-scr:not(.is-on)"))
          over.push(el.tagName.toLowerCase() + "." + String(el.className.baseVal ?? el.className).split(" ").slice(0, 2).join("."));
      });
      const ext = [...document.querySelectorAll('a[href^="http"]')].filter((a) => a.target !== "_blank" || !/noopener/.test(a.rel)).map((a) => a.href);
      const small = [...document.querySelectorAll("main button, main a, main input, main [role=tab]")].filter((el) => {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        return r.width && r.height && cs.visibility !== "hidden" && !el.closest("[aria-hidden=true],.acc-panel,p,li,.fine,.crumbs,td") && (r.height < 43.5 || r.width < 43.5);
      }).map((el) => (el.getAttribute("aria-label") || el.textContent.trim()).slice(0, 30) + ` ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
      return { scrollW: de.scrollWidth, clientW: de.clientWidth, over: [...new Set(over)].slice(0, 8), h1: document.querySelectorAll("h1").length, ext, small: small.slice(0, 8) };
    });
    if (full || seg) {
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250);
      if (full) await page.screenshot({ path: path.join(SHOTS, name + "-full.png"), fullPage: true });
      if (seg) {
        const segH = Math.round(h * 1.25), total = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0, k = 0; y < total; y += segH, k++) await page.screenshot({ path: path.join(SHOTS, `${name}-seg${k}.png`), fullPage: true, clip: { x: 0, y, width: w, height: Math.min(segH, total - y) } });
      }
    }
    const ok = !errors.length && info.scrollW <= info.clientW && !info.over.length && info.h1 === 1 && !info.ext.length;
    if (!ok) bad++;
    console.log((ok ? "OK  " : "FAIL") + " " + pg + " " + w + "x" + h + " " + JSON.stringify({ ...info, errors }));
    await ctx.close();
  }
  await browser.close(); server.close();
  process.exitCode = bad ? 1 : 0;
});
