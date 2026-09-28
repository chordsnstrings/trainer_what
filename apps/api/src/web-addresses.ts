/**
 * Trainer web addresses (docs/features/web-addresses.md): the automatic
 * subdomain, slug changes with a redirect, domain search and purchase, the
 * renewal switch, and the operator's view and manual fallback actions.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  elevated,
  event,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { requireCommerce, stripeClient } from "@trainer/providers";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import {
  registrarFromConfig,
  RegistrarError,
  type Registrar,
  type TldPrice,
} from "../../../packages/providers/src/registrar.ts";
import {
  RESERVED_SLUGS,
  SLUG_CHANGES_PER_YEAR,
  SLUG_PROBLEM_MESSAGES,
  SLUG_REDIRECT_DAYS,
  allowedTlds,
  searchCandidates,
  slugProblem,
  splitRegistrableDomain,
  subdomainEligible,
  subdomainHost,
  yearlyPriceMinor,
} from "../../../packages/domain/src/web-address.ts";
import { newToken } from "./auth.ts";
import { requireRecentMfa } from "./security.ts";
import { platformRoot } from "./host-routing.ts";
import type { HostContext } from "./host-routing.ts";
import { normalizeDomain } from "./integrations-completion.ts";
import {
  failOrder,
  processWebAddressOrder,
  purchasesEnabled,
  type WebAddressDeps,
  type WebAddressStripe,
} from "./web-address-orders.ts";

type Identity = Actor & {
  platformRole?: string;
  mfaAt?: string | null;
  email?: string;
};
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const uuid = z.string().uuid();
function identity(req: FastifyRequest): Identity {
  if (!req.identity) throw fail(401, "AUTH_REQUIRED", "Please sign in.");
  return req.identity as Identity;
}
function owner(req: FastifyRequest) {
  const a = identity(req);
  if (a.role !== "owner")
    throw fail(403, "OWNER_REQUIRED", "Workspace owner access is required.");
  return a;
}
function admin(req: FastifyRequest) {
  const a = identity(req);
  if (a.platformRole !== "admin")
    throw fail(
      403,
      "ADMIN_REQUIRED",
      "Platform administrator access is required.",
    );
  requireRecentMfa(a, true);
  return a;
}
function origin(req: FastifyRequest) {
  return (
    ((req as any).hostContext as HostContext | undefined)?.origin ??
    runtimeConfig().PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}

// ---- Slugs --------------------------------------------------------------------

/**
 * Refuses a slug that is malformed, reserved or still held by a renamed
 * workspace's redirect (another workspace's; a workspace may take back its own).
 */
export async function assertSlugAvailable(
  db: Database,
  slug: string,
  tenantId?: string,
) {
  const problem = slugProblem(slug);
  if (problem)
    throw fail(
      400,
      problem === "reserved" ? "RESERVED_SLUG" : "INVALID_SLUG",
      SLUG_PROBLEM_MESSAGES[problem],
    );
  const [held] = await db.system((tx) =>
    tx.query(
      "SELECT 1 FROM tenant_slug_redirects WHERE slug=$1 AND redirect_until>now() AND ($2::uuid IS NULL OR tenant_id<>$2)",
      [slug, tenantId ?? null],
    ),
  );
  if (held)
    throw fail(
      409,
      "SLUG_TAKEN",
      "This address is taken. Please choose another.",
    );
}
async function slugState(db: Database, tenantId: string) {
  return db.system(async (tx) => {
    const [tenant] = await tx.query(
      "SELECT slug,published,lifecycle_state FROM tenants WHERE id=$1",
      [tenantId],
    );
    const redirects = await tx.query(
      "SELECT slug,redirect_until,created_at FROM tenant_slug_redirects WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10",
      [tenantId],
    );
    return { tenant, redirects };
  });
}

