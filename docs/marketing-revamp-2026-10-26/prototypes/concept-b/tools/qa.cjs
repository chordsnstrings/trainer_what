// Full QA crawl for Concept B. Run with Node 24 (imports the real TS calculators):
//   /opt/nvm/versions/node/v24.22.1/bin/node tools/qa.cjs [page.html ...]
// Env: SHOTS=0 skips screenshots, ONLY=checks list (comma), CONC=parallel pages.
// Writes shots/qa/*.png and shots/qa/report.json; prints a summary.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.join(__dirname, "..", "site"), OUT = path.join(__dirname, "..", "shots", "qa");
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const ALLOWED = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
const ALL = fs.readdirSync(SITE).filter((f) => f.endsWith(".html")).sort();
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const SHOTS = process.env.SHOTS !== "0";
const CONC = +(process.env.CONC || 4);

/* ---------- static checks: documents, links, fragments ---------- */
function staticChecks() {
  const issues = [];
  const ids = {};
  const html = {};
  for (const f of ALL) {
    html[f] = fs.readFileSync(path.join(SITE, f), "utf8");
    ids[f] = new Set([...html[f].matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  }
  for (const f of ALL) {
    const s = html[f];
    if (!/^<!doctype html>/i.test(s)) issues.push(`${f}: no doctype`);
    if (!/<html lang="en"/.test(s)) issues.push(`${f}: no lang=en`);
    if (!/<meta charset="utf-8">/.test(s)) issues.push(`${f}: no charset`);
    if (!/viewport-fit=cover/.test(s)) issues.push(`${f}: viewport meta`);
    if (!/<link rel="icon" href="assets\/favicon.svg"/.test(s)) issues.push(`${f}: favicon`);
    for (const m of s.matchAll(/\s(href|src|action)="([^"]*)"/g)) {
      const u = m[2];
      if (!u || u.startsWith("#") || u.startsWith("mailto:") || u.startsWith("tel:") || u === "../") {
        if (u && u.startsWith("#") && u.length > 1 && !ids[f].has(decodeURIComponent(u.slice(1)))) issues.push(`${f}: missing in-page anchor ${u}`);
        continue;
      }
      if (/^https?:/.test(u)) {
        const host = new URL(u).host;
        if (m[1] !== "href") { if (!ALLOWED.has(host)) issues.push(`${f}: external ${m[1]} ${u}`); continue; }
        // external links must open in a new tab with rel=noopener (fonts preconnect is a <link>)
        const tagStart = s.lastIndexOf("<", m.index), tag = s.slice(tagStart, s.indexOf(">", m.index) + 1);
        if (tag.startsWith("<a") && !(/target="_blank"/.test(tag) && /rel="[^"]*noopener/.test(tag))) issues.push(`${f}: external link without new tab/noopener ${u}`);
        continue;
      }
      if (u.startsWith("/")) { issues.push(`${f}: root-absolute ${u}`); continue; }
      const [p0, hash] = u.split("#"); const p = p0.split("?")[0];
      if (!p) continue;
      if (!fs.existsSync(path.join(SITE, p))) { issues.push(`${f}: broken ${m[1]} ${u}`); continue; }
      if (hash && p.endsWith(".html") && ids[p] && !ids[p].has(hash)) issues.push(`${f}: missing anchor ${u}`);
    }
    if (/\balert\(|\bconfirm\(|\bprompt\(/.test(s.replace(/<[^>]+>/g, ""))) {/* text mentions are fine */}
    if (/<a [^>]*\bdownload\b/.test(s)) issues.push(`${f}: <a download>`);
    if (/<(iframe|video)\b/.test(s)) issues.push(`${f}: iframe/video`);
  }
  for (const js of fs.readdirSync(path.join(SITE, "assets")).filter((x) => /\.(js|css)$/.test(x))) {
    const s = fs.readFileSync(path.join(SITE, "assets", js), "utf8");
    if (/\b(alert|confirm|prompt)\s*\(/.test(s) && js.endsWith(".js")) issues.push(`assets/${js}: alert/confirm/prompt`);
    for (const m of s.matchAll(/https?:\/\/[^\s"')]+/g)) if (!ALLOWED.has(new URL(m[0]).host) && !/w3\.org/.test(m[0])) issues.push(`assets/${js}: external url ${m[0]}`);
    if (js.endsWith(".js")) {
      // every localStorage access must sit in a try block (rough check: same line has try)
      s.split("\n").forEach((line, i) => { if (/localStorage\./.test(line) && !/try\s*\{/.test(line)) issues.push(`assets/${js}:${i + 1}: localStorage outside try`); });
    }
  }
  return issues;
}

/* ---------- in-page probes ---------- */
const PROBE = () => {
  const de = document.documentElement, W = innerWidth, H = innerHeight;
  const skipSel = "#sheet,#dev,#consent,.sticky-cta,.dd-panel,.kamran--float,.skip-link,.sr-only,[hidden],[aria-hidden=true],template,noscript,script,style";
  const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden"; };
  const parse = (c) => {
    if (!c) return null;
    let m = c.match(/^rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; }
    m = c.match(/^color\(srgb ([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s\/]+/).filter(Boolean).map(parseFloat); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p[3] === undefined ? 1 : p[3] }; }
    return null;
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  function bgOf(el) {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none" && !/url\(/.test(cs.backgroundImage)) return null; // gradient: unknown
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
    return out;
  }
  const texty = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.nodeValue.trim()) continue;
    const el = t.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    texty.push(el);
  }
  // union of the element's own (direct) text nodes, so visually-hidden children don't count
  const ownTextRect = (el) => {
    let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
    for (const n of el.childNodes) { if (n.nodeType !== 3 || !n.nodeValue.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const q of rg.getClientRects()) { if (!q.width) continue; l = Math.min(l, q.left); r = Math.max(r, q.right); t = Math.min(t, q.top); b = Math.max(b, q.bottom); } }
    return l === Infinity ? { width: 0 } : { left: l, right: r, top: t, bottom: b, width: r - l };
  };
  // 1) contrast
  const contrast = [];
  for (const el of texty) {
    if (el.closest(skipSel) || el.closest("svg")) continue;
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (el.closest("[disabled],[aria-disabled=true]")) continue;
    const cs = getComputedStyle(el);
    let fg = parse(cs.color); const bg = bgOf(el); if (!fg || !bg) continue;
    if (fg.a < 1) fg = blend(fg, bg);
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize), wt = +cs.fontWeight;
    const large = px >= 24 || (px >= 18.66 && wt >= 700);
    if (ratio < (large ? 3 : 4.5) - 0.01) contrast.push({ t: el.textContent.trim().slice(0, 40), cls: (el.className && el.className.baseVal === undefined ? el.className : "").slice(0, 40), ratio: +ratio.toFixed(2), fg: cs.color, px });
  }
  // 2) overflow offenders
  const over = [];
  if (de.scrollWidth > W) {
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > W + 1 && getComputedStyle(el).position !== "fixed" && !el.closest("#sheet,#dev")) {
        let p = el.parentElement, scrolls = false;
        for (; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== "visible") { scrolls = true; break; } }
        if (!scrolls) over.push(el.tagName.toLowerCase() + "." + String(el.className.baseVal ?? el.className).split(" ").join(".") + " r=" + Math.round(r.right));
      }
    });
  }
  // 3) clipped text: the text's own extent is cut by an overflow-hidden/clip ancestor
  const clipped = [];
  for (const el of texty) {
    if (el.closest("#sheet,#dev,.sr-only,[hidden],[aria-hidden=true]") || !vis(el)) continue;
    const tr = ownTextRect(el);
    if (!tr.width) continue;
    for (let n = el.parentElement, k = 0; n && n !== document.body && k < 6; n = n.parentElement, k++) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== "hidden" && cs.overflowX !== "clip") continue;
      const br = n.getBoundingClientRect();
      if (br.width <= 2 || br.height <= 2) break; // visually-hidden or collapsed: not a visual clip
      if (tr.right > br.right + 1.5 || tr.left < br.left - 1.5) { clipped.push({ t: el.textContent.trim().replace(/\s+/g, " ").slice(0, 50), cls: String(n.className.baseVal ?? n.className).slice(0, 50), sw: Math.round(tr.right - tr.left), cw: Math.round(br.width) }); }
      break;
    }
  }
  // 3b) text that spills out of its card/chip/box (overflow visible)
  const outOfBox = [];
  for (const el of texty) {
    if (el.closest(skipSel) || !vis(el)) continue;
    const er = el.getBoundingClientRect(); if (er.width <= 2 || er.height <= 2) continue; // visually hidden
    const tr = ownTextRect(el);
    if (!tr.width) continue;
    for (let n = el.parentElement, k = 0; n && n !== document.body && k < 10; n = n.parentElement, k++) {
      const cs = getComputedStyle(n);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") break;
      const bgc = parse(cs.backgroundColor);
      const boxed = (bgc && bgc.a > 0) || cs.boxShadow !== "none" || parseFloat(cs.borderLeftWidth) > 0 || parseFloat(cs.borderRightWidth) > 0;
      if (!boxed) continue;
      const br = n.getBoundingClientRect();
      if (br.width >= W - 2) break;
      if (tr.right > br.right + 1 || tr.left < br.left - 1) outOfBox.push({ t: el.textContent.trim().replace(/\s+/g, " ").slice(0, 40), box: String(n.className.baseVal ?? n.className).slice(0, 40), by: Math.round(Math.max(tr.right - br.right, br.left - tr.left)) });
      break;
    }
  }
  // 3c) component integrity: chips and app-icon tiles overridden by broad descendant rules
  const broken = [...document.querySelectorAll(".chip, .app-icon-tile, .btn")].filter((el) => {
    if (el.closest("#dev,[hidden]")) return false;
    const d = getComputedStyle(el).display; if (d === "none") return false;
    return !/flex|grid/.test(d);
  }).map((el) => el.className.split(" ").slice(0, 2).join(".") + " '" + el.textContent.trim().slice(0, 20) + "' " + getComputedStyle(el).display);
  // 4) images without alt, unlabeled controls
  const imgNoAlt = [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).map((i) => i.src.slice(-40));
  const unlabeled = [...document.querySelectorAll("button, a[href], input, select, textarea, [role=switch], [role=tab]")].filter((el) => {
    if (el.closest("[hidden]") || (el.type === "hidden")) return false;
    const name = (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.textContent.trim() || el.title || (el.labels && el.labels.length) || el.querySelector("img[alt]:not([alt=''])"));
    return !name;
  }).map((el) => el.outerHTML.slice(0, 80));
  // 5) small touch targets (standalone controls only)
  const small = [];
  if (W < 700) document.querySelectorAll("button, a.btn, input:not([type=hidden]), select, [role=switch], [role=tab], .chip-link, summary").forEach((el) => {
    if (el.closest("#dev,[hidden]") || !vis(el)) return;
    const r = el.getBoundingClientRect(); if (!r.width) return;
    if (el.type === "range") { if (r.height < 24) small.push("range " + Math.round(r.height)); return; }
    if (el.type === "checkbox" || el.type === "radio") return; // label is the target
    if (r.height < 43.5 || r.width < 43.5) small.push(el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0] + " '" + el.textContent.trim().slice(0, 20) + "' " + Math.round(r.width) + "x" + Math.round(r.height));
  });
  // 6) view transitions
  let vtRule = false;
  for (const sh of document.styleSheets) { try { for (const rl of sh.cssRules) if (/^@view-transition\s*\{\s*navigation:\s*auto/.test(rl.cssText)) vtRule = true; } catch (e) {} }
  const hdr = document.querySelector("header.site-header"), ftr = document.querySelector("footer.site-footer");
  const vt = { rule: vtRule, header: hdr && getComputedStyle(hdr).viewTransitionName, footer: ftr && getComputedStyle(ftr).viewTransitionName };
  // 7) landmarks and headings
  const h1s = [...document.querySelectorAll("h1")];
  const headingSkips = [];
  let last = 0;
  document.querySelectorAll("main h1, main h2, main h3, main h4, main h5").forEach((h) => { const l = +h.tagName[1]; if (last && l > last + 1) headingSkips.push(h.tagName + ":" + h.textContent.trim().slice(0, 30)); last = l; });
  const ctas = [...document.querySelectorAll('a[href^="signup.html"].btn, a[href^="signup.html"][data-cta]')].filter(vis).map((a) => a.innerText.trim().replace(/\s+/g, " "));
  return {
    title: document.title, h1: h1s.length, h1Text: h1s[0] ? h1s[0].textContent.trim() : "", h1Visible: h1s[0] ? h1s[0].getBoundingClientRect().top < H : false,
    scrollW: de.scrollWidth, W, over: over.slice(0, 6), contrast: contrast.slice(0, 12), contrastN: contrast.length, clipped: clipped.slice(0, 8), broken: [...new Set(broken)].slice(0, 8), outOfBox: outOfBox.slice(0, 8), outOfBoxN: outOfBox.length,
    imgNoAlt, unlabeled: unlabeled.slice(0, 6), small: small.slice(0, 10), smallN: small.length, vt, headingSkips,
    landmarks: { header: !!document.querySelector("header"), main: document.querySelectorAll("main").length, footer: !!document.querySelector("footer"), nav: !!document.querySelector("nav") },
    ctas: [...new Set(ctas)],
  };
};

