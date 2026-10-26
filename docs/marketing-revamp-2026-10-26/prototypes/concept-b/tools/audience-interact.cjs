// Audience widget smoke test (specialty ladder + calculator, decision-8
// carry, attribution pass-through, AddressPreview, sign-up form, early
// access, UAE language preview, sign in). Serves site/ on PORT (4348).
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site"), SHOTS = path.join(__dirname, "..", "shots", "audience");
const T = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const f = path.join(SITE, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); });
const PORT = +(process.env.PORT || 4348);
let fails = 0;
const ok = (cond, msg, extra) => { if (!cond) fails++; console.log((cond ? "ok   " : "FAIL ") + msg + (extra !== undefined ? " → " + JSON.stringify(extra) : "")); };

server.listen(PORT, "127.0.0.1", async () => {
  const base = `http://127.0.0.1:${PORT}/`;
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1" } : undefined });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  const pg = await ctx.newPage(); const events = [], errs = [];
  pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); const t = m.text(); if (/tyTrack/.test(t)) events.push(t.replace(/%c/g, "").replace(/\s+/g, " ").slice(0, 160)); });
  pg.on("pageerror", (e) => errs.push(e.message));
  const q = (s) => pg.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, s);
  const attr = (s, a) => pg.evaluate(([s, a]) => { const e = document.querySelector(s); return e ? e.getAttribute(a) : null; }, [s, a]);
  const visible = (s) => pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return !!(r.width && r.height) && getComputedStyle(e).visibility !== "hidden"; }, s);

  /* 1. Specialty: ladder pricer drives the ladder and the follower calculator */
  await pg.goto(base + "for-trainers--strength.html?utm_source=ig&ref=bio"); await pg.waitForTimeout(900);
  ok(await pg.evaluate(() => document.querySelector("[data-hero] .au-hl").classList.contains("is-swept")), "hero rule sweep played");
  await pg.click('[data-consent="granted"]');
  await pg.evaluate(() => document.querySelector("#price").scrollIntoView()); await pg.waitForTimeout(700);
  const before = await q('[data-out="strong.revenue"]');
  await pg.click('[data-ladder] [data-step="1"]'); await pg.click('[data-ladder] [data-step="1"]'); await pg.waitForTimeout(700);
  ok((await q("[data-ladder] [data-pricer-out]")) === "AED 269", "ladder pricer → AED 269", await q("[data-ladder] [data-pricer-out]"));
  ok((await q("[data-flash-ladder]")) === "AED 269", "rung figure follows", await q("[data-flash-ladder]"));
  ok((await pg.evaluate(() => getComputedStyle(document.querySelector(".au-ladder-axis")).getPropertyValue("--p").trim())) === "26.90", "axis marker moves", await pg.evaluate(() => document.querySelector(".au-ladder-axis").style.getPropertyValue("--p")));
  ok((await pg.inputValue('[data-calc="follower"] [data-in="price"]')) === "269", "follower calc price synced");
  const after = await q('[data-out="strong.revenue"]');
  ok(after !== before, "best case recalculated", [before, after]);
  await pg.fill('[data-calc="follower"] [data-in="price"]', "420"); await pg.waitForTimeout(600);
  ok((await q("[data-ladder-read]")).startsWith("Your price is above"), "ladder caption flips above session range", await q("[data-ladder-read]"));
  await pg.fill('[data-calc="follower"] [data-in="followers"]', "20000"); await pg.waitForTimeout(800);
  ok(/Best case AED/.test(await q('[data-calc="follower"] [data-live]')), "calculator announces result", await q('[data-calc="follower"] [data-live]'));
  const signupLinks = await pg.evaluate(() => [...document.querySelectorAll('a[href^="signup.html"]')].map((a) => a.getAttribute("href")));
  ok(signupLinks.length > 0 && signupLinks.every((h) => /utm_source=ig/.test(h) && /ref=bio/.test(h)), "attribution carried on every sign-up link", signupLinks.slice(0, 2));
  ok(signupLinks.every((h) => !/price_aed/.test(h)), "no price carried while decision 8 is off");
  ok(!(await visible(".au-d8")), "decision-8 price line hidden by default");
  // Decision 8 on (dev panel switch injected by audience.js)
  await pg.click("#dev-btn"); await pg.waitForTimeout(250);
  await pg.click('[data-au-sw="d8"]'); await pg.waitForTimeout(200);
  await pg.keyboard.press("Escape");
  const heroHref = await attr("[data-hero] a.js-primary", "href");
  ok(/price_aed=420/.test(heroHref), "decision 8 on: hero CTA carries the current price", heroHref);
  ok(await visible(".au-d8"), "decision-8 price line shown");
  await pg.screenshot({ path: path.join(SHOTS, "interact-strength-ladder.png"), clip: { x: 0, y: 0, width: 1366, height: 900 } });

  /* 2. Sign-up: carried slug, decision-8 price chip, validation, submit */
  await pg.goto(base + "signup.html?slug=layla-strength&price_aed=249&utm_source=ig"); await pg.waitForTimeout(700);
  ok(await visible("[data-slug-chip]"), "slug chip shown", await q("[data-slug-chip]"));
  ok(await visible("[data-price-chip]"), "price chip shown (decision 8 on)", await q("[data-price-chip]"));
  await pg.click(".au-submit"); await pg.waitForTimeout(200);
  const errsShown = await pg.evaluate(() => [...document.querySelectorAll("[data-ferr]")].filter((e) => !e.hidden).map((e) => e.textContent));
  ok(errsShown.length === 4, "empty submit shows 4 calm field errors", errsShown);
  ok((await pg.evaluate(() => document.activeElement && document.activeElement.name)) === "name", "focus moves to first error");
  await pg.fill("#su-name", "Layla"); await pg.fill("#su-email", "layla@example.com"); await pg.fill("#su-pass", "short");
  ok(/7 to go/.test(await q("[data-pw-text]")), "password guidance counts down", await q("[data-pw-text]"));
  await pg.fill("#su-pass", "a-long-password-1");
  ok(await pg.evaluate(() => document.querySelector("[data-pw-help]").classList.contains("is-ok")), "password guidance turns green");
  await pg.click("[data-pw-toggle]"); ok((await attr("#su-pass", "type")) === "text", "show password toggles");
  await pg.check("#su-legal"); await pg.click(".au-submit"); await pg.waitForTimeout(400);
  ok(await visible(".au-done--signup"), "submit shows in-page success");
  await pg.screenshot({ path: path.join(SHOTS, "interact-signup-done.png") });
  // Registration closed: early-access form replaces the card
  await pg.evaluate(() => { window.TY.set("registration", "closed"); }); await pg.waitForTimeout(200);
  ok(await visible("#early-access .au-ea"), "registration closed shows the early-access form");
  ok((await attr(".site-header a.js-primary", "href")).startsWith("signup.html#early-access"), "header CTA points to early access", await attr(".site-header a.js-primary", "href"));
  await pg.click("#early-access button[type=submit]"); await pg.waitForTimeout(200);
  ok(await visible("#early-access [data-err]"), "early access validates");
  await pg.fill("#su-ea-name", "Layla"); await pg.fill("#su-ea-email", "layla@example.com"); await pg.check('#early-access input[name="consent"]');
  await pg.click("#early-access button[type=submit]"); await pg.waitForTimeout(300);
  ok(await visible("#early-access [data-done]"), "early access success shown", await q("#early-access [data-done]"));
  await pg.screenshot({ path: path.join(SHOTS, "interact-signup-closed.png") });
  await pg.evaluate(() => { window.TY.set("registration", "open"); });

  /* 3. Get started: AddressPreview carries slug + attribution, setup pricer */
  await pg.goto(base + "get-started.html?utm_campaign=bio"); await pg.waitForTimeout(600);
  await pg.fill("#addr-gs", "Layla Strength"); await pg.waitForTimeout(250);
  const claim = await attr("[data-claim]", "href");
  ok(/slug=layla-strength/.test(claim) && /utm_(campaign|source)=/.test(claim), "claim link keeps slug and source (stored first touch wins after consent)", claim);
  await pg.evaluate(() => document.querySelector("#steps").scrollIntoView()); await pg.waitForTimeout(700);
  await pg.click('.au-step-price [data-step="1"]'); await pg.waitForTimeout(400);
  ok((await q(".au-step-share .val")) === "AED 209", "setup pricer updates the share line", await q(".au-step-share .val"));

  /* 4. UAE: language preview */
  await pg.goto(base + "uae.html"); await pg.waitForTimeout(600);
  await pg.evaluate(() => document.querySelector("#arabic").scrollIntoView()); await pg.waitForTimeout(600);
  await pg.click('.au-langseg [data-lang="ar"]'); await pg.waitForTimeout(400);
  ok((await attr(".au-ar-vis .phone", "dir")) === "rtl", "vignette is right to left");
  ok((await q(".au-app-head b")) === "اليوم", "real Arabic app string shown", await q(".au-app-head b"));
  ok((await q(".au-app-card b")) === "Lower body A", "trainer-written text not translated");
  await pg.screenshot({ path: path.join(SHOTS, "interact-uae-rtl.png") });
  await pg.click('.au-langseg [data-lang="en"]'); await pg.waitForTimeout(200);
  ok((await q(".au-app-head b")) === "Today", "back to English");

  /* 5. Sign in */
  await pg.goto(base + "login.html"); await pg.waitForTimeout(400);
  await pg.click("[data-login] button[type=submit]"); await pg.waitForTimeout(150);
  ok(await visible("[data-login] [data-err]"), "sign in validates");
  await pg.fill("#li-email", "layla@example.com"); await pg.fill("#li-pass", "x"); await pg.click("[data-login] button[type=submit]"); await pg.waitForTimeout(150);
  ok(await visible("[data-login] [data-done]"), "sign in prototype result");

  /* 6. Reset prototype state */
  await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

  const want = ["signup_view", "signup_field_start", "signup_error", "signup_submit", "calc_input", "calc_result_view", "address_typed", "cta_click"];
  const seen = want.filter((w) => events.some((e) => new RegExp("tyTrack " + w).test(e)));
  ok(seen.length >= want.length - 2, "events logged", seen);
  ok(errs.length === 0, "no console errors", errs);
  console.log(events.filter((e) => /signup_/.test(e)).join("\n"));
  await b.close(); server.close(); process.exitCode = fails ? 1 : 0;
});
