import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Stripe from "stripe";
import {
  LeanGateway,
  sendEmail,
  stripeClient,
  testIntegration,
  withRuntimeConfig,
} from "@trainer/providers";
import { sendWebPush } from "../packages/providers/src/push.ts";
import { createMockTls, trustMockCa, type MockTls } from "./e2e/mocks/tls.ts";
import { StripeMock, stripeSignature } from "./e2e/mocks/stripe.ts";
import { EmailMock, linkIn } from "./e2e/mocks/email.ts";
import { LeanMock } from "./e2e/mocks/lean.ts";
import { ModelMock } from "./e2e/mocks/model.ts";
import { PushMock } from "./e2e/mocks/push.ts";
import { vapidKeyPair } from "./e2e/mocks/index.ts";
import { parseNestedForm } from "./e2e/mocks/http.ts";
import { normalizeRequest, denormalize } from "./e2e/mocks/model-normalize.ts";
import { ruleBasedAnswer } from "./e2e/mocks/model-rules.ts";

let tls: MockTls;
const env = ["TRAINER_PROVIDER_SANDBOX", "PUBLIC_APP_URL", "API_HOST", "STRIPE_API_BASE_URL"];
const saved = Object.fromEntries(env.map((k) => [k, process.env[k]]));
before(() => {
  tls = createMockTls();
  trustMockCa(tls.ca);
  Object.assign(process.env, {
    TRAINER_PROVIDER_SANDBOX: "mock",
    PUBLIC_APP_URL: "https://localhost:8443",
    API_HOST: "127.0.0.1",
  });
});
after(() => {
  tls.cleanup();
  for (const k of env)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

test("nested form bodies parse like Stripe's encoder", () => {
  assert.deepEqual(
    parseNestedForm("line_items[0][price]=price_1&line_items[0][quantity]=1&metadata[a]=b&expand[0]=x&created[gte]=5"),
    { line_items: [{ price: "price_1", quantity: "1" }], metadata: { a: "b" }, expand: ["x"], created: { gte: "5" } },
  );
});

test("the Stripe mock serves the real SDK over TLS and sends verifiable webhooks", async () => {
  const received: Array<{ type: string; valid: boolean }> = [];
  const verifier = new Stripe("sk_test_unused");
  const receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let valid = true,
        type = "";
      try {
        type = verifier.webhooks.constructEvent(body, String(req.headers["stripe-signature"]), "whsec_test_fixture").type;
      } catch {
        valid = false;
      }
      received.push({ type, valid });
      res.writeHead(200).end("{}");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", () => r()));
  const mock = new StripeMock({ key: tls.key, cert: tls.cert }, "sk_test_mock_fixture", "whsec_test_fixture");
  await mock.start();
  mock.webhookUrl = `http://127.0.0.1:${(receiver.address() as any).port}/hook`;
  process.env.STRIPE_API_BASE_URL = mock.url;
  try {
    const stripe = withRuntimeConfig({ STRIPE_SECRET_KEY: "sk_test_mock_fixture" }, () => stripeClient());
    const product = await stripe.products.create({ name: "Fixture", metadata: { tenant_id: "t" } }, { idempotencyKey: "p1" });
    const again = await stripe.products.create({ name: "Fixture", metadata: { tenant_id: "t" } }, { idempotencyKey: "p1" });
    assert.equal(again.id, product.id, "idempotency keys replay");
    const price = await stripe.prices.create({ product: product.id, currency: "aed", unit_amount: 29900, recurring: { interval: "month" } });
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: randomUUID(),
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { tenant_id: "t", user_id: "u" },
      subscription_data: { metadata: { tenant_id: "t", user_id: "u" } },
      success_url: "https://localhost:8443/ok",
      cancel_url: "https://localhost:8443/cancel",
    });
    assert.equal(session.status, "open");
    const listed = await stripe.checkout.sessions.list({ limit: 10, created: { gte: 0 } });
    assert.equal(listed.data[0].id, session.id);
    const result = await mock.completeCheckout(session.id);
    assert.deepEqual(received.map((r) => r.type), ["checkout.session.completed", "customer.subscription.created", "invoice.paid"]);
    assert.ok(received.every((r) => r.valid), "signatures verify with the Stripe SDK");
    const sub = await stripe.subscriptions.retrieve(result.subscription.id);
    assert.equal(sub.items.data[0].price.id, price.id);
    const payments = await stripe.invoicePayments.list({ invoice: result.invoice.id, status: "paid", expand: ["data.payment.payment_intent"] });
    const intent: any = payments.data[0].payment.payment_intent;
    assert.equal(intent.latest_charge, result.charge.id);
    const refund = await stripe.refunds.create({ charge: result.charge.id, amount: 1000 });
    assert.equal(refund.status, "succeeded");
    await assert.rejects(stripe.refunds.create({ charge: result.charge.id, amount: 999999 }));
    const account = await withRuntimeConfig({}, () => testIntegration("stripe", { STRIPE_SECRET_KEY: "sk_test_mock_fixture", STRIPE_WEBHOOK_SECRET: "whsec_x" }));
    assert.equal(account.status, "verified");
    const denied = await testIntegration("stripe", { STRIPE_SECRET_KEY: "sk_test_wrong", STRIPE_WEBHOOK_SECRET: "whsec_x" });
    assert.equal(denied.status, "failed");
    assert.match(stripeSignature("{}", "whsec_x", 1), /^t=1,v1=[a-f0-9]{64}$/);
  } finally {
    delete process.env.STRIPE_API_BASE_URL;
    await mock.stop();
    receiver.close();
  }
});

