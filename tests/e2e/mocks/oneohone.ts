/**
 * 101domain REST API double (docs/features/web-addresses.md): the endpoints
 * the 101domain adapter uses, in the response envelope 101domain documents
 * ({status, code, message, data, errors}): single and bulk availability,
 * ending prices, domain list and details, the finance balance and orders,
 * nameservers (200 when already set, 202 while the registry applies a
 * change) and DNS records. Registration and renewal follow the announced,
 * not yet published endpoints and exist here so the adapter's gated path
 * can be exercised. Test-only; it never contacts 101domain.
 *
 * Checked against the live API (GET only, 28 September 2026): the single
 * search answer (one object, upper-case name, `pricing` null when taken), the
 * ending answer (`has_requirements`), domain details and the domain list
 * (`expires_at`, `registered_at`, upper-case nameservers, no privacy flag,
 * `meta.pagination`), the balance (`credit_balance`, `amount_due`), the order
 * list (newest first, `page`/`per_page`, no working domain filter, rows
 * without a domain; status "processed" when finished), an order's details
 * (`items[].domain`), the nameserver read (a plain upper-case list without a
 * pending flag) and the records refusal (400 NAMESERVERS_NOT_LOCAL).
 *
 * Still provisional (not callable read-only): the bulk-search rows, the
 * nameserver PUT answer (`change_status`, `current_nameservers`), the record
 * writes (DELETE /records `{ids}`), registration, renewal and the status of
 * an order still being processed ("processing" here). Tests against these
 * prove the adapter and the double agree, not that 101domain answers this way.
 */
import { MockServer, bearer, randomId } from "./http.ts";

