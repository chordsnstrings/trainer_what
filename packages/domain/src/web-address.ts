/**
 * Web address rules shared by the API, the worker and the tests
 * (docs/features/web-addresses.md): workspace slugs as subdomain labels,
 * reserved names, the platform root domain and yearly domain prices.
 */

/**
 * Names that never become a trainer's address: platform, mail, DNS, payment
 * and operations host names, and words that could impersonate the platform.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "about",
  "account",
  "accounts",
  "admin",
  "administrator",
  "api",
  "app",
  "apps",
  "assets",
  "auth",
  "billing",
  "blog",
  "cdn",
  "checkout",
  "coach",
  "coaches",
  "dashboard",
  "demo",
  "dev",
  "dns",
  "docs",
  "domain",
  "domains",
  "email",
  "files",
  "ftp",
  "gymmembership",
  "help",
  "imap",
  "internal",
  "join",
  "legal",
  "login",
  "mail",
  "media",
  "mx",
  "ns",
  "ns1",
  "ns2",
  "ns3",
  "ns4",
  "operator",
  "operators",
  "pay",
  "payment",
  "payments",
  "platform",
  "pop",
  "pop3",
  "portal",
  "postmaster",
  "privacy",
  "root",
  "secure",
  "security",
  "signin",
  "signup",
  "smtp",
  "staging",
  "static",
  "status",
  "stripe",
  "superadmin",
  "support",
  "system",
  "terms",
  "test",
  "trainer",
  "trainers",
  "trainsyou",
  "webhook",
  "webhooks",
  "webmail",
  "www",
]);

/** The signup slug form: a letter first, 3 to 40 characters. */
export const SLUG_PATTERN = /^[a-z][a-z0-9-]{2,39}$/;

export type SlugProblem = "format" | "hyphen" | "reserved";
/**
 * Why a new slug is refused, or null. New slugs are also valid DNS labels: no
 * trailing hyphen and no double hyphen (which covers punycode "xn--").
 */
export function slugProblem(slug: string): SlugProblem | null {
  if (!SLUG_PATTERN.test(slug)) return "format";
  if (slug.endsWith("-") || slug.includes("--")) return "hyphen";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}
export const SLUG_PROBLEM_MESSAGES: Record<SlugProblem, string> = {
  format:
    "Use 3 to 40 lower-case letters, digits or hyphens, starting with a letter.",
  hyphen:
    "An address cannot end with a hyphen or contain two hyphens in a row.",
  reserved: "This address is reserved. Please choose another.",
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** True when an existing slug can be a subdomain label. */
export function subdomainEligible(slug: string) {
  return LABEL.test(slug) && !slug.includes("--");
}

/**
 * The configured platform root domain (PLATFORM_ROOT_DOMAIN), or null when it
 * is unset or not a plain DNS name; null turns automatic subdomains off.
 * An sslip.io name (for example gymmembership.203.0.113.7.sslip.io) is a
 * DNS name and works as a root: every name under it resolves to that address.
 */
export function platformRootDomain(value: string | undefined | null) {
  const root = (value ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!root || root.length > 200 || IPV4.test(root) || root.includes(":"))
    return null;
  const labels = root.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label)))
    return null;
  if (!/[a-z]/.test(labels.at(-1)!)) return null;
  return root;
}

/** The workspace label of `<label>.<root>`, or null for any other host. */
export function subdomainLabel(host: string, root: string | null) {
  if (!root) return null;
  const name = host.toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  if (!name.endsWith("." + root)) return null;
  const label = name.slice(0, -(root.length + 1));
  return LABEL.test(label) ? label : null;
}
export const subdomainHost = (slug: string, root: string) => `${slug}.${root}`;

/** How long a previous slug keeps redirecting (and stays reserved for its workspace). */
export const SLUG_REDIRECT_DAYS = 90;
/** Slug changes a workspace may make in any 365 days. */
export const SLUG_CHANGES_PER_YEAR = 3;

// ---- Domain names and prices ------------------------------------------------

/**
 * Second-level names under an allowed ending only (the automatic flow never
 * registers deeper names). Returns [label, tld] or null.
 */
export function splitRegistrableDomain(
  domain: string,
  tlds: readonly string[],
): [string, string] | null {
  const name = domain.toLowerCase();
  const dot = name.indexOf(".");
  if (dot < 1) return null;
  const label = name.slice(0, dot),
    tld = name.slice(dot + 1);
  if (!LABEL.test(label) || label.includes("--") || !tlds.includes(tld))
    return null;
  return [label, tld];
}
/** Allowed endings from WEB_ADDRESS_TLDS ("com,net,org"). */
export function allowedTlds(value: string | undefined | null) {
  const list = (value || "com,net,org,co")
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^\./, ""))
    .filter((item) => /^[a-z]{2,63}(?:\.[a-z]{2,63})?$/.test(item));
  return [...new Set(list)].slice(0, 12);
}
/**
 * Candidate names for a trainer's search: "layla" → layla.com, layla.net …;
 * "layla.fit" → layla.fit when .fit is allowed. At most `limit` names.
 */
export function searchCandidates(
  query: string,
  tlds: readonly string[],
  limit = 6,
) {
  const text = query
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!text || text.length > 80) return [];
  if (text.includes("."))
    return splitRegistrableDomain(text, tlds) ? [text] : [];
  const label = text.replace(/[\s_]+/g, "-");
  if (!LABEL.test(label) || label.includes("--")) return [];
  return tlds.slice(0, limit).map((tld) => label + "." + tld);
}

/** Decimal text ("20.3600", "3.6725") in ten-thousandths, rejecting anything else. */
export function decimalTenThousandths(value: string | number) {
  const text = String(value).trim();
  const match = /^(\d{1,9})(?:\.(\d{1,4})\d*)?$/.exec(text);
  if (!match) throw new Error("Invalid decimal amount");
  return Number(match[1]) * 10000 + Number((match[2] ?? "").padEnd(4, "0"));
}
/** USD at a fixed rate to AED fils, rounded up (costs never round down). */
export function usdToAedMinor(usd: string | number, usdToAed: string | number) {
  const product =
    BigInt(decimalTenThousandths(usd)) *
    BigInt(decimalTenThousandths(usdToAed));
  // Units of 1e-8 AED; fils are 1e-2 AED.
  return Number((product + 999999n) / 1000000n);
}
/**
 * The yearly price a trainer pays: the higher of the registrar's registration
 * and renewal price (so the price stays the same every year), converted at the
 * configured rate and rounded up to whole dirhams, plus the yearly margin.
 */
export function yearlyPriceMinor(input: {
  registerUsd: string | number;
  renewUsd: string | number;
  usdToAed: string | number;
  marginAed: string | number;
}) {
  const base = Math.max(
    decimalTenThousandths(input.registerUsd),
    decimalTenThousandths(input.renewUsd),
  );
  const product = BigInt(base) * BigInt(decimalTenThousandths(input.usdToAed));
  // Units of 1e-8 AED, rounded up to whole dirhams (1e8), shown in fils.
  const whole = Number((product + 99999999n) / 100000000n) * 100;
  const margin = Math.round(decimalTenThousandths(input.marginAed) / 100);
  return whole + margin;
}

/** Trainer-visible steps of an automatic order, in order. */
export const WEB_ADDRESS_STEPS = [
  "paid",
  "registered",
  "dns",
  "certificate",
  "live",
] as const;
export type WebAddressStep = (typeof WEB_ADDRESS_STEPS)[number];
