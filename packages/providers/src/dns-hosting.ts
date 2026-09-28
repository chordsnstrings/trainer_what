/**
 * DNS hosting for bought trainer domains and the platform root domain
 * (docs/features/web-addresses.md, "DNS hosting"): DigitalOcean DNS behind one
 * interface, with the registrar's own DNS as the fallback. Nothing here
 * decides business state: the API records every zone, record and delegation
 * change under a stable intent before calling these functions.
 *
 * Safety rules kept here, in code, whatever the caller asks:
 *  - Zone guard. A DigitalOcean token reaches every domain of its team, so
 *    every zone-level call is refused unless the caller's `mayManage` accepts
 *    the zone (an order's own confirmed domain, or the platform root).
 *  - Takeover guard. Any DigitalOcean account can add a zone nobody holds
 *    there, so a zone is deleted only with evidence that neither the registrar
 *    nor public DNS still delegates the name to DigitalOcean, and the
 *    platform's own root zone is never deleted.
 *  - Records are converged by name and type: only the names and types the
 *    caller manages change; NS, SOA, MX and other records are left alone.
 */
import { isIP } from "node:net";
import { ConfigurationError, runtimeConfig, type RuntimeConfig } from "./configuration.ts";
import { integrationRequest } from "./integrations.ts";
import { ProviderUnavailable } from "./index.ts";
import { sandboxOverride, sandboxResolver } from "./sandbox.ts";
import type { HostRecord, Registrar } from "./registrar.ts";

export type DnsProviderId = "digitalocean" | "registrar";
export type DnsRecord = {
  /** Provider record identifier, when the provider has one. */
  id?: string;
  /** Relative name: "@" for the zone apex, "www", "*". */
  name: string;
  type: string;
  data: string;
  ttl: number;
};
export type DesiredRecord = {
  name: string;
  type: "A" | "AAAA" | "CNAME" | "TXT";
  data: string;
  ttl: number;
};
export type RecordChange =
  | { action: "create"; record: DesiredRecord }
  | { action: "update"; id: string; from: DnsRecord; record: DesiredRecord }
  | { action: "delete"; id: string; record: DnsRecord };
export type ZoneState = "existing" | "created" | "held_elsewhere";
/**
 * What the caller found before releasing a zone. `registrarNameservers` is
 * null when the name is no longer in the platform's registrar account;
 * `publicNameservers` is "nxdomain" when public DNS no longer knows it.
 */
export type ZoneReleaseEvidence = {
  registrarNameservers: string[] | null;
  publicNameservers: string[] | "nxdomain";
};

/** A fetch-like function; only the isolated Node test runner may inject one. */
export type DnsTransport = (url: string, init: RequestInit) => Promise<Response>;
function testTransport(transport: DnsTransport | undefined) {
  if (!transport) return undefined;
  if (!process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === "production")
    throw new ConfigurationError(
      "A DNS test transport is unavailable outside the isolated Node test runner.",
    );
  return transport;
}

/**
 * `definitive`: the provider answered and refused (nothing changed).
 * `unknown`: no usable answer (network, timeout, rate limit, server error);
 * the change may or may not have happened and is read back before a retry.
 */
