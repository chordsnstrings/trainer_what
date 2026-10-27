// Concept A full QA crawl.
//   node qa/crawl.mjs [--no-shots] [--only=index,pricing] [--skip-rm] [--skip-tab]
// Serves ../site, crawls every page at 360x780, 390x844 and 1366x900 and runs the
// checks listed in the QA brief. Fonts are served from qa/fonts (a cached copy of
// the Google Fonts responses) so the crawl does not depend on network access.
// Writes qa/report.json and screenshots to ../shots/qa/.
import { createServer } from "node:http";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const QA = dirname(fileURLToPath(import.meta.url));
const ROOT = join(QA, "..");
const SITE = join(ROOT, "site");
const SHOTS = join(ROOT, "shots", "qa");
const FONTS = join(QA, "fonts");
const EXPECTED = JSON.parse(readFileSync(join(QA, "expected.json"), "utf8"));
const { PAGES } = await import(join(ROOT, "src", "registry.mjs"));

const args = process.argv.slice(2);
const opt = (k) => args.includes("--" + k);
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice(7).split(",") : null;
const FILES = PAGES.map((p) => p.file).filter((f) => !ONLY || ONLY.includes(f.replace(/\.html$/, "")));
const widthsArg = args.find((a) => a.startsWith("--widths="));
const SIZES = widthsArg ? widthsArg.slice(9).split(",").map((w) => [(+w < 761 ? "m" : "d") + w, +w, +w < 761 ? 844 : 900]) : [["m360", 360, 780], ["m390", 390, 844], ["d1366", 1366, 900]];
const issues = [];
const counts = {};
const bump = (k, n = 1) => (counts[k] = (counts[k] || 0) + n);
const issue = (check, file, size, detail) => issues.push({ check, file, size, detail });

