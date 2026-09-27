/**
 * Followers (subscribers): about twenty people join the three trainers by
 * invitation link or public self-join, verify email, complete intake and pay
 * through the mock Stripe checkout (setupFollowers). followerScenarios then
 * exercise training, chat, digital coaching, bookings, nutrition, wearables,
 * notifications, billing and privacy. Feature names match the "followers"
 * inventory.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "../harness/client.ts";
import type { E2EContext, FollowerSeed, TrainerSeed } from "../harness/context.ts";
import { PASSWORD, TRAINERS, followerName } from "../harness/data.ts";
import { followerFlows } from "./follower-flows.e2e.ts";

const F = "followers" as const;
const P = "public-join" as const;
const T = "Trainers" as const;

/** Tier plan per trainer: first invitations, then public joins. */
const TIERS: Record<string, Array<FollowerSeed["tier"]>> = {
  "layla-strength": ["workout", "workout", "workout_nutrition", "workout", "workout_nutrition", "workout", "workout", "workout_nutrition", "none"],
  "omar-conditioning": ["workout", "workout", "none", "workout", "workout", "none"],
  "sara-mobility": ["workout", "workout", "workout", "workout", "none"],
};

export async function setupFollowers(ctx: E2EContext) {
  let n = 0;
  const layla = ctx.trainers.find((t) => t.slug === "layla-strength");
  const omar = ctx.trainers.find((t) => t.slug === "omar-conditioning");
  // Offer terms exercised at checkout: a promotion code and a free trial.
  if (layla?.published)
    await ctx.reporter.step(T, "Free trials and promotion codes", "layla-strength: 20% promotion code published to Stripe", async () => {
      const promo = await layla.client.okMfa("POST", "/api/v1/finance/promotions", {
        code: "SANDBOX20",
        productId: layla.products.workout.id,
        percentOff: 20,
        maxRedemptions: 50,
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        reason: "Sandbox launch promotion",
      });
      assert.equal(promo.status, "published");
      assert.ok(ctx.mocks.stripe.coupons.has("trainer_" + promo.id));
    });
  if (omar?.published)
    await ctx.reporter.step(T, "Free trials and promotion codes", "omar-conditioning: 14-day free trial on the workout offer", async () => {
      const product = (await omar.client.okMfa("GET", "/api/v1/finance/completion")).products.find((p: any) => p.id === omar.products.workout.id);
      const updated = await omar.client.okMfa("POST", `/api/v1/finance/products/${product.id}/trial`, { revision: product.version, trialDays: 14 });
      assert.equal(updated.data?.trialDays ?? updated.trialDays, 14);
    });
  for (const trainer of ctx.trainers) {
    const plan = TRAINERS.find((p) => p.slug === trainer.slug)!;
    const tiers = TIERS[trainer.slug] ?? [];
    for (let i = 0; i < plan.followers.invited + plan.followers.publicJoin; i++) {
      const via = i < plan.followers.invited ? "invitation" : "public-join";
      if (via === "public-join" && !trainer.published) continue;
      if (via === "invitation" && !trainer.tenantId) continue;
      const name = followerName(n);
      const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${n}@sandbox.example`;
      n++;
      const seed: FollowerSeed = {
        client: ctx.newClient(`${trainer.slug}-follower-${i}`, email, PASSWORD),
        trainer,
        via,
        tier: tiers[i] ?? "workout",
        paid: false,
      };
      if (seed.tier === "workout_nutrition" && !trainer.products.nutrition) seed.tier = "workout";
      const joined = await joinFollower(ctx, seed, name, i === 0);
      if (!joined) continue;
      ctx.followers.push(seed);
      if (seed.tier !== "none") await payMembership(ctx, seed, i);
    }
  }
  ctx.log(`  ${ctx.followers.length} followers joined, ${ctx.followers.filter((f) => f.paid).length} paid`);
}

async function joinFollower(ctx: E2EContext, f: FollowerSeed, name: string, first: boolean) {
  const { client: c, trainer } = f;
  const audience = f.via === "invitation" ? F : P;
  if (f.via === "invitation") {
    let token = "";
    const invited = await ctx.reporter.step(T, "Invite a subscriber by link", `${trainer.slug}: invitation link for ${c.label}`, async () => {
      const invite = await trainer.client.post("/api/v1/invitations", { email: c.email, role: "subscriber" });
      assert.match(invite.url, /\/join\/[A-Za-z0-9_-]{20,}$/);
      assert.equal(new URL(invite.url).origin, ctx.publicUrl);
      token = invite.url.split("/").pop();
    });
    if (!invited) return false;
    return ctx.reporter.step(F, "Accept a trainer's invitation link", `${c.label}: accepts terms and joins`, async () => {
      if (first) {
        const page = await c.request("GET", `/join/${token}`);
        assert.equal(page.status, 200, "invitation page renders");
      }
      await c.post("/api/v1/invitations/accept", { token, name, email: c.email, password: PASSWORD, accepted: true });
      const boot = await c.get("/api/v1/bootstrap");
      assert.equal(boot.user.role, "subscriber");
      assert.equal(boot.tenant.id, trainer.tenantId);
      assert.ok(boot.consents.some((x: any) => x.document_type === "registration" && x.granted));
      c.userId = boot.user.userId;
      c.tenantId = boot.tenant.id;
      await ctx.verifyEmail(c);
    });
  }
  return ctx.reporter.step(P, "Public self-join from a coach website (/join-coach/<name>)", `${c.label}: joins ${trainer.slug} from the public page`, async () => {
    if (first) {
      const page = await c.request("GET", `/join-coach/${trainer.slug}`);
      assert.equal(page.status, 200, "join page renders");
    }
    const r = await c.request("POST", "/api/v1/auth/enroll", {
      name,
      email: c.email,
      password: PASSWORD,
      coachSlug: trainer.slug,
      accepted: true,
    });
    assert.equal(r.status, 201, r.text);
    const boot = await c.get("/api/v1/bootstrap");
    assert.equal(boot.user.role, "subscriber");
    assert.equal(boot.user.emailVerified, false);
    c.userId = boot.user.userId;
    c.tenantId = boot.tenant.id;
    await ctx.verifyEmail(c);
  });
}

async function payMembership(ctx: E2EContext, f: FollowerSeed, i: number) {
  const { client: c, trainer } = f;
  const product = f.tier === "workout_nutrition" ? trainer.products.nutrition : trainer.products.workout;
  const promotionCode = trainer.slug === "layla-strength" && f.via === "public-join" && f.tier === "workout" && i % 2 === 1 ? "SANDBOX20" : undefined;
  const feature = promotionCode ? "Choose a plan and pay (with discount codes)" : "Choose a plan and pay (with discount codes)";
  await ctx.reporter.step(F, feature, `${c.label}: ${f.tier} checkout${promotionCode ? " with SANDBOX20" : ""} paid in the Stripe mock`, async () => {
    await c.post("/api/v1/intake", {
      age: 28 + (i % 20),
      goal: "Get stronger and more consistent",
      experience: "beginner",
      daysPerWeek: 3,
      equipment: "Dumbbells",
      limitations: "None reported",
      consent: true,
    });
    await c.fails(402, "POST", "/api/v1/workouts/start", { programId: randomUUID() }, "MEMBERSHIP_REQUIRED");
    const checkout = await c.post("/api/v1/payments/checkout", { productId: product.id, ...(promotionCode ? { promotionCode } : {}) });
    const sessionId = new URL(checkout.url).pathname.split("/").pop()!;
    const session = ctx.mocks.stripe.sessions.get(sessionId);
    assert.ok(session, "checkout session exists in the Stripe mock");
    assert.equal(session.client_reference_id, checkout.intentId);
    assert.equal(session.success_url, ctx.publicUrl + "/app/membership?checkout=complete");
    const result = await ctx.mocks.stripe.completeCheckout(sessionId);
    for (const d of result.deliveries ?? []) assert.equal(d.status, 200, `${d.type} webhook: ${d.body}`);
    const boot = await c.get("/api/v1/bootstrap");
    const subscription = boot.subscriptions[0];
    assert.ok(["active", "trialing"].includes(subscription?.status), "subscription active: " + JSON.stringify(subscription));
    assert.equal(subscription.data.tier, f.tier);
    f.paid = true;
    f.checkout = { sessionId, subscriptionId: result.subscription?.id, chargeId: result.charge?.id };
    const billing = await c.get("/api/v1/membership/billing");
    const expected = session.amount_total;
    if (expected > 0) {
      assert.equal(billing.charges.length, 1, "charge posted to the ledger");
      assert.equal(billing.charges[0].amountMinor, expected);
    }
    assert.ok(billing.invoices.some((inv: any) => inv.status === "paid"));
    return `${subscription.status}, ${expected} AED minor${promotionCode ? " after 20% promotion" : ""}`;
  });
}

export async function followerScenarios(ctx: E2EContext) {
  await followerFlows(ctx);
}

export type { Client, TrainerSeed };
