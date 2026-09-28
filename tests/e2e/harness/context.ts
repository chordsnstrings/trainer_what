/**
 * Shared scenario context: clients, mocks, seeded people and the few harness
 * helpers (email links, polling, the test clock). Seeding and assertions go
 * through the public application API only. The single exception is
 * `advanceClock`, which moves specific time-based holds into the past in the
 * throwaway database because the harness cannot wait 72 real hours; every
 * use is recorded in the report.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { MockSuite } from "../mocks/index.ts";
import { linkIn } from "../mocks/email.ts";
import { Client } from "./client.ts";
import type { Reporter } from "./report.ts";

export type TrainerSeed = {
  client: Client;
  slug: string;
  name: string;
  tenantId: string;
  products: { workout?: any; nutrition?: any };
  published: boolean;
  nutrition: boolean;
  programTemplateId?: string;
  notes: string[];
};
export type FollowerSeed = {
  client: Client;
  trainer: TrainerSeed;
  via: "invitation" | "public-join";
  tier: "workout" | "workout_nutrition" | "none";
  paid: boolean;
  checkout?: { sessionId: string; subscriptionId?: string; chargeId?: string };
};

export type E2EContext = {
  publicUrl: string;
  mocks: MockSuite;
  reporter: Reporter;
  log: (message: string) => void;
  admin: Client;
  adminCredentials: { email: string; password: string };
  trainers: TrainerSeed[];
  followers: FollowerSeed[];
  clockShifts: Array<{ at: string; what: string; rows: number }>;
  artifacts: string;
  newClient: (label: string, email?: string, password?: string) => Client;
  /** Local TLS edge state for simulated coach domains (null when port 443 could not be bound). */
  edge: { domainAddress: string | null; domainError: string | null; asks: Array<{ at: string; name: string; status: number | string }> };
  /** A person visiting https://<hostname>/ through the coach-domain edge. */
  domainClient: (hostname: string, label: string, email?: string, password?: string) => Client;
  /** The API's own loopback port, for the edge-only internal routes (TLS ask). */
  apiPort?: number;
  verifyEmail: (client: Client) => Promise<void>;
  waitUntil: <T>(what: string, probe: () => Promise<T | undefined | null | false>, timeoutMs?: number) => Promise<T>;
  advanceClock: (what: string, sql: string, params?: unknown[]) => Promise<number>;
  /**
   * Stands in for one pass of a worker scheduler whose interval is longer
   * than a run (the Brain plan scheduler visits a workspace every 10 minutes):
   * inserts the job that pass would queue, with its own intent key and data,
   * so the real worker claims and runs it. Recorded under `clockShifts`.
   */
  schedulerTick: (what: string, job: { tenantId: string; kind: string; intentKey: string; data: Record<string, unknown> }) => Promise<boolean>;
  sqlRead: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  /**
   * Runs a host-only operator script (npm run operator:role, readiness, ...)
   * with the same environment as the API process, as an operator would on the
   * server. Output is returned, never logged: it may name accounts.
   */
  hostCommand: (script: string, args?: string[], env?: Record<string, string>) => Promise<{ status: number | null; stdout: string; stderr: string }>;
  /** One value of the API process environment, only to hand to a host command (never logged). */
  hostSetting: (name: string) => string | undefined;
  /**
   * One cycle of the real host controller (infra/digitalocean/hostops.py) with
   * simulated host primitives (tests/e2e/harness/host_controller.py): pending
   * signed actions, backups with an off-server copy to the S3 double, and the
   * signed host report. Returns the controller's JSON summary.
   */
  hostControllerCycle: () => Promise<any>;
  close: () => Promise<void>;
};

