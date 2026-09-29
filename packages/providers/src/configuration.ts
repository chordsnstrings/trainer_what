import { AsyncLocalStorage } from "node:async_hooks";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import {
  isLoopbackHostname,
  isSandboxLoopbackAddress,
  sandboxAllowsEndpoint,
  sandboxOverride,
  sandboxResolver,
} from "./sandbox.ts";

export type RuntimeConfig = Record<string, string | undefined>;
const runtime = new AsyncLocalStorage<RuntimeConfig>();
export function runtimeConfig(): RuntimeConfig {
  return { ...process.env, ...runtime.getStore() };
}
export function withRuntimeConfig<T>(
  overrides: RuntimeConfig,
  callback: () => T,
): T {
  return runtime.run({ ...runtime.getStore(), ...overrides }, callback);
}
/**
 * Security controls (MFA step-up, legal and import approvals, Secure cookies,
 * email verification, second reviewers) relax only for a process explicitly
 * declared as local development or test, or the isolated Node test runner. An
 * unset or unrecognised NODE_ENV (staging, a manual start, an overridden
 * environment) enforces the production controls.
 */
export function strictSecurity(env: RuntimeConfig = process.env): boolean {
  if (env.NODE_ENV === "production") return true;
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") return false;
  return !env.NODE_TEST_CONTEXT;
}
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** Relaxed controls may only serve a loopback address and a loopback app URL. */
export function assertSecurityModeBinding(env: RuntimeConfig = process.env) {
  if (strictSecurity(env)) return;
  let appHost = "";
  try {
    appHost = new URL(env.PUBLIC_APP_URL ?? "http://localhost:3000").hostname;
  } catch {}
  if (
    !loopbackHosts.has(env.API_HOST ?? "127.0.0.1") ||
    !loopbackHosts.has(appHost)
  )
    throw new ConfigurationError(
      "Development security mode serves loopback addresses only. Set NODE_ENV=production for any shared or public deployment.",
    );
}

/** Voice and speech-to-text providers with a working adapter (integrations.ts). */
const IMPLEMENTED_VOICE_PROVIDERS = ["elevenlabs", "cartesia"];
/** Standard addresses; a saved value equal to either reads as "not chosen". */
const VOICE_PROVIDER_ADDRESSES = [
  "https://api.elevenlabs.io/v1",
  "https://api.cartesia.ai",
];
const VOICE_PROVIDER_OPTIONS = [
  { value: "elevenlabs", label: "ElevenLabs (link an existing voice ID)" },
  { value: "cartesia", label: "Cartesia (Quick and Pro clones made in the app)" },
];

/** Account approval never follows from saving a key or a successful probe. */
export function integrationCapability(
  id: string,
  config: RuntimeConfig = runtimeConfig(),
): { configured: boolean; approved: boolean } | undefined {
  const has = (...keys: string[]) => keys.every((key) => !!config[key]?.trim());
  if (id === "whoop") {
    const configured = has(
      "WHOOP_CLIENT_ID",
      "WHOOP_CLIENT_SECRET",
      "WHOOP_REDIRECT_URI",
    );
    const scopes = (
      config.WHOOP_SCOPES || "offline read:recovery read:sleep read:workout"
    )
      .split(/\s+/)
      .filter(Boolean);
    return {
      configured,
      approved:
        configured &&
        config.WHOOP_CONTRACT_VERIFIED === "true" &&
        scopes.includes("offline") &&
        scopes.some((scope) => scope.startsWith("read:")) &&
        scopes.every((scope) =>
          [
            "offline",
            "read:recovery",
            "read:sleep",
            "read:workout",
            "read:cycles",
          ].includes(scope),
        ),
    };
  }
  if (id === "zepp") {
    const configured = has(
      "ZEPP_CLIENT_ID",
      "ZEPP_CLIENT_SECRET",
      "ZEPP_REDIRECT_URI",
      "ZEPP_API_BASE_URL",
      "ZEPP_AUTHORIZE_URL",
      "ZEPP_TOKEN_URL",
      "ZEPP_SCOPES",
      "ZEPP_ADAPTER_CONTRACT",
    );
    return {
      configured,
      approved:
        configured &&
        config.ZEPP_CONTRACT_VERIFIED === "true" &&
        config.ZEPP_ADAPTER_CONTRACT === "canonical-observations-v1",
    };
  }
  if (id === "voice") {
    // The API address may be blank: each provider has a standard one.
    const configured = has(
      "VOICE_PROVIDER",
      "VOICE_API_KEY",
      "VOICE_MODEL",
      "VOICE_PRICE_VERSION",
      "VOICE_USD_PER_1000_CHARACTERS",
      "VOICE_DAILY_USD_LIMIT",
    );
    return {
      configured,
      approved:
        configured &&
        config.VOICE_CONTRACT_VERIFIED === "true" &&
        IMPLEMENTED_VOICE_PROVIDERS.includes(config.VOICE_PROVIDER ?? "") &&
        Number.isFinite(Number(config.VOICE_USD_PER_1000_CHARACTERS)) &&
        Number(config.VOICE_USD_PER_1000_CHARACTERS) >= 0 &&
        Number.isFinite(Number(config.VOICE_DAILY_USD_LIMIT)) &&
        Number(config.VOICE_DAILY_USD_LIMIT) > 0,
    };
  }
  if (id === "speech_to_text") {
    const configured = has(
      "STT_PROVIDER",
      "STT_API_KEY",
      "STT_PRICE_VERSION",
      "STT_USD_PER_HOUR",
    );
    return {
      configured,
      approved:
        configured &&
        config.STT_CONTRACT_VERIFIED === "true" &&
        IMPLEMENTED_VOICE_PROVIDERS.includes(config.STT_PROVIDER ?? "") &&
        Number.isFinite(Number(config.STT_USD_PER_HOUR)) &&
        Number(config.STT_USD_PER_HOUR) >= 0 &&
        // The app cannot request Cartesia zero retention (an Enterprise
        // account setting): a request for it is never silently ignored.
        !(
          config.STT_PROVIDER === "cartesia" &&
          config.STT_ZERO_RETENTION === "true"
        ),
    };
  }
  if (id === "lean") {
    // The connection check validates only the public endpoint; no read-only
    // account request exists in the verified contract. Activation therefore
    // requires the recorded account-contract verification, never a URL check.
    const configured = has(
      "LEAN_BASE_URL",
      "LEAN_ACCESS_TOKEN",
      "LEAN_SOURCE_ACCOUNT_ID",
    );
    return {
      configured,
      approved: configured && config.LEAN_CONTRACT_VERIFIED === "true",
    };
  }
  if (id === "web_addresses") {
    const registrar = (config.WEB_ADDRESS_REGISTRAR || "namecheap").trim();
    const contact = [
      "WEB_ADDRESS_REGISTRANT_FIRST_NAME",
      "WEB_ADDRESS_REGISTRANT_LAST_NAME",
      "WEB_ADDRESS_REGISTRANT_ORGANIZATION",
      "WEB_ADDRESS_REGISTRANT_ADDRESS",
      "WEB_ADDRESS_REGISTRANT_CITY",
      "WEB_ADDRESS_REGISTRANT_STATE",
      "WEB_ADDRESS_REGISTRANT_POSTAL_CODE",
      "WEB_ADDRESS_REGISTRANT_COUNTRY",
      "WEB_ADDRESS_REGISTRANT_PHONE",
      "WEB_ADDRESS_REGISTRANT_EMAIL",
    ];
    const configured =
      has(...contact) &&
      (registrar === "generic" ||
        (registrar === "101domain" && has("REGISTRAR_101DOMAIN_API_KEY")) ||
        (registrar === "namecheap" &&
          has(
            "NAMECHEAP_API_USER",
            "NAMECHEAP_API_KEY",
            "NAMECHEAP_USERNAME",
            "NAMECHEAP_CLIENT_IP",
          )));
    return {
      configured,
      approved: configured && config.WEB_ADDRESS_PURCHASES_ENABLED === "true",
    };
  }
  if (id === "digitalocean_billing") {
    const configured = has("DO_BILLING_TOKEN");
    return {
      configured,
      approved:
        configured &&
        (config.DO_BILLING_IMPORT_ENABLED ?? "true").trim() !== "false",
    };
  }
  if (id === "dns_hosting") {
    // The registrar's own DNS needs nothing; DigitalOcean needs its token.
    const configured =
      (config.DNS_PROVIDER || "registrar").trim() !== "digitalocean" ||
      has("DIGITALOCEAN_DNS_TOKEN");
    return { configured, approved: configured };
  }
  if (id === "domains") {
    const configured =
      has("DOMAIN_CNAME_TARGET") &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(
        config.DOMAIN_CNAME_TARGET!,
      );
    return {
      configured,
      approved: configured && config.DOMAIN_OPERATIONS_ENABLED === "true",
    };
  }
  if (id === "instagram") {
    const configured = has(
      "INSTAGRAM_APP_ID",
      "INSTAGRAM_APP_SECRET",
      "INSTAGRAM_REDIRECT_URI",
    );
    return {
      configured,
      approved: configured && config.INSTAGRAM_APP_REVIEW_APPROVED === "true",
    };
  }
  return undefined;
}

export type IntegrationField = {
  key: string;
  label: string;
  type: "secret" | "text" | "url" | "number" | "boolean" | "select";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  help?: string;
  defaultValue?: string;
  /**
   * Earlier defaults that now mean "not chosen": a saved or environment value
   * equal to one of these (after trimming) reads as defaultValue.
   */
  supersededValues?: string[];
};
export type IntegrationDefinition = {
  id: string;
  name: string;
  description: string;
  category:
    | "platform"
    | "payments"
    | "intelligence"
    | "communications"
    | "health"
    | "branding"
    | "marketing";
  implemented: boolean;
  /**
   * Operator controls rather than a provider connection: always enabled, no
   * connection test, cannot be disconnected (like the application settings).
   */
  controls?: boolean;
  fields: IntegrationField[];
  setupNotes?: string;
};
const field = (
  key: string,
  label: string,
  type: IntegrationField["type"],
  options: Omit<IntegrationField, "key" | "label" | "type"> = {},
): IntegrationField => ({ key, label, type, ...options });

/**
 * Follower calculator assumptions per scenario (Marketing estimates). The
 * defaults equal DEFAULT_FOLLOWER_MODEL in packages/domain
 * marketing-calculators.ts; a test keeps them equal.
 */
const FOLLOWER_SCENARIO_FIELDS = [
  ["CAUTIOUS", "cautious"],
  ["TYPICAL", "typical"],
  ["STRONG", "strong case"],
] as const;
const FOLLOWER_TIER_FIELDS = [
  ["5K", "up to 5,000 followers"],
  ["10K", "5,001 to 10,000 followers"],
  ["50K", "10,001 to 50,000 followers"],
  ["100K", "50,001 to 100,000 followers"],
  ["ABOVE_100K", "above 100,000 followers"],
] as const;
const FOLLOWER_STORY_DEFAULTS: Record<string, string[]> = {
  CAUTIOUS: ["9.55", "3.5", "1.35", "0.55", "0.5"],
  TYPICAL: ["10.4", "5", "5", "5", "5"],
  STRONG: ["20.5", "20.5", "8", "6.5", "5"],
};
const FOLLOWER_STORY_HELP: Record<string, string> = {
  CAUTIOUS: "Share of followers who see at least one Story a month. Default: Socialinsider Stories reach, image (brand accounts).",
  TYPICAL: "Default: Socialinsider Stories reach, video, at least 5% (IQFluence: Story views above 5-8% of followers are healthy).",
  STRONG: "Default: 20.5% up to 10,000 followers (our assumption: the reach Socialinsider measured for a six-frame Story sequence, used as a monthly audience; the measured 5-10K tier reach is 3.5-4.2%), then 8%, 6.5% and 5% (IQFluence 5-8% band).",
};
const FOLLOWER_RATE_FIELDS: Array<
  [key: string, label: string, defaults: [string, string, string], help: string]
