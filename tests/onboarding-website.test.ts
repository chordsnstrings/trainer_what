import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { accountsContext, withEnv, type Person } from "./accounts-fixtures.ts";
import { OFFERED_DIRECTORY_SPECIALTIES, siteBuilderSchema } from "@trainer/contracts";
import { emptyChat, mergeChatFacts, nextChatQuestion } from "../packages/domain/src/onboarding-chat.ts";
import { websiteMissingFacts, websiteOffer, websitePhotosSchema } from "../packages/domain/src/website-interview.ts";
import { materializeSiteStarter, starterTemplate, SITE_STARTER_LIMITS, type SiteStarterInput } from "../packages/providers/src/site-builder-starter.ts";

const facts = {
  publicName: "Alex Rivers", city: "Dubai", specialty: "strength", audience: "busy beginners",
  trainingServices: "Strength sessions; kettlebell technique; mobility practice", deliveryMode: "hybrid",
  headline: "Build strength around your life", bio: "I coach busy beginners with practical strength sessions and steady progress.",
  name: "Everyday Strength", description: "Personal strength training with weekly check-ins", offerIncludes: "training",
  billing: "monthly", priceAed: 399, websiteStyle: "minimal", websiteMotion: "cinematic",
};
const specialties = OFFERED_DIRECTORY_SPECIALTIES.map(({ id, label }) => ({ id, label }));
const evidence = Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, String(value)]));
const message = Object.values(facts).join(". ");
const plan = { templateId: "minimal", pages: [
  { title: "Home", slug: "", sections: [{ moduleId: "hero", variant: "centered" }, { moduleId: "services", variant: "grid" }] },
  { title: "Coaching", slug: "coaching", sections: [{ moduleId: "programmes", variant: "cards" }, { moduleId: "contact", variant: "centered" }] },
] };
const noPhotos = { choice: "later", photos: [], rightsConfirmed: false };
const input: SiteStarterInput = { brief: "Build my coaching website", language: "en", identity: { name: facts.publicName, headline: facts.headline, bio: facts.bio, category: "Strength training" }, content: { audience: facts.audience, city: facts.city, trainingServices: facts.trainingServices, deliveryMode: facts.deliveryMode, motion: "cinematic", photos: [{ mediaId: randomUUID(), alt: "Alex coaching a squat", role: "portrait" }], offers: [{ id: randomUUID(), name: facts.name, description: facts.description, tier: "workout", premiumVoice: false }] } };

let ctx: Awaited<ReturnType<typeof accountsContext>>;
before(async () => { ctx = await accountsContext(); });
after(async () => { await ctx.close(); });
async function ok(person: Person, path: string, body?: any, method?: string) {
  const r = await ctx.call(path, { cookie: person.cookie, body, method });
  assert.equal(r.statusCode, 200, r.body); return r.json();
}
const snap = (person: Person) => ok(person, "/onboarding-chat?mode=website");
async function act(person: Person, state: any, action: string, extra: any = {}) {
  return ok(person, "/onboarding-chat/actions", { id: randomUUID(), version: state.version, action, ...extra });
}
async function model<T>(run: (sent: any[]) => Promise<T>, reply?: (input: any) => any | Promise<any>) {
  const original = globalThis.fetch, sent: any[] = [];
  return withEnv({ MODEL_BASE_URL: "https://onboarding-website.invalid/v1", MODEL_API_KEY: "synthetic", MODEL_NAME: "seed-2-0-pro-260328", MODEL_MAX_DAILY_CALLS: "1000" }, async () => {
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith("https://onboarding-website.invalid")) return original(url, init);
      const request = JSON.parse(String(init?.body)), value = JSON.parse(request.messages[1].content); sent.push(value);
      const answer = reply ? await reply(value) : value.websiteContent ? plan : { reply: "Your coaching details are recorded.", patch: facts, evidence };
      return Response.json({ usage: { prompt_tokens: 12, completion_tokens: 8 }, choices: [{ message: { content: JSON.stringify(answer) } }] });
    };
    try { return await run(sent); } finally { globalThis.fetch = original; }
  });
}
async function answer(person: Person) {
  const s = await snap(person);
  const result = await ok(person, "/onboarding-chat/messages", { id: randomUUID(), version: s.version, mode: "website", text: message });
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.deepEqual(websiteMissingFacts(result.facts), []);
  return act(person, result, "website-offers", { offerChoice: "complete" });
}
async function photo(person: Person) {
  const data = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#447766" } }).png().toBuffer();
  return ok(person, "/tenant/media", { filename: "synthetic-training.png", rightsConfirmed: true, data: data.toString("base64") });
}

