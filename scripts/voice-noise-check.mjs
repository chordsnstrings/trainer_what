import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, extname } from "node:path";
import { pcmFixture, wavBytes } from "./voice-audio-fixtures.mjs";

const root = resolve("test-results/voice-noise");
await mkdir(root, { recursive: true });
await build({
  entryPoints: [
    "scripts/voice-noise-benchmark-entry.ts",
    "scripts/voice-tap-benchmark-entry.ts",
  ],
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  outdir: root + "/bundle",
});
const rate = 48000,
  duration = 12;
const clean = () =>
  pcmFixture(duration, [
    { at: 3, text: "Show me how your pricing works." },
    { at: 8, text: "I would like to start a call." },
  ]);
const noise = new Float32Array(rate * duration);
let seed = 42,
  smooth = 0;
for (let i = 0; i < noise.length; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const random = (seed / 0xffffffff) * 2 - 1;
  smooth = 0.94 * smooth + 0.06 * random;
  noise[i] = random * 0.025 + smooth * 0.15;
}
const cases = {
  silence: new Float32Array(noise.length),
  fan: noise,
  clatter: Float32Array.from(
    noise,
    (n, i) =>
      n * 0.4 +
      (i % rate < 4800
        ? Math.sin(i * 2.12) * 0.16 * Math.exp(-(i % rate) / 650)
        : 0),
  ),
  music: Float32Array.from(
    noise,
    (n, i) =>
      [380, 620, 890, 1270, 1780, 2430].reduce(
        (s, hz) => s + Math.sin((2 * Math.PI * hz * i) / rate) * 0.035,
        0,
      ) * (i % (rate * 5) < rate * 3 ? 1 : 0),
  ),
  speech: clean(),
  quiet_speech: Float32Array.from(clean(), (n) => n * 0.22),
  noisy_speech: Float32Array.from(clean(), (n, i) => n + noise[i] * 1.5),
};
for (const [name, pcm] of Object.entries(cases))
  await writeFile(root + `/${name}.wav`, wavBytes(pcm));
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/" || path === "/tap") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        `<script type="module" src="/bundle/voice-${path === "/tap" ? "tap" : "noise"}-benchmark-entry.js"></script>`,
      );
      return;
    }
    if (path.includes("..")) {
      res.writeHead(400);
      res.end();
      return;
    }
    const file = path.startsWith("/bundle/")
      ? root + path
      : resolve("apps/web/public") + path;
    res.setHeader(
      "Content-Type",
      {
        ".wasm": "application/wasm",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
      }[extname(file)] ?? "application/octet-stream",
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const report = {};
try {
  for (const name of Object.keys(cases)) {
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--use-file-for-fake-audio-capture=" + root + `/${name}.wav`,
      ],
    });
    try {
      const page = await browser.newPage({ permissions: ["microphone"] });
      page.on("pageerror", (error) => console.error(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(
        () => typeof window.runNoiseCheck === "function",
      );
      report[name] = await page.evaluate(() => window.runNoiseCheck());
      console.log(name, JSON.stringify(report[name]));
      assert.deepEqual(report[name].errors, []);
      assert.equal(report[name].denoised.filter, "neural");
      if (["fan", "clatter"].includes(name)) {
        assert.ok(
          report[name].denoised.rms < report[name].silero.rms * 0.5,
          `${name}: extra filter attenuates noise by at least 6 dB`,
        );
      }
      for (const model of ["silero", "denoised"]) {
        assert.ok(
          report[name][model].samples >= (rate / 3) * 9,
          `${name}: inference keeps up with capture`,
        );
        if (["silence", "fan", "clatter", "music"].includes(name)) {
          assert.equal(
            report[name][model].turns,
            0,
            `${name}: no false upload with ${model}`,
          );
          assert.equal(
            report[name][model].interrupts,
            0,
            `${name}: no false interruption with ${model}`,
          );
        } else
          assert.ok(
            report[name][model].turns >= 1,
            `${name}: speech remains usable with ${model}`,
          );
      }
      if (["fan", "speech"].includes(name)) {
        await page.goto(`http://127.0.0.1:${server.address().port}/tap`);
        await page.getByRole("button", { name: "Talk" }).click();
        await page.waitForFunction(
          () => document.querySelector("button")?.dataset.phase === "recording",
        );
        await page.waitForFunction(
          () => document.querySelector("button")?.dataset.phase === "idle",
          undefined,
          { timeout: 10000 },
        );
        const tap = await page.evaluate(() => ({
          recordings: window.tapReport.recordings,
          errors: window.tapReport.errors,
          stopped: window.tapReport.streams.every((stream) =>
            stream.getTracks().every((track) => track.readyState === "ended"),
          ),
        }));
        assert.equal(tap.errors, 0);
        assert.equal(tap.stopped, true);
        assert.equal(tap.recordings.length, name === "speech" ? 1 : 0);
        if (name === "speech") {
          assert.equal(tap.recordings[0].rate, 16000);
          assert.equal(tap.recordings[0].channels, 1);
          assert.equal(tap.recordings[0].type, "audio/wav");
          assert.equal(tap.recordings[0].current, true);
          assert.ok(
            tap.recordings[0].durationMs > 500 &&
              tap.recordings[0].durationMs <= 6000,
          );
        }
        report[name].tap = tap;
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await writeFile(root + "/report.json", JSON.stringify(report, null, 2));
  await new Promise((resolve) => server.close(resolve));
}
