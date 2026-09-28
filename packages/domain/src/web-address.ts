/**
 * Web address rules shared by the API, the worker and the tests
 * (docs/features/web-addresses.md): workspace slugs as subdomain labels,
 * reserved names, the platform root domain and yearly domain prices.
 */

/**
 * Names that never become a trainer's address: platform, mail, DNS, payment
 * and operations host names, and words that could impersonate the platform.
 * Under a wildcard A record every name resolves to the platform, so the
 * names clients probe on their own are reserved too: mail and calendar
 * autodiscovery (autodiscover, autoconfig, lyncdiscover, sip, msoid,
 * enterprise enrollment), proxy discovery (wpad, isatap), MTA-STS, control
 * panels and role mailboxes.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "about",
  "abuse",
  "account",
  "accounts",
  "acme",
  "admin",
  "administrator",
  "alpha",
  "api",
  "app",
  "apps",
  "assets",
  "auth",
  "autoconfig",
  "autodiscover",
  "backup",
  "backups",
  "beta",
  "billing",
  "blog",
  "cdn",
  "cert",
  "certs",
  "checkout",
  "cloud",
  "coach",
  "coaches",
  "cpanel",
  "crl",
  "dashboard",
  "database",
  "demo",
  "dev",
  "dkim",
  "dmarc",
  "dns",
  "dns1",
  "dns2",
  "dns3",
  "dns4",
  "docs",
  "domain",
  "domains",
  "download",
  "downloads",
  "edge",
  "email",
  "enterpriseenrollment",
  "enterpriseregistration",
  "exchange",
  "files",
  "ftp",
  "gateway",
  "git",
  "gymmembership",
  "help",
  "hosting",
  "hostmaster",
  "identity",
  "idp",
  "imap",
  "imap4",
  "internal",
  "isatap",
  "join",
  "legal",
  "localhost",
  "login",
  "lyncdiscover",
  "mail",
  "mail1",
  "mail2",
  "media",
  "member",
  "members",
  "metrics",
  "monitor",
  "monitoring",
  "msoid",
  "mta-sts",
  "mx",
  "mx1",
  "mx2",
  "no-reply",
  "noreply",
  "ns",
  "ns0",
  "ns1",
  "ns2",
  "ns3",
  "ns4",
  "ns5",
  "ns6",
  "ns7",
  "ns8",
  "ns9",
  "oauth",
  "ocsp",
  "openid",
  "operator",
  "operators",
  "origin",
  "owa",
  "pay",
  "payment",
  "payments",
  "pki",
  "platform",
  "pop",
  "pop3",
  "pop3s",
  "portal",
  "postmaster",
  "preview",
  "privacy",
  "prod",
  "production",
  "proxy",
  "relay",
  "remote",
  "root",
  "saml",
  "sandbox",
  "secure",
  "security",
  "server",
  "sftp",
  "signin",
  "signup",
  "sip",
  "smtp",
  "smtp1",
  "smtp2",
  "smtps",
  "spf",
  "ssh",
  "ssl",
  "sso",
  "stage",
  "staging",
  "static",
  "status",
  "stripe",
  "superadmin",
  "support",
  "system",
  "terms",
  "test",
  "tls",
  "trainer",
  "trainers",
  "trainsyou",
  "upload",
  "uploads",
  "vpn",
  "webdisk",
  "webhook",
  "webhooks",
  "webmail",
  "webmaster",
  "whm",
  "wpad",
  "www",
  "www1",
  "www2",
  "www3",
  "wwww",
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

// ---- Domain names ------------------------------------------------------------

/** A domain ending: one label, or two (co.uk). */
const TLD = /^[a-z]{2,63}(?:\.[a-z]{2,63})?$/;
/**
 * Endings suggested for a trainer's name, in this order (owner decision,
 * 28 September 2026). Operators change the list in Super admin
 * (WEB_ADDRESS_TLDS). Only these endings, and the other endings an operator
 * allows (WEB_ADDRESS_EXTRA_TLDS), can be bought.
 */
