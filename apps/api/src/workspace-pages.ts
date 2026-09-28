import { z } from "zod";
import { trainerEntry } from "./finance-statements.ts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Database, Tx } from "@trainer/db";
import { financeSummary } from "./finance.ts";

/**
 * Bounded workspace bootstrap and keyset paging.
 *
 * The bootstrap sends a fixed-size first page of every collection with a
 * `pages` entry (`hasMore`, `cursor`) and exact `totals`; the same collections
 * continue through `GET /api/v1/workspace/pages/:collection`. Every page runs
 * in the caller's tenant transaction, so row-level security scopes it exactly
 * as it scopes the bootstrap, and each collection keeps the bootstrap's role
 * rule. Pages order by an immutable key with a unique tie-break; the opaque
 * cursor carries that key at full precision (timestamps are formatted in UTC
 * by the database, to the microsecond), so a walk never repeats or skips a row
 * that existed when it started, and rows inserted meanwhile are newer than the
 * first page.
 */
type Identity = Actor & { platformRole?: string };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

type Page<T = any> = {
  items: T[];
  hasMore: boolean;
  cursor: string | null;
  /** Rows the page's items refer to, by the bootstrap collection they join. */
  related?: Record<string, any[]>;
};
type KeyType = "ts" | "uuid" | "text";

/** Record kinds the web shell reads from the bootstrap, with their page size. */
export const RECORD_CATALOG: Record<
  string,
  {
    page: number;
    statuses?: readonly string[];
    /**
     * `updated`: pages follow the latest change (updated_at) instead of
     * creation, for request queues that change in place (a reply on a support
     * thread, a refund's provider status), so recent activity comes first as
     * it did before paging. Such a row that changes while a client walks the
     * list moves to the first page: it is never repeated, and it appears when
     * the list next reloads.
     */
    order?: "updated";
  }
> = {
  beneficiary: { page: 50 },
  brain_release: { page: 50 },
  conflict: { page: 50, statuses: ["open"] },
  // Only the decisions behind the included open exceptions are pinned.
  decision: { page: 0 },
  evaluation: { page: 50 },
  exception: { page: 50, statuses: ["open"] },
  intake: { page: 50 },
  interview: { page: 50 },
  // Conversations page through /messages/thread; this is a recent sample.
  message: { page: 20 },
  product: { page: 50 },
  program: { page: 50 },
  refund: { page: 50, order: "updated" },
  rule: { page: 100 },
  scenario: { page: 50 },
  source: { page: 50 },
  support: { page: 50, order: "updated" },
  training_hold: { page: 20, statuses: ["active"] },
  workout: { page: 50 },
};
export const RECORD_KINDS = Object.keys(RECORD_CATALOG);
export const PAGE_SIZES = {
  sets: 100,
  members: 100,
  team: 100,
  subscriptions: 100,
  complimentary: 100,
  consents: 100,
  events: 100,
  costs: 100,
  journals: 100,
  payouts: 50,
  usageStatements: 24,
} as const;
const MAX_LIMIT = 100;
// A follower's own active sessions (and their set logs) are always present
// so offline logging keeps working however much history exists.
const PINNED_ACTIVE_WORKOUTS = 5;
const PINNED_ACTIVE_SETS = 500;
const PINNED_CONFIRMED_RULES = 100;
// Open safety and personal-review exceptions are the most urgent items on
// the attention list, and the oldest of them are the most overdue: they are
// always sent, oldest first, however many newer exceptions exist.
export const URGENT_EXCEPTION_CATEGORIES = ["safety", "policy_review"] as const;
export const PINNED_URGENT_EXCEPTIONS = 100;

const tsKey = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
// Teaching sources carry their full text and chunks; the shell only needs the
// size. Every other record keeps its complete data.
const RECORD_COLUMNS =
  "id,tenant_id,kind,owner_user_id,status,version,created_at,updated_at,CASE WHEN kind='source' THEN (data-'text'-'chunks')||jsonb_build_object('textLength',coalesce(length(data->>'text'),0),'chunkCount',CASE WHEN jsonb_typeof(data->'chunks')='array' THEN jsonb_array_length(data->'chunks') ELSE 0 END) ELSE data END AS data";