> = [
  ["CLICK", "Link-sticker click per viewer per link Story", ["1", "3", "5"], "Creator reports 1-5% (no industry benchmark exists); IQFluence median 4.1%, strong creators 6-7%."],
  ["DM_OPEN", "Keyword commenters who open the DM link", ["18", "30", "45"], "Vendor claims (CommuniPass, ChatAutoDM); no dataset."],
  ["BROADCAST_CLICK", "Broadcast members who open one link message", ["1.27", "1.45", "2.09"], "MailerLite email click medians (sports, health and fitness, all industries), used as a proxy."],
  ["BIO_CLICK", "Profile visitors who open the bio link in a month", ["1", "2", "3"], "Rule of thumb (Hopp by Wix: 1-3%)."],
  ["PAID", "Visit to paid subscriber", ["0.72", "2.9", "6.2"], "Dynamic Yield luxury retail; RevenueCat Health & Fitness download-to-paid within 35 days, median and upper quartile (an app install shows more intent than a Story tap, so these may overstate). No published benchmark exists for coaching subscriptions."],
  ["RENEWAL", "Share of each audience new to your link each month", ["0", "1.5", "8"], "0 to 50. Cautious keeps the same people all year; typical is about the follower growth Socialinsider measured (11-22% a year by tier); strong is our assumption for a growing audience. Keep strong at or above the monthly cancellations (2.9% at 30% a year) so more sharing never lowers month-12 subscribers."],
];
function followerAssumptionFields(): IntegrationField[] {
  const fields: IntegrationField[] = [];
  for (const [scenario, name] of FOLLOWER_SCENARIO_FIELDS)
    FOLLOWER_TIER_FIELDS.forEach(([tier, tierLabel], i) =>
      fields.push(
        field(
          `FOLLOWER_STORY_${scenario}_${tier}`,
          `Story audience, ${name}, ${tierLabel} (%)`,
          "number",
          {
            defaultValue: FOLLOWER_STORY_DEFAULTS[scenario][i],
            ...(i === 0 ? { help: FOLLOWER_STORY_HELP[scenario] } : {}),
          },
        ),
      ),
    );
  for (const [key, label, defaults, help] of FOLLOWER_RATE_FIELDS)
    FOLLOWER_SCENARIO_FIELDS.forEach(([scenario, name], i) =>
      fields.push(
        field(`FOLLOWER_${key}_${scenario}`, `${label}, ${name} (%)`, "number", {
          defaultValue: defaults[i],
          ...(i === 0 ? { help } : {}),
        }),
      ),
    );
  return fields;
}

