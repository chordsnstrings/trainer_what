// Full QA crawl for concept C (Playwright, no install needed).
//   node src/tools/qa.cjs [file.html ...] [--no-shots] [--jobs=3] [--ref=src/tools/ref-calc.json]
// Static checks over every page, then every page at 360x780, 390x844 and
// 1366x900 (plus a prefers-reduced-motion pass at 390 and 1366). Writes
// shots/qa/<page>-<w>.png (390 and 1366) and shots/qa/report.json.
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { chromium } = require("playwright");

const SITE = path.resolve(__dirname, "../../site");
const SHOTS = path.resolve(__dirname, "../../shots/qa");
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const only = args.filter((a) => !a.startsWith("--"));
const SHOOT = !args.includes("--no-shots");
const JOBS = Number(opt("jobs", 4));
const REF = JSON.parse(fs.readFileSync(opt("ref", path.resolve(__dirname, "ref-calc.json")), "utf8")); // from ref-calc.mts (real repo logic)
const VIEWPORTS = [[360, 780], [390, 844], [1366, 900]];
const RM_VIEWPORTS = [[390, 844], [1366, 900]];
const ALLOWED_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

const files = fs.readdirSync(SITE).filter((f) => f.endsWith(".html")).sort();
const targets = only.length ? only : files;
const issues = []; // { page, vp, check, detail }
const add = (page, vp, check, detail) => issues.push({ page, vp, check, detail });
const counts = {};
const tally = (check, ok) => { counts[check] = counts[check] || { pass: 0, fail: 0 }; counts[check][ok ? "pass" : "fail"]++; };

