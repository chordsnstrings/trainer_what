import type { Actor, Database, Tx } from "@trainer/db";
import {
  encryptionKeyring,
  openSealedValue,
  sealContexts,
  sealValue,
  SealingUnavailable,
  type SealContext,
  type SealedState,
} from "./sealing.ts";

type Counts = Record<SealedState | "resealed", number>;
export type SealedValueReport = Record<
  | "platformSettings"
  | "authenticators"
  | "wearableConnections"
  | "wearableAuthorizations"
  | "pushSubscriptions",
  Counts
>;
type Column = {
  category: keyof SealedValueReport;
  table: string;
  key: string;
  keyType: "uuid" | "text";
  column: string;
  fields: string;
  context: (row: Record<string, any>) => SealContext;
};

const pageSize = 100;
const accountColumns: Column[] = ["totp_secret", "pending_secret"].map(
  (column) => ({
    category: "authenticators",
    table: "user_security",
    key: "user_id",
    keyType: "uuid",
    column,
    fields: "user_id",
    context: (row) => sealContexts.authenticator(row.user_id),
  }),
);
const wearableScope = (row: Record<string, any>) =>
  sealContexts.integration(
    [row.tenant_id, row.user_id, row.provider].join(":"),
  );
const tenantColumns: Column[] = [
  {
    category: "wearableConnections",
    table: "integration_connections",
    key: "id",
    keyType: "uuid",
    column: "credentials",
    fields: "id,tenant_id,user_id,provider",
    context: wearableScope,
  },
  {
    category: "wearableAuthorizations",
    table: "integration_oauth_states",
    key: "state_hash",
    keyType: "text",
    column: "verifier",
    fields: "state_hash,tenant_id,user_id,provider",
    context: wearableScope,
  },
  {
    category: "pushSubscriptions",
    table: "push_subscriptions",
    key: "id",
    keyType: "uuid",
    column: "encrypted_endpoint",
    fields: "id,tenant_id,user_id",
    context: (row) =>
      sealContexts.integration(
        `push:${row.tenant_id}:${row.user_id}:${row.id}`,
      ),
  },
];
// Scoped owner transactions, as workers use: the runtime role never bypasses RLS.
const rotationActor = (tenantId: string): Actor => ({
  tenantId,
  userId: "00000000-0000-0000-0000-000000000000",
  role: "owner",
});

export function sealedTotals(report: SealedValueReport): Counts {
  const total: Counts = {
    active: 0,
    legacy: 0,
    previous: 0,
    unreadable: 0,
    resealed: 0,
  };
  for (const counts of Object.values(report))
    for (const state of Object.keys(total) as (keyof Counts)[])
      total[state] += counts[state];
  return total;
}

/**
 * Inspects every value sealed with the host key, or with `apply` re-seals each
 * readable value that is not already a current active-key envelope. Values are
 * only re-wrapped: revisions, versions and test results do not change. Each
 * page is locked and rewritten in its own transaction, so a repeat run is a
 * no-op. The result contains counts only, never values.
 */
export async function resealSecrets(
  db: Database,
  options: { apply: boolean },
): Promise<SealedValueReport> {
  const ring = encryptionKeyring();
  if (!ring.active) throw new SealingUnavailable("key_unavailable");
  if (options.apply && ring.invalidPrevious)
    throw new Error(
      "Each SECURITY_ENCRYPTION_PREVIOUS_KEYS entry must decode to 32 bytes before re-sealing",
    );
  const report = Object.fromEntries(
    [
      "platformSettings",
      "authenticators",
      "wearableConnections",
      "wearableAuthorizations",
      "pushSubscriptions",
    ].map((category) => [
      category,
      { active: 0, legacy: 0, previous: 0, unreadable: 0, resealed: 0 },
    ]),
  ) as SealedValueReport;
  const lock = options.apply ? " FOR UPDATE" : "";
  /** Returns the replacement envelope when this value must be rewritten. */
  const visit = (counts: Counts, context: SealContext, value: string) => {
    let opened: ReturnType<typeof openSealedValue>;
    try {
      opened = openSealedValue(context, value);
    } catch {
      counts.unreadable++;
      return null;
    }
    counts[opened.state]++;
    return options.apply && opened.state !== "active"
      ? sealValue(context, opened.value)
      : null;
  };

  await db.system(async (tx) => {
    const rows = await tx.query<{
      integration_id: string;
      encrypted_secrets: Record<string, string>;
    }>(
      "SELECT integration_id,encrypted_secrets FROM platform_settings ORDER BY integration_id" +
        lock,
    );
    for (const row of rows) {
      const next = { ...row.encrypted_secrets };
      let changed = 0;
      for (const [field, value] of Object.entries(row.encrypted_secrets)) {
        if (!value) continue;
        const sealed = visit(
          report.platformSettings,
          sealContexts.platformSetting(row.integration_id, field),
          value,
        );
        if (sealed) {
          next[field] = sealed;
          changed++;
        }
      }
      if (!changed) continue;
      await tx.query(
        "UPDATE platform_settings SET encrypted_secrets=$2 WHERE integration_id=$1",
        [row.integration_id, JSON.stringify(next)],
      );
      report.platformSettings.resealed += changed;
    }
  });

  const pass = async (
    run: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
    spec: Column,
  ) => {
    let after: string | null = null;
    for (;;) {
      const page: { last: string | null; size: number } = await run(
        async (tx) => {
          const rows = await tx.query(
            `SELECT ${spec.fields},${spec.column} AS sealed FROM ${spec.table} WHERE ${spec.column} IS NOT NULL AND ${spec.column}<>'' AND ($1::${spec.keyType} IS NULL OR ${spec.key}>$1::${spec.keyType}) ORDER BY ${spec.key} LIMIT ${pageSize}${lock}`,
            [after],
          );
          for (const row of rows) {
            const sealed = visit(
              report[spec.category],
              spec.context(row),
              row.sealed,
            );
            if (!sealed) continue;
            const updated = await tx.query(
              `UPDATE ${spec.table} SET ${spec.column}=$2 WHERE ${spec.key}=$1 AND ${spec.column}=$3 RETURNING ${spec.key}`,
              [row[spec.key], sealed, row.sealed],
            );
            report[spec.category].resealed += updated.length;
          }
          return {
            last: rows.length ? String(rows[rows.length - 1][spec.key]) : null,
            size: rows.length,
          };
        },
      );
      if (page.size < pageSize) return;
      after = page.last;
    }
  };

  for (const spec of accountColumns) await pass((fn) => db.system(fn), spec);
  const tenants = await db.system((tx) =>
    tx.query<{ id: string }>("SELECT id FROM tenants ORDER BY id"),
  );
  for (const tenant of tenants)
    for (const spec of tenantColumns)
      await pass((fn) => db.tenant(rotationActor(tenant.id), fn), spec);
  return report;
}
