/**
 * Namecheap XML API double (docs/features/web-addresses.md). Answers the
 * commands the web address flow uses with the response shapes of Namecheap's
 * published API examples: users.getBalances, domains.check, users.getPricing,
 * domains.create, domains.getInfo, domains.getList, domains.dns.setHosts,
 * domains.dns.getHosts and domains.renew. Credentials and the whitelisted
 * client address are checked like the real service. Error numbers are
 * illustrative. Test-only; it never contacts Namecheap.
 *
 * `respond()` serves the HTTPS double and `fetch` (a fetch-compatible
 * function) the unit tests' fixture transport, so both run the same logic.
 */
import { MockServer, randomId } from "./http.ts";

export type NamecheapAccount = {
  apiUser: string;
  apiKey: string;
  username: string;
  clientIp: string;
};
type Host = { name: string; type: string; address: string; ttl: number };
type Registration = {
  domain: string;
  id: string;
  created: Date;
  expires: Date;
  whoisguard: boolean;
  hosts: Host[];
  contact: Record<string, string>;
};
const CONTACT_FIELDS = [
  "FirstName",
  "LastName",
  "Address1",
  "City",
  "StateProvince",
  "PostalCode",
  "Country",
  "Phone",
  "EmailAddress",
];
const escapeXml = (value: unknown) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const attrs = (values: Record<string, unknown>) =>
  Object.entries(values)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
const usDate = (date: Date, time = false) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${date.getUTCFullYear()}`;
  return time
    ? `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
    : day;
};
const ICANN_FEE = "0.18";
const money = (value: number) => value.toFixed(4);

export class NamecheapMock {
  readonly server: MockServer;
  readonly registrations = new Map<string, Registration>();
  /** Names registered by someone else. */
  readonly taken = new Set<string>();
  readonly premium = new Map<string, string>();
  prices: Record<string, { register: string; renew: string }> = {
    com: { register: "10.28", renew: "15.88" },
    net: { register: "11.98", renew: "16.98" },
    org: { register: "7.48", renew: "14.98" },
    co: { register: "9.98", renew: "29.98" },
  };
  balance = 250;
  /** Commands received, without the API key. */
  readonly calls: Array<{ command: string; params: Record<string, string> }> =
    [];
  private lost = new Map<string, number>();
  private refused = new Map<
    string,
    { count: number; number: string; message: string }
  >();
  /** Publishes written host records to a DNS double, as Namecheap's name servers would. */
  onHosts?: (domain: string, hosts: Host[]) => void;