/* ---------------- Static checks ---------------- */
function staticChecks() {
  const ids = {};
  const html = {};
  for (const f of files) {
    html[f] = fs.readFileSync(path.join(SITE, f), "utf8");
    ids[f] = new Set([...html[f].matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  }
  tally("page count = 42", files.length === 42);
  if (files.length !== 42) add("*", "-", "page count", `${files.length} html files`);
  for (const f of targets) {
    const s = html[f];
    const head = [
      [/^<!doctype html>/i, "doctype"],
      [/<html lang="en"/, "html lang=en"],
      [/<meta charset="utf-8">/, "meta charset"],
      [/<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/, "viewport meta"],
      [/<title>[^<]{3,}<\/title>/, "title"],
      [/<link rel="icon" href="assets\/favicon.svg"/, "favicon"],
      [/<link rel="stylesheet" href="assets\/site.css">/, "site.css (view transitions)"],
    ];
    for (const [re, name] of head) { const ok = re.test(s); tally("head: " + name, ok); if (!ok) add(f, "-", "head", name + " missing"); }
    const h1 = (s.match(/<h1[\s>]/g) || []).length;
    tally("one h1 (static)", h1 === 1); if (h1 !== 1) add(f, "-", "h1", `${h1} h1`);
    // Links
    let bad = 0;
    for (const m of s.matchAll(/<a\b([^>]*)>/g)) {
      const a = m[1];
      const hm = a.match(/\shref="([^"]*)"/); if (!hm) continue;
      const href = hm[1].replace(/&amp;/g, "&");
      if (/^https?:\/\//.test(href)) {
        const okExt = /target="_blank"/.test(a) && /rel="[^"]*noopener/.test(a);
        tally("external links new tab + noopener", okExt); if (!okExt) add(f, "-", "external link", href);
        continue;
      }
      if (/^(mailto:|tel:)/.test(href) || href === "../") continue;
      if (/\sdownload[\s=>]/.test(" " + a + " ")) { add(f, "-", "a[download]", href); bad++; }
      const [, file, hash] = href.match(/^([^?#]*)(?:\?[^#]*)?(?:#(.*))?$/) || [];
      if (file) {
        if (!file.endsWith(".html") || !fs.existsSync(path.join(SITE, file))) { add(f, "-", "broken link", href); bad++; continue; }
        if (hash && !ids[file].has(decodeURIComponent(hash))) { add(f, "-", "broken anchor", href); bad++; }
      } else if (hash && !ids[f].has(decodeURIComponent(hash))) { add(f, "-", "broken in-page anchor", href); bad++; }
    }
    tally("internal links + anchors resolve", bad === 0);
    // External resources
    const ext = [...s.matchAll(/\s(?:src|href|srcset|poster|data)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((u) => {
      const host = new URL(u).host; return !ALLOWED_HOSTS.has(host);
    });
    const extTags = [...s.matchAll(/<(?:link|script|img|iframe|video|audio|source|embed|object)\b[^>]*\s(?:src|href)="https?:\/\/([^/"]+)/g)].map((m) => m[1]).filter((h) => !ALLOWED_HOSTS.has(h));
    tally("no disallowed external resources", extTags.length === 0); if (extTags.length) add(f, "-", "external resource", extTags.join(","));
    void ext;
    const imgsNoAlt = [...s.matchAll(/<img\b(?![^>]*\salt=)[^>]*>/g)].length;
    tally("img alt (static)", imgsNoAlt === 0); if (imgsNoAlt) add(f, "-", "img without alt", imgsNoAlt);
    const fontsOk = /fonts\.googleapis\.com\/css2\?[^"]*display=swap/.test(s);
    tally("fonts display=swap", fontsOk);
  }
  // Assets
  const assets = fs.readdirSync(path.join(SITE, "assets"));
  for (const a of assets.filter((x) => /\.(js|css)$/.test(x))) {
    const s = fs.readFileSync(path.join(SITE, "assets", a), "utf8");
    if (/\b(alert|confirm|prompt)\s*\(/.test(s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))) add("assets/" + a, "-", "alert/confirm/prompt", "found");
    const urls = [...s.matchAll(/https?:\/\/[^\s"')]+/g)].map((m) => m[0]).filter((u) => !/w3\.org/.test(u));
    if (urls.length) add("assets/" + a, "-", "external URL in asset", urls.slice(0, 3).join(" "));
    if (a.endsWith(".js")) {
      const ls = s.split("\n").filter((l) => /localStorage|sessionStorage/.test(l) && !/try/.test(l));
      if (ls.length) add("assets/" + a, "-", "storage outside try (check by eye)", ls.map((l) => l.trim().slice(0, 100)).join(" | "));
    }
  }
  const siteCss = fs.readFileSync(path.join(SITE, "assets/site.css"), "utf8");
  tally("@view-transition navigation:auto in site.css", /@view-transition\s*\{\s*navigation:\s*auto;?\s*\}/.test(siteCss));
  const gz = (n) => { try { return zlib.gzipSync(fs.readFileSync(path.join(SITE, "assets", n))).length; } catch { return 0; } };
  const motion = {};
  for (const g of ["core", "product", "audience", "money", "content"]) motion[g] = gz("boot.js") + gz("site.js") + gz(g + ".js");
  return { motionJsGzip: motion, calcJsGzip: gz("calc.js") };
}

/* ---------------- Browser checks ---------------- */
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = path.join(SITE, p === "/" ? "index.html" : p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

// In-page helpers, injected as a string.
const PAGE_HELPERS = `
window.__qa = {
  vis(el) {
    if (el.closest('[hidden],[inert],.sr-only,.skip')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  },
  opacityChain(el) { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; },
  hasText(el) { return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); },
  desc(el) { const c = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).slice(0, 3).join('.') : ''; return el.tagName.toLowerCase() + (c ? '.' + c : '') + ' "' + (el.textContent || '').trim().slice(0, 40) + '"'; },
  firstScreen() {
    const out = { pending: [], faded: [] };
    document.querySelectorAll('.reveal-pending').forEach((el) => { const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) out.pending.push(this.desc(el)); });
    const main = document.querySelector('main');
    for (const el of main.querySelectorAll('*')) {
      if (!this.hasText(el)) continue;
      const r = el.getBoundingClientRect();
      if (!(r.top < innerHeight && r.bottom > 0 && r.width > 0)) continue;
      if (el.closest('[hidden],[aria-hidden="true"] .vx-out,.vx-out,.sr-only')) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none') continue;
      const o = this.opacityChain(el);
      if (o < 0.95 || cs.visibility === 'hidden') out.faded.push(this.desc(el) + ' op=' + o.toFixed(2));
    }
    return out;
  },
  parse(c) {
    let m = c.match(/^rgba?\\(([^)]+)\\)/); if (m) { const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = c.match(/^color\\(srgb ([^)]+)\\)/); if (m) { const p = m[1].split(/[\\s\\/]+/).filter(Boolean).map(parseFloat); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    return null;
  },
  lum([r, g, b]) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); },
  over(top, bot) { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; },
  bgOf(el) {
    const layers = [];
    const er = el.getBoundingClientRect(), cx0 = er.left + er.width / 2, cy0 = er.top + er.height / 2;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      for (let sib = e.previousElementSibling; sib; sib = sib.previousElementSibling) {
        const ss = getComputedStyle(sib); if (ss.position !== 'absolute') continue;
        const sr = sib.getBoundingClientRect(); const c = this.parse(ss.backgroundColor);
        if (c && c[3] >= 1 && sr.left <= cx0 && sr.right >= cx0 && sr.top <= cy0 && sr.bottom >= cy0 && Number(ss.opacity) >= 1) return c;
      }
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/url\\(/.test(cs.backgroundImage)) return null;
      const c = this.parse(cs.backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let bg = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) bg = this.over(layers[i], bg);
    return bg;
  },
  contrast() {
    const fails = []; let n = 0;
    for (const el of document.body.querySelectorAll('*')) {
      if (!this.hasText(el) || !this.vis(el)) continue;
      if (el.closest('.vx-out,[aria-hidden="true"].vx-out,script,style,noscript,svg')) continue;
      const cs = getComputedStyle(el);
      const fg0 = this.parse(cs.color); if (!fg0) continue;
      const bg = this.bgOf(el); if (!bg) continue;
      const op = this.opacityChain(el); if (op < 0.2) continue;
      let fg = this.over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bg);
      const L1 = this.lum(fg), L2 = this.lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize), w = parseInt(cs.fontWeight, 10);
      const large = size >= 24 || (size >= 18.66 && w >= 700);
      n++;
      if (ratio < (large ? 3 : 4.5)) fails.push(this.desc(el) + ' ' + ratio.toFixed(2) + ':1 fg=' + cs.color + ' bg=rgb(' + bg.slice(0, 3).map(Math.round).join(',') + ') op=' + op.toFixed(2) + (el.closest('[aria-hidden="true"]') ? ' (aria-hidden)' : ''));
    }
    return { n, fails };
  },
  touch() {
    const small = [];
    for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=tab], [role=switch]')) {
      if (!this.vis(el) || el.closest('[aria-hidden="true"]')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'inline' && el.closest('p, li, td, dd, figcaption, label, .fine, .prose')) continue;
      if (el.type === 'checkbox' || el.type === 'radio') { const lab = el.closest('label') || document.querySelector('label[for="' + el.id + '"]'); if (lab && lab.getBoundingClientRect().height >= 44) continue; }
      const r0 = el.getBoundingClientRect();
      const a = getComputedStyle(el, '::after');
      const px = (v) => (/px$/.test(v) ? parseFloat(v) : 0);
      const r = (a.content !== 'none' && a.position === 'absolute' && cs.position !== 'static')
        ? { width: Math.max(r0.width, r0.width - px(a.left) - px(a.right)), height: Math.max(r0.height, r0.height - px(a.top) - px(a.bottom)) } : r0;
      if (r.height < 43.5 || r.width < 24) small.push(this.desc(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return small;
  },
  clipped() {
    const out = [];
    for (const el of document.querySelectorAll('main *, header *, footer *')) {
      if (!this.vis(el)) continue;
      const cs = getComputedStyle(el);
      if (!/(hidden|clip)/.test(cs.overflowX + cs.overflowY)) continue;
      if (el.closest('.vx, [class*="vx"], .sr-only, [aria-hidden="true"], .tbl-wrap, .tablist, .stepper-rail')) continue;
      if (el.scrollWidth > el.clientWidth + 2 && /hidden|clip/.test(cs.overflowX) && (el.textContent || '').trim()) out.push(this.desc(el) + ' sw=' + el.scrollWidth + ' cw=' + el.clientWidth);
      else if (el.scrollHeight > el.clientHeight + 2 && /hidden|clip/.test(cs.overflowY) && cs.textOverflow !== 'ellipsis' && this.hasText(el)) out.push(this.desc(el) + ' sh=' + el.scrollHeight + ' ch=' + el.clientHeight);
    }
    return out.slice(0, 8);
  },
  brokenWords() {
    const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement; if (!el || !this.vis(el) || el.closest('script,style,.sr-only,[aria-hidden="true"] .vx-out,.vx-out')) continue;
      const t = n.textContent; const re = /\S{2,}/g; let m;
      while ((m = re.exec(t))) {
        if (/[-‐–—\/·]/.test(m[0])) continue;
        range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0.5).map((r) => Math.round(r.top)));
        if (tops.size > 1) { out.push(this.desc(el) + ' word "' + m[0] + '"'); break; }
      }
      if (out.length >= 8) break;
    }
    return out;
  },
  wide() {
    return [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 1 && r.width > 0 && getComputedStyle(el).position !== 'fixed' && !el.closest('.tbl-wrap, .stepper-rail, .tablist, [hidden], .sr-only, .skip'); }).slice(0, 5).map((el) => this.desc(el));
  },
  focusOk(el) {
    const cs = getComputedStyle(el);
    const ow = parseFloat(cs.outlineWidth) || 0;
    return (cs.outlineStyle !== 'none' && ow >= 1) || (cs.boxShadow && cs.boxShadow !== 'none');
  },
};`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vpName = (w, h, rm) => `${w}x${h}${rm ? "-rm" : ""}`;

async function scrollThrough(page) {
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    const step = Math.round(innerHeight * 0.5);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 110)); }
    scrollTo(0, document.documentElement.scrollHeight); await new Promise((r) => setTimeout(r, 600));
  });
}

async function runOne(browser, port, file, [w, h], rm) {
  const vp = vpName(w, h, rm);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: rm ? "reduce" : "no-preference", hasTouch: w < 800, isMobile: false });
  await ctx.addInitScript(PAGE_HELPERS);
  const page = await ctx.newPage();
  const errors = [], reqBad = [];
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); else logs.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol === "data:" || u.protocol === "blob:") return;
    if (u.hostname === "127.0.0.1" && u.port === String(port)) return;
    if (!ALLOWED_HOSTS.has(u.hostname)) reqBad.push("disallowed host: " + r.url());
  });
  page.on("requestfailed", (r) => reqBad.push("failed: " + r.url() + " " + (r.failure() || {}).errorText));
  page.on("response", (r) => { if (r.status() >= 400) reqBad.push(r.status() + " " + r.url()); });

  await page.goto(`http://127.0.0.1:${port}/${file}`, { waitUntil: "domcontentloaded" });
  const fsEarly = await page.evaluate(() => window.__qa.firstScreen());
  await page.waitForLoadState("load");
  await sleep(1500);
  const fsLate = await page.evaluate(() => window.__qa.firstScreen());
  const phone = w <= 760;
  const R = { file, vp };

  tally("first screen: no .reveal-pending", fsEarly.pending.length + fsLate.pending.length === 0);
  if (fsEarly.pending.length || fsLate.pending.length) add(file, vp, "first screen hidden (.reveal-pending)", [...fsEarly.pending, ...fsLate.pending].slice(0, 5));
  if (fsEarly.faded.length) add(file, vp, "first paint: hidden text in first viewport (review: must be a later state)", fsEarly.faded.slice(0, 6));
  if (fsLate.faded.length) add(file, vp, "after hero change: hidden text in first viewport (review: must be a replaced state)", fsLate.faded.slice(0, 6));

  // Consent bar must not hide the hero H1 or the hero CTA on first visit.
  const consent = await page.evaluate(() => {
    const bar = document.querySelector("[data-consent-bar]"); if (!bar || bar.hidden) return null;
    const b = bar.getBoundingClientRect();
    const hit = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.bottom > b.top && r.top < b.bottom && r.top < innerHeight; };
    return { h1: hit(document.querySelector("h1")), cta: hit(document.querySelector('[data-hero] a[data-cta="primary"]')), top: Math.round(b.top) };
  });
  if (consent) { tally("consent bar clear of hero H1/CTA", !consent.h1 && !consent.cta); if (consent.h1 || consent.cta) add(file, vp, "consent bar covers hero", consent); }
  // Dismiss consent (returning visitor state) so the sticky bar can show.
  await page.evaluate(() => { const b = document.querySelector('[data-consent="denied"]'); if (b && b.tagName === "BUTTON") b.click(); });

  if (SHOOT && !rm && (w === 390 || w === 1366)) await page.screenshot({ path: path.join(SHOTS, `${file.replace(/\.html$/, "")}-${w}-top.png`) });

  await scrollThrough(page);
  const info = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    bodyOverflow: document.body.scrollWidth - innerWidth,
    wide: window.__qa.wide(),
    h1: document.querySelectorAll("h1").length,
    h1Vis: (() => { const h = document.querySelector("h1"); return !!h && window.__qa.vis(h); })(),
    title: document.title,
    pending: [...document.querySelectorAll(".reveal-pending")].map((e) => window.__qa.desc(e)).slice(0, 4),
    imgNoAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
    svgNoName: [...document.querySelectorAll('svg[role="img"]')].filter((s) => !s.getAttribute("aria-label") && !s.getAttribute("aria-labelledby") && !s.querySelector("title")).length,
    brokenImg: [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src),
    vtHeader: getComputedStyle(document.querySelector(".site-header")).viewTransitionName,
    vtFooter: getComputedStyle(document.querySelector(".site-footer")).viewTransitionName,
    vtRule: (() => { try { return [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => /@view-transition/.test(r.cssText) && /navigation:\s*auto/.test(r.cssText)); } catch { return false; } }); } catch { return false; } })(),
    clipped: window.__qa.clipped(),
    broken: window.__qa.brokenWords(),
    landmarks: { header: !!document.querySelector("header"), main: document.querySelectorAll("main").length, footer: !!document.querySelector("footer"), nav: !!document.querySelector("nav") },
  }));
  tally("console errors = 0", errors.length === 0); if (errors.length) add(file, vp, "console errors", errors.slice(0, 5));
  tally("requests clean (allowed hosts, no failures)", reqBad.length === 0); if (reqBad.length) add(file, vp, "requests", reqBad.slice(0, 5));
  tally("no horizontal overflow", info.overflow <= 0 && info.bodyOverflow <= 0); if (info.overflow > 0 || info.bodyOverflow > 0) add(file, vp, "horizontal overflow", { px: info.overflow, body: info.bodyOverflow, wide: info.wide });
  tally("exactly one visible H1 + title", info.h1 === 1 && info.h1Vis && /\S/.test(info.title)); if (!(info.h1 === 1 && info.h1Vis && info.title)) add(file, vp, "h1/title", { h1: info.h1, vis: info.h1Vis, title: info.title });
  tally("all reveals resolved after scroll", info.pending.length === 0); if (info.pending.length) add(file, vp, "reveal never resolved", info.pending);
  tally("images have alt / svg img named", !info.imgNoAlt && !info.svgNoName && !info.brokenImg.length); if (info.imgNoAlt || info.svgNoName || info.brokenImg.length) add(file, vp, "images", info);
  tally("view transitions declared (rule + header/footer names)", info.vtRule && info.vtHeader === "site-header" && info.vtFooter === "site-footer"); if (!(info.vtRule && info.vtHeader === "site-header" && info.vtFooter === "site-footer")) add(file, vp, "view transitions", info);
  tally("landmarks", info.landmarks.header && info.landmarks.main === 1 && info.landmarks.footer);
  if (info.clipped.length) add(file, vp, "clipped content (review)", info.clipped);
  tally("no words broken across lines", info.broken.length === 0); if (info.broken.length) add(file, vp, "word broken across lines", info.broken);

  if (!rm) {
    // Contrast (after reveals settled)
    if (w !== 360) {
      await sleep(900);
      const c = await page.evaluate(() => window.__qa.contrast());
      tally("text contrast >= 4.5 (3 large)", c.fails.length === 0); if (c.fails.length) add(file, vp, "contrast", c.fails.slice(0, 12));
      R.contrastChecked = c.n;
    }
    if (phone) {
      const small = await page.evaluate(() => window.__qa.touch());
      if (small.length) add(file, vp, "touch target < 44px (review)", small.slice(0, 10));
      tally("touch targets >= 44px (phone)", small.length === 0);
    }

    // Sticky CTA (phones)
    if (phone) {
      const st = await page.evaluate(async () => {
        const sticky = document.querySelector("[data-sticky]");
        if (!sticky) return { none: true };
        document.documentElement.style.scrollBehavior = 'auto';
        const H = document.documentElement.scrollHeight;
        const hero = document.querySelector('[data-hero]') || document.querySelector('main > section');
        const hb = hero.getBoundingClientRect().bottom + scrollY;
        scrollTo(0, Math.min(hb + 200, H / 2)); await new Promise((r) => setTimeout(r, 600));
        const midShown = sticky.classList.contains("is-shown");
        const endOnScreen = [...document.querySelectorAll("[data-closing], .site-footer")].some((e) => { const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
        const s = sticky.getBoundingClientRect();
        const dev = document.querySelector(".dev-toggle").getBoundingClientRect();
        const kam = document.querySelector(".kamran--float");
        const devOverlap = midShown && dev.bottom > s.top && dev.top < s.bottom && dev.right > s.left && dev.left < s.right;
        const padOk = parseFloat(getComputedStyle(document.body).paddingBottom) >= s.height - 1;
        scrollTo(0, H); await new Promise((r) => setTimeout(r, 700));
        const endShown = sticky.classList.contains("is-shown");
        let covered = null;
        if (endShown) {
          const t = sticky.getBoundingClientRect().top;
          const last = [...document.querySelectorAll(".site-footer p, .site-footer a, .site-footer button")].filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > t && r.top < innerHeight; });
          covered = last.map((e) => e.textContent.trim().slice(0, 30));
        }
        const ariaOk = sticky.getAttribute("aria-hidden") === String(!endShown) && (endShown ? !sticky.hasAttribute("inert") : sticky.hasAttribute("inert"));
        return { midShown, endShown, devOverlap, padOk, covered, ariaOk, shortPage: hb + 200 > H / 2, endOnScreen, kam: kam ? getComputedStyle(kam).display : null };
      });
      if (!st.none) {
        const ok = (st.midShown || st.shortPage || st.endOnScreen) && !st.endShown && !st.devOverlap && st.padOk && st.ariaOk;
        tally("sticky CTA: shows mid-page, hides at end, clear of dev button", ok);
        if (!ok) add(file, vp, "sticky CTA", st);
      }
    }

    // Header focus visibility + menus
    await page.evaluate(() => scrollTo(0, 0)); await sleep(200);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); document.body.focus(); });
    if (phone) {
      // Tab to the Menu button.
      let found = false, focusIssues = [];
      for (let i = 0; i < 8 && !found; i++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => { const a = document.activeElement; return { menu: a && a.matches("[data-menu-btn]"), inHeader: !!(a && a.closest("header, .skip")), ok: a ? window.__qa.focusOk(a) : false, d: a ? window.__qa.desc(a) : "" }; });
        if (r.inHeader && !r.ok) focusIssues.push(r.d);
        if (r.menu) found = true;
      }
      tally("header focus visible (phone)", found && !focusIssues.length); if (!found || focusIssues.length) add(file, vp, "header focus (phone)", { found, focusIssues });
      if (found) {
        await page.keyboard.press("Enter"); await sleep(700);
        const open = await page.evaluate(() => { const m = document.querySelector("[data-mobile-menu]"); const b = document.querySelector("[data-menu-btn]"); const r = m.getBoundingClientRect(); return { hidden: m.hidden, exp: b.getAttribute("aria-expanded"), focusIn: m.contains(document.activeElement), op: window.__qa.opacityChain(m), inView: r.top < innerHeight && r.bottom > 0, overflow: document.documentElement.scrollWidth - innerWidth, label: b.textContent.trim() }; });
        // Tab trap: tab many times; focus must stay in menu or button
        let escaped = false;
        for (let i = 0; i < 30; i++) { await page.keyboard.press("Tab"); const ok = await page.evaluate(() => document.querySelector("[data-mobile-menu]").contains(document.activeElement) || document.activeElement.matches("[data-menu-btn]")); if (!ok) { escaped = true; break; } }
        await page.keyboard.press("Escape"); await sleep(450);
        const closed = await page.evaluate(() => { const m = document.querySelector("[data-mobile-menu]"); const b = document.querySelector("[data-menu-btn]"); return { hidden: m.hidden, exp: b.getAttribute("aria-expanded"), focusBack: document.activeElement === b }; });
        // Click open / click close
        await page.click("[data-menu-btn]"); await sleep(400);
        const o2 = await page.evaluate(() => !document.querySelector("[data-mobile-menu]").hidden);
        await page.click("[data-menu-btn]"); await sleep(450);
        const c2 = await page.evaluate(() => document.querySelector("[data-mobile-menu]").hidden);
        const ok = !open.hidden && open.exp === "true" && open.focusIn && open.op > 0.95 && open.inView && !escaped && closed.hidden && closed.exp === "false" && closed.focusBack && o2 && c2;
        tally("mobile menu opens/closes (keyboard + click), focus trapped/restored", ok);
        if (!ok) add(file, vp, "mobile menu", { open, escaped, closed, o2, c2 });
      }
    } else {
      const focusIssues = []; const seen = [];
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => { const a = document.activeElement; return { inHeader: !!(a && a.closest("header, .skip")), ok: a ? window.__qa.focusOk(a) : false, d: a ? window.__qa.desc(a) : "" }; });
        if (!r.inHeader) break;
        seen.push(r.d); if (!r.ok) focusIssues.push(r.d);
      }
      tally("header focus visible (desktop)", focusIssues.length === 0 && seen.length >= 8); if (focusIssues.length || seen.length < 8) add(file, vp, "header focus (desktop)", { focusIssues, seen: seen.length });
      // Dropdown via keyboard
      await page.focus(".nav-menu-btn");
      await page.keyboard.press("Enter"); await sleep(250);
      const o = await page.evaluate(() => { const m = document.getElementById("menu-trainers"); return { hidden: m.hidden, op: window.__qa.opacityChain(m) }; });
      await page.keyboard.press("ArrowDown"); await sleep(50);
      const firstFocused = await page.evaluate(() => document.activeElement.classList.contains("nav-menu-link") && window.__qa.focusOk(document.activeElement));
      await page.keyboard.press("Escape"); await sleep(250);
      const c = await page.evaluate(() => ({ hidden: document.getElementById("menu-trainers").hidden, back: document.activeElement.matches(".nav-menu-btn") }));
      const ok = !o.hidden && o.op > 0.95 && firstFocused && c.hidden && c.back;
      tally("desktop dropdown keyboard open/arrow/escape", ok); if (!ok) add(file, vp, "desktop dropdown", { o, firstFocused, c });
    }

    // Dev panel (all pages at 1366 + 390)
    if (w !== 360) {
      const dev = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const d = document.documentElement;
        const btn = document.querySelector("[data-dev-toggle]"); btn.click(); await wait(500);
        const panel = document.getElementById("dev-panel");
        const pr = panel.getBoundingClientRect();
        const res = { open: !panel.hidden && window.__qa.opacityChain(panel) > 0.95, inView: pr.left >= 0 && pr.right <= innerWidth + 0.5 && pr.top >= 0 && pr.bottom <= innerHeight + 0.5, flags: {}, links: panel.querySelectorAll(".dev-pages a").length, all: (panel.querySelector(".dev-all") || {}).getAttribute ? panel.querySelector(".dev-all").getAttribute("href") : null };
        for (const sw of panel.querySelectorAll("[data-flag]")) {
          const f = sw.getAttribute("data-flag"); const before = d.getAttribute("data-" + f);
          sw.click(); await wait(30);
          const after = d.getAttribute("data-" + f); const aria = sw.getAttribute("aria-checked");
          // flag-dependent content must follow
          const onSel = { payments: ".if-payments-on", publish: ".if-publish-open", registration: ".if-reg-closed", frontier: ".if-frontier-on", voice: ".if-voice-on" }[f];
          let follows = true;
          if (onSel) { const els = [...document.querySelectorAll(onSel)]; if (els.length) follows = els.some((e) => getComputedStyle(e).display !== "none"); }
          sw.click(); await wait(30);
          const back = d.getAttribute("data-" + f);
          res.flags[f] = { before, after, aria, back, follows, ok: before !== after && back === before && follows };
        }
        // Registration closed changes the CTA label
        const reg = panel.querySelector('[data-flag="registration"]'); reg.click(); await wait(30);
        const ea = document.getElementById('early-access'); const eaShown = () => !!ea && ea.getClientRects().length > 0;
        res.earlyAccessWhenClosed = ea ? eaShown() : null;
        const ctas = [...document.querySelectorAll('a[data-cta="primary"]')];
        const label = () => ctas.map((a) => [...a.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.textContent.trim()).join('')).filter(Boolean);
        const cta = ctas[0]; res.closedLabel = cta ? [...new Set(label())].join(' | ') : null; reg.click(); await wait(30);
        res.openLabel = cta ? [...new Set(label())].join(' | ') : null;
        res.earlyAccessWhenOpen = ea ? eaShown() : null;
        panel.querySelector("[data-replay-hero]").click(); await wait(600);
        panel.querySelector("[data-reset-flags]").click(); await wait(30);
        res.live = ["payments", "publish", "registration", "frontier", "voice"].map((k) => d.getAttribute("data-" + k)).join(",");
        panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await wait(300);
        res.closed = panel.hidden;
        return res;
      });
      const flagsOk = Object.values(dev.flags).every((x) => x.ok) && Object.keys(dev.flags).length === 6;
      const ok = dev.open && dev.inView && flagsOk && dev.links === 42 && dev.all === "../" && dev.closed && dev.live === "off,blocked,open,off,off" && ((dev.closedLabel && dev.closedLabel !== dev.openLabel) || (dev.earlyAccessWhenClosed === true && dev.earlyAccessWhenOpen === false));
      tally("dev panel: opens in view, 6 toggles flip + content follows, 42 links, All concepts, replay, reset, Esc", ok);
      if (!ok) add(file, vp, "dev panel", dev);
    }

    // Screenshot full page
    if (SHOOT && (w === 390 || w === 1366)) {
      await page.evaluate(() => scrollTo(0, 0)); await sleep(300);
      await page.screenshot({ path: path.join(SHOTS, `${file.replace(/\.html$/, "")}-${w}.png`), fullPage: true });
    }
  }
  if (errors.length && !R.errors) R.errors = errors.slice(0, 3);
  await ctx.close();
  return R;
}