export const RECORD_COLUMN_NAMES = [
  "id",
  "tenant_id",
  "kind",
  "owner_user_id",
  "status",
  "version",
  "created_at",
  "updated_at",
  "data",
];

export function encodeCursor(values: string[]) {
  return Buffer.from(JSON.stringify(values)).toString("base64url");
}
const cursorPatterns: Record<KeyType, RegExp> = {
  ts: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  text: /^[\s\S]{0,300}$/,
};
export function decodeCursor(raw: string | undefined, types: KeyType[]) {
  if (raw === undefined || raw === "") return null;
  let values: unknown;
  try {
    values = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    values = null;
  }
  if (
    !Array.isArray(values) ||
    values.length !== types.length ||
    values.some(
      (v, i) => typeof v !== "string" || !cursorPatterns[types[i]].test(v),
    )
  )
    throw fail(
      400,
      "INVALID_CURSOR",
      "This list position is not valid. Reload the list.",
    );
  return values as string[];
}

/**
 * One keyset page. `key` lists the ordering expressions (all ascending or all
 * descending) with their cursor types; `cursorSql` formats each for the cursor.
 */
export async function keysetPage(
  tx: Tx,
  spec: {
    select: string;
    from: string;
    where?: string[];
    params?: any[];
    key: { sql: string; cursorSql: string; type: KeyType }[];
    descending: boolean;
    cursor: string | null | undefined;
    limit: number;
  },
): Promise<Page> {
  const params = [...(spec.params ?? [])];
  const where = [...(spec.where ?? [])];
  const after = decodeCursor(
    spec.cursor ?? undefined,
    spec.key.map((k) => k.type),
  );
  if (after) {
    const placeholders = after.map((value, i) => {
      params.push(value);
      const cast =
        spec.key[i].type === "ts"
          ? "timestamptz"
          : spec.key[i].type === "uuid"
            ? "uuid"
            : "text";
      return `$${params.length}::${cast}`;
    });
    where.push(
      `(${spec.key.map((k) => k.sql).join(",")})${spec.descending ? "<" : ">"}(${placeholders.join(",")})`,
    );
  }
  params.push(spec.limit + 1);
  const direction = spec.descending ? "DESC" : "ASC";
  const rows = await tx.query(
    `SELECT ${spec.select},${spec.key.map((k, i) => `${k.cursorSql} AS "_k${i}"`).join(",")} FROM ${spec.from}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY ${spec.key.map((k) => k.sql + " " + direction).join(",")} LIMIT $${params.length}`,
    params,
  );
  return finishPage(rows, spec.limit, spec.key.length);
}
function finishPage(rows: any[], limit: number, keys: number): Page {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const cursor =
    hasMore && last
      ? encodeCursor(
          Array.from({ length: keys }, (_, i) => String(last["_k" + i])),
        )
      : null;
  for (const row of items) for (let i = 0; i < keys; i++) delete row["_k" + i];
  return { items, hasMore, cursor };
}
const timeKey = (column: string) => (alias = "") => [
  {
    sql: alias + column,
    cursorSql: tsKey(alias + column),
    type: "ts" as const,
  },
  { sql: alias + "id", cursorSql: alias + "id::text", type: "uuid" as const },
];
export const createdKey = timeKey("created_at");
/** Latest change first; see RECORD_CATALOG `order`. */
export const updatedKey = timeKey("updated_at");
const recordKey = (kind: string) =>
  RECORD_CATALOG[kind]?.order === "updated" ? updatedKey() : createdKey();

/**
 * Planner hints for a follower. Row-level security already limits a follower
 * to their own rows (plus published products); repeating a superset of that
 * rule lets the owner indexes answer instead of reading the whole workspace.
 * They never widen what the policies allow.
 */
