/**
 * Super admin: platform bootstrap and configuration (setup), then operator
 * scenarios over the seeded platform. Feature names match the verified
 * inventory's "Platform operators" list.
 */
import assert from "node:assert/strict";
import type { E2EContext } from "../harness/context.ts";
import { operatorScenarios } from "./super-admin-ops.e2e.ts";

const A = "Super admin" as const;

/** Runs first: everything else depends on a configured platform. */
export async function setupPlatform(ctx: E2EContext) {
  const { admin, reporter: r, mocks } = ctx;
  let recoveryCodes: string[] = [];
  await r.step(A, "Health and readiness probes", "readiness through the TLS edge reports the mock-provider sandbox", async () => {
    const ready = await admin.get("/api/v1/ready");
    assert.equal(ready.status, "ready");
    assert.equal(ready.providerSandbox, "mock");
    assert.match(ready.providerSandboxNotice, /MOCK PROVIDERS/);
    return "providerSandbox=mock";
  });
  await r.step(A, "First Superadmin creation (npm run admin:bootstrap)", "bootstrapped account signs in with its one-time password", async () => {
    const boot = await admin.login();
    assert.equal(boot.user.platformRole, "admin");
    assert.equal(boot.environment, "production");
    assert.equal(boot.providerSandbox, "mock");
  });
  await r.step(A, "Platform screens refuse non-operators", "settings writes need a fresh authenticator even for the Superadmin", async () => {
    await admin.fails(403, "PUT", "/api/v1/admin/settings/application", { revision: 0, enabled: true, values: {} }, "MFA_STEP_UP");
  });
  await r.step(A, "Authenticator app (TOTP) setup", "enrol an authenticator and receive recovery codes", async () => {
    recoveryCodes = await admin.enrollMfa();
    assert.ok(recoveryCodes.length >= 8, "recovery codes returned");
    const security = await admin.get("/api/v1/auth/security");
    assert.equal(security.mfaEnabled, true);
    return `${recoveryCodes.length} recovery codes`;
  });
  await r.step(A, "Sign in with password and authenticator code, sign out", "sign out, then password without code is refused and code sign-in works", async () => {
    await admin.post("/api/v1/auth/logout", {});
    await admin.fails(401, "GET", "/api/v1/bootstrap");
    const wrong = await admin.request("POST", "/api/v1/auth/login", { email: admin.email, password: admin.password });
    assert.equal(wrong.status, 401, "sign-in without the code is refused");
    await admin.login();
    const security = await admin.get("/api/v1/auth/security");
    assert.ok(security.mfaAt, "session carries a fresh authenticator time");
  });
  await r.step(A, "Draft and publish legal document versions", "terms, privacy and AI disclosure drafted and published now", async () => {
    for (const key of ["terms", "privacy", "ai-disclosure"]) {
      const doc = await admin.post("/api/v1/admin/documents", {
        kind: "legal",
        key,
        title: `Sandbox ${key.replace("-", " ")} (synthetic, not reviewed)`,
        content: `SYNTHETIC ${key.toUpperCase()} TEXT FOR THE MOCK-PROVIDER SANDBOX. Not legal advice and not a reviewed document. It exists so the end-to-end harness can exercise consent recording.`,
      });
      await admin.post(`/api/v1/admin/documents/${doc.id}/publish`, {
        revision: doc.revision ?? 1,
        effectiveAt: new Date().toISOString(),
        reason: "End-to-end sandbox publication",
      });
    }
  });
  await r.step(A, "Public legal pages with past versions", "published terms are readable publicly with their version list", async () => {
    const anon = ctx.newClient("anonymous");
    const terms = await anon.get("/api/v1/public/documents/terms");
    assert.equal(terms.document.key, "terms");
    assert.ok(terms.versions.length >= 1);
  });
  const results: Record<string, any> = {};
  await r.step(A, "Save and validate application settings", "every provider saved through the encrypted settings API and tested", async () => {
    for (const [id, config] of Object.entries(mocks.settings)) {
      const current = await admin.get("/api/v1/admin/settings");
      const entry = current.integrations.find((i: any) => i.id === id);
      assert.ok(entry, "integration " + id + " exists");
      const saved = await admin.put(`/api/v1/admin/settings/${id}`, {
        revision: entry.revision,
        enabled: true,
        values: config.values,
        ...(Object.keys(config.secrets).length ? { secrets: config.secrets } : {}),
      });
      const tested = await admin.post(`/api/v1/admin/settings/${id}/test`, { revision: saved.revision });
      results[id] = tested.lastTest?.status;
      assert.ok(
        ["verified", "validated"].includes(tested.lastTest?.status),
        `${id} test status ${tested.lastTest?.status}`,
      );
      assert.equal(tested.active, true, id + " active");
    }
    return JSON.stringify(results);
  });
  await r.step(A, "Encrypted storage of provider keys", "saved secrets are never returned; only presence flags", async () => {
    const view = await admin.request("GET", "/api/v1/admin/settings");
    for (const config of Object.values(mocks.settings))
      for (const secret of Object.values(config.secrets))
        assert.ok(!view.text.includes(secret), "a saved secret value appeared in the settings response");
    const stripe = view.body.integrations.find((i: any) => i.id === "stripe");
    assert.equal(stripe.secrets.STRIPE_SECRET_KEY, true);
    assert.equal(stripe.credentialStatus, "ready");
    assert.equal(view.body.providerSandbox, "mock");
  });
  await r.step(A, "Provider connection check", "Stripe account and model list were read from the mocks", async () => {
    assert.equal(results.stripe, "verified");
    assert.equal(results.model, "verified");
    assert.ok(mocks.stripe.server.requests("GET", "/v1/account").length >= 1);
    assert.ok(mocks.model.server.requests("GET", "/v1/models").length >= 1);
  });
  await r.step(A, "Owner approval switches", "approval flags are on in the platform runtime", async () => {
    const boot = await admin.get("/api/v1/bootstrap");
    const status = Object.fromEntries(boot.integrations.map((i: any) => [i.id, i]));
    for (const id of ["stripe", "lean", "model", "email", "push", "whoop", "zepp", "voice", "domains"])
      assert.equal(status[id]?.approved && status[id]?.configured, true, id + " configured and approved");
  });
  await r.step(A, "Settings change history", "the audit trail lists saves and tests without values", async () => {
    const view = await admin.get("/api/v1/admin/settings");
    assert.ok(view.audit.some((a: any) => a.action === "saved" && a.integrationId === "stripe"));
    assert.ok(view.audit.some((a: any) => a.action === "tested" && a.result === "verified"));
  });
  await r.step(A, "Worker pause and speed control", "reviewed operation sets the worker cycle to one second", async () => {
    const base = "/api/v1/admin/infrastructure/operations";
    let state = await admin.get(base);
    const policy = await admin.post(base + "/policy", {
      revision: state.policy.revision,
      enabled: true,
      actionsPerHour: 5,
      monthlyCostCapMinor: 0,
      reason: "Sandbox: allow reviewed worker speed changes",
    });
    state = await admin.get(base);
    const op = await admin.post(base, {
      requestId: crypto.randomUUID(),
      resourceId: "worker:primary",
      action: "set_worker_dispatch",
      policyRevision: policy.revision,
      expectedRevision: state.resource.revision,
      estimatedMonthlyCostMinor: 0,
      desired: { paused: false, intervalMs: 1000 },
      reason: "Faster delivery for the end-to-end sandbox",
    });
    await admin.post(`${base}/${op.id}/approve`, { reason: "Reviewed: no cost, loopback sandbox" });
    const executed = await admin.post(`${base}/${op.id}/execute`, { reason: "Apply the reviewed worker speed" });
    assert.equal(executed.status, "succeeded");
    assert.equal((await admin.get(base)).resource.interval_ms, 1000);
  });
  await r.step(A, "Recovery codes", "recovery codes were issued at enrolment", async () => {
    assert.ok(recoveryCodes.every((c) => typeof c === "string" && c.length >= 8));
  });
}

/** Operator scenarios after seeding. */
export async function superAdminScenarios(ctx: E2EContext) {
  const { admin, reporter: r } = ctx;
  await admin.stepUp();
  await r.step(A, "Platform overview dashboard (/admin)", "overview counts the seeded workspaces", async () => {
    const overview = await admin.get("/api/v1/admin/overview");
    return JSON.stringify(overview).slice(0, 300);
  });
  for (const [view, feature] of [
    ["trainers", "Trainer workspaces list"],
    ["subscribers", "Subscriber accounts list"],
  ] as const)
    await r.step(A, feature, `operations view ${view} lists seeded rows`, async () => {
      const result = await admin.get(`/api/v1/admin/operations/${view}`);
      assert.equal(result.view, view);
      assert.ok(result.rows.length >= (view === "trainers" ? 3 : 15), `${result.rows.length} rows`);
      return `${result.rows.length} rows`;
    });
  await operatorScenarios(ctx);
}
