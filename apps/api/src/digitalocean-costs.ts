import { createHash, randomUUID } from "node:crypto";
import type { Database } from "@trainer/db";
import {
  digitalOceanBillingFromConfig,
  digitalOceanBillingSettings,
  projectItems,
  type DigitalOceanBilling,
  type DoInvoiceItem,
} from "../../../packages/providers/src/digitalocean-billing.ts";
import {
  registerPlatformCostSource,
  type PlatformCostRow,
} from "./platform-costs.ts";
import {
  finishRun,
  registerPlatformFinanceJob,
  startRun,
} from "./platform-finance-runs.ts";

// DigitalOcean billing import (docs/features/platform-finance.md, phase D).
// The token is team-wide and other, unrelated projects share the bill, so
// only invoice items whose project_name is the configured project (default
// "GymMembership") become platform costs. DigitalOcean splits costs by
// project only on its final monthly invoices, so the month without an
// invoice yet is an estimate from that project's own resources (droplets
// with their backups, volumes), replaced by the invoice's items when it
// arrives. Read-only calls only (the adapter sends GET and nothing else).
// Idempotent: an invoice is imported once (digitalocean_invoices), and each
// item's cost entry is keyed by invoice uuid and item (platform_costs
// external_key), so a retried run records nothing twice.

const HOUR = 3600000;
const VOLUME_USD_PER_GIB_MONTH = 0.1;
const BACKUP_SHARE = 0.2;

const utcMonth = (d: Date) => d.toISOString().slice(0, 7);
function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}
const cents = (usd: string | number) => Math.round(Number(usd) * 100);
const itemKey = (uuid: string, index: number, item: DoInvoiceItem) =>
  `do:${uuid}:${index}:` +
  createHash("sha256")
    .update(
      JSON.stringify([
        item.resource_uuid ?? item.resource_id ?? "",
        item.description ?? "",
        item.start_time ?? "",
        item.end_time ?? "",
        item.amount,
      ]),
    )
    .digest("hex")
    .slice(0, 16);

export type ResourceEstimate = {
  urn: string;
  kind: string;
  name: string | null;
  monthlyUsd: number | null;
  projectedUsd: number;
  toDateUsd: number;
  note: string | null;
};
/**
 * One resource's cost for `month`: hourly from when it was created (or the
 * month start) to the month end, capped at its monthly price, plus weekly
 * backups (20% of the droplet price). What is not a droplet or volume is
 * listed as not estimated (domains are free; others have no reliable price
 * through the API).
 */
export async function estimateResource(
  client: DigitalOceanBilling,
  urn: string,
  month: string,
  now: Date,
): Promise<ResourceEstimate> {
  const [, kind, id] = urn.split(":");
  const { start, end } = monthBounds(month);
  const span = (created: string | undefined, until: Date) => {
    const from = Math.max(start.getTime(), created ? new Date(created).getTime() : start.getTime());
    return Math.max(0, (Math.min(until.getTime(), end.getTime()) - from) / HOUR);
  };
  if (kind === "droplet") {
    const d = await client.droplet(id);
    const monthly = Number(d?.size?.price_monthly ?? 0);
    const hourly = Number(d?.size?.price_hourly ?? monthly / 672);
    const backups = Array.isArray(d?.features) && d.features.includes("backups");
    const factor = backups ? 1 + BACKUP_SHARE : 1;
    const projected = Math.min(monthly, hourly * span(d?.created_at, end)) * factor;
    const toDate = Math.min(monthly, hourly * span(d?.created_at, now)) * factor;
    return {
      urn,
      kind,
      name: d?.name ?? null,
      monthlyUsd: monthly * factor,
      projectedUsd: projected,
      toDateUsd: toDate,
      note: `${d?.size_slug ?? "droplet"}${backups ? " with backups (+20%)" : ""}`,
    };
  }
  if (kind === "volume") {
    const v = await client.volume(id);
    const monthly = Number(v?.size_gigabytes ?? 0) * VOLUME_USD_PER_GIB_MONTH;
    const hours = (end.getTime() - start.getTime()) / HOUR;
    return {
      urn,
      kind,
      name: v?.name ?? null,
      monthlyUsd: monthly,
      projectedUsd: (monthly * span(v?.created_at, end)) / hours,
      toDateUsd: (monthly * span(v?.created_at, now)) / hours,
      note: `${v?.size_gigabytes ?? "?"} GiB`,
    };
  }
  return {
    urn,
    kind: kind ?? "unknown",
    name: id ?? null,
    monthlyUsd: kind === "domain" ? 0 : null,
    projectedUsd: 0,
    toDateUsd: 0,
    note: kind === "domain" ? "DNS is free" : "not estimated",
  };
}