const followerRecords = (a: Actor | undefined, param: number) =>
  a?.role === "subscriber"
    ? `(owner_user_id=$${param}::uuid OR kind='product')`
    : null;
const followerRows = (a: Actor | undefined, column: string, param: number) =>
  a?.role === "subscriber" ? `${column}=$${param}::uuid` : null;

// ---- records ---------------------------------------------------------------

function recordStatuses(kind: string, status?: string) {
  if (status) return [status];
  return RECORD_CATALOG[kind]?.statuses ?? null;
}
export function recordPage(
  tx: Tx,
  a: Actor,
  q: { kind: string; status?: string; cursor?: string; limit?: number },
) {
  // Own keys only: "constructor" and friends are not kinds.
  if (!Object.hasOwn(RECORD_CATALOG, q.kind))
    throw fail(400, "UNKNOWN_KIND", "This list is not available.");
  const statuses = recordStatuses(q.kind, q.status);
  const params: any[] = [q.kind];
  const where = ["kind=$1"];
  if (statuses) {
    params.push(statuses);
    where.push(`status=ANY($${params.length}::text[])`);
  }
  const own = followerRecords(a, params.length + 1);
  if (own) {
    params.push(a.userId);
    where.push(own);
  }
  return keysetPage(tx, {
    select: RECORD_COLUMNS,
    from: "records",
    where,
    params,
    key: recordKey(q.kind),
    descending: true,
    cursor: q.cursor,
    limit: q.limit ?? (RECORD_CATALOG[q.kind].page || 50),
  });
}
/** First page of every catalog kind in one statement. */
async function recordFirstPages(tx: Tx, a: Actor) {
  const kinds = RECORD_KINDS.filter((k) => RECORD_CATALOG[k].page > 0);
  const own = followerRecords(a, 5);
  // Each kind orders by its own key (recordKey), matching recordPage.
  const orderTs = "(CASE WHEN k.ord='updated' THEN updated_at ELSE created_at END)";
  const rows = await tx.query(
    `SELECT r.* FROM unnest($1::text[],$2::int[],$3::text[],$4::text[]) AS k(kind,lim,statuses,ord)
     CROSS JOIN LATERAL (
       SELECT ${RECORD_COLUMNS},${tsKey(orderTs)} AS "_k0",id::text AS "_k1" FROM records
       WHERE kind=k.kind AND (k.statuses IS NULL OR status=ANY(string_to_array(k.statuses,',')))${own ? " AND " + own : ""}
       ORDER BY ${orderTs} DESC,id DESC LIMIT k.lim+1
     ) r`,
    [
      kinds,
      kinds.map((k) => RECORD_CATALOG[k].page),
      kinds.map((k) => RECORD_CATALOG[k].statuses?.join(",") ?? null),
      kinds.map((k) => RECORD_CATALOG[k].order ?? "created"),
      ...(own ? [a.userId] : []),
    ],
  );
  const byKind = new Map<string, any[]>();
  for (const row of rows) {
    const list = byKind.get(row.kind) ?? [];
    list.push(row);
    byKind.set(row.kind, list);
  }
  const pages: Record<string, { hasMore: boolean; cursor: string | null }> = {};
  const records: any[] = [];
  for (const kind of kinds) {
    const page = finishPage(
      (byKind.get(kind) ?? []).sort(
        (a, b) =>
          (a._k0 < b._k0 ? 1 : a._k0 > b._k0 ? -1 : 0) ||
          (a._k1 < b._k1 ? 1 : a._k1 > b._k1 ? -1 : 0),
      ),
      RECORD_CATALOG[kind].page,
      2,
    );
    pages[kind] = { hasMore: page.hasMore, cursor: page.cursor };
    records.push(...page.items);
  }
  return { records, pages };
}

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && cursorPatterns.uuid.test(v);

/**
 * What an exception card shows besides the exception itself: the coaching
 * decision it quotes and, for the team, the names of the people it concerns.
 * Read in the caller's transaction, so row-level security scopes both; a
 * follower (who cannot list members) gets no names.
 */
