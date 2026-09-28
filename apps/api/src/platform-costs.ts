import type { Database } from "@trainer/db";
import { platformWorkspaceSql } from "./workspace-state.ts";
import { registrarFromConfig } from "../../../packages/providers/src/registrar.ts";
import { elevated } from "@trainer/db";

// The platform's own costs (docs/features/platform-finance.md): what belongs
// to no trainer (servers, the email plan, provider plans, registrar top-ups,
// payout bank fees) and the registrar's prepaid balance. Phase B reads the
// registrar's book from the web address ledger and its last balance reading;
// the platform cost ledger itself is added in phase C.

export type PlatformCostRow = {
  id: string;
  month: string;
  category: string;
  description: string;
  vendor: string | null;
  amountMinor: number;
  currency: string;
  estimated: boolean;
  payoutId: string | null;
  createdAt: string;
};
export type ProviderInvoice = {
  id: string;
  provider: string;
  month: string;
  reference: string;
  totalUsd: number;
};

/** Platform cost entries of the given Dubai months (phase C). */
export async function platformCostsForMonths(
  _db: Database,
  _months: string[],
): Promise<PlatformCostRow[]> {
  return [];
}
/** Provider invoices imported for the given months (phase C). */
export async function providerInvoicesForMonths(
  _db: Database,
  _months: string[],
): Promise<ProviderInvoice[]> {
  return [];
}

/**
 * The registrar's cost of every trainer domain, all time, per currency (the
 * platform's own figure, never shown to trainers), and the last balance the
 * registrar reported (Check registrar balance, or the worker).
 */
export async function registrarBook(db: Database) {
  const workspaces = await db.system((tx) =>
    tx.query<{ id: string }>(
      "SELECT t.id FROM tenants t WHERE NOT " +
        platformWorkspaceSql("t.id") +
        " ORDER BY t.id",
    ),
  );
  const charged: Record<string, number> = {};
  for (const w of workspaces) {
    const rows = await db.tenant(
      elevated("worker", { tenantId: w.id, role: "finance" }),
      (tx) =>
        tx.query(
          "SELECT j.currency,coalesce(sum(l.amount_minor),0)::text AS amount FROM journals j JOIN journal_lines l ON l.tenant_id=j.tenant_id AND l.journal_id=j.id WHERE l.account='registrar_cost' GROUP BY j.currency",
        ),
    );
    for (const r of rows)
      charged[r.currency] = (charged[r.currency] ?? 0) + Number(r.amount);
  }
  const [reading] = await db.system((tx) =>
    tx.query(
      "SELECT result,finished_at,status,error FROM platform_finance_runs WHERE kind='registrar_balance' ORDER BY started_at DESC LIMIT 1",
    ),
  );
  return {
    chargedMinor: charged,
    topUpsMinor: {} as Record<string, number>,
    lastReading: reading
      ? {
          at: reading.finished_at,
          status: reading.status,
          currency: reading.result?.currency ?? null,
          available: reading.result?.available ?? null,
          error: reading.error ?? null,
        }
      : null,
  };
}

/** Reads the registrar's available balance (a read-only call). */
export async function readRegistrarBalance() {
  const registrar = registrarFromConfig();
  const balance = await registrar.balance();
  return {
    registrar: registrar.id,
    currency: balance.currency,
    available: balance.available,
  };
}
