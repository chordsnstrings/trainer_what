/**
 * Check and repair platform DNS (docs/features/infra-ops.md, "Platform DNS"):
 * the Super admin action that makes the platform root zone at the DNS host
 * hold A records for @, www and * pointing at this server's IPv4 from the
 * verified host controller report. It is offered before the platform address
 * change, which then only has to verify DNS.
 *
 * Safety: the only zone this module can touch is PLATFORM_ROOT_DOMAIN or the
 * platform root zone saved in DNS hosting settings (the DNS host adapter's
 * zone guard enforces it for every call); only A records on @, www and *
 * change, and AAAA or CNAME records on those three names are removed
 * because they would send visitors elsewhere; nothing is ever deleted
 * outside them and the zone itself is never deleted. The check is
 * read-only; the repair applies exactly the plan the operator saw
 * (planHash), with a reason, a fresh authenticator and an audit entry.
 */
import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Actor, Database, Tx } from "@trainer/db";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import {
  DIGITALOCEAN_NAMESERVERS,
  DigitalOceanDns,
  DnsError,
  delegatesToDigitalOcean,
  dnsHostingSettings,
  dnsName,
  planRecordChanges,
  publicDnsLookup,
  type DesiredRecord,
  type DnsProvider,
  type DnsRecord,
  type PublicDnsAnswer,
  type PublicDnsType,
} from "../../../packages/providers/src/dns-hosting.ts";
import { platformRootDomain } from "../../../packages/domain/src/web-address.ts";

type Identity = Actor & { platformRole?: string; mfaAt?: string | null };
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });

/** The records the platform root needs; the names this module manages. */
export const PLATFORM_DNS_NAMES = ["@", "www", "*"] as const;
/** Record types on those names that would shadow the A records. */
const REPLACED_TYPES = ["AAAA", "CNAME"];
/** Certificate authorities the edge (Caddy) uses. */
const EDGE_CAS = ["letsencrypt.org", "zerossl.com"];

export type PlatformDnsDeps = {
  /** The DNS host for the guarded zone (tests inject an adapter with a test transport). */
  dns?: (guard: {
    mayManage: (zone: string) => boolean;
    protectedZone?: (zone: string) => boolean;
  }) => DnsProvider;
  publicDns?: (name: string, type: PublicDnsType) => Promise<PublicDnsAnswer>;
  /** This server's public IPv4 (default: the verified host controller report). */
  serverIpv4?: (db: Database) => Promise<string | null>;
};
type Problem = {
  key: string;
  level: "error" | "warning" | "info";
  message: string;
};
export type PlannedChange = {
  action: "create_zone" | "create" | "update" | "delete";
  name: string;
  type: string;
  data: string;
  ttl?: number;
  from?: string;
};
export type PlatformDnsPlan = {
  zone: string | null;
  allowedZones: string[];
  provider: "digitalocean" | "registrar";
  serverIpv4: string | null;
  zonePresent: boolean | null;
  records: DnsRecord[];
  changes: PlannedChange[];
  problems: Problem[];
  /** Nothing blocks writing the records (DNS host, zone and server address known). */
  repairable: boolean;
  /** Records already right and nothing blocking the platform address change. */
  ready: boolean;
  planHash: string | null;
};

/**
 * Whether a zone holds the platform's current names: PLATFORM_ROOT_DOMAIN or
 * the public app address's host, or a parent domain of either. The DNS
 * hosting root zone may name another zone (a new root prepared before the
 * address change); such a zone is repaired only while its @, www and *
 * names point nowhere else (it may be another site of the same team).
 */
export function platformOwnZone(zone: string, config = runtimeConfig()) {
  let appHost = "";
  try {
    appHost = dnsName(new URL(config.PUBLIC_APP_URL ?? "").hostname);
  } catch {
    appHost = "";
  }
  return [platformRootDomain(config.PLATFORM_ROOT_DOMAIN), appHost]
    .filter((name): name is string => !!name)
    .some((name) => name === zone || name.endsWith("." + zone));
}
/** The zones this module may manage: PLATFORM_ROOT_DOMAIN and the DNS hosting root zone. */
export function platformDnsZones(config = runtimeConfig()) {
  return [
    ...new Set(
      [
        platformRootDomain(config.PLATFORM_ROOT_DOMAIN),
        dnsHostingSettings(config).platformZone,
      ].filter((zone): zone is string => !!zone),
    ),
  ];
}
function hashPlan(zone: string, ip: string, changes: PlannedChange[]) {
  return createHash("sha256")
    .update(JSON.stringify({ zone, ip, changes }))
    .digest("hex");
}
const describe = (record: DnsRecord) =>
  `${record.name} ${record.type} ${record.data}`;

