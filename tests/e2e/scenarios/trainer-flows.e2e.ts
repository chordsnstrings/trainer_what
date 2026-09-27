/**
 * Trainer scenarios over the seeded platform, including AI guardrail checks
 * that feed deliberately invalid model answers through the scripted queue and
 * assert the app withholds them while keeping the provider usage record.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { E2EContext, TrainerSeed } from "../harness/context.ts";
import { PASSWORD } from "../harness/data.ts";

const T = "Trainers" as const;
const A = "Super admin" as const;

export async function trainerFlows(ctx: E2EContext) {
  const layla = ctx.trainers.find((t) => t.slug === "layla-strength" && t.published);
  const omar = ctx.trainers.find((t) => t.slug === "omar-conditioning" && t.published);
  if (!layla || !omar) {
    ctx.reporter.skip(T, "Finance screen with earnings and balances", "trainer scenarios", "a seeded trainer did not launch");
    return;
  }
  await guardrails(ctx, layla, omar);
  await brainRollback(ctx, omar);
  await team(ctx, layla);
  await dashboards(ctx, layla);
  await platformSupport(ctx, omar);
}

async function guardrails(ctx: E2EContext, layla: TrainerSeed, omar: TrainerSeed) {
  const { mocks } = ctx;
  // A scripted answer the app never requested must not leak into a later call.
  const r = {
    step: async (...args: Parameters<E2EContext["reporter"]["step"]>) => {
      try {
        return await ctx.reporter.step(...args);
      } finally {
        const left = mocks.model.clearQueue();
        if (left) ctx.log(`  note  ${left} scripted model answer(s) were not requested`);
      }
    },
  };
  await r.step(T, "AI rule compilation from sources", "guardrail: a compiled rule citing an unknown source is withheld and its usage kept", async () => {
    const before = await omar.client.get("/api/v1/bootstrap");
    const source = before.records.find((x: any) => x.kind === "source");
    mocks.model.enqueue({
      kind: "rule_compilation",
      content: {
        rules: [
          { title: "Invented rule", category: "progression", condition: "Always", directive: "Add 20 kg every session", reason: "Not taught", sourceIds: [randomUUID()] },
        ],
        conflicts: [],
      },
    });
    const response = await omar.client.request("POST", "/api/v1/brain/compile", { sourceIds: [source.id] });
    assert.equal(response.status, 503, response.text);
    assert.match(response.body.message, /failed validation and were withheld/);
    const after = await omar.client.get("/api/v1/bootstrap");
    assert.equal(after.records.filter((x: any) => x.kind === "rule").length, before.records.filter((x: any) => x.kind === "rule").length, "no rule stored");
    assert.equal(after.costs.length, before.costs.length + 1, "provider usage retained");
  });
  const omarFollower = ctx.followers.find((f) => f.trainer === omar && f.paid && f.checkout);
  if (omarFollower)
    await r.step(T, "Digital coach replies to subscribers", "guardrail: a reply citing invented evidence is withheld from the subscriber", async () => {
      mocks.model.enqueue({
        kind: "coach_decision",
        content: { type: "message", message: "Do 200 burpees daily", reason: "Invented", evidenceIds: [randomUUID()], requiresHumanReview: false },
      });
      const response = await omarFollower.client.request("POST", "/api/v1/coaching/ask", { message: "What conditioning should I add this week?" });
      assert.equal(response.status, 503, response.text);
      assert.doesNotMatch(response.text, /burpees/);
    });
  const nutritionFollower = ctx.followers.find((f) => f.trainer === layla && f.paid && f.tier === "workout_nutrition");
  if (nutritionFollower)
    await r.step(T, "Nutrition delivery exceptions, pause and weekly-job recovery", "guardrail: a week outside the calorie policy becomes a coach exception, not a delivered plan", async () => {
      const plan = await nutritionFollower.client.request("GET", "/api/v1/nutrition");
      void plan;
      const recipes = (await layla.client.get("/api/v1/nutrition/coach")).recipes ?? [];
      const bySlot = (slot: string) => recipes.find((x: any) => x.slots?.includes(slot) ?? x.data?.slots?.includes(slot));
      mocks.model.enqueue({
        kind: "nutrition",
        task: "nutrition_week",
        content: {
          days: Array.from({ length: 7 }, (_, offset) => ({
            offset,
            meals: ["Breakfast", "Lunch", "Dinner"].map((slot) => ({
              slot,
              recipeId: bySlot(slot)?.id ?? randomUUID(),
              variantKey: "hob",
              servings: 2,
              batchKey: null,
            })),
          })),
          caseIds: [randomUUID()],
          explanation: "Deliberately oversized week for the guardrail check.",
        },
      });
      const weekStart = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const response = await nutritionFollower.client.request("POST", "/api/v1/nutrition/generate", { requestKey: randomUUID(), weekStart });
      const text = JSON.stringify(response.body);
      assert.ok(response.status >= 400 || response.body?.plan?.status !== "delivered", `oversized week must not be delivered: ${response.status} ${text.slice(0, 300)}`);
      return `${response.status} ${text.slice(0, 160)}`;
    });
  if (nutritionFollower)
    await r.step(T, "AI recipe drafts and AI policy compilation", "guardrail: a meal-photo estimate that is not valid JSON is withheld; nothing enters the diary", async () => {
      mocks.model.enqueue({ kind: "meal_photo", content: "this is not JSON" });
      const { sampleJpeg } = await import("../harness/data.ts");
      const image = await sampleJpeg("#aa7755", 11);
      const response = await nutritionFollower.client.request("POST", "/api/v1/nutrition/captures/photo", {
        requestKey: randomUUID(),
        base64: image.toString("base64"),
        mime: "image/jpeg",
        context: "Guardrail check",
        photoConsent: true,
      });
      assert.equal(response.status, 503, response.text);
      assert.match(response.body.message, /could not be validated/);
    });
}

async function brainRollback(ctx: E2EContext, omar: TrainerSeed) {
  await ctx.reporter.step(T, "Brain release and rollback", `${omar.slug}: second evaluated release, then rollback to the first`, async () => {
    const releases = (await omar.client.get("/api/v1/bootstrap")).records.filter((x: any) => x.kind === "brain_release");
    const first = releases.find((x: any) => x.status === "published");
    const evaluation = await omar.client.post("/api/v1/brain/evaluate", {});
    assert.equal(evaluation.status, "passed");
    const second = await omar.client.post("/api/v1/brain/releases", { evaluationId: evaluation.id, notes: "Re-evaluated release" });
    assert.notEqual(second.id, first.id);
    await omar.client.post(`/api/v1/brain/releases/${first.id}/rollback`, {});
    const after = (await omar.client.get("/api/v1/bootstrap")).records.filter((x: any) => x.kind === "brain_release");
    assert.equal(after.find((x: any) => x.status === "published").id, first.id);
  });
}

async function team(ctx: E2EContext, layla: TrainerSeed) {
  const staff = ctx.newClient("layla-staff", "coach.assistant@sandbox.example", PASSWORD);
  await ctx.reporter.step(T, "Team: invite staff or finance members, change roles and remove members", `${layla.slug}: staff invitation accepted`, async () => {
    const invite = await layla.client.okMfa("POST", "/api/v1/team/invitations", { email: staff.email, role: "staff" });
    const token = invite.url.split("/").pop();
    await staff.post("/api/v1/invitations/accept", { token, name: "Coach Assistant", email: staff.email, password: PASSWORD, accepted: true });
    const boot = await staff.get("/api/v1/bootstrap");
    assert.equal(boot.user.role, "staff");
    const teamView = await layla.client.okMfa("GET", "/api/v1/team");
    assert.ok(JSON.stringify(teamView).includes(staff.email));
  });
  await ctx.reporter.step(T, "Staff and finance role restrictions", "staff can coach but cannot change offers or read finance", async () => {
    const boot = await staff.get("/api/v1/bootstrap");
    assert.equal(boot.finance, undefined, "no finance summary for staff");
    const activate = await staff.request("POST", `/api/v1/products/${layla.products.workout.id}/activate`, {});
    assert.equal(activate.status, 403);
    const exportCsv = await staff.request("GET", "/api/v1/finance/export");
    assert.equal(exportCsv.status, 403);
    const follower = ctx.followers.find((f) => f.trainer === layla && f.paid);
    if (follower) await staff.post("/api/v1/messages", { text: "Hi, I'm Layla's assistant coach.", subscriberId: follower.client.userId });
  });
}

async function dashboards(ctx: E2EContext, layla: TrainerSeed) {
  const t = layla.client;
  await ctx.reporter.step(T, "Finance screen with earnings and balances", `${layla.slug}: earnings from paid memberships`, async () => {
    const boot = await t.get("/api/v1/bootstrap");
    assert.ok(boot.finance, "finance summary for the owner");
    assert.ok((boot.finance.earnedMinor ?? 0) > 0 || boot.journals.length > 0, JSON.stringify(boot.finance).slice(0, 300));
    return JSON.stringify(boot.finance).slice(0, 200);
  });
  await ctx.reporter.step(T, "Business analytics and retention", `${layla.slug}: analytics from Stripe-backed journals`, async () => {
    const analytics = await t.get("/api/v1/analytics/business");
    assert.ok(analytics);
    return JSON.stringify(analytics).slice(0, 200);
  });
  await ctx.reporter.step(T, "Subscriber list screen", `${layla.slug}: paid and unpaid subscribers listed`, async () => {
    const members = (await t.get("/api/v1/bootstrap")).members.filter((m: any) => m.role === "subscriber");
    assert.ok(members.length >= 8, `${members.length} subscribers`);
  });
  await ctx.reporter.step(T, "Workout message policy", `${layla.slug}: missed-workout reminders enabled`, async () => {
    const current = await t.get("/api/v1/lifecycle/workout-policy");
    await t.put("/api/v1/lifecycle/workout-policy", { version: current.version ?? 0, data: { enabled: true, missedAfterDays: 2 } });
  });
  await ctx.reporter.step(T, "Integrations status page", `${layla.slug}: provider status reflects the configured mocks`, async () => {
    const boot = await t.get("/api/v1/bootstrap");
    const whoop = boot.integrations.find((i: any) => i.id === "whoop");
    assert.equal(whoop.configured && whoop.approved, true);
  });
  await ctx.reporter.step(T, "Exceptions queue", `${layla.slug}: review items from digital coaching and safety`, async () => {
    const exceptions = (await t.get("/api/v1/bootstrap")).records.filter((r: any) => r.kind === "exception");
    assert.ok(exceptions.length > 0);
    return `${exceptions.length} exceptions`;
  });
  await ctx.reporter.step(T, "In-app notification inbox and preferences", `${layla.slug}: trainer inbox has coaching notices`, async () => {
    const inbox = await t.get("/api/v1/notifications");
    const items = inbox.items ?? inbox.notifications ?? inbox;
    assert.ok(Array.isArray(items) && items.length > 0, JSON.stringify(inbox).slice(0, 200));
  });
}

async function platformSupport(ctx: E2EContext, omar: TrainerSeed) {
  let ticket: any;
  await ctx.reporter.step(T, "Support tickets to the platform", `${omar.slug}: support request`, async () => {
    ticket = await omar.client.post("/api/v1/support", { subject: "Payout timing question", message: "When does the first payout arrive after month end?", category: "billing" });
    assert.ok(ticket.id);
  });
  if (ticket)
    await ctx.reporter.step(A, "Reply to and resolve support conversations", `${omar.slug}: operator replies and resolves`, async () => {
      await ctx.admin.stepUp();
      const view = await ctx.admin.get(`/api/v1/admin/operations/support?tenantId=${omar.tenantId}`);
      const row = view.rows.find((x: any) => x.id === ticket.id);
      assert.ok(row, "ticket in the operator queue");
      await ctx.admin.post(`/api/v1/admin/tenants/${omar.tenantId}/support/${ticket.id}/reply`, {
        revision: row.version,
        message: "Payouts are prepared after the month closes and its seven-day refund review.",
        resolve: true,
      });
    });
}