export async function importDigitalOceanBilling(
  db: Database,
  input: {
    client: DigitalOceanBilling;
    project: string;
    now?: Date;
    actorId?: string | null;
  },
) {
  const now = input.now ?? new Date();
  const run = await startRun(db, "digitalocean", input.actorId ?? null, {
    project: input.project,
  });
  try {
    // The configured project must exist in the team: a wrong or renamed
    // project would otherwise import every invoice as "none of our items"
    // and estimate nothing, as if the servers cost nothing. The run fails
    // (and raises the import alert) until the setting is corrected.
    const project = (await input.client.projects()).find(
      (p) => p.name.trim().toLowerCase() === input.project.trim().toLowerCase(),
    );
    if (!project)
      throw new Error(
        `The DigitalOcean project "${input.project.slice(0, 80)}" was not found in the team; check the project under Settings → DigitalOcean billing`,
      );
    // 1. Final invoices not imported for this project yet: its items become costs.
    const known = new Set(
      (
        await db.system((tx) =>
          tx.query("SELECT invoice_uuid FROM digitalocean_invoices WHERE lower(project_name)=lower($1)", [
            project.name,
          ]),
        )
      ).map((r: any) => r.invoice_uuid),
    );
    const invoices = await input.client.invoices();
    const imported: Array<{ month: string; items: number; usd: string }> = [];
    for (const invoice of invoices) {
      if (!invoice?.invoice_uuid || known.has(invoice.invoice_uuid)) continue;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(invoice.invoice_period ?? ""))) continue;
      const mine = projectItems(
        await input.client.invoiceItems(invoice.invoice_uuid),
        input.project,
      );
      let total = 0;
      await db.system(async (tx) => {
        for (const [index, item] of mine.entries()) {
          const amount = cents(item.amount);
          if (!amount) continue;
          total += amount;
          await tx.query(
            "INSERT INTO platform_costs(id,month,category,description,vendor,amount_minor,currency,receipt_reference,source,external_key,estimated) VALUES($1,$2,'server',$3,'DigitalOcean',$4,'USD',$5,'digitalocean',$6,false) ON CONFLICT DO NOTHING",
            [
              randomUUID(),
              invoice.invoice_period,
              [item.product, item.group_description || item.description]
                .filter(Boolean)
                .join(": ")
                .slice(0, 500) || "DigitalOcean usage",
              amount,
              ("DigitalOcean invoice " + (invoice.invoice_id ?? invoice.invoice_uuid)).slice(0, 300),
              itemKey(invoice.invoice_uuid, index, item),
            ],
          );
        }
        // Only the project's own figures: the team's total includes other,
        // unrelated projects and is not kept.
        await tx.query(
          "INSERT INTO digitalocean_invoices(invoice_uuid,month,project_name,project_items,project_amount_usd) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
          [invoice.invoice_uuid, invoice.invoice_period, project.name, mine.length, total / 100],
        );
      });
      imported.push({ month: invoice.invoice_period, items: mine.length, usd: (total / 100).toFixed(2) });
    }
    // 2. This month (no invoice yet): an estimate from the project's resources.
    const month = utcMonth(now);
    let estimate: {
      month: string;
      projectedUsd: number;
      toDateUsd: number;
      resources: number;
      notEstimated: string[];
    } | null = null;
    {
      const resources = await input.client.projectResources(project.id);
      const lines: ResourceEstimate[] = [];
      for (const r of resources.slice(0, 100))
        lines.push(await estimateResource(input.client, r.urn, month, now));
      const projected = lines.reduce((n, l) => n + l.projectedUsd, 0);
      const toDate = lines.reduce((n, l) => n + l.toDateUsd, 0);
      await db.system((tx) =>
        tx.query(
          "INSERT INTO digitalocean_estimates(month,project_name,project_id,amount_usd,to_date_usd,resources,computed_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(month) DO UPDATE SET project_name=EXCLUDED.project_name,project_id=EXCLUDED.project_id,amount_usd=EXCLUDED.amount_usd,to_date_usd=EXCLUDED.to_date_usd,resources=EXCLUDED.resources,computed_at=now()",
          [month, project.name, project.id, projected.toFixed(4), toDate.toFixed(4), JSON.stringify(lines)],
        ),
      );
      estimate = {
        month,
        projectedUsd: Number(projected.toFixed(4)),
        toDateUsd: Number(toDate.toFixed(4)),
        resources: lines.length,
        notEstimated: lines.filter((l) => l.monthlyUsd === null).map((l) => l.urn),
      };
    }
    const result = {
      project: project.name,
      projectFound: true,
      invoicesChecked: invoices.length,
      invoicesImported: imported,
      estimate,
      requests: input.client.calls.length,
    };
    await finishRun(db, run, { result });
    return result;
  } catch (error) {
    await finishRun(db, run, {
      error: (error as Error).message || "DigitalOcean billing import failed",
    });
    throw error;
  }
}