/**
 * Read-only: what the zone holds, the changes the repair would make and
 * everything that would stop the platform address change.
 */
export async function planPlatformDns(
  db: Database,
  requested: string | null | undefined,
  deps: PlatformDnsDeps = {},
): Promise<{ plan: PlatformDnsPlan; host: DnsProvider | null; desired: DesiredRecord[] }> {
  const allowed = platformDnsZones();
  const settings = dnsHostingSettings();
  const zone = requested ? dnsName(requested) : (allowed[0] ?? "");
  const problems: Problem[] = [];
  const plan: PlatformDnsPlan = {
    zone: zone || null,
    allowedZones: allowed,
    provider: settings.provider,
    serverIpv4: null,
    zonePresent: null,
    records: [],
    changes: [],
    problems,
    repairable: false,
    ready: false,
    planHash: null,
  };
  const done = () => ({ plan, host: null, desired: [] as DesiredRecord[] });
  if (!zone || !allowed.includes(zone)) {
    problems.push({
      key: "zone",
      level: "error",
      message: allowed.length
        ? `Only the platform's own zone can be managed here: ${allowed.join(" or ")}.`
        : "Set the platform root zone in Super admin → Settings → DNS hosting (or PLATFORM_ROOT_DOMAIN) first.",
    });
    return done();
  }
  if (settings.provider !== "digitalocean" || (!deps.dns && !settings.token)) {
    problems.push({
      key: "provider",
      level: "error",
      message:
        "Platform DNS automation needs DigitalOcean DNS with its API token in Super admin → Settings → DNS hosting.",
    });
    return done();
  }
  const ip = deps.serverIpv4
    ? await deps.serverIpv4(db)
    : await (await import("./host-operations.ts")).reportedServerIpv4(db);
  plan.serverIpv4 = ip;
  if (!ip) {
    problems.push({
      key: "server",
      level: "error",
      message:
        "This server's public IPv4 address is not reported yet. Wait for the next host controller report (about five minutes) and check again.",
    });
    return done();
  }
  // The guard admits exactly this zone, and nothing here ever deletes it.
  const guard = {
    mayManage: (candidate: string) => candidate === zone,
    protectedZone: () => true,
  };
  const host = deps.dns
    ? deps.dns(guard)
    : new DigitalOceanDns(settings.token, guard);
  const desired: DesiredRecord[] = PLATFORM_DNS_NAMES.map((name) => ({
    name,
    type: "A" as const,
    data: ip,
    ttl: settings.ttl,
  }));
  let existing: DnsRecord[] = [];
  try {
    plan.zonePresent = !!(await host.getZone(zone));
    if (plan.zonePresent) existing = await host.records(zone);
  } catch (error) {
    problems.push({
      key: "dns_host",
      level: "error",
      message:
        error instanceof DnsError && error.outcome === "definitive"
          ? `DigitalOcean refused to read the zone: ${error.message}.`
          : "DigitalOcean could not be reached. Nothing was changed; check again.",
    });
    return { plan, host: null, desired };
  }
  const managed = new Set<string>(PLATFORM_DNS_NAMES);
  plan.records = existing.filter(
    (r) => managed.has(r.name) || r.type === "CAA" || r.type === "NS",
  );
  // A zone that is not the platform's current address (a typo, or another
  // site of the same DigitalOcean team) is never taken over.
  const inUse = platformOwnZone(zone)
    ? []
    : existing.filter(
        (r) =>
          managed.has(r.name) &&
          ["A", "AAAA", "CNAME"].includes(r.type) &&
          !(r.type === "A" && r.data === ip),
      );
  if (inUse.length) {
    problems.push({
      key: "zone_in_use",
      level: "error",
      message: `${zone} is not the platform's current address (PLATFORM_ROOT_DOMAIN or the public app address), and its names already point elsewhere (${inUse
        .slice(0, 6)
        .map(describe)
        .join(", ")}). It may be another site in the same DigitalOcean team, so it is never repaired from here. If it really is the new platform root, remove those records at the DNS host first.`,
    });
    return { plan, host: null, desired };
  }
  if (!plan.zonePresent)
    plan.changes.push({ action: "create_zone", name: zone, type: "zone", data: zone });
  for (const change of planRecordChanges(existing, desired, REPLACED_TYPES))
    plan.changes.push(
      change.action === "delete"
        ? {
            action: "delete",
            name: change.record.name,
            type: change.record.type,
            data: change.record.data,
          }
        : {
            action: change.action,
            name: change.record.name,
            type: change.record.type,
            data: change.record.data,
            ttl: change.record.ttl,
            ...(change.action === "update" ? { from: describe(change.from) } : {}),
          },
    );
  const removed = plan.changes.filter((c) => c.action === "delete");
  if (removed.length)
    problems.push({
      key: "shadowing",
      level: "info",
      message: `The repair removes ${removed.map((c) => `${c.name} ${c.type} ${c.data}`).join(", ")}: this server has no IPv6 address, and a CNAME would send these names elsewhere.`,
    });
  // CAA: "issue" records that allow neither of the edge's certificate
  // authorities make every certificate for the platform and its workspaces
  // fail. The edge obtains one certificate per name, never a wildcard, so
  // only "issue" decides ("issuewild" governs wildcard certificates).
  const caa = existing.filter((r) => r.type === "CAA" && r.name === "@");
  const issuers = caa
    .map((r) => /^\s*\d+\s+([a-z0-9]+)\s+"?([^"]*)"?\s*$/i.exec(r.data))
    .filter((m): m is RegExpExecArray => !!m && m[1].toLowerCase() === "issue")
    .map((m) => m[2].split(";")[0].trim().toLowerCase());
  if (issuers.length && !issuers.some((ca) => EDGE_CAS.includes(ca)))
    problems.push({
      key: "caa",
      level: "error",
      message: `CAA records (${caa.map((r) => r.data).join("; ")}) allow neither Let's Encrypt nor ZeroSSL, so the edge cannot obtain certificates. Add a CAA record 0 issue "letsencrypt.org" (and one for zerossl.com) at the DNS host; the repair does not change CAA records.`,
    });
  // Workspace names (<slug>.<root>) are answered by the wildcard only where
  // the name has no records of its own. A name with records but no A, with
  // a CNAME, with an A pointing elsewhere, or with only deeper names under
  // it (mg under email.mg) does not reach this server.
  const byName = new Map<string, DnsRecord[]>();
  for (const record of existing)
    byName.set(record.name, [...(byName.get(record.name) ?? []), record]);
  const firstLabels = new Set(
    [...byName.keys()]
      .filter((name) => name !== "@")
      .map((name) => name.split(".").pop()!),
  );
  const hidden: string[] = [];
  for (const label of firstLabels) {
    if (managed.has(label) || label.startsWith("_")) continue;
    const own = byName.get(label) ?? [];
    const types = new Set(own.map((r) => r.type));
    const cname = own.find((r) => r.type === "CNAME");
    const foreignA = own.find((r) => r.type === "A" && r.data !== ip);
    if (!own.length) {
      const deeper = [...byName.keys()].find((name) => name.endsWith("." + label));
      hidden.push(`${label} (only ${deeper} under it)`);
    } else if (cname) hidden.push(`${label} (CNAME ${cname.data})`);
    else if (!types.has("A")) hidden.push(`${label} (${[...types].join(", ")})`);
    else if (foreignA) hidden.push(`${label} (A ${foreignA.data})`);
  }
  if (hidden.length)
    problems.push({
      key: "wildcard",
      level: "warning",
      message: `These names do not reach this server (the wildcard does not answer for them), so a workspace with that name would not work: ${hidden.slice(0, 20).join(", ")}.`,
    });
  const lookup = deps.publicDns ?? publicDnsLookup;
  try {
    const ds = await lookup(zone, "DS");
    if (ds.status === "ok" && ds.answers.length)
      problems.push({
        key: "ds",
        level: "error",
        message: `The registry holds a DS (DNSSEC) record for ${zone}, and DigitalOcean does not sign zones, so validating resolvers would refuse every answer. Remove DNSSEC (the DS record) at the registrar.`,
      });
  } catch {
    problems.push({
      key: "ds",
      level: "warning",
      message: "Whether the registry holds a DS (DNSSEC) record could not be checked.",
    });
  }
  let delegated = false;
  try {
    const ns = await lookup(zone, "NS");
    delegated = ns.status === "ok" && delegatesToDigitalOcean(ns.answers);
    if (!delegated)
      problems.push({
        key: "delegation",
        level: "warning",
        message: `Public DNS does not show ${zone} delegated to DigitalOcean (${ns.status === "ok" ? ns.answers.join(", ") || "no NS records" : "no such domain"}). Records here take effect only once the registrar lists ${DIGITALOCEAN_NAMESERVERS.join(", ")}.`,
      });
    else
      problems.push({
        key: "delegation",
        level: "info",
        message: `${zone} is delegated to DigitalOcean.`,
      });
  } catch {
    problems.push({
      key: "delegation",
      level: "warning",
      message: "Public DNS could not be asked whether the zone is delegated to DigitalOcean.",
    });
  }
  plan.repairable = true;
  // Records at the DNS host take effect only while the zone is delegated there.
  plan.ready =
    plan.changes.length === 0 &&
    delegated &&
    !problems.some((p) => p.level === "error");
  plan.planHash = hashPlan(zone, ip, plan.changes);
  return { plan, host, desired };
}