async function slugChangesThisYear(tx: Tx) {
  const [row] = await tx.query(
    "SELECT count(*)::int AS n FROM events WHERE name='web_address.slug_changed' AND created_at>now()-interval '365 days'",
  );
  return Number(row?.n ?? 0);
}

// ---- Search and prices ---------------------------------------------------------

const priceCache = new Map<string, { at: number; price: TldPrice }>();
const PRICE_TTL_MS = 3600000;
async function tldPrice(registrar: Registrar, tld: string) {
  const key = `${registrar.id}:${registrar.sandbox}:${tld}`;
  const hit = priceCache.get(key);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.price;
  const price = await registrar.pricing(tld);
  priceCache.set(key, { at: Date.now(), price });
  return price;
}
/** Forget cached registrar prices (tests; a settings change takes effect within an hour otherwise). */
export function clearWebAddressPriceCache() {
  priceCache.clear();
}
function pricing() {
  const config = runtimeConfig();
  return {
    usdToAed: config.WEB_ADDRESS_USD_TO_AED?.trim() || "3.6725",
    marginAed: config.WEB_ADDRESS_MARGIN_AED?.trim() || "25",
    tlds: allowedTlds(config.WEB_ADDRESS_TLDS),
  };
}
function assertNotPlatformName(domain: string) {
  const root = platformRoot();
  if (root && (domain === root || domain.endsWith("." + root)))
    throw fail(
      400,
      "DOMAIN_NAME",
      "Addresses under the platform domain are given automatically.",
    );
}
export type SearchResult = {
  domain: string;
  available: boolean;
  premium: boolean;
  priceMinor: number | null;
  currency: "AED";
  renewsYearly: true;
};
export async function searchDomains(
  query: string,
  deps: { registrar?: Registrar } = {},
): Promise<SearchResult[]> {
  const settings = pricing();
  const candidates = searchCandidates(query, settings.tlds).filter((name) => {
    try {
      assertNotPlatformName(name);
      return true;
    } catch {
      return false;
    }
  });
  if (!candidates.length)
    throw fail(
      400,
      "DOMAIN_SEARCH",
      `Enter a name, or a full domain ending in ${settings.tlds.map((t) => "." + t).join(", ")}.`,
    );
  const registrar = deps.registrar ?? registrarFromConfig();
  let availability;
  try {
    availability = await registrar.check(candidates);
  } catch (error) {
    throw registrarUnavailable(error);
  }
  const out: SearchResult[] = [];
  for (const name of candidates) {
    const found = availability.find((item) => item.domain === name);
    const tld = splitRegistrableDomain(name, settings.tlds)?.[1];
    let priceMinor: number | null = null;
    if (found?.available && !found.premium && tld)
      try {
        const price = await tldPrice(registrar, tld);
        priceMinor = yearlyPriceMinor({
          registerUsd: price.registerUsd,
          renewUsd: price.renewUsd,
          usdToAed: settings.usdToAed,
          marginAed: settings.marginAed,
        });
      } catch {
        priceMinor = null;
      }
    out.push({
      domain: name,
      available: !!found?.available && !found.premium && priceMinor !== null,
      premium: !!found?.premium,
      priceMinor,
      currency: "AED",
      renewsYearly: true,
    });
  }
  return out;
}
function registrarUnavailable(error: unknown) {
  if (error instanceof RegistrarError)
    return fail(
      503,
      "REGISTRAR_UNAVAILABLE",
      "Domain search is unavailable right now. Please try again shortly.",
    );
  return error;
}
/** A fresh quote for one name: available, not premium, with its current price. */
async function quote(registrar: Registrar, domain: string) {
  const settings = pricing();
  const split = splitRegistrableDomain(domain, settings.tlds);
  if (!split)
    throw fail(400, "DOMAIN_NAME", "This domain ending is not offered.");
  let availability, price;
  try {
    [availability] = await registrar.check([domain]);
    price = await registrar.pricing(split[1]);
  } catch (error) {
    throw registrarUnavailable(error);
  }
  if (!availability?.available || availability.premium)
    throw fail(
      409,
      "DOMAIN_UNAVAILABLE",
      "This domain is no longer available.",
    );
  priceCache.set(`${registrar.id}:${registrar.sandbox}:${split[1]}`, {
    at: Date.now(),
    price,
  });
  return {
    priceMinor: yearlyPriceMinor({
      registerUsd: price.registerUsd,
      renewUsd: price.renewUsd,
      usdToAed: settings.usdToAed,
      marginAed: settings.marginAed,
    }),
    currency: "AED",
    registerUsd: price.registerUsd,
    renewUsd: price.renewUsd,
    usdToAed: settings.usdToAed,
    marginAed: settings.marginAed,
    termYears: 1,
    registrar: registrar.id,
    registrarSandbox: registrar.sandbox,
  };
}

