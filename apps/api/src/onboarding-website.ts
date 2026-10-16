import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor, Database, Tx } from "@trainer/db";
import { OFFERED_DIRECTORY_SPECIALTIES, productSchema } from "@trainer/contracts";
import type { ChatData } from "../../../packages/domain/src/onboarding-chat.ts";
import { WEBSITE_FACT_FIELDS, websiteMissingFacts, websiteOffer, websitePhotosSchema, type WebsitePhotos, type WebsitePreparation } from "../../../packages/domain/src/website-interview.ts";
import type { SiteStarterInput } from "../../../packages/providers/src/site-builder-starter.ts";
import { forwardWorkspaceRequest as forward } from "./internal-request.ts";
import { privacyMatches } from "./ingestion.ts";

const fail = (statusCode: number, code: string, message: string) => Object.assign(new Error(message), { statusCode, code });
const clean = (value: unknown, max: number) => {
  let text = typeof value === "string" ? value.trim().slice(0, max) : "";
  for (const match of privacyMatches(text).sort((a, b) => b.start - a.start)) text = text.slice(0, match.start) + text.slice(match.end);
  return text;
};
export async function checkWebsitePhotos(tx: Tx, actor: Actor, selection: WebsitePhotos) {
  const chosen = websitePhotosSchema.parse(selection);
  if (!chosen.photos.length) return chosen;
  if (chosen.photos.some(p => privacyMatches(p.alt).length)) throw fail(400, "WEBSITE_PHOTO_DESCRIPTION", "Describe what is in each photo without private contact or account details.");
  const rows = await tx.query("SELECT id FROM brand_media WHERE tenant_id=$1 AND id=ANY($2::uuid[])", [actor.tenantId, chosen.photos.map(p => p.mediaId)]);
  const ids = new Set(rows.map(r => r.id));
  if (chosen.photos.some(p => !ids.has(p.mediaId))) throw fail(409, "WEBSITE_PHOTO_CHANGED", "One of your website photos is unavailable. Choose it again from your photo library.");
  return chosen;
}

