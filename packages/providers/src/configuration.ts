import { AsyncLocalStorage } from "node:async_hooks";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";

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

export type IntegrationField = {
  key: string;
  label: string;
  type: "secret" | "text" | "url" | "number" | "boolean" | "select";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  help?: string;
  defaultValue?: string;
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
    | "branding";
  implemented: boolean;
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
    description: "Platform identity, reviewed policies and feature controls.",
    setupNotes:
      "These controls record an operator decision. They do not establish legal approval or provider eligibility by themselves. Infrastructure secrets stay outside this page.",
    fields: [
      field("APP_NAME", "Platform name", "text", {
        defaultValue: "Trainer Brain",
      }),
      field("SUPPORT_EMAIL", "Support email", "text"),
      field("LEGAL_VERSION", "Published legal document version", "text", {
        defaultValue: "draft-2026-09",
      }),
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
      "The adapter requires your account-specific API contract. Validation does not move money, verify bank permissions or establish recipient eligibility. Reconciliation is required before retrying an unknown payout.",
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
    id: "whoop",
    name: "WHOOP",
    category: "health",
    implemented: false,
    description: "OAuth recovery, sleep and workout synchronization.",
    setupNotes:
      "Credentials can be saved for setup. The OAuth callback and data-sync adapter are not implemented, so this connection cannot be activated.",
    fields: [
      field("WHOOP_CLIENT_ID", "OAuth client ID", "text", { required: true }),
      field("WHOOP_CLIENT_SECRET", "OAuth client secret", "secret", {
        required: true,
      }),
      field("WHOOP_REDIRECT_URI", "Registered callback URL", "url", {
        required: true,
      }),
      field("WHOOP_SCOPES", "Approved OAuth scopes", "text"),
    ],
  },
  {
    id: "apple",
    name: "Apple Health import",
    category: "health",
    implemented: true,
    description:
      "User-provided health exports through the existing import flow.",
    setupNotes:
      "Manual import needs no Apple API credential. Import approval and user consent apply. Native HealthKit synchronization requires a companion app and is not available.",
    fields: [
      field(
        "APPLE_IMPORTS_ENABLED",
        "Enable Apple Health file import",
        "boolean",
        { defaultValue: "true" },
      ),
    ],
  },
  {
    id: "zepp",
    name: "Amazfit / Zepp",
    category: "health",
    implemented: false,
    description: "Fitness observations through an approved partner connection.",
    setupNotes:
      "Partner access and a working synchronization adapter are required. Saving credentials does not create a connection.",
    fields: [
      field("ZEPP_CLIENT_ID", "Partner client ID", "text"),
      field("ZEPP_CLIENT_SECRET", "Partner client secret", "secret"),
      field("ZEPP_REDIRECT_URI", "Registered callback URL", "url"),
    ],
  },
  {
    id: "voice",
    name: "Trainer voice",
    category: "intelligence",
    implemented: false,
    description: "Consented trainer-voice guidance for premium sessions.",
    setupNotes:
      "Voice generation and consent-aware session delivery are not implemented. Credentials are stored for setup only.",
    fields: [
      field("VOICE_PROVIDER", "Provider name", "text"),
      field("VOICE_BASE_URL", "API base URL", "url"),
      field("VOICE_API_KEY", "API key", "secret"),
    ],
  },
  {
    id: "domains",
    name: "Custom domains",
    category: "branding",
    implemented: false,
    description: "Trainer domains and verified ownership.",
    setupNotes:
      "Domain provisioning, DNS verification and certificate automation are not implemented. This page does not register or purchase domains.",
    fields: [
      field("DOMAIN_PROVIDER", "Provider name", "text"),
      field("DOMAIN_API_URL", "API base URL", "url"),
      field("DOMAIN_API_KEY", "API key", "secret"),
      field("DOMAIN_ACCOUNT_ID", "Provider account ID", "secret"),
    ],
  },
];

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
      if (
        key === "MODEL_MAX_DAILY_CALLS" &&
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
      if (typeof init.body !== "string") {
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
    if (id === "stripe") {
      const response = await providerRequest(
        "https://api.stripe.com/v1/account",
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
          ? "Manual file import requires no API connection. Import approval and subscriber consent still apply; native sync is unavailable."
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