// ---- Views ----------------------------------------------------------------------

const TRAINER_STEPS: Record<string, string> = {
  checkout: "Waiting for payment",
  paid: "Paid; registering your domain",
  purchasing: "Registering your domain",
  owned: "Registered; setting up DNS",
  dns: "Waiting for DNS and the security certificate",
  active: "Live",
  expired: "Expired",
  cancelled: "Cancelled",
  failed: "Could not be registered; refunded",
};
export function trainerOrderView(order: Record<string, any>) {
  return {
    id: order.id,
    hostname: order.hostname,
    status: order.status,
    statusLabel: TRAINER_STEPS[order.status] ?? order.status,
    priceMinor: Number(order.quote?.priceMinor ?? 0),
    currency: "AED",
    expiresAt: order.expires_at,
    liveAt: order.live_at,
    renewalEnabled: order.renewal_enabled,
    renewalStatus: order.renewal_status,
    billingStatus: order.billing_status,
    nextRenewalChargeAt: order.evidence?.nextRenewalChargeAt ?? null,
    progress: (order.progress ?? []).map((p: any) => ({
      step: p.step,
      at: p.at,
    })),
    // Operators see the reason; the trainer sees that it is being handled.
    needsReview: !!order.attention,
    createdAt: order.created_at,
    version: order.version,
  };
}
async function operatorOrders(db: Database, operator: Identity, id?: string) {
  const tenants = await db.system((tx) =>
    tx.query<{ id: string; name: string; slug: string }>(
      "SELECT id,name,slug FROM tenants ORDER BY created_at DESC LIMIT 5000",
    ),
  );
  const out: any[] = [];
  for (const tenant of tenants) {
    const scope = elevated("platform-operator", {
      tenantId: tenant.id,
      userId: operator.userId,
      role: "owner",
    });
    const rows = await db.tenant(scope, async (tx) => {
      const orders = await tx.query(
        "SELECT * FROM domain_orders WHERE mode='automatic' AND ($1::uuid IS NULL OR id=$1) ORDER BY (attention IS NOT NULL) DESC,updated_at DESC LIMIT 200",
        [id ?? null],
      );
      for (const order of orders)
        order.operations = await tx.query(
          "SELECT id,kind,intent_key,status,outcome,cost_usd,created_at,finished_at FROM registrar_operations WHERE order_id=$1 ORDER BY created_at DESC LIMIT 10",
          [order.id],
        );
      return orders;
    });
    out.push(
      ...rows.map((order) => ({
        ...order,
        tenant_name: tenant.name,
        tenant_slug: tenant.slug,
        needsReconciliation: (order.operations ?? []).some(
          (op: any) =>
            ["sent", "failed", "unknown"].includes(op.status) &&
            op.kind !== "set_hosts",
        ),
      })),
    );
    if (id && out.length) break;
  }
  return out.sort(
    (a, b) =>
      Number(!!b.attention || b.needsReconciliation) -
        Number(!!a.attention || a.needsReconciliation) ||
      Date.parse(b.updated_at) - Date.parse(a.updated_at),
  );
}

// ---- Routes ---------------------------------------------------------------------

