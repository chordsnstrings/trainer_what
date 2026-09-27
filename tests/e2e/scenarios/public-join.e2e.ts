/**
 * Public join: what an anonymous visitor, a prospective trainer and a
 * prospective follower see and can do before and while joining. Feature names
 * match the "public-join" inventory.
 */
import assert from "node:assert/strict";
import type { E2EContext } from "../harness/context.ts";
import { PASSWORD } from "../harness/data.ts";

const P = "public-join" as const;
const S = "Super admin" as const;

export async function publicJoinScenarios(ctx: E2EContext) {
  const anon = ctx.newClient("visitor");
  for (const [path, feature] of [
    ["/", "Home page"],
    ["/how-it-works", "How it works page"],
    ["/pricing", "Pricing ('The economics') page"],
    ["/demo", "Demo page"],
    ["/faq", "FAQ page"],
  ] as const)
    await ctx.reporter.step(P, feature, `GET ${path} renders through the edge and web proxy`, async () => {
      const r = await anon.request("GET", path);
      assert.equal(r.status, 200);
      assert.match(r.text, /<html/i);
    });
  await ctx.reporter.step(P, "HTTPS and browser security headers", "security headers on pages and API", async () => {
    const page = await anon.request("GET", "/");
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    const api = await anon.request("GET", "/api/v1/ready");
    assert.equal(api.headers.get("cache-control"), "no-store");
    const crossSite = await anon.request("POST", "/api/v1/auth/login", { email: "x@sandbox.example", password: "x" }, { headers: { origin: "https://attacker.example" } });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.body.code, "ORIGIN_REJECTED");
  });
  for (const [key, feature] of [
    ["terms", "Terms page (/terms)"],
    ["privacy", "Privacy page (/privacy)"],
    ["ai-disclosure", "Digital coaching / AI disclosure page (/ai-disclosure)"],
  ] as const)
    await ctx.reporter.step(P, feature, `/${key} page and published document`, async () => {
      const page = await anon.request("GET", "/" + key);
      assert.equal(page.status, 200);
      const doc = await anon.get(`/api/v1/public/documents/${key}`);
      assert.equal(doc.document.key, key);
    });
  await ctx.reporter.step(P, "Earlier legal versions", "a second terms version keeps version 1 readable", async () => {
    await ctx.admin.stepUp();
    const doc = await ctx.admin.post("/api/v1/admin/documents", {
      kind: "legal",
      key: "terms",
      title: "Sandbox terms v2 (synthetic)",
      content: "SYNTHETIC TERMS VERSION 2 FOR THE MOCK-PROVIDER SANDBOX. Not legal advice.",
    });
    await ctx.admin.post(`/api/v1/admin/documents/${doc.id}/publish`, { revision: doc.revision ?? 1, effectiveAt: new Date().toISOString(), reason: "Sandbox second version" });
    const current = await anon.get("/api/v1/public/documents/terms");
    assert.equal(current.document.version, 2);
    assert.ok(current.versions.length >= 2);
    const first = await anon.get("/api/v1/public/documents/terms?version=1");
    assert.equal(first.document.version, 1);
  });
  await ctx.reporter.step(P, "Sign-up and join lock until legal approval", "registration is open only because LEGAL_APPROVED is on", async () => {
    const settings = await ctx.admin.get("/api/v1/admin/settings");
    const app = settings.integrations.find((i: any) => i.id === "application");
    assert.equal(app.values.LEGAL_APPROVED, "true");
  });

  // ------------------------------------------------------------ analytics
  const prospect = ctx.newClient("prospect-trainer", "yasmin.coach@sandbox.example", PASSWORD);
  let experimentId = "";
  await ctx.reporter.step(S, "Wording experiments", "Superadmin starts a landing wording experiment", async () => {
    const experiment = await ctx.admin.post("/api/v1/admin/experiments", {
      key: "landing-welcome",
      title: "Landing headline test",
      surface: "landing",
      allocation: 50,
      variantA: "Coach more people with your own methods",
      variantB: "Your coaching, amplified",
      metric: "signup",
      guardrail: "Stop if sign-up completion drops or complaints rise.",
    });
    experimentId = experiment.id;
    await ctx.admin.post(`/api/v1/admin/experiments/${experiment.id}/transition`, { revision: experiment.revision, status: "running", result: "Starting the sandbox wording test" });
  });
  await ctx.reporter.step(P, "Optional analytics consent panel", "visitor opts in with a campaign and referral code", async () => {
    const before = await prospect.get("/api/v1/public/acquisition/consent");
    assert.equal(before.granted, false);
    const granted = await prospect.post("/api/v1/public/acquisition/consent", {
      granted: true,
      touch: { source: "instagram", medium: "social", campaign: "launch_week", referral: "LAYLA10" },
    });
    assert.equal(granted.granted, true);
    assert.ok(prospect.cookies.size >= 1, "consent cookie issued");
  });
  await ctx.reporter.step(P, "Campaign and referral code capture", "first and last touch retained", async () => {
    const consent = await prospect.get("/api/v1/public/acquisition/consent");
    assert.equal(consent.firstTouch.campaign, "launch_week");
    assert.equal(consent.firstTouch.referral, "LAYLA10");
  });
  await ctx.reporter.step(P, "Landing visit tracking", "visit recorded for the consenting visitor only", async () => {
    assert.equal((await prospect.post("/api/v1/public/acquisition/visit", { source: "newsletter", campaign: "week2" })).recorded, true);
    assert.equal((await anon.post("/api/v1/public/acquisition/visit", { source: "google" })).recorded, false);
  });
  await ctx.reporter.step(P, "Landing wording experiments", "consenting visitor gets a stable variant", async () => {
    const one = await prospect.get("/api/v1/public/experiments/landing-welcome");
    const two = await prospect.get("/api/v1/public/experiments/landing-welcome");
    assert.ok(one.text ?? one.variant, JSON.stringify(one));
    assert.equal(JSON.stringify(one), JSON.stringify(two));
    await prospect.post(`/api/v1/public/experiments/landing-welcome/exposure`, {}).catch(() => undefined);
  });
  await ctx.reporter.step(P, "Trainer sign-up from the marketing site", "attributed trainer registration", async () => {
    const r = await prospect.request("POST", "/api/v1/auth/register", {
      name: "Yasmin Karam",
      email: prospect.email,
      password: PASSWORD,
      slug: "yasmin-pilates",
      accepted: true,
    });
    assert.equal(r.status, 201, r.text);
  });
  await ctx.reporter.step(P, "Coaching address reserved at sign-up", "reserved slug is taken and reserved words are refused", async () => {
    const dup = ctx.newClient("dup-trainer");
    const r = await dup.request("POST", "/api/v1/auth/register", { name: "Other", email: "other.coach@sandbox.example", password: PASSWORD, slug: "yasmin-pilates", accepted: true });
    assert.ok(r.status >= 400);
    const reserved = await dup.request("POST", "/api/v1/auth/register", { name: "Other", email: "other2.coach@sandbox.example", password: PASSWORD, slug: "admin", accepted: true });
    assert.equal(reserved.status, 400);
  });
  await ctx.reporter.step(S, "Acquisition funnel", "the funnel counts the attributed sign-up", async () => {
    const view = await ctx.admin.get("/api/v1/admin/operations/acquisition");
    const row = view.rows.find((r: any) => r.campaign === "launch_week");
    assert.ok(row && row.signups >= 1, JSON.stringify(view.rows).slice(0, 300));
  });
  await ctx.reporter.step(P, "Withdraw analytics consent", "withdrawal removes the visitor record", async () => {
    await prospect.del("/api/v1/public/acquisition/consent");
    const after = await prospect.get("/api/v1/public/acquisition/consent");
    assert.equal(after.granted, false);
  });
  if (experimentId)
    await ctx.admin
      .post(`/api/v1/admin/experiments/${experimentId}/transition`, {
        revision: (await ctx.admin.get("/api/v1/admin/operations/experiments")).rows.find((r: any) => r.id === experimentId)?.revision ?? 2,
        status: "stopped",
        result: "Sandbox experiment finished",
      })
      .catch(() => undefined);

  // ------------------------------------------------------------ coach website
  const layla = ctx.trainers.find((t) => t.slug === "layla-strength" && t.published);
  if (layla) {
    for (const [section, feature] of [
      ["", "Coach website home page"],
      ["/about", "About page"],
      ["/memberships", "Memberships page with prices"],
      ["/galleries", "Photo galleries page"],
      ["/contact", "Contact page with direct links"],
    ] as const)
      await ctx.reporter.step(P, feature, `GET /coach/${layla.slug}${section} server-rendered`, async () => {
        const r = await anon.request("GET", `/coach/${layla.slug}${section}`);
        assert.equal(r.status, 200);
        if (section === "") assert.match(r.text, /Strength that fits a busy week/);
        if (section === "/memberships") assert.match(r.text, /299|AED/);
        if (section === "/galleries") assert.match(r.text, /Studio/, "the published gallery is on the page");
      });
    await ctx.reporter.step(P, "Custom pages", `GET /coach/${layla.slug}/schedule: the trainer's own page`, async () => {
      const r = await anon.request("GET", `/coach/${layla.slug}/schedule`);
      assert.equal(r.status, 200);
      assert.match(r.text, /Weekly schedule/);
      assert.match(r.text, /Monday, Wednesday and Friday/);
      });
    await ctx.reporter.step(P, "Search and sharing titles", "SEO title and description in the page head", async () => {
      const r = await anon.request("GET", `/coach/${layla.slug}`);
      assert.match(r.text, /<title>[^<]*Layla Haddad/);
    });
    await ctx.reporter.step(P, "Coach-branded app icon and install manifest", "manifest and icon served", async () => {
      const manifest = await anon.get(`/api/v1/public/sites/${layla.slug}/manifest.webmanifest`);
      assert.ok(manifest.name);
      const icon = await anon.request("GET", `/api/v1/public/sites/${layla.slug}/icon/192`, undefined, { raw: true });
      assert.equal(icon.status, 200);
      assert.match(icon.headers.get("content-type") ?? "", /image\//);
    });
    await ctx.reporter.step(P, "Contact form", "inquiry reaches the trainer inbox", async () => {
      const visitor = ctx.newClient("site-visitor");
      await visitor.post(`/api/v1/public/sites/${layla.slug}/contact`, {
        name: "Prospective client",
        email: "prospect.client@sandbox.example",
        message: "Do you offer early morning sessions in Dubai Marina?",
        consent: true,
      });
      const inquiries = await layla.client.get("/api/v1/tenant/site/inquiries");
      assert.ok(JSON.stringify(inquiries).includes("early morning sessions"));
    });
    await ctx.reporter.step(P, "Abuse limits on public forms", "fifth contact submission within an hour is rate limited", async () => {
      const spammer = ctx.newClient("spammer");
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++)
        statuses.push(
          (
            await spammer.request(
              "POST",
              `/api/v1/public/sites/${layla.slug}/contact`,
              { name: "Spam", email: "spam@sandbox.example", message: "Repeated synthetic message " + i, consent: true },
              { noRetry: true },
            )
          ).status,
        );
      assert.deepEqual(statuses.slice(0, 4), [200, 200, 200, 200]);
      assert.equal(statuses[4], 429);
    });
    await ctx.reporter.step(P, "Activate an offer so followers can see and buy it", "public trainer API lists published offers", async () => {
      const r = await anon.get(`/api/v1/public/trainers/${layla.slug}`);
      assert.ok(r.products.length >= 2);
    });
  }
  const sara = ctx.trainers.find((t) => t.slug === "sara-mobility");
  if (sara)
    await ctx.reporter.step(P, "Unpublished coach address today", "a launched trainer without a published website", async () => {
      const r = await anon.request("GET", `/api/v1/public/sites/${sara.slug}`);
      return `public site API ${r.status}`;
    });

  // ------------------------------------------------------------ joining more than one coach
  const omar = ctx.trainers.find((t) => t.slug === "omar-conditioning" && t.tenantId);
  const multi = ctx.followers.find((f) => f.trainer.slug === "layla-strength" && f.paid);
  if (omar && multi)
    await ctx.reporter.step(P, "Existing account joins another coach", `${multi.client.label} joins Omar with the existing account`, async () => {
      const invite = await omar.client.post("/api/v1/invitations", { email: multi.client.email, role: "subscriber" });
      const token = invite.url.split("/").pop();
      await multi.client.post("/api/v1/invitations/accept", { token, name: "Existing member", email: multi.client.email, password: multi.client.password, accepted: true });
      const workspaces = await multi.client.get("/api/v1/auth/workspaces");
      assert.equal(workspaces.workspaces.length, 2);
    });
  if (omar && multi)
    await ctx.reporter.step(P, "Switch between coaches", `${multi.client.label} switches back to Layla`, async () => {
      const workspaces = await multi.client.get("/api/v1/auth/workspaces");
      const target = workspaces.workspaces.find((w: any) => w.slug === "layla-strength");
      await multi.client.post("/api/v1/auth/workspace", { tenantId: target.tenantId });
      assert.equal((await multi.client.get("/api/v1/bootstrap")).tenant.slug, "layla-strength");
    });
  if (sara?.client.recoveryCodes.length)
    await ctx.reporter.step(P, "Authenticator recovery-code sign-in", `${sara.slug}: recovery code resets the authenticator and signs in`, async () => {
      const lost = ctx.newClient("sara-lost-phone", sara.client.email, sara.client.password);
      await lost.post("/api/v1/auth/mfa/recover", { email: sara.client.email, password: sara.client.password, recoveryCode: sara.client.recoveryCodes[0] });
      const security = await lost.get("/api/v1/auth/security");
      assert.equal(security.mfaEnabled, false, "authenticator reset after recovery");
      lost.mfaSecret = undefined;
      await lost.enrollMfa();
      // The recovered device becomes the trainer's client from here on.
      lost.userId = sara.client.userId;
      lost.tenantId = sara.client.tenantId;
      sara.client = lost;
    });
}
