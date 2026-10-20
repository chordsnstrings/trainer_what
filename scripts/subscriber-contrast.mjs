import assert from "node:assert/strict";
/** Inspect rendered text and its actual ancestor backgrounds, including glyph fill. */
export async function checkSubscriberContrast(page) {
  const result = await page.locator(".member-shell").evaluate((root) => {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.canvas.width = ctx.canvas.height = 1;
    const rgba = (value) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].map((n, i) =>
        i === 3 ? n / 255 : n,
      );
    };
    const over = (a, b) =>
      [0, 1, 2].map((i) => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
    const lum = (c) =>
      c
        .slice(0, 3)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((v, n, i) => v + n * [0.2126, 0.7152, 0.0722][i], 0);
    const failures = [];
    let min = 21,
      count = 0;
    for (const el of root.querySelectorAll("*")) {
      if (
        ![...el.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent.trim(),
        ) ||
        el.closest('svg,[hidden],.sr-only,[aria-hidden="true"]') ||
        el.matches(":disabled") ||
        !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      )
        continue;
      const cs = getComputedStyle(el);
      if (parseFloat(cs.fontSize) < 1) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      let bg = [255, 255, 255, 1],
        chain = [];
      for (let x = el; x; x = x.parentElement) chain.push(x);
      for (const x of chain.reverse())
        bg = over(rgba(getComputedStyle(x).backgroundColor), bg);
      const fg = over(rgba(cs.webkitTextFillColor || cs.color), bg);
      const a = lum(fg),
        b = lum(bg),
        ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large =
        parseFloat(cs.fontSize) >= 24 ||
        (parseFloat(cs.fontSize) >= 18.67 && parseInt(cs.fontWeight) >= 700);
      count++;
      min = Math.min(min, ratio);
      if (ratio + 0.01 < (large ? 3 : 4.5))
        failures.push({
          text: el.textContent.trim().slice(0, 75),
          ratio: Math.round(ratio * 100) / 100,
          fg: cs.color,
          bg,
        });
    }
    return { count, min: Math.round(min * 100) / 100, failures };
  });
  assert.deepEqual(result.failures, [], JSON.stringify(result.failures));
  return result;
}
