import { z } from "zod";

export const FIDELITY_VERSION = "trainer-fidelity-v1";
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const fidelityCaseSchema = z
  .object({
    title: text(3, 100),
    turns: z
      .array(
        z
          .object({
            author: z.enum(["subscriber", "trainer"]),
            text: text(3, 700),
          })
          .strict(),
      )
      .min(2)
      .max(6),
    request: text(5, 1200),
    referenceReply: text(3, 2000),
    referenceReason: text(3, 1000),
    expectHandover: z.boolean(),
    fictional: z.literal(true),
  })
  .strict()
  .refine(
    (c) =>
      c.turns.every(
        (t, i) => t.author === (i % 2 ? "trainer" : "subscriber"),
      ) && c.turns.length % 2 === 0,
    "Start with the subscriber and alternate complete exchanges before the new message.",
  )
  .refine(
    (c) =>
      c.turns.reduce((n, t) => n + t.text.length, c.request.length) <= 2400,
    "Keep the conversation and new message within 2,400 characters.",
  );
export type FidelityCase = z.infer<typeof fidelityCaseSchema>;
export const fidelityScoreSchema = z
  .object({
    label: z.enum(["A", "B"]),
    decision: z.number().int().min(1).max(5),
    wording: z.number().int().min(1).max(5),
    context: z.number().int().min(1).max(5),
  })
  .strict();
export const fidelityRatingSchema = z
  .object({
    scores: z
      .array(fidelityScoreSchema)
      .length(2)
      .refine((s) => new Set(s.map((x) => x.label)).size === 2),
    note: z.string().trim().max(1000).default(""),
  })
  .strict();
export const fidelityCorrectionSchema = z
  .object({
    reply: text(3, 2000),
    reason: text(3, 1000),
    confirmed: z.literal(true),
  })
  .strict();
export const fidelitySituation = (c: Pick<FidelityCase, "turns" | "request">) =>
  [
    ...c.turns.map(
      (t) =>
        `${t.author === "subscriber" ? "Subscriber" : "Trainer"}: ${t.text}`,
    ),
    `Subscriber: ${c.request}`,
  ].join("\n");

/** Conservative lexical screen, not a claim of semantic independence. */
export function fidelityOverlap(a: string, b: string) {
  const normal = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\b\d+\b/g, "#");
  const left = normal(a),
    right = normal(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const words = (s: string) =>
    new Set(s.split(" ").filter((w) => w.length > 2));
  const x = words(left),
    y = words(right);
  if (Math.min(x.size, y.size) < 6) return false;
  if (` ${left} `.includes(` ${right} `) || ` ${right} `.includes(` ${left} `))
    return true;
  return (
    [...x].filter((w) => y.has(w)).length / Math.max(x.size, y.size) >= 0.85
  );
}
