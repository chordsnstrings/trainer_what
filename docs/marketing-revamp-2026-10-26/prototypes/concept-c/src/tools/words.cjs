// Visible word count in <main> (home budget check, section C1).
//   node src/tools/words.cjs [index.html]
// Reports: total; excluding the follower calculator block ([data-calc-block]),
// closed FAQ answers, product UI inside frames (rule card, phone, window, mini
// figures) and the stepper's chapter rail; per-section breakdown.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.resolve(__dirname, "../../site");
const file = process.argv[2] || "index.html";
const server = http.createServer((q, r) => { const f = path.join(SITE, new URL(q.url, "http://x").pathname); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { "content-type": { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" }[path.extname(f)] || "x" }); fs.createReadStream(f).pipe(r); });
(async () => {
  await new Promise((r) => server.listen(0, r));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  await p.goto(`http://127.0.0.1:${server.address().port}/${file}`); await p.waitForTimeout(300);
  const out = await p.evaluate(() => {
    const count = (t) => (t.replace(/[—–→·×∴%]/g, " ").match(/[A-Za-z0-9][A-Za-z0-9’'.,:;!?()-]*/g) || []).length;
    const EXCL = "[data-calc-block], .faq-a, .rule-card, .phone, .window, .mini, .stepper-tabs, .stepper-count, .sr-only, template";
    const text = (el, excl) => { const c = el.cloneNode(true); if (excl) c.querySelectorAll(EXCL).forEach((x) => x.remove()); document.body.appendChild(c); c.style.position = "absolute"; c.style.left = "-99999px"; const t = c.innerText; c.remove(); return t; };
    const main = document.querySelector("main");
    const rows = [...main.children].map((s) => [s.id || s.className.split(" ")[0], s.matches("[data-calc-block]") ? 0 : count(text(s, true)), count(text(s, false))]);
    return { total: count(main.innerText), budgeted: rows.reduce((a, r) => a + r[1], 0), rows };
  });
  console.log(`${file}: all visible words ${out.total}; budgeted (excl. calculator, closed answers, product UI, chapter rail) ${out.budgeted}`);
  out.rows.forEach((r) => console.log(`  ${String(r[0]).padEnd(14)} ${String(r[1]).padStart(4)}  (all ${r[2]})`));
  await b.close(); server.close();
})();
