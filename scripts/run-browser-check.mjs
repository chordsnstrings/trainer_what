import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(root + "test-results", { recursive: true });
const log = createWriteStream(root + "test-results/browser-servers.log");
const children = [];
const proxySecret =
  process.env.INTERNAL_PROXY_SECRET ?? randomBytes(32).toString("hex");
// BROWSER_WEB_PORT / BROWSER_API_PORT let two checks run on one machine.
const webPort = process.env.BROWSER_WEB_PORT ?? "3000",
  apiPort = process.env.BROWSER_API_PORT ?? "4000";
const appUrl = `http://localhost:${webPort}`,
  apiUrl = `http://127.0.0.1:${apiPort}`;
// Never check someone else's servers.
for (const url of [apiUrl + "/health", appUrl]) {
  const answered = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
    () => true,
    () => false,
  );
  if (answered)
    throw new Error(
      `${url} is already answering; stop that server or set BROWSER_WEB_PORT/BROWSER_API_PORT`,
    );
}
function start(args, cwd, extra = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      ...extra,
      NEXT_TELEMETRY_DISABLED: "1",
      PUBLIC_APP_URL: appUrl,
      API_INTERNAL_URL: apiUrl,
      INTERNAL_PROXY_SECRET: proxySecret,
      API_HOST: "127.0.0.1",
      API_PORT: apiPort,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  children.push(child);
  return child;
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    if (children.some((c) => c.exitCode !== null))
      throw new Error("A test server exited; inspect browser-servers.log");
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Timed out starting " + url);
}
try {
  await new Promise((resolve, reject) => {
    const fixture = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/seed-browser-completion.ts"],
      {
        cwd: root,
        env: {
          ...process.env,
          PUBLIC_APP_URL: process.env.PUBLIC_APP_URL ?? appUrl,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    fixture.stdout.pipe(log, { end: false });
    fixture.stderr.pipe(log, { end: false });
    fixture.once("error", reject);
    fixture.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              "Browser completion fixture failed; inspect browser-servers.log",
            ),
          ),
    );
  });
  // The synthetic loopback fixture explicitly opts into development controls;
  // an unset NODE_ENV enforces production security.
  start(["--import", "tsx", "src/server.ts"], root + "apps/api", {
    NODE_ENV: "development",
  });
  start(
    [
      root + "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      webPort,
    ],
    root + "apps/web",
  );
  await ready(apiUrl + "/health");
  await ready(appUrl);
  process.env.TEST_APP_URL ??= appUrl;
  await import("./browser-check.mjs");
} finally {
  for (const c of children) c.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1000));
  for (const c of children) if (c.exitCode === null) c.kill("SIGKILL");
  log.end();
}