export function createContext(input: {
  publicUrl: string;
  mocks: MockSuite;
  reporter: Reporter;
  log: (message: string) => void;
  admin: { email: string; password: string };
  migrationUrl: string;
  artifacts: string;
  hostEnv?: Record<string, string | undefined>;
  root?: string;
  edge?: E2EContext["edge"];
  apiPort?: number;
}): E2EContext {
  const pool = new pg.Pool({ connectionString: input.migrationUrl, max: 2 });
  const hostRoot = mkdtempSync(join(tmpdir(), "trainer-e2e-host-"));
  const ctx: E2EContext = {
    publicUrl: input.publicUrl,
    mocks: input.mocks,
    reporter: input.reporter,
    log: input.log,
    admin: new Client(input.publicUrl, "superadmin", input.admin.email, input.admin.password),
    adminCredentials: input.admin,
    trainers: [],
    followers: [],
    clockShifts: [],
    artifacts: input.artifacts,
    newClient: (label, email = "", password = "") => new Client(input.publicUrl, label, email, password),
    edge: input.edge ?? { domainAddress: null, domainError: "the runner started no coach-domain edge", asks: [] },
    apiPort: input.apiPort,
    domainClient(hostname, label, email = "", password = "") {
      const address = ctx.edge.domainAddress;
      if (!address) throw new Error("coach-domain edge unavailable: " + ctx.edge.domainError);
      const client = new Client(`https://${hostname}`, label, email, password);
      client.connectTo = address;
      return client;
    },
    async verifyEmail(client) {
      const before = input.mocks.email.inbox(client.email).length;
      await client.post("/api/v1/auth/request-verification", {});
      const message = await input.mocks.email.waitFor(
        client.email,
        (m) => /verify-email\//.test(m.text),
        90000,
        before,
      );
      const token = linkIn(message, "/verify-email/").pathname.split("/").pop()!;
      await client.post("/api/v1/auth/verify-email", { token });
    },
    async waitUntil(what, probe, timeoutMs = 90000) {
      const deadline = Date.now() + timeoutMs;
      let lastError: unknown;
      for (;;) {
        try {
          const value = await probe();
          if (value) return value;
        } catch (error) {
          lastError = error;
        }
        if (Date.now() > deadline)
          throw new Error(
            `Timed out waiting for ${what}${lastError ? ": " + (lastError as Error).message : ""}`,
          );
        await new Promise((r) => setTimeout(r, 500));
      }
    },
    async advanceClock(what, sql, params = []) {
      // One transaction; statements separated by ";\n" share the parameters.
      const client = await pool.connect();
      let rows = 0;
      try {
        await client.query("BEGIN");
        for (const statement of sql.split(/;\s*\n/).filter((s) => s.trim())) {
          const needed = [...statement.matchAll(/\$(\d+)/g)].reduce((max, m) => Math.max(max, Number(m[1])), 0);
          const result = await client.query(statement, params.slice(0, needed));
          if (/^\s*update/i.test(statement)) rows += result.rowCount ?? 0;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      ctx.clockShifts.push({ at: new Date().toISOString(), what, rows });
      input.log(`  clock  ${what} (${rows} rows)`);
      return rows;
    },
    async schedulerTick(what, job) {
      const id = (await import("node:crypto")).randomUUID();
      const { rowCount } = await pool.query(
        "INSERT INTO jobs(id,tenant_id,kind,intent_key,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(intent_key) DO NOTHING",
        [id, job.tenantId, job.kind, job.intentKey, JSON.stringify(job.data)],
      );
      // The scheduler's own pass may already have queued the same intent.
      const note = rowCount ? "" : " (already queued by the scheduler itself; nothing inserted)";
      ctx.clockShifts.push({ at: new Date().toISOString(), what: "scheduler tick: " + what + note, rows: rowCount ?? 0 });
      input.log(`  clock  scheduler tick: ${what}${note}`);
      return !!rowCount;
    },
    async sqlRead(sql, params = []) {
      if (!/^\s*select\b/i.test(sql)) throw new Error("sqlRead is read-only");
      return (await pool.query(sql, params)).rows;
    },
    hostCommand(script, args = [], env = {}) {
      if (!input.hostEnv || !input.root) throw new Error("Host commands need the runner's service environment");
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", script, ...args], {
          cwd: input.root,
          env: { ...input.hostEnv, ...env } as NodeJS.ProcessEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        const timer = setTimeout(() => child.kill("SIGTERM"), 120000);
        child.on("error", reject);
        child.on("close", (status) => {
          clearTimeout(timer);
          resolve({ status, stdout, stderr });
        });
      });
    },
    hostSetting: (name) => input.hostEnv?.[name],
    hostControllerCycle() {
      if (!input.hostEnv || !input.root) throw new Error("The controller needs the runner's service environment");
      const pgBin = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" }).stdout?.trim() || "/usr/lib/postgresql/16/bin";
      const env: Record<string, string> = {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        PYTHONDONTWRITEBYTECODE: "1",
        E2E_HOST_ROOT: hostRoot,
        E2E_MIGRATION_URL: input.migrationUrl,
        E2E_PG_BIN: pgBin,
        E2E_REPO: input.root,
        E2E_PUBLIC_URL: input.publicUrl,
        INTERNAL_PROXY_SECRET: input.hostEnv.INTERNAL_PROXY_SECRET ?? "",
        SECURITY_ENCRYPTION_KEY: input.hostEnv.SECURITY_ENCRYPTION_KEY ?? "",
        // The off-server copy goes to the S3 double, trusted through the run's CA only.
        SSL_CERT_FILE: input.mocks.tls.caFile,
        ...input.mocks.s3.settings(),
      };
      return new Promise((resolve, reject) => {
        const child = spawn("python3", [join(input.root!, "tests/e2e/harness/host_controller.py")], {
          cwd: input.root,
          env: env as NodeJS.ProcessEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        const timer = setTimeout(() => child.kill("SIGTERM"), 300000);
        child.on("error", reject);
        child.on("close", (status) => {
          clearTimeout(timer);
          const line = stdout.trim().split("\n").pop() ?? "";
          if (status !== 0) return reject(new Error(`host controller exited ${status}: ${stderr.slice(-800)}`));
          try {
            resolve(JSON.parse(line));
          } catch {
            reject(new Error("host controller printed no summary: " + stderr.slice(-400)));
          }
        });
      });
    },
    close: async () => {
      rmSync(hostRoot, { recursive: true, force: true });
      await pool.end();
    },
  };
  return ctx;
}
