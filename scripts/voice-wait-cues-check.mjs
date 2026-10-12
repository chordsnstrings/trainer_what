import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
const base = process.env.TEST_APP_URL;
if (
  !base ||
  !["localhost", "127.0.0.1"].includes(new URL(base).hostname) ||
  process.env.VOICE_WAIT_CUE_FIXTURE !== "true" ||
  process.env.NODE_ENV === "production"
)
  throw Error("Use the isolated slow-voice fixture");
const folder = "test-results/voice-wait-cues";
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--use-file-for-fake-audio-capture=" +
      process.env.ONBOARDING_MICROPHONE_FIXTURE,
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
      window.__voiceAudio = [];
      const start = AudioBufferSourceNode.prototype.start,
        stop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.__voiceAudio.push({
          type: "start",
          at: performance.now(),
          duration: this.buffer?.duration,
        });
        return start.apply(this, args);
      };
      AudioBufferSourceNode.prototype.stop = function (...args) {
        window.__voiceAudio.push({
          type: "stop",
          at: performance.now(),
          immediate: args.length === 0,
          duration: this.buffer?.duration,
        });
        return stop.apply(this, args);
      };
    });
    const login = await context.request.post(base + "/api/v1/auth/login", {
      headers: { origin: base },
      data: { email: "coach@example.test", password: "TrainerDemo2026!" },
    });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(e.message));
    const spoken = [];
    page.on("request", (req) => {
      if (/\/calls\/[^/]+\/turns$/.test(req.url()) && req.method() === "POST") {
        const body = req.postDataJSON();
        if (body.audio) spoken.push({ id: body.id, at: Date.now() });
      }
    });
    await page.goto(base + "/trainer/brain");
    await page
      .getByRole("button", { name: "No thanks", exact: true })
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
    await page
      .getByRole("button", { name: "Start voice conversation", exact: true })
      .click();
    await page
      .getByLabel("I allow my speech to be processed for this AI call.")
      .check();
    await page.getByRole("button", { name: "Start call", exact: true }).click();
    await expect.poll(() => spoken.length, { timeout: 12000 }).toBe(1);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__voiceAudio.filter(
                (x) => x.type === "start" && x.duration > 3,
              ).length,
          ),
        { timeout: 10000 },
      )
      .toBeGreaterThanOrEqual(1);
    // The second spoken input interrupts a currently playing cue and is retained
    // while the same first model request finishes. It must not race CALL_BUSY.
    await expect(
      page.getByText("I've kept your addition. One moment.", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    assert.equal(spoken.length, 1);
    const earlyStops = await page.evaluate(() =>
      window.__voiceAudio.filter(
        (x) => x.type === "stop" && x.immediate && x.duration > 3,
      ),
    );
    assert.ok(earlyStops.length > 0, "Caller speech preempts a waiting cue");
    await expect.poll(() => spoken.length, { timeout: 15000 }).toBe(2);
    assert.equal(
      new Set(spoken.map((x) => x.id)).size,
      2,
      "One durable request for each spoken input",
    );
    const audio = await page.evaluate(() => window.__voiceAudio);
    assert.equal(
      audio.filter((x) => x.type === "start" && x.duration < 1).length <= 1,
      true,
      "Superseded answer is not spoken over the addition",
    );
    await page.screenshot({
      path: `${folder}/waiting-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
    await page
      .getByRole("button", { name: "Mute microphone", exact: true })
      .click();
    await expect(page.locator("[data-voice-cue]")).toHaveAttribute(
      "data-voice-cue",
      "false",
    );
    await page.getByRole("button", { name: "End call", exact: true }).click();
    const count = await page.evaluate(
      () => window.__voiceAudio.filter((x) => x.type === "start").length,
    );
    await page.waitForTimeout(2500);
    assert.equal(
      await page.evaluate(
        () => window.__voiceAudio.filter((x) => x.type === "start").length,
      ),
      count,
    );
    report.checks.push(
      `${width}px: delayed cues, speech interruption, preserved addition, serial turns, mute/hangup and no late playback`,
    );
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log("PASS voice waits: " + report.checks.join("; "));
} finally {
  await writeFile(folder + "/report.json", JSON.stringify(report, null, 2));
  await browser.close();
}
