/**
 * 101domain REST API double (docs/features/web-addresses.md): the endpoints
 * the 101domain adapter uses, in the response envelope 101domain documents
 * ({status, code, message, data, errors}): single and bulk availability,
 * ending prices, domain list and details, the finance balance and orders,
 * nameservers (200 when already set, 202 while the registry applies a
 * change) and DNS records. Registration and renewal follow the announced,
 * not yet published endpoints and exist here so the adapter's gated path
 * can be exercised. Test-only; it never contacts 101domain.
 */
import { MockServer, bearer, randomId } from "./http.ts";

type Registration = {
  domain: string;
  expires: Date;
  created: Date;
  privacy: boolean;
  autoRenew: boolean;
  nameservers: string[];
  contacts: Record<string, any>;
  records: Array<{ id: string; type: string; name: string; value: string; ttl: number }>;
};
const OWN_DNS = ["ns1.101domain.com", "ns2.101domain.com"];
const ok = (data: unknown, status = 200) => ({
  status,
  body: { status: "success", code: "OK", message: "OK", data, errors: null },
});
const error = (status: number, code: string, message: string) => ({
  status,
  body: { status: "error", code, message, data: null, errors: null },
});

export class OneOhOneMock {
  readonly server: MockServer;
  readonly registrations = new Map<string, Registration>();
  readonly taken = new Set<string>();
  readonly premium = new Set<string>();
  prices: Record<string, { register: string; renew: string; requirements?: string[] }> = {
    com: { register: "14.99", renew: "19.99" },
    fit: { register: "38.99", renew: "48.99" },
    ae: { register: "62.99", renew: "71.99" },
    "co.ae": { register: "89.00", renew: "89.00", requirements: ["UAE trade licence"] },
  };
  balance = "250.00";
  /** Nameserver changes wait at the registry this many reads (202 meanwhile). */
  registryDelayReads = 0;
  private pending = new Map<string, { nameservers: string[]; reads: number }>();
  /** Registration orders still processing, by name. */
  readonly processing = new Set<string>();
  private readonly queued = new Map<string, Registration>();
  /** The registry finished a processing order: the name is now in the account. */
  finishProcessing(name: string) {
    this.processing.delete(name);
    const registration = this.queued.get(name);
    if (registration) this.registrations.set(name, registration);
    this.queued.delete(name);
  }
  onNameservers?: (domain: string, nameservers: string[]) => void;
  constructor(
    tlsMaterial: { key: string; cert: string },
    public apiKey: string,
  ) {
    this.server = new MockServer("101domain", tlsMaterial, { logBodies: false });
    const s = this.server;
    const guard = (r: any) =>
      bearer(r) === this.apiKey ? null : error(401, "UNAUTHORIZED", "Bearer token is missing, invalid, or expired.");
    const item = (name: string) => {
      const tld = name.slice(name.indexOf(".") + 1);
      const price = this.prices[tld];
      return {
        domain_name: name.toUpperCase(),
        tld: "." + tld.toUpperCase(),
        available: !!price && !this.registrations.has(name) && !this.taken.has(name),
        available_terms: [1, 2, 3],
        pricing: price
          ? [
              {
                term_years: 1,
                register: price.register,
                renew: price.renew,
                transfer: price.register,
                currency: "USD",
                premium: this.premium.has(name),
              },
            ]
          : [],
      };
    };
    s.route("GET", "/v1/domains/search", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      return ok([item(String(r.query.get("domain_name") ?? "").toLowerCase())]);
    });
    s.route("POST", "/v1/domains/bulk-search", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const names: string[] = (r.json?.domain_names ?? []).map((n: string) => String(n).toLowerCase());
      if (names.length > 50) return error(422, "VALIDATION_ERROR", "At most 50 names");
      const invalid = names.filter((n) => !/^[a-z0-9-]+\.[a-z.]+$/.test(n));
      return {
        status: 200,
        body: {
          status: "success",
          code: "OK",
          message: "OK",
          data: names.filter((n) => !invalid.includes(n)).map(item),
          invalid,
          errors: null,
        },
      };
    });
    s.route("GET", "/v1/tlds/:tld", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const price = this.prices[r.params.tld.replace(/^\./, "").toLowerCase()];
      if (!price) return error(404, "NOT_FOUND", "Unknown TLD");
      return ok({
        tld: "." + r.params.tld,
        pricing: [{ term_years: 1, register: price.register, renew: price.renew, transfer: price.register, currency: "USD" }],
        registration_requirements: price.requirements ?? [],
      });
    });
    s.route("GET", "/v1/domains", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const search = String(r.query.get("search") ?? "").toLowerCase();
      return ok(
        [...this.registrations.values()]
          .filter((x) => x.domain.includes(search))
          .map((x) => ({ domain_name: x.domain, expiration_date: x.expires.toISOString(), status: "active" })),
      );
    });
    s.route("GET", "/v1/domains/:domain", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const x = this.registrations.get(r.params.domain.toLowerCase());
      if (!x) return error(404, "NOT_FOUND", "Domain not found in this account");
      return ok({
        domain_name: x.domain,
        registration_date: x.created.toISOString(),
        expiration_date: x.expires.toISOString(),
        auto_renew: x.autoRenew,
        private_registration: x.privacy,
        nameservers: x.nameservers,
        registry_statuses: ["clientTransferProhibited"],
      });
    });
    s.route("POST", "/v1/domains/registration", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const name = String(r.json?.domain_name ?? "").toLowerCase();
      if (this.registrations.has(name) || this.taken.has(name))
        return error(400, "DOMAIN_NOT_AVAILABLE", "Domain is not available");
      const registration: Registration = {
        domain: name,
        created: new Date(),
        expires: new Date(Date.now() + Number(r.json?.term_years ?? 1) * 365 * 86400000),
        privacy: r.json?.private_registration === true,
        autoRenew: r.json?.auto_renew !== false,
        nameservers: [...OWN_DNS],
        contacts: r.json?.contacts ?? {},
        records: [],
      };
      if (this.processing.has(name)) {
        this.queued.set(name, registration);
        return ok({ order_number: randomId("ord"), domain_name: name, status: "processing" }, 202);
      }
      this.registrations.set(name, registration);
      return ok({ order_number: randomId("ord"), domain_name: name, status: "completed", total: this.prices[name.slice(name.indexOf(".") + 1)]?.register }, 201);
    });
    s.route("POST", "/v1/domains/:domain/renew", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const x = this.registrations.get(r.params.domain.toLowerCase());
      if (!x) return error(404, "NOT_FOUND", "Domain not found in this account");
      x.expires = new Date(x.expires.getTime() + Number(r.json?.term_years ?? 1) * 365 * 86400000);
      return ok({ order_number: randomId("ord"), expiration_date: x.expires.toISOString() });
    });
    s.route("GET", "/v1/finance/balance", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      return ok({ available_credit: this.balance, currency: "USD", amount_due: "0.00" });
    });
    s.route("GET", "/v1/finance/orders", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const domain = String(r.query.get("domain") ?? "").toLowerCase();
      return ok(this.processing.has(domain) ? [{ order_number: "ord_1", status: "processing", domain_name: domain }] : []);
    });
    s.route("GET", "/v1/dns/:domain/nameservers", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const domain = r.params.domain.toLowerCase();
      const x = this.registrations.get(domain);
      if (!x) return error(404, "NOT_FOUND", "Domain not found in this account");
      const waiting = this.pending.get(domain);
      if (waiting) {
        waiting.reads--;
        if (waiting.reads < 0) {
          x.nameservers = waiting.nameservers;
          this.pending.delete(domain);
          this.onNameservers?.(domain, x.nameservers);
        }
      }
      return ok({
        domain_name: domain,
        nameservers: x.nameservers,
        change_status: this.pending.has(domain) ? "pending" : "completed",
      });
    });
    s.route("PUT", "/v1/dns/:domain/nameservers", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const domain = r.params.domain.toLowerCase();
      const x = this.registrations.get(domain);
      if (!x) return error(404, "NOT_FOUND", "Domain not found in this account");
      const requested: string[] = (r.json?.nameservers ?? []).map((n: string) => String(n).toLowerCase());
      if (requested.length < 2 || requested.length > 13) return error(422, "VALIDATION_ERROR", "2 to 13 nameservers");
      if (requested.join() === x.nameservers.join()) return ok({ domain_name: domain, nameservers: x.nameservers });
      if (this.registryDelayReads > 0) {
        this.pending.set(domain, { nameservers: requested, reads: this.registryDelayReads });
        return ok(
          { domain_name: domain, change_status: "pending", nameservers: requested, current_nameservers: x.nameservers },
          202,
        );
      }
      x.nameservers = requested;
      this.onNameservers?.(domain, requested);
      return ok({ domain_name: domain, nameservers: requested });
    });
    s.route("GET", "/v1/dns/:domain/records", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const x = this.registrations.get(r.params.domain.toLowerCase());
      if (!x) return error(404, "NOT_FOUND", "Domain not found in this account");
      if (x.nameservers.some((n) => !OWN_DNS.includes(n)))
        return error(400, "NAMESERVERS_NOT_LOCAL", "The domain does not use 101domain nameservers");
      return ok(x.records);
    });
    s.route("POST", "/v1/dns/:domain/records", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const x = this.registrations.get(r.params.domain.toLowerCase());
      if (!x) return error(404, "NOT_FOUND", "Domain not found in this account");
      let created = 0;
      for (const record of r.json?.records ?? []) {
        if (x.records.some((y) => y.type === record.type && y.name === record.name && y.value === record.value)) continue;
        x.records.push({ id: randomId("rec"), type: record.type, name: record.name, value: record.value, ttl: record.ttl });
        created++;
      }
      return ok({ created_count: created }, created ? 201 : 200);
    });
    s.route("DELETE", "/v1/dns/:domain/records", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const x = this.registrations.get(r.params.domain.toLowerCase());
      if (!x) return error(404, "NOT_FOUND", "Domain not found in this account");
      const ids: string[] = r.json?.ids ?? [];
      const missing = ids.filter((id) => !x.records.some((y) => y.id === id));
      if (missing.length) return { status: 404, body: { status: "error", code: "NOT_FOUND", message: "Records not found", errors: { not_found_ids: missing } } };
      x.records = x.records.filter((y) => !ids.includes(y.id));
      return ok({ deleted_count: ids.length });
    });
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
    const answer = await this.server.inject({
      method: init.method ?? "GET",
      url: target.pathname + target.search,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? init.body : undefined,
    });
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  };
}
