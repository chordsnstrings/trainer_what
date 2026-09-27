/**
 * Shared scenario context: clients, mocks, seeded people and the few harness
 * helpers (email links, polling, the test clock). Seeding and assertions go
 * through the public application API only. The single exception is
 * `advanceClock`, which moves specific time-based holds into the past in the
 * throwaway database because the harness cannot wait 72 real hours; every
 * use is recorded in the report.
 */
import { spawn } from "node:child_process";
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
  verifyEmail: (client: Client) => Promise<void>;
  waitUntil: <T>(what: string, probe: () => Promise<T | undefined | null | false>, timeoutMs?: number) => Promise<T>;
  advanceClock: (what: string, sql: string, params?: unknown[]) => Promise<number>;
  sqlRead: <T = any>(sql: string, params?: unknown[]) => Promise<T[]>;
  /**
   * Runs a host-only operator script (npm run operator:role, readiness, ...)
   * with the same environment as the API process, as an operator would on the
   * server. Output is returned, never logged: it may name accounts.
   */
  hostCommand: (script: string, args?: string[], env?: Record<string, string>) => Promise<{ status: number | null; stdout: string; stderr: string }>;
  /** One value of the API process environment, only to hand to a host command (never logged). */
  hostSetting: (name: string) => string | undefined;
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
}): E2EContext {
  const pool = new pg.Pool({ connectionString: input.migrationUrl, max: 2 });
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
    close: () => pool.end(),
  };
  return ctx;
}
