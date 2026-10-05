import { request as httpsRequest, Agent as HttpsAgent } from "node:https";
import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";
import { elevated, type Actor, type Database } from "@trainer/db";
import {
  runtimeConfig,
  isPublicAddress,
  validatePublicEndpoint,
} from "../../../packages/providers/src/configuration.ts";
import { sandboxResolver } from "../../../packages/providers/src/sandbox.ts";
import { reportedServerIpv4 } from "./host-operations.ts";
import { platformRoot } from "./host-routing.ts";
import {
  publicDnsLookup,
  DIGITALOCEAN_NAMESERVERS,
  sameNameservers,
  type PublicDnsAnswer,
  type PublicDnsType,
} from "../../../packages/providers/src/dns-hosting.ts";
import { randomUUID } from "node:crypto";

export type AddressHealth = {
  state: "healthy" | "attention" | "unchecked";
  checkedAt: string | null;
  message: string;
};
export type AddressHealthDeps = {
  publicDns?: (name: string, type: PublicDnsType) => Promise<PublicDnsAnswer>;
  resolve4?: (host: string) => Promise<string[]>;
  resolve6?: (host: string) => Promise<string[]>;
  targetIpv4?: () => Promise<string>;
  httpsCheck?: (host: string) => Promise<void>;
  siteCheck?: (
    host: string,
    slug: string,
    redirectHost?: string,
  ) => Promise<void>;
};
export const HEALTH_TTL = 60 * 60 * 1000;
const noAnswers = (e: any) => {
  if (["ENODATA", "ENOTFOUND"].includes(e?.code)) return [];
  throw e;
};
export async function targetAddress(
  db: Database,
  deps: AddressHealthDeps = {},
) {
  if (deps.targetIpv4) return deps.targetIpv4();
  const configured = runtimeConfig().WEB_ADDRESS_TARGET_IPV4?.trim();
  if (configured && isIP(configured) === 4 && isPublicAddress(configured))
    return configured;
  const reported = await reportedServerIpv4(db).catch(() => null);
  if (reported && isIP(reported) === 4 && isPublicAddress(reported))
    return reported;
  const host = new URL(runtimeConfig().PUBLIC_APP_URL ?? "http://localhost")
    .hostname;
  const addresses = await (deps.resolve4 ?? resolve4)(host);
  const found = addresses.filter(isPublicAddress).sort()[0];
  if (!found) throw new Error("The platform's public address is unavailable.");
  return found;
}
export async function checkAddressDns(
  db: Database,
  hostname: string,
  deps: AddressHealthDeps = {},
) {
  const target = await targetAddress(db, deps);
  const resolver = sandboxResolver();
  const a = await (
    deps.resolve4 ??
    resolver?.resolve4.bind(resolver) ??
    resolve4
  )(hostname);
  const aaaa = deps.resolve6
    ? await deps.resolve6(hostname).catch(noAnswers)
    : deps.resolve4 || resolver
      ? []
      : await resolve6(hostname).catch(noAnswers);
  if (!a.length || a.some((ip) => ip !== target) || aaaa.length)
    throw new Error(
      "Set every A record to the platform address and remove conflicting AAAA records.",
    );
  return target;
}
export async function httpsProbe(
  hostname: string,
  address: { address: string; family: number },
  options: {
    port?: number;
    ca?: string;
    timeoutMs?: number;
    siteSlug?: string;
    redirectHost?: string;
  } = {},
) {
  await new Promise<void>((resolve, reject) => {
    const request = httpsRequest(
      "https://" + hostname + "/",
      {
        method: "HEAD",
        // Preserve address pinning even when the process has an outbound proxy.
        agent: new HttpsAgent({ proxyEnv: { NODE_ENV: process.env.NODE_ENV } }),
        ...(options.port ? { port: options.port } : {}),
        ...(options.ca ? { ca: options.ca } : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
        lookup: (_name, lookupOptions, callback) => {
          if (typeof lookupOptions === "object" && lookupOptions?.all)
            callback(null, [address] as any);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        const correctSite =
          !options.siteSlug ||
          response.headers["x-trainer-site"] === options.siteSlug;
        let correctResponse = status >= 100;
        if (options.siteSlug) {
          correctResponse = status === 200;
          if (options.redirectHost) {
            const expected = "https://" + options.redirectHost + "/";
            correctResponse =
              [301, 308].includes(status) &&
              response.headers.location === expected;
          }
        }
        if (correctSite && correctResponse) resolve();
        else reject(new Error("No HTTP answer"));
      },
    );
    request.on("error", reject);
    request.end();
  });
}
export async function probeSite(
  hostname: string,
  slug: string,
  redirectHost?: string,
) {
  const { addresses } = await validatePublicEndpoint(
    "https://" + hostname + "/",
  );
  await httpsProbe(hostname, addresses[0], { siteSlug: slug, redirectHost });
}
export async function readAddressHealth(
  db: Database,
  actor: Actor,
  hostname: string,
): Promise<AddressHealth> {
  const [r] = await db.tenant(actor, (tx) =>
    tx.query(
      "SELECT data FROM records WHERE kind='web_address_health' AND data->>'hostname'=$1",
      [hostname],
    ),
  );
  if (!r || Date.now() - Date.parse(r.data.checkedAt) > HEALTH_TTL * 2)
    return {
      state: "unchecked",
      checkedAt: r?.data.checkedAt ?? null,
      message: "Website check pending.",
    };
  return r.data;
}
export async function checkAddressHealth(
  db: Database,
  actor: Actor,
  hostname: string,
  slug: string,
  deps: AddressHealthDeps = {},
  redirectHost?: string,
): Promise<AddressHealth> {
  let state: AddressHealth["state"] = "healthy",
    message = "DNS, HTTPS and website verified.";
  try {
    const target = await checkAddressDns(db, hostname, deps);
    if (deps.siteCheck) await deps.siteCheck(hostname, slug, redirectHost);
    else if (deps.httpsCheck) await deps.httpsCheck(hostname);
    else
      await httpsProbe(
        hostname,
        { address: target, family: 4 },
        { siteSlug: slug, redirectHost },
      );
  } catch {
    state = "attention";
    message =
      "The website could not be verified. Check DNS, remove conflicting records and retry. Your platform address remains available.";
  }
  const health = { state, checkedAt: new Date().toISOString(), message };
  await db.tenant(actor, (tx) =>
    tx.query(
      "INSERT INTO records(id,tenant_id,kind,status,data) VALUES($1,$2,'web_address_health',$3,$4) ON CONFLICT(tenant_id,(data->>'hostname')) WHERE kind='web_address_health' DO UPDATE SET status=EXCLUDED.status,data=EXCLUDED.data,updated_at=now()",
      [
        randomUUID(),
        actor.tenantId,
        state,
        JSON.stringify({ ...health, hostname }),
      ],
    ),
  );
  return health;
}
/** Periodic checks for mapped domains and published subdomains, bounded to due hosts. */
export async function checkTenantAddresses(
  db: Database,
  tenantId: string,
  deps: AddressHealthDeps = {},
) {
  const actor = elevated("worker", { tenantId, role: "owner" });
  const [tenant] = await db.system((tx) =>
    tx.query(
      "SELECT slug,published FROM tenants WHERE id=$1 AND lifecycle_state IN ('active','suspended')",
      [tenantId],
    ),
  );
  if (!tenant) return;
  const names = await db.system((tx) =>
    tx.query(
      "SELECT hostname,redirect FROM domain_mappings WHERE tenant_id=$1 AND active=true",
      [tenantId],
    ),
  );
  const root = platformRoot();
  if (tenant.published && root)
    names.push({ hostname: tenant.slug + "." + root, redirect: null });
  const checks = await db.tenant(actor, (tx) =>
    tx.query("SELECT data FROM records WHERE kind='web_address_health'"),
  );
  const due = names
    .filter(
      (n) =>
        !checks.some(
          (r) =>
            r.data.hostname === n.hostname &&
            Date.now() - Date.parse(r.data.checkedAt) < HEALTH_TTL,
        ),
    )
    .slice(0, 5);
  if (!due.length) return;
  for (const n of due) {
    const redirectHost =
      n.redirect === "apex"
        ? n.hostname.replace(/^www\./, "")
        : n.redirect === "subdomain" && root
          ? tenant.slug + "." + root
          : undefined;
    await checkAddressHealth(
      db,
      actor,
      n.hostname,
      tenant.slug,
      deps,
      redirectHost,
    );
  }
  const orders = await db.tenant(actor, (tx) =>
    tx.query(
      "SELECT id,hostname,mode,dns_provider,evidence FROM domain_orders WHERE status='active'",
    ),
  );
  for (const order of orders) {
    const hosts =
      order.mode === "automatic" || order.evidence?.includeWww
        ? [order.hostname, "www." + order.hostname]
        : [order.hostname];
    const results = await Promise.all(
      hosts.map((h) => readAddressHealth(db, actor, h)),
    );
    let health =
      results.find((h) => h.state === "attention") ??
      results.find((h) => h.state === "unchecked") ??
      results[0];
    if (
      order.mode === "automatic" &&
      order.dns_provider === "digitalocean" &&
      (deps.publicDns || !deps.resolve4)
    ) {
      try {
        const answer = await (deps.publicDns ?? publicDnsLookup)(
          order.hostname,
          "NS",
        );
        if (
          answer.status !== "ok" ||
          !sameNameservers(answer.answers, DIGITALOCEAN_NAMESERVERS)
        )
          throw new Error("Delegation changed");
      } catch {
        health = {
          state: "attention",
          checkedAt: new Date().toISOString(),
          message:
            "Domain nameservers changed or could not be verified. Contact support or restore the configured nameservers. Your platform address remains available.",
        };
      }
    }
    await db.tenant(actor, (tx) =>
      tx.query(
        "UPDATE domain_orders SET evidence=evidence||jsonb_build_object('websiteHealth',$2::jsonb) WHERE id=$1",
        [order.id, JSON.stringify(health)],
      ),
    );
  }
}
