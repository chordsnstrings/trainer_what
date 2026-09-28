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
      "Every figure is shown with its source on /methodology and with each estimate. Change the assumptions version whenever you change a value, and give the reason and source: a value that differs from its cited default is marked on /methodology as adjusted by the operator, with your note. An inconsistent set (a low above its high) is ignored and the cited defaults apply.",
    fields: [
      field("FOLLOWER_MODEL_VERSION", "Assumptions version", "text", {
        defaultValue: "2026-09-28.2",
        help: "Change this whenever you change an assumption; it is shown on /methodology and with every estimate.",
      }),
      field("FOLLOWER_MODEL_CHANGE_NOTE", "Reason and source for changed values", "text", {
        help: "Required whenever a value differs from its cited default. Shown on /methodology next to the adjusted values and in the change log.",
      }),
      field("FOLLOWER_REACH_UP_TO_5K_LOW", "Story reach, up to 5,000 followers: low (%)", "number", {
        defaultValue: "9.55",
        help: "Share of followers who see a Story. Default: Socialinsider Stories benchmarks (image).",
      }),
      field("FOLLOWER_REACH_UP_TO_5K_HIGH", "Story reach, up to 5,000 followers: high (%)", "number", {
        defaultValue: "10.4",
        help: "Default: Socialinsider Stories benchmarks (video).",
      }),
      field("FOLLOWER_REACH_UP_TO_10K_LOW", "Story reach, 5,001 to 10,000 followers: low (%)", "number", {
        defaultValue: "3.5",
        help: "Share of followers who see a Story. Default: Socialinsider Stories benchmarks (image).",
      }),
      field("FOLLOWER_REACH_UP_TO_10K_HIGH", "Story reach, 5,001 to 10,000 followers: high (%)", "number", {
        defaultValue: "4.2",
        help: "Default: Socialinsider Stories benchmarks (video).",
      }),
      field("FOLLOWER_REACH_UP_TO_50K_LOW", "Story reach, 10,001 to 50,000 followers: low (%)", "number", {
        defaultValue: "1.35",
        help: "Share of followers who see a Story. Default: Socialinsider Stories benchmarks (image).",
      }),
      field("FOLLOWER_REACH_UP_TO_50K_HIGH", "Story reach, 10,001 to 50,000 followers: high (%)", "number", {
        defaultValue: "2",
        help: "Default: Socialinsider Stories benchmarks (video).",
      }),
      field("FOLLOWER_REACH_UP_TO_100K_LOW", "Story reach, 50,001 to 100,000 followers: low (%)", "number", {
        defaultValue: "0.55",
        help: "Share of followers who see a Story. Default: Socialinsider Stories benchmarks (image).",
      }),
      field("FOLLOWER_REACH_UP_TO_100K_HIGH", "Story reach, 50,001 to 100,000 followers: high (%)", "number", {
        defaultValue: "0.65",
        help: "Default: Socialinsider Stories benchmarks (video).",
      }),
      field("FOLLOWER_REACH_ABOVE_100K_LOW", "Story reach, above 100,000 followers: low (%)", "number", {
        defaultValue: "0.5",
        help: "Share of followers who see a Story. Default: Socialinsider Stories benchmarks (image).",
      }),
      field("FOLLOWER_REACH_ABOVE_100K_HIGH", "Story reach, above 100,000 followers: high (%)", "number", {
        defaultValue: "0.65",
        help: "Default: Socialinsider Stories benchmarks (video).",
      }),
      field("FOLLOWER_LINK_CLICK_LOW", "Link-sticker click-through: low (%)", "number", {
        defaultValue: "1",
        help: "Chance that a Story viewer opens one link Story. Repeat Stories reach mostly the same viewers, so the calculator uses 1 − (1 − rate)^Stories. No industry benchmark exists; creators report 1-5%.",
      }),
      field("FOLLOWER_LINK_CLICK_HIGH", "Link-sticker click-through: high (%)", "number", {
        defaultValue: "5",
      }),
      field("FOLLOWER_PURCHASE_LOW", "Visit to paid subscriber: low (%)", "number", {
        defaultValue: "0.72",
        help: "Share of people who visit that subscribe. Default: Dynamic Yield luxury and jewellery (high-consideration retail). Retail e-commerce purchase rates; no published benchmark exists for coaching subscriptions.",
      }),
      field("FOLLOWER_PURCHASE_HIGH", "Visit to paid subscriber: high (%)", "number", {
        defaultValue: "2.89",
        help: "Default: Dynamic Yield e-commerce conversion, EMEA average (the UAE is in EMEA).",
      }),
      field("FOLLOWER_ENGAGEMENT_BENCHMARK", "Average engagement rate (%)", "number", {
        defaultValue: "0.48",
        help: "A trainer's own engagement rate is compared with this to scale reach. Default: Socialinsider 2025.",
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
        help: "Configure the Stripe endpoint as /api/v1/webhooks/stripe on the public application address.",
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
          defaultValue: "true",
          help: "On by default: an activated clone waits in Integration operations for your identity and rights check (listen to its preview) before members hear it. Turn off only if the trainer's own recording and consent are enough.",
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
    "The connection check reads the registrar account balance only; no domain is bought. Namecheap accepts API calls only from the whitelisted client IPv4 address (this server's public address) and only after API access is enabled on the account. Keep the test environment switched on until the owner approves live purchases. Owner decision (28 September 2026): the registrant of every domain bought here is always the platform company entered below, with WHOIS privacy always requested; trainers are never the registrant, and there is no self-service transfer out or authorisation code for them (operators handle an exceptional request manually at the registrar). Trainers and members never see the registrar's name or cost: they see only the first-year and yearly renewal price in AED, which is the registrar's one-year price (the higher of registration and renewal) at the fixed USD to AED rate, rounded up to whole dirhams, plus the yearly margin. Subdomains use PLATFORM_ROOT_DOMAIN in the server's runtime settings, not this page.",
  fields: [
    field("WEB_ADDRESS_REGISTRAR", "Registrar", "select", {
      required: true,
      defaultValue: "namecheap",
      options: [
        { value: "namecheap", label: "Namecheap" },
        {
          value: "generic",
          label: "Generic registrar API (Custom domains settings)",
        },
      ],
    }),
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
    field("WEB_ADDRESS_MARGIN_AED", "Yearly margin (AED)", "number", {
      defaultValue: "25",
    }),
    field("WEB_ADDRESS_USD_TO_AED", "USD to AED rate", "number", {
      defaultValue: "3.6725",
    }),
    field("WEB_ADDRESS_TLDS", "Offered endings", "text", {
      defaultValue: "com,net,org,co",
      help: "Comma-separated, at most 12.",
    }),
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
  };
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
        key === "WEB_ADDRESS_TLDS" &&
        !/^\s*\.?[a-z]{2,63}(\.[a-z]{2,63})?(\s*,\s*\.?[a-z]{2,63}(\.[a-z]{2,63})?){0,11}\s*$/i.test(
          text,
        )
      )
        throw new ConfigurationError(
          `${entry.label} must be up to 12 comma-separated endings such as com,net`,
        );
      if (
        key === "WEB_ADDRESS_USD_TO_AED" &&
        !(Number(text) >= 1 && Number(text) <= 10)
      )
        throw new ConfigurationError(`${entry.label} must be between 1 and 10`);
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
      if (key === "WEB_ADDRESS_MARGIN_AED" && Number(text) > 10000)
        throw new ConfigurationError(`${entry.label} must be at most 10000`);
      if (
        /^FOLLOWER_(REACH_|LINK_CLICK_|PURCHASE_|ENGAGEMENT_BENCHMARK)/.test(
          key,
        ) &&
        Number(text) > 100
      )
        throw new ConfigurationError(`${entry.label} must be a percentage from 0 to 100`);
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
    const missing = definition.fields.filter(
      (entry) => entry.required && !fields[entry.key],
    );
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