export const DEFAULT_SUGGESTED_TLDS: readonly string[] = [
  "com",
  "fit",
  "fitness",
  "coach",
  "training",
  "ae",
  "club",
  "pro",
  "app",
  "me",
];
/** At most this many suggested endings (with the typed name: one registrar check). */
export const MAX_SUGGESTED_TLDS = 20;
/** At most this many other endings an operator allows when typed. */
export const MAX_EXTRA_TLDS = 20;
/**
 * A registrable label: letters, digits and hyphens, not at either end, and
 * no "--" in the third and fourth place (reserved for encoded international
 * names such as xn--). Other double hyphens are valid DNS labels.
 */
export function registrableLabel(label: string) {
  return LABEL.test(label) && label.slice(2, 4) !== "--";
}

/**
 * A second-level name (the automatic flow never registers deeper names) as
 * [label, ending], or null. With `tlds`, only under one of those endings.
 */
export function splitRegistrableDomain(
  domain: string,
  tlds?: readonly string[],
): [string, string] | null {
  const name = domain.toLowerCase();
  const dot = name.indexOf(".");
  if (dot < 1) return null;
  const label = name.slice(0, dot),
    tld = name.slice(dot + 1);
  if (!registrableLabel(label) || !TLD.test(tld)) return null;
  if (tlds && !tlds.includes(tld)) return null;
  return [label, tld];
}
function tldList(value: string | undefined | null, max: number) {
  const list = (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^\./, ""))
    .filter((item) => TLD.test(item));
  return [...new Set(list)].slice(0, max);
}
/** Suggested endings from WEB_ADDRESS_TLDS ("com,fit,fitness"), in order. */
export function suggestedTlds(value: string | undefined | null) {
  return tldList(
    value?.trim() ? value : DEFAULT_SUGGESTED_TLDS.join(","),
    MAX_SUGGESTED_TLDS,
  );
}
/**
 * Every ending a trainer can buy: the suggested ones, then the other endings
 * an operator allows when typed (WEB_ADDRESS_EXTRA_TLDS, empty by default).
 * Anything else is "not offered" without a registrar call, so a typed
 * ending the platform does not want to hold (an adult or protest ending, or
 * one with local-presence rules) is never priced or bought.
 */
export function purchasableTlds(
  suggested: readonly string[],
  extra: string | undefined | null,
) {
  return [...new Set([...suggested, ...tldList(extra, MAX_EXTRA_TLDS)])];
}

/**
 * The platform's own brand names, protected on every ending (a trainer
 * site on trainsyou.app would look official). Operators add more in Super
 * admin (WEB_ADDRESS_PROTECTED_LABELS); the platform root's own label is
 * always protected.
 */
export const DEFAULT_PROTECTED_LABELS: readonly string[] = ["trainsyou"];
/** Protected labels from the setting, the defaults and the platform root. */
export function protectedLabels(
  value: string | undefined | null,
  root: string | null,
) {
  const listed = (value ?? "")
    .split(",")
    .map((item) =>
      item
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ""),
    )
    .filter((item) => item.length >= 2);
  // The root's registrable label: "trainsyou" for trainsyou.com and for
  // app.trainsyou.com alike (never the "app" of a deeper root).
  const labels = root ? root.toLowerCase().split(".").filter(Boolean) : [];
  const own = (labels.length >= 2 ? labels[labels.length - 2] : "").replace(
    /[^a-z0-9]/g,
    "",
  );
  return [
    ...new Set([...DEFAULT_PROTECTED_LABELS, ...listed, ...(own ? [own] : [])]),
  ];
}
/**
 * Whether a label is (or, for a protected name of five or more letters,
 * contains) a protected brand name, hyphens ignored: trainsyou,
 * trains-you, trainsyou-login and mytrainsyou are all refused.
 */
export function isProtectedLabel(
  label: string,
  protectedList: readonly string[],
) {
  const bare = label.toLowerCase().replace(/-/g, "");
  return protectedList.some((name) =>
    name.length >= 5 ? bare.includes(name) : bare === name,
  );
}

/**
 * What a trainer typed, cleaned up the same way with or without an ending:
 * lower case, without a scheme, a leading @ (an Instagram handle), www., a
 * path, a :port or a trailing dot; spaces and underscores become hyphens.
 */
