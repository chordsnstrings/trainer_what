// Runs scripts/marketing-motion-check.mjs against the production web build
// (`npm run build` first) with local Chromium. The marketing pages read one
// API route, GET /api/v1/public/platform; a stub answers it here, so no
// database, provider or credential is involved. The stub starts "closed"
// (it answers 503, so the pages use their built-in platform: every provider
// off, the journey's launch gate closed) and the check switches it to
// "ready" (registration open; model, payments and payouts available) through
// globalThis.__motionPlatform. The web server keeps a successful answer for
// a minute, so the closed checks run first.
//
// MOTION_WEB_PORT / MOTION_API_PORT choose the ports (defaults 3967/4967);
// MOTION_CHECK_MODULE runs another module against the same servers.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { DEFAULT_FOLLOWER_MODEL } from "../packages/domain/src/marketing-calculators.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const webPort = process.env.MOTION_WEB_PORT ?? "3967",
  apiPort = process.env.MOTION_API_PORT ?? "4967";
const appUrl = `http://127.0.0.1:${webPort}`,
  apiUrl = `http://127.0.0.1:${apiPort}`;
await mkdir(root + "test-results", { recursive: true });
const log = createWriteStream(
  root + "test-results/marketing-motion-servers.log",
);

// Never check someone else's servers.
for (const url of [apiUrl + "/health", appUrl]) {
  const answered = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
    () => true,
    () => false,
  );
  if (answered)
    throw new Error(
      `${url} is already answering; stop that server or set MOTION_WEB_PORT/MOTION_API_PORT`,
    );
}

const availability = (on) => ({
  model: on,
  nutrition: false,
  voice: false,
  customDomains: false,
  payments: on,
  payouts: on,
  whoop: false,
  zepp: false,
  instagram: false,
});
const state = { mode: "closed" };
globalThis.__motionPlatform = {
  set(mode) {
    state.mode = mode;
  },
};
const stub = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];
  if (path === "/health") return res.writeHead(200).end("ok");
  if (path === "/api/v1/public/platform" && state.mode === "ready") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(
      JSON.stringify({
        name: "trainsyou",
        initials: "T",
        supportEmail: null,
        companyDetails: null,
        registrationOpen: true,
        coachAddressTemplate: appUrl + "/coach/{slug}",
        availability: availability(true),
        followerModel: DEFAULT_FOLLOWER_MODEL,
      }),
    );
  }
  res.writeHead(path === "/api/v1/public/platform" ? 503 : 404).end();
});
await new Promise((resolve) =>
  stub.listen(Number(apiPort), "127.0.0.1", resolve),
);

const children = [];
function stop(signal) {
  for (const c of children)
    try {
      process.kill(-c.pid, signal);
    } catch {}
}
process.on("exit", () => stop("SIGKILL"));
async function ready(url) {
  for (let i = 0; i < 240; i++) {
    if (children.some((c) => c.exitCode !== null))
      throw new Error(
        "The web server exited; see test-results/marketing-motion-servers.log",
      );
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Timed out starting " + url);
}
try {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const web = spawn(
    process.execPath,
    [
      root + "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      webPort,
    ],
    {
      cwd: root + "apps/web",
      env: {
        ...env,
        NEXT_TELEMETRY_DISABLED: "1",
        PUBLIC_APP_URL: appUrl,
        API_INTERNAL_URL: apiUrl,
        INTERNAL_PROXY_SECRET: randomBytes(32).toString("hex"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  web.stdout.pipe(log, { end: false });
  web.stderr.pipe(log, { end: false });
  children.push(web);
  await ready(appUrl + "/how-it-works");
  process.env.TEST_APP_URL = appUrl;
  await import(
    process.env.MOTION_CHECK_MODULE ?? "./marketing-motion-check.mjs"
  );
} finally {
  stop("SIGTERM");
  await new Promise((r) => setTimeout(r, 1000));
  stop("SIGKILL");
  stub.close();
  log.end();
}