test("website interview captures grounded services and prices, then asks for explicit photos without the Brain curriculum", () => {
  let c = emptyChat("coach", "website");
  c = mergeChatFacts(c, { reply: "Saved", patch: facts, evidence }, message, "one", new Date().toISOString(), specialties);
  assert.deepEqual(websiteMissingFacts(c.facts), []);
  assert.equal(nextChatQuestion(c, specialties).field, "website.offers");
  assert.equal(c.facts.trainingServices, facts.trainingServices);
  const invented = mergeChatFacts(emptyChat("coach", "website"), { reply: "Saved", patch: { priceAed: 999 }, evidence: { priceAed: "399" } }, "399", "two", new Date().toISOString(), specialties);
  assert.equal(invented.facts.priceAed, undefined);
  assert.equal(nextChatQuestion(emptyChat("coach", "teach"), specialties).field.startsWith("coaching."), true);
});
test("website pricing applies the actual package and duration floors without choosing prices", () => {
  assert.ok(websiteMissingFacts({ ...facts, priceAed: 198 }).includes("priceAed"));
  assert.ok(websiteMissingFacts({ ...facts, offerIncludes: "training_nutrition_voice", priceAed: 399 }).includes("baseTrainingPriceAed"));
  const combined = { ...facts, offerIncludes: "training_nutrition_voice", priceAed: 499, baseTrainingPriceAed: 299 };
  assert.deepEqual(websiteMissingFacts(combined), []);
  assert.deepEqual(websiteOffer(combined), { name: facts.name, description: facts.description, priceMinor: 49900, billing: "monthly", programmeDays: null, tier: "workout_nutrition", premiumVoice: true });
  assert.ok(websiteMissingFacts({ ...combined, baseTrainingPriceAed: 499 }).includes("baseTrainingPriceAed"));
  assert.ok(websiteMissingFacts({ ...facts, billing: "upfront" }).includes("programmeDays"));
  assert.ok(websiteMissingFacts({ ...facts, billing: "upfront", programmeDays: 90, priceAed: 399 }).includes("priceAed"));
});
test("composition fills approved copy, photos and live offer bindings, with bounded essentials and no invented proof", () => {
  const builder = materializeSiteStarter({ templateId: "minimal", pages: [
    { title: "Home", slug: "", sections: Array.from({ length: 10 }, () => ({ moduleId: "intro", variant: "centered" })) },
    { title: "More", slug: "more", sections: Array.from({ length: 10 }, () => ({ moduleId: "text", variant: "article" })) },
    { title: "About", slug: "about", sections: Array.from({ length: 4 }, () => ({ moduleId: "testimonials", variant: "cards" })) },
  ] }, input);
  assert.equal(siteBuilderSchema.safeParse(builder).success, true);
  const sections = builder.pages.flatMap(p => p.sections);
  assert.ok(sections.length <= SITE_STARTER_LIMITS.sections);
  assert.ok(builder.pages.every(p => p.sections.length > 0 && p.sections.length <= SITE_STARTER_LIMITS.sectionsPerPage));
  for (const family of ["hero", "scroll-image", "programmes", "faq", "contact"]) assert.ok(sections.some(s => s.moduleId === family), family);
  assert.equal(sections.some(s => s.moduleId === "testimonials"), false);
  assert.ok(sections.filter(s => s.moduleId === "programmes").every(s => s.content.productIds[0] === input.content!.offers[0].id));
  assert.ok(JSON.stringify(builder).includes(`/api/v1/media/${input.content!.photos[0].mediaId}`));
  const still = starterTemplate({ ...input, content: { ...input.content!, photos: [], motion: "still" } });
  assert.equal(still.pages.flatMap(p => p.sections).some(s => s.moduleId.startsWith("scroll-")), false);
  const arabic = starterTemplate({ ...input, language: "ar" });
  assert.ok(arabic.pages.flatMap(p => p.sections).some(s => /خيارات التدريب/.test(s.content.title)));
});
test("photo selection requires explicit rights, real IDs and descriptions", () => {
  const selection = { choice: "photos", photos: input.content!.photos, rightsConfirmed: true };
  assert.equal(websitePhotosSchema.safeParse(selection).success, true);
  assert.equal(websitePhotosSchema.safeParse({ ...selection, rightsConfirmed: false }).success, false);
  assert.equal(websitePhotosSchema.safeParse({ ...selection, photos: [...selection.photos, ...selection.photos] }).success, false);
  assert.equal(websitePhotosSchema.safeParse({ ...selection, choice: "later" }).success, false);
});
test("full onboarding creates one private website and exact draft offer; replay preserves them and excludes private material", async () => {
  const owner = await ctx.person({ role: "owner" });
  await model(async sent => {
    let state = await answer(owner);
    assert.equal(state.lastQuestion.field, "website.photos");
    const media = await photo(owner);
    // Private chat facts and messages are intentionally not part of website input.
    await ctx.db.tenant({ ...owner, role: "owner" }, tx => tx.query("UPDATE records SET data=jsonb_set(data,'{facts,neverDo}', $2::jsonb) WHERE id=$1", [state.id, JSON.stringify("private-client-history-secret")]));
    state = await act(owner, state, "website-photos", { websitePhotos: { choice: "photos", photos: [{ mediaId: media.id, alt: "Alex coaching a squat", role: "training" }], rightsConfirmed: true } });
    assert.equal(state.error, undefined); assert.equal(state.mode, "website");
    const body = { id: randomUUID(), version: state.version, action: "website" };
    state = await ok(owner, "/onboarding-chat/actions", body);
    assert.equal(state.error, undefined, JSON.stringify(state));
    assert.equal(state.website.result.status, "ready"); assert.equal(state.website.result.source, "ai"); assert.equal(state.profileDirty, false);
    assert.equal(state.lastQuestion.field, "website.review");
    const site = await ok(owner, "/tenant/site"), preview = await ok(owner, "/tenant/site/preview");
    assert.equal(site.version, 1); assert.equal(site.published, null);
    assert.equal(preview.tenant.name, facts.publicName); assert.equal(preview.products.length, 1);
    assert.equal(preview.products[0].data.priceMinor, 39900); assert.equal(preview.products[0].status, "draft");
    assert.ok(JSON.stringify(site.draft.builder).includes(media.id));
    assert.equal(sent.length, 2); assert.ok(sent[1].websiteContent);
    for (const secret of ["private-client-history-secret", owner.userId, owner.tenantId, media.id, "priceMinor"]) assert.equal(JSON.stringify(sent[1]).includes(secret), false, secret);
    assert.equal(sent[0].coachingInterview, undefined);
    await ok(owner, "/onboarding-chat/actions", body);
    const again = await act(owner, state, "website"); assert.equal(again.website.result.status, "existing");
    assert.equal(sent.length, 2); assert.equal((await ok(owner, "/tenant/site")).version, 1);
    assert.equal((await ok(owner, "/tenant/site/preview")).products.length, 1);
  });
});
test("foreign photos and private contact details are rejected; members cannot prepare trainer websites", async () => {
  const owner = await ctx.person({ role: "owner" }), other = await ctx.person({ role: "owner" });
  const member = await ctx.person({ role: "subscriber", tenantId: owner.tenantId });
  const foreign = await photo(other);
  let state = await snap(owner);
  state = await act(owner, state, "website-photos", { websitePhotos: { choice: "photos", photos: [{ mediaId: foreign.id, alt: "A training session", role: "training" }], rightsConfirmed: true } });
  assert.match(state.error, /unavailable/); assert.equal(state.website?.photos, undefined);
  const media = await photo(owner);
  state = await act(owner, state, "website-photos", { websitePhotos: { choice: "photos", photos: [{ mediaId: media.id, alt: "Email private@example.test", role: "training" }], rightsConfirmed: true } });
  assert.match(state.error, /private contact/);
  const denied = await ctx.call("/onboarding-chat/actions", { cookie: member.cookie, body: { id: randomUUID(), version: 0, action: "website" } });
  assert.equal(denied.statusCode, 403);
});
test("missing price cannot prepare; provider failure gives a complete photo-free draft without repeated model purchase", async () => {
  const owner = await ctx.person({ role: "owner" });
  const incomplete = await act(owner, await snap(owner), "website"); assert.match(incomplete.error, /Finish the website details/);
  await model(async sent => {
    let state = await answer(owner); state = await act(owner, state, "website-photos", { websitePhotos: noPhotos });
    state = await act(owner, state, "website");
    assert.equal(state.error, undefined, JSON.stringify(state)); assert.equal(state.website.result.source, "template");
    const site = await ok(owner, "/tenant/site");
    assert.equal(site.published, null); assert.ok(site.draft.builder.pages.length > 0);
    assert.equal(site.draft.builder.pages.flatMap((p: any) => p.sections).some((s: any) => s.moduleId.startsWith("scroll-")), false);
    assert.equal(sent.length, 2); await act(owner, state, "website"); assert.equal(sent.length, 2);
  }, context => context.websiteContent ? { bad: "unreadable fixture response" } : { reply: "Saved", patch: facts, evidence });
});
test("nutrition and voice keep exact prices and create a valid comparable training offer once", async () => {
  const owner = await ctx.person({ role: "owner" });
  await model(async () => {
    let state = await answer(owner);
    const combined = { ...facts, offerIncludes: "training_nutrition_voice", priceAed: 499, baseTrainingPriceAed: 299 };
    await ctx.db.tenant({ ...owner, role: "owner" }, tx => tx.query("UPDATE records SET data=jsonb_set(data,'{facts}',$2::jsonb) WHERE id=$1", [state.id, JSON.stringify(combined)]));
    state = await act(owner, state, "website-photos", { websitePhotos: noPhotos });
    state = await act(owner, state, "website"); assert.equal(state.error, undefined, JSON.stringify(state));
    const { products } = await ok(owner, "/tenant/site/preview"); assert.equal(products.length, 2);
    const base = products.find((p: any) => p.data.tier === "workout"), bundle = products.find((p: any) => p.data.tier === "workout_nutrition");
    assert.equal(base.data.priceMinor, 29900); assert.equal(bundle.data.priceMinor, 49900); assert.equal(bundle.data.premiumVoice, true); assert.equal(bundle.data.baseProductId, base.id);
    assert.ok(products.every((p: any) => p.status === "draft"));
  });
});
test("concurrent editor changes win over an in-flight automatic draft", async () => {
  const owner = await ctx.person({ role: "owner" });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(r => { entered = r; }), held = new Promise<void>(r => { release = r; });
  await model(async sent => {
    let state = await answer(owner); state = await act(owner, state, "website-photos", { websitePhotos: noPhotos });
    const pending = act(owner, state, "website");
    await started;
    try {
      await ok(owner, "/tenant/site", { version: 0, site: { introduction: "My deliberate editor change" } }, "PUT");
    } finally { release(); }
    state = await pending; assert.ok(state.error);
    assert.equal((await ok(owner, "/tenant/site")).draft.introduction, "My deliberate editor change");
    state = await act(owner, state, "website"); assert.equal(state.website.result.status, "existing"); assert.equal(sent.length, 2);
  }, async context => {
    if (!context.websiteContent) return { reply: "Saved", patch: facts, evidence };
    entered(); await held; return plan;
  });
});
test("separate packages retain separate prices and billing, and switching modes preserves both", async () => {
  const owner = await ctx.person({ role: "owner" });
  const second = { name: "Mobility programme", description: "Personal mobility practice and weekly check-ins", offerIncludes: "training", billing: "upfront", programmeDays: 30, priceAed: 249 };
  await model(async () => {
    let state = await answer(owner);
    state = await act(owner, state, "website-offers", { offerChoice: "another" });
    assert.equal(state.website.offers.length, 1); assert.equal(state.facts.name, undefined); assert.equal(state.lastQuestion.field, "name");
    const text = Object.values(second).join(". ");
    state = await ok(owner, "/onboarding-chat/messages", { id: randomUUID(), version: state.version, mode: "website", text });
    assert.equal(state.error, undefined); assert.equal(state.lastQuestion.field, "website.offers");
    state = await act(owner, state, "website-offers", { offerChoice: "complete" });
    await ok(owner, "/onboarding-chat?mode=teach"); state = await snap(owner);
    assert.equal(state.website.offers.length, 1); assert.equal(state.lastQuestion.field, "website.photos");
    state = await act(owner, state, "website-photos", { websitePhotos: noPhotos });
    state = await act(owner, state, "website"); assert.equal(state.error, undefined, JSON.stringify(state));
    const { products } = await ok(owner, "/tenant/site/preview"); assert.equal(products.length, 2);
    assert.equal(products.find((p: any) => p.data.name === facts.name).data.priceMinor, 39900);
    const next = products.find((p: any) => p.data.name === second.name);
    assert.equal(next.data.priceMinor, 24900); assert.equal(next.data.billing, "upfront"); assert.equal(next.data.programmeDays, 30);
  }, context => context.websiteContent ? plan : context.conversation.at(-1).text.includes(second.name) ? { reply: "The next package is recorded.", patch: second, evidence: Object.fromEntries(Object.entries(second).map(([key, value]) => [key, String(value)])) } : { reply: "Saved", patch: facts, evidence });
});
