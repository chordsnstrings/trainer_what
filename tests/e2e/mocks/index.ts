/**
 * Starts every provider double on loopback HTTPS with throwaway credentials
 * and returns the settings a Superadmin would save, plus the sandbox-only
 * environment overrides. Test tooling only; never imported by the app.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createMockTls, type MockTls } from "./tls.ts";
import { StripeMock } from "./stripe.ts";
import { EmailMock } from "./email.ts";
import { LeanMock } from "./lean.ts";
import { ModelMock } from "./model.ts";
import { PushMock } from "./push.ts";
import { WhoopMock, ZeppMock } from "./wearables.ts";
import { VoiceMock } from "./voice.ts";
import { RegistrarMock } from "./registrar.ts";
import { FoodMock } from "./food.ts";
import { DnsMock } from "./dns.ts";
import { OidcMock } from "./oidc.ts";
import { S3Mock } from "./s3.ts";
import { NamecheapMock } from "./namecheap.ts";

/** Loopback address of the harness edge for simulated coach domains (port 443). */
export const COACH_DOMAIN_EDGE_ADDRESS = "127.77.0.1";
/**
 * PLATFORM_ROOT_DOMAIN of the run: every published workspace is served at
 * <slug>.<root> through the coach-domain edge (docs/features/web-addresses.md).
 */
export const PLATFORM_ROOT_DOMAIN = "coaches.sandbox-platform.example";
/** Coach domains the throwaway CA issues a certificate for (the edge still asks the API first). */
export const COACH_DOMAIN_NAMES = [
  "layla-strength-coaching.example",
  "unmapped-coach.example",
  // Automatic subdomains: a published workspace, and a name no workspace has.
  `layla-strength.${PLATFORM_ROOT_DOMAIN}`,
  `no-such-coach.${PLATFORM_ROOT_DOMAIN}`,
];
/**
 * Public IPv4 values the web address settings require (the settings refuse
 * private addresses). Nothing ever connects to them: the Namecheap double only
 * compares the whitelisted client address, and records written there are not
 * published to the DNS double, so a bought domain never resolves in the run.
 */
export const WEB_ADDRESS_SANDBOX_IPV4 = { client: "198.51.101.10", target: "198.51.101.20" };

const token = (prefix: string, bytes = 18) => prefix + randomBytes(bytes).toString("hex");

export function vapidKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const priv = privateKey.export({ format: "jwk" }) as { d: string };
  return {
    publicKey: Buffer.concat([
      Buffer.from([4]),
      Buffer.from(pub.x, "base64url"),
      Buffer.from(pub.y, "base64url"),
    ]).toString("base64url"),
    privateKey: priv.d,
  };
}

export type MockSuite = Awaited<ReturnType<typeof startMocks>>;

