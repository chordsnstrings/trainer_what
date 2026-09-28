/**
 * Tenant-scope rules for the database layer.
 *
 * Every tenant transaction runs as `trainer_app` with `app.tenant_id`,
 * `app.user_id`, `app.role` (and `app.elevation`) set by this package before
 * `SET LOCAL ROLE`. Three things keep that scope fixed for the rest of the
 * transaction:
 *
 * 1. `set_config` is revoked from PUBLIC (and so from `trainer_app`) by
 *    migration 061 on a fresh database and by infra/tenant-scope.sql on an
 *    upgraded one: no statement in a tenant scope can change `role` or any
 *    `app.*` setting.
 * 2. Tenant-scoped statements use the extended query protocol, so one call is
 *    one statement and a value that reaches SQL text cannot append a utility
 *    statement such as `RESET ROLE`.
 * 3. {@link assertScopedSql} rejects everything except ordinary data statements
 *    before they reach the database (and any `set_config`, `pg_settings` or
 *    Unicode-escaped spelling), and {@link assertServiceSql} keeps service
 *    transactions from hand-rolling a tenant scope. This guard does not depend
 *    on the database revocation having been applied yet.
 *
 * Who may be scoped as what is decided by {@link scopeDecision}: a member acts
 * with its own role (an owner may also act as staff, finance or subscriber);
 * anything else needs an allowlisted {@link ELEVATIONS} reason, and an elevated
 * scope never carries a follower's user id. A user without a membership may be
 * scoped as a subscriber of its own rows only (a former member's account and
 * exit paths): the database admits workspace material and the member-facing
 * definer helpers to a subscriber scope only with a current membership.
 */

/** The user id recorded for service work that has no human actor. */
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * The only elevations that remain. Each is a service identity, never a
 * follower request: the db layer refuses an elevated scope whose user id is a
 * follower (subscriber member) of the workspace. `usedBy` documents the call
 * sites; tests/isolation-elevation.test.ts fails when code adds an elevation
 * that is not listed here or uses one from an undocumented file.
 */
export const ELEVATIONS = {
  worker: {
    roles: ["owner", "staff", "finance"],
    purpose:
      "Background jobs, scheduled sweeps and outbox delivery run by the worker (or its sweep endpoints) for a workspace, with no follower request in the call path.",
    usedBy: [
      "apps/api/src/brain-plans.ts",
      "apps/api/src/chat-attachments.ts",
      "apps/api/src/coaching-followups.ts",
      "apps/api/src/complimentary-access.ts",
      "apps/api/src/finance-automation.ts",
      "apps/api/src/healthkit-sync.ts",
      "apps/api/src/infrastructure-observer.ts",
      "apps/api/src/integrations-completion.ts",
      "apps/api/src/key-rotation.ts",
      "apps/api/src/notifications.ts",
      "apps/api/src/nutrition-schedule.ts",
      "apps/api/src/platform-alerts.ts",
      "apps/api/src/platform-costs.ts",
      "apps/api/src/platform-pnl.ts",
      "apps/api/src/programme-today.ts",
      "apps/api/src/safety-policy.ts",
      "apps/api/src/voice-clones.ts",
      "apps/api/src/voice-session.ts",
      "apps/api/src/web-address-orders.ts",
      "apps/worker/src/dispatch.ts",
      "apps/worker/src/email-delivery.ts",
      "apps/worker/src/push-delivery.ts",
    ],
  },
  "provider-callback": {
    roles: ["owner", "finance"],
    purpose:
      "Signed payment-provider webhooks, authenticated provider reconciliation and the ledger reads that follow a verified payment, which carry no session.",
    usedBy: [
      "apps/api/src/acquisition.ts",
      "apps/api/src/finance-bookings.ts",
      "apps/api/src/finance-checkout.ts",
      "apps/api/src/programme-billing.ts",
      "apps/api/src/stripe-events.ts",
      "apps/api/src/voice-addon.ts",
      "apps/api/src/web-address-orders.ts",
      "apps/api/src/web-addresses.ts",
    ],
  },
  "platform-operator": {
    roles: ["owner", "staff", "finance"],
    purpose:
      "Super admin and platform operator routes acting in a workspace after the platform-role, step-up and reason checks of that route.",
    usedBy: [
      "apps/api/src/admin-operations.ts",
      "apps/api/src/affiliates.ts",
      "apps/api/src/app.ts",
      "apps/api/src/business-metrics.ts",
      "apps/api/src/complimentary-access.ts",
      "apps/api/src/finance-automation.ts",
      "apps/api/src/finance-billing.ts",
      "apps/api/src/finance-completion.ts",
      "apps/api/src/finance-operations.ts",
      "apps/api/src/governance.ts",
      "apps/api/src/integrations-completion.ts",
      "apps/api/src/platform-finance.ts",
      "apps/api/src/platform-pnl.ts",
      "apps/api/src/privacy-lifecycle.ts",
      "apps/api/src/privacy-operations.ts",
      "apps/api/src/support-preview.ts",
      "apps/api/src/voice-clones.ts",
      "apps/api/src/web-addresses.ts",
    ],
  },
  "coach-workflow": {
    roles: ["owner"],
    purpose:
      "A staff or finance member's coaching-team action that row security reserves for the owner role (booking payment settlement, nutrition catalog and plan work, guided sessions). Applied only through actingAs(), which never elevates a follower.",
    usedBy: [
      "apps/api/src/finance-bookings.ts",
      "apps/api/src/integrations-completion.ts",
      "apps/api/src/meal-capture.ts",
      "apps/api/src/nutrition-completion.ts",
      "apps/api/src/nutrition.ts",
    ],
  },
  "member-self-service": {
    roles: ["owner"],
    purpose:
      "A staff or finance member's own personal-data export, which keeps the owner-level view of every row about that member. Applied only through actingAs(): a follower's export runs in its own subscriber scope with the personal_export_* helpers.",
    usedBy: ["apps/api/src/privacy-lifecycle.ts"],
  },
} as const satisfies Record<
  string,
  { roles: readonly string[]; purpose: string; usedBy: readonly string[] }
