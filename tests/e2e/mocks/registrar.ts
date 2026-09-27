/**
 * Domain registrar double (availability, price quote, registration, DNS
 * records). The current application saves DOMAIN_API_URL/KEY but performs
 * registrar purchase and DNS as recorded operator actions, so scenarios use
 * this mock to produce the evidence an operator would copy. Test-only.
 */
import { MockServer, bearer, randomId, unauthorized } from "./http.ts";

export class RegistrarMock {
  readonly server: MockServer;
  registrations = new Map<string, { id: string; domain: string; expiresAt: string; priceMinor: number }>();
  records = new Map<string, Array<{ type: string; name: string; value: string }>>();
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
    s.route("PUT", "/v1/domains/:domain/records", (r) => {
      if (bearer(r) !== this.apiKey) return unauthorized();
      this.records.set(r.params.domain, [...(r.json?.records ?? [])]);
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