/* first screen: anything in the first viewport hidden right after load */
const FIRST = () => {
  const H = innerHeight, W = innerWidth, bad = [];
  const skip = "#sheet,#dev,#dev-btn,#consent,.sticky-cta,.dd-panel,.kamran--float,.skip-link,.sr-only,[hidden],[aria-hidden=true],noscript,.acc-panel,[role=tabpanel][hidden]";
  const pending = [...document.querySelectorAll(".reveal-pending")].filter((u) => u.getBoundingClientRect().top < H).map((u) => u.className);
  document.querySelectorAll("main *, header *").forEach((el) => {
    if (el.closest(skip)) return;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (!hasText && !/^(IMG|SVG|CANVAS|INPUT|BUTTON)$/i.test(el.tagName)) return;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.top >= H || r.bottom <= 0 || r.left >= W || r.right <= 0) return;
    const cs = getComputedStyle(el); if (cs.display === "none") return;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflow; if (o !== "visible") { const q = n.getBoundingClientRect(); if (q.height < 2 || q.width < 2) return; } }
    let op = 1, hidden = cs.visibility === "hidden";
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= +getComputedStyle(n).opacity;
    if (op < 0.6 || hidden) bad.push(el.tagName.toLowerCase() + "." + String(el.className.baseVal ?? el.className).split(" ").slice(0, 2).join(".") + " '" + (el.textContent || "").trim().slice(0, 30) + "' op=" + op.toFixed(2));
  });
  return { pending, hidden: bad.slice(0, 10), hiddenN: bad.length };
};

