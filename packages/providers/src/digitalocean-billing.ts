/**
 * DigitalOcean billing, read-only (docs/features/platform-finance.md, phase
 * D): monthly invoices and their items, the platform's project and its
 * resources with their sizes and prices, for the platform's server cost.
 *
 * Safety rules kept here, in code, whatever the caller asks:
 *  - GET only. Every request goes through `get()`, which never sends a body
 *    and refuses any other method; nothing here creates, changes or deletes a
 *    DigitalOcean resource.
 *  - A DigitalOcean token reaches its whole team, whose bill other projects
 *    share: callers keep only the invoice items of the configured project
 *    (projectItems), and estimate the current month from that project's own
 *    resources.
 *  - The token is only ever sent to the API host as a bearer header; errors
 *    carry the HTTP status and DigitalOcean's message, never the token.
 */
import { ConfigurationError, runtimeConfig, type RuntimeConfig } from "./configuration.ts";
import { integrationRequest } from "./integrations.ts";
import { ProviderUnavailable } from "./index.ts";
import { sandboxOverride } from "./sandbox.ts";

export const DIGITALOCEAN_API = "https://api.digitalocean.com";
export type DoInvoice = {
  invoice_uuid: string;
  invoice_id?: string;
  amount: string;
  invoice_period: string;
  updated_at?: string;
};
export type DoInvoiceItem = {
  product?: string;
  resource_uuid?: string;
  resource_id?: string;
  group_description?: string;
  description?: string;
  amount: string;
  duration?: string;
  duration_unit?: string;
  start_time?: string;
  end_time?: string;
  project_name?: string;
  category?: string;
};
export type DoProject = { id: string; name: string; is_default?: boolean };
export type DoResource = { urn: string; assigned_at?: string; status?: string };

/** A fetch-like function; only the isolated Node test runner may inject one. */
export type BillingTransport = (url: string, init: RequestInit) => Promise<Response>;
function testTransport(transport: BillingTransport | undefined) {
  if (!transport) return undefined;
  if (!process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === "production")
    throw new ConfigurationError(
      "A billing test transport is unavailable outside the isolated Node test runner.",
    );
  return transport;
}
export class BillingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BillingError";
  }
}

export class DigitalOceanBilling {
  readonly base: string;
  private readonly transport?: BillingTransport;
  /** Every request made (method and path only), for the run's record. */
  readonly calls: Array<{ method: "GET"; path: string; status: number }> = [];
  constructor(
    private readonly token: string,
    options: { transport?: BillingTransport } = {},
  ) {
    if (!token.trim())
      throw new ConfigurationError("The DigitalOcean billing token is missing.");
    this.transport = testTransport(options.transport);
    const override = sandboxOverride("DIGITALOCEAN_API_BASE_URL");
    this.base = override ? override.origin : DIGITALOCEAN_API;
  }
  /** The only request method: GET, no body. */
  private async get(path: string): Promise<any> {
    if (!path.startsWith("/v2/"))
      throw new BillingError("Only DigitalOcean API v2 paths are read");
    const url = new URL(path, this.base).toString();
    const init: RequestInit = {
      method: "GET",
      headers: { Authorization: "Bearer " + this.token, Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    };
    let response: Response;
    try {
      response = this.transport
        ? await this.transport(url, init)
        : await integrationRequest(url, init);
    } catch {
      throw new BillingError("DigitalOcean could not be reached");
    }
    this.calls.push({ method: "GET", path: new URL(url).pathname, status: response.status });
    const text = await response.text().catch(() => "");
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = null;
    }
    if (!response.ok || data === null)
      throw new BillingError(
        `DigitalOcean answered HTTP ${response.status}${data?.message ? ": " + String(data.message).replace(/\s+/g, " ").slice(0, 200) : ""}`,
        response.status,
      );
    return data;
  }
  /** Follows `links.pages.next` within the same path (at most `max` pages). */
  private async pages<T>(path: string, key: string, max = 20): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path + (path.includes("?") ? "&" : "?") + "per_page=100";
    for (let i = 0; next && i < max; i++) {
      const data = await this.get(next);
      out.push(...((data?.[key] ?? []) as T[]));
      const link = data?.links?.pages?.next;
      if (!link) break;
      const u = new URL(link, this.base);
      next = u.pathname.startsWith("/v2/") ? u.pathname + u.search : null;
    }
    return out;
  }
  /** Final monthly invoices of the whole team, newest first. */
  invoices() {
    return this.pages<DoInvoice>("/v2/customers/my/invoices", "invoices");
  }
  /** One invoice's items (every project of the team; filter by project). */
  invoiceItems(uuid: string) {
    if (!/^[0-9a-f-]{8,64}$/i.test(uuid))
      throw new BillingError("Invalid invoice identifier");
    return this.pages<DoInvoiceItem>(
      `/v2/customers/my/invoices/${encodeURIComponent(uuid)}`,
      "invoice_items",
      50,
    );
  }
  projects() {
    return this.pages<DoProject>("/v2/projects", "projects");
  }
  projectResources(projectId: string) {
    if (!/^[0-9a-f-]{8,64}$/i.test(projectId))
      throw new BillingError("Invalid project identifier");
    return this.pages<DoResource>(
      `/v2/projects/${encodeURIComponent(projectId)}/resources`,
      "resources",
    );
  }
  async droplet(id: string) {
    return (await this.get(`/v2/droplets/${encodeURIComponent(id)}`)).droplet;
  }
  async volume(id: string) {
    return (await this.get(`/v2/volumes/${encodeURIComponent(id)}`)).volume;
  }
  async snapshot(id: string) {
    return (await this.get(`/v2/snapshots/${encodeURIComponent(id)}`)).snapshot;
  }
}

/** Only the items of the configured project (the token's team shares the bill). */
export function projectItems(items: DoInvoiceItem[], project: string) {
  const name = project.trim().toLowerCase();
  return items.filter((i) => String(i.project_name ?? "").trim().toLowerCase() === name);
}

export type BillingSettings = { token: string; project: string; enabled: boolean };
export function digitalOceanBillingSettings(
  config: RuntimeConfig = runtimeConfig(),
): BillingSettings {
  return {
    token: config.DO_BILLING_TOKEN?.trim() ?? "",
    project: config.DO_BILLING_PROJECT?.trim() || "GymMembership",
    enabled: (config.DO_BILLING_IMPORT_ENABLED ?? "true").trim() !== "false",
  };
}
export function digitalOceanBillingFromConfig(
  config: RuntimeConfig = runtimeConfig(),
  options: { transport?: BillingTransport } = {},
) {
  const s = digitalOceanBillingSettings(config);
  if (!s.token)
    throw new ProviderUnavailable(
      "digitalocean_billing",
      "The DigitalOcean billing token is not configured.",
    );
  return { client: new DigitalOceanBilling(s.token, options), settings: s };
}
