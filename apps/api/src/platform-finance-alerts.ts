import { registerPlatformAlertRule, fingerprintOf, type AlertCandidate } from "./platform-alerts.ts";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import { digitalOceanBillingSettings } from "../../../packages/providers/src/digitalocean-billing.ts";

// Platform finance alerts (docs/features/platform-finance.md, phase D),
// through the platform alert engine. No budget limits (owner decision, 28
// September 2026: "we pay only when we get paid"): costs are compared with
// income instead. Rules read only the monthly summary and the finance run
// log, so an evaluation every minute stays cheap.

const DUBAI_OFFSET_MS = 4 * 3600000;
const monthOf = (d: Date) => new Date(d.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 7);
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const numberSetting = (key: string, fallback: number, min: number, max: number) => {
  const text = String(runtimeConfig()[key] ?? "").trim();
  const n = text === "" ? NaN : Number(text);
  return n >= min && n <= max ? n : fallback;
};
const commission = (f: any) =>
  ["membership", "programme", "voiceAddOn", "booking", "affiliate", "other", "refunds", "disputes"].reduce(
    (n, k) => n + Number(f?.commission?.[k] ?? 0),
    0,
  );

registerPlatformAlertRule({
  id: "finance.cost_without_income",
  description:
    "A trainer's AI and voice cost in this or last month with no platform income from them in that month (no budget limits apply).",
  async evaluate({ db, now }) {
    const current = monthOf(now);
    const rows = await db.system((tx) =>
      tx.query(
        "SELECT s.month,s.tenant_id,s.figures,t.name FROM platform_finance_months s JOIN tenants t ON t.id=s.tenant_id WHERE s.month=ANY($1::text[]) ORDER BY s.month,s.tenant_id",
        [[shift(current, -1), current]],
      ),
    );
    const out: AlertCandidate[] = [];
    for (const r of rows) {
      const f = r.figures ?? {};
      const costUsd = Number(f.cost?.aiUsd ?? 0) + Number(f.cost?.voiceUsd ?? 0);
      const domains = Object.values(f.domains ?? {}).reduce(
        (n: number, d: any) => n + Number(d?.paymentsMinor ?? 0),
        0,
      );
      const income =
        commission(f) +
        Number(f.aiCoachServiceFeeMinor ?? 0) +
        Number(f.otherChargesMinor ?? 0) +
        domains;
      if (costUsd <= 0 || income > 0) continue;
      out.push({
        dedupeKey: `finance.cost_without_income:${r.tenant_id}:${r.month}`,
        fingerprint: String(Math.round(costUsd * 100)),
        severity: "warning",
        scope: ["finance"],
        tenantId: r.tenant_id,
        title: `Cost without income: ${r.name} (${r.month})`,
        detail: `${r.name} used about USD ${costUsd.toFixed(2)} of AI and voice in ${r.month} with no platform income from them in that month. No budget limit applies; review it on Platform finance.`,
        data: { month: r.month, costUsd: Math.round(costUsd * 10000) / 10000, href: "/admin/platform-finance" },
      });
    }
    return out;
  },
});