export const INTEGRATION_CATALOG: IntegrationDefinition[] = [
  {
    id: "application",
    name: "Application settings",
    category: "platform",
    implemented: true,
    controls: true,
    description: "Platform identity, reviewed policies and feature controls.",
    setupNotes:
      "These controls record an operator decision. They do not establish legal approval or provider eligibility by themselves. Legal document versions come from the published documents registry, not from this page. Infrastructure secrets stay outside this page.",
    fields: [
      // Equal to DEFAULT_PLATFORM_NAME in packages/contracts (a test keeps
      // them in step); docs/features/brand.md.
      // The old default "Trainer Brain" (SUPERSEDED_PLATFORM_NAMES) reads
      // as unset, so a platform that saved the settings form before the
      // rename shows trainsyou; any other chosen name is kept.
      field("APP_NAME", "Platform name", "text", {
        defaultValue: "trainsyou",
        supersededValues: ["Trainer Brain"],
        help: "trainsyou shows the trainsyou logo and icons. Any other name is shown as text, with icons drawn from its initials. Trainers' own websites and apps keep their Design Studio branding.",
      }),
      field("SUPPORT_EMAIL", "Support email", "text"),
      field("LEGAL_APPROVED", "Legal documents approved", "boolean", {
        defaultValue: "false",
      }),
      field(
        "FILE_IMPORTS_APPROVED",
        "Document and health imports approved",
        "boolean",
        { defaultValue: "false" },
      ),
      field("NUTRITION_ENABLED", "Enable nutrition", "boolean", {
        defaultValue: "false",
      }),
      field("NUTRITION_SCOPE_APPROVED", "Nutrition scope reviewed", "boolean", {
        defaultValue: "false",
      }),
      field("MEAL_PHOTOS_ENABLED", "Enable meal-photo estimates", "boolean", {
        defaultValue: "false",
        help: "Requires a vision-capable model. Subscribers review estimated foods and portions before saving.",
      }),
      field("FOOD_LOOKUP_ENABLED", "Enable food barcode lookup", "boolean", {
        defaultValue: "false",
        help: "Looks up products in Open Food Facts. Food labels and portions require subscriber confirmation; coverage varies.",
      }),
      field(
        "FOLLOWER_INVITE_EMAILS_PER_DAY",
        "Follower invitation emails per workspace per day",
        "number",
        {
          defaultValue: "50",
          help: "Whole number, 0 to 10000. Includes resends. Copy-link invitations are not limited by this.",
        },
      ),
      field(
        "FOLLOWER_INVITE_EMAILS_PER_ADDRESS",
        "Invitation emails to one address per day",
        "number",
        {
          defaultValue: "3",
          help: "Whole number, 1 to 20, counted across all workspaces over 24 hours.",
        },
      ),
      field(
        "FOLLOWER_INVITE_EMAILS_PLATFORM_PER_DAY",
        "Follower invitation emails per day, whole platform",
        "number",
        {
          defaultValue: "1000",
          help: "Whole number, 0 to 100000. 0 pauses invitation emails; copy-link invitations keep working.",
        },
      ),
      field(
        "COMPLIMENTARY_ACCESS_MAX_DAYS",
        "Longest complimentary access period (days)",
        "number",
        { defaultValue: "365", help: "Whole number, 1 to 3650." },
      ),
      field(
        "COMPLIMENTARY_ACCESS_OPEN_ENDED",
        "Allow complimentary access until revoked",
        "boolean",
        { defaultValue: "true" },
      ),
      field(
        "COMPLIMENTARY_ACCESS_MAX_ACTIVE",
        "Active complimentary members per workspace",
        "number",
        {
          defaultValue: "25",
          help: "Whole number, 0 to 100000. 0 switches complimentary access off. Complimentary members create no revenue or commission; AI and voice usage stays attributed to the trainer.",
        },
      ),
      field(
        "COACH_DIRECTORY_ENABLED",
        "Open the public coach directory",
        "boolean",
        {
          defaultValue: "true",
          help: "Lists only published coaches who opted in from their website settings. Turning this off hides /coaches and its sitemap entry; coaches keep their choice.",
        },
      ),
    ],
  },
  {
    id: "marketing",
    name: "Marketing estimates",
    category: "marketing",
    implemented: true,
    controls: true,
    description:
      "Assumptions behind the public follower calculator, and public company details.",
    setupNotes:
      "Every figure is shown with its source on /methodology and with each estimate. Change the assumptions version whenever you change a value, and give the reason and source: a value that differs from its cited default is marked on /methodology as adjusted by the operator, with your note. An inconsistent set (a cautious value above its typical one, or a typical value above its strong one) cannot be saved: to lower a strong value below its typical one, lower typical and cautious too. The strong case is the calculator's headline: a best case for an engaged, growing audience, not a typical result.",
    fields: [
      field("FOLLOWER_MODEL_VERSION", "Assumptions version", "text", {
        defaultValue: "2026-09-28.4",
        help: "Change this whenever you change an assumption; it is shown on /methodology and with every estimate.",
        // Earlier published versions read as the current default.
        supersededValues: ["2026-09-28", "2026-09-28.2", "2026-09-28.3"],
      }),
      field("FOLLOWER_MODEL_CHANGE_NOTE", "Reason and source for changed values", "text", {
        help: "Required whenever a value differs from its cited default. Shown on /methodology next to the adjusted values and in the change log.",
      }),
      ...followerAssumptionFields(),
      field("FOLLOWER_ENGAGEMENT_BENCHMARK", "Average engagement rate (%)", "number", {
        defaultValue: "0.48",
        help: "A trainer's own engagement rate is compared with this to scale Story reach and Reel comments. Default: Socialinsider 2025.",
      }),
      field("FOLLOWER_ENGAGEMENT_FACTOR_MAX", "Largest engagement scaling (times)", "number", {
        defaultValue: "2",
        help: "Reach is scaled by at most this factor up, and its inverse down. 1 to 10.",
      }),
      field("COMPANY_DETAILS", "Public company details", "text", {
        help: "Registered name, licence and address shown on /about. Leave blank until confirmed; nothing is shown then.",
      }),
    ],
  },
  {
    id: "instagram",
    name: "Instagram (follower estimates)",
    category: "marketing",
    implemented: true,
    description:
      "Lets trainers connect an Instagram professional account to fill the follower calculator with their follower count and recent engagement.",
    setupNotes:
      "Uses the Instagram API with Instagram Login (professional accounts only, instagram_business_basic). Set the redirect URI in your Meta app to /api/v1/trainer/instagram/callback on the public application address. Access is read once and not stored. Stays off until Meta app review is recorded as approved.",
    fields: [
      field("INSTAGRAM_APP_ID", "Instagram app ID", "text", { required: true }),
      field("INSTAGRAM_APP_SECRET", "Instagram app secret", "secret", {
        required: true,
      }),
      field("INSTAGRAM_REDIRECT_URI", "Redirect URI", "url", {
        required: true,
        help: "https://<your application address>/api/v1/trainer/instagram/callback",
      }),
      field(
        "INSTAGRAM_APP_REVIEW_APPROVED",
        "Meta app review approved for instagram_business_basic",
        "boolean",
        { defaultValue: "false" },
      ),
    ],
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "payments",
    implemented: true,
    description:
      "Subscriber checkout, subscription changes, refunds and signed payment events.",
    setupNotes:
      "Connection testing only reads the Stripe account. Commerce and bundle changes have separate controls; a successful account check does not verify product prices or bank settlement.",
    fields: [
      field("STRIPE_SECRET_KEY", "Secret API key", "secret", {
        required: true,
      }),
      field("STRIPE_PUBLISHABLE_KEY", "Publishable API key", "text"),
      field("STRIPE_WEBHOOK_SECRET", "Webhook signing secret", "secret", {
        required: true,
        help: "Configure the Stripe endpoint as /api/v1/webhooks/stripe on the public application address, created with API version 2026-08-26.dahlia (docs/features/payments-stripe.md lists its events).",
      }),
      field("COMMERCE_APPROVED", "Enable live commerce", "boolean", {
        defaultValue: "false",
      }),
      field(
        "BUNDLE_CHANGES_APPROVED",
        "Enable workout and nutrition bundle changes",
        "boolean",
        { defaultValue: "false" },
      ),
    ],
  },
  {
    id: "lean",
    name: "Lean",
    category: "payments",
    implemented: true,
    description:
      "Company-bank payout instructions for eligible verified trainer bank accounts.",
    setupNotes:
      "The adapter requires your account-specific API contract. The connection check validates the public endpoint only and sends no authenticated request, so Lean stays inactive until the account API contract verification is recorded. Validation does not move money, verify bank permissions or establish recipient eligibility. Reconciliation is required before retrying an unknown payout.",
    fields: [
      field("LEAN_BASE_URL", "Account API base URL", "url", { required: true }),
      field("LEAN_ACCESS_TOKEN", "Access token", "secret", { required: true }),
      field("LEAN_SOURCE_ACCOUNT_ID", "Company source account ID", "secret", {
        required: true,
      }),
      field(
        "LEAN_CONTRACT_VERIFIED",
        "Account API contract verified",
        "boolean",
        { defaultValue: "false" },
      ),
      field("PAYOUTS_APPROVED", "Enable payout execution", "boolean", {
        defaultValue: "false",
      }),
    ],
  },
  {
    id: "platform_finance",
    name: "Platform finance",
    category: "payments",
    implemented: true,
    controls: true,
    description:
      "Exchange rate and usage-charge rules behind the Super admin's cost and profit figures.",
    setupNotes:
      "These record the owner's finance decisions of 28 September 2026 (docs/features/platform-finance.md): AI and voice usage charged to trainers with a 100% markup as the \"AI Coach Service Fee\", complimentary members' usage charged to their trainer, Stripe fees paid by the trainer and shown to them plainly, income counted when it is received, and no budget limits. A month's reviewed exchange rate, recorded under Platform finance, always takes precedence over the default rate.",
    fields: [
      field("FINANCE_USD_TO_AED", "Default USD to AED rate", "number", {
        defaultValue: "3.6725",
        help: "Converts provider costs in business metrics and usage previews for a month that has no reviewed rate yet. Automatic month close keeps its own approved rate for such a month. 3.6725 is the UAE dirham's peg to the US dollar. 1 to 10.",
      }),
      field(
        "FINANCE_USAGE_MARKUP_PERCENT",
        "Markup on AI and voice usage charged to trainers (%)",
        "number",
        {
          defaultValue: "100",
          help: "Owner decision (28 September 2026): 100, so trainers pay twice the provider cost. Trainers see the charge only as one line, \"AI Coach Service Fee\", with the amount (markup included). 0 to 1000. Applies to usage statements posted after the change; statements already posted keep their charge.",
        },
      ),
      field(
        "FINANCE_COMPLIMENTARY_USAGE_BEARER",
        "Who pays for AI and voice used by complimentary members",
        "select",
        {
          defaultValue: "trainer",
          options: [
            { value: "trainer", label: "The trainer (in the monthly usage charge)" },
            { value: "platform", label: "The platform (left out of the usage charge)" },
          ],
          help: "Owner decision (28 September 2026): the trainer. Applies to usage statements posted after the change.",
        },
      ),
      field(
        "FINANCE_ESTIMATE_UNRESOLVED_USAGE",
        "Automatic month close estimates unresolved provider usage",
        "boolean",
        {
          defaultValue: "false",
          help: "Off (today's behaviour): automatic month close waits until an operator reconciles unresolved provider calls from the invoice, or estimates them (Payments and payouts: Estimate unpriced usage). On: calls whose outcome was never confirmed are priced at their stored estimate, or the average of the same feature and model, and charged at that estimate; a later invoice correction does not change a usage charge already posted. Calls that answered are always priced at their estimate when made, and calls never sent cost nothing.",
        },
      ),
      field(
        "FINANCE_EMAIL_USD_PER_MESSAGE",
        "Email cost per delivered message (USD)",
        "number",
        {
          defaultValue: "0",
          help: "The email provider's price per message, counted for every delivered email in the Platform finance profit and loss. 0 counts only the email plan, entered as a recurring platform cost. 0 to 1, up to six decimals.",
        },
      ),
      field(
        "FINANCE_REGISTRAR_LOW_BALANCE_USD",
        "Alert when the registrar balance is below (USD)",
        "number",
        {
          defaultValue: "20",
          help: "Platform alert (finance) when the registrar's last reported balance is below this; critical below a quarter of it. The balance is read daily and by Check registrar balance.",
        },
      ),
      field(
        "FINANCE_UNPRICED_ALERT_DAYS",
        "Alert on unpriced provider usage after (days)",
        "number",
        {
          defaultValue: "7",
          help: "Platform alert when provider calls of an ended month are still unpriced this many days after it ended (critical after 30). No budget limits apply: costs are compared with income instead.",
        },
      ),
      field(
        "FINANCE_STRIPE_FEE_PERCENT",
        "Stripe card fee shown to trainers (%)",
        "number",
        {
          defaultValue: "2.9",
          help: "Trainers pay Stripe's fees (owner decision, 28 September 2026). Used for the estimate trainers see before they set a price: Stripe's standard UAE rate for cards issued in the UAE (2.9% plus a fixed fee, stripe.com/ae/pricing). 0 to 20. The actual fee of each payment comes from Stripe.",
        },
      ),
      field(
        "FINANCE_STRIPE_FEE_FIXED_AED",
        "Stripe fixed fee per payment shown to trainers (AED)",
        "number",
        {
          defaultValue: "1.00",
          help: "The fixed part of Stripe's fee per successful card payment in the estimate (AED 1.00 on Stripe's standard UAE pricing). 0 to 20, at most two decimals.",
        },
      ),
      field(
        "FINANCE_STRIPE_INTERNATIONAL_PERCENT",
        "Extra Stripe fee for cards issued outside the UAE (%)",
        "number",
        {
          defaultValue: "1",
          help: "Shown to trainers as the extra a card issued abroad can cost on top of the standard fee (1% on Stripe's standard UAE pricing). 0 to 20.",
        },
      ),
    ],
  },
  {
    id: "model",
    name: "AI model",
    category: "intelligence",
    implemented: true,
    description:
      "OpenAI-compatible coaching and nutrition intelligence with recorded usage and request limits.",
    setupNotes:
      "Use a provider that supports /chat/completions with JSON output and token usage. The read-only model-list test verifies access and the selected model, not coaching quality; held-out coach evaluations remain required.",
    fields: [
      field("MODEL_BASE_URL", "API base URL", "url", {
        required: true,
        help: "Include the API version path, for example https://api.openai.com/v1.",
      }),
      field("MODEL_API_KEY", "API key", "secret", { required: true }),
      field("MODEL_NAME", "Model ID", "text", { required: true }),
      field("MODEL_PROVIDER", "Provider name for cost records", "text", {
        help: "Recorded on every AI cost row, for example openai, anthropic or openrouter. Leave blank to use the name read from the API address. Lower-case letters, digits, dots, dashes and underscores.",
      }),
      field(
        "MODEL_VISION_ENABLED",
        "Selected model supports image input",
        "boolean",
        {
          defaultValue: "false",
          help: "The account model-list check cannot verify image understanding. Enable only for a model with confirmed image support.",
        },
      ),
      field(
        "MODEL_INPUT_USD_PER_MILLION",
        "Input price / million tokens (USD)",
        "number",
        { required: true },
      ),
      field(
        "MODEL_OUTPUT_USD_PER_MILLION",
        "Output price / million tokens (USD)",
        "number",
        { required: true },
      ),
      field("MODEL_PRICE_VERSION", "Reviewed price version", "text", {
        required: true,
      }),
      field(
        "MODEL_MAX_DAILY_CALLS",
        "Maximum daily calls per workspace",
        "number",
        { required: true, defaultValue: "100" },
      ),
      field(
        "MODEL_MAX_DAILY_CALLS_PER_SUBSCRIBER",
        "Maximum daily nutrition calls per subscriber",
        "number",
        {
          defaultValue: "20",
          help: "Weekly plans and meal-photo analyses one subscriber can start each day. Subscriber requests together also leave the final fifth of the workspace limit for coach work.",
        },
      ),
    ],
  },
  {
    id: "email",
    name: "Transactional email",
    category: "communications",
    implemented: true,
    description:
      "Account invitations, password recovery and lifecycle messages through an email API.",
    setupNotes:
      "The endpoint must accept Bearer authentication and JSON {from,to,subject,text}. Validation checks configuration without sending a message; sender-domain and delivery verification remain with your email provider.",
    fields: [
      field("EMAIL_API_URL", "Send-email API endpoint", "url", {
        required: true,
      }),
      field("EMAIL_API_KEY", "API key", "secret", { required: true }),
      field("EMAIL_FROM", "Verified sender address", "text", {
        required: true,
      }),
    ],
  },
  {
    id: "push",
    name: "Device notifications",
    category: "communications",
    implemented: true,
    description:
      "Opt-in browser notifications with private details kept in the app.",
    setupNotes:
      "Generate one stable VAPID key pair with web-push. The private key is encrypted. Key changes require devices to reconnect. Requires HTTPS, the server encryption key and a PostgreSQL worker. Validation checks the key pair without sending a notification. Supported services: Google FCM, Mozilla and Apple Web Push; browser/device delivery remains a separate check.",
    fields: [
      field("PUSH_VAPID_PUBLIC_KEY", "VAPID public key", "text", {
        required: true,
      }),
      field("PUSH_VAPID_PRIVATE_KEY", "VAPID private key", "secret", {
        required: true,
      }),
      field("PUSH_VAPID_SUBJECT", "Contact (mailto:address)", "text", {
        required: true,
      }),
    ],
  },
  {
    id: "google_signin",
    name: "Sign in with Google",
    category: "platform",
    implemented: true,
    description:
      "Google accounts as a sign-in method (OpenID Connect with PKCE) for existing members, public joins and invitations.",
    setupNotes:
      "Create an OAuth web client in Google Cloud and register <public app address>/api/v1/auth/oidc/google/callback as an authorized redirect URI. The connection check reads Google's discovery document and signing keys and confirms the client credentials without signing anyone in. Sign-in stays off until this connection is enabled and checked. New accounts are still limited to public joins and invitations under the legal approval gate.",
    fields: [
      field("GOOGLE_SIGNIN_CLIENT_ID", "OAuth client ID", "text", {
        required: true,
      }),
      field("GOOGLE_SIGNIN_CLIENT_SECRET", "OAuth client secret", "secret", {
        required: true,
      }),
    ],
  },
  {
    id: "apple_signin",
    name: "Sign in with Apple",
    category: "platform",
    implemented: true,
    description:
      "Apple IDs as a sign-in method (OpenID Connect with PKCE and an ES256 client secret).",
    setupNotes:
      "Create a Services ID with Sign in with Apple, register <public app address>/api/v1/auth/oidc/apple/callback as the return URL, and create a Sign in with Apple key. Paste the .p8 key contents (line breaks are removed automatically). The connection check reads Apple's discovery document and signing keys and confirms the client secret without signing anyone in.",
    fields: [
      field("APPLE_SIGNIN_SERVICES_ID", "Services ID (client ID)", "text", {
        required: true,
      }),
      field("APPLE_SIGNIN_TEAM_ID", "Team ID", "text", { required: true }),
      field("APPLE_SIGNIN_KEY_ID", "Key ID", "text", { required: true }),
      field("APPLE_SIGNIN_PRIVATE_KEY", "Private key (.p8)", "secret", {
        required: true,
      }),
    ],
  },
  {
    id: "whoop",
    name: "WHOOP",
    category: "health",
    implemented: true,
    description: "OAuth recovery, sleep and workout synchronization.",
    setupNotes:
      "OAuth, encrypted authorization, refresh, synchronization and revocation are implemented. Activate only after confirming account approval, approved scopes and data-use rights; a settings check does not qualify the provider.",
    fields: [
      field("WHOOP_CLIENT_ID", "OAuth client ID", "text", { required: true }),
      field("WHOOP_CLIENT_SECRET", "OAuth client secret", "secret", {
        required: true,
      }),
      field("WHOOP_REDIRECT_URI", "Registered callback URL", "url", {
        required: true,
      }),
      field("WHOOP_SCOPES", "Approved OAuth scopes", "text", {
        defaultValue: "offline read:recovery read:sleep read:workout",
      }),
      field(
        "WHOOP_CONTRACT_VERIFIED",
        "Account contract and data-use rights approved",
        "boolean",
        { defaultValue: "false" },
      ),
    ],
  },
  {
    id: "apple",
    name: "Apple Health import",
    category: "health",
    implemented: true,
    description:
      "User-provided health exports and, when enabled, automatic sync from the HealthKit companion app.",
    setupNotes:
      "Manual import needs no Apple API credential. Import approval and user consent apply. Automatic HealthKit sync needs the native companion app, which is not part of this release; keep it off until that app is approved and published. Trainers must also allow sync in their wearable policy.",
    fields: [
      field(
        "APPLE_IMPORTS_ENABLED",
        "Enable Apple Health file import",
        "boolean",
        { defaultValue: "true" },
      ),
      field(
        "HEALTHKIT_SYNC_ENABLED",
        "Enable automatic sync from the HealthKit companion app",
        "boolean",
        {
          defaultValue: "false",
          help: "Accepts device pairing and background uploads from the companion iPhone app. The import approval and Apple Health file import switch also apply.",
        },
      ),
    ],
  },
  {
    id: "zepp",
    name: "Amazfit / Zepp",
    category: "health",
    implemented: true,
    description: "Fitness observations through an approved partner connection.",
    setupNotes:
      "Requires an approved partner gateway implementing canonical-observations-v1. This is a configurable partner adapter, not a claim of direct public Zepp API access. Keep disabled until the account contract and endpoints are verified.",
    fields: [
      field("ZEPP_CLIENT_ID", "Partner client ID", "text", { required: true }),
      field("ZEPP_CLIENT_SECRET", "Partner client secret", "secret", {
        required: true,
      }),
      field("ZEPP_REDIRECT_URI", "Registered callback URL", "url", {
        required: true,
      }),
      field("ZEPP_API_BASE_URL", "Approved partner adapter base URL", "url", {
        required: true,
      }),
      field("ZEPP_AUTHORIZE_URL", "Partner OAuth authorization URL", "url", {
        required: true,
      }),
      field("ZEPP_TOKEN_URL", "Partner OAuth token URL", "url", {
        required: true,
      }),
      field("ZEPP_SCOPES", "Approved partner OAuth scopes", "text", {
        required: true,
      }),
      field("ZEPP_ADAPTER_CONTRACT", "Reviewed adapter contract", "text", {
        required: true,
        help: "Must be canonical-observations-v1 after the partner implements and approves that contract.",
      }),
      field(
        "ZEPP_CONTRACT_VERIFIED",
        "Partner contract and data-use rights approved",
        "boolean",
        { defaultValue: "false" },
      ),
    ],
  },
  {
    id: "voice",
    name: "Trainer voice",
    category: "intelligence",
    implemented: true,
    description: "Consented trainer-voice guidance for premium sessions.",
    setupNotes:
      "Cartesia: each trainer records or uploads their own voice in Trainer voice, gives explicit consent and chooses a Quick clone (10 to 60 seconds of audio, ready in seconds) or, when you switch Pro on, a Pro clone (at least 30 minutes of audio, trained by Cartesia for up to 3 hours; needs a Cartesia plan with Pro clone slots, counted for the whole account). Clones are private to the Cartesia account, attached only to the trainer's own workspace, and deleted at Cartesia when the trainer deletes them, withdraws voice consent, leaves ownership or the workspace closes. The trainer previews a line and activates the voice; members hear it only while the trainer's consent stands. ElevenLabs: the trainer links an existing provider voice ID, which an administrator verifies for identity and rights; the app makes no ElevenLabs clone. Premium memberships and the workspace daily cost cap apply to speech, transcription, previews and clones. Charges are estimates until reconciled with the provider invoice. The connection check reads one voice from the account (Cartesia) and makes no audio.",
    fields: [
      field("VOICE_PROVIDER", "Provider", "select", {
        required: true,
        defaultValue: "elevenlabs",
        options: VOICE_PROVIDER_OPTIONS,
      }),
      field("VOICE_BASE_URL", "API base URL", "url", {
        help: "Leave blank for the provider's standard address: https://api.cartesia.ai (Cartesia) or https://api.elevenlabs.io/v1 (ElevenLabs).",
        supersededValues: VOICE_PROVIDER_ADDRESSES,
      }),
      field("VOICE_API_KEY", "API key", "secret", { required: true }),
      field("VOICE_MODEL", "Approved speech model ID", "text", {
        required: true,
        help: "Cartesia: sonic-3.6, or a dated snapshot such as sonic-3.6-2026-08-27 to keep the sound fixed (Pro clones always use a dated snapshot they were trained for). ElevenLabs: for example eleven_multilingual_v2.",
      }),
      field("VOICE_API_VERSION", "Cartesia API version", "text", {
        defaultValue: "2026-08-14",
        help: "Sent as the Cartesia-Version header. Change only after reviewing Cartesia's changelog. Not used by ElevenLabs.",
      }),
      field("VOICE_PRICE_VERSION", "Reviewed price version", "text", {
        required: true,
      }),
      field(
        "VOICE_USD_PER_1000_CHARACTERS",
        "Estimated USD / 1,000 characters",
        "number",
        {
          required: true,
          help: "Cartesia bills about 1 credit per character; at the plan prices published on 28 September 2026 that is roughly 0.04 to 0.065 USD per 1,000 characters. Use your own plan's rate.",
        },
      ),
      field("VOICE_DAILY_USD_LIMIT", "Workspace daily USD limit", "number", {
        required: true,
        help: "One limit per workspace per day for session audio, guided audio, previews, transcription and clones.",
      }),
      field(
        "VOICE_QUICK_CLONE_ENABLED",
        "Let trainers make a Quick clone (Cartesia)",
        "boolean",
        {
          defaultValue: "true",
          help: "Needs a paid Cartesia plan (Pro or higher on 28 September 2026). The free tier refuses cloning (HTTP 402, plan_upgrade_required) and has no commercial use licence; the connection check cannot see the plan. A refused clone alerts operators and the trainer can try again after the upgrade.",
        },
      ),
      field(
        "VOICE_PRO_CLONE_ENABLED",
        "Let trainers make a Pro clone (Cartesia)",
        "boolean",
        {
          defaultValue: "false",
          help: "Needs a Cartesia plan with Pro clone slots (Startup: 2, Scale: 4 on 28 September 2026). Training is free at Cartesia; speech from a Pro clone costs the same per character.",
        },
      ),
      field("VOICE_PRO_CLONE_SLOTS", "Pro clone slots on the account", "number", {
        defaultValue: "2",
        help: "Whole number. A trainer cannot start a Pro clone while this many Pro clones exist across the platform.",
      }),
      field(
        "VOICE_PRO_CLONE_PRICE_AED",
        "Pro clone price shown to trainers (AED)",
        "number",
        {
          help: "Optional. Shown to the trainer before they choose Pro. The app does not charge it; bill it separately.",
        },
      ),
      field("VOICE_CLONE_USD", "Estimated USD per clone made", "number", {
        defaultValue: "0",
        help: "Counted against the workspace daily limit. Cartesia published no per-clone charge on 28 September 2026.",
      }),
      field(
        "VOICE_CLONE_REVIEW_REQUIRED",
        "Review each clone before members hear it",
        "boolean",
        {
          defaultValue: "false",
          help: "Off by default: the trainer reviews their own clone (listens to its preview and accepts it) and members hear it once accepted. Turn on to also hold each accepted clone in Integration operations for your identity and rights check.",
        },
      ),
      field(
        "VOICE_TRAINING_OPT_OUT",
        "The provider account opted out of model training on uploads",
        "boolean",
        {
          defaultValue: "false",
          help: "Cartesia may use uploaded recordings to train its models unless the account opted out with Cartesia's form. Trainers are told which applies before they consent.",
        },
      ),
      field(
        "VOICE_CONTRACT_VERIFIED",
        "Account contract and voice rights approved",
        "boolean",
        { defaultValue: "false" },
      ),
    ],
  },
  {
    id: "speech_to_text",
    name: "Speech-to-text",
    category: "intelligence",
    implemented: true,
    description:
      "Spoken replies (done, reps, pause, pain) during voice-led workout sessions.",
    setupNotes:
      "ElevenLabs or Cartesia speech-to-text transcribes short audio chunks, only from members with premium voice who switched on spoken replies and consented. Audio is sent once and never stored by this app. Transcription counts against the workspace voice daily limit set under Trainer voice. Browsers with on-device speech recognition, and tap buttons, work without this provider. The connection check reads the ElevenLabs model list, or one voice from the Cartesia account; no audio is sent.",
    fields: [
      field("STT_PROVIDER", "Provider", "select", {
        required: true,
        defaultValue: "elevenlabs",
        options: [
          { value: "elevenlabs", label: "ElevenLabs" },
          { value: "cartesia", label: "Cartesia (batch ink-whisper)" },
        ],
      }),
      field("STT_BASE_URL", "API base URL", "url", {
        help: "Leave blank for the provider's standard address: https://api.cartesia.ai (Cartesia) or https://api.elevenlabs.io/v1 (ElevenLabs).",
        supersededValues: VOICE_PROVIDER_ADDRESSES,
      }),
      field("STT_API_KEY", "API key", "secret", { required: true }),
      field("STT_MODEL", "Approved transcription model ID", "text", {
        help: "Leave blank for the provider's batch model: scribe_v1 (ElevenLabs) or ink-whisper (Cartesia).",
        supersededValues: ["scribe_v1", "ink-whisper"],
      }),
      field("STT_API_VERSION", "Cartesia API version", "text", {
        defaultValue: "2026-08-14",
        help: "Sent as the Cartesia-Version header. Not used by ElevenLabs.",
      }),
      field("STT_PRICE_VERSION", "Reviewed price version", "text", {
        required: true,
      }),
      field("STT_USD_PER_HOUR", "Estimated USD / hour of audio", "number", {
        required: true,
        help: "Cartesia batch ink-whisper bills 1 credit per 2 seconds, silence included: roughly 0.07 to 0.12 USD per hour at the plan prices published on 28 September 2026.",
      }),
      field("STT_ZERO_RETENTION", "Request zero retention", "boolean", {
        defaultValue: "false",
        help: "ElevenLabs only: sends enable_logging=false. Only enable when the provider account supports zero-retention mode. Cartesia zero retention is an Enterprise account setting the app cannot request: with Cartesia this must be off, and members are told the provider's own retention applies.",
      }),
      field(
        "STT_CONTRACT_VERIFIED",
        "Account contract and audio processing approved",
        "boolean",
        { defaultValue: "false" },
      ),
    ],
  },
  {
    id: "domains",
    name: "Custom domains",
    category: "branding",
    implemented: true,
    description: "Trainer domains and verified ownership.",
    setupNotes:
      "Trainer requests, exact-price quote approval, manual registrar/payment reconciliation, TXT ownership, CNAME and live TLS verification, expiry and renewal evidence are implemented. Registrar purchase and DNS/TLS provisioning remain operator actions; no API credential alone activates them.",
    fields: [
      field("DOMAIN_PROVIDER", "Provider name", "text"),
      field("DOMAIN_API_URL", "API base URL", "url"),
      field("DOMAIN_API_KEY", "API key", "secret"),
      field("DOMAIN_ACCOUNT_ID", "Provider account ID", "secret"),
      field("DOMAIN_CNAME_TARGET", "Approved ingress CNAME target", "text", {
        required: true,
      }),
      field(
        "DOMAIN_OPERATIONS_ENABLED",
        "Enable reviewed manual domain operations",
        "boolean",
        { defaultValue: "false" },
      ),
    ],
  },
];