async function exceptionContext(tx: Tx, a: Actor, exceptions: any[]) {
  const decisionIds = [
    ...new Set(exceptions.map((e) => e.data?.decisionId).filter(isUuid)),
  ];
  const decisions = decisionIds.length
    ? await tx.query(
        `SELECT ${RECORD_COLUMNS} FROM records WHERE kind='decision' AND id=ANY($1::uuid[])`,
        [decisionIds],
      )
    : [];
  if (a.role === "subscriber") return { decisions, members: null };
  const memberIds = [
    ...new Set(
      exceptions
        .flatMap((e) => [e.data?.subscriberId, e.owner_user_id])
        .filter(isUuid),
    ),
  ];
  const members = memberIds.length
    ? await tx.query(
        "SELECT u.id,u.name,u.email,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 AND u.id=ANY($2::uuid[])",
        [a.tenantId, memberIds],
      )
    : [];
  return { decisions, members };
}

// ---- members ---------------------------------------------------------------

const likePattern = (q: string) =>
  "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
const memberKey = [
  { sql: "u.name", cursorSql: "u.name", type: "text" as const },
  { sql: "u.id", cursorSql: "u.id::text", type: "uuid" as const },
];
export function memberPage(
  tx: Tx,
  a: Actor,
  q: {
    role?: "subscriber" | "team";
    /** Every term must appear in the name or email. */
    terms?: string[];
    userId?: string;
    cursor?: string;
    limit?: number;
    detail?: boolean;
  },
) {
  const team = q.role === "team";
  const params: any[] = [a.tenantId];
  const where = [
    "m.tenant_id=$1",
    team ? "m.role<>'subscriber'" : "m.role='subscriber'",
  ];
  if (q.userId) {
    params.push(q.userId);
    where.push(`u.id=$${params.length}::uuid`);
  }
  for (const term of q.terms ?? []) {
    params.push(likePattern(term));
    where.push(
      `(u.name ILIKE $${params.length} ESCAPE '\\' OR u.email ILIKE $${params.length} ESCAPE '\\')`,
    );
  }
  // Subscriber rows carry what the Subscribers screen shows, computed per row
  // under the same row-level security as the bootstrap lists they replace.
  const detail =
    q.detail && !team
      ? ",(SELECT s.status FROM subscriptions s WHERE s.user_id=u.id ORDER BY s.id LIMIT 1) AS subscription_status,EXISTS(SELECT 1 FROM complimentary_access g WHERE g.user_id=u.id AND g.closed_at IS NULL AND g.starts_at<=now() AND (g.ends_at IS NULL OR g.ends_at>now())) AS complimentary,(SELECT count(*)::int FROM records p WHERE p.kind='program' AND p.owner_user_id=u.id) AS programs"
      : "";
  return keysetPage(tx, {
    select: "u.id,u.name,u.email,m.role" + detail,
    from: "users u JOIN memberships m ON m.user_id=u.id",
    where,
    params,
    key: memberKey,
    descending: false,
    cursor: q.cursor,
    limit: q.limit ?? (team ? PAGE_SIZES.team : PAGE_SIZES.members),
  });
}

// ---- other collections -----------------------------------------------------

type Collection = {
  roles?: readonly string[];
  exceptRoles?: readonly string[];
  page: (tx: Tx, a: Actor, q: PageQuery) => Promise<Page>;
};
type PageQuery = {
  cursor?: string;
  limit?: number;
  kind?: string;
  status?: string;
  workoutId?: string;
  role?: "subscriber" | "team";
  terms?: string[];
  userId?: string;
};
const simple =
  (
    select: string,
    from: string,
    size: number,
    extra: (a: Actor) => { where: string[]; params: any[] } = () => ({
      where: [],
      params: [],
    }),
  ) =>
  (tx: Tx, a: Actor, q: PageQuery) => {
    const { where, params } = extra(a);
    return keysetPage(tx, {
      select,
      from,
      where,
      params,
      key: createdKey(),
      descending: true,
      cursor: q.cursor,
      limit: q.limit ?? size,
    });
  };