/**
 * Applies the plan the operator saw: refused when anything changed since
 * (the plan hash differs), so a record added meanwhile is never overwritten
 * unseen. Returns the plan read back afterwards.
 */
export async function repairPlatformDns(
  db: Database,
  requested: string | null | undefined,
  planHash: string,
  deps: PlatformDnsDeps = {},
) {
  const { plan, host, desired } = await planPlatformDns(db, requested, deps);
  if (!plan.repairable || !host || !plan.zone)
    throw Object.assign(
      fail(409, "PLATFORM_DNS_BLOCKED", "Platform DNS cannot be repaired yet; see the check."),
      { plan },
    );
  if (plan.planHash !== planHash)
    throw Object.assign(
      fail(409, "PLATFORM_DNS_CHANGED", "The zone changed since the check. Review the new plan and repair again."),
      { plan },
    );
  const applied = { zoneCreated: false, created: 0, updated: 0, deleted: 0 };
  if (plan.changes.length) {
    if (!plan.zonePresent) {
      const state = await host.ensureZone(plan.zone);
      if (state === "held_elsewhere")
        throw Object.assign(
          fail(409, "ZONE_HELD_ELSEWHERE", `Another DigitalOcean account holds ${plan.zone}. Move the zone into this account (or use its token) first.`),
          { plan },
        );
      applied.zoneCreated = state === "created";
    }
    const counts = await host.upsertRecords(plan.zone, desired, {
      replaceTypes: REPLACED_TYPES,
    });
    Object.assign(applied, {
      created: counts.created,
      updated: counts.updated,
      deleted: counts.deleted,
    });
  }
  const after = await planPlatformDns(db, plan.zone, deps);
  return { applied, plan: after.plan };
}

