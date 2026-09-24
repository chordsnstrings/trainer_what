import pg from "pg";
import { readFile } from "node:fs/promises";
if (
  process.env.CI !== "true" ||
  !process.env.MIGRATION_DATABASE_URL?.includes("127.0.0.1")
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
  console.log(
    "Disposable CI runtime role provisioned without table ownership or RLS bypass.",
  );
} finally {
  await client.end();
}
