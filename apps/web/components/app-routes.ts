// Pure route decisions shared by the workspace shell and its tests.

export type AdminRoute =
  | "overview"
  | "finance"
  | "operations"
  | "account_security"
  | "integration_operations"
  | "affiliates"
  | "infrastructure_observer"
  | "infrastructure_actions"
  | "infrastructure_host"
  | "settings"
  | "alerts"
  | "metrics"
  | "platform_finance"
  | "governance"
  | "model_profiles"
  | "marketing_assistant"
  | "not_found";
const operationsViews =
  /^\/admin\/(acquisition|early-access|trainers|subscribers|brains|safety|finops|wearables|domains|infrastructure|support|security|experiments|configuration)(\/|$)/;
/** Unknown /admin addresses resolve to not_found, never to the overview. */
export function adminRoute(path: string): AdminRoute {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (clean === "/admin") return "overview";
  if (clean === "/admin/finance" || clean === "/admin/finance/controls")
    return "finance";
  if (clean === "/admin/account-security") return "account_security";
  if (clean === "/admin/integration-operations")
    return "integration_operations";
  if (clean === "/admin/affiliates") return "affiliates";
  if (clean === "/admin/alerts") return "alerts";
  if (clean === "/admin/metrics") return "metrics";
  if (clean === "/admin/platform-finance") return "platform_finance";
  if (clean === "/admin/governance") return "governance";
  if (clean === "/admin/model-profiles") return "model_profiles";
  if (clean === "/admin/marketing-assistant") return "marketing_assistant";
  if (clean === "/admin/infrastructure/observer")
    return "infrastructure_observer";
  if (clean === "/admin/infrastructure/actions")
    return "infrastructure_actions";
  if (clean === "/admin/infrastructure/host") return "infrastructure_host";
  if (
    clean.startsWith("/admin/settings") ||
    clean.startsWith("/admin/integrations")
  )
    return "settings";
  if (operationsViews.test(clean)) return "operations";
  return "not_found";
}
/**
 * The per-coach manifest and icon are public website assets, served only for
 * a published coaching website. A private workspace keeps the platform icon.
 */
export function coachAppLinks(tenant: {
  slug: string;
  published?: boolean | null;
}): Array<[rel: string, href: string]> {
  if (tenant.published !== true) return [];
  const base = `/api/v1/public/sites/${encodeURIComponent(tenant.slug)}`;
  return [
    ["manifest", `${base}/manifest.webmanifest`],
    ["icon", `${base}/icon/192`],
    ["apple-touch-icon", `${base}/icon/192`],
  ];
}