>;
export type Elevation = keyof typeof ELEVATIONS;

/** Roles a verified member may act with. Anyone else may act only as a subscriber of their own rows. */
const MEMBER_MAY_ACT_AS: Record<string, readonly string[]> = {
  owner: ["owner", "staff", "finance", "subscriber"],
  staff: ["staff", "subscriber"],
  finance: ["finance", "subscriber"],
  subscriber: ["subscriber"],
};
const TENANT_ROLES = new Set(["owner", "staff", "finance", "subscriber"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ScopeError extends Error {
  statusCode: number;
  code: string;
  constructor(code: string, message: string, statusCode = 403) {
    super(message);
    this.name = "ScopeError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function assertActorShape(actor: {
  tenantId: string;
  userId: string;
  role: string;
  elevation?: string;
}) {
  if (!UUID.test(String(actor.tenantId)) || !UUID.test(String(actor.userId)))
    throw new ScopeError(
      "INVALID_ACTOR",
      "Tenant scope needs a workspace id and user id",
      500,
    );
  if (!TENANT_ROLES.has(actor.role))
    throw new ScopeError(
      "INVALID_ACTOR",
      `Unknown tenant role ${JSON.stringify(actor.role)}`,
      500,
    );
  if (actor.elevation !== undefined && !(actor.elevation in ELEVATIONS))
    throw new ScopeError(
      "ELEVATION_NOT_ALLOWED",
      `Elevation ${JSON.stringify(actor.elevation)} is not in the allowlist`,
      500,
    );
}

/**
 * Decides whether an actor may be scoped, given its membership role in the
 * workspace (null when it has none). Throws a ScopeError when refused.
 */
export function scopeDecision(
  actor: { role: string; elevation?: string },
  memberRole: string | null,
) {
  if (actor.elevation !== undefined) {
    const rule = ELEVATIONS[actor.elevation as Elevation];
    if (!rule || !(rule.roles as readonly string[]).includes(actor.role))
      throw new ScopeError(
        "ELEVATION_NOT_ALLOWED",
        `Elevation ${actor.elevation} may not act as ${actor.role}`,
        500,
      );
    if (memberRole === "subscriber")
      throw new ScopeError(
        "ELEVATION_SUBJECT",
        "A follower's identity cannot run an elevated transaction",
        500,
      );
    return;
  }
  const allowed = memberRole ? MEMBER_MAY_ACT_AS[memberRole] : ["subscriber"];
  if (!allowed?.includes(actor.role))
    throw new ScopeError(
      "ACTOR_ROLE_MISMATCH",
      `A ${memberRole ?? "non-member"} cannot act as ${actor.role} in this workspace`,
    );
}

// ---------------------------------------------------------------------------
// SQL guard

type Token = {
  t: "word" | "ident" | "string" | "punct" | "other";
  v: string;
  /** The value is not what the database reads: U& escapes or E'' backslash escapes. */
  escaped?: boolean;
  /** A U&"..." identifier or U&'...' string. */
  unicode?: boolean;
};

/** Minimal PostgreSQL lexer: words, quoted identifiers, strings and punctuation; comments dropped. */
export function sqlTokens(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      let depth = 0;
      while (i < n) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
          if (!depth) break;
        } else i++;
      }
      continue;
    }
    if (c === "'" || ((c === "E" || c === "e") && sql[i + 1] === "'")) {
      const escapes = c !== "'";
      i += escapes ? 2 : 1;
      let v = "",
        escaped = false;
      while (i < n) {
        if (escapes && sql[i] === "\\") {
          v += sql.slice(i, i + 2);
          escaped = true;
          i += 2;
        } else if (sql[i] === "'" && sql[i + 1] === "'") {
          v += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else v += sql[i++];
      }
      out.push({ t: "string", v, ...(escaped ? { escaped } : {}) });
      continue;
    }
    const unicode =
      (c === "U" || c === "u") &&
      sql[i + 1] === "&" &&
      (sql[i + 2] === '"' || sql[i + 2] === "'");
    if (c === '"' || unicode) {
      // U&"..." / U&'...' escapes are kept undecoded and marked: both guards
      // refuse them, so no name they spell (set_config, a reserved setting)
      // can pass as something else.
      if (unicode) i += 2;
      const quote = sql[i];
      i++;
      let v = "";
      while (i < n) {
        if (sql[i] === quote && sql[i + 1] === quote) {
          v += quote;
          i += 2;
        } else if (sql[i] === quote) {
          i++;
          break;
        } else v += sql[i++];
      }
      out.push({
        t: quote === '"' ? "ident" : "string",
        v,
        ...(unicode ? { escaped: true, unicode: true } : {}),
      });
      continue;
    }
    if (c === "$") {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end < 0 ? n : end;
        out.push({ t: "string", v: sql.slice(i + tag[0].length, stop) });
        i = end < 0 ? n : end + tag[0].length;
        continue;
      }
      const param = /^\$\d+/.exec(sql.slice(i));
      out.push({ t: "other", v: param ? param[0] : "$" });
      i += param ? param[0].length : 1;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i));
    if (word) {
      out.push({ t: "word", v: word[0].toLowerCase() });
      i += word[0].length;
      continue;
    }
    out.push({ t: "punct", v: c });
    i++;
  }
  return out;
}

