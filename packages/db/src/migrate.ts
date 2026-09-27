import pg from "pg";
import { createDatabase } from "./index.ts";
import { applyMigrations } from "./migrations.ts";
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
    // All pending files commit together or not at all.
    const result = await applyMigrations(client);
    if (result.recorded.length)
      console.log(
        `Recorded checksums for ${result.recorded.length} previously applied migrations`,
      );
    console.log(`Migrations applied: ${result.applied.length}`);
  } finally {
    await client.end();
  }
}
