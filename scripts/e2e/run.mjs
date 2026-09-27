#!/usr/bin/env node
/**
 * Full-stack end-to-end harness with mock providers.
 *
 *   node scripts/e2e/run.mjs [options]        (npm run e2e -- [options])
 *
 * Creates a throwaway PostgreSQL cluster shaped like CI (migration owner +
 * restricted runtime role), migrates, provisions and verifies the runtime role,
 * builds the web app when needed, starts API, web and worker with
 * NODE_ENV=production behind a local TLS edge on https://localhost:<port>,
 * starts HTTPS mock providers with a per-run CA (NODE_EXTRA_CA_CERTS), creates
 * the first Superadmin through `npm run admin:bootstrap`, then runs the seed
 * and scenario suites (tests/e2e/harness) and writes tests/e2e/report.json.
 * Everything is torn down at the end unless --keep is given.
 *
 * Options:
 *   --suites=super-admin,trainer,follower,public-join   (default: all)
 *   --rebuild | --skip-build     force or skip `next build`
 *   --keep                       leave the stack running until Ctrl-C
 *   --model-capture=FILE         append every model request/answer (JSONL)
 *   --model-replay=FILE          answer model requests from reviewed JSONL
 *   --model-fallback=rules|fail  when no replay answer exists (default rules)
 *   --pg-port=N                  PostgreSQL port (default: a free port)
 *   --features=FILE              feature inventory JSON to check names against
 *   --report=FILE                report path (default tests/e2e/report.json)
 *
 * The sandbox is local only: TRAINER_PROVIDER_SANDBOX=mock is honoured solely
 * for a loopback PUBLIC_APP_URL and API_HOST, and startup refuses it otherwise.
 * Never point this at a shared database or run it on a server.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  chownSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.length ? value.join("=") : true];
  }),
);
if (Number(process.versions.node.split(".")[0]) < 24)
  throw new Error("Node 24 or later is required");
if (existsSync("/opt/gymmembership"))
  throw new Error("Refusing to run beside a GymMembership deployment.");

const started = Date.now();
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifacts = join(root, "tests/e2e/artifacts", runId);
mkdirSync(artifacts, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "trainer-e2e-"));
const children = [];
const cleanups = [];
const say = (message) =>
  console.log(`[e2e ${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
/** A clean environment: nothing inherited except the basics. */
function baseEnv(extra = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? "C.UTF-8",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  return { ...env, ...extra };
}
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    env: options.env ?? baseEnv(),
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (result.status !== 0)
    throw new Error(
      `${command} ${commandArgs.join(" ")} failed (${result.status}): ${(result.stderr ?? "") + (result.stdout ?? "")}`.slice(0, 4000),
    );
  return result.stdout ?? "";
}
function startService(name, commandArgs, cwd, env) {
  const log = createWriteStream(join(artifacts, `${name}.log`));
  const child = spawn(process.execPath, commandArgs, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("exit", (code, signal) =>
    log.write(`\n[${name} exited ${code ?? signal}]\n`),
  );
  children.push({ name, child, log });
  return child;
}
async function waitFor(url, check = (r) => r.ok, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const dead = children.find((c) => c.child.exitCode !== null);
    if (dead)
      throw new Error(`${dead.name} exited early; see ${artifacts}/${dead.name}.log`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (await check(response)) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url} (${last})`);
}

// ---------------------------------------------------------------- PostgreSQL
function postgresBin() {
  try {
    const dir = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" }).stdout?.trim();
    if (dir && existsSync(join(dir, "initdb"))) return dir;
  } catch {}
  const base = "/usr/lib/postgresql";
  if (existsSync(base)) {
    const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
    for (const v of versions)
      if (existsSync(join(base, v, "bin/initdb"))) return join(base, v, "bin");
  }
  throw new Error("PostgreSQL server binaries (initdb, pg_ctl) are required");
}
async function startPostgres() {
  const bin = postgresBin();
  const port = Number(args["pg-port"] ?? (await freePort()));
  const dir = mkdtempSync("/tmp/trainer-e2e-pg-");
  const password = randomBytes(18).toString("hex");
  const asRoot = userInfo().uid === 0;
  const pgRun = (tool, toolArgs) =>
    asRoot
      ? run("runuser", ["-u", "postgres", "--", join(bin, tool), ...toolArgs])
      : run(join(bin, tool), toolArgs);
  writeFileSync(join(dir, "pw"), password);
  if (asRoot) {
    chownSync(dir, ...uidOf("postgres"));
    chownSync(join(dir, "pw"), ...uidOf("postgres"));
  }
  pgRun("initdb", ["-D", join(dir, "data"), "-U", "trainer_migrations", `--pwfile=${join(dir, "pw")}`, "-A", "scram-sha-256"]);
  pgRun("pg_ctl", [
    "-D",
    join(dir, "data"),
    "-o",
    `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c max_connections=200`,
    "-l",
    join(dir, "postgres.log"),
    "start",
    "-w",
  ]);
  cleanups.push(() => {
    try {
      pgRun("pg_ctl", ["-D", join(dir, "data"), "stop", "-m", "immediate"]);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  const admin = `postgres://trainer_migrations:${password}@127.0.0.1:${port}`;
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: admin + "/postgres" });
  await client.connect();
  await client.query("CREATE DATABASE trainer");
  await client.end();
  return {
    port,
    migrationUrl: `${admin}/trainer`,
    runtimeUrl: `postgres://trainer_service:ci_runtime_fixture_only@127.0.0.1:${port}/trainer`,
  };
}
function uidOf(user) {
  const out = spawnSync("id", ["-u", user], { encoding: "utf8" }).stdout.trim();
  const gid = spawnSync("id", ["-g", user], { encoding: "utf8" }).stdout.trim();
  return [Number(out), Number(gid)];
}