/** Namecheap (or the generic registrar) for autonomous trainer domains. */
INTEGRATION_CATALOG.push({
  id: "web_addresses",
  name: "Web addresses and registrar",
  category: "branding",
  implemented: true,
  description:
    "Trainer subdomains and yearly domains bought, set up and renewed automatically.",
  setupNotes:
    "The connection check reads the registrar account balance only; no domain is bought. Namecheap accepts API calls only from the whitelisted client IPv4 address (this server's public address) and only after API access is enabled on the account. Keep the test environment switched on until the owner approves live purchases. Owner decision (28 September 2026): the registrant of every domain bought here is always the platform company entered below, with WHOIS privacy always requested; trainers are never the registrant, and there is no self-service transfer out or authorisation code for them (operators handle an exceptional request manually at the registrar). Trainers and members never see the registrar's name or cost: they see only the first-year and yearly renewal price, in USD (owner decision, 28 September 2026). Each price is the registrar's one-year USD cost (registration for the first year, renewal for the renewal; the premium price for a premium name) rounded up to the next multiple of the price step, plus the price ending; if that leaves less than the minimum margin (USD 4.00) after the registrar's cost and Stripe's estimated fees (card percentage, the international card extra, the fixed fee, Stripe Billing's fee on the subscription charge and, unless the Stripe account holds a USD balance, the currency conversion fee), it moves up one price step at a time until it does: with the defaults a USD 11.48 cost is USD 19.99, a USD 18.68 cost is USD 24.99 and a USD 14.90 cost is USD 24.99 (19.99 would leave USD 3.69). A name whose first-year or renewal price is over the price cap is never offered. A search checks the typed name and the name under every suggested ending, in the order given, in one registrar request; only the suggested endings and the other allowed endings can be bought, and protected brand names never on any ending. Registrar prices per ending are cached for 24 hours (an ending the registrar says it does not sell for an hour; a refused request, such as a client address that is not whitelisted, is never cached) and asked again at checkout and before every purchase. Stripe: a domain checkout creates a once-only coupon for a first year cheaper than the renewal, so a restricted Stripe key needs write access to Checkout Sessions, Coupons, Subscriptions and Refunds, and read access to Invoices, Payment Intents and Charges. Subdomains use PLATFORM_ROOT_DOMAIN in the server's runtime settings, not this page.",
  fields: [
    field("WEB_ADDRESS_REGISTRAR", "Registrar", "select", {
      required: true,
      defaultValue: "namecheap",
      options: [
        { value: "namecheap", label: "Namecheap" },
        { value: "101domain", label: "101domain" },
        {
          value: "generic",
          label: "Generic registrar API (Custom domains settings)",
        },
      ],
    }),
    field("REGISTRAR_101DOMAIN_API_KEY", "101domain API key", "secret", {
      help: "Created by the account's primary user (two-factor sign-in required) under Developer Tools, with the domains, DNS and finance read and write scopes. It is shown once and expires after at most a year.",
    }),
    field(
      "REGISTRAR_101DOMAIN_KEY_EXPIRES",
      "101domain API key expiry date (YYYY-MM-DD)",
      "text",
      {
        help: "The connection check warns 30 days before the key expires.",
      },
    ),
    field(
      "REGISTRAR_101DOMAIN_ORDERING",
      "101domain registration and renewal API verified",
      "boolean",
      {
        defaultValue: "false",
        help: "101domain has announced but not yet published registration and renewal in its API. Switch this on only after checking those endpoints against its live API reference; until then no domain is bought through 101domain and renewals rely on its auto-renewal.",
      },
    ),
    field("NAMECHEAP_API_USER", "Namecheap API user", "text"),
    field("NAMECHEAP_API_KEY", "Namecheap API key", "secret"),
    field("NAMECHEAP_USERNAME", "Namecheap account username", "text"),
    field("NAMECHEAP_CLIENT_IP", "Whitelisted client IPv4 address", "text", {
      help: "The public IPv4 address of this server, added to the API whitelist in the Namecheap account.",
    }),
    field(
      "NAMECHEAP_SANDBOX",
      "Use the Namecheap test environment",
      "boolean",
      {
        defaultValue: "true",
      },
    ),
    field(
      "WEB_ADDRESS_REGISTRANT_FIRST_NAME",
      "Registrant first name",
      "text",
      {
        required: true,
      },
    ),
    field("WEB_ADDRESS_REGISTRANT_LAST_NAME", "Registrant last name", "text", {
      required: true,
    }),
    field(
      "WEB_ADDRESS_REGISTRANT_ORGANIZATION",
      "Registrant organization (the platform company)",
      "text",
      {
        required: true,
        help: "The platform company always holds the domains it buys for trainers.",
      },
    ),
    field(
      "WEB_ADDRESS_REGISTRANT_ADDRESS",
      "Registrant street address",
      "text",
      {
        required: true,
      },
    ),
    field("WEB_ADDRESS_REGISTRANT_CITY", "Registrant city", "text", {
      required: true,
    }),
    field(
      "WEB_ADDRESS_REGISTRANT_STATE",
      "Registrant state or emirate",
      "text",
      {
        required: true,
      },
    ),
    field(
      "WEB_ADDRESS_REGISTRANT_POSTAL_CODE",
      "Registrant postal code",
      "text",
      {
        required: true,
      },
    ),
    field(
      "WEB_ADDRESS_REGISTRANT_COUNTRY",
      "Registrant country (two letters)",
      "text",
      {
        required: true,
      },
    ),
    field(
      "WEB_ADDRESS_REGISTRANT_PHONE",
      "Registrant phone (+971.501234567)",
      "text",
      {
        required: true,
      },
    ),
    field("WEB_ADDRESS_REGISTRANT_EMAIL", "Registrant email", "text", {
      required: true,
    }),
    field("WEB_ADDRESS_PRICE_STEP_USD", "Price step (USD)", "number", {
      defaultValue: "5.00",
      help: "The registrar's cost is rounded up to the next multiple of this amount.",
    }),
    field("WEB_ADDRESS_PRICE_ENDING_USD", "Price ending (USD)", "number", {
      defaultValue: "4.99",
      help: "Added after rounding: with a step of 5.00 and 4.99, a cost of 11.00 to 14.59 is 19.99 (from 14.60 the minimum margin below moves it to 24.99).",
    }),
    field("WEB_ADDRESS_PRICE_CAP_USD", "Highest price offered (USD)", "number", {
      defaultValue: "100.00",
      help: "Names whose first-year or yearly renewal price is over this amount are never shown.",
    }),
    field(
      "WEB_ADDRESS_MIN_MARGIN_USD",
      "Minimum margin per year after Stripe's fees (USD)",
      "number",
      {
        defaultValue: "4.00",
        help: "What each first-year and renewal price must leave after the registrar's cost and Stripe's estimated fees below. When the rounded price leaves less, it moves up one price step at a time (19.99 to 24.99) until it does. Owner decision: at least USD 4.",
      },
    ),
    field(
      "WEB_ADDRESS_STRIPE_PERCENT",
      "Stripe card fee (%)",
      "number",
      {
        defaultValue: "2.9",
        help: "Stripe's percentage per card charge (UAE standard pricing: 2.9% + AED 1.00). 0 to 15, at most two decimals. Used only to keep the minimum margin; Stripe charges its own fee.",
      },
    ),
    field(
      "WEB_ADDRESS_STRIPE_INTERNATIONAL_PERCENT",
      "Stripe extra for international cards (%)",
      "number",
      {
        defaultValue: "1.0",
        help: "Stripe adds 1% for a card issued outside the UAE. Counted for every charge so a foreign card still leaves the minimum margin; set 0 to assume UAE cards only. 0 to 15.",
      },
    ),
    field(
      "WEB_ADDRESS_STRIPE_FIXED_USD",
      "Stripe fixed fee per charge (USD)",
      "number",
      {
        defaultValue: "0.28",
        help: "Stripe's AED 1.00 per charge in US dollars (1 / 3.6725 = 0.2723, rounded up). 0 to 10.",
      },
    ),
    field(
      "WEB_ADDRESS_STRIPE_BILLING_PERCENT",
      "Stripe Billing fee (%)",
      "number",
      {
        defaultValue: "0.7",
        help: "Every domain charge is a Stripe subscription invoice (the first year and each yearly renewal), and Stripe Billing's pay-as-you-go pricing takes 0.7% of that volume (stripe.com/ae/billing/pricing). 0 to 15, at most two decimals; set 0 only on a Billing plan without a volume fee.",
      },
    ),
    field(
      "WEB_ADDRESS_STRIPE_CONVERSION_PERCENT",
      "Stripe currency conversion fee (%)",
      "number",
      {
        defaultValue: "1.0",
        help: "Trainers pay domains in USD; an account that settles in AED pays Stripe's conversion fee on each charge (1% on UAE pricing). 0 to 15. Not counted when the account holds a USD balance.",
      },
    ),
    field(
      "WEB_ADDRESS_STRIPE_USD_BALANCE",
      "Stripe account holds a USD balance",
      "boolean",
      {
        defaultValue: "false",
        help: "Turn on once a USD balance is open in the Stripe dashboard (Balances, add a currency): USD charges then stay in USD and the conversion fee is left out of the margin. Prices are recalculated for new searches and orders only.",
      },
    ),
    field("WEB_ADDRESS_TLDS", "Suggested endings, in order", "text", {
      defaultValue: "com,fit,fitness,coach,training,club,pro,app,me",
      // Earlier defaults: the endings offered before 28 September 2026, and
      // the list with .ae (removed by the owner the same day).
      supersededValues: [
        "com,net,org,co",
        "com,fit,fitness,coach,training,ae,club,pro,app,me",
      ],
      help: "Comma-separated, at most 20. A search suggests the trainer's name under each of these, available names first. Only these endings and the other allowed endings below can be bought.",
    }),
    field(
      "WEB_ADDRESS_EXTRA_TLDS",
      "Other endings sold when a trainer types them",
      "text",
      {
        help: "Optional, comma-separated, at most 20 (for example io,co). Never suggested; a trainer who types one of them can buy it within the price cap. Any ending not listed here or above is answered as not offered without asking the registrar.",
      },
    ),
    field(
      "WEB_ADDRESS_PROTECTED_LABELS",
      "Protected brand names",
      "text",
      {
        help: "Comma-separated names never sold on any ending, for example trainsyou,gymmembership. trainsyou and the platform domain's own name are always protected; a name of five or more letters is also refused inside a longer name (trainsyou-login).",
      },
    ),
    field(
      "WEB_ADDRESS_TARGET_IPV4",
      "Server IPv4 address for domain DNS",
      "text",
      {
        help: "Optional. When blank, the address the platform's own name resolves to is used.",
      },
    ),
    field(
      "WEB_ADDRESS_PURCHASES_ENABLED",
      "Enable automatic purchases and renewals",
      "boolean",
      { defaultValue: "false" },
    ),
  ],
});