test("the Stripe mock retrieves refunds, loses applied responses on request, checks coupon products and shapes charge events by API version", async () => {
  const events: any[] = [];
  const receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      events.push(JSON.parse(body));
      res.writeHead(200).end("{}");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", () => r()));
  const mock = new StripeMock({ key: tls.key, cert: tls.cert }, "sk_test_mock_fixture", "whsec_test_fixture");
  await mock.start();
  mock.webhookUrl = `http://127.0.0.1:${(receiver.address() as any).port}/hook`;
  process.env.STRIPE_API_BASE_URL = mock.url;
  try {
    const stripe = withRuntimeConfig({ STRIPE_SECRET_KEY: "sk_test_mock_fixture" }, () => stripeClient());
    const product = await stripe.products.create({ name: "Offer" });
    const other = await stripe.products.create({ name: "Other offer" });
    const price = await stripe.prices.create({ product: product.id, currency: "aed", unit_amount: 20000, recurring: { interval: "month" } });
    // A lost response: the coupon exists, the SDK saw one 500 and did not retry.
    mock.loseNextResponse("POST", /^\/v1\/coupons$/);
    const before = mock.server.requests("POST", "/v1/coupons").length;
    const couponBody = { id: "trainer_fixture", percent_off: 20, duration: "once" as const, applies_to: { products: [product.id] } };
    await assert.rejects(stripe.coupons.create(couponBody, { idempotencyKey: "promotion:fixture" }), /response was lost/);
    assert.equal(mock.server.requests("POST", "/v1/coupons").length - before, 1, "Stripe-Should-Retry: false stops SDK retries");
    assert.equal((await stripe.coupons.retrieve("trainer_fixture")).percent_off, 20, "the request was applied");
    const replay = await stripe.coupons.create(couponBody, { idempotencyKey: "promotion:fixture" });
    assert.equal(replay.id, "trainer_fixture", "the idempotency key replays the original answer");
    // Coupon products are enforced like Stripe.
    const base = { mode: "subscription" as const, success_url: "https://localhost:8443/ok", cancel_url: "https://localhost:8443/cancel" };
    const discounted = await stripe.checkout.sessions.create({ ...base, line_items: [{ price: price.id, quantity: 1 }], discounts: [{ coupon: "trainer_fixture" }] });
    assert.equal(discounted.amount_total, 16000);
    assert.equal(discounted.amount_subtotal, 20000, "the subtotal is before the discount");
    const otherPrice = await stripe.prices.create({ product: other.id, currency: "aed", unit_amount: 20000, recurring: { interval: "month" } });
    await assert.rejects(
      stripe.checkout.sessions.create({ ...base, line_items: [{ price: otherPrice.id, quantity: 1 }], discounts: [{ coupon: "trainer_fixture" }] }),
      /cannot be applied/,
    );
    // refunds.retrieve and the charge.refunded shape.
    const paid = await mock.completeCheckout(discounted.id);
    events.length = 0;
    const refund = await stripe.refunds.create({ charge: paid.charge.id, amount: 1000 });
    assert.equal((await stripe.refunds.retrieve(refund.id)).amount, 1000);
    await assert.rejects(stripe.refunds.retrieve("re_missing"), /No such refund/);
    const charged = await (async () => {
      for (let i = 0; i < 100 && !events.some((e) => e.type === "charge.refunded"); i++) await new Promise((r) => setTimeout(r, 20));
      return events.find((e) => e.type === "charge.refunded");
    })();
    assert.equal(charged.api_version, "2025-09-30.clover");
    assert.equal(charged.data.object.refunds, undefined, "no embedded refunds from 2022-11-15");
    await mock.sendEvent("charge.refunded", mock.chargeEventObject(paid.charge, "2022-08-01"), { apiVersion: "2022-08-01" });
    const legacy = events.at(-1);
    assert.equal(legacy.api_version, "2022-08-01");
    assert.equal(legacy.data.object.refunds.data[0].id, refund.id, "older endpoint versions embed the refunds");
  } finally {
    delete process.env.STRIPE_API_BASE_URL;
    await mock.stop();
    receiver.close();
  }
});

