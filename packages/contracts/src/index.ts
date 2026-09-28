import { z } from "zod";
import { brandDesignSchema } from "./branding.ts";
export * from "./branding.ts";
export * from "./discovery.ts";
export * from "./marketing.ts";
export const signupSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.email().transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(128),
    slug: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/),
    accepted: z.literal(true),
  })
  .strict();
export const loginSchema = z
  .object({
    email: z.email().transform((s) => s.toLowerCase()),
    password: z.string().min(1).max(128),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    // Optional workspace choice; it must be one of the account's memberships.
    tenantId: z.string().uuid().optional(),
  })
  .strict();
export const brandSchema = z
  .object({
    name: z.string().min(2).max(100),
    bio: z.string().max(2000),
    category: z.string().max(100),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    headline: z.string().max(160),
    timezone: z.literal("Asia/Dubai").default("Asia/Dubai"),
    design: brandDesignSchema.optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict();
export const intakeSchema = z
  .object({
    age: z.number().int().min(18).max(100),
    goal: z.string().min(3).max(1000),
    experience: z.enum(["beginner", "intermediate", "advanced"]),
    daysPerWeek: z.number().int().min(1).max(7),
    equipment: z.string().max(1000),
    limitations: z.string().max(2000),
    consent: z.literal(true),
  })
  .strict();
export const setSchema = z
  .object({
    eventKey: z.string().uuid(),
    exercise: z.string().min(1).max(100),
    set: z.number().int().min(1).max(20),
    reps: z.number().int().min(0).max(200),
    loadKg: z.number().min(0).max(500),
    rir: z.number().min(0).max(10).optional(),
  })
  .strict();
/** Trainer-set programme length bounds (days). `null` means rolling blocks of the Brain default. */
export const PROGRAMME_DAYS_MIN = 7;
export const PROGRAMME_DAYS_MAX = 365;
export const programmeDaysSchema = z
  .number()
  .int()
  .min(PROGRAMME_DAYS_MIN)
  .max(PROGRAMME_DAYS_MAX);
/** Trainer-set monthly price of the premium voice add-on a member may add to this offer. */
export const voiceAddOnPriceSchema = z.number().int().min(100).max(100000);
/**
 * A trainer's offer. `billing: "monthly"` renews every month (a programme
 * length then defines the block length); `billing: "upfront"` is one payment
 * for the whole programme and needs a programme length. Premium voice is no
 * longer a separate offer: `voiceAddOnMinor` prices the add-on members buy
 * with their membership (older offers with `premiumVoice` keep including it).
 */
export const productSchema = z
  .object({
    name: z.string().min(2).max(100),
    description: z.string().max(1500),
    priceMinor: z.number().int().min(100).max(1000000),
    tier: z.enum(["workout", "workout_nutrition"]).default("workout"),
    baseProductId: z.string().uuid().optional(),
    programmeDays: programmeDaysSchema.nullable().default(null),
    billing: z.enum(["monthly", "upfront"]).default("monthly"),
    voiceAddOnMinor: voiceAddOnPriceSchema.nullable().default(null),
  })
  .strict()
  .superRefine((offer, ctx) => {
    if (offer.billing === "upfront" && offer.programmeDays === null)
      ctx.addIssue({
        code: "custom",
        path: ["programmeDays"],
        message: "An upfront programme needs a length in days",
      });
  });
export * from "./marketing-features.ts";