/* ------------------------------------------------------------ static checks */
function staticChecks() {
  const all = readdirSync(SITE).filter((f) => f.endsWith(".html"));
  bump("static.pages", all.length);
  const expected = PAGES.map((p) => p.file);
  for (const f of expected) if (!all.includes(f)) issue("pages.missing", f, "-", "page file missing");
  if (all.length !== 42) issue("pages.count", "-", "-", `${all.length} html files`);
  const ids = {};
  for (const f of all) ids[f] = new Set([...readFileSync(join(SITE, f), "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const f of all) {
    const html = readFileSync(join(SITE, f), "utf8");
    if (!html.startsWith("<!doctype html>")) issue("doc.doctype", f, "-", "no doctype");
    if (!/<html lang="en"/.test(html)) issue("doc.lang", f, "-", "no lang=en");
    if (!/<meta charset="utf-8">/.test(html)) issue("doc.charset", f, "-", "");
    if (!html.includes('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')) issue("doc.viewport", f, "-", "");
    if (!/<title>[^<]+<\/title>/.test(html)) issue("doc.title", f, "-", "");
    if (!html.includes('href="assets/favicon.svg"')) issue("doc.favicon", f, "-", "");
    if (/<a[^>]*\sdownload[\s>=]/.test(html)) issue("doc.download", f, "-", "a[download]");
    if (/<(iframe|video|audio|object|embed)\b/.test(html)) issue("doc.embed", f, "-", "embedded media");
    // duplicate ids
    const idList = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dup = idList.filter((x, i) => idList.indexOf(x) !== i);
    if (dup.length) issue("a11y.duplicate-id", f, "-", [...new Set(dup)].join(", "));
    // id references
    for (const m of html.matchAll(/\s(aria-controls|aria-labelledby|aria-describedby|for|list)="([^"]+)"/g)) {
      for (const ref of m[2].split(/\s+/)) if (ref && !ids[f].has(ref)) issue("a11y.broken-idref", f, "-", `${m[1]}="${ref}"`);
    }
    // links
    for (const m of html.matchAll(/<a\b([^>]*)>/g)) {
      const attrs = m[1];
      const h = (attrs.match(/\shref="([^"]*)"/) || [])[1];
      if (h === undefined) continue;
      bump("links.total");
      if (/^https?:/.test(h)) {
        bump("links.external");
        if (!/target="_blank"/.test(attrs) || !/rel="[^"]*noopener/.test(attrs)) issue("links.external-attrs", f, "-", h);
        continue;
      }
      if (/^(mailto:|tel:)/.test(h)) continue;
      if (h === "../") continue; // gallery link from the dev panel
      if (h.startsWith("#")) {
        if (h.length > 1 && !ids[f].has(h.slice(1))) issue("links.broken-hash", f, "-", h);
        continue;
      }
      const [path, hash] = h.split("#");
      const file = path.split("?")[0];
      if (!file.endsWith(".html")) { issue("links.non-html", f, "-", h); continue; }
      bump("links.internal");
      if (!existsSync(join(SITE, file))) issue("links.broken", f, "-", h);
      else if (hash && !(ids[file] || new Set()).has(hash)) issue("links.broken-hash", f, "-", h);
    }
    for (const m of html.matchAll(/\s(?:src|href)="(assets\/[^"]+)"/g)) if (!existsSync(join(SITE, m[1]))) issue("assets.missing", f, "-", m[1]);
    for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt="/.test(m[0])) issue("a11y.img-alt", f, "-", m[0].slice(0, 80));
    // external resources other than Google Fonts
    for (const m of html.matchAll(/<(?:link|script|img|source)\b[^>]*\s(?:href|src)="(https?:[^"]+)"/g)) {
      if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(m[1])) issue("hosting.external-resource", f, "-", m[1]);
    }
  }
  // assets: forbidden APIs, unguarded storage
  for (const f of readdirSync(join(SITE, "assets"))) {
    if (!/\.(js|css)$/.test(f)) continue;
    const src = readFileSync(join(SITE, "assets", f), "utf8");
    if (/\b(alert|confirm|prompt)\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))) issue("hosting.dialog-api", f, "-", "alert/confirm/prompt");
    if (f.endsWith(".css")) {
      for (const m of src.matchAll(/url\(\s*["']?(https?:[^"')]+)/g)) issue("hosting.css-external", f, "-", m[1]);
    }
    if (f.endsWith(".js")) {
      const lines = src.split("\n");
      lines.forEach((l, i) => { if (/localStorage|sessionStorage/.test(l) && !/try\s*\{/.test(l) && !/try\s*\{/.test(lines[i - 1] || "") && !/store\./.test(l)) issue("hosting.storage-unguarded", f, "-", `line ${i + 1}: ${l.trim().slice(0, 90)}`); });
    }
  }
  const css = readFileSync(join(SITE, "assets", "site.css"), "utf8");
  if (!/@view-transition\s*\{\s*navigation:\s*auto;?\s*\}/.test(css)) issue("vt.css", "site.css", "-", "@view-transition rule missing");
}

/* --------------------------------------------------------------- server */
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
function serve() {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(SITE, p));
    if (!file.startsWith(SITE) || !existsSync(file)) { res.writeHead(404, { "content-type": "text/html" }); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => {
    let port = 4410;
    server.on("error", () => server.listen(++port));
    server.listen(port, "127.0.0.1", () => ok({ server, port: server.address().port }));
  });
}

async function fontRoute(route) {
  const url = route.request().url();
  if (url.startsWith("https://fonts.googleapis.com/")) {
    const file = url.includes("Arabic") ? "arabic.css" : "main.css";
    return route.fulfill({ status: 200, contentType: "text/css", body: readFileSync(join(FONTS, file)) });
  }
  const name = url.replace("https://fonts.gstatic.com/", "").replace(/\//g, "_");
  if (existsSync(join(FONTS, name))) return route.fulfill({ status: 200, contentType: "font/woff2", body: readFileSync(join(FONTS, name)), headers: { "access-control-allow-origin": "*" } });
  return route.abort();
}

/* ------------------------------------------------------ in-page helpers */
const DESC = `function desc(el){ if(!el) return "?"; var s=el.tagName.toLowerCase(); if(el.id) s+="#"+el.id; var c=(typeof el.className==="string"?el.className:"").trim().split(/\\s+/).filter(Boolean).slice(0,3); if(c.length) s+="."+c.join("."); return s; }
function chromeEl(el){ return el.closest(".devpanel,.dev-btn,.sticky-cta,.consent,.kamran-pop,.kamran-float,.menu-sheet,.skip,template,script,style,noscript"); }
function hiddenAnc(el){ return el.closest("[hidden],[aria-hidden='true'],.sr-only,[inert]"); }
function effOpacity(el){ var o=1; for(var n=el;n&&n.nodeType===1;n=n.parentElement){ var cs=getComputedStyle(n); o*=parseFloat(cs.opacity); if(cs.visibility==="hidden"&&n===el) o=0; if(cs.display==="none") return 0; } return o; }`;

const firstScreenFn = new Function(`${DESC}
  var vh=innerHeight, out={pending:[],hidden:[]};
  document.querySelectorAll(".reveal-pending").forEach(function(e){ var r=e.getBoundingClientRect(); if(r.height&&r.bottom>0&&r.top<vh) out.pending.push(desc(e)); });
  var tw=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), n;
  while((n=tw.nextNode())){
    if(!n.nodeValue.trim()) continue; var el=n.parentElement; if(!el||chromeEl(el)||hiddenAnc(el)) continue;
    var rg=document.createRange(); rg.selectNodeContents(n); var r=rg.getBoundingClientRect();
    if(!r.width||!r.height||r.bottom<=0||r.top>=vh) continue;
    var cs=getComputedStyle(el); if(cs.visibility==="hidden") { out.collapsed=(out.collapsed||0)+1; continue; }
    var o=effOpacity(el); if(o<0.6){ var st=el.closest("[data-state]"); if(st) { out.afterState=(out.afterState||0)+1; continue; } out.hidden.push(desc(el)+" '"+n.nodeValue.trim().slice(0,30)+"' opacity "+o.toFixed(2)); }
  }
  return out;`);

const overflowFn = new Function(`${DESC}
  var vw=document.documentElement.clientWidth, wide=[];
  document.querySelectorAll("body *").forEach(function(el){
    var r=el.getBoundingClientRect(); if(!r.width||!r.height) return;
    if(r.right>vw+1||r.left<-1){ var cs=getComputedStyle(el); if(cs.position==="fixed") return;
      for(var p=el.parentElement;p&&p!==document.body;p=p.parentElement){ var ps=getComputedStyle(p); if(/(auto|scroll|hidden|clip)/.test(ps.overflowX)) return; }
      if(hiddenAnc(el)||chromeEl(el)) return; wide.push(desc(el)+" r="+Math.round(r.right)); }
  });
  return { sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: innerWidth, wide: wide.slice(0,6) };`);

const basicsFn = new Function(`${DESC}
  var h1=document.querySelectorAll("h1");
  var imgs=[].slice.call(document.querySelectorAll("img:not([alt])")).map(desc);
  var svgs=[].slice.call(document.querySelectorAll("svg[role='img']")).filter(function(s){return !s.getAttribute("aria-label")&&!s.getAttribute("aria-labelledby")&&!s.querySelector("title");}).map(desc);
  var unlabelled=[].slice.call(document.querySelectorAll("input:not([type=hidden]),select,textarea")).filter(function(i){ if(i.closest('[hidden]')) return false; if(i.getAttribute("aria-label")||i.getAttribute("aria-labelledby")||i.title) return false; if(i.id&&document.querySelector('label[for="'+i.id+'"]')) return false; if(i.closest("label")) return false; return true; }).map(desc);
  var vt=false; for(var i=0;i<document.styleSheets.length;i++){ try{ var rs=document.styleSheets[i].cssRules; for(var j=0;j<rs.length;j++){ if(/^@view-transition/.test(rs[j].cssText)&&/navigation:\\s*auto/.test(rs[j].cssText)) vt=true; } }catch(e){} }
  var hd=document.querySelector("header.site-header"), ft=document.querySelector("footer.site-footer");
  var hs=hd&&getComputedStyle(hd);
  return { title: document.title, h1: h1.length, h1Text: h1[0]&&h1[0].textContent.trim(), imgs: imgs, svgs: svgs, unlabelled: unlabelled, vt: vt,
    vtHeader: hd&&getComputedStyle(hd).viewTransitionName, vtFooter: ft&&getComputedStyle(ft).viewTransitionName,
    headerPos: hs&&hs.position, headerTop: hs&&hs.top, track: typeof window.tyTrack==="function", main: document.querySelectorAll("main").length,
    colorScheme: getComputedStyle(document.documentElement).colorScheme, bodyBg: getComputedStyle(document.body).backgroundColor };`);

const contrastFn = new Function(`${DESC}
  function parse(c){ var m=c.match(/rgba?\\(([^)]+)\\)/); if(m){ var p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(parseFloat); return [p[0],p[1],p[2],p.length>3?p[3]:1]; }
    m=c.match(/color\\(srgb ([^)]+)\\)/); if(m){ var q=m[1].split(/[ \\/]+/).filter(Boolean).map(parseFloat); return [q[0]*255,q[1]*255,q[2]*255,q.length>3?q[3]:1]; } return null; }
  function over(top,bot){ var a=top[3]; return [top[0]*a+bot[0]*(1-a),top[1]*a+bot[1]*(1-a),top[2]*a+bot[2]*(1-a),1]; }
  function lum(c){ return [c[0],c[1],c[2]].map(function(v){ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); }).reduce(function(s,v,i){ return s+v*[0.2126,0.7152,0.0722][i]; },0); }
  function ratio(a,b){ var x=lum(a),y=lum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }
  var out=[], checked=0, skipped=0, seen={};
  var tw=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), n;
  while((n=tw.nextNode())){
    if(!n.nodeValue.trim()) continue; var el=n.parentElement; if(!el||chromeEl(el)||hiddenAnc(el)) continue;
    if(el.closest("[disabled],[aria-disabled='true']")) continue;
    var r=el.getBoundingClientRect(); if(!r.width||!r.height) continue;
    var op=effOpacity(el); if(op<0.2) continue;
    var cs=getComputedStyle(el); var fg=parse(cs.color); if(!fg){ skipped++; continue; }
    var layers=[], img=false;
    for(var p=el;p;p=p.parentElement){ var ps=getComputedStyle(p); if(ps.backgroundImage&&ps.backgroundImage!=="none"&&!/radial-gradient\\(.*(transparent|rgba?\\([^)]*,\\s*0\\))/.test(ps.backgroundImage)&&!/^radial-gradient/.test(ps.backgroundImage)){ img=true; break; } var b=parse(ps.backgroundColor); if(b&&b[3]>0){ layers.push(b); if(b[3]>=1) break; } }
    if(img){ skipped++; continue; }
    var bg=[255,255,255,1]; for(var i=layers.length-1;i>=0;i--) bg=over(layers[i],bg);
    var f=over([fg[0],fg[1],fg[2],fg[3]*op],bg);
    var size=parseFloat(cs.fontSize), wt=parseInt(cs.fontWeight,10);
    var large=size>=24||(size>=18.66&&wt>=700);
    var rt=ratio(f,bg); checked++;
    if(rt<(large?3:4.5)){ var key=desc(el)+"|"+cs.color+"|"+bg.join(","); if(seen[key]) continue; seen[key]=1;
      out.push(desc(el)+" '"+n.nodeValue.trim().slice(0,28)+"' "+rt.toFixed(2)+" fg "+cs.color+" op "+op.toFixed(2)+" bg rgb("+bg.slice(0,3).map(Math.round).join(",")+") "+size+"px/"+wt); }
  }
  return { out: out.slice(0,20), checked: checked, skipped: skipped };`);

const targetsFn = new Function(`${DESC}
  var small=[];
  document.querySelectorAll("a.btn,button,[role=tab],[role=switch],input:not([type=hidden]),select,textarea,summary,.chip a,a.tlink,.menu-btn").forEach(function(el){
    if(hiddenAnc(el)||el.closest(".devpanel")) return; var cs=getComputedStyle(el); if(cs.display==="none"||cs.visibility==="hidden") return;
    if(el.closest(".sticky-cta")&&!el.closest(".is-shown")) return;
    var r=el.getBoundingClientRect(); if(!r.width||!r.height) return;
    if(el.matches("input[type=checkbox],input[type=radio]")){ var l=el.closest("label")||document.querySelector('label[for="'+el.id+'"]'); if(l){ var lr=l.getBoundingClientRect(); if(lr.height>=44) return; } }
    if(el.matches("input[type=range]")) { if(r.height>=24) return; }
    if(el.matches("a.tlink")&&el.closest("p,li")) return;
    if(el.matches(".dev-btn")){ var a=getComputedStyle(el,"::after"); var ext=-parseFloat(a.right||0)||0; if(r.width+ext>=44&&r.height>=44) return; }
    if(r.height<43.5||r.width<43.5) small.push(desc(el)+" "+Math.round(r.width)+"x"+Math.round(r.height)+" '"+(el.textContent||el.value||"").trim().slice(0,24)+"'");
  });
  return small;`);

/* ------------------------------------------------------------ crawl */
async function scrollThrough(page, h) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < total; y += Math.round(h * 0.6)) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  const left = await page.evaluate(() => document.querySelectorAll(".reveal-pending").length);
  if (left) {
    bump("info.reveal-retry", left);
    await page.evaluate(async () => { for (const u of [...document.querySelectorAll(".reveal-pending")]) { u.scrollIntoView({ block: "center" }); await new Promise((r) => setTimeout(r, 200)); } });
    await page.waitForTimeout(400);
  }
}

async function newPage(browser, w, h, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...extra });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const url = route.request().url();
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) return fontRoute(route);
    route.abort();
  });
  const page = await ctx.newPage();
  const log = { errors: [], failed: [], external: [] };
  page.on("console", (m) => { if (m.type() === "error") log.errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => log.errors.push("pageerror: " + String(e).slice(0, 200)));
  page.on("request", (r) => { const u = r.url(); if (!u.startsWith("http://127.0.0.1") && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u) && !u.startsWith("data:")) log.external.push(u); });
  page.on("requestfailed", (r) => log.failed.push(r.url() + " " + (r.failure()?.errorText || "")));
  page.on("response", (r) => { if (r.status() >= 400) log.failed.push(r.url() + " " + r.status()); });
  return { ctx, page, log };
}

