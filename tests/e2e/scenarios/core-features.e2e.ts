/**
 * The core features of September 2026, end to end against the mock providers:
 *
 * - Trainer Brain plans (docs/features/brain-plans.md): low-confidence plans in
 *   the trainer's review queue with approve, edit and reject; learning from
 *   those decisions; held-out plan qualification; automatic delivery after it
 *   (a trainer's regenerate and the worker's intake job); low confidence and
 *   the code safety floor still routing to the trainer; a weekly adaptation
 *   from logged outcomes.
 * - Programme (docs/features/programme.md): an upfront whole-programme offer
 *   bought through the Stripe double, Day N of M, the voice add-on added and
 *   set to end.
 * - Voice-led session (docs/features/voice-session.md): the Brain's wording
 *   suggestions, a script prepared ahead with audio made by the worker, spoken
 *   replies through the speech-to-text double, and pain stopping the session
 *   and opening a training hold.
 * - Trainer voice clones (docs/features/trainer-voice.md, voice-clone.e2e.ts):
 *   the Cartesia double, a Quick clone previewed, activated, spoken in a
 *   session and deleted.
 * - Web addresses (docs/features/web-addresses.md): the automatic subdomain
 *   through the coach-domain edge, domain search, purchase and yearly renewal
 *   through the Namecheap double, the domain's zone at the DigitalOcean DNS
 *   double and its delegation there, and the forwarding choice, never naming
 *   the registrar or the DNS host to the trainer.
 * - Marketing site (docs/features/marketing-site.md): key pages, sitemap,
 *   llms.txt and the follower calculator's model.
 *
 * Every member here is created for the scenario. Two things a run cannot wait
 * for are stood in for and recorded under `clockShifts`: the Brain plan
 * scheduler's 10-minute pass (the harness queues the job that pass would queue,
 * and the real worker runs it) and nothing else; no timestamp is moved.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "../harness/client.ts";
import type { E2EContext, TrainerSeed } from "../harness/context.ts";
import { PASSWORD } from "../harness/data.ts";
import { PLATFORM_ROOT_DOMAIN, WEB_ADDRESS_SANDBOX_IPV4 } from "../mocks/index.ts";
import { estimateFollowerConversion } from "../../../packages/domain/src/marketing-calculators.ts";
import { trainerVoiceCloneScenarios } from "./voice-clone.e2e.ts";

const A = "Super admin" as const;
const T = "Trainers" as const;
const F = "followers" as const;
const P = "public-join" as const;

let serial = 0;
type Profile = { goal: string; experience: string; daysPerWeek: number; equipment: string; limitations: string };
const STRENGTH: Profile = { goal: "Build strength", experience: "beginner", daysPerWeek: 3, equipment: "Dumbbells, bench", limitations: "None reported" };
const RUNNER: Profile = { goal: "Run a marathon", experience: "advanced", daysPerWeek: 5, equipment: "Full gym access", limitations: "None reported" };
const LIMITED: Profile = { ...STRENGTH, limitations: "Recovering from knee surgery" };

/** A new person who joins the coach's public page, verifies email, completes the intake and pays. */
async function joinAndPay(ctx: E2EContext, trainer: TrainerSeed, label: string, name: string, profile: Profile, productId: string) {
  const email = `${label}.${++serial}@sandbox.example`;
  const client = ctx.newClient(label, email, PASSWORD);
  const r = await client.request("POST", "/api/v1/auth/enroll", { name, email, password: PASSWORD, coachSlug: trainer.slug, accepted: true });
  assert.equal(r.status, 201, r.text);
  const boot = await client.get("/api/v1/bootstrap");
  client.userId = boot.user.userId;
  client.tenantId = boot.tenant.id;
  await ctx.verifyEmail(client);
  await client.post("/api/v1/intake", { age: 33, ...profile, consent: true });
  const checkout = await client.post("/api/v1/payments/checkout", { productId });
  const sessionId = new URL(checkout.url).pathname.split("/").pop()!;
  const paid = await ctx.mocks.stripe.completeCheckout(sessionId);
  for (const d of paid.deliveries ?? []) assert.equal(d.status, 200, `${d.type} webhook: ${d.body}`);
  return client;
}

/** A minimal valid WAV whose bytes carry the words the speech-to-text double returns. */
function wav(words: string) {
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36, 4);
  header.write("WAVE", 8, "ascii");
  return Buffer.concat([header, Buffer.from(`fmt TRANSCRIPT:${words};`), Buffer.alloc(64)]).toString("base64");
}

export async function coreFeatureScenarios(ctx: E2EContext) {
  const layla = ctx.trainers.find((t) => t.slug === "layla-strength" && t.published);
  await marketing(ctx);
  if (!layla?.products.workout) {
    ctx.reporter.missingPrerequisite("layla-strength launched with a workout offer");
    return;
  }
  await layla.client.stepUp();
  const order = await webAddressPurchase(ctx, layla);
  const brain = await brainPlans(ctx, layla);
  const member = await programme(ctx, layla, brain);
  if (member) {
    await weeklyAdaptation(ctx, layla, member);
    await voiceSession(ctx, layla, member);
    // Cartesia Quick clone -> preview -> activate -> session audio -> delete.
    await trainerVoiceCloneScenarios(ctx, layla, member);
  }
  // Supervised again, so the scheduler's own later passes in this run send
  // other members' plans to the trainer rather than delivering them.
  await ctx.reporter.prepare(T, "Trainer Brain plan settings", "back to supervised mode", async () => {
    const ws = await layla.client.get("/api/v1/brain/plans/workspace");
    await layla.client.put("/api/v1/brain/plans/settings", { settings: { ...ws.settings, mode: "supervised" }, version: ws.settingsVersion });
  });
  if (member) await voiceAddOnRemoval(ctx, member);
  if (order) await webAddressLifecycle(ctx, layla, order);
}

// ------------------------------------------------------------------ marketing

const KEY_PAGES = ["/", "/how-it-works", "/trainer-brain", "/features", "/pricing", "/follower-calculator", "/earnings-calculator", "/faq", "/uae", "/for-trainers", "/guides", "/about"];