function statements(tokens: Token[]) {
  const list: Token[][] = [[]];
  for (const token of tokens)
    if (token.t === "punct" && token.v === ";") list.push([]);
    else list[list.length - 1].push(token);
  return list
    .map((s) => {
      let k = 0;
      while (k < s.length && s[k].t === "punct" && s[k].v === "(") k++;
      return s.slice(k);
    })
    .filter((s) => s.length);
}
const name = (token?: Token) =>
  token && (token.t === "word" || token.t === "ident") ? token.v : "";

/** Settings that only this package may change: the scope itself. */
const RESERVED_SETTINGS = new Set([
  "role",
  "session_authorization",
  "app.tenant_id",
  "app.user_id",
  "app.role",
  "app.elevation",
  "app.service_tenant_id",
]);
const HARMLESS_LOCAL_SETTINGS = new Set([
  "statement_timeout",
  "lock_timeout",
  "idle_in_transaction_session_timeout",
]);
/** Data statements a tenant scope may run. */
const TENANT_STATEMENTS = new Set([
  "select",
  "with",
  "insert",
  "update",
  "delete",
  "merge",
  "values",
  "table",
  "explain",
  "lock",
]);

function reject(code: string, sql: string, why: string): never {
  throw new ScopeError(
    code,
    `${why}: ${sql.replace(/\s+/g, " ").trim().slice(0, 120)}`,
    500,
  );
}

/**
 * set_config calls in a statement, with the setting name when it is one plain
 * string literal argument, else null (an expression, a parameter or an
 * escaped string is never trusted to be what it looks like).
 */