async function crawlOne(browser, base, file, [sz, w, h]) {
  const { ctx, page, log } = await newPage(browser, w, h);
  await page.goto(`${base}/${file}`, { waitUntil: "load" });
  await page.waitForTimeout(150);
  const first = await page.evaluate(firstScreenFn);
  bump("checks.first-screen");
  if (first.pending.length) issue("first-screen.reveal-pending", file, sz, first.pending.join(", "));
  if (first.hidden.length) issue("first-screen.hidden-text", file, sz, first.hidden.slice(0, 6).join(" | "));
  if (first.afterState) bump("info.first-screen-vignette-after-state-texts", first.afterState);
  const basics = await page.evaluate(basicsFn);
  bump("checks.basics");
  if (!basics.title) issue("doc.title-empty", file, sz, "");
  if (basics.h1 !== 1) issue("doc.h1-count", file, sz, `${basics.h1} h1`);
  if (basics.main !== 1) issue("doc.main-count", file, sz, `${basics.main} main`);
  if (basics.imgs.length) issue("a11y.img-alt", file, sz, basics.imgs.join(", "));
  if (basics.svgs.length) issue("a11y.svg-name", file, sz, basics.svgs.join(", "));
  if (basics.unlabelled.length) issue("a11y.unlabelled-control", file, sz, basics.unlabelled.join(", "));
  if (!basics.vt) issue("vt.rule", file, sz, "@view-transition navigation:auto not in CSSOM");
  if (basics.vtHeader !== "site-header" || basics.vtFooter !== "site-footer") issue("vt.names", file, sz, `${basics.vtHeader}/${basics.vtFooter}`);
  if (basics.headerPos !== "sticky" || basics.headerTop !== "0px") issue("layout.header-sticky", file, sz, `${basics.headerPos} top ${basics.headerTop}`);
  if (!basics.track) issue("track.missing", file, sz, "");
  if (basics.colorScheme !== "light") issue("theme.color-scheme", file, sz, basics.colorScheme);
  // consent first, so the sticky bar can show
  const allow = page.locator('[data-consent] [data-consent-choice="granted"]');
  if (await allow.isVisible()) await allow.click();
  await scrollThrough(page, h);
  const left = await page.evaluate(() => [...document.querySelectorAll(".reveal-pending")].map((e) => e.tagName.toLowerCase() + "." + String(e.className).split(" ").slice(0, 2).join(".") + " h=" + Math.round(e.getBoundingClientRect().height)));
  bump("checks.reveal-complete");
  if (left.length) issue("reveal.never-revealed", file, sz, left.join(", "));
  const ov = await page.evaluate(overflowFn);
  bump("checks.overflow");
  if (ov.sw > ov.iw || ov.bw > ov.iw) issue("layout.h-overflow", file, sz, `scrollWidth ${ov.sw}/${ov.iw} ${ov.wide.join(", ")}`);
  else if (ov.wide.length) bump("info.wide-but-clipped");
  // sticky bar at end of page (phones)
  if (w < 761) {
    bump("checks.sticky-end");
    const st = await page.evaluate(() => {
      const s = document.querySelector(".sticky-cta"); const r = s.getBoundingClientRect();
      const shown = s.classList.contains("is-shown") && r.top < innerHeight - 2 && parseFloat(getComputedStyle(s).opacity) > 0.05;
      const covered = [];
      const hb = document.querySelector("header.site-header").getBoundingClientRect().bottom;
      document.querySelectorAll("footer a, footer button, .closing a, .closing button").forEach((el) => {
        const b = el.getBoundingClientRect(); if (!b.height || b.top < hb + 2 || b.top > innerHeight) return;
        const x = b.left + b.width / 2, y = b.top + b.height / 2; const top = document.elementFromPoint(x, Math.min(y, innerHeight - 1));
        if (top && !el.contains(top) && !top.contains(el)) covered.push((el.textContent || "").trim().slice(0, 30) + " under " + top.tagName.toLowerCase() + "." + String(top.className).split(" ")[0]);
      });
      const dev = document.querySelector(".dev-btn").getBoundingClientRect();
      return { shown, covered, devBottom: Math.round(innerHeight - dev.bottom), stickyTop: Math.round(r.top) };
    });
    if (st.covered.length) issue("sticky.covers-end", file, sz, st.covered.slice(0, 5).join(" | "));
    // mid page (a position where hero, closing panel and footer are all out of view): sticky visible, dev tab clear of it
    const midY = await page.evaluate(() => {
      const top = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + scrollY : Infinity; };
      const heroEnd = (() => { const e = document.querySelector("[data-hero]") || document.querySelector("main > section"); return e.getBoundingClientRect().bottom + scrollY; })();
      const end = Math.min(top("[data-closing]"), top("[data-footer]"));
      return end - heroEnd > innerHeight + 4 ? Math.round(heroEnd + 2) : -1;
    });
    if (midY >= 0) await page.evaluate((y) => window.scrollTo(0, y), midY);
    await page.waitForTimeout(450);
    const mid = await page.evaluate(() => {
      const s = document.querySelector(".sticky-cta"), d = document.querySelector(".dev-btn");
      const a = s.getBoundingClientRect(), b = d.getBoundingClientRect();
      const shown = s.classList.contains("is-shown");
      const overlap = shown && !(b.bottom <= a.top || b.top >= a.bottom || b.right <= a.left || b.left >= a.right);
      return { shown, overlap };
    });
    if (mid.overlap) issue("sticky.dev-overlap", file, sz, "dev button overlaps sticky bar");
    if (/^(signup|login)\.html$/.test(file)) { if (mid.shown || st.shown) issue("sticky.on-auth-page", file, sz, "sticky bar shown"); }
    else if (midY >= 0 && !mid.shown) issue("sticky.not-shown-mid", file, sz, `sticky bar hidden at y=${midY}`);
    else if (midY < 0) bump("info.sticky-no-mid-zone");
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(450);
    if (await page.evaluate(() => document.querySelector(".sticky-cta").classList.contains("is-shown"))) issue("sticky.shown-over-hero", file, sz, "");
  }
  // contrast (after reveals settle)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const con = await page.evaluate(contrastFn);
  bump("checks.contrast-texts", con.checked);
  if (con.out.length) issue("a11y.contrast", file, sz, con.out.join(" | "));
  if (w < 761) {
    const small = await page.evaluate(targetsFn);
    bump("checks.touch-targets");
    if (small.length) issue("a11y.touch-target", file, sz, small.slice(0, 8).join(" | ") + (small.length > 8 ? ` (+${small.length - 8})` : ""));
  }
  if (!opt("no-shots") && (w === 390 || w === 1366)) {
    await page.addStyleTag({ content: ".sticky-cta,.kamran-float,.dev-btn,.consent{visibility:hidden!important}" });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(SHOTS, `${file.replace(/\.html$/, "")}-${w}.png`), fullPage: true });
  }
  await page.addStyleTag({ content: ".sticky-cta,.kamran-float,.dev-btn,.consent{visibility:visible!important}" });
  // interactions
  if (w === 390) await mobileMenu(page, file, sz);
  if (["index.html", "pricing.html", "follower-calculator.html", "earnings-calculator.html"].includes(file)) await calculators(page, file, sz);
  if (w === 1366) { await dropdown(page, file, sz); await devPanel(page, file, sz); await forms(page, file, sz); }
  bump("checks.errors");
  if (log.errors.length) issue("console.error", file, sz, [...new Set(log.errors)].slice(0, 4).join(" | "));
  if (log.failed.length) issue("network.failed", file, sz, [...new Set(log.failed)].slice(0, 4).join(" | "));
  if (log.external.length) issue("network.external", file, sz, [...new Set(log.external)].slice(0, 4).join(" | "));
  await ctx.close();
}

