import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { accountsContext, cookieValue, sessionCookie, withEnv } from "./accounts-fixtures.ts";
import { memberAccess } from "../apps/api/src/entitlements.ts";
import { businessAnalytics } from "../apps/api/src/admin-operations.ts";
import { computeBusinessMetrics } from "../apps/api/src/business-metrics.ts";
import { previewReviewer, previewRouteAllowed } from "../apps/api/src/trainer-preview-access.ts";
import { notifyUser } from "../apps/api/src/notifications.ts";
import { seedPreviewBrain, previewIntake } from "./trainer-preview-fixtures.ts";
import { ruleBasedAnswer } from "./e2e/mocks/model-rules.ts";
import { elevated, putRecord } from "@trainer/db";
import { autoReviewPreviewReply } from "../apps/api/src/trainer-preview-review.ts";
import { memberApiUrl, memberHref, subscriberPath } from "../apps/web/lib/trainer-preview-routing.ts";

test("trainer preview uses a bound private member without replacing the trainer login", async () => {
  const ctx = await accountsContext();
  try {
    const owner = await ctx.person({ role: "owner" });
    const start = await ctx.call("/trainer-preview/start", { cookie: owner.cookie, body: {} });
    assert.equal(start.statusCode, 200, start.body);
    assert.equal(sessionCookie(start), "");
    const token = cookieValue(start, "trainer_preview");
    assert.ok(token);
    assert.match(String(start.headers["set-cookie"]), /Path=\/api\/v1\/trainer-preview/);
    const cookie = owner.cookie + "; " + token;
    const [normal, preview] = await Promise.all([
      ctx.call("/bootstrap", { cookie }),
      ctx.call("/trainer-preview/run/bootstrap", { cookie }),
    ]);
    assert.equal(normal.statusCode, 200, normal.body);
    assert.equal(normal.json().user.userId, owner.userId);
    assert.equal(normal.json().user.role, "owner");
    assert.equal(preview.statusCode, 200, preview.body);
    const member = preview.json().user;
    assert.equal(member.role, "subscriber");
    assert.notEqual(member.userId, owner.userId);
    assert.equal(preview.json().trainerPreview.trainerUserId, owner.userId);
    const a = { ...owner, role: "owner" as const };
    const access = await ctx.db.tenant({ ...a, userId: member.userId, role: "subscriber" }, tx => memberAccess(tx, member.userId));
    assert.deepEqual(access.sources, ["preview"]);
    const hidden = await ctx.db.tenant(a, tx => tx.query("SELECT user_id FROM memberships WHERE user_id=$1", [member.userId]));
    assert.equal(hidden.length, 0);
    const visible = await ctx.db.tenant(previewReviewer(a, member.userId), tx => tx.query("SELECT user_id FROM memberships WHERE user_id=$1", [member.userId]));
    assert.equal(visible.length, 1);
    await ctx.person({ role: "subscriber", tenantId: owner.tenantId });
    const analytics = await businessAnalytics(ctx.db, a);
    assert.equal(analytics.cohorts.reduce((sum, c) => sum + c.joined, 0), 1);
    assert.equal((await computeBusinessMetrics(ctx.db, a, { months: 1 })).snapshot.followers, 1);
    const admin = await ctx.person({ platformRole: "admin", mfaFresh: true });
    const directory = await ctx.call("/admin/governance/workspaces", { cookie: admin.cookie });
    assert.equal(directory.statusCode, 200, directory.body);
    assert.equal(directory.json().workspaces.find((r: any) => r.id === owner.tenantId).followers, 1);
    const notification = await ctx.db.tenant({ ...a, userId: member.userId, role: "subscriber" }, tx => notifyUser(tx, { ...a, userId: member.userId, role: "subscriber" }, { userId: owner.userId, category: "coaching", dedupeKey: "preview-test", title: "Test", body: "Test", href: "/trainer" }));
    assert.equal(notification, null);
    const [sessions] = await ctx.db.system(tx => tx.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1", [member.userId]));
    assert.equal(sessions.n, 0);
    const [counts] = await ctx.db.tenant(previewReviewer(a, member.userId), tx => tx.query("SELECT (SELECT count(*)::int FROM subscriptions WHERE user_id=$1) AS subscriptions,(SELECT count(*)::int FROM complimentary_access WHERE user_id=$1) AS grants", [member.userId]));
    assert.deepEqual(counts, { subscriptions: 0, grants: 0 });
    await assert.rejects(ctx.db.system(tx => tx.query("INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [randomUUID(), member.userId, owner.tenantId])), /preview cannot have a login session/);
    const ended = await ctx.call("/trainer-preview/end", { cookie, body: {} });
    assert.equal(ended.statusCode, 200, ended.body);
    assert.equal(sessionCookie(ended), "");
    assert.equal((await ctx.call("/trainer-preview/run/bootstrap", { cookie })).statusCode, 409);
    assert.equal((await ctx.call("/bootstrap", { cookie: owner.cookie })).json().user.userId, owner.userId);
    const resumed = await ctx.call("/trainer-preview/start", { cookie: owner.cookie, body: {} });
    assert.equal(resumed.json().profileId, start.json().profileId);
  } finally { await ctx.close(); }
});

test("preview navigation scopes member URLs without changing trainer controls or ordinary sessions", () => {
  const path = "/trainer/preview/app/chat";
  assert.equal(subscriberPath(path), "/app/chat");
  assert.equal(memberHref("/app/nutrition?date=2026-10-09", path), "/trainer/preview/app/nutrition?date=2026-10-09");
  assert.equal(memberApiUrl("/api/v1/nutrition/generate", path), "/api/v1/trainer-preview/run/nutrition/generate");
  assert.equal(memberApiUrl("/api/v1/trainer-preview/end", path), "/api/v1/trainer-preview/end");
  assert.equal(memberApiUrl("/api/v1/coaching/ask", "/app/chat"), "/api/v1/coaching/ask");
  assert.equal(memberHref("/trainer/brain", path), "/trainer/brain");
});

test("preview automatically delivers real chat and valid generated workouts and saved logs without customer learning or outreach", async () => {
  const ctx = await accountsContext(), original = globalThis.fetch;
  try {
    const owner = await ctx.person({ role: "owner" }), a = { ...owner, role: "owner" as const };
    await seedPreviewBrain(ctx.db, a);
    const start = await ctx.call("/trainer-preview/start", { cookie: owner.cookie, body: {} });
    const cookie = owner.cookie + "; " + cookieValue(start, "trainer_preview");
    async function ok(path: string, body?: any) {
      const result = await ctx.call("/trainer-preview/run" + path, { cookie, body });
      assert.equal(result.statusCode, 200, path + ": " + result.body); return result.json();
    }
    const member = (await ok("/bootstrap")).user;
    const beforePlan = await ok("/programme/today");
    assert.equal(beforePlan.planState, "awaiting_coach");
    assert.equal(beforePlan.programme.billing, "preview");
    const queued: any[] = [];
    await withEnv({ MODEL_BASE_URL: "https://preview-fixture.invalid/v1", MODEL_API_KEY: "synthetic-preview", MODEL_NAME: "preview-fixture", MODEL_PRICE_VERSION: "fixture", MODEL_INPUT_USD_PER_MILLION: "1", MODEL_OUTPUT_USD_PER_MILLION: "2", MODEL_MAX_DAILY_CALLS: "1000" }, async () => {
      globalThis.fetch = async (url, init) => {
        assert.ok(String(url).startsWith("https://preview-fixture.invalid/"));
        const body = JSON.parse(String(init?.body)), result = ruleBasedAnswer(body); queued.push(result.kind);
        if (result.kind === "coach_decision") result.content = { ...(result.content as any), type: "message", message: "Take your time learning the movements and keep the sessions manageable." };
        return Response.json({ usage: { prompt_tokens: 50, completion_tokens: 50 }, choices: [{ message: { content: JSON.stringify(result.content) } }] });
      };
      const saved = await ok("/intake", previewIntake);
      assert.equal(saved.previewWorkout?.status, "delivered", "The intake API must deliver the validated preview workout without a browser effect.");
      assert.ok(saved.previewWorkout.programId);
      assert.deepEqual(queued, ["plan_generation"]);
      const reply = await ok("/coaching/ask", { message: "How should I think about strength progression this week?" });
      assert.equal(reply.pendingReview, false);
      assert.equal(reply.privatePreviewApproval, true);
      const status = (await ctx.call("/trainer-preview", { cookie: owner.cookie })).json();
      assert.equal(status.decisions.length, 0);
      assert.ok((await ok("/messages/thread")).messages.some((m: any) => m.data.author === "digital_reviewed"));
      const generated = await ctx.call("/trainer-preview/workout", { cookie: owner.cookie, body: {} });
      assert.equal(generated.statusCode, 200, generated.body);
      assert.equal(generated.json().status, "delivered", generated.body);
      assert.equal(generated.json().programId, saved.previewWorkout.programId);
      const retry = await ctx.call("/trainer-preview/workout", { cookie: owner.cookie, body: {} });
      assert.equal(retry.json().programId, generated.json().programId);
      assert.equal(queued.filter(k => k === "plan_generation").length, 1);
      const planStatus = (await ctx.call("/trainer-preview", { cookie: owner.cookie })).json();
      assert.deepEqual(planStatus.generation.errors, []);
      assert.equal(planStatus.generation.status, "delivered");
      const plan = await ok("/brain/plans/mine");
      assert.equal(plan.status.state, "delivered");
      const today = await ok("/programme/today");
      assert.equal(today.planState, "ready");
      assert.deepEqual(today.access.sources, ["preview"]);
      assert.equal(today.programme.billing, "preview");
      assert.equal(today.endOfProgramme.renewProductId, null);
      const overview = await ok("/training/overview"), session = overview.records.find((r: any) => r.kind === "planned_session" && r.status === "planned");
      assert.ok(session);
      const workout = await ok("/workouts/start", { programId: session.data.programId, plannedSessionId: session.id });
      const exercise = workout.data.program.exercises[0];
      await ok("/workouts/" + workout.id + "/sets", { eventKey: randomUUID(), exercise: exercise.name, exerciseIndex: 0, set: 1, reps: 8, loadKg: 0 });
      const boot = await ok("/bootstrap");
      assert.equal(boot.sets.length, 1);
    });
    const hidden = await ctx.db.tenant(a, tx => tx.query("SELECT id FROM records WHERE owner_user_id=$1", [member.userId]));
    assert.equal(hidden.length, 0);
    const workerRows = await ctx.db.tenant(elevated("worker", { tenantId: a.tenantId, role: "owner" }), tx => tx.query("SELECT id FROM records WHERE owner_user_id=$1", [member.userId]));
    assert.equal(workerRows.length, 0);
    const [counts] = await ctx.db.tenant(previewReviewer(a, member.userId), tx => tx.query("SELECT (SELECT count(*)::int FROM records WHERE tenant_id=$1 AND kind='plan_learning') AS learning,(SELECT count(*)::int FROM notifications WHERE tenant_id=$1) AS notices", [a.tenantId]));
    assert.deepEqual(counts, { learning: 0, notices: 0 });
    const costs = await ctx.db.tenant(a, tx => tx.query("SELECT product,member_id FROM cost_events WHERE tenant_id=$1", [a.tenantId]));
    assert.ok(costs.length >= 2); assert.ok(costs.every(c => c.product === "trainer_setup" && c.member_id === null));
    assert.deepEqual(queued, ["plan_generation", "coach_decision"]);
    await ctx.call("/trainer-preview/end", { cookie, body: {} });
    const resume = await ctx.call("/trainer-preview/start", { cookie: owner.cookie, body: {} });
    assert.equal(resume.json().profileId, start.json().profileId);
    const resumed = await ctx.call("/trainer-preview/run/bootstrap", { cookie: owner.cookie + "; " + cookieValue(resume, "trainer_preview") });
    assert.equal(resumed.json().sets.length, 1);
  } finally { globalThis.fetch = original; await ctx.close(); }
});

test("preview automatic review keeps escalations and unvalidated legacy programmes pending", async () => {
  const ctx = await accountsContext();
  try {
    const owner = await ctx.person({ role: "owner" }), a = { ...owner, role: "owner" as const };
    const release = await seedPreviewBrain(ctx.db, a);
    const start = await ctx.call("/trainer-preview/start", { cookie: owner.cookie, body: {} });
    assert.equal(start.statusCode, 200, start.body);
    const cookie = owner.cookie + "; " + cookieValue(start, "trainer_preview");
    const member = (await ctx.call("/trainer-preview/run/bootstrap", { cookie })).json().user;
    const reviewer = previewReviewer(a, member.userId);
    const decisions = await ctx.db.tenant(reviewer, async tx => {
      const common = { message: "A draft for review.", reason: "Synthetic boundary fixture", evidenceIds: [], requiresHumanReview: true, brainVersionId: release.id };
      const escalation = await putRecord(tx, reviewer, "decision", { ...common, type: "escalation" }, { ownerId: member.userId, status: "pending_review" });
      const programme = await putRecord(tx, reviewer, "decision", { ...common, type: "program_build", program: {
        title: "Unvalidated legacy model programme", goal: "Strength", daysPerWeek: 7,
        exercises: [{ name: "Unlisted exercise", sets: 10, reps: 100, loadKg: 500, restSeconds: 0, cue: "Unvalidated prescription" }],
      } }, { ownerId: member.userId, status: "pending_review" });
      for (const decision of [escalation, programme]) await putRecord(tx, reviewer, "exception", {
        category: decision.id === escalation.id ? "human_review" : "decision_review", decisionId: decision.id, subscriberId: member.userId,
      }, { ownerId: member.userId, status: "open" });
      return [escalation, programme];
    });
    for (const decision of decisions) assert.equal(await autoReviewPreviewReply(ctx.db, reviewer, decision.id), null);
    const continued = await ctx.call("/trainer-preview/continue", { cookie: owner.cookie, body: {} });
    assert.equal(continued.statusCode, 200, continued.body);
    assert.ok(continued.json().blocked.length);
    const rows = await ctx.db.tenant(reviewer, tx => tx.query("SELECT kind,status,data FROM records WHERE owner_user_id=$1 AND kind IN ('decision','exception','program','message')", [member.userId]));
    assert.equal(rows.filter(r => r.kind === "decision" && r.status === "pending_review").length, 2);
    assert.equal(rows.filter(r => r.kind === "exception" && r.status === "open").length, 2);
    assert.equal(rows.filter(r => r.kind === "program" || r.kind === "message").length, 0);
  } finally { await ctx.close(); }
});

test("preview automatic review preserves stale-release and personal-takeover boundaries", async () => {
  const ctx = await accountsContext();
  try {
    const owner = await ctx.person({ role: "owner" }), a = { ...owner, role: "owner" as const };
    const release = await seedPreviewBrain(ctx.db, a);
    const start = await ctx.call("/trainer-preview/start", { cookie: owner.cookie, body: {} });
    assert.equal(start.statusCode, 200, start.body);
    const cookie = owner.cookie + "; " + cookieValue(start, "trainer_preview");
    const member = (await ctx.call("/trainer-preview/run/bootstrap", { cookie })).json().user;
    const reviewer = previewReviewer(a, member.userId);
    await ctx.db.tenant(reviewer, tx => tx.query("INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'coaching','fixture',true)", [randomUUID(), a.tenantId, member.userId]));
    const stale = await ctx.db.tenant(reviewer, tx => putRecord(tx, reviewer, "decision", {
      type: "message", message: "Routine advice from the previous Brain.", reason: "Fixture", evidenceIds: [], requiresHumanReview: true, brainVersionId: release.id,
    }, { ownerId: member.userId, status: "pending_review" }));
    const replacement = await ctx.db.tenant(a, async tx => {
      await tx.query("UPDATE records SET status='archived' WHERE id=$1", [release.id]);
      return putRecord(tx, a, "brain_release", release.data, { status: "published" });
    });
    await assert.rejects(autoReviewPreviewReply(ctx.db, reviewer, stale.id), (error: any) => error.statusCode === 409 && error.code === "REVIEW_STALE");
    const personal = await ctx.db.tenant(reviewer, async tx => {
      await putRecord(tx, reviewer, "takeover", { trainerId: a.userId }, { ownerId: member.userId, status: "active" });
      return putRecord(tx, reviewer, "decision", {
        type: "message", message: "Routine advice while the trainer has taken over.", reason: "Fixture", evidenceIds: [], requiresHumanReview: true, brainVersionId: replacement.id,
      }, { ownerId: member.userId, status: "pending_review" });
    });
    assert.equal(await autoReviewPreviewReply(ctx.db, reviewer, personal.id), null);
    const continued = await ctx.call("/trainer-preview/continue", { cookie: owner.cookie, body: {} });
    assert.equal(continued.statusCode, 200, continued.body);
    const rows = await ctx.db.tenant(reviewer, tx => tx.query("SELECT kind,status FROM records WHERE owner_user_id=$1 AND kind IN ('decision','message','takeover')", [member.userId]));
    assert.equal(rows.filter(r => r.kind === "decision" && r.status === "pending_review").length, 2);
    assert.equal(rows.filter(r => r.kind === "message").length, 0);
    assert.equal(rows.filter(r => r.kind === "takeover" && r.status === "active").length, 1);
  } finally { await ctx.close(); }
});

test("preview refuses subscribers, foreign sessions and commercial routes", async () => {
  const ctx = await accountsContext();
  try {
    const owner = await ctx.person({ role: "owner" });
    const other = await ctx.person({ role: "owner", tenantId: owner.tenantId });
    const subscriber = await ctx.person({ role: "subscriber", tenantId: owner.tenantId });
    const started = await ctx.call("/trainer-preview/start", { cookie: owner.cookie, body: {} });
    const token = cookieValue(started, "trainer_preview");
    assert.equal((await ctx.call("/trainer-preview/start", { cookie: subscriber.cookie, body: {} })).statusCode, 403);
    assert.equal((await ctx.call("/trainer-preview/run/bootstrap", { cookie: subscriber.cookie + "; " + token })).statusCode, 403);
    assert.equal((await ctx.call("/trainer-preview/run/bootstrap", { cookie: other.cookie + "; " + token })).statusCode, 409);
    assert.equal((await ctx.call("/trainer-preview/run/bootstrap", { cookie: owner.cookie })).statusCode, 409);
    const view = await ctx.call("/trainer-preview/run/bootstrap", { cookie: owner.cookie + "; " + token });
    await assert.rejects(ctx.db.tenant(previewReviewer({ ...other, role: "owner" }, view.json().user.userId), async () => null), /test subscriber/i);
    assert.equal(previewRouteAllowed("PUT", "/api/v1/preferences/appearance"), true);
    const previewCookie = owner.cookie + "; " + token;
    const appearance = await ctx.call("/trainer-preview/run/preferences/appearance", { cookie: previewCookie, method: "PUT", body: { theme: "dark" } });
    assert.equal(appearance.statusCode, 200, appearance.body);
    assert.equal(appearance.json().data.theme, "dark");
    const trainerPreferences = await ctx.call("/notifications/preferences", { cookie: owner.cookie });
    assert.equal(trainerPreferences.json().data.theme, "light");
    for (const path of ["/checkout", "/billing/portal", "/brain/publish", "/account/password", "/trainer-preview/start"])
      assert.equal(previewRouteAllowed("POST", "/api/v1" + path), false, path);
    assert.equal((await ctx.call("/trainer-preview/run/checkout", { cookie: owner.cookie + "; " + token, body: {} })).statusCode, 404);
  } finally { await ctx.close(); }
});
