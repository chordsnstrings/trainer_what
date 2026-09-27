/**
 * Extended coverage, accounts and host operations: passkeys through a software
 * authenticator, password reset and sign-in links for accounts with an
 * authenticator, host-only operator commands (roles, authenticator resets,
 * readiness), personal data export, attendance and the public coach site seen
 * by a member. Feature names match the verified inventory.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Client } from "../harness/client.ts";
import type { E2EContext, FollowerSeed, TrainerSeed } from "../harness/context.ts";
import { PASSWORD } from "../harness/data.ts";
import { linkIn } from "../mocks/email.ts";
import { SoftwarePasskey } from "../harness/webauthn.ts";

const A = "Super admin" as const;
const T = "Trainers" as const;
const F = "followers" as const;

/** Registers a software passkey on the signed-in client, then signs in with it on a new device. */
async function passkeyRoundTrip(ctx: E2EContext, person: Client, label: string) {
  const key = new SoftwarePasskey(new URL(ctx.publicUrl).origin);
  const code = person.mfaSecret ? await person.freshCode() : undefined;
  const started = await person.post("/api/v1/auth/passkeys/register/options", { label, password: person.password, ...(code ? { code } : {}) });
  assert.equal(started.options.authenticatorSelection.userVerification, "required");
  const saved = await person.post("/api/v1/auth/passkeys/register/verify", { challengeId: started.challengeId, response: key.register(started.options) });
  assert.equal(saved.label, label);
  const listed = await person.get("/api/v1/auth/passkeys");
  assert.ok(JSON.stringify(listed).includes(saved.id), "the passkey is listed");
  const device = ctx.newClient(person.label + "-passkey-device");
  const challenge = await device.post("/api/v1/auth/passkeys/authenticate/options", {});
  await device.post("/api/v1/auth/passkeys/authenticate/verify", { challengeId: challenge.challengeId, response: key.authenticate(challenge.options) });
  const boot = await device.get("/api/v1/bootstrap");
  assert.equal(boot.user.userId, person.userId, "the passkey signed in the same person");
  // A replayed assertion is refused: the challenge was consumed.
  const replay = await device.request("POST", "/api/v1/auth/passkeys/authenticate/verify", { challengeId: challenge.challengeId, response: key.authenticate(challenge.options) });
  assert.ok(replay.status >= 400, "replayed passkey assertion refused");
  return saved;
}

export async function passkeys(ctx: E2EContext, layla: TrainerSeed, member?: FollowerSeed) {
  const r = ctx.reporter;
  await r.step(A, "Passkeys", "the Superadmin adds a passkey (with an authenticator code) and signs in with it", async () => {
    await passkeyRoundTrip(ctx, ctx.admin, "Operator laptop");
  });
  await r.step(T, "Passkeys and authenticator recovery codes", `${layla.slug}: passkey sign-in and a fresh set of recovery codes`, async () => {
    await passkeyRoundTrip(ctx, layla.client, "Studio laptop");
    const codes = await layla.client.post("/api/v1/auth/mfa/recovery-codes", { password: layla.client.password });
    const list = codes.recoveryCodes ?? codes.codes ?? codes;
    assert.ok(Array.isArray(list) && list.length >= 8, JSON.stringify(codes).slice(0, 120));
    assert.ok(!list.includes(layla.client.recoveryCodes[0]), "old codes replaced");
    layla.client.recoveryCodes = list;
  });
  if (member)
    await r.step(F, "Passkeys (fingerprint or face sign-in)", `${member.client.label}: a member adds a passkey and signs in with it`, async () => {
      await passkeyRoundTrip(ctx, member.client, "My phone");
    });
}

