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
import {
  ScopeError,
  SYSTEM_USER_ID,
  assertActorShape,
  assertScopedSql,
  assertServiceSql,
  scopeDecision,
  type Elevation,
} from "./scope.ts";
export {
  applyMigrations,
  assertRuntimeRoles,
  planMigrations,
  readMigrations,
  verifyMigrations,
} from "./migrations.ts";
export {
  ELEVATIONS,
  ScopeError,
  SYSTEM_USER_ID,
  assertScopedSql,
  assertServiceSql,
  scopeDecision,
  sqlTokens,
  type Elevation,
} from "./scope.ts";
/**
 * A tenant actor. `role` must be the member's own role (an owner may also act
 * as staff, finance or subscriber). Service identities that are not members
 * carry an allowlisted `elevation` reason instead (see scope.ts).
 */
export type Actor = {
  tenantId: string;
  userId: string;
  role: string;
  elevation?: Elevation;
  /** Owner-only review of this owner's private test subscriber, verified at scope entry. */
  previewMemberId?: string;
};
/** A service identity acting in one workspace for an allowlisted reason. */
export function elevated(
  reason: Elevation,
  scope: { tenantId: string; role: string; userId?: string },
): Actor {
  return {
    tenantId: scope.tenantId,
    userId: scope.userId ?? SYSTEM_USER_ID,
    role: scope.role,
    elevation: reason,
  };
}
/**
 * The actor for work that row security reserves for `role`. A follower keeps
 * its own subscriber scope (its rows only; never raised); an owner, or an
 * identity that is already elevated, switches role directly; a staff or
 * finance member needs the allowlisted `reason`.
 */