registerPlatformAlertRule({
  id: "finance.usage_unpriced_aging",
  description:
    "Provider calls of an earlier month still unpriced after the configured days, and estimated cost of months over 60 days old not yet confirmed by an invoice.",
  async evaluate({ db, now }) {
    const days = numberSetting("FINANCE_UNPRICED_ALERT_DAYS", 7, 1, 90);
    const current = monthOf(now);
    const rows = await db.system((tx) =>
      tx.query(
        "SELECT s.month,sum(coalesce((s.figures->'cost'->>'unpricedCalls')::int,0))::int AS unpriced,sum(coalesce((s.figures->'cost'->>'estimatedUsd')::numeric,0))::text AS estimated FROM platform_finance_months s WHERE s.month<$1 AND s.month>=$2 GROUP BY s.month ORDER BY s.month",
        [current, shift(current, -12)],
      ),
    );
    const out: AlertCandidate[] = [];
    for (const r of rows) {
      const monthEnd = Date.parse(shift(r.month, 1) + "-01T00:00:00Z") - DUBAI_OFFSET_MS;
      const age = (now.getTime() - monthEnd) / 86400000;
      if (r.unpriced > 0 && age >= days)
        out.push({
          dedupeKey: `finance.usage_unpriced:${r.month}`,
          fingerprint: String(r.unpriced),
          severity: age >= 30 ? "critical" : "warning",
          scope: ["finance"],
          title: `Unpriced provider usage for ${r.month}`,
          detail: `${r.unpriced} provider call(s) of ${r.month} are still not priced ${Math.floor(age)} day(s) after the month ended. Reconcile them from the provider invoice or estimate them; until then the AI Coach Service Fee for the month cannot be charged.`,
          data: { month: r.month, unpriced: r.unpriced, href: "/admin/finance" },
        });
      if (Number(r.estimated) > 0 && age >= 60)
        out.push({
          dedupeKey: `finance.usage_estimated:${r.month}`,
          fingerprint: String(Math.round(Number(r.estimated) * 100)),
          severity: "info",
          scope: ["finance"],
          title: `Estimated provider cost not confirmed for ${r.month}`,
          detail: `USD ${Number(r.estimated).toFixed(2)} of ${r.month}'s provider cost is still priced at estimates. Import the provider's invoice under Platform finance → Platform costs.`,
          data: { month: r.month, href: "/admin/platform-finance" },
        });
    }
    return out;
  },
});

registerPlatformAlertRule({
  id: "finance.digitalocean_import",
  description: "The DigitalOcean billing import failed, or has not succeeded for two days while configured.",
  async evaluate({ db, now }) {
    const settings = digitalOceanBillingSettings();
    const [last] = await db.system((tx) =>
      tx.query(
        "SELECT id,status,error,started_at,finished_at FROM platform_finance_runs WHERE kind='digitalocean' AND status<>'running' ORDER BY started_at DESC LIMIT 1",
      ),
    );
    const [success] = await db.system((tx) =>
      tx.query(
        "SELECT max(finished_at) AS at FROM platform_finance_runs WHERE kind='digitalocean' AND status='succeeded'",
      ),
    );
    if (last?.status === "failed")
      return [
        {
          dedupeKey: "finance.digitalocean_import",
          fingerprint: "failed:" + last.id,
          severity: "warning",
          scope: ["finance"],
          title: "DigitalOcean billing import failed",
          detail: `The last import failed: ${String(last.error ?? "no answer").slice(0, 300)}. Server costs for the month stay at the previous estimate; check the billing token under Settings → DigitalOcean billing.`,
          data: { href: "/admin/platform-finance" },
        },
      ];
    const stale =
      settings.token &&
      settings.enabled &&
      (!success?.at || now.getTime() - new Date(success.at).getTime() > 48 * 3600000);
    return stale
      ? [
          {
            dedupeKey: "finance.digitalocean_import",
            fingerprint: "stale:" + String(success?.at ?? "never"),
            severity: "warning",
            scope: ["finance"],
            title: "DigitalOcean billing not imported for two days",
            detail: "The daily DigitalOcean billing import has not succeeded for more than 48 hours, so server costs may be out of date.",
            data: { href: "/admin/platform-finance" },
          },
        ]
      : [];
  },
});

registerPlatformAlertRule({
  id: "finance.registrar_balance_low",
  description: "The registrar's last reported balance is below the configured minimum.",
  async evaluate({ db }) {
    const minimum = numberSetting("FINANCE_REGISTRAR_LOW_BALANCE_USD", 20, 0, 100000);
    const [last] = await db.system((tx) =>
      tx.query(
        "SELECT id,result,finished_at FROM platform_finance_runs WHERE kind='registrar_balance' AND status='succeeded' ORDER BY started_at DESC LIMIT 1",
      ),
    );
    const available = Number(last?.result?.available);
    if (!last || !Number.isFinite(available) || available >= minimum) return [];
    return [
      {
        dedupeKey: "finance.registrar_balance_low",
        fingerprint: fingerprintOf([Math.floor(available)]),
        severity: available < minimum / 4 ? "critical" : "warning",
        scope: ["finance"],
        title: "Registrar balance is low",
        detail: `The registrar reported ${last.result.currency ?? "USD"} ${available.toFixed(2)} available (minimum ${minimum}). Domain purchases and renewals fail when it runs out; top it up and record the top-up under Platform costs.`,
        data: { available, minimum, href: "/admin/platform-finance" },
      },
    ];
  },
});