const FINANCE = ["owner", "finance"] as const;
/** Events of the platform's pricing of provider calls: operators only. */
const PLATFORM_EVENTS = [
  "finance.usage_reconciled",
  "finance.usage_corrected_after_charge",
  "finance.provider_usage_priced",
  "finance.usage_estimated",
];
/** Event data that shows a provider, a provider's cost or a conversion rate. */
const PLATFORM_ONLY_KEY =
  /usd$|cost|^provider$|^providerRequestId$|^model$|aedperusd|^invoiceReference$/i;
/** An event as the workspace sees it: without provider cost detail. */
export function trainerEvent(e: any) {
  if (!e?.data || typeof e.data !== "object" || Array.isArray(e.data)) return e;
  const keys = Object.keys(e.data);
  if (!keys.some((k) => PLATFORM_ONLY_KEY.test(k))) return e;
  return {
    ...e,
    data: Object.fromEntries(keys.filter((k) => !PLATFORM_ONLY_KEY.test(k)).map((k) => [k, e.data[k]])),
  };
}
export const COLLECTIONS: Record<string, Collection> = {
  records: {
    page: async (tx, a, q) => {
      const page = await recordPage(tx, a, {
        kind: q.kind ?? "",
        status: q.status,
        cursor: q.cursor,
        limit: q.limit,
      });
      if (q.kind !== "exception") return page;
      // An older page of the attention list carries its decisions and names,
      // so the cards need no request each (the rate limit is per user).
      const context = await exceptionContext(tx, a, page.items);
      return {
        ...page,
        related: {
          records: context.decisions,
          ...(context.members ? { members: context.members } : {}),
        },
      };
    },
  },
  sets: {
    page: (tx, a, q) => {
      const where: string[] = [],
        params: any[] = [];
      if (q.workoutId) {
        params.push(q.workoutId);
        where.push(`workout_id=$${params.length}::uuid`);
      }
      const own = followerRows(a, "user_id", params.length + 1);
      if (own) {
        params.push(a.userId);
        where.push(own);
      }
      return keysetPage(tx, {
        select: "*",
        from: "workout_events",
        where,
        params,
        key: createdKey(),
        descending: true,
        cursor: q.cursor,
        limit: q.limit ?? PAGE_SIZES.sets,
      });
    },
  },
  members: {
    exceptRoles: ["subscriber"],
    page: (tx, a, q) =>
      memberPage(tx, a, {
        role: q.role,
        terms: q.terms,
        userId: q.userId,
        cursor: q.cursor,
        limit: q.limit,
        detail: true,
      }),
  },
  subscriptions: {
    page: (tx, a, q) =>
      keysetPage(tx, {
        select: "*",
        from: "subscriptions",
        where: a.role === "subscriber" ? ["user_id=$1"] : [],
        params: a.role === "subscriber" ? [a.userId] : [],
        key: [{ sql: "id", cursorSql: "id::text", type: "uuid" }],
        descending: false,
        cursor: q.cursor,
        limit: q.limit ?? PAGE_SIZES.subscriptions,
      }),
  },
  complimentary: {
    page: simple(
      "id,user_id,tier,starts_at,ends_at",
      "complimentary_access",
      PAGE_SIZES.complimentary,
      (a) => ({
        where: [
          "closed_at IS NULL",
          "starts_at<=now()",
          "(ends_at IS NULL OR ends_at>now())",
          ...(a.role === "subscriber" ? ["user_id=$1"] : []),
        ],
        params: a.role === "subscriber" ? [a.userId] : [],
      }),
    ),
  },
  consents: {
    page: simple("*", "consent_records", PAGE_SIZES.consents, (a) => ({
      where: ["user_id=$1"],
      params: [a.userId],
    })),
  },
  events: {
    exceptRoles: ["subscriber"],
    // Provider cost is platform data (owner decision, 28 September 2026):
    // the platform's own pricing and reconciliation events are not listed to
    // the workspace, and cost, provider and rate figures are removed from the
    // others (trainerEvent).
    page: async (tx, a, q) => {
      const page = await simple("*", "events", PAGE_SIZES.events, () => ({
        where: ["name<>ALL(ARRAY['" + PLATFORM_EVENTS.join("','") + "'])"],
        params: [],
      }))(tx, a, q);
      return { ...page, items: page.items.map(trainerEvent) };
    },
  },
  costs: {
    roles: FINANCE,
    // Provider cost is platform data (owner decision, 28 September 2026):
    // trainers see usage only as the monthly "AI Coach Service Fee", so the
    // workspace list carries what ran and when, never a cost or provider.
    page: simple(
      "id,task,status,created_at",
      "cost_events",
      PAGE_SIZES.costs,
    ),
  },
  journals: {
    roles: FINANCE,
    // The registrar's cost of a trainer's domain is the platform's own
    // figure: never listed to the workspace (operators see it elsewhere).
    // The AI Coach Service Fee is listed by its name and amount only.
    page: async (tx, a, q) => {
      const page = await simple("*", "journals", PAGE_SIZES.journals, () => ({
        where: ["source_key NOT LIKE 'web-address-registrar:%'"],
        params: [],
      }))(tx, a, q);
      return { ...page, items: page.items.map(trainerEntry) };
    },
  },
  payouts: {
    roles: FINANCE,
    page: simple("*", "payouts", PAGE_SIZES.payouts),
  },
  usageStatements: {
    roles: FINANCE,
    page: (tx, _a, q) =>
      keysetPage(tx, {
        // One line per month: the AI Coach Service Fee and its amount, with
        // any later adjustment of that month's fee.
        select:
          "period,charge_minor,(SELECT coalesce(sum((j.data->>'differenceMinor')::bigint),0) FROM journals j WHERE j.source_key LIKE 'usage-adjustment:'||usage_statements.period||':%')::text AS adjustments_minor",
        from: "usage_statements",
        key: [{ sql: "period", cursorSql: "period", type: "text" }],
        descending: true,
        cursor: q.cursor,
        limit: q.limit ?? PAGE_SIZES.usageStatements,
      }),
  },
};
export function collectionAllowed(name: string, role: string) {
  if (!Object.hasOwn(COLLECTIONS, name)) return false;
  const c = COLLECTIONS[name];
  if (c.roles && !c.roles.includes(role)) return false;
  if (c.exceptRoles?.includes(role)) return false;
  return true;
}

