import pg from "pg";
import { readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

// Clone only this disposable CI template. Every test process still connects as
// the restricted runtime role; migration credentials never reach the tests.
const migration = new URL(
  process.env.MIGRATION_DATABASE_URL ?? "https://invalid",
);
const runtime = new URL(process.env.DATABASE_URL ?? "https://invalid");
if (
  process.env.CI !== "true" ||
  migration.protocol !== "postgres:" ||
  runtime.protocol !== "postgres:" ||
  migration.hostname !== "127.0.0.1" ||
  runtime.hostname !== migration.hostname ||
  runtime.port !== migration.port ||
  migration.pathname !== "/trainer" ||
  runtime.pathname !== "/trainer" ||
  migration.username !== "trainer_migrations" ||
  runtime.username !== "trainer_service"
)
  throw new Error("Test isolation requires the disposable local CI database");

// Connect outside the template: PostgreSQL requires it to have no active sessions.
const controlConnection = new URL(migration.href);
controlConnection.pathname = "/postgres";
const administrator = new pg.Client({
  connectionString: controlConnection.href,
});
await administrator.connect();
let failures = 0;
try {
  for (const file of (await readdir("tests"))
    .filter((name) => name.endsWith(".test.ts"))
    .sort()) {
    const database = "trainer_ci_" + randomUUID().replaceAll("-", "");
    await administrator.query(`CREATE DATABASE ${database} TEMPLATE trainer`);
    try {
      const connection = new URL(runtime.href);
      connection.pathname = "/" + database;
      const environment = { ...process.env, DATABASE_URL: connection.href };
      delete environment.MIGRATION_DATABASE_URL;
      const code = await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "--test", "tests/" + file],
          {
            stdio: "inherit",
            env: environment,
          },
        );
        child.once("error", reject);
        child.once("exit", (status) => resolve(status ?? 1));
      });
      if (code !== 0) failures++;
    } finally {
      await administrator.query(`DROP DATABASE ${database} WITH (FORCE)`);
    }
  }
} finally {
  await administrator.end();
}
console.log(`PostgreSQL test files failed: ${failures}`);
if (failures) process.exitCode = 1;
