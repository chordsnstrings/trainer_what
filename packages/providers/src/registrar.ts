/**
 * Domain registrar adapters (docs/features/web-addresses.md): Namecheap's XML
 * API, 101domain's REST API and a generic JSON registrar API behind one
 * interface. Nothing here
 * decides business state; the API records every purchase, renewal and DNS
 * write under a stable intent before calling these functions and reconciles
 * any outcome that is not a confirmed success.
 */
import { isIP } from "node:net";
import {
  ConfigurationError,
  runtimeConfig,
  type RuntimeConfig,
} from "./configuration.ts";
import { integrationRequest } from "./integrations.ts";
import { ProviderUnavailable } from "./index.ts";
import { providerSandbox, sandboxOverride } from "./sandbox.ts";

export type RegistrarId = "namecheap" | "generic" | "101domain";
export type Availability = {
  domain: string;
  available: boolean;
  premium: boolean;
  /**
   * The registrar answered but could not check this name (Namecheap's
   * per-name ErrorNo, or no row for it): neither available nor taken. The
   * search shows it as not checked; checkout refuses it.
   */
  checkFailed?: boolean;
  /**
   * Premium names carry their own one-year prices (without the ICANN fee,
   * which is `icannFeeUsd`). The automatic flow offers a premium name only
   * when both marked-up prices are within the price cap.
   */
  premiumRegisterUsd?: string;
  premiumRenewUsd?: string;
  /** The ICANN fee the registrar adds to a premium name's prices. */
  icannFeeUsd?: string;
  /**
   * A new ending's early-access phase adds a fee on top of the price
   * (Namecheap's EapFee); the automatic flow refuses such names.
   */
  earlyAccessFeeUsd?: string;
};
/** Names per availability request (Namecheap's domains.check limit). */
export const CHECK_BATCH = 50;
/**
 * A premium name's one-year registration and renewal cost in USD (premium
 * price plus the ICANN fee), or null when the name is not premium or its
 * prices are not both readable.
 */
export function premiumCostUsd(availability: Availability) {
  if (!availability.premium) return null;
  const add = (price: string | undefined) => {
    const base = Number(money(price) ?? NaN);
    const fee = Number(money(availability.icannFeeUsd) ?? 0);
    return Number.isFinite(base) && base > 0
      ? (base + fee).toFixed(4)
      : undefined;
  };
  const registerUsd = add(availability.premiumRegisterUsd),
    renewUsd = add(availability.premiumRenewUsd);
  return registerUsd && renewUsd ? { registerUsd, renewUsd } : null;
}
export type TldPrice = {
  tld: string;
  registerUsd: string;
  renewUsd: string;
};
export type Registrant = {
  firstName: string;
  lastName: string;
  /** The platform company: required, the registrant is never a trainer. */
  organization: string;
  address1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
};
export type HostRecord = {
  name: string;
  type: "A" | "AAAA" | "CNAME" | "TXT";
  address: string;
  ttl: number;
};
export type RegistrationResult = {
  registered: boolean;
  domainId?: string;
  orderId?: string;
  transactionId?: string;
  chargedUsd?: string;
};
export type DomainInfo = {
  expiresAt?: string;
  createdAt?: string;
  whoisPrivacy?: boolean;
  usingRegistrarDns?: boolean;
};
export type ListedDomain = {
  domain: string;
  expiresAt?: string;
  expired: boolean;
};
export type RenewalResult = {
  renewed: boolean;
  expiresAt?: string;
  chargedUsd?: string;
  orderId?: string;
  transactionId?: string;
};
export type Balance = { currency: string; available: string };
/** Where a domain is delegated, as the registrar reports it. */
export type NameserverState = {
  /** Lower case, without a trailing dot. */
  nameservers: string[];
  /** The domain uses the registrar's own DNS (its host records are served). */
  usingRegistrarDns: boolean;
  /** The registry has not applied the last change yet (the registrar said so). */
  pending?: boolean;
};
/** What the registrar's API can do automatically (absent: everything). */
export type RegistrarCapabilities = {
  register: boolean;
  renew: boolean;
  /**
   * false: a domain cannot be returned to the registrar's own DNS, or given
   * host records there, through the API (its DNS zone needs a panel action).
   */
  registrarDns?: boolean;
  /**
   * false: premium names cannot be bought or renewed at their premium price
   * through the API, so they are never offered.
   */
  premium?: boolean;
};
/** Whether this registrar can buy through its API. */
export const canRegister = (registrar: Registrar) =>
  registrar.capabilities?.register !== false;
/** Whether this registrar can renew through its API. */
export const canRenew = (registrar: Registrar) =>
  registrar.capabilities?.renew !== false;
/** Whether premium names can be bought and renewed at their premium price. */
export const canBuyPremium = (registrar: Registrar) =>
  registrar.capabilities?.premium !== false;
/**
 * Registrars whose own DNS cannot be set up through their API: their
 * domains are served only by the DNS host (DigitalOcean).
 */
export const REGISTRARS_WITHOUT_API_DNS: ReadonlySet<string> = new Set([
  "101domain",
]);
/** Whether the registrar's own DNS can serve a domain (set up through its API). */
export const canUseRegistrarDns = (registrar: Registrar | string) =>
  typeof registrar === "string"
    ? !REGISTRARS_WITHOUT_API_DNS.has(registrar)
    : registrar.capabilities?.registrarDns !== false &&
      !REGISTRARS_WITHOUT_API_DNS.has(registrar.id);
/** A fetch-like function; only the isolated Node test runner may inject one. */
export type RegistrarTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;
function testTransport(transport: RegistrarTransport | undefined) {
  if (!transport) return undefined;
  if (!process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === "production")
    throw new ConfigurationError(
      "A registrar test transport is unavailable outside the isolated Node test runner.",
    );
  return transport;
}

/**
 * `definitive`: the registrar answered and refused. `unknown`: no usable
 * answer (network, timeout, server error, unreadable body); a purchase or
 * renewal may still have happened and must be reconciled.
 */
export class RegistrarError extends Error {
  constructor(
    message: string,
    readonly outcome: "definitive" | "unknown",
    readonly code?: string,
  ) {
    super(message);
    this.name = "RegistrarError";
  }
}
/**
 * `RegistrarError.code` of a pricing answer that says the ending is not
 * sold through the API (the registrar answered readably with no one-year
 * product for it, or refused the ending itself). `REQUIREMENTS`: sold, but
 * only with registrant documents.
 */
export const NOT_SOLD = "NOT_SOLD";
/**
 * True only when a pricing error is the registrar's own answer that the
 * ending cannot be bought through the API. Every other error, including a
 * definitive refusal of the request itself (credentials, a client address
 * that is not whitelisted, throttling, an unknown code), says nothing about
 * the ending and must never be remembered as "not offered".
 */
export function endingNotSold(error: unknown) {
  return (
    error instanceof RegistrarError &&
    error.outcome === "definitive" &&
    (error.code === NOT_SOLD || error.code === "REQUIREMENTS")
  );
}
/**
 * Namecheap error numbers for an ending its API does not sell (2030280
 * "TLD is not supported in API", "Tld for '<name>' is not found").
 */
const NAMECHEAP_UNSUPPORTED_TLD = new Set(["2030280"]);

