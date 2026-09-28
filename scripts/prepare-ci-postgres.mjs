import pg from "pg";
import { readFile } from "node:fs/promises";
const migration = new URL(
  process.env.MIGRATION_DATABASE_URL ?? "https://invalid",
);
const runtime = new URL(process.env.DATABASE_URL ?? "https://invalid");
if (
  process.env.CI !== "true" ||
  !["postgres:", "postgresql:"].includes(migration.protocol) ||
  !["postgres:", "postgresql:"].includes(runtime.protocol) ||
  migration.hostname !== "127.0.0.1" ||
  runtime.hostname !== "127.0.0.1" ||
  migration.pathname !== "/trainer" ||
  runtime.pathname !== migration.pathname ||
  migration.port !== runtime.port ||
  migration.username !== "trainer_migrations" ||
  runtime.username !== "trainer_service"
)
  throw new Error("This fixture prepares a disposable local CI database only");
const client = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
await client.connect();
try {
  await client.query(
    await readFile(
      new URL("../infra/runtime-role.sql", import.meta.url),
      "utf8",
    ),
  );
  await client.query(
    "ALTER ROLE trainer_service PASSWORD 'ci_runtime_fixture_only'",
  );
  // A fresh CI database runs only scope-compatible code: apply the tenant
  // scope hardening exactly as a scope-compatible controller would.
  await client.query(
    await readFile(
      new URL("../infra/tenant-scope.sql", import.meta.url),
      "utf8",
    ),
  );
  console.log(
    "Disposable CI runtime role provisioned without table ownership or RLS bypass.",
  );
} finally {
  await client.end();
}
