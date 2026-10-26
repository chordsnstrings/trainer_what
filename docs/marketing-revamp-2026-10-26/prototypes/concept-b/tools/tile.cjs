// Slice full-page screenshots into readable tiles (cols segments side by side).
// usage: node tools/tile.cjs <segH> <cols> file.png [...]  -> shots/qa/seg/<name>-tN.png
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const SCALE = +(process.env.SCALE || 1);
const [segH, cols, ...files] = [+process.argv[2], +process.argv[3], ...process.argv.slice(4)];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const f of files) {
    const buf = fs.readFileSync(f), W = buf.readUInt32BE(16), H = buf.readUInt32BE(20);
    const outDir = path.join(path.dirname(f), "seg"); fs.mkdirSync(outDir, { recursive: true });
    const src = "data:image/png;base64," + buf.toString("base64");
    const n = Math.ceil(H / segH), out = [];
    for (let t = 0; t * cols < n; t++) {
      const cells = [];
      for (let j = 0; j < cols && t * cols + j < n; j++) { const y = (t * cols + j) * segH; cells.push(`<div style="position:absolute;left:${j * (W + 12)}px;top:0;width:${W}px;height:${Math.min(segH, H - y)}px;overflow:hidden"><img src="${src}" style="position:absolute;left:0;top:${-y}px"></div>`); }
      await page.setViewportSize({ width: Math.ceil((cols * W + (cols - 1) * 12) * SCALE), height: Math.ceil(segH * SCALE) });
      await page.setContent(`<body style="margin:0;background:#f0f;position:relative;zoom:${SCALE}">${cells.join("")}</body>`);
      await page.waitForTimeout(50);
      const name = path.join(outDir, path.basename(f).replace(".png", `-t${t}.png`));
      await page.screenshot({ path: name }); out.push(name);
    }
    console.log(out.join("\n"));
  }
  await browser.close();
})();
