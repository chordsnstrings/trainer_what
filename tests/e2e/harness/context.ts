/**
 * Shared scenario context: clients, mocks, seeded people and the few harness
 * helpers (email links, polling, the test clock). Seeding and assertions go
 * through the public application API only. The single exception is
 * `advanceClock`, which moves specific time-based holds into the past in the
 * throwaway database because the harness cannot wait 72 real hours; every
 * use is recorded in the report.
 */
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
      const result = await pool.query(sql, params);
      ctx.clockShifts.push({ at: new Date().toISOString(), what, rows: result.rowCount ?? 0 });
      input.log(`  clock  ${what} (${result.rowCount} rows)`);
      return result.rowCount ?? 0;
    },
    async sqlRead(sql, params = []) {
      if (!/^\s*select\b/i.test(sql)) throw new Error("sqlRead is read-only");
      return (await pool.query(sql, params)).rows;
    },
    close: () => pool.end(),
  };
  return ctx;
}