function setConfigTargets(tokens: Token[]) {
  const targets: Array<string | null> = [];
  tokens.forEach((token, index) => {
    if (name(token) !== "set_config") return;
    const open = tokens[index + 1];
    if (!open || open.v !== "(") return targets.push(null);
    const first = tokens[index + 2];
    targets.push(
      first?.t === "string" && !first.escaped && tokens[index + 3]?.v === ","
        ? first.v.toLowerCase()
        : null,
    );
  });
  return targets;
}
/**
 * Spellings neither guard accepts in any statement: Unicode-escaped
 * identifiers and strings (U&"\0073et_config"), and pg_settings, whose
 * UPDATE calls set_config.
 */
function assertPlainSpelling(tokens: Token[], sql: string) {
  if (tokens.some((token) => token.unicode))
    reject(
      "SCOPE_SQL_REJECTED",
      sql,
      "Unicode-escaped identifiers and strings are refused",
    );
  if (tokens.some((token) => name(token) === "pg_settings"))
    reject("SCOPE_SQL_REJECTED", sql, "pg_settings is not available here");
}

/**
 * Statement check for a tenant scope. `savepoints` is true only for a
 * transaction that was scoped at BEGIN (db.tenant): a savepoint there can
 * never predate the scope, so rolling back to it cannot undo the scope.
 */
export function assertScopedSql(sql: string, savepoints: boolean) {
  const tokens = sqlTokens(sql);
  assertPlainSpelling(tokens, sql);
  const list = statements(tokens);
  if (list.length > 1)
    reject("SCOPE_SQL_REJECTED", sql, "One statement per tenant-scoped call");
  if (setConfigTargets(tokens).length)
    reject(
      "SCOPE_SQL_REJECTED",
      sql,
      "set_config is not available in a tenant scope",
    );
  const statement = list[0] ?? [];
  const [first, second, third] = statement.map(name);
  if (TENANT_STATEMENTS.has(first)) return;
  if (savepoints && (first === "savepoint" || first === "release")) return;
  if (savepoints && first === "rollback" && second === "to") return;
  if (
    first === "set" &&
    second === "local" &&
    HARMLESS_LOCAL_SETTINGS.has(third)
  )
    return;
  reject(
    "SCOPE_SQL_REJECTED",
    sql,
    "Tenant transactions may not change role, settings or transaction state",
  );
}

/**
 * Statement check for a service (system) transaction: it may do service work,
 * but it may not build a tenant scope by hand or end the transaction; the db
 * package's tx.tenant() is the only way into a tenant scope.
 */
export function assertServiceSql(sql: string) {
  const tokens = sqlTokens(sql);
  assertPlainSpelling(tokens, sql);
  for (const statement of statements(tokens)) {
    const words = statement.map(name);
    const [first, second] = words;
    // A privilege statement names set_config without calling it.
    if (!["grant", "revoke"].includes(first))
      for (const target of setConfigTargets(statement))
        if (target === null || RESERVED_SETTINGS.has(target))
          reject(
            "SCOPE_SQL_REJECTED",
            sql,
            "Use tx.tenant() to enter a tenant scope; scope settings are reserved",
          );
    if (
      ["begin", "start", "commit", "end", "abort", "discard", "do"].includes(
        first,
      ) ||
      (first === "rollback" && second !== "to") ||
      (first === "prepare" && second === "transaction")
    )
      reject(
        "SCOPE_SQL_REJECTED",
        sql,
        "The db package owns transaction boundaries",
      );
    if (first === "set" || first === "reset") {
      let k = 1;
      if (["local", "session"].includes(words[k])) k++;
      const target = words[k];
      if (["all", "session", "authorization"].includes(target))
        reject("SCOPE_SQL_REJECTED", sql, "Reserved setting");
      if (target === "role") {
        // Tests may switch a service transaction to a non-bypassing fixture
        // role; only the tenant role itself is reserved.
        let r = k + 1;
        while (words[r] === "to" || statement[r]?.v === "=") r++;
        if (first === "reset" || words[r] === "trainer_app")
          reject(
            "SCOPE_SQL_REJECTED",
            sql,
            "Use tx.tenant() to enter a tenant scope",
          );
        continue;
      }
      const dotted =
        target && statement[k + 1]?.v === "."
          ? `${target}.${words[k + 2]}`
          : target;
      if (RESERVED_SETTINGS.has(dotted))
        reject("SCOPE_SQL_REJECTED", sql, "Reserved setting");
    }
  }
}
