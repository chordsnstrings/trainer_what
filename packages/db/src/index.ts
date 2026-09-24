import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile, mkdir, readdir, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
export type Actor = { tenantId: string; userId: string; role: string };
export type Tx = {
  query: <T = Record<string, any>>(sql: string, values?: any[]) => Promise<T[]>;
};
export type Database = {
  system: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  tenant: <T>(actor: Actor, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};
export async function createDatabase(
  options: {
    memory?: boolean;
    url?: string;
    directory?: string;
    migrate?: boolean;
  } = {},
): Promise<Database> {
  const url = options.url ?? process.env.DATABASE_URL;
  if (process.env.NODE_ENV === "production" && !url)
    throw new Error("Production requires PostgreSQL DATABASE_URL");
  const pool = url ? new pg.Pool({ connectionString: url, max: 10 }) : null;
  const directory = resolve(
    fileURLToPath(new URL("../../../", import.meta.url)),
    options.directory ?? process.env.PGLITE_DATA_DIR ?? ".data/postgres",
  );
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  if (!pool && !options.memory)
    await mkdir(dirname(directory), { recursive: true });
  if (!pool && !options.memory) {
    const path = directory + ".lock";
    try {
      lock = await open(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(path, "utf8"));
      let stale = false;
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (e) {
          stale = (e as NodeJS.ErrnoException).code === "ESRCH";
        }
      }
      if (!stale)
        throw new Error(
          "Embedded database is already open. Stop its API process before migrations or seeding; use PostgreSQL for multiple processes.",
        );
      await unlink(path);
      lock = await open(path, "wx");
    }
    await lock.writeFile(String(process.pid));
  }
  const embedded = pool
    ? null
    : new PGlite(options.memory ? undefined : directory);
  let tail = Promise.resolve();
  async function transaction<T>(
    actor: Actor | null,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    let release = () => {};
    if (embedded) {
      const prior = tail;
      tail = new Promise<void>((r) => {
        release = r;
      });
      await prior;
    }
    const client: any = pool ? await pool.connect() : embedded!;
    const tx: Tx = {
      query: async <T>(sql: string, values: any[] = []) => {
        const result = await client.query(sql, values);
        return result.rows as T[];
      },
    };
    try {
      await tx.query("BEGIN");
      if (actor) {
        await tx.query("SET LOCAL ROLE trainer_app");
        await tx.query(
          "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role',$3,true)",
          [actor.tenantId, actor.userId, actor.role],
        );
      }
      const result = await fn(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      if (pool) (client as pg.PoolClient).release();
      release();
    }
  }
  if (options.migrate !== false) {
    const client: any = pool ? await pool.connect() : embedded!;
    try {
      const exists = await client.query(
        "SELECT to_regclass('public.schema_migrations') AS table_name",
      );
      const files = (await readdir(new URL("../migrations/", import.meta.url)))
        .filter((f) => f.endsWith(".sql"))
        .sort();
      const applied = exists.rows[0].table_name
        ? new Set(
            (
              await client.query("SELECT version FROM schema_migrations")
            ).rows.map((r: any) => r.version),
          )
        : new Set();
      for (const file of files) {
        if (applied.has(file.replace(".sql", ""))) continue;
        if (pool && process.env.NODE_ENV === "production")
          throw new Error(
            "Run pending migrations with the separate migration connection",
          );
        const sql = await readFile(
          new URL("../migrations/" + file, import.meta.url),
          "utf8",
        );
        if (embedded) await embedded.exec("BEGIN;" + sql + "COMMIT;");
        else {
          await client.query("BEGIN");
          try {
            await client.query(sql);
            await client.query("COMMIT");
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          }
        }
      }
      if (pool && process.env.NODE_ENV === "production") {
        const role = await client.query(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        );
        if (role.rows[0].rolsuper || role.rows[0].rolbypassrls)
          throw new Error("Runtime database role must not bypass RLS");
      }
    } finally {
      if (pool) (client as pg.PoolClient).release();
    }
  }
  return {
    system: (fn) => transaction(null, fn),
    tenant: (actor, fn) => transaction(actor, fn),
    close: async () => {
      if (pool) await pool.end();
      if (embedded) await embedded.close();
      if (lock) {
        await lock.close();
        await unlink(directory + ".lock");
      }
    },
  };
}
export async function event(
  tx: Tx,
  actor: Actor,
  name: string,
  subjectId?: string,
  data: unknown = {},
) {
  await tx.query(
    "INSERT INTO events(id,tenant_id,actor_id,name,subject_id,data) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
    [
      randomUUID(),
      actor.tenantId,
      actor.userId,
      name,
      subjectId ?? null,
      JSON.stringify(data),
    ],
  );
}
export async function putRecord(
  tx: Tx,
  actor: Actor,
  kind: string,
  data: unknown,
  options: { id?: string; ownerId?: string; status?: string } = {},
) {
  const id = options.id ?? randomUUID();
  const [record] = await tx.query(
    "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [
      id,
      actor.tenantId,
      kind,
      options.ownerId ?? actor.userId,
      options.status ?? "draft",
      JSON.stringify(data),
    ],
  );
  return record;
}
