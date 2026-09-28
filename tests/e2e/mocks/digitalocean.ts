/**
 * DigitalOcean DNS API double (docs/features/web-addresses.md, "DNS
 * hosting"): the v2 domains and domain records endpoints the platform uses,
 * with the response shapes of DigitalOcean's public API reference: zones
 * (GET, POST, DELETE), records (GET with pagination, POST, PATCH, DELETE),
 * bearer tokens, 404/422 error bodies ({id, message}) and a 429 rate limit.
 * `foreign` holds names another DigitalOcean account has already added: a
 * create answers 422 "Name already exists" and reads answer 404, exactly
 * like the real service. Test-only; it never contacts DigitalOcean.
 *
 * `server` serves the HTTPS double for the end-to-end harness; `fetch` (a
 * fetch-compatible function) is the unit tests' fixture transport over the
 * same routes.
 */
import { MockServer, bearer, randomId } from "./http.ts";

export type MockRecord = {
  id: number;
  type: string;
  name: string;
  data: string;
  ttl: number;
  priority: number | null;
  port: number | null;
  weight: number | null;
  flags: number | null;
  tag: string | null;
};
const NAMESERVERS = ["ns1.digitalocean.com", "ns2.digitalocean.com", "ns3.digitalocean.com"];

export class DigitalOceanMock {
  readonly server: MockServer;
  /** Zones in this account, with their records. */
  readonly zones = new Map<string, MockRecord[]>();
  /** Names held by another DigitalOcean account. */
  readonly foreign = new Set<string>();
  /** Every request, method and path (no token). */
  readonly calls: Array<{ method: string; path: string; body?: any }> = [];
  /** Publishes a zone's records to a DNS double, as DigitalOcean's nameservers would. */
  onZone?: (zone: string, records: MockRecord[] | null) => void;
  /**
   * Billing (read-only routes, docs/features/platform-finance.md phase D):
   * the team's final invoices with their items (every project of the team,
   * as DigitalOcean splits by project only on invoices), its projects,
   * each project's resources, and droplet and volume details with prices.
   */
  readonly billing = {
    invoices: [] as Array<{ invoice_uuid: string; invoice_id: string; amount: string; invoice_period: string; updated_at: string }>,
    items: new Map<string, any[]>(),
    projects: [] as Array<{ id: string; name: string; is_default?: boolean }>,
    resources: new Map<string, Array<{ urn: string; assigned_at: string; status: string }>>(),
    droplets: new Map<string, any>(),
    volumes: new Map<string, any>(),
  };
  private nextId = 1000;
  private failures: Array<{ method: string; path: RegExp; status: number; times: number; apply: boolean }> = [];
  constructor(
    tlsMaterial: { key: string; cert: string },
    public token: string,
  ) {
    this.server = new MockServer("digitalocean", tlsMaterial);
    const s = this.server;
    const auth = (r: any) =>
      bearer(r) === this.token
        ? null
        : { status: 401, body: { id: "unauthorized", message: "Unable to authenticate you." } };
    const notFound = { status: 404, body: { id: "not_found", message: "The resource you were accessing could not be found." } };
    s.route("GET", "/v2/domains", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      const perPage = Math.min(200, Number(r.query.get("per_page") ?? 20));
      const page = Math.max(1, Number(r.query.get("page") ?? 1));
      const names = [...this.zones.keys()].sort();
      return {
        body: {
          domains: names
            .slice((page - 1) * perPage, page * perPage)
            .map((name) => ({ name, ttl: 1800, zone_file: "" })),
          links: {},
          meta: { total: names.length },
        },
      };
    });
    s.route("POST", "/v2/domains", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      const name = String(r.json?.name ?? "").toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name))
        return { status: 422, body: { id: "unprocessable_entity", message: "Name is invalid" } };
      if (this.zones.has(name) || this.foreign.has(name))
        return { status: 422, body: { id: "unprocessable_entity", message: "Name already exists" } };
      const records: MockRecord[] = [
        ...NAMESERVERS.map((ns) => this.record({ type: "NS", name: "@", data: ns, ttl: 1800 })),
        this.record({ type: "SOA", name: "@", data: "1800", ttl: 1800 }),
      ];
      this.zones.set(name, records);
      this.onZone?.(name, records);
      return { status: 201, body: { domain: { name, ttl: 1800, zone_file: null } } };
    });
    // A page of a list, with DigitalOcean's links.pages.next and meta.total.
    const paged = (r: any, key: string, rows: any[], path: string, extra: Record<string, unknown> = {}) => {
      const perPage = Math.min(200, Math.max(1, Number(r.query.get("per_page") ?? 20)));
      const page = Math.max(1, Number(r.query.get("page") ?? 1));
      const pages = Math.max(1, Math.ceil(rows.length / perPage));
      const base = `https://api.digitalocean.com${path}?per_page=${perPage}`;
      return {
        body: {
          [key]: rows.slice((page - 1) * perPage, page * perPage),
          ...extra,
          links: page < pages ? { pages: { next: `${base}&page=${page + 1}`, last: `${base}&page=${pages}` } } : {},
          meta: { total: rows.length },
        },
      };
    };
    s.route("GET", "/v2/customers/my/invoices", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      return paged(r, "invoices", this.billing.invoices, "/v2/customers/my/invoices", {
        invoice_preview: { invoice_uuid: "preview", amount: "0.00", invoice_period: new Date().toISOString().slice(0, 7), updated_at: new Date().toISOString() },
      });
    });
    s.route("GET", "/v2/customers/my/invoices/:uuid", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      const items = this.billing.items.get(r.params.uuid);
      return items ? paged(r, "invoice_items", items, `/v2/customers/my/invoices/${r.params.uuid}`) : notFound;
    });
    s.route("GET", "/v2/projects", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      return paged(r, "projects", this.billing.projects, "/v2/projects");
    });
    s.route("GET", "/v2/projects/:id/resources", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      const resources = this.billing.resources.get(r.params.id);
      return resources ? paged(r, "resources", resources, `/v2/projects/${r.params.id}/resources`) : notFound;
    });
    s.route("GET", "/v2/droplets/:id", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      const droplet = this.billing.droplets.get(r.params.id);
      return droplet ? { body: { droplet } } : notFound;
    });
    s.route("GET", "/v2/volumes/:id", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      const volume = this.billing.volumes.get(r.params.id);
      return volume ? { body: { volume } } : notFound;
    });
    s.route("GET", "/v2/domains/:name", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      const name = r.params.name.toLowerCase();
      return this.zones.has(name) ? { body: { domain: { name, ttl: 1800, zone_file: "" } } } : notFound;
    });
    s.route("DELETE", "/v2/domains/:name", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      const name = r.params.name.toLowerCase();
      if (!this.zones.delete(name)) return notFound;
      this.onZone?.(name, null);
      return { status: 204 };
    });
    s.route("GET", "/v2/domains/:name/records", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      const records = this.zones.get(r.params.name.toLowerCase());
      if (!records) return notFound;
      const perPage = Math.min(200, Number(r.query.get("per_page") ?? 20));
      const page = Math.max(1, Number(r.query.get("page") ?? 1));
      const type = r.query.get("type");
      const filtered = records.filter((x) => !type || x.type === type);
      const pages = Math.max(1, Math.ceil(filtered.length / perPage));
      const base = `https://api.digitalocean.com/v2/domains/${r.params.name}/records?per_page=${perPage}`;
      return {
        body: {
          domain_records: filtered.slice((page - 1) * perPage, page * perPage),
          links: page < pages ? { pages: { next: `${base}&page=${page + 1}`, last: `${base}&page=${pages}` } } : {},
          meta: { total: filtered.length },
        },
      };
    });
    s.route("POST", "/v2/domains/:name/records", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      const zone = r.params.name.toLowerCase();
      const records = this.zones.get(zone);
      if (!records) return notFound;
      const input = r.json ?? {};
      const problem = this.invalid(records, input);
      if (problem) return { status: 422, body: { id: "unprocessable_entity", message: problem } };
      const record = this.record(input);
      records.push(record);
      this.onZone?.(zone, records);
      return { status: 201, body: { domain_record: record } };
    });
    for (const method of ["PATCH", "PUT"])
      s.route(method, "/v2/domains/:name/records/:id", (r) => {
        const denied = auth(r);
        if (denied) return denied;
        const zone = r.params.name.toLowerCase();
        const records = this.zones.get(zone);
        const record = records?.find((x) => String(x.id) === r.params.id);
        if (!records || !record) return notFound;
        const next = { ...record, ...(r.json ?? {}), id: record.id };
        const problem = this.invalid(records.filter((x) => x !== record), next);
        if (problem) return { status: 422, body: { id: "unprocessable_entity", message: problem } };
        Object.assign(record, next);
        this.onZone?.(zone, records);
        return { body: { domain_record: record } };
      });
    s.route("DELETE", "/v2/domains/:name/records/:id", (r) => {
      const denied = auth(r);
      if (denied) return denied;
      const zone = r.params.name.toLowerCase();
      const records = this.zones.get(zone);
      const index = records?.findIndex((x) => String(x.id) === r.params.id) ?? -1;
      if (!records || index < 0) return notFound;
      records.splice(index, 1);
      this.onZone?.(zone, records);
      return { status: 204 };
    });
  }
  private record(input: any): MockRecord {
    return {
      id: this.nextId++,
      type: String(input.type ?? "").toUpperCase(),
      name: String(input.name ?? "@"),
      data: String(input.data ?? ""),
      ttl: Number(input.ttl ?? 1800),
      priority: input.priority ?? null,
      port: input.port ?? null,
      weight: input.weight ?? null,
      flags: input.flags ?? null,
      tag: input.tag ?? null,
    };
  }
  /** DigitalOcean's own refusals: a CNAME cannot share a name; A needs IPv4. */
  private invalid(records: MockRecord[], input: any) {
    const type = String(input.type ?? "").toUpperCase();
    const name = String(input.name ?? "");
    if (!["A", "AAAA", "CNAME", "TXT", "CAA", "MX", "NS", "SRV"].includes(type)) return "Type is invalid";
    if (type === "A" && !/^\d{1,3}(\.\d{1,3}){3}$/.test(String(input.data ?? ""))) return "Data needs to be an IPv4 address";
    if (Number(input.ttl ?? 1800) < 30) return "TTL must be at least 30";
    const same = records.filter((x) => x.name === name);
    if (type === "CNAME" && same.some((x) => x.type !== "CNAME")) return "CNAME records cannot share a name with other records";
    if (type !== "CNAME" && same.some((x) => x.type === "CNAME")) return "Records cannot share a name with a CNAME record";
    return null;
  }
  /** Seeds a zone (as if created earlier) with extra records. */
  seed(zone: string, records: Array<Partial<MockRecord> & { type: string; name: string; data: string }>) {
    const list: MockRecord[] = [
      ...NAMESERVERS.map((ns) => this.record({ type: "NS", name: "@", data: ns, ttl: 1800 })),
      ...records.map((r) => this.record(r)),
    ];
    this.zones.set(zone, list);
    this.onZone?.(zone, list);
    return list;
  }
  /** The next matching request fails with `status` (after applying it when `apply`). */
  failNext(method: string, path: RegExp, status = 503, times = 1, apply = false) {
    this.failures.push({ method, path, status, times, apply });
  }
  get url() {
    return this.server.url;
  }
  start(port = 0) {
    return this.server.start(port);
  }
  stop() {
    return this.server.stop();
  }
  /** fetch-compatible entry for the unit tests' fixture transport. */
  fetch = async (url: string, init: RequestInit = {}) => {
    const target = new URL(url);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : undefined;
    this.calls.push({ method, path: target.pathname + target.search, ...(body ? { body: JSON.parse(body) } : {}) });
    const failure = this.failures.find((f) => f.method === method && f.path.test(target.pathname) && f.times > 0);
    if (failure) {
      failure.times--;
      if (failure.apply) await this.dispatch(method, target, init, body);
      return new Response(
        failure.status === 429
          ? JSON.stringify({ id: "too_many_requests", message: "API Rate limit exceeded." })
          : failure.status >= 500
            ? "upstream error"
            : JSON.stringify({ id: "mock", message: "Mock refusal" }),
        {
          status: failure.status,
          headers: {
            "content-type": failure.status >= 500 ? "text/plain" : "application/json",
            ...(failure.status === 429 ? { "retry-after": "2" } : {}),
          },
        },
      );
    }
    return this.dispatch(method, target, init, body);
  };
  private async dispatch(method: string, target: URL, init: RequestInit, body?: string) {
    const answer = await this.server.inject({
      method,
      url: target.pathname + target.search,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body,
    });
    return new Response(answer.status === 204 ? null : answer.body, {
      status: answer.status,
      headers: answer.headers,
    });
  }
  /** Records of a zone as "name type data" strings, sorted (no NS/SOA). */
  view(zone: string) {
    return (this.zones.get(zone) ?? [])
      .filter((r) => !["NS", "SOA"].includes(r.type))
      .map((r) => `${r.name} ${r.type} ${r.data}`)
      .sort();
  }
  /**
   * A team like the platform's: the project "GymMembership" with one
   * s-2vcpu-4gb droplet (USD 24 a month, weekly backups) and a domain, and an
   * unrelated project with its own droplet; final invoices for `months`
   * (oldest first) carrying both projects' items, the platform's from
   * `firstPlatformMonth` on.
   */
  seedBilling(options: { months: string[]; firstPlatformMonth: string; project?: string }) {
    const project = options.project ?? "GymMembership";
    const platform = { id: "4e1a7d1c-0000-4000-8000-00000000a001", name: project };
    const other = { id: "4e1a7d1c-0000-4000-8000-00000000b002", name: "Unrelated Shop" };
    this.billing.projects.splice(0, this.billing.projects.length, other, platform);
    this.billing.resources.set(platform.id, [
      { urn: "do:droplet:604000001", assigned_at: "2026-09-27T08:00:00Z", status: "ok" },
      { urn: "do:domain:platform.example", assigned_at: "2026-09-28T08:00:00Z", status: "ok" },
    ]);
    this.billing.resources.set(other.id, [{ urn: "do:droplet:500000009", assigned_at: "2025-01-01T00:00:00Z", status: "ok" }]);
    this.billing.droplets.set("604000001", {
      id: 604000001,
      name: "gymmembership-app",
      size_slug: "s-2vcpu-4gb",
      size: { slug: "s-2vcpu-4gb", price_monthly: 24, price_hourly: 0.03571 },
      features: ["backups", "monitoring"],
      created_at: "2026-09-27T08:00:00Z",
    });
    this.billing.droplets.set("500000009", {
      id: 500000009,
      name: "shop",
      size_slug: "s-1vcpu-1gb",
      size: { slug: "s-1vcpu-1gb", price_monthly: 6, price_hourly: 0.00893 },
      features: [],
      created_at: "2025-01-01T00:00:00Z",
    });
    this.billing.invoices.splice(0, this.billing.invoices.length);
    for (const month of [...options.months].reverse()) {
      const uuid = month.replace("-", "") + "00-0000-4000-8000-000000000001";
      const items: any[] = [
        { product: "Droplets", resource_uuid: "shop-uuid", group_description: "shop (s-1vcpu-1gb)", description: "shop", amount: "6.00", duration: "744", duration_unit: "Hours", start_time: month + "-01T00:00:00Z", end_time: month + "-28T00:00:00Z", project_name: other.name, category: "iaas" },
      ];
      if (month >= options.firstPlatformMonth)
        items.push(
          { product: "Droplets", resource_uuid: "gm-uuid", group_description: "gymmembership-app (s-2vcpu-4gb)", description: "gymmembership-app", amount: "3.10", duration: "87", duration_unit: "Hours", start_time: month + "-27T08:00:00Z", end_time: month + "-30T23:59:59Z", project_name: project, category: "iaas" },
          { product: "Backups", resource_uuid: "gm-uuid", group_description: "gymmembership-app backups", description: "Backups", amount: "0.62", duration: "87", duration_unit: "Hours", start_time: month + "-27T08:00:00Z", end_time: month + "-30T23:59:59Z", project_name: project, category: "iaas" },
        );
      const total = items.reduce((n, i) => n + Number(i.amount), 0);
      this.billing.invoices.push({ invoice_uuid: uuid, invoice_id: "10" + month.replace("-", ""), amount: total.toFixed(2), invoice_period: month, updated_at: month + "-28T00:00:00Z" });
      this.billing.items.set(uuid, items);
    }
    return { platform, other };
  }
  static token() {
    return randomId("dop_v1_mock");
  }
}
