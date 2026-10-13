import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
if (
  !base ||
  !["localhost", "127.0.0.1"].includes(new URL(base).hostname) ||
  process.env.MARKETING_CALL_FIXTURE !== "true" ||
  process.env.NODE_ENV === "production"
)
  throw Error("Use the isolated marketing call fixture");
const folder = "test-results/marketing-call";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--use-file-for-fake-audio-capture=" +
      process.env.MARKETING_MICROPHONE_FIXTURE,
  ],
});
const report = { checks: [], errors: [] };
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      permissions: ["microphone"],
      serviceWorkers: "block",
    });
    await context.addInitScript(() => {
      localStorage.setItem("analytics-preference", "declined");
      window.__callDocument = crypto.randomUUID();
      window.__callAudio = [];
      window.__callStreams = [];
      const get = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await get(...args);
        window.__callStreams.push(stream);
        return stream;
      };
      for (const method of ["start", "stop"]) {
        const original = AudioBufferSourceNode.prototype[method];
        AudioBufferSourceNode.prototype[method] = function (...args) {
          window.__callAudio.push({
            method,
            duration: this.buffer?.duration,
            immediate: args.length === 0,
            at: performance.now(),
          });
          return original.apply(this, args);
        };
      }
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(e.message));
    const sent = [],
      replies = [];
    page.on("request", (req) => {
      if (req.url().endsWith("/assistant/turn") && req.method() === "POST")
        sent.push({ ...req.postDataJSON(), at: Date.now() });
    });
    page.on("response", (res) => {
      if (res.url().endsWith("/assistant/turn"))
        replies.push({ at: Date.now(), status: res.status() });
    });
    await page.goto(base);
    const doc = await page.evaluate(() => window.__callDocument);
    await page
      .getByRole("button", { name: "Talk to Kamran (AI voice)", exact: true })
      .click();
    const panel = page.getByRole("dialog");
    if (width === 1280)
      await panel.getByLabel("Show relevant pages as we talk").uncheck();
    await panel
      .getByRole("button", { name: "Start call", exact: true })
      .click();
    await expect.poll(() => sent.length, { timeout: 12000 }).toBe(1);
    assert.equal(sent[0].currentPage, "home");
    assert.equal(sent[0].type, "audio/wav");
    assert.ok(sent[0].durationMs <= 20000);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__callAudio.filter(
                (x) => x.method === "start" && x.duration > 3 && x.duration < 4,
              ).length,
          ),
        { timeout: 10000 },
      )
      .toBeGreaterThanOrEqual(1);
    // Real Next navigation during the pending call must keep microphone and document alive.
    await page.locator('.mk-footer a[href="/about"]').first().click();
    await expect(page).toHaveURL(base + "/about");
    await panel
      .getByRole("button", { name: "Minimize call", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "End call", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText("I've heard your addition. One moment.", { exact: true }),
    ).toBeVisible({ timeout: 16000 });
    assert.equal(
      sent.length,
      1,
      "addition waits for the outstanding paid turn",
    );
    assert.ok(await page.evaluate(() => window.__callAudio.some(x => x.method === "stop" && x.immediate && x.duration > 3 && x.duration < 4)), "speech interrupts a waiting cue");
    await panel
      .getByRole("button", { name: "Expand call", exact: true })
      .click();
    await expect.poll(() => sent.length, { timeout: 15000 }).toBe(2);
    await expect(panel).toHaveAttribute("data-phase", "speaking", {
      timeout: 5000,
    });
    assert.ok(sent[1].at >= replies[0].at, "turns are serial");
    assert.equal(sent[1].visit, sent[0].visit);
    assert.equal(sent[1].currentPage, "about");
    assert.equal(sent[1].history.length, 2);
    if (width === 390) await expect(page).toHaveURL(base + "/pricing");
    else {
      await expect(page).toHaveURL(base + "/about");
      await panel.getByLabel("Show relevant pages as we talk").check();
    }
    assert.equal(await page.evaluate(() => window.__callDocument), doc);
    assert.equal(
      await page.evaluate(() => window.__callStreams.length),
      1,
      "navigation reuses microphone and audio context",
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert.equal(overflow, false);
    await page.screenshot({ path: `${folder}/call-${width}.png` });
    // The third utterance interrupts the actual answer, not only a waiting cue.
    await expect.poll(() => sent.length, { timeout: 16000 }).toBe(3);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__callAudio.filter(
              (x) => x.method === "stop" && x.immediate && x.duration > 9,
            ).length,
        ),
      )
      .toBeGreaterThanOrEqual(1);
    await expect(page).toHaveURL(base + (width === 390 ? "/faq" : "/pricing"));
    await panel
      .getByRole("button", { name: "Mute microphone", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () => window.__callStreams[0].getAudioTracks()[0].enabled,
      ),
      false,
    );
    await panel.getByRole("button", { name: "End call", exact: true }).click();
    await expect(panel).toHaveAttribute("data-phase", "ended");
    assert.equal(
      await page.evaluate(
        () => window.__callStreams[0].getAudioTracks()[0].readyState,
      ),
      "ended",
    );
    const starts = await page.evaluate(
      () => window.__callAudio.filter((x) => x.method === "start").length,
    );
    await page.waitForTimeout(2000);
    assert.equal(
      await page.evaluate(
        () => window.__callAudio.filter((x) => x.method === "start").length,
      ),
      starts,
      "no late audio after hangup",
    );
    assert.equal(sent.length, 3);
    assert.ok(replies.every((r) => r.status === 200));
    // A microphone permission response arriving after End must release its tracks.
    await panel
      .getByRole("button", { name: "Close and end call", exact: true })
      .click();
    await page.locator('.mk-header a[href="/"]').first().click();
    await page
      .getByRole("button", { name: "Talk to Kamran (AI voice)", exact: true })
      .click();
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await original(...args);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return stream;
      };
    });
    await panel
      .getByRole("button", { name: "Start call", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.__callStreams.length))
      .toBe(2);
    await panel.getByRole("button", { name: "End call", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__callStreams[1].getAudioTracks()[0].readyState,
        ),
      )
      .toBe("ended");
    assert.equal(sent.length, 3, "late permission cannot start a turn");
    report.checks.push({
      width,
      automaticTurns: sent.length,
      documentPreserved: true,
      cueInterrupted: true,
      answerInterrupted: true,
      microphoneStopped: true,
    });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} finally {
  await writeFile(`${folder}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