async function mobileMenu(page, file, sz) {
  bump("checks.mobile-menu");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  const btn = page.locator(".menu-btn");
  if (!(await btn.isVisible())) return issue("menu.button-hidden", file, sz, "");
  await btn.click();
  await page.waitForTimeout(450);
  const open = await page.evaluate(() => {
    const s = document.querySelector("#menu-sheet"), r = s.getBoundingClientRect();
    return { hidden: s.hidden, h: Math.round(r.height), op: getComputedStyle(s).opacity, exp: document.querySelector(".menu-btn").getAttribute("aria-expanded"), focusIn: s.contains(document.activeElement), sw: document.documentElement.scrollWidth, iw: innerWidth };
  });
  if (open.hidden || open.h < 100 || open.op < 0.9 || open.exp !== "true" || !open.focusIn) issue("menu.open", file, sz, JSON.stringify(open));
  if (open.sw > open.iw) issue("menu.overflow", file, sz, `${open.sw}/${open.iw}`);
  if (!opt("no-shots") && file === "index.html") await page.screenshot({ path: join(SHOTS, `x-menu-open-390.png`) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(450);
  const closed = await page.evaluate(() => ({ hidden: document.querySelector("#menu-sheet").hidden, vis: getComputedStyle(document.querySelector("#menu-sheet")).visibility, exp: document.querySelector(".menu-btn").getAttribute("aria-expanded"), focus: document.activeElement === document.querySelector(".menu-btn") }));
  if (!(closed.hidden || closed.vis === "hidden") || closed.exp !== "false" || !closed.focus) issue("menu.close-escape", file, sz, JSON.stringify(closed));
  // toggle close by the button too
  await btn.click(); await page.waitForTimeout(350); await btn.click(); await page.waitForTimeout(450);
  const closed2 = await page.evaluate(() => ({ hidden: document.querySelector("#menu-sheet").hidden, exp: document.querySelector(".menu-btn").getAttribute("aria-expanded") }));
  if (!closed2.hidden || closed2.exp !== "false") issue("menu.close-button", file, sz, JSON.stringify(closed2));
}

async function dropdown(page, file, sz) {
  bump("checks.dropdown");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.focus(".nav-drop-btn");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  const o = await page.evaluate(() => ({ hidden: document.querySelector("#nav-drop").hidden, exp: document.querySelector(".nav-drop-btn").getAttribute("aria-expanded"), focusIn: document.querySelector("#nav-drop").contains(document.activeElement), links: document.querySelectorAll("#nav-drop a").length }));
  if (o.hidden || o.exp !== "true" || !o.focusIn || o.links !== 6) issue("dropdown.open", file, sz, JSON.stringify(o));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const c = await page.evaluate(() => ({ hidden: document.querySelector("#nav-drop").hidden, exp: document.querySelector(".nav-drop-btn").getAttribute("aria-expanded"), focus: document.activeElement === document.querySelector(".nav-drop-btn") }));
  if (!c.hidden || c.exp !== "false" || !c.focus) issue("dropdown.close", file, sz, JSON.stringify(c));
}

async function devPanel(page, file, sz) {
  bump("checks.dev-panel");
  await page.click(".dev-btn");
  await page.waitForTimeout(350);
  const base = await page.evaluate(() => ({ open: !document.querySelector("#devpanel").hidden, links: document.querySelectorAll(".dev-pages a").length, gallery: document.querySelector(".dev-gallery")?.getAttribute("href"), switches: [...document.querySelectorAll(".dev-switch")].map((s) => s.dataset.flag) }));
  if (!base.open || base.links !== 42 || base.gallery !== "../" || base.switches.join() !== "payments,publish,registration,frontier,voice,motion") issue("dev.panel", file, sz, JSON.stringify(base));
  const check = () => page.evaluate(() => {
    const bad = [];
    const flags = {}; ["payments", "publish", "registration", "frontier", "voice"].forEach((k) => (flags[k] = document.documentElement.getAttribute("data-" + k)));
    document.querySelectorAll("[data-show]").forEach((el) => {
      const [k, v] = el.getAttribute("data-show").split(":"); if (!(k in flags)) return;
      const shown = getComputedStyle(el).display !== "none";
      if ((flags[k] === v) !== shown && !(flags[k] === v && el.parentElement.closest("[data-show]") && getComputedStyle(el.parentElement.closest("[data-show]")).display === "none") && !(flags[k] === v && el.closest("[hidden]"))) bad.push(el.getAttribute("data-show") + " " + el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0] + (shown ? " shown" : " hidden"));
    });
    const ctas = [...document.querySelectorAll('a[data-cta="primary"]')].map((a) => { const vis = [...a.querySelectorAll("[data-show]")].find((s) => s.offsetParent !== null || getComputedStyle(s).display !== "none"); return { label: (vis || a).textContent.replace(/\s+/g, " ").trim(), href: a.getAttribute("href") }; });
    return { flags, bad: bad.slice(0, 6), ctas };
  });
  const s0 = await check();
  if (s0.bad.length) issue("flags.default-state", file, sz, s0.bad.join(" | "));
  const wrongCta = s0.ctas.filter((c) => c.label !== "Teach your AI — free" || !/^signup\.html(\?[^#]*)?$/.test(c.href));
  if (wrongCta.length) issue("cta.label", file, sz, JSON.stringify(wrongCta.slice(0, 3)));
  for (const flag of ["payments", "publish", "registration", "frontier", "voice"]) {
    await page.click(`.dev-switch[data-flag="${flag}"]`);
    await page.waitForTimeout(120);
    const s = await check();
    const aria = await page.getAttribute(`.dev-switch[data-flag="${flag}"]`, "aria-checked");
    const expectOn = flag === "registration" ? "closed" : "on";
    if (s.flags[flag] !== expectOn || aria !== (flag === "registration" ? "false" : "true")) issue("dev.toggle", file, sz, `${flag}: ${s.flags[flag]} aria ${aria}`);
    if (s.bad.length) issue("flags.toggle-state", file, sz, `${flag}: ` + s.bad.join(" | "));
    if (flag === "registration") {
      const wrong = s.ctas.filter((c) => c.label !== "Join early access — free" || !/^get-started\.html(\?[^#]*)?#early-access$/.test(c.href));
      if (wrong.length) issue("cta.closed-label", file, sz, JSON.stringify(wrong.slice(0, 3)));
    }
    await page.click(`.dev-switch[data-flag="${flag}"]`);
    await page.waitForTimeout(80);
  }
  const s1 = await check();
  if (JSON.stringify(s1.flags) !== JSON.stringify(s0.flags)) issue("dev.restore", file, sz, JSON.stringify(s1.flags));
  await page.click("[data-replay-hero]");
  await page.waitForTimeout(300);
  await page.click("[data-dev-close]");
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => document.querySelector("#devpanel").hidden);
  if (!closed) issue("dev.close", file, sz, "panel still open");
}

async function forms(page, file, sz) {
  const n = await page.evaluate(() => document.querySelectorAll("main form:not([data-address])").length);
  if (!n) return;
  bump("checks.forms", n);
  const before = page.url();
  const res = await page.evaluate(async () => {
    const out = [];
    for (const f of document.querySelectorAll("main form:not([data-address])")) {
      const hasSubmit = !!f.querySelector('button:not([type]),button[type=submit],input[type=submit]');
      f.querySelectorAll("input,textarea,select").forEach((i) => {
        if (i.type === "checkbox" || i.type === "radio") { if (i.required) i.checked = true; return; }
        if (i.tagName === "SELECT") return;
        if (i.value) return;
        i.value = i.type === "email" ? "layla@example.com" : i.type === "number" ? (i.min || "1") : i.type === "password" ? "correct-horse-9" : i.type === "url" ? "https://example.com" : "Layla Strength";
        i.dispatchEvent(new Event("input", { bubbles: true }));
      });
      let muts = 0; const mo = new MutationObserver((l) => (muts += l.length)); mo.observe(document.querySelector("main"), { subtree: true, childList: true, attributes: true, characterData: true });
      try { f.requestSubmit(); } catch (e) { out.push("submit threw " + e); }
      await new Promise((r) => setTimeout(r, 400)); mo.disconnect();
      out.push({ id: f.id || f.className, hasSubmit, valid: f.checkValidity(), changed: muts > 0 });
    }
    return out;
  });
  await page.waitForTimeout(300);
  if (page.url() !== before) issue("form.navigates", file, sz, page.url());
  for (const r of res) if (typeof r === "string" || (!r.changed && r.valid && r.hasSubmit)) issue("form.no-result", file, sz, JSON.stringify(r));
}

async function calculators(page, file, sz) {
  bump("checks.calculators");
  await page.evaluate(() => window.scrollTo(0, 0));
  const text = async () => page.evaluate(() => document.querySelector("main").innerText.replace(/\s+/g, " "));
  const need = (t, list, label) => { const miss = list.filter((s) => !t.includes(s)); if (miss.length) issue("calc.mismatch", file, sz, `${label}: missing ${miss.join(", ")}`); };
  const setVal = async (sel, v) => { await page.fill(sel, String(v)); await page.dispatchEvent(sel, "input"); await page.dispatchEvent(sel, "change"); await page.waitForTimeout(900); };
  const E = EXPECTED;
  const F = E.followerDefault, F2 = E.follower20000;
  if (file === "follower-calculator.html") {
    need(await text(), [F.strong.revenue, F.typical.revenue, F.cautious.revenue], "defaults revenue");
    const t2 = await page.evaluate(() => [...document.querySelectorAll("main [role=row], main tr")].map((r) => [...r.children].map((c) => c.textContent.replace(/\s+/g, " ").trim()).join(" ")).join(" | "));
    const lt = (v) => (v === "fewer than 1" ? "< 1" : v);
    const rows = { "New in your first month": "month1New", "Active after 12 months": "active12", "Sign-ups over 12 months": "signups12", "A month at month 12": "revenue" };
    for (const [label, key] of Object.entries(rows)) {
      const want = `${label} ${lt(F.cautious[key])} ${lt(F.typical[key])} ${lt(F.strong[key])}`;
      if (!t2.includes(want)) issue("calc.table", file, sz, `want '${want}'`); else bump("checks.calc-rows-matched");
    }
    await setVal("#mf-followers", 20000);
    need(await text(), [F2.strong.revenue, F2.typical.revenue], "followers 20000");
    const live = await page.evaluate(() => [...document.querySelectorAll("[aria-live]")].map((e) => e.textContent.trim()).join(" | "));
    if (!live.includes("34,228")) issue("calc.live", file, sz, `aria-live after change: '${live.slice(0, 200)}'`);
  }
  if (file === "earnings-calculator.html") {
    const D = E.earningsDefault, D2 = E.earnings250;
    need(await text(), [D.keep, D.subs, D.commission], "defaults");
    await setVal("#me-subs", 250);
    need(await text(), [D2.keep, D2.subs, D2.commission], "subscribers 250");
    const live = await page.evaluate(() => [...document.querySelectorAll("[aria-live]")].map((e) => e.textContent.trim()).join(" | "));
    if (!live.includes("44,655")) issue("calc.live", file, sz, `aria-live after change: '${live.slice(0, 200)}'`);
  }
  if (file === "pricing.html") {
    const t = await text();
    need(t, [E.compact150.commission, E.compact150.keep], "statement 150x199");
    need(t, [E.compact60.keep], "compact calculator 60x199");
    need(t, [E.compact300.commission], "band meter 300x199");
  }
  if (file === "index.html") {
    need(await text(), [F.strong.revenue, F.typical.revenue], "home follower mini defaults");
    await setVal("#fc-followers", 20000);
    need(await text(), [F2.strong.revenue], "home follower mini 20000");
  }
}

/* keyboard focus visibility (desktop): tab through the page */
async function focusPass(browser, base, file) {
  const { ctx, page, log } = await newPage(browser, 1366, 900);
  await page.goto(`${base}/${file}`, { waitUntil: "load" });
  await page.waitForTimeout(200);
  const allow = page.locator('[data-consent] [data-consent-choice="granted"]');
  if (await allow.isVisible()) await allow.click();
  await scrollThrough(page, 900);
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement && document.activeElement.blur(); });
  await page.waitForTimeout(300);
  const bad = [], invisible = [];
  let headerStops = 0;
  const seen = new Set();
  for (let i = 0; i < 260; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      const d = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "." + String(el.className).split(" ").filter(Boolean).slice(0, 2).join(".") + " '" + (el.textContent || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 24) + "'";
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      const has = (n, pseudo) => { if (!n) return false; const s = getComputedStyle(n, pseudo); return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 1) || s.boxShadow !== "none"; };
      const outline = has(el) || el.matches('input[type="range"]') /* thumb ring: site.css input[type=range]:focus-visible::-webkit-slider-thumb, checked by screenshot */ || has(el.closest("label")) || has(el.nextElementSibling) || has(el.parentElement) || has(el.parentElement && el.parentElement.parentElement);
      const ring = false;
      let op = 1; for (let n = el; n; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity);
      const hiddenAnc = !!el.closest("[aria-hidden='true'],[inert]");
      const lab = el.closest("label") || (el.id && document.querySelector('label[for="' + el.id + '"]'));
      const lr = lab && lab.getBoundingClientRect();
      const visible = (r.width > 0 && r.height > 0 && op > 0.2 && cs.visibility !== "hidden") || (lr && lr.width > 0 && lr.height > 0 && (cs.opacity === "0" || r.width <= 1));
      const fv = el.matches(":focus-visible");
      return { d, ind: outline || ring, visible, hiddenAnc, header: !!el.closest("header"), fv, key: d + Math.round(r.top + scrollY) + "," + Math.round(r.left) };
    });
    if (!f) continue;
    if (seen.has(f.key)) break;
    seen.add(f.key);
    if (f.header) headerStops++;
    if (!f.visible || f.hiddenAnc) invisible.push(f.d);
    else if (!f.ind) bad.push(f.d + (f.fv ? "" : " (no :focus-visible)"));
  }
  bump("checks.focus-stops", seen.size);
  if (headerStops < 10) issue("focus.header-stops", file, "d1366", `${headerStops} header tab stops`);
  if (bad.length) issue("focus.no-indicator", file, "d1366", bad.slice(0, 8).join(" | ") + (bad.length > 8 ? ` (+${bad.length - 8})` : ""));
  if (invisible.length) issue("focus.invisible-target", file, "d1366", invisible.slice(0, 8).join(" | ") + (invisible.length > 8 ? ` (+${invisible.length - 8})` : ""));
  if (log.errors.length) issue("console.error", file, "focus", log.errors.slice(0, 3).join(" | "));
  await ctx.close();
}

/* reduced motion: OS reduce with default "always", and with "respect" */
async function reducedPass(browser, base, file, [sz, w, h], mode) {
  const { ctx, page, log } = await newPage(browser, w, h, { reducedMotion: "reduce" });
  if (mode === "respect") await ctx.addInitScript(() => { try { localStorage.setItem("tyA.flags", JSON.stringify({ motion: "respect" })); } catch (e) {} });
  await page.goto(`${base}/${file}`, { waitUntil: "load" });
  await page.waitForTimeout(150);
  const first = await page.evaluate(firstScreenFn);
  bump("checks.reduced");
  if (first.pending.length) issue("rm.first-screen.reveal-pending", file, `${sz}/${mode}`, first.pending.join(", "));
  if (first.hidden.length) issue("rm.first-screen.hidden-text", file, `${sz}/${mode}`, first.hidden.slice(0, 5).join(" | "));
  const allow = page.locator('[data-consent] [data-consent-choice="granted"]');
  if (await allow.isVisible()) await allow.click();
  await scrollThrough(page, h);
  const left = await page.evaluate(() => document.querySelectorAll(".reveal-pending").length);
  if (left) issue("rm.reveal.never-revealed", file, `${sz}/${mode}`, `${left} units`);
  const ov = await page.evaluate(overflowFn);
  if (ov.sw > ov.iw) issue("rm.layout.h-overflow", file, `${sz}/${mode}`, `scrollWidth ${ov.sw}/${ov.iw} ${ov.wide.join(", ")}`);
  if (mode === "respect") {
    const m = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--m").trim());
    if (m !== "0") issue("rm.motion-multiplier", file, `${sz}/${mode}`, `--m=${m}`);
  }
  if (!opt("no-shots") && mode === "respect" && ["index.html", "demo.html", "pricing.html"].includes(file)) {
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `rm-${file.replace(/\.html$/, "")}-${w}.png`), fullPage: true });
  }
  if (log.errors.length) issue("rm.console.error", file, `${sz}/${mode}`, log.errors.slice(0, 3).join(" | "));
  await ctx.close();
}