/* ---------- calculators ---------- */
let REAL;
const num = (s) => { const m = String(s).replace(/[−-]/g, "").replace(/,/g, "").match(/\d+(\.\d+)?/); return m ? +m[0] : NaN; };
function expectedFor(type, inputs, key) {
  if (type === "earnings") {
    const e = REAL.estimateEarnings(inputs);
    const n = Math.floor(Math.min(Math.max(inputs.subscribers, 0), 1e9));
    const map = { subscribers: n, price: inputs.workoutPriceAed, avg: Math.round(e.averageMonthlyMinor / 100), revenue: Math.round(e.subscriptionMonthlyMinor / 100), commission: Math.round(e.commissionMinor / 100), rate: +e.effectiveCommissionPct.toFixed(1), keep: Math.round(e.beforeOtherCostsMinor / 100), sessionsIncome: Math.round(e.sessionsMonthlyMinor / 100), sessions: e.equivalentSessions };
    e.bands.forEach((b, k) => { map[`band.${k}.subs`] = b.subscribers; map[`band.${k}.commission`] = Math.round(b.commissionMinor / 100); });
    return map[key];
  }
  const e = REAL.estimateFollowerConversion(inputs, REAL.DEFAULT_FOLLOWER_MODEL);
  if (key === "price") return REAL.followerInputsUsed(inputs).priceAed;
  const [s, f] = key.split(".");
  const r = e.scenarios ? e.scenarios[s] : e[s];
  if (!r) return undefined;
  const v = { revenue: Math.round(r.revenueMonth12Minor / 100), active: REAL.displayCount(r.activeMonth12), month1: REAL.displayCount(r.month1New), signups: REAL.displayCount(r.signups12) }[f];
  return v === null ? "fewer than 1" : v;
}
async function calcCheck(page, label, firstPaint = true) {
  const roots = await page.evaluate(() => (window.__calcLog || []).length);
  const data = await page.evaluate(() => {
    return [...document.querySelectorAll("[data-calc]")].map((root, i) => {
      const type = root.getAttribute("data-calc"), res = TYCalc.renderers[type](root);
      const outs = [...root.querySelectorAll("[data-out]")].map((o) => ({ key: o.getAttribute("data-out"), text: (o.getAttribute("data-v") || o.textContent).trim(), first: o.__first }));
      return { i, type, full: root.hasAttribute("data-full"), inputs: res.inputs, outs };
    });
  });
  const problems = [];
  for (const r of data) {
    for (const o of r.outs) {
      const exp = expectedFor(r.type, r.inputs, o.key);
      if (exp === undefined) continue;
      const got = exp === "fewer than 1" ? (/fewer/.test(o.text) ? exp : o.text) : num(o.text);
      if (got !== exp) problems.push(`${label} calc#${r.i} ${r.type} ${o.key}: shows "${o.text}" expected ${exp}`);
      if (firstPaint && o.first !== undefined && o.first !== null && o.first.replace(/\s/g, " ") !== o.text.replace(/\s/g, " ")) problems.push(`${label} calc#${r.i} ${o.key}: first paint "${o.first}" != script "${o.text}"`);
    }
  }
  return { roots: data.map((r) => ({ type: r.type, full: r.full, inputs: r.inputs })), problems };
}