type Order = {
  number: string;
  status: string;
  date: Date;
  total: string;
  items: Array<{ description: string; domain: string; type: string }>;
};
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
const ok = (data: unknown, status = 200, meta?: unknown) => ({
  status,
  body: { status: "success", code: "OK", message: "", ...(meta ? { meta } : {}), data },
});
const upper = (names: string[]) => names.map((name) => name.toUpperCase());
/** One page of a list, newest first, as 101domain pages (10 by default). */
function paged<T>(rows: T[], query: URLSearchParams) {
  const perPage = Math.min(100, Math.max(1, Number(query.get("per_page") ?? 10) || 10));
  const page = Math.max(1, Number(query.get("page") ?? 1) || 1);
  return {
    data: rows.slice((page - 1) * perPage, page * perPage),
    meta: {
      pagination: {
        total: rows.length,
        current_page: page,
        per_page: perPage,
        total_pages: Math.max(1, Math.ceil(rows.length / perPage)),
      },
    },
  };
}
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
  /** The account's order history, oldest first (listed newest first). */
  readonly orders: Order[] = [];
  /** Adds an order for a domain; returns its number. */
  addOrder(domain: string, what: string, status = "processed", total = "0.00") {
    const number = "ord_" + String(this.orders.length + 1).padStart(6, "0");
    this.orders.push({
      number,
      status,
      date: new Date(),
      total,
      items: [{ description: `${domain} - ${what}`, domain, type: "domain" }],
    });
    return number;
  }
  /** Every open order of a domain becomes finished ("processed"). */
  finishOrders(domain: string) {
    for (const order of this.orders)
      if (order.status !== "processed" && order.items.some((item) => item.domain === domain))
        order.status = "processed";
  }
  /** The registry finished a processing order: the name is now in the account. */
  finishProcessing(name: string) {
    this.processing.delete(name);
    const registration = this.queued.get(name);
    if (registration) this.registrations.set(name, registration);
    this.queued.delete(name);
    this.finishOrders(name);
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
      const available = !!price && !this.registrations.has(name) && !this.taken.has(name);
      return {
        domain_name: name.toUpperCase(),
        tld: "." + tld.toUpperCase(),
        available,
        available_terms: [1, 2, 3],
        pricing: available
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
          : null,
      };
    };
    s.route("GET", "/v1/domains/search", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      return ok(item(String(r.query.get("domain_name") ?? "").toLowerCase()));
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
        tld_name: "." + r.params.tld.toUpperCase(),
        type: "gTLD",
        available_terms: [1, 2, 3],
        pricing: [{ term_years: 1, register: price.register, renew: price.renew, transfer: price.register, currency: "USD" }],
        has_requirements: (price.requirements ?? []).length > 0,
      });
    });
    const details = (x: Registration) => ({
      id: x.domain.replace(/\W/g, ""),
      domain_name: x.domain.toUpperCase(),
      tld: "." + x.domain.slice(x.domain.indexOf(".") + 1).toUpperCase(),
      status: "ACTIVE",
      status_note: null,
      registry_statuses: ["clientTransferProhibited"],
      created_at: x.created.toISOString(),
      registered_at: x.created.toISOString(),
      expires_at: x.expires.toISOString(),
      nameservers: upper(x.nameservers),
      auto_renew: x.autoRenew,
      // Private registration is an add-on product: no privacy flag here.
      product_ids: [397],
      web_forwarding: { destination: null, type: null },
    });
    s.route("GET", "/v1/domains", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const search = String(r.query.get("search") ?? "").toLowerCase();
      const list = paged(
        [...this.registrations.values()].filter((x) => x.domain.includes(search)).map(details),
        r.query,
      );
      return ok(list.data, 200, list.meta);
    });
    s.route("GET", "/v1/domains/:domain", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const x = this.registrations.get(r.params.domain.toLowerCase());
      if (!x) return error(404, "NOT_FOUND", "The specified domain was not found.");
      return ok(details(x));
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
      const total = this.prices[name.slice(name.indexOf(".") + 1)]?.register ?? "0.00";
      if (this.processing.has(name)) {
        this.queued.set(name, registration);
        const number = this.addOrder(name, "Registration", "processing", total);
        return ok({ order_number: number, domain_name: name, status: "processing" }, 202);
      }
      this.registrations.set(name, registration);
      const number = this.addOrder(name, "Registration", "processed", total);
      return ok({ order_number: number, domain_name: name, status: "completed", total }, 201);
    });
    s.route("POST", "/v1/domains/:domain/renew", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const x = this.registrations.get(r.params.domain.toLowerCase());
      if (!x) return error(404, "NOT_FOUND", "Domain not found in this account");
      x.expires = new Date(x.expires.getTime() + Number(r.json?.term_years ?? 1) * 365 * 86400000);
      const number = this.addOrder(x.domain, "Renewal");
      return ok({ order_number: number, expiration_date: x.expires.toISOString() });
    });
    s.route("GET", "/v1/finance/balance", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      return ok({ amount_due: "0.00", credit_balance: this.balance, currency: "USD" });
    });
    // Like the live list: newest first, paged, every filter ignored, and no
    // domain on a row (only an order's details name its domains).
    s.route("GET", "/v1/finance/orders", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const list = paged(
        [...this.orders].reverse().map((order) => ({
          order_number: order.number,
          status: order.status,
          order_date: order.date.toISOString(),
          subtotal: order.total,
          tax: "0.00",
          total: order.total,
          currency: "USD",
        })),
        r.query,
      );
      return ok(list.data, 200, list.meta);
    });
    s.route("GET", "/v1/finance/orders/:number", (r) => {
      const denied = guard(r);
      if (denied) return denied;
      const order = this.orders.find((o) => o.number === r.params.number);
      if (!order) return error(404, "NOT_FOUND", "The specified order was not found.");
      return ok({
        order_number: order.number,
        status: order.status,
        order_date: order.date.toISOString(),
        currency: "USD",
        subtotal: order.total,
        tax: "0.00",
        total: order.total,
        items: order.items.map((item) => ({ ...item, product_id: null, term_months: 12, quantity: 1 })),
      });
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
      // The nameservers in force: a change still at the registry reads as the old list.
      return ok(upper(x.nameservers));
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
        return {
          status: 400,
          body: {
            status: "error",
            code: "NAMESERVERS_NOT_LOCAL",
            message: "DNS records cannot be managed here because the domain is using third-party nameservers.",
            errors: null,
          },
        };
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