async function audit(
  tx: Tx,
  a: Identity,
  action: string,
  data: unknown,
) {
  await tx.query(
    "INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), a.userId, action, null, JSON.stringify(data)],
  );
}

/** Routes, registered from the host operations module (same operator guard). */
export function registerPlatformDns(
  app: FastifyInstance,
  db: Database,
  access: (req: FastifyRequest) => Identity,
  deps: PlatformDnsDeps = {},
) {
  const zoneInput = z.string().trim().max(253).nullable().optional();
  app.post(
    "/api/v1/admin/infrastructure/platform-dns/check",
    async (req) => {
      const a = access(req);
      const b = z.object({ rootDomain: zoneInput }).strict().parse(req.body ?? {});
      const { plan } = await planPlatformDns(db, b.rootDomain, deps);
      await db.system((tx) =>
        audit(tx, a, "infrastructure.platform_dns.checked", {
          zone: plan.zone,
          changes: plan.changes.length,
          ready: plan.ready,
        }),
      );
      return plan;
    },
  );
  app.post(
    "/api/v1/admin/infrastructure/platform-dns/repair",
    { config: { rateLimit: { max: 6, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const a = access(req);
      const b = z
        .object({
          rootDomain: zoneInput,
          planHash: z.string().regex(/^[a-f0-9]{64}$/),
          reason: z.string().trim().min(10).max(500),
        })
        .strict()
        .parse(req.body);
      try {
        const result = await repairPlatformDns(db, b.rootDomain, b.planHash, deps);
        await db.system((tx) =>
          audit(tx, a, "infrastructure.platform_dns.repaired", {
            zone: result.plan.zone,
            reason: b.reason,
            ...result.applied,
          }),
        );
        return result;
      } catch (error: any) {
        if (error?.plan)
          return reply.code(error.statusCode ?? 409).send({
            code: error.code,
            message: error.message,
            plan: error.plan,
          });
        if (error instanceof DnsError)
          return reply.code(502).send({
            code: "DNS_HOST",
            message:
              error.outcome === "definitive"
                ? `DigitalOcean refused the change: ${error.message}. Check again before repairing.`
                : "DigitalOcean did not confirm the change. Check again: the repair reads the zone back.",
          });
        throw error;
      }
    },
  );
}