async function pool(jobs, n) {
  let i = 0;
  const run = async () => { while (i < jobs.length) { const j = jobs[i++]; try { await j(); } catch (e) { issue("crawl.exception", j.label || "?", "-", String(e).slice(0, 300)); } } };
  await Promise.all(Array.from({ length: n }, run));
}

const t0 = Date.now();
mkdirSync(SHOTS, { recursive: true });
staticChecks();
const { server, port } = await serve();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const jobs = [];
for (const file of FILES) for (const size of SIZES) { const j = () => crawlOne(browser, base, file, size); j.label = `${file}@${size[0]}`; jobs.push(j); }
if (!opt("skip-tab")) for (const file of FILES) { const j = () => focusPass(browser, base, file); j.label = `${file}@focus`; jobs.push(j); }
if (!opt("skip-rm")) for (const file of FILES) for (const size of SIZES.filter((x) => x[1] === 390 || x[1] === 1366)) for (const mode of ["always", "respect"]) { const j = () => reducedPass(browser, base, file, size, mode); j.label = `${file}@${size[0]}/rm-${mode}`; jobs.push(j); }
await pool(jobs, 5);
await browser.close();
server.close();
const byCheck = {};
for (const x of issues) byCheck[x.check] = (byCheck[x.check] || 0) + 1;
writeFileSync(join(QA, widthsArg ? "report-widths.json" : "report.json"), JSON.stringify({ counts, byCheck, issues }, null, 1));
console.log(`pages ${FILES.length}, jobs ${jobs.length}, ${Math.round((Date.now() - t0) / 1000)}s`);
console.log("counts", JSON.stringify(counts));
console.log("issues by check", JSON.stringify(byCheck, null, 0));