// Calculator checks: in-page maths + rendered defaults + one input change round trip.
async function calcChecks(browser, port) {
  const aed = (minor) => "AED " + Math.round(minor / 100).toLocaleString("en-US");
  const F = REF.follower;
  const expect = {
    "index.html": [aed(F.cautious.revenueMonth12Minor), aed(F.typical.revenueMonth12Minor), aed(F.strong.revenueMonth12Minor)],
    "follower-calculator.html": [aed(F.cautious.revenueMonth12Minor), aed(F.typical.revenueMonth12Minor), aed(F.strong.revenueMonth12Minor)],
    "earnings-calculator.html": [aed(REF.full.averageMonthlyMinor), aed(REF.full.subscriptionMonthlyMinor), aed(REF.full.commissionMinor), aed(REF.full.beforeOtherCostsMinor)],
    "pricing.html": [aed(REF.compact.subscriptionMonthlyMinor), aed(REF.compact.commissionMinor), aed(REF.compact.beforeOtherCostsMinor), aed(REF.worked.subscriptionMonthlyMinor), aed(REF.worked.commissionMinor), aed(REF.worked.beforeOtherCostsMinor)],
  };
  const change = {
    "index.html": ["#fc-followers", "20000", "7000", [aed(REF.follower20k.typical), aed(REF.follower20k.strong)]],
    "follower-calculator.html": ["#fc-followers", "20000", "7000", [aed(REF.follower20k.typical), aed(REF.follower20k.strong)]],
    "earnings-calculator.html": ["#ec-subs", "150", "60", [aed(REF.full150.subscriptionMonthlyMinor), aed(REF.full150.commissionMinor), aed(REF.full150.beforeOtherCostsMinor)]],
    "pricing.html": ["#ec-subs", "150", "60", [aed(REF.worked.subscriptionMonthlyMinor), aed(REF.worked.commissionMinor), aed(REF.worked.beforeOtherCostsMinor)]],
  };
  const results = {};
  for (const [file, vals] of Object.entries(expect)) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const tracked = [];
    page.on("console", (m) => tracked.push(m.text()));
    await page.goto(`http://127.0.0.1:${port}/${file}`, { waitUntil: "load" });
    await sleep(500);
    const math = await page.evaluate(() => {
      const c = window.tyCalc; if (!c) return null;
      const f = c.estimateFollowerConversion(c.DEFAULT_FOLLOWER_INPUTS);
      const e = c.estimateEarnings(c.DEFAULT_EARNINGS_INPUTS);
      return { f: { cautious: f.scenarios.cautious.revenueMonth12Minor, typical: f.scenarios.typical.revenueMonth12Minor, strong: f.scenarios.strong.revenueMonth12Minor }, e: { averageMonthlyMinor: e.averageMonthlyMinor, subscriptionMonthlyMinor: e.subscriptionMonthlyMinor, commissionMinor: e.commissionMinor, beforeOtherCostsMinor: e.beforeOtherCostsMinor, equivalentSessions: e.equivalentSessions } };
    });
    const mathOk = math && math.f.cautious === F.cautious.revenueMonth12Minor && math.f.typical === F.typical.revenueMonth12Minor && math.f.strong === F.strong.revenueMonth12Minor && math.e.subscriptionMonthlyMinor === REF.full.subscriptionMonthlyMinor && math.e.commissionMinor === REF.full.commissionMinor && math.e.beforeOtherCostsMinor === REF.full.beforeOtherCostsMinor && math.e.averageMonthlyMinor === REF.full.averageMonthlyMinor && math.e.equivalentSessions === REF.full.equivalentSessions;
    const text0 = await page.evaluate(() => document.querySelector("main").innerText);
    const missing0 = vals.filter((v) => !text0.includes(v));
    const [sel, v1, v0, vals1] = change[file];
    await page.fill(sel, v1); await page.dispatchEvent(sel, "input"); await sleep(900);
    const text1 = await page.evaluate(() => document.querySelector("main").innerText);
    const missing1 = vals1.filter((v) => !text1.includes(v));
    const live = await page.evaluate(() => [...document.querySelectorAll('main [aria-live]')].map((e) => e.textContent.trim()).filter(Boolean).join(" | ").slice(0, 200));
    await page.fill(sel, v0); await page.dispatchEvent(sel, "input"); await sleep(900);
    const text2 = await page.evaluate(() => document.querySelector("main").innerText);
    const missing2 = vals.filter((v) => !text2.includes(v));
    const ev = tracked.filter((t) => /calc_input|calc_result_view/.test(t)).length;
    const ok = mathOk && !missing0.length && !missing1.length && !missing2.length;
    tally("calculators match apps/web real logic (defaults + changed input)", ok);
    results[file] = { mathOk, missing0, missing1, missing2, live, calcEvents: ev };
    if (!ok) add(file, "1366x900", "calculator", results[file]);
    await ctx.close();
  }
  return results;
}