// ---------------------------------------------------------------- web build
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs,
    );
  }
  return newest;
}
function ensureWebBuild() {
  const buildId = join(root, "apps/web/.next/BUILD_ID");
  const sources = Math.max(
    newestMtime(join(root, "apps/web")),
    newestMtime(join(root, "packages/contracts")),
    newestMtime(join(root, "packages/domain")),
  );
  const stale = !existsSync(buildId) || statSync(buildId).mtimeMs < sources;
  if (args["skip-build"]) {
    if (!existsSync(buildId)) throw new Error("No web build; remove --skip-build");
    if (stale) say("warning: web build is older than its sources (--skip-build given)");
    return;
  }
  if (!stale && !args.rebuild) return say("web build is current");
  say("building the web app (next build)…");
  run("npm", ["run", "build", "-w", "@trainer/web"], {
    env: baseEnv({ NODE_ENV: "production" }),
    inherit: true,
  });
}

// ---------------------------------------------------------------- TLS edge
/** Stands in for Caddy: TLS on https://localhost:<port>, X-Forwarded-For set by the edge. */
function startEdge(port, target, tlsMaterial) {
  const server = createHttpsServer(tlsMaterial, (req, res) => {
    // The harness names each simulated person's address; any other client
    // gets its socket address, as the production edge overwrites the header.
    const simulated = req.headers["x-e2e-client-ip"];
    const headers = { ...req.headers };
    delete headers["x-e2e-client-ip"];
    headers["x-forwarded-for"] =
      typeof simulated === "string" && /^[0-9.]{7,15}$/.test(simulated)
        ? simulated
        : req.socket.remoteAddress ?? "127.0.0.1";
    headers["x-forwarded-proto"] = "https";
    const upstream = httpRequest(
      { host: "127.0.0.1", port: target, method: req.method, path: req.url, headers },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("edge upstream error");
    });
    req.pipe(upstream);
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => {
      cleanups.push(() => new Promise((r) => server.close(() => r())));
      resolve(server);
    }),
  );
}

async function teardown() {
  for (const { child } of children) if (child.exitCode === null) child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  for (const { child } of children) if (child.exitCode === null) child.kill("SIGKILL");
  for (const cleanup of cleanups.reverse())
    try {
      await cleanup();
    } catch {}
  rmSync(work, { recursive: true, force: true });
}