export async function accountRecovery(ctx: E2EContext, layla: TrainerSeed) {
  const r = ctx.reporter;
  const mailLink = async (who: Client, request: () => Promise<unknown>, pattern: RegExp, path: string) => {
    const before = ctx.mocks.email.inbox(who.email).length;
    await request();
    const mail = await ctx.mocks.email.waitFor(who.email, (m) => pattern.test(m.text), 90000, before);
    return linkIn(mail, path).pathname.split("/").pop()!;
  };
  await r.step(A, "Magic sign-in link", "an emailed sign-in link still needs the operator's authenticator code", async () => {
    const device = ctx.admin.device("admin-magic");
    const token = await mailLink(ctx.admin, () => device.post("/api/v1/auth/magic-link", { email: ctx.admin.email }), /magic-link\//, "/magic-link/");
    const withoutCode = await device.request("POST", "/api/v1/auth/magic-link/consume", { token });
    assert.ok(withoutCode.status >= 400, "link alone is refused for an authenticator account: " + withoutCode.status);
    await device.post("/api/v1/auth/magic-link/consume", { token, code: await device.freshCode() });
    assert.equal((await device.get("/api/v1/bootstrap")).user.userId, ctx.admin.userId);
  });
  await r.step(T, "Password reset and magic-link sign-in", `${layla.slug}: reset by email, then an emailed sign-in link with the authenticator code`, async () => {
    const device = layla.client.device("layla-reset");
    const reset = await mailLink(layla.client, () => device.post("/api/v1/auth/forgot-password", { email: layla.client.email }), /reset-password\//, "/reset-password/");
    const next = layla.client.password + "-reset";
    await device.post("/api/v1/auth/reset-password", { token: reset, password: next });
    layla.client.password = next;
    device.password = next;
    await layla.client.login();
    const magic = await mailLink(layla.client, () => device.post("/api/v1/auth/magic-link", { email: layla.client.email }), /magic-link\//, "/magic-link/");
    await device.post("/api/v1/auth/magic-link/consume", { token: magic, code: await device.freshCode() });
    assert.equal((await device.get("/api/v1/bootstrap")).tenant.id, layla.tenantId);
  });
  await r.step(A, "Forgot-password email", "the Superadmin resets a forgotten password by email and signs in with the authenticator", async () => {
    const device = ctx.admin.device("admin-reset");
    const token = await mailLink(ctx.admin, () => device.post("/api/v1/auth/forgot-password", { email: ctx.admin.email }), /reset-password\//, "/reset-password/");
    const next = ctx.admin.password + "-reset";
    await device.post("/api/v1/auth/reset-password", { token, password: next });
    ctx.admin.password = next;
    ctx.adminCredentials.password = next;
    await ctx.admin.login();
  });
}

export async function hostOperators(ctx: E2EContext, omar: TrainerSeed, layla: TrainerSeed, member?: FollowerSeed) {
  const r = ctx.reporter;
  const operator = (env: Record<string, string>, args: string[] = []) => ctx.hostCommand("scripts/operator.ts", args, env);
  const role = async (target: string, value: string, code: string) =>
    operator({
      OPERATOR_ACTOR_EMAIL: ctx.admin.email,
      OPERATOR_ACTOR_CODE: code,
      OPERATOR_EMAIL: target,
      OPERATOR_ROLE: value,
      OPERATOR_REASON: "Sandbox operator role review",
    });
  const staff = ctx.newClient("staff-operator-candidate", "coach.assistant@sandbox.example", PASSWORD);
  await r.step(A, "Email address verification", "platform authority needs a verified email and an authenticator first", async () => {
    await staff.login();
    const unverified = await role(staff.email, "support", "000000");
    assert.notEqual(unverified.status, 0);
    assert.match(unverified.stderr, /Verify the account's email/);
    await ctx.verifyEmail(staff);
    assert.equal((await staff.get("/api/v1/bootstrap")).user.emailVerified, true);
    const noAuthenticator = await role(staff.email, "support", "000000");
    assert.match(noAuthenticator.stderr, /enable an authenticator/);
  });
  await r.step(A, "Grant or change operator roles (npm run operator:role)", `${omar.client.email.split("@")[0]}: finance role granted from the host with the Superadmin's code`, async () => {
    const granted = await role(omar.client.email, "finance", await ctx.admin.freshCode());
    assert.equal(granted.status, 0, granted.stderr.slice(0, 300));
    assert.match(granted.stdout, /Operator role changed from none to finance/);
  });
  await r.step(A, "Scoped finance, support and safety operators", "a finance operator reads finance views but not settings or safety", async () => {
    const finance = await omar.client.okMfa("GET", `/api/v1/admin/tenants/${layla.tenantId}/finance`);
    assert.ok(finance.summary);
    await omar.client.fails(403, "GET", "/api/v1/admin/operations/safety", undefined, "OPERATOR_SCOPE");
    await omar.client.fails(403, "GET", "/api/v1/admin/settings");
    const revoked = await role(omar.client.email, "none", await ctx.admin.freshCode());
    assert.equal(revoked.status, 0, revoked.stderr.slice(0, 300));
    await omar.client.fails(403, "GET", `/api/v1/admin/tenants/${layla.tenantId}/finance`);
  });
  await r.step(A, "Last-Superadmin protection and self-recovery", "the only Superadmin cannot be demoted", async () => {
    const demote = await role(ctx.admin.email, "none", await ctx.admin.freshCode());
    assert.notEqual(demote.status, 0);
    assert.match(demote.stderr, /Grant another Superadmin before removing the last one/);
    assert.equal((await ctx.admin.get("/api/v1/bootstrap")).user.platformRole ?? "admin", "admin");
  });
  if (member)
    await r.step(A, "Member authenticator reset by a Superadmin", `${member.client.label}: lost authenticator reset from the host and the member is told by email`, async () => {
      await member.client.enrollMfa();
      const before = ctx.mocks.email.inbox(member.client.email).length;
      const reset = await ctx.hostCommand("scripts/reset-mfa.ts", [], {
        OPERATOR_ACTOR_EMAIL: ctx.admin.email,
        OPERATOR_ACTOR_CODE: await ctx.admin.freshCode(),
        OPERATOR_EMAIL: member.client.email,
        OPERATOR_REASON: "Member lost phone and codes; identity checked by video call",
      });
      assert.equal(reset.status, 0, reset.stderr.slice(0, 300));
      await member.client.fails(401, "GET", "/api/v1/bootstrap");
      member.client.mfaSecret = undefined;
      await member.client.login();
      assert.equal((await member.client.get("/api/v1/auth/security")).mfaEnabled, false);
      await ctx.mocks.email.waitFor(member.client.email, (m) => /authenticator was reset/i.test(m.subject + " " + m.text), 90000, before);
    });
  await r.step(A, "Emergency authenticator reset (npm run operator:role -- reset-mfa)", `${omar.slug}: host reset of a lost authenticator; the owner sets up a new one`, async () => {
    const reset = await operator({ OPERATOR_EMAIL: omar.client.email }, ["reset-mfa"]);
    assert.equal(reset.status, 0, reset.stderr.slice(0, 300));
    await omar.client.fails(401, "GET", "/api/v1/bootstrap");
    omar.client.mfaSecret = undefined;
    await omar.client.login();
    await omar.client.enrollMfa();
    assert.equal((await omar.client.get("/api/v1/auth/security")).mfaEnabled, true);
  });
  await r.step(A, "Readiness report (npm run readiness)", "the readiness report flags the mock-provider sandbox and checks the database", async () => {
    const report = await ctx.hostCommand("scripts/readiness.ts");
    const parsed = JSON.parse(report.stdout);
    assert.equal(report.status, 1, "findings make the report fail");
    assert.ok(parsed.findings.some((f: string) => f.startsWith("MOCK PROVIDERS")), JSON.stringify(parsed.findings));
    assert.match(parsed.database, /connected/);
    return parsed.findings.length + " findings";
  });
}

export async function trainerData(ctx: E2EContext, layla: TrainerSeed, follower?: FollowerSeed) {
  const r = ctx.reporter;
  await r.step(T, "Download my data and request deletion", `${layla.slug}: personal export; owner erasure needs closure or transfer first`, async () => {
    const exported = await layla.client.request("GET", "/api/v1/privacy/export");
    assert.equal(exported.status, 200);
    assert.ok(exported.text.includes(layla.client.email));
    const request = await layla.client.post("/api/v1/privacy/delete-request", {});
    await ctx.admin.stepUp();
    const queue = await ctx.admin.get(`/api/v1/admin/tenants/${layla.tenantId}/privacy`);
    const pending = queue.find((x: any) => x.id === request.id);
    await ctx.admin.fails(409, "POST", `/api/v1/admin/tenants/${layla.tenantId}/privacy/${request.id}/erase`, {
      providerReviewComplete: true,
      thirdPartySourceReviewComplete: true,
      evidenceReference: "Sandbox owner deletion review",
      retentionPolicyVersion: "sandbox-retention-v1",
      backupPurgeBy: new Date(Date.now() + 30 * 86400000).toISOString(),
      providers: [],
      expectedRevision: pending.version,
    }, "WORKSPACE_CLOSURE_REQUIRED");
  });
  if (follower)
    await r.step(T, "Attendance, no-shows and calendar export", `${layla.slug}: a finished free class is marked attended; the calendar exports it`, async () => {
      const view = await layla.client.get("/api/v1/bookings");
      const free = view.bookings.find(
        (b: any) => b.user_id === follower.client.userId && b.status === "confirmed" && Number(view.slots.find((s: any) => s.id === b.slot_id)?.price_minor ?? 0) === 0,
      );
      assert.ok(free, "a confirmed free booking");
      await ctx.advanceClock(
        `${layla.slug}: move one booked free class two days back so it has finished`,
        `SET LOCAL session_replication_role = replica;
         UPDATE booking_slots SET starts_at=now()-interval '2 days',ends_at=now()-interval '2 days'+interval '1 hour' WHERE id=$1`,
        [free.slot_id],
      );
      const marked = await layla.client.post(`/api/v1/bookings/${free.id}/outcome`, { status: "attended" });
      assert.equal(marked.status, "attended");
      const calendar = await layla.client.request("GET", "/api/v1/bookings/calendar.ics");
      assert.equal(calendar.status, 200);
      assert.match(calendar.text, /BEGIN:VCALENDAR/);
    });
}

export async function publicSiteAsMember(ctx: E2EContext, layla: TrainerSeed, member?: FollowerSeed) {
  if (!member) return;
  const c = member.client;
  await ctx.reporter.step(F, "Coach's public website, galleries and enquiry form", `${c.label}: the coach's site, gallery and enquiry form`, async () => {
    const home = await c.request("GET", `/coach/${layla.slug}`);
    assert.equal(home.status, 200);
    const galleries = await c.request("GET", `/coach/${layla.slug}/galleries`);
    assert.match(galleries.text, /Studio/);
    const sent = await c.request("POST", `/api/v1/public/sites/${layla.slug}/contact`, {
      name: "Member question",
      email: c.email,
      message: "Do you run a Saturday class for members next month?",
      consent: true,
    });
    assert.ok(sent.status < 300, sent.text.slice(0, 200));
  });
  await ctx.reporter.step(F, "Install as a phone app", `${c.label}: coach manifest, icon and offline service worker are served`, async () => {
    const manifest = await c.request("GET", `/api/v1/public/sites/${layla.slug}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    const parsed = JSON.parse(manifest.text);
    assert.ok(parsed.name && parsed.icons?.length, manifest.text.slice(0, 200));
    const worker = await c.request("GET", "/sw.js");
    assert.equal(worker.status, 200);
    assert.match(worker.headers.get("content-type") ?? "", /javascript/);
  });
}

export async function evidenceLog(ctx: E2EContext, layla: TrainerSeed) {
  await ctx.reporter.step(A, "Evidence in each workspace's own log", `${layla.slug}: operator reviews and finance actions appear in the workspace history`, async () => {
    const events = (await layla.client.get("/api/v1/bootstrap")).events ?? [];
    const text = JSON.stringify(events);
    assert.ok(/safety\.operator_review/.test(text), "operator safety review recorded in the workspace log");
    assert.ok(/finance\.cost_allocated/.test(text), "operator cost allocation recorded in the workspace log");
  });
}



/** Schedules a trainer follow-up due in a little over a minute; delivery is checked later. */
export async function scheduleFollowup(layla: TrainerSeed, member?: FollowerSeed) {
  if (!member) return undefined;
  const text = "Checking in after your first week: which session felt hardest?";
  const created = await layla.client.post("/api/v1/coaching/followups", {
    subscriberId: member.client.userId,
    requestKey: crypto.randomUUID(),
    text,
    dueAt: new Date(Date.now() + 70000).toISOString(),
    timezone: "Asia/Dubai",
    reviewed: true,
  });
  return { id: created.id as string, text, member };
}

export async function memberExperience(
  ctx: E2EContext,
  layla: TrainerSeed,
  trained?: FollowerSeed,
  unpaid?: FollowerSeed,
  followup?: { id: string; text: string; member: FollowerSeed },
  newlyAssigned?: FollowerSeed,
) {
  const r = ctx.reporter;
  if (newlyAssigned && layla.programTemplateId) {
    const c = newlyAssigned.client;
    await r.step(F, "Workout reminders and program-ready or missed-session messages", `${c.label}: after a program is assigned, the worker tells the member it is ready`, async () => {
      const template = (await layla.client.get("/api/v1/training/overview")).records.find((x: any) => x.id === layla.programTemplateId);
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const program = await layla.client.post(`/api/v1/programs/${layla.programTemplateId}/assign`, { subscriberId: c.userId, version: template.version, startDate: today, timezone: "Asia/Dubai" });
      assert.equal(program.status, "assigned");
      const inbox = await ctx.waitUntil("program-ready notice", async () => {
        const list = await c.get("/api/v1/notifications");
        const items = list.items ?? list.notifications ?? list;
        return items.some((n: any) => /program is ready/i.test(JSON.stringify(n))) && items;
      }, 90000);
      return `${inbox.length} notifications`;
    });
  }
  if (trained) {
    const c = trained.client;
    await r.step(F, "Trainer takeover notice", `${c.label}: the chat shows the trainer is handling it personally, then hands back`, async () => {
      await layla.client.post("/api/v1/takeover", { subscriberId: c.userId, active: true });
      assert.equal((await c.get("/api/v1/messages/thread")).personalReview, true);
      await layla.client.post("/api/v1/takeover", { subscriberId: c.userId, active: false });
      assert.equal((await c.get("/api/v1/messages/thread")).personalReview, false);
    });
    await r.step(F, "Edit personal coaching preferences", `${c.label}: likes, dislikes and style saved; the coach sees them`, async () => {
      const path = `/api/v1/clients/${c.userId}/context`;
      const current = await c.get(path);
      const saved = await c.put(path, {
        version: current.version,
        data: {
          communicationStyle: "concise",
          communicationNotes: "Short messages after 8pm please.",
          exerciseLikes: ["Goblet squat"],
          exerciseDislikes: ["Burpees"],
          datedChanges: [],
        },
      });
      assert.equal(saved.data.communicationStyle, "concise");
      const coachView = await layla.client.get(path);
      assert.deepEqual(coachView.data.exerciseDislikes, ["Burpees"]);
    });
  }
  if (unpaid)
    await r.step("public-join", "First steps a new follower can take without paying", `${unpaid.client.label}: profile and a message to the coach before paying; training waits`, async () => {
      await unpaid.client.post("/api/v1/intake", {
        age: 35,
        goal: "Move without back pain",
        experience: "beginner",
        daysPerWeek: 2,
        equipment: "None",
        limitations: "None reported",
        consent: true,
      });
      await unpaid.client.post("/api/v1/messages", { text: "Hi coach, what should I expect in the first week?" });
      await unpaid.client.fails(402, "POST", "/api/v1/workouts/start", { programId: crypto.randomUUID() }, "MEMBERSHIP_REQUIRED");
    });
  if (followup)
    await r.step(F, "Scheduled follow-up messages from the trainer", `${followup.member.client.label}: the trainer's scheduled follow-up arrives when due`, async () => {
      await ctx.waitUntil("follow-up delivery", async () => {
        const thread = await followup.member.client.get("/api/v1/messages/thread");
        return thread.messages.some((m: any) => JSON.stringify(m).includes(followup.text));
      }, 150000);
    });
}

export async function nutritionImport(ctx: E2EContext, layla: TrainerSeed) {
  await ctx.reporter.step(T, "Nutrition document import", `${layla.slug}: a nutrition guide is imported as teaching material and confirmed`, async () => {
    const text = [
      "Portion guide for busy clients.",
      "Build each lunch from a palm of protein, a fist of carbohydrate and two fists of vegetables.",
      "Contact: coach.office@studio.example for questions.",
    ].join("\n");
    const source = await layla.client.post("/api/v1/nutrition/documents", {
      title: "Portion guide",
      fileName: "portion-guide.txt",
      contentBase64: Buffer.from(text).toString("base64"),
      rights: true,
    });
    assert.equal(source.status, "extracted");
    await layla.client.post(`/api/v1/nutrition/sources/${source.id}/confirm`, {});
    // Recorded for the report: unlike Brain imports, no personal-identifier review runs here.
    return `stored text keeps the email address: ${String(source.data.text).includes("coach.office@studio.example")}`;
  });
}

export async function hostAudit(ctx: E2EContext) {
  await ctx.reporter.step(A, "Host command audit", "host role changes and authenticator resets are in the operator audit", async () => {
    const view = await ctx.admin.get("/api/v1/admin/operations/security");
    const actions = view.rows.map((x: any) => x.action);
    assert.ok(actions.filter((a: string) => a === "platform.role_changed").length >= 2, actions.join(","));
    assert.ok(actions.includes("security.mfa_reset"), actions.join(","));
  });
}

export async function alertThresholds(ctx: E2EContext) {
  const admin = ctx.admin;
  await ctx.reporter.step(A, "Alert thresholds and recommendations", "a tight memory threshold opens a recommendation; restoring it lets a fresh measurement resolve it", async () => {
    await admin.stepUp();
    const base = await admin.get("/api/v1/admin/infrastructure");
    const original = base.policy.thresholds;
    const tight = await admin.post("/api/v1/admin/infrastructure/policy", {
      requestId: crypto.randomUUID(),
      revision: base.policy.revision,
      thresholds: { ...original, processRssMb: 16 },
      reasonCode: "baseline_tuning",
    });
    const opened = await ctx.waitUntil("memory recommendation", async () => {
      const view = await admin.get("/api/v1/admin/infrastructure");
      return view.recommendations.find((x: any) => x.status === "open" && /rss|memory/i.test(x.rule + " " + x.title));
    }, 120000);
    const acknowledged = await admin.post(`/api/v1/admin/infrastructure/recommendations/${opened.id}/acknowledge`, {
      requestId: crypto.randomUUID(),
      revision: opened.revision,
      evidenceId: opened.latest_observation_id,
      policyRevision: tight.revision,
    });
    assert.equal(acknowledged.status, "acknowledged");
    const restored = await admin.post("/api/v1/admin/infrastructure/policy", {
      requestId: crypto.randomUUID(),
      revision: tight.revision,
      thresholds: original,
      reasonCode: "baseline_tuning",
    });
    const recovered = await ctx.waitUntil("fresh recovery measurement", async () => {
      const view = await admin.get("/api/v1/admin/infrastructure");
      const row = view.recommendations.find((x: any) => x.id === opened.id);
      return row?.canResolve && row.latest_observation_id === row.recovery_observation_id && row;
    }, 180000);
    const resolved = await admin.post(`/api/v1/admin/infrastructure/recommendations/${opened.id}/resolve`, {
      requestId: crypto.randomUUID(),
      revision: recovered.revision,
      evidenceId: recovered.latest_observation_id,
      policyRevision: restored.revision,
    });
    assert.equal(resolved.status, "resolved");
    return opened.title;
  });
}

/** Runs last: afterwards the running API still holds the retired key. */
export async function keyRotation(ctx: E2EContext) {
  await ctx.reporter.step(A, "Encryption key rotation (npm run secrets:reseal)", "stored secrets are re-sealed with a new key and the retired key no longer opens them", async () => {
    const retired = ctx.hostSetting("SECURITY_ENCRYPTION_KEY");
    assert.ok(retired, "the service key is known to the harness");
    const next = crypto.randomBytes(32).toString("base64");
    const rotation = { SECURITY_ENCRYPTION_KEY: next, SECURITY_ENCRYPTION_PREVIOUS_KEYS: retired };
    const readiness = async (env: Record<string, string> = {}) => JSON.parse((await ctx.hostCommand("scripts/readiness.ts", [], env)).stdout);
    const before = await readiness(rotation);
    assert.ok(before.sealedValues.previous > 0, JSON.stringify(before.sealedValues));
    const reseal = await ctx.hostCommand("scripts/reseal-secrets.ts", [], rotation);
    assert.equal(reseal.status, 0, reseal.stderr.slice(0, 300));
    assert.ok(!reseal.stdout.includes(next) && !reseal.stdout.includes(retired), "no key material printed");
    const after = await readiness({ SECURITY_ENCRYPTION_KEY: next });
    assert.equal(after.sealedValues.previous, 0);
    assert.equal(after.sealedValues.unreadable, 0);
    const oldOnly = await readiness();
    assert.ok(oldOnly.sealedValues.unreadable > 0, "the retired key alone cannot open re-sealed values");
    return `${before.sealedValues.previous} values re-sealed`;
  });
}

export async function coachNutrition(ctx: E2EContext, layla: TrainerSeed, member?: FollowerSeed) {
  if (!member) return;
  const uid = member.client.userId!;
  await ctx.reporter.step(T, "Client calorie targets and coach meal-plan editing", `${layla.slug}: an individual target for ${member.client.label}, then the delivered week re-issued by the coach`, async () => {
    const home = await layla.client.get(`/api/v1/nutrition?userId=${uid}`);
    const plan = home.records.find((x: any) => x.kind === "nutrition_plan" && x.status === "delivered");
    assert.ok(plan && home.profile, "a delivered week and a food profile");
    const active = (home.targets ?? []).find((x: any) => x.status === "active") ?? null;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const reviewOn = new Date(Date.parse(today + "T00:00:00Z") + 14 * 86400000).toISOString().slice(0, 10);
    const target = await layla.client.post(`/api/v1/nutrition/clients/${uid}/target`, {
      previousId: active?.id ?? null,
      profileId: home.profile.id,
      methodId: null,
      target: {
        kcal: plan.data.view.targetKcal,
        protein: null,
        carbohydrate: null,
        fat: null,
        macroTolerancePercent: 10,
        hydrationMl: 2500,
        habits: ["Drink a glass of water with each meal"],
        reviewOn,
        reason: "Confirmed after the first week's check-in",
        allowAutomaticAdjustment: false,
      },
    });
    assert.equal(target.status, "active");
    const reissued = await layla.client.post(`/api/v1/nutrition/clients/${uid}/plan`, {
      weekStart: plan.data.weekStart,
      profileId: home.profile.id,
      previousId: plan.id,
      previousVersion: plan.version,
      week: plan.data.choices,
      reason: "Re-issued with the individual hydration habit",
    });
    assert.equal(reissued.status, "delivered");
    assert.equal(reissued.data.origin, "coach_assigned");
    const after = await member.client.get("/api/v1/nutrition");
    assert.ok(after.records.some((x: any) => x.id === reissued.id), "the member sees the coach's week");
  });
}

export async function memberReminders(ctx: E2EContext, layla: TrainerSeed, member?: FollowerSeed) {
  if (!member) return;
  const c = member.client;
  await ctx.reporter.step(T, "Subscriber workout and booking reminders", `${c.label}: today's training and a session within 24 hours are reminded`, async () => {
    const start = new Date(Date.now() + 5 * 3600000);
    start.setUTCMinutes(0, 0, 0);
    const slot = await layla.client.post("/api/v1/bookings/slots", { title: "Evening mobility drop-in", location: "Studio A, Dubai", startsAt: start.toISOString(), durationMinutes: 45, capacity: 6, priceMinor: 0 });
    const reserved = await c.post(`/api/v1/bookings/slots/${slot.id}/reserve`, {});
    assert.equal(reserved.status, "confirmed");
    // The Superadmin published a "workout-reminder" template earlier in this suite, so the workout
    // reminder must use that template's title and wording; the booking reminder keeps the default.
    const items = await ctx.waitUntil("workout and booking reminders", async () => {
      const list = await c.get("/api/v1/notifications");
      const all: any[] = list.items ?? list.notifications ?? list;
      const booking = all.find((n) => /session is coming up/i.test(n.title ?? ""));
      const workout = all.find((n) => n.category === "workout" && /^Workout reminder$/.test(n.title ?? ""));
      return booking && workout && { booking, workout };
    }, 90000);
    assert.match(items.workout.body, /^Hi /, "template body rendered with the member's name");
    // {{coach}} is the workspace name; {{date}} is the recipient's local date when sent (documented).
    assert.ok(!/\{\{|Your coach has/.test(items.workout.body), "every variable rendered, coach named: " + items.workout.body);
    return `${items.booking.title} | ${items.workout.title}: ${String(items.workout.body).slice(0, 60)}`;
  });
}
