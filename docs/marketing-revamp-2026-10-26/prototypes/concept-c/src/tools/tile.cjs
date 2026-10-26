// node tile.cjs <png>...: phone shots -> sheets of 4 columns x 1250px; desktop -> 1366x1500 tiles (in ./tiles next to the png)
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const f of process.argv.slice(2)) {
    const abs = path.resolve(f); const dir = path.dirname(abs); const base = path.basename(abs, ".png");
    const buf = fs.readFileSync(abs); const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    const phone = w < 800, th = phone ? 1250 : 2400, cols = phone ? 4 : 1;
    const segs = Math.ceil(h / th);
    for (let k = 0; k * cols < segs; k++) {
      const n = Math.min(cols, segs - k * cols);
      let html = `<body style="margin:0;background:#888;display:flex;gap:12px;width:${cols * (w + 12)}px">`;
      for (let i = 0; i < n; i++) { const y = (k * cols + i) * th; html += `<div style="width:${w}px;height:${Math.min(th, h - y)}px;background:url('${path.basename(abs)}') 0 -${y}px no-repeat"></div>`; }
      const tmp = path.join(dir, `.tile-${process.pid}.html`); fs.writeFileSync(tmp, html + "</body>");
      await p.setViewportSize({ width: cols * (w + 12), height: th });
      await p.goto("file://" + tmp); await p.waitForTimeout(50);
      await p.screenshot({ path: path.join(dir, "tiles", `${base}-${k}.png`), fullPage: false });
      fs.unlinkSync(tmp);
    }
  }
  await b.close();
})();
