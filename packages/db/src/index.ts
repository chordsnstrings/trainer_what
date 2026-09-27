import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile, mkdir, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  applyMigrations,
  assertRuntimeRoles,
  verifyMigrations,
} from "./migrations.ts";
export {
  applyMigrations,
  assertRuntimeRoles,
  planMigrations,
  readMigrations,
  verifyMigrations,
} from "./migrations.ts";
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
  const close = async () => {
    if (pool) await pool.end();
    if (embedded) await embedded.close();
    if (lock) {
      await lock.close();
      await unlink(directory + ".lock");
    }
  };
  if (options.migrate !== false) {
    const client: any = pool ? await pool.connect() : embedded!;
    try {
      if (pool && process.env.NODE_ENV === "production") {
        // The runtime role only reads: edited or pending files stop startup.
        if ((await verifyMigrations(client)).pending.length)
          throw new Error(
            "Run pending migrations with the separate migration connection",
          );
        await assertRuntimeRoles(client);
      } else
        await applyMigrations(
          embedded
            ? {
                query: (sql, values) => embedded.query(sql, values),
                exec: (sql) => embedded.exec(sql),
              }
            : client,
        );
    } catch (error) {
      if (pool) (client as pg.PoolClient).release();
      await close();
      throw error;
    }
    if (pool) (client as pg.PoolClient).release();
  }
  return {
    system: (fn) => transaction(null, fn),
    tenant: (actor, fn) => transaction(actor, fn),
    close,
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
