import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type MigrationFile = { version: string; sql: string; checksum: string };
export type MigrationClient = {
  query: (sql: string, values?: any[]) => Promise<{ rows: any[] }>;
  /** Runs a multi-statement file; defaults to a parameterless query. */
  exec?: (sql: string) => Promise<unknown>;
};

const defaultDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

export async function readMigrations(
  directory: string = defaultDirectory,
): Promise<MigrationFile[]> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(directory, name), "utf8");
      return {
        version: name.slice(0, -4),
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
}

async function appliedMigrations(client: MigrationClient) {
  const [table] = (
    await client.query("SELECT to_regclass('public.schema_migrations') AS name")
  ).rows;
  if (!table.name) return [];
  // Databases migrated before checksums existed have no checksum column yet.
  return (
    await client.query(
      "SELECT version,to_jsonb(s)->>'checksum' AS checksum FROM schema_migrations s",
    )
  ).rows as Array<{ version: string; checksum: string | null }>;
}

/** Rejects edited applied files; returns pending files and legacy unhashed rows. */
export function planMigrations(
  files: MigrationFile[],
  applied: Array<{ version: string; checksum: string | null }>,
) {
  const recorded = new Map(applied.map((row) => [row.version, row.checksum]));
  const changed = files.filter((file) => {
    const checksum = recorded.get(file.version);
    return checksum != null && checksum !== file.checksum;
  });
  if (changed.length)
    throw new Error(
      `Migration ${changed.map((file) => file.version).join(", ")} changed after it was applied; restore it and add a new migration`,
    );
  return {
    pending: files.filter((file) => !recorded.has(file.version)),
    unrecorded: files.filter(
      (file) =>
        recorded.has(file.version) && recorded.get(file.version) == null,
    ),
  };
}

/** Read-only comparison for runtime connections that must not migrate. */
export async function verifyMigrations(
  client: MigrationClient,
  directory?: string,
) {
  return planMigrations(
    await readMigrations(directory),
    await appliedMigrations(client),
  );
}

/**
 * Applies every pending file in one transaction under a migration lock, so a
 * failing file leaves none of the same deploy committed. Migrations must stay
 * transactional: no CONCURRENTLY, and no enum value added and used together.
 */
export async function applyMigrations(
  client: MigrationClient,
  directory?: string,
) {
  const files = await readMigrations(directory);
  const exec = client.exec
    ? (sql: string) => client.exec!(sql)
    : (sql: string) => client.query(sql);
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('trainer:migrations'))",
    );
    const { pending, unrecorded } = planMigrations(
      files,
      await appliedMigrations(client),
    );
    for (const file of pending) {
      await exec(file.sql);
      // Files record their own version; this also covers one that forgets.
      await client.query(
        "INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING",
        [file.version],
      );
    }
    const [column] = (
      await client.query(
        "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid=to_regclass('public.schema_migrations') AND attname='checksum' AND NOT attisdropped",
      )
    ).rows;
    const record = column.n ? [...unrecorded, ...pending] : [];
    for (const file of record)
      await client.query(
        "UPDATE schema_migrations SET checksum=$2 WHERE version=$1 AND checksum IS NULL",
        [file.version, file.checksum],
      );
    await client.query("COMMIT");
    return {
      applied: pending.map((file) => file.version),
      recorded: column.n ? unrecorded.map((file) => file.version) : [],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Every role the runtime can act as, including trainer_app, must obey RLS. */
export async function assertRuntimeRoles(client: MigrationClient) {
  const { rows } = await client.query(
    "SELECT r.rolname FROM pg_roles r WHERE (r.rolname IN ('trainer_app',current_user) OR pg_has_role(current_user,r.oid,'MEMBER')) AND (r.rolsuper OR r.rolbypassrls) ORDER BY r.rolname",
  );
  if (rows.length)
    throw new Error(
      "Runtime database role must not bypass RLS: " +
        rows.map((row) => row.rolname).join(", "),
    );
}