// ---- bootstrap -------------------------------------------------------------

const pageInfo = (p: Page) => ({ hasMore: p.hasMore, cursor: p.cursor });

async function recordTotals(tx: Tx, a: Actor) {
  const own = followerRecords(a, 2);
  const rows = await tx.query(
    `SELECT kind,count(*)::int AS n,count(*) FILTER(WHERE status='open')::int AS open,count(*) FILTER(WHERE status='confirmed')::int AS confirmed,count(*) FILTER(WHERE status='completed')::int AS completed FROM records WHERE kind=ANY($1::text[])${own ? " AND " + own : ""} GROUP BY kind`,
    [RECORD_KINDS, ...(own ? [a.userId] : [])],
  );
  const of = (kind: string) => rows.find((r) => r.kind === kind);
  return {
    records: Object.fromEntries(RECORD_KINDS.map((k) => [k, of(k)?.n ?? 0])),
    openExceptions: of("exception")?.open ?? 0,
    openConflicts: of("conflict")?.open ?? 0,
    confirmedRules: of("rule")?.confirmed ?? 0,
    completedWorkouts: of("workout")?.completed ?? 0,
  };
}

/**
 * The bounded collections of `GET /api/v1/bootstrap`: the same keys and row
 * shapes as before, each capped, plus `pages` and `totals`.
 */
