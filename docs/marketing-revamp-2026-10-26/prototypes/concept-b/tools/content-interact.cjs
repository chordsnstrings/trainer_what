// Content group interaction smoke test (port 4383): FAQ filter and topics,
// asked-most links, frontier recount, methodology arrival and filter, TOC,
// pricing-guide pricer, follower mini calculator, permit checklist, rule tabs.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site");
const T = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const f = path.join(SITE, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });
server.listen(Number(process.env.PORT || 4383), async () => {
  const base = `http://127.0.0.1:${server.address().port}/`;
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1" } : undefined });
  const errs = [], events = [];
  const open = async (w, h) => { const ctx = await b.newContext({ viewport: { width: w, height: h } }); const pg = await ctx.newPage(); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); if (/tyTrack/.test(m.text())) events.push(m.text().replace(/%c/g, "").slice(0, 90)); }); pg.on("pageerror", (e) => errs.push(e.message)); return pg; };
  const say = (k, v) => console.log(k.padEnd(28), v);
  let pg = await open(1366, 900);
  const txt = (s) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, s);
  const vis = (s) => pg.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null).length, s);

  // FAQ
  await pg.goto(base + "faq.html"); await pg.waitForTimeout(500);
  await pg.click('[data-consent="granted"]');
  say("faq count", await txt("[data-count]"));
  await pg.fill("#faq-filter", "refund"); await pg.waitForTimeout(400);
  say("faq 'refund'", (await txt("[data-count]")) + " | visible " + (await vis("[data-q]")));
  await pg.fill("#faq-filter", "zzzz"); await pg.waitForTimeout(400);
  say("faq empty state", (await vis("[data-empty]")) + " | " + (await txt("[data-count]")));
  await pg.click(".finder-clear"); await pg.waitForTimeout(300);
  await pg.click('[data-topic="safety"]'); await pg.waitForTimeout(300);
  say("faq topic safety", (await txt("[data-count]")) + " | groups " + (await vis("[data-group]")) + " | ind " + (await pg.evaluate(() => getComputedStyle(document.querySelector(".topic-ind")).transform)));
  await pg.click('[data-topic="all"]');
  await pg.click(".asked-list li:nth-child(2) a"); await pg.waitForTimeout(500);
  say("asked-most opens", await pg.evaluate(() => { const a = document.querySelector(location.hash); return location.hash + " open=" + a.classList.contains("is-open") + " focus=" + (document.activeElement.closest(".acc") === a); }));
  await pg.click("#dev-btn"); await pg.click('[data-sw="frontier"]'); await pg.keyboard.press("Escape"); await pg.waitForTimeout(300);
  say("frontier on recount", (await txt('[data-topic="all"] [data-tcount]')) + " | " + (await txt("[data-count]")) + " | control " + (await txt('#faq-control [data-gcount]')));
  await pg.click("#dev-btn"); await pg.click('[data-sw="frontier"]'); await pg.click('[data-sw="registration"]'); await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
  say("registration closed CTA", await pg.evaluate(() => document.querySelector(".ct-hero .js-primary").innerText.trim()));
  await pg.click("#dev-btn"); await pg.click('[data-dev="reset"]'); await pg.keyboard.press("Escape");

  // Methodology arrival from a Source badge on pricing
  await pg.goto(base + "pricing.html"); await pg.waitForTimeout(400);
  await pg.evaluate(() => document.querySelector('a.src[href*="heytrainer"]').click()); await pg.waitForTimeout(1200);
  say("arrival", await pg.evaluate(() => location.hash + " arrived=" + document.querySelector(location.hash).classList.contains("is-arrived") + " select=" + document.querySelector("[data-lf-page]").value + " | " + document.querySelector("[data-lf-count]").textContent));
  await pg.selectOption("[data-lf-page]", ""); await pg.waitForTimeout(200);
  say("filter all", await txt("[data-lf-count]"));
  await pg.selectOption("[data-lf-page]", "/uae"); await pg.waitForTimeout(200);
  say("filter /uae", (await txt("[data-lf-count]")) + " | rows " + (await vis(".src-row")));

  // Pricing guide: TOC, pricer, read event
  await pg.goto(base + "guides--pricing-online-coaching-uae.html"); await pg.waitForTimeout(500);
  await pg.click('[data-toc-link][href="#s-examples"]'); await pg.waitForTimeout(700);
  say("toc current", (await txt('[data-toc-link][aria-current="true"]')) + " | ind " + (await pg.evaluate(() => getComputedStyle(document.querySelector(".toc-ind")).transform)));
  await pg.evaluate(() => document.querySelector(".ct-try").scrollIntoView()); await pg.waitForTimeout(300);
  await pg.click('.ct-try .pricer [data-step="1"]'); await pg.click('.ct-try .pricer [data-step="1"]'); await pg.waitForTimeout(600);
  say("pricer", (await txt(".ct-try [data-pricer-out]")) + " | keep " + (await txt('.ct-try [data-out="keep"]')) + " | " + (await pg.getAttribute("[data-try-link]", "href")));
  await pg.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await pg.waitForTimeout(400);

  // Instagram mini calc
  await pg.goto(base + "guides--instagram-followers-to-clients.html"); await pg.waitForTimeout(400);
  await pg.fill("#fol-n", "20000"); await pg.waitForTimeout(700);
  say("follower mini 20000", [await txt('.ct-try [data-out="cautious.revenue"]'), await txt('.ct-try [data-out="typical.revenue"]'), await txt('.ct-try [data-out="strong.revenue"]')].join(" / "));

  // Permit checklist
  await pg.goto(base + "guides--uae-advertiser-permit.html"); await pg.waitForTimeout(400);
  await pg.evaluate(() => document.querySelector(".checks").scrollIntoView()); await pg.waitForTimeout(300);
  await pg.click(".checks-list li:nth-child(1) .checks-item"); await pg.click(".checks-list li:nth-child(3) .checks-item"); await pg.waitForTimeout(200);
  say("checklist", (await txt("[data-checks-out]")) + " | meter " + (await pg.evaluate(() => document.querySelector(".checks-meter i").style.getPropertyValue("--p"))));
  await pg.focus(".checks-list li:nth-child(2) input"); await pg.keyboard.press("Space");
  say("checklist keyboard", await txt("[data-checks-out]"));

  // Rules tabs (keyboard)
  await pg.goto(base + "guides--writing-coaching-rules.html"); await pg.waitForTimeout(400);
  await pg.focus("#rt-0"); await pg.keyboard.press("ArrowRight"); await pg.keyboard.press("ArrowRight"); await pg.waitForTimeout(300);
  say("rule tabs", await pg.evaluate(() => document.activeElement.id + " panel2=" + !document.querySelector("#rp-2").hidden + " " + document.querySelector("#rp-2 .rule-top b").textContent));

  // Phone: TOC disclosure, FAQ topics row
  pg = await open(390, 844);
  await pg.goto(base + "terms.html"); await pg.waitForTimeout(400);
  await pg.click(".toc-toggle"); await pg.waitForTimeout(350);
  say("phone toc open", await pg.evaluate(() => document.querySelector(".toc-toggle").getAttribute("aria-expanded") + " vis=" + getComputedStyle(document.querySelector(".toc-panel")).visibility));
  await pg.click('.toc [href="#sec-8"]'); await pg.waitForTimeout(600);
  say("phone toc jump", await pg.evaluate(() => location.hash + " closed=" + (document.querySelector(".toc-toggle").getAttribute("aria-expanded") === "false") + " top=" + Math.round(document.querySelector("#sec-8").getBoundingClientRect().top)));
  await pg.goto(base + "faq.html"); await pg.waitForTimeout(400);
  await pg.click('[data-topic="uae"]'); await pg.waitForTimeout(500);
  say("phone faq topic", (await pg.evaluate(() => document.querySelector("[data-count]").textContent)) + " | scrollLeft " + (await pg.evaluate(() => document.querySelector(".topics").scrollLeft)));
  console.log("events:", [...new Set(events.map((e) => e.split(" ")[1]))].join(", "));
  console.log("errors:", errs.length ? errs : "none");
  await b.close(); server.close();
});