/** Select explicit public facts and chosen brand media, never private messages or attachment contents. */
export async function starterPublicContext(tx: Tx, actor: Actor, tenant: any): Promise<Pick<SiteStarterInput, "identity" | "content">> {
  const [chat] = await tx.query("SELECT data FROM records WHERE kind='onboarding_chat' AND owner_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [actor.userId]);
  const [brand] = await tx.query("SELECT data FROM coach_design_drafts WHERE tenant_id=$1", [actor.tenantId]);
  const f = chat?.data?.facts ?? {}, draft = brand?.data ?? {}, theme = tenant.theme ?? {};
  const category = OFFERED_DIRECTORY_SPECIALTIES.find(s => s.id === f.specialty)?.label;
  const identity = {
    name: clean(f.publicName || draft.name || tenant.name, 120),
    headline: clean(f.headline || draft.headline || theme.headline, 160),
    bio: clean(f.bio || draft.bio || theme.bio, 1500),
    category: clean(category || draft.category || theme.category, 120),
  };
  const selected = websitePhotosSchema.safeParse(chat?.data?.website?.photos);
  const photos = selected.success ? (await checkWebsitePhotos(tx, actor, selected.data)).photos : [];
  const offers = await tx.query("SELECT id,data FROM records WHERE kind='product' AND status<>'archived' ORDER BY created_at DESC,id DESC LIMIT 24");
  return { identity, content: {
    audience: clean(f.audience, 500), city: clean(f.city, 100), trainingServices: clean(f.trainingServices, 900),
    deliveryMode: ["online", "in_person", "hybrid"].includes(f.deliveryMode) ? f.deliveryMode : "",
    ...(["editorial", "strength", "minimal", "warm", "performance"].includes(f.websiteStyle) ? { style: f.websiteStyle } : {}),
    motion: ["cinematic", "subtle", "still"].includes(f.websiteMotion) ? f.websiteMotion : "cinematic",
    photos,
    offers: offers.map(o => ({ id: o.id, name: clean(o.data.name, 100), description: clean(o.data.description, 1500), tier: o.data.tier ?? "workout", premiumVoice: o.data.premiumVoice === true })),
  } };
}

export async function saveCoachWebsiteProfile(app: FastifyInstance, req: FastifyRequest, db: Database, a: Actor, f: Record<string, any>) {
  const setup = await forward(app, req, "GET", "/api/v1/setup");
  const city = String(f.city).toLowerCase().replace(/[^a-z]+/g, " ");
  const emirate = setup.about.emirates.find((v: string) => city.includes(v.replaceAll("_", " "))) ?? (city.includes("al ain") ? "abu_dhabi" : undefined);
  const category = OFFERED_DIRECTORY_SPECIALTIES.find(s => s.id === f.specialty)?.label ?? "";
  await forward(app, req, "PUT", "/api/v1/setup/about", { version: setup.about.version, values: { ...Object.fromEntries(Object.entries(setup.about.values).filter(([, v]) => v != null)), name: f.publicName, specialty: f.specialty, audience: f.audience, ...(emirate ? { emirate } : {}) } });
  const [identity] = await db.tenant(a, tx => tx.query("SELECT version,data FROM records WHERE kind='onboarding_step' AND data->>'step'='identity'"));
  await forward(app, req, "PUT", "/api/v1/onboarding/identity", { version: identity?.version ?? 0, values: { ...(identity?.data.values ?? {}), publicName: f.publicName, businessName: f.businessName ?? f.publicName, city: f.city, audience: f.audience, category, country: "AE" }, defer: false });
  const draft = await forward(app, req, "GET", "/api/v1/tenant/design-draft");
  const [tenant] = await db.tenant(a, tx => tx.query("SELECT trainer_brand_tenant() AS tenant"));
  const theme = tenant?.tenant?.theme ?? {};
  const base = draft?.data ?? { name: f.publicName, bio: theme.bio ?? "", category: theme.category ?? "", accent: theme.accent ?? "#0F766E", headline: theme.headline ?? "", ...(theme.design ? { design: theme.design } : {}) };
  const { expectedVersion: _drop, ...rest } = base;
  await forward(app, req, "PUT", "/api/v1/tenant/design-draft", { version: draft?.version ?? 0, data: { ...rest, name: f.publicName, headline: f.headline, bio: f.bio, category } });
}

/** Use the ordinary product endpoint: its floor, comparable-offer and activation rules remain authoritative. */
export async function saveWebsiteOffer(app: FastifyInstance, req: FastifyRequest, db: Database, actor: Actor, facts: Record<string, any>) {
  const desired = websiteOffer(facts);
  const rows = await db.tenant(actor, tx => tx.query("SELECT id,data FROM records WHERE kind='product' AND status<>'archived' ORDER BY created_at,id"));
  async function ensure(value: Record<string, any>) {
    const checked = productSchema.parse(value);
    const old = rows.find(r => Object.entries(checked).every(([key, v]) => (r.data[key] ?? (key === "tier" ? "workout" : key === "premiumVoice" ? false : null)) === v));
    if (old) return old;
    const created = await forward(app, req, "POST", "/api/v1/products", checked); rows.push(created); return created;
  }
  if (desired.tier === "workout_nutrition") {
    const base = await ensure({ ...desired, name: `${facts.name} — Training`.slice(0, 100), description: facts.trainingServices ?? "", priceMinor: Math.round(Number(facts.baseTrainingPriceAed) * 100), tier: "workout", premiumVoice: false });
    return ensure({ ...desired, baseProductId: base.id });
  }
  return ensure(desired);
}

export async function prepareOnboardingWebsite(app: FastifyInstance, req: FastifyRequest, db: Database, actor: Actor, data: ChatData): Promise<NonNullable<WebsitePreparation["result"]>> {
  if (websiteMissingFacts(data.facts).length || !data.website?.offersComplete || !data.website.photos) throw fail(409, "WEBSITE_INCOMPLETE", "Finish the website details, confirm your packages and choose how you want to use photos first.");
  await db.tenant(actor, tx => checkWebsitePhotos(tx, actor, data.website!.photos!));
  const before = await forward(app, req, "GET", "/api/v1/tenant/site");
  // Only the first draft is automatic. A trainer's prior edits always win.
  if (before.version > 0 || before.published) return { status: "existing", siteVersion: before.version, message: "Your existing website is kept. Review it, or use AI starter in the editor to deliberately prepare a replacement with your new details." };
  await saveCoachWebsiteProfile(app, req, db, actor, data.facts);
  for (const offer of [...(data.website.offers ?? []), data.facts]) {
    const facts = { ...data.facts, ...offer };
    if (websiteMissingFacts(facts).length) throw fail(409, "WEBSITE_OFFER_INCOMPLETE", "Review the details and prices of your website packages.");
    await saveWebsiteOffer(app, req, db, actor, facts);
  }
  const language = /[\u0600-\u06ff]/.test(String(data.facts.bio)) ? "ar" : "en";
  // A stable public-input intent also survives a crash of the outer chat action.
  // An unknown provider outcome is never repurchased by a reload or new action ID.
  const hash = createHash("sha256").update(JSON.stringify({ tenant: actor.tenantId, owner: actor.userId, facts: Object.fromEntries(WEBSITE_FACT_FIELDS.map(k => [k, data.facts[k]])), offers: data.website.offers, photos: data.website.photos, version: before.version })).digest("hex");
  const requestId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const prepared = await forward(app, req, "POST", "/api/v1/tenant/site/starter", { requestId, brief: "Prepare my complete website from my confirmed public onboarding details, chosen photos and actual offers. Use suitable photo scroll modules and native contact actions.", useOnboarding: true, language, version: before.version, ...(data.facts.websiteStyle ? { templateId: data.facts.websiteStyle } : {}) });
  const saved = await forward(app, req, "PUT", "/api/v1/tenant/site", { version: before.version, site: { ...before.draft, language, builder: prepared.builder } });
  return { status: "ready", siteVersion: saved.version, source: prepared.source, ...(prepared.message ? { message: prepared.message } : {}) };
}
