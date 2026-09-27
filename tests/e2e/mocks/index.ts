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
  const tls = options.tls ?? createMockTls();
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
  const all = [stripe, email, lean, model, push, whoop, zepp, voice, registrar, food];
  await Promise.all(all.map((m) => m.start()));
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
    apple: { values: { APPLE_IMPORTS_ENABLED: "true" }, secrets: {} },
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
    domains: {
      values: {
        DOMAIN_PROVIDER: "mock-registrar",
        DOMAIN_API_URL: registrar.url,
        DOMAIN_CNAME_TARGET: "edge.sandbox-platform.example",
        DOMAIN_OPERATIONS_ENABLED: "true",
      },
      secrets: { DOMAIN_API_KEY: secrets.registrar, DOMAIN_ACCOUNT_ID: "acct-mock-registrar" },
    },
  };
  /** Sandbox-only environment for API and worker processes. */
  const environment = {
    TRAINER_PROVIDER_SANDBOX: "mock",
    STRIPE_API_BASE_URL: stripe.url,
    WHOOP_API_BASE_URL: whoop.url,
    FOOD_LOOKUP_BASE_URL: food.url,
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
    food,
    async stop() {
      await Promise.all(all.map((m) => m.stop()));
      if (!options.tls) tls.cleanup();
    },
    requestLog() {
      return Object.fromEntries(all.map((m) => [m.server.name, m.server.log.length]));
    },
  };
}
