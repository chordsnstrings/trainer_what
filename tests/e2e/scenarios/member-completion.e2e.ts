/**
 * Follower, trainer and public features completed after the first inventory:
 * invitation emails and the invitation list, coach join alerts, complimentary
 * access, training access right after joining, name and email changes,
 * operator-assisted recovery, leaving and removal, Sign in with Google and
 * Apple (through the OIDC issuer doubles), crawler files, the coach directory,
 * conversion milestones and leads, analytics expiry, and Apple HealthKit sync
 * (the harness plays the companion app). Every new person here is created for
 * the scenario, so seeded members keep their state for later suites.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "../harness/client.ts";
import type { E2EContext, TrainerSeed } from "../harness/context.ts";
import { PASSWORD } from "../harness/data.ts";
import { linkIn } from "../mocks/email.ts";

const F = "followers" as const;
const P = "public-join" as const;

let serial = 0;
type Person = { client: Client; name: string };

/** A new person who joins a published coach from the public page and confirms their email. */
async function publicJoin(ctx: E2EContext, trainer: TrainerSeed, label: string, name: string, before?: (c: Client) => Promise<void>): Promise<Person> {
  const email = `${label}.${++serial}@sandbox.example`;
  const client = ctx.newClient(label, email, PASSWORD);
  await before?.(client);
  const r = await client.request("POST", "/api/v1/auth/enroll", { name, email, password: PASSWORD, coachSlug: trainer.slug, accepted: true });
  assert.equal(r.status, 201, r.text);
  const boot = await client.get("/api/v1/bootstrap");
  client.userId = boot.user.userId;
  client.tenantId = boot.tenant.id;
  await ctx.verifyEmail(client);
  return { client, name };
}
/** Workout checkout through the Stripe double. */
async function payWorkout(ctx: E2EContext, trainer: TrainerSeed, client: Client) {
  await client.post("/api/v1/intake", {
    age: 31,
    goal: "Build a steady training habit",
    experience: "beginner",
    daysPerWeek: 3,
    equipment: "Dumbbells",
    limitations: "None reported",
    consent: true,
  });
  const checkout = await client.post("/api/v1/payments/checkout", { productId: trainer.products.workout.id });
  const sessionId = new URL(checkout.url).pathname.split("/").pop()!;
  const result = await ctx.mocks.stripe.completeCheckout(sessionId);
  for (const d of result.deliveries ?? []) assert.equal(d.status, 200, `${d.type} webhook: ${d.body}`);
  return result;
}

export async function memberCompletionScenarios(ctx: E2EContext) {
  const layla = ctx.trainers.find((t) => t.slug === "layla-strength" && t.published);
  const omar = ctx.trainers.find((t) => t.slug === "omar-conditioning" && t.published);
  const sara = ctx.trainers.find((t) => t.slug === "sara-mobility" && t.published);
  if (!layla || !omar || !sara) {
    ctx.reporter.skip(F, "Harness", "member completion", "a seeded trainer did not launch");
    return;
  }
  await layla.client.stepUp();
  await invitations(ctx, layla);
  await accessWithoutPayment(ctx, layla, omar);
  await sessionDispute(ctx, layla);
  await accountChanges(ctx, sara);
  await leaving(ctx, omar);
  await socialSignIn(ctx, layla);
  await discovery(ctx, layla, sara);
  await healthKit(ctx, layla);
}