/** DNS hosting for bought trainer domains and the platform root domain. */
INTEGRATION_CATALOG.push({
  id: "dns_hosting",
  name: "DNS hosting",
  category: "branding",
  implemented: true,
  description:
    "DNS zones for bought trainer domains and the platform root domain, set up automatically.",
  setupNotes:
    "With DigitalOcean DNS, every bought domain gets its own zone with A records for the domain and www (never a wildcard), and its nameservers are then pointed at ns1, ns2 and ns3.digitalocean.com; without it, the registrar's own DNS holds the records. The connection check lists at most one domain of the account and says how many zones the token can reach: a DigitalOcean token reaches every domain of its team, so a dedicated team for the platform's domains is recommended. The platform only ever changes the zone of a domain it bought and confirmed, and the platform root zone below; a zone is kept after a domain lapses and deleted only once nothing delegates the name to DigitalOcean any more, so no other account can take it over. Token scopes needed: domain create, read, update and delete. Credentials stay in these encrypted settings, never in the repository.",
  fields: [
    field("DNS_PROVIDER", "DNS provider", "select", {
      required: true,
      defaultValue: "registrar",
      options: [
        { value: "registrar", label: "The registrar's own DNS" },
        { value: "digitalocean", label: "DigitalOcean DNS" },
      ],
    }),
    field("DIGITALOCEAN_DNS_TOKEN", "DigitalOcean API token", "secret", {
      help: "A personal access token with the domain scopes (create, read, update, delete).",
    }),
    field(
      "DIGITALOCEAN_DNS_TOKEN_EXPIRES",
      "Token expiry date (YYYY-MM-DD)",
      "text",
      { help: "Optional. The connection check warns 30 days before." },
    ),
    field("DNS_PLATFORM_ZONE", "Platform root zone", "text", {
      help: "The platform's own domain (for example trainsyou.com) whose A records Check and repair platform DNS may create: @, www and *. Only this zone and PLATFORM_ROOT_DOMAIN are ever changed there. A zone that is neither PLATFORM_ROOT_DOMAIN nor the domain of the public app address (a new root prepared before the address change) is repaired only while its @, www and * names point nowhere else.",
    }),
    field("DNS_RECORD_TTL", "Record TTL (seconds)", "number", {
      defaultValue: "1800",
    }),
  ],
});

