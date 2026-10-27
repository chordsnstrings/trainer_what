// Captures each concept's home hero for the gallery cards. Usage: node thumbs.cjs a b c
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(4477);
(async () => {
  const browser = await chromium.launch();
  for (const k of process.argv.slice(2)) {
    for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'phone' ? 2 : 1 });
      const errors = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(`http://localhost:4477/concept-${k}/site/index.html`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      // Close a consent bar if the concept shows one, so the hero is unobstructed.
      for (const name of ['Decline', 'Accept', 'Reject', 'No thanks']) {
        const b = page.getByRole('button', { name, exact: true });
        if (await b.count() && await b.first().isVisible()) { await b.first().click(); break; }
      }
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${ROOT}/gallery/thumbs/concept-${k}-${tag}.png` });
      console.log(k, tag, 'errors:', errors.length, errors.slice(0, 2));
      await page.close();
    }
  }
  await browser.close();
  server.close();
})();