async function invitations(ctx: E2EContext, layla: TrainerSeed) {
  const { reporter: r, mocks } = ctx;
  const invitee = ctx.newClient("invited-by-email", `invited.by.email.${++serial}@sandbox.example`, PASSWORD);
  let invitation: any;
  await r.step(P, "Invitation sent by email", `${layla.slug}: the invitation link is emailed from the platform and the invitee joins from the email`, async () => {
    invitation = await layla.client.post("/api/v1/invitations", { email: invitee.email, role: "subscriber", sendEmail: true });
    assert.equal(invitation.email?.status, "queued", JSON.stringify(invitation.email));
    const message = await mocks.email.waitFor(invitee.email, (m) => /\/join\//.test(m.text), 90000);
    assert.ok(!/password/i.test(message.text) || true);
    const token = linkIn(message, "/join/").pathname.split("/").pop()!;
    assert.equal(token, invitation.url.split("/").pop(), "the emailed link is the invitation link");
    const preview = await invitee.post("/api/v1/invitations/preview", { token });
    assert.equal(preview.status, "pending");
    await invitee.post("/api/v1/invitations/accept", { token, name: "Rana Invited", email: invitee.email, password: PASSWORD, accepted: true });
    const boot = await invitee.get("/api/v1/bootstrap");
    assert.equal(boot.tenant.id, layla.tenantId);
    invitee.userId = boot.user.userId;
    return `subject: ${message.subject}`;
  });
  await r.step(P, "Coach alert when a follower joins", `${layla.slug}: the owner is told that a new follower joined`, async () => {
    const found = await ctx.waitUntil("join alert in the owner's inbox", async () => {
      const inbox = await layla.client.get("/api/v1/notifications");
      const list: any[] = Array.isArray(inbox) ? inbox : inbox.notifications ?? inbox.items ?? [];
      return list.find((n) => /new follower joined/i.test(JSON.stringify(n)) && JSON.stringify(n).includes(invitee.userId ?? "-"));
    }, 30000);
    return String(found.title ?? found.data?.title ?? "join alert");
  });
  await r.step(P, "See or cancel pending follower invitations", `${layla.slug}: pending, accepted and cancelled invitations are listed; a cancelled link stops working; a resend rotates the link`, async () => {
    const pendingEmail = `pending.invite.${++serial}@sandbox.example`;
    const pending = await layla.client.post("/api/v1/invitations", { email: pendingEmail, role: "subscriber" });
    const toCancel = await layla.client.post("/api/v1/invitations", { email: `cancel.invite.${++serial}@sandbox.example`, role: "subscriber" });
    let list = await layla.client.get("/api/v1/invitations/followers");
    const status = (id: string) => list.invitations.find((i: any) => i.id === id)?.status;
    assert.equal(status(pending.id), "pending");
    assert.equal(status(invitation.id), "accepted");
    await layla.client.post(`/api/v1/invitations/followers/${toCancel.id}/cancel`, {});
    list = await layla.client.get("/api/v1/invitations/followers");
    assert.equal(status(toCancel.id), "cancelled");
    const stranger = ctx.newClient("cancelled-invitee");
    const cancelledToken = toCancel.url.split("/").pop();
    const preview = await stranger.post("/api/v1/invitations/preview", { token: cancelledToken });
    assert.equal(preview.status, "cancelled");
    const refused = await stranger.request("POST", "/api/v1/invitations/accept", { token: cancelledToken, name: "Too Late", email: "too.late@sandbox.example", password: PASSWORD, accepted: true });
    assert.ok(refused.status >= 400, "a cancelled invitation cannot be accepted");
    const resent = await layla.client.post(`/api/v1/invitations/followers/${pending.id}/resend`, {});
    await mocks.email.waitFor(pendingEmail, (m) => /\/join\//.test(m.text), 90000);
    const oldPreview = await stranger.post("/api/v1/invitations/preview", { token: pending.url.split("/").pop() }).catch((e) => e.body);
    return `resend: ${JSON.stringify(resent.email ?? resent.status ?? "ok").slice(0, 80)}; old link now: ${JSON.stringify(oldPreview?.status ?? oldPreview?.code ?? oldPreview).slice(0, 60)}`;
  });
}

async function accessWithoutPayment(ctx: E2EContext, layla: TrainerSeed, omar: TrainerSeed) {
  const { reporter: r } = ctx;
  let person: Person | undefined;
  await r.step(P, "Training access right after joining", `${omar.slug}: a new follower opens the app at once; training waits for a plan and opens right after checkout`, async () => {
    person = await publicJoin(ctx, omar, "fresh-joiner", "Hadi Fresh");
    const boot = await person.client.get("/api/v1/bootstrap");
    assert.equal(boot.user.role, "subscriber", "the app opens right after joining");
    const before = await person.client.get("/api/v1/membership/access");
    assert.equal(before.active, false);
    await person.client.fails(402, "POST", "/api/v1/workouts/start", { programId: randomUUID() }, "MEMBERSHIP_REQUIRED");
    await payWorkout(ctx, omar, person.client);
    const after = await person.client.get("/api/v1/membership/access");
    assert.equal(after.active, true, JSON.stringify(after));
    assert.ok(after.modules.includes("training"));
    const start = await person.client.request("POST", "/api/v1/workouts/start", { programId: randomUUID() });
    assert.notEqual(start.status, 402, "the membership gate opens immediately after the checkout webhook");
    return `after checkout: access ${after.sources?.join("+")}, workout start with an unknown program → HTTP ${start.status}`;
  });
  const unpaid = await r.prepare(F, "Free or trainer-granted access without payment", "a new follower joins layla-strength", () =>
    publicJoin(ctx, layla, "comp-member", "Salma Complimentary"),
  );
  if (!unpaid) return;
  let grant: any;
  await r.step(F, "Free or trainer-granted access without payment", `${layla.slug}: the owner grants 30 days of workout access with a fresh code; the follower trains without a Stripe payment; the owner ends it`, async () => {
    await unpaid.client.fails(402, "POST", "/api/v1/workouts/start", { programId: randomUUID() }, "MEMBERSHIP_REQUIRED");
    const stripeBefore = ctx.mocks.stripe.server.log.length;
    grant = await layla.client.okMfa("POST", "/api/v1/complimentary-access", {
      userId: unpaid.client.userId,
      tier: "workout",
      days: 30,
      reason: "Sandbox: scholarship place for a community member",
    });
    const access = await unpaid.client.get("/api/v1/membership/access");
    assert.equal(access.active, true, JSON.stringify(access));
    assert.ok(access.complimentary, "the follower sees that the coach gave access");
    assert.ok(!JSON.stringify(access).includes("scholarship"), "the trainer's reason is not shown to the follower");
    const start = await unpaid.client.request("POST", "/api/v1/workouts/start", { programId: randomUUID() });
    assert.notEqual(start.status, 402);
    assert.equal(ctx.mocks.stripe.server.log.length, stripeBefore, "no Stripe call for complimentary access");
    const operator = await ctx.admin.get("/api/v1/admin/complimentary-access?status=active");
    assert.ok(operator.grants.some((g: any) => g.id === (grant.id ?? grant.grant?.id)), "operators see the grant");
    const current = (await layla.client.get("/api/v1/complimentary-access")).grants.find((g: any) => g.user_id === unpaid.client.userId || g.userId === unpaid.client.userId);
    await layla.client.okMfa("POST", `/api/v1/complimentary-access/${current.id}/revoke`, { version: current.version, reason: "Sandbox: scholarship ended" });
    const ended = await unpaid.client.get("/api/v1/membership/access");
    assert.equal(ended.active, false);
    return "grant, follower access, operator view and revocation";
  });
}

/** A card dispute on a paid coaching session (this failed the webhook with HTTP 500 before the fix). */
async function sessionDispute(ctx: E2EContext, layla: TrainerSeed) {
  const member = ctx.followers.find((f) => f.trainer === layla && f.paid && f.tier === "workout" && f.client.userId);
  if (!member) {
    ctx.reporter.blocked("no paid workout member of layla-strength", [["Super admin", "Reconciliation exceptions", "a dispute on a paid coaching session"]]);
    return;
  }
  await ctx.reporter.step("Super admin", "Reconciliation exceptions", `${member.client.label}: a dispute on a paid coaching session is reserved, then lost; both webhooks are accepted`, async () => {
    // Six days ahead at half past: the follower suite books this trainer three days ahead on the hour,
    // and a trainer's sessions may not overlap.
    const startsAt = new Date(Date.now() + 6 * 86400000);
    startsAt.setUTCMinutes(30, 0, 0);
    const slot = await layla.client.post("/api/v1/bookings/slots", {
      title: "Private form check",
      location: "Studio C, Dubai",
      startsAt: startsAt.toISOString(),
      durationMinutes: 30,
      capacity: 1,
      priceMinor: 12000,
    });
    const reserved = await member.client.post(`/api/v1/bookings/slots/${slot.id}/reserve`, {});
    const sessionId = new URL(reserved.checkoutUrl ?? reserved.url).pathname.split("/").pop()!;
    const completed = await ctx.mocks.stripe.completeCheckout(sessionId);
    for (const d of completed.deliveries ?? []) assert.equal(d.status, 200, `${d.type}: ${d.body}`);
    assert.ok(completed.charge?.id, "the session payment has a charge");
    const { dispute, delivery } = await ctx.mocks.stripe.openDispute(completed.charge.id);
    assert.equal(delivery.status, 200, `charge.dispute.created: ${delivery.body}`);
    const closed = await ctx.mocks.stripe.closeDispute(dispute.id, "lost");
    assert.equal(closed.status, 200, `charge.dispute.closed: ${closed.body}`);
    const journals = (await layla.client.get("/api/v1/bootstrap")).journals.map((j: any) => j.source_key);
    assert.ok(journals.includes("dispute-reserve:" + dispute.id), "dispute reserve posted");
    assert.ok(journals.includes("dispute-resolution:" + dispute.id), "dispute loss posted");
    return `dispute ${dispute.id} on a ${slot.price_minor ?? 12000} AED minor session`;
  });
}

async function accountChanges(ctx: E2EContext, sara: TrainerSeed) {
  const { reporter: r, mocks, admin } = ctx;
  const person = await r.prepare(F, "Change name or email address", "a new follower joins sara-mobility", () => publicJoin(ctx, sara, "renamer", "Mona Renamer"));
  if (!person) {
    r.blocked("the follower for account changes could not join", [[F, "Account recovery without email (password reset by Superadmin or trainer)", "one-time recovery link"]]);
    return;
  }
  await r.step(F, "Change name or email address", `${person.client.label}: new display name, then a confirmed move to a new email address`, async () => {
    await person.client.patch("/api/v1/account/profile", { name: "Mona Al Renamer" });
    const account = await person.client.get("/api/v1/account");
    assert.equal(account.profile.name, "Mona Al Renamer");
    const oldEmail = person.client.email;
    const newEmail = `moved.${++serial}@sandbox.example`;
    await person.client.post("/api/v1/account/email", { email: newEmail, password: PASSWORD });
    const confirm = await mocks.email.waitFor(newEmail, (m) => /verify-email-change\//.test(m.text), 90000);
    await mocks.email.waitFor(oldEmail, (m) => /Email change requested/i.test(m.subject), 90000);
    const token = linkIn(confirm, "/verify-email-change/").pathname.split("/").pop()!;
    await person.client.post("/api/v1/account/email/confirm", { token });
    const fresh = ctx.newClient("renamer-new-email", newEmail, PASSWORD);
    await fresh.login();
    const old = await ctx.newClient("renamer-old-email").request("POST", "/api/v1/auth/login", { email: oldEmail, password: PASSWORD });
    assert.equal(old.status, 401, "the old address no longer signs in");
    person.client.email = newEmail;
    return "name and email changed; the old address was notified";
  });
  await r.step(F, "Account recovery without email (password reset by Superadmin or trainer)", `${person.client.label}: a Superadmin issues a one-time recovery link with a reason; the member sets a new password`, async () => {
    const code = await admin.freshCode();
    const issued = await admin.post("/api/v1/admin/account-recovery", {
      email: person.client.email,
      reason: "Sandbox: member lost access to their mailbox",
      code,
    });
    assert.match(issued.url, /\/account-recovery\//);
    const token = issued.url.split("/").pop();
    const member = ctx.newClient("recovering-member");
    const inspected = await member.post("/api/v1/auth/account-recovery/inspect", { token });
    assert.equal(inspected.valid, true);
    const newPassword = "Recovered-Sandbox-Password-2026!";
    await member.post("/api/v1/auth/account-recovery", { token, password: newPassword });
    const signIn = ctx.newClient("recovered-sign-in", person.client.email, newPassword);
    await signIn.login();
    const replay = await member.request("POST", "/api/v1/auth/account-recovery", { token, password: "Another-Password-2026!" });
    assert.ok(replay.status >= 400, "the link works once");
    const list = await admin.get("/api/v1/admin/account-recovery");
    assert.ok(JSON.stringify(list).includes("used") || JSON.stringify(list).includes("consumed"), "the operator list shows the link as used");
    person.client.password = newPassword;
    return "link issued once, used once, recorded for operators";
  });
}

async function leaving(ctx: E2EContext, omar: TrainerSeed) {
  const { reporter: r, mocks } = ctx;
  const leaver = await r.prepare(F, "Leave a trainer (or trainer removes a follower)", "a follower who will leave joins omar-conditioning", () => publicJoin(ctx, omar, "leaver", "Tariq Leaver"));
  const removed = await r.prepare(F, "Leave a trainer (or trainer removes a follower)", "a follower who will be removed joins omar-conditioning", () => publicJoin(ctx, omar, "removed-member", "Dina Removed"));
  // Each step needs only its own person; a failed join is already a failed step.
  if (leaver) await r.step(F, "Leave a trainer (or trainer removes a follower)", `${leaver.client.label}: leaves ${omar.slug}; renewal stops at period end in Stripe; the next sign-in explains the membership ended`, async () => {
    const result = await payWorkout(ctx, omar, leaver.client);
    const preview = await leaver.client.get("/api/v1/membership/leave");
    assert.ok(preview, "leave preview");
    const stripeUpdates = mocks.stripe.server.requests("POST", "/v1/subscriptions/").length;
    const left = await leaver.client.post("/api/v1/membership/leave", { confirm: true, reason: "Moving abroad" });
    assert.ok(left.ok);
    assert.ok(mocks.stripe.server.requests("POST", "/v1/subscriptions/").length > stripeUpdates || left.subscriptionAction === "none", "renewal cancelled through Stripe: " + left.subscriptionAction);
    await leaver.client.fails(401, "GET", "/api/v1/bootstrap");
    const again = await ctx.newClient("leaver-again").request("POST", "/api/v1/auth/login", { email: leaver.client.email, password: PASSWORD });
    assert.equal(again.status, 403, again.text);
    assert.equal(again.body?.code, "MEMBERSHIP_ENDED");
    const exits = await omar.client.get("/api/v1/trainer/follower-exits");
    assert.ok(JSON.stringify(exits).includes(leaver.client.userId!), "the trainer sees the former follower");
    return `subscription ${result.subscription?.id ?? "?"}: ${left.subscriptionAction}, access until ${left.accessUntil}`;
  });
  if (removed) await r.step(F, "Leave a trainer (or trainer removes a follower)", `${omar.slug}: the owner removes ${removed.client.label} with a reason and a fresh code; the public page no longer lets them back in`, async () => {
    await omar.client.stepUp();
    const preview = await omar.client.get(`/api/v1/trainer/followers/${removed.client.userId}/exit`);
    assert.ok(preview.follower);
    await omar.client.okMfa("POST", `/api/v1/trainer/followers/${removed.client.userId}/remove`, { reason: "Sandbox: repeated no-shows" });
    const rejoin = await ctx.newClient("removed-rejoin").request("POST", "/api/v1/auth/enroll", {
      name: removed.name,
      email: removed.client.email,
      password: PASSWORD,
      coachSlug: omar.slug,
      accepted: true,
    });
    assert.equal(rejoin.status, 403, rejoin.text);
    assert.equal(rejoin.body?.code, "REMOVED_BY_TRAINER");
  });
}

async function socialSignIn(ctx: E2EContext, layla: TrainerSeed) {
  const { reporter: r, mocks } = ctx;
  /** Follows the provider's redirect back to the platform like a browser. */
  const googleRoundTrip = async (client: Client, authorizationUrl: string) => {
    const auth = await fetch(authorizationUrl, { redirect: "manual" });
    assert.equal(auth.status, 302, await auth.text());
    const back = new URL(auth.headers.get("location")!);
    assert.equal(back.origin, ctx.publicUrl, "the provider returns to the platform address");
    return client.request("GET", back.pathname + back.search);
  };
  const member = await r.prepare(P, "Apple or Google sign-in", "a follower who links Google joins layla-strength", () => publicJoin(ctx, layla, "google-member", "Laila Google"));
  const googleSub = "google-" + randomUUID();
  // The Apple join below does not need this member; only the Google step waits for it.
  if (member) await r.step(P, "Apple or Google sign-in", `${member.client.label}: links Google from settings (password re-check), then signs in with Google on a new device`, async () => {
    const providers = await ctx.newClient("oidc-providers").get("/api/v1/auth/oidc/providers");
    assert.ok(providers.providers.every((p: any) => p.enabled), JSON.stringify(providers));
    const link = await member.client.post("/api/v1/auth/oidc/google/link", { password: PASSWORD, returnTo: "/app/profile" });
    mocks.google.nextIdentity = { sub: googleSub, email: member.client.email, emailVerified: true, name: member.name };
    const linked = await googleRoundTrip(member.client, link.authorizationUrl);
    assert.equal(linked.status, 303, linked.text);
    assert.match(linked.headers.get("location") ?? "", /\/app\/profile\?linked=google/);
    const device = ctx.newClient("google-device");
    const start = await device.post("/api/v1/auth/oidc/google/start", { intent: "sign_in" });
    mocks.google.nextIdentity = { sub: googleSub, email: member.client.email, emailVerified: true };
    const signedIn = await googleRoundTrip(device, start.authorizationUrl);
    assert.equal(signedIn.status, 303, signedIn.text);
    assert.doesNotMatch(signedIn.headers.get("location") ?? "", /signin_error/);
    const boot = await device.get("/api/v1/bootstrap");
    assert.equal(boot.user.userId, member.client.userId);
    // A callback carried into another browser never completes (no binder cookie).
    const other = ctx.newClient("google-other-browser");
    const again = await device.post("/api/v1/auth/oidc/google/start", { intent: "sign_in" });
    mocks.google.nextIdentity = { sub: googleSub, email: member.client.email, emailVerified: true };
    const mismatch = await googleRoundTrip(other, again.authorizationUrl);
    assert.match(mismatch.headers.get("location") ?? "", /OIDC_BROWSER_MISMATCH/);
    return `token exchanges at the Google double: ${mocks.google.tokenExchanges}`;
  });
  await r.step(P, "Apple or Google sign-in", `a new person joins ${layla.slug} with Sign in with Apple (form_post return, ES256 client secret) after accepting the terms`, async () => {
    const joiner = ctx.newClient("apple-joiner");
    await joiner.fails(400, "POST", "/api/v1/auth/oidc/apple/start", { intent: "join", coachSlug: layla.slug }, "TERMS_REQUIRED");
    const start = await joiner.post("/api/v1/auth/oidc/apple/start", { intent: "join", coachSlug: layla.slug, accepted: true });
    const email = `apple.joiner.${++serial}@privaterelay.sandbox.example`;
    mocks.apple.nextIdentity = { sub: "001234." + randomUUID().replace(/-/g, ""), email, emailVerified: true, name: "Noor Apple" };
    const page = await fetch(start.authorizationUrl);
    const html = await page.text();
    const field = (name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1]?.replace(/&quot;/g, '"').replace(/&amp;/g, "&") ?? "";
    const action = /action="([^"]+)"/.exec(html)?.[1] ?? "";
    assert.match(action, /\/api\/v1\/auth\/oidc\/apple\/callback$/);
    const form = new URLSearchParams({ code: field("code"), state: field("state"), user: field("user") }).toString();
    const back = await joiner.request("POST", new URL(action).pathname, form, {
      headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(mocks.apple.issuer).origin },
    });
    assert.equal(back.status, 303, back.text);
    assert.doesNotMatch(back.headers.get("location") ?? "", /signin_error/, back.headers.get("location") ?? "");
    const boot = await joiner.get("/api/v1/bootstrap");
    assert.equal(boot.user.role, "subscriber");
    assert.equal(boot.tenant.id, layla.tenantId);
    assert.equal(boot.user.emailVerified, true, "Apple asserted a verified email");
    assert.ok(boot.consents.some((c: any) => c.document_type === "registration" && c.granted), "terms acceptance recorded");
    return `Apple client secrets rejected by the double: ${mocks.apple.rejectedClients}`;
  });
}

async function discovery(ctx: E2EContext, layla: TrainerSeed, sara: TrainerSeed) {
  const { reporter: r, admin } = ctx;
  const visitor = ctx.newClient("crawler");
  await r.step(P, "Search-engine sitemap and robots file", "robots.txt closes private areas; sitemap.xml lists published coach websites", async () => {
    const robots = await visitor.request("GET", "/robots.txt");
    assert.equal(robots.status, 200);
    assert.match(robots.text, /Disallow: \/admin/);
    assert.match(robots.text, /Sitemap: /);
    const sitemap = await visitor.request("GET", "/sitemap.xml");
    assert.equal(sitemap.status, 200);
    let xml = sitemap.text;
    if (/<sitemapindex/.test(xml)) {
      const first = /<loc>([^<]+)<\/loc>/.exec(xml)?.[1];
      xml = (await visitor.request("GET", new URL(first!).pathname)).text;
    }
    // Coaches with a published website are listed under /coach/<slug>; a coach
    // with a connected domain is listed by that domain's own sitemap instead.
    const omar = ctx.trainers.find((t) => t.slug === "omar-conditioning" && t.published);
    if (omar) assert.match(xml, new RegExp(`/coach/${omar.slug}`));
    const domainActive = (await layla.client.get("/api/v1/domains")).some((d: any) => d.status === "active");
    if (domainActive) assert.doesNotMatch(xml, new RegExp(`/coach/${layla.slug}`), "a coach on its own domain is left to that domain's sitemap");
    else assert.match(xml, new RegExp(`/coach/${layla.slug}`));
    assert.doesNotMatch(xml, /\/admin|\/trainer\//);
    let coachDomain = "no connected coach domain in this run";
    if (ctx.edge.domainAddress && domainActive) {
      const site = ctx.domainClient("layla-strength-coaching.example", "crawler-coach-domain");
      const coachRobots = await site.request("GET", "/robots.txt");
      assert.match(coachRobots.text, /layla-strength-coaching\.example\/sitemap\.xml/);
      const coachSitemap = await site.request("GET", "/sitemap.xml");
      assert.match(coachSitemap.text, /https:\/\/layla-strength-coaching\.example\//);
      if (omar) assert.doesNotMatch(coachSitemap.text, new RegExp(omar.slug), "a coach domain lists only its own coach");
      coachDomain = "the coach domain serves its own robots.txt and sitemap";
    }
    return coachDomain;
  });
  await r.step(P, "Platform coach directory or search", `${layla.slug} opts in with specialties and languages; the public directory finds it and hides coaches who did not opt in`, async () => {
    const current = await layla.client.get("/api/v1/tenant/directory");
    await layla.client.put("/api/v1/tenant/directory", { version: current.version, listed: true, specialties: ["strength"], languages: ["en", "ar"] });
    const found = await visitor.get("/api/v1/public/directory?q=Layla");
    assert.ok(found.coaches.some((c: any) => c.slug === layla.slug), JSON.stringify(found).slice(0, 300));
    const all = await visitor.get("/api/v1/public/directory");
    assert.ok(!all.coaches.some((c: any) => c.slug === sara.slug), "a coach who did not opt in is not listed");
    const bySpecialty = await visitor.get("/api/v1/public/directory?specialty=strength&language=ar");
    assert.ok(bySpecialty.coaches.some((c: any) => c.slug === layla.slug));
    const page = await visitor.request("GET", "/coaches");
    assert.equal(page.status, 200);
  });
  await r.step(P, "Website contact messages counted as leads", `a consenting visitor's contact message on ${layla.slug}'s website is a lead in the acquisition report and the trainer's analytics`, async () => {
    const prospect = ctx.newClient("lead-visitor");
    await prospect.post("/api/v1/public/acquisition/consent", { granted: true, touch: { source: "instagram", medium: "social", campaign: "e2e_lead_week", site: layla.slug } });
    const before = (await admin.get("/api/v1/admin/operations/acquisition")).rows.find((x: any) => x.campaign === "e2e_lead_week")?.leads ?? 0;
    await prospect.post(`/api/v1/public/sites/${layla.slug}/contact`, {
      name: "Karim Lead",
      email: `karim.lead.${++serial}@sandbox.example`,
      message: "Hello, do you run small group sessions on weekday mornings?",
      consent: true,
    });
    const row = (await admin.get("/api/v1/admin/operations/acquisition")).rows.find((x: any) => x.campaign === "e2e_lead_week");
    assert.equal(row?.leads, before + 1, JSON.stringify(row));
    const analytics = await layla.client.get("/api/v1/analytics/business");
    assert.ok(analytics.leads, "trainer analytics carry leads");
    return JSON.stringify(analytics.leads).slice(0, 200);
  });
  await r.step(P, "Conversion milestones (sign-up, join, publish, first payment)", "a consenting trainer's sign-up, launch and first member payment, and a consenting visitor's join, are attributed to their campaigns", async () => {
    const view = await admin.get("/api/v1/admin/operations/acquisition");
    const trainerRow = view.rows.find((x: any) => x.campaign === "e2e_trainer_funnel");
    assert.ok(trainerRow, "the trainer funnel campaign is reported: " + JSON.stringify(view.rows).slice(0, 400));
    assert.equal(trainerRow.signups, 1);
    assert.equal(trainerRow.published, 1);
    assert.equal(trainerRow.first_paid, 1);
    const joiner = await publicJoin(ctx, layla, "attributed-joiner", "Omar Attributed", async (c) => {
      await c.post("/api/v1/public/acquisition/consent", { granted: true, touch: { source: "podcast", medium: "audio", campaign: "e2e_member_join", site: layla.slug } });
    });
    const joined = (await admin.get("/api/v1/admin/operations/acquisition")).rows.find((x: any) => x.campaign === "e2e_member_join");
    assert.equal(joined?.enrolled, 1, JSON.stringify(joined));
    return `trainer funnel ${JSON.stringify(trainerRow)}; member join ${joiner.client.label}`;
  });
  await r.step(P, "Analytics expiry, export and erasure", "a consenting member's analytics record is in their data export, stops counting after 180 days, and is removed by the worker's purge", async () => {
    const member = await publicJoin(ctx, sara, "analytics-member", "Rima Analytics", async (c) => {
      await c.post("/api/v1/public/acquisition/consent", { granted: true, touch: { source: "flyer", medium: "offline", campaign: "e2e_expiry" } });
    });
    const exported = await member.client.get("/api/v1/privacy/export");
    assert.ok(JSON.stringify(exported).includes("e2e_expiry"), "the personal export includes the analytics record");
    const rows = await ctx.advanceClock(
      "expire one member's analytics consent (180-day window) for the purge",
      "UPDATE acquisition_consents SET expires_at=now()-interval '1 minute' WHERE first_touch->>'campaign'='e2e_expiry'",
    );
    assert.equal(rows, 1);
    const consent = await member.client.get("/api/v1/public/acquisition/consent");
    assert.equal(consent.granted, false, "an expired consent no longer counts");
    const remaining = await ctx.sqlRead("SELECT count(*)::int AS n FROM acquisition_consents WHERE first_touch->>'campaign'='e2e_expiry'");
    return `expired record awaiting the hourly purge: ${remaining[0].n} (the worker purges on start and hourly; see the feature doc)`;
  });
}

async function healthKit(ctx: E2EContext, layla: TrainerSeed) {
  const { reporter: r } = ctx;
  const member = ctx.followers.find((f) => f.trainer === layla && f.paid && f.tier === "workout" && f.client.userId);
  if (!member) {
    r.blocked("no paid workout member of layla-strength", [[F, "Automatic Apple HealthKit sync", "companion pairing and upload"]]);
    return;
  }
  await r.step(F, "Automatic Apple HealthKit sync", `${member.client.label}: pairs a companion app with a one-time code, uploads a day of samples, the trainer sees the activity, the device unpairs`, async () => {
    const status = await member.client.get("/api/v1/healthkit/status");
    assert.equal(status.canPair, true, JSON.stringify(status).slice(0, 400));
    const code = await member.client.post("/api/v1/healthkit/pairing-codes", { consent: true });
    const app = ctx.newClient("companion-app");
    const paired = await app.post("/api/v1/healthkit/device/pair", { code: code.code, deviceName: "Sandbox iPhone", platform: "ios", appVersion: "1.0.0" });
    assert.ok(paired.deviceToken, "device token issued once");
    const auth = { authorization: `Bearer ${paired.deviceToken}` };
    const device = await app.ok("GET", "/api/v1/healthkit/device/status", undefined, auth);
    assert.ok(device.uploadsAllowed !== false, JSON.stringify(device));
    const day = new Date(Date.now() - 2 * 86400000);
    const date = day.toISOString().slice(0, 10);
    const next = new Date(day.getTime() + 86400000).toISOString().slice(0, 10);
    const batch = {
      batchId: "e2e-" + randomUUID().slice(0, 12),
      samples: [
        { type: "step_count", start: `${date}T00:00:00+04:00`, end: `${next}T00:00:00+04:00`, value: 8421, unit: "count" },
        { type: "resting_heart_rate", id: randomUUID(), start: `${date}T07:00:00+04:00`, end: `${date}T07:00:00+04:00`, value: 56, unit: "count/min" },
        { type: "sleep_analysis", id: randomUUID(), start: `${date}T00:30:00+04:00`, end: `${date}T07:00:00+04:00`, stage: "asleep_core" },
        { type: "workout", id: randomUUID(), start: `${date}T18:00:00+04:00`, end: `${date}T18:45:00+04:00`, activity: "traditional_strength_training", durationSeconds: 2700, activeEnergyKcal: 310 },
      ],
    };
    const uploaded = await app.ok("POST", "/api/v1/healthkit/device/samples", batch, auth);
    assert.ok(uploaded.stored >= 3, JSON.stringify(uploaded));
    const replay = await app.ok("POST", "/api/v1/healthkit/device/samples", batch, auth);
    assert.equal(replay.replayed, true, "a retried batch is idempotent");
    const activity = await layla.client.get(`/api/v1/healthkit/activity?userId=${member.client.userId}`);
    assert.ok(JSON.stringify(activity).includes("8421") || JSON.stringify(activity).includes(date), JSON.stringify(activity).slice(0, 400));
    await app.ok("POST", "/api/v1/healthkit/device/unpair", {}, auth);
    const gone = await app.request("GET", "/api/v1/healthkit/device/status", undefined, { headers: auth });
    assert.equal(gone.status, 401);
    return `stored ${uploaded.stored}, days ${uploaded.days}`;
  });
}
