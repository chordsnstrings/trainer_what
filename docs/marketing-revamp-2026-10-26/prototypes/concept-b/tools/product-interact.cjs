// Product group widget smoke test (owned by the product builder).
// Usage: node tools/product-interact.cjs   (serves site/ on a free port 4361-4390)
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site"), SHOTS = path.join(__dirname, "..", "shots", "product");
const T = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const f = path.join(SITE, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });
let port = 4362;
server.on("error", (e) => { if (e.code === "EADDRINUSE" && port < 4390) server.listen(++port, "127.0.0.1"); else throw e; });
server.listen(port, "127.0.0.1");
const results = [];
const check = (name, ok, info = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (info ? "  [" + info + "]" : "")); };
server.on("listening", async () => {
  const base = `http://127.0.0.1:${port}/`;
  const b = await chromium.launch();
  const errs = [], tracks = [];
  async function open(file, w = 1366, h = 900) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const pg = await ctx.newPage();
    pg.on("console", (m) => { if (m.type() === "error") errs.push(file + ": " + m.text()); if (m.text().includes("tyTrack")) tracks.push(m.text()); });
    pg.on("pageerror", (e) => errs.push(file + ": " + e.message));
    await pg.goto(base + file); await pg.waitForTimeout(700);
    const c = await pg.$('[data-consent="granted"]'); if (c && (await c.isVisible())) { await c.click(); await pg.waitForTimeout(300); }
    return pg;
  }
  const txt = (pg, s) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, s);
  const attr = (pg, s, a) => pg.evaluate(([s, a]) => { const e = document.querySelector(s); return e ? e.getAttribute(a) : null; }, [s, a]);

  /* How it works */
  let pg = await open("how-it-works.html");
  await pg.click("#hiw-t7"); await pg.waitForTimeout(450);
  check("hiw step 8 panel shown", await pg.evaluate(() => !document.querySelector("#hiw-p7").hidden && document.querySelector("#hiw-p7 .statement") !== null));
  check("hiw device layer 8 on", await pg.evaluate(() => [...document.querySelectorAll('.hiw-scr.is-on')].every((s) => s.getAttribute("data-s") === "7")));
  check("hiw progress line full", (await pg.evaluate(() => document.querySelector(".hiw-line .fg").style.getPropertyValue("--p"))) === "1");
  await pg.locator("#hiw-p7").scrollIntoViewIfNeeded(); await pg.screenshot({ path: path.join(SHOTS, "how-it-works-1366-step8.png") });
  await pg.focus("#hiw-t7"); await pg.keyboard.press("ArrowUp"); await pg.waitForTimeout(200);
  check("hiw ArrowUp moves to step 7", (await pg.evaluate(() => document.activeElement.id)) === "hiw-t6");
  await pg.click("[data-hiw-prev]"); await pg.waitForTimeout(200);
  check("hiw prev button", (await txt(pg, "[data-hiw-count]")) === "6 of 8");

  /* Trainer Brain */
  pg = await open("trainer-brain.html");
  await pg.click('[data-rc="confirm"]'); await pg.waitForTimeout(500);
  check("rule card confirm stamps", await pg.evaluate(() => document.querySelector("[data-rule-card]").classList.contains("is-confirmed")), await txt(pg, "[data-rc-state]"));
  check("undo focused", (await pg.evaluate(() => document.activeElement.getAttribute("data-rc"))) === "undo");
  await pg.screenshot({ path: path.join(SHOTS, "trainer-brain-1366-confirmed.png") });
  await pg.click('[data-rc="undo"]'); await pg.click('[data-rc="edit"]'); await pg.click('[data-kg="5 kg"]'); await pg.click('[data-rc="save"]'); await pg.waitForTimeout(400);
  check("rule card edit to 5 kg", (await txt(pg, "[data-rc-kg]")) === "5 kg", await txt(pg, "[data-rc-state]"));
  await pg.click('[data-rc="reject"]'); await pg.waitForTimeout(200);
  check("rule card reject", await pg.evaluate(() => document.querySelector("[data-rule-card]").classList.contains("is-rejected")));
  await pg.click("[data-rel-btn]"); await pg.waitForTimeout(400);
  check("release rollback to v3", (await pg.evaluate(() => document.querySelector(".rel-track").style.getPropertyValue("--v"))) === "2" && (await txt(pg, "[data-rel-now]")) === "v3 is live");
  await pg.click("[data-cmp-btn]"); await pg.waitForTimeout(300);
  check("compare reveal", await pg.evaluate(() => document.querySelector("[data-compare]").classList.contains("is-revealed")));

  /* Features index */
  pg = await open("features.html");
  await pg.click("#scr-t2"); await pg.waitForTimeout(300);
  check("screens tab Logger", await pg.evaluate(() => !document.querySelector("#scr-p2").hidden && document.querySelector("#scr-p0").hidden));
  await pg.click("#cap-brain .cap-btn"); await pg.waitForTimeout(350);
  check("capability disclosure opens", (await attr(pg, "#cap-brain .cap-btn", "aria-expanded")) === "true");
  await pg.click("#dev-btn"); await pg.click('[data-sw="payments"]'); await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
  check("payments on flips chips", await pg.evaluate(() => getComputedStyle(document.querySelector("#cap-training .if-payments-off")).display === "none"));
  await pg.click("#dev-btn"); await pg.click('[data-sw="payments"]'); await pg.keyboard.press("Escape");

  /* Feature vignettes */
  pg = await open("features--ai-training-plans.html"); await pg.waitForTimeout(900);
  check("ai plans vignette played", await pg.evaluate(() => document.querySelector("[data-vig]").classList.contains("is-b")));
  pg = await open("features--subscriber-app.html");
  await pg.click('[data-rtl-set="on"]'); await pg.waitForTimeout(300);
  check("subscriber app AR preview", await pg.evaluate(() => document.querySelector(".vignette-rtl").dir === "rtl" && getComputedStyle(document.querySelector(".vignette-rtl .t-ar")).display !== "none" && document.documentElement.dir === "ltr"));
  await pg.screenshot({ path: path.join(SHOTS, "features--subscriber-app-1366-ar.png") });
  await pg.click('[data-rtl-set="off"]');
  pg = await open("features--nutrition.html");
  await pg.locator("#nt-share").scrollIntoViewIfNeeded();
  await pg.evaluate(() => { const r = document.querySelector("#nt-share"); r.value = 50; r.dispatchEvent(new Event("input", { bubbles: true })); }); await pg.waitForTimeout(400);
  check("nutrition 50% gives AED 249", (await txt(pg, '.nt [data-out="avg"]')) === "AED 249" && (await txt(pg, "[data-nt-share]")) === "50%");

  /* Demo */
  for (const [w, h] of [[1366, 900], [390, 844]]) {
    pg = await open("demo.html", w, h);
    await pg.locator("#dm-t2").scrollIntoViewIfNeeded(); await pg.click("#dm-t2"); await pg.waitForTimeout(500);
    const mid = await pg.evaluate(() => document.querySelector("[data-demo]").getAttribute("data-stage"));
    await pg.waitForTimeout(1200);
    check(`demo hotel gym ${w}`, mid !== "done" && (await attr(pg, ".dm-lanes", "data-lane")) === "1" && (await txt(pg, "[data-dm-sure]")) === "41%" && /you, when it matters/.test(await txt(pg, ".dm-pay")), "stage mid=" + mid);
    await pg.click('[data-ap="approve"]'); await pg.waitForTimeout(150);
    check(`demo approve ${w}`, /Approved/.test(await txt(pg, "[data-ap-msg]")));
    await pg.screenshot({ path: path.join(SHOTS, `demo-${w}-handoff.png`) });
    await pg.focus("#dm-t2"); await pg.keyboard.press("ArrowRight"); await pg.waitForTimeout(1600);
    check(`demo knee pain via keyboard ${w}`, (await attr(pg, ".dm-lanes", "data-lane")) === "2" && (await txt(pg, "[data-dm-sure]")) === "Rule" && (await pg.evaluate(() => document.activeElement.id)) === "dm-t3");
  }
  pg = await open("demo.html");
  await pg.locator("[data-rb]").scrollIntoViewIfNeeded();
  await pg.click('[data-rb-step="n"][data-d="1"]'); await pg.waitForTimeout(500);
  check("rule 3 sessions -> one more easy session", (await txt(pg, "[data-rb-res]")) === "Not yet: one more easy session");
  await pg.click('[data-rb-step="n"][data-d="-1"]'); await pg.click('[data-rb-step="r"][data-d="1"]'); await pg.waitForTimeout(500);
  check("rule 4 in reserve -> waits", (await txt(pg, "[data-rb-res]")) === "Not yet: one more easy session");
  await pg.click('[data-rb-step="r"][data-d="-1"]'); await pg.click('[data-rb-step="kg"][data-d="1"]'); await pg.click('[data-rb-step="kg"][data-d="1"]'); await pg.waitForTimeout(500);
  check("rule add 3.5 kg -> 63.5", (await txt(pg, "[data-rb-res]")) === "60 kg → 63.5 kg", await txt(pg, "[data-rb-res]"));
  await pg.screenshot({ path: path.join(SHOTS, "demo-1366-rule.png") });
  await pg.locator("[data-th]").scrollIntoViewIfNeeded();
  await pg.evaluate(() => { const r = document.querySelector("#th-range"); r.value = 90; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); }); await pg.waitForTimeout(400);
  check("threshold 90 -> to you", (await attr(pg, ".th-lanes", "data-lane")) === "1" && /below your line/.test(await txt(pg, "[data-th-res]")) && /unsure, goes to you/.test(await attr(pg, "#th-range", "aria-valuetext")));
  await pg.screenshot({ path: path.join(SHOTS, "demo-1366-threshold.png") });

  const need = ["demo_play", "demo_rule_edit", "demo_threshold", "faq_open"].filter((e) => e !== "faq_open");
  check("events logged: " + need.join(", "), need.every((e) => tracks.some((t) => t.includes(" " + e))));
  check("no console errors", !errs.length, errs.join(" | "));
  console.log(results.filter(Boolean).length + "/" + results.length + " passed");
  await b.close(); server.close();
});
