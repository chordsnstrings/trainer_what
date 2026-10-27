// Playwright QA for demo.html. Usage: node tools/qa.cjs <shots dir> [--quick]
// Viewports 390x844 and 1440x900; normal, reduced motion, and 4x CPU throttle.
const { chromium, webkit } = require("playwright");
const serve = require("./serve.cjs");
const path = require("path");
const OUT = process.argv[2], QUICK = process.argv.includes("--quick");
const PORT = 4591, URL = `http://localhost:${PORT}/demo.html`;
const srv = serve(path.join(__dirname, ".."), PORT);
const LANES = { t1: "sent", t2: "paused", t3: "off", t4: "member", t5: "sent", t6: "waits", t7: "learn", t8: "waits", t9: "waits", t10: "sent", t11: "paused", t12: "paused" };
const report = [];
const log = (...a) => { console.log(...a); report.push(a.join(" ")); };
const init = () => {
  window.__long = []; window.__lcp = null;
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { const e = l.getEntries().pop(); window.__lcp = e && e.element ? e.element.tagName + (e.element.id ? "#" + e.element.id : "") : null; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch (e) {}
};
const idle = (p) => p.waitForFunction(() => { const r = document.querySelector("#play"); return r && r._brainPlay && !r.querySelector('.bp-chip[aria-disabled="true"]'); }, null, { timeout: 45000 });
async function stats(p) { return p.evaluate(() => { const B = window.__B, g = B.stats.gaps, w = B.stats.work; return { frames: B.stats.frames, gapP95: +B.p95(g).toFixed(1), workP95: +B.p95(w).toFixed(2), workMax: +Math.max(0, ...w).toFixed(1), tier: B.tier.name, tierLog: B.tier.log, long: window.__long.slice() }; }); }
const resetStats = (p) => p.evaluate(() => { const s = window.__B.stats; s.frames = 0; s.gaps.length = 0; s.work.length = 0; window.__long.length = 0; });

async function config(b, w, h, { rm = false, cpu = 1, tag }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, reducedMotion: rm ? "reduce" : "no-preference" });
  await ctx.addInitScript(init);
  const p = await ctx.newPage();
  const errs = [];
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  p.on("requestfailed", (r) => !/fonts\.(googleapis|gstatic)/.test(r.url()) && errs.push("FAILED " + r.url()));
  if (cpu > 1) { const c = await ctx.newCDPSession(p); await c.send("Emulation.setCPUThrottlingRate", { rate: cpu }); }
  await p.goto(URL, { waitUntil: "load" });
  const out = { tag, errs, checks: [] };
  const check = (ok, msg) => out.checks.push((ok ? "PASS " : "FAIL ") + msg);
  await p.waitForTimeout(400);
  const lcp = await p.evaluate(() => window.__lcp);
  check(/^H1/.test(lcp || ""), `LCP element is the H1 (${lcp})`);
  await p.locator("#play").scrollIntoViewIfNeeded();
  await p.waitForFunction(() => document.querySelector("#play")?._brainPlay, null, { timeout: 15000 });
  await p.waitForTimeout(300);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
  await resetStats(p);
  // every trace
  const ids = QUICK || cpu > 1 ? ["t2", "t1", "t8", "t5"] : Object.keys(LANES);
  for (const id of ids) {
    await idle(p);
    if (w < 700) { // phone: chips 7–12 sit behind "More moments"
      const vis = await p.locator(`#play .bp-chip[data-t="${id}"]`).isVisible();
      if (!vis) await p.click("#play .bp-more");
    }
    await p.click(`#play .bp-chip[data-t="${id}"]`);
    await p.waitForTimeout(100);
    await idle(p);
    const lane = await p.evaluate(() => { const r = document.querySelector("#play .bp-res"); return r.querySelector(".bp-offcard") ? "off" : r.querySelector(".sc-lane:not(.is-ghost)")?.dataset.lane; });
    check(lane === LANES[id], `${id} lane ${lane} (want ${LANES[id]})`);
    if (id === "t2" && !rm) await p.locator("#play .bp-stage").screenshot({ path: `${OUT}/${tag}-t2-stop.png` });
    if (id === "t1") await p.locator("#play").screenshot({ path: `${OUT}/${tag}-t1.png` });
  }
  const st = await stats(p);
  out.frames = st;
  // settings: Omar with a 3% cap
  await p.click('#play .bp-chip[data-t="t1"]'); await idle(p);
  if (w < 700) await p.evaluate(() => (document.querySelector("#play .bp-change").open = true));
  await p.locator('#play input[data-k="capPct"]').fill("3");
  await p.waitForTimeout(250);
  const diff = await p.locator("#play .bp-why").innerText();
  check(/^Before: Sent on its own, within your rules\. Now: Waits for you\. Why: 2\.5 kg is 4\.2%, over your 3% cap\./.test(diff), `diff line: ${diff.slice(0, 90)}`);
  check(await p.locator("#play .sc-lane.is-ghost").count() === 1, "ghost of previous lane chip");
  check(await p.evaluate(() => document.querySelector('#play input[data-k="capPct"]').getAttribute("aria-valuetext")) === "3%", "slider aria-valuetext");
  await p.click("#play .bp-again"); await p.waitForTimeout(100); await idle(p);
  check(await p.evaluate(() => [...document.querySelectorAll("#play .bp-log [data-i]")].some((r) => /Draft writer/.test(r.textContent))), "replay swaps in the Draft writer");
  await p.locator('#play input[data-k="capPct"]').fill("5"); await p.waitForTimeout(200);
  // plans: 86 passes 0.862, 87 does not
  await p.click('#play .bp-chip[data-t="t10"]'); await idle(p);
  if (w < 700) await p.evaluate(() => (document.querySelector("#play .bp-change").open = true));
  await p.locator('#play input[data-k="bar"]').fill("87"); await p.waitForTimeout(250);
  check(await p.evaluate(() => document.querySelector("#play .bp-res .sc-lane:not(.is-ghost)").dataset.lane) === "waits", "Fatima at 87% waits");
  await p.locator('#play input[data-k="bar"]').fill("86"); await p.waitForTimeout(250);
  check(await p.evaluate(() => document.querySelector("#play .bp-res .sc-lane:not(.is-ghost)").dataset.lane) === "sent", "Fatima at 86% sends");
  await p.locator('#play input[data-k="bar"]').fill("80"); await p.waitForTimeout(200);
  // free text
  await p.fill("#play textarea", "my chest hurts and I feel dizzy"); await p.click("#play .bp-free button"); await p.waitForTimeout(100); await idle(p);
  const cl = await p.locator("#play .bp-closest").innerText();
  check(cl === "Closest sample: Chest pain (Arabic). This page can't read new messages.", `free text: ${cl}`);
  // keyboard: Tab to a chip and Enter
  await p.focus('#play .bp-chip[data-t="t6"]'); await p.keyboard.press("Enter"); await p.waitForTimeout(100); await idle(p);
  check(await p.evaluate(() => document.querySelector('#play .bp-chip[data-t="t6"]').getAttribute("aria-pressed")) === "true", "chip runs from the keyboard");
  if (w < 700) await p.evaluate(() => (document.querySelector("#play .bp-change").open = true));
  await p.focus('#play [role="radio"][data-k="level"][aria-checked="true"]'); await p.keyboard.press("ArrowLeft"); await p.waitForTimeout(150);
  check(await p.evaluate(() => document.querySelector('#play [role="radio"][data-k="level"][data-v="1"]').getAttribute("aria-checked")) === "true", "radio group arrow keys");
  await p.click('#play [role="radio"][data-k="level"][data-v="2"]');
  // live region announced the result
  check(await p.evaluate(() => /Result: /.test(document.querySelector('[aria-live="polite"].sc-sr')?.textContent || "") || /Waits|Sent|paused/.test(document.querySelector('[aria-live="polite"].sc-sr')?.textContent || "")), "polite live region announces visitor-caused results");
  // throw them all
  await resetStats(p);
  await p.click("#play .bp-all-b");
  await p.waitForFunction(() => document.querySelector("#play .bp-totals")?.textContent, null, { timeout: 30000 });
  const tot = await p.locator("#play .bp-totals").innerText();
  check(tot === "In this sample: 3 within your rules · 1 member check · 3 waited · 3 paused · 1 new rule", `totals: ${tot}`);
  await p.locator("#play .bp-stage").screenshot({ path: `${OUT}/${tag}-all.png` });
  out.framesAll = await stats(p);
  await p.click("#play .bp-back");
  // pause: no frames while paused
  await p.click("#play .bp-pause"); await resetStats(p); await p.waitForTimeout(800);
  const pf = await p.evaluate(() => window.__B.stats.frames);
  check(pf <= 1, `Pause stops the loop (${pf} frames in 0.8 s after the press)`);
  await p.click("#play .bp-pause");
  // offscreen: no frames
  await p.locator("#fig").scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  const of = await p.evaluate(() => { const s = document.querySelector("#play")._brainPlay.scene; return { running: s.running, reasons: [...s.reasons] }; });
  check(!of.running && of.reasons.includes("offscreen"), `offscreen pauses the playground scene (${JSON.stringify(of)})`);
  // hidden tab
  await p.locator("#play").scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
  await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await resetStats(p); await p.waitForTimeout(800);
  const hf = await p.evaluate(() => window.__B.stats.frames);
  check(hf <= 1, `hidden tab stops the loop (${hf} frames in 0.8 s)`);
  await p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  // idle pause (scene with a 1 s idle)
  const idleOk = await p.evaluate(() => new Promise((res) => { const B = window.__B, el = document.querySelector("#play .bp-stage"), sc = B.scene(el, { idle: 1 }); sc.loop(() => true); setTimeout(() => { const r = [...sc.reasons]; sc.destroy(); res(r); }, 2600); }));
  check(idleOk.includes("idle"), `idle pauses a scene (${idleOk})`);
  // receipts: open each, check dialog, Esc returns focus
  await p.locator("#rlist").scrollIntoViewIfNeeded();
  const rids = QUICK || cpu > 1 ? ["t1", "t2", "t8"] : Object.keys(LANES);
  for (const id of rids) {
    await p.click(`#rlist button[data-t="${id}"]`);
    await p.waitForSelector(".ba-sheet.is-flat", { timeout: 15000 });
    await p.waitForTimeout(rm ? 100 : 700);
    const info = await p.evaluate(() => { const s = document.querySelector(".ba-sheet"); return { role: s.getAttribute("role"), modal: s.getAttribute("aria-modal"), label: !!document.getElementById(s.getAttribute("aria-labelledby")), focusIn: s.contains(document.activeElement), secs: s.querySelectorAll(".ba-sec").length, mode: s.dataset.mode }; });
    check(info.role === "dialog" && info.modal === "true" && info.label && info.focusIn && info.secs === 7, `${id} receipt dialog ${JSON.stringify(info)}`);
    if (["t1", "t2", "t7", "t8"].includes(id)) await p.screenshot({ path: `${OUT}/${tag}-receipt-${id}.png` });
    await p.keyboard.press("Escape"); await p.waitForTimeout(150);
    check(await p.evaluate((i) => !document.querySelector(".ba-sheet") && document.activeElement?.dataset?.t === i, id), `${id} Esc closes and returns focus`);
  }
  // inline receipt (A's zoom)
  await p.check("#inline"); await p.click('#rlist button[data-t="t5"]'); await p.waitForTimeout(rm ? 200 : 1600);
  await p.locator("#inline-host").screenshot({ path: `${OUT}/${tag}-inline-t5.png` });
  await p.uncheck("#inline");
  // C stack and Fig. 4
  await p.locator("#stack").scrollIntoViewIfNeeded(); await p.waitForFunction(() => window.__stack, null, { timeout: 10000 }); await p.waitForTimeout(rm ? 200 : 1400);
  for (const v of w > 700 ? [0, 0.1, 0.27, 0.5, 0.84, 0.96] : [0, 0.5]) {
    await p.evaluate((x) => window.__stack.progress(x), v); await p.waitForTimeout(120);
    await p.locator("#stack").screenshot({ path: `${OUT}/${tag}-stack-${v}.png` });
  }
  await p.locator("#fig").scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
  await p.click('#fig [data-w="knee"]'); await p.waitForTimeout(rm ? 200 : 2700);
  await p.locator("#fig").screenshot({ path: `${OUT}/${tag}-fig-knee.png` });
  // a11y basics: names, labels, hidden canvases, contrast on the stage
  const a11y = await p.evaluate(() => {
    const bad = [];
    document.querySelectorAll("button, a[href], [role=radio]").forEach((e) => { if (e.offsetParent && !(e.getAttribute("aria-label") || e.textContent.trim())) bad.push("unnamed " + e.outerHTML.slice(0, 60)); });
    document.querySelectorAll("input, select, textarea").forEach((e) => { if (!(e.labels && e.labels.length) && !e.getAttribute("aria-label")) bad.push("unlabelled " + e.outerHTML.slice(0, 60)); });
    document.querySelectorAll("canvas").forEach((c) => c.getAttribute("aria-hidden") !== "true" && bad.push("canvas not hidden"));
    document.querySelectorAll("svg.sc-ic").forEach((s) => s.getAttribute("aria-hidden") !== "true" && bad.push("icon not hidden"));
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const bg = (e) => { while (e) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(.*, 0\)|transparent/.test(c) && !/rgba\(.*, 0\.\d+\)/.test(c)) return c; e = e.parentElement; } return "rgb(255,255,255)"; };
    let min = 99, worst = "";
    document.querySelectorAll("#play .sc-stage *").forEach((e) => {
      if (!e.offsetParent || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
      const cs = getComputedStyle(e); if (+cs.opacity < 1 || e.closest("[data-state=skip], .is-dim, [data-off], .bp-shell.is-dim")) return;
      const a = lum(cs.color), b2 = lum(bg(e)), r = (Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05);
      if (r < min) { min = r; worst = e.className + " '" + e.textContent.trim().slice(0, 30) + "'"; }
    });
    return { bad, minContrast: +min.toFixed(2), worst, live: document.querySelectorAll('[aria-live="polite"]').length };
  });
  check(!a11y.bad.length, `a11y names/labels/hidden: ${a11y.bad.slice(0, 4).join(" | ") || "ok"}`);
  check(a11y.minContrast >= 4.5, `min text contrast on the stage ${a11y.minContrast}:1 (${a11y.worst})`);
  check(!errs.length, `console errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "none"}`);
  await ctx.close();
  return out;
}