  constructor(
    tlsMaterial: { key: string; cert: string },
    public account: NamecheapAccount,
  ) {
    // Request bodies carry the API key: never log them.
    this.server = new MockServer("namecheap", tlsMaterial, {
      logBodies: false,
    });
    for (const method of ["GET", "POST"])
      this.server.route(method, "/xml.response", (request) => {
        const params = new URLSearchParams(
          request.method === "POST"
            ? request.rawBody
            : request.query.toString(),
        );
        const result = this.respond(params);
        return {
          status: result.status,
          headers: { "content-type": "text/xml; charset=utf-8" },
          body: result.body,
        };
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
  /** Applies the next `command` but answers 504 without a body (an unknown outcome). */
  loseNextResponse(command: string, times = 1) {
    this.lost.set(command, times);
  }
  /** Answers the next `command` with an ERROR response without applying it. */
  refuseNext(
    command: string,
    message = "Mock refusal",
    number = "2011280",
    times = 1,
  ) {
    this.refused.set(command, { count: times, number, message });
  }
  commands(command?: string) {
    return this.calls.filter((call) => !command || call.command === command);
  }
  /** fetch-compatible entry for withIntegrationFixtureTransport. */
  fetch = async (url: string, init: RequestInit = {}) => {
    const target = new URL(url);
    if (target.pathname !== "/xml.response")
      return new Response("not found", { status: 404 });
    const params = new URLSearchParams(
      typeof init.body === "string" ? init.body : target.search.slice(1),
    );
    const result = this.respond(params);
    return new Response(result.body, {
      status: result.status,
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  };

  respond(params: URLSearchParams): { status: number; body: string } {
    const command = (params.get("Command") ?? "").replace(/^namecheap\./, "");
    const visible = Object.fromEntries(
      [...params].filter(([key]) => key !== "ApiKey"),
    );
    this.calls.push({ command, params: visible });
    if (
      params.get("ApiUser") !== this.account.apiUser ||
      params.get("UserName") !== this.account.username ||
      params.get("ApiKey") !== this.account.apiKey
    )
      return this.error(
        command,
        "1011102",
        "API Key is invalid or API access has not been enabled",
      );
    if (params.get("ClientIp") !== this.account.clientIp)
      return this.error(
        command,
        "1011150",
        `Invalid request IP: ${params.get("ClientIp") ?? ""}`,
      );
    const refusal = this.refused.get(command);
    if (refusal && refusal.count > 0) {
      refusal.count--;
      return this.error(command, refusal.number, refusal.message);
    }
    let body: string | { status: number; body: string };
    try {
      body = this.command(command, params);
    } catch (error) {
      const failure = error as Error & { number?: string };
      return this.error(command, failure.number ?? "2019166", failure.message);
    }
    if (typeof body !== "string") return body;
    const lost = this.lost.get(command) ?? 0;
    if (lost > 0) {
      this.lost.set(command, lost - 1);
      return { status: 504, body: "Gateway Timeout" };
    }
    return {
      status: 200,
      body: `<?xml version="1.0" encoding="utf-8"?>\n<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">\n  <Errors />\n  <Warnings />\n  <RequestedCommand>namecheap.${escapeXml(command)}</RequestedCommand>\n  <CommandResponse Type="namecheap.${escapeXml(command)}">\n    ${body}\n  </CommandResponse>\n  <Server>MOCK-NC</Server>\n  <GMTTimeDifference>--5:00</GMTTimeDifference>\n  <ExecutionTime>0.012</ExecutionTime>\n</ApiResponse>`,
    };
  }
  private error(command: string, number: string, message: string) {
    return {
      status: 200,
      body: `<?xml version="1.0" encoding="utf-8"?>\n<ApiResponse Status="ERROR" xmlns="http://api.namecheap.com/xml.response">\n  <Errors>\n    <Error Number="${escapeXml(number)}">${escapeXml(message)}</Error>\n  </Errors>\n  <Warnings />\n  <RequestedCommand>namecheap.${escapeXml(command)}</RequestedCommand>\n  <Server>MOCK-NC</Server>\n  <GMTTimeDifference>--5:00</GMTTimeDifference>\n  <ExecutionTime>0.004</ExecutionTime>\n</ApiResponse>`,
    };
  }
  private refuse(number: string, message: string): never {
    throw Object.assign(new Error(message), { number });
  }
  private owned(domain: string) {
    const registration = this.registrations.get(domain.toLowerCase());
    if (!registration) this.refuse("2019166", "Domain name not found");
    return registration;
  }
  private price(tld: string) {
    const price = this.prices[tld];
    if (!price) this.refuse("2030280", `TLD is not supported in API: ${tld}`);
    return price;
  }
  private command(command: string, params: URLSearchParams): string {
    switch (command) {
      case "users.getBalances":
        return `<UserGetBalancesResult${attrs({
          Currency: "USD",
          AvailableBalance: this.balance.toFixed(2),
          AccountBalance: this.balance.toFixed(2),
          EarnedAmount: "0.00",
          WithdrawableAmount: "0.00",
          FundsRequiredForAutoRenew: "0.00",
        })} />`;
      case "domains.check": {
        const names = (params.get("DomainList") ?? "")
          .split(",")
          .map((n) => n.trim().toLowerCase())
          .filter(Boolean);
        if (!names.length)
          this.refuse("2011169", "Parameter DomainList is missing");
        return names
          .map((name) => {
            const premium = this.premium.get(name);
            return `<DomainCheckResult${attrs({
              Domain: name,
              Available: !this.registrations.has(name) && !this.taken.has(name),
              ErrorNo: 0,
              Description: "",
              IsPremiumName: !!premium,
              PremiumRegistrationPrice: premium ?? "0",
              PremiumRenewalPrice: premium ?? "0",
              PremiumRestorePrice: "0",
              PremiumTransferPrice: "0",
              IcannFee: "0",
              EapFee: "0.0",
            })} />`;
          })
          .join("\n    ");
      }
      case "users.getPricing": {
        if ((params.get("ProductType") ?? "").toUpperCase() !== "DOMAIN")
          this.refuse("2011170", "ProductType is invalid");
        const tld = (params.get("ProductName") ?? "").toLowerCase();
        const price = this.price(tld);
        const category = (name: string, value: string) =>
          `<ProductCategory Name="${name}"><Product Name="${escapeXml(tld)}">` +
          [1, 2]
            .map(
              (years) =>
                `<Price${attrs({
                  Duration: years,
                  DurationType: "YEAR",
                  Price: money(Number(value) * years),
                  PricingType: "MULTIPLE",
                  AdditionalCost: ICANN_FEE,
                  RegularPrice: money(Number(value) * years + 2),
                  RegularPriceType: "MULTIPLE",
                  RegularAdditionalCost: ICANN_FEE,
                  RegularAdditionalCostType: "MULTIPLE",
                  YourPrice: money(Number(value) * years),
                  YourPriceType: "MULTIPLE",
                  YourAdditonalCost: ICANN_FEE,
                  YourAdditonalCostType: "MULTIPLE",
                  PromotionPrice: "0.0",
                  Currency: "USD",
                })} />`,
            )
            .join("") +
          `</Product></ProductCategory>`;
        return `<UserGetPricingResult><ProductType Name="domains">${category("register", price.register)}${category("renew", price.renew)}</ProductType></UserGetPricingResult>`;
      }
      case "domains.create": {
        const domain = (params.get("DomainName") ?? "").toLowerCase();
        const years = Number(params.get("Years") ?? 1);
        if (!/^[a-z0-9-]+\.[a-z.]+$/.test(domain))
          this.refuse("2011166", "Parameter DomainName is invalid");
        for (const role of ["Registrant", "Tech", "Admin", "AuxBilling"])
          for (const field of CONTACT_FIELDS)
            if (!params.get(role + field))
              this.refuse("2011280", `Parameter ${role}${field} is missing`);
        if (!/^\+\d{1,3}\.\d{4,14}$/.test(params.get("RegistrantPhone")!))
          this.refuse("2015182", "Contact phone is invalid");
        if (this.registrations.has(domain) || this.taken.has(domain))
          this.refuse("3019166", `Domain ${domain} is not available`);
        if (this.premium.has(domain))
          this.refuse("2515623", "Domain is premium while considered regular");
        const tld = domain.slice(domain.indexOf(".") + 1);
        const charge =
          Number(this.price(tld).register) * years + Number(ICANN_FEE);
        if (this.balance < charge)
          this.refuse("2528166", "Order creation failed: insufficient funds");
        this.balance -= charge;
        const created = new Date();
        const expires = new Date(created);
        expires.setUTCFullYear(expires.getUTCFullYear() + years);
        const registration: Registration = {
          domain,
          id: String(100000 + this.registrations.size),
          created,
          expires,
          whoisguard:
            params.get("AddFreeWhoisguard") === "yes" &&
            params.get("WGEnabled") === "yes",
          // A new Namecheap domain starts with parking records.
          hosts: [
            {
              name: "@",
              type: "URL",
              address: "http://www." + domain,
              ttl: 1800,
            },
            {
              name: "www",
              type: "CNAME",
              address: "parkingpage.namecheap.com.",
              ttl: 1800,
            },
          ],
          contact: Object.fromEntries(
            CONTACT_FIELDS.map((f) => [f, params.get("Registrant" + f) ?? ""]),
          ),
        };
        this.registrations.set(domain, registration);
        return `<DomainCreateResult${attrs({
          Domain: domain,
          Registered: true,
          ChargedAmount: money(charge),
          DomainID: registration.id,
          OrderID: randomId("ord").slice(4, 12),
          TransactionID: randomId("txn").slice(4, 12),
          WhoisguardEnable: registration.whoisguard,
          FreePositiveSSL: false,
          NonRealTimeDomain: false,
        })} />`;
      }
      case "domains.getInfo": {
        const r = this.owned(params.get("DomainName") ?? "");
        return `<DomainGetInfoResult${attrs({
          Status: "Ok",
          ID: r.id,
          DomainName: r.domain,
          OwnerName: this.account.username,
          IsOwner: true,
          IsPremium: false,
        })}><DomainDetails><CreatedDate>${usDate(r.created)}</CreatedDate><ExpiredDate>${usDate(r.expires)}</ExpiredDate><NumYears>0</NumYears></DomainDetails><LockDetails /><Whoisguard Enabled="${r.whoisguard ? "True" : "False"}"><ID>${r.id}</ID><ExpiredDate>${usDate(r.expires)}</ExpiredDate></Whoisguard><DnsDetails ProviderType="FREE" IsUsingOurDNS="true" HostCount="${r.hosts.length}" EmailType="FWD" DynamicDNSStatus="false" IsFailover="false"><Nameserver>dns1.registrar-servers.com</Nameserver><Nameserver>dns2.registrar-servers.com</Nameserver></DnsDetails></DomainGetInfoResult>`;
      }
      case "domains.getList": {
        const term = (params.get("SearchTerm") ?? "").toLowerCase();
        const rows = [...this.registrations.values()].filter(
          (r) => !term || r.domain.includes(term),
        );
        return `<DomainGetListResult>${rows
          .map(
            (r) =>
              `<Domain${attrs({
                ID: r.id,
                Name: r.domain,
                User: this.account.username,
                Created: usDate(r.created),
                Expires: usDate(r.expires),
                IsExpired: r.expires.getTime() < Date.now(),
                IsLocked: false,
                AutoRenew: false,
                WhoisGuard: r.whoisguard ? "ENABLED" : "NOTPRESENT",
                IsPremium: false,
                IsOurDNS: true,
              })} />`,
          )
          .join(
            "",
          )}</DomainGetListResult><Paging><TotalItems>${rows.length}</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>`;
      }
      case "domains.dns.setHosts": {
        const domain =
          `${params.get("SLD") ?? ""}.${params.get("TLD") ?? ""}`.toLowerCase();
        const r = this.owned(domain);
        const hosts: Host[] = [];
        for (let n = 1; params.has("HostName" + n); n++)
          hosts.push({
            name: params.get("HostName" + n)!,
            type: (params.get("RecordType" + n) ?? "").toUpperCase(),
            address: params.get("Address" + n) ?? "",
            ttl: Number(params.get("TTL" + n) ?? 1800),
          });
        if (!hosts.length)
          this.refuse("2050900", "At least one host is required");
        // Like Namecheap: every existing record is replaced.
        r.hosts = hosts;
        this.onHosts?.(domain, hosts);
        return `<DomainDNSSetHostsResult Domain="${escapeXml(domain)}" IsSuccess="true"><Warnings /></DomainDNSSetHostsResult>`;
      }
      case "domains.dns.getHosts": {
        const domain =
          `${params.get("SLD") ?? ""}.${params.get("TLD") ?? ""}`.toLowerCase();
        const r = this.owned(domain);
        return `<DomainDNSGetHostsResult Domain="${escapeXml(domain)}" EmailType="FWD" IsUsingOurDNS="true">${r.hosts
          .map(
            (h, i) =>
              `<host${attrs({
                HostId: 1000 + i,
                Name: h.name,
                Type: h.type,
                Address: h.address,
                MXPref: 10,
                TTL: h.ttl,
                AssociatedAppTitle: "",
                FriendlyName: "",
                IsActive: true,
                IsDDNSEnabled: false,
              })} />`,
          )
          .join("")}</DomainDNSGetHostsResult>`;
      }
      case "domains.renew": {
        const r = this.owned(params.get("DomainName") ?? "");
        const years = Number(params.get("Years") ?? 1);
        const tld = r.domain.slice(r.domain.indexOf(".") + 1);
        const charge =
          Number(this.price(tld).renew) * years + Number(ICANN_FEE);
        if (this.balance < charge)
          this.refuse("2528166", "Order creation failed: insufficient funds");
        this.balance -= charge;
        r.expires = new Date(r.expires);
        r.expires.setUTCFullYear(r.expires.getUTCFullYear() + years);
        return `<DomainRenewResult${attrs({
          DomainName: r.domain,
          DomainID: r.id,
          Renew: true,
          OrderID: randomId("ord").slice(4, 12),
          TransactionID: randomId("txn").slice(4, 12),
          ChargedAmount: money(charge),
        })}><DomainDetails><ExpiredDate>${usDate(r.expires, true)}</ExpiredDate><NumYears>0</NumYears></DomainDetails></DomainRenewResult>`;
      }
      default:
        this.refuse("1010900", `Invalid command: namecheap.${command}`);
    }
  }
}