export interface Registrar {
  readonly id: RegistrarId;
  /** Whether the connection points at the registrar's test environment. */
  readonly sandbox: boolean;
  /** Availability of many names (batched per CHECK_BATCH where the API allows). */
  check(domains: string[]): Promise<Availability[]>;
  /**
   * One-year USD registration and renewal cost of an ending, the ICANN fee
   * included. A RegistrarError "definitive" means the ending is not sold
   * through the API (unsupported, or it needs registrant documents).
   */
  pricing(tld: string): Promise<TldPrice>;
  register(input: {
    domain: string;
    years: number;
    registrant: Registrant;
    /** A premium name's registration price (without the ICANN fee), as checked. */
    premiumPriceUsd?: string;
  }): Promise<RegistrationResult>;
  /** Domains in this registrar account whose name matches `domain` exactly. */
  list(domain: string): Promise<ListedDomain[]>;
  info(domain: string): Promise<DomainInfo>;
  /** Replaces every host record of the domain with exactly `hosts`. */
  setHosts(domain: string, hosts: HostRecord[]): Promise<void>;
  getHosts(domain: string): Promise<HostRecord[]>;
  renew(
    domain: string,
    years: number,
    options?: {
      /** A premium name's renewal price (without the ICANN fee), as quoted. */
      premiumPriceUsd?: string;
    },
  ): Promise<RenewalResult>;
  balance(): Promise<Balance>;
  /** The domain's current nameservers at the registrar. */
  getNameservers(domain: string): Promise<NameserverState>;
  /**
   * Delegates the domain to `nameservers` (2 to 12 host names), or back to
   * the registrar's own DNS with null; returns the state read back after the
   * change. Sending the same list again changes nothing.
   */
  setNameservers(
    domain: string,
    nameservers: string[] | null,
  ): Promise<NameserverState>;
  readonly capabilities?: RegistrarCapabilities;
  /**
   * Whether a registration order for the name is still being processed at
   * the registrar (registrars that register asynchronously).
   */
  pendingOrder?(domain: string): Promise<boolean>;
}
const NAMESERVER =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const nameserverName = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
/** Validated, normalised nameserver list (2 to 12 distinct host names). */
export function nameserverList(nameservers: string[]) {
  const list = [...new Set(nameservers.map(nameserverName))];
  if (
    list.length < 2 ||
    list.length > 12 ||
    list.some((name) => !NAMESERVER.test(name))
  )
    throw new RegistrarError(
      "Nameservers must be 2 to 12 host names",
      "definitive",
      "INVALID_NAMESERVERS",
    );
  return list;
}