(async () => {
  const b = await chromium.launch();
  const runs = [];
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    runs.push(await config(b, w, h, { tag: `c${w}` }));
    runs.push(await config(b, w, h, { rm: true, tag: `c${w}-rm` }));
    runs.push(await config(b, w, h, { cpu: 4, tag: `c${w}-cpu4` }));
  }
  // watchdog: force slow frames
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await ctx.newPage();
    await p.goto(URL.replace("demo.html", "demo.html?slow=30"));
    await p.locator("#play").scrollIntoViewIfNeeded(); await p.waitForFunction(() => document.querySelector("#play")?._brainPlay);
    await p.click('#play .bp-chip[data-t="t7"]'); await p.waitForTimeout(5000);
    const t = await p.evaluate(() => ({ tier: window.__B.tier.name, log: window.__B.tier.log }));
    log("WATCHDOG", JSON.stringify(t), t.tier !== "full" ? "PASS steps down" : "FAIL no step down");
    await ctx.close();
  }
  // no JS: the playground shows t1 resolved as static HTML
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, javaScriptEnabled: false }), p = await ctx.newPage();
    await p.goto(URL); await p.locator("#play").scrollIntoViewIfNeeded();
    const s = await p.evaluate(() => ({ lane: document.querySelector("#play .bp-res .sc-lane")?.dataset.lane, phone: !!document.querySelector("#play .sc-phone"), nodes: [...document.querySelectorAll('#play .sc-node[data-state]:not([data-state="idle"])')].length, overflow: document.documentElement.scrollWidth > innerWidth }));
    await p.locator("#play").screenshot({ path: `${OUT}/nojs-${w}.png` });
    log(`NO-JS ${w}`, s.lane === "sent" && s.phone && s.nodes >= 7 && !s.overflow ? "PASS t1 resolved" : "FAIL " + JSON.stringify(s));
    await ctx.close();
  }
  // recovery flag on: t3 plays and the totals read 4
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), p = await ctx.newPage();
    await p.goto(URL + "?recovery=on"); await p.locator("#play").scrollIntoViewIfNeeded(); await p.waitForFunction(() => document.querySelector("#play")?._brainPlay);
    await p.click('#play .bp-chip[data-t="t3"]'); await idle(p);
    const lane = await p.evaluate(() => document.querySelector("#play .bp-res .sc-lane")?.dataset.lane);
    await p.locator("#play").screenshot({ path: `${OUT}/flag-t3.png` });
    await p.click("#play .bp-all-b"); await p.waitForFunction(() => document.querySelector("#play .bp-totals")?.textContent, null, { timeout: 30000 });
    const tot = await p.locator("#play .bp-totals").innerText();
    log("RECOVERY FLAG", lane === "sent" ? "PASS t3 sent" : "FAIL t3 " + lane, tot.startsWith("In this sample: 4 within your rules") ? "PASS totals 4" : "FAIL " + tot);
    await ctx.close();
  }
  await b.close();
  for (const r of runs) {
    log(`\n== ${r.tag}`);
    log("frames (runs):", JSON.stringify(r.frames));
    log("frames (throw all):", JSON.stringify(r.framesAll));
    r.checks.forEach((c) => log(c));
  }
  // WebKit (iPhone): fallbacks for requestIdleCallback and OffscreenCanvas, 3D stage
  try {
    const wk = await webkit.launch();
    const ctx = await wk.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(), errs = [];
    p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await p.goto(URL); await p.locator("#play").scrollIntoViewIfNeeded();
    await p.waitForFunction(() => document.querySelector("#play")?._brainPlay, null, { timeout: 15000 });
    await p.tap('#play .bp-chip[data-t="t2"]'); await idle(p);
    const lane = await p.evaluate(() => document.querySelector("#play .bp-res .sc-lane")?.dataset.lane);
    await p.locator("#play .bp-stage").screenshot({ path: `${OUT}/webkit-t2.png` });
    const env = await p.evaluate(() => ({ ric: "requestIdleCallback" in window, osc: "OffscreenCanvas" in window, tier: window.__B.tier.name, webkit: window.__B.webkit }));
    await p.locator("#rlist").scrollIntoViewIfNeeded(); await p.tap('#rlist button[data-t="t8"]'); await p.waitForSelector(".ba-sheet.is-flat"); await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/webkit-receipt-t8.png` });
    log("\n== webkit 390", lane === "paused" ? "PASS t2 paused" : "FAIL " + lane, JSON.stringify(env), "errors:", errs.length ? errs.join(" | ") : "none");
    await wk.close();
  } catch (e) { log("\n== webkit skipped:", e.message.split("\n")[0]); }
  srv.close();
  require("fs").writeFileSync(path.join(OUT, "qa-report.txt"), report.join("\n"));
})();
