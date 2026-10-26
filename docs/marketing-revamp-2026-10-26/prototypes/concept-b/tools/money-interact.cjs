// Money group interaction test: earnings and follower calculators.
// Serves site/ on PORT (default 4362) and drives every widget, comparing the
// page's figures with TYCalc (the same maths) for the inputs it set.
// Usage: node tools/money-interact.cjs
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site");
const T = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });
const PORT = +(process.env.PORT || 4362);
let fails = 0;
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? "ok   " : "FAIL ") + name + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); };

server.listen(PORT, "127.0.0.1", async () => {
  const base = `http://127.0.0.1:${PORT}/`;
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1" } : undefined });
  const errs = [], tracks = [];
  const hook = (pg) => { pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); if (m.text().includes("tyTrack")) tracks.push(m.text().split(" ")[1]); }); pg.on("pageerror", (e) => errs.push(e.message)); };
  const txt = (pg, s) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? (e.getAttribute("data-v") || e.textContent).replace(/\s+/g, " ").trim() : null; }, s);
  const wait = (pg, ms = 650) => pg.waitForTimeout(ms);

  /* ------------------------- Earnings, desktop ------------------------- */
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const pg = await ctx.newPage(); hook(pg);
  await pg.goto(base + "earnings-calculator.html"); await wait(pg);
  await pg.click('[data-consent="granted"]');
  const E = '.mx-ecalc ';
  ok("defaults", (await txt(pg, E + '[data-out="keep"]')) === "AED 10,305" && (await txt(pg, E + '[data-out="avg"]')) === "AED 229" && (await txt(pg, E + '[data-out="revenue"]')) === "AED 13,740" && (await txt(pg, E + '[data-out="commission"]')) === "−AED 3,435" && (await txt(pg, E + '[data-out="sessions"]')) === "41");
  ok("shared element target", await pg.evaluate(() => { const r = document.querySelector('[data-vt="price-tile"]'); return r && r.getAttribute("data-vt-from") === "index.html" && r.getBoundingClientRect().top < innerHeight; }));
  const expectKeep = (inputs) => pg.evaluate((i) => TYCalc.aed(TYCalc.estimateEarnings(Object.assign({}, TYCalc.DEFAULT_EARNINGS_INPUTS, i)).beforeOtherCostsMinor).replace(/\s+/g, " "), inputs);

  await pg.fill('input[data-mirror="ec-subs"]', "150"); await wait(pg);
  const s1 = [await pg.inputValue("#ec-subs"), await txt(pg, E + '[data-out="keep"]'), await expectKeep({ subscribers: 150 })];
  ok("subscriber slider drives number and result", s1[0] === "150" && s1[1] === s1[2], s1);
  await pg.fill("#ec-subs", "1200"); await wait(pg);
  const sl = await pg.inputValue('input[data-mirror="ec-subs"]');
  const fills = await pg.evaluate(() => [...document.querySelectorAll(".mx-ecalc [data-band-fill]")].map((e) => e.style.getPropertyValue("--fill")));
  ok("typed subscribers move slider and band bars", sl === "1200" && fills.join(",") === "1,1,1,0.4", { sl, fills });
  ok("band breakdown text", (await txt(pg, E + '[data-out="band.3.subs"]')) === "200" && (await txt(pg, E + '[data-out="rate"]')) === (await pg.evaluate(() => TYCalc.pct1(TYCalc.estimateEarnings(Object.assign({}, TYCalc.DEFAULT_EARNINGS_INPUTS, { subscribers: 1200 })).effectiveCommissionPct))));
  await pg.click('.mx-seg label:nth-of-type(2)'); await wait(pg);
  const up = await pg.evaluate(() => [document.querySelector(".mx-ecalc").getAttribute("data-billing"), getComputedStyle(document.querySelector("#ec-months").closest(".field")).display, document.querySelector('label[for="ec-price"]').innerText.trim()]);
  ok("billing upfront shows months and relabels price", up[0] === "upfront" && up[1] !== "none" && up[2].startsWith("Workout programme price"), up);
  const u1 = [await txt(pg, E + '[data-out="keep"]'), await expectKeep({ subscribers: 1200, billing: "upfront" })];
  ok("upfront maths", u1[0] === u1[1], u1);
  await pg.fill('#ec-nshare', "50"); await wait(pg);
  ok("nutrition share figure", (await txt(pg, '[data-show-of="nutritionShare"]')) === "50%");
  // Share: no Web Share in headless, so the copy fallback toasts the URL.
  await pg.click(".mx-res [data-share-calc]"); await wait(pg, 400);
  const toast = await txt(pg, ".toast");
  const shareUrl = (toast.match(/https?:\S+/) || [])[0] || (await pg.evaluate(() => navigator.clipboard.readText().catch(() => "")));
  ok("share link carries inputs", /subs=1200/.test(shareUrl || "") && /billing=upfront/.test(shareUrl || "") && /nutrition=50/.test(shareUrl || ""), { toast, shareUrl });
  if (shareUrl) {
    const p2 = await ctx.newPage(); hook(p2);
    await p2.goto(shareUrl); await wait(p2);
    ok("restore from shared link", (await p2.inputValue("#ec-subs")) === "1200" && (await p2.evaluate(() => document.querySelector(".mx-ecalc").getAttribute("data-billing"))) === "upfront" && (await txt(p2, E + '[data-out="keep"]')) === (await txt(pg, E + '[data-out="keep"]')));
    await p2.close();
  }
  await pg.click("[data-example]"); await wait(pg, 900);
  ok("worked example loads into calculator", (await txt(pg, E + '[data-out="keep"]')) === "AED 18,109" && (await txt(pg, E + '[data-out="rate"]')) === "24.2%", await txt(pg, E + '[data-out="keep"]'));
  await pg.fill("#br-followers", "20000"); await wait(pg);
  const typ = await pg.evaluate(() => TYCalc.displayCount(TYCalc.estimateFollowerConversion(Object.assign({}, TYCalc.DEFAULT_FOLLOWER_INPUTS, { followers: 20000 })).scenarios.typical.activeMonth12) || 0);
  await pg.click('[data-pick="typical"]'); await wait(pg, 900);
  ok("bridge pick sets subscribers", (await pg.inputValue("#ec-subs")) === String(typ), { typ, got: await pg.inputValue("#ec-subs") });
  // Decision 8 off: no price on links; on: price_aed + the price line.
  const cta = () => pg.evaluate(() => document.querySelector(".mx-res .js-primary").getAttribute("href"));
  ok("price not carried by default", !/price_aed/.test(await cta()), await cta());
  await pg.click("#dev-btn"); await wait(pg, 200);
  await pg.click("[data-mx-sw]"); await wait(pg, 300);
  ok("decision 8 carries price", /price_aed=199/.test(await cta()) && (await pg.evaluate(() => getComputedStyle(document.querySelector(".mx-res .mx-d8")).display)) !== "none", await cta());
  await pg.click("[data-mx-sw]");
  await pg.click('[data-sw="registration"]'); await wait(pg, 200);
  const closed = await pg.evaluate(() => { const a = document.querySelector(".mx-res .js-primary"); return [a.innerText.trim(), a.getAttribute("href")]; });
  ok("registration closed variant", closed[0].startsWith("Join early access") && closed[1] === "signup.html#early-access", closed);
  await pg.click('[data-sw="registration"]');
  await pg.click('[data-sw="roll"]'); await pg.keyboard.press("Escape");
  await pg.fill("#ec-subs", "333"); await wait(pg, 700);
  const roll = await pg.evaluate(() => { const v = document.querySelector('.mx-ecalc [data-out="keep"]'); const sr = v.querySelector(".sr-only"); return [sr && sr.textContent, v.getAttribute("data-v"), !!v.querySelector(".roll-strip")]; });
  ok("digit roll keeps the real value as text", roll[0] === roll[1] && roll[2], roll);
  await pg.click("#dev-btn"); await pg.click('[data-sw="roll"]'); await pg.keyboard.press("Escape");
  // Keyboard on the subscriber slider
  await pg.focus('input[data-mirror="ec-subs"]'); await pg.keyboard.press("ArrowRight"); await wait(pg, 300);
  ok("keyboard on slider", (await pg.inputValue("#ec-subs")) === "334", await pg.inputValue("#ec-subs"));
  // FAQ
  await pg.click("#eq-1 .acc-btn"); await wait(pg, 350);
  ok("faq opens", (await pg.getAttribute("#eq-1 .acc-btn", "aria-expanded")) === "true");
  ok("live region filled", ((await txt(pg, ".mx-res [data-live]")) || "").startsWith("You keep"));
  await ctx.close();

  /* ------------------------- Follower, phone --------------------------- */
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const f = await c2.newPage(); hook(f);
  await f.goto(base + "follower-calculator.html"); await wait(f);
  await f.click('[data-consent="granted"]');
  const F = ".mx-fcalc ";
  ok("follower defaults", (await txt(f, F + '[data-out="cautious.revenue"]')) === "AED 398" && (await txt(f, F + '[data-out="typical.revenue"]')) === "AED 2,985" && (await txt(f, F + '[data-out="strong.revenue"]')) === "AED 23,084");
  const est = (i) => f.evaluate((i) => { const e = TYCalc.estimateFollowerConversion(Object.assign({}, TYCalc.DEFAULT_FOLLOWER_INPUTS, i)); return ["cautious", "typical", "strong"].map((k) => TYCalc.aed(e.scenarios[k].revenueMonth12Minor).replace(/\s+/g, " ")); }, i);
  const got = () => Promise.all(["cautious", "typical", "strong"].map((k) => txt(f, F + `[data-out="${k}.revenue"]`)));
  await f.fill('input[data-mirror="fc-followers"]', "260"); await wait(f);
  const fol = +(await f.inputValue("#fc-followers"));
  ok("log slider sets a rounded follower count", fol === 40000 || fol === 39800, fol);
  const g1 = [await got(), await est({ followers: fol })];
  ok("columns match the maths", JSON.stringify(g1[0]) === JSON.stringify(g1[1]), g1);
  await f.click('[data-step-by="1"]'); await wait(f);
  ok("stepper adds a Story", (await f.inputValue("#fc-stories")) === "9" && JSON.stringify(await got()) === JSON.stringify(await est({ followers: fol, linkStoriesPerMonth: 9 })));
  await f.fill("#fc-price", "249"); await wait(f);
  ok("price reaches the sample offer page", (await txt(f, '.mx-claim-stage [data-show-price="0"]')) === "AED 249" && (await txt(f, '.mx-claim-stage [data-show-price="100"]')) === "AED 349");
  await f.click('[aria-controls="fc-more"]'); await wait(f, 350);
  ok("more inputs opens", (await f.getAttribute('[aria-controls="fc-more"]', "aria-expanded")) === "true" && (await f.evaluate(() => getComputedStyle(document.getElementById("fc-more")).visibility)) === "visible");
  await f.fill("#fc-views", "2000"); await wait(f);
  ok("story views change method line", ((await txt(f, '[data-method="views"]')) || "").startsWith("Using your 2,000"));
  const lever = await f.evaluate(() => {
    const read = (id, k) => document.querySelector(`[data-lever="${id}"] [data-lever-out="${k}"]`).getAttribute("data-v") || document.querySelector(`[data-lever="${id}"] [data-lever-out="${k}"]`).textContent.trim();
    const i = { followers: +document.getElementById("fc-followers").value, priceAed: 249, linkStoriesPerMonth: 9, storyViews: 2000 };
    const l = TYCalc.followerLevers(Object.assign({}, TYCalc.DEFAULT_FOLLOWER_INPUTS, i)).find((x) => x.id === "moreStories");
    return [read("moreStories", "revenueMonth12Minor").replace(/\s+/g, " "), ("+" + TYCalc.aed(l.revenueMonth12Minor)).replace(/\s+/g, " ")];
  });
  ok("lever gains follow the maths", lever[0] === lever[1], lever);
  ok("best-case spark peaks at full height", (await f.evaluate(() => [...document.querySelectorAll('[data-spark] i')].some((i) => i.style.getPropertyValue("--v") === "1.0000"))));
  await f.fill("#addr-fc", "Sara Fit"); await wait(f, 300);
  ok("address preview drives the phone and claim link", (await txt(f, ".mx-claim-stage .phone-url span")) === "sara-fit.trainsyou.com" && (await txt(f, ".mx-claim-stage .po-brand b")) === "Sara Fit" && /^signup\.html\?slug=sara-fit/.test(await f.getAttribute("[data-claim]", "href")), await f.getAttribute("[data-claim]", "href"));
  await f.click('[aria-controls="fm-1"]'); await wait(f, 350);
  ok("method step opens", (await f.getAttribute('[aria-controls="fm-1"]', "aria-expanded")) === "true");
  await f.focus('input[data-mirror="fc-followers"]'); const before = await f.inputValue("#fc-followers"); await f.keyboard.press("ArrowRight"); await wait(f, 300);
  ok("keyboard on log slider", (await f.inputValue("#fc-followers")) !== before, [before, await f.inputValue("#fc-followers"), await f.inputValue('input[data-mirror="fc-followers"]')]);
  // Sticky CTA: hidden at the top, shown once the result's CTA has passed.
  // Step through the page (an instant jump past the CTA never fires the observer; see report).
  for (let y = 0; y < 4000; y += 400) { await f.evaluate((yy) => scrollTo({ top: yy, behavior: "instant" }), y); await wait(f, 60); }
  for (let y = 4000; y > 0; y -= 400) { await f.evaluate((yy) => scrollTo({ top: yy, behavior: "instant" }), y); await wait(f, 60); }
  await f.evaluate(() => scrollTo({ top: 0, behavior: "instant" })); await wait(f, 400);
  const top = await f.evaluate(() => document.querySelector(".sticky-cta").classList.contains("is-shown"));
  const claimY = await f.evaluate(() => document.querySelector("#claim").offsetTop);
  for (let y = 0; y <= claimY; y += 400) { await f.evaluate((yy) => scrollTo({ top: yy, behavior: "instant" }), y); await wait(f, 60); }
  await f.evaluate((yy) => scrollTo({ top: yy, behavior: "instant" }), claimY); await wait(f, 500);
  const mid = await f.evaluate(() => document.querySelector(".sticky-cta").classList.contains("is-shown"));
  ok("sticky bar hidden at top, shown past the result", !top && mid, { top, mid, y: await f.evaluate(() => [scrollY, document.querySelector("[data-hero] .cta-row").getBoundingClientRect().top]) });
  await c2.close();

  const need = ["cta_click", "calc_input", "calc_result_view", "share_self", "faq_open", "address_typed"];
  ok("events logged", need.every((e) => tracks.includes(e)), [...new Set(tracks)]);
  ok("no console errors", errs.length === 0, errs);
  console.log(fails ? `${fails} failed` : "all passed");
  await b.close(); server.close(); process.exitCode = fails ? 1 : 0;
});