export class DnsError extends Error {
  constructor(
    message: string,
    readonly outcome: "definitive" | "unknown",
    readonly code?: string,
    /** When the provider asked to wait (rate limit), in milliseconds. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "DnsError";
  }
}

export interface DnsProvider {
  readonly id: DnsProviderId;
  /** The nameservers to delegate the domain to, or null for the registrar's own DNS. */
  nameservers(): string[] | null;
  /** The zone when this account holds it, or null. */
  getZone(zone: string): Promise<{ name: string } | null>;
  /** Creates the zone unless this account already holds it. */
  ensureZone(zone: string): Promise<ZoneState>;
  records(zone: string): Promise<DnsRecord[]>;
  /**
   * Makes the records of every desired (name, type) exactly the desired
   * values; records of `replaceTypes` on the same names are removed (an AAAA
   * or CNAME that would shadow the desired A). Idempotent: a second call
   * with the same input changes nothing.
   */
  upsertRecords(
    zone: string,
    desired: DesiredRecord[],
    options?: { replaceTypes?: string[] },
  ): Promise<{ created: number; updated: number; deleted: number; unchanged: number }>;
  /** Deletes the zone; refused while anything still delegates it here. */
  deleteZone(zone: string, evidence: ZoneReleaseEvidence): Promise<void>;
}

export const DIGITALOCEAN_API = "https://api.digitalocean.com";
export const DIGITALOCEAN_NAMESERVERS = [
  "ns1.digitalocean.com",
  "ns2.digitalocean.com",
  "ns3.digitalocean.com",
] as const;
const DNS_NAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** Lower case without a trailing dot; "" for anything that is not a DNS name. */
export function dnsName(value: unknown) {
  const name = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  return DNS_NAME.test(name) ? name : "";
}
/** Nameserver lists compare as sets of normalised host names. */
export function sameNameservers(a: readonly string[], b: readonly string[]) {
  const left = [...new Set(a.map(dnsName).filter(Boolean))].sort(),
    right = [...new Set(b.map(dnsName).filter(Boolean))].sort();
  return (
    left.length > 0 &&
    left.length === right.length &&
    left.every((value, i) => value === right[i])
  );
}
export const isDigitalOceanNameserver = (value: string) =>
  /(^|\.)digitalocean\.com$/.test(dnsName(value));
/** True when any listed nameserver is DigitalOcean's. */
export function delegatesToDigitalOcean(nameservers: readonly string[] | null) {
  return !!nameservers?.some(isDigitalOceanNameserver);
}

const recordData = (type: string, data: string) =>
  ["CNAME", "NS", "MX"].includes(type.toUpperCase())
    ? data.trim().toLowerCase().replace(/\.$/, "")
    : data.trim();
const recordName = (name: string) => {
  const value = name.trim().toLowerCase().replace(/\.$/, "");
  return value === "" ? "@" : value;
};

/**
 * The changes that make `existing` hold exactly the desired records for each
 * desired (name, type), and remove `replaceTypes` records on those names.
 * Records of any other name or type are never touched. Order: conflicting
 * types first (a CNAME blocks an A on the same name), then updates (an
 * unwanted record of the right type is reused), creates, surplus deletes.
 */
export function planRecordChanges(
  existing: DnsRecord[],
  desired: DesiredRecord[],
  replaceTypes: string[] = [],
): RecordChange[] {
  const conflicts: RecordChange[] = [],
    updates: RecordChange[] = [],
    creates: RecordChange[] = [],
    surplus: RecordChange[] = [];
  const groups = new Map<string, DesiredRecord[]>();
  for (const record of desired) {
    const key = recordName(record.name) + " " + record.type;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const names = new Set(desired.map((r) => recordName(r.name)));
  const replace = new Set(replaceTypes.map((t) => t.toUpperCase()));
  for (const record of existing) {
    const type = record.type.toUpperCase();
    if (
      record.id &&
      names.has(recordName(record.name)) &&
      replace.has(type) &&
      !groups.has(recordName(record.name) + " " + type)
    )
      conflicts.push({ action: "delete", id: record.id, record });
  }
  for (const [key, wanted] of groups) {
    const [name, type] = key.split(" ");
    const have = existing.filter(
      (r) => recordName(r.name) === name && r.type.toUpperCase() === type,
    );
    const unmatched = [...have];
    const missing: DesiredRecord[] = [];
    for (const want of wanted) {
      const index = unmatched.findIndex(
        (r) => recordData(type, r.data) === recordData(type, want.data),
      );
      if (index < 0) {
        missing.push(want);
        continue;
      }
      const [match] = unmatched.splice(index, 1);
      if (Number(match.ttl) !== want.ttl && match.id)
        updates.push({ action: "update", id: match.id, from: match, record: want });
    }
    for (const want of missing) {
      const reuse = unmatched.shift();
      if (reuse?.id)
        updates.push({ action: "update", id: reuse.id, from: reuse, record: want });
      else creates.push({ action: "create", record: want });
    }
    for (const extra of unmatched)
      if (extra.id) surplus.push({ action: "delete", id: extra.id, record: extra });
  }
  return [...conflicts, ...updates, ...creates, ...surplus];
}

// ---- DigitalOcean ----------------------------------------------------------

type ZoneGuard = {
  /** Every zone-level call is refused unless this accepts the zone. */
  mayManage: (zone: string) => boolean;
  /** Zones that must never be deleted (the platform root). */
  protectedZone?: (zone: string) => boolean;
};

export class DigitalOceanDns implements DnsProvider {
  readonly id = "digitalocean" as const;
  readonly base: string;
  private readonly transport?: DnsTransport;
  constructor(
    private readonly token: string,
    private readonly guard: ZoneGuard,
    options: { transport?: DnsTransport } = {},
  ) {
    if (!token.trim())
      throw new ConfigurationError("The DigitalOcean API token is missing.");
    this.transport = testTransport(options.transport);
    // The local mock-provider sandbox may point the adapter at a loopback
    // double; the override is ignored everywhere else.
    const override = sandboxOverride("DIGITALOCEAN_API_BASE_URL");
    this.base = override ? override.origin : DIGITALOCEAN_API;
  }
  nameservers() {
    return [...DIGITALOCEAN_NAMESERVERS];
  }
  private zone(value: string) {
    const zone = dnsName(value);
    if (!zone || !this.guard.mayManage(zone))
      throw new DnsError(
        "This DNS zone is not managed by the platform",
        "definitive",
        "ZONE_NOT_MANAGED",
      );
    return zone;
  }
  private async call(
    method: string,
    path: string,
    body?: unknown,
    options: { allow404?: boolean } = {},
  ): Promise<any> {
    let response: Response;
    try {
      const url = new URL(path, this.base).toString();
      const init = {
        method,
        headers: {
          Authorization: "Bearer " + this.token,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      };
      response = this.transport
        ? await this.transport(url, init)
        : await integrationRequest(url, init);
    } catch {
      throw new DnsError("DigitalOcean could not be reached", "unknown");
    }
    if (options.allow404 && response.status === 404) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    if (response.status === 204) return {};
    let data: any = null;
    const text = await response.text().catch(() => "");
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = null;
    }
    if (response.status === 429) {
      const reset = Number(response.headers.get("ratelimit-reset"));
      const after = Number(response.headers.get("retry-after"));
      throw new DnsError(
        "DigitalOcean rate limit reached",
        "unknown",
        "too_many_requests",
        Number.isFinite(after) && after > 0
          ? after * 1000
          : Number.isFinite(reset) && reset > 0
            ? Math.max(1000, reset * 1000 - Date.now())
            : 60000,
      );
    }
    if (response.status >= 500 || data === null)
      throw new DnsError(
        `DigitalOcean answer was not usable (HTTP ${response.status})`,
        "unknown",
      );
    if (!response.ok)
      throw new DnsError(
        String(data?.message ?? "DigitalOcean refused the request")
          .replace(/\s+/g, " ")
          .slice(0, 300),
        "definitive",
        String(data?.id ?? response.status),
      );
    return data;
  }
  /** How many zones the token can see (a read of one listed zone at most). */
  async accountZoneCount() {
    const data = await this.call("GET", "/v2/domains?per_page=1");
    const total = Number(data?.meta?.total);
    if (!Number.isFinite(total))
      throw new DnsError("DigitalOcean answer was not usable", "unknown");
    return total;
  }
  async getZone(value: string) {
    const zone = this.zone(value);
    const data = await this.call(
      "GET",
      "/v2/domains/" + encodeURIComponent(zone),
      undefined,
      { allow404: true },
    );
    if (!data) return null;
    if (dnsName(data?.domain?.name) !== zone)
      throw new DnsError("DigitalOcean answer was not usable", "unknown");
    return { name: zone };
  }
  async ensureZone(value: string): Promise<ZoneState> {
    const zone = this.zone(value);
    if (await this.getZone(zone)) return "existing";
    try {
      // No ip_address: every record is written explicitly afterwards.
      await this.call("POST", "/v2/domains", { name: zone });
      return "created";
    } catch (error) {
      if (!(error instanceof DnsError)) throw error;
      // A lost answer or a refusal: whether this account holds the zone now
      // decides. A refusal while it does not means another account holds it.
      const held = await this.getZone(zone);
      if (held) return error.outcome === "unknown" ? "created" : "existing";
      // DigitalOcean answers 422 when the name already exists in any account.
      if (error.outcome === "definitive" && error.code === "unprocessable_entity")
        return "held_elsewhere";
      throw error;
    }
  }
  async records(value: string): Promise<DnsRecord[]> {
    const zone = this.zone(value);
    const out: DnsRecord[] = [];
    for (let page = 1; page <= 50; page++) {
      const data = await this.call(
        "GET",
        `/v2/domains/${encodeURIComponent(zone)}/records?per_page=200&page=${page}`,
      );
      const rows = Array.isArray(data?.domain_records) ? data.domain_records : null;
      if (!rows) throw new DnsError("DigitalOcean answer was not usable", "unknown");
      for (const row of rows) {
        const type = String(row.type ?? "").toUpperCase();
        out.push({
          id: String(row.id),
          name: recordName(String(row.name ?? "@")),
          type,
          // CAA keeps its flag and tag, in zone-file form: 0 issue "ca.example".
          data:
            type === "CAA"
              ? `${Number(row.flags ?? 0)} ${String(row.tag ?? "issue")} "${String(row.data ?? "")}"`
              : String(row.data ?? ""),
          ttl: Number(row.ttl ?? 0),
        });
      }
      if (!data?.links?.pages?.next || rows.length === 0) return out;
    }
    throw new DnsError("The zone has more records than the platform reads", "definitive");
  }
  /** Applies planned changes in order; every call is by record identifier. */
  async applyChanges(value: string, changes: RecordChange[]) {
    const zone = this.zone(value);
    const path = `/v2/domains/${encodeURIComponent(zone)}/records`;
    for (const change of changes) {
      if (change.action === "delete")
        await this.call("DELETE", `${path}/${encodeURIComponent(change.id)}`, undefined, {
          allow404: true,
        });
      else if (change.action === "update")
        await this.call("PATCH", `${path}/${encodeURIComponent(change.id)}`, {
          type: change.record.type,
          name: change.record.name,
          data: change.record.data,
          ttl: change.record.ttl,
        });
      else
        await this.call("POST", path, {
          type: change.record.type,
          name: change.record.name,
          data: change.record.data,
          ttl: change.record.ttl,
        });
    }
  }
  async upsertRecords(
    value: string,
    desired: DesiredRecord[],
    options: { replaceTypes?: string[] } = {},
  ) {
    const zone = this.zone(value);
    for (const record of desired) assertDesired(record);
    const existing = await this.records(zone);
    const changes = planRecordChanges(existing, desired, options.replaceTypes);
    await this.applyChanges(zone, changes);
    const count = (action: RecordChange["action"]) =>
      changes.filter((c) => c.action === action).length;
    return {
      created: count("create"),
      updated: count("update"),
      deleted: count("delete"),
      unchanged: desired.length - count("create") - count("update"),
    };
  }
  async deleteZone(value: string, evidence: ZoneReleaseEvidence) {
    const zone = this.zone(value);
    if (this.guard.protectedZone?.(zone))
      throw new DnsError(
        "The platform's own zone is never deleted",
        "definitive",
        "PROTECTED_ZONE",
      );
    if (
      delegatesToDigitalOcean(evidence.registrarNameservers) ||
      (evidence.publicNameservers !== "nxdomain" &&
        delegatesToDigitalOcean(evidence.publicNameservers))
    )
      throw new DnsError(
        "The name still delegates to DigitalOcean; deleting its zone would let another account take it over",
        "definitive",
        "STILL_DELEGATED",
      );
    await this.call("DELETE", "/v2/domains/" + encodeURIComponent(zone), undefined, {
      allow404: true,
    });
  }
}
function assertDesired(record: DesiredRecord) {
  const name = recordName(record.name);
  if (!(name === "@" || name === "*" || /^[a-z0-9_*]([a-z0-9-_.]*[a-z0-9])?$/.test(name)))
    throw new DnsError("Invalid record name", "definitive", "INVALID_RECORD");
  if (record.type === "A" && isIP(record.data) !== 4)
    throw new DnsError("An A record needs an IPv4 address", "definitive", "INVALID_RECORD");
  if (!Number.isInteger(record.ttl) || record.ttl < 30 || record.ttl > 86400)
    throw new DnsError("Record TTL must be 30 to 86400 seconds", "definitive", "INVALID_RECORD");
}

// ---- The registrar's own DNS (fallback) -------------------------------------

/**
 * The registrar's own DNS, as the flow used before DNS hosting existed. The
 * registrar can only replace the whole host set of a domain, so the desired
 * records become the complete set (parking records are dropped), and a
 * domain that was delegated elsewhere is first returned to the registrar's
 * nameservers (Namecheap refuses host records otherwise).
 */
export class RegistrarHostedDns implements DnsProvider {
  readonly id = "registrar" as const;
  constructor(
    private readonly registrar: Registrar,
    private readonly guard: ZoneGuard,
  ) {}
  nameservers() {
    return null;
  }
  private zone(value: string) {
    const zone = dnsName(value);
    if (!zone || !this.guard.mayManage(zone))
      throw new DnsError(
        "This DNS zone is not managed by the platform",
        "definitive",
        "ZONE_NOT_MANAGED",
      );
    return zone;
  }
  async getZone(value: string) {
    return { name: this.zone(value) };
  }
  async ensureZone(value: string): Promise<ZoneState> {
    const zone = this.zone(value);
    const state = await this.registrar.getNameservers(zone);
    if (!state.usingRegistrarDns) {
      const after = await this.registrar.setNameservers(zone, null);
      if (!after.usingRegistrarDns)
        throw new DnsError(
          "The domain did not return to the registrar's DNS",
          "unknown",
        );
    }
    return "existing";
  }
  async records(value: string) {
    const hosts = await this.registrar.getHosts(this.zone(value));
    return hosts.map((host) => ({
      name: recordName(host.name),
      type: host.type,
      data: host.address,
      ttl: host.ttl,
    }));
  }
  async upsertRecords(value: string, desired: DesiredRecord[]) {
    const zone = this.zone(value);
    for (const record of desired) assertDesired(record);
    const hosts: HostRecord[] = desired.map((record) => ({
      name: recordName(record.name),
      type: record.type,
      address: record.data,
      ttl: record.ttl,
    }));
    await this.registrar.setHosts(zone, hosts);
    // Read back: exactly the written names, types and values (TTLs aside).
    const key = (r: { name: string; type: string; data: string }) =>
      [recordName(r.name), r.type.toUpperCase(), recordData(r.type, r.data).toLowerCase()].join(" ");
    const written = (await this.records(zone)).map(key).sort(),
      wanted = desired.map(key).sort();
    if (
      written.length !== wanted.length ||
      written.some((value, i) => value !== wanted[i])
    )
      throw new DnsError(
        "The registrar holds a different host set than the one written",
        "definitive",
        "HOSTS_DIFFER",
      );
    return { created: desired.length, updated: 0, deleted: 0, unchanged: 0 };
  }
  async deleteZone() {
    // The registrar's DNS belongs to the registration; nothing to release.
  }
}

// ---- Configuration ------------------------------------------------------------

export type DnsHostingSettings = {
  provider: DnsProviderId;
  token: string;
  ttl: number;
  platformZone: string | null;
};
export function dnsHostingSettings(
  config: RuntimeConfig = runtimeConfig(),
): DnsHostingSettings {
  const provider =
    (config.DNS_PROVIDER || "registrar").trim() === "digitalocean"
      ? "digitalocean"
      : "registrar";
  const ttl = Number(config.DNS_RECORD_TTL || 1800);
  return {
    provider,
    token: config.DIGITALOCEAN_DNS_TOKEN?.trim() ?? "",
    ttl: Number.isInteger(ttl) && ttl >= 30 && ttl <= 86400 ? ttl : 1800,
    platformZone: dnsName(config.DNS_PLATFORM_ZONE) || null,
  };
}
/**
 * The configured DNS host for one zone guard: DigitalOcean when chosen (its
 * token is required), otherwise the registrar's own DNS.
 */
export function dnsHostingFromConfig(
  guard: ZoneGuard,
  registrar: () => Registrar,
  config: RuntimeConfig = runtimeConfig(),
): DnsProvider {
  const settings = dnsHostingSettings(config);
  if (settings.provider === "registrar")
    return new RegistrarHostedDns(registrar(), guard);
  if (!settings.token)
    throw new ProviderUnavailable(
      "dns_hosting",
      "DigitalOcean DNS is chosen but its API token is missing.",
    );
  return new DigitalOceanDns(settings.token, guard);
}

// ---- Public DNS (DNS over HTTPS) ------------------------------------------------

export type PublicDnsType = "A" | "AAAA" | "NS" | "DS" | "CAA";
export type PublicDnsAnswer = { status: "ok" | "nxdomain"; answers: string[] };
const DOH_TYPES: Record<PublicDnsType, number> = {
  A: 1,
  NS: 2,
  AAAA: 28,
  DS: 43,
  CAA: 257,
};
export const PUBLIC_DOH_RESOLVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
] as const;
function normaliseAnswer(type: PublicDnsType, data: string) {
  const value = String(data).trim();
  return type === "NS" ? dnsName(value) || value.toLowerCase() : value;
}
/**
 * What public resolvers answer for a name: Cloudflare, then Google (JSON DNS
 * over HTTPS). In the local mock-provider sandbox the loopback DNS double
 * answers instead (it has no DS records, so DS is unknown there). Throws a
 * DnsError "unknown" when no resolver gives a usable answer.
 */
export async function publicDnsLookup(
  name: string,
  type: PublicDnsType,
): Promise<PublicDnsAnswer> {
  const host = dnsName(name.replace(/^\*\./, "wildcard-probe."));
  if (!host) throw new DnsError("Invalid DNS name", "definitive");
  const sandbox = sandboxResolver();
  if (sandbox) {
    try {
      const answers =
        type === "A"
          ? await sandbox.resolve4(host)
          : type === "AAAA"
            ? await sandbox.resolve6(host)
            : type === "NS"
              ? await sandbox.resolveNs(host)
              : type === "CAA"
                ? (await sandbox.resolveCaa(host)).map(
                    (r: any) => `0 ${r.issue ? "issue" : "iodef"} "${r.issue ?? r.iodef}"`,
                  )
                : null;
      if (!answers) throw new DnsError("DS is not answered in the sandbox", "unknown");
      return { status: "ok", answers: answers.map((a) => normaliseAnswer(type, a)) };
    } catch (error) {
      const code = (error as any)?.code;
      if (code === "ENOTFOUND") return { status: "nxdomain", answers: [] };
      if (code === "ENODATA") return { status: "ok", answers: [] };
      throw error instanceof DnsError
        ? error
        : new DnsError("The sandbox DNS did not answer", "unknown");
    }
  }
  for (const resolver of PUBLIC_DOH_RESOLVERS) {
    try {
      const url = `${resolver}?name=${encodeURIComponent(host)}&type=${type}`;
      const response = await integrationRequest(url, {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const data = (await response.json()) as any;
      if (data?.Status === 3) return { status: "nxdomain", answers: [] };
      if (data?.Status !== 0) continue;
      const answers = (Array.isArray(data.Answer) ? data.Answer : [])
        .filter((a: any) => Number(a?.type) === DOH_TYPES[type])
        .map((a: any) => normaliseAnswer(type, String(a.data ?? "")));
      return { status: "ok", answers };
    } catch {
      /* Try the next resolver. */
    }
  }
  throw new DnsError("Public DNS could not be asked", "unknown");
}