export function actingAs(a: Actor, role: string, reason: Elevation): Actor {
  if (a.role === "subscriber" && !a.elevation) return a;
  if (a.elevation || a.role === "owner" || a.role === role)
    return { ...a, role };
  return { ...a, role, elevation: reason };
}
export type Tx = {
  query: <T = Record<string, any>>(sql: string, values?: any[]) => Promise<T[]>;
};
export type ScopeOptions = {
  /** Lets the erasure triggers accept this scope's deletes and scrubs. */
  privacyErasure?: boolean;
};
/** A service transaction; tenant work inside it goes through tenant(). */
export type SystemTx = Tx & {
  /**
   * Runs fn in a verified tenant scope inside this service transaction, then
   * returns to the service role. The outer handle is unusable meanwhile.
   */
  tenant: <T>(
    actor: Actor,
    fn: (tx: Tx) => Promise<T>,
    options?: ScopeOptions,
  ) => Promise<T>;
  /**
   * Runs fn with this transaction's workspace binding lifted, in the same
   * transaction: only for a step that is cross-workspace by design (an
   * account-level scrub that must see the person's other memberships, a
   * visitor's analytics erasure). A no-op wrapper when the transaction is
   * unbound.
   */
  acrossWorkspaces: <T>(fn: (tx: SystemTx) => Promise<T>) => Promise<T>;
};
export type SystemOptions = {
  /** Binds service-table row security to one workspace (app.service_tenant_id). */
  tenantId?: string;
};
export type Database = {
  system: <T>(
    fn: (tx: SystemTx) => Promise<T>,
    options?: SystemOptions,
  ) => Promise<T>;
  tenant: <T>(
    actor: Actor,
    fn: (tx: Tx) => Promise<T>,
    options?: ScopeOptions,
  ) => Promise<T>;
  close: () => Promise<void>;
};
const quoteIdent = (name: string) => '"' + name.replaceAll('"', '""') + '"';
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
    fn: (tx: any) => Promise<T>,
    scopeOptions: ScopeOptions = {},
    systemOptions: SystemOptions = {},
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
    // Package statements (scope entry and exit) bypass the guard. Tenant
    // statements use the extended protocol: one statement per call (PGlite's
    // query() is always extended).
    const raw = async (sql: string, values: any[] = [], extended = false) =>
      (
        await (pool && extended
          ? client.query({ text: sql, values, queryMode: "extended" })
          : client.query(sql, values))
      ).rows as any[];
    const bound = systemOptions.tenantId;
    let lifted = false;
    let scoped = false;
    let broken: Error | null = null;
    const usable = () => {
      if (broken) throw broken;
    };
    /** Verifies the actor against its membership, sets the scope and becomes trainer_app. */
    async function enter(scope: Actor, opts: ScopeOptions) {
      assertActorShape(scope);
      if (bound && scope.tenantId !== bound)
        throw new ScopeError(
          "SCOPE_TENANT_MISMATCH",
          "This service transaction is bound to another workspace",
          500,
        );
      // Decided in this transaction, as the service role, before any scope
      // setting changes.
      const [row] = await raw(
        "SELECT (SELECT m.role FROM memberships m WHERE m.tenant_id=$1::uuid AND m.user_id=$2::uuid) AS member_role,current_user AS previous_role,session_user AS session_role,coalesce(current_setting('app.privacy_erasure',true),'') AS prior_erasure",
        [scope.tenantId, scope.userId],
      );
      scopeDecision(scope, row.member_role ?? null);
      if (scope.previewMemberId !== undefined) {
        if (scope.role !== "owner" || row.member_role !== "owner" || scope.elevation)
          throw new ScopeError("PREVIEW_SCOPE", "Only the workspace owner may review their test subscriber");
        const [preview] = await raw(
          "SELECT id FROM trainer_preview_profiles WHERE tenant_id=$1 AND trainer_user_id=$2 AND user_id=$3 AND archived_at IS NULL",
          [scope.tenantId, scope.userId, scope.previewMemberId],
        );
        if (!preview) throw new ScopeError("PREVIEW_SCOPE", "This test subscriber does not belong to this trainer");
      }
      // Still the service role: trainer_app cannot call set_config at all
      // (migration 061), so the scope is fixed once SET ROLE runs. The
      // erasure flag is always set explicitly: only the privacyErasure
      // option turns it on inside a scope.
      await raw(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true),set_config('app.role',$3,true),set_config('app.elevation',$4,true),set_config('app.privacy_erasure',$5,true),set_config('app.preview_member_id',$6,true)",
        [
          scope.tenantId,
          scope.userId,
          scope.role,
          scope.elevation ?? "",
          opts.privacyErasure ? "true" : "",
          scope.previewMemberId ?? "",
        ],
      );
      await raw("SET LOCAL ROLE trainer_app");
      return row as {
        previous_role: string;
        session_role: string;
        prior_erasure: string;
      };
    }
    async function leave(prior: {
      previous_role: string;
      session_role: string;
      prior_erasure: string;
    }) {
      await raw("RESET ROLE");
      await raw(
        "SELECT set_config('app.tenant_id','',true),set_config('app.user_id','',true),set_config('app.role','',true),set_config('app.elevation','',true),set_config('app.preview_member_id','',true),set_config('app.privacy_erasure',$1,true)",
        [prior.prior_erasure],
      );
      // A test may run the service transaction as a non-bypassing fixture role.
      if (prior.previous_role !== prior.session_role)
        await raw("SET LOCAL ROLE " + quoteIdent(prior.previous_role));
    }
    const scopedTx = (savepoints: boolean): Tx => ({
      query: async <T>(sql: string, values: any[] = []) => {
        usable();
        assertScopedSql(sql, savepoints);
        return (await raw(sql, values, true)) as T[];
      },
    });
    const systemTx: SystemTx = {
      query: async <T>(sql: string, values: any[] = []) => {
        usable();
        if (scoped)
          throw new ScopeError(
            "SCOPE_ACTIVE",
            "Use the tenant handle inside tx.tenant()",
            500,
          );
        assertServiceSql(sql);
        return (await raw(sql, values)) as T[];
      },
      tenant: async (scope, inner, opts = {}) => {
        usable();
        if (scoped)
          throw new ScopeError(
            "SCOPE_ACTIVE",
            "Tenant scopes do not nest",
            500,
          );
        scoped = true;
        let prior: Awaited<ReturnType<typeof enter>> | null = null;
        try {
          prior = await enter(scope, opts);
          const result = await inner(scopedTx(false));
          await leave(prior);
          return result;
        } catch (error) {
          // Leave the scope when the transaction can still run statements (an
          // application error); otherwise nothing else may use it.
          if (prior)
            try {
              await leave(prior);
            } catch {
              broken = error as Error;
            }
          throw error;
        } finally {
          scoped = false;
        }
      },
      acrossWorkspaces: async (inner) => {
        usable();
        if (scoped)
          throw new ScopeError(
            "SCOPE_ACTIVE",
            "Leave the tenant scope before lifting the workspace binding",
            500,
          );
        if (!bound || lifted) return inner(systemTx);
        const rebind = () =>
          raw("SELECT set_config('app.service_tenant_id',$1,true)", [bound]);
        await raw("SELECT set_config('app.service_tenant_id','',true)");
        lifted = true;
        let result;
        try {
          result = await inner(systemTx);
        } catch (error) {
          lifted = false;
          // An aborted transaction rolls back anyway; nothing else may use it.
          await rebind().catch(() => {
            broken = error as Error;
          });
          throw error;
        }
        lifted = false;
        await rebind();
        return result;
      },
    };
    try {
      await raw("BEGIN");
      if (bound) {
        assertActorShape({
          tenantId: bound,
          userId: SYSTEM_USER_ID,
          role: "owner",
        });
        await raw("SELECT set_config('app.service_tenant_id',$1,true)", [
          bound,
        ]);
      }
      if (actor) await enter(actor, scopeOptions);
      const result = await fn(actor ? scopedTx(true) : systemTx);
      if (broken) throw broken;
      await raw("COMMIT");
      return result;
    } catch (error) {
      await raw("ROLLBACK");
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
    system: (fn, systemOptions) => transaction(null, fn, {}, systemOptions),
    tenant: (actor, fn, scopeOptions) => transaction(actor, fn, scopeOptions),
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
/**
 * Inserts a record the actor's scope may write but not read back: a
 * follower's own request files internal review items about itself (coaching
 * decisions and exceptions) that only the coaching team reads. Returns the
 * stored values without RETURNING, which would need read access.
 */
export async function putPrivateRecord(
  tx: Tx,
  actor: Actor,
  kind: string,
  data: unknown,
  options: { id?: string; ownerId?: string; status?: string } = {},
) {
  const record = {
    id: options.id ?? randomUUID(),
    tenant_id: actor.tenantId,
    kind,
    owner_user_id: options.ownerId ?? actor.userId,
    status: options.status ?? "draft",
    version: 1,
    data: data as any,
  };
  await tx.query(
    "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,$3,$4,$5,$6)",
    [
      record.id,
      record.tenant_id,
      kind,
      record.owner_user_id,
      record.status,
      JSON.stringify(data),
    ],
  );
  return record;
}
