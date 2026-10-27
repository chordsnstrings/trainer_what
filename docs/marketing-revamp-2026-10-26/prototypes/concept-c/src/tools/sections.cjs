// Section-by-section screenshots for close inspection.
//   node src/tools/sections.cjs index.html 1366 [--wait=1500]
// Saves ../shots/sec-<page>-<width>-<n>.png for each main > section and the footer.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SITE = path.resolve(__dirname, "../../site"), SHOTS = path.resolve(__dirname, "../../shots");
const [file = "index.html", width = "1366"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const waitArg = process.argv.find((a) => a.startsWith("--wait="));
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = path.join(SITE, p === "/" ? "index.html" : p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise((r) => server.listen(0, r));
  const b = await chromium.launch();
  const w = Number(width);
  const page = await b.newPage({ viewport: { width: w, height: w < 800 ? 844 : 900 } });
  await page.addInitScript(() => { try { localStorage.setItem("ty-c-consent", "denied"); } catch (e) {} });
  await page.goto(`http://127.0.0.1:${server.address().port}/${file}`, { waitUntil: "load" });
  await page.waitForTimeout(waitArg ? Number(waitArg.split("=")[1]) : 1200);
  const secs = await page.$$("main > section, footer.site-footer");
  const pending = [];
  for (let i = 0; i < secs.length; i++) {
    await secs[i].scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    pending.push(...(await page.$$eval(".reveal-pending", (els) => els.map((e) => e.className + " @" + Math.round(e.getBoundingClientRect().top)))));
    await secs[i].screenshot({ path: path.join(SHOTS, `sec-${file.replace(".html", "")}-${w}-${i}.png`) });
  }
  console.log(secs.length + " sections; pending after visit:", [...new Set(pending)].slice(0, 10));
  await b.close(); server.close();
})();
