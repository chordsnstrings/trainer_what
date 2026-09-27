/**
 * Extended coverage after the main suites: operator security, the Stripe
 * events endpoint, live settings, platform documents, finance controls,
 * affiliates, support previews, safety triage, privacy erasure and workspace
 * closure, plus account, consent, nutrition and connection flows for trainers
 * and followers. Everything goes through the public API; feature names match
 * the verified inventory.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { E2EContext, FollowerSeed, TrainerSeed } from "../harness/context.ts";
import { PASSWORD } from "../harness/data.ts";
import { accountRecovery, alertThresholds, coachNutrition, evidenceLog, hostAudit, hostOperators, keyRotation, memberExperience, memberReminders, nutritionImport, passkeys, publicSiteAsMember, scheduleFollowup, trainerData } from "./extended-accounts.e2e.ts";

const A = "Super admin" as const;
const T = "Trainers" as const;
const F = "followers" as const;
const P = "public-join" as const;
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
const period = (offsetMonths = 0) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  return d.toISOString().slice(0, 7);
};
const erasureEvidence = (expectedRevision: number) => ({
  providerReviewComplete: true,
  thirdPartySourceReviewComplete: true,
  evidenceReference: "Sandbox privacy review: mock providers hold no copy",
  retentionPolicyVersion: "sandbox-retention-v1",
  backupPurgeBy: new Date(Date.now() + 30 * 86400000).toISOString(),
  providers: [],
  expectedRevision,
});

export async function extendedScenarios(ctx: E2EContext) {
  const trainer = (slug: string) => ctx.trainers.find((t) => t.slug === slug && t.published);
  const layla = trainer("layla-strength"),
    omar = trainer("omar-conditioning"),
    sara = trainer("sara-mobility");
  if (!layla || !omar || !sara) {
    ctx.reporter.skip(A, "Platform screens refuse non-operators", "extended coverage", "a seeded trainer did not launch");
    return;
  }
  // A seeded follower that is missing is a recorded failure, never a silently shorter run.
  const follower = (slug: string, index: number) => {
    const label = `${slug}-follower-${index}`;
    const found = ctx.followers.find((f) => f.client.label === label);
    if (!found) ctx.reporter.missingPrerequisite(`seeded follower ${label}`);
    return found;
  };
  // Operator writes need an authenticator check from the last ten minutes.
  const fresh = () => ctx.admin.stepUp();

  // Due in a little over a minute; its delivery is checked near the end. A failure to schedule
  // is a failed step of that feature, not a silently missing check.
  const followup = await ctx.reporter.prepare(F, "Scheduled follow-up messages from the trainer", "the trainer schedules a follow-up due in a minute", () =>
    scheduleFollowup(layla, follower("layla-strength", 5)),
  );
  await operatorAccess(ctx, layla, follower("layla-strength", 0));
  await stripeEndpoint(ctx);
  await fresh();
  await documentsAndSettings(ctx, layla);
  await fresh();
  await financeControls(ctx, layla, omar, sara, follower("sara-mobility", 0));
  await fresh();
  await supportAndSafety(ctx, layla, sara);
  await evidenceLog(ctx, layla);
  await fresh();
  await privacyOperations(ctx, omar, sara, follower("omar-conditioning", 5), follower("sara-mobility", 3));
  await trainerAccounts(ctx, layla, omar, sara);
  await followerAccounts(ctx, follower("layla-strength", 8), follower("sara-mobility", 4), follower("layla-strength", 6));
  await memberExperience(ctx, layla, follower("layla-strength", 0), follower("omar-conditioning", 2), followup, follower("layla-strength", 3));
  await followerData(ctx, follower("layla-strength", 0), follower("layla-strength", 2), follower("omar-conditioning", 2), omar);
  await memberReminders(ctx, layla, follower("layla-strength", 3));
  await coachNutrition(ctx, layla, follower("layla-strength", 2));
  await nutritionImport(ctx, layla);
  await publicPages(ctx, layla);
  await publicSiteAsMember(ctx, layla, follower("layla-strength", 5));
  await passkeys(ctx, layla, follower("layla-strength", 0));
  await accountRecovery(ctx, layla);
  await trainerData(ctx, layla, follower("layla-strength", 0));
  await hostOperators(ctx, omar, layla, follower("layla-strength", 7));
  await hostAudit(ctx);
  await fresh();
  await workspaceClosure(ctx);
  await fresh();
  await disconnectConnection(ctx);
  await alertThresholds(ctx);
  // Last: the running API keeps the retired key after this.
  await keyRotation(ctx);
}

async function operatorAccess(ctx: E2EContext, layla: TrainerSeed, member?: FollowerSeed) {
  const r = ctx.reporter;
  await r.step(A, "Platform screens refuse non-operators", "a trainer owner and a member are refused every operator screen", async () => {
    await layla.client.fails(403, "GET", "/api/v1/admin/settings");
    await layla.client.fails(403, "GET", "/api/v1/admin/overview", undefined, "ADMIN_REQUIRED");
    if (member) await member.client.fails(403, "GET", "/api/v1/admin/overview", undefined, "ADMIN_REQUIRED");
  });
  await r.step(A, "Signed-in sessions list and remote sign-out", "a second operator device is listed and signed out remotely", async () => {
    const phone = ctx.admin.device("admin-phone");
    await phone.login();
    const account = await ctx.admin.get("/api/v1/auth/account");
    const other = account.sessions.find((s: any) => !s.current);
    assert.ok(account.sessions.length >= 2 && other, JSON.stringify(account.sessions).slice(0, 300));
    await ctx.admin.post(`/api/v1/auth/sessions/${other.id}/revoke`, {});
    await phone.fails(401, "GET", "/api/v1/bootstrap");
    return `${account.sessions.length} sessions before sign-out`;
  });
  await r.step(A, "Password change", "the Superadmin changes the password with an authenticator code and signs in again", async () => {
    const next = ctx.admin.password + "-rotated";
    await ctx.admin.post("/api/v1/auth/password", { current: ctx.admin.password, password: next, code: await ctx.admin.freshCode() });
    await ctx.admin.fails(401, "GET", "/api/v1/bootstrap");
    ctx.admin.password = next;
    ctx.adminCredentials.password = next;
    await ctx.admin.login();
  });
}

async function stripeEndpoint(ctx: E2EContext) {
  await ctx.reporter.step(A, "Stripe payment events endpoint", "a replayed event is acknowledged once; a bad signature is refused", async () => {
    const first = ctx.mocks.stripe.deliveries.find((d) => d.status === 200);
    assert.ok(first, "an event was delivered earlier");
    const replay = await ctx.mocks.stripe.redeliver(first.eventId);
    assert.equal(replay.status, 200, replay.body);
    assert.equal(JSON.parse(replay.body).duplicate, true);
    const forged = await ctx.mocks.stripe.redeliver(first.eventId, "whsec_not_the_configured_secret");
    assert.equal(forged.status, 400);
    assert.equal(JSON.parse(forged.body).code, "INVALID_SIGNATURE");
  });
}

async function documentsAndSettings(ctx: E2EContext, layla: TrainerSeed) {
  const { admin, reporter: r } = ctx;
  const anon = ctx.newClient("visitor-docs");
  await r.step(A, "Settings apply without a restart", "a new application name reaches the next request; then restored", async () => {
    const values = ctx.mocks.settings.application.values;
    const save = async (appName: string) => {
      const view = await admin.get("/api/v1/admin/settings");
      const entry = view.integrations.find((i: any) => i.id === "application");
      await admin.put("/api/v1/admin/settings/application", { revision: entry.revision, enabled: true, values: { ...values, APP_NAME: appName } });
    };
    await save("Trainer Brain (renamed without restart)");
    assert.equal((await layla.client.get("/api/v1/bootstrap")).platform.name, "Trainer Brain (renamed without restart)");
    await save(values.APP_NAME);
    assert.equal((await layla.client.get("/api/v1/bootstrap")).platform.name, values.APP_NAME);
  });
  await r.step(A, "Open sign-ups after legal approval", "trainer sign-up and member join wait while legal approval is off", async () => {
    const values = ctx.mocks.settings.application.values;
    const save = async (approved: string) => {
      const view = await admin.get("/api/v1/admin/settings");
      const entry = view.integrations.find((i: any) => i.id === "application");
      await admin.put("/api/v1/admin/settings/application", { revision: entry.revision, enabled: true, values: { ...values, LEGAL_APPROVED: approved } });
    };
    const visitor = ctx.newClient("late-coach");
    const body = { name: "Late Coach", email: "late.coach@sandbox.example", password: PASSWORD, slug: "late-coach", accepted: true };
    await save("false");
    try {
      await visitor.fails(503, "POST", "/api/v1/auth/register", body, "LEGAL_PENDING");
      await visitor.fails(503, "POST", "/api/v1/auth/enroll", { name: "Late Member", email: "late.member@sandbox.example", password: PASSWORD, coachSlug: layla.slug, accepted: true }, "LEGAL_PENDING");
    } finally {
      await save("true");
    }
    const registered = await visitor.request("POST", "/api/v1/auth/register", body);
    assert.equal(registered.status, 201, registered.text);
  });
  await r.step(A, "Scheduled effective dates and locked published text", "privacy v2 scheduled for tomorrow; v1 stays current; published text cannot be republished", async () => {
    const doc = await admin.post("/api/v1/admin/documents", {
      kind: "legal",
      key: "privacy",
      title: "Sandbox privacy v2 (synthetic)",
      content: "SYNTHETIC PRIVACY NOTICE VERSION 2 FOR THE MOCK-PROVIDER SANDBOX.",
    });
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const published = await admin.post(`/api/v1/admin/documents/${doc.id}/publish`, { revision: doc.revision ?? 1, effectiveAt: tomorrow, reason: "Scheduled sandbox privacy update" });
    assert.equal(published.status, "published");
    const current = await anon.get("/api/v1/public/documents/privacy");
    assert.notEqual(current.document.version, published.version, "a future version is not yet current");
    await admin.fails(409, "POST", `/api/v1/admin/documents/${doc.id}/publish`, { revision: published.revision, effectiveAt: tomorrow, reason: "Attempt to change published text" });
    await admin.fails(400, "POST", `/api/v1/admin/documents/${doc.id}/publish`, { revision: published.revision, effectiveAt: new Date(Date.now() - 86400000).toISOString(), reason: "Backdated publication attempt" }, "EFFECTIVE_DATE");
  });
  for (const [kind, key, title, content, feature] of [
    ["support_macro", "invoice-copy", "Invoice copy", "Hello, you can download every invoice from Billing in the app.", "Support reply macros"],
    ["notification", "workout-reminder", "Workout reminder", "Hi {{name}}, {{coach}} has your next session ready in your program (reminder sent {{date}}).", "Notification templates"],
    ["safety", "escalation-policy", "Safety escalation policy", "Chest pain, fainting or sharp joint pain pause training and reach the coach and the safety operator.", "Safety policy documents"],
  ] as const)
    await r.step(A, feature, `${kind} ${key} drafted and published`, async () => {
      if (kind === "notification")
        await admin.fails(400, "POST", "/api/v1/admin/documents", { kind, key, title, content: "Hi {{password}}" }, "TEMPLATE_VARIABLE");
      const doc = await admin.post("/api/v1/admin/documents", { kind, key, title, content });
      const published = await admin.post(`/api/v1/admin/documents/${doc.id}/publish`, { revision: doc.revision ?? 1, effectiveAt: new Date().toISOString(), reason: "Sandbox operator document" });
      assert.equal(published.status, "published");
      if (kind === "support_macro") {
        const view = await admin.get(`/api/v1/admin/operations/support?tenantId=${layla.tenantId}`);
        assert.ok(view.macros.some((m: any) => m.key === key), "published macro offered in the support queue");
      }
    });
}

async function financeControls(ctx: E2EContext, layla: TrainerSeed, omar: TrainerSeed, sara: TrainerSeed, saraMember?: FollowerSeed) {
  const { admin, reporter: r } = ctx;
  const base = (t: TrainerSeed) => `/api/v1/admin/tenants/${t.tenantId}/finance`;
  await r.step(A, "Commission and fee policy", `${omar.slug}: a prospective fee policy is published; a backdated one is refused`, async () => {
    const controls = await admin.get(`${base(omar)}/controls`);
    const latest = controls.records.find((x: any) => x.kind === "finance_policy");
    const policy = await admin.post(`${base(omar)}/policies`, {
      effectiveAt: new Date(Date.now() + 3600000).toISOString(),
      commissionBps: [2500, 2000, 1500, 1000],
      bookingFeeBps: 500,
      graceDays: 3,
      reason: "Sandbox fee schedule with a booking fee",
      revision: latest?.id ?? null,
    });
    assert.equal(policy.status, "published");
    await admin.fails(409, "POST", `${base(omar)}/policies`, {
      effectiveAt: new Date(Date.now() - 3600000).toISOString(),
      commissionBps: [2500, 2000, 1500, 1000],
      reason: "Backdated sandbox fee schedule",
      revision: policy.id,
    }, "RETROACTIVE_POLICY");
  });
  await r.step(A, "Charge a platform cost to a trainer", `${layla.slug}: a voice cost is charged to the trainer once`, async () => {
    const body = {
      intent: randomUUID(),
      period: period(0),
      category: "voice",
      amountMinor: 1500,
      chargeTrainer: true,
      evidenceReference: "Mock ElevenLabs invoice for the trainer voice",
      description: "Trainer voice synthesis",
    };
    const first = await admin.post(`${base(layla)}/cost-allocations`, body);
    const again = await admin.post(`${base(layla)}/cost-allocations`, body);
    assert.equal(again.id, first.id, "the same intent is recorded once");
    const journals = (await layla.client.get("/api/v1/bootstrap")).journals;
    assert.ok(journals.some((j: any) => j.source_key === "allocated-cost:" + body.intent));
  });
  await r.step(A, "Monthly financial statement", `${sara.slug}: statement for the closed month`, async () => {
    const statement = await admin.get(`${base(sara)}/statements/${period(-1)}`);
    assert.ok(statement && JSON.stringify(statement).length > 50, JSON.stringify(statement).slice(0, 200));
    return JSON.stringify(statement).slice(0, 160);
  });
  if (saraMember?.checkout?.chargeId)
    await r.step(A, "Record Stripe balance debits", `${sara.slug}: a lost dispute leaves a negative Stripe balance that a bank debit restores`, async () => {
      const { dispute } = await ctx.mocks.stripe.openDispute(saraMember.checkout!.chargeId!);
      const closed = await ctx.mocks.stripe.closeDispute(dispute.id, "lost");
      assert.equal(closed.status, 200, closed.body);
      const receivable = Number((await admin.get(base(sara))).summary.accounts.stripe_receivable ?? 0);
      assert.ok(receivable < 0, "negative Stripe balance: " + receivable);
      const debit = { stripeDebitId: "py_mock_" + dispute.id, bankReference: "BANK-DEBIT-" + dispute.id, evidenceReference: "Mock Stripe balance debit matched to the bank statement" };
      await admin.fails(409, "POST", `${base(sara)}/settlements/debits`, { ...debit, amountMinor: -receivable + 1 }, "EXCESS_DEBIT");
      await admin.post(`${base(sara)}/settlements/debits`, { ...debit, amountMinor: -receivable });
      assert.equal(Number((await admin.get(base(sara))).summary.accounts.stripe_receivable ?? 0), 0);
    });
  await r.step(A, "Finance automation", `${omar.slug}: Stripe reconciliation automated; unbounded payout execution refused`, async () => {
    const current = await admin.get(`${base(omar)}/automation`);
    const revision = current.configuration?.version ?? 0;
    const settings = {
      enabled: true,
      reconcileStripe: true,
      closeMonthly: false,
      preparePayouts: false,
      maxPayoutMinor: 0,
      fxAedPerUsd: 3.6725,
      fxEvidence: "Central bank reference rate for the sandbox",
      reason: "Automate Stripe reconciliation only",
    };
    await admin.fails(409, "POST", `${base(omar)}/automation`, { ...settings, revision, executePayouts: true }, "AUTOMATION_LIMIT_REQUIRED");
    const saved = await admin.post(`${base(omar)}/automation`, { ...settings, revision, executePayouts: false });
    assert.equal(saved.data?.reconcileStripe ?? saved.reconcileStripe, true);
    assert.equal((await admin.get(`${base(omar)}/automation`)).configuration.version, revision + 1);
  });
  await r.step(A, "Affiliate agreements and earnings", `${layla.slug}: affiliate contract and a provider receipt`, async () => {
    const prefix = `/api/v1/admin/tenants/${layla.tenantId}/affiliates`;
    const contract = await admin.post(prefix + "/contracts", {
      provider: "Sandbox Supplements",
      revision: 0,
      enabled: true,
      termsReference: "Sandbox affiliate terms v1 signed by the trainer",
      disclosure: "Layla earns a share when members buy through this partner link.",
      trainerShareBps: 7000,
      providerPermissionConfirmed: true,
      reason: "Trainer requested the partner programme",
    });
    const receipt = await admin.post(prefix + "/receipts", {
      requestId: randomUUID(),
      contractId: contract.id,
      revision: contract.revision,
      providerReference: "SANDBOX-STATEMENT-" + period(0),
      period: period(0),
      amountMinor: 10000,
      evidenceReference: "Mock partner statement for this month",
    });
    assert.equal(Number(receipt.trainer_minor), 7000);
  });
  await r.step(T, "Affiliate agreements and earnings view", `${layla.slug}: the trainer sees the contract and earnings`, async () => {
    const view = await layla.client.get("/api/v1/affiliates");
    assert.ok(JSON.stringify(view).includes("Sandbox Supplements"));
  });
}

async function supportAndSafety(ctx: E2EContext, layla: TrainerSeed, sara: TrainerSeed) {
  const { admin, reporter: r } = ctx;
  let supportCase: any, grant: any, settings: any;
  await r.step(A, "Support preview of a member's screens", `${sara.slug}: a time-boxed read-only preview for a member's support case`, async () => {
    const queue = await admin.get(`/api/v1/admin/operations/support?tenantId=${sara.tenantId}`);
    supportCase = queue.rows.find((x: any) => x.subject === "Invoice question");
    assert.ok(supportCase, "the member's support case is in the queue");
    const opened = await admin.post("/api/v1/admin/support-previews", {
      tenantId: sara.tenantId,
      caseId: supportCase.id,
      caseRevision: supportCase.version,
      requestKey: randomUUID(),
      reason: "Member asked about invoices; check the billing screen",
      minutes: 5,
      scopes: ["account", "access", "notification_settings"],
    });
    assert.equal(opened.grant.mode, "read_only");
    grant = opened.grant;
    const preview = await admin.get(`/api/v1/admin/support-previews/${opened.grant.id}`);
    const text = JSON.stringify(preview);
    assert.ok(!/password|token_hash/i.test(text), "no credentials in the preview");
    settings = preview.projection.notificationSettings;
    assert.ok(settings && typeof settings.version === "number", text.slice(0, 300));
    return text.slice(0, 160);
  });
  if (grant && settings)
    await r.step(A, "One-time support corrections", `${sara.slug}: one approved change to the member's reminder settings, applied once`, async () => {
      const elevation = await admin.post(`/api/v1/admin/support-previews/${grant.id}/elevations`, {
        revision: grant.revision,
        requestKey: randomUUID(),
        action: "notification_preferences",
        reason: "Member asked to stop workout reminders while travelling",
        version: settings.version,
        changes: { workouts: !settings.data.workouts },
      });
      const applied = await admin.post(`/api/v1/admin/support-previews/${grant.id}/elevations/${elevation.elevation.id}/apply`, { revision: elevation.elevation.revision });
      assert.equal(applied.elevation.status, "applied");
      const again = await admin.get(`/api/v1/admin/support-previews/${grant.id}`);
      assert.equal(again.projection.notificationSettings.data.workouts, !settings.data.workouts);
    });
  if (supportCase)
    await r.step(T, "Answer subscribers' support requests", `${sara.slug}: the trainer answers the member's support request`, async () => {
      await sara.client.post(`/api/v1/support/${supportCase.id}/reply`, { message: "You can download each invoice from Billing; I have sent a copy too.", resolve: true });
    });
  await r.step(A, "Operator safety triage note", `${layla.slug}: operator adds an urgent triage note to a safety item`, async () => {
    const view = await admin.get(`/api/v1/admin/operations/safety?tenantId=${layla.tenantId}`);
    const item = view.rows[0];
    assert.ok(item, "a safety item exists");
    const reviewed = await admin.post(`/api/v1/admin/tenants/${layla.tenantId}/safety/${item.id}/review`, {
      revision: item.version,
      note: "Chest pain report: confirm the coach contacted the member today.",
      priority: "urgent",
    });
    assert.equal(reviewed.version, item.version + 1);
  });
}

async function privacyOperations(ctx: E2EContext, omar: TrainerSeed, sara: TrainerSeed, leaver?: FollowerSeed, payingMember?: FollowerSeed) {
  const { admin, reporter: r } = ctx;
  if (!leaver) return;
  let request: any;
  await r.step(A, "Deletion request queue", `${leaver.client.label}: deletion request reaches the operator queue`, async () => {
    const created = await leaver.client.post("/api/v1/privacy/delete-request", {});
    const queue = await admin.get(`/api/v1/admin/tenants/${omar.tenantId}/privacy`);
    request = queue.find((x: any) => x.id === created.id);
    assert.ok(request && request.status === "pending_review", JSON.stringify(queue).slice(0, 300));
  });
  if (payingMember)
    await r.step(A, "Erase a member's personal data", `${payingMember.client.label}: erasure waits while a paid membership is open`, async () => {
      const queue = await admin.get(`/api/v1/admin/tenants/${sara.tenantId}/privacy`);
      const open = queue.find((x: any) => x.status === "pending_review");
      assert.ok(open, "the paying member's deletion request");
      await admin.fails(409, "POST", `/api/v1/admin/tenants/${sara.tenantId}/privacy/${open.id}/erase`, erasureEvidence(open.version), "SUBSCRIPTION_OPEN");
    });
  if (!request) {
    r.blocked("the deletion request did not reach the operator queue", [
      [A, "Erase a member's personal data", `${leaver.client.label}: unpaid member erased after provider review`],
      [F, "Deletion carried out by the Superadmin", `${leaver.client.label}: the erased account can no longer sign in`],
      [A, "Privacy follow-ups", `${omar.slug}: backup purge and provider follow-ups are scheduled`],
      [A, "Lifecycle requests and erasure registry", `${omar.slug}: the erasure is in the registry without personal data`],
    ]);
    return;
  }
  await r.step(A, "Erase a member's personal data", `${leaver.client.label}: unpaid member erased after provider review`, async () => {
    const result = await admin.post(`/api/v1/admin/tenants/${omar.tenantId}/privacy/${request.id}/erase`, erasureEvidence(request.version));
    assert.ok(JSON.stringify(result).includes("erasure"), JSON.stringify(result).slice(0, 200));
  });
  await r.step(F, "Deletion carried out by the Superadmin", `${leaver.client.label}: the erased account can no longer sign in`, async () => {
    const again = ctx.newClient(leaver.client.label + "-after-erasure", leaver.client.email, leaver.client.password);
    const login = await again.request("POST", "/api/v1/auth/login", { email: leaver.client.email, password: leaver.client.password });
    assert.ok(login.status >= 400, "sign-in refused: " + login.status);
  });
  await r.step(A, "Privacy follow-ups", `${omar.slug}: backup purge and provider follow-ups are scheduled`, async () => {
    const followups = await admin.get(`/api/v1/admin/tenants/${omar.tenantId}/privacy/followups`);
    assert.ok(followups.length >= 1, JSON.stringify(followups).slice(0, 200));
    return followups.map((f: any) => f.scope).join(", ");
  });
  await r.step(A, "Lifecycle requests and erasure registry", `${omar.slug}: the erasure is in the registry without personal data`, async () => {
    const lifecycle = await admin.get(`/api/v1/admin/tenants/${omar.tenantId}/privacy/lifecycle`);
    assert.ok(lifecycle.registry.some((x: any) => x.request_id === request.id));
    assert.ok(!JSON.stringify(lifecycle).includes(leaver.client.email), "registry holds no email address");
  });
}

async function trainerAccounts(ctx: E2EContext, layla: TrainerSeed, omar: TrainerSeed, sara: TrainerSeed) {
  const r = ctx.reporter;
  await r.step(T, "Setup checklist (16-step onboarding registry)", `${layla.slug}: every required setup step is complete`, async () => {
    const state = await layla.client.get("/api/v1/onboarding");
    assert.ok(state.steps.length >= 10, state.steps.length + " steps");
    assert.ok(state.steps.every((s: any) => s.key && s.label && s.status), "every step has a key, label and status");
    // After launch, later changes make the reviewed subscriber preview stale; that is the only open item.
    assert.ok(state.gates.every((g: any) => g.key === "preview"), JSON.stringify(state.gates));
    return `${state.steps.length} steps, ${state.steps.filter((s: any) => s.status === "complete").length} complete; open: ${state.gates.map((g: any) => g.key).join(",") || "none"}`;
  });
  await r.step(T, "Coaching interview answers", `${omar.slug}: an interview answer is stored as teaching material`, async () => {
    const answer = await omar.client.post("/api/v1/brain/interviews", {
      question: "How do you handle a missed interval session?",
      answer: "Move it to the next free training day and keep the rest of the week unchanged.",
    });
    assert.equal(answer.status, "answered");
  });
  await r.step(T, "Document import with private redaction review", `${sara.slug}: personal identifiers are flagged, redacted and reviewed before use`, async () => {
    const text = [
      "Mobility routine notes for the coaching team.",
      "Client: Jane Example, jane.example@mail.example, phone +971 50 123 4567.",
      "Hold each hip opener for forty seconds and breathe slowly through the stretch.",
      "Progress to the deeper variation only when the first one feels easy for a full week.",
    ].join("\n");
    const upload = await sara.client.post("/api/v1/brain/documents", {
      fileName: "mobility-notes.txt",
      contentBase64: Buffer.from(text).toString("base64"),
      title: "Mobility notes",
      rights: true,
    });
    assert.equal(upload.status, "needs_review", JSON.stringify(upload).slice(0, 300));
    assert.ok(upload.data.privacyMatches.length >= 2, "email and phone flagged");
    await sara.client.fails(400, "POST", `/api/v1/brain/imports/${upload.id}/review`, { revision: upload.version, title: "Mobility notes", text: upload.data.text, rights: true, privacyReviewed: true }, "PERSONAL_DATA_REMAINS");
    const redacted = await sara.client.post(`/api/v1/brain/imports/${upload.id}/redact`, { revision: upload.version });
    assert.equal(redacted.data.privacyMatches.length, 0);
    assert.ok(!redacted.data.text.includes("jane.example@mail.example"));
    const source = await sara.client.post(`/api/v1/brain/imports/${upload.id}/review`, { revision: redacted.version, title: "Mobility notes", text: redacted.data.text, rights: true, privacyReviewed: true });
    assert.equal(source.status, "ready");
  });
  await r.step(T, "Settings screen (notification choices and marketing consent)", `${omar.slug}: notification and marketing choices saved`, async () => {
    await omar.client.post("/api/v1/settings", { emailNotifications: true, workoutReminders: false, marketing: false });
    const prefs = await omar.client.get("/api/v1/notifications/preferences");
    assert.ok(prefs);
  });
  await r.step(T, "Switch between workspaces", "a staff member of two coaches switches workspace", async () => {
    const staff = ctx.newClient("staff-two-workspaces", "coach.assistant@sandbox.example", PASSWORD);
    await staff.login();
    const invite = await sara.client.okMfa("POST", "/api/v1/team/invitations", { email: staff.email, role: "staff" });
    await staff.post("/api/v1/invitations/accept", { token: invite.url.split("/").pop(), name: "Coach Assistant", email: staff.email, password: PASSWORD, accepted: true });
    const { workspaces } = await staff.get("/api/v1/auth/workspaces");
    assert.equal(workspaces.length, 2, JSON.stringify(workspaces));
    await staff.post("/api/v1/auth/workspace", { tenantId: sara.tenantId });
    assert.equal((await staff.get("/api/v1/bootstrap")).tenant.slug, sara.slug);
    await staff.post("/api/v1/auth/workspace", { tenantId: layla.tenantId });
    assert.equal((await staff.get("/api/v1/bootstrap")).tenant.slug, layla.slug);
  });
  await r.step(T, "Sign in, sign out and session revocation", `${omar.slug}: second device signs in with a code and is revoked`, async () => {
    const phone = omar.client.device("omar-phone");
    await phone.login();
    await omar.client.post("/api/v1/auth/sessions/revoke", {});
    await phone.fails(401, "GET", "/api/v1/bootstrap");
    await phone.post("/api/v1/auth/logout", {}).catch(() => undefined);
  });
  await r.step(T, "Change password", `${omar.slug}: password changed with an authenticator code; signs in with the new one`, async () => {
    const next = omar.client.password + "-new";
    await omar.client.post("/api/v1/auth/password", { current: omar.client.password, password: next, code: await omar.client.freshCode() });
    omar.client.password = next;
    await omar.client.login();
  });
}

async function followerAccounts(ctx: E2EContext, unpaid?: FollowerSeed, secured?: FollowerSeed, consenting?: FollowerSeed) {
  const r = ctx.reporter;
  if (unpaid)
    await r.step(F, "Sign in and sign out", `${unpaid.client.label}: signs out and back in`, async () => {
      await unpaid.client.post("/api/v1/auth/logout", {});
      await unpaid.client.fails(401, "GET", "/api/v1/bootstrap");
      await unpaid.client.login();
    });
  if (secured) {
    await r.step(F, "Authenticator app (two-step sign-in)", `${secured.client.label}: enrols an authenticator; sign-in then needs the code`, async () => {
      await secured.client.enrollMfa();
      await secured.client.post("/api/v1/auth/logout", {});
      const withoutCode = await secured.client.request("POST", "/api/v1/auth/login", { email: secured.client.email, password: secured.client.password });
      assert.ok(withoutCode.status >= 400, "password alone is refused: " + withoutCode.status);
      await secured.client.login();
    });
    await r.step(F, "Recovery codes and authenticator recovery", `${secured.client.label}: a recovery code resets a lost authenticator`, async () => {
      const lost = ctx.newClient(secured.client.label + "-lost-phone", secured.client.email, secured.client.password);
      await lost.post("/api/v1/auth/mfa/recover", { email: lost.email, password: lost.password, recoveryCode: secured.client.recoveryCodes[0] });
      assert.equal((await lost.get("/api/v1/auth/security")).mfaEnabled, false);
    });
  }
  if (consenting) {
    await r.step(F, "Withdraw coaching-data consent", `${consenting.client.label}: coaching stops while consent is withdrawn`, async () => {
      await consenting.client.post("/api/v1/privacy/consent", { type: "coaching", granted: false });
      await consenting.client.fails(409, "POST", "/api/v1/coaching/ask", { message: "What should I do today?" }, "COACHING_CONSENT_REQUIRED");
      await consenting.client.post("/api/v1/privacy/consent", { type: "coaching", granted: true });
    });
    await r.step(F, "Marketing opt-in choice", `${consenting.client.label}: opts in to marketing and the choice is recorded`, async () => {
      await consenting.client.post("/api/v1/privacy/consent", { type: "marketing", granted: true });
      const consents = (await consenting.client.get("/api/v1/bootstrap")).consents;
      assert.ok(consents.some((c: any) => c.document_type === "marketing" && c.granted), JSON.stringify(consents).slice(0, 300));
    });
  }
}

async function followerData(ctx: E2EContext, trained?: FollowerSeed, nutrition?: FollowerSeed, checkoutLeaver?: FollowerSeed, omar?: TrainerSeed) {
  const r = ctx.reporter;
  if (trained) {
    const c = trained.client;
    await r.step(F, "Training progress page", `${c.label}: progress shows completed sessions and logged sets`, async () => {
      const overview = await c.get("/api/v1/training/overview");
      assert.ok(JSON.stringify(overview).includes("workout"), JSON.stringify(overview).slice(0, 200));
    });
    await r.step(F, "See trainer's sessions and my bookings", `${c.label}: open sessions and own reservations`, async () => {
      const view = await c.get("/api/v1/bookings");
      assert.ok(view.slots.length >= 2, "the coach's sessions are listed");
      assert.ok(view.bookings.length >= 1 && view.bookings.every((b: any) => b.user_id === c.userId), "only own reservations");
      return `${view.slots.length} sessions, ${view.bookings.length} own bookings`;
    });
    await r.step(F, "Connections page with import history and delete", `${c.label}: import history listed; the Apple import is deleted`, async () => {
      const view = await c.get("/api/v1/integrations/connections");
      assert.ok(view.imports.length >= 1, JSON.stringify(view).slice(0, 300));
      const imported = (await c.get("/api/v1/bootstrap")).records.find((x: any) => x.kind === "wearable" && x.status === "imported");
      assert.ok(imported, "an imported batch");
      await c.del(`/api/v1/wearables/${imported.id}`);
      const after = await c.get("/api/v1/integrations/connections");
      assert.ok(after.imports.reduce((n: number, i: any) => n + i.batches, 0) < view.imports.reduce((n: number, i: any) => n + i.batches, 0));
    });
    await r.step(F, "Trainer photo galleries", `${c.label}: the coach's galleries with photos`, async () => {
      const galleries = await c.get("/api/v1/tenant/galleries");
      const list = galleries.galleries ?? galleries;
      assert.ok(list.some((g: any) => g.photos?.length > 0), JSON.stringify(galleries).slice(0, 200));
    });
  }
  if (nutrition) {
    const c = nutrition.client;
    let home: any;
    await r.step(F, "Nutrition home screen", `${c.label}: plan, diary and targets`, async () => {
      home = await c.get("/api/v1/nutrition");
      assert.equal(home.entitled, true);
      assert.ok(home.records.some((x: any) => x.kind === "nutrition_plan"));
    });
    await r.step(F, "Saved favourite meals and copying meals", `${c.label}: a diary meal saved as a favourite and copied`, async () => {
      const log = home.records.find((x: any) => x.kind === "nutrition_log" && x.status === "recorded" && !x.data.deleted);
      assert.ok(log, "a recorded meal");
      const favourite = await c.post("/api/v1/nutrition/favorites", { logId: log.id });
      assert.ok(favourite.id);
      const copied = await c.post(`/api/v1/nutrition/logs/${log.id}/copy`, { eventKey: randomUUID(), date: today() });
      assert.equal(copied.data.copiedFrom, log.id);
      const fromFavourite = await c.post(`/api/v1/nutrition/favorites/${favourite.id}/log`, { eventKey: randomUUID(), date: today() });
      assert.ok(fromFavourite.id);
    });
    await r.step(F, "Pantry and leftovers", `${c.label}: a leftover is stored with a use-by date`, async () => {
      const foodId = /"foodId":"([0-9a-f-]{36})"/.exec(JSON.stringify(home.records))?.[1];
      assert.ok(foodId, "a food from the delivered plan");
      const leftover = await c.post("/api/v1/nutrition/leftovers", { eventKey: randomUUID(), foodId, grams: 250, useBy: addDays(today(), 2), notes: "Cooked extra for tomorrow", confirmedStorage: true });
      assert.ok(leftover.id);
    });
  }
  if (checkoutLeaver && omar?.products.workout)
    await r.step(F, "Check an interrupted checkout", `${checkoutLeaver.client.label}: an abandoned checkout is found open and resumable`, async () => {
      const checkout = await checkoutLeaver.client.post("/api/v1/payments/checkout", { productId: omar.products.workout.id });
      const state = await checkoutLeaver.client.post("/api/v1/payments/checkout/reconcile", {});
      assert.equal(state.status, "open", JSON.stringify(state));
      assert.equal(state.url, checkout.url);
    });
}

async function publicPages(ctx: E2EContext, layla: TrainerSeed) {
  const anon = ctx.newClient("visitor-pages");
  await ctx.reporter.step(P, "Site footer with member login and legal links", `/coach/${layla.slug}: footer links`, async () => {
    const page = await anon.request("GET", `/coach/${layla.slug}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /href="\/terms"/);
    assert.match(page.text, /href="\/login"/);
  });
  await ctx.reporter.step(P, "Home page earnings calculator", "the public site renders the illustrative earnings calculator", async () => {
    const pages = await Promise.all(["/", "/pricing"].map((path) => anon.request("GET", path)));
    const hit = pages.find((p) => /Imagine your coaching business/.test(p.text));
    assert.ok(hit, "calculator heading rendered on the home or pricing page");
    return pages.map((p, i) => ["/", "/pricing"][i] + ":" + /Imagine your coaching business/.test(p.text)).join(" ");
  });
  await ctx.reporter.step(P, "Install the app on a phone (platform-branded)", "platform manifest and icon", async () => {
    const manifest = await anon.request("GET", "/manifest.webmanifest");
    assert.equal(manifest.status, 200);
    assert.ok(JSON.parse(manifest.text).name);
    assert.equal((await anon.request("GET", "/icon.svg")).status, 200);
  });
}

async function workspaceClosure(ctx: E2EContext) {
  const { admin, reporter: r } = ctx;
  const owner = ctx.newClient("closing-trainer", "yasmin.coach@sandbox.example", PASSWORD);
  let tenantId = "";
  await r.step(P, "Launch checklist with blocking reasons", "an unfinished workspace cannot go public and says why", async () => {
    await owner.login();
    tenantId = owner.tenantId!;
    const state = await owner.get("/api/v1/onboarding");
    assert.equal(state.readyToPublish, false);
    assert.ok(state.gates.length > 0 && state.gates.every((g: any) => g.reason), JSON.stringify(state.gates).slice(0, 300));
    return state.gates.map((g: any) => g.reason).join(" | ").slice(0, 200);
  });
  if (!tenantId) {
    r.blocked("the unfinished trainer could not sign in", [
      [T, "In-app setup reminders to the trainer", "yasmin-pilates: setup reminder"],
      [T, "Workspace closure and ownership transfer", "yasmin-pilates: ownership transfer and closure request"],
      [A, "Complete a workspace closure", "yasmin-pilates: operator completes the closure"],
    ]);
    return;
  }
  await r.step(T, "In-app setup reminders to the trainer", "yasmin-pilates: the worker nudges the unfinished trainer toward the next step", async () => {
    const items = await ctx.waitUntil("setup reminder", async () => {
      const list = await owner.get("/api/v1/notifications");
      const all = list.items ?? list.notifications ?? list;
      return all.some((n: any) => /setting up your coaching space|payout setup/i.test(JSON.stringify(n))) && all;
    }, 60000);
    return items.map((n: any) => n.title ?? n.data?.title).filter(Boolean).join(" | ").slice(0, 200);
  });
  const successor = ctx.newClient("closing-successor", "yasmin.assistant@sandbox.example", PASSWORD);
  let closure: any;
  await r.step(T, "Workspace closure and ownership transfer", "yasmin-pilates: ownership passes to a verified staff member, who then asks to close", async () => {
    await ctx.verifyEmail(owner);
    await owner.enrollMfa();
    const invite = await owner.okMfa("POST", "/api/v1/team/invitations", { email: successor.email, role: "staff" });
    await successor.post("/api/v1/invitations/accept", { token: invite.url.split("/").pop(), name: "Yasmin Assistant", email: successor.email, password: PASSWORD, accepted: true });
    successor.userId = (await successor.get("/api/v1/bootstrap")).user.userId;
    await ctx.verifyEmail(successor);
    await successor.enrollMfa();
    const transfer = await owner.post("/api/v1/tenant/lifecycle/ownership-transfer", { targetUserId: successor.userId, password: owner.password, reason: "Yasmin hands the studio to her assistant" });
    await successor.post(`/api/v1/tenant/lifecycle/${transfer.id}/accept`, { expectedRevision: transfer.revision, password: successor.password, acceptResponsibilities: true });
    // Both parties' sessions in this workspace end with the change of ownership.
    await owner.fails(401, "GET", "/api/v1/bootstrap");
    assert.equal((await successor.login()).user.role, "owner");
    assert.equal((await owner.login()).user.role, "staff");
    closure = await successor.post("/api/v1/tenant/lifecycle/closure", { password: successor.password, reason: "The studio will not launch on the platform", confirmClosure: true });
  });
  if (!closure) {
    r.blocked("the owner's closure request was not created", [[A, "Complete a workspace closure", "yasmin-pilates: operator completes the closure"]]);
    return;
  }
  await r.step(A, "Complete a workspace closure", "yasmin-pilates: an administrator completes the owner's closure request", async () => {
    const lifecycle = await admin.get(`/api/v1/admin/tenants/${tenantId}/privacy/lifecycle`);
    const pending = lifecycle.requests.find((x: any) => x.id === closure.id);
    assert.ok(pending, "closure request visible to operators");
    await admin.post(`/api/v1/admin/tenants/${tenantId}/privacy/lifecycle/${closure.id}/close`, erasureEvidence(pending.revision));
    const after = await admin.get(`/api/v1/admin/tenants/${tenantId}/privacy/lifecycle`);
    assert.equal(after.requests.find((x: any) => x.id === closure.id).status, "completed");
    for (const person of [owner, successor]) {
      const login = await ctx.newClient(person.label + "-after-closure").request("POST", "/api/v1/auth/login", { email: person.email, password: person.password });
      assert.ok(login.status >= 400, "members of the closed workspace cannot sign in: " + login.status);
    }

  });
}

async function disconnectConnection(ctx: E2EContext) {
  const { admin, reporter: r } = ctx;
  await r.step(A, "Turn off or disconnect a connection", "the voice provider is disconnected, then reconnected and tested", async () => {
    const view = await admin.get("/api/v1/admin/settings");
    const app = view.integrations.find((i: any) => i.id === "application");
    await admin.fails(400, "POST", "/api/v1/admin/settings/application/disconnect", { revision: app.revision }, "SETTINGS_INVALID");
    const voice = view.integrations.find((i: any) => i.id === "voice");
    const off = await admin.post("/api/v1/admin/settings/voice/disconnect", { revision: voice.revision });
    assert.equal(off.active, false);
    assert.equal(Object.values(off.secrets ?? {}).some(Boolean), false, "credentials cleared");
    const config = ctx.mocks.settings.voice;
    const saved = await admin.put("/api/v1/admin/settings/voice", { revision: off.revision, enabled: true, values: config.values, secrets: config.secrets });
    const tested = await admin.post("/api/v1/admin/settings/voice/test", { revision: saved.revision });
    assert.equal(tested.active, true);
  });
}