/** DigitalOcean billing for the platform's server costs (platform finance phase D). */
INTEGRATION_CATALOG.push({
  id: "digitalocean_billing",
  name: "DigitalOcean billing",
  category: "platform",
  implemented: true,
  description:
    "Imports the platform's server costs from DigitalOcean into Platform finance, once a day.",
  setupNotes:
    "Read-only: the import only reads invoices, projects, their resources and droplet and volume sizes; it never creates, changes or deletes anything at DigitalOcean. A DigitalOcean token reaches its whole team, and other projects may share the bill, so only invoice items of the project named here become platform costs. DigitalOcean splits costs by project only on final monthly invoices, so the current month is an estimate from that project's resources (droplets hourly up to their monthly price, backups +20%, volumes USD 0.10 per GiB-month) until its invoice arrives. The token needs read access to billing, projects, droplets and volumes (the owner approved using the existing token on 28 September 2026). Credentials stay in these encrypted settings, never in the repository.",
  fields: [
    field("DO_BILLING_TOKEN", "DigitalOcean API token (read)", "secret", {
      required: true,
      help: "A personal access token that can read billing, projects, droplets and volumes.",
    }),
    field("DO_BILLING_PROJECT", "Project to import", "text", {
      defaultValue: "GymMembership",
      help: "Only invoice items and resources of this DigitalOcean project count as platform costs.",
    }),
    field(
      "DO_BILLING_IMPORT_ENABLED",
      "Import daily",
      "boolean",
      {
        defaultValue: "true",
        help: "The worker imports once a day; Platform finance → Platform costs → Import now runs it at once.",
      },
    ),
  ],
});

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}
export function integrationDefinition(id: string): IntegrationDefinition {
  const definition = INTEGRATION_CATALOG.find((entry) => entry.id === id);
  if (!definition) throw new ConfigurationError("Unknown integration");
  return definition;
}
export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(ip) === 6) {
    const [first, second = "0"] = ip.toLowerCase().split(":");
    const prefix = parseInt(first, 16),
      subnet = parseInt(second || "0", 16);
    return (
      prefix >= 0x2000 &&
      prefix <= 0x3fff &&
      prefix !== 0x2002 &&
      !(prefix === 0x2001 && (subnet < 0x200 || subnet === 0xdb8))
    );
  }
  return false;
}
function endpointUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError("Use a valid HTTPS endpoint");
  }
  // Local mock-provider sandbox only (see sandbox.ts): HTTPS loopback mocks.
  if (sandboxAllowsEndpoint(url)) return url;
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    host === "localhost" ||
    /\.(localhost|local|internal)$/.test(host) ||
    (!isIP(host) && !host.includes(".")) ||
    (isIP(host) && !isPublicAddress(host))
  )
    throw new ConfigurationError(
      "Use a public HTTPS endpoint without credentials or a fragment",
    );
  return url;
}
/**
 * Whole-number settings whose runtime reader only honours this range. Saving
 * an out-of-range value is refused so the value shown is the value in force.
 */
export const INTEGER_SETTING_RANGES: Record<string, readonly [number, number]> =
  {
    FOLLOWER_INVITE_EMAILS_PER_DAY: [0, 10000],
    FOLLOWER_INVITE_EMAILS_PER_ADDRESS: [1, 20],
    FOLLOWER_INVITE_EMAILS_PLATFORM_PER_DAY: [0, 100000],
    COMPLIMENTARY_ACCESS_MAX_DAYS: [1, 3650],
    COMPLIMENTARY_ACCESS_MAX_ACTIVE: [0, 100000],
    VOICE_PRO_CLONE_SLOTS: [0, 100],
    DNS_RECORD_TTL: [30, 86400],
  };
/** A YYYY-MM-DD calendar date. */
function calendarDate(text: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(text + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}
/** Days until a YYYY-MM-DD expiry (negative once passed), or null. */
export function daysUntil(date: string | undefined, now = Date.now()) {
  const text = date?.trim() ?? "";
  if (!calendarDate(text)) return null;
  return Math.floor((Date.parse(text + "T00:00:00Z") - now) / 86400000);
}
export function validateIntegrationValues(
  id: string,
  values: Record<string, unknown>,
): Record<string, string> {
  const definition = integrationDefinition(id),
    result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const entry = definition.fields.find((item) => item.key === key);
    if (!entry)
      throw new ConfigurationError(
        "The integration contains an unknown setting",
      );
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    )
      throw new ConfigurationError(`${entry.label} must have a single value`);
    const text = String(value).trim();
    if (
      text.length > (entry.type === "secret" ? 16000 : 2000) ||
      /[\u0000-\u001f\u007f]/.test(text)
    )
      throw new ConfigurationError(
        `${entry.label} contains unsupported characters or is too long`,
      );
    if (text) {
      if (entry.type === "boolean" && text !== "true" && text !== "false")
        throw new ConfigurationError(`${entry.label} must be true or false`);
      if (
        entry.type === "number" &&
        (!Number.isFinite(Number(text)) ||
          Number(text) < 0 ||
          Number(text) > 1000000)
      )
        throw new ConfigurationError(
          `${entry.label} must be a nonnegative number up to 1000000`,
        );
      const range = INTEGER_SETTING_RANGES[key];
      if (
        range &&
        (!Number.isInteger(Number(text)) ||
          Number(text) < range[0] ||
          Number(text) > range[1])
      )
        throw new ConfigurationError(
          `${entry.label} must be a whole number from ${range[0]} to ${range[1]}`,
        );
      if (
        (key === "MODEL_MAX_DAILY_CALLS" ||
          key === "MODEL_MAX_DAILY_CALLS_PER_SUBSCRIBER") &&
        (!Number.isInteger(Number(text)) ||
          Number(text) < 1 ||
          Number(text) > 10000)
      )
        throw new ConfigurationError(
          "Maximum daily calls must be an integer from 1 to 10000",
        );
      if (entry.type === "url") {
        const url = endpointUrl(text);
        if (url.search)
          throw new ConfigurationError(
            `${entry.label} must not include a query or unsupported path`,
          );
      }
      if (
        entry.type === "select" &&
        !entry.options?.some((option) => option.value === text)
      )
        throw new ConfigurationError(
          `${entry.label} has an unsupported selection`,
        );
      if (
        (key === "NAMECHEAP_CLIENT_IP" || key === "WEB_ADDRESS_TARGET_IPV4") &&
        (isIP(text) !== 4 || !isPublicAddress(text))
      )
        throw new ConfigurationError(
          `${entry.label} must be a public IPv4 address`,
        );
      if (
        key === "WEB_ADDRESS_REGISTRANT_COUNTRY" &&
        !/^[A-Za-z]{2}$/.test(text)
      )
        throw new ConfigurationError(`${entry.label} must be two letters`);
      if (
        key === "WEB_ADDRESS_REGISTRANT_PHONE" &&
        !/^\+\d{1,3}\.\d{4,14}$/.test(text)
      )
        throw new ConfigurationError(
          `${entry.label} must look like +971.501234567`,
        );
      if (
        key === "WEB_ADDRESS_REGISTRANT_EMAIL" &&
        !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(text)
      )
        throw new ConfigurationError(`${entry.label} must be an email address`);
      if (
        (key === "WEB_ADDRESS_TLDS" || key === "WEB_ADDRESS_EXTRA_TLDS") &&
        !/^\s*\.?[a-z]{2,63}(\.[a-z]{2,63})?(\s*,\s*\.?[a-z]{2,63}(\.[a-z]{2,63})?){0,19}\s*$/i.test(
          text,
        )
      )
        throw new ConfigurationError(
          `${entry.label} must be up to 20 comma-separated endings such as com,fit`,
        );
      if (
        key === "WEB_ADDRESS_PROTECTED_LABELS" &&
        !/^\s*[a-z0-9-]{2,63}(\s*,\s*[a-z0-9-]{2,63}){0,49}\s*$/i.test(text)
      )
        throw new ConfigurationError(
          `${entry.label} must be up to 50 comma-separated names such as trainsyou`,
        );
      // Whole cents: at most two decimals, never rounded.
      const cents = /^\d{1,7}(\.\d{1,2})?$/.test(text)
        ? Math.round(Number(text) * 100)
        : NaN;
      if (
        key === "WEB_ADDRESS_PRICE_STEP_USD" &&
        !(cents >= 1 && cents <= 100000)
      )
        throw new ConfigurationError(
          `${entry.label} must be from 0.01 to 1000 with at most two decimals`,
        );
      if (
        key === "WEB_ADDRESS_PRICE_ENDING_USD" &&
        !(cents >= 0 && cents <= 100000)
      )
        throw new ConfigurationError(
          `${entry.label} must be from 0 to 1000 with at most two decimals`,
        );
      if (
        key === "WEB_ADDRESS_PRICE_CAP_USD" &&
        !(cents >= 1 && cents <= 100000)
      )
        throw new ConfigurationError(
          `${entry.label} must be from 0.01 to 1000 with at most two decimals`,
        );
      if (
        key === "WEB_ADDRESS_MIN_MARGIN_USD" &&
        !(cents >= 0 && cents <= 100000)
      )
        throw new ConfigurationError(
          `${entry.label} must be from 0 to 1000 with at most two decimals`,
        );
      if (
        key === "WEB_ADDRESS_STRIPE_FIXED_USD" &&
        !(cents >= 0 && cents <= 1000)
      )
        throw new ConfigurationError(
          `${entry.label} must be from 0 to 10 with at most two decimals`,
        );
      if (
        (key === "WEB_ADDRESS_STRIPE_PERCENT" ||
          key === "WEB_ADDRESS_STRIPE_INTERNATIONAL_PERCENT" ||
          key === "WEB_ADDRESS_STRIPE_BILLING_PERCENT" ||
          key === "WEB_ADDRESS_STRIPE_CONVERSION_PERCENT") &&
        !(
          /^\d{1,2}(\.\d{1,2})?$/.test(text) &&
          Number(text) >= 0 &&
          Number(text) <= 15
        )
      )
        throw new ConfigurationError(
          `${entry.label} must be a percentage from 0 to 15 with at most two decimals`,
        );
      if (
        key === "FINANCE_USD_TO_AED" &&
        !(Number(text) >= 1 && Number(text) <= 10)
      )
        throw new ConfigurationError(`${entry.label} must be between 1 and 10`);
      if (
        key === "FINANCE_USAGE_MARKUP_PERCENT" &&
        !(Number(text) >= 0 && Number(text) <= 1000)
      )
        throw new ConfigurationError(`${entry.label} must be from 0 to 1000`);
      if (
        (key === "FINANCE_STRIPE_FEE_PERCENT" ||
          key === "FINANCE_STRIPE_INTERNATIONAL_PERCENT") &&
        !(/^\d{1,2}(\.\d{1,3})?$/.test(text) && Number(text) <= 20)
      )
        throw new ConfigurationError(
          `${entry.label} must be from 0 to 20 with at most three decimals`,
        );
      if (key === "DO_BILLING_PROJECT" && !(text.length >= 1 && text.length <= 175))
        throw new ConfigurationError(`${entry.label} must be a DigitalOcean project name (1 to 175 characters)`);
      if (
        key === "FINANCE_REGISTRAR_LOW_BALANCE_USD" &&
        !(/^\d{1,6}(\.\d{1,2})?$/.test(text) && Number(text) <= 100000)
      )
        throw new ConfigurationError(`${entry.label} must be from 0 to 100000 US dollars`);
      if (
        key === "FINANCE_UNPRICED_ALERT_DAYS" &&
        !(/^\d{1,2}$/.test(text) && Number(text) >= 1 && Number(text) <= 90)
      )
        throw new ConfigurationError(`${entry.label} must be a whole number of days from 1 to 90`);
      if (
        key === "FINANCE_EMAIL_USD_PER_MESSAGE" &&
        !(/^\d(\.\d{1,6})?$/.test(text) && Number(text) <= 1)
      )
        throw new ConfigurationError(
          `${entry.label} must be from 0 to 1 with at most six decimals`,
        );
      if (
        key === "FINANCE_STRIPE_FEE_FIXED_AED" &&
        !(/^\d{1,2}(\.\d{1,2})?$/.test(text) && Number(text) <= 20)
      )
        throw new ConfigurationError(
          `${entry.label} must be from 0 to 20 with at most two decimals`,
        );
      if (
        key === "MODEL_PROVIDER" &&
        !/^[a-z0-9][a-z0-9._-]{0,59}$/.test(text.toLowerCase())
      )
        throw new ConfigurationError(
          `${entry.label} must be a short name such as openai`,
        );
      if (
        (key === "VOICE_API_VERSION" || key === "STT_API_VERSION") &&
        !/^\d{4}-\d{2}-\d{2}$/.test(text)
      )
        throw new ConfigurationError(
          `${entry.label} must be a date such as 2026-08-14`,
        );
      if (
        (key === "VOICE_MODEL" || key === "STT_MODEL") &&
        !/^[A-Za-z0-9._-]{1,80}$/.test(text)
      )
        throw new ConfigurationError(
          `${entry.label} must be a provider model ID such as sonic-3.6`,
        );
      if (
        (key === "VOICE_CLONE_USD" || key === "VOICE_PRO_CLONE_PRICE_AED") &&
        Number(text) > 10000
      )
        throw new ConfigurationError(`${entry.label} must be at most 10000`);
      if (
        (key === "DIGITALOCEAN_DNS_TOKEN_EXPIRES" ||
          key === "REGISTRAR_101DOMAIN_KEY_EXPIRES") &&
        !calendarDate(text)
      )
        throw new ConfigurationError(`${entry.label} must be a date such as 2027-09-28`);
      if (
        key === "DNS_PLATFORM_ZONE" &&
        !/^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/i.test(
          text.replace(/\.$/, ""),
        )
      )
        throw new ConfigurationError(
          `${entry.label} must be a plain domain name such as trainsyou.com`,
        );
      if (
        /^FOLLOWER_(STORY_|CLICK_|DM_OPEN_|BROADCAST_CLICK_|BIO_CLICK_|PAID_|ENGAGEMENT_BENCHMARK)/.test(
          key,
        ) &&
        Number(text) > 100
      )
        throw new ConfigurationError(`${entry.label} must be a percentage from 0 to 100`);
      if (/^FOLLOWER_RENEWAL_/.test(key) && Number(text) > 50)
        throw new ConfigurationError(`${entry.label} must be a percentage from 0 to 50`);
      if (
        key === "FOLLOWER_ENGAGEMENT_FACTOR_MAX" &&
        (Number(text) < 1 || Number(text) > 10)
      )
        throw new ConfigurationError(`${entry.label} must be from 1 to 10`);
      if (
        (key === "SUPPORT_EMAIL" || key === "EMAIL_FROM") &&
        !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(text)
      )
        throw new ConfigurationError(`${entry.label} must be an email address`);
    }
    result[key] = text;
  }
  return result;
}

