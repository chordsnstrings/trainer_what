// Seeds a throwaway synthetic development database, starts the API and the
// web app locally (Next development mode by default; RTL_WEB_MODE=start uses
// an existing production build), then runs scripts/rtl-check.mjs with local
// Chromium. Ports and the embedded database directory are separate from the
// default browser check so both can run on one machine.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const webPort = process.env.RTL_WEB_PORT ?? "3123",
  apiPort = process.env.RTL_API_PORT ?? "4123";
const appUrl = `http://localhost:${webPort}`,
  apiUrl = `http://127.0.0.1:${apiPort}`;
const mode = process.env.RTL_WEB_MODE === "start" ? "start" : "dev";
// Relative to the repository root (packages/db resolves it there).
const dataDir = process.env.RTL_DATA_DIR ?? ".data/rtl-check";
await mkdir(root + "test-results", { recursive: true });
const log = createWriteStream(root + "test-results/rtl-servers.log");
const children = [];
const proxySecret =
  process.env.INTERNAL_PROXY_SECRET ?? randomBytes(32).toString("hex");
const shared = {
  NEXT_TELEMETRY_DISABLED: "1",
  PUBLIC_APP_URL: appUrl,
  API_INTERNAL_URL: apiUrl,
  INTERNAL_PROXY_SECRET: proxySecret,
  PGLITE_DATA_DIR: dataDir,
};
// Never point the synthetic seed at a configured PostgreSQL database.
const baseEnv = { ...process.env };
delete baseEnv.DATABASE_URL;

function run(args, cwd, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...baseEnv, ...shared, ...extra },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${args.join(" ")} failed; see rtl-servers.log`)),
    );
  });
}
function start(args, cwd, extra = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...baseEnv, ...shared, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so stopping it also stops `next-server`.
    detached: true,
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  children.push(child);
  return child;
}
function stop(signal) {
  // The group can outlive its leader (next dev's next-server child).
  for (const c of children)
    try {
      process.kill(-c.pid, signal);
    } catch {}
}
async function ready(url, attempts = 600) {
  for (let i = 0; i < attempts; i++) {
    if (children.some((c) => c.exitCode !== null))
      throw new Error("A test server exited; inspect rtl-servers.log");
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Timed out starting " + url);
}
// `next dev` rewrites this tracked file to its development type paths.
const nextEnv = root + "apps/web/next-env.d.ts";
const nextEnvSource = await readFile(nextEnv, "utf8");
// Servers never outlive this runner, even when it crashes.
process.on("exit", () => stop("SIGKILL"));
for (const url of [apiUrl + "/health", appUrl]) {
  const answered = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
    () => true,
    () => false,
  );
  if (answered)
    throw new Error(
      `${url} is already answering; stop that server or set RTL_WEB_PORT/RTL_API_PORT`,
    );
}
try {
  await rm(root + dataDir, { recursive: true, force: true });
  await rm(root + dataDir + ".lock", { force: true });
  const seedEnv = { NODE_ENV: "development" };
  await run(["--import", "tsx", "scripts/seed-demo.ts"], root, seedEnv);
  await run(
    ["--import", "tsx", "scripts/seed-browser-completion.ts"],
    root,
    seedEnv,
  );
  if (process.env.ONBOARDING_FIDELITY_FIXTURE === "true") {
    await run(["--import", "tsx", "scripts/seed-brain-fidelity.ts"], root, seedEnv);
    await run(["--import", "tsx", "scripts/seed-trainer-preview.ts"], root, seedEnv);
  }
  start(["--import", "tsx", "src/server.ts"], root + "apps/api", {
    NODE_ENV: "development",
    API_HOST: "127.0.0.1",
    API_PORT: apiPort,
  });
  const next = root + "node_modules/next/dist/bin/next";
  start(
    mode === "dev"
      ? [next, "dev", "--hostname", "127.0.0.1", "--port", webPort]
      : [next, "start", "--hostname", "127.0.0.1", "--port", webPort],
    root + "apps/web",
    mode === "dev" ? { NODE_ENV: "development" } : {},
  );
  await ready(apiUrl + "/health");
  // The first development request compiles the app.
  await ready(appUrl);
  process.env.TEST_APP_URL = appUrl;
  // scripts/run-brand-check.mjs reuses this runner for its own check.
  await import(process.env.RTL_CHECK_MODULE ?? "./rtl-check.mjs");
} finally {
  stop("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  stop("SIGKILL");
  if ((await readFile(nextEnv, "utf8")) !== nextEnvSource)
    await writeFile(nextEnv, nextEnvSource);
  log.end();
}