// ---- A small XML reader ------------------------------------------------------
// Namecheap answers plain XML documents (a root element, attributes, nested
// elements and short text). This reader accepts exactly that: no DOCTYPE, no
// entity definitions and no external references are ever processed.
export type XmlElement = {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
};
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}
const localName = (name: string) => name.slice(name.indexOf(":") + 1);
export function parseXml(source: string): XmlElement {
  if (source.length > 2 * 1024 * 1024) throw new Error("XML too large");
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("XML document type declarations are not accepted");
  const tokens = source.match(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g,
  );
  if (!tokens) throw new Error("Empty XML document");
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<?")) continue;
    if (token.startsWith("<![CDATA[")) {
      if (stack.length) stack.at(-1)!.text += token.slice(9, -3);
      continue;
    }
    if (token.startsWith("</")) {
      const name = localName(token.slice(2, -1).trim());
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error("Mismatched XML tag");
      continue;
    }
    if (token.startsWith("<")) {
      const match = /^<([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(token);
      if (!match) throw new Error("Malformed XML tag");
      const element: XmlElement = {
        name: localName(match[1]),
        attributes: {},
        children: [],
        text: "",
      };
      const attributes = match[2];
      const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let consumed = "";
      for (const attribute of attributes.matchAll(pattern)) {
        element.attributes[localName(attribute[1])] = decodeEntities(
          attribute[3] ?? attribute[4] ?? "",
        );
        consumed += attribute[0];
      }
      if (
        attributes.replace(/\s+/g, "").length !==
        consumed.replace(/\s+/g, "").length
      )
        throw new Error("Malformed XML attributes");
      if (stack.length) stack.at(-1)!.children.push(element);
      else if (root) throw new Error("XML has more than one root element");
      else root = element;
      if (!match[3]) stack.push(element);
      continue;
    }
    if (stack.length) stack.at(-1)!.text += decodeEntities(token);
    else if (token.trim()) throw new Error("Text outside the XML root");
  }
  if (!root || stack.length) throw new Error("Unterminated XML document");
  return root;
}
export function xmlChild(element: XmlElement | undefined, name: string) {
  return element?.children.find(
    (child) => child.name.toLowerCase() === name.toLowerCase(),
  );
}
export function xmlChildren(element: XmlElement | undefined, name: string) {
  return (element?.children ?? []).filter(
    (child) => child.name.toLowerCase() === name.toLowerCase(),
  );
}
const truthy = (value: string | undefined) =>
  (value ?? "").trim().toLowerCase() === "true";

/** Namecheap dates are "MM/DD/YYYY" (optionally with a time); returns an ISO date-time or undefined. */
export function registrarDate(value: string | undefined) {
  const match =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(
      (value ?? "").trim(),
    );
  if (match) {
    const date = new Date(
      Date.UTC(
        Number(match[3]),
        Number(match[1]) - 1,
        Number(match[2]),
        Number(match[4] ?? 0),
        Number(match[5] ?? 0),
        Number(match[6] ?? 0),
      ),
    );
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
const money = (value: string | undefined) => {
  const text = (value ?? "").trim();
  return /^\d{1,9}(\.\d+)?$/.test(text) ? text : undefined;
};
const errorText = (value: string) =>
  value.replace(/\s+/g, " ").trim().slice(0, 300) ||
  "Registrar refused the request";

// ---- Namecheap -------------------------------------------------------------

export const NAMECHEAP_ENDPOINTS = {
  production: "https://api.namecheap.com/xml.response",
  sandbox: "https://api.sandbox.namecheap.com/xml.response",
} as const;
export type NamecheapSettings = {
  apiUser: string;
  apiKey: string;
  username: string;
  clientIp: string;
  sandbox: boolean;
};
function splitDomain(domain: string) {
  const dot = domain.indexOf(".");
  if (dot < 1) throw new RegistrarError("Invalid domain", "definitive");
  return { sld: domain.slice(0, dot), tld: domain.slice(dot + 1) };
}
function contactFields(registrant: Registrant) {
  const fields: Record<string, string> = {};
  for (const role of ["Registrant", "Tech", "Admin", "AuxBilling"]) {
    fields[role + "FirstName"] = registrant.firstName;
    fields[role + "LastName"] = registrant.lastName;
    if (registrant.organization)
      fields[role + "OrganizationName"] = registrant.organization;
    fields[role + "Address1"] = registrant.address1;
    fields[role + "City"] = registrant.city;
    fields[role + "StateProvince"] = registrant.stateProvince;
    fields[role + "PostalCode"] = registrant.postalCode;
    fields[role + "Country"] = registrant.country;
    fields[role + "Phone"] = registrant.phone;
    fields[role + "EmailAddress"] = registrant.email;
  }
  return fields;
}
/**
 * Endings whose Namecheap registration needs extended attributes (nexus,
 * residency or registrant documents; Namecheap's domains.create
 * documentation). They are never offered: the platform company registers
 * without them.
 */
export const NAMECHEAP_EXTENDED_ATTRIBUTE_TLDS: ReadonlySet<string> = new Set([
  "us",
  "eu",
  "ca",
  "co.uk",
  "org.uk",
  "me.uk",
  "nu",
  "com.au",
  "net.au",
  "org.au",
  "es",
  "nom.es",
  "com.es",
  "org.es",
  "de",
  "fr",
]);
/** Namecheap's premium order fields, or none for a regular name. */
function premiumFields(
  premiumPriceUsd: string | undefined,
): Record<string, string> {
  const price = money(premiumPriceUsd);
  if (premiumPriceUsd !== undefined && !price)
    throw new RegistrarError("Invalid premium price", "definitive");
  return price ? { IsPremiumDomain: "true", PremiumPrice: price } : {};
}
/** Form fields of one domains.dns.setHosts call: every record, numbered from 1. */
export function namecheapHostFields(domain: string, hosts: HostRecord[]) {
  const { sld, tld } = splitDomain(domain);
  const fields: Record<string, string> = { SLD: sld, TLD: tld };
  hosts.forEach((host, index) => {
    const n = String(index + 1);
    fields["HostName" + n] = host.name;
    fields["RecordType" + n] = host.type;
    fields["Address" + n] = host.address;
    fields["TTL" + n] = String(host.ttl);
  });
  return fields;
}

export class NamecheapRegistrar implements Registrar {
  readonly id = "namecheap" as const;
  readonly sandbox: boolean;
  readonly endpoint: string;
  private readonly transport?: RegistrarTransport;
  constructor(
    private readonly settings: NamecheapSettings,
    options: { transport?: RegistrarTransport } = {},
  ) {
    this.transport = testTransport(options.transport);
    this.sandbox = settings.sandbox;
    // The local mock-provider sandbox may point the adapter at a loopback
    // double; the override is ignored everywhere else.
    const override = sandboxOverride("NAMECHEAP_API_BASE_URL");
    this.endpoint = override
      ? new URL("/xml.response", override).toString()
      : NAMECHEAP_ENDPOINTS[settings.sandbox ? "sandbox" : "production"];
  }
  /** Runs one command; returns its CommandResponse element. */
  async command(command: string, params: Record<string, string>) {
    const body = new URLSearchParams({
      ApiUser: this.settings.apiUser,
      ApiKey: this.settings.apiKey,
      UserName: this.settings.username,
      ClientIp: this.settings.clientIp,
      Command: "namecheap." + command,
      ...params,
    });
    let response: Response;
    try {
      // POST keeps the key and registrant details out of request-line logs.
      const init = {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(45000),
      };
      response = this.transport
        ? await this.transport(this.endpoint, init)
        : await integrationRequest(this.endpoint, init);
    } catch {
      throw new RegistrarError("Namecheap could not be reached", "unknown");
    }
    let root: XmlElement;
    try {
      const text = await response.text();
      if (!response.ok) throw new Error("status");
      root = parseXml(text);
    } catch {
      throw new RegistrarError(
        `Namecheap answer was not readable (HTTP ${response.status})`,
        "unknown",
      );
    }
    if (root.name !== "ApiResponse")
      throw new RegistrarError("Namecheap answer was not readable", "unknown");
    const status = (root.attributes.Status ?? "").toUpperCase();
    if (status === "ERROR") {
      const error = xmlChild(xmlChild(root, "Errors"), "Error");
      throw new RegistrarError(
        errorText(error?.text ?? ""),
        "definitive",
        error?.attributes.Number,
      );
    }
    const result = xmlChild(root, "CommandResponse");
    if (status !== "OK" || !result)
      throw new RegistrarError("Namecheap answer was not readable", "unknown");
    return result;
  }
  /** One domains.check per 50 names (Namecheap's limit per request). */
  async check(domains: string[]) {
    const out: Availability[] = [];
    for (let i = 0; i < domains.length; i += CHECK_BATCH) {
      const result = await this.command("domains.check", {
        DomainList: domains.slice(i, i + CHECK_BATCH).join(","),
      });
      for (const item of xmlChildren(result, "DomainCheckResult")) {
        const eap = money(item.attributes.EapFee);
        const premium = truthy(item.attributes.IsPremiumName);
        // A name Namecheap could not check (ErrorNo other than 0) is never
        // offered, and is not reported as taken either.
        const checkFailed = (item.attributes.ErrorNo ?? "0").trim() !== "0";
        out.push({
          domain: (item.attributes.Domain ?? "").toLowerCase(),
          available: truthy(item.attributes.Available) && !checkFailed,
          ...(checkFailed ? { checkFailed: true } : {}),
          premium,
          premiumRegisterUsd: premium
            ? money(item.attributes.PremiumRegistrationPrice)
            : undefined,
          premiumRenewUsd: premium
            ? money(item.attributes.PremiumRenewalPrice)
            : undefined,
          icannFeeUsd: premium ? money(item.attributes.IcannFee) : undefined,
          // Anything but a readable zero is treated as a fee (refused).
          earlyAccessFeeUsd:
            item.attributes.EapFee === undefined ||
            (eap !== undefined && Number(eap) === 0)
              ? undefined
              : (eap ?? "unknown"),
        });
      }
    }
    return out;
  }
  async pricing(tld: string): Promise<TldPrice> {
    // Endings whose registration needs extended attributes (registrant
    // documents or residency) cannot be bought for a trainer automatically.
    if (NAMECHEAP_EXTENDED_ATTRIBUTE_TLDS.has(tld))
      throw new RegistrarError(
        `.${tld} needs registrant details Namecheap calls extended attributes`,
        "definitive",
        "REQUIREMENTS",
      );
    let result: XmlElement;
    try {
      result = await this.command("users.getPricing", {
        ProductType: "DOMAIN",
        ProductName: tld.toUpperCase(),
      });
    } catch (error) {
      // Only Namecheap's "this ending is not supported" is an answer about
      // the ending; a refused request (credentials, client address,
      // throttling) says nothing about it.
      if (
        error instanceof RegistrarError &&
        error.outcome === "definitive" &&
        NAMECHEAP_UNSUPPORTED_TLD.has(error.code ?? "")
      )
        throw new RegistrarError(error.message, "definitive", NOT_SOLD);
      throw error;
    }
    const types = xmlChildren(
      xmlChild(result, "UserGetPricingResult"),
      "ProductType",
    );
    const price = (category: string) => {
      for (const type of types)
        for (const group of xmlChildren(type, "ProductCategory")) {
          if ((group.attributes.Name ?? "").toLowerCase() !== category)
            continue;
          for (const product of xmlChildren(group, "Product")) {
            if ((product.attributes.Name ?? "").toLowerCase() !== tld) continue;
            const year = xmlChildren(product, "Price").find(
              (p) =>
                p.attributes.Duration === "1" &&
                (p.attributes.DurationType ?? "").toUpperCase() === "YEAR" &&
                (p.attributes.Currency ?? "USD").toUpperCase() === "USD",
            );
            const base =
              money(year?.attributes.YourPrice) ??
              money(year?.attributes.Price);
            // Namecheap spells this attribute "YourAdditonalCost"; the ICANN fee
            // is charged on top of the price.
            const extra =
              money(year?.attributes.YourAdditonalCost) ??
              money(year?.attributes.YourAdditionalCost) ??
              money(year?.attributes.AdditionalCost) ??
              "0";
            if (base) return (Number(base) + Number(extra)).toFixed(4);
          }
        }
      return undefined;
    };
    const registerUsd = price("register"),
      renewUsd = price("renew");
    // A readable answer without a one-year product: the API does not sell
    // this ending (live for .ae on 28 September 2026).
    if (!registerUsd || !renewUsd)
      throw new RegistrarError(
        `Namecheap has no one-year price for .${tld}`,
        "definitive",
        NOT_SOLD,
      );
    return { tld, registerUsd, renewUsd };
  }
  async register(input: {
    domain: string;
    years: number;
    registrant: Registrant;
    premiumPriceUsd?: string;
  }) {
    const result = await this.command("domains.create", {
      DomainName: input.domain,
      Years: String(input.years),
      ...contactFields(input.registrant),
      AddFreeWhoisguard: "yes",
      WGEnabled: "yes",
      // A premium name is bought only at the premium price that was checked
      // and paid for; Namecheap refuses the order if its price differs.
      ...premiumFields(input.premiumPriceUsd),
    });
    const created = xmlChild(result, "DomainCreateResult");
    if (!created)
      throw new RegistrarError("Namecheap answer was not readable", "unknown");
    return {
      registered: truthy(created.attributes.Registered),
      domainId: created.attributes.DomainID,
      orderId: created.attributes.OrderID,
      transactionId: created.attributes.TransactionID,
      chargedUsd: money(created.attributes.ChargedAmount),
    };
  }
  async list(domain: string) {
    const result = await this.command("domains.getList", {
      ListType: "ALL",
      SearchTerm: domain,
      PageSize: "20",
      Page: "1",
    });
    return xmlChildren(xmlChild(result, "DomainGetListResult"), "Domain")
      .map((item) => ({
        domain: (item.attributes.Name ?? "").toLowerCase(),
        expiresAt: registrarDate(item.attributes.Expires),
        expired: truthy(item.attributes.IsExpired),
      }))
      .filter((item) => item.domain === domain.toLowerCase());
  }
  async info(domain: string) {
    const result = await this.command("domains.getInfo", {
      DomainName: domain,
    });
    const info = xmlChild(result, "DomainGetInfoResult");
    if (!info)
      throw new RegistrarError("Namecheap answer was not readable", "unknown");
    const details = xmlChild(info, "DomainDetails");
    return {
      createdAt: registrarDate(xmlChild(details, "CreatedDate")?.text),
      expiresAt: registrarDate(xmlChild(details, "ExpiredDate")?.text),
      whoisPrivacy: truthy(xmlChild(info, "Whoisguard")?.attributes.Enabled),
      usingRegistrarDns: truthy(
        xmlChild(info, "DnsDetails")?.attributes.IsUsingOurDNS,
      ),
    };
  }
  async setHosts(domain: string, hosts: HostRecord[]) {
    const result = await this.command(
      "domains.dns.setHosts",
      namecheapHostFields(domain, hosts),
    );
    const done = xmlChild(result, "DomainDNSSetHostsResult");
    if (!truthy(done?.attributes.IsSuccess))
      throw new RegistrarError(
        "Namecheap did not confirm the DNS records",
        "unknown",
      );
  }
  async getHosts(domain: string) {
    const { sld, tld } = splitDomain(domain);
    const result = await this.command("domains.dns.getHosts", {
      SLD: sld,
      TLD: tld,
    });
    return xmlChildren(xmlChild(result, "DomainDNSGetHostsResult"), "host").map(
      (host) => ({
        name: host.attributes.Name ?? "",
        type: (host.attributes.Type ?? "").toUpperCase() as HostRecord["type"],
        address: host.attributes.Address ?? "",
        ttl: Number(host.attributes.TTL ?? 0),
      }),
    );
  }
  async renew(
    domain: string,
    years: number,
    options: { premiumPriceUsd?: string } = {},
  ) {
    const result = await this.command("domains.renew", {
      DomainName: domain,
      Years: String(years),
      ...premiumFields(options.premiumPriceUsd),
    });
    const renewed = xmlChild(result, "DomainRenewResult");
    if (!renewed)
      throw new RegistrarError("Namecheap answer was not readable", "unknown");
    return {
      renewed: truthy(renewed.attributes.Renew),
      expiresAt: registrarDate(
        xmlChild(xmlChild(renewed, "DomainDetails"), "ExpiredDate")?.text,
      ),
      chargedUsd: money(renewed.attributes.ChargedAmount),
      orderId: renewed.attributes.OrderID,
      transactionId: renewed.attributes.TransactionID,
    };
  }
  async getNameservers(domain: string): Promise<NameserverState> {
    const { sld, tld } = splitDomain(domain);
    const result = await this.command("domains.dns.getList", {
      SLD: sld,
      TLD: tld,
    });
    const list = xmlChild(result, "DomainDNSGetListResult");
    if (!list)
      throw new RegistrarError("Namecheap answer was not readable", "unknown");
    return {
      nameservers: xmlChildren(list, "Nameserver")
        .map((item) => nameserverName(item.text))
        .filter(Boolean),
      usingRegistrarDns: truthy(list.attributes.IsUsingOurDNS),
    };
  }
  async setNameservers(domain: string, nameservers: string[] | null) {
    const { sld, tld } = splitDomain(domain);
    // setCustom replaces the whole list; setDefault returns the domain to
    // Namecheap's own DNS (host records are served only then).
    const result = nameservers
      ? await this.command("domains.dns.setCustom", {
          SLD: sld,
          TLD: tld,
          Nameservers: nameserverList(nameservers).join(","),
        })
      : await this.command("domains.dns.setDefault", { SLD: sld, TLD: tld });
    const done = xmlChild(
      result,
      nameservers ? "DomainDNSSetCustomResult" : "DomainDNSSetDefaultResult",
    );
    if (!done)
      throw new RegistrarError(
        "Namecheap did not confirm the nameserver change",
        "unknown",
      );
    // The read-back is the evidence, not the confirmation attribute.
    return this.getNameservers(domain);
  }
  async balance() {
    const result = await this.command("users.getBalances", {});
    const balance = xmlChild(result, "UserGetBalancesResult");
    const available = money(balance?.attributes.AvailableBalance);
    if (!available)
      throw new RegistrarError("Namecheap answer was not readable", "unknown");
    return { currency: balance?.attributes.Currency ?? "USD", available };
  }
}

// ---- Generic JSON registrar ----------------------------------------------

/**
 * The generic adapter speaks a small JSON contract with a bearer key
 * (DOMAIN_API_URL, DOMAIN_API_KEY), documented in docs/features/web-addresses.md.
 */
export class GenericRegistrar implements Registrar {
  readonly id = "generic" as const;
  /** The generic API has no test environment: it is live except in the local mock-provider sandbox. */
  readonly sandbox: boolean;
  private readonly transport?: RegistrarTransport;
  constructor(
    private readonly base: string,
    private readonly key: string,
    options: { transport?: RegistrarTransport; sandbox?: boolean } = {},
  ) {
    this.transport = testTransport(options.transport);
    this.sandbox = options.sandbox === true;
  }
  private async call(
    method: string,
    path: string,
    body?: unknown,
    allow404 = false,
  ): Promise<any> {
    let response: Response;
    try {
      const url = new URL(path, this.base.replace(/\/?$/, "/")).toString();
      const init = {
        method,
        headers: {
          Authorization: "Bearer " + this.key,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      };
      response = this.transport
        ? await this.transport(url, init)
        : await integrationRequest(url, init);
    } catch {
      throw new RegistrarError("The registrar could not be reached", "unknown");
    }
    if (allow404 && response.status === 404) return null;
    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new RegistrarError(
        `The registrar answer was not readable (HTTP ${response.status})`,
        "unknown",
      );
    }
    if (response.status >= 500 || response.status === 429)
      throw new RegistrarError(
        `The registrar is unavailable (HTTP ${response.status})`,
        "unknown",
      );
    if (!response.ok)
      throw new RegistrarError(
        errorText(String(data?.error ?? data?.message ?? "")),
        "definitive",
        String(response.status),
      );
    return data;
  }
  /**
   * POST v1/domains/check {domains} → {results}, up to 50 names a call. A
   * registrar built to the earlier contract (GET v1/domains/check?domain=,
   * one name a call) answers the POST with 404 or 405: its names are then
   * checked one by one. An answer without `results` is unreadable, never
   * "every name taken".
   */
  async check(domains: string[]) {
    const out: Availability[] = [];
    for (let i = 0; i < domains.length; i += CHECK_BATCH) {
      const chunk = domains.slice(i, i + CHECK_BATCH);
      let data: any;
      try {
        data = await this.call("POST", "v1/domains/check", {
          domains: chunk,
        });
      } catch (error) {
        if (
          error instanceof RegistrarError &&
          (error.code === "404" || error.code === "405")
        ) {
          for (const domain of chunk) out.push(await this.checkOne(domain));
          continue;
        }
        throw error;
      }
      if (!Array.isArray(data?.results))
        throw new RegistrarError(
          "The registrar answer was not readable",
          "unknown",
        );
      const rows: any[] = data.results;
      for (const domain of chunk) {
        const row = rows.find(
          (r) => String(r?.domain ?? "").toLowerCase() === domain,
        );
        const premium = row?.premium === true;
        out.push({
          domain,
          available: row?.available === true,
          ...(row ? {} : { checkFailed: true }),
          premium,
          premiumRegisterUsd: premium
            ? money(String(row?.premiumRegisterUsd ?? ""))
            : undefined,
          premiumRenewUsd: premium
            ? money(String(row?.premiumRenewUsd ?? ""))
            : undefined,
        });
      }
    }
    return out;
  }
  /** The earlier one-name contract: GET v1/domains/check?domain= → {available, premium}. */
  private async checkOne(domain: string): Promise<Availability> {
    const data = await this.call(
      "GET",
      "v1/domains/check?domain=" + encodeURIComponent(domain),
    );
    if (typeof data?.available !== "boolean")
      return { domain, available: false, premium: false, checkFailed: true };
    const premium = data.premium === true;
    return {
      domain,
      available: data.available === true,
      premium,
      premiumRegisterUsd: premium
        ? money(String(data?.premiumRegisterUsd ?? ""))
        : undefined,
      premiumRenewUsd: premium
        ? money(String(data?.premiumRenewUsd ?? ""))
        : undefined,
    };
  }
  /**
   * GET v1/pricing/<tld> → {currency:"USD", register, renew}; 404 (or an
   * answer without a one-year USD price) means the ending is not sold.
   */
  async pricing(tld: string) {
    const data = await this.call(
      "GET",
      "v1/pricing/" + encodeURIComponent(tld),
      undefined,
      true,
    );
    if (data === null)
      throw new RegistrarError(`.${tld} is not sold`, "definitive", NOT_SOLD);
    const registerUsd = money(String(data?.register ?? "")),
      renewUsd = money(String(data?.renew ?? ""));
    if (!registerUsd || !renewUsd || (data?.currency ?? "USD") !== "USD")
      throw new RegistrarError(
        `No one-year USD price for .${tld}`,
        "definitive",
        NOT_SOLD,
      );
    return { tld, registerUsd, renewUsd };
  }
  async register(input: {
    domain: string;
    years: number;
    registrant: Registrant;
    premiumPriceUsd?: string;
  }) {
    const data = await this.call("POST", "v1/domains", {
      domain: input.domain,
      years: input.years,
      registrant: input.registrant,
      privacy: true,
      ...(input.premiumPriceUsd
        ? { premiumPriceUsd: input.premiumPriceUsd }
        : {}),
    });
    return {
      registered: String(data?.domain ?? "").toLowerCase() === input.domain,
      domainId: data?.id ? String(data.id) : undefined,
      chargedUsd: money(String(data?.chargedUsd ?? "")),
    };
  }
  async list(domain: string) {
    const data = await this.call(
      "GET",
      "v1/domains?search=" + encodeURIComponent(domain),
    );
    return (Array.isArray(data?.data) ? data.data : [])
      .map((item: any) => ({
        domain: String(item?.domain ?? "").toLowerCase(),
        expiresAt: registrarDate(item?.expiresAt),
        expired: item?.expired === true,
      }))
      .filter((item: ListedDomain) => item.domain === domain.toLowerCase());
  }
  async info(domain: string) {
    const data = await this.call(
      "GET",
      "v1/domains/" + encodeURIComponent(domain),
    );
    return {
      expiresAt: registrarDate(data?.expiresAt),
      whoisPrivacy: data?.privacy === true,
    };
  }
  async setHosts(domain: string, hosts: HostRecord[]) {
    await this.call(
      "PUT",
      "v1/domains/" + encodeURIComponent(domain) + "/records",
      {
        records: hosts.map((host) => ({
          type: host.type,
          name: host.name,
          value: host.address,
          ttl: host.ttl,
        })),
      },
    );
  }
  async getHosts(domain: string) {
    const data = await this.call(
      "GET",
      "v1/domains/" + encodeURIComponent(domain) + "/records",
    );
    return (Array.isArray(data?.records) ? data.records : []).map(
      (record: any) => ({
        name: String(record?.name ?? ""),
        type: String(record?.type ?? "").toUpperCase() as HostRecord["type"],
        address: String(record?.value ?? ""),
        ttl: Number(record?.ttl ?? 0),
      }),
    );
  }
  async renew(
    domain: string,
    years: number,
    options: { premiumPriceUsd?: string } = {},
  ) {
    const data = await this.call(
      "POST",
      "v1/domains/" + encodeURIComponent(domain) + "/renew",
      {
        years,
        ...(options.premiumPriceUsd
          ? { premiumPriceUsd: options.premiumPriceUsd }
          : {}),
      },
    );
    return {
      renewed: !!data?.expiresAt,
      expiresAt: registrarDate(data?.expiresAt),
      chargedUsd: money(String(data?.chargedUsd ?? "")),
    };
  }
  async getNameservers(domain: string): Promise<NameserverState> {
    const data = await this.call(
      "GET",
      "v1/domains/" + encodeURIComponent(domain) + "/nameservers",
    );
    return genericNameservers(data);
  }
  async setNameservers(domain: string, nameservers: string[] | null) {
    const path = "v1/domains/" + encodeURIComponent(domain) + "/nameservers";
    const data = nameservers
      ? await this.call("PUT", path, {
          nameservers: nameserverList(nameservers),
        })
      : await this.call("DELETE", path);
    return genericNameservers(data);
  }
  async balance() {
    const data = await this.call("GET", "v1/account");
    const available = money(String(data?.balanceUsd ?? ""));
    if (!available)
      throw new RegistrarError(
        "The registrar answer was not readable",
        "unknown",
      );
    return { currency: "USD", available };
  }
}

function genericNameservers(data: any): NameserverState {
  if (!Array.isArray(data?.nameservers))
    throw new RegistrarError(
      "The registrar answer was not readable",
      "unknown",
    );
  return {
    nameservers: data.nameservers.map(nameserverName).filter(Boolean),
    usingRegistrarDns: data.custom !== true,
    pending: data.pending === true,
  };
}

// ---- 101domain ------------------------------------------------------------

export const ONEOHONE_API = "https://api.101domain.com";
/**
 * Endings for which 101domain offers no private registration (the registrant
 * appears in WHOIS); privacy is requested for every other ending.
 */
export const ONEOHONE_NO_PRIVACY_TLDS = new Set(["ae"]);
const ONEOHONE_DNS = /(^|\.)101domain\.com$/;
/**
 * 101domain order statuses. The live read-only check (28 September 2026)
 * saw only "processed" (a finished order) in the account's order history;
 * the others are provisional until registration and renewal are published.
 */
const ONEOHONE_PENDING = ["pending", "processing", "queued", "submitted", "in_progress"];
const ONEOHONE_DONE = ["completed", "complete", "active", "registered", "success"];
const ONEOHONE_REFUSED = ["failed", "rejected", "cancelled", "canceled", "declined"];
/** Statuses of a finished order; any other status counts as still open. */
const ONEOHONE_FINISHED = new Set(["processed", ...ONEOHONE_DONE, ...ONEOHONE_REFUSED]);
/** How far back the order history is read for an open order of a domain. */
const ONEOHONE_OPEN_ORDER_DAYS = 45;
const firstArray = (...values: unknown[]) =>
  (values.find((value) => Array.isArray(value)) as any[] | undefined) ?? [];
const oneYear = (rows: any[]) =>
  rows.find(
    (row) => Number(row?.term_years ?? row?.years ?? row?.term ?? 0) === 1,
  );

/**
 * 101domain's REST API (https://api.101domain.com/v1, bearer key; research
 * of 28 September 2026 in docs/features/web-addresses.md). Availability,
 * prices, domain details, the account balance, nameservers and DNS records
 * are published endpoints. Registration and renewal are announced but not
 * yet published: those calls are sent only when the operator has verified
 * the ordering endpoints (REGISTRAR_101DOMAIN_ORDERING); until then they
 * refuse without sending, and a domain is renewed by the registrar's own
 * auto-renewal, which the renewal step recognises from the expiry date.
 * Field names of the unpublished calls follow the announced endpoint and
 * must be checked against the live API reference before enabling them.
 * The published read calls were checked against the live API on
 * 28 September 2026 (GET only; docs/features/web-addresses.md).
 */
export class OneOhOneRegistrar implements Registrar {
  readonly id = "101domain" as const;
  /** 101domain has no test environment: live except in the local mock-provider sandbox. */
  readonly sandbox: boolean;
  readonly capabilities: RegistrarCapabilities;
  readonly base: string;
  private readonly transport?: RegistrarTransport;
  constructor(
    private readonly key: string,
    options: {
      ordering?: boolean;
      transport?: RegistrarTransport;
      sandbox?: boolean;
    } = {},
  ) {
    this.transport = testTransport(options.transport);
    this.sandbox = options.sandbox === true;
    const ordering = options.ordering === true;
    // Premium names are never offered through 101domain: its registration
    // call is unpublished, so a premium price could not be passed on.
    this.capabilities = {
      register: ordering,
      renew: ordering,
      registrarDns: false,
      premium: false,
    };
    const override = sandboxOverride("REGISTRAR_101DOMAIN_API_BASE_URL");
    this.base = override ? override.origin : ONEOHONE_API;
  }
  /** Sends one request; returns the answer's `data` (null for an allowed 404). */
  private async call(
    method: string,
    path: string,
    body?: unknown,
    options: { allow404?: boolean } = {},
  ): Promise<{ status: number; data: any; body: any } | null> {
    let response: Response;
    try {
      const init = {
        method,
        headers: {
          Authorization: "Bearer " + this.key,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      };
      const url = new URL(path, this.base).toString();
      response = this.transport
        ? await this.transport(url, init)
        : await integrationRequest(url, init);
    } catch {
      throw new RegistrarError("101domain could not be reached", "unknown");
    }
    if (options.allow404 && response.status === 404) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    let answer: any;
    try {
      answer = await response.json();
    } catch {
      throw new RegistrarError(
        `101domain answer was not readable (HTTP ${response.status})`,
        "unknown",
      );
    }
    if (response.status === 429 || response.status >= 500)
      throw new RegistrarError(
        `101domain is unavailable (HTTP ${response.status})`,
        "unknown",
        String(answer?.code ?? response.status),
      );
    if (!response.ok || answer?.status === "error")
      throw new RegistrarError(
        errorText(String(answer?.message ?? "")),
        "definitive",
        String(answer?.code ?? response.status),
      );
    return { status: response.status, data: answer?.data, body: answer };
  }
  private item(entry: any): Availability {
    const pricing = oneYear(firstArray(entry?.pricing, entry?.prices));
    const premium = entry?.premium === true || pricing?.premium === true;
    return {
      domain: String(entry?.domain_name ?? entry?.domain ?? "").toLowerCase(),
      available: entry?.available === true,
      premium,
      premiumRegisterUsd: premium ? money(String(pricing?.register ?? "")) : undefined,
      premiumRenewUsd: premium ? money(String(pricing?.renew ?? "")) : undefined,
    };
  }
  async check(domains: string[]) {
    const out: Availability[] = [];
    // One lookup per call for a single name; at most 50 names per bulk call.
    for (let i = 0; i < domains.length; i += CHECK_BATCH) {
      const chunk = domains.slice(i, i + CHECK_BATCH);
      const answer =
        chunk.length === 1
          ? await this.call(
              "GET",
              "/v1/domains/search?domain_name=" + encodeURIComponent(chunk[0]),
            )
          : await this.call("POST", "/v1/domains/bulk-search", {
              domain_names: chunk,
            });
      const data = answer?.data;
      const rows = Array.isArray(data)
        ? data
        : firstArray(data?.results, data?.domains, data?.items, data ? [data] : []);
      const invalid = new Set(
        firstArray(answer?.body?.invalid, data?.invalid).map((v: any) =>
          String(v?.domain_name ?? v).toLowerCase(),
        ),
      );
      for (const name of chunk) {
        const row = rows.find(
          (r: any) =>
            String(r?.domain_name ?? r?.domain ?? "").toLowerCase() === name,
        );
        out.push(
          row && !invalid.has(name)
            ? this.item(row)
            : {
                domain: name,
                available: false,
                premium: false,
                // No row at all: 101domain did not check this name.
                ...(row || invalid.has(name) ? {} : { checkFailed: true }),
              },
        );
      }
    }
    return out;
  }
  async pricing(tld: string): Promise<TldPrice> {
    const answer = await this.call(
      "GET",
      "/v1/tlds/" + encodeURIComponent(tld.replace(/^\./, "")),
      undefined,
      { allow404: true },
    );
    // An ending 101domain does not know is not sold; any other refusal says
    // nothing about the ending (credentials, scopes, throttling).
    if (answer === null)
      throw new RegistrarError(
        `101domain does not sell .${tld}`,
        "definitive",
        NOT_SOLD,
      );
    const data = answer?.data ?? {};
    // Endings that need documents (a trade licence, a trademark) cannot be
    // bought automatically for a trainer. 101domain answers has_requirements
    // (live: true for .co.ae, false for .com and .ae).
    const requirements = data.registration_requirements ?? data.requirements;
    if (
      data.has_requirements === true ||
      data.requires_documents === true ||
      (Array.isArray(requirements) && requirements.length > 0)
    )
      throw new RegistrarError(
        `.${tld} needs registration documents`,
        "definitive",
        "REQUIREMENTS",
      );
    const year = oneYear(firstArray(data.pricing, data.prices));
    const registerUsd = money(String(year?.register ?? year?.registration ?? "")),
      renewUsd = money(String(year?.renew ?? year?.renewal ?? ""));
    const currency = String(year?.currency ?? data.currency ?? "USD").toUpperCase();
    if (!registerUsd || !renewUsd || currency !== "USD")
      throw new RegistrarError(
        `101domain has no one-year USD price for .${tld}`,
        "definitive",
        NOT_SOLD,
      );
    return { tld, registerUsd, renewUsd };
  }
  async register(input: {
    domain: string;
    years: number;
    registrant: Registrant;
  }): Promise<RegistrationResult> {
    if (!this.capabilities.register)
      throw new RegistrarError(
        "Registration through the 101domain API is not enabled",
        "definitive",
        "UNSUPPORTED",
      );
    const tld = input.domain.slice(input.domain.indexOf(".") + 1);
    const contact = {
      first_name: input.registrant.firstName,
      last_name: input.registrant.lastName,
      organization: input.registrant.organization,
      address1: input.registrant.address1,
      city: input.registrant.city,
      state: input.registrant.stateProvince,
      postal_code: input.registrant.postalCode,
      country: input.registrant.country,
      phone: input.registrant.phone,
      email: input.registrant.email,
    };
    const answer = await this.call("POST", "/v1/domains/registration", {
      domain_name: input.domain,
      term_years: input.years,
      // The platform company is every contact; the trainer never is.
      contacts: {
        registrant: contact,
        admin: contact,
        tech: contact,
        billing: contact,
      },
      private_registration: !ONEOHONE_NO_PRIVACY_TLDS.has(tld),
      // Renewal follows the trainer's paid yearly subscription.
      auto_renew: false,
    });
    const data = answer?.data ?? {};
    const status = String(data.status ?? data.order_status ?? "").toLowerCase();
    const registered =
      data.registered === true || ONEOHONE_DONE.includes(status);
    // Only an explicit refusal is a definitive "not registered". An order
    // still processing, or an answer without a status this adapter knows,
    // may still become a registration: it is reconciled (pending orders
    // included) before anything is sent again.
    if (!registered && !ONEOHONE_REFUSED.includes(status))
      throw new RegistrarError(
        ONEOHONE_PENDING.includes(status)
          ? "101domain accepted the order but has not registered the name yet"
          : "101domain did not report a final registration status",
        "unknown",
        "PENDING",
      );
    return {
      registered,
      orderId: data.order_number ? String(data.order_number) : undefined,
      domainId: data.domain_id ? String(data.domain_id) : undefined,
      chargedUsd: money(String(data.total ?? data.amount ?? "")),
    };
  }
  /**
   * Whether an order for this domain is still open. The live order list
   * ignores every domain filter tried (domain, domain_name, filter[domain],
   * search) and its rows do not name a domain; only an order's own details
   * list its items with their domain. So the newest orders are read (newest
   * first, 50 a page) back to ONEOHONE_OPEN_ORDER_DAYS, and each one that is
   * not finished is opened. A status this adapter does not know counts as
   * open. Anything unreadable throws, which the caller treats as "still
   * processing": never as a reason to buy or renew again.
   */
  async pendingOrder(domain: string) {
    const name = domain.toLowerCase();
    const since = Date.now() - ONEOHONE_OPEN_ORDER_DAYS * 86400000;
    for (let page = 1; page <= 5; page++) {
      const answer = await this.call(
        "GET",
        `/v1/finance/orders?per_page=50&page=${page}`,
      );
      if (!Array.isArray(answer?.data))
        throw new RegistrarError("101domain answer was not readable", "unknown");
      const rows: any[] = answer.data;
      for (const row of rows) {
        if (ONEOHONE_FINISHED.has(String(row?.status ?? "").toLowerCase())) continue;
        const number = String(row?.order_number ?? "");
        if (!number) return true;
        const detail = await this.call(
          "GET",
          "/v1/finance/orders/" + encodeURIComponent(number),
        );
        const items = detail?.data?.items;
        if (!Array.isArray(items)) return true;
        if (
          items.some(
            (item: any) => String(item?.domain ?? "").toLowerCase() === name,
          )
        )
          return true;
      }
      const pages = Number(answer?.body?.meta?.pagination?.total_pages ?? 1);
      const oldest = Date.parse(String(rows.at(-1)?.order_date ?? ""));
      if (!rows.length || page >= pages || oldest < since) return false;
    }
    // More orders in the window than are read: it cannot be told.
    throw new RegistrarError(
      "101domain has more recent orders than are checked",
      "unknown",
    );
  }
  private listed(row: any): ListedDomain {
    const expiresAt = registrarDate(
      row?.expiration_date ?? row?.expires_at ?? row?.expiry_date,
    );
    return {
      domain: String(row?.domain_name ?? row?.domain ?? "").toLowerCase(),
      expiresAt,
      expired:
        String(row?.status ?? "").toLowerCase() === "expired" ||
        (!!expiresAt && Date.parse(expiresAt) < Date.now()),
    };
  }
  async list(domain: string) {
    const answer = await this.call(
      "GET",
      "/v1/domains?search=" + encodeURIComponent(domain),
    );
    const rows = Array.isArray(answer?.data)
      ? answer.data
      : firstArray(answer?.data?.domains, answer?.data?.items);
    return rows
      .map((row: any) => this.listed(row))
      .filter((item: ListedDomain) => item.domain === domain.toLowerCase());
  }
  async info(domain: string): Promise<DomainInfo> {
    const answer = await this.call(
      "GET",
      "/v1/domains/" + encodeURIComponent(domain),
    );
    const data = answer?.data ?? {};
    const nameservers = firstArray(data.nameservers).map(nameserverName);
    return {
      expiresAt: registrarDate(
        data.expiration_date ?? data.expires_at ?? data.expiry_date,
      ),
      createdAt: registrarDate(
        data.registration_date ?? data.registered_at ?? data.created_at,
      ),
      // The live domain details carry no privacy flag (private registration
      // is an add-on product id): this reads false there. Nothing depends on it.
      whoisPrivacy:
        data.private_registration === true ||
        data.privacy === true ||
        firstArray(data.add_ons, data.addons).some((a: any) =>
          /privacy|private/i.test(String(a?.name ?? a)),
        ),
      usingRegistrarDns:
        nameservers.length > 0 &&
        nameservers.every((ns: string) => ONEOHONE_DNS.test(ns)),
    };
  }
  async renew(domain: string, years: number): Promise<RenewalResult> {
    if (!this.capabilities.renew)
      throw new RegistrarError(
        "Renewal through the 101domain API is not enabled",
        "definitive",
        "UNSUPPORTED",
      );
    const answer = await this.call(
      "POST",
      "/v1/domains/" + encodeURIComponent(domain) + "/renew",
      { term_years: years },
    );
    const data = answer?.data ?? {};
    const status = String(data.status ?? data.order_status ?? "").toLowerCase();
    if (ONEOHONE_REFUSED.includes(status))
      return { renewed: false };
    const expiresAt = registrarDate(data.expiration_date ?? data.expires_at);
    // An accepted order without a new expiry (still processing, or a status
    // this adapter does not know) is reconciled, never counted or refused:
    // the caller also checks that a reported expiry moved past the old one.
    if (
      ONEOHONE_PENDING.includes(status) ||
      (!expiresAt && data.renewed !== true)
    )
      throw new RegistrarError(
        "101domain accepted the renewal but has not reported the new expiry",
        "unknown",
        "PENDING",
      );
    return {
      renewed: true,
      expiresAt,
      chargedUsd: money(String(data.total ?? data.amount ?? "")),
      orderId: data.order_number ? String(data.order_number) : undefined,
    };
  }
  async balance() {
    const answer = await this.call("GET", "/v1/finance/balance");
    const data = answer?.data ?? {};
    // Live answer: { amount_due, credit_balance, currency }.
    const available = money(
      String(
        data.credit_balance ?? data.available_credit ?? data.available ?? data.balance ?? "",
      ),
    );
    if (!available)
      throw new RegistrarError("101domain answer was not readable", "unknown");
    return { currency: String(data.currency ?? "USD").toUpperCase(), available };
  }
  async getNameservers(domain: string): Promise<NameserverState> {
    // Live answer: a plain upper-case list, the nameservers now in force; it
    // has no pending flag, so a change the registry has not applied yet reads
    // as the old list (the worker waits before trusting a lagging read-back).
    const answer = await this.call(
      "GET",
      "/v1/dns/" + encodeURIComponent(domain) + "/nameservers",
    );
    const data = answer?.data;
    const nameservers = (
      Array.isArray(data)
        ? data
        : firstArray(data?.nameservers, data?.current_nameservers)
    )
      .map(nameserverName)
      .filter(Boolean);
    return {
      nameservers,
      usingRegistrarDns:
        nameservers.length > 0 &&
        nameservers.every((ns: string) => ONEOHONE_DNS.test(ns)),
      pending: String(data?.change_status ?? "").toLowerCase() === "pending",
    };
  }
  async setNameservers(domain: string, nameservers: string[] | null) {
    if (!nameservers)
      throw new RegistrarError(
        "Returning a domain to 101domain's DNS is done in its panel",
        "definitive",
        "UNSUPPORTED",
      );
    // 200: already set; 202: accepted, waiting for the registry.
    const answer = await this.call(
      "PUT",
      "/v1/dns/" + encodeURIComponent(domain) + "/nameservers",
      { nameservers: nameserverList(nameservers) },
    );
    const pending =
      answer?.status === 202 ||
      String(answer?.data?.change_status ?? "").toLowerCase() === "pending";
    if (!pending) return this.getNameservers(domain);
    const current = firstArray(answer?.data?.current_nameservers)
      .map(nameserverName)
      .filter(Boolean);
    return { nameservers: current, usingRegistrarDns: false, pending: true };
  }
  async getHosts(domain: string): Promise<HostRecord[]> {
    const answer = await this.call(
      "GET",
      "/v1/dns/" + encodeURIComponent(domain) + "/records",
    );
    const rows = Array.isArray(answer?.data)
      ? answer.data
      : firstArray(answer?.data?.records);
    return rows.map((row: any) => ({
      id: row?.id,
      name: String(row?.name ?? row?.host ?? "") || "@",
      type: String(row?.type ?? "").toUpperCase() as HostRecord["type"],
      address: String(row?.value ?? row?.content ?? row?.data ?? ""),
      ttl: Number(row?.ttl ?? 0),
    }));
  }
  /** Replaces every record: deletes what is not wanted, adds what is missing. */
  async setHosts(domain: string, hosts: HostRecord[]) {
    const path = "/v1/dns/" + encodeURIComponent(domain) + "/records";
    const current = (await this.getHosts(domain)) as Array<
      HostRecord & { id?: unknown }
    >;
    const key = (h: HostRecord) =>
      [h.name.toLowerCase(), h.type, h.address.toLowerCase()].join(" ");
    const wanted = new Set(hosts.map(key));
    const have = new Set(current.map(key));
    const remove = current
      .filter((h) => !wanted.has(key(h)) && h.id !== undefined)
      .map((h) => h.id);
    if (remove.length) await this.call("DELETE", path, { ids: remove });
    const add = hosts.filter((h) => !have.has(key(h)));
    if (add.length)
      await this.call("POST", path, {
        records: add.map((h) => ({
          type: h.type,
          name: h.name,
          value: h.address,
          // 101domain's minimum TTL.
          ttl: Math.max(300, h.ttl),
        })),
      });
  }
}

// ---- Configuration ----------------------------------------------------------

export function namecheapSettings(config: RuntimeConfig): NamecheapSettings {
  const settings = {
    apiUser: config.NAMECHEAP_API_USER?.trim() ?? "",
    apiKey: config.NAMECHEAP_API_KEY?.trim() ?? "",
    username: config.NAMECHEAP_USERNAME?.trim() ?? "",
    clientIp: config.NAMECHEAP_CLIENT_IP?.trim() ?? "",
    // Anything but an explicit "false" uses Namecheap's test environment.
    sandbox: config.NAMECHEAP_SANDBOX?.trim() !== "false",
  };
  if (
    !settings.apiUser ||
    !settings.apiKey ||
    !settings.username ||
    isIP(settings.clientIp) !== 4
  )
    throw new ConfigurationError(
      "Namecheap needs the API user, API key, account username and the whitelisted IPv4 client address.",
    );
  return settings;
}
export function registrantFromConfig(config: RuntimeConfig): Registrant {
  const value = (key: string) =>
    config["WEB_ADDRESS_REGISTRANT_" + key]?.trim() ?? "";
  const registrant = {
    firstName: value("FIRST_NAME"),
    lastName: value("LAST_NAME"),
    // The platform company is always the registrant (owner decision,
    // 28 September 2026): never a trainer.
    organization: value("ORGANIZATION"),
    address1: value("ADDRESS"),
    city: value("CITY"),
    stateProvince: value("STATE"),
    postalCode: value("POSTAL_CODE"),
    country: value("COUNTRY").toUpperCase(),
    phone: value("PHONE"),
    email: value("EMAIL"),
  };
  if (
    !registrant.firstName ||
    !registrant.lastName ||
    !registrant.organization ||
    !registrant.address1 ||
    !registrant.city ||
    !registrant.stateProvince ||
    !registrant.postalCode ||
    !/^[A-Z]{2}$/.test(registrant.country) ||
    !/^\+\d{1,3}\.\d{4,14}$/.test(registrant.phone) ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(registrant.email)
  )
    throw new ConfigurationError(
      "The registrant contact (the platform company) is incomplete; complete it in Super admin settings.",
    );
  return registrant;
}
/**
 * The configured registrar, or ProviderUnavailable. Purchases additionally
 * require WEB_ADDRESS_PURCHASES_ENABLED (checked by the caller). New
 * searches and purchases use it; an existing order always uses the
 * registrar it was bought through (registrarFor).
 */
export function registrarFromConfig(
  config: RuntimeConfig = runtimeConfig(),
): Registrar {
  return registrarFor(
    (config.WEB_ADDRESS_REGISTRAR || "namecheap").trim(),
    config,
  );
}
/**
 * One registrar by id from its own settings, whichever registrar is chosen
 * for new purchases; ProviderUnavailable when its settings are incomplete.
 */
export function registrarFor(
  choice: string,
  config: RuntimeConfig = runtimeConfig(),
): Registrar {
  try {
    if (choice === "101domain") {
      const key = config.REGISTRAR_101DOMAIN_API_KEY?.trim();
      if (!key)
        throw new ConfigurationError("101domain needs its API key.");
      return new OneOhOneRegistrar(key, {
        ordering: config.REGISTRAR_101DOMAIN_ORDERING?.trim() === "true",
        sandbox: providerSandbox() === "mock",
      });
    }
    if (choice === "generic") {
      if (!config.DOMAIN_API_URL?.trim() || !config.DOMAIN_API_KEY?.trim())
        throw new ConfigurationError(
          "The generic registrar needs the Custom domains API URL and key.",
        );
      return new GenericRegistrar(
        config.DOMAIN_API_URL.trim(),
        config.DOMAIN_API_KEY.trim(),
        { sandbox: providerSandbox() === "mock" },
      );
    }
    if (choice !== "namecheap")
      throw new ConfigurationError("Unknown registrar");
    return new NamecheapRegistrar(namecheapSettings(config));
  } catch (error) {
    throw new ProviderUnavailable(
      "registrar",
      error instanceof ConfigurationError
        ? error.message
        : "The domain registrar is not configured",
    );
  }
}

// ---- Payment and registrar environments ------------------------------------

/**
 * Whether the configured registrar connection is a test environment, from
 * settings alone (no connection is made): Namecheap unless its test
 * environment is explicitly off; the generic registrar only in the local
 * mock-provider sandbox.
 */
export function registrarSandboxSetting(
  config: RuntimeConfig = runtimeConfig(),
) {
  const choice = (config.WEB_ADDRESS_REGISTRAR || "namecheap").trim();
  if (choice === "generic" || choice === "101domain")
    return providerSandbox() === "mock";
  return config.NAMECHEAP_SANDBOX?.trim() !== "false";
}
/**
 * Why the configured registrar cannot buy domains through its API, or null:
 * 101domain until its ordering endpoints are verified and switched on.
 * Operators see this text; trainers only see that buying is unavailable.
 */
export function registrarPurchaseProblem(
  config: RuntimeConfig = runtimeConfig(),
) {
  const choice = (config.WEB_ADDRESS_REGISTRAR || "namecheap").trim();
  if (
    choice === "101domain" &&
    config.REGISTRAR_101DOMAIN_ORDERING?.trim() !== "true"
  )
    return "101domain has not published registration and renewal in its API yet. Buy with Namecheap or the generic registrar, or switch on 101domain ordering once its endpoints are verified. Domains already bought keep their own registrar.";
  // Its own DNS cannot be set up through the API: its domains need the DNS host.
  if (
    REGISTRARS_WITHOUT_API_DNS.has(choice) &&
    (config.DNS_PROVIDER || "registrar").trim() !== "digitalocean"
  )
    return `${choice} domains are served only through DigitalOcean DNS: its own DNS cannot be set up through its API. Choose DigitalOcean in DNS hosting first.`;
  return null;
}
/** Stripe's mode from the secret key prefix, or null when it cannot be told. */
export function stripeKeyMode(
  config: RuntimeConfig = runtimeConfig(),
): "live" | "test" | null {
  const key = config.STRIPE_SECRET_KEY?.trim() ?? "";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return null;
}
/**
 * Why a payment in this Stripe mode must not buy or renew at this registrar
 * environment, or null when they match. Real money never buys in a test
 * environment, and a test payment never buys a real domain.
 */
export function paymentModeProblem(
  livemode: boolean | null | undefined,
  registrarSandbox: boolean,
) {
  if (typeof livemode !== "boolean")
    return "The Stripe mode of this payment is unknown.";
  if (livemode && registrarSandbox)
    return "A live Stripe payment would only buy in the registrar's test environment.";
  if (!livemode && !registrarSandbox)
    return "A Stripe test payment would buy a real domain.";
  return null;
}