export async function bootstrapCollections(
  tx: Tx,
  a: Actor,
): Promise<{ records: any[]; [collection: string]: any }> {
  const first = await recordFirstPages(tx, a);
  const records = first.records;
  const seen = new Set(records.map((r) => r.id));
  const pin = (rows: any[]) => {
    for (const row of rows)
      if (!seen.has(row.id)) {
        seen.add(row.id);
        records.push(row);
      }
  };
  // The oldest open safety and personal-review items, however many newer
  // exceptions fill the first page (the attention list is the team's).
  if (a.role !== "subscriber")
    pin(
      await tx.query(
        `SELECT ${RECORD_COLUMNS} FROM records WHERE kind='exception' AND status='open' AND data->>'category'=ANY($1::text[]) ORDER BY created_at,id LIMIT ${PINNED_URGENT_EXCEPTIONS}`,
        [URGENT_EXCEPTION_CATEGORIES],
      ),
    );
  const openExceptions = records.filter(
    (r) => r.kind === "exception" && r.status === "open",
  );
  // Their decisions (quoted on the card) and the people they concern.
  const context = await exceptionContext(tx, a, openExceptions);
  pin(context.decisions);
  // Confirmed rules feed the scenario form and release readiness, however
  // many drafts are newer.
  pin(
    await tx.query(
      `SELECT ${RECORD_COLUMNS} FROM records WHERE kind='rule' AND status='confirmed' ORDER BY created_at DESC,id DESC LIMIT ${PINNED_CONFIRMED_RULES}`,
    ),
  );
  let activeWorkoutIds: string[] = [];
  if (a.role === "subscriber") {
    const active = await tx.query(
      `SELECT ${RECORD_COLUMNS} FROM records WHERE kind='workout' AND status='active' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT ${PINNED_ACTIVE_WORKOUTS}`,
      [a.userId],
    );
    pin(active);
    activeWorkoutIds = active.map((w) => w.id);
  }
  // The previous response ordered all records by their latest change.
  records.sort((x, y) => +new Date(y.updated_at) - +new Date(x.updated_at));

  const sets = await COLLECTIONS.sets.page(tx, a, {});
  if (activeWorkoutIds.length) {
    const known = new Set(sets.items.map((s) => s.id));
    const pinned = await tx.query(
      `SELECT * FROM workout_events WHERE workout_id=ANY($1::uuid[]) AND user_id=$2 ORDER BY created_at DESC,id DESC LIMIT ${PINNED_ACTIVE_SETS}`,
      [activeWorkoutIds, a.userId],
    );
    sets.items.push(...pinned.filter((s) => !known.has(s.id)));
  }
  const subscriptions = await COLLECTIONS.subscriptions.page(tx, a, {});
  const complimentary = await COLLECTIONS.complimentary.page(tx, a, {});
  const consents = await COLLECTIONS.consents.page(tx, a, {});
  const ownSets = followerRows(a, "user_id", 1),
    ownParams = ownSets ? [a.userId] : [];
  const [setTotals] = await tx.query(
    `SELECT count(*)::int AS n,coalesce(sum(CASE WHEN jsonb_typeof(data->'reps')='number' AND jsonb_typeof(data->'loadKg')='number' THEN (data->>'reps')::numeric*(data->>'loadKg')::numeric END),0)::float8 AS volume FROM workout_events${ownSets ? " WHERE " + ownSets : ""}`,
    ownParams,
  );
  const [subscriptionTotals] = await tx.query(
    `SELECT count(*)::int AS n,count(*) FILTER(WHERE status='active')::int AS active FROM subscriptions${ownSets ? " WHERE " + ownSets : ""}`,
    ownParams,
  );
  const totals: Record<string, any> = {
    ...(await recordTotals(tx, a)),
    sets: setTotals.n,
    setVolumeKg: Number(setTotals.volume),
    subscriptions: subscriptionTotals.n,
    activeSubscriptions: subscriptionTotals.active,
  };
  const pages: Record<string, any> = {
    records: first.pages,
    sets: pageInfo(sets),
    subscriptions: pageInfo(subscriptions),
    complimentary: pageInfo(complimentary),
    consents: pageInfo(consents),
  };
  const result: Record<string, any> = {
    records,
    sets: sets.items,
    subscriptions: subscriptions.items,
    complimentary: complimentary.items,
    consents: consents.items,
  };
  if (a.role !== "subscriber") {
    const team = await memberPage(tx, a, { role: "team" });
    const subscribers = await memberPage(tx, a, { role: "subscriber" });
    const listed = new Set(
      [...team.items, ...subscribers.items].map((m) => m.id),
    );
    // Names for the people on the included attention list.
    const extra = (context.members ?? []).filter((m) => !listed.has(m.id));
    result.members = [...team.items, ...subscribers.items, ...extra].sort(
      (x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0),
    );
    pages.members = pageInfo(subscribers);
    pages.team = pageInfo(team);
    const [memberTotals] = await tx.query(
      "SELECT count(*) FILTER(WHERE role='subscriber')::int AS subscribers,count(*)::int AS members FROM memberships WHERE tenant_id=$1",
      [a.tenantId],
    );
    totals.subscribers = memberTotals.subscribers;
    totals.members = memberTotals.members;
    const events = await COLLECTIONS.events.page(tx, a, {});
    result.events = events.items;
    pages.events = pageInfo(events);
    if (collectionAllowed("costs", a.role)) {
      for (const name of [
        "costs",
        "payouts",
        "journals",
        "usageStatements",
      ] as const) {
        const page = await COLLECTIONS[name].page(tx, a, {});
        result[name] = page.items;
        pages[name] = pageInfo(page);
      }
      result.finance = await financeSummary(tx);
    }
  }
  return { ...result, records, pages, totals };
}