/**
 * DigitalOcean's cost for months without an imported invoice: the latest
 * estimate, marked as one. A month whose invoice was imported shows the
 * invoice's items (platform_costs) only: the estimate is replaced.
 */
registerPlatformCostSource(async (db, months, now): Promise<PlatformCostRow[]> => {
  const rows = await db.system((tx) =>
    tx.query(
      "SELECT e.month,e.project_name,e.amount_usd::text AS usd,e.to_date_usd::text AS to_date,e.computed_at FROM digitalocean_estimates e WHERE e.month=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM digitalocean_invoices i WHERE i.month=e.month AND lower(i.project_name)=lower(e.project_name))",
      [months],
    ),
  );
  // The month in progress counts what the resources cost so far (income is
  // to date too); the projection to the month end is in the description.
  const open = utcMonth(now);
  return rows
    .map((r: any) => ({ ...r, projected: r.usd, usd: r.month === open ? r.to_date : r.usd }))
    .filter((r) => cents(r.usd) > 0)
    .map((r) => ({
      id: "digitalocean-estimate:" + r.month,
      month: r.month,
      category: "server",
      description:
        r.month === open
          ? `DigitalOcean ${r.project_name}: cost so far this month, estimated from the project's resources (about USD ${Number(r.projected).toFixed(2)} for the whole month) until the invoice arrives`
          : `DigitalOcean ${r.project_name}: estimate from the project's resources until the invoice arrives`,
      vendor: "DigitalOcean",
      amountMinor: cents(r.usd),
      currency: "USD",
      estimated: true,
      source: "estimate",
      receiptReference: "Estimated " + new Date(r.computed_at).toISOString().slice(0, 10),
      payoutId: null,
      tenantId: null,
      reversesId: null,
      reversed: false,
      createdAt: new Date(r.computed_at).toISOString(),
    }));
});

/** The worker's daily import, when the billing settings are saved. */
registerPlatformFinanceJob({
  id: "digitalocean",
  async run(db, now) {
    const settings = digitalOceanBillingSettings();
    if (!settings.token || !settings.enabled) return { skipped: "not_configured" };
    const [recent] = await db.system((tx) =>
      tx.query(
        "SELECT 1 FROM platform_finance_runs WHERE kind='digitalocean' AND ((status IN ('succeeded','running') AND started_at>$1) OR started_at>$2) LIMIT 1",
        [new Date(now.getTime() - 20 * HOUR).toISOString(), new Date(now.getTime() - HOUR).toISOString()],
      ),
    );
    if (recent) return { skipped: "ran_recently" };
    const { client } = digitalOceanBillingFromConfig();
    return importDigitalOceanBilling(db, { client, project: settings.project, now });
  },
});
