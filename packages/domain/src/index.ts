import { z } from "zod";
export const BANDS = [
  { count: 100, bps: 2500 },
  { count: 200, bps: 2000 },
  { count: 700, bps: 1500 },
  { count: Infinity, bps: 1000 },
];
export function commission(amountMinor: number, rank: number) {
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    !Number.isSafeInteger(rank) ||
    rank < 1
  )
    throw new Error("Invalid commission inputs");
  const bps =
    rank <= 100 ? 2500 : rank <= 300 ? 2000 : rank <= 1000 ? 1500 : 1000;
  return Number((BigInt(amountMinor) * BigInt(bps) + 5000n) / 10000n);
}
export function projectedCommission(count: number, priceMinor: number) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 1000000)
    throw new Error("Invalid subscriber count");
  let left = count,
    total = 0,
    rank = 1;
  for (const band of BANDS) {
    const n = Math.min(left, band.count);
    total += n * commission(priceMinor, rank);
    left -= n;
    rank += n;
    if (!left) break;
  }
  return total;
}
export function validUaeIban(raw: string) {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^AE\d{21}$/.test(iban)) return false;
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  let n = 0;
  for (const c of digits) n = (n * 10 + Number(c)) % 97;
  return n === 1;
}
export const exerciseSchema = z
  .object({
    name: z.string().min(2).max(100),
    sets: z.number().int().min(1).max(10),
    reps: z.number().int().min(1).max(100),
    restSeconds: z.number().int().min(0).max(600),
    loadKg: z.number().min(0).max(500).default(0),
    cue: z.string().max(500).default(""),
  })
  .strict();
export const programSchema = z
  .object({
    title: z.string().min(2).max(120),
    goal: z.string().max(1000),
    daysPerWeek: z.number().int().min(1).max(7),
    exercises: z.array(exerciseSchema).min(1).max(20),
  })
  .strict();
export const ruleSchema = z
  .object({
    title: z.string().min(3).max(150),
    category: z.enum([
      "progression",
      "substitution",
      "schedule",
      "recovery",
      "communication",
      "safety",
    ]),
    condition: z.string().min(3).max(1000),
    directive: z.string().min(3).max(2000),
    reason: z.string().max(2000),
    sourceIds: z.array(z.string().uuid()).max(30).default([]),
  })
  .strict();
export const decisionSchema = z
  .object({
    type: z.enum([
      "message",
      "program_build",
      "progression",
      "substitution",
      "schedule",
      "escalation",
    ]),
    message: z.string().min(1).max(4000),
    reason: z.string().max(2000),
    evidenceIds: z.array(z.string().uuid()).max(30),
    requiresHumanReview: z.boolean(),
    program: programSchema.optional(),
  })
  .strict();
export function safetySignal(text: string) {
  return /\b(chest pain|faint(?:ed|ing)?|dizz(?:y|iness)|shortness of breath|pain|hurt(?:s|ing)?|injur(?:y|ed)|numbness|pregnan(?:t|cy)?|suicid(?:e|al)?)\b/i.test(
    text,
  );
}
export function allowedModelEvidence(
  records: Array<{ id: string; data: any }>,
) {
  for (const r of records)
    if (!r.data.allowedUses?.includes("model_prompt"))
      throw new Error("Evidence is not permitted for model input");
  return records;
}
export const payoutTransitions: Record<string, string[]> = {
  ready: ["held", "submitted", "canceled"],
  held: ["ready", "canceled"],
  submitted: ["processing", "unknown", "failed"],
  processing: ["paid", "unknown", "failed"],
  unknown: ["processing", "paid", "failed"],
  paid: ["returned"],
  failed: [],
  returned: [],
  canceled: [],
};
export function assertPayoutTransition(from: string, to: string) {
  if (!payoutTransitions[from]?.includes(to))
    throw new Error(`Invalid payout transition ${from} to ${to}`);
}
export function refundEligible(chargedAt: string, now = new Date()) {
  const age = now.getTime() - new Date(chargedAt).getTime();
  return age >= 0 && age <= 7 * 24 * 60 * 60 * 1000;
}
export function money(minor: number | string) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(Number(minor) / 100);
}