(async () => {
  const stat = staticChecks();
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY || "http://127.0.0.1:40713", bypass: "127.0.0.1,localhost" } });
  const jobs = [];
  for (const f of targets) {
    for (const v of VIEWPORTS) jobs.push([f, v, false]);
    for (const v of RM_VIEWPORTS) jobs.push([f, v, true]);
  }
  const results = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const [f, v, rm] = jobs[next++];
      try { results.push(await runOne(browser, port, f, v, rm)); }
      catch (e) { add(f, vpName(v[0], v[1], rm), "crawl crashed", String(e.message || e).slice(0, 300)); tally("crawl ran", false); }
    }
  }
  await Promise.all(Array.from({ length: JOBS }, worker));
  let calc = {};
  if (!only.length || only.some((f) => /index|pricing|calculator/.test(f))) calc = await calcChecks(browser, port);
  await browser.close();
  server.close();
  const report = { when: new Date().toISOString(), pages: targets.length, loads: jobs.length, static: stat, counts, calc, issues };
  fs.writeFileSync(path.join(SHOTS, "report.json"), JSON.stringify(report, null, 1));
  console.log(`pages=${targets.length} loads=${jobs.length}`);
  console.log("motion JS gzip (boot+site+group):", JSON.stringify(stat.motionJsGzip), "calc.js gzip:", stat.calcJsGzip);
  for (const [k, v] of Object.entries(counts)) console.log(`${v.fail ? "FAIL" : "ok  "} ${k}: pass=${v.pass} fail=${v.fail}`);
  console.log("calc:", JSON.stringify(calc));
  const by = {};
  for (const i of issues) (by[i.check] = by[i.check] || []).push(i);
  for (const [k, list] of Object.entries(by)) {
    console.log(`\n## ${k} (${list.length})`);
    for (const i of list.slice(0, 14)) console.log(`  ${i.page} @${i.vp}: ${JSON.stringify(i.detail).slice(0, 400)}`);
  }
})();
