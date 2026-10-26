// Interaction smoke test for home and pricing.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site");
const T = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const f = path.join(SITE, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });
server.listen(0, async () => {
  const port = server.address().port, base = `http://127.0.0.1:${port}/`;
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1" } : undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage(); const logs = [], errs = [];
  pg.on("console", (m) => (m.type() === "error" ? errs : logs).push(m.text()));
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(base + "index.html"); await pg.waitForTimeout(800);
  const q = (s) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, s);
  console.log("sticky before consent:", await pg.evaluate(() => document.querySelector(".sticky-cta").className));
  await pg.click('[data-consent="granted"]'); await pg.waitForTimeout(400);
  await pg.evaluate(() => scrollTo(0, 1600)); await pg.waitForTimeout(500);
  console.log("sticky scrolled:", await pg.evaluate(() => document.querySelector(".sticky-cta").className));
  await pg.evaluate(() => scrollTo(0, 0)); await pg.waitForTimeout(500);
  console.log("sticky top:", await pg.evaluate(() => document.querySelector(".sticky-cta").className));
  // hero price stepper
  await pg.click('.pricer [data-step="1"]'); await pg.click('.pricer [data-step="1"]'); await pg.waitForTimeout(700);
  console.log("tile:", await q("[data-pricer-out]"), "| phone:", await q(".po-plan.is-sel .po-price .val"), "| nutrition:", await q(".po-plan:not(.is-sel) .po-price .val"));
  console.log("takehome price/keep:", await q('.takehome [data-out="price"]'), await q('.takehome [data-out="keep"]'), "| follower price input:", await pg.inputValue('[data-calc="follower"] [data-in="price"]'), "| best:", await q('[data-out="strong.revenue"]'));
  console.log("live:", await q(".pricer [data-live]"));
  // follower input
  await pg.fill('[data-calc="follower"] [data-in="followers"]', "20000"); await pg.waitForTimeout(700);
  console.log("follower 20000:", await q('[data-out="cautious.revenue"]'), await q('[data-out="typical.revenue"]'), await q('[data-out="strong.revenue"]'));
  // registration closed + roll
  await pg.click("#dev-btn"); await pg.waitForTimeout(200);
  await pg.click('[data-sw="registration"]'); await pg.click('[data-sw="roll"]'); await pg.click('[data-sw="payments"]');
  console.log("html attrs:", await pg.evaluate(() => [...document.documentElement.attributes].map((a) => a.name + "=" + a.value).join(" ")));
  console.log("hero cta visible text:", await pg.evaluate(() => document.querySelector('.hero .js-primary').innerText), "| href:", await pg.evaluate(() => document.querySelector('.hero .js-primary').getAttribute("href")));
  console.log("status live list:", await pg.evaluate(() => document.querySelector("#status .status-col--on").innerText.replace(/\n+/g, " | ")));
  await pg.keyboard.press("Escape");
  await pg.click('.pricer [data-step="1"]'); await pg.waitForTimeout(600);
  console.log("roll markup:", await pg.evaluate(() => document.querySelector("[data-pricer-out]").innerHTML.slice(0, 160)));
  // accordion + tabs
  await pg.click("#q-1 .acc-btn"); await pg.waitForTimeout(350);
  console.log("faq open:", await pg.evaluate(() => [document.querySelector("#q-1").className, document.querySelector("#q-1 .acc-btn").getAttribute("aria-expanded"), getComputedStyle(document.querySelector("#q-1-a")).visibility].join(" ")));
  await pg.focus("#hw-t0"); await pg.keyboard.press("ArrowRight"); await pg.keyboard.press("ArrowRight"); await pg.waitForTimeout(300);
  console.log("walk:", await pg.evaluate(() => document.activeElement.id + " " + !document.querySelector("#hw-p2").hidden + " " + document.querySelector("#hw-p2 [data-walk-count]").textContent));
  // menu
  await pg.click(".menu-btn"); await pg.waitForTimeout(350);
  console.log("menu:", await pg.evaluate(() => document.documentElement.classList.contains("menu-open") + " focus=" + document.activeElement.textContent.trim().slice(0, 20)));
  await pg.keyboard.press("Escape");
  // address
  await pg.fill("#addr-home", "Layla Strength"); await pg.waitForTimeout(200);
  console.log("address:", await q(".address-preview .ltr"), await pg.evaluate(() => document.querySelector("[data-claim]").getAttribute("href")));
  // pricing slider quick buttons
  const p2 = await ctx.newPage(); p2.on("pageerror", (e) => errs.push(e.message));
  await p2.goto(base + "pricing.html"); await p2.waitForTimeout(600);
  await p2.click('[data-share-n="1000"]'); await p2.waitForTimeout(500);
  console.log("pricing 1000:", await p2.evaluate(() => document.querySelector('.share-tool [data-out="rate"]').textContent.trim() + " pos=" + document.querySelector(".share-tool [data-rate-marker]").style.getPropertyValue("--pos")));
  console.log("sticky pricing top after consent:", await p2.evaluate(() => document.querySelector(".sticky-cta").className));
  console.log("errors:", errs);
  console.log("track sample:", logs.filter((l) => l.includes("tyTrack")).slice(0, 8).join(" || ").slice(0, 900));
  await b.close(); server.close();
});