type ResolvedAddress = { address: string; family: number };
export async function validatePublicEndpoint(
  value: string,
  resolver: (hostname: string) => Promise<ResolvedAddress[]> = (hostname) =>
    lookup(hostname, { all: true, verbatim: true }),
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  const url = endpointUrl(value),
    hostname = url.hostname.replace(/^\[|\]$/g, "");
  // Sandbox mocks listen on loopback; this is unreachable outside the sandbox.
  if (sandboxAllowsEndpoint(url) && isLoopbackHostname(hostname))
    return {
      url,
      addresses: [
        hostname === "::1"
          ? { address: "::1", family: 6 }
          : { address: "127.0.0.1", family: 4 },
      ],
    };
  // Sandbox only: a name the loopback DNS double answers with loopback
  // addresses (a simulated coach domain served by the local TLS edge).
  const sandboxDns = isIP(hostname) ? null : sandboxResolver();
  if (sandboxDns) {
    const answers = await sandboxDns.resolve4(hostname).catch(() => []);
    if (answers.length && answers.every(isSandboxLoopbackAddress))
      return {
        url,
        addresses: answers.map((address) => ({ address, family: 4 })),
      };
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await Promise.race([
          resolver(hostname),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(new ConfigurationError("Endpoint DNS lookup timed out")),
              5000,
            );
          }),
        ]);
    if (
      !addresses.length ||
      addresses.some((record) => !isPublicAddress(record.address))
    )
      throw new ConfigurationError(
        "Endpoint must resolve exclusively to public network addresses",
      );
    return { url, addresses };
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError("Endpoint DNS could not be verified");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const initialFetch = globalThis.fetch;
// Tests explicitly replace fetch and use reserved fixture domains. Never permit the
// fixture transport outside the Node test runner, in production, or for real hosts.
function fixtureTransport(url: URL): boolean {
  return (
    !!process.env.NODE_TEST_CONTEXT &&
    process.env.NODE_ENV !== "production" &&
    globalThis.fetch !== initialFetch &&
    /\.(test|invalid)$/.test(url.hostname)
  );
}
export async function providerRequest(
  value: string,
  init: RequestInit = {},
  beforeSend?: () => Promise<void>,
): Promise<Response> {
  const parsed = endpointUrl(value);
  if (fixtureTransport(parsed)) {
    await beforeSend?.();
    const response = await fetch(value, { ...init, redirect: "error" });
    if (
      (response.status >= 300 && response.status < 400) ||
      response.redirected
    )
      throw new ConfigurationError("Provider redirects are not accepted");
    return response;
  }
  const { url, addresses } = await validatePublicEndpoint(value);
  const address = addresses[0];
  await beforeSend?.();
  return new Promise((resolve, reject) => {
    const signal = init.signal ?? AbortSignal.timeout(30000);
    const req = httpsRequest(
      url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        signal,
        // Pin the address validated above; a second DNS answer cannot redirect a
        // credential-bearing request onto a private network.
        lookup: (_hostname, options, callback) => {
          if (typeof options === "object" && options?.all)
            callback(null, [address] as any);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        const status = response.statusCode ?? 502;
        if (status >= 300 && status < 400) {
          response.destroy();
          reject(new ConfigurationError("Provider redirects are not accepted"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) {
            response.destroy();
            reject(
              new ConfigurationError(
                "Provider response exceeded the allowed size",
              ),
            );
          } else chunks.push(chunk);
        });
        response.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          resolve(
            new Response(
              status === 204 || status === 304 ? null : Buffer.concat(chunks),
              { status, headers },
            ),
          );
        });
        response.on("error", () =>
          reject(new ConfigurationError("Provider response could not be read")),
        );
      },
    );
    req.on("error", () =>
      reject(new ConfigurationError("Provider could not be reached")),
    );
    if (init.body !== undefined && init.body !== null) {
      if (
        typeof init.body !== "string" &&
        !(init.body instanceof Uint8Array)
      ) {
        req.destroy();
        reject(new ConfigurationError("Unsupported provider request body"));
        return;
      }
      req.write(init.body);
    }
    req.end();
  });
}

