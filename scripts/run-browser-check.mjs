import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(root + "test-results", { recursive: true });
const log = createWriteStream(root + "test-results/browser-servers.log");
const children = [];
function start(args, cwd) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      PUBLIC_APP_URL: "http://localhost:3000",
      API_HOST: "127.0.0.1",
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
  start(["--import", "tsx", "src/server.ts"], root + "apps/api");
  start(
    [
      root + "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
    ],
    root + "apps/web",
  );
  await ready("http://127.0.0.1:4000/health");
  await ready("http://localhost:3000");
  await import("./browser-check.mjs");
} finally {
  for (const c of children) c.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1000));
  for (const c of children) if (c.exitCode === null) c.kill("SIGKILL");
  log.end();
}
