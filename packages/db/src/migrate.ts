import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createDatabase } from "./index.ts";
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  if (process.env.NODE_ENV === "production")
    throw new Error("MIGRATION_DATABASE_URL required");
  const db = await createDatabase();
  await db.close();
  console.log("Local migrations applied");
} else {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const r = await client.query(
      "SELECT to_regclass('public.schema_migrations') AS name",
    );
    const applied = r.rows[0].name
      ? new Set(
          (
            await client.query("SELECT version FROM schema_migrations")
          ).rows.map((r) => r.version),
        )
      : new Set();
    for (const file of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (applied.has(file.replace(".sql", ""))) continue;
      await client.query("BEGIN");
      await client.query(
        await readFile(
          new URL("../migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
      await client.query("COMMIT");
    }
    console.log("Migrations applied");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}