async function marketing(ctx: E2EContext) {
  const r = ctx.reporter;
  const visitor = ctx.newClient("marketing-visitor");
  const pages: Record<string, string> = {};
  await r.step(P, "Public marketing site", `${KEY_PAGES.length} key pages render with one H1, a canonical address and structured data`, async () => {
    for (const path of KEY_PAGES) {
      const page = await visitor.request("GET", path);
      assert.equal(page.status, 200, `${path} → ${page.status}`);
      assert.equal((page.text.match(/<h1[\s>]/g) ?? []).length, 1, `${path}: one H1`);
      assert.match(page.text, /<link[^>]+rel="canonical"/, `${path}: canonical link`);
      assert.match(page.text, /application\/ld\+json/, `${path}: JSON-LD`);
      pages[path] = page.text;
    }
    const moved = await visitor.request("GET", "/uae/dubai");
    assert.equal(moved.status, 308, "a retired doorway page redirects");
    assert.match(moved.headers.get("location") ?? "", /\/uae#dubai$/);
    assert.equal((await visitor.request("GET", "/features/not-a-real-feature")).status, 404);
    return `${KEY_PAGES.length} pages; /uae/dubai → 308 /uae#dubai; unknown feature page 404`;
  });
  await r.step(P, "Sitemap and robots for the marketing site", "sitemap.xml lists every key page; robots.txt points to it", async () => {
    const robots = await visitor.request("GET", "/robots.txt");
    assert.equal(robots.status, 200);
    assert.match(robots.text, /Sitemap: \S+sitemap\.xml/);
    const first = await visitor.request("GET", "/sitemap.xml");
    assert.equal(first.status, 200);
    let xml = first.text;
    if (/<sitemapindex/.test(xml))
      for (const m of first.text.matchAll(/<loc>([^<]+)<\/loc>/g)) xml += (await visitor.request("GET", new URL(m[1]).pathname)).text;
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.replace(/\/$/, "") || "/");
    for (const path of KEY_PAGES) assert.ok(locs.includes(path), `${path} in the sitemap`);
    assert.ok(!locs.some((p) => /^\/(admin|trainer|app)(\/|$)/.test(p)), "no private area in the sitemap");
    return `${locs.length} addresses`;
  });
  await r.step(P, "llms.txt for AI assistants", "/llms.txt is an llmstxt.org index of the pages; /llms-full.txt carries their text", async () => {
    const index = await visitor.request("GET", "/llms.txt");
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type") ?? "", /text\/(plain|markdown)/);
    assert.match(index.text, /^# \S/, "H1 first");
    assert.match(index.text, /^> /m, "entity blockquote");
    assert.match(index.text, /^## /m, "link sections");
    for (const path of ["/how-it-works", "/pricing", "/follower-calculator"]) assert.ok(index.text.includes(path + ")"), path);
    const full = await visitor.request("GET", "/llms-full.txt");
    assert.equal(full.status, 200);
    assert.ok(full.text.length > index.text.length * 2, "the full file carries page text");
    for (const text of [index.text, full.text, ...Object.values(pages)])
      assert.doesNotMatch(text, /namecheap/i, "public pages never name a registrar");
    return `llms.txt ${index.text.length} characters, llms-full.txt ${full.text.length}`;
  });
  await r.step(P, "Follower calculator", "the public platform endpoint serves the follower model; its scenarios are ordered and bounded", async () => {
    const platform = await visitor.get("/api/v1/public/platform");
    const model = platform.followerModel;
    assert.ok(model?.version && Array.isArray(model.tiers) && model.tiers.length && model.scenarios?.strong, JSON.stringify(platform).slice(0, 300));
    const estimate = estimateFollowerConversion({ followers: 7000, linkStoriesPerMonth: 8, priceAed: 199 }, model);
    assert.equal(estimate.assumptionsVersion, model.version);
    const { cautious, typical, strong } = estimate.scenarios;
    for (const r of [cautious, typical, strong]) {
      assert.ok(r.month1New >= 0 && r.month1New <= r.signups12 + 1e-9, JSON.stringify(r));
      assert.ok(r.activeMonth12 <= r.signups12 + 1e-9 && r.signups12 <= r.visitors12 + 1e-9);
    }
    assert.ok(cautious.signups12 <= typical.signups12 && typical.signups12 <= strong.signups12, "scenarios are ordered");
    assert.ok(strong.activeMonth12 > 0);
    const page = pages["/follower-calculator"];
    assert.match(page, /follower/i);
    return `7,000 followers, 8 link Stories, 4 keyword Reels: strong case ${strong.month1New.toFixed(1)} in the first month, ${strong.activeMonth12.toFixed(1)} active after 12 months (typical ${typical.activeMonth12.toFixed(1)}; model ${model.version})`;
  });
}

// ------------------------------------------------------------------ web addresses

type Purchase = { orderId: string; domain: string; subscriptionId: string };

/** No registrar name or cost (USD 10.46 / 16.06 at the double) in anything the trainer receives. */
function assertNoRegistrar(text: string, where: string) {
  assert.doesNotMatch(text, /namecheap|registrar-servers|10\.46|16\.06|registerUsd|renewUsd|priceRule/i, `${where} names the registrar or its cost`);
}

async function webAddressPurchase(ctx: E2EContext, layla: TrainerSeed): Promise<Purchase | undefined> {
  const r = ctx.reporter;
  const t = layla.client;
  const host = `${layla.slug}.${PLATFORM_ROOT_DOMAIN}`;
  await r.step(T, "Automatic web address (subdomain)", `${layla.slug}: https://${host}/ serves the coach website through the edge; unknown and reserved names are refused`, async () => {
    const view = await t.request("GET", "/api/v1/web-address");
    assert.equal(view.status, 200, view.text);
    assertNoRegistrar(view.text, "GET /web-address");
    assert.equal(view.body.subdomain.host, host);
    assert.equal(view.body.subdomain.live, true);
    await t.fails(400, "POST", "/api/v1/web-address/slug", { slug: "admin", currentSlug: layla.slug }, "RESERVED_SLUG");
    if (!ctx.edge.domainAddress) return "coach-domain edge unavailable: " + ctx.edge.domainError;
    const visitor = ctx.domainClient(host, "subdomain-visitor");
    const home = await visitor.request("GET", "/");
    assert.equal(home.status, 200, "HTTP " + home.status);
    assert.match(home.text, /Layla/);
    const asked = ctx.edge.asks.filter((a) => a.name === host);
    assert.ok(asked.some((a) => a.status === 200), "the edge asked the API before presenting a certificate");
    const stranger = ctx.domainClient(`no-such-coach.${PLATFORM_ROOT_DOMAIN}`, "subdomain-stranger");
    const refused = await stranger.request("GET", "/").then(
      () => false,
      () => true,
    );
    assert.ok(refused, "no certificate for a subdomain no workspace has");
    assert.ok(ctx.edge.asks.some((a) => a.name === `no-such-coach.${PLATFORM_ROOT_DOMAIN}` && a.status !== 200));
    return `home ${home.status}; unknown subdomain refused in the TLS handshake`;
  });
  let found: any;
  await r.step(T, "Search for a domain", `${layla.slug}: the name on every suggested ending in one registrar request, USD first-year and renewal prices, taken and over-USD-100 names left out, without naming the registrar`, async () => {
    const nc = ctx.mocks.namecheap;
    // Someone holds laylastrength.fit; laylastrength.coach is a premium name
    // over the USD 100 limit; the double does not sell .ae.
    nc.taken.add("laylastrength.fit");
    nc.premium.set("laylastrength.coach", "250.00");
    // Ending prices come from the registrar once a day (the worker keeps
    // them warm); right after start-up a search may still say some endings
    // could not be checked yet, and a later one is complete.
    let search: any;
    for (let attempt = 1; attempt <= 8; attempt++) {
      search = await t.request("GET", "/api/v1/web-address/search?q=laylastrength");
      assert.equal(search.status, 200, search.text);
      if (!search.body.incomplete) break;
      await new Promise((done) => setTimeout(done, 15000));
    }
    assert.equal(search.body.incomplete, false, "every ending priced and checked");
    assertNoRegistrar(search.text, "search");
    const checks = nc.commands("domains.check").length;
    const again = await t.request("GET", "/api/v1/web-address/search?q=Laylastrength");
    assert.equal(again.status, 200, again.text);
    assert.ok(nc.commands("domains.check").length <= checks + 1, "at most one availability request for every ending");
    assert.deepEqual(search.body.requested, { domain: "laylastrength.com", status: "available" });
    // Owner's rule: the cost rounded up to USD 5, plus USD 4.99.
    assert.deepEqual(
      search.body.results.map((x: any) => [x.domain, x.firstYearPriceMinor, x.renewalPriceMinor, x.currency]),
      [
        ["laylastrength.com", 1999, 2499, "USD"],
        ["laylastrength.fitness", 1499, 4499, "USD"],
        ["laylastrength.training", 1499, 4499, "USD"],
        ["laylastrength.club", 999, 2499, "USD"],
        ["laylastrength.pro", 999, 2999, "USD"],
        ["laylastrength.app", 1999, 2499, "USD"],
        ["laylastrength.me", 1499, 2999, "USD"],
      ],
    );
    // A typed name that is taken shows as taken, with the other endings offered.
    const taken = await t.request("GET", "/api/v1/web-address/search?q=laylastrength.fit");
    assert.equal(taken.status, 200, taken.text);
    assert.deepEqual(taken.body.requested, { domain: "laylastrength.fit", status: "taken" });
    assert.equal(taken.body.results[0].domain, "laylastrength.com");
    found = search.body.results[0];
    return search.body.results.map((x: any) => `${x.domain}:${x.firstYearPriceMinor / 100}/${x.renewalPriceMinor / 100}`).join(" ");
  });
  if (!found?.available) return undefined;
  let purchase: Purchase | undefined;
  await r.step(T, "Buy a domain with a yearly subscription", `${layla.slug}: agreed prices, Stripe Checkout at the double, first invoice paid`, async () => {
    const created = await t.post("/api/v1/web-address/orders", {
      domain: found.domain,
      firstYearPriceMinor: found.firstYearPriceMinor,
      renewalPriceMinor: found.renewalPriceMinor,
      currency: "USD",
      accepted: true,
    });
    assert.ok(created.orderId && created.url, JSON.stringify(created));
    const sessionId = new URL(created.url).pathname.split("/").pop()!;
    const paid = await ctx.mocks.stripe.completeCheckout(sessionId);
    for (const d of paid.deliveries ?? []) assert.equal(d.status, 200, `${d.type} webhook: ${d.body}`);
    assert.ok(paid.subscription?.id, "a yearly subscription");
    // USD 24.99 a year, with the first invoice at USD 19.99 (a once-only coupon).
    assert.equal(paid.session.currency, "usd");
    assert.equal(paid.invoice.amount_paid, 1999);
    assert.equal(paid.invoice.currency, "usd");
    assert.equal(paid.subscription.items.data[0].price.unit_amount, 2499);
    purchase = { orderId: created.orderId, domain: found.domain, subscriptionId: paid.subscription.id };
    const view = await t.request("GET", `/api/v1/web-address/orders/${created.orderId}`);
    assertNoRegistrar(view.text, "order view");
    return `order ${view.body.status ?? view.body.order?.status}`;
  });
  return purchase;
}

async function webAddressLifecycle(ctx: E2EContext, layla: TrainerSeed, order: Purchase) {
  const r = ctx.reporter;
  const t = layla.client;
  const nc = ctx.mocks.namecheap;
  const orderView = async () => {
    const view = await t.request("GET", `/api/v1/web-address/orders/${order.orderId}`);
    assert.equal(view.status, 200, view.text);
    assertNoRegistrar(view.text, "order view");
    return view.body.order ?? view.body;
  };
  let expiresAt = "";
  const zones = ctx.mocks.digitalocean;
  await r.step(T, "Domain registered and set up automatically", `${order.domain}: the worker registers it for the platform company with privacy, creates its zone and A records at the DigitalOcean DNS double, then delegates it there through the registrar`, async () => {
    const dns = await ctx.waitUntil("delegation is visible and the order reaches the DNS check", async () => {
      const o = await orderView();
      return o.status === "dns" && o;
    }, 180000);
    const steps = dns.progress.map((p: any) => p.step);
    for (const step of ["paid", "purchasing", "registered", "zone", "connecting", "dns"])
      assert.ok(steps.includes(step), `progress ${steps.join(",")}`);
    assert.doesNotMatch(JSON.stringify(dns), /digitalocean|nameserver/i, "the trainer never sees the DNS host");
    const registration = nc.registrations.get(order.domain);
    assert.ok(registration, "registered at the registrar double");
    assert.equal(registration.whoisguard, true, "WHOIS privacy");
    assert.equal(registration.contact.FirstName, "Sandbox", "the platform company is the registrant");
    const created = nc.commands("domains.create").find((c) => c.params.DomainName === order.domain);
    assert.equal(created?.params.RegistrantOrganizationName, "Sandbox Platform Company LLC");
    // The zone holds A records for the domain and www only: never a wildcard.
    assert.deepEqual(zones.view(order.domain), [
      `@ A ${WEB_ADDRESS_SANDBOX_IPV4.target}`,
      `www A ${WEB_ADDRESS_SANDBOX_IPV4.target}`,
    ]);
    // Delegated to DigitalOcean after the zone existed; registrar host records untouched.
    assert.deepEqual(registration.nameservers, ["ns1.digitalocean.com", "ns2.digitalocean.com", "ns3.digitalocean.com"]);
    assert.equal(nc.commands("domains.dns.setHosts").filter((c) => `${c.params.SLD}.${c.params.TLD}` === order.domain).length, 0);
    expiresAt = dns.expiresAt;
    assert.ok(Date.parse(expiresAt) > Date.now() + 360 * 86400000, "registered for a year");
    return `${steps.join(" → ")}; expires ${expiresAt.slice(0, 10)}; the name resolves to the sandbox target address, which no edge serves, so the Live step (HTTPS) stays pending in the sandbox`;
  });
  await r.step(T, "Forward the domain to the workspace address", `${order.domain}: the trainer switches between showing the site and a 301 to the subdomain`, async () => {
    const forward = await t.post(`/api/v1/web-address/orders/${order.orderId}/serve-mode`, { mode: "forward" });
    assert.equal(forward.serveMode, "forward");
    const site = await t.post(`/api/v1/web-address/orders/${order.orderId}/serve-mode`, { mode: "site" });
    assert.equal(site.serveMode, "site");
    assertNoRegistrar(JSON.stringify(site), "serve mode answer");
    return "forward, then site";
  });
  if (!expiresAt) return;
  await r.step(T, "Domain renews every year", `${order.domain}: the yearly invoice is paid at the Stripe double and the worker renews it at the registrar once`, async () => {
    const renewed = await ctx.mocks.stripe.renew(order.subscriptionId);
    for (const d of renewed.deliveries) assert.equal(d.status, 200, `${d.type} webhook: ${d.body}`);
    assert.equal(renewed.invoice.amount_paid, 2499, "renewal charged at USD 24.99");
    assert.equal(renewed.invoice.currency, "usd");
    const done = await ctx.waitUntil("the renewal is recorded", async () => {
      const o = await orderView();
      return o.renewalStatus === "renewed" && o;
    }, 180000);
    assert.ok(done.progress.some((p: any) => p.step === "renewal_paid") && done.progress.some((p: any) => p.step === "renewed"));
    const extended = Date.parse(done.expiresAt) - Date.parse(expiresAt);
    assert.ok(extended > 360 * 86400000 && extended < 370 * 86400000, `expiry moved by ${extended / 86400000} days`);
    assert.equal(nc.commands("domains.renew").filter((c) => c.params.DomainName === order.domain).length, 1, "renewed once");
    return `expires ${String(done.expiresAt).slice(0, 10)}`;
  });
  await r.step(A, "Web address operations", `${order.domain}: the operator view lists the order and its registrar calls`, async () => {
    const view = await ctx.admin.request("GET", "/api/v1/admin/web-addresses");
    if (view.status === 403 && view.body?.code === "MFA_STEP_UP") await ctx.admin.stepUp(true);
    const ops = await ctx.admin.get("/api/v1/admin/web-addresses");
    const text = JSON.stringify(ops);
    assert.ok(text.includes(order.domain), text.slice(0, 300));
    for (const kind of ["register", "create_zone", "set_records", "set_nameservers", "renew"])
      assert.ok(text.includes(kind), `${kind} in the operator view`);
    assert.ok(text.includes('"dns_provider":"digitalocean"'), "the operator sees the DNS host");
  });
}

// ------------------------------------------------------------------ Brain plans

type BrainState = { threshold: number; qualified: boolean };

/** Every library and template exercise gets equipment tags, as the plan gate requires. */
const TAGS: Array<[RegExp, string[]]> = [
  [/barbell/i, ["barbell", "squat rack"]],
  [/bench press|row/i, ["dumbbells", "bench"]],
  [/dumbbell|goblet|romanian|lunge|curl/i, ["dumbbells"]],
  [/push-?up|plank|bodyweight|bridge|crunch|pull-?up|squat/i, ["bodyweight"]],
];
const tagsFor = (name: string) => TAGS.find(([re]) => re.test(name))?.[1] ?? ["machine"];

async function brainPlans(ctx: E2EContext, layla: TrainerSeed): Promise<BrainState | undefined> {
  const r = ctx.reporter;
  const t = layla.client;
  const workspace = () => t.get("/api/v1/brain/plans/workspace");
  const queueItem = async (id: string) => (await workspace()).queue.find((q: any) => q.id === id);
  const saveSettings = async (patch: Record<string, unknown>) => {
    const ws = await workspace();
    return t.put("/api/v1/brain/plans/settings", { settings: { ...ws.settings, ...patch }, version: ws.settingsVersion });
  };
  const generate = (member: Client) => t.post("/api/v1/brain/plans/generate", { subscriberId: member.userId });
  const product = layla.products.workout.id;

  const ready = await r.step(T, "Trainer Brain plan settings", `${layla.slug}: automatic mode, the default 0.8 threshold, no spot checks; every library and template exercise tagged with its equipment`, async () => {
    await saveSettings({ mode: "automatic", threshold: 0.8, spotCheckRate: 0 });
    const overview = await t.get("/api/v1/training/overview");
    const names = new Set<string>(["Dumbbell bench press", "Romanian deadlift", "Plank", "Push-up", "Dumbbell row"]);
    for (const template of overview.records.filter((x: any) => x.kind === "program" && x.status === "template"))
      for (const e of template.data?.exercises ?? []) {
        names.add(e.name);
        for (const alt of e.alternatives ?? []) names.add(typeof alt === "string" ? alt : alt.name);
      }
    let tagged = 0,
      created = 0;
    const library = (await workspace()).library as Array<{ id: string; version: number; name: string; equipment: string[] | null }>;
    for (const e of library)
      if (!Array.isArray(e.equipment) || !e.equipment.length) {
        await t.post(`/api/v1/brain/plans/exercises/${e.id}/equipment`, { version: e.version, equipment: tagsFor(e.name) });
        tagged++;
      }
    const known = new Set(library.map((e) => e.name.trim().toLowerCase()));
    for (const name of names)
      if (!known.has(name.trim().toLowerCase())) {
        await t.post("/api/v1/training/exercises", { name, sets: 3, reps: 10, restSeconds: 90, loadKg: 0, rir: 2, cue: "Move with control", equipment: tagsFor(name) });
        created++;
      }
    const after = (await workspace()).library as any[];
    assert.ok(after.every((e) => Array.isArray(e.equipment) && e.equipment.length), "every library exercise is tagged");
    return `${tagged} tagged, ${created} added; library of ${after.length}`;
  });
  if (!ready) return undefined;

  const joined: Record<string, Client | undefined> = {};
  for (const [key, label, name, profile] of [
    ["approve", "plan-approve", "Hala Approve", STRENGTH],
    ["edit", "plan-edit", "Omar Edit", STRENGTH],
    ["runner", "plan-runner", "Rana Runner", RUNNER],
  ] as const)
    joined[key] = await r.prepare(F, "Choose a plan and pay (with discount codes)", `${label} joins ${layla.slug}`, () => joinAndPay(ctx, layla, label, name, profile, product));
  if (!joined.approve || !joined.edit || !joined.runner) return undefined;
  const items: Record<string, any> = {};
  await r.step(T, "Brain plan review queue", `${layla.slug}: before qualification every plan waits for the trainer, below the 0.8 threshold with its reasons`, async () => {
    for (const key of ["approve", "edit", "runner"]) {
      const result = await generate(joined[key]!);
      assert.equal(result.status, "pending_review", JSON.stringify(result));
      const item = await queueItem(result.generationId);
      assert.ok(item?.draft, "the draft is in the queue");
      assert.equal(item.route, "review");
      assert.ok(item.routeReasons.some((x: string) => /qualification has not passed/.test(x)), item.routeReasons.join(" | "));
      assert.ok(item.confidence.score < 0.8 && item.routeReasons.some((x: string) => /below your threshold 0\.80/.test(x)), `score ${item.confidence.score}: ${item.routeReasons.join(" | ")}`);
      assert.deepEqual(item.validation.errors, [], "the rule responder's plan passes the code validator");
      items[key] = item;
    }
    const mine = await joined.approve!.get("/api/v1/brain/plans/mine");
    assert.equal(mine.status.state, "in_review");
    assert.equal(mine.program, null);
    return Object.entries(items).map(([k, v]) => `${k} ${v.confidence.score}`).join(", ");
  });
  if (Object.keys(items).length < 3) return undefined;
  await r.step(T, "Approve, edit or reject a Brain plan", `${layla.slug}: one approved, one edited (diff kept), one rejected with a note; each becomes a learning example`, async () => {
    const approved = await t.post(`/api/v1/brain/plans/${items.approve.id}/review`, { action: "approve", version: items.approve.version });
    assert.equal(approved.decision, "approved");
    const { selfConfidence: _s, uncertainties: _u, evidenceIds: _e, ...plan } = items.edit.draft;
    plan.title = "Strength foundations (edited by Layla)";
    plan.sessions[0].exercises[0].cue = "Brace, then move with control";
    const edited = await t.post(`/api/v1/brain/plans/${items.edit.id}/review`, { action: "edit", version: items.edit.version, plan, note: "My usual cue" });
    assert.equal(edited.decision, "edited");
    const rejected = await t.post(`/api/v1/brain/plans/${items.runner.id}/review`, { action: "reject", version: items.runner.version, note: "Running plans need my own conditioning block" });
    assert.equal(rejected.status, "rejected");
    const recent = (await workspace()).recent;
    const editedRow = await t.get("/api/v1/brain/plans/workspace").then((ws) => ws.recent.find((x: any) => x.id === items.edit.id));
    assert.equal(editedRow?.decision, "edited", JSON.stringify(recent).slice(0, 300));
    const stats = (await workspace()).stats;
    const decisions = Object.fromEntries(stats.decisions.filter((d: any) => d.type === "programme").map((d: any) => [d.decision, d.n]));
    for (const d of ["approved", "edited", "rejected"]) assert.ok(decisions[d] >= 1, JSON.stringify(stats.decisions));
    return `learning examples: ${JSON.stringify(decisions)}`;
  });
  await r.step(F, "Brain-prepared programme", "approved and edited plans reach the members; a rejected plan stays with the trainer", async () => {
    const a = await joined.approve!.get("/api/v1/brain/plans/mine");
    assert.equal(a.status.state, "delivered");
    assert.ok(a.program && a.upcoming.length >= 1, JSON.stringify(a).slice(0, 300));
    assert.doesNotMatch(JSON.stringify(a), /selfConfidence|uncertainties|evidenceIds/, "no model internals reach the member");
    const e = await joined.edit!.get("/api/v1/brain/plans/mine");
    assert.equal(e.program.title, "Strength foundations (edited by Layla)");
    const x = await joined.runner!.get("/api/v1/brain/plans/mine");
    assert.equal(x.status.state, "with_trainer");
    assert.equal(x.program, null);
    return `${a.upcoming.length} upcoming sessions; ${a.program.weeks.length} weeks`;
  });

  // Learning: a similar reviewed segment raises confidence; the runner's does not.
  joined.later = await r.prepare(F, "Choose a plan and pay (with discount codes)", `plan-later joins ${layla.slug}`, () => joinAndPay(ctx, layla, "plan-later", "Lina Later", STRENGTH, product));
  if (!joined.later) return undefined;
  let threshold = 0;
  await r.step(T, "Brain learns from trainer decisions", `${layla.slug}: a new beginner-strength plan scores higher than the runner's, which has no similar approved plans`, async () => {
    const later = await generate(joined.later!);
    const runner = await generate(joined.runner!);
    items.later = await queueItem(later.generationId);
    items.runner2 = await queueItem(runner.generationId);
    const strong = items.later.confidence,
      weak = items.runner2.confidence;
    assert.ok(strong.signals.caseCoverage > 0, "similar reviewed plans count");
    assert.equal(weak.signals.caseCoverage, 0);
    assert.ok(strong.score - weak.score >= 0.02, `strength ${strong.score} vs runner ${weak.score}`);
    // The trainer's threshold between the two, as a trainer would set it from these numbers.
    threshold = Math.min(0.99, Math.max(0.5, Math.round(((strong.score + weak.score) / 2) * 100) / 100));
    assert.ok(weak.score < threshold && strong.score >= threshold);
    return `strength ${strong.score} (similar reviewed plans ${strong.signals.caseCoverage}), runner ${weak.score}; threshold ${threshold}`;
  });
  if (!threshold) return undefined;
  const qualified = await r.step(T, "Plan qualification (held-out plan scenarios)", `${layla.slug}: 4 deliverable and 3 review scenarios (two safety floor, one low confidence) pass on the full route`, async () => {
    await saveSettings({ threshold });
    const scenarios = [
      { title: "Beginner strength, four weeks", profile: STRENGTH, programmeDays: 28, expected: "deliverable" },
      { title: "Beginner strength, three weeks", profile: STRENGTH, programmeDays: 21, expected: "deliverable" },
      { title: "Beginner strength, two weeks", profile: STRENGTH, programmeDays: 14, expected: "deliverable" },
      { title: "Get stronger at home", profile: { ...STRENGTH, goal: "Get stronger" }, programmeDays: 28, expected: "deliverable" },
      { title: "Knee surgery", profile: LIMITED, programmeDays: 28, expected: "review" },
      { title: "Chest pain last week", profile: { ...STRENGTH, goal: "Train again after chest pain last week" }, programmeDays: 28, expected: "review" },
      { title: "Marathon runner", profile: RUNNER, programmeDays: 28, expected: "review" },
    ];
    for (const s of scenarios) await t.post("/api/v1/brain/plans/scenarios", s);
    const result = await t.post("/api/v1/brain/plans/qualify", {});
    assert.equal(result.status, "passed", JSON.stringify(result.data?.outcomes).slice(0, 1500));
    const outcomes = result.data.outcomes as any[];
    assert.equal(outcomes.filter((o) => o.gate === "code_safety").length, 2, "the safety floor stops two without a model call");
    const runner = outcomes.find((o) => o.expected === "review" && o.gate === "route");
    assert.equal(runner?.route, "review");
    assert.ok(runner.score < threshold);
    const ws = await workspace();
    assert.equal(ws.qualification.qualified, true);
    return outcomes.map((o) => `${o.expected}→${o.route}${o.score !== undefined ? " " + o.score : ""}`).join(", ");
  });
  if (!qualified) return undefined;
  await r.step(T, "Automatic plan delivery after qualification", `${layla.slug}: regenerating the waiting beginner-strength plan delivers it at once`, async () => {
    const regenerated = await t.post(`/api/v1/brain/plans/${items.later.id}/regenerate`, { version: items.later.version });
    assert.equal(regenerated.status, "delivered", JSON.stringify(regenerated));
    const row = (await workspace()).recent.find((x: any) => x.id === regenerated.generationId);
    assert.equal(row.route, "automatic");
    assert.equal(row.decision, "automatic");
    const mine = await joined.later!.get("/api/v1/brain/plans/mine");
    assert.equal(mine.status.state, "delivered");
    assert.ok(mine.upcoming.length >= 1);
    return `score ${row.score} ≥ ${threshold}`;
  });
  await r.step(T, "Low-confidence plans go to the trainer", `${layla.slug}: after qualification the runner's plan is still below the threshold and is rejected`, async () => {
    const again = await t.post(`/api/v1/brain/plans/${items.runner2.id}/regenerate`, { version: items.runner2.version });
    assert.equal(again.status, "pending_review", JSON.stringify(again));
    const item = await queueItem(again.generationId);
    assert.ok(item.routeReasons.some((x: string) => /below your threshold/.test(x)), item.routeReasons.join(" | "));
    assert.ok(!item.routeReasons.some((x: string) => /qualification has not passed/.test(x)), "qualified now");
    await t.post(`/api/v1/brain/plans/${item.id}/review`, { action: "reject", version: item.version, note: "Still not my speciality" });
    return item.routeReasons.join(" | ");
  });
  const limited = await r.prepare(F, "Choose a plan and pay (with discount codes)", `plan-limited joins ${layla.slug}`, () => joinAndPay(ctx, layla, "plan-limited", "Sami Limited", LIMITED, product));
  if (limited)
    await r.step(T, "Brain plan safety floor", `${layla.slug}: a reported knee surgery sends an otherwise deliverable plan to the trainer`, async () => {
      const result = await generate(limited);
      assert.equal(result.status, "pending_review", JSON.stringify(result));
      const item = await queueItem(result.generationId);
      assert.ok(item.safety.some((x: string) => /medical limitation/.test(x)), JSON.stringify(item.safety));
      assert.ok(item.routeReasons.some((x: string) => x.startsWith("Safety:")), item.routeReasons.join(" | "));
      const mine = await limited.get("/api/v1/brain/plans/mine");
      assert.equal(mine.status.state, "in_review");
      return item.routeReasons.join(" | ");
    });
  return { threshold, qualified: true };
}

// ------------------------------------------------------------------ programme

type ProgrammeMember = { client: Client; programId: string };

async function programme(ctx: E2EContext, layla: TrainerSeed, brain: BrainState | undefined): Promise<ProgrammeMember | undefined> {
  const r = ctx.reporter;
  const t = layla.client;
  let offer: any;
  await r.step(T, "Upfront programme offer", `${layla.slug}: a 28-day programme paid in full, with a voice add-on price, published to the Stripe double`, async () => {
    offer = await t.post("/api/v1/products", {
      name: "28-day strength programme",
      description: "Four weeks of Brain-prepared strength sessions, paid once (sandbox)",
      priceMinor: 79900,
      tier: "workout",
      billing: "upfront",
      programmeDays: 28,
      voiceAddOnMinor: 4900,
    });
    await t.fails(400, "POST", "/api/v1/products", { name: "No length", description: "Upfront needs a length", priceMinor: 50000, tier: "workout", billing: "upfront" });
    await t.post(`/api/v1/products/${offer.id}/activate`, {});
    const activated = (await t.get("/api/v1/bootstrap")).records.find((x: any) => x.id === offer.id);
    assert.equal(activated?.status, "published");
    const price = ctx.mocks.stripe.prices.get(activated.data?.stripePriceId ?? "");
    assert.ok(price, JSON.stringify(activated).slice(0, 300));
    assert.equal(price.recurring ?? null, null, "a one-time price for the whole programme");
    assert.equal(price.unit_amount, 79900);
    assert.ok(activated.data.voiceStripePriceId, "a monthly voice add-on price");
    offer = activated;
    return `price ${price.id}, voice add-on ${activated.data.voiceStripePriceId}`;
  });
  if (!offer?.data?.stripePriceId) return undefined;
  const client = await r.prepare(F, "Pay for a whole programme upfront", "plan-programme joins and pays upfront", () =>
    joinAndPay(ctx, layla, "plan-programme", "Maya Programme", STRENGTH, offer.id),
  );
  if (!client) return undefined;
  await r.step(F, "Pay for a whole programme upfront", `${client.label}: one payment in Checkout payment mode gives 28 days of access; Day 1 of 28 while the plan is prepared`, async () => {
    const payment = ctx.mocks.stripe.deliveries.filter((d) => d.type === "checkout.session.completed").at(-1);
    assert.equal(payment?.status, 200);
    const today = await client.get("/api/v1/programme/today?timezone=Asia/Dubai");
    assert.equal(today.programme?.billing, "upfront", JSON.stringify(today).slice(0, 400));
    assert.equal(today.programme.day, 1);
    assert.equal(today.programme.lengthDays, 28);
    assert.equal(today.planState, "awaiting_coach");
    return `Day ${today.programme.day} of ${today.programme.lengthDays}, plan ${today.planState}`;
  });
  let programId = "";
  if (!brain?.qualified) {
    r.blocked("the Brain did not qualify", [[F, "Plan delivered automatically by the worker", client.label]]);
    return undefined;
  }
  await r.step(F, "Plan delivered automatically by the worker", `${client.label}: the scheduler's intake job runs in the worker and the qualified Brain delivers a 28-day plan without the trainer`, async () => {
    const [intake] = await ctx.sqlRead<{ id: string }>("SELECT id FROM records WHERE kind='intake' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [client.userId]);
    await ctx.schedulerTick(`Brain plan intake job for ${client.label} (the scheduler's 10-minute pass is not awaited)`, {
      tenantId: layla.tenantId,
      kind: "brain_plan",
      intentKey: `brain-plan:${layla.tenantId}:${client.userId}:intake:${intake.id}`,
      data: { userId: client.userId, type: "programme", trigger: "intake", expectedProgramId: null },
    });
    const mine = await ctx.waitUntil("the worker's plan", async () => {
      const m = await client.get("/api/v1/brain/plans/mine");
      return m.status?.state === "delivered" && m.program && m;
    }, 120000);
    assert.equal(mine.program.programmeDays, 28, "the length comes from the upfront offer");
    assert.equal(mine.program.weeks.length, 4);
    const row = (await t.get("/api/v1/brain/plans/workspace")).recent.find((x: any) => x.subscriberName === "Maya Programme");
    assert.equal(row?.trigger, "intake");
    assert.equal(row?.decision, "automatic");
    const today = await client.get("/api/v1/programme/today?timezone=Asia/Dubai");
    assert.equal(today.planState, "ready");
    assert.equal(today.programme.lengthDays, 28);
    programId = mine.program.id;
    return `${mine.program.title}: ${mine.upcoming.length} sessions ahead; Today plan ${today.planState}, Day ${today.programme.day} of ${today.programme.lengthDays}`;
  });
  if (!programId) return undefined;
  const added = await r.step(F, "Add premium voice to the membership", `${client.label}: the voice add-on on the upfront programme, bought through a subscription checkout`, async () => {
    const before = await client.get("/api/v1/membership/voice-addon");
    assert.equal(before.available, true, JSON.stringify(before));
    assert.equal(before.priceMinor, 4900);
    const { url } = await client.post("/api/v1/membership/voice-addon", {});
    const paid = await ctx.mocks.stripe.completeCheckout(new URL(url).pathname.split("/").pop()!);
    for (const d of paid.deliveries ?? []) assert.equal(d.status, 200, `${d.type}: ${d.body}`);
    const after = await ctx.waitUntil("voice add-on active", async () => {
      const v = await client.get("/api/v1/membership/voice-addon");
      return v.active && v;
    }, 30000);
    return `voice add-on ${after.status} until ${after.periodEnd}`;
  });
  return added ? { client, programId } : undefined;
}

async function voiceAddOnRemoval(ctx: E2EContext, member: ProgrammeMember) {
  const c = member.client;
  await ctx.reporter.step(F, "Remove premium voice", `${c.label}: the add-on is set to end at the period end; voice stays until then`, async () => {
    await c.post("/api/v1/membership/voice-addon/cancel", {});
    const v = await ctx.waitUntil("add-on set to end", async () => {
      const s = await c.get("/api/v1/membership/voice-addon");
      return s.cancelAtPeriodEnd && s;
    }, 30000);
    assert.equal(v.active, true, "paid voice continues to the period end");
    return `ends ${v.periodEnd}`;
  });
}

// ------------------------------------------------------------------ weekly adaptation

async function weeklyAdaptation(ctx: E2EContext, layla: TrainerSeed, member: ProgrammeMember) {
  const r = ctx.reporter;
  const c = member.client;
  const t = layla.client;
  let before: any[] = [];
  const done = await r.step(F, "Log a Brain plan week", `${c.label}: completes every week-1 session with each prescribed set at the prescribed load and effort`, async () => {
    const mine = await c.get("/api/v1/brain/plans/mine");
    const week1 = mine.upcoming.filter((s: any) => s.week === 1);
    before = mine.upcoming.filter((s: any) => s.week === 2);
    assert.ok(week1.length >= 1 && before.length >= 1, JSON.stringify(mine.upcoming).slice(0, 300));
    let sets = 0;
    for (const session of week1) {
      const workout = await c.post("/api/v1/workouts/start", { programId: member.programId, plannedSessionId: session.id });
      for (const e of session.exercises)
        for (let set = 1; set <= e.sets; set++) {
          await c.post(`/api/v1/workouts/${workout.id}/sets`, { eventKey: randomUUID(), exercise: e.name, set, reps: e.reps, loadKg: e.loadKg, rir: e.rir });
          sets++;
        }
      await c.post(`/api/v1/workouts/${workout.id}/finish`, {});
    }
    return `${week1.length} sessions, ${sets} sets`;
  });
  if (!done) return;
  await r.step(T, "Weekly plan adaptation", `${layla.slug}: the worker proposes next week's changes from the logged week; the trainer approves and week 2 changes`, async () => {
    await ctx.schedulerTick(`Brain weekly adaptation job for ${c.label}, week 2 (queued near the end of week 1 by the scheduler; the member finished week 1 early)`, {
      tenantId: layla.tenantId,
      kind: "brain_plan",
      intentKey: `brain-adapt:${layla.tenantId}:${member.programId}:2`,
      data: { userId: c.userId, type: "adaptation", programId: member.programId, week: 2 },
    });
    const item = await ctx.waitUntil("the adaptation in the queue", async () => {
      const ws = await t.get("/api/v1/brain/plans/workspace");
      return ws.queue.find((q: any) => q.type === "adaptation" && q.subscriberId === c.userId);
    }, 120000);
    assert.equal(item.inputs.week, 2);
    assert.equal(item.inputs.outcomes.adherence, 1, JSON.stringify(item.inputs.outcomes).slice(0, 300));
    // Weekly adjustments are automatic only after passing adaptation scenarios; none were held out here.
    assert.equal(item.route, "review");
    assert.ok(item.routeReasons.length >= 1);
    const approved = await t.post(`/api/v1/brain/plans/${item.id}/review`, { action: "approve", version: item.version });
    assert.equal(approved.decision, "approved", JSON.stringify(approved));
    assert.ok(approved.applied >= 1, JSON.stringify(approved));
    const after = (await c.get("/api/v1/brain/plans/mine")).upcoming.filter((s: any) => s.week === 2);
    const load = (sessions: any[]) => sessions.flatMap((s) => s.exercises.map((e: any) => `${s.id}:${e.name}:${e.loadKg}`)).sort().join("|");
    assert.notEqual(load(after), load(before), "week 2 changed");
    const raised = after.flatMap((s: any) => s.exercises).filter((e: any) => e.loadKg > 0);
    return `${approved.applied} sessions updated; ${item.routeReasons.join(" | ")}; week-2 loads ${raised.map((e: any) => e.loadKg).join(",")}`;
  });
}

// ------------------------------------------------------------------ voice-led session

async function voiceSession(ctx: E2EContext, layla: TrainerSeed, member: ProgrammeMember) {
  const r = ctx.reporter;
  const c = member.client;
  const t = layla.client;
  await r.step(T, "Brain wording suggestions for the voice coach", `${layla.slug}: the Brain suggests phrasing from the trainer's own phrases; nothing is spoken until the trainer saves it`, async () => {
    const before = ctx.mocks.model.calls.length;
    const made = await t.post("/api/v1/voice-sessions/style/suggestions", {});
    assert.ok(made.suggestions && Object.values(made.suggestions).some((v: any) => Array.isArray(v) && v.length), JSON.stringify(made).slice(0, 300));
    assert.ok(ctx.mocks.model.calls.slice(before).some((m) => m.kind === "voice_session_phrasing"), "the phrasing prompt reached the model double");
    return Object.keys(made.suggestions).join(", ");
  });
  let session: any, planned: any;
  const prepared = await r.step(F, "Voice-led session prepared ahead", `${c.label}: a script built from the week-2 plan, with the trainer's voice made ahead by the worker`, async () => {
    const mine = await c.get("/api/v1/brain/plans/mine");
    planned = mine.upcoming.find((s: any) => s.week === 2 && s.status === "planned");
    assert.ok(planned, "a planned week-2 session");
    session = await c.post("/api/v1/voice-sessions", { plannedSessionId: planned.id, playbackConsent: true });
    assert.equal(session.mode, "voice", JSON.stringify(session.unavailableReason));
    const first = planned.exercises[0];
    const setLine = session.script.exercises[0].setLines[0].text as string;
    assert.match(setLine, new RegExp(`${first.reps} reps`), setLine);
    const ready = await ctx.waitUntil("the session audio", async () => {
      const v = await c.get(`/api/v1/voice-sessions/${session.id}`);
      return v.audioStatus === "ready" && v;
    }, 240000);
    const audio = await c.get(`/api/v1/voice-sessions/${session.id}/audio?keys=${encodeURIComponent(ready.audio.readyKeys.slice(0, 3).join(","))}`);
    assert.ok(audio.clips.length >= 1 && audio.type === "audio/mpeg");
    return `${ready.audio.total} session clips + ${ready.audio.sharedReady} shared; "${setLine}"`;
  });
  if (!prepared) return;
  const running = await r.step(F, "Voice commands through speech-to-text", `${c.label}: spoken replies are transcribed by the double and parsed into commands`, async () => {
    const workout = await c.post("/api/v1/workouts/start", { programId: member.programId, plannedSessionId: planned.id });
    const bound = await c.get(`/api/v1/voice-sessions/workout/${workout.id}`);
    assert.equal(bound.session?.id, session.id, "the session prepared ahead is bound to the workout");
    await c.post(`/api/v1/voice-sessions/${session.id}/events`, { status: "running", outcomes: [] });
    await c.fails(409, "POST", `/api/v1/voice-sessions/${session.id}/transcribe`, { audio: wav("done"), type: "audio/wav", durationMs: 1200 }, "TRANSCRIPTION_CONSENT");
    await c.post("/api/v1/voice-sessions/consent", { transcription: true });
    const heard = await c.post(`/api/v1/voice-sessions/${session.id}/transcribe`, { audio: wav("eight reps"), type: "audio/wav", durationMs: 1500 });
    assert.equal(heard.transcript, "eight reps");
    assert.deepEqual(heard.command, { type: "reps", reps: 8 });
    const first = planned.exercises[0];
    await c.post(`/api/v1/workouts/${workout.id}/sets`, { eventKey: randomUUID(), exercise: first.name, set: 1, reps: 8, loadKg: first.loadKg, rir: first.rir });
    const done = await c.post(`/api/v1/voice-sessions/${session.id}/transcribe`, { audio: wav("done"), type: "audio/wav", durationMs: 1000 });
    assert.equal(done.command.type, "done");
    const typed = await c.post(`/api/v1/voice-sessions/${session.id}/utterance`, { transcript: "pause" });
    assert.equal(typed.command.type, "pause");
    const sent = ctx.mocks.voice.transcriptions.slice(-2);
    assert.ok(sent.every((x) => x.model === "scribe_v1" && x.zeroRetention), JSON.stringify(sent));
    return `${ctx.mocks.voice.transcriptions.length} transcriptions at the double; eight reps → reps 8, done → done`;
  });
  if (!running) return;
  await r.step(F, "Pain stops the voice session", `${c.label}: a spoken pain report stops the session and opens a training hold`, async () => {
    const pain = await c.post(`/api/v1/voice-sessions/${session.id}/transcribe`, { audio: wav("I have sharp pain in my knee"), type: "audio/wav", durationMs: 2000 });
    assert.equal(pain.command.type, "pain");
    assert.equal(pain.trainingHeld, true);
    const view = await c.get(`/api/v1/voice-sessions/${session.id}`);
    assert.equal(view.status, "stopped");
    await c.fails(409, "POST", `/api/v1/voice-sessions/${session.id}/transcribe`, { audio: wav("done"), type: "audio/wav", durationMs: 1000 });
    const other = (await c.get("/api/v1/brain/plans/mine")).upcoming.find((s: any) => s.id !== planned.id && s.status === "planned");
    if (other) await c.fails(409, "POST", "/api/v1/voice-sessions", { plannedSessionId: other.id });
    const holds = (await c.get("/api/v1/bootstrap")).records.filter((x: any) => x.kind === "training_hold" && x.status === "active");
    assert.equal(holds.length, 1, "one active training hold for the trainer to review");
    return "session stopped; training held until the trainer reviews it";
  });
}
