/**
 * Domain registrar double (availability, price quote, registration, DNS
 * records). The manual domain flow records registrar work as operator
 * evidence, so scenarios use this mock to produce the evidence an operator
 * would copy. It also implements the generic registrar JSON contract of the
 * web address flow (docs/features/web-addresses.md): USD pricing, domain
 * lookup and search, record read-back, renewal and the account balance.
 * Test-only.
 */
import { MockServer, bearer, randomId, unauthorized } from "./http.ts";

export class RegistrarMock {
  readonly server: MockServer;
  registrations = new Map<string, { id: string; domain: string; expiresAt: string; priceMinor: number }>();
  /** One-year USD prices per ending for the generic contract. */
  pricesUsd: Record<string, { register: string; renew: string }> = {
    com: { register: "11.00", renew: "15.00" },
    net: { register: "12.00", renew: "16.00" },
  };
  balanceUsd = "200.00";
  records = new Map<string, Array<{ type: string; name: string; value: string }>>();
  /** Custom nameservers per domain; absent while the registrar's own DNS is used. */
  nameservers = new Map<string, string[]>();
  onNameservers?: (domain: string, nameservers: string[] | null) => void;
  /** Publishes saved records to the DNS double, as the registrar's name servers would. */
  onRecords?: (domain: string, records: Array<{ type: string; name: string; value: string }>) => void;
  constructor(
    tlsMaterial: { key: string; cert: string },
    public apiKey: string,
  ) {
    this.server = new MockServer("registrar", tlsMaterial);
    const s = this.server;
    s.route("GET", "/v1/domains/check", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      const domain = (r.query.get("domain") ?? "").toLowerCase();
      return {
        body: {
          domain,
          available: !this.registrations.has(domain),
          currency: "AED",
          priceMinor: 5500,
          renewalMinor: 5500,
          term: "1y",
        },
      };
    });
    s.route("POST", "/v1/domains", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      const domain = String(r.json?.domain ?? "").toLowerCase();
      if (!domain || this.registrations.has(domain))
        return { status: 409, body: { error: "unavailable" } };
      const registration = {
        id: randomId("reg"),
        domain,
        priceMinor: 5500,
        expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      };
      this.registrations.set(domain, registration);
      return { status: 201, body: registration };
    });
    s.route("GET", "/v1/pricing/:tld", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      const price = this.pricesUsd[r.params.tld];
      if (!price) return { status: 404, body: { error: "unsupported ending" } };
      return { body: { tld: r.params.tld, currency: "USD", ...price } };
    });
    s.route("GET", "/v1/domains", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      const search = (r.query.get("search") ?? "").toLowerCase();
      return {
        body: {
          data: [...this.registrations.values()]
            .filter((x) => x.domain.includes(search))
            .map((x) => ({ domain: x.domain, expiresAt: x.expiresAt, expired: Date.parse(x.expiresAt) < Date.now() })),
        },
      };
    });
    s.route("GET", "/v1/domains/:domain", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      const registration = this.registrations.get(r.params.domain);
      return registration
        ? { body: { domain: registration.domain, expiresAt: registration.expiresAt, privacy: true } }
        : { status: 404, body: { error: "not found" } };
    });
    s.route("GET", "/v1/domains/:domain/records", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      if (!this.registrations.has(r.params.domain)) return { status: 404, body: { error: "not found" } };
      return { body: { domain: r.params.domain, records: this.records.get(r.params.domain) ?? [] } };
    });
    s.route("POST", "/v1/domains/:domain/renew", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      const registration = this.registrations.get(r.params.domain);
      if (!registration) return { status: 404, body: { error: "not found" } };
      const next = new Date(registration.expiresAt);
      next.setUTCFullYear(next.getUTCFullYear() + Number(r.json?.years ?? 1));
      registration.expiresAt = next.toISOString();
      return { body: { domain: registration.domain, expiresAt: registration.expiresAt, chargedUsd: this.pricesUsd[registration.domain.split(".").slice(1).join(".")]?.renew } };
    });
    s.route("GET", "/v1/account", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      return { body: { balanceUsd: this.balanceUsd } };
    });
    const nameservers = (domain: string) => ({
      domain,
      nameservers: this.nameservers.get(domain) ?? ["ns1.registrar.test", "ns2.registrar.test"],
      custom: this.nameservers.has(domain),
    });
    s.route("GET", "/v1/domains/:domain/nameservers", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      if (!this.registrations.has(r.params.domain)) return { status: 404, body: { error: "not found" } };
      return { body: nameservers(r.params.domain) };
    });
    s.route("PUT", "/v1/domains/:domain/nameservers", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      if (!this.registrations.has(r.params.domain)) return { status: 404, body: { error: "not found" } };
      const list = (r.json?.nameservers ?? []).map((n: string) => String(n).toLowerCase());
      if (list.length < 2) return { status: 422, body: { error: "at least two nameservers" } };
      this.nameservers.set(r.params.domain, list);
      this.onNameservers?.(r.params.domain, list);
      return { body: nameservers(r.params.domain) };
    });
    s.route("DELETE", "/v1/domains/:domain/nameservers", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      if (!this.registrations.has(r.params.domain)) return { status: 404, body: { error: "not found" } };
      this.nameservers.delete(r.params.domain);
      this.onNameservers?.(r.params.domain, null);
      return { body: nameservers(r.params.domain) };
    });
    s.route("PUT", "/v1/domains/:domain/records", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      this.records.set(r.params.domain, [...(r.json?.records ?? [])]);
      this.onRecords?.(r.params.domain, this.records.get(r.params.domain)!);
      return { body: { domain: r.params.domain, records: this.records.get(r.params.domain) } };
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
}