export function cleanDomainQuery(query: string) {
  return query
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^@+/, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d*$/, "")
    .replace(/\.$/, "")
    .trim()
    .replace(/[\s_]+/g, "-");
}
export type DomainSearchPlan = {
  /** The name part the trainer typed ("athena"). */
  label: string;
  /**
   * The name the trainer asked about: the full domain they typed
   * ("athena.io"), or their name under the first suggested ending.
   */
  requested: string;
  /**
   * Every name to check in one registrar call: the requested one first (only
   * when its ending can be bought), then the name under each suggested
   * ending in order, without repeats.
   */
  names: string[];
};
/**
 * What one trainer search checks: "athena" → athena.com (asked about), then
 * athena.fit, athena.fitness …; "athena.fit" → athena.fit first, then
 * athena.com …; "athena.io" → athena.io only when an operator allows .io
 * (otherwise it is answered as not offered, with the suggestions). Name
 * variations (athenafit.com) are not suggested (owner decision,
 * 28 September 2026). Null when the text is not a name or a second-level
 * domain: a deeper name ("shop.athena.com") is refused unless its last two
 * labels are an allowed two-part ending (co.uk).
 */
export function domainSearchPlan(
  query: string,
  suggested: readonly string[],
  allowed: readonly string[] = suggested,
): DomainSearchPlan | null {
  const text = cleanDomainQuery(query);
  if (!text || text.length > 80) return null;
  let label: string, requested: string;
  if (text.includes(".")) {
    const dot = text.indexOf("."),
      ending = text.slice(dot + 1);
    // One-label endings are taken as typed; a two-label one only when it
    // is an allowed ending (not a subdomain such as shop.athena.com).
    if (ending.includes(".") && !allowed.includes(ending)) return null;
    const split = splitRegistrableDomain(text);
    if (!split) return null;
    [label] = split;
    requested = text;
  } else {
    label = text;
    if (!registrableLabel(label) || !suggested.length) return null;
    requested = label + "." + suggested[0];
  }
  const requestedAllowed = allowed.includes(requested.slice(label.length + 1));
  const names = [
    ...new Set([
      ...(requestedAllowed ? [requested] : []),
      ...suggested.map((tld) => label + "." + tld),
    ]),
  ];
  return { label, requested, names };
}

// ---- Prices ----------------------------------------------------------------------

/**
 * How a trainer's price follows from the registrar's USD cost (owner decision,
 * 28 September 2026): the cost rounded up to the next multiple of the step,
 * plus the ending, separately for the first year and for the renewal. A name
 * whose first-year or renewal price is over the cap is not offered. All
 * amounts are whole US cents; operators change them in Super admin.
 */
export type PriceRule = {
  /** 500: round the cost up to the next multiple of USD 5. */
  stepCents: number;
  /** 499: then add USD 4.99. */
  endingCents: number;
  /** 10000: hide names over USD 100 for the first year or a renewal. */
  capCents: number;
};
export const DEFAULT_PRICE_RULE: Readonly<PriceRule> = Object.freeze({
  stepCents: 500,
  endingCents: 499,
  capCents: 10000,
});
const USD_TEXT = /^(\d{1,9})(?:\.(\d+))?$/;
/**
 * A registrar's USD cost ("11.48", "16.0600", 11.48) in whole cents, rounded
 * up: a cost never rounds down. Throws on anything that is not a plain
 * non-negative decimal amount.
 */
export function usdCents(value: string | number) {
  const text = typeof value === "number" ? String(value) : value.trim();
  const match = USD_TEXT.exec(text);
  if (!match) throw new RangeError("Invalid USD amount");
  const fraction = match[2] ?? "";
  const cents =
    Number(match[1]) * 100 + Number(fraction.slice(0, 2).padEnd(2, "0"));
  return /[1-9]/.test(fraction.slice(2)) ? cents + 1 : cents;
}
/**
 * An operator's USD amount ("5", "4.99") in cents: at most two decimals, never
 * rounded. Throws otherwise.
 */
