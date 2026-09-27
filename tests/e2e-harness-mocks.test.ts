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