export type IntegrationTestResult = {
  status: "verified" | "validated" | "unavailable" | "failed";
  message: string;
  checkedAt: string;
  details?: Record<string, string | number | boolean>;
};
/** A saved address, or the provider's standard one (see voiceBaseUrl). */
function providerAddress(provider: "elevenlabs" | "cartesia", saved: string) {
  const value = (saved ?? "").trim().replace(/\/$/, "");
  return !value || VOICE_PROVIDER_ADDRESSES.includes(value)
    ? VOICE_PROVIDER_ADDRESSES[provider === "elevenlabs" ? 0 : 1]
    : value;
}
/** Read-only Cartesia check: GET /voices?limit=1 with the saved key and version. */
async function cartesiaAccountCheck(
  base: string,
  key: string,
  version: string,
  checkedAt: string,
  message: string,
): Promise<IntegrationTestResult> {
  const response = await providerRequest(
    providerAddress("cartesia", base) + "/voices?limit=1",
    {
      headers: {
        Authorization: `Bearer ${key}`,
        "Cartesia-Version": version || "2026-08-14",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    return {
      status: "failed",
      message: `Cartesia rejected the account check (HTTP ${response.status}). Check the key, its permissions and the API version.`,
      checkedAt,
    };
  const body = (await response.json().catch(() => null)) as any;
  if (!Array.isArray(body?.data))
    throw new ConfigurationError("Cartesia returned an unexpected voice list");
  return {
    status: "verified",
    message,
    checkedAt,
    details: { provider: "cartesia", apiVersion: version || "2026-08-14" },
  };
}
/**
 * Integrations whose connection check is a read-only provider request meant to
 * run before purchases are approved (web addresses: the registrar balance), so
 * the API access and IP whitelist can be proven first.
 */
export const READ_ONLY_CHECK_BEFORE_APPROVAL: ReadonlySet<string> = new Set([
  "web_addresses",
]);
export async function testIntegration(
  id: string,
  config: RuntimeConfig,
): Promise<IntegrationTestResult> {
  const checkedAt = new Date().toISOString();
  try {
    const definition = integrationDefinition(id);
    if (!definition.implemented)
      return {
        status: "unavailable",
        message:
          "Credentials may be saved, but this integration has no working adapter yet.",
        checkedAt,
      };
    const contractFlags: Record<string, string> = {
      whoop: "WHOOP_CONTRACT_VERIFIED",
      zepp: "ZEPP_CONTRACT_VERIFIED",
      voice: "VOICE_CONTRACT_VERIFIED",
      speech_to_text: "STT_CONTRACT_VERIFIED",
      domains: "DOMAIN_OPERATIONS_ENABLED",
      instagram: "INSTAGRAM_APP_REVIEW_APPROVED",
    };
    if (contractFlags[id] && config[contractFlags[id]] !== "true")
      return {
        status: "unavailable",
        message:
          "The adapter is implemented but its account contract or operating approval is not recorded. No provider request was sent.",
        checkedAt,
      };
    const fields = Object.fromEntries(
      definition.fields.map((entry) => [
        entry.key,
        config[entry.key] ?? entry.defaultValue ?? "",
      ]),
    );
    validateIntegrationValues(id, fields);
    // The registrar check reads the balance only, so the registrant contact
    // (needed for purchases) does not block proving the API access first.
    const readOnlyBeforeApproval = READ_ONLY_CHECK_BEFORE_APPROVAL.has(id);
    const missing = definition.fields.filter(
      (entry) =>
        entry.required &&
        !fields[entry.key] &&
        !(readOnlyBeforeApproval && entry.key.startsWith("WEB_ADDRESS_REGISTRANT_")),
    );
    const registrantMissing = readOnlyBeforeApproval
      ? definition.fields.some(
          (entry) =>
            entry.required &&
            entry.key.startsWith("WEB_ADDRESS_REGISTRANT_") &&
            !fields[entry.key],
        )
      : false;
    const purchaseNote = registrantMissing
      ? " Purchases also need the registrant details and the purchases switch."
      : "";
    if (missing.length)
      return {
        status: "failed",
        message: `Required settings are missing: ${missing.map((entry) => entry.label).join(", ")}.`,
        checkedAt,
      };
    if (id === "web_addresses") {
      // Read-only: the account balance. Works before purchases are enabled so
      // the API access and the IP whitelist can be proven first.
      const registrar = (fields.WEB_ADDRESS_REGISTRAR || "namecheap").trim();
      const {
        NamecheapRegistrar,
        namecheapSettings,
        RegistrarError,
        paymentModeProblem,
        registrarSandboxSetting,
        stripeKeyMode,
      } = await import("./registrar.ts");
      // Stripe's mode must match the registrar environment: purchases are
      // refused otherwise, and this check says so.
      const stripeMode = stripeKeyMode(config);
      const modeProblem = stripeMode
        ? paymentModeProblem(
            stripeMode === "live",
            registrarSandboxSetting({ ...config, ...fields }),
          )
        : null;
      const modeNote = modeProblem
        ? ` Purchases are refused: Stripe uses ${stripeMode} keys and the registrar uses its ${stripeMode === "live" ? "test" : "live"} environment. ${modeProblem}`
        : "";
      if (registrar === "101domain") {
        const { OneOhOneRegistrar, registrarPurchaseProblem } = await import(
          "./registrar.ts"
        );
        if (!fields.REGISTRAR_101DOMAIN_API_KEY?.trim())
          return {
            status: "failed",
            message: "101domain needs its API key.",
            checkedAt,
          };
        const expiresIn = daysUntil(fields.REGISTRAR_101DOMAIN_KEY_EXPIRES);
        if (expiresIn !== null && expiresIn < 0)
          return {
            status: "failed",
            message:
              "The 101domain API key expired; create a new key and save it here.",
            checkedAt,
          };
        try {
          // Read-only: the account balance. Nothing is bought.
          const balance = await new OneOhOneRegistrar(
            fields.REGISTRAR_101DOMAIN_API_KEY.trim(),
          ).balance();
          const ordering = registrarPurchaseProblem({ ...config, ...fields });
          return {
            status: "verified",
            message:
              "101domain API access verified with a balance read. No domain was bought." +
              (ordering ? " " + ordering : "") +
              (expiresIn !== null && expiresIn <= 30
                ? ` The API key expires in ${expiresIn} day${expiresIn === 1 ? "" : "s"}; create a new one before then.`
                : "") +
              modeNote,
            checkedAt,
            details: {
              currency: balance.currency,
              availableBalance: balance.available,
              ordering: !ordering,
              paymentMode: stripeMode ?? "unknown",
              modeMismatch: !!modeProblem,
            },
          };
        } catch (error) {
          return {
            status: "failed",
            message:
              error instanceof RegistrarError && error.outcome === "definitive"
                ? `101domain refused the check: ${error.message}. Check the key, its finance read scope and its expiry.`
                : "101domain could not be reached. No domain was bought.",
            checkedAt,
          };
        }
      }
      if (registrar !== "namecheap")
        return {
          status: "validated",
          message:
            "The generic registrar uses the Custom domains API URL and key; its account is read on the first search. No domain was bought." +
            modeNote,
          checkedAt,
          details: {
            paymentMode: stripeMode ?? "unknown",
            modeMismatch: !!modeProblem,
          },
        };
      const settings = namecheapSettings(fields);
      try {
        const balance = await new NamecheapRegistrar(settings).balance();
        return {
          status: "verified",
          message:
            "Namecheap API access verified from the whitelisted address. No domain was bought." +
            purchaseNote +
            (Number(balance.available) < 20
              ? " The available balance is low: purchases and renewals are paid from it."
              : "") +
            modeNote,
          checkedAt,
          details: {
            environment: settings.sandbox ? "sandbox" : "production",
            currency: balance.currency,
            availableBalance: balance.available,
            paymentMode: stripeMode ?? "unknown",
            modeMismatch: !!modeProblem,
          },
        };
      } catch (error) {
        return {
          status: "failed",
          message:
            error instanceof RegistrarError && error.outcome === "definitive"
              ? `Namecheap refused the check: ${error.message}. Check the API user, key, username and that this server's IPv4 address is whitelisted.`
              : "Namecheap could not be reached. No domain was bought.",
          checkedAt,
        };
      }
    }
    if (id === "digitalocean_billing") {
      const { DigitalOceanBilling } = await import("./digitalocean-billing.ts");
      try {
        // Read-only: lists the team's projects and finds the configured one.
        const client = new DigitalOceanBilling(fields.DO_BILLING_TOKEN);
        const projects = await client.projects();
        const name = (fields.DO_BILLING_PROJECT || "GymMembership").trim().toLowerCase();
        const found = projects.some((p) => p.name.trim().toLowerCase() === name);
        return {
          status: found ? "verified" : "failed",
          message: found
            ? `DigitalOcean billing access verified; the project was found among ${projects.length} project${projects.length === 1 ? "" : "s"} of the team. Only its invoice items and resources are imported.`
            : "The token works, but no project with this name was found in its team.",
          checkedAt,
          details: { projectsVisible: projects.length, projectFound: found },
        };
      } catch (error) {
        return {
          status: "failed",
          message: `DigitalOcean billing could not be read: ${(error as Error).message}`.slice(0, 300),
          checkedAt,
        };
      }
    }
    if (id === "dns_hosting") {
      if ((fields.DNS_PROVIDER || "registrar").trim() !== "digitalocean")
        return {
          status: "validated",
          message:
            "Bought domains use the registrar's own DNS; there is no DNS host to check.",
          checkedAt,
        };
      const expiresIn = daysUntil(fields.DIGITALOCEAN_DNS_TOKEN_EXPIRES);
      if (expiresIn !== null && expiresIn < 0)
        return {
          status: "failed",
          message:
            "The DigitalOcean token expired; create a new token and save it here.",
          checkedAt,
        };
      const { DigitalOceanDns, DnsError } = await import("./dns-hosting.ts");
      try {
        // Read-only: lists at most one domain of the account and reads the
        // number of zones the token reaches. No zone or record changes.
        const zones = await new DigitalOceanDns(fields.DIGITALOCEAN_DNS_TOKEN, {
          mayManage: () => false,
        }).accountZoneCount();
        return {
          status: "verified",
          message:
            `DigitalOcean DNS access verified; the token reaches ${zones} zone${zones === 1 ? "" : "s"}. The platform only ever changes zones of domains it bought and the platform root zone.` +
            (zones > 1
              ? " A DigitalOcean token reaches every domain of its team: keep the platform's domains in a dedicated team so this token cannot reach anything else."
              : "") +
            (expiresIn !== null && expiresIn <= 30
              ? ` The token expires in ${expiresIn} day${expiresIn === 1 ? "" : "s"}; create a new one before then.`
              : ""),
          checkedAt,
          details: { zonesVisible: zones },
        };
      } catch (error) {
        return {
          status: "failed",
          message:
            error instanceof DnsError && error.outcome === "definitive"
              ? `DigitalOcean refused the check: ${error.message}. Check the token and its domain read scope.`
              : "DigitalOcean could not be reached. Nothing was changed.",
          checkedAt,
        };
      }
    }
    if (id === "google_signin" || id === "apple_signin") {
      const { checkOidcConnection } = await import("./oidc.ts");
      return await checkOidcConnection(
        id === "google_signin" ? "google" : "apple",
        config,
      );
    }
    if (id === "push") {
      const { pushConfiguration } = await import("./push.ts");
      pushConfiguration(config);
      return {
        status: "validated",
        message:
          "VAPID key pair and contact validated. No notification was sent; HTTPS, device permission and actual delivery require a separate check.",
        checkedAt,
      };
    }
    if (
      id === "whoop" ||
      id === "zepp" ||
      id === "voice" ||
      id === "domains" ||
      id === "instagram"
    ) {
      if (
        id === "zepp" &&
        fields.ZEPP_ADAPTER_CONTRACT !== "canonical-observations-v1"
      )
        throw new ConfigurationError(
          "The reviewed Zepp partner adapter contract must be canonical-observations-v1.",
        );
      if (
        id === "voice" &&
        (!IMPLEMENTED_VOICE_PROVIDERS.includes(fields.VOICE_PROVIDER) ||
          Number(fields.VOICE_DAILY_USD_LIMIT) <= 0)
      )
        throw new ConfigurationError(
          "Choose ElevenLabs or Cartesia and set a positive daily cost limit.",
        );
      if (id === "voice" && fields.VOICE_PROVIDER === "cartesia")
        return cartesiaAccountCheck(
          fields.VOICE_BASE_URL,
          fields.VOICE_API_KEY,
          fields.VOICE_API_VERSION,
          checkedAt,
          "Cartesia access verified by reading one voice; no audio was made and no clone was created.",
        );
      return {
        status: "validated",
        message:
          "Configuration and recorded approval validated without an external request. User authorization, device behavior, provider account capabilities and end-to-end delivery remain separate qualification checks.",
        checkedAt,
      };
    }
    if (id === "speech_to_text") {
      if (!IMPLEMENTED_VOICE_PROVIDERS.includes(fields.STT_PROVIDER))
        throw new ConfigurationError(
          "Choose the ElevenLabs or Cartesia speech-to-text provider.",
        );
      if (
        fields.STT_PROVIDER === "cartesia" &&
        fields.STT_ZERO_RETENTION === "true"
      )
        return {
          status: "unavailable",
          message:
            "Cartesia zero retention is an Enterprise account setting the app cannot request. Turn off Request zero retention to use Cartesia; members are told the provider's own retention applies. No provider request was sent.",
          checkedAt,
        };
      if (fields.STT_PROVIDER === "cartesia")
        return cartesiaAccountCheck(
          fields.STT_BASE_URL,
          fields.STT_API_KEY,
          fields.STT_API_VERSION,
          checkedAt,
          "Cartesia access verified by reading one voice; no audio was sent. Transcription quality needs a separate check with consenting testers.",
        );
      // Read-only: the model list proves the key and base URL; no audio is sent.
      const response = await providerRequest(
        providerAddress("elevenlabs", fields.STT_BASE_URL) + "/models",
        {
          headers: {
            "xi-api-key": fields.STT_API_KEY,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        return {
          status: "failed",
          message: `The speech provider rejected the account check (HTTP ${response.status}). Check the base URL and key permissions.`,
          checkedAt,
        };
      const models = (await response.json().catch(() => null)) as any;
      if (!Array.isArray(models))
        throw new ConfigurationError(
          "The speech provider returned an unexpected model list",
        );
      return {
        status: "verified",
        message:
          "Speech provider access verified without sending audio. Transcription quality, languages and zero retention need a separate check with consenting testers.",
        checkedAt,
        details: { models: models.length },
      };
    }
    if (id === "stripe") {
      const response = await providerRequest(
        new URL(
          "/v1/account",
          sandboxOverride("STRIPE_API_BASE_URL") ?? "https://api.stripe.com",
        ).toString(),
        {
          headers: { Authorization: `Bearer ${fields.STRIPE_SECRET_KEY}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        return {
          status: "failed",
          message: `Stripe rejected the account check (HTTP ${response.status}).`,
          checkedAt,
        };
      const account = (await response.json()) as any;
      if (typeof account.id !== "string" || !account.id.startsWith("acct_"))
        throw new ConfigurationError(
          "Stripe returned an unexpected account response",
        );
      return {
        status: "verified",
        message:
          "Stripe account access verified. Webhook delivery, price mappings and financial approval remain separate checks.",
        checkedAt,
        details: {
          accountId: account.id,
          chargesEnabled: account.charges_enabled === true,
          payoutsEnabled: account.payouts_enabled === true,
        },
      };
    }
    if (id === "model") {
      const response = await providerRequest(
        fields.MODEL_BASE_URL.replace(/\/$/, "") + "/models",
        {
          headers: { Authorization: `Bearer ${fields.MODEL_API_KEY}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        return {
          status: "failed",
          message: `Model-list access was rejected (HTTP ${response.status}). Check the base URL, key and model-list permission.`,
          checkedAt,
        };
      const payload = (await response.json()) as any;
      if (
        !Array.isArray(payload.data) ||
        !payload.data.some((item: any) => item?.id === fields.MODEL_NAME)
      )
        return {
          status: "failed",
          message:
            "The selected model was not present in the provider model list. No generation was attempted.",
          checkedAt,
        };
      return {
        status: "verified",
        message:
          "API access and selected model verified without generating content. Coach evaluations must verify output quality separately.",
        checkedAt,
        details: { model: fields.MODEL_NAME },
      };
    }
    if (id === "email" || id === "lean") {
      await validatePublicEndpoint(
        fields[id === "email" ? "EMAIL_API_URL" : "LEAN_BASE_URL"],
      );
      return {
        status: "validated",
        message:
          id === "email"
            ? "Settings and public endpoint validated. No email was sent; sender verification and delivery are not tested."
            : "Settings and public endpoint validated. Bank access, account contract and recipient eligibility remain unverified. No bank instruction was sent.",
        checkedAt,
      };
    }
    return {
      status: "validated",
      message:
        id === "apple"
          ? "Manual file import requires no API connection. Import approval and subscriber consent still apply; automatic sync also needs the companion app and its switch."
          : "Application settings are valid. Approval controls represent your recorded review decision.",
      checkedAt,
    };
  } catch (error) {
    return {
      status: "failed",
      message:
        error instanceof ConfigurationError
          ? error.message
          : "Connection test could not complete. No transaction or message was sent.",
      checkedAt,
    };
  }
}