test("email, Lean and push mocks receive the adapters' real requests over TLS", async () => {
  const email = new EmailMock({ key: tls.key, cert: tls.cert }, "em_fixture");
  const lean = new LeanMock({ key: tls.key, cert: tls.cert }, "lean_fixture", "src_fixture");
  const push = new PushMock({ key: tls.key, cert: tls.cert });
  await Promise.all([email.start(), lean.start(), push.start()]);
  try {
    await withRuntimeConfig(
      { EMAIL_API_URL: email.sendUrl, EMAIL_API_KEY: "em_fixture", EMAIL_FROM: "no-reply@sandbox.example" },
      () => sendEmail("Person@Sandbox.example", "Verify your email", "https://localhost:8443/verify-email/abc123\nExpires soon."),
    );
    const mail = await email.waitFor("person@sandbox.example", () => true, 2000);
    assert.equal(linkIn(mail, "/verify-email/").pathname, "/verify-email/abc123");
    await withRuntimeConfig(
      { EMAIL_API_URL: email.sendUrl, EMAIL_API_KEY: "wrong", EMAIL_FROM: "no-reply@sandbox.example" },
      () => assert.rejects(sendEmail("a@sandbox.example", "s", "t")),
    );
    const config = {
      LEAN_BASE_URL: lean.url,
      LEAN_ACCESS_TOKEN: "lean_fixture",
      LEAN_SOURCE_ACCOUNT_ID: "src_fixture",
      LEAN_CONTRACT_VERIFIED: "true",
      PAYOUTS_APPROVED: "true",
    };
    const destination = await withRuntimeConfig(config, () =>
      new LeanGateway().createBeneficiary({ name: "Fixture Coach", iban: "AE070331234567890123456", address: "1 Street", city: "Dubai" }, "intent-1"),
    );
    const payout = { id: randomUUID(), beneficiaryId: destination.id, amountMinor: 12345 };
    const first = await withRuntimeConfig(config, () => new LeanGateway().sendPayout(payout));
    const retry = await withRuntimeConfig(config, () => new LeanGateway().sendPayout(payout));
    assert.equal(retry.id, first.id, "the payout id is the idempotency key");
    assert.equal(first.amount, 123.45);
    const vapid = vapidKeyPair();
    const endpoint = push.endpoint();
    const sent = await withRuntimeConfig(
      { PUSH_VAPID_PUBLIC_KEY: vapid.publicKey, PUSH_VAPID_PRIVATE_KEY: vapid.privateKey, PUSH_VAPID_SUBJECT: "mailto:ops@sandbox.example" },
      () => sendWebPush(endpoint, async () => {}),
    );
    assert.equal(sent.status, 201);
    assert.equal(push.deliveries[0].vapidValid, true);
    assert.equal(push.deliveries[0].bodyBytes, 0);
  } finally {
    await Promise.all([email.stop(), lean.stop(), push.stop()]);
  }
});

