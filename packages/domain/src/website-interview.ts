import { z } from "zod";
import { minimumOfferPrice } from "../../contracts/src/membership-pricing.ts";

export const websitePhotoSchema = z.object({
  mediaId: z.string().uuid(),
  alt: z.string().trim().min(3).max(240),
  role: z.enum(["portrait", "cover", "training"]),
}).strict();
export const websitePhotosSchema = z.object({
  choice: z.enum(["photos", "text_only", "later"]),
  photos: z.array(websitePhotoSchema).max(8),
  rightsConfirmed: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.choice === "photos" && (!value.photos.length || !value.rightsConfirmed))
    ctx.addIssue({ code: "custom", message: "Choose your photos and confirm permission to use them on your public website." });
  if (value.choice !== "photos" && value.photos.length)
    ctx.addIssue({ code: "custom", message: "Remove photos when choosing a text-only draft." });
  if (new Set(value.photos.map(p => p.mediaId)).size !== value.photos.length)
    ctx.addIssue({ code: "custom", message: "Choose each photo once." });
});
export type WebsitePhotos = z.infer<typeof websitePhotosSchema>;
export type WebsitePreparation = {
  photos?: WebsitePhotos;
  offers?: Record<string, any>[];
  offersComplete?: boolean;
  result?: { status: "ready" | "existing"; siteVersion: number; source?: "ai" | "template"; message?: string };
};
export const WEBSITE_OFFER_FIELDS = ["name", "description", "offerIncludes", "billing", "priceAed", "programmeDays", "baseTrainingPriceAed"];
export const websiteOfferFacts = (facts: Record<string, any>) => Object.fromEntries(WEBSITE_OFFER_FIELDS.filter(k => facts[k] !== undefined).map(k => [k, facts[k]]));

export const WEBSITE_FACT_FIELDS = [
  "publicName", "city", "specialty", "audience", "trainingServices", "deliveryMode",
  "headline", "bio", "name", "description", "offerIncludes", "billing", "priceAed",
  "programmeDays", "baseTrainingPriceAed", "websiteStyle", "websiteMotion",
] as const;
export const WEBSITE_REQUIRED_FIELDS = [
  "audience", "publicName", "city", "specialty", "trainingServices", "deliveryMode",
  "headline", "bio", "name", "description", "offerIncludes", "billing", "priceAed",
];
const present = (value: unknown) => value !== undefined && value !== null && value !== "";

/** All amounts come from the trainer's grounded answers; never pick a price for them. */
export function websiteOffer(facts: Record<string, any>) {
  return {
    name: String(facts.name ?? ""), description: String(facts.description ?? ""),
    priceMinor: Math.round(Number(facts.priceAed) * 100),
    billing: facts.billing as "monthly" | "upfront",
    programmeDays: facts.billing === "upfront" ? facts.programmeDays ?? null : null,
    tier: String(facts.offerIncludes).includes("nutrition") ? "workout_nutrition" as const : "workout" as const,
    premiumVoice: String(facts.offerIncludes).includes("voice"),
  };
}
export function websiteMissingFacts(facts: Record<string, any>) {
  const missing = WEBSITE_REQUIRED_FIELDS.filter(k => !present(facts[k]));
  if (facts.billing === "upfront" && !present(facts.programmeDays)) missing.push("programmeDays");
  const offer = websiteOffer(facts);
  if (present(facts.priceAed) && (!Number.isSafeInteger(offer.priceMinor) || offer.priceMinor < minimumOfferPrice(offer))) missing.push("priceAed");
  if (offer.tier === "workout_nutrition") {
    const basePrice = Math.round(Number(facts.baseTrainingPriceAed) * 100);
    if (!Number.isSafeInteger(basePrice) || basePrice < minimumOfferPrice({ ...offer, tier: "workout", premiumVoice: false }) || basePrice >= offer.priceMinor)
      missing.push("baseTrainingPriceAed");
  }
  return [...new Set(missing)];
}
export function websitePriceQuestion(field: string, facts: Record<string, any>) {
  const offer = websiteOffer(facts);
  if (field === "priceAed") return `What price would you charge in AED${facts.billing === "upfront" ? " for the whole programme" : " each month"}? This package starts at AED ${minimumOfferPrice(offer) / 100}.`;
  if (field === "baseTrainingPriceAed") return `What would you charge for the same training without nutrition or voice? It needs to be at least AED ${minimumOfferPrice({ ...offer, tier: "workout", premiumVoice: false }) / 100} and less than your combined package.`;
  return undefined;
}