// ---- routes ----------------------------------------------------------------

const uuid = z.string().uuid();
const pageQuery = z
  .object({
    cursor: z.string().max(1000).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
    kind: z.string().max(40).optional(),
    status: z
      .string()
      .regex(/^[a-z_]{1,40}$/)
      .optional(),
    workoutId: uuid.optional(),
    role: z.enum(["subscriber", "team"]).optional(),
    // Search terms. Clients send each word as its own `q` value: a space
    // inside a proxied query value does not survive the web proxy's signed
    // host proof (see docs/features/bounded-bootstrap.md).
    q: z
      .union([z.string().max(100), z.array(z.string().max(100)).max(5)])
      .optional(),
    userId: uuid.optional(),
  })
  .strict();

/** Words of the search, at most five. */
export function searchTerms(q: string | string[] | undefined) {
  return (Array.isArray(q) ? q : q ? [q] : [])
    .flatMap((value) => value.split(/\s+/))
    .filter(Boolean)
    .slice(0, 5);
}

export function registerWorkspacePages(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Identity,
) {
  app.get("/api/v1/workspace/pages/:collection", async (req) => {
    const a = identity(req);
    const name = String((req.params as any).collection);
    if (!Object.hasOwn(COLLECTIONS, name))
      throw fail(404, "NOT_FOUND", "This list is not available.");
    if (!collectionAllowed(name, a.role))
      throw fail(403, "ROLE_REQUIRED", "Your role cannot open this list.");
    const q = pageQuery.parse(req.query);
    if (name === "records" && !q.kind)
      throw fail(400, "KIND_REQUIRED", "Choose which records to list.");
    return db.tenant(a, (tx) =>
      COLLECTIONS[name].page(tx, a, { ...q, terms: searchTerms(q.q) }),
    );
  });
  app.get("/api/v1/workspace/records/:id", async (req) => {
    const a = identity(req);
    const recordId = uuid.parse((req.params as any).id);
    const [row] = await db.tenant(a, (tx) =>
      tx.query(
        `SELECT ${RECORD_COLUMNS} FROM records WHERE id=$1 AND kind=ANY($2::text[])`,
        [recordId, RECORD_KINDS],
      ),
    );
    if (!row) throw fail(404, "NOT_FOUND", "This item is unavailable");
    return row;
  });
}