export function exactUsdCents(value: string | number) {
  const text = typeof value === "number" ? String(value) : value.trim();
  const match = USD_TEXT.exec(text);
  if (!match || (match[2] ?? "").length > 2)
    throw new RangeError("Use a USD amount with at most two decimals");
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
function assertRule(rule: Pick<PriceRule, "stepCents" | "endingCents">) {
  if (
    !Number.isSafeInteger(rule.stepCents) ||
    rule.stepCents < 1 ||
    rule.stepCents > 100000 ||
    !Number.isSafeInteger(rule.endingCents) ||
    rule.endingCents < 0 ||
    rule.endingCents > 100000
  )
    throw new RangeError("Invalid price rule");
}
/**
 * The trainer's price in cents for one registrar cost in cents:
 * ceil(cost / step) × step + ending, in integers only. 1148 → 1999,
 * 1500 → 1999, 1501 → 2499 with the owner's rule. A cost that is not a
 * positive whole number of cents is refused (never priced at the ending).
 */
export function markupPriceCents(
  costCents: number,
  rule: Pick<PriceRule, "stepCents" | "endingCents"> = DEFAULT_PRICE_RULE,
) {
  if (!Number.isSafeInteger(costCents) || costCents <= 0)
    throw new RangeError("A registrar cost must be a positive number of cents");
  assertRule(rule);
  const remainder = costCents % rule.stepCents;
  const roundedUp = remainder
    ? costCents + rule.stepCents - remainder
    : costCents;
  return roundedUp + rule.endingCents;
}
/** Whether a price may be offered: not over the cap. */
export function withinPriceCap(
  priceCents: number,
  rule: Pick<PriceRule, "capCents"> = DEFAULT_PRICE_RULE,
) {
  return Number.isSafeInteger(priceCents) && priceCents <= rule.capCents;
}
/**
 * The first-year and renewal price a trainer sees and pays for one name, from
 * the registrar's one-year registration and renewal cost (premium costs for
 * a premium name), and whether both are within the cap.
 */
export function trainerDomainPrices(
  cost: { registerUsd: string | number; renewUsd: string | number },
  rule: PriceRule = DEFAULT_PRICE_RULE,
) {
  const firstYearCents = markupPriceCents(usdCents(cost.registerUsd), rule);
  const renewalCents = markupPriceCents(usdCents(cost.renewUsd), rule);
  return {
    firstYearCents,
    renewalCents,
    offered:
      withinPriceCap(firstYearCents, rule) &&
      withinPriceCap(renewalCents, rule),
  };
}
/**
 * The price rule from Super admin settings (USD text; blank means the owner's
 * default). Throws on an invalid value.
 */
export function priceRuleFromSettings(settings: {
  step?: string | null;
  ending?: string | null;
  cap?: string | null;
}): PriceRule {
  const read = (value: string | null | undefined, fallback: number) =>
    value?.trim() ? exactUsdCents(value) : fallback;
  const rule = {
    stepCents: read(settings.step, DEFAULT_PRICE_RULE.stepCents),
    endingCents: read(settings.ending, DEFAULT_PRICE_RULE.endingCents),
    capCents: read(settings.cap, DEFAULT_PRICE_RULE.capCents),
  };
  assertRule(rule);
  if (rule.capCents < 1 || rule.capCents > 10000000)
    throw new RangeError("Invalid price cap");
  return rule;
}

// ---- Orders quoted in AED (before 28 September 2026) ---------------------------

/** Decimal text ("20.3600", "3.6725") in ten-thousandths, rejecting anything else. */
export function decimalTenThousandths(value: string | number) {
  const text = String(value).trim();
  const match = /^(\d{1,9})(?:\.(\d{1,4})\d*)?$/.exec(text);
  if (!match) throw new Error("Invalid decimal amount");
  return Number(match[1]) * 10000 + Number((match[2] ?? "").padEnd(4, "0"));
}
/**
 * USD at a fixed rate to AED fils, rounded up (costs never round down). Only
 * for orders quoted in AED before prices moved to USD: their quote keeps the
 * rate they were priced at.
 */
export function usdToAedMinor(usd: string | number, usdToAed: string | number) {
  const product =
    BigInt(decimalTenThousandths(usd)) *
    BigInt(decimalTenThousandths(usdToAed));
  // Units of 1e-8 AED; fils are 1e-2 AED.
  return Number((product + 999999n) / 1000000n);
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
