import { z } from "zod";
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
export const productSchema = z
  .object({
    name: z.string().min(2).max(100),
    description: z.string().max(1500),
    priceMinor: z.number().int().min(100).max(1000000),
  })
  .strict();