export function registerWebAddresses(
  app: FastifyInstance,
  db: Database,
  deps: WebAddressDeps = {},
) {
  // New checkouts pass the commerce approval gate; servicing an existing
  // subscription (renewal switch, cancelling an unpaid checkout) does not.
  const commerce = () => {
    if (!deps.stripe) return requireCommerce() as unknown as WebAddressStripe;
    if (runtimeConfig().COMMERCE_APPROVED !== "true") requireCommerce();
    return deps.stripe;
  };
  const stripe = () =>
    deps.stripe ?? (stripeClient() as unknown as WebAddressStripe);

  app.get("/api/v1/web-address", async (req) => {
    const a = owner(req);
    const root = platformRoot();
    const { tenant, redirects } = await slugState(db, a.tenantId);
    const orders = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT * FROM domain_orders WHERE mode='automatic' ORDER BY created_at DESC LIMIT 20",
      ),
    );
    const config = runtimeConfig();
    const eligible =
      subdomainEligible(tenant.slug) && !RESERVED_SLUGS.has(tenant.slug);
    const recent = await db.tenant(a, (tx) => slugChangesThisYear(tx));
    return {
      slug: tenant.slug,
      published: tenant.published === true,
      path: "/coach/" + tenant.slug,
      subdomain: root
        ? {
            enabled: true,
            eligible,
            host: eligible ? subdomainHost(tenant.slug, root) : null,
            url: eligible
              ? "https://" + subdomainHost(tenant.slug, root)
              : null,
            live: eligible && tenant.published === true,
          }
        : { enabled: false, eligible, host: null, url: null, live: false },
      slugChanges: {
        used: recent,
        limit: SLUG_CHANGES_PER_YEAR,
        redirectDays: SLUG_REDIRECT_DAYS,
      },
      redirects: redirects
        .filter((r: any) => Date.parse(r.redirect_until) > Date.now())
        .map((r: any) => ({ slug: r.slug, until: r.redirect_until })),
      purchases: {
        enabled: purchasesEnabled(),
        currency: "AED",
        endings: allowedTlds(config.WEB_ADDRESS_TLDS),
        testEnvironment:
          (config.WEB_ADDRESS_REGISTRAR || "namecheap") === "namecheap" &&
          config.NAMECHEAP_SANDBOX?.trim() !== "false",
      },
      orders: orders.map(trainerOrderView),
    };
  });

  app.post(
    "/api/v1/web-address/slug",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req);
      requireRecentMfa(a);
      const b = z
        .object({
          slug: z.string().trim().toLowerCase().pipe(z.string().max(40)),
          currentSlug: z.string().max(80),
        })
        .strict()
        .parse(req.body);
      await assertSlugAvailable(db, b.slug, a.tenantId);
      const changed = await db.system(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "slug:" + b.slug,
        ]);
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "slug-tenant:" + a.tenantId,
        ]);
        const [tenant] = await tx.query(
          "SELECT slug FROM tenants WHERE id=$1 FOR UPDATE",
          [a.tenantId],
        );
        if (!tenant || tenant.slug !== b.currentSlug)
          throw fail(
            409,
            "SLUG_CHANGED",
            "Your address changed. Reload before continuing.",
          );
        if (tenant.slug === b.slug) return null;
        const [held] = await tx.query(
          "SELECT 1 FROM tenants WHERE slug=$1 UNION ALL SELECT 1 FROM tenant_slug_redirects WHERE slug=$1 AND redirect_until>now() AND tenant_id<>$2",
          [b.slug, a.tenantId],
        );
        if (held)
          throw fail(
            409,
            "SLUG_TAKEN",
            "This address is taken. Please choose another.",
          );
        // Counted from the immutable audit events (a reused name keeps one
        // redirect row, so the redirect table would undercount).
        const count = await tx.tenant(a, (tx) => slugChangesThisYear(tx));
        if (count >= SLUG_CHANGES_PER_YEAR)
          throw fail(
            429,
            "SLUG_CHANGE_LIMIT",
            `An address can change ${SLUG_CHANGES_PER_YEAR} times a year. Contact support for another change.`,
          );
        await tx.query("UPDATE tenants SET slug=$1 WHERE id=$2", [
          b.slug,
          a.tenantId,
        ]);
        // The previous name keeps redirecting and stays reserved for this
        // workspace; taking back an own previous name ends its redirect.
        await tx.query(
          "INSERT INTO tenant_slug_redirects(slug,tenant_id,redirect_until,changed_by) VALUES($1,$2,now()+make_interval(days=>$3),$4) ON CONFLICT(slug) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,redirect_until=EXCLUDED.redirect_until,changed_by=EXCLUDED.changed_by,created_at=now()",
          [tenant.slug, a.tenantId, SLUG_REDIRECT_DAYS, a.userId],
        );
        await tx.query(
          "UPDATE tenant_slug_redirects SET redirect_until=now() WHERE slug=$1 AND tenant_id=$2 AND redirect_until>now()",
          [b.slug, a.tenantId],
        );
        await tx.tenant(a, (tx) =>
          event(tx, a, "web_address.slug_changed", a.tenantId, {
            from: tenant.slug,
            to: b.slug,
          }),
        );
        return { from: tenant.slug, to: b.slug };
      });
      return { ok: true, slug: b.slug, changed };
    },
  );

  // Where a previous slug now lives (platform address only), for the old
  // /coach/<slug> and /join-coach/<slug> links.
  app.get("/api/v1/public/slug-redirect/:slug", async (req, reply) => {
    const slug = z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
      .safeParse((req.params as any).slug);
    if (!slug.success || req.hostContext?.custom)
      return reply.code(404).send({ code: "NOT_FOUND" });
    const [row] = await db.system((tx) =>
      tx.query(
        "SELECT t.slug FROM tenant_slug_redirects r JOIN tenants t ON t.id=r.tenant_id WHERE r.slug=$1 AND r.redirect_until>now() AND t.slug<>r.slug AND t.published=true AND t.lifecycle_state='active'",
        [slug.data],
      ),
    );
    if (!row) return reply.code(404).send({ code: "NOT_FOUND" });
    return { slug: row.slug };
  });

  app.get(
    "/api/v1/web-address/search",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      owner(req);
      if (!purchasesEnabled())
        throw fail(
          409,
          "WEB_ADDRESS_DISABLED",
          "Buying a domain is not available yet.",
        );
      const q = z.object({ q: z.string().min(1).max(80) }).parse(req.query).q;
      return { results: await searchDomains(q, { registrar: deps.registrar }) };
    },
  );

  app.post(
    "/api/v1/web-address/orders",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req);
      requireRecentMfa(a);
      if (!purchasesEnabled())
        throw fail(
          409,
          "WEB_ADDRESS_DISABLED",
          "Buying a domain is not available yet.",
        );
      const b = z
        .object({
          domain: z.string().max(253),
          priceMinor: z.number().int().positive().max(10000000),
          accepted: z.literal(true),
        })
        .strict()
        .parse(req.body);
      const domain = normalizeDomain(b.domain);
      assertNotPlatformName(domain);
      const client = commerce();
      const registrar = deps.registrar ?? registrarFromConfig();
      const fresh = await quote(registrar, domain);
      if (fresh.priceMinor !== b.priceMinor)
        throw Object.assign(
          fail(
            409,
            "PRICE_CHANGED",
            "The price changed. Review the new yearly price before paying.",
          ),
          { priceMinor: fresh.priceMinor },
        );
      const orderId = randomUUID();
      const at = Date.now();
      const { tenant } = await slugState(db, a.tenantId);
      const checkout = {
        origin: origin(req),
        // Stripe needs at least 30 minutes; a replay must send identical parameters.
        expiresAt: Math.floor(at / 1000) + 35 * 60,
        email: a.email ?? null,
      };
      const created = await db.tenant(a, async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "domain:" + domain,
        ]);
        const [open] = await tx.query(
          "SELECT count(*)::int AS n FROM domain_orders WHERE mode='automatic' AND status='checkout'",
        );
        if (Number(open.n) >= 3)
          throw fail(
            429,
            "WEB_ADDRESS_OPEN",
            "Finish or cancel your open domain checkouts first.",
          );
        const [customer] = await tx.query(
          "SELECT stripe_customer_id FROM domain_orders WHERE mode='automatic' AND stripe_customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
        );
        const [row] = await tx.query(
          "INSERT INTO domain_orders(id,tenant_id,hostname,status,token,evidence,mode,registrar,quote,progress,next_attempt_at) VALUES($1,$2,$3,'checkout',$4,$5,'automatic',$6,$7,$8,now()+interval '2 hours') ON CONFLICT DO NOTHING RETURNING *",
          [
            orderId,
            a.tenantId,
            domain,
            newToken(),
            JSON.stringify({
              orderedBy: a.userId,
              slug: tenant.slug,
              checkout: {
                ...checkout,
                customer: customer?.stripe_customer_id ?? null,
              },
              acceptedAt: new Date(at).toISOString(),
            }),
            registrar.id,
            JSON.stringify({
              ...fresh,
              quotedAt: new Date(at).toISOString(),
            }),
            JSON.stringify([
              { step: "checkout", at: new Date(at).toISOString(), note: null },
            ]),
          ],
        );
        if (!row)
          throw fail(
            409,
            "DOMAIN_IN_USE",
            "This domain is being set up for another website.",
          );
        await event(tx, a, "web_address.checkout_started", row.id, {
          hostname: domain,
          priceMinor: fresh.priceMinor,
        });
        return row;
      });
      return createCheckout(client, created);
    },
  );
  async function createCheckout(
    client: WebAddressStripe,
    order: Record<string, any>,
  ) {
    const c = order.evidence.checkout;
    const metadata = {
      purpose: "web_address",
      tenant_id: order.tenant_id,
      web_address_order_id: order.id,
    };
    const session = await client.checkout.sessions.create(
      {
        mode: "subscription",
        client_reference_id: order.id,
        ...(c.customer
          ? { customer: c.customer }
          : c.email
            ? { customer_email: c.email }
            : {}),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "aed",
              unit_amount: Number(order.quote.priceMinor),
              recurring: { interval: "year" },
              product_data: { name: "Web address " + order.hostname },
            },
          },
        ],
        expires_at: c.expiresAt,
        metadata,
        subscription_data: {
          metadata,
          description: "Yearly registration of " + order.hostname,
        },
        success_url: `${c.origin}/trainer/domains?order=${order.id}`,
        cancel_url: `${c.origin}/trainer/domains?order=${order.id}&checkout=cancelled`,
      },
      { idempotencyKey: "web-address-checkout:" + order.id },
    );
    if (
      session?.client_reference_id !== order.id ||
      session?.metadata?.web_address_order_id !== order.id
    )
      throw fail(
        502,
        "CHECKOUT_UNRESOLVED",
        "The payment page could not be confirmed. Try again from Web address.",
      );
    const scope = elevated("provider-callback", {
      tenantId: order.tenant_id,
      role: "owner",
    });
    await db.tenant(scope, (tx) =>
      tx.query(
        "UPDATE domain_orders SET checkout_session_id=coalesce(checkout_session_id,$2),evidence=evidence||$3::jsonb,updated_at=now() WHERE id=$1 AND status='checkout'",
        [order.id, session.id, JSON.stringify({ checkoutUrl: session.url })],
      ),
    );
    return { orderId: order.id, url: session.url as string };
  }
  // Returns to an unpaid checkout (the same Stripe session: idempotent replay).
  app.post("/api/v1/web-address/orders/:id/checkout", async (req) => {
    const a = owner(req);
    const [order] = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT * FROM domain_orders WHERE id=$1 AND mode='automatic' AND status='checkout'",
        [uuid.parse((req.params as any).id)],
      ),
    );
    if (!order)
      throw fail(409, "CHECKOUT_CLOSED", "This checkout is no longer open.");
    if (order.evidence?.checkout?.expiresAt * 1000 <= Date.now() + 60000)
      throw fail(
        409,
        "CHECKOUT_CLOSED",
        "This checkout has expired. Search again.",
      );
    return createCheckout(commerce(), order);
  });
  app.get("/api/v1/web-address/orders/:id", async (req) => {
    const a = owner(req);
    const [order] = await db.tenant(a, (tx) =>
      tx.query("SELECT * FROM domain_orders WHERE id=$1 AND mode='automatic'", [
        uuid.parse((req.params as any).id),
      ]),
    );
    if (!order) throw fail(404, "NOT_FOUND", "Order not found.");
    return trainerOrderView(order);
  });
  app.post("/api/v1/web-address/orders/:id/cancel", async (req) => {
    const a = owner(req);
    const id = uuid.parse((req.params as any).id);
    const [order] = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT * FROM domain_orders WHERE id=$1 AND mode='automatic' AND status='checkout'",
        [id],
      ),
    );
    if (!order)
      throw fail(
        409,
        "ORDER_STATE",
        "Only an unpaid checkout can be cancelled.",
      );
    if (order.checkout_session_id) {
      const session = await stripe().checkout.sessions.retrieve(
        order.checkout_session_id,
      );
      if (session?.status === "complete")
        throw fail(
          409,
          "ORDER_PAID",
          "This checkout was paid; your domain is being set up.",
        );
      if (session?.status === "open")
        await stripe().checkout.sessions.expire(order.checkout_session_id);
    }
    return db.tenant(a, async (tx) => {
      const [row] = await tx.query(
        "UPDATE domain_orders SET status='cancelled',next_attempt_at=NULL,version=version+1,updated_at=now() WHERE id=$1 AND status='checkout' RETURNING *",
        [id],
      );
      if (!row) throw fail(409, "ORDER_STATE", "This order changed.");
      await event(tx, a, "web_address.checkout_cancelled", id);
      return trainerOrderView(row);
    });
  });
  app.post("/api/v1/web-address/orders/:id/renewal", async (req) => {
    const a = owner(req);
    requireRecentMfa(a);
    const id = uuid.parse((req.params as any).id);
    const b = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    const [order] = await db.tenant(a, (tx) =>
      tx.query(
        "SELECT * FROM domain_orders WHERE id=$1 AND mode='automatic' AND status IN ('owned','dns','active')",
        [id],
      ),
    );
    if (!order?.stripe_subscription_id)
      throw fail(
        409,
        "ORDER_STATE",
        "Renewal can be changed once the domain is registered.",
      );
    if (
      b.enabled &&
      ["canceled", "incomplete_expired"].includes(order.billing_status)
    )
      throw fail(
        409,
        "RENEWAL_ENDED",
        "The yearly subscription has ended; renewal cannot be turned back on.",
      );
    await stripe().subscriptions.update(
      order.stripe_subscription_id,
      { cancel_at_period_end: !b.enabled },
      {
        idempotencyKey: `web-address-renewal:${id}:${b.enabled}:${order.version}`,
      },
    );
    return db.tenant(a, async (tx) => {
      const [row] = await tx.query(
        "UPDATE domain_orders SET renewal_enabled=$2,notices='{}'::jsonb,next_attempt_at=CASE WHEN status='active' THEN now() ELSE next_attempt_at END,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [id, b.enabled],
      );
      await event(
        tx,
        a,
        "web_address.renewal_" + (b.enabled ? "on" : "off"),
        id,
      );
      return trainerOrderView(row);
    });
  });

  // ---- Operator view and manual fallback ----
  app.get("/api/v1/admin/web-addresses", async (req) => {
    const operator = admin(req);
    const orders = await operatorOrders(db, operator);
    const config = runtimeConfig();
    return {
      root: platformRoot(),
      registrar: config.WEB_ADDRESS_REGISTRAR || "namecheap",
      testEnvironment: config.NAMECHEAP_SANDBOX?.trim() !== "false",
      purchasesEnabled: purchasesEnabled(),
      orders,
      attention: orders.filter((o) => o.attention || o.needsReconciliation)
        .length,
    };
  });
  const operatorAction = z
    .object({ reason: z.string().trim().min(10).max(500) })
    .strict();
  async function operatorOrder(req: FastifyRequest) {
    const operator = admin(req);
    const body = operatorAction.parse(req.body);
    const [order] = await operatorOrders(
      db,
      operator,
      uuid.parse((req.params as any).id),
    );
    if (!order) throw fail(404, "NOT_FOUND", "Order not found.");
    const scope = elevated("platform-operator", {
      tenantId: order.tenant_id,
      userId: operator.userId,
      role: "owner",
    });
    return { operator, order, scope, reason: body.reason };
  }
  // Runs the next step now: a reconciliation for an open registrar attempt.
  app.post("/api/v1/admin/web-addresses/:id/reconcile", async (req) => {
    const { order, scope, reason } = await operatorOrder(req);
    await db.tenant(scope, async (tx) => {
      await tx.query(
        "UPDATE domain_orders SET next_attempt_at=now(),lease_until=NULL,updated_at=now() WHERE id=$1",
        [order.id],
      );
      await event(tx, scope, "web_address.operator_reconcile", order.id, {
        reason,
      });
    });
    await processWebAddressOrder(db, order.tenant_id, order.id, deps);
    return (await operatorOrders(db, identity(req), order.id))[0];
  });
  // Clears the attention flag and starts the current step again.
  app.post("/api/v1/admin/web-addresses/:id/retry", async (req) => {
    const { order, scope, reason } = await operatorOrder(req);
    if (["cancelled", "failed"].includes(order.status))
      throw fail(409, "ORDER_STATE", "This order is closed.");
    await db.tenant(scope, async (tx) => {
      await tx.query(
        "UPDATE domain_orders SET attention=NULL,attempts=0,evidence=evidence||'{\"purchaseAttempts\":0,\"renewalAttempts\":0}'::jsonb,next_attempt_at=now(),lease_until=NULL,renewal_status=CASE WHEN renewal_status='failed' THEN 'paid' ELSE renewal_status END,version=version+1,updated_at=now() WHERE id=$1",
        [order.id],
      );
      await event(tx, scope, "web_address.operator_retry", order.id, {
        reason,
      });
    });
    return (await operatorOrders(db, identity(req), order.id))[0];
  });
  // Refunds and closes an order whose domain was never registered.
  app.post("/api/v1/admin/web-addresses/:id/refund", async (req) => {
    const { order, scope, reason } = await operatorOrder(req);
    if (!["paid", "purchasing"].includes(order.status))
      throw fail(
        409,
        "ORDER_STATE",
        "Only a paid order whose domain was not registered can be refunded here.",
      );
    if (
      (order.operations ?? []).some(
        (op: any) =>
          op.kind === "register" &&
          ["sent", "failed", "unknown", "succeeded", "confirmed"].includes(
            op.status,
          ),
      )
    )
      throw fail(
        409,
        "RECONCILE_FIRST",
        "Reconcile the registrar attempt first: the domain may have been registered.",
      );
    await db.tenant(scope, (tx) =>
      event(tx, scope, "web_address.operator_refund", order.id, { reason }),
    );
    await failOrder(
      db,
      order.tenant_id,
      order,
      "The platform team closed this order.",
      deps,
    );
    return (await operatorOrders(db, identity(req), order.id))[0];
  });
}
export type { Tx };