let exitCode = 1;
try {
  register();
  const { createMockTls, trustMockCa } = await import("../../tests/e2e/mocks/tls.ts");
  const { startMocks } = await import("../../tests/e2e/mocks/index.ts");
  const { runHarness } = await import("../../tests/e2e/harness/main.ts");

  const tls = createMockTls(work);
  trustMockCa(tls.ca);
  say("throwaway CA created");
  const db = await startPostgres();
  say(`PostgreSQL on 127.0.0.1:${db.port}`);
  run(process.execPath, ["--import", "tsx", "packages/db/src/migrate.ts"], {
    env: baseEnv({ MIGRATION_DATABASE_URL: db.migrationUrl }),
  });
  // The CI fixture applies infra/runtime-role.sql and sets its loopback-only
  // fixture password on this throwaway cluster.
  run(process.execPath, ["scripts/prepare-ci-postgres.mjs"], {
    env: baseEnv({ CI: "true", MIGRATION_DATABASE_URL: db.migrationUrl, DATABASE_URL: db.runtimeUrl }),
  });
  run(process.execPath, ["scripts/verify-runtime-access.mjs"], {
    env: baseEnv({ DATABASE_URL: db.runtimeUrl, MIGRATION_DATABASE_URL: db.migrationUrl }),
  });
  say("migrated; runtime role provisioned and verified");
  ensureWebBuild();

  const [apiPort, webPort, edgePort] = [await freePort(), await freePort(), await freePort()];
  const publicUrl = `https://localhost:${edgePort}`;
  const capture = args["model-capture"] ? String(args["model-capture"]) : join(artifacts, "model-capture.jsonl");
  const mocks = await startMocks({
    tls,
    publicAppUrl: publicUrl,
    modelCapturePath: capture,
    modelReplayPath: args["model-replay"] ? String(args["model-replay"]) : undefined,
    modelFallback: args["model-fallback"] === "fail" ? "fail" : "rules",
  });
  cleanups.push(() => mocks.stop());
  say("mock providers listening");
  const secrets = {
    INTERNAL_PROXY_SECRET: randomBytes(48).toString("hex"),
    SECURITY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
  const runtimeEnv = baseEnv({
    NODE_ENV: "production",
    API_HOST: "127.0.0.1",
    API_PORT: String(apiPort),
    DATABASE_URL: db.runtimeUrl,
    PUBLIC_APP_URL: publicUrl,
    ...secrets,
    ...mocks.environment,
  });
  startService("api", ["--import", "tsx", "src/server.ts"], join(root, "apps/api"), runtimeEnv);
  await waitFor(`http://127.0.0.1:${apiPort}/health`);
  startService(
    "web",
    [join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(webPort)],
    join(root, "apps/web"),
    baseEnv({
      NODE_ENV: "production",
      PUBLIC_APP_URL: publicUrl,
      INTERNAL_PROXY_SECRET: secrets.INTERNAL_PROXY_SECRET,
      API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
    }),
  );
  await startEdge(edgePort, webPort, { key: tls.key, cert: tls.cert });
  startService("worker", ["--import", "tsx", "src/index.ts"], join(root, "apps/worker"), runtimeEnv);
  await waitFor(`${publicUrl}/api/v1/ready`, async (r) => r.ok && (await r.json()).providerSandbox === "mock", 120000);
  say(`stack ready at ${publicUrl} (API ${apiPort}, web ${webPort})`);

  const adminEmail = "superadmin@sandbox.example";
  const adminPassword = randomBytes(18).toString("base64url");
  const passwordFile = join(work, "admin-password");
  writeFileSync(passwordFile, adminPassword + "\n");
  chmodSync(passwordFile, 0o600);
  run(process.execPath, ["--import", "tsx", "scripts/bootstrap-admin.ts"], {
    env: baseEnv({
      DATABASE_URL: db.runtimeUrl,
      BOOTSTRAP_ADMIN_PASSWORD_FILE: passwordFile,
      BOOTSTRAP_ADMIN_EMAIL: adminEmail,
      BOOTSTRAP_ADMIN_NAME: "Sandbox Superadmin",
    }),
  });
  rmSync(passwordFile);
  say("first Superadmin created through npm run admin:bootstrap");

  const report = await runHarness({
    publicUrl,
    mocks,
    admin: { email: adminEmail, password: adminPassword },
    migrationUrl: db.migrationUrl,
    suites: args.suites ? String(args.suites).split(",") : undefined,
    featuresPath: args.features ? String(args.features) : undefined,
    artifacts,
    log: say,
  });
  const reportPath = args.report ? String(args.report) : join(root, "tests/e2e/report.json");
  report.run = {
    id: runId,
    startedAt: new Date(started).toISOString(),
    durationSeconds: Math.round((Date.now() - started) / 1000),
    publicUrl,
    artifacts,
    modelCapture: capture,
    modelReplay: args["model-replay"] ?? null,
    mockRequests: mocks.requestLog(),
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(report, null, 2) + "\n");
  say(`report: ${reportPath} — ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped`);
  exitCode = report.summary.failed ? 1 : 0;
  if (args.keep) {
    say(`--keep: stack stays up at ${publicUrl}; Ctrl-C to stop`);
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  }
} catch (error) {
  console.error(error);
  say(`failed; service logs are in ${artifacts}`);
} finally {
  await teardown();
  say("torn down");
  process.exit(exitCode);
}
