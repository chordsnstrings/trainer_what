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
  CHECK_BATCH,
  canBuyPremium,
  canRenew,
  canUseRegistrarDns,
  paymentModeProblem,
  premiumCostUsd,
  registrarFor,
  registrarFromConfig,
  registrarPurchaseProblem,
  registrarSandboxSetting,
  RegistrarError,
  stripeKeyMode,
  type Availability,
  type Registrar,
} from "../../../packages/providers/src/registrar.ts";
import { dnsHostingSettings } from "../../../packages/providers/src/dns-hosting.ts";
import {
  RESERVED_SLUGS,
  SLUG_CHANGES_PER_YEAR,
  SLUG_PROBLEM_MESSAGES,
  SLUG_REDIRECT_DAYS,
  cleanDomainQuery,
  domainPriceDetails,
  domainSearchPlan,
  isProtectedLabel,
  priceRuleFromSettings,
  protectedLabels,
  purchasableTlds,
  renewalPriceNote,
  slugProblem,
  splitRegistrableDomain,
  subdomainEligible,
  subdomainHost,
  suggestedTlds,
  trainerDomainPrices,
  type PriceRule,
} from "../../../packages/domain/src/web-address.ts";
import {
  fetchPrice,
  pricesForSearch,
  readPrices,
  refreshPricesNow,
  type EndingPrice,
} from "./web-address-prices.ts";
import { newToken } from "./auth.ts";
import { requireRecentMfa } from "./security.ts";
import { platformRoot } from "./host-routing.ts";
import type { HostContext } from "./host-routing.ts";
import { normalizeDomain } from "./integrations-completion.ts";
import {
  cancelSubscription,
  failOrder,
  mappingRedirects,
  orderPrices,
  processWebAddressOrder,
  purchasesEnabled,
  recordRegistrarState,
  renewalChargeAt,
  SETTLE_MS,
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

/** Forwarding needs a live workspace subdomain to forward to. */
async function assertForwardable(db: Database, tenantId: string) {
  const root = platformRoot();
  const { tenant } = await slugState(db, tenantId);
  if (
    !root ||
    !tenant ||
    !subdomainEligible(tenant.slug) ||
    RESERVED_SLUGS.has(tenant.slug)
  )
    throw fail(
      409,
      "FORWARD_UNAVAILABLE",
      "Forwarding needs your platform web address. Choose an address first, or show your site on the domain.",
    );
}

async function slugChangesThisYear(tx: Tx) {
  const [row] = await tx.query(
    "SELECT count(*)::int AS n FROM events WHERE name='web_address.slug_changed' AND created_at>now()-interval '365 days'",
  );
  return Number(row?.n ?? 0);
}

// ---- Registrar call budget -------------------------------------------------------

/**
 * Namecheap limits API calls per account (published as 20 a minute, 700 an
 * hour and 8000 a day). Searches and quotes from this API process may use
 * at most these shares, so trainers searching can never starve the worker's
 * purchases, renewals and reconciliation. Per process: the platform runs
 * one API process.
 */
export const INTERACTIVE_REGISTRAR_BUDGET = { minute: 8, hour: 300, day: 3500 };
const interactiveCalls: number[] = [];
/** Registrar calls the budget still allows now (the tightest window). */
function registrarCallsLeft() {
  const now = Date.now();
  while (interactiveCalls.length && interactiveCalls[0] <= now - 86400000)
    interactiveCalls.shift();
  const within = (ms: number) =>
    interactiveCalls.filter((at) => at > now - ms).length;
  return Math.min(
    INTERACTIVE_REGISTRAR_BUDGET.minute - within(60000),
    INTERACTIVE_REGISTRAR_BUDGET.hour - within(3600000),
    INTERACTIVE_REGISTRAR_BUDGET.day - interactiveCalls.length,
  );
}
function takeRegistrarCalls(count: number) {
  if (registrarCallsLeft() < count)
    throw fail(
      503,
      "REGISTRAR_BUSY",
      "Domain search is busy right now. Please try again in a minute.",
    );
  for (let i = 0; i < count; i++) interactiveCalls.push(Date.now());
}
/**
 * Takes one call when the budget still leaves `reserve` calls after it (a
 * search keeps its availability request); never throws.
 */
function tryTakeRegistrarCall(reserve = 0) {
  if (registrarCallsLeft() < 1 + reserve) return false;
  interactiveCalls.push(Date.now());
  return true;
}
/** Availability answers reused for a minute (the order always asks again). */
const checkCache = new Map<string, { at: number; result: Availability[] }>();
const CHECK_TTL_MS = 60000;
async function checkNames(registrar: Registrar, names: string[]) {
  const key = `${registrar.id}:${registrar.sandbox}:${names.join(",")}`;
  const hit = checkCache.get(key);
  if (hit && Date.now() - hit.at < CHECK_TTL_MS) return hit.result;
  // One request checks up to CHECK_BATCH names.
  takeRegistrarCalls(Math.ceil(names.length / CHECK_BATCH));
  const result = await registrar.check(names);
  if (checkCache.size > 500) checkCache.clear();
  checkCache.set(key, { at: Date.now(), result });
  return result;
}
/** Forget the call budget and cached answers (tests). */
export function resetRegistrarBudget() {
  interactiveCalls.length = 0;
  checkCache.clear();
}
/** Uses up this many calls of the budget now (tests). */
export function spendRegistrarBudget(count: number) {
  for (let i = 0; i < count; i++) interactiveCalls.push(Date.now());
}
/**
 * Why purchases cannot run with the configured payment and registrar
 * environments (Stripe live keys with the Namecheap test environment, or the
 * reverse), or null. Unknown key formats are checked on the Checkout session.
 */
export function configuredModeProblem() {
  const mode = stripeKeyMode();
  return mode
    ? paymentModeProblem(mode === "live", registrarSandboxSetting())
    : null;
}
/** Why no domain can be bought right now (operators see the reason), or null. */
export function buyingProblem() {
  return configuredModeProblem() ?? registrarPurchaseProblem();
}

// ---- Search and prices ---------------------------------------------------------

/**
 * The price rule (rounding, cap, minimum margin and Stripe's estimated fees),
 * the suggested endings, every ending that can be bought and the protected
 * brand names, from Super admin settings. An invalid rule
 * (possible only through the server environment: saved settings are
 * validated) stops buying rather than pricing wrongly.
 */
function pricing(): {
  rule: PriceRule;
  tlds: string[];
  allowed: string[];
  protectedNames: string[];
} {
  const config = runtimeConfig();
  let rule: PriceRule;
  try {
    rule = priceRuleFromSettings({
      step: config.WEB_ADDRESS_PRICE_STEP_USD,
      ending: config.WEB_ADDRESS_PRICE_ENDING_USD,
      cap: config.WEB_ADDRESS_PRICE_CAP_USD,
      minMargin: config.WEB_ADDRESS_MIN_MARGIN_USD,
      cardPercent: config.WEB_ADDRESS_STRIPE_PERCENT,
      internationalPercent: config.WEB_ADDRESS_STRIPE_INTERNATIONAL_PERCENT,
      fixedFee: config.WEB_ADDRESS_STRIPE_FIXED_USD,
      billingPercent: config.WEB_ADDRESS_STRIPE_BILLING_PERCENT,
      conversionPercent: config.WEB_ADDRESS_STRIPE_CONVERSION_PERCENT,
      usdBalance: config.WEB_ADDRESS_STRIPE_USD_BALANCE,
    });
  } catch {
    throw fail(
      409,
      "WEB_ADDRESS_DISABLED",
      "Buying a domain is not available yet.",
    );
  }
  const tlds = suggestedTlds(config.WEB_ADDRESS_TLDS);
  return {
    rule,
    tlds,
    allowed: purchasableTlds(tlds, config.WEB_ADDRESS_EXTRA_TLDS),
    protectedNames: protectedLabels(
      config.WEB_ADDRESS_PROTECTED_LABELS,
      platformRoot(),
    ),
  };
}
/** The platform's own domain and names under it are never sold. */
function isPlatformName(domain: string) {
  const root = platformRoot();
  return !!root && (domain === root || domain.endsWith("." + root));
}
function assertNotPlatformName(domain: string) {
  if (isPlatformName(domain))
    throw fail(
      400,
      "DOMAIN_NAME",
      "Addresses under the platform domain are given automatically.",
    );
}
/** Neutral Stripe wording for a trainer's yearly domain (never the registrar). */
export const WEB_ADDRESS_STRIPE_LABEL = "Custom web address — yearly";
export function webAddressStripeText(hostname: string) {
  return {
    productName: WEB_ADDRESS_STRIPE_LABEL,
    description: `${WEB_ADDRESS_STRIPE_LABEL}: ${hostname}`,
    /** The first year's difference from the yearly renewal price. */
    firstYearName: "Custom web address — first-year price",
  };
}
/**
 * The text above Stripe Checkout's pay button: the first-year and renewal
 * price, and the renewal note when the renewal costs more (at most 1,200
 * characters, Stripe's limit).
 */
export function checkoutNote(firstYearMinor: number, renewalMinor: number) {
  const money = (minor: number) => `USD ${(minor / 100).toFixed(2)}`;
  const note = renewalPriceNote(firstYearMinor, renewalMinor);
  return (
    `First year ${money(firstYearMinor)} today, then ${money(renewalMinor)} every year, renewed automatically until you turn renewal off in Web address.` +
    (note ? " " + note : "")
  ).slice(0, 1200);
}
/**
 * What a trainer sees and agrees to for one available name: the first-year
 * price and the yearly renewal price in US cents (owner decision,
 * 28 September 2026). The registrar's name and cost never reach a trainer.
 */
export type SearchResult = {
  domain: string;
  available: true;
  premium: boolean;
  firstYearPriceMinor: number;
  renewalPriceMinor: number;
  currency: "USD";
  renewsYearly: true;
};
/**
 * available: offered at the prices in `results`; taken: registered by
 * someone; not_offered: over the price limit, an ending that cannot be
 * bought here, or an early-access name; unknown: its price or availability
 * could not be read right now.
 */
export type NameStatus = "available" | "taken" | "not_offered" | "unknown";
export type SearchAnswer = {
  /** The name the trainer asked about and whether it can be bought. */
  requested: { domain: string; status: NameStatus };
  /**
   * Names that can be bought, each within the price limit: the requested
   * name first when available, then the name under each suggested ending in
   * the configured order.
   */
  results: SearchResult[];
  /** Some endings could not be priced or checked right now: search again shortly. */
  incomplete: boolean;
  currency: "USD";
  /** Names over this first-year or renewal price are never shown. */
  priceCapMinor: number;
};
/**
 * The costs a name is priced from: the premium costs for a premium name (only
 * where the registrar can buy it at that price), the ending's costs
 * otherwise; null when the name cannot be offered.
 */
function nameCost(
  registrar: Registrar,
  availability: Availability,
  ending: EndingPrice,
) {
  if (ending.kind !== "price" || availability.earlyAccessFeeUsd) return null;
  if (!availability.premium)
    return {
      registerUsd: ending.registerUsd,
      renewUsd: ending.renewUsd,
      premium: null,
    };
  if (!canBuyPremium(registrar)) return null;
  const cost = premiumCostUsd(availability);
  return cost
    ? {
        ...cost,
        // What the registrar's order and every renewal must name, as checked.
        premium: {
          registerUsd: availability.premiumRegisterUsd!,
          renewUsd: availability.premiumRenewUsd!,
        },
      }
    : null;
}
/**
 * A trainer's search (owner decision, 28 September 2026): the typed name
 * and the name under every suggested ending, checked in one registrar
 * request, priced from the cached per-ending prices (premium names from the
 * check), without taken names and without names whose first-year or renewal
 * price is over the cap.
 */
export async function searchDomains(
  query: string,
  deps: { registrar?: Registrar; db?: Database } = {},
): Promise<SearchAnswer> {
  const settings = pricing();
  // A name under the platform's domain is given automatically.
  const typed = cleanDomainQuery(query);
  if (typed !== platformRoot()) assertNotPlatformName(typed);
  const plan = domainSearchPlan(query, settings.tlds, settings.allowed);
  if (!plan) throw fail(400, "DOMAIN_SEARCH", DOMAIN_SEARCH_MESSAGE);
  const answer = (
    status: NameStatus,
    results: SearchResult[] = [],
    incomplete = false,
  ): SearchAnswer => ({
    requested: { domain: plan.requested, status },
    results,
    incomplete,
    currency: "USD",
    priceCapMinor: settings.rule.capCents,
  });
  // The platform's brand is never sold on any ending (it would look
  // official): answered without asking the registrar.
  if (isProtectedLabel(plan.label, settings.protectedNames))
    return answer("not_offered");
  const names = plan.names.filter((name) => !isPlatformName(name));
  const registrar = trainerRegistrar(deps);
  const endingOf = (name: string) => splitRegistrableDomain(name)![1];
  let prices: Map<string, EndingPrice>;
  // Missing prices are fetched while the budget still leaves room for the
  // availability request; the typed name's ending is priced first.
  const checkRequests = Math.ceil(names.length / CHECK_BATCH);
  try {
    prices = await pricesForSearch(
      deps.db,
      registrar,
      [...new Set(names.map(endingOf))],
      () => tryTakeRegistrarCall(checkRequests),
    );
  } catch (error) {
    throw registrarUnavailable(error);
  }
  // Only names under an ending the registrar sells are checked.
  const checkable = names.filter(
    (name) => prices.get(endingOf(name))?.kind === "price",
  );
  let availability: Availability[] = [];
  if (checkable.length)
    try {
      availability = await checkNames(registrar, checkable);
    } catch (error) {
      throw registrarUnavailable(error);
    }
  const statuses = new Map<string, NameStatus>();
  const results: SearchResult[] = [];
  let incomplete = false;
  for (const name of names) {
    const price = prices.get(endingOf(name));
    const found = availability.find((item) => item.domain === name);
    let status: NameStatus;
    if (!price) status = "unknown";
    else if (price.kind === "not_offered") status = "not_offered";
    else if (!found || found.checkFailed) status = "unknown";
    else if (!found.available) status = "taken";
    else {
      const cost = nameCost(registrar, found, price);
      const priced = cost && trainerDomainPrices(cost, settings.rule);
      if (priced?.offered) {
        status = "available";
        results.push({
          domain: name,
          available: true,
          premium: found.premium,
          firstYearPriceMinor: priced.firstYearCents,
          renewalPriceMinor: priced.renewalCents,
          currency: "USD",
          renewsYearly: true,
        });
      } else status = "not_offered";
    }
    if (status === "unknown") incomplete = true;
    statuses.set(name, status);
  }
  // A requested name outside the endings that can be bought was never
  // checked: it is not offered here.
  return answer(
    statuses.get(plan.requested) ?? "not_offered",
    results,
    incomplete,
  );
}
/** Why a search text was refused: the rule a trainer can follow. */
const DOMAIN_SEARCH_MESSAGE =
  "Use English letters, digits and hyphens: a name such as laylastrength, or a full domain such as laylastrength.com. Accented and Arabic letters are not supported yet.";
/**
 * The configured registrar for a trainer's search or checkout. Its
 * configuration problem names the registrar, so a trainer only hears that
 * buying is unavailable (owner decision: the registrar is never named to
 * trainers); operators see the problem in Settings and the connection test.
 */
function trainerRegistrar(deps: { registrar?: Registrar }) {
  if (deps.registrar) return deps.registrar;
  try {
    return registrarFromConfig();
  } catch {
    throw fail(
      409,
      "WEB_ADDRESS_DISABLED",
      "Buying a domain is not available yet.",
    );
  }
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
/**
 * A fresh quote for one name at checkout: available now, priced from its
 * ending's price asked for again (and cached), a premium name at its checked
 * premium price, within the cap. Stored on the order for operators; trainers
 * see only the two USD prices.
 */
async function quote(registrar: Registrar, domain: string, db: Database) {
  const settings = pricing();
  const split = splitRegistrableDomain(domain);
  if (!split)
    throw fail(
      400,
      "DOMAIN_NAME",
      "Enter a full domain such as laylastrength.com.",
    );
  // Only the endings an operator allows, and never the platform's brand;
  // nothing is asked of the registrar for either.
  if (
    !settings.allowed.includes(split[1]) ||
    isProtectedLabel(split[0], settings.protectedNames)
  )
    throw fail(409, "DOMAIN_UNAVAILABLE", "This domain is not offered here.");
  let availability: Availability | undefined, price: EndingPrice;
  takeRegistrarCalls(2);
  try {
    // The ending's price first: Namecheap refuses a whole availability
    // request that names an ending it does not sell.
    price = await fetchPrice(db, registrar, split[1]);
    if (price.kind !== "price")
      throw fail(409, "DOMAIN_UNAVAILABLE", "This domain is not offered here.");
    [availability] = await registrar.check([domain]);
  } catch (error) {
    throw registrarUnavailable(error);
  }
  if (
    !availability?.available ||
    availability.checkFailed ||
    availability.domain !== domain
  )
    throw fail(409, "DOMAIN_UNAVAILABLE", "This domain is no longer available.");
  const cost = nameCost(registrar, availability, price);
  const priced = cost && trainerDomainPrices(cost, settings.rule);
  if (!cost || !priced?.offered)
    throw fail(409, "DOMAIN_UNAVAILABLE", "This domain is not offered here.");
  return {
    currency: "USD" as const,
    firstYearPriceMinor: priced.firstYearCents,
    renewalPriceMinor: priced.renewalCents,
    // The registrar's one-year costs the prices come from (ICANN fee
    // included); for a premium name also its premium prices as checked,
    // which the registration and every renewal must name.
    registerUsd: cost.registerUsd,
    renewUsd: cost.renewUsd,
    premium: cost.premium,
    priceRule: settings.rule,
    termYears: 1,
    registrar: registrar.id,
    registrarSandbox: registrar.sandbox,
  };
}

/** The registrar for new purchases, for operators (its problem is shown as it is). */
function operatorRegistrar(deps: { registrar?: Registrar }) {
  if (deps.registrar) return deps.registrar;
  try {
    return registrarFromConfig();
  } catch (error) {
    throw fail(
      409,
      "REGISTRAR_NOT_CONFIGURED",
      (error as Error)?.message ?? "The registrar settings are incomplete.",
    );
  }
}
/**
 * Every ending trainers can buy, as the cache holds it now: the registrar's
 * one-year costs, the trainer's two prices by the current rule, whether the
 * cap hides it, and for each year the margin before Stripe's fees, Stripe's
 * estimated card, Billing and conversion fees, the net margin after them
 * and whether the minimum margin moved the price up. Operators only.
 */
async function operatorPrices(db: Database, deps: { registrar?: Registrar }) {
  const settings = pricing();
  const registrar = operatorRegistrar(deps);
  const cached = await readPrices(db, registrar, settings.allowed);
  const endings = settings.allowed.map((tld) => {
    const price = cached.get(tld);
    const base = {
      tld,
      suggested: settings.tlds.includes(tld),
      fetchedAt: price ? new Date(price.fetchedAt).toISOString() : null,
    };
    if (!price) return { ...base, state: "unknown" as const };
    if (price.kind === "not_offered")
      return { ...base, state: "not_offered" as const, reason: price.reason };
    const priced = domainPriceDetails(price, settings.rule);
    const year = (detail: typeof priced.firstYear) => ({
      priceMinor: detail.priceCents,
      costMinor: detail.costCents,
      // What is left after the registrar's cost, before Stripe's fees.
      grossMarginMinor: detail.priceCents - detail.costCents,
      cardFeeMinor: detail.cardFeeCents,
      billingFeeMinor: detail.billingFeeCents,
      conversionFeeMinor: detail.conversionFeeCents,
      // What is left after the registrar's cost and Stripe's estimated fees.
      netMarginMinor: detail.marginCents,
      raisedForMargin: detail.raisedSteps > 0,
    });
    return {
      ...base,
      state: priced.offered ? ("offered" as const) : ("over_cap" as const),
      registerUsd: price.registerUsd,
      renewUsd: price.renewUsd,
      firstYearPriceMinor: priced.firstYear.priceCents,
      renewalPriceMinor: priced.renewal.priceCents,
      firstYearMarginMinor: priced.firstYear.priceCents - priced.firstYear.costCents,
      renewalMarginMinor: priced.renewal.priceCents - priced.renewal.costCents,
      firstYear: year(priced.firstYear),
      renewal: year(priced.renewal),
    };
  });
  return {
    registrar: registrar.id,
    testEnvironment: registrar.sandbox,
    rule: settings.rule,
    endings,
  };
}

// ---- Views ----------------------------------------------------------------------

const TRAINER_STEPS: Record<string, string> = {
  checkout: "Waiting for payment",
  paid: "Paid; registering your domain",
  purchasing: "Registering your domain",
  owned: "Registered; setting up DNS",
  zone: "Registered; setting up DNS",
  delegating: "Connecting your domain to your website",
  dns: "Waiting for DNS and the security certificate",
  active: "Live",
  expired: "Expired",
  cancelled: "Cancelled",
  failed: "Could not be registered; refunded",
};
export function trainerOrderView(order: Record<string, any>) {
  // Only the first-year and renewal price, in the currency the order was
  // priced in (USD; orders placed before 28 September 2026 in AED): never
  // the registrar, its cost or the price rule kept in the quote.
  const prices = orderPrices(order);
  // This period's yearly charge, never an earlier year's recorded date.
  const chargeAt = renewalChargeAt(order);
  return {
    id: order.id,
    hostname: order.hostname,
    status: order.status,
    statusLabel: TRAINER_STEPS[order.status] ?? order.status,
    firstYearPriceMinor: prices.firstYearMinor,
    renewalPriceMinor: prices.renewalMinor,
    currency: prices.currency,
    expiresAt: order.expires_at,
    liveAt: order.live_at,
    renewalEnabled: order.renewal_enabled,
    renewalStatus: order.renewal_status,
    billingStatus: order.billing_status,
    nextRenewalChargeAt:
      chargeAt === null ? null : new Date(chargeAt).toISOString(),
    // "site" shows the website on the domain; "forward" sends visitors to
    // the workspace subdomain. Never which DNS host serves it.
    serveMode: order.serve_mode === "forward" ? "forward" : "site",
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
        // A request sent moments ago may still be running: it is shown as
        // in flight, not as an item to reconcile. DNS calls converge on
        // their next attempt (they read the current state back), so only
        // purchases and renewals wait for reconciliation.
        needsReconciliation: (order.operations ?? []).some(
          (op: any) =>
            ["register", "renew"].includes(op.kind) &&
            (["failed", "unknown"].includes(op.status) ||
              (op.status === "sent" &&
                Date.now() - Date.parse(op.created_at) >= SETTLE_MS)),
        ),
        inFlight: (order.operations ?? []).some(
          (op: any) =>
            op.status === "sent" &&
            Date.now() - Date.parse(op.created_at) < SETTLE_MS,
        ),
        // The registrar charged, or now asks, more than the trainer's price
        // covers (cleared by Retry).
        costAlert: order.evidence?.costAlert?.message ?? null,
      })),
    );
    if (id && out.length) break;
  }
  return out.sort(
    (a, b) =>
      Number(!!b.attention || b.needsReconciliation || !!b.costAlert) -
        Number(!!a.attention || a.needsReconciliation || !!a.costAlert) ||
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
    let rule: PriceRule | null = null;
    try {
      rule = pricing().rule;
    } catch {
      rule = null;
    }
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
        enabled: purchasesEnabled() && !buyingProblem() && !!rule,
        // Trainers see and pay domain prices in USD (owner decision,
        // 28 September 2026).
        currency: "USD",
        endings: suggestedTlds(config.WEB_ADDRESS_TLDS),
        priceCapMinor: rule?.capCents ?? null,
        testEnvironment: registrarSandboxSetting(config),
      },
      orders: orders.map(trainerOrderView),
    };
  });
  // The owner decides how a bought domain is served: the website itself, or
  // a permanent redirect to the workspace's subdomain (path and query kept).
  // Applied at once to an active domain's mapping; www always redirects to
  // the domain.
  app.post(
    "/api/v1/web-address/orders/:id/serve-mode",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req);
      requireRecentMfa(a);
      const id = uuid.parse((req.params as any).id);
      const b = z
        .object({ mode: z.enum(["site", "forward"]) })
        .strict()
        .parse(req.body);
      if (b.mode === "forward") await assertForwardable(db, a.tenantId);
      return db.system(async (tx) => {
        const row = await tx.tenant(a, async (tx) => {
          const [row] = await tx.query(
            "UPDATE domain_orders SET serve_mode=$2,version=version+1,updated_at=now() WHERE id=$1 AND mode='automatic' AND status NOT IN ('cancelled','failed') RETURNING *",
            [id, b.mode],
          );
          if (!row) throw fail(404, "NOT_FOUND", "Order not found.");
          await event(tx, a, "web_address.serve_mode", id, { mode: b.mode });
          return row;
        });
        // Only this workspace's mapping of this domain changes.
        const [apex] = mappingRedirects(row.hostname, row.serve_mode);
        await tx.query(
          "UPDATE domain_mappings SET redirect=$3 WHERE hostname=$1 AND tenant_id=$2",
          [apex.hostname, a.tenantId, apex.redirect],
        );
        return trainerOrderView(row);
      });
    },
  );

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
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    async (req) => {
      owner(req);
      if (!purchasesEnabled() || registrarPurchaseProblem())
        throw fail(
          409,
          "WEB_ADDRESS_DISABLED",
          "Buying a domain is not available yet.",
        );
      const q = z.object({ q: z.string().min(1).max(80) }).parse(req.query).q;
      return searchDomains(q, { registrar: deps.registrar, db });
    },
  );

  app.post(
    "/api/v1/web-address/orders",
    { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } },
    async (req) => {
      const a = owner(req);
      requireRecentMfa(a);
      if (!purchasesEnabled() || registrarPurchaseProblem())
        throw fail(
          409,
          "WEB_ADDRESS_DISABLED",
          "Buying a domain is not available yet.",
        );
      const b = z
        .object({
          domain: z.string().max(253),
          // The two prices the trainer agreed to, in US cents.
          firstYearPriceMinor: z.number().int().positive().max(10000000),
          renewalPriceMinor: z.number().int().positive().max(10000000),
          currency: z.literal("USD").optional(),
          accepted: z.literal(true),
          // Show the website on the domain (default) or forward to the subdomain.
          serveMode: z.enum(["site", "forward"]).optional(),
        })
        .strict()
        .parse(req.body);
      const domain = normalizeDomain(b.domain);
      assertNotPlatformName(domain);
      const serveMode = b.serveMode ?? "site";
      if (serveMode === "forward") await assertForwardable(db, a.tenantId);
      const client = commerce();
      const registrar = trainerRegistrar(deps);
      // Real money never buys in a test environment, a test payment never
      // buys a real domain.
      const keyMode = stripeKeyMode();
      const mismatch =
        keyMode && paymentModeProblem(keyMode === "live", registrar.sandbox);
      if (mismatch)
        throw fail(
          409,
          "WEB_ADDRESS_DISABLED",
          "Buying a domain is not available yet.",
        );
      const fresh = await quote(registrar, domain, db);
      if (
        fresh.firstYearPriceMinor !== b.firstYearPriceMinor ||
        fresh.renewalPriceMinor !== b.renewalPriceMinor
      )
        throw Object.assign(
          fail(
            409,
            "PRICE_CHANGED",
            "The price changed. Review the new first-year and renewal price before paying.",
          ),
          {
            firstYearPriceMinor: fresh.firstYearPriceMinor,
            renewalPriceMinor: fresh.renewalPriceMinor,
          },
        );
      const orderId = randomUUID();
      const at = Date.now();
      const { tenant } = await slugState(db, a.tenantId);
      const checkout = {
        origin: origin(req),
        // Stripe needs at least 30 minutes; a replay must send identical parameters.
        expiresAt: Math.floor(at / 1000) + 35 * 60,
        email: a.email ?? null,
        // Both prices again on Stripe's page, above the pay button (owner
        // decision, 28 September 2026); stored so a replay sends the same.
        note: checkoutNote(fresh.firstYearPriceMinor, fresh.renewalPriceMinor),
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
          "INSERT INTO domain_orders(id,tenant_id,hostname,status,token,evidence,mode,registrar,quote,progress,next_attempt_at,serve_mode) VALUES($1,$2,$3,'checkout',$4,$5,'automatic',$6,$7,$8,now()+interval '2 hours',$9) ON CONFLICT DO NOTHING RETURNING *",
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
            serveMode,
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
          currency: fresh.currency,
          firstYearPriceMinor: fresh.firstYearPriceMinor,
          renewalPriceMinor: fresh.renewalPriceMinor,
        });
        return row;
      });
      return createCheckout(client, created);
    },
  );
  /**
   * What the Checkout subscription charges: the yearly renewal price as the
   * recurring USD price, and the first year's difference on the first
   * invoice only, so Checkout, the invoice and the receipt show both prices:
   * a one-time line when the first year costs more, a once-only coupon when
   * it costs less (the usual case: USD 19.99 now, then USD 24.99 a year).
   * Orders quoted in AED before 28 September 2026 keep their one yearly AED
   * price; a return to an open checkout sends identical parameters.
   */
  async function checkoutPrices(
    client: WebAddressStripe,
    order: Record<string, any>,
    text: ReturnType<typeof webAddressStripeText>,
    metadata: Record<string, string>,
  ) {
    const prices = orderPrices(order);
    const currency = prices.currency.toLowerCase();
    const line_items: any[] = [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: prices.renewalMinor,
          recurring: { interval: "year" },
          product_data: { name: text.productName },
        },
      },
    ];
    const difference = prices.firstYearMinor - prices.renewalMinor;
    if (difference > 0)
      line_items.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: difference,
          product_data: { name: text.firstYearName },
        },
      });
    if (difference >= 0) return { line_items };
    if (!client.coupons)
      throw fail(
        502,
        "CHECKOUT_UNRESOLVED",
        "The payment page could not be prepared. Try again from Web address.",
      );
    const coupon = await client.coupons.create(
      {
        amount_off: -difference,
        currency,
        duration: "once",
        max_redemptions: 1,
        name: text.firstYearName,
        metadata,
      },
      { idempotencyKey: "web-address-first-year:" + order.id },
    );
    if (!coupon?.id || Number(coupon.amount_off) !== -difference)
      throw fail(
        502,
        "CHECKOUT_UNRESOLVED",
        "The payment page could not be prepared. Try again from Web address.",
      );
    return { line_items, discounts: [{ coupon: coupon.id as string }] };
  }
  async function createCheckout(
    client: WebAddressStripe,
    order: Record<string, any>,
  ) {
    const c = order.evidence.checkout;
    // Neutral wording on Checkout, invoices and receipts; no statement
    // descriptor is set, so the platform account's own descriptor applies.
    const text = webAddressStripeText(order.hostname);
    const metadata = {
      purpose: "web_address",
      tenant_id: order.tenant_id,
      web_address_order_id: order.id,
    };
    const priced = await checkoutPrices(client, order, text, metadata);
    const session = await client.checkout.sessions.create(
      {
        mode: "subscription",
        client_reference_id: order.id,
        ...(c.customer
          ? { customer: c.customer }
          : c.email
            ? { customer_email: c.email }
            : {}),
        ...priced,
        // Orders created before the note was added replay without it.
        ...(typeof c.note === "string" && c.note
          ? { custom_text: { submit: { message: c.note } } }
          : {}),
        expires_at: c.expiresAt,
        metadata,
        subscription_data: {
          metadata,
          description: text.description,
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
    // The session's own mode is the final word on which money this is.
    if (
      paymentModeProblem(
        typeof session.livemode === "boolean" ? session.livemode : null,
        order.quote?.registrarSandbox === true,
      )
    ) {
      await client.checkout.sessions.expire(session.id).catch(() => {});
      await db.tenant(scope, async (tx) => {
        await tx.query(
          "UPDATE domain_orders SET status='cancelled',next_attempt_at=NULL,checkout_session_id=coalesce(checkout_session_id,$2),version=version+1,updated_at=now() WHERE id=$1 AND status='checkout'",
          [order.id, session.id],
        );
        await event(tx, scope, "web_address.mode_mismatch", order.id);
      });
      throw fail(
        409,
        "WEB_ADDRESS_DISABLED",
        "Buying a domain is not available yet.",
      );
    }
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
        "SELECT * FROM domain_orders WHERE id=$1 AND mode='automatic' AND status IN ('owned','zone','delegating','dns','active')",
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
        "The yearly subscription has ended, so renewal cannot be turned back on here. Contact platform support to keep this domain.",
      );
    await stripe().subscriptions.update(
      order.stripe_subscription_id,
      { cancel_at_period_end: !b.enabled },
      {
        idempotencyKey: `web-address-renewal:${id}:${b.enabled}:${order.version}`,
      },
    );
    // A registrar that renews by itself (its API cannot switch that off)
    // would renew the domain at the platform's cost: operators turn its
    // auto-renewal off in the registrar's panel.
    // The registrar this domain was bought through, not the one chosen for
    // new purchases.
    let autoRenews = false;
    try {
      autoRenews = !canRenew(
        deps.registrar && deps.registrar.id === order.registrar
          ? deps.registrar
          : registrarFor(String(order.registrar ?? "")),
      );
    } catch {
      autoRenews = false;
    }
    return db.tenant(a, async (tx) => {
      const [row] = await tx.query(
        // The switch time lets an older Stripe event never undo this choice.
        "UPDATE domain_orders SET renewal_enabled=$2,notices='{}'::jsonb,evidence=evidence||jsonb_build_object('renewalSwitchedAt',$3::bigint),attention=CASE WHEN $4::text IS NOT NULL THEN $4 ELSE attention END,next_attempt_at=CASE WHEN status='active' THEN now() ELSE next_attempt_at END,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [
          id,
          b.enabled,
          Math.floor(Date.now() / 1000),
          autoRenews && !b.enabled
            ? "The trainer turned renewal off. The registrar renews its domains by itself about 60 days before expiry: turn auto-renewal off for this domain in the registrar's panel."
            : null,
        ],
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
      testEnvironment: registrarSandboxSetting(config),
      purchasesEnabled: purchasesEnabled(),
      modeProblem: configuredModeProblem(),
      purchaseProblem: registrarPurchaseProblem(),
      dnsProvider: dnsHostingSettings().provider,
      orders,
      attention: orders.filter(
        (o) => o.attention || o.needsReconciliation || o.costAlert,
      ).length,
    };
  });
  // Registrar prices per ending as trainers are charged them, with the
  // platform's margin before Stripe fees (operators only), so an ending that
  // is hidden, not sold or thin on margin is visible.
  app.get("/api/v1/admin/web-addresses/prices", async (req) => {
    admin(req);
    return operatorPrices(db, deps);
  });
  // Asks the registrar again for every ending that can be bought, within the
  // interactive call budget; a refused request changes nothing stored.
  app.post(
    "/api/v1/admin/web-addresses/prices/refresh",
    { config: { rateLimit: { max: 6, timeWindow: "10 minutes" } } },
    async (req) => {
      const operator = admin(req);
      const b = z
        .object({ reason: z.string().trim().min(10).max(500) })
        .strict()
        .parse(req.body);
      const settings = pricing();
      const registrar = operatorRegistrar(deps);
      const refreshed = await refreshPricesNow(
        db,
        registrar,
        settings.allowed,
        () => tryTakeRegistrarCall(),
      );
      await db.system((tx) =>
        tx.query(
          "INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data) VALUES($1,$2,$3,$4,$5)",
          [
            randomUUID(),
            operator.userId,
            "web_address.prices_refreshed",
            null,
            JSON.stringify({ reason: b.reason, refreshed }),
          ],
        ),
      );
      return { refreshed, ...(await operatorPrices(db, deps)) };
    },
  );
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
  // Never while another run holds the order (its lease is left alone), and
  // an attempt that may still be running is left to settle by that step.
  app.post("/api/v1/admin/web-addresses/:id/reconcile", async (req) => {
    const { order, scope, reason } = await operatorOrder(req);
    await db.tenant(scope, (tx) =>
      event(tx, scope, "web_address.operator_reconcile", order.id, {
        reason,
      }),
    );
    const ran = await processWebAddressOrder(
      db,
      order.tenant_id,
      order.id,
      deps,
      { force: true },
    );
    return {
      ...(await operatorOrders(db, identity(req), order.id))[0],
      ran,
      ...(ran
        ? {}
        : {
            message:
              "The worker is on this order right now; look again in a minute.",
          }),
    };
  });
  // Clears the attention flag and starts the current step again. A purchase
  // held because the registrar's cost rose past the trainer's price is then
  // bought at that cost (at most): the operator accepts the difference.
  app.post("/api/v1/admin/web-addresses/:id/retry", async (req) => {
    const { order, scope, reason } = await operatorOrder(req);
    if (["cancelled", "failed"].includes(order.status))
      throw fail(409, "ORDER_STATE", "This order is closed.");
    await db.tenant(scope, async (tx) => {
      await tx.query(
        // The lease stays: a running step finishes first. A failed renewal
        // is checked against the registrar's expiry before any new request.
        "UPDATE domain_orders SET attention=NULL,attempts=0,evidence=(evidence||'{\"purchaseAttempts\":0,\"renewalAttempts\":0,\"alignFailures\":0,\"checkoutChecks\":0,\"cancelAttempts\":0}'::jsonb||CASE WHEN evidence->'priceHold' IS NOT NULL THEN jsonb_build_object('acceptedCost',evidence->'priceHold') ELSE '{}'::jsonb END)-'{priceHold,costAlert}'::text[],next_attempt_at=now(),renewal_status=CASE WHEN renewal_status='failed' THEN 'paid' ELSE renewal_status END,version=version+1,updated_at=now() WHERE id=$1",
        [order.id],
      );
      // The accepted cost stays on the order (evidence.acceptedCost):
      // workspace events are listed to the trainer.
      await event(tx, scope, "web_address.operator_retry", order.id, {
        reason,
      });
    });
    return (await operatorOrders(db, identity(req), order.id))[0];
  });
  // Sets the domain's DNS up again at the chosen DNS host ("digitalocean",
  // "registrar", or "settings" for the current DNS hosting setting). The
  // worker then converges the zone or host records and the nameservers,
  // each recorded under its own intent; nothing is deleted here.
  app.post("/api/v1/admin/web-addresses/:id/dns", async (req) => {
    const operator = admin(req);
    const b = z
      .object({
        reason: z.string().trim().min(10).max(500),
        provider: z.enum(["digitalocean", "registrar", "settings"]),
      })
      .strict()
      .parse(req.body);
    const [order] = await operatorOrders(
      db,
      operator,
      uuid.parse((req.params as any).id),
    );
    if (!order) throw fail(404, "NOT_FOUND", "Order not found.");
    if (!["owned", "zone", "delegating", "dns", "active"].includes(order.status))
      throw fail(
        409,
        "ORDER_STATE",
        "DNS can be set up again only for a registered domain that has not lapsed.",
      );
    // A registrar whose own DNS cannot be set up through its API would leave
    // the domain unserved: only the DNS host is offered for it.
    const wanted =
      b.provider === "settings" ? dnsHostingSettings().provider : b.provider;
    if (wanted === "registrar" && !canUseRegistrarDns(String(order.registrar)))
      throw fail(
        409,
        "REGISTRAR_DNS_UNSUPPORTED",
        "This domain's registrar cannot serve it from its own DNS through its API; use DigitalOcean DNS.",
      );
    const scope = elevated("platform-operator", {
      tenantId: order.tenant_id,
      userId: operator.userId,
      role: "owner",
    });
    await db.tenant(scope, async (tx) => {
      const [row] = await tx.query(
        "UPDATE domain_orders SET status='owned',dns_provider=$2,attention=NULL,attempts=0,next_attempt_at=now(),evidence=evidence||'{\"delegationStartedAt\":null,\"delegationResets\":0}'::jsonb,progress=CASE WHEN jsonb_array_length(progress)>=60 THEN progress ELSE progress||jsonb_build_array(jsonb_build_object('step','dns_again','at',now(),'note',$3::text)) END,version=version+1,updated_at=now() WHERE id=$1 AND status IN ('owned','zone','delegating','dns','active') AND (lease_until IS NULL OR lease_until<now()) RETURNING id",
        [
          order.id,
          b.provider === "settings" ? null : b.provider,
          b.provider,
        ],
      );
      if (!row)
        throw fail(
          409,
          "ORDER_STATE",
          "This order changed or the worker is on it; try again in a minute.",
        );
      await event(tx, scope, "web_address.operator_dns", order.id, {
        reason: b.reason,
        provider: b.provider,
      });
    });
    return (await operatorOrders(db, identity(req), order.id))[0];
  });
  // Records a registration or renewal made at the registrar by hand (the
  // registrar's getInfo is the evidence; nothing is bought or renewed).
  app.post("/api/v1/admin/web-addresses/:id/record", async (req) => {
    const { order, scope, reason } = await operatorOrder(req);
    const result = await recordRegistrarState(
      db,
      order.tenant_id,
      order.id,
      deps,
    );
    if (!result.recorded) throw fail(409, "NOT_RECORDED", result.reason);
    await db.tenant(scope, (tx) =>
      event(tx, scope, "web_address.operator_recorded", order.id, {
        reason,
        recorded: result.recorded,
        expiresAt: result.expiresAt,
      }),
    );
    return (await operatorOrders(db, identity(req), order.id))[0];
  });
  // Ends the trainer's yearly subscription (no further charges); the domain
  // stays until its expiry and then lapses to the subdomain.
  app.post(
    "/api/v1/admin/web-addresses/:id/cancel-subscription",
    async (req) => {
      const { order, scope, reason } = await operatorOrder(req);
      if (!order.stripe_subscription_id || order.billing_status === "canceled")
        throw fail(409, "ORDER_STATE", "There is no running subscription.");
      await db.tenant(scope, (tx) =>
        event(tx, scope, "web_address.operator_cancel_subscription", order.id, {
          reason,
        }),
      );
      if (!(await cancelSubscription(db, order.tenant_id, order, deps)))
        throw fail(
          502,
          "STRIPE_UNAVAILABLE",
          "Stripe did not confirm the cancellation; it is retried automatically.",
        );
      return (await operatorOrders(db, identity(req), order.id))[0];
    },
  );
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