/* ---------- server ---------- */
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

const INIT = () => {
  // snapshot first-paint text of every data-out before deferred scripts run
  document.addEventListener("readystatechange", () => {
    if (document.readyState === "interactive") document.querySelectorAll("[data-out]").forEach((o) => { o.__first = (o.getAttribute("data-v") || o.textContent).trim(); });
  });
};

server.listen(0, async () => {
  REAL = await import("/home/user/trainer_what/packages/domain/src/marketing-calculators.ts");
  const port = server.address().port, base = `http://127.0.0.1:${port}/`;
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
  const browser = await chromium.launch(proxy ? { proxy } : {});
  const report = { static: staticChecks(), pages: {}, calc: [], reduced: {}, extra: {} };

  async function open(pg, w, h, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, reducedMotion: opts.reduce ? "reduce" : "no-preference", hasTouch: w < 700 });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const errors = [], external = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url().slice(0, 100) + " " + (r.failure() || {}).errorText));
    page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`); });
    page.on("request", (r) => { const u = new URL(r.url()); if (u.hostname !== "127.0.0.1" && !ALLOWED.has(u.hostname) && u.protocol !== "data:") external.push(r.url()); });
    await page.goto(base + pg, { waitUntil: "load" });
    return { ctx, page, errors, external };
  }
  async function scrollThrough(page, h) {
    const H = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += Math.round(h * 0.7)) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(140); }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(700);
  }

  const sizes = [[360, 780], [390, 844], [1366, 900]];
  const jobs = [];
  for (const [w, h] of sizes) for (const pg of PAGES) jobs.push([pg, w, h]);
  await pool(jobs, CONC, async ([pg, w, h]) => {
    const { ctx, page, errors, external } = await open(pg, w, h);
    const r = {};
    try {
      await page.waitForTimeout(150);
      r.first = await page.evaluate(FIRST);
      await page.waitForTimeout(1300);
      r.firstLate = await page.evaluate(FIRST);
      Object.assign(r, await page.evaluate(PROBE));
      if (w === 1366 || w === 390) { const c = await calcCheck(page, `${pg}@${w}`); if (c.roots.length) report.calc.push({ page: pg, w, ...c }); }
      if (SHOTS && w !== 360) await page.screenshot({ path: path.join(OUT, `${pg.replace(".html", "")}-${w}-top.png`) });
      // header keyboard focus (desktop) / mobile menu
      if (w === 1366) {
        const foc = [];
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.focus("body").catch(() => {});
        for (let i = 0; i < 11; i++) {
          await page.keyboard.press("Tab");
          const f = await page.evaluate(() => {
            const a = document.activeElement; if (!a || a === document.body) return null;
            const cs = getComputedStyle(a); const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1) || (cs.boxShadow && cs.boxShadow !== "none");
            const r = a.getBoundingClientRect();
            return { el: a.tagName.toLowerCase() + "." + String(a.className).split(" ")[0] + " " + a.textContent.trim().slice(0, 18), ring, inHeader: !!a.closest("header,.skip-link") || a.classList.contains("skip-link"), onScreen: r.top >= 0 && r.bottom <= innerHeight && r.width > 0 };
          });
          if (f && f.inHeader) foc.push(f);
        }
        r.focus = foc.filter((f) => !f.ring || !f.onScreen);
        r.focusN = foc.length;
        // dropdown keyboard
        const dd = await page.$(".dd-btn");
        if (dd && await dd.isVisible()) {
          await dd.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(450);
          const open1 = await page.evaluate(() => { const p = document.querySelector(".dd-panel"), b = document.querySelector(".dd-btn"); const cs = getComputedStyle(p); return b.getAttribute("aria-expanded") === "true" && cs.visibility !== "hidden" && +cs.opacity > 0.5; });
          await page.keyboard.press("Escape"); await page.waitForTimeout(250);
          const closed1 = await page.evaluate(() => document.querySelector(".dd-btn").getAttribute("aria-expanded") === "false" && document.activeElement === document.querySelector(".dd-btn"));
          r.dropdown = open1 && closed1 ? "ok" : `open=${open1} closed=${closed1}`;
        }
      } else {
        const mb = await page.$(".menu-btn");
        if (mb && await mb.isVisible()) {
          await mb.click(); await page.waitForTimeout(450);
          const o = await page.evaluate(() => {
            const s = document.querySelector("#sheet"), cs = getComputedStyle(s), r = s.getBoundingClientRect();
            const lastLink = [...s.querySelectorAll("a")].pop(), lr = lastLink.getBoundingClientRect();
            return { exp: document.querySelector(".menu-btn").getAttribute("aria-expanded"), vis: cs.visibility !== "hidden" && +cs.opacity > 0.9 && r.top < innerHeight && r.bottom > 0, focusIn: s.contains(document.activeElement), lockScroll: getComputedStyle(document.documentElement).overflow + "/" + getComputedStyle(document.body).overflow, sheetScrolls: s.scrollHeight > s.clientHeight ? getComputedStyle(s).overflowY + "|" + getComputedStyle(s.querySelector(".sheet-inner")).overflowY : "fits", lastReachable: lr.bottom <= innerHeight || s.scrollHeight > s.clientHeight || s.querySelector(".sheet-inner").scrollHeight > s.querySelector(".sheet-inner").clientHeight };
          });
          if (SHOTS && w === 390 && pg === "index.html") await page.screenshot({ path: path.join(OUT, `menu-open-${w}.png`) });
          // focus trap: tab 40 times, focus must stay in menu
          let escaped = 0;
          for (let i = 0; i < 40; i++) { await page.keyboard.press("Tab"); if (!(await page.evaluate(() => document.querySelector("#sheet").contains(document.activeElement) || document.activeElement === document.querySelector(".menu-btn")))) escaped++; }
          await page.keyboard.press("Escape"); await page.waitForTimeout(400);
          const c = await page.evaluate(() => { const s = document.querySelector("#sheet"), cs = getComputedStyle(s); return { exp: document.querySelector(".menu-btn").getAttribute("aria-expanded"), hidden: cs.visibility === "hidden" || +cs.opacity < 0.1, focusBtn: document.activeElement === document.querySelector(".menu-btn") }; });
          // re-open and close via button click
          await mb.click(); await page.waitForTimeout(400); await mb.click().catch(() => {}); await page.waitForTimeout(400);
          const c2 = await page.evaluate(() => document.querySelector(".menu-btn").getAttribute("aria-expanded"));
          r.menu = { open: o, escaped, close: c, closeByButton: c2 };
          r.menuOk = o.exp === "true" && o.vis && o.focusIn && o.lastReachable && escaped === 0 && c.exp === "false" && c.hidden && c.focusBtn && c2 === "false";
        }
      }
      // accept consent, scroll through, sticky + dev button at the end
      const btn = await page.$('[data-consent="granted"]');
      if (btn && (await btn.isVisible())) { await btn.click(); await page.waitForTimeout(350); }
      await scrollThrough(page, h);
      r.end = await page.evaluate(() => {
        const out = { sticky: null, coveredBySticky: [], coveredByDev: [], pendingLeft: document.querySelectorAll(".reveal-pending").length };
        const st = document.querySelector(".sticky-cta");
        const texts = [...document.querySelectorAll("main *, footer *, .closing *")].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim()) && !el.closest(".sr-only,[hidden]"));
        const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        if (st && st.classList.contains("is-shown") && getComputedStyle(st).display !== "none") {
          const sr = st.getBoundingClientRect(); out.sticky = Math.round(sr.top);
          out.coveredBySticky = texts.filter((el) => hit(el.getBoundingClientRect(), sr)).map((el) => el.textContent.trim().slice(0, 30));
        }
        const db = document.querySelector("#dev-btn");
        if (db) { const dr = db.getBoundingClientRect(); out.coveredByDev = texts.filter((el) => { const r = el.getBoundingClientRect(); return r.width && hit(r, dr); }).map((el) => el.textContent.trim().slice(0, 30)); if (st && st.classList.contains("is-shown")) { const b = st.querySelector(".btn").getBoundingClientRect(); if (hit(b, dr)) out.devOverSticky = true; } }
        return out;
      });
      // mid-page: sticky shown & dev button overlap with the sticky CTA button
      if (w < 700) {
        r.mid = await page.evaluate(async () => {
          window.scrollTo(0, Math.round(document.documentElement.scrollHeight * 0.45)); await new Promise((res) => setTimeout(res, 500));
          const st = document.querySelector(".sticky-cta"), db = document.querySelector("#dev-btn");
          if (!st || !st.classList.contains("is-shown")) return { sticky: false };
          const b = st.getBoundingClientRect(), d = db.getBoundingClientRect();
          return { sticky: true, devOverlap: d.left < b.right && d.right > b.left && d.top < b.bottom && d.bottom > b.top, safePad: getComputedStyle(st).paddingBottom };
        });
      }
      if (SHOTS && w !== 360) {
        await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(OUT, `${pg.replace(".html", "")}-${w}-full.png`), fullPage: true });
      }
      // dev panel at 390 on every page
      if (w === 390) {
        await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
        await page.click("#dev-btn"); await page.waitForTimeout(350);
        const dv = await page.evaluate(() => { const d = document.querySelector("#dev"), r = d.getBoundingClientRect(); return { open: d.classList.contains("is-open") && getComputedStyle(d).visibility !== "hidden", inView: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0, links: d.querySelectorAll(".dev-pages a").length, gallery: !!d.querySelector('a[href="../"]'), replay: !!d.querySelector('[data-dev="replay"]'), scrollable: d.scrollHeight <= d.clientHeight || getComputedStyle(d).overflowY !== "visible" }; });
        const sw = [];
        const FLAG = { payments: ["payments-on", "payments-off"], registration: ["reg-open", "reg-closed"], frontier: ["frontier-on", "frontier-off"], voice: ["voice-on", "voice-off"], publish: ["publish-gated", "publish-open"] };
        for (const key of ["payments", "registration", "publish", "frontier", "voice", "roll", "motion"]) {
          const before = await page.evaluate((k) => ({ a: document.documentElement.getAttribute("data-" + k), c: document.querySelector(`[data-sw="${k}"]`).getAttribute("aria-checked") }), key);
          const visBefore = FLAG[key] ? await page.evaluate((f) => f.map((c) => [...document.querySelectorAll(".if-" + c)].filter((e) => getComputedStyle(e).display !== "none").length), FLAG[key]) : null;
          await page.click(`[data-sw="${key}"]`); await page.waitForTimeout(120);
          const after = await page.evaluate((k) => ({ a: document.documentElement.getAttribute("data-" + k), c: document.querySelector(`[data-sw="${k}"]`).getAttribute("aria-checked") }), key);
          const visAfter = FLAG[key] ? await page.evaluate((f) => f.map((c) => [...document.querySelectorAll(".if-" + c)].filter((e) => getComputedStyle(e).display !== "none").length), FLAG[key]) : null;
          const total = FLAG[key] ? await page.evaluate((f) => f.map((c) => document.querySelectorAll(".if-" + c).length), FLAG[key]) : null;
          let ok = before.a !== after.a && before.c !== after.c;
          // the hidden variant must become visible (when the page has both variants)
          if (ok && total && total[0] + total[1] > 0) ok = JSON.stringify(visBefore) !== JSON.stringify(visAfter);
          sw.push({ key, ok, before: before.a, after: after.a, visBefore, visAfter, total });
          const ovf = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
          if (ovf) sw.push({ key, ok: false, overflowAfterToggle: true });
          await page.click(`[data-sw="${key}"]`); await page.waitForTimeout(80);
        }
        await page.click('[data-dev="reset"]'); await page.waitForTimeout(100);
        await page.keyboard.press("Escape"); await page.waitForTimeout(300);
        const closed = await page.evaluate(() => !document.querySelector("#dev").classList.contains("is-open") && document.activeElement === document.querySelector("#dev-btn"));
        r.dev = { ...dv, closed, switches: sw.filter((s) => !s.ok) };
      }
    } catch (e) { r.crash = String(e).slice(0, 300); }
    r.errors = [...new Set(errors)]; r.external = [...new Set(external)];
    report.pages[`${pg}@${w}`] = r;
    await ctx.close();
  });

  // extra widths: overflow + h1 in first screen
  await pool(PAGES.flatMap((pg) => [[pg, 768, 1024], [pg, 1024, 768], [pg, 1600, 900]]), CONC, async ([pg, w, h]) => {
    const { ctx, page, errors } = await open(pg, w, h);
    await page.waitForTimeout(300);
    const x = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, W: innerWidth, h1top: document.querySelector("h1") ? Math.round(document.querySelector("h1").getBoundingClientRect().top) : -1 }));
    const f = await page.evaluate(FIRST);
    if (SHOTS && pg === "index.html") await page.screenshot({ path: path.join(OUT, `index-${w}-top.png`) });
    report.extra[`${pg}@${w}`] = { ...x, firstHidden: f.hiddenN, pending: f.pending.length, errors: [...new Set(errors)] };
    await ctx.close();
  });

  // reduced motion
  await pool(PAGES.flatMap((pg) => [[pg, 390, 844], [pg, 1366, 900]]), CONC, async ([pg, w, h]) => {
    const { ctx, page, errors } = await open(pg, w, h, { reduce: true });
    await page.waitForTimeout(150);
    const f = await page.evaluate(FIRST);
    const x = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, W: innerWidth }));
    await scrollThrough(page, h);
    const left = await page.evaluate(() => document.querySelectorAll(".reveal-pending").length);
    report.reduced[`${pg}@${w}`] = { ...x, firstHidden: f.hidden, pending: f.pending, pendingAfterScroll: left, errors: [...new Set(errors)] };
    await ctx.close();
  });

  // calculator interaction: change inputs and compare to the real maths
  const inter = [];
  for (const pg of ["earnings-calculator.html", "follower-calculator.html", "pricing.html", "index.html"]) {
    const { ctx, page, errors } = await open(pg, 1366, 900);
    await page.waitForTimeout(400);
    const sets = pg.startsWith("follower")
      ? [{ followers: "12000", stories: "4", price: "349" }, { followers: "800", visits: "300", cancel: "50" }]
      : [{ subscribers: "150" }, { subscribers: "420", price: "249" }, { subscribers: "1200" }];
    for (const s of sets) {
      for (const [k, v] of Object.entries(s)) {
        await page.evaluate(([k, v]) => { const el = document.querySelector(`[data-calc] [data-in="${k}"]`); if (!el) return; el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, [k, v]);
      }
      if (pg.startsWith("earnings")) await page.evaluate(() => { const b = document.querySelector('[data-in="billing"]'); });
      await page.waitForTimeout(500);
      const c = await calcCheck(page, `${pg} after ${JSON.stringify(s)}`, false);
      inter.push(...c.problems);
    }
    if (errors.length) inter.push(`${pg}: ${errors.join(" | ")}`);
    await ctx.close();
  }
  report.calcInteraction = inter;

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
  await browser.close(); server.close();

  /* ---------- summary ---------- */
  const P = Object.entries(report.pages);
  const sum = (pred) => P.filter(([, r]) => pred(r)).map(([k]) => k);
  const S = {
    pagesCrawled: new Set(P.map(([k]) => k.split("@")[0])).size, loads: P.length,
    static: report.static,
    crashes: sum((r) => r.crash).map((k) => k + " " + report.pages[k].crash),
    errors: P.filter(([, r]) => r.errors && r.errors.length).map(([k, r]) => k + ": " + r.errors.join(" | ")),
    external: P.filter(([, r]) => r.external && r.external.length).map(([k, r]) => k + ": " + r.external.join(" ")),
    overflow: P.filter(([, r]) => r.scrollW > r.W).map(([k, r]) => `${k} ${r.scrollW}>${r.W} ${r.over.join(", ")}`),
    title: sum((r) => !r.title), h1: P.filter(([, r]) => r.h1 !== 1).map(([k, r]) => k + " h1=" + r.h1), h1Offscreen: sum((r) => r.h1 === 1 && !r.h1Visible),
    imgNoAlt: P.filter(([, r]) => r.imgNoAlt && r.imgNoAlt.length).map(([k, r]) => k + " " + r.imgNoAlt.join(",")),
    unlabeled: P.filter(([, r]) => r.unlabeled && r.unlabeled.length).map(([k, r]) => k + " " + r.unlabeled.join(" ; ")),
    contrast: P.filter(([, r]) => r.contrastN).map(([k, r]) => `${k} (${r.contrastN}) ` + r.contrast.map((c) => `"${c.t}" ${c.ratio} ${c.fg} ${c.px}px .${c.cls}`).join(" ; ")),
    clipped: P.filter(([, r]) => r.clipped && r.clipped.length).map(([k, r]) => k + " " + r.clipped.map((c) => `"${c.t}" ${c.sw}>${c.cw} .${c.cls}`).join(" ; ")),
    broken: P.filter(([, r]) => r.broken && r.broken.length).map(([k, r]) => k + " " + r.broken.join(" ; ")),
    outOfBox: P.filter(([, r]) => r.outOfBoxN).map(([k, r]) => `${k} (${r.outOfBoxN}) ` + r.outOfBox.map((c) => `"${c.t}" +${c.by}px .${c.box}`).join(" ; ")),
    firstHidden: P.filter(([, r]) => r.first && (r.first.hiddenN || r.first.pending.length)).map(([k, r]) => `${k} hidden@150ms(${r.first.hiddenN}) ${r.first.hidden.join(" ; ")} pending:${r.first.pending.join(",")}`),
    firstHiddenLate: P.filter(([, r]) => r.firstLate && (r.firstLate.hiddenN || r.firstLate.pending.length)).map(([k, r]) => `${k} (${r.firstLate.hiddenN}) ${r.firstLate.hidden.join(" ; ")}`),
    vt: P.filter(([, r]) => r.vt && !(r.vt.rule && r.vt.header === "site-header" && r.vt.footer === "site-footer")).map(([k, r]) => k + " " + JSON.stringify(r.vt)),
    focus: P.filter(([, r]) => r.focus && r.focus.length).map(([k, r]) => k + " " + JSON.stringify(r.focus)),
    focusChecked: P.filter(([, r]) => r.focusN).length,
    dropdown: P.filter(([, r]) => r.dropdown && r.dropdown !== "ok").map(([k, r]) => k + " " + r.dropdown),
    menu: P.filter(([, r]) => r.menu && !r.menuOk).map(([k, r]) => k + " " + JSON.stringify(r.menu)),
    menuChecked: P.filter(([, r]) => r.menu).length,
    stickyCover: P.filter(([, r]) => r.end && r.end.coveredBySticky.length).map(([k, r]) => k + " " + r.end.coveredBySticky.join(" | ")),
    devCover: P.filter(([, r]) => r.end && (r.end.coveredByDev.length || r.end.devOverSticky)).map(([k, r]) => k + " " + r.end.coveredByDev.join(" | ") + (r.end.devOverSticky ? " [over sticky]" : "")),
    devMidOverlap: P.filter(([, r]) => r.mid && r.mid.devOverlap).map(([k]) => k),
    pendingAfterScroll: P.filter(([, r]) => r.end && r.end.pendingLeft).map(([k, r]) => k + " " + r.end.pendingLeft),
    dev: P.filter(([, r]) => r.dev && (!r.dev.open || !r.dev.inView || r.dev.links !== 42 || !r.dev.gallery || !r.dev.replay || !r.dev.closed || r.dev.switches.length)).map(([k, r]) => k + " " + JSON.stringify(r.dev)),
    devChecked: P.filter(([, r]) => r.dev).length,
    headingSkips: P.filter(([, r]) => r.headingSkips && r.headingSkips.length && r.W === 1366).map(([k, r]) => k + " " + r.headingSkips.join(", ")),
    smallTargets: P.filter(([, r]) => r.smallN && r.W === 390).map(([k, r]) => `${k} (${r.smallN}) ${r.small.join(", ")}`),
    ctaLabels: [...new Set(P.flatMap(([, r]) => r.ctas || []))],
    calcRoots: report.calc.filter((c) => c.w === 1366).map((c) => c.page + ": " + c.roots.map((r) => r.type + (r.full ? "(full)" : "") + JSON.stringify(r.inputs).slice(0, 0)).join(", ")),
    calcProblems: report.calc.flatMap((c) => c.problems),
    calcInteraction: report.calcInteraction,
    extra: Object.entries(report.extra).filter(([, r]) => r.sw > r.W || r.firstHidden || r.pending || r.errors.length || r.h1top < 0 || r.h1top > (r.W < 800 ? 1024 : 768)).map(([k, r]) => k + " " + JSON.stringify(r)),
    reduced: Object.entries(report.reduced).filter(([, r]) => r.sw > r.W || r.firstHidden.length || r.pending.length || r.pendingAfterScroll || r.errors.length).map(([k, r]) => k + " " + JSON.stringify(r)),
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(S, null, 1));
  console.log(JSON.stringify(S, null, 1));
});
