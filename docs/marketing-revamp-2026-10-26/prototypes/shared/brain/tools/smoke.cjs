const { chromium } = require("playwright");
const serve = require("./serve.cjs");
const OUT = process.argv[2];
const srv = serve(require("path").join(__dirname, ".."), 4590);
(async () => {
  const b = await chromium.launch();
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = []; p.on("console", (m) => m.type() === "error" && errs.push(m.text())); p.on("pageerror", (e) => errs.push("PAGEERR " + e.message));
    await p.goto("http://localhost:4590/demo.html");
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/smoke-${w}-static.png` });
    await p.locator("#play").scrollIntoViewIfNeeded();
    await p.waitForFunction(() => document.querySelector("#play .bp-cv"), null, { timeout: 8000 }).catch(() => errs.push("no mount"));
    await p.waitForTimeout(500);
    await p.click('#play .bp-chip[data-t="t2"]');
    await p.waitForTimeout(700);
    await p.locator("#play .bp-stage").screenshot({ path: `${OUT}/smoke-${w}-t2-mid.png` });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${OUT}/smoke-${w}-t2.png`, fullPage: false });
    await p.click('#play .bp-chip[data-t="t1"]');
    await p.waitForTimeout(2000);
    await p.locator("#play .bp-stage").screenshot({ path: `${OUT}/smoke-${w}-t1-mid.png` });
    await p.waitForTimeout(3500);
    await p.locator("#play").screenshot({ path: `${OUT}/smoke-${w}-t1.png` });
    console.log(w, "errors", errs);
    await p.close();
  }
  await b.close(); srv.close();
})();