test("model capture and replay survive new IDs and reordered evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "model-replay-"));
  const rule = (title: string, directive: string) => ({
    id: randomUUID(),
    data: { title, category: "progression", condition: "Always", directive, reason: "Taught", sourceIds: [] },
  });
  const request = (rules: any[], order: number[]) => ({
    model: "mock-coach-1",
    messages: [
      { role: "system", content: "You are a governed digital coaching assistant. Use only the supplied trainer evidence." },
      {
        role: "user",
        content: JSON.stringify({
          task: "held_out_evaluation",
          request: "All squat sets felt easy with two reps in reserve. Add load?",
          evidence: order.map((i) => rules[i]),
        }),
      },
    ],
  });
  try {
    const firstRules = [rule("Squat progression", "Add 2.5 kg to the squat when all sets are completed with two reps in reserve"), rule("Rest days", "Keep a rest day between sessions")];
    const rules = ruleBasedAnswer(request(firstRules, [0, 1]));
    assert.equal(rules.kind, "coach_decision");
    assert.deepEqual((rules.content as any).evidenceIds, [firstRules[0].id], "keyword responder cites the matching rule");
    const capture = join(dir, "capture.jsonl");
    const model = new ModelMock({ key: tls.key, cert: tls.cert }, "sk-fixture", "mock-coach-1", { capturePath: capture });
    await model.start();
    const call = await fetch(model.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer sk-fixture", "content-type": "application/json" },
      body: JSON.stringify(request(firstRules, [0, 1])),
    }).then((r) => r.json());
    assert.ok(call.usage.prompt_tokens > 0 && call.usage.completion_tokens > 0);
    await model.stop();
    const [line] = readFileSync(capture, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(line.kind, "coach_decision");
    assert.match(JSON.stringify(line.request), /\{\{uuid:\d+\}\}/);
    // A reviewer authors an answer against the canonical placeholders.
    const reviewed = { type: "message", message: "Reviewed answer", reason: "Reviewer", evidenceIds: line.response.evidenceIds, requiresHumanReview: true };
    const replayFile = join(dir, "replay.jsonl");
    writeFileSync(replayFile, JSON.stringify({ hash: line.hash, response: reviewed }) + "\n");
    // A later run: new record IDs, evidence in a different order.
    const laterRules = firstRules.map((r) => ({ ...r, id: randomUUID() }));
    const later = request(laterRules, [1, 0]);
    assert.equal(normalizeRequest("coach_decision", later).hash, line.hash, "hash is stable across runs");
    const replay = new ModelMock({ key: tls.key, cert: tls.cert }, "sk-fixture", "mock-coach-1", { replayPath: replayFile, fallback: "fail" });
    await replay.start();
    const answered = await fetch(replay.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer sk-fixture", "content-type": "application/json" },
      body: JSON.stringify(later),
    }).then((r) => r.json());
    const content = JSON.parse(answered.choices[0].message.content);
    assert.equal(content.message, "Reviewed answer");
    assert.deepEqual(content.evidenceIds, [laterRules[0].id], "placeholders map onto the new run's IDs");
    const miss = await fetch(replay.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer sk-fixture", "content-type": "application/json" },
      body: JSON.stringify({ ...later, messages: [later.messages[0], { role: "user", content: "{\"task\":\"other\"}" }] }),
    });
    assert.equal(miss.status, 503, "fallback=fail refuses unreviewed prompts");
    await replay.stop();
    assert.deepEqual(denormalize({ a: "{{uuid:9}}" }, normalizeRequest("x", later).map), { a: "{{uuid:9}}" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the report maps steps to the feature inventory and lists what was not exercised", async () => {
  const { Reporter, AUDIENCES } = await import("./e2e/harness/report.ts");
  const dir = mkdtempSync(join(tmpdir(), "e2e-report-"));
  try {
    const inventory = join(dir, "features.json");
    writeFileSync(
      inventory,
      JSON.stringify({
        [AUDIENCES.Trainers]: {
          features: [{ feature: "Brain evaluation" }, { feature: "Team" }, { feature: "Trainer and subscriber messaging" }],
        },
        [AUDIENCES.followers]: { features: [{ feature: "Start a workout" }, { feature: "Message your trainer" }] },
      }),
    );
    const reporter = new Reporter(() => {});
    await reporter.step("Trainers", "Brain evaluation", "passes", async () => {});
    await reporter.step("followers", "Start a workout", "fails", async () => {
      throw new Error("no session");
    });
    // The follower's chat is the same flow as the trainer's messaging feature.
    await reporter.step("followers", "Message your trainer", "two-way chat", async () => {});
    await reporter.step("followers", "Not in the inventory", "passes", async () => {});
    reporter.skip("Trainers", "Team", "skipped", "no staff");
    const report = reporter.summary(inventory) as any;
    assert.deepEqual(report.summary, { steps: 5, passed: 3, failed: 1, skipped: 1 });
    assert.deepEqual(report.inventory.coverage.Trainers, { covered: 1, total: 3, withEquivalents: 2 });
    assert.deepEqual(report.inventory.coverage.followers, { covered: 2, total: 2, withEquivalents: 2 });
    assert.deepEqual(report.inventory.notExercised.Trainers, ["Team"]);
    assert.deepEqual(report.inventory.unknownFeatureNames, ["followers: Not in the inventory"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the software passkey satisfies the server's WebAuthn verification", async () => {
  const { SoftwarePasskey } = await import("./e2e/harness/webauthn.ts");
  const webauthn = await import("@simplewebauthn/server");
  const origin = "https://localhost:8443";
  const key = new SoftwarePasskey(origin);
  const options = await webauthn.generateRegistrationOptions({
    rpName: "Harness",
    rpID: "localhost",
    userName: "member@example.test",
    userID: Buffer.from(randomUUID()),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const registration = await webauthn.verifyRegistrationResponse({
    response: key.register(options) as any,
    expectedChallenge: options.challenge,
    expectedOrigin: origin,
    expectedRPID: "localhost",
    requireUserVerification: true,
  });
  assert.equal(registration.verified, true);
  const credential = registration.registrationInfo!.credential;
  const check = async (expectedOrigin: string) => {
    const auth = await webauthn.generateAuthenticationOptions({ rpID: "localhost", userVerification: "required" });
    return webauthn.verifyAuthenticationResponse({
      response: key.authenticate(auth) as any,
      expectedChallenge: auth.challenge,
      expectedOrigin,
      expectedRPID: "localhost",
      requireUserVerification: true,
      credential: { id: credential.id, publicKey: credential.publicKey, counter: credential.counter },
    });
  };
  assert.equal((await check(origin)).verified, true);
  await assert.rejects(check("https://attacker.example"), "an assertion for another origin is refused");
});

test("the DNS double answers TXT, CNAME and chased A records through a Node resolver", async () => {
  const { DnsMock } = await import("./e2e/mocks/dns.ts");
  const { Resolver } = await import("node:dns/promises");
  const dns = new DnsMock();
  await dns.start();
  try {
    dns.set("edge.sandbox-platform.example", "A", ["127.77.0.1"]);
    dns.set("coach.example", "CNAME", ["edge.sandbox-platform.example"]);
    dns.set("_trainer-verify.coach.example", "TXT", ["trainer-verification=fixture"]);
    const resolver = new Resolver({ timeout: 1000, tries: 1 });
    resolver.setServers([dns.server]);
    assert.deepEqual(await resolver.resolveTxt("_trainer-verify.coach.example"), [["trainer-verification=fixture"]]);
    assert.deepEqual(await resolver.resolveCname("coach.example"), ["edge.sandbox-platform.example"]);
    assert.deepEqual(await resolver.resolve4("coach.example"), ["127.77.0.1"]);
    await assert.rejects(resolver.resolve4("unknown.example"), { code: "ENOTFOUND" });
  } finally {
    await dns.stop();
  }
});

test("the OIDC doubles publish discovery and keys and enforce client credentials, PKCE and single-use codes", async () => {
  const { OidcMock } = await import("./e2e/mocks/oidc.ts");
  const { oidcDiscovery, exchangeAuthorizationCode, verifyIdToken, oidcAuthorizationUrl, pkceChallenge, checkOidcConnection, clearOidcCaches } = await import(
    "../packages/providers/src/oidc.ts"
  );
  const google = new OidcMock({ key: tls.key, cert: tls.cert }, "google");
  const apple = new OidcMock({ key: tls.key, cert: tls.cert }, "apple");
  await google.start();
  await apple.start();
  process.env.GOOGLE_OIDC_ISSUER = google.issuer;
  process.env.APPLE_OIDC_ISSUER = apple.issuer;
  clearOidcCaches();
  try {
    for (const [mock, provider] of [[google, "google"], [apple, "apple"]] as const) {
      const config = { ...mock.settings().values, ...mock.settings().secrets, PUBLIC_APP_URL: "https://localhost:8443" };
      const checked = await withRuntimeConfig(config, () => checkOidcConnection(provider, config));
      assert.equal(checked.status, "verified", `${provider}: ${checked.message}`);
      const discovery = await oidcDiscovery(provider);
      assert.equal(discovery.issuer, mock.issuer);
      const client =
        provider === "google"
          ? { provider, clientId: mock.clientId, clientSecret: mock.clientSecret }
          : { provider, clientId: mock.clientId, apple: { teamId: mock.apple!.teamId, keyId: mock.apple!.keyId, privateKey: mock.apple!.privateKeyText } };
      const verifier = "v".repeat(43);
      const redirectUri = `https://localhost:8443/api/v1/auth/oidc/${provider}/callback`;
      const url = await oidcAuthorizationUrl(client as any, { redirectUri, state: "s1", nonce: "n1", codeChallenge: pkceChallenge(verifier) });
      mock.nextIdentity = { sub: "sub-" + provider, email: "fixture@sandbox.example", emailVerified: true, name: "Fixture Person" };
      const auth = await fetch(url, { redirect: "manual" });
      const code =
        provider === "google"
          ? new URL(auth.headers.get("location")!).searchParams.get("code")!
          : /name="code" value="([^"]+)"/.exec(await auth.text())![1];
      await assert.rejects(exchangeAuthorizationCode(client as any, { code, redirectUri, codeVerifier: "w".repeat(43) }), /did not accept/);
      mock.nextIdentity = { sub: "sub-" + provider, email: "fixture@sandbox.example", emailVerified: true };
      const again = await fetch(url, { redirect: "manual" });
      const code2 =
        provider === "google"
          ? new URL(again.headers.get("location")!).searchParams.get("code")!
          : /name="code" value="([^"]+)"/.exec(await again.text())![1];
      const { idToken } = await exchangeAuthorizationCode(client as any, { code: code2, redirectUri, codeVerifier: verifier });
      const claims = await verifyIdToken(provider, idToken, { clientId: mock.clientId, nonce: "n1" });
      assert.equal(claims.subject, "sub-" + provider);
      assert.equal(claims.emailVerified, true);
      await assert.rejects(exchangeAuthorizationCode(client as any, { code: code2, redirectUri, codeVerifier: verifier }), /did not accept/, "codes are single use");
    }
  } finally {
    delete process.env.GOOGLE_OIDC_ISSUER;
    delete process.env.APPLE_OIDC_ISSUER;
    clearOidcCaches();
    await google.stop();
    await apple.stop();
  }
});

test("the S3 double verifies Signature Version 4 and the payload hash", async () => {
  const { S3Mock } = await import("./e2e/mocks/s3.ts");
  const { createHash, createHmac } = await import("node:crypto");
  const s3 = new S3Mock({ key: tls.key, cert: tls.cert });
  await s3.start();
  try {
    const put = async (body: Buffer, secret: string, declared?: string) => {
      const url = `${s3.url}/${s3.bucket}/e2e/object.bin`;
      const payloadHash = declared ?? createHash("sha256").update(body).digest("hex");
      const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const host = new URL(url).host;
      const canonical = ["PUT", new URL(url).pathname, "", `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`, "host;x-amz-content-sha256;x-amz-date", payloadHash].join("\n");
      const scope = `${amzDate.slice(0, 8)}/${s3.region}/s3/aws4_request`;
      const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
      let key: Buffer = createHmac("sha256", "AWS4" + secret).update(amzDate.slice(0, 8)).digest();
      for (const part of [s3.region, "s3", "aws4_request"]) key = createHmac("sha256", key).update(part).digest();
      const signature = createHmac("sha256", key).update(toSign).digest("hex");
      return fetch(url, {
        method: "PUT",
        body: new Uint8Array(body),
        headers: {
          authorization: `AWS4-HMAC-SHA256 Credential=${s3.accessKey}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
        },
      });
    };
    assert.equal((await put(Buffer.from("fixture"), s3.secretKey)).status, 200);
    assert.equal(s3.objects.get("e2e/object.bin")?.bytes, 7);
    assert.equal((await put(Buffer.from("fixture"), "wrong-secret-key")).status, 403);
    assert.equal((await put(Buffer.from("fixture"), s3.secretKey, "0".repeat(64))).status, 400);
  } finally {
    await s3.stop();
  }
});