export async function startMocks(
  options: {
    tls?: MockTls;
    modelCapturePath?: string;
    modelReplayPath?: string;
    modelFallback?: "rules" | "fail";
    publicAppUrl?: string;
  } = {},
) {
  const tls = options.tls ?? createMockTls(undefined, COACH_DOMAIN_NAMES);
  const material = { key: tls.key, cert: tls.cert };
  const secrets = {
    stripeSecret: token("sk_test_mock_"),
    stripeWebhook: token("whsec_mock_"),
    lean: token("lean_mock_"),
    leanSource: token("src_mock_", 8),
    model: token("sk-mock-"),
    email: token("em_mock_"),
    whoopId: token("whoop-client-", 6),
    whoopSecret: token("whoop_secret_"),
    zeppId: token("zepp-client-", 6),
    zeppSecret: token("zepp_secret_"),
    voice: token("xi_mock_"),
    registrar: token("reg_mock_"),
    namecheapKey: token("nc_mock_"),
  };
  const modelName = "mock-coach-1";
  const stripe = new StripeMock(material, secrets.stripeSecret, secrets.stripeWebhook);
  const email = new EmailMock(material, secrets.email);
  const lean = new LeanMock(material, secrets.lean, secrets.leanSource);
  const model = new ModelMock(material, secrets.model, modelName, {
    capturePath: options.modelCapturePath,
    replayPath: options.modelReplayPath,
    fallback: options.modelFallback,
  });
  const push = new PushMock(material);
  const whoop = new WhoopMock(material, secrets.whoopId, secrets.whoopSecret);
  const zepp = new ZeppMock(material, secrets.zeppId, secrets.zeppSecret);
  const voice = new VoiceMock(material, secrets.voice);
  const registrar = new RegistrarMock(material, secrets.registrar);
  const food = new FoodMock(material);
  const google = new OidcMock(material, "google");
  const apple = new OidcMock(material, "apple");
  const s3 = new S3Mock(material);
  // Namecheap XML API double for automatic domain purchases and renewals.
  const namecheap = new NamecheapMock(material, {
    apiUser: "sandboxplatform",
    apiKey: secrets.namecheapKey,
    username: "sandboxplatform",
    clientIp: WEB_ADDRESS_SANDBOX_IPV4.client,
  });
  const all = [stripe, email, lean, model, push, whoop, zepp, voice, registrar, food, google, apple, s3, namecheap];
  await Promise.all(all.map((m) => m.start()));
  const dns = new DnsMock();
  await dns.start();
  // The platform's approved CNAME target resolves to the local edge.
  dns.set("edge.sandbox-platform.example", "A", [COACH_DOMAIN_EDGE_ADDRESS]);
  registrar.onRecords = (domain, records) => {
    const byName = new Map<string, Map<string, string[]>>();
    for (const record of records) {
      const owner = record.name === "@" || !record.name ? domain : record.name.endsWith(domain) ? record.name : `${record.name}.${domain}`;
      const types = byName.get(owner) ?? new Map<string, string[]>();
      types.set(record.type, [...(types.get(record.type) ?? []), record.value]);
      byName.set(owner, types);
    }
    for (const [owner, types] of byName)
      for (const [type, values] of types) dns.set(owner, type as "A" | "TXT" | "CNAME", values);
  };
  const vapid = vapidKeyPair();
  const app = options.publicAppUrl ?? "http://localhost:3000";
  stripe.webhookUrl = app + "/api/v1/webhooks/stripe";
  /** Values the Superadmin saves through PUT /api/v1/admin/settings/:id. */
  const settings: Record<string, { values: Record<string, string>; secrets: Record<string, string> }> = {
    application: {
      values: {
        APP_NAME: "Trainer Brain (mock sandbox)",
        SUPPORT_EMAIL: "support@sandbox.example",
        LEGAL_APPROVED: "true",
        FILE_IMPORTS_APPROVED: "true",
        NUTRITION_ENABLED: "true",
        NUTRITION_SCOPE_APPROVED: "true",
        MEAL_PHOTOS_ENABLED: "true",
        FOOD_LOOKUP_ENABLED: "true",
      },
      secrets: {},
    },
    stripe: {
      values: {
        STRIPE_PUBLISHABLE_KEY: "pk_test_mock_publishable",
        COMMERCE_APPROVED: "true",
        BUNDLE_CHANGES_APPROVED: "true",
      },
      secrets: { STRIPE_SECRET_KEY: secrets.stripeSecret, STRIPE_WEBHOOK_SECRET: secrets.stripeWebhook },
    },
    lean: {
      values: {
        LEAN_BASE_URL: lean.url,
        LEAN_CONTRACT_VERIFIED: "true",
        PAYOUTS_APPROVED: "true",
      },
      secrets: { LEAN_ACCESS_TOKEN: secrets.lean, LEAN_SOURCE_ACCOUNT_ID: secrets.leanSource },
    },
    model: {
      values: {
        MODEL_BASE_URL: model.baseUrl,
        MODEL_NAME: modelName,
        MODEL_VISION_ENABLED: "true",
        MODEL_INPUT_USD_PER_MILLION: "2.5",
        MODEL_OUTPUT_USD_PER_MILLION: "10",
        MODEL_PRICE_VERSION: "mock-2026-09",
        MODEL_MAX_DAILY_CALLS: "2000",
        MODEL_MAX_DAILY_CALLS_PER_SUBSCRIBER: "50",
      },
      secrets: { MODEL_API_KEY: secrets.model },
    },
    email: {
      values: { EMAIL_API_URL: email.sendUrl, EMAIL_FROM: "no-reply@sandbox.example" },
      secrets: { EMAIL_API_KEY: secrets.email },
    },
    push: {
      values: { PUSH_VAPID_PUBLIC_KEY: vapid.publicKey, PUSH_VAPID_SUBJECT: "mailto:ops@sandbox.example" },
      secrets: { PUSH_VAPID_PRIVATE_KEY: vapid.privateKey },
    },
    whoop: {
      values: {
        WHOOP_CLIENT_ID: secrets.whoopId,
        WHOOP_REDIRECT_URI: app + "/api/v1/integrations/whoop/callback",
        WHOOP_SCOPES: "offline read:recovery read:sleep read:workout",
        WHOOP_CONTRACT_VERIFIED: "true",
      },
      secrets: { WHOOP_CLIENT_SECRET: secrets.whoopSecret },
    },
    apple: { values: { APPLE_IMPORTS_ENABLED: "true", HEALTHKIT_SYNC_ENABLED: "true" }, secrets: {} },
    zepp: {
      values: {
        ZEPP_CLIENT_ID: secrets.zeppId,
        ZEPP_REDIRECT_URI: app + "/api/v1/integrations/zepp/callback",
        ZEPP_API_BASE_URL: zepp.url,
        ZEPP_AUTHORIZE_URL: zepp.url + "/oauth/authorize",
        ZEPP_TOKEN_URL: zepp.url + "/oauth/token",
        ZEPP_SCOPES: "observations.read offline",
        ZEPP_ADAPTER_CONTRACT: "canonical-observations-v1",
        ZEPP_CONTRACT_VERIFIED: "true",
      },
      secrets: { ZEPP_CLIENT_SECRET: secrets.zeppSecret },
    },
    voice: {
      values: {
        VOICE_PROVIDER: "elevenlabs",
        VOICE_BASE_URL: voice.baseUrl,
        VOICE_MODEL: "eleven_multilingual_v2",
        VOICE_PRICE_VERSION: "mock-2026-09",
        VOICE_USD_PER_1000_CHARACTERS: "0.3",
        VOICE_DAILY_USD_LIMIT: "5",
        VOICE_CONTRACT_VERIFIED: "true",
      },
      secrets: { VOICE_API_KEY: secrets.voice },
    },
    speech_to_text: {
      values: {
        STT_PROVIDER: "elevenlabs",
        STT_BASE_URL: voice.baseUrl,
        STT_MODEL: "scribe_v1",
        STT_PRICE_VERSION: "mock-2026-09",
        STT_USD_PER_HOUR: "0.4",
        STT_ZERO_RETENTION: "true",
        STT_CONTRACT_VERIFIED: "true",
      },
      secrets: { STT_API_KEY: secrets.voice },
    },
    domains: {
      values: {
        DOMAIN_PROVIDER: "mock-registrar",
        DOMAIN_API_URL: registrar.url,
        DOMAIN_CNAME_TARGET: "edge.sandbox-platform.example",
        DOMAIN_OPERATIONS_ENABLED: "true",
      },
      secrets: { DOMAIN_API_KEY: secrets.registrar, DOMAIN_ACCOUNT_ID: "acct-mock-registrar" },
    },
    google_signin: google.settings(),
    apple_signin: apple.settings(),
    web_addresses: {
      values: {
        WEB_ADDRESS_REGISTRAR: "namecheap",
        NAMECHEAP_API_USER: "sandboxplatform",
        NAMECHEAP_USERNAME: "sandboxplatform",
        NAMECHEAP_CLIENT_IP: WEB_ADDRESS_SANDBOX_IPV4.client,
        NAMECHEAP_SANDBOX: "true",
        WEB_ADDRESS_REGISTRANT_FIRST_NAME: "Sandbox",
        WEB_ADDRESS_REGISTRANT_LAST_NAME: "Operator",
        WEB_ADDRESS_REGISTRANT_ORGANIZATION: "Sandbox Platform Company LLC",
        WEB_ADDRESS_REGISTRANT_ADDRESS: "1 Sandbox Street",
        WEB_ADDRESS_REGISTRANT_CITY: "Dubai",
        WEB_ADDRESS_REGISTRANT_STATE: "Dubai",
        WEB_ADDRESS_REGISTRANT_POSTAL_CODE: "00000",
        WEB_ADDRESS_REGISTRANT_COUNTRY: "AE",
        WEB_ADDRESS_REGISTRANT_PHONE: "+971.500000000",
        WEB_ADDRESS_REGISTRANT_EMAIL: "domains@sandbox.example",
        WEB_ADDRESS_MARGIN_AED: "25",
        WEB_ADDRESS_USD_TO_AED: "3.6725",
        WEB_ADDRESS_TLDS: "com,net,org,co",
        WEB_ADDRESS_TARGET_IPV4: WEB_ADDRESS_SANDBOX_IPV4.target,
        WEB_ADDRESS_PURCHASES_ENABLED: "true",
      },
      secrets: { NAMECHEAP_API_KEY: secrets.namecheapKey },
    },
  };
  /** Sandbox-only environment for API and worker processes. */
  const environment = {
    TRAINER_PROVIDER_SANDBOX: "mock",
    STRIPE_API_BASE_URL: stripe.url,
    WHOOP_API_BASE_URL: whoop.url,
    FOOD_LOOKUP_BASE_URL: food.url,
    GOOGLE_OIDC_ISSUER: google.issuer,
    APPLE_OIDC_ISSUER: apple.issuer,
    DOMAIN_DNS_SERVER: dns.server,
    NAMECHEAP_API_BASE_URL: namecheap.url,
    PLATFORM_ROOT_DOMAIN,
    NODE_EXTRA_CA_CERTS: tls.caFile,
  };
  return {
    tls,
    secrets,
    settings,
    environment,
    stripe,
    email,
    lean,
    model,
    push,
    whoop,
    zepp,
    voice,
    registrar,
    namecheap,
    food,
    google,
    apple,
    s3,
    dns,
    async stop() {
      await Promise.all([...all.map((m) => m.stop()), dns.stop()]);
      if (!options.tls) tls.cleanup();
    },
    requestLog() {
      return {
        ...Object.fromEntries(all.map((m) => [m.server.name, m.server.log.length])),
        dns: dns.queries.length,
      };
    },
  };
}
